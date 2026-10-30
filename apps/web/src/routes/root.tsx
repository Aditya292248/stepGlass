import { Outlet } from '@tanstack/react-router'
import { AppShell } from '../components/app-shell'
import { connectionFixture } from '../fixtures/connection'

export function RootLayout() {
	return (
		<AppShell
			status={connectionFixture}
			sidebar={
				<h2 className="p-4 font-semibold text-[11px] text-muted uppercase tracking-[0.08em]">
					Runs
				</h2>
			}
		>
			<Outlet />
		</AppShell>
	)
}
