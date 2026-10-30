import { z } from 'zod'
import { JsonObjectSchema, SlugSchema, TimestampSchema, Uuidv7Schema } from './common.js'
import type { ActionStatus } from './event.js'

/**
 * How a snapshot was obtained, strongest first. Only the first two are independent of the tool's
 * own claim, which is why `tool_reported` can never yield a verified label.
 */
export const SnapshotSourceSchema = z.enum(['in_transaction', 'read_back', 'tool_reported'])
/** See {@link SnapshotSourceSchema}. */
export type SnapshotSource = z.infer<typeof SnapshotSourceSchema>

/**
 * The state of one object before or after an action. Before/after pairs, not tool output, are
 * what let Stepglass claim a change actually happened.
 */
export const SnapshotSchema = z.strictObject({
	id: Uuidv7Schema,
	actionId: Uuidv7Schema,
	object: z.strictObject({ type: SlugSchema, id: z.string().min(1).max(256) }),
	phase: z.enum(['before', 'after']),
	state: JsonObjectSchema,
	capturedAt: TimestampSchema,
	source: SnapshotSourceSchema,
	/** Opaque object version (ETag, row version) when the backing store exposes one. */
	version: z.string().min(1).max(256).optional(),
	/** Fields the store derives itself, so a diff doesn't blame the agent for changing them. */
	computedFields: z.array(z.string().min(1)).optional(),
})
/** See {@link SnapshotSchema}. */
export type Snapshot = z.infer<typeof SnapshotSchema>

/** How much a reviewer can trust that an action had the effect shown. */
export const EvidenceLabelSchema = z.enum([
	'verified_in_transaction',
	'verified_read_back',
	'reported',
	'recorded',
	'unknown',
])
/** See {@link EvidenceLabelSchema}. */
export type EvidenceLabel = z.infer<typeof EvidenceLabelSchema>

/** Input to {@link deriveEvidenceLabel}: one action and the snapshots recorded for it. */
export interface EvidenceLabelInput {
	toolKind: 'read' | 'write' | 'other'
	/** Absent when no `action.finished` was recorded. */
	finishedStatus?: ActionStatus
	snapshots: readonly Snapshot[]
	/** Set when concurrent writers mean the change may not be this action's. */
	attributionUncertain?: boolean
}

/** A label plus machine-readable reasons, so the UI can explain a downgrade. */
export interface EvidenceLabelResult {
	label: EvidenceLabel
	reasons: string[]
}

type WriteLabel = 'verified_in_transaction' | 'verified_read_back' | 'reported' | 'unknown'
const STRENGTH: Record<WriteLabel, number> = {
	unknown: 0,
	reported: 1,
	verified_read_back: 2,
	verified_in_transaction: 3,
}

/**
 * Labels one action's evidence. Pure and total, so the API, worker and UI always agree.
 *
 * A write is judged per object and the weakest object decides, because one unverified change
 * makes the whole action unverified. A failed write with a complete pair is still verified: the
 * snapshots show what happened regardless of what the tool returned.
 */
export function deriveEvidenceLabel(input: EvidenceLabelInput): EvidenceLabelResult {
	const { toolKind, finishedStatus, snapshots } = input
	if (finishedStatus === undefined) return { label: 'unknown', reasons: ['not_finished'] }
	if (finishedStatus === 'cancelled') return { label: 'unknown', reasons: ['cancelled'] }
	if (toolKind !== 'write') return { label: 'recorded', reasons: [] }

	const byObject = new Map<string, Snapshot[]>()
	for (const s of snapshots) {
		const key = `${s.object.type}/${s.object.id}`
		byObject.set(key, [...(byObject.get(key) ?? []), s])
	}

	const missingPair: WriteLabel = finishedStatus === 'failed' ? 'unknown' : 'reported'
	if (byObject.size === 0) return { label: missingPair, reasons: ['no_snapshots'] }

	let label: WriteLabel = 'verified_in_transaction'
	const reasons: string[] = []
	for (const [key, group] of byObject) {
		const before = group.filter((s) => s.phase === 'before')
		const after = group.filter((s) => s.phase === 'after')
		const sources = new Set([...before, ...after].map((s) => s.source))
		let objectLabel: WriteLabel
		if (before.length === 0 || after.length === 0) {
			objectLabel = missingPair
			reasons.push(`missing_pair:${key}`)
		} else if (sources.has('tool_reported')) {
			objectLabel = 'reported'
			reasons.push(`tool_reported:${key}`)
		} else if (sources.has('read_back')) {
			objectLabel = 'verified_read_back'
		} else {
			objectLabel = 'verified_in_transaction'
		}
		if (STRENGTH[objectLabel] < STRENGTH[label]) label = objectLabel
	}

	if (input.attributionUncertain && label.startsWith('verified_')) {
		return { label: 'reported', reasons: [...reasons, 'attribution_uncertain'] }
	}
	return { label, reasons }
}
