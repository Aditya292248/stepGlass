import { useState } from 'react'
import { applyTheme, readStoredTheme, storeTheme, systemTheme, type Theme } from '../lib/theme'
import { cn } from '../lib/utils'

/** Flips between dark and light and remembers the choice. */
export function ThemeToggle({ className }: { className?: string }) {
	const [theme, setTheme] = useState<Theme>(() => readStoredTheme() ?? systemTheme())
	const next: Theme = theme === 'dark' ? 'light' : 'dark'

	return (
		<button
			type="button"
			className={cn(
				'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-muted text-xs hover:text-text',
				className,
			)}
			aria-label={`Switch to ${next} theme`}
			onClick={() => {
				storeTheme(next)
				applyTheme(next)
				setTheme(next)
			}}
		>
			<span aria-hidden="true">{theme === 'dark' ? '☾' : '☀'}</span>
			<span className="hidden sm:inline">{theme === 'dark' ? 'Dark' : 'Light'}</span>
		</button>
	)
}
