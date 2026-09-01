import type { ICucmEmulatorClient } from "../client/interface.js";
import type { MergedOperationSchema, OpenApiSpec } from "../openapi/types.js";
import { parseAllOperations } from "../openapi/parser.js";
import type { McpTool, McpToolResult } from "./types.js";
import { inferToolAnnotations } from "./annotations.js";

/** Agent-facing control plane: v2 HTTP + emulated-phone CGI. Do not surface SOAP AXL/RIS/DIME. */
const AGENT_FACING_PATH = /^\/(api\/v\d+|emulated-phone(?:-ip)?|healthz|contracts)(\/|$)/;

export function isAgentFacingPath(pathTemplate: string): boolean {
  return AGENT_FACING_PATH.test(pathTemplate);
}

/**
 * Compiles a single MergedOperationSchema from the OpenAPI engine into a discrete MCP tool.
 */
export function generateToolFromOperation(schema: MergedOperationSchema): McpTool {
  const annotations = inferToolAnnotations(schema.toolName, schema.httpMethod, schema.tags);

  return {
    name: schema.toolName,
    description: schema.description || schema.summary || `Execute ${schema.httpMethod} ${schema.pathTemplate}`,
    inputSchema: {
      type: "object",
      properties: (schema.rawJsonSchema.properties as Record<string, unknown>) || {},
      required: (schema.rawJsonSchema.required as string[]) || [],
      additionalProperties: true,
    },
    annotations,
    async execute(args: Record<string, unknown>, client: ICucmEmulatorClient): Promise<McpToolResult> {
      try {
        const result = await client.executeGenericOperation(
          schema.httpMethod,
          schema.pathTemplate,
          args
        );
        return {
          content: [
            {
              type: "text",
              text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text",
              text: err?.message || String(err),
            },
          ],
          isError: true,
        };
      }
    },
  };
}

/**
 * Compiles all operations from an OpenAPI specification into an array of discrete MCP tools.
 */
export function generateDynamicToolsFromSpec(spec: OpenApiSpec): McpTool[] {
  const operations = parseAllOperations(spec);
  const tools: McpTool[] = [];
  const registeredNames = new Set<string>();

  for (const [key, schema] of operations.entries()) {
    // Only register once per canonical toolName
    if (key === schema.toolName && !registeredNames.has(schema.toolName)) {
      if (!isAgentFacingPath(schema.pathTemplate)) continue;
      registeredNames.add(schema.toolName);
      tools.push(generateToolFromOperation(schema));
    }
  }

  return tools;
}

/**
 * Compiles all operations from an OpenAPI specification into a Map keyed by tool name.
 */
export function generateDynamicToolsMap(spec: OpenApiSpec): Map<string, McpTool> {
  const tools = generateDynamicToolsFromSpec(spec);
  const map = new Map<string, McpTool>();
  for (const tool of tools) {
    map.set(tool.name, tool);
  }
  return map;
}
