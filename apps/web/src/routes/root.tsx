import { Outlet, useParams } from '@tanstack/react-router'
import { AppShell } from '../components/app-shell'
import { RunsSidebar } from '../components/runs-sidebar'
import { connectionFixture } from '../fixtures/connection'
import { runsFixture } from '../fixtures/runs'

export function RootLayout() {
	const { publicId } = useParams({ strict: false })
	return (
		<AppShell
			status={connectionFixture}
			sidebar={<RunsSidebar runs={runsFixture} selectedId={publicId} />}
		>
			<Outlet />
		</AppShell>
	)
}
