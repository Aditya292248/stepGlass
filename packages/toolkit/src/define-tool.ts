import {
	type JsonObject,
	type JsonValue,
	type Slug,
	SlugSchema,
	type ToolDescriptor,
	ToolDescriptorSchema,
} from '@stepglass/schema'
import type { z } from 'zod'
import { type Capture, capturePayload, toJson } from './capture.js'
import type { DefinedTool, Recorder, ToolContext } from './contract.js'
import { computedFieldsOf, jsonEqual, objectIdAt, snapshotDraft } from './evidence.js'
import { type ObjectState, type OutboxEntry, type OutboxStore, relayOutbox } from './store.js'

/** What a tool's `run` receives besides its input. */
export interface RunContext<Tx = undefined> {
	/** The recorded action this run belongs to; use it as `parentActionId` for nested steps. */
	readonly actionId: string
	readonly recorder: Recorder
	readonly signal?: AbortSignal
	/** The open transaction, for tools verified `in_transaction`; write through it. */
	readonly tx: Tx
}

/**
 * Verification for writes to a store the connector owns: the object is read before and after
 * `run` inside the same transaction, and both snapshots go to the outbox in that transaction.
 */
export interface TransactionHooks<Tx> {
	readonly store: OutboxStore<Tx>
	/** Reads the object inside `tx`; `null` when it does not exist. */
	read(tx: Tx, objectId: string): ObjectState | null | Promise<ObjectState | null>
	/** State fields the store derives; defaults to the descriptor's `computed` state fields. */
	readonly computedFields?: readonly string[]
}

/**
 * Verification for writes to a system Stepglass does not own (a third-party API): the object is
 * read before `run` and re-read from the system of record after it. The re-read only counts when
 * it shows the change `expect` names; otherwise no verified pair is recorded.
 */
export interface ReadBackHooks<I, O> {
	/** Reads the object from the system of record; `null` when it does not exist. A throw is a failed read. */
	read(objectId: string, ctx: { signal?: AbortSignal }): Promise<ObjectState | null>
	/** The state fields a successful write must show. An empty object confirms nothing. */
	expect(input: I, output: O): JsonObject
	/** The state the tool's own response claims; recorded as `tool_reported` when the re-read can't confirm the write. */
	reported?(input: I, output: O): JsonObject | undefined
	/** Re-reads for eventually consistent APIs (default 3) and the pause between them (default 200 ms). */
	readonly attempts?: number
	readonly retryDelayMs?: number
	/** State fields the system derives; defaults to the descriptor's `computed` state fields. */
	readonly computedFields?: readonly string[]
}

/** Everything `defineTool` needs to record and run one tool. */
export interface ToolSpec<I, O extends JsonValue, Tx = undefined> {
	readonly name: Slug
	/** Shown to the model. */
	readonly description: string
	readonly input: z.ZodType<I>
	/** Validates what `run` returns; a mismatch is recorded as a failed action. */
	readonly output?: z.ZodType<O>
	readonly descriptor: ToolDescriptor
	readonly transaction?: TransactionHooks<Tx>
	readonly readBack?: ReadBackHooks<I, O>
	run(input: I, ctx: RunContext<Tx>): Promise<O>
}

/** Thrown when a call's input does not match the tool's input schema. */
export class ToolInputError extends Error {
	readonly code = 'invalid_input'
	constructor(readonly issues: z.core.$ZodIssue[]) {
		super(
			`invalid input: ${issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`,
		)
		this.name = 'ToolInputError'
	}
}

/** Thrown when `run` returns something the tool's output schema rejects. */
export class ToolOutputError extends Error {
	readonly code = 'invalid_output'
	constructor(readonly issues: z.core.$ZodIssue[]) {
		super(
			`invalid output: ${issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`,
		)
		this.name = 'ToolOutputError'
	}
}

const MAX_ERROR_MESSAGE = 10_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function describeError(err: unknown): { message: string; code?: string } {
	const message = (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_MESSAGE)
	const code =
		err !== null && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
			? err.code
			: err instanceof Error && err.name !== 'Error'
				? err.name
				: undefined
	return code === undefined ? { message } : { message, code }
}

/**
 * Settles with `promise`, or rejects with the abort reason as soon as `signal` aborts. The tool
 * keeps its own copy of the signal to stop work; the caller stops waiting either way.
 */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
	if (!signal) return promise
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(signal.reason)
		if (signal.aborted) return onAbort()
		signal.addEventListener('abort', onAbort, { once: true })
		promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
	})
}

/** Records a payload as JSON, or as `partial` when it cannot be represented as JSON at all. */
function recordable(
	descriptor: ToolDescriptor,
	root: 'input' | 'output',
	value: unknown,
): { value?: JsonValue; capture: Capture } {
	const json = toJson(value)
	if (json === undefined && value !== undefined) {
		return { capture: { completeness: 'partial', omittedFields: [root] } }
	}
	return capturePayload(descriptor, root, json)
}

/**
 * Defines a recorded tool. Every call emits `action.started` with the (captured, redacted) input
 * and `action.finished` with the output or the error, so the trace shows what the agent asked
 * for and what came back, whether or not the tool succeeded.
 */
export function defineTool<I, O extends JsonValue, Tx = undefined>(
	spec: ToolSpec<I, O, Tx>,
): DefinedTool {
	const name = SlugSchema.parse(spec.name)
	const descriptor = ToolDescriptorSchema.parse(spec.descriptor)
	if (descriptor.tool !== name) {
		throw new Error(`tool "${name}": descriptor is for "${descriptor.tool}"`)
	}

	/** Runs the tool body and validates what it returns. */
	async function invoke(input: I, ctx: RunContext<Tx>): Promise<O> {
		const result = await raceAbort(spec.run(input, ctx), ctx.signal)
		const checked = spec.output?.safeParse(result)
		if (checked && !checked.success) throw new ToolOutputError(checked.error.issues)
		return checked ? checked.data : result
	}

	/**
	 * Runs inside one transaction: snapshot before, run, snapshot after, outbox append. Any
	 * failure, including an abort, rolls all of it back, so there is never a write without its
	 * evidence or evidence for a write that did not commit. Evidence is relayed only after commit.
	 */
	async function inTransaction(
		hooks: TransactionHooks<Tx>,
		input: I,
		base: Omit<RunContext<Tx>, 'tx'>,
	): Promise<O> {
		const { actionId, recorder } = base
		const object = descriptor.object
		const computedFields = computedFieldsOf(descriptor, hooks.computedFields)
		const observe = async (
			tx: Tx,
			phase: 'before' | 'after',
			objectId: string | undefined,
		): Promise<OutboxEntry[]> => {
			const observed = objectId === undefined ? null : await hooks.read(tx, objectId)
			if (!observed || objectId === undefined) return []
			const draft = snapshotDraft(recorder, descriptor, {
				actionId,
				objectId,
				phase,
				observed,
				source: 'in_transaction',
				computedFields,
			})
			return [{ id: recorder.newId(), actionId, draft }]
		}
		const result = await hooks.store.transaction(async (tx) => {
			const inputId = object && objectIdAt(object.idPath, { input })
			const before = await observe(tx, 'before', inputId)
			const out = await invoke(input, { ...base, tx })
			const afterId = inputId ?? (object && objectIdAt(object.idPath, { output: out }))
			const after = await observe(tx, 'after', afterId)
			await hooks.store.outbox.append(tx, [...before, ...after])
			return out
		})
		try {
			await relayOutbox(hooks.store.outbox, recorder, actionId)
		} catch {
			// The write committed; its evidence stays pending for a later relay, and until then the
			// action reads as reported rather than verified.
		}
		return result
	}

	/**
	 * Reads the object before `run` and re-reads it after a successful one. A read that throws,
	 * finds nothing, or never shows the expected change (after all attempts, or with an unchanged
	 * version) yields no `read_back` after snapshot: at most the tool's own claim, marked
	 * `tool_reported`, so the label can never say verified on the tool's word alone. A failed run is
	 * not re-read, so it has no pair and stays `unknown`.
	 */
	async function withReadBack(
		hooks: ReadBackHooks<I, O>,
		input: I,
		base: Omit<RunContext<Tx>, 'tx'>,
	): Promise<O> {
		const { actionId, recorder, signal } = base
		const object = descriptor.object
		const computedFields = computedFieldsOf(descriptor, hooks.computedFields)
		const read = async (id: string) => {
			try {
				return await hooks.read(id, signal ? { signal } : {})
			} catch {
				return null
			}
		}
		const emit = (
			objectId: string,
			phase: 'before' | 'after',
			observed: ObjectState,
			source: 'read_back' | 'tool_reported',
		) =>
			recorder.emit(
				snapshotDraft(recorder, descriptor, {
					actionId,
					objectId,
					phase,
					observed,
					source,
					computedFields,
				}),
			)

		const inputId = object && objectIdAt(object.idPath, { input })
		const before = inputId === undefined ? null : await read(inputId)
		if (inputId !== undefined && before) emit(inputId, 'before', before, 'read_back')

		const out = await invoke(input, { ...base, tx: undefined as Tx })
		const id = inputId ?? (object && objectIdAt(object.idPath, { output: out }))
		if (id === undefined) return out

		const expected = hooks.expect(input, out)
		const shows = (s: ObjectState) => {
			const keys = Object.keys(expected)
			if (keys.length === 0) return false
			if (!keys.every((k) => jsonEqual(s.state[k], expected[k]))) return false
			// An unchanged version means the read is stale, unless no change was expected at all.
			const changeExpected = !before || !keys.every((k) => jsonEqual(before.state[k], expected[k]))
			return !(changeExpected && before?.version !== undefined && before.version === s.version)
		}
		const attempts = Math.max(1, hooks.attempts ?? 3)
		for (let attempt = 1; attempt <= attempts; attempt++) {
			const after = await read(id)
			if (after && shows(after)) {
				emit(id, 'after', after, 'read_back')
				return out
			}
			if (attempt < attempts) await sleep(hooks.retryDelayMs ?? 200)
		}
		const claimed = hooks.reported?.(input, out)
		if (claimed) emit(id, 'after', { state: claimed }, 'tool_reported')
		return out
	}

	const execute = (input: I, base: Omit<RunContext<Tx>, 'tx'>): Promise<O> => {
		if (spec.transaction) return inTransaction(spec.transaction, input, base)
		if (spec.readBack) return withReadBack(spec.readBack, input, base)
		return invoke(input, { ...base, tx: undefined as Tx })
	}

	async function call(rawInput: unknown, ctx: ToolContext): Promise<JsonValue> {
		const { recorder, signal } = ctx
		signal?.throwIfAborted()
		const actionId = recorder.newId()
		const parsed = spec.input.safeParse(rawInput)
		const started = recordable(descriptor, 'input', parsed.success ? parsed.data : rawInput)
		recorder.emit({
			type: 'action.started',
			actionId,
			kind: 'tool',
			tool: { name, descriptorVersion: descriptor.version },
			...(started.value === undefined ? {} : { input: started.value }),
			capture: started.capture,
		})

		let output: JsonValue
		try {
			if (!parsed.success) throw new ToolInputError(parsed.error.issues)
			const base = signal ? { actionId, recorder, signal } : { actionId, recorder }
			output = toJson(await execute(parsed.data, base)) ?? null
		} catch (err) {
			const cancelled = signal?.aborted === true
			recorder.emit({
				type: 'action.finished',
				actionId,
				status: cancelled ? 'cancelled' : 'failed',
				...(cancelled ? {} : { error: describeError(err) }),
				capture: { completeness: 'full' },
			})
			throw err
		}

		const finished = recordable(descriptor, 'output', output)
		recorder.emit({
			type: 'action.finished',
			actionId,
			status: 'succeeded',
			...(finished.value === undefined ? {} : { output: finished.value }),
			capture: finished.capture,
		})
		return output
	}

	return Object.freeze({ name, description: spec.description, input: spec.input, descriptor, call })
}
