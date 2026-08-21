import type { ICucmEmulatorClient } from "./interface.js";
import type {
  CurriDecision,
  CurriEvaluationInput,
  GenerateCdrInput,
  GenerateCdrResult,
  SeedFixturesInput,
  SimulateCallInput,
  SimulatedCallResult,
  SupportedAxlVersion,
} from "../types/domain.js";
import { InMemoryCucmStore } from "../mock/store.js";
import {
  evaluateCurri,
  executeCallAction,
  generateCdrs,
  listActiveCalls,
  simulateCall,
} from "../mock/simulator.js";

/**
 * Direct In-Memory Store Client.
 * Backed directly by InMemoryCucmStore for offline zero-config operations and unit testing.
 */
export class DirectStoreCucmClient implements ICucmEmulatorClient {
  public readonly mode = "mock" as const;
  public readonly store: InMemoryCucmStore;

  constructor(store?: InMemoryCucmStore) {
    this.store = store || new InMemoryCucmStore();
  }

  public async getSummary(): Promise<Record<string, unknown>> {
    return this.store.getSummary();
  }

  public async getTopology(): Promise<Record<string, unknown>> {
    return this.store.getTopology();
  }

  public async listInventory(resource: string, query?: Record<string, unknown>): Promise<unknown[]> {
    return this.store.listInventory(resource, query);
  }

  public async getInventoryItem(resource: string, id: string): Promise<unknown> {
    return this.store.getInventoryItem(resource, id);
  }

  public async upsertInventory(resource: string, payload: Record<string, unknown>): Promise<unknown> {
    return this.store.upsertInventory(resource, payload);
  }

  public async patchInventory(
    resource: string,
    id: string,
    payload: Record<string, unknown>
  ): Promise<unknown> {
    return this.store.patchInventory(resource, id, payload);
  }

  public async deleteInventory(resource: string, id: string): Promise<boolean> {
    return this.store.deleteInventory(resource, id);
  }

  public async setNodeStatus(
    nodeName: string,
    role?: string,
    risReturnCode = "Ok"
  ): Promise<unknown> {
    return this.store.setNodeStatus(nodeName, role as any, risReturnCode as any);
  }

  public async setPhoneStatus(phoneName: string, status: string): Promise<unknown> {
    return this.store.setPhoneStatus(phoneName, status as any);
  }

  public async simulateCall(input: SimulateCallInput): Promise<SimulatedCallResult> {
    return simulateCall(this.store, input);
  }

  public async executeCallAction(sessionId: string, action: string, reason?: string): Promise<unknown> {
    return executeCallAction(this.store, sessionId, action as any, reason);
  }

  public async listActiveCalls(query?: { state?: string; limit?: number }): Promise<unknown[]> {
    return listActiveCalls(this.store, query);
  }

  public async evaluateCurri(input: CurriEvaluationInput): Promise<CurriDecision> {
    return evaluateCurri(this.store, input);
  }

  public async getCurriHistory(query?: { limit?: number; callId?: string }): Promise<unknown[]> {
    let events = [...this.store.curriEvents];
    if (query?.callId) {
      events = events.filter((e) => e.callingNumber === query.callId || e.calledNumber === query.callId);
    }
    if (query?.limit && query.limit > 0) {
      events = events.slice(0, query.limit);
    }
    return events;
  }

  public async getPhoneWeb(
    phoneNameOrIp: string,
    path = "/CGI/Execute",
    format = "json"
  ): Promise<unknown> {
    return this.store.getPhoneWeb(phoneNameOrIp, path, format);
  }

  public async generateCdrs(input: GenerateCdrInput): Promise<GenerateCdrResult> {
    return generateCdrs(this.store, input);
  }

  public async getCdrHistory(query?: { limit?: number; callId?: string; format?: string }): Promise<unknown> {
    let cdrs = [...this.store.cdrRecords];
    if (query?.callId) {
      cdrs = cdrs.filter((c) => c.callId === query.callId || c.globalCallID_callId.toString() === query.callId);
    }
    if (query?.limit && query.limit > 0) {
      cdrs = cdrs.slice(0, query.limit);
    }
    if (query?.format === "csv") {
      if (cdrs.length === 0) return "id,callId,callingPartyNumber,finalCalledPartyNumber,duration\n";
      const headers = Object.keys(cdrs[0]).join(",");
      const rows = cdrs.map((c) => Object.values(c).map((v) => `"${v}"`).join(","));
      return [headers, ...rows].join("\n");
    }
    return cdrs;
  }

  public async resetStore(mode = "soft", profile = "lab-small"): Promise<unknown> {
    return this.store.resetStore({ mode: mode as any, profile: profile as any });
  }

  public async seedFixtures(input: SeedFixturesInput): Promise<unknown> {
    return this.store.seedFixtures(input);
  }

  public async executeGenericOperation(
    method: string,
    pathTemplate: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const httpMethod = method.toUpperCase();
    const cleanPath = pathTemplate.replace(/^\/api\/v\d+\//, "");

    if (cleanPath === "summary") {
      return this.getSummary();
    }
    if (cleanPath === "topology") {
      return this.getTopology();
    }
    if (cleanPath.startsWith("inventory/")) {
      const resource = (params.resource as string) || cleanPath.split("/")[1];
      const id = (params.id as string) || cleanPath.split("/")[2];

      if (httpMethod === "GET") {
        return id ? this.getInventoryItem(resource, id) : this.listInventory(resource, params);
      }
      if (httpMethod === "POST" || httpMethod === "PUT") {
        return this.upsertInventory(resource, params);
      }
      if (httpMethod === "PATCH" && id) {
        return this.patchInventory(resource, id, params);
      }
      if (httpMethod === "DELETE" && id) {
        return { deleted: await this.deleteInventory(resource, id) };
      }
    }
    if (cleanPath.startsWith("call-sessions")) {
      if (httpMethod === "GET") {
        const id = (params.id as string) || cleanPath.split("/")[1];
        if (id) {
          const session = this.store.callSessions.get(id);
          if (!session) throw new Error(`Call session "${id}" not found`);
          return session;
        }
        return this.listActiveCalls(params as any);
      }
      if (httpMethod === "POST") {
        return this.simulateCall(params as any);
      }
    }
    if (cleanPath.startsWith("artifacts/cdr")) {
      return this.getCdrHistory(params as any);
    }
    if (cleanPath.startsWith("artifacts/curri")) {
      return this.getCurriHistory(params as any);
    }
    if (cleanPath.startsWith("snapshots")) {
      if (httpMethod === "GET") {
        return Array.from(this.store.snapshots.values()).map((s) => s.manifest);
      }
      if (httpMethod === "POST") {
        return this.store.exportSnapshot(params.name as string);
      }
    }

    // Default generic fallback
    return {
      status: "executed",
      method: httpMethod,
      path: pathTemplate,
      params,
    };
  }
}
