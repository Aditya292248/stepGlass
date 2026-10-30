// Sample runs in a neutral domain (agents editing widgets), shaped like the API's read model so
// swapping in real data later changes the source, not the components.
import type { ClientInfo, Session } from '@stepglass/schema'
import type { RunSummary } from '../lib/runs'

const client: ClientInfo = { name: 'demo-client', version: '0.1.0', transport: 'stdio' }

/** Deterministic UUIDv7s so fixtures parse with the real schema. */
const uuid = (n: number) => `0192f0a0-0000-7000-8000-${n.toString(16).padStart(12, '0')}`
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

function session(n: number, over: Partial<Session> & Pick<Session, 'goal' | 'runStatus'>): Session {
	const startedAt = over.startedAt ?? minutesAgo(n * 7)
	return {
		schemaVersion: 1,
		id: uuid(n),
		publicId: `ses_demo${String(n).padStart(4, '0')}`,
		client,
		agent: 'widget-agent',
		startedAt,
		coverage: 'tool_activity',
		dataLabel: 'sandbox',
		...over,
	}
}

export const runsFixture: RunSummary[] = [
	{
		number: 14,
		checks: null,
		session: session(14, {
			goal: 'Recolor every widget in group G-2',
			runStatus: 'running',
			startedAt: minutesAgo(1),
		}),
	},
	{
		number: 13,
		checks: 'pass',
		session: session(13, {
			goal: 'Rename widget W-7',
			runStatus: 'finished',
			startedAt: minutesAgo(12),
		}),
	},
	{
		number: 12,
		checks: 'fail',
		session: session(12, {
			goal: 'Archive widgets unused for 30 days',
			runStatus: 'finished',
			startedAt: minutesAgo(34),
		}),
	},
	{
		number: 11,
		checks: 'pass',
		session: session(11, {
			goal: 'Recolor widget W-1',
			runStatus: 'finished',
			startedAt: minutesAgo(3 * 60),
		}),
	},
	{
		number: 10,
		checks: 'unknown',
		session: session(10, {
			goal: 'Merge duplicate widgets W-3 and W-4',
			runStatus: 'errored',
			startedAt: minutesAgo(26 * 60),
		}),
	},
]
