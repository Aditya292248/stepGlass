import type { CheckResult, JsonValue } from '@stepglass/schema'
import { type Truth, UNKNOWN, type Unknown } from './logic.js'

/** One machine-readable explanation, shaped exactly like a {@link CheckResult} reason. */
export type Reason = CheckResult['reasons'][number]
/** The gauge numbers of a measured comparison. */
export type Measurement = NonNullable<CheckResult['measurement']>
/** A JSON value read from evidence, or {@link UNKNOWN} when the evidence does not say. */
export type Value = JsonValue | Unknown

/**
 * A step a sequence rule expected but the recording does not contain, so the UI can draw an
 * "Expected, not recorded" row in the timeline next to the action that needed it.
 */
export interface ExpectedStep {
	/** The expected action, as selected: its tool, or its kind when no tool was named. */
	readonly tool?: string
	readonly kind?: 'tool' | 'model'
	/** The action that should have been preceded by it. */
	readonly before: { readonly actionId: string; readonly tool?: string; readonly eventId: string }
}

/** What every expression evaluates to: a value plus the evidence it rests on. */
export interface Res {
	readonly value: Value
	/** Events the value relied on; a pass cites these. */
	readonly eventIds: readonly string[]
	/** Why the value is unknown or false, carried up to the result's reasons. */
	readonly reasons: readonly Reason[]
	/**
	 * Evidence the value read that is weaker than verified (the tool's own report, or a write
	 * whose outcome was never observed). It can still decide a fail, never a pass.
	 */
	readonly unverified: readonly Reason[]
	/** Expected steps that were not recorded; see {@link ExpectedStep}. */
	readonly expected: readonly ExpectedStep[]
	/** Per-element results for a list built from evidence, so quantifiers cite each element. */
	readonly items?: readonly Res[]
	/** The list is known to be incomplete: absent elements may exist that were not recorded. */
	readonly partial?: boolean
	/** The first measured comparison under this node, for the UI gauge. */
	readonly measurement?: Measurement
}

/** Optional fields set on a new {@link Res} beyond what it inherits from its parts. */
export interface ResExtra {
	eventIds?: readonly string[]
	reasons?: readonly Reason[]
	unverified?: readonly Reason[]
	expected?: readonly ExpectedStep[]
	items?: readonly Res[]
	partial?: boolean
	measurement?: Measurement
}

/** Builds a result that inherits the evidence and explanations of the parts it was derived from. */
export function res(value: Value, parts: readonly Res[] = [], extra: ResExtra = {}): Res {
	const measurement = extra.measurement ?? parts.find((p) => p.measurement)?.measurement
	return {
		value,
		eventIds: dedupe([...parts.flatMap((p) => p.eventIds), ...(extra.eventIds ?? [])]),
		reasons: [...parts.flatMap((p) => p.reasons), ...(extra.reasons ?? [])],
		unverified: [...parts.flatMap((p) => p.unverified), ...(extra.unverified ?? [])],
		expected: [...parts.flatMap((p) => p.expected), ...(extra.expected ?? [])],
		...(extra.items ? { items: extra.items } : {}),
		...(extra.partial ? { partial: true } : {}),
		...(measurement ? { measurement } : {}),
	}
}

/** An unknown result with one new reason; the reason cites whatever the parts relied on. */
export function unknownRes(code: string, message: string, parts: readonly Res[] = []): Res {
	const eventIds = dedupe(parts.flatMap((p) => p.eventIds))
	return res(UNKNOWN, parts, { reasons: [{ code, message, eventIds }] })
}

/** Reads a result as a truth value; a known non-boolean is a type error, so it is unknown. */
export function truthOf(r: Res): { truth: Truth; res: Res } {
	if (r.value === UNKNOWN || typeof r.value === 'boolean') return { truth: r.value, res: r }
	return {
		truth: UNKNOWN,
		res: unknownRes('type_mismatch', `Expected true or false, got ${describe(r.value)}.`, [r]),
	}
}

export function dedupe(ids: readonly string[]): string[] {
	return [...new Set(ids)]
}

/** Structural JSON equality; object key order does not matter. */
export function jsonEqual(a: JsonValue, b: JsonValue): boolean {
	if (a === b) return true
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
		return a.every((x, i) => {
			const y = b[i]
			return y !== undefined && jsonEqual(x, y)
		})
	}
	if (isObject(a) && isObject(b)) {
		const keys = Object.keys(a)
		if (keys.length !== Object.keys(b).length) return false
		return keys.every((k) => {
			const x = a[k]
			const y = b[k]
			return x !== undefined && y !== undefined && jsonEqual(x, y)
		})
	}
	return false
}

/** Follows a field path; a segment that does not exist yields {@link UNKNOWN}, never `null`. */
export function getPath(v: JsonValue, path: readonly string[]): Value {
	let cur: JsonValue = v
	for (const key of path) {
		let next: JsonValue | undefined
		if (Array.isArray(cur)) next = /^(0|[1-9]\d*)$/.test(key) ? cur[Number(key)] : undefined
		else if (isObject(cur) && Object.hasOwn(cur, key)) next = cur[key]
		if (next === undefined) return UNKNOWN
		cur = next
	}
	return cur
}

export function isObject(v: JsonValue): v is { [key: string]: JsonValue } {
	return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export function isSafeInt(v: Value): v is number {
	return typeof v === 'number' && Number.isSafeInteger(v)
}

/** A short, bounded rendering of a value for reason messages. */
export function describe(v: Value): string {
	if (v === UNKNOWN) return 'unknown'
	const s = JSON.stringify(v)
	return s.length > 80 ? `${s.slice(0, 77)}...` : s
}
