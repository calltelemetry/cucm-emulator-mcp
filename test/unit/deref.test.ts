import { describe, expect, it } from "vitest";
import { dereferenceSchema, dereferenceSpec, resolveJsonPointer } from "../../src/openapi/deref.js";
import { SchemaParseError } from "../../src/types/errors.js";
import type { OpenApiSpec } from "../../src/openapi/types.js";

describe("OpenAPI Dereferencer (deref.ts)", () => {
  it("resolves direct JSON pointers correctly", () => {
    const root = {
      components: {
        schemas: {
          Phone: {
            type: "object",
            properties: {
              name: { type: "string" },
            },
          },
        },
      },
    };

    const resolved = resolveJsonPointer(root, "#/components/schemas/Phone");
    expect(resolved).toEqual({
      type: "object",
      properties: {
        name: { type: "string" },
      },
    });
  });

  it("throws SchemaParseError for invalid pointers", () => {
    const root = { components: {} };
    expect(() => resolveJsonPointer(root, "invalid-pointer")).toThrow(SchemaParseError);
    expect(() => resolveJsonPointer(root, "#/components/schemas/NotFound")).toThrow(SchemaParseError);
  });

  it("recursively dereferences nested and chained $ref pointers", () => {
    const root = {
      components: {
        schemas: {
          BaseEntity: {
            type: "object",
            properties: {
              id: { type: "string" },
            },
          },
          Phone: {
            type: "object",
            properties: {
              meta: { $ref: "#/components/schemas/BaseEntity" },
              model: { type: "string" },
            },
          },
        },
      },
    };

    const ctx = { root, visitedRefs: new Set<string>() };
    const derefed = dereferenceSchema({ $ref: "#/components/schemas/Phone" }, ctx);

    expect(derefed.type).toBe("object");
    expect((derefed.properties as any).model).toEqual({ type: "string" });
    expect((derefed.properties as any).meta).toEqual({
      type: "object",
      properties: {
        id: { type: "string" },
      },
    });
  });

  it("prevents infinite loops on circular/recursive $ref references", () => {
    const root = {
      components: {
        schemas: {
          Node: {
            type: "object",
            properties: {
              name: { type: "string" },
              child: { $ref: "#/components/schemas/Node" },
            },
          },
        },
      },
    };

    const ctx = { root, visitedRefs: new Set<string>() };
    const derefed = dereferenceSchema({ $ref: "#/components/schemas/Node" }, ctx);

    expect(derefed.type).toBe("object");
    expect((derefed.properties as any).name).toEqual({ type: "string" });
    expect((derefed.properties as any).child.$isCircularRef).toBe(true);
    expect((derefed.properties as any).child.$originalRef).toBe("#/components/schemas/Node");
  });

  it("merges allOf schemas cleanly including properties and required arrays", () => {
    const root = {
      components: {
        schemas: {
          Identifiable: {
            type: "object",
            required: ["id"],
            properties: {
              id: { type: "string" },
            },
          },
          Named: {
            type: "object",
            required: ["name"],
            properties: {
              name: { type: "string" },
            },
          },
        },
      },
    };

    const ctx = { root, visitedRefs: new Set<string>() };
    const derefed = dereferenceSchema(
      {
        allOf: [
          { $ref: "#/components/schemas/Identifiable" },
          { $ref: "#/components/schemas/Named" },
        ],
      },
      ctx
    );

    expect(derefed.type).toBe("object");
    expect(derefed.properties).toEqual({
      id: { type: "string" },
      name: { type: "string" },
    });
    expect(derefed.required).toEqual(["id", "name"]);
  });

  it("dereferences full OpenAPI specs", () => {
    const spec: OpenApiSpec = {
      openapi: "3.1.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/nodes/{id}": {
          get: {
            operationId: "getNode",
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                schema: { $ref: "#/components/schemas/IdSchema" },
              },
            ],
            responses: {
              "200": {
                description: "Success",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/NodeSchema" },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          IdSchema: { type: "string", description: "Node ID" },
          NodeSchema: {
            type: "object",
            properties: {
              name: { type: "string" },
            },
          },
        },
      },
    };

    const result = dereferenceSpec(spec);
    const getOp = result.paths!["/nodes/{id}"].get!;
    const param = (getOp.parameters as any)[0];
    expect(param.schema.type).toBe("string");
    expect(param.schema.description).toBe("Node ID");
  });
});
