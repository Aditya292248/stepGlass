import { existsSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

// Integration tests need a real Postgres. Pick up the repo's .env when DATABASE_URL isn't set.
const envFile = new URL('../../.env', import.meta.url)
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile)

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		testTimeout: 20_000,
		hookTimeout: 30_000,
	},
})
