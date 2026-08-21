import type { ICucmEmulatorClient } from "../../client/interface.js";
import type { McpTool, McpToolResult } from "../types.js";
import { inferToolAnnotations } from "../annotations.js";

/**
 * emu_simulate_call: Simulates a call between endpoints or external PSTN with RTP metrics and CDR generation.
 */
export const emuSimulateCallTool: McpTool = {
  name: "emu_simulate_call",
  description: "Simulates an end-to-end telephone call through CUCM dial plan routing, calculating RTP media metrics and emitting synthetic CDR/CMR records.",
  inputSchema: {
    type: "object",
    properties: {
      callingNumber: {
        type: "string",
        description: "Calling party directory number (e.g. 1001, +15551234567)",
      },
      calledNumber: {
        type: "string",
        description: "Called destination directory number or pattern (e.g. 1002, 915551234567)",
      },
      duration: {
        type: "number",
        minimum: 0,
        description: "Call duration in seconds (default: 30)",
      },
      codec: {
        type: "string",
        enum: ["G.711u", "G.711a", "G.729", "G.722", "OPUS"],
        description: "Audio codec negotiated for media legs (default: G.711u)",
      },
      packetLossPct: {
        type: "number",
        minimum: 0,
        maximum: 100,
        description: "Simulated RTP network packet loss percentage (0-100)",
      },
      callingSearchSpaceName: {
        type: "string",
        description: "Calling Search Space (CSS) used for dial plan partition analysis",
      },
    },
    required: ["callingNumber", "calledNumber"],
    additionalProperties: false,
  },
  annotations: inferToolAnnotations("emu_simulate_call", "POST", ["calls"]),
  async execute(args: Record<string, unknown>, client: ICucmEmulatorClient): Promise<McpToolResult> {
    try {
      const result = await client.simulateCall(args as any);
      return {
        content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: err?.message || String(err) }],
        isError: true,
      };
    }
  },
};

/**
 * emu_call_action: Executes mid-call control actions (answer, hold, resume, drop).
 */
export const emuCallActionTool: McpTool = {
  name: "emu_call_action",
  description: "Executes mid-call state transitions such as answering, holding, resuming, or disconnecting an active call session.",
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Unique call session ID",
      },
      action: {
        type: "string",
        enum: ["answer", "hold", "resume", "drop"],
        description: "Action to perform on the call session",
      },
      reason: {
        type: "string",
        description: "Optional disconnect or action reason (e.g. NormalClearing, UserBusy)",
      },
    },
    required: ["sessionId", "action"],
    additionalProperties: false,
  },
  annotations: inferToolAnnotations("emu_call_action", "POST", ["calls"]),
  async execute(args: Record<string, unknown>, client: ICucmEmulatorClient): Promise<McpToolResult> {
    try {
      const sessionId = String(args.sessionId);
      const action = String(args.action);
      const reason = args.reason ? String(args.reason) : undefined;
      const result = await client.executeCallAction(sessionId, action, reason);
      return {
        content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: err?.message || String(err) }],
        isError: true,
      };
    }
  },
};

/**
 * emu_list_active_calls: Lists currently active call sessions in the emulator.
 */
export const emuListActiveCallsTool: McpTool = {
  name: "emu_list_active_calls",
  description: "Lists active or in-progress telephone call sessions and their current state (alerting, connected, policy-pending, held).",
  inputSchema: {
    type: "object",
    properties: {
      state: {
        type: "string",
        enum: ["alerting", "connected", "policy-pending", "held", "disconnected"],
        description: "Optional filter by call session state",
      },
      limit: {
        type: "integer",
        description: "Maximum number of call sessions to return",
      },
    },
    additionalProperties: false,
  },
  annotations: inferToolAnnotations("emu_list_active_calls", "GET", ["calls"]),
  async execute(args: Record<string, unknown>, client: ICucmEmulatorClient): Promise<McpToolResult> {
    try {
      const calls = await client.listActiveCalls(args as any);
      return {
        content: [{ type: "text", text: JSON.stringify(calls, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: err?.message || String(err) }],
        isError: true,
      };
    }
  },
};

export const callsDomainTools: McpTool[] = [
  emuSimulateCallTool,
  emuCallActionTool,
  emuListActiveCallsTool,
];
