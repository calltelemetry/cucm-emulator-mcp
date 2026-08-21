/**
 * MCP Test Client Helper
 *
 * Opaque-box client wrapper for testing CucmEmulatorMcpServer over InMemory, Stdio, and SSE transports.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

export interface McpCallToolResult {
  content: Array<{
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
  [key: string]: unknown;
}

export interface McpNotificationRecord {
  method: string;
  params: unknown;
  timestamp: string;
}

export class McpTestClient {
  public client: Client;
  private transport: Transport | null = null;
  private notifications: McpNotificationRecord[] = [];
  private notificationHandlers: Map<string, Array<(params: unknown) => void>> = new Map();

  constructor(clientName = "cucm-emulator-mcp-e2e-client", clientVersion = "1.0.0") {
    this.client = new Client(
      {
        name: clientName,
        version: clientVersion,
      },
      {
        capabilities: {},
      }
    );

    // Capture standard notifications
    this.client.setNotificationHandler(ToolListChangedNotificationSchema, (notification: any) => {
      const record = {
        method: "notifications/tools/list_changed",
        params: notification?.params,
        timestamp: new Date().toISOString(),
      };
      this.notifications.push(record);
      const handlers = this.notificationHandlers.get("notifications/tools/list_changed") || [];
      for (const h of handlers) {
        try {
          h(notification?.params);
        } catch {
          // ignore error in test handler callback
        }
      }
    });
  }

  /**
   * Connect to an in-process CucmEmulatorMcpServer instance or McpServer via InMemoryTransport linked pair.
   */
  public async connectInMemory(server: { server?: any; connect?: (transport: any) => Promise<void> } | any): Promise<void> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    this.transport = clientTransport;

    if (typeof server.connect === "function") {
      await server.connect(serverTransport);
    } else if (server.server && typeof server.server.connect === "function") {
      await server.server.connect(serverTransport);
    } else {
      throw new Error("Target server does not expose a compatible connect(transport) method");
    }

    await this.client.connect(clientTransport);
  }

  /**
   * Connect to an external CLI process via StdioClientTransport.
   */
  public async connectStdio(command: string, args: string[] = [], env?: Record<string, string>): Promise<void> {
    const stdioTransport = new StdioClientTransport({
      command,
      args,
      env: { ...process.env, ...env } as Record<string, string>,
    });
    this.transport = stdioTransport;
    await this.client.connect(stdioTransport);
  }

  /**
   * Connect to a remote or local SSE endpoint.
   */
  public async connectSse(sseUrl: string): Promise<void> {
    const sseTransport = new SSEClientTransport(new URL(sseUrl));
    this.transport = sseTransport;
    await this.client.connect(sseTransport);
  }

  /**
   * List all tools advertised by the server.
   */
  public async listTools(): Promise<McpToolDefinition[]> {
    const response = await this.client.listTools();
    return (response.tools || []) as McpToolDefinition[];
  }

  /**
   * Raw tool execution.
   */
  public async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpCallToolResult> {
    const response = await this.client.callTool({
      name,
      arguments: args,
    });
    return response as McpCallToolResult;
  }

  /**
   * Call tool asserting successful response and parsing JSON text payload.
   */
  public async callToolSuccess<T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const result = await this.callTool(name, args);
    if (result.isError) {
      const errorMsg = result.content?.map((c) => c.text).join("\n") || "Unknown tool error";
      throw new Error(`Expected tool "${name}" to succeed but it returned error: ${errorMsg}`);
    }

    const firstText = result.content?.find((c) => c.type === "text")?.text;
    if (!firstText) {
      return {} as T;
    }

    try {
      return JSON.parse(firstText) as T;
    } catch {
      return firstText as unknown as T;
    }
  }

  /**
   * Call tool expecting an error response.
   */
  public async callToolError(name: string, args: Record<string, unknown> = {}): Promise<{
    isError: boolean;
    message: string;
    raw: McpCallToolResult;
  }> {
    try {
      const result = await this.callTool(name, args);
      if (!result.isError) {
        throw new Error(`Expected tool "${name}" to fail with error, but it succeeded with: ${JSON.stringify(result)}`);
      }
      const message = result.content?.map((c) => c.text).join("\n") || "";
      return {
        isError: true,
        message,
        raw: result,
      };
    } catch (err: any) {
      return {
        isError: true,
        message: err.message,
        raw: { content: [{ type: "text", text: err.message }], isError: true },
      };
    }
  }

  /**
   * Ping the server.
   */
  public async ping(): Promise<void> {
    await this.client.ping();
  }

  /**
   * Register a notification listener.
   */
  public onNotification(method: string, handler: (params: unknown) => void): void {
    const handlers = this.notificationHandlers.get(method) || [];
    handlers.push(handler);
    this.notificationHandlers.set(method, handlers);
  }

  /**
   * Retrieve all captured protocol notifications.
   */
  public getNotifications(): McpNotificationRecord[] {
    return [...this.notifications];
  }

  /**
   * Clear notification history.
   */
  public clearNotifications(): void {
    this.notifications = [];
  }

  /**
   * Disconnect and teardown.
   */
  public async close(): Promise<void> {
    try {
      await this.client.close();
    } catch {
      // ignore teardown errors
    }
    if (this.transport && typeof (this.transport as any).close === "function") {
      try {
        await (this.transport as any).close();
      } catch {
        // ignore transport close errors
      }
    }
    this.transport = null;
  }
}
