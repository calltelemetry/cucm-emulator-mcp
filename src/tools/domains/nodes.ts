import type { ICucmEmulatorClient } from "../../client/interface.js";
import type { McpTool, McpToolResult } from "../types.js";
import { inferToolAnnotations } from "../annotations.js";

/**
 * cucm_emulator_list_nodes: Lists all CUCM cluster nodes with role, IP addresses, and RIS health status.
 */
export const cucmEmulatorListNodesTool: McpTool = {
  name: "cucm_emulator_list_nodes",
  description: "Lists all CUCM cluster nodes (Publisher, Subscribers, TFTP) with their IP addresses, active versions, and RISDB return codes.",
  inputSchema: {
    type: "object",
    properties: {
      role: {
        type: "string",
        enum: ["publisher", "subscriber", "tftp", "standalone"],
        description: "Optional filter by node role",
      },
      limit: {
        type: "integer",
        description: "Maximum number of nodes to return",
      },
      offset: {
        type: "integer",
        description: "Pagination offset",
      },
    },
    additionalProperties: false,
  },
  annotations: inferToolAnnotations("cucm_emulator_list_nodes", "GET", ["nodes"]),
  async execute(args: Record<string, unknown>, client: ICucmEmulatorClient): Promise<McpToolResult> {
    try {
      const nodes = await client.listInventory("nodes", args);
      return {
        content: [{ type: "text", text: JSON.stringify(nodes, null, 2) }],
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
 * cucm_emulator_simulate_node_failover: Simulates node failover (ADR 0120/0122) by modifying node RIS return code / status.
 */
export const cucmEmulatorSimulateNodeFailoverTool: McpTool = {
  name: "cucm_emulator_simulate_node_failover",
  description: "Modifies the status, version, and RIS return code of a cluster node to simulate failover, network isolation, service degradation, or cluster version transitions (ADR 0120/0122).",
  inputSchema: {
    type: "object",
    properties: {
      nodeName: {
        type: "string",
        description: "Name or hostname of the cluster node (e.g. cucm-sub1, CUCM-PUB)",
      },
      role: {
        type: "string",
        enum: ["publisher", "subscriber", "tftp", "standalone"],
        description: "Node role (optional)",
      },
      status: {
        type: "string",
        enum: ["Online", "Offline", "NotFound", "Ok", "SearchLimitExceeded", "Timeout", "Unavailable"],
        description: "New status or RIS return code for the node",
      },
      risReturnCode: {
        type: "string",
        enum: ["Ok", "NotFound", "SearchLimitExceeded", "ZeroRecordsFound", "Timeout", "NullPointer"],
        description: "Direct RIS return code (alternative to status)",
      },
      version: {
        type: "string",
        enum: ["11.0", "11.5", "12.0", "12.5", "14.0", "15.0"],
        description: "CUCM version to assign to the node (e.g. for testing version upgrades or cluster version changes)",
      },
    },
    required: ["nodeName"],
    additionalProperties: false,
  },
  annotations: inferToolAnnotations("cucm_emulator_simulate_node_failover", "POST", ["nodes"]),
  async execute(args: Record<string, unknown>, client: ICucmEmulatorClient): Promise<McpToolResult> {
    try {
      const nodeName = String(args.nodeName);
      const role = args.role ? String(args.role) : undefined;
      const statusOrCode = args.status || args.risReturnCode || "Ok";
      const version = args.version ? String(args.version) : undefined;
      const result = await client.setNodeStatus(nodeName, role, String(statusOrCode), version);
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

// Aliases for backwards compatibility
export const emuListNodesTool = cucmEmulatorListNodesTool;
export const emuSetNodeStatusTool = cucmEmulatorSimulateNodeFailoverTool;

export const nodesDomainTools: McpTool[] = [
  cucmEmulatorListNodesTool,
  cucmEmulatorSimulateNodeFailoverTool,
];
