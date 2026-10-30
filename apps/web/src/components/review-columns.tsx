import type { ReactNode } from 'react'
import { cn } from '../lib/utils'

export function ColumnSection({
	title,
	className,
	children,
}: {
	title: string
	className?: string
	children?: ReactNode
}) {
	const id = `section-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`
	return (
		<section aria-labelledby={id} className={cn('flex flex-col gap-3 p-4', className)}>
			<h2 id={id} className="font-semibold text-[11px] text-muted uppercase tracking-[0.08em]">
				{title}
			</h2>
			{children ?? (
				<div className="flex min-h-24 flex-1 items-center justify-center rounded-lg border border-dashed text-muted text-xs">
					Nothing here yet
				</div>
			)}
		</section>
	)
}

/**
 * The review body: what the agent did in the centre, why and which checks ran on the right.
 * Stacks into one column below `lg`.
 */
export function ReviewColumns({ header, center }: { header?: ReactNode; center?: ReactNode }) {
	return (
		<div className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_20rem]">
			<div className="flex min-w-0 flex-col">
				{header}
				<ColumnSection title="What the agent did" className="flex-1">
					{center}
				</ColumnSection>
			</div>
			<div className="flex flex-col border-t lg:border-t-0 lg:border-l">
				<ColumnSection title="Why" />
				<ColumnSection title="Checks" className="border-t" />
			</div>
		</div>
	)
}
