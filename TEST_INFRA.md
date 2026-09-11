# Test Infrastructure & Harness Specification

**Package:** `@calltelemetry/cucm-emulator-mcp`  
**Version:** `0.1.0`  
**Architecture:** OpenAPI-Driven Model Context Protocol (MCP) Server for Cisco CUCM Emulator  
**Testing Framework:** Vitest 3.0+ / Node.js ESM / TypeScript Strict  

---

## 1. Overview & Testing Philosophy

The test infrastructure for `@calltelemetry/cucm-emulator-mcp` enforces a **4-Tier Opaque-Box End-to-End (E2E)** methodology alongside modular unit and integration testing.

### Core Testing Principles
1. **Opaque-Box Verification**: E2E tests interact strictly through the Model Context Protocol (MCP) client surface (JSON-RPC 2.0 requests over Stdio, In-Memory, and SSE transports). Tests never mutate internal server state directly during assertions.
2. **Authoritative Output Derivation**: Test assertions derive strictly from the bundled OpenAPI 3.1.0 contract (`contracts/openapi.json`), Cisco CUCM behavioral specifications (ADR 0120/0122 failover, RISDB states, CURRI policy engine, synthetic CDR formatting), and `PROJECT.md`.
3. **Deterministic & Isolated Execution**: Every test runs in complete isolation with dedicated in-memory stores or mock servers, ensuring zero order dependency, zero cross-test state leakage, and deterministic repeatability across local dev and CI.
4. **Adversarial & Boundary Verification**: Rigorous boundary testing exercises parameter type validation, illegal enums, numerical extremes, non-existent entity lookups, SQL/shell injection resilience, and MCP protocol error handling (`-32601`, `-32602`, `-32603`).

---

## 2. Directory Layout & Test Suite Hierarchy

```
test/
├── helpers/
│   ├── mock-cucm-server.ts          # HTTP test server simulating live CUCM Emulator REST/OpenAPI
│   └── mcp-test-client.ts           # Opaque-box MCP client helper (Stdio, SSE, In-Memory)
├── unit/
│   ├── openapi/                     # OpenAPI parser, dereferencer, schema builder tests
│   ├── client/                      # HTTP client, mock client, endpoint resolver tests
│   ├── mock/                        # In-memory store, fixture generator, simulator tests
│   └── tools/                       # Tool generator, registry, safety annotations tests
├── integration/
│   ├── mcp-protocol.test.ts         # JSON-RPC 2.0 protocol handshake, ping, error codes
│   └── dynamic-reload.test.ts       # Spec reload triggering notifications/tools/list_changed
└── e2e/
    ├── tier1_features.test.ts       # Tier 1: 100% tool surface coverage (15 domain + dynamic)
    ├── tier2_boundaries.test.ts     # Tier 2: Validation, illegal enums, boundaries, error codes
    ├── tier3_cross_feature.test.ts  # Tier 3: Stateful multi-step workflows (failover, CURRI, CDR)
    └── tier4_real_world.test.ts     # Tier 4: Concurrency bursts, 1k phone fleet, failover soak
```

---

## 3. Test Execution Matrix & Commands

| Suite | Command | Scope & Targets | SLA / Target Duration |
|---|---|---|---|
| **All Tests** | `npm test` or `npx vitest run` | Full Unit, Integration, and 4-Tier E2E Suites | < 10.0s |
| **Typecheck** | `npm run typecheck` | Strict TypeScript compilation (`tsc --noEmit`) | < 3.0s |
| **Coverage** | `npm run test:coverage` | Vitest v8 coverage report (100% threshold) | < 12.0s |
| **E2E Suite** | `npm run test:e2e` | All 4 tiers (`test/e2e/tier*.test.ts`) | < 6.0s |
| **Tier 1 E2E** | `npx vitest run test/e2e/tier1_features.test.ts` | 15 discrete `cucm_emulator_*` tools + dynamic OpenAPI ops | < 2.0s |
| **Tier 2 E2E** | `npx vitest run test/e2e/tier2_boundaries.test.ts` | Negative validation, illegal enums, error codes | < 1.5s |
| **Tier 3 E2E** | `npx vitest run test/e2e/tier3_cross_feature.test.ts` | Multi-step cross-feature workflows | < 2.0s |
| **Tier 4 E2E** | `npx vitest run test/e2e/tier4_real_world.test.ts` | 50 parallel calls, 1k phones, failover storm | < 3.5s |
| **Packaging** | `npm pack --dry-run` | Distribution tarball cleanliness verification | < 2.0s |

---

## 4. Test Helpers & Infrastructure Architecture

### 4.1 Mock CUCM HTTP Server (`test/helpers/mock-cucm-server.ts`)
The `MockCucmServer` provides a lightweight, in-process HTTP server simulating the live CUCM Emulator REST/OpenAPI service for testing the `HttpCucmClient` and remote endpoint workflows:
- **Ephemeral Port Binding**: Binds to port `0` (`127.0.0.1:<random_port>`) preventing port collisions.
- **Complete Route Coverage**: Implements all endpoints from `contracts/openapi.json`:
  - `/api/summary`, `/api/topology`, `/api/sql`
  - `/api/inventory` (GET, POST), `/api/inventory/:id` (GET, PATCH, DELETE)
  - `/api/nodes` (GET), `/api/nodes/:node/status` (POST/PATCH)
  - `/api/phones` (GET), `/api/phones/:nameOrIp/status` (POST/PATCH), `/api/phones/:nameOrIp/web` (GET)
  - `/api/calls/sessions` (GET, POST), `/api/calls/sessions/:id` (GET, POST, DELETE), `/api/calls/sessions/:id/events` (POST)
  - `/api/curri/events` (GET), `/api/curri/evaluate` (POST)
  - `/api/cdr/records` (GET), `/api/cdr/export` (GET), `/api/cdr/generate` (POST), `/api/cdr/publisher` (GET, POST)
  - `/api/cmr/records` (GET), `/api/cmr/publisher` (GET, POST)
  - `/api/syslog/events` (GET), `/api/syslog/sources` (GET), `/api/syslog/publisher` (GET, POST)
  - `/api/snapshots` (GET), `/api/snapshots/export` (POST), `/api/snapshots/import` (POST), `/api/snapshots/load` (POST)
  - `/api/fixtures/seed` (POST), `/api/fixtures/reset` (POST), `/api/fixtures/inspect` (GET)
  - `/api/openapi.json` (GET)
- **Fault Injection & Latency Simulation**:
  - `setFailureMode(endpointPattern, statusCode, errorMessage)`
  - `setLatency(ms)`
  - `getRequestHistory()` for asserting received headers, auth tokens, and payloads.

### 4.2 Opaque-Box MCP Test Client (`test/helpers/mcp-test-client.ts`)
The `McpTestClient` wraps `@modelcontextprotocol/sdk` to provide high-level, strongly-typed testing methods:
- **Transport Flexibility**: Supports `InMemoryTransport`, `StdioClientTransport`, and `SSEClientTransport`.
- **Protocol Method Wrappers**:
  - `initialize()`: Performs standard JSON-RPC 2.0 handshake and capability negotiation.
  - `listTools()`: Retrieves all registered tool definitions.
  - `callTool(name, args)`: Executes tool and returns standard MCP `CallToolResult`.
  - `callToolSuccess(name, args)`: Parses JSON text content and asserts `isError !== true`.
  - `callToolError(name, args)`: Asserts error response structure and error code.
  - `onNotification(method, callback)` & `getNotifications()`: Captures protocol dispatches like `notifications/tools/list_changed`.

---

## 5. 4-Tier E2E Test Suite Matrix

### Tier 1: Feature Coverage in Isolation (`test/e2e/tier1_features.test.ts`)
- **Domain 1: Fixtures & Topology**: `cucm_emulator_seed_fixtures`, `cucm_emulator_reset_store`, `cucm_emulator_inspect_fixtures`.
- **Domain 2: Nodes & Health**: `cucm_emulator_list_nodes`, `cucm_emulator_simulate_node_failover` (Online, Offline, NotFound).
- **Domain 3: Phones & Registration**: `cucm_emulator_list_phones`, `cucm_emulator_set_phone_status` (Registered, UnRegistered, Rejected), `cucm_emulator_get_phone_web`.
- **Domain 4: Call Simulation & Legs**: `cucm_emulator_simulate_call`, `cucm_emulator_call_action` (answer, hold, resume, drop), `cucm_emulator_list_active_calls`.
- **Domain 5: CURRI / ECC Routing**: `cucm_emulator_evaluate_curri`, `cucm_emulator_get_curri_history`.
- **Domain 6: CDR / CMR Buffers**: `cucm_emulator_generate_cdrs`, `cucm_emulator_get_cdr_history`.
- **Dynamic OpenAPI Operations**: Auto-generated tools (`cucm_emulator_get_summary`, `cucm_emulator_query_sql`, `cucm_emulator_get_topology`, `cucm_emulator_list_inventory`, `cucm_emulator_create_call_session`, `cucm_emulator_export_cdr_csv`, `cucm_emulator_load_snapshot`, etc.).

### Tier 2: Boundary & Corner Cases (`test/e2e/tier2_boundaries.test.ts`)
- **Schema Rejections**: Missing required arguments, invalid types (string for number, object for array).
- **Illegal Enum Values**: Invalid node status (`status: "Dead"`), invalid call action (`action: "jump"`), invalid fixture profile.
- **Non-Existent Entities**: Operations targeting non-existent nodes (`Node-999`), phones (`SEP000000000000`), call sessions (`uuid-fake`), and snapshots (`snap-999`).
- **Numerical Extremes**: Negative call duration (`-10`), zero phone seeds (`0`), massive counts (`1000000`), negative limits.
- **Protocol Rejections**: Calling non-existent tools returns standard MCP `-32601` error.
- **Injection Safety**: SQL injection payloads in queries, directory traversal strings in phone names, special characters.

### Tier 3: Cross-Feature Stateful Workflows (`test/e2e/tier3_cross_feature.test.ts`)
- **Workflow 1 (Node Failover & Re-registration)**: Node set to `Offline` -> Phones re-register to backup node -> Call simulated between re-registered phones -> Synthetic CDR generated with updated node routing.
- **Workflow 2 (CURRI Policy & Call Routing)**: CURRI policy evaluated -> returns divert/block verdict -> Simulated call receives disposition -> CDR record captures cause code.
- **Workflow 3 (Complete Call Lifecycle)**: Simulate call -> Alerting -> Hold -> Resume -> Drop with reason `NormalClearing` -> Assert final CDR duration and state.
- **Workflow 4 (Snapshot Export, Mutate, Restore)**: Seed state -> Export snapshot -> Mutate/wipe phones -> Assert mutated state -> Load snapshot -> Assert exact restoration.
- **Workflow 5 (Dynamic Spec Reload & Protocol Notification)**: Connect client -> Trigger fixture/spec reload -> Client receives `notifications/tools/list_changed`.

### Tier 4: Real-World Workloads & Scale (`test/e2e/tier4_real_world.test.ts`)
- **High-Concurrency Call Burst**: 50 concurrent call simulations executed in parallel via `Promise.all`.
- **Large Phone Fleet Pagination**: Manage 1,000 phone fleet, pagination queries, and batch status mutations.
- **Failover Under Active Load**: 25 active concurrent calls when a cluster node suddenly fails offline.
- **Multi-Transport Client Coexistence**: Stdio and SSE clients simultaneously querying and mutating the same server instance.
- **Extended Soak & Stability**: 100+ consecutive multi-domain operations with stable memory and zero unhandled rejections.

---

## 6. Pass/Fail Gates & Invalidation Conditions

1. **100% Test Pass Rate**: Zero test failures, zero unexpected skips across all test suites.
2. **Strict Type Safety**: Zero TypeScript compilation errors (`npm run typecheck`).
3. **Pure Transport Isolation**: In Stdio mode, `stdout` must contain strictly valid JSON-RPC 2.0 frames; all diagnostics must route to `stderr`.
4. **Clean Distribution Packaging**: `npm pack --dry-run` must produce a lean tarball (< 2MB) containing only `dist/`, `contracts/`, `README.md`, `LICENSE`, and `package.json`.
