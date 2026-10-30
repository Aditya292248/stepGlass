import { z } from 'zod'

const ConfigSchema = z.object({
	DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
	PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
	HOST: z.string().min(1).default('0.0.0.0'),
	LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
	/** Bound on one ingestion request; a full batch of large tool outputs fits comfortably. */
	INGEST_BODY_LIMIT_BYTES: z.coerce
		.number()
		.int()
		.min(1024)
		.default(4 * 1024 * 1024),
})
/** Validated process configuration. */
export type Config = z.infer<typeof ConfigSchema>

/** Parses the environment once at startup, so a bad value fails fast with every problem listed. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const parsed = ConfigSchema.safeParse(env)
	if (!parsed.success) {
		throw new Error(`invalid configuration:\n${z.prettifyError(parsed.error)}`)
	}
	return parsed.data
}
