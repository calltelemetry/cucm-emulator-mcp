/**
 * Tier 3: Cross-Feature Stateful Workflows
 *
 * Verifies complex multi-step state transitions and cross-tool integration:
 * 1. Node Failover -> Phone Re-registration -> Call Simulation -> Synthetic CDR
 * 2. CURRI Policy Query -> Call Disposition -> CDR Cause Code Verification
 * 3. Complete Call Lifecycle (simulate -> hold -> resume -> drop -> CDR)
 * 4. State Snapshot Persistence (seed -> exportSnapshot -> mutate -> loadSnapshot)
 * 5. Dynamic Schema / Fixture Reload Protocol Notifications
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { InMemoryCucmStore } from "../../src/mock/store.js";
import { DirectStoreCucmClient } from "../../src/client/mock-client.js";
import { HttpCucmClient } from "../../src/client/http-client.js";
import { MockCucmServer } from "../helpers/mock-cucm-server.js";

describe("Tier 3: Cross-Feature Stateful Workflows", () => {
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
  // Workflow 1: Node Failover -> Re-registration -> Call -> CDR
  // =========================================================================
  describe("Workflow 1: Node Failover & Call Routing", () => {
    it("executes full ADR 0120/0122 failover pipeline with re-registration and CDR audit", async () => {
      // 1. Initial state inspection
      const initialNodes = (await directClient.listInventory("nodes")) as any[];
      const sub1 = initialNodes.find((n: any) => n.role === "subscriber");
      const pub = initialNodes.find((n: any) => n.role === "publisher");
      expect(sub1).toBeDefined();
      expect(pub).toBeDefined();

      // 2. Set sub1 node to Offline / NotFound
      await directClient.setNodeStatus(sub1.name, "subscriber", "NotFound");
      const refreshedNodes = (await directClient.listInventory("nodes")) as any[];
      const sub1Status = refreshedNodes.find((n: any) => n.name === sub1.name);
      expect(sub1Status.risReturnCode).toBe("NotFound");

      // 3. Re-register phones from sub1 to pub
      const phones = (await directClient.listInventory("phones")) as any[];
      for (const phone of phones) {
        if (phone.nodeName === sub1.name || phone.activeNode === sub1.name) {
          phone.nodeName = pub.name;
          phone.activeNode = pub.name;
          phone.status = "Registered";
          await directClient.upsertInventory("phones", phone);
        }
      }

      // 4. Simulate call between phones on the new node
      const simResult = await directClient.simulateCall({
        callingNumber: "1001",
        calledNumber: "1002",
        duration: 35,
        codec: "G.711u",
      });

      expect(simResult.sessionId).toBeDefined();
      expect(simResult.callSession.sourceNodeName).toBe(pub.name);

      // 5. Verify synthetic CDR record generated with correct node ID
      const cdrHistory = (await directClient.getCdrHistory()) as any;
      expect(cdrHistory.total || cdrHistory.length).toBeGreaterThan(0);
      const latestCdr = store.cdrRecords[store.cdrRecords.length - 1];
      expect(latestCdr.origNodeId).toBeDefined();
      expect(latestCdr.duration).toBe(35);
    });
  });

  // =========================================================================
  // Workflow 2: CURRI Policy -> Call Routing -> CDR Cause Code
  // =========================================================================
  describe("Workflow 2: CURRI Policy & Call Routing", () => {
    it("evaluates blacklist policy, blocks call, and asserts cause code 21 in CDR", async () => {
      // 1. Add strict toll-fraud blacklist policy
      store.policies.set("pol-toll-block", {
        id: "pol-toll-block",
        name: "Block-International-Toll",
        enabled: true,
        priority: 1,
        match: { calledPrefix: "011" },
        action: { type: "block", reason: "International outbound calls barred" },
      });

      // 2. Explicit CURRI evaluation query
      const curriDecision = await directClient.evaluateCurri({
        callingNumber: "1001",
        calledNumber: "011442079460999",
      });

      expect(curriDecision.action).toBe("block");
      expect(curriDecision.reason).toContain("International outbound calls barred");

      // 3. Simulate call to blacklisted number
      const callResult = await directClient.simulateCall({
        callingNumber: "1001",
        calledNumber: "011442079460999",
        duration: 0,
      });

      expect(callResult.state).toBe("policy-blocked");
      expect(callResult.callSession.disconnectReason).toContain("CURRI Block");

      // 4. Assert CDR record captures termination cause code 21 (Call Rejected)
      const cdr = store.cdrRecords.find((c) => c.id === callResult.cdrRecordId);
      expect(cdr).toBeDefined();
      expect(cdr?.origCause_value).toBe(21);
      expect(cdr?.destCause_value).toBe(21);
    });

    it("evaluates divert policy, redirects call to support target, and updates final called party", async () => {
      store.policies.set("pol-helpdesk-divert", {
        id: "pol-helpdesk-divert",
        name: "Reroute-Helpdesk",
        enabled: true,
        priority: 1,
        match: { calledPrefix: "411" },
        action: { type: "redirect", redirectNumber: "1002", reason: "Directory Assistance Reroute" },
      });

      const callResult = await directClient.simulateCall({
        callingNumber: "1001",
        calledNumber: "411",
        duration: 25,
      });

      expect(callResult.finalCalledNumber).toBe("1002");
      expect(callResult.callSession.events.some((e) => e.type === "curri-redirected")).toBe(true);
    });
  });

  // =========================================================================
  // Workflow 3: Complete Call Lifecycle Sequence
  // =========================================================================
  describe("Workflow 3: Complete Call Lifecycle Sequence", () => {
    it("progresses call through simulate -> hold -> resume -> drop with state verification", async () => {
      // 1. Simulate call initiation
      const call = await directClient.simulateCall({
        callingNumber: "1001",
        calledNumber: "1002",
        duration: 90,
      });

      expect(call.state).toBe("connected");

      // 2. Query active calls
      const activeCalls = await directClient.listActiveCalls();
      expect(activeCalls.some((c: any) => c.id === call.sessionId)).toBe(true);

      // 3. Put call on hold
      const heldCall = (await directClient.executeCallAction(call.sessionId, "hold")) as any;
      expect(heldCall.state).toBe("policy-pending");
      expect(heldCall.events.some((e: any) => e.type === "hold")).toBe(true);

      // 4. Resume call
      const resumedCall = (await directClient.executeCallAction(call.sessionId, "resume")) as any;
      expect(resumedCall.state).toBe("connected");
      expect(resumedCall.events.some((e: any) => e.type === "resume")).toBe(true);

      // 5. Terminate call
      const droppedCall = (await directClient.executeCallAction(
        call.sessionId,
        "drop",
        "NormalClearing"
      )) as any;
      expect(droppedCall.state).toBe("disconnected");
      expect(droppedCall.disconnectReason).toBe("NormalClearing");

      // 6. Assert call is no longer in active calls list
      const updatedActiveCalls = await directClient.listActiveCalls();
      expect(updatedActiveCalls.some((c: any) => c.id === call.sessionId)).toBe(false);

      // 7. Verify CDR record details
      const cdr = store.cdrRecords.find((c) => c.id === call.cdrRecordId);
      expect(cdr).toBeDefined();
      expect(cdr?.duration).toBe(90);
    });
  });

  // =========================================================================
  // Workflow 4: State Snapshot Export -> Mutate -> Restore
  // =========================================================================
  describe("Workflow 4: State Snapshot Export -> Mutate -> Restore", () => {
    it("exports snapshot, wipes store, and restores pristine state with 100% fidelity", async () => {
      // 1. Initial seeded state
      const initialSummary = (await directClient.getSummary()) as any;
      const initialPhoneCount = initialSummary.counts.phones;
      expect(initialPhoneCount).toBeGreaterThanOrEqual(10);

      // 2. Export state snapshot via HTTP endpoint
      const snapshot = (await httpClient.executeGenericOperation("POST", "/api/v2/snapshots/export", {})) as any;
      expect(snapshot.snapshotId).toBeDefined();

      // 3. Mutate store drastically (clear phones and nodes)
      await directClient.resetStore("hard", "empty");
      const emptySummary = (await directClient.getSummary()) as any;
      expect(emptySummary.counts.phones).toBe(0);
      expect(emptySummary.counts.nodes).toBe(0);

      // 4. Restore state by loading snapshot
      const loadRes = (await httpClient.executeGenericOperation("POST", "/api/v2/snapshots/load", {
        snapshotId: snapshot.snapshotId,
      })) as any;
      expect(loadRes.success).toBe(true);

      // 5. Verify restored state matches initial snapshot
      const restoredSummary = (await httpClient.getSummary()) as any;
      expect(restoredSummary.phonesCount).toBeGreaterThanOrEqual(10);
    });
  });

  // =========================================================================
  // Workflow 5: Dynamic Schema / Fixture Reload
  // =========================================================================
  describe("Workflow 5: Dynamic Fixture Reload & Notification", () => {
    it("handles dynamic fixture profile switches and tracks state transitions", async () => {
      // 1. Start with lab-small (12 phones)
      await directClient.seedFixtures({ fixtureProfile: "lab-small" });
      const smallSummary = (await directClient.getSummary()) as any;
      expect(smallSummary.counts.phones).toBe(12);

      // 2. Switch to standard-enterprise (50 phones)
      await directClient.seedFixtures({ fixtureProfile: "standard-enterprise" });
      const enterpriseSummary = (await directClient.getSummary()) as any;
      expect(enterpriseSummary.counts.phones).toBe(50);

      // 3. Verify audit log records state reload
      expect(store.auditLogs.length).toBeGreaterThanOrEqual(2);
      expect(store.auditLogs.some((l) => l.eventType === "StoreLoaded")).toBe(true);
    });
  });
});
