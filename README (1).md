# FREEDOM AI

Personal AI assistant. Built in stages (see roadmap). Current: **Stage 2 - backend and model connection**.

## Structure
```
server.js             Node server: static files, /api/health, /api/connection-test, /api/chat
lib/aiProvider.js      Calls the configured OpenAI-compatible provider (streaming + non-streaming)
lib/personality.js     Builds the system prompt; keeps tone (user-editable) separate from security rules (not editable)
lib/rateLimit.js       Per-IP rate limiting for the chat endpoint
public/index.html      All screens (welcome, chat, history, memory, search, model, personality, voice, settings, privacy)
public/css/style.css   Theme, orb, layout
public/js/app.js       Navigation, drawer, theme, saved preferences, live chat (streaming), connection test
tests/                 Automated tests (npm test)
render.yaml            Render configuration
.github/workflows/     validate.yml runs tests on every push
.env.example           Placeholder variable names
```

## Status
- Working: real chat, streamed token-by-token from whatever OpenAI-compatible provider you configure. A manual "Test connection" button on the Model screen makes one real request and reports the result honestly - the app never claims a model works without checking. Input validation, a 64KB request cap, and basic per-IP rate limiting (20 chat requests/minute) are in place. The system prompt is built server-side from your personality settings plus fixed security rules the personality text cannot override; the client can't inject its own system message.
- Not built yet: saved conversations and memory across sessions (Stage 3 - conversation history currently lives only in the open tab), voice (4), web search and coding mode (5), authentication (7), Android build (10).
- Regenerate re-sends the last turn; Stop (the send button turns into a stop icon while replying) aborts the request.

## Run on Render
1. Web Service, Node, build `npm install`, start `npm start`.
2. Environment variables:
   - `AI_API_KEY` - your provider's API key.
   - `AI_BASE_URL` - the provider's base URL *without* `/chat/completions` (the server appends that), e.g. `https://api.openai.com/v1`.
   - `AI_MODEL` - the exact model name your provider expects.
   - Do not set `PORT`; Render provides it.
   - Optional: `ALLOWED_ORIGINS` (comma-separated), only needed if you'll call this API from a different origin than the one serving the app.
3. After deploying, open the app, go to **Model**, and tap **Test connection** to confirm it can actually reach your provider.

## Roadmap
1 UI shell, 2 backend + model, 3 history + memory, 4 voice, 5 search + coding, 6 personality, 7 auth, 8 tests + security, 9 Render, 10 Capacitor + APK.
