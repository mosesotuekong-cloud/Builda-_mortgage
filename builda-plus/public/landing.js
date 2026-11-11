'use strict';
// Landing page behaviour: mobile menu, the headline underline, and the findings preview playing out.
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

// The headline's last words underline themselves once, just after the page appears.
(() => {
  const pop = document.querySelector('.lp-pop');
  if (pop) requestAnimationFrame(() => requestAnimationFrame(() => pop.classList.add('is-drawn')));
})();

// The findings preview, live: the pointer moves along the journey, each finding arrives, its confidence is
// weighed, then the decision lands. It loops while visible, pauses when scrolled away or the tab is hidden,
// and never runs for people who ask for reduced motion (they see the finished card, which is the default).
(() => {
  const card = document.getElementById('lp-preview');
  if (!card || !window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const stages = [...card.querySelectorAll('.lp-preview__journey li')];
  const pointer = card.querySelector('.lp-preview__pointer');
  const findings = [...card.querySelectorAll('.lp-finding')];
  const status = document.getElementById('lp-preview-status');
  const counts = [...card.querySelectorAll('[data-count]')];
  if (!stages.length || !pointer || !findings.length) return;

  let timers = [], running = false, visible = false, stage = 0;
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));
  const stop = () => { timers.forEach(clearTimeout); timers = []; running = false; };

  const moveTo = (i) => {
    stage = i;
    const li = stages[i];
    pointer.style.width = `${li.offsetWidth}px`;
    pointer.style.transform = `translateX(${li.offsetLeft}px)`;
    stages.forEach((s, n) => { s.classList.toggle('is-active', n === i); s.classList.toggle('is-done', n < i); });
  };

  // Counters climb towards their totals in step with the findings, so they never run ahead of the story.
  const setCounts = (share) => counts.forEach((c) => { c.textContent = String(Math.round(Number(c.dataset.count) * share)); });
  const countTo = (from, to, ms) => {
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / ms), eased = 1 - Math.pow(1 - k, 3);
      setCounts(from + (to - from) * eased);
      if (k < 1 && running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const reset = () => {
    card.classList.remove('is-ready', 'is-resetting');
    findings.forEach((f) => f.classList.remove('is-in', 'is-measured', 'is-decided', 'is-current'));
    setCounts(0);
    moveTo(0);
    if (status) status.textContent = 'Analysing interviews';
  };

  const play = () => {
    stop(); running = true; reset();
    let t = 700;
    later(200, () => countTo(0, 0.35, 900));
    findings.forEach((f, i) => {
      const at = t;
      later(at, () => { moveTo(Number(f.dataset.stage)); findings.forEach((x) => x.classList.remove('is-current')); });
      later(at + 550, () => { f.classList.add('is-in', 'is-current'); countTo(0.35 + 0.65 * (i / findings.length), 0.35 + 0.65 * ((i + 1) / findings.length), 900); });
      later(at + 1250, () => f.classList.add('is-measured'));
      later(at + 2000, () => f.classList.add('is-decided'));
      t += 2700;
    });
    later(t, () => {
      findings.forEach((x) => x.classList.remove('is-current'));
      moveTo(stages.length - 1);
      card.classList.add('is-ready');
      if (status) status.textContent = 'Ready for your decision';
    });
    later(t + 5200, () => card.classList.add('is-resetting'));
    later(t + 5900, () => { if (visible && !document.hidden) play(); else stop(); });
  };

  card.classList.add('lp-preview--live');
  reset();
  addEventListener('resize', () => moveTo(stage));
  const resume = () => { if (visible && !document.hidden && !running) play(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else resume(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (!visible) stop(); else resume(); }, { threshold: 0.35 }).observe(card);
  } else { visible = true; resume(); }
})();
// The "Sign in" link is shown by the server only when a sign-in flow exists (see src/http/app.ts).
