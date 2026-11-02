const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { createMedia } = require('./media.js');

const AGENTS_URL = 'https://claude.ai/artifact/8eBZYNnqhkEzGFbMdcYWaj';
const ROOT = path.join(__dirname, 'מסמכים ערוכים');
const LOG_FILE = path.join(__dirname, 'bridge-log.txt');
const log = (line) => { try { fs.appendFileSync(LOG_FILE, new Date().toISOString() + '  ' + line + '\n'); } catch (e) {} };

// Present as regular Chrome (remove the Electron / app tokens from the user agent)
app.userAgentFallback = app.userAgentFallback
  .replace(/\s?Electron\/\S+/, '')
  .replace(/\s?agents-desktop\/\S+/, '');

// ---- find FFmpeg (installed by winget) ----
function findFfmpeg() {
  const la = process.env.LOCALAPPDATA || '';
  const cands = [path.join(la, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe')];
  const pk = path.join(la, 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const d of fs.readdirSync(pk).filter((n) => /^Gyan\.FFmpeg/i.test(n))) {
      for (const sub of fs.readdirSync(path.join(pk, d))) cands.push(path.join(pk, d, sub, 'bin', 'ffmpeg.exe'));
    }
  } catch (e) {}
  const ff = cands.find((p) => fs.existsSync(p) && fs.existsSync(path.join(path.dirname(p), 'ffprobe.exe')));
  return ff ? { ffmpeg: ff, ffprobe: path.join(path.dirname(ff), 'ffprobe.exe') } : { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };
}
const fontFile = ['C:/Windows/Fonts/arialbd.ttf', 'C:/Windows/Fonts/arial.ttf'].find((f) => fs.existsSync(f)) || 'C:/Windows/Fonts/arial.ttf';
const media = createMedia({ ...findFfmpeg(), root: ROOT, fontFile });
const { createImagine } = require('./imagine.js');
const imagine = createImagine({ appDir: __dirname, media });
const web = require('./browse.js');
const publisher = require('./publish.js').createPublisher({ appDir: __dirname, media });

// ---- local bridge: only the agents page frame may call it ----
const trusted = (e) => { try { return /\.claudeusercontent\.com$/.test(new URL(e.senderFrame.url).hostname); } catch (x) { return false; } };
const agentDir = (a) => String(a || 'כללי').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
function handle(ch, fn) {
  ipcMain.handle(ch, async (e, arg) => {
    if (!trusted(e)) throw new Error('not allowed');
    try { return await fn(arg); } catch (err) { log(ch + ' ERROR ' + err.message); throw new Error(err.message); }
  });
}
handle('al:status', () => ({ ok: true, root: ROOT }));
handle('al:register', (a) => media.register({ filePath: a.filePath, bytes: a.bytes, name: a.name, agent: agentDir(a.agent) }));
handle('al:run', (a) => { log('run ' + a.op + ' ' + JSON.stringify(a.params).slice(0, 300)); return media.run(a.op, a.params, agentDir(a.agent)); });
handle('al:info', (id) => media.info(id));
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', txt: 'text/plain', csv: 'text/csv' };
handle('al:read', (id) => {
  const f = media.get(id), size = fs.statSync(f.path).size;
  if (size > 20 * 1024 * 1024) throw new Error('הקובץ ' + f.name + ' גדול מ-20MB ולא ניתן לצרף אותו למייל');
  return { name: f.name, mime: MIME[path.extname(f.path).slice(1).toLowerCase()] || 'application/octet-stream', b64: fs.readFileSync(f.path).toString('base64') };
});
handle('al:preview', (id) => media.preview(id));
handle('al:imagine_status', () => imagine.status());
handle('al:imagine', (a) => { log('imagine ' + JSON.stringify({ ...a.params, prompt: String(a.params && a.params.prompt || '').slice(0, 120) })); return imagine.generate(a.params || {}, agentDir(a.agent)); });
handle('al:browse', (u) => { log('browse ' + String(u).slice(0, 200)); return web.browse(String(u || '')); });
handle('al:webimage', async (a) => {
  const { buf, ext } = await web.download(String(a && a.url || ''));
  const base = String(a && a.name || 'web_image').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'web_image';
  return media.register({ bytes: buf, name: base + '.' + ext, agent: agentDir(a && a.agent) });
});
handle('al:publicurl', (id) => { log('publicurl ' + id); return publisher.publicUrl(String(id || '')); });
handle('al:refs', async () => { await shell.openPath(imagine.REF_DIR); return true; });
handle('al:open', async (id) => { const r = await shell.openPath(media.get(id).path); if (r) throw new Error(r); return true; });
handle('al:show', (id) => { shell.showItemInFolder(media.get(id).path); return true; });
handle('al:folder', async (a) => {
  const d = a ? path.join(ROOT, agentDir(a)) : ROOT;
  fs.mkdirSync(d, { recursive: true });
  await shell.openPath(d);
  return true;
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'מרכז הסוכנים',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegrationInSubFrames: true
    }
  });

  win.loadURL(AGENTS_URL);

  // Links outside claude.ai open in the regular browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://claude.ai')) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
