import type { ICucmEmulatorClient } from "../../client/interface.js";
import type { McpTool, McpToolResult } from "../types.js";
import { inferToolAnnotations } from "../annotations.js";

/**
 * emu_generate_cdrs: Generates batches of synthetic CDR records based on realistic calling patterns.
 */
export const emuGenerateCdrsTool: McpTool = {
  name: "emu_generate_cdrs",
  description: "Generates realistic synthetic Cisco Call Detail Records (CDRs) for load testing, abandoned call analysis, or CURRI block reporting.",
  inputSchema: {
    type: "object",
    properties: {
      count: {
        type: "integer",
        minimum: 0,
        description: "Number of CDR records to generate (default: 10)",
      },
      pattern: {
        type: "string",
        enum: ["normal", "abandoned", "curri-blocked", "burst"],
        description: "Traffic generation profile pattern (default: normal)",
      },
      durationMin: {
        type: "number",
        minimum: 0,
        description: "Minimum duration in seconds for generated calls",
      },
      durationMax: {
        type: "number",
        minimum: 0,
        description: "Maximum duration in seconds for generated calls",
      },
    },
    additionalProperties: false,
  },
  annotations: inferToolAnnotations("emu_generate_cdrs", "POST", ["cdr"]),
  async execute(args: Record<string, unknown>, client: ICucmEmulatorClient): Promise<McpToolResult> {
    try {
      const result = await client.generateCdrs(args as any);
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
 * emu_get_cdr_history: Retrieves generated or exported CDR records in JSON or CSV format.
 */
export const emuGetCdrHistoryTool: McpTool = {
  name: "emu_get_cdr_history",
  description: "Retrieves recent CDR records from the emulator buffer in structured JSON or raw Cisco CSV export format.",
  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "integer",
        description: "Maximum number of CDR records to return",
      },
      callId: {
        type: "string",
        description: "Optional global call ID filter",
      },
      format: {
        type: "string",
        enum: ["json", "csv"],
        description: "Output format flavor (default: json)",
      },
    },
    additionalProperties: false,
  },
  annotations: inferToolAnnotations("emu_get_cdr_history", "GET", ["cdr"]),
  async execute(args: Record<string, unknown>, client: ICucmEmulatorClient): Promise<McpToolResult> {
    try {
      const history = await client.getCdrHistory(args as any);
      return {
        content: [{ type: "text", text: typeof history === "string" ? history : JSON.stringify(history, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: err?.message || String(err) }],
        isError: true,
      };
    }
  },
};

export const cdrDomainTools: McpTool[] = [
  emuGenerateCdrsTool,
  emuGetCdrHistoryTool,
];
