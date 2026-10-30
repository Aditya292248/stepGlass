import { SessionSchema } from '@stepglass/schema'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { RunsSidebar } from '../src/components/runs-sidebar'
import { runsFixture } from '../src/fixtures/runs'
import { formatRelativeTime, type RunSummary, runStatusView } from '../src/lib/runs'
import { renderApp } from './render'

const desktopRuns = () =>
	within(screen.getAllByRole('navigation', { name: 'Runs' })[0] as HTMLElement)

describe('runs fixtures', () => {
	it('match the real session schema', () => {
		for (const run of runsFixture) expect(() => SessionSchema.parse(run.session)).not.toThrow()
	})
})

describe('run status', () => {
	const base = runsFixture[1] as RunSummary
	const view = (over: Partial<RunSummary>, runStatus = base.session.runStatus) =>
		runStatusView({ ...base, ...over, session: { ...base.session, runStatus } })

	it('labels running, failed, passed and unchecked runs', () => {
		expect(view({}, 'running')).toEqual({ tone: 'neutral', label: 'Running' })
		expect(view({ checks: 'fail' })).toEqual({ tone: 'fail', label: 'Failed' })
		expect(view({ checks: 'pass' })).toEqual({ tone: 'pass', label: 'Passed' })
		expect(view({ checks: null }, 'errored')).toEqual({ tone: 'unknown', label: 'Errored' })
	})

	it('formats relative times', () => {
		const now = Date.parse('2026-10-29T12:00:00Z')
		expect(formatRelativeTime('2026-10-29T11:59:30Z', now)).toBe('just now')
		expect(formatRelativeTime('2026-10-29T11:55:00Z', now)).toBe('5m ago')
		expect(formatRelativeTime('2026-10-29T09:00:00Z', now)).toBe('3h ago')
		expect(formatRelativeTime('2026-10-27T12:00:00Z', now)).toBe('2d ago')
		expect(formatRelativeTime('not a date', now)).toBe('—')
	})
})

describe('runs sidebar', () => {
	it('lists runs with their status and marks the selected one', async () => {
		await renderApp('/runs/ses_demo0012')
		const current = desktopRuns().getByRole('link', { current: 'page' })
		expect(current).toHaveTextContent('run-12 · Failed')
		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Archive widgets')
		expect(desktopRuns().getByText('demo-client')).toBeInTheDocument()
	})

	it('has one tab stop and moves with arrow keys, Home and End', async () => {
		await renderApp('/runs/ses_demo0012')
		const links = desktopRuns().getAllByRole('link')
		expect(links.filter((l) => l.tabIndex === 0)).toEqual([links[2]])

		await userEvent.tab()
		await userEvent.tab()
		await userEvent.tab()
		await userEvent.tab()
		expect(links[2]).toHaveFocus()

		await userEvent.keyboard('{ArrowDown}')
		expect(links[3]).toHaveFocus()
		expect(links[3]).toHaveAttribute('tabindex', '0')
		expect(links[2]).toHaveAttribute('tabindex', '-1')

		await userEvent.keyboard('{Home}')
		expect(links[0]).toHaveFocus()
		await userEvent.keyboard('{ArrowUp}')
		expect(links[0]).toHaveFocus()
		await userEvent.keyboard('{End}')
		expect(links.at(-1)).toHaveFocus()
	})

	it('reflects the chosen run in the URL', async () => {
		const { router } = await renderApp('/')
		const link = desktopRuns().getByText('run-13').closest('a') as HTMLElement
		link.focus()
		await userEvent.keyboard('{Enter}')
		expect(router.state.location.pathname).toBe('/runs/ses_demo0013')
		expect(desktopRuns().getByRole('link', { current: 'page' })).toHaveTextContent('run-13')
	})

	it('shows an empty state without runs', () => {
		render(<RunsSidebar runs={[]} />)
		expect(screen.getByText('No runs yet')).toBeInTheDocument()
		expect(screen.queryByText(/Recorded from/)).not.toBeInTheDocument()
	})

	it('says when a run does not exist', async () => {
		await renderApp('/runs/ses_missing00')
		expect(screen.getByRole('heading', { name: 'Run not found' })).toBeInTheDocument()
	})
})
