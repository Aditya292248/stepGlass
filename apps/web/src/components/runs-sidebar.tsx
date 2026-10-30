import { Link } from '@tanstack/react-router'
import { type KeyboardEvent, useRef, useState } from 'react'
import { formatRelativeTime, type RunSummary, type RunTone, runStatusView } from '../lib/runs'
import { cn } from '../lib/utils'

const DOT: Record<RunTone, string> = {
	pass: 'bg-pass',
	fail: 'bg-fail',
	unknown: 'bg-unknown',
	neutral: 'bg-muted/60 ring-2 ring-muted/30',
}

export interface RunsSidebarProps {
	runs: RunSummary[]
	selectedId?: string
	/** Injectable so relative times are deterministic in tests. */
	now?: number
}

/**
 * The RUNS list. One tab stop for the whole list (roving tabindex): Tab lands on the selected
 * run, arrow keys and Home/End move between runs, Enter opens one.
 */
export function RunsSidebar({ runs, selectedId, now = Date.now() }: RunsSidebarProps) {
	const selectedIndex = runs.findIndex((r) => r.session.publicId === selectedId)
	const [focusIndex, setFocusIndex] = useState(Math.max(0, selectedIndex))
	const rowRefs = useRef<(HTMLAnchorElement | null)[]>([])
	const activeIndex = Math.min(focusIndex, runs.length - 1)
	const footerClient = (runs[selectedIndex] ?? runs[0])?.session.client.name

	const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
		const last = runs.length - 1
		const target = {
			ArrowDown: Math.min(activeIndex + 1, last),
			ArrowUp: Math.max(activeIndex - 1, 0),
			Home: 0,
			End: last,
		}[event.key]
		if (target === undefined) return
		event.preventDefault()
		setFocusIndex(target)
		rowRefs.current[target]?.focus()
	}

	return (
		<nav aria-labelledby="runs-heading" className="flex min-h-0 flex-1 flex-col">
			<h2
				id="runs-heading"
				className="px-4 pt-4 pb-2 font-semibold text-[11px] text-muted uppercase tracking-[0.08em]"
			>
				Runs
			</h2>
			{runs.length === 0 ? (
				<div className="mx-3 rounded-lg border border-dashed p-4 text-center text-xs">
					<p className="font-medium text-text">No runs yet</p>
					<p className="mt-1 text-muted">Runs show up here as soon as an agent records one.</p>
				</div>
			) : (
				<ul
					className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2"
					onKeyDown={onKeyDown}
				>
					{runs.map((run, index) => {
						const { tone, label } = runStatusView(run)
						const selected = index === selectedIndex
						return (
							<li key={run.session.id}>
								<Link
									ref={(el) => {
										rowRefs.current[index] = el
									}}
									to="/runs/$publicId"
									params={{ publicId: run.session.publicId }}
									tabIndex={index === activeIndex ? 0 : -1}
									aria-current={selected ? 'page' : undefined}
									title={run.session.goal}
									onFocus={() => setFocusIndex(index)}
									className={cn(
										'flex items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-sm',
										selected
											? 'border-border bg-raised text-text shadow-sm'
											: 'text-muted hover:bg-raised/60 hover:text-text',
									)}
								>
									<span
										aria-hidden="true"
										className={cn('size-2 shrink-0 rounded-full', DOT[tone])}
									/>
									<span className="min-w-0 flex-1 truncate">
										<span className="font-mono">run-{run.number}</span> · {label}
									</span>
									<time
										dateTime={run.session.startedAt}
										className="shrink-0 font-mono text-[11px] text-muted"
									>
										{formatRelativeTime(run.session.startedAt, now)}
									</time>
								</Link>
							</li>
						)
					})}
				</ul>
			)}
			{footerClient && (
				<p className="mt-auto border-t px-4 py-3 text-muted text-xs">
					Recorded from <span className="font-mono text-text">{footerClient}</span>
				</p>
			)}
		</nav>
	)
}
