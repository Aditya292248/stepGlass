import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EvidenceTag, type EvidenceTagKind, evidenceTagKind } from '../src/components/evidence-tag'
import { ThresholdGauge } from '../src/components/threshold-gauge'
import { ToolChip } from '../src/components/tool-chip'
import { formatEquation, formatMeasure, type Measurement } from '../src/lib/measure'
import { renderApp } from './render'

// Pinned locale so separators and currency symbols are stable across machines.
const locale = 'en-US'

const count: Measurement = {
	value: 240,
	limit: 200,
	unit: 'count',
	terms: [
		{ label: 'earlier', value: 150 },
		{ label: 'now', value: 90 },
	],
}

describe('formatMeasure', () => {
	it('formats counts with grouping', () => {
		expect(formatMeasure(1_234_567, 'count', { locale })).toBe('1,234,567')
	})

	it('scales minor currency units by the currency’s own digits', () => {
		expect(formatMeasure(12_345, 'currency_minor', { currency: 'USD', locale })).toBe('$123.45')
		expect(formatMeasure(500, 'currency_minor', { currency: 'JPY', locale })).toBe('¥500')
		// ICU separates a currency code from the amount with a no-break space.
		expect(formatMeasure(1_234, 'currency_minor', { currency: 'KWD', locale })).toBe('KWD 1.234')
	})

	it('falls back to raw minor units without a currency', () => {
		expect(formatMeasure(250, 'currency_minor', { locale })).toBe('250 (minor units)')
	})

	it('turns basis points into percentages', () => {
		expect(formatMeasure(250, 'basis_points', { locale })).toBe('2.5%')
		expect(formatMeasure(10_000, 'basis_points', { locale })).toBe('100%')
		expect(formatMeasure(1, 'basis_points', { locale })).toBe('0.01%')
	})

	it('shows a dash for absent values', () => {
		expect(formatMeasure(undefined, 'count')).toBe('—')
		expect(formatMeasure(Number.NaN, 'basis_points')).toBe('—')
	})
})

describe('formatEquation', () => {
	it('sums the terms into the value', () => {
		expect(formatEquation(count, locale)).toBe('150 earlier + 90 now = 240')
	})

	it('writes negative terms as subtraction', () => {
		const m: Measurement = {
			...count,
			value: 130,
			terms: [
				{ label: 'earlier', value: 150 },
				{ label: 'returned', value: -20 },
			],
		}
		expect(formatEquation(m, locale)).toBe('150 earlier − 20 returned = 130')
	})

	it('is just the value without terms', () => {
		expect(formatEquation({ ...count, terms: [] }, locale)).toBe('240')
	})
})

describe('ThresholdGauge', () => {
	it('renders the sum, the limit and an over-limit verdict in text', () => {
		render(<ThresholdGauge label="Widgets changed" measurement={count} locale={locale} />)
		expect(screen.getByTestId('gauge-equation')).toHaveTextContent('150 earlier + 90 now = 240')
		expect(screen.getByText('Limit 200')).toBeInTheDocument()
		expect(screen.getByText('Over the limit by 40')).toBeInTheDocument()
		const meter = screen.getByRole('meter', { name: 'Widgets changed' })
		expect(meter).toHaveAttribute('aria-valuenow', '240')
		expect(meter).toHaveAttribute('aria-valuetext', '240 of a 200 limit')
	})

	it('shows the approval marker and says when approval is needed', () => {
		render(
			<ThresholdGauge
				label="Spend"
				approvalAt={10_000}
				locale={locale}
				measurement={{
					value: 12_500,
					limit: 25_000,
					unit: 'currency_minor',
					currency: 'USD',
					terms: [],
				}}
			/>,
		)
		expect(screen.getByText('Approval $100.00')).toBeInTheDocument()
		expect(screen.getByText('$125.00 under the limit · needs approval')).toBeInTheDocument()
	})

	it('shows a dash when there is no measurement', () => {
		render(<ThresholdGauge label="Widgets archived" />)
		expect(screen.getByText('—')).toBeInTheDocument()
		expect(screen.getByText('No measurement recorded')).toBeInTheDocument()
		expect(screen.queryByRole('meter')).not.toBeInTheDocument()
	})
})

describe('EvidenceTag', () => {
	const texts: Record<EvidenceTagKind, string> = {
		verified: 'Verified',
		lesson: 'Lesson',
		agent_claim: 'Agent claim',
		missing: 'Missing',
		recorded: 'Recorded',
		unknown: 'Unknown',
	}

	it.each(Object.entries(texts))('spells out %s', (kind, text) => {
		render(<EvidenceTag kind={kind as EvidenceTagKind} />)
		expect(screen.getByText(text)).toBeInTheDocument()
	})

	it('maps schema evidence labels', () => {
		expect(evidenceTagKind('verified_in_transaction')).toBe('verified')
		expect(evidenceTagKind('verified_read_back')).toBe('verified')
		expect(evidenceTagKind('reported')).toBe('agent_claim')
		expect(evidenceTagKind('recorded')).toBe('recorded')
		expect(evidenceTagKind('unknown')).toBe('unknown')
	})
})

describe('ToolChip', () => {
	it('is a button that reports its tool name', () => {
		const onSelect = vi.fn()
		render(<ToolChip name="widget_update" onSelect={onSelect} />)
		fireEvent.click(screen.getByRole('button', { name: '@widget_update' }))
		expect(onSelect).toHaveBeenCalledWith('widget_update')
	})
})

describe('primitives route', () => {
	it('renders the gallery in development', async () => {
		await renderApp('/_primitives')
		expect(await screen.findByRole('heading', { name: 'Primitives' })).toBeInTheDocument()
	})
})
