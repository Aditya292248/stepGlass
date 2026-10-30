import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import type { Db } from './client.js'

/** The checked-in SQL migrations; resolved from both src/ (tests) and dist/ (production). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url))

/** Applies every pending migration. Safe to run repeatedly; applied ones are skipped. */
export async function runMigrations(db: Db): Promise<void> {
	await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
}
