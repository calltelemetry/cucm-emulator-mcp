import type { ICucmEmulatorClient } from "../client/interface.js";
import type { ToolAnnotations } from "./annotations.js";

export interface McpToolResult {
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError?: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
    [key: string]: unknown;
  };
  annotations?: ToolAnnotations;
  execute(args: Record<string, unknown>, client: ICucmEmulatorClient): Promise<McpToolResult>;
}
