import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  MergedOperationSchema,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiSchema,
  OpenApiSpec,
} from "./types.js";
import { dereferenceSchema } from "./deref.js";

/** MCP tool names must match ^[a-zA-Z0-9_-]{1,64}$ or Cursor rejects the whole tools/list. */
export const MCP_TOOL_NAME_MAX = 64;

/**
 * SOAP AXL/RIS/DIME stay on the emulator's existing SOAP HTTP paths.
 * Path-derived names for LogCollectionPortTypeService are 72 chars and fail Cursor discovery.
 */
export const SOAP_SHORT_ALIASES: Record<string, string> = {
  "/axl/": "cucm_emulator_axl",
  "/realtimeservice2/services/RISService70": "cucm_emulator_ris",
  "/logcollectionservice2/services/LogCollectionPortTypeService": "cucm_emulator_dime",
  "/logcollectionservice/services/DimeGetFileService": "cucm_emulator_dime_file",
};

export function soapShortAlias(pathTemplate: string): string | undefined {
  return SOAP_SHORT_ALIASES[pathTemplate];
}

export function isSoapEndpoint(endpoint: string): boolean {
  const path = endpoint.split("?")[0];
  if (SOAP_SHORT_ALIASES[path]) return true;
  return (
    path === "/axl" ||
    path.startsWith("/axl/") ||
    path.startsWith("/realtimeservice") ||
    path.startsWith("/logcollectionservice")
  );
}

export function sanitizeMcpToolName(name: string): string {
  let sanitized = name
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!sanitized) sanitized = "cucm_emulator_tool";
  if (!sanitized.startsWith("cucm_emulator_")) {
    sanitized = `cucm_emulator_${sanitized.replace(/^emu_/, "")}`;
  }
  if (sanitized.length <= MCP_TOOL_NAME_MAX) return sanitized;
  const digest = createHash("sha1").update(name).digest("hex").slice(0, 8);
  const budget = MCP_TOOL_NAME_MAX - 1 - digest.length;
  return `${sanitized.slice(0, budget)}_${digest}`;
}

/**
 * Converts camelCase or kebab-case to snake_case.
 */
export function toSnakeCase(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s.]+/g, "_")
    .toLowerCase();
}

/**
 * Derives a clean tool name from operationId or method+path.
 */
export function deriveToolName(operationId?: string, method = "GET", pathTemplate = ""): string {
  const alias = soapShortAlias(pathTemplate);
  if (alias) return alias;

  if (operationId) {
    const snake = toSnakeCase(operationId).replace(/^emu_/, "");
    return sanitizeMcpToolName(snake.startsWith("cucm_emulator_") ? snake : `cucm_emulator_${snake}`);
  }

  // Fallback: derive from method and path
  const sanitizedPath = pathTemplate
    .replace(/^\/api\/v\d+\//, "")
    .replace(/\{([^}]+)\}/g, "by_$1")
    .replace(/[^a-zA-Z0-9_]/g, "_");

  return sanitizeMcpToolName(
    `cucm_emulator_${toSnakeCase(method)}_${toSnakeCase(sanitizedPath)}`.replace(/_+/g, "_")
  );
}

/**
 * Converts a JSON Schema property definition into a corresponding Zod type.
 */
export function jsonSchemaToZod(
  schema: OpenApiSchema | undefined,
  isRequired = false
): z.ZodTypeAny {
  if (!schema) {
    return isRequired ? z.any() : z.any().optional();
  }

  let zodType: z.ZodTypeAny;

  // Handle enums
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const stringValues = schema.enum.filter((v): v is string => typeof v === "string");
    if (stringValues.length === schema.enum.length && stringValues.length > 0) {
      zodType = z.enum(stringValues as [string, ...string[]]);
    } else {
      const literals = schema.enum.map((v) => z.literal(v as string | number | boolean));
      zodType = literals.length === 1 ? literals[0] : z.union([literals[0], literals[1], ...literals.slice(2)]);
    }
  } else {
    // Handle standard types
    const rawType = Array.isArray(schema.type) ? schema.type[0] : schema.type;

    switch (rawType) {
      case "string": {
        let strType = z.string();
        if (typeof schema.minLength === "number") strType = strType.min(schema.minLength);
        if (typeof schema.maxLength === "number") strType = strType.max(schema.maxLength);
        zodType = strType;
        break;
      }
      case "integer": {
        let intType = z.number().int();
        if (typeof schema.minimum === "number") intType = intType.min(schema.minimum);
        if (typeof schema.maximum === "number") intType = intType.max(schema.maximum);
        zodType = intType;
        break;
      }
      case "number": {
        let numType = z.number();
        if (typeof schema.minimum === "number") numType = numType.min(schema.minimum);
        if (typeof schema.maximum === "number") numType = numType.max(schema.maximum);
        zodType = numType;
        break;
      }
      case "boolean": {
        zodType = z.boolean();
        break;
      }
      case "array": {
        const itemSchema = schema.items ? jsonSchemaToZod(schema.items, true) : z.unknown();
        zodType = z.array(itemSchema);
        break;
      }
      case "object": {
        if (schema.properties && Object.keys(schema.properties).length > 0) {
          const shape: Record<string, z.ZodTypeAny> = {};
          const reqSet = new Set(schema.required || []);
          for (const [key, prop] of Object.entries(schema.properties)) {
            shape[key] = jsonSchemaToZod(prop, reqSet.has(key));
          }
          zodType = z.object(shape);
        } else {
          zodType = z.record(z.string(), z.unknown());
        }
        break;
      }
      default: {
        zodType = z.unknown();
        break;
      }
    }
  }

  // Attach description if present
  if (schema.description) {
    zodType = zodType.describe(schema.description);
  }

  // Attach default if present
  if (schema.default !== undefined) {
    zodType = zodType.default(schema.default);
  }

  // Apply optionality
  if (!isRequired && schema.default === undefined) {
    zodType = zodType.optional();
  }

  return zodType;
}

/**
 * Builds a unified operation schema by merging path, query, and requestBody parameters.
 */
export function buildOperationSchema(
  pathTemplate: string,
  method: string,
  operation: OpenApiOperation,
  rootSpec: OpenApiSpec
): MergedOperationSchema {
  const httpMethod = method.toUpperCase() as "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  const operationId = operation.operationId || `${method.toLowerCase()}_${pathTemplate}`;
  const toolName = deriveToolName(operation.operationId, httpMethod, pathTemplate);
  const summary = operation.summary || operation.description || `Execute ${httpMethod} ${pathTemplate}`;
  const description = operation.description || operation.summary || summary;
  const tags = operation.tags || [];

  const rawProperties: Record<string, unknown> = {};
  const requiredFields = new Set<string>();
  const zodShape: Record<string, z.ZodTypeAny> = {};

  const pathParamNames: string[] = [];
  const queryParamNames: string[] = [];
  const bodyParamNames: string[] = [];

  const derefCtx = { root: rootSpec as unknown as Record<string, unknown>, visitedRefs: new Set<string>() };

  // 1. Process explicit parameters (path, query, header)
  if (Array.isArray(operation.parameters)) {
    for (const param of operation.parameters) {
      const derefed = dereferenceSchema(param, derefCtx) as unknown as OpenApiParameter;
      if (!derefed || !derefed.name) continue;

      const paramName = derefed.name;
      const paramSchema = derefed.schema ? (dereferenceSchema(derefed.schema, derefCtx) as OpenApiSchema) : { type: "string" };

      if (derefed.description && !paramSchema.description) {
        paramSchema.description = derefed.description;
      }

      if (derefed.in === "path") {
        pathParamNames.push(paramName);
        requiredFields.add(paramName);
      } else if (derefed.in === "query") {
        queryParamNames.push(paramName);
        if (derefed.required) {
          requiredFields.add(paramName);
        }
      }

      rawProperties[paramName] = paramSchema;
      zodShape[paramName] = jsonSchemaToZod(paramSchema, requiredFields.has(paramName));
    }
  }

  // 2. Discover implicit path parameters in path template ({resource}, {id}) not in parameters array
  const templatePathMatches = pathTemplate.match(/\{([^}]+)\}/g);
  if (templatePathMatches) {
    for (const match of templatePathMatches) {
      const paramName = match.slice(1, -1);
      if (!pathParamNames.includes(paramName)) {
        pathParamNames.push(paramName);
        requiredFields.add(paramName);
        const inferredSchema: OpenApiSchema = {
          type: "string",
          description: `Path parameter: ${paramName}`,
        };
        rawProperties[paramName] = inferredSchema;
        zodShape[paramName] = jsonSchemaToZod(inferredSchema, true);
      }
    }
  }

  // 3. Process requestBody
  let hasBody = false;
  if (operation.requestBody) {
    const derefedBody = dereferenceSchema(operation.requestBody, derefCtx) as unknown as {
      description?: string;
      required?: boolean;
      content?: Record<string, { schema?: OpenApiSchema }>;
    };

    const jsonContent =
      derefedBody.content?.["application/json"] ||
      derefedBody.content?.["*/*"] ||
      derefedBody.content?.["text/xml"] ||
      derefedBody.content?.["application/xml"];
    if (jsonContent?.schema) {
      hasBody = true;
      const bodySchema = dereferenceSchema(jsonContent.schema, derefCtx) as OpenApiSchema;

      if (bodySchema.type === "object" && bodySchema.properties && Object.keys(bodySchema.properties).length > 0) {
        // Flatten object properties into top-level tool arguments
        const bodyRequired = new Set(bodySchema.required || []);
        for (const [propName, propSchema] of Object.entries(bodySchema.properties)) {
          bodyParamNames.push(propName);
          const isReq = derefedBody.required && bodyRequired.has(propName);
          if (isReq) {
            requiredFields.add(propName);
          }
          rawProperties[propName] = propSchema;
          zodShape[propName] = jsonSchemaToZod(propSchema, isReq);
        }
      } else {
        // Mount primitive, array, or arbitrary object schema under `body`
        bodyParamNames.push("body");
        if (derefedBody.required) {
          requiredFields.add("body");
        }
        rawProperties["body"] = bodySchema;
        zodShape["body"] = jsonSchemaToZod(bodySchema, !!derefedBody.required);
      }
    }
  }

  const rawJsonSchema: Record<string, unknown> = {
    type: "object",
    properties: rawProperties,
    required: Array.from(requiredFields),
    additionalProperties: true,
  };

  return {
    toolName,
    operationId,
    summary,
    description,
    httpMethod,
    pathTemplate,
    pathParamNames,
    queryParamNames,
    bodyParamNames,
    hasBody,
    rawJsonSchema,
    zodShape,
    tags,
  };
}
