import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { type SessionToken, SessionTokenSchema } from '@stepglass/schema'
import { eq } from 'drizzle-orm'
import type { Db } from './db/client.js'
import { sessions } from './db/schema.js'

/** 256 bits from the CSPRNG, comfortably above the schema's 128-bit floor. */
const TOKEN_BYTES = 32

/** Mints a session's bearer secret. Return it to the client once; store only {@link hashToken}. */
export function generateToken(): SessionToken {
	return SessionTokenSchema.parse(`sgt_${randomBytes(TOKEN_BYTES).toString('base64url')}`)
}

/**
 * Hex SHA-256 of the token. A plain fast hash is enough: the token is uniformly random with 256
 * bits of entropy, so there is nothing for a slow password hash to protect against.
 */
export function hashToken(token: string): string {
	return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Constant-time comparison of two hex digests. */
export function hashesMatch(a: string, b: string): boolean {
	const x = Buffer.from(a, 'hex')
	const y = Buffer.from(b, 'hex')
	return x.length === y.length && timingSafeEqual(x, y)
}

/** The session a bearer token grants append access to. */
export type AuthenticatedSession = Pick<typeof sessions.$inferSelect, 'id' | 'publicId'>

/**
 * Resolves `Authorization: Bearer sgt_…` to its session, or null for a missing, malformed or
 * unknown token. Lookup is by digest, so the database never sees the secret itself.
 */
export async function authenticate(
	db: Db,
	authorization: string | undefined,
): Promise<AuthenticatedSession | null> {
	const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '')
	const token = SessionTokenSchema.safeParse(match?.[1])
	if (!token.success) return null
	const digest = hashToken(token.data)
	const [row] = await db
		.select({ id: sessions.id, publicId: sessions.publicId, tokenHash: sessions.tokenHash })
		.from(sessions)
		.where(eq(sessions.tokenHash, digest))
	if (!row || !hashesMatch(row.tokenHash, digest)) return null
	return { id: row.id, publicId: row.publicId }
}
