// FREEDOM AI - Stage 1 front end: navigation, drawer, theme, preferences, health check.
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const PREF_KEY = 'freedom.prefs.v1';
  const TRAITS = ['Friendly', 'Professional', 'Funny', 'Analytical', 'Concise', 'Detailed', 'Creative', 'Technical'];

  // ---- preferences (display only; no conversations stored) ----
  const defaults = { theme: 'dark', reduceMotion: false, traits: ['Friendly'], custom: '', rate: 1, vol: 1, welcomed: false, coding: false };
  let prefs = { ...defaults };
  try { prefs = { ...defaults, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; } catch (_) {}
  const save = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (_) {} };

  function applyPrefs() {
    document.documentElement.dataset.theme = prefs.theme;
    document.documentElement.classList.toggle('reduce-motion', prefs.reduceMotion);
    $('meta[name="theme-color"]').content = prefs.theme === 'dark' ? '#04110c' : '#f3f8f4';
    $('#theme-toggle').checked = prefs.theme === 'light';
    $('#motion-toggle').checked = prefs.reduceMotion;
    $('#custom-personality').value = prefs.custom;
    $('#rate').value = prefs.rate; $('#rate-out').textContent = Number(prefs.rate).toFixed(1);
    $('#vol').value = prefs.vol; $('#vol-out').textContent = Number(prefs.vol).toFixed(1);
    $('#coding-toggle').setAttribute('aria-pressed', String(prefs.coding));
  }

  // ---- toast ----
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2800);
  }

  // ---- routing ----
  const views = $$('.view').map(v => v.dataset.view);
  function show(name) {
    if (!views.includes(name)) name = prefs.welcomed ? 'chat' : 'welcome';
    $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === name));
    $$('.menu a').forEach(a => a.classList.toggle('current', a.getAttribute('href') === '#' + name));
    closeDrawer();
  }
  const route = () => show(location.hash.slice(1));
  window.addEventListener('hashchange', route);

  // ---- drawer ----
  function openDrawer() { $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false'); $('#scrim').hidden = false; }
  function closeDrawer() { $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true'); $('#scrim').hidden = true; }
  $('#scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

  // ---- chat shell ----
  const messages = $('#messages');
  let history = []; // [{role:'user'|'assistant', content}] - this tab only, nothing persisted until Stage 3
  let streaming = false;
  let abortCtrl = null;

  function addMsg(role, text) {
    const d = document.createElement('div');
    d.className = 'msg ' + role;
    d.textContent = text; // textContent keeps any text from being parsed as HTML
    messages.appendChild(d);
    $('#stage').classList.add('has-messages');
    $('#stage').scrollTop = $('#stage').scrollHeight;
    return d;
  }
  function newChat() {
    if (streaming) stopStreaming();
    history = [];
    messages.textContent = '';
    $('#stage').classList.remove('has-messages');
    $('#convo-title').textContent = 'New conversation';
    $('#regen-btn').hidden = true;
  }

  function setStreaming(on) {
    streaming = on;
    $('#orb')?.classList.toggle('busy', on);
    $('#send').textContent = on ? '■' : '➤';
    $('#send').setAttribute('aria-label', on ? 'Stop' : 'Send');
    $('#regen-btn').hidden = on || history.length === 0 || history[history.length - 1].role !== 'assistant';
  }

  function stopStreaming() {
    if (abortCtrl) abortCtrl.abort();
  }

  // Parses an OpenAI-style SSE stream ("data: {...}\n\n", ending "data: [DONE]")
  // and calls onToken for each piece of text as it arrives.
  async function streamInto(bubble, body) {
    abortCtrl = new AbortController();
    setStreaming(true);
    let full = '';
    try {
      const res = await fetch('api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortCtrl.signal
      });
      if (!res.ok) {
        let msg = 'The server could not complete that request.';
        try { msg = (await res.json()).error || msg; } catch (_) {}
        bubble.textContent = msg;
        bubble.classList.add('system');
        return null;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const l = line.trim();
          if (!l.startsWith('data:')) continue;
          const payload = l.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const delta = json?.choices?.[0]?.delta?.content;
            if (delta) { full += delta; bubble.textContent = full; $('#stage').scrollTop = $('#stage').scrollHeight; }
          } catch (_) { /* ignore non-JSON keep-alive lines */ }
        }
      }
      return full || null;
    } catch (err) {
      if (err.name === 'AbortError') {
        if (!full) bubble.textContent = '(stopped)';
        return full || null;
      }
      bubble.textContent = 'Could not reach the server. Check your connection and try again.';
      bubble.classList.add('system');
      return null;
    } finally {
      setStreaming(false);
      abortCtrl = null;
    }
  }

  async function sendTurn() {
    const bubble = addMsg('ai', '');
    const text = await streamInto(bubble, {
      messages: history,
      personality: { traits: prefs.traits, custom: prefs.custom },
      stream: true
    });
    if (text) history.push({ role: 'assistant', content: text });
    setStreaming(false);
  }

  const input = $('#input');
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(hover:hover)').matches) { e.preventDefault(); $('#composer').requestSubmit(); }
  });
  $('#composer').addEventListener('submit', e => {
    e.preventDefault();
    if (streaming) { stopStreaming(); return; }
    const text = input.value.trim();
    if (!text) return;
    addMsg('user', text);
    history.push({ role: 'user', content: text });
    input.value = ''; input.style.height = 'auto';
    sendTurn();
  });

  // ---- personality chips ----
  const chipBox = $('#traits');
  TRAITS.forEach(t => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = t;
    b.setAttribute('aria-pressed', String(prefs.traits.includes(t)));
    b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      prefs.traits = on ? [...prefs.traits, t] : prefs.traits.filter(x => x !== t);
      save();
    });
    chipBox.appendChild(b);
  });

  // ---- settings inputs ----
  $('#theme-toggle').addEventListener('change', e => { prefs.theme = e.target.checked ? 'light' : 'dark'; save(); applyPrefs(); });
  $('#motion-toggle').addEventListener('change', e => { prefs.reduceMotion = e.target.checked; save(); applyPrefs(); });
  $('#custom-personality').addEventListener('input', e => { prefs.custom = e.target.value.slice(0, 500); save(); });
  $('#rate').addEventListener('input', e => { prefs.rate = +e.target.value; $('#rate-out').textContent = (+e.target.value).toFixed(1); save(); });
  $('#vol').addEventListener('input', e => { prefs.vol = +e.target.value; $('#vol-out').textContent = (+e.target.value).toFixed(1); save(); });

  // ---- voice capability report (detection only; voice is built in Stage 4) ----
  const hasSTT = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  const hasTTS = 'speechSynthesis' in window;
  $('#voice-stt').textContent = hasSTT ? 'supported by this browser' : 'not supported here';
  $('#voice-tts').textContent = hasTTS ? 'supported by this browser' : 'not supported here';

  // ---- actions ----
  const actions = {
    start() { prefs.welcomed = true; save(); location.hash = '#chat'; },
    'open-drawer': openDrawer,
    'close-drawer': closeDrawer,
    'new-chat': newChat,
    'toggle-coding'() { prefs.coding = !prefs.coding; save(); applyPrefs(); toast(prefs.coding ? 'Coding mode on (full coding tools arrive in Stage 5)' : 'Coding mode off'); },
    mic() { toast(hasSTT ? 'Voice input arrives in Stage 4' : 'This browser has no speech recognition. Type instead.'); },
    regenerate() {
      if (streaming || history.length === 0) return;
      if (history[history.length - 1].role === 'assistant') {
        history.pop();
        messages.lastElementChild?.remove();
      }
      sendTurn();
    },
    async 'test-connection'() {
      const btn = $('#test-connection-btn');
      btn.disabled = true; btn.textContent = 'Testing…';
      $('#models-conn').textContent = 'testing…';
      try {
        const r = await fetch('api/connection-test', { cache: 'no-store' });
        const d = await r.json();
        $('#models-conn').textContent = d.ok ? 'connected' : (d.error || 'failed');
        toast(d.ok ? 'Connection succeeded' : 'Connection failed: ' + (d.error || 'unknown error'));
      } catch (_) {
        $('#models-conn').textContent = 'failed';
        toast('Could not reach the server');
      } finally {
        btn.disabled = false; btn.textContent = 'Test connection';
      }
    },
    'clear-local'() {
      if (!confirm('Clear theme, personality, and voice preferences on this device?')) return;
      try { localStorage.removeItem(PREF_KEY); } catch (_) {}
      prefs = { ...defaults }; applyPrefs();
      $$('.chip', chipBox).forEach(c => c.setAttribute('aria-pressed', String(prefs.traits.includes(c.textContent))));
      toast('Preferences cleared'); location.hash = '#welcome';
    }
  };
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-action]');
    if (a && actions[a.dataset.action]) actions[a.dataset.action]();
    const n = e.target.closest('[data-nav]');
    if (n) location.hash = '#' + n.dataset.nav;
  });

  // ---- server status (real request; reports configuration, not model health) ----
  async function checkServer() {
    const st = $('#status'), txt = $('#status-text');
    try {
      const r = await fetch('api/health', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      const h = await r.json();
      st.className = 'status ok';
      txt.textContent = h.aiConfigured ? 'Server online · model set, untested' : 'Server online · no model set';
      $('#drawer-status').textContent = txt.textContent;
      $('#model-name').textContent = h.model || 'not configured';
      $('#models-current').textContent = h.model || 'not configured';
    } catch (_) {
      st.className = 'status bad';
      txt.textContent = 'Server unreachable';
      $('#drawer-status').textContent = 'Server unreachable';
    }
  }

  applyPrefs();
  route();
  checkServer();
  setInterval(checkServer, 30000);
})();
