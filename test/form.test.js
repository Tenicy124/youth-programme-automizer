const test = require('node:test');
const assert = require('node:assert');
const F = require('../src/shared/form');

test('normalize upgrades an old programme', () => {
  const p = F.normalize({ title: 'Old', ageGroup: '13-15', format: 'Weekly club', outcomes: 'Attendance', sessions: [{ title: 'A' }] });
  assert.deepStrictEqual(p.ageGroups, ['13-16']);
  assert.strictEqual(p.ageGroup, '13-16');
  assert.strictEqual(p.format, 'Ongoing / open group');
  assert.strictEqual(p.successCriteria, 'Attendance');
  assert.ok(!('outcomes' in p));
  assert.deepStrictEqual(p.risks, []);
  assert.strictEqual(p.sessions[0].activities, '');
});

test('normalize is idempotent and keeps new values', () => {
  const once = F.normalize({ title: 'New', ageGroups: ['17-19', '13-16'], format: F.FORMATS[1], competencies: [F.COMPETENCIES[0]] });
  assert.deepStrictEqual(once.ageGroups, ['13-16', '17-19']);
  assert.deepStrictEqual(F.normalize(once), once);
});

test('workshop format maps by session count', () => {
  assert.strictEqual(F.normalize({ format: 'Workshop', sessions: [{}, {}, {}] }).format, F.FORMATS[1]);
  assert.strictEqual(F.normalize({ format: 'Workshop', sessions: [] }).format, F.FORMATS[0]);
});

test('risks suggest their mitigations', () => {
  const m = F.mitigationsFor([F.RISK_LABELS[0]]);
  assert.ok(m.length >= 2);
  assert.ok(F.MITIGATIONS.flatMap(g => g.items).includes(m[0]));
});

test('missingMandatory lists empty required sections', () => {
  assert.deepStrictEqual(F.missingMandatory(F.blank()), ['core competencies', 'icebreaker', 'mindfulness']);
});
