import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "yaml";
import type { MergedOperationSchema, OpenApiSpec } from "./types.js";
import { dereferenceSpec } from "./deref.js";
import { buildOperationSchema } from "./schema-builder.js";
import { SchemaParseError } from "../types/errors.js";

/**
 * Resolves the default bundled OpenAPI contract path.
 */
export function getBundledContractPath(): string {
  // Try locating relative to current file or working directory
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    path.resolve(currentDir, "../../contracts/openapi.json"),
    path.resolve(currentDir, "../contracts/openapi.json"),
    path.resolve(currentDir, "../../../contracts/openapi.json"),
    path.resolve(process.cwd(), "contracts/openapi.json"),
  ];

  for (const candidate of candidatePaths) {
    if (fsSync.existsSync(candidate)) {
      return candidate;
    }
  }

  return path.resolve(process.cwd(), "contracts/openapi.json");
}

/**
 * Loads and parses an OpenAPI specification from a bundled file, local path, or remote URL.
 */
export async function loadOpenApiSpec(source?: string): Promise<OpenApiSpec> {
  let rawContent: string;
  const specLocation = source || getBundledContractPath();

  if (specLocation.startsWith("http://") || specLocation.startsWith("https://")) {
    try {
      const response = await fetch(specLocation, {
        headers: { Accept: "application/json, application/yaml, text/yaml, */*" },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      rawContent = await response.text();
    } catch (err) {
      throw new SchemaParseError(`Failed to fetch OpenAPI spec from remote URL "${specLocation}"`, {
        url: specLocation,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    try {
      rawContent = await fs.readFile(specLocation, "utf-8");
    } catch (err) {
      throw new SchemaParseError(`Failed to read OpenAPI spec file at "${specLocation}"`, {
        path: specLocation,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Parse JSON or YAML
  let rawParsed: unknown;
  try {
    rawParsed = JSON.parse(rawContent);
  } catch {
    try {
      rawParsed = yaml.parse(rawContent);
    } catch (yamlErr) {
      throw new SchemaParseError("Failed to parse OpenAPI specification as JSON or YAML", {
        error: yamlErr instanceof Error ? yamlErr.message : String(yamlErr),
      });
    }
  }

  if (!rawParsed || typeof rawParsed !== "object") {
    throw new SchemaParseError("Parsed OpenAPI specification must be a valid object");
  }

  const rawSpec = rawParsed as OpenApiSpec;
  if (!rawSpec.openapi && !rawSpec.info) {
    throw new SchemaParseError("Document does not appear to be a valid OpenAPI specification (missing 'openapi' or 'info' fields)");
  }

  // Dereference the full spec
  return dereferenceSpec(rawSpec);
}

/**
 * Extracts and compiles all operations from an OpenAPI spec into merged operation schemas.
 */
export function parseAllOperations(spec: OpenApiSpec): Map<string, MergedOperationSchema> {
  const operations = new Map<string, MergedOperationSchema>();

  if (!spec.paths) {
    return operations;
  }

  for (const [pathTemplate, pathItem] of Object.entries(spec.paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;

    for (const method of ["get", "post", "put", "delete", "patch"] as const) {
      const operation = pathItem[method];
      if (operation && typeof operation === "object") {
        const mergedSchema = buildOperationSchema(pathTemplate, method, operation, spec);
        operations.set(mergedSchema.toolName, mergedSchema);
        // Also map by operationId for direct lookup if different
        if (mergedSchema.operationId && mergedSchema.operationId !== mergedSchema.toolName) {
          operations.set(mergedSchema.operationId, mergedSchema);
        }
      }
    }
  }

  return operations;
}
