import type { ClientInfo, Session } from '@stepglass/schema'
import { cn } from '../lib/utils'

export interface StatusBarProps {
	client: ClientInfo
	connected: boolean
	dataLabel: Session['dataLabel']
}

const TRANSPORT_LABEL: Record<ClientInfo['transport'], string> = {
	stdio: 'MCP',
	http: 'MCP',
	sdk: 'SDK',
	otlp: 'OTLP',
}

export function StatusBar({ client, connected, dataLabel }: StatusBarProps) {
	const via = TRANSPORT_LABEL[client.transport]
	return (
		<footer className="flex h-7 shrink-0 items-center justify-between gap-3 border-t px-3 text-muted text-xs">
			<span role="status" className="flex min-w-0 items-center gap-1.5 truncate">
				<span aria-hidden="true" className={cn(connected ? 'text-pass' : 'text-fail')}>
					●
				</span>
				{connected ? 'Connected to' : 'Disconnected from'}{' '}
				<span className="font-mono">{client.name}</span> ({via})
			</span>
			<span className={cn('shrink-0', dataLabel === 'live' && 'font-medium text-warn')}>
				{dataLabel === 'live' ? 'Live data' : 'Sandbox data'}
			</span>
		</footer>
	)
}
