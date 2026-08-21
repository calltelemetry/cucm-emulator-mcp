import dotenv from "dotenv";

// Load environment variables
dotenv.config();

export interface CucmEmulatorMcpConfig {
  transport: "stdio" | "sse";
  port: number;
  host: string;
  targetUrl?: string;
  specPath?: string;
  mock: boolean;
  seedProfile: "lab-small" | "standard-enterprise" | "empty";
  authToken?: string;
  redactSecrets: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
}

export function parseConfig(options: Partial<CucmEmulatorMcpConfig> = {}): CucmEmulatorMcpConfig {
  const transport = (
    options.transport ||
    process.env.MCP_TRANSPORT ||
    "stdio"
  ).toLowerCase() === "sse"
    ? "sse"
    : "stdio";

  const port =
    typeof options.port === "number"
      ? options.port
      : process.env.PORT
      ? Number(process.env.PORT)
      : process.env.MCP_PORT
      ? Number(process.env.MCP_PORT)
      : 3000;

  const host = options.host || process.env.HOST || process.env.MCP_HOST || "127.0.0.1";

  const targetUrl =
    options.targetUrl ||
    process.env.CUCM_EMULATOR_URL ||
    process.env.CUCM_EMULATOR_TARGET_URL ||
    undefined;

  const specPath =
    options.specPath ||
    process.env.CUCM_OPENAPI_SPEC ||
    process.env.OPENAPI_SPEC_PATH ||
    undefined;

  const mock = Boolean(
    options.mock ||
    process.env.CUCM_MOCK === "true" ||
    process.env.CUCM_MOCK === "1"
  );

  const rawSeedProfile = options.seedProfile || process.env.CUCM_SEED_PROFILE || "lab-small";
  const seedProfile = (
    ["lab-small", "standard-enterprise", "empty"].includes(rawSeedProfile)
      ? rawSeedProfile
      : "lab-small"
  ) as "lab-small" | "standard-enterprise" | "empty";

  const authToken =
    options.authToken ||
    process.env.CUCM_EMULATOR_AUTH_TOKEN ||
    process.env.DOPPLER_TOKEN ||
    undefined;

  const redactSecrets = Boolean(
    options.redactSecrets ||
    process.env.REDACT_SECRETS === "true" ||
    process.env.REDACT_SECRETS === "1"
  );

  const rawLogLevel = (options.logLevel || process.env.LOG_LEVEL || "info").toLowerCase();
  const logLevel = (
    ["debug", "info", "warn", "error"].includes(rawLogLevel) ? rawLogLevel : "info"
  ) as "debug" | "info" | "warn" | "error";

  return {
    transport,
    port,
    host,
    targetUrl,
    specPath,
    mock,
    seedProfile,
    authToken,
    redactSecrets,
    logLevel,
  };
}
