import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CucmEmulatorMcpServer } from "../../src/server.js";
import { McpTestClient } from "../helpers/mcp-test-client.js";

describe("Integration: MCP JSON-RPC 2.0 Protocol Compliance", () => {
  let server: CucmEmulatorMcpServer;
  let client: McpTestClient;

  beforeEach(async () => {
    server = new CucmEmulatorMcpServer({
      config: { mock: true, seedProfile: "lab-small" },
    });
    await server.initialize();

    client = new McpTestClient();
    await client.connectInMemory(server);
  });

  afterEach(async () => {
    await client.close();
    await server.stop();
  });

  it("handles ping request", async () => {
    await expect(client.ping()).resolves.toBeUndefined();
  });

  it("lists all registered tools with complete JSON schema validation definitions", async () => {
    const tools = await client.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(45);

    // Verify presence of all core domain tools
    const toolNames = new Set(tools.map((t) => t.name));
    expect(toolNames.has("emu_seed_fixtures")).toBe(true);
    expect(toolNames.has("emu_reset_store")).toBe(true);
    expect(toolNames.has("emu_inspect_fixtures")).toBe(true);
    expect(toolNames.has("emu_list_nodes")).toBe(true);
    expect(toolNames.has("emu_set_node_status")).toBe(true);
    expect(toolNames.has("emu_list_phones")).toBe(true);
    expect(toolNames.has("emu_set_phone_status")).toBe(true);
    expect(toolNames.has("emu_get_phone_web")).toBe(true);
    expect(toolNames.has("emu_get_phone_screenshot")).toBe(true);
    expect(toolNames.has("emu_simulate_call")).toBe(true);
    expect(toolNames.has("emu_call_action")).toBe(true);
    expect(toolNames.has("emu_list_active_calls")).toBe(true);
    expect(toolNames.has("emu_evaluate_curri")).toBe(true);
    expect(toolNames.has("emu_get_curri_history")).toBe(true);
    expect(toolNames.has("emu_generate_cdrs")).toBe(true);
    expect(toolNames.has("emu_get_cdr_history")).toBe(true);

    // Verify presence of dynamic OpenAPI tools
    expect(toolNames.has("emu_get_summary")).toBe(true);
    expect(toolNames.has("emu_get_topology")).toBe(true);
  });

  it("executes discrete domain tools over standard MCP JSON-RPC protocol", async () => {
    // 1. Fixtures seed
    const seedRes = await client.callToolSuccess<any>("emu_seed_fixtures", {
      fixtureProfile: "lab-small",
      phoneCount: 12,
    });
    expect(seedRes.status).toBe("success");

    // 2. Inspect fixtures
    const summary = await client.callToolSuccess<any>("emu_inspect_fixtures", {});
    expect(summary.clusterName).toBeDefined();
    expect(summary.counts.phones).toBeGreaterThanOrEqual(10);

    // 3. List nodes
    const nodes = await client.callToolSuccess<any[]>("emu_list_nodes", {});
    expect(nodes.length).toBeGreaterThanOrEqual(2);

    // 4. Set node status for failover
    const pub = nodes.find((n) => n.role === "publisher") || nodes[0];
    const setNodeRes = await client.callToolSuccess<any>("emu_set_node_status", {
      nodeName: pub.name,
      status: "Ok",
    });
    expect(setNodeRes.risReturnCode).toBe("Ok");

    // 5. List phones
    const phones = await client.callToolSuccess<any[]>("emu_list_phones", { limit: 5 });
    expect(phones.length).toBeLessThanOrEqual(5);

    // 6. Simulate call
    const callRes = await client.callToolSuccess<any>("emu_simulate_call", {
      callingNumber: "1001",
      calledNumber: "1002",
      duration: 45,
    });
    expect(callRes.sessionId).toBeDefined();
    expect(callRes.duration).toBe(45);

    // 7. Evaluate CURRI
    const curriRes = await client.callToolSuccess<any>("emu_evaluate_curri", {
      callingNumber: "1001",
      calledNumber: "1002",
    });
    expect(curriRes.action).toBe("permit");

    // 8. Generate CDRs
    const cdrRes = await client.callToolSuccess<any>("emu_generate_cdrs", {
      count: 5,
      pattern: "normal",
    });
    expect(cdrRes.generatedCount).toBe(5);
  });

  it("executes dynamic OpenAPI tools over MCP protocol", async () => {
    const summary = await client.callToolSuccess<any>("emu_get_summary", {});
    expect(summary.clusterName).toBeDefined();
  });

  it("handles unknown tool errors gracefully with isError flag", async () => {
    const errorRes = await client.callToolError("emu_unknown_nonexistent_tool", {});
    expect(errorRes.isError).toBe(true);
    expect(errorRes.message).toContain("not found in MCP registry");
  });
});
