'use strict';
// Landing page behaviour: mobile menu, and a sign-in link only where sign-in exists.
document.documentElement.classList.add('ds-js');

(() => {
  const toggle = document.querySelector('.ds-nav__toggle');
  const menu = document.getElementById('lp-menu');
  if (!toggle || !menu) return;
  const setOpen = (open) => {
    menu.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') { setOpen(false); toggle.focus(); }
  });
})();
// The "Sign in" link is shown by the server only when a sign-in flow exists (see src/http/app.ts).
