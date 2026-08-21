import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EndpointResolver } from "../../src/client/resolver.js";

describe("Endpoint & Credential Resolver (resolver.ts)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.FORCE_MOCK;
    delete process.env.CUCM_EMULATOR_URL;
    delete process.env.EMULATOR_URL;
    delete process.env.DOPPLER_TOKEN;
    delete process.env.DOPPLER_CUCM_EMULATOR_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("resolves to mock client when forceMock is set in options", async () => {
    const res = await EndpointResolver.resolveClient({ forceMock: true });
    expect(res.mode).toBe("mock");
    expect(res.client.mode).toBe("mock");
  });

  it("resolves to mock client when FORCE_MOCK environment variable is set", async () => {
    process.env.FORCE_MOCK = "1";
    const res = await EndpointResolver.resolveClient();
    expect(res.mode).toBe("mock");
    expect(res.client.mode).toBe("mock");
  });

  it("resolves to http client when explicit targetUrl is passed in options", async () => {
    const res = await EndpointResolver.resolveClient({ targetUrl: "http://192.168.124.105:8443" });
    expect(res.mode).toBe("http");
    expect(res.targetUrl).toBe("http://192.168.124.105:8443");
    expect(res.client.mode).toBe("http");
  });

  it("resolves to http client when CUCM_EMULATOR_URL environment variable is set", async () => {
    process.env.CUCM_EMULATOR_URL = "http://10.0.0.50:8443";
    const res = await EndpointResolver.resolveClient();
    expect(res.mode).toBe("http");
    expect(res.targetUrl).toBe("http://10.0.0.50:8443");
  });

  it("resolves to http client when Doppler secrets provide endpoint URL", async () => {
    process.env.DOPPLER_TOKEN = "dp.pt.test12345";
    process.env.DOPPLER_CUCM_EMULATOR_URL = "http://192.168.125.10:8443";
    const res = await EndpointResolver.resolveClient();
    expect(res.mode).toBe("http");
    expect(res.targetUrl).toBe("http://192.168.125.10:8443");
  });

  it("falls back to in-memory mock store when no remote endpoint is configured or reachable", async () => {
    const res = await EndpointResolver.resolveClient({ timeoutMs: 50 });
    expect(res.mode).toBe("mock");
    expect(res.client.mode).toBe("mock");
  });
});
