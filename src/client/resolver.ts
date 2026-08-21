import { request } from "undici";
import type { ICucmEmulatorClient } from "./interface.js";
import { DirectStoreCucmClient } from "./mock-client.js";
import { HttpCucmClient } from "./http-client.js";

export interface ResolverOptions {
  targetUrl?: string;
  forceMock?: boolean;
  authToken?: string;
  dopplerToken?: string;
  dopplerProject?: string;
  dopplerConfig?: string;
  timeoutMs?: number;
}

export interface ResolvedClientResult {
  client: ICucmEmulatorClient;
  mode: "http" | "mock";
  targetUrl?: string;
}

/**
 * Multi-tier endpoint and credential resolver.
 * Evaluates options in priority order:
 * 1. Forced Mock Flag (--force-mock)
 * 2. Explicit CLI Target URL (--target-url)
 * 3. Environment Variables (CUCM_EMULATOR_URL, EMULATOR_URL)
 * 4. Doppler Secrets (DOPPLER_TOKEN)
 * 5. Auto-probe local container (http://127.0.0.1:8443)
 * 6. Fallback to in-memory mock store (DirectStoreCucmClient)
 */
export class EndpointResolver {
  /**
   * Probes whether an HTTP endpoint is reachable and responding as a CUCM emulator.
   */
  public static async probeEndpoint(url: string, timeoutMs = 800): Promise<boolean> {
    try {
      const cleanUrl = url.replace(/\/+$/, "");
      const res = await request(`${cleanUrl}/api/v2/summary`, {
        method: "GET",
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
      });

      return res.statusCode >= 200 && res.statusCode < 300;
    } catch {
      return false;
    }
  }

  /**
   * Resolves the appropriate ICucmEmulatorClient backend based on environment and options.
   */
  public static async resolveClient(options: ResolverOptions = {}): Promise<ResolvedClientResult> {
    // 1. Force Mock
    if (options.forceMock || process.env.FORCE_MOCK === "1" || process.env.FORCE_MOCK === "true") {
      return {
        client: new DirectStoreCucmClient(),
        mode: "mock",
      };
    }

    // 2. Explicit Target URL from options
    if (options.targetUrl) {
      return {
        client: new HttpCucmClient({
          targetUrl: options.targetUrl,
          authToken: options.authToken || process.env.CUCM_EMULATOR_AUTH_TOKEN,
          timeoutMs: options.timeoutMs,
        }),
        mode: "http",
        targetUrl: options.targetUrl,
      };
    }

    // 3. Environment Variables
    const envUrl = process.env.CUCM_EMULATOR_URL || process.env.EMULATOR_URL;
    if (envUrl) {
      return {
        client: new HttpCucmClient({
          targetUrl: envUrl,
          authToken: options.authToken || process.env.CUCM_EMULATOR_AUTH_TOKEN,
          timeoutMs: options.timeoutMs,
        }),
        mode: "http",
        targetUrl: envUrl,
      };
    }

    // 4. Doppler Token resolution
    const dopplerToken = options.dopplerToken || process.env.DOPPLER_TOKEN;
    if (dopplerToken && process.env.DOPPLER_CUCM_EMULATOR_URL) {
      return {
        client: new HttpCucmClient({
          targetUrl: process.env.DOPPLER_CUCM_EMULATOR_URL,
          authToken: options.authToken || process.env.DOPPLER_CUCM_AUTH_TOKEN,
          timeoutMs: options.timeoutMs,
        }),
        mode: "http",
        targetUrl: process.env.DOPPLER_CUCM_EMULATOR_URL,
      };
    }

    // 5. Auto-probe local container on default port 8443
    const localDefaultUrl = "http://127.0.0.1:8443";
    const isLocalLive = await EndpointResolver.probeEndpoint(localDefaultUrl);
    if (isLocalLive) {
      return {
        client: new HttpCucmClient({
          targetUrl: localDefaultUrl,
          timeoutMs: options.timeoutMs,
        }),
        mode: "http",
        targetUrl: localDefaultUrl,
      };
    }

    // 6. In-Memory Mock Store Fallback
    return {
      client: new DirectStoreCucmClient(),
      mode: "mock",
    };
  }
}
