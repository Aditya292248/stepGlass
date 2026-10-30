import { randomBytes } from 'node:crypto'
import {
	type PublicSessionId,
	PublicSessionIdSchema,
	type Session,
	SessionSchema,
	type SessionToken,
} from '@stepglass/schema'
import { z } from 'zod'
import { generateToken, hashToken } from './auth.js'
import type { Db } from './db/client.js'
import { sessions } from './db/schema.js'

/** What a client supplies to open a session; everything else is assigned by the server. */
export const CreateSessionRequestSchema = SessionSchema.pick({
	goal: true,
	client: true,
	agent: true,
	coverage: true,
	dataLabel: true,
})
/** See {@link CreateSessionRequestSchema}. */
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>

/** The only response that ever carries the token; it is not recoverable afterwards. */
export const CreatedSessionSchema = z.strictObject({ session: SessionSchema, token: z.string() })

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz'
const PUBLIC_ID_LENGTH = 16

/** `ses_` plus 16 base36 characters (~82 bits), drawn without modulo bias. */
export function generatePublicId(): PublicSessionId {
	let out = ''
	while (out.length < PUBLIC_ID_LENGTH) {
		for (const byte of randomBytes(PUBLIC_ID_LENGTH)) {
			// 252 is the largest multiple of 36 below 256; rejecting above it keeps every digit equally likely.
			if (byte < 252 && out.length < PUBLIC_ID_LENGTH) out += BASE36[byte % 36]
		}
	}
	return PublicSessionIdSchema.parse(`ses_${out}`)
}

type SessionRow = typeof sessions.$inferSelect

/** Maps a row to the public read model. The token hash is not part of it. */
export function toSession(row: SessionRow): Session {
	return SessionSchema.parse({
		schemaVersion: 1,
		id: row.id,
		publicId: row.publicId,
		goal: row.goal,
		client: row.client,
		...(row.agent === null ? {} : { agent: row.agent }),
		startedAt: row.startedAt.toISOString(),
		...(row.endedAt === null ? {} : { endedAt: row.endedAt.toISOString() }),
		runStatus: row.runStatus,
		coverage: row.coverage,
		dataLabel: row.dataLabel,
	})
}

/** Opens a session and mints its token. Only the token's digest is written. */
export async function createSession(
	db: Db,
	input: CreateSessionRequest,
): Promise<{ session: Session; token: SessionToken }> {
	const token = generateToken()
	const [row] = await db
		.insert(sessions)
		.values({
			publicId: generatePublicId(),
			tokenHash: hashToken(token),
			goal: input.goal,
			client: input.client,
			agent: input.agent ?? null,
			coverage: input.coverage,
			dataLabel: input.dataLabel,
		})
		.returning()
	if (!row) throw new Error('session insert returned no row')
	return { session: toSession(row), token }
}
