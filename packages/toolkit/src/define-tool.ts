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

/** What a tool's `run` receives besides its input. */
export interface RunContext {
	/** The recorded action this run belongs to; use it as `parentActionId` for nested steps. */
	readonly actionId: string
	readonly recorder: Recorder
	readonly signal?: AbortSignal
}

/** Everything `defineTool` needs to record and run one tool. */
export interface ToolSpec<I, O extends JsonValue> {
	readonly name: Slug
	/** Shown to the model. */
	readonly description: string
	readonly input: z.ZodType<I>
	/** Validates what `run` returns; a mismatch is recorded as a failed action. */
	readonly output?: z.ZodType<O>
	readonly descriptor: ToolDescriptor
	run(input: I, ctx: RunContext): Promise<O>
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
export function defineTool<I, O extends JsonValue>(spec: ToolSpec<I, O>): DefinedTool {
	const name = SlugSchema.parse(spec.name)
	const descriptor = ToolDescriptorSchema.parse(spec.descriptor)
	if (descriptor.tool !== name) {
		throw new Error(`tool "${name}": descriptor is for "${descriptor.tool}"`)
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
			const result = await raceAbort(spec.run(parsed.data, { actionId, recorder, signal }), signal)
			const checked = spec.output?.safeParse(result)
			if (checked && !checked.success) throw new ToolOutputError(checked.error.issues)
			output = toJson(checked ? checked.data : result) ?? null
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
