import '@fontsource/nunito-sans/400.css'
import '@fontsource/nunito-sans/600.css'
import '@fontsource/nunito-sans/700.css'
import '@fontsource/nunito-sans/800.css'
import '@fontsource/outfit/500.css'
import '@fontsource/outfit/600.css'
import '@fontsource/outfit/700.css'
import '@fontsource/outfit/800.css'
import '@fontsource/dm-mono/500.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/shell.css'

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import App from './App'
import { ME_KEY } from './auth/useAuth'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastProvider } from './components/Toast'
import { ApiError } from './lib/api'

// If any request comes back 401 (session ended, user deactivated), mark the user as signed out.
// The route guards then send them to the login page.
const onError = (error: unknown) => {
  if (error instanceof ApiError && error.status === 401) queryClient.setQueryData(ME_KEY, null)
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      // A wrong password on the login form is also a 401; that's not a session ending.
      if (mutation.options.mutationKey?.[0] !== 'login') onError(error)
    },
  }),
  defaultOptions: {
    queries: { refetchOnWindowFocus: true, retry: (count, error) => !(error instanceof ApiError) && count < 2 },
  },
})

// A data router, so screens holding unsaved work can stop every navigation away (useBlocker: links, navigate(), Back).
// App keeps its <Routes> tree under one catch-all route.
const router = createBrowserRouter([
  {
    path: '*',
    element: (
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    ),
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
