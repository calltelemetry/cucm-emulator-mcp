import { describe, expect, it } from "vitest";
import { loadOpenApiSpec, parseAllOperations } from "../../src/openapi/parser.js";
import { SchemaParseError } from "../../src/types/errors.js";

describe("OpenAPI Spec Loader & Parser (parser.ts)", () => {
  it("loads and parses the bundled contracts/openapi.json specification", async () => {
    const spec = await loadOpenApiSpec();

    expect(spec).toBeDefined();
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toBe("CallTelemetry CUCM Emulator API");
    expect(spec.paths).toBeDefined();
    expect(Object.keys(spec.paths!).length).toBeGreaterThan(20);
  });

  it("extracts and compiles all operations from the bundled spec into discrete tools", async () => {
    const spec = await loadOpenApiSpec();
    const operations = parseAllOperations(spec);

    expect(operations.size).toBeGreaterThan(40);

    // Verify key operations exist
    expect(operations.has("cucm_emulator_get_summary")).toBe(true);
    expect(operations.has("cucm_emulator_get_topology")).toBe(true);
    expect(operations.has("cucm_emulator_list_inventory")).toBe(true);
    expect(operations.has("cucm_emulator_upsert_inventory")).toBe(true);
    expect(operations.has("cucm_emulator_create_call_session")).toBe(true);
    expect(operations.has("cucm_emulator_list_cdr_records")).toBe(true);
    expect(operations.has("cucm_emulator_export_cdr_csv")).toBe(true);
    expect(operations.has("cucm_emulator_load_snapshot")).toBe(true);

    const summaryOp = operations.get("cucm_emulator_get_summary")!;
    expect(summaryOp.httpMethod).toBe("GET");
    expect(summaryOp.pathTemplate).toBe("/api/v2/summary");

    const callOp = operations.get("cucm_emulator_create_call_session")!;
    expect(callOp.httpMethod).toBe("POST");
    expect(callOp.hasBody).toBe(true);
  });

  it("throws SchemaParseError when reading a non-existent file", async () => {
    await expect(loadOpenApiSpec("/tmp/non-existent-spec-12345.json")).rejects.toThrow(SchemaParseError);
  });
});
