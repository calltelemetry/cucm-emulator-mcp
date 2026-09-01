import type {
  CucmAuditLogEvent,
  CucmCallingSearchSpace,
  CucmCallManagerGroup,
  CucmCallSession,
  CucmCdrRecord,
  CucmCmrRecord,
  CucmCurriEvent,
  CucmDevicePool,
  CucmExternalCallControlProfile,
  CucmLine,
  CucmNode,
  CucmNodeRole,
  CucmPhone,
  CucmPhoneStatus,
  CucmRisNodeReturnCode,
  CucmRouteGroup,
  CucmRouteList,
  CucmRoutePartition,
  CucmRoutePattern,
  CucmSipTrunk,
  CucmSnapshotManifest,
  CucmState,
  CucmTopologySwitch,
  CucmUser,
  CurriPolicy,
  ResetStoreInput,
  SeedFixturesInput,
  SupportedAxlVersion,
} from "../types/domain.js";
import { EntityNotFoundError, InvalidStateError } from "../types/errors.js";
import { createCustomFixture, createLabSmallFixture } from "./fixtures.js";

/**
 * In-Memory CUCM Entity & State Store.
 * Provides complete in-process cluster state, RIS registrations, inventory CRUD,
 * phone web scraping, snapshot persistence, and dial plan lookup.
 */
export class InMemoryCucmStore {
  public clusterName = "CT-LAB-CLUSTER";
  public version: SupportedAxlVersion = "14.0";

  public readonly nodes = new Map<string, CucmNode>();
  public readonly phones = new Map<string, CucmPhone>();
  public readonly lines = new Map<string, CucmLine>();
  public readonly users = new Map<string, CucmUser>();
  public readonly devicePools = new Map<string, CucmDevicePool>();
  public readonly callManagerGroups = new Map<string, CucmCallManagerGroup>();
  public readonly routePartitions = new Map<string, CucmRoutePartition>();
  public readonly css = new Map<string, CucmCallingSearchSpace>();
  public readonly routePatterns = new Map<string, CucmRoutePattern>();
  public readonly routeGroups = new Map<string, CucmRouteGroup>();
  public readonly routeLists = new Map<string, CucmRouteList>();
  public readonly sipTrunks = new Map<string, CucmSipTrunk>();
  public readonly policies = new Map<string, CurriPolicy>();
  public readonly eccProfiles = new Map<string, CucmExternalCallControlProfile>();
  public readonly switches = new Map<string, CucmTopologySwitch>();

  public readonly callSessions = new Map<string, CucmCallSession>();
  public readonly cdrRecords: CucmCdrRecord[] = [];
  public readonly cmrRecords: CucmCmrRecord[] = [];
  public readonly curriEvents: CucmCurriEvent[] = [];
  public readonly auditLogs: CucmAuditLogEvent[] = [];
  public readonly snapshots = new Map<string, { manifest: CucmSnapshotManifest; state: CucmState }>();

  constructor(initialState?: CucmState) {
    if (initialState) {
      this.loadState(initialState);
    } else {
      this.loadState(createLabSmallFixture());
    }
  }

  /**
   * Loads full state into the store.
   */
  public loadState(state: CucmState): void {
    this.clearAll();
    this.clusterName = state.clusterName || "CT-LAB-CLUSTER";
    this.version = state.version || "14.0";

    for (const node of state.nodes) this.nodes.set(node.name, { ...node });
    for (const phone of state.phones) this.phones.set(phone.name, { ...phone });
    for (const line of state.lines) this.lines.set(line.id, { ...line });
    for (const user of state.users) this.users.set(user.userid, { ...user });
    for (const dp of state.devicePools) this.devicePools.set(dp.name, { ...dp });
    for (const cmg of state.callManagerGroups) this.callManagerGroups.set(cmg.name, { ...cmg });
    for (const rp of state.routePartitions) this.routePartitions.set(rp.name, { ...rp });
    for (const c of state.css) this.css.set(c.name, { ...c });
    for (const rp of state.routePatterns) this.routePatterns.set(rp.name, { ...rp });
    for (const rg of state.routeGroups) this.routeGroups.set(rg.name, { ...rg });
    for (const rl of state.routeLists) this.routeLists.set(rl.name, { ...rl });
    for (const st of state.sipTrunks) this.sipTrunks.set(st.name, { ...st });
    for (const p of state.policies) this.policies.set(p.id, { ...p });
    for (const ecc of state.eccProfiles) this.eccProfiles.set(ecc.name, { ...ecc });
    for (const sw of state.switches) this.switches.set(sw.name, { ...sw });

    this.recordAuditLog("StoreLoaded", "Cluster", `State loaded with ${this.phones.size} phones`);
  }

  /**
   * Clears all entity maps.
   */
  public clearAll(): void {
    this.nodes.clear();
    this.phones.clear();
    this.lines.clear();
    this.users.clear();
    this.devicePools.clear();
    this.callManagerGroups.clear();
    this.routePartitions.clear();
    this.css.clear();
    this.routePatterns.clear();
    this.routeGroups.clear();
    this.routeLists.clear();
    this.sipTrunks.clear();
    this.policies.clear();
    this.eccProfiles.clear();
    this.switches.clear();
    this.callSessions.clear();
    this.cdrRecords.length = 0;
    this.cmrRecords.length = 0;
    this.curriEvents.length = 0;
  }

  /**
   * Resets the store with specified profile or empties it.
   */
  public resetStore(options: ResetStoreInput = {}): { status: string; message: string; entityCounts: Record<string, number> } {
    const profile = options.profile || "lab-small";
    if (profile === "empty") {
      this.clearAll();
      return {
        status: "success",
        message: "Store cleared to empty state",
        entityCounts: this.getEntityCounts(),
      };
    }

    const state = profile === "standard-enterprise"
      ? createCustomFixture({ fixtureProfile: "standard-enterprise" })
      : createLabSmallFixture(this.version);

    this.loadState(state);

    return {
      status: "success",
      message: `Store reset and re-seeded with "${profile}" profile`,
      entityCounts: this.getEntityCounts(),
    };
  }

  /**
   * Seeds the store with custom fixtures.
   */
  public seedFixtures(input: SeedFixturesInput): { status: string; profile: string; counts: Record<string, number> } {
    const state = createCustomFixture(input);
    this.loadState(state);
    return {
      status: "success",
      profile: input.fixtureProfile || "lab-small",
      counts: this.getEntityCounts(),
    };
  }

  /**
   * Returns a cluster summary.
   */
  public getSummary(): Record<string, unknown> {
    let registered = 0;
    let unregistered = 0;
    let rejected = 0;

    for (const phone of this.phones.values()) {
      if (phone.status === "Registered") registered++;
      else if (phone.status === "UnRegistered") unregistered++;
      else rejected++;
    }

    let activeCalls = 0;
    for (const session of this.callSessions.values()) {
      if (session.state !== "disconnected") activeCalls++;
    }

    return {
      clusterName: this.clusterName,
      version: this.version,
      nodes: Array.from(this.nodes.values()),
      counts: {
        nodes: this.nodes.size,
        phones: this.phones.size,
        registeredPhones: registered,
        unregisteredPhones: unregistered,
        rejectedPhones: rejected,
        lines: this.lines.size,
        users: this.users.size,
        activeCalls,
        totalCdrs: this.cdrRecords.length,
        totalCmrs: this.cmrRecords.length,
        curriPolicies: this.policies.size,
        switches: this.switches.size,
      },
    };
  }

  /**
   * Returns network topology.
   */
  public getTopology(): Record<string, unknown> {
    return {
      clusterName: this.clusterName,
      switches: Array.from(this.switches.values()),
      connectedDeviceCount: this.phones.size,
    };
  }

  /**
   * Generic Inventory CRUD Operations.
   */
  public listInventory(resource: string, query: Record<string, unknown> = {}): unknown[] {
    const normalized = resource.toLowerCase().replace(/_/g, "-");
    const map = this.getMapForResource(normalized);
    let items = Array.from(map.values());

    // Apply pattern / name filter if present
    if (typeof query.pattern === "string") {
      const pattern = query.pattern.replace(/%/g, ".*");
      const regex = new RegExp(`^${pattern}$`, "i");
      items = items.filter((item: any) => regex.test(item.name || item.id || item.userid || ""));
    }

    // Apply status filter if present
    if (typeof query.status === "string") {
      items = items.filter((item: any) => item.status === query.status);
    }

    // Apply limit / offset
    const offset = typeof query.offset === "number" ? query.offset : 0;
    const limit = typeof query.limit === "number" ? query.limit : items.length;

    return items.slice(offset, offset + limit);
  }

  public getInventoryItem(resource: string, id: string): unknown {
    const normalized = resource.toLowerCase().replace(/_/g, "-");
    const map = this.getMapForResource(normalized);
    const item = map.get(id);
    if (!item) {
      throw new EntityNotFoundError(resource, id);
    }
    return item;
  }

  public upsertInventory(resource: string, payload: Record<string, unknown>): unknown {
    const normalized = resource.toLowerCase().replace(/_/g, "-");
    const map = this.getMapForResource(normalized);
    const key = (payload.id || payload.name || payload.userid) as string;
    if (!key) {
      throw new InvalidStateError(`Cannot upsert ${resource} without an 'id', 'name', or 'userid' field`);
    }

    map.set(key, payload);
    this.recordAuditLog("ConfigUpdate", resource, `Upserted ${key}`);
    return payload;
  }

  public patchInventory(resource: string, id: string, payload: Record<string, unknown>): unknown {
    const normalized = resource.toLowerCase().replace(/_/g, "-");
    const map = this.getMapForResource(normalized);
    const existing = map.get(id);
    if (!existing) {
      throw new EntityNotFoundError(resource, id);
    }

    const updated = { ...(existing as Record<string, unknown>), ...payload };
    map.set(id, updated);
    this.recordAuditLog("ConfigUpdate", resource, `Patched ${id}`);
    return updated;
  }

  public deleteInventory(resource: string, id: string): boolean {
    const normalized = resource.toLowerCase().replace(/_/g, "-");
    const map = this.getMapForResource(normalized);
    const deleted = map.delete(id);
    if (!deleted) {
      throw new EntityNotFoundError(resource, id);
    }
    this.recordAuditLog("ConfigUpdate", resource, `Deleted ${id}`);
    return true;
  }

  /**
   * ADR 0120/0122 Failover Testing: Updates node status.
   */
  public setNodeStatus(
    nodeName: string,
    role?: CucmNodeRole,
    risReturnCode: CucmRisNodeReturnCode = "Ok"
  ): CucmNode {
    const node = this.nodes.get(nodeName);
    if (!node) {
      throw new EntityNotFoundError("CucmNode", nodeName);
    }

    if (role) node.role = role;
    node.risReturnCode = risReturnCode;
    this.nodes.set(nodeName, node);

    // If node goes offline / NotFound, reassign or unregister phones registered to it
    if (risReturnCode === "NotFound" || risReturnCode === "SearchLimitExceeded") {
      for (const [name, phone] of this.phones.entries()) {
        if (phone.nodeName === nodeName) {
          phone.status = "UnRegistered";
          phone.risNodeRegistrations = phone.risNodeRegistrations.map((reg) =>
            reg.nodeName === nodeName
              ? { ...reg, status: "UnRegistered", statusReason: `Node ${nodeName} offline` }
              : reg
          );
          this.phones.set(name, phone);
        }
      }
    } else if (risReturnCode === "Ok") {
      // Re-register phones if node is back online
      for (const [name, phone] of this.phones.entries()) {
        if (phone.nodeName === nodeName && phone.status === "UnRegistered") {
          phone.status = "Registered";
          phone.risNodeRegistrations = phone.risNodeRegistrations.map((reg) =>
            reg.nodeName === nodeName
              ? { ...reg, status: "Registered", statusReason: "Registered with CUCM" }
              : reg
          );
          this.phones.set(name, phone);
        }
      }
    }

    this.recordAuditLog("RisFailover", "Node", `Node ${nodeName} status set to ${risReturnCode}`);
    return node;
  }

  /**
   * Phone Status & Registration Mutation.
   */
  public setPhoneStatus(phoneName: string, status: CucmPhoneStatus): CucmPhone {
    const phone = this.phones.get(phoneName);
    if (!phone) {
      throw new EntityNotFoundError("CucmPhone", phoneName);
    }

    phone.status = status;
    phone.risNodeRegistrations = phone.risNodeRegistrations.map((reg) => ({
      ...reg,
      status,
      statusReason: status === "Registered" ? "Registered with CUCM" : `Status updated to ${status}`,
      timeStamp: Date.now(),
    }));

    this.phones.set(phoneName, phone);
    this.recordAuditLog("PhoneRegistration", "Phone", `Phone ${phoneName} status set to ${status}`);
    return phone;
  }

  /**
   * Simulates phone web pages (HTML, CGI Execute, Network Stats).
   */
  public getPhoneWeb(
    phoneNameOrIp: string,
    path = "/CGI/Execute",
    format = "json"
  ): Record<string, unknown> {
    let phone: CucmPhone | undefined = this.phones.get(phoneNameOrIp);
    if (!phone) {
      for (const p of this.phones.values()) {
        if (p.ipAddress === phoneNameOrIp || p.network.macAddress === phoneNameOrIp) {
          phone = p;
          break;
        }
      }
    }

    if (!phone) {
      throw new EntityNotFoundError("CucmPhoneWeb", phoneNameOrIp);
    }

    if (path.includes("NetworkConfiguration") || path.includes("network")) {
      return {
        phoneName: phone.name,
        ipAddress: phone.ipAddress,
        macAddress: phone.network.macAddress,
        subnetMask: phone.network.subnetMask,
        defaultGateway: phone.network.defaultGateway,
        dnsServers: phone.network.dnsServers,
        domainName: phone.network.domainName,
        switchName: phone.network.switchName,
        switchPort: phone.network.switchPort,
        stats: phone.network.stats,
      };
    }

    if (path.includes("Screenshot") || path.includes("lcd.bmp")) {
      return {
        phoneName: phone.name,
        ipAddress: phone.ipAddress,
        path,
        contentType: "image/bmp",
        encoding: "base64",
        bodyBase64: Buffer.from("BM").toString("base64"),
      };
    }

    if (path.includes("DeviceInformation") || path.includes("info")) {
      return {
        phoneName: phone.name,
        model: phone.model,
        modelName: phone.modelName,
        activeLoadId: phone.activeLoadId,
        serialNumber: phone.serialNumber,
        status: phone.status,
        protocol: phone.protocol,
      };
    }

    // Default: CGI Execute response
    return {
      phoneName: phone.name,
      ipAddress: phone.ipAddress,
      endpoint: path,
      format,
      htmlFlavor: phone.web.htmlFlavor,
      responseXml: `<CiscoIPPhoneResponse><ResponseItem Status="0" Data="Success" /></CiscoIPPhoneResponse>`,
      statusMessages: phone.statusMessages,
    };
  }

  /**
   * Snapshot Operations.
   */
  public exportSnapshot(name = "snapshot"): { manifest: CucmSnapshotManifest; state: CucmState } {
    const id = `snap-${Date.now()}`;
    const manifest: CucmSnapshotManifest = {
      id,
      name,
      schemaVersion: "1.0",
      createdAt: new Date().toISOString(),
      emulatorVersion: "0.1.0",
      clusterVersion: this.version,
      clusterName: this.clusterName,
      entityCounts: this.getEntityCounts(),
    };

    const state: CucmState = {
      clusterName: this.clusterName,
      version: this.version,
      nodes: Array.from(this.nodes.values()),
      phones: Array.from(this.phones.values()),
      lines: Array.from(this.lines.values()),
      users: Array.from(this.users.values()),
      devicePools: Array.from(this.devicePools.values()),
      callManagerGroups: Array.from(this.callManagerGroups.values()),
      routePartitions: Array.from(this.routePartitions.values()),
      css: Array.from(this.css.values()),
      routePatterns: Array.from(this.routePatterns.values()),
      routeGroups: Array.from(this.routeGroups.values()),
      routeLists: Array.from(this.routeLists.values()),
      sipTrunks: Array.from(this.sipTrunks.values()),
      policies: Array.from(this.policies.values()),
      eccProfiles: Array.from(this.eccProfiles.values()),
      switches: Array.from(this.switches.values()),
    };

    const snapshot = { manifest, state };
    this.snapshots.set(id, snapshot);
    return snapshot;
  }

  public loadSnapshot(snapshotId: string): { status: string; manifest: CucmSnapshotManifest } {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) {
      throw new EntityNotFoundError("CucmSnapshot", snapshotId);
    }

    this.loadState(snapshot.state);
    return { status: "success", manifest: snapshot.manifest };
  }

  public getEntityCounts(): Record<string, number> {
    return {
      nodes: this.nodes.size,
      phones: this.phones.size,
      lines: this.lines.size,
      users: this.users.size,
      devicePools: this.devicePools.size,
      callManagerGroups: this.callManagerGroups.size,
      routePartitions: this.routePartitions.size,
      css: this.css.size,
      routePatterns: this.routePatterns.size,
      routeGroups: this.routeGroups.size,
      routeLists: this.routeLists.size,
      sipTrunks: this.sipTrunks.size,
      policies: this.policies.size,
      eccProfiles: this.eccProfiles.size,
      switches: this.switches.size,
      callSessions: this.callSessions.size,
      cdrs: this.cdrRecords.length,
      cmrs: this.cmrRecords.length,
    };
  }

  private getMapForResource(resource: string): Map<string, unknown> {
    switch (resource) {
      case "nodes": return this.nodes as unknown as Map<string, unknown>;
      case "phones": return this.phones as unknown as Map<string, unknown>;
      case "lines": return this.lines as unknown as Map<string, unknown>;
      case "users": return this.users as unknown as Map<string, unknown>;
      case "device-pools": return this.devicePools as unknown as Map<string, unknown>;
      case "callmanager-groups": return this.callManagerGroups as unknown as Map<string, unknown>;
      case "route-partitions": return this.routePartitions as unknown as Map<string, unknown>;
      case "css": return this.css as unknown as Map<string, unknown>;
      case "route-patterns": return this.routePatterns as unknown as Map<string, unknown>;
      case "route-groups": return this.routeGroups as unknown as Map<string, unknown>;
      case "route-lists": return this.routeLists as unknown as Map<string, unknown>;
      case "sip-trunks": return this.sipTrunks as unknown as Map<string, unknown>;
      case "policies": return this.policies as unknown as Map<string, unknown>;
      case "ecc-profiles": return this.eccProfiles as unknown as Map<string, unknown>;
      case "switches": return this.switches as unknown as Map<string, unknown>;
      default:
        throw new EntityNotFoundError("InventoryResource", resource);
    }
  }

  private recordAuditLog(eventType: string, resourceAccessed: string, details: string): void {
    this.auditLogs.push({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: Date.now(),
      nodeName: "CUCM-PUB",
      severity: 6,
      eventType,
      resourceAccessed,
      eventStatus: "Success",
      userId: "mcp-agent",
      clientAddress: "127.0.0.1",
      details,
    });
  }
}
