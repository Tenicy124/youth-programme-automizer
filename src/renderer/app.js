/* Youth Programme Studio — renderer */
'use strict';

const AGE_GROUPS = PForm.AGE_GROUPS;
const FORMATS = PForm.FORMATS;
const STATUSES = ['idea', 'draft', 'ready', 'delivered', 'archived'];
const STATUS_HELP = { idea: 'Just an idea', draft: 'Being planned', ready: 'Ready to run', delivered: 'Has been run', archived: 'No longer used' };
const PLACEHOLDERS = ['programme_title', 'age_group', 'format', 'duration', 'group_size', 'objectives', 'summary', 'facilitator', 'organisation', 'date'];

const S = {
  programmes: [], templates: [], settings: {},
  view: 'home', id: null, tab: 'overview',
  filters: { q: '', ageGroup: '', format: '', status: '', theme: '' },
  draft: null, dirty: false,         // programme being edited (edit page)
  wiz: null,                         // create wizard state { step, p, ideas, brief }
  tplEdit: null,
  chat: { messages: [], busy: false, draft: '', getFocus: null, onNote: null },
  aiHidden: false,
};

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const lines = s => String(s || '').split('\n').map(x => x.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean);
const opts = (list, val, blank) => (blank !== undefined ? `<option value="">${esc(blank)}</option>` : '') +
  list.map(v => `<option ${v === val ? 'selected' : ''} value="${esc(v)}">${esc(v)}</option>`).join('');
const stars = n => n ? `<span class="stars" title="${n} out of 5">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>` : '';
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const main = () => $('#main');
const copyText = window.copyText || (t => { try { navigator.clipboard.writeText(t).catch(() => {}); } catch (e) { /* ignore */ } });
const agesText = p => (p.ageGroups && p.ageGroups.length ? p.ageGroups : (p.ageGroup ? [p.ageGroup] : [])).join(', ');
const statusBadge = s => `<span class="status st-${esc(s)}">${esc(s)}</span>`;

function toast(msg, isError) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), isError ? 6000 : 2600);
}

function modal(html, onMount) {
  const m = $('#modal');
  m.innerHTML = `<div class="box">${html}</div>`;
  m.classList.remove('hidden');
  return new Promise(resolve => {
    const close = (v) => { m.classList.add('hidden'); m.innerHTML = ''; resolve(v); };
    m.onclick = e => { if (e.target === m) close(null); };
    $$('[data-close]', m).forEach(b => b.onclick = () => close(null));
    onMount && onMount(m, close);
  });
}

async function confirmBox(title, text, okLabel = 'Confirm', danger = false) {
  return modal(`<h2>${esc(title)}</h2><p>${esc(text)}</p>
    <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger-fill' : 'primary'}" id="ok">${esc(okLabel)}</button></div>`,
  (m, close) => { $('#ok', m).onclick = () => close(true); });
}

async function busy(btn, label, fn) {
  const prev = btn && btn.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>${esc(label)}`; }
  try { return await fn(); } catch (e) {
    toast(e.message, true);
    if (!S.settings.hasApiKey) setTimeout(() => go('settings'), 600);
    return undefined;
  } finally { if (btn && document.body.contains(btn)) { btn.disabled = false; btn.innerHTML = prev; } }
}

async function reload() {
  [S.programmes, S.templates, S.settings] = await Promise.all([api.list('programmes'), api.list('templates'), api.getSettings()]);
  S.programmes = S.programmes.map(PForm.normalize);
  renderAiStatus();
}

function renderAiStatus() {
  $('#aiStatus').innerHTML = S.settings.hasApiKey
    ? `<span class="dot on"></span>AI ready`
    : `<span class="dot"></span>AI off · <a href="#" id="setupAi">add API key</a>`;
  const l = $('#setupAi'); if (l) l.onclick = e => { e.preventDefault(); go('settings'); };
}

function newProgramme(extra) {
  return PForm.normalize({ ...PForm.blank(), ...extra });
}

const NAV_FOR = { home: 'home', create: 'create', catalog: 'catalog', programme: 'catalog', edit: 'catalog', templates: 'templates', template: 'templates', import: 'import', settings: 'settings' };

// ---------- routing ----------
async function go(view, id = null, opts = {}) {
  if (S.dirty) {
    const leave = await confirmBox('Leave without saving?', 'You have changes that are not saved yet.', 'Discard changes', true);
    if (!leave) return;
  }
  S.dirty = false;
  if (view !== 'edit') S.draft = null;
  if (view !== 'template') S.tplEdit = null;
  if (view === 'create' && !opts.keepWizard) { S.wiz = null; S.chat.messages = []; }
  if (view === 'edit' && S.id !== id) S.chat.messages = [];
  if (view !== 'create' && view !== 'edit') { S.chat.getFocus = null; S.chat.onNote = null; }
  S.view = view; S.id = id;
  if (opts.tab) S.tab = opts.tab;
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === NAV_FOR[view]));
  render();
  main().scrollTop = 0;
}

function render() {
  const views = { home: viewHome, create: viewCreate, catalog: viewCatalog, programme: viewProgramme, edit: viewEdit, templates: viewTemplates, template: viewTemplate, import: viewImport, settings: viewSettings };
  (views[S.view] || viewHome)();
  const crumbs = $('.crumbs', main()), titles = $('.topbar .titles', main());
  if (crumbs && titles) titles.prepend(crumbs);
}

function header(title, sub, actions = '') {
  return `<div class="topbar"><div class="titles"><h1>${title}</h1>${sub ? `<p class="subtitle">${sub}</p>` : ''}</div><div class="spacer"></div>${actions}</div>`;
}

// ---------- Programme cards ----------
function programmeCard(p, extra = '') {
  return `<div class="card" data-open="${esc(p.id)}" tabindex="0">
    <div class="card-head"><h3>${esc(p.title || 'Untitled programme')}</h3>${statusBadge(p.status)}</div>
    <p>${esc(p.summary)}</p>${extra}
    <div class="meta">${agesText(p) ? `<span>Ages ${esc(agesText(p))}</span>` : ''}${p.format ? `<span>${esc(p.format)}</span>` : ''}${p.date ? `<span>${esc(p.date)}</span>` : ''}${stars(p.rating)}</div>
    <div class="chips">${(p.themes || []).slice(0, 4).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
  </div>`;
}

function bindOpen(root) {
  $$('[data-open]', root).forEach(c => {
    c.onclick = () => go('programme', c.dataset.open);
    c.onkeydown = e => { if (e.key === 'Enter') go('programme', c.dataset.open); };
  });
}

// ---------- Home ----------
function viewHome() {
  const P = S.programmes;
  const count = s => P.filter(p => p.status === s).length;
  const name = S.settings.facilitator ? `, ${esc(S.settings.facilitator.split(' ')[0])}` : '';
  const tally = key => { const m = {}; P.forEach(p => { const vs = key === 'ageGroup' ? (p.ageGroups || []) : [p[key]]; vs.forEach(v => { if (v) m[v] = (m[v] || 0) + 1; }); }); return m; };
  const bars = (title, m, order, filterKey) => {
    const rows = (order || Object.keys(m).sort((a, b) => m[b] - m[a])).filter(k => m[k]);
    const max = Math.max(1, ...rows.map(k => m[k]));
    return `<div class="panel"><h2>${title}</h2>${rows.length ? rows.map(k => `
      <button class="bar-row" data-filter="${filterKey}" data-v="${esc(k)}"><span class="bar-label">${esc(filterKey === 'ageGroup' ? 'Ages ' + k : k)}</span><span class="bar"><i style="width:${Math.round(m[k] / max * 100)}%"></i></span><b>${m[k]}</b></button>`).join('') : '<p class="faint">Nothing yet.</p>'}</div>`;
  };
  const themes = {}; P.forEach(p => (p.themes || []).forEach(t => { themes[t] = (themes[t] || 0) + 1; }));
  const topThemes = Object.keys(themes).sort((a, b) => themes[b] - themes[a]).slice(0, 10);
  const last = P.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  main().innerHTML = `
    ${header(`Welcome back${name}`, 'A summary of your youth programmes.', '<button class="btn primary" data-go="create">＋ Create new</button>')}
    <div class="stats">
      <button class="stat" data-status=""><b>${P.length}</b><span>Programmes</span></button>
      <button class="stat st-ready-c" data-status="ready"><b>${count('ready')}</b><span>Ready to run</span></button>
      <button class="stat st-plan-c" data-status="draft"><b>${count('draft') + count('idea')}</b><span>In planning</span></button>
      <button class="stat st-done-c" data-status="delivered"><b>${count('delivered')}</b><span>Delivered</span></button>
    </div>
    ${P.length ? `<div class="home-grid">
      ${bars('By age group', tally('ageGroup'), AGE_GROUPS, 'ageGroup')}
      ${bars('By format', tally('format'), null, 'format')}
      <div class="panel"><h2>Most common tags</h2><div class="chips">${topThemes.map(t => `<button class="tag big tag-btn" data-filter="theme" data-v="${esc(t)}">${esc(t)} <span class="faint">${themes[t]}</span></button>`).join('')}</div>
        ${last ? `<p class="faint small last-up">Last updated: <a href="#" data-open="${esc(last.id)}">${esc(last.title)}</a>, ${fmtDate(last.updatedAt)}</p>` : ''}</div>
    </div>` : '<div class="empty">No programmes yet. Click <b>Create new</b> to plan your first one, or bring existing ones in from <b>Import</b>.</div>'}`;
  $$('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
  const toCatalog = patch => { S.filters = { q: '', ageGroup: '', format: '', status: '', theme: '', ...patch }; go('catalog'); };
  $$('[data-status]').forEach(b => b.onclick = () => toCatalog({ status: b.dataset.status }));
  $$('[data-filter]').forEach(b => b.onclick = () => toCatalog({ [b.dataset.filter]: b.dataset.v }));
  $$('[data-open]').forEach(a => a.onclick = e => { e.preventDefault(); go('programme', a.dataset.open); });
}

// ---------- Catalog ----------
const FILTER_GROUPS = [
  { key: 'ageGroup', label: 'Age group', list: () => AGE_GROUPS, show: v => 'Ages ' + v },
  { key: 'format', label: 'Format', list: () => FORMATS, show: v => v },
  { key: 'status', label: 'Status', list: () => STATUSES, show: v => v[0].toUpperCase() + v.slice(1) },
  { key: 'theme', label: 'Tag', list: () => PSearch.allThemes(S.programmes), show: v => '#' + v },
];

function viewCatalog() {
  const f = S.filters;
  main().innerHTML = `
    ${header('Catalog', 'Search and filter all your programmes. Click one to view or edit it.', '<button class="btn" id="shareBtn">⇧ Share</button><button class="btn primary" id="newBtn">＋ Create new</button>')}
    <div class="catalog-bar">
      <div class="search-wrap" id="searchWrap">
        <div class="searchbox">
          <input type="search" id="q" aria-label="Search programmes" autocomplete="off" placeholder="Search programmes, e.g. coding, camping, leadership" value="${esc(f.q)}">
          <button type="button" class="search-clear ${f.q ? '' : 'hidden'}" id="qClear" aria-label="Clear search">✕</button>
        </div>
        <div class="search-drop hidden" id="drop" role="listbox"></div>
      </div>
      <button class="btn filter-btn" id="filterBtn">☰ Filters<span class="badge hidden" id="fCount"></span></button>
    </div>
    <div class="active-filters" id="activeFilters"></div>
    <div class="resultcount" id="count"></div>
    <div id="results"></div>`;
  const q = $('#q'), drop = $('#drop');
  let hi = -1, matches = [];
  const closeDrop = () => { drop.classList.add('hidden'); hi = -1; };
  const run = () => {
    const res = PSearch.search(S.programmes, f.q, f);
    matches = f.q.trim() ? res.slice(0, 6).map(r => r.programme) : [];
    $('#count').textContent = `Showing ${res.length} of ${S.programmes.length} programmes${f.q ? ', best matches first' : ''}`;
    $('#results').innerHTML = res.length
      ? `<div class="cards">${res.map(r => programmeCard(r.programme)).join('')}</div>`
      : `<div class="empty">No programmes match. Try fewer filters, or <a href="#" id="toCreate">create a new one with AI ideas</a>.</div>`;
    bindOpen($('#results'));
    const tc = $('#toCreate'); if (tc) tc.onclick = e => { e.preventDefault(); go('create'); };
    $('#qClear').classList.toggle('hidden', !f.q);
    renderActiveFilters();
  };
  const renderDrop = () => {
    if (!matches.length || document.activeElement !== q) {
      if (f.q.trim() && document.activeElement === q) { drop.innerHTML = '<div class="drop-empty">No matching programmes</div>'; drop.classList.remove('hidden'); }
      else closeDrop();
      return;
    }
    drop.innerHTML = matches.map((p, i) => `<div class="drop-item ${i === hi ? 'hi' : ''}" role="option" data-i="${i}"><b>${esc(p.title)}</b><span>${agesText(p) ? 'Ages ' + esc(agesText(p)) + ' · ' : ''}${esc(p.format || '')}</span></div>`).join('')
      + '<div class="drop-foot">↑↓ to choose · Enter to open · Esc to close</div>';
    drop.classList.remove('hidden');
    $$('.drop-item', drop).forEach(el => el.onmousedown = e => { e.preventDefault(); go('programme', matches[+el.dataset.i].id); });
  };
  const renderActiveFilters = () => {
    const active = FILTER_GROUPS.filter(g => f[g.key]);
    $('#fCount').textContent = active.length; $('#fCount').classList.toggle('hidden', !active.length);
    $('#activeFilters').innerHTML = active.length ? active.map(g => `<span class="filter-chip">${esc(g.label)}: <b>${esc(g.show(f[g.key]))}</b><button type="button" data-unf="${g.key}" aria-label="Remove ${esc(g.label)} filter">✕</button></span>`).join('') + '<button type="button" class="btn ghost small" id="clearF">Clear all</button>' : '';
    $$('[data-unf]').forEach(b => b.onclick = () => { f[b.dataset.unf] = ''; run(); });
    const cf = $('#clearF'); if (cf) cf.onclick = () => { FILTER_GROUPS.forEach(g => { f[g.key] = ''; }); run(); };
  };
  q.oninput = () => { f.q = q.value; hi = -1; run(); renderDrop(); };
  q.onfocus = () => renderDrop();
  q.onblur = () => setTimeout(closeDrop, 120);
  q.onkeydown = e => {
    const open = !drop.classList.contains('hidden');
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (open) closeDrop(); else { if (f.q) { f.q = ''; q.value = ''; run(); } q.blur(); }
    } else if (e.key === 'ArrowDown' && matches.length) { e.preventDefault(); hi = (hi + 1) % matches.length; renderDrop(); }
    else if (e.key === 'ArrowUp' && matches.length) { e.preventDefault(); hi = (hi - 1 + matches.length) % matches.length; renderDrop(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (hi >= 0 && matches[hi]) go('programme', matches[hi].id); else { closeDrop(); q.blur(); } }
  };
  $('#qClear').onclick = () => { f.q = ''; q.value = ''; run(); closeDrop(); q.blur(); };
  $('#filterBtn').onclick = () => openFilters(run);
  $('#newBtn').onclick = () => go('create');
  $('#shareBtn').onclick = () => shareDialog(PSearch.search(S.programmes, f.q, f).map(r => r.programme.id));
  run();
}

function openFilters(after) {
  const f = S.filters;
  const pick = { ...f };
  const groupHtml = g => `<div class="field"><div class="label">${esc(g.label)}</div>
    <div class="pills" data-fg="${g.key}"><button type="button" class="pill-opt ${!pick[g.key] ? 'on' : ''}" data-v="">Any</button>${g.list().map(v => `<button type="button" class="pill-opt ${pick[g.key] === v ? 'on' : ''}" data-v="${esc(v)}">${esc(g.key === 'theme' ? '#' + v : g.key === 'status' ? g.show(v) : v)}</button>`).join('')}</div></div>`;
  modal(`<h2>Filter programmes</h2>${FILTER_GROUPS.map(groupHtml).join('')}
    <div class="foot"><button class="btn ghost" id="fReset">Clear all</button><div class="spacer"></div><button class="btn" data-close>Cancel</button><button class="btn primary" id="fApply">Show results</button></div>`, (m, close) => {
    $$('[data-fg]', m).forEach(g => $$('.pill-opt', g).forEach(b => b.onclick = () => {
      pick[g.dataset.fg] = b.dataset.v;
      $$('.pill-opt', g).forEach(x => x.classList.toggle('on', x === b));
    }));
    $('#fReset', m).onclick = () => { FILTER_GROUPS.forEach(g => { pick[g.key] = ''; }); $$('[data-fg]', m).forEach(g => $$('.pill-opt', g).forEach((x, i) => x.classList.toggle('on', i === 0))); };
    $('#fApply', m).onclick = () => { FILTER_GROUPS.forEach(g => { f[g.key] = pick[g.key]; }); close(); after(); };
  });
}

// ---------- Programme view ----------
// The plan laid out in the planning form's sections. Used by the programme page, review step and exports.
function programmeOutline(p) {
  const T = (label, v) => ({ label, v: v || '' });
  const L = (label, v) => ({ label, v: v || [], list: true });
  const C = (label, v) => ({ label, v: v || [], chips: true });
  return [
    { key: 'overview', items: [T('Short description', p.summary), L('Objectives', p.objectives), T('Date', p.date), T('Time', p.time), T('Location', p.location),
      C('Target age group', (p.ageGroups || []).map(a => PForm.AGE_HINTS[a] ? `${a} (${PForm.AGE_HINTS[a]})` : a)), T('Programme format', p.format), T('Session duration', p.sessionLength),
      T('Intended setting', p.setting), T('Facilitators', p.facilitators), T('Group size', p.groupSize), T('Overall length', p.duration), C('Tags', p.themes)] },
    { key: 'logistics', items: [L('Materials', p.materials), T('Attire', p.attire), T('Equipment', p.equipment), T('Meeting location', p.meetingPoint),
      T('Transportation', p.transport), T('Food and beverages', p.food), T('Itemised budget', p.budgetItems), T('Total estimated cost', p.budget)] },
    { key: 'purpose', items: [T('Primary challenge', p.youthNeed), T('Why this matters for this age group', p.whyItMatters), C('Core competencies', p.competencies),
      T('Primary competency focus', p.primaryCompetency), T('How the programme builds them', p.competencyHow)] },
    { key: 'icebreaker', items: [T('Activity', p.iceName), C('Purpose', p.icePurposes), T('Time allocated', p.iceTime), T('How it works', p.iceSteps), T('Why it suits this age group', p.iceWhy)] },
    { key: 'activities', items: [T('Main activities', p.mainActivities), C('How youths take part', p.involvement), T('More about how they take part', p.involvementNotes)], sessions: p.sessions || [] },
    { key: 'mindfulness', items: [C('Objective', p.mfObjectives), C('Type', p.mfTypes), C('When', p.mfWhen), T('Total time', p.mfTime), T('How it is introduced', p.mfFraming)] },
    { key: 'safety', items: [L('Potential risks', p.risks), L('Mitigation strategies', p.mitigations),
      L('Emergency contacts', (p.contacts || []).map(c => c.name + (c.phone ? ': ' + c.phone : ''))), L('Psychological safety', p.psychSafety),
      L('Best practices for facilitation', p.bestPractices), T('Earlier safety notes', p.riskNotes)] },
    { key: 'outcomes', items: [T('Intended youth outcomes', p.intendedOutcomes), T('Success criteria', p.successCriteria), C('Feedback collection', p.feedbackMethods), C('Observable indicators of impact', p.indicators)] },
  ].map(sec => ({ ...sec, title: `${SECTIONS[sec.key].num}. ${SECTIONS[sec.key].title || SECTIONS[sec.key].label}`, mandatory: SECTIONS[sec.key].mandatory,
    items: sec.items.filter(i => i.list || i.chips ? i.v.length : String(i.v).trim()) }));
}

function programmeReadHtml(p) {
  const tpl = p.templateId && S.templates.find(t => t.id === p.templateId);
  const block = (title, body, tab, extra = '') => `<section class="read-sec"><div class="read-head"><h2>${title}${extra}</h2>${tab && p.id ? `<button class="btn ghost small" data-edit-tab="${tab}">Edit</button>` : ''}</div>${body}</section>`;
  const none = '<p class="faint">Not added yet.</p>';
  const para = t => t ? `<p class="prose">${esc(t)}</p>` : none;
  const val = i => i.chips ? `<div class="chips">${i.v.map(x => `<span class="tag plain">${esc(x)}</span>`).join('')}</div>`
    : i.list ? `<ul>${i.v.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="prose">${esc(i.v)}</p>`;
  const sessions = list => list.map((s, i) => `
      <div class="read-session"><div class="rs-head"><span class="num">${i + 1}</span><b>${esc(s.title || 'Untitled segment')}</b>${s.duration ? `<span class="faint">${esc(s.duration)}</span>` : ''}</div>
        ${s.activities ? `<p class="prose">${esc(s.activities)}</p>` : ''}${s.materials ? `<p class="faint small">Materials: ${esc(s.materials)}</p>` : ''}</div>`).join('');
  const short = v => String(v || '-').split(/[;(\n]/)[0].trim() || '-';
  return `
    <div class="facts">
      <div><span>Ages</span><b title="${esc(agesText(p))}">${esc(agesText(p) || '-')}</b></div>
      <div><span>Format</span><b title="${esc(p.format)}">${esc(p.format || '-')}</b></div>
      <div><span>Session length</span><b title="${esc(p.sessionLength)}">${esc(p.sessionLength || '-')}</b></div>
      <div><span>Date</span><b title="${esc(p.date)}">${esc(p.date || '-')}</b></div>
      <div><span>Budget</span><b title="${esc(p.budget)}">${esc(short(p.budget))}</b></div>
    </div>
    ${programmeOutline(p).map(sec => {
      const miss = sec.mandatory && !sec.items.length;
      const body = sec.items.length || (sec.sessions || []).length
        ? `<dl class="kv">${sec.items.map(i => `<dt>${esc(i.label)}</dt><dd>${val(i)}</dd>`).join('')}</dl>${(sec.sessions || []).length ? `<h3 class="sub">Activity timeline <span class="count">${sec.sessions.length}</span></h3>${sessions(sec.sessions)}` : ''}`
        : miss ? '<p class="notice small">Required on the planning form. Not filled in yet.</p>' : none;
      return block(esc(sec.title), body, sec.key);
    }).join('')}
    ${(p.document || []).length ? block(`Document${tpl ? `: ${esc(tpl.name)}` : ''}`, p.document.map(d => `<h3 class="sub">${esc(d.heading)}</h3><p class="prose">${esc(d.content)}</p>`).join(''), 'documents') : ''}
    ${p.notes || p.rating ? block('Notes &amp; reflection', `${p.rating ? `<p>${stars(p.rating)}</p>` : ''}${para(p.notes)}`, 'notes') : ''}`;
}

function viewProgramme() {
  const p = S.programmes.find(x => x.id === S.id);
  if (!p) return go('catalog');
  const recs = PSearch.recommend(S.programmes, p, { excludeId: p.id, limit: 5 });
  main().innerHTML = `
    <div class="crumbs"><a href="#" id="back">← Catalog</a></div>
    ${header(esc(p.title || 'Untitled programme'), `${statusBadge(p.status)} <span class="faint">Updated ${fmtDate(p.updatedAt)}${p.sharedFrom ? ' · Shared by ' + esc(p.sharedFrom) : ''}</span>`,
      `<button class="btn" id="shareBtn">⇧ Share</button><button class="btn" id="exportBtn">Export</button><button class="btn" id="dupBtn">Duplicate</button><button class="btn primary" id="editBtn">Edit programme</button>`)}
    <div class="two-col">
      <div class="read">${programmeReadHtml(p)}</div>
      <aside class="side">
        <div class="panel"><h2>AI assist</h2>
          <div class="stack">
            <button class="btn ai" id="aiImprove">Review &amp; improve with AI</button>
            <button class="btn" id="aiVariants">Create a variation</button>
          </div></div>
        <div class="panel"><h2>Similar programmes</h2>${recs.length ? recs.map(r => `<div class="mini" data-open="${esc(r.programme.id)}" tabindex="0"><b>${esc(r.programme.title)}</b><span>Ages ${esc(agesText(r.programme) || '-')} · ${esc(r.programme.format)} ${stars(r.programme.rating)}</span></div>`).join('') : '<p class="faint">Nothing similar yet.</p>'}</div>
        <div class="panel"><button class="btn danger-text full" id="delBtn">Delete programme</button></div>
      </aside>
    </div>`;
  bindOpen($('.side'));
  $('#back').onclick = e => { e.preventDefault(); go('catalog'); };
  $('#editBtn').onclick = () => go('edit', p.id, { tab: 'overview' });
  $$('[data-edit-tab]').forEach(b => b.onclick = () => go('edit', p.id, { tab: b.dataset.editTab }));
  $('#exportBtn').onclick = () => exportMenu(p);
  $('#shareBtn').onclick = () => shareDialog([p.id]);
  $('#dupBtn').onclick = async () => {
    const { id, createdAt, updatedAt, ...rest } = p;
    const saved = await api.upsert('programmes', { ...rest, title: p.title + ' (copy)', status: 'draft', rating: 0 });
    await reload(); toast('Duplicated'); go('edit', saved.id, { tab: 'overview' });
  };
  $('#delBtn').onclick = async () => {
    if (!(await confirmBox('Delete this programme?', `"${p.title}" will be permanently removed.`, 'Delete', true))) return;
    await api.remove('programmes', p.id); await reload(); toast('Programme deleted'); go('catalog');
  };
  $('#aiImprove').onclick = () => {
    go('edit', p.id, { tab: 'overview' }).then(() => {
      S.aiHidden = false; S.chat.draft = `Review this programme and suggest specific improvements to engagement, inclusion, session flow and safeguarding.`; render();
    });
  };
  $('#aiVariants').onclick = () => {
    go('create').then(() => {
      S.wiz.brief = { ageGroup: (p.ageGroups || [])[0] || '', format: '', duration: p.duration, interests: (p.themes || []).join(', '), goals: `A fresh variation on "${p.title}": ${p.summary}`, constraints: p.budget ? 'Budget ' + p.budget : '' };
      S.wiz.mode = 'ai'; renderWizard();
    });
  };
}

// ---------- Form building blocks (shared by Create and Edit) ----------
// The fields follow the Youth Programme Planning Form, section by section.
function field(label, input, { help = '', req = false, forId = '' } = {}) {
  return `<div class="field">
    <label class="label" ${forId ? `for="${forId}"` : ''}>${label}${req ? ' <span class="req">Required</span>' : ''}</label>
    ${help ? `<div class="help">${help}</div>` : ''}${input}</div>`;
}
function pills(name, list, val, helpMap) {
  return `<div class="pills" role="radiogroup" data-pills="${name}">${list.map(v => `<button type="button" role="radio" aria-checked="${v === val}" class="pill-opt ${v === val ? 'on' : ''}" data-v="${esc(v)}">${esc(v)}${helpMap ? `<small>${esc(helpMap[v])}</small>` : ''}</button>`).join('')}</div>`;
}
// One answer from a list, optionally with an "Other" box. Click a chosen option again to clear it.
function choice(name, list, val, other) {
  const isOther = other && val && !list.includes(val);
  return `<div class="pills" role="radiogroup" data-choice="${name}">${list.map(v => `<button type="button" role="radio" aria-checked="${v === val}" class="pill-opt ${v === val ? 'on' : ''}" data-v="${esc(v)}">${esc(v)}</button>`).join('')}
    ${other ? `<button type="button" role="radio" aria-checked="${!!isOther}" class="pill-opt ${isOther ? 'on' : ''}" data-v="" data-other>Other…</button>` : ''}</div>
    ${other ? `<input type="text" class="other-input ${isOther ? '' : 'hidden'}" data-other-for="${name}" placeholder="Type your own" value="${isOther ? esc(val) : ''}">` : ''}`;
}
const text = (bind, ph, cls = 'mid') => `<textarea class="${cls}" id="f-${bind}" data-bind="${bind}" placeholder="${esc(ph)}">`;
const area = (p, bind, ph, cls) => `${text(bind, ph, cls)}${esc(p[bind])}</textarea>`;
const input = (p, bind, ph) => `<input type="text" id="f-${bind}" data-bind="${bind}" placeholder="${esc(ph)}" value="${esc(p[bind])}">`;
const linesArea = (p, bind, ph, cls = 'tall') => `<textarea class="${cls}" id="f-${bind}" data-bind-lines="${bind}" placeholder="${esc(ph)}">${esc((p[bind] || []).join('\n'))}</textarea>`;
const sub = (t, req) => `<h3 class="form-sub">${t}${req ? ' <span class="req">Required</span>' : ''}</h3>`;

// Tick-box groups ("select all that apply") and pick-list dropdowns, rendered by mountForm.
const CHECKS = {
  ageGroups: { list: PForm.AGE_GROUPS, hints: PForm.AGE_HINTS },
  competencies: { list: PForm.COMPETENCIES },
  icePurposes: { list: PForm.ICE_PURPOSES, other: true },
  involvement: { list: PForm.INVOLVEMENT, other: true },
  mfObjectives: { list: PForm.MF_OBJECTIVES, other: true },
  mfTypes: { list: PForm.MF_TYPES, other: true },
  mfWhen: { list: PForm.MF_WHEN },
  feedbackMethods: { list: PForm.FEEDBACK, other: true },
  indicators: { list: PForm.INDICATORS, other: true },
};
const PICKS = {
  risks: { placeholder: 'Choose potential risks', groups: () => PForm.RISKS.map(g => ({ group: g.group, items: g.items.map(i => i.label) })) },
  mitigations: { placeholder: 'Choose safety measures', groups: p => {
    const sug = PForm.mitigationsFor(p.risks);
    return (sug.length ? [{ group: 'Suggested for your risks', items: sug }] : []).concat(PForm.MITIGATIONS.map(g => ({ group: g.group, items: g.items.filter(i => !sug.includes(i)) })));
  } },
  psychSafety: { placeholder: 'Choose safety practices', groups: () => [{ group: '', items: PForm.PSYCH }] },
  bestPractices: { placeholder: 'Choose facilitation practices', groups: () => [{ group: '', items: PForm.BEST_PRACTICES }] },
};
const checks = name => `<div data-checks="${name}"></div>`;
const pick = name => `<div data-pick="${name}"></div>`;

const SECTIONS = {
  overview: { label: 'Overview', num: 1, intro: 'The basics of the programme: what, when, where and who it is for.', html: p => `
    ${field('Programme title', `<input type="text" id="f-title" class="big" data-bind="title" placeholder="e.g. Bathing with Nature: A Forest Walk Experience" value="${esc(p.title)}">`, { req: true, forId: 'f-title' })}
    ${field('Short description', area(p, 'summary', 'What is the programme, who is it for, and what will they get out of it?'), { forId: 'f-summary', help: 'Two or three sentences. Shown in the catalog.' })}
    ${field('Objectives', linesArea(p, 'objectives', 'Learn to calm down before reacting\nPractise starting a conversation\nWork as part of a team'), { forId: 'f-objectives', help: 'What the activity aims to achieve. One objective per line.' })}
    <div class="grid3">
      ${field('Date', input(p, 'date', 'e.g. Sat 14 Mar 2026'), { forId: 'f-date' })}
      ${field('Time', input(p, 'time', 'e.g. 2-5pm'), { forId: 'f-time' })}
      ${field('Location', input(p, 'location', 'e.g. Brahm Centre, Simei'), { forId: 'f-location' })}
    </div>
    ${field('Target age group', checks('ageGroups'), { help: 'Tick every age group the programme is for.' })}
    ${field('Programme format', choice('format', PForm.FORMATS, p.format))}
    ${field('Session duration (per session)', choice('sessionLength', PForm.SESSION_LENGTHS, p.sessionLength, true))}
    ${field('Intended setting', choice('setting', PForm.SETTINGS, p.setting, true))}
    <div class="grid2">
      ${field('Facilitator(s) name and role', input(p, 'facilitators', 'e.g. Jamie Tan (lead), 2 volunteers'), { forId: 'f-facilitators' })}
      ${field('Group size', input(p, 'groupSize', 'e.g. 15-20 youths'), { forId: 'f-groupSize' })}
    </div>
    ${field('Tags', `<div data-tags></div>`, { help: 'Topics such as <i>music</i>, <i>cooking</i> or <i>nature</i>. They power search and recommendations.' })}` },
  logistics: { label: 'Logistics', num: '1.2', intro: 'What you need to run it, and what it costs.', html: p => `
    ${field('Materials', linesArea(p, 'materials', 'Flipchart paper and markers\nName tags\nFirst aid kit'), { forId: 'f-materials', help: 'One item per line.' })}
    <div class="grid2">
      ${field('Attire', input(p, 'attire', 'e.g. Comfortable clothes, covered shoes'), { forId: 'f-attire' })}
      ${field('Equipment', input(p, 'equipment', 'e.g. Speaker, projector'), { forId: 'f-equipment' })}
    </div>
    <div class="grid3">
      ${field('Meeting location', input(p, 'meetingPoint', 'If different from the venue'), { forId: 'f-meetingPoint' })}
      ${field('Transportation', input(p, 'transport', 'e.g. Public transport'), { forId: 'f-transport' })}
      ${field('Food and beverages', input(p, 'food', 'e.g. Light snacks, water'), { forId: 'f-food' })}
    </div>
    ${field('Itemised budget', area(p, 'budgetItems', 'Snacks: S$40\nCraft materials: S$60\nPrizes: S$30'), { forId: 'f-budgetItems', help: 'One item and cost per line.' })}
    ${field('Total estimated cost', input(p, 'budget', 'e.g. S$130'), { forId: 'f-budget' })}` },
  purpose: { label: 'Purpose', title: 'Youth need & core competencies', num: '2-3', mandatory: true, intro: 'Why this programme matters, and which core competencies it builds.', html: p => `
    ${sub('Core youth need addressed')}
    ${field('Primary challenge this programme responds to', area(p, 'youthNeed', 'e.g. Exam stress and poor coping habits'), { forId: 'f-youthNeed' })}
    ${field('Why this matters for this age group', area(p, 'whyItMatters', 'e.g. Secondary students face national exams and often bottle up stress'), { forId: 'f-whyItMatters' })}
    ${sub('Core competencies targeted', true)}
    ${field('Competencies this programme aims to develop', checks('competencies'), { help: 'Tick at least one.' })}
    ${field('Primary competency focus', `<div data-primary></div>`)}
    ${field('How this programme builds the selected competencies', area(p, 'competencyHow', 'e.g. The breathing exercise before each challenge helps youths pause before reacting'), { forId: 'f-competencyHow' })}` },
  icebreaker: { label: 'Icebreaker', num: 4, mandatory: true, intro: 'Every programme opens with an icebreaker for social bonding.', html: p => `
    ${field('Icebreaker activity name', input(p, 'iceName', 'e.g. Two Truths and a Lie'), { forId: 'f-iceName', req: true })}
    ${field('Purpose of the icebreaker', checks('icePurposes'), { help: 'Tick all that apply.' })}
    ${field('Time allocated', choice('iceTime', PForm.ICE_TIMES, p.iceTime, true))}
    ${field('How the icebreaker works (step by step)', area(p, 'iceSteps', '1. Everyone stands in a circle\n2. …', 'tall'), { forId: 'f-iceSteps' })}
    ${field('Why this icebreaker suits this age group', area(p, 'iceWhy', 'e.g. Low pressure, everyone speaks once, no one is put on the spot'), { forId: 'f-iceWhy' })}` },
  activities: { label: 'Activities', num: 5, intro: 'The main activities and how the programme flows.', html: p => `
    ${field('Main activities planned (in sequence)', area(p, 'mainActivities', 'List the key activities and their purpose', 'tall'), { forId: 'f-mainActivities' })}
    ${field('How youths are actively involved', checks('involvement'), { help: 'Tick all that apply.' })}
    ${field('More about how they take part', area(p, 'involvementNotes', 'Optional. e.g. Youths lead the station games in teams of four'), { forId: 'f-involvementNotes' })}
    ${sub('Activity timeline')}
    <div class="section-intro"><p>Break the programme into timed segments a volunteer could follow.</p><button type="button" class="btn ai" data-ai-sessions>Draft the plan with AI</button></div>
    <div data-sessions></div>
    <button type="button" class="btn add-btn" data-add-session>＋ Add a segment</button>` },
  mindfulness: { label: 'Mindfulness', num: 6, mandatory: true, intro: 'Every programme includes an intentional mindfulness moment.', html: p => `
    ${field('Mindfulness objective', checks('mfObjectives'), { help: 'Tick all that apply.', req: true })}
    ${field('Type of mindfulness planned', checks('mfTypes'), { help: 'Tick all that apply.' })}
    ${field('When is mindfulness included?', checks('mfWhen'))}
    ${field('Total time for mindfulness', choice('mfTime', PForm.MF_TIMES, p.mfTime))}
    ${field('How mindfulness is introduced', area(p, 'mfFraming', 'Use everyday, non-clinical language, e.g. "Let\'s take a minute to notice what we can hear"'), { forId: 'f-mfFraming', help: 'Keep it accessible and non-therapeutic.' })}` },
  safety: { label: 'Safety', num: 7, intro: 'Pick from the lists. Choosing a risk adds its usual safety measures, which you can remove. Use "Add your own" for anything not listed.', html: p => `
    ${field('Potential risks', pick('risks'))}
    ${field('Mitigation strategies', pick('mitigations'))}
    ${field('Emergency contacts', `<div data-contacts></div>`, { help: 'Saved contacts appear in the list. Choose "Add a new contact" to save another.' })}
    ${field('Psychological safety', pick('psychSafety'))}
    ${field('Best practices for facilitation', pick('bestPractices'))}
    ${p.riskNotes ? field('Earlier safety notes', area(p, 'riskNotes', '', 'mid'), { forId: 'f-riskNotes', help: 'Written before this form had pick-lists. Move them into the lists above, then clear this box.' }) : ''}` },
  outcomes: { label: 'Outcomes', num: 8, intro: 'What youths should gain, and how you will know.', html: p => `
    ${field('Intended youth outcomes', area(p, 'intendedOutcomes', 'Skills, awareness or confidence youths should gain'), { forId: 'f-intendedOutcomes' })}
    ${field('Success criteria', area(p, 'successCriteria', 'e.g. 80% attend every session; every youth tries one breathing technique'), { forId: 'f-successCriteria' })}
    ${field('How feedback is collected', checks('feedbackMethods'), { help: 'Tick all that apply.' })}
    ${field('Observable indicators of impact', checks('indicators'), { help: 'Tick all that apply.' })}` },
  documents: { label: 'Documents', html: () => `
    <div class="section-intro"><p>Attach a document built from a template, such as a funding proposal or risk assessment.</p></div>
    <div data-docs></div>` },
  notes: { label: 'Status & notes', html: p => `
    ${field('Status', pills('status', STATUSES, p.status, STATUS_HELP), { help: 'Where this programme is up to.' })}
    ${field('Rating', `<div class="rating" data-rating></div>`, { help: 'How well it went, once delivered.' })}
    ${field('Facilitator notes', `<textarea id="f-notes" class="tall" data-bind="notes" placeholder="What worked, what to change next time, ideas for follow-up…">${esc(p.notes)}</textarea>`, { forId: 'f-notes' })}` },
};
const FORM_KEYS = PForm.SECTIONS.map(s => s.key);

function sectionTitle(key) {
  const s = SECTIONS[key];
  return `<div class="form-head"><h2 class="form-title">${s.num ? `<span class="sec-num">Section ${s.num}</span>` : ''}${esc(s.title || s.label)}${s.mandatory ? ' <span class="req">Required</span>' : ''}</h2>${s.intro ? `<p class="sec-intro">${esc(s.intro)}</p>` : ''}</div>`;
}

// Binds every interactive part of a form section to programme p.
function mountForm(root, p, onChange) {
  const changed = () => { S.dirty = true; onChange && onChange(); };
  $$('[data-bind]', root).forEach(el => el.addEventListener('input', () => { p[el.dataset.bind] = el.value; changed(); }));
  $$('[data-bind-lines]', root).forEach(el => el.addEventListener('input', () => { p[el.dataset.bindLines] = lines(el.value); changed(); }));
  $$('[data-pills]', root).forEach(g => $$('.pill-opt', g).forEach(b => b.onclick = () => {
    p[g.dataset.pills] = b.dataset.v;
    $$('.pill-opt', g).forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); });
    changed();
  }));
  $$('[data-choice]', root).forEach(g => {
    const key = g.dataset.choice, other = $(`[data-other-for="${key}"]`, root);
    $$('.pill-opt', g).forEach(b => b.onclick = () => {
      const wasOn = b.classList.contains('on');
      $$('.pill-opt', g).forEach(x => { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); });
      if (!wasOn) { b.classList.add('on'); b.setAttribute('aria-checked', 'true'); }
      if (b.hasAttribute('data-other')) {
        other.classList.toggle('hidden', wasOn);
        p[key] = wasOn ? '' : other.value.trim();
        if (!wasOn) other.focus();
      } else {
        if (other) other.classList.add('hidden');
        p[key] = wasOn ? '' : b.dataset.v;
      }
      changed();
    });
    if (other) other.addEventListener('input', () => { p[key] = other.value.trim(); changed(); });
  });
  const primary = $('[data-primary]', root);
  const renderPrimary = () => {
    if (!primary) return;
    const list = p.competencies || [];
    if (p.primaryCompetency && !list.includes(p.primaryCompetency)) p.primaryCompetency = '';
    primary.innerHTML = list.length
      ? `<select id="f-primary">${opts(list, p.primaryCompetency, 'Choose the main one')}</select>`
      : '<p class="faint small">Tick competencies above first.</p>';
    const sel = $('select', primary); if (sel) sel.onchange = () => { p.primaryCompetency = sel.value; changed(); };
  };
  $$('[data-checks]', root).forEach(box => renderChecks(box, p, box.dataset.checks, () => { changed(); if (box.dataset.checks === 'competencies') renderPrimary(); }));
  renderPrimary();
  const remount = key => { const b = $(`[data-pick="${key}"]`, root); if (b) renderPick(b, p, key, changed, remount); };
  $$('[data-pick]', root).forEach(b => remount(b.dataset.pick));
  const contacts = $('[data-contacts]', root); if (contacts) renderContacts(contacts, p, changed);
  const tags = $('[data-tags]', root); if (tags) renderTagEditor(tags, p, changed);
  const sess = $('[data-sessions]', root); if (sess) renderSessionsEditor(sess, p, changed);
  const add = $('[data-add-session]', root);
  if (add) add.onclick = () => { p.sessions = p.sessions || []; p.sessions.push({ title: '', duration: '', activities: '', materials: '' }); changed(); renderSessionsEditor(sess, p, changed); $$('.session', sess).pop().querySelector('input').focus(); };
  const aiS = $('[data-ai-sessions]', root);
  if (aiS) aiS.onclick = async () => { if (await aiBuildPlan(p, aiS)) { changed(); render(); } };
  const docs = $('[data-docs]', root); if (docs) renderDocsEditor(docs, p, changed);
  const rating = $('[data-rating]', root); if (rating) renderRating(rating, p, changed);
}

// "Tick all that apply" group. Own entries (not in the list) show as extra ticked options.
function renderChecks(box, p, key, changed) {
  const cfg = CHECKS[key], vals = p[key] || (p[key] = []);
  const all = cfg.list.concat(vals.filter(v => !cfg.list.includes(v)));
  box.className = 'checks';
  box.innerHTML = all.map(v => `<button type="button" role="checkbox" aria-checked="${vals.includes(v)}" class="check-opt ${vals.includes(v) ? 'on' : ''} ${cfg.list.includes(v) ? '' : 'own'}" data-v="${esc(v)}"><span class="box" aria-hidden="true"></span><span>${esc(v)}${cfg.hints && cfg.hints[v] ? `<small>${esc(cfg.hints[v])}</small>` : ''}</span></button>`).join('')
    + (cfg.other ? `<span class="check-add"><input type="text" placeholder="Other…" aria-label="Add your own"><button type="button" class="btn small">Add</button></span>` : '');
  $$('.check-opt', box).forEach(b => b.onclick = () => {
    const v = b.dataset.v, i = vals.indexOf(v);
    if (i >= 0) vals.splice(i, 1); else vals.push(v);
    if (cfg.list.includes(v) || i < 0) { b.classList.toggle('on', i < 0); b.setAttribute('aria-checked', i < 0); } else renderChecks(box, p, key, changed);
    changed();
  });
  const inp = $('.check-add input', box);
  if (inp) {
    const addOwn = () => { const v = inp.value.trim(); if (!v) return; if (!vals.includes(v)) vals.push(v); changed(); renderChecks(box, p, key, changed); $('.check-add input', box).focus(); };
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addOwn(); } };
    $('.check-add .btn', box).onclick = addOwn;
  }
}

// Click-to-open dropdown with grouped tick options, a search box and "Add your own".
function renderPick(box, p, key, changed, remount) {
  const cfg = PICKS[key], vals = p[key] || (p[key] = []);
  const wasOpen = box.querySelector('.ms-pop:not(.hidden)'), q = wasOpen ? $('.ms-q', box).value : '';
  box.innerHTML = `<div class="ms">
      <button type="button" class="ms-btn" aria-haspopup="listbox" aria-expanded="${!!wasOpen}"><span>${vals.length ? `${vals.length} selected` : esc(cfg.placeholder)}</span><span class="ms-caret">▾</span></button>
      <div class="ms-pop ${wasOpen ? '' : 'hidden'}" role="listbox" aria-multiselectable="true">
        <input type="search" class="ms-q" placeholder="Search the list" value="${esc(q)}">
        <div class="ms-list"></div>
        <div class="ms-own"><input type="text" placeholder="Add your own…"><button type="button" class="btn small">Add</button></div>
      </div></div>
    <div class="ms-chips">${vals.map((v, i) => `<span class="ms-chip">${esc(v)}<button type="button" data-rm="${i}" aria-label="Remove ${esc(v)}">✕</button></span>`).join('')}</div>`;
  const pop = $('.ms-pop', box), list = $('.ms-list', box), qIn = $('.ms-q', box);
  const toggle = (v, on) => {
    const i = vals.indexOf(v);
    if (on && i < 0) vals.push(v); if (!on && i >= 0) vals.splice(i, 1);
    if (key === 'risks' && on) {
      const add = PForm.mitigationsFor([v]).filter(m => !p.mitigations.includes(m));
      if (add.length) { p.mitigations.push(...add); toast(`Added ${add.length} matching safety measure${add.length === 1 ? '' : 's'}`); }
      remount('mitigations');
    }
    changed();
  };
  const drawList = () => {
    const f = qIn.value.trim().toLowerCase();
    const groups = cfg.groups(p).map(g => ({ ...g, items: g.items.filter(i => !f || i.toLowerCase().includes(f)) })).filter(g => g.items.length);
    const own = vals.filter(v => !cfg.groups(p).some(g => g.items.includes(v)) && (!f || v.toLowerCase().includes(f)));
    if (own.length) groups.push({ group: 'Your own', items: own });
    list.innerHTML = groups.length ? groups.map(g => `${g.group ? `<div class="ms-group">${esc(g.group)}</div>` : ''}${g.items.map(v => `<label class="ms-opt"><input type="checkbox" value="${esc(v)}" ${vals.includes(v) ? 'checked' : ''}><span>${esc(v)}</span></label>`).join('')}`).join('')
      : '<div class="faint small ms-none">Nothing matches. Add it as your own below.</div>';
    $$('input', list).forEach(c => c.onchange = () => { toggle(c.value, c.checked); refresh(); });
  };
  const refresh = () => {
    $('.ms-btn span', box).textContent = vals.length ? `${vals.length} selected` : cfg.placeholder;
    $('.ms-chips', box).innerHTML = vals.map((v, i) => `<span class="ms-chip">${esc(v)}<button type="button" data-rm="${i}" aria-label="Remove ${esc(v)}">✕</button></span>`).join('');
    bindChips();
  };
  const bindChips = () => $$('[data-rm]', box).forEach(b => b.onclick = () => { toggle(vals[+b.dataset.rm], false); refresh(); drawList(); });
  const open = on => { $$('.ms-pop').forEach(x => { if (x !== pop) { x.classList.add('hidden'); x.previousElementSibling.setAttribute('aria-expanded', 'false'); } }); pop.classList.toggle('hidden', !on); $('.ms-btn', box).setAttribute('aria-expanded', on); if (on) { drawList(); qIn.focus(); } };
  $('.ms-btn', box).onclick = () => open(pop.classList.contains('hidden'));
  qIn.oninput = drawList;
  const ownIn = $('.ms-own input', box);
  const addOwn = () => { const v = ownIn.value.trim(); if (!v) return; ownIn.value = ''; if (!vals.includes(v)) toggle(v, true); refresh(); drawList(); };
  ownIn.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addOwn(); } };
  $('.ms-own .btn', box).onclick = addOwn;
  bindChips();
  if (wasOpen) drawList();
}
// Close any open pick-list when clicking elsewhere.
document.addEventListener('mousedown', e => {
  $$('.ms-pop:not(.hidden)').forEach(pop => { if (!pop.parentElement.contains(e.target)) { pop.classList.add('hidden'); pop.previousElementSibling.setAttribute('aria-expanded', 'false'); } });
});

// Emergency contacts: chosen from saved contacts, or added once and saved for next time.
function knownContacts() {
  const all = [...(S.settings.contacts || []), ...S.programmes.flatMap(p => p.contacts || [])];
  const seen = new Set();
  return all.filter(c => { const k = (c.name + '|' + c.phone).toLowerCase(); if (!c.name || seen.has(k)) return false; seen.add(k); return true; });
}
function renderContacts(box, p, changed) {
  const known = knownContacts();
  const label = c => c.name + (c.phone ? ' · ' + c.phone : '');
  box.innerHTML = [0, 1].map(i => {
    const cur = p.contacts[i];
    const idx = cur ? known.findIndex(c => c.name === cur.name && c.phone === cur.phone) : -1;
    return `<div class="contact-row"><span class="faint small">Contact person ${i + 1}</span>
      <select data-contact="${i}"><option value="">Choose a contact</option>${known.map((c, k) => `<option value="${k}" ${k === idx ? 'selected' : ''}>${esc(label(c))}</option>`).join('')}<option value="new">＋ Add a new contact…</option></select></div>`;
  }).join('');
  $$('[data-contact]', box).forEach(sel => sel.onchange = () => {
    const i = +sel.dataset.contact;
    if (sel.value === 'new') {
      modal(`<h2>Add an emergency contact</h2>
        ${field('Name and role', '<input type="text" id="cName" placeholder="e.g. Ms Lim (centre manager)">', { forId: 'cName' })}
        ${field('Phone number', '<input type="text" id="cPhone" placeholder="e.g. 9123 4567">', { forId: 'cPhone' })}
        <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="cSave">Save contact</button></div>`, (m, close) => {
        $('#cName', m).focus();
        $('[data-close]', m).addEventListener('click', () => renderContacts(box, p, changed));
        $('#cSave', m).onclick = async () => {
          const c = { name: $('#cName', m).value.trim(), phone: $('#cPhone', m).value.trim() };
          if (!c.name) { toast('Add a name first.', true); return; }
          S.settings = await api.setSettings({ contacts: [...(S.settings.contacts || []), c] });
          p.contacts[i] = c; p.contacts = p.contacts.filter(Boolean); changed(); close(); renderContacts(box, p, changed);
        };
      });
      return;
    }
    if (sel.value === '') p.contacts.splice(i, 1); else p.contacts[i] = { ...known[+sel.value] };
    p.contacts = p.contacts.filter(Boolean);
    changed(); renderContacts(box, p, changed);
  });
}

function renderTagEditor(box, p, changed) {
  p.themes = p.themes || [];
  const suggestions = PSearch.allThemes(S.programmes).filter(t => !p.themes.includes(t)).slice(0, 10);
  box.innerHTML = `
    <div class="tag-editor">
      <div class="tag-list">${p.themes.length ? p.themes.map((t, i) => `<span class="tag big">${esc(t)}<button type="button" class="tag-x" data-rm="${i}" aria-label="Remove ${esc(t)}">✕</button></span>`).join('') : '<span class="faint">No tags yet</span>'}</div>
      <div class="tag-add"><input type="text" id="tagInput" placeholder="Type a tag, e.g. music"><button type="button" class="btn" id="tagAdd">Add tag</button></div>
      ${suggestions.length ? `<div class="tag-suggest"><span class="faint">Suggestions:</span>${suggestions.map(t => `<button type="button" class="chip" data-sug="${esc(t)}">＋ ${esc(t)}</button>`).join('')}</div>` : ''}
    </div>`;
  const add = v => {
    v.split(',').map(x => x.trim().toLowerCase()).filter(Boolean).forEach(t => { if (!p.themes.includes(t)) p.themes.push(t); });
    changed(); renderTagEditor(box, p, changed); $('#tagInput', box).focus();
  };
  $('#tagInput', box).onkeydown = e => { if (e.key === 'Enter' && e.target.value.trim()) { e.preventDefault(); add(e.target.value); } };
  $('#tagAdd', box).onclick = () => { const v = $('#tagInput', box).value; if (v.trim()) add(v); };
  $$('[data-sug]', box).forEach(b => b.onclick = () => add(b.dataset.sug));
  $$('[data-rm]', box).forEach(b => b.onclick = () => { p.themes.splice(+b.dataset.rm, 1); changed(); renderTagEditor(box, p, changed); });
}

function renderSessionsEditor(box, p, changed) {
  const list = p.sessions || (p.sessions = []);
  box.innerHTML = list.length ? list.map((s, i) => `
    <div class="session" data-i="${i}">
      <div class="session-top"><span class="num">${i + 1}</span><b>Session ${i + 1}</b><div class="spacer"></div>
        <button type="button" class="btn ghost small" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑ Up</button>
        <button type="button" class="btn ghost small" data-act="down" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Move down">↓ Down</button>
        <button type="button" class="btn ghost small danger-text" data-act="del">Remove</button></div>
      <div class="grid-title">
        ${field('Session title', `<input type="text" data-f="title" placeholder="e.g. Kick-off and team building" value="${esc(s.title)}">`)}
        ${field('Length', `<input type="text" data-f="duration" placeholder="e.g. 90 min" value="${esc(s.duration)}">`)}
      </div>
      ${field('What happens (run-sheet)', `<textarea class="tall" data-f="activities" placeholder="0-10 min: Welcome circle&#10;10-25 min: Warm-up game&#10;25-70 min: Main activity…">${esc(s.activities)}</textarea>`, { help: 'Timed steps a volunteer could follow.' })}
      ${field('Materials for this session', `<input type="text" data-f="materials" placeholder="e.g. Name badges, flipchart, markers" value="${esc(s.materials)}">`)}
    </div>`).join('') : '<div class="empty small">No sessions yet. Add one below, or let AI draft the whole plan.</div>';
  $$('.session', box).forEach(el => {
    const i = +el.dataset.i;
    $$('[data-f]', el).forEach(inp => inp.addEventListener('input', () => { list[i][inp.dataset.f] = inp.value; changed(); }));
    $$('[data-act]', el).forEach(b => b.onclick = () => {
      const a = b.dataset.act;
      if (a === 'del') list.splice(i, 1);
      if (a === 'up' && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
      if (a === 'down' && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
      changed(); renderSessionsEditor(box, p, changed);
    });
  });
}

function renderDocsEditor(box, p, changed) {
  const docs = p.document || (p.document = []);
  const tpl = p.templateId && S.templates.find(t => t.id === p.templateId);
  box.innerHTML = docs.length ? `
    <div class="doc-head"><b>${esc(tpl ? tpl.name : 'Document')}</b>
      <div class="spacer"></div>
      <button type="button" class="btn ai small" id="aiFillDoc">Complete with AI</button>
      ${p.id ? '<button type="button" class="btn small" id="exportDoc">Export</button>' : ''}
      <button type="button" class="btn ghost small danger-text" id="clearDoc">Remove</button></div>
    ${docs.map((d, i) => field(esc(d.heading), `<textarea class="tall" data-doc="${i}">${esc(d.content)}</textarea>`)).join('')}`
    : `<div class="empty small">No document yet.<div style="margin-top:10px"><button type="button" class="btn primary" id="applyTpl">Choose a template</button></div></div>`;
  $$('[data-doc]', box).forEach(t => t.addEventListener('input', () => { docs[+t.dataset.doc].content = t.value; changed(); }));
  const ap = $('#applyTpl', box); if (ap) ap.onclick = () => chooseTemplate(p, () => { changed(); renderDocsEditor(box, p, changed); });
  const ai = $('#aiFillDoc', box); if (ai) ai.onclick = async () => { if (await aiFillDocument(p, ai)) { changed(); renderDocsEditor(box, p, changed); } };
  const ex = $('#exportDoc', box); if (ex) ex.onclick = () => exportDocumentMenu(p);
  const cl = $('#clearDoc', box); if (cl) cl.onclick = () => { p.document = []; p.templateId = null; changed(); renderDocsEditor(box, p, changed); };
}

function renderRating(box, p, changed) {
  box.innerHTML = [1, 2, 3, 4, 5].map(n => `<button type="button" class="${n <= (p.rating || 0) ? 'on' : ''}" data-n="${n}" aria-label="${n} stars">★</button>`).join('') + (p.rating ? ' <button type="button" class="btn ghost small" data-n="0">Clear</button>' : '');
  $$('[data-n]', box).forEach(b => b.onclick = () => { p.rating = +b.dataset.n; changed(); renderRating(box, p, changed); });
}

// ---------- Edit page (per programme, tabbed) ----------
function viewEdit() {
  if (!S.draft || S.draft.id !== S.id) {
    const src = S.programmes.find(x => x.id === S.id);
    if (!src) return go('catalog');
    S.draft = PForm.normalize(clone(src));
  }
  const p = S.draft;
  if (!SECTIONS[S.tab]) S.tab = 'overview';
  main().innerHTML = `
    <div class="crumbs"><a href="#" id="back">← ${esc(p.title || 'Programme')}</a></div>
    ${header('Edit programme', esc(p.title), S.aiHidden ? '<button class="btn ai" id="aiOpen">AI helper</button>' : '')}
    <div class="tabs" role="tablist">${Object.entries(SECTIONS).map(([k, s]) => `<button role="tab" aria-selected="${k === S.tab}" class="tab ${k === S.tab ? 'on' : ''}" data-tab="${k}">${s.num ? `<span class="tab-num">${s.num}</span>` : ''}${esc(s.label)}${s.mandatory ? '<span class="tab-req" title="Required">*</span>' : ''}</button>`).join('')}</div>
    <div class="with-ai ${S.aiHidden ? 'ai-off' : ''}"><div class="wiz-main">
    <div class="form-card" id="form">${SECTIONS[S.tab].num ? sectionTitle(S.tab) : ''}${SECTIONS[S.tab].html(p)}</div>
    <div class="savebar"><span class="faint" id="saveState">All changes saved</span><div class="spacer"></div>
      <button class="btn" id="cancel">Cancel</button><button class="btn primary" id="save">Save changes</button></div>
    </div>${S.aiHidden ? '' : aiPanelHtml()}</div>`;
  const state = () => { $('#saveState').textContent = S.dirty ? 'Unsaved changes' : 'All changes saved'; };
  mountForm($('#form'), p, state);
  $$('[data-tab]').forEach(t => t.onclick = () => { S.tab = t.dataset.tab; const d = S.dirty; render(); S.dirty = d; state(); });
  $('#back').onclick = e => { e.preventDefault(); go('programme', p.id); };
  $('#cancel').onclick = () => go('programme', p.id);
  $('#save').onclick = saveDraft;
  if ($('#aiOpen')) $('#aiOpen').onclick = () => { S.aiHidden = false; const d = S.dirty; render(); S.dirty = d; };
  mountAiPanel(() => S.draft, 'edit', text => { p.notes = (p.notes ? p.notes + '\n\n' : '') + text; S.dirty = true; state(); });
  state();
}

async function saveDraft() {
  const p = S.draft;
  if (!p.title.trim()) { toast('Add a programme name first (Basics tab).', true); return; }
  await api.upsert('programmes', p);
  await reload();
  S.dirty = false;
  toast('Changes saved');
  go('programme', p.id);
}

// ---------- Create (step by step) ----------
const WIZ_STEPS = [{ key: 'start', label: 'Start' }, ...FORM_KEYS.map(k => ({ key: k, label: SECTIONS[k].label, mandatory: SECTIONS[k].mandatory })), { key: 'review', label: 'Review & save' }];

function viewCreate() {
  if (!S.wiz) S.wiz = { step: 0, p: newProgramme(), mode: null, ideas: null, brief: { ageGroup: '', format: '', duration: '', interests: '', goals: '', constraints: '' } };
  renderWizard();
}

function renderWizard() {
  const W = S.wiz;
  W.p = PForm.normalize(W.p);
  const step = WIZ_STEPS[W.step];
  main().innerHTML = `
    ${header('Create a programme', 'Work through each step. You can go back at any time, and nothing is saved until the last step.')}
    <ol class="stepper">${WIZ_STEPS.map((s, i) => `<li class="${i === W.step ? 'on' : i < W.step ? 'done' : ''}"><button type="button" data-step="${i}" ${i > W.step && !W.p.title ? 'disabled' : ''}><span class="sn">${i < W.step ? '✓' : i + 1}</span>${esc(s.label)}${s.mandatory ? '<span class="tab-req" title="Required">*</span>' : ''}</button></li>`).join('')}</ol>
    <div class="with-ai ${S.aiHidden ? 'ai-off' : ''}"><div class="wiz-main">
    <div class="form-card" id="form"></div>
    <div class="savebar ${W.step === 0 ? 'hidden' : ''}">
      ${W.step > 0 ? '<button class="btn" id="prev">← Back</button>' : ''}
      <div class="spacer"></div>
      ${W.step > 0 && W.step < WIZ_STEPS.length - 1 ? '<button class="btn primary" id="next">Next: ' + esc(WIZ_STEPS[W.step + 1].label) + ' →</button>' : ''}
      ${W.step === WIZ_STEPS.length - 1 ? '<button class="btn primary" id="saveNew">Save programme</button>' : ''}
    </div></div>${aiPanelHtml()}</div>`;
  const form = $('#form');
  if (step.key === 'start') renderStart(form);
  else if (step.key === 'review') renderReview(form);
  else { form.innerHTML = sectionTitle(step.key) + SECTIONS[step.key].html(W.p); mountForm(form, W.p); }
  $$('[data-step]').forEach(b => b.onclick = () => gotoStep(+b.dataset.step));
  if ($('#prev')) $('#prev').onclick = () => gotoStep(W.step - 1);
  if ($('#next')) $('#next').onclick = () => gotoStep(W.step + 1);
  if ($('#saveNew')) $('#saveNew').onclick = saveNew;
  mountAiPanel(() => S.wiz && S.wiz.p, step.key, text => { const p = S.wiz.p; p.notes = (p.notes ? p.notes + '\n\n' : '') + text; S.dirty = true; });
}

function gotoStep(n) {
  const W = S.wiz;
  if (n > 1 && !W.p.title.trim()) { toast('Give your programme a name first.', true); W.step = 1; renderWizard(); $('#f-title').focus(); return; }
  W.step = Math.max(0, Math.min(WIZ_STEPS.length - 1, n));
  renderWizard();
  main().scrollTop = 0;
}

function renderStart(form) {
  const W = S.wiz, b = W.brief;
  form.innerHTML = `
    <h2 class="form-title">How would you like to start?</h2>
    <div class="start-grid">
      <button type="button" class="start-opt ${W.mode === 'blank' ? 'on' : ''}" data-mode="blank"><b>Start from scratch</b><span>Fill in each step yourself.</span></button>
      <button type="button" class="start-opt ${W.mode === 'ai' ? 'on' : ''}" data-mode="ai"><b>Get ideas from AI</b><span>Describe your group and get programme ideas to build on.</span></button>
      <button type="button" class="start-opt ${W.mode === 'copy' ? 'on' : ''}" data-mode="copy"><b>Copy an existing programme</b><span>Reuse one from your catalog as a starting point.</span></button>
      <button type="button" class="start-opt ${W.mode === 'template' ? 'on' : ''}" data-mode="template"><b>Use a template</b><span>Attach a document such as a programme plan or proposal.</span></button>
    </div>
    <div id="startDetail"></div>`;
  $$('[data-mode]', form).forEach(x => x.onclick = () => { W.mode = x.dataset.mode; if (W.mode === 'blank') gotoStep(1); else renderStart(form); });
  const d = $('#startDetail', form);
  if (W.mode === 'copy') {
    d.innerHTML = `<div class="sub-card">${field('Which programme?', `<select id="copyFrom">${S.programmes.map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('')}</select>`, { forId: 'copyFrom' })}
      <button type="button" class="btn primary" id="copyGo">Copy and continue →</button></div>`;
    $('#copyGo', d).onclick = () => {
      const src = S.programmes.find(p => p.id === $('#copyFrom', d).value);
      const { id, createdAt, updatedAt, ...rest } = clone(src);
      W.p = { ...newProgramme(), ...rest, title: src.title + ' (copy)', status: 'draft', rating: 0 };
      S.dirty = true; gotoStep(1);
    };
  }
  if (W.mode === 'template') {
    d.innerHTML = `<div class="sub-card">${field('Which template?', `<select id="tplFrom">${S.templates.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select>`, { forId: 'tplFrom', help: 'The document is filled in with your programme details at the end.' })}
      <button type="button" class="btn primary" id="tplGo">Use template and continue →</button></div>`;
    $('#tplGo', d).onclick = () => { W.p.templateId = $('#tplFrom', d).value; W.p.document = []; S.dirty = true; gotoStep(1); };
  }
  if (W.mode === 'ai') {
    d.innerHTML = `<div class="sub-card">
      <h3>Tell us about your group</h3>
      ${field('Age group', pills('ageGroup', AGE_GROUPS, b.ageGroup))}
      ${field('Interests and topics', `<input type="text" id="bInterests" data-b="interests" placeholder="e.g. music, coding, outdoors" value="${esc(b.interests)}">`, { forId: 'bInterests', help: 'Separate topics with commas.' })}
      <div class="grid2">
        ${field('Goals or needs', `<textarea class="mid" id="bGoals" data-b="goals" placeholder="What should young people gain? Anything specific about this group?">${esc(b.goals)}</textarea>`, { forId: 'bGoals' })}
        ${field('Practical limits', `<textarea class="mid" id="bCons" data-b="constraints" placeholder="Budget, venue, number of leaders, timing…">${esc(b.constraints)}</textarea>`, { forId: 'bCons' })}
      </div>
      <div class="grid2">
        ${field('Preferred format', `<select id="bFormat" data-b="format">${opts(FORMATS, b.format, 'No preference')}</select>`, { forId: 'bFormat' })}
        ${field('Length', `<input type="text" id="bDur" data-b="duration" placeholder="e.g. 8 weeks" value="${esc(b.duration)}">`, { forId: 'bDur' })}
      </div>
      <button type="button" class="btn ai" id="ideaBtn">Generate ideas</button>
      <div id="libMatches"></div>
      <div id="ideas"></div></div>`;
    $$('[data-b]', d).forEach(el => el.addEventListener('input', () => { b[el.dataset.b] = el.value; }));
    $$('[data-pills="ageGroup"] .pill-opt', d).forEach(x => x.onclick = () => { b.ageGroup = x.dataset.v; $$('[data-pills="ageGroup"] .pill-opt', d).forEach(y => y.classList.toggle('on', y === x)); });
    $('#ideaBtn', d).onclick = e => generateIdeas(e.currentTarget);
    renderIdeas();
  }
}

function briefMatches() {
  const b = S.wiz.brief;
  const text = [b.interests, b.goals, b.format].join(' ');
  return text.trim() || b.ageGroup ? PSearch.recommend(S.programmes, text || b.ageGroup, { ageGroup: b.ageGroup, limit: 3 }) : [];
}

async function generateIdeas(btn) {
  const W = S.wiz, b = W.brief;
  if (!Object.values(b).some(v => String(v).trim())) { toast('Fill in at least one detail about your group.', true); return; }
  const similar = briefMatches().map(r => r.programme);
  const brief = { 'Age group': b.ageGroup || 'any', 'Preferred format': b.format || 'suggest the best fit', Duration: b.duration, 'Interests/themes': b.interests, Goals: b.goals, Constraints: b.constraints };
  $('#ideas').innerHTML = '<div class="loading-panel"><span class="spinner"></span>Coming up with ideas…</div>';
  const ideas = await busy(btn, 'Generating…', () => api.ai.ideate({ brief, similar }));
  W.ideas = ideas || W.ideas; W.lastBrief = brief;
  renderIdeas();
}

function renderIdeas() {
  const W = S.wiz;
  const matches = briefMatches();
  if ($('#libMatches')) $('#libMatches').innerHTML = W.ideas && matches.length ? `<div class="lib-matches"><span class="faint">Already in your catalog:</span> ${matches.map(r => `<a href="#" data-open="${esc(r.programme.id)}">${esc(r.programme.title)}</a>`).join(' · ')}</div>` : '';
  bindOpen($('#libMatches') || document.createElement('div'));
  if (!$('#ideas')) return;
  if (!W.ideas) { $('#ideas').innerHTML = ''; return; }
  $('#ideas').innerHTML = `<div class="cards ideas">${W.ideas.map((d, i) => `
    <div class="idea-card">
      <h3>${esc(d.title)}</h3>
      <div class="hook">${esc(d.hook)}</div>
      <p>${esc(d.summary)}</p>
      <div class="meta"><span>Ages ${esc((d.ageGroups || [d.ageGroup]).filter(Boolean).join(', '))}</span><span>${esc(d.format)}</span><span>${esc(d.duration)}</span></div>
      <div class="why"><b>Why it works:</b> ${esc(d.whyItWorks)}</div>
      <div class="idea-actions">
        <button type="button" class="btn primary small" data-use="${i}">Use this idea</button>
        <button type="button" class="btn ai small" data-full="${i}">Use and draft full plan</button>
      </div>
    </div>`).join('')}</div>`;
  $$('[data-use]').forEach(x => x.onclick = () => { W.p = { ...W.p, ...ideaFields(W.ideas[+x.dataset.use]) }; S.dirty = true; gotoStep(1); toast('Idea added. Review each step and adjust.'); });
  $$('[data-full]').forEach(x => x.onclick = async () => {
    const d = W.ideas[+x.dataset.full];
    const similar = PSearch.recommend(S.programmes, d, { limit: 3 }).map(r => r.programme);
    const full = await busy(x, 'Drafting plan…', () => api.ai.develop({ idea: d, brief: W.lastBrief, similar }));
    if (!full) return;
    W.p = PForm.normalize({ ...W.p, ...full, themes: (full.themes || []).map(t => t.toLowerCase()) });
    S.dirty = true; gotoStep(1); toast('Full plan drafted. Check each step, then save.');
  });
}

function ideaFields(d) {
  return { title: d.title, summary: d.summary, ageGroups: d.ageGroups || (d.ageGroup ? [d.ageGroup] : []), format: d.format, duration: d.duration, themes: (d.themes || []).map(t => t.toLowerCase()), objectives: d.objectives || [], notes: d.whyItWorks ? 'Why it works: ' + d.whyItWorks : '' };
}

function renderReview(form) {
  const p = S.wiz.p;
  const tpl = p.templateId && S.templates.find(t => t.id === p.templateId);
  if (tpl && !(p.document || []).length) p.document = tpl.sections.map(s => ({ heading: s.heading, content: fillPlaceholders(s.content, p) }));
  const req = PForm.missingMandatory(p);
  const missing = [!p.summary && 'short description', !(p.ageGroups || []).length && 'age group', !p.format && 'format', !(p.objectives || []).length && 'objectives', !(p.sessions || []).length && 'activity timeline', !(p.risks || []).length && 'risks'].filter(Boolean);
  form.innerHTML = `
    <h2 class="form-title">Review &amp; save</h2>
    ${req.length ? `<div class="notice warn">Required sections still empty: <b>${req.join(', ')}</b>. The planning form needs these before the programme runs.</div>` : ''}
    ${missing.length ? `<div class="notice">Also not filled in yet: <b>${missing.join(', ')}</b>. You can save now and add them later.</div>` : !req.length ? '<div class="notice ok">Every section is filled in.</div>' : ''}
    ${field('Status', pills('status', STATUSES.slice(0, 3), p.status, STATUS_HELP))}
    <h1 class="review-title">${esc(p.title)}</h1>
    <div class="read">${programmeReadHtml(p)}</div>
    ${tpl ? `<div class="sub-card">${SECTIONS.documents.html()}</div>` : ''}`;
  mountForm(form, p);
}

async function saveNew() {
  const p = S.wiz.p;
  if (!p.title.trim()) { toast('Give your programme a name first.', true); return; }
  const saved = await api.upsert('programmes', p);
  await reload();
  S.dirty = false; S.wiz = null;
  toast('Programme saved to your catalog');
  go('programme', saved.id);
}

// ---------- AI helpers ----------
function stripForAi(p) {
  const { id, createdAt, updatedAt, document, templateId, rating, notes, ...rest } = p;
  return rest;
}

async function aiBuildPlan(p, btn) {
  if (!p.title.trim() && !p.summary.trim()) { toast('Add a name or summary first so AI knows what to plan.', true); return false; }
  if ((p.sessions || []).length && !(await confirmBox('Replace the current sessions?', 'AI will draft a full plan and fill every section of the form, replacing what is there now. Nothing is saved until you save.', 'Draft plan'))) return false;
  const similar = PSearch.recommend(S.programmes, p, { excludeId: p.id, limit: 3 }).map(r => r.programme);
  const result = await busy(btn, 'Drafting plan…', () => api.ai.develop({ idea: stripForAi(p), similar }));
  if (!result) return false;
  const { title, ...rest } = result;
  Object.assign(p, PForm.normalize({ ...p, ...rest, themes: (rest.themes || p.themes || []).map(t => t.toLowerCase()) }));
  toast('Plan drafted. Review it, then save.');
  return true;
}

function fillPlaceholders(text, p) {
  const vals = {
    programme_title: p.title, age_group: agesText(p), format: p.format, duration: p.duration, group_size: p.groupSize,
    objectives: (p.objectives || []).map(o => '- ' + o).join('\n'), summary: p.summary,
    facilitator: S.settings.facilitator, organisation: S.settings.organisation,
    date: new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }),
  };
  return String(text || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => (vals[k] ? vals[k] : m));
}

function chooseTemplate(p, after, presetId) {
  if (!S.templates.length) { toast('No templates yet. Add one on the Templates page.', true); return; }
  modal(`<h2>Choose a template</h2>
    ${field('Template', `<select id="tplSel">${S.templates.map(t => `<option value="${esc(t.id)}" ${t.id === presetId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`, { forId: 'tplSel' })}
    <p class="faint" id="tplDesc"></p>
    <label class="check"><input type="checkbox" id="useAi" ${S.settings.hasApiKey ? 'checked' : ''}> Write the sections with AI using this programme's details</label>
    <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Add document</button></div>`, (m, close) => {
    const desc = () => { const t = S.templates.find(x => x.id === $('#tplSel', m).value); $('#tplDesc', m).textContent = t ? `${t.description} (${t.sections.length} sections)` : ''; };
    $('#tplSel', m).onchange = desc; desc();
    $('#go', m).onclick = async () => {
      const t = S.templates.find(x => x.id === $('#tplSel', m).value);
      const useAi = $('#useAi', m).checked;
      p.templateId = t.id;
      p.document = t.sections.map(s => ({ heading: s.heading, content: fillPlaceholders(s.content, p) }));
      close();
      after();
      if (useAi) { const b = $('#aiFillDoc'); if (await aiFillDocument(p, b)) after(); }
    };
  });
}

async function aiFillDocument(p, btn) {
  const t = S.templates.find(x => x.id === p.templateId);
  const template = t ? { sections: t.sections.map((s, i) => ({ ...s, content: (p.document[i] && p.document[i].content) || s.content })) }
    : { sections: p.document.map(d => ({ heading: d.heading, guidance: '', content: d.content })) };
  const sections = await busy(btn, 'Writing…', () => api.ai.fillTemplate({ template, programme: stripForAi(p) }));
  if (!sections) return false;
  p.document = sections.map(s => ({ heading: s.heading, content: s.content }));
  toast('Document written. Review it, then save.');
  return true;
}

// ---------- Export ----------
function programmeMarkdown(p) {
  const out = [`# ${p.title}`, ''];
  for (const sec of programmeOutline(p)) {
    if (!sec.items.length && !(sec.sessions || []).length) continue;
    out.push(`## ${sec.title}`, '');
    for (const i of sec.items) {
      if (i.list) out.push(`**${i.label}:**`, ...i.v.map(x => `- ${x}`), '');
      else if (i.chips) out.push(`**${i.label}:** ${i.v.join(', ')}  `, '');
      else out.push(`**${i.label}:** ${String(i.v).includes('\n') ? '\n\n' + i.v : i.v}`, '');
    }
    (sec.sessions || []).forEach((x, n) => out.push(`### ${n + 1}. ${x.title}${x.duration ? ` (${x.duration})` : ''}`, '', x.activities || '', x.materials ? `\n*Materials:* ${x.materials}` : '', ''));
  }
  if ((p.document || []).length) { out.push('---', ''); p.document.forEach(d => out.push(`## ${d.heading}`, d.content, '')); }
  return out.join('\n');
}

function programmePrintHtml(p, docOnly) {
  const meta = [agesText(p) && 'Ages ' + esc(agesText(p)), esc(p.format), esc(p.date), esc(p.location)].filter(Boolean).join(' · ');
  const tpl = p.templateId && S.templates.find(t => t.id === p.templateId);
  if (docOnly) return `<h1>${esc(tpl ? tpl.name : 'Document')}: ${esc(p.title)}</h1><div class="pmeta">${meta}</div>` + p.document.map(d => `<h2>${esc(d.heading)}</h2><p>${esc(d.content)}</p>`).join('');
  const val = i => i.list ? `<ul>${i.v.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : i.chips ? esc(i.v.join(', ')) : `<span class="pre">${esc(i.v)}</span>`;
  return `<h1>${esc(p.title)}</h1><div class="pmeta">Youth Programme Planning Form${meta ? ' · ' + meta : ''}</div>
    ${programmeOutline(p).map(sec => `<h2>${esc(sec.title)}</h2>${sec.items.length ? `<table class="ptable">${sec.items.map(i => `<tr><th>${esc(i.label)}</th><td>${val(i)}</td></tr>`).join('')}</table>` : (sec.sessions || []).length ? '' : '<p><i>Not filled in.</i></p>'}
      ${(sec.sessions || []).map((x, n) => `<div class="psession"><b>${n + 1}. ${esc(x.title)}</b>${x.duration ? ` (${esc(x.duration)})` : ''}<p>${esc(x.activities)}</p>${x.materials ? `<p><i>Materials:</i> ${esc(x.materials)}</p>` : ''}</div>`).join('')}`).join('')}
    ${(p.document || []).length ? p.document.map(d => `<h2>${esc(d.heading)}</h2><p>${esc(d.content)}</p>`).join('') : ''}`;
}

const slug = s => (s || 'programme').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

async function exportPdf(p, docOnly) {
  $('#print').innerHTML = programmePrintHtml(p, docOnly);
  try { const f = await api.savePdf(`${slug(p.title)}${docOnly ? '-document' : ''}.pdf`); if (f) toast('Saved PDF'); } catch (e) { toast(e.message, true); }
  $('#print').innerHTML = '';
}

function exportMenu(p) {
  modal(`<h2>Export “${esc(p.title)}”</h2>
    <div class="stack"><button class="btn" id="xPdf">PDF (printable plan)</button><button class="btn" id="xMd">Markdown text file</button></div>
    <div class="foot"><button class="btn" data-close>Close</button></div>`, (m, close) => {
    $('#xPdf', m).onclick = () => { close(); exportPdf(p, false); };
    $('#xMd', m).onclick = async () => { close(); const f = await api.saveText(`${slug(p.title)}.md`, programmeMarkdown(p), 'md'); if (f) toast('Saved'); };
  });
}

function exportDocumentMenu(p) {
  modal(`<h2>Export document</h2><div class="stack"><button class="btn" id="dPdf">PDF</button><button class="btn" id="dMd">Markdown text file</button></div>
      <div class="foot"><button class="btn" data-close>Close</button></div>`, (m, close) => {
    $('#dPdf', m).onclick = () => { close(); exportPdf(p, true); };
    $('#dMd', m).onclick = async () => {
      close();
      const md = [`# ${p.title}`, '', ...p.document.flatMap(d => [`## ${d.heading}`, d.content, ''])].join('\n');
      const f = await api.saveText(`${slug(p.title)}-document.md`, md, 'md'); if (f) toast('Saved');
    };
  });
}

// ---------- Sharing ----------
// A catalog file (.ypcatalog) holds chosen programmes plus the templates their documents use.
function buildCatalog(ids, name, sharedBy, includeNotes) {
  const programmes = S.programmes.filter(p => ids.includes(p.id)).map(p => {
    const c = clone(p);
    if (!includeNotes) { c.notes = ''; c.rating = 0; }
    return c;
  });
  const tplIds = new Set(programmes.map(p => p.templateId).filter(Boolean));
  return {
    type: 'youth-programme-catalog', version: 1, name, sharedBy, createdAt: new Date().toISOString(),
    programmes, templates: S.templates.filter(t => tplIds.has(t.id)).map(clone),
  };
}

function catalogPrintHtml(cat) {
  return `<div class="pcover"><h1>${esc(cat.name)}</h1>
    <div class="pmeta">${cat.sharedBy ? 'Shared by ' + esc(cat.sharedBy) + ' · ' : ''}${fmtDate(cat.createdAt)} · ${cat.programmes.length} programme${cat.programmes.length === 1 ? '' : 's'}</div>
    <h2>Contents</h2><ol>${cat.programmes.map(p => `<li><b>${esc(p.title)}</b> (ages ${esc(agesText(p) || '-')}, ${esc(p.format || '-')})<br>${esc(p.summary)}</li>`).join('')}</ol></div>`
    + cat.programmes.map(p => `<div class="pbreak">${programmePrintHtml(p)}</div>`).join('');
}

function shareDialog(preselect) {
  const st = S.settings;
  const list = S.programmes.slice().sort((a, b) => String(a.title).localeCompare(String(b.title)));
  if (!list.length) { toast('There are no programmes to share yet.', true); return; }
  const sel = new Set(preselect && preselect.length ? preselect : list.map(p => p.id));
  const single = preselect && preselect.length === 1 && S.programmes.find(p => p.id === preselect[0]);
  const defName = single ? single.title : `${st.organisation || 'Our'} programme catalog`;
  modal(`<h2>Share programmes</h2>
    <p class="faint">Creates a catalog file you can send by email, AirDrop, Teams or a shared drive. Colleagues open it in their copy of Youth Programme Studio and choose what to add. For people without the app, save a PDF instead.</p>
    ${field('Catalog name', `<input type="text" id="shName" value="${esc(defName)}">`, { forId: 'shName' })}
    ${field('Shared by', `<input type="text" id="shBy" value="${esc([st.facilitator, st.organisation].filter(Boolean).join(', '))}" placeholder="Your name or organisation">`, { forId: 'shBy' })}
    <div class="field"><div class="label">Programmes to include <span class="count" id="shCount"></span><span class="spacer"></span><button type="button" class="btn ghost small" id="shAll">All</button><button type="button" class="btn ghost small" id="shNone">None</button></div>
      <div class="pick-list">${list.map(p => `<label class="pick"><input type="checkbox" value="${esc(p.id)}" ${sel.has(p.id) ? 'checked' : ''}><span class="pick-main"><b>${esc(p.title || 'Untitled programme')}</b><small>${agesText(p) ? 'Ages ' + esc(agesText(p)) + ' · ' : ''}${esc(p.format || '')}</small></span>${statusBadge(p.status)}</label>`).join('')}</div></div>
    <label class="check"><input type="checkbox" id="shNotes"> Include my private notes and ratings</label>
    <div class="foot"><button class="btn" data-close>Cancel</button><div class="spacer"></div><button class="btn" id="shPdf">Save as PDF</button><button class="btn primary" id="shSave">Save catalog file</button></div>`, (m, close) => {
    const boxes = $$('.pick input', m);
    const chosen = () => boxes.filter(b => b.checked).map(b => b.value);
    const count = () => { $('#shCount', m).textContent = `${chosen().length} selected`; };
    boxes.forEach(b => b.onchange = count); count();
    $('#shAll', m).onclick = () => { boxes.forEach(b => { b.checked = true; }); count(); };
    $('#shNone', m).onclick = () => { boxes.forEach(b => { b.checked = false; }); count(); };
    const make = () => {
      const ids = chosen();
      if (!ids.length) { toast('Pick at least one programme.', true); return null; }
      return buildCatalog(ids, $('#shName', m).value.trim() || defName, $('#shBy', m).value.trim(), $('#shNotes', m).checked);
    };
    $('#shSave', m).onclick = async () => {
      const cat = make(); if (!cat) return;
      close();
      try { const f = await api.shareSave(`${slug(cat.name)}.ypcatalog`, cat); if (f) toast(`Catalog saved with ${cat.programmes.length} programme${cat.programmes.length === 1 ? '' : 's'}. Send the file to share it.`); } catch (e) { toast(e.message, true); }
    };
    $('#shPdf', m).onclick = async () => {
      const cat = make(); if (!cat) return;
      close();
      $('#print').innerHTML = catalogPrintHtml(cat);
      try { const f = await api.savePdf(`${slug(cat.name)}.pdf`); if (f) toast('Saved PDF'); } catch (e) { toast(e.message, true); }
      $('#print').innerHTML = '';
    };
  });
}

async function openShared(fromPending) {
  let cat;
  try { cat = fromPending ? await api.sharePending() : await api.shareOpen(); } catch (e) { toast('Could not open that file: ' + e.message, true); return; }
  if (!cat) return;
  const items = cat.programmes.filter(p => p && typeof p === 'object' && p.title);
  const have = id => S.programmes.find(x => x.id === id);
  modal(`<h2>${esc(cat.name || 'Shared catalog')}</h2>
    <p class="faint">${cat.sharedBy ? 'Shared by <b>' + esc(cat.sharedBy) + '</b> · ' : ''}${cat.createdAt ? fmtDate(cat.createdAt) + ' · ' : ''}${items.length} programme${items.length === 1 ? '' : 's'}. Choose which to add to your catalog.</p>
    <div class="field"><div class="label">Programmes <span class="count" id="opCount"></span><span class="spacer"></span><button type="button" class="btn ghost small" id="opAll">All</button><button type="button" class="btn ghost small" id="opNone">None</button></div>
      <div class="pick-list">${items.map((p, i) => `<label class="pick"><input type="checkbox" value="${i}" ${have(p.id) ? '' : 'checked'}><span class="pick-main"><b>${esc(p.title)}</b><small>${agesText(p) ? 'Ages ' + esc(agesText(p)) + ' · ' : ''}${esc(p.format || '')}${p.summary ? ' · ' + esc(String(p.summary).slice(0, 90)) : ''}</small></span>${have(p.id) ? '<span class="pick-note">Already in your catalog. Tick to replace yours with this version.</span>' : '<span class="pick-new">New</span>'}</label>`).join('')}</div></div>
    <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="opAdd">Add to my catalog</button></div>`, (m, close) => {
    const boxes = $$('.pick input', m);
    const chosen = () => boxes.filter(b => b.checked).map(b => items[+b.value]);
    const count = () => { const n = chosen().length; $('#opCount', m).textContent = `${n} selected`; $('#opAdd', m).textContent = n ? `Add ${n} to my catalog` : 'Add to my catalog'; };
    boxes.forEach(b => b.onchange = count); count();
    $('#opAll', m).onclick = () => { boxes.forEach(b => { b.checked = true; }); count(); };
    $('#opNone', m).onclick = () => { boxes.forEach(b => { b.checked = false; }); count(); };
    $('#opAdd', m).onclick = async () => {
      const pick = chosen();
      if (!pick.length) { toast('Pick at least one programme.', true); return; }
      close();
      const tplIds = new Set(pick.map(p => p.templateId).filter(Boolean));
      for (const t of (cat.templates || []).filter(t => t && tplIds.has(t.id) && !S.templates.some(x => x.id === t.id))) await api.upsert('templates', t);
      for (const p of pick) {
        const { updatedAt, ...rest } = p;
        await api.upsert('programmes', { ...newProgramme(), ...rest, sharedFrom: cat.sharedBy || cat.name || '' });
      }
      await reload();
      toast(`Added ${pick.length} programme${pick.length === 1 ? '' : 's'} to your catalog`);
      S.filters = { q: '', ageGroup: '', format: '', status: '', theme: '' };
      go('catalog');
    };
  });
}

// ---------- Import ----------
// Turns pasted text into a programme without AI: first line is the title, headed sections map to fields.
function parseProgrammeText(text) {
  const p = newProgramme({ status: 'draft' });
  const rows = String(text).replace(/\r/g, '').split('\n');
  const firstIdx = rows.findIndex(l => l.trim());
  if (firstIdx < 0) return p;
  p.title = rows[firstIdx].replace(/^#+\s*/, '').trim().slice(0, 120);
  const map = [[/objective|aim|goal|outcome/i, 'objectives'], [/session|week|day|schedule|plan/i, 'sessions'], [/material|equipment|resource/i, 'materials'], [/risk|safe/i, 'riskNotes'], [/icebreaker/i, 'iceSteps'], [/mindful/i, 'mfFraming'], [/budget|cost/i, 'budget'], [/summary|overview|about|description/i, 'summary']];
  let cur = 'summary'; const buf = {};
  for (const raw of rows.slice(firstIdx + 1)) {
    const l = raw.trim();
    const h = l.match(/^(#{1,4}\s*)?([A-Za-z][A-Za-z &/]{2,40}):?$/);
    if (h && (l.startsWith('#') || l.endsWith(':'))) { const m = map.find(([re]) => re.test(h[2])); if (m) { cur = m[1]; continue; } }
    (buf[cur] = buf[cur] || []).push(raw);
  }
  const txt = k => (buf[k] || []).join('\n').trim();
  p.summary = txt('summary');
  p.objectives = lines(txt('objectives'));
  p.materials = lines(txt('materials'));
  p.riskNotes = txt('riskNotes');
  p.iceSteps = txt('iceSteps');
  p.mfFraming = txt('mfFraming');
  p.budget = txt('budget').split('\n')[0] || '';
  if (txt('sessions')) p.sessions = [{ title: 'Session plan (imported)', duration: '', activities: txt('sessions'), materials: '' }];
  const age = text.match(/\b(10-12|13-16|17-19|20-24|25-34|5-8|9-12|13-15|16-18|18-25)\b/); if (age) p.ageGroups = [age[1]];
  const fmt = text.match(/weekly club|one-off|short series|structured programme|ongoing|camp|workshop|retreat|event/i);
  if (fmt) p.format = { 'one-off': FORMATS[0], 'short series': FORMATS[1], 'structured programme': FORMATS[2], ongoing: FORMATS[3] }[fmt[0].toLowerCase()] || fmt[0].replace(/^./, c => c.toUpperCase());
  return PForm.normalize(p);
}

// Turns pasted text into template sections: markdown headings or lines ending with ":" start a section.
function parseTemplateText(name, text) {
  const sections = []; let cur = null;
  for (const raw of String(text).replace(/\r/g, '').split('\n')) {
    const l = raw.trim();
    const h = l.match(/^#{1,4}\s+(.+)$/) || (l.length < 60 && l.endsWith(':') ? [l, l.slice(0, -1)] : null);
    if (h) { cur = { id: 's' + (sections.length + 1), heading: h[1].trim(), guidance: '', content: '' }; sections.push(cur); continue; }
    if (!cur) { cur = { id: 's1', heading: 'Overview', guidance: '', content: '' }; sections.push(cur); }
    cur.content += (cur.content ? '\n' : '') + raw;
  }
  sections.forEach(s => { s.content = s.content.trim(); });
  return { name: name || 'Imported template', description: 'Imported from text.', category: 'Imported', sections };
}

function viewImport() {
  main().innerHTML = `
    ${header('Import', 'Bring programmes and templates you already have into the app.')}
    <div class="panel share-panel">
      <div><h2>Share with others</h2>
        <p class="faint">Send programmes to colleagues as a catalog file, or open a catalog someone sent you and choose what to add.</p></div>
      <div class="row wrap"><button class="btn primary" id="openShared">Open a shared catalog…</button><button class="btn" id="shareFromImport">⇧ Share programmes…</button></div>
    </div>
    <div class="import-grid">
      <div class="panel">
        <h2>Import a programme</h2>
        <p class="faint">Paste the text of an existing programme plan, or load a text file (.txt or .md). You'll review it before it's saved.</p>
        ${field('Programme text', `<textarea id="impText" class="xtall" placeholder="Paste your programme here. The first line is used as the name.&#10;&#10;Objectives:&#10;- ...&#10;Sessions:&#10;Week 1 ...&#10;Materials:&#10;..."></textarea>`, { forId: 'impText' })}
        <div class="row wrap">
          <label class="btn file-btn">Load a text file<input type="file" id="impFile" accept=".txt,.md,.markdown,text/plain" hidden></label>
          <div class="spacer"></div>
          <button class="btn" id="impPlain">Import as written</button>
          <button class="btn ai" id="impAi">Organise with AI</button>
        </div>
        <p class="faint small">“Organise with AI” sorts your text into sessions, objectives and the other fields. “Import as written” uses headings like <i>Objectives:</i> and <i>Sessions:</i>.</p>
      </div>
      <div class="panel">
        <h2>Import a template</h2>
        <p class="faint">Paste a document you reuse, such as a proposal or risk assessment. Each heading becomes a section.</p>
        ${field('Template name', `<input type="text" id="tplName" placeholder="e.g. Trip consent form">`, { forId: 'tplName' })}
        ${field('Template text', `<textarea id="tplText" class="tall" placeholder="## Purpose&#10;...&#10;## Risks&#10;..."></textarea>`, { forId: 'tplText' })}
        <button class="btn primary" id="tplImport">Create template</button>
      </div>
      <div class="panel">
        <h2>Library backup file</h2>
        <p class="faint">Restore a backup or load a library a colleague exported from this app (.json). Programmes with the same ID are updated; others are added.</p>
        <div class="row wrap"><button class="btn primary" id="libImport">Import library file…</button><button class="btn" id="libExport">Export my library…</button></div>
      </div>
    </div>`;
  $('#impFile').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => { $('#impText').value = r.result; toast(`Loaded ${f.name}`); }; r.readAsText(f);
  };
  const toWizard = p => { S.wiz = { step: 1, p: { ...newProgramme(), ...p }, mode: 'import', ideas: null, brief: {} }; go('create', null, { keepWizard: true }).then(() => { S.dirty = true; toast('Imported. Check each step, then save.'); }); };
  $('#impPlain').onclick = () => { const t = $('#impText').value.trim(); if (!t) return toast('Paste some text first.', true); toWizard(parseProgrammeText(t)); };
  $('#impAi').onclick = async e => {
    const t = $('#impText').value.trim(); if (!t) return toast('Paste some text first.', true);
    const p = await busy(e.currentTarget, 'Organising…', () => api.ai.parseProgramme({ text: t }));
    if (p) toWizard({ ...p, themes: (p.themes || []).map(x => x.toLowerCase()) });
  };
  $('#tplImport').onclick = async () => {
    const t = $('#tplText').value.trim(); if (!t) return toast('Paste the template text first.', true);
    const saved = await api.upsert('templates', parseTemplateText($('#tplName').value.trim(), t));
    await reload(); toast('Template created'); go('template', saved.id);
  };
  $('#libImport').onclick = importLibrary;
  $('#openShared').onclick = () => openShared(false);
  $('#shareFromImport').onclick = () => shareDialog();
  $('#libExport').onclick = exportLibrary;
}

async function exportLibrary() {
  try { const f = await api.exportLibrary(); if (f) toast('Library exported'); } catch (e) { toast(e.message, true); }
}

async function importLibrary() {
  try {
    const n = await api.importLibrary();
    if (n === null || n === undefined) return;
    await reload(); toast(`Imported ${n} items`); render();
  } catch (e) { toast('Import failed: ' + e.message, true); }
}

// ---------- AI helper panel (Create and Edit pages) ----------
// The panel talks to Claude about the programme on screen (S.chat.getFocus) plus the catalog.
function libraryContext() {
  const focus = S.chat.getFocus && S.chat.getFocus();
  const parts = [];
  if (focus && (focus.title || focus.summary)) parts.push('PROGRAMME THE USER IS WORKING ON (unsaved draft, may be incomplete):\n' + JSON.stringify(stripForAi(focus), null, 1));
  parts.push('LIBRARY OVERVIEW:\n' + S.programmes.slice(0, 80).map(p => `- ${p.title} | ages ${agesText(p)} | ${p.format} | ${p.status}${p.rating ? ' | ' + p.rating + '★' : ''} | ${(p.themes || []).join(', ')}`).join('\n'));
  return parts.join('\n\n');
}

const AI_STARTERS = {
  start: ['Suggest 5 programme ideas for shy 13-15 year olds', 'What programmes am I missing?', 'Ideas for a one-off mental wellbeing session'],
  overview: ['Suggest 5 catchier names for this programme', 'Write a 2-3 sentence description', 'Suggest 4 clear objectives'],
  logistics: ['List the materials I will need', 'Estimate an itemised budget', 'What should participants wear?'],
  purpose: ['Which core competencies fit this programme best?', 'Explain why this matters for this age group', 'How does each activity build the chosen competencies?'],
  icebreaker: ['Suggest 5 icebreakers that fit this programme', 'Write step-by-step instructions for my icebreaker', 'Suggest a low-pressure icebreaker for shy youths'],
  activities: ['Suggest a timed run-sheet for this programme', 'How can youths take a more active part?', 'Suggest a closing reflection activity'],
  mindfulness: ['Suggest a 5-minute mindfulness activity for this programme', 'How do I introduce mindfulness without sounding clinical?', 'Where in the programme should mindfulness go?'],
  safety: ['What risks should I plan for?', 'Suggest safety measures for each risk', 'How do I keep personal sharing safe?'],
  outcomes: ['Suggest measurable success criteria', 'Write a short feedback form', 'What outcomes can youths expect?'],
  review: ['Review this programme and suggest improvements', 'Write a short parent/guardian letter', 'How can I make this more inclusive?'],
  edit: ['Review this programme and suggest improvements', 'Suggest ice-breakers for this group', 'What risks should I plan for?'],
};

function aiPanelHtml() {
  if (S.aiHidden) return `<button class="ai-fab" id="aiShow">✦ AI helper</button>`;
  return `<aside class="ai-panel" id="aiPanel" aria-label="AI helper">
    <div class="ai-head"><b>✦ AI helper</b><div class="spacer"></div>
      <button type="button" class="btn ghost small" id="aiClear" title="Start a new conversation">Clear</button>
      <button type="button" class="btn ghost small" id="aiHide" title="Hide the AI helper">Hide</button></div>
    <p class="ai-sub">Ask about the programme you're working on. It can see what you've filled in and your catalog.</p>
    ${!S.settings.hasApiKey ? '<div class="notice small">AI is off. <a href="#" id="toSettings">Add your API key in Settings</a>.</div>' : ''}
    <div class="messages" id="msgs"></div>
    <div class="chips" id="starters"></div>
    <div class="composer">
      <textarea id="prompt" aria-label="Message to the AI helper" placeholder="Ask for ideas, activities, wording… (⌘↩ to send)">${esc(S.chat.draft || '')}</textarea>
      <button class="btn primary" id="send">Send</button>
    </div>
  </aside>`;
}

// Binds the panel rendered by aiPanelHtml(). getFocus returns the draft being edited; stepKey picks starter prompts.
function mountAiPanel(getFocus, stepKey, onNote) {
  const C = S.chat;
  C.getFocus = getFocus; C.onNote = onNote;
  const show = $('#aiShow'); if (show) { show.onclick = () => { S.aiHidden = false; render(); }; return; }
  if (!$('#aiPanel')) return;
  C.draft = '';
  $('#aiHide').onclick = () => { C.draft = $('#prompt').value; S.aiHidden = true; render(); };
  $('#aiClear').onclick = () => { C.messages = []; renderMessages(); renderStarters(stepKey); };
  if ($('#toSettings')) $('#toSettings').onclick = e => { e.preventDefault(); go('settings'); };
  $('#send').onclick = sendChat;
  $('#prompt').onkeydown = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendChat(); } };
  renderMessages(); renderStarters(stepKey);
  if (C.busy) $('#send').disabled = true;
}

function renderStarters(stepKey) {
  const box = $('#starters'); if (!box) return;
  box.innerHTML = (AI_STARTERS[stepKey] || AI_STARTERS.start).map(t => `<button type="button" class="chip">${esc(t)}</button>`).join('');
  $$('.chip', box).forEach(c => c.onclick = () => { $('#prompt').value = c.textContent; $('#prompt').focus(); });
}

function renderMessages() {
  const C = S.chat, box = $('#msgs');
  if (!box) return;
  if (!C.messages.length) { box.innerHTML = '<div class="ai-empty">Pick a suggestion below or type your own question.</div>'; return; }
  box.innerHTML = C.messages.map((m, i) => m.role === 'user'
    ? `<div class="msg user">${esc(m.content)}</div>`
    : `<div class="msg assistant"><div class="md ${m.streaming ? 'typing' : ''}">${renderMarkdown(m.content)}</div>
       ${!m.streaming && m.content ? `<div class="msg-actions"><button class="btn small" data-copy="${i}">Copy</button>${C.onNote ? `<button class="btn small" data-tonote="${i}">Add to programme notes</button>` : ''}</div>` : ''}</div>`).join('');
  $$('[data-copy]', box).forEach(b => b.onclick = () => { copyText(C.messages[+b.dataset.copy].content); toast('Copied. Paste it into any field.'); });
  $$('[data-tonote]', box).forEach(b => b.onclick = () => { C.onNote(C.messages[+b.dataset.tonote].content); toast('Added to the programme notes'); });
  box.scrollTop = box.scrollHeight;
}

async function sendChat() {
  const C = S.chat;
  const input = $('#prompt');
  const text = input.value.trim();
  if (!text || C.busy) return;
  if (!S.settings.hasApiKey) { toast('Add your API key in Settings first.', true); return; }
  input.value = '';
  C.messages.push({ role: 'user', content: text });
  const reply = { role: 'assistant', content: '', streaming: true };
  C.messages.push(reply);
  C.busy = true; $('#send').disabled = true;
  renderMessages();
  let pending = false;
  try {
    const history = C.messages.filter(m => m !== reply).map(({ role, content }) => ({ role, content }));
    const final = await api.ai.chat({ messages: history, context: libraryContext() }, t => {
      reply.content += t;
      if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; renderMessages(); }); }
    });
    reply.content = final || reply.content;
  } catch (e) {
    toast(e.message, true);
    if (!reply.content) { C.messages.splice(C.messages.indexOf(reply) - 1, 2); if ($('#prompt')) $('#prompt').value = text; }
  } finally {
    reply.streaming = false; C.busy = false;
    if ($('#send')) $('#send').disabled = false;
    renderMessages();
  }
}

// ---------- Templates ----------
function viewTemplates() {
  main().innerHTML = `
    ${header('Templates', 'Reusable documents you attach to programmes. Details like the programme name fill in automatically.',
      '<button class="btn" id="impTpl">Import from text</button><button class="btn ai" id="aiTpl">Draft with AI</button><button class="btn primary" id="newTpl">＋ New template</button>')}
    ${S.templates.length ? `<div class="cards">${S.templates.map(t => `
      <div class="card" data-tpl="${esc(t.id)}" tabindex="0">
        <div class="card-head"><h3>${esc(t.name)}</h3><span class="tag">${esc(t.category || 'General')}</span></div>
        <p>${esc(t.description)}</p>
        <div class="meta"><span>${t.sections.length} sections</span><span>Updated ${fmtDate(t.updatedAt)}</span></div>
      </div>`).join('')}</div>` : '<div class="empty">No templates yet. Create one, draft one with AI, or import one from text.</div>'}`;
  $$('[data-tpl]').forEach(c => { c.onclick = () => go('template', c.dataset.tpl); c.onkeydown = e => { if (e.key === 'Enter') go('template', c.dataset.tpl); }; });
  $('#newTpl').onclick = () => go('template', 'new');
  $('#impTpl').onclick = () => go('import');
  $('#aiTpl').onclick = () => modal(`<h2>Draft a template with AI</h2>
      ${field('What is the template for?', `<textarea id="tdesc" class="tall" placeholder="e.g. A one-page session plan for volunteer leaders running a weekly drop-in, with a debrief section"></textarea>`, { forId: 'tdesc' })}
      <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn ai" id="tgo">Draft template</button></div>`, (m, close) => {
    $('#tgo', m).onclick = async e => {
      const description = $('#tdesc', m).value.trim();
      if (!description) return;
      const t = await busy(e.currentTarget, 'Drafting…', () => api.ai.draftTemplate({ description }));
      if (!t) return;
      close();
      S.view = 'template'; S.id = 'new';
      S.tplEdit = { ...t, sections: t.sections.map((s, i) => ({ id: 's' + (i + 1), ...s })), _for: 'new' };
      S.dirty = true; render();
      toast('Template drafted. Review and save.');
    };
  });
}

function viewTemplate() {
  if (!S.tplEdit || S.tplEdit._for !== S.id) {
    const src = S.id === 'new' ? { name: '', description: '', category: 'Planning', sections: [{ id: 's1', heading: 'Overview', guidance: '', content: '{{programme_title}} for ages {{age_group}}.' }] } : S.templates.find(t => t.id === S.id);
    if (!src) return go('templates');
    S.tplEdit = { ...clone(src), _for: S.id };
  }
  const t = S.tplEdit;
  main().innerHTML = `
    <div class="crumbs"><a href="#" id="back">← Templates</a></div>
    ${header(S.id === 'new' ? 'New template' : 'Edit template', '', t.id ? '<button class="btn" id="useTpl">Use with a programme</button><button class="btn" id="dupTpl">Duplicate</button>' : '')}
    <div class="two-col">
      <div class="form-card">
        ${field('Template name', `<input type="text" id="t-name" class="big" data-t="name" placeholder="e.g. Trip risk assessment" value="${esc(t.name)}">`, { req: true, forId: 't-name' })}
        <div class="grid2">
          ${field('Category', `<input type="text" id="t-cat" data-t="category" placeholder="e.g. Safety" value="${esc(t.category)}">`, { forId: 't-cat' })}
          ${field('Short description', `<input type="text" id="t-desc" data-t="description" placeholder="What is it for?" value="${esc(t.description)}">`, { forId: 't-desc' })}
        </div>
        <h2 class="form-title">Sections</h2>
        <div id="tsections"></div>
        <button class="btn add-btn" id="addSec">＋ Add a section</button>
      </div>
      <aside class="side"><div class="panel"><h2>Auto-fill fields</h2>
        <p class="faint">Put these in your text and they're replaced with the programme's details. Click one to copy it.</p>
        <div class="chips">${PLACEHOLDERS.map(k => `<button type="button" class="chip" data-ph="${k}">{{${k}}}</button>`).join('')}</div>
      </div>${t.id ? '<div class="panel"><button class="btn danger-text full" id="delTpl">Delete template</button></div>' : ''}</aside>
    </div>
    <div class="savebar"><div class="spacer"></div><button class="btn" id="cancelTpl">Cancel</button><button class="btn primary" id="saveTpl">Save template</button></div>`;
  $$('[data-t]').forEach(el => el.addEventListener('input', () => { t[el.dataset.t] = el.value; S.dirty = true; }));
  $$('[data-ph]').forEach(c => c.onclick = () => { copyText(`{{${c.dataset.ph}}}`); toast('Copied {{' + c.dataset.ph + '}}'); });
  $('#back').onclick = e => { e.preventDefault(); go('templates'); };
  $('#cancelTpl').onclick = () => go('templates');
  $('#addSec').onclick = () => { t.sections.push({ id: 's' + Date.now(), heading: '', guidance: '', content: '' }); S.dirty = true; renderTplSections(); };
  $('#saveTpl').onclick = saveTemplate;
  if (t.id) {
    $('#delTpl').onclick = async () => {
      if (!(await confirmBox('Delete this template?', `"${t.name}" will be removed. Documents already made from it are kept.`, 'Delete', true))) return;
      await api.remove('templates', t.id); await reload(); S.dirty = false; go('templates');
    };
    $('#dupTpl').onclick = async () => {
      const { _for, id, createdAt, updatedAt, ...rest } = t;
      const saved = await api.upsert('templates', { ...rest, name: t.name + ' (copy)' });
      await reload(); S.dirty = false; go('template', saved.id);
    };
    $('#useTpl').onclick = () => {
      if (S.dirty) { toast('Save the template first.', true); return; }
      modal(`<h2>Use “${esc(t.name)}”</h2>
        ${field('Programme', `<select id="target"><option value="new">A new programme</option>${S.programmes.map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('')}</select>`, { forId: 'target' })}
        <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Continue</button></div>`, (m, close) => {
        $('#go', m).onclick = async () => {
          const target = $('#target', m).value; close();
          if (target === 'new') {
            await go('create');
            S.wiz.p.templateId = t.id; S.wiz.mode = 'template'; gotoStep(1);
            toast('Fill in the programme. The document is filled in at the end.');
          } else {
            await go('edit', target, { tab: 'documents' });
            chooseTemplate(S.draft, () => { S.dirty = true; render(); }, t.id);
          }
        };
      });
    };
  }
  renderTplSections();
}

function renderTplSections() {
  const t = S.tplEdit;
  $('#tsections').innerHTML = t.sections.map((s, i) => `
    <div class="session" data-i="${i}">
      <div class="session-top"><span class="num">${i + 1}</span><b>Section ${i + 1}</b><div class="spacer"></div>
        <button type="button" class="btn ghost small" data-act="up" ${i === 0 ? 'disabled' : ''}>↑ Up</button>
        <button type="button" class="btn ghost small" data-act="down" ${i === t.sections.length - 1 ? 'disabled' : ''}>↓ Down</button>
        <button type="button" class="btn ghost small danger-text" data-act="del">Remove</button></div>
      ${field('Heading', `<input type="text" data-s="heading" placeholder="e.g. Aims of the trip" value="${esc(s.heading)}">`)}
      ${field('Hint for the writer', `<input type="text" data-s="guidance" placeholder="Optional, e.g. List 3-5 aims" value="${esc(s.guidance)}">`)}
      ${field('Starter text', `<textarea class="tall" data-s="content" placeholder="Text that appears in every document made from this template">${esc(s.content)}</textarea>`)}
    </div>`).join('');
  $$('#tsections .session').forEach(el => {
    const i = +el.dataset.i;
    $$('[data-s]', el).forEach(inp => inp.addEventListener('input', () => { t.sections[i][inp.dataset.s] = inp.value; S.dirty = true; }));
    $$('[data-act]', el).forEach(b => b.onclick = () => {
      const L = t.sections, a = b.dataset.act;
      if (a === 'del') L.splice(i, 1);
      if (a === 'up' && i > 0) [L[i - 1], L[i]] = [L[i], L[i - 1]];
      if (a === 'down' && i < L.length - 1) [L[i + 1], L[i]] = [L[i], L[i + 1]];
      S.dirty = true; renderTplSections();
    });
  });
}

async function saveTemplate() {
  const t = S.tplEdit;
  if (!t.name.trim()) { toast('Give the template a name.', true); return; }
  t.sections = t.sections.filter(s => s.heading.trim() || s.content.trim());
  const { _for, ...item } = t;
  const saved = await api.upsert('templates', item);
  await reload();
  S.dirty = false; S.tplEdit = null;
  toast('Template saved'); go('template', saved.id);
}

// ---------- Settings ----------
function viewSettings() {
  const st = S.settings;
  main().innerHTML = `
    ${header('Settings', '')}
    <div class="narrow">
    <div class="panel"><h2>AI (Claude)</h2>
      <p class="faint">AI features use your own Anthropic API key. Create one at console.anthropic.com → API Keys. The key is stored encrypted in your Mac's Keychain.</p>
      ${field(`Anthropic API key${st.hasApiKey ? ` <span class="faint">(saved: ${esc(st.apiKeyHint)})</span>` : ''}`, `<input type="password" id="key" placeholder="${st.hasApiKey ? 'Enter a new key to replace the saved one' : 'sk-ant-…'}">`, { forId: 'key' })}
      ${field('Model', `<input type="text" id="model" value="${esc(st.model)}">`, { forId: 'model', help: `Default: ${esc(st.defaultModel)}. Use claude-sonnet-5-5 to spend less.` })}
      <div class="row wrap"><button class="btn primary" id="saveAi">Save</button><button class="btn" id="testAi" ${st.hasApiKey ? '' : 'disabled'}>Test connection</button>
        ${st.hasApiKey ? '<button class="btn ghost danger-text" id="rmKey">Remove key</button>' : ''}</div>
    </div>
    <div class="panel"><h2>Your details</h2>
      <p class="faint">Used to fill {{facilitator}} and {{organisation}} in templates.</p>
      <div class="grid2">
        ${field('Your name', `<input type="text" id="fac" value="${esc(st.facilitator)}">`, { forId: 'fac' })}
        ${field('Organisation', `<input type="text" id="org" value="${esc(st.organisation)}">`, { forId: 'org' })}
      </div>
      <button class="btn" id="saveMe">Save</button>
    </div>
    <div class="panel"><h2>Emergency contacts</h2>
      <p class="faint">These appear in the Safety section's emergency contact lists.</p>
      <div id="contactList"></div>
      <div class="grid2">${field('Name and role', '<input type="text" id="ncName" placeholder="e.g. Ms Lim (centre manager)">', { forId: 'ncName' })}${field('Phone number', '<input type="text" id="ncPhone" placeholder="e.g. 9123 4567">', { forId: 'ncPhone' })}</div>
      <button class="btn" id="ncAdd">Add contact</button>
    </div>
    <div class="panel"><h2>Your data</h2>
      <p class="faint">Everything is stored on this Mac: <code>${esc(st.dataFile)}</code></p>
      <div class="row wrap"><button class="btn" id="reveal">Show in Finder</button><button class="btn" id="toImport">Import or export…</button></div>
    </div></div>`;
  $('#saveAi').onclick = async () => {
    const patch = { model: $('#model').value.trim() || st.defaultModel };
    const key = $('#key').value.trim();
    if (key) patch.apiKey = key;
    S.settings = await api.setSettings(patch); renderAiStatus(); toast('Saved'); render();
  };
  $('#testAi').onclick = e => busy(e.currentTarget, 'Testing…', async () => { await api.ai.test(); toast('Connected to Claude ✓'); });
  if ($('#rmKey')) $('#rmKey').onclick = async () => { S.settings = await api.setSettings({ apiKey: '' }); renderAiStatus(); render(); };
  $('#saveMe').onclick = async () => { S.settings = await api.setSettings({ facilitator: $('#fac').value.trim(), organisation: $('#org').value.trim() }); toast('Saved'); };
  $('#reveal').onclick = () => api.revealData();
  $('#toImport').onclick = () => go('import');
  const drawContacts = () => {
    const list = S.settings.contacts || [];
    $('#contactList').innerHTML = list.length ? list.map((c, i) => `<div class="ms-chip"><span><b>${esc(c.name)}</b>${c.phone ? ' · ' + esc(c.phone) : ''}</span><button type="button" data-rmc="${i}" aria-label="Remove ${esc(c.name)}">✕</button></div>`).join('') : '<p class="faint small">No saved contacts yet.</p>';
    $$('[data-rmc]').forEach(b => b.onclick = async () => { S.settings = await api.setSettings({ contacts: list.filter((_, i) => i !== +b.dataset.rmc) }); drawContacts(); });
  };
  drawContacts();
  $('#ncAdd').onclick = async () => {
    const c = { name: $('#ncName').value.trim(), phone: $('#ncPhone').value.trim() };
    if (!c.name) return toast('Add a name first.', true);
    S.settings = await api.setSettings({ contacts: [...(S.settings.contacts || []), c] });
    $('#ncName').value = ''; $('#ncPhone').value = ''; drawContacts(); toast('Contact saved');
  };
}

// ---------- boot ----------
$$('#nav a').forEach(a => a.onclick = e => { e.preventDefault(); go(a.dataset.view); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const pop = $('.ms-pop:not(.hidden)');
    if (pop) { pop.classList.add('hidden'); pop.previousElementSibling.setAttribute('aria-expanded', 'false'); pop.previousElementSibling.focus(); return; }
    const m = $('#modal');
    if (!m.classList.contains('hidden')) { const c = $('[data-close]', m); if (c) c.click(); else { m.classList.add('hidden'); m.innerHTML = ''; } return; }
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) a.blur();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    if (S.view === 'edit') saveDraft();
    if (S.view === 'template') saveTemplate();
    if (S.view === 'create' && S.wiz && S.wiz.step === WIZ_STEPS.length - 1) saveNew();
  }
});
api.onMenu(cmd => {
  if (cmd === 'new-programme') go('create');
  if (cmd === 'new-template') go('template', 'new');
  if (cmd === 'import') go('import');
  if (cmd === 'share') shareDialog();
  if (cmd === 'open-shared') openShared(false);
  if (cmd === 'open-shared-pending') openShared(true);
  if (cmd === 'export') exportLibrary();
  if (cmd === 'focus-search') { if (S.view !== 'catalog') go('catalog'); else if ($('#q')) $('#q').focus(); }
});

window.toast = toast;
reload().then(() => go('home')).then(() => openShared(true));
