// מרכז הסוכנים – שרת בענן (שלב 1: צ'אט, משימות ומשימות מחזוריות)
process.env.TZ = process.env.TZ || 'Asia/Jerusalem';
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MODEL = process.env.MODEL || 'claude-haiku-5-5';
const APP_USER = process.env.APP_USER || '';
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const PROD = process.env.NODE_ENV === 'production' || !!process.env.RENDER;

const AGENTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'agents.json'), 'utf8'));
for (const a of AGENTS) {
  try { a.img = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, 'avatars', a.id + '.b64'), 'utf8').trim(); }
  catch (e) { a.img = ''; }
}
const TASK_RULES = fs.readFileSync(path.join(__dirname, 'task_rules.txt'), 'utf8');
const CLOUD_NOTE = 'שים לב – גרסת הענן, שלב 1: הכלים Gmail, אינסטגרם, עריכת מדיה, יצירת תמונות וגלישה עדיין לא מחוברים כאן. אם בקשה דורשת אחד מהם, אמרי בשורה אחת שהחיבור יתווסף בקרוב, ובינתיים אפשר לעשות את זה בתוכנת Agents Desktop במחשב. אל תעמידי פנים שביצעת פעולה כזו.';

// ---------- אחסון ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
const STATE_FILE = path.join(DATA_DIR, 'state.json');
let STATE = { agents: {} };
try { STATE = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) {}
for (const a of AGENTS) STATE.agents[a.id] = STATE.agents[a.id] || { messages: [], tasks: [] };
let saveT = null;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(STATE));
    fs.renameSync(tmp, STATE_FILE);
  }, 300);
}
const S = (id) => STATE.agents[id];

// ---------- עזרי זמן ----------
const pad = (n) => String(n).padStart(2, '0');
const dk = (t) => { const d = t ? new Date(t) : new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const toM = (x) => { const [h, m] = String(x || '08:00').split(':').map(Number); return h * 60 + m; };
const nowM = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
const fmtD = (k) => (k ? k.split('-').reverse().join('/') : '');
const ST = { n: 'טרם התחילה', p: 'בתהליך', h: 'עצורה', x: 'בוטלה', d: 'הסתיימה' }, DN = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const sched = (t) => (t.days && t.days.length ? 'ימים ' + t.days.map((d) => DN[d]).join(',') : 'כל יום') + ' ב-' + (t.time || '--:--') + (t.until ? ' · עד ' + fmtD(t.until) : '');
const upd = (t, st) => { t.s = st; t.lastDate = dk(); t.lastS = st; };
const tid = () => 't' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');

// ---------- Claude ----------
let client = null;
function claude() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('חסר מפתח ANTHROPIC_API_KEY בהגדרות השרת');
  if (!client) { const Anthropic = require('@anthropic-ai/sdk'); client = new (Anthropic.default || Anthropic)({ apiKey: process.env.ANTHROPIC_API_KEY }); }
  return client;
}
function ident(A) {
  const others = AGENTS.filter((x) => x.id !== A.id).map((x) => x.name + ' (' + x.role + ')').join(', ');
  return 'שמך ' + A.name + ', ' + A.role + ' של שחר. ' + (A.m ? 'אתה גבר: דבר על עצמך בלשון זכר (חלק מההנחיות כתובות בלשון נקבה, הן חלות עליך). ' : '') +
    'שחר הוא גבר – תמיד פנו אליו בלשון זכר. אל תציגי את עצמך ואל תפתחי תשובות בשם או בתפקיד שלך; אמרי את שמך רק אם הוא שואל. עני ישר לעניין. סוכנים אחרים בצוות: ' + others + '.\n' +
    A.prompt + '\n\n' + TASK_RULES + '\n\n' + CLOUD_NOTE;
}
function systemFor(A) {
  const tk = S(A.id).tasks.filter((t) => t.s !== 'x').slice(-12).map((t) => '- ' + t.title + (t.rec ? ' [' + sched(t) + ']' : '') + ' (' + (t.rec && t.s === 'p' ? 'פעילה' : ST[t.s] || t.s) + ')').join('\n');
  const n = new Date();
  return ident(A) + (tk ? '\n\nהמשימות הרשומות שלך:\n' + tk : '') + '\n\nהיום ' + n.toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'numeric', day: 'numeric' }) + ', השעה ' + n.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) + '.';
}
function history(A) {
  const out = [];
  for (const m of S(A.id).messages.slice(-30)) {
    if (m.x || !m.t) continue;
    const role = m.r === 'u' ? 'user' : 'assistant', last = out[out.length - 1];
    if (last && last.role === role) last.content += '\n\n' + m.t; else out.push({ role, content: m.t });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  while (out.length && out[out.length - 1].role !== 'user') out.pop();
  return out;
}
function taskTools(A) {
  return [
    { name: 'create_task', description: "רושם משימה חוזרת בלשונית 'משימות וסטטוס'. היא תרוץ אוטומטית בשעה שנקבעה בכל יום מתאים. לא להשתמש למשימה חד-פעמית.",
      input_schema: { type: 'object', properties: { title: { type: 'string', description: 'נושא קצר, עד 6 מילים' }, summary: { type: 'string', description: 'שורה אחת: מה המשימה עושה בכל ריצה' }, time: { type: 'string', description: 'שעת הרצה HH:MM' }, days: { type: 'array', items: { type: 'integer' }, description: 'ימים בשבוע: 0=ראשון עד 6=שבת. ריק = כל יום' }, until: { type: 'string', description: 'תאריך סיום YYYY-MM-DD, רק אם שחר נתן תוקף' }, run_now: { type: 'boolean', description: 'להריץ גם עכשיו פעם ראשונה, רק אם שחר ביקש' } }, required: ['title', 'summary', 'time'] },
      run: (a) => {
        const tm = String(a.time || '').trim();
        if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(tm)) return 'שגיאה: שעה לא תקינה, צריך HH:MM.';
        const days = Array.isArray(a.days) ? a.days.map(Number).filter((x) => x >= 0 && x <= 6) : [];
        const t = { id: tid(), title: String(a.title || 'משימה').slice(0, 60), desc: String(a.summary || '').slice(0, 160), at: Date.now(), s: 'p', rec: true, time: tm.padStart(5, '0'), days: days.length >= 7 ? [] : [...new Set(days)].sort(), until: /^\d{4}-\d{2}-\d{2}$/.test(a.until || '') ? a.until : undefined };
        if (!a.run_now && nowM() >= toM(t.time)) t.lastRun = dk();
        S(A.id).tasks.push(t); save();
        if (a.run_now) setTimeout(() => runTask(A, t), 500);
        return 'נרשמה משימה חוזרת: ' + t.title + ' · ' + sched(t);
      } },
    { name: 'update_task', description: 'משנה משימה רשומה לפי חלק מהנושא שלה: status=active (פעילה), paused (עצורה), cancelled (בוטלה); או שינוי שעה (time) ותוקף (until).',
      input_schema: { type: 'object', properties: { title: { type: 'string' }, status: { type: 'string', enum: ['active', 'paused', 'cancelled'] }, time: { type: 'string' }, until: { type: 'string' } }, required: ['title'] },
      run: (a) => {
        const q = String(a.title || '').trim(); if (!q) return 'שגיאה: חסר נושא.';
        const hits = S(A.id).tasks.filter((t) => t.title.includes(q) || q.includes(t.title));
        if (!hits.length) return 'לא נמצאה משימה בשם הזה.';
        if (hits.length > 1) return 'נמצאו כמה משימות: ' + hits.map((t) => t.title).join(' | ') + '. שאלי את שחר לאיזו הוא מתכוון.';
        const t = hits[0];
        if (a.status) upd(t, { active: 'p', paused: 'h', cancelled: 'x' }[a.status] || t.s);
        if (a.time && /^\d{1,2}:\d{2}$/.test(a.time)) { t.time = a.time.padStart(5, '0'); if (nowM() >= toM(t.time)) t.lastRun = dk(); }
        if (/^\d{4}-\d{2}-\d{2}$/.test(a.until || '')) t.until = a.until;
        save(); return 'עודכן: ' + t.title + ' (' + (t.rec && t.s === 'p' ? 'פעילה' : ST[t.s]) + ')';
      } }
  ];
}
async function ask(A, messages, tools) {
  const api = claude(), sys = systemFor(A), byName = Object.fromEntries((tools || []).map((t) => [t.name, t]));
  const defs = (tools || []).map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  const msgs = messages.slice();
  for (let i = 0; i < 6; i++) {
    const r = await api.messages.create({ model: MODEL, max_tokens: 2000, system: sys, messages: msgs, ...(defs.length ? { tools: defs } : {}) });
    const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    const uses = r.content.filter((b) => b.type === 'tool_use');
    if (r.stop_reason !== 'tool_use' || !uses.length) return text;
    msgs.push({ role: 'assistant', content: r.content });
    msgs.push({ role: 'user', content: uses.map((u) => { let out; try { out = byName[u.name] ? byName[u.name].run(u.input || {}) : 'כלי לא קיים'; } catch (e) { out = 'שגיאה: ' + e.message; } return { type: 'tool_result', tool_use_id: u.id, content: String(out) }; }) });
  }
  return 'לא הצלחתי לסיים את הבקשה. נסה לנסח אותה מחדש.';
}
const busyAgents = new Set();
async function runTask(A, t) {
  if (t.busy) return;
  t.busy = true; if (t.rec) t.lastRun = dk(); else upd(t, 'p');
  try {
    const out = await ask(A, [{ role: 'user', content: 'משימה' + (t.rec ? ' חוזרת (ריצה אוטומטית)' : '') + ': ' + t.title + '\n' + (t.desc || '') + '\n\nבצעי את המשימה עכשיו ודווחי בסיכום קצר וברור. אל תשאלי שאלות ואל תרשמי משימות; אם חסר משהו כדי לבצע, כתבי בדיוק מה חסר.' }], []);
    t.lastRes = out; t.lastAt = Date.now();
    S(A.id).messages.push({ r: 'a', t: (t.rec ? '🔁 ' : '✅ ') + t.title + '\n\n' + out, x: 1, at: Date.now() });
    if (!t.rec) upd(t, 'd');
  } catch (e) {
    t.lastRes = 'שגיאה: ' + (e.message || 'נכשל'); t.lastAt = Date.now();
    S(A.id).messages.push({ r: 'a', t: '⚠️ ' + t.title + ': ' + t.lastRes, x: 1, at: Date.now() });
    if (!t.rec) upd(t, 'n');
  }
  delete t.busy; save();
}

// ---------- תזמון משימות חוזרות ----------
let ticking = false;
async function tick() {
  if (ticking || !process.env.ANTHROPIC_API_KEY) return; ticking = true;
  try {
    const today = dk(), n = new Date(), mins = nowM();
    for (const A of AGENTS) for (const t of [...S(A.id).tasks]) {
      if (!t.rec || t.s !== 'p' || t.busy) continue;
      if (t.until && today > t.until) { upd(t, 'd'); save(); continue; }
      if (t.lastRun === today) continue;
      if (t.days && t.days.length && !t.days.includes(n.getDay())) continue;
      if (mins < toM(t.time)) continue;
      await runTask(A, t);
    }
  } catch (e) { console.error('tick', e); } finally { ticking = false; }
}
setInterval(tick, 60000); setTimeout(tick, 15000);

// ---------- כניסה ----------
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
function cookieOk(req) {
  const m = /(?:^|;\s*)ar=([^;]+)/.exec(req.headers.cookie || ''); if (!m) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const tries = new Map();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => { res.set('X-Frame-Options', 'SAMEORIGIN'); res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'same-origin'); next(); });
app.get('/healthz', (req, res) => res.send('ok'));
app.post('/api/login', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress, now = Date.now();
  const rec = (tries.get(ip) || []).filter((t) => now - t < 10 * 60000);
  if (rec.length >= 8) return res.status(429).json({ error: 'יותר מדי ניסיונות. נסה שוב בעוד כמה דקות.' });
  if (!APP_USER || !APP_PASSWORD) return res.status(500).json({ error: 'לא הוגדרו APP_USER ו-APP_PASSWORD בשרת' });
  const { user, pass } = req.body || {};
  const ok = crypto.timingSafeEqual(hash(user), hash(APP_USER)) & crypto.timingSafeEqual(hash(pass), hash(APP_PASSWORD));
  if (!ok) { rec.push(now); tries.set(ip, rec); return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' }); }
  const exp = String(now + 30 * 24 * 3600e3);
  res.set('Set-Cookie', 'ar=' + encodeURIComponent(exp + '.' + sign(exp)) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + 30 * 24 * 3600 + (PROD ? '; Secure' : ''));
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { res.set('Set-Cookie', 'ar=; Path=/; Max-Age=0'); res.json({ ok: true }); });
app.use('/api', (req, res, next) => (cookieOk(req) ? next() : res.status(401).json({ error: 'נדרשת כניסה' })));

const agentOf = (id) => AGENTS.find((a) => a.id === id);
const pub = (t) => { const { ...o } = t; return o; };
app.get('/api/state', (req, res) => {
  res.json({
    model: MODEL, hasKey: !!process.env.ANTHROPIC_API_KEY,
    agents: AGENTS.map((A) => ({ id: A.id, name: A.name, role: A.role, m: A.m, img: A.img, busy: busyAgents.has(A.id), messages: S(A.id).messages.slice(-100), tasks: S(A.id).tasks.map(pub) }))
  });
});
app.post('/api/chat/:agent', async (req, res) => {
  const A = agentOf(req.params.agent); if (!A) return res.status(404).json({ error: 'סוכן לא קיים' });
  const v = String((req.body && req.body.text) || '').trim().slice(0, 8000); if (!v) return res.status(400).json({ error: 'הודעה ריקה' });
  const s = S(A.id);
  const tm = v.match(/^\s*משימה(\s+יומית)?\s*[:：]\s*([\s\S]+)/);
  if (tm) {
    const body = tm[2].trim(), nl = body.indexOf('\n'), title = (nl > 0 ? body.slice(0, nl) : body).slice(0, 80).trim();
    s.tasks.push({ id: tid(), title, desc: body.length > title.length ? body : '', at: Date.now(), s: 'n', lastDate: dk(), lastS: 'n' });
    s.messages.push({ r: 'u', t: v, at: Date.now() }, { r: 'a', t: '✅ המשימה נוספה לחוצץ המשימות: ' + title, x: 1, at: Date.now() });
    save(); return res.json({ ok: true });
  }
  if (busyAgents.has(A.id)) return res.status(409).json({ error: 'עדיין עובד' + (A.m ? '' : 'ת') + ' על ההודעה הקודמת' });
  s.messages.push({ r: 'u', t: v, at: Date.now() }); save();
  busyAgents.add(A.id);
  try {
    const out = await ask(A, history(A), taskTools(A));
    s.messages.push({ r: 'a', t: out || '(אין תשובה)', at: Date.now() });
    res.json({ ok: true });
  } catch (e) {
    s.messages.push({ r: 'a', t: 'שגיאה: ' + (e.message || 'נכשל'), x: 1, at: Date.now() });
    res.status(502).json({ error: e.message || 'נכשל' });
  } finally { busyAgents.delete(A.id); save(); }
});
app.delete('/api/chat/:agent', (req, res) => { const A = agentOf(req.params.agent); if (!A) return res.sendStatus(404); S(A.id).messages = []; save(); res.json({ ok: true }); });
app.post('/api/tasks/:agent', (req, res) => {
  const A = agentOf(req.params.agent); if (!A) return res.sendStatus(404);
  const b = req.body || {}, title = String(b.title || '').trim().slice(0, 80); if (!title) return res.status(400).json({ error: 'חסר נושא' });
  const t = { id: tid(), title, desc: String(b.desc || '').slice(0, 300), at: Date.now(), s: b.rec ? 'p' : 'n', rec: !!b.rec };
  if (t.rec) { t.time = /^\d{2}:\d{2}$/.test(b.time || '') ? b.time : '08:00'; t.days = []; t.until = /^\d{4}-\d{2}-\d{2}$/.test(b.until || '') ? b.until : undefined; if (nowM() >= toM(t.time)) t.lastRun = dk(); }
  S(A.id).tasks.push(t); save(); res.json({ ok: true, task: t });
});
app.patch('/api/tasks/:agent/:id', (req, res) => {
  const A = agentOf(req.params.agent), t = A && S(A.id).tasks.find((x) => x.id === req.params.id); if (!t) return res.sendStatus(404);
  const b = req.body || {};
  if (b.s && ST[b.s]) { upd(t, b.s); if (b.s === 'p' && t.rec && nowM() >= toM(t.time)) t.lastRun = dk(); }
  if (b.time && /^\d{2}:\d{2}$/.test(b.time)) { t.time = b.time; if (nowM() >= toM(t.time)) t.lastRun = dk(); }
  save(); res.json({ ok: true });
});
app.delete('/api/tasks/:agent/:id', (req, res) => {
  const A = agentOf(req.params.agent), s = A && S(A.id); if (!s) return res.sendStatus(404);
  s.tasks = s.tasks.filter((x) => x.id !== req.params.id); save(); res.json({ ok: true });
});
app.post('/api/tasks/:agent/:id/run', (req, res) => {
  const A = agentOf(req.params.agent), t = A && S(A.id).tasks.find((x) => x.id === req.params.id); if (!t) return res.sendStatus(404);
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'חסר מפתח API בשרת' });
  runTask(A, t); res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: 0 }));
app.listen(PORT, () => console.log('AgentRoom on :' + PORT + ' · model ' + MODEL + ' · data ' + DATA_DIR));
