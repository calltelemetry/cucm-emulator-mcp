/**
 * Tier 2: Boundary & Corner Cases (Negative Validation & Resilience)
 *
 * Verifies strict JSON Schema validation, illegal enums, non-existent entity lookups,
 * numerical boundary extremes, protocol error handling, and injection prevention.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { InMemoryCucmStore } from "../../src/mock/store.js";
import { DirectStoreCucmClient } from "../../src/client/mock-client.js";
import { HttpCucmClient } from "../../src/client/http-client.js";
import { MockCucmServer } from "../helpers/mock-cucm-server.js";
import {
  EntityNotFoundError,
  InvalidStateError,
  ValidationError,
  ToolExecutionError,
  EndpointUnreachableError,
} from "../../src/types/errors.js";

describe("Tier 2: Boundary & Corner Cases", () => {
  let store: InMemoryCucmStore;
  let directClient: DirectStoreCucmClient;
  let mockServer: MockCucmServer;
  let httpClient: HttpCucmClient;

  beforeEach(async () => {
    store = new InMemoryCucmStore();
    directClient = new DirectStoreCucmClient(store);

    mockServer = new MockCucmServer({ seedProfile: "lab-small" });
    const baseUrl = await mockServer.start();
    httpClient = new HttpCucmClient({ targetUrl: baseUrl, timeoutMs: 3000, maxRetries: 1 });
  });

  afterEach(async () => {
    await mockServer.stop();
  });

  // =========================================================================
  // 1. Non-Existent Entity Lookups & Mutations
  // =========================================================================
  describe("1. Non-Existent Entity Lookups & Mutations", () => {
    it("1.1 rejects status update on non-existent cluster node", async () => {
      await expect(
        directClient.setNodeStatus("cucm-nonexistent-node-999", "subscriber", "NotFound")
      ).rejects.toThrow(EntityNotFoundError);
    });

    it("1.2 rejects status update on non-existent phone", async () => {
      await expect(
        directClient.setPhoneStatus("SEP999999999999", "UnRegistered")
      ).rejects.toThrow(EntityNotFoundError);
    });

    it("1.3 rejects call action on non-existent call session ID", async () => {
      await expect(
        directClient.executeCallAction("call-session-fake-uuid", "hold")
      ).rejects.toThrow(EntityNotFoundError);
    });

    it("1.4 rejects inventory item query for non-existent ID", async () => {
      await expect(
        directClient.getInventoryItem("phones", "SEP000000000000")
      ).rejects.toThrow(EntityNotFoundError);
    });

    it("1.5 HTTP backend: returns 404 for non-existent phone web scrape", async () => {
      await expect(
        httpClient.getPhoneWeb("SEP000000000000", "/CGI/Execute", "xml")
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // 2. Illegal Enums & Unsupported Operations
  // =========================================================================
  describe("2. Illegal Enums & Unsupported Operations", () => {
    it("2.1 rejects unsupported call action (e.g. 'fly' / 'dance')", async () => {
      const call = await directClient.simulateCall({
        callingNumber: "1001",
        calledNumber: "1002",
        duration: 30,
      });

      await expect(
        directClient.executeCallAction(call.sessionId, "dance" as any)
      ).rejects.toThrow(InvalidStateError);
    });

    it("2.2 rejects resuming a call that is already connected", async () => {
      const call = await directClient.simulateCall({
        callingNumber: "1001",
        calledNumber: "1002",
        duration: 30,
      });

      // Call is already connected, cannot resume
      await expect(
        directClient.executeCallAction(call.sessionId, "resume")
      ).rejects.toThrow(InvalidStateError);
    });

    it("2.3 rejects holding a call that is already disconnected", async () => {
      const call = await directClient.simulateCall({
        callingNumber: "1001",
        calledNumber: "1002",
        duration: 30,
      });

      await directClient.executeCallAction(call.sessionId, "drop");

      await expect(
        directClient.executeCallAction(call.sessionId, "hold")
      ).rejects.toThrow(InvalidStateError);
    });

    it("2.4 rejects dropping a call that has already been dropped", async () => {
      const call = await directClient.simulateCall({
        callingNumber: "1001",
        calledNumber: "1002",
        duration: 30,
      });

      await directClient.executeCallAction(call.sessionId, "drop");

      await expect(
        directClient.executeCallAction(call.sessionId, "drop")
      ).rejects.toThrow(InvalidStateError);
    });

    it("2.5 rejects inventory upsert missing mandatory identifying key", async () => {
      await expect(
        directClient.upsertInventory("phones", { description: "Nameless Phone" })
      ).rejects.toThrow(InvalidStateError);
    });
  });

  // =========================================================================
  // 3. Numerical Boundaries & Edge Cases
  // =========================================================================
  describe("3. Numerical Boundaries & Edge Cases", () => {
    it("3.1 handles 0-duration instantaneous call simulation", async () => {
      const result = await directClient.simulateCall({
        callingNumber: "1001",
        calledNumber: "1002",
        duration: 0,
      });

      expect(result.duration).toBe(0);
      expect(result.callSession.mediaLegs[0].packetsSent).toBe(0);
    });

    it("3.2 handles empty store clearing ('empty' profile)", async () => {
      const resetResult = (await directClient.resetStore("soft", "empty")) as any;
      expect(resetResult.status).toBe("success");

      const summary = (await directClient.getSummary()) as any;
      expect(summary.counts.phones).toBe(0);
      expect(summary.counts.nodes).toBe(0);
    });

    it("3.3 handles pagination boundaries with offset beyond inventory length", async () => {
      const items = (await directClient.listInventory("phones", { offset: 1000, limit: 10 })) as any[];
      expect(items).toHaveLength(0);
    });

    it("3.4 handles 0-count CDR generation request gracefully", async () => {
      const result = await directClient.generateCdrs({ count: 0 });
      expect(result.generatedCount).toBe(0);
      expect(result.cdrRecords).toHaveLength(0);
    });

    it("3.5 handles 100% packet loss media degradation", async () => {
      const result = await directClient.simulateCall({
        callingNumber: "1001",
        calledNumber: "1002",
        duration: 20,
        packetLossPct: 100,
      });

      expect(result.callSession.mediaLegs[0].packetLossPct).toBe(100);
      expect(result.callSession.mediaLegs[0].packetsReceived).toBe(0);
    });
  });

  // =========================================================================
  // 4. Injection Safety & Special Characters
  // =========================================================================
  describe("4. Injection Safety & Special Characters", () => {
    it("4.1 safely handles SQL injection payloads in query strings", async () => {
      const result = (await httpClient.executeGenericOperation("POST", "/api/sql", {
        query: "SELECT * FROM device WHERE name = 'SEP000000000001' OR '1'='1'; DROP TABLE device; --",
      })) as any;

      expect(result.rows).toBeDefined();
      // Verifies SQL payload didn't drop data
      const phones = (await httpClient.listInventory("phones")) as any[];
      expect(phones.length).toBeGreaterThan(0);
    });

    it("4.2 handles directory traversal and path characters in phone web requests", async () => {
      const phones = (await directClient.listInventory("phones")) as any[];
      const phoneName = phones[0].name;

      const response = await directClient.getPhoneWeb(phoneName, "../../../../etc/passwd", "xml");
      expect(response).toBeDefined();
    });

    it("4.3 handles special characters and symbols in calling party numbers", async () => {
      const result = await directClient.simulateCall({
        callingNumber: "+1-(800)-555-0199#*2",
        calledNumber: "1002",
        duration: 10,
      });

      expect(result.callingNumber).toBe("+1-(800)-555-0199#*2");
      expect(result.sessionId).toBeDefined();
    });

    it("4.4 handles Unicode and non-ASCII characters in device descriptions", async () => {
      const customDevice = {
        name: "SEP999888777666",
        description: "Тестовый Телефон ☎️ (Floor 3 - Büro)",
        model: "Cisco 8845",
        status: "Registered",
        ipAddress: "192.168.125.200",
      };

      const upserted = (await directClient.upsertInventory("phones", customDevice)) as any;
      expect(upserted.description).toBe("Тестовый Телефон ☎️ (Floor 3 - Büro)");

      const fetched = (await directClient.getInventoryItem("phones", "SEP999888777666")) as any;
      expect(fetched.description).toBe("Тестовый Телефон ☎️ (Floor 3 - Büro)");
    });
  });

  // =========================================================================
  // 5. Network Faults & Resilience
  // =========================================================================
  describe("5. Network Faults & Resilience", () => {
    it("5.1 raises EndpointUnreachableError when target server is down", async () => {
      const unreachableClient = new HttpCucmClient({
        targetUrl: "http://127.0.0.1:19999",
        timeoutMs: 500,
        maxRetries: 1,
      });

      await expect(unreachableClient.getSummary()).rejects.toThrow(EndpointUnreachableError);
    });

    it("5.2 handles server 500 internal errors cleanly", async () => {
      mockServer.setFailureMode("/api/v2/summary", 500, { error: "Fatal Internal Database Error" });

      await expect(httpClient.getSummary()).rejects.toThrow(EndpointUnreachableError);
    });

    it("5.3 handles 401 Unauthorized errors when invalid auth token is provided", async () => {
      const authedServer = new MockCucmServer({ authTokens: ["secret-token-xyz"] });
      const authedUrl = await authedServer.start();

      const badAuthClient = new HttpCucmClient({
        targetUrl: authedUrl,
        authToken: "wrong-token-abc",
        timeoutMs: 1000,
        maxRetries: 1,
      });

      await expect(badAuthClient.getSummary()).rejects.toThrow();
      await authedServer.stop();
    });

    it("5.4 recovers cleanly after transient HTTP failure rule is removed", async () => {
      mockServer.setFailureMode("/api/v2/summary", 503, { error: "Service Temporarily Unavailable" });

      await expect(httpClient.getSummary()).rejects.toThrow();

      mockServer.clearFailureModes();

      const summary = (await httpClient.getSummary()) as any;
      expect(summary.nodesCount).toBeGreaterThan(0);
    });
  });
});
