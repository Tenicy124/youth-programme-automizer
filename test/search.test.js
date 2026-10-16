const test = require('node:test');
const assert = require('node:assert');
const S = require('../src/shared/search.js');
const seed = require('../src/seed/programmes.json');

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
