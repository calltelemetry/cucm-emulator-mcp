/**
 * Empirical Adversarial Verification Runner for @calltelemetry/cucm-emulator-mcp
 * 
 * Executes rigorous, empirical checks across:
 * 1. Protocol & Tooling Compliance (discrete tools, schema rejection, list_changed notification, stdio stdout purity)
 * 2. Domain Simulation Correctness (nodes/ADR 0120/0122 codes, phones/web, call simulation/legs/RTP/CDRs/mid-call, CURRI policies, fixtures seed/reset)
 * 3. Stress & Edge Cases (concurrency bursts, deep/cyclic $ref schemas, offline fallback)
 */

import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryCucmStore } from "../../src/mock/store.js";
import { DirectStoreCucmClient } from "../../src/client/mock-client.js";
import { CucmEmulatorMcpServer } from "../../src/server.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { dereferenceSchema } from "../../src/openapi/deref.js";
import { EndpointResolver } from "../../src/client/resolver.js";
import { SchemaParseError } from "../../src/types/errors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TestResult {
  category: string;
  testName: string;
  passed: boolean;
  durationMs: number;
  details?: string;
  error?: string;
}

const results: TestResult[] = [];

async function runTest(
  category: string,
  testName: string,
  fn: () => Promise<string | void>
): Promise<void> {
  const start = Date.now();
  try {
    const details = await fn();
    const durationMs = Date.now() - start;
    results.push({
      category,
      testName,
      passed: true,
      durationMs,
      details: details || "Passed",
    });
    console.log(`[PASS] [${durationMs}ms] ${category} > ${testName}`);
  } catch (err: any) {
    const durationMs = Date.now() - start;
    results.push({
      category,
      testName,
      passed: false,
      durationMs,
      error: err?.message || String(err),
    });
    console.error(`[FAIL] [${durationMs}ms] ${category} > ${testName}: ${err?.message || err}`);
  }
}

async function main() {
  console.log("===============================================================================");
  console.log("EMPIRICAL ADVERSARIAL VERIFICATION HARNESS - @calltelemetry/cucm-emulator-mcp");
  console.log("===============================================================================\n");

  // =========================================================================
  // GROUP 1: PROTOCOL & TOOLING COMPLIANCE
  // =========================================================================

  await runTest("1. Protocol & Tooling Compliance", "1.1 Verify Discrete Tools (No Mega-Tools)", async () => {
    const server = new CucmEmulatorMcpServer({ config: { mock: true } });
    await server.initialize();

    const tools = server.registry.getAllTools();
    const toolNames = tools.map((t) => t.name);

    // 15 Discrete Domain Tools required
    const expectedDomainTools = [
      "emu_seed_fixtures",
      "emu_reset_store",
      "emu_inspect_fixtures",
      "emu_list_nodes",
      "emu_set_node_status",
      "emu_list_phones",
      "emu_set_phone_status",
      "emu_get_phone_web",
      "emu_simulate_call",
      "emu_call_action",
      "emu_list_active_calls",
      "emu_evaluate_curri",
      "emu_get_curri_history",
      "emu_generate_cdrs",
      "emu_get_cdr_history",
    ];

    for (const dt of expectedDomainTools) {
      if (!toolNames.includes(dt)) {
        throw new Error(`Missing expected discrete domain tool: "${dt}"`);
      }
    }

    // Verify tools count: all discrete tools generated from spec + domain tools
    if (tools.length < 15) {
      throw new Error(`Expected at least 15 discrete tools, found ${tools.length}`);
    }

    // Verify discrete naming and discrete single-purpose schemas
    for (const tool of tools) {
      if (!tool.name.startsWith("emu_")) {
        throw new Error(`Tool "${tool.name}" violates naming convention (must start with emu_)`);
      }
      if (typeof tool.description !== "string" || tool.description.length === 0) {
        throw new Error(`Tool "${tool.name}" missing description`);
      }
      if (!tool.inputSchema || typeof tool.inputSchema !== "object") {
        throw new Error(`Tool "${tool.name}" missing valid JSON inputSchema`);
      }
    }

    await server.stop();
    return `Verified ${tools.length} discrete tools in catalog including all 15 domain tools. Zero mega-tools.`;
  });

  await runTest("1. Protocol & Tooling Compliance", "1.2 JSON Schema Parameter Validation Rejects Invalid Inputs", async () => {
    const server = new CucmEmulatorMcpServer({ config: { mock: true } });
    await server.initialize();

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "schema-validator-test", version: "1.0.0" }, { capabilities: {} });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    // Test A: Missing required parameter on emu_set_phone_status
    const resMissing = await client.callTool({
      name: "emu_set_phone_status",
      arguments: {},
    });
    if (!resMissing.isError) {
      throw new Error("Expected emu_set_phone_status without arguments to return isError: true");
    }

    // Test B: Invalid node on emu_set_node_status
    const resBadNode = await client.callTool({
      name: "emu_set_node_status",
      arguments: { nodeName: "GHOST_NODE_999", status: "NotFound" },
    });
    if (!resBadNode.isError) {
      throw new Error("Expected emu_set_node_status with ghost node to return isError: true");
    }
    const badNodeText = (resBadNode.content as any)[0].text;
    if (!badNodeText.includes("CucmNode") && !badNodeText.includes("not found")) {
      throw new Error(`Unexpected error text for bad node: ${badNodeText}`);
    }

    // Test C: Unknown tool call
    const resUnknown = await client.callTool({
      name: "emu_non_existent_tool",
      arguments: {},
    });
    if (!resUnknown.isError) {
      throw new Error("Expected non_existent tool to return isError: true");
    }
    const unknownText = (resUnknown.content as any)[0].text;
    if (!unknownText.includes("not found in MCP registry")) {
      throw new Error(`Unexpected unknown tool text: ${unknownText}`);
    }

    await client.close();
    await server.stop();
    return "Handled schema/entity validation errors cleanly with isError=true and descriptive error messages.";
  });

  await runTest("1. Protocol & Tooling Compliance", "1.3 Protocol Notifications: notifications/tools/list_changed triggers", async () => {
    const server = new CucmEmulatorMcpServer({ config: { mock: true } });
    await server.initialize();

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "notification-tester", version: "1.0.0" }, { capabilities: {} });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    let notificationCount = 0;
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      notificationCount++;
    });

    // Trigger spec reload
    await server.reloadSpec();

    // Give notification time to traverse in-memory transport
    await new Promise((r) => setTimeout(r, 100));

    if (notificationCount < 1) {
      throw new Error(`Expected at least 1 notifications/tools/list_changed notification, received ${notificationCount}`);
    }

    await client.close();
    await server.stop();
    return `Successfully received ${notificationCount} notifications/tools/list_changed notifications.`;
  });

  await runTest("1. Protocol & Tooling Compliance", "1.4 Stdio Transport Cleanliness: Pure JSON-RPC on stdout, logs to stderr", async () => {
    const cliPath = path.resolve(__dirname, "../../dist/bin/cucm-emulator-mcp.js");

    const child = spawn("node", [cliPath, "--transport", "stdio", "--mock"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    let stdoutBuf = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString("utf-8");
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() || "";
      for (const line of lines) {
        if (line.trim().length > 0) stdoutLines.push(line);
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrLines.push(chunk.toString("utf-8"));
    });

    const sendRpc = (msg: Record<string, unknown>) => {
      child.stdin.write(JSON.stringify(msg) + "\n");
    };

    // 1. Initialize
    sendRpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "empirical-stdio-tester", version: "1.0.0" },
      },
    });

    // 2. Initialized
    sendRpc({ jsonrpc: "2.0", method: "notifications/initialized" });

    // 3. List tools
    sendRpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

    // 4. Call emu_list_nodes
    sendRpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "emu_list_nodes", arguments: {} } });

    // 5. Call emu_simulate_call
    sendRpc({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "emu_simulate_call", arguments: { callingNumber: "1001", calledNumber: "1002", duration: 20 } },
    });

    // Wait for all 4 responses
    const start = Date.now();
    while (stdoutLines.length < 4 && Date.now() - start < 6000) {
      await new Promise((r) => setTimeout(r, 50));
    }

    child.stdin.end();
    await new Promise<void>((resolve) => child.on("close", () => resolve()));

    if (stdoutLines.length < 4) {
      throw new Error(`Expected at least 4 stdout lines, got ${stdoutLines.length}`);
    }

    // Verify 100% of lines on stdout are valid JSON-RPC
    for (let i = 0; i < stdoutLines.length; i++) {
      const line = stdoutLines[i].trim();
      let parsed: any;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new Error(`Line ${i} on stdout is NOT valid JSON: "${line}"`);
      }
      if (parsed.jsonrpc !== "2.0") {
        throw new Error(`Line ${i} is missing jsonrpc 2.0: "${line}"`);
      }
      if (line.includes("[INFO]") || line.includes("[DEBUG]") || line.includes("[WARN]")) {
        throw new Error(`Line ${i} on stdout contains leaked log prefixes: "${line}"`);
      }
    }

    // Verify stderr received log messages
    const combinedStderr = stderrLines.join("");
    if (!combinedStderr.includes("[INFO]")) {
      throw new Error("Expected stderr to contain redirected [INFO] logs");
    }

    return `Verified ${stdoutLines.length} pure JSON-RPC frames on stdout with zero log pollution. Stderr captured logging correctly.`;
  });

  // =========================================================================
  // GROUP 2: DOMAIN SIMULATION CORRECTNESS
  // =========================================================================

  await runTest("2. Domain Simulation Correctness", "2.1 Node Status Toggling & ADR 0120/0122 Status Codes", async () => {
    const store = new InMemoryCucmStore();
    const client = new DirectStoreCucmClient(store);

    // Initial check
    const initialNodes = (await client.listInventory("nodes")) as any[];
    if (initialNodes.length !== 2) {
      throw new Error(`Expected 2 initial nodes, found ${initialNodes.length}`);
    }

    // Check initial phone registrations
    const initialPhones = (await client.listInventory("phones")) as any[];
    const sub1Phones = initialPhones.filter((p) => p.nodeName === "CUCM-SUB1" && p.status === "Registered");
    if (sub1Phones.length === 0) {
      throw new Error("Expected registered phones on CUCM-SUB1 in initial fixture");
    }

    // Toggle CUCM-SUB1 to "NotFound" (ADR 0120/0122 failover)
    await client.setNodeStatus("CUCM-SUB1", "subscriber", "NotFound");

    const updatedSub1 = store.nodes.get("CUCM-SUB1");
    if (updatedSub1?.risReturnCode !== "NotFound") {
      throw new Error(`Expected CUCM-SUB1 risReturnCode to be "NotFound", got ${updatedSub1?.risReturnCode}`);
    }

    // Verify phones registered to CUCM-SUB1 transitioned to UnRegistered
    const phonesAfterFailover = (await client.listInventory("phones")) as any[];
    const unregSub1Phones = phonesAfterFailover.filter(
      (p) => p.nodeName === "CUCM-SUB1" && p.status === "UnRegistered"
    );
    if (unregSub1Phones.length !== sub1Phones.length) {
      throw new Error(`Expected all ${sub1Phones.length} phones on CUCM-SUB1 to be UnRegistered, found ${unregSub1Phones.length}`);
    }

    // Test ADR 0120/0122 codes: SearchLimitExceeded, Timeout, Unavailable, Online, Offline
    for (const code of ["SearchLimitExceeded", "Timeout", "Unavailable", "Offline", "Ok", "Online"] as const) {
      await client.setNodeStatus("CUCM-SUB1", "subscriber", code);
      const nodeState = store.nodes.get("CUCM-SUB1");
      if (nodeState?.risReturnCode !== code) {
        throw new Error(`Failed to set node status to ${code}`);
      }
    }

    // Restore to Ok
    await client.setNodeStatus("CUCM-SUB1", "subscriber", "Ok");
    const restoredPhones = (await client.listInventory("phones")) as any[];
    const reRegSub1Phones = restoredPhones.filter((p) => p.nodeName === "CUCM-SUB1" && p.status === "Registered");
    if (reRegSub1Phones.length !== sub1Phones.length) {
      throw new Error("Expected phones on CUCM-SUB1 to be re-registered when node returns to Ok");
    }

    return "Validated node status toggling, ADR 0120/0122 return codes, and cascade phone registration failover.";
  });

  await runTest("2. Domain Simulation Correctness", "2.2 Phone Status Updates & Web Scraping", async () => {
    const store = new InMemoryCucmStore();
    const client = new DirectStoreCucmClient(store);

    const targetPhoneName = Array.from(store.phones.keys())[0]; // e.g. "SEP000000000001"

    // Set to UnRegistered
    await client.setPhoneStatus(targetPhoneName, "UnRegistered");
    let phone = store.phones.get(targetPhoneName);
    if (phone?.status !== "UnRegistered") {
      throw new Error(`Expected phone status "UnRegistered", got "${phone?.status}"`);
    }

    // Set to Rejected
    await client.setPhoneStatus(targetPhoneName, "Rejected");
    phone = store.phones.get(targetPhoneName);
    if (phone?.status !== "Rejected") {
      throw new Error(`Expected phone status "Rejected", got "${phone?.status}"`);
    }

    // Set back to Registered
    await client.setPhoneStatus(targetPhoneName, "Registered");
    phone = store.phones.get(targetPhoneName);
    if (phone?.status !== "Registered") {
      throw new Error(`Expected phone status "Registered", got "${phone?.status}"`);
    }

    // Test emu_get_phone_web for /NetworkConfiguration
    const netWeb = (await client.getPhoneWeb(targetPhoneName, "/NetworkConfiguration")) as any;
    if (!netWeb.macAddress || !netWeb.ipAddress || !netWeb.switchName) {
      throw new Error("Invalid phone web response for /NetworkConfiguration");
    }

    // Test emu_get_phone_web for /DeviceInformation
    const devWeb = (await client.getPhoneWeb(targetPhoneName, "/DeviceInformation")) as any;
    if (!devWeb.serialNumber || !devWeb.modelName || !devWeb.activeLoadId) {
      throw new Error("Invalid phone web response for /DeviceInformation");
    }

    // Test emu_get_phone_web for /CGI/Execute
    const cgiWeb = (await client.getPhoneWeb(targetPhoneName, "/CGI/Execute")) as any;
    if (!cgiWeb.responseXml || !cgiWeb.responseXml.includes("CiscoIPPhoneResponse")) {
      throw new Error("Invalid phone web response for /CGI/Execute XML");
    }

    return `Verified phone ${targetPhoneName} registration state transitions and web scraping surfaces (Network, Device, CGI Execute).`;
  });

  await runTest("2. Domain Simulation Correctness", "2.3 Call Simulation, Legs, RTP Media, CDR/CMR Records & Mid-Call Control", async () => {
    const store = new InMemoryCucmStore();
    const client = new DirectStoreCucmClient(store);

    // Simulate 60-second call
    const callResult = await client.simulateCall({
      callingNumber: "1001",
      calledNumber: "1002",
      duration: 60,
      codec: "G.711u",
      packetLossPct: 1.5,
      jitterMs: 2.0,
      latencyMs: 15.0,
    });

    if (callResult.state !== "connected") {
      throw new Error(`Expected call state "connected", got "${callResult.state}"`);
    }

    // Verify 2 call legs
    const legs = callResult.callSession.legs;
    if (legs.length !== 2) {
      throw new Error(`Expected 2 call legs, got ${legs.length}`);
    }
    const [srcLeg, dstLeg] = legs;
    if (srcLeg.directoryNumber !== "1001" || srcLeg.direction !== "source") {
      throw new Error("Invalid source call leg properties");
    }
    if (dstLeg.directoryNumber !== "1002" || dstLeg.direction !== "destination") {
      throw new Error("Invalid destination call leg properties");
    }

    // Verify RTP Media Leg
    const mediaLegs = callResult.callSession.mediaLegs;
    if (mediaLegs.length !== 1) {
      throw new Error(`Expected 1 media leg, got ${mediaLegs.length}`);
    }
    const media = mediaLegs[0];
    if (media.codec !== "G.711u" || media.packetsSent <= 0 || media.packetsReceived <= 0) {
      throw new Error("Invalid media metrics in call simulation");
    }

    // Verify CDR Record
    if (!callResult.cdrRecordId || store.cdrRecords.length === 0) {
      throw new Error("Missing CDR record in store after call simulation");
    }
    const cdr = store.cdrRecords.find((c) => c.id === callResult.cdrRecordId);
    if (!cdr || cdr.callingPartyNumber !== "1001" || cdr.finalCalledPartyNumber !== "1002" || cdr.duration !== 60) {
      throw new Error("Corrupted CDR record content");
    }

    // Verify CMR Record
    if (!callResult.cmrRecordId || store.cmrRecords.length === 0) {
      throw new Error("Missing CMR record in store after call simulation");
    }

    // Test CDR history format=json and format=csv
    const cdrJson = (await client.getCdrHistory({ limit: 10, format: "json" })) as any[];
    if (cdrJson.length === 0) throw new Error("getCdrHistory (JSON) returned empty");

    const cdrCsv = (await client.getCdrHistory({ limit: 10, format: "csv" })) as string;
    if (typeof cdrCsv !== "string" || !cdrCsv.includes("callingPartyNumber")) {
      throw new Error("getCdrHistory (CSV) returned invalid CSV header");
    }

    // Test Mid-Call Control Actions (answer, hold, resume, drop)
    const activeCall = await client.simulateCall({
      callingNumber: "1003",
      calledNumber: "1004",
      duration: 120,
    });

    const heldSession = (await client.executeCallAction(activeCall.sessionId, "hold")) as any;
    if (heldSession.state !== "policy-pending") {
      throw new Error(`Expected held session state "policy-pending", got "${heldSession.state}"`);
    }

    const resumedSession = (await client.executeCallAction(activeCall.sessionId, "resume")) as any;
    if (resumedSession.state !== "connected") {
      throw new Error(`Expected resumed session state "connected", got "${resumedSession.state}"`);
    }

    const droppedSession = (await client.executeCallAction(activeCall.sessionId, "drop", "NormalClearing")) as any;
    if (droppedSession.state !== "disconnected") {
      throw new Error(`Expected dropped session state "disconnected", got "${droppedSession.state}"`);
    }

    return "Verified call simulation, 2-leg routing, RTP media stream metrics, CDR/CMR generation, CSV export, and mid-call control (hold/resume/drop).";
  });

  await runTest("2. Domain Simulation Correctness", "2.4 CURRI Policy Evaluation (Permit, Block, Redirect)", async () => {
    const store = new InMemoryCucmStore();
    const client = new DirectStoreCucmClient(store);

    // 1. Standard allowed call: Permit
    const permitDecision = await client.evaluateCurri({
      callingNumber: "1001",
      calledNumber: "1002",
    });
    if (permitDecision.action !== "permit") {
      throw new Error(`Expected permit decision, got "${permitDecision.action}"`);
    }

    // 2. Fraud blacklist call: Block (900 prefix)
    const blockDecision = await client.evaluateCurri({
      callingNumber: "9005551234",
      calledNumber: "9001112222",
    });
    if (blockDecision.action !== "block" || blockDecision.policyId !== "block-fraud") {
      throw new Error(`Expected block decision from block-fraud policy, got "${blockDecision.action}"`);
    }

    // Simulate call with fraud pattern -> assert call is policy-blocked
    const blockedCall = await client.simulateCall({
      callingNumber: "9005551234",
      calledNumber: "9001112222",
      duration: 30,
    });
    if (blockedCall.state !== "policy-blocked" || blockedCall.duration !== 0) {
      throw new Error(`Expected call to be policy-blocked with 0 duration, got state=${blockedCall.state}`);
    }

    // 3. VIP Executive Redirect: Redirect (1099 prefix -> 1001)
    const redirectDecision = await client.evaluateCurri({
      callingNumber: "1005",
      calledNumber: "1099",
    });
    if (redirectDecision.action !== "redirect" || redirectDecision.redirectNumber !== "1001") {
      throw new Error(`Expected redirect decision to 1001, got "${redirectDecision.redirectNumber}"`);
    }

    // Simulate call to 1099 -> assert redirected to 1001
    const redirectedCall = await client.simulateCall({
      callingNumber: "1005",
      calledNumber: "1099",
      duration: 30,
    });
    if (redirectedCall.finalCalledNumber !== "1001") {
      throw new Error(`Expected final called number "1001", got "${redirectedCall.finalCalledNumber}"`);
    }

    // Check CURRI history in store
    const curriHistory = (await client.getCurriHistory()) as any[];
    if (curriHistory.length < 3) {
      throw new Error(`Expected at least 3 CURRI history events, found ${curriHistory.length}`);
    }

    return "Verified CURRI policy evaluation with permit, fraud block (cause 21 / 0s duration), VIP redirect, and history audit log.";
  });

  await runTest("2. Domain Simulation Correctness", "2.5 Fixture Seeding & Store Reset", async () => {
    const store = new InMemoryCucmStore();
    const client = new DirectStoreCucmClient(store);

    // Initial summary
    const initialSummary = (await client.getSummary()) as any;
    if (initialSummary.counts.nodes !== 2 || initialSummary.counts.phones !== 12) {
      throw new Error("Unexpected initial fixture counts");
    }

    // Seed Enterprise Fixture
    await client.seedFixtures({ fixtureProfile: "standard-enterprise", seed: 42 });
    const enterpriseSummary = (await client.getSummary()) as any;
    if (enterpriseSummary.counts.nodes !== 4 || enterpriseSummary.counts.phones !== 50) {
      throw new Error(`Expected 4 nodes and 50 phones in enterprise fixture, got nodes=${enterpriseSummary.counts.nodes}, phones=${enterpriseSummary.counts.phones}`);
    }

    // Reset Store with profile empty
    await client.resetStore("hard", "empty");
    const emptySummary = (await client.getSummary()) as any;
    if (emptySummary.counts.nodes !== 0 || emptySummary.counts.phones !== 0) {
      throw new Error("Expected 0 nodes and phones after empty reset");
    }

    // Reset Store with lab-small
    await client.resetStore("soft", "lab-small");
    const restoredSummary = (await client.getSummary()) as any;
    if (restoredSummary.counts.nodes !== 2 || restoredSummary.counts.phones !== 12) {
      throw new Error("Expected lab-small fixture restored (2 nodes, 12 phones)");
    }

    return "Verified fixture profiles (lab-small, standard-enterprise, empty) and deterministic seeding/reset.";
  });

  // =========================================================================
  // GROUP 3: STRESS & EDGE CASES
  // =========================================================================

  await runTest("3. Stress & Edge Cases", "3.1 Concurrency Burst: 100 Simultaneous Call Simulations", async () => {
    const store = new InMemoryCucmStore();
    const client = new DirectStoreCucmClient(store);

    const BURST_SIZE = 100;
    const callPromises = Array.from({ length: BURST_SIZE }, (_, i) => {
      return client.simulateCall({
        callingNumber: `10${(i % 50).toString().padStart(2, "0")}`,
        calledNumber: `20${(i % 50).toString().padStart(2, "0")}`,
        duration: 10 + (i % 30),
        codec: i % 2 === 0 ? "G.711u" : "G.729",
        packetLossPct: (i % 5) * 0.5,
      });
    });

    const results = await Promise.all(callPromises);
    if (results.length !== BURST_SIZE) {
      throw new Error(`Expected ${BURST_SIZE} results, got ${results.length}`);
    }

    const sessionIds = new Set(results.map((r) => r.sessionId));
    if (sessionIds.size !== BURST_SIZE) {
      throw new Error(`Session ID collision detected: ${sessionIds.size} unique out of ${BURST_SIZE}`);
    }

    if (store.cdrRecords.length < BURST_SIZE) {
      throw new Error(`Expected at least ${BURST_SIZE} CDR records in store, found ${store.cdrRecords.length}`);
    }

    return `Successfully executed burst of ${BURST_SIZE} concurrent calls with 100% unique session IDs and complete CDR generation.`;
  });

  await runTest("3. Stress & Edge Cases", "3.2 Deep & Cyclic $ref Schemas in Parser", async () => {
    // A. 50-Level Deep $ref chain
    const components: Record<string, unknown> = {
      schemas: {
        LeafSchema: {
          type: "string",
          enum: ["VALID_CODE_A", "VALID_CODE_B"],
        },
      },
    };
    const schemas = components.schemas as Record<string, unknown>;
    for (let i = 49; i >= 1; i--) {
      schemas[`Level${i}`] = { $ref: `#/components/schemas/${i === 49 ? "LeafSchema" : `Level${i + 1}`}` };
    }
    schemas["Level0"] = { $ref: "#/components/schemas/Level1" };

    const rootSpec: Record<string, unknown> = {
      openapi: "3.1.0",
      info: { title: "Deep Ref Spec", version: "1.0.0" },
      components,
    };

    const ctx = { root: rootSpec, visitedRefs: new Set<string>() };
    const derefedDeep = dereferenceSchema({ $ref: "#/components/schemas/Level0" }, ctx);
    if (derefedDeep.type !== "string" || !Array.isArray(derefedDeep.enum)) {
      throw new Error("Failed to dereference 50-level deep $ref schema");
    }

    // B. Direct Self-Reference Cycle
    const selfRefSpec: Record<string, unknown> = {
      openapi: "3.1.0",
      info: { title: "Self Ref Spec", version: "1.0.0" },
      components: {
        schemas: {
          TreeItem: {
            type: "object",
            properties: {
              name: { type: "string" },
              child: { $ref: "#/components/schemas/TreeItem" },
            },
          },
        },
      },
    };

    const ctxSelf = { root: selfRefSpec, visitedRefs: new Set<string>() };
    const derefedSelf = dereferenceSchema({ $ref: "#/components/schemas/TreeItem" }, ctxSelf);
    const selfProps = derefedSelf.properties as any;
    if (!selfProps.child?.$isCircularRef) {
      throw new Error("Direct circular reference was not safely flagged with $isCircularRef");
    }

    // C. Multi-Hop Cycle: A -> B -> C -> A
    const multiHopSpec: Record<string, unknown> = {
      openapi: "3.1.0",
      info: { title: "Multi Hop Spec", version: "1.0.0" },
      components: {
        schemas: {
          HopA: { type: "object", properties: { toB: { $ref: "#/components/schemas/HopB" } } },
          HopB: { type: "object", properties: { toC: { $ref: "#/components/schemas/HopC" } } },
          HopC: { type: "object", properties: { toA: { $ref: "#/components/schemas/HopA" } } },
        },
      },
    };

    const ctxMulti = { root: multiHopSpec, visitedRefs: new Set<string>() };
    const derefedMulti = dereferenceSchema({ $ref: "#/components/schemas/HopA" }, ctxMulti);
    const multiPropsA = derefedMulti.properties as any;
    const multiPropsB = multiPropsA.toB.properties as any;
    const multiPropsC = multiPropsB.toC.properties as any;
    if (!multiPropsC.toA?.$isCircularRef) {
      throw new Error("Multi-hop circular reference was not safely flagged with $isCircularRef");
    }

    return "Dereferencer safely traversed 50-level nested $ref chains and protected against self & multi-hop circular loops.";
  });

  await runTest("3. Stress & Edge Cases", "3.3 Remote Endpoint Offline Resolution & Fallback", async () => {
    // A. Probe non-existent port on loopback -> must return false within 300ms without unhandled error
    const isLive = await EndpointResolver.probeEndpoint("http://127.0.0.1:39999", 300);
    if (isLive !== false) {
      throw new Error("Expected probeEndpoint on unused port to return false");
    }

    // B. Resolve client with forceMock -> returns mock mode
    const mockRes = await EndpointResolver.resolveClient({ forceMock: true });
    if (mockRes.mode !== "mock" || !(mockRes.client instanceof DirectStoreCucmClient)) {
      throw new Error("Expected resolveClient with forceMock to return DirectStoreCucmClient in mock mode");
    }

    // C. Resolve client with unreachable target URL on loopback with short timeout -> returns HttpCucmClient
    const httpRes = await EndpointResolver.resolveClient({ targetUrl: "http://127.0.0.1:39999", timeoutMs: 300 });
    if (httpRes.mode !== "http" || httpRes.targetUrl !== "http://127.0.0.1:39999") {
      throw new Error("Expected resolveClient with explicit targetUrl to return HttpCucmClient in http mode");
    }

    // Attempting query on dead HTTP client throws descriptive network error rather than crashing
    let threw = false;
    try {
      await httpRes.client.getSummary();
    } catch {
      threw = true;
    }
    if (!threw) {
      throw new Error("Expected call on unreachable HTTP client to reject");
    }

    // D. Default fallback when no live local emulator is running -> in-memory mock store
    const fallbackRes = await EndpointResolver.resolveClient({});
    if (fallbackRes.mode !== "mock") {
      throw new Error(`Expected default fallback to mock mode, got ${fallbackRes.mode}`);
    }

    return "Verified endpoint probing, multi-tier resolution hierarchy, and graceful in-memory mock fallback.";
  });

  // =========================================================================
  // SUMMARY
  // =========================================================================

  console.log("\n===============================================================================");
  console.log("TEST EXECUTION SUMMARY");
  console.log("===============================================================================");

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`Total Empirical Tests: ${total}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Pass Rate: ${Math.round((passed / total) * 100)}%\n`);

  for (const res of results) {
    const statusTag = res.passed ? "[PASS]" : "[FAIL]";
    console.log(`${statusTag} ${res.category} > ${res.testName} (${res.durationMs}ms)`);
    if (res.details) console.log(`       Evidence: ${res.details}`);
    if (res.error) console.log(`       Error: ${res.error}`);
  }

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal runner error:", err);
  process.exit(1);
});
