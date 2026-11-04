// Clipboard history, like Windows + V. Text and images, newest first, pinned items kept forever.
// The native helper tells us when the clipboard changes (Windows' clipboard sequence number),
// so we only read the clipboard when something was actually copied.
const { nativeImage } = require('electron');
const crypto = require('crypto');
const clipboard = require('./pasteboard');
const fs = require('fs');
const path = require('path');

const MAX_UNPINNED = 60;
const sha = (b) => crypto.createHash('sha1').update(b).digest('hex');

class ClipHistory {
  constructor(store, dir, onChange) {
    this.store = store;
    this.dir = path.join(dir, 'clipboard');
    this.onChange = onChange;
    this.ignoreHash = null;
    fs.mkdirSync(this.dir, { recursive: true });
    if (!Array.isArray(store.get('clips'))) store.set('clips', []);
    // drop anything damaged (one bad entry would make every new copy fail)
    const sane = store.get('clips').filter((x) => x && typeof x === 'object' && typeof x.id === 'string' && (x.type === 'text' ? typeof x.text === 'string' : x.type === 'image'));
    if (sane.length !== store.get('clips').length) store.set('clips', sane);
    // older versions kept thumbnails inside the settings file: move them to disk
    let moved = false;
    const items = store.get('clips').map((x) => {
      if (x.thumb && x.thumb.startsWith('data:')) {
        try { fs.writeFileSync(path.join(this.dir, x.id + '.thumb.jpg'), Buffer.from(x.thumb.split(',')[1], 'base64')); } catch (_) {}
        moved = true;
        return { ...x, thumb: `atoll://clip/${x.id}.thumb.jpg` };
      }
      return x;
    });
    if (moved) store.set('clips', items);
  }

  fileFor(name) {
    if (!/^[a-z0-9]+(\.thumb\.jpg|\.png)$/i.test(name)) return null;
    const f = path.join(this.dir, name);
    return fs.existsSync(f) ? f : null;
  }

  get items() { return this.store.get('clips'); }
  save(items) { this.store.set('clips', items); this.onChange(); }

  excluded() {
    // password managers mark secrets so clipboard history apps skip them
    try {
      // sanity check: if has() says yes to a format nobody uses, it can't be trusted on this system
      if (this.hasWorks === undefined) this.hasWorks = !clipboard.has('Atoll-Nonexistent-Format-7f3c');
      if (!this.hasWorks) return false;
      return clipboard.has('org.nspasteboard.ConcealedType') || clipboard.has('org.nspasteboard.TransientType') || clipboard.has('ExcludeClipboardContentFromMonitorProcessing') || clipboard.has('Clipboard Viewer Ignore');
    } catch (_) { return false; }
  }

  // returns true when a new copy was saved
  capture() { return this.captureDetailed().saved; }

  // { saved, reason }: reason says why a copy was not saved
  //   paused | private (marked by a password manager) | empty (nothing readable, or the clipboard
  //   was still locked by the app that is copying) | same (already the newest item) | own (Atoll's paste)
  captureDetailed() {
    if (this.store.get('settings').clipboardPaused) return { saved: false, reason: 'paused' };
    if (this.excluded()) return { saved: false, reason: 'private' };
    let item = null;
    const formats = clipboard.availableFormats();
    if (formats.some((f) => f.startsWith('image/'))) {
      const img = clipboard.readImage();
      if (!img.isEmpty()) {
        const png = img.toPNG();
        const hash = sha(png);
        const { width, height } = img.getSize();
        item = { type: 'image', hash, w: width, h: height, png, thumb: img.resize({ width: Math.min(240, width) }).toJPEG(72) };
      }
    }
    if (!item) {
      const text = clipboard.readText();
      if (!text || !text.trim()) return { saved: false, reason: formats.length ? 'empty' : 'locked' };
      item = { type: 'text', hash: sha(text), text: text.slice(0, 20000) };
    }
    if (item.hash === this.ignoreHash) { this.ignoreHash = null; return { saved: false, reason: 'own' }; }
    const saved = this.add(item);
    return { saved, reason: saved ? '' : 'same' };
  }

  // the helper read the text itself (used when our own read of the clipboard failed)
  addText(text) {
    if (this.store.get('settings').clipboardPaused) return { saved: false, reason: 'paused' };
    if (!text || !String(text).trim()) return { saved: false, reason: 'empty' };
    const t = String(text).slice(0, 20000);
    const hash = sha(t);
    if (hash === this.ignoreHash) { this.ignoreHash = null; return { saved: false, reason: 'own' }; }
    const saved = this.add({ type: 'text', hash, text: t });
    return { saved, reason: saved ? '' : 'same' };
  }

  add(item) {
    let items = this.items.slice();
    const dup = items.findIndex((x) => x.hash === item.hash);
    if (dup === 0) return false;
    if (dup > 0) { const [old] = items.splice(dup, 1); old.at = Date.now(); items.unshift(old); this.save(this.prune(items)); return true; }
    const rec = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), type: item.type, hash: item.hash, at: Date.now(), pinned: false };
    if (item.type === 'text') rec.text = item.text;
    else {
      rec.file = rec.id + '.png';
      fs.writeFileSync(path.join(this.dir, rec.file), item.png);
      fs.writeFileSync(path.join(this.dir, rec.id + '.thumb.jpg'), item.thumb);
      rec.w = item.w; rec.h = item.h; rec.thumb = `atoll://clip/${rec.id}.thumb.jpg`;
    }
    items.unshift(rec);
    this.save(this.prune(items));
    return true;
  }

  prune(items) {
    let unpinned = 0;
    return items.filter((x) => {
      if (x.pinned) return true;
      if (++unpinned <= MAX_UNPINNED) return true;
      this.dropFile(x);
      return false;
    });
  }

  dropFile(x) {
    for (const f of [x.file, x.type === 'image' ? x.id + '.thumb.jpg' : null]) if (f) { try { fs.unlinkSync(path.join(this.dir, f)); } catch (_) {} }
  }

  list() { return this.items; }

  use(id) {
    const items = this.items.slice();
    const i = items.findIndex((x) => x.id === id);
    if (i < 0) return false;
    const x = items[i];
    if (x.type === 'text') clipboard.writeText(x.text);
    else clipboard.writeImage(nativeImage.createFromPath(path.join(this.dir, x.file)));
    this.ignoreHash = x.hash;
    items.splice(i, 1); x.at = Date.now(); items.unshift(x);
    this.save(items);
    return true;
  }

  pin(id, on) { this.save(this.items.map((x) => (x.id === id ? { ...x, pinned: !!on } : x))); }
  remove(id) { const x = this.items.find((y) => y.id === id); if (x) this.dropFile(x); this.save(this.items.filter((y) => y.id !== id)); }
  clear() { const keep = []; for (const x of this.items) { if (x.pinned) keep.push(x); else this.dropFile(x); } this.save(keep); }
  filePath(id) { const x = this.items.find((y) => y.id === id); return x && x.file ? path.join(this.dir, x.file) : null; }
}

module.exports = { ClipHistory };
