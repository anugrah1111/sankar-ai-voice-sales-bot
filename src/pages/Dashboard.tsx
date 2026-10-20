import { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, AudioLines, Headphones, MessageSquareText, PhoneCall, Plus, Sparkles, Users, WalletCards, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CallRecord } from '../../shared/types';
import { api, formatDate, formatDuration, type DashboardResponse } from '../api';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/StatusBadge';

function MetricCard({ label, value, detail, icon: Icon, tint, trend }: { label: string; value: string | number; detail: string; icon: LucideIcon; tint: string; trend?: 'up' | 'down' }) {
  return <article className="metric-card"><div className="metric-top"><span>{label}</span><span className={`metric-icon ${tint}`}><Icon size={18} /></span></div><div className="metric-value">{value}</div><div className="metric-detail">{trend && <span className={`trend trend-${trend}`}>{trend === 'up' ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}</span>}{detail}</div></article>;
}

function RecentCallsTable({ calls }: { calls: CallRecord[] }) {
  return <div className="table-scroll"><table className="data-table"><thead><tr><th>Customer</th><th>Product</th><th>Duration</th><th>Call date</th><th>Sales status</th><th /></tr></thead><tbody>{calls.map((call) => <tr key={call.id} onClick={() => { window.location.href = `/calls/${call.id}`; }} className="clickable-row"><td><div className="customer-cell"><span className="avatar avatar-soft">{call.customerName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</span><div><strong>{call.customerName}</strong><span>{call.recordingAvailable ? 'Recording saved' : 'Call complete'}</span></div></div></td><td><span className="table-product">{call.productName}</span></td><td>{formatDuration(call.durationSeconds)}</td><td>{formatDate(call.startedAt)}</td><td><StatusBadge status={call.status} /></td><td className="table-arrow"><ArrowRight size={16} /></td></tr>)}</tbody></table></div>;
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    api.get<DashboardResponse>('/api/dashboard').then((response) => { if (mounted) setData(response); }).catch((reason: Error) => { if (mounted) setError(reason.message); }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);
  const stats = data?.stats;
  return <div className="page page-dashboard">
    <div className="page-header dashboard-heading">
      <div><div className="eyebrow"><span className="eyebrow-line" /> SALES OVERVIEW</div><h1>Good morning<span className="heading-comma">,</span> team</h1><p className="page-subtitle">A clear picture of the conversations moving your pipeline forward.</p></div>
      <Link to="/new-call" className="button button-primary"><Plus size={18} /> Start new call</Link>
    </div>
    {error && <div className="alert alert-error" role="alert"><strong>Dashboard could not load.</strong> {error}<button onClick={() => window.location.reload()}>Try again</button></div>}
    {stats && (!stats.aiConfigured || stats.aiAvailable === false) && <div className="mode-notice"><span className="mode-notice-icon"><Sparkles size={16} /></span><span><strong>{stats.provider === 'ollama' ? stats.aiAvailable === false ? 'Ollama inference failed.' : 'Ollama is not ready.' : 'Local rule-based mode is active.'}</strong> {stats.provider === 'ollama' ? stats.aiAvailable === false ? 'The last model request failed. Replies are clearly labeled when local fallback is used; check Settings for the exact error.' : 'Start Ollama and install the configured local model to enable generated replies.' : 'Select Ollama in the server configuration and start a local model to enable generated AI replies.'}</span><Link to="/settings">Configure AI <ArrowRight size={14} /></Link></div>}
    <section className="metric-grid" aria-label="Call statistics">
      <MetricCard label="Total calls" value={loading ? '—' : stats?.totalCalls ?? 0} detail="Completed conversations" icon={PhoneCall} tint="metric-blue" />
      <MetricCard label="Converted" value={loading ? '—' : stats?.converted ?? 0} detail="Customer committed" icon={WalletCards} tint="metric-green" />
      <MetricCard label="Interested" value={loading ? '—' : stats?.interested ?? 0} detail="Positive signals" icon={Sparkles} tint="metric-violet" />
      <MetricCard label="Follow-ups" value={loading ? '—' : stats?.followUps ?? 0} detail="Next steps to action" icon={MessageSquareText} tint="metric-amber" />
      <MetricCard label="Conversion rate" value={loading ? '—' : `${stats?.conversionRate ?? 0}%`} detail="Converted / completed" icon={ArrowUpRight} tint="metric-slate" />
    </section>
    <section className="dashboard-lower">
      <div className="panel recent-panel">
        <div className="panel-heading"><div><h2>Recent calls</h2><p>Your latest customer conversations</p></div><Link to="/history" className="text-link">View all <ArrowRight size={15} /></Link></div>
        {loading ? <div className="table-loading"><span className="spinner" /> Loading call history…</div> : error ? null : data?.recentCalls.length ? <RecentCallsTable calls={data.recentCalls} /> : <EmptyState icon={Headphones} title="Your call history starts here" description="Every completed conversation, summary, and follow-up will be kept in one place." action={<Link to="/new-call" className="button button-secondary"><Plus size={16} /> Start your first call</Link>} />}
      </div>
      <aside className="coach-card"><div className="coach-glow" /><div className="coach-icon"><Sparkles size={19} /></div><div className="coach-kicker">A LITTLE REMINDER</div><h2>Great sales calls are conversations.</h2><p>Ask thoughtful questions, listen for what matters, and let the right next step become clear.</p><Link to="/new-call" className="coach-link">Make a call <ArrowRight size={15} /></Link><div className="coach-watermark"><AudioLines size={80} strokeWidth={0.8} /></div></aside>
    </section>
    <div className="dashboard-footer"><div className="footer-feature"><span><Users size={15} /></span> Customer-first selling</div><span className="footer-separator">·</span><div className="footer-feature"><span><Headphones size={15} /></span> Every call, remembered</div><span className="footer-end">Built for thoughtful conversations <span className="footer-spark">✳</span></span></div>
  </div>;
}
