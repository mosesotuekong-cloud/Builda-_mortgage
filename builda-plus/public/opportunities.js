'use strict';
// builda+ opportunity intelligence (Phase 4). Loaded after discovery.js and before workspace.js; uses their
// helpers at call time. Everything shown comes from GET /api/firm/discoveries/:id/opportunities, which is
// computed by fixed rules from discovery evidence. Nothing here estimates, ranks or fills in a figure.

const OPP_STATUS = {
  keep_human: ['Keep human', 'neutral'], needs_classification: ['Needs your classification', 'warning'], needs_evidence: ['Needs evidence', 'warning'], compliance_review: ['Compliance review first', 'warning'],
  awaiting_validation: ['Awaiting your validation', 'warning'], ready_for_review: ['Ready for your decision', 'info'], challenged: ['Challenged', 'warning'],
  approved: ['Approved', 'success'], rejected: ['Rejected', 'neutral'], sent_to_engineering: ['With JADA engineering', 'success'],
};
const BAND = { High: ['High', 'success'], Medium: ['Medium', 'info'], Low: ['Low', 'neutral'] };
const AUTOMATION = { conventional: 'Conventional automation (no AI)', ai_assisted: 'AI-assisted automation', not_assessed: 'Automation approach not yet assessed' };
const DECISION_LABEL = { approved: 'Approved', challenged: 'Challenged', rejected: 'Rejected', reopened: 'Reopened', sent_to_engineering: 'Sent to JADA engineering review' };
const INPUT_SOURCE = { employee_reported: 'employee_reported', firm_provided: 'firm_provided', assumption: 'assumption', measured: 'measured' };
const READING = { value: ['Value', 'impact and volume'], feasibility: ['Feasibility', 'feasibility and complexity'], confidence: ['Evidence confidence', 'how well supported'], risk: ['Risk', '5 means lowest risk'] };
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
  const head = pageHeader('Opportunities', 'What discovery found, classified and prioritised by fixed rules. Approve the ones that should go to JADA engineering review.');
  if (!list.length) return [head, picker, empty('No opportunities yet', 'Analysis didn’t produce any findings for this discovery. Check the interviews and run the analysis again.', linkBtn(`/app/discovery/${id}`, 'Open discovery', 'primary'), 'opportunities'), hypothesesSection(intel)];
  const stats = el('dl', { class: 'ws-stats op-stats' }, ...[
    [s.total, 'Opportunities'], [s.prioritised, 'Prioritised'], [s.readyForReview, 'Ready for your decision'], [s.awaitingValidation, 'Awaiting validation'],
    [s.needsEvidence + s.needsClassification + s.complianceReview, 'Held back'], [s.approved, 'Approved'],
  ].map(([v, l]) => el('div', { class: 'ws-stat' }, el('dt', { class: 'ws-stat__label' }, l), el('dd', { class: 'ws-stat__value' }, String(v)))));
  const byClass = el('p', { class: 'ds-cluster op-classes' }, ...['overhaul', 'fix', 'automate', 'keep_human'].map((c) => el('span', { class: 'ds-cluster' }, classification(c), el('span', { class: 'ws-subtle' }, String(s.byClassification[c])))),
    s.byClassification.unclassified ? el('span', { class: 'ws-subtle' }, `${s.byClassification.unclassified} not yet classified`) : null);

  // Filters (client-side over the loaded list; state kept in the query string).
  const q = new URLSearchParams(location.search);
  const sel = (name, label, opts) => el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: `op-f-${name}` }, label),
    el('select', { class: 'ds-select', id: `op-f-${name}`, name }, el('option', { value: '' }, 'All'), ...opts.map(([v, l]) => el('option', { value: v, selected: q.get(name) === v }, l))));
  const stages = [...new Map(list.map((o) => [o.stageId, o.stageName])).entries()];
  const filters = el('form', { class: 'op-filters', role: 'search', 'aria-label': 'Filter opportunities' },
    sel('stage', 'Stage', stages), sel('classification', 'Classification', Object.entries(CLASSIFICATION).map(([k, [, l]]) => [k, l])),
    sel('priority', 'Priority', [['High', 'High'], ['Medium', 'Medium'], ['Low', 'Low'], ['unranked', 'Not ranked']]),
    sel('confidence', 'Confidence', Object.entries(CONFIDENCE).map(([k, [, l]]) => [k, l])),
    sel('status', 'Review status', Object.entries(OPP_STATUS).map(([k, [l]]) => [k, l])));
  const results = el('div', {});
  const apply = () => {
    const f = Object.fromEntries([...new FormData(filters)].filter(([, v]) => v));
    const p = new URLSearchParams(location.search);
    for (const k of ['stage', 'classification', 'priority', 'confidence', 'status']) { if (f[k]) p.set(k, f[k]); else p.delete(k); }
    history.replaceState(null, '', `${location.pathname}${p.toString() ? `?${p}` : ''}`);
    const shown = list.filter((o) => (!f.stage || o.stageId === f.stage) && (!f.classification || o.classification === f.classification)
      && (!f.priority || (f.priority === 'unranked' ? o.priorityRank === null : o.band === f.priority))
      && (!f.confidence || o.evidence.dimensions.existence.level === f.confidence) && (!f.status || o.status === f.status));
    results.replaceChildren(...resultsView(intel, shown, Object.keys(f).length > 0));
  };
  filters.addEventListener('change', apply);
  apply();
  return [head, picker, stats, byClass, filters, results, hypothesesSection(intel), methodSection(intel),
    el('div', { class: 'ws-section' }, el('details', { class: 'op-details', open: !(ws.discoveries.find((d) => d.id === id) || {}).reportedAt }, el('summary', {}, 'Create the discovery report'), el('div', { class: 'op-details__body', 'data-load': id })))]
    .map((n) => (n && n.querySelector && n.querySelector('[data-load]') ? lazyDecisions(n, ws) : n));
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
  out.push(section('Priorities', el('span', { class: 'ws-subtle' }, filtered ? `${ranked.length} shown` : null), ranked.length ? el('div', { class: 'ds-table-wrap' }, el('table', { class: 'ds-table op-table' },
    el('caption', { class: 'ds-visually-hidden' }, 'Prioritised opportunities'),
    el('thead', {}, el('tr', {}, el('th', { scope: 'col', class: 'ds-table__num' }, 'Rank'), ...['Opportunity', 'Approach', 'Priority', 'Confidence it exists'].map((h) => el('th', { scope: 'col' }, h)),
      el('th', { scope: 'col', class: 'ds-table__num' }, 'Hours recovered / month'), el('th', { scope: 'col' }, 'Status'))),
    el('tbody', {}, ...ranked.map((o) => el('tr', {},
      el('td', { class: 'ds-table__num' }, String(o.priorityRank)),
      el('th', { scope: 'row' }, el('a', { href: oUrl(id, o.id) }, o.title), el('div', { class: 'ws-subtle' }, o.stageName)),
      el('td', {}, classification(o.classification)),
      el('td', {}, band(o.band), el('div', { class: 'ws-subtle' }, `score ${o.score}`)),
      el('td', {}, confidence(o.evidence.dimensions.existence.level)),
      el('td', { class: 'ds-table__num' }, num(o.businessCase && o.businessCase.timeRecovered.monthlyHoursRecovered)),
      el('td', {}, oppStatus(o.status))))))) : el('p', { class: 'ds-muted ds-body-sm' }, 'No opportunity can be prioritised yet. Each one below says what’s holding it back.')));
  if (held.length) out.push(section('Not prioritised', el('span', { class: 'ws-subtle' }, 'Impact never outweighs missing evidence or a regulatory constraint'),
    el('ul', { class: 'ws-list op-held' }, ...held.map((o) => el('li', {},
      el('span', { class: 'ds-stack op-held__main' }, el('span', { class: 'ds-cluster' }, el('a', { href: oUrl(id, o.id) }, o.title), classification(o.classification), o.status === 'keep_human' ? null : oppStatus(o.status)),
        el('span', { class: 'ws-subtle' }, `${o.stageName} · ${(o.gates.filter((g) => g.blocksPriority).map((g) => g.label).join('; ')) || (o.status === 'rejected' ? 'Rejected by you' : o.needsReassessment || 'Not scored')}`)))))));
  out.push(el('p', { class: 'ds-help ws-section' }, 'Hours are operational capacity from your team’s estimates, not a cash saving. “Unknown” means a figure is missing; builda+ never fills it in.'));
  return out;
}

function hypothesesSection(intel) {
  return section('Industry hypotheses', el('span', { class: 'ws-subtle' }, 'Not ranked'), el('div', { class: 'ds-stack' },
    el('p', { class: 'ds-help' }, 'Common problems at mortgage brokerages that didn’t come up in your interviews. They’re not findings about your firm and are never prioritised. If one sounds familiar, ask about it in a follow-up interview.'),
    intel.hypotheses.length ? el('ul', { class: 'ws-list' }, ...intel.hypotheses.map((h) => el('li', {}, el('span', { class: 'ds-cluster' }, sourceBadge('industry_knowledge'), h.title), el('span', { class: 'ws-subtle' }, h.stageName))))
      : el('p', { class: 'ds-muted ds-body-sm' }, 'None outstanding: every common problem in the playbook was either raised or doesn’t apply.')));
}

function methodSection(intel) {
  const w = intel.scoring.weights;
  return section('How priorities are set', null, el('details', { class: 'op-details' }, el('summary', {}, `Scoring ${intel.scoring.version}: fixed rules, no AI`),
    el('div', { class: 'op-details__body ds-stack ds-body-sm' },
      el('p', {}, `Each scored opportunity gets a 0–100 score from six dimensions: ${Object.entries(w).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ')}. High is ${intel.scoring.bands.high} or more; medium ${intel.scoring.bands.medium} or more.`),
      el('p', {}, 'Value, feasibility, confidence and risk are shown separately on each opportunity, so a large estimate can’t hide weak evidence or high risk.'),
      el('p', {}, 'Some things stop an opportunity being prioritised at all, however large its impact: no firm-specific evidence, work at a regulated stage that needs compliance review, and anything classified keep human.'))));
}

/* ============================================================ detail */
const OPP_TABS = [['overview', 'Overview'], ['problem', 'The problem'], ['evidence', 'Evidence'], ['assessment', 'Assessment'], ['case', 'Business case'], ['action', 'Recommended action'], ['review', 'Review and approval']];

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
    sec('assessment', assessmentView(o)), sec('case', caseView(intel, o)), sec('action', actionView(o)), sec('review', reviewView(intel, o))] };
}

function overviewView(intel, o) {
  const blocking = o.gates.filter((g) => g.blocksPriority);
  return el('div', { class: 'ds-stack' },
    blocking.length ? alertBox('warning', 'Not prioritised', `${blocking.map((g) => g.label).join('. ')}. However large the impact, this stays out of the priority order until that is resolved.`) : null,
    el('div', { class: 'op-readings' }, ...Object.keys(READING).map((k) => {
      const r = o.readings[k];
      return el('div', { class: 'dw-figure' }, el('span', { class: 'ws-subtle' }, READING[k][0]),
        el('strong', {}, r === null || r === undefined ? 'Not scored' : `${num(r)} / 5`), el('span', { class: 'ws-subtle' }, k === 'value' && o.readings.valueUnknown ? 'impact unknown: scored at the floor, not a measured low value' : READING[k][1]));
    })),
    el('p', { class: 'ds-help' }, 'Each reading is on a 1–5 scale from the existing scoring rules, shown separately so a large estimate can’t hide weak evidence or high risk. The overall score combines them by fixed weights; the gates above are applied first.'),
    o.explanation.length ? el('div', {}, el('h3', { class: 'ds-h4' }, 'Why it ranks above the next opportunity'), el('ul', { class: 'ws-list ds-body-sm' }, ...o.explanation.map((x) => el('li', {}, x)))) : null);
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
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Claim'), el('th', { scope: 'col' }, 'Confidence'), el('th', { scope: 'col' }, 'Why'))),
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
      el('dt', {}, 'Classification'), el('dd', {}, o.classification ? `${CLASSIFICATION[o.classification][1]} — ${CLASSIFICATION_SOURCE[o.classificationSource] || 'source not recorded'}` : 'Not yet classified'),
      o.automationType ? el('dt', {}, 'Automation type') : null, o.automationType ? el('dd', {}, AUTOMATION[o.automationType]) : null,
      el('dt', {}, 'Rationale'), el('dd', {}, o.classificationRationale || 'None recorded'),
      el('dt', {}, 'Feasibility'), el('dd', {}, a.feasibility), el('dt', {}, 'Complexity'), el('dd', {}, a.complexity),
      a.twoWeek ? el('dt', {}, 'Two-week build check') : null, a.twoWeek ? el('dd', {}, `${a.twoWeek.status.replace(/_/g, ' ')}${a.twoWeek.blockers.length ? `: ${a.twoWeek.blockers.join('; ')}` : ''}`) : null),
    el('div', { class: 'ws-grid-2' }, list('Risks, regulatory considerations and controls', a.risks, 'None identified from the playbook. Engineering review still checks this.'), list('Dependencies', a.dependencies, 'None identified yet.')),
    list('What’s missing', a.missing, 'Nothing outstanding.'),
    o.gates.length ? el('div', {}, el('h3', { class: 'ds-h4' }, 'Gates'), el('ul', { class: 'ws-list ds-body-sm' }, ...o.gates.map((g) => el('li', {}, g.label,
      el('span', { class: 'ws-subtle' }, g.blocksPriority ? 'blocks prioritisation' : g.blocksEngineering ? 'blocks engineering hand-over' : 'shown for awareness'))))) : null);
}

function caseView(intel, o) {
  const bc = o.businessCase;
  if (!bc) return el('p', { class: 'ds-muted ds-body-sm' }, 'No business case: this finding hasn’t been sized.');
  const value = (title, figure, method, extra) => el('div', { class: 'dw-figure op-value' }, el('span', { class: 'ws-subtle' }, title), el('strong', {}, figure), el('span', { class: 'ds-body-sm' }, method), extra || null);
  const t = bc.timeRecovered;
  return el('div', { class: 'ds-stack' },
    el('p', { class: 'ds-help' }, 'Four kinds of value, kept apart. Recovered time is capacity, not cash: it only becomes a saving if the firm actually spends less.'),
    el('div', { class: 'op-values' },
      value('Time recovered', t.monthlyHoursRecovered === null ? 'Unknown' : `${num(t.monthlyHoursRecovered)} hours / month`, t.method,
        t.valueAtStatedCostGBP !== null ? el('span', { class: 'ws-subtle' }, `${gbp(t.valueAtStatedCostGBP)} at your stated hourly cost — not a saving`) : null),
      value('Cash savings', bc.cashSavings.monthlyGBP === null ? 'None stated' : `${gbp(bc.cashSavings.monthlyGBP)} / month`, bc.cashSavings.method,
        bc.cashSavings.basis ? el('span', { class: 'ws-subtle' }, `Basis: ${bc.cashSavings.basis}`) : null),
      value('Operational capacity', bc.capacity.additionalCasesPerMonth === null ? 'Unknown' : `${num(bc.capacity.additionalCasesPerMonth)} more cases / month`, bc.capacity.method),
      value('Revenue', bc.revenue.monthlyPotentialGBP === null ? 'Not estimated' : `${gbp(bc.revenue.monthlyPotentialGBP)} / month`, bc.revenue.method)),
    el('div', { class: 'dw-figure' }, el('span', { class: 'ws-subtle' }, 'Payback'), el('strong', {}, bc.payback.months === null ? 'Not calculated' : `${num(bc.payback.months)} months`), el('span', { class: 'ds-body-sm' }, bc.payback.reason)),
    el('div', { class: 'ds-table-wrap' }, el('table', { class: 'ds-table' }, el('caption', {}, 'Inputs and where each came from'),
      el('thead', {}, el('tr', {}, ...['Input', 'Value', 'Source'].map((h) => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, ...CASE_INPUT_ORDER.filter((k) => bc.inputs[k]).map((k) => [k, bc.inputs[k]]).map(([k, i]) => el('tr', {}, el('th', { scope: 'row' }, i.label),
        el('td', {}, i.value === null ? 'Missing' : /GBP$/.test(k) ? gbp(i.value) : k === 'reductionPct' ? `${Math.round(i.value * 100)}%` : num(i.value)),
        el('td', {}, i.source ? el('span', { class: 'ds-cluster' }, sourceBadge(INPUT_SOURCE[i.source] || 'assumption'), i.note ? el('span', { class: 'ws-subtle' }, i.note) : null) : el('span', { class: 'ws-subtle' }, '—'))))))),
    bc.missing.length ? el('div', {}, el('h3', { class: 'ds-h4' }, 'Missing inputs'), el('ul', { class: 'ds-body-sm' }, ...bc.missing.map((m) => el('li', {}, m)))) : null,
    caseForm(intel, o));
}

// Firm-supplied business-case inputs go through the existing audited corrections endpoint.
function caseForm(intel, o) {
  const id = intel.discovery.id;
  const fields = [
    ['implementationCostGBP', 'Implementation cost (£, one-off)', 'A quote or budget you have. Leave blank if unknown: payback stays uncalculated.'],
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
  el('h3', { class: 'ds-h4' }, 'Add a business-case input'),
  el('p', { class: 'ds-help' }, 'Figures you supply are labelled firm-provided and recorded with your reason. They never raise confidence that the problem exists.'),
  el('div', { class: 'ds-form-grid' },
    el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: 'op-case-field' }, 'Input'), fieldSel),
    el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: valueIn.hidden ? 'op-case-demand' : 'op-case-value' }, 'Value'), valueIn, demand, help)),
  el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: 'op-case-reason' }, 'Source or basis'), reason),
  el('div', { class: 'ds-cluster' }, el('button', { class: 'ds-btn ds-btn--secondary', type: 'submit' }, 'Save input'), m));
  return form;
}

function actionView(o) {
  return el('div', { class: 'ds-stack' }, el('h3', { class: 'ds-h4' }, o.recommendedAction.title),
    el('ol', { class: 'ds-body-sm' }, ...o.recommendedAction.steps.map((s) => el('li', {}, s))),
    el('p', { class: 'ds-help' }, 'A recommendation from fixed rules, not a plan. Nothing is built or confirmed as feasible until JADA engineering has reviewed it.'));
}

function reviewView(intel, o) {
  const id = intel.discovery.id, base = `/api/firm/discoveries/${id}/opportunities/${o.id}`;
  const approveBlockers = o.gates.filter((g) => g.blocksPriority || g.code === 'not_validated');
  const reason = el('textarea', { class: 'ds-textarea', id: 'op-decision-reason', rows: '2', maxlength: '1000' });
  const m = msgEl();
  const decide = (decision) => async () => {
    if ((decision === 'challenged' || decision === 'rejected') && reason.value.trim().length < 3) { reason.focus(); return setMsg(m, `Say why you’re ${decision === 'rejected' ? 'rejecting' : 'challenging'} it.`, 'error'); }
    setMsg(m, 'Saving…');
    try { await api(`${base}/decision`, 'POST', { decision, reason: reason.value.trim() }); location.reload(); } catch (err) { setMsg(m, err.message, 'error'); }
  };
  const btn = (label, kind, decision, disabled) => el('button', { class: `ds-btn ds-btn--${kind}`, type: 'button', disabled, onclick: decide(decision) }, label);
  const latest = o.decision.latest;
  const decisionBox = o.status === 'sent_to_engineering' ? firmEngineeringBox(intel, o)
    : el('div', { class: 'ws-fieldset ds-stack' },
      latest ? el('p', { class: 'ds-body-sm' }, el('strong', {}, `${DECISION_LABEL[latest]}`), o.decision.at ? ` on ${fmtDateTime(o.decision.at)}` : '', o.decision.reason ? ` — ${o.decision.reason}` : '') : null,
      approveBlockers.length && latest !== 'approved' ? alertBox('info', 'Can’t be approved yet', approveBlockers.map((g) => g.label).join('. ') + (approveBlockers.some((g) => g.code === 'not_validated') ? '. Validate the finding in discovery first.' : '.')) : null,
      el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: 'op-decision-reason' }, 'Reason', el('span', { class: 'ds-optional' }, ' (required to challenge or reject)')), reason),
      el('div', { class: 'ds-cluster' },
        latest !== 'approved' ? btn('Approve', 'primary', 'approved', approveBlockers.length > 0) : null,
        btn('Challenge', 'secondary', 'challenged', false), latest !== 'rejected' ? btn('Reject', 'secondary', 'rejected', false) : null,
        latest ? btn('Reopen', 'ghost', 'reopened', false) : null, m),
      o.validated ? null : el('p', { class: 'ds-help' }, el('a', { href: dUrl(id, 'findings', o.id) }, 'Validate this finding in discovery'), ' before approving it.'));
  return el('div', { class: 'ds-stack' }, decisionBox, engineeringBox(intel, o), historyList(intel, o));
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
