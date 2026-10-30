import { randomBytes } from 'node:crypto'
import { buildApp } from '../src/app.js'
import { type CreateSessionRequest, createSession } from '../src/sessions.js'
import { createTestDatabase, type TestDatabase } from './db.js'

/** A client-side UUIDv7, the way a producer mints event IDs. */
export function uuidv7(): string {
	const b = randomBytes(16)
	b.writeUIntBE(Date.now(), 0, 6)
	b[6] = ((b[6] ?? 0) & 0x0f) | 0x70
	b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
	const h = b.toString('hex')
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export const sessionInput: CreateSessionRequest = {
	goal: 'Rename the draft and publish it',
	client: { name: 'test-client', version: '1.0.0', transport: 'sdk' },
	agent: 'test-agent',
	coverage: 'tool_activity',
	dataLabel: 'sandbox',
}

/** A valid `action.started` event; override any field. */
export function actionStarted(
	sessionId: string,
	producerSeq: number,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		schemaVersion: 1,
		id: uuidv7(),
		sessionId,
		occurredAt: new Date().toISOString(),
		source: 'sdk',
		producer: { id: 'p1', seq: producerSeq },
		capture: { completeness: 'full' },
		type: 'action.started',
		actionId: uuidv7(),
		kind: 'tool',
		tool: { name: 'demo.echo' },
		input: { text: `step ${producerSeq}` },
		...overrides,
	}
}

export type TestApp = Awaited<ReturnType<typeof buildApp>>

export interface Harness {
	t: TestDatabase
	app: TestApp
	/** Opens a session directly through the service and returns its row ID and token. */
	newSession(): Promise<{ id: string; publicId: string; token: string }>
	close(): Promise<void>
}

/** One migrated database and one app per test file. */
export async function createHarness(options: { ingestBodyLimit?: number } = {}): Promise<Harness> {
	const t = await createTestDatabase()
	const app = await buildApp({ db: t.db, logger: false, ...options })
	return {
		t,
		app,
		async newSession() {
			const { session, token } = await createSession(t.db, sessionInput)
			return { id: session.id, publicId: session.publicId, token }
		},
		async close() {
			await app.close()
			await t.drop()
		},
	}
}
