import { describe, expect, it } from 'vitest'
import { deriveEvidenceLabel, type EvidenceLabelInput, SnapshotSchema } from '../src/index.js'
import { afterW1, beforeW1, id, snap } from './fixtures/widget.js'

const write = (over: Partial<EvidenceLabelInput>) =>
	deriveEvidenceLabel({ toolKind: 'write', finishedStatus: 'succeeded', snapshots: [], ...over })

const readBackAfter = { ...afterW1, source: 'read_back' } as const
const reportedAfter = { ...afterW1, source: 'tool_reported' } as const

describe('snapshot', () => {
	it('round-trips', () => {
		expect(SnapshotSchema.parse(JSON.parse(JSON.stringify(afterW1)))).toEqual(afterW1)
	})

	it('rejects a non-object state', () => {
		expect(SnapshotSchema.safeParse({ ...beforeW1, state: [1] }).success).toBe(false)
	})
})

describe('deriveEvidenceLabel truth table', () => {
	it('no action.finished → unknown', () => {
		expect(write({ finishedStatus: undefined }).label).toBe('unknown')
	})

	it('cancelled → unknown', () => {
		expect(write({ finishedStatus: 'cancelled', snapshots: [beforeW1, afterW1] }).label).toBe(
			'unknown',
		)
	})

	it('finished read or other tool → recorded', () => {
		expect(write({ toolKind: 'read' }).label).toBe('recorded')
		expect(write({ toolKind: 'other', finishedStatus: 'failed' }).label).toBe('recorded')
	})

	it('failed write without a pair → unknown', () => {
		expect(write({ finishedStatus: 'failed', snapshots: [beforeW1] }).label).toBe('unknown')
		expect(write({ finishedStatus: 'failed' }).label).toBe('unknown')
	})

	it('pair, both in_transaction → verified_in_transaction (even if the write failed)', () => {
		expect(write({ snapshots: [beforeW1, afterW1] }).label).toBe('verified_in_transaction')
		expect(write({ finishedStatus: 'failed', snapshots: [beforeW1, afterW1] }).label).toBe(
			'verified_in_transaction',
		)
	})

	it('pair with a read_back side → verified_read_back (weaker source wins)', () => {
		expect(write({ snapshots: [beforeW1, readBackAfter] }).label).toBe('verified_read_back')
	})

	it('succeeded write, pair missing or tool_reported → reported', () => {
		expect(write({ snapshots: [afterW1] }).label).toBe('reported')
		expect(write({}).label).toBe('reported')
		expect(write({ snapshots: [beforeW1, reportedAfter] }).label).toBe('reported')
	})

	it('verified + attributionUncertain → reported', () => {
		expect(write({ snapshots: [beforeW1, afterW1], attributionUncertain: true })).toEqual({
			label: 'reported',
			reasons: ['attribution_uncertain'],
		})
	})

	it('multiple objects: the weakest object decides', () => {
		const w2 = { type: 'widget', id: 'W-2' }
		const w2Before = snap({ id: id(202), object: w2, source: 'read_back' })
		const w2After = snap({ id: id(203), object: w2, phase: 'after', source: 'read_back' })
		expect(write({ snapshots: [beforeW1, afterW1, w2Before, w2After] }).label).toBe(
			'verified_read_back',
		)
		const result = write({ snapshots: [beforeW1, afterW1, w2Before] })
		expect(result).toEqual({ label: 'reported', reasons: ['missing_pair:widget/W-2'] })
	})
})
