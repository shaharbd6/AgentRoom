// מרכז הסוכנים – צד הממשק (גרסת ענן)
const $ = (id) => document.getElementById(id);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
let ST = null, cur = null, sending = false;
const pad = (n) => String(n).padStart(2, '0');
const dk = (t) => { const d = t ? new Date(t) : new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const toM = (x) => { const [h, m] = String(x || '08:00').split(':').map(Number); return h * 60 + m; };
const nowM = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
const fmtD = (k) => (k ? k.split('-').reverse().join('/') : '');
const STN = { n: 'טרם התחילה', p: 'בתהליך', h: 'עצורה', x: 'בוטלה', d: 'הסתיימה' }, DN = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const sched = (t) => (t.days && t.days.length ? 'ימים ' + t.days.map((d) => DN[d]).join(',') : 'כל יום') + ' ב-' + (t.time || '--:--') + (t.until ? ' · עד ' + fmtD(t.until) : '');
const first = (A) => A.name.split(' ')[0];

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  if (r.status === 401 && !url.endsWith('/login')) { showLogin(); throw new Error('נדרשת כניסה'); }
  let j = null; try { j = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error((j && j.error) || 'שגיאה ' + r.status);
  return j;
}

// ---------- ערכת צבע ----------
(function () { try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) {} })();
$('thm').onclick = () => { const r = document.documentElement, c = r.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'), nx = c === 'light' ? 'dark' : 'light'; r.dataset.theme = nx; try { localStorage.setItem('theme', nx); } catch (e) {} };

// ---------- כניסה ----------
function showLogin() { $('app').classList.remove('on'); $('login').hidden = false; }
$('lf').onsubmit = async (e) => {
  e.preventDefault(); $('le').textContent = '';
  try { await api('POST', '/api/login', { user: $('u').value.trim(), pass: $('p').value }); $('p').value = ''; await start(); }
  catch (err) { $('le').textContent = err.message; }
};
async function start() {
  await refresh(); $('login').hidden = true; $('app').classList.add('on');
  buildRail(); goHome();
}

// ---------- נתונים ----------
async function refresh() { ST = await api('GET', '/api/state'); $('nokey').hidden = !!ST.hasKey; }
const AG = (id) => ST.agents.find((a) => a.id === id);
setInterval(async () => { if (!$('app').classList.contains('on') || sending) return; try { await refresh(); redraw(); } catch (e) {} }, 15000);
function redraw() { buildRail(); if (cur) renderPanel(); else renderHome(); }

// ---------- פס עובדים ----------
function buildRail() {
  const g = $('grid'); g.innerHTML = '';
  ST.agents.forEach((A) => {
    const b = el('button', 'ag' + (cur === A.id ? ' sel' : '')), im = el('img'); im.src = A.img; im.alt = '';
    const sp = el('span'); sp.append(el('b', '', A.name), el('small', '', A.busy ? 'עובד' + (A.m ? '' : 'ת') + ' עכשיו…' : A.role));
    b.append(im, sp); b.onclick = () => pick(A.id); g.append(b);
  });
}
function goHome() { cur = null; document.body.classList.remove('chatting'); $('panel').classList.remove('on'); $('empty').hidden = false; $('homeb').classList.add('on'); buildRail(); renderHome(); }
$('homeb').onclick = goHome;
function pick(id) {
  cur = id; const A = AG(id);
  $('empty').hidden = true; $('panel').classList.add('on'); document.body.classList.add('chatting'); $('homeb').classList.remove('on');
  $('pimg').src = A.img; $('pn').textContent = A.name; $('pr').textContent = A.role;
  buildRail(); renderPanel();
}

// ---------- מסך בוקר ----------
const who = (A) => { const w = el('div', 'who'), im = el('img'); im.src = A.img; im.alt = ''; w.append(im, el('span', '', A.name)); return w; };
function recState(t) {
  const today = dk();
  if (t.s === 'x') return ['בוטלה', 'off']; if (t.s === 'h') return ['עצורה', 'off']; if (t.s === 'd') return ['הסתיימה', 'off'];
  if (t.busy) return ['רצה עכשיו', 'run'];
  if (t.lastRun === today && t.lastAt && dk(t.lastAt) === today) return /^שגיאה/.test(t.lastRes || '') ? ['נכשלה', 'wait'] : ['בוצעה היום', 'ok'];
  if (t.days && t.days.length && !t.days.includes(new Date().getDay())) return ['לא מתוזמנת היום', 'off'];
  if (nowM() < toM(t.time)) return ['מתוזמנת ' + (t.time || ''), 'wait'];
  return ['טרם בוצעה', 'wait'];
}
function renderHome() {
  if ($('empty').hidden) return;
  const n = new Date(), h = n.getHours();
  $('hgreet').textContent = (h < 12 ? 'בוקר טוב' : h < 17 ? 'צהריים טובים' : h < 21 ? 'ערב טוב' : 'לילה טוב') + ', שחר';
  $('hdate').textContent = n.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · כך נראה הצוות עכשיו';
  const hA = $('hApv'); hA.innerHTML = ''; $('hac').textContent = '· 0';
  hA.append(el('div', 'none', 'אין כרגע דברים שמחכים לאישור. אישורים לפרסום ולשליחת מיילים יופיעו כאן כשנחבר את Gmail ואינסטגרם.'));
  const hR = $('hRec'); hR.innerHTML = ''; let any = false;
  ST.agents.forEach((A) => A.tasks.filter((t) => t.rec).forEach((t) => {
    any = true; const [lb, cl] = recState(t), r = el('div', 'rr'); if (t.s === 'x') r.style.opacity = '.6';
    const im = el('img'); im.src = A.img; im.alt = A.name;
    const tx = el('div', 'tx'); tx.append(el('b', '', t.title), el('small', '', first(A) + ' · ' + sched(t)));
    const off = t.s === 'x' || t.s === 'h', btn = el('button', 'mini', off ? 'החזרה' : 'ביטול');
    btn.onclick = async () => { btn.disabled = true; try { await api('PATCH', '/api/tasks/' + A.id + '/' + t.id, { s: off ? 'p' : 'x' }); await refresh(); renderHome(); } catch (e) { btn.disabled = false; } };
    r.append(im, tx, el('span', 'pill ' + cl, lb), btn); hR.append(r);
  }));
  if (!any) hR.append(el('div', 'none', 'אין עדיין משימות מחזוריות. כתוב לעובד מה לעשות כל יום, והמשימה תירשם כאן.'));
  const hT = $('hTeam'); hT.innerHTML = '';
  ST.agents.forEach((A) => {
    const run = A.tasks.find((t) => t.busy), act = A.tasks.filter((t) => t.rec && t.s === 'p').length, working = A.busy || !!run;
    const r = el('div', 'rr'), im = el('img'); im.src = A.img; im.alt = '';
    const tx = el('div', 'tx'); tx.append(el('b', '', A.name), el('small', '', run ? 'עובד' + (A.m ? '' : 'ת') + ' על: ' + run.title : act + ' משימות מחזוריות פעילות'));
    const op = el('button', 'mini', "פתח צ'אט"); op.onclick = () => pick(A.id);
    r.append(im, tx, el('span', 'pill ' + (working ? 'run' : 'off'), working ? 'בעבודה' : A.m ? 'פנוי' : 'פנויה'), op); hT.append(r);
  });
  const hD = $('hDone'); hD.innerHTML = ''; const since = Date.now() - 36 * 3600e3, items = [];
  ST.agents.forEach((A) => A.tasks.forEach((t) => { if (t.lastAt && t.lastAt >= since && !/^שגיאה/.test(t.lastRes || '')) items.push({ at: t.lastAt, txt: first(A) + ': ' + t.title + ' – ' + String(t.lastRes || '').replace(/\s+/g, ' ').slice(0, 110) }); }));
  items.sort((a, b) => b.at - a.at).slice(0, 8).forEach((x) => { const li = el('li'); li.append(el('i', '', '✓'), el('span', '', x.txt)); hD.append(li); });
  if (!items.length) hD.append(el('li', 'none', 'עדיין לא בוצעו משימות מאז אתמול.'));
}
$('qf').onsubmit = async (e) => {
  e.preventDefault(); const v = $('qa').value.trim(); if (!v) return;
  const A = ST.agents.find((x) => v.startsWith(first(x)));
  if (!A) { $('qh').textContent = 'התחל בשם העובד, למשל: ' + ST.agents.map(first).join(' / ') + ', ...'; return; }
  const rest = v.slice(first(A).length).replace(/^[\s,:：\-]+/, '');
  $('qa').value = ''; $('qh').textContent = ''; pick(A.id); if (rest) { $('mi').value = rest; send(); }
};

// ---------- צ'אט ----------
document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.id === b.dataset.t));
}));
function dbg(t) { $('dbg').textContent = new Date().toLocaleTimeString('he-IL') + ' · ' + t; }
function renderPanel() { renderMsgs(); renderTasks(); }
function renderMsgs(extra) {
  const A = AG(cur), L = $('msgs'), atBottom = L.scrollHeight - L.scrollTop - L.clientHeight < 80; L.innerHTML = '';
  A.messages.concat(extra || []).forEach((m) => {
    const d = el('div', 'm ' + (m.r === 'u' ? 'u' : 'a') + (m.typing ? ' typing' : ''), m.t);
    if (m.at) d.append(el('time', '', new Date(m.at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })));
    L.append(d);
  });
  if (atBottom || extra) L.scrollTop = 1e9;
}
async function send() {
  const A = AG(cur), v = $('mi').value.trim(); if (!v || sending) return;
  sending = true; $('ms').disabled = true; $('mi').value = '';
  const mine = { r: 'u', t: v, at: Date.now() }, wait = { r: 'a', t: first(A) + (A.m ? ' חושב…' : ' חושבת…'), typing: true };
  renderMsgs([mine, wait]); dbg('נשלח');
  try { await api('POST', '/api/chat/' + A.id, { text: v }); dbg('התקבלה תשובה'); }
  catch (e) { dbg('שגיאה: ' + e.message); }
  sending = false; $('ms').disabled = false;
  try { await refresh(); } catch (e) {}
  if (cur === A.id) renderPanel(); buildRail();
}
$('ms').onclick = send;
$('mi').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
$('clr').onclick = async () => {
  const b = $('clr'); if (!cur) return;
  if (!b.dataset.k) { b.dataset.k = 1; b.textContent = 'ללחוץ שוב לאישור'; setTimeout(() => { b.dataset.k = ''; b.textContent = "נקה צ'אט"; }, 3000); return; }
  b.dataset.k = ''; b.textContent = "נקה צ'אט"; await api('DELETE', '/api/chat/' + cur); await refresh(); renderPanel();
};

// ---------- משימות ----------
function renderTasks() {
  const A = AG(cur), L = $('tl'); L.innerHTML = '';
  if (!A.tasks.length) { L.append(el('div', 'none', 'אין משימות. משימה חוזרת שתבקש מהסוכן בצ\'אט תירשם כאן.')); return; }
  const ord = { p: 0, n: 1, h: 2, d: 3, x: 4 };
  [...A.tasks].sort((a, b) => (ord[a.s] ?? 1) - (ord[b.s] ?? 1) || b.at - a.at).forEach((t) => {
    const d = el('div', 't'); if (t.s === 'x' || t.s === 'd') d.style.opacity = '.6';
    const top = el('div', 'top'), se = el('select', 'stsel ' + ({ p: 'p', d: 'd' }[t.s] || 'n'));
    se.setAttribute('aria-label', 'סטטוס');
    (t.rec ? ['n', 'p', 'h', 'x', 'd'] : ['n', 'p', 'd', 'x']).forEach((k) => { const o = el('option', '', k === 'p' && t.rec ? 'פעילה' : STN[k]); o.value = k; se.append(o); });
    se.value = t.s in STN ? t.s : 'n';
    se.onchange = async () => { await api('PATCH', '/api/tasks/' + A.id + '/' + t.id, { s: se.value }); await refresh(); renderTasks(); };
    top.append(el('b', '', t.title), se); d.append(top);
    if (t.desc) d.append(el('div', 'none', t.desc.split('\n')[0]));
    d.append(el('div', 'none', (t.rec ? '🔁 ' + sched(t) + ' · ' : '') + (t.busy ? '⏳ רצה עכשיו...' : t.lastAt ? 'ריצה אחרונה: ' + new Date(t.lastAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : 'עוד לא רצה')));
    if (t.lastRes) { const det = el('details'), sm = el('summary', '', 'תוצאה אחרונה'); sm.style.cssText = 'cursor:pointer;font-size:12px;color:var(--ac);margin-top:4px'; det.append(sm, el('p', 'res', t.lastRes)); d.append(det); }
    const ac = el('div'); ac.style.cssText = 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap';
    const run = el('button', 'btn sm', t.busy ? 'עובד...' : 'הרץ עכשיו'); run.style.marginTop = '0'; run.disabled = !!t.busy || t.s === 'x';
    run.onclick = async () => { run.disabled = true; run.textContent = 'עובד...'; try { await api('POST', '/api/tasks/' + A.id + '/' + t.id + '/run'); } catch (e) { dbg(e.message); } setTimeout(async () => { await refresh(); renderPanel(); }, 1500); };
    const del = el('button', 'btn sm alt', 'מחק'); del.style.marginTop = '0';
    del.onclick = async () => { if (!del.dataset.k) { del.dataset.k = 1; del.textContent = 'ללחוץ שוב למחיקה'; setTimeout(() => { del.dataset.k = ''; del.textContent = 'מחק'; }, 3000); return; } await api('DELETE', '/api/tasks/' + A.id + '/' + t.id); await refresh(); renderTasks(); };
    ac.append(run, del); d.append(ac); L.append(d);
  });
}
$('ts').onclick = async () => {
  const title = $('tt').value.trim(); if (!title) return;
  await api('POST', '/api/tasks/' + cur, { title, desc: $('td').value.trim(), rec: $('trec').checked, time: $('ttime').value, until: $('tuntil').value });
  $('tt').value = $('td').value = ''; $('trec').checked = false; $('tuntil').value = ''; await refresh(); renderTasks();
};

// ---------- הפעלה ----------
start().catch(() => showLogin());
