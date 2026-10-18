const test = require('node:test');
const assert = require('node:assert');
const S = require('../src/shared/search.js');
const seed = require('./fixtures/sample-programmes.json');

test('search ranks the obvious match first', () => {
  assert.match(S.search(seed, 'coding')[0].programme.title, /Code/);
  assert.match(S.search(seed, 'money')[0].programme.title, /Money/);
});

test('synonyms widen search (camping -> outdoor)', () => {
  assert.ok(S.search(seed, 'camping').some(r => /Camp/.test(r.programme.title)));
});

test('filters restrict results', () => {
  const res = S.search(seed, '', { ageGroup: '5-8' });
  assert.ok(res.length > 0 && res.every(r => r.programme.ageGroup === '5-8'));
});

test('recommend excludes the source programme and explains matches', () => {
  const src = seed[0];
  const recs = S.recommend(seed, src, { excludeId: src.id });
  assert.ok(recs.length > 0 && recs.every(r => r.programme.id !== src.id));
  assert.ok(recs.some(r => r.reasons.length));
});

test('built-in programmes are valid and searchable', () => {
  const built = require('../src/seed/programmes.json');
  for (const p of built) {
    assert.ok(p.id && p.title, 'id and title');
    const F = require('../src/shared/form.js');
    assert.ok(p.ageGroups.every(a => F.AGE_GROUPS.includes(a)), p.title);
    assert.ok(!p.format || F.FORMATS.includes(p.format), p.title);
    assert.deepStrictEqual(Object.keys(F.blank()).filter(k => !(k in p)), [], p.title);
    assert.ok(Array.isArray(p.sessions) && Array.isArray(p.themes) && Array.isArray(p.objectives), p.title);
  }
  assert.match(S.search(built, 'forest')[0].programme.title, /Nature/);
  assert.match(S.search(built, 'singing')[0].programme.title, /Vocal/);
});
