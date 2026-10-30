import {
	type CheckBundle,
	CheckBundleSchema,
	type CheckResult,
	type TraceEvent,
	TraceEventSchema,
} from '@stepglass/schema'
import { type CheckInspection, inspectCheck } from './check.js'
import { indexTrace } from './trace.js'

/**
 * Evaluates every check in a bundle over one session's events, in bundle order. Inputs are
 * validated first, since bundles and events both arrive from outside; every result is validated
 * against `CheckResultSchema` before it is returned.
 */
export function evaluateBundle(bundle: CheckBundle, events: readonly TraceEvent[]): CheckResult[] {
	return inspectBundle(bundle, events).map((i) => i.result)
}

/** {@link evaluateBundle}, keeping each check's structured detail. */
export function inspectBundle(
	bundle: CheckBundle,
	events: readonly TraceEvent[],
): CheckInspection[] {
	const parsed = CheckBundleSchema.parse(bundle)
	const trace = indexTrace(events.map((e) => TraceEventSchema.parse(e)))
	return parsed.checks.map((def) => inspectCheck(def, trace))
}
