// Makes a local image publicly reachable for a short time (Instagram needs a public image URL).
// Uses imgbb (free API key in imgbb-key.txt); uploads expire automatically after 24 hours.
const fs = require('fs');
const path = require('path');

function createPublisher({ appDir, media }) {
  const KEY_FILE = path.join(appDir, 'imgbb-key.txt');
  const key = () => { try { return fs.readFileSync(KEY_FILE, 'utf8').replace(/^﻿/, '').trim(); } catch (e) { return ''; } };
  async function publicUrl(id) {
    const k = key();
    if (k.length < 10) throw new Error('חסר מפתח imgbb (הקובץ imgbb-key.txt בתיקיית התוכנה). הוא נדרש כדי לתת לאינסטגרם קישור ציבורי לתמונה.');
    const { buf, padded } = await media.instaJpeg(id);
    const fd = new FormData();
    fd.append('image', buf.toString('base64'));
    fd.append('name', 'post_' + Date.now());
    const r = await fetch('https://api.imgbb.com/1/upload?expiration=86400&key=' + encodeURIComponent(k), { method: 'POST', body: fd });
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok || !j || !j.success) throw new Error('העלאת התמונה ל-imgbb נכשלה: ' + ((j && j.error && j.error.message) || r.status));
    return { url: j.data.url, padded };
  }
  return { publicUrl, hasKey: () => key().length >= 10, KEY_FILE };
}
module.exports = { createPublisher };
