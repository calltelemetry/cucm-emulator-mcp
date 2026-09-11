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

  it("posts SOAP envelopes as text/xml to AXL/RIS/DIME paths", async () => {
    const envelope =
      "<soapenv:Envelope><soapenv:Body><ns1:getUser><userid>demo</userid></ns1:getUser></soapenv:Body></soapenv:Envelope>";
    const res = (await client.executeGenericOperation("POST", "/axl/", { body: envelope })) as string;
    expect(res).toContain("getUserResponse");
    expect(res).toContain("userid>demo");
    const last = mockServer.getRequestHistory().at(-1);
    expect(last?.path).toMatch(/\/axl\/?$/);
    expect(String(last?.headers["content-type"] || "")).toMatch(/text\/xml/);
  });

  it("supports in-flight auth_token override without altering client configuration", async () => {
    // Client initialized with invalid credentials
    const badClient = new HttpCucmClient({
      targetUrl: mockServer.getBaseUrl(),
      authToken: "bad-token-xyz",
      timeoutMs: 2000,
    });

    // Default call fails
    await expect(badClient.getSummary()).rejects.toThrow(AuthenticationError);

    // Call with midflight auth_token override succeeds
    const summary = (await badClient.executeGenericOperation("GET", "/api/v2/summary", {
      auth_token: "valid-token-123",
    })) as any;
    expect(summary.clusterName).toBeDefined();

    // Subsequent default call still fails (client instance was not permanently modified)
    await expect(badClient.getSummary()).rejects.toThrow(AuthenticationError);
  });

  it("supports in-flight target_url and cucm_host overrides", async () => {
    // Client initialized with an invalid/unreachable target
    const dummyClient = new HttpCucmClient({
      targetUrl: "http://127.0.0.1:59999",
      authToken: "valid-token-123",
      timeoutMs: 1000,
      maxRetries: 1,
    });

    // Midflight target_url override routes to live mockServer
    const resTarget = (await dummyClient.executeGenericOperation("GET", "/api/v2/summary", {
      target_url: mockServer.getBaseUrl(),
    })) as any;
    expect(resTarget.clusterName).toBeDefined();

    // Midflight cucm_host and cucm_port override
    const serverUrl = new URL(mockServer.getBaseUrl());
    const resHost = (await dummyClient.executeGenericOperation("GET", "/api/v2/summary", {
      cucm_host: `http://${serverUrl.hostname}`,
      cucm_port: Number(serverUrl.port),
    })) as any;
    expect(resHost.clusterName).toBeDefined();
  });

  it("supports version parameter in setNodeStatus", async () => {
    const res = (await client.setNodeStatus("CUCM-PUB", "publisher", "Ok", "15.0")) as any;
    expect(res).toBeDefined();
    expect(res.version).toBe("15.0");
  });
});
