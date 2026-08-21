/**
 * Error hierarchy for @calltelemetry/cucm-emulator-mcp
 */

export interface McpFormattedError {
  isError: true;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  content: Array<{
    type: "text";
    text: string;
  }>;
}

export class CucmEmulatorMcpError extends Error {
  public readonly code: string;
  public readonly statusCode?: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code = "INTERNAL_ERROR",
    statusCode?: number,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toMcpError(): McpFormattedError {
    const detailStr = this.details ? `\nDetails: ${JSON.stringify(this.details, null, 2)}` : "";
    return {
      isError: true,
      code: this.code,
      message: this.message,
      details: this.details,
      content: [
        {
          type: "text",
          text: `[${this.code}] ${this.message}${detailStr}`,
        },
      ],
    };
  }
}

export class ValidationError extends CucmEmulatorMcpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "VALIDATION_ERROR", 400, details);
  }
}

export class EndpointUnreachableError extends CucmEmulatorMcpError {
  constructor(endpoint: string, originalError?: unknown) {
    const errorMsg = originalError instanceof Error ? originalError.message : String(originalError ?? "Unknown error");
    super(
      `Unable to reach CUCM emulator endpoint at "${endpoint}": ${errorMsg}`,
      "ENDPOINT_UNREACHABLE",
      503,
      { endpoint, originalError: errorMsg }
    );
  }
}

export class AuthenticationError extends CucmEmulatorMcpError {
  constructor(message = "Authentication failed against CUCM emulator") {
    super(message, "AUTHENTICATION_ERROR", 401);
  }
}

export class EntityNotFoundError extends CucmEmulatorMcpError {
  constructor(entityType: string, identifier: string) {
    super(
      `${entityType} "${identifier}" was not found in CUCM emulator`,
      "ENTITY_NOT_FOUND",
      404,
      { entityType, identifier }
    );
  }
}

export class SchemaParseError extends CucmEmulatorMcpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "SCHEMA_PARSE_ERROR", 500, details);
  }
}

export class ToolExecutionError extends CucmEmulatorMcpError {
  constructor(toolName: string, message: string, details?: Record<string, unknown>) {
    super(
      `Failed to execute tool "${toolName}": ${message}`,
      "TOOL_EXECUTION_ERROR",
      500,
      { toolName, ...details }
    );
  }
}

export class InvalidStateError extends CucmEmulatorMcpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "INVALID_STATE_ERROR", 409, details);
  }
}
