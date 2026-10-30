import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { act, render } from '@testing-library/react'
import { createAppRouter, createQueryClient } from '../src/router'

/** Renders the whole app at `path` and waits for the first route to load. */
export async function renderApp(path = '/') {
	const queryClient = createQueryClient()
	const router = createAppRouter({
		queryClient,
		history: createMemoryHistory({ initialEntries: [path] }),
	})
	const result = render(
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	)
	await act(() => router.load())
	return { ...result, router }
}
