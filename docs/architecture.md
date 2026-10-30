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

## Data model: sessions, actions, events

A run is recorded as three nested levels:

```
Session   one agent run toward one goal
 └─ Action   one step the agent took (a tool call or a model call)
     └─ Event   one thing that happened, appended to the session's log
```

- **Session**: the whole run. It holds the goal, the client that recorded it, the run status
  (`running` until a `session.finished` event), the coverage, and whether the data is `sandbox`
  or `live`. It has three identifiers:

  | ID        | Form                     | Seen by                                  | Purpose                                                    |
  | --------- | ------------------------ | ---------------------------------------- | ---------------------------------------------------------- |
  | Row ID    | UUIDv7                   | producers, database                      | Primary key; every event carries it as `sessionId`         |
  | Public ID | `ses_` + 16 base36 chars | everyone                                 | Links and read routes; grants no access                    |
  | Token     | `sgt_` + 256 random bits | the client that opened the session, once | Bearer secret to append events; only its SHA-256 is stored |

- **Action**: one step. It is not stored as a row of its own; it is the group of events that share
  an `actionId`. `parentActionId` nests sub-steps.
- **Event**: the unit of the append-only log. Nothing is updated in place; an outcome is a new
  event. Each event has a client-generated UUIDv7 `id` (the idempotency key), a per-producer
  `producer.seq`, and, once stored, a server-assigned `seq` that is dense and ordered within the
  session.

Event types:

| Type                | Belongs to | Records                                                                       |
| ------------------- | ---------- | ----------------------------------------------------------------------------- |
| `session.started`   | session    | The goal, client and agent                                                    |
| `action.started`    | action     | A step began: tool name (or model) and input                                  |
| `evidence.recorded` | action     | A `before` or `after` snapshot of an object the step changed                  |
| `action.finished`   | action     | The step ended: `succeeded`, `failed` or `cancelled`, with output or error    |
| `lesson.delivered`  | action     | The exact lesson text the agent saw for this step                             |
| `recording.gap`     | session    | A range of producer seqs known to be lost, so checks over it answer `unknown` |
| `session.finished`  | session    | The run's final status and reply                                              |

A read step produces two events (started, finished). A write step usually produces four:

```
seq 4  action.started      actionId=A7  widget_update {id: W-1, color: blue}
seq 5  evidence.recorded   actionId=A7  W-1 before: {color: red}
seq 6  evidence.recorded   actionId=A7  W-1 after:  {color: blue}
seq 7  action.finished     actionId=A7  succeeded
```

How far a reviewer can trust a write is its **evidence label**, derived from its snapshots:
`verified_in_transaction`, `verified_read_back`, `reported` (the tool said so), `recorded`, or
`unknown`.

## Packages

| Package                         | Path                 | What it does                                                                                                                                         |
| ------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@stepglass/schema`             | `packages/schema`    | Zod contracts shared by every package: sessions, events, ingestion batches and acks, evidence, tool descriptors, checks, lessons; JSON Schema export |
| `@stepglass/checks`             | `packages/checks`    | Pure, deterministic check engine over a session's events                                                                                             |
| `@stepglass/api`                | `apps/api`           | Ingestion and session API on Fastify and PostgreSQL                                                                                                  |
| `@stepglass/tooling-boundaries` | `tooling/boundaries` | Lint rule that keeps the core domain-agnostic                                                                                                        |

### Ingestion (`apps/api`)

Producers open a session with `POST /v1/sessions` and append batches of up to 500 events with
`POST /v1/sessions/events` and the session's token. Per batch, in one transaction:

1. Lock the session row, which serializes ingestion per session.
2. Split the batch by event `id`. A re-send with the same payload is a `duplicate` and keeps its
   original `seq`. The same `id` with a different payload is a `conflict`, and the stored payload
   wins.
3. Bump `sessions.next_seq` by the number of new events (`UPDATE … RETURNING`) and give the new
   events that range in batch order.

Seqs therefore have no holes and commit in order. The ack (`accepted`, `duplicates`, `rejected`,
`gaps`) is sent only after commit. `gaps` lists open holes in each producer's `seq`. Each event is
validated on its own, so one bad event does not block the batch. Readers page through
`GET /v1/sessions/:publicId/events?after_seq=` in seq order. Tool descriptors and check bundles are
write-once per `(name, version)`. See [apps/api/README.md](../apps/api/README.md) for the full route
table.

### Checks (`packages/checks`)

`evaluateBundle(bundle, events)` returns one `CheckResult` per check: `pass`, `fail` or `unknown`.
The engine is pure: no I/O, no clock, no model calls, and the same input gives the same output.

- **Three-valued logic.** Kleene's strong logic; `unknown` is never coerced to a pass.
- **Missing data is unknown.** Missing fields, redacted payloads, absent snapshots and type
  mismatches yield `unknown` with a reason.
- **Incomplete recordings.** A recording with a gap, or without a start and finish, still lets a
  found violation fail. Claims about every action or about absence answer `unknown`.
- **Passes need evidence.** A pass cites at least one event. A pass that reads object state needs a
  verified evidence label; weaker evidence can only decide a fail.
- **Ordering** compares action intervals (happens-before), never arrival order. It uses `seq`
  within one producer and timestamps across producers.

## Domain knowledge is data

The core renders any domain from data supplied by connectors:

- **Tool descriptors** name the affected object, label fields and provide plain-language templates.
- **Check bundles** are versioned JSON using a restricted operator set; no uploaded code runs.
- **Lessons** match on a tool name and argument conditions.

`tooling/boundaries` keeps it that way by failing lint when core code imports a connector or
scenario, or mentions a domain word.

See [ADR 0001](adr/0001-layered-core-connectors-scenarios.md) for the reasoning.
