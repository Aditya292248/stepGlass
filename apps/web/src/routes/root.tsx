import { Outlet } from '@tanstack/react-router'
import { ThemeToggle } from '../components/theme-toggle'

export function RootLayout() {
	return (
		<div className="flex h-full flex-col">
			<header className="flex h-12 items-center justify-between border-b px-4">
				<span className="font-semibold text-sm">Stepglass</span>
				<ThemeToggle />
			</header>
			<main className="min-h-0 flex-1">
				<Outlet />
			</main>
		</div>
	)
}
