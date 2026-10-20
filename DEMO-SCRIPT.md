# Submission video demo script (about 2 minutes)

## 0:00–0:20 — Dashboard

“This is Voxline, a sales workspace for real AI-assisted SaaS calls. The dashboard reads call totals, conversions, interested prospects, follow-ups, and conversion rate from the saved database. A new installation starts empty instead of showing made-up customer records.”

## 0:20–0:45 — Set up a call

“I’ll start a new call and add a customer, our product and its features, pricing if it is confirmed, the customer’s main problem, and the preferred language. Before microphone access or recording can start, I confirm that the customer has given permission to be recorded.”

## 0:45–1:20 — Live conversation

“The call opens with a live timer, recording indicator, microphone controls, and transcript. I can speak if browser speech recognition is supported, or type the customer’s response in the same composer. Voxline sends that real input to the server-side OpenAI Responses API and speaks the generated reply through the browser. I can interrupt speech or mute the microphone. If the API key or voice input is unavailable, the app says so and keeps the text path usable.”

## 1:20–1:42 — End call, summary, and status

“When I end the call, the actual transcript is used to generate a structured summary with the customer’s requirements, features discussed, objections, interest level, next steps, and a follow-up recommendation. The backend validates one of six statuses and guards against marking a call converted without explicit buying intent. The operator can correct the saved status.”

## 1:42–2:00 — History and recording

“Call history lets me search customers and products, filter by status, and sort by date. Opening a call shows its saved transcript, summary, status, and recording player. The SQLite data and audio files are stored under the configured persistent data directory, so they remain after a page refresh and backend restart.”

## Before recording the video

- Start Ollama, run `ollama pull qwen2.5:3b`, and set `AI_PROVIDER=ollama` in `.env` before launching the app. The Settings page should report that the Ollama model is ready. If Ollama is unavailable, identify the rule-based fallback accurately.
- Use a browser with SpeechRecognition support and grant microphone access. Keep the voiceover or customer side close to the microphone if you want it included in the recording.
- Ask the demo participant for recording permission before recording any call.
