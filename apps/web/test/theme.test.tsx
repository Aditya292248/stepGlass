import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ThemeToggle } from '../src/components/theme-toggle'
import { applyTheme, readStoredTheme, storeTheme } from '../src/lib/theme'

describe('theme', () => {
	it('starts dark, toggles to light and remembers the choice', async () => {
		render(<ThemeToggle />)
		const button = screen.getByRole('button', { name: 'Switch to light theme' })
		expect(button).toHaveTextContent('Dark')

		await userEvent.click(button)

		expect(document.documentElement.dataset.theme).toBe('light')
		expect(readStoredTheme()).toBe('light')
		expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toHaveTextContent('Light')
	})

	it('follows a light system preference when nothing is stored', () => {
		const matchMedia = vi.fn((query: string) => ({ matches: query.includes('light') }))
		vi.stubGlobal('matchMedia', matchMedia)
		try {
			render(<ThemeToggle />)
			expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument()
		} finally {
			vi.unstubAllGlobals()
		}
	})

	it('prefers the stored choice over the system', () => {
		storeTheme('light')
		render(<ThemeToggle />)
		expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument()
	})

	it('survives storage that throws', () => {
		const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('denied')
		})
		const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('denied')
		})
		try {
			expect(readStoredTheme()).toBeNull()
			expect(() => storeTheme('dark')).not.toThrow()
		} finally {
			getItem.mockRestore()
			setItem.mockRestore()
		}
	})

	it('clears the override when following the system again', () => {
		applyTheme('light')
		applyTheme(null)
		expect(document.documentElement.dataset.theme).toBeUndefined()
	})
})
