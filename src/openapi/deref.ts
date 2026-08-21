import type { OpenApiSchema, OpenApiSpec } from "./types.js";
import { SchemaParseError } from "../types/errors.js";

/**
 * Context for recursive dereferencing with circular reference detection.
 */
export interface DerefContext {
  root: Record<string, unknown>;
  visitedRefs: Set<string>;
}

/**
 * Resolves a JSON pointer against the root document (e.g. `#/components/schemas/CucmNode`).
 */
export function resolveJsonPointer(root: Record<string, unknown>, pointer: string): Record<string, unknown> {
  if (!pointer.startsWith("#/")) {
    throw new SchemaParseError(`Unsupported external or relative $ref pointer: "${pointer}"`);
  }

  const parts = pointer.slice(2).split("/");
  let current: unknown = root;

  for (const part of parts) {
    if (!current || typeof current !== "object") {
      throw new SchemaParseError(`Invalid pointer part "${part}" in "${pointer}"`);
    }
    const unescaped = part.replace(/~1/g, "/").replace(/~0/g, "~");
    current = (current as Record<string, unknown>)[unescaped];
  }

  if (current === undefined || current === null || typeof current !== "object") {
    throw new SchemaParseError(`Pointer target at "${pointer}" is undefined or not an object`);
  }

  return current as Record<string, unknown>;
}

/**
 * Recursively dereferences an OpenAPI schema or fragment.
 */
export function dereferenceSchema(
  schema: unknown,
  context: DerefContext
): Record<string, unknown> {
  if (!schema || typeof schema !== "object") {
    return (schema as Record<string, unknown>) || {};
  }

  const schemaObj = { ...(schema as Record<string, unknown>) };

  // Handle $ref resolution
  if (typeof schemaObj.$ref === "string") {
    const ref = schemaObj.$ref;

    // Check for circular reference
    if (context.visitedRefs.has(ref)) {
      return {
        type: "object",
        description: `Recursive/circular reference to ${ref}`,
        $isCircularRef: true,
        $originalRef: ref,
      };
    }

    const resolved = resolveJsonPointer(context.root, ref);
    const nextContext: DerefContext = {
      root: context.root,
      visitedRefs: new Set([...context.visitedRefs, ref]),
    };

    // Retain any overriding description or title from the $ref object itself
    const derefed = dereferenceSchema(resolved, nextContext);
    const merged: Record<string, unknown> = { ...derefed };
    if (schemaObj.description) merged.description = schemaObj.description;
    if (schemaObj.title) merged.title = schemaObj.title;
    return merged;
  }

  // Handle allOf merging
  if (Array.isArray(schemaObj.allOf)) {
    const merged: Record<string, unknown> = {
      type: "object",
      properties: {},
      required: [],
      ...(schemaObj.description ? { description: schemaObj.description } : {}),
    };

    const properties: Record<string, unknown> = {};
    const requiredSet = new Set<string>();

    for (const subSchema of schemaObj.allOf) {
      const derefedSub = dereferenceSchema(subSchema, context);
      if (derefedSub.properties && typeof derefedSub.properties === "object") {
        Object.assign(properties, derefedSub.properties);
      }
      if (Array.isArray(derefedSub.required)) {
        for (const req of derefedSub.required) {
          if (typeof req === "string") requiredSet.add(req);
        }
      }
      if (derefedSub.type && derefedSub.type !== "object") {
        merged.type = derefedSub.type;
      }
      if (derefedSub.description && !merged.description) {
        merged.description = derefedSub.description;
      }
    }

    if (schemaObj.properties && typeof schemaObj.properties === "object") {
      for (const [key, val] of Object.entries(schemaObj.properties as Record<string, unknown>)) {
        properties[key] = dereferenceSchema(val, context);
      }
    }
    if (Array.isArray(schemaObj.required)) {
      for (const req of schemaObj.required) {
        if (typeof req === "string") requiredSet.add(req);
      }
    }

    merged.properties = properties;
    if (requiredSet.size > 0) {
      merged.required = Array.from(requiredSet);
    }
    return merged;
  }

  // Handle anyOf
  if (Array.isArray(schemaObj.anyOf)) {
    schemaObj.anyOf = schemaObj.anyOf.map((s) => dereferenceSchema(s, context));
  }

  // Handle oneOf
  if (Array.isArray(schemaObj.oneOf)) {
    schemaObj.oneOf = schemaObj.oneOf.map((s) => dereferenceSchema(s, context));
  }

  // Handle object properties
  if (schemaObj.properties && typeof schemaObj.properties === "object") {
    const derefedProps: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(schemaObj.properties as Record<string, unknown>)) {
      derefedProps[key] = dereferenceSchema(prop, context);
    }
    schemaObj.properties = derefedProps;
  }

  // Handle array items
  if (schemaObj.items) {
    if (Array.isArray(schemaObj.items)) {
      schemaObj.items = schemaObj.items.map((it) => dereferenceSchema(it, context));
    } else {
      schemaObj.items = dereferenceSchema(schemaObj.items, context);
    }
  }

  // Handle nested schema property (e.g. in parameter or media-type objects)
  if (schemaObj.schema) {
    schemaObj.schema = dereferenceSchema(schemaObj.schema, context);
  }

  // Handle content media types (e.g. in requestBody or response objects)
  if (schemaObj.content && typeof schemaObj.content === "object") {
    const derefedContent: Record<string, unknown> = {};
    for (const [mediaType, mediaObj] of Object.entries(schemaObj.content as Record<string, unknown>)) {
      derefedContent[mediaType] = dereferenceSchema(mediaObj, context);
    }
    schemaObj.content = derefedContent;
  }

  // Handle additionalProperties
  if (schemaObj.additionalProperties && typeof schemaObj.additionalProperties === "object") {
    schemaObj.additionalProperties = dereferenceSchema(schemaObj.additionalProperties, context);
  }

  return schemaObj;
}

/**
 * Dereferences an entire OpenAPI specification into an in-memory document with all references resolved.
 */
export function dereferenceSpec(spec: OpenApiSpec): OpenApiSpec {
  const root = spec as unknown as Record<string, unknown>;
  const context: DerefContext = {
    root,
    visitedRefs: new Set(),
  };

  const dereferenced: Record<string, unknown> = {
    ...spec,
    paths: {},
    components: spec.components ? { ...spec.components } : {},
  };

  if (spec.paths) {
    const derefedPaths: Record<string, unknown> = {};
    for (const [pathKey, pathItem] of Object.entries(spec.paths)) {
      if (!pathItem || typeof pathItem !== "object") continue;

      let derefedPathItem: Record<string, unknown> = { ...pathItem };
      if (pathItem.$ref) {
        derefedPathItem = dereferenceSchema(pathItem, context);
      }

      // Dereference common path-level parameters
      if (Array.isArray(derefedPathItem.parameters)) {
        derefedPathItem.parameters = derefedPathItem.parameters.map((p) =>
          dereferenceSchema(p, context)
        );
      }

      // Dereference each HTTP method
      for (const method of ["get", "post", "put", "delete", "patch"] as const) {
        const operation = derefedPathItem[method];
        if (operation && typeof operation === "object") {
          const opObj = { ...(operation as Record<string, unknown>) };

          if (Array.isArray(opObj.parameters)) {
            opObj.parameters = opObj.parameters.map((p) => dereferenceSchema(p, context));
          }

          if (opObj.requestBody) {
            opObj.requestBody = dereferenceSchema(opObj.requestBody, context);
          }

          if (opObj.responses && typeof opObj.responses === "object") {
            const derefedResponses: Record<string, unknown> = {};
            for (const [code, resp] of Object.entries(opObj.responses as Record<string, unknown>)) {
              derefedResponses[code] = dereferenceSchema(resp, context);
            }
            opObj.responses = derefedResponses;
          }

          derefedPathItem[method] = opObj;
        }
      }

      derefedPaths[pathKey] = derefedPathItem;
    }
    dereferenced.paths = derefedPaths;
  }

  return dereferenced as unknown as OpenApiSpec;
}
