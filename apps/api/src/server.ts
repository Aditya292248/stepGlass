import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { createDatabase } from './db/client.js'

const config = loadConfig()
const { db, pool } = createDatabase(config.DATABASE_URL)
const app = await buildApp({
	db,
	logger: { level: config.LOG_LEVEL },
	ingestBodyLimit: config.INGEST_BODY_LIMIT_BYTES,
})
app.addHook('onClose', () => pool.end())

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.once(signal, () => {
		app.close().then(
			() => process.exit(0),
			() => process.exit(1),
		)
	})
}

await app.listen({ port: config.PORT, host: config.HOST })
