import { cn } from '../lib/utils'

/** A tool name as a button, e.g. to filter steps by that tool. */
export function ToolChip({
	name,
	onSelect,
	className,
}: {
	name: string
	onSelect: (name: string) => void
	className?: string
}) {
	return (
		<button
			type="button"
			onClick={() => onSelect(name)}
			className={cn(
				'inline-flex h-6 items-center rounded-md border bg-raised px-2 font-mono text-text text-xs hover:border-accent',
				className,
			)}
		>
			@{name}
		</button>
	)
}
