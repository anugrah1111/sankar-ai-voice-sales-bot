import type { AiProvider, CallRecord, DashboardStats, SalesStatus, StartCallInput } from '../shared/types';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new ApiError('Could not reach the server. Check that the app is running and try again.', 0);
  }
  const data = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new ApiError(data.error || `Request failed (${response.status}).`, response.status);
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: unknown) => request<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }),
  patch: <T>(url: string, body: unknown) => request<T>(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  startCall: (input: StartCallInput) => request<{ call: CallRecord }>('/api/calls', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }),
};

export interface HealthResponse {
  ok: boolean;
  aiConfigured: boolean;
  provider: AiProvider;
  aiAvailable: boolean | null;
  aiDetail: string;
}

export interface DashboardResponse {
  stats: DashboardStats;
  recentCalls: CallRecord[];
}

export async function updateStatus(id: string, status: SalesStatus): Promise<CallRecord> {
  const result = await api.patch<{ call: CallRecord }>(`/api/calls/${id}/status`, { status });
  return result.call;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const remainingSeconds = Math.floor(Math.max(0, seconds) % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
