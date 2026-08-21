import type { ICucmEmulatorClient } from "../../client/interface.js";
import type { McpTool, McpToolResult } from "../types.js";
import { inferToolAnnotations } from "../annotations.js";

/**
 * emu_evaluate_curri: Evaluates external CURRI / ECC routing policies.
 */
export const emuEvaluateCurriTool: McpTool = {
  name: "emu_evaluate_curri",
  description: "Evaluates external call routing policies via Cisco External Call Control (CURRI / ECC), returning permit, deny, or divert routing decisions.",
  inputSchema: {
    type: "object",
    properties: {
      callingNumber: {
        type: "string",
        description: "Calling party directory number (e.g. 1001)",
      },
      calledNumber: {
        type: "string",
        description: "Called party destination number (e.g. 9005551234, 4444)",
      },
      callingSearchSpaceName: {
        type: "string",
        description: "Optional Calling Search Space name",
      },
      policyProfile: {
        type: "string",
        description: "Optional policy profile identifier",
      },
    },
    required: ["callingNumber", "calledNumber"],
    additionalProperties: false,
  },
  annotations: inferToolAnnotations("emu_evaluate_curri", "POST", ["curri"]),
  async execute(args: Record<string, unknown>, client: ICucmEmulatorClient): Promise<McpToolResult> {
    try {
      const result = await client.evaluateCurri(args as any);
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
 * emu_get_curri_history: Retrieves historical CURRI policy evaluation records.
 */
export const emuGetCurriHistoryTool: McpTool = {
  name: "emu_get_curri_history",
  description: "Retrieves the log of past CURRI / ECC routing evaluation decisions and rule matches.",
  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "integer",
        description: "Maximum number of history records to return",
      },
      callId: {
        type: "string",
        description: "Optional call ID filter",
      },
    },
    additionalProperties: false,
  },
  annotations: inferToolAnnotations("emu_get_curri_history", "GET", ["curri"]),
  async execute(args: Record<string, unknown>, client: ICucmEmulatorClient): Promise<McpToolResult> {
    try {
      const history = await client.getCurriHistory(args as any);
      return {
        content: [{ type: "text", text: JSON.stringify(history, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: err?.message || String(err) }],
        isError: true,
      };
    }
  },
};

export const curriDomainTools: McpTool[] = [
  emuEvaluateCurriTool,
  emuGetCurriHistoryTool,
];
