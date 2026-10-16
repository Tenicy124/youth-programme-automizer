const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/main/store.js');

test('store seeds, saves, updates, deletes and round-trips exports', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ypa-'));
  const s = new Store(dir, path.join(__dirname, '..', 'src', 'seed'));
  assert.equal(s.list('programmes').length, 14);
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
