import { useEffect, useState } from 'react';
import { AudioLines, ArrowDownWideNarrow, ArrowRight, CalendarClock, Headphones, Search, SlidersHorizontal } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CallListResponse, CallRecord, SalesStatus } from '../../shared/types';
import { api, formatDate, formatDuration } from '../api';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/StatusBadge';

const statuses: Array<'All statuses' | SalesStatus> = ['All statuses', 'Converted', 'Interested', 'Follow-up Required', 'Not Interested', 'Demo Requested', 'No Response'];

function HistoryTable({ calls }: { calls: CallRecord[] }) {
  return <div className="table-scroll"><table className="data-table history-table"><thead><tr><th>Customer</th><th>Product</th><th>Duration</th><th>Date & time</th><th>Status</th><th>Recording</th><th /></tr></thead><tbody>{calls.map((call) => <tr key={call.id}><td><Link to={`/calls/${call.id}`} className="customer-cell history-customer"><span className="avatar avatar-soft">{call.customerName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</span><div><strong>{call.customerName}</strong><span>{call.summarySource === 'ai' ? 'AI summary ready' : call.summary ? 'Local summary ready' : 'Summary unavailable'}</span></div></Link></td><td><span className="table-product">{call.productName}</span></td><td>{formatDuration(call.durationSeconds)}</td><td>{formatDate(call.startedAt)}</td><td><StatusBadge status={call.status} /></td><td>{call.recordingAvailable ? <span className="recording-available"><AudioLines size={14} /> Available</span> : <span className="recording-missing">Unavailable</span>}</td><td className="table-arrow"><Link aria-label={`View ${call.customerName} call`} to={`/calls/${call.id}`}><ArrowRight size={16} /></Link></td></tr>)}</tbody></table></div>;
}

export default function CallHistory() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'All statuses' | SalesStatus>('All statuses');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = new URLSearchParams({ search, status, sort });
    api.get<CallListResponse>(`/api/calls?${params}`).then((result) => { if (active) { setCalls(result.calls); setTotal(result.total); setError(''); } }).catch((reason: Error) => { if (active) setError(reason.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [search, status, sort]);
  return <div className="page history-page">
    <div className="page-header history-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> CONVERSATION LIBRARY</div><h1>Call history</h1><p className="page-subtitle">Every customer conversation, transcript, recording, and next step.</p></div><Link to="/new-call" className="button button-primary"><span className="button-plus">+</span> Start new call</Link></div>
    <div className="history-summary-strip"><div className="history-total-icon"><Headphones size={17} /></div><div><strong>{total} {total === 1 ? 'conversation' : 'conversations'}</strong><span>Saved in your workspace</span></div><div className="history-strip-divider" /><div className="history-total-meta"><CalendarClock size={15} /> Persisted call records</div></div>
    <section className="panel history-panel"><div className="history-toolbar"><div><h2>All calls</h2><p>Search and filter your completed conversations.</p></div><div className="history-filters"><label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customers or products" aria-label="Search customers or products" /></label><label className="filter-select-wrap"><SlidersHorizontal size={15} /><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label="Filter by sales status">{statuses.map((item) => <option key={item}>{item}</option>)}</select></label><button className="sort-button" onClick={() => setSort((value) => value === 'newest' ? 'oldest' : 'newest')} title="Toggle sort order"><ArrowDownWideNarrow size={15} /><span>{sort === 'newest' ? 'Newest' : 'Oldest'}</span></button></div></div>
      {error && <div className="alert alert-error compact-alert">{error} <button onClick={() => window.location.reload()}>Try again</button></div>}
      {loading ? <div className="table-loading"><span className="spinner" /> Loading call history…</div> : error ? null : calls.length ? <HistoryTable calls={calls} /> : search || status !== 'All statuses' ? <EmptyState icon={Search} title="No calls match these filters" description="Try another customer name, product, or sales status." action={<button className="button button-secondary" onClick={() => { setSearch(''); setStatus('All statuses'); }}>Clear filters</button>} /> : <EmptyState icon={Headphones} title="No calls yet" description="Completed conversations will appear here with their transcripts, summaries, statuses, and recordings." action={<Link to="/new-call" className="button button-primary">Start your first call <ArrowRight size={16} /></Link>} />}
    </section>
    <div className="history-footnote"><span className="privacy-shield">◈</span> Your call data stays in your configured database and storage volume.</div>
  </div>;
}
