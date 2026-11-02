# @stepglass/toolkit

How a connector defines a recorded, verifiable tool. `defineTool()` wraps a tool so every call
records what the agent asked for, what came back and, for writes, what actually changed. Tool
success is never treated as proof: a write is verified by before/after snapshots taken inside the
same transaction (`in_transaction`) or re-read from the system of record (`read_back`).

The package is transport-free. Hosts (the MCP server, SDKs) supply a `Recorder` and ship its
events; `createMemoryRecorder` keeps them in memory for tests.

## A widget example

```ts
import {
	createMemoryRecorder,
	defineTool,
	defineToolPack,
	descriptor,
	MemoryStore,
} from '@stepglass/toolkit'
import { z } from 'zod'

const store = new MemoryStore({ widget: { 'W-1': { color: 'red', count: 3 } } })

export const setWidgetColor = defineTool({
	name: 'set_widget_color',
	description: 'Set the color of a widget.',
	input: z.object({ id: z.string(), color: z.string(), requestId: z.string().optional() }),
	output: z.object({ id: z.string(), color: z.string() }),
	descriptor: descriptor({
		tool: 'set_widget_color',
		version: 1,
		kind: 'write',
		title: 'Recolored {input.id} from {before.color} to {after.color}',
		object: { type: 'widget', idPath: 'input.id', label: 'Widget {input.id}' },
		fields: {
			'before.color': { label: 'Old color', format: 'text' },
			'after.color': { label: 'New color', format: 'text' },
		},
		verification: 'in_transaction',
		capture: { input: 'full', output: 'full' },
	}),
	async run({ id, color }, { tx }) {
		const current = tx.get('widget', id)
		if (!current) throw new Error(`no widget ${id}`)
		tx.put('widget', id, { ...current.state, color })
		return { id, color }
	},
	transaction: { store, read: (tx, id) => tx.get('widget', id) },
	idempotencyKey: (input) => input.requestId,
})

export const widgets = defineToolPack({
	name: 'widgets',
	version: '1.0.0',
	tools: [setWidgetColor],
})

const recorder = createMemoryRecorder({ sessionId: '0192f0a0-0000-7000-8000-000000000001' })
await setWidgetColor.call({ id: 'W-1', color: 'blue' }, { recorder })
// recorder.events: action.started, evidence.recorded (before), evidence.recorded (after), action.finished
```

Put `run` before the verification hooks: TypeScript infers the output type from `run` in source
order, and `readBack.expect` / `readBack.reported` receive it.

## What a call records

| Event               | When                                                                        |
| ------------------- | --------------------------------------------------------------------------- |
| `action.started`    | Always, with the parsed input (or the raw input if it failed validation)    |
| `evidence.recorded` | For verified writes, one per snapshot, always before `action.finished`      |
| `action.finished`   | `succeeded` with the output, `failed` with `error`, or `cancelled` on abort |

`call` rethrows tool errors after recording them. Invalid input throws `ToolInputError`
(`code: 'invalid_input'`), output that fails the `output` schema throws `ToolOutputError`.

**Capture.** `descriptor.capture.input` / `.output` set to `metadata_only` drop that payload and
mark the event `metadata_only`. Descriptor fields marked `sensitive` (`input.*`, `output.*`,
`before.*`, `after.*`) are removed from the recorded payload or snapshot state and listed in
`capture.omittedFields`, so checks over them answer `unknown`. The caller still gets the full output.

## Verification

The hooks must match `descriptor.verification`, which is checked twice: as a type error when the
descriptor's literal type is known (use `descriptor()`), and with a throw when the tool is defined.
Only writes are verified, and a write's `object.idPath` must be a required field of the input
schema, or of the `output` schema if it points at the output.

### `transaction`: a store the connector owns

```ts
transaction: { store, read: (tx, id) => tx.get('widget', id) }
```

`store` is any `OutboxStore<Tx>`: a `TransactionalStore` (`transaction(fn)`, commit on resolve,
rollback on throw) with a transactional outbox. In one transaction the toolkit reads the object,
runs the tool with `ctx.tx`, reads it again and appends both snapshots
(`source: 'in_transaction'`, with `version`) to the outbox. They are relayed to the recorder only
after commit. A throw, an invalid output or an abort rolls everything back: no change, no evidence,
only a failed or cancelled action. If relaying fails after commit, the entries stay pending;
`relayOutbox(outbox, recorder)` relays them later (at least once).

`MemoryStore` implements this in memory for tests and sandbox backends. Real connectors implement
`OutboxStore` over their own storage; there is no SQL here.

### `readBack`: a system of record you don't own

```ts
readBack: {
	read: (id) => api.getWidget(id), // { state, version? } or null
	expect: (input) => ({ color: input.color }), // fields the re-read must show
	reported: (input, output) => ({ color: output.color }), // optional: the tool's own claim
	attempts: 3,
	retryDelayMs: 200,
}
```

The object is read before `run` and re-read after a successful one (`source: 'read_back'`). The
re-read counts only if it shows every field in `expect` and, when a change was expected, its
version moved. Otherwise no verified pair is recorded: the `reported` claim is kept as a
`tool_reported` snapshot, or the pair stays incomplete. A failed read is not an error; a failed
write is not re-read.

Resulting labels from `deriveEvidenceLabel`:

| Situation                                     | Label                     |
| --------------------------------------------- | ------------------------- |
| In-transaction write committed                | `verified_in_transaction` |
| Read-back confirmed the change                | `verified_read_back`      |
| Read-back never confirmed it, write succeeded | `reported`                |
| Write failed, rolled back or was cancelled    | `unknown`                 |

## Idempotency

`idempotencyKey(input)` names a call's effect. A retry with the same key on the same recorder
(one session) waits for the first call and, if it succeeded, returns its result without running
again. The retry is recorded as its own action whose `action.started.replayOf` names the original,
with no evidence of its own. Failed calls are not remembered, so their retries run.

## Packs

`defineToolPack({ name, version, tools, checks })` checks that tool names are unique, that each
descriptor names its own tool, and that every check bundle parses with `CheckBundleSchema`.
