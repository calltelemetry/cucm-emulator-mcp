import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryCucmStore } from "../../../src/mock/store.js";
import { DirectStoreCucmClient } from "../../../src/client/mock-client.js";
import {
  allDomainTools,
  emuSeedFixturesTool,
  emuResetStoreTool,
  emuInspectFixturesTool,
  emuListNodesTool,
  emuSetNodeStatusTool,
  emuListPhonesTool,
  emuSetPhoneStatusTool,
  emuGetPhoneWebTool,
  emuGetPhoneScreenshotTool,
  emuSimulateCallTool,
  emuCallActionTool,
  emuListActiveCallsTool,
  emuEvaluateCurriTool,
  emuGetCurriHistoryTool,
  emuGenerateCdrsTool,
  emuGetCdrHistoryTool,
} from "../../../src/tools/domains/index.js";

describe("Discrete Domain Tools (16 Tools)", () => {
  let store: InMemoryCucmStore;
  let client: DirectStoreCucmClient;

  beforeEach(() => {
    store = new InMemoryCucmStore();
    client = new DirectStoreCucmClient(store);
  });

  it("contains exactly 16 discrete domain tools", () => {
    expect(allDomainTools).toHaveLength(16);
    const names = allDomainTools.map((t) => t.name);
    expect(new Set(names).size).toBe(16);
    expect(names).toContain("emu_get_phone_screenshot");
  });

  // 1. Fixtures Tools
  describe("Fixtures Domain", () => {
    it("emu_seed_fixtures seeds custom phone count", async () => {
      const res = await emuSeedFixturesTool.execute({ fixtureProfile: "lab-small", phoneCount: 20 }, client);
      expect(res.isError).toBeFalsy();
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed.status).toBe("success");
    });

    it("emu_reset_store wipes and reloads store", async () => {
      const res = await emuResetStoreTool.execute({ mode: "soft", profile: "lab-small" }, client);
      expect(res.isError).toBeFalsy();
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed.status).toBe("success");
    });

    it("emu_inspect_fixtures returns summary", async () => {
      const res = await emuInspectFixturesTool.execute({}, client);
      expect(res.isError).toBeFalsy();
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed.clusterName).toBeDefined();
      expect(parsed.counts.nodes).toBeGreaterThanOrEqual(2);
    });
  });

  // 2. Nodes Tools
  describe("Nodes Domain", () => {
    it("emu_list_nodes lists cluster nodes", async () => {
      const res = await emuListNodesTool.execute({}, client);
      expect(res.isError).toBeFalsy();
      const nodes = JSON.parse(res.content[0].text);
      expect(nodes.length).toBeGreaterThanOrEqual(2);
    });

    it("emu_set_node_status updates node status for failover", async () => {
      const res = await emuSetNodeStatusTool.execute(
        { nodeName: "CUCM-PUB", status: "NotFound" },
        client
      );
      expect(res.isError).toBeFalsy();
      const updated = JSON.parse(res.content[0].text);
      expect(updated.risReturnCode).toBe("NotFound");
    });
  });

  // 3. Phones Tools
  describe("Phones Domain", () => {
    it("emu_list_phones lists phones with filtering", async () => {
      const res = await emuListPhonesTool.execute({ limit: 5 }, client);
      expect(res.isError).toBeFalsy();
      const phones = JSON.parse(res.content[0].text);
      expect(phones.length).toBeLessThanOrEqual(5);
    });

    it("emu_set_phone_status mutates phone registration", async () => {
      const phones = (await client.listInventory("phones")) as any[];
      const targetPhone = phones[0].name;

      const res = await emuSetPhoneStatusTool.execute(
        { phoneName: targetPhone, status: "UnRegistered" },
        client
      );
      expect(res.isError).toBeFalsy();
      const phone = JSON.parse(res.content[0].text);
      expect(phone.status).toBe("UnRegistered");
    });

    it("emu_get_phone_web retrieves phone serviceability XML", async () => {
      const phones = (await client.listInventory("phones")) as any[];
      const targetPhone = phones[0].name;

      const res = await emuGetPhoneWebTool.execute(
        { phoneNameOrIp: targetPhone, path: "/CiscoIPPhoneResponse", format: "xml" },
        client
      );
      expect(res.isError).toBeFalsy();
      const web = JSON.parse(res.content[0].text);
      expect(web.phoneName).toBe(targetPhone);
    });

    it("emu_get_phone_screenshot fetches CGI/Screenshot from the emulated-phone surface", async () => {
      const phones = (await client.listInventory("phones")) as any[];
      const targetPhone = phones[0].name;

      const res = await emuGetPhoneScreenshotTool.execute(
        { phoneNameOrIp: targetPhone },
        client
      );
      expect(res.isError).toBeFalsy();
      const web = JSON.parse(res.content[0].text);
      expect(web.phoneName).toBe(targetPhone);
      expect(web.contentType).toBe("image/bmp");
    });
  });

  // 4. Calls Domain
  describe("Calls Domain", () => {
    it("emu_simulate_call simulates call and returns legs", async () => {
      const res = await emuSimulateCallTool.execute(
        { callingNumber: "1001", calledNumber: "1002", duration: 30 },
        client
      );
      expect(res.isError).toBeFalsy();
      const call = JSON.parse(res.content[0].text);
      expect(call.sessionId).toBeDefined();
      expect(call.callSession.mediaLegs.length).toBeGreaterThan(0);
    });

    it("emu_call_action executes answer, hold, resume, drop", async () => {
      const sim = await client.simulateCall({ callingNumber: "1001", calledNumber: "1002", duration: 60 });
      const holdRes = await emuCallActionTool.execute({ sessionId: sim.sessionId, action: "hold" }, client);
      expect(holdRes.isError).toBeFalsy();

      const dropRes = await emuCallActionTool.execute(
        { sessionId: sim.sessionId, action: "drop", reason: "NormalClearing" },
        client
      );
      expect(dropRes.isError).toBeFalsy();
    });

    it("emu_list_active_calls lists active calls", async () => {
      await client.simulateCall({ callingNumber: "1001", calledNumber: "1002", duration: 120 });
      const res = await emuListActiveCallsTool.execute({}, client);
      expect(res.isError).toBeFalsy();
      const calls = JSON.parse(res.content[0].text);
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  // 5. CURRI Domain
  describe("CURRI Domain", () => {
    it("emu_evaluate_curri evaluates routing decisions", async () => {
      const res = await emuEvaluateCurriTool.execute(
        { callingNumber: "1001", calledNumber: "1002" },
        client
      );
      expect(res.isError).toBeFalsy();
      const decision = JSON.parse(res.content[0].text);
      expect(decision.action).toBe("permit");
    });

    it("emu_get_curri_history retrieves event records", async () => {
      await client.evaluateCurri({ callingNumber: "1001", calledNumber: "1002" });
      const res = await emuGetCurriHistoryTool.execute({ limit: 10 }, client);
      expect(res.isError).toBeFalsy();
      const history = JSON.parse(res.content[0].text);
      expect(history.length).toBeGreaterThanOrEqual(1);
    });
  });

  // 6. CDR Domain
  describe("CDR Domain", () => {
    it("emu_generate_cdrs generates synthetic records", async () => {
      const res = await emuGenerateCdrsTool.execute({ count: 5, pattern: "normal" }, client);
      expect(res.isError).toBeFalsy();
      const result = JSON.parse(res.content[0].text);
      expect(result.generatedCount).toBe(5);
    });

    it("emu_get_cdr_history exports CSV and JSON formats", async () => {
      await client.generateCdrs({ count: 3 });
      const jsonRes = await emuGetCdrHistoryTool.execute({ format: "json" }, client);
      expect(jsonRes.isError).toBeFalsy();

      const csvRes = await emuGetCdrHistoryTool.execute({ format: "csv" }, client);
      expect(csvRes.isError).toBeFalsy();
      expect(csvRes.content[0].text).toContain("cdrRecordType");
    });
  });
});
