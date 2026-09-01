import type { McpTool } from "../types.js";
import { fixturesDomainTools, emuSeedFixturesTool, emuResetStoreTool, emuInspectFixturesTool } from "./fixtures.js";
import { nodesDomainTools, emuListNodesTool, emuSetNodeStatusTool } from "./nodes.js";
import { phonesDomainTools, emuListPhonesTool, emuSetPhoneStatusTool, emuGetPhoneWebTool, emuGetPhoneScreenshotTool } from "./phones.js";
import { callsDomainTools, emuSimulateCallTool, emuCallActionTool, emuListActiveCallsTool } from "./calls.js";
import { curriDomainTools, emuEvaluateCurriTool, emuGetCurriHistoryTool } from "./curri.js";
import { cdrDomainTools, emuGenerateCdrsTool, emuGetCdrHistoryTool } from "./cdr.js";

export * from "./fixtures.js";
export * from "./nodes.js";
export * from "./phones.js";
export * from "./calls.js";
export * from "./curri.js";
export * from "./cdr.js";

/**
 * All 16 discrete domain-specific MCP tools.
 */
export const allDomainTools: McpTool[] = [
  ...fixturesDomainTools,
  ...nodesDomainTools,
  ...phonesDomainTools,
  ...callsDomainTools,
  ...curriDomainTools,
  ...cdrDomainTools,
];
