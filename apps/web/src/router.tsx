import { QueryClient } from '@tanstack/react-query'
import {
	createRootRouteWithContext,
	createRoute,
	createRouter,
	type RouterHistory,
} from '@tanstack/react-router'
import { IndexPage } from './routes/index'
import { RootLayout } from './routes/root'
import { RunPage } from './routes/run'

export interface RouterContext {
	queryClient: QueryClient
}

const rootRoute = createRootRouteWithContext<RouterContext>()({ component: RootLayout })

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: IndexPage })

export const runRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/runs/$publicId',
	component: RunPage,
})

const routeTree = rootRoute.addChildren([indexRoute, runRoute])

export function createQueryClient(): QueryClient {
	return new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })
}

/** `history` is injectable so tests can start at any URL with a memory history. */
export function createAppRouter(opts: { queryClient: QueryClient; history?: RouterHistory }) {
	return createRouter({
		routeTree,
		context: { queryClient: opts.queryClient },
		history: opts.history,
		defaultPreload: 'intent',
	})
}

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof createAppRouter>
	}
}
