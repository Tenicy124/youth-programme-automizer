const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { Store } = require('./store');
const { AI, DEFAULT_MODEL } = require('./ai');

let store;
let ai;
let win;

function apiKey() {
  const s = store.getSettings();
  if (!s.apiKeyEnc) return '';
  try {
    const buf = Buffer.from(s.apiKeyEnc, 'base64');
    return s.apiKeyPlain ? buf.toString('utf8') : safeStorage.decryptString(buf);
  } catch { return ''; }
}

function setApiKey(key) {
  if (!key) return store.setSettings({ apiKeyEnc: '', apiKeyPlain: false });
  // On macOS safeStorage encrypts with a key held in the login Keychain.
  if (safeStorage.isEncryptionAvailable()) {
    store.setSettings({ apiKeyEnc: safeStorage.encryptString(key).toString('base64'), apiKeyPlain: false });
  } else {
    store.setSettings({ apiKeyEnc: Buffer.from(key, 'utf8').toString('base64'), apiKeyPlain: true });
  }
}

function publicSettings() {
  const s = store.getSettings();
  const key = apiKey();
  return {
    hasApiKey: !!key,
    apiKeyHint: key ? key.slice(0, 7) + '…' + key.slice(-4) : '',
    model: s.model || DEFAULT_MODEL,
    defaultModel: DEFAULT_MODEL,
    facilitator: s.facilitator || '',
    organisation: s.organisation || '',
    dataFile: store.file,
  };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 980, minHeight: 640,
    title: 'Youth Programme Studio',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#f6f5f2',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Open external links in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; } catch (err) { return { ok: false, error: err.message || String(err) }; }
  });
}

function registerIpc() {
  handle('db:list', (kind) => store.list(kind));
  handle('db:get', (kind, id) => store.get(kind, id));
  handle('db:upsert', (kind, item) => store.upsert(kind, item));
  handle('db:remove', (kind, id) => store.remove(kind, id));

  handle('settings:get', () => publicSettings());
  handle('settings:set', (patch) => {
    const { apiKey: key, ...rest } = patch;
    if (key !== undefined) setApiKey(key.trim());
    store.setSettings(rest);
    return publicSettings();
  });

  handle('ai:test', () => ai.test());
  handle('ai:ideate', (args) => ai.ideate(args));
  handle('ai:develop', (args) => ai.develop(args));
  handle('ai:draftTemplate', (args) => ai.draftTemplate(args));
  handle('ai:fillTemplate', (args) => ai.fillTemplate(args));
  handle('ai:parseProgramme', (args) => ai.parseProgramme(args));
  handle('ai:chat', (args, streamId) => ai.chat(args, (t) => win && win.webContents.send('ai:chunk', streamId, t)));

  handle('file:export', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: `programme-library-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled) return null;
    fs.writeFileSync(filePath, JSON.stringify(store.exportData(), null, 2));
    return filePath;
  });
  handle('file:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
    if (canceled || !filePaths[0]) return null;
    return store.importData(JSON.parse(fs.readFileSync(filePaths[0], 'utf8')));
  });
  handle('file:saveText', async (name, text, ext) => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (canceled) return null;
    fs.writeFileSync(filePath, text);
    return filePath;
  });
  handle('file:pdf', async (name) => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: name, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (canceled) return null;
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } });
    fs.writeFileSync(filePath, pdf);
    return filePath;
  });
  handle('file:reveal', () => shell.showItemInFolder(store.file));
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const send = (cmd) => () => win && win.webContents.send('menu', cmd);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'New Programme', accelerator: 'CmdOrCtrl+N', click: send('new-programme') },
      { label: 'New Template', accelerator: 'CmdOrCtrl+Shift+N', click: send('new-template') },
      { type: 'separator' },
      { label: 'Import…', accelerator: 'CmdOrCtrl+I', click: send('import') },
      { label: 'Export Library…', click: send('export') },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { label: 'Search', accelerator: 'CmdOrCtrl+F', click: send('focus-search') },
      { type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
  ]));
}

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'), path.join(__dirname, '..', 'seed'));
  ai = new AI(() => ({ apiKey: apiKey(), model: store.getSettings().model }));
  registerIpc();
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
