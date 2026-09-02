import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import CssBaseline from '@mui/material/CssBaseline'
import MuiToggleButton from '@mui/material/ToggleButton'
import MuiToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Database,
  FileCog,
  Gauge,
  GitPullRequest,
  Languages,
  LayoutDashboard,
  Menu,
  Moon,
  Radio,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  XCircle,
} from 'lucide-react'
import './App.css'

type RouteState =
  | { name: 'overview' }
  | { name: 'incident'; id: string }
  | { name: 'settings' }

type LanguageMode = 'en' | 'zh' | 'both'
type ThemeMode = 'light' | 'dark'
type Tone = 'default' | 'info' | 'success' | 'warning' | 'danger'

type Counters = {
  alerts: number
  l0_absorbed: number
  l0_absorbed_is_estimate: boolean
  ai_diagnosed: number
  auto_remediated: number
  notify_only: number
  verified: number
  verify_failed: number
  skipped_cooldown: number
}

type NeedYou = {
  id: number | null
  kind: string
  service: string | null
  action: string | null
  waiting_seconds: number | null
  href: string | null
}

type RecentIncident = {
  id: number
  service: string
  alertname?: string
  status: string
  started_at: string
}

type OverviewData = {
  counters_computed_at: string
  counters: Counters
  needs_you: NeedYou[]
  recent: RecentIncident[]
}

type ScorecardServiceResult = {
  service: string
  checks: Record<string, unknown>
  passed: number
  total: number
}

type ScorecardLatest = {
  scorecard_id: string
  name: string
  evaluated_at: string | null
  services: ScorecardServiceResult[]
  totals: {
    passed: number
    total: number
    percent: number | null
  }
}

type TimelineItem = {
  at: string
  step: string
  detail: unknown
}

type IncidentDetail = {
  id: number
  service: string
  started_at: string
  timeline: TimelineItem[]
  timeline_stale: boolean
  agent_log_url: string | null
}

type LogSink = 'cloudwatch' | 'loki' | 'file'

type AsyncState<T> =
  | { status: 'loading'; data: T; error: null; fallback: boolean }
  | { status: 'ready'; data: T; error: null; fallback: boolean }
  | { status: 'error'; data: T; error: string; fallback: true }

type Labeler = {
  mode: LanguageMode
  node: (key: string, options?: Record<string, unknown>) => ReactNode
  text: (key: string, options?: Record<string, unknown>) => string
}

const writesEnabled = import.meta.env.VITE_ENABLE_WRITES === 'true'

const needLabelKeys: Record<string, { key: string; className: string; icon: typeof AlertTriangle }> = {
  remediation: { key: 'needs.remediation', className: 'danger', icon: GitPullRequest },
  catalog_gap: { key: 'needs.catalog_gap', className: 'neutral', icon: Database },
  timeline_stale: { key: 'needs.timeline_stale', className: 'warning', icon: AlertTriangle },
  policy_change: { key: 'needs.policy_change', className: 'info', icon: FileCog },
}

const logSinkOptions: readonly {
  value: LogSink
  labelKey: string
  description: string
  connectionParams: Readonly<Record<string, string>>
}[] = [
  {
    value: 'file',
    labelKey: 'sink.file',
    description: '/var/log/otel/ai-agent.log',
    connectionParams: { path: '/var/log/otel/ai-agent.log' },
  },
  {
    value: 'loki',
    labelKey: 'sink.loki',
    description: 'http://loki:3100/otlp',
    connectionParams: { endpoint: 'http://loki:3100/otlp' },
  },
  {
    value: 'cloudwatch',
    labelKey: 'sink.cloudwatch',
    description: 'ap-northeast-1 /w3/ai-agent',
    connectionParams: {
      region: 'ap-northeast-1',
      log_group_name: '/w3/ai-agent',
      log_stream_name: 'ai-agent',
    },
  },
]

const trendPoints = [42, 46, 44, 55, 49, 63, 58, 67, 61, 74, 70, 78]

const sampleOverview: OverviewData = {
  counters_computed_at: '2026-08-28T11:31:04Z',
  counters: {
    alerts: 18,
    l0_absorbed: 11,
    l0_absorbed_is_estimate: true,
    ai_diagnosed: 7,
    auto_remediated: 4,
    notify_only: 3,
    verified: 3,
    verify_failed: 1,
    skipped_cooldown: 2,
  },
  needs_you: [
    { id: 41, kind: 'remediation', service: 'payments-api', action: 'rollback', waiting_seconds: 720, href: '/incidents/922' },
    { id: 922, kind: 'timeline_stale', service: 'auth-api', action: null, waiting_seconds: 420, href: '/incidents/922' },
    { id: 12, kind: 'policy_change', service: null, action: 'log_sink', waiting_seconds: 60, href: '/settings/log-sink' },
    { id: null, kind: 'catalog_gap', service: 'billing-api', action: null, waiting_seconds: null, href: null },
  ],
  recent: [
    { id: 922, service: 'auth-api', alertname: 'HighErrorRate', status: 'running', started_at: '2026-08-28T08:00:00+08:00' },
    { id: 918, service: 'orders-api', alertname: 'LatencyP95', status: 'verified', started_at: '2026-08-28T07:34:00+08:00' },
    { id: 914, service: 'payments-api', alertname: 'RollbackRequired', status: 'notify_only', started_at: '2026-08-28T06:22:00+08:00' },
  ],
}

const sampleScorecardLatest: ScorecardLatest = {
  scorecard_id: 'selfheal-readiness',
  name: 'Self-heal readiness',
  evaluated_at: null,
  services: [
    { service: 'inventory-api', checks: { catalog_entry: true, metrics_scraped: null }, passed: 1, total: 2 },
    { service: 'orders-api', checks: { catalog_entry: true, metrics_scraped: true }, passed: 2, total: 2 },
    { service: 'payments-api', checks: { catalog_entry: true, metrics_scraped: null }, passed: 1, total: 2 },
    { service: 'users-api', checks: { catalog_entry: true, metrics_scraped: true }, passed: 2, total: 2 },
  ],
  totals: { passed: 6, total: 8, percent: 75 },
}

const sampleIncident: IncidentDetail = {
  id: 922,
  service: 'auth-api',
  started_at: '2026-08-28T08:00:00+08:00',
  timeline_stale: true,
  agent_log_url: null,
  timeline: [
    { at: '2026-08-28T08:00:05+08:00', step: 'queued', detail: { alert: 'HighErrorRate' } },
    { at: '2026-08-28T08:00:11+08:00', step: 'sanitized', detail: { redacted: true } },
    { at: '2026-08-28T08:00:29+08:00', step: 'evidence_gathered', detail: { metrics: 4, events: 2 } },
    { at: '2026-08-28T08:01:03+08:00', step: 'judged', detail: { confidence: 0.78, decision: 'notify_only' } },
  ],
}

function App() {
  const [route, setRoute] = useState<RouteState>(() => routeFromPath(window.location.pathname))
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [theme, setTheme] = useStoredState<ThemeMode>('engops-theme', 'light')
  const [language, setLanguage] = useStoredState<LanguageMode>('engops-language-mode', 'both')
  const labels = useLabels(language)
  const muiTheme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: theme,
          primary: { main: theme === 'dark' ? '#86a3ff' : '#335cff' },
          background: {
            default: theme === 'dark' ? '#0d111a' : '#eef2f7',
            paper: theme === 'dark' ? '#121826' : '#ffffff',
          },
        },
        shape: { borderRadius: 8 },
        typography: {
          fontFamily: "Inter, 'Source Han Sans TC', 'Noto Sans TC', system-ui, sans-serif",
          button: { textTransform: 'none', fontWeight: 700 },
        },
      }),
    [theme],
  )

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    labels.changeLanguage(language)
  }, [labels, language])

  useEffect(() => {
    const syncRoute = () => setRoute(routeFromPath(window.location.pathname))
    window.addEventListener('popstate', syncRoute)
    return () => window.removeEventListener('popstate', syncRoute)
  }, [])

  const navigate = useCallback((href: string) => {
    window.history.pushState({}, '', href)
    setRoute(routeFromPath(href))
    setMobileNavOpen(false)
  }, [])

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={18} />
          </div>
          <div>
            <strong>EngOps</strong>
            <span>Control Plane</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Primary navigation">
          <NavButton active={route.name === 'overview'} icon={LayoutDashboard} label={labels.node('nav.operations')} onClick={() => navigate('/')} />
          <NavButton active={route.name === 'incident'} icon={AlertTriangle} label={labels.node('nav.incidents')} onClick={() => navigate('/incidents/922')} />
          <NavButton active={route.name === 'settings'} icon={Settings2} label={labels.node('nav.controls')} onClick={() => navigate('/settings/log-sink')} />
        </nav>

        <div className="sidebar-card">
          <span className="section-kicker">{labels.node('chrome.scorecard')}</span>
          <strong>87%</strong>
          <small>{labels.node('chrome.productionReadiness')}</small>
          <div className="mini-meter"><span style={{ width: '87%' }} /></div>
        </div>

        <div className="sidebar-footer">
          <div className="health-chip">
            <span className="live-dot" />
            <span>API</span>
            <code>/api/v1</code>
          </div>
          <div className="operator">
            <span className="avatar">YL</span>
            <div>
              <strong>Yun-Lin</strong>
              <small>On-call engineer</small>
            </div>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="icon-button mobile-only" type="button" aria-label="Open navigation" onClick={() => setMobileNavOpen((open) => !open)}>
            <Menu size={20} />
          </button>
          <div className="search-box">
            <Search size={16} />
            <span>{labels.node('chrome.search')}</span>
          </div>
          <div className="top-actions">
            <button className="top-select" type="button">{labels.node('chrome.production')}<ChevronDown size={15} /></button>
            <button className="top-select" type="button">{labels.node('chrome.last24h')}<ChevronDown size={15} /></button>
            <SegmentedControl
              ariaLabel="Language"
              icon={<Languages size={15} />}
              value={language}
              options={[
                { value: 'en', label: 'EN' },
                { value: 'zh', label: '中' },
                { value: 'both', label: 'Both' },
              ]}
              onChange={(next) => setLanguage(next as LanguageMode)}
            />
            <MuiThemeToggle value={theme} onChange={setTheme} />
            <button className="icon-button" type="button" aria-label="Refresh" onClick={() => window.location.reload()}>
              <RefreshCw size={17} />
            </button>
          </div>
        </header>

        {route.name === 'overview' && <OverviewPage labels={labels} navigate={navigate} />}
        {route.name === 'incident' && <IncidentPage labels={labels} incidentId={route.id} />}
        {route.name === 'settings' && <SettingsPage labels={labels} />}
      </main>
      </div>
    </ThemeProvider>
  )
}

export default App

function OverviewPage({ labels, navigate }: { labels: Labeler; navigate: (href: string) => void }) {
  const state = useApiResource('/api/v1/overview', sampleOverview)
  const scorecardState = useApiResource('/api/v1/scorecards/selfheal-readiness/latest', sampleScorecardLatest)
  const data = state.data
  const counters = data.counters
  const scorecard = scorecardState.data

  return (
    <div className="page">
      <PageHeader
        labels={labels}
        eyebrowKey="overview.eyebrow"
        titleKey="overview.title"
        descriptionKey="overview.description"
        side={<ApiBadge labels={labels} state={state} />}
      />

      <section className="metric-grid" aria-label="24 hour operational metrics">
        <MetricCard labels={labels} labelKey="overview.incidents" value={String(counters.alerts)} captionKey="overview.incidentsCaption" tone="default" />
        <MetricCard labels={labels} labelKey="overview.aiTriaged" value={String(counters.ai_diagnosed)} captionKey="overview.aiTriagedCaption" tone="info" />
        <MetricCard labels={labels} labelKey="overview.autoFixed" value={String(counters.auto_remediated)} captionKey="overview.verifiedCount" captionOptions={{ count: counters.verified }} tone="success" />
        <MetricCard labels={labels} labelKey="overview.notifyOnly" value={String(counters.notify_only)} captionKey="overview.cooldownCount" captionOptions={{ count: counters.skipped_cooldown }} tone="warning" />
        <MetricCard labels={labels} labelKey="overview.verifyFailed" value={String(counters.verify_failed)} captionKey="overview.manualReview" tone="danger" />
      </section>

      <section className="hero-panel">
        <div className="hero-copy">
          <span className="section-kicker">L0 Probe</span>
          <h2><strong>~{counters.l0_absorbed}</strong> {labels.node('overview.l0Title')}</h2>
          <p>{labels.node('overview.l0Description')}</p>
          {counters.l0_absorbed_is_estimate && <span className="estimate-label">{labels.node('common.estimated')}</span>}
        </div>
        <TrendCard labels={labels} />
      </section>

      <div className="work-grid">
        <section className="panel">
          <PanelTitle labels={labels} kickerKey="overview.actionQueue" titleKey="overview.openWork" meta={`${data.needs_you.length} items`} />
          <div className="needs-list">
            {data.needs_you.map((item) => (
              <NeedRow labels={labels} item={item} key={`${item.kind}:${item.id ?? item.service ?? 'global'}`} navigate={navigate} />
            ))}
          </div>
        </section>

        <section className="panel">
          <PanelTitle
            labels={labels}
            kickerKey="overview.serviceCatalog"
            titleKey="overview.productionPosture"
            meta={scorecard.evaluated_at ? labels.text('overview.synced', { time: formatDateTime(scorecard.evaluated_at) }) : scorecardSummary(scorecard)}
          />
          <div className="posture-list">
            {scorecard.services.length === 0 ? (
              <div className="posture-empty">{labels.node('overview.noScorecardResults')}</div>
            ) : (
              scorecard.services.map((service) => {
                const percent = scorePercent(service.passed, service.total)
                return (
                  <div className="posture-row" key={service.service}>
                    <span className="service-token"><Server size={15} /></span>
                    <div>
                      <strong>{service.service}</strong>
                      <small>{service.passed}/{service.total} checks</small>
                    </div>
                    <div className="score-cell">
                      <span>{percent === null ? 'N/A' : `${percent}%`}</span>
                      <small>{scoreStateLabel(percent)}</small>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </section>
      </div>

      <section className="panel table-panel">
        <PanelTitle labels={labels} kickerKey="overview.incidentActivity" titleKey="overview.recentIncidents" meta={labels.text('overview.synced', { time: formatDateTime(data.counters_computed_at) })} />
        <div className="recent-table" aria-label="Recent incidents">
          <div className="table-row table-head">
            <span>ID</span>
            <span>{labels.node('common.service')}</span>
            <span>{labels.node('common.status')}</span>
            <span>{labels.node('common.started')}</span>
            <span />
          </div>
          {data.recent.map((incident) => (
            <button className="table-row table-button" type="button" key={incident.id} onClick={() => navigate(`/incidents/${incident.id}`)}>
              <span className="mono">#{incident.id}</span>
              <span>
                <strong>{incident.service}</strong>
                <small>{incident.alertname ?? 'Unnamed alert'}</small>
              </span>
              <StatusPill labels={labels} status={incident.status} />
              <span>{formatDateTime(incident.started_at)}</span>
              <ArrowRight size={16} />
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function IncidentPage({ labels, incidentId }: { labels: Labeler; incidentId: string }) {
  const fallbackIncident = useMemo(
    () => ({ ...sampleIncident, id: Number.parseInt(incidentId, 10) || sampleIncident.id }),
    [incidentId],
  )
  const state = useApiResource(`/api/v1/incidents/${encodeURIComponent(incidentId)}`, fallbackIncident)
  const data = state.data
  const last = data.timeline.length > 0 ? data.timeline[data.timeline.length - 1] : null
  const staleAnchorAt = last?.at ?? data.started_at
  const staleAnchorLabel = last ? labels.text(stepKey(last.step)) : labels.text('incident.incidentCreated')
  const sinceLast = secondsSince(staleAnchorAt)

  return (
    <div className="page">
      <PageHeader
        labels={labels}
        eyebrowKey="incident.eyebrow"
        eyebrowOptions={{ id: data.id }}
        titleText={data.service}
        descriptionKey="incident.description"
        side={<ApiBadge labels={labels} state={state} />}
      />

      <div className="incident-summary">
        <StatusPill labels={labels} status={data.timeline_stale ? 'timeline_stale' : 'running'} />
        <span><Clock3 size={14} />{labels.node('incident.started', { time: formatDateTime(data.started_at) })}</span>
        <span><Server size={14} />{data.timeline.length} steps</span>
      </div>

      <div className="incident-layout">
        <section className="timeline-panel">
          <PanelTitle labels={labels} kickerKey="incident.timeline" titleKey="incident.investigation" meta={data.timeline_stale ? labels.text('status.stalled') : labels.text('status.running')} />

          {data.timeline.length === 0 ? (
            <div className="empty-timeline">
              <Clock3 size={20} />
              <div>
                <strong>{labels.node('incident.noEvents')}</strong>
                <p>{labels.node('incident.noEventsDescription')}</p>
              </div>
            </div>
          ) : (
            <div className="timeline">
              {data.timeline.map((item) => (
                <TimelineStep labels={labels} item={item} key={`${item.at}:${item.step}`} />
              ))}
            </div>
          )}

          {data.timeline_stale && (
            <div className="stale-callout">
              <AlertTriangle size={19} />
              <div>
                <h3>{labels.node('incident.stalledAfter', { step: staleAnchorLabel })}</h3>
                <p>{labels.node('incident.stalledDescription', { duration: fmtDur(sinceLast, labels) })}</p>
                {data.agent_log_url ? (
                  <a href={data.agent_log_url} target="_blank" rel="noreferrer">{labels.node('incident.openAgentLogs')} <ArrowUpRight size={14} /></a>
                ) : (
                  <span className="muted-note">{labels.node('incident.noLogLink')}</span>
                )}
              </div>
            </div>
          )}
        </section>

        <aside className="detail-panel">
          <div className="side-card">
            <span className="section-kicker">{labels.node('incident.aiAssessment')}</span>
            <div className="assessment-score">
              <Gauge size={20} />
              <strong>{confidenceFromTimeline(data.timeline)}</strong>
              <span>{labels.node('incident.confidence')}</span>
            </div>
            <p>{labels.node('incident.assessmentSource')}</p>
          </div>

          <div className="side-card">
            <span className="section-kicker">{labels.node('incident.accessBoundary')}</span>
            <ul className="boundary-list">
              <li><CheckCircle2 size={15} />{labels.node('incident.k8sReadOnly')}</li>
              <li><XCircle size={15} />{labels.node('incident.noRawLogs')}</li>
              <li><XCircle size={15} />{labels.node('incident.noRetriage')}</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  )
}

function SettingsPage({ labels }: { labels: Labeler }) {
  const [sink, setSink] = useState<LogSink>('file')
  const [submitState, setSubmitState] = useState<'idle' | 'pending' | 'success' | 'error'>('idle')
  const [error, setError] = useState('')
  const selected = logSinkOptions.find((option) => option.value === sink) ?? logSinkOptions[0]

  const submit = async () => {
    setSubmitState('pending')
    setError('')
    try {
      const response = await fetch('/api/v1/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'policy_change',
          action: 'log_sink',
          payload: {
            sink_type: sink,
            connection_params: { ...selected.connectionParams },
          },
        }),
      })

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`HTTP ${response.status}${detail ? ` - ${detail}` : ''}`)
      }
      setSubmitState('success')
    } catch (caught) {
      setSubmitState('error')
      setError(caught instanceof Error ? caught.message : 'Request failed')
    }
  }

  return (
    <div className="page">
      <PageHeader
        labels={labels}
        eyebrowKey="settings.eyebrow"
        titleKey="settings.title"
        descriptionKey="settings.description"
        side={<span className="readonly-pill"><ShieldCheck size={14} />{labels.node(writesEnabled ? 'settings.privateWriteMode' : 'settings.readOnly')}</span>}
      />

      <div className="settings-layout">
        <section className="settings-panel">
          <PanelTitle labels={labels} kickerKey="settings.destination" titleKey="settings.agentRouting" meta={labels.text(writesEnabled ? 'settings.editable' : 'settings.locked')} />

          {writesEnabled ? (
            <>
              <div className="sink-options" role="radiogroup" aria-label="Log sink destination">
                {logSinkOptions.map((option) => (
                  <button className={`sink-option ${sink === option.value ? 'selected' : ''}`} type="button" role="radio" aria-checked={sink === option.value} key={option.value} onClick={() => setSink(option.value)}>
                    <span className="radio-indicator" />
                    <span>
                      <strong>{labels.node(option.labelKey)}</strong>
                      <small>{option.description}</small>
                    </span>
                  </button>
                ))}
              </div>

              <div className="payload-preview">
                <span className="section-kicker">Payload</span>
                <pre>{JSON.stringify({ sink_type: sink, connection_params: selected.connectionParams }, null, 2)}</pre>
              </div>

              <div className="setting-action">
                <p>{labels.node('settings.creates')} <strong>policy_change / log_sink</strong> in <code>/api/v1/approvals</code></p>
                <button className="primary-button" type="button" disabled={submitState === 'pending'} onClick={submit}>
                  <GitPullRequest size={15} />
                  {labels.node(submitState === 'pending' ? 'settings.submitting' : 'settings.createProposal')}
                </button>
              </div>
              {submitState === 'success' && <p className="success-message" role="status"><CheckCircle2 size={16} />{labels.node('settings.proposalCreated')}</p>}
              {submitState === 'error' && <p className="error-message" role="alert"><AlertTriangle size={16} />{labels.node('settings.proposalFailed', { error })}</p>}
            </>
          ) : (
            <div className="readonly-panel">
              <ShieldCheck size={24} />
              <div>
                <h3>{labels.node('settings.writeDisabled')}</h3>
                <p>{labels.node('settings.writeDisabledDescription')}</p>
              </div>
            </div>
          )}
        </section>

        <aside className="policy-panel">
          <span className="section-kicker">{labels.node('common.policy')}</span>
          <h2>{labels.node('settings.controlledWrites')}</h2>
          <p>{labels.node('settings.controlledWritesDescription')}</p>
          <div className="policy-rule"><CheckCircle2 size={15} />{labels.node('settings.sameOrigin')}</div>
          <div className="policy-rule"><CheckCircle2 size={15} />{labels.node('settings.postHidden')}</div>
          <div className="policy-rule"><XCircle size={15} />{labels.node('settings.noApprovalPage')}</div>
        </aside>
      </div>
    </div>
  )
}

function NavButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: typeof LayoutDashboard; label: ReactNode; onClick: () => void }) {
  return <button className={`nav-button ${active ? 'active' : ''}`} type="button" onClick={onClick}><Icon size={17} /><span>{label}</span></button>
}

function NeedRow({ labels, item, navigate }: { labels: Labeler; item: NeedYou; navigate: (href: string) => void }) {
  const meta = needLabelKeys[item.kind] ?? { key: item.kind, className: 'neutral', icon: AlertTriangle }
  const Icon = meta.icon

  return (
    <div className="need-row">
      <span className={`need-kind ${meta.className}`}><Icon size={14} />{labels.node(meta.key)}</span>
      <div>
        <strong>{item.service ?? labels.text('needs.globalControl')}</strong>
        <small>{item.action ?? labels.text('needs.noPayload')}</small>
      </div>
      <span className="waiting">{fmtDur(item.waiting_seconds, labels)}</span>
      {item.href ? (
        <button className="link-button" type="button" onClick={() => navigate(item.href!)}>{labels.node('common.open')}<ArrowUpRight size={14} /></button>
      ) : (
        <span className="no-link">{labels.node('common.noRoute')}</span>
      )}
    </div>
  )
}

function TimelineStep({ labels, item }: { labels: Labeler; item: TimelineItem }) {
  return (
    <div className="timeline-item">
      <div className="timeline-marker">{timelineIcon(item.step)}</div>
      <div className="timeline-content">
        <div className="timeline-title">
          <strong>{labels.node(stepKey(item.step))}</strong>
          <time>{formatDateTime(item.at)}</time>
        </div>
        <p>{detailToText(item.detail)}</p>
      </div>
    </div>
  )
}

function MetricCard({ labels, labelKey, value, captionKey, captionOptions, tone }: { labels: Labeler; labelKey: string; value: string; captionKey: string; captionOptions?: Record<string, unknown>; tone: Tone }) {
  return <div className={`metric-card ${tone}`}><span>{labels.node(labelKey)}</span><strong>{value}</strong><small>{labels.node(captionKey, captionOptions)}</small></div>
}

function TrendCard({ labels }: { labels: Labeler }) {
  const path = trendPoints
    .map((point, index) => {
      const x = (index / (trendPoints.length - 1)) * 220
      const y = 90 - ((point - 40) / 40) * 74
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <div className="trend-card">
      <div className="trend-head">
        <div><span className="section-kicker">{labels.node('overview.reliabilityTrend')}</span><strong>MTTR -18%</strong></div>
        <span className="status-pill verified">{labels.node('overview.improving')}</span>
      </div>
      <svg viewBox="0 0 220 96" role="img" aria-label="Reliability trend">
        <path d={`${path} L 220 96 L 0 96 Z`} className="trend-fill" />
        <path d={path} className="trend-line" />
      </svg>
    </div>
  )
}

function PageHeader({ labels, eyebrowKey, eyebrowOptions, titleKey, titleText, descriptionKey, side }: { labels: Labeler; eyebrowKey: string; eyebrowOptions?: Record<string, unknown>; titleKey?: string; titleText?: string; descriptionKey: string; side?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <span className="section-kicker">{labels.node(eyebrowKey, eyebrowOptions)}</span>
        <h1>{titleText ?? (titleKey ? labels.node(titleKey) : null)}</h1>
        <p>{labels.node(descriptionKey)}</p>
      </div>
      {side}
    </div>
  )
}

function PanelTitle({ labels, kickerKey, titleKey, meta }: { labels: Labeler; kickerKey: string; titleKey: string; meta?: string }) {
  return (
    <div className="panel-header">
      <div><span className="section-kicker">{labels.node(kickerKey)}</span><h2>{labels.node(titleKey)}</h2></div>
      {meta ? <small>{meta}</small> : null}
    </div>
  )
}

function ApiBadge<T>({ labels, state }: { labels: Labeler; state: AsyncState<T> }) {
  if (state.status === 'loading') return <span className="api-badge loading"><Radio size={14} />{labels.node('common.syncing')}</span>
  if (state.fallback) return <span className="api-badge warning" title={state.error ?? undefined}><AlertTriangle size={14} />{labels.node('common.apiUnavailable')}</span>
  return <span className="api-badge ready"><CheckCircle2 size={14} />{labels.node('common.liveData')}</span>
}

function StatusPill({ labels, status }: { labels: Labeler; status: string }) {
  const key = status === 'timeline_stale' ? 'status.stalled' : `status.${status}`
  const normalized = status === 'timeline_stale' ? 'running' : status
  return <span className={`status-pill ${normalized}`}>{labels.node(key)}</span>
}

function SegmentedControl({ ariaLabel, icon, value, options, onChange }: { ariaLabel: string; icon: ReactNode; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return (
    <div className="segmented" aria-label={ariaLabel}>
      <span>{icon}</span>
      {options.map((option) => (
        <button className={option.value === value ? 'selected' : ''} type="button" key={option.value} onClick={() => onChange(option.value)}>{option.label}</button>
      ))}
    </div>
  )
}

function MuiThemeToggle({ value, onChange }: { value: ThemeMode; onChange: (value: ThemeMode) => void }) {
  const handleChange = (_event: MouseEvent<HTMLElement>, nextMode: ThemeMode | null) => {
    if (nextMode !== null) onChange(nextMode)
  }

  return (
    <MuiToggleButtonGroup
      exclusive
      size="small"
      value={value}
      aria-label="Theme mode"
      onChange={handleChange}
      sx={{
        height: 38,
        borderRadius: '9px',
        border: '1px solid var(--color-line)',
        backgroundColor: 'var(--color-surface)',
        padding: '3px',
        '& .MuiToggleButtonGroup-grouped': {
          minWidth: 32,
          border: 0,
          borderRadius: '7px !important',
          color: 'var(--color-ink-faint)',
          padding: '5px 7px',
          '&.Mui-selected': {
            color: 'var(--color-ink)',
            backgroundColor: 'var(--color-accent-soft)',
          },
          '&.Mui-selected:hover': {
            backgroundColor: 'var(--color-accent-soft)',
          },
        },
      }}
    >
      <MuiToggleButton value="light" aria-label="Light mode">
        <Sun size={15} />
      </MuiToggleButton>
      <MuiToggleButton value="dark" aria-label="Dark mode">
        <Moon size={15} />
      </MuiToggleButton>
    </MuiToggleButtonGroup>
  )
}

function BilingualText({ en, zh }: { en: string; zh: string }) {
  return <span className="bilingual"><span>{en}</span><small>{zh}</small></span>
}

function useLabels(mode: LanguageMode): Labeler & { changeLanguage: (mode: LanguageMode) => void } {
  const { t, i18n } = useTranslation()

  return useMemo(() => {
    const fixedEn = i18n.getFixedT('en')
    const fixedZh = i18n.getFixedT('zh')

    return {
      mode,
      changeLanguage: (next: LanguageMode) => {
        const nextLng = next === 'zh' ? 'zh' : 'en'
        if (i18n.language !== nextLng) void i18n.changeLanguage(nextLng)
      },
      text: (key: string, options?: Record<string, unknown>) => {
        if (mode === 'both') return `${fixedEn(key, options)} / ${fixedZh(key, options)}`
        return t(key, options)
      },
      node: (key: string, options?: Record<string, unknown>) => {
        if (mode === 'both') return <BilingualText en={fixedEn(key, options)} zh={fixedZh(key, options)} />
        return t(key, options)
      },
    }
  }, [i18n, mode, t])
}

function useStoredState<T extends string>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T | null) ?? fallback
    } catch {
      return fallback
    }
  })

  const update = useCallback(
    (next: T) => {
      setValue(next)
      try {
        localStorage.setItem(key, next)
      } catch {
        // Ignore storage errors in private browsing or locked-down consoles.
      }
    },
    [key],
  )

  return [value, update]
}

function useApiResource<T>(url: string, fallbackData: T): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T> & { url: string }>({ status: 'loading', data: fallbackData, error: null, fallback: false, url })

  useEffect(() => {
    let active = true
    fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return (await response.json()) as T
      })
      .then((data) => {
        if (active) setState({ status: 'ready', data, error: null, fallback: false, url })
      })
      .catch((caught) => {
        if (!active) return
        const message = caught instanceof Error ? caught.message : 'API request failed'
        setState({ status: 'error', data: fallbackData, error: `${url}: ${message}`, fallback: true, url })
      })

    return () => {
      active = false
    }
  }, [fallbackData, url])

  if (state.url !== url) return { status: 'loading', data: fallbackData, error: null, fallback: false }
  return state
}

function routeFromPath(pathname: string): RouteState {
  const incident = pathname.match(/^\/incidents\/([^/]+)$/)
  if (incident) return { name: 'incident', id: decodeURIComponent(incident[1]) }
  if (pathname === '/settings/log-sink') return { name: 'settings' }
  return { name: 'overview' }
}

function fmtDur(seconds: number | null, labels: Labeler): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return labels.text('common.unknownAge')
  if (seconds < 60) return labels.mode === 'zh' ? `${Math.floor(seconds)}秒` : `${Math.floor(seconds)}s`
  if (seconds < 3600) return labels.mode === 'zh' ? `${Math.floor(seconds / 60)}分鐘` : `${Math.floor(seconds / 60)}m`
  return labels.mode === 'zh' ? `${Math.floor(seconds / 3600)}小時` : `${Math.floor(seconds / 3600)}h`
}

function secondsSince(isoTime: string): number {
  const timestamp = Date.parse(isoTime)
  if (Number.isNaN(timestamp)) return 0
  return Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
}

function stepKey(step: string): string {
  return `steps.${step}`
}

function formatDateTime(isoTime: string): string {
  const timestamp = Date.parse(isoTime)
  if (Number.isNaN(timestamp)) return 'Unknown'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(timestamp)
}

function scorePercent(passed: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null
  return Math.round((passed / total) * 100)
}

function scoreStateLabel(score: number | null): string {
  if (score === null) return 'No result'
  if (score >= 80) return 'Passing'
  if (score >= 60) return 'Watch'
  return 'At risk'
}

function scorecardSummary(scorecard: ScorecardLatest): string {
  if (scorecard.totals.percent === null) return 'No scorecard result'
  return `${scorecard.name} ${scorecard.totals.percent}%`
}

function detailToText(detail: unknown): string {
  if (detail === null || detail === undefined) return 'No detail'
  if (typeof detail === 'string') return detail
  try {
    return JSON.stringify(detail)
  } catch {
    return 'Unserializable detail'
  }
}

function timelineIcon(step: string) {
  if (step === 'judged') return <Sparkles size={14} />
  if (step === 'failed') return <XCircle size={14} />
  if (step === 'verified') return <CheckCircle2 size={14} />
  if (step === 'remediated') return <RefreshCw size={14} />
  return <Clock3 size={14} />
}

function confidenceFromTimeline(timeline: TimelineItem[]): string {
  const judged = timeline.find((item) => item.step === 'judged')
  if (!judged || typeof judged.detail !== 'object' || judged.detail === null) return 'N/A'
  const confidence = (judged.detail as { confidence?: unknown }).confidence
  return typeof confidence === 'number' ? confidence.toFixed(2) : 'N/A'
}
