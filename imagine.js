// AI image generation for Agents Desktop via Google Gemini "Nano Banana".
// The API key stays on this computer (gemini-key.txt next to the app).
const fs = require('fs');
const path = require('path');

const MODELS = { standard: ['gemini-nano-banana-2.1', 'gemini-3.1-flash-image'], pro: ['gemini-3-pro-image', 'gemini-nano-banana-2.1'] };
const RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const IMG = /\.(jpe?g|png|webp)$/i;

function createImagine({ appDir, media, fetchImpl }) {
  const doFetch = fetchImpl || fetch;
  const KEY_FILE = path.join(appDir, 'gemini-key.txt');
  const REF_DIR = path.join(appDir, 'רפרנס קאלי');
  fs.mkdirSync(REF_DIR, { recursive: true });

  const key = () => { try { return fs.readFileSync(KEY_FILE, 'utf8').replace(/^﻿/, '').trim(); } catch (e) { return ''; } };
  const refFiles = () => { try { return fs.readdirSync(REF_DIR).filter((f) => IMG.test(f)).sort().map((f) => path.join(REF_DIR, f)); } catch (e) { return []; } };

  function status() {
    const k = key();
    return { hasKey: k.length > 20, refs: refFiles().length, refFolder: REF_DIR, keyFile: KEY_FILE };
  }

  // Find the first generated image anywhere in a response (works for generateContent and Interactions shapes)
  function findImage(o, depth = 0) {
    if (!o || typeof o !== 'object' || depth > 12) return null;
    const mt = o.mimeType || o.mime_type;
    if (typeof o.data === 'string' && o.data.length > 500 && (!mt || /^image\//.test(mt))) return { data: o.data, mime: mt || 'image/png' };
    for (const v of Array.isArray(o) ? o : Object.values(o)) { const r = findImage(v, depth + 1); if (r) return r; }
    return null;
  }
  function findText(o, out = [], depth = 0) {
    if (!o || typeof o !== 'object' || depth > 12) return out;
    if (typeof o.text === 'string') out.push(o.text);
    for (const v of Array.isArray(o) ? o : Object.values(o)) findText(v, out, depth + 1);
    return out;
  }

  async function callModel(model, k, prompt, images, ratio, size) {
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }, ...images.map((im) => ({ inline_data: { mime_type: 'image/jpeg', data: im } }))] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: ratio, imageSize: size } },
    };
    const r = await doFetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': k }, body: JSON.stringify(body),
    });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch (e) {}
    if (!r.ok) {
      const msg = (j && j.error && j.error.message) || txt.slice(0, 300);
      const e = new Error(msg); e.status = r.status; throw e;
    }
    return j;
  }

  async function generate(p, agentDir) {
    const k = key();
    if (k.length < 20) throw new Error('חסר מפתח Gemini. צריך לשמור אותו בקובץ gemini-key.txt בתיקיית התוכנה.');
    const prompt = String(p.prompt || '').trim();
    if (!prompt) throw new Error('חסר תיאור לתמונה');
    const ratio = RATIOS.includes(p.aspect_ratio) ? p.aspect_ratio : '1:1';
    const size = ['1K', '2K', '4K'].includes(String(p.size || '').toUpperCase()) ? String(p.size).toUpperCase() : '1K';
    const useKali = p.use_kali_refs !== false;

    const kaliRefs = useKali ? refFiles().slice(0, 4) : [];
    if (useKali && !kaliRefs.length) throw new Error('אין תמונות בתיקייה "רפרנס קאלי". צריך לשים שם 1-4 תמונות טובות של קאלי.');
    const others = (Array.isArray(p.references) ? p.references : []).slice(0, 10).map((id) => media.get(id));
    for (const f of others) if (f.kind !== 'image') throw new Error(f.name + ' אינו תמונה; לרפרנס אפשר להשתמש רק בתמונות (לסרטון: קודם extract_frame).');

    const images = [];
    for (const fp of kaliRefs) images.push(await media.jpegB64(fp, 1536));
    for (const f of others) images.push(await media.jpegB64(f.path, 1536));

    let fullPrompt = prompt;
    if (kaliRefs.length) {
      fullPrompt = 'The first ' + kaliRefs.length + ' image(s) are reference photos of the same woman, "Kali Monroe". ' +
        'Keep her identity exactly: same face, facial features, skin tone, hair and body type. ' +
        (others.length ? 'The next ' + others.length + ' image(s) are additional references (products, scenes or style examples) as described in the request. If any of them shows another person (for example a model wearing a product), use it ONLY for the clothing/product details (color, cut, fabric, pattern, fit); never copy that person\'s face or identity - the person in the result is always Kali. ' : '') +
        '\n\nRequest: ' + prompt;
    } else if (others.length) {
      fullPrompt = 'The attached ' + others.length + ' image(s) are references as described in the request.\n\nRequest: ' + prompt;
    }

    let res = null, used = '', lastErr = null;
    for (const model of MODELS[p.quality === 'pro' ? 'pro' : 'standard']) {
      try { res = await callModel(model, k, fullPrompt, images, ratio, size); used = model; break; }
      catch (e) { lastErr = e; if (!(e.status === 404 || /not found|not supported|unknown name/i.test(e.message))) break; }
    }
    if (!res && lastErr && /free_tier/.test(lastErr.message) && /limit: 0/.test(lastErr.message))
      throw new Error('החשבון ב-Google עדיין בתוכנית החינמית, שלא כוללת יצירת תמונות. צריך להפעיל חיוב (Billing) ב-aistudio.google.com ואז לנסות שוב.');
    if (!res && lastErr && lastErr.status === 429) throw new Error('הגעת למכסת השימוש של Gemini כרגע. נסו שוב בעוד כמה דקות.');
    if (!res) throw new Error('Gemini: ' + (lastErr ? lastErr.message : 'אין תשובה'));
    const img = findImage(res.candidates || res);
    if (!img) {
      const why = (res.candidates && res.candidates[0] && res.candidates[0].finishReason) || (res.promptFeedback && res.promptFeedback.blockReason) || '';
      throw new Error('Gemini לא החזיר תמונה' + (why ? ' (' + why + ')' : '') + '. ' + findText(res).join(' ').slice(0, 300));
    }
    const ext = /png/.test(img.mime) ? 'png' : /webp/.test(img.mime) ? 'webp' : 'jpg';
    const out = media.saveOutput(Buffer.from(img.data, 'base64'), String(p.name || 'kali'), 'ai', ext, agentDir);
    return { ...out, model: used, note: findText(res.candidates || res).join(' ').slice(0, 300) };
  }

  return { status, generate, REF_DIR, KEY_FILE };
}

module.exports = { createImagine };
