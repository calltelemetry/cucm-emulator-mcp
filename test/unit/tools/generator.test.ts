import { describe, it, expect, beforeEach } from "vitest";
import { loadOpenApiSpec } from "../../../src/openapi/parser.js";
import { generateDynamicToolsFromSpec, generateDynamicToolsMap, isAgentFacingPath } from "../../../src/tools/generator.js";
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
      expect(tool.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(tool.name).toMatch(/^emu_/);
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.annotations).toBeDefined();
    }
  });

  it("exposes SOAP AXL/RIS/DIME as short aliases under the 64-character Cursor limit", () => {
    expect(isAgentFacingPath("/api/v2/summary")).toBe(true);
    expect(isAgentFacingPath("/emulated-phone/{name}/CGI/Screenshot")).toBe(true);
    expect(isAgentFacingPath("/axl/")).toBe(true);
    expect(isAgentFacingPath("/realtimeservice2/services/RISService70")).toBe(true);
    expect(isAgentFacingPath("/logcollectionservice2/services/LogCollectionPortTypeService")).toBe(true);
    expect(isAgentFacingPath("/logcollectionservice/services/DimeGetFileService")).toBe(true);
    const tools = generateDynamicToolsFromSpec(spec);
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("emu_axl");
    expect(names).toContain("emu_ris");
    expect(names).toContain("emu_dime");
    expect(names).toContain("emu_dime_file");
    expect(tools.some((tool) => tool.name.includes("log_collection"))).toBe(false);
    expect(tools.some((tool) => tool.name === "emu_post_axl_")).toBe(false);
    for (const name of ["emu_axl", "emu_ris", "emu_dime", "emu_dime_file"]) {
      expect(name.length).toBeLessThanOrEqual(64);
    }
    const dime = tools.find((tool) => tool.name === "emu_dime");
    expect(dime?.inputSchema.properties).toHaveProperty("body");
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
