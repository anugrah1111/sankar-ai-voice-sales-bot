import { randomUUID } from 'node:crypto';
import type { AiProvider, CallRecord, CallSummary, SalesStatus, TranscriptMessage } from '../shared/types';
import { salesStatuses } from '../shared/types';

const openAiKey = process.env.OPENAI_API_KEY?.trim();
const openAiModel = process.env.OPENAI_MODEL?.trim() || 'gpt-6-astra';
const ollamaBaseUrl = (process.env.OLLAMA_BASE_URL?.trim() || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const ollamaModel = process.env.OLLAMA_MODEL?.trim() || 'qwen2.5:3b';
const ollamaTimeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS || 45_000);
const requestedProvider = process.env.AI_PROVIDER?.trim().toLowerCase();
let lastOllamaInferenceIssue: string | null = null;
let hasSuccessfulOllamaInference = false;

export function getAiProvider(): AiProvider {
  if (requestedProvider === 'ollama') return 'ollama';
  if (requestedProvider === 'local') return 'local';
  if (requestedProvider === 'openai') return openAiKey ? 'openai' : 'local';
  return openAiKey ? 'openai' : 'local';
}

export function isAiConfigured(): boolean {
  return getAiProvider() !== 'local';
}

export async function getAiHealth(): Promise<{ configured: boolean; provider: AiProvider; available: boolean | null; detail: string }> {
  const provider = getAiProvider();
  if (provider === 'local') return { configured: false, provider, available: false, detail: 'The rule-based local fallback is active.' };
  if (provider === 'openai') return { configured: true, provider, available: null, detail: 'OpenAI is selected; availability is checked on the first generated request.' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${ollamaBaseUrl}/api/tags`, { signal: controller.signal });
    if (!response.ok) return { configured: true, provider, available: false, detail: `Ollama returned HTTP ${response.status}.` };
    const body = await response.json() as { models?: Array<{ name?: string; model?: string }> };
    const installed = body.models?.some((item) => item.name === ollamaModel || item.model === ollamaModel) ?? false;
    return installed
      ? {
        configured: true,
        provider,
        available: lastOllamaInferenceIssue ? false : hasSuccessfulOllamaInference ? true : null,
        detail: lastOllamaInferenceIssue
          ? `${ollamaModel} is installed, but its last generation attempt failed: ${lastOllamaInferenceIssue}`
          : `Ollama is running and ${ollamaModel} is installed. Inference will be verified on the next reply.`,
      }
      : { configured: true, provider, available: false, detail: `Ollama is running, but ${ollamaModel} is not installed. Run: ollama pull ${ollamaModel}` };
  } catch {
    return { configured: true, provider, available: false, detail: `Ollama is not reachable at ${ollamaBaseUrl}. Start Ollama, then install ${ollamaModel} with: ollama pull ${ollamaModel}` };
  } finally {
    clearTimeout(timeout);
  }
}

function transcriptInput(messages: TranscriptMessage[]) {
  return messages.map((message) => ({
    role: message.speaker === 'assistant' ? 'assistant' : 'user',
    content: message.text,
  }));
}

function extractResponseText(response: Record<string, unknown>): string {
  if (typeof response.output_text === 'string') return response.output_text;
  const output = Array.isArray(response.output) ? response.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const piece of content) {
      if (!piece || typeof piece !== 'object') continue;
      const text = (piece as { text?: unknown }).text;
      if (typeof text === 'string') chunks.push(text);
    }
  }
  return chunks.join('\n').trim();
}

async function requestOpenAi(payload: Record<string, unknown>): Promise<string> {
  if (!openAiKey) throw new Error('OPENAI_API_KEY is not configured.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: openAiModel, ...payload }),
      signal: controller.signal,
    });
    const body = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      const error = body.error as { message?: string } | undefined;
      throw new Error(error?.message || `OpenAI returned HTTP ${response.status}.`);
    }
    const output = extractResponseText(body);
    if (!output) throw new Error('OpenAI returned an empty response.');
    return output;
  } finally {
    clearTimeout(timeout);
  }
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

async function requestOllama(payload: Record<string, unknown>): Promise<string> {
  const instructions = typeof payload.instructions === 'string' ? payload.instructions : '';
  const input = Array.isArray(payload.input) ? payload.input : [];
  const messages: ChatMessage[] = [
    ...(instructions ? [{ role: 'system' as const, content: instructions }] : []),
    ...input.flatMap((item): ChatMessage[] => {
      if (!item || typeof item !== 'object') return [];
      const message = item as { role?: unknown; content?: unknown };
      if ((message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string') return [];
      return [{ role: message.role, content: message.content }];
    }),
  ];
  if (!messages.length) throw new Error('Ollama request had no conversation messages.');

  const format = (payload.text as { format?: { schema?: unknown } } | undefined)?.format?.schema;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ollamaTimeoutMs);
  try {
    const response = await fetch(`${ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        messages,
        stream: false,
        options: { temperature: format ? 0 : 0.35 },
        ...(format ? { format } : {}),
        keep_alive: '5m',
      }),
      signal: controller.signal,
    });
    const body = await response.json() as { error?: string; message?: { content?: string } };
    if (!response.ok) throw new Error(body.error || `Ollama returned HTTP ${response.status}.`);
    const output = body.message?.content?.trim();
    if (!output) throw new Error('Ollama returned an empty response.');
    lastOllamaInferenceIssue = null;
    hasSuccessfulOllamaInference = true;
    return output;
  } catch (error) {
    lastOllamaInferenceIssue = error instanceof Error ? error.message : 'Unknown Ollama inference error.';
    hasSuccessfulOllamaInference = false;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Ollama did not respond within ${Math.round(ollamaTimeoutMs / 1000)} seconds.`);
    }
    if (error instanceof TypeError) {
      const code = (error.cause as { code?: string } | undefined)?.code;
      if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
        throw new Error(`Ollama is unavailable at ${ollamaBaseUrl}. Start Ollama and install ${ollamaModel} with: ollama pull ${ollamaModel}`);
      }
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestAi(payload: Record<string, unknown>): Promise<string> {
  if (getAiProvider() === 'ollama') return requestOllama(payload);
  if (getAiProvider() === 'openai') return requestOpenAi(payload);
  throw new Error('No generated AI provider is configured.');
}

function productDescription(call: CallRecord): string {
  return JSON.stringify({
    product: call.productContext.productName,
    description: call.productContext.productDescription,
    featuresAndBenefits: call.productContext.featuresBenefits,
    pricing: call.productContext.pricing,
    customerProblem: call.productContext.primaryProblem,
    customer: call.customerName,
    language: call.productContext.language,
  });
}

export async function generateModelReply(call: CallRecord, transcript: TranscriptMessage[], isStart: boolean): Promise<string> {
  const languageInstruction = call.productContext.language === 'Hindi'
    ? 'Speak in natural, conversational Hindi. Keep product names and technical terms in English when that is more natural.'
    : 'Speak in natural, conversational English.';
  const instructions = [
    'You are a professional, friendly SaaS salesperson in a live sales call.',
    languageInstruction,
    'Be concise and conversational. Always address the customer’s latest message directly before asking anything. When they ask a question, answer it first using the supplied facts. Do not redirect a product question into a generic discovery question. Ask a follow-up only when it naturally helps the current topic.',
    'Treat brief or informal inputs such as “u tell me” or “give solution” in the context of the conversation: explain the relevant supplied product benefits and do not repeat an earlier assistant question.',
    'Use only the product facts supplied below. Never invent integrations, results, guarantees, features, or prices. If a detail is missing, say so plainly and offer to follow up.',
    'Listen to the customer, acknowledge objections respectfully, and do not pressure them.',
    'Explore their needs before recommending a feature. Mention a feature only when it relates to what they said.',
    'Offer a demo or a practical next step when it fits the conversation. Do not imply a sale unless the customer explicitly agreed.',
    `Product details: ${productDescription(call)}`,
    isStart ? 'This is the first turn. Greet the customer by name, briefly introduce the product using only provided details, then ask one open discovery question.' : 'Respond to the customer’s latest message using the conversation so far.',
  ].join('\n');
  const input = transcriptInput(transcript);
  if (isStart) input.push({ role: 'user', content: 'Begin the sales conversation now.' });
  return requestAi({ instructions, input });
}

function customerMessages(transcript: TranscriptMessage[]): string[] {
  return transcript.filter((message) => message.speaker === 'customer').map((message) => message.text.trim()).filter(Boolean);
}

function meaningfulCustomerMessages(transcript: TranscriptMessage[]): string[] {
  const acknowledgements = /^(?:hi|hello|hey|good morning|good afternoon|good evening|ok|okay|yes|yeah|yep|sure|thanks|thank you|hmm|mm hmm|uh|um|test|testing|नमस्ते)$/i;
  return customerMessages(transcript).filter((message) => {
    const normalized = message.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    return normalized.length >= 2 && !acknowledgements.test(normalized);
  });
}

const responseStopWords = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'could', 'do', 'does', 'for', 'from',
  'get', 'give', 'have', 'how', 'i', 'if', 'in', 'include', 'includes', 'is', 'it', 'me', 'of', 'on', 'our',
  'please', 'product', 'tell', 'that', 'the', 'their', 'them', 'there', 'this', 'to', 'us', 'we', 'what',
  'when', 'where', 'which', 'who', 'why', 'will', 'with', 'would', 'you', 'your', 'doesn', 'dont', 'not',
]);

function factTokens(value: string): string[] {
  return value.toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((word) => {
      if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
      if (word.length > 4 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
      if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
      return word;
    })
    .filter((word) => word.length > 2 && !responseStopWords.has(word));
}

function suppliedProductFacts(call: CallRecord): Array<{ text: string; source: 'description' | 'feature' }> {
  const description = call.productContext.productDescription
    .split(/(?<=[.!?])\s+|\n+/)
    .map((fact) => fact.trim())
    .filter(Boolean)
    .map((text) => ({ text, source: 'description' as const }));
  const features = call.productContext.featuresBenefits
    .split(/\n+|[;,]+|(?<=[.!?])\s+/)
    .map((fact) => fact.replace(/^[-•*\s]+/, '').trim())
    .filter(Boolean)
    .map((text) => ({ text, source: 'feature' as const }));
  return [...description, ...features];
}

function bestProductFact(call: CallRecord, customerText: string): { text: string; source: 'description' | 'feature' } | null {
  const query = new Set(factTokens(customerText));
  if (!query.size) return null;
  const ranked = suppliedProductFacts(call).map((fact) => {
    const tokens = factTokens(fact.text);
    const matches = tokens.filter((token) => query.has(token));
    const specificity = matches.reduce((score, token) => score + (token.length > 5 ? 1.5 : 1), 0);
    return { ...fact, specificity, matchCount: matches.length };
  }).sort((a, b) => b.specificity - a.specificity);
  const best = ranked[0];
  if (!best || best.matchCount === 0 || best.specificity < 1.5) return null;
  return { text: best.text, source: best.source };
}

function isProductOverviewQuestion(text: string): boolean {
  return /\b(?:what (?:does|is)|how (?:does|do|is)|tell me(?: about| more)?|(?:u|you) tell me|give (?:me )?(?:a )?solution|explain|describe|can you explain|how would|what can (?:you|this product) do|how can (?:you|this product) help|what do you recommend|recommend a solution)\b/i.test(text)
    || /(?:क्या|कैसे|बताइए|बताएं|समझाइए|समझाएं|जानकारी दें)/.test(text);
}

function isSolutionRequest(text: string): boolean {
  return /\b(?:give|show|suggest|recommend)\s+(?:(?:me|us)\s+)?(?:a\s+)?solution\b/i.test(text)
    || /\b(?:what can|how can)\s+(?:you|this product)\s+(?:do|help|solve)\b/i.test(text)
    || /\b(?:recommend|suggest)\s+(?:something|a product|a solution)\b/i.test(text);
}

function isQuestion(text: string): boolean {
  return text.includes('?')
    || /^(?:what|how|why|when|where|which|who|does|do|can|could|is|are|will|would|tell me|explain)\b/i.test(text.trim())
    || /(?:क्या|कैसे|क्यों|कब|कहाँ|कौन|कितना|है क्या|बताइए|बताएं|समझाइए|समझाएं)/.test(text);
}

function localUnknownAnswer(productName: string, language: CallRecord['productContext']['language'], customerText: string): string {
  const topic = factTokens(customerText).slice(0, 3).join(' ');
  if (language === 'Hindi') {
    return `आपका सवाल ${topic ? `“${topic}” के बारे में ` : ''}समझ गया। दी गई ${productName} जानकारी में इसका जवाब नहीं है, इसलिए मैं अनुमान नहीं लगाऊँगा। मैं इसे फॉलो-अप के लिए नोट कर सकता हूँ—क्या आप कोई और जानकारी जानना चाहेंगे?`;
  }
  return `I understand you’re asking about${topic ? ` ${topic}` : ' that'}. I don’t see that detail in the ${productName} information provided, so I don’t want to guess. I can note it for follow-up. Is there another product question I can answer from the details I have?`;
}

function explicitCommitment(text: string): boolean {
  if (/\b(?:not|never|don't|do not|won't|wouldn't|can't|cannot)\s+(?:currently\s+)?(?:ready to (?:buy|purchase|subscribe|sign up)|buy|purchase|subscribe|sign up|proceed)\b/i.test(text)) return false;
  return /\b(sign me up|ready to (?:buy|purchase|subscribe|sign up)|let(?:'|’)s (?:buy|purchase|subscribe|sign up|proceed)|(?:i|we)(?:'|’)ll (?:buy|purchase|subscribe|sign up|proceed)|(?:i|we) (?:would like to|want to) (?:buy|purchase|subscribe|sign up)|go ahead and (?:buy|purchase|subscribe|sign up)|we are in|we're in|we’re in)\b/i.test(text);
}

function requestsDemo(text: string): boolean {
  if (/\b(?:not|no|don't|do not|never)\b.{0,30}\b(?:demo|demonstration|walk[- ]?through)\b/i.test(text)) return false;
  const mentionsDemo = /\b(?:demo|demonstration|walk[- ]?through)\b/i.test(text);
  return mentionsDemo && /\b(?:can we|could we|can i|could i|can you|could you|i want|we want|i would like|we would like|(?:i|we)(?:'|’)d like|want to see|let(?:'|’)s schedule|schedule|book|arrange|set up|request|show me|interested in|yes.{0,20}|yeah.{0,20}|sure.{0,20}|demo please)\b/i.test(text);
}

export function classifyLocalStatus(transcript: TranscriptMessage[]): SalesStatus {
  const customerText = meaningfulCustomerMessages(transcript).join(' ');
  if (!customerText || !/[a-zA-Z\u0900-\u097F]{2,}/.test(customerText)) return 'No Response';
  if (explicitCommitment(customerText)) return 'Converted';
  if (/\b(not interested|no thanks|don't need|do not need|don't want (?:to buy|to purchase|this)|do not want (?:to buy|to purchase|this)|not looking to buy|not for us|we'll pass|we will pass|decline|stop calling)\b/i.test(customerText)) return 'Not Interested';
  if (requestsDemo(customerText)) return 'Demo Requested';
  if (/\b(call me|contact me|follow up with me|follow-up with me|(?:need|want|would like|please|could you) (?:a )?follow[- ]?up|not ready|need (?:some )?time|think about it|send (?:me )?(?:the )?(?:details|information|info|pricing)|email (?:me|us)|get back to me|next week|later|after (?:the|this)|need to discuss|check internally|more information)\b/i.test(customerText)) return 'Follow-up Required';
  if (/\b(interested|sounds good|curious|tell me more|want to know|would like to|want to see|see how|show me|can you show|could help|can help|help us|that helps|we need|looking for|like to learn|useful)\b/i.test(customerText)) return 'Interested';
  return 'Interested';
}

function localReply(call: CallRecord, transcript: TranscriptMessage[], isStart: boolean): string {
  const name = call.customerName.split(/\s+/)[0] || call.customerName;
  const { productName, primaryProblem, featuresBenefits, pricing, language } = call.productContext;
  const customerText = customerMessages(transcript).at(-1) || '';
  if (isStart) {
    if (language === 'Hindi') return `नमस्ते ${name}, समय देने के लिए धन्यवाद। मैं ${productName} के बारे में बात करने के लिए कॉल कर रहा हूँ। ${primaryProblem ? `मैं समझता हूँ कि आपकी टीम ${primaryProblem} से जूझ रही है।` : ''} आपकी टीम के लिए अभी सबसे बड़ी चुनौती क्या है?`;
    return `Hi ${name}, thanks for taking the time. I’m calling about ${productName}. ${primaryProblem ? `I understand your team is working through ${primaryProblem}. ` : ''}What is the biggest challenge your team is facing right now?`;
  }
  const lower = customerText.toLowerCase();
  if (requestsDemo(lower)) return language === 'Hindi'
    ? `ज़रूर, ${productName} का डेमो तय कर सकते हैं। आपके लिए कौन सा दिन और समय सुविधाजनक रहेगा?`
    : `Absolutely, we can arrange a ${productName} demo. What day and time would work best for you?`;
  if (/\b(price|pricing|cost|how much|budget|expensive)\b/i.test(lower)) {
    if (pricing.trim()) return language === 'Hindi'
      ? `दी गई कीमत की जानकारी यह है: ${pricing}। क्या आप अपने लिए सही विकल्प पर बात करना चाहेंगे?`
      : `Of course. The pricing information you provided is: ${pricing}. Would you like to talk through which option best fits your team?`;
    return language === 'Hindi'
      ? 'अभी मेरे पास पक्की कीमत की जानकारी नहीं है, इसलिए मैं अनुमान नहीं लगाऊँगा। क्या मैं सही जानकारी लेकर आपको वापस संपर्क करूँ?'
      : 'I don’t have confirmed pricing details, so I don’t want to guess. Would it help if I followed up with the right information?';
  }
  if (/\b(not interested|no thanks|don't need|do not need|we'll pass|stop calling)\b/i.test(lower)) return language === 'Hindi'
    ? 'समझ गया, समय देने के लिए धन्यवाद। आपका दिन अच्छा रहे।'
    : 'Understood. Thanks for your time, and I hope you have a great day.';
  if (/\b(call me|follow up|email me|send (?:me )?(?:details|information|info)|later|next week)\b/i.test(lower)) return language === 'Hindi'
    ? 'बिल्कुल, मैं आपके लिए फॉलो-अप नोट कर लूँगा। किस समय या तारीख पर संपर्क करना बेहतर रहेगा?'
    : 'Of course, I can note a follow-up. What date or time would be best to reach you?';
  if (/\b(buy|purchase|subscribe|sign up|let's proceed|go ahead)\b/i.test(lower)) return language === 'Hindi'
    ? 'धन्यवाद। आगे बढ़ने से पहले, क्या आप पुष्टि कर सकते हैं कि आप सदस्यता शुरू करना चाहते हैं?'
    : 'Thanks for considering it. Before I record that as a commitment, can you confirm you’d like to start a subscription?';
  if (isSolutionRequest(lower)) {
    const suppliedFacts = suppliedProductFacts(call);
    const featureFacts = suppliedFacts.filter((fact) => fact.source === 'feature').map((fact) => fact.text);
    const productFacts = (featureFacts.length ? featureFacts : suppliedFacts.filter((fact) => fact.source === 'description').map((fact) => fact.text)).slice(0, 3);
    if (!productFacts.length) return language === 'Hindi'
      ? `मैं समाधान सुझाना चाहूँगा, लेकिन ${productName} की सुविधाओं का विवरण अभी उपलब्ध नहीं है। मैं अनुमान लगाने के बजाय सही जानकारी लेकर आ सकता हूँ।`
      : `I’d be glad to suggest a solution, but I don’t have the feature details for ${productName} yet. I can follow up with accurate information instead of guessing.`;
    const problemContext = primaryProblem.trim()
      ? language === 'Hindi' ? `आपने बताया कि आपकी टीम की मुख्य चुनौती ${primaryProblem} है। ` : `You mentioned your team’s main challenge is ${primaryProblem}. `
      : '';
    const productSummary = productFacts.join('; ');
    return language === 'Hindi'
      ? `${problemContext}${productName} की दी गई जानकारी में ये सुविधाएँ हैं: ${productSummary}। क्या आप चाहेंगे कि मैं बताऊँ इनमें से कौन सी सुविधा आपकी प्राथमिकता से सबसे ज्यादा जुड़ती है?`
      : `${problemContext}Based on the product information, ${productName} offers ${productSummary}. Which of those capabilities would you like me to explain first?`;
  }
  if (isProductOverviewQuestion(customerText)) {
    const description = call.productContext.productDescription.trim();
    const features = call.productContext.featuresBenefits.split(/\n+|[;,]+|(?<=[.!?])\s+/).map((item) => item.replace(/^[-•*\s]+/, '').trim()).filter(Boolean).slice(0, 2);
    const details = [description, features.length ? `The listed features include ${features.join('; ')}.` : ''].filter(Boolean).join(' ');
    if (details) return language === 'Hindi'
      ? `${productName} के बारे में दी गई जानकारी: ${details} इनमें से कौन सा हिस्सा आपकी ज़रूरत से सबसे ज्यादा जुड़ा है?`
      : `Here’s what I can tell you from the product details: ${details} Which part is most relevant to what your team needs?`;
    return language === 'Hindi'
      ? `${productName} की सुविधाओं का विवरण अभी मेरे पास नहीं है, इसलिए मैं अनुमान नहीं लगाऊँगा। आपकी टीम किस समस्या का समाधान चाहती है?`
      : `I don’t have the feature details for ${productName} yet, so I don’t want to guess. What problem is your team hoping to solve?`;
  }
  const matchingFact = bestProductFact(call, customerText);
  if (matchingFact) {
    if (language === 'Hindi') return `दी गई ${productName} जानकारी में ${matchingFact.text} शामिल है। क्या आप इसी सुविधा के बारे में पूछ रहे थे?`;
    return matchingFact.source === 'feature'
      ? `The product details list ${matchingFact.text}. Is that the capability you were asking about?`
      : `The product description says ${matchingFact.text}. Does that answer what you wanted to know?`;
  }
  if (isQuestion(customerText)) return localUnknownAnswer(productName, language, customerText);
  if (/\b(too difficult|hard to use|complex|training|onboard)\b/i.test(lower)) return `That’s a fair concern. ${featuresBenefits.trim() ? `The product information notes: ${featuresBenefits}. ` : ''}What would make adoption easier for your team?`;
  if (/\b(we already|already use|competitor|switching|current tool)\b/i.test(lower)) return 'That makes sense. What is working well with your current setup, and what would you want to improve if you considered a change?';
  if (/\b(need|problem|challenge|waste|slow|manual|difficult|struggle|issue)\b/i.test(lower)) {
    if (featuresBenefits.trim()) return `I hear you. Based on what you shared, ${productName} may be relevant because the product details include ${featuresBenefits.split(/[\n,;]+/)[0].trim()}. What would a good outcome look like for your team?`;
    return `I understand. You mentioned ${customerText.length > 90 ? `${customerText.slice(0, 87)}…` : customerText}. What have you tried so far to address that?`;
  }
  const turnCount = customerMessages(transcript).length;
  const questions = language === 'Hindi'
    ? ['आपके लिए इस समस्या को हल करना कितना जरूरी है?', 'इसका असर आपकी टीम के रोज़मर्रा के काम पर कैसे पड़ता है?', 'इस पर फैसला लेते समय आपकी टीम किन बातों को सबसे ज्यादा महत्व देती है?']
    : ['How important is solving this for your team right now?', 'How does that affect your team’s day-to-day work?', 'What would your team value most when choosing a solution?'];
  return `${turnCount > 2 ? 'Thanks, that helps me understand the situation.' : 'Thanks for explaining that.'} ${questions[Math.min(turnCount - 1, questions.length - 1)]}`;
}

export async function generateSalesReply(call: CallRecord, transcript: TranscriptMessage[], isStart: boolean): Promise<{ reply: string; source: 'ai' | 'local'; warning: string | null }> {
  if (!isAiConfigured()) return {
    reply: localReply(call, transcript, isStart),
    source: 'local',
    warning: 'No AI provider is configured. This reply came from the local rule-based fallback.',
  };
  try {
    const reply = await generateModelReply(call, transcript, isStart);
    return { reply, source: 'ai', warning: null };
  } catch (error) {
    const providerName = getAiProvider() === 'ollama' ? 'Ollama' : 'OpenAI';
    const detail = error instanceof Error ? error.message : `Unknown ${providerName} request error.`;
    return {
      reply: localReply(call, transcript, isStart),
      source: 'local',
      warning: `${providerName} could not respond (${detail}). This turn used the clearly labeled local rule-based mode.`,
    };
  }
}

function explicitConversionStatus(status: SalesStatus, transcript: TranscriptMessage[]): { status: SalesStatus; guarded: boolean } {
  if (status !== 'Converted') return { status, guarded: false };
  if (explicitCommitment(customerMessages(transcript).join(' '))) return { status: 'Converted', guarded: false };
  const fallback = classifyLocalStatus(transcript);
  return { status: fallback === 'Converted' ? 'Interested' : fallback, guarded: true };
}

function localSummary(call: CallRecord, transcript: TranscriptMessage[]): { summary: CallSummary; status: SalesStatus } {
  const customers = meaningfulCustomerMessages(transcript);
  const allText = transcript.map((message) => message.text).join(' ').toLowerCase();
  const customerText = customers.join(' ');
  const status = classifyLocalStatus(transcript);
  const featureLines = call.productContext.featuresBenefits.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
  const featuresDiscussed = featureLines.filter((feature) => {
    const words = feature.toLowerCase().split(/\W+/).filter((word) => word.length > 3);
    return words.some((word) => allText.includes(word));
  }).slice(0, 5);
  const objectionPatterns = [
    /[^.!?]*(?:too expensive|price|pricing|budget|cost)[^.!?]*/i,
    /[^.!?]*(?:already use|current tool|competitor|switch)[^.!?]*/i,
    /[^.!?]*(?:not interested|don't need|do not need|no thanks)[^.!?]*/i,
    /[^.!?]*(?:security|privacy|compliance)[^.!?]*/i,
    /[^.!?]*(?:too difficult|complex|training|onboard)[^.!?]*/i,
    /[^.!?]*(?:need to discuss|check internally|approval)[^.!?]*/i,
  ];
  const objections = objectionPatterns.map((pattern) => customerText.match(pattern)?.[0]?.trim()).filter((item): item is string => Boolean(item)).slice(0, 4);
  const interestLevel: CallSummary['interestLevel'] = status === 'Converted' || status === 'Demo Requested' ? 'High' : status === 'Interested' ? 'Medium' : status === 'Follow-up Required' ? 'Low' : 'None';
  const agreedNextSteps = status === 'Demo Requested' ? ['Schedule the requested product demonstration.']
    : status === 'Follow-up Required' ? ['Contact the customer at the requested time with the information they asked for.']
      : status === 'Converted' ? ['Confirm subscription details and the customer’s chosen next step.']
        : status === 'Interested' ? ['Share relevant product information and ask whether the customer would like a demo.']
          : status === 'No Response' ? []
            : ['Close the conversation respectfully; do not schedule another contact without permission.'];
  return {
    status,
    summary: {
      overview: customers.length ? `${call.customerName} discussed ${call.productContext.productName}. Customer comments: ${customers.slice(0, 2).join(' ')}` : `A call about ${call.productContext.productName} was started, but no meaningful customer response was captured.`,
      requirements: customers.slice(0, 4),
      featuresDiscussed,
      objections,
      interestLevel,
      agreedNextSteps,
      followUpRecommendation: status === 'No Response' ? 'No customer response was captured. Review the contact details before attempting another call.'
        : status === 'Not Interested' ? 'Do not follow up unless the customer initiates contact.'
          : status === 'Demo Requested' ? 'Confirm a convenient time and prepare a demonstration tailored to the customer’s stated needs.'
            : status === 'Follow-up Required' ? 'Follow up when requested and include the missing information the customer needs.'
              : status === 'Converted' ? 'Confirm the customer’s subscription details and hand off any onboarding needs.'
                : 'Share only information relevant to the needs the customer mentioned, then ask whether they want a demonstration.',
    },
  };
}

const summarySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    overview: { type: 'string' },
    requirements: { type: 'array', items: { type: 'string' } },
    featuresDiscussed: { type: 'array', items: { type: 'string' } },
    objections: { type: 'array', items: { type: 'string' } },
    interestLevel: { type: 'string', enum: ['High', 'Medium', 'Low', 'None'] },
    agreedNextSteps: { type: 'array', items: { type: 'string' } },
    followUpRecommendation: { type: 'string' },
    status: { type: 'string', enum: [...salesStatuses] },
  },
  required: ['overview', 'requirements', 'featuresDiscussed', 'objections', 'interestLevel', 'agreedNextSteps', 'followUpRecommendation', 'status'],
} as const;

export async function generateCallAnalysis(call: CallRecord): Promise<{
  summary: CallSummary;
  aiStatus: SalesStatus;
  status: SalesStatus;
  source: 'ai' | 'local';
  statusSource: 'ai' | 'local' | 'ai_guarded';
  error: string | null;
}> {
  const fallback = localSummary(call, call.transcript);
  if (!isAiConfigured()) {
    return { summary: fallback.summary, aiStatus: fallback.status, status: fallback.status, source: 'local', statusSource: 'local', error: null };
  }
  const instructions = [
    'Analyze the actual transcript of a SaaS sales call and return only the requested structured JSON.',
    'Every summary field must be based only on the provided transcript and product information. Do not invent customer needs, features, pricing, objections, commitments, or next steps.',
    'Use concise plain language. Requirements should reflect what the customer said; featuresDiscussed should include only product features that actually came up.',
    'Assign exactly one status. Converted is allowed only when the customer explicitly agrees to purchase, subscribe, or proceed with buying. A salesperson recommendation or positive sentiment alone is never a conversion.',
    'Use No Response if the transcript contains no meaningful customer reply. Do not treat a greeting or acknowledgement alone as interest.',
    'Use Demo Requested only if the customer asked for a demo or demonstration. Follow-up Required if the customer asked to be contacted later or needs information before deciding.',
    `Product details: ${productDescription(call)}`,
    `Status values: ${salesStatuses.join(', ')}.`,
  ].join('\n');
  try {
    const output = await requestAi({
      instructions,
      input: transcriptInput(call.transcript),
      text: { format: { type: 'json_schema', name: 'sales_call_analysis', strict: true, schema: summarySchema } },
    });
    const parsed = JSON.parse(output) as CallSummary & { status?: unknown };
    if (!parsed || typeof parsed !== 'object' || typeof parsed.overview !== 'string' || !Array.isArray(parsed.requirements) || !Array.isArray(parsed.featuresDiscussed) || !Array.isArray(parsed.objections) || !Array.isArray(parsed.agreedNextSteps) || typeof parsed.followUpRecommendation !== 'string') {
      throw new Error('The AI provider returned a summary that did not match the required format.');
    }
    if (!salesStatuses.includes(parsed.status as SalesStatus)) throw new Error('The AI provider returned an unsupported sales status.');
    const aiStatus = parsed.status as SalesStatus;
    const normalized = explicitConversionStatus(aiStatus, call.transcript);
    const summary = { ...parsed };
    delete (summary as { status?: unknown }).status;
    return {
      summary: summary as CallSummary,
      aiStatus,
      status: normalized.status,
      source: 'ai',
      statusSource: normalized.guarded ? 'ai_guarded' : 'ai',
      error: null,
    };
  } catch (error) {
    const providerName = getAiProvider() === 'ollama' ? 'Ollama' : 'OpenAI';
    const detail = error instanceof Error ? error.message : `Unknown ${providerName} summarization error.`;
    return { summary: fallback.summary, aiStatus: fallback.status, status: fallback.status, source: 'local', statusSource: 'local', error: detail };
  }
}

export function createTranscriptMessage(
  speaker: TranscriptMessage['speaker'],
  text: string,
  generation?: { source: 'ai' | 'local'; warning: string | null },
): TranscriptMessage {
  return {
    id: randomUUID(),
    speaker,
    text,
    createdAt: new Date().toISOString(),
    ...(speaker === 'assistant' && generation ? {
      generationSource: generation.source,
      ...(generation.warning ? { generationWarning: generation.warning } : {}),
    } : {}),
  };
}
