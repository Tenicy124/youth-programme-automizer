// Local JSON database stored in the user's Application Support folder.
// Writes are atomic (temp file + rename) so a crash never corrupts the library.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EMPTY = { version: 1, programmes: [], templates: [], settings: {} };

class Store {
  constructor(dir, seedDir) {
    this.file = path.join(dir, 'library.json');
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(this.file)) {
      try {
        this.data = { ...EMPTY, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
      } catch (e) {
        // Keep the unreadable file for recovery and start fresh.
        fs.renameSync(this.file, this.file + '.corrupt-' + Date.now());
        this.data = structuredClone(EMPTY);
      }
    } else {
      this.data = structuredClone(EMPTY);
      this.seed(seedDir);
    }
  }

  seed(seedDir) {
    if (!seedDir) return;
    const read = f => {
      try { return JSON.parse(fs.readFileSync(path.join(seedDir, f), 'utf8')); } catch { return []; }
    };
    this.data.programmes = read('programmes.json');
    this.data.templates = read('templates.json');
    this.save();
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  list(kind) { return this.data[kind]; }

  get(kind, id) { return this.data[kind].find(x => x.id === id) || null; }

  upsert(kind, item) {
    const now = new Date().toISOString();
    const list = this.data[kind];
    const i = item.id ? list.findIndex(x => x.id === item.id) : -1;
    if (i >= 0) {
      list[i] = { ...list[i], ...item, updatedAt: now };
      this.save();
      return list[i];
    }
    const created = { ...item, id: item.id || crypto.randomUUID(), createdAt: item.createdAt || now, updatedAt: now };
    list.unshift(created);
    this.save();
    return created;
  }

  remove(kind, id) {
    this.data[kind] = this.data[kind].filter(x => x.id !== id);
    this.save();
    return true;
  }

  getSettings() { return this.data.settings || {}; }

  setSettings(patch) {
    this.data.settings = { ...this.getSettings(), ...patch };
    this.save();
    return this.data.settings;
  }

  exportData() {
    return { version: 1, exportedAt: new Date().toISOString(), programmes: this.data.programmes, templates: this.data.templates };
  }

  // Merges an export into the library; items with an existing id are replaced.
  importData(obj) {
    let added = 0;
    for (const kind of ['programmes', 'templates']) {
      for (const item of obj[kind] || []) {
        if (!item || typeof item !== 'object' || !item.id) continue;
        const i = this.data[kind].findIndex(x => x.id === item.id);
        if (i >= 0) this.data[kind][i] = item; else this.data[kind].push(item);
        added++;
      }
    }
    this.save();
    return added;
  }
}

module.exports = { Store };
