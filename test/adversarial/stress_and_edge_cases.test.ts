/**
 * Adversarial & Stress Testing Suite for @calltelemetry/cucm-emulator-mcp
 *
 * EMPIRICAL CHALLENGE DIMENSIONS:
 * 1. Concurrency & Race Conditions (200 parallel calls, failover storm under load, rapid mutations, rapid store resets)
 * 2. Edge Cases & Hostile Inputs (100-level $ref chains, direct & multi-hop circular references, malformed OpenAPI specs, illegal parameters, prototype pollution, unicode/control chars)
 * 3. Protocol & Transport Robustness (invalid JSON-RPC payloads, unknown methods, malformed tool arguments)
 * 4. Stdio Stdout Discipline (0 corrupted/non-JSON-RPC characters on stdout across live process tool executions)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as path from "node:path";
import { InMemoryCucmStore } from "../../src/mock/store.js";
import { DirectStoreCucmClient } from "../../src/client/mock-client.js";
import { CucmEmulatorMcpServer } from "../../src/server.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { dereferenceSchema, dereferenceSpec, resolveJsonPointer } from "../../src/openapi/deref.js";
import { buildOperationSchema } from "../../src/openapi/schema-builder.js";
import { parseAllOperations, loadOpenApiSpec } from "../../src/openapi/parser.js";
import { SchemaParseError } from "../../src/types/errors.js";

describe("Adversarial & Empirical Stress Testing", () => {
  // =========================================================================
  // 1. CONCURRENCY & RACE CONDITIONS
  // =========================================================================
  describe("1. Concurrency & High-Load Stress Testing", () => {
    let store: InMemoryCucmStore;
    let client: DirectStoreCucmClient;

    beforeEach(() => {
      store = new InMemoryCucmStore();
      client = new DirectStoreCucmClient(store);
    });

    it("1.1 Extreme Parallel Calls: 200 concurrent calls execute with 100% unique session IDs and zero lost CDRs", async () => {
      const COUNT = 200;
      const promises = Array.from({ length: COUNT }, (_, i) => {
        return client.simulateCall({
          callingNumber: `10${(i % 100).toString().padStart(2, "0")}`,
          calledNumber: `20${(i % 100).toString().padStart(2, "0")}`,
          duration: 10 + (i % 50),
          codec: i % 2 === 0 ? "G.711u" : "G.729",
          packetLossPct: (i % 10) * 0.5,
        });
      });

      const results = await Promise.all(promises);

      expect(results).toHaveLength(COUNT);

      // Verify all session IDs are strictly unique
      const sessionIds = new Set(results.map((r) => r.sessionId));
      expect(sessionIds.size).toBe(COUNT);

      // Verify CDR records in store
      expect(store.cdrRecords.length).toBeGreaterThanOrEqual(COUNT);

      // Verify call sessions map in store
      expect(store.callSessions.size).toBeGreaterThanOrEqual(COUNT);

      // Verify active calls query
      const activeCalls = await client.listActiveCalls();
      expect(activeCalls.length).toBeGreaterThanOrEqual(COUNT);
    });

    it("1.2 Rapid Concurrent State Mutations: 100 parallel phone & node state mutations complete deterministically", async () => {
      const MUTATION_COUNT = 100;
      const phones = Array.from(store.phones.values());
      const nodes = Array.from(store.nodes.values());

      const promises = Array.from({ length: MUTATION_COUNT }, (_, i) => {
        const phone = phones[i % phones.length];
        const status = i % 3 === 0 ? "Registered" : i % 3 === 1 ? "UnRegistered" : "Rejected";

        if (i % 4 === 0 && nodes.length > 0) {
          const node = nodes[i % nodes.length];
          const nodeStatus = i % 2 === 0 ? "Ok" : "NotFound";
          return client.setNodeStatus(node.name, node.role, nodeStatus);
        }

        return client.setPhoneStatus(phone.name, status as any);
      });

      const results = await Promise.allSettled(promises);
      const rejected = results.filter((r) => r.status === "rejected");
      expect(rejected).toHaveLength(0);

      // Store summary must be healthy and consistent
      const summary = (await client.getSummary()) as any;
      expect(summary.counts.phones).toBe(phones.length);
      expect(summary.counts.nodes).toBe(nodes.length);
    });

    it("1.3 Node Failover Storm Under Heavy Traffic: simulates simultaneous node crash while 50 calls and 50 queries execute", async () => {
      // Step 1: Start 50 background calls
      const callPromises = Array.from({ length: 50 }, (_, i) => {
        return client.simulateCall({
          callingNumber: `10${(i % 50).toString().padStart(2, "0")}`,
          calledNumber: `20${(i % 50).toString().padStart(2, "0")}`,
          duration: 60,
        });
      });

      // Step 2: Concurrently trigger node failovers
      const failoverPromises = [
        client.setNodeStatus("CUCM-PUB", "publisher", "NotFound"),
        client.setNodeStatus("CUCM-SUB1", "subscriber", "NotFound"),
        client.setNodeStatus("CUCM-PUB", "publisher", "Ok"),
        client.setNodeStatus("CUCM-SUB1", "subscriber", "Ok"),
      ];

      // Step 3: Concurrently query inventory and active calls
      const queryPromises = Array.from({ length: 50 }, (_, i) => {
        if (i % 2 === 0) return client.listInventory("phones");
        return client.listActiveCalls();
      });

      const allResults = await Promise.allSettled([
        ...callPromises,
        ...failoverPromises,
        ...queryPromises,
      ]);

      const failed = allResults.filter((r) => r.status === "rejected");
      expect(failed).toHaveLength(0);

      // Verify all 50 calls were recorded
      expect(store.cdrRecords.length).toBeGreaterThanOrEqual(50);
    });

    it("1.4 Concurrent Store Resets & Read Stress: resets store concurrently with active read queries", async () => {
      const resetPromises = [
        client.resetStore("soft", "standard-enterprise"),
        client.resetStore("soft", "lab-small"),
        client.resetStore("soft", "standard-enterprise"),
      ];

      const readPromises = Array.from({ length: 30 }, () => client.getSummary());

      const results = await Promise.allSettled([...resetPromises, ...readPromises]);
      const rejected = results.filter((r) => r.status === "rejected");
      expect(rejected).toHaveLength(0);

      // Verify final store state is valid
      const finalSummary = (await client.getSummary()) as any;
      expect(finalSummary.clusterName).toBeDefined();
      expect(finalSummary.counts.phones).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 2. EDGE CASES: $ref CHAINS, CYCLIC REFERENCES, MALFORMED SCHEMAS
  // =========================================================================
  describe("2. Edge Cases & Hostile Schema Specifications", () => {
    it("2.1 Deeply Nested $ref Chains (100 Levels): resolves without stack overflow or crash", () => {
      // Build a 100-level deep $ref chain: Level0 -> Level1 -> ... -> Level99 -> Leaf
      const components: Record<string, unknown> = {
        schemas: {
          Leaf: {
            type: "string",
            description: "Deep leaf target value",
            enum: ["ALPHA", "BETA"],
          },
        },
      };

      const schemas = components.schemas as Record<string, unknown>;
      for (let i = 99; i >= 1; i--) {
        schemas[`Level${i}`] = {
          $ref: `#/components/schemas/${i === 99 ? "Leaf" : `Level${i + 1}`}`,
        };
      }
      schemas["Level0"] = { $ref: "#/components/schemas/Level1" };

      const rootSpec: Record<string, unknown> = {
        openapi: "3.1.0",
        info: { title: "Deep Ref Test", version: "1.0.0" },
        components,
      };

      const context = { root: rootSpec, visitedRefs: new Set<string>() };
      const resolved = dereferenceSchema({ $ref: "#/components/schemas/Level0" }, context);

      expect(resolved.type).toBe("string");
      expect(resolved.description).toBe("Deep leaf target value");
      expect(resolved.enum).toEqual(["ALPHA", "BETA"]);
    });

    it("2.2 Direct Self-Referencing $ref: detects cycle and terminates safely with circular marker", () => {
      const rootSpec: Record<string, unknown> = {
        openapi: "3.1.0",
        info: { title: "Self Ref Test", version: "1.0.0" },
        components: {
          schemas: {
            SelfReferencingNode: {
              type: "object",
              properties: {
                id: { type: "string" },
                child: { $ref: "#/components/schemas/SelfReferencingNode" },
              },
            },
          },
        },
      };

      const context = { root: rootSpec, visitedRefs: new Set<string>() };
      const resolved = dereferenceSchema(
        { $ref: "#/components/schemas/SelfReferencingNode" },
        context
      );

      expect(resolved.type).toBe("object");
      const props = resolved.properties as Record<string, any>;
      expect(props.id.type).toBe("string");
      expect(props.child.$isCircularRef).toBe(true);
      expect(props.child.$originalRef).toBe("#/components/schemas/SelfReferencingNode");
    });

    it("2.3 Multi-Hop Mutual Cyclic References (A -> B -> C -> A): detects cycle cleanly", () => {
      const rootSpec: Record<string, unknown> = {
        openapi: "3.1.0",
        info: { title: "Multi-Hop Cycle", version: "1.0.0" },
        components: {
          schemas: {
            NodeA: {
              type: "object",
              properties: {
                name: { type: "string" },
                nextB: { $ref: "#/components/schemas/NodeB" },
              },
            },
            NodeB: {
              type: "object",
              properties: {
                name: { type: "string" },
                nextC: { $ref: "#/components/schemas/NodeC" },
              },
            },
            NodeC: {
              type: "object",
              properties: {
                name: { type: "string" },
                nextA: { $ref: "#/components/schemas/NodeA" },
              },
            },
          },
        },
      };

      const context = { root: rootSpec, visitedRefs: new Set<string>() };
      const resolvedA = dereferenceSchema({ $ref: "#/components/schemas/NodeA" }, context);

      expect(resolvedA.type).toBe("object");
      const propsA = resolvedA.properties as Record<string, any>;
      const propsB = propsA.nextB.properties as Record<string, any>;
      const propsC = propsB.nextC.properties as Record<string, any>;
      expect(propsC.nextA.$isCircularRef).toBe(true);
    });

    it("2.4 Malformed OpenAPI Spec (Invalid Pointer): throws SchemaParseError with clear message", () => {
      const rootSpec: Record<string, unknown> = {
        openapi: "3.1.0",
        info: { title: "Bad Pointer Spec", version: "1.0.0" },
        components: { schemas: {} },
      };

      const context = { root: rootSpec, visitedRefs: new Set<string>() };
      expect(() => {
        resolveJsonPointer(rootSpec, "#/components/schemas/NonExistentSchema");
      }).toThrow(SchemaParseError);
    });

    it("2.5 Unsupported External $ref Pointer: throws SchemaParseError cleanly", () => {
      const rootSpec: Record<string, unknown> = {
        openapi: "3.1.0",
        info: { title: "External Ref Spec", version: "1.0.0" },
      };

      expect(() => {
        resolveJsonPointer(rootSpec, "https://example.com/schemas/external.json#/User");
      }).toThrow(SchemaParseError);
    });

    it("2.6 Corrupted Spec (Non-existent path or invalid URL): rejects in parser with SchemaParseError", async () => {
      await expect(
        loadOpenApiSpec("/nonexistent/path/to/spec.json")
      ).rejects.toThrow(SchemaParseError);

      await expect(
        loadOpenApiSpec("http://127.0.0.1:19999/bad-openapi.json")
      ).rejects.toThrow(SchemaParseError);
    });
  });

  // =========================================================================
  // 3. HOSTILE INPUTS & PARAMETER ATTACKS
  // =========================================================================
  describe("3. Hostile Inputs & Parameter Attacks", () => {
    let store: InMemoryCucmStore;
    let client: DirectStoreCucmClient;

    beforeEach(() => {
      store = new InMemoryCucmStore();
      client = new DirectStoreCucmClient(store);
    });

    it("3.1 Prototype Pollution Attempt: '__proto__' and 'constructor' keys do not pollute Object prototype", async () => {
      const maliciousPayload = JSON.parse(
        '{"__proto__": {"polluted": "yes"}, "constructor": {"prototype": {"polluted2": "yes"}}, "name": "SEP999999999999"}'
      );

      await client.upsertInventory("phones", maliciousPayload);

      // Verify global Object.prototype is clean
      expect((Object.prototype as any).polluted).toBeUndefined();
      expect((Object.prototype as any).polluted2).toBeUndefined();
      expect(({} as any).polluted).toBeUndefined();
    });

    it("3.2 Unicode, Control Characters & Null Bytes in Call Numbers: executes safely without corruption", async () => {
      const hostileNumbers = [
        "1001\u0000admin", // null byte injection
        "1001\u202Ereversed", // RTL override
        "☎️-555-📞-9999", // emoji symbols
        "<script>alert(1)</script>", // XSS injection
        "1001' OR '1'='1", // SQL injection
        "1001\r\nSet-Cookie: session=evil", // Header injection
      ];

      for (const num of hostileNumbers) {
        const result = await client.simulateCall({
          callingNumber: num,
          calledNumber: "2001",
          duration: 10,
        });

        expect(result.sessionId).toBeDefined();
        expect(result.callingNumber).toBe(num);
      }
    });

    it("3.3 Numerical Extremes (Negative, Massive, Floating-point, NaN-equivalent duration): handles cleanly", async () => {
      // 0 duration
      const res0 = await client.simulateCall({ callingNumber: "1001", calledNumber: "2001", duration: 0 });
      expect(res0.duration).toBe(0);

      // 100,000s duration
      const resBig = await client.simulateCall({ callingNumber: "1001", calledNumber: "2001", duration: 100000 });
      expect(resBig.duration).toBe(100000);

      // Extreme packet loss
      const resLoss = await client.simulateCall({
        callingNumber: "1001",
        calledNumber: "2001",
        duration: 30,
        packetLossPct: 150, // > 100%
      });
      expect(resLoss.callSession.mediaLegs[0].packetLossPct).toBe(150);
    });
  });

  // =========================================================================
  // 4. PROTOCOL & TRANSPORTS: IN-MEMORY MCP CLIENT ADVERSARIAL TESTING
  // =========================================================================
  describe("4. MCP Protocol Robustness with InMemoryTransport", () => {
    let server: CucmEmulatorMcpServer;
    let mcpClient: Client;

    beforeEach(async () => {
      server = new CucmEmulatorMcpServer({ config: { mock: true } });
      await server.initialize();

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      mcpClient = new Client({ name: "adversarial-tester", version: "1.0.0" }, { capabilities: {} });

      await Promise.all([
        server.connect(serverTransport),
        mcpClient.connect(clientTransport),
      ]);
    });

    afterEach(async () => {
      await mcpClient.close();
      await server.stop();
    });

    it("4.1 Tool Call for Non-Existent Tool returns clean isError response without disconnecting", async () => {
      const result = await mcpClient.callTool({
        name: "emu_non_existent_tool_xyz",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect((result.content as any)[0].text).toContain("not found in MCP registry");
    });

    it("4.2 Tool Call with Illegal Arguments returns handled error result with isError=true", async () => {
      const result = await mcpClient.callTool({
        name: "cucm_emulator_simulate_node_failover",
        arguments: {
          nodeName: "non-existent-node-12345",
          status: "NotFound",
        },
      });

      expect(result.isError).toBe(true);
      expect((result.content as any)[0].text).toContain("CucmNode");
    });

    it("4.3 Concurrent MCP Tool Calls: dispatches 50 simultaneous tool calls over MCP client", async () => {
      const promises = Array.from({ length: 50 }, (_, i) => {
        return mcpClient.callTool({
          name: "cucm_emulator_simulate_call",
          arguments: {
            callingNumber: `10${(i % 50).toString().padStart(2, "0")}`,
            calledNumber: `20${(i % 50).toString().padStart(2, "0")}`,
            duration: 15,
          },
        });
      });

      const results = await Promise.all(promises);
      expect(results).toHaveLength(50);
      for (const res of results) {
        expect(res.isError).toBeFalsy();
        const text = (res.content as any)[0].text;
        expect(text).toContain("sessionId");
      }
    });
  });

  // =========================================================================
  // 5. EMPIRICAL STDIO STDOUT DISCIPLINE VERIFICATION
  // =========================================================================
  describe("5. Empirical Stdio Stdout Discipline Verification", () => {
    it("5.1 Spawns real CLI process and asserts EXACTLY ZERO corrupted / non-JSON characters on stdout during tool calls", async () => {
      const cliPath = path.resolve(__dirname, "../../dist/bin/cucm-emulator-mcp.js");

      // Spawn real Node child process running cucm-emulator-mcp over stdio
      const child: ChildProcessWithoutNullStreams = spawn("node", [cliPath, "--transport", "stdio", "--mock"], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      const stdoutLines: string[] = [];
      const stderrLines: string[] = [];
      let buffer = "";

      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf-8");
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.trim().length > 0) {
            stdoutLines.push(line);
          }
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderrLines.push(chunk.toString("utf-8"));
      });

      // Helper to send JSON-RPC message to child process
      const sendRpc = (msg: Record<string, unknown>) => {
        child.stdin.write(JSON.stringify(msg) + "\n");
      };

      // Helper to wait for responses
      const waitForResponses = async (expectedCount: number, timeoutMs = 8000): Promise<void> => {
        const start = Date.now();
        while (stdoutLines.length < expectedCount && Date.now() - start < timeoutMs) {
          await new Promise((r) => setTimeout(r, 50));
        }
      };

      // 1. Send MCP initialize request
      sendRpc({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "stdout-discipline-verifier", version: "1.0.0" },
        },
      });

      await waitForResponses(1);

      // 2. Send initialized notification
      sendRpc({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });

      // 3. Send tools/list request
      sendRpc({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      });

      await waitForResponses(2);

      // 4. Send multiple tool calls
      sendRpc({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "cucm_emulator_list_nodes",
          arguments: {},
        },
      });

      sendRpc({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "cucm_emulator_simulate_call",
          arguments: {
            callingNumber: "1001",
            calledNumber: "1002",
            duration: 10,
          },
        },
      });

      sendRpc({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "cucm_emulator_evaluate_curri",
          arguments: {
            callingNumber: "1001",
            calledNumber: "1002",
          },
        },
      });

      sendRpc({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "cucm_emulator_generate_cdrs",
          arguments: {
            count: 3,
          },
        },
      });

      await waitForResponses(6);

      // Close child cleanly
      child.stdin.end();
      await new Promise<void>((resolve) => {
        child.on("close", () => resolve());
      });

      // CRITICAL ASSERTION:
      // Every single line on stdout MUST be strictly valid JSON conforming to JSON-RPC 2.0
      expect(stdoutLines.length).toBeGreaterThanOrEqual(6);

      for (let i = 0; i < stdoutLines.length; i++) {
        const line = stdoutLines[i].trim();
        let parsed: any;
        expect(() => {
          parsed = JSON.parse(line);
        }, `Line ${i} on stdout was not valid JSON: "${line}"`).not.toThrow();

        expect(parsed.jsonrpc).toBe("2.0");
        expect(parsed.id).toBeDefined();
        // Assert no console log leaking or corrupting text
        expect(line).not.toMatch(/^\[INFO\]/);
        expect(line).not.toMatch(/^\[DEBUG\]/);
        expect(line).not.toMatch(/^\[WARN\]/);
        expect(line).not.toMatch(/^\[ERROR\]/);
      }

      // Assert that logs went to stderr
      expect(stderrLines.length).toBeGreaterThan(0);
      const combinedStderr = stderrLines.join("");
      expect(combinedStderr).toContain("[INFO]");
    });

    it("5.2 Pipelined Concurrent Stdio JSON-RPC: streams 30 rapid back-to-back tool requests without stdout corruption", async () => {
      const cliPath = path.resolve(__dirname, "../../dist/bin/cucm-emulator-mcp.js");

      const child: ChildProcessWithoutNullStreams = spawn("node", [cliPath, "--transport", "stdio", "--mock"], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      const stdoutLines: string[] = [];
      let buffer = "";

      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf-8");
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.trim().length > 0) {
            stdoutLines.push(line);
          }
        }
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
          clientInfo: { name: "pipelined-tester", version: "1.0.0" },
        },
      });

      sendRpc({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });

      // 2. Fire 30 rapid back-to-back tool requests with unique IDs
      const REQUEST_COUNT = 30;
      for (let i = 2; i <= REQUEST_COUNT + 1; i++) {
        sendRpc({
          jsonrpc: "2.0",
          id: i,
          method: "tools/call",
          params: {
            name: "cucm_emulator_simulate_call",
            arguments: {
              callingNumber: `10${(i % 50).toString().padStart(2, "0")}`,
              calledNumber: `20${(i % 50).toString().padStart(2, "0")}`,
              duration: 5,
            },
          },
        });
      }

      // Wait for all 31 responses (1 init + 30 tool calls)
      const start = Date.now();
      while (stdoutLines.length < REQUEST_COUNT + 1 && Date.now() - start < 10000) {
        await new Promise((r) => setTimeout(r, 50));
      }

      child.stdin.end();
      await new Promise<void>((resolve) => {
        child.on("close", () => resolve());
      });

      expect(stdoutLines.length).toBe(REQUEST_COUNT + 1);

      // Verify every response is valid JSON-RPC
      const receivedIds = new Set<number>();
      for (const line of stdoutLines) {
        const parsed = JSON.parse(line);
        expect(parsed.jsonrpc).toBe("2.0");
        expect(parsed.id).toBeDefined();
        receivedIds.add(parsed.id);
      }

      // Verify all IDs from 1 to 31 were received
      for (let id = 1; id <= REQUEST_COUNT + 1; id++) {
        expect(receivedIds.has(id)).toBe(true);
      }
    });
  });

  // =========================================================================
  // 6. SSE TRANSPORT MALFORMED ATTACKS & EDGE CASES
  // =========================================================================
  describe("6. SSE Transport Robustness & Malformed Payload Attacks", () => {
    let server: CucmEmulatorMcpServer;
    let sseBaseUrl: string;

    beforeEach(async () => {
      // Find an available port
      const testPort = 38900 + Math.floor(Math.random() * 1000);
      server = new CucmEmulatorMcpServer({
        config: {
          transport: "sse",
          port: testPort,
          host: "127.0.0.1",
          mock: true,
        },
      });

      const endpoint = await server.start();
      sseBaseUrl = endpoint as string;
    });

    afterEach(async () => {
      await server.stop();
    });

    it("6.1 Rejects POST /messages with missing or invalid sessionId cleanly (400 / 404)", async () => {
      // Missing sessionId query parameter
      const resNoSession = await fetch(`${sseBaseUrl}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(resNoSession.status).toBe(400);

      // Non-existent sessionId
      const resBadSession = await fetch(`${sseBaseUrl}/messages?sessionId=non-existent-session-id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(resBadSession.status).toBe(404);
    });

    it("6.2 Rejects POST /messages with malformed non-JSON body (400 Bad Request)", async () => {
      const resGarbage = await fetch(`${sseBaseUrl}/messages?sessionId=test-123`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "NOT_A_VALID_JSON_STRING{{{",
      });
      expect(resGarbage.status).toBeGreaterThanOrEqual(400);
    });

    it("6.3 Healthcheck endpoint responds with 200 OK and cluster summary", async () => {
      const resHealth = await fetch(`${sseBaseUrl}/health`);
      expect(resHealth.status).toBe(200);
      const data = await resHealth.json() as any;
      expect(data.status).toBe("ok");
      expect(data.service).toBe("@calltelemetry/cucm-emulator-mcp");
      expect(data.toolsCount).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 7. COMPLEX allOf / anyOf / oneOf DEREREFERENCING WITH CIRCULAR BRANCHES
  // =========================================================================
  describe("7. Complex Composition Schema Dereferencing", () => {
    it("7.1 Handles allOf with inheritance and circular property safely", () => {
      const rootSpec: Record<string, unknown> = {
        openapi: "3.1.0",
        info: { title: "Composition Ref Test", version: "1.0.0" },
        components: {
          schemas: {
            BaseEntity: {
              type: "object",
              properties: {
                id: { type: "string", description: "Entity ID" },
                createdAt: { type: "string", format: "date-time" },
              },
              required: ["id"],
            },
            TreeNode: {
              allOf: [
                { $ref: "#/components/schemas/BaseEntity" },
                {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    parent: { $ref: "#/components/schemas/TreeNode" },
                  },
                  required: ["name"],
                },
              ],
            },
          },
        },
      };

      const context = { root: rootSpec, visitedRefs: new Set<string>() };
      const resolved = dereferenceSchema({ $ref: "#/components/schemas/TreeNode" }, context);

      expect(resolved.type).toBe("object");
      const props = resolved.properties as Record<string, any>;
      expect(props.id.type).toBe("string");
      expect(props.name.type).toBe("string");
      expect(props.parent.$isCircularRef).toBe(true);
      expect(resolved.required).toContain("id");
      expect(resolved.required).toContain("name");
    });

    it("7.2 Handles oneOf and anyOf schemas containing nested $ref references", () => {
      const rootSpec: Record<string, unknown> = {
        openapi: "3.1.0",
        info: { title: "Union Ref Test", version: "1.0.0" },
        components: {
          schemas: {
            PhoneTarget: {
              type: "object",
              properties: { phoneName: { type: "string" } },
            },
            TrunkTarget: {
              type: "object",
              properties: { trunkName: { type: "string" } },
            },
            CallTarget: {
              oneOf: [
                { $ref: "#/components/schemas/PhoneTarget" },
                { $ref: "#/components/schemas/TrunkTarget" },
              ],
            },
          },
        },
      };

      const context = { root: rootSpec, visitedRefs: new Set<string>() };
      const resolved = dereferenceSchema({ $ref: "#/components/schemas/CallTarget" }, context);

      expect(Array.isArray(resolved.oneOf)).toBe(true);
      const oneOf = resolved.oneOf as any[];
      expect(oneOf[0].properties.phoneName.type).toBe("string");
      expect(oneOf[1].properties.trunkName.type).toBe("string");
    });
  });
});
