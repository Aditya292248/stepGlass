// A neutral domain for tests: an agent recolors widget W-1. It reads it with `widget_get`, then
// writes it with `widget_update`.
import type {
	CheckBundle,
	CheckResult,
	Lesson,
	Session,
	Snapshot,
	ToolDescriptor,
	TraceEvent,
} from '../../src/index.js'

/** Deterministic UUIDv7s: `id(1)`, `id(2)`, … */
export const id = (n: number) => `0192f0a0-0000-7000-8000-${n.toString(16).padStart(12, '0')}`

export const SESSION_ID = id(1)
export const GET_ACTION = id(2)
export const UPDATE_ACTION = id(3)
export const at = (sec: number) => `2026-10-29T12:00:${String(sec).padStart(2, '0')}Z`

/** A W-1 snapshot for the update action; override fields per test. */
export const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
	id: id(200),
	actionId: UPDATE_ACTION,
	object: { type: 'widget', id: 'W-1' },
	phase: 'before',
	state: { color: 'red', count: 3 },
	capturedAt: at(3),
	source: 'in_transaction',
	...over,
})

export const beforeW1 = snap()
export const afterW1 = snap({ id: id(201), phase: 'after', state: { color: 'blue', count: 3 } })

export const session: Session = {
	schemaVersion: 1,
	id: SESSION_ID,
	publicId: 'ses_w1demo0001',
	goal: 'Recolor widget W-1',
	client: { name: 'test-client', version: '1.0.0', transport: 'sdk' },
	agent: 'widget-agent',
	startedAt: at(0),
	endedAt: at(9),
	runStatus: 'finished',
	coverage: 'tool_activity',
	dataLabel: 'sandbox',
}

const base = (n: number, sec: number) =>
	({
		schemaVersion: 1,
		id: id(100 + n),
		sessionId: SESSION_ID,
		occurredAt: at(sec),
		source: 'sdk',
		producer: { id: 'p1', seq: n },
		capture: { completeness: 'full' },
	}) as const

export const events: TraceEvent[] = [
	{ ...base(0, 0), type: 'session.started', goal: session.goal, client: session.client },
	{
		...base(1, 1),
		type: 'action.started',
		actionId: GET_ACTION,
		kind: 'tool',
		tool: { name: 'widget_get', descriptorVersion: 1 },
		input: { id: 'W-1' },
	},
	{
		...base(2, 2),
		type: 'action.finished',
		actionId: GET_ACTION,
		status: 'succeeded',
		output: { id: 'W-1', color: 'red', count: 3 },
	},
	{
		...base(3, 3),
		type: 'action.started',
		actionId: UPDATE_ACTION,
		kind: 'tool',
		tool: { name: 'widget_update' },
		input: { id: 'W-1', color: 'blue' },
	},
	{ ...base(4, 4), type: 'action.finished', actionId: UPDATE_ACTION, status: 'succeeded' },
	{ ...base(8, 4), type: 'evidence.recorded', snapshot: beforeW1 },
	{ ...base(9, 4), type: 'evidence.recorded', snapshot: afterW1 },
	{
		...base(5, 5),
		type: 'action.started',
		actionId: id(4),
		kind: 'model',
		model: { provider: 'test', name: 'm1' },
	},
	{
		...base(6, 6),
		type: 'lesson.delivered',
		lessonId: 'L-1',
		lessonVersion: 1,
		actionId: UPDATE_ACTION,
		mode: 'tool_result_note',
		text: 'Read the widget before updating it.',
	},
	{
		...base(7, 7),
		type: 'recording.gap',
		producerId: 'p1',
		fromSeq: 8,
		toSeq: 9,
		reason: 'disconnect',
	},
	{
		...base(10, 9),
		type: 'session.finished',
		status: 'finished',
		reply: { text: 'Done.', via: 'finish_session' },
	},
]

const tool = (name: string) => ({ op: 'events', where: { type: 'tool', tool: name } }) as const

export const bundle: CheckBundle = {
	schemaVersion: 1,
	id: 'widget-policy',
	version: 1,
	checks: [
		{
			schemaVersion: 1,
			id: 'count-limit',
			version: 1,
			title: 'Kept the widget count at or under 10',
			severity: 'error',
			assert: {
				op: 'lte',
				left: {
					op: 'get',
					of: {
						op: 'snapshot',
						object: { type: 'widget', id: { op: 'lit', value: 'W-1' } },
						phase: 'after',
					},
					path: ['count'],
				},
				right: { op: 'lit', value: 10 },
				measure: {
					label: 'Widget count',
					unit: 'count',
					terms: [{ label: 'Limit', value: { op: 'lit', value: 10 } }],
				},
			},
		},
		{
			schemaVersion: 1,
			id: 'read-before-write',
			version: 1,
			title: 'Read the widget before updating it',
			severity: 'warning',
			assert: { op: 'required_before', first: tool('widget_get'), second: tool('widget_update') },
		},
		{
			schemaVersion: 1,
			id: 'only-w1',
			version: 1,
			title: 'Changed only widget W-1',
			severity: 'error',
			assert: {
				op: 'only_changed',
				objects: [{ type: 'widget', id: { op: 'lit', value: 'W-1' } }],
			},
		},
	],
}

export const passResult: CheckResult = {
	schemaVersion: 1,
	id: id(300),
	sessionId: SESSION_ID,
	checkId: 'count-limit',
	checkVersion: 1,
	outcome: 'pass',
	reasons: [{ code: 'within_limit', message: 'Count 3 is at most 10.', eventIds: [id(109)] }],
	measurement: { value: 3, limit: 10, unit: 'count', terms: [{ label: 'Limit', value: 10 }] },
	evaluatedThroughSeq: 10,
	evaluatedAt: at(9),
}

export const widgetGet: ToolDescriptor = {
	schemaVersion: 1,
	tool: 'widget_get',
	version: 1,
	kind: 'read',
	title: 'Looked up widget {input.id|id}',
	fields: { 'input.id': { label: 'Widget', format: 'id' } },
	verification: 'none',
	capture: { input: 'full', output: 'full' },
}

export const widgetUpdate: ToolDescriptor = {
	schemaVersion: 1,
	tool: 'widget_update',
	version: 1,
	kind: 'write',
	title: 'Recolored {input.id} from {before.color} to {after.color}',
	description: 'Count stays {{unchanged}} at {after.count|integer}',
	object: { type: 'widget', idPath: 'input.id', label: 'Widget {input.id}' },
	fields: {
		'before.color': { label: 'Old color', format: 'text' },
		'after.color': { label: 'New color', format: 'text' },
		'after.count': { label: 'Count', format: 'integer', computed: true },
	},
	verification: 'in_transaction',
	capture: { input: 'full', output: 'metadata_only' },
}

export const lesson: Lesson = {
	schemaVersion: 1,
	id: 'L-1',
	version: 1,
	text: 'Read the widget before updating it.',
	source: { checkId: 'read-before-write', sessionId: SESSION_ID },
	condition: {
		tool: 'widget_update',
		when: {
			op: 'eq',
			left: { op: 'var', name: 'agent' },
			right: { op: 'lit', value: 'widget-agent' },
		},
	},
	scope: { agent: 'widget-agent' },
	delivery: { mode: 'pre_call_guard', attachTo: 'widget_update' },
	status: 'active',
	createdAt: at(9),
}
