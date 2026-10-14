// FREEDOM AI server.
// Stage 1: static files + health check.
// Stage 2 (this file): AI provider connection, chat endpoint (streaming and
// non-streaming), connection test, rate limiting, and request validation.
const http = require('http');
const fs = require('fs');
const path = require('path');
const ai = require('./lib/aiProvider');
const { buildSystemPrompt } = require('./lib/personality');
const rateLimit = require('./lib/rateLimit');

const PORT = process.env.PORT || 3000; // Render supplies PORT
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 64 * 1024; // 64KB - plenty for a chat turn, small enough to deter abuse
const MAX_MESSAGES = 40;
const MAX_CONTENT_CHARS = 8000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
};

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' };
  }
  return {};
}

function send(res, status, body, type, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': type, ...SECURITY_HEADERS, ...extraHeaders });
  res.end(body);
}

function sendJson(res, status, obj, extraHeaders = {}) {
  send(res, status, JSON.stringify(obj), TYPES['.json'], extraHeaders);
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? fwd.split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
}

// Reads the body with a hard size cap. Rejects rather than buffering
// unbounded data from a hostile or broken client.
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', chunk => {
      if (tooLarge) return; // keep draining so the socket doesn't hang, but stop buffering
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { tooLarge = true; return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
      if (size === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

// Validates and sanitizes the client-supplied conversation. Only 'user'
// and 'assistant' roles are accepted from the client; any 'system' role
// is dropped so a user can never override the server-built system prompt.
function validateMessages(input) {
  if (!Array.isArray(input)) return { error: 'messages must be an array' };
  if (input.length === 0) return { error: 'messages must not be empty' };
  if (input.length > MAX_MESSAGES) return { error: `too many messages (max ${MAX_MESSAGES})` };
  const cleaned = [];
  for (const m of input) {
    if (!m || typeof m !== 'object') return { error: 'each message must be an object' };
    if (m.role !== 'user' && m.role !== 'assistant') continue; // silently drop system/other roles
    if (typeof m.content !== 'string' || !m.content.trim()) return { error: 'message content must be non-empty text' };
    if (m.content.length > MAX_CONTENT_CHARS) return { error: `message too long (max ${MAX_CONTENT_CHARS} characters)` };
    cleaned.push({ role: m.role, content: m.content });
  }
  if (cleaned.length === 0) return { error: 'messages must include at least one user or assistant message' };
  return { messages: cleaned };
}

function validatePersonality(input) {
  if (!input || typeof input !== 'object') return {};
  const traits = Array.isArray(input.traits) ? input.traits.filter(t => typeof t === 'string').slice(0, 8) : [];
  const custom = typeof input.custom === 'string' ? input.custom.slice(0, 500) : '';
  return { traits, custom };
}

async function handleChat(req, res) {
  const ip = clientIp(req);
  const limit = rateLimit.allow(ip);
  if (!limit.ok) {
    return sendJson(res, 429, { error: 'Too many requests. Please wait a moment and try again.' },
      { 'Retry-After': String(Math.ceil(limit.retryAfterMs / 1000)) });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, err.statusCode || 400, { error: err.message });
  }

  const { messages, error } = validateMessages(body.messages);
  if (error) return sendJson(res, 400, { error });
  const personality = validatePersonality(body.personality);

  const systemPrompt = buildSystemPrompt(personality);
  const fullMessages = [{ role: 'system', content: systemPrompt }, ...messages];

  if (body.stream) {
    const result = await ai.chatCompletionStream(fullMessages);
    if (!result.ok) return sendJson(res, 502, { error: result.error });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...SECURITY_HEADERS,
      ...corsHeaders(req)
    });
    try {
      for await (const chunk of result.stream) res.write(chunk);
    } catch {
      // Client disconnected or upstream dropped mid-stream; nothing more to send.
    }
    return res.end();
  }

  const result = await ai.chatCompletion(fullMessages);
  if (!result.ok) return sendJson(res, 502, { error: result.error });
  return sendJson(res, 200, { reply: result.text });
}

async function handleConnectionTest(req, res) {
  const result = await ai.testConnection();
  return sendJson(res, result.ok ? 200 : 502, result);
}

function handleHealth(req, res) {
  const { configured, model } = ai.config();
  // Reports configuration only, never claims the provider has been reached.
  // Use /api/connection-test for an actual reachability check.
  sendJson(res, 200, { ok: true, stage: 2, aiConfigured: configured, model: model || null });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, data, TYPES[path.extname(file)] || 'application/octet-stream');
  });
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'OPTIONS') {
    return send(res, 204, '', 'text/plain', { ...corsHeaders(req), 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
  }

  try {
    if (url.pathname === '/api/health' && req.method === 'GET') return handleHealth(req, res);
    if (url.pathname === '/api/connection-test' && req.method === 'GET') return await handleConnectionTest(req, res);
    if (url.pathname === '/api/chat' && req.method === 'POST') return await handleChat(req, res);
    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Unknown endpoint' });
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    return sendJson(res, 500, { error: 'Internal server error' });
  }
}

const server = http.createServer((req, res) => { handler(req, res); });
if (require.main === module) {
  server.listen(PORT, () => console.log(`FREEDOM AI listening on port ${PORT}`));
}
module.exports = server;
