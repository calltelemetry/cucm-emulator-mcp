# @calltelemetry/cucm-emulator-mcp

OpenAPI-driven Model Context Protocol (MCP) server for Cisco Unified Communications Manager (CUCM) Emulator.

## Overview

`@calltelemetry/cucm-emulator-mcp` is an OpenAPI-driven MCP server that connects AI coding assistants and automation agents directly to Cisco CUCM Emulator instances. It parses the emulator's OpenAPI 3.1.0 contract specification to dynamically generate strongly-typed discrete MCP tools across all 6 core telephony domains:

1. **Fixtures & Topology**: `cucm_emulator_seed_fixtures`, `cucm_emulator_reset_store`, `cucm_emulator_inspect_fixtures`
2. **Nodes & Cluster Health**: `cucm_emulator_list_nodes`, `cucm_emulator_simulate_node_failover` (ADR 0120/0122 failover)
3. **Phones & Registration**: `cucm_emulator_list_phones`, `cucm_emulator_set_phone_status`, `cucm_emulator_get_phone_web`
4. **Call Simulation & Legs**: `cucm_emulator_simulate_call`, `cucm_emulator_call_action`, `cucm_emulator_list_active_calls`
5. **CURRI / ECC Policy Routing**: `cucm_emulator_evaluate_curri`, `cucm_emulator_get_curri_history`
6. **CDR / CMR Buffers**: `cucm_emulator_generate_cdrs`, `cucm_emulator_get_cdr_history`
7. **Dynamic OpenAPI Operations**: 46+ auto-compiled operations (`cucm_emulator_get_summary`, `cucm_emulator_get_topology`, `cucm_emulator_query_sql`, `cucm_emulator_list_inventory`, `cucm_emulator_upsert_inventory`, etc.)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AI Agents / MCP Clients                  │
│                (Claude Code, Cursor, Windsurf)              │
└──────────────────────────────┬──────────────────────────────┘
                               │ JSON-RPC 2.0 (Stdio / SSE)
┌──────────────────────────────▼──────────────────────────────┐
│                  CucmEmulatorMcpServer                      │
│                                                             │
│  ┌───────────────────────┐      ┌────────────────────────┐  │
│  │     Tool Registry     │      │   OpenAPI Spec Parser  │  │
│  │ (15 Domain + Dynamic) │◄─────┤   (Dereferencer/Build) │  │
│  └───────────┬───────────┘      └────────────────────────┘  │
│              │                                              │
│  ┌───────────▼───────────────────────────────────────────┐  │
│  │             ICucmEmulatorClient Abstraction           │  │
│  └───────────┬───────────────────────────┬───────────────┘  │
└──────────────┼───────────────────────────┼──────────────────┘
               │                           │
┌──────────────▼────────────┐ ┌────────────▼──────────────────┐
│      HttpCucmClient       │ │    DirectStoreCucmClient      │
│  Live In-Guest / Container│ │  In-Memory Mock Store State   │
│ (http://127.0.0.1:8443)   │ │  (100% Offline Zero-Config)   │
└───────────────────────────┘ └───────────────────────────────┘
```

## Installation & Quick Start

### Global CLI

```bash
npm install -g @calltelemetry/cucm-emulator-mcp
```

### Run Stdio Server (for AI Agents / Claude Desktop)

```bash
cucm-emulator-mcp --transport stdio
```

### Run SSE Server

```bash
cucm-emulator-mcp --transport sse --port 3000 --host 127.0.0.1
```

### Configuration Options

| Option | Flag | Environment Variable | Default | Description |
|---|---|---|---|---|
| Transport | `-t, --transport` | `MCP_TRANSPORT` | `stdio` | Transport type: `stdio` or `sse` |
| Port | `-p, --port` | `PORT` / `MCP_PORT` | `3000` | Port for SSE HTTP server |
| Host | `-h, --host` | `HOST` / `MCP_HOST` | `127.0.0.1` | Bind host for SSE transport |
| Target URL | `-u, --target-url` | `CUCM_EMULATOR_URL` | `undefined` | Target live emulator URL |
| Spec Path | `-s, --spec-path` | `CUCM_OPENAPI_SPEC` | Bundled | Path or URL to OpenAPI 3.1.0 spec |
| Mock Mode | `-m, --mock` | `CUCM_MOCK` | `false` | Force in-process in-memory mock store |
| Seed Profile | `--seed-profile` | `CUCM_SEED_PROFILE` | `lab-small` | `lab-small`, `standard-enterprise`, `empty` |
| Auth Token | `--auth-token` | `CUCM_EMULATOR_AUTH_TOKEN` | `undefined` | Bearer auth token for live emulator |
| Redact Secrets | `--redact-secrets`| `REDACT_SECRETS` | `false` | Redact sensitive strings in logs |

## MCP Client Configuration

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "cucm-emulator": {
      "command": "cucm-emulator-mcp",
      "args": ["--transport", "stdio", "--mock", "--seed-profile", "lab-small"]
    }
  }
}
```

### SSE Integration

```json
{
  "mcpServers": {
    "cucm-emulator-sse": {
      "url": "http://127.0.0.1:3000/sse"
    }
  }
}
```

## Available Tool Reference

### Fixtures & Topology
- `cucm_emulator_seed_fixtures`: Seeds deterministic cluster topology, nodes, phones, dial plan partitions, CSS, and CURRI policies.
- `cucm_emulator_reset_store`: Resets or wipes emulator state and re-seeds with a specified topology profile.
- `cucm_emulator_inspect_fixtures`: Inspects and returns a comprehensive summary of active CUCM cluster state.

### Nodes & Failover
- `cucm_emulator_list_nodes`: Lists all CUCM cluster nodes (Publisher, Subscribers, TFTP) with roles and RIS return codes.
- `cucm_emulator_simulate_node_failover`: Sets node status (`Online`, `Offline`, `NotFound`, `SearchLimitExceeded`) for ADR 0120/0122 failover testing.

### Phones & Registration
- `cucm_emulator_list_phones`: Lists configured and registered Cisco IP phone endpoints with directory numbers and MACs.
- `cucm_emulator_set_phone_status`: Updates phone registration status (`Registered`, `UnRegistered`, `Rejected`, `Unknown`).
- `cucm_emulator_get_phone_web`: Fetches phone XML, HTML, or JSON serviceability / status web responses.

### Call Simulation
- `cucm_emulator_simulate_call`: Simulates an end-to-end telephone call through CUCM dial plan routing with RTP media metrics.
- `cucm_emulator_call_action`: Executes mid-call actions (`answer`, `hold`, `resume`, `drop`).
- `cucm_emulator_list_active_calls`: Lists active in-progress call sessions in the emulator.

### CURRI / ECC Policy Routing
- `cucm_emulator_evaluate_curri`: Evaluates external call routing policies via CURRI / ECC, returning permit, deny, or divert verdicts.
- `cucm_emulator_get_curri_history`: Retrieves the log of past CURRI routing evaluation decisions.

### CDR / CMR Buffers
- `cucm_emulator_generate_cdrs`: Generates batches of synthetic CDR records (normal, abandoned, curri-blocked, burst).
- `cucm_emulator_get_cdr_history`: Retrieves recent CDR records in structured JSON or raw Cisco CSV export format.

### SOAP AXL / RIS / DIME (short aliases)
Cursor rejects any MCP `tools/list` that contains a name longer than 64 characters. The DIME log-collection path otherwise compiles to a 72-character name, which dropped the whole SOAP surface in 0.1.2. These aliases post the same emulator SOAP endpoints (no second HTTP API):

- `cucm_emulator_axl`: `POST /axl/` (AXL envelope in `body`)
- `cucm_emulator_ris`: `POST /realtimeservice2/services/RISService70`
- `cucm_emulator_dime`: `POST /logcollectionservice2/services/LogCollectionPortTypeService`
- `cucm_emulator_dime_file`: `POST /logcollectionservice/services/DimeGetFileService`

Inventory, CGI, and screenshots stay on v2 HTTP / `cucm_emulator_get_phone_*`.

## Development & Verification

```bash
# Typecheck
npm run typecheck

# Build TypeScript
npm run build

# Run Full Test Suite (155 Tests)
npm test

# Run with Coverage
npm run test:coverage

# Verify Packaging
npm pack --dry-run
```

## License

MIT © Call Telemetry
