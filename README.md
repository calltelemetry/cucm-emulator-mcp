# @calltelemetry/cucm-emulator-mcp

OpenAPI-driven Model Context Protocol (MCP) server for Cisco Unified Communications Manager (CUCM) Emulator.

## Overview

`@calltelemetry/cucm-emulator-mcp` is an OpenAPI-driven MCP server that connects AI coding assistants and automation agents directly to Cisco CUCM Emulator instances. It parses the emulator's OpenAPI 3.1.0 contract specification to dynamically generate strongly-typed discrete MCP tools across all 6 core telephony domains:

1. **Fixtures & Topology**: `emu_seed_fixtures`, `emu_reset_store`, `emu_inspect_fixtures`
2. **Nodes & Cluster Health**: `emu_list_nodes`, `emu_set_node_status` (ADR 0120/0122 failover)
3. **Phones & Registration**: `emu_list_phones`, `emu_set_phone_status`, `emu_get_phone_web`
4. **Call Simulation & Legs**: `emu_simulate_call`, `emu_call_action`, `emu_list_active_calls`
5. **CURRI / ECC Policy Routing**: `emu_evaluate_curri`, `emu_get_curri_history`
6. **CDR / CMR Buffers**: `emu_generate_cdrs`, `emu_get_cdr_history`
7. **Dynamic OpenAPI Operations**: 46+ auto-compiled operations (`emu_get_summary`, `emu_get_topology`, `emu_query_sql`, `emu_list_inventory`, `emu_upsert_inventory`, etc.)

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
- `emu_seed_fixtures`: Seeds deterministic cluster topology, nodes, phones, dial plan partitions, CSS, and CURRI policies.
- `emu_reset_store`: Resets or wipes emulator state and re-seeds with a specified topology profile.
- `emu_inspect_fixtures`: Inspects and returns a comprehensive summary of active CUCM cluster state.

### Nodes & Failover
- `emu_list_nodes`: Lists all CUCM cluster nodes (Publisher, Subscribers, TFTP) with roles and RIS return codes.
- `emu_set_node_status`: Sets node status (`Online`, `Offline`, `NotFound`, `SearchLimitExceeded`) for ADR 0120/0122 failover testing.

### Phones & Registration
- `emu_list_phones`: Lists configured and registered Cisco IP phone endpoints with directory numbers and MACs.
- `emu_set_phone_status`: Updates phone registration status (`Registered`, `UnRegistered`, `Rejected`, `Unknown`).
- `emu_get_phone_web`: Fetches phone XML, HTML, or JSON serviceability / status web responses.

### Call Simulation
- `emu_simulate_call`: Simulates an end-to-end telephone call through CUCM dial plan routing with RTP media metrics.
- `emu_call_action`: Executes mid-call actions (`answer`, `hold`, `resume`, `drop`).
- `emu_list_active_calls`: Lists active in-progress call sessions in the emulator.

### CURRI / ECC Policy Routing
- `emu_evaluate_curri`: Evaluates external call routing policies via CURRI / ECC, returning permit, deny, or divert verdicts.
- `emu_get_curri_history`: Retrieves the log of past CURRI routing evaluation decisions.

### CDR / CMR Buffers
- `emu_generate_cdrs`: Generates batches of synthetic CDR records (normal, abandoned, curri-blocked, burst).
- `emu_get_cdr_history`: Retrieves recent CDR records in structured JSON or raw Cisco CSV export format.

### SOAP AXL / RIS / DIME (short aliases)
Cursor rejects any MCP `tools/list` that contains a name longer than 64 characters. The DIME log-collection path otherwise compiles to a 72-character name, which dropped the whole SOAP surface in 0.1.2. These aliases post the same emulator SOAP endpoints (no second HTTP API):

- `emu_axl`: `POST /axl/` (AXL envelope in `body`)
- `emu_ris`: `POST /realtimeservice2/services/RISService70`
- `emu_dime`: `POST /logcollectionservice2/services/LogCollectionPortTypeService`
- `emu_dime_file`: `POST /logcollectionservice/services/DimeGetFileService`

Inventory, CGI, and screenshots stay on v2 HTTP / `emu_get_phone_*`.

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
