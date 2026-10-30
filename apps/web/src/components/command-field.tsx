import { useEffect, useRef } from 'react'
import { cn } from '../lib/utils'

/** Ctrl+K everywhere, Cmd+K on Apple keyboards; both are accepted so either habit works. */
export function isCommandShortcut(event: KeyboardEvent): boolean {
	return (
		(event.ctrlKey || event.metaKey) &&
		!event.altKey &&
		!event.shiftKey &&
		event.key.toLowerCase() === 'k'
	)
}

function isApplePlatform(): boolean {
	return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
}

/**
 * The "jump to" field in the title bar. For now it only renders and takes focus; the command
 * palette behind it comes later.
 */
export function CommandField({ className }: { className?: string }) {
	const inputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!isCommandShortcut(event)) return
			event.preventDefault()
			inputRef.current?.focus()
			inputRef.current?.select()
		}
		document.addEventListener('keydown', onKeyDown)
		return () => document.removeEventListener('keydown', onKeyDown)
	}, [])

	const shortcut = isApplePlatform() ? '⌘ K' : 'Ctrl K'

	return (
		<label
			className={cn(
				'flex h-8 w-full items-center gap-2 rounded-md border bg-raised px-2.5 text-sm focus-within:border-accent',
				className,
			)}
		>
			<span aria-hidden="true" className="text-muted">
				⌕
			</span>
			<input
				ref={inputRef}
				type="text"
				aria-label="Jump to a step or command"
				aria-keyshortcuts="Control+K Meta+K"
				placeholder="Jump to a step or command"
				autoComplete="off"
				spellCheck={false}
				className="min-w-0 flex-1 bg-transparent text-text placeholder:text-muted focus:outline-none"
				onKeyDown={(event) => {
					if (event.key === 'Escape') event.currentTarget.blur()
				}}
			/>
			<kbd className="hidden shrink-0 rounded border px-1.5 font-mono text-[11px] text-muted sm:inline">
				{shortcut}
			</kbd>
		</label>
	)
}
