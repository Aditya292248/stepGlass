import { useParams } from '@tanstack/react-router'

export function RunPage() {
	const { publicId } = useParams({ from: '/runs/$publicId' })
	return <p className="p-4 font-mono text-muted text-sm">{publicId}</p>
}
