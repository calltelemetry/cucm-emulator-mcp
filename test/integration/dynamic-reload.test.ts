import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CucmEmulatorMcpServer } from "../../src/server.js";
import { McpTestClient } from "../helpers/mcp-test-client.js";

describe("Integration: Dynamic Spec Reload & Protocol Notifications", () => {
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

  it("dispatches notifications/tools/list_changed when spec or tools are reloaded", async () => {
    let notificationReceived = false;

    client.onNotification("notifications/tools/list_changed", () => {
      notificationReceived = true;
    });

    // Trigger dynamic reload
    await server.reloadSpec();

    // Give microtask event loop turn to deliver notification
    await new Promise((r) => setTimeout(r, 50));

    expect(notificationReceived).toBe(true);
    const captured = client.getNotifications();
    expect(captured.some((n) => n.method === "notifications/tools/list_changed")).toBe(true);
  });

  it("allows registering dynamic custom tools and notifying clients", async () => {
    let notificationReceived = false;

    client.onNotification("notifications/tools/list_changed", () => {
      notificationReceived = true;
    });

    // Register a new custom tool at runtime
    server.registry.register({
      name: "cucm_emulator_hot_reload_test_tool",
      description: "Hot reloaded tool",
      inputSchema: { type: "object" },
      async execute() {
        return { content: [{ type: "text", text: "dynamic-result" }] };
      },
    });

    server.registry.notifyToolsChanged();

    await new Promise((r) => setTimeout(r, 50));
    expect(notificationReceived).toBe(true);

    const tools = await client.listTools();
    expect(tools.some((t) => t.name === "cucm_emulator_hot_reload_test_tool")).toBe(true);

    const callRes = await client.callToolSuccess("cucm_emulator_hot_reload_test_tool", {});
    expect(callRes).toBe("dynamic-result");
  });
});
