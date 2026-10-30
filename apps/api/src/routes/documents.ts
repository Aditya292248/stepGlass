import {
	CheckBundleSchema,
	SlugSchema,
	ToolDescriptorSchema,
	VersionSchema,
} from '@stepglass/schema'
import { and, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { canonicalJson } from '../canonical.js'
import type { Db } from '../db/client.js'
import { checkBundles, toolDescriptors } from '../db/schema.js'
import { ProblemSchema, sendProblem } from '../problem.js'

/** Write-once storage keyed by `(name, version)`. */
interface DocumentStore {
	find(name: string, version: number): Promise<unknown>
	/** Inserts unless the key exists; true when this call wrote the row. */
	insert(name: string, version: number, document: unknown): Promise<boolean>
}

function descriptorStore(db: Db): DocumentStore {
	const t = toolDescriptors
	return {
		async find(name, version) {
			const [row] = await db
				.select({ document: t.document })
				.from(t)
				.where(and(eq(t.tool, name), eq(t.version, version)))
			return row?.document
		},
		async insert(name, version, document) {
			const rows = await db
				.insert(t)
				.values({ tool: name, version, document })
				.onConflictDoNothing()
				.returning({ version: t.version })
			return rows.length === 1
		},
	}
}

function bundleStore(db: Db): DocumentStore {
	const t = checkBundles
	return {
		async find(name, version) {
			const [row] = await db
				.select({ document: t.document })
				.from(t)
				.where(and(eq(t.bundleId, name), eq(t.version, version)))
			return row?.document
		},
		async insert(name, version, document) {
			const rows = await db
				.insert(t)
				.values({ bundleId: name, version, document })
				.onConflictDoNothing()
				.returning({ version: t.version })
			return rows.length === 1
		},
	}
}

const KeyParams = (nameParam: string) =>
	z.strictObject({
		[nameParam]: SlugSchema,
		version: z.coerce.number().pipe(VersionSchema),
	})

interface ImmutableResource<S extends z.ZodType> {
	path: string
	nameParam: string
	tag: string
	noun: string
	schema: S
	store: DocumentStore
	keyOf(document: z.output<S>): { name: string; version: number }
}

/**
 * PUT creates (201); re-PUT of an identical document is a no-op (200); a different document under
 * an existing `(name, version)` is refused (409), because stored results cite these exact versions.
 */
function registerImmutable<S extends z.ZodType>(
	// Untyped on purpose: the compilers still validate at runtime, but a generic `S` defeats the
	// type provider's inference, so params and body are narrowed by hand below.
	app: FastifyInstance,
	r: ImmutableResource<S>,
): void {
	const params = KeyParams(r.nameParam)
	const keyFrom = (p: unknown) => {
		const record = p as Record<string, unknown>
		return { name: String(record[r.nameParam]), version: Number(record.version) }
	}

	app.put(
		r.path,
		{
			schema: {
				summary: `Store a ${r.noun}; versions are immutable`,
				tags: [r.tag],
				params,
				body: r.schema,
				response: {
					200: r.schema,
					201: r.schema,
					400: ProblemSchema,
					409: ProblemSchema,
				},
			},
		},
		async (request, reply) => {
			const key = keyFrom(request.params)
			const body = request.body as z.output<S>
			const own = r.keyOf(body)
			if (own.name !== key.name || own.version !== key.version) {
				return sendProblem(
					reply,
					400,
					'path_mismatch',
					`the body is ${own.name}@${own.version} but the path names ${key.name}@${key.version}`,
				)
			}
			if (await r.store.insert(key.name, key.version, body)) return reply.code(201).send(body)
			const stored = await r.store.find(key.name, key.version)
			if (canonicalJson(stored) === canonicalJson(body)) return reply.code(200).send(body)
			return sendProblem(
				reply,
				409,
				'immutable_version',
				`${key.name}@${key.version} already exists with different content; publish a new version`,
			)
		},
	)

	app.get(
		r.path,
		{
			schema: {
				summary: `Get a ${r.noun}`,
				tags: [r.tag],
				params,
				response: { 200: r.schema, 404: ProblemSchema },
			},
		},
		async (request, reply) => {
			const key = keyFrom(request.params)
			const stored = await r.store.find(key.name, key.version)
			if (stored === undefined) return sendProblem(reply, 404, 'not_found')
			return stored
		},
	)
}

export const documentRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
	registerImmutable(app, {
		path: '/v1/tool-descriptors/:name/:version',
		nameParam: 'name',
		tag: 'tool-descriptors',
		noun: 'tool descriptor',
		schema: ToolDescriptorSchema,
		store: descriptorStore(db),
		keyOf: (d) => ({ name: d.tool, version: d.version }),
	})
	registerImmutable(app, {
		path: '/v1/check-bundles/:id/:version',
		nameParam: 'id',
		tag: 'check-bundles',
		noun: 'check bundle',
		schema: CheckBundleSchema,
		store: bundleStore(db),
		keyOf: (b) => ({ name: b.id, version: b.version }),
	})
}
