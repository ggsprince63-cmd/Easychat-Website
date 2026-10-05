const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');

// --- tiny .env loader (no extra dependency) ---
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach(l => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch {}

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

// ---------------- AI reply (key stays on the server) ----------------
const hits = new Map(); // ip -> [timestamps]  (simple rate limit)
function limited(ip) {
  const now = Date.now(), a = (hits.get(ip) || []).filter(t => now - t < 60000);
  a.push(now); hits.set(ip, a); return a.length > 20;
}

async function makeReply({ message, context, tone, variant }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return { text: tone === 'formal'
      ? 'Thank you for your message. I will get back to you soon. (demo reply: add GEMINI_API_KEY in .env)'
      : 'Thanks! I will reply soon. 😊 (demo reply: add GEMINI_API_KEY in .env)' };
  }
  const style = tone === 'formal' ? 'polite and professional' : 'friendly and casual';
  const system = `You help people who are not confident in English reply to chat messages. Write ONE reply that is ${style}, uses simple clear words, correct grammar, and is 1-2 short sentences. If the message is not in English, reply in the same language. Output ONLY the reply text, nothing else.`;
  const user = `Recent chat:\n${context || '(none)'}\n\nWrite a reply to this last message:\n"${message}"` +
    (variant ? `\n\n(Give a different wording than before. Variation #${variant}.)` : '');
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  let r, d;
  for (let i = 0; i < 4; i++) {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: 1024, temperature: 0.8 }
      })
    });
    d = await r.json();
    if (r.status !== 503 && r.status !== 429) break;
    await new Promise(res => setTimeout(res, 1500 * (i + 1)));
  }
  if (!r.ok) return { error: d.error?.message || 'AI error ' + r.status };
  const text = (d.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
  return text ? { text } : { error: 'The AI returned no text.' };
}

// ---------------- HTTP ----------------
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/reply') {
    if (limited(req.socket.remoteAddress)) return json(res, 429, { error: 'Too many requests. Wait a minute.' });
    let body = '';
    req.on('data', c => { body += c; if (body.length > 20000) req.destroy(); });
    req.on('end', async () => {
      try {
        const b = JSON.parse(body);
        if (!b.message || typeof b.message !== 'string') return json(res, 400, { error: 'No message.' });
        json(res, 200, await makeReply({ message: b.message.slice(0, 1000), context: String(b.context || '').slice(0, 3000), tone: b.tone, variant: Number(b.variant) || 0 }));
      } catch (e) { json(res, 500, { error: String(e.message || e) }); }
    });
    return;
  }
  let f = path.normalize(path.join(PUB, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0])));
  if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(data);
  });
});
function json(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); }

// ---------------- Chat rooms (WebSocket) ----------------
const wss = new WebSocketServer({ server });
const rooms = new Map(); // code -> { clients:Set<ws>, history:[] }
let nextId = 1;

const send = (ws, o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
const broadcast = (room, o) => room.clients.forEach(c => send(c, o));
const presence = room => broadcast(room, { type: 'presence', count: room.clients.size, names: [...room.clients].map(c => c.name) });

function leave(ws) {
  const room = ws.code && rooms.get(ws.code);
  if (!room) return;
  room.clients.delete(ws);
  if (!room.clients.size) rooms.delete(ws.code);
  else { broadcast(room, { type: 'system', text: `${ws.name} left` }); presence(room); }
  ws.code = null;
}

wss.on('connection', ws => {
  ws.id = nextId++;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'join') {
      const code = String(m.code || '').trim().toLowerCase().slice(0, 32);
      const name = String(m.name || '').trim().slice(0, 20) || 'Guest';
      if (code.length < 3) return send(ws, { type: 'error', text: 'Room code must be at least 3 characters.' });
      leave(ws);
      let room = rooms.get(code);
      if (!room) rooms.set(code, room = { clients: new Set(), history: [] });
      if (room.clients.size >= 20) return send(ws, { type: 'error', text: 'This room is full.' });
      ws.code = code; ws.name = name; room.clients.add(ws);
      send(ws, { type: 'joined', code, id: ws.id, history: room.history });
      broadcast(room, { type: 'system', text: `${name} joined` });
      presence(room);
    } else if (m.type === 'msg') {
      const room = ws.code && rooms.get(ws.code);
      const text = String(m.text || '').trim().slice(0, 1000);
      if (!room || !text) return;
      const msg = { type: 'msg', from: ws.id, name: ws.name, text, ts: Date.now(), ai: !!m.ai };
      room.history.push(msg); if (room.history.length > 50) room.history.shift();
      broadcast(room, msg);
    }
  });
  ws.on('close', () => leave(ws));
});

server.listen(PORT, () => console.log(`EasyChat Room running → http://localhost:${PORT}`));
