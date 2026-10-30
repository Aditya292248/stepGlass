import { z } from 'zod'
import { CurrencySchema, SchemaVersionSchema, SlugSchema, VersionSchema } from './common.js'

/**
 * Where a value lives in a recorded action: the tool's input or output, or the object's state
 * before or after. One addressing scheme lets templates, field labels and diffs share keys.
 */
export const FieldPathSchema = z
	.string()
	.regex(/^(input|output|before|after)(\.[A-Za-z_][A-Za-z0-9_]*)+$/)
/** See {@link FieldPathSchema}. */
export type FieldPath = z.infer<typeof FieldPathSchema>

/** How the UI renders a field. A closed set so a descriptor can't ask for arbitrary formatting. */
export const FieldFormatSchema = z.enum([
	'text',
	'integer',
	'currency_minor',
	'basis_points',
	'datetime',
	'email',
	'email_list',
	'id',
	'json',
])
/** See {@link FieldFormatSchema}. */
export type FieldFormat = z.infer<typeof FieldFormatSchema>

/** One piece of a parsed template. */
export type TemplateSegment =
	| { kind: 'text'; text: string }
	| { kind: 'field'; path: FieldPath; format?: FieldFormat }

/** Where and why a template failed to parse; `index` is the offset of the offending `{`. */
export interface TemplateError {
	index: number
	message: string
}

/** Either all segments or every error, so authors see all problems in one pass. */
export type TemplateParseResult =
	| { ok: true; segments: TemplateSegment[] }
	| { ok: false; errors: TemplateError[] }

/**
 * Parses `literal {path} or {path|format}` with `{{` as a literal brace. The grammar has no
 * expressions or calls on purpose: descriptors are untrusted data and must render, never run.
 */
export function parseTemplate(t: string): TemplateParseResult {
	const segments: TemplateSegment[] = []
	const errors: TemplateError[] = []
	let text = ''
	let i = 0
	while (i < t.length) {
		if (t.startsWith('{{', i)) {
			text += '{'
			i += 2
			continue
		}
		if (t[i] !== '{') {
			text += t[i]
			i += 1
			continue
		}
		const close = t.indexOf('}', i)
		if (close === -1) {
			errors.push({ index: i, message: 'unterminated placeholder' })
			break
		}
		if (text) segments.push({ kind: 'text', text })
		text = ''
		const [path = '', format, ...rest] = t.slice(i + 1, close).split('|')
		if (path === '') errors.push({ index: i, message: 'empty field path' })
		else if (!FieldPathSchema.safeParse(path).success)
			errors.push({ index: i, message: `invalid field path "${path}"` })
		if (rest.length > 0) errors.push({ index: i, message: 'only one |format is allowed' })
		const fmt = format === undefined ? undefined : FieldFormatSchema.safeParse(format)
		if (fmt && !fmt.success) errors.push({ index: i, message: `unknown format "${format}"` })
		segments.push({ kind: 'field', path, ...(fmt?.success ? { format: fmt.data } : {}) })
		i = close + 1
	}
	if (text) segments.push({ kind: 'text', text })
	return errors.length > 0 ? { ok: false, errors } : { ok: true, segments }
}

/** The field paths a template reads, so a descriptor can be checked for undeclared fields. */
export function templateFields(t: string): FieldPath[] {
	const parsed = parseTemplate(t)
	if (!parsed.ok) return []
	return parsed.segments.flatMap((s) => (s.kind === 'field' ? [s.path] : []))
}

/** A template string that is validated at parse time, so bad descriptors fail on upload. */
export const TemplateSchema = z
	.string()
	.min(1)
	.max(500)
	.superRefine((t, ctx) => {
		const parsed = parseTemplate(t)
		if (parsed.ok) return
		for (const e of parsed.errors)
			ctx.addIssue({ code: 'custom', message: `@${e.index}: ${e.message}` })
	})

/** Display metadata for one field; `sensitive` fields are masked in the UI and in exports. */
export const FieldSpecSchema = z.strictObject({
	label: z.string().min(1).max(100),
	format: FieldFormatSchema,
	currency: CurrencySchema.optional(),
	sensitive: z.boolean().optional(),
	computed: z.boolean().optional(),
})

/**
 * Tells the core how to present and verify one tool without knowing its domain. Connectors ship
 * these; the UI renders any tool from them alone.
 */
export const ToolDescriptorSchema = z
	.strictObject({
		schemaVersion: SchemaVersionSchema,
		tool: SlugSchema,
		version: VersionSchema,
		kind: z.enum(['read', 'write', 'other']),
		title: TemplateSchema,
		description: TemplateSchema.optional(),
		/** The object a write changes; required for writes so evidence can be paired per object. */
		object: z
			.strictObject({ type: SlugSchema, idPath: FieldPathSchema, label: TemplateSchema })
			.optional(),
		fields: z.record(FieldPathSchema, FieldSpecSchema),
		verification: z.enum(['in_transaction', 'read_back', 'none']),
		capture: z.strictObject({
			input: z.enum(['full', 'metadata_only']),
			output: z.enum(['full', 'metadata_only']),
		}),
	})
	.superRefine((d, ctx) => {
		if (d.kind === 'write' && !d.object) {
			ctx.addIssue({
				code: 'custom',
				path: ['object'],
				message: 'a write tool must name its object',
			})
		}
		if (d.kind === 'write' && d.verification === 'none') {
			ctx.addIssue({
				code: 'custom',
				path: ['verification'],
				message: 'a write tool must declare how it is verified',
			})
		}
		const known = new Set([...Object.keys(d.fields), ...(d.object ? [d.object.idPath] : [])])
		const templates = { title: d.title, description: d.description, label: d.object?.label }
		for (const [key, t] of Object.entries(templates)) {
			for (const path of t === undefined ? [] : templateFields(t)) {
				if (!known.has(path)) {
					ctx.addIssue({ code: 'custom', path: [key], message: `undeclared field "${path}"` })
				}
			}
		}
	})
/** See {@link ToolDescriptorSchema}. */
export type ToolDescriptor = z.infer<typeof ToolDescriptorSchema>
