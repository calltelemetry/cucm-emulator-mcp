import { describe, it, expect } from "vitest";
import { parseConfig } from "../../src/config.js";

describe("Integration: CLI Runner Configuration & Flag Parsing", () => {
  it("defaults to stdio transport and port 3000", () => {
    const config = parseConfig({});
    expect(config.transport).toBe("stdio");
    expect(config.port).toBe(3000);
    expect(config.host).toBe("127.0.0.1");
    expect(config.seedProfile).toBe("lab-small");
    expect(config.redactSecrets).toBe(false);
  });

  it("parses SSE transport flags and custom port", () => {
    const config = parseConfig({
      transport: "sse",
      port: 8080,
      host: "0.0.0.0",
      mock: true,
      seedProfile: "standard-enterprise",
      authToken: "test-token-123",
      redactSecrets: true,
    });

    expect(config.transport).toBe("sse");
    expect(config.port).toBe(8080);
    expect(config.host).toBe("0.0.0.0");
    expect(config.mock).toBe(true);
    expect(config.seedProfile).toBe("standard-enterprise");
    expect(config.authToken).toBe("test-token-123");
    expect(config.redactSecrets).toBe(true);
  });

  it("parses target URL and spec path options", () => {
    const config = parseConfig({
      targetUrl: "http://192.168.124.105:8443",
      specPath: "/tmp/custom-openapi.json",
    });

    expect(config.targetUrl).toBe("http://192.168.124.105:8443");
    expect(config.specPath).toBe("/tmp/custom-openapi.json");
  });
});
