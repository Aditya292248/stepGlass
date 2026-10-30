/**
 * The third truth value. A symbol rather than a string so it can never collide with a JSON value
 * read from evidence (a recorded `"unknown"` string is just a string).
 */
export const UNKNOWN: unique symbol = Symbol('unknown')
/** See {@link UNKNOWN}. */
export type Unknown = typeof UNKNOWN

/** Kleene's strong three-valued logic: `unknown` means "the evidence does not decide this". */
export type Truth = boolean | Unknown

/** False dominates: one false operand decides, whatever the others are. */
export function and3(...args: readonly Truth[]): Truth {
	if (args.includes(false)) return false
	return args.includes(UNKNOWN) ? UNKNOWN : true
}

/** True dominates: one true operand decides, whatever the others are. */
export function or3(...args: readonly Truth[]): Truth {
	if (args.includes(true)) return true
	return args.includes(UNKNOWN) ? UNKNOWN : false
}

/** Negation keeps `unknown` unknown; it never turns missing evidence into a decision. */
export function not3(a: Truth): Truth {
	return a === UNKNOWN ? UNKNOWN : !a
}
