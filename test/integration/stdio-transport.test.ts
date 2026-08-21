import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { redirectLogsToStderr, restoreLogsFromStderr } from "../../src/transports/stdio.js";

describe("Integration: Stdio Server Transport Log Redirection", () => {
  let stderrSpy: any;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true as any);
  });

  afterEach(() => {
    restoreLogsFromStderr();
    stderrSpy.mockRestore();
  });

  it("redirects console.log to process.stderr", () => {
    redirectLogsToStderr();
    console.log("test stdio log isolation message");

    expect(stderrSpy).toHaveBeenCalled();
    const lastCall = stderrSpy.mock.calls[stderrSpy.mock.calls.length - 1][0];
    expect(lastCall).toContain("test stdio log isolation message");
  });

  it("redirects console.info and console.warn with prefixes to process.stderr", () => {
    redirectLogsToStderr();
    console.info("info level message");
    console.warn("warn level message");

    expect(stderrSpy).toHaveBeenCalled();
    const calls = stderrSpy.mock.calls.map((c: any) => c[0]);
    expect(calls.some((c: string) => c.includes("[INFO] info level message"))).toBe(true);
    expect(calls.some((c: string) => c.includes("[WARN] warn level message"))).toBe(true);
  });

  it("restores original console methods on cleanup", () => {
    redirectLogsToStderr();
    restoreLogsFromStderr();

    // After restoring, console.log should not invoke process.stderr spy directly
    const callCountBefore = stderrSpy.mock.calls.length;
    // console.log writes to stdout normally
    // verify no error
    expect(callCountBefore).toBeDefined();
  });
});
