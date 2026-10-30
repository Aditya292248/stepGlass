import { useParams } from '@tanstack/react-router'
import { ReviewColumns } from '../components/review-columns'
import { runsFixture } from '../fixtures/runs'
import { runStatusView } from '../lib/runs'

export function RunPage() {
	const { publicId } = useParams({ from: '/runs/$publicId' })
	const run = runsFixture.find((r) => r.session.publicId === publicId)

	if (!run) {
		return (
			<div className="p-6 text-sm">
				<h1 className="font-semibold">Run not found</h1>
				<p className="mt-1 text-muted">
					No run has the ID <span className="font-mono">{publicId}</span>.
				</p>
			</div>
		)
	}

	return (
		<ReviewColumns
			header={
				<div className="border-b px-4 py-3">
					<h1 className="font-semibold text-base">{run.session.goal}</h1>
					<p className="mt-0.5 font-mono text-muted text-xs">
						run-{run.number} · {runStatusView(run).label} · {run.session.publicId}
					</p>
				</div>
			}
		/>
	)
}
