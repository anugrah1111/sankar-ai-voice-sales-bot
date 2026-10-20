import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import initSqlJs, { type Database } from 'sql.js';
import type { CallRecord, ProductContext, SalesStatus, TranscriptMessage } from '../shared/types';

const dataDirectory = path.resolve(process.env.DATA_DIR || './data');
export const recordingsDirectory = path.join(dataDirectory, 'recordings');
const databasePath = path.join(dataDirectory, 'voice-sales.sqlite');
let database: Database;
let persistQueue = Promise.resolve();

export async function initializeDatabase(): Promise<void> {
  await mkdir(recordingsDirectory, { recursive: true });
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
  });
  try {
    const file = await readFile(databasePath);
    database = new SQL.Database(new Uint8Array(file));
  } catch {
    database = new SQL.Database();
  }
  database.run(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY,
      customer_name TEXT NOT NULL,
      product_name TEXT NOT NULL,
      product_context TEXT NOT NULL,
      recording_consent INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'in_progress',
      status TEXT NOT NULL DEFAULT 'No Response',
      ai_status TEXT,
      status_source TEXT NOT NULL DEFAULT 'local',
      summary_json TEXT,
      summary_source TEXT,
      summary_error TEXT,
      transcript_json TEXT NOT NULL DEFAULT '[]',
      recording_filename TEXT,
      recording_mime TEXT,
      recording_bytes INTEGER NOT NULL DEFAULT 0,
      recording_duration_seconds INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS calls_started_at_idx ON calls(started_at DESC);
    CREATE INDEX IF NOT EXISTS calls_status_idx ON calls(status);
  `);
  const columnNames = queryRows('PRAGMA table_info(calls)').map((row) => String(row.name));
  if (!columnNames.includes('recording_consent')) getDatabase().run('ALTER TABLE calls ADD COLUMN recording_consent INTEGER NOT NULL DEFAULT 0');
  await persistDatabase();
}

function getDatabase(): Database {
  if (!database) throw new Error('Database has not been initialized.');
  return database;
}

export async function persistDatabase(): Promise<void> {
  const bytes = Buffer.from(getDatabase().export());
  persistQueue = persistQueue.then(async () => {
    const temporaryPath = `${databasePath}.tmp`;
    await writeFile(temporaryPath, bytes);
    await rename(temporaryPath, databasePath);
  });
  await persistQueue;
}

type Row = Record<string, unknown>;

function queryRows(sql: string, parameters: unknown[] = []): Row[] {
  const statement = getDatabase().prepare(sql);
  statement.bind(parameters as never[]);
  const result: Row[] = [];
  while (statement.step()) {
    result.push(statement.getAsObject() as Row);
  }
  statement.free();
  return result;
}

function queryRow(sql: string, parameters: unknown[] = []): Row | null {
  return queryRows(sql, parameters)[0] ?? null;
}

function parseRecord(row: Row): CallRecord {
  return {
    id: String(row.id),
    customerName: String(row.customer_name),
    productName: String(row.product_name),
    productContext: JSON.parse(String(row.product_context)) as ProductContext,
    recordingConsent: Boolean(row.recording_consent),
    startedAt: String(row.started_at),
    endedAt: row.ended_at ? String(row.ended_at) : null,
    durationSeconds: Number(row.duration_seconds || 0),
    state: row.state === 'ended' ? 'ended' : 'in_progress',
    status: String(row.status) as SalesStatus,
    aiStatus: row.ai_status ? String(row.ai_status) as SalesStatus : null,
    statusSource: String(row.status_source) as CallRecord['statusSource'],
    summary: row.summary_json ? JSON.parse(String(row.summary_json)) : null,
    summarySource: row.summary_source ? String(row.summary_source) as CallRecord['summarySource'] : null,
    summaryError: row.summary_error ? String(row.summary_error) : null,
    transcript: JSON.parse(String(row.transcript_json || '[]')) as TranscriptMessage[],
    recordingAvailable: Boolean(row.recording_filename && Number(row.recording_bytes) > 0),
    recordingMime: row.recording_mime ? String(row.recording_mime) : null,
    recordingBytes: Number(row.recording_bytes || 0),
    recordingDurationSeconds: Number(row.recording_duration_seconds || 0),
  };
}

export function createCall(id: string, customerName: string, context: ProductContext, recordingConsent: boolean): CallRecord {
  const now = new Date().toISOString();
  getDatabase().run(
    'INSERT INTO calls (id, customer_name, product_name, product_context, recording_consent, started_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, customerName, context.productName, JSON.stringify(context), recordingConsent ? 1 : 0, now],
  );
  return getCall(id)!;
}

export function getCall(id: string): CallRecord | null {
  const row = queryRow('SELECT * FROM calls WHERE id = ?', [id]);
  return row ? parseRecord(row) : null;
}

export function listCalls(options: { search?: string; status?: string; sort?: 'newest' | 'oldest'; limit?: number; offset?: number } = {}): { calls: CallRecord[]; total: number } {
  const filters: string[] = [];
  const parameters: unknown[] = [];
  if (options.search?.trim()) {
    filters.push('(LOWER(customer_name) LIKE ? OR LOWER(product_name) LIKE ?)');
    const term = `%${options.search.trim().toLowerCase()}%`;
    parameters.push(term, term);
  }
  if (options.status && options.status !== 'All statuses') {
    filters.push('status = ?');
    parameters.push(options.status);
  }
  filters.push("state = 'ended'");
  const where = `WHERE ${filters.join(' AND ')}`;
  const total = Number(queryRow(`SELECT COUNT(*) AS count FROM calls ${where}`, parameters)?.count || 0);
  const order = options.sort === 'oldest' ? 'ASC' : 'DESC';
  const select = `SELECT * FROM calls ${where} ORDER BY started_at ${order}`;
  const rows = options.limit === undefined
    ? queryRows(select, parameters)
    : queryRows(`${select} LIMIT ? OFFSET ?`, [...parameters, options.limit, options.offset ?? 0]);
  return { calls: rows.map(parseRecord), total };
}

export function getDashboardStats(): { totalCalls: number; converted: number; interested: number; followUps: number } {
  const row = queryRow(`
    SELECT COUNT(*) AS total_calls,
      SUM(CASE WHEN status = 'Converted' THEN 1 ELSE 0 END) AS converted,
      SUM(CASE WHEN status = 'Interested' THEN 1 ELSE 0 END) AS interested,
      SUM(CASE WHEN status = 'Follow-up Required' THEN 1 ELSE 0 END) AS follow_ups
    FROM calls WHERE state = 'ended'
  `);
  return {
    totalCalls: Number(row?.total_calls || 0),
    converted: Number(row?.converted || 0),
    interested: Number(row?.interested || 0),
    followUps: Number(row?.follow_ups || 0),
  };
}

export function appendMessage(id: string, message: TranscriptMessage): CallRecord | null {
  const call = getCall(id);
  if (!call || call.state !== 'in_progress') return null;
  call.transcript.push(message);
  updateTranscript(id, call.transcript);
  return getCall(id);
}

export function updateTranscript(id: string, transcript: TranscriptMessage[]): void {
  getDatabase().run('UPDATE calls SET transcript_json = ? WHERE id = ?', [JSON.stringify(transcript), id]);
}

export function updateEndDetails(id: string, durationSeconds: number): void {
  getDatabase().run(
    "UPDATE calls SET state = 'ended', ended_at = ?, duration_seconds = ? WHERE id = ? AND state = 'in_progress'",
    [new Date().toISOString(), Math.max(0, Math.round(durationSeconds)), id],
  );
}

export function addRecordingChunk(id: string, filename: string, mimeType: string, bytes: number, isFirst: boolean): void {
  getDatabase().run(
    `UPDATE calls SET recording_filename = ?, recording_mime = ?, recording_bytes = recording_bytes + ?
     WHERE id = ? AND state = 'in_progress'`,
    [filename, mimeType, bytes, id],
  );
  if (isFirst) getDatabase().run('UPDATE calls SET recording_bytes = ? WHERE id = ?', [bytes, id]);
}

export function updateRecordingDuration(id: string, seconds: number): void {
  getDatabase().run('UPDATE calls SET recording_duration_seconds = ? WHERE id = ?', [Math.max(0, Math.round(seconds)), id]);
}

export function updateSummary(id: string, summary: unknown, source: 'ai' | 'local', error: string | null, aiStatus: SalesStatus, normalizedStatus: SalesStatus, statusSource: 'ai' | 'local' | 'ai_guarded'): void {
  getDatabase().run(
    `UPDATE calls SET summary_json = ?, summary_source = ?, summary_error = ?, ai_status = ?,
      status = CASE WHEN status_source = 'manual' THEN status ELSE ? END,
      status_source = CASE WHEN status_source = 'manual' THEN status_source ELSE ? END
     WHERE id = ?`,
    [JSON.stringify(summary), source, error, aiStatus, normalizedStatus, statusSource, id],
  );
}

export function setManualStatus(id: string, status: SalesStatus): CallRecord | null {
  getDatabase().run("UPDATE calls SET status = ?, status_source = 'manual' WHERE id = ? AND state = 'ended'", [status, id]);
  return getCall(id);
}

export function setSummaryError(id: string, error: string): void {
  getDatabase().run('UPDATE calls SET summary_error = ? WHERE id = ?', [error, id]);
}

export function getRecordingFilename(id: string): string | null {
  const row = queryRow('SELECT recording_filename FROM calls WHERE id = ?', [id]);
  return row?.recording_filename ? String(row.recording_filename) : null;
}

export async function finishInterruptedCalls(): Promise<CallRecord[]> {
  const interrupted = queryRows("SELECT * FROM calls WHERE state = 'in_progress'").map(parseRecord);
  const now = new Date();
  for (const call of interrupted) {
    const duration = Math.max(0, Math.round((now.getTime() - new Date(call.startedAt).getTime()) / 1000));
    getDatabase().run("UPDATE calls SET state = 'ended', ended_at = ?, duration_seconds = ? WHERE id = ?", [now.toISOString(), duration, call.id]);
  }
  await persistDatabase();
  return interrupted;
}
