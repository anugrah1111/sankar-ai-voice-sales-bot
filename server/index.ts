import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import cors from 'cors';
import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { salesStatuses, type CallRecord, type ProductContext, type SalesStatus } from '../shared/types';
import {
  addRecordingChunk,
  appendMessage,
  createCall,
  finishInterruptedCalls,
  getCall,
  getDashboardStats,
  getRecordingFilename,
  initializeDatabase,
  listCalls,
  persistDatabase,
  recordingsDirectory,
  setManualStatus,
  setSummaryError,
  updateEndDetails,
  updateRecordingDuration,
  updateSummary,
} from './db';
import { createTranscriptMessage, generateCallAnalysis, generateSalesReply, getAiHealth, getAiProvider, isAiConfigured } from './ai';

const app = express();
const port = Number(process.env.PORT || 3001);
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((origin) => origin.trim()).filter(Boolean);
const maxChunkBytes = Number(process.env.MAX_RECORDING_CHUNK_BYTES || 12 * 1024 * 1024);
const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxChunkBytes } });

app.disable('x-powered-by');
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(null, false);
  },
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json({ limit: '1mb' }));

const productContextSchema = z.object({
  productName: z.string().trim().min(1).max(100),
  productDescription: z.string().trim().max(1500).default(''),
  featuresBenefits: z.string().trim().max(2500).default(''),
  pricing: z.string().trim().max(1000).default(''),
  primaryProblem: z.string().trim().max(1000).default(''),
  language: z.enum(['English', 'Hindi']),
});
const startCallSchema = z.object({
  customerName: z.string().trim().min(1).max(100),
  context: productContextSchema,
  recordingConsent: z.literal(true),
});
const messageSchema = z.object({
  text: z.string().trim().max(3000).optional(),
  start: z.boolean().optional(),
  retry: z.boolean().optional(),
}).refine((value) => value.start || value.retry || Boolean(value.text?.trim()), 'Message text is required.');
const endCallSchema = z.object({ durationSeconds: z.coerce.number().min(0).max(60 * 60 * 12).optional(), recordingDurationSeconds: z.coerce.number().min(0).max(60 * 60 * 12).optional() });
const statusSchema = z.object({ status: z.enum(salesStatuses) });

function sendError(response: Response, status: number, message: string): void {
  response.status(status).json({ error: message });
}

function requireCall(id: string, response: Response): CallRecord | null {
  const call = getCall(id);
  if (!call) sendError(response, 404, 'Call not found.');
  return call;
}

function routeCallId(request: Request): string {
  const id = request.params.id;
  return Array.isArray(id) ? (id[0] ?? '') : id;
}

function summarizeAndSave(id: string): Promise<CallRecord | null> {
  return (async () => {
    const call = getCall(id);
    if (!call) return null;
    const result = await generateCallAnalysis(call);
    updateSummary(id, result.summary, result.source, result.error, result.aiStatus, result.status, result.statusSource);
    if (!result.error) setSummaryError(id, '');
    await persistDatabase();
    return getCall(id);
  })();
}

app.get('/api/health', async (_request, response) => {
  const aiHealth = await getAiHealth();
  response.json({ ok: true, aiConfigured: aiHealth.configured, provider: aiHealth.provider, aiAvailable: aiHealth.available, aiDetail: aiHealth.detail });
});

app.get('/api/dashboard', async (_request, response) => {
  const aiHealth = await getAiHealth();
  const stats = getDashboardStats();
  const recent = listCalls({ limit: 5 }).calls;
  response.json({
    stats: {
      ...stats,
      conversionRate: stats.totalCalls ? Math.round((stats.converted / stats.totalCalls) * 100) : 0,
      aiConfigured: aiHealth.configured,
      provider: aiHealth.provider,
      aiAvailable: aiHealth.available,
    },
    recentCalls: recent,
  });
});

app.get('/api/calls', (request, response) => {
  const status = typeof request.query.status === 'string' ? request.query.status : undefined;
  if (status && status !== 'All statuses' && !salesStatuses.includes(status as SalesStatus)) return sendError(response, 400, 'Invalid sales status filter.');
  const sort = request.query.sort === 'oldest' ? 'oldest' : 'newest';
  const search = typeof request.query.search === 'string' ? request.query.search.slice(0, 100) : undefined;
  const { calls, total } = listCalls({ search, status, sort });
  response.json({ calls, total });
});

app.post('/api/calls', async (request, response) => {
  const parsed = startCallSchema.safeParse(request.body);
  if (!parsed.success) return sendError(response, 400, parsed.error.issues[0]?.message || 'Call details are invalid.');
  const id = randomUUID();
  const call = createCall(id, parsed.data.customerName, parsed.data.context as ProductContext, parsed.data.recordingConsent);
  await persistDatabase();
  response.status(201).json({ call });
});

app.get('/api/calls/:id', (request, response) => {
  const call = requireCall(routeCallId(request), response);
  if (call) response.json({ call });
});

app.post('/api/calls/:id/messages', async (request, response) => {
  const call = requireCall(routeCallId(request), response);
  if (!call) return;
  if (call.state !== 'in_progress') return sendError(response, 409, 'This call has already ended.');
  const parsed = messageSchema.safeParse(request.body);
  if (!parsed.success) return sendError(response, 400, parsed.error.issues[0]?.message || 'Message is invalid.');
  const isStart = Boolean(parsed.data.start);
  if (!isStart && !parsed.data.retry && parsed.data.text) {
    appendMessage(call.id, createTranscriptMessage('customer', parsed.data.text));
    await persistDatabase();
  }
  const refreshed = getCall(call.id)!;
  const result = await generateSalesReply(refreshed, refreshed.transcript, isStart);
  const message = createTranscriptMessage('assistant', result.reply, { source: result.source, warning: result.warning });
  appendMessage(call.id, message);
  await persistDatabase();
  response.json({ message, source: result.source, warning: result.warning, call: getCall(call.id) });
});

app.post('/api/calls/:id/recording-chunks', audioUpload.single('chunk'), async (request, response) => {
  const call = requireCall(routeCallId(request), response);
  if (!call) return;
  if (call.state !== 'in_progress') return sendError(response, 409, 'Recording upload rejected because this call has ended.');
  if (!call.recordingConsent) return sendError(response, 403, 'Recording upload rejected because recording consent was not confirmed.');
  if (!request.file?.buffer.length) return sendError(response, 400, 'No recording audio was received.');
  if (!request.file.mimetype.startsWith('audio/')) return sendError(response, 415, 'The uploaded recording must be an audio file.');
  const isFirst = request.body.first === 'true';
  const extension = request.file.mimetype.includes('mp4') ? 'm4a' : request.file.mimetype.includes('ogg') ? 'ogg' : 'webm';
  const filename = `${call.id}.${extension}`;
  const filePath = path.join(recordingsDirectory, filename);
  await mkdir(recordingsDirectory, { recursive: true });
  if (isFirst) await writeFile(filePath, request.file.buffer);
  else await appendFile(filePath, request.file.buffer);
  addRecordingChunk(call.id, filename, request.file.mimetype || 'audio/webm', request.file.size, isFirst);
  await persistDatabase();
  response.json({ saved: true, bytes: request.file.size });
});

app.post('/api/calls/:id/end', async (request, response) => {
  const call = requireCall(routeCallId(request), response);
  if (!call) return;
  const parsed = endCallSchema.safeParse(request.body ?? {});
  if (!parsed.success) return sendError(response, 400, parsed.error.issues[0]?.message || 'Call duration is invalid.');
  if (call.state === 'in_progress') {
    const calculated = Math.max(0, (Date.now() - new Date(call.startedAt).getTime()) / 1000);
    updateEndDetails(call.id, parsed.data.durationSeconds ?? calculated);
    if (parsed.data.recordingDurationSeconds !== undefined) updateRecordingDuration(call.id, parsed.data.recordingDurationSeconds);
    await persistDatabase();
  }
  const completed = getCall(call.id)!;
  if (!completed.summary) {
    await summarizeAndSave(completed.id);
  }
  response.json({ call: getCall(call.id) });
});

app.post('/api/calls/:id/summary/retry', async (request, response) => {
  const call = requireCall(routeCallId(request), response);
  if (!call) return;
  if (call.state !== 'ended') return sendError(response, 409, 'End the call before generating a summary.');
  const updated = await summarizeAndSave(call.id);
  response.json({ call: updated, aiConfigured: isAiConfigured() });
});

app.patch('/api/calls/:id/status', async (request, response) => {
  const call = requireCall(routeCallId(request), response);
  if (!call) return;
  if (call.state !== 'ended') return sendError(response, 409, 'End the call before changing its status.');
  const parsed = statusSchema.safeParse(request.body);
  if (!parsed.success) return sendError(response, 400, 'Choose one of the available sales statuses.');
  const updated = setManualStatus(call.id, parsed.data.status);
  await persistDatabase();
  response.json({ call: updated });
});

app.get('/api/calls/:id/recording', (request, response) => {
  const call = requireCall(routeCallId(request), response);
  if (!call) return;
  const filename = getRecordingFilename(call.id);
  if (!filename || !call.recordingAvailable) return sendError(response, 404, 'No saved recording is available for this call.');
  const filePath = path.join(recordingsDirectory, filename);
  response.setHeader('Content-Type', call.recordingMime || 'audio/webm');
  response.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  response.sendFile(filePath, (error) => {
    if (error && !response.headersSent) sendError(response, 404, 'The recording file could not be found.');
  });
});

app.post('/api/calls/:id/interrupt', async (request, response) => {
  const call = requireCall(routeCallId(request), response);
  if (!call) return;
  if (call.state === 'in_progress') {
    const calculated = Math.max(0, (Date.now() - new Date(call.startedAt).getTime()) / 1000);
    updateEndDetails(call.id, Number.isFinite(Number(request.body?.durationSeconds)) ? Number(request.body.durationSeconds) : calculated);
    await persistDatabase();
  }
  void summarizeAndSave(call.id);
  response.status(204).end();
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') return sendError(response, 413, 'This recording chunk is too large.');
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  sendError(response, 500, message);
});

if (process.env.NODE_ENV === 'production') {
  const frontendDirectory = path.resolve(process.cwd(), 'dist');
  app.use(express.static(frontendDirectory));
  app.use((request, response, next) => {
    if (request.method === 'GET' && !request.path.startsWith('/api/')) return response.sendFile(path.join(frontendDirectory, 'index.html'));
    next();
  });
}

async function start(): Promise<void> {
  await initializeDatabase();
  const interrupted = await finishInterruptedCalls();
  for (const call of interrupted) await summarizeAndSave(call.id);
  console.info(`Recovered ${interrupted.length} interrupted call session(s).`);
  app.listen(port, '0.0.0.0', () => {
    console.info(`Voice Sales API listening on port ${port}. AI provider: ${getAiProvider()}.`);
  });
}

void start().catch((error) => {
  console.error('Unable to start Voice Sales API:', error);
  process.exitCode = 1;
});

process.on('SIGTERM', () => { void persistDatabase().finally(() => process.exit(0)); });
process.on('SIGINT', () => { void persistDatabase().finally(() => process.exit(0)); });
