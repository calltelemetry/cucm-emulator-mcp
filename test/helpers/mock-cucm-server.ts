/**
 * Mock CUCM Server
 *
 * Lightweight, in-process HTTP server simulating the live CUCM Emulator REST/OpenAPI API
 * for testing ICucmEmulatorClient, HttpCucmClient, and multi-tier endpoint resolution.
 */

import express, { Express, Request, Response, NextFunction } from "express";
import http from "node:http";
import { AddressInfo } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface MockRequestLog {
  method: string;
  url: string;
  path: string;
  query: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  timestamp: string;
}

export interface MockFailureRule {
  pattern: RegExp | string;
  statusCode: number;
  responseBody?: unknown;
}

export interface MockServerOptions {
  seedProfile?: "lab-small" | "standard-enterprise" | "empty";
  defaultPhoneCount?: number;
  initialLatencyMs?: number;
  authTokens?: string[];
}

export class MockCucmServer {
  private app: Express;
  private server: http.Server | null = null;
  private port = 0;
  private baseUrl = "";
  private requestHistory: MockRequestLog[] = [];
  private failureRules: MockFailureRule[] = [];
  private latencyMs = 0;
  private authTokens: Set<string>;

  // Internal In-Memory State
  public nodes: Array<{
    name: string;
    ipv4Address: string;
    role: "publisher" | "subscriber";
    version: string;
    status: "Online" | "Offline" | "NotFound";
    risReturnCode: "Ok" | "NotFound" | "SearchLimitExceeded";
  }> = [];

  public phones: Array<{
    name: string;
    description: string;
    model: string;
    product: string;
    protocol: "SIP" | "SCCP";
    status: "Registered" | "UnRegistered" | "Rejected";
    ipAddress: string;
    activeNode: string;
    lines: Array<{
      index: number;
      pattern: string;
      description?: string;
      routePartition?: string;
    }>;
    lastActiveAt?: string;
  }> = [];

  public callSessions: Array<{
    id: string;
    callingNumber: string;
    calledNumber: string;
    callingDevice?: string;
    calledDevice?: string;
    state: "created" | "connected" | "disconnected" | "Held" | "Terminated";
    durationSeconds: number;
    codec: string;
    packetLossPercent: number;
    activeNode: string;
    startedAt: string;
    endedAt?: string;
    terminationReason?: string;
    curriPolicyEvaluated?: boolean;
    curriDecision?: string;
  }> = [];

  public curriEvents: Array<{
    id: string;
    callId?: string;
    callingNumber: string;
    calledNumber: string;
    policyProfile: string;
    action: "permit" | "deny" | "divert" | "block";
    decision?: "permit" | "deny" | "divert";
    divertTarget?: string;
    redirectNumber?: string;
    reason: string;
    evaluatedAt: string;
  }> = [];

  public cdrRecords: Array<{
    id?: string;
    cdrRecordType: number;
    globalCallID_callId: number;
    origLegCallIdentifier: number;
    dateTimeOrigination: number;
    dateTimeConnect: number;
    dateTimeDisconnect: number;
    callingPartyNumber: string;
    originalCalledPartyNumber: string;
    finalCalledPartyNumber: string;
    duration: number;
    origDeviceName: string;
    destDeviceName: string;
    origNodeId: string | number;
    destNodeId: string | number;
    origCause_value: number;
    destCause_value: number;
    outboundBytes: number;
    inboundBytes: number;
  }> = [];

  public cmrRecords: Array<{
    id?: string;
    cdrRecordType: number;
    globalCallID_callId: number;
    nodeId: string | number;
    directoryNum: string;
    callIdentifier: number;
    dateTimeStamp: number;
    numberPacketsSent: number;
    numberPacketsReceived: number;
    numberPacketsLost: number;
    jitter: number;
    latency: number;
  }> = [];

  public syslogEvents: Array<{
    id: string;
    facility: string;
    severity: string;
    source: string;
    message: string;
    timestamp: string;
  }> = [];

  public snapshots: Map<string, {
    snapshotId: string;
    createdAt: string;
    state: Record<string, unknown>;
  }> = new Map();

  public inventory: Map<string, Array<Record<string, unknown>>> = new Map();

  constructor(options: MockServerOptions = {}) {
    this.latencyMs = options.initialLatencyMs ?? 0;
    this.authTokens = new Set(options.authTokens ?? []);
    this.app = express();
    this.initMiddleware();
    this.initRoutes();
    this.seedState(options.seedProfile ?? "lab-small", options.defaultPhoneCount);
  }

  private initMiddleware(): void {
    this.app.use(express.json({ limit: "20mb" }));
    this.app.use(express.urlencoded({ extended: true }));

    // Request Logging & Latency Simulation
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      this.requestHistory.push({
        method: req.method,
        url: req.originalUrl || req.url,
        path: req.path,
        query: req.query as Record<string, unknown>,
        headers: req.headers,
        body: req.body,
        timestamp: new Date().toISOString(),
      });

      // Check auth tokens if registered
      if (this.authTokens.size > 0) {
        const authHeader = req.headers.authorization;
        const token = authHeader?.replace(/^Bearer\s+/i, "");
        if (!token || !this.authTokens.has(token)) {
          return res.status(401).json({
            error: "Unauthorized",
            message: "Invalid or missing Bearer token",
          });
        }
      }

      // Check Failure Rules
      for (const rule of this.failureRules) {
        const matched =
          typeof rule.pattern === "string"
            ? req.path.includes(rule.pattern)
            : rule.pattern.test(req.path);
        if (matched) {
          return res.status(rule.statusCode).json(
            rule.responseBody ?? {
              error: "Injected Mock Error",
              path: req.path,
              statusCode: rule.statusCode,
            }
          );
        }
      }

      if (this.latencyMs > 0) {
        setTimeout(next, this.latencyMs);
      } else {
        next();
      }
    });
  }

  private initRoutes(): void {
    const normalizePath = (endpoint: string) => [endpoint, `/api/v2${endpoint.replace(/^\/api/, "")}`, `/api${endpoint.replace(/^\/api/, "")}`];

    // 1. System Summary & OpenAPI Spec
    this.app.get(["/api/summary", "/api/v2/summary"], (_req: Request, res: Response) => {
      res.json({
        clusterName: "CT-LAB-CLUSTER",
        version: "15.0",
        nodes: this.nodes,
        nodesCount: this.nodes.length,
        phonesCount: this.phones.length,
        registeredPhonesCount: this.phones.filter((p) => p.status === "Registered").length,
        activeCallsCount: this.callSessions.filter((c) => c.state === "connected" || c.state === "Held").length,
        cdrCount: this.cdrRecords.length,
        cmrCount: this.cmrRecords.length,
        switches: [
          { name: "SW-ACCESS-01", managementIpAddress: "192.168.125.2", model: "WS-C2960X-24PD-L", site: "HQ", ports: [] },
        ],
        uptimeSeconds: 86400,
        status: "HEALTHY",
      });
    });

    this.app.get(["/api/openapi.json", "/api/v2/openapi.json"], (_req: Request, res: Response) => {
      const contractPath = path.resolve(__dirname, "../../contracts/openapi.json");
      if (fs.existsSync(contractPath)) {
        res.sendFile(contractPath);
      } else {
        res.json({ openapi: "3.1.0", info: { title: "Mock CUCM Emulator", version: "0.1.0" } });
      }
    });

    // 2. Topology
    this.app.get(["/api/topology", "/api/v2/topology"], (_req: Request, res: Response) => {
      res.json({
        clusterName: "CT-LAB-CLUSTER",
        version: "15.0",
        nodes: this.nodes,
        switches: [
          { name: "SW-ACCESS-01", managementIpAddress: "192.168.125.2", model: "WS-C2960X-24PD-L", site: "HQ", ports: [] },
        ],
        publisher: this.nodes.find((n) => n.role === "publisher") || this.nodes[0],
        subscribers: this.nodes.filter((n) => n.role === "subscriber"),
        callManagerGroups: [
          {
            name: "Default-CMG",
            members: this.nodes.map((n, i) => ({ node: n.name, priority: i + 1 })),
          },
        ],
      });
    });

    // 3. SQL Query
    this.app.post(["/api/sql", "/api/v2/sql"], (req: Request, res: Response) => {
      const { query } = req.body;
      if (!query) {
        return res.status(400).json({ error: "Missing SQL query" });
      }
      const q = String(query).toLowerCase();
      if (q.includes("processnode")) {
        return res.json({
          rows: this.nodes.map((n, idx) => ({ pkid: `node-${idx + 1}`, name: n.name, ipv4: n.ipv4Address })),
          rowCount: this.nodes.length,
        });
      }
      if (q.includes("device")) {
        return res.json({
          rows: this.phones.map((p, idx) => ({ pkid: `dev-${idx + 1}`, name: p.name, description: p.description })),
          rowCount: this.phones.length,
        });
      }
      res.json({
        rows: [{ result: "OK", query }],
        rowCount: 1,
      });
    });

    // 4. Inventory CRUD (Generic + Specific)
    this.app.get(["/api/inventory/:resource", "/api/v2/inventory/:resource"], (req: Request, res: Response) => {
      const resource = String(req.params.resource || "").toLowerCase();
      if (resource === "nodes") {
        return res.json(this.nodes);
      }
      if (resource === "phones") {
        const { status, node, line } = req.query;
        let list = [...this.phones];
        if (status) list = list.filter((p) => p.status.toLowerCase() === String(status).toLowerCase());
        if (node) list = list.filter((p) => p.activeNode.toLowerCase() === String(node).toLowerCase());
        if (line) list = list.filter((p) => p.lines.some((l) => l.pattern === String(line)));
        return res.json(list);
      }
      const items = this.inventory.get(resource) || [];
      res.json(items);
    });

    this.app.get(["/api/inventory/:resource/:id", "/api/v2/inventory/:resource/:id"], (req: Request, res: Response) => {
      const resource = String(req.params.resource || "").toLowerCase();
      const id = decodeURIComponent(String(req.params.id || ""));
      if (resource === "nodes") {
        const node = this.nodes.find((n) => n.name.toLowerCase() === id.toLowerCase());
        if (!node) return res.status(404).json({ error: `Node "${id}" not found` });
        return res.json(node);
      }
      if (resource === "phones") {
        const phone = this.phones.find((p) => p.name.toLowerCase() === id.toLowerCase() || p.ipAddress === id);
        if (!phone) return res.status(404).json({ error: `Phone "${id}" not found` });
        return res.json(phone);
      }
      const items = this.inventory.get(resource) || [];
      const found = items.find((i: any) => i.id === id || i.name === id);
      if (!found) return res.status(404).json({ error: `Item "${id}" not found in ${resource}` });
      res.json(found);
    });

    this.app.post(["/api/inventory/:resource", "/api/v2/inventory/:resource"], (req: Request, res: Response) => {
      const resource = String(req.params.resource || "").toLowerCase();
      const payload = req.body;
      const list = this.inventory.get(resource) || [];
      list.push(payload);
      this.inventory.set(resource, list);
      res.status(201).json({ success: true, resource, item: payload });
    });

    this.app.patch(["/api/inventory/:resource/:id", "/api/v2/inventory/:resource/:id"], (req: Request, res: Response) => {
      const resource = String(req.params.resource || "").toLowerCase();
      const id = decodeURIComponent(String(req.params.id || ""));
      const payload = req.body;

      if (resource === "nodes") {
        const node = this.nodes.find((n) => n.name.toLowerCase() === id.toLowerCase());
        if (!node) return res.status(404).json({ error: `Node "${id}" not found` });
        Object.assign(node, payload);
        return res.json(node);
      }
      if (resource === "phones") {
        const phone = this.phones.find((p) => p.name.toLowerCase() === id.toLowerCase() || p.ipAddress === id);
        if (!phone) return res.status(404).json({ error: `Phone "${id}" not found` });
        Object.assign(phone, payload);
        return res.json(phone);
      }

      const items = this.inventory.get(resource) || [];
      const found = items.find((i: any) => i.id === id || i.name === id);
      if (!found) return res.status(404).json({ error: `Item "${id}" not found` });
      Object.assign(found, payload);
      res.json(found);
    });

    this.app.delete(["/api/inventory/:resource/:id", "/api/v2/inventory/:resource/:id"], (req: Request, res: Response) => {
      const resource = String(req.params.resource || "").toLowerCase();
      const id = decodeURIComponent(String(req.params.id || ""));
      const items = this.inventory.get(resource) || [];
      const idx = items.findIndex((i: any) => i.id === id || i.name === id);
      if (idx !== -1) {
        items.splice(idx, 1);
        return res.json({ success: true, deletedId: id });
      }
      res.status(404).json({ error: `Item "${id}" not found in ${resource}` });
    });

    // 5. Phone Web Scrape
    this.app.get(["/emulated-phone/:nameOrIp/*", "/emulated-phone-ip/:nameOrIp/*", "/api/phones/:nameOrIp/web"], (req: Request, res: Response) => {
      const identifier = String(req.params.nameOrIp || "");
      const format = String(req.query.format || "xml").toLowerCase();
      const phone = this.phones.find(
        (p) => p.name.toLowerCase() === identifier.toLowerCase() || p.ipAddress === identifier
      );

      if (!phone) {
        return res.status(404).json({ error: `Phone "${identifier}" not found` });
      }

      if (format === "html") {
        return res.send(`<html><body><h1>Cisco Unified IP Phone ${phone.name}</h1><p>Model: ${phone.model}</p><p>Status: ${phone.status}</p><p>IP: ${phone.ipAddress}</p></body></html>`);
      }
      res.type("application/xml").send(
        `<CiscoIPPhoneResponse><DeviceName>${phone.name}</DeviceName><Model>${phone.model}</Model><Status>${phone.status}</Status><IPAddress>${phone.ipAddress}</IPAddress><ActiveNode>${phone.activeNode}</ActiveNode></CiscoIPPhoneResponse>`
      );
    });

    // 6. Calls & Sessions
    this.app.get(["/api/calls/sessions", "/api/v2/call-sessions"], (req: Request, res: Response) => {
      const { state, limit } = req.query;
      let list = [...this.callSessions];
      if (state) list = list.filter((c) => c.state.toLowerCase() === String(state).toLowerCase());
      const lim = limit ? parseInt(String(limit), 10) : list.length;
      res.json(list.slice(0, lim));
    });

    this.app.post(["/api/calls/sessions", "/api/v2/call-sessions"], (req: Request, res: Response) => {
      const {
        callingNumber = "1001",
        calledNumber = "1002",
        duration = 30,
        codec = "G.711u",
        packetLossPercent = 0,
      } = req.body;

      const sessionId = `call-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      const activeNode = this.nodes.find((n) => n.status === "Online")?.name || "cucm-pub";
      const sourceDevice = `SEP${callingNumber.padStart(12, "0")}`;
      const destDevice = `SEP${calledNumber.padStart(12, "0")}`;

      const callSession = {
        id: sessionId,
        callingNumber,
        calledNumber,
        callingDevice: sourceDevice,
        calledDevice: destDevice,
        state: "connected" as const,
        durationSeconds: Number(duration),
        codec: String(codec),
        packetLossPercent: Number(packetLossPercent),
        activeNode,
        startedAt: new Date().toISOString(),
      };

      this.callSessions.push(callSession);

      const result = {
        sessionId,
        state: "connected" as const,
        callingNumber,
        calledNumber,
        finalCalledNumber: calledNumber,
        sourceDeviceName: sourceDevice,
        destinationDeviceName: destDevice,
        duration: Number(duration),
        callSession: {
          ...callSession,
          routing: {
            targetKind: calledNumber.startsWith("91") ? "route-pattern" : "phone",
            targetName: destDevice,
            transformedCalledNumber: calledNumber,
            destinationType: calledNumber.startsWith("91") ? "route-pattern" : "internal-line",
          },
          media: {
            codec: String(codec),
            packetLossPercent: Number(packetLossPercent),
          },
          events: [],
          legs: [],
          mediaLegs: [],
        },
        cdr: {
          cdrRecordType: 1,
          globalCallID_callId: Math.floor(Math.random() * 1000000),
          duration: Number(duration),
        },
      };

      res.status(201).json(result);
    });

    this.app.get(["/api/calls/sessions/:id", "/api/v2/call-sessions/:id"], (req: Request, res: Response) => {
      const id = decodeURIComponent(String(req.params.id || ""));
      const call = this.callSessions.find((c) => c.id === id);
      if (!call) return res.status(404).json({ error: `Call session "${id}" not found` });
      res.json(call);
    });

    this.app.post(["/api/calls/sessions/:id/events", "/api/v2/call-sessions/:id/events"], (req: Request, res: Response) => {
      const id = decodeURIComponent(String(req.params.id || ""));
      const call = this.callSessions.find((c) => c.id === id);
      if (!call) return res.status(404).json({ error: `Call session "${id}" not found` });
      const action = String(req.body?.type || req.body?.action || "").toLowerCase();
      if (action === "hold") call.state = "Held";
      if (action === "resume") call.state = "connected";
      res.json({ success: true, action, call, state: call.state });
    });

    this.app.delete(["/api/calls/sessions/:id", "/api/v2/call-sessions/:id"], (req: Request, res: Response) => {
      const id = decodeURIComponent(String(req.params.id || ""));
      const idx = this.callSessions.findIndex((c) => c.id === id);
      if (idx === -1) return res.status(404).json({ error: `Call session "${id}" not found` });
      const call = this.callSessions[idx];
      call.state = "Terminated";
      res.json({ success: true, terminatedCall: call, state: "Terminated" });
    });

    // 7. CURRI / ECC Policies
    this.app.get(["/api/curri/events", "/api/v2/artifacts/curri"], (_req: Request, res: Response) => {
      res.json(this.curriEvents);
    });

    this.app.post(["/api/curri/evaluate", "/api/v2/curri/evaluate"], (req: Request, res: Response) => {
      const { callingNumber = "1001", calledNumber = "9999" } = req.body;
      let action: "permit" | "deny" | "divert" = "permit";
      let redirectNumber: string | undefined;
      let reason = "Permitted by default policy";

      if (calledNumber.startsWith("900") || calledNumber === "4444" || callingNumber === "9999") {
        action = "deny";
        reason = "Number in blacklist policy";
      } else if (calledNumber === "8888") {
        action = "divert";
        redirectNumber = "8000";
        reason = "Call redirected to security desk";
      }

      const decision = {
        matched: action !== "permit",
        action,
        reason,
        redirectNumber,
      };

      this.curriEvents.push({
        id: `curri-${Date.now()}`,
        callingNumber,
        calledNumber,
        policyProfile: "default",
        action,
        decision: action,
        divertTarget: redirectNumber,
        redirectNumber,
        reason,
        evaluatedAt: new Date().toISOString(),
      });

      res.json(decision);
    });

    // 8. CDR & CMR Artifacts
    this.app.get(["/api/cdr/records", "/api/v2/artifacts/cdr"], (req: Request, res: Response) => {
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : this.cdrRecords.length;
      res.json({ records: this.cdrRecords.slice(-limit), total: this.cdrRecords.length });
    });

    this.app.get(["/api/cdr/export", "/api/v2/artifacts/cdr/export"], (_req: Request, res: Response) => {
      const header = "cdrRecordType,globalCallID_callId,origLegCallIdentifier,dateTimeOrigination,dateTimeConnect,dateTimeDisconnect,callingPartyNumber,originalCalledPartyNumber,finalCalledPartyNumber,duration,origDeviceName,destDeviceName,origNodeId,destNodeId,origCause_value,destCause_value\n";
      const rows = this.cdrRecords.map((r) =>
        `${r.cdrRecordType},${r.globalCallID_callId},${r.origLegCallIdentifier},${r.dateTimeOrigination},${r.dateTimeConnect},${r.dateTimeDisconnect},"${r.callingPartyNumber}","${r.originalCalledPartyNumber}","${r.finalCalledPartyNumber}",${r.duration},"${r.origDeviceName}","${r.destDeviceName}","${r.origNodeId}","${r.destNodeId}",${r.origCause_value},${r.destCause_value}`
      ).join("\n");
      res.type("text/csv").send(header + rows);
    });

    this.app.post(["/api/cdr/generate", "/api/v2/artifacts/cdr"], (req: Request, res: Response) => {
      const count = req.body.count ? parseInt(String(req.body.count), 10) : 10;
      const pattern = req.body.pattern || "normal";
      const newCdrs = [];
      const nowEpoch = Math.floor(Date.now() / 1000);

      for (let i = 0; i < count; i++) {
        const calling = `10${(i % 50).toString().padStart(2, "0")}`;
        const called = pattern === "abandoned" ? `88${(i % 50).toString().padStart(2, "0")}` : `20${(i % 50).toString().padStart(2, "0")}`;
        const duration = pattern === "abandoned" ? 0 : Math.floor(Math.random() * 120) + 5;
        const cdr = {
          id: `cdr-${Date.now()}-${i}`,
          cdrRecordType: 1,
          globalCallID_callId: Math.floor(Math.random() * 1000000),
          origLegCallIdentifier: Math.floor(Math.random() * 1000000),
          dateTimeOrigination: nowEpoch - duration - 5,
          dateTimeConnect: pattern === "abandoned" ? 0 : nowEpoch - duration,
          dateTimeDisconnect: nowEpoch,
          callingPartyNumber: calling,
          originalCalledPartyNumber: called,
          finalCalledPartyNumber: called,
          duration,
          origDeviceName: `SEP${calling.padStart(12, "0")}`,
          destDeviceName: `SEP${called.padStart(12, "0")}`,
          origNodeId: "cucm-pub",
          destNodeId: "cucm-sub1",
          origCause_value: pattern === "abandoned" ? 16 : 0,
          destCause_value: pattern === "abandoned" ? 16 : 0,
          outboundBytes: duration * 8000,
          inboundBytes: duration * 8000,
        };
        this.cdrRecords.push(cdr);
        newCdrs.push(cdr);
      }

      res.status(201).json({
        generatedCount: newCdrs.length,
        count: newCdrs.length,
        pattern,
        cdrRecords: newCdrs,
        records: newCdrs,
      });
    });

    // 9. Fixtures & Reset
    this.app.post(["/api/fixtures/seed", "/api/v2/fixtures/seed"], (req: Request, res: Response) => {
      const { fixtureProfile = "lab-small", profile = "lab-small", phoneCount } = req.body;
      this.seedState(fixtureProfile || profile, phoneCount);
      res.json({
        success: true,
        profile: fixtureProfile || profile,
        nodesCount: this.nodes.length,
        phonesCount: this.phones.length,
      });
    });

    this.app.post(["/api/fixtures/reset", "/api/v2/fixtures/reset"], (req: Request, res: Response) => {
      const { profile = "lab-small" } = req.body;
      this.seedState(profile);
      res.json({ success: true, message: "Store reset cleanly", profile });
    });

    // 10. Snapshots
    this.app.get(["/api/snapshots", "/api/v2/snapshots"], (_req: Request, res: Response) => {
      res.json(Array.from(this.snapshots.values()));
    });

    this.app.post(["/api/snapshots/export", "/api/v2/snapshots/export"], (_req: Request, res: Response) => {
      const snapshotId = `snap-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const snapshot = {
        snapshotId,
        createdAt: new Date().toISOString(),
        state: {
          nodes: JSON.parse(JSON.stringify(this.nodes)),
          phones: JSON.parse(JSON.stringify(this.phones)),
        },
      };
      this.snapshots.set(snapshotId, snapshot);
      res.status(201).json(snapshot);
    });

    this.app.post(["/api/snapshots/load", "/api/v2/snapshots/load"], (req: Request, res: Response) => {
      const { snapshotId } = req.body;
      const snapshot = this.snapshots.get(snapshotId);
      if (!snapshot) return res.status(404).json({ error: `Snapshot "${snapshotId}" not found` });
      res.json({ success: true, restoredSnapshotId: snapshotId });
    });
  }

  public seedState(profile: "lab-small" | "standard-enterprise" | "empty" = "lab-small", customPhoneCount?: number): void {
    if (profile === "empty") {
      this.nodes = [];
      this.phones = [];
      this.callSessions = [];
      this.curriEvents = [];
      this.cdrRecords = [];
      this.cmrRecords = [];
      this.syslogEvents = [];
      this.snapshots.clear();
      this.inventory.clear();
      return;
    }

    // Seed Nodes
    this.nodes = [
      {
        name: "CUCM-PUB",
        ipv4Address: "192.168.125.10",
        role: "publisher",
        version: "15.0",
        status: "Online",
        risReturnCode: "Ok",
      },
      {
        name: "CUCM-SUB1",
        ipv4Address: "192.168.125.11",
        role: "subscriber",
        version: "15.0",
        status: "Online",
        risReturnCode: "Ok",
      },
      {
        name: "CUCM-SUB2",
        ipv4Address: "192.168.125.12",
        role: "subscriber",
        version: "15.0",
        status: "Online",
        risReturnCode: "Ok",
      },
    ];

    // Seed Phones
    const count = customPhoneCount ?? (profile === "standard-enterprise" ? 100 : 10);
    this.phones = [];
    for (let i = 1; i <= count; i++) {
      const mac = i.toString(16).padStart(12, "0").toUpperCase();
      const dn = (1000 + i).toString();
      const node = i % 2 === 0 ? "cucm-sub1" : "cucm-sub2";
      this.phones.push({
        name: `SEP${mac}`,
        description: `Lab Phone ${i}`,
        model: "Cisco 8845",
        product: "Cisco 8845 IP Phone",
        protocol: "SIP",
        status: "Registered",
        ipAddress: `192.168.125.${50 + (i % 150)}`,
        activeNode: node,
        lines: [
          {
            index: 1,
            pattern: dn,
            description: `Line ${dn}`,
            routePartition: "Internal_PT",
          },
        ],
        lastActiveAt: new Date().toISOString(),
      });
    }

    this.callSessions = [];
    this.curriEvents = [];
    this.cdrRecords = [];
    this.cmrRecords = [];
    this.syslogEvents = [];
  }

  public async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(0, "127.0.0.1", () => {
        const addr = this.server?.address() as AddressInfo;
        this.port = addr.port;
        this.baseUrl = `http://127.0.0.1:${this.port}`;
        resolve(this.baseUrl);
      });
      this.server.on("error", reject);
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public getPort(): number {
    return this.port;
  }

  public setFailureMode(pattern: RegExp | string, statusCode: number, responseBody?: unknown): void {
    this.failureRules.push({ pattern, statusCode, responseBody });
  }

  public clearFailureModes(): void {
    this.failureRules = [];
  }

  public setLatency(ms: number): void {
    this.latencyMs = ms;
  }

  public getRequestHistory(): MockRequestLog[] {
    return [...this.requestHistory];
  }

  public clearRequestHistory(): void {
    this.requestHistory = [];
  }
}
