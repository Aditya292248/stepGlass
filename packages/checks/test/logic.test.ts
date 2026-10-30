import { describe, expect, it } from 'vitest'
import { and3, not3, or3, type Truth, UNKNOWN } from '../src/index.js'

const T = true
const F = false
const U: typeof UNKNOWN = UNKNOWN
const VALUES: Truth[] = [T, F, U]

describe('Kleene logic', () => {
	// Rows are the left operand, columns the right, both in the order T, F, U.
	it.each([
		['and', and3, [T, F, U, F, F, F, U, F, U]],
		['or', or3, [T, T, T, T, F, U, T, U, U]],
	] as const)('%s matches the strong Kleene truth table', (_, op, table) => {
		const actual = VALUES.flatMap((a) => VALUES.map((b) => op(a, b)))
		expect(actual).toEqual(table)
	})

	it('not keeps unknown unknown', () => {
		expect(VALUES.map(not3)).toEqual([F, T, U])
	})

	it('is variadic with identity elements for the empty case', () => {
		expect(and3()).toBe(true)
		expect(or3()).toBe(false)
		expect(and3(T, T, U, T)).toBe(U)
		expect(and3(U, U, F)).toBe(F)
		expect(or3(F, U, F)).toBe(U)
		expect(or3(U, T)).toBe(T)
	})

	it('obeys De Morgan over all inputs', () => {
		for (const a of VALUES) {
			for (const b of VALUES) {
				expect(not3(and3(a, b))).toBe(or3(not3(a), not3(b)))
			}
		}
	})
})
