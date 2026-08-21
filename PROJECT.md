# Project: @calltelemetry/cucm-emulator-mcp

## Architecture
An OpenAPI-driven Model Context Protocol (MCP) server for Cisco CUCM Emulator that parses OpenAPI v3 specifications to dynamically generate strongly-typed MCP tools, implements first-class discrete tools across 6 CUCM domain areas, provides multi-tier endpoint resolution with in-memory mock store fallback, supports Stdio and SSE transports with live protocol notifications (`notifications/tools/list_changed`), and packages as an executable CLI with complete TypeScript builds and distribution validation.

### Data Flow & Component Architecture
1. **OpenAPI Schema Engine**: Loads bundled or remote OpenAPI 3.1.0 contract (`openapi.json`), recursively resolves `$ref` pointers with cyclic protection, merges path/query/body parameters into unified JSON Schema / Zod definitions.
2. **Client & Mock Layer**: `ICucmEmulatorClient` abstraction with dual backends:
   - `HttpCucmClient`: Dispatches REST/SOAP/Phone HTTP requests to live emulator instances (UAT VM slots, local containers).
   - `DirectStoreCucmClient` / `InMemoryCucmStore`: Direct in-process state machine for cluster nodes, phones, call sessions, CURRI policy engine, and CDR buffers for 100% offline functionality.
3. **Tool Surface**:
   - Dynamic OpenAPI Tools: Auto-generated from all 46 `operationId` endpoints in the spec (`emu_<operation_id>`).
   - 15 Discrete Domain Tools: Tailored tools for Fixtures/Topology (`emu_seed_fixtures`, `emu_reset_store`, `emu_inspect_fixtures`), Nodes/Failover (`emu_list_nodes`, `emu_set_node_status`), Phones (`emu_list_phones`, `emu_set_phone_status`, `emu_get_phone_web`), Calls (`emu_simulate_call`, `emu_call_action`, `emu_list_active_calls`), CURRI (`emu_evaluate_curri`, `emu_get_curri_history`), and CDRs (`emu_generate_cdrs`, `emu_get_cdr_history`).
4. **Transport & Server Layer**:
   - `CucmEmulatorMcpServer` wrapping `@modelcontextprotocol/sdk`.
   - `StdioServerTransport` for local AI CLI agents (strict stderr logging, pure stdout JSON-RPC).
   - `SSEServerTransport` with Express for remote/networked AI agent sessions.
   - Dynamic tool reload dispatching `notifications/tools/list_changed`.
5. **CLI & Packaging**:
   - `cucm-emulator-mcp` executable binary.
   - Multi-tier config resolution: CLI flags > Env vars > Doppler secrets > Default fallback.

---

## Feature Inventory
| # | Feature | Description | Milestone | Status | Source |
|---|---------|-------------|-----------|:------:|--------|
| 1 | OpenAPI Spec Parser & Loader | Loads OpenAPI 3.1.0 spec from bundled file, local path, or remote URL | M1 | DONE | R1 |
| 2 | Recursive $ref Dereferencer | Resolves local and nested `$ref` pointers with circular reference safety | M1 | DONE | R1 |
| 3 | Parameter Merger & Schema Builder | Merges path, query, and requestBody parameters into unified flat schema | M1 | DONE | R1 |
| 4 | JSON Schema & Zod Compiler | Converts OpenAPI parameter schemas to strict JSON Schema & Zod validators | M1 | DONE | R1 |
| 5 | Bundled Contract Specification | Bundles `contracts/openapi.json` for offline zero-config operation | M1 | DONE | R1 |
| 6 | ICucmEmulatorClient Abstraction | Unified client interface for both HTTP and Mock backends | M2 | DONE | R3 |
| 7 | Live HTTP Client | Robust HTTP client with authentication, retry, backoff, and timeouts | M2 | DONE | R3 |
| 8 | In-Memory Mock Store | Complete in-process CUCM state (nodes, phones, calls, CURRI, CDRs) | M2 | DONE | R3 |
| 9 | Endpoint & Doppler Resolver | Multi-tier resolution (CLI -> Env -> Doppler -> Auto-probe -> Mock) | M2 | DONE | R3 |
| 10 | Dynamic Tool Generator | Compiles OpenAPI operations into discrete strongly-typed MCP tools | M3 | DONE | R1 |
| 11 | Tool Registry & Annotations | Manages MCP tool definitions, execution routing, and safety hints | M3 | DONE | R1/R4 |
| 12 | Fixtures & Topology Domain Tools | `emu_seed_fixtures`, `emu_reset_store`, `emu_inspect_fixtures` | M3 | DONE | R2 |
| 13 | Nodes & Health Domain Tools | `emu_list_nodes`, `emu_set_node_status` (ADR 0120/0122 failover) | M3 | DONE | R2 |
| 14 | Phones & Registration Domain Tools | `emu_list_phones`, `emu_set_phone_status`, `emu_get_phone_web` | M3 | DONE | R2 |
| 15 | Call Simulation Domain Tools | `emu_simulate_call`, `emu_call_action`, `emu_list_active_calls` | M3 | DONE | R2 |
| 16 | CURRI / ECC Routing Domain Tools | `emu_evaluate_curri`, `emu_get_curri_history` | M3 | DONE | R2 |
| 17 | CDR / CMR Buffer Domain Tools | `emu_generate_cdrs`, `emu_get_cdr_history` | M3 | DONE | R2 |
| 18 | Stdio Server Transport | Stdio JSON-RPC transport with strict stderr log redirection | M4 | DONE | R4 |
| 19 | SSE Server Transport | HTTP/SSE transport with `/sse`, `/messages`, `/health` endpoints | M4 | DONE | R4 |
| 20 | Dynamic Tool Notification | Dispatches `notifications/tools/list_changed` on spec reload/seed | M4 | DONE | R4 |
| 21 | Executable CLI Runner | `cucm-emulator-mcp` binary with flags, signals, and lifecycle control | M4 | DONE | R5 |
| 22 | Opaque-Box 4-Tier E2E Suite | Tier 1 (Features), Tier 2 (Boundaries), Tier 3 (Cross), Tier 4 (Workload) | M5 | DONE | AC |
| 23 | Build, Typecheck & Packaging | 0 TS errors, 100% Vitest pass, clean `npm pack --dry-run` tarball | M6 | DONE | R5/AC |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|:------:|
| M1 | Foundation & OpenAPI Schema Engine | Setup project, `package.json`, `tsconfig.json`, `src/openapi/`, bundled `contracts/openapi.json`, schema parser, dereferencer, parameter merger, unit tests | none | **DONE** |
| M2 | Client Layer & In-Memory Mock Store | `src/client/` (`ICucmEmulatorClient`, `HttpCucmClient`, `MockCucmClient`, `resolver.ts`), `src/mock/store.ts` (nodes, phones, calls, CURRI, CDRs), client unit tests | M1 | **DONE** |
| M3 | Domain Tools & Dynamic Tool Generator | `src/tools/generator.ts`, `src/tools/registry.ts`, `src/tools/annotations.ts`, all 15 discrete domain tools in `src/tools/domains/`, domain unit tests | M2 | **DONE** |
| M4 | Transports, Server Lifecycle & CLI Runner | `src/transports/` (stdio, sse), `src/server.ts`, `bin/cucm-emulator-mcp.ts`, signal handling, CLI unit & integration tests | M3 | **DONE** |
| M5 | 4-Tier Opaque-Box E2E Testing Suite | `test/e2e/tier1_features.test.ts`, `tier2_boundaries.test.ts`, `tier3_cross_feature.test.ts`, `tier4_real_world.test.ts`, `TEST_INFRA.md`, `TEST_READY.md` | M4 | **DONE** |
| M6 | Hardening, Compilation & Packaging | `npm run build`, `npm run typecheck` (0 errors), 100% Vitest coverage (209 tests), `npm pack --dry-run` tarball verification, README | M5 | **DONE** |

---

## Code Layout
```
/Users/jasonbarbee/teamwork_projects/cucm_emulator_mcp/
├── bin/
│   └── cucm-emulator-mcp.ts          # CLI runner entrypoint
├── contracts/
│   └── openapi.json                  # Bundled OpenAPI 3.1.0 specification
├── src/
│   ├── index.ts                      # Library root exports
│   ├── server.ts                     # CucmEmulatorMcpServer class
│   ├── config.ts                     # Config parsing & CLI options
│   ├── openapi/
│   │   ├── parser.ts                 # Spec parsing & loading
│   │   ├── deref.ts                  # Recursive $ref dereferencing
│   │   ├── schema-builder.ts         # Parameter merging & schema builder
│   │   └── types.ts                  # OpenAPI schema types
│   ├── client/
│   │   ├── interface.ts              # ICucmEmulatorClient interface
│   │   ├── http-client.ts            # Live HTTP client
│   │   ├── mock-client.ts            # Direct in-memory store client
│   │   └── resolver.ts               # Multi-tier endpoint resolver
│   ├── mock/
│   │   ├── store.ts                  # In-memory CUCM state & entity store
│   │   ├── fixtures.ts               # Fixture generator (lab-small, enterprise)
│   │   └── simulator.ts              # Call simulation & CDR engine
│   ├── tools/
│   │   ├── generator.ts              # Dynamic OpenAPI tool compiler
│   │   ├── registry.ts               # Tool registry with list_changed
│   │   ├── annotations.ts            # Tool safety annotations
│   │   └── domains/                  # 6 Core CUCM Domain Implementations
│   │       ├── fixtures.ts           # emu_seed_fixtures, emu_reset_store, emu_inspect_fixtures
│   │       ├── nodes.ts              # emu_list_nodes, emu_set_node_status
│   │       ├── phones.ts             # emu_list_phones, emu_set_phone_status, emu_get_phone_web
│   │       ├── calls.ts              # emu_simulate_call, emu_call_action, emu_list_active_calls
│   │       ├── curri.ts              # emu_evaluate_curri, emu_get_curri_history
│   │       └── cdr.ts                # emu_generate_cdrs, emu_get_cdr_history
│   ├── transports/
│   │   ├── stdio.ts                  # Stdio server transport
│   │   └── sse.ts                    # SSE Express transport
│   └── types/
│       ├── errors.ts                 # Error classes
│       └── domain.ts                 # Domain entity types
├── test/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   └── adversarial/
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.ts
└── README.md
```
