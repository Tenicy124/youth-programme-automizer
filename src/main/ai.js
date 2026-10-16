// Claude integration: ideation, full programme drafting, template drafting/filling and chat.
// Runs in the main process so the API key never reaches the renderer.
const Anthropic = require('@anthropic-ai/sdk');

const DEFAULT_MODEL = 'claude-opus-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const AGE_GROUPS = ['5-8', '9-12', '13-15', '16-18', '18-25'];
const FORMATS = ['Weekly club', 'Camp', 'Workshop', 'Retreat', 'Event', 'Online', 'Mentoring'];

const SYSTEM = `You are an experienced youth work practitioner and programme designer helping a youth worker plan programmes.
You design programmes that are age-appropriate, inclusive, practical to run with modest budgets, and grounded in positive youth development.
Always consider safeguarding, accessibility and how success will be measured. Write in clear, warm, practical language a facilitator can use directly.
Use internationally neutral wording and avoid citing country-specific laws unless the user mentions a country.`;

// ---- JSON schemas for structured outputs ----
const str = { type: 'string' };
const strArr = { type: 'array', items: str };
const obj = (props) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });

const IDEA = obj({
  title: str, summary: str, hook: str, whyItWorks: str,
  ageGroup: { type: 'string', enum: AGE_GROUPS },
  format: { type: 'string', enum: FORMATS },
  themes: strArr, duration: str, objectives: strArr,
});
const IDEAS_SCHEMA = obj({ ideas: { type: 'array', items: IDEA } });

const PROGRAMME_SCHEMA = obj({
  title: str, summary: str,
  ageGroup: { type: 'string', enum: AGE_GROUPS },
  format: { type: 'string', enum: FORMATS },
  themes: strArr, duration: str, groupSize: str, objectives: strArr,
  sessions: { type: 'array', items: obj({ title: str, duration: str, activities: str, materials: str }) },
  materials: strArr, budget: str, riskNotes: str, outcomes: str, notes: str,
});

const TEMPLATE_SCHEMA = obj({
  name: str, description: str, category: str,
  sections: { type: 'array', items: obj({ heading: str, guidance: str, content: str }) },
});

const FILLED_SCHEMA = obj({ sections: { type: 'array', items: obj({ heading: str, content: str }) } });

class AI {
  constructor(getConfig) {
    this.getConfig = getConfig; // () => ({ apiKey, model })
    this.fallbackSupported = true;
  }

  client() {
    const { apiKey } = this.getConfig();
    if (!apiKey) {
      const err = new Error('Add your Anthropic API key in Settings to use AI features.');
      err.code = 'NO_KEY';
      throw err;
    }
    return new Anthropic({ apiKey });
  }

  model() { return this.getConfig().model || DEFAULT_MODEL; }

  // Streams a request (avoids HTTP timeouts on long plans) with server-side refusal
  // fallbacks when the account supports them, retrying without them otherwise.
  async create(params, onText) {
    const client = this.client();
    const run = (useFallback) => {
      const stream = useFallback
        ? client.beta.messages.stream({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' })
        : client.messages.stream(params);
      if (onText) stream.on('text', t => onText(t));
      return stream.finalMessage();
    };
    if (this.fallbackSupported) {
      try { return await run(true); } catch (e) {
        if (!isFallbackRejection(e)) throw friendly(e);
        this.fallbackSupported = false;
      }
    }
    try { return await run(false); } catch (e) { throw friendly(e); }
  }

  async json(prompt, schema, maxTokens = 16000) {
    const res = await this.create({
      model: this.model(),
      max_tokens: maxTokens,
      system: SYSTEM,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: prompt }],
    });
    checkStop(res);
    const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
    try { return JSON.parse(text); } catch { throw new Error('Claude returned an unexpected response. Please try again.'); }
  }

  async ideate({ brief, similar, count = 4 }) {
    const lib = (similar || []).map(p => `- ${p.title} (${p.ageGroup}, ${p.format}; themes: ${(p.themes || []).join(', ')}; rating ${p.rating || 'n/a'}): ${p.summary}`).join('\n');
    const prompt = `Generate ${count} distinct, creative youth programme ideas for this brief.

BRIEF
${formatBrief(brief)}

SIMILAR PROGRAMMES ALREADY IN OUR LIBRARY (build on what works, but do not duplicate them):
${lib || '(none yet)'}

Make the ideas meaningfully different from each other in format or approach. "hook" is a one-line pitch that would excite young people. "whyItWorks" explains the youth-development rationale in 1-2 sentences.`;
    const out = await this.json(prompt, IDEAS_SCHEMA);
    return out.ideas;
  }

  async develop({ idea, brief, similar }) {
    const lib = (similar || []).slice(0, 3).map(p => `- ${p.title}: ${(p.sessions || []).map(s => s.title).join(' / ')}`).join('\n');
    const prompt = `Develop this programme idea into a complete, ready-to-run programme plan.

IDEA
${JSON.stringify(idea, null, 2)}
${brief ? '\nORIGINAL BRIEF\n' + formatBrief(brief) : ''}
${lib ? '\nFOR REFERENCE, SESSION OUTLINES OF SIMILAR PROGRAMMES IN OUR LIBRARY\n' + lib : ''}

Include one entry in "sessions" per session of the programme (for a camp or event, one per block of the day). Each session's "activities" should give a timed run-sheet (e.g. "0-10 min: ...") a volunteer could follow. Keep the budget realistic and itemised briefly.`;
    return this.json(prompt, PROGRAMME_SCHEMA, 32000);
  }

  async draftTemplate({ description }) {
    const prompt = `Draft a reusable planning template for youth workers based on this request:

"${description}"

Each section needs a clear heading, a one-sentence "guidance" hint for the author, and starter "content" that uses {{placeholders}} where programme-specific details go. Available placeholders: {{programme_title}}, {{age_group}}, {{format}}, {{duration}}, {{group_size}}, {{objectives}}, {{summary}}, {{facilitator}}, {{date}}. Aim for 4-8 sections.`;
    return this.json(prompt, TEMPLATE_SCHEMA);
  }

  async fillTemplate({ template, programme }) {
    const prompt = `Complete this template for the programme below. Keep each section's heading exactly as given and in the same order. Replace placeholders with real details and turn the guidance into finished, specific content.

TEMPLATE
${JSON.stringify(template.sections.map(s => ({ heading: s.heading, guidance: s.guidance, content: s.content })), null, 2)}

PROGRAMME
${JSON.stringify(stripMeta(programme), null, 2)}`;
    const out = await this.json(prompt, FILLED_SCHEMA, 32000);
    return out.sections;
  }

  // Streams a brainstorming chat. onText receives text deltas.
  async chat({ messages, context }, onText) {
    const system = SYSTEM + (context ? `\n\nThe user's programme library (for reference):\n${context}` : '');
    const final = await this.create({
      model: this.model(),
      max_tokens: 64000,
      system,
      output_config: { effort: 'medium' },
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }, onText);
    checkStop(final);
    return final.content.filter(b => b.type === 'text').map(b => b.text).join('');
  }

  async test() {
    const res = await this.create({
      model: this.model(), max_tokens: 64, output_config: { effort: 'low' },
      messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
    });
    checkStop(res);
    return true;
  }
}

function formatBrief(b) {
  if (!b) return '';
  if (typeof b === 'string') return b;
  return Object.entries(b).filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('\n');
}

function stripMeta(p) {
  const { id, createdAt, updatedAt, document, templateId, ...rest } = p;
  return rest;
}

function checkStop(res) {
  if (res.stop_reason === 'refusal') throw new Error('Claude declined this request. Try rephrasing the brief.');
  if (res.stop_reason === 'max_tokens') throw new Error('The response was too long and got cut off. Try a narrower request.');
}

function isFallbackRejection(e) {
  return e && e.status === 400 && /fallback|beta/i.test(String(e.message || ''));
}

function friendly(e) {
  if (e && e.code === 'NO_KEY') return e;
  const status = e && e.status;
  if (status === 401) return new Error('Your API key was rejected. Check it in Settings.');
  if (status === 403) return new Error('Your API key does not have access to this model. Try another model in Settings.');
  if (status === 404) return new Error('That model was not found. Check the model name in Settings.');
  if (status === 429) return new Error('Rate limited by the API. Wait a moment and try again.');
  if (status >= 500) return new Error('The Claude API is having trouble right now. Please try again shortly.');
  if (e && /fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(String(e.message))) return new Error('Could not reach the Claude API. Check your internet connection.');
  return e instanceof Error ? e : new Error(String(e));
}

module.exports = { AI, DEFAULT_MODEL, AGE_GROUPS, FORMATS, formatBrief };
