import {
	type JsonValue,
	type Slug,
	SlugSchema,
	type ToolDescriptor,
	ToolDescriptorSchema,
} from '@stepglass/schema'
import type { z } from 'zod'
import { type Capture, capturePayload, toJson } from './capture.js'
import type { DefinedTool, Recorder, ToolContext } from './contract.js'
import { computedFieldsOf, objectIdAt, snapshotDraft } from './evidence.js'
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

	const execute = (input: I, base: Omit<RunContext<Tx>, 'tx'>): Promise<O> =>
		spec.transaction
			? inTransaction(spec.transaction, input, base)
			: invoke(input, { ...base, tx: undefined as Tx })

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
