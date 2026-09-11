import { request } from "undici";
import type { ICucmEmulatorClient } from "./interface.js";
import type {
  CurriDecision,
  CurriEvaluationInput,
  GenerateCdrInput,
  GenerateCdrResult,
  SeedFixturesInput,
  SimulateCallInput,
  SimulatedCallResult,
} from "../types/domain.js";
import {
  AuthenticationError,
  EndpointUnreachableError,
  EntityNotFoundError,
  ToolExecutionError,
  ValidationError,
} from "../types/errors.js";
import { isSoapEndpoint } from "../openapi/schema-builder.js";

export interface HttpCucmClientOptions {
  targetUrl: string;
  authToken?: string;
  username?: string;
  password?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface RequestOverrides {
  targetUrl?: string;
  authToken?: string;
  username?: string;
  password?: string;
}

/**
 * Live HTTP Client for CUCM Emulator REST/Phone APIs.
 * Dispatches requests over undici with retry backoff, auth token injection, and timeout management.
 */
export class HttpCucmClient implements ICucmEmulatorClient {
  public readonly mode = "http" as const;
  public readonly targetUrl: string;
  private readonly authToken?: string;
  private readonly username?: string;
  private readonly password?: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(options: HttpCucmClientOptions) {
    this.targetUrl = options.targetUrl.replace(/\/+$/, "");
    this.authToken = options.authToken;
    this.username = options.username;
    this.password = options.password;
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 300;
  }

  private async dispatchRequest<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT",
    endpoint: string,
    body?: unknown,
    queryParams?: Record<string, unknown>,
    overrides?: RequestOverrides
  ): Promise<T> {
    const baseUrl = (overrides?.targetUrl || this.targetUrl).replace(/\/+$/, "");
    let url = `${baseUrl}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

    if (queryParams && Object.keys(queryParams).length > 0) {
      const searchParams = new URLSearchParams();
      for (const [k, v] of Object.entries(queryParams)) {
        if (v !== undefined && v !== null) {
          searchParams.append(k, String(v));
        }
      }
      const qs = searchParams.toString();
      if (qs) {
        url += (url.includes("?") ? "&" : "?") + qs;
      }
    }

    const soap = isSoapEndpoint(endpoint);
    const headers: Record<string, string> = {
      Accept: soap ? "text/xml, multipart/related, */*" : "application/json, text/plain, */*",
    };

    const token = overrides?.authToken ?? this.authToken;
    const user = overrides?.username ?? this.username;
    const pass = overrides?.password ?? this.password;

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    } else if (user && pass) {
      const encoded = Buffer.from(`${user}:${pass}`).toString("base64");
      headers.Authorization = `Basic ${encoded}`;
    }

    let payload: string | undefined;
    if (body !== undefined) {
      if (soap && typeof body === "string") {
        headers["Content-Type"] = "text/xml; charset=utf-8";
        payload = body;
      } else {
        headers["Content-Type"] = "application/json";
        payload = JSON.stringify(body);
      }
    }

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await request(url, {
          method,
          headers,
          body: payload,
          headersTimeout: this.timeoutMs,
          bodyTimeout: this.timeoutMs,
        });

        const statusCode = response.statusCode;
        const rawBody = await response.body.text();

        if (statusCode >= 200 && statusCode < 300) {
          if (!rawBody || rawBody.trim() === "") {
            return {} as T;
          }
          try {
            return JSON.parse(rawBody) as T;
          } catch {
            return rawBody as unknown as T;
          }
        }

        if (statusCode === 401 || statusCode === 403) {
          throw new AuthenticationError(`Authentication failed against ${url} (HTTP ${statusCode})`);
        }

        if (statusCode === 404) {
          throw new EntityNotFoundError("EndpointResource", url);
        }

        if (statusCode === 400 || statusCode === 422) {
          throw new ValidationError(`Request to ${url} failed validation: ${rawBody}`);
        }

        // Retryable server errors (502, 503, 504)
        if (statusCode >= 500 && attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, this.retryDelayMs * Math.pow(2, attempt - 1)));
          continue;
        }

        throw new ToolExecutionError(
          `${method} ${endpoint}`,
          `HTTP ${statusCode}: ${rawBody}`
        );
      } catch (err: any) {
        lastError = err;
        if (err instanceof AuthenticationError || err instanceof EntityNotFoundError || err instanceof ValidationError) {
          throw err;
        }

        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, this.retryDelayMs * Math.pow(2, attempt - 1)));
          continue;
        }
      }
    }

    throw new EndpointUnreachableError(overrides?.targetUrl || this.targetUrl, lastError);
  }

  public async getSummary(): Promise<Record<string, unknown>> {
    return this.dispatchRequest("GET", "/api/v2/summary");
  }

  public async getTopology(): Promise<Record<string, unknown>> {
    return this.dispatchRequest("GET", "/api/v2/topology");
  }

  public async listInventory(resource: string, query?: Record<string, unknown>): Promise<unknown[]> {
    return this.dispatchRequest("GET", `/api/v2/inventory/${encodeURIComponent(resource)}`, undefined, query);
  }

  public async getInventoryItem(resource: string, id: string): Promise<unknown> {
    return this.dispatchRequest("GET", `/api/v2/inventory/${encodeURIComponent(resource)}/${encodeURIComponent(id)}`);
  }

  public async upsertInventory(resource: string, payload: Record<string, unknown>): Promise<unknown> {
    return this.dispatchRequest("POST", `/api/v2/inventory/${encodeURIComponent(resource)}`, payload);
  }

  public async patchInventory(
    resource: string,
    id: string,
    payload: Record<string, unknown>
  ): Promise<unknown> {
    return this.dispatchRequest("PATCH", `/api/v2/inventory/${encodeURIComponent(resource)}/${encodeURIComponent(id)}`, payload);
  }

  public async deleteInventory(resource: string, id: string): Promise<boolean> {
    await this.dispatchRequest("DELETE", `/api/v2/inventory/${encodeURIComponent(resource)}/${encodeURIComponent(id)}`);
    return true;
  }

  public async setNodeStatus(
    nodeName: string,
    role?: string,
    risReturnCode = "Ok",
    version?: string
  ): Promise<unknown> {
    return this.patchInventory("nodes", nodeName, {
      ...(role ? { role } : {}),
      ...(version ? { version } : {}),
      risReturnCode,
    });
  }

  public async setPhoneStatus(phoneName: string, status: string): Promise<unknown> {
    return this.patchInventory("phones", phoneName, { status });
  }

  public async simulateCall(input: SimulateCallInput): Promise<SimulatedCallResult> {
    return this.dispatchRequest("POST", "/api/v2/call-sessions", input);
  }

  public async executeCallAction(sessionId: string, action: string, reason?: string): Promise<unknown> {
    if (action === "drop") {
      return this.dispatchRequest("DELETE", `/api/v2/call-sessions/${encodeURIComponent(sessionId)}`, { reason });
    }
    return this.dispatchRequest("POST", `/api/v2/call-sessions/${encodeURIComponent(sessionId)}/events`, {
      type: action,
      reason,
    });
  }

  public async listActiveCalls(query?: { state?: string; limit?: number }): Promise<unknown[]> {
    return this.dispatchRequest("GET", "/api/v2/call-sessions", undefined, query);
  }

  public async evaluateCurri(input: CurriEvaluationInput): Promise<CurriDecision> {
    return this.dispatchRequest("POST", "/api/v2/curri/evaluate", input);
  }

  public async getCurriHistory(query?: { limit?: number; callId?: string }): Promise<unknown[]> {
    return this.dispatchRequest("GET", "/api/v2/artifacts/curri", undefined, query);
  }

  public async getPhoneWeb(
    phoneNameOrIp: string,
    path = "/CGI/Execute",
    format = "json"
  ): Promise<unknown> {
    const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(phoneNameOrIp);
    const basePath = isIp ? `/emulated-phone-ip/${phoneNameOrIp}` : `/emulated-phone/${phoneNameOrIp}`;
    const cleanSubPath = path.startsWith("/") ? path : `/${path}`;
    return this.dispatchRequest("GET", `${basePath}${cleanSubPath}`, undefined, { format });
  }

  public async generateCdrs(input: GenerateCdrInput): Promise<GenerateCdrResult> {
    return this.dispatchRequest("POST", "/api/v2/artifacts/cdr", input);
  }

  public async getCdrHistory(query?: { limit?: number; callId?: string; format?: string }): Promise<unknown> {
    if (query?.format === "csv") {
      return this.dispatchRequest("GET", "/api/v2/artifacts/cdr/export", undefined, query);
    }
    return this.dispatchRequest("GET", "/api/v2/artifacts/cdr", undefined, query);
  }

  public async resetStore(mode = "soft", profile = "lab-small"): Promise<unknown> {
    return this.dispatchRequest("POST", "/api/v2/fixtures/reset", { mode, profile });
  }

  public async seedFixtures(input: SeedFixturesInput): Promise<unknown> {
    return this.dispatchRequest("POST", "/api/v2/fixtures/seed", input);
  }

  public async executeGenericOperation(
    method: string,
    pathTemplate: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const httpMethod = method.toUpperCase() as "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
    let renderedPath = pathTemplate;

    const queryParams: Record<string, unknown> = {};
    const bodyParams: Record<string, unknown> = {};
    const overrides: RequestOverrides = {};

    // Extract midflight target, auth, and credential overrides
    if (params.target_url) overrides.targetUrl = String(params.target_url);
    else if (params.targetUrl) overrides.targetUrl = String(params.targetUrl);
    else if (params.cucm_host) {
      const port = params.cucm_port ? `:${params.cucm_port}` : "";
      const hostStr = String(params.cucm_host);
      const proto = hostStr.startsWith("http://") || hostStr.startsWith("https://") ? "" : "https://";
      overrides.targetUrl = `${proto}${hostStr}${port}`;
    }

    if (params.auth_token) overrides.authToken = String(params.auth_token);
    else if (params.authToken) overrides.authToken = String(params.authToken);
    else if (params.bearer_token) overrides.authToken = String(params.bearer_token);

    if (params.cucm_username) overrides.username = String(params.cucm_username);
    else if (params.username) overrides.username = String(params.username);
    else if (params.auth && typeof params.auth === "object" && (params.auth as any).username) {
      overrides.username = String((params.auth as any).username);
    }

    if (params.cucm_password) overrides.password = String(params.cucm_password);
    else if (params.password) overrides.password = String(params.password);
    else if (params.auth && typeof params.auth === "object" && (params.auth as any).password) {
      overrides.password = String((params.auth as any).password);
    }

    const overrideKeys = new Set([
      "target_url",
      "targetUrl",
      "cucm_host",
      "cucm_port",
      "auth_token",
      "authToken",
      "bearer_token",
      "cucm_username",
      "username",
      "cucm_password",
      "password",
      "auth",
    ]);

    for (const [key, value] of Object.entries(params)) {
      const placeholder = `{${key}}`;
      if (renderedPath.includes(placeholder)) {
        renderedPath = renderedPath.replace(placeholder, encodeURIComponent(String(value)));
      } else if (!overrideKeys.has(key)) {
        if (httpMethod === "GET" || httpMethod === "DELETE") {
          queryParams[key] = value;
        } else {
          bodyParams[key] = value;
        }
      }
    }

    const payload = Object.keys(bodyParams).length > 0
      ? (bodyParams.body !== undefined && Object.keys(bodyParams).length === 1 ? bodyParams.body : bodyParams)
      : undefined;

    return this.dispatchRequest(httpMethod, renderedPath, payload, queryParams, overrides);
  }
}
