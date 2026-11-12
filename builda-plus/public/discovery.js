'use strict';
// BuildA+ discovery workspace (Phase 3). Loaded before workspace.js; uses its shared helpers at call time.
// Every figure, status and confidence shown here comes from GET /api/firm/discoveries/:id/workspace.

const SOURCE_LABEL = {
  employee_reported: ['firm-said', 'Said by staff'], firm_provided: ['firm-said', 'Entered by your firm'], measured: ['measured', 'Measured'],
  public_record: ['public', 'Public record'], industry_knowledge: ['playbook', 'Industry knowledge'], assumption: ['assumption', 'Working estimate'],
};
const REVIEW = { unreviewed: ['Not reviewed', 'neutral'], validated: ['Validated by you', 'success'], disputed: ['Disputed', 'warning'] };
const DIMENSION_LABEL = { existence: 'The problem exists here', volume: 'How often it happens', effort: 'How long it takes each time', impact: 'Hours that could be saved' };
const CLASSIFICATION_SOURCE = { ai_proposed: 'Suggested by AI from what people said', playbook: 'Suggested by industry knowledge', firm_lead: 'Set by you' };
// Kept simple: one path from firm context to findings, then Opportunities is where the firm lead decides.
const TABS = [['', 'Overview'], ['context', 'Firm context'], ['interviews', 'Interviews'], ['findings', 'Findings']];

const sourceBadge = (s) => { const [cls, label] = SOURCE_LABEL[s] || SOURCE_LABEL.assumption; return el('span', { class: `ds-evidence ds-evidence--${cls}` }, label); };
const reviewStatus = (r) => { const [l, v] = REVIEW[r.status] || REVIEW.unreviewed; return status(l, v); };
const num = (x) => (x === null || x === undefined ? 'Unknown' : Number(x).toLocaleString('en-GB', { maximumFractionDigits: 1 }));
const dUrl = (id, tab, sub) => `/app/discovery/${id}${tab ? `/${tab}` : ''}${sub ? `/${sub}` : ''}`;
const msgEl = () => el('p', { class: 'ws-inline-msg', role: 'status', 'aria-live': 'polite' });
const setMsg = (m, text, kind = '') => { m.textContent = text; m.dataset.kind = kind; };

/* ============================================================ entry */
async function discoveryWorkspacePage(ws, id, tab = '', sub = '') {
  const summary = ws.discoveries.find((x) => x.id === id);
  if (!summary) return { crumbs: [{ label: 'Discovery', href: '/app/discovery' }, { label: 'Not found' }], nodes: [pageHeader('Discovery not found'), empty('We couldn’t find that discovery', 'It may belong to a different workspace, or the link may be wrong.', linkBtn('/app/discovery', 'All discoveries'))] };
  const dw = await api(`/api/firm/discoveries/${id}/workspace`);
  const d = dw.discovery;
  const [sl, sv] = discoveryStatus(summary);
  const tabLabel = (TABS.find(([k]) => k === tab) || TABS[0])[1];
  const crumbs = [{ label: 'Discovery', href: '/app/discovery' }, { label: d.name, href: dUrl(id) }, ...(tab ? [{ label: tabLabel }] : [])];
  const head = el('div', { class: 'ds-page-header dw-head' },
    el('div', { class: 'ds-page-header__text' },
      el('h1', { class: 'ds-page-header__title' }, d.name),
      el('div', { class: 'ds-cluster' }, status(sl, sv), el('span', { class: 'ws-subtle' }, `${dw.firmName} · started ${fmtDate(d.createdAt)} · last updated ${fmtDateTime(d.updatedAt)}`))));
  const count = { evidence: dw.evidence.length, findings: dw.findings.length };
  const tabs = el('nav', { class: 'ws-tabs', 'aria-label': 'Discovery sections' }, ...TABS.map(([k, label]) =>
    el('a', { class: 'ws-tab', href: dUrl(id, k), 'aria-current': k === tab ? 'page' : null }, label, count[k] !== undefined ? el('span', { class: 'dw-count' }, String(count[k])) : null)));
  // journey, evidence and review were folded into Findings; old links still land somewhere useful.
  const views = { '': overviewTab, context: contextTab, interviews: interviewsTab, findings: findingsTab, journey: overviewTab, evidence: (w, x) => findingsTab(w, x, ''), review: (w, x) => findingsTab(w, x, '') };
  const view = views[tab];
  if (!view) return { crumbs, nodes: [head, tabs, empty('This section doesn’t exist', 'Use the tabs above.')] };
  return { crumbs, nodes: [head, tabs, ...(await view(ws, dw, sub))] };
}

/* ============================================================ A. overview */
function nextStep(dw, summary, ws) {
  const d = dw.discovery, id = d.id, c = dw.completion;
  if (!dw.profile) return ['Complete the firm context', 'Interviews are more useful when they know how your firm is set up.', dUrl(id, 'context'), 'Open firm context'];
  if (!dw.participants.length) return ['Invite people to interview', 'Include advisers, case managers and administrators, and yourself.', dUrl(id, 'interviews'), 'Invite participants'];
  if (c.interviews.completed === 0) return ['Wait for interviews to finish', `${c.interviews.completed} of ${c.interviews.invited} interviews finished. Share any links you haven’t sent yet.`, dUrl(id, 'interviews'), 'View interviews'];
  if (!d.analysedAt) return ['Analyse the interviews', 'Compare accounts across roles to produce findings, each linked to its evidence.', null, null];
  if (d.status === 'interviews') return ['Look through the findings', 'What the interviews found, with what people said behind each one. Correct anything that’s wrong, then move on.', dUrl(id, 'findings'), 'See the findings'];
  // From here on, the same step the workspace Overview recommends, so the two pages never disagree.
  const n = nextAction(ws, summary);
  return [n.title, n.text, n.href, n.label];
}

async function runAction(btn, m, label, fn) {
  btn.disabled = true; setMsg(m, `${label}…`);
  try { await fn(); } catch (err) { setMsg(m, err.message, 'error'); btn.disabled = false; }
}

function actionsBar(dw) {
  const id = dw.discovery.id, m = msgEl(), links = el('div', { class: 'ds-stack' });
  const hasCompleted = dw.completion.interviews.completed > 0;
  const analyse = el('button', { class: 'ds-btn ds-btn--primary', type: 'button', disabled: !hasCompleted, onclick: () => runAction(analyse, m, 'Analysing interviews', async () => {
    await api(`/api/firm/discoveries/${id}/analyse`, 'POST'); location.reload();
  }) }, dw.discovery.analysedAt ? 'Re-analyse interviews' : 'Analyse interviews');
  const follow = el('button', { class: 'ds-btn ds-btn--secondary', type: 'button', disabled: !dw.discovery.analysedAt, onclick: () => runAction(follow, m, 'Preparing follow-up questions', async () => {
    const r = await api(`/api/firm/discoveries/${id}/follow-ups`, 'POST');
    follow.disabled = false;
    if (!r.links.length) { setMsg(m, 'No follow-up questions are needed right now.', 'success'); return; }
    setMsg(m, `${plural(r.questions, 'follow-up question')} for ${plural(r.participants, 'person', 'people')}. Send each person their new link; their previous link no longer works.`, 'success');
    links.replaceChildren(...r.links.map((l) => linkBox(l.name, l.link)));
  }) }, 'Prepare follow-up questions');
  const help = el('button', { class: 'ds-btn ds-btn--ghost', type: 'button', onclick: () => runAction(help, m, 'Asking JADA to get in touch', async () => {
    await api(`/api/firm/discoveries/${id}/help`, 'POST', { note: 'Firm lead asked for help from the discovery workspace' });
    setMsg(m, 'A JADA contact has been asked to get in touch.', 'success'); help.disabled = false;
  }) }, 'Ask JADA for help');
  return el('div', { class: 'ds-stack' }, el('div', { class: 'ds-btn-group' }, analyse, follow, help),
    !hasCompleted ? el('p', { class: 'ds-help' }, 'Analysis becomes available once at least one interview has finished.') : null, m, links);
}

function overviewTab(ws, dw) {
  const d = dw.discovery, c = dw.completion, id = d.id;
  const summary = ws.discoveries.find((x) => x.id === id);
  const [title, text, href, label] = nextStep(dw, summary, ws);
  const complete = d.status === 'priorities_approved' || discoveryStatus(summary)[0] === 'Discovery complete';
  const steps = [
    ['Firm context', !!dw.profile, false, dw.profile ? 'Provided by the firm' : 'Not provided', dUrl(id, 'context')],
    ['Interviews', c.interviews.invited > 0 && c.interviews.completed >= c.interviews.invited, c.interviews.invited > 0, c.interviews.invited ? `${c.interviews.completed} of ${c.interviews.invited} finished` : 'Nobody invited yet', dUrl(id, 'interviews')],
    ['Analysis', !!d.analysedAt, c.interviews.completed > 0, d.analysedAt ? `Last analysed ${fmtDateTime(d.analysedAt)}` : 'Not analysed yet', null],
    ['Findings', ['review_ready', 'priorities_approved'].includes(d.status), !!d.analysedAt, d.analysedAt ? plural(c.findings.total, 'finding') : '—', dUrl(id, 'findings')],
    ['Opportunities', complete, ['review_ready', 'priorities_approved'].includes(d.status), d.status === 'priorities_approved' ? 'Priorities approved' : complete ? `${plural(summary.approved, 'opportunity', 'opportunities')} approved` : 'Approve your priorities', `/app/opportunities?d=${id}`],
  ];
  const outstanding = [
    ...!dw.profile ? [['Firm details not provided', dUrl(id, 'context')]] : [],
    ...!c.interviews.invited ? [['Nobody invited to an interview yet', dUrl(id, 'interviews')]] : [],
    ...dw.participants.filter((p) => p.status !== 'completed').length ? [[`${plural(dw.participants.filter((p) => p.status !== 'completed').length, 'interview')} not finished`, dUrl(id, 'interviews')]] : [],
  ];
  return [
    el('div', { class: 'ws-next' }, el('div', { class: 'ws-next__text' }, el('p', { class: 'ds-eyebrow' }, 'Recommended next action'), el('h2', { class: 'ws-next__title' }, title), el('p', { class: 'ds-muted ds-body-sm' }, text)),
      href ? linkBtn(href, label, 'primary') : null),
    d.analysedAt ? businessSnapshot(id) : null,
    el('div', { class: 'ws-section' }, actionsBar(dw)),
    el('div', { class: 'ws-grid-2' },
      section('Progress', null, el('ol', { class: 'ws-steps' }, ...steps.map(([t, done, active, detail, link], i) => {
        const state = done ? 'done' : active ? 'active' : 'todo';
        return el('li', { class: 'ws-step', 'data-state': state }, el('span', { class: 'ws-step__icon', 'aria-hidden': 'true' }, done ? '✓' : String(i + 1)),
          el('div', {}, link ? el('a', { class: 'ws-step__title', href: link }, t) : el('span', { class: 'ws-step__title' }, t), el('p', { class: 'ws-step__detail' }, detail)));
      }))),
      section('Outstanding', null, outstanding.length ? el('ul', { class: 'ws-list ws-attention' }, ...outstanding.map(([t, h]) => el('li', {}, el('a', { href: h }, t)))) : el('p', { class: 'ds-muted ds-body-sm' }, 'Nothing outstanding.'))),
    retentionPanel(dw),
  ];
}

// How long the interviews are kept (R3): counted from closing the discovery, or from 90 days after its last
// activity if it's never closed. At the end, everything people said is deleted; findings, figures and decisions stay.
function retentionPanel(dw) {
  const d = dw.discovery, months = dw.retentionMonths;
  const addMonths = (iso, m) => { const x = new Date(iso); x.setMonth(x.getMonth() + m); return x.toISOString(); };
  const withdrawn = d.withdrawals ? el('p', { class: 'ds-body-sm' }, `${plural(d.withdrawals, 'person', 'people')} withdrew their interview. What they said has been deleted everywhere.`) : null;
  let body;
  if (d.contentPurgedAt) {
    body = el('p', { class: 'ds-body-sm' }, `Interviews deleted on ${fmtDate(d.contentPurgedAt)}. The findings, figures and your decisions are kept, without anyone’s words or names.`);
  } else if (!months) {
    body = el('p', { class: 'ds-body-sm ds-muted' }, 'The retention period hasn’t been set for this installation yet, so nothing is deleted automatically.');
  } else if (d.closedAt) {
    body = el('p', { class: 'ds-body-sm' }, `Closed on ${fmtDate(d.closedAt)}. The interviews will be deleted on ${fmtDate(addMonths(d.closedAt, months))}, ${months} months later.`);
  } else {
    const msg = el('p', { class: 'ds-help', role: 'status' });
    const close = el('button', { class: 'ds-btn ds-btn--secondary', type: 'button' }, 'Close discovery');
    close.addEventListener('click', async () => {
      if (!confirm(`Close this discovery? The interviews will be deleted ${months} months from today. Findings, figures and your decisions are kept.`)) return;
      close.disabled = true;
      try { await api(`/api/firm/discoveries/${d.id}/close`, 'POST'); location.reload(); } catch (err) { msg.textContent = err.message; close.disabled = false; }
    });
    const fallback = new Date(d.lastActivityAt); fallback.setDate(fallback.getDate() + 90);
    body = el('div', { class: 'ds-stack' },
      el('p', { class: 'ds-body-sm' }, `When this discovery is finished, close it. The interviews are deleted ${months} months after that. If it’s never closed, they’re deleted ${months} months after 90 days with no activity (on ${fmtDate(addMonths(fallback.toISOString(), months))} as things stand).`),
      el('p', {}, close), msg);
  }
  return section('Keeping your information', el('span', { class: 'ws-subtle' }, 'What people told us, and for how long'), body, withdrawn);
}

/* ============================================================ B. firm context */
function contextTab(ws, dw) {
  const p = dw.profile, id = dw.discovery.id;
  const isLatest = ws.discoveries[0]?.id === id;
  const editNote = isLatest ? linkBtn('/app/profile', 'Edit firm details', 'secondary') : el('p', { class: 'ds-help' }, 'This is an earlier discovery. Its firm context is kept as it was; edits apply to your current discovery.');
  const provenance = el('p', { class: 'ds-body-sm ds-muted dw-provenance' }, 'Everything on this page is ', sourceBadge('firm_provided'), ': supplied by your firm in the firm profile. BuildA+ adds no researched or inferred information here.');
  if (!p) return [provenance, empty('No firm context yet', 'The firm profile hasn’t been completed for this discovery.', isLatest ? linkBtn('/app/profile', 'Complete firm details', 'primary') : null, 'profile')];
  const roleCount = (r) => (p.staffRoles || []).find((x) => x.role === r)?.count;
  const label = (list, v) => (list.find(([k]) => k === v) || [v, v])[1];
  const row = (k, v) => [el('dt', {}, k), el('dd', {}, v === undefined || v === null || v === '' ? el('span', { class: 'ws-subtle' }, 'Not provided') : v)];
  const card = (title, ...rows) => el('section', { class: 'ds-card dw-card' }, el('div', { class: 'ds-card__body' }, el('h2', { class: 'ds-h4' }, title), el('dl', { class: 'ds-meta' }, ...rows.flat())));
  const tech = p.technology || [];
  return [provenance,
    el('div', { class: 'dw-cards' },
      card('Business model', row('Authorisation', label(AUTHORISATION, p.authorisation)), row('Operating model', p.operatingModel ? label(OPERATING_MODELS, p.operatingModel) : null),
        row('How the firm is set up', p.businessStructure), row('Location', p.location), row('Website', p.website)),
      card('Team structure', row('Mortgage advisers', p.advisers), row('Case managers', roleCount('case_manager')), row('Administrators', roleCount('administrator'))),
      card('Business focus and volumes', row('Focus', (p.businessFocus || []).length ? p.businessFocus.map((f) => label(BUSINESS_FOCUS, f)).join(', ') : null),
        row('Applications a month', p.monthlyApplications === null ? null : `${num(p.monthlyApplications)} (about ${num(p.monthlyApplications * 12)} a year)`),
        row('Weeks from enquiry to offer', p.typicalWeeksEnquiryToOffer)),
      card('Operational context', row('What slows things down', p.operationalChallenges), row('Hourly cost used for values', p.loadedHourlyCostGBP ? `£${p.loadedHourlyCostGBP}` : null))),
    section('Technology environment', isLatest ? linkBtn('/app/profile/technology', 'Edit inventory', 'ghost', { class: 'ds-btn ds-btn--ghost ds-btn--sm' }) : null,
      tech.length ? el('div', { class: 'ds-table-wrap' }, el('table', { class: 'ds-table' },
        el('thead', {}, el('tr', {}, ...['System', 'Category', 'Used for', 'Teams'].map((h) => el('th', { scope: 'col' }, h)))),
        el('tbody', {}, ...tech.map((t) => el('tr', {}, el('th', { scope: 'row' }, t.name), el('td', {}, label(TECH_CATEGORIES, t.category)), el('td', {}, t.purpose || '—'),
          el('td', {}, (t.teams || []).map((x) => label(TECH_TEAMS, x)).join(', ') || '—'))))))
        : (p.systems || []).length ? el('p', { class: 'ds-body-sm' }, `Systems listed: ${p.systems.join(', ')}.`) : el('p', { class: 'ds-muted ds-body-sm' }, 'No technology recorded.')),
    el('div', { class: 'ws-section' }, editNote)];
}

/* ============================================================ C. interviews */
function interviewsTab(ws, dw) {
  const id = dw.discovery.id, links = el('div', {});
  const roleChips = el('ul', { class: 'dw-roles' }, ...dw.roles.map((r) => el('li', { class: `dw-role${r.completed ? ' is-done' : r.invited ? ' is-active' : ''}` },
    el('span', { class: 'dw-role__label' }, r.label), el('span', { class: 'ws-subtle' }, r.invited ? `${r.completed} of ${r.invited} finished` : 'Not invited'))));
  const people = dw.participants.length ? el('div', { class: 'ds-table-wrap' }, el('table', { class: 'ds-table' },
    el('thead', {}, el('tr', {}, ...['Name', 'Role', 'Interview', 'Consent', 'Follow-up'].map((h) => el('th', { scope: 'col' }, h)), el('th', { scope: 'col' }, el('span', { class: 'ds-visually-hidden' }, 'Actions')))),
    el('tbody', {}, ...dw.participants.map((p) => {
      const [l, v] = PERSON_STATUS[p.status] || [p.status, 'neutral'];
      const m = el('span', { class: 'ws-inline-msg', role: 'status' });
      return el('tr', {}, el('th', { scope: 'row' }, p.name), el('td', {}, p.roleLabel), el('td', {}, status(l, v)),
        el('td', {}, p.consented ? 'Given' : el('span', { class: 'ws-subtle' }, 'Not yet')),
        el('td', {}, p.followUps ? `${plural(p.followUps, 'question')}${p.followUpOpen ? ', not answered yet' : ''}` : el('span', { class: 'ws-subtle' }, '—')),
        el('td', {}, p.status === 'completed' && !p.followUpOpen ? null : el('div', { class: 'ws-table-actions' }, m, el('button', { class: 'ds-btn ds-btn--ghost ds-btn--sm', type: 'button', onclick: async () => {
          try { const r = await api(`/api/firm/discoveries/${id}/participants/${p.id}/link`, 'POST'); links.replaceChildren(linkBox(p.name, r.link)); links.scrollIntoView({ block: 'nearest' }); }
          catch (err) { setMsg(m, err.message, 'error'); }
        } }, 'Make a new link'))));
    })))) : empty('Nobody invited yet', 'Include two or three senior advisers and at least one case manager or administrator. Add yourself too; your view is compared with your team’s.', null, 'account');

  const name = el('input', { class: 'ds-input', name: 'name', maxlength: '200', autocomplete: 'off' });
  const role = el('select', { class: 'ds-select', name: 'role' }, ...Object.entries(ROLES).map(([v, l]) => el('option', { value: v }, v === 'other' ? 'Other, including operations managers' : l)));
  const addMsg = msgEl();
  const addBtn = el('button', { class: 'ds-btn ds-btn--primary', type: 'submit' }, 'Add and get their link');
  const form = el('form', { class: 'ws-fieldset', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const who = name.value.trim(); setFieldError(name, who ? '' : 'Enter their name.');
    if (!who) { name.focus(); return; }
    addBtn.disabled = true; setMsg(addMsg, 'Adding…');
    try {
      const r = await api(`/api/firm/discoveries/${id}/participants`, 'POST', { name: who, role: role.value });
      sessionStorage.setItem('ws-new-link', JSON.stringify({ id, name: who, link: r.link })); location.reload();
    } catch (err) { setMsg(addMsg, err.message, 'error'); addBtn.disabled = false; }
  } }, el('legend', {}, 'Add a person to interview'),
    el('div', { class: 'ds-form-grid' }, field('Name', name, { help: 'Shown to you only. Their name is never sent to the AI.' }), field('Role', role)),
    el('div', { class: 'ds-cluster' }, addBtn, addMsg));
  try { const saved = JSON.parse(sessionStorage.getItem('ws-new-link') || 'null'); if (saved && saved.id === id) links.replaceChildren(linkBox(saved.name, saved.link)); sessionStorage.removeItem('ws-new-link'); } catch { /* storage unavailable */ }

  return [
    nextBar(dw, 'interviews'),
    el('p', { class: 'ds-body-sm ds-muted dw-intro' }, 'Each person has an independent conversation with the AI interviewer, about the work they actually do: how cases move, where they wait, what gets handed over, the exceptions and the workarounds. No facilitator is needed, and everyone can pause and come back. Findings are shown to you by role, not by person.'),
    section('Roles taking part', null, roleChips),
    section('People', el('span', { class: 'ws-subtle' }, plural(dw.participants.length, 'person', 'people')), people, links),
    el('div', { class: 'ws-section' }, form),
    section('Missing information', null, el('p', { class: 'ds-body-sm ds-muted' }, 'After analysis, BuildA+ can write short follow-up questions to the people whose figures differ or are missing. They answer through a new link.'), actionsBar(dw)),
  ];
}

// The one button that moves the discovery on: Interviews -> Findings -> Opportunities.
function nextBar(dw, from) {
  const d = dw.discovery, id = d.id, m = msgEl();
  const box = (title, text, action) => el('div', { class: 'ws-next dw-nextbar' }, el('div', { class: 'ws-next__text' }, el('p', { class: 'ds-eyebrow' }, 'Next step'), el('h2', { class: 'ws-next__title' }, title), el('p', { class: 'ds-muted ds-body-sm' }, text), m), action);
  if (from === 'interviews') {
    if (!dw.completion.interviews.completed) return null;
    if (!d.analysedAt) {
      const go = el('button', { class: 'ds-btn ds-btn--primary', type: 'button', onclick: () => runAction(go, m, 'Analysing the interviews, this takes a few minutes', async () => {
        await api(`/api/firm/discoveries/${id}/analyse`, 'POST'); location.href = dUrl(id, 'findings');
      }) }, 'Analyse and see findings');
      return box('Turn the interviews into findings', `${plural(dw.completion.interviews.completed, 'interview')} finished. You can analyse now, and again later as more come in.`, go);
    }
    return box('See what the interviews found', 'Findings are up to date with the last analysis. Re-analyse from the overview after more interviews finish.', linkBtn(dUrl(id, 'findings'), 'Next: findings', 'primary'));
  }
  // From findings: moving on records that the firm lead has looked through them (no separate review step).
  const go = el('button', { class: 'ds-btn ds-btn--primary', type: 'button', onclick: () => runAction(go, m, 'Opening opportunities', async () => {
    if (d.status === 'interviews') await api(`/api/firm/discoveries/${id}/complete`, 'POST', { note: '' });
    location.href = `/app/opportunities?d=${id}`;
  }) }, 'Next: approve priorities');
  return box('Decide what to take forward', 'Each finding becomes an opportunity, ranked by fixed rules. Approving one is how you confirm it.', go);
}

/* ============================================================ D. journey */
function journeyTab(ws, dw) {
  const id = dw.discovery.id;
  const byId = new Map(dw.findings.map((f) => [f.id, f]));
  const stageRow = (s, i) => el('li', { class: `dw-stage${s.findings.length ? ' has-findings' : ''}` },
    el('span', { class: `dw-stage__n${s.regulatedJudgement ? ' is-regulated' : ''}`, 'aria-hidden': 'true' }, s.parallel ? 'P' : String(i + 1)),
    el('div', { class: 'dw-stage__body' },
      el('div', { class: 'dw-stage__top' }, el('h3', { class: 'ds-h4' }, s.name),
        s.regulatedJudgement ? el('span', { class: 'ws-chip' }, 'Adviser judgement: preparation only') : null,
        s.explored ? status(s.evidence ? 'Evidence collected' : 'Discussed, nothing reported', s.evidence ? 'success' : 'neutral') : status('Not yet explored', 'neutral')),
      el('p', { class: 'ws-subtle' }, [s.evidence ? plural(s.evidence, 'evidence item') : null, s.openQuestions ? plural(s.openQuestions, 'open question') : null,
        s.notInvolved ? `${plural(s.notInvolved, 'person', 'people')} said they don’t work on this stage` : null].filter(Boolean).join(' · ') || 'No evidence yet'),
      s.findings.length ? el('div', { class: 'ws-chips' }, ...s.findings.map((fid) => el('a', { class: 'dw-finding-chip', href: dUrl(id, 'findings', fid) }, byId.get(fid)?.title || 'Finding'))) : null,
      s.hypotheses.length ? el('div', { class: 'dw-hypotheses' }, sourceBadge('industry_knowledge'), el('span', { class: 'ws-subtle' }, ' Common in mortgage firms, not observed at yours: '),
        s.hypotheses.map((h) => h.title).join('; ')) : null));
  const main = dw.stages.filter((s) => !s.parallel), parallel = dw.stages.filter((s) => s.parallel);
  return [
    el('p', { class: 'ds-body-sm ds-muted dw-intro' }, 'A reference mortgage journey, used to organise what your team described. Your firm may name, combine or order stages differently. Industry patterns appear only as hypotheses: they aren’t evidence that your firm has the problem.'),
    el('ol', { class: 'dw-journey' }, ...main.map(stageRow)),
    section('Parallel journey', null, el('p', { class: 'ds-body-sm ds-muted' }, 'Protection advice is a separate advised sale, usually alongside the recommendation.'), el('ol', { class: 'dw-journey' }, ...parallel.map((s) => stageRow(s, 0)))),
  ];
}

/* ============================================================ evidence */
function evidenceDetail(dw, e) {
  const id = dw.discovery.id;
  const finding = dw.findings.find((f) => f.id === e.findingId);
  const reason = el('textarea', { class: 'ds-textarea', name: 'reason', maxlength: '1000', rows: '2' });
  const m = msgEl();
  const submit = async (statusValue) => {
    if (statusValue === 'disputed' && reason.value.trim().length < 3) { setFieldError(reason, 'Say why this evidence is disputed.'); reason.focus(); return; }
    setFieldError(reason, ''); setMsg(m, 'Saving…');
    try { await api(`/api/firm/discoveries/${id}/evidence/${e.id}/review`, 'POST', { status: statusValue, reason: reason.value.trim() }); location.reload(); }
    catch (err) { setMsg(m, err.message, 'error'); }
  };
  const figures = [e.monthlyVolume !== null ? `${num(e.monthlyVolume)} a month` : null, e.minutesPerOccurrence !== null ? `${num(e.minutesPerOccurrence)} minutes each time` : null].filter(Boolean);
  const row = (k, v) => (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) ? [] : [el('dt', {}, k), el('dd', {}, v)]);
  return el('div', { class: 'dw-evidence__detail' },
    el('dl', { class: 'ds-meta' },
      ...row('Observed', e.observed), ...row('Source', el('span', {}, sourceBadge(e.source), ` · ${e.origin}`)), ...row('Stage', e.stageName), ...row('Role', e.role),
      ...row('Finding', finding ? el('a', { href: dUrl(id, 'findings', finding.id) }, finding.title) : el('span', { class: 'ws-subtle' }, 'Not linked to a finding')),
      ...row('Finding confidence', finding ? el('span', {}, confidence(finding.dimensions.existence.level), el('span', { class: 'ws-subtle' }, ' that the problem exists here, from all its evidence')) : null),
      ...row('Figures as stated', figures.join(' · ')), ...row('Conversions', e.conversionAssumptions.join('; ')),
      ...row('Systems', e.systems.join(', ')), ...row('Reported cause', e.reportedCause), ...row('Suggested improvement', e.potentialImprovement),
      ...row('Open questions', e.outstandingQuestions.length ? el('ul', {}, ...e.outstandingQuestions.map((q) => el('li', {}, q))) : null),
      ...row('Collected', fmtDateTime(e.collectedAt)),
      ...row('Review', el('span', {}, reviewStatus(e.review), e.review.reason ? el('span', { class: 'ws-subtle' }, ` — ${e.review.reason}`) : null))),
    e.quote ? el('blockquote', { class: 'dw-quote' }, `“${e.quote}”`) : e.quoteWithheld ? el('p', { class: 'ds-help' }, 'The exact words are withheld because fewer than three people in this role took part, so a quote could identify someone. The observation above is what was extracted from it.') : null,
    el('div', { class: 'dw-review' },
      el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: `r-${e.id}` }, 'Reason', el('span', { class: 'ds-optional' }, ' (required to dispute)')), (reason.id = `r-${e.id}`, reason), el('p', { class: 'ds-error', id: `r-${e.id}-err`, hidden: true })),
      el('div', { class: 'ds-cluster' },
        el('button', { class: 'ds-btn ds-btn--secondary ds-btn--sm', type: 'button', onclick: () => submit('validated') }, 'Mark validated'),
        el('button', { class: 'ds-btn ds-btn--secondary ds-btn--sm', type: 'button', onclick: () => submit('disputed') }, 'Dispute'),
        e.review.status !== 'unreviewed' ? el('button', { class: 'ds-btn ds-btn--ghost ds-btn--sm', type: 'button', onclick: () => submit('unreviewed') }, 'Clear review') : null, m),
      el('p', { class: 'ds-help' }, 'Validating records that you agree; it doesn’t raise confidence. Disputed evidence is left out of confidence now and out of the next analysis. Both are kept in the history.')));
}

function evidenceList(dw, items, openId) {
  return el('div', { class: 'dw-evidence' }, ...items.map((e) => {
    const det = el('details', { class: 'dw-evidence__item', id: `ev-${e.id}`, open: e.id === openId },
      el('summary', {}, el('span', { class: 'dw-evidence__obs' }, e.observed),
        el('span', { class: 'dw-evidence__meta' }, sourceBadge(e.source), el('span', { class: 'ws-subtle' }, `${e.role} · ${e.stageName}`), reviewStatus(e.review))));
    det.addEventListener('toggle', () => { if (det.open && !det.querySelector('.dw-evidence__detail')) det.append(evidenceDetail(dw, e)); }, { once: false });
    if (det.open) det.append(evidenceDetail(dw, e));
    return det;
  }));
}

function evidenceTab(ws, dw, openId) {
  const id = dw.discovery.id;
  if (!dw.evidence.length) return [empty('No evidence yet', dw.completion.interviews.completed ? 'Interviews have finished. Evidence appears here once they’re analysed.' : 'Evidence comes from your team’s interviews as they’re completed.', null, 'evidence')];
  const q = new URLSearchParams(location.search);
  const filters = { source: q.get('source') || '', stage: q.get('stage') || '', review: q.get('review') || '' };
  const items = dw.evidence.filter((e) => (!filters.source || e.source === filters.source) && (!filters.stage || e.stageId === filters.stage) && (!filters.review || e.review.status === filters.review));
  const counts = Object.keys(SOURCE_LABEL).map((s) => [s, dw.evidence.filter((e) => e.source === s).length]);
  const select = (name, label, options) => el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: `f-${name}` }, label),
    el('select', { class: 'ds-select', id: `f-${name}`, onchange: (ev) => { const p = new URLSearchParams(location.search); if (ev.target.value) p.set(name, ev.target.value); else p.delete(name); location.search = p.toString(); } },
      el('option', { value: '' }, 'All'), ...options.map(([v, l]) => el('option', { value: v, selected: filters[name] === v }, l))));
  return [
    el('div', { class: 'dw-legend' },
      el('p', { class: 'ds-body-sm' }, el('strong', {}, 'Source'), ' says where information came from. ', el('strong', {}, 'Confidence'), ' says how well all the evidence supports a claim, so it belongs to findings, not to single items.'),
      el('ul', { class: 'ws-chips' }, ...counts.map(([s, n]) => el('li', {}, sourceBadge(s),
        s === 'firm_provided' ? el('a', { class: 'ws-subtle', href: dUrl(id, 'context') }, ' in Firm context') : el('span', { class: 'ws-subtle' }, ` ${n}`))))),
    el('div', { class: 'ws-select-row' },
      select('source', 'Source', counts.filter(([, n]) => n).map(([s]) => [s, SOURCE_LABEL[s][1]])),
      select('stage', 'Stage', dw.stages.filter((s) => dw.evidence.some((e) => e.stageId === s.id)).map((s) => [s.id, s.name])),
      select('review', 'Review', Object.entries(REVIEW).map(([k, [l]]) => [k, l]))),
    el('p', { class: 'ws-subtle' }, `Showing ${items.length} of ${plural(dw.evidence.length, 'evidence item')}. Firm-provided information is under Firm context. No public-record or measured evidence has been collected in this discovery.`),
    items.length ? evidenceList(dw, items, openId) : empty('Nothing matches these filters', 'Change or clear the filters above.', null, 'evidence'),
  ];
}

/* ============================================================ findings */
function findingsTab(ws, dw, fid) {
  if (fid) return findingDetail(dw, fid);
  const id = dw.discovery.id;
  if (!dw.findings.length) return [empty('No findings yet', dw.discovery.analysedAt ? 'The analysis didn’t produce findings. Follow-up questions or more participants may help.' : 'Findings appear once the interviews are analysed.', !dw.discovery.analysedAt && dw.completion.interviews.completed ? linkBtn(dUrl(id), 'Go to analysis', 'primary') : null, 'opportunities')];
  const cr = dw.crossRole;
  const titleOf = (key) => (dw.findings.find((f) => f.key === key) || { title: key }).title;
  const sized = dw.findings.filter((f) => f.classification !== 'keep_human' && f.impact && f.impact.monthlyHoursSpent !== null);
  const lost = sized.reduce((n, f) => n + f.impact.monthlyHoursSpent, 0);
  const stat = (label, value, note) => el('div', { class: 'ws-stat' }, el('dt', { class: 'ws-stat__label' }, label), el('dd', { class: 'ws-stat__value' }, value), note ? el('dd', { class: 'ws-subtle dw-stat__note' }, note) : null);
  const named = (label, keys, none) => el('div', { class: 'dw-cross__item' }, el('h3', { class: 'ds-h4' }, label),
    keys.length ? el('ul', { class: 'ds-body-sm' }, ...keys.map((k) => el('li', {}, titleOf(k)))) : el('p', { class: 'ds-muted ds-body-sm' }, none));
  return [
    el('dl', { class: 'ws-stats dw-stats' },
      stat('Problems found', String(dw.findings.length), null),
      stat('Staff time lost a month', sized.length ? `${num(lost)} hours` : 'Not known yet', sized.length ? `from the ${sized.length} of ${dw.findings.length} with figures` : 'No figures given yet'),
      stat('Described by more than one person', cr ? String(cr.agreements.length) : '—', 'the strongest evidence'),
      stat('Raised by your team, not by you', cr && cr.firmLeadInterviewed ? String(cr.blindSpots.length) : '—', cr && cr.firmLeadInterviewed ? 'things you might not see day to day' : 'Do your own interview to see this')),
    cr ? el('div', { class: 'ws-grid-2 dw-cross' },
      named('Your team raised these, you didn’t', cr.firmLeadInterviewed ? cr.blindSpots : [], cr.firmLeadInterviewed ? 'None: you raised everything your team did.' : 'Do your own interview to see what your team raised that you didn’t.'),
      named('People describe these differently', cr.disagreements, 'None: where people described the same problem, their accounts matched.')) : null,
    nextBar(dw, 'findings'),
    el('div', { class: 'ws-findings ws-section' }, ...dw.findings.slice().sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)).map((f) => {
      const im = f.impact || {};
      const cost = im.monthlyHoursSpent === null || im.monthlyHoursSpent === undefined
        ? el('p', { class: 'dw-cost dw-cost--none' }, 'Staff time not known yet: nobody has said how often it happens and how long it takes.')
        : el('p', { class: 'dw-cost' }, el('strong', {}, `${num(im.monthlyHoursSpent)} staff hours a month`),
          im.monthlyHoursRecovered !== null && im.monthlyHoursRecovered !== undefined ? ` · about ${num(im.monthlyHoursRecovered)} could be freed up` : ' · how much could be saved not estimated yet',
          im.monthlyCapacityValueGBP ? el('span', { class: 'ws-subtle' }, ` (≈ £${Number(im.monthlyCapacityValueGBP * 12).toLocaleString('en-GB')} a year in staff time)`) : null);
      return el('article', { class: 'ds-card ws-finding' },
        el('div', { class: 'ws-finding__top' }, el('h3', { class: 'ws-finding__title' }, el('a', { href: dUrl(id, 'findings', f.id) }, f.title)),
          el('div', { class: 'ds-cluster' }, classification(f.classification))),
        el('p', { class: 'ws-subtle' }, `${f.stageName} · described by ${f.participantCount === 1 ? 'one person' : `${f.participantCount} people`}${f.roles.length ? ` (${f.roles.join(', ')})` : ''}${f.disputedEvidence ? ` · ${f.disputedEvidence} disputed` : ''}${f.disagreements.length ? ' · people describe it differently' : ''}`),
        cost,
        el('p', { class: 'ws-subtle dw-dims__label' }, 'How sure we are'),
        el('div', { class: 'dw-dims' }, ...['existence', 'volume', 'effort', 'impact'].map((k) => el('div', { class: 'dw-dim' }, el('span', { class: 'ws-subtle' }, DIMENSION_LABEL[k]), confidence(f.dimensions[k].level)))));
    }))];
}

// What people said behind a finding: read-only, by role (quotes withheld where a role has fewer than three people).
function evidenceQuotes(items) {
  return el('ul', { class: 'ws-list dw-quotes' }, ...items.map((e) => el('li', {},
    el('p', { class: 'ds-body-sm' }, e.observed), e.quote ? el('blockquote', { class: 'dw-quote' }, `“${e.quote}”`) : null,
    el('p', { class: 'ws-subtle' }, `${e.role} · ${e.stageName}`))));
}

function findingDetail(dw, fid) {
  const id = dw.discovery.id;
  const f = dw.findings.find((x) => x.id === fid);
  if (!f) return [empty('Finding not found', 'It may have been merged into another finding when the interviews were re-analysed.', linkBtn(dUrl(id, 'findings'), 'All findings'), 'opportunities')];
  const items = dw.evidence.filter((e) => e.findingId === f.id);
  const supporting = items.filter((e) => e.review.status !== 'disputed'), disputed = items.filter((e) => e.review.status === 'disputed');
  const figure = (label, est, override) => el('div', { class: 'dw-figure' }, el('span', { class: 'ws-subtle' }, label),
    override !== undefined && override !== null ? el('span', {}, el('strong', {}, num(override)), el('span', { class: 'ws-subtle' }, ' entered by you')) :
      est && est.value !== null && est.value !== undefined ? el('span', {}, el('strong', {}, num(est.value)), el('span', { class: 'ws-subtle' }, est.n > 1 ? (est.min === est.max ? (est.n === 2 ? ' both people said the same' : ` all ${est.n} people said the same`) : ` middle of ${est.n} people’s answers (${num(est.min)}–${num(est.max)})`) : ' one person’s answer')) : el('strong', {}, 'Not given yet'));
  const sources = [...new Set(items.map((e) => e.source))];
  return [
    el('p', {}, el('a', { href: dUrl(id, 'findings') }, '← All findings')),
    el('div', { class: 'dw-finding-head' },
      el('h2', { class: 'ds-h2' }, f.title),
      el('div', { class: 'ds-cluster' }, el('span', { class: 'ws-chip' }, f.stageName), classification(f.classification),
        f.requiresComplianceReview ? el('span', { class: 'ds-badge dw-badge-warn' }, 'Needs compliance review') : null)),
    el('div', { class: 'ws-grid-2' },
      el('div', {},
        section('What was described', null, el('div', { class: 'ds-stack ds-body-sm' },
          el('p', {}, `Described by ${plural(f.participantCount, 'person', 'people')}: ${f.roles.join(', ') || '—'}.`),
          f.causes.length ? el('p', {}, el('strong', {}, 'Causes mentioned: '), f.causes.join('; ')) : null,
          f.improvements.length ? el('p', {}, el('strong', {}, 'Improvements suggested: '), f.improvements.join('; ')) : null,
          el('p', {}, el('strong', {}, 'Suggested approach: '), f.classification ? `${CLASSIFICATION[f.classification][1]} (${(CLASSIFICATION_SOURCE[f.classificationSource] || 'source not recorded').toLowerCase()}).` : 'Not yet decided.',
            f.classificationRationale ? ` ${f.classificationRationale}` : ''))),
        section('What it costs your firm', null, el('div', { class: 'dw-figures' },
          figure('Times a month', f.volume, f.overrides.monthlyVolume), figure('Minutes each time', f.minutes, f.overrides.minutesPerOccurrence),
          el('div', { class: 'dw-figure' }, el('span', { class: 'ws-subtle' }, 'Staff hours a month'), el('strong', {}, f.impact && f.impact.monthlyHoursSpent !== null ? num(f.impact.monthlyHoursSpent) : 'Not known yet')),
          el('div', { class: 'dw-figure' }, el('span', { class: 'ws-subtle' }, 'Hours that could be freed up'), el('strong', {}, f.impact && f.impact.monthlyHoursRecovered !== null ? num(f.impact.monthlyHoursRecovered) : 'Not estimated yet'),
            f.impact && f.impact.monthlyCapacityValueGBP ? el('span', { class: 'ws-subtle' }, `≈ £${Number(f.impact.monthlyCapacityValueGBP * 12).toLocaleString('en-GB')} a year in staff time, not money saved`) : null)),
          f.assumptions.length ? el('ul', { class: 'ds-body-sm dw-assumptions' }, ...f.assumptions.map((a) => el('li', {}, sourceBadge(/supplied by the firm|by the firm lead|set by the firm lead/i.test(a) ? 'firm_provided' : 'assumption'), ' ', a))) : null),
        f.disagreements.length ? section('People see it differently', null, el('div', { class: 'ds-alert ds-alert--warning' },
          el('p', { class: 'ds-alert__title' }, 'Their answers differ'),
          ...f.disagreements.map((dg) => el('p', {}, `${dg.field === 'minutesPerOccurrence' ? 'Minutes each time' : 'Times a month'}: ${dg.values.map((v) => `${v.role} ${num(v.value)}`).join(' · ')}`)),
          el('p', {}, 'This often means the work varies by case type or role. Both answers are kept side by side, not averaged or treated as mistakes.'))) : null,
        section('What people said', el('span', { class: 'ds-cluster' }, ...sources.map(sourceBadge)), supporting.length ? evidenceQuotes(supporting) : el('p', { class: 'ds-muted ds-body-sm' }, 'Nothing anyone said supports this finding.'))),
      el('div', {},
        // Optional, and only if something is wrong: approving the opportunity is how a finding is confirmed.
        el('details', { class: 'ws-fieldset dw-fix' }, el('summary', {}, 'Something wrong? Correct it'),
          el('p', { class: 'ds-help' }, 'Only if this doesn’t match how your firm works. Your correction and reason are recorded.'), correctionForm(dw, f)),
        f.history.length ? section('Your changes', null, el('ul', { class: 'ws-list dw-history' }, ...f.history.map((h) => el('li', { class: 'dw-history__item' },
          el('span', {}, el('strong', {}, h.label), h.field === 'clarification' ? `: ${h.newValue}` : `: ${fmtVal(h.oldValue)} → ${fmtVal(h.newValue)}`, h.reason ? el('span', { class: 'ws-subtle' }, ` — ${h.reason}`) : null),
          el('time', { datetime: h.at }, fmtDateTime(h.at)))))) : null)),
    nextBar(dw, 'findings'),
  ];
}
const fmtVal = (v) => (v === null || v === undefined ? '—' : typeof v === 'object' && v.decision ? String(v.decision).replace(/_/g, ' ') : typeof v === 'boolean' ? (v ? 'yes' : 'no') : typeof v === 'number' ? num(v) : String(v).replace(/_/g, ' '));

function correctionForm(dw, f) {
  const id = dw.discovery.id;
  const fieldSel = el('select', { class: 'ds-select', name: 'field' }, ...[
    ['classification', 'Approach'], ['monthlyVolume', 'Times a month'], ['minutesPerOccurrence', 'Minutes each time'],
    ['reductionPct', 'Share of time that could be saved (%)'], ['title', 'Title'], ['stageId', 'Stage'], ['clarification', 'Add a clarification'],
  ].map(([v, l]) => el('option', { value: v }, l)));
  const holder = el('div', {});
  const reason = el('textarea', { class: 'ds-textarea', name: 'reason', maxlength: '1000', rows: '2' });
  const m = msgEl();
  let valueInput;
  const renderValue = () => {
    const k = fieldSel.value;
    if (k === 'validated') valueInput = el('select', { class: 'ds-select' }, el('option', { value: 'true', selected: !f.validated }, 'Confirm: this matches how we work'), el('option', { value: 'false', selected: f.validated }, 'Not confirmed'));
    else if (k === 'classification') valueInput = el('select', { class: 'ds-select' }, ...Object.entries(CLASSIFICATION).map(([v, [, l]]) => el('option', { value: v, selected: f.classification === v }, l)));
    else if (k === 'stageId') valueInput = el('select', { class: 'ds-select' }, ...dw.stages.map((s) => el('option', { value: s.id, selected: f.stageId === s.id }, s.name)));
    else if (k === 'clarification') valueInput = el('textarea', { class: 'ds-textarea', maxlength: '2000', rows: '3' });
    else if (k === 'title') valueInput = el('input', { class: 'ds-input', maxlength: '300', value: f.title });
    else valueInput = el('input', { class: 'ds-input', type: 'number', min: '0', step: 'any', placeholder: 'Leave blank to clear your correction' });
    holder.replaceChildren(field(k === 'clarification' ? 'Clarification' : 'New value', valueInput, k === 'reductionPct' ? { help: 'Between 0 and 100.' } : {}));
  };
  fieldSel.addEventListener('change', renderValue); renderValue();
  const submit = el('button', { class: 'ds-btn ds-btn--primary', type: 'submit' }, 'Save');
  return el('form', { class: 'ws-fieldset', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const k = fieldSel.value; let v = valueInput.value.trim(); let bad = '';
    if (k === 'validated') v = v === 'true';
    else if (['monthlyVolume', 'minutesPerOccurrence', 'reductionPct'].includes(k)) {
      if (v === '') v = null; else { const n = Number(v); if (!Number.isFinite(n) || n < 0 || (k === 'reductionPct' && n > 100)) bad = k === 'reductionPct' ? 'Enter a percentage between 0 and 100.' : 'Enter a number of 0 or more.'; v = k === 'reductionPct' ? n / 100 : n; }
    } else if ((k === 'clarification' || k === 'title') && v.length < 3) bad = 'Enter at least three characters.';
    setFieldError(valueInput, bad);
    const r = reason.value.trim();
    const needsReason = k !== 'validated' && k !== 'clarification';
    setFieldError(reason, needsReason && r.length < 3 ? 'Say why you’re making this correction.' : '');
    if (bad || (needsReason && r.length < 3)) return;
    submit.disabled = true; setMsg(m, 'Saving…');
    try { await api(`/api/firm/discoveries/${id}/pain-points/${f.id}/corrections`, 'POST', { field: k, value: v, reason: r || (k === 'validated' ? (v ? 'Confirmed' : 'Not confirmed') : 'Clarification') }); location.reload(); }
    catch (err) { setMsg(m, err.message, 'error'); submit.disabled = false; }
  } },
    el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: `c-${f.id}` }, 'What to change'), (fieldSel.id = `c-${f.id}`, fieldSel)),
    holder, field('Reason', reason, { help: 'Saved with your correction.' }),
    el('div', { class: 'ds-cluster' }, submit, m));
}

/* ============================================================ review / completion */
function reviewTab(ws, dw) {
  const d = dw.discovery, c = dw.completion, id = d.id;
  const check = (ok, title, detail, link) => el('li', { class: 'ws-step', 'data-state': ok ? 'done' : 'active' },
    el('span', { class: 'ws-step__icon', 'aria-hidden': 'true' }, ok ? '✓' : '!'),
    el('div', {}, link ? el('a', { class: 'ws-step__title', href: link }, title) : el('span', { class: 'ws-step__title' }, title), el('p', { class: 'ws-step__detail' }, detail)));
  const rolesDone = dw.roles.filter((r) => r.completed > 0).map((r) => r.label);
  const unexplored = dw.stages.filter((s) => !s.parallel && !s.explored).map((s) => s.name);
  const note = el('textarea', { class: 'ds-textarea', maxlength: '2000', rows: '3' });
  const m = msgEl();
  const done = d.status === 'review_ready' || d.status === 'priorities_approved';
  const btn = el('button', { class: 'ds-btn ds-btn--primary', type: 'button', disabled: !c.canComplete, onclick: () => runAction(btn, m, 'Saving', async () => {
    await api(`/api/firm/discoveries/${id}/complete`, 'POST', { note: note.value.trim() }); location.reload();
  }) }, done ? 'Record the review again' : 'Mark ready for opportunity review');
  return [
    el('p', { class: 'ds-body-sm ds-muted dw-intro' }, 'Before moving on, check what the discovery covered and what remains uncertain. A discovery can be complete with open questions: they’re recorded, not hidden, and nothing is marked verified to get here.'),
    el('ol', { class: 'ws-steps' },
      check(rolesDone.length >= 2, 'Roles that took part', rolesDone.length ? rolesDone.join(', ') : 'Nobody has finished an interview yet', dUrl(id, 'interviews')),
      check(c.stagesExplored === c.stagesTotal, 'Stages explored', `${c.stagesExplored} of ${c.stagesTotal}${unexplored.length ? `. Not yet: ${unexplored.join(', ')}` : ''}`, dUrl(id, 'journey')),
      check(c.findings.total > 0 && c.findings.withEvidence === c.findings.total, 'Findings with supporting evidence', `${c.findings.withEvidence} of ${plural(c.findings.total, 'finding')}`, dUrl(id, 'findings')),
      check(c.findings.needValidation === 0, 'Findings needing validation', c.findings.needValidation ? `${plural(c.findings.needValidation, 'finding')} not yet confirmed by you` : 'All confirmed', dUrl(id, 'findings')),
      check(c.findings.weakExistence === 0, 'Findings resting on one account or less', c.findings.weakExistence ? `${plural(c.findings.weakExistence, 'finding')} described by one person only` : 'None', dUrl(id, 'findings')),
      check(c.openQuestions === 0, 'Unanswered questions', c.openQuestions ? plural(c.openQuestions, 'question') : 'None', null),
      check(c.missingMeasurements === 0, 'Missing measurements', c.missingMeasurements ? `${plural(c.missingMeasurements, 'finding')} missing a figure` : 'None', null),
      check(c.assumptions === 0, 'Unresolved assumptions', c.assumptions ? plural(c.assumptions, 'assumption') : 'None', null),
      check(c.disputedEvidence === 0, 'Disputed evidence', c.disputedEvidence ? plural(c.disputedEvidence, 'item') : 'None', dUrl(id, 'evidence') + '?review=disputed')),
    c.openQuestionList.length ? section('Unanswered questions', null, el('ul', { class: 'ws-list' }, ...c.openQuestionList.map((q) => el('li', {}, q)))) : null,
    c.assumptionList.length ? section('Assumptions still to confirm', null, el('ul', { class: 'ws-list' }, ...c.assumptionList.map((a) => el('li', {}, a)))) : null,
    section('Complete the discovery', null, el('div', { class: 'ws-fieldset' },
      done ? alertBox('success', d.status === 'priorities_approved' ? 'Priorities approved' : 'Ready for opportunity review', 'The uncertainties above stay visible in the findings and in the report.') : null,
      c.blockers.length ? alertBox('warning', 'Not yet possible', c.blockers.join(' ')) : null,
      field('Note for the record', note, { optional: true, help: 'For example, why you’re happy to proceed with the open questions above.' }),
      el('div', { class: 'ds-cluster' }, btn, m),
      done ? el('div', {}, linkBtn(`/app/opportunities?d=${id}`, 'Proceed to opportunity assessment', 'accent')) : null)),
  ];
}
