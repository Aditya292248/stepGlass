import react from '@vitejs/plugin-react'
import { defineProject } from 'vitest/config'

export default defineProject({
	plugins: [react()],
	test: {
		name: '@stepglass/web',
		environment: 'jsdom',
		include: ['test/**/*.test.{ts,tsx}'],
		setupFiles: ['test/setup.ts'],
	},
})
