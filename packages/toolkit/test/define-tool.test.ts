import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineTool, ToolInputError, ToolOutputError } from '../src/index.js'
import {
	as,
	getWidget,
	getWidgetDescriptor,
	parsed,
	recorder,
	types,
	type Widget,
} from './fixtures/widget.js'

const widgets = () => new Map<string, Widget>([['W-1', { id: 'W-1', color: 'red', count: 3 }]])

describe('recording a call', () => {
	it('records started and finished with input, output and descriptor version', async () => {
		const rec = recorder()
		const out = await getWidget(widgets()).call({ id: 'W-1' }, { recorder: rec })
		expect(out).toMatchObject({ id: 'W-1', color: 'red' })

		const [started, finished] = parsed(rec.events)
		expect(types(rec.events)).toEqual(['action.started', 'action.finished'])
		const s = as(started, 'action.started')
		expect(s).toMatchObject({
			kind: 'tool',
			tool: { name: 'get_widget', descriptorVersion: 2 },
			input: { id: 'W-1' },
			capture: { completeness: 'full' },
		})
		const f = as(finished, 'action.finished')
		expect(f.actionId).toBe(s.actionId)
		expect(f.status).toBe('succeeded')
		expect(f.output).toMatchObject({ id: 'W-1', color: 'red', count: 3 })
		expect(rec.events.map((e) => e.producer.seq)).toEqual([0, 1])
	})

	it('records a failure with its error and rethrows it', async () => {
		const rec = recorder()
		const call = getWidget(widgets()).call({ id: 'W-9' }, { recorder: rec })
		await expect(call).rejects.toThrow('no widget W-9')
		const f = as(parsed(rec.events)[1], 'action.finished')
		expect(f).toMatchObject({
			status: 'failed',
			error: { message: 'no widget W-9', code: 'not_found' },
		})
		expect(f.output).toBeUndefined()
	})

	it('records invalid input as a failed call, keeping what the model sent', async () => {
		const rec = recorder()
		const call = getWidget(widgets()).call({ id: 7 }, { recorder: rec })
		await expect(call).rejects.toBeInstanceOf(ToolInputError)
		const [s, f] = parsed(rec.events)
		expect(as(s, 'action.started').input).toEqual({ id: 7 })
		expect(as(f, 'action.finished')).toMatchObject({
			status: 'failed',
			error: { code: 'invalid_input' },
		})
	})

	it('records an output that fails the output schema as a failed call', async () => {
		const tool = defineTool({
			name: 'get_widget',
			description: 'Look up a widget by ID.',
			input: z.object({ id: z.string() }),
			output: z.object({ color: z.string() }),
			descriptor: getWidgetDescriptor,
			run: async () => ({ color: 5 }) as unknown as { color: string },
		})
		const rec = recorder()
		await expect(tool.call({ id: 'W-1' }, { recorder: rec })).rejects.toBeInstanceOf(
			ToolOutputError,
		)
		expect(as(parsed(rec.events)[1], 'action.finished').error?.code).toBe('invalid_output')
	})

	it('records an abort during the run as cancelled and rejects with the abort reason', async () => {
		const rec = recorder()
		const controller = new AbortController()
		const call = getWidget(widgets(), { hang: true }).call(
			{ id: 'W-1' },
			{ recorder: rec, signal: controller.signal },
		)
		controller.abort(new Error('client went away'))
		await expect(call).rejects.toThrow('client went away')
		const f = as(parsed(rec.events)[1], 'action.finished')
		expect(f.status).toBe('cancelled')
		expect(f.error).toBeUndefined()
	})

	it('records nothing when the signal is already aborted', async () => {
		const rec = recorder()
		const call = getWidget(widgets()).call(
			{ id: 'W-1' },
			{ recorder: rec, signal: AbortSignal.abort() },
		)
		await expect(call).rejects.toThrow()
		expect(rec.events).toEqual([])
	})
})

describe('capture policy', () => {
	it('removes sensitive input and output fields and lists them', async () => {
		const rec = recorder()
		const out = await getWidget(widgets()).call(
			{ id: 'W-1', accessCode: '1234' },
			{ recorder: rec },
		)
		// The caller still gets the full result; only the recording is redacted.
		expect(out).toMatchObject({ owner: { email: 'owner@example.test' } })
		const [s, f] = parsed(rec.events)
		expect(as(s, 'action.started')).toMatchObject({
			input: { id: 'W-1' },
			capture: { completeness: 'redacted', omittedFields: ['input.accessCode'] },
		})
		expect(as(s, 'action.started').input).not.toHaveProperty('accessCode')
		expect(as(f, 'action.finished')).toMatchObject({
			output: { owner: { name: 'Owner' } },
			capture: { completeness: 'redacted', omittedFields: ['output.owner.email'] },
		})
		expect(JSON.stringify(rec.events)).not.toMatch(/1234|owner@example/)
	})

	it('only lists sensitive fields that were actually present', async () => {
		const rec = recorder()
		await getWidget(widgets()).call({ id: 'W-1' }, { recorder: rec })
		expect(as(rec.events[0], 'action.started').capture).toEqual({ completeness: 'full' })
	})

	it('omits payloads captured as metadata_only', async () => {
		const tool = defineTool({
			name: 'get_widget',
			description: 'Look up a widget by ID.',
			input: z.object({ id: z.string() }),
			descriptor: {
				...getWidgetDescriptor,
				capture: { input: 'metadata_only', output: 'metadata_only' },
			},
			run: async ({ id }) => ({ id }),
		})
		const rec = recorder()
		expect(await tool.call({ id: 'W-1' }, { recorder: rec })).toEqual({ id: 'W-1' })
		const [s, f] = parsed(rec.events)
		expect(as(s, 'action.started').input).toBeUndefined()
		expect(s?.capture).toEqual({ completeness: 'metadata_only', omittedFields: ['input'] })
		expect(as(f, 'action.finished').output).toBeUndefined()
		expect(f?.capture).toEqual({ completeness: 'metadata_only', omittedFields: ['output'] })
	})
})

describe('definition', () => {
	it('rejects a descriptor for another tool and an invalid descriptor', () => {
		const base = {
			description: 'x',
			input: z.object({}),
			run: async () => null,
		}
		expect(() =>
			defineTool({ ...base, name: 'get_gadget', descriptor: getWidgetDescriptor }),
		).toThrow('descriptor is for "get_widget"')
		expect(() =>
			defineTool({
				...base,
				name: 'get_widget',
				descriptor: { ...getWidgetDescriptor, title: 'Looked up {input.nope}' },
			}),
		).toThrow('undeclared field')
	})
})
