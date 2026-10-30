# @stepglass/api

The HTTP API: producers append events to a session, and readers list sessions, read their
events in order, and fetch the tool descriptors and check bundles those events refer to.
Fastify 5, Zod contracts from `@stepglass/schema`, PostgreSQL 18 through Drizzle.

## Run locally

From the repository root:

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm --filter @stepglass/api build
pnpm --filter @stepglass/api db:migrate
node --env-file=.env apps/api/dist/server.js
```

The server listens on `PORT` (default 3000). The OpenAPI document is at
`http://localhost:3000/openapi.json`.

| Variable                  | Default   | Meaning                            |
| ------------------------- | --------- | ---------------------------------- |
| `DATABASE_URL`            | required  | `postgres://…` connection string   |
| `PORT`                    | `3000`    | Listen port                        |
| `HOST`                    | `0.0.0.0` | Listen address                     |
| `LOG_LEVEL`               | `info`    | Pino level, or `silent`            |
| `INGEST_BODY_LIMIT_BYTES` | `4194304` | Largest accepted ingestion request |

Configuration is validated at startup, and every invalid value is listed before the process exits.

## Routes

| Method | Path                                  | Auth           | Purpose                                                                      |
| ------ | ------------------------------------- | -------------- | ---------------------------------------------------------------------------- |
| `POST` | `/v1/sessions`                        | none           | Open a session. The response carries the `sgt_…` token, once.                |
| `GET`  | `/v1/sessions`                        | none           | List sessions, newest first. `?limit=` (1–100), `?cursor=`                   |
| `GET`  | `/v1/sessions/:publicId`              | none           | One session                                                                  |
| `GET`  | `/v1/sessions/:publicId/events`       | none           | Events in seq order. `?after_seq=`, `?limit=` (1–1000)                       |
| `POST` | `/v1/sessions/events`                 | `Bearer sgt_…` | Append a batch of up to 500 events; returns an `EventBatchAck`               |
| `PUT`  | `/v1/tool-descriptors/:name/:version` | none           | Store a descriptor: 201 when created, 200 when identical, 409 when different |
| `GET`  | `/v1/tool-descriptors/:name/:version` | none           | Fetch a descriptor                                                           |
| `PUT`  | `/v1/check-bundles/:id/:version`      | none           | Store a bundle, with the same rules as descriptors                           |
| `GET`  | `/v1/check-bundles/:id/:version`      | none           | Fetch a bundle                                                               |
| `GET`  | `/healthz`                            | none           | 200 when the database answers, 503 otherwise                                 |
| `GET`  | `/openapi.json`                       | none           | OpenAPI 3.1 document                                                         |

Errors are RFC 9457 `application/problem+json`. A machine-readable `code` says what went wrong,
and `errors` lists the failing paths for validation problems.

Read and document routes have no authentication yet. Run the API on a trusted network until
reviewer auth lands.

## Ingestion semantics

- **Idempotent.** The producer's event `id` is the idempotency key. A re-sent event is listed in
  `duplicates` and keeps its original `seq`. The same `id` with a different payload is rejected
  as `conflict`, and the stored payload is kept.
- **Per-event validation.** One invalid event is listed in `rejected` and does not block the
  rest of the batch.
- **Dense, ordered seqs.** The session row is locked, `next_seq` is bumped by the number of new
  events (`UPDATE … RETURNING`), and the new events take that range in batch order, all in one
  transaction. Seqs have no holes, and a higher seq never commits before a lower one.
- **Ack after commit.** A failure rolls back the events and the reserved seqs together.
- **Gaps.** `gaps` lists the open holes in each producer's `seq` (counting from 0) for the
  producers in the batch, so a buffer overflow or lost request shows up as a hole.

## Tokens

The token is `sgt_` followed by 32 bytes from `crypto.randomBytes`, base64url-encoded. Only its
SHA-256 digest is stored. A fast hash is enough because the token has 256 bits of entropy.
Lookups go by digest, the final comparison is constant-time, and the logger redacts
`authorization` headers and `token` fields.

## Migrations

`src/db/schema.ts` is the source of truth. After changing it, run
`pnpm --filter @stepglass/api db:generate` and commit the new SQL file in `drizzle/`.

## Tests

`pnpm --filter @stepglass/api test` runs integration tests against the Postgres in
`DATABASE_URL`, which is read from the repository's `.env` when the variable is unset. Each test
file creates its own migrated database and drops it at the end.
