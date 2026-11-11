// JStar Pro dashboard kit: shell upgrades (brand mark, top bar, command palette, usage meter)
// and visual components (score rings, sparklines, offer ladder with a live offer slider, equity, comps chart,
// loading steps, count-ups, toasts, confetti). Exposed as window.JK for the pages.
(() => {
  const K = window.JK = {};
  const esc = K.esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $$ = K.money = n => (n || n === 0) && isFinite(n) ? (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString() : '—';
  K.k = n => (n || n === 0) ? (n < 0 ? '-$' : '$') + (Math.abs(n) >= 1e6 ? (Math.abs(n) / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M' : Math.abs(n) >= 1000 ? Math.round(Math.abs(n) / 1000) + 'k' : Math.abs(Math.round(n))) : '—';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const I = K.icon = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    msg: '<path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12z"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    inbox: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5.5 5h13L21 13v6H3v-6z"/>',
    fire: '<path d="M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-4 3 0-3-1-6-4-9 0 4-3 6-3 11 0 5 3 9 7 9z"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    pie: '<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
    deal: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8.5 7V4.5h7V7"/><path d="M3 12.5h18"/>',
    money: '<path d="M12 2v20"/><path d="M17 6.5c-1-1.5-3-2.5-5-2.5-3 0-5 1.5-5 4s2.5 3.2 5 4 5 1.5 5 4-2 4-5 4c-2.5 0-4.5-1-5.5-2.5"/>',
    check: '<path d="M4 12l5 5L20 6"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    list: '<path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    funnel: '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    board: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
    rows: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    star: '<path d="M12 2.5l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17l-5.9 3.3 1.3-6.5L2.5 9.3l6.6-.8z"/>',
  };
  const svg = K.svg = (n, cls = '') => `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true">${I[n] || ''}</svg>`;

  // ── Small visuals ──
  const PAL = [['#4a85ff', '#2f6fed'], ['#9b8afb', '#7a5af8'], ['#32d583', '#12b76a'], ['#ff9f5a', '#f04438'], ['#ffc93c', '#f79009'], ['#36bffa', '#0ba5ec'], ['#f670c7', '#dd2590']];
  const hash = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  K.initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
  K.avatar = (name, cls = '') => { const [a, b] = PAL[hash(name) % PAL.length]; return `<span class="av ${cls}" style="background:linear-gradient(135deg,${a},${b})">${esc(K.initials(name))}</span>`; };
  const LCOL = { HOT: '#f04438', WARM: '#f79009', COLD: '#98a2b3' };
  K.labelColor = l => LCOL[l] || '#98a2b3';

  // Progress ring; frac 0..1. The arc animates in when K.animate(root) runs.
  K.ring = (frac, { size = 40, stroke = 4, color = '#2f6fed', track = 'var(--line2)', text = '', cls = '', grad } = {}) => {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(1, frac || 0)));
    const gid = grad ? 'g' + Math.random().toString(36).slice(2, 8) : '';
    return `<span class="ring ${cls}" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}">${grad ? `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${grad[0]}"/><stop offset="1" stop-color="${grad[1]}"/></linearGradient></defs>` : ''}
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${grad ? `url(#${gid})` : color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${reduce ? off : c}" data-off="${off}"/></svg><b>${text}</b></span>`;
  };
  K.scoreRing = (score, label, size = 40) => score == null ? '<span class="note">n/a</span>'
    : K.ring(Math.min(1, score / 12), { size, stroke: size > 60 ? 8 : 4, color: K.labelColor(label), text: score, cls: size > 60 ? 'lg' : '' });

  K.spark = (vals, { w = 96, h = 30, color = '#2f6fed' } = {}) => {
    if (!vals?.length) return '';
    const mx = Math.max(1, ...vals), st = w / Math.max(1, vals.length - 1);
    const pts = vals.map((v, i) => [i * st, h - 3 - (v / mx) * (h - 6)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const id = 's' + Math.random().toString(36).slice(2, 8);
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <path d="${d} L${w} ${h} L0 ${h}Z" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  };

  K.donut = (parts, { size = 120, stroke = 16, center = '' } = {}) => {
    const tot = parts.reduce((s, p) => s + p.v, 0) || 1, r = (size - stroke) / 2, c = 2 * Math.PI * r; let acc = 0;
    return `<span class="ring" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line2)" stroke-width="${stroke}"/>` +
      parts.map(p => { const len = c * p.v / tot, s = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${p.c}" stroke-width="${stroke}" stroke-dasharray="${Math.max(0, len - 2)} ${c}" stroke-dashoffset="${-acc}"/>`; acc += len; return s; }).join('') +
      `</svg><b>${center}</b></span>`;
  };

  // Count numbers up from 0: <b data-count="123" data-fmt="money|int">
  K.animate = (root = document) => {
    requestAnimationFrame(() => setTimeout(() => root.querySelectorAll('circle[data-off]').forEach(c => { c.style.strokeDashoffset = c.dataset.off; }), 30));
    root.querySelectorAll('[data-count]').forEach(el => {
      const to = +el.dataset.count, fmt = el.dataset.fmt === 'money' ? $$ : el.dataset.fmt === 'k' ? K.k : n => Math.round(n).toLocaleString();
      if (reduce || !isFinite(to)) { el.textContent = fmt(to); return; }
      const t0 = performance.now(), dur = 900;
      const step = t => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(to * e); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  };

  K.toast = msg => {
    let box = document.querySelector('.toasts'); if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
    const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = `<i></i>${esc(msg)}`; box.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s, transform .3s'; t.style.opacity = '0'; t.style.transform = 'translateY(8px)'; setTimeout(() => t.remove(), 320); }, 2600);
  };

  K.confetti = () => {
    if (reduce) return;
    const cv = document.createElement('canvas'), dpr = devicePixelRatio || 1; cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:4000';
    document.body.appendChild(cv); const W = cv.width = innerWidth * dpr, H = cv.height = innerHeight * dpr, x = cv.getContext('2d');
    const C = ['#2f6fed', '#ffc93c', '#12b76a', '#f04438', '#7a5af8', '#36bffa'];
    const ps = Array.from({ length: 160 }, () => ({ x: W / 2 + (Math.random() - .5) * W * .3, y: H * .35, vx: (Math.random() - .5) * 26 * dpr, vy: (-Math.random() * 22 - 8) * dpr, r: (4 + Math.random() * 5) * dpr, c: C[Math.random() * C.length | 0], a: Math.random() * 6, va: (Math.random() - .5) * .4 }));
    let f = 0; const tick = () => { x.clearRect(0, 0, W, H); ps.forEach(p => { p.vy += .9 * dpr; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.a += p.va; x.save(); x.translate(p.x, p.y); x.rotate(p.a); x.fillStyle = p.c; x.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); x.restore(); }); if (++f < 140) requestAnimationFrame(tick); else cv.remove(); };
    tick();
  };

  // Step-by-step loading card. Steps advance on a timer and hold on the last one until done().
  K.steps = (host, title, sub, list, every = 1500) => {
    host.innerHTML = `<div class="steps" role="status"><h3>${esc(title)}</h3><p>${esc(sub)}</p><ol>${list.map(s => `<li><i></i>${esc(s)}</li>`).join('')}</ol><div class="bar"><i></i></div></div>`;
    host.hidden = false;
    const lis = [...host.querySelectorAll('li')], bar = host.querySelector('.bar i'); let i = 0;
    const set = n => { lis.forEach((li, k) => { li.className = k < n ? 'done' : k === n ? 'on' : ''; }); bar.style.width = Math.min(95, (n + .5) / lis.length * 100) + '%'; };
    set(0); const t = setInterval(() => { if (i < lis.length - 1) set(++i); }, every);
    return { done() { clearInterval(t); set(lis.length); bar.style.width = '100%'; }, stop() { clearInterval(t); host.innerHTML = ''; host.hidden = true; } };
  };

  // Hover tooltips for any element with data-tip (HTML allowed, already escaped by caller)
  let tip;
  document.addEventListener('mouseover', e => { const el = e.target.closest?.('[data-tip]'); if (!el) return; tip ||= Object.assign(document.createElement('div'), { className: 'tip' }); tip.innerHTML = el.dataset.tip; document.body.appendChild(tip); });
  document.addEventListener('mousemove', e => { if (!tip?.isConnected) return; if (!e.target.closest?.('[data-tip]')) { tip.remove(); return; } tip.style.left = Math.min(innerWidth - 250, e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; });

  // ── Deal snapshot: hero, offer ladder + live slider, equity, comps ──
  K.snapshot = (b, { title = 'Your offer', sub = '' } = {}) => {
    if (!b || (!b.mao && !b.value)) return '';
    const m = b.mortgage || null, out = [];
    const reasons = (b.reasons || []).map(r => `<span class="${/over MAO|above your max|Payoff/i.test(r) ? 'bad' : /Pre-foreclosure|auction|High equity|Free & clear|ASAP|≤ MAO/i.test(r) ? 'good' : ''}">${esc(r)}</span>`).join('');
    out.push(`<section class="snapcard hero"><div class="hgrid">
      <div style="position:relative">${K.ring(Math.min(1, (b.score || 0) / 12), { size: 112, stroke: 10, track: 'rgba(255,255,255,.12)', grad: b.label === 'HOT' ? ['#ffb020', '#ff4d2e'] : b.label === 'WARM' ? ['#ffe08a', '#f79009'] : ['#c7d2e6', '#8a9ab8'], text: b.score ?? '–', cls: 'lg' })}<small style="position:absolute;left:0;right:0;bottom:22px;text-align:center;font-size:11px;font-weight:700;letter-spacing:.08em;color:#c6d3f2">${esc(b.label || '')}</small></div>
      <div><div class="lbl">${esc(title)}</div>
        <div class="big">${b.mao ? `<span data-count="${b.opening || b.mao}" data-fmt="money">$0</span> <small>to</small> <span data-count="${b.mao}" data-fmt="money">$0</span>` : '<small>No offer: thin comps or missing square feet</small>'}</div>
        <div class="nums">${[['ARV', b.value], ['Repairs', b.repairs], ['Asking', b.asking], ['Owed', m && !m.freeClear ? m.balance : null]].filter(x => x[1] != null).map(([k, v]) => `<div><b data-count="${v}" data-fmt="money">$0</b><span>${k}</span></div>`).join('')}</div>
        ${sub ? `<div style="margin-top:10px;font-size:13.5px;color:#c6d3f2">${esc(sub)}</div>` : ''}
      </div></div>${reasons ? `<div class="reasons">${reasons}</div>` : ''}</section>`);

    if (b.mao && b.value) {
      const fee = b.fee || 10000, buyer = b.buyerPrice || b.mao + fee, owed = m && !m.freeClear ? m.balance : null;
      const marks = [['Owed', owed, '#f04438', 'Estimated mortgage payoff'], ['Asking', b.asking, '#f79009', 'What the seller asked for'], ['Opening', b.opening, '#32d583', 'Where to start the conversation'], ['Max offer', b.mao, '#0e9f6e', 'Highest you should sign at'], ['Buyer price', buyer, '#2f6fed', 'What a cash buyer pays you'], ['ARV', b.value, '#667085', 'Value after repairs']].filter(x => x[1]);
      const lo = Math.min(...marks.map(x => x[1])) * .85, hi = Math.max(...marks.map(x => x[1])) * 1.03, pos = v => ((v - lo) / (hi - lo) * 100).toFixed(2) + '%';
      const smin = Math.round((b.opening || b.mao) * .85 / 500) * 500, smax = Math.round(Math.max(buyer, b.mao * 1.05) / 500) * 500;
      out.push(`<section class="snapcard" data-ladder='${esc(JSON.stringify({ buyer, owed, asking: b.asking || null, value: b.value, mao: b.mao, fee }))}'>
        <h2>${svg('trend', 'hic')} Offer ladder <span class="tag">Drag to test an offer</span></h2>
        <div class="ladder"><div class="track">
          <span class="zone buy" style="left:${pos(b.opening || b.mao)};width:calc(${pos(b.mao)} - ${pos(b.opening || b.mao)})" data-tip="<b>Your buy zone</b><br>Opening to max offer"></span>
          <span class="zone fee" style="left:${pos(b.mao)};width:calc(${pos(buyer)} - ${pos(b.mao)})" data-tip="<b>Your spread</b><br>What a cash buyer pays above your contract"></span>
          ${marks.map(([l, v, c, t]) => `<span class="tk" style="left:${pos(v)};background:${c}" data-tip="<b>${l} ${$$(v)}</b><br>${t}"></span>`).join('')}
        </div><div class="lgd">${marks.map(([l, v, c]) => `<span><i style="background:${c}"></i>${l} <b>${K.k(v)}</b></span>`).join('')}</div></div>
        <div class="slider"><div class="lbl"><span>If you sign at</span><b class="so">$0</b></div>
          <input type="range" min="${smin}" max="${smax}" step="500" value="${b.opening || b.mao}" aria-label="Test an offer">
          <div class="out"><div class="o1"><b>$0</b><span>Your assignment fee</span></div><div class="o2"><b>$0</b><span>${owed ? 'Seller keeps after payoff' : 'Seller gets'}</span></div><div class="o3"><b>$0</b><span>${b.asking ? 'Versus their asking' : 'Percent of ARV'}</span></div></div>
        </div></section>`);
    }

    const side = [];
    if (m) {
      const val = b.value || 0, owed = m.freeClear ? 0 : (m.balance || 0), eq = Math.max(0, val - owed);
      const flags = [m.preForeclosure && '<span class="flag red">Pre-foreclosure</span>', m.auction && '<span class="flag red">Auction scheduled</span>', m.freeClear && '<span class="flag green">Free &amp; clear</span>', m.underwater && '<span class="flag red">Payoff above your max</span>', !m.freeClear && m.equityPct >= 40 && '<span class="flag green">High equity</span>'].filter(Boolean).join(' ');
      side.push(`<section class="snapcard"><h2>${svg('pie', 'hic')} Mortgage &amp; equity <span class="tag">public records, estimated</span></h2>
        <div class="eqrow">${K.donut([{ v: owed, c: '#f04438' }, { v: eq, c: '#12b76a' }], { size: 110, stroke: 14, center: m.equityPct != null ? m.equityPct + '%' : (m.freeClear ? '100%' : '–') })}
          <div class="kv"><div><span>Owed (est.)</span><b>${m.freeClear ? '$0' : $$(m.balance)}</b></div><div><span>Equity</span><b>${$$(m.equity ?? eq)}</b></div><div><span>Open loans</span><b>${m.loans ?? 0}</b></div></div></div>
        ${flags ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:14px">${flags}</div>` : ''}</section>`);
    }
    if (b.comps?.length && b.sqft) side.push(`<section class="snapcard"><h2>${svg('pin', 'hic')} Comps <span class="tag">${b.comps.length} nearby · hover a dot</span></h2>${K.compsChart(b)}</section>`);
    if (side.length) out.push(`<div style="display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">${side.join('')}</div>`);
    return `<div class="snap rise">${out.join('')}</div>`;
  };

  K.compsChart = b => {
    const W = 400, H = 240, P = { l: 46, r: 10, t: 14, b: 30 };
    const cs = b.comps.filter(c => c.price && c.sqft); if (!cs.length) return '';
    const xs = [...cs.map(c => c.sqft), b.sqft], ys = [...cs.map(c => c.price), b.value || 0].filter(Boolean);
    const x0 = Math.min(...xs) * .92, x1 = Math.max(...xs) * 1.06, y0 = Math.min(...ys) * .9, y1 = Math.max(...ys) * 1.06;
    const X = v => P.l + (v - x0) / (x1 - x0) * (W - P.l - P.r), Y = v => H - P.b - (v - y0) / (y1 - y0) * (H - P.t - P.b);
    const ticks = n => Array.from({ length: n }, (_, i) => y0 + (y1 - y0) * i / (n - 1));
    return `<svg class="chart" viewBox="0 0 ${W} ${H}">
      ${ticks(4).map(v => `<line class="ax" x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" stroke-dasharray="3 4"/><text x="${P.l - 8}" y="${Y(v) + 4}" text-anchor="end">${K.k(v)}</text>`).join('')}
      <text x="${W - P.r}" y="${H - 6}" text-anchor="end">square feet →</text>
      ${b.value ? `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(b.value)}" y2="${Y(b.value)}" stroke="#2f6fed" stroke-width="1.5" stroke-dasharray="6 5"/><text x="${W - P.r}" y="${Y(b.value) - 6}" text-anchor="end" style="fill:#2f6fed;font-weight:700">ARV ${K.k(b.value)}</text>` : ''}
      <line x1="${X(b.sqft)}" x2="${X(b.sqft)}" y1="${P.t}" y2="${H - P.b}" stroke="#7a5af8" stroke-width="1.5" stroke-dasharray="4 4"/><text x="${X(b.sqft) + (X(b.sqft) > W * .6 ? -5 : 5)}" y="${P.t + 10}" text-anchor="${X(b.sqft) > W * .6 ? 'end' : 'start'}" style="fill:#7a5af8;font-weight:700">This house ${b.sqft.toLocaleString()} sf</text>
      ${cs.map(c => `<circle class="pt" cx="${X(c.sqft)}" cy="${Y(c.price)}" r="6" fill="${c.sold ? '#12b76a' : '#f79009'}" fill-opacity=".85" stroke="#fff" stroke-width="2" data-tip="<b>${esc(c.a)}</b><br>${$$(c.price)} · ${c.sqft.toLocaleString()} sf · $${c.ppsf || Math.round(c.price / c.sqft)}/sf<br>${c.mi != null ? c.mi + ' mi · ' : ''}${c.sold ? 'Sold' : 'Listed'}"/>`).join('')}
      <circle cx="${P.l + 4}" cy="${H - 10}" r="4" fill="#12b76a"/><text x="${P.l + 12}" y="${H - 6}">Sold</text><circle cx="${P.l + 52}" cy="${H - 10}" r="4" fill="#f79009"/><text x="${P.l + 60}" y="${H - 6}">Listed</text>
    </svg>`;
  };

  K.mountSnapshot = root => {
    if (!root) return;
    K.animate(root);
    root.querySelectorAll('[data-ladder]').forEach(card => {
      const d = JSON.parse(card.dataset.ladder), r = card.querySelector('input[type=range]');
      const upd = () => {
        const v = +r.value, p = (v - r.min) / (r.max - r.min) * 100; r.style.setProperty('--p', p + '%');
        card.querySelector('.so').textContent = $$(v);
        const fee = d.buyer - v, seller = d.owed ? v - d.owed : v;
        const o = (cls, val, good) => { const el = card.querySelector('.' + cls); el.className = cls + (good == null ? '' : good ? ' good' : ' bad'); el.querySelector('b').textContent = val; };
        o('o1', $$(fee), fee >= 5000);
        o('o2', $$(seller), d.owed ? seller > 0 : null);
        if (d.asking) { const diff = v - d.asking; o('o3', (diff > 0 ? '+' : '') + $$(diff), diff <= 0); }
        else o('o3', Math.round(v / d.value * 100) + '%', v / d.value <= .7);
      };
      r.addEventListener('input', upd); upd();
    });
  };

  // ── Shell: brand mark, top bar, command palette, usage meter ──
  const PAGES = [
    ['Leads', '/app#leads', 'inbox', 'Your funnel leads'], ['Deals', '/underwriting', 'deal', 'Pipeline, underwriting, contracts'],
    ['Run an address', '/operator', 'search', 'Comps, ARV, repairs, offer, mortgage'], ['Batch', '/batch', 'list', 'Up to 10 addresses at once'],
    ['Photo estimate', '/photos', 'camera', 'Repair budget from photos'], ['Owner lists', '/list', 'pin', 'Pull owners by ZIP'],
    ['Funnel & business', '/app#funnel', 'funnel', 'Your funnel link and details'], ['Plan & account', '/app#account', 'user', 'Billing, usage, password'],
  ];
  let me = null, leadCache = null;
  const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
  K.greet = greet;

  function shell() {
    const side = document.querySelector('.side'), main = document.querySelector('main.page');
    if (!side || !main) return;
    const bb = side.querySelector('.brandbox');
    if (bb && !bb.querySelector('.mark')) {
      bb.insertAdjacentHTML('afterbegin', '<span class="mark"><svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17l-5.9 3.3 1.3-6.5L2.5 9.3l6.6-.8z"/></svg></span>');
      const logo = bb.querySelector('.logo'), ws = bb.querySelector('.ws'); const box = document.createElement('div'); box.className = 'bt'; bb.appendChild(box); if (logo) box.appendChild(logo); if (ws) box.appendChild(ws);
    }
    if (!main.querySelector('.topbar')) {
      main.insertAdjacentHTML('afterbegin', `<div class="topbar"><button class="cmd" type="button" id="jkCmd">${svg('search')}<span>Search leads or type an address to run…</span><kbd>${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'} K</kbd></button><span class="sp"></span>
        <a class="btn quick" href="/operator">${svg('bolt')} Run an address</a>
        <div style="position:relative"><button class="ava" type="button" id="jkAva" aria-label="Account menu">${svg('user')}</button></div></div>`);
      document.getElementById('jkCmd').onclick = palette;
      document.getElementById('jkAva').onclick = e => { e.stopPropagation(); menu(); };
    }
  }
  function menu() {
    const host = document.getElementById('jkAva').parentElement, ex = host.querySelector('.menu'); if (ex) { ex.remove(); return; }
    host.insertAdjacentHTML('beforeend', `<div class="menu">${me ? `<div class="mwho"><b>${esc(me.user.name)}</b>${esc(me.user.email)}</div>` : ''}<a href="/app#account">Plan &amp; account</a><a href="/app#funnel">Funnel &amp; business</a><a href="/support">Support</a>${me ? '<button type="button" id="jkOut">Log out</button>' : ''}</div>`);
    const out = document.getElementById('jkOut'); if (out) out.onclick = async () => { await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"action":"logout"}' }).catch(() => {}); location.href = '/login'; };
    setTimeout(() => document.addEventListener('click', function off(e) { if (!e.target.closest('.menu')) { host.querySelector('.menu')?.remove(); document.removeEventListener('click', off); } }), 0);
  }
  function meterbox(u) {
    const foot = document.querySelector('.side .foot'); if (!foot || !u?.limits || document.querySelector('.meterbox')) return;
    const lim = u.limits.runs || 0, used = u.runs || 0, extra = u.credits?.runs || 0, left = Math.max(0, lim - used) + extra;
    foot.insertAdjacentHTML('beforebegin', `<a class="meterbox" href="/app#account">${K.ring(lim ? Math.max(0, lim - used) / lim : 0, { size: 38, stroke: 4, track: 'rgba(255,255,255,.12)', grad: ['#ffd666', '#ffb020'] })}<div><b>${left.toLocaleString()} analyses left</b><small>${used.toLocaleString()} of ${lim.toLocaleString()} used this month</small></div></a>`);
    K.animate(document.querySelector('.meterbox'));
  }

  // ⌘K palette: pages, leads, and "run this address"
  function palette() {
    if (document.querySelector('.ck-back')) return;
    const back = document.createElement('div'); back.className = 'ck-back';
    back.innerHTML = `<div class="ck" role="dialog" aria-label="Search"><input type="text" placeholder="Search leads, jump to a page, or type an address…" autocomplete="off" spellcheck="false"><ul></ul><div class="foot"><span>↑↓ to move</span><span>Enter to open</span><span>Esc to close</span></div></div>`;
    document.body.appendChild(back);
    const inp = back.querySelector('input'), ul = back.querySelector('ul'); let items = [], sel = 0;
    const close = () => back.remove();
    back.addEventListener('mousedown', e => { if (e.target === back) close(); });
    const render = () => {
      const q = inp.value.trim(), ql = q.toLowerCase(); items = []; let html = '';
      if (/^\d+\s+\S+/.test(q)) { items.push({ href: '/operator?a=' + encodeURIComponent(q) }); html += `<li class="sec">Run numbers</li><li data-i="0"><span class="ic">${svg('bolt')}</span><div>Run “${esc(q)}”<small>Comps, ARV, repairs, offer and mortgage</small></div><span class="go">Enter</span></li>`; }
      const ls = (leadCache || []).filter(l => { const L = l.lead || {}; return ql && [L.firstName, L.lastName, L.street, L.city, L.zip].join(' ').toLowerCase().includes(ql); }).slice(0, 6);
      if (ls.length) { html += '<li class="sec">Leads</li>'; ls.forEach(l => { const L = l.lead || {}, nm = [L.firstName, L.lastName].filter(Boolean).join(' ') || 'Seller'; items.push({ href: '/app#leads/' + l.id }); html += `<li data-i="${items.length - 1}">${K.avatar(nm)}<div>${esc(nm)}<small>${esc(L.street || '')}${L.city ? ', ' + esc(L.city) : ''}${l.brief?.mao ? ' · up to ' + K.k(l.brief.mao) : ''}</small></div>${l.brief?.label ? `<span class="pill ${l.brief.label}" style="margin-left:auto">${l.brief.label[0] + l.brief.label.slice(1).toLowerCase()}</span>` : ''}</li>`; }); }
      const ps = PAGES.filter(p => !ql || (p[0] + ' ' + p[3]).toLowerCase().includes(ql));
      if (ps.length) { html += '<li class="sec">Go to</li>'; ps.forEach(p => { items.push({ href: p[1] }); html += `<li data-i="${items.length - 1}"><span class="ic">${svg(p[2])}</span><div>${esc(p[0])}<small>${esc(p[3])}</small></div></li>`; }); }
      ul.innerHTML = html || '<li class="sec">No matches. Type a street address to run it.</li>';
      sel = Math.min(sel, items.length - 1); mark();
    };
    const mark = () => ul.querySelectorAll('li[data-i]').forEach(li => li.classList.toggle('on', +li.dataset.i === sel));
    const go = i => { const it = items[i]; if (!it) return; close(); if (it.href.startsWith(location.pathname + '#') || (location.pathname === '/app' && it.href.startsWith('/app#'))) location.hash = it.href.split('#')[1]; else location.href = it.href; };
    ul.addEventListener('mousemove', e => { const li = e.target.closest('li[data-i]'); if (li) { sel = +li.dataset.i; mark(); } });
    ul.addEventListener('click', e => { const li = e.target.closest('li[data-i]'); if (li) go(+li.dataset.i); });
    inp.addEventListener('input', () => { sel = 0; render(); });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); mark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
      else if (e.key === 'Enter') { e.preventDefault(); go(sel); }
    });
    render(); inp.focus();
    if (!leadCache && me) fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"action":"list"}' }).then(r => r.ok ? r.json() : null).then(j => { leadCache = j?.leads || []; if (back.isConnected) render(); }).catch(() => {});
  }
  K.setLeads = l => { leadCache = l; };
  document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); palette(); } });

  const start = () => {
    shell();
    fetch('/api/auth?action=me&usage=1', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).then(j => {
      if (!j?.user || j.plan?.tier === 'trial') return;
      me = j; const a = document.getElementById('jkAva'); if (a) { a.textContent = K.initials(j.user.name); }
      meterbox(j.usage);
    }).catch(() => {});
  };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
})();
