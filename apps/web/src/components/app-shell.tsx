import { useRouterState } from '@tanstack/react-router'
import { type ReactNode, useEffect, useState } from 'react'
import { StatusBar, type StatusBarProps } from './status-bar'
import { TitleBar } from './title-bar'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from './ui/sheet'

export interface AppShellProps {
	sidebar: ReactNode
	status: StatusBarProps
	children: ReactNode
}

/**
 * Title bar, sidebar, content and status bar. From `md` up the sidebar is a fixed column; below
 * that it moves into a drawer that closes again whenever the route changes.
 */
export function AppShell({ sidebar, status, children }: AppShellProps) {
	const [drawerOpen, setDrawerOpen] = useState(false)
	const pathname = useRouterState({ select: (s) => s.location.pathname })

	// biome-ignore lint/correctness/useExhaustiveDependencies: closing is the reaction to navigation
	useEffect(() => setDrawerOpen(false), [pathname])

	return (
		<div className="flex h-dvh flex-col">
			<Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
				<TitleBar
					menu={
						<SheetTrigger
							className="inline-flex size-8 items-center justify-center rounded-md border text-muted hover:text-text md:hidden"
							aria-label="Open runs"
						>
							<span aria-hidden="true">☰</span>
						</SheetTrigger>
					}
				/>
				<SheetContent
					onOpenAutoFocus={(event) => {
						// Land on the list's tab stop (the selected run) so arrow keys work at once.
						const row =
							event.currentTarget instanceof HTMLElement
								? event.currentTarget.querySelector<HTMLElement>('a[tabindex="0"]')
								: null
						if (!row) return
						event.preventDefault()
						row.focus()
					}}
				>
					<SheetTitle>Runs</SheetTitle>
					<SheetDescription>Pick a run to review.</SheetDescription>
					{sidebar}
				</SheetContent>
			</Sheet>
			<div className="grid min-h-0 flex-1 md:grid-cols-[16rem_minmax(0,1fr)]">
				<aside className="hidden min-h-0 border-r md:flex md:flex-col">{sidebar}</aside>
				<main className="min-h-0 overflow-y-auto">{children}</main>
			</div>
			<StatusBar {...status} />
		</div>
	)
}
