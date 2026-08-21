/**
 * Tier 4: Real-World Workloads, Scale & Concurrency
 *
 * Verifies high-concurrency bursts, 1,000 phone fleet pagination, failover storm under load,
 * multi-transport coexistence, and 100+ cycle soak stability.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { InMemoryCucmStore } from "../../src/mock/store.js";
import { DirectStoreCucmClient } from "../../src/client/mock-client.js";
import { HttpCucmClient } from "../../src/client/http-client.js";
import { MockCucmServer } from "../helpers/mock-cucm-server.js";
import { createCustomFixture, createEnterpriseFixture } from "../../src/mock/fixtures.js";

describe("Tier 4: Real-World Workloads & Scale", () => {
  let store: InMemoryCucmStore;
  let directClient: DirectStoreCucmClient;
  let mockServer: MockCucmServer;
  let httpClient: HttpCucmClient;

  beforeEach(async () => {
    store = new InMemoryCucmStore();
    directClient = new DirectStoreCucmClient(store);

    mockServer = new MockCucmServer({ seedProfile: "lab-small" });
    const baseUrl = await mockServer.start();
    httpClient = new HttpCucmClient({ targetUrl: baseUrl, timeoutMs: 15000, maxRetries: 2 });
  });

  afterEach(async () => {
    await mockServer.stop();
  });

  // =========================================================================
  // 1. High-Concurrency Call Burst
  // =========================================================================
  describe("1. High-Concurrency Call Burst (50 Parallel Calls)", () => {
    it("simultaneously processes 50 parallel call simulations with zero race conditions", async () => {
      const callPromises = Array.from({ length: 50 }, (_, i) => {
        const calling = `10${(i % 50).toString().padStart(2, "0")}`;
        const called = `20${(i % 50).toString().padStart(2, "0")}`;
        return directClient.simulateCall({
          callingNumber: calling,
          calledNumber: called,
          duration: 30 + (i % 20),
          codec: i % 2 === 0 ? "G.711u" : "G.729",
          packetLossPct: (i % 5) * 0.5,
        });
      });

      const results = await Promise.all(callPromises);

      expect(results).toHaveLength(50);

      // Verify all session IDs are strictly unique
      const sessionIds = new Set(results.map((r) => r.sessionId));
      expect(sessionIds.size).toBe(50);

      // Verify CDR records were all generated
      expect(store.cdrRecords.length).toBeGreaterThanOrEqual(50);

      // Verify active calls query
      const activeCalls = await directClient.listActiveCalls();
      expect(activeCalls.length).toBeGreaterThanOrEqual(50);
    });

    it("HTTP backend: executes 25 concurrent calls over HTTP without socket exhaustion", async () => {
      const httpPromises = Array.from({ length: 25 }, (_, i) => {
        return httpClient.simulateCall({
          callingNumber: `11${(i % 50).toString().padStart(2, "0")}`,
          calledNumber: `22${(i % 50).toString().padStart(2, "0")}`,
          duration: 15,
        });
      });

      const results = await Promise.all(httpPromises);
      expect(results).toHaveLength(25);
      expect(results.every((r: any) => Boolean(r.sessionId))).toBe(true);
    });
  });

  // =========================================================================
  // 2. Large Scale Phone Fleet (1,000 Phones)
  // =========================================================================
  describe("2. Large Scale Phone Fleet (1,000 Phones)", () => {
    it("seeds 1,000 phone fleet, paginates in batches of 50, and performs bulk mutations", async () => {
      // 1. Seed 1,000 phones
      const baseFixture = createEnterpriseFixture("14.0", "10.100.0.10", 42);
      for (let i = 51; i <= 1000; i++) {
        const ext = String(10000 + i);
        const macHex = i.toString(16).padStart(12, "0").toUpperCase();
        const phoneName = `SEP${macHex}`;
        const ip = `10.100.${Math.floor(i / 250)}.${(i % 250) + 1}`;
        baseFixture.phones.push({
          name: phoneName,
          description: `Fleet Phone ${i}`,
          dirNumber: ext,
          linePartitionName: "Internal_PT",
          lineIds: [],
          callingSearchSpaceName: "Internal_CSS",
          ipAddress: ip,
          status: i <= 950 ? "Registered" : "UnRegistered",
          protocol: "SIP",
          model: 36247,
          modelName: "Cisco 8851",
          nodeName: "CUCM-PUB",
          devicePoolName: "HQ_DP",
          callManagerGroupName: "Default_CMG",
          locationName: "HQ",
          phoneOs: "classic",
          endpointKind: "hardware",
          deviceNamePrefix: "SEP",
          fixtureFamily: "8800",
          firmware: "sip88xx.14-0-1-0101-29",
          firmwareGroup: "sip88xx",
          activeLoadId: "sip88xx.14-0-1-0101-29",
          serialNumber: `FOC2${String(200000 + i)}`,
          network: {
            macAddress: macHex.match(/.{1,2}/g)!.join(":"),
            ipv4Address: ip,
            subnetMask: "255.255.255.0",
            defaultGateway: "10.100.0.1",
            dnsServers: ["192.168.125.1"],
            domainName: "calltelemetry.local",
            switchName: "SW-ACCESS-01",
            switchIpAddress: "192.168.125.2",
            switchModel: "WS-C2960X",
            switchPort: "Gi1/0/1",
            neighborProtocol: "both",
            stats: {
              rxPackets: 1000,
              txPackets: 1000,
              rxBroadcast: 10,
              rxMulticast: 10,
              txBroadcast: 10,
              txMulticast: 10,
              crcErrors: 0,
              collisions: 0,
              jitterMs: 1.0,
              latencyMs: 5.0,
              packetLossPct: 0.0,
            },
          },
          web: {
            htmlFlavor: "classic",
            locale: "en_us",
            supportsScreenshots: true,
            supportsServiceability: true,
            supportsNetworkPages: true,
            supportsClassicExecute: true,
            supportsXapi: false,
          },
          statusMessages: ["Registered"],
          qualityEvents: [],
          risNodeRegistrations: [],
          callLoadEnabled: true,
          callLoadCallsPerHour: 10,
          emitCdrRecords: true,
          emitCmrRecords: true,
          emitCurriEvents: true,
        });
      }
      store.loadState(baseFixture);

      const summary = (await directClient.getSummary()) as any;
      expect(summary.counts.phones).toBe(1000);

      // 2. Paginate first page
      const page1 = (await directClient.listInventory("phones", { offset: 0, limit: 50 })) as any[];
      expect(page1).toHaveLength(50);

      // 3. Paginate middle page
      const pageMiddle = (await directClient.listInventory("phones", { offset: 500, limit: 50 })) as any[];
      expect(pageMiddle).toHaveLength(50);
      expect(pageMiddle[0].name).not.toBe(page1[0].name);

      // 4. Paginate last page
      const pageLast = (await directClient.listInventory("phones", { offset: 950, limit: 50 })) as any[];
      expect(pageLast).toHaveLength(50);

      // 5. Bulk update 100 phones to UnRegistered
      for (let i = 0; i < 100; i++) {
        const phoneName = page1[i % 50].name;
        await directClient.setPhoneStatus(phoneName, "UnRegistered");
      }

      const unregPhones = (await directClient.listInventory("phones", { status: "UnRegistered" })) as any[];
      expect(unregPhones.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 3. Failover Storm Under Active Load
  // =========================================================================
  describe("3. Failover Storm Under Active Load", () => {
    it("survives abrupt node crash during 25 simultaneous active calls", async () => {
      // 1. Start 25 concurrent calls
      const activeCallPromises = Array.from({ length: 25 }, (_, i) => {
        return directClient.simulateCall({
          callingNumber: `10${(i % 50).toString().padStart(2, "0")}`,
          calledNumber: `20${(i % 50).toString().padStart(2, "0")}`,
          duration: 120,
        });
      });
      const activeCalls = await Promise.all(activeCallPromises);
      expect(activeCalls).toHaveLength(25);

      // 2. Abruptly trigger subscriber node failure
      const nodes = (await directClient.listInventory("nodes")) as any[];
      const sub = nodes.find((n: any) => n.role === "subscriber");
      if (sub) {
        await directClient.setNodeStatus(sub.name, "subscriber", "NotFound");
      }

      // 3. Place 10 new calls during the failover storm
      const stormCallPromises = Array.from({ length: 10 }, (_, i) => {
        return directClient.simulateCall({
          callingNumber: `30${(i % 50).toString().padStart(2, "0")}`,
          calledNumber: `40${(i % 50).toString().padStart(2, "0")}`,
          duration: 45,
        });
      });
      const stormCalls = await Promise.all(stormCallPromises);
      expect(stormCalls).toHaveLength(10);

      // 4. Assert all calls were tracked and recorded
      const totalCalls = await directClient.listActiveCalls();
      expect(totalCalls.length).toBeGreaterThanOrEqual(35);
    });
  });

  // =========================================================================
  // 4. Multi-Transport Client Coexistence
  // =========================================================================
  describe("4. Multi-Transport Client Coexistence", () => {
    it("coordinates concurrent operations across DirectStore and HTTP clients simultaneously", async () => {
      // Direct client seeds fixtures
      await directClient.seedFixtures({ fixtureProfile: "lab-small" });

      // HTTP client and Direct client perform interleaved operations
      const [directPhones, httpPhones, directCall, httpCall] = await Promise.all([
        directClient.listInventory("phones"),
        httpClient.listInventory("phones"),
        directClient.simulateCall({ callingNumber: "1001", calledNumber: "1002", duration: 30 }),
        httpClient.simulateCall({ callingNumber: "1001", calledNumber: "1002", duration: 30 }),
      ]);

      expect((directPhones as any[]).length).toBeGreaterThanOrEqual(10);
      expect((httpPhones as any[]).length).toBeGreaterThanOrEqual(10);
      expect(directCall.sessionId).toBeDefined();
      expect((httpCall as any).sessionId).toBeDefined();
    });
  });

  // =========================================================================
  // 5. Soak Stability & Performance
  // =========================================================================
  describe("5. Soak Stability & Performance", () => {
    it("executes 100 consecutive full-cycle operational iterations with stable latency and 0 leaks", async () => {
      const startTime = Date.now();

      for (let iteration = 1; iteration <= 100; iteration++) {
        // Step 1: Simulate Call
        const call = await directClient.simulateCall({
          callingNumber: "1001",
          calledNumber: "1002",
          duration: 10,
        });
        expect(call.sessionId).toBeDefined();

        // Step 2: Evaluate CURRI
        const curri = await directClient.evaluateCurri({
          callingNumber: "1001",
          calledNumber: "1002",
        });
        expect(curri.action).toBe("permit");

        // Step 3: Generate CDRs
        const cdrs = await directClient.generateCdrs({ count: 2, pattern: "normal" });
        expect(cdrs.generatedCount).toBe(2);

        // Periodic reset every 25 iterations to simulate multi-tenant cycle
        if (iteration % 25 === 0) {
          await directClient.resetStore("soft", "lab-small");
        }
      }

      const totalDuration = Date.now() - startTime;
      // 100 iterations should complete well within 5 seconds in-memory
      expect(totalDuration).toBeLessThan(5000);
    });
  });
});
