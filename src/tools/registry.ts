import type { ICucmEmulatorClient } from "../client/interface.js";
import type { OpenApiSpec } from "../openapi/types.js";
import type { McpTool, McpToolResult } from "./types.js";
import { generateDynamicToolsFromSpec } from "./generator.js";
import { allDomainTools } from "./domains/index.js";

export type ToolsChangedListener = () => void;

/**
 * ToolRegistry manages the complete catalog of discrete domain tools and dynamic OpenAPI tools.
 * It handles registration, execution routing, and dispatches change notifications when tools update.
 */
export class ToolRegistry {
  private tools: Map<string, McpTool> = new Map();
  private listeners: Set<ToolsChangedListener> = new Set();

  constructor(includeDefaultDomainTools = true) {
    if (includeDefaultDomainTools) {
      this.registerMany(allDomainTools);
    }
  }

  /**
   * Registers a single tool in the registry.
   */
  public register(tool: McpTool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Registers multiple tools in the registry.
   */
  public registerMany(tools: McpTool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * Unregisters a tool by name.
   */
  public unregister(toolName: string): boolean {
    const deleted = this.tools.delete(toolName);
    if (deleted) {
      this.notifyToolsChanged();
    }
    return deleted;
  }

  /**
   * Checks if a tool exists in the registry.
   */
  public hasTool(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  /**
   * Retrieves a specific tool definition.
   */
  public getTool(toolName: string): McpTool | undefined {
    return this.tools.get(toolName);
  }

  /**
   * Returns all registered McpTool objects.
   */
  public getAllTools(): McpTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Returns formatted tool definitions for MCP ListTools response.
   */
  public listToolDefinitions(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  /**
   * Returns the count of registered tools.
   */
  public get size(): number {
    return this.tools.size;
  }

  /**
   * Executes a tool with provided arguments and client.
   */
  public async executeTool(
    name: string,
    args: Record<string, unknown> = {},
    client: ICucmEmulatorClient
  ): Promise<McpToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        content: [
          {
            type: "text",
            text: `Tool "${name}" not found in MCP registry. Available tools: ${Array.from(this.tools.keys()).slice(0, 10).join(", ")}...`,
          },
        ],
        isError: true,
      };
    }

    return tool.execute(args, client);
  }

  /**
   * Subscribes a listener to tools changed events.
   */
  public onToolsChanged(listener: ToolsChangedListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notifies all registered listeners that the tool catalog has changed.
   */
  public notifyToolsChanged(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        // Suppress listener errors during broadcast
        console.error("Error in tools changed listener:", err);
      }
    }
  }

  /**
   * Loads or reloads dynamic tools from an OpenAPI specification, preserving domain tools,
   * and fires tool change notifications.
   */
  public reloadFromSpec(spec: OpenApiSpec, options: { notify?: boolean } = {}): void {
    // 1. Re-register domain tools
    for (const domainTool of allDomainTools) {
      this.tools.set(domainTool.name, domainTool);
    }

    // 2. Generate and overlay dynamic OpenAPI tools
    const dynamicTools = generateDynamicToolsFromSpec(spec);
    for (const dynamicTool of dynamicTools) {
      // If a domain tool exists with a specialized schema/handler, preserve or merge it
      if (!this.tools.has(dynamicTool.name)) {
        this.tools.set(dynamicTool.name, dynamicTool);
      }
    }

    // Skip notify on first load — Cursor discovery fails if tools/list_changed races tools/list.
    if (options.notify !== false) {
      this.notifyToolsChanged();
    }
  }
}
