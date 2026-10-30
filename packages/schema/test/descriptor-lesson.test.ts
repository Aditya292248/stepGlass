import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import {
	CONTRACTS,
	exportJsonSchemas,
	LessonNoteSchema,
	LessonSchema,
	parseTemplate,
	ToolDescriptorSchema,
	templateFields,
} from '../src/index.js'
import { lesson, widgetGet, widgetUpdate } from './fixtures/widget.js'

const roundTrip = (schema: z.ZodType, value: unknown) =>
	expect(schema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value)
const invalid = (schema: z.ZodType, value: unknown) =>
	expect(schema.safeParse(value).success).toBe(false)

describe('templates', () => {
	it('parses placeholders, formats and escaped braces', () => {
		expect(parseTemplate('Set {{x} to {after.n|integer} ({input.id})')).toEqual({
			ok: true,
			segments: [
				{ kind: 'text', text: 'Set {x} to ' },
				{ kind: 'field', path: 'after.n', format: 'integer' },
				{ kind: 'text', text: ' (' },
				{ kind: 'field', path: 'input.id' },
				{ kind: 'text', text: ')' },
			],
		})
		expect(templateFields(widgetUpdate.title)).toEqual(['input.id', 'before.color', 'after.color'])
	})

	it.each([
		['unterminated', 'Hi {input.id', 'unterminated placeholder'],
		['empty path', 'Hi {}', 'empty field path'],
		['empty path with format', 'Hi {|text}', 'empty field path'],
		['bad root', 'Hi {state.x}', 'invalid field path "state.x"'],
		['expression', 'Hi {input.a + 1}', 'invalid field path "input.a + 1"'],
		['unknown format', 'Hi {input.a|upper}', 'unknown format "upper"'],
		['two formats', 'Hi {input.a|text|id}', 'only one |format is allowed'],
	])('rejects %s', (_, t, message) => {
		expect(parseTemplate(t)).toEqual({ ok: false, errors: [{ index: 3, message }] })
	})
})

describe('tool descriptors', () => {
	it('round-trip', () => {
		roundTrip(ToolDescriptorSchema, widgetGet)
		roundTrip(ToolDescriptorSchema, widgetUpdate)
	})

	it('rejects a write without an object', () => {
		invalid(ToolDescriptorSchema, { ...widgetUpdate, object: undefined })
	})

	it('rejects verification none on a write', () => {
		invalid(ToolDescriptorSchema, { ...widgetUpdate, verification: 'none' })
	})

	it('rejects a template that references an undeclared field', () => {
		invalid(ToolDescriptorSchema, { ...widgetGet, title: 'Got {output.secret}' })
		invalid(ToolDescriptorSchema, { ...widgetGet, title: 'Got {input.id' })
	})

	it('rejects a malformed field path key', () => {
		invalid(ToolDescriptorSchema, { ...widgetGet, fields: { id: { label: 'x', format: 'id' } } })
	})
})

describe('lessons', () => {
	it('round-trip', () => roundTrip(LessonSchema, lesson))

	it('rejects pre_call_guard attached to a different tool', () => {
		invalid(LessonSchema, {
			...lesson,
			delivery: { mode: 'pre_call_guard', attachTo: 'widget_get' },
		})
		const note = { ...lesson, delivery: { mode: 'tool_result_note', attachTo: 'widget_get' } }
		expect(LessonSchema.safeParse(note).success).toBe(true)
	})

	it('validates the note shape appended to tool results', () => {
		roundTrip(LessonNoteSchema, {
			stepglass_note: { lesson_id: 'L-1', lesson_version: 1, text: 'x' },
		})
		invalid(LessonNoteSchema, {
			stepglass_note: { lesson_id: 'L-1', lesson_version: 1, text: 'x', do: 1 },
		})
	})
})

describe('JSON Schema export', () => {
	it('converts every contract', () => {
		const schemas = exportJsonSchemas()
		expect(Object.keys(schemas)).toEqual(Object.keys(CONTRACTS))
		for (const s of Object.values(schemas)) expect(s).toMatchObject({ $schema: expect.any(String) })
	})
})
