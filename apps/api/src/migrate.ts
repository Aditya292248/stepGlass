import { loadConfig } from './config.js'
import { createDatabase } from './db/client.js'
import { runMigrations } from './db/migrate.js'

// `pnpm db:migrate`: applies pending migrations to DATABASE_URL and exits.
const config = loadConfig()
const { db, pool } = createDatabase(config.DATABASE_URL)
try {
	await runMigrations(db)
	console.warn('migrations applied')
} finally {
	await pool.end()
}
