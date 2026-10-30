import { useParams } from '@tanstack/react-router'
import { ReviewColumns } from '../components/review-columns'

export function RunPage() {
	const { publicId } = useParams({ from: '/runs/$publicId' })
	return (
		<ReviewColumns
			header={
				<div className="border-b px-4 py-3">
					<p className="font-mono text-muted text-xs">{publicId}</p>
				</div>
			}
		/>
	)
}
