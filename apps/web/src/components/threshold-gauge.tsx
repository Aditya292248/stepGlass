import { formatEquation, formatMeasure, type Measurement, MISSING } from '../lib/measure'
import { cn } from '../lib/utils'

export interface ThresholdGaugeProps {
	label: string
	/** Absent when the check could not compute a number; the gauge then shows "—". */
	measurement?: Measurement
	/** Value from which a human has to approve, in the measurement's unit. */
	approvalAt?: number
	locale?: string
}

/** Leaves headroom past the furthest marker so it never sits on the track's edge. */
const HEADROOM = 1.15

/**
 * A value against its limit: the sum that produced it, a bar, a limit marker and an optional
 * approval marker. Every state is also spelled out in text, never only by colour.
 */
export function ThresholdGauge({ label, measurement, approvalAt, locale }: ThresholdGaugeProps) {
	if (!measurement) {
		return (
			<figure className="flex flex-col gap-2 rounded-lg border bg-raised p-3">
				<figcaption className="text-muted text-xs">{label}</figcaption>
				<p className="font-mono text-lg">{MISSING}</p>
				<div className="h-2 rounded-full bg-border/60" />
				<p className="text-muted text-xs">No measurement recorded</p>
			</figure>
		)
	}

	const { value, limit, unit, currency } = measurement
	const fmt = (v: number) => formatMeasure(v, unit, { currency, locale })
	const scale = Math.max(limit, value, approvalAt ?? 0, 1) * HEADROOM
	const pct = (v: number) => `${(Math.max(0, v) / scale) * 100}%`
	const over = value > limit
	const needsApproval = approvalAt !== undefined && value >= approvalAt
	const tone = over ? 'fail' : needsApproval ? 'warn' : 'pass'
	const verdict = over
		? `Over the limit by ${fmt(value - limit)}`
		: value === limit
			? 'At the limit'
			: `${fmt(limit - value)} under the limit`

	return (
		<figure className="flex flex-col gap-2 rounded-lg border bg-raised p-3">
			<figcaption className="text-muted text-xs">{label}</figcaption>
			<p className="font-mono text-sm" data-testid="gauge-equation">
				{formatEquation(measurement, locale)}
			</p>
			{/* biome-ignore lint/a11y/useSemanticElements: a native <meter> cannot hold the limit and approval markers */}
			<div
				role="meter"
				aria-label={label}
				aria-valuemin={0}
				aria-valuemax={scale}
				aria-valuenow={value}
				aria-valuetext={`${fmt(value)} of a ${fmt(limit)} limit`}
				className={cn(
					'relative mt-5 h-2 rounded-full bg-border/60',
					approvalAt === undefined ? 'mb-1' : 'mb-6',
				)}
			>
				<div
					className={cn('h-full rounded-full', {
						'bg-pass': tone === 'pass',
						'bg-warn': tone === 'warn',
						'bg-fail': tone === 'fail',
					})}
					style={{ width: pct(value) }}
				/>
				<Marker at={pct(limit)} text={`Limit ${fmt(limit)}`} className="bg-text" />
				{approvalAt !== undefined && (
					<Marker
						at={pct(approvalAt)}
						text={`Approval ${fmt(approvalAt)}`}
						className="bg-warn"
						below
					/>
				)}
			</div>
			<p
				className={cn('text-xs', {
					'text-fail': tone === 'fail',
					'text-warn': tone === 'warn',
					'text-muted': tone === 'pass',
				})}
			>
				{verdict}
				{needsApproval && !over && ' · needs approval'}
			</p>
		</figure>
	)
}

function Marker({
	at,
	text,
	className,
	below = false,
}: {
	at: string
	text: string
	className: string
	below?: boolean
}) {
	return (
		<div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: at }}>
			<div className={cn('h-4 w-0.5 rounded', className)} />
			<span
				className={cn(
					'absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] text-muted',
					below ? 'top-5' : '-top-5',
				)}
			>
				{text}
			</span>
		</div>
	)
}
