import type { ICucmEmulatorClient } from "../../client/interface.js";
import type { McpTool, McpToolResult } from "../types.js";
import { inferToolAnnotations } from "../annotations.js";

/**
 * cucm_emulator_seed_fixtures: Seeds deterministic fixture data into the emulator.
 */
export const cucmEmulatorSeedFixturesTool: McpTool = {
  name: "cucm_emulator_seed_fixtures",
  description: "Seeds deterministic cluster topology, nodes, phones, dial plan partitions, CSS, and CURRI policies into the CUCM emulator store.",
  inputSchema: {
    type: "object",
    properties: {
      fixtureProfile: {
        type: "string",
        enum: ["lab-small", "standard-enterprise", "custom"],
        description: "Fixture topology profile to generate (default: lab-small)",
      },
      phoneCount: {
        type: "integer",
        minimum: 1,
        description: "Number of phone endpoints to generate (for custom or enterprise profile)",
      },
      seed: {
        type: "integer",
        description: "Random generator seed for reproducible fixture generation",
      },
      version: {
        type: "string",
        enum: ["11.0", "11.5", "12.0", "12.5", "14.0", "15.0"],
        description: "Target CUCM release version string (e.g. 11.0, 11.5, 12.0, 12.5, 14.0, 15.0)",
      },
      clusterIp: {
        type: "string",
        description: "Base IPv4 address prefix for cluster nodes",
      },
    },
    additionalProperties: false,
  },
  annotations: inferToolAnnotations("cucm_emulator_seed_fixtures", "POST", ["fixtures"]),
  async execute(args: Record<string, unknown>, client: ICucmEmulatorClient): Promise<McpToolResult> {
    try {
      const result = await client.seedFixtures(args as any);
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
 * cucm_emulator_reset_store: Resets or wipes emulator state.
 */
export const cucmEmulatorResetStoreTool: McpTool = {
  name: "cucm_emulator_reset_store",
  description: "Resets or wipes the CUCM emulator in-memory state and re-seeds with a specified topology profile.",
  inputSchema: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["soft", "hard"],
        description: "Reset mode: soft clears calls/buffers but retains config; hard wipes all entities (default: soft)",
      },
      profile: {
        type: "string",
        enum: ["lab-small", "standard-enterprise", "empty"],
        description: "Topology profile to restore after reset (default: lab-small)",
      },
    },
    additionalProperties: false,
  },
  annotations: inferToolAnnotations("cucm_emulator_reset_store", "POST", ["fixtures"]),
  async execute(args: Record<string, unknown>, client: ICucmEmulatorClient): Promise<McpToolResult> {
    try {
      const mode = typeof args.mode === "string" ? args.mode : "soft";
      const profile = typeof args.profile === "string" ? args.profile : "lab-small";
      const result = await client.resetStore(mode, profile);
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
 * cucm_emulator_inspect_fixtures: Retrieves summary and topology overview of the current store state.
 */
export const cucmEmulatorInspectFixturesTool: McpTool = {
  name: "cucm_emulator_inspect_fixtures",
  description: "Inspects and returns a comprehensive summary of active CUCM cluster nodes, phones, call sessions, policies, and buffers.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  annotations: inferToolAnnotations("cucm_emulator_inspect_fixtures", "GET", ["fixtures"]),
  async execute(_args: Record<string, unknown>, client: ICucmEmulatorClient): Promise<McpToolResult> {
    try {
      const summary = await client.getSummary();
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: err?.message || String(err) }],
        isError: true,
      };
    }
  },
};

// Aliases for backwards compatibility
export const emuSeedFixturesTool = cucmEmulatorSeedFixturesTool;
export const emuResetStoreTool = cucmEmulatorResetStoreTool;
export const emuInspectFixturesTool = cucmEmulatorInspectFixturesTool;

export const fixturesDomainTools: McpTool[] = [
  cucmEmulatorSeedFixturesTool,
  cucmEmulatorResetStoreTool,
  cucmEmulatorInspectFixturesTool,
];
