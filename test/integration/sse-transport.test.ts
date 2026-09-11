import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CucmEmulatorMcpServer } from "../../src/server.js";
import { McpTestClient } from "../helpers/mcp-test-client.js";

describe("Integration: SSE Server Transport & Express Endpoints", () => {
  let server: CucmEmulatorMcpServer;
  let client: McpTestClient;
  let sseUrl: string;

  beforeEach(async () => {
    server = new CucmEmulatorMcpServer({
      config: {
        transport: "sse",
        port: 0, // bind to ephemeral port
        host: "127.0.0.1",
        mock: true,
        seedProfile: "lab-small",
      },
    });

    const endpoint = (await server.start()) as string;
    sseUrl = `${endpoint}/sse`;

    client = new McpTestClient();
    await client.connectSse(sseUrl);
  });

  afterEach(async () => {
    await client.close();
    await server.stop();
  });

  it("serves healthcheck at GET /health and GET /healthz", async () => {
    const healthUrl = sseUrl.replace(/\/sse$/, "/health");
    const res = await fetch(healthUrl);
    expect(res.ok).toBe(true);

    const json = (await res.json()) as any;
    expect(json.status).toBe("ok");
    expect(json.service).toBe("@calltelemetry/cucm-emulator-mcp");
    expect(json.version).toBe("0.2.0");
    expect(json.transport).toBe("sse");
    expect(json.toolsCount).toBeGreaterThanOrEqual(15);
    expect(json.mode).toBe("mock");

    const healthzUrl = sseUrl.replace(/\/sse$/, "/healthz");
    const resZ = await fetch(healthzUrl);
    expect(resZ.ok).toBe(true);
    const jsonZ = (await resZ.json()) as any;
    expect(jsonZ.status).toBe("ok");
    expect(jsonZ.version).toBe("0.2.0");
  });

  it("serves tool metadata at GET /tools", async () => {
    const toolsUrl = sseUrl.replace(/\/sse$/, "/tools");
    const res = await fetch(toolsUrl);
    expect(res.ok).toBe(true);

    const json = (await res.json()) as any;
    expect(Array.isArray(json.tools)).toBe(true);
    expect(json.tools.length).toBeGreaterThanOrEqual(15);
  });

  it("serves OpenAPI spec contract at GET /openapi.json", async () => {
    const specUrl = sseUrl.replace(/\/sse$/, "/openapi.json");
    const res = await fetch(specUrl);
    expect(res.ok).toBe(true);

    const json = (await res.json()) as any;
    expect(json.openapi).toBeDefined();
    expect(json.info).toBeDefined();
  });

  it("executes MCP tools over SSE transport", async () => {
    const tools = await client.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(15);

    const inspectRes = await client.callToolSuccess<any>("emu_inspect_fixtures", {});
    expect(inspectRes.clusterName).toBeDefined();

    const simRes = await client.callToolSuccess<any>("emu_simulate_call", {
      callingNumber: "1001",
      calledNumber: "1002",
      duration: 15,
    });
    expect(simRes.sessionId).toBeDefined();
  });
});
