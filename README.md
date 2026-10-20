# Voxline — AI Voice Sales Workspace

A complete single-operator workspace for AI-assisted SaaS sales calls, built for the Sankar Group internship assignment. It includes a React + TypeScript dashboard, a Node/Express API, SQLite call history, browser voice input/output, and consent-gated audio recording.

## What works

- Dashboard statistics and recent calls are loaded from saved call records; the app starts with an honest empty state.
- New-call setup captures a customer, SaaS product, product description, feature/benefit notes, optional pricing, the customer’s problem, and English or Hindi.
- The operator must confirm recording consent before the app asks for microphone access or starts a call.
- Browser SpeechRecognition sends real recognized customer speech to the backend. When it is unavailable or permission is denied, the text composer is a working alternative.
- AI replies and structured call summaries can run through Ollama on the same computer, or through the optional OpenAI provider. Browser speech synthesis reads replies aloud where supported.
- Calls are recorded from the microphone with MediaRecorder. Five-second audio chunks are uploaded during the call and written to disk, so a navigation or browser interruption does not discard all previously uploaded audio.
- Ending a call saves the actual transcript, recording metadata, duration, structured summary, and exactly one sales status. A summary can be retried and an operator can correct the saved status.
- Call history supports search, status filters, chronological sorting, a detailed transcript, summary, recording playback/download, AI status, and follow-up recommendation.
- Local development uses Ollama by default and needs no API key. If Ollama or its selected model is unavailable, the app clearly reports the problem and uses its transparent rule-based fallback for that turn.

## Requirements

- Node.js 20.19+ or 22.12+ (Node 22 LTS recommended) and npm.
- A modern browser. Microphone capture requires HTTPS in production (localhost is allowed for local development).
- Ollama installed and running, plus the selected model downloaded, for generated local AI conversations and summaries. No API key is required. The app also supports optional OpenAI use.

This workspace was built with Node 24. The `.nvmrc` selects Node 22; the system Node 21 release is outside Vite’s supported engine range.

## Install and run locally

```bash
npm install
cp .env.example .env
# Install and start Ollama first: https://ollama.com/download
ollama pull qwen2.5:3b
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The Vite development server proxies `/api` calls to the Express server on port 3001. SQLite and audio files are created in `./data` by default. They are excluded from Git.

Start the Ollama desktop app before running the bot. If its server is not already running, start it with `ollama serve`. The backend reads provider configuration on startup. Never add API keys to frontend code or commit a real `.env` file.

## Build and checks

```bash
npm run typecheck
npm run lint
npm run build
npm start
```

`npm start` serves the built frontend and the API from one origin when `NODE_ENV=production`. Set `PORT` if the hosting service supplies a port, and set `DATA_DIR` to a writable persistent directory.

## AI configuration

Ollama is the default local provider. The example environment selects it and uses `qwen2.5:3b`, which uses Ollama's llama.cpp runner and can fall back to CPU when Metal is unavailable:

```dotenv
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:3b
OLLAMA_TIMEOUT_MS=120000
```

Install [Ollama](https://ollama.com/download), start its local service, and run `ollama pull qwen2.5:3b`. The backend sends transcript and product context to Ollama’s local `/api/chat` endpoint. Call text stays on the computer running the backend. The model is configurable through `OLLAMA_MODEL`, and the URL can point to another Ollama service through `OLLAMA_BASE_URL`.

The Settings page checks whether the Ollama service is reachable and whether the configured model is installed. If Ollama is stopped or the model is missing, the live call explains the issue and uses the rule-based fallback; the transcript is still saved, and failed summaries can be retried after Ollama is available.

To use OpenAI instead, set `AI_PROVIDER=openai`, `OPENAI_API_KEY`, and optionally `OPENAI_MODEL` in `.env`. Set `AI_PROVIDER=local` to disable generated AI and use only the transparent rule-based responder and transcript-derived recap. If `AI_PROVIDER` is omitted, the server selects OpenAI when an OpenAI key is present, otherwise it uses local fallback mode.

## Voice, consent, and recording

Speech recognition and synthesis are browser features, so support varies by browser and operating system. If recognition is unsupported, the live screen switches to a clear text-input path. If microphone permission is denied, the call can proceed in text mode, but the app does not create a recording. Speech synthesis is optional; text replies remain visible if speech output is unavailable.

Before a call starts, the operator confirms the customer agreed to recording. Only then does the app request microphone access, create a call session, and start MediaRecorder. The browser sends actual audio data, not generated or prerecorded audio. The server reports a recording only after it has written at least one non-empty chunk. If capture or storage fails, the transcript still persists and the interface explains that no playable recording was saved.

## Database and storage

- SQLite database: `${DATA_DIR}/voice-sales.sqlite`
- Recordings: `${DATA_DIR}/recordings/{call-id}.webm`
- The database is initialized automatically at server startup. Existing in-progress sessions are closed and summarized on the next startup, preserving available transcript and already-uploaded recording chunks.
- This implementation uses `sql.js` (SQLite compiled to WebAssembly) and writes a consistent SQLite file after data changes. It is appropriate for an internship demo and a low-volume single-instance deployment. It is not designed for multiple concurrent server replicas or high write volume.
- Make regular backups of the whole `DATA_DIR`. A recording saved on an ephemeral filesystem will be lost when a host replaces that instance.

## API overview

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Health check, selected provider, and local Ollama model availability |
| `GET` | `/api/dashboard` | Statistics and recent calls |
| `POST` | `/api/calls` | Validate and start a call session |
| `POST` | `/api/calls/:id/messages` | Save customer text and generate the next assistant turn |
| `POST` | `/api/calls/:id/recording-chunks` | Persist one consented MediaRecorder audio chunk |
| `POST` | `/api/calls/:id/end` | End the call and generate/save its recap and status |
| `POST` | `/api/calls/:id/summary/retry` | Retry summary/classification from the stored transcript |
| `PATCH` | `/api/calls/:id/status` | Save an operator’s status correction |
| `GET` | `/api/calls` | Search/filter/sort completed call history |
| `GET` | `/api/calls/:id` | Fetch full call details |
| `GET` | `/api/calls/:id/recording` | Stream or download saved call audio |

Requests are validated with Zod. Status values are restricted to `Converted`, `Interested`, `Follow-up Required`, `Not Interested`, `Demo Requested`, and `No Response`. The backend checks generated statuses against this set and guards `Converted` unless the customer transcript contains explicit buying/subscribe intent. It stores both the original model suggestion and the currently applied status, so a manual correction does not erase the generated result.

## Deploy to Render

The repository includes `render.yaml` for a single Node web service that serves both frontend and API. It requests a 1 GB persistent disk mounted at `/opt/render/project/src/data` and points `DATA_DIR` there. A persistent disk requires a paid Render service plan; the configured `starter` service is not a free, ephemeral demo. Render disks are mounted at runtime and only data under the mount path persists. A disk is attached to one service instance, so this SQLite setup should stay at one instance; disk-backed services also have a short deployment interruption during replacement. See [Render persistent disk behavior](https://render.com/docs/disks) and the [Blueprint specification](https://render.com/docs/blueprint-spec).

1. Push this repository to a Git provider connected to Render.
2. In Render, choose **New → Blueprint**, select the repository, and deploy the detected `render.yaml`.
3. The blueprint starts in rule-based mode because a hosted Render service cannot reach Ollama running on your personal computer. To use Ollama in a hosted deployment, set `AI_PROVIDER=ollama`, `OLLAMA_MODEL`, and `OLLAMA_BASE_URL` to a private Ollama service reachable from Render. Do not expose an unauthenticated Ollama port to the public internet. Alternatively, set `AI_PROVIDER=openai` and add an OpenAI key as a server-side secret.
4. After the first deploy, check the service’s `/api/health` endpoint and open its service URL. Browser microphone access will require HTTPS, which the public Render service provides.
5. Keep the configured disk attached and maintain backups of its `data` directory. Do not scale the service above one instance while using the local SQLite file.

For another Docker host, build with `docker build -t voxline .`, run with `-p 3001:3001`, set `DATA_DIR=/var/data`, and mount a persistent volume at `/var/data`. For Ollama, set `AI_PROVIDER=ollama` and point `OLLAMA_BASE_URL` to a private service reachable from the container. The included `Dockerfile` serves the compiled UI and API together. Do not use a host with ephemeral-only storage if saved calls and recordings must survive restarts.

## Limitations to review before real customer use

- This assignment app has no user sign-in or access control; deploy it only behind a private network or an access-control layer until authentication is added.
- Browser speech recognition is not supported consistently across browsers. Text input remains available.
- Uploaded recordings contain microphone audio only. A remote customer’s voice is recorded only if it is present in the local microphone input (for example, a speakerphone). No telephony connection or remote-party audio capture is implemented.
- The local filesystem design is single-instance. For multi-instance scale, replace SQLite/local files with a managed database and object storage, then adapt the recording service.

## Submission demo script

See [`DEMO-SCRIPT.md`](./DEMO-SCRIPT.md) for a short screen-recording walkthrough.

### No-cost demo deployment

For a no-cost demonstration, create a Render Blueprint from `render-demo.yaml` by setting **Blueprint Path** to `render-demo.yaml`. This configuration uses a Free web service, stores SQLite files and recordings in `/tmp/voxline`, and selects the transparent local fallback because a Render service cannot reach Ollama running on your computer. Add a hosted AI provider and server-side key in Render's environment settings if you need generated AI replies in the deployed app.

Render Free web services spin down after 15 minutes without traffic, and their filesystem is ephemeral. Call history and recordings can be lost when the service restarts or redeploys, so use this only for a demo. For durable call data and recordings, use the paid persistent-disk configuration in the root `render.yaml`. See [Render Free instance limitations](https://render.com/docs/free) and [Render Blueprint setup](https://render.com/docs/infrastructure-as-code).
