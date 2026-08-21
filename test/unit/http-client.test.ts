import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockCucmServer } from "../helpers/mock-cucm-server.js";
import { HttpCucmClient } from "../../src/client/http-client.js";
import { AuthenticationError, EntityNotFoundError } from "../../src/types/errors.js";

describe("HTTP Client (http-client.ts)", () => {
  let mockServer: MockCucmServer;
  let client: HttpCucmClient;

  beforeAll(async () => {
    mockServer = new MockCucmServer({
      authTokens: ["valid-token-123"],
    });
    await mockServer.start();
    client = new HttpCucmClient({
      targetUrl: mockServer.getBaseUrl(),
      authToken: "valid-token-123",
      timeoutMs: 3000,
    });
  });

  afterAll(async () => {
    await mockServer.stop();
  });

  it("fetches cluster summary over HTTP", async () => {
    const summary = (await client.getSummary()) as any;
    expect(summary).toBeDefined();
    expect(summary.clusterName).toBeDefined();
    expect(summary.nodes.length).toBeGreaterThanOrEqual(2);
  });

  it("fetches network topology over HTTP", async () => {
    const topology = (await client.getTopology()) as any;
    expect(topology).toBeDefined();
    expect(topology.switches).toBeDefined();
  });

  it("performs inventory list, get, and mutation over HTTP", async () => {
    const phones = (await client.listInventory("phones")) as any[];
    expect(phones.length).toBeGreaterThan(0);

    const firstPhoneName = phones[0].name;
    const phone = (await client.getInventoryItem("phones", firstPhoneName)) as any;
    expect(phone.name).toBe(firstPhoneName);

    // Patch phone status
    const patched = (await client.patchInventory("phones", firstPhoneName, {
      description: "Updated over HTTP",
    })) as any;
    expect(patched.description).toBe("Updated over HTTP");
  });

  it("simulates calls over HTTP", async () => {
    const callRes = await client.simulateCall({
      callingNumber: "1001",
      calledNumber: "1002",
      duration: 30,
    });

    expect(callRes.sessionId).toBeDefined();
    expect(callRes.callingNumber).toBe("1001");
    expect(callRes.calledNumber).toBe("1002");
  });

  it("evaluates CURRI policies over HTTP", async () => {
    const curriDecision = await client.evaluateCurri({
      callingNumber: "1001",
      calledNumber: "1002",
    });

    expect(curriDecision.action).toBeDefined();
  });

  it("throws EntityNotFoundError on 404 response", async () => {
    await expect(client.getInventoryItem("phones", "NON_EXISTENT_PHONE_9999")).rejects.toThrow(
      EntityNotFoundError
    );
  });

  it("throws AuthenticationError when auth token is rejected", async () => {
    const unauthClient = new HttpCucmClient({
      targetUrl: mockServer.getBaseUrl(),
      authToken: "wrong-bad-token",
      timeoutMs: 2000,
    });

    await expect(unauthClient.getSummary()).rejects.toThrow(AuthenticationError);
  });

  it("executes generic OpenAPI operations with path and query substitutions", async () => {
    const res = (await client.executeGenericOperation(
      "GET",
      "/api/v2/inventory/{resource}/{id}",
      {
        resource: "nodes",
        id: "CUCM-PUB",
      }
    )) as any;

    expect(res).toBeDefined();
    expect(res.name).toBe("CUCM-PUB");
  });
});
