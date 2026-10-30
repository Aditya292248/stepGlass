import { defineConfig } from 'vitest/config'

// Each workspace package is its own Vitest project; CI runs them through
// `turbo run test`, this file lets `pnpm vitest` and editors see them all.
export default defineConfig({
	test: {
		projects: ['apps/*', 'packages/*', 'connectors/*', 'scenarios/*', 'tooling/*'],
	},
})
