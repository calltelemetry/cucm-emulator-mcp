import { describe, expect, it } from "vitest";
import { InMemoryCucmStore } from "../../src/mock/store.js";
import {
  evaluateCurri,
  executeCallAction,
  generateCdrs,
  listActiveCalls,
  simulateCall,
} from "../../src/mock/simulator.js";
import { InvalidStateError } from "../../src/types/errors.js";

describe("Call Simulator & CURRI Engine (simulator.ts)", () => {
  it("evaluates CURRI policies correctly (permit, block, redirect)", () => {
    const store = new InMemoryCucmStore();

    // 1. Normal internal call (Permit)
    const permitDecision = evaluateCurri(store, {
      callingNumber: "1001",
      calledNumber: "1002",
    });
    expect(permitDecision.action).toBe("permit");

    // 2. Fraud prefix call (Block)
    const blockDecision = evaluateCurri(store, {
      callingNumber: "9005551234",
      calledNumber: "9005559999",
    });
    expect(blockDecision.action).toBe("block");
    expect(blockDecision.reason).toContain("Fraud Protection");

    // 3. VIP prefix call (Redirect)
    const redirectDecision = evaluateCurri(store, {
      callingNumber: "1002",
      calledNumber: "1099",
    });
    expect(redirectDecision.action).toBe("redirect");
    expect(redirectDecision.redirectNumber).toBe("1001");
  });

  it("simulates a normal connected call with legs, media, and CDR/CMR emission", () => {
    const store = new InMemoryCucmStore();
    const result = simulateCall(store, {
      callingNumber: "1001",
      calledNumber: "1002",
      duration: 45,
      codec: "G.711u",
      packetLossPct: 1.0,
    });

    expect(result.sessionId).toBeDefined();
    expect(result.state).toBe("connected");
    expect(result.callingNumber).toBe("1001");
    expect(result.calledNumber).toBe("1002");
    expect(result.duration).toBe(45);
    expect(result.cdrRecordId).toBeDefined();
    expect(result.cmrRecordId).toBeDefined();

    // Verify session stored in store
    const session = store.callSessions.get(result.sessionId)!;
    expect(session.legs.length).toBe(2);
    expect(session.mediaLegs.length).toBe(1);
    expect(session.mediaLegs[0].packetsSent).toBe(2250); // 45s * 50 packets/s
    expect(session.mediaLegs[0].packetsLost).toBe(22); // 1% of 2250

    // Verify CDR in store
    const cdr = store.cdrRecords.find((c) => c.id === result.cdrRecordId)!;
    expect(cdr.callingPartyNumber).toBe("1001");
    expect(cdr.finalCalledPartyNumber).toBe("1002");
    expect(cdr.duration).toBe(45);
    expect(cdr.destCause_value).toBe(16); // Normal clearing
  });

  it("simulates a CURRI blocked call with 0 duration and cause code 21", () => {
    const store = new InMemoryCucmStore();
    const result = simulateCall(store, {
      callingNumber: "9001234567",
      calledNumber: "9009876543",
    });

    expect(result.state).toBe("policy-blocked");
    expect(result.duration).toBe(0);
    expect(result.curriDecision?.action).toBe("block");

    const cdr = store.cdrRecords.find((c) => c.id === result.cdrRecordId)!;
    expect(cdr.duration).toBe(0);
    expect(cdr.origCause_value).toBe(21); // Call rejected
    expect(cdr.destCause_value).toBe(21);
  });

  it("simulates a CURRI redirected call", () => {
    const store = new InMemoryCucmStore();
    const result = simulateCall(store, {
      callingNumber: "1005",
      calledNumber: "1099",
      duration: 30,
    });

    expect(result.state).toBe("connected");
    expect(result.calledNumber).toBe("1099");
    expect(result.finalCalledNumber).toBe("1001"); // redirected to 1001
    expect(result.curriDecision?.action).toBe("redirect");
  });

  it("manages call actions (hold, resume, drop)", () => {
    const store = new InMemoryCucmStore();
    const result = simulateCall(store, {
      callingNumber: "1001",
      calledNumber: "1002",
      duration: 60,
    });

    const activeList = listActiveCalls(store);
    expect(activeList.length).toBeGreaterThan(0);

    // Hold call
    const held = executeCallAction(store, result.sessionId, "hold");
    expect(held.state).toBe("policy-pending");

    // Cannot answer while on hold
    expect(() => executeCallAction(store, result.sessionId, "hold")).toThrow(InvalidStateError);

    // Resume call
    const resumed = executeCallAction(store, result.sessionId, "resume");
    expect(resumed.state).toBe("connected");

    // Drop call
    const dropped = executeCallAction(store, result.sessionId, "drop", "Caller hung up");
    expect(dropped.state).toBe("disconnected");
    expect(dropped.disconnectReason).toBe("Caller hung up");

    // Cannot drop again
    expect(() => executeCallAction(store, result.sessionId, "drop")).toThrow(InvalidStateError);
  });

  it("generates synthetic batch CDR/CMR records", () => {
    const store = new InMemoryCucmStore();
    const normalBatch = generateCdrs(store, { count: 5, pattern: "normal" });
    expect(normalBatch.generatedCount).toBe(5);
    expect(normalBatch.cdrRecords.length).toBe(5);

    const abandonedBatch = generateCdrs(store, { count: 3, pattern: "abandoned" });
    expect(abandonedBatch.generatedCount).toBe(3);
    for (const cdr of abandonedBatch.cdrRecords) {
      expect(cdr.duration).toBeLessThanOrEqual(5);
    }
  });
});
