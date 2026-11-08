'use strict';
// JADA engineering workspace (Phase 5). Everything shown comes from /api/jada/engineering, which row-level
// security limits to the discoveries assigned to the signed-in engineer. Nothing here approves, designs or
// plans on its own: every change is a named engineer's action, checked again on the server.

/* ============================================================ helpers */
const $sidebar = document.getElementById('ws-sidebar');
const $topbar = document.getElementById('ws-topbar');
const $main = document.getElementById('ws-main');
const $scrim = document.getElementById('ws-scrim');
const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'value' && (tag === 'input' || tag === 'textarea' || tag === 'select')) n.value = v;
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}
const ICONS = {
  queue: ['M4 6h16', 'M4 12h16', 'M4 18h10'], templates: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
  escalations: ['M12 3l9 16H3z', 'M12 10v4', 'M12 17h.01'], menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'], signout: ['M15 4h4v16h-4', 'M10 8l-4 4 4 4', 'M6 12h11'],
};
function icon(name) {
  const s = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.75', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) s.setAttribute(k, v);
  for (const d of ICONS[name] || []) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
}
// Turns a validation path like "requirements.acceptance.0" into words an engineer recognises.
const FIELD_HINT = (path) => { const last = String(path).split('.').filter((x) => !/^\d+$/.test(x)); const k = last[last.length - 1] || 'a field';
  return ({ measuredAt: 'measurement date', successMeasures: 'success measures', responsibleParties: 'responsible parties', baselineSource: 'baseline source', measurementSource: 'measured by', testingPlan: 'testing plan', acceptanceCriteria: 'acceptance criteria', deliverables: 'deliverables', scope: 'implementation scope', rationale: 'why this approach', questions: 'questions', reason: 'reason', basis: 'basis for the estimate', name: 'measure name', unit: 'unit', period: 'measurement period', party: 'party', responsibility: 'responsibility' })[k] || k.replace(/([A-Z])/g, ' $1').toLowerCase(); };
class ApiError extends Error { constructor(m, s) { super(m); this.status = s; } }
async function api(path, method = 'GET', body) {
  const res = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { location.href = '/signin'; throw new ApiError('Please sign in.', 401); }
  if (!res.ok) throw new ApiError(data.issues && data.issues.length ? `${data.error} Check: ${[...new Set(data.issues.map((i) => FIELD_HINT(i.path)))].join('; ')}.` : data.error || 'Something went wrong.', res.status);
  return data;
}
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const num = (x) => (x === null || x === undefined ? 'Unknown' : Number(x).toLocaleString('en-GB', { maximumFractionDigits: 1 }));
const gbp = (x) => (x === null || x === undefined ? 'Unknown' : `£${Number(x).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`);
const status = (label, v) => el('span', { class: `ds-status ds-status--${v}` }, label);
const CONF = { insufficient: ['insufficient', 'Insufficient'], low: ['low', 'Low'], medium: ['medium', 'Medium'], high: ['high', 'High'], very_high: ['very-high', 'Very high'] };
const confidence = (l) => { const [lvl, label] = CONF[l] || CONF.insufficient; return el('span', { class: 'ds-confidence', 'data-level': lvl }, el('span', { class: 'ds-confidence__bars', 'aria-hidden': 'true' }, el('i'), el('i'), el('i'), el('i')), label); };
const CLASS = { overhaul: ['overhaul', 'Overhaul'], fix: ['fix', 'Fix'], automate: ['automate', 'Automate'], keep_human: ['keep-human', 'Keep human'] };
const classification = (c) => (c && CLASS[c] ? el('span', { class: `ds-class ds-class--${CLASS[c][0]}` }, CLASS[c][1]) : el('span', { class: 'ws-subtle' }, 'Unclassified'));
const GROUP_VARIANT = { awaiting_review: 'info', under_assessment: 'info', awaiting_information: 'warning', approved: 'success', in_progress: 'info', completed: 'success', closed: 'neutral' };
const STATUS_LABEL = { in_review: 'Awaiting engineering review', under_assessment: 'Under assessment', needs_changes: 'Under assessment (two-week check: changes needed)', confirmed: 'Under assessment (two-week check passed)',
  awaiting_information: 'Awaiting information from the firm', approved_for_implementation: 'Approved for implementation', in_progress: 'In progress', completed: 'Completed', rejected: 'Rejected', deferred: 'Deferred' };
const groupStatus = (s) => status(STATUS_LABEL[s.status] || s.status, GROUP_VARIANT[s.group.key || s.group] || 'neutral');
const empty = (title, text, action) => el('div', { class: 'ds-empty' }, el('p', { class: 'ds-empty__title' }, title), el('p', { class: 'ds-empty__text' }, text), action || null);
const alertBox = (kind, title, text) => el('div', { class: `ds-alert ds-alert--${kind}` }, title && el('p', { class: 'ds-alert__title' }, title), text ? el('p', {}, text) : null);
const pageHeader = (title, description) => el('div', { class: 'ds-page-header' }, el('div', { class: 'ds-page-header__text' }, el('h1', { class: 'ds-page-header__title' }, title), description && el('p', { class: 'ds-page-header__description' }, description)));
const section = (title, aside, ...nodes) => el('section', { class: 'ws-section' }, el('div', { class: 'ws-section__head' }, el('h2', { class: 'ds-h3 ws-section__title' }, title), aside || null), ...nodes);
const list = (xs, none = 'None recorded.') => (xs && xs.length ? el('ul', { class: 'ds-body-sm eg-list' }, ...xs.map((x) => el('li', {}, typeof x === 'string' ? x : JSON.stringify(x)))) : el('p', { class: 'ds-muted ds-body-sm' }, none));
const sub = (title, ...nodes) => el('div', { class: 'eg-sub' }, el('h3', { class: 'ds-h4' }, title), ...nodes);
const msgEl = () => el('p', { class: 'ws-inline-msg', role: 'status', 'aria-live': 'polite' });
const setMsg = (m, t, k = '') => { m.textContent = t; m.dataset.kind = k; };
const lines = (v) => v.split('\n').map((x) => x.trim()).filter(Boolean);
const area = (id, label, value, help, rows = 3) => el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: id }, label),
  el('textarea', { class: 'ds-textarea', id, rows: String(rows), value: Array.isArray(value) ? value.join('\n') : value || '' }), help ? el('p', { class: 'ds-help' }, help) : null);
const val = (id) => document.getElementById(id).value;
const SOURCE = { employee_reported: 'Employee-reported', firm_provided: 'Firm-provided', assumption: 'Assumption', measured: 'Measured', industry_knowledge: 'Industry knowledge' };
const source = (s) => el('span', { class: `ds-evidence ds-evidence--${s === 'firm_provided' || s === 'employee_reported' ? 'firm-said' : s === 'measured' ? 'measured' : s === 'industry_knowledge' ? 'playbook' : 'assumption'}` }, SOURCE[s] || s);

/* ============================================================ shell */
function shell(active, crumbs) {
  const nav = [['queue', 'Engineering queue', '/jada/engineering'], ['templates', 'Solution templates', '/jada/engineering/templates'], ['escalations', 'Escalations and earlier packs', '/jada']];
  $sidebar.replaceChildren(
    el('a', { class: 'ws-brand', href: '/jada/engineering' }, el('span', { class: 'ws-brand__mark', 'aria-hidden': 'true' }), el('span', {}, 'JADA ', el('span', { class: 'ws-brand__plus' }, 'engineering'))),
    el('nav', { class: 'ws-nav', 'aria-label': 'Engineering' }, el('div', { class: 'ws-nav__group' }, el('ul', {}, ...nav.map(([k, l, h]) => el('li', {}, el('a', { class: 'ws-nav__link', href: h, 'aria-current': k === active ? 'page' : null }, icon(k), l)))))),
    el('p', { class: 'ws-sidebar__foot' }, el('a', { href: '/signout' }, 'Sign out')));
  $topbar.replaceChildren(
    el('button', { class: 'ds-btn ds-btn--ghost ws-menu-btn', type: 'button', 'aria-controls': 'ws-sidebar', onclick: () => { const o = !$sidebar.classList.contains('is-open'); $sidebar.classList.toggle('is-open', o); $scrim.hidden = !o; } }, icon('menu'), el('span', { class: 'ds-visually-hidden' }, 'Open navigation')),
    el('div', { class: 'ws-topbar__firm' }, el('span', {}, 'JADA engineering')),
    el('nav', { 'aria-label': 'Breadcrumb' }, el('ol', { class: 'ds-breadcrumb' }, ...crumbs.map((c, i) => el('li', {}, c.href && i < crumbs.length - 1 ? el('a', { href: c.href }, c.label) : el('span', { 'aria-current': 'page' }, c.label))))));
}
$scrim.addEventListener('click', () => { $sidebar.classList.remove('is-open'); $scrim.hidden = true; });

/* ============================================================ queue */
async function queuePage() {
  shell('queue', [{ label: 'Engineering queue' }]);
  const q = await api('/api/jada/engineering');
  const nodes = [pageHeader('Engineering queue', 'Opportunities firms have approved and sent from builda+. You decide whether and how each one is built; nothing is approved automatically.')];
  if (q.unassigned.length) nodes.push(section('Waiting to be picked up', el('span', { class: 'ws-subtle' }, 'Firm name and reason only until you pick a discovery up'),
    el('ul', { class: 'ws-list' }, ...q.unassigned.map((u) => {
      const m = msgEl();
      return el('li', {}, el('span', {}, el('strong', {}, u.firmName), el('span', { class: 'ws-subtle' }, ` · ${u.reason} · since ${fmtDate(u.since)}`)),
        el('span', { class: 'ds-cluster' }, el('button', { class: 'ds-btn ds-btn--secondary ds-btn--sm', type: 'button', onclick: async () => {
          try { await api(`/api/jada/discoveries/${u.discoveryId}/pick-up`, 'POST'); location.reload(); } catch (e) { setMsg(m, e.message, 'error'); } } }, 'Pick up'), m));
    }))));
  const subs = q.submissions;
  const counts = Object.fromEntries(q.groups.map((g) => [g.key, subs.filter((s) => s.group === g.key).length]));
  nodes.push(el('dl', { class: 'ws-stats eg-stats' }, ...q.groups.map((g) => el('div', { class: 'ws-stat' }, el('dt', { class: 'ws-stat__label' }, g.label), el('dd', { class: 'ws-stat__value' }, String(counts[g.key]))))));
  if (!subs.length) { nodes.push(empty('Nothing assigned to you yet', q.unassigned.length ? 'Pick up a discovery above to see its submissions.' : 'Submissions appear here when a firm sends an approved opportunity and the discovery is assigned to you.')); return nodes; }
  const p = new URLSearchParams(location.search);
  const uniq = (f) => [...new Map(subs.map((s) => [f(s)[0], f(s)[1]])).entries()];
  const sel = (name, label, opts) => el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: `eg-f-${name}` }, label),
    el('select', { class: 'ds-select', id: `eg-f-${name}`, name }, el('option', { value: '' }, 'All'), ...opts.map(([v, l]) => el('option', { value: v, selected: p.get(name) === v }, l))));
  const filters = el('form', { class: 'op-filters eg-filters', role: 'search', 'aria-label': 'Filter submissions' },
    sel('group', 'Engineering status', q.groups.map((g) => [g.key, g.label])), sel('firm', 'Firm', uniq((s) => [s.firmName, s.firmName])),
    sel('classification', 'Classification', Object.entries(CLASS).filter(([k]) => k !== 'keep_human').map(([k, [, l]]) => [k, l])),
    sel('stage', 'Stage', uniq((s) => [s.stageId, s.stageName])), sel('priority', 'Priority', [['High', 'High'], ['Medium', 'Medium'], ['Low', 'Low'], ['none', 'Not ranked']]),
    sel('confidence', 'Evidence confidence', Object.entries(CONF).map(([k, [, l]]) => [k, l])));
  const out = el('div', {});
  const apply = () => {
    const f = Object.fromEntries([...new FormData(filters)].filter(([, v]) => v));
    const u = new URLSearchParams(f); history.replaceState(null, '', `${location.pathname}${u.toString() ? `?${u}` : ''}`);
    const shown = subs.filter((s) => (!f.group || s.group === f.group) && (!f.firm || s.firmName === f.firm) && (!f.classification || s.classification === f.classification)
      && (!f.stage || s.stageId === f.stage) && (!f.priority || (f.priority === 'none' ? !s.priority?.band : s.priority?.band === f.priority)) && (!f.confidence || s.confidence === f.confidence));
    out.replaceChildren(...(shown.length ? q.groups.filter((g) => shown.some((s) => s.group === g.key)).map((g) => section(g.label, el('span', { class: 'ws-subtle' }, String(shown.filter((s) => s.group === g.key).length)),
      el('div', { class: 'ds-table-wrap' }, el('table', { class: 'ds-table eg-table' }, el('caption', { class: 'ds-visually-hidden' }, g.label),
        el('thead', {}, el('tr', {}, ...['Opportunity', 'Firm', 'Classification', 'Priority', 'Evidence', 'Submitted', 'Status', 'Reviewer'].map((h) => el('th', { scope: 'col' }, h)))),
        el('tbody', {}, ...shown.filter((s) => s.group === g.key).map((s) => el('tr', {},
          el('th', { scope: 'row' }, el('a', { href: `/jada/engineering/${s.id}` }, s.title), el('div', { class: 'ws-subtle' }, s.stageName), s.needsReassessment ? status('Needs reassessment', 'warning') : null),
          el('td', {}, s.firmName), el('td', {}, classification(s.classification)),
          el('td', {}, !s.priority ? el('span', { class: 'ws-subtle' }, 'Not recorded (earlier submission)') : s.priority.band ? `${s.priority.band}${s.priority.rank ? ` (#${s.priority.rank})` : ''}` : el('span', { class: 'ws-subtle' }, 'Not ranked')),
          el('td', {}, s.confidence ? confidence(s.confidence) : '—'), el('td', {}, fmtDate(s.submittedAt)), el('td', {}, groupStatus(s)), el('td', {}, s.assignedReviewer))))))))
      : [empty('Nothing matches these filters', 'Clear a filter to see more submissions.')]));
  };
  filters.addEventListener('change', apply); apply();
  nodes.push(filters, out);
  return nodes;
}

/* ============================================================ templates */
async function templatesPage() {
  shell('templates', [{ label: 'Engineering queue', href: '/jada/engineering' }, { label: 'Solution templates' }]);
  const { templates } = await api('/api/jada/engineering/templates');
  return [pageHeader('Solution templates', 'Reviewed reference designs maintained by JADA engineering (src/knowledge/solutionTemplates.ts, changed through code review). A template is a starting point for design, not a promise.'),
    ...templates.map((t) => section(`${t.name}`, el('span', { class: 'ds-cluster' }, el('span', { class: 'ws-chip' }, `v${t.version}`), status(t.readiness.label, t.readiness.productionReady ? 'success' : 'warning')), templateCard(t)))];
}
function templateCard(t) {
  return el('div', { class: 'ds-stack' },
    el('p', {}, t.problem),
    el('dl', { class: 'ds-meta' }, el('dt', {}, 'Approach'), el('dd', {}, APPROACH[t.approach] || t.approach), el('dt', {}, 'Applies to'), el('dd', {}, t.applicableClassifications.join(', ')),
      el('dt', {}, 'Design review'), el('dd', {}, t.approval.status === 'reviewed' ? `Reviewed (${t.approval.by}, ${t.approval.on}). ${t.approval.note}` : `Draft. ${t.approval.note}`),
      el('dt', {}, 'Validation'), el('dd', {}, t.validation === 'tested' ? 'Proven in a delivered implementation' : 'Untested: not proven in a delivered implementation'),
      el('dt', {}, 'Complexity'), el('dd', {}, `${t.complexity.estimate} (${t.complexity.validated ? 'validated' : 'not validated'}: ${t.complexity.basis})`),
      el('dt', {}, 'Duration'), el('dd', {}, t.durationEstimate ? `${t.durationEstimate.text} (${t.durationEstimate.validated ? 'validated' : 'not validated'}: ${t.durationEstimate.basis})` : 'No estimate'),
      t.specRef ? el('dt', {}, 'Specification') : null, t.specRef ? el('dd', {}, t.specRef) : null),
    t.integrationGate ? alertBox(t.integrationGate.status === 'passed' ? 'success' : 'warning', `Activation gate: ${t.integrationGate.status === 'passed' ? 'passed' : t.integrationGate.status === 'failed' ? 'failed' : 'not yet passed'}`, `${t.integrationGate.description} Blocks: ${t.integrationGate.blocks}`) : null,
    t.readiness.reasons.length ? el('p', { class: 'ds-help' }, `Not production-ready: ${t.readiness.reasons.join('; ')}.`) : null,
    el('details', { class: 'op-details' }, el('summary', {}, 'Full template'), el('div', { class: 'op-details__body eg-grid' },
      sub('Supported systems', list(t.supportedSystems)), sub('Required inputs', list(t.requiredInputs)), sub('Required permissions', list(t.requiredPermissions)),
      sub('Architecture overview', list(t.architectureOverview)), sub('Human controls', list(t.humanControls)), sub('Known limitations', list(t.knownLimitations)),
      sub('Testing requirements', list(t.testingRequirements)), sub('Acceptance criteria', list(t.acceptanceCriteria)))));
}
const APPROACH = { process_redesign: 'Process redesign', process_or_configuration_fix: 'Process or configuration fix', conventional_automation: 'Conventional automation (no AI)', ai_assisted: 'AI-assisted automation (with human review)' };

/* ============================================================ detail */
const SECTIONS = [['problem', 'Business problem'], ['solution', 'Proposed solution'], ['requirements', 'Engineering requirements'], ['risks', 'Risks and constraints'], ['outcomes', 'Expected outcomes'], ['plan', 'Implementation plan'], ['decide', 'Engineering decision'], ['history', 'History']];
async function detailPage(id) {
  const d = await api(`/api/jada/engineering/${id}`);
  const s = d.submission;
  shell('queue', [{ label: 'Engineering queue', href: '/jada/engineering' }, { label: s.title }]);
  const sec = (k, ...nodes) => { const n = section(SECTIONS.find(([x]) => x === k)[1], null, ...nodes); n.id = `eg-${k}`; return n; };
  return [
    el('div', { class: 'dw-finding-head' }, el('p', {}, el('a', { href: '/jada/engineering' }, '← Engineering queue')),
      el('h1', { class: 'ds-h2' }, s.title),
      el('div', { class: 'ds-cluster' }, el('strong', {}, d.firmName), classification(s.classification), el('span', { class: 'ws-chip' }, s.stageName), groupStatus(d),
        s.priority && s.priority.band ? el('span', { class: 'ws-chip' }, `Priority ${s.priority.band}${s.priority.rank ? ` #${s.priority.rank}` : ''}`) : null,
        el('span', { class: 'ws-subtle' }, `Submitted ${fmtDate(d.submittedAt)}`))),
    el('nav', { class: 'op-jump', 'aria-label': 'Sections' }, ...SECTIONS.map(([k, l]) => el('a', { href: `#eg-${k}` }, l))),
    d.needsReassessment ? alertBox('warning', 'Needs reassessment', d.needsReassessment) : null,
    sec('problem', problemView(d)), sec('solution', solutionView(d)), sec('requirements', requirementsView(d)), sec('risks', risksView(d)),
    sec('outcomes', outcomesView(d)), sec('plan', planView(d)), sec('decide', decideView(d)), sec('history', historyView(d)),
  ];
}

function problemView(d) {
  const s = d.submission, bc = s.businessCase, ev = s.evidenceSummary || {};
  const fv = s.firmValidated || {};
  return el('div', { class: 'eg-grid' },
    sub('What is happening', el('p', { class: 'ds-body-sm' }, s.problemStatement), s.causes && s.causes.length ? el('div', {}, el('p', { class: 'ds-body-sm' }, el('strong', {}, 'Causes reported')), list(s.causes)) : null,
      s.improvements && s.improvements.length ? el('div', {}, el('p', { class: 'ds-body-sm' }, el('strong', {}, 'Improvements staff suggested')), list(s.improvements)) : null),
    sub('Why it matters', bc ? el('dl', { class: 'ds-meta' },
      el('dt', {}, 'Staff time'), el('dd', {}, `${num(bc.timeRecovered.monthlyHoursSpent)} hours a month; ${num(bc.timeRecovered.monthlyHoursRecovered)} could be recovered (capacity, not cash)`),
      el('dt', {}, 'Cash savings'), el('dd', {}, bc.cashSavings.monthlyGBP === null ? 'None stated by the firm' : `${gbp(bc.cashSavings.monthlyGBP)} a month, firm-stated: ${bc.cashSavings.basis || ''}`),
      el('dt', {}, 'Capacity'), el('dd', {}, bc.capacity.additionalCasesPerMonth === null ? 'Not estimated' : `${num(bc.capacity.additionalCasesPerMonth)} more cases a month`),
      el('dt', {}, 'Revenue'), el('dd', {}, bc.revenue.monthlyPotentialGBP === null ? 'Not estimated' : `${gbp(bc.revenue.monthlyPotentialGBP)} a month (potential)`),
      el('dt', {}, 'Payback'), el('dd', {}, bc.payback.months === null ? bc.payback.reason : `${num(bc.payback.months)} months`)) : el('p', { class: 'ds-muted ds-body-sm' }, 'Not sized.'),
      bc ? el('p', { class: 'ds-cluster ds-body-sm' }, ...Object.values(bc.inputs).filter((i) => i.value !== null).map((i) => el('span', { class: 'ds-cluster' }, source(i.source), el('span', { class: 'ws-subtle' }, i.label)))) : null),
    sub('Evidence', el('p', { class: 'ds-body-sm' }, `${ev.items} evidence items${ev.disputed ? `, ${ev.disputed} disputed and excluded` : ''} from ${s.participantCount || 'several'} people (${(s.roles || []).join(', ') || 'roles not recorded'}).`),
      el('div', { class: 'dw-dims' }, ...Object.entries(ev.confidence || {}).map(([k, v]) => el('div', { class: 'dw-dim' }, el('span', { class: 'ws-subtle' }, CLAIM[k] || k), confidence(v)))),
      ev.disagreements && ev.disagreements.length ? alertBox('warning', 'Accounts differ', ev.disagreements.join('. ')) : null,
      s.voices && s.voices.length ? el('div', { class: 'ds-stack' }, ...s.voices.map((v) => el('blockquote', { class: 'dw-quote' }, `“${v.quote}”`, el('span', { class: 'ws-subtle' }, ` — ${v.role}`)))) : null),
    sub('What the firm validated', el('dl', { class: 'ds-meta' },
      el('dt', {}, 'Finding'), el('dd', {}, fv.finding ? 'Confirmed by the firm lead' : 'Not confirmed'),
      el('dt', {}, 'Decision'), el('dd', {}, `${({ approved: 'Approved', sent_to_engineering: 'Approved and sent' })[fv.decision] || fv.decision || '—'}${fv.decisionReason ? ` — ${fv.decisionReason}` : ''}${fv.decidedAt ? ` (${fmtDate(fv.decidedAt)})` : ''}`),
      el('dt', {}, 'Firm-provided figures'), el('dd', {}, (fv.firmProvidedInputs || []).join(', ') || 'None')),
      s.note ? el('p', { class: 'ds-body-sm' }, el('strong', {}, 'Note from the firm: '), s.note) : null),
    sub('What remains uncertain', list([...(s.outstandingQuestions || []), ...(s.gates || [])], 'Nothing recorded as uncertain.')));
}

function solutionView(d) {
  const s = d.submission, des = d.design;
  return el('div', { class: 'ds-stack' },
    el('div', { class: 'eg-grid' },
      sub('Recommended by builda+', list(s.recommendedOutcome), el('p', { class: 'ds-help' }, `${s.classificationRationale || ''} Classification: ${CLASS[s.classification] ? CLASS[s.classification][1] : 'not recorded'}${s.automationType === 'conventional' ? ' (conventional automation)' : s.automationType === 'ai_assisted' ? ' (AI-assisted)' : ''}.`)),
      sub('Reference templates', el('p', { class: 'ds-body-sm' }, d.templates.reason),
        ...d.templates.matches.map((m) => el('div', { class: 'eg-template' }, el('p', { class: 'ds-cluster' }, el('strong', {}, `${m.template.name} v${m.template.version}`), status(m.readiness.label, m.readiness.productionReady ? 'success' : 'warning')),
          el('p', { class: 'ds-help' }, APPROACH[m.template.approach]), list(m.fit), m.readiness.reasons.length ? el('p', { class: 'ds-help' }, `Why not ready: ${m.readiness.reasons.join('; ')}.`) : null)),
        el('p', {}, el('a', { href: '/jada/engineering/templates' }, 'All solution templates')))),
    des ? sub('Recorded design', el('dl', { class: 'ds-meta' },
      el('dt', {}, 'Approach'), el('dd', {}, APPROACH[des.approach]),
      el('dt', {}, 'Template'), el('dd', {}, des.template ? `${des.template.name} v${des.template.version} — ${des.template.readiness.label}` : 'Custom engineering design'),
      el('dt', {}, 'Why this approach'), el('dd', {}, des.rationale),
      des.approach === 'ai_assisted' ? el('dt', {}, 'Why AI is needed') : null, des.approach === 'ai_assisted' ? el('dd', {}, des.aiJustification) : null,
      el('dt', {}, 'Systems'), el('dd', {}, des.systems.join(', ') || '—'), el('dt', {}, 'Dependencies'), el('dd', {}, des.dependencies.join('; ') || '—')),
      sub('Human approval points', list(des.humanApprovalPoints)))
      : alertBox('info', 'No solution design recorded yet', 'Use “Record the solution design” below. The template and the suggestions are a starting point; nothing is designed until you record it.'));
}

const REQ = [['functional', 'Functional'], ['nonFunctional', 'Non-functional'], ['data', 'Data'], ['integration', 'Integration'], ['access', 'Access and permissions'], ['security', 'Security controls'], ['errorHandling', 'Error handling'], ['logging', 'Logging and audit'], ['acceptance', 'Acceptance criteria']];
function requirementsView(d) {
  const r = d.design ? d.design.requirements : d.suggestions.design.requirements;
  return el('div', { class: 'ds-stack' }, d.design ? null : alertBox('info', 'Suggested starting point, not yet recorded', 'Drawn from the matching template, the builda+ brief and JADA’s standard controls. Edit and record it in the design.'),
    el('div', { class: 'eg-grid' }, ...REQ.map(([k, l]) => sub(l, list(r[k], 'To be defined by engineering.')))));
}
const RISK = [['operational', 'Operational'], ['security', 'Security'], ['regulatory', 'Regulatory'], ['privacy', 'Privacy'], ['technical', 'Technical dependencies']];
function risksView(d) {
  const r = d.design ? d.design.risks : d.suggestions.design.risks;
  const dec = d.design ? d.design.outstandingDecisions : d.suggestions.design.outstandingDecisions;
  return el('div', { class: 'ds-stack' }, d.submission.regulated ? alertBox('warning', 'Regulated-judgement stage', 'Any change may only prepare information for the adviser. AI-assisted approaches are refused here.') : null,
    el('div', { class: 'eg-grid' }, ...RISK.map(([k, l]) => sub(l, list(r[k], 'None recorded.'))), sub('Outstanding decisions', list(dec, 'None: nothing blocks approval.'))));
}
const CLAIM = { existence: 'Problem exists here', volume: 'How often', effort: 'Time each time', impact: 'Operational impact' };
const VT = { time: 'Time recovered', cash: 'Cash savings', capacity: 'Operational capacity', revenue: 'Revenue impact' };
function measuresTable(ms, results) {
  return el('div', { class: 'ds-table-wrap' }, el('table', { class: 'ds-table' }, el('thead', {}, el('tr', {}, ...['Measure', 'Type', 'Baseline', 'Baseline source', 'Target', 'Measured by', 'Period', ...(results ? ['Result', 'Status'] : [])].map((h) => el('th', { scope: 'col' }, h)))),
    el('tbody', {}, ...ms.map((m) => { const r = results && results.rows.find((x) => x.name === m.name); return el('tr', {}, el('th', { scope: 'row' }, m.name), el('td', {}, VT[m.valueType]),
      el('td', {}, m.baseline === null ? 'Not measured' : `${num(m.baseline)} ${m.unit}`), el('td', { class: 'ds-body-sm' }, m.baselineSource),
      el('td', {}, m.target === null ? 'To agree' : `${m.direction === 'decrease' ? '≤' : '≥'} ${num(m.target)} ${m.unit}`), el('td', { class: 'ds-body-sm' }, m.measurementSource), el('td', { class: 'ds-body-sm' }, m.period),
      ...(results ? [el('td', {}, r && r.result !== null ? num(r.result) : '—'), el('td', {}, r ? status(OUTCOME_ROW[r.status][0], OUTCOME_ROW[r.status][1]) : '—')] : [])); }))));
}
const OUTCOME_ROW = { met: ['Met', 'success'], not_met: ['Not met', 'danger'], not_measured: ['Not measured', 'warning'], no_target: ['No target', 'neutral'] };
const OUTCOME = { not_yet_measured: ['Not yet measured', 'warning', 'Completion of the work is not success. Record results against the agreed measures.'], no_agreed_targets: ['No agreed targets', 'warning', 'Success can’t be judged: no measure has an agreed target.'],
  partly_measured: ['Partly measured', 'warning', 'Some agreed measures have no result yet.'], met: ['Agreed outcome met', 'success', 'Every measure with an agreed target met it.'], not_met: ['Agreed outcome not met', 'danger', 'At least one agreed target was missed.'] };
function outcomesView(d) {
  if (d.plan) {
    const [l, v, t] = OUTCOME[d.outcome.overall];
    const noBaseline = d.plan.successMeasures.filter((m) => m.target !== null && m.baseline === null).map((m) => m.name);
    return el('div', { class: 'ds-stack' }, el('p', { class: 'ds-cluster' }, status(l, v), el('span', { class: 'ds-body-sm' }, t)),
      noBaseline.length ? el('p', { class: 'ds-help' }, `No measured baseline for ${noBaseline.join(', ')}: the result shows whether the agreed target was reached, not how much it improved.`) : null,
      measuresTable(d.plan.successMeasures, d.outcomeResults ? d.outcome : null));
  }
  return el('div', { class: 'ds-stack' }, alertBox('info', 'Proposed measures, not yet agreed', 'Built only from the firm’s own baseline. Targets stay empty until agreed with the firm in the implementation plan. builda+ never estimates savings or improvements.'),
    measuresTable(d.suggestions.measures, null));
}
function planView(d) {
  const o = d.twoWeekOffer;
  const offer = alertBox(o.offered ? 'success' : 'info', o.offered ? 'Two-week build can be offered' : 'Two-week build not offered', o.offered ? 'Conditional commercial offer: every condition holds today. It is not a guaranteed delivery time.' : `Conditions not met: ${o.reasons.join('; ')}.`);
  const gate = d.integration ? alertBox(d.integration.gate.status === 'passed' ? 'success' : 'warning', `Live mailbox access: ${d.integration.activated ? 'activated' : 'not activated'}`,
    `${d.integration.gate.description} Status: ${d.integration.gate.status.replace('_', ' ')}. Microsoft-independent work can proceed; ${d.integration.gate.blocks.toLowerCase()}`) : null;
  if (!d.plan) return el('div', { class: 'ds-stack' }, offer, gate, el('p', { class: 'ds-muted ds-body-sm' }, d.status === 'approved_for_implementation' ? 'Record the implementation plan below.' : 'A plan is recorded once the submission is approved for implementation.'));
  const p = d.plan;
  return el('div', { class: 'ds-stack' }, offer, gate, el('p', { class: 'ds-body-sm' }, p.scope),
    el('div', { class: 'eg-grid' }, sub('Deliverables', list(p.deliverables)), sub('Dependencies', list([...p.dependencies, ...p.unresolvedDependencies.map((x) => `Unresolved: ${x}`)])),
      sub('Required access', list(p.requiredAccess), el('p', { class: 'ds-help' }, p.accessConfirmed ? 'Access and test data confirmed.' : 'Access not yet confirmed.')),
      sub('Testing plan', list(p.testingPlan)), sub('Acceptance criteria', list(p.acceptanceCriteria)),
      sub('Responsible parties', list(p.responsibleParties.map((r) => `${r.party}: ${r.responsibility}`))),
      sub('Expected duration', el('p', { class: 'ds-body-sm' }, p.duration ? `${p.duration.text} — ${p.duration.validated ? `validated estimate (${p.duration.basis})` : 'not a validated estimate'}` : 'No validated estimate.'))));
}

/* ============================================================ decisions */
function decideView(d) {
  const A = new Set(d.actions);
  const base = `/api/jada/engineering/${d.id}`;
  const go = (action, body, m) => async () => { setMsg(m, 'Saving…'); try { await api(`${base}/${action}`, 'POST', body ? body() : {}); location.hash = '#eg-decide'; location.reload(); } catch (e) { setMsg(m, e.message, 'error'); } };
  const parts = [];
  const open = d.informationRequests.find((r) => r.answer === null);
  if (open) parts.push(alertBox('warning', 'Waiting for the firm', `Asked ${fmtDateTime(open.at)}: ${open.questions.join(' ')}`));
  if (A.has('start_assessment')) { const m = msgEl(); parts.push(el('div', { class: 'ws-fieldset ds-stack' }, el('p', { class: 'ds-body-sm' }, 'Start assessing this submission. Builda+ has recommended it; whether and how to build it is your decision.'), el('div', { class: 'ds-cluster' }, el('button', { class: 'ds-btn ds-btn--primary', type: 'button', onclick: go('start_assessment', null, m) }, 'Start assessment'), m))); }
  if (A.has('request_information')) { const m = msgEl(); parts.push(el('details', { class: 'op-details' }, el('summary', {}, 'Request more information from the firm'), el('div', { class: 'op-details__body ds-stack' },
    area('eg-q', 'Questions (one per line)', '', 'The firm lead sees and answers these in builda+. Don’t ask for client data.'),
    el('div', { class: 'ds-cluster' }, el('button', { class: 'ds-btn ds-btn--secondary', type: 'button', onclick: go('request_information', () => ({ questions: lines(val('eg-q')) }), m) }, 'Send questions'), m)))); }
  if (A.has('record_design')) parts.push(designForm(d, go));
  if (A.has('two_week_check') && d.submission.classification === 'automate') parts.push(checkForm(d, go));
  if (A.has('approve_for_implementation')) { const m = msgEl(); parts.push(el('div', { class: 'ws-fieldset ds-stack' }, el('h3', { class: 'ds-h4' }, 'Engineering approval'),
    el('p', { class: 'ds-help' }, 'Requires a recorded design with acceptance criteria and no outstanding decisions. You are recorded as the approver.'),
    area('eg-approve-note', 'Note (optional)', '', null, 2),
    el('div', { class: 'ds-cluster' }, el('button', { class: 'ds-btn ds-btn--primary', type: 'button', disabled: !d.design, onclick: go('approve_for_implementation', () => ({ note: val('eg-approve-note') }), m) }, 'Approve for implementation'), m))); }
  if (A.has('record_plan')) parts.push(planForm(d, go));
  for (const [a, label, help] of [['start_implementation', 'Start implementation', d.plan ? 'The plan and its agreed measures go with the work.' : 'Record the plan first.'],
    ['activate_integration', 'Activate live integration', d.integration ? `Refused until ${d.integration.gate.description.split(':')[0]} has passed.` : null], ['complete_implementation', 'Mark implementation complete', 'Completion is not success: the outcome is judged against the agreed measures afterwards.']]) {
    if (A.has(a) && help) { const m = msgEl(); parts.push(el('div', { class: 'ws-fieldset ds-stack' }, el('p', { class: 'ds-help' }, help), el('div', { class: 'ds-cluster' }, el('button', { class: `ds-btn ds-btn--${a === 'activate_integration' ? 'secondary' : 'primary'}`, type: 'button', onclick: go(a, null, m) }, label), m))); }
  }
  if (A.has('record_outcome')) parts.push(outcomeForm(d, go));
  if (A.has('reject') || A.has('defer') || A.has('reopen')) {
    const m = msgEl();
    parts.push(el('details', { class: 'op-details' }, el('summary', {}, A.has('reopen') ? 'Reopen this submission' : 'Reject or defer'), el('div', { class: 'op-details__body ds-stack' },
      area('eg-reason', 'Reason (required, the firm sees it)', '', null, 2),
      el('div', { class: 'ds-cluster' }, ...[['reject', 'Reject'], ['defer', 'Defer'], ['reopen', 'Reopen']].filter(([k]) => A.has(k)).map(([k, l]) => el('button', { class: 'ds-btn ds-btn--secondary', type: 'button', onclick: go(k, () => ({ reason: val('eg-reason') }), m) }, l)), m))));
  }
  if (!parts.length) parts.push(el('p', { class: 'ds-muted ds-body-sm' }, d.status === 'awaiting_information' ? 'Waiting for the firm’s answer.' : 'No further engineering actions.'));
  return el('div', { class: 'ds-stack' }, ...parts);
}

function designForm(d, go) {
  const base = d.design || { ...d.suggestions.design, rationale: '', aiJustification: '' };
  const m = msgEl();
  const tpl = el('select', { class: 'ds-select', id: 'eg-tpl' }, el('option', { value: '' }, 'Custom engineering design (no template)'),
    ...d.templates.matches.map((x) => el('option', { value: x.template.id, selected: base.templateId === x.template.id }, `${x.template.name} v${x.template.version} — ${x.readiness.label}`)));
  const appr = el('select', { class: 'ds-select', id: 'eg-appr' }, ...d.approaches.map((a) => el('option', { value: a.id, selected: base.approach === a.id }, a.label)));
  const body = () => ({
    templateId: tpl.value || null, approach: appr.value, rationale: val('eg-rationale'), aiJustification: val('eg-ai'),
    systems: lines(val('eg-systems')), dependencies: lines(val('eg-deps')), humanApprovalPoints: lines(val('eg-hap')),
    requirements: Object.fromEntries(REQ.map(([k]) => [k, lines(val(`eg-req-${k}`))])), risks: Object.fromEntries(RISK.map(([k]) => [k, lines(val(`eg-risk-${k}`))])),
    outstandingDecisions: lines(val('eg-decisions')),
  });
  return el('details', { class: 'op-details', open: !d.design }, el('summary', {}, d.design ? 'Revise the solution design' : 'Record the solution design'), el('div', { class: 'op-details__body ds-stack' },
    el('p', { class: 'ds-help' }, 'Pre-filled from the matching template, the builda+ brief and JADA standard controls. One item per line. Choose conventional automation unless it genuinely can’t do the job.'),
    el('div', { class: 'ds-form-grid' }, el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: 'eg-tpl' }, 'Reference template'), tpl),
      el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: 'eg-appr' }, 'Approach'), appr)),
    area('eg-rationale', 'Why this approach is appropriate', base.rationale, null, 2),
    area('eg-ai', 'If AI-assisted: why conventional automation isn’t sufficient', base.aiJustification, 'Required for an AI-assisted approach; refused at regulated-judgement stages.', 2),
    el('div', { class: 'ds-form-grid' }, area('eg-systems', 'Existing systems involved', base.systems), area('eg-deps', 'Dependencies', base.dependencies)),
    area('eg-hap', 'Human approval points', base.humanApprovalPoints),
    el('h4', { class: 'ds-h4' }, 'Engineering requirements'), el('div', { class: 'ds-form-grid' }, ...REQ.map(([k, l]) => area(`eg-req-${k}`, l, base.requirements[k]))),
    el('h4', { class: 'ds-h4' }, 'Risks and constraints'), el('div', { class: 'ds-form-grid' }, ...RISK.map(([k, l]) => area(`eg-risk-${k}`, l, base.risks[k]))),
    area('eg-decisions', 'Outstanding decisions (approval is blocked while any remain)', base.outstandingDecisions, 'Decisions that must be made before building. Open questions from discovery are listed under “What remains uncertain”.'),
    el('div', { class: 'ds-cluster' }, el('button', { class: 'ds-btn ds-btn--primary', type: 'button', onclick: go('record_design', body, m) }, 'Record design'), m)));
}

function checkForm(d, go) {
  const m = msgEl();
  const C = [['singleWorkflowWithStartAndFinish', 'One defined workflow with a start and finish'], ['changesCoreSystems', 'Requires changes to the firm’s core systems'], ['accessAndTestDataReadyDayOne', 'Access and test data ready on day one'],
    ['humanApprovalForCommsAndRecordChanges', 'Human approval for communications and record changes'], ['complianceQuestionsResolved', 'Compliance questions resolved']];
  return el('details', { class: 'op-details' }, el('summary', {}, 'Two-week offer checklist'), el('div', { class: 'op-details__body ds-stack' },
    el('p', { class: 'ds-help' }, 'The two-week build is a conditional offer. It also needs a tested template and a plan with confirmed access and no unresolved dependencies.'),
    el('fieldset', { class: 'ws-checks' }, el('legend', {}, 'Checks'), ...C.map(([k, l]) => el('label', { class: 'ds-check' }, el('input', { type: 'checkbox', id: `eg-c-${k}` }), l))),
    area('eg-unres', 'Unresolved dependencies (one per line)', '', null, 2),
    el('div', { class: 'ds-cluster' }, el('button', { class: 'ds-btn ds-btn--secondary', type: 'button', onclick: go('two_week_check', () => ({ checks: Object.fromEntries(C.map(([k]) => [k, document.getElementById(`eg-c-${k}`).checked])), unresolvedDependencies: lines(val('eg-unres')) }), m) }, 'Record checklist'), m)));
}

function measureRow(mm, i) {
  const f = (k, label, value, type = 'text') => el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: `eg-m${i}-${k}` }, label), el('input', { class: 'ds-input', id: `eg-m${i}-${k}`, type, step: type === 'number' ? 'any' : null, value: value === null || value === undefined ? '' : String(value) }));
  return el('fieldset', { class: 'ws-fieldset eg-measure', 'data-i': String(i) }, el('legend', {}, `Measure ${i + 1}`),
    el('div', { class: 'ds-form-grid' }, f('name', 'Measure', mm.name),
      el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: `eg-m${i}-valueType` }, 'Type of value'), el('select', { class: 'ds-select', id: `eg-m${i}-valueType` }, ...Object.entries(VT).map(([k, l]) => el('option', { value: k, selected: mm.valueType === k }, l)))),
      f('unit', 'Unit', mm.unit), f('baseline', 'Baseline', mm.baseline, 'number'), f('baselineSource', 'Baseline source', mm.baselineSource), f('target', 'Agreed target (blank if not agreed)', mm.target, 'number'),
      el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: `eg-m${i}-direction` }, 'Better is'), el('select', { class: 'ds-select', id: `eg-m${i}-direction` }, el('option', { value: 'decrease', selected: mm.direction === 'decrease' }, 'Lower'), el('option', { value: 'increase', selected: mm.direction === 'increase' }, 'Higher'))),
      f('measurementSource', 'Measured by', mm.measurementSource), f('period', 'Measurement period', mm.period)));
}
function planForm(d, go) {
  const m = msgEl();
  const p = d.plan;
  const ms = p ? p.successMeasures : d.suggestions.measures;
  const holder = el('div', { class: 'ds-stack' }, ...ms.map(measureRow));
  const n = (x) => (x.trim() === '' ? null : Number(x));
  const body = () => ({
    scope: val('eg-scope'), deliverables: lines(val('eg-deliv')), dependencies: lines(val('eg-pdeps')), unresolvedDependencies: lines(val('eg-unresolved')),
    requiredAccess: lines(val('eg-access')), accessConfirmed: document.getElementById('eg-access-ok').checked, testingPlan: lines(val('eg-tests')), acceptanceCriteria: lines(val('eg-accept')),
    responsibleParties: lines(val('eg-parties')).map((l) => { const [party, ...r] = l.split(':'); return { party: party.trim(), responsibility: r.join(':').trim() }; }),
    duration: val('eg-dur').trim() ? { text: val('eg-dur'), validated: document.getElementById('eg-dur-ok').checked, basis: val('eg-dur-basis') } : null,
    successMeasures: [...holder.querySelectorAll('.eg-measure')].map((fs) => { const i = fs.dataset.i; const g = (k) => val(`eg-m${i}-${k}`);
      return { name: g('name'), valueType: g('valueType'), unit: g('unit'), baseline: n(g('baseline')), baselineSource: g('baselineSource'), target: n(g('target')), direction: g('direction'), measurementSource: g('measurementSource'), period: g('period') }; })
      .filter((x) => x.name.trim()),
  });
  const des = d.design || {};
  return el('details', { class: 'op-details', open: !p }, el('summary', {}, p ? 'Revise the implementation plan' : 'Record the implementation plan'), el('div', { class: 'op-details__body ds-stack' },
    area('eg-scope', 'Implementation scope', p ? p.scope : '', null, 2),
    el('div', { class: 'ds-form-grid' }, area('eg-deliv', 'Deliverables', p ? p.deliverables : []), area('eg-pdeps', 'Dependencies', p ? p.dependencies : des.dependencies || []),
      area('eg-unresolved', 'Unresolved dependencies', p ? p.unresolvedDependencies : []), area('eg-access', 'Required access', p ? p.requiredAccess : (des.requirements || {}).access || []),
      area('eg-tests', 'Testing plan', p ? p.testingPlan : []), area('eg-accept', 'Acceptance criteria', p ? p.acceptanceCriteria : (des.requirements || {}).acceptance || [])),
    el('label', { class: 'ds-check' }, el('input', { type: 'checkbox', id: 'eg-access-ok', checked: p ? p.accessConfirmed : false }), 'Access and test data confirmed with the firm'),
    area('eg-parties', 'Responsible parties (one per line, “Party: responsibility”)', p ? p.responsibleParties.map((r) => `${r.party}: ${r.responsibility}`) : ['JADA engineer: build and test', 'Firm lead: approve templates and confirm access']),
    el('div', { class: 'ds-form-grid' }, el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: 'eg-dur' }, 'Expected duration (blank if no estimate)'), el('input', { class: 'ds-input', id: 'eg-dur', value: p && p.duration ? p.duration.text : '' })),
      el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: 'eg-dur-basis' }, 'Basis for a validated estimate'), el('input', { class: 'ds-input', id: 'eg-dur-basis', value: p && p.duration ? p.duration.basis : '' }))),
    el('label', { class: 'ds-check' }, el('input', { type: 'checkbox', id: 'eg-dur-ok', checked: p && p.duration ? p.duration.validated : false }), 'This is a validated estimate (from delivered work, not a guess)'),
    el('h4', { class: 'ds-h4' }, 'Agreed success measures'), el('p', { class: 'ds-help' }, 'Proposed from the firm’s baseline. Agree targets with the firm; leave a target blank if it isn’t agreed. Time, cash, capacity and revenue stay separate.'),
    holder, el('button', { class: 'ds-btn ds-btn--ghost', type: 'button', onclick: () => holder.append(measureRow({ name: '', valueType: 'time', unit: '', baseline: null, baselineSource: '', target: null, direction: 'decrease', measurementSource: '', period: '' }, holder.children.length)) }, 'Add a measure'),
    el('div', { class: 'ds-cluster' }, el('button', { class: 'ds-btn ds-btn--primary', type: 'button', onclick: go('record_plan', body, m) }, 'Record plan'), m)));
}
function outcomeForm(d, go) {
  const m = msgEl();
  const ms = d.plan.successMeasures;
  // Only measures with a result are sent; an unmeasured measure stays "not measured" rather than failing the save.
  const body = () => {
    const results = ms.map((x, i) => ({ measure: x.name, value: val(`eg-o${i}-v`).trim() === '' ? null : Number(val(`eg-o${i}-v`)), measuredAt: val(`eg-o${i}-at`), source: val(`eg-o${i}-src`) })).filter((r) => r.value !== null);
    if (!results.length) throw new ApiError('Enter at least one measured result.', 400);
    const undated = results.find((r) => !r.measuredAt);
    if (undated) throw new ApiError(`Add the date “${undated.measure}” was measured.`, 400);
    return { results };
  };
  return el('div', { class: 'ws-fieldset ds-stack' }, el('h3', { class: 'ds-h4' }, 'Record the measured outcome'),
    el('p', { class: 'ds-help' }, 'Only results for the agreed measures, from the agreed source and period. Success is judged against the agreed targets.'),
    ...ms.map((x, i) => el('div', { class: 'ds-form-grid' }, el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: `eg-o${i}-v` }, `${x.name} (${x.unit})`), el('input', { class: 'ds-input', id: `eg-o${i}-v`, type: 'number', step: 'any' })),
      el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: `eg-o${i}-at` }, 'Measured on'), el('input', { class: 'ds-input', id: `eg-o${i}-at`, type: 'date' })),
      el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: `eg-o${i}-src` }, 'Source'), el('input', { class: 'ds-input', id: `eg-o${i}-src`, value: x.measurementSource })))),
    el('div', { class: 'ds-cluster' }, el('button', { class: 'ds-btn ds-btn--primary', type: 'button', onclick: go('record_outcome', body, m) }, 'Record outcome'), m));
}
function historyView(d) {
  return d.history.length ? el('ul', { class: 'ws-list dw-history' }, ...d.history.map((h) => el('li', { class: 'dw-history__item' },
    el('span', {}, el('strong', {}, h.label), ` — ${h.by}`, h.note ? el('span', { class: 'ws-subtle' }, ` · ${h.note}`) : null, h.detail && h.detail.length ? el('span', { class: 'ws-subtle' }, ` · ${h.detail.join('; ')}`) : null),
    el('time', { datetime: h.at }, fmtDateTime(h.at))))) : el('p', { class: 'ds-muted ds-body-sm' }, `Submitted by the firm on ${fmtDateTime(d.submittedAt)}. No engineering decisions yet.`);
}

/* ============================================================ router */
(async () => {
  const path = location.pathname.replace(/\/+$/, '');
  const m = path.match(/^\/jada\/engineering\/([0-9a-f-]{36})$/);
  try {
    const nodes = path === '/jada/engineering/templates' ? await templatesPage() : m ? await detailPage(m[1]) : await queuePage();
    document.title = `${document.querySelector('.ds-breadcrumb [aria-current]')?.textContent || 'Engineering'} — JADA — builda+`;
    $main.replaceChildren(...nodes.filter(Boolean));
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  } catch (err) {
    if (err.status === 401) return;
    shell('queue', [{ label: 'Engineering' }]);
    $main.replaceChildren(err.status === 404 ? empty('Not found', 'This submission doesn’t exist or isn’t assigned to you.', el('a', { class: 'ds-btn ds-btn--secondary', href: '/jada/engineering' }, 'Engineering queue'))
      : err.status === 403 ? empty('For JADA engineers', 'Your account doesn’t have access to the engineering workspace.') : alertBox('danger', 'Something went wrong', err.message));
  }
})();
