import type {
  CucmCallLeg,
  CucmCallRouting,
  CucmCallSession,
  CucmCallSessionEvent,
  CucmCallSessionState,
  CucmCdrRecord,
  CucmCmrRecord,
  CucmCurriEvent,
  CucmMediaLeg,
  CucmPolicyEvaluation,
  CurriDecision,
  CurriEvaluationInput,
  GenerateCdrInput,
  GenerateCdrResult,
  SimulateCallInput,
  SimulatedCallResult,
} from "../types/domain.js";
import { EntityNotFoundError, InvalidStateError } from "../types/errors.js";
import type { InMemoryCucmStore } from "./store.js";

let callIdCounter = 1000;

/**
 * Evaluates CURRI / External Call Control policies against call parameters.
 */
export function evaluateCurri(
  store: InMemoryCucmStore,
  input: CurriEvaluationInput
): CurriDecision {
  const policies = Array.from(store.policies.values())
    .filter((p) => p.enabled)
    .sort((a, b) => a.priority - b.priority);

  let decision: CurriDecision = {
    matched: false,
    action: "permit",
    reason: "No CURRI policy matched (default permit)",
  };

  for (const policy of policies) {
    let matched = true;

    if (policy.match.callingPrefix && !input.callingNumber.startsWith(policy.match.callingPrefix)) {
      matched = false;
    }
    if (policy.match.calledPrefix && !input.calledNumber.startsWith(policy.match.calledPrefix)) {
      matched = false;
    }
    if (policy.match.deviceNamePattern && input.deviceName) {
      const reg = new RegExp(policy.match.deviceNamePattern.replace(/%/g, ".*"), "i");
      if (!reg.test(input.deviceName)) matched = false;
    }
    if (policy.match.userId && input.userId && policy.match.userId !== input.userId) {
      matched = false;
    }
    if (policy.match.nodeName && input.nodeName && policy.match.nodeName !== input.nodeName) {
      matched = false;
    }

    if (matched) {
      decision = {
        matched: true,
        action: policy.action.type,
        reason: policy.action.reason,
        policyId: policy.id,
        policyName: policy.name,
        redirectNumber: policy.action.redirectNumber,
      };
      break;
    }
  }

  // Record CURRI Event in store
  const event: CucmCurriEvent = {
    id: `curri-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    timestamp: Date.now(),
    callingNumber: input.callingNumber,
    calledNumber: input.calledNumber,
    deviceName: input.deviceName || "UNKNOWN",
    action: decision.action,
    reason: decision.reason,
    policyId: decision.policyId,
    redirectNumber: decision.redirectNumber,
  };
  store.curriEvents.push(event);

  return decision;
}

/**
 * Resolves destination and routing for a dialed number in the dial plan.
 */
export function resolveRouting(
  store: InMemoryCucmStore,
  calledNumber: string
): CucmCallRouting {
  // Check direct internal line match
  for (const line of store.lines.values()) {
    if (line.pattern === calledNumber) {
      const phone = line.phoneName ? store.phones.get(line.phoneName) : undefined;
      return {
        partitionMatched: line.partitionName,
        targetKind: "phone",
        targetName: phone?.name || line.phoneName || "InternalPhone",
        transformedCalledNumber: calledNumber,
      };
    }
  }

  // Check route patterns
  for (const pattern of store.routePatterns.values()) {
    const regexPattern = `^${pattern.pattern
      .replace(/\./g, "")
      .replace(/X/g, "\\d")
      .replace(/\[/g, "[")
      .replace(/\]/g, "]")}$`;

    const reg = new RegExp(regexPattern);
    if (reg.test(calledNumber)) {
      let transformed = calledNumber;
      if (pattern.stripLeadingDigits && pattern.stripLeadingDigits > 0) {
        transformed = transformed.slice(pattern.stripLeadingDigits);
      }
      if (pattern.prefixDigitsOut) {
        transformed = pattern.prefixDigitsOut + transformed;
      }
      return {
        routePatternMatched: pattern.pattern,
        partitionMatched: pattern.partitionName,
        targetKind: pattern.targetKind,
        targetName: pattern.targetName,
        transformedCalledNumber: transformed,
      };
    }
  }

  return {
    targetKind: "unallocated",
    targetName: "UnallocatedNumber",
    transformedCalledNumber: calledNumber,
  };
}

/**
 * Simulates a full end-to-end telephone call leg through the CUCM state machine,
 * evaluating CURRI policies and emitting synthetic CDR and CMR records.
 */
export function simulateCall(
  store: InMemoryCucmStore,
  input: SimulateCallInput
): SimulatedCallResult {
  const globalCallId = ++callIdCounter;
  const globalCmId = 1;
  const sessionId = `call-sess-${Date.now()}-${globalCallId}`;
  const now = Date.now();
  const duration = input.duration !== undefined ? input.duration : 60;
  const codec = input.codec || "G.711u";
  const packetLossPct = input.packetLossPct || 0.0;
  const jitterMs = input.jitterMs !== undefined ? input.jitterMs : 1.5;
  const latencyMs = input.latencyMs !== undefined ? input.latencyMs : 12.0;

  // 1. Identify Source Device
  let sourceDevice = input.sourceDeviceName ? store.phones.get(input.sourceDeviceName) : undefined;
  if (!sourceDevice) {
    for (const p of store.phones.values()) {
      if (p.dirNumber === input.callingNumber) {
        sourceDevice = p;
        break;
      }
    }
  }
  const sourceDeviceName = sourceDevice?.name || input.sourceDeviceName || "SEP001122330001";
  const sourceNodeName = sourceDevice?.nodeName || "CUCM-PUB";

  // 2. Resolve Routing
  const routing = resolveRouting(store, input.calledNumber);

  // 3. Evaluate CURRI Policy
  const curriDecision = evaluateCurri(store, {
    callingNumber: input.callingNumber,
    calledNumber: input.calledNumber,
    deviceName: sourceDeviceName,
    nodeName: sourceNodeName,
  });

  let finalCalledNumber = input.calledNumber;
  let state: CucmCallSessionState = "connected";
  let disconnectReason: string | undefined;

  const policyEvaluations: CucmPolicyEvaluation[] = [];
  const events: CucmCallSessionEvent[] = [
    { id: "ev-1", type: "originate", timestamp: now },
    { id: "ev-2", type: "route-resolved", timestamp: now + 50 },
  ];

  if (curriDecision.matched) {
    policyEvaluations.push({
      id: `pe-${now}`,
      requestedAt: now + 50,
      resolvedAt: now + 80,
      policyId: curriDecision.policyId,
      policyName: curriDecision.policyName,
      action: curriDecision.action,
      reason: curriDecision.reason,
      redirectNumber: curriDecision.redirectNumber,
    });

    if (curriDecision.action === "block") {
      state = "policy-blocked";
      disconnectReason = `CURRI Block: ${curriDecision.reason}`;
      events.push({ id: "ev-3", type: "curri-blocked", timestamp: now + 80 });
    } else if (curriDecision.action === "redirect" && curriDecision.redirectNumber) {
      finalCalledNumber = curriDecision.redirectNumber;
      events.push({
        id: "ev-3",
        type: "curri-redirected",
        timestamp: now + 80,
        payload: { redirectNumber: finalCalledNumber },
      });
      events.push({ id: "ev-4", type: "connected", timestamp: now + 150 });
    } else {
      events.push({ id: "ev-3", type: "curri-allowed", timestamp: now + 80 });
      events.push({ id: "ev-4", type: "connected", timestamp: now + 150 });
    }
  } else {
    events.push({ id: "ev-3", type: "connected", timestamp: now + 100 });
  }

  // 4. Identify Destination Device
  let destDevice = input.destinationDeviceName ? store.phones.get(input.destinationDeviceName) : undefined;
  if (!destDevice) {
    for (const p of store.phones.values()) {
      if (p.dirNumber === finalCalledNumber) {
        destDevice = p;
        break;
      }
    }
  }
  const destDeviceName = destDevice?.name || input.destinationDeviceName || (routing.targetKind === "phone" ? routing.targetName : "CUBE_Trunk");

  // 5. Build Legs
  const legs: CucmCallLeg[] = [
    {
      id: `leg-src-${globalCallId}`,
      direction: "source",
      deviceName: sourceDeviceName,
      nodeName: sourceNodeName,
      directoryNumber: input.callingNumber,
      partitionName: "Internal_PT",
      ipAddress: sourceDevice?.ipAddress || "192.168.125.101",
      protocol: sourceDevice?.protocol || "SIP",
      state: state === "policy-blocked" ? "blocked" : "connected",
    },
    {
      id: `leg-dst-${globalCallId}`,
      direction: curriDecision.action === "redirect" ? "redirect" : "destination",
      deviceName: destDeviceName,
      nodeName: destDevice?.nodeName || "CUCM-PUB",
      directoryNumber: finalCalledNumber,
      partitionName: routing.partitionMatched || "Internal_PT",
      ipAddress: destDevice?.ipAddress || "192.168.125.102",
      protocol: destDevice?.protocol || "SIP",
      state: state === "policy-blocked" ? "blocked" : "connected",
    },
  ];

  const packetsCount = state === "connected" ? Math.floor((duration * 1000) / 20) : 0;
  const lostCount = Math.floor(packetsCount * (packetLossPct / 100));

  const mediaLegs: CucmMediaLeg[] = state === "connected" ? [
    {
      id: `media-src-${globalCallId}`,
      callLegId: `leg-src-${globalCallId}`,
      deviceName: sourceDeviceName,
      packetsSent: packetsCount,
      packetsReceived: packetsCount - lostCount,
      packetsLost: lostCount,
      octetsSent: packetsCount * 160,
      octetsReceived: (packetsCount - lostCount) * 160,
      jitterMs,
      latencyMs,
      packetLossPct,
      codec,
      vqMetrics: `MLQK=4.38;MLQKav=4.35;MLQKmn=4.20;MLQKmx=4.45;ICR=0.00;CCR=0.00;CS=0;SCS=0`,
    },
  ] : [];

  const callSession: CucmCallSession = {
    id: sessionId,
    globalCallID_callManagerId: globalCmId,
    globalCallID_callId: globalCallId,
    globalCallId_ClusterID: store.clusterName,
    state,
    startedAt: now,
    setupAt: now + 50,
    connectedAt: state === "connected" ? now + 150 : undefined,
    mediaEstablishedAt: state === "connected" ? now + 200 : undefined,
    disconnectedAt: state === "policy-blocked" ? now + 80 : now + 200 + duration * 1000,
    disconnectReason,
    sourceDeviceName,
    sourceNodeName,
    callingNumber: input.callingNumber,
    calledNumber: input.calledNumber,
    finalCalledNumber,
    routing,
    events,
    legs,
    mediaLegs,
    policyEvaluations,
    artifacts: {
      cdrRecordIds: [],
      cmrRecordIds: [],
      curriEventIds: [],
      auditLogIds: [],
    },
  };

  // 6. Generate CDR Record
  const cdrId = `cdr-${now}-${globalCallId}`;
  const isBlocked = state === "policy-blocked";

  const cdrRecord: CucmCdrRecord = {
    id: cdrId,
    callId: sessionId,
    cdrRecordType: 1,
    globalCallID_callManagerId: globalCmId,
    globalCallID_callId: globalCallId,
    origLegCallIdentifier: `leg-src-${globalCallId}`,
    dateTimeOrigination: Math.floor(now / 1000),
    origNodeId: 1,
    origSpan: 0,
    origIpAddr: sourceDevice?.ipAddress || "192.168.125.101",
    callingPartyNumber: input.callingNumber,
    callingPartyUnicodeLoginUserID: sourceDevice?.ownerUserId || "",
    origCause_location: 0,
    origCause_value: isBlocked ? 21 : 0, // 21 = Call Rejected
    destLegIdentifier: `leg-dst-${globalCallId}`,
    destNodeId: 1,
    destSpan: 0,
    destIpAddr: destDevice?.ipAddress || "192.168.125.102",
    originalCalledPartyNumber: input.calledNumber,
    finalCalledPartyNumber: finalCalledNumber,
    finalCalledPartyUnicodeLoginUserID: destDevice?.ownerUserId || "",
    destCause_location: 0,
    destCause_value: isBlocked ? 21 : 16, // 16 = Normal Call Clearing
    dateTimeConnect: isBlocked ? 0 : Math.floor((now + 150) / 1000),
    dateTimeDisconnect: Math.floor((now + (isBlocked ? 80 : 200 + duration * 1000)) / 1000),
    duration: isBlocked ? 0 : duration,
    pkid: `{CDR${String(globalCallId).padStart(8, "0")}-0000-0000-0000-000000000000}`,
    originalCalledPartyNumberPartition: routing.partitionMatched || "Internal_PT",
    callingPartyNumberPartition: "Internal_PT",
    finalCalledPartyNumberPartition: routing.partitionMatched || "Internal_PT",
    lastRedirectDnPartition: curriDecision.action === "redirect" ? "Internal_PT" : "",
    origDeviceName: sourceDeviceName,
    destDeviceName,
    globalCallId_ClusterID: store.clusterName,
    callSecuredStatus: "0",
    lastRedirectDn: curriDecision.action === "redirect" ? input.calledNumber : "",
    currentRoutingReason: curriDecision.action === "redirect" ? "4" : "0", // 4 = Deflection
    origRoutingReason: "0",
    lastRedirectingRoutingReason: curriDecision.action === "redirect" ? 4 : 0,
    huntPilotPartition: "",
    huntPilotDN: "",
    calledPartyPatternUsage: 2,
    outpulsedCallingPartyNumber: input.callingNumber,
    outpulsedCalledPartyNumber: finalCalledNumber,
    outpulsedOriginalCalledPartyNumber: input.calledNumber,
    origIpv4v6Addr: sourceDevice?.ipAddress || "192.168.125.101",
    destIpv4v6Addr: destDevice?.ipAddress || "192.168.125.102",
    OutgoingProtocolID: 1,
    OutgoingProtocolCallRef: `ref-${globalCallId}`,
    originalCalledPartyPattern: input.calledNumber,
    finalCalledPartyPattern: finalCalledNumber,
    origDeviceType: "Cisco 8845",
    destDeviceType: "Cisco 8845",
    origDeviceSessionID: `{SES${String(globalCallId).padStart(8, "0")}-0000-0000-0000-000000000001}`,
    destDeviceSessionID: `{SES${String(globalCallId).padStart(8, "0")}-0000-0000-0000-000000000002}`,
    routePatternName: routing.routePatternMatched,
    policyId: curriDecision.policyId,
  };

  store.cdrRecords.push(cdrRecord);
  callSession.artifacts.cdrRecordIds.push(cdrId);

  // 7. Generate CMR Record (for connected media calls)
  let cmrId: string | undefined;
  if (!isBlocked && packetsCount > 0) {
    cmrId = `cmr-${now}-${globalCallId}`;
    const cmrRecord: CucmCmrRecord = {
      id: cmrId,
      callId: sessionId,
      cdrRecordType: 2,
      globalCallID_callManagerId: globalCmId,
      globalCallID_callId: globalCallId,
      nodeId: 1,
      directoryNum: input.callingNumber,
      callIdentifier: globalCallId,
      dateTimeStamp: Math.floor((now + 200 + duration * 1000) / 1000),
      numberPacketsSent: packetsCount,
      numberOctetsSent: packetsCount * 160,
      numberPacketsReceived: packetsCount - lostCount,
      numberOctetsReceived: (packetsCount - lostCount) * 160,
      numberPacketsLost: lostCount,
      jitter: Math.floor(jitterMs),
      latency: Math.floor(latencyMs),
      pkid: `{CMR${String(globalCallId).padStart(8, "0")}-0000-0000-0000-000000000000}`,
      directoryNumPartition: "Internal_PT",
      globalCallId_ClusterID: store.clusterName,
      deviceName: sourceDeviceName,
      varVQMetrics: mediaLegs[0]?.vqMetrics || "",
      duration,
    };

    store.cmrRecords.push(cmrRecord);
    callSession.artifacts.cmrRecordIds.push(cmrId);
  }

  // Save session to store
  store.callSessions.set(sessionId, callSession);

  return {
    sessionId,
    state,
    callingNumber: input.callingNumber,
    calledNumber: input.calledNumber,
    finalCalledNumber,
    sourceDeviceName,
    destinationDeviceName: destDeviceName,
    duration: isBlocked ? 0 : duration,
    curriDecision,
    cdrRecordId: cdrId,
    cmrRecordId: cmrId,
    callSession,
    routing,
    media: mediaLegs,
    cdr: cdrRecord,
  };
}

/**
 * Executes a call action (answer, hold, resume, drop) on an active call session.
 */
export function executeCallAction(
  store: InMemoryCucmStore,
  sessionId: string,
  action: "answer" | "hold" | "resume" | "drop",
  reason = "Action triggered by MCP agent"
): CucmCallSession {
  const session = store.callSessions.get(sessionId);
  if (!session) {
    throw new EntityNotFoundError("CucmCallSession", sessionId);
  }

  const now = Date.now();

  switch (action) {
    case "answer": {
      if (session.state === "disconnected" || session.state === "policy-blocked") {
        throw new InvalidStateError(`Cannot answer call in "${session.state}" state`);
      }
      session.state = "connected";
      session.connectedAt = now;
      session.events.push({ id: `ev-${Date.now()}`, type: "connected", timestamp: now });
      break;
    }
    case "hold": {
      if (session.state !== "connected" && session.state !== "media-established") {
        throw new InvalidStateError(`Cannot hold call in "${session.state}" state`);
      }
      session.state = "policy-pending";
      session.events.push({ id: `ev-${Date.now()}`, type: "hold", timestamp: now });
      for (const leg of session.legs) {
        leg.state = "ringing";
      }
      break;
    }
    case "resume": {
      if (session.state !== "policy-pending") {
        throw new InvalidStateError(`Cannot resume call that is not on hold (current state: "${session.state}")`);
      }
      session.state = "connected";
      session.events.push({ id: `ev-${Date.now()}`, type: "resume", timestamp: now });
      for (const leg of session.legs) {
        leg.state = "connected";
      }
      break;
    }
    case "drop": {
      if (session.state === "disconnected") {
        throw new InvalidStateError("Call is already disconnected");
      }
      session.state = "disconnected";
      session.disconnectedAt = now;
      session.disconnectReason = reason;
      session.events.push({ id: `ev-${Date.now()}`, type: "disconnected", timestamp: now });
      for (const leg of session.legs) {
        leg.state = "disconnected";
      }
      break;
    }
    default: {
      throw new InvalidStateError(`Unsupported call action "${action}"`);
    }
  }

  store.callSessions.set(sessionId, session);
  return session;
}

/**
 * Lists active calls.
 */
export function listActiveCalls(
  store: InMemoryCucmStore,
  query: { state?: string; limit?: number } = {}
): CucmCallSession[] {
  let sessions = Array.from(store.callSessions.values());

  if (query.state) {
    sessions = sessions.filter((s) => s.state === query.state);
  } else {
    sessions = sessions.filter((s) => s.state !== "disconnected");
  }

  if (query.limit && query.limit > 0) {
    sessions = sessions.slice(0, query.limit);
  }

  return sessions;
}

/**
 * Generates synthetic batch CDR/CMR records according to traffic patterns.
 */
export function generateCdrs(
  store: InMemoryCucmStore,
  input: GenerateCdrInput
): GenerateCdrResult {
  const pattern = input.pattern || "normal";
  const count = input.count !== undefined ? input.count : 10;
  const callingPrefix = input.callingNumberPrefix || "10";
  const calledPrefix = input.calledNumberPrefix || "10";
  const durationMin = input.durationMin !== undefined ? input.durationMin : (pattern === "abandoned" ? 0 : 15);
  const durationMax = input.durationMax !== undefined ? input.durationMax : (pattern === "abandoned" ? 5 : 300);

  const generatedCdrs: CucmCdrRecord[] = [];
  const generatedCmrs: CucmCmrRecord[] = [];

  for (let i = 1; i <= count; i++) {
    const duration = Math.floor(durationMin + Math.random() * (durationMax - durationMin));
    const calling = `${callingPrefix}${String(10 + (i % 80)).padStart(2, "0")}`;
    const called = `${calledPrefix}${String(20 + (i % 80)).padStart(2, "0")}`;

    const res = simulateCall(store, {
      callingNumber: calling,
      calledNumber: called,
      duration,
      packetLossPct: pattern === "burst" ? Math.random() * 5 : 0,
    });

    const cdr = store.cdrRecords.find((c) => c.id === res.cdrRecordId);
    if (cdr) generatedCdrs.push(cdr);

    if (res.cmrRecordId) {
      const cmr = store.cmrRecords.find((c) => c.id === res.cmrRecordId);
      if (cmr) generatedCmrs.push(cmr);
    }
  }

  return {
    generatedCount: count,
    count,
    pattern,
    cdrRecords: generatedCdrs,
    records: generatedCdrs,
    cmrRecords: generatedCmrs,
  };
}
