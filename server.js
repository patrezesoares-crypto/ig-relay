import express from 'express';
import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';

const app = express();
app.use(express.json());

const PROXY_URL = process.env.PROXY_URL || 'http://DdfVmwTd4qUSzE2d:606BY8CtoHA4Iufg_country-br@geo.iproyal.com:12321';
const RELAY_SECRET = process.env.RELAY_SECRET || '';

const proxyAgent = new HttpsProxyAgent(PROXY_URL);

const IG_HEADERS = (sessionid, csrftoken = 'missing') => ({
  'Cookie': `sessionid=${sessionid}; csrftoken=${csrftoken}`,
  'X-CSRFToken': csrftoken,
  'X-IG-App-ID': '936619743392459',
  'X-Instagram-AJAX': '1',
  'X-Requested-With': 'XMLHttpRequest',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://www.instagram.com/',
  'Origin': 'https://www.instagram.com',
});

// Auth middleware
app.use((req, res, next) => {
  if (RELAY_SECRET && req.headers['x-relay-secret'] !== RELAY_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
});

async function getCsrfToken(sessionid) {
  // Try without proxy first (just to get CSRF cookie)
  try {
    const res = await fetch('https://www.instagram.com/', {
      headers: { 'Cookie': `sessionid=${sessionid}` },
      redirect: 'manual',
    });
    const setCookie = res.headers.raw?.['set-cookie']?.join(';') || res.headers.get('set-cookie') || '';
    const match = setCookie.match(/csrftoken=([^;]+)/);
    if (match?.[1]) return match[1];
  } catch { /* fallback */ }

  // Fallback: try with proxy
  try {
    const res = await fetch('https://www.instagram.com/', {
      headers: { 'Cookie': `sessionid=${sessionid}` },
      redirect: 'manual',
      agent: proxyAgent,
    });
    const setCookie = res.headers.raw?.['set-cookie']?.join(';') || res.headers.get('set-cookie') || '';
    const match = setCookie.match(/csrftoken=([^;]+)/);
    return match?.[1] || 'missing';
  } catch { return 'missing'; }
}

// GET /profile?sessionid=xxx
app.get('/profile', async (req, res) => {
  const { sessionid } = req.query;
  if (!sessionid) return res.status(400).json({ ok: false, error: 'sessionid required' });

  try {
    const csrf = await getCsrfToken(sessionid);
    const igRes = await fetch('https://www.instagram.com/api/v1/accounts/current_user/?edit=true', {
      headers: IG_HEADERS(sessionid, csrf),
      redirect: 'manual',
      agent: proxyAgent,
    });

    if (igRes.status === 301 || igRes.status === 302) {
      return res.status(401).json({ ok: false, error: 'Sessão inválida — faça login novamente' });
    }
    if (!igRes.ok) {
      const txt = await igRes.text();
      return res.status(igRes.status).json({ ok: false, error: txt.slice(0, 200) });
    }

    const json = await igRes.json();
    res.json({ ok: true, user: json.user });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /inbox?sessionid=xxx
app.get('/inbox', async (req, res) => {
  const { sessionid } = req.query;
  if (!sessionid) return res.status(400).json({ ok: false, error: 'sessionid required' });

  try {
    const csrf = await getCsrfToken(sessionid);
    const igRes = await fetch(
      'https://www.instagram.com/api/v1/direct_v2/inbox/?visual_message_return_type=unseen&persistentBadging=true&limit=20',
      { headers: IG_HEADERS(sessionid, csrf), redirect: 'manual', agent: proxyAgent },
    );

    if (igRes.status === 301 || igRes.status === 302) {
      return res.status(401).json({ ok: false, error: 'Sessão inválida — faça login novamente' });
    }
    if (!igRes.ok) {
      const txt = await igRes.text();
      return res.status(igRes.status).json({ ok: false, error: txt.slice(0, 200) });
    }

    const json = await igRes.json();
    res.json({ ok: true, threads: json.inbox?.threads || [] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /send
app.post('/send', async (req, res) => {
  const { sessionid, thread_id, text } = req.body;
  if (!sessionid || !thread_id || !text) {
    return res.status(400).json({ ok: false, error: 'sessionid, thread_id e text obrigatórios' });
  }

  try {
    const csrf = await getCsrfToken(sessionid);
    const body = new URLSearchParams({
      action: 'send_item',
      thread_ids: JSON.stringify([thread_id]),
      client_context: crypto.randomUUID().replace(/-/g, ''),
      item_type: 'text',
      text,
    });

    const igRes = await fetch('https://www.instagram.com/api/v1/direct_v2/threads/broadcast/text/', {
      method: 'POST',
      headers: {
        ...IG_HEADERS(sessionid, csrf),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      redirect: 'manual',
      agent: proxyAgent,
      body: body.toString(),
    });

    if (igRes.status === 301 || igRes.status === 302) {
      return res.status(401).json({ ok: false, error: 'Sessão inválida — reimporte o sessionid' });
    }
    if (!igRes.ok) {
      const txt = await igRes.text();
      return res.status(igRes.status).json({ ok: false, error: txt.slice(0, 200) });
    }

    const json = await igRes.json();
    res.json({ ok: true, result: json });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /debug?sessionid=xxx — returns raw status code and headers from Instagram
app.get('/debug', async (req, res) => {
  const { sessionid } = req.query;
  if (!sessionid) return res.status(400).json({ ok: false, error: 'sessionid required' });

  try {
    // Test 1: homepage without proxy
    const r1 = await fetch('https://www.instagram.com/', {
      headers: { 'Cookie': `sessionid=${sessionid}` },
      redirect: 'manual',
    });

    // Test 2: homepage with proxy
    const r2 = await fetch('https://www.instagram.com/', {
      headers: { 'Cookie': `sessionid=${sessionid}` },
      redirect: 'manual',
      agent: proxyAgent,
    });

    // Test 3: API with proxy
    const csrf2 = r2.headers.get('set-cookie')?.match(/csrftoken=([^;]+)/)?.[1] || 'missing';
    const r3 = await fetch('https://www.instagram.com/api/v1/accounts/current_user/?edit=true', {
      headers: {
        'Cookie': `sessionid=${sessionid}; csrftoken=${csrf2}`,
        'X-CSRFToken': csrf2,
        'X-IG-App-ID': '936619743392459',
        'X-Instagram-AJAX': '1',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.instagram.com/',
      },
      redirect: 'manual',
      agent: proxyAgent,
    });

    const body3 = r3.status < 400 ? await r3.json().catch(() => 'not json') : await r3.text().then(t => t.slice(0, 200));

    res.json({
      ok: true,
      no_proxy: { status: r1.status, location: r1.headers.get('location') },
      with_proxy: { status: r2.status, csrf: csrf2, location: r2.headers.get('location') },
      api_with_proxy: { status: r3.status, body: body3 },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/health', (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`ig-relay running on port ${PORT}`));
