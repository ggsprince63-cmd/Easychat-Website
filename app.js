const $ = id => document.getElementById(id);
let ws, myId = null, myName = '', roomCode = '';
let target = '', ctx = '', tone = 'friendly', variant = 0;
const log = []; // {from,name,text} for AI context

// ---------- join ----------
$('enter').onclick = join;
[$('name'), $('code')].forEach(i => i.onkeydown = e => e.key === 'Enter' && join());
$('leave').onclick = () => { ws && ws.close(); ws = null; $('chat').hidden = true; $('join').hidden = false; $('msgs').innerHTML = ''; log.length = 0; };

function join() {
  myName = $('name').value.trim() || 'Guest';
  const code = $('code').value.trim();
  if (code.length < 3) return ($('joinerr').textContent = 'Room code must be at least 3 characters.');
  $('joinerr').textContent = '';
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  ws.onopen = () => ws.send(JSON.stringify({ type: 'join', code, name: myName }));
  ws.onmessage = e => handle(JSON.parse(e.data));
  ws.onclose = () => { if (!$('chat').hidden) addSys('Disconnected. Press ← and join again.'); };
}

function handle(m) {
  if (m.type === 'error') $('joinerr').textContent = m.text;
  else if (m.type === 'joined') {
    myId = m.id; roomCode = m.code;
    $('roomcode').textContent = m.code;
    $('join').hidden = true; $('chat').hidden = false; $('msgs').innerHTML = '';
    m.history.forEach(addMsg);
  } else if (m.type === 'msg') addMsg(m);
  else if (m.type === 'system') addSys(m.text);
  else if (m.type === 'presence') $('online').textContent = m.count === 1 ? 'Only you here — share the code!' : `${m.count} online: ${m.names.join(', ')}`;
}

// ---------- messages ----------
function scroll() { $('msgs').scrollTop = $('msgs').scrollHeight; }
function addSys(t) { const d = document.createElement('div'); d.className = 'sys'; d.textContent = t; $('msgs').appendChild(d); scroll(); }
function addMsg(m) {
  log.push(m);
  const mine = m.from === myId;
  const d = document.createElement('div');
  d.className = 'm ' + (mine ? 'out' + (m.ai ? ' ai' : '') : 'in');
  if (!mine) { const w = document.createElement('div'); w.className = 'who'; w.textContent = m.name; d.appendChild(w); }
  const t = document.createElement('div'); t.textContent = m.text; d.appendChild(t);
  if (!mine) {
    const b = document.createElement('button'); b.className = 'aibtn'; b.textContent = '✨ Send AI-generated reply';
    b.onclick = () => openSheet(m); d.appendChild(b);
  }
  $('msgs').appendChild(d); scroll();
}
function sendText(text, ai) { if (ws && ws.readyState === 1 && text.trim()) ws.send(JSON.stringify({ type: 'msg', text, ai })); }
$('snd').onclick = () => { sendText($('inp').value, false); $('inp').value = ''; };
$('inp').onkeydown = e => { if (e.key === 'Enter') $('snd').click(); };

// ---------- AI reply + confirm ----------
function openSheet(m) {
  target = m.text; variant = 0; tone = 'friendly';
  const i = log.indexOf(m);
  ctx = log.slice(Math.max(0, i - 6), i).map(x => (x.from === myId ? 'Me: ' : x.name + ': ') + x.text).join('\n');
  $('orig').textContent = m.name + ': ' + m.text;
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('sel', c.dataset.t === 'friendly'));
  $('sheet').hidden = false; gen();
}
async function gen() {
  const d = $('draft'), go = $('confirm');
  d.className = 'draft'; d.textContent = 'Writing…'; go.disabled = true;
  try {
    const r = await fetch('/api/reply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: target, context: ctx, tone, variant }) });
    const j = await r.json();
    if (j.error) { d.className = 'draft err'; d.textContent = j.error; return; }
    d.textContent = j.text; go.disabled = false;
  } catch (e) { d.className = 'draft err'; d.textContent = 'Could not reach the server.'; }
}
document.querySelectorAll('.chip').forEach(c => c.onclick = () => {
  document.querySelectorAll('.chip').forEach(x => x.classList.remove('sel'));
  c.classList.add('sel'); tone = c.dataset.t; variant = 0; gen();
});
$('regen').onclick = () => { variant++; gen(); };
$('cancel').onclick = () => { $('sheet').hidden = true; };
$('confirm').onclick = () => { const t = $('draft').textContent; $('sheet').hidden = true; sendText(t, true); };
