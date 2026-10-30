import type { EvidenceLabel } from '@stepglass/schema'
import { cn } from '../lib/utils'

export type EvidenceTagKind =
	| 'verified'
	| 'lesson'
	| 'agent_claim'
	| 'missing'
	| 'recorded'
	| 'unknown'

const TAGS: Record<EvidenceTagKind, { text: string; glyph: string; hint: string; tone: string }> = {
	verified: {
		text: 'Verified',
		glyph: '✓',
		hint: 'Before and after state were captured independently of the tool',
		tone: 'border-pass/40 bg-pass/10 text-pass',
	},
	lesson: {
		text: 'Lesson',
		glyph: '✦',
		hint: 'A saved lesson applied to this step',
		tone: 'border-accent/40 bg-accent/10 text-accent',
	},
	agent_claim: {
		text: 'Agent claim',
		glyph: '“',
		hint: 'Only the tool or agent says this happened',
		tone: 'border-warn/40 bg-warn/10 text-warn',
	},
	missing: {
		text: 'Missing',
		glyph: '✕',
		hint: 'Expected evidence was not recorded',
		tone: 'border-fail/40 bg-fail/10 text-fail',
	},
	recorded: {
		text: 'Recorded',
		glyph: '●',
		hint: 'The call was recorded; it changes nothing that needs verifying',
		tone: 'border-border bg-surface text-muted',
	},
	unknown: {
		text: 'Unknown',
		glyph: '?',
		hint: 'There is not enough evidence to say what happened',
		tone: 'border-unknown/40 bg-unknown/10 text-unknown',
	},
}

/** Maps the schema's evidence label to the tag a reviewer sees. */
export function evidenceTagKind(label: EvidenceLabel): EvidenceTagKind {
	switch (label) {
		case 'verified_in_transaction':
		case 'verified_read_back':
			return 'verified'
		case 'reported':
			return 'agent_claim'
		case 'recorded':
			return 'recorded'
		case 'unknown':
			return 'unknown'
	}
}

/** A small label for how much to trust a step. The text always carries the meaning. */
export function EvidenceTag({ kind, className }: { kind: EvidenceTagKind; className?: string }) {
	const tag = TAGS[kind]
	return (
		<span
			title={tag.hint}
			className={cn(
				'inline-flex h-5 items-center gap-1 rounded border px-1.5 font-medium text-[11px] leading-none',
				tag.tone,
				className,
			)}
		>
			<span aria-hidden="true">{tag.glyph}</span>
			{tag.text}
		</span>
	)
}
