import type {
  CurriDecision,
  CurriEvaluationInput,
  GenerateCdrInput,
  GenerateCdrResult,
  SeedFixturesInput,
  SimulateCallInput,
  SimulatedCallResult,
} from "../types/domain.js";

/**
 * Unified Client Interface for CUCM Emulator MCP operations.
 * Both live HTTP and in-memory mock store backends implement this interface.
 */
export interface ICucmEmulatorClient {
  readonly mode: "http" | "mock";

  getSummary(): Promise<Record<string, unknown>>;
  getTopology(): Promise<Record<string, unknown>>;

  listInventory(resource: string, query?: Record<string, unknown>): Promise<unknown[]>;
  getInventoryItem(resource: string, id: string): Promise<unknown>;
  upsertInventory(resource: string, payload: Record<string, unknown>): Promise<unknown>;
  patchInventory(resource: string, id: string, payload: Record<string, unknown>): Promise<unknown>;
  deleteInventory(resource: string, id: string): Promise<boolean>;

  setNodeStatus(nodeName: string, role?: string, risReturnCode?: string): Promise<unknown>;
  setPhoneStatus(phoneName: string, status: string): Promise<unknown>;

  simulateCall(input: SimulateCallInput): Promise<SimulatedCallResult>;
  executeCallAction(sessionId: string, action: string, reason?: string): Promise<unknown>;
  listActiveCalls(query?: { state?: string; limit?: number }): Promise<unknown[]>;

  evaluateCurri(input: CurriEvaluationInput): Promise<CurriDecision>;
  getCurriHistory(query?: { limit?: number; callId?: string }): Promise<unknown[]>;

  getPhoneWeb(phoneNameOrIp: string, path?: string, format?: string): Promise<unknown>;

  generateCdrs(input: GenerateCdrInput): Promise<GenerateCdrResult>;
  getCdrHistory(query?: { limit?: number; callId?: string; format?: string }): Promise<unknown>;

  resetStore(mode?: string, profile?: string): Promise<unknown>;
  seedFixtures(input: SeedFixturesInput): Promise<unknown>;

  executeGenericOperation(
    method: string,
    pathTemplate: string,
    params: Record<string, unknown>
  ): Promise<unknown>;
}
