import { describe, expect, it } from "vitest";
import {
  buildOperationSchema,
  deriveToolName,
  jsonSchemaToZod,
  sanitizeMcpToolName,
  toSnakeCase,
} from "../../src/openapi/schema-builder.js";
import type { OpenApiOperation, OpenApiSpec } from "../../src/openapi/types.js";

describe("Schema Builder & Parameter Merger (schema-builder.ts)", () => {
  it("converts strings to snake_case properly", () => {
    expect(toSnakeCase("getSummary")).toBe("get_summary");
    expect(toSnakeCase("listCallSessions")).toBe("list_call_sessions");
    expect(toSnakeCase("Cucm-Phone-Status")).toBe("cucm_phone_status");
  });

  it("derives clean tool names prefixed with cucm_emulator_", () => {
    expect(deriveToolName("getSummary")).toBe("cucm_emulator_get_summary");
    expect(deriveToolName("emu_simulate_call")).toBe("cucm_emulator_simulate_call");
    expect(deriveToolName(undefined, "POST", "/api/v2/inventory/{resource}")).toBe("cucm_emulator_post_inventory_by_resource");
    expect(deriveToolName(undefined, "POST", "/axl/")).toBe("cucm_emulator_axl");
    expect(deriveToolName(undefined, "POST", "/realtimeservice2/services/RISService70")).toBe("cucm_emulator_ris");
    expect(deriveToolName(undefined, "POST", "/logcollectionservice2/services/LogCollectionPortTypeService")).toBe("cucm_emulator_dime");
    expect(deriveToolName(undefined, "POST", "/logcollectionservice/services/DimeGetFileService")).toBe("cucm_emulator_dime_file");
    expect(sanitizeMcpToolName("cucm_emulator_post_logcollectionservice2_services_log_collection_port_type_service").length).toBeLessThanOrEqual(64);
    expect(deriveToolName("postLogCollectionService2ServicesLogCollectionPortTypeService").length).toBeLessThanOrEqual(64);
  });

  it("converts JSON Schema types to Zod schemas", () => {
    const stringZod = jsonSchemaToZod({ type: "string", minLength: 3 }, true);
    expect(stringZod.safeParse("abc").success).toBe(true);
    expect(stringZod.safeParse("a").success).toBe(false);

    const intZod = jsonSchemaToZod({ type: "integer", minimum: 1, maximum: 10 }, true);
    expect(intZod.safeParse(5).success).toBe(true);
    expect(intZod.safeParse(15).success).toBe(false);
    expect(intZod.safeParse(5.5).success).toBe(false);

    const enumZod = jsonSchemaToZod({ enum: ["Registered", "UnRegistered", "Rejected"] }, true);
    expect(enumZod.safeParse("Registered").success).toBe(true);
    expect(enumZod.safeParse("Invalid").success).toBe(false);

    const objZod = jsonSchemaToZod(
      {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          age: { type: "integer" },
        },
      },
      true
    );
    expect(objZod.safeParse({ name: "Phone1", age: 3 }).success).toBe(true);
    expect(objZod.safeParse({ age: 3 }).success).toBe(false);
  });

  it("merges path, query, and requestBody into a unified flat operation schema", () => {
    const spec: OpenApiSpec = {
      openapi: "3.1.0",
      info: { title: "Test", version: "1.0" },
    };

    const operation: OpenApiOperation = {
      operationId: "simulateCallSession",
      summary: "Simulate a call session between phones",
      parameters: [
        {
          name: "clusterId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "dryRun",
          in: "query",
          required: false,
          schema: { type: "boolean", default: false },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["callingNumber", "calledNumber"],
              properties: {
                callingNumber: { type: "string", description: "Originating directory number" },
                calledNumber: { type: "string", description: "Destination directory number" },
                duration: { type: "integer", default: 60 },
              },
            },
          },
        },
      },
    };

    const merged = buildOperationSchema("/api/v2/clusters/{clusterId}/calls", "POST", operation, spec);

    expect(merged.toolName).toBe("cucm_emulator_simulate_call_session");
    expect(merged.httpMethod).toBe("POST");
    expect(merged.pathParamNames).toEqual(["clusterId"]);
    expect(merged.queryParamNames).toEqual(["dryRun"]);
    expect(merged.bodyParamNames).toEqual(["callingNumber", "calledNumber", "duration"]);
    expect(merged.hasBody).toBe(true);

    const rawProps = merged.rawJsonSchema.properties as Record<string, any>;
    expect(rawProps.clusterId.type).toBe("string");
    expect(rawProps.dryRun.type).toBe("boolean");
    expect(rawProps.callingNumber.type).toBe("string");
    expect(rawProps.calledNumber.type).toBe("string");
    expect(rawProps.duration.type).toBe("integer");

    expect(merged.rawJsonSchema.required).toContain("clusterId");
    expect(merged.rawJsonSchema.required).toContain("callingNumber");
    expect(merged.rawJsonSchema.required).toContain("calledNumber");

    // Test Zod validation on valid payload
    const testPayload = {
      clusterId: "c1",
      callingNumber: "1001",
      calledNumber: "1002",
      duration: 30,
    };
    for (const [key, val] of Object.entries(testPayload)) {
      expect(merged.zodShape[key].safeParse(val).success).toBe(true);
    }
  });

  it("handles primitive or array request bodies under 'body' parameter", () => {
    const spec: OpenApiSpec = {
      openapi: "3.1.0",
      info: { title: "Test", version: "1.0" },
    };

    const operation: OpenApiOperation = {
      operationId: "importSnapshot",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "string",
              description: "Raw snapshot string",
            },
          },
        },
      },
    };

    const merged = buildOperationSchema("/api/v2/snapshots/import", "POST", operation, spec);
    expect(merged.bodyParamNames).toEqual(["body"]);
    expect((merged.rawJsonSchema.properties as any).body.type).toBe("string");
  });
});
