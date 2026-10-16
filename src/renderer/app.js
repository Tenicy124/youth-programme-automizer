/* Youth Programme Studio — renderer */
'use strict';

const AGE_GROUPS = ['5-8', '9-12', '13-15', '16-18', '18-25'];
const FORMATS = ['Weekly club', 'Camp', 'Workshop', 'Retreat', 'Event', 'Online', 'Mentoring'];
const STATUSES = ['idea', 'draft', 'ready', 'delivered', 'archived'];
const PLACEHOLDERS = ['programme_title', 'age_group', 'format', 'duration', 'group_size', 'objectives', 'summary', 'facilitator', 'organisation', 'date'];

const S = {
  programmes: [], templates: [], settings: {},
  view: 'library', id: null,
  filters: { q: '', ageGroup: '', format: '', status: '', theme: '' },
  edit: null, dirty: false,
  discover: { brief: { ageGroup: '', format: '', duration: '', groupSize: '', interests: '', goals: '', constraints: '' }, recs: null, ideas: null, loading: false },
  chat: { messages: [], busy: false, focusId: null, draft: '' },
};

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const lines = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);
const opts = (list, val, blank) => (blank !== undefined ? `<option value="">${esc(blank)}</option>` : '') +
  list.map(v => `<option ${v === val ? 'selected' : ''} value="${esc(v)}">${esc(v)}</option>`).join('');
const stars = n => n ? `<span class="stars">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>` : '';
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const main = () => $('#main');

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
    <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="ok">${esc(okLabel)}</button></div>`,
  (m, close) => { $('#ok', m).onclick = () => close(true); });
}

async function busy(btn, label, fn) {
  const prev = btn && btn.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>${esc(label)}`; }
  try { return await fn(); } catch (e) { toast(e.message, true); if (/API key/.test(e.message)) offerSettings(); return undefined; }
  finally { if (btn && document.body.contains(btn)) { btn.disabled = false; btn.innerHTML = prev; } }
}

function offerSettings() {
  if (!S.settings.hasApiKey) setTimeout(() => go('settings'), 400);
}

async function reload() {
  [S.programmes, S.templates, S.settings] = await Promise.all([api.list('programmes'), api.list('templates'), api.getSettings()]);
  renderAiStatus();
}

function renderAiStatus() {
  $('#aiStatus').innerHTML = S.settings.hasApiKey
    ? `<span class="dot on"></span>AI ready · ${esc(S.settings.model)}`
    : `<span class="dot"></span>AI off · <a href="#" id="setupAi">add API key</a>`;
  const l = $('#setupAi'); if (l) l.onclick = e => { e.preventDefault(); go('settings'); };
}

function newProgramme(extra) {
  return {
    title: '', summary: '', ageGroup: '13-15', themes: [], format: 'Weekly club', duration: '', groupSize: '',
    objectives: [], sessions: [], materials: [], budget: '', riskNotes: '', outcomes: '', status: 'draft', rating: 0,
    notes: '', document: [], templateId: null, ...extra,
  };
}

// ---------- routing ----------
async function go(view, id = null) {
  if (S.dirty && !(view === S.view && id === S.id)) {
    const leave = await confirmBox('Unsaved changes', 'You have unsaved changes. Leave without saving?', 'Discard changes', true);
    if (!leave) return;
  }
  S.dirty = false;
  S.view = view; S.id = id;
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === (view === 'programme' ? 'library' : view === 'template' ? 'templates' : view)));
  render();
  main().scrollTop = 0;
}

function render() {
  const views = { library: viewLibrary, programme: viewProgramme, discover: viewDiscover, studio: viewStudio, templates: viewTemplates, template: viewTemplate, settings: viewSettings };
  (views[S.view] || viewLibrary)();
}

// ---------- Library ----------
function programmeCard(p, extra = '') {
  return `<div class="card" data-open="${esc(p.id)}">
    <div class="row" style="justify-content:space-between;gap:8px"><h3>${esc(p.title || 'Untitled programme')}</h3><span class="status ${esc(p.status)}">${esc(p.status)}</span></div>
    <p>${esc(p.summary)}</p>${extra}
    <div class="meta"><span>Ages ${esc(p.ageGroup)}</span>·<span>${esc(p.format)}</span>${p.duration ? `·<span>${esc(p.duration)}</span>` : ''} ${stars(p.rating)}</div>
    <div class="chips">${(p.themes || []).slice(0, 4).map(t => `<span class="pill tag">${esc(t)}</span>`).join('')}</div>
  </div>`;
}

function bindCards(root) {
  $$('[data-open]', root).forEach(c => c.onclick = () => go('programme', c.dataset.open));
}

function viewLibrary() {
  const f = S.filters;
  const themes = PSearch.allThemes(S.programmes);
  main().innerHTML = `
    <div class="topbar"><h1>Programme Library</h1><div class="spacer"></div>
      <button class="btn" id="importBtn">Import…</button>
      <button class="btn primary" id="newBtn">+ New programme</button></div>
    <div class="filters">
      <div class="searchbox"><input type="search" id="q" placeholder="Search programmes, themes, activities…" value="${esc(f.q)}"></div>
      <select id="fAge">${opts(AGE_GROUPS, f.ageGroup, 'All ages')}</select>
      <select id="fFormat">${opts(FORMATS, f.format, 'All formats')}</select>
      <select id="fStatus">${opts(STATUSES, f.status, 'Any status')}</select>
      <select id="fTheme">${opts(themes, f.theme, 'All themes')}</select>
    </div>
    <div class="resultcount" id="count"></div>
    <div id="results"></div>`;
  const run = () => {
    const res = PSearch.search(S.programmes, f.q, f);
    $('#count').textContent = `${res.length} of ${S.programmes.length} programmes${f.q ? ' · ranked by relevance' : ''}`;
    $('#results').innerHTML = res.length
      ? `<div class="cards">${res.map(r => programmeCard(r.programme)).join('')}</div>`
      : `<div class="empty">${S.programmes.length ? 'No programmes match. Try fewer filters, or let AI generate ideas in <b>Discover &amp; Ideate</b>.' : 'Your library is empty. Create a programme or generate ideas with AI.'}</div>`;
    bindCards($('#results'));
  };
  $('#q').oninput = e => { f.q = e.target.value; run(); };
  $('#fAge').onchange = e => { f.ageGroup = e.target.value; run(); };
  $('#fFormat').onchange = e => { f.format = e.target.value; run(); };
  $('#fStatus').onchange = e => { f.status = e.target.value; run(); };
  $('#fTheme').onchange = e => { f.theme = e.target.value; run(); };
  $('#newBtn').onclick = () => go('programme', 'new');
  $('#importBtn').onclick = importLibrary;
  run();
  $('#q').focus();
}

// ---------- Programme editor ----------
function viewProgramme() {
  if (!S.edit || S.edit._for !== S.id) {
    const src = S.id === 'new' ? newProgramme() : S.programmes.find(p => p.id === S.id);
    if (!src) return go('library');
    S.edit = { ...clone(src), _for: S.id };
  }
  const p = S.edit;
  main().innerHTML = `
    <div class="topbar">
      <button class="btn ghost" id="back">← Library</button><div class="spacer"></div>
      <select id="status" style="width:auto">${opts(STATUSES, p.status)}</select>
      <button class="btn" id="moreBtn">Export ▾</button>
      ${p.id ? '<button class="btn ghost danger" id="delBtn">Delete</button>' : ''}
      <button class="btn primary" id="saveBtn">Save</button>
    </div>
    <div class="editor">
      <div>
        <input class="title-input" type="text" data-bind="title" placeholder="Programme title" value="${esc(p.title)}">
        <label class="field" style="margin-top:6px"><textarea data-bind="summary" rows="2" placeholder="Short summary: what is it and who is it for?">${esc(p.summary)}</textarea></label>

        <div class="panel"><h2>Details</h2>
          <div class="grid3">
            <label class="field"><span>Age group</span><select data-bind="ageGroup">${opts(AGE_GROUPS, p.ageGroup)}</select></label>
            <label class="field"><span>Format</span><select data-bind="format">${opts(FORMATS, p.format)}</select></label>
            <label class="field"><span>Duration</span><input type="text" data-bind="duration" placeholder="e.g. 6 weeks, 90 min/week" value="${esc(p.duration)}"></label>
            <label class="field"><span>Group size</span><input type="text" data-bind="groupSize" placeholder="e.g. 12-20" value="${esc(p.groupSize)}"></label>
            <label class="field"><span>Budget</span><input type="text" data-bind="budget" placeholder="e.g. ~$300" value="${esc(p.budget)}"></label>
            <label class="field"><span>Add theme</span><input type="text" id="themeInput" placeholder="type and press Enter"></label>
          </div>
          <div class="chips" id="themes"></div>
        </div>

        <div class="panel"><h2>Objectives &amp; outcomes</h2>
          <label class="field"><span>Learning objectives <em class="hint">(one per line)</em></span><textarea data-bind-lines="objectives" rows="4">${esc((p.objectives || []).join('\n'))}</textarea></label>
          <label class="field"><span>How success is measured</span><textarea data-bind="outcomes" rows="2">${esc(p.outcomes)}</textarea></label>
        </div>

        <div class="panel"><h2>Sessions <span class="hint">${(p.sessions || []).length} planned</span></h2>
          <div id="sessions"></div>
          <button class="btn" id="addSession">+ Add session</button>
        </div>

        <div class="panel"><h2>Resources &amp; safety</h2>
          <label class="field"><span>Materials <em class="hint">(one per line)</em></span><textarea data-bind-lines="materials" rows="3">${esc((p.materials || []).join('\n'))}</textarea></label>
          <label class="field"><span>Risk &amp; safeguarding notes</span><textarea data-bind="riskNotes" rows="3">${esc(p.riskNotes)}</textarea></label>
        </div>

        <div class="panel"><h2>Documents <span class="hint">built from templates</span></h2>
          <div id="docs"></div>
          <div class="row"><button class="btn" id="applyTpl">Apply a template…</button></div>
        </div>

        <div class="panel"><h2>Notes &amp; reflection</h2>
          <label class="field"><span>Rating</span><div class="rating" id="rating"></div></label>
          <label class="field"><span>Facilitator notes</span><textarea data-bind="notes" rows="4" placeholder="What worked, what to change next time…">${esc(p.notes)}</textarea></label>
          ${p.updatedAt ? `<div class="hint">Created ${fmtDate(p.createdAt)} · Updated ${fmtDate(p.updatedAt)}</div>` : ''}
        </div>
      </div>

      <div class="side">
        <div class="panel"><h2>✦ AI assist</h2>
          <div style="display:flex;flex-direction:column;gap:8px">
            <button class="btn ai" id="aiBuild">Build full session plan</button>
            <button class="btn" id="aiImprove">Review &amp; improve in AI Studio</button>
            <button class="btn" id="aiVariants">Generate variations</button>
          </div>
          <div class="hint" style="margin-top:8px">AI uses this programme and similar ones from your library as context.</div>
        </div>
        <div class="panel"><h2>Similar in your library</h2><div id="similar"></div></div>
      </div>
    </div>`;

  const markDirty = () => { S.dirty = true; };
  $$('[data-bind]').forEach(el => el.addEventListener('input', () => { p[el.dataset.bind] = el.value; markDirty(); }));
  $$('[data-bind-lines]').forEach(el => el.addEventListener('input', () => { p[el.dataset.bindLines] = lines(el.value); markDirty(); }));
  $('#status').onchange = e => { p.status = e.target.value; markDirty(); };
  $('#back').onclick = () => go('library');
  $('#saveBtn').onclick = saveProgramme;
  if ($('#delBtn')) $('#delBtn').onclick = deleteProgramme;
  $('#moreBtn').onclick = exportMenu;
  $('#addSession').onclick = () => { p.sessions = p.sessions || []; p.sessions.push({ title: '', duration: '', activities: '', materials: '' }); markDirty(); renderSessions(); };
  $('#applyTpl').onclick = () => applyTemplateFlow(p);
  $('#aiBuild').onclick = e => aiBuildPlan(e.currentTarget);
  $('#aiImprove').onclick = () => { S.chat.focusId = p.id || null; S.chat.focusDraft = clone(p); S.chat.draft = `Review "${p.title || 'this programme'}" and suggest specific improvements: engagement, inclusion, session flow, and safeguarding.`; go('studio'); };
  $('#aiVariants').onclick = () => {
    S.discover.brief = { ageGroup: p.ageGroup, format: '', duration: p.duration, groupSize: p.groupSize, interests: (p.themes || []).join(', '), goals: `Variations on "${p.title}": ${p.summary}`, constraints: p.budget ? 'Budget ' + p.budget : '' };
    S.discover.ideas = null; S.discover.recs = null; S.discover.autoIdeate = true;
    go('discover');
  };
  const ti = $('#themeInput');
  ti.onkeydown = e => {
    if (e.key === 'Enter' && ti.value.trim()) {
      const t = ti.value.trim().toLowerCase();
      if (!p.themes.includes(t)) p.themes.push(t);
      ti.value = ''; markDirty(); renderThemes(); renderSimilar();
    }
  };
  renderThemes(); renderSessions(); renderDocs(); renderRating(); renderSimilar();
}

function renderThemes() {
  const p = S.edit;
  $('#themes').innerHTML = (p.themes || []).map((t, i) => `<span class="chip" data-i="${i}">${esc(t)}<span class="x">✕</span></span>`).join('') || '<span class="hint">No themes yet. Themes improve search and recommendations.</span>';
  $$('#themes .chip').forEach(c => c.onclick = () => { p.themes.splice(+c.dataset.i, 1); S.dirty = true; renderThemes(); });
}

function renderSessions() {
  const p = S.edit;
  const list = p.sessions || [];
  $('#sessions').innerHTML = list.map((s, i) => `
    <div class="session" data-i="${i}">
      <div class="session-head"><span class="num">${i + 1}</span>
        <input type="text" data-f="title" placeholder="Session title" value="${esc(s.title)}">
        <input type="text" data-f="duration" placeholder="Duration" style="width:120px" value="${esc(s.duration)}">
        <button class="btn ghost small" data-act="up" title="Move up">↑</button>
        <button class="btn ghost small" data-act="down" title="Move down">↓</button>
        <button class="btn ghost small danger" data-act="del" title="Remove">✕</button>
      </div>
      <textarea data-f="activities" rows="4" placeholder="Run-sheet / activities">${esc(s.activities)}</textarea>
      <input type="text" data-f="materials" placeholder="Materials for this session" style="margin-top:6px" value="${esc(s.materials)}">
    </div>`).join('') || '<p class="hint">No sessions yet. Add them by hand or use “Build full session plan”.</p>';
  $$('#sessions .session').forEach(el => {
    const i = +el.dataset.i;
    $$('[data-f]', el).forEach(inp => inp.addEventListener('input', () => { list[i][inp.dataset.f] = inp.value; S.dirty = true; }));
    $$('[data-act]', el).forEach(b => b.onclick = () => {
      const a = b.dataset.act;
      if (a === 'del') list.splice(i, 1);
      if (a === 'up' && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
      if (a === 'down' && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
      S.dirty = true; renderSessions();
    });
  });
}

function renderDocs() {
  const p = S.edit;
  const docs = p.document || [];
  const tpl = p.templateId && S.templates.find(t => t.id === p.templateId);
  $('#docs').innerHTML = docs.length ? `
    ${tpl ? `<div class="hint" style="margin-bottom:10px">From template: <b>${esc(tpl.name)}</b></div>` : ''}
    ${docs.map((d, i) => `<label class="field"><span>${esc(d.heading)}</span><textarea data-doc="${i}" rows="4">${esc(d.content)}</textarea></label>`).join('')}
    <div class="row" style="margin-bottom:12px">
      <button class="btn ai small" id="aiFillDoc">✦ Complete with AI</button>
      <button class="btn small" id="exportDoc">Export document</button>
      <button class="btn ghost small danger" id="clearDoc">Remove document</button>
    </div>` : '<p class="hint">Apply a template (e.g. a funding proposal or risk assessment) to generate a document from this programme.</p>';
  $$('[data-doc]').forEach(t => t.addEventListener('input', () => { docs[+t.dataset.doc].content = t.value; S.dirty = true; }));
  if ($('#aiFillDoc')) $('#aiFillDoc').onclick = e => aiFillDocument(e.currentTarget);
  if ($('#exportDoc')) $('#exportDoc').onclick = () => exportDocumentMenu(p);
  if ($('#clearDoc')) $('#clearDoc').onclick = () => { p.document = []; p.templateId = null; S.dirty = true; renderDocs(); };
}

function renderRating() {
  const p = S.edit;
  $('#rating').innerHTML = [1, 2, 3, 4, 5].map(n => `<button class="${n <= (p.rating || 0) ? 'on' : ''}" data-n="${n}">★</button>`).join('') + (p.rating ? ' <button class="btn ghost small" data-n="0">clear</button>' : '');
  $$('#rating [data-n]').forEach(b => b.onclick = e => { e.preventDefault(); p.rating = +b.dataset.n; S.dirty = true; renderRating(); });
}

function renderSimilar() {
  const p = S.edit;
  const recs = PSearch.recommend(S.programmes, p, { excludeId: p.id, limit: 5 });
  $('#similar').innerHTML = recs.length ? recs.map(r => `<div class="mini" data-open="${esc(r.programme.id)}"><b>${esc(r.programme.title)}</b><span>Ages ${esc(r.programme.ageGroup)} · ${esc(r.programme.format)} ${stars(r.programme.rating)}</span></div>`).join('')
    : '<p class="hint">Add a title and themes to see related programmes.</p>';
  bindCards($('#similar'));
}

async function saveProgramme() {
  const p = S.edit;
  if (!p.title.trim()) { toast('Give the programme a title first.', true); $('.title-input').focus(); return; }
  const { _for, ...item } = p;
  const saved = await api.upsert('programmes', item);
  await reload();
  S.dirty = false;
  S.edit = { ...clone(saved), _for: saved.id };
  S.id = saved.id;
  toast('Programme saved');
  render();
}

async function deleteProgramme() {
  const p = S.edit;
  if (!(await confirmBox('Delete programme?', `"${p.title}" will be permanently removed from your library.`, 'Delete', true))) return;
  await api.remove('programmes', p.id);
  await reload();
  S.dirty = false; S.edit = null;
  toast('Programme deleted');
  go('library');
}

function similarFor(p, n = 5) {
  return PSearch.recommend(S.programmes, p, { excludeId: p.id, limit: n }).map(r => r.programme);
}

async function aiBuildPlan(btn) {
  const p = S.edit;
  if (!p.title.trim() && !p.summary.trim()) { toast('Add at least a title or summary for AI to work from.', true); return; }
  if ((p.sessions || []).length && !(await confirmBox('Replace current plan?', 'AI will draft a complete plan (sessions, objectives, materials, risks). Fields it fills will replace what is there now. You can review before saving.', 'Build plan'))) return;
  const result = await busy(btn, 'Drafting plan…', () => api.ai.develop({ idea: stripForAi(p), similar: similarFor(p, 3) }));
  if (!result) return;
  Object.assign(p, result, { status: p.status === 'idea' ? 'draft' : p.status });
  S.dirty = true;
  toast('Plan drafted. Review and Save.');
  render();
}

function stripForAi(p) {
  const { _for, id, createdAt, updatedAt, document, templateId, rating, notes, ...rest } = p;
  return rest;
}

// ---------- Export ----------
function programmeMarkdown(p) {
  const out = [`# ${p.title}`, '', p.summary, '',
    `**Age group:** ${p.ageGroup}  `, `**Format:** ${p.format}  `, `**Duration:** ${p.duration || '-'}  `, `**Group size:** ${p.groupSize || '-'}  `, `**Budget:** ${p.budget || '-'}  `, `**Themes:** ${(p.themes || []).join(', ')}`, ''];
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
  if (docOnly) {
    return `<h1>${esc(tpl ? tpl.name : 'Document')}: ${esc(p.title)}</h1><div class="pmeta">${meta}</div>` +
      p.document.map(d => `<h2>${esc(d.heading)}</h2><p>${esc(d.content)}</p>`).join('');
  }
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
  try {
    const f = await api.savePdf(`${slug(p.title)}${docOnly ? '-document' : ''}.pdf`);
    if (f) toast('Saved PDF');
  } catch (e) { toast(e.message, true); }
  $('#print').innerHTML = '';
}

function exportMenu() {
  const p = S.edit;
  modal(`<h2>Export “${esc(p.title || 'programme')}”</h2>
    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="btn" id="xPdf">PDF (printable plan)</button>
      <button class="btn" id="xMd">Markdown (.md)</button>
      <button class="btn" id="xDup">Duplicate as new programme</button>
    </div><div class="foot"><button class="btn" data-close>Close</button></div>`, (m, close) => {
    $('#xPdf', m).onclick = () => { close(); exportPdf(p, false); };
    $('#xMd', m).onclick = async () => { close(); const f = await api.saveText(`${slug(p.title)}.md`, programmeMarkdown(p), 'md'); if (f) toast('Saved Markdown'); };
    $('#xDup', m).onclick = async () => {
      close();
      const { _for, id, createdAt, updatedAt, ...rest } = p;
      const saved = await api.upsert('programmes', { ...rest, title: p.title + ' (copy)', status: 'draft', rating: 0 });
      await reload(); S.dirty = false; S.edit = null; toast('Duplicated'); go('programme', saved.id);
    };
  });
}

function exportDocumentMenu(p) {
  modal(`<h2>Export document</h2><div style="display:flex;flex-direction:column;gap:8px">
      <button class="btn" id="dPdf">PDF</button><button class="btn" id="dMd">Markdown (.md)</button></div>
      <div class="foot"><button class="btn" data-close>Close</button></div>`, (m, close) => {
    $('#dPdf', m).onclick = () => { close(); exportPdf(p, true); };
    $('#dMd', m).onclick = async () => {
      close();
      const md = [`# ${p.title}`, '', ...p.document.flatMap(d => [`## ${d.heading}`, d.content, ''])].join('\n');
      const f = await api.saveText(`${slug(p.title)}-document.md`, md, 'md'); if (f) toast('Saved Markdown');
    };
  });
}

// ---------- Templates applied to programmes ----------
function fillPlaceholders(text, p) {
  const vals = {
    programme_title: p.title, age_group: p.ageGroup, format: p.format, duration: p.duration, group_size: p.groupSize,
    objectives: (p.objectives || []).map(o => '- ' + o).join('\n'), summary: p.summary,
    facilitator: S.settings.facilitator, organisation: S.settings.organisation,
    date: new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }),
  };
  return String(text || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => (vals[k] ? vals[k] : m));
}

function applyTemplateFlow(p, presetTplId) {
  if (!S.templates.length) { toast('No templates yet. Create one in Templates.', true); return; }
  modal(`<h2>Apply a template</h2>
    <label class="field"><span>Template</span><select id="tplSel">${S.templates.map(t => `<option value="${esc(t.id)}" ${t.id === presetTplId ? 'selected' : ''}>${esc(t.name)} — ${esc(t.category || '')}</option>`).join('')}</select></label>
    <p class="hint" id="tplDesc"></p>
    <label class="row" style="gap:8px"><input type="checkbox" id="useAi" ${S.settings.hasApiKey ? 'checked' : ''}> Complete the sections with AI using this programme's details</label>
    ${(p.document || []).length ? '<p class="hint" style="color:var(--warn)">This replaces the programme’s current document.</p>' : ''}
    <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Apply</button></div>`, (m, close) => {
    const desc = () => { const t = S.templates.find(x => x.id === $('#tplSel', m).value); $('#tplDesc', m).textContent = t ? `${t.description} (${t.sections.length} sections)` : ''; };
    $('#tplSel', m).onchange = desc; desc();
    $('#go', m).onclick = async () => {
      const t = S.templates.find(x => x.id === $('#tplSel', m).value);
      const useAi = $('#useAi', m).checked;
      p.templateId = t.id;
      p.document = t.sections.map(s => ({ heading: s.heading, content: fillPlaceholders(s.content, p) }));
      S.dirty = true;
      close();
      if (S.view !== 'programme') { S.edit = p; S.id = p._for; S.view = 'programme'; render(); }
      else renderDocs();
      if (useAi) aiFillDocument($('#aiFillDoc'));
    };
  });
}

async function aiFillDocument(btn) {
  const p = S.edit;
  const t = S.templates.find(x => x.id === p.templateId);
  const template = t ? { sections: t.sections.map((s, i) => ({ ...s, content: (p.document[i] && p.document[i].content) || s.content })) }
    : { sections: p.document.map(d => ({ heading: d.heading, guidance: '', content: d.content })) };
  const sections = await busy(btn, 'Writing document…', () => api.ai.fillTemplate({ template, programme: stripForAi(p) }));
  if (!sections) return;
  p.document = sections.map(s => ({ heading: s.heading, content: s.content }));
  S.dirty = true;
  renderDocs();
  toast('Document completed. Review and Save.');
}

// ---------- Discover & Ideate ----------
function viewDiscover() {
  const D = S.discover, b = D.brief;
  main().innerHTML = `
    <div class="topbar"><h1>Discover &amp; Ideate</h1><div class="spacer"></div></div>
    <p class="subtitle">Describe who you're planning for. Find proven programmes in your library, or let AI generate fresh ideas that build on them.</p>
    <div class="panel"><h2>Your brief</h2>
      <div class="grid4">
        <label class="field"><span>Age group</span><select data-b="ageGroup">${opts(AGE_GROUPS, b.ageGroup, 'Any')}</select></label>
        <label class="field"><span>Format</span><select data-b="format">${opts(FORMATS, b.format, 'Any / suggest')}</select></label>
        <label class="field"><span>Duration</span><input type="text" data-b="duration" placeholder="e.g. 8 weeks" value="${esc(b.duration)}"></label>
        <label class="field"><span>Group size</span><input type="text" data-b="groupSize" placeholder="e.g. 15" value="${esc(b.groupSize)}"></label>
      </div>
      <label class="field"><span>Interests &amp; themes</span><input type="text" data-b="interests" placeholder="e.g. music, coding, outdoors, mental health" value="${esc(b.interests)}"></label>
      <div class="grid2">
        <label class="field"><span>Goals / needs</span><textarea data-b="goals" rows="3" placeholder="What should young people gain? Any specific needs in the group?">${esc(b.goals)}</textarea></label>
        <label class="field"><span>Constraints</span><textarea data-b="constraints" rows="3" placeholder="Budget, venue, staffing, accessibility, timing…">${esc(b.constraints)}</textarea></label>
      </div>
      <div class="chips" style="margin-bottom:14px">${PSearch.allThemes(S.programmes).slice(0, 14).map(t => `<span class="chip" data-theme="${esc(t)}">+ ${esc(t)}</span>`).join('')}</div>
      <div class="row">
        <button class="btn primary" id="findBtn">Search library</button>
        <button class="btn ai" id="ideaBtn">✦ Generate new ideas with AI</button>
        <div style="flex:1"></div>
        <button class="btn ghost" id="clearBtn">Clear</button>
      </div>
    </div>
    <div id="recs"></div>
    <div id="ideas"></div>`;
  $$('[data-b]').forEach(el => el.addEventListener('input', () => { b[el.dataset.b] = el.value; }));
  $$('[data-theme]').forEach(c => c.onclick = () => {
    const cur = lines(b.interests.replace(/,/g, '\n'));
    if (!cur.includes(c.dataset.theme)) cur.push(c.dataset.theme);
    b.interests = cur.join(', '); $('[data-b=interests]').value = b.interests;
  });
  $('#findBtn').onclick = () => { D.recs = findRecs(); renderRecs(); };
  $('#ideaBtn').onclick = e => generateIdeas(e.currentTarget);
  $('#clearBtn').onclick = () => { Object.keys(b).forEach(k => b[k] = ''); D.recs = null; D.ideas = null; render(); };
  renderRecs(); renderIdeas();
  if (D.autoIdeate) { D.autoIdeate = false; D.recs = findRecs(); renderRecs(); generateIdeas($('#ideaBtn')); }
}

function briefText(b) { return [b.interests, b.goals, b.format, b.constraints].join(' '); }

function findRecs() {
  const b = S.discover.brief;
  const text = briefText(b);
  if (!text.trim() && !b.ageGroup) return PSearch.search(S.programmes, '', {}).slice(0, 6).map(r => ({ ...r, reasons: [] }));
  return PSearch.recommend(S.programmes, text || b.ageGroup, { ageGroup: b.ageGroup, limit: 6 });
}

function renderRecs() {
  const recs = S.discover.recs;
  if (!recs) { $('#recs').innerHTML = ''; return; }
  $('#recs').innerHTML = `<div class="panel"><h2>From your library <span class="hint">${recs.length ? 'best matches for your brief' : ''}</span></h2>
    ${recs.length ? `<div class="cards">${recs.map(r => programmeCard(r.programme, r.reasons && r.reasons.length ? `<div class="reasons">✓ ${esc(r.reasons.join(' · '))}</div>` : '')).join('')}</div>`
    : '<p class="hint">Nothing similar in your library yet. Generate new ideas with AI.</p>'}</div>`;
  bindCards($('#recs'));
}

async function generateIdeas(btn) {
  const D = S.discover;
  const b = D.brief;
  if (!Object.values(b).some(v => String(v).trim())) { toast('Fill in at least one part of the brief.', true); return; }
  D.recs = D.recs || findRecs(); renderRecs();
  $('#ideas').innerHTML = `<div class="panel loading-panel"><span class="spinner"></span>Claude is brainstorming ideas…</div>`;
  const similar = (D.recs || []).map(r => r.programme).slice(0, 6);
  const brief = { 'Age group': b.ageGroup || 'any', 'Preferred format': b.format || 'suggest the best fit', Duration: b.duration, 'Group size': b.groupSize, 'Interests/themes': b.interests, Goals: b.goals, Constraints: b.constraints };
  const ideas = await busy(btn, 'Generating…', () => api.ai.ideate({ brief, similar }));
  D.ideas = ideas || D.ideas;
  D.lastBrief = brief;
  renderIdeas();
}

function renderIdeas() {
  const ideas = S.discover.ideas;
  if (!ideas) { $('#ideas').innerHTML = ''; return; }
  $('#ideas').innerHTML = `<div class="panel"><h2>✦ New ideas from AI</h2><div class="cards">${ideas.map((d, i) => `
    <div class="idea">
      <h3>${esc(d.title)}</h3>
      <div class="hook">“${esc(d.hook)}”</div>
      <div>${esc(d.summary)}</div>
      <div class="meta hint">Ages ${esc(d.ageGroup)} · ${esc(d.format)} · ${esc(d.duration)}</div>
      <ul>${(d.objectives || []).slice(0, 4).map(o => `<li>${esc(o)}</li>`).join('')}</ul>
      <div class="why">Why it works: ${esc(d.whyItWorks)}</div>
      <div class="chips">${(d.themes || []).map(t => `<span class="pill tag">${esc(t)}</span>`).join('')}</div>
      <div class="actions">
        <button class="btn ai small" data-dev="${i}">Develop full plan</button>
        <button class="btn small" data-save="${i}">Save as idea</button>
        <button class="btn ghost small" data-chat="${i}">Discuss</button>
      </div>
    </div>`).join('')}</div></div>`;
  $$('[data-save]').forEach(bn => bn.onclick = async () => {
    const d = ideas[+bn.dataset.save];
    await api.upsert('programmes', ideaToProgramme(d, 'idea'));
    await reload(); bn.textContent = 'Saved ✓'; bn.disabled = true; toast('Saved to library as an idea');
  });
  $$('[data-dev]').forEach(bn => bn.onclick = async () => {
    const d = ideas[+bn.dataset.dev];
    const similar = PSearch.recommend(S.programmes, d, { limit: 3 }).map(r => r.programme);
    const full = await busy(bn, 'Developing…', () => api.ai.develop({ idea: d, brief: S.discover.lastBrief, similar }));
    if (!full) return;
    const saved = await api.upsert('programmes', { ...newProgramme(), ...full, status: 'draft' });
    await reload(); toast('Full plan created and saved as a draft');
    S.edit = null; go('programme', saved.id);
  });
  $$('[data-chat]').forEach(bn => bn.onclick = () => {
    const d = ideas[+bn.dataset.chat];
    S.chat.draft = `Let's develop this idea further:\n\n${d.title} — ${d.summary}\n\nWhat could make it more engaging, and what risks should I plan for?`;
    go('studio');
  });
}

function ideaToProgramme(d, status) {
  return newProgramme({ title: d.title, summary: d.summary + (d.hook ? `\n\nPitch: ${d.hook}` : ''), ageGroup: d.ageGroup, format: d.format, duration: d.duration, themes: (d.themes || []).map(t => t.toLowerCase()), objectives: d.objectives || [], notes: d.whyItWorks ? 'Why it works: ' + d.whyItWorks : '', status });
}

// ---------- AI Studio (chat) ----------
function libraryContext() {
  const C = S.chat;
  const parts = [];
  const focus = C.focusDraft || (C.focusId && S.programmes.find(p => p.id === C.focusId));
  if (focus) parts.push('PROGRAMME THE USER IS WORKING ON:\n' + JSON.stringify(stripForAi(focus), null, 1));
  parts.push('LIBRARY OVERVIEW:\n' + S.programmes.slice(0, 80).map(p => `- ${p.title} | ages ${p.ageGroup} | ${p.format} | ${p.status}${p.rating ? ' | ' + p.rating + '★' : ''} | ${(p.themes || []).join(', ')}`).join('\n'));
  return parts.join('\n\n');
}

function viewStudio() {
  const C = S.chat;
  const focus = C.focusDraft || (C.focusId && S.programmes.find(p => p.id === C.focusId));
  main().innerHTML = `
    <div class="topbar"><h1>AI Studio</h1><div class="spacer"></div>
      <button class="btn ghost" id="newChat">New conversation</button></div>
    <div class="chat">
      ${focus ? `<div class="banner">Working on <b>${esc(focus.title || 'untitled programme')}</b><div style="flex:1"></div><button class="btn small" id="unfocus">Clear focus</button></div>` : ''}
      ${!S.settings.hasApiKey ? `<div class="banner">AI is off. <a href="#" id="toSettings">Add your Anthropic API key in Settings</a> to start.</div>` : ''}
      <div class="messages" id="msgs"></div>
      <div class="chips" id="starters" style="margin-bottom:8px"></div>
      <div class="composer">
        <textarea id="prompt" placeholder="Brainstorm activities, ice-breakers, session plans, funding pitches… (⌘↩ to send)">${esc(C.draft || '')}</textarea>
        <button class="btn primary" id="send">Send</button>
      </div>
    </div>`;
  C.draft = '';
  const starters = ['Suggest 10 ice-breakers for shy 13-15 year olds', 'Plan a 1-day outdoor leadership event for 16-18s', 'What programmes am I missing for ages 9-12?', 'Write a parent letter for a weekend camp', 'Ideas to make my programmes more inclusive'];
  if (!C.messages.length) {
    $('#starters').innerHTML = starters.map(s => `<span class="chip">${esc(s)}</span>`).join('');
    $$('#starters .chip').forEach(c => c.onclick = () => { $('#prompt').value = c.textContent; $('#prompt').focus(); });
    $('#msgs').innerHTML = `<div class="empty">Brainstorm with Claude. It can see your library${focus ? ' and the programme you’re working on' : ''}, so ask for gaps, variations, activities or full plans.</div>`;
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
       ${!m.streaming && m.content ? `<div class="msg-actions"><button class="btn small" data-copy="${i}">Copy</button><button class="btn small" data-tonote="${i}">Save as new programme idea</button></div>` : ''}</div>`).join('');
  $$('[data-copy]').forEach(b => b.onclick = () => { navigator.clipboard.writeText(C.messages[+b.dataset.copy].content); toast('Copied'); });
  $$('[data-tonote]').forEach(b => b.onclick = async () => {
    const text = C.messages[+b.dataset.tonote].content;
    const firstHeading = (text.match(/^#+\s*(.+)$/m) || [])[1] || (text.match(/\*\*(.+?)\*\*/) || [])[1] || 'Idea from AI Studio';
    const saved = await api.upsert('programmes', newProgramme({ title: firstHeading.slice(0, 80), summary: '', notes: text, status: 'idea' }));
    await reload(); toast('Saved as an idea'); S.edit = null; go('programme', saved.id);
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
      if (!pending && S.view === 'studio') { pending = true; requestAnimationFrame(() => { pending = false; if (S.view === 'studio') renderMessages(); }); }
    });
    reply.content = final || reply.content;
  } catch (e) {
    toast(e.message, true);
    if (!reply.content) { C.messages.splice(C.messages.indexOf(reply) - 1, 2); if (S.view === 'studio') $('#prompt').value = text; }
  } finally {
    reply.streaming = false; C.busy = false;
    if (S.view === 'studio') { $('#send').disabled = false; if (C.messages.length) renderMessages(); else render(); }
  }
}

// ---------- Templates ----------
function viewTemplates() {
  main().innerHTML = `
    <div class="topbar"><h1>Templates</h1><div class="spacer"></div>
      <button class="btn ai" id="aiTpl">✦ Draft a template with AI</button>
      <button class="btn primary" id="newTpl">+ New template</button></div>
    <p class="subtitle">Reusable documents (plans, proposals, risk assessments, evaluations). Use <code>{{placeholders}}</code> such as {{programme_title}} that fill in automatically.</p>
    ${S.templates.length ? `<div class="cards">${S.templates.map(t => `
      <div class="card" data-tpl="${esc(t.id)}">
        <div class="row" style="justify-content:space-between"><h3>${esc(t.name)}</h3><span class="pill">${esc(t.category || 'General')}</span></div>
        <p>${esc(t.description)}</p>
        <div class="meta">${t.sections.length} sections · updated ${fmtDate(t.updatedAt)}</div>
      </div>`).join('')}</div>` : '<div class="empty">No templates yet.</div>'}`;
  $$('[data-tpl]').forEach(c => c.onclick = () => go('template', c.dataset.tpl));
  $('#newTpl').onclick = () => go('template', 'new');
  $('#aiTpl').onclick = () => modal(`<h2>✦ Draft a template with AI</h2>
      <label class="field"><span>What should the template be for?</span><textarea id="tdesc" rows="4" placeholder="e.g. A one-page session plan for volunteer leaders running a weekly drop-in, including a debrief section"></textarea></label>
      <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn ai" id="tgo">Draft template</button></div>`, (m, close) => {
    $('#tgo', m).onclick = async e => {
      const description = $('#tdesc', m).value.trim();
      if (!description) return;
      const t = await busy(e.currentTarget, 'Drafting…', () => api.ai.draftTemplate({ description }));
      if (!t) return;
      close();
      S.tplEdit = { ...t, sections: t.sections.map((s, i) => ({ id: 's' + (i + 1), ...s })), _for: 'new' };
      S.dirty = true;
      S.view = 'template'; S.id = 'new'; render();
      toast('Template drafted. Review and Save.');
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
    <div class="topbar"><button class="btn ghost" id="back">← Templates</button><div class="spacer"></div>
      ${t.id ? '<button class="btn ghost danger" id="delTpl">Delete</button><button class="btn" id="dupTpl">Duplicate</button><button class="btn" id="useTpl">Use template…</button>' : ''}
      <button class="btn primary" id="saveTpl">Save</button></div>
    <div class="editor"><div>
      <input class="title-input" type="text" data-t="name" placeholder="Template name" value="${esc(t.name)}">
      <div class="grid2" style="margin-top:8px">
        <label class="field"><span>Category</span><input type="text" data-t="category" value="${esc(t.category)}"></label>
        <label class="field"><span>Description</span><input type="text" data-t="description" value="${esc(t.description)}"></label>
      </div>
      <div id="tsections"></div>
      <button class="btn" id="addSec">+ Add section</button>
    </div>
    <div class="side"><div class="panel"><h2>Placeholders</h2>
      <p class="hint">Click to copy. They are replaced with programme details when the template is applied.</p>
      <div class="chips">${PLACEHOLDERS.map(k => `<span class="chip" data-ph="${k}">{{${k}}}</span>`).join('')}</div>
    </div></div></div>`;
  $$('[data-t]').forEach(el => el.addEventListener('input', () => { t[el.dataset.t] = el.value; S.dirty = true; }));
  $$('[data-ph]').forEach(c => c.onclick = () => { navigator.clipboard.writeText(`{{${c.dataset.ph}}}`); toast('Copied {{' + c.dataset.ph + '}}'); });
  $('#back').onclick = () => go('templates');
  $('#addSec').onclick = () => { t.sections.push({ id: 's' + Date.now(), heading: '', guidance: '', content: '' }); S.dirty = true; renderTplSections(); };
  $('#saveTpl').onclick = saveTemplate;
  if (t.id) {
    $('#delTpl').onclick = async () => {
      if (!(await confirmBox('Delete template?', `"${t.name}" will be removed. Documents already created from it are kept.`, 'Delete', true))) return;
      await api.remove('templates', t.id); await reload(); S.dirty = false; S.tplEdit = null; go('templates');
    };
    $('#dupTpl').onclick = async () => {
      const { _for, id, createdAt, updatedAt, ...rest } = t;
      const saved = await api.upsert('templates', { ...rest, name: t.name + ' (copy)' });
      await reload(); S.dirty = false; S.tplEdit = null; go('template', saved.id);
    };
    $('#useTpl').onclick = useTemplateFlow;
  }
  renderTplSections();
}

function renderTplSections() {
  const t = S.tplEdit;
  $('#tsections').innerHTML = t.sections.map((s, i) => `
    <div class="tpl-section" data-i="${i}">
      <div class="session-head"><span class="num">${i + 1}</span>
        <input type="text" data-s="heading" placeholder="Section heading" value="${esc(s.heading)}">
        <button class="btn ghost small" data-act="up">↑</button><button class="btn ghost small" data-act="down">↓</button>
        <button class="btn ghost small danger" data-act="del">✕</button></div>
      <input type="text" data-s="guidance" placeholder="Guidance for the author (optional)" value="${esc(s.guidance)}" style="margin-bottom:6px">
      <textarea data-s="content" rows="4" placeholder="Starter content with {{placeholders}}">${esc(s.content)}</textarea>
    </div>`).join('');
  $$('#tsections .tpl-section').forEach(el => {
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
  S.dirty = false; S.tplEdit = { ...clone(saved), _for: saved.id }; S.id = saved.id;
  toast('Template saved'); render();
}

function useTemplateFlow() {
  const t = S.tplEdit;
  if (S.dirty) { toast('Save the template first.', true); return; }
  modal(`<h2>Use “${esc(t.name)}”</h2>
    <label class="field"><span>Apply to</span><select id="target"><option value="new">A new programme</option>
      ${S.programmes.map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('')}</select></label>
    <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Continue</button></div>`, (m, close) => {
    $('#go', m).onclick = () => {
      const target = $('#target', m).value;
      close();
      S.dirty = false;
      const src = target === 'new' ? newProgramme({ title: '' }) : S.programmes.find(p => p.id === target);
      S.edit = { ...clone(src), _for: target };
      S.view = 'programme'; S.id = target;
      $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === 'library'));
      render();
      if (target === 'new') {
        S.edit.templateId = t.id;
        S.edit.document = t.sections.map(s => ({ heading: s.heading, content: fillPlaceholders(s.content, S.edit) }));
        S.dirty = true; renderDocs();
        toast('Add programme details, then use “Complete with AI” to finish the document.');
      } else {
        applyTemplateFlow(S.edit, t.id);
      }
    };
  });
}

// ---------- Settings ----------
function viewSettings() {
  const st = S.settings;
  main().innerHTML = `
    <div class="topbar"><h1>Settings</h1><div class="spacer"></div></div>
    <div class="panel" style="max-width:720px"><h2>AI (Claude)</h2>
      <p class="hint" style="margin-top:-6px">AI features use your own Anthropic API key. Create one at console.anthropic.com → API Keys. The key is encrypted with your Mac’s Keychain and only used to call the Claude API.</p>
      <label class="field"><span>Anthropic API key ${st.hasApiKey ? `<em class="hint">(saved: ${esc(st.apiKeyHint)})</em>` : ''}</span>
        <input type="password" id="key" placeholder="${st.hasApiKey ? 'Enter a new key to replace the saved one' : 'sk-ant-…'}"></label>
      <label class="field"><span>Model</span><input type="text" id="model" value="${esc(st.model)}">
        <span class="hint" style="text-transform:none;font-weight:400;letter-spacing:0">Default: ${esc(st.defaultModel)}. You can use e.g. claude-sonnet-5-5 for lower cost.</span></label>
      <div class="row"><button class="btn primary" id="saveAi">Save</button><button class="btn" id="testAi" ${st.hasApiKey ? '' : 'disabled'}>Test connection</button>
        ${st.hasApiKey ? '<button class="btn ghost danger" id="rmKey">Remove key</button>' : ''}</div>
    </div>
    <div class="panel" style="max-width:720px"><h2>Your details</h2>
      <p class="hint" style="margin-top:-6px">Used to fill {{facilitator}} and {{organisation}} in templates.</p>
      <div class="grid2">
        <label class="field"><span>Facilitator name</span><input type="text" id="fac" value="${esc(st.facilitator)}"></label>
        <label class="field"><span>Organisation</span><input type="text" id="org" value="${esc(st.organisation)}"></label>
      </div>
      <button class="btn" id="saveMe">Save</button>
    </div>
    <div class="panel" style="max-width:720px"><h2>Library data</h2>
      <p class="hint" style="margin-top:-6px">Everything is stored locally on this Mac: <code>${esc(st.dataFile)}</code></p>
      <div class="row"><button class="btn" id="exp">Export library…</button><button class="btn" id="imp">Import library…</button><button class="btn ghost" id="reveal">Show in Finder</button></div>
      <p class="hint">${S.programmes.length} programmes · ${S.templates.length} templates</p>
    </div>`;
  $('#saveAi').onclick = async () => {
    const patch = { model: $('#model').value.trim() || st.defaultModel };
    const key = $('#key').value.trim();
    if (key) patch.apiKey = key;
    S.settings = await api.setSettings(patch); renderAiStatus(); toast('AI settings saved'); render();
  };
  $('#testAi').onclick = e => busy(e.currentTarget, 'Testing…', async () => { await api.ai.test(); toast('Connected to Claude ✓'); });
  if ($('#rmKey')) $('#rmKey').onclick = async () => { S.settings = await api.setSettings({ apiKey: '' }); renderAiStatus(); render(); };
  $('#saveMe').onclick = async () => { S.settings = await api.setSettings({ facilitator: $('#fac').value.trim(), organisation: $('#org').value.trim() }); toast('Saved'); };
  $('#exp').onclick = exportLibrary;
  $('#imp').onclick = importLibrary;
  $('#reveal').onclick = () => api.revealData();
}

async function exportLibrary() {
  try { const f = await api.exportLibrary(); if (f) toast('Library exported'); } catch (e) { toast(e.message, true); }
}

async function importLibrary() {
  try {
    const n = await api.importLibrary();
    if (n === null) return;
    await reload(); toast(`Imported ${n} items`); render();
  } catch (e) { toast('Import failed: ' + e.message, true); }
}

// ---------- boot ----------
$$('#nav a').forEach(a => a.onclick = () => { S.edit = null; S.tplEdit = null; go(a.dataset.view); });
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    if (S.view === 'programme') saveProgramme();
    if (S.view === 'template') saveTemplate();
  }
});
api.onMenu(cmd => {
  if (cmd === 'new-programme') { S.edit = null; go('programme', 'new'); }
  if (cmd === 'new-template') { S.tplEdit = null; go('template', 'new'); }
  if (cmd === 'import') importLibrary();
  if (cmd === 'export') exportLibrary();
  if (cmd === 'focus-search') { if (S.view !== 'library') go('library'); else $('#q') && $('#q').focus(); }
});

reload().then(() => go('library'));
