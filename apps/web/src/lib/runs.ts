import type { CheckResult, Session } from '@stepglass/schema'

/**
 * One row of the runs list: the session plus the roll-up of its latest check results. `checks`
 * is null until any check has been evaluated.
 */
export interface RunSummary {
	session: Session
	/** Sequential per workspace, shown as `run-12`; the public ID stays the stable link. */
	number: number
	checks: CheckResult['outcome'] | null
}

export type RunTone = 'pass' | 'fail' | 'unknown' | 'neutral'

/** What the status dot and label say. Check outcomes win once the run has stopped. */
export function runStatusView(run: RunSummary): { tone: RunTone; label: string } {
	if (run.session.runStatus === 'running') return { tone: 'neutral', label: 'Running' }
	if (run.checks === 'fail') return { tone: 'fail', label: 'Failed' }
	if (run.checks === 'pass') return { tone: 'pass', label: 'Passed' }
	switch (run.session.runStatus) {
		case 'errored':
			return { tone: 'unknown', label: 'Errored' }
		case 'cancelled':
			return { tone: 'unknown', label: 'Cancelled' }
		case 'unfinished':
			return { tone: 'unknown', label: 'Unfinished' }
		default:
			return { tone: 'unknown', label: 'Unknown' }
	}
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "just now", "5m ago", "3h ago", "2d ago", then a short date. */
export function formatRelativeTime(timestamp: string, now: number, locale?: string): string {
	const then = Date.parse(timestamp)
	if (Number.isNaN(then)) return '—'
	const elapsed = Math.max(0, now - then)
	if (elapsed < MINUTE) return 'just now'
	if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`
	if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`
	if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d ago`
	return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(then)
}
