import { describe, it, expect } from "vitest";
import { inferToolAnnotations } from "../../../src/tools/annotations.js";

describe("Tool Safety Annotations", () => {
  it("infers read-only and category for query/list tools", () => {
    const listNodes = inferToolAnnotations("cucm_emulator_list_nodes", "GET", ["nodes"]);
    expect(listNodes.readOnly).toBe(true);
    expect(listNodes.destructive).toBe(false);
    expect(listNodes.category).toBe("nodes");

    const getSummary = inferToolAnnotations("cucm_emulator_get_summary", "GET", ["summary"]);
    expect(getSummary.readOnly).toBe(true);
    expect(getSummary.destructive).toBe(false);
  });

  it("infers mutating and destructive flags for reset/delete tools", () => {
    const resetStore = inferToolAnnotations("cucm_emulator_reset_store", "POST", ["fixtures"]);
    expect(resetStore.readOnly).toBe(false);
    expect(resetStore.destructive).toBe(true);
    expect(resetStore.category).toBe("fixtures");

    const deleteItem = inferToolAnnotations("cucm_emulator_delete_inventory_item", "DELETE");
    expect(deleteItem.destructive).toBe(true);
    expect(deleteItem.idempotent).toBe(true);
  });

  it("infers idempotent flags for state setters and PUT operations", () => {
    const setNodeStatus = inferToolAnnotations("cucm_emulator_simulate_node_failover", "POST", ["nodes"]);
    expect(setNodeStatus.readOnly).toBe(false);
    expect(setNodeStatus.destructive).toBe(false);
    expect(setNodeStatus.idempotent).toBe(true);
    expect(setNodeStatus.category).toBe("nodes");

    const setPhoneStatus = inferToolAnnotations("cucm_emulator_set_phone_status", "POST", ["phones"]);
    expect(setPhoneStatus.idempotent).toBe(true);
    expect(setPhoneStatus.category).toBe("phones");
  });

  it("infers call simulation and CURRI evaluation categories", () => {
    const simCall = inferToolAnnotations("cucm_emulator_simulate_call", "POST", ["calls"]);
    expect(simCall.category).toBe("calls");
    expect(simCall.readOnly).toBe(false);

    const evalCurri = inferToolAnnotations("cucm_emulator_evaluate_curri", "POST", ["curri"]);
    expect(evalCurri.category).toBe("curri");
    expect(evalCurri.readOnly).toBe(true);
  });
});
