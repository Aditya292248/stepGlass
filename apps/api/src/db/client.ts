import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema.js'

/** The Drizzle handle every route uses; the pool is kept alongside so callers can close it. */
export type Db = NodePgDatabase<typeof schema>

export interface Database {
	db: Db
	pool: pg.Pool
}

export function createDatabase(connectionString: string): Database {
	const pool = new pg.Pool({ connectionString })
	return { db: drizzle(pool, { schema }), pool }
}
