import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  PingRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ICucmEmulatorClient } from "./client/interface.js";
import { DirectStoreCucmClient } from "./client/mock-client.js";
import { EndpointResolver } from "./client/resolver.js";
import { InMemoryCucmStore } from "./mock/store.js";
import { loadOpenApiSpec } from "./openapi/parser.js";
import type { OpenApiSpec } from "./openapi/types.js";
import { ToolRegistry } from "./tools/registry.js";
import { parseConfig, type CucmEmulatorMcpConfig } from "./config.js";
import { createStdioTransport, restoreLogsFromStderr } from "./transports/stdio.js";
import { SseServerManager } from "./transports/sse.js";
import type { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export interface CucmEmulatorMcpServerOptions {
  config?: Partial<CucmEmulatorMcpConfig>;
  client?: ICucmEmulatorClient;
  store?: InMemoryCucmStore;
  spec?: OpenApiSpec;
}

/**
 * CucmEmulatorMcpServer
 *
 * OpenAPI-driven Model Context Protocol (MCP) Server for Cisco Unified Communications Manager (CUCM) Emulator.
 * Supports Stdio and SSE transports, in-memory mock store, live HTTP endpoints, dynamic tool compilation,
 * and live protocol notifications (notifications/tools/list_changed).
 */
export class CucmEmulatorMcpServer {
  public readonly server: Server;
  public readonly registry: ToolRegistry;
  public client!: ICucmEmulatorClient;
  public store?: InMemoryCucmStore;
  public spec?: OpenApiSpec;
  public config: CucmEmulatorMcpConfig;

  private sseManager: SseServerManager | null = null;
  private stdioTransport: StdioServerTransport | null = null;
  private isInitialized = false;

  constructor(options: CucmEmulatorMcpServerOptions = {}) {
    this.config = parseConfig(options.config);
    this.registry = new ToolRegistry(true);

    if (options.client) {
      this.client = options.client;
    }
    if (options.store) {
      this.store = options.store;
    }
    if (options.spec) {
      this.spec = options.spec;
    }

    // Initialize MCP Protocol Server
    this.server = this.createProtocolServer();

    // Hook registry change listener to broadcast MCP notifications
    this.registry.onToolsChanged(() => {
      this.broadcastToolsChanged().catch(() => {
        // Suppress notification delivery error if client is not connected
      });
    });
  }

  public createProtocolServer(): Server {
    const server = new Server(
      {
        name: "@calltelemetry/cucm-emulator-mcp",
        version: "0.2.3",
      },
      {
        capabilities: {
          tools: {
            listChanged: true,
          },
        },
      }
    );

    // 1. ListTools Request Handler
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      await this.ensureInitialized();
      return {
        tools: this.registry.listToolDefinitions() as any,
      };
    });

    // 2. CallTool Request Handler
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      await this.ensureInitialized();
      const { name, arguments: args } = request.params;
      const result = await this.registry.executeTool(name, args || {}, this.client);
      return {
        content: result.content as any,
        isError: result.isError,
      };
    });

    // 3. Ping Request Handler
    server.setRequestHandler(PingRequestSchema, async () => {
      return {};
    });

    return server;
  }

  /**
   * Initializes OpenAPI specification, client resolution, and tool registry.
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // 1. Load OpenAPI Specification
    if (!this.spec) {
      this.spec = await loadOpenApiSpec(this.config.specPath);
    }

    // 2. Resolve Client Backend (HTTP or In-Memory Mock Store)
    if (!this.client) {
      if (this.config.mock) {
        if (!this.store) {
          this.store = new InMemoryCucmStore();
          if (this.config.seedProfile && this.config.seedProfile !== "lab-small") {
            this.store.resetStore({ profile: this.config.seedProfile });
          }
        }
        this.client = new DirectStoreCucmClient(this.store);
      } else {
        const resolution = await EndpointResolver.resolveClient({
          targetUrl: this.config.targetUrl,
          authToken: this.config.authToken,
          forceMock: this.config.mock,
        });

        this.client = resolution.client;
        if (this.client instanceof DirectStoreCucmClient) {
          this.store = this.client.store;
          if (this.config.seedProfile && this.config.seedProfile !== "lab-small") {
            this.store.resetStore({ profile: this.config.seedProfile });
          }
        }
      }
    }

    // 3. Populate and overlay dynamic tools from OpenAPI spec
    if (this.spec) {
      this.registry.reloadFromSpec(this.spec, { notify: false });
    }

    this.isInitialized = true;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  /**
   * Connects the MCP server to an external or custom transport (e.g. InMemoryTransport pair for testing).
   */
  public async connect(transport: Transport): Promise<void> {
    await this.ensureInitialized();
    await this.server.connect(transport);
  }

  /**
   * Starts the server using the configured transport (Stdio or SSE).
   */
  public async start(): Promise<string | void> {
    await this.ensureInitialized();

    if (this.config.transport === "stdio") {
      this.stdioTransport = createStdioTransport();
      await this.server.connect(this.stdioTransport);
      return;
    }

    if (this.config.transport === "sse") {
      this.sseManager = new SseServerManager({
        port: this.config.port,
        host: this.config.host,
        createMcpServer: () => this.createProtocolServer(),
        mcpServer: this.server,
        registry: this.registry,
        client: this.client,
        spec: this.spec,
      });

      const endpointUrl = await this.sseManager.start();
      return endpointUrl;
    }
  }

  /**
   * Stops the server and closes all active transports and connections.
   */
  public async stop(): Promise<void> {
    if (this.sseManager) {
      await this.sseManager.stop();
      this.sseManager = null;
    }

    if (this.stdioTransport) {
      try {
        await this.stdioTransport.close();
      } catch {
        // ignore close error
      }
      this.stdioTransport = null;
      restoreLogsFromStderr();
    }

    try {
      await this.server.close();
    } catch {
      // ignore server close errors during teardown
    }
  }

  /**
   * Dynamically reloads OpenAPI contract specification and dispatches protocol notifications.
   */
  public async reloadSpec(source?: string): Promise<void> {
    this.spec = await loadOpenApiSpec(source || this.config.specPath);
    this.registry.reloadFromSpec(this.spec);

    if (this.sseManager && this.spec) {
      this.sseManager.updateSpec(this.spec);
    }

    await this.broadcastToolsChanged();
  }

  /**
   * Broadcasts `notifications/tools/list_changed` to all connected clients.
   */
  public async broadcastToolsChanged(): Promise<void> {
    try {
      await this.server.sendToolListChanged();
    } catch {
      // ignore when no transport is connected
    }
  }
}
