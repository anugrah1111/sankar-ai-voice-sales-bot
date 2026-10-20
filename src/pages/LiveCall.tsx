import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ArrowRight, Check, CircleHelp, Headphones, LoaderCircle, MessageCircle, Mic, MicOff, RefreshCw, Send, Sparkles, Square, Volume2, VolumeX } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { CallRecord, TranscriptMessage } from '../../shared/types';
import { api, formatDuration } from '../api';
import { setPendingStream, stopStream, takePendingStream } from '../media';
import StatusBadge from '../components/StatusBadge';

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionConstructor = new () => RecognitionLike;

function transcriptClass(message: TranscriptMessage) {
  return message.speaker === 'customer' ? 'message-customer' : 'message-assistant';
}

function SummaryRecap({ call, retrying, onRetry }: { call: CallRecord; retrying: boolean; onRetry: () => void }) {
  return <section className="call-recap">
    <div className="recap-header"><div className="recap-icon"><Sparkles size={17} /></div><div><h2>Call recap</h2><p>{call.summarySource === 'ai' ? 'AI-generated from this conversation' : 'Local rule-based recap from this transcript'}</p></div><StatusBadge status={call.status} /></div>
    {call.summary ? <><p className="recap-overview">{call.summary.overview}</p><div className="recap-columns"><div><span className="recap-label">Customer requirements</span>{call.summary.requirements.length ? <ul>{call.summary.requirements.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="muted-small">No requirements captured.</p>}</div><div><span className="recap-label">Next steps</span>{call.summary.agreedNextSteps.length ? <ul>{call.summary.agreedNextSteps.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="muted-small">No next step was agreed.</p>}</div></div>{call.summaryError && <div className="summary-error"><AlertCircle size={14} /><span>AI summary unavailable: {call.summaryError} A local recap was saved.</span><button onClick={onRetry} disabled={retrying}>{retrying ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />} Retry AI summary</button></div>}{!call.summaryError && call.summarySource === 'local' && <div className="summary-hint">Select Ollama in the server configuration to generate an AI summary and sales status.</div>}</> : <div className="summary-empty"><p>The transcript is saved. A summary could not be generated.</p><button onClick={onRetry} className="button button-secondary" disabled={retrying}>{retrying ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />} Retry summary</button>{call.summaryError && <small>{call.summaryError}</small>}</div>}
  </section>;
}

export default function LiveCall() {
  const { id = '' } = useParams();
  const [call, setCall] = useState<CallRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [recordingError, setRecordingError] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [voiceUnavailable, setVoiceUnavailable] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSaved, setRecordingSaved] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [ending, setEnding] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [input, setInput] = useState('');
  const [interim, setInterim] = useState('');
  const [retrying, setRetrying] = useState(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const recognitionActiveRef = useRef(false);
  const assistantSpeakingRef = useRef(false);
  const speechGenerationRef = useRef(0);
  const mutedRef = useRef(muted);
  const endedRef = useRef(false);
  const endingRef = useRef(false);
  const recorderStartRef = useRef(0);
  const recordingQueueRef = useRef<Promise<void>>(Promise.resolve());
  const uploadedRecordingRef = useRef(false);
  const messageQueueRef = useRef<Promise<void>>(Promise.resolve());
  const timerIntervalRef = useRef<number | null>(null);

  const installRecording = useCallback((stream: MediaStream) => {
    if (typeof MediaRecorder === 'undefined') {
      setRecordingError('MediaRecorder is not supported in this browser. The call transcript will still be saved.');
      return;
    }
    const preferredType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type));
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined);
    } catch {
      setRecordingError('This browser could not start audio recording. The conversation can continue without a saved recording.');
      return;
    }
    recorderRef.current = recorder;
    recorderStartRef.current = Date.now();
    recorder.ondataavailable = (event) => {
      if (!event.data.size) return;
      const chunk = event.data;
      recordingQueueRef.current = recordingQueueRef.current.then(async () => {
        const form = new FormData();
        form.append('chunk', chunk, 'call-chunk.webm');
        form.append('first', String(!uploadedRecordingRef.current));
        const response = await fetch(`/api/calls/${id}/recording-chunks`, { method: 'POST', body: form });
        const payload = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(payload.error || `Audio upload failed (${response.status}).`);
        uploadedRecordingRef.current = true;
        setRecordingSaved(true);
      }).catch((reason: unknown) => {
        setRecordingError(reason instanceof Error ? reason.message : 'An audio chunk could not be saved.');
      });
    };
    recorder.onerror = () => setRecordingError('The browser reported an audio recording error.');
    try {
      recorder.start(5000);
      setRecording(true);
    } catch {
      setRecordingError('The audio recording could not be started.');
    }
  }, [id]);

  const startRecognition = useCallback((recognition: RecognitionLike) => {
    if (!recognitionActiveRef.current || endedRef.current || endingRef.current || mutedRef.current || assistantSpeakingRef.current) return;
    try {
      recognition.start();
      setIsListening(true);
    } catch {
      setIsListening(false);
    }
  }, []);

  const resumeRecognitionAfterSpeech = useCallback((generation: number) => {
    if (generation !== speechGenerationRef.current || !assistantSpeakingRef.current) return;
    assistantSpeakingRef.current = false;
    setSpeaking(false);
    const recognition = recognitionRef.current;
    if (!recognition || !streamRef.current || mutedRef.current || endedRef.current || endingRef.current) return;
    recognitionActiveRef.current = true;
    window.setTimeout(() => startRecognition(recognition), 250);
  }, [startRecognition]);

  const speak = useCallback((text: string) => {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return;
    const generation = ++speechGenerationRef.current;
    window.speechSynthesis.cancel();
    assistantSpeakingRef.current = true;
    const recognition = recognitionRef.current;
    if (recognition) {
      recognitionActiveRef.current = false;
      recognition.stop();
      setIsListening(false);
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = call?.productContext.language === 'Hindi' ? 'hi-IN' : 'en-IN';
    utterance.rate = 0.97;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => resumeRecognitionAfterSpeech(generation);
    utterance.onerror = () => resumeRecognitionAfterSpeech(generation);
    window.speechSynthesis.speak(utterance);
  }, [call?.productContext.language, resumeRecognitionAfterSpeech]);

  const sendCustomerText = useCallback((rawText: string) => {
    const text = rawText.trim();
    if (!text || endedRef.current || endingRef.current) return Promise.resolve();
    setInterim('');
    const optimisticMessage: TranscriptMessage = { id: crypto.randomUUID(), speaker: 'customer', text, createdAt: new Date().toISOString() };
    setCall((previous) => previous ? { ...previous, transcript: [...previous.transcript, optimisticMessage] } : previous);
    const job = messageQueueRef.current.then(async () => {
      setThinking(true);
      setError('');
      try {
        const result = await api.post<{ call: CallRecord; source: 'ai' | 'local'; warning: string | null }>(`/api/calls/${id}/messages`, { text });
        setCall(result.call);
        if (result.warning) setWarning(result.warning);
        if (result.source === 'local' && !result.warning) setWarning('This turn used the local rule-based response. Select an AI provider in the server configuration to enable generated replies.');
        if (result.source === 'ai') setWarning('');
        if (!muted) speak(result.call.transcript.at(-1)?.text || '');
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'The response could not be generated.');
        try {
          const latest = await api.get<{ call: CallRecord }>(`/api/calls/${id}`);
          setCall(latest.call);
        } catch { /* Keep the optimistic customer message visible. */ }
      } finally {
        setThinking(false);
      }
    });
    messageQueueRef.current = job.catch(() => undefined);
    return job;
  }, [id, muted, speak]);

  const endCall = useCallback(async () => {
    if (!call || call.state !== 'in_progress' || endingRef.current) return;
    endingRef.current = true;
    setEnding(true);
    setError('');
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    recognitionActiveRef.current = false;
    recognitionRef.current?.stop();
    await messageQueueRef.current;
    endedRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true });
        recorder.stop();
      });
    }
    await recordingQueueRef.current;
    const recordingDurationSeconds = recorderStartRef.current ? Math.max(0, (Date.now() - recorderStartRef.current) / 1000) : 0;
    const durationSeconds = Math.max(0, (Date.now() - new Date(call.startedAt).getTime()) / 1000);
    try {
      const result = await api.post<{ call: CallRecord }>(`/api/calls/${id}/end`, { durationSeconds, recordingDurationSeconds });
      setCall(result.call);
      setRecording(false);
      if (!result.call.recordingAvailable && !recordingError) setRecordingError('No recording was saved for this call.');
    } catch (reason) {
      setError(reason instanceof Error ? `${reason.message} Your transcript is preserved; use Retry to finish saving the call.` : 'The call could not be ended. Please retry.');
      endedRef.current = false;
      endingRef.current = false;
    } finally {
      stopStream(streamRef.current);
      streamRef.current = null;
      setPendingStream(null);
      setIsListening(false);
      setEnding(false);
      if (timerIntervalRef.current) window.clearInterval(timerIntervalRef.current);
    }
  }, [call, id, recordingError]);

  useEffect(() => {
    let active = true;
    api.get<{ call: CallRecord }>(`/api/calls/${id}`).then(({ call: fetched }) => {
      if (!active) return;
      setCall(fetched);
      setElapsed(Math.max(0, Math.floor((Date.now() - new Date(fetched.startedAt).getTime()) / 1000)));
      if (fetched.recordingAvailable) { setRecordingSaved(true); uploadedRecordingRef.current = true; }
      if (fetched.state === 'ended') {
        endedRef.current = true;
        setLoading(false);
        return;
      }
      const stream = takePendingStream();
      streamRef.current = stream;
      if (stream) installRecording(stream);
      else setRecordingError('This call has no active microphone stream. The transcript is available in text mode; new recording will not start after a reload.');

      const speechWindow = window as typeof window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
      const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
      if (!Recognition) {
        setVoiceUnavailable(true);
      } else if (stream) {
        const recognition = new Recognition();
        recognitionRef.current = recognition;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = fetched.productContext.language === 'Hindi' ? 'hi-IN' : 'en-IN';
        recognitionActiveRef.current = true;
        recognition.onresult = (event) => {
          // Web Speech can deliver a late result after stop(); never attribute
          // the assistant's own spoken reply to the customer.
          if (assistantSpeakingRef.current || endedRef.current || endingRef.current) return;
          const finalized: string[] = [];
          let interimText = '';
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const result = event.results[index];
            if (result.isFinal) finalized.push(result[0].transcript);
            else interimText += result[0].transcript;
          }
          setInterim(interimText.trim());
          if (finalized.length) {
            window.speechSynthesis?.cancel();
            finalized.forEach((text) => { void sendCustomerText(text); });
          }
        };
        recognition.onerror = (event) => {
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            setVoiceUnavailable(true);
            setError('Voice recognition permission was denied. Continue the conversation with text input.');
            recognitionActiveRef.current = false;
            return;
          }
          if (event.error !== 'no-speech' && event.error !== 'aborted') setError(`Speech recognition: ${event.error}. You can keep typing below.`);
        };
        recognition.onend = () => {
          setIsListening(false);
          if (recognitionActiveRef.current && !assistantSpeakingRef.current && !endedRef.current && !endingRef.current && !mutedRef.current) window.setTimeout(() => startRecognition(recognition), 300);
        };
        startRecognition(recognition);
      } else {
        setVoiceUnavailable(true);
      }
      if (!fetched.transcript.length) {
        const startTask = messageQueueRef.current.then(async () => {
          setThinking(true);
          try {
            const result = await api.post<{ call: CallRecord; source: 'ai' | 'local'; warning: string | null }>(`/api/calls/${id}/messages`, { start: true });
            if (!active) return;
            setCall(result.call);
            if (result.warning) setWarning(result.warning);
            if (result.source === 'local' && !result.warning) setWarning('Local rule-based mode is active. Select an AI provider in the server configuration to enable generated replies.');
            if (result.source === 'ai') setWarning('');
            if (result.call.transcript.at(-1)?.speaker === 'assistant') speak(result.call.transcript.at(-1)!.text);
          } catch (reason) {
            if (active) setError(reason instanceof Error ? reason.message : 'The first response could not be generated.');
          } finally { if (active) setThinking(false); }
        });
        messageQueueRef.current = startTask.catch(() => undefined);
      }
    }).catch((reason: Error) => { if (active) setError(reason.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  // Start-call setup intentionally runs once after the call session loads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (call?.state !== 'in_progress') return;
    timerIntervalRef.current = window.setInterval(() => setElapsed(Math.max(0, Math.floor((Date.now() - new Date(call.startedAt).getTime()) / 1000))), 1000);
    const interruptOnExit = () => {
      if (endedRef.current || endingRef.current) return;
      const seconds = Math.max(0, (Date.now() - new Date(call.startedAt).getTime()) / 1000);
      navigator.sendBeacon(`/api/calls/${id}/interrupt`, new Blob([JSON.stringify({ durationSeconds: seconds })], { type: 'application/json' }));
    };
    window.addEventListener('pagehide', interruptOnExit);
    return () => {
      if (timerIntervalRef.current) window.clearInterval(timerIntervalRef.current);
      window.removeEventListener('pagehide', interruptOnExit);
      if (!endedRef.current && !endingRef.current) interruptOnExit();
    };
  }, [call?.id, call?.state, call?.startedAt, id]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [call?.transcript.length, interim, thinking]);

  useEffect(() => {
    mutedRef.current = muted;
    if (!recognitionRef.current) return;
    recognitionActiveRef.current = !muted && call?.state === 'in_progress' && !endedRef.current;
    streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
    if (muted) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else if (recognitionActiveRef.current) startRecognition(recognitionRef.current);
  }, [muted, call?.state, startRecognition]);

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input;
    if (!text.trim()) return;
    setInput('');
    await sendCustomerText(text);
  }

  function interruptAssistant() {
    speechGenerationRef.current += 1;
    window.speechSynthesis?.cancel();
    assistantSpeakingRef.current = false;
    setSpeaking(false);
    const recognition = recognitionRef.current;
    if (recognition && streamRef.current && !mutedRef.current && !endedRef.current && !endingRef.current) {
      recognitionActiveRef.current = true;
      window.setTimeout(() => startRecognition(recognition), 250);
    }
  }

  async function retryFinishCall() {
    if (!call) return;
    setEnding(true);
    try {
      const result = await api.post<{ call: CallRecord }>(`/api/calls/${id}/end`, { durationSeconds: elapsed, recordingDurationSeconds: elapsed });
      setCall(result.call);
      endedRef.current = true;
      endingRef.current = false;
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not finish saving this call.'); }
    finally { setEnding(false); }
  }

  async function retrySummary() {
    setRetrying(true);
    try {
      const result = await api.post<{ call: CallRecord }>(`/api/calls/${id}/summary/retry`);
      setCall(result.call);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Summary could not be retried.'); }
    finally { setRetrying(false); }
  }

  if (loading) return <div className="page loading-page"><span className="spinner" /> Preparing the call…</div>;
  if (!call) return <div className="page"><div className="alert alert-error"><AlertCircle size={16} /> {error || 'Call not found.'} <Link to="/history">Go to history</Link></div></div>;
  const live = call.state === 'in_progress';

  return <div className="page live-page">
    <div className="call-topbar"><Link to="/" className="back-link"><ArrowLeft size={15} /> Dashboard</Link><div className="call-context-title"><span className={`call-state-dot ${live ? 'state-live' : 'state-ended'}`} />{live ? 'Live call' : 'Call ended'}<span className="topbar-divider" />{call.customerName}</div><div className="call-top-duration"><span className="timer-dot" />{formatDuration(live ? elapsed : call.durationSeconds)}</div></div>
    <div className="call-layout">
      <section className="conversation-panel">
        <div className="conversation-header"><div><div className="eyebrow"><span className="eyebrow-line" />{live ? 'LIVE CONVERSATION' : 'CALL TRANSCRIPT'}</div><h1>{call.customerName}</h1><p className="conversation-product">About <strong>{call.productName}</strong> <span>·</span> {call.productContext.language}</p></div><div className={`recording-pill ${recording ? 'recording-on' : ''}`}><span className="recording-dot" />{recording ? 'Recording' : recordingSaved ? 'Recording saved' : live ? 'Not recording' : 'Recording unavailable'}</div></div>
        <div className="call-meter-card"><div className="call-avatar-wrap"><div className={`call-avatar ${speaking ? 'avatar-speaking' : ''}`}><Headphones size={25} /></div>{speaking && <span className="avatar-audio-ring" />}</div><div className="call-person"><div className="call-person-name">{call.customerName}</div><div className="call-person-sub">{call.productName}</div></div><div className="meter-wave" aria-hidden="true">{Array.from({ length: 39 }, (_, index) => <span key={index} style={{ '--bar': `${((index * 13 + 17) % 23) + 5}px`, '--delay': `${index % 7 * 0.08}s` } as CSSProperties} />)}</div><div className="call-timer"><span>{formatDuration(live ? elapsed : call.durationSeconds)}</span><small>{live ? 'CALL TIME' : 'DURATION'}</small></div></div>
        {(voiceUnavailable || !('speechSynthesis' in window)) && live && <div className="voice-fallback-banner"><MessageCircle size={15} /><span>{voiceUnavailable ? 'Voice input is unavailable in this browser. Use the message box below to continue the call.' : 'Speech output is unavailable. AI replies will appear here as text.'}</span></div>}
        {warning && <div className="mode-warning"><Sparkles size={15} /><span>{warning}</span><Link to="/settings">Settings</Link></div>}
        {error && <div className="alert alert-error compact-alert"><AlertCircle size={15} /><span>{error}</span>{live && ending && <button onClick={retryFinishCall}>Retry</button>}</div>}
        <div className="transcript-panel" aria-live="polite" aria-label="Conversation transcript">
          {call.transcript.length === 0 && <div className="transcript-empty"><div className="transcript-empty-icon"><MessageCircle size={20} /></div><strong>Starting the conversation</strong><span>Your transcript will appear here.</span></div>}
          {call.transcript.map((message) => <div key={message.id} className={`message-row ${transcriptClass(message)}`}><div className={`message-avatar ${message.speaker === 'assistant' ? 'message-avatar-ai' : ''}`}>{message.speaker === 'assistant' ? <Sparkles size={14} /> : call.customerName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</div><div className="message-content"><div className="message-meta"><strong>{message.speaker === 'assistant' ? 'Voxline assistant' : call.customerName}</strong><span>{new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(message.createdAt))}</span>{message.speaker === 'assistant' && <span className={`message-ai-tag ${message.generationSource === 'local' ? 'message-local-tag' : ''}`}>{message.generationSource === 'ai' ? 'AI GENERATED' : message.generationSource === 'local' ? 'LOCAL RESPONSE' : 'ASSISTANT'}</span>}</div><div className="message-bubble">{message.text}</div>{message.generationWarning && <div className="message-generation-warning">{message.generationWarning}</div>}</div></div>)}
          {interim && live && <div className="interim-caption"><span className="listening-dot" />{interim}<small>listening…</small></div>}
          {thinking && live && <div className="message-row message-assistant thinking-row"><div className="message-avatar message-avatar-ai"><Sparkles size={14} /></div><div className="thinking-bubble"><span /><span /><span /></div></div>}
          <div ref={transcriptEndRef} />
        </div>
        {live ? <>
          {recordingError && <div className="recording-warning"><AlertCircle size={14} /><span>{recordingError}</span></div>}
          <form className="message-composer" onSubmit={handleSend}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder={voiceUnavailable ? 'Type what the customer said…' : 'Type a message or use voice input…'} aria-label="Customer message" /><button className="send-button" aria-label="Send message" disabled={!input.trim() || thinking || ending}><Send size={17} /></button></form>
          <div className="composer-hint"><span><span className={`mic-status-dot ${isListening && !muted ? 'mic-active' : ''}`} />{muted ? 'Microphone muted' : isListening ? 'Listening for customer' : voiceUnavailable ? 'Text input ready' : 'Microphone on'}</span><span>Enter to send</span></div>
          <div className="call-controls"><button className={`control-button ${muted ? 'control-muted' : ''}`} onClick={() => setMuted((value) => { mutedRef.current = !value; return !value; })} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}><span className="control-icon">{muted ? <MicOff size={18} /> : <Mic size={18} />}</span><span>{muted ? 'Unmute' : 'Mute mic'}</span></button><button className="control-button" onClick={interruptAssistant} disabled={!speaking} aria-label="Interrupt assistant speech"><span className="control-icon">{speaking ? <VolumeX size={18} /> : <Volume2 size={18} />}</span><span>{speaking ? 'Interrupt' : 'Speaker'}</span></button><div className="controls-spacer" /><button className="button button-danger" onClick={() => void endCall()} disabled={ending}>{ending ? <><span className="spinner spinner-light" /> Ending…</> : <><Square size={14} fill="currentColor" /> End call</>}</button></div>
        </> : <div className="ended-call-actions"><div className="ended-success"><span><Check size={16} /></span><div><strong>Call saved</strong><small>Transcript, status and recap are ready.</small></div></div><Link to={`/calls/${call.id}`} className="button button-primary">View call details <ArrowRight size={16} /></Link><Link to="/new-call" className="button button-secondary">Start another call</Link></div>}
      </section>
      <aside className="call-side-panel">
        <div className="call-side-card"><div className="side-card-heading"><span className="side-card-icon"><CircleHelp size={17} /></span><div><strong>Call brief</strong><span>Context for this conversation</span></div></div><div className="brief-field"><span>PRODUCT</span><strong>{call.productName}</strong></div>{call.productContext.primaryProblem && <div className="brief-field"><span>THEIR CHALLENGE</span><p>{call.productContext.primaryProblem}</p></div>}{call.productContext.featuresBenefits && <div className="brief-field"><span>FEATURES & BENEFITS</span><p>{call.productContext.featuresBenefits}</p></div>}{call.productContext.pricing && <div className="brief-field"><span>PRICING</span><p>{call.productContext.pricing}</p></div>}{!call.productContext.primaryProblem && !call.productContext.featuresBenefits && !call.productContext.pricing && <div className="brief-empty">No product notes added for this call.</div>}<div className="brief-language"><span>Conversation language</span><span>{call.productContext.language}</span></div></div>
        <div className="call-side-tip"><div className="tip-spark"><Sparkles size={16} /></div><strong>Listen for the next step</strong><p>Let the customer’s priorities guide the conversation. A good call starts with a good question.</p></div>
      </aside>
    </div>
    {!live && <SummaryRecap call={call} retrying={retrying} onRetry={() => void retrySummary()} />}
  </div>;
}
