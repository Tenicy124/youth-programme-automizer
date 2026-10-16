const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/main/store.js');

test('store seeds, saves, updates, deletes and round-trips exports', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ypa-'));
  const s = new Store(dir, path.join(__dirname, '..', 'src', 'seed'));
  const seedCount = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'seed', 'programmes.json'))).length;
  assert.equal(s.list('programmes').length, seedCount);
  const p = s.upsert('programmes', { title: 'Test' });
  assert.ok(p.id && p.createdAt);
  s.upsert('programmes', { id: p.id, title: 'Renamed' });
  assert.equal(new Store(dir).get('programmes', p.id).title, 'Renamed');
  const exported = s.exportData();
  s.remove('programmes', p.id);
  assert.equal(s.get('programmes', p.id), null);
  s.importData(exported);
  assert.equal(s.get('programmes', p.id).title, 'Renamed');
});

test('older libraries get new built-in programmes once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ypa-'));
  const seedDir = path.join(__dirname, '..', 'src', 'seed');
  fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify({ version: 1, programmes: [{ id: 'mine', title: 'Mine' }], templates: [], settings: {} }));
  const s = new Store(dir, seedDir);
  const seedCount = JSON.parse(fs.readFileSync(path.join(seedDir, 'programmes.json'))).length;
  assert.equal(s.list('programmes').length, seedCount + 1);
  const firstSeed = s.list('programmes').find(p => p.id !== 'mine');
  s.remove('programmes', firstSeed.id);
  assert.equal(new Store(dir, seedDir).list('programmes').length, seedCount);
});
