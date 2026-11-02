// Local media engine for Agents Desktop: file registry + FFmpeg operations.
// Pure Node (no Electron) so it can be tested on its own.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const IMG = /\.(jpe?g|png|webp|bmp|tiff?|heic|heif|avif)$/i;
const VID = /\.(mp4|mov|m4v|mkv|avi|webm|wmv|flv|3gp|mts|gif)$/i;
const AUD = /\.(mp3|wav|m4a|aac|ogg|flac|opus|wma)$/i;
const kindOf = (p) => (IMG.test(p) ? 'image' : VID.test(p) ? 'video' : AUD.test(p) ? 'audio' : 'other');

const ASPECTS = { '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350], '16:9': [1920, 1080] };

function createMedia({ ffmpeg, ffprobe, root, fontFile }) {
  const SRC = path.join(root, 'מקור');
  const REG = path.join(root, '.registry.json');
  fs.mkdirSync(SRC, { recursive: true });

  let reg = { next: 1, files: {} };
  try { reg = JSON.parse(fs.readFileSync(REG, 'utf8')); } catch (e) {}
  const saveReg = () => fs.writeFileSync(REG, JSON.stringify(reg, null, 1));

  const safeName = (n) => (String(n || 'file').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || 'file').slice(0, 120);
  function uniquePath(dir, name) {
    const ext = path.extname(name), base = path.basename(name, ext);
    let p = path.join(dir, name), i = 2;
    while (fs.existsSync(p)) p = path.join(dir, base + ' (' + i++ + ')' + ext);
    return p;
  }
  function add(p, agent, origin) {
    const id = 'F' + reg.next++;
    reg.files[id] = { path: p, name: path.basename(p), kind: kindOf(p), agent: agent || '', origin, at: Date.now() };
    saveReg();
    return { id, name: reg.files[id].name, kind: reg.files[id].kind };
  }
  function get(id) {
    const f = reg.files[String(id || '').trim().toUpperCase()];
    if (!f) throw new Error('קובץ ' + id + ' לא נמצא במאגר');
    if (!fs.existsSync(f.path)) throw new Error('הקובץ ' + f.name + ' נמחק או הועבר מהמחשב');
    return f;
  }

  // Register a file the user attached: either a real path on disk or raw bytes.
  function register({ filePath, bytes, name, agent }) {
    if (filePath && fs.existsSync(filePath)) {
      const hit = Object.entries(reg.files).find(([, f]) => f.path === filePath);
      if (hit) return { id: hit[0], name: hit[1].name, kind: hit[1].kind };
      return add(filePath, agent, 'input');
    }
    if (!bytes) throw new Error('אין נתונים לקובץ');
    const p = uniquePath(SRC, safeName(name));
    fs.writeFileSync(p, Buffer.from(bytes));
    return add(p, agent, 'input');
  }

  function exec(bin, args, { timeoutMs = 20 * 60 * 1000 } = {}) {
    return new Promise((resolve, reject) => {
      const pr = spawn(bin, args, { windowsHide: true });
      let out = '', err = '';
      pr.stdout.on('data', (d) => (out += d));
      pr.stderr.on('data', (d) => { err += d; if (err.length > 200000) err = err.slice(-100000); });
      const t = setTimeout(() => pr.kill('SIGKILL'), timeoutMs);
      pr.on('error', (e) => { clearTimeout(t); reject(e); });
      pr.on('close', (code) => {
        clearTimeout(t);
        if (code === 0) resolve({ out, err });
        else reject(new Error('FFmpeg נכשל: ' + err.trim().split('\n').slice(-6).join('\n')));
      });
    });
  }

  async function probe(p) {
    const { out } = await exec(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', p]);
    const j = JSON.parse(out);
    const v = (j.streams || []).find((s) => s.codec_type === 'video');
    const a = (j.streams || []).find((s) => s.codec_type === 'audio');
    let w = v ? v.width : 0, h = v ? v.height : 0;
    const rot = v && ((v.side_data_list || []).find((x) => x.rotation != null) || {}).rotation;
    if (rot && Math.abs(rot) % 180 === 90) [w, h] = [h, w];
    return { width: w, height: h, hasAudio: !!a, duration: parseFloat((j.format || {}).duration) || 0 };
  }

  const num = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
  function secs(t) {
    if (t == null || t === '') return null;
    if (typeof t === 'number') return t;
    const parts = String(t).trim().split(':').map(parseFloat);
    if (parts.some((x) => !isFinite(x))) throw new Error('זמן לא תקין: ' + t);
    return parts.reduce((a, b) => a * 60 + b, 0);
  }
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  const escPath = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  const stamp = () => { const d = new Date(), z = (n) => String(n).padStart(2, '0'); return z(d.getHours()) + z(d.getMinutes()) + z(d.getSeconds()); };
  const vEnc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
  const aEnc = ['-c:a', 'aac', '-b:a', '192k'];
  function outPath(agentDir, srcName, op, ext) {
    const dir = path.join(root, safeName(agentDir || 'כללי'));
    fs.mkdirSync(dir, { recursive: true });
    const base = path.basename(srcName, path.extname(srcName)).replace(/_(trim|reframe|crop|resize|merge|music|text|speed|compressed|convert|frame|video|audio|edit|ai)_\d{6}$/, '');
    return uniquePath(dir, safeName(base + '_' + op + '_' + stamp()) + '.' + ext);
  }
  const extFor = (f, d) => (f.kind === 'image' ? (path.extname(f.path).slice(1).toLowerCase().replace('jpeg', 'jpg') || 'jpg') : f.kind === 'audio' ? 'mp3' : d || 'mp4');
  const encFor = (f) => (f.kind === 'image' ? ['-frames:v', '1', '-q:v', '2'] : f.kind === 'audio' ? [] : [...vEnc, ...aEnc]);

  // Each op returns { inputs:[...files], args:[...] (without inputs/output), ext, op }
  const OPS = {
    async trim(p) {
      const f = get(p.input), s = secs(p.start) || 0, e = secs(p.end);
      if (f.kind === 'image') throw new Error('אי אפשר לקצר תמונה');
      const a = ['-ss', String(s)];
      if (e != null) { if (e <= s) throw new Error('זמן הסיום חייב להיות אחרי זמן ההתחלה'); a.push('-to', String(e)); }
      return { pre: a, inputs: [f], args: f.kind === 'audio' ? ['-c:a', 'libmp3lame', '-q:a', '2'] : [...vEnc, ...aEnc], ext: f.kind === 'audio' ? 'mp3' : 'mp4', op: 'trim' };
    },
    async reframe(p) {
      const f = get(p.input), A = ASPECTS[p.aspect];
      if (!A) throw new Error('יחס לא נתמך. אפשר: ' + Object.keys(ASPECTS).join(', '));
      let [W, H] = A;
      if (p.width) { W = even(num(p.width, W)); H = even((W * A[1]) / A[0]); }
      const vf = p.mode === 'pad'
        ? `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${p.color || 'black'},setsar=1`
        : `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`;
      return { inputs: [f], args: ['-vf', vf, ...encFor(f)], ext: extFor(f), op: 'reframe' };
    },
    async crop(p) {
      const f = get(p.input), w = even(num(p.width, 0)), h = even(num(p.height, 0));
      if (!p.width || !p.height) throw new Error('חסרים רוחב וגובה לחיתוך');
      const x = Math.round(num(p.x, 0)), y = Math.round(num(p.y, 0));
      return { inputs: [f], args: ['-vf', `crop=${w}:${h}:${x}:${y}`, ...encFor(f)], ext: extFor(f), op: 'crop' };
    },
    async resize(p) {
      const f = get(p.input), w = p.width ? even(num(p.width, 0)) : -2, h = p.height ? even(num(p.height, 0)) : -2;
      if (w === -2 && h === -2) throw new Error('חסר רוחב או גובה');
      return { inputs: [f], args: ['-vf', `scale=${w}:${h}:flags=lanczos`, ...encFor(f)], ext: extFor(f), op: 'resize' };
    },
    async merge(p) {
      const files = (p.inputs || []).map(get);
      if (files.length < 2) throw new Error('צריך לפחות שני קבצים לחיבור');
      const infos = [];
      for (const f of files) infos.push(f.kind === 'image' ? { width: 0, height: 0, hasAudio: false } : await probe(f.path));
      const first = infos.find((i) => i.width) || { width: 1080, height: 1920 };
      let [W, H] = ASPECTS[p.aspect] || [first.width, first.height];
      W = even(W); H = even(H);
      const pre = [], fc = [], cat = [];
      files.forEach((f, i) => {
        if (f.kind === 'image') pre.push(['-loop', '1', '-t', String(num(p.image_seconds, 3))]); else pre.push([]);
        fc.push(`[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}]`);
        if (infos[i].hasAudio) fc.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`);
        else fc.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${f.kind === 'image' ? num(p.image_seconds, 3) : infos[i].duration || 1}[a${i}]`);
        cat.push(`[v${i}][a${i}]`);
      });
      fc.push(`${cat.join('')}concat=n=${files.length}:v=1:a=1[v][a]`);
      return { perInputPre: pre, inputs: files, args: ['-filter_complex', fc.join(';'), '-map', '[v]', '-map', '[a]', ...vEnc, ...aEnc], ext: 'mp4', op: 'merge' };
    },
    async add_music(p) {
      const v = get(p.input), a = get(p.audio), info = await probe(v.path);
      const vol = Math.min(2, Math.max(0, num(p.volume, 0.8))), st = secs(p.music_start) || 0;
      const keep = p.keep_original !== false && info.hasAudio;
      const fc = keep
        ? `[1:a]volume=${vol}[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0[a]`
        : `[1:a]volume=${vol}[a]`;
      return { perInputPre: [[], st ? ['-ss', String(st)] : []], inputs: [v, a], args: ['-filter_complex', fc, '-map', '0:v', '-map', '[a]', '-shortest', ...vEnc, ...aEnc], ext: 'mp4', op: 'music' };
    },
    async add_text(p) {
      const f = get(p.input);
      if (!p.text) throw new Error('חסר טקסט');
      const tf = path.join(os.tmpdir(), 'agents_txt_' + Date.now() + '.txt');
      fs.writeFileSync(tf, String(p.text), 'utf8');
      const size = Math.round(num(p.size, 64)), y = { top: 'h*0.08', center: '(h-text_h)/2', bottom: 'h*0.85-text_h' }[p.position || 'bottom'] || 'h*0.85-text_h';
      let dt = `drawtext=fontfile='${escPath(fontFile)}':textfile='${escPath(tf)}':fontsize=${size}:fontcolor=${p.color || 'white'}:borderw=3:bordercolor=black@0.7:x=(w-text_w)/2:y=${y}:text_shaping=1`;
      const s = secs(p.start), e = secs(p.end);
      if (f.kind !== 'image' && (s != null || e != null)) dt += `:enable='between(t,${s || 0},${e != null ? e : 99999})'`;
      return { inputs: [f], args: ['-vf', dt, ...encFor(f)], ext: extFor(f), op: 'text', cleanup: [tf] };
    },
    async speed(p) {
      const f = get(p.input), k = num(p.factor, 1), info = await probe(f.path);
      if (k <= 0.1 || k > 8) throw new Error('מהירות חייבת להיות בין 0.1 ל-8');
      const at = []; let r = k;
      while (r > 2) { at.push('atempo=2'); r /= 2; }
      while (r < 0.5) { at.push('atempo=0.5'); r /= 0.5; }
      at.push('atempo=' + r.toFixed(4));
      const args = info.hasAudio
        ? ['-filter_complex', `[0:v]setpts=PTS/${k}[v];[0:a]${at.join(',')}[a]`, '-map', '[v]', '-map', '[a]']
        : ['-vf', `setpts=PTS/${k}`];
      return { inputs: [f], args: [...args, ...vEnc, ...aEnc], ext: 'mp4', op: 'speed' };
    },
    async compress(p) {
      const f = get(p.input), q = { high: 23, medium: 28, low: 33 }[p.quality || 'medium'] || 28;
      if (f.kind === 'image') return { inputs: [f], args: ['-q:v', String({ high: 4, medium: 8, low: 14 }[p.quality || 'medium'] || 8)], ext: 'jpg', op: 'compressed' };
      return { inputs: [f], args: ['-vf', "scale='min(1080,iw)':-2", '-c:v', 'libx264', '-preset', 'medium', '-crf', String(q), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '128k'], ext: 'mp4', op: 'compressed' };
    },
    async convert(p) {
      const f = get(p.input), fmt = String(p.format || '').toLowerCase().replace('jpeg', 'jpg');
      const map = {
        mp4: [...vEnc, ...aEnc], mov: [...vEnc, ...aEnc], webm: ['-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-c:a', 'libopus'],
        gif: ['-vf', 'fps=12,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse'],
        jpg: ['-frames:v', '1', '-q:v', '2'], png: ['-frames:v', '1'], webp: ['-frames:v', '1', '-q:v', '85'],
        mp3: ['-vn', '-c:a', 'libmp3lame', '-q:a', '2'], wav: ['-vn'],
      };
      if (!map[fmt]) throw new Error('פורמט לא נתמך: ' + p.format);
      return { inputs: [f], args: map[fmt], ext: fmt, op: 'convert' };
    },
    async extract_frame(p) {
      const f = get(p.input);
      return { pre: ['-ss', String(secs(p.time) || 0)], inputs: [f], args: ['-frames:v', '1', '-q:v', '2'], ext: 'jpg', op: 'frame' };
    },
    async extract_audio(p) {
      const f = get(p.input);
      return { inputs: [f], args: ['-vn', '-c:a', 'libmp3lame', '-q:a', '2'], ext: 'mp3', op: 'audio' };
    },
    async image_to_video(p) {
      const f = get(p.input), t = Math.min(600, Math.max(1, num(p.seconds, 5)));
      const zoom = p.zoom ? `scale=2160:-2,zoompan=z='min(zoom+0.0008,1.15)':d=${Math.round(t * 30)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30,` : 'scale=trunc(iw/2)*2:trunc(ih/2)*2,';
      return { perInputPre: [p.zoom ? [] : ['-loop', '1', '-t', String(t)]], inputs: [f], args: ['-vf', zoom + 'format=yuv420p', '-t', String(t), '-r', '30', ...vEnc], ext: 'mp4', op: 'video' };
    },
    async ffmpeg(p) {
      const files = (p.inputs || []).map(get), args = (p.args || []).map(String);
      if (!args.length) throw new Error('חסרים פרמטרים ל-FFmpeg');
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '-i' && /^\{IN\d+\}$/.test(args[i + 1] || '')) continue;
        if (/^[a-z]:[\\/]/i.test(a) || /^\\\\/.test(a) || /\.\.[\\/]/.test(a) || /:\/\//.test(a) || /^-(y|n|i)$/.test(a))
          throw new Error('פרמטר לא מורשה: ' + a + ' (השתמשי ב-{IN1}, {IN2} לקבצים; הפלט נוסף אוטומטית)');
      }
      const ext = String(p.output_ext || 'mp4').replace(/^\./, '').toLowerCase();
      if (!/^[a-z0-9]{2,5}$/.test(ext)) throw new Error('סיומת פלט לא תקינה');
      return { raw: true, inputs: files, args, ext, op: 'edit' };
    },
  };

  async function run(op, params, agentDir) {
    if (!OPS[op]) throw new Error('פעולה לא מוכרת: ' + op);
    const job = await OPS[op](params || {});
    const out = outPath(agentDir, job.inputs[0].name, job.op, job.ext);
    let args = ['-hide_banner', '-y'];
    if (job.raw) {
      args.push(...job.args.map((a) => a.replace(/\{IN(\d+)\}/g, (m, n) => {
        const f = job.inputs[n - 1]; if (!f) throw new Error('אין קלט ' + m); return f.path;
      })));
      const usesIn = job.args.some((a) => /\{IN\d+\}/.test(a));
      if (!usesIn) { const ins = []; job.inputs.forEach((f) => ins.push('-i', f.path)); args = ['-hide_banner', '-y', ...ins, ...job.args]; }
    } else {
      job.inputs.forEach((f, i) => {
        if (i === 0 && job.pre) args.push(...job.pre);
        if (job.perInputPre && job.perInputPre[i]) args.push(...job.perInputPre[i]);
        args.push('-i', f.path);
      });
      args.push(...job.args);
    }
    args.push(out);
    try { await exec(ffmpeg, args); }
    finally { (job.cleanup || []).forEach((p) => { try { fs.unlinkSync(p); } catch (e) {} }); }
    const r = add(out, agentDir, 'output');
    return { ...r, path: out, folder: path.dirname(out) };
  }

  // Small JPEG preview (data URL) of an image or a video frame.
  async function preview(id) {
    const f = get(id);
    if (f.kind === 'audio' || f.kind === 'other') return null;
    const tmp = path.join(os.tmpdir(), 'agents_prev_' + Date.now() + '.jpg');
    const pre = f.kind === 'video' ? ['-ss', '0.5'] : [];
    try {
      await exec(ffmpeg, ['-hide_banner', '-y', ...pre, '-i', f.path, '-frames:v', '1', '-vf', "scale='min(480,iw)':-2", '-q:v', '5', tmp], { timeoutMs: 60000 });
      return 'data:image/jpeg;base64,' + fs.readFileSync(tmp).toString('base64');
    } catch (e) {
      if (f.kind === 'video') { try { await exec(ffmpeg, ['-hide_banner', '-y', '-i', f.path, '-frames:v', '1', '-vf', "scale='min(480,iw)':-2", tmp], { timeoutMs: 60000 }); return 'data:image/jpeg;base64,' + fs.readFileSync(tmp).toString('base64'); } catch (e2) {} }
      return null;
    } finally { try { fs.unlinkSync(tmp); } catch (e) {} }
  }

  async function info(id) {
    const f = get(id);
    const r = { id: String(id).toUpperCase(), name: f.name, kind: f.kind };
    if (f.kind !== 'other') { try { Object.assign(r, await probe(f.path)); } catch (e) {} }
    return r;
  }

  // Downscaled JPEG (base64) of an image file, for sending to an AI model.
  async function jpegB64(p, maxSide = 1536) {
    const tmp = path.join(os.tmpdir(), 'agents_ref_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '.jpg');
    try {
      await exec(ffmpeg, ['-hide_banner', '-y', '-i', p, '-frames:v', '1', '-vf', `scale='min(${maxSide},iw)':'min(${maxSide},ih)':force_original_aspect_ratio=decrease`, '-q:v', '3', tmp], { timeoutMs: 60000 });
      return fs.readFileSync(tmp).toString('base64');
    } finally { try { fs.unlinkSync(tmp); } catch (e) {} }
  }
  // Save bytes produced elsewhere (e.g. an AI image) as a new registered output.
  function saveOutput(buf, baseName, op, ext, agentDir) {
    const out = outPath(agentDir, safeName(baseName) + '.' + ext, op, ext);
    fs.writeFileSync(out, buf);
    const r = add(out, agentDir, 'output');
    return { ...r, path: out, folder: path.dirname(out) };
  }

  // JPEG suitable for an Instagram feed post: aspect ratio kept between 4:5 and 1.91:1 (padded if needed).
  async function instaJpeg(id) {
    const f = get(id);
    if (f.kind !== 'image') throw new Error('לאינסטגרם אפשר לפרסם כאן רק תמונה (' + f.name + ' אינו תמונה)');
    const { width: w, height: h } = await probe(f.path);
    let W = w, H = h;
    if (w / h < 0.8) W = even(h * 0.8); else if (w / h > 1.91) H = even(w / 1.91);
    const pad = (W !== w || H !== h) ? `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=white,` : '';
    const tmp = path.join(os.tmpdir(), 'agents_ig_' + Date.now() + '.jpg');
    try {
      await exec(ffmpeg, ['-hide_banner', '-y', '-i', f.path, '-frames:v', '1', '-vf', pad + "scale='min(1440,iw)':-2", '-q:v', '2', tmp], { timeoutMs: 60000 });
      return { buf: fs.readFileSync(tmp), padded: !!pad };
    } finally { try { fs.unlinkSync(tmp); } catch (e) {} }
  }

  return { register, run, preview, info, get, jpegB64, saveOutput, instaJpeg, ops: Object.keys(OPS), root };
}

module.exports = { createMedia };
