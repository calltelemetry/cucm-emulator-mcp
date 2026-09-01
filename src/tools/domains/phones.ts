import type { ICucmEmulatorClient } from "../../client/interface.js";
import type { McpTool, McpToolResult } from "../types.js";
import { inferToolAnnotations } from "../annotations.js";

/**
 * emu_list_phones: Lists phones with registration status, IP address, MAC, and lines.
 */
export const emuListPhonesTool: McpTool = {
  name: "emu_list_phones",
  description: "Lists configured and registered Cisco IP phone endpoints with their line numbers, MAC addresses, firmware, and registration status.",
  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["Registered", "UnRegistered", "Rejected", "Unknown"],
        description: "Optional filter by phone registration status",
      },
      model: {
        type: "string",
        description: "Optional filter by phone model name (e.g. Cisco 8851)",
      },
      nodeName: {
        type: "string",
        description: "Optional filter by active registering CUCM node",
      },
      limit: {
        type: "integer",
        description: "Maximum number of phones to return",
      },
      offset: {
        type: "integer",
        description: "Pagination offset",
      },
    },
    additionalProperties: false,
  },
  annotations: inferToolAnnotations("emu_list_phones", "GET", ["phones"]),
  async execute(args: Record<string, unknown>, client: ICucmEmulatorClient): Promise<McpToolResult> {
    try {
      const phones = await client.listInventory("phones", args);
      return {
        content: [{ type: "text", text: JSON.stringify(phones, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: err?.message || String(err) }],
        isError: true,
      };
    }
  },
};

/**
 * emu_set_phone_status: Updates phone registration state (Registered, UnRegistered, Rejected).
 */
export const emuSetPhoneStatusTool: McpTool = {
  name: "emu_set_phone_status",
  description: "Updates the registration status of a specific Cisco IP phone (Registered, UnRegistered, Rejected) in the RISDB projection.",
  inputSchema: {
    type: "object",
    properties: {
      phoneName: {
        type: "string",
        description: "Device name of the phone (e.g. SEP001122334455)",
      },
      status: {
        type: "string",
        enum: ["Registered", "UnRegistered", "Rejected", "Unknown"],
        description: "New registration status for the phone",
      },
    },
    required: ["phoneName", "status"],
    additionalProperties: false,
  },
  annotations: inferToolAnnotations("emu_set_phone_status", "POST", ["phones"]),
  async execute(args: Record<string, unknown>, client: ICucmEmulatorClient): Promise<McpToolResult> {
    try {
      const phoneName = String(args.phoneName);
      const status = String(args.status);
      const result = await client.setPhoneStatus(phoneName, status);
      return {
        content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: err?.message || String(err) }],
        isError: true,
      };
    }
  },
};

/**
 * emu_get_phone_web: Scrapes/fetches phone web server pages (XML, HTML, JSON).
 */
export const emuGetPhoneWebTool: McpTool = {
  name: "emu_get_phone_web",
  description: "Retrieves serviceability, network configuration, or XML execute web responses from a simulated Cisco IP phone endpoint.",
  inputSchema: {
    type: "object",
    properties: {
      phoneNameOrIp: {
        type: "string",
        description: "Device name (e.g. SEP001122334455) or IP address of the target phone",
      },
      path: {
        type: "string",
        description: "Web path on the phone (e.g. /CiscoIPPhoneResponse, /NetworkConfiguration, /CGI/Execute)",
      },
      format: {
        type: "string",
        enum: ["xml", "html", "json"],
        description: "Response format flavor (default: xml)",
      },
    },
    required: ["phoneNameOrIp"],
    additionalProperties: false,
  },
  annotations: inferToolAnnotations("emu_get_phone_web", "GET", ["phones"]),
  async execute(args: Record<string, unknown>, client: ICucmEmulatorClient): Promise<McpToolResult> {
    try {
      const phoneNameOrIp = String(args.phoneNameOrIp);
      const path = args.path ? String(args.path) : "/CiscoIPPhoneResponse";
      const format = args.format ? String(args.format) : "xml";
      const result = await client.getPhoneWeb(phoneNameOrIp, path, format);
      return {
        content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: err?.message || String(err) }],
        isError: true,
      };
    }
  },
};

export const emuGetPhoneScreenshotTool: McpTool = {
  name: "emu_get_phone_screenshot",
  description:
    "Fetches the Cisco IP Phone CGI screenshot from /emulated-phone/{name}/CGI/Screenshot (BMP when authenticated; CiscoIPPhoneError Number=4 without auth on the live emulator).",
  inputSchema: {
    type: "object",
    properties: {
      phoneNameOrIp: {
        type: "string",
        description: "Device name (e.g. SEP001122334455) or IP address of the target phone",
      },
      path: {
        type: "string",
        description: "Screenshot path on the phone web server (default: /CGI/Screenshot)",
      },
    },
    required: ["phoneNameOrIp"],
    additionalProperties: false,
  },
  annotations: inferToolAnnotations("emu_get_phone_screenshot", "GET", ["phones"]),
  async execute(args: Record<string, unknown>, client: ICucmEmulatorClient): Promise<McpToolResult> {
    try {
      const phoneNameOrIp = String(args.phoneNameOrIp);
      const path = args.path ? String(args.path) : "/CGI/Screenshot";
      const result = await client.getPhoneWeb(phoneNameOrIp, path, "bmp");
      return {
        content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: err?.message || String(err) }],
        isError: true,
      };
    }
  },
};

export const phonesDomainTools: McpTool[] = [
  emuListPhonesTool,
  emuSetPhoneStatusTool,
  emuGetPhoneWebTool,
  emuGetPhoneScreenshotTool,
];
