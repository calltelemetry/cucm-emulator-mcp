import { describe, expect, it } from "vitest";
import { InMemoryCucmStore } from "../../src/mock/store.js";
import { EntityNotFoundError } from "../../src/types/errors.js";

describe("In-Memory CUCM Store (store.ts)", () => {
  it("initializes with default lab-small fixture state", () => {
    const store = new InMemoryCucmStore();
    const summary = store.getSummary() as any;

    expect(summary.clusterName).toBe("CT-LAB-CLUSTER");
    expect(summary.nodes.length).toBe(2);
    expect(summary.counts.phones).toBe(12);
    expect(summary.counts.registeredPhones).toBe(9);
    expect(summary.counts.lines).toBe(12);
    expect(summary.counts.curriPolicies).toBe(3);
  });

  it("supports inventory CRUD across resources", () => {
    const store = new InMemoryCucmStore();

    // List phones
    const phones = store.listInventory("phones") as any[];
    expect(phones.length).toBe(12);

    // Filter phones by pattern
    const filtered = store.listInventory("phones", { pattern: "SEP000000000001" }) as any[];
    expect(filtered.length).toBe(1);

    // Get specific item
    const phone = store.getInventoryItem("phones", "SEP000000000001") as any;
    expect(phone.name).toBe("SEP000000000001");
    expect(phone.dirNumber).toBe("1001");

    // Patch item
    const patched = store.patchInventory("phones", "SEP000000000001", { description: "Patched Description" }) as any;
    expect(patched.description).toBe("Patched Description");

    // Upsert item
    store.upsertInventory("nodes", {
      name: "CUCM-SUB3",
      ipv4Address: "192.168.125.14",
      role: "subscriber",
      version: "14.0",
      risReturnCode: "Ok",
    });
    expect(store.nodes.has("CUCM-SUB3")).toBe(true);

    // Delete item
    const deleted = store.deleteInventory("nodes", "CUCM-SUB3");
    expect(deleted).toBe(true);
    expect(store.nodes.has("CUCM-SUB3")).toBe(false);

    // Non-existent item throws EntityNotFoundError
    expect(() => store.getInventoryItem("nodes", "CUCM-DOES-NOT-EXIST")).toThrow(EntityNotFoundError);
  });

  it("handles node failover simulation (ADR 0120/0122)", () => {
    const store = new InMemoryCucmStore();

    // Set CUCM-SUB1 to NotFound (Offline)
    const node = store.setNodeStatus("CUCM-SUB1", "subscriber", "NotFound");
    expect(node.risReturnCode).toBe("NotFound");

    // Phones registered to CUCM-SUB1 should now be UnRegistered
    for (const phone of store.phones.values()) {
      if (phone.nodeName === "CUCM-SUB1") {
        expect(phone.status).toBe("UnRegistered");
      }
    }

    // Bring CUCM-SUB1 back online
    store.setNodeStatus("CUCM-SUB1", "subscriber", "Ok");
    for (const phone of store.phones.values()) {
      if (phone.nodeName === "CUCM-SUB1") {
        expect(phone.status).toBe("Registered");
      }
    }
  });

  it("supports phone status mutation", () => {
    const store = new InMemoryCucmStore();
    const phone = store.setPhoneStatus("SEP000000000001", "Rejected");

    expect(phone.status).toBe("Rejected");
    expect(phone.risNodeRegistrations[0].status).toBe("Rejected");
  });

  it("renders emulated phone web pages and network statistics", () => {
    const store = new InMemoryCucmStore();
    const webRes = store.getPhoneWeb("SEP000000000001", "/CGI/Execute") as any;

    expect(webRes.phoneName).toBe("SEP000000000001");
    expect(webRes.responseXml).toContain("<CiscoIPPhoneResponse>");

    const netRes = store.getPhoneWeb("192.168.125.100", "/NetworkConfiguration") as any;
    expect(netRes.macAddress).toBe("00:00:00:00:00:01");
    expect(netRes.switchName).toBe("SW-ACCESS-01");
    expect(netRes.stats.rxPackets).toBeGreaterThan(0);
  });

  it("exports, imports, and resets snapshots", () => {
    const store = new InMemoryCucmStore();
    const snapshot = store.exportSnapshot("test-snap");

    expect(snapshot.manifest.id).toBeDefined();
    expect(snapshot.manifest.name).toBe("test-snap");
    expect(snapshot.state.phones.length).toBe(12);

    // Reset store with enterprise profile
    store.resetStore({ profile: "standard-enterprise" });
    expect(store.phones.size).toBe(50);
    expect(store.nodes.size).toBe(4);

    // Load back the small snapshot
    store.loadSnapshot(snapshot.manifest.id);
    expect(store.phones.size).toBe(12);
  });
});
