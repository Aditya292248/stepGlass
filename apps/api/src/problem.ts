import { STATUS_CODES } from 'node:http'
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import {
	hasZodFastifySchemaValidationErrors,
	isResponseSerializationError,
} from 'fastify-type-provider-zod'
import { z } from 'zod'

/**
 * RFC 9457 problem details. `type` stays `about:blank` (so `title` is the HTTP reason phrase);
 * the machine-readable reason is the `code` extension member.
 */
export const ProblemSchema = z
	.object({
		type: z.string(),
		title: z.string(),
		status: z.int(),
		detail: z.string().optional(),
		instance: z.string().optional(),
		code: z.string(),
		errors: z.array(z.strictObject({ path: z.string(), message: z.string() })).optional(),
	})
	.meta({ id: 'Problem' })
/** See {@link ProblemSchema}. */
export type Problem = z.infer<typeof ProblemSchema>

export const PROBLEM_CONTENT_TYPE = 'application/problem+json'

/** Sends a problem+json response; `extra` carries extension members such as `errors`. */
export function sendProblem(
	reply: FastifyReply,
	status: number,
	code: string,
	detail?: string,
	extra: Pick<Problem, 'errors'> = {},
): FastifyReply {
	const problem: Problem = {
		type: 'about:blank',
		title: STATUS_CODES[status] ?? 'Error',
		status,
		code,
		...(detail === undefined ? {} : { detail }),
		instance: reply.request.url,
		...extra,
	}
	return reply.code(status).type(PROBLEM_CONTENT_TYPE).send(problem)
}

/** 401 with the RFC 6750 challenge, so clients know a bearer token is what's missing. */
export function sendUnauthorized(reply: FastifyReply): FastifyReply {
	reply.header('www-authenticate', 'Bearer realm="stepglass", error="invalid_token"')
	return sendProblem(reply, 401, 'invalid_token', 'a valid session token is required')
}

const FASTIFY_CODES: Record<string, string> = {
	FST_ERR_CTP_BODY_TOO_LARGE: 'body_too_large',
	FST_ERR_CTP_INVALID_MEDIA_TYPE: 'unsupported_media_type',
	FST_ERR_CTP_EMPTY_JSON_BODY: 'invalid_body',
	FST_ERR_CTP_INVALID_JSON_BODY: 'invalid_body',
}

/** Turns every thrown error into problem+json. 5xx details are logged, never sent. */
export function problemErrorHandler(
	error: FastifyError,
	request: FastifyRequest,
	reply: FastifyReply,
): FastifyReply {
	if (hasZodFastifySchemaValidationErrors(error)) {
		const errors = error.validation.map((v) => ({
			path: `${error.validationContext ?? ''}${v.instancePath}`,
			message: v.message ?? 'invalid',
		}))
		return sendProblem(reply, 400, 'validation_failed', 'the request does not match the schema', {
			errors,
		})
	}
	const status = error.statusCode ?? 500
	if (status >= 500 || isResponseSerializationError(error)) {
		request.log.error({ err: error }, 'request failed')
		return sendProblem(reply, 500, 'internal_error')
	}
	const code = (error.code && FASTIFY_CODES[error.code]) || 'bad_request'
	return sendProblem(reply, status, code, error.message)
}
