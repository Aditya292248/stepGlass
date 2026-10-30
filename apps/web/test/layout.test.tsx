import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { CommandField } from '../src/components/command-field'
import { StatusBar } from '../src/components/status-bar'
import { renderApp } from './render'

describe('command field', () => {
	it('takes focus on Ctrl+K and Cmd+K', () => {
		render(<CommandField />)
		const field = screen.getByRole('textbox', { name: 'Jump to a step or command' })
		expect(field).not.toHaveFocus()

		fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
		expect(field).toHaveFocus()

		field.blur()
		fireEvent.keyDown(document, { key: 'K', metaKey: true })
		expect(field).toHaveFocus()
	})

	it('ignores a plain k and other modifier combinations', () => {
		render(<CommandField />)
		fireEvent.keyDown(document, { key: 'k' })
		fireEvent.keyDown(document, { key: 'k', ctrlKey: true, shiftKey: true })
		expect(screen.getByRole('textbox')).not.toHaveFocus()
	})

	it('gives focus back on Escape', async () => {
		render(<CommandField />)
		const field = screen.getByRole('textbox')
		await userEvent.click(field)
		await userEvent.keyboard('{Escape}')
		expect(field).not.toHaveFocus()
	})
})

describe('status bar', () => {
	it('shows the client, its transport and the data label', () => {
		render(
			<StatusBar
				client={{ name: 'demo-client', transport: 'stdio' }}
				connected
				dataLabel="sandbox"
			/>,
		)
		expect(screen.getByRole('status')).toHaveTextContent('Connected to demo-client (MCP)')
		expect(screen.getByText('Sandbox data')).toBeInTheDocument()
	})

	it('says when the client is disconnected and the data is live', () => {
		render(
			<StatusBar client={{ name: 'cli', transport: 'sdk' }} connected={false} dataLabel="live" />,
		)
		expect(screen.getByRole('status')).toHaveTextContent('Disconnected from cli (SDK)')
		expect(screen.getByText('Live data')).toBeInTheDocument()
	})
})

describe('shell', () => {
	it('renders the title bar, the column headings and the status bar', async () => {
		await renderApp('/')
		expect(screen.getByRole('banner')).toBeInTheDocument()
		for (const name of ['What the agent did', 'Why', 'Checks']) {
			expect(screen.getByRole('region', { name })).toBeInTheDocument()
		}
		expect(within(screen.getByRole('contentinfo')).getByText('Sandbox data')).toBeInTheDocument()
	})

	it('opens the runs drawer from the menu button', async () => {
		await renderApp('/')
		await userEvent.click(screen.getByRole('button', { name: 'Open runs' }))
		const drawer = screen.getByRole('dialog', { name: 'Runs' })
		expect(within(drawer).getAllByRole('link')[0]).toHaveFocus()
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
	})
})
