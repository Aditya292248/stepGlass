import { SessionSchema, SessionTokenSchema } from '@stepglass/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { actionStarted, createHarness, type Harness, sessionInput } from './fixtures.js'

let h: Harness

beforeAll(async () => {
	h = await createHarness()
})
afterAll(() => h.close())

async function create(goal = sessionInput.goal) {
	const res = await h.app.inject({
		method: 'POST',
		url: '/v1/sessions',
		payload: { ...sessionInput, goal },
	})
	expect(res.statusCode, res.body).toBe(201)
	return res
}

describe('POST /v1/sessions', () => {
	it('returns the session and its token once', async () => {
		const res = await create()
		expect(res.headers['cache-control']).toBe('no-store')
		const { session, token } = res.json()
		expect(SessionTokenSchema.safeParse(token).success).toBe(true)
		expect(SessionSchema.parse(session)).toMatchObject({
			goal: sessionInput.goal,
			runStatus: 'running',
			publicId: expect.stringMatching(/^ses_[0-9a-z]{16}$/),
		})
		const read = await h.app.inject({ method: 'GET', url: `/v1/sessions/${session.publicId}` })
		expect(read.json()).toEqual(session)
		expect(read.body).not.toContain(token)
	})

	it('validates the body as problem+json', async () => {
		const res = await h.app.inject({
			method: 'POST',
			url: '/v1/sessions',
			payload: { ...sessionInput, coverage: 'everything', token: 'sgt_sneaky' },
		})
		expect(res.statusCode).toBe(400)
		expect(res.headers['content-type']).toMatch(/^application\/problem\+json/)
		expect(res.json()).toMatchObject({ type: 'about:blank', title: 'Bad Request', status: 400 })
		expect(res.json().errors.length).toBeGreaterThan(0)
	})
})

describe('GET /v1/sessions/:publicId', () => {
	it('404s for an unknown ID and 400s for a malformed one', async () => {
		const missing = await h.app.inject({ method: 'GET', url: '/v1/sessions/ses_doesnotexist00' })
		expect(missing.statusCode).toBe(404)
		expect(missing.json()).toMatchObject({ code: 'session_not_found' })
		const bad = await h.app.inject({ method: 'GET', url: '/v1/sessions/nope' })
		expect(bad.statusCode).toBe(400)
	})
})

describe('GET /v1/sessions', () => {
	it('pages newest first with an opaque cursor and no overlap', async () => {
		const goals = Array.from({ length: 5 }, (_, i) => `paging goal ${i}`)
		for (const goal of goals) await create(goal)

		const seen: string[] = []
		let cursor: string | null = null
		let pages = 0
		do {
			const query = cursor ? `?limit=2&cursor=${cursor}` : '?limit=2'
			const res = await h.app.inject({ method: 'GET', url: `/v1/sessions${query}` })
			expect(res.statusCode).toBe(200)
			const page: { items: { goal: string }[]; nextCursor: string | null } = res.json()
			expect(page.items.length).toBeLessThanOrEqual(2)
			seen.push(...page.items.map((s) => s.goal))
			cursor = page.nextCursor
			pages += 1
		} while (cursor && pages < 20)

		const paging = seen.filter((g) => g.startsWith('paging goal'))
		expect(paging).toEqual([...goals].reverse())
		expect(new Set(seen).size).toBe(seen.length)
	})

	it('rejects a malformed cursor and an out-of-range limit', async () => {
		const cursor = await h.app.inject({ method: 'GET', url: '/v1/sessions?cursor=%%%' })
		expect(cursor.statusCode).toBe(400)
		const limit = await h.app.inject({ method: 'GET', url: '/v1/sessions?limit=1000' })
		expect(limit.statusCode).toBe(400)
	})
})

describe('GET /v1/sessions/:publicId/events', () => {
	it('returns events in seq order after the given seq', async () => {
		const { session, token } = (await create()).json()
		const events = [0, 1, 2, 3].map((i) => actionStarted(session.id, i))
		const ingest = await h.app.inject({
			method: 'POST',
			url: '/v1/sessions/events',
			headers: { authorization: `Bearer ${token}` },
			payload: { events },
		})
		expect(ingest.statusCode).toBe(200)

		const url = `/v1/sessions/${session.publicId}/events`
		const all = (await h.app.inject({ method: 'GET', url })).json()
		expect(all.items.map((i: { seq: number }) => i.seq)).toEqual([1, 2, 3, 4])
		expect(all.items.map((i: { event: { id: string } }) => i.event.id)).toEqual(
			events.map((e) => e.id),
		)
		expect(all.nextAfterSeq).toBe(4)

		const tail = (await h.app.inject({ method: 'GET', url: `${url}?after_seq=2&limit=1` })).json()
		expect(tail.items.map((i: { seq: number }) => i.seq)).toEqual([3])
		expect(tail.nextAfterSeq).toBe(3)

		const none = (await h.app.inject({ method: 'GET', url: `${url}?after_seq=4` })).json()
		expect(none).toEqual({ items: [], nextAfterSeq: 4 })
	})

	it('404s for an unknown session', async () => {
		const res = await h.app.inject({ method: 'GET', url: '/v1/sessions/ses_doesnotexist00/events' })
		expect(res.statusCode).toBe(404)
	})
})

describe('GET /healthz', () => {
	it('reports ok when the database answers', async () => {
		const res = await h.app.inject({ method: 'GET', url: '/healthz' })
		expect(res.statusCode).toBe(200)
		expect(res.json()).toEqual({ status: 'ok' })
	})
})

describe('unknown routes', () => {
	it('answer with problem+json', async () => {
		const res = await h.app.inject({ method: 'GET', url: '/v1/nothing' })
		expect(res.statusCode).toBe(404)
		expect(res.headers['content-type']).toMatch(/^application\/problem\+json/)
		expect(res.json()).toMatchObject({ status: 404, code: 'not_found', title: 'Not Found' })
	})
})
