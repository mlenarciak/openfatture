import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { authenticated, loadConfig } from './auth';
import { AuthErrorScreen, PublicEntry } from './public-entry';
import './styles.css';

export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: false } } });
// Public visitors load the entry screens first; workspace tables/forms load on entry.
const AppShell = lazy(() => import('./pages').then(module => ({ default: module.AppShell })));
const Overview = lazy(() => import('./pages').then(module => ({ default: module.Overview })));
const Documents = lazy(() => import('./pages').then(module => ({ default: module.Documents })));
const Clients = lazy(() => import('./pages').then(module => ({ default: module.Clients })));
const Payments = lazy(() => import('./pages').then(module => ({ default: module.Payments })));
const Connections = lazy(() => import('./pages').then(module => ({ default: module.Connections })));
function EntryShell() {
  return authenticated() ? <Suspense fallback={<main className="boot-error" role="status">Caricamento del tuo spazio…</main>}><AppShell /></Suspense> : <PublicEntry />;
}
const rootRoute = createRootRoute({ component: EntryShell });
const routes = [
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: Overview }),
  createRoute({ getParentRoute: () => rootRoute, path: '/login', component: Overview }),
  createRoute({ getParentRoute: () => rootRoute, path: '/demo', component: Overview }),
  createRoute({ getParentRoute: () => rootRoute, path: '/documents', component: Documents }),
  createRoute({ getParentRoute: () => rootRoute, path: '/clients', component: Clients }),
  createRoute({ getParentRoute: () => rootRoute, path: '/payments', component: Payments }),
  createRoute({ getParentRoute: () => rootRoute, path: '/connections', component: Connections }),
];
const router = createRouter({ routeTree: rootRoute.addChildren(routes), defaultNotFoundComponent: () => <main className="empty-state"><h1>Pagina non trovata</h1><a href="/">Torna alla panoramica</a></main> });
declare module '@tanstack/react-router' { interface Register { router: typeof router } }

const root = createRoot(document.getElementById('root')!);
loadConfig().then(() => root.render(<StrictMode><QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider></StrictMode>)).catch((error: Error) => root.render(<AuthErrorScreen message={error.message} />));
