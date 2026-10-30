import type { ReactNode } from 'react'
import { CommandField } from './command-field'
import { ThemeToggle } from './theme-toggle'

/** `menu` is the drawer trigger shown on narrow screens, where the sidebar is hidden. */
export function TitleBar({ menu }: { menu?: ReactNode }) {
	return (
		<header className="grid h-12 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b px-3 md:grid-cols-[1fr_minmax(0,28rem)_1fr]">
			<div className="flex items-center gap-2">
				{menu}
				<span className="font-semibold text-sm tracking-tight">Stepglass</span>
			</div>
			<CommandField />
			<div className="flex justify-end">
				<ThemeToggle />
			</div>
		</header>
	)
}
