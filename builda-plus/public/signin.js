'use strict';
// Push-button sign-in (never available in production). When the host has set a sign-in password, it is asked
// for first, and no account is shown until it's right. Then: choose an account, or set up a new firm.
const root = document.getElementById('root');
const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v !== false && v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
};
async function api(path, method = 'GET', body) {
  const res = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.issues ? 'Please fill in both fields.' : (data.error || 'Something went wrong.')), { status: res.status });
  return data;
}
const ROLE = { engineer: 'Engineer', knowledge_editor: 'Knowledge editor', compliance_reviewer: 'Compliance reviewer' };
const status = el('p', { class: 'si-status', role: 'alert' });
const fail = (err) => { status.textContent = err.message; };
const initials = (s) => (s || '?').replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const lockIcon = () => {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  for (const [tag, a] of [['rect', { x: '4', y: '11', width: '16', height: '10', rx: '2' }], ['path', { d: 'M8 11V7a4 4 0 0 1 8 0v4' }]]) {
    const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); svg.append(n);
  }
  return el('span', { class: 'si-lock', 'aria-hidden': 'true' }, svg);
};

function unavailable() {
  root.replaceChildren(el('div', { class: 'si-panel' }, el('div', { class: 'ds-card si-card' },
    el('div', { class: 'si-head' }, el('h1', { class: 'si-title' }, 'Sign-in isn’t available'),
      el('p', { class: 'si-intro' }, 'Push-button sign-in only works in demo mode.')))));
}

function passwordStep() {
  status.textContent = '';
  const pw = el('input', { class: 'ds-input', id: 'si-password', name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const show = el('button', { class: 'si-show', type: 'button', 'aria-controls': 'si-password', 'aria-pressed': 'false', onclick: () => {
    const on = pw.type === 'password';
    pw.type = on ? 'text' : 'password';
    show.textContent = on ? 'Hide' : 'Show';
    show.setAttribute('aria-pressed', String(on));
    pw.focus();
  } }, 'Show');
  const button = el('button', { class: 'ds-btn ds-btn--pop ds-btn--lg si-submit', type: 'submit' }, 'Continue');
  const form = el('form', { class: 'si-form', onsubmit: async (e) => {
    e.preventDefault();
    if (!pw.value) { fail(new Error('Please enter the password.')); pw.focus(); return; }
    button.disabled = true; button.textContent = 'Checking…'; status.textContent = '';
    try { await api('/api/signin/unlock', 'POST', { password: pw.value }); await accountsStep(); }
    catch (err) { fail(err); pw.select(); button.disabled = false; button.textContent = 'Continue'; }
  } },
    el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: 'si-password' }, 'Password'), el('div', { class: 'si-password' }, pw, show)),
    button, status);
  root.replaceChildren(el('div', { class: 'si-panel' },
    el('div', { class: 'ds-card si-card' },
      el('div', { class: 'si-head' }, lockIcon(), el('h1', { class: 'si-title' }, 'Sign in to BuildA+'),
        el('p', { class: 'si-intro' }, 'Enter the password you were given to continue.')),
      form),
    el('p', { class: 'si-foot' }, 'No password yet? ', el('a', { href: '/demo' }, 'Book a demo'), ' and we’ll set you up.')));
  pw.focus();
}

(async () => {
  let s;
  try { s = await api('/api/signin/status'); } catch { unavailable(); return; }
  if (s.passwordRequired && !s.unlocked) passwordStep(); else await accountsStep();
})();

async function accountsStep() {
  status.textContent = '';
  let accounts = [];
  try { accounts = (await api('/api/signin/directory')).accounts; }
  catch (err) { if (err.status === 401) { passwordStep(); return; } unavailable(); return; }

  const signIn = (userId, button) => async () => {
    root.querySelectorAll('.si-account').forEach((b) => { b.disabled = true; });
    button.querySelector('.si-account__arrow').textContent = '…';
    try { location.href = (await api('/api/signin', 'POST', { userId })).next; }
    catch (err) { fail(err); root.querySelectorAll('.si-account').forEach((b) => { b.disabled = false; }); button.querySelector('.si-account__arrow').textContent = '→'; }
  };
  const account = (name, meta, userId, team) => {
    const b = el('button', { class: 'si-account', type: 'button', 'data-search': `${name} ${meta}`.toLowerCase() },
      el('span', { class: team ? 'si-avatar si-avatar--team' : 'si-avatar', 'aria-hidden': 'true' }, initials(name)),
      el('span', { class: 'si-account__text' }, el('span', { class: 'si-account__name' }, name), el('span', { class: 'si-account__meta' }, meta)),
      el('span', { class: 'si-account__arrow', 'aria-hidden': 'true' }, '→'));
    b.addEventListener('click', signIn(userId, b));
    return b;
  };

  const firms = accounts.filter((a) => a.kind === 'firm_lead');
  // JADA staff aren't listed for visitors: their accounts open only from /signin?team=jada.
  const showTeam = new URLSearchParams(location.search).get('team') === 'jada';
  const team = showTeam ? accounts.filter((a) => a.kind === 'jada') : [];
  const firmList = firms.length ? el('div', { class: 'si-accounts' }, ...firms.map((f) => account(f.orgName || 'Firm', f.name, f.userId, false))) : el('p', { class: 'si-empty' }, 'No firms yet.');
  // No JADA accounts yet: the section is left out rather than shown empty.
  const teamList = el('div', { class: 'si-accounts' }, ...team.map((t) => account(t.name, t.roles.map((r) => ROLE[r] || r).join(', ') || 'JADA team', t.userId, true)));

  // With many accounts, a search box narrows both lists.
  const search = accounts.length > 6 ? el('input', { class: 'ds-input si-search', type: 'search', placeholder: 'Search firms and people', 'aria-label': 'Search firms and people', oninput: (e) => {
    const q = e.target.value.trim().toLowerCase();
    root.querySelectorAll('.si-account').forEach((b) => { b.hidden = !!q && !b.dataset.search.includes(q); });
  } }) : null;

  const firmName = el('input', { class: 'ds-input', id: 'si-firm', name: 'firmName', autocomplete: 'organization', required: true });
  const yourName = el('input', { class: 'ds-input', id: 'si-name', name: 'yourName', autocomplete: 'name', required: true });
  const create = el('button', { class: 'ds-btn ds-btn--primary', type: 'submit' }, 'Create firm and sign in');

  root.replaceChildren(el('div', { class: 'si-panel' },
    el('div', { class: 'ds-card si-card' },
      el('div', { class: 'si-head' }, el('h1', { class: 'si-title' }, 'Who’s signing in?'),
        el('p', { class: 'si-intro' }, 'Choose your account. This is a demonstration, so don’t enter real firm or client information.')),
      search,
      el('section', { class: 'si-group', 'aria-labelledby': 'si-firms' }, el('h2', { class: 'si-heading', id: 'si-firms' }, 'Mortgage firms'), firmList,
        el('details', { class: 'si-new' }, el('summary', {}, 'Set up a new firm'),
          el('form', { class: 'si-new__form', onsubmit: async (e) => {
            e.preventDefault();
            create.disabled = true;
            try { location.href = (await api('/api/signin/new-firm', 'POST', { firmName: firmName.value, yourName: yourName.value })).next; }
            catch (err) { fail(err); create.disabled = false; }
          } },
          el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: 'si-firm' }, 'Firm name'), firmName),
          el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: 'si-name' }, 'Your name'), yourName),
          create))),
      team.length ? el('section', { class: 'si-group', 'aria-labelledby': 'si-team' }, el('h2', { class: 'si-heading', id: 'si-team' }, 'JADA team'), teamList) : null,
      status),
    el('p', { class: 'si-note' }, 'Taking part in an interview? You don’t sign in here: use the link your firm lead gave you.')));
}
