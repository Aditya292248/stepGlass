# Architecture

Stepglass is split into three layers. Dependencies only point downward: scenarios use connectors,
connectors use the core, and the core knows about neither.

| Layer      | Path                 | Responsibility                                                                                                                                            |
| ---------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core       | `apps/`, `packages/` | Events, evidence, checks, lessons, ingestion, review UI. Domain-agnostic.                                                                                 |
| Connectors | `connectors/`        | Predefined tools for a real system (sandbox backend by default, live backend opt-in), with tool descriptors, verification strategies and check templates. |
| Scenarios  | `scenarios/`         | Seed data, goals, check bundles and recorded fixtures for demos.                                                                                          |

## Data flow

1. A client (Claude, ChatGPT or your own agent) calls a tool through the MCP server or the SDK.
2. The tool is wrapped by `defineTool()`, which records the call and, for writes, captures
   before/after evidence: in the same transaction when Stepglass owns the store, or by reading the
   object back from a third-party API.
3. Events reach the ingestion API, which stores them idempotently and in per-session order.
4. The worker evaluates versioned check definitions (pass / fail / unknown) and writes a summary
   whose claims link to recorded events.
5. The web app shows the run: verdict, what the agent did, evidence, checks, and lessons.

## Domain knowledge is data

The core renders any domain from data supplied by connectors:

- **Tool descriptors** name the affected object, label fields and provide plain-language templates.
- **Check bundles** are versioned JSON using a restricted operator set; no uploaded code runs.
- **Lessons** match on a tool name and argument conditions.

`tooling/boundaries` keeps it that way by failing lint when core code imports a connector or
scenario, or mentions a domain word.

See [ADR 0001](adr/0001-layered-core-connectors-scenarios.md) for the reasoning.
