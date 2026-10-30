import type { CaptureSchema, JsonValue, ToolDescriptor } from '@stepglass/schema'
import type { z } from 'zod'

export type Capture = z.infer<typeof CaptureSchema>
/** The roots of a descriptor field path that a recorded event can carry. */
export type PayloadRoot = 'input' | 'output' | 'before' | 'after'

/**
 * Normalizes a value to plain JSON (drops `undefined` members, turns dates into strings) so a
 * recorded payload always parses as `JsonValue`. Returns `undefined` for values JSON cannot hold.
 */
export function toJson(value: unknown): JsonValue | undefined {
	if (value === undefined) return undefined
	try {
		const text = JSON.stringify(value)
		return text === undefined ? undefined : (JSON.parse(text) as JsonValue)
	} catch {
		return undefined
	}
}

const isObject = (v: JsonValue | undefined): v is { [k: string]: JsonValue } =>
	v !== null && typeof v === 'object' && !Array.isArray(v)

/** Removes `path` (keys below the root) from a JSON value in place; true if something was removed. */
function removePath(value: JsonValue, path: readonly string[]): boolean {
	const [head, ...rest] = path
	if (head === undefined || !isObject(value) || !Object.hasOwn(value, head)) return false
	if (rest.length > 0) {
		const child = value[head]
		return child !== undefined && removePath(child, rest)
	}
	delete value[head]
	return true
}

/**
 * Applies a descriptor's capture policy to one payload before it is emitted: `metadata_only`
 * drops the whole input or output, and every field marked `sensitive` under `root` is removed.
 * Whatever was dropped is named in `omittedFields`, so checks over it answer `unknown`.
 */
export function capturePayload<T extends JsonValue>(
	descriptor: ToolDescriptor,
	root: PayloadRoot,
	value: T | undefined,
): { value?: T; capture: Capture } {
	if (value === undefined) return { capture: { completeness: 'full' } }
	if ((root === 'input' || root === 'output') && descriptor.capture[root] === 'metadata_only') {
		return { capture: { completeness: 'metadata_only', omittedFields: [root] } }
	}
	const sensitive = Object.entries(descriptor.fields)
		.filter(([path, spec]) => spec.sensitive && path.startsWith(`${root}.`))
		.map(([path]) => path)
	if (sensitive.length === 0) return { value, capture: { completeness: 'full' } }
	const copy = structuredClone(value)
	const omittedFields = sensitive.filter((path) => removePath(copy, path.split('.').slice(1)))
	if (omittedFields.length === 0) return { value, capture: { completeness: 'full' } }
	return { value: copy, capture: { completeness: 'redacted', omittedFields } }
}
