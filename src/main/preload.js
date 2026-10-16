const { contextBridge, ipcRenderer } = require('electron');

const call = async (channel, ...args) => {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res.ok) throw new Error(res.error);
  return res.data;
};

let streamSeq = 0;

contextBridge.exposeInMainWorld('api', {
  list: (kind) => call('db:list', kind),
  get: (kind, id) => call('db:get', kind, id),
  upsert: (kind, item) => call('db:upsert', kind, item),
  remove: (kind, id) => call('db:remove', kind, id),
  getSettings: () => call('settings:get'),
  setSettings: (patch) => call('settings:set', patch),
  ai: {
    test: () => call('ai:test'),
    ideate: (args) => call('ai:ideate', args),
    develop: (args) => call('ai:develop', args),
    draftTemplate: (args) => call('ai:draftTemplate', args),
    fillTemplate: (args) => call('ai:fillTemplate', args),
    parseProgramme: (args) => call('ai:parseProgramme', args),
    chat: async (args, onText) => {
      const id = ++streamSeq;
      const listener = (_e, sid, text) => { if (sid === id) onText(text); };
      ipcRenderer.on('ai:chunk', listener);
      try { return await call('ai:chat', args, id); } finally { ipcRenderer.removeListener('ai:chunk', listener); }
    },
  },
  exportLibrary: () => call('file:export'),
  importLibrary: () => call('file:import'),
  saveText: (name, text, ext) => call('file:saveText', name, text, ext),
  savePdf: (name) => call('file:pdf', name),
  revealData: () => call('file:reveal'),
  onMenu: (fn) => ipcRenderer.on('menu', (_e, cmd) => fn(cmd)),
});
