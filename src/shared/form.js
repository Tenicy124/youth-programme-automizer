// The Youth Programme Planning Form: option lists, the safety catalogue, and
// normalize(), which upgrades programmes saved by older versions of the app.
// Runs in the renderer (window.PForm) and in Node (require).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PForm = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const AGE_GROUPS = ['10-12', '13-16', '17-19', '20-24', '25-34'];
  const AGE_HINTS = { '10-12': 'Upper primary', '13-16': 'Secondary', '17-19': 'Upper sec / ITE / JC', '20-24': 'Tertiary / early career', '25-34': 'Young adults' };
  const FORMATS = ['One-off session', 'Short series (2-4 sessions)', 'Structured programme (5-8 sessions)', 'Ongoing / open group'];
  const SESSION_LENGTHS = ['45 min', '60 min', '75 min', '90 min'];
  const SETTINGS = ['School', 'Youth centre', 'Community / FSC', 'Outreach'];
  const COMPETENCIES = [
    'Regulate emotions before acting', 'Think independently of trends', 'Embrace discomfort without escape',
    'Define self-worth beyond performance', 'Start and conduct conversations', 'Sleep well for better focus',
  ];
  const ICE_PURPOSES = ['Reduce awkwardness', 'Encourage interaction', 'Build trust and safety', 'Normalise sharing', 'Energise the group'];
  const ICE_TIMES = ['5 min', '10 min', '15 min'];
  const INVOLVEMENT = ['Discussion', 'Movement', 'Creation', 'Reflection', 'Teamwork', 'Presentation', 'Games / play'];
  const MF_OBJECTIVES = ['Emotional regulation', 'Awareness and focus', 'Grounding and calming', 'Reflection and insight', 'Attention control'];
  const MF_TYPES = ['Breath awareness', 'Body awareness / movement', 'Sensory grounding', 'Reflective pause / journaling', 'Mindful listening or speaking'];
  const MF_WHEN = ['Opening', 'Mid-session', 'Closing', 'Multiple points'];
  const MF_TIMES = ['2-5 min', '6-10 min', '11-15 min'];
  const FEEDBACK = ['Post-programme survey', 'Verbal check-out / sharing circle', 'Feedback cards or sticky notes', 'Reflection journal', 'Facilitator observation', 'Before-and-after self-rating'];
  const INDICATORS = ['Increased participation', 'Improved peer interaction', 'Greater emotional awareness', 'Willingness to communicate', 'Improved focus or calmness'];

  // Safety catalogue. Each risk lists the measures that usually go with it,
  // so picking a risk can suggest its mitigations.
  const RISKS = [
    { group: 'Centre and venue', items: [
      { label: 'Slips, trips and falls (running, climbing, wet floors)', fix: ['Set ground rules on running and climbing, with clear consequences', 'Keep floors clear and dry; mark any hazards', 'Give clear rules and instructions before every activity'] },
      { label: 'Overcrowding or blocked exits', fix: ['Keep numbers within the room capacity', 'Keep exits clear and brief everyone on the evacuation route'] },
      { label: 'Fire or emergency evacuation', fix: ['Keep exits clear and brief everyone on the evacuation route', 'Take attendance so everyone can be counted in an emergency'] },
    ] },
    { group: 'Activities and crafts', items: [
      { label: 'Cuts or injuries from tools (scissors, craft knives)', fix: ['Supervise every station that uses tools', 'Demonstrate safe handling before handing out tools', 'Never leave sharp or high-risk items unattended'] },
      { label: 'Burns from heat, glue guns or cooking equipment', fix: ['An adult supervises every heat source at all times', 'Demonstrate safe handling before handing out tools', 'Keep a first aid kit on site'] },
      { label: 'Strains or collisions in active games', fix: ['Warm up before active games', 'Match games to the space and to participants’ abilities', 'Anyone can sit out without needing a reason'] },
    ] },
    { group: 'Food and kitchen', items: [
      { label: 'Food allergies and dietary needs', fix: ['Collect allergy, dietary and medical information at sign-up', 'Check ingredients and label all food', 'Provide alternatives (e.g. halal, vegetarian, allergy-free)'] },
      { label: 'Food hygiene (raw food, cross-contamination)', fix: ['Everyone washes hands before handling food', 'Keep raw and cooked food apart', 'Clean surfaces and equipment before and after'] },
    ] },
    { group: 'Outdoors and nature', items: [
      { label: 'Heat exhaustion or dehydration', fix: ['Water breaks at least every 30 minutes; bring extra water', 'Plan shaded rest stops', 'Facilitators watch for signs of heat injury'] },
      { label: 'Wet weather or lightning', fix: ['Check the weather forecast the day before', 'Have a wet-weather plan or indoor backup', 'Stop outdoor activities during lightning warnings'] },
      { label: 'Insect bites, plants and wildlife', fix: ['Advise long sleeves, covered shoes and insect repellent', 'Brief participants not to touch or feed plants and wildlife', 'Keep a first aid kit on site'] },
      { label: 'Participants getting lost or separated', fix: ['Use a buddy system', 'Do regular headcounts', 'Facilitators walk at the front and back of the group', 'Agree a meeting point in case anyone gets separated'] },
    ] },
    { group: 'Travel and off-site', items: [
      { label: 'Road safety when walking or travelling', fix: ['Brief on road safety and use pedestrian crossings', 'Facilitators walk at the front and back of the group'] },
      { label: 'Delays or separation on public transport', fix: ['Use a buddy system', 'Headcount before and after every journey', 'Share facilitator contact numbers with participants'] },
      { label: 'Getting home safely after a late finish', fix: ['Tell parents or guardians the finish time in advance', 'Confirm how each participant is getting home'] },
    ] },
    { group: 'Events and groups', items: [
      { label: 'Crowd management at large events', fix: ['Assign facilitators to zones', 'Keep exits clear and brief everyone on the evacuation route', 'Take attendance so everyone can be counted in an emergency'] },
      { label: 'Exclusion, teasing or conflict between participants', fix: ['Agree group rules together at the start', 'Mix groups on purpose so no one is left out', 'Step in early on teasing or put-downs'] },
      { label: 'Performance anxiety (presenting or performing)', fix: ['Offer opt-in roles and let participants choose how they take part', 'Practise in small groups first', 'Celebrate effort, not just results'] },
    ] },
    { group: 'Emotional wellbeing', items: [
      { label: 'Distress from personal sharing', fix: ['Sharing is always optional', 'A trained facilitator is available for one-to-one follow-up', 'Provide a quiet space to step away', 'Refer to counselling support when needed'] },
      { label: 'Stress or overwhelm during the activity', fix: ['A trained facilitator is available for one-to-one follow-up', 'Provide a quiet space to step away', 'Anyone can sit out without needing a reason'] },
    ] },
    { group: 'Health and digital', items: [
      { label: 'Existing medical conditions (e.g. asthma)', fix: ['Collect allergy, dietary and medical information at sign-up', 'Know who carries medication and where it is kept', 'A trained first aider is on site'] },
      { label: 'Injuries needing first aid', fix: ['Keep a first aid kit on site', 'A trained first aider is on site', 'Record incidents and inform parents or guardians'] },
      { label: 'Online safety and personal data', fix: ['Use approved platforms and accounts only', 'Supervise device use', 'Brief participants on not sharing personal information'] },
      { label: 'Photos and videos of participants', fix: ['Collect photo consent before the programme', 'Do not post identifiable photos without consent'] },
    ] },
  ];
  const RISK_LABELS = RISKS.flatMap(g => g.items.map(i => i.label));
  const MITIGATIONS = (() => {
    const seen = new Set(), groups = [];
    for (const g of RISKS) {
      const items = [];
      for (const r of g.items) for (const f of r.fix) if (!seen.has(f)) { seen.add(f); items.push(f); }
      if (items.length) groups.push({ group: g.group, items });
    }
    return groups;
  })();
  const PSYCH = [
    'Sharing is optional', 'No fixing or judging rule stated', 'Clear group agreements', 'Facilitator models vulnerability appropriately',
    'Quiet space available to step away', 'Trusted adult available for follow-up', 'Use the names young people choose', 'Photos only with consent',
  ];
  const BEST_PRACTICES = [
    'Brief all facilitators before the session', 'Agree roles: lead, support and safety person', 'Check in with quieter participants',
    'Keep instructions short and demonstrate', 'Give time warnings before transitions', 'Adapt activities for different abilities',
    'Debrief as a team afterwards', 'Keep attendance and incident records',
  ];

  // Measures suggested for a list of risks, in catalogue order.
  function mitigationsFor(risks) {
    const out = [];
    for (const g of RISKS) for (const r of g.items) if ((risks || []).includes(r.label)) for (const f of r.fix) if (!out.includes(f)) out.push(f);
    return out;
  }

  // The form's sections, in order. Mandatory ones are marked as on the paper form.
  const SECTIONS = [
    { key: 'overview', num: '1', label: 'Programme Overview' },
    { key: 'logistics', num: '1.2', label: 'Programme Logistics' },
    { key: 'need', num: '2', label: 'Core Youth Need Addressed' },
    { key: 'competencies', num: '3', label: 'Core Competencies Targeted', mandatory: true },
    { key: 'icebreaker', num: '4', label: 'Icebreaker Activity (Social Bonding)', mandatory: true },
    { key: 'activities', num: '5', label: 'Main Activity / Programme Flow' },
    { key: 'mindfulness', num: '6', label: 'Mindfulness Infusion', mandatory: true },
    { key: 'safety', num: '7', label: 'Risk Management' },
    { key: 'outcomes', num: '8', label: 'Intended Outcomes' },
  ];

  function blank() {
    return {
      title: '', summary: '', objectives: [], date: '', time: '', location: '',
      ageGroups: [], ageGroup: '', format: '', sessionLength: '', setting: '', facilitators: '', groupSize: '', duration: '', themes: [],
      materials: [], attire: '', equipment: '', meetingPoint: '', transport: '', food: '', budgetItems: '', budget: '',
      youthNeed: '', whyItMatters: '',
      competencies: [], primaryCompetency: '', competencyHow: '',
      iceName: '', icePurposes: [], iceTime: '', iceSteps: '', iceWhy: '',
      mainActivities: '', involvement: [], involvementNotes: '', sessions: [],
      mfObjectives: [], mfTypes: [], mfWhen: [], mfFraming: '', mfTime: '',
      risks: [], mitigations: [], contacts: [], psychSafety: [], bestPractices: [], riskNotes: '',
      intendedOutcomes: '', successCriteria: '', feedbackMethods: [], indicators: [],
      status: 'draft', rating: 0, notes: '', document: [], templateId: null,
    };
  }

  const OLD_AGE = { '5-8': '10-12', '9-12': '10-12', '13-15': '13-16', '16-18': '17-19', '18-25': '20-24' };
  function newFormat(p) {
    const f = p.format;
    if (FORMATS.includes(f)) return f;
    if (!f) return '';
    if (f === 'Weekly club' || f === 'Mentoring') return FORMATS[3];
    if (f === 'Event') return FORMATS[0];
    if (f === 'Camp' || f === 'Retreat') return FORMATS[1];
    const n = (p.sessions || []).length;
    return n <= 1 ? FORMATS[0] : n <= 4 ? FORMATS[1] : FORMATS[2];
  }
  const arr = v => Array.isArray(v) ? v.filter(x => x != null && String(x).trim()).map(String) : (v ? [String(v)] : []);

  // Brings any programme (old versions, imports, AI output) up to the current shape.
  // Pure and safe to run more than once.
  function normalize(p) {
    if (!p || typeof p !== 'object') return p;
    const out = { ...blank(), ...p };
    let ages = arr(p.ageGroups).map(a => OLD_AGE[a] || a);
    if (!ages.length && p.ageGroup) ages = [OLD_AGE[p.ageGroup] || p.ageGroup];
    out.ageGroups = AGE_GROUPS.filter(a => ages.includes(a)).concat(ages.filter(a => !AGE_GROUPS.includes(a)));
    out.ageGroup = out.ageGroups[0] || '';
    out.format = newFormat(p);
    if (!out.successCriteria && p.outcomes) out.successCriteria = p.outcomes;
    delete out.outcomes;
    for (const k of ['objectives', 'themes', 'materials', 'competencies', 'icePurposes', 'involvement', 'mfObjectives', 'mfTypes', 'mfWhen',
      'risks', 'mitigations', 'psychSafety', 'bestPractices', 'feedbackMethods', 'indicators']) out[k] = arr(out[k]);
    out.contacts = (Array.isArray(out.contacts) ? out.contacts : []).filter(c => c && (c.name || c.phone)).map(c => ({ name: String(c.name || ''), phone: String(c.phone || '') }));
    out.sessions = (Array.isArray(out.sessions) ? out.sessions : []).map(s => ({ title: '', duration: '', activities: '', materials: '', ...s }));
    if (out.primaryCompetency && !out.competencies.includes(out.primaryCompetency)) out.competencies.push(out.primaryCompetency);
    return out;
  }

  // Which mandatory sections are still empty.
  function missingMandatory(p) {
    const miss = [];
    if (!(p.competencies || []).length) miss.push('core competencies');
    if (!p.iceName && !p.iceSteps) miss.push('icebreaker');
    if (!(p.mfTypes || []).length && !(p.mfObjectives || []).length) miss.push('mindfulness');
    return miss;
  }

  return {
    AGE_GROUPS, AGE_HINTS, FORMATS, SESSION_LENGTHS, SETTINGS, COMPETENCIES, ICE_PURPOSES, ICE_TIMES, INVOLVEMENT,
    MF_OBJECTIVES, MF_TYPES, MF_WHEN, MF_TIMES, FEEDBACK, INDICATORS, RISKS, RISK_LABELS, MITIGATIONS, PSYCH, BEST_PRACTICES,
    SECTIONS, blank, normalize, missingMandatory, mitigationsFor,
  };
});
