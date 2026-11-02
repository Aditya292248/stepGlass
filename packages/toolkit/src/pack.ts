import { CheckBundleSchema, SlugSchema } from '@stepglass/schema'
import type { ToolPack } from './contract.js'

/**
 * Validates a pack once, when it is defined, so a host can trust any pack it is given: names are
 * slugs and unique, every descriptor names its own tool, and every check bundle parses.
 */
export function defineToolPack(pack: ToolPack): ToolPack {
	SlugSchema.parse(pack.name)
	if (pack.version.length === 0) throw new Error(`pack ${pack.name}: version must not be empty`)
	const seen = new Set<string>()
	for (const tool of pack.tools) {
		if (seen.has(tool.name)) throw new Error(`pack ${pack.name}: duplicate tool "${tool.name}"`)
		seen.add(tool.name)
		if (tool.descriptor.tool !== tool.name) {
			throw new Error(
				`pack ${pack.name}: tool "${tool.name}" has a descriptor for "${tool.descriptor.tool}"`,
			)
		}
	}
	const checks = pack.checks?.map((b) => CheckBundleSchema.parse(b))
	const bundleIds = new Set(checks?.map((b) => b.id))
	if (checks && bundleIds.size !== checks.length) {
		throw new Error(`pack ${pack.name}: check bundle IDs must be unique`)
	}
	return Object.freeze({
		...pack,
		tools: Object.freeze([...pack.tools]),
		...(checks ? { checks: Object.freeze(checks) } : {}),
	})
}
