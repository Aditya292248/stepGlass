export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'stepglass:theme'

/** The theme the user picked, or null to follow the system. Storage can throw (private mode). */
export function readStoredTheme(): Theme | null {
	try {
		const value = window.localStorage.getItem(STORAGE_KEY)
		return value === 'dark' || value === 'light' ? value : null
	} catch {
		return null
	}
}

export function storeTheme(theme: Theme): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, theme)
	} catch {
		// The choice still applies for this page load; it just won't survive a reload.
	}
}

/** Dark unless the system explicitly prefers light. */
export function systemTheme(): Theme {
	return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/** Sets `data-theme`, which overrides the CSS `prefers-color-scheme` default. */
export function applyTheme(theme: Theme | null): void {
	if (theme) document.documentElement.dataset.theme = theme
	else delete document.documentElement.dataset.theme
}
