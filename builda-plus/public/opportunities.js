'use strict';
// BuildA+ opportunity intelligence (Phase 4). Loaded after discovery.js and before workspace.js; uses their
// helpers at call time. Everything shown comes from GET /api/firm/discoveries/:id/opportunities, which is
// computed by fixed rules from discovery evidence. Nothing here estimates, ranks or fills in a figure.

const OPP_STATUS = {
  keep_human: ['Keep human', 'neutral'], needs_classification: ['Needs your classification', 'warning'], needs_evidence: ['Needs evidence', 'warning'], compliance_review: ['Compliance review first', 'warning'],
  awaiting_validation: ['Waiting for you to confirm', 'warning'], ready_for_review: ['Ready for your decision', 'info'], challenged: ['Challenged', 'warning'],
  approved: ['Approved', 'success'], rejected: ['Rejected', 'neutral'], sent_to_engineering: ['With JADA engineering', 'success'],
};
const BAND = { High: ['High', 'success'], Medium: ['Medium', 'info'], Low: ['Low', 'neutral'] };
const AUTOMATION = { conventional: 'Standard automation (no AI)', ai_assisted: 'Automation with AI assistance', not_assessed: 'Not yet decided' };
const DECISION_LABEL = { approved: 'Approved', challenged: 'Challenged', rejected: 'Rejected', reopened: 'Reopened', sent_to_engineering: 'Sent to JADA engineering review' };
const INPUT_SOURCE = { employee_reported: 'employee_reported', firm_provided: 'firm_provided', assumption: 'assumption', measured: 'measured' };
const READING = { value: ['Value to the firm', 'time saved and how often it happens'], feasibility: ['Ease of building', 'how ready and how much work'], confidence: ['Strength of evidence', 'how well it’s backed up'], risk: ['Regulatory safety', 'how far it stays clear of regulated advice'] };
const CASE_INPUT_ORDER = ['monthlyVolume', 'minutesPerOccurrence', 'reductionPct', 'loadedHourlyCostGBP', 'implementationCostGBP', 'monthlyCashSavingGBP', 'staffHoursPerCase', 'revenuePerCaseGBP'];
const oUrl = (id, oid) => `/app/opportunities/${id}${oid ? `/${oid}` : ''}`;
const oppStatus = (s) => { const [l, v] = OPP_STATUS[s] || [s, 'neutral']; return status(l, v); };
const band = (b) => (b ? status(...BAND[b]) : el('span', { class: 'ws-subtle' }, 'Not ranked'));
const gbp = (x) => (x === null || x === undefined ? 'Unknown' : `£${Number(x).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`);
const decisionText = (v) => { const d = v && typeof v === 'object' ? v.decision : v; return DECISION_LABEL[d] || (d ? String(d).replace(/_/g, ' ') : '—'); };

/* ============================================================ dashboard */
async function opportunitiesPage(ws, discoveryId, oppId) {
  const crumbs = [{ label: 'Opportunities', href: '/app/opportunities' }];
  const { chosen, picker, none } = pickDiscovery(ws, 'opportunities');
  const target = discoveryId ? ws.discoveries.find((d) => d.id === discoveryId) : chosen;
  if (!target) {
    return { crumbs: [{ label: 'Opportunities' }], nodes: [pageHeader('Opportunities', 'What discovery found, assessed and prioritised by fixed rules.'), discoveryId
      ? empty('We couldn’t find that discovery', 'It may belong to a different workspace, or the link may be wrong.', linkBtn('/app/opportunities', 'All opportunities'))
      : none] };
  }
  if (!target.analysedAt) return { crumbs, nodes: [pageHeader('Opportunities'), empty('Not analysed yet', 'Opportunities appear once the interviews are analysed.', linkBtn(`/app/discovery/${target.id}`, 'Open discovery', 'primary'), 'opportunities')] };
  const intel = await api(`/api/firm/discoveries/${target.id}/opportunities`);
  if (oppId) return opportunityDetail(intel, oppId);
  return { crumbs: [{ label: 'Opportunities' }], nodes: dashboard(ws, intel, discoveryId ? null : picker) };
}

function dashboard(ws, intel, picker) {
  const id = intel.discovery.id, s = intel.summary, list = intel.opportunities;
  const head = pageHeader('Opportunities', FEATURES.laterStages
    ? 'The problems your interviews found, ranked by what they cost your firm and how strong the evidence is. Approve the ones that should go to JADA’s engineers.'
    : 'The problems your interviews found, ranked by what they cost your firm and how strong the evidence is. Approve the ones you want to act on.');
  if (!list.length) return [head, picker, empty('No opportunities yet', 'Analysis didn’t produce any findings for this discovery. Check the interviews and run the analysis again.', linkBtn(`/app/discovery/${id}`, 'Open discovery', 'primary'), 'opportunities'), hypothesesSection(intel)];
  const stats = totals(list, s);
  const byClass = el('p', { class: 'ds-cluster op-classes' }, el('span', { class: 'ws-subtle' }, 'Suggested approach:'), ...['overhaul', 'fix', 'automate', 'keep_human'].map((c) => el('span', { class: 'ds-cluster' }, classification(c), el('span', { class: 'ws-subtle' }, String(s.byClassification[c])))),
    s.byClassification.unclassified ? el('span', { class: 'ws-subtle' }, `${s.byClassification.unclassified} not yet decided`) : null);

  // Filters (client-side over the loaded list; state kept in the query string).
  const q = new URLSearchParams(location.search);
  const sel = (name, label, opts) => el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: `op-f-${name}` }, label),
    el('select', { class: 'ds-select', id: `op-f-${name}`, name }, el('option', { value: '' }, 'All'), ...opts.map(([v, l]) => el('option', { value: v, selected: q.get(name) === v }, l))));
  const stages = [...new Map(list.map((o) => [o.stageId, o.stageName])).entries()];
  const filters = el('form', { class: 'op-filters', role: 'search', 'aria-label': 'Filter opportunities' },
    sel('stage', 'Stage', stages), sel('classification', 'Approach', Object.entries(CLASSIFICATION).map(([k, [, l]]) => [k, l])),
    sel('priority', 'Priority', [['High', 'High'], ['Medium', 'Medium'], ['Low', 'Low'], ['unranked', 'Not ranked']]),
    sel('confidence', 'How sure', Object.entries(CONFIDENCE).map(([k, [, l]]) => [k, l])),
    sel('status', 'Status', Object.entries(OPP_STATUS).filter(([k]) => FEATURES.laterStages || k !== 'sent_to_engineering').map(([k, [l]]) => [k, l])));
  const results = el('div', {});
  const apply = () => {
    const f = Object.fromEntries([...new FormData(filters)].filter(([, v]) => v));
    const p = new URLSearchParams(location.search);
    for (const k of ['stage', 'classification', 'priority', 'confidence', 'status']) { if (f[k]) p.set(k, f[k]); else p.delete(k); }
    history.replaceState(null, '', `${location.pathname}${p.toString() ? `?${p}` : ''}${location.hash}`);
    const shown = list.filter((o) => (!f.stage || o.stageId === f.stage) && (!f.classification || o.classification === f.classification)
      && (!f.priority || (f.priority === 'unranked' ? o.priorityRank === null : o.band === f.priority))
      && (!f.confidence || o.evidence.dimensions.existence.level === f.confidence) && (!f.status || o.status === f.status));
    results.replaceChildren(...resultsView(intel, shown, Object.keys(f).length > 0));
  };
  filters.addEventListener('change', apply);
  apply();
  return [head, picker, stats, byClass, filters, results, hypothesesSection(intel), methodSection(intel),
    // Selling the discovery: the report is the deliverable, so it's always open. With later stages on it folds away once created.
    el('div', { class: 'ws-section', id: 'report' }, el('details', { class: 'op-details', open: !FEATURES.laterStages || !(ws.discoveries.find((d) => d.id === id) || {}).reportedAt },
      el('summary', {}, FEATURES.laterStages ? 'Create the discovery report' : 'Your discovery report'), el('div', { class: 'op-details__body', 'data-load': id })))]
    .map((n) => (n && n.querySelector && n.querySelector('[data-load]') ? lazyDecisions(n, ws) : n));
}

// The business totals across every opportunity that has figures, with how many that is, so a total built
// from a few opportunities never reads as the whole picture.
function totals(list, s) {
  const sized = list.filter((o) => o.classification !== 'keep_human' && o.businessCase && o.businessCase.timeRecovered.monthlyHoursSpent !== null);
  const sum = (f) => sized.reduce((n, o) => n + (f(o.businessCase.timeRecovered) || 0), 0);
  const spent = sum((t) => t.monthlyHoursSpent), freed = sum((t) => t.monthlyHoursRecovered);
  const priced = sized.filter((o) => o.businessCase.timeRecovered.valueAtStatedCostGBP !== null);
  const yearly = priced.reduce((n, o) => n + o.businessCase.timeRecovered.valueAtStatedCostGBP * 12, 0);
  const of = `${sized.length} of ${s.total}`;
  const stat = (label, value, note) => el('div', { class: 'ws-stat' }, el('dt', { class: 'ws-stat__label' }, label), el('dd', { class: 'ws-stat__value' }, value), note ? el('dd', { class: 'ws-subtle op-stat__note' }, note) : null);
  return el('div', { class: 'ds-stack' },
    el('dl', { class: 'ws-stats op-stats' },
      stat('Staff time lost a month', sized.length ? `${num(spent)} hours` : 'Not known yet', sized.length ? `from the ${of} problems with figures` : 'No figures given yet'),
      stat('Could be freed up a month', sized.length ? `${num(freed)} hours` : 'Not known yet', priced.length ? `≈ ${gbp(yearly)} a year in staff time` : null),
      stat('Problems found', String(s.total), `${s.prioritised} ranked, ${s.total - s.prioritised} not ranked yet`),
      stat('Waiting for your decision', String(s.readyForReview), null),
      stat('Approved', String(s.approved), null)),
    sized.length < s.total ? el('p', { class: 'ds-help' }, `Totals cover only the ${of} problems where someone has said how often it happens and how long it takes. Nobody has given figures for the rest yet.`) : null);
}

// The business picture for one analysed discovery, for the overview pages: the same totals as the
// opportunities page, then the top three priorities with what each costs. Loads on its own, so a slow
// response never holds up the rest of the page.
function businessSnapshot(discoveryId, title = 'What discovery found') {
  const body = el('div', { class: 'ds-stack' }, el('p', { class: 'ds-loading' }, 'Loading the figures…'));
  api(`/api/firm/discoveries/${discoveryId}/opportunities`).then((intel) => {
    const list = intel.opportunities, top = list.filter((o) => o.priorityRank !== null).slice(0, 3);
    if (!list.length) { body.replaceChildren(el('p', { class: 'ds-muted ds-body-sm' }, 'The analysis didn’t find any problems to report yet.')); return; }
    const t = (o) => (o.businessCase ? o.businessCase.timeRecovered : {});
    body.replaceChildren(totals(list, intel.summary),
      top.length ? el('div', {}, el('h3', { class: 'ds-h4' }, 'Top priorities'), el('ol', { class: 'ws-list ov-top' }, ...top.map((o) => el('li', {},
        el('span', { class: 'ds-stack ov-top__main' }, el('span', { class: 'ds-cluster' }, el('a', { href: oUrl(discoveryId, o.id) }, o.title), classification(o.classification)),
          el('span', { class: 'ws-subtle' }, t(o).monthlyHoursSpent === null || t(o).monthlyHoursSpent === undefined ? 'Staff time not given yet'
            : `${num(t(o).monthlyHoursSpent)} staff hours a month${t(o).monthlyHoursRecovered !== null ? ` · about ${num(t(o).monthlyHoursRecovered)} could be freed up` : ' · how much could be saved not estimated yet'}${t(o).valueAtStatedCostGBP ? ` (≈ ${gbp(t(o).valueAtStatedCostGBP * 12)} a year in staff time)` : ''}`)),
        oppStatus(o.status))))) : null,
      el('p', {}, linkBtn(`/app/opportunities?d=${discoveryId}`, 'See all opportunities')));
  }).catch((err) => body.replaceChildren(alertBox('danger', 'Couldn’t load the figures', err.message)));
  return section(title, el('span', { class: 'ws-subtle' }, 'From your team’s interviews'), body);
}

// The report and bulk-approval controls from Phase 2, loaded only when opened.
function lazyDecisions(node, ws) {
  const holder = node.querySelector('[data-load]');
  const details = node.querySelector('details');
  const load = async () => {
    if (!details.open || holder.childElementCount) return;
    const d = ws.discoveries.find((x) => x.id === holder.dataset.load);
    try { holder.replaceChildren(decisionsSection(d, await api(`/api/firm/discoveries/${d.id}/playback`))); }
    catch (err) { holder.replaceChildren(alertBox('danger', 'Couldn’t load', err.message)); }
  };
  details.addEventListener('toggle', load);
  load();
  return node;
}

function resultsView(intel, shown, filtered) {
  const id = intel.discovery.id;
  if (!shown.length) return [empty('Nothing matches these filters', 'Clear a filter to see more opportunities.', null, 'opportunities')];
  const ranked = shown.filter((o) => o.priorityRank !== null), held = shown.filter((o) => o.priorityRank === null);
  const out = [];
  const notGiven = () => el('span', { class: 'ws-subtle' }, 'Not given yet');
  const hours = (h) => (h === null || h === undefined ? notGiven() : `${num(h)} h`);
  out.push(section('Priorities', el('span', { class: 'ws-subtle' }, filtered ? `${ranked.length} shown` : 'Highest first'), ranked.length ? el('div', { class: 'ds-table-wrap' }, el('table', { class: 'ds-table op-table' },
    el('caption', { class: 'ds-visually-hidden' }, 'Prioritised opportunities'),
    el('thead', {}, el('tr', {}, el('th', { scope: 'col', class: 'ds-table__num' }, 'Rank'), ...['Opportunity', 'Priority'].map((h) => el('th', { scope: 'col' }, h)),
      el('th', { scope: 'col', class: 'ds-table__num' }, 'Hours lost a month'), el('th', { scope: 'col', class: 'ds-table__num' }, 'Could free up'),
      el('th', { scope: 'col' }, 'How sure'), el('th', { scope: 'col' }, 'Status'))),
    el('tbody', {}, ...ranked.map((o) => {
      const t = o.businessCase ? o.businessCase.timeRecovered : null;
      return el('tr', {},
        el('td', { class: 'ds-table__num' }, String(o.priorityRank)),
        el('th', { scope: 'row', class: 'op-table__title' }, el('a', { href: oUrl(id, o.id) }, o.title), el('div', { class: 'ds-cluster op-table__meta' }, classification(o.classification), el('span', { class: 'ws-subtle' }, o.stageName))),
        el('td', {}, band(o.band)),
        el('td', { class: 'ds-table__num' }, hours(t && t.monthlyHoursSpent)),
        el('td', { class: 'ds-table__num' }, t && t.monthlyHoursSpent !== null && t.monthlyHoursRecovered === null ? el('span', { class: 'ws-subtle' }, 'Not estimated yet') : hours(t && t.monthlyHoursRecovered),
          t && t.valueAtStatedCostGBP !== null ? el('div', { class: 'ws-subtle' }, `≈ ${gbp(t.valueAtStatedCostGBP * 12)} a year`) : null),
        el('td', {}, confidence(o.evidence.dimensions.existence.level)),
        el('td', {}, oppStatus(o.status)));
    })))) : el('p', { class: 'ds-muted ds-body-sm' }, 'Nothing can be ranked yet. Each one below says what’s holding it back.')));
  if (held.length) out.push(section('Not ranked yet', el('span', { class: 'ws-subtle' }, 'However large the problem, these stay out of the ranking until the issue shown is sorted'),
    el('ul', { class: 'ws-list op-held' }, ...held.map((o) => el('li', {},
      el('span', { class: 'ds-stack op-held__main' }, el('span', { class: 'ds-cluster' }, el('a', { href: oUrl(id, o.id) }, o.title), classification(o.classification), o.status === 'keep_human' ? null : oppStatus(o.status)),
        el('span', { class: 'ws-subtle' }, `${o.stageName} · ${(o.gates.filter((g) => g.blocksPriority).map((g) => g.label).join('; ')) || (o.status === 'rejected' ? 'Rejected by you' : o.needsReassessment || 'Not scored')}`)))))));
  out.push(el('p', { class: 'ds-help ws-section' }, 'Hours come from your team’s own estimates. Hours freed up are spare capacity, not money saved; the £ figure is that time at your hourly staff cost. “Not given yet” means nobody has said how often it happens or how long it takes; “Not estimated yet” means nobody has estimated how much of that time could be saved. BuildA+ never makes a figure up: add one on the opportunity, or ask in a follow-up interview.'));
  return out;
}

function hypothesesSection(intel) {
  return section('Common problems we didn’t hear about', el('span', { class: 'ws-subtle' }, 'Not about your firm, not ranked'), el('div', { class: 'ds-stack' },
    el('p', { class: 'ds-help' }, 'Problems that are common at mortgage firms but didn’t come up in your interviews. They aren’t findings about your firm. If one sounds familiar, ask about it in a follow-up interview.'),
    intel.hypotheses.length ? el('ul', { class: 'ws-list' }, ...intel.hypotheses.map((h) => el('li', {}, el('span', { class: 'ds-cluster' }, sourceBadge('industry_knowledge'), h.title), el('span', { class: 'ws-subtle' }, h.stageName))))
      : el('p', { class: 'ds-muted ds-body-sm' }, 'None: every common problem JADA knows of either came up or doesn’t apply.')));
}

function methodSection(intel) {
  const w = intel.scoring.weights;
  const PLAIN = { impact: 'time saved', volume: 'how often it happens', feasibility: 'readiness to build', complexity: 'build effort', risk: 'regulatory risk', confidence: 'strength of evidence' };
  return section('How the ranking works', null, el('details', { class: 'op-details' }, el('summary', {}, 'Fixed rules, no AI'),
    el('div', { class: 'op-details__body ds-stack ds-body-sm' },
      el('p', {}, `Each opportunity gets a score out of 100 from six things, weighted: ${Object.entries(w).map(([k, v]) => `${PLAIN[k] || k} ${Math.round(v * 100)}%`).join(', ')}. High priority is ${intel.scoring.bands.high} or more; medium is ${intel.scoring.bands.medium} or more.`),
      el('p', {}, 'Each opportunity’s page shows value, ease of building, strength of evidence and regulatory safety separately, so a big estimate can’t hide weak evidence or regulatory risk.'),
      el('p', {}, 'Some things keep an opportunity out of the ranking, however large it is: nobody at your firm has described it, it involves regulated advice and needs a compliance review, or it is work best left with people.'),
      el('p', { class: 'ws-subtle' }, `Rules version: ${intel.scoring.version}`))));
}

/* ============================================================ detail */
const OPP_TABS = [['overview', 'At a glance'], ['problem', 'The problem'], ['evidence', 'Evidence'], ['case', 'Business case'], ['assessment', 'Can it be done?'], ['action', 'What to do next'], ['review', 'Your decision']];

function opportunityDetail(intel, oppId) {
  const id = intel.discovery.id;
  const o = intel.opportunities.find((x) => x.id === oppId);
  const crumbs = [{ label: 'Opportunities', href: oUrl(id) }];
  if (!o) return { crumbs: [...crumbs, { label: 'Not found' }], nodes: [pageHeader('Opportunity not found'), empty('We couldn’t find that opportunity', 'It may have been merged into another finding when the interviews were re-analysed.', linkBtn(oUrl(id), 'All opportunities'), 'opportunities')] };
  const head = el('div', { class: 'dw-finding-head' },
    el('p', {}, el('a', { href: oUrl(id) }, '← All opportunities')),
    el('h1', { class: 'ds-h2' }, o.title),
    el('div', { class: 'ds-cluster' }, el('span', { class: 'ws-chip' }, o.stageName), classification(o.classification), oppStatus(o.status),
      o.priorityRank ? el('span', { class: 'ws-chip' }, `Priority ${o.priorityRank} of ${intel.summary.prioritised}`) : null, o.regulated ? el('span', { class: 'ds-badge dw-badge-warn' }, 'Regulated stage') : null));
  const nav = el('nav', { class: 'op-jump', 'aria-label': 'Sections' }, ...OPP_TABS.map(([k, l]) => el('a', { href: `#op-${k}` }, l)));
  const sec = (k, ...nodes) => { const s = section(OPP_TABS.find(([x]) => x === k)[1], null, ...nodes); s.id = `op-${k}`; return s; };
  return { crumbs: [...crumbs, { label: o.title }], nodes: [head, nav,
    sec('overview', overviewView(intel, o)), sec('problem', problemView(o)), sec('evidence', evidenceView(intel, o)),
    sec('case', caseView(intel, o)), sec('assessment', assessmentView(o)), sec('action', actionView(o)), sec('review', reviewView(intel, o))] };
}

function overviewView(intel, o) {
  const blocking = o.gates.filter((g) => g.blocksPriority);
  return el('div', { class: 'ds-stack' }, glance(o),
    el('h3', { class: 'ds-h4' }, 'How it scores'),
    blocking.length ? alertBox('warning', 'Not prioritised', `${blocking.map((g) => g.label).join('. ')}. However large the impact, this stays out of the priority order until that is resolved.`) : null,
    el('div', { class: 'op-readings' }, ...Object.keys(READING).map((k) => {
      const r = o.readings[k];
      return el('div', { class: 'dw-figure' }, el('span', { class: 'ws-subtle' }, READING[k][0]),
        el('strong', {}, r === null || r === undefined ? 'Not scored' : `${num(r)} / 5`), el('span', { class: 'ws-subtle' }, k === 'value' && o.readings.valueUnknown ? 'impact unknown: scored at the floor, not a measured low value' : READING[k][1]));
    })),
    el('p', { class: 'ds-help' }, 'Each is scored 1 to 5, where 5 is best. They’re kept separate so a big estimate can’t hide weak evidence or regulatory risk. The priority order combines them with fixed weights; no AI is involved.'),
    o.explanation.length ? el('div', {}, el('h3', { class: 'ds-h4' }, 'Why it’s ranked above the next one'), el('ul', { class: 'ws-list ds-body-sm' }, ...o.explanation.map((x) => el('li', {}, x)))) : null);
}

// The business view first: what the problem costs now, what fixing it could free up, money saved, how sure
// we are and what's still needed. Every figure comes from the business case and says where it came from.
const SRC_WORDS = { firm_provided: 'entered by your firm', employee_reported: 'from staff interviews', measured: 'measured', assumption: 'JADA’s working estimate' };
function glance(o) {
  const bc = o.businessCase, ex = o.evidence.dimensions.existence;
  const fig = (label, figure, basis, tone) => el('div', { class: `dw-figure op-glance__fig${tone ? ` op-glance__fig--${tone}` : ''}` },
    el('span', { class: 'ws-subtle' }, label), el('strong', {}, figure), basis ? el('span', { class: 'ds-body-sm' }, basis) : null);
  const inp = (k) => (bc && bc.inputs[k]) || { value: null };
  const from = (k) => (inp(k).source ? ` (${SRC_WORDS[inp(k).source] || 'source not recorded'})` : '');
  const t = bc ? bc.timeRecovered : null;
  const rate = inp('loadedHourlyCostGBP').value;
  const spent = t ? t.monthlyHoursSpent : null, saved = t ? t.monthlyHoursRecovered : null;
  const spentGBP = spent !== null && rate !== null ? spent * rate : null;
  const people = o.problem.participantCount;
  const weak = ex.level === 'low' || ex.level === 'insufficient';
  const cards = [
    fig('What it costs you now', spent !== null ? `${num(spent)} staff hours a month` : 'Not known yet',
      spent !== null ? `${num(inp('monthlyVolume').value)} times a month${from('monthlyVolume')} × ${num(inp('minutesPerOccurrence').value)} minutes each${from('minutesPerOccurrence')}.`
        + (spentGBP !== null ? ` About ${gbp(spentGBP)} a month (${gbp(spentGBP * 12)} a year) of staff time at ${gbp(rate)} an hour.` : '')
        : 'Needs how often it happens and how long each one takes.'),
    fig('What fixing it could free up', saved !== null ? `${num(saved)} hours a month` : 'Not known yet',
      saved !== null ? `${Math.round(inp('reductionPct').value * 100)}% of that time${from('reductionPct')}.`
        + (t.valueAtStatedCostGBP !== null ? ` Worth about ${gbp(t.valueAtStatedCostGBP * 12)} a year in staff time: spare capacity, not money saved, unless spending goes down.` : '')
        : 'Needs the hours spent and the share that could be saved.', 'good'),
    fig('Money saved', bc && bc.cashSavings.monthlyGBP !== null ? `${gbp(bc.cashSavings.monthlyGBP)} a month` : 'None identified yet',
      bc && bc.cashSavings.monthlyGBP !== null ? (bc.cashSavings.basis || 'Entered by your firm.') : 'Only spending you would actually stop counts, such as overtime or a planned hire. Add it under Business case.'),
    fig('How sure we are', CONFIDENCE[ex.level] ? CONFIDENCE[ex.level][1] : ex.level,
      `${people === 1 ? 'One person' : `${people} people`} described it (${plural(o.evidence.total, 'piece')} of evidence).${people < 2 ? ' A second person confirming it would make this much stronger.' : ''}`, weak ? 'warn' : null),
  ];
  const needed = o.assessment.missing.slice(0, 3);
  return el('div', { class: 'ds-stack' },
    el('div', { class: 'op-glance' }, ...cards),
    needed.length ? el('div', {}, el('h3', { class: 'ds-h4' }, 'Still needed to make a firm decision'), el('ul', { class: 'ds-body-sm' }, ...needed.map((m) => el('li', {}, m)))) : null);
}

function problemView(o) {
  return el('div', { class: 'ds-stack ds-body-sm' }, el('p', {}, o.problem.statement),
    o.problem.causes.length ? el('div', {}, el('h3', { class: 'ds-h4' }, 'Causes mentioned'), el('ul', {}, ...o.problem.causes.map((c) => el('li', {}, c)))) : el('p', { class: 'ds-muted' }, 'No cause was described.'),
    o.problem.improvements.length ? el('div', {}, el('h3', { class: 'ds-h4' }, 'Improvements people suggested'), el('ul', {}, ...o.problem.improvements.map((c) => el('li', {}, c)))) : null);
}

function evidenceView(intel, o) {
  const id = intel.discovery.id;
  return el('div', { class: 'ds-stack' },
    el('p', { class: 'ds-cluster' }, ...Object.entries(o.evidence.bySource).map(([s, n]) => el('span', { class: 'ds-cluster' }, sourceBadge(s), el('span', { class: 'ws-subtle' }, String(n))))),
    el('div', { class: 'ds-table-wrap' }, el('table', { class: 'ds-table' },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'What we’re saying'), el('th', { scope: 'col' }, 'How sure'), el('th', { scope: 'col' }, 'Why'))),
      el('tbody', {}, ...['existence', 'volume', 'effort', 'impact'].map((k) => el('tr', {}, el('th', { scope: 'row' }, DIMENSION_LABEL[k]), el('td', {}, confidence(o.evidence.dimensions[k].level)), el('td', { class: 'ds-body-sm' }, o.evidence.dimensions[k].reasons.join('. '))))))),
    o.evidence.disagreements.length ? alertBox('warning', 'Accounts differ', o.evidence.disagreements.map((d) => `${d.field === 'minutesPerOccurrence' ? 'Minutes each time' : 'Times a month'}: ${d.values.map((v) => `${v.role} ${num(v.value)}`).join(' · ')}`).join('. ')) : null,
    o.evidence.disputed ? el('p', { class: 'ds-help' }, `${plural(o.evidence.disputed, 'piece')} of evidence you disputed ${o.evidence.disputed === 1 ? 'is' : 'are'} left out.`) : null,
    el('ul', { class: 'ws-list' }, ...o.evidence.items.map((e) => el('li', {}, el('span', { class: 'ds-cluster' }, sourceBadge(e.source), el('a', { href: `${dUrl(id, 'evidence', e.id)}#ev-${e.id}` }, e.observed)),
      el('span', { class: 'ws-subtle' }, `${e.role}${e.review === 'disputed' ? ' · disputed' : e.review === 'validated' ? ' · validated' : ''}`)))),
    el('p', {}, linkBtn(dUrl(id, 'findings', o.id), 'Open the finding in discovery')));
}

function assessmentView(o) {
  const a = o.assessment;
  const list = (title, xs, none) => el('div', {}, el('h3', { class: 'ds-h4' }, title), xs.length ? el('ul', { class: 'ds-body-sm' }, ...xs.map((x) => el('li', {}, x))) : el('p', { class: 'ds-muted ds-body-sm' }, none));
  return el('div', { class: 'ds-stack' },
    el('dl', { class: 'ds-meta' },
      el('dt', {}, 'Suggested approach'), el('dd', {}, o.classification ? `${CLASSIFICATION[o.classification][1]} (${(CLASSIFICATION_SOURCE[o.classificationSource] || 'source not recorded').toLowerCase()})` : 'Not yet decided'),
      o.automationType ? el('dt', {}, 'Kind of automation') : null, o.automationType ? el('dd', {}, AUTOMATION[o.automationType]) : null,
      el('dt', {}, 'Why'), el('dd', {}, o.classificationRationale || 'None recorded'),
      el('dt', {}, 'Can it be built?'), el('dd', {}, a.feasibility), el('dt', {}, 'Build effort'), el('dd', {}, a.complexity),
      a.twoWeek ? el('dt', {}, 'Could it be built in two weeks?') : null, a.twoWeek ? el('dd', {}, `${a.twoWeek.status === 'blocked' ? 'Not yet' : 'Possibly, once JADA has checked it'}${a.twoWeek.blockers.length ? `: ${a.twoWeek.blockers.join('; ')}` : ''}`) : null),
    el('div', { class: 'ws-grid-2' }, list('Risks and safeguards', a.risks.map((r) => r.replace(/^Control: /, 'Safeguard: ')), 'None found in JADA’s industry knowledge. JADA’s engineers still check this.'), list('What it relies on', a.dependencies, 'Nothing identified yet.')),
    list('Still needed to decide', a.missing, 'Nothing outstanding.'),
    o.gates.length ? el('div', {}, el('h3', { class: 'ds-h4' }, 'What’s holding it back'), el('ul', { class: 'ws-list ds-body-sm' }, ...o.gates.map((g) => el('li', {}, g.label,
      el('span', { class: 'ws-subtle' }, g.blocksPriority ? 'keeps it out of the priority list' : g.blocksEngineering ? 'must be sorted before anything is built' : 'for information'))))) : null);
}

function caseView(intel, o) {
  const bc = o.businessCase;
  if (!bc) return el('p', { class: 'ds-muted ds-body-sm' }, 'No business case: this finding hasn’t been sized.');
  const value = (title, figure, method, extra) => el('div', { class: 'dw-figure op-value' }, el('span', { class: 'ws-subtle' }, title), el('strong', {}, figure), el('span', { class: 'ds-body-sm' }, method), extra || null);
  const t = bc.timeRecovered;
  return el('div', { class: 'ds-stack' },
    el('p', { class: 'ds-help' }, 'Four kinds of value, kept separate. Time saved is not money saved: it only becomes a saving if the firm actually spends less, for example on overtime.'),
    el('div', { class: 'op-values' },
      value('Time saved', t.monthlyHoursRecovered === null ? 'Unknown' : `${num(t.monthlyHoursRecovered)} hours / month`, t.method,
        t.valueAtStatedCostGBP !== null ? el('span', { class: 'ws-subtle' }, `Worth ${gbp(t.valueAtStatedCostGBP)} a month in staff time at your hourly cost (not money saved)`) : null),
      value('Money saved', bc.cashSavings.monthlyGBP === null ? 'None stated' : `${gbp(bc.cashSavings.monthlyGBP)} / month`, bc.cashSavings.method,
        bc.cashSavings.basis ? el('span', { class: 'ws-subtle' }, `Basis: ${bc.cashSavings.basis}`) : null),
      value('Extra cases you could take on', bc.capacity.additionalCasesPerMonth === null ? 'Unknown' : `${num(bc.capacity.additionalCasesPerMonth)} more cases / month`, bc.capacity.method),
      value('Extra revenue', bc.revenue.monthlyPotentialGBP === null ? 'Not estimated' : `${gbp(bc.revenue.monthlyPotentialGBP)} / month`, bc.revenue.method)),
    el('div', { class: 'dw-figure' }, el('span', { class: 'ws-subtle' }, 'Payback'), el('strong', {}, bc.payback.months === null ? 'Not calculated' : `${num(bc.payback.months)} months`), el('span', { class: 'ds-body-sm' }, bc.payback.reason)),
    el('div', { class: 'ds-table-wrap' }, el('table', { class: 'ds-table' }, el('caption', {}, 'The figures used, and where each came from'),
      el('thead', {}, el('tr', {}, ...['Figure', 'Value', 'Where it came from'].map((h) => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, ...CASE_INPUT_ORDER.filter((k) => bc.inputs[k]).map((k) => [k, bc.inputs[k]]).map(([k, i]) => el('tr', {}, el('th', { scope: 'row' }, i.label),
        el('td', {}, i.value === null ? 'Missing' : /GBP$/.test(k) ? gbp(i.value) : k === 'reductionPct' ? `${Math.round(i.value * 100)}%` : num(i.value)),
        el('td', {}, i.source ? el('span', { class: 'ds-cluster' }, sourceBadge(INPUT_SOURCE[i.source] || 'assumption'), i.note ? el('span', { class: 'ws-subtle' }, i.note) : null) : el('span', { class: 'ws-subtle' }, '—'))))))),
    bc.missing.length ? el('div', {}, el('h3', { class: 'ds-h4' }, 'Figures still needed'), el('ul', { class: 'ds-body-sm' }, ...bc.missing.map((m) => el('li', {}, m)))) : null,
    caseForm(intel, o));
}

// Firm-supplied business-case inputs go through the existing audited corrections endpoint.
function caseForm(intel, o) {
  const id = intel.discovery.id;
  const fields = [
    ['implementationCostGBP', 'Cost to build it (£, one-off)', 'A quote or budget you have. Leave blank if unknown: payback stays uncalculated.'],
    ['monthlyCashSavingGBP', 'Spending you could actually reduce (£ / month)', 'Only real spend that would stop, e.g. overtime or a contractor. Explain the basis below (at least 10 characters).'],
    ['staffHoursPerCase', 'Staff hours one additional case needs', 'Used to turn recovered hours into capacity.'],
    ['revenuePerCaseGBP', 'Revenue per additional case (£)', 'Only counted if you confirm there’s demand for more cases.'],
  ];
  const fieldSel = el('select', { class: 'ds-select', id: 'op-case-field' }, ...fields.map(([k, l]) => el('option', { value: k }, l)), el('option', { value: 'demandConfirmed' }, 'Demand for more cases'));
  const valueIn = el('input', { class: 'ds-input', id: 'op-case-value', type: 'number', min: '0', step: 'any', inputmode: 'decimal' });
  const demand = el('select', { class: 'ds-select', id: 'op-case-demand', hidden: true }, el('option', { value: 'true' }, 'Yes: we could win more cases if we had capacity'), el('option', { value: 'false' }, 'No, or not known'));
  const help = el('p', { class: 'ds-help', id: 'op-case-help' });
  const reason = el('textarea', { class: 'ds-textarea', id: 'op-case-reason', rows: '2', maxlength: '1000', required: true });
  const m = msgEl();
  const sync = () => { const isDemand = fieldSel.value === 'demandConfirmed'; valueIn.hidden = isDemand; demand.hidden = !isDemand; help.textContent = isDemand ? 'Revenue is only estimated if you confirm demand.' : fields.find(([k]) => k === fieldSel.value)[2]; };
  fieldSel.addEventListener('change', sync); sync();
  const form = el('form', { class: 'ws-fieldset ds-stack', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const field = fieldSel.value;
    const value = field === 'demandConfirmed' ? demand.value === 'true' : valueIn.value.trim() === '' ? null : Number(valueIn.value);
    if (value !== null && typeof value === 'number' && (!Number.isFinite(value) || value < 0)) return setMsg(m, 'Enter a number of zero or more, or leave it blank to clear it.', 'error');
    if (reason.value.trim().length < (field === 'monthlyCashSavingGBP' ? 10 : 3)) return setMsg(m, field === 'monthlyCashSavingGBP' ? 'Explain what spending would stop (at least 10 characters).' : 'Say where this figure comes from.', 'error');
    setMsg(m, 'Saving…');
    try { await api(`/api/firm/discoveries/${id}/pain-points/${o.id}/corrections`, 'POST', { field, value, reason: reason.value.trim() }); location.reload(); }
    catch (err) { setMsg(m, err.message, 'error'); }
  } },
  el('h3', { class: 'ds-h4' }, 'Add a figure'),
  el('p', { class: 'ds-help' }, 'Figures you add are marked “Entered by your firm” and saved with your reason. They don’t count as evidence that the problem exists.'),
  el('div', { class: 'ds-form-grid' },
    el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: 'op-case-field' }, 'Figure'), fieldSel),
    el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: valueIn.hidden ? 'op-case-demand' : 'op-case-value' }, 'Value'), valueIn, demand, help)),
  el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: 'op-case-reason' }, 'Source or basis'), reason),
  el('div', { class: 'ds-cluster' }, el('button', { class: 'ds-btn ds-btn--secondary', type: 'submit' }, 'Save figure'), m));
  return form;
}

function actionView(o) {
  return el('div', { class: 'ds-stack' }, el('h3', { class: 'ds-h4' }, o.recommendedAction.title),
    el('ol', { class: 'ds-body-sm' }, ...o.recommendedAction.steps.map((s) => el('li', {}, s))),
    el('p', { class: 'ds-help' }, 'Suggested by fixed rules, not a final plan. Nothing is built, or promised as doable, until JADA’s engineers have reviewed it.'));
}

function reviewView(intel, o) {
  const id = intel.discovery.id, base = `/api/firm/discoveries/${id}/opportunities/${o.id}`;
  const approveBlockers = o.gates.filter((g) => g.blocksPriority);
  const reason = el('textarea', { class: 'ds-textarea', id: 'op-decision-reason', rows: '2', maxlength: '1000' });
  const m = msgEl();
  const decide = (decision) => async () => {
    if ((decision === 'challenged' || decision === 'rejected') && reason.value.trim().length < 3) { reason.focus(); return setMsg(m, `Say why you’re ${decision === 'rejected' ? 'rejecting' : 'challenging'} it.`, 'error'); }
    setMsg(m, 'Saving…');
    try { await api(`${base}/decision`, 'POST', { decision, reason: reason.value.trim() }); location.reload(); } catch (err) { setMsg(m, err.message, 'error'); }
  };
  const btn = (label, kind, decision, disabled) => el('button', { class: `ds-btn ds-btn--${kind}`, type: 'button', disabled, onclick: decide(decision) }, label);
  const latest = o.decision.latest;
  const decisionBox = o.status === 'sent_to_engineering' && FEATURES.laterStages ? firmEngineeringBox(intel, o)
    : el('div', { class: 'ws-fieldset ds-stack' },
      latest ? el('p', { class: 'ds-body-sm' }, el('strong', {}, `${DECISION_LABEL[latest]}`), o.decision.at ? ` on ${fmtDateTime(o.decision.at)}` : '', o.decision.reason ? ` — ${o.decision.reason}` : '') : null,
      approveBlockers.length && latest !== 'approved' ? alertBox('info', 'Can’t be approved yet', approveBlockers.map((g) => g.label).join('. ') + (approveBlockers.some((g) => g.code === 'not_validated') ? '. Validate the finding in discovery first.' : '.')) : null,
      el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: 'op-decision-reason' }, 'Reason', el('span', { class: 'ds-optional' }, ' (required to challenge or reject)')), reason),
      el('div', { class: 'ds-cluster' },
        latest !== 'approved' ? btn('Approve', 'primary', 'approved', approveBlockers.length > 0) : null,
        btn('Challenge', 'secondary', 'challenged', false), latest !== 'rejected' ? btn('Reject', 'secondary', 'rejected', false) : null,
        latest ? btn('Reopen', 'ghost', 'reopened', false) : null, m),
      null);
  return el('div', { class: 'ds-stack' }, decisionBox, FEATURES.laterStages ? engineeringBox(intel, o) : null, historyList(intel, o));
}

function engineeringBox(intel, o) {
  const id = intel.discovery.id, base = `/api/firm/discoveries/${id}/opportunities/${o.id}`;
  const download = linkBtn(`${base}/brief.md`, 'Download brief (Markdown)', 'ghost', { download: '' });
  if (o.status === 'sent_to_engineering') return el('div', { class: 'ds-cluster' }, download);
  const note = el('textarea', { class: 'ds-textarea', id: 'op-eng-note', rows: '2', maxlength: '2000' });
  const m = msgEl();
  const send = el('button', { class: 'ds-btn ds-btn--primary', type: 'button', disabled: !o.engineering.eligible, onclick: async () => {
    send.disabled = true; setMsg(m, 'Sending…');
    try { await api(`${base}/engineering-review`, 'POST', { note: note.value.trim() }); location.reload(); } catch (err) { setMsg(m, err.message, 'error'); send.disabled = false; }
  } }, 'Send to JADA engineering review');
  return el('div', { class: 'ws-fieldset ds-stack' }, el('h3', { class: 'ds-h4' }, 'JADA engineering review'),
    el('p', { class: 'ds-help' }, 'JADA receives the problem, evidence summary, classification, recommended outcome, expected impact, dependencies, risks and controls, open questions and proposed success measures. Engineering decides whether and how to proceed.'),
    o.engineering.blockers.length ? el('ul', { class: 'ds-body-sm' }, ...o.engineering.blockers.map((b) => el('li', {}, b))) : null,
    el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: 'op-eng-note' }, 'Anything JADA should know', el('span', { class: 'ds-optional' }, ' (optional)')), note),
    el('div', { class: 'ds-cluster' }, send, download, m));
}

function historyList(intel, o) {
  const f = (intel.history || {})[o.id] || [];
  return el('div', {}, el('h3', { class: 'ds-h4' }, 'History'), f.length ? el('ul', { class: 'ws-list dw-history' }, ...f.map((h) => el('li', { class: 'dw-history__item' },
    el('span', {}, el('strong', {}, h.label), h.field === 'opportunity_decision' ? `: ${decisionText(h.newValue)}` : h.field === 'clarification' ? `: ${h.newValue}`
      : /GBP$/.test(h.field) ? `: ${h.oldValue == null ? '—' : gbp(h.oldValue)} → ${h.newValue == null ? '—' : gbp(h.newValue)}` : `: ${fmtVal(h.oldValue)} → ${fmtVal(h.newValue)}`,
      h.reason && h.reason !== decisionText(h.newValue) ? el('span', { class: 'ws-subtle' }, ` — ${h.reason}`) : null), el('time', { datetime: h.at }, fmtDateTime(h.at)))))
    : el('p', { class: 'ds-muted ds-body-sm' }, 'No decisions or corrections yet. Everything is recorded here with its reason.'));
}

// Phase 5: what JADA engineering is doing with a submission, and answering its questions.
const FIRM_OUTCOME = { not_yet_measured: 'Not yet measured: finishing the work isn’t success on its own.', no_agreed_targets: 'No agreed targets yet.', partly_measured: 'Partly measured.', met: 'The agreed outcome was met.', not_met: 'The agreed outcome was not met.' };
function firmEngineeringBox(intel, o) {
  const box = el('div', { class: 'ds-stack' }, el('p', { class: 'ds-loading' }, 'Loading engineering status…'));
  api(`/api/firm/discoveries/${intel.discovery.id}/engineering`).then(({ submissions }) => {
    const s = submissions.find((x) => x.opportunityId === o.id);
    if (!s) { box.replaceChildren(alertBox('success', 'With JADA engineering review', 'The brief has been sent. Nothing is built until engineering has reviewed it.')); return; }
    const [label, variant] = PACK_STATUS[s.status] || [s.status, 'neutral'];
    const parts = [el('p', { class: 'ds-cluster' }, status(label, variant), el('span', { class: 'ws-subtle' }, `Sent ${fmtDate(s.submittedAt)} · updated ${fmtDateTime(s.updatedAt)}`))];
    const open = s.informationRequests.find((r) => r.answer === null);
    if (open && s.actions.includes('provide_information')) {
      const m = msgEl();
      const ans = el('textarea', { class: 'ds-textarea', id: 'op-eng-answer', rows: '3', maxlength: '4000' });
      parts.push(el('div', { class: 'ws-fieldset ds-stack' }, el('h3', { class: 'ds-h4' }, 'JADA engineering asks'), el('ul', { class: 'ds-body-sm' }, ...open.questions.map((q) => el('li', {}, q))),
        el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: 'op-eng-answer' }, 'Your answer'), ans, el('p', { class: 'ds-help' }, 'Don’t include client names or details.')),
        el('div', { class: 'ds-cluster' }, el('button', { class: 'ds-btn ds-btn--primary', type: 'button', onclick: async () => {
          setMsg(m, 'Sending…');
          try { await api(`/api/firm/discoveries/${intel.discovery.id}/engineering/${s.id}/information`, 'POST', { answer: ans.value.trim() }); location.reload(); } catch (err) { setMsg(m, err.message, 'error'); }
        } }, 'Send answer'), m)));
    }
    if (s.design) parts.push(el('p', { class: 'ds-body-sm' }, el('strong', {}, 'Approach: '), `${s.approaches.find((a) => a.id === s.design.approach)?.label || s.design.approach}. `,
      s.design.template ? `Based on “${s.design.template.name}” (${s.design.template.readiness.label.toLowerCase()}).` : 'Custom engineering design.'));
    if (s.plan) parts.push(s.submission.classification !== 'automate' ? null : el('p', { class: 'ds-body-sm' }, el('strong', {}, 'Two-week build: '), s.twoWeekOffer.offered ? 'can be offered (conditional, not a guarantee).' : `not offered — ${s.twoWeekOffer.reasons.join('; ')}.`),
      el('p', { class: 'ds-body-sm' }, el('strong', {}, 'Agreed measures: '), s.plan.successMeasures.map((x) => `${x.name}${x.target === null ? ' (target to agree)' : ` (target ${x.direction === 'decrease' ? '≤' : '≥'} ${num(x.target)} ${x.unit})`}`).join('; ')),
      el('p', { class: 'ds-body-sm' }, el('strong', {}, 'Outcome: '), FIRM_OUTCOME[s.outcome.overall]));
    if (s.integration) parts.push(el('p', { class: 'ds-help' }, `Live mailbox access: ${s.integration.activated ? 'activated' : 'not activated'}. It stays off until the Outlook technical spike passes its critical tests.`));
    parts.push(el('details', { class: 'op-details' }, el('summary', {}, 'Engineering history'), el('div', { class: 'op-details__body' }, s.history.length
      ? el('ul', { class: 'ws-list dw-history' }, ...s.history.map((h) => el('li', { class: 'dw-history__item' }, el('span', {}, el('strong', {}, h.label), ` — ${h.by}`, h.note ? el('span', { class: 'ws-subtle' }, ` · ${h.note}`) : null), el('time', { datetime: h.at }, fmtDateTime(h.at)))))
      : el('p', { class: 'ds-muted ds-body-sm' }, 'No engineering decisions yet.'))));
    box.replaceChildren(el('div', { class: 'ws-fieldset ds-stack' }, el('h3', { class: 'ds-h4' }, 'JADA engineering'), ...parts.filter(Boolean)));
  }).catch((err) => box.replaceChildren(alertBox('danger', 'Couldn’t load the engineering status', err.message)));
  return box;
}
