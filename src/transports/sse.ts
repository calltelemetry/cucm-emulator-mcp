import express, { type Express, type Request, type Response } from "express";
import type { Server as HttpServer } from "node:http";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ICucmEmulatorClient } from "../client/interface.js";
import type { OpenApiSpec } from "../openapi/types.js";

export interface SseServerOptions {
  port: number;
  host: string;
  createMcpServer?: () => Server;
  mcpServer?: Server;
  registry: ToolRegistry;
  client: ICucmEmulatorClient;
  spec?: OpenApiSpec;
}

export class SseServerManager {
  public readonly app: Express;
  private httpServer: HttpServer | null = null;
  private transports: Map<string, SSEServerTransport> = new Map();
  private options: SseServerOptions;

  constructor(options: SseServerOptions) {
    this.options = options;
    this.app = express();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // CORS middleware
    this.app.use((req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-session-id");
      if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
      }
      next();
    });

    // Healthcheck endpoint
    const healthHandler = (_req: Request, res: Response) => {
      res.status(200).json({
        status: "ok",
        service: "@calltelemetry/cucm-emulator-mcp",
        version: "0.2.3",
        transport: "sse",
        uptime: process.uptime(),
        toolsCount: this.options.registry.size,
        mode: this.options.client.mode,
      });
    };

    this.app.get("/health", healthHandler);
    this.app.get("/healthz", healthHandler);

    // Tool inventory endpoint
    this.app.get("/tools", (_req: Request, res: Response) => {
      res.status(200).json({
        tools: this.options.registry.listToolDefinitions(),
      });
    });

    // OpenAPI specification endpoint
    this.app.get("/openapi.json", (_req: Request, res: Response) => {
      if (this.options.spec) {
        res.status(200).json(this.options.spec);
      } else {
        res.status(404).json({ error: "OpenAPI specification not loaded" });
      }
    });

    // SSE Connection Initiation Endpoint
    this.app.get("/sse", async (req: Request, res: Response) => {
      try {
        const transport = new SSEServerTransport("/messages", res);
        const sessionId = transport.sessionId;
        this.transports.set(sessionId, transport);

        const server = this.options.createMcpServer
          ? this.options.createMcpServer()
          : this.options.mcpServer!;

        let closed = false;
        const cleanup = () => {
          if (closed) return;
          closed = true;
          this.transports.delete(sessionId);
          void server.close().catch(() => {});
        };

        res.on("close", cleanup);
        transport.onclose = cleanup;

        await server.connect(transport);
      } catch (err: any) {
        console.error("Error establishing SSE transport stream:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to establish SSE stream", details: err?.message });
        }
      }
    });

    // SSE Message Dispatch Endpoint
    this.app.post("/messages", async (req: Request, res: Response) => {
      try {
        const sessionId =
          (req.query.sessionId as string) ||
          (req.headers["x-session-id"] as string) ||
          (this.transports.size === 1 ? Array.from(this.transports.keys())[0] : undefined);

        if (!sessionId) {
          res.status(400).json({ error: "Missing sessionId parameter" });
          return;
        }

        const transport = this.transports.get(sessionId);
        if (!transport) {
          res.status(404).json({ error: `Session "${sessionId}" not found or disconnected` });
          return;
        }

        await transport.handlePostMessage(req, res);
      } catch (err: any) {
        console.error("Error handling POST message in SSE transport:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to process message", details: err?.message });
        }
      }
    });
  }

  /**
   * Starts the HTTP server on configured host and port.
   */
  public async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        this.httpServer = this.app.listen(this.options.port, this.options.host, () => {
          const addr = this.httpServer?.address();
          const actualPort = typeof addr === "object" && addr ? addr.port : this.options.port;
          const url = `http://${this.options.host}:${actualPort}`;
          resolve(url);
        });
        this.httpServer.on("error", reject);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Stops the HTTP server and closes all active SSE connections.
   */
  public async stop(): Promise<void> {
    for (const [sessionId, transport] of this.transports.entries()) {
      try {
        await transport.close();
      } catch {
        // ignore close errors
      }
      this.transports.delete(sessionId);
    }

    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer?.close(() => resolve());
      });
      this.httpServer = null;
    }
  }

  /**
   * Updates the OpenAPI spec reference.
   */
  public updateSpec(spec: OpenApiSpec): void {
    this.options.spec = spec;
  }
}
