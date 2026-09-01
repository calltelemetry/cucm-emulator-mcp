#!/usr/bin/env node

/**
 * @calltelemetry/cucm-emulator-mcp
 * Executable CLI Entrypoint
 */

import { Command } from "commander";
import { CucmEmulatorMcpServer } from "../src/server.js";

const program = new Command();

program
  .name("cucm-emulator-mcp")
  .description("OpenAPI-driven Model Context Protocol (MCP) server for Cisco CUCM Emulator")
  .version("0.1.2", "-v, --version", "Output the current version")
  .option("-t, --transport <type>", "Transport type (stdio or sse)", "stdio")
  .option("-p, --port <number>", "HTTP port for SSE transport", "3000")
  .option("--bind-host <host>", "Host interface to bind SSE transport", "127.0.0.1")
  .option("-u, --target-url <url>", "Target live CUCM emulator URL (e.g. http://192.168.124.105:8443)")
  .option("-s, --spec-path <path>", "Path or URL to OpenAPI 3.1.0 specification")
  .option("-m, --mock", "Force in-memory mock store mode", false)
  .option("--seed-profile <profile>", "Initial seed fixture profile (lab-small, standard-enterprise, empty)", "lab-small")
  .option("--auth-token <token>", "Bearer authentication token for live CUCM emulator")
  .option("--redact-secrets", "Redact sensitive tokens and credentials from logs", false)
  .action(async (options) => {
    try {
      const server = new CucmEmulatorMcpServer({
        config: {
          transport: options.transport,
          port: parseInt(options.port, 10),
          host: options.bindHost,
          targetUrl: options.targetUrl,
          specPath: options.specPath,
          mock: options.mock,
          seedProfile: options.seedProfile,
          authToken: options.authToken,
          redactSecrets: options.redactSecrets,
        },
      });

      // Handle graceful shutdown signals
      const shutdown = async (signal: string) => {
        process.stderr.write(`[INFO] Received ${signal}, gracefully shutting down CUCM Emulator MCP Server...\n`);
        try {
          await server.stop();
        } catch (err) {
          process.stderr.write(`[ERROR] Error during shutdown: ${err}\n`);
        }
        process.exit(0);
      };

      process.on("SIGINT", () => shutdown("SIGINT"));
      process.on("SIGTERM", () => shutdown("SIGTERM"));

      const endpoint = await server.start();

      if (options.transport === "sse") {
        process.stderr.write(`[INFO] CUCM Emulator MCP Server listening on SSE at ${endpoint}/sse\n`);
        process.stderr.write(`[INFO] Healthcheck endpoint: ${endpoint}/health\n`);
      } else {
        process.stderr.write(`[INFO] CUCM Emulator MCP Server running on Stdio transport (JSON-RPC 2.0 on stdin/stdout)\n`);
      }
    } catch (err: any) {
      process.stderr.write(`[FATAL] Failed to start CUCM Emulator MCP Server: ${err?.message || String(err)}\n`);
      if (err?.stack) {
        process.stderr.write(`${err.stack}\n`);
      }
      process.exit(1);
    }
  });

program.parse(process.argv);
