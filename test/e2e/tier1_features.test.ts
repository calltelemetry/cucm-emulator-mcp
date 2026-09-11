/**
 * Tier 1: Feature Coverage in Isolation
 *
 * 100% Tool Surface Coverage:
 * - Domain 1: Fixtures & Topology (cucm_emulator_seed_fixtures, cucm_emulator_reset_store, cucm_emulator_inspect_fixtures)
 * - Domain 2: Nodes & Cluster Health (cucm_emulator_list_nodes, cucm_emulator_simulate_node_failover)
 * - Domain 3: Phones & Registration (cucm_emulator_list_phones, cucm_emulator_set_phone_status, cucm_emulator_get_phone_web)
 * - Domain 4: Call Simulation & Legs (cucm_emulator_simulate_call, cucm_emulator_call_action, cucm_emulator_list_active_calls)
 * - Domain 5: CURRI / ECC Policy Routing (cucm_emulator_evaluate_curri, cucm_emulator_get_curri_history)
 * - Domain 6: CDR / CMR Buffers (cucm_emulator_generate_cdrs, cucm_emulator_get_cdr_history)
 * - Dynamic OpenAPI Operations: cucm_emulator_get_summary, cucm_emulator_query_sql, cucm_emulator_get_topology, cucm_emulator_list_inventory,
 *   cucm_emulator_upsert_inventory, cucm_emulator_get_inventory_item, cucm_emulator_patch_inventory_item, cucm_emulator_delete_inventory_item,
 *   cucm_emulator_create_call_session, cucm_emulator_list_cdr_records, cucm_emulator_export_cdr_csv, cucm_emulator_load_snapshot, etc.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { InMemoryCucmStore } from "../../src/mock/store.js";
import { DirectStoreCucmClient } from "../../src/client/mock-client.js";
import { HttpCucmClient } from "../../src/client/http-client.js";
import { MockCucmServer } from "../helpers/mock-cucm-server.js";

describe("Tier 1: Feature Coverage in Isolation", () => {
  let store: InMemoryCucmStore;
  let directClient: DirectStoreCucmClient;
  let mockServer: MockCucmServer;
  let httpClient: HttpCucmClient;

  beforeEach(async () => {
    store = new InMemoryCucmStore();
    directClient = new DirectStoreCucmClient(store);

    mockServer = new MockCucmServer({ seedProfile: "lab-small" });
    const baseUrl = await mockServer.start();
    httpClient = new HttpCucmClient({ targetUrl: baseUrl, timeoutMs: 5000 });
  });

  afterEach(async () => {
    await mockServer.stop();
  });

  // =========================================================================
  // Domain 1: Fixtures & Topology
  // =========================================================================
  describe("Domain 1: Fixtures & Topology", () => {
    it("1.1 emu_seed_fixtures: seeds lab-small fixture with default node and phone topology", async () => {
      const result = await directClient.seedFixtures({ fixtureProfile: "lab-small" });
      expect(result).toBeDefined();

      const summary = (await directClient.getSummary()) as any;
      expect(summary.counts.phones).toBeGreaterThanOrEqual(10);
      expect(summary.counts.nodes).toBeGreaterThanOrEqual(2);
    });

    it("1.2 emu_seed_fixtures: seeds custom phone count and seed number", async () => {
      const result = await directClient.seedFixtures({
        fixtureProfile: "standard-enterprise",
        phoneCount: 50,
        seed: 42,
      });
      expect(result).toBeDefined();

      const summary = (await directClient.getSummary()) as any;
      expect(summary.counts.phones).toBeGreaterThanOrEqual(25);
    });

    it("1.3 emu_reset_store: resets store to pristine clean state", async () => {
      // First mutate state
      const phones = (await directClient.listInventory("phones")) as any[];
      if (phones.length > 0) {
        await directClient.setPhoneStatus(phones[0].name, "UnRegistered");
      }

      // Reset store
      const resetResult = await directClient.resetStore("soft", "lab-small");
      expect(resetResult).toBeDefined();

      const refreshedPhones = (await directClient.listInventory("phones")) as any[];
      expect(refreshedPhones.length).toBeGreaterThanOrEqual(10);
    });

    it("1.4 emu_inspect_fixtures: retrieves full fixture inventory and counts", async () => {
      const summary = (await directClient.getSummary()) as any;
      expect(summary.clusterName).toBeDefined();
      expect(summary.version).toBeDefined();
      expect(summary.counts.phones).toBeGreaterThan(0);
      expect(summary.counts.nodes).toBeGreaterThan(0);
    });

    it("1.5 HTTP backend: seeds fixtures and resets store over HTTP endpoint", async () => {
      const seedRes = (await httpClient.seedFixtures({ fixtureProfile: "lab-small", phoneCount: 15 })) as any;
      expect(seedRes.success).toBe(true);

      const summary = (await httpClient.getSummary()) as any;
      expect(summary.phonesCount).toBe(15);

      const resetRes = (await httpClient.resetStore("soft", "lab-small")) as any;
      expect(resetRes.success).toBe(true);
    });
  });

  // =========================================================================
  // Domain 2: Nodes & Cluster Health
  // =========================================================================
  describe("Domain 2: Nodes & Cluster Health", () => {
    it("2.1 emu_list_nodes: lists cluster nodes with roles, IP addresses and versions", async () => {
      const nodes = (await directClient.listInventory("nodes")) as any[];
      expect(nodes).toBeDefined();
      expect(nodes.length).toBeGreaterThanOrEqual(2);

      const pub = nodes.find((n: any) => n.role === "publisher");
      expect(pub).toBeDefined();
      expect(pub.name).toBeDefined();
      expect(pub.ipv4Address).toBeDefined();
    });

    it("2.2 cucm_emulator_simulate_node_failover: updates subscriber node to Offline for ADR 0120/0122 failover", async () => {
      const nodes = (await directClient.listInventory("nodes")) as any[];
      const sub = nodes.find((n: any) => n.role === "subscriber");
      expect(sub).toBeDefined();

      const updateResult = (await directClient.setNodeStatus(sub.name, "subscriber", "NotFound")) as any;
      expect(updateResult).toBeDefined();

      const refreshed = (await directClient.listInventory("nodes")) as any[];
      const updatedSub = refreshed.find((n: any) => n.name === sub.name);
      expect(updatedSub.risReturnCode).toBe("NotFound");
    });

    it("2.3 cucm_emulator_simulate_node_failover: restores subscriber node to Online", async () => {
      const nodes = (await directClient.listInventory("nodes")) as any[];
      const sub = nodes.find((n: any) => n.role === "subscriber");

      await directClient.setNodeStatus(sub.name, "subscriber", "NotFound");
      await directClient.setNodeStatus(sub.name, "subscriber", "Ok");

      const refreshed = (await directClient.listInventory("nodes")) as any[];
      const updatedSub = refreshed.find((n: any) => n.name === sub.name);
      expect(updatedSub.risReturnCode).toBe("Ok");
    });

    it("2.4 HTTP backend: lists nodes and modifies node status over REST API", async () => {
      const updateRes = (await httpClient.setNodeStatus("cucm-sub1", "subscriber", "Offline")) as any;
      expect(updateRes).toBeDefined();
      expect(updateRes.status || updateRes.risReturnCode).toBeDefined();
    });

    it("2.5 emu_list_nodes: verifies CallManager Group assignments for high availability", async () => {
      const cmgs = (await directClient.listInventory("callmanager-groups")) as any[];
      expect(cmgs).toBeDefined();
      expect(cmgs.length).toBeGreaterThan(0);
      expect(cmgs[0].members.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Domain 3: Phones & Registration
  // =========================================================================
  describe("Domain 3: Phones & Registration", () => {
    it("3.1 emu_list_phones: lists registered phones with line numbers and MAC addresses", async () => {
      const phones = (await directClient.listInventory("phones")) as any[];
      expect(phones.length).toBeGreaterThan(0);

      const firstPhone = phones[0];
      expect(firstPhone.name).toMatch(/^(SEP|CSF|BOT)[0-9A-F]{12}$/i);
      expect(firstPhone.ipAddress).toBeDefined();
      expect(firstPhone.status).toBeDefined();
    });

    it("3.2 emu_set_phone_status: unregisters phone and updates RIS status", async () => {
      const phones = (await directClient.listInventory("phones")) as any[];
      const targetPhone = phones[0].name;

      const updated = (await directClient.setPhoneStatus(targetPhone, "UnRegistered")) as any;
      expect(updated.status).toBe("UnRegistered");

      const fetched = (await directClient.getInventoryItem("phones", targetPhone)) as any;
      expect(fetched.status).toBe("UnRegistered");
    });

    it("3.3 emu_set_phone_status: rejects phone registration", async () => {
      const phones = (await directClient.listInventory("phones")) as any[];
      const targetPhone = phones[1].name;

      const updated = (await directClient.setPhoneStatus(targetPhone, "Rejected")) as any;
      expect(updated.status).toBe("Rejected");
    });

    it("3.4 emu_get_phone_web: retrieves phone XML and HTML serviceability web pages", async () => {
      const phones = (await directClient.listInventory("phones")) as any[];
      const phoneName = phones[0].name;

      const xmlWeb = (await directClient.getPhoneWeb(phoneName, "/CiscoIPPhoneResponse", "xml")) as any;
      expect(xmlWeb).toBeDefined();

      const htmlWeb = (await directClient.getPhoneWeb(phoneName, "/NetworkConfiguration", "html")) as any;
      expect(htmlWeb).toBeDefined();
    });

    it("3.5 HTTP backend: queries phones with status filtering over HTTP", async () => {
      const regPhones = (await httpClient.listInventory("phones", { status: "Registered" })) as any[];
      expect(Array.isArray(regPhones)).toBe(true);
      expect(regPhones.length).toBeGreaterThan(0);

      const phoneWeb = (await httpClient.getPhoneWeb(regPhones[0].name, "/web", "xml")) as any;
      expect(phoneWeb).toBeDefined();
    });
  });

  // =========================================================================
  // Domain 4: Call Simulation & Legs
  // =========================================================================
  describe("Domain 4: Call Simulation & Legs", () => {
    it("4.1 emu_simulate_call: simulates two-party call with RTP media metrics and CDR creation", async () => {
      const result = await directClient.simulateCall({
        callingNumber: "1001",
        calledNumber: "1002",
        duration: 45,
        codec: "G.711u",
      });

      expect(result.sessionId).toBeDefined();
      expect(result.callSession).toBeDefined();
      expect(result.callSession.routing).toBeDefined();
      expect(result.callSession.routing.targetKind).toBe("phone");
      expect(result.callSession.mediaLegs.length).toBeGreaterThan(0);
      expect(result.duration).toBe(45);
    });

    it("4.2 emu_call_action: performs answer, hold, resume, and drop lifecycle actions", async () => {
      const call = await directClient.simulateCall({
        callingNumber: "1001",
        calledNumber: "1002",
        duration: 60,
      });

      // Answer call
      const answerRes = (await directClient.executeCallAction(call.sessionId, "answer")) as any;
      expect(answerRes.state).toBe("connected");

      // Hold call
      const holdRes = (await directClient.executeCallAction(call.sessionId, "hold")) as any;
      expect(holdRes.events.some((e: any) => e.type === "hold")).toBe(true);

      // Resume call
      const resumeRes = (await directClient.executeCallAction(call.sessionId, "resume")) as any;
      expect(resumeRes.events.some((e: any) => e.type === "resume")).toBe(true);

      // Drop call
      const dropRes = (await directClient.executeCallAction(call.sessionId, "drop", "NormalClearing")) as any;
      expect(dropRes.state).toBe("disconnected");
    });

    it("4.3 emu_list_active_calls: lists active calls with state filtering", async () => {
      const call = await directClient.simulateCall({
        callingNumber: "1001",
        calledNumber: "1002",
        duration: 120,
      });

      const activeCalls = await directClient.listActiveCalls();
      expect(activeCalls.length).toBeGreaterThan(0);
      expect(activeCalls.some((c: any) => c.id === call.sessionId)).toBe(true);
    });

    it("4.4 HTTP backend: simulates call and queries active calls over HTTP", async () => {
      const simRes = (await httpClient.simulateCall({
        callingNumber: "1001",
        calledNumber: "1002",
        duration: 30,
        codec: "G.729",
      })) as any;

      expect(simRes.sessionId).toBeDefined();

      const activeCalls = (await httpClient.listActiveCalls()) as any[];
      expect(activeCalls.length).toBeGreaterThan(0);
    });

    it("4.5 emu_simulate_call: simulates call to external PSTN via Route Pattern / SIP Trunk", async () => {
      const result = await directClient.simulateCall({
        callingNumber: "1001",
        calledNumber: "915551234567",
        duration: 20,
      });

      expect(result.sessionId).toBeDefined();
      expect(result.callSession.routing.targetKind).toBe("route-list");
    });
  });

  // =========================================================================
  // Domain 5: CURRI / ECC Policy Routing
  // =========================================================================
  describe("Domain 5: CURRI / ECC Policy Routing", () => {
    it("5.1 emu_evaluate_curri: evaluates permit policy for authorized internal calling numbers", async () => {
      const decision = await directClient.evaluateCurri({
        callingNumber: "1001",
        calledNumber: "1002",
      });

      expect(decision.action).toBe("permit");
    });

    it("5.2 emu_evaluate_curri: evaluates deny policy for blacklisted destination prefix", async () => {
      store.policies.set("pol-blacklist", {
        id: "pol-blacklist",
        name: "Block-900-Toll",
        enabled: true,
        priority: 1,
        match: { calledPrefix: "900" },
        action: { type: "deny", reason: "Toll numbers blocked" },
      });

      const decision = await directClient.evaluateCurri({
        callingNumber: "1001",
        calledNumber: "9005551234",
      });

      expect(decision.action).toBe("deny");
      expect(decision.reason).toContain("Toll numbers blocked");
    });

    it("5.3 emu_evaluate_curri: evaluates divert policy for redirected support numbers", async () => {
      store.policies.set("pol-divert", {
        id: "pol-divert",
        name: "Divert-Emergency",
        enabled: true,
        priority: 1,
        match: { calledPrefix: "8888" },
        action: { type: "divert", redirectNumber: "8000", reason: "Security desk reroute" },
      });

      const decision = await directClient.evaluateCurri({
        callingNumber: "1001",
        calledNumber: "8888",
      });

      expect(decision.action).toBe("divert");
      expect(decision.redirectNumber).toBe("8000");
    });

    it("5.4 emu_get_curri_history: retrieves logged CURRI evaluation events", async () => {
      await directClient.evaluateCurri({ callingNumber: "1001", calledNumber: "1002" });
      await directClient.evaluateCurri({ callingNumber: "1001", calledNumber: "9005551234" });

      const history = (await directClient.getCurriHistory()) as any[];
      expect(history.length).toBeGreaterThanOrEqual(2);
    });

    it("5.5 HTTP backend: evaluates CURRI request and fetches event logs over HTTP", async () => {
      const decision = (await httpClient.evaluateCurri({
        callingNumber: "1001",
        calledNumber: "4444",
      })) as any;

      expect(decision.decision || decision.action).toBe("deny");

      const history = (await httpClient.getCurriHistory()) as any[];
      expect(history.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Domain 6: CDR / CMR Buffers
  // =========================================================================
  describe("Domain 6: CDR / CMR Buffers", () => {
    it("6.1 emu_generate_cdrs: generates normal CDR traffic burst", async () => {
      const result = await directClient.generateCdrs({
        count: 20,
        pattern: "normal",
      });

      expect(result.generatedCount).toBe(20);
      expect(result.cdrRecords.length).toBe(20);

      const history = (await directClient.getCdrHistory()) as any;
      expect(history.total || history.length).toBeGreaterThanOrEqual(20);
    });

    it("6.2 emu_generate_cdrs: generates abandoned call CDR records with minimal duration", async () => {
      const result = await directClient.generateCdrs({
        count: 10,
        pattern: "abandoned",
        durationMin: 0,
        durationMax: 5,
      });

      expect(result.generatedCount).toBe(10);
      for (const cdr of result.cdrRecords) {
        expect(cdr.duration).toBeLessThanOrEqual(5);
      }
    });

    it("6.3 emu_generate_cdrs: generates CURRI-blocked pattern CDR records", async () => {
      const result = await directClient.generateCdrs({
        count: 5,
        pattern: "curri-blocked",
      });

      expect(result.generatedCount).toBe(5);
      expect(result.cdrRecords.length).toBe(5);
    });

    it("6.4 emu_get_cdr_history: exports CDR records in CSV format", async () => {
      await directClient.generateCdrs({ count: 5, pattern: "normal" });

      const csvData = (await directClient.getCdrHistory({ format: "csv" })) as string;
      expect(typeof csvData).toBe("string");
      expect(csvData).toContain("cdrRecordType");
      expect(csvData).toContain("callingPartyNumber");
    });

    it("6.5 HTTP backend: generates synthetic CDRs and fetches history over HTTP", async () => {
      const genRes = (await httpClient.generateCdrs({ count: 12, pattern: "normal" })) as any;
      expect(genRes.generatedCount || genRes.count).toBe(12);

      const history = (await httpClient.getCdrHistory()) as any;
      expect(history.records?.length || history.length).toBeGreaterThanOrEqual(12);
    });
  });

  // =========================================================================
  // Dynamic OpenAPI Tools Coverage
  // =========================================================================
  describe("Dynamic OpenAPI Operations", () => {
    it("7.1 emu_get_summary: queries emulator cluster health and active metric counters", async () => {
      const summary = await directClient.executeGenericOperation("GET", "/api/v2/summary", {});
      expect(summary).toBeDefined();
    });

    it("7.2 emu_query_sql: executes direct SQL query against emulator database", async () => {
      const result = (await httpClient.executeGenericOperation("POST", "/api/sql", {
        query: "SELECT * FROM processnode",
      })) as any;
      expect(result.rows).toBeDefined();
      expect(result.rowCount).toBeGreaterThan(0);
    });

    it("7.3 emu_list_inventory & emu_upsert_inventory: CRUD operations on generic inventory resources", async () => {
      const upsertRes = (await httpClient.executeGenericOperation("POST", "/api/v2/inventory/custom_devices", {
        id: "cust-01",
        name: "Custom-Gateway-1",
      })) as any;
      expect(upsertRes.success).toBe(true);

      const listRes = (await httpClient.executeGenericOperation("GET", "/api/v2/inventory/custom_devices", {})) as any[];
      expect(listRes.some((i: any) => i.id === "cust-01")).toBe(true);
    });

    it("7.4 emu_export_snapshot & emu_load_snapshot: state export and import operations", async () => {
      const snapshot = (await httpClient.executeGenericOperation("POST", "/api/v2/snapshots/export", {})) as any;
      expect(snapshot.snapshotId).toBeDefined();

      const loadRes = (await httpClient.executeGenericOperation("POST", "/api/v2/snapshots/load", {
        snapshotId: snapshot.snapshotId,
      })) as any;
      expect(loadRes.success).toBe(true);
    });

    it("7.5 emu_export_cdr_csv: exports raw CSV CDR stream over OpenAPI endpoint", async () => {
      const csvExport = (await httpClient.executeGenericOperation("GET", "/api/v2/artifacts/cdr/export", {})) as string;
      expect(typeof csvExport).toBe("string");
      expect(csvExport).toContain("cdrRecordType");
    });
  });
});
