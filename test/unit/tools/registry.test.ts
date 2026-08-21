import { describe, it, expect, beforeEach, vi } from "vitest";
import { ToolRegistry } from "../../../src/tools/registry.js";
import { DirectStoreCucmClient } from "../../../src/client/mock-client.js";
import { InMemoryCucmStore } from "../../../src/mock/store.js";
import { loadOpenApiSpec } from "../../../src/openapi/parser.js";
import type { McpTool } from "../../../src/tools/types.js";

describe("ToolRegistry", () => {
  let registry: ToolRegistry;
  let client: DirectStoreCucmClient;

  beforeEach(() => {
    registry = new ToolRegistry(true);
    client = new DirectStoreCucmClient(new InMemoryCucmStore());
  });

  it("initializes with 15 domain tools", () => {
    expect(registry.size).toBe(15);
    expect(registry.hasTool("emu_seed_fixtures")).toBe(true);
    expect(registry.hasTool("emu_simulate_call")).toBe(true);
  });

  it("registers and unregisters custom tools", () => {
    const customTool: McpTool = {
      name: "emu_custom_test_tool",
      description: "Custom test tool",
      inputSchema: { type: "object" },
      async execute() {
        return { content: [{ type: "text", text: "ok" }] };
      },
    };

    registry.register(customTool);
    expect(registry.hasTool("emu_custom_test_tool")).toBe(true);

    const removed = registry.unregister("emu_custom_test_tool");
    expect(removed).toBe(true);
    expect(registry.hasTool("emu_custom_test_tool")).toBe(false);
  });

  it("executes registered tool and formats result", async () => {
    const result = await registry.executeTool("emu_inspect_fixtures", {}, client);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].type).toBe("text");
  });

  it("returns error for non-existent tool execution", async () => {
    const result = await registry.executeTool("emu_nonexistent_tool_xyz", {}, client);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found in MCP registry");
  });

  it("fires change notification listeners on spec reload", async () => {
    const listener = vi.fn();
    const unsubscribe = registry.onToolsChanged(listener);

    const spec = await loadOpenApiSpec();
    registry.reloadFromSpec(spec);

    expect(listener).toHaveBeenCalled();
    expect(registry.size).toBeGreaterThan(15);

    unsubscribe();
  });
});
