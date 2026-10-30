// Dev-only gallery of the UI primitives, at /_primitives. Not part of the production build.
import type { ReactNode } from 'react'
import { useState } from 'react'
import { EvidenceTag, type EvidenceTagKind } from '../components/evidence-tag'
import { ThresholdGauge } from '../components/threshold-gauge'
import { ToolChip } from '../components/tool-chip'

const KINDS: EvidenceTagKind[] = [
	'verified',
	'lesson',
	'agent_claim',
	'missing',
	'recorded',
	'unknown',
]

function Group({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-3">
			<h2 className="font-semibold text-[11px] text-muted uppercase tracking-[0.08em]">{title}</h2>
			{children}
		</section>
	)
}

export function PrimitivesPage() {
	const [selected, setSelected] = useState<string | null>(null)
	return (
		<div className="flex max-w-3xl flex-col gap-8 p-6">
			<h1 className="font-semibold text-lg">Primitives</h1>
			<Group title="Evidence tags">
				<div className="flex flex-wrap gap-2">
					{KINDS.map((kind) => (
						<EvidenceTag key={kind} kind={kind} />
					))}
				</div>
			</Group>
			<Group title="Tool chips">
				<div className="flex flex-wrap items-center gap-2">
					{['widget_get', 'widget_update', 'widget_archive'].map((name) => (
						<ToolChip key={name} name={name} onSelect={setSelected} />
					))}
					<span className="text-muted text-xs">
						{selected ? `Selected @${selected}` : 'Nothing selected'}
					</span>
				</div>
			</Group>
			<Group title="Threshold gauges">
				<div className="grid gap-4 sm:grid-cols-2">
					<ThresholdGauge
						label="Widgets changed"
						measurement={{
							value: 240,
							limit: 200,
							unit: 'count',
							terms: [
								{ label: 'earlier', value: 150 },
								{ label: 'now', value: 90 },
							],
						}}
					/>
					<ThresholdGauge
						label="Spend on widget parts"
						approvalAt={10_000}
						measurement={{
							value: 12_500,
							limit: 25_000,
							unit: 'currency_minor',
							currency: 'EUR',
							terms: [
								{ label: 'earlier', value: 8_000 },
								{ label: 'now', value: 4_500 },
							],
						}}
					/>
					<ThresholdGauge
						label="Share of widgets recolored"
						measurement={{ value: 1_250, limit: 2_500, unit: 'basis_points', terms: [] }}
					/>
					<ThresholdGauge label="Widgets archived" />
				</div>
			</Group>
		</div>
	)
}
