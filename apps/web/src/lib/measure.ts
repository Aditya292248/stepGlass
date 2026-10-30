import type { CheckResult } from '@stepglass/schema'

export type Measurement = NonNullable<CheckResult['measurement']>
export type MeasureUnit = Measurement['unit']

/** Shown wherever a number was not recorded, so "missing" never reads as zero. */
export const MISSING = '—'

function minorUnitDigits(currency: string, locale?: string): number {
	return (
		new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions()
			.maximumFractionDigits ?? 2
	)
}

/**
 * Formats an integer policy number for display. Money arrives in minor units (cents) and
 * percentages in basis points, so this is the one place they are scaled back.
 */
export function formatMeasure(
	value: number | undefined,
	unit: MeasureUnit,
	opts: { currency?: string; locale?: string } = {},
): string {
	if (value === undefined || !Number.isFinite(value)) return MISSING
	const { currency, locale } = opts
	switch (unit) {
		case 'count':
			return new Intl.NumberFormat(locale).format(value)
		case 'basis_points':
			return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(
				value / 10_000,
			)
		case 'currency_minor':
			if (!currency) return `${new Intl.NumberFormat(locale).format(value)} (minor units)`
			return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
				value / 10 ** minorUnitDigits(currency, locale),
			)
	}
}

/** "150 earlier + 90 now = 240"; just the total when there are no terms. */
export function formatEquation(measurement: Measurement, locale?: string): string {
	const fmt = (v: number) =>
		formatMeasure(v, measurement.unit, { currency: measurement.currency, locale })
	const total = fmt(measurement.value)
	if (measurement.terms.length === 0) return total
	const sum = measurement.terms
		.map((term, i) => {
			const text = `${fmt(Math.abs(term.value))} ${term.label}`
			if (i === 0) return term.value < 0 ? `−${text}` : text
			return `${term.value < 0 ? '−' : '+'} ${text}`
		})
		.join(' ')
	return `${sum} = ${total}`
}
