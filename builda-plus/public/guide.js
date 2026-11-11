'use strict';
// BuildA+ guide: "Plus", an original animated helper on every signed-in page.
// Help text lives in /static/guide-content.json (shared with the server). Questions go to BuildA+'s own
// /api/guide/ask, which answers with AI grounded ONLY in that help (never firm data). If the AI isn't
// available, Plus answers from the written help in the browser. Greetings are answered instantly here.
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
    return n;
  };
  const svg = (tag, attrs = {}, ...kids) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); n.append(...kids); return n; };
  const store = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* storage unavailable */ } } };

  /* ---------------------------------------------------------------- which page is this */
  const D = '([0-9a-f-]{36})';
  const ROUTES = [
    ['overview', /^\/app$/], ['profile', /^\/app\/profile$/], ['technology', /^\/app\/profile\/technology$/], ['discovery-list', /^\/app\/discovery$/],
    ['disc-overview', new RegExp(`^/app/discovery/${D}$`)], ['disc-context', new RegExp(`^/app/discovery/${D}/context$`)],
    ['disc-interviews', new RegExp(`^/app/discovery/${D}/interviews$`)], ['disc-journey', new RegExp(`^/app/discovery/${D}/journey$`)],
    ['disc-evidence', new RegExp(`^/app/discovery/${D}/evidence(/${D})?$`)], ['disc-findings', new RegExp(`^/app/discovery/${D}/findings$`)],
    ['disc-finding', new RegExp(`^/app/discovery/${D}/findings/${D}$`)], ['disc-review', new RegExp(`^/app/discovery/${D}/review$`)],
    ['evidence', /^\/app\/evidence$/], ['opportunities', new RegExp(`^/app/opportunities(/${D})?$`)], ['opportunity', new RegExp(`^/app/opportunities/${D}/${D}$`)],
    ['implementation', /^\/app\/implementation$/], ['impact', /^\/app\/impact$/], ['settings', /^\/app\/settings\/(organisation|account)$/],
    ['eng-queue', /^\/jada\/engineering$/], ['eng-detail', new RegExp(`^/jada/engineering/${D}$`)], ['eng-templates', /^\/jada\/engineering\/templates$/],
  ];
  const path = location.pathname.replace(/\/+$/, '') || '/';
  if (!/^\/(app|jada)/.test(path)) return;      // only on signed-in pages
  const pageKey = (ROUTES.find(([, re]) => re.test(path)) || [''])[0];
  const onJada = path.startsWith('/jada');
  let content = { global: [], pages: {} };
  const page = () => content.pages[pageKey] || null;

  /* ---------------------------------------------------------------- places Plus can take you */
  const discoveryId = () => {
    const m = path.match(/^\/app\/(?:discovery|opportunities)\/([0-9a-f-]{36})/);
    if (m) return m[1];
    const a = [...document.querySelectorAll('a[href*="/app/discovery/"], a[href*="/app/opportunities/"]')]
      .map((x) => x.getAttribute('href').match(/\/app\/(?:discovery|opportunities)\/([0-9a-f-]{36})/)).find(Boolean);
    return a ? a[1] : null;
  };
  const tab = (t) => () => { const id = discoveryId(); return id ? `/app/discovery/${id}${t ? `/${t}` : ''}` : '/app/discovery'; };
  const PLACES = {
    interviews: { name: 'Interviews', href: tab('interviews'), inDiscovery: true, words: ['interview', 'interviews', 'invite', 'invites', 'invitation', 'participants', 'participant', 'people', 'staff', 'link', 'links', 'team'] },
    technology: { name: 'Technology inventory', href: () => '/app/profile/technology', words: ['technology', 'tech', 'systems', 'system', 'inventory', 'crm', 'software', 'tools'] },
    profile: { name: 'Firm details', href: () => '/app/profile', words: ['profile', 'firm details', 'firm info', 'details', 'advisers', 'hourly cost'] },
    journey: { name: 'Journey', href: tab('journey'), inDiscovery: true, words: ['journey', 'stages', 'stage'] },
    evidence: { name: 'Evidence', href: tab('evidence'), inDiscovery: true, words: ['evidence', 'quotes', 'quote', 'observations'] },
    findings: { name: 'Findings', href: tab('findings'), inDiscovery: true, words: ['findings', 'finding', 'problems', 'corrections', 'correct'] },
    review: { name: 'Review', href: tab('review'), inDiscovery: true, words: ['review', 'checklist', 'mark ready', 'complete the discovery'] },
    opportunities: { name: 'Opportunities', href: () => '/app/opportunities', words: ['opportunities', 'opportunity', 'priorities', 'priority', 'business case', 'report', 'approve', 'approval'] },
    implementation: { name: 'Implementation', href: () => '/app/implementation', words: ['implementation', 'engineering', 'jada progress', 'status', 'progress'] },
    impact: { name: 'Impact', href: () => '/app/impact', words: ['impact', 'results', 'outcomes', 'outcome', 'measures', 'measured'] },
    discovery: { name: 'Discovery', href: tab(''), inDiscovery: true, words: ['discovery', 'discoveries', 'analyse', 'analysis', 'follow-up', 'follow up'] },
    account: { name: 'Account settings', href: () => '/app/settings/account', words: ['account', 'sign out', 'log out', 'logout', 'settings'] },
    overview: { name: 'Overview', href: () => '/app', words: ['overview', 'home', 'dashboard', 'start', 'beginning'] },
    'eng-templates': { name: 'Solution templates', href: () => '/jada/engineering/templates', words: ['template', 'templates', 'reference design'] },
    escalations: { name: 'Escalations and earlier packs', href: () => '/jada', words: ['escalation', 'escalations', 'earlier packs', 'packs'] },
    'eng-queue': { name: 'Engineering queue', href: () => '/jada/engineering', words: ['queue', 'submissions', 'submission', 'home', 'start', 'list'] },
  };
  const placeKeys = onJada ? ['eng-templates', 'escalations', 'eng-queue'] : Object.keys(PLACES).filter((k) => !['eng-templates', 'escalations', 'eng-queue'].includes(k));
  const goAction = (key) => {
    const p = PLACES[key];
    if (!p) return null;
    const href = p.href();
    return href === path ? null : { label: `Go to ${p.name} →`, href };
  };

  /* ---------------------------------------------------------------- the written help, for when AI isn't available */
  const norm = (q) => q.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9 -]+/g, ' ').replace(/\s+/g, ' ').trim();
  const search = (q) => {
    const STOP = new Set(['the', 'and', 'for', 'are', 'can', 'how', 'what', 'why', 'does', 'this', 'that', 'with', 'our', 'your', 'you', 'its', 'when', 'who', 'did', 'have', 'has', 'not', 'from', 'into', 'about', 'should', 'there', 'they', 'will', 'want', 'need', 'page',
      'take', 'go', 'goto', 'show', 'open', 'find', 'where', 'get', 'bring', 'navigate', 'jump', 'move', 'please']);
    const SYN = { quote: ['words'], quotes: ['words'], hidden: ['withheld'], hide: ['withheld'], words: ['quote'], withheld: ['hidden'], saving: ['cash', 'capacity'], savings: ['cash', 'capacity'],
      money: ['cash', 'saving'], invite: ['link', 'invitation'], email: ['link', 'send'], staff: ['people', 'role'], wrong: ['dispute', 'correct'], mistake: ['dispute', 'undo'],
      privacy: ['see', 'names'], priority: ['priority', 'rank'], rank: ['priority'], score: ['priority'], confused: ['page'], stuck: ['help', 'jada'] };
    const base = norm(q).split(' ').filter((w) => (w === 'ai' || w.length > 2) && !STOP.has(w));
    const words = [...new Set([...base, ...base.flatMap((w) => SYN[w] || [])])];
    if (!words.length) return [];
    const all = [...content.global.map((x) => ({ ...x, from: null })), ...Object.entries(content.pages).flatMap(([k, p]) => p.faqs.map((x) => ({ ...x, from: k }))),
      ...(content.terms || []).map((t) => ({ q: `What does “${t.term}” mean?`, a: t.meaning, from: null }))];
    const has = (text, w) => { const t = text.toLowerCase().replace(/[’']/g, ''); return w.length <= 3 ? new RegExp(`(^|[^a-z0-9])${w}($|[^a-z0-9])`).test(t) : t.includes(w.length > 4 ? w.slice(0, -1) : w); };
    const key = (s) => s.toLowerCase().replace(/\b(the|a|an)\b|[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
    return all.map((x) => ({ ...x, score: words.reduce((s, w) => s + (has(x.q, w) ? 3 : 0) + (has(x.a, w) ? 1 : 0), 0) }))
      .filter((x) => x.score >= 2).sort((a, b) => b.score - a.score || (a.from === pageKey ? -1 : 1))
      .filter((x, i, arr) => arr.findIndex((y) => key(y.q) === key(x.q)) === i).slice(0, 2);
  };
  const nextOnPage = () => {
    const title = document.querySelector('.ws-next__title, .ws-nextstep strong');
    const b = document.querySelector('.ws-next a.ds-btn, .ws-nextstep a');
    return title ? { title: title.textContent.trim(), action: b ? { label: `${b.textContent.replace(/\s*→\s*$/, '').trim()} →`, href: b.getAttribute('href') } : null } : null;
  };
  const SUGGEST = onJada ? ['What should I do next?', 'Take me to solution templates', 'When is an implementation a success?']
    : ['What should I do next?', 'Where do I invite people?', 'Is time recovered a saving?'];

  // Instant, local replies: greetings and thanks always; navigation and "what next" only as a fallback.
  function local(raw, { fallback }) {
    const q = norm(raw);
    const r = (text, ...actions) => ({ text, actions: actions.filter(Boolean), suggestions: [] });
    if (/^(hi+|hello+|hey+|hiya|howdy|yo|greetings|good (morning|afternoon|evening)|morning|afternoon|evening)( there| plus| builda)?$/.test(q))
      return { ...r('Hi! I’m Plus. Ask me anything about using BuildA+, or tell me where you’d like to go.'), suggestions: SUGGEST };
    if (/^(ok |okay |great |perfect )?(thanks|thank you|thank u|thankyou|cheers|ta)( (very much|a lot|plus|so much))?$/.test(q)) return r('You’re welcome! I’m here on every page whenever you need me.');
    if (/^(bye|goodbye|see you|see ya|later|cya)\b/.test(q)) return r('Bye for now! Click me any time you need help.');
    if (!fallback) return null;
    if (/\b(what (should|do|can) i do next|whats next|what is next|next step|next steps|what now|where (do|should) i (start|begin)|how do i start|what do i do now)\b/.test(q)) {
      const n = nextOnPage();
      if (n) return r(`Your next step: ${n.title}.`, n.action);
      const p = page();
      return r(p && p.next ? `From here: ${p.next}` : 'The Overview always shows your single next step.', onJada ? null : goAction('overview'));
    }
    const NAV = /^(go( to)?|take me( to)?|open|show( me)?|navigate( to)?|get me to|bring me to|jump to)\b|\b(where (is|are|can i find|do i find|do i go|do i)|how do i (get|go) to|how do i find|link to)\b/;
    const parked = (window.BUILDA_FEATURES && !window.BUILDA_FEATURES.laterStages) ? ['implementation', 'impact'] : [];
    const key = placeKeys.filter((k) => !parked.includes(k)).find((k) => PLACES[k].words.some((w) => new RegExp(`(^| )${norm(w).replace(/-/g, '[- ]?')}( |$)`).test(q)));
    if (key && (NAV.test(q) || q.split(' ').length <= 3)) {
      const a = goAction(key);
      return a ? r(`Here’s the ${PLACES[key].name} page.`, a) : r(`You’re already on ${PLACES[key].name}.`);
    }
    if (/\b(confused|lost|stuck|dont understand|what is this page|explain this page|what does this page do)\b/.test(q) && page()) {
      const p = page();
      return { ...r(`${p.purpose}${p.next ? ` Next: ${p.next}` : ''}`), suggestions: p.faqs.slice(0, 3).map((f) => f.q) };
    }
    const hits = search(raw);
    if (hits.length) return { text: hits[0].a, actions: [hits[0].from && hits[0].from !== pageKey && content.pages[hits[0].from] && content.pages[hits[0].from].href ? { label: `Go to ${content.pages[hits[0].from].title} →`, href: content.pages[hits[0].from].href } : null].filter(Boolean), suggestions: hits.slice(1).map((h) => h.q) };
    return { ...r(`I don’t have an answer to that. Try other words, or ${onJada ? 'ask your JADA engineering lead' : 'use “Ask JADA for help” on your discovery'}.`), suggestions: SUGGEST };
  }

  /* ---------------------------------------------------------------- the character */
  const buddy = () => svg('svg', { viewBox: '0 0 80 80', 'aria-hidden': 'true', focusable: 'false' },
    svg('ellipse', { class: 'gd-shadow', cx: '40', cy: '76', rx: '18', ry: '3' }),
    svg('g', { class: 'gd-float' },
      svg('path', { class: 'gd-arm gd-arm--wave', d: 'M18 52 Q8 44 10 34' }),
      svg('path', { class: 'gd-arm', d: 'M62 52 Q70 58 68 64' }),
      svg('rect', { class: 'gd-body', x: '14', y: '14', width: '52', height: '56', rx: '22' }),
      svg('ellipse', { class: 'gd-belly', cx: '40', cy: '56', rx: '15', ry: '10' }),
      svg('path', { class: 'gd-plus', d: 'M38 50h4v4h4v4h-4v4h-4v-4h-4v-4h4z' }),
      svg('g', { class: 'gd-eyes' },
        svg('ellipse', { class: 'gd-eye', cx: '31', cy: '34', rx: '6.5', ry: '7.5' }),
        svg('ellipse', { class: 'gd-eye', cx: '49', cy: '34', rx: '6.5', ry: '7.5' }),
        svg('g', { class: 'gd-pupils' }, svg('circle', { class: 'gd-pupil', cx: '32', cy: '35', r: '3.2' }), svg('circle', { class: 'gd-pupil', cx: '50', cy: '35', r: '3.2' }))),
      svg('circle', { class: 'gd-cheek', cx: '23', cy: '44', r: '3' }), svg('circle', { class: 'gd-cheek', cx: '57', cy: '44', r: '3' }),
      svg('path', { d: 'M34 45 Q40 50 46 45', stroke: '#0f2433', 'stroke-width': '2.2', fill: 'none', 'stroke-linecap': 'round' })));

  /* ---------------------------------------------------------------- panel: page guide + conversation */
  const list = (items, cls) => (items && items.length ? el(cls === 'ol' ? 'ol' : 'ul', { class: cls === 'check' ? 'gd-check' : null }, ...items.map((t) => el('li', {}, t))) : null);
  const fold = (title, inner) => (inner ? el('details', { class: 'gd-fold' }, el('summary', {}, title), inner) : null);
  const chips = (qs) => (qs && qs.length ? el('div', { class: 'gd-chips' }, ...qs.map((s) => el('button', { class: 'gd-chip', type: 'button', onclick: () => send(s) }, s))) : null);

  const body = el('div', { class: 'gd-body-scroll', 'aria-live': 'polite' });
  const intro = el('div', { class: 'gd-intro-view' });
  const thread = el('div', { class: 'gd-thread' });
  const history = [];   // last few exchanges, so follow-up questions make sense

  const renderIntro = () => {
    const p = page();
    intro.replaceChildren(...[
      p ? el('p', { class: 'gd-purpose' }, p.purpose) : el('p', { class: 'gd-purpose' }, 'Use the menu on the left to move between sections, or ask me anything.'),
      p && p.next ? el('p', { class: 'gd-next' }, el('strong', {}, 'Next: '), p.next) : null,
      el('section', { class: 'gd-sec' }, el('h3', {}, 'Try asking'), chips(SUGGEST)),
      p ? el('div', { class: 'gd-folds' }, fold('What to check', list(p.check, 'check')), fold('How to go about it', list(p.how, 'ol')),
        fold('Common questions', p.faqs.length ? el('div', {}, ...p.faqs.map((f) => el('details', { class: 'gd-faq' }, el('summary', {}, f.q), el('p', {}, f.a)))) : null)) : null,
    ].filter(Boolean));
  };
  const showIntro = () => { thread.replaceChildren(); history.length = 0; body.replaceChildren(intro); renderIntro(); input.focus(); };

  const say = (who, ...kids) => { const m = el('div', { class: `gd-msg gd-msg--${who}` }, ...kids); thread.append(m); m.scrollIntoView({ block: 'end' }); return m; };
  const answer = (r, note) => say('plus', el('p', {}, r.text),
    ...r.actions.map((a) => el('a', { class: 'ds-btn ds-btn--primary ds-btn--sm gd-go', href: a.href }, a.label)),
    chips(r.suggestions), note ? el('p', { class: 'gd-note' }, note) : null);

  let busy = false;
  async function send(raw) {
    const q = String(raw || '').trim();
    if (!q || busy) return;
    if (!body.contains(thread)) body.replaceChildren(el('button', { class: 'gd-back', type: 'button', onclick: showIntro }, '← This page’s guide'), thread);
    say('you', el('p', {}, q));
    input.value = '';
    const quick = local(q, { fallback: false });
    if (quick) { answer(quick); history.push({ q, a: quick.text }); return; }
    busy = true;
    const typing = say('plus', el('span', { class: 'gd-typing', 'aria-label': 'Plus is typing' }, el('i'), el('i'), el('i')));
    try {
      const n = nextOnPage();
      const res = await fetch('/api/guide/ask', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q, pageKey, nextStep: n ? n.title : '', history: history.slice(-3) }) });
      const data = await res.json().catch(() => ({}));
      typing.remove();
      if (res.ok) {
        const go = data.goTo ? goAction(data.goTo) : null;
        const nextBtn = !go && /\bnext\b/i.test(q) && n && n.action ? n.action : null;
        answer({ text: data.answer, actions: [go || nextBtn].filter(Boolean), suggestions: data.suggestions || [] }, data.redacted ? 'I left out what looked like personal details before answering.' : null);
        history.push({ q, a: data.answer });
      } else if (res.status === 503 || res.status >= 500) {
        const r = local(q, { fallback: true });
        answer(r, 'Answered from the written help (the AI isn’t available right now).');
        history.push({ q, a: r.text });
      } else {
        answer({ text: data.error || 'Something went wrong. Please try again.', actions: [], suggestions: [] });
      }
    } catch {
      typing.remove();
      const r = local(q, { fallback: true });
      answer(r, 'Answered from the written help (couldn’t reach the AI).');
      history.push({ q, a: r.text });
    } finally {
      busy = false;
      if (history.length > 3) history.splice(0, history.length - 3);
      input.focus();
    }
  }

  const input = el('input', { class: 'ds-input', id: 'gd-q', type: 'text', placeholder: 'Ask me anything about BuildA+…', autocomplete: 'off', maxlength: '500', enterkeyhint: 'send', 'aria-label': 'Ask Plus a question' });
  const panel = el('div', { class: 'gd-panel', id: 'gd-panel', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'gd-title', hidden: true },
    el('div', { class: 'gd-head' }, el('div', {}, el('h2', { id: 'gd-title' }, 'Plus'), el('p', { id: 'gd-sub' }, 'Your BuildA+ guide')),
      el('button', { class: 'gd-x', type: 'button', 'aria-label': 'Close the guide', onclick: () => setOpen(false) }, '×')),
    body,
    el('form', { class: 'gd-compose', onsubmit: (e) => { e.preventDefault(); send(input.value); } }, input,
      el('p', { class: 'gd-foot' }, 'Answers come from BuildA+’s help, worded by AI. Please don’t include client or staff details.')));

  const root = el('div', { class: 'gd' });
  const btn = el('button', { class: 'gd-buddy', type: 'button', 'aria-controls': 'gd-panel', 'aria-expanded': 'false', 'aria-label': 'Open the BuildA+ guide', onclick: () => setOpen(panel.hidden) }, buddy());
  const bubble = store.get('gd-bubble') === 'off' ? null : el('div', { class: 'gd-bubble' },
    el('button', { class: 'gd-bubble__open', type: 'button', onclick: () => setOpen(true) }, 'Confused? ', el('span', {}, 'Ask me')),
    el('button', { class: 'gd-bubble__close', type: 'button', 'aria-label': 'Hide this message', onclick: () => { store.set('gd-bubble', 'off'); bubble.remove(); } }, '×'));
  root.append(...[bubble, btn].filter(Boolean));
  if (store.get('gd-seen') !== '1') { root.classList.add('gd-intro'); store.set('gd-seen', '1'); }

  function setOpen(open) {
    panel.hidden = !open; root.classList.toggle('is-open', open); btn.setAttribute('aria-expanded', String(open));
    if (open) { if (!body.contains(thread)) showIntro(); input.focus(); } else btn.focus();
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) setOpen(false); });
  // Clicks inside the panel never close it, even when the click replaces what was clicked.
  document.addEventListener('click', (e) => { const within = e.composedPath(); if (!panel.hidden && !within.includes(panel) && !within.includes(root)) setOpen(false); });

  // Sit just above a sticky save bar (its height varies with the screen and the "Next" prompt).
  const lift = () => {
    const bar = document.querySelector('.ws-form__bar');
    const r = bar && bar.getBoundingClientRect();
    const h = r && r.height && r.bottom >= window.innerHeight - 2 ? Math.ceil(r.height) : 0;
    document.documentElement.style.setProperty('--gd-lift', `${h}px`);
  };
  const mount = () => {
    document.body.append(root, panel);
    lift();
    new MutationObserver(lift).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', lift);
    window.addEventListener('scroll', lift, { passive: true });
    fetch('/static/guide-content.json').then((r) => r.json()).then((c) => {
      content = c;
      const p = page();
      document.getElementById('gd-title').textContent = p ? p.title : 'Plus';
      if (!panel.hidden && !body.contains(thread)) renderIntro();
    }).catch(() => { /* the guide still works for greetings and navigation */ });
  };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
