import { type ToolDescriptor, ToolDescriptorSchema } from '@stepglass/schema'
import { z } from 'zod'

/** A descriptor as authors write it: everything but the stamped `schemaVersion`. */
export type DescriptorInput = Omit<z.input<typeof ToolDescriptorSchema>, 'schemaVersion'>

/**
 * Validates a descriptor with `ToolDescriptorSchema` and fills `schemaVersion`. The literal
 * `kind` and `verification` survive in the return type, so `defineTool` can reject a write
 * descriptor without matching verification hooks at compile time.
 */
export function descriptor<const D extends DescriptorInput>(d: D): D & ToolDescriptor {
	return ToolDescriptorSchema.parse({ ...d, schemaVersion: 1 }) as D & ToolDescriptor
}

/**
 * Explains why `path` (keys below `input` or `output`) is not a required member of `schema`, or
 * returns undefined when it is. Unions must have it in every option.
 */
export function missingPath(schema: z.ZodType, path: readonly string[]): string | undefined {
	const [head, ...rest] = path
	if (head === undefined) {
		const optional = schema.safeParse(undefined).success || schema.safeParse(null).success
		return optional ? 'is optional or nullable' : undefined
	}
	if (schema instanceof z.ZodUnion) {
		for (const option of schema.options as z.ZodType[]) {
			const why = missingPath(option, path)
			if (why) return why
		}
		return undefined
	}
	if (!(schema instanceof z.ZodObject)) return 'is not inside a z.object() schema'
	const child = (schema.shape as Record<string, z.ZodType | undefined>)[head]
	if (!child) return `has no "${head}" key`
	return missingPath(child, rest)
}
