import { createContext, useContext, useEffect, useMemo, useId, cloneElement, isValidElement, useState, type FormEvent, type ReactNode, type ReactElement } from 'react';
import { Link, Outlet, useLocation } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table';
import { Activity, ArrowDownLeft, ArrowDownToLine, ArrowRight, ArrowUpRight, Building2, CalendarDays, Check, CheckCheck, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Clock3, FileCheck2, FileText, LayoutDashboard, LoaderCircle, LogOut, Menu, Plus, Search, Settings2, ShieldCheck, Sparkles, Trash2, UsersRound, Wallet, X, XCircle, Zap } from 'lucide-react';
import { calculateTotals, formatMoney, statusLabels, type BulkJob, type BulkJobInput, type Client, type ClientInput, type Company, type Dashboard, type Document as Invoice, type DocumentInput, type Integration, type InvoiceLine, type Payment, type PaymentInput } from '@openfatture/domain';
import { authenticated, getConfig, signIn, signOut, isPublicDemo, exitDemo } from './auth';
import { ApiError, downloadXml, request, selectCompany } from './api';
import { PublicEntry, AccessPending, ThemeToggle, Brand } from './public-entry';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { Field, FieldLabel, FieldGroup, FieldError } from '@/components/ui/field';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Empty as EmptyState, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Toaster } from '@/components/ui/sonner';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { toast as notifyToast } from 'sonner';
import { cn } from '@/lib/utils';
const today = () => new Date().toISOString().slice(0, 10);
const dateLabel = (date: string) => new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: 'short'
}).format(new Date(date));
const initials = (name: string) => name.split(' ').slice(0, 2).map(word => word[0]).join('').toUpperCase();
const kindLabels = {
  invoice: 'Fattura',
  credit_note: 'Nota di credito',
  quote: 'Preventivo'
};
const WorkspaceContext = createContext<{
  company: Company;
  newInvoice: () => void;
  openDocument: (invoice: Invoice) => void;
  notify: (message: string) => void;
} | null>(null);
const useWorkspace = () => useContext(WorkspaceContext)!;
const navItems = [{
  to: '/' as const,
  label: 'Panoramica',
  icon: LayoutDashboard
}, {
  to: '/documents' as const,
  label: 'Documenti',
  icon: FileText
}, {
  to: '/clients' as const,
  label: 'Clienti',
  icon: UsersRound
}, {
  to: '/payments' as const,
  label: 'Incassi e scadenze',
  icon: Wallet
}, {
  to: '/connections' as const,
  label: 'Canali e integrazioni',
  icon: Settings2
}];
function ErrorNotice({error,retry}:{error:Error;retry?:()=>void}) { const expired=error instanceof ApiError && error.status===401;return <Alert variant="destructive" className="error-notice"><XCircle/><AlertTitle>{expired?'La sessione è scaduta.':'Non siamo riusciti a caricare i dati.'}</AlertTitle><AlertDescription><p>{error.message}</p>{expired && getConfig().auth.mode==='cognito'?<Button variant="outline" onClick={()=>void signIn()}>Accedi di nuovo<ArrowRight data-icon="inline-end"/></Button>:retry&&<Button variant="outline" onClick={retry}>Riprova<ArrowRight data-icon="inline-end"/></Button>}</AlertDescription></Alert>;}
function Loading(){return <div className="loading" role="status" aria-label="Caricamento del tuo spazio"><div className="loading-skeleton"><Skeleton className="h-6 w-48"/><Skeleton className="h-4 w-64"/><div className="loading-cards">{[0,1,2].map(i=><Skeleton key={i} className="h-28 w-full"/>)}</div><Skeleton className="h-56 w-full"/></div><span className="sr-only">Caricamento del tuo spazio…</span></div>;}
function Empty({title,description}:{title:string;description:string}){return <EmptyState className="empty-state"><EmptyHeader><EmptyMedia variant="icon"><FileText/></EmptyMedia><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader></EmptyState>;}
function Status({status}:{status:Invoice['status']}){return <Badge variant={status==='rejected'?'destructive':status==='draft'?'outline':'secondary'}>{statusLabels[status]}</Badge>;}
export function AppShell() {
  const [signedIn] = useState(authenticated);
  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: () => request<Company[]>('/api/companies'),
    enabled: signedIn
  });
  const [companyId, setCompanyId] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const location = useLocation();
  const queryClient = useQueryClient();
  const company = companies.data?.find(c => c.id === companyId) ?? companies.data?.[0];
  // Set synchronously before child queries mount so the first request uses the chosen tenant.
  if (company) selectCompany(company.id);
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);
  if (!signedIn) return <PublicEntry />;
  if (companies.isPending) return <Loading />;
  if (companies.error) return <main className="boot-error"><ErrorNotice error={companies.error} retry={() => void companies.refetch()} /></main>;
  if (!company) return <AccessPending />;
  const activePage = navItems.find(item => item.to === location.pathname)?.label ?? 'Panoramica';
  return <WorkspaceContext.Provider value={{
    company,
    newInvoice: () => setCreating(true),
    openDocument: setSelected,
    notify: message => notifyToast.success(message)
  }}>
    <div className="app-layout">
      <a className="skip-link" href="#main-content">Vai al contenuto</a>
      <aside className="sidebar desktop-sidebar">        <Brand />
        <div className="workspace-selector"><span className="workspace-icon"><Building2 size={19} /></span><div><span className="micro-label">IL TUO SPAZIO</span>{getConfig().features?.multiTenant !== false && companies.data && companies.data.length > 1 ? <NativeSelect aria-label="Azienda" value={company.id} onChange={event => {
              setCompanyId(event.target.value);
              selectCompany(event.target.value);
              queryClient.removeQueries({
                predicate: query => query.queryKey[0] !== 'companies'
              });
            }}>{companies.data.map(item => <NativeSelectOption value={item.id} key={item.id}>{item.name}</NativeSelectOption>)}</NativeSelect> : <strong>{company.name}</strong>}</div><ChevronDown size={14} /></div>
        <span className="nav-caption">WORKSPACE</span>
        <nav aria-label="Navigazione principale">{navItems.map(({
            to,
            label,
            icon: Icon
          }) => <Link key={to} to={to} activeOptions={{
            exact: true
          }} activeProps={{
            className: 'nav-link active'
          }} inactiveProps={{
            className: 'nav-link'
          }}><Icon size={18} strokeWidth={1.6} /><span>{label}</span>{to === '/connections' && <Badge className="nav-new" variant="outline">API</Badge>}</Link>)}</nav>
        <div className="sidebar-bottom"><div className="channel-note"><span className="channel-note-icon"><ShieldCheck size={20} /></span><strong>Il controllo è tuo.</strong><p>{isPublicDemo() ? 'Dati di esempio in questa scheda. Nessun invio fiscale.' : 'I tuoi dati, nel tuo ambiente AWS. Nessun invio fiscale automatico.'}</p><Link to="/connections">Esplora i canali <ArrowUpRight size={14} /></Link></div><div className="profile"><span className="avatar">{initials(company.name)}</span><div><strong>{company.name}</strong><span>{isPublicDemo() ? 'Demo nel tuo browser' : getConfig().auth.mode === 'demo' ? 'Demo locale' : 'Workspace aziendale'}</span></div>{!isPublicDemo() && getConfig().auth.mode === 'cognito' && <Button className="icon-button" aria-label="Esci" onClick={signOut} variant="ghost" size="icon"><LogOut data-icon="inline-start" /></Button>}</div></div></aside>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}><SheetContent side="left" className="mobile-sidebar"><SheetTitle className="sr-only">Navigazione workspace</SheetTitle><SheetDescription className="sr-only">Scegli una sezione del tuo spazio di lavoro.</SheetDescription><div className="sidebar sidebar-mobile-content">        <Brand />
        <div className="workspace-selector"><span className="workspace-icon"><Building2 size={19} /></span><div><span className="micro-label">IL TUO SPAZIO</span>{getConfig().features?.multiTenant !== false && companies.data && companies.data.length > 1 ? <NativeSelect aria-label="Azienda" value={company.id} onChange={event => {
              setCompanyId(event.target.value);
              selectCompany(event.target.value);
              queryClient.removeQueries({
                predicate: query => query.queryKey[0] !== 'companies'
              });
            }}>{companies.data.map(item => <NativeSelectOption value={item.id} key={item.id}>{item.name}</NativeSelectOption>)}</NativeSelect> : <strong>{company.name}</strong>}</div><ChevronDown size={14} /></div>
        <span className="nav-caption">WORKSPACE</span>
        <nav aria-label="Navigazione principale">{navItems.map(({
            to,
            label,
            icon: Icon
          }) => <Link key={to} to={to} activeOptions={{
            exact: true
          }} activeProps={{
            className: 'nav-link active'
          }} inactiveProps={{
            className: 'nav-link'
          }}><Icon size={18} strokeWidth={1.6} /><span>{label}</span>{to === '/connections' && <Badge className="nav-new" variant="outline">API</Badge>}</Link>)}</nav>
        <div className="sidebar-bottom"><div className="channel-note"><span className="channel-note-icon"><ShieldCheck size={20} /></span><strong>Il controllo è tuo.</strong><p>{isPublicDemo() ? 'Dati di esempio in questa scheda. Nessun invio fiscale.' : 'I tuoi dati, nel tuo ambiente AWS. Nessun invio fiscale automatico.'}</p><Link to="/connections">Esplora i canali <ArrowUpRight size={14} /></Link></div><div className="profile"><span className="avatar">{initials(company.name)}</span><div><strong>{company.name}</strong><span>{isPublicDemo() ? 'Demo nel tuo browser' : getConfig().auth.mode === 'demo' ? 'Demo locale' : 'Workspace aziendale'}</span></div>{!isPublicDemo() && getConfig().auth.mode === 'cognito' && <Button className="icon-button" aria-label="Esci" onClick={signOut} variant="ghost" size="icon"><LogOut data-icon="inline-start" /></Button>}</div></div></div></SheetContent></Sheet>
      <div className="main-column"><header className="topbar"><div className="breadcrumb"><Button className="icon-button mobile-menu" aria-label="Apri navigazione" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)} variant="ghost" size="icon"><Menu data-icon="inline-start" /></Button><span>Workspace</span><ChevronRight size={13} /><strong>{activePage}</strong></div><div className="topbar-right"><ThemeToggle /><Badge className="environment-label" variant="outline"><span />{isPublicDemo() || getConfig().auth.mode === 'demo' ? 'DEMO · DATI DI ESEMPIO' : 'WORKSPACE AZIENDALE'}</Badge><span className="topbar-date">{new Intl.DateTimeFormat('it-IT', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
              }).format(new Date())}</span></div></header>{isPublicDemo() && <DemoBanner />}<main id="main-content" key={company.id}><Outlet /></main><footer className="app-footer"><span>openfatture <span className="footer-divider">/</span> Più tempo per ciò che conta.</span><span><span className="tiny-dot" /> {isPublicDemo() ? 'Demo salvata in questo browser' : getConfig().auth.mode === 'demo' ? 'Workspace demo locale' : 'Workspace connesso'}</span></footer></div>
    </div>
    {creating && <InvoiceModal onClose={() => setCreating(false)} />}
    {selected && <DocumentModal invoice={selected} onClose={() => setSelected(null)} />}
    <Toaster position="bottom-right" closeButton />
  </WorkspaceContext.Provider>;
}
function PageHeader({
  eyebrow,
  title,
  description,
  children
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return <div className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div><div className="page-actions">{children}</div></div>;
}
export function Overview() {
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => request<Dashboard>('/api/dashboard')
  });
  const {
    newInvoice,
    company
  } = useWorkspace();
  const [months, setMonths] = useState(6);
  if (dashboard.isPending) return <Loading />;
  if (dashboard.error) return <ErrorNotice error={dashboard.error} retry={() => void dashboard.refetch()} />;
  const {
    metrics,
    monthly,
    recentDocuments,
    upcomingPayments,
    activity
  } = dashboard.data;
  const chartData = monthly.slice(-months);
  const max = Math.max(...chartData.flatMap(m => [m.invoicedCents, m.collectedCents]), 1);
  const seriesLabel = chartData.length ? `${dateLabel(`${chartData[0]!.month}-01`)} — ${dateLabel(`${chartData[chartData.length - 1]!.month}-01`)}` : 'Nessun movimento';
  return <>
    <PageHeader eyebrow="LA TUA ATTIVITÀ, A COLPO D’OCCHIO" title="Le idee crescono. I numeri, sotto controllo." description={`Benvenuto nel tuo spazio, ${company.name}. Ecco come sta andando.`}><Button className="" onClick={newInvoice} variant="default"><Plus data-icon="inline-start" />Nuovo documento</Button></PageHeader>
    <Alert className="overview-banner"><Sparkles/><div><AlertTitle>Una visione chiara. Una giornata più leggera.</AlertTitle><AlertDescription>Ritrova documenti, relazioni e prossimi incassi in un unico posto.</AlertDescription></div><Link to="/payments">Vedi le scadenze <ArrowRight size={16}/></Link></Alert>
    <section className="metric-grid" aria-label="Riepilogo finanziario">
      <Metric label="Fatturato" value={formatMoney(metrics.revenueCents)} detail="Fatture e note di credito · IVA esclusa" icon={<ArrowUpRight size={19} />} accent />
      <Metric label="Da incassare" value={formatMoney(metrics.outstandingCents)} detail="Saldo aperto delle fatture" icon={<Wallet size={19} />} />
      <Metric label="Scaduto" value={formatMoney(metrics.overdueCents)} detail="Un buon momento per fare il punto" icon={<Clock3 size={19} />} warning={metrics.overdueCents > 0} />
      <Metric label="Documenti in bozza" value={String(metrics.draftCount).padStart(2, '0')} detail={`${metrics.documentCount} documenti · ${metrics.clientCount} clienti`} icon={<FileText size={19} />} />
    </section>
    <div className="overview-middle"><Card className="panel revenue-panel"><CardHeader className="panel-heading"><div><CardTitle>Il ritmo della tua attività</CardTitle><CardDescription>Fatturato e incassi, mese dopo mese</CardDescription></div><NativeSelect className="subtle-select" aria-label="Periodo grafico" value={months} onChange={e => setMonths(Number(e.target.value))}><NativeSelectOption value={3}>Ultimi 3 mesi</NativeSelectOption><NativeSelectOption value={6}>Ultimi 6 mesi</NativeSelectOption></NativeSelect></CardHeader><div className="chart-summary"><strong>{formatMoney(chartData.reduce((sum, m) => sum + m.invoicedCents, 0))}</strong><span>{seriesLabel}</span></div><div className="chart" role="img" aria-label={`Fatturato mensile: ${chartData.map(m => `${m.month} ${formatMoney(m.invoicedCents)}, incassato ${formatMoney(m.collectedCents)}`).join('; ')}`}><div className="chart-grid">{[100, 75, 50, 25, 0].map(p => <div key={p}><span>{new Intl.NumberFormat('it-IT', {
                  notation: 'compact'
                }).format(max * p / 100 / 100)} €</span><i /></div>)}</div><div className="chart-bars">{chartData.map((month, index) => <div className="chart-month" key={month.month}><div className="bar-pair"><div className={cn('bar invoiced',index === chartData.length - 1&&'latest')} style={{
                  height: `${Math.max(month.invoicedCents / max * 100, 1)}%`
                }} title={`Fatturato ${formatMoney(month.invoicedCents)}`} /><div className="bar collected" style={{
                  height: `${Math.max(month.collectedCents / max * 100, 1)}%`
                }} title={`Incassi ${formatMoney(month.collectedCents)}`} /></div><span>{new Intl.DateTimeFormat('it-IT', {
                  month: 'short'
                }).format(new Date(`${month.month}-01`))}</span></div>)}</div></div><div className="chart-legend"><span><i className="legend-invoiced" />Fatturato</span><span><i className="legend-collected" />Incassi</span><span className="chart-footnote">Fatturato IVA esclusa · Incassi IVA inclusa</span></div></Card>
    <Card className="panel due-panel"><CardHeader className="panel-heading"><div><CardTitle>I prossimi incassi</CardTitle><CardDescription>Le scadenze da tenere d’occhio</CardDescription></div><span className="icon-tile"><CalendarDays size={18} /></span></CardHeader><div className="due-list">{upcomingPayments.length ? upcomingPayments.slice(0, 4).map(invoice => <DueItem key={invoice.id} invoice={invoice} />) : <Empty title="Tutto in ordine" description="Non ci sono scadenze aperte." />}</div><Link className="panel-bottom-link" to="/payments">Tutte le scadenze <ArrowRight size={15} /></Link></Card></div>
    <div className="overview-bottom"><Card className="panel recent-panel"><CardHeader className="panel-heading"><div><CardTitle>Gli ultimi documenti</CardTitle><CardDescription>Ogni dettaglio, al posto giusto</CardDescription></div><Link className="text-button" to="/documents">Vedi tutti <ArrowRight size={15} /></Link></CardHeader><DocumentTable documents={recentDocuments.slice(0, 5)} compact /></Card><Card className="panel activity-panel"><CardHeader className="panel-heading"><div><CardTitle>Il diario dell’attività</CardTitle><CardDescription>I tuoi ultimi passi</CardDescription></div><Activity size={18} /></CardHeader><div className="activity-list">{activity.length ? activity.slice(0, 4).map(item => <div className="activity-item" key={item.id}><span className={cn('activity-icon',item.type)}>{item.type === 'payment' ? <ArrowDownLeft size={15} /> : item.type === 'bulk' ? <Zap size={15} /> : <FileText size={15} />}</span><div><p>{item.label}</p><span>{dateLabel(item.date)}</span></div></div>) : <p className="muted">La tua prossima attività comparirà qui.</p>}</div><div className="activity-note"><span className="tiny-dot" />Aggiornato dal tuo workspace</div></Card></div>
  </>;
}
function Metric({label,value,detail,icon,accent,warning}:{label:string;value:string;detail:string;icon:ReactNode;accent?:boolean;warning?:boolean}){return <Card className={cn('metric-card',accent&&'metric-featured')}><CardHeader className="metric-top"><CardDescription>{label}</CardDescription><span className="metric-icon">{icon}</span></CardHeader><CardContent><strong className="metric-value">{value}</strong></CardContent><CardFooter><span>{detail}</span></CardFooter></Card>;}
function DueItem({
  invoice
}: {
  invoice: Invoice;
}) {
  const {
    openDocument
  } = useWorkspace();
  const overdue = invoice.dueDate < today();
  return <Button className="due-item" onClick={() => openDocument(invoice)} variant="ghost"><span className={cn('due-date',overdue&&'overdue')}><strong>{new Date(invoice.dueDate).getDate()}</strong><span>{new Intl.DateTimeFormat('it-IT', {
          month: 'short'
        }).format(new Date(invoice.dueDate))}</span></span><span className="due-client"><strong>{invoice.clientName}</strong><small>{invoice.number} {overdue && '· Scaduta'}</small></span><strong className="due-amount">{formatMoney(invoice.totalCents - invoice.paidCents)}</strong></Button>;
}
function DocumentTable({
  documents,
  compact = false
}: {
  documents: Invoice[];
  compact?: boolean;
}) {
  const {
    openDocument
  } = useWorkspace();
  const [sorting, setSorting] = useState<SortingState>([]);
  const columns = useMemo<ColumnDef<Invoice>[]>(() => [{
    accessorKey: 'number',
    header: 'Documento',
    cell: ({
      row
    }) => <Button className="document-cell" onClick={() => openDocument(row.original)} variant="ghost"><span className="document-icon"><FileText size={17} /></span><span><strong>{row.original.number}</strong><small>{kindLabels[row.original.kind]}</small></span></Button>
  }, {
    accessorKey: 'clientName',
    header: 'Cliente',
    cell: ({
      row
    }) => <span className="client-name">{row.original.clientName}</span>
  }, ...(!compact ? [{
    accessorKey: 'date',
    header: 'Data',
    cell: ({
      row
    }: {
      row: {
        original: Invoice;
      };
    }) => <span className="table-date">{dateLabel(row.original.date)}</span>
  }] : []), {
    accessorKey: 'status',
    header: 'Stato',
    cell: ({
      row
    }) => <Status status={row.original.status} />
  }, {
    accessorKey: 'totalCents',
    header: 'Importo',
    cell: ({
      row
    }) => <strong className="money">{formatMoney(row.original.totalCents)}</strong>
  }, {
    id: 'actions',
    header: '',
    cell: ({
      row
    }) => <Button className="icon-button row-action" aria-label={`Apri documento ${row.original.number}`} onClick={() => openDocument(row.original)} variant="ghost" size="icon"><ChevronRight data-icon="inline-start" /></Button>
  }], [compact, openDocument]);
  const table = useReactTable({
    data: documents,
    columns,
    state: {
      sorting
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel()
  });
  if (!documents.length) return <Empty title="Nessun documento da mostrare" description="Crea un documento o modifica i filtri di ricerca." />;
  return <div className="table-scroll"><Table><TableHeader>{table.getHeaderGroups().map(group => <TableRow key={group.id}>{group.headers.map(header => <TableHead key={header.id}>{header.isPlaceholder ? null : header.column.getCanSort() ? <Button className="sort-button" onClick={header.column.getToggleSortingHandler()} variant="outline">{flexRender(header.column.columnDef.header, header.getContext())}{header.column.getIsSorted() === 'asc' ? ' ↑' : header.column.getIsSorted() === 'desc' ? ' ↓' : ''}</Button> : flexRender(header.column.columnDef.header, header.getContext())}</TableHead>)}</TableRow>)}</TableHeader><TableBody>{table.getRowModel().rows.map(row => <TableRow key={row.id}>{row.getVisibleCells().map(cell => <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}</TableRow>)}</TableBody></Table></div>;
}
export function Documents() {
  const query = useQuery({
    queryKey: ['documents'],
    queryFn: () => request<Invoice[]>('/api/documents')
  });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const {
    newInvoice,
    notify
  } = useWorkspace();
  const documents = (query.data ?? []).filter(doc => (filter === 'all' || doc.status === filter) && `${doc.clientName} ${doc.number}`.toLowerCase().includes(search.toLowerCase()));
  function exportCsv() {
    const rows = [['Numero', 'Cliente', 'Data', 'Scadenza', 'Stato', 'Totale EUR'], ...documents.map(doc => [doc.number, doc.clientName, doc.date, doc.dueDate, statusLabels[doc.status], (doc.totalCents / 100).toFixed(2)])];
    const csv = '\uFEFF' + rows.map(row => row.map(value => {
      const raw = String(value);
      const safe = /^[=+@\-\t\r]/.test(raw) ? `\'${raw}` : raw;
      return `"${safe.replaceAll('"', '""')}"`;
    }).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], {
      type: 'text/csv;charset=utf-8;'
    }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `documenti-${today()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    notify('Esportazione documenti scaricata.');
  }
  return <><PageHeader eyebrow="DOCUMENTI" title="Dai valore al tuo lavoro." description="Fatture, preventivi e note di credito. Tutto in uno spazio ordinato."><Button className="" onClick={exportCsv} disabled={!documents.length} variant="outline"><ArrowDownToLine data-icon="inline-start" />Esporta CSV</Button><Button className="" onClick={newInvoice} variant="default"><Plus data-icon="inline-start" />Nuovo documento</Button></PageHeader><Card className="panel"><div className="list-toolbar"><ToggleGroup type="single" className="tabs" aria-label="Filtra documenti" value={filter} onValueChange={value => { if(value) setFilter(value); }}>{[['all', 'Tutti i documenti'], ['draft', 'Bozze'], ['ready', 'Pronti'], ['paid', 'Pagati']].map(([key, label]) => <ToggleGroupItem key={key} value={key!}>{label}{key === 'all' && <Badge variant="outline">{query.data?.length ?? 0}</Badge>}</ToggleGroupItem>)}</ToggleGroup><label className="search-field"><Search size={17} /><Input aria-label="Cerca documenti" placeholder="Cerca numero o cliente…" value={search} onChange={e => setSearch(e.target.value)} /></label></div>{query.isPending ? <Loading /> : query.error ? <ErrorNotice error={query.error} retry={() => void query.refetch()} /> : <DocumentTable documents={documents} />}<div className="table-footer"><span>{documents.length} documenti visualizzati</span><span>Gli importi includono l’IVA</span></div></Card><Alert className="inline-info"><ShieldCheck size={18} /><p>Il pulsante “Pronta” completa la preparazione interna. L’invio al Sistema di Interscambio richiede un canale configurato e accreditato.</p></Alert></>;
}
export function Clients() {
  const query = useQuery({
    queryKey: ['clients'],
    queryFn: () => request<Client[]>('/api/clients')
  });
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const clients = (query.data ?? []).filter(c => `${c.name} ${c.vatNumber} ${c.email}`.toLowerCase().includes(search.toLowerCase()));
  return <><PageHeader eyebrow="LE TUE RELAZIONI" title="Il lavoro parte dalle persone." description="Le anagrafiche dei tuoi clienti, sempre a portata di mano."><Button className="" onClick={() => setCreating(true)} variant="default"><Plus data-icon="inline-start" />Nuovo cliente</Button></PageHeader><Card className="panel"><div className="list-toolbar"><h2>Clienti <Badge className="count" variant="outline">{query.data?.length ?? 0}</Badge></h2><label className="search-field"><Search size={17} /><Input aria-label="Cerca clienti" value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca nome, partita IVA o email…" /></label></div>{query.isPending ? <Loading /> : query.error ? <ErrorNotice error={query.error} retry={() => void query.refetch()} /> : clients.length ? <div className="client-grid">{clients.map((client, i) => <article className="client-card" key={client.id}><div className="client-card-top"><span className="client-avatar">{initials(client.name)}</span><span className="client-country">IT</span></div><h3>{client.name}</h3><a href={`mailto:${client.email}`}>{client.email}</a><dl><div><dt>Partita IVA</dt><dd>{client.vatNumber}</dd></div><div><dt>Codice destinatario</dt><dd>{client.recipientCode}</dd></div><div><dt>Sede</dt><dd>{client.address.city} ({client.address.province})</dd></div></dl></article>)}</div> : <Empty title="Nessun cliente trovato" description="Aggiungi un nuovo cliente o modifica la ricerca." />}</Card>{creating && <ClientModal onClose={() => setCreating(false)} />}</>;
}
export function Payments() {
  const documents = useQuery({
    queryKey: ['documents'],
    queryFn: () => request<Invoice[]>('/api/documents')
  });
  const payments = useQuery({
    queryKey: ['payments'],
    queryFn: () => request<Payment[]>('/api/payments')
  });
  const [recording, setRecording] = useState<Invoice | null>(null);
  const [filter, setFilter] = useState('all');
  const open = (documents.data ?? []).filter(doc => doc.kind === 'invoice' && !['draft', 'rejected', 'paid'].includes(doc.status) && doc.totalCents > doc.paidCents).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const filtered = open.filter(doc => filter !== 'overdue' || doc.dueDate < today());
  const paidTotal = (payments.data ?? []).reduce((sum, p) => sum + p.amountCents, 0);
  return <><PageHeader eyebrow="IL TUO FLUSSO DI CASSA" title="Ogni scadenza, una cosa in meno." description="Segui gli incassi e registra i pagamenti ricevuti dai tuoi clienti." /><div className="payment-metrics"><Metric label="Incassi registrati" value={formatMoney(paidTotal)} detail={`${payments.data?.length ?? 0} movimenti registrati`} icon={<CheckCheck size={19} />} accent /><Metric label="Da incassare" value={formatMoney(open.reduce((sum, doc) => sum + doc.totalCents - doc.paidCents, 0))} detail={`${open.length} fatture con saldo aperto`} icon={<Wallet size={19} />} /><Metric label="Di cui scaduto" value={formatMoney(open.filter(doc => doc.dueDate < today()).reduce((sum, doc) => sum + doc.totalCents - doc.paidCents, 0))} detail="Rispetto alla data di oggi" icon={<Clock3 size={19} />} warning /></div><Card className="panel"><div className="list-toolbar"><h2>Scadenziario</h2><ToggleGroup type="single" className="tabs" aria-label="Filtra scadenze" value={filter} onValueChange={value=>{if(value)setFilter(value);}}><ToggleGroupItem value="all">Tutte</ToggleGroupItem><ToggleGroupItem value="overdue">Scadute</ToggleGroupItem></ToggleGroup></div>{documents.isPending ? <Loading /> : documents.error ? <ErrorNotice error={documents.error} /> : !filtered.length ? <Empty title="Nessuna scadenza aperta" description="Le fatture preparate appariranno qui fino al saldo." /> : <div className="table-scroll"><Table><TableHeader><TableRow><TableHead>Cliente / documento</TableHead><TableHead>Scadenza</TableHead><TableHead>Saldo da incassare</TableHead><TableHead /></TableRow></TableHeader><TableBody>{filtered.map(doc => <TableRow key={doc.id}><TableCell><strong>{doc.clientName}</strong><small className="table-subline">{doc.number}</small></TableCell><TableCell><span className={doc.dueDate < today() ? 'overdue-label' : ''}>{dateLabel(doc.dueDate)} {doc.dueDate < today() && '· Scaduta'}</span></TableCell><TableCell className="money">{formatMoney(doc.totalCents - doc.paidCents)}</TableCell><TableCell><Button className="" onClick={() => setRecording(doc)} variant="outline" size="sm"><Plus data-icon="inline-start" />Registra incasso</Button></TableCell></TableRow>)}</TableBody></Table></div>}</Card><Card className="panel payment-history"><CardHeader className="panel-heading"><div><CardTitle>Ultimi incassi</CardTitle><CardDescription>Il registro dei pagamenti ricevuti</CardDescription></div><ArrowDownLeft size={19} /></CardHeader>{payments.isPending ? <Loading /> : payments.error ? <ErrorNotice error={payments.error} /> : payments.data.length ? <div className="table-scroll"><Table><TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead>Documento</TableHead><TableHead>Data</TableHead><TableHead>Metodo</TableHead><TableHead>Importo</TableHead></TableRow></TableHeader><TableBody>{payments.data.map(p => <TableRow key={p.id}><TableCell><strong>{p.clientName}</strong></TableCell><TableCell>{p.documentNumber}</TableCell><TableCell>{dateLabel(p.date)}</TableCell><TableCell>{{
                  bank_transfer: 'Bonifico',
                  card: 'Carta',
                  cash: 'Contanti'
                }[p.method]}</TableCell><TableCell className="money positive">+ {formatMoney(p.amountCents)}</TableCell></TableRow>)}</TableBody></Table></div> : <Empty title="Nessun incasso registrato" description="Registra un pagamento per aggiornare il saldo della fattura." />}</Card>{recording && <PaymentModal invoice={recording} onClose={() => setRecording(null)} />}</>;
}
export function Connections() {
  const integrations = useQuery({
    queryKey: ['integrations'],
    queryFn: () => request<Integration[]>('/api/integrations')
  });
  const jobs = useQuery({
    queryKey: ['bulk-jobs'],
    queryFn: () => request<BulkJob[]>('/api/bulk-jobs')
  });
  const [creating, setCreating] = useState(false);
  return <><PageHeader eyebrow="UN WORKSPACE CONNESSO" title="Le connessioni giuste. Al tuo ritmo." description="Prepara i canali fiscali e collega gli strumenti che usi già."><Button className="" onClick={() => setCreating(true)} variant="default"><Plus data-icon="inline-start" />Prepara richiesta massiva</Button></PageHeader><div className="integration-grid">{integrations.isPending ? <Loading /> : integrations.error ? <ErrorNotice error={integrations.error} /> : integrations.data.map(integration => <Card key={integration.id} className="panel integration-card"><div className="integration-card-top"><span className={cn('integration-symbol',integration.id)}>{integration.id === 'sdicoop' ? <Building2 size={26} /> : integration.id === 'conservation' ? <ShieldCheck size={26} /> : <Zap size={26} />}</span><Badge variant={integration.status==='configured'?'secondary':'outline'}>{integration.status === 'configured' ? 'Configurato' : integration.status === 'unavailable' ? 'Non disponibile' : 'Da configurare'}</Badge></div><h2>{integration.name}</h2><p>{integration.description}</p><div className="capabilities">{integration.capabilities.map(capability => <span key={capability}><Check size={13} />{capability}</span>)}</div><a className="text-button" target="_blank" rel="noreferrer" href={integration.id === 'sdicoop' ? 'https://www.agenziaentrate.gov.it/portale/servizi-massivi-sdicoop' : integration.id === 'fatture-in-cloud' ? 'https://developers.fattureincloud.it/' : 'https://www.agenziaentrate.gov.it/portale/web/guest/schede/comunicazioni/fatture-e-corrispettivi/conservazione-fatture-elettroniche'}>Documentazione ufficiale <ArrowUpRight size={15} /></a></Card>)}</div><div className="sdi-explainer"><span className="icon-tile"><CircleHelp size={23} /></span><div><h2>Servizi massivi: scaricare, con le giuste deleghe.</h2><p>I servizi SMTS di Agenzia delle Entrate consentono richieste asincrone per scarichi massivi di fatture, corrispettivi e dati del bollo. Sono distinti dall’invio delle singole fatture al Sistema di Interscambio.</p><p>Openfatture salva una richiesta interna. Per trasmetterla servono accreditamento, deleghe, firma e canale configurato. Il download come cessionario può avere effetto di presa visione.</p><Badge className="version-tag" variant="outline">Specifiche ufficiali v1.5 · 16 marzo 2026</Badge><a className="text-button guide-link" target="_blank" rel="noreferrer" href="/guida.html">Guida alla configurazione aziendale <ArrowUpRight size={14} /></a><a className="text-button guide-link" target="_blank" rel="noreferrer" href="/sdi-integration-testing.html">Checklist di integrazione e test SDI <ArrowUpRight size={14}/></a></div></div><Card className="panel"><CardHeader className="panel-heading"><div><CardTitle>Richieste di scarico massivo</CardTitle><CardDescription>Bozze interne da completare prima della trasmissione</CardDescription></div><Badge className="count" variant="outline">{jobs.data?.length ?? 0}</Badge></CardHeader>{jobs.isPending ? <Loading /> : jobs.error ? <ErrorNotice error={jobs.error} /> : jobs.data.length ? <div className="table-scroll"><Table><TableHeader><TableRow><TableHead>Tipo richiesta</TableHead><TableHead>Periodo</TableHead><TableHead>Stato</TableHead><TableHead>Dettaglio</TableHead></TableRow></TableHeader><TableBody>{jobs.data.map(job => <TableRow key={job.id}><TableCell><strong>{bulkLabel(job.type)}</strong></TableCell><TableCell>{dateLabel(job.dateFrom)} — {dateLabel(job.dateTo)}</TableCell><TableCell><Badge variant="outline">Da configurare</Badge></TableCell><TableCell className="job-message">{job.message}</TableCell></TableRow>)}</TableBody></Table></div> : <Empty title="Pronto per la prima richiesta?" description="Prepara una bozza con tipo di scarico e periodo. Nessuna richiesta viene inviata automaticamente." />}</Card>{creating && <BulkModal onClose={() => setCreating(false)} />}</>;
}
function bulkLabel(type: string) {
  return ({
    invoice_download: 'Scarico fatture',
    receipt_download: 'Scarico corrispettivi',
    stamp_duty_lists: 'Elenchi imposta di bollo'
  } as Record<string, string>)[type] ?? type;
}
function Modal({title,subtitle,children,onClose,wide=false}:{title:string;subtitle?:string;children:ReactNode;onClose:()=>void;wide?:boolean}){return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent showCloseButton={false} className={cn('modal',wide&&'wide')}><DialogHeader className="modal-heading"><div><DialogTitle>{title}</DialogTitle><DialogDescription>{subtitle??'Completa questa operazione nel tuo workspace.'}</DialogDescription></div><Button variant="ghost" size="icon" aria-label="Chiudi finestra" onClick={onClose}><X data-icon="inline-start"/></Button></DialogHeader>{children}</DialogContent></Dialog>;}
function FormError({error}:{error:Error|null}){return error?<FieldError className="form-error">{error.message}</FieldError>:null;}
function FormField({label,children,className=''}:{label:string;children:ReactNode;className?:string}){const id=useId();const control=isValidElement(children)?cloneElement(children as ReactElement<{id?:string}>,{id}):children;return <Field className={cn('form-field',className)}><FieldLabel htmlFor={id}>{label}</FieldLabel>{control}</Field>;}
function DemoBanner(){const cache=useQueryClient();const [pending,setPending]=useState(false);async function reset(){setPending(true);try{await (await import('./demo')).resetDemoWorkspace();await cache.invalidateQueries();notifyToast.success('Demo ripristinata. Puoi ricominciare con i dati di esempio.');}catch{notifyToast.error('Impossibile ripristinare la demo. Riprova.');}finally{setPending(false);}}return <Alert className="demo-banner"><FileText/><AlertTitle>Stai esplorando la demo.</AlertTitle><AlertDescription>Dati di esempio salvati solo nel tuo browser. Nessuna operazione fiscale o connessione ai dati aziendali.</AlertDescription><div className="demo-banner-actions"><Button variant="outline" size="sm" onClick={()=>void reset()} disabled={pending}>{pending&&<LoaderCircle className="spin" data-icon="inline-start"/>}Ripristina demo</Button><Button variant="ghost" size="sm" onClick={exitDemo}>Esci dalla demo<ArrowRight data-icon="inline-end"/></Button></div></Alert>;}
function InvoiceModal({
  onClose
}: {
  onClose: () => void;
}) {
  const {
    notify
  } = useWorkspace();
  const cache = useQueryClient();
  const clients = useQuery({
    queryKey: ['clients'],
    queryFn: () => request<Client[]>('/api/clients')
  });
  const [lines, setLines] = useState<InvoiceLine[]>([{
    description: '',
    quantity: 1,
    unitPriceCents: 0,
    vatRate: 22
  }]);
  const [inputError, setInputError] = useState<Error | null>(null);
  const create = useMutation({
    mutationFn: (body: DocumentInput) => request<Invoice>('/api/documents', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
    onSuccess: async () => {
      await cache.invalidateQueries();
      notify('Bozza salvata. Il tuo nuovo documento è pronto da completare.');
      onClose();
    }
  });
  const totals = (() => {
    try {
      return calculateTotals(lines);
    } catch {
      return {
        netCents: 0,
        vatCents: 0,
        totalCents: 0
      };
    }
  })();
  const update = (index: number, patch: Partial<InvoiceLine>) => setLines(current => current.map((line, i) => i === index ? {
    ...line,
    ...patch
  } : line));
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setInputError(null);
    const form = new FormData(e.currentTarget);
    if (String(form.get('dueDate')) < String(form.get('date'))) return setInputError(new Error('La scadenza deve essere uguale o successiva alla data del documento.'));
    create.mutate({
      clientId: String(form.get('clientId')),
      kind: String(form.get('kind')) as DocumentInput['kind'],
      date: String(form.get('date')),
      dueDate: String(form.get('dueDate')),
      notes: String(form.get('notes')),
      lines
    });
  }
  return <Modal title="Un nuovo documento, una nuova possibilità." subtitle="Inizia da una bozza. Puoi prepararla prima di qualsiasi invio fiscale." onClose={onClose} wide><form onSubmit={submit}><div className="modal-body"><FieldGroup className="form-grid"><FormField label="Tipo di documento"><NativeSelect name="kind" defaultValue="invoice"><NativeSelectOption value="invoice">Fattura</NativeSelectOption><NativeSelectOption value="quote">Preventivo</NativeSelectOption><NativeSelectOption value="credit_note">Nota di credito</NativeSelectOption></NativeSelect></FormField><FormField label="Cliente"><NativeSelect name="clientId" required defaultValue=""><NativeSelectOption value="" disabled>Seleziona un cliente</NativeSelectOption>{clients.data?.map(client => <NativeSelectOption key={client.id} value={client.id}>{client.name}</NativeSelectOption>)}</NativeSelect></FormField><FormField label="Data documento"><Input type="date" name="date" defaultValue={today()} required /></FormField><FormField label="Data scadenza"><Input type="date" name="dueDate" defaultValue={new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)} required /></FormField></FieldGroup>{clients.error && <FormError error={clients.error} />}{clients.data?.length === 0 && <p className="form-error">Aggiungi prima un cliente dalla pagina Clienti.</p>}<div className="form-section-heading"><h3>Il dettaglio del tuo lavoro</h3><span>Prezzi unitari IVA esclusa</span></div><div className="line-editor">{lines.map((line, i) => <div className="invoice-line" key={i}><FormField label="Descrizione" className="line-description"><Input aria-label={`Descrizione riga ${i + 1}`} value={line.description} onChange={e => update(i, {
                description: e.target.value
              })} placeholder="Prodotto o servizio" required maxLength={300} /></FormField><FormField label="Quantità"><Input aria-label={`Quantità riga ${i + 1}`} type="number" min="0.001" max="10000" step="0.001" required value={line.quantity} onChange={e => update(i, {
                quantity: Number(e.target.value)
              })} /></FormField><FormField label="Prezzo (€)"><Input aria-label={`Prezzo riga ${i + 1}`} type="number" min="0" step="0.01" required value={line.unitPriceCents / 100} onChange={e => update(i, {
                unitPriceCents: Math.round(Number(e.target.value) * 100)
              })} /></FormField><FormField label="IVA"><NativeSelect aria-label={`IVA riga ${i + 1}`} value={line.vatRate} onChange={e => update(i, {
                vatRate: Number(e.target.value) as InvoiceLine['vatRate']
              })}>{[4, 5, 10, 22].map(rate => <NativeSelectOption key={rate} value={rate}>{rate}%</NativeSelectOption>)}</NativeSelect></FormField><Button className="icon-button remove-line" type="button" aria-label={`Rimuovi riga ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines(current => current.filter((_, index) => index !== i))} variant="ghost" size="icon"><Trash2 data-icon="inline-start" /></Button></div>)}</div><Button className="text-button add-line" type="button" disabled={lines.length >= 100} onClick={() => setLines(current => [...current, {
          description: '',
          quantity: 1,
          unitPriceCents: 0,
          vatRate: 22
        }])} variant="ghost"><Plus data-icon="inline-start" />Aggiungi riga</Button><div className="invoice-bottom"><FormField label="Note (facoltative)"><Textarea name="notes" placeholder="Un dettaglio utile per il tuo cliente…" maxLength={2000} rows={3} /></FormField><dl className="totals"><div><dt>Imponibile</dt><dd>{formatMoney(totals.netCents)}</dd></div><div><dt>IVA</dt><dd>{formatMoney(totals.vatCents)}</dd></div><div className="total-final"><dt>Totale documento</dt><dd>{formatMoney(totals.totalCents)}</dd></div></dl></div><FormError error={inputError ?? create.error} /></div><div className="modal-footer"><Button className="" type="button" onClick={onClose} variant="outline">Annulla</Button><Button className="" type="submit" disabled={create.isPending || clients.isPending || !clients.data?.length} variant="default">{create.isPending ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}Salva bozza</Button></div></form></Modal>;
}
function ClientModal({
  onClose
}: {
  onClose: () => void;
}) {
  const {
    notify
  } = useWorkspace();
  const cache = useQueryClient();
  const create = useMutation({
    mutationFn: (body: ClientInput) => request<Client>('/api/clients', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
    onSuccess: async () => {
      await cache.invalidateQueries();
      notify('Cliente aggiunto alla tua rubrica.');
      onClose();
    }
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const field = (name: string) => String(data.get(name) ?? '').trim();
    create.mutate({
      name: field('name'),
      email: field('email'),
      vatNumber: field('vatNumber'),
      recipientCode: field('recipientCode').toUpperCase(),
      ...(field('taxCode') ? {
        taxCode: field('taxCode').toUpperCase()
      } : {}),
      address: {
        street: field('street'),
        city: field('city'),
        postalCode: field('postalCode'),
        province: field('province').toUpperCase(),
        country: 'IT'
      }
    });
  }
  return <Modal title="Conosciamo il tuo nuovo cliente." subtitle="Inserisci i dati necessari per preparare i documenti." onClose={onClose}><form onSubmit={submit}><div className="modal-body"><FieldGroup className="form-grid"><FormField label="Ragione sociale" className="full-width"><Input name="name" required minLength={2} maxLength={160} placeholder="Es. Studio Rossi S.r.l." /></FormField><FormField label="Email"><Input name="email" type="email" required placeholder="amministrazione@azienda.it" /></FormField><FormField label="Partita IVA"><Input name="vatNumber" inputMode="numeric" required pattern="[0-9]{11}" placeholder="11 cifre" /></FormField><FormField label="Codice fiscale (facoltativo)"><Input name="taxCode" pattern="[A-Za-z0-9]{11,16}" maxLength={16} /></FormField><FormField label="Codice destinatario"><Input name="recipientCode" required pattern="[A-Za-z0-9]{7}" defaultValue="0000000" maxLength={7} /></FormField><FormField label="Indirizzo" className="full-width"><Input name="street" required placeholder="Via e numero civico" /></FormField><FormField label="Città"><Input name="city" required /></FormField><FormField label="CAP"><Input name="postalCode" required inputMode="numeric" pattern="[0-9]{5}" /></FormField><FormField label="Provincia"><Input name="province" required pattern="[A-Za-z]{2}" maxLength={2} placeholder="MI" /></FormField><FormField label="Paese"><Input value="Italia" disabled /></FormField></FieldGroup><FormError error={create.error} /></div><div className="modal-footer"><Button type="button" className="" onClick={onClose} variant="outline">Annulla</Button><Button className="" disabled={create.isPending} variant="default">{create.isPending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}Aggiungi cliente</Button></div></form></Modal>;
}
function DocumentModal({
  invoice,
  onClose
}: {
  invoice: Invoice;
  onClose: () => void;
}) {
  const {
    notify
  } = useWorkspace();
  const cache = useQueryClient();
  const detail = useQuery({
    queryKey: ['documents', invoice.id],
    queryFn: () => request<Invoice>(`/api/documents/${invoice.id}`),
    initialData: invoice,
    staleTime: 0
  });
  const doc = detail.data;
  const [downloadError, setDownloadError] = useState<Error | null>(null);
  const [downloading, setDownloading] = useState(false);
  const issue = useMutation({
    mutationFn: () => request<Invoice>(`/api/documents/${doc.id}/issue`, {
      method: 'POST'
    }),
    onSuccess: async updated => {
      cache.setQueryData(['documents', invoice.id], updated);
      await cache.invalidateQueries();
      notify('Documento pronto. Nessuna fattura è stata inviata allo SDI.');
    }
  });
  async function download() {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadXml(doc.id);
      notify('XML di bozza scaricato. Da validare prima di qualsiasi invio.');
    } catch (error) {
      setDownloadError(error as Error);
    } finally {
      setDownloading(false);
    }
  }
  return <Modal title={`${kindLabels[doc.kind]} ${doc.number}`} subtitle={doc.clientName} onClose={onClose} wide><div className="modal-body"><div className="document-detail-top"><Status status={doc.status} /><span>Creato il {dateLabel(doc.createdAt)}</span></div><div className="detail-summary"><div><span>Cliente</span><strong>{doc.clientName}</strong></div><div><span>Data documento</span><strong>{dateLabel(doc.date)}</strong></div><div><span>Scadenza</span><strong>{dateLabel(doc.dueDate)}</strong></div><div><span>Saldo residuo</span><strong>{formatMoney(doc.totalCents - doc.paidCents)}</strong></div></div><div className="table-scroll"><Table className="detail-table"><TableHeader><TableRow><TableHead>Descrizione</TableHead><TableHead>Quantità</TableHead><TableHead>Prezzo unit.</TableHead><TableHead>IVA</TableHead></TableRow></TableHeader><TableBody>{doc.lines.map((line, index) => <TableRow key={index}><TableCell>{line.description}</TableCell><TableCell>{line.quantity}</TableCell><TableCell>{formatMoney(line.unitPriceCents)}</TableCell><TableCell>{line.vatRate}%</TableCell></TableRow>)}</TableBody></Table></div><div className="invoice-bottom"><p className="document-notes">{doc.notes || 'Nessuna nota aggiuntiva.'}</p><dl className="totals"><div><dt>Imponibile</dt><dd>{formatMoney(doc.netCents)}</dd></div><div><dt>IVA</dt><dd>{formatMoney(doc.vatCents)}</dd></div><div className="total-final"><dt>Totale</dt><dd>{formatMoney(doc.totalCents)}</dd></div></dl></div><div className="inline-info compact"><ShieldCheck size={19} /><p>L’XML è una bozza tecnica. Preparazione interna, validazione ufficiale, invio SDI e conservazione sono passaggi distinti.</p></div><FormError error={issue.error ?? downloadError} /></div><div className="modal-footer"><Button className="" onClick={download} disabled={downloading || doc.kind === 'quote'} variant="outline">{downloading ? <LoaderCircle size={16} className="spin" /> : <ArrowDownToLine size={16} />}Scarica XML di bozza</Button>{doc.status === 'draft' && <Button className="" onClick={() => issue.mutate()} disabled={issue.isPending} variant="default">{issue.isPending ? <LoaderCircle size={16} className="spin" /> : <FileCheck2 size={16} />}Segna come pronta</Button>}</div></Modal>;
}
function PaymentModal({
  invoice,
  onClose
}: {
  invoice: Invoice;
  onClose: () => void;
}) {
  const {
    notify
  } = useWorkspace();
  const cache = useQueryClient();
  const remaining = invoice.totalCents - invoice.paidCents;
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const create = useMutation({
    mutationFn: (body: PaymentInput) => request<Payment>('/api/payments', {
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify(body)
    }),
    onSuccess: async () => {
      await cache.invalidateQueries();
      notify('Incasso registrato. Il saldo del documento è aggiornato.');
      onClose();
    }
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    create.mutate({
      documentId: invoice.id,
      amountCents: Math.round(Number(form.get('amount')) * 100),
      date: String(form.get('date')),
      method: String(form.get('method')) as PaymentInput['method'],
      reference: String(form.get('reference'))
    });
  }
  return <Modal title="Un nuovo incasso. Bene così." subtitle={`${invoice.number} · ${invoice.clientName}`} onClose={onClose}><form onSubmit={submit}><div className="modal-body"><div className="payment-callout"><span>Saldo da incassare</span><strong>{formatMoney(remaining)}</strong></div><FieldGroup className="form-grid"><FormField label="Importo ricevuto (€)"><Input name="amount" type="number" min="0.01" max={remaining / 100} step="0.01" defaultValue={remaining / 100} required /></FormField><FormField label="Data di incasso"><Input name="date" type="date" defaultValue={today()} required /></FormField><FormField label="Metodo di pagamento"><NativeSelect name="method"><NativeSelectOption value="bank_transfer">Bonifico bancario</NativeSelectOption><NativeSelectOption value="card">Carta</NativeSelectOption><NativeSelectOption value="cash">Contanti</NativeSelectOption></NativeSelect></FormField><FormField label="Riferimento (facoltativo)"><Input name="reference" placeholder="Es. CRO del bonifico" maxLength={160} /></FormField></FieldGroup><FormError error={create.error} /></div><div className="modal-footer"><Button type="button" className="" onClick={onClose} variant="outline">Annulla</Button><Button className="" disabled={create.isPending} variant="default">{create.isPending ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}Registra incasso</Button></div></form></Modal>;
}
function BulkModal({
  onClose
}: {
  onClose: () => void;
}) {
  const {
    notify
  } = useWorkspace();
  const cache = useQueryClient();
  const create = useMutation({
    mutationFn: (body: BulkJobInput) => request<BulkJob>('/api/bulk-jobs', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
    onSuccess: async () => {
      await cache.invalidateQueries({
        queryKey: ['bulk-jobs']
      });
      await cache.invalidateQueries({
        queryKey: ['dashboard']
      });
      notify('Richiesta interna salvata. Il canale deve essere configurato prima dell’invio.');
      onClose();
    }
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    create.mutate({
      type: String(form.get('type')) as BulkJobInput['type'],
      dateFrom: String(form.get('dateFrom')),
      dateTo: String(form.get('dateTo'))
    });
  }
  return <Modal title="Prepara uno scarico massivo." subtitle="Crea una richiesta interna. La trasmissione non è ancora attiva." onClose={onClose}><form onSubmit={submit}><div className="modal-body"><FieldGroup className="form-grid"><FormField label="Tipo di richiesta" className="full-width"><NativeSelect name="type"><NativeSelectOption value="invoice_download">Scarico fatture</NativeSelectOption><NativeSelectOption value="receipt_download">Scarico corrispettivi</NativeSelectOption><NativeSelectOption value="stamp_duty_lists">Elenchi imposta di bollo</NativeSelectOption></NativeSelect></FormField><FormField label="Dal"><Input name="dateFrom" type="date" defaultValue={new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)} required /></FormField><FormField label="Al"><Input name="dateTo" type="date" defaultValue={today()} required /></FormField></FieldGroup><div className="inline-info compact"><ShieldCheck size={19} /><p>Finestra operativa massima di 90 giorni per richiesta in questo MVP. Accreditamento, deleghe e firma devono essere verificati separatamente.</p></div><FormError error={create.error} /></div><div className="modal-footer"><Button type="button" className="" onClick={onClose} variant="outline">Annulla</Button><Button className="" disabled={create.isPending} variant="default">{create.isPending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}Salva richiesta interna</Button></div></form></Modal>;
}
