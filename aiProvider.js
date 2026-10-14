// Thin wrapper around an OpenAI-compatible /chat/completions endpoint.
// Model, endpoint, and key all come from environment variables - never
// hardcoded, never sent to the browser.
const TIMEOUT_MS = 30_000;

function config() {
  const apiKey = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_BASE_URL;
  const model = process.env.AI_MODEL;
  return {
    apiKey, baseUrl, model,
    configured: Boolean(apiKey && baseUrl && model)
  };
}

function endpointUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, '') + '/chat/completions';
}

// Non-streaming call. Returns { ok, text, error, status }.
async function chatCompletion(messages) {
  const { apiKey, baseUrl, model, configured } = config();
  if (!configured) return { ok: false, error: 'AI provider is not configured on the server.' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpointUrl(baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, stream: false }),
      signal: controller.signal
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: `Provider returned ${res.status}`, detail: body.slice(0, 300) };
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? '';
    return { ok: true, text, raw: data };
  } catch (err) {
    const timedOut = err.name === 'AbortError';
    return { ok: false, error: timedOut ? 'Provider request timed out.' : 'Could not reach the AI provider.' };
  } finally {
    clearTimeout(timer);
  }
}

// Streaming call. Returns { ok, stream } where stream is the upstream
// Response body (SSE, OpenAI "data: {...}" framing) to pipe through, or
// { ok:false, error } on failure before the stream opens.
async function chatCompletionStream(messages) {
  const { apiKey, baseUrl, model, configured } = config();
  if (!configured) return { ok: false, error: 'AI provider is not configured on the server.' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpointUrl(baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, stream: true }),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: `Provider returned ${res.status}`, detail: body.slice(0, 300) };
    }
    return { ok: true, stream: res.body };
  } catch (err) {
    clearTimeout(timer);
    const timedOut = err.name === 'AbortError';
    return { ok: false, error: timedOut ? 'Provider request timed out.' : 'Could not reach the AI provider.' };
  }
}

// Real connection test: a minimal 1-token request. Used by /api/connection-test
// so the UI never claims a model is working without having checked.
async function testConnection() {
  const { configured } = config();
  if (!configured) return { ok: false, error: 'Not configured: set AI_API_KEY, AI_BASE_URL, AI_MODEL.' };
  const result = await chatCompletion([{ role: 'user', content: 'Reply with the single word: ok' }]);
  if (!result.ok) return result;
  return { ok: true, sample: result.text.slice(0, 80) };
}

module.exports = { config, chatCompletion, chatCompletionStream, testConnection };
