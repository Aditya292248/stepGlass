import { createHash } from 'node:crypto'
import { SessionTokenSchema } from '@stepglass/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { generateToken, hashesMatch, hashToken } from '../src/auth.js'
import { createSession } from '../src/sessions.js'
import { createTestDatabase, type TestDatabase } from './db.js'
import { actionStarted, sessionInput } from './fixtures.js'

let t: TestDatabase

beforeAll(async () => {
	t = await createTestDatabase()
})
afterAll(() => t.drop())

describe('session tokens', () => {
	it('carry 256 random bits and match the schema', () => {
		const token = generateToken()
		expect(SessionTokenSchema.safeParse(token).success).toBe(true)
		expect(Buffer.from(token.slice(4), 'base64url')).toHaveLength(32)
		expect(generateToken()).not.toBe(token)
	})

	it('are stored only as their SHA-256 digest', async () => {
		const { session, token } = await createSession(t.db, sessionInput)
		const { rows } = await t.pool.query('SELECT * FROM sessions WHERE id = $1', [session.id])
		expect(rows[0].token_hash).toBe(createHash('sha256').update(token).digest('hex'))
		expect(JSON.stringify(rows)).not.toContain(token)
		expect(JSON.stringify(rows)).not.toContain(token.slice(4))
	})

	it('compare digests by value', () => {
		const a = hashToken('sgt_a')
		expect(hashesMatch(a, hashToken('sgt_a'))).toBe(true)
		expect(hashesMatch(a, hashToken('sgt_b'))).toBe(false)
		expect(hashesMatch(a, 'abcd')).toBe(false)
	})

	it('never reach the logs', async () => {
		const lines: string[] = []
		const app = await buildApp({
			db: t.db,
			logger: { level: 'trace', stream: { write: (line: string) => lines.push(line) } },
		})
		// A handler that logs the raw headers and a token-shaped field, the way a careless log call would.
		app.addHook('onRequest', async (request) => {
			request.log.info({ req: { headers: request.headers } }, 'headers')
			request.log.info({ token: request.headers.authorization }, 'field')
		})
		const { session, token } = await createSession(t.db, sessionInput)
		const res = await app.inject({
			method: 'POST',
			url: '/v1/sessions/events',
			headers: { authorization: `Bearer ${token}` },
			payload: { events: [actionStarted(session.id, 0)] },
		})
		expect(res.statusCode).toBe(200)
		await app.close()
		expect(lines.length).toBeGreaterThan(0)
		expect(lines.join('\n')).not.toContain(token)
		expect(lines.join('\n')).toContain('[redacted]')
	})
})
