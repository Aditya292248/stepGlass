import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom has no layout, so the router's scroll restoration would only log "not implemented".
window.scrollTo = () => {}

afterEach(() => {
	cleanup()
	window.localStorage.clear()
	delete document.documentElement.dataset.theme
})
