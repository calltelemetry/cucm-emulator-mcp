import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

let originalConsoleLog: typeof console.log | null = null;
let originalConsoleInfo: typeof console.info | null = null;
let originalConsoleDebug: typeof console.debug | null = null;
let originalConsoleWarn: typeof console.warn | null = null;

/**
 * Redirects all console logging methods (log, info, debug, warn) to process.stderr
 * to guarantee that stdout remains strictly pristine for JSON-RPC protocol frames.
 */
export function redirectLogsToStderr(): void {
  if (originalConsoleLog !== null) {
    return; // Already redirected
  }

  originalConsoleLog = console.log;
  originalConsoleInfo = console.info;
  originalConsoleDebug = console.debug;
  originalConsoleWarn = console.warn;

  console.log = (...args: unknown[]) => {
    process.stderr.write(`${args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")}\n`);
  };

  console.info = (...args: unknown[]) => {
    process.stderr.write(`[INFO] ${args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")}\n`);
  };

  console.debug = (...args: unknown[]) => {
    process.stderr.write(`[DEBUG] ${args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")}\n`);
  };

  console.warn = (...args: unknown[]) => {
    process.stderr.write(`[WARN] ${args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")}\n`);
  };
}

/**
 * Restores original console logging methods.
 */
export function restoreLogsFromStderr(): void {
  if (originalConsoleLog !== null) {
    console.log = originalConsoleLog;
    originalConsoleLog = null;
  }
  if (originalConsoleInfo !== null) {
    console.info = originalConsoleInfo;
    originalConsoleInfo = null;
  }
  if (originalConsoleDebug !== null) {
    console.debug = originalConsoleDebug;
    originalConsoleDebug = null;
  }
  if (originalConsoleWarn !== null) {
    console.warn = originalConsoleWarn;
    originalConsoleWarn = null;
  }
}

/**
 * Creates and initializes a StdioServerTransport with stdout log isolation.
 */
export function createStdioTransport(): StdioServerTransport {
  redirectLogsToStderr();
  return new StdioServerTransport();
}
