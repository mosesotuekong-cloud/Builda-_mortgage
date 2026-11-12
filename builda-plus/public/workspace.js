'use strict';
// BuildA+ firm workspace (Phase 2). One shell page; the path selects the section. Everything shown comes
// from the existing firm-lead API, which is scoped to the signed-in firm by the database (RLS).

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
  overview: ['M3 3h7v9H3z', 'M14 3h7v5h-7z', 'M14 12h7v9h-7z', 'M3 16h7v5H3z'],
  profile: ['M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16', 'M16 9h2a2 2 0 0 1 2 2v10', 'M8 7h4', 'M8 11h4', 'M8 15h4', 'M2 21h20'],
  discovery: ['M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14z', 'M21 21l-5-5'],
  evidence: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M9 14l2 2 4-4'],
  opportunities: ['M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z', 'M12 7a5 5 0 1 0 0 10a5 5 0 0 0 0-10z', 'M12 11a1 1 0 1 0 0 2a1 1 0 0 0 0-2z'],
  implementation: ['M12 3l9 5-9 5-9-5z', 'M3 13l9 5 9-5', 'M3 17.5l9 5 9-5'],
  impact: ['M4 20V11', 'M10 20V5', 'M16 20v-6', 'M2 20h20'],
  organisation: ['M4 7h10', 'M18 7h2', 'M16 5v4', 'M4 17h4', 'M12 17h8', 'M10 15v4'],
  account: ['M12 12a4 4 0 1 0 0-8a4 4 0 0 0 0 8z', 'M4 21a8 8 0 0 1 16 0'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  chevron: ['M6 9l6 6 6-6'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
};
function icon(name) {
  const s = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.75', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) s.setAttribute(k, v);
  for (const d of ICONS[name] || []) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
}

class ApiError extends Error { constructor(msg, status, issues) { super(msg); this.status = status; this.issues = issues || []; } }
async function api(path, method = 'GET', body) {
  const res = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { location.href = '/signin'; throw new ApiError('Please sign in.', 401); }
  if (!res.ok) throw new ApiError(data.error || 'Something went wrong. Please try again.', res.status, data.issues);
  return data;
}

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;
const sum = (xs, f) => xs.reduce((n, x) => n + (f(x) || 0), 0);

/* ============================================================ vocabulary (matches the existing API) */
const ROLES = { firm_lead: 'Firm owner / MD', adviser: 'Mortgage adviser', case_manager: 'Case manager', administrator: 'Administrator', other: 'Other operational staff' };
// One status for a discovery wherever it's shown. With the later stages off, a discovery is complete once
// its report exists and at least one opportunity is approved (approvals are made one at a time).
function discoveryStatus(s) {
  if (!FEATURES.laterStages && s.status === 'review_ready' && s.reportedAt && s.approved) return ['Discovery complete', 'success'];
  return DISCOVERY_STATUS[s.status] || [s.status, 'neutral'];
}
const DISCOVERY_STATUS = {
  profile: ['Firm profile needed', 'warning'], interviews: ['Interviews', 'info'], review_ready: ['Ready for opportunity review', 'info'], priorities_approved: ['Priorities approved', 'success'],
};
const PERSON_STATUS = {
  invited: ['Not opened yet', 'neutral'], opened: ['Opened the link', 'info'], consented: ['Agreed, not started', 'info'],
  in_progress: ['In progress', 'info'], paused: ['Paused', 'warning'], completed: ['Finished', 'success'], escalated: ['Paused — JADA following up', 'warning'],
};
const CONFIDENCE = { insufficient: ['insufficient', 'Insufficient evidence'], low: ['low', 'Low'], medium: ['medium', 'Medium'], high: ['high', 'High'], very_high: ['very-high', 'Very high'] };
const CLASSIFICATION = { overhaul: ['overhaul', 'Overhaul'], fix: ['fix', 'Fix'], automate: ['automate', 'Automate'], keep_human: ['keep-human', 'Keep human'] };
const PACK_STATUS = { in_review: ['Awaiting JADA engineering review', 'info'], needs_changes: ['Under assessment by JADA', 'info'], confirmed: ['Under assessment by JADA', 'info'],
  under_assessment: ['Under assessment by JADA', 'info'], awaiting_information: ['JADA needs information from you', 'warning'], approved_for_implementation: ['Approved for implementation', 'success'],
  in_progress: ['Implementation in progress', 'info'], completed: ['Implementation completed', 'success'], rejected: ['Not taken forward by JADA', 'neutral'], deferred: ['Deferred by JADA', 'neutral'] };
const TECH_CATEGORIES = [
  ['crm_mortgage', 'CRM and mortgage platforms'], ['email_communication', 'Email and communication'], ['document_management', 'Document management'],
  ['productivity', 'Productivity'], ['accounting_finance', 'Accounting and finance'], ['other', 'Other operational applications'],
];
const TECH_TEAMS = [['advisers', 'Advisers'], ['case_managers', 'Case managers'], ['administrators', 'Administrators'], ['management', 'Management'], ['other', 'Other staff']];
const BUSINESS_FOCUS = [
  ['residential_purchase', 'Residential purchase'], ['remortgage_product_transfer', 'Remortgage and product transfers'], ['buy_to_let', 'Buy-to-let'],
  ['later_life', 'Later life lending'], ['protection', 'Protection'], ['commercial_specialist', 'Commercial and specialist'],
];
const OPERATING_MODELS = [
  ['advisers_with_case_managers', 'Advisers supported by dedicated case managers'], ['advisers_own_cases', 'Advisers manage their own cases'],
  ['central_processing', 'Central processing or administration team'], ['mixed', 'A mix of these'],
];
const AUTHORISATION = [['directly_authorised', 'Directly authorised'], ['network_appointed_representative', 'Appointed representative of a network'], ['unsure', 'Not sure']];
const ACTIVITY = {
  'firm.created': 'Workspace created', 'discovery.created': 'Discovery started', 'discovery.profile_saved': 'Firm profile updated',
  'participant.invited': 'Participant invited', 'participant.link_replaced': 'Interview link replaced', 'participant.consented': 'A participant agreed to take part',
  'interview.started': 'An interview started', 'interview.completed': 'An interview finished', 'interview.paused': 'An interview was paused',
  'interview.escalated': 'An interview was handed to JADA', 'analysis.run': 'Interviews analysed', 'follow_ups.sent': 'Follow-up questions sent',
  'pain_point.corrected': 'A finding was corrected', 'report.created': 'Discovery report created', 'priorities.approved': 'Priorities approved',
  'pack.confirmed': 'JADA confirmed an implementation pack', 'pack.needs_changes': 'JADA requested changes to an implementation pack',
  'escalation.created': 'Help requested from JADA', 'escalation.resolved': 'JADA resolved a request', 'jada.picked_up': 'A JADA engineer was assigned',
};
const ACTOR = { user: 'You', participant: 'Participant', system: 'BuildA+', jada: 'JADA' };

const status = (label, variant) => el('span', { class: `ds-status ds-status--${variant}` }, label);
const confidence = (level) => {
  const [lvl, label] = CONFIDENCE[level] || CONFIDENCE.insufficient;
  return el('span', { class: 'ds-confidence', 'data-level': lvl }, el('span', { class: 'ds-confidence__bars', 'aria-hidden': 'true' }, el('i'), el('i'), el('i'), el('i')), label);
};
const classification = (c) => (c && CLASSIFICATION[c] ? el('span', { class: `ds-class ds-class--${CLASSIFICATION[c][0]}` }, CLASSIFICATION[c][1]) : el('span', { class: 'ws-subtle' }, 'Not yet classified'));
const empty = (title, text, action, iconName = 'discovery') => el('div', { class: 'ds-empty' }, el('div', { class: 'ds-empty__icon', 'aria-hidden': 'true' }, icon(iconName)), el('p', { class: 'ds-empty__title' }, title), el('p', { class: 'ds-empty__text' }, text), action || null);
const alertBox = (kind, title, text) => el('div', { class: `ds-alert ds-alert--${kind}`, role: kind === 'danger' ? 'alert' : null }, title && el('p', { class: 'ds-alert__title' }, title), el('p', {}, text));
const pageHeader = (title, description, ...actions) => el('div', { class: 'ds-page-header' },
  el('div', { class: 'ds-page-header__text' }, el('h1', { class: 'ds-page-header__title' }, title), description && el('p', { class: 'ds-page-header__description' }, description)),
  actions.filter(Boolean).length ? el('div', { class: 'ds-btn-group' }, ...actions) : null);
const linkBtn = (href, text, kind = 'secondary', extra = {}) => el('a', { class: `ds-btn ds-btn--${kind}`, href, ...extra }, text);
const findingsUrl = (id, findingId) => `/app/discovery/${id}/findings${findingId ? `/${findingId}` : ''}`;
const section = (title, aside, ...nodes) => el('section', { class: 'ws-section' }, el('div', { class: 'ws-section__head' }, el('h2', { class: 'ds-h3 ws-section__title' }, title), aside || null), ...nodes);

/* ============================================================ shell */
// Set from /api/firm/workspace. Later stages (implementation, impact, engineering) are parked unless switched on.
const FEATURES = window.BUILDA_FEATURES = { laterStages: false };
const LATER_STAGE_KEYS = ['implementation', 'impact'];
const NAV = [
  ['Workspace', [['overview', 'Overview', '/app'], ['profile', 'Firm profile', '/app/profile']]],
  ['Operational intelligence', [['discovery', 'Discovery', '/app/discovery'], ['opportunities', 'Opportunities', '/app/opportunities']]],
  ['Transformation', [['implementation', 'Implementation', '/app/implementation'], ['impact', 'Impact', '/app/impact']]],
  ['Settings', [['organisation', 'Organisation settings', '/app/settings/organisation'], ['account', 'Account settings', '/app/settings/account']]],
];

function renderSidebar(active) {
  $sidebar.replaceChildren(
    el('a', { class: 'ws-brand', href: '/app' }, el('span', { class: 'ws-brand__mark', 'aria-hidden': 'true' }), el('span', {}, 'BuildA', el('span', { class: 'ws-brand__plus' }, '+'))),
    el('nav', { class: 'ws-nav', 'aria-label': 'Workspace' }, ...NAV.map(([heading, items]) => [heading, items.filter(([key]) => FEATURES.laterStages || !LATER_STAGE_KEYS.includes(key))])
      .filter(([, items]) => items.length).map(([heading, items], i) => el('div', { class: 'ws-nav__group' },
      el('p', { class: 'ws-nav__heading', id: `ws-nav-${i}` }, heading),
      el('ul', { 'aria-labelledby': `ws-nav-${i}` }, ...items.map(([key, label, href]) => el('li', {},
        el('a', { class: 'ws-nav__link', href, 'aria-current': key === active ? 'page' : null }, icon(key), label))))))),
    el('p', { class: 'ws-sidebar__foot' }, 'Implementation delivered with JADA.'));
}

function setDrawer(open) {
  $sidebar.classList.toggle('is-open', open);
  $scrim.hidden = !open;
  const btn = document.querySelector('.ws-menu-btn');
  if (btn) btn.setAttribute('aria-expanded', String(open));
  if (open) $sidebar.querySelector('a')?.focus();
}

function renderTopbar(firmName, crumbs) {
  const menu = el('div', { class: 'ws-account__menu', id: 'ws-account-menu', hidden: true },
    el('div', { class: 'ws-account__who' }, el('strong', {}, 'Firm lead'), el('span', { class: 'ws-subtle' }, firmName || '')),
    el('a', { href: '/app/settings/account' }, 'Account settings'),
    el('a', { href: '/app/settings/organisation' }, 'Organisation settings'),
    el('a', { href: '/signout' }, 'Sign out'));
  const accountBtn = el('button', { class: 'ds-btn ds-btn--ghost ws-account__btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'ws-account-menu', 'aria-haspopup': 'true' },
    el('span', { class: 'ws-avatar', 'aria-hidden': 'true' }, (firmName || 'F').trim().charAt(0).toUpperCase()),
    el('span', { class: 'ws-account__name' }, 'Account'), icon('chevron'));
  const setMenu = (open) => { menu.hidden = !open; accountBtn.setAttribute('aria-expanded', String(open)); };
  accountBtn.addEventListener('click', (e) => { e.stopPropagation(); setMenu(menu.hidden); if (!menu.hidden) menu.querySelector('a').focus(); });
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) setMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { setMenu(false); accountBtn.focus(); } });

  // Filtered: replaceChildren() would print a missing breadcrumb (null) as the text "null" while the page loads.
  $topbar.replaceChildren(...[
    el('button', { class: 'ds-btn ds-btn--ghost ws-menu-btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'ws-sidebar', onclick: () => setDrawer(!$sidebar.classList.contains('is-open')) }, icon('menu'), el('span', { class: 'ds-visually-hidden' }, 'Open navigation')),
    el('div', { class: 'ws-topbar__firm' }, el('span', {}, firmName || 'BuildA+')),
    crumbs && crumbs.length ? el('nav', { 'aria-label': 'Breadcrumb' }, el('ol', { class: 'ds-breadcrumb' }, ...crumbs.map((c, i) =>
      el('li', {}, c.href && i < crumbs.length - 1 ? el('a', { href: c.href }, c.label) : el('span', { 'aria-current': i === crumbs.length - 1 ? 'page' : null }, c.label))))) : null,
    el('div', { class: 'ws-account' }, accountBtn, menu)].filter(Boolean));
}

$scrim.addEventListener('click', () => setDrawer(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $sidebar.classList.contains('is-open')) { setDrawer(false); document.querySelector('.ws-menu-btn')?.focus(); } });

/* ============================================================ derived state (from real data only) */
const latestDiscovery = (ws) => ws.discoveries[0] || null;
const profileOf = (ws) => (ws.profile && ws.profile.value) || null;
const countRole = (p, role) => (p?.staffRoles || []).find((r) => r.role === role)?.count;
function profileCompleteness(p) {
  if (!p) return { provided: 0, total: 12 };
  const checks = [
    !!p.website, !!p.location, p.advisers !== undefined, countRole(p, 'case_manager') !== undefined, countRole(p, 'administrator') !== undefined,
    p.monthlyApplications !== null && p.monthlyApplications !== undefined, p.typicalWeeksEnquiryToOffer !== null && p.typicalWeeksEnquiryToOffer !== undefined,
    (p.businessFocus || []).length > 0, !!p.operatingModel, p.authorisation && p.authorisation !== 'unsure', !!(p.businessStructure || '').trim(), !!(p.operationalChallenges || '').trim(),
  ];
  return { provided: checks.filter(Boolean).length, total: checks.length };
}
const techCount = (p) => (p?.technology || []).length;

function nextAction(ws, d = latestDiscovery(ws)) {
  const p = profileOf(ws);
  if (!d) return { title: 'Start your first discovery', text: 'A discovery maps how work moves through your firm. It begins with a short firm profile, then independent interviews with the people who do the work.', start: true, label: 'Start a discovery' };
  if (!p) return { title: 'Complete your firm profile', text: 'A few details about your firm give the interviews the right context. Fill in the form, or answer a few questions in a chat: about five minutes.', href: '/app/profile/chat', label: 'Set up by chat' };
  if (!techCount(p)) return { title: 'Add your technology inventory', text: 'Record the systems your firm already uses, so recommendations build on what you have before suggesting anything new.', href: '/app/profile/technology', label: 'Add technology' };
  if (!d.people) return { title: 'Invite operational participants', text: 'Include two or three senior advisers and at least one case manager or administrator. Your own view is compared with your team’s.', href: `/app/discovery/${d.id}/interviews`, label: 'Invite participants' };
  if (d.completed < d.people && d.completed < 2) return { title: 'Follow up on interviews', text: `${d.completed} of ${d.people} interviews finished. Findings become more reliable as more roles take part.`, href: `/app/discovery/${d.id}`, label: 'View participants' };
  if (d.completed > 0 && !d.analysedAt) return { title: 'Analyse the interviews', text: 'Compare accounts across roles to identify findings, disagreements and missing measurements.', href: `/app/discovery/${d.id}`, label: 'Open discovery' };
  if (d.status === 'interviews') return { title: 'Look through the findings', text: 'What the interviews found, with what people said behind each one. Correct anything that’s wrong, then move on to your priorities.', href: `/app/discovery/${d.id}/findings`, label: 'See the findings' };
  if (!d.reportedAt) return { title: 'Create the discovery report', text: 'The report records the findings, evidence and baseline figures as they stand today.', href: `/app/opportunities?d=${d.id}`, label: 'Go to opportunities' };
  if (!FEATURES.laterStages) {
    // Approvals are made one at a time on each opportunity; the discovery is complete once at least one is approved.
    if (!d.approved) return { title: 'Approve your priorities', text: 'Open each opportunity and approve the ones that matter most to your firm, or challenge or reject them with a reason.', href: `/app/opportunities?d=${d.id}`, label: 'Review opportunities' };
    return { title: 'Discovery complete', text: `${plural(d.approved, 'opportunity', 'opportunities')} approved. Download the discovery report to share with your partners and team.`, href: `/app/opportunities?d=${d.id}#report`, label: 'Go to the report' };
  }
  if (d.status !== 'priorities_approved') return { title: 'Approve your priorities', text: 'Choose which opportunities to take forward. An implementation pack is prepared for JADA’s engineering review.', href: `/app/opportunities?d=${d.id}`, label: 'Approve priorities' };
  return { title: 'Follow implementation progress', text: 'Your approved priorities are with JADA for engineering review.', href: '/app/implementation', label: 'View implementation' };
}

// "Next" prompt for a page whose own step is done: the same step the Overview recommends, unless that
// step is this page itself (then there's nothing new to point to).
function nextStepPrompt(ws, here) {
  const n = nextAction(ws);
  if (n.start || !n.href || n.href === here) return null;
  return el('div', { class: 'ws-nextstep', role: 'status' },
    el('span', { class: 'ws-nextstep__text' }, el('span', { class: 'ws-subtle' }, 'Next: '), el('strong', {}, n.title)),
    linkBtn(n.href, `${n.label} →`, 'primary', { class: 'ds-btn ds-btn--primary ds-btn--sm' }));
}

async function startDiscovery(ws, msgEl) {
  try {
    msgEl.textContent = 'Starting…';
    const { discoveryId } = await api('/api/firm/discoveries', 'POST');
    // Carry the current firm profile (and technology inventory) into the new discovery.
    const p = profileOf(ws);
    if (p) await api(`/api/firm/discoveries/${discoveryId}/profile`, 'PUT', p);
    location.href = `/app/discovery/${discoveryId}`;
  } catch (err) { msgEl.textContent = err.message; msgEl.dataset.kind = 'error'; }
}
const startButton = (ws, label = 'Start a discovery', kind = 'primary') => {
  const msg = el('span', { class: 'ws-inline-msg', role: 'status' });
  return el('span', { class: 'ds-cluster' }, el('button', { class: `ds-btn ds-btn--${kind}`, type: 'button', onclick: () => startDiscovery(ws, msg) }, label), msg);
};

/* ============================================================ overview */
function overview(ws) {
  const d = latestDiscovery(ws); const p = profileOf(ws);
  const next = nextAction(ws);
  const lastUpdated = ws.discoveries.reduce((m, x) => (!m || new Date(x.updatedAt) > new Date(m) ? x.updatedAt : m), null);
  const nodes = [pageHeader('Overview', `${ws.firmName}${lastUpdated ? ` · last updated ${fmtDateTime(lastUpdated)}` : ''}`)];

  nodes.push(el('div', { class: 'ws-next' },
    el('div', { class: 'ws-next__text' }, el('p', { class: 'ds-eyebrow' }, 'Recommended next action'), el('h2', { class: 'ws-next__title' }, next.title), el('p', { class: 'ds-muted ds-body-sm' }, next.text)),
    next.start ? startButton(ws, next.label) : linkBtn(next.href, next.label, 'primary')));

  if (!d) {
    nodes.push(section('Your workspace', null, empty('No discoveries yet', 'Once a discovery starts, this overview shows its progress, the evidence collected and the opportunities identified.')));
    return { crumbs: [{ label: 'Overview' }], nodes };
  }

  const comp = profileCompleteness(p);
  const [dLabel, dVariant] = discoveryStatus(d);
  const steps = [
    { title: 'Firm profile', state: p ? (comp.provided === comp.total ? 'done' : 'active') : 'todo', detail: p ? `${comp.provided} of ${comp.total} details provided` : 'Not started', href: '/app/profile' },
    { title: 'Technology inventory', state: techCount(p) ? 'done' : 'todo', detail: techCount(p) ? plural(techCount(p), 'system') + ' recorded' : (p?.systems?.length ? `${plural(p.systems.length, 'system')} listed in your profile, not yet in the inventory` : 'Not started'), href: '/app/profile/technology' },
    { title: 'Operational discovery', state: !d.people ? 'todo' : d.completed >= d.people ? 'done' : 'active', detail: d.people ? `${d.completed} of ${d.people} interviews finished${d.inProgress ? `, ${d.inProgress} in progress` : ''}` : 'No participants invited yet', href: `/app/discovery/${d.id}` },
    { title: 'Findings', state: !d.analysedAt ? 'todo' : d.status === 'interviews' ? 'active' : 'done', detail: !d.analysedAt ? 'Interviews not analysed yet' : plural(d.painPoints, 'finding'), href: `/app/discovery/${d.id}/findings` },
    { title: 'Opportunity assessment', state: d.reportedAt ? 'done' : d.ranked ? 'active' : 'todo', detail: d.ranked ? `${plural(d.ranked, 'opportunity', 'opportunities')} ranked${d.reportedAt ? ` · report created ${fmtDate(d.reportedAt)}` : ''}` : 'No opportunities ranked yet', href: '/app/opportunities' },
  ];
  const stateLabel = { done: 'Complete', active: 'In progress', todo: 'Not started' };
  const stateVariant = { done: 'success', active: 'info', todo: 'neutral' };

  nodes.push(el('div', { class: 'ws-grid-2' },
    section('Current discovery', el('span', { class: 'ds-cluster' }, status(dLabel, dVariant), el('span', { class: 'ws-subtle' }, `Started ${fmtDate(d.createdAt)}`)),
      el('ol', { class: 'ws-steps' }, ...steps.map((s, i) => el('li', { class: 'ws-step', 'data-state': s.state },
        el('span', { class: 'ws-step__icon', 'aria-hidden': 'true' }, s.state === 'done' ? '✓' : String(i + 1)),
        el('div', {}, el('a', { class: 'ws-step__title', href: s.href }, s.title), el('p', { class: 'ws-step__detail' }, s.detail)),
        status(stateLabel[s.state], stateVariant[s.state]))))),
    section('Needs your attention', null, attentionList(ws))));

  // The business picture comes before the progress: what the latest analysed discovery found and what it costs.
  const analysed = ws.discoveries.find((x) => x.analysedAt);
  if (analysed) nodes.splice(2, 0, businessSnapshot(analysed.id, analysed === d ? 'What discovery found' : `What your discovery of ${fmtDate(analysed.createdAt)} found`));

  const all = ws.discoveries;
  nodes.push(section('Key indicators', el('span', { class: 'ws-subtle' }, 'Across all discoveries'),
    el('dl', { class: 'ws-stats' },
      ...[[all.length, 'Discoveries'], [sum(all, (x) => x.evidence), 'Evidence items'], [sum(all, (x) => x.ranked), 'Opportunities identified'],
        [sum(all, (x) => x.painPoints), 'Findings'], FEATURES.laterStages ? [sum(all, (x) => x.packs), 'Implementation packs'] : null]
        .filter(Boolean).map(([v, l]) => el('div', { class: 'ws-stat' }, el('dt', { class: 'ws-stat__label' }, l), el('dd', { class: 'ws-stat__value' }, String(v)))))));

  // Consecutive repeats of the same action (e.g. several profile saves) are shown once, with a count.
  const items = ws.activity.filter((a) => ACTIVITY[a.action]).reduce((acc, a) => {
    const last = acc[acc.length - 1];
    if (last && last.action === a.action) last.count += 1; else acc.push({ ...a, count: 1 });
    return acc;
  }, []);
  nodes.push(section('Recent activity', null, items.length
    ? el('ul', { class: 'ws-list' }, ...items.slice(0, 8).map((a) => el('li', {}, el('span', {}, ACTIVITY[a.action], a.count > 1 ? ` (${a.count} times)` : '', a.actorKind === 'jada' ? ' · JADA' : ''), el('time', { datetime: a.at }, fmtDateTime(a.at)))))
    : el('p', { class: 'ds-muted ds-body-sm' }, 'No activity recorded yet.')));
  return { crumbs: [{ label: 'Overview' }], nodes };
}

function attentionList(ws) {
  const items = [];
  const p = profileOf(ws);
  for (const d of ws.discoveries) {
    const label = `Discovery started ${fmtDate(d.createdAt)}`;
    if (!d.hasProfile && d === latestDiscovery(ws)) items.push(['Firm profile not completed', '/app/profile']);
    const waiting = d.people - d.completed - d.inProgress;
    if (d.inProgress) items.push([`${plural(d.inProgress, 'interview')} in progress — ${label}`, `/app/discovery/${d.id}`]);
    if (waiting > 0 && d.status !== 'priorities_approved') items.push([`${plural(waiting, 'participant')} not started yet — ${label}`, `/app/discovery/${d.id}`]);
    if (d.completed > 0 && !d.analysedAt) items.push([`Finished interviews not yet analysed — ${label}`, `/app/discovery/${d.id}`]);
  }
  if (p && !techCount(p)) items.push(['Technology inventory is empty', '/app/profile/technology']);
  return items.length
    ? el('ul', { class: 'ws-list ws-attention' }, ...items.slice(0, 6).map(([t, href]) => el('li', {}, el('a', { href }, t))))
    : el('p', { class: 'ds-muted ds-body-sm' }, 'Nothing needs your attention right now.');
}

/* ============================================================ firm profile */
function profileTabs(active) {
  return el('nav', { class: 'ws-tabs', 'aria-label': 'Firm profile sections' },
    el('a', { class: 'ws-tab', href: '/app/profile', 'aria-current': active === 'details' ? 'page' : null }, 'Firm details'),
    el('a', { class: 'ws-tab', href: '/app/profile/technology', 'aria-current': active === 'technology' ? 'page' : null }, 'Technology inventory'),
    el('a', { class: 'ws-tab', href: '/app/profile/chat', 'aria-current': active === 'chat' ? 'page' : null }, 'Set up by chat'));
}
const noDiscoveryForProfile = (ws) => empty('Your firm profile is created with your first discovery',
  'Profile details are stored with each discovery, so they reflect your firm at the time of that review. Start a discovery to add them.', startButton(ws));

async function saveProfile(ws, value) {
  const r = await api(`/api/firm/discoveries/${ws.profile.discoveryId}/profile`, 'PUT', value);
  ws.profile.value = r.profile;
  return r.profile;
}

// An (i) button that shows a short definition in place. A toggle rather than a hover tooltip, so it
// works with a keyboard and on touch screens.
function infoToggle(term, text) {
  const pid = `i-${Math.random().toString(36).slice(2, 9)}`;
  const panel = el('p', { class: 'ws-info-text', id: pid, hidden: true }, text);
  const set = (open) => { panel.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
  const btn = el('button', { class: 'ws-info', type: 'button', 'aria-expanded': 'false', 'aria-controls': pid, 'aria-label': `What is “${term}”?`,
    onclick: (e) => { e.stopPropagation(); const open = panel.hidden; closeInfos(); set(open); } }, 'i');
  btn._close = () => set(false);
  return [btn, panel];
}
// Only one definition open at a time; Escape or a click elsewhere closes it.
const closeInfos = () => document.querySelectorAll('.ws-info[aria-expanded="true"]').forEach((b) => b._close && b._close());
// Any click closes it, including on the definition itself, so it can never block the field underneath.
document.addEventListener('click', () => closeInfos());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const open = document.querySelector('.ws-info[aria-expanded="true"]'); closeInfos(); open?.focus(); } });

// A form field in three rows (label, control, help and error) so that, inside .ds-form-grid, every field
// in a row shares the same label height and the inputs line up even when one label wraps.
function field(label, input, { help, optional, id, info } = {}) {
  const fid = id || `f-${Math.random().toString(36).slice(2, 9)}`;
  input.id = fid;
  const err = el('p', { class: 'ds-error', id: `${fid}-err`, hidden: true });
  input.setAttribute('aria-describedby', `${fid}-err${help ? ` ${fid}-help` : ''}`);
  const [btn, panel] = info ? infoToggle(label, info) : [null, null];
  return el('div', { class: 'ds-field', 'data-field': input.name || '' },
    el('div', { class: 'ds-field__top' },
      el('div', { class: 'ds-field__head' }, el('label', { class: 'ds-label', for: fid }, label, optional ? el('span', { class: 'ds-optional' }, ' (optional)') : null), btn),
      panel),
    input,
    el('div', { class: 'ds-field__foot' }, help ? el('p', { class: 'ds-help', id: `${fid}-help` }, help) : null, err));
}
// A checkbox or radio group legend with the same (i) definition.
const legendWithInfo = (text, info) => { const [btn, panel] = infoToggle(text, info); return [el('legend', {}, el('span', { class: 'ds-field__head' }, text, btn)), panel]; };
function setFieldError(input, message) {
  const err = document.getElementById(`${input.id}-err`);
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  if (err) { err.textContent = message || ''; err.hidden = !message; }
}
const numInput = (name, value, attrs = {}) => el('input', { class: 'ds-input', type: 'number', name, inputmode: 'numeric', min: '0', value: value === null || value === undefined ? '' : String(value), ...attrs });


// Setup by chat: the firm lead talks the profile through. The server checks every value (numbers only if
// they were typed), and nothing is saved here: "Review and save" opens the normal form, filled in.
const SETUP_KEY = (ws) => `bp_setup_${ws.profile.discoveryId}`;
const readSetup = (ws) => { try { return JSON.parse(sessionStorage.getItem(SETUP_KEY(ws)) || 'null'); } catch { return null; } };
const writeSetup = (ws, v) => { try { if (v) sessionStorage.setItem(SETUP_KEY(ws), JSON.stringify(v)); else sessionStorage.removeItem(SETUP_KEY(ws)); } catch { /* private window: the chat still works */ } };
const SETUP_OPENING = 'Hi. I’ll help you fill in your firm profile by asking a few questions; it takes about five minutes. Nothing is saved until you check it on the form at the end.\n\nTo start: how many mortgage advisers does the firm have, and is there a separate case team or administrators?';
const SETUP_ROWS = [
  ['advisers', 'Mortgage advisers'], ['caseManagers', 'Case managers'], ['administrators', 'Administrators'], ['monthlyApplications', 'Applications a month'],
  ['typicalWeeksEnquiryToOffer', 'Weeks from enquiry to offer'], ['authorisation', 'Authorisation'], ['businessFocus', 'Business focus'], ['operatingModel', 'Operating model'],
  ['location', 'Location'], ['website', 'Website'], ['businessStructure', 'How the firm is set up'], ['operationalChallenges', 'What slows things down'],
  ['loadedHourlyCostGBP', 'Hourly cost of admin time (£)'], ['otherRoles', 'Other roles'], ['technology', 'Systems'], ['notes', 'Notes'],
];
function setupValue(k, v) {
  if (v === undefined || v === null || (Array.isArray(v) && !v.length) || v === '') return null;
  if (k === 'authorisation') return (AUTHORISATION.find(([x]) => x === v) || [v, v])[1];
  if (k === 'operatingModel') return (OPERATING_MODELS.find(([x]) => x === v) || [v, v])[1];
  if (k === 'businessFocus') return v.map((x) => (BUSINESS_FOCUS.find(([y]) => y === x) || [x, x])[1]).join(', ');
  if (k === 'technology') return v.map((t) => t.name).join(', ');
  if (k === 'otherRoles') return v.map((r) => `${r.name} (${r.count})`).join(', ');
  if (k === 'loadedHourlyCostGBP') return `£${v}`;
  return String(v);
}

// The chat option, shown above the form where nobody can miss it: a full card while the profile is
// incomplete, a slimmer bar once it's filled in.
function chatOffer(saved) {
  const c = profileCompleteness(ws_profile_or_null(saved));
  const done = c.provided === c.total;
  return el('section', { class: `sc-offer${done ? ' sc-offer--slim' : ''}`, 'aria-label': 'Set up by chat' },
    el('div', { class: 'sc-offer__text' },
      el('p', { class: 'sc-offer__title' }, done ? 'Want to update it by chatting instead?' : 'Quicker: answer a few questions in a chat'),
      done ? null : el('p', { class: 'sc-offer__body' }, 'About five minutes. The chat fills in this form from your answers, and you check everything before it’s saved. Numbers are only taken when you type them.')),
    linkBtn('/app/profile/chat', 'Set up by chat', done ? 'secondary' : 'primary'));
}
const ws_profile_or_null = (p) => (p && Object.keys(p).length ? p : null);

function setupChatPage(ws) {
  const crumbs = [{ label: 'Firm profile', href: '/app/profile' }, { label: 'Set up by chat' }];
  const head = pageHeader('Firm profile', 'Talk it through instead of filling in the form. You’ll check everything on the form before it’s saved.');
  if (!ws.profile) return { crumbs, nodes: [head, profileTabs('chat'), noDiscoveryForProfile(ws)] };
  const state = readSetup(ws) || { messages: [{ role: 'assistant', content: SETUP_OPENING }], draft: {} };
  const log = el('div', { class: 'sc-log', 'aria-live': 'polite', 'aria-label': 'Conversation' });
  const got = el('dl', { class: 'sc-got__list' });
  const input = el('textarea', { class: 'ds-textarea sc-input', rows: '2', maxlength: '4000', 'aria-label': 'Your answer', placeholder: 'Type your answer. Rough numbers are fine; “not sure” is fine too.' });
  const send = el('button', { class: 'ds-btn ds-btn--primary', type: 'submit' }, 'Send');
  const err = el('p', { class: 'ds-error', role: 'alert', hidden: true });
  const say = (m) => { log.append(el('div', { class: `sc-msg sc-msg--${m.role}` }, ...m.content.split(/\n+/).map((t) => el('p', {}, t)))); log.scrollTop = log.scrollHeight; };
  // Each row: the value, "Left blank" if the firm lead chose to skip it, or "Not given yet".
  const showGot = () => got.replaceChildren(...SETUP_ROWS.map(([k, l]) => {
    const v = setupValue(k, state.draft[k]);
    const skipped = !v && (state.skipped || []).includes(k === 'technology' ? 'systems' : k);
    return el('div', { class: 'sc-got__row' }, el('dt', {}, l),
      el('dd', { class: v ? '' : skipped ? 'sc-got__skipped' : 'sc-got__empty' }, v || (skipped ? 'Left blank' : 'Not given yet')));
  }));
  const review = el('button', { class: 'ds-btn ds-btn--secondary', type: 'button', onclick: () => { writeSetup(ws, { ...state, review: true }); location.href = '/app/profile'; } }, 'Review and save');
  const restart = el('button', { class: 'ds-btn ds-btn--ghost', type: 'button', onclick: () => { if (confirm('Start the chat again? What it has filled in so far is cleared.')) { writeSetup(ws, null); location.reload(); } } }, 'Start again');
  const form = el('form', { class: 'sc-form', onsubmit: async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    err.hidden = true; send.disabled = true; input.disabled = true;
    const mine = { role: 'user', content: text };
    say(mine); input.value = '';
    const thinking = el('p', { class: 'sc-thinking ws-subtle' }, 'Thinking…'); log.append(thinking);
    try {
      const r = await api(`/api/firm/discoveries/${ws.profile.discoveryId}/profile/chat`, 'POST', { messages: [...state.messages, mine], draft: state.draft, skipped: state.skipped || [] });
      state.messages.push(mine, { role: 'assistant', content: r.reply }); state.draft = r.draft; state.skipped = r.skipped;
      writeSetup(ws, state); thinking.remove(); say({ role: 'assistant', content: r.reply }); showGot();
    } catch (ex) {
      thinking.remove(); log.lastChild?.remove(); input.value = text;      // their message goes back in the box
      err.textContent = ex.message; err.hidden = false;
    } finally { send.disabled = false; input.disabled = false; input.focus(); }
  } }, input, el('div', { class: 'sc-form__bar' }, send, err));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  state.messages.forEach(say); showGot();
  return { crumbs, nodes: [head, profileTabs('chat'),
    el('div', { class: 'sc' },
      el('section', { class: 'sc-chat ds-card' }, log, form),
      el('aside', { class: 'sc-got ds-card' }, el('h2', { class: 'ds-h4' }, 'What we’ve got so far'),
        el('p', { class: 'ds-help' }, 'Only what you’ve told us. Numbers are taken only when you type them.'), got,
        el('div', { class: 'ds-cluster sc-got__actions' }, review, restart)))] };
}

function profilePage(ws) {
  const crumbs = [{ label: 'Firm profile', href: '/app/profile' }, { label: 'Firm details' }];
  const head = pageHeader('Firm profile', 'Context for your discovery. Only what you provide is shown; leave anything you’re unsure of blank.');
  if (!ws.profile) return { crumbs, nodes: [head, profileTabs('details'), noDiscoveryForProfile(ws)] };
  // Coming from the chat: the form is filled in from what the firm lead said, and nothing is saved until they press Save.
  const fromChat = readSetup(ws)?.review ? readSetup(ws).draft : null;
  const saved = ws.profile.value || {};
  const p = fromChat ? {
    ...saved, ...Object.fromEntries(Object.entries(fromChat).filter(([k]) => !['caseManagers', 'administrators'].includes(k))),
    staffRoles: [...(fromChat.caseManagers !== undefined ? [{ role: 'case_manager', count: fromChat.caseManagers }] : (saved.staffRoles || []).filter((r) => r.role === 'case_manager')),
      ...(fromChat.administrators !== undefined ? [{ role: 'administrator', count: fromChat.administrators }] : (saved.staffRoles || []).filter((r) => r.role === 'administrator'))],
    technology: fromChat.technology ? [...(saved.technology || []).filter((t) => !fromChat.technology.some((c) => c.name.toLowerCase() === t.name.toLowerCase())), ...fromChat.technology] : saved.technology,
  } : saved;
  const chatNote = fromChat ? alertBox('info', 'Filled in from your chat', 'Check each field, change anything that’s wrong, then press Save profile. Nothing has been saved yet.') : null;
  const latest = latestDiscovery(ws);

  const f = {
    website: el('input', { class: 'ds-input', type: 'url', name: 'website', value: p.website || '', placeholder: 'https://www.example.co.uk', autocomplete: 'url' }),
    location: el('input', { class: 'ds-input', name: 'location', value: p.location || '', placeholder: 'e.g. Leeds, with a satellite office in York' }),
    advisers: numInput('advisers', p.advisers, { required: true, max: '500' }),
    caseManagers: numInput('caseManagers', countRole(p, 'case_manager'), { max: '500' }),
    administrators: numInput('administrators', countRole(p, 'administrator'), { max: '500' }),
    monthlyApplications: numInput('monthlyApplications', p.monthlyApplications),
    typicalWeeks: numInput('typicalWeeksEnquiryToOffer', p.typicalWeeksEnquiryToOffer, { step: '0.5', max: '104', inputmode: 'decimal' }),
    authorisation: el('select', { class: 'ds-select', name: 'authorisation' }, ...AUTHORISATION.map(([v, l]) => el('option', { value: v, selected: (p.authorisation || 'unsure') === v }, l))),
    businessStructure: el('textarea', { class: 'ds-textarea', name: 'businessStructure', maxlength: '1000', placeholder: 'e.g. one office; advisers supported by a case team of four' }, p.businessStructure || ''),
    operationalChallenges: el('textarea', { class: 'ds-textarea', name: 'operationalChallenges', maxlength: '4000' }, p.operationalChallenges || ''),
    loadedHourlyCostGBP: numInput('loadedHourlyCostGBP', p.loadedHourlyCostGBP, { step: '0.5', max: '1000', inputmode: 'decimal' }),
    notes: el('textarea', { class: 'ds-textarea', name: 'notes', maxlength: '2000', placeholder: 'e.g. two advisers are part-time; we’re moving CRM next spring' }, p.notes || ''),
  };
  // Other roles: as many rows as needed, each a role name and how many people.
  const roleList = el('div', { class: 'pf-roles' });
  const addRole = (r = { name: '', count: '' }) => {
    const name = el('input', { class: 'ds-input', name: 'otherRoleName', value: r.name, maxlength: '60', placeholder: 'e.g. Paraplanner', 'aria-label': 'Role' });
    const count = numInput('otherRoleCount', r.count === '' ? null : r.count, { max: '500', 'aria-label': 'How many people' });
    const row = el('div', { class: 'pf-roles__row' }, name, count,
      el('button', { class: 'ds-btn ds-btn--ghost ds-btn--sm', type: 'button', 'aria-label': 'Remove this role', onclick: () => { row.remove(); } }, 'Remove'));
    roleList.append(row);
    return name;
  };
  (p.otherRoles || []).forEach((r) => addRole(r));
  const addRoleBtn = el('button', { class: 'ds-btn ds-btn--secondary ds-btn--sm', type: 'button', onclick: () => addRole().focus() }, '+ Add another role');
  const focus = BUSINESS_FOCUS.map(([v, l]) => [v, el('input', { type: 'checkbox', name: 'businessFocus', value: v, checked: (p.businessFocus || []).includes(v) }), l]);
  const models = OPERATING_MODELS.map(([v, l]) => [v, el('input', { type: 'radio', name: 'operatingModel', value: v, checked: p.operatingModel === v }), l]);
  const annual = el('p', { class: 'ds-help' });
  const updateAnnual = () => { const n = Number(f.monthlyApplications.value); annual.textContent = f.monthlyApplications.value !== '' && n >= 0 ? `About ${(n * 12).toLocaleString('en-GB')} a year.` : 'Approximate is fine.'; };
  f.monthlyApplications.addEventListener('input', updateAnnual); updateAnnual();
  const msg = el('p', { class: 'ws-inline-msg', role: 'status', 'aria-live': 'polite' });
  const saveBtn = el('button', { class: 'ds-btn ds-btn--primary', type: 'submit' }, 'Save profile');
  const nextSlot = el('div', { class: 'ws-nextslot' });
  const showNext = () => nextSlot.replaceChildren(...[ws.profile && ws.profile.value ? nextStepPrompt(ws, '/app/profile') : null].filter(Boolean));

  const intOrNull = (input, name, { max, decimal } = {}) => {
    const raw = input.value.trim();
    if (raw === '') return { ok: true, value: null };
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || (!decimal && !Number.isInteger(n)) || (max !== undefined && n > max)) {
      setFieldError(input, `Enter ${decimal ? 'a number' : 'a whole number'} between 0 and ${max ?? 'any size'}.`); return { ok: false };
    }
    setFieldError(input, ''); return { ok: true, value: n };
  };

  const form = el('form', { class: 'ws-form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const goNext = form.dataset.next; delete form.dataset.next;   // set only by "Save and add technology", for this submit
    msg.textContent = ''; msg.dataset.kind = '';
    const adv = intOrNull(f.advisers, 'advisers', { max: 500 });
    if (adv.ok && adv.value === null) { setFieldError(f.advisers, 'Enter the number of advisers (0 if none).'); adv.ok = false; }
    const cm = intOrNull(f.caseManagers, 'caseManagers', { max: 500 }), ad = intOrNull(f.administrators, 'administrators', { max: 500 });
    const ma = intOrNull(f.monthlyApplications, 'monthlyApplications', { max: 100000 });
    const tw = intOrNull(f.typicalWeeks, 'typicalWeeks', { max: 104, decimal: true });
    const hc = intOrNull(f.loadedHourlyCostGBP, 'loadedHourlyCostGBP', { max: 1000, decimal: true });
    if (hc.ok && hc.value === 0) { setFieldError(f.loadedHourlyCostGBP, 'Leave blank, or enter an amount above £0.'); hc.ok = false; }
    let website = f.website.value.trim();
    if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
    let webOk = true;
    if (website) { try { const u = new URL(website); webOk = /\./.test(u.hostname); } catch { webOk = false; } }
    setFieldError(f.website, webOk ? '' : 'Enter a web address, for example www.example.co.uk.');
    // Other roles: rows with a name; a count is required for each named role.
    let rolesOk = true;
    const otherRoles = [...roleList.querySelectorAll('.pf-roles__row')].map((row) => {
      const [n, c] = row.querySelectorAll('input');
      const name = n.value.trim();
      if (!name && c.value.trim() === '') return null;
      const v = intOrNull(c, 'otherRoleCount', { max: 500 });
      if (!name || !v.ok || v.value === null) { rolesOk = false; setFieldError(c, ''); c.setAttribute('aria-invalid', 'true'); return null; }
      c.setAttribute('aria-invalid', 'false');
      return { name, count: v.value };
    }).filter(Boolean);
    const invalid = [adv, cm, ad, ma, tw, hc].some((x) => !x.ok) || !webOk || !rolesOk;
    if (!rolesOk) { msg.textContent = 'Give each extra role a name and a number of people (0 or more).'; msg.dataset.kind = 'error'; return; }
    if (invalid) { msg.textContent = 'Please correct the highlighted fields.'; msg.dataset.kind = 'error'; form.querySelector('[aria-invalid="true"]')?.focus(); return; }
    const model = models.find(([, i]) => i.checked);
    const value = {
      ...(ws.profile.value || {}),
      advisers: adv.value, monthlyApplications: ma.value, typicalWeeksEnquiryToOffer: tw.value, loadedHourlyCostGBP: hc.value,
      authorisation: f.authorisation.value, businessStructure: f.businessStructure.value.trim(), operationalChallenges: f.operationalChallenges.value.trim(),
      staffRoles: [{ role: 'adviser', count: adv.value }, ...(cm.value === null ? [] : [{ role: 'case_manager', count: cm.value }]), ...(ad.value === null ? [] : [{ role: 'administrator', count: ad.value }])],
      systems: p.systems || [], technology: p.technology,
      website, location: f.location.value.trim(), businessFocus: focus.filter(([, i]) => i.checked).map(([v]) => v), operatingModel: model ? model[0] : null,
      otherRoles, notes: f.notes.value.trim(),
    };
    if (value.technology === undefined) delete value.technology;
    saveBtn.disabled = true; msg.textContent = 'Saving…';
    try {
      await saveProfile(ws, value);
      if (fromChat) writeSetup(ws, null);          // the chat's draft is now saved for real
      f.website.value = website;
      msg.textContent = `Profile saved ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`; msg.dataset.kind = 'success'; showNext();
      if (goNext) { location.href = goNext; return; }   // "Save and add technology"
    } catch (err) {
      msg.textContent = err.issues?.length ? `Please check: ${err.issues.map((i) => i.path || 'form').join(', ')}.` : err.message; msg.dataset.kind = 'error';
    } finally { saveBtn.disabled = false; }
  } },
    el('fieldset', { class: 'ws-fieldset' }, el('legend', {}, 'About the firm'),
      el('div', { class: 'ds-form-grid' },
        el('div', { class: 'ds-field' }, el('span', { class: 'ds-label' }, 'Firm name'), el('p', { class: 'ws-readonly' }, ws.firmName), el('p', { class: 'ds-help' }, 'Set when your workspace was created. Contact JADA to change it.')),
        field('Website', f.website, { optional: true, info: 'Your firm’s public website, if it has one. Used only as background for the discovery.' }), field('Location', f.location, { optional: true, info: 'Where the firm is mainly based, for example a town or region. Used only as background.' })),
      field('Authorisation', f.authorisation, { info: 'Whether the firm holds its own FCA authorisation or works as an appointed representative under a network. For appointed representatives, the network’s own rules may also apply, for example to client communications.' })),
    el('fieldset', { class: 'ws-fieldset' }, el('legend', {}, 'People and volume'),
      el('div', { class: 'ds-form-grid' },
        field('Mortgage advisers', f.advisers, { help: 'Required. Enter 0 if none.', info: 'People who give mortgage advice to clients, including any who also run their own cases. Count each person once, including part-time staff.' }),
        field('Case managers', f.caseManagers, { optional: true, info: 'People who progress cases after the advice: chasing documents and keeping lenders, solicitors and clients updated. Sometimes called case administrators or processors.' }),
        field('Administrators', f.administrators, { optional: true, info: 'People who handle general administration, such as new enquiries, data entry and filing, rather than progressing individual cases.' }),
        (() => { const fe = field('Mortgage applications a month', f.monthlyApplications, { optional: true, id: 'f-ma', info: 'Roughly how many mortgage applications the firm submits to lenders in a typical month, across all advisers. A rough figure is fine; BuildA+ shows it to you as an annual total so you can sense-check it.' }); fe.querySelector('.ds-field__foot').prepend(annual); return fe; })(),
        field('Typical weeks from enquiry to offer', f.typicalWeeks, { optional: true, info: 'How many weeks a typical case takes from the client’s first enquiry to the lender’s mortgage offer. A typical figure is fine; ignore unusual cases.' }))),
    el('fieldset', { class: 'ws-fieldset' }, el('legend', {}, 'Other roles'),
      el('p', { class: 'ds-help' }, 'Anyone else in the team, such as paraplanners, protection specialists or a compliance officer. Optional.'),
      roleList, el('div', {}, addRoleBtn)),
    el('fieldset', { class: 'ws-fieldset' }, el('legend', {}, 'Business focus and operating model'),
      el('fieldset', { class: 'ws-checks' }, ...legendWithInfo('Mortgage business focus', 'The kinds of mortgage work that make up most of the firm’s business. Tick all that apply.'), ...focus.map(([v, i, l]) => el('label', { class: 'ds-check' }, i, l))),
      el('fieldset', { class: 'ws-checks' }, ...legendWithInfo('Operating model', 'How work is split between advisers and support staff: for example advisers backed by a case team, or advisers running their own cases from start to finish.'), ...models.map(([v, i, l]) => el('label', { class: 'ds-check' }, i, l))),
      field('How the firm is set up', f.businessStructure, { optional: true, info: 'A sentence or two on how the firm is organised: for example one office or several, who manages the case team, and whether advisers have their own support.' })),
    el('fieldset', { class: 'ws-fieldset' }, el('legend', {}, 'Operational context'),
      field('What slows things down today?', f.operationalChallenges, { optional: true, info: 'Your own view of where work gets stuck. BuildA+ compares it with what your team describe in their interviews.', help: 'In your own words. This is compared with what your team says in interviews.' }),
      field('Approximate hourly cost of whoever does the admin work (£)', f.loadedHourlyCostGBP, { optional: true, info: 'What an hour costs for the people who do the routine admin: administrators or case managers, or your advisers if they do their own admin. Include salary and employer costs if you know them. It only shows the scale of time recovered; BuildA+ never estimates it and never presents it as a saving.', help: 'Only used to put a value on time saved. BuildA+ never estimates it for you.' }),
      field('Notes', f.notes, { optional: true, info: 'Anything else about the firm that doesn’t fit above: part-time staff, a planned system change, how a branch works. It’s kept with your profile and shown in the report.', help: 'Please leave out client names and case details.' })),
    el('fieldset', { class: 'ws-fieldset' }, el('legend', {}, 'Technology environment'),
      el('p', { class: 'ds-body-sm' }, techCount(p) ? `${plural(techCount(p), 'system')} recorded in your technology inventory.` : 'No systems recorded in your technology inventory yet.'),
      // Technology is saved with the firm details, so before the first save this button saves first (nothing typed is lost).
      el('div', {}, ws.profile?.value ? linkBtn('/app/profile/technology', techCount(p) ? 'Manage technology inventory' : 'Add technology')
        : el('button', { class: 'ds-btn ds-btn--secondary', type: 'submit', onclick: () => { form.dataset.next = '/app/profile/technology'; } }, 'Save and add technology'))),
    el('div', { class: 'ws-form__bar' }, saveBtn, msg,
      latest ? el('span', { class: 'ws-subtle' }, `Saved with your current discovery, started ${fmtDate(latest.createdAt)}.`) : null, nextSlot));
  f.monthlyApplications.setAttribute('aria-describedby', 'f-ma-err');
  showNext();
  return { crumbs, nodes: [head, profileTabs('details'), chatNote, ...(fromChat ? [] : [chatOffer(saved)]), form] };
}

/* ============================================================ technology inventory */
function technologyPage(ws) {
  const crumbs = [{ label: 'Firm profile', href: '/app/profile' }, { label: 'Technology inventory' }];
  const head = pageHeader('Firm profile', 'The systems your firm already uses. This is for understanding your environment; recording a system doesn’t mean it will be integrated with anything.');
  if (!ws.profile) return { crumbs, nodes: [head, profileTabs('technology'), noDiscoveryForProfile(ws)] };
  if (!ws.profile.value) return { crumbs, nodes: [head, profileTabs('technology'), empty('Save the firm details first', 'Your systems are saved with the firm details. Fill them in and click “Save and add technology”; only the number of mortgage advisers is required.', linkBtn('/app/profile', 'Complete firm details', 'primary'))] };

  const wrap = el('div', {});
  let editing = null; // index or null
  const render = () => wrap.replaceChildren(...inventoryView());
  const entries = () => ws.profile.value.technology || [];
  const persist = async (technology, msg) => {
    msg.textContent = 'Saving…'; msg.dataset.kind = '';
    const value = { ...ws.profile.value, technology };
    await saveProfile(ws, value);
  };

  function inventoryView() {
    const list = entries();
    const listMsg = el('p', { class: 'ws-inline-msg', role: 'status', 'aria-live': 'polite' });
    const legacy = list.length ? [] : (ws.profile.value.systems || []);
    const nodes = [];
    if (legacy.length) {
      nodes.push(el('div', { class: 'ds-alert ds-alert--info' }, el('p', { class: 'ds-alert__title' }, 'Systems from your earlier profile'),
        el('p', {}, 'These were listed as names only. Once you add your first system, the inventory replaces this list, so add each one you still use.'),
        el('div', { class: 'ds-cluster' }, ...legacy.map((name) => el('button', { class: 'ds-btn ds-btn--secondary ds-btn--sm', type: 'button', onclick: () => { editing = -1; render(); formFill({ name }); } }, `Add ${name}`)))));
    }
    if (!list.length) {
      nodes.push(empty('No technology recorded yet', 'Add the CRM, mortgage platforms, communication tools and other systems your firm uses day to day.'));
    } else {
      const byCat = TECH_CATEGORIES.map(([cat, label]) => [label, list.map((t, i) => [t, i]).filter(([t]) => t.category === cat)]).filter(([, xs]) => xs.length);
      nodes.push(el('div', { class: 'ds-table-wrap' }, el('table', { class: 'ds-table' },
        el('caption', {}, `${plural(list.length, 'system')} recorded`),
        el('thead', {}, el('tr', {}, ...['System', 'Category', 'Used for', 'Teams', 'Notes'].map((h) => el('th', { scope: 'col' }, h)), el('th', { scope: 'col' }, el('span', { class: 'ds-visually-hidden' }, 'Actions')))),
        el('tbody', {}, ...byCat.flatMap(([label, xs]) => xs.map(([t, i]) => el('tr', {},
          el('th', { scope: 'row' }, t.name),
          el('td', {}, label),
          el('td', {}, t.purpose || el('span', { class: 'ws-subtle' }, '—')),
          el('td', {}, (t.teams || []).length ? el('div', { class: 'ws-chips' }, ...t.teams.map((x) => el('span', { class: 'ws-chip' }, (TECH_TEAMS.find(([v]) => v === x) || [x, x])[1]))) : el('span', { class: 'ws-subtle' }, '—')),
          el('td', {}, t.notes || el('span', { class: 'ws-subtle' }, '—')),
          el('td', {}, el('div', { class: 'ws-table-actions' },
            el('button', { class: 'ds-btn ds-btn--ghost ds-btn--sm', type: 'button', 'aria-label': `Edit ${t.name}`, onclick: () => { editing = i; render(); formFill(t); } }, 'Edit'),
            el('button', { class: 'ds-btn ds-btn--ghost ds-btn--sm', type: 'button', 'aria-label': `Remove ${t.name}`, onclick: async () => {
              if (!confirm(`Remove ${t.name} from the inventory?`)) return;
              try { await persist(entries().filter((_, j) => j !== i), listMsg); editing = null; render(); } catch (err) { listMsg.textContent = err.message; listMsg.dataset.kind = 'error'; }
            } }, 'Remove'))))))))));
    }
    nodes.push(listMsg);
    if (list.length) { const nx = nextStepPrompt(ws, '/app/profile/technology'); if (nx) nodes.push(nx); }
    nodes.push(entryForm());
    return nodes;
  }

  let formFill = () => {};
  function entryForm() {
    const isEdit = editing !== null && editing >= 0;
    const name = el('input', { class: 'ds-input', name: 'name', maxlength: '100', required: true, placeholder: 'e.g. the name of your CRM' });
    const category = el('select', { class: 'ds-select', name: 'category' }, ...TECH_CATEGORIES.map(([v, l]) => el('option', { value: v }, l)));
    const purpose = el('input', { class: 'ds-input', name: 'purpose', maxlength: '300', placeholder: 'e.g. case tracking, client records, document requests' });
    const notes = el('textarea', { class: 'ds-textarea', name: 'notes', maxlength: '500' });
    const teams = TECH_TEAMS.map(([v, l]) => [v, el('input', { type: 'checkbox', value: v }), l]);
    const msg = el('p', { class: 'ws-inline-msg', role: 'status', 'aria-live': 'polite' });
    formFill = (t) => {
      name.value = t.name || ''; category.value = t.category || 'crm_mortgage'; purpose.value = t.purpose || ''; notes.value = t.notes || '';
      teams.forEach(([v, i]) => { i.checked = (t.teams || []).includes(v); });
      name.focus();
    };
    const submit = el('button', { class: 'ds-btn ds-btn--primary', type: 'submit' }, isEdit ? 'Save changes' : 'Add to inventory');
    const form = el('form', { class: 'ws-fieldset', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const n = name.value.trim();
      setFieldError(name, n ? '' : 'Enter the name of the system.');
      const dupe = entries().some((t, i) => t.name.toLowerCase() === n.toLowerCase() && i !== editing);
      if (n && dupe) setFieldError(name, 'This system is already in the inventory.');
      if (!n || dupe) { name.focus(); return; }
      if (!isEdit && entries().length >= 50) { msg.textContent = 'The inventory holds up to 50 systems.'; msg.dataset.kind = 'error'; return; }
      const entry = { name: n, category: category.value, purpose: purpose.value.trim(), teams: teams.filter(([, i]) => i.checked).map(([v]) => v), notes: notes.value.trim() };
      const next = isEdit ? entries().map((t, i) => (i === editing ? entry : t)) : [...entries(), entry];
      submit.disabled = true;
      try { await persist(next, msg); editing = null; render(); wrap.querySelector('.ws-inline-msg').textContent = `${n} ${isEdit ? 'updated' : 'added'}.`; wrap.querySelector('.ws-inline-msg').dataset.kind = 'success'; }
      catch (err) { msg.textContent = err.issues?.length ? `Please check: ${err.issues.map((i) => i.path || 'form').join(', ')}.` : err.message; msg.dataset.kind = 'error'; submit.disabled = false; }
    } },
      el('legend', {}, isEdit ? 'Edit system' : 'Add a system'),
      el('div', { class: 'ds-form-grid' }, field('System or product name', name, { info: 'The name your team uses for the system or product, for example the CRM, a sourcing tool or a shared mailbox. Recording it never means BuildA+ will connect to it.' }), field('Category', category, { info: 'The closest group for the system. CRM and mortgage platforms covers client records, case tracking and sourcing; choose “Other operational applications” if nothing fits.' })),
      field('What the firm uses it for', purpose, { optional: true, info: 'What the firm actually uses it for day to day, in a few words, for example “client records and case notes” or “sending documents to clients”.' }),
      el('fieldset', { class: 'ws-checks' }, ...legendWithInfo('Teams that use it', 'Which groups of staff use it regularly. Tick all that apply; this shows where the same information is handled by different teams.'), ...teams.map(([, i, l]) => el('label', { class: 'ds-check' }, i, l))),
      field('Notes', notes, { optional: true, info: 'Anything useful to know, for example known limitations, workarounds, or how information gets in and out (manual entry, exports, integrations).', help: 'For example, known limitations or how data gets in and out.' }),
      el('div', { class: 'ds-cluster' }, submit,
        isEdit || editing === -1 ? el('button', { class: 'ds-btn ds-btn--ghost', type: 'button', onclick: () => { editing = null; render(); } }, 'Cancel') : null, msg));
    return el('div', { class: 'ws-section' }, form);
  }

  render();
  if (editing !== null && editing >= 0) formFill(entries()[editing]);
  return { crumbs, nodes: [head, profileTabs('technology'), wrap] };
}

/* ============================================================ discovery */
function discoveryList(ws) {
  const crumbs = [{ label: 'Discovery' }];
  const head = pageHeader('Discovery', 'Each discovery interviews your team independently and compares their accounts across roles.', startButton(ws, 'Start a new discovery'));
  if (!ws.discoveries.length) return { crumbs, nodes: [head, empty('No discoveries yet', 'Start a discovery to map how work moves through your firm. You’ll complete a short profile, then add the people to interview.')] };
  return { crumbs, nodes: [head, el('div', { class: 'ds-table-wrap' }, el('table', { class: 'ds-table' },
    el('thead', {}, el('tr', {}, ...['Started', 'Status', 'Interviews', 'Findings', 'Last updated'].map((h) => el('th', { scope: 'col' }, h)), el('th', { scope: 'col' }, el('span', { class: 'ds-visually-hidden' }, 'Actions')))),
    el('tbody', {}, ...ws.discoveries.map((d) => {
      const [l, v] = discoveryStatus(d);
      return el('tr', {},
        el('th', { scope: 'row' }, el('a', { href: `/app/discovery/${d.id}` }, fmtDate(d.createdAt))),
        el('td', {}, status(l, v)),
        el('td', { class: 'ds-num' }, d.people ? `${d.completed} of ${d.people} finished` : 'No participants yet'),
        el('td', { class: 'ds-num' }, d.analysedAt ? String(d.painPoints) : el('span', { class: 'ws-subtle' }, 'Not analysed')),
        el('td', {}, fmtDate(d.updatedAt)),
        el('td', {}, el('div', { class: 'ws-table-actions' }, linkBtn(`/app/discovery/${d.id}`, d.status === 'profile' || (d.people && d.completed < d.people) ? 'Continue' : 'Open', 'secondary', { class: 'ds-btn ds-btn--secondary ds-btn--sm' }))));
    }))))] };
}

function linkBox(name, link) {
  const input = el('input', { class: 'ds-input', value: link, readonly: true, 'aria-label': `Interview link for ${name}` });
  const copied = el('span', { class: 'ws-inline-msg', role: 'status' });
  return el('div', { class: 'ds-alert ds-alert--success ws-link-box' },
    el('p', { class: 'ds-alert__title' }, `Interview link for ${name}`),
    el('p', {}, 'Copy it now and send it to them yourself. For security it can’t be shown again, but you can always make a new one.'),
    el('div', { class: 'ws-link-row' }, input, el('button', { class: 'ds-btn ds-btn--primary', type: 'button', onclick: async () => {
      try { await navigator.clipboard.writeText(link); copied.textContent = 'Copied.'; } catch { input.select(); copied.textContent = 'Press Ctrl+C (or Cmd+C) to copy.'; }
    } }, 'Copy link')), copied);
}

/* ============================================================ evidence and opportunities (from the existing playback) */
function pickDiscovery(ws, title) {
  const analysed = ws.discoveries.filter((d) => d.analysedAt);
  const wanted = new URLSearchParams(location.search).get('d');
  const chosen = analysed.find((d) => d.id === wanted) || analysed[0] || null;
  const picker = analysed.length > 1 ? el('div', { class: 'ws-select-row' }, el('div', { class: 'ds-field' },
    el('label', { class: 'ds-label', for: 'ws-pick' }, 'Discovery'),
    el('select', { class: 'ds-select', id: 'ws-pick', onchange: (e) => { location.search = `?d=${e.target.value}`; } },
      ...analysed.map((d) => el('option', { value: d.id, selected: d.id === chosen.id }, `Started ${fmtDate(d.createdAt)}${d === ws.discoveries[0] ? ' (latest)' : ''}`))))) : null;
  return { chosen, picker, none: !chosen ? empty(`No ${title} yet`, ws.discoveries.some((d) => d.completed > 0)
    ? 'Interviews have finished but haven’t been analysed yet. Run the analysis from the findings page.'
    : 'Evidence comes from your team’s interviews. Once interviews finish and are analysed, it appears here.',
  ws.discoveries.find((d) => d.completed > 0) ? linkBtn(`/app/discovery/${ws.discoveries.find((d) => d.completed > 0).id}`, 'Open discovery', 'primary') : linkBtn('/app/discovery', 'Go to discovery', 'primary')) : null };
}

function evidencePage(ws) {
  const crumbs = [{ label: 'Evidence' }];
  const head = pageHeader('Evidence', 'Evidence is kept with each discovery, alongside the findings it supports.');
  const withEvidence = ws.discoveries.filter((d) => d.evidence > 0);
  if (withEvidence.length === 1) { location.replace(`/app/discovery/${withEvidence[0].id}/evidence`); return { crumbs, nodes: [head] }; }
  if (!withEvidence.length) return { crumbs, nodes: [head, empty('No evidence yet', 'Evidence comes from your team’s interviews. It appears in the discovery once interviews are completed.', linkBtn('/app/discovery', 'Go to discovery', 'primary'), 'evidence')] };
  return { crumbs, nodes: [head, el('ul', { class: 'ws-list' }, ...withEvidence.map((d) => el('li', {}, el('a', { href: `/app/discovery/${d.id}/evidence` }, `Discovery started ${fmtDate(d.createdAt)}`), el('span', { class: 'ws-subtle' }, plural(d.evidence, 'evidence item')))))] };
}

// Report and priority approval: the same endpoints the earlier findings page used.
function decisionsSection(d, pb) {
  const base = `/api/firm/discoveries/${d.id}`;
  const reportMsg = el('p', { class: 'ws-inline-msg', role: 'status', 'aria-live': 'polite' });
  const reportBtn = el('button', { class: 'ds-btn ds-btn--secondary', type: 'button', onclick: async () => {
    reportBtn.disabled = true; reportMsg.textContent = 'Preparing the report…'; reportMsg.dataset.kind = '';
    try { const r = await api(`${base}/reports`, 'POST'); location.href = r.pdfUrl; reportMsg.textContent = `Report version ${r.version} created and downloaded.`; reportMsg.dataset.kind = 'success'; }
    catch (err) { reportMsg.textContent = err.message; reportMsg.dataset.kind = 'error'; } finally { reportBtn.disabled = false; }
  } }, 'Create and download report (PDF)');
  // With later stages parked, the "Your discovery report" panel already names it, so no second heading.
  const wrap = (body) => (FEATURES.laterStages ? section('Discovery report', null, body) : body);
  return wrap(el('div', { class: 'ds-stack' },
    d.status === 'interviews' ? alertBox('warning', 'The discovery review isn’t complete yet', 'You can still create a report, but check the discovery review first so open questions and assumptions are recorded.') : null,
    el('div', { class: 'ws-fieldset' }, el('p', { class: 'ds-body-sm' }, 'Each report is saved as a fixed version: the baseline for comparing results after changes are made. Quotes from roles with fewer than three participants are left out to protect individuals.'),
      el('div', { class: 'ds-cluster' }, reportBtn, reportMsg)),
    el('p', { class: 'ds-help' }, 'Priorities are approved one at a time on each opportunity, so every approval meets the same evidence, validation and regulatory rules and has its own reason and audit record.')));
}

/* ============================================================ transformation */
async function implementationPage(ws) {
  const crumbs = [{ label: 'Implementation' }];
  const head = pageHeader('Implementation', 'Opportunities you sent to JADA engineering review, and where each one stands. Nothing is built until JADA engineering approves it.');
  const withPacks = ws.discoveries.filter((d) => d.packs > 0);
  if (!withPacks.length) return { crumbs, nodes: [head, empty('Nothing sent to engineering yet', 'Approve an opportunity and send it to JADA engineering review from its page. It appears here with its status.',
    ws.discoveries.some((d) => d.analysedAt) ? linkBtn(`/app/opportunities?d=${ws.discoveries.find((d) => d.analysedAt).id}`, 'Review opportunities', 'primary') : null, 'implementation')] };
  const lists = await Promise.all(withPacks.map(async (d) => [d, (await api(`/api/firm/discoveries/${d.id}/engineering`)).submissions]));
  return { crumbs, nodes: [head, ...lists.map(([d, subs]) => section(`Discovery started ${fmtDate(d.createdAt)}`, null,
    el('div', { class: 'ds-table-wrap' }, el('table', { class: 'ds-table' },
      el('thead', {}, el('tr', {}, ...['Opportunity', 'Approach', 'Engineering status', 'Updated', 'Next step'].map((h) => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, ...subs.map((s) => {
        const [sl, sv] = PACK_STATUS[s.status] || [s.status, 'neutral'];
        const next = s.actions.includes('provide_information') ? 'Answer JADA’s question' : s.needsReassessment ? 'Submitted before the full assessment: JADA will reassess it'
          : s.status === 'completed' ? (s.outcome && s.outcome.overall === 'not_yet_measured' ? 'Results not yet measured' : 'See Impact') : '—';
        return el('tr', {}, el('th', { scope: 'row' }, el('a', { href: `/app/opportunities/${d.id}/${s.opportunityId}` }, s.submission.title)),
          el('td', {}, classification(s.submission.classification)), el('td', {}, status(sl, sv)), el('td', {}, fmtDate(s.updatedAt)), el('td', { class: 'ds-body-sm' }, next));
      }))))))] };
}

const OUTCOME_LABEL = { not_yet_measured: ['Not yet measured', 'warning'], no_agreed_targets: ['No agreed targets', 'warning'], partly_measured: ['Partly measured', 'warning'], met: ['Agreed outcome met', 'success'], not_met: ['Agreed outcome not met', 'danger'] };
const VALUE_TYPE = { time: 'Time recovered', cash: 'Cash savings', capacity: 'Operational capacity', revenue: 'Revenue impact' };
async function impactPage(ws) {
  const crumbs = [{ label: 'Impact' }];
  const head = pageHeader('Impact', 'Results measured against the outcomes you agreed with JADA before each change. Finishing the work is not the same as delivering the result.');
  const withPacks = ws.discoveries.filter((d) => d.packs > 0);
  const lists = await Promise.all(withPacks.map(async (d) => [d, (await api(`/api/firm/discoveries/${d.id}/engineering`)).submissions.filter((s) => s.plan)]));
  const planned = lists.flatMap(([d, subs]) => subs.map((s) => [d, s]));
  const baselines = ws.discoveries.filter((d) => d.reportedAt);
  return { crumbs, nodes: [head,
    planned.length ? null : alertBox('info', 'Nothing to measure yet', 'Measures are agreed in each implementation plan. Results appear here once JADA records them; nothing is estimated in the meantime.'),
    ...planned.map(([d, s]) => {
      const [ol, ov] = OUTCOME_LABEL[s.outcome.overall] || [s.outcome.overall, 'neutral'];
      return section(s.submission.title, status(ol, ov), el('div', { class: 'ds-table-wrap' }, el('table', { class: 'ds-table' },
        el('thead', {}, el('tr', {}, ...['Measure', 'Type', 'Baseline', 'Agreed target', 'Result', 'Measured by'].map((h) => el('th', { scope: 'col' }, h)))),
        el('tbody', {}, ...s.plan.successMeasures.map((m) => {
          const r = s.outcome.rows.find((x) => x.name === m.name);
          return el('tr', {}, el('th', { scope: 'row' }, m.name), el('td', {}, VALUE_TYPE[m.valueType] || m.valueType),
            el('td', {}, m.baseline === null ? 'Not measured' : `${m.baseline} ${m.unit}`), el('td', {}, m.target === null ? 'Not agreed' : `${m.direction === 'decrease' ? '≤' : '≥'} ${m.target} ${m.unit}`),
            el('td', {}, r && r.result !== null ? `${r.result} ${m.unit}` : 'Not yet measured'), el('td', { class: 'ds-body-sm' }, `${m.measurementSource} · ${m.period}`));
        })))), el('p', { class: 'ds-help' }, el('a', { href: `/app/opportunities/${d.id}/${s.opportunityId}` }, 'Open the opportunity')));
    }),
    section('Baselines recorded', null, baselines.length
      ? el('ul', { class: 'ws-list' }, ...baselines.map((d) => el('li', {}, el('span', {}, `Discovery started ${fmtDate(d.createdAt)}`), el('span', { class: 'ws-subtle' }, `Baseline in report of ${fmtDate(d.reportedAt)}`))))
      : el('p', { class: 'ds-muted ds-body-sm' }, 'No baseline report yet. A baseline is recorded each time you create a discovery report.'))] };
}

/* ============================================================ settings */
function organisationPage(ws) {
  return { crumbs: [{ label: 'Settings' }, { label: 'Organisation' }], nodes: [pageHeader('Organisation settings', null),
    el('div', { class: 'ds-card' }, el('div', { class: 'ds-card__body' }, el('dl', { class: 'ds-meta' },
      el('dt', {}, 'Firm name'), el('dd', {}, ws.firmName),
      el('dt', {}, 'Discoveries'), el('dd', {}, String(ws.discoveries.length)),
      el('dt', {}, 'Your role'), el('dd', {}, 'Firm lead')))),
    section('Data and access', null, el('ul', { class: 'ws-list' },
      el('li', {}, 'Only people signed in to this firm can see its workspace. Other firms’ information is never visible here.'),
      el('li', {}, 'JADA staff see a discovery only when they are assigned to it.'),
      el('li', {}, 'Participants’ names are not sent to the AI, and findings are shown to you by role.'),
      el('li', {}, 'Client files and client details are kept out of discovery.'))),
    alertBox('info', 'Not available yet', 'Renaming the firm and inviting colleagues to the workspace aren’t available in BuildA+ yet. Contact JADA if you need either.')] };
}

function accountPage() {
  return { crumbs: [{ label: 'Settings' }, { label: 'Account' }], nodes: [pageHeader('Account settings', null),
    el('div', { class: 'ds-card' }, el('div', { class: 'ds-card__body ds-stack' }, el('dl', { class: 'ds-meta' }, el('dt', {}, 'Role'), el('dd', {}, 'Firm lead')),
      el('div', {}, linkBtn('/signout', 'Sign out')))),
    alertBox('info', 'Sign-in details', 'Your sign-in is managed outside BuildA+, so there’s nothing to change here yet.')] };
}

/* ============================================================ router */
const ROUTES = [
  [/^\/app$/, 'overview', overview], [/^\/app\/profile$/, 'profile', profilePage], [/^\/app\/profile\/technology$/, 'profile', technologyPage], [/^\/app\/profile\/chat$/, 'profile', setupChatPage],
  [/^\/app\/discovery$/, 'discovery', discoveryList], [/^\/app\/discovery\/([0-9a-f-]{36})(?:\/(context|interviews|journey|evidence|findings|review))?(?:\/([0-9a-f-]{36}))?$/, 'discovery', (ws, id, tab, sub) => discoveryWorkspacePage(ws, id, tab || '', sub || '')],
  [/^\/app\/evidence$/, 'evidence', evidencePage], [/^\/app\/opportunities(?:\/([0-9a-f-]{36})(?:\/([0-9a-f-]{36}))?)?$/, 'opportunities', opportunitiesPage],
  [/^\/app\/implementation$/, 'implementation', implementationPage], [/^\/app\/impact$/, 'impact', impactPage],
  [/^\/app\/settings\/organisation$/, 'organisation', organisationPage], [/^\/app\/settings\/account$/, 'account', accountPage],
];

(async () => {
  const path = location.pathname.replace(/\/+$/, '') || '/app';
  let route = ROUTES.map(([re, key, fn]) => [path.match(re), key, fn]).find(([m]) => m);
  renderSidebar(route ? route[1] : null);
  renderTopbar(null, []);
  let ws;
  try { ws = await api('/api/firm/workspace'); }
  catch (err) {
    if (err.status === 401) return;
    $main.replaceChildren(err.status === 403
      ? empty('This workspace is for firm leads', 'Your account doesn’t have access to a firm workspace.', linkBtn('/signout', 'Sign out'))
      : alertBox('danger', 'We couldn’t load your workspace', `${err.message} Please refresh the page.`));
    return;
  }
  FEATURES.laterStages = !!ws.features?.laterStages;
  if (!FEATURES.laterStages && route && LATER_STAGE_KEYS.includes(route[1])) route = null;   // parked page
  if (FEATURES.laterStages) renderSidebar(route ? route[1] : null);
  try {
    const page = route ? await route[2](ws, ...route[0].slice(1)) : { crumbs: [{ label: 'Not found' }], nodes: [pageHeader('Page not found'), empty('This page doesn’t exist', 'Use the navigation to find what you need.', linkBtn('/app', 'Go to overview'))] };
    renderTopbar(ws.firmName, page.crumbs);
    document.title = `${page.crumbs[page.crumbs.length - 1].label} — ${ws.firmName} — BuildA+`;
    $main.replaceChildren(...page.nodes.filter(Boolean));
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();   // e.g. "Go to the report"
  } catch (err) {
    if (err.status === 401) return;
    renderTopbar(ws.firmName, []);
    $main.replaceChildren(alertBox('danger', 'Something went wrong loading this page', `${err.message}`));
  }
})();
