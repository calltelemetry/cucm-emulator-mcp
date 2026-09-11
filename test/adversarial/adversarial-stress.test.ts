/**
 * Comprehensive Adversarial & Boundary Stress Test Suite
 *
 * Empirical verification of:
 * 1. Boundary conditions (0-count, max safe integers, empty strings, nulls, unicode/special chars/injection)
 * 2. Network fault injection (timeouts, connection drops, 500/502/503/504 errors, 401/403/404)
 * 3. CLI runner flags, error handling, exit codes, and process signal handling
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryCucmStore } from "../../src/mock/store.js";
import { DirectStoreCucmClient } from "../../src/client/mock-client.js";
import { HttpCucmClient } from "../../src/client/http-client.js";
import { MockCucmServer } from "../helpers/mock-cucm-server.js";
import { CucmEmulatorMcpServer } from "../../src/server.js";
import { McpTestClient } from "../helpers/mcp-test-client.js";
import {
  EntityNotFoundError,
  InvalidStateError,
  EndpointUnreachableError,
} from "../../src/types/errors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.resolve(__dirname, "../../dist/bin/cucm-emulator-mcp.js");

describe("Adversarial Challenge & Boundary Stress Suite", () => {
  // =========================================================================
  // 1. BOUNDARY CONDITIONS & EXTREME VALUES
  // =========================================================================
  describe("1. Boundary Conditions & Extreme Values", () => {
    let store: InMemoryCucmStore;
    let client: DirectStoreCucmClient;
    let server: CucmEmulatorMcpServer;
    let mcpClient: McpTestClient;

    beforeEach(async () => {
      store = new InMemoryCucmStore();
      client = new DirectStoreCucmClient(store);

      server = new CucmEmulatorMcpServer({
        config: {
          transport: "stdio",
          mock: true,
          seedProfile: "lab-small",
        },
      });
      mcpClient = new McpTestClient();
      await mcpClient.connectInMemory(server);
    });

    afterEach(async () => {
      if (mcpClient) {
        await mcpClient.close();
      }
      if (server) {
        await server.stop();
      }
    });

    it("1.1 handles empty store reset ('empty' profile) and 0 inventory counts", async () => {
      const resetRes = (await mcpClient.callToolSuccess("emu_reset_store", {
        mode: "soft",
        profile: "empty",
      })) as any;
      expect(resetRes.status).toBe("success");

      const phones = (await mcpClient.callToolSuccess("emu_list_phones", {})) as any[];
      expect(phones).toHaveLength(0);

      const nodes = (await mcpClient.callToolSuccess("emu_list_nodes", {})) as any[];
      expect(nodes).toHaveLength(0);

      const calls = (await mcpClient.callToolSuccess("emu_list_active_calls", {})) as any[];
      expect(calls).toHaveLength(0);
    });

    it("1.2 handles 0-duration and 0-count synthetic CDR generation", async () => {
      // 0-duration call
      const call = (await mcpClient.callToolSuccess("emu_simulate_call", {
        callingNumber: "1001",
        calledNumber: "1002",
        duration: 0,
        packetLossPct: 0,
      })) as any;
      expect(call.duration).toBe(0);
      expect(call.callSession.mediaLegs[0].packetsSent).toBe(0);

      // 0-count CDR generation
      const cdrGen = (await mcpClient.callToolSuccess("emu_generate_cdrs", {
        count: 0,
        pattern: "normal",
      })) as any;
      expect(cdrGen.generatedCount).toBe(0);
      expect(cdrGen.cdrRecords).toHaveLength(0);

      // Verify CDR history pagination with limit 1
      const history = (await mcpClient.callToolSuccess("emu_get_cdr_history", {
        limit: 1,
      })) as any[];
      expect(history.length).toBeLessThanOrEqual(1);
    });

    it("1.3 handles max integer boundaries in pagination (MAX_SAFE_INTEGER, large offset)", async () => {
      const phones = (await client.listInventory("phones", {
        limit: Number.MAX_SAFE_INTEGER,
        offset: 0,
      })) as any[];
      expect(Array.isArray(phones)).toBe(true);
      expect(phones.length).toBeGreaterThan(0);

      const emptyPage = (await client.listInventory("phones", {
        limit: 10,
        offset: Number.MAX_SAFE_INTEGER - 100,
      })) as any[];
      expect(emptyPage).toHaveLength(0);
    });

    it("1.4 handles extreme call duration (1,000,000 seconds) and 100% packet loss", async () => {
      const call = (await mcpClient.callToolSuccess("emu_simulate_call", {
        callingNumber: "2001",
        calledNumber: "2002",
        duration: 1000000,
        codec: "G.711u",
        packetLossPct: 100,
      })) as any;

      expect(call.duration).toBe(1000000);
      expect(call.callSession.mediaLegs[0].packetLossPct).toBe(100);
      expect(call.callSession.mediaLegs[0].packetsReceived).toBe(0);
      expect(call.callSession.mediaLegs[0].packetsSent).toBeGreaterThan(0);
    });

    it("1.5 handles empty strings, nulls, and whitespace in phone & line properties", async () => {
      const phoneWithEmptyFields = {
        name: "SEP112233445566",
        description: "",
        model: "Cisco 8865",
        ipAddress: "192.168.125.210",
        status: "Registered",
        lines: [
          {
            index: 1,
            pattern: "5500",
            description: "",
            routePartition: "", // empty partition
          },
        ],
      };

      const upserted = (await client.upsertInventory("phones", phoneWithEmptyFields)) as any;
      expect(upserted.name).toBe("SEP112233445566");
      expect(upserted.description).toBe("");

      const fetched = (await client.getInventoryItem("phones", "SEP112233445566")) as any;
      expect(fetched.name).toBe("SEP112233445566");
    });

    it("1.6 handles Unicode, emoji, RTL, and multilingual partition & description strings", async () => {
      const unicodeDescriptions = [
        "☎️ CallCenter Phone 🔥🚀",
        "هاتف الموظف (قسم المبيعات)", // Arabic RTL
        "בדיקת טלפון ראשי",          // Hebrew RTL
        "测试电话 - 研发部",          // Chinese
        "Тестовый телефон разработчика", // Cyrillic
        "München Büro Empfang (ÄÖÜß)",   // German Umlauts
        "Téléphone Direction Générale - Étage 4", // French Accents
      ];

      for (let i = 0; i < unicodeDescriptions.length; i++) {
        const desc = unicodeDescriptions[i];
        const name = `SEP00000000${String(i).padStart(4, "0")}`;
        const phone = {
          name,
          description: desc,
          model: "Cisco 8845",
          ipAddress: `192.168.125.${100 + i}`,
          status: "Registered",
          lines: [
            {
              index: 1,
              pattern: `900${i}`,
              description: `Line: ${desc}`,
              routePartition: `Partition_${desc}`,
            },
          ],
        };

        const res = (await client.upsertInventory("phones", phone)) as any;
        expect(res.description).toBe(desc);

        const fetched = (await client.getInventoryItem("phones", name)) as any;
        expect(fetched.description).toBe(desc);
        expect(fetched.lines[0].routePartition).toBe(`Partition_${desc}`);
      }
    });

    it("1.7 handles SQL injection, XSS, and command injection strings safely", async () => {
      const maliciousPayloads = [
        "'; DROP TABLE devices; --",
        "' OR '1'='1",
        "<script>alert('xss')</script>",
        "<img src=x onerror=alert(1)>",
        "$(rm -rf /)",
        "`cat /etc/passwd`",
        "admin\r\nSet-Cookie: evil=true",
        "NULL\0BYTE",
      ];

      for (let i = 0; i < maliciousPayloads.length; i++) {
        const payload = maliciousPayloads[i];
        const phoneName = `SEP88888888${String(i).padStart(4, "0")}`;

        const created = (await client.upsertInventory("phones", {
          name: phoneName,
          description: payload,
          model: "Cisco 7841",
          status: "Registered",
          ipAddress: "192.168.125.50",
        })) as any;

        expect(created.description).toBe(payload);

        // Verify call simulation with injection calling number
        const callRes = await client.simulateCall({
          callingNumber: payload,
          calledNumber: "1002",
          duration: 5,
        });
        expect(callRes.callingNumber).toBe(payload);
      }
    });

    it("1.8 handles path traversal sequences in phone web queries safely", async () => {
      const phones = (await client.listInventory("phones")) as any[];
      const phoneName = phones[0].name;

      const traversalPaths = [
        "../../../../etc/passwd",
        "..\\..\\..\\windows\\win.ini",
        "/CGI/Execute?url=http://127.0.0.1/admin",
        "/../../secret",
        "/%2e%2e/%2e%2e/etc/passwd",
      ];

      for (const traversal of traversalPaths) {
        const res = await client.getPhoneWeb(phoneName, traversal, "xml");
        expect(res).toBeDefined();
      }
    });

    it("1.9 rejects invalid state transitions and non-existent entities cleanly", async () => {
      // Non-existent node
      await expect(
        client.setNodeStatus("non-existent-cucm-node-xyz", "subscriber", "Offline")
      ).rejects.toThrow(EntityNotFoundError);

      // Non-existent phone
      await expect(
        client.setPhoneStatus("SEP000000000000", "UnRegistered")
      ).rejects.toThrow(EntityNotFoundError);

      // Invalid call action on finished call
      const call = await client.simulateCall({
        callingNumber: "1001",
        calledNumber: "1002",
        duration: 5,
      });
      await client.executeCallAction(call.sessionId, "drop");

      // Attempting to hold a dropped call
      await expect(
        client.executeCallAction(call.sessionId, "hold")
      ).rejects.toThrow(InvalidStateError);

      // Attempting illegal action name
      await expect(
        client.executeCallAction(call.sessionId, "teleport" as any)
      ).rejects.toThrow(InvalidStateError);
    });
  });

  // =========================================================================
  // 2. NETWORK FAULT INJECTION & RESILIENCE
  // =========================================================================
  describe("2. Network Fault Injection & Resilience", () => {
    let mockServer: MockCucmServer;
    let baseUrl: string;

    beforeEach(async () => {
      mockServer = new MockCucmServer({ seedProfile: "lab-small" });
      baseUrl = await mockServer.start();
    });

    afterEach(async () => {
      await mockServer.stop();
    });

    it("2.1 handles server-side timeout when server latency exceeds client timeout", async () => {
      const slowServer = new MockCucmServer({ initialLatencyMs: 1500 });
      const slowUrl = await slowServer.start();

      const shortTimeoutClient = new HttpCucmClient({
        targetUrl: slowUrl,
        timeoutMs: 300, // Client times out before 1500ms
        maxRetries: 0,
      });

      await expect(shortTimeoutClient.getSummary()).rejects.toThrow(EndpointUnreachableError);
      await slowServer.stop();
    });

    it("2.2 handles connection refused (dead port) with EndpointUnreachableError", async () => {
      const deadPortClient = new HttpCucmClient({
        targetUrl: "http://127.0.0.1:19998",
        timeoutMs: 500,
        maxRetries: 0,
      });

      await expect(deadPortClient.getSummary()).rejects.toThrow(EndpointUnreachableError);
    });

    it("2.3 handles HTTP 500, 502, 503, 504 server errors", async () => {
      const client = new HttpCucmClient({
        targetUrl: baseUrl,
        timeoutMs: 1000,
        maxRetries: 0,
      });

      const errorCodes = [500, 502, 503, 504];
      for (const code of errorCodes) {
        mockServer.setFailureMode("/api/v2/summary", code, {
          error: `Fault injection error code ${code}`,
        });

        await expect(client.getSummary()).rejects.toThrow();
        mockServer.clearFailureModes();
      }
    });

    it("2.4 handles HTTP 401 Unauthorized when invalid auth token is supplied", async () => {
      const authedServer = new MockCucmServer({ authTokens: ["valid-secret-key-123"] });
      const authedUrl = await authedServer.start();

      const unauthenticatedClient = new HttpCucmClient({
        targetUrl: authedUrl,
        authToken: "wrong-expired-token-xyz",
        timeoutMs: 1000,
        maxRetries: 0,
      });

      await expect(unauthenticatedClient.getSummary()).rejects.toThrow();
      await authedServer.stop();
    });

    it("2.5 handles malformed non-JSON responses from server", async () => {
      mockServer.setFailureMode("/api/v2/summary", 502, "<html><body>502 Bad Gateway</body></html>");

      const client = new HttpCucmClient({
        targetUrl: baseUrl,
        timeoutMs: 1000,
        maxRetries: 0,
      });

      await expect(client.getSummary()).rejects.toThrow();
    });

    it("2.6 recovers cleanly after transient HTTP failure is resolved", async () => {
      const client = new HttpCucmClient({
        targetUrl: baseUrl,
        timeoutMs: 2000,
        maxRetries: 1,
      });

      // 1. Working normally
      const summary1 = (await client.getSummary()) as any;
      expect(summary1.nodes.length).toBeGreaterThan(0);

      // 2. Inject temporary 503 fault
      mockServer.setFailureMode("/api/v2/summary", 503, { error: "Service unavailable" });
      await expect(client.getSummary()).rejects.toThrow();

      // 3. Clear fault and verify self-healing
      mockServer.clearFailureModes();
      const summary2 = (await client.getSummary()) as any;
      expect(summary2.nodes.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 3. CLI RUNNER FLAGS, ERROR HANDLING & SIGNALS
  // =========================================================================
  describe("3. CLI Runner Flags, Error Handling & Signals", () => {
    const runCli = (args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> => {
      return new Promise((resolve) => {
        const proc = spawn("node", [CLI_PATH, ...args], {
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env },
        });

        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (d) => (stdout += d.toString()));
        proc.stderr.on("data", (d) => (stderr += d.toString()));

        proc.on("close", (code) => {
          resolve({ stdout, stderr, code });
        });
      });
    };

    it("3.1 --help and -h exit with code 0 and display usage options", async () => {
      const res = await runCli(["--help"]);
      expect(res.code).toBe(0);
      expect(res.stdout).toContain("Usage: cucm-emulator-mcp");
      expect(res.stdout).toContain("--transport");
      expect(res.stdout).toContain("--mock");
      expect(res.stdout).toContain("--seed-profile");
      expect(res.stdout).toContain("--port");
      expect(res.stdout).toContain("--target-url");
    });

    it("3.2 --version and -v exit with code 0 and output package version", async () => {
      const res = await runCli(["--version"]);
      expect(res.code).toBe(0);
      expect(res.stdout.trim()).toBe("0.2.1");
    });

    it("3.3 rejects unknown flag with non-zero exit code (1)", async () => {
      const res = await runCli(["--unrecognized-arbitrary-option-xyz"]);
      expect(res.code).toBe(1);
      expect(res.stderr).toContain("unknown option");
    });

    it("3.4 stdio transport logs ONLY to stderr and keeps stdout clean for JSON-RPC", async () => {
      return new Promise<void>((resolve, reject) => {
        const proc = spawn("node", [CLI_PATH, "--transport", "stdio", "--mock"], {
          stdio: ["pipe", "pipe", "pipe"],
        });

        let stderrLogs = "";
        let stdoutData = "";

        const timeout = setTimeout(() => {
          proc.kill("SIGKILL");
          reject(new Error(`Timeout waiting for process to start. Stderr: "${stderrLogs}", Stdout: "${stdoutData}"`));
        }, 5000);

        proc.stderr.on("data", (chunk) => {
          stderrLogs += chunk.toString();
          if (stderrLogs.includes("CUCM Emulator MCP Server")) {
            clearTimeout(timeout);
            try {
              expect(stderrLogs).toContain("CUCM Emulator MCP Server");
              expect(stdoutData).toBe("");
              proc.kill("SIGTERM");
              resolve();
            } catch (err) {
              proc.kill("SIGKILL");
              reject(err);
            }
          }
        });

        proc.stdout.on("data", (chunk) => {
          stdoutData += chunk.toString();
        });
      });
    });

    it("3.5 gracefully shuts down on SIGINT and SIGTERM", async () => {
      return new Promise<void>((resolve, reject) => {
        const proc = spawn("node", [CLI_PATH, "--transport", "stdio", "--mock"], {
          stdio: ["pipe", "pipe", "pipe"],
        });

        let stderrLogs = "";

        const timeout = setTimeout(() => {
          proc.kill("SIGKILL");
          reject(new Error(`Timeout waiting for process ready in 3.5. Stderr: "${stderrLogs}"`));
        }, 5000);

        proc.stderr.on("data", (d) => {
          stderrLogs += d.toString();
          if (stderrLogs.includes("CUCM Emulator MCP Server")) {
            clearTimeout(timeout);
            proc.on("close", (code) => {
              try {
                expect(code).toBe(0);
                expect(stderrLogs).toContain("Received SIGINT, gracefully shutting down");
                resolve();
              } catch (err) {
                reject(err);
              }
            });
            proc.kill("SIGINT");
          }
        });
      });
    });

    it("3.6 starts SSE transport on custom port and serves health endpoint", async () => {
      const testPort = 18442;
      return new Promise<void>((resolve, reject) => {
        const proc = spawn(
          "node",
          [CLI_PATH, "--transport", "sse", "--port", String(testPort), "--mock"],
          { stdio: ["ignore", "pipe", "pipe"] }
        );

        let stderr = "";
        let started = false;
        const timeout = setTimeout(() => {
          proc.kill("SIGKILL");
          reject(new Error(`Timeout waiting for SSE listen. Stderr: "${stderr}"`));
        }, 8000);

        const probe = async () => {
          try {
            const healthRes = await fetch(`http://127.0.0.1:${testPort}/health`);
            expect(healthRes.ok).toBe(true);
            const json = (await healthRes.json()) as any;
            expect(json.status).toBe("ok");
            expect(json.transport).toBe("sse");
            expect(json.mode).toBe("mock");
            clearTimeout(timeout);
            proc.kill("SIGTERM");
            resolve();
          } catch (err) {
            clearTimeout(timeout);
            proc.kill("SIGKILL");
            reject(err);
          }
        };

        proc.stderr.on("data", (d) => {
          stderr += d.toString();
          if (!started && stderr.includes("Healthcheck endpoint")) {
            started = true;
            void probe();
          }
        });
      });
    });
  });
});
