import { z } from 'zod'
import {
	CurrencySchema,
	type JsonValue,
	JsonValueSchema,
	SafeIntSchema,
	SchemaVersionSchema,
	SlugSchema,
	TimestampSchema,
	Uuidv7Schema,
	VersionSchema,
} from './common.js'
import { ActionStatusSchema } from './event.js'

/** Bounds evaluation cost and keeps recursion in the engine and the UI safe. */
export const MAX_EXPR_DEPTH = 32
/** Bounds literal size so a check bundle cannot smuggle in a payload. */
export const MAX_LITERAL_LENGTH = 10_000

/**
 * Every operator the expression language has. The evaluator (PR 3) maps over this tuple so adding
 * an operator here without handling it there fails its type check.
 */
export const CHECK_OPERATORS = [
	'lit',
	'var',
	'get',
	'events',
	'snapshot',
	'count',
	'sum',
	'email_domain',
	'lower',
	'in',
	'eq',
	'ne',
	'lt',
	'lte',
	'gt',
	'gte',
	'and',
	'or',
	'not',
	'all',
	'any',
	'required_before',
	'forbidden_after_unless',
	'only_changed',
] as const
/** See {@link CHECK_OPERATORS}. */
export type CheckOperator = (typeof CHECK_OPERATORS)[number]

/** Unit of a measured comparison; all are integers so the UI gauge never shows rounding drift. */
export const MeasureUnitSchema = z.enum(['count', 'currency_minor', 'basis_points'])

/** What the UI gauge reads: a labelled value against a limit, broken into named terms. */
export interface Measure {
	label: string
	unit: z.infer<typeof MeasureUnitSchema>
	currency?: string
	terms?: { label: string; value: Expr }[]
}
interface Comparison {
	left: Expr
	right: Expr
	measure?: Measure
}
interface ObjectRef {
	type: string
	id: Expr
}

/**
 * A check assertion. It is a restricted AST, not code: bundles come from connectors and users,
 * and nothing in them may ever execute. Quantifiers (`all`, `any`) bind `as` for `var`.
 */
export type Expr =
	| { op: 'lit'; value: JsonValue }
	| { op: 'var'; name: string }
	| { op: 'get'; of: Expr; path: string[] }
	| {
			op: 'events'
			where: {
				type?: 'tool' | 'model'
				tool?: string
				status?: z.infer<typeof ActionStatusSchema>
				inputMatches?: Expr
			}
	  }
	| { op: 'snapshot'; object: ObjectRef; phase: 'before' | 'after' }
	| { op: 'count' | 'email_domain' | 'lower' | 'not'; of: Expr }
	| { op: 'sum'; of: Expr; field: string[] }
	| { op: 'in'; value: Expr; list: Expr }
	| ({ op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' } & Comparison)
	| { op: 'and' | 'or'; args: Expr[] }
	| { op: 'all' | 'any'; in: Expr; as: string; test: Expr }
	// `second`, not `then`: an object with a `then` key is a thenable and breaks under `await`.
	| { op: 'required_before'; first: Expr; second: Expr }
	| { op: 'forbidden_after_unless'; trigger: Expr; forbidden: Expr; unless?: Expr }
	| { op: 'only_changed'; objects: ObjectRef[] }

// Fails to compile if CHECK_OPERATORS and Expr drift apart.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
true satisfies Same<CheckOperator, Expr['op']>

function isPolicyLiteral(v: JsonValue): boolean {
	if (typeof v === 'number') return Number.isSafeInteger(v)
	if (typeof v === 'string') return v.length <= MAX_LITERAL_LENGTH
	if (Array.isArray(v)) return v.every(isPolicyLiteral)
	if (v !== null && typeof v === 'object') return Object.values(v).every(isPolicyLiteral)
	return true
}

/** Counts operator nesting; literal payloads don't count because they are never evaluated. */
export function exprDepth(node: unknown): number {
	if (Array.isArray(node)) return Math.max(0, ...node.map(exprDepth))
	if (node === null || typeof node !== 'object') return 0
	const isOp = 'op' in node
	if (isOp && node.op === 'lit') return 1
	return (isOp ? 1 : 0) + Math.max(0, ...Object.values(node).map(exprDepth))
}

const Name = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/)
const Path = z.array(z.string().min(1).max(128)).min(1).max(16)

const ExprNodeSchema: z.ZodType<Expr> = z.lazy(() => {
	const E = ExprNodeSchema
	const obj = z.strictObject({ type: SlugSchema, id: E })
	const measure = z.strictObject({
		label: z.string().min(1).max(200),
		unit: MeasureUnitSchema,
		currency: CurrencySchema.optional(),
		terms: z.array(z.strictObject({ label: z.string().min(1).max(200), value: E })).optional(),
	})
	return z.discriminatedUnion('op', [
		z.strictObject({
			op: z.literal('lit'),
			value: JsonValueSchema.refine(isPolicyLiteral, {
				message: `literals must use safe integers and strings of at most ${MAX_LITERAL_LENGTH} chars`,
			}),
		}),
		z.strictObject({ op: z.literal('var'), name: Name }),
		z.strictObject({ op: z.literal('get'), of: E, path: Path }),
		z.strictObject({
			op: z.literal('events'),
			where: z.strictObject({
				type: z.enum(['tool', 'model']).optional(),
				tool: SlugSchema.optional(),
				status: ActionStatusSchema.optional(),
				inputMatches: E.optional(),
			}),
		}),
		z.strictObject({ op: z.literal('snapshot'), object: obj, phase: z.enum(['before', 'after']) }),
		z.strictObject({ op: z.enum(['count', 'email_domain', 'lower', 'not']), of: E }),
		z.strictObject({ op: z.literal('sum'), of: E, field: Path }),
		z.strictObject({ op: z.literal('in'), value: E, list: E }),
		z.strictObject({
			op: z.enum(['eq', 'ne', 'lt', 'lte', 'gt', 'gte']),
			left: E,
			right: E,
			measure: measure.optional(),
		}),
		z.strictObject({ op: z.enum(['and', 'or']), args: z.array(E).min(1) }),
		z.strictObject({ op: z.enum(['all', 'any']), in: E, as: Name, test: E }),
		z.strictObject({ op: z.literal('required_before'), first: E, second: E }),
		z.strictObject({
			op: z.literal('forbidden_after_unless'),
			trigger: E,
			forbidden: E,
			unless: E.optional(),
		}),
		z.strictObject({ op: z.literal('only_changed'), objects: z.array(obj).min(1) }),
	])
})

/** A validated expression, depth-limited at the root so the limit is checked once per tree. */
export const ExprSchema = ExprNodeSchema.refine((e) => exprDepth(e) <= MAX_EXPR_DEPTH, {
	message: `expression nests deeper than ${MAX_EXPR_DEPTH}`,
})

/** One policy rule. Versioned so a stored result always names the exact rule that produced it. */
export const CheckDefinitionSchema = z.strictObject({
	schemaVersion: SchemaVersionSchema,
	id: SlugSchema,
	version: VersionSchema,
	/** Plain language, phrased as the expected behavior, for reviewers who don't read code. */
	title: z.string().min(1).max(200),
	description: z.string().max(2000).optional(),
	severity: z.enum(['error', 'warning']),
	assert: ExprSchema,
})
/** See {@link CheckDefinitionSchema}. */
export type CheckDefinition = z.infer<typeof CheckDefinitionSchema>

/** The unit a scenario or connector ships checks in; versioned as a whole for reproducibility. */
export const CheckBundleSchema = z
	.strictObject({
		schemaVersion: SchemaVersionSchema,
		id: SlugSchema,
		version: VersionSchema,
		checks: z.array(CheckDefinitionSchema).min(1),
	})
	.refine((b) => new Set(b.checks.map((c) => c.id)).size === b.checks.length, {
		message: 'check IDs must be unique within a bundle',
		path: ['checks'],
	})
/** See {@link CheckBundleSchema}. */
export type CheckBundle = z.infer<typeof CheckBundleSchema>

/** The computed numbers behind a measured comparison, integers only. */
export const MeasurementSchema = z.strictObject({
	value: SafeIntSchema,
	limit: SafeIntSchema,
	unit: MeasureUnitSchema,
	currency: CurrencySchema.optional(),
	terms: z.array(z.strictObject({ label: z.string().min(1).max(200), value: SafeIntSchema })),
})

/**
 * One evaluation of one check version over a session prefix. A `pass` must cite at least one
 * event, because a pass with no evidence is indistinguishable from "nothing was looked at".
 */
export const CheckResultSchema = z
	.strictObject({
		schemaVersion: SchemaVersionSchema,
		id: Uuidv7Schema,
		sessionId: Uuidv7Schema,
		checkId: SlugSchema,
		checkVersion: VersionSchema,
		outcome: z.enum(['pass', 'fail', 'unknown']),
		reasons: z.array(
			z.strictObject({
				code: SlugSchema,
				message: z.string().min(1).max(2000),
				eventIds: z.array(Uuidv7Schema),
			}),
		),
		measurement: MeasurementSchema.optional(),
		/** Per-session event cursor; a later result over more events supersedes this one. */
		evaluatedThroughSeq: SafeIntSchema.min(0),
		evaluatedAt: TimestampSchema,
		supersededBy: Uuidv7Schema.optional(),
	})
	.refine((r) => r.outcome !== 'pass' || r.reasons.some((x) => x.eventIds.length > 0), {
		message: 'a pass must cite at least one event',
		path: ['reasons'],
	})
/** See {@link CheckResultSchema}. */
export type CheckResult = z.infer<typeof CheckResultSchema>
