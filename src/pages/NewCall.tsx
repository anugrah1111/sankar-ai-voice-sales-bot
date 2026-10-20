import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ArrowRight, Check, Info, Mic, ShieldCheck } from 'lucide-react';
import type { CallLanguage, ProductContext } from '../../shared/types';
import { api } from '../api';
import { setPendingStream, stopStream } from '../media';

const emptyContext: ProductContext = {
  productName: '',
  productDescription: '',
  featuresBenefits: '',
  pricing: '',
  primaryProblem: '',
  language: 'English',
};

export default function NewCall() {
  const navigate = useNavigate();
  const [customerName, setCustomerName] = useState('');
  const [context, setContext] = useState<ProductContext>(emptyContext);
  const [consent, setConsent] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [microphoneNotice, setMicrophoneNotice] = useState('');

  function setField<K extends keyof ProductContext>(key: K, value: ProductContext[K]) {
    setContext((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMicrophoneNotice('');
    if (!customerName.trim() || !context.productName.trim()) {
      setError('Add a customer name and product name before starting the call.');
      return;
    }
    if (!consent) {
      setError('Confirm that the customer has consented before starting a recorded call.');
      return;
    }
    setStarting(true);
    let stream: MediaStream | null = null;
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        } catch (reason) {
          const message = reason instanceof Error && reason.name === 'NotAllowedError'
            ? 'Microphone access was denied. You can still continue using text input; no audio will be recorded.'
            : 'Microphone access is unavailable. You can still continue using text input; no audio will be recorded.';
          setMicrophoneNotice(message);
        }
      } else {
        setMicrophoneNotice('This browser does not provide microphone capture. You can continue using text input.');
      }
      const { call } = await api.startCall({ customerName: customerName.trim(), context: { ...context, productName: context.productName.trim() }, recordingConsent: true });
      setPendingStream(stream);
      navigate(`/call/${call.id}`);
    } catch (reason) {
      stopStream(stream);
      setPendingStream(null);
      setError(reason instanceof Error ? reason.message : 'The call could not be started. Please try again.');
      setStarting(false);
    }
  }

  return <div className="page form-page">
    <div className="crumb-row"><button className="back-link" onClick={() => navigate(-1)}><ArrowLeft size={15} /> Back</button><span className="crumb-divider">/</span><span>New call</span></div>
    <div className="form-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> CALL SETUP</div><h1>Start a new call</h1><p className="page-subtitle">Give your assistant the context to make this conversation relevant.</p></div><div className="step-pill"><span>01</span> Setup <span className="step-line" /> <span className="step-next">02</span> Conversation</div></div>
    <form onSubmit={handleSubmit} className="call-setup-grid">
      <div className="setup-main">
        <section className="form-card">
          <div className="form-card-heading"><span className="form-step-number">01</span><div><h2>Who are you calling?</h2><p>A little context helps the assistant sound natural.</p></div></div>
          <label className="field-label" htmlFor="customerName">Customer name <span className="required-star">*</span></label>
          <input id="customerName" className="text-input" autoComplete="off" placeholder="e.g. Priya Sharma" value={customerName} onChange={(event) => setCustomerName(event.target.value)} required maxLength={100} />
          <div className="field-hint">Used to personalize the greeting.</div>
        </section>
        <section className="form-card">
          <div className="form-card-heading"><span className="form-step-number">02</span><div><h2>What are you offering?</h2><p>Only information you provide here will be used during the call.</p></div></div>
          <label className="field-label" htmlFor="productName">SaaS product name <span className="required-star">*</span></label>
          <input id="productName" className="text-input" placeholder="e.g. FlowDesk" value={context.productName} onChange={(event) => setField('productName', event.target.value)} required maxLength={100} />
          <label className="field-label field-spaced" htmlFor="description">Product description</label>
          <textarea id="description" className="text-input textarea" rows={3} placeholder="What does your product help customers do?" value={context.productDescription} onChange={(event) => setField('productDescription', event.target.value)} maxLength={1500} />
          <label className="field-label field-spaced" htmlFor="features">Key features and benefits</label>
          <textarea id="features" className="text-input textarea" rows={3} placeholder="Add the features and outcomes the assistant can discuss." value={context.featuresBenefits} onChange={(event) => setField('featuresBenefits', event.target.value)} maxLength={2500} />
          <div className="form-two-columns">
            <div><label className="field-label field-spaced" htmlFor="pricing">Pricing information</label><textarea id="pricing" className="text-input textarea" rows={3} placeholder="Leave blank if pricing is not confirmed." value={context.pricing} onChange={(event) => setField('pricing', event.target.value)} maxLength={1000} /></div>
            <div><label className="field-label field-spaced" htmlFor="problem">Customer’s primary problem</label><textarea id="problem" className="text-input textarea" rows={3} placeholder="What challenge led to this call?" value={context.primaryProblem} onChange={(event) => setField('primaryProblem', event.target.value)} maxLength={1000} /></div>
          </div>
        </section>
        <section className="form-card language-card">
          <div className="form-card-heading"><span className="form-step-number">03</span><div><h2>Choose a language</h2><p>Used for the assistant’s replies and speech recognition.</p></div></div>
          <div className="language-options" role="radiogroup" aria-label="Preferred language">
            {(['English', 'Hindi'] as CallLanguage[]).map((language) => <button key={language} type="button" role="radio" aria-checked={context.language === language} className={`language-option ${context.language === language ? 'language-selected' : ''}`} onClick={() => setField('language', language)}><span className="language-radio">{context.language === language && <span />}</span><span><strong>{language}</strong><small>{language === 'English' ? 'English (India)' : 'हिन्दी'}</small></span><span className="language-code">{language === 'English' ? 'EN' : 'HI'}</span></button>)}
          </div>
        </section>
      </div>
      <aside className="setup-aside">
        <div className="call-preview-card"><div className="preview-topline"><span className="preview-live"><span /> READY</span><span className="preview-lock"><ShieldCheck size={14} /> Private setup</span></div><div className="preview-wave"><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div><div className="preview-name">{customerName || 'Customer name'}</div><div className="preview-product">{context.productName || 'Your product'}</div><div className="preview-divider" /><div className="preview-line"><span>Language</span><strong>{context.language}</strong></div><div className="preview-line"><span>Recording</span><strong className="consent-pending">Consent required</strong></div></div>
        <div className="consent-card"><div className="consent-icon"><ShieldCheck size={18} /></div><div className="consent-heading">Recording consent</div><p>Ask the customer for permission before recording. Recording begins only after you confirm their consent and start the call.</p><label className="consent-check"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span className="custom-checkbox"><Check size={13} /></span><span>I have informed the customer and received consent to record this call.</span></label><div className="consent-privacy"><Info size={13} /> Audio is stored in your configured recordings folder.</div></div>
        {microphoneNotice && <div className="notice notice-warm"><Mic size={16} /><span>{microphoneNotice}</span></div>}
        {error && <div className="alert alert-error" role="alert"><AlertCircle size={16} /> {error}</div>}
        <button type="submit" className="button button-primary button-full button-tall" disabled={starting || !consent}>{starting ? <><span className="spinner spinner-light" /> Connecting…</> : <>Start call <ArrowRight size={17} /></>}</button>
        <div className="setup-note"><ShieldCheck size={15} /> AI processing runs on the server. With the default local Ollama setup, call text stays on this computer.</div>
      </aside>
    </form>
  </div>;
}
