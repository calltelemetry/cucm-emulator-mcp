import { describe, it, expect, beforeEach } from "vitest";
import { loadOpenApiSpec } from "../../../src/openapi/parser.js";
import { generateDynamicToolsFromSpec, generateDynamicToolsMap } from "../../../src/tools/generator.js";
import { DirectStoreCucmClient } from "../../../src/client/mock-client.js";
import { InMemoryCucmStore } from "../../../src/mock/store.js";
import type { OpenApiSpec } from "../../../src/openapi/types.js";

describe("Dynamic Tool Generator", () => {
  let spec: OpenApiSpec;
  let store: InMemoryCucmStore;
  let client: DirectStoreCucmClient;

  beforeEach(async () => {
    spec = await loadOpenApiSpec();
    store = new InMemoryCucmStore();
    client = new DirectStoreCucmClient(store);
  });

  it("compiles all OpenAPI operations into discrete MCP tools", () => {
    const tools = generateDynamicToolsFromSpec(spec);
    expect(tools.length).toBeGreaterThanOrEqual(40);

    for (const tool of tools) {
      expect(tool.name).toMatch(/^emu_/);
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.annotations).toBeDefined();
    }
  });

  it("creates keyed map of dynamic tools", () => {
    const toolMap = generateDynamicToolsMap(spec);
    expect(toolMap.has("emu_get_summary")).toBe(true);
    expect(toolMap.has("emu_get_topology")).toBe(true);
  });

  it("executes dynamic tool via client generic dispatcher", async () => {
    const toolMap = generateDynamicToolsMap(spec);
    const summaryTool = toolMap.get("emu_get_summary");
    expect(summaryTool).toBeDefined();

    const result = await summaryTool!.execute({}, client);
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.clusterName).toBeDefined();
  });
});
