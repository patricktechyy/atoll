const { contextBridge, ipcRenderer, webUtils, webFrame } = require('electron');
// free decoded images etc. while the notch is idle
ipcRenderer.on('trim', () => { try { webFrame.clearCache(); } catch (_) {} });

const on = (ch) => (cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(ch, fn);
  return () => ipcRenderer.removeListener(ch, fn);
};

contextBridge.exposeInMainWorld('atoll', {
  real: true, platform: process.platform, caps: ipcRenderer.sendSync('caps'),
  macPermissions: () => ipcRenderer.invoke('mac:permissions'),
  requestMacPermission: kind => ipcRenderer.invoke('mac:request', kind),
  getStore: () => ipcRenderer.invoke('store:all'),
  getMediaSnapshot: () => ipcRenderer.invoke('media:snapshot'),
  setStore: (key, value) => ipcRenderer.invoke('store:set', key, value),
  setHitRect: (r) => ipcRenderer.send('hit-rect', r),
  repaint: () => ipcRenderer.send('repaint'),
  trimNow: () => ipcRenderer.invoke('trim-now'),
  holdPointer: (on) => ipcRenderer.send('hold-pointer', !!on),
  media: (cmd, pos) => ipcRenderer.send('media', { cmd, pos }),
  getLyrics: (meta) => ipcRenderer.invoke('lyrics', meta),
  updater: {
    state: () => ipcRenderer.invoke('updater:state'),
    check: () => ipcRenderer.invoke('updater:check'),
    install: () => ipcRenderer.invoke('updater:install'),
    openPage: () => ipcRenderer.invoke('updater:open-page')
  },
  lyricSources: {
    status: () => ipcRenderer.invoke('lyric-sources:status'),
    connect: (name) => ipcRenderer.invoke('lyric-sources:connect', name),
    disconnect: (name) => ipcRenderer.invoke('lyric-sources:disconnect', name)
  },
  setup: {
    open: () => ipcRenderer.send('setup:open'),
    done: (version) => ipcRenderer.send('setup:done', version),
    info: () => ipcRenderer.invoke('setup:info'),
    openWindowsSettings: (page) => ipcRenderer.send('open-ms-settings', page),
    testClipboard: (text) => ipcRenderer.invoke('setup:clip-test', text)
  },
  getStats: () => ipcRenderer.invoke('stats'),
  connectAppleCalendar: () => ipcRenderer.invoke('calendar:connect-apple'),
  getCalendar: () => ipcRenderer.invoke('calendar:get'),
  refreshCalendar: () => ipcRenderer.invoke('calendar:refresh'),
  fileIcon: (p) => ipcRenderer.invoke('file-icon', p),
  pathForFile: (f) => webUtils.getPathForFile(f),
  openPath: (p) => ipcRenderer.send('open-path', p),
  showInFolder: (p) => ipcRenderer.send('show-in-folder', p),
  openUrl: (u) => ipcRenderer.send('open-url', u),
  startDrag: (p) => ipcRenderer.send('start-drag', p),
  notifyInfo: () => ipcRenderer.invoke('notify-info'),
  copy: (t) => ipcRenderer.send('copy', t),
  focusWindow: () => ipcRenderer.send('focus-window'),
  quit: () => ipcRenderer.send('quit'),
  openSettings: (section) => ipcRenderer.send('open-settings', section),
  openClipboard: () => ipcRenderer.send('open-clipboard'),
  notchMenu: () => ipcRenderer.send('notch-menu'),
  setVolume: (v) => ipcRenderer.send('set-volume', v),
  openPlayer: (app) => ipcRenderer.send('open-player', app),
  notifyTest: (n) => ipcRenderer.send('notify-test', n),
  restart: () => ipcRenderer.send('restart'),
  statsActive: (on) => ipcRenderer.send('stats-active', on),
  translate: (key, lines, to, understood) => ipcRenderer.invoke('translate', key, lines, to, understood),
  displays: () => ipcRenderer.invoke('displays'),
  moveToDisplay: (id) => ipcRenderer.send('move-to-display', id),
  dragNotch: (on, grab) => ipcRenderer.send('drag-notch', on, grab),
  moveMode: (on) => ipcRenderer.send('move-mode', on),
  resetPosition: () => ipcRenderer.send('reset-position'),
  nudge: (d) => ipcRenderer.send('nudge', d),
  toast: { show: (n) => ipcRenderer.send('toast:show', n) },
  askPlace: () => ipcRenderer.send('place?'),
  shot: (mode) => ipcRenderer.send('shot', mode),
  shortcutsStatus: () => ipcRenderer.invoke('shortcuts:status'),
  toastsStatus: () => ipcRenderer.invoke('toasts:status'),
  diagnostics: () => ipcRenderer.invoke('diagnostics'),
  clip: {
    list: () => ipcRenderer.invoke('clip:list'),
    status: () => ipcRenderer.invoke('clip:status'),
    use: (id, paste) => ipcRenderer.invoke('clip:use', id, paste),
    pin: (id, on) => ipcRenderer.send('clip:pin', id, on),
    remove: (id) => ipcRenderer.send('clip:remove', id),
    clear: () => ipcRenderer.send('clip:clear'),
    drag: (id) => ipcRenderer.send('clip:drag', id)
  },
  todo: {
    info: () => ipcRenderer.invoke('todo:info'),
    login: (url, user, pass) => ipcRenderer.invoke('todo:login', url, user, pass),
    logout: () => ipcRenderer.invoke('todo:logout'),
    list: () => ipcRenderer.invoke('todo:list'),
    add: (text, due, time) => ipcRenderer.invoke('todo:add', text, due, time),
    update: (id, patch) => ipcRenderer.invoke('todo:update', id, patch),
    remove: (id) => ipcRenderer.invoke('todo:remove', id)
  },
  onHover: on('hover'),
  onMedia: on('media'),
  onMediaNote: on('media-note'),
  onArt: on('art'),
  onSystem: on('system'),
  onNotify: on('notify'),
  onCalendar: on('calendar'),
  onOpenTab: on('open-tab'),
  onStore: on('store'),
  onFullscreen: on('fullscreen'),
  onPlace: on('place'),
  onSnapGuide: on('snap-guide'),
  onMoveMode: on('move-mode'),
  onToastEvent: on('toast-event'),
  onClips: on('clips'),
  onClipStatus: on('clip-status'),
  onShotSaved: on('shot-saved'),
  onShortcuts: on('shortcuts'),
  onToastsStatus: on('toasts-status'),
  onSettingsSection: on('settings-section'),
  onLyricsSources: on('lyrics-sources'),
  onUpdater: on('updater')
});
