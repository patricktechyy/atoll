// Screenshots: area (drag a box, like Snipping Tool) or the whole screen under the mouse.
// Saved as PNG to Pictures\Screenshots\Atoll and copied to the clipboard.
const { BrowserWindow, desktopCapturer, screen, ipcMain, app, nativeImage } = require('electron');
const clipboard = require('./pasteboard');
const fs = require('fs');
const path = require('path');

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;

class Screenshots {
  constructor({ hide, show, onSaved, folder, capture }) {
    this.hide = hide; this.show = show; this.onSaved = onSaved; this.folder = folder;
    this.capture = capture; // helper-based capture (GDI), preferred on Windows
    this.busy = false;
    this.lastError = '';
  }

  async grab(display) {
    // 1. the Windows helper copies the screen in real pixels (works in Lite mode / without GPU)
    if (this.capture && process.platform === 'win32') {
      try {
        const phys = screen.dipToScreenRect ? screen.dipToScreenRect(null, display.bounds) : display.bounds;
        const r = await this.capture(phys);
        if (r && r.ok && r.file) {
          const img = nativeImage.createFromPath(r.file);
          try { fs.unlinkSync(r.file); } catch (_) {}
          if (!img.isEmpty()) return img;
          this.lastError = 'helper capture produced an empty image';
        } else this.lastError = 'helper capture: ' + ((r && r.error) || 'failed');
      } catch (e) { this.lastError = 'helper capture: ' + e.message; }
    }
    // 2. Chromium's own screen capture
    const img = await this.grabChromium(display);
    if (!img || img.isEmpty()) throw new Error(process.platform === 'darwin' ? 'Allow Atoll in System Settings → Privacy & Security → Screen Recording, then reopen it.' : 'Windows returned an empty screenshot. ' + this.lastError);
    return img;
  }

  async grabChromium(display) {
    const { width, height } = display.size;
    const sf = display.scaleFactor;
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(width * sf), height: Math.round(height * sf) } });
    const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    if (!src) throw new Error('No screen to capture');
    return src.thumbnail;
  }

  async take(mode) {
    if (this.busy) return;
    this.busy = true;
    try {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      this.hide();
      await new Promise((r) => setTimeout(r, 160)); // let the notch fade out of the shot
      const full = await this.grab(display);
      let img = full;
      if (mode === 'area') {
        const rect = await this.pick(display, full);
        if (!rect) return;
        const k = full.getSize().width / display.size.width; // physical pixels per DIP
        img = full.crop({ x: Math.round(rect.x * k), y: Math.round(rect.y * k), width: Math.max(1, Math.round(rect.w * k)), height: Math.max(1, Math.round(rect.h * k)) });
      }
      this.save(img);
    } catch (e) {
      this.lastError = e.message || String(e);
      this.onSaved({ error: this.lastError });
    } finally {
      this.busy = false;
      this.show();
    }
  }

  save(img) {
    const dir = this.folder();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `Atoll ${stamp()}.png`);
    fs.writeFileSync(file, img.toPNG());
    clipboard.writeImage(img);
    const { width, height } = img.getSize();
    this.onSaved({ file, width, height, thumb: img.resize({ width: Math.min(160, width) }).toDataURL() });
  }

  // Full-screen overlay showing the frozen screen; resolves with {x,y,w,h} in DIPs, or null on Esc.
  pick(display, full) {
    return new Promise((resolve) => {
      const b = display.bounds;
      const win = new BrowserWindow({
        x: b.x, y: b.y, width: b.width, height: b.height, frame: false, resizable: false, movable: false,
        skipTaskbar: true, alwaysOnTop: true, show: false, enableLargerThanScreen: true, hasShadow: false,
        backgroundColor: '#000000', fullscreenable: false,
        webPreferences: { preload: path.join(__dirname, '..', 'renderer', 'snip-preload.js'), contextIsolation: true, sandbox: true, spellcheck: false }
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      let done = false;
      const finish = (r) => {
        if (done) return; done = true;
        ipcMain.removeListener('snip:done', onDone);
        ipcMain.removeListener('snip:ready', onReady);
        if (!win.isDestroyed()) win.destroy();
        resolve(r);
      };
      const onDone = (e, r) => { if (e.sender === win.webContents) finish(r && r.w > 2 && r.h > 2 ? r : null); };
      ipcMain.on('snip:done', onDone);
      win.on('closed', () => finish(null));
      win.on('blur', () => setTimeout(() => finish(null), 50)); // Alt+Tab away = cancel
      win.loadFile(path.join(__dirname, '..', 'renderer', 'snip.html'));
      win.webContents.once('did-finish-load', () => {
        win.webContents.send('snip:image', full.toJPEG(90).toString('base64'));
      });
      const onReady = (event) => {
        if (win.isDestroyed() || event.sender !== win.webContents) return;
        ipcMain.removeListener('snip:ready', onReady);
        win.setBounds(b); win.show(); win.focus();
      };
      ipcMain.on('snip:ready', onReady);
    });
  }
}

const defaultFolder = () => path.join(app.getPath('pictures'), 'Screenshots', 'Atoll');

module.exports = { Screenshots, defaultFolder };
