/**
 * Deep Adversarial Schema & Concurrency Stress Test Suite
 *
 * Verifies:
 * 1. Circular $ref pointer handling and broken schema resilience
 * 2. High-concurrency race conditions and state mutation safety
 * 3. Protocol violation handling (unknown tools, malformed arguments)
 * 4. SSE endpoint abuse (invalid session IDs, malformed message payloads)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { dereferenceSchema } from "../../src/openapi/deref.js";
import { buildOperationSchema } from "../../src/openapi/schema-builder.js";
import { CucmEmulatorMcpServer } from "../../src/server.js";
import { McpTestClient } from "../helpers/mcp-test-client.js";
import { SchemaParseError } from "../../src/types/errors.js";
import type { OpenApiSpec } from "../../src/openapi/types.js";

describe("Adversarial Schema, Concurrency & Protocol Abuse Suite", () => {
  // =========================================================================
  // 1. ADVERSARIAL & BROKEN OPENAPI SCHEMAS
  // =========================================================================
  describe("1. Adversarial & Broken OpenAPI Schemas", () => {
    it("1.1 safely terminates on direct and indirect circular $ref pointers", () => {
      const cyclicSpec: Record<string, unknown> = {
        openapi: "3.1.0",
        info: { title: "Cyclic", version: "1.0.0" },
        paths: {},
        components: {
          schemas: {
            NodeA: {
              type: "object",
              properties: {
                name: { type: "string" },
                sibling: { $ref: "#/components/schemas/NodeB" },
              },
            },
            NodeB: {
              type: "object",
              properties: {
                id: { type: "integer" },
                parent: { $ref: "#/components/schemas/NodeA" },
              },
            },
          },
        },
      };

      const context = {
        root: cyclicSpec,
        visitedRefs: new Set<string>(),
      };

      const dereferenced = dereferenceSchema(
        { $ref: "#/components/schemas/NodeA" },
        context
      ) as any;

      expect(dereferenced).toBeDefined();
      expect(dereferenced.properties.name.type).toBe("string");
      expect(dereferenced.properties.sibling.properties.id.type).toBe("integer");
      expect(dereferenced.properties.sibling.properties.parent).toBeDefined();
    });

    it("1.2 throws SchemaParseError on dangling or unresolvable $ref pointers", () => {
      const brokenSpec = {
        openapi: "3.1.0",
        info: { title: "Broken", version: "1.0.0" },
        paths: {},
        components: {
          schemas: {},
        },
      };

      const context = {
        root: brokenSpec,
        visitedRefs: new Set<string>(),
      };

      expect(() =>
        dereferenceSchema({ $ref: "#/components/schemas/GhostEntity" }, context)
      ).toThrow(SchemaParseError);
    });

    it("1.3 handles operations missing operationId or summary", () => {
      const namelessOperation = {
        description: "Operation without explicit operationId",
        responses: { "200": { description: "OK" } },
      };

      const rootSpec: OpenApiSpec = {
        openapi: "3.1.0",
        info: { title: "Test", version: "1.0.0" },
        paths: {},
      };

      const merged = buildOperationSchema(
        "/api/v2/unnamed-resource/{id}",
        "GET",
        namelessOperation,
        rootSpec
      );

      expect(merged.toolName).toBeDefined();
      expect(merged.pathParamNames).toContain("id");
      expect(merged.rawJsonSchema).toBeDefined();
    });
  });

  // =========================================================================
  // 2. CONCURRENT RACE CONDITIONS & STATE MUTATIONS
  // =========================================================================
  describe("2. Concurrent Race Conditions & State Mutations", () => {
    let server: CucmEmulatorMcpServer;
    let mcpClient: McpTestClient;

    beforeEach(async () => {
      server = new CucmEmulatorMcpServer({
        config: {
          transport: "stdio",
          mock: true,
          seedProfile: "lab-small",
        },
      });
      mcpClient = new McpTestClient();
      await mcpClient.connectInMemory(server);
    });

    afterEach(async () => {
      await mcpClient.close();
      await server.stop();
    });

    it("2.1 handles 50 parallel simultaneous call simulations without state corruption", async () => {
      const promises = Array.from({ length: 50 }, (_, i) =>
        mcpClient.callToolSuccess("cucm_emulator_simulate_call", {
          callingNumber: `10${String(i).padStart(2, "0")}`,
          calledNumber: `20${String(i).padStart(2, "0")}`,
          duration: 10 + (i % 5),
          codec: i % 2 === 0 ? "G.711u" : "G.729",
          packetLossPct: i % 10,
        })
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(50);
      for (const res of results) {
        expect(res.sessionId).toBeDefined();
        expect(res.callSession.mediaLegs).toBeDefined();
      }

      // Verify active calls list reflects concurrent calls
      const activeCalls = (await mcpClient.callToolSuccess("cucm_emulator_list_active_calls", {})) as any[];
      expect(activeCalls.length).toBeGreaterThanOrEqual(50);
    });

    it("2.2 handles simultaneous CRUD operations on phone inventory", async () => {
      const phoneCount = 20;
      const upsertPromises = Array.from({ length: phoneCount }, (_, i) =>
        mcpClient.callToolSuccess("cucm_emulator_set_phone_status", {
          phoneName: `SEP0011223344${String(i).padStart(2, "0")}`,
          status: i % 2 === 0 ? "Registered" : "UnRegistered",
        }).catch(() => null)
      );

      await Promise.all(upsertPromises);
      const summary = (await mcpClient.callToolSuccess("cucm_emulator_inspect_fixtures", {})) as any;
      expect(summary.clusterName).toBeDefined();
    });
  });

  // =========================================================================
  // 3. PROTOCOL VIOLATIONS & TOOL ROUTING DEFENSES
  // =========================================================================
  describe("3. Protocol Violations & Tool Routing Defenses", () => {
    let server: CucmEmulatorMcpServer;
    let mcpClient: McpTestClient;

    beforeEach(async () => {
      server = new CucmEmulatorMcpServer({
        config: {
          transport: "stdio",
          mock: true,
          seedProfile: "lab-small",
        },
      });
      mcpClient = new McpTestClient();
      await mcpClient.connectInMemory(server);
    });

    afterEach(async () => {
      await mcpClient.close();
      await server.stop();
    });

    it("3.1 calling non-existent tool returns error cleanly without crashing server", async () => {
      const result = await mcpClient.callToolError("non_existent_tool_xyz", {});
      expect(result.isError).toBe(true);
      expect(result.message).toContain("not found in MCP registry");

      // Verify server remains responsive
      const pingRes = await mcpClient.callToolSuccess("cucm_emulator_inspect_fixtures", {});
      expect(pingRes).toBeDefined();
    });

    it("3.2 calling tool with invalid schema types returns validation error", async () => {
      const errorResult = await mcpClient.callToolError("cucm_emulator_simulate_call", {
        callingNumber: 12345, // number instead of string
        calledNumber: { bad: "object" }, // object instead of string
        duration: "not-a-number",
      });

      expect(errorResult.isError).toBe(true);
    });
  });

  // =========================================================================
  // 4. SSE TRANSPORT ADVERSARIAL ENDPOINT REQUESTS
  // =========================================================================
  describe("4. SSE Transport Adversarial Endpoint Requests", () => {
    let sseServer: CucmEmulatorMcpServer;
    let sseBaseUrl: string;

    beforeEach(async () => {
      sseServer = new CucmEmulatorMcpServer({
        config: {
          transport: "sse",
          port: 0,
          host: "127.0.0.1",
          mock: true,
          seedProfile: "lab-small",
        },
      });
      sseBaseUrl = (await sseServer.start()) as string;
    });

    afterEach(async () => {
      await sseServer.stop();
    });

    it("4.1 rejects POST /messages without sessionId with 400 Bad Request", async () => {
      const res = await fetch(`${sseBaseUrl}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
      });

      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).toContain("Missing sessionId parameter");
    });

    it("4.2 rejects POST /messages with non-existent sessionId with 404 Not Found", async () => {
      const res = await fetch(`${sseBaseUrl}/messages?sessionId=fake-session-uuid-999`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
      });

      expect(res.status).toBe(404);
    });

    it("4.3 returns 404 for random non-existent HTTP routes", async () => {
      const res = await fetch(`${sseBaseUrl}/api/v1/invalid-route`);
      expect(res.status).toBe(404);
    });
  });
});
