// Search and recommendation engine for programmes.
// Runs in both the renderer (window.PSearch) and Node (require) so it can be unit tested.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PSearch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const STOP = new Set(('a an and are as at be by for from has have in into is it its of on or that the their them they this to was were will with ' +
    'we you your our us can each per week weeks session sessions young people youth programme program').split(' '));

  const SYNONYMS = {
    stem: ['science', 'technology', 'engineering', 'maths', 'math', 'coding'],
    coding: ['programming', 'code', 'computer', 'digital'],
    outdoor: ['outdoors', 'nature', 'adventure', 'camping', 'hiking'],
    wellbeing: ['mental', 'health', 'mindfulness', 'resilience', 'wellness'],
    art: ['arts', 'creative', 'drawing', 'painting', 'craft'],
    music: ['band', 'singing', 'song', 'songwriting'],
    sport: ['sports', 'fitness', 'football', 'basketball', 'games', 'physical'],
    leadership: ['leader', 'leaders', 'leading', 'confidence'],
    environment: ['sustainability', 'climate', 'green', 'eco', 'recycling'],
    money: ['financial', 'finance', 'budgeting', 'saving'],
    career: ['careers', 'jobs', 'employability', 'work'],
    business: ['entrepreneurship', 'enterprise', 'startup'],
    community: ['volunteering', 'service', 'civic'],
  };
  const SYN_INDEX = {};
  for (const [k, list] of Object.entries(SYNONYMS)) {
    for (const w of [k, ...list]) (SYN_INDEX[w] = SYN_INDEX[w] || new Set()).add(k);
  }

  function stem(w) {
    if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
    if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    return w;
  }

  function tokenize(text) {
    if (!text) return [];
    return String(text).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/)
      .filter(w => w.length > 1 && !STOP.has(w));
  }

  // Expands a token list with stems and synonym-group keys.
  function expand(tokens) {
    const out = [];
    for (const t of tokens) {
      out.push(stem(t));
      if (SYN_INDEX[t]) for (const g of SYN_INDEX[t]) out.push('syn:' + g);
    }
    return out;
  }

  // Field weights: title and themes matter more than session details.
  function docText(p) {
    const sessions = (p.sessions || []).map(s => [s.title, s.activities].join(' ')).join(' ');
    const doc = (p.document || []).map(s => s.content).join(' ');
    return [
      [p.title, 3], [(p.themes || []).join(' '), 3], [p.summary, 2], [(p.objectives || []).join(' '), 1.5],
      [p.format, 1], [sessions, 1], [p.notes, 0.5], [doc, 0.5],
      [[p.youthNeed, p.mainActivities, p.iceName, (p.competencies || []).join(' ')].join(' '), 1],
    ];
  }

  function buildIndex(programmes) {
    const docs = programmes.map(p => {
      const tf = new Map();
      for (const [text, weight] of docText(p)) {
        for (const t of expand(tokenize(text))) tf.set(t, (tf.get(t) || 0) + weight);
      }
      return { p, tf };
    });
    const df = new Map();
    for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    const N = docs.length || 1;
    const idf = t => Math.log(1 + N / (1 + (df.get(t) || 0)));
    for (const d of docs) {
      d.vec = new Map();
      let norm = 0;
      for (const [t, f] of d.tf) {
        const w = (1 + Math.log(f)) * idf(t);
        d.vec.set(t, w);
        norm += w * w;
      }
      d.norm = Math.sqrt(norm) || 1;
    }
    return { docs, idf };
  }

  function queryVector(index, text) {
    const vec = new Map();
    for (const t of expand(tokenize(text))) vec.set(t, (vec.get(t) || 0) + index.idf(t));
    return vec;
  }

  function cosine(a, aNorm, b, bNorm) {
    let dot = 0;
    const [small, big] = a.size < b.size ? [a, b] : [b, a];
    for (const [t, w] of small) if (big.has(t)) dot += w * big.get(t);
    return dot / ((aNorm || 1) * (bNorm || 1));
  }

  function matchesFilters(p, f) {
    if (!f) return true;
    if (f.ageGroup && !(p.ageGroups || [p.ageGroup]).includes(f.ageGroup)) return false;
    if (f.format && p.format !== f.format) return false;
    if (f.status && p.status !== f.status) return false;
    if (f.theme && !(p.themes || []).some(t => t.toLowerCase() === f.theme.toLowerCase())) return false;
    return true;
  }

  // Full-text search. Empty query returns all (filtered), newest first.
  function search(programmes, query, filters) {
    const pool = programmes.filter(p => matchesFilters(p, filters));
    if (!query || !query.trim()) {
      return pool.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .map(p => ({ programme: p, score: 1 }));
    }
    const index = buildIndex(pool);
    const q = queryVector(index, query);
    let qn = 0; for (const w of q.values()) qn += w * w; qn = Math.sqrt(qn);
    const lower = query.toLowerCase().trim();
    return index.docs.map(d => {
      let score = cosine(q, qn, d.vec, d.norm);
      if ((d.p.title || '').toLowerCase().includes(lower)) score += 0.5;
      return { programme: d.p, score };
    }).filter(r => r.score > 0.02).sort((a, b) => b.score - a.score);
  }

  // Recommendations: programmes similar to a brief or to a given programme,
  // boosted by rating and matching age group, de-duplicated by the source id.
  function recommend(programmes, brief, opts) {
    opts = opts || {};
    const limit = opts.limit || 6;
    const text = typeof brief === 'string' ? brief
      : [brief.title, (brief.themes || []).join(' '), brief.summary, (brief.objectives || []).join(' '), brief.format].join(' ');
    const pool = programmes.filter(p => p.id !== opts.excludeId && p.status !== 'archived');
    if (!pool.length) return [];
    const index = buildIndex(pool);
    const q = queryVector(index, text);
    let qn = 0; for (const w of q.values()) qn += w * w; qn = Math.sqrt(qn);
    const age = opts.ageGroup || (typeof brief === 'object' ? brief.ageGroup : null);
    return index.docs.map(d => {
      const sim = cosine(q, qn, d.vec, d.norm);
      let score = sim;
      const sameAge = age && (d.p.ageGroups || [d.p.ageGroup]).includes(age);
      if (sameAge) score += 0.15;
      if (d.p.rating) score += 0.04 * d.p.rating;
      if (d.p.status === 'delivered' || d.p.status === 'ready') score += 0.05;
      const reasons = [];
      if (sameAge) reasons.push('same age group');
      const shared = (d.p.themes || []).filter(t => text.toLowerCase().includes(t.toLowerCase()));
      if (shared.length) reasons.push('themes: ' + shared.join(', '));
      if (d.p.rating >= 4) reasons.push('highly rated (' + d.p.rating + '★)');
      return { programme: d.p, score, similarity: sim, reasons };
    }).filter(r => r.similarity > 0.01 || (age && r.programme.ageGroup === age))
      .sort((a, b) => b.score - a.score).slice(0, limit);
  }

  function allThemes(programmes) {
    const counts = {};
    for (const p of programmes) for (const t of p.themes || []) counts[t.toLowerCase()] = (counts[t.toLowerCase()] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }

  return { search, recommend, tokenize, allThemes };
});
