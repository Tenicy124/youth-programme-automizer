/* Youth Programme Studio — renderer */
'use strict';

const AGE_GROUPS = ['5-8', '9-12', '13-15', '16-18', '18-25'];
const FORMATS = ['Weekly club', 'Camp', 'Workshop', 'Retreat', 'Event', 'Online', 'Mentoring'];
const STATUSES = ['idea', 'draft', 'ready', 'delivered', 'archived'];
const STATUS_HELP = { idea: 'Just an idea', draft: 'Being planned', ready: 'Ready to run', delivered: 'Has been run', archived: 'No longer used' };
const PLACEHOLDERS = ['programme_title', 'age_group', 'format', 'duration', 'group_size', 'objectives', 'summary', 'facilitator', 'organisation', 'date'];

const S = {
  programmes: [], templates: [], settings: {},
  view: 'home', id: null, tab: 'basics',
  filters: { q: '', ageGroup: '', format: '', status: '', theme: '' },
  draft: null, dirty: false,         // programme being edited (edit page)
  wiz: null,                         // create wizard state { step, p, ideas, brief }
  tplEdit: null,
  chat: { messages: [], busy: false, focusId: null, focusDraft: null, draft: '' },
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
  renderAiStatus();
}

function renderAiStatus() {
  $('#aiStatus').innerHTML = S.settings.hasApiKey
    ? `<span class="dot on"></span>AI ready`
    : `<span class="dot"></span>AI off · <a href="#" id="setupAi">add API key</a>`;
  const l = $('#setupAi'); if (l) l.onclick = e => { e.preventDefault(); go('settings'); };
}

function newProgramme(extra) {
  return {
    title: '', summary: '', ageGroup: '', themes: [], format: '', duration: '', groupSize: '',
    objectives: [], sessions: [], materials: [], budget: '', riskNotes: '', outcomes: '', status: 'draft', rating: 0,
    notes: '', document: [], templateId: null, ...extra,
  };
}

const NAV_FOR = { home: 'home', create: 'create', catalog: 'catalog', programme: 'catalog', edit: 'catalog', templates: 'templates', template: 'templates', import: 'import', assistant: 'assistant', settings: 'settings' };

// ---------- routing ----------
async function go(view, id = null, opts = {}) {
  if (S.dirty) {
    const leave = await confirmBox('Leave without saving?', 'You have changes that are not saved yet.', 'Discard changes', true);
    if (!leave) return;
  }
  S.dirty = false;
  if (view !== 'edit') S.draft = null;
  if (view !== 'template') S.tplEdit = null;
  if (view === 'create' && !opts.keepWizard) S.wiz = null;
  S.view = view; S.id = id;
  if (opts.tab) S.tab = opts.tab;
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === NAV_FOR[view]));
  render();
  main().scrollTop = 0;
}

function render() {
  const views = { home: viewHome, create: viewCreate, catalog: viewCatalog, programme: viewProgramme, edit: viewEdit, templates: viewTemplates, template: viewTemplate, import: viewImport, assistant: viewAssistant, settings: viewSettings };
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
    <div class="meta">${p.ageGroup ? `<span>Ages ${esc(p.ageGroup)}</span>` : ''}${p.format ? `<span>${esc(p.format)}</span>` : ''}${p.duration ? `<span>${esc(p.duration)}</span>` : ''}${stars(p.rating)}</div>
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
  const sorted = P.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const name = S.settings.facilitator ? `, ${esc(S.settings.facilitator.split(' ')[0])}` : '';
  main().innerHTML = `
    ${header(`Welcome back${name}`, 'Your youth programmes at a glance.')}
    <div class="actions-grid">
      <button class="action" data-go="create"><span class="a-ico">＋</span><b>Create new</b><span>Plan a programme step by step, with optional AI help</span></button>
      <button class="action" data-go="catalog"><span class="a-ico">▤</span><b>Catalog</b><span>Search and browse every programme</span></button>
      <button class="action" data-go="templates"><span class="a-ico">❏</span><b>Templates</b><span>Proposals, risk assessments, session plans</span></button>
      <button class="action" data-go="import"><span class="a-ico">⇪</span><b>Import</b><span>Bring in existing programmes and files</span></button>
    </div>
    <div class="stats">
      <div class="stat"><b>${P.length}</b><span>Programmes</span></div>
      <div class="stat"><b>${count('ready')}</b><span>Ready to run</span></div>
      <div class="stat"><b>${count('draft') + count('idea')}</b><span>In planning</span></div>
      <div class="stat"><b>${count('delivered')}</b><span>Delivered</span></div>
    </div>
    <div class="panel"><div class="panel-head"><h2>Your programmes</h2><button class="btn ghost" data-go="catalog">Open catalog →</button></div>
      ${sorted.length ? `<div class="summary-list">${sorted.map(p => `
        <div class="summary-row" data-open="${esc(p.id)}" tabindex="0">
          <div class="sr-main"><div class="sr-title">${esc(p.title || 'Untitled programme')} ${statusBadge(p.status)}</div>
            <div class="sr-sum">${esc(p.summary)}</div></div>
          <div class="sr-meta">${p.ageGroup ? `<span>Ages ${esc(p.ageGroup)}</span>` : ''}<span>${esc(p.format || '')}</span><span class="faint">Updated ${fmtDate(p.updatedAt)}</span></div>
        </div>`).join('')}</div>`
    : '<div class="empty">No programmes yet. Click <b>Create new</b> to plan your first one.</div>'}
    </div>`;
  $$('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
  bindOpen(main());
}

// ---------- Catalog ----------
function viewCatalog() {
  const f = S.filters;
  const themes = PSearch.allThemes(S.programmes);
  main().innerHTML = `
    ${header('Catalog', 'Search and filter all your programmes. Click one to view or edit it.', '<button class="btn primary" id="newBtn">＋ Create new</button>')}
    <div class="filters">
      <div class="searchbox"><input type="search" id="q" aria-label="Search" placeholder="Search by name, theme or activity (e.g. coding, camping, leadership)" value="${esc(f.q)}"></div>
      <select id="fAge" aria-label="Age group">${opts(AGE_GROUPS, f.ageGroup, 'All ages')}</select>
      <select id="fFormat" aria-label="Format">${opts(FORMATS, f.format, 'All formats')}</select>
      <select id="fStatus" aria-label="Status">${opts(STATUSES, f.status, 'Any status')}</select>
      <select id="fTheme" aria-label="Theme">${opts(themes, f.theme, 'All themes')}</select>
    </div>
    <div class="resultcount" id="count"></div>
    <div id="results"></div>`;
  const run = () => {
    const res = PSearch.search(S.programmes, f.q, f);
    $('#count').textContent = `Showing ${res.length} of ${S.programmes.length} programmes${f.q ? ', best matches first' : ''}`;
    $('#results').innerHTML = res.length
      ? `<div class="cards">${res.map(r => programmeCard(r.programme)).join('')}</div>`
      : `<div class="empty">No programmes match. Try fewer filters, or <a href="#" id="toCreate">create a new one with AI ideas</a>.</div>`;
    bindOpen($('#results'));
    const tc = $('#toCreate'); if (tc) tc.onclick = e => { e.preventDefault(); go('create'); };
  };
  $('#q').oninput = e => { f.q = e.target.value; run(); };
  $('#fAge').onchange = e => { f.ageGroup = e.target.value; run(); };
  $('#fFormat').onchange = e => { f.format = e.target.value; run(); };
  $('#fStatus').onchange = e => { f.status = e.target.value; run(); };
  $('#fTheme').onchange = e => { f.theme = e.target.value; run(); };
  $('#newBtn').onclick = () => go('create');
  run();
  $('#q').focus();
}

// ---------- Programme view ----------
function programmeReadHtml(p) {
  const tpl = p.templateId && S.templates.find(t => t.id === p.templateId);
  const block = (title, body, tab) => `<section class="read-sec"><div class="read-head"><h2>${title}</h2>${tab && p.id ? `<button class="btn ghost small" data-edit-tab="${tab}">Edit</button>` : ''}</div>${body}</section>`;
  const none = '<p class="faint">Not added yet.</p>';
  const para = t => t ? `<p class="prose">${esc(t)}</p>` : none;
  const list = a => (a || []).length ? `<ul>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : none;
  return `
    <div class="facts">
      <div><span>Age group</span><b>${esc(p.ageGroup || '-')}</b></div>
      <div><span>Format</span><b>${esc(p.format || '-')}</b></div>
      <div><span>Duration</span><b>${esc(p.duration || '-')}</b></div>
      <div><span>Group size</span><b>${esc(p.groupSize || '-')}</b></div>
      <div><span>Budget</span><b>${esc(p.budget || '-')}</b></div>
    </div>
    ${block('Summary', para(p.summary) + ((p.themes || []).length ? `<div class="chips">${p.themes.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''), 'basics')}
    ${block('Objectives', list(p.objectives) + (p.outcomes ? `<h3 class="sub">How success is measured</h3>${para(p.outcomes)}` : ''), 'goals')}
    ${block(`Sessions <span class="count">${(p.sessions || []).length}</span>`, (p.sessions || []).length ? p.sessions.map((s, i) => `
      <div class="read-session"><div class="rs-head"><span class="num">${i + 1}</span><b>${esc(s.title || 'Untitled session')}</b>${s.duration ? `<span class="faint">${esc(s.duration)}</span>` : ''}</div>
        ${s.activities ? `<p class="prose">${esc(s.activities)}</p>` : ''}${s.materials ? `<p class="faint small">Materials: ${esc(s.materials)}</p>` : ''}</div>`).join('') : none, 'sessions')}
    ${block('Resources &amp; safety', `<h3 class="sub">Materials</h3>${list(p.materials)}<h3 class="sub">Risk &amp; safeguarding</h3>${para(p.riskNotes)}`, 'resources')}
    ${(p.document || []).length ? block(`Document${tpl ? `: ${esc(tpl.name)}` : ''}`, p.document.map(d => `<h3 class="sub">${esc(d.heading)}</h3><p class="prose">${esc(d.content)}</p>`).join(''), 'documents') : ''}
    ${p.notes || p.rating ? block('Notes &amp; reflection', `${p.rating ? `<p>${stars(p.rating)}</p>` : ''}${para(p.notes)}`, 'notes') : ''}`;
}

function viewProgramme() {
  const p = S.programmes.find(x => x.id === S.id);
  if (!p) return go('catalog');
  const recs = PSearch.recommend(S.programmes, p, { excludeId: p.id, limit: 5 });
  main().innerHTML = `
    <div class="crumbs"><a href="#" id="back">← Catalog</a></div>
    ${header(esc(p.title || 'Untitled programme'), `${statusBadge(p.status)} <span class="faint">Updated ${fmtDate(p.updatedAt)}</span>`,
      `<button class="btn" id="exportBtn">Export</button><button class="btn" id="dupBtn">Duplicate</button><button class="btn primary" id="editBtn">Edit programme</button>`)}
    <div class="two-col">
      <div class="read">${programmeReadHtml(p)}</div>
      <aside class="side">
        <div class="panel"><h2>AI assist</h2>
          <div class="stack">
            <button class="btn ai" id="aiImprove">Review &amp; improve with AI</button>
            <button class="btn" id="aiVariants">Create a variation</button>
          </div></div>
        <div class="panel"><h2>Similar programmes</h2>${recs.length ? recs.map(r => `<div class="mini" data-open="${esc(r.programme.id)}" tabindex="0"><b>${esc(r.programme.title)}</b><span>Ages ${esc(r.programme.ageGroup)} · ${esc(r.programme.format)} ${stars(r.programme.rating)}</span></div>`).join('') : '<p class="faint">Nothing similar yet.</p>'}</div>
        <div class="panel"><button class="btn danger-text full" id="delBtn">Delete programme</button></div>
      </aside>
    </div>`;
  bindOpen($('.side'));
  $('#back').onclick = e => { e.preventDefault(); go('catalog'); };
  $('#editBtn').onclick = () => go('edit', p.id, { tab: 'basics' });
  $$('[data-edit-tab]').forEach(b => b.onclick = () => go('edit', p.id, { tab: b.dataset.editTab }));
  $('#exportBtn').onclick = () => exportMenu(p);
  $('#dupBtn').onclick = async () => {
    const { id, createdAt, updatedAt, ...rest } = p;
    const saved = await api.upsert('programmes', { ...rest, title: p.title + ' (copy)', status: 'draft', rating: 0 });
    await reload(); toast('Duplicated'); go('edit', saved.id, { tab: 'basics' });
  };
  $('#delBtn').onclick = async () => {
    if (!(await confirmBox('Delete this programme?', `"${p.title}" will be permanently removed.`, 'Delete', true))) return;
    await api.remove('programmes', p.id); await reload(); toast('Programme deleted'); go('catalog');
  };
  $('#aiImprove').onclick = () => {
    S.chat.focusId = p.id; S.chat.focusDraft = null;
    S.chat.draft = `Review "${p.title}" and suggest specific improvements to engagement, inclusion, session flow and safeguarding.`;
    go('assistant');
  };
  $('#aiVariants').onclick = () => {
    go('create').then(() => {
      S.wiz.brief = { ageGroup: p.ageGroup, format: '', duration: p.duration, interests: (p.themes || []).join(', '), goals: `A fresh variation on "${p.title}": ${p.summary}`, constraints: p.budget ? 'Budget ' + p.budget : '' };
      S.wiz.mode = 'ai'; renderWizard();
    });
  };
}

// ---------- Form building blocks (shared by Create and Edit) ----------
function field(label, input, { help = '', req = false, forId = '' } = {}) {
  return `<div class="field">
    <label class="label" ${forId ? `for="${forId}"` : ''}>${label}${req ? ' <span class="req">Required</span>' : ''}</label>
    ${help ? `<div class="help">${help}</div>` : ''}${input}</div>`;
}
function pills(name, list, val, helpMap) {
  return `<div class="pills" role="radiogroup" data-pills="${name}">${list.map(v => `<button type="button" role="radio" aria-checked="${v === val}" class="pill-opt ${v === val ? 'on' : ''}" data-v="${esc(v)}">${esc(v)}${helpMap ? `<small>${esc(helpMap[v])}</small>` : ''}</button>`).join('')}</div>`;
}

const SECTIONS = {
  basics: { label: 'Basics', html: p => `
    ${field('Programme name', `<input type="text" id="f-title" class="big" data-bind="title" placeholder="e.g. Code Creators: Build Your First Game" value="${esc(p.title)}">`, { req: true, forId: 'f-title', help: 'A short, memorable name young people and parents will recognise.' })}
    ${field('Summary', `<textarea id="f-summary" class="tall" data-bind="summary" placeholder="What is the programme, who is it for, and what will they get out of it?">${esc(p.summary)}</textarea>`, { forId: 'f-summary', help: 'Two or three sentences. This is shown on the home page and in the catalog.' })}
    ${field('Age group', pills('ageGroup', AGE_GROUPS, p.ageGroup), { help: 'Pick the main age range.' })}
    ${field('Format', pills('format', FORMATS, p.format), { help: 'How the programme runs.' })}
    <div class="grid2">
      ${field('Duration', `<input type="text" id="f-duration" data-bind="duration" placeholder="e.g. 6 weeks, 90 minutes each" value="${esc(p.duration)}">`, { forId: 'f-duration' })}
      ${field('Group size', `<input type="text" id="f-group" data-bind="groupSize" placeholder="e.g. 12-20 young people" value="${esc(p.groupSize)}">`, { forId: 'f-group' })}
    </div>` },
  goals: { label: 'Goals & tags', html: p => `
    ${field('Learning objectives', `<textarea id="f-obj" class="tall" data-bind-lines="objectives" placeholder="Build confidence speaking in a group&#10;Learn to plan a simple project&#10;Work as part of a team">${esc((p.objectives || []).join('\n'))}</textarea>`, { forId: 'f-obj', help: 'What young people will learn or be able to do. Put each objective on its own line.' })}
    ${field('Tags', `<div data-tags></div>`, { help: 'Tags describe the topic (e.g. <i>music</i>, <i>leadership</i>, <i>outdoors</i>). They power search and recommendations.' })}
    ${field('How you will measure success', `<textarea id="f-out" class="mid" data-bind="outcomes" placeholder="e.g. 75% attendance, every team presents at the showcase, confidence scores improve">${esc(p.outcomes)}</textarea>`, { forId: 'f-out', help: 'Optional. Helps with funding reports and evaluation.' })}` },
  sessions: { label: 'Sessions', html: () => `
    <div class="section-intro"><p>Plan what happens in each session. Write the run-sheet so a volunteer could follow it.</p><button type="button" class="btn ai" data-ai-sessions>Draft sessions with AI</button></div>
    <div data-sessions></div>
    <button type="button" class="btn add-btn" data-add-session>＋ Add a session</button>` },
  resources: { label: 'Resources & safety', html: p => `
    ${field('Materials and equipment', `<textarea id="f-mat" class="tall" data-bind-lines="materials" placeholder="Flipchart paper and markers&#10;Laptops (one per pair)&#10;First aid kit">${esc((p.materials || []).join('\n'))}</textarea>`, { forId: 'f-mat', help: 'Everything you need across the whole programme. One item per line.' })}
    ${field('Budget', `<input type="text" id="f-budget" data-bind="budget" placeholder="e.g. ~$300 (materials $200, snacks $100)" value="${esc(p.budget)}">`, { forId: 'f-budget' })}
    ${field('Risk and safeguarding', `<textarea id="f-risk" class="tall" data-bind="riskNotes" placeholder="Staff ratios, consent and medical forms, venue risks, how young people can raise concerns…">${esc(p.riskNotes)}</textarea>`, { forId: 'f-risk', help: 'Key risks and how you will manage them.' })}` },
  documents: { label: 'Documents', html: () => `
    <div class="section-intro"><p>Attach a document built from a template, such as a funding proposal or risk assessment.</p></div>
    <div data-docs></div>` },
  notes: { label: 'Status & notes', html: p => `
    ${field('Status', pills('status', STATUSES, p.status, STATUS_HELP), { help: 'Where this programme is up to.' })}
    ${field('Rating', `<div class="rating" data-rating></div>`, { help: 'How well it went, once delivered.' })}
    ${field('Facilitator notes', `<textarea id="f-notes" class="tall" data-bind="notes" placeholder="What worked, what to change next time, ideas for follow-up…">${esc(p.notes)}</textarea>`, { forId: 'f-notes' })}` },
};

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
  const tags = $('[data-tags]', root); if (tags) renderTagEditor(tags, p, changed);
  const sess = $('[data-sessions]', root); if (sess) renderSessionsEditor(sess, p, changed);
  const add = $('[data-add-session]', root);
  if (add) add.onclick = () => { p.sessions = p.sessions || []; p.sessions.push({ title: '', duration: '', activities: '', materials: '' }); changed(); renderSessionsEditor(sess, p, changed); $$('.session', sess).pop().querySelector('input').focus(); };
  const aiS = $('[data-ai-sessions]', root);
  if (aiS) aiS.onclick = async () => { if (await aiBuildPlan(p, aiS)) { changed(); renderSessionsEditor(sess, p, changed); } };
  const docs = $('[data-docs]', root); if (docs) renderDocsEditor(docs, p, changed);
  const rating = $('[data-rating]', root); if (rating) renderRating(rating, p, changed);
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
    S.draft = clone(src);
  }
  const p = S.draft;
  if (!SECTIONS[S.tab]) S.tab = 'basics';
  main().innerHTML = `
    <div class="crumbs"><a href="#" id="back">← ${esc(p.title || 'Programme')}</a></div>
    ${header('Edit programme', esc(p.title))}
    <div class="tabs" role="tablist">${Object.entries(SECTIONS).map(([k, s]) => `<button role="tab" aria-selected="${k === S.tab}" class="tab ${k === S.tab ? 'on' : ''}" data-tab="${k}">${esc(s.label)}</button>`).join('')}</div>
    <div class="form-card" id="form">${SECTIONS[S.tab].html(p)}</div>
    <div class="savebar"><span class="faint" id="saveState">All changes saved</span><div class="spacer"></div>
      <button class="btn" id="cancel">Cancel</button><button class="btn primary" id="save">Save changes</button></div>`;
  const state = () => { $('#saveState').textContent = S.dirty ? 'Unsaved changes' : 'All changes saved'; };
  mountForm($('#form'), p, state);
  $$('[data-tab]').forEach(t => t.onclick = () => { S.tab = t.dataset.tab; const d = S.dirty; render(); S.dirty = d; state(); });
  $('#back').onclick = e => { e.preventDefault(); go('programme', p.id); };
  $('#cancel').onclick = () => go('programme', p.id);
  $('#save').onclick = saveDraft;
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
const WIZ_STEPS = [
  { key: 'start', label: 'Start' },
  { key: 'basics', label: 'Basics' },
  { key: 'goals', label: 'Goals & tags' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'resources', label: 'Resources & safety' },
  { key: 'review', label: 'Review & save' },
];

function viewCreate() {
  if (!S.wiz) S.wiz = { step: 0, p: newProgramme(), mode: null, ideas: null, brief: { ageGroup: '', format: '', duration: '', interests: '', goals: '', constraints: '' } };
  renderWizard();
}

function renderWizard() {
  const W = S.wiz;
  const step = WIZ_STEPS[W.step];
  main().innerHTML = `
    ${header('Create a programme', 'Work through each step. You can go back at any time, and nothing is saved until the last step.')}
    <ol class="stepper">${WIZ_STEPS.map((s, i) => `<li class="${i === W.step ? 'on' : i < W.step ? 'done' : ''}"><button type="button" data-step="${i}" ${i > W.step && !W.p.title ? 'disabled' : ''}><span class="sn">${i < W.step ? '✓' : i + 1}</span>${esc(s.label)}</button></li>`).join('')}</ol>
    <div class="form-card" id="form"></div>
    <div class="savebar ${W.step === 0 ? 'hidden' : ''}">
      ${W.step > 0 ? '<button class="btn" id="prev">← Back</button>' : ''}
      <div class="spacer"></div>
      ${W.step > 0 && W.step < WIZ_STEPS.length - 1 ? '<button class="btn primary" id="next">Next: ' + esc(WIZ_STEPS[W.step + 1].label) + ' →</button>' : ''}
      ${W.step === WIZ_STEPS.length - 1 ? '<button class="btn primary" id="saveNew">Save programme</button>' : ''}
    </div>`;
  const form = $('#form');
  if (step.key === 'start') renderStart(form);
  else if (step.key === 'review') renderReview(form);
  else { form.innerHTML = `<h2 class="form-title">${esc(step.label)}</h2>` + SECTIONS[step.key].html(W.p); mountForm(form, W.p); }
  $$('[data-step]').forEach(b => b.onclick = () => gotoStep(+b.dataset.step));
  if ($('#prev')) $('#prev').onclick = () => gotoStep(W.step - 1);
  if ($('#next')) $('#next').onclick = () => gotoStep(W.step + 1);
  if ($('#saveNew')) $('#saveNew').onclick = saveNew;
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
      <div class="meta"><span>Ages ${esc(d.ageGroup)}</span><span>${esc(d.format)}</span><span>${esc(d.duration)}</span></div>
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
    W.p = { ...W.p, ...full, themes: (full.themes || []).map(t => t.toLowerCase()) };
    S.dirty = true; gotoStep(1); toast('Full plan drafted. Check each step, then save.');
  });
}

function ideaFields(d) {
  return { title: d.title, summary: d.summary, ageGroup: d.ageGroup, format: d.format, duration: d.duration, themes: (d.themes || []).map(t => t.toLowerCase()), objectives: d.objectives || [], notes: d.whyItWorks ? 'Why it works: ' + d.whyItWorks : '' };
}

function renderReview(form) {
  const p = S.wiz.p;
  const tpl = p.templateId && S.templates.find(t => t.id === p.templateId);
  if (tpl && !(p.document || []).length) p.document = tpl.sections.map(s => ({ heading: s.heading, content: fillPlaceholders(s.content, p) }));
  const missing = [!p.summary && 'summary', !p.ageGroup && 'age group', !(p.objectives || []).length && 'objectives', !(p.sessions || []).length && 'sessions'].filter(Boolean);
  form.innerHTML = `
    <h2 class="form-title">Review &amp; save</h2>
    ${missing.length ? `<div class="notice">Not filled in yet: <b>${missing.join(', ')}</b>. You can save now and add them later.</div>` : '<div class="notice ok">Everything is filled in.</div>'}
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
  if ((p.sessions || []).length && !(await confirmBox('Replace the current sessions?', 'AI will draft a full plan. It fills sessions, objectives, materials and safety notes, replacing what is there now. Nothing is saved until you save.', 'Draft plan'))) return false;
  const similar = PSearch.recommend(S.programmes, p, { excludeId: p.id, limit: 3 }).map(r => r.programme);
  const result = await busy(btn, 'Drafting plan…', () => api.ai.develop({ idea: stripForAi(p), similar }));
  if (!result) return false;
  const { title, ...rest } = result;
  Object.assign(p, rest, { themes: (rest.themes || p.themes || []).map(t => t.toLowerCase()) });
  toast('Plan drafted. Review it, then save.');
  return true;
}

function fillPlaceholders(text, p) {
  const vals = {
    programme_title: p.title, age_group: p.ageGroup, format: p.format, duration: p.duration, group_size: p.groupSize,
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
  const out = [`# ${p.title}`, '', p.summary, '',
    `**Age group:** ${p.ageGroup}  `, `**Format:** ${p.format}  `, `**Duration:** ${p.duration || '-'}  `, `**Group size:** ${p.groupSize || '-'}  `, `**Budget:** ${p.budget || '-'}  `, `**Tags:** ${(p.themes || []).join(', ')}`, ''];
  if ((p.objectives || []).length) out.push('## Objectives', ...p.objectives.map(o => `- ${o}`), '');
  if ((p.sessions || []).length) {
    out.push('## Sessions');
    p.sessions.forEach((s, i) => out.push('', `### ${i + 1}. ${s.title}${s.duration ? ` (${s.duration})` : ''}`, '', s.activities || '', s.materials ? `\n*Materials:* ${s.materials}` : ''));
    out.push('');
  }
  if ((p.materials || []).length) out.push('## Materials', ...p.materials.map(m => `- ${m}`), '');
  if (p.riskNotes) out.push('## Risk & safeguarding', p.riskNotes, '');
  if (p.outcomes) out.push('## Measuring success', p.outcomes, '');
  if ((p.document || []).length) { out.push('---', ''); p.document.forEach(d => out.push(`## ${d.heading}`, d.content, '')); }
  return out.join('\n');
}

function programmePrintHtml(p, docOnly) {
  const meta = `Ages ${esc(p.ageGroup)} · ${esc(p.format)}${p.duration ? ' · ' + esc(p.duration) : ''}${p.groupSize ? ' · Group ' + esc(p.groupSize) : ''}`;
  const tpl = p.templateId && S.templates.find(t => t.id === p.templateId);
  if (docOnly) return `<h1>${esc(tpl ? tpl.name : 'Document')}: ${esc(p.title)}</h1><div class="pmeta">${meta}</div>` + p.document.map(d => `<h2>${esc(d.heading)}</h2><p>${esc(d.content)}</p>`).join('');
  return `<h1>${esc(p.title)}</h1><div class="pmeta">${meta}${p.budget ? ' · Budget ' + esc(p.budget) : ''}</div><p>${esc(p.summary)}</p>
    ${(p.objectives || []).length ? `<h2>Objectives</h2><ul>${p.objectives.map(o => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
    ${(p.sessions || []).length ? `<h2>Sessions</h2>${p.sessions.map((s, i) => `<div class="psession"><b>${i + 1}. ${esc(s.title)}</b>${s.duration ? ` (${esc(s.duration)})` : ''}<p>${esc(s.activities)}</p>${s.materials ? `<p><i>Materials:</i> ${esc(s.materials)}</p>` : ''}</div>`).join('')}` : ''}
    ${(p.materials || []).length ? `<h2>Materials</h2><ul>${p.materials.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
    ${p.riskNotes ? `<h2>Risk &amp; safeguarding</h2><p>${esc(p.riskNotes)}</p>` : ''}
    ${p.outcomes ? `<h2>Measuring success</h2><p>${esc(p.outcomes)}</p>` : ''}
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

// ---------- Import ----------
// Turns pasted text into a programme without AI: first line is the title, headed sections map to fields.
function parseProgrammeText(text) {
  const p = newProgramme({ status: 'draft' });
  const rows = String(text).replace(/\r/g, '').split('\n');
  const firstIdx = rows.findIndex(l => l.trim());
  if (firstIdx < 0) return p;
  p.title = rows[firstIdx].replace(/^#+\s*/, '').trim().slice(0, 120);
  const map = [[/objective|aim|goal|outcome/i, 'objectives'], [/session|week|day|schedule|plan/i, 'sessions'], [/material|equipment|resource/i, 'materials'], [/risk|safe/i, 'riskNotes'], [/budget|cost/i, 'budget'], [/summary|overview|about|description/i, 'summary']];
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
  p.budget = txt('budget').split('\n')[0] || '';
  if (txt('sessions')) p.sessions = [{ title: 'Session plan (imported)', duration: '', activities: txt('sessions'), materials: '' }];
  const age = text.match(/\b(5-8|9-12|13-15|16-18|18-25)\b/); if (age) p.ageGroup = age[1];
  const fmt = FORMATS.find(f => new RegExp(f, 'i').test(text)); if (fmt) p.format = fmt;
  return p;
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

// ---------- AI assistant (chat) ----------
function libraryContext() {
  const C = S.chat;
  const parts = [];
  const focus = C.focusDraft || (C.focusId && S.programmes.find(p => p.id === C.focusId));
  if (focus) parts.push('PROGRAMME THE USER IS WORKING ON:\n' + JSON.stringify(stripForAi(focus), null, 1));
  parts.push('LIBRARY OVERVIEW:\n' + S.programmes.slice(0, 80).map(p => `- ${p.title} | ages ${p.ageGroup} | ${p.format} | ${p.status}${p.rating ? ' | ' + p.rating + '★' : ''} | ${(p.themes || []).join(', ')}`).join('\n'));
  return parts.join('\n\n');
}

function viewAssistant() {
  const C = S.chat;
  const focus = C.focusDraft || (C.focusId && S.programmes.find(p => p.id === C.focusId));
  main().innerHTML = `
    ${header('AI assistant', 'Brainstorm activities, ice-breakers, letters and plans. It can see your catalog.', '<button class="btn ghost" id="newChat">New conversation</button>')}
    <div class="chat">
      ${focus ? `<div class="notice">Talking about <b>${esc(focus.title || 'untitled programme')}</b> <button class="btn small" id="unfocus">Stop</button></div>` : ''}
      ${!S.settings.hasApiKey ? `<div class="notice">AI is off. <a href="#" id="toSettings">Add your Anthropic API key in Settings</a> to start.</div>` : ''}
      <div class="messages" id="msgs"></div>
      <div class="chips" id="starters"></div>
      <div class="composer">
        <textarea id="prompt" aria-label="Message" placeholder="Ask anything about planning youth programmes… (⌘↩ to send)">${esc(C.draft || '')}</textarea>
        <button class="btn primary" id="send">Send</button>
      </div>
    </div>`;
  C.draft = '';
  const starters = ['Suggest 10 ice-breakers for shy 13-15 year olds', 'What programmes am I missing for ages 9-12?', 'Write a parent letter for a weekend camp', 'Ideas to make my programmes more inclusive'];
  if (!C.messages.length) {
    $('#starters').innerHTML = starters.map(s => `<button type="button" class="chip">${esc(s)}</button>`).join('');
    $$('#starters .chip').forEach(c => c.onclick = () => { $('#prompt').value = c.textContent; $('#prompt').focus(); });
    $('#msgs').innerHTML = `<div class="empty">Ask Claude for ideas. It can see your catalog${focus ? ' and the programme you chose' : ''}.</div>`;
  } else renderMessages();
  if ($('#unfocus')) $('#unfocus').onclick = () => { C.focusId = null; C.focusDraft = null; render(); };
  if ($('#toSettings')) $('#toSettings').onclick = e => { e.preventDefault(); go('settings'); };
  $('#newChat').onclick = () => { C.messages = []; C.focusId = null; C.focusDraft = null; render(); };
  $('#send').onclick = sendChat;
  $('#prompt').onkeydown = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendChat(); } };
  $('#prompt').focus();
}

function renderMessages() {
  const C = S.chat;
  $('#msgs').innerHTML = C.messages.map((m, i) => m.role === 'user'
    ? `<div class="msg user">${esc(m.content)}</div>`
    : `<div class="msg assistant"><div class="md ${m.streaming ? 'typing' : ''}">${renderMarkdown(m.content)}</div>
       ${!m.streaming && m.content ? `<div class="msg-actions"><button class="btn small" data-copy="${i}">Copy</button><button class="btn small" data-tonote="${i}">Save as a programme idea</button></div>` : ''}</div>`).join('');
  $$('[data-copy]').forEach(b => b.onclick = () => { copyText(C.messages[+b.dataset.copy].content); toast('Copied'); });
  $$('[data-tonote]').forEach(b => b.onclick = async () => {
    const text = C.messages[+b.dataset.tonote].content;
    const heading = (text.match(/^#+\s*(.+)$/m) || [])[1] || (text.match(/\*\*(.+?)\*\*/) || [])[1] || 'Idea from AI assistant';
    const saved = await api.upsert('programmes', newProgramme({ title: heading.slice(0, 80), notes: text, status: 'idea' }));
    await reload(); toast('Saved as an idea'); go('programme', saved.id);
  });
  const box = $('#msgs'); box.scrollTop = box.scrollHeight;
}

async function sendChat() {
  const C = S.chat;
  const input = $('#prompt');
  const text = input.value.trim();
  if (!text || C.busy) return;
  if (!S.settings.hasApiKey) { toast('Add your API key in Settings first.', true); return; }
  input.value = '';
  $('#starters').innerHTML = '';
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
      if (!pending && S.view === 'assistant') { pending = true; requestAnimationFrame(() => { pending = false; if (S.view === 'assistant') renderMessages(); }); }
    });
    reply.content = final || reply.content;
  } catch (e) {
    toast(e.message, true);
    if (!reply.content) { C.messages.splice(C.messages.indexOf(reply) - 1, 2); if (S.view === 'assistant') $('#prompt').value = text; }
  } finally {
    reply.streaming = false; C.busy = false;
    if (S.view === 'assistant') { $('#send').disabled = false; if (C.messages.length) renderMessages(); else render(); }
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
}

// ---------- boot ----------
$$('#nav a').forEach(a => a.onclick = e => { e.preventDefault(); go(a.dataset.view); });
document.addEventListener('keydown', e => {
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
  if (cmd === 'export') exportLibrary();
  if (cmd === 'focus-search') { if (S.view !== 'catalog') go('catalog'); else if ($('#q')) $('#q').focus(); }
});

window.toast = toast;
reload().then(() => go('home'));
