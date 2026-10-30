import { defineConfig } from 'drizzle-kit'

// `pnpm db:generate` diffs src/db/schema.ts against drizzle/ and writes the next migration.
export default defineConfig({
	dialect: 'postgresql',
	schema: './src/db/schema.ts',
	out: './drizzle',
})
