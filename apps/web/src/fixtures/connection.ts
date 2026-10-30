import type { StatusBarProps } from '../components/status-bar'

/** Stands in for the live connection state until the API exists. */
export const connectionFixture: StatusBarProps = {
	client: { name: 'demo-client', version: '0.1.0', transport: 'stdio' },
	connected: true,
	dataLabel: 'sandbox',
}
