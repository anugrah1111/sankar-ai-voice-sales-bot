export const salesStatuses = [
  'Converted',
  'Interested',
  'Follow-up Required',
  'Not Interested',
  'Demo Requested',
  'No Response',
] as const;

export type SalesStatus = (typeof salesStatuses)[number];
export type CallLanguage = 'English' | 'Hindi';
export type Speaker = 'customer' | 'assistant';
export type AiProvider = 'openai' | 'ollama' | 'local';

export interface TranscriptMessage {
  id: string;
  speaker: Speaker;
  text: string;
  createdAt: string;
  generationSource?: 'ai' | 'local';
  generationWarning?: string;
}

export interface ProductContext {
  productName: string;
  productDescription: string;
  featuresBenefits: string;
  pricing: string;
  primaryProblem: string;
  language: CallLanguage;
}

export interface CallSummary {
  overview: string;
  requirements: string[];
  featuresDiscussed: string[];
  objections: string[];
  interestLevel: 'High' | 'Medium' | 'Low' | 'None';
  agreedNextSteps: string[];
  followUpRecommendation: string;
}

export interface CallRecord {
  id: string;
  customerName: string;
  productName: string;
  productContext: ProductContext;
  recordingConsent: boolean;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  state: 'in_progress' | 'ended';
  status: SalesStatus;
  aiStatus: SalesStatus | null;
  statusSource: 'ai' | 'local' | 'ai_guarded' | 'manual';
  summary: CallSummary | null;
  summarySource: 'ai' | 'local' | null;
  summaryError: string | null;
  transcript: TranscriptMessage[];
  recordingAvailable: boolean;
  recordingMime: string | null;
  recordingBytes: number;
  recordingDurationSeconds: number;
}

export interface DashboardStats {
  totalCalls: number;
  converted: number;
  interested: number;
  followUps: number;
  conversionRate: number;
  aiConfigured: boolean;
  provider: AiProvider;
  aiAvailable: boolean | null;
}

export interface StartCallInput {
  customerName: string;
  context: ProductContext;
  recordingConsent: true;
}

export interface CallListResponse {
  calls: CallRecord[];
  total: number;
}
