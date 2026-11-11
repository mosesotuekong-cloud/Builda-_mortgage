'use strict';
// Book a demo: checks the form in the browser first, sends it, then replaces the form with what happens next.
document.documentElement.classList.add('ds-js');

(() => {
  const form = document.getElementById('dm-form');
  const card = document.getElementById('dm-card');
  const status = document.getElementById('dm-status');
  if (!form || !card) return;
  const FIELDS = ['name', 'email', 'firmName', 'role', 'firmSize'];
  const MESSAGES = {
    name: 'Please tell us your name.', email: 'Please enter a valid email address.', firmName: 'Please tell us your firm’s name.',
    role: 'Please choose your role.', firmSize: 'Please choose the size of your firm.',
  };

  const showError = (field, message) => {
    const input = form.elements[field];
    const err = document.getElementById(`dm-${field}-error`);
    if (!input || !err) return;
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (message) { input.setAttribute('aria-describedby', err.id); err.textContent = message; err.hidden = false; }
    else { input.removeAttribute('aria-describedby'); err.textContent = ''; err.hidden = true; }
  };
  const check = () => {
    let first = null;
    for (const f of FIELDS) {
      const input = form.elements[f];
      const bad = !input.value.trim() || (f === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim()));
      showError(f, bad ? MESSAGES[f] : '');
      if (bad && !first) first = input;
    }
    return first;
  };
  FIELDS.forEach((f) => form.elements[f].addEventListener('change', () => { if (form.elements[f].getAttribute('aria-invalid') === 'true') check(); }));

  const done = (name) => {
    const first = (name || '').trim().split(/\s+/)[0];
    const heading = document.createElement('h2');
    heading.className = 'ds-h3';
    heading.tabIndex = -1;
    heading.textContent = first ? `Thanks, ${first}. Your request is in.` : 'Thanks. Your request is in.';
    const icon = document.createElement('span');
    icon.className = 'dm-done__icon'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = '✓';
    const p = document.createElement('p');
    p.className = 'ds-muted'; p.textContent = 'Here’s what happens next:';
    const steps = document.createElement('ol');
    for (const t of ['We’ll email you within one working day to find a time.', 'You get a 30-minute walkthrough on a video call.', 'If it fits, we agree an initial assessment of your firm.']) {
      const li = document.createElement('li'); li.textContent = t; steps.append(li);
    }
    const back = document.createElement('a');
    back.className = 'ds-btn ds-btn--secondary'; back.href = '/'; back.textContent = 'Back to the site';
    const wrap = document.createElement('div');
    wrap.className = 'dm-done'; wrap.append(icon, heading, p, steps, back);
    card.replaceChildren(wrap);
    heading.focus();
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.hidden = true;
    const bad = check();
    if (bad) { bad.focus(); return; }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true; button.textContent = 'Sending…';
    const body = Object.fromEntries(new FormData(form).entries());
    try {
      const res = await fetch('/api/demo-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        (data.issues || []).forEach((i) => showError(i.path, MESSAGES[i.path] || i.message));
        throw new Error(data.issues ? 'Please check the highlighted fields.' : (data.error || 'Something went wrong. Please try again.'));
      }
      done(body.name);
    } catch (err) {
      status.textContent = err.message || 'We couldn’t send your request. Please try again.';
      status.hidden = false;
      button.disabled = false; button.textContent = 'Book my demo';
    }
  });
})();
