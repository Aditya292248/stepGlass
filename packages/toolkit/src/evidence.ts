import type { JsonObject, JsonValue, SnapshotSource, ToolDescriptor } from '@stepglass/schema'
import { capturePayload } from './capture.js'
import type { EventDraft, Recorder } from './contract.js'
import type { ObjectState } from './store.js'

/**
 * Resolves `descriptor.object.idPath` against a call's input or output. Only strings and
 * integers identify an object; anything else means the call named no object.
 */
export function objectIdAt(idPath: string, payloads: { input?: unknown; output?: unknown }) {
	const [root, ...path] = idPath.split('.')
	let value: unknown =
		root === 'input' ? payloads.input : root === 'output' ? payloads.output : undefined
	for (const key of path) {
		if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined
		value = (value as Record<string, unknown>)[key]
	}
	if (typeof value === 'string' && value.length > 0) return value
	if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
	return undefined
}

/** Structural JSON equality; object key order does not matter. */
export function jsonEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
	if (a === b) return true
	if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
		return a.every((v, i) => jsonEqual(v, b[i]))
	}
	const keys = Object.keys(a)
	if (keys.length !== Object.keys(b).length) return false
	return keys.every((k) => Object.hasOwn(b, k) && jsonEqual(a[k], b[k]))
}

/**
 * State fields the store derives itself: the hook's list when given, otherwise every `before.*`
 * or `after.*` field the descriptor marks `computed`.
 */
export function computedFieldsOf(
	descriptor: ToolDescriptor,
	override?: readonly string[],
): string[] {
	if (override) return [...override]
	const fields = Object.entries(descriptor.fields)
		.filter(([path, spec]) => spec.computed && /^(before|after)\./.test(path))
		.map(([path]) => path.slice(path.indexOf('.') + 1))
	return [...new Set(fields)]
}

/** Builds the `evidence.recorded` draft for one observed state, with sensitive fields removed. */
export function snapshotDraft(
	recorder: Recorder,
	descriptor: ToolDescriptor,
	opts: {
		actionId: string
		objectId: string
		phase: 'before' | 'after'
		observed: ObjectState
		source: SnapshotSource
		computedFields: readonly string[]
	},
): EventDraft {
	const object = descriptor.object
	if (!object) throw new Error(`tool "${descriptor.tool}": snapshots need descriptor.object`)
	const { value, capture } = capturePayload<JsonObject>(descriptor, opts.phase, opts.observed.state)
	return {
		type: 'evidence.recorded',
		snapshot: {
			id: recorder.newId(),
			actionId: opts.actionId,
			object: { type: object.type, id: opts.objectId },
			phase: opts.phase,
			state: value ?? {},
			capturedAt: recorder.now(),
			source: opts.source,
			...(opts.observed.version === undefined ? {} : { version: opts.observed.version }),
			...(opts.computedFields.length > 0 ? { computedFields: [...opts.computedFields] } : {}),
		},
		capture,
	}
}
