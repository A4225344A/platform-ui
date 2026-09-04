import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
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
  Clock3,
  Database,
  FileCog,
  Gauge,
  GitPullRequest,
  Languages,
  LayoutDashboard,
  ListOrdered,
  Menu,
  Moon,
  Radio,
  RefreshCw,
  ScrollText,
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
  | { name: 'approvals' }
  | { name: 'audit' }
  | { name: 'settings' }

type LanguageMode = 'en' | 'zh' | 'both'
type ThemeMode = 'light' | 'dark'
type Tone = 'default' | 'info' | 'success' | 'warning' | 'danger'
type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'all'

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
  window_hours: number
  counters: Counters
  needs_you: NeedYou[]
  recent: RecentIncident[]
}

type SearchServiceResult = {
  service: string
  display_name: string | null
  owner_team: string | null
  owner_email: string | null
}

type SearchIncidentResult = {
  id: number
  service: string
  alertname: string | null
  status: string
  started_at: string
}

type SearchResults = {
  query: string
  services: SearchServiceResult[]
  incidents: SearchIncidentResult[]
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

type ApprovalItem = {
  id: number
  kind: string
  service: string | null
  action: string | null
  payload: Record<string, unknown>
  incident_id: number | null
  trace_id: string | null
  status: string
  pr_number: number | null
  pr_url: string | null
  base_commit_sha: string | null
  requested_by: string
  requested_at: string
  expires_at: string
  decided_by: string | null
  decided_at: string | null
  decision_note: string | null
  waiting_seconds: number
}

type ApprovalListData = {
  status: string
  approvals: ApprovalItem[]
}

type AuditLogItem = {
  id: number
  at: string
  actor: string
  verb: string
  object: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  trace_id: string | null
}

type AuditLogListData = {
  audit_log: AuditLogItem[]
}

type ExecutionPlanStep = {
  order: number
  name: string
  command: string | null
  expected_result: string
}

type ApprovalExecutionPlan = {
  approval_id: number
  kind: string
  action: string | null
  status: string
  summary: string
  preconditions: string[]
  steps: ExecutionPlanStep[]
  retry_limit: number
  rollback: string
  requires_human_decision: boolean
  mutation_enabled: boolean
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

type AccuracyStats = {
  service: string
  verified: number
  failed: number
  notify_only: number
  remediation_rate: number | null
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

// MTTR 趨勢圖用的假資料，先不做（見 TrendCard 定義處的說明），跟著元件一起註解掉。
// const trendPoints = [42, 46, 44, 55, 49, 63, 58, 67, 61, 74, 70, 78]

const sampleOverview: OverviewData = {
  counters_computed_at: '2026-08-28T11:31:04Z',
  window_hours: 24,
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
    { id: 12, kind: 'policy_change', service: null, action: 'log_sink', waiting_seconds: 60, href: '/approvals' },
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

const sampleApprovals: ApprovalListData = {
  status: 'pending',
  approvals: [
    {
      id: 1,
      kind: 'policy_change',
      service: null,
      action: 'log_sink',
      payload: {
        sink_type: 'cloudwatch',
        connection_params: { region: 'ap-northeast-1', log_group: '/w3/ai-agent' },
      },
      incident_id: null,
      trace_id: null,
      status: 'pending',
      pr_number: null,
      pr_url: null,
      base_commit_sha: null,
      requested_by: 'lab-ui',
      requested_at: '2026-09-01T22:21:27.952918Z',
      expires_at: '2026-09-02T22:21:27.952918Z',
      decided_by: null,
      decided_at: null,
      decision_note: null,
      waiting_seconds: 34,
    },
  ],
}

const sampleAuditLog: AuditLogListData = {
  audit_log: [
    {
      id: 10,
      at: '2026-09-02T21:42:00Z',
      actor: 'operator',
      verb: 'secret.rotate',
      object: 'default/platform-secrets/engops-decision-token',
      before: null,
      after: {
        sha256: '3f4b2d9a8b3b4b9ef5e25a1f3c9e6b7df1c9d8292f4d5f948e6f424a9f1c2d3e',
        storage: 'kubernetes-secret',
        purpose: 'engops approval decision endpoint',
      },
      trace_id: null,
    },
  ],
}

const sampleExecutionPlan: ApprovalExecutionPlan = {
  approval_id: 1,
  kind: 'policy_change',
  action: 'log_sink',
  status: 'pending',
  summary: 'Preview policy_change/log_sink to cloudwatch (log_group=/w3/ai-agent, region=ap-northeast-1).',
  preconditions: [
    'approval status must still be pending',
    'operator must use the internal decision endpoint with ENGOPS_DECISION_TOKEN',
    'CloudFront public entry remains read-only and must not allow POST mutation',
  ],
  steps: [
    { order: 1, name: 'Create GitOps change', command: null, expected_result: 'A pull request changes only the log sink manifest or configuration.' },
    { order: 2, name: 'Review bounded diff', command: null, expected_result: 'Reviewer confirms the diff is limited to the approved log sink target.' },
    { order: 3, name: 'Merge and sync', command: 'argocd app sync platform-apps', expected_result: 'ArgoCD applies the merged GitOps state.' },
    { order: 4, name: 'Verify log route', command: null, expected_result: 'otel-collector and ai-agent stay ready and logs arrive at the approved sink.' },
  ],
  retry_limit: 2,
  rollback: 'Revert the GitOps commit or PR, sync platform-apps, and record the rollback in audit_log.',
  requires_human_decision: true,
  mutation_enabled: false,
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
    { at: '2026-08-28T08:01:03+08:00', step: 'judged', detail: { action: 'notify_only', reason: 'Error rate elevated but within the service tier policy; escalating to on-call instead of auto-remediating.' } },
  ],
}

const sampleAccuracy: AccuracyStats = { service: 'auth-api', verified: 0, failed: 0, notify_only: 0, remediation_rate: null }

function App() {
  const [route, setRoute] = useState<RouteState>(() => routeFromPath(window.location.pathname))
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [theme, setTheme] = useStoredState<ThemeMode>('engops-theme', 'light')
  const [language, setLanguage] = useStoredState<LanguageMode>('engops-language-mode', 'both')
  const [operatorName, setOperatorName] = useStoredState<string>('engops-operator-name', 'lab-ui')
  const [windowHours, setWindowHours] = useState(24)
  const apiHealthy = useApiHealth()
  const sidebarScorecard = useApiResource('/api/v1/scorecards/selfheal-readiness/latest', sampleScorecardLatest)
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
          <NavButton active={route.name === 'approvals'} icon={GitPullRequest} label={labels.node('nav.reviews')} onClick={() => navigate('/approvals')} />
          <NavButton active={route.name === 'audit'} icon={ScrollText} label={labels.node('nav.audit')} onClick={() => navigate('/audit-log')} />
          <NavButton active={route.name === 'settings'} icon={Settings2} label={labels.node('nav.controls')} onClick={() => navigate('/settings/log-sink')} />
        </nav>

        <div className="sidebar-card">
          <span className="section-kicker">{labels.node('chrome.scorecard')}</span>
          <strong>{sidebarScorecard.data.totals.percent === null ? 'N/A' : `${sidebarScorecard.data.totals.percent}%`}</strong>
          <small>{labels.node('chrome.productionReadiness')}</small>
          <div className="mini-meter"><span style={{ width: `${sidebarScorecard.data.totals.percent ?? 0}%` }} /></div>
        </div>

        <div className="sidebar-footer">
          <div className="health-chip" title={apiHealthy === false ? labels.text('common.apiUnavailable') : undefined}>
            <span className={`live-dot${apiHealthy === false ? ' down' : apiHealthy === null ? ' pending' : ''}`} />
            <span>API</span>
            <code>/api/v1</code>
          </div>
          <button
            className="operator"
            type="button"
            title={labels.text('chrome.operatorEdit')}
            onClick={() => {
              const next = window.prompt(labels.text('chrome.operatorEdit'), operatorName)
              if (next && next.trim()) setOperatorName(next.trim())
            }}
          >
            <span className="avatar">{operatorInitials(operatorName)}</span>
            <div>
              <strong>{operatorName}</strong>
              <small>{labels.node('chrome.operatorRole')}</small>
            </div>
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="icon-button mobile-only" type="button" aria-label="Open navigation" onClick={() => setMobileNavOpen((open) => !open)}>
            <Menu size={20} />
          </button>
          <SearchBox labels={labels} navigate={navigate} />
          <div className="top-actions">
            <SegmentedControl
              ariaLabel="Time window"
              icon={<Clock3 size={15} />}
              value={String(windowHours)}
              options={[
                { value: '1', label: '1h' },
                { value: '6', label: '6h' },
                { value: '24', label: '24h' },
                { value: '168', label: '7d' },
              ]}
              onChange={(next) => setWindowHours(Number(next))}
            />
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

        {route.name === 'overview' && <OverviewPage labels={labels} navigate={navigate} windowHours={windowHours} />}
        {route.name === 'incident' && <IncidentPage labels={labels} incidentId={route.id} />}
        {route.name === 'approvals' && <ApprovalsPage labels={labels} />}
        {route.name === 'audit' && <AuditLogPage labels={labels} />}
        {route.name === 'settings' && <SettingsPage labels={labels} />}
      </main>
      </div>
    </ThemeProvider>
  )
}

export default App

function AuditLogPage({ labels }: { labels: Labeler }) {
  const state = useApiResource('/api/v1/audit-log?limit=50', sampleAuditLog)

  if (state.status === 'loading') return <PageSkeleton panels={1} />

  const data = state.data

  return (
    <div className="page">
      <PageHeader
        labels={labels}
        eyebrowKey="audit.eyebrow"
        titleKey="audit.title"
        descriptionKey="audit.description"
        side={<ApiBadge labels={labels} state={state} />}
      />

      <section className="panel">
        <PanelTitle labels={labels} kickerKey="audit.activity" titleKey="audit.recent" meta={`${data.audit_log.length} items`} />
        {data.audit_log.length === 0 ? (
          <div className="empty-approvals">
            <ShieldCheck size={22} />
            <span>{labels.node('audit.empty')}</span>
          </div>
        ) : (
          <div className="audit-list">
            {data.audit_log.map((entry) => (
              <article className="approval-card audit-card" key={entry.id}>
                <div className="approval-head">
                  <div>
                    <span className="section-kicker">#{entry.id} {formatDateTime(entry.at)}</span>
                    <h2>{entry.verb}</h2>
                  </div>
                  <span className="readonly-pill"><ShieldCheck size={14} />{labels.node('audit.readOnly')}</span>
                </div>
                <div className="approval-meta">
                  <span><Clock3 size={14} />{formatDateTime(entry.at)}</span>
                  <span>{labels.node('audit.actor', { actor: entry.actor })}</span>
                  {entry.trace_id ? <span>{labels.node('audit.trace', { trace: entry.trace_id })}</span> : null}
                </div>
                <div className="audit-object">
                  <span className="section-kicker">{labels.node('audit.object')}</span>
                  <code>{entry.object}</code>
                </div>
                <pre className="approval-payload">{JSON.stringify({ before: entry.before, after: entry.after }, null, 2)}</pre>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function ApprovalsPage({ labels }: { labels: Labeler }) {
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus>('pending')
  const [expandedPlanId, setExpandedPlanId] = useState<number | null>(null)
  const fallbackApprovals = useMemo(
    () => ({
      status: approvalStatus,
      approvals: approvalStatus === 'pending' || approvalStatus === 'all' ? sampleApprovals.approvals : [],
    }),
    [approvalStatus],
  )
  const state = useApiResource(`/api/v1/approvals?status=${approvalStatus}`, fallbackApprovals)

  if (state.status === 'loading') return <PageSkeleton panels={2} />

  const data = state.data

  return (
    <div className="page">
      <PageHeader
        labels={labels}
        eyebrowKey="approvals.eyebrow"
        titleKey="approvals.title"
        descriptionKey="approvals.description"
        side={<ApiBadge labels={labels} state={state} />}
      />

      <section className="panel">
        <div className="approval-toolbar">
          <PanelTitle labels={labels} kickerKey="approvals.queue" titleKey="approvals.history" meta={`${data.approvals.length} items`} />
          <SegmentedControl
            ariaLabel={labels.text('approvals.statusFilter')}
            icon={<GitPullRequest size={15} />}
            value={approvalStatus}
            options={[
              { value: 'pending', label: labels.text('approvals.statusPending') },
              { value: 'approved', label: labels.text('approvals.statusApproved') },
              { value: 'rejected', label: labels.text('approvals.statusRejected') },
              { value: 'expired', label: labels.text('approvals.statusExpired') },
              { value: 'all', label: labels.text('approvals.statusAll') },
            ]}
            onChange={(next) => setApprovalStatus(next as ApprovalStatus)}
          />
        </div>
        {data.approvals.length === 0 ? (
          <div className="empty-approvals">
            <ShieldCheck size={22} />
            <span>{labels.node('approvals.empty')}</span>
          </div>
        ) : (
          <div className="approval-list">
            {data.approvals.map((approval) => (
              <article className="approval-card" key={approval.id}>
                <div className="approval-head">
                  <div>
                    <span className="section-kicker">#{approval.id} {approval.kind}</span>
                    <h2>{approval.action ?? labels.text('needs.noPayload')}</h2>
                  </div>
                  <StatusPill labels={labels} status={approval.status} />
                </div>
                <div className="approval-meta">
                  <span><Clock3 size={14} />{fmtDur(approval.waiting_seconds, labels)}</span>
                  <span>{labels.node('approvals.requestedBy', { actor: approval.requested_by })}</span>
                  <span>{labels.node('approvals.expires', { time: formatDateTime(approval.expires_at) })}</span>
                  {approval.decided_by ? <span>{labels.node('approvals.decidedBy', { actor: approval.decided_by })}</span> : null}
                </div>
                {approval.decision_note || approval.base_commit_sha || approval.pr_url ? (
                  <div className="approval-details">
                    {approval.decision_note ? <span>{labels.node('approvals.decisionNote', { note: approval.decision_note })}</span> : null}
                    {approval.base_commit_sha ? <code>{approval.base_commit_sha}</code> : null}
                    {approval.pr_url ? (
                      <a className="pr-link" href={approval.pr_url} target="_blank" rel="noreferrer">
                        <GitPullRequest size={13} />
                        {labels.node('approvals.linkedPr', { number: approval.pr_number ?? '?' })}
                        <ArrowUpRight size={13} />
                      </a>
                    ) : null}
                  </div>
                ) : null}
                <pre className="approval-payload">{JSON.stringify(approval.payload, null, 2)}</pre>
                <button
                  className="link-button plan-toggle"
                  type="button"
                  aria-expanded={expandedPlanId === approval.id}
                  onClick={() => setExpandedPlanId((current) => (current === approval.id ? null : approval.id))}
                >
                  <ListOrdered size={14} />
                  {labels.node(expandedPlanId === approval.id ? 'approvals.hidePlan' : 'approvals.viewPlan')}
                </button>
                {expandedPlanId === approval.id ? <ExecutionPlanPanel labels={labels} approvalId={approval.id} /> : null}
                <div className="approval-note">
                  <ShieldCheck size={15} />
                  <span>{labels.node('approvals.readOnlyGuard')}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function ExecutionPlanPanel({ labels, approvalId }: { labels: Labeler; approvalId: number }) {
  const fallback = useMemo(() => ({ ...sampleExecutionPlan, approval_id: approvalId }), [approvalId])
  const state = useApiResource(`/api/v1/approvals/${approvalId}/execution-plan`, fallback)

  if (state.status === 'loading') {
    return (
      <div className="execution-plan" aria-busy="true" aria-live="polite">
        <div className="skeleton-block skeleton-panel" />
      </div>
    )
  }

  const data = state.data

  return (
    <div className="execution-plan">
      <div className="execution-plan-head">
        <span className="section-kicker">{labels.node('approvals.planKicker')}</span>
        <ApiBadge labels={labels} state={state} />
      </div>
      <p className="execution-plan-summary">{data.summary}</p>

      {data.preconditions.length > 0 && (
        <div className="execution-plan-block">
          <span className="section-kicker">{labels.node('approvals.planPreconditions')}</span>
          <ul className="execution-plan-preconditions">
            {data.preconditions.map((item) => (
              <li key={item}><ShieldCheck size={13} />{item}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="execution-plan-block">
        <span className="section-kicker">{labels.node('approvals.planSteps')}</span>
        {data.steps.length === 0 ? (
          <span className="muted-note">{labels.node('approvals.planEmpty')}</span>
        ) : (
          <ol className="execution-plan-steps">
            {data.steps.map((step) => (
              <li key={step.order}>
                <strong>{step.name}</strong>
                {step.command ? <code>{step.command}</code> : null}
                <span>{step.expected_result}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="execution-plan-block">
        <span className="section-kicker">{labels.node('approvals.planRollback')}</span>
        <p>{data.rollback}</p>
      </div>

      <div className="approval-note">
        <ShieldCheck size={15} />
        <span>{labels.node('approvals.planReadOnlyGuard', { retries: data.retry_limit })}</span>
      </div>
      <div className="approval-note">
        <ShieldCheck size={15} />
        <span>{labels.node('approvals.planMutationDisabled')}</span>
      </div>
    </div>
  )
}

function OverviewPage({ labels, navigate, windowHours }: { labels: Labeler; navigate: (href: string) => void; windowHours: number }) {
  const state = useApiResource(`/api/v1/overview?window_hours=${windowHours}`, sampleOverview)
  const scorecardState = useApiResource('/api/v1/scorecards/selfheal-readiness/latest', sampleScorecardLatest)
  const [needsKind, setNeedsKind] = useState('all')
  const [needsService, setNeedsService] = useState('all')

  if (state.status === 'loading') return <PageSkeleton panels={3} />

  const data = state.data
  const counters = data.counters
  const scorecard = scorecardState.data
  const windowLabel = windowHours >= 24 && windowHours % 24 === 0 ? `${windowHours / 24}d` : `${windowHours}h`
  const needsKindOptions = Array.from(new Set(data.needs_you.map((item) => item.kind)))
  const needsServiceOptions = Array.from(
    new Set(data.needs_you.map((item) => item.service).filter((service): service is string => service !== null)),
  )
  const filteredNeeds = data.needs_you.filter(
    (item) => (needsKind === 'all' || item.kind === needsKind) && (needsService === 'all' || item.service === needsService),
  )

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
        <MetricCard labels={labels} labelKey="overview.incidents" value={String(counters.alerts)} captionKey="overview.incidentsCaption" captionOptions={{ window: windowLabel }} tone="default" />
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
        {/* MTTR 趨勢圖（TrendCard）先不做：後端目前沒有任何 MTTR 計算依據
            （remediation_log 有時間戳記，但從未聚合成時間序列），要做到真的
            得先定義 MTTR 怎麼算、抓多長窗口，這是超出當前修復範圍的新功能，
            決定先保留元件/資料結構、註解掉渲染，等之後真的要做 MTTR 時再打開，
            不要用假數字充版面。 */}
        {/* <TrendCard labels={labels} /> */}
      </section>

      <div className="work-grid">
        <section className="panel">
          <div className="needs-toolbar">
            <PanelTitle labels={labels} kickerKey="overview.actionQueue" titleKey="overview.openWork" meta={`${filteredNeeds.length} items`} />
            <div className="needs-filters">
              <select
                className="needs-filter-select"
                aria-label={labels.text('overview.filterByStatus')}
                value={needsKind}
                onChange={(event) => setNeedsKind(event.target.value)}
              >
                <option value="all">{labels.text('overview.allStatuses')}</option>
                {needsKindOptions.map((kind) => (
                  <option key={kind} value={kind}>{labels.text(needLabelKeys[kind]?.key ?? kind)}</option>
                ))}
              </select>
              <select
                className="needs-filter-select"
                aria-label={labels.text('overview.filterByService')}
                value={needsService}
                onChange={(event) => setNeedsService(event.target.value)}
              >
                <option value="all">{labels.text('overview.allServices')}</option>
                {needsServiceOptions.map((service) => (
                  <option key={service} value={service}>{service}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="needs-list">
            {filteredNeeds.length === 0 ? (
              <div className="empty-approvals">
                <ShieldCheck size={22} />
                <span>{labels.node('overview.noMatchingWork')}</span>
              </div>
            ) : (
              filteredNeeds.map((item) => (
                <NeedRow labels={labels} item={item} key={`${item.kind}:${item.id ?? item.service ?? 'global'}`} navigate={navigate} />
              ))
            )}
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

  const fallbackAccuracy = useMemo(() => ({ ...sampleAccuracy, service: data.service }), [data.service])
  const accuracy = useApiResource(`/api/v1/accuracy?service=${encodeURIComponent(data.service)}`, fallbackAccuracy)
  const judgedDetail = judgedDetailFromTimeline(data.timeline)
  const guardDetail = guardDetailFromTimeline(data.timeline)

  if (state.status === 'loading') return <PageSkeleton panels={2} />

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

          <IncidentAskBox labels={labels} incidentId={data.id} />
        </section>

        <aside className="detail-panel">
          <div className="side-card">
            <span className="section-kicker">{labels.node('incident.aiAssessment')}</span>
            {judgedDetail ? (
              <>
                <div className="assessment-score">
                  <Sparkles size={20} />
                  <strong>{labels.node(actionLabelKey(judgedDetail.action))}</strong>
                </div>
                <p>{typeof judgedDetail.reason === 'string' ? judgedDetail.reason : labels.node('incident.aiNoReason')}</p>
              </>
            ) : (
              <p>{labels.node('incident.aiNoJudgment')}</p>
            )}
          </div>

          <div className="side-card">
            <span className="section-kicker">{labels.node('incident.guardChecks')}</span>
            <p>{guardExplanation(labels, guardDetail)}</p>
          </div>

          <div className="side-card">
            <span className="section-kicker">{labels.node('incident.trackRecord')}</span>
            <div className="assessment-score">
              <Gauge size={20} />
              <strong>{accuracy.data.remediation_rate !== null ? `${Math.round(accuracy.data.remediation_rate * 100)}%` : 'N/A'}</strong>
            </div>
            {accuracy.data.remediation_rate !== null ? (
              <p>{labels.node('incident.trackRecordSummary', { verified: accuracy.data.verified, failed: accuracy.data.failed, notifyOnly: accuracy.data.notify_only })}</p>
            ) : (
              <p>{labels.node('incident.trackRecordEmpty', { service: data.service })}</p>
            )}
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

type AskEntry = { question: string; answer: string }

function IncidentAskBox({ labels, incidentId }: { labels: Labeler; incidentId: number }) {
  const [question, setQuestion] = useState('')
  const [entries, setEntries] = useState<AskEntry[]>([])
  const [state, setState] = useState<'idle' | 'pending' | 'error'>('idle')
  const [error, setError] = useState('')

  // 只問這一筆事故已存的紀錄——ai-agent 端沒有任何工具呼叫能力,
  // 這裡不是通用聊天室,問其他事故或即時系統狀態一律問不到。
  const ask = async () => {
    const trimmed = question.trim()
    if (!trimmed || state === 'pending') return
    setState('pending')
    setError('')
    try {
      // 刻意用 GET:CloudFront 的 /api/* 只允許 GET/HEAD/OPTIONS,POST 會在 edge 層被原生 403 擋掉。
      const response = await fetch(`/api/v1/incidents/${incidentId}/ask?question=${encodeURIComponent(trimmed)}`)
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`HTTP ${response.status}${detail ? ` - ${detail}` : ''}`)
      }
      const body = (await response.json()) as { answer: string }
      setEntries((prev) => [...prev, { question: trimmed, answer: body.answer }])
      setQuestion('')
      setState('idle')
    } catch (caught) {
      setState('error')
      setError(caught instanceof Error ? caught.message : 'Request failed')
    }
  }

  return (
    <div className="ask-panel">
      <PanelTitle labels={labels} kickerKey="incident.askKicker" titleKey="incident.askTitle" />
      <p className="muted-note">{labels.node('incident.askScope')}</p>

      {entries.length > 0 && (
        <div className="ask-history">
          {entries.map((entry, index) => (
            <div className="ask-entry" key={index}>
              <p className="ask-question"><strong>{labels.text('incident.askYou')}</strong> {entry.question}</p>
              <p className="ask-answer"><Sparkles size={14} /><span><strong>{labels.text('incident.askAgent')}</strong> {entry.answer}</span></p>
            </div>
          ))}
        </div>
      )}

      <div className="ask-input-row">
        <input
          type="text"
          value={question}
          maxLength={500}
          placeholder={labels.text('incident.askPlaceholder')}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void ask()
          }}
          disabled={state === 'pending'}
        />
        <button className="primary-button" type="button" disabled={state === 'pending' || question.trim().length === 0} onClick={() => void ask()}>
          {labels.node(state === 'pending' ? 'incident.askSending' : 'incident.askSend')}
        </button>
      </div>
      {state === 'error' && <p className="error-message" role="alert"><AlertTriangle size={16} />{error}</p>}
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

// TrendCard 先不做：這張卡片畫的是完全寫死的 12 點折線加一個固定的 "MTTR -18%"
// 字串，不管系統實際狀態如何都是同一組數字，跟 scorecard 之前那個 stub 是同一類
// 問題。差別是後端目前完全沒有 MTTR 的計算依據（remediation_log 有 created_at/
// verified，但沒人算過任何時間序列），要做到真的等於是要生一個新的分析端點，
// 超出這次「補起來」的範圍。決定先保留元件/資料結構、註解掉不渲染，之後真的
// 要做 MTTR 趨勢時再打開，而不是留著顯示假資料。用到時記得同步打開
// App.css 裡的 .trend-card / .trend-head / .trend-line / .trend-fill，
// 以及 i18n.ts 裡的 overview.reliabilityTrend / overview.improving，
// 並把 .hero-panel 的 grid-template-columns 改回 minmax(0, 1fr) 320px。
//
// function TrendCard({ labels }: { labels: Labeler }) {
//   const path = trendPoints
//     .map((point, index) => {
//       const x = (index / (trendPoints.length - 1)) * 220
//       const y = 90 - ((point - 40) / 40) * 74
//       return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
//     })
//     .join(' ')
//
//   return (
//     <div className="trend-card">
//       <div className="trend-head">
//         <div><span className="section-kicker">{labels.node('overview.reliabilityTrend')}</span><strong>MTTR -18%</strong></div>
//         <span className="status-pill verified">{labels.node('overview.improving')}</span>
//       </div>
//       <svg viewBox="0 0 220 96" role="img" aria-label="Reliability trend">
//         <path d={`${path} L 220 96 L 0 96 Z`} className="trend-fill" />
//         <path d={path} className="trend-line" />
//       </svg>
//     </div>
//   )
// }

function PageSkeleton({ panels = 2 }: { panels?: number }) {
  return (
    <div className="page skeleton-page" aria-busy="true" aria-live="polite">
      <div className="skeleton-block skeleton-title" />
      <div className="skeleton-block skeleton-line" />
      <div className="skeleton-grid">
        {Array.from({ length: panels }, (_, index) => (
          <div className="skeleton-block skeleton-panel tall" key={index} />
        ))}
      </div>
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

function SearchBox({ labels, navigate }: { labels: Labeler; navigate: (href: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) return
    let active = true
    const timer = window.setTimeout(() => {
      fetch(`/api/v1/search?q=${encodeURIComponent(term)}`)
        .then((response) => (response.ok ? (response.json() as Promise<SearchResults>) : Promise.reject(new Error(`HTTP ${response.status}`))))
        .then((data) => {
          if (active) setResults(data)
        })
        .catch(() => {
          if (active) setResults(null)
        })
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [query])

  const trimmed = query.trim()
  const showPanel = open && trimmed.length >= 2
  const hasResults = results !== null && (results.services.length > 0 || results.incidents.length > 0)

  return (
    <div className="search-box" onBlur={() => window.setTimeout(() => setOpen(false), 150)}>
      <Search size={16} />
      <input
        type="text"
        value={query}
        placeholder={labels.text('chrome.search')}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
      />
      {showPanel && (
        <div className="search-results">
          {!hasResults && <div className="search-empty">{labels.node('chrome.searchEmpty')}</div>}
          {results?.incidents.map((incident) => (
            <button
              className="search-result-row"
              type="button"
              key={`incident-${incident.id}`}
              onMouseDown={() => {
                navigate(`/incidents/${incident.id}`)
                setQuery('')
                setOpen(false)
              }}
            >
              <AlertTriangle size={14} />
              <span>#{incident.id} {incident.service} — {incident.alertname ?? incident.status}</span>
            </button>
          ))}
          {results?.services.map((service) => (
            <div className="search-result-row search-result-static" key={`service-${service.service}`}>
              <Server size={14} />
              <span>{service.display_name ?? service.service}{service.owner_team ? ` — ${service.owner_team}` : ''}</span>
            </div>
          ))}
        </div>
      )}
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
  const query = useQuery<T, Error>({
    queryKey: [url],
    queryFn: async () => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return (await response.json()) as T
    },
    staleTime: 15_000,
  })

  // query.data survives across mounts (cached by queryKey), so switching tabs and
  // back shows the last known-good payload immediately instead of replaying the
  // fallback-sample -> real-data swap that used to cause the visible flicker.
  if (query.data !== undefined) return { status: 'ready', data: query.data, error: null, fallback: false }
  if (query.isError) return { status: 'error', data: fallbackData, error: `${url}: ${query.error.message}`, fallback: true }
  return { status: 'loading', data: fallbackData, error: null, fallback: false }
}

function useApiHealth(): boolean | null {
  const [healthy, setHealthy] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    const check = () => {
      fetch('/healthz')
        .then((response) => {
          if (active) setHealthy(response.ok)
        })
        .catch(() => {
          if (active) setHealthy(false)
        })
    }
    check()
    const interval = window.setInterval(check, 30000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])

  return healthy
}

function routeFromPath(pathname: string): RouteState {
  const incident = pathname.match(/^\/incidents\/([^/]+)$/)
  if (incident) return { name: 'incident', id: decodeURIComponent(incident[1]) }
  if (pathname === '/approvals') return { name: 'approvals' }
  if (pathname === '/audit-log') return { name: 'audit' }
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

function operatorInitials(name: string): string {
  const letters = name.trim().match(/[A-Za-z0-9一-鿿]/g)
  if (!letters || letters.length === 0) return '?'
  return letters.slice(0, 2).join('').toUpperCase()
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

type JudgedDetail = { action?: unknown; reason?: unknown }
type GuardDetail = {
  downgraded_by?: unknown
  tier_policy?: unknown
  l2_policy?: unknown
}

function judgedDetailFromTimeline(timeline: TimelineItem[]): JudgedDetail | null {
  const judged = timeline.find((item) => item.step === 'judged')
  if (!judged || typeof judged.detail !== 'object' || judged.detail === null) return null
  return judged.detail as JudgedDetail
}

function guardDetailFromTimeline(timeline: TimelineItem[]): GuardDetail | null {
  const guarded = timeline.find((item) => item.step === 'guarded')
  if (!guarded || typeof guarded.detail !== 'object' || guarded.detail === null) return null
  return guarded.detail as GuardDetail
}

function actionLabelKey(action: unknown): string {
  if (action === 'restart') return 'incident.actionRestart'
  if (action === 'rollback') return 'incident.actionRollback'
  return 'incident.actionNotifyOnly'
}

// 只有五道降級檢查裡「有降級」時才需要解釋給人看;沒降級就是模型判斷照原樣執行。
function guardExplanation(labels: Labeler, guard: GuardDetail | null): string {
  if (!guard || !guard.downgraded_by) return labels.text('incident.guardClear')
  if (typeof guard.tier_policy === 'string' && guard.tier_policy) return guard.tier_policy
  if (typeof guard.l2_policy === 'string' && guard.l2_policy) return guard.l2_policy
  if (guard.downgraded_by === 'target_mismatch') return labels.text('incident.guardReasonTargetMismatch')
  if (guard.downgraded_by === 'human_approval_required') return labels.text('incident.guardReasonHumanApproval')
  if (guard.downgraded_by === 'circuit_breaker') return labels.text('incident.guardReasonCircuitBreaker')
  return labels.text('incident.guardReasonUnknown')
}
