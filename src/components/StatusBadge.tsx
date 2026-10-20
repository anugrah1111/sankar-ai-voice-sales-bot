import type { SalesStatus } from '../../shared/types';

const classNames: Record<SalesStatus, string> = {
  Converted: 'status-converted',
  Interested: 'status-interested',
  'Follow-up Required': 'status-followup',
  'Not Interested': 'status-not-interested',
  'Demo Requested': 'status-demo',
  'No Response': 'status-no-response',
};

export default function StatusBadge({ status }: { status: SalesStatus }) {
  return <span className={`status-badge ${classNames[status]}`}><span className="status-dot" />{status}</span>;
}
