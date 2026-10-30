import { QueryClient } from '@tanstack/react-query'
import {
	createRootRouteWithContext,
	createRoute,
	createRouter,
	lazyRouteComponent,
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

// Dev-only gallery. `import.meta.env.DEV` is a build-time constant, so production bundles drop
// both the route and the lazily imported page.
const devRoutes = import.meta.env.DEV
	? [
			createRoute({
				getParentRoute: () => rootRoute,
				path: '/_primitives',
				component: lazyRouteComponent(() => import('./routes/primitives'), 'PrimitivesPage'),
			}),
		]
	: []

const routeTree = rootRoute.addChildren([indexRoute, runRoute, ...devRoutes])

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
