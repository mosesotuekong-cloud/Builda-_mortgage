'use strict';
// JADA admin: every firm in this database, the saved demo firm, and deleting a firm (cannot be undone).
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
  if (!res.ok) throw Object.assign(new Error(data.error || data.message || 'Something went wrong.'), { status: res.status });
  return data;
}
const DEMO_FIRM = 'Synthetic Demo Mortgages (not a real firm)';
const when = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function header(...rest) {
  return [el('p', {}, el('a', { href: '/jada' }, '← JADA work')), el('h1', {}, 'JADA admin'), ...rest];
}

function demoCard(firms, status, render) {
  const demo = firms.find((f) => f.name === DEMO_FIRM);
  const create = el('button', { class: 'btn btn-primary', type: 'button' }, 'Create the demo firm');
  create.addEventListener('click', async () => {
    create.disabled = true; create.textContent = 'Creating… (up to a minute: it writes the report)';
    status.textContent = '';
    try {
      const r = await api('/api/jada/admin/demo-firm', 'POST');
      await render(`Created “${r.name}”. Sign in as “${r.signInAs}” to walk through it.`);
    } catch (err) { status.textContent = err.message; create.disabled = false; create.textContent = 'Create the demo firm'; }
  });
  return el('section', { class: 'admin-demo', 'aria-labelledby': 'demo-h' },
    el('h2', { id: 'demo-h' }, 'Saved demo firm'),
    el('p', {}, 'A made-up mortgage brokerage taken through the complete discovery: firm context, nine people interviewed, findings, the firm lead’s review, the report with its plans and timelines, and approved priorities. Use it for sales demos; every name says it isn’t real.'),
    demo
      ? el('p', {}, el('strong', {}, 'Ready. '), `Created ${when(demo.createdAt)}. Sign in as “Demo Firm Lead (synthetic)” to show it. To start it afresh, delete it below and create it again.`)
      : el('div', {}, el('p', { class: 'muted' }, 'There is no demo firm in this database yet.'), create));
}

function firmRow(f, status, render) {
  const cell = el('td', {});
  const del = el('button', { class: 'btn btn-danger', type: 'button', 'aria-label': `Delete ${f.name}` }, 'Delete');
  del.addEventListener('click', () => {
    del.hidden = true;
    const input = el('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-label': `Type ${f.name} to confirm` });
    const go = el('button', { class: 'btn btn-danger', type: 'button', disabled: '' }, 'Delete for good');
    const cancel = el('button', { class: 'btn', type: 'button' }, 'Cancel');
    input.addEventListener('input', () => { go.disabled = input.value.trim() !== f.name; });
    cancel.addEventListener('click', () => { box.remove(); del.hidden = false; del.focus(); });
    go.addEventListener('click', async () => {
      go.disabled = true; go.textContent = 'Deleting…';
      try {
        const r = await api(`/api/jada/admin/firms/${f.id}/delete`, 'POST', { confirmName: input.value });
        await render(`Deleted “${r.deleted}” and everything in it.`);
      } catch (err) { status.textContent = err.message; go.disabled = false; go.textContent = 'Delete for good'; }
    });
    const box = el('div', { class: 'admin-confirm', role: 'group', 'aria-label': `Confirm deleting ${f.name}` },
      el('p', {}, el('strong', {}, 'This can’t be undone. '), `It deletes ${plural(f.discoveries, 'discovery', 'discoveries')}, ${plural(f.people, 'person', 'people')} and their interviews, every finding and report, the audit history and the firm’s sign-in accounts.`),
      el('label', {}, `Type the firm’s name to confirm: `, el('strong', {}, f.name)), input,
      el('div', { class: 'actions' }, go, ' ', cancel));
    cell.append(box);
    input.focus();
  });
  cell.prepend(del);
  return el('tr', {},
    el('td', {}, el('strong', {}, f.name), f.isDemo ? el('span', { class: 'badge-demo' }, 'Demo') : null),
    el('td', { class: 'num hide-sm' }, when(f.createdAt)),
    el('td', { class: 'num' }, `${plural(f.people, 'person', 'people')}`, el('br'), el('span', { class: 'muted small' }, plural(f.reports, 'report', 'reports'))),
    cell);
}

async function render(message = '') {
  const status = el('p', { class: 'status', role: 'status', 'aria-live': 'polite' }, message);
  let firms;
  try { ({ firms } = await api('/api/jada/admin/firms')); }
  catch (err) {
    root.replaceChildren(...header(
      el('p', {}, err.status === 401 ? 'Sign in as JADA staff to use the admin page.' : err.message),
      err.status === 401 ? el('p', {}, el('a', { class: 'btn btn-primary', href: '/signin' }, 'Sign in')) : null));
    return;
  }
  root.replaceChildren(...header(
    el('p', { class: 'muted' }, 'Every firm in this BuildA+ database. For JADA staff only.'),
    status,
    demoCard(firms, status, render),
    el('h2', {}, `Firms (${firms.length})`),
    firms.length === 0 ? el('p', { class: 'muted' }, 'No firms yet.') :
      el('table', { class: 'admin-firms' },
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Firm'), el('th', { scope: 'col', class: 'hide-sm' }, 'Created'), el('th', { scope: 'col' }, 'Size'), el('th', { scope: 'col' }, el('span', { class: 'sr-only' }, 'Actions')))),
        el('tbody', {}, ...firms.map((f) => firmRow(f, status, render))))));
  if (message) status.focus?.();
}
render();
