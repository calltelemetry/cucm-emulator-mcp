import type { z } from "zod";

/**
 * OpenAPI 3.0 / 3.1 AST & Intermediate Schema Types
 */

export interface OpenApiSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  default?: unknown;
  format?: string;
  enum?: unknown[];
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  items?: OpenApiSchema;
  allOf?: OpenApiSchema[];
  anyOf?: OpenApiSchema[];
  oneOf?: OpenApiSchema[];
  $ref?: string;
  additionalProperties?: boolean | OpenApiSchema;
  nullable?: boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  [key: string]: unknown;
}

export interface OpenApiParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  description?: string;
  required?: boolean;
  schema?: OpenApiSchema;
  $ref?: string;
  [key: string]: unknown;
}

export interface OpenApiMediaType {
  schema?: OpenApiSchema;
  example?: unknown;
  examples?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface OpenApiRequestBody {
  description?: string;
  required?: boolean;
  content?: Record<string, OpenApiMediaType>;
  $ref?: string;
  [key: string]: unknown;
}

export interface OpenApiResponse {
  description?: string;
  content?: Record<string, OpenApiMediaType>;
  $ref?: string;
  [key: string]: unknown;
}

export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Array<OpenApiParameter | { $ref: string }>;
  requestBody?: OpenApiRequestBody | { $ref: string };
  responses?: Record<string, OpenApiResponse | { $ref: string }>;
  deprecated?: boolean;
  [key: string]: unknown;
}

export interface OpenApiPathItem {
  summary?: string;
  description?: string;
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  delete?: OpenApiOperation;
  patch?: OpenApiOperation;
  parameters?: Array<OpenApiParameter | { $ref: string }>;
  $ref?: string;
  [key: string]: unknown;
}

export interface OpenApiComponents {
  schemas?: Record<string, OpenApiSchema>;
  parameters?: Record<string, OpenApiParameter>;
  requestBodies?: Record<string, OpenApiRequestBody>;
  responses?: Record<string, OpenApiResponse>;
  [key: string]: unknown;
}

export interface OpenApiSpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
    [key: string]: unknown;
  };
  servers?: Array<{ url: string; description?: string }>;
  paths?: Record<string, OpenApiPathItem>;
  components?: OpenApiComponents;
  tags?: Array<{ name: string; description?: string }>;
  [key: string]: unknown;
}

export interface MergedOperationSchema {
  toolName: string;
  operationId: string;
  summary: string;
  description: string;
  httpMethod: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  pathTemplate: string;
  pathParamNames: string[];
  queryParamNames: string[];
  bodyParamNames: string[];
  hasBody: boolean;
  rawJsonSchema: Record<string, unknown>;
  zodShape: Record<string, z.ZodTypeAny>;
  tags: string[];
}
