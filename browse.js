// Read-only web browsing for the agents: opens a page in a hidden window,
// lets its scripts render, and returns text, images and links.
const { BrowserWindow, session } = require('electron');

const PART = 'persist:agents-browse';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const okUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) && !/^(localhost|127\.|10\.|192\.168\.|0\.)/.test(x.hostname); } catch (e) { return false; } };

const EXTRACT = `(() => {
  const abs = (u) => { try { return new URL(u, location.href).href } catch (e) { return '' } };
  const meta = (n) => { const m = document.querySelector('meta[property="' + n + '"],meta[name="' + n + '"]'); return m ? m.content : '' };
  const imgs = [], seen = new Set();
  const addImg = (src, alt, w, h) => { src = abs(src); if (!src || src.startsWith('data:') || seen.has(src)) return; seen.add(src); imgs.push({ src, alt: (alt || '').trim().slice(0, 80), w, h }) };
  const og = meta('og:image'); if (og) addImg(og, 'og:image', 0, 0);
  document.querySelectorAll('img').forEach((i) => { const s = i.currentSrc || i.src || i.getAttribute('data-src'); const w = i.naturalWidth || i.width, h = i.naturalHeight || i.height; if (w >= 250 || h >= 250) addImg(s, i.alt, w, h) });
  const links = [], ls = new Set();
  document.querySelectorAll('a[href]').forEach((a) => { const h = abs(a.getAttribute('href')), t = (a.innerText || a.title || '').replace(/\\s+/g, ' ').trim(); if (!h || ls.has(h) || !/^https?:/.test(h) || !t || t.length < 3) return; ls.add(h); links.push({ text: t.slice(0, 90), href: h }) });
  const text = (document.body ? document.body.innerText : '').replace(/[ \\t]+/g, ' ').replace(/\\n{2,}/g, '\\n').trim();
  return { url: location.href, title: document.title, description: meta('og:description') || meta('description'), ogTitle: meta('og:title'), price: meta('product:price:amount') || meta('og:price:amount'), text: text.slice(0, 7000), images: imgs.slice(0, 30), links: links.slice(0, 60) };
})()`;

async function browse(url, { waitMs = 3500 } = {}) {
  if (!okUrl(url)) throw new Error('כתובת לא תקינה (רק http/https לאתרים ציבוריים)');
  const w = new BrowserWindow({ show: false, width: 1280, height: 1600, webPreferences: { partition: PART, sandbox: true, images: true } });
  w.webContents.setAudioMuted(true);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await Promise.race([w.loadURL(url), sleep(30000).then(() => { throw new Error('הדף לא נטען תוך 30 שניות'); })]).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
    await sleep(waitMs);
    // scroll to trigger lazy-loaded images, then return to top
    await w.webContents.executeJavaScript('(async()=>{for(let i=0;i<6;i++){window.scrollBy(0,1200);await new Promise(r=>setTimeout(r,350))}window.scrollTo(0,0)})()').catch(() => {});
    await sleep(800);
    return await w.webContents.executeJavaScript(EXTRACT);
  } finally { if (!w.isDestroyed()) w.destroy(); }
}

async function download(url) {
  if (!okUrl(url)) throw new Error('כתובת לא תקינה');
  const r = await session.fromPartition(PART).fetch(url);
  if (!r.ok) throw new Error('ההורדה נכשלה (' + r.status + ')');
  const type = r.headers.get('content-type') || '';
  if (!/^image\//.test(type)) throw new Error('הקישור לא מוביל לתמונה (' + type + ')');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 25 * 1024 * 1024) throw new Error('התמונה גדולה מדי');
  const ext = /png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : /gif/.test(type) ? 'gif' : 'jpg';
  return { buf, ext };
}

module.exports = { browse, download };
