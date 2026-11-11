// Welcome walkthrough for new paying accounts: a welcome screen, then a spotlight tour of the sidebar,
// then a "Getting started" checklist on the Leads page. Replay any time from the sidebar.
(() => {
  const css = `
  .tw-veil { position:fixed; inset:0; z-index:1000; pointer-events:auto; }
  .tw-spot { position:fixed; z-index:1001; border-radius:8px; pointer-events:none;
    box-shadow:0 0 0 9999px rgba(8,14,28,.62), 0 0 0 2px var(--gold, #c6a052);
    transition:top .38s cubic-bezier(.2,.8,.2,1), left .38s cubic-bezier(.2,.8,.2,1), width .38s cubic-bezier(.2,.8,.2,1), height .38s cubic-bezier(.2,.8,.2,1), opacity .25s; }
  .tw-spot.pulse::after { content:""; position:absolute; inset:-6px; border-radius:12px; border:2px solid var(--gold, #c6a052); animation:twPulse 1.6s ease-out infinite; }
  @keyframes twPulse { from { opacity:.9; transform:scale(1); } to { opacity:0; transform:scale(1.08); } }
  .tw-card { position:fixed; z-index:1002; width:340px; max-width:calc(100vw - 32px); background:var(--card, #fff); color:var(--ink, #101828);
    border:1px solid var(--line, #e4e7ec); border-radius:12px; box-shadow:0 24px 60px rgba(8,14,28,.28); padding:20px;
    transition:top .38s cubic-bezier(.2,.8,.2,1), left .38s cubic-bezier(.2,.8,.2,1), opacity .2s; font-family:var(--body, system-ui); }
  .tw-card .tw-step { font-size:12px; font-weight:600; color:var(--muted, #667085); }
  .tw-card h3 { font:600 18px/1.3 var(--display, system-ui); margin:6px 0 8px; letter-spacing:-.01em; }
  .tw-card p { margin:0; font-size:14px; line-height:1.55; color:var(--ink2, #344054); }
  .tw-card ul { margin:10px 0 0; padding-left:18px; font-size:14px; line-height:1.55; color:var(--ink2, #344054); }
  .tw-card .tw-body { animation:twIn .35s ease; }
  @keyframes twIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
  .tw-foot { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:18px; }
  .tw-dots { display:flex; gap:5px; } .tw-dots i { width:6px; height:6px; border-radius:50%; background:var(--line, #e4e7ec); transition:background .2s, width .2s; }
  .tw-dots i.on { background:var(--brand, #1a3f8f); width:16px; border-radius:3px; }
  .tw-btns { display:flex; gap:8px; }
  .tw-btn { border:1px solid var(--line, #e4e7ec); background:var(--card, #fff); color:var(--ink, #101828); border-radius:6px; padding:8px 14px; font:600 14px var(--body, system-ui); cursor:pointer; }
  .tw-btn.p { background:var(--brand, #1a3f8f); border-color:var(--brand, #1a3f8f); color:#fff; }
  .tw-skip { background:none; border:0; color:var(--muted, #667085); font:500 13px var(--body, system-ui); cursor:pointer; padding:4px 0; }

  /* Welcome screen */
  .tw-welcome { position:fixed; inset:0; z-index:1003; display:flex; align-items:center; justify-content:center; overflow-y:auto; background:rgba(8,14,28,.62); padding:16px; animation:twFade .3s ease; }
  @keyframes twFade { from { opacity:0; } to { opacity:1; } }
  .tw-wcard { width:min(560px, 100%); margin:auto; background:var(--card, #fff); color:var(--ink, #101828); border-radius:14px; overflow:hidden; box-shadow:0 30px 80px rgba(8,14,28,.35); animation:twPop .45s cubic-bezier(.2,.8,.2,1); }
  @keyframes twPop { from { opacity:0; transform:translateY(14px) scale(.98); } to { opacity:1; transform:none; } }
  .tw-hero { background:var(--navy, #0c1a33); color:#e9eef7; padding:28px 28px 24px; }
  .tw-hero b { font:700 22px/1.25 var(--display, system-ui); display:block; letter-spacing:-.01em; }
  .tw-hero b span { color:var(--gold, #c6a052); }
  .tw-hero p { margin:6px 0 0; color:#93a1bb; font-size:14.5px; }
  .tw-flow { display:grid; grid-template-columns:1fr auto 1fr auto 1fr; align-items:center; gap:8px; margin-top:22px; }
  .tw-node { background:#13254a; border:1px solid #233a6a; border-radius:10px; padding:12px 10px; text-align:center; opacity:0; transform:translateY(8px); animation:twNode .5s ease forwards; }
  .tw-node:nth-of-type(1) { animation-delay:.25s } .tw-node:nth-of-type(3) { animation-delay:.85s } .tw-node:nth-of-type(5) { animation-delay:1.45s }
  @keyframes twNode { to { opacity:1; transform:none; } }
  .tw-node small { display:block; font-size:11px; color:#93a1bb; } .tw-node strong { display:block; font-size:13.5px; margin-top:2px; color:#fff; }
  .tw-node.money strong { color:var(--gold, #c6a052); }
  .tw-arrow { width:28px; height:2px; background:#233a6a; position:relative; overflow:hidden; }
  .tw-arrow::after { content:""; position:absolute; inset:0; background:var(--gold, #c6a052); transform:translateX(-100%); animation:twFlow 1.4s ease-in-out infinite; }
  .tw-arrow:nth-of-type(4)::after { animation-delay:.6s; }
  @keyframes twFlow { 0% { transform:translateX(-100%); } 60%, 100% { transform:translateX(100%); } }
  .tw-wbody { padding:22px 28px 24px; }
  .tw-wbody ol { margin:0; padding:0; list-style:none; counter-reset:s; }
  .tw-wbody li { counter-increment:s; display:flex; gap:12px; padding:9px 0; font-size:14.5px; line-height:1.5; color:var(--ink2, #344054); }
  .tw-wbody li::before { content:counter(s); flex:none; width:22px; height:22px; border-radius:50%; background:var(--brand-soft, #eef2fa); color:var(--brand, #1a3f8f); font:600 12px/22px var(--body, system-ui); text-align:center; }
  .tw-wbody li b { color:var(--ink, #101828); }
  .tw-wfoot { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-top:16px; }
  @media (max-width:520px) {
    .tw-hero { padding:22px 20px 20px; } .tw-hero b { font-size:20px; } .tw-wbody { padding:18px 20px 20px; }
    .tw-flow { grid-template-columns:1fr 12px 1fr 12px 1fr; gap:4px; } .tw-arrow { width:12px; }
    .tw-node { padding:10px 6px; } .tw-node strong { font-size:12px; line-height:1.3; }
    .tw-wbody li { font-size:14px; padding:7px 0; }
  }

  /* Getting-started checklist */
  .gs { background:var(--card, #fff); border:1px solid var(--line, #e4e7ec); border-radius:10px; padding:18px 20px; margin-bottom:20px; animation:twIn .4s ease; }
  .gs-top { display:flex; justify-content:space-between; align-items:baseline; gap:12px; }
  .gs-top b { font-size:16px; } .gs-top span { font-size:13px; color:var(--muted, #667085); }
  .gs-bar { height:4px; background:var(--line, #e4e7ec); border-radius:2px; margin:10px 0 6px; overflow:hidden; }
  .gs-bar i { display:block; height:100%; background:linear-gradient(90deg, var(--brand, #2f6fed), #2fd38a); transition:width .6s ease; }
  .gs ul { list-style:none; margin:0; padding:0; }
  .gs li { display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid var(--line2, #eef0f3); font-size:14px; }
  .gs li:last-child { border-bottom:0; }
  .gs .ck { flex:none; width:20px; height:20px; border-radius:50%; border:1.5px solid var(--line, #d0d5dd); display:grid; place-items:center; }
  .gs li.done .ck { background:var(--ok, #067647); border-color:var(--ok, #067647); }
  .gs li.done .ck::after { content:""; width:5px; height:9px; border:solid #fff; border-width:0 2px 2px 0; transform:rotate(45deg) translate(-1px,-1px); }
  .gs li.done .gt { color:var(--muted, #667085); text-decoration:line-through; }
  .gs .gt { flex:1; } .gs .gt small { display:block; color:var(--muted, #667085); font-size:13px; text-decoration:none; }
  .gs li a { font-weight:600; font-size:13.5px; white-space:nowrap; text-decoration:none; }
  .gs-x { background:none; border:0; color:var(--muted, #667085); font:500 13px var(--body, system-ui); cursor:pointer; }
  @media (prefers-reduced-motion: reduce) { .tw-spot, .tw-card { transition:none; } .tw-spot.pulse::after, .tw-arrow::after { animation:none; } .tw-node { opacity:1; transform:none; animation:none; } }
  `;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

  const STEPS = [
    { sel: '.side a[data-t=leads]', h: 'Leads', p: 'Every seller who fills out your funnel lands here. Before you call, the property has already been run against recent sales, so you see the ARV, repairs and your offer range.', li: ['Mortgage balance, equity and any pre-foreclosure on every lead', 'Drag the offer slider to see your fee and what the seller keeps', 'Set a follow-up date and we\'ll remind you by email'] },
    { sel: '.side a[href="/underwriting"]', h: 'Deals', p: 'Your pipeline as a board: drag a deal from Offer sent to Under contract to Closed. Each deal has an underwriting calculator, an 18-point checklist, and a purchase agreement and assignment filled in for you.' },
    { sel: '.side a[data-t=buyers]', h: 'Buyers', p: 'Your cash buyers list. Add buyers or import a spreadsheet, then open any deal and hit Send to buyers to email it to everyone who buys in that area and price range.' },
    { sel: '.side a[href="/operator"]', h: 'Run an address', p: 'For call-ins, list leads or a house you drove past. Type the address and get comps, ARV, repairs, your max and opening offer, and a buyer pitch in about ten seconds.', li: ['See what\'s owed: recorded loans, estimated equity, liens and foreclosure filings', 'A red flag when the payoff is above your max offer'] },
    { sel: '.side a[href="/photos"]', h: 'Photo estimate', p: 'Upload up to 12 listing or walkthrough photos for a line-by-line repair budget, red flags, and what to check on the walkthrough. Batch runs up to 10 addresses at once.' },
    { sel: '.side a[href="/list"]', h: 'Owner lists', p: 'Pull owners in any ZIP from public records: absentee, out-of-state, long-time owners and vacant lots. Download the CSV for your skip-tracing service.' },
    { sel: '.side a[data-t=funnel]', h: 'Funnel & business', p: 'Your seller funnel is already live. Check your business name, phone and address here, then copy your link into your ads.' },
    { sel: '.side a[data-t=ads]', h: 'Ad tracking', p: 'Paste your Meta Pixel and Google Ads tag so every funnel lead counts as a conversion and each lead shows which ad it came from.' },
    { sel: '.side a[data-t=domain]', h: 'Your own domain', p: 'Run your funnel on a domain you own, like sellmyhousefastdallas.com. Included on Pro and Team.' },
    { sel: '#jkCmd', h: 'Search anything', p: 'Find any lead by name or street, jump to a page, or type an address and hit Enter to run it. Shortcut: Ctrl K (⌘K on a Mac).' },
    { sel: '.side a[data-t=account]', h: 'Plan & account', p: 'Your plan, usage and billing. Switch to yearly for 2 months free, add teammates on Agency, and grab your referral link: you and a friend both get 50% off a month.' },
    { sel: '#gsCard', h: 'Start here', p: 'This checklist gets you to your first lead. It ticks itself off as you go. You can replay this tour from the sidebar any time.', last: true },
  ];

  let i = 0, veil, spot, card, onDone;
  const visible = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const steps = () => STEPS.filter(s => visible(document.querySelector(s.sel)));

  function place() {
    const list = steps(); const s = list[i]; if (!s) return end();
    const el = document.querySelector(s.sel);
    el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    setTimeout(() => {
      const r = el.getBoundingClientRect(), pad = 6;
      Object.assign(spot.style, { top: r.top - pad + 'px', left: r.left - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
      spot.classList.toggle('pulse', !!s.last);
      card.innerHTML = `<div class="tw-body"><div class="tw-step">${i + 1} of ${list.length}</div><h3>${esc(s.h)}</h3><p>${esc(s.p)}</p>${s.li ? `<ul>${s.li.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>
        <div class="tw-foot"><div class="tw-dots">${list.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
        <div class="tw-btns">${i ? '<button class="tw-btn" data-a="back" type="button">Back</button>' : '<button class="tw-skip" data-a="end" type="button">Skip tour</button>'}<button class="tw-btn p" data-a="next" type="button">${s.last ? 'Done' : 'Next'}</button></div></div>`;
      const cw = card.offsetWidth, ch = card.offsetHeight, vw = innerWidth, vh = innerHeight, gap = 16;
      let left, top;
      if (r.right + gap + cw < vw) { left = r.right + gap; top = Math.min(Math.max(16, r.top + r.height / 2 - ch / 2), vh - ch - 16); }       // to the right (sidebar)
      else if (r.bottom + gap + ch < vh) { left = Math.min(Math.max(16, r.left + r.width / 2 - cw / 2), vw - cw - 16); top = r.bottom + gap; } // below (phone top bar)
      else { left = Math.min(Math.max(16, r.left + r.width / 2 - cw / 2), vw - cw - 16); top = Math.max(16, r.top - gap - ch); }               // above
      Object.assign(card.style, { left: left + 'px', top: top + 'px', opacity: 1 });
      card.querySelector('[data-a=next]').focus({ preventScroll: true });
    }, 180);
  }
  function go(d) { const n = steps().length; i = Math.max(0, Math.min(n - 1, i + d)); place(); }
  function end() {
    [veil, spot, card].forEach(x => x?.remove()); veil = spot = card = null;
    removeEventListener('resize', place); removeEventListener('keydown', key, true);
    store.set(KEY(), '1'); onDone?.();
  }
  function key(e) { if (!card) return; if (e.key === 'Escape') end(); else if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1); }

  let ctx = {};
  const KEY = () => 'jsTour:' + (ctx.user?.id || '');
  function startTour() {
    if (location.hash.split('/')[0] !== '#leads') location.hash = 'leads';
    i = 0;
    veil = document.createElement('div'); veil.className = 'tw-veil';
    spot = document.createElement('div'); spot.className = 'tw-spot';
    card = document.createElement('div'); card.className = 'tw-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Product tour'); card.style.opacity = 0;
    document.body.append(veil, spot, card);
    card.addEventListener('click', e => { const a = e.target.closest('[data-a]')?.dataset.a; if (a === 'next') (steps()[i]?.last ? end() : go(1)); if (a === 'back') go(-1); if (a === 'end') end(); });
    veil.addEventListener('click', () => go(1));
    addEventListener('resize', place); addEventListener('keydown', key, true);
    setTimeout(place, 60);
  }

  function welcome() {
    const first = esc((ctx.user?.name || '').split(' ')[0] || 'there');
    const w = document.createElement('div'); w.className = 'tw-welcome'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true');
    w.innerHTML = `<div class="tw-wcard">
      <div class="tw-hero"><b>Welcome to JStar <span>Pro</span>, ${first}.</b><p>Your seller funnel is live. Here's how a deal moves through it.</p>
        <div class="tw-flow"><div class="tw-node"><small>1</small><strong>Seller clicks your ad</strong></div><div class="tw-arrow"></div><div class="tw-node"><small>2</small><strong>Lead lands with an offer</strong></div><div class="tw-arrow"></div><div class="tw-node money"><small>3</small><strong>Contract and assign</strong></div></div></div>
      <div class="tw-wbody"><ol>
        <li><span><b>Check your business info</b> so your funnel shows the right name, phone and address.</span></li>
        <li><span><b>Connect your ads</b> and point them at your funnel link.</span></li>
        <li><span><b>Work your leads.</b> Call, run the numbers, move the good ones to Deals and print the contract.</span></li>
      </ol>
      <div class="tw-wfoot"><button class="tw-skip" type="button" data-a="skip">I'll explore on my own</button><button class="tw-btn p" type="button" data-a="tour">Show me around</button></div></div></div>`;
    document.body.appendChild(w);
    w.querySelector('[data-a=tour]').focus();
    w.addEventListener('click', e => {
      const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
      w.remove(); if (a === 'tour') startTour(); else { store.set(KEY(), '1'); onDone?.(); }
    });
  }

  // Getting-started checklist on the Leads page
  function checklist(host, c) {
    if (!host) return;
    const s = c.user.settings || {};
    const items = [
      { done: !!(c.user.company && c.user.phone && s.address), t: 'Add your business details', d: 'Name, phone and address show on your funnel and contracts.', href: '#funnel', a: 'Open' },
      { done: !!(s.metaPixelId || s.googleAdsId), t: 'Connect your ad tracking', d: 'Meta Pixel or Google Ads tag, so leads count as conversions.', href: '#ads', a: 'Connect' },
      { done: c.leads.length > 0, t: 'Get your first lead', d: 'Submit a test on your own funnel, or share the link in an ad.', href: c.funnelUrl, a: 'Open funnel', ext: true },
      { done: (c.usage?.runs || 0) > 0, t: 'Run your first address', d: 'Try a house you know to see the comps and offer range.', href: '/operator', a: 'Run one' },
    ];
    if (c.plan?.customDomain) items.push({ done: c.user.domain?.status === 'live', t: 'Connect your own domain', d: 'Optional. Run your funnel on a domain you own.', href: '#domain', a: 'Connect' });
    const n = items.filter(x => x.done).length;
    if (n === items.length || store.get('jsGsHide:' + c.user.id)) { host.innerHTML = ''; return; }
    host.innerHTML = `<section class="gs" id="gsCard"><div class="gs-top"><b>Getting started</b><span>${n} of ${items.length} done <button class="gs-x" type="button" id="gsHide">Hide</button></span></div>
      <div class="gs-bar"><i style="width:${n / items.length * 100}%"></i></div>
      <ul>${items.map(x => `<li class="${x.done ? 'done' : ''}"><span class="ck"></span><span class="gt">${esc(x.t)}<small>${esc(x.d)}</small></span>${x.done ? '' : `<a href="${esc(x.href)}"${x.ext ? ' target="_blank" rel="noopener"' : ''}>${esc(x.a)}</a>`}</li>`).join('')}</ul></section>`;
    host.querySelector('#gsHide').onclick = () => { store.set('jsGsHide:' + c.user.id, '1'); host.innerHTML = ''; };
  }

  window.JSTour = {
    // c: { user, plan, leads, usage, funnelUrl }
    init(c, { checklistHost } = {}) {
      ctx = c; checklist(checklistHost, c);
      if (c.plan?.tier && c.plan.tier !== 'trial' && !store.get(KEY())) setTimeout(welcome, 400);
    },
    refresh(c, host) { ctx = { ...ctx, ...c }; checklist(host, ctx); },
    start() { if (!card) startTour(); },
  };
})();
