import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { AppShell, Overview, Documents, Clients, Payments, Connections } from './pages';
import { loadConfig } from './auth';
import './styles.css';

export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: false } } });
const rootRoute = createRootRoute({ component: AppShell });
const routes = [
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: Overview }),
  createRoute({ getParentRoute: () => rootRoute, path: '/documents', component: Documents }),
  createRoute({ getParentRoute: () => rootRoute, path: '/clients', component: Clients }),
  createRoute({ getParentRoute: () => rootRoute, path: '/payments', component: Payments }),
  createRoute({ getParentRoute: () => rootRoute, path: '/connections', component: Connections }),
];
const router = createRouter({ routeTree: rootRoute.addChildren(routes), defaultNotFoundComponent: () => <main className="empty-state"><h1>Pagina non trovata</h1><a href="/">Torna alla panoramica</a></main> });
declare module '@tanstack/react-router' { interface Register { router: typeof router } }

const root = createRoot(document.getElementById('root')!);
loadConfig().then(() => root.render(<StrictMode><QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider></StrictMode>)).catch((error: Error) => root.render(<main className="boot-error"><div className="brand-mark">o.</div><h1>Apriamo il tuo spazio di lavoro.</h1><p role="alert">{error.message}</p><a className="button primary" href="/">Torna all’accesso</a></main>));
