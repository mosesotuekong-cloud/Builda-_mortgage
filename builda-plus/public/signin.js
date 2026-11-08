'use strict';
// Demo push-button sign-in (never available in production). One compact card on the shared design system.
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
  if (!res.ok) throw new Error(data.issues ? 'Please fill in both fields.' : (data.error || 'Something went wrong.'));
  return data;
}
const ROLE = { engineer: 'Engineer', knowledge_editor: 'Knowledge editor', compliance_reviewer: 'Compliance reviewer' };
const status = el('div', { class: 'ds-alert ds-alert--danger si-status', role: 'alert' });
const fail = (err) => { status.textContent = err.message; };
const signIn = (userId) => async () => { try { location.href = (await api('/api/signin', 'POST', { userId })).next; } catch (err) { fail(err); } };
const brand = () => el('a', { class: 'si-brand', href: '/' }, 'builda', el('span', {}, '+'));
const account = (name, meta, userId) => el('button', { class: 'si-account', type: 'button', onclick: signIn(userId) },
  el('span', { class: 'si-account__text' }, el('span', { class: 'si-account__name' }, name), el('span', { class: 'si-account__meta' }, meta)),
  el('span', { class: 'si-account__arrow', 'aria-hidden': 'true' }, '→'));

(async () => {
  let accounts = [];
  try { accounts = (await api('/api/signin/directory')).accounts; }
  catch {
    root.replaceChildren(brand(), el('div', { class: 'ds-card si-card' }, el('h1', { class: 'si-title' }, 'Sign-in isn’t available'),
      el('p', { class: 'si-intro' }, 'Push-button sign-in only works in demo mode.')));
    return;
  }
  const firms = accounts.filter((a) => a.kind === 'firm_lead');
  const team = accounts.filter((a) => a.kind === 'jada');
  const firmName = el('input', { class: 'ds-input', id: 'si-firm', name: 'firmName', autocomplete: 'organization', required: true });
  const yourName = el('input', { class: 'ds-input', id: 'si-name', name: 'yourName', autocomplete: 'name', required: true });

  root.replaceChildren(
    brand(),
    el('div', { class: 'ds-card si-card' },
      el('div', {}, el('h1', { class: 'si-title' }, 'Sign in'),
        el('p', { class: 'si-intro' }, 'Demo mode: choose who you are. There are no passwords, so don’t enter real firm or client information.')),
      el('section', { class: 'si-group', 'aria-labelledby': 'si-firms' },
        el('h2', { class: 'si-heading', id: 'si-firms' }, 'Mortgage firms'),
        firms.length ? el('div', { class: 'si-accounts' }, ...firms.map((f) => account(f.orgName || 'Firm', f.name, f.userId)))
          : el('p', { class: 'si-empty' }, 'No firms yet.'),
        el('details', { class: 'si-new' }, el('summary', {}, 'Set up a new firm'),
          el('form', { class: 'si-new__form', onsubmit: async (e) => {
            e.preventDefault();
            try { location.href = (await api('/api/signin/new-firm', 'POST', { firmName: firmName.value, yourName: yourName.value })).next; } catch (err) { fail(err); }
          } },
          el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: 'si-firm' }, 'Firm name'), firmName),
          el('div', { class: 'ds-field' }, el('label', { class: 'ds-label', for: 'si-name' }, 'Your name'), yourName),
          el('button', { class: 'ds-btn ds-btn--primary', type: 'submit' }, 'Create firm and sign in')))),
      el('section', { class: 'si-group', 'aria-labelledby': 'si-team' },
        el('h2', { class: 'si-heading', id: 'si-team' }, 'JADA team'),
        team.length ? el('div', { class: 'si-accounts' }, ...team.map((t) => account(t.name, t.roles.map((r) => ROLE[r] || r).join(', ') || 'No role yet', t.userId)))
          : el('p', { class: 'si-empty' }, 'No JADA team members yet. Run “npm run setup-demo” once to create them.')),
      status),
    el('p', { class: 'si-foot' }, 'People taking part in an interview don’t sign in here. They use the link their firm lead gives them.'));
})();
