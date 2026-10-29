import crypto from 'node:crypto';

const $ = n => (n == null || !isFinite(n) ? '—' : (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString());
const $k = n => (n == null || !isFinite(n) ? '—' : (n < 0 ? '-$' : '$') + (Math.abs(n) >= 1000 ? (Math.abs(n) / 1000).toFixed(Math.abs(n) >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'k' : Math.round(Math.abs(n))));
const pct = n => (n == null || !isFinite(n) ? '—' : (n * 100).toFixed(1).replace(/\.0$/, '') + '%');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const LABELS = {
  timeline: { asap: 'ASAP', '30': '< 30 days', '90': '1–3 months', later: '3+ months', unsure: 'Just exploring' },
  reason: { inherited: 'Inherited', repairs: 'Too many repairs', landlord: 'Tired landlord', relocating: 'Relocating', divorce: 'Divorce', behind: 'Behind on payments', downsizing: 'Downsizing', other: 'Other' },
  occupancy: { owner: 'Owner-occupied', tenant: 'Tenant', vacant: 'Vacant' },
  owed: { free_clear: 'Free & clear', mortgage: 'Has mortgage', unsure: 'Mortgage unsure' },
  leaseEnd: { mtm: 'Month-to-month', lt3: 'Ends < 3 mo', '3to6': 'Ends in 3–6 mo', '6to12': 'Ends in 6–12 mo', gt12: '12+ mo left' },
  tenantPaying: { yes: 'Pays on time', late: 'Sometimes late', behind: 'Behind / not paying' },
  condition: { turnkey: 'Move-in ready', cosmetic: 'Cosmetic', moderate: 'Needs updating', heavy: 'Major repairs', gut: 'Full gut' },
};
const lbl = (k, v) => LABELS[k]?.[v] || v || '—';

// ── Webhook (GoHighLevel / Zapier / Make / Google Sheets via Apps Script) ──
export async function sendWebhook(payload) {
  const url = process.env.LEAD_WEBHOOK_URL;
  if (!url) return { skipped: true };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok, status: res.status };
}

// ── One-line summary (subject line + SMS) ──
export function summaryLine(p) {
  const a = p.analysis;
  const pick = a?.strategies.find(s => s.key === a.recommended);
  const ws = a?.strategies.find(s => s.key === 'wholesale');
  return `[${p.score?.label}] ${p.lead.address} · ${pick ? pick.name.split(' (')[0] : 'Review'}${ws ? ` · MAO ${$k(ws.headline.value)}` : ''}`;
}

export function smsText(p) {
  const a = p.analysis, l = p.lead;
  if (!a) return `${p.score?.label} lead: ${l.address}. ${l.firstName} ${l.phone}. No numbers (check comps/sqft).`;
  const [ws, fl, sf] = a.strategies;
  const pick = a.strategies.find(s => s.key === a.recommended);
  return [
    `${p.score.label} LEAD: ${l.address}`,
    `${l.firstName} ${l.phone} · ${lbl('timeline', l.timeline)} · ${lbl('condition', l.condition)}`,
    ...(l.occupancy === 'tenant' ? [`TENANT: ${l.currentRent ? $k(l.currentRent) + '/mo' : 'rent ?'} · ${lbl('leaseEnd', l.leaseEnd)} · ${lbl('tenantPaying', l.tenantPaying)}`] : []),
    `ARV ${$k(p.valuation.arv)} · Rehab ${$k(p.repairs?.total)}`,
    `WHOLESALE: offer ${$k(ws.headline.value)} (open ${$k(ws.headline.opening)}), sell ${$k(ws.pitch.price)}${ws.pitch.buyer === 'landlord' ? ' to landlord' : ''}`,
    ...(fl ? [`FLIP: max ${$k(fl.headline.value)}, nets ${$k(fl.yourProfit)} at MAO`] : []),
    ...(sf ? [`SELLER FIN: ${sf.headline.value ? `${$k(sf.headline.value)}, ${$k(sf.numbers.find(n => n[0] === 'Monthly cash flow')?.[1])}/mo` : 'n/a'}`] : []),
    a.mode === 'wholesale'
      ? `CALL: ${a.outOfBox ? 'Outside buy box' : !a.recommended ? 'Pass' : a.why.split('. ')[0]}`
      : `PLAY: ${pick ? pick.name.split(' (')[0] : a.outOfBox ? 'Outside buy box (ARV over limit)' : 'Pass'}`,
  ].join('\n');
}

// ── Instant phone alert via ntfy (free app, no carrier registration) ──
// Install the ntfy app, subscribe to your topic, set NTFY_TOPIC to the same long random name.
export async function sendPush(payload) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return { skipped: true };
  const server = process.env.NTFY_SERVER || 'https://ntfy.sh';
  const label = payload.score?.label || 'NEW';
  const headers = {
    Title: `${label} lead: ${payload.lead.street}`,
    Priority: label === 'HOT' ? 'high' : label === 'WARM' ? 'default' : 'low',
    Tags: label === 'HOT' ? 'fire,house' : 'house',
  };
  if (payload.lead.phone) headers.Actions = `view, Call ${payload.lead.firstName}, tel:${payload.lead.phone.replace(/[^\d+]/g, '')}`;
  if (process.env.NTFY_TOKEN) headers.Authorization = `Bearer ${process.env.NTFY_TOKEN}`;
  const res = await fetch(`${server}/${encodeURIComponent(topic)}`, { method: 'POST', headers, body: smsText(payload) });
  return { ok: res.ok, status: res.status };
}

// ── Text alert to you via Twilio ──
export async function sendSms(payload) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: tok, TWILIO_FROM: from, NOTIFY_SMS_TO: to } = process.env;
  if (!sid || !tok || !from || !to) return { skipped: true };
  const results = [];
  for (const num of to.split(',').map(s => s.trim()).filter(Boolean)) {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: from, To: num, Body: smsText(payload) }),
    });
    results.push(res.status);
  }
  return { ok: true, results };
}

// ── Email deal sheet via Resend ──
export async function sendEmail(payload) {
  const key = process.env.RESEND_API_KEY;
  // NOTIFY_EMAIL plus optional NOTIFY_EMAIL_EXTRA (both may be comma-separated)
  const to = [process.env.NOTIFY_EMAIL, process.env.NOTIFY_EMAIL_EXTRA].filter(Boolean).join(',');
  const from = process.env.NOTIFY_FROM || 'Leads <onboarding@resend.dev>';
  if (!key || !to) {
    // Local testing: save the deal sheet to a file instead of emailing it
    if (process.env.DEV_SAVE_DIR) {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync(process.env.DEV_SAVE_DIR, { recursive: true });
      const file = `${process.env.DEV_SAVE_DIR}/${new Date().toISOString().replace(/[:.]/g, '-')}-${payload.lead.street.replace(/\W+/g, '-')}.html`;
      writeFileSync(file, dealSheetHtml(payload));
      console.log(`\n📄 Deal sheet saved → ${file}\n${smsText(payload)}\n`);
      return { saved: file };
    }
    console.warn(`email skipped: ${!key ? 'RESEND_API_KEY' : 'NOTIFY_EMAIL'} not set`);
    return { skipped: true };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: to.split(',').map(s => s.trim()),
      subject: summaryLine(payload),
      html: dealSheetHtml(payload),
      text: smsText(payload),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 500)}`);
  }
  console.log('email sent', res.status);
  return { ok: res.ok, status: res.status };
}

// ── Deal sheet (email-safe HTML: tables + inline styles) ──
const C = { ink: '#0f1729', muted: '#5b6578', line: '#e3e8f0', soft: '#f5f7fb', navy: '#0c1a33', brand: '#1a3f8f', gold: '#b8913f', goldSoft: '#f8f1e2', good: '#137a4b', goodSoft: '#e7f5ee', bad: '#b42318', badSoft: '#fdecea' };
const SCORE_COLOR = { HOT: [C.bad, C.badSoft], WARM: [C.gold, C.goldSoft], COLD: [C.muted, C.soft], REVIEW: [C.muted, C.soft] };

function kv(rows, cols = 2) {
  const cells = rows.map(([k, v]) => `<td style="padding:8px 10px;vertical-align:top;width:${100 / cols}%"><div style="font-size:11px;color:${C.muted};text-transform:uppercase;letter-spacing:.06em">${esc(k)}</div><div style="font-size:15px;font-weight:600;color:${C.ink};margin-top:2px">${v}</div></td>`);
  let out = '';
  for (let i = 0; i < cells.length; i += cols) out += `<tr>${cells.slice(i, i + cols).join('')}${'<td></td>'.repeat(Math.max(0, cols - cells.slice(i, i + cols).length))}</tr>`;
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${out}</table>`;
}

function section(title, body) {
  return `<tr><td style="padding:22px 24px 6px"><div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${C.muted};margin-bottom:10px">${title}</div>${body}</td></tr>`;
}

function strategyCard(s, recommended) {
  const rec = s.key === recommended;
  const border = rec ? C.brand : C.line;
  const tag = rec
    ? `<span style="background:${C.brand};color:#fff;font-size:10.5px;font-weight:700;letter-spacing:.08em;padding:3px 8px;border-radius:4px;text-transform:uppercase">Recommended</span>`
    : s.viable ? `<span style="background:${C.goodSoft};color:${C.good};font-size:10.5px;font-weight:700;letter-spacing:.08em;padding:3px 8px;border-radius:4px;text-transform:uppercase">Works</span>`
    : `<span style="background:${C.badSoft};color:${C.bad};font-size:10.5px;font-weight:700;letter-spacing:.08em;padding:3px 8px;border-radius:4px;text-transform:uppercase">Thin</span>`;
  const head = s.headline.value != null
    ? `<div style="font-size:11px;color:${C.muted};text-transform:uppercase;letter-spacing:.06em">${esc(s.headline.label)}</div>
       <div style="font-size:30px;font-weight:800;color:${C.ink};letter-spacing:-.02em;line-height:1.1">${$(s.headline.value)}</div>
       ${s.headline.opening ? `<div style="font-size:13px;color:${C.muted}">Open at ${$(s.headline.opening)}</div>` : ''}
       ${s.headline.terms ? `<div style="font-size:13px;color:${C.muted}">${esc(s.headline.terms)}</div>` : ''}`
    : `<div style="font-size:15px;color:${C.muted}">Not enough data</div>`;
  const numbers = s.numbers.length ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:13px;margin-top:12px;border-top:1px solid ${C.line}">
      ${s.numbers.map(([k, v]) => `<tr><td style="padding:6px 0;color:${C.muted};border-bottom:1px solid ${C.line}">${esc(k)}</td><td style="padding:6px 0;text-align:right;font-weight:600;color:${C.ink};border-bottom:1px solid ${C.line};font-variant-numeric:tabular-nums">${$(v)}</td></tr>`).join('')}
    </table>` : '';
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:${rec ? 2 : 1}px solid ${border};border-radius:10px;margin-bottom:14px;background:#fff">
    <tr><td style="padding:16px 18px 6px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
        <td style="font-size:16px;font-weight:700;color:${C.ink}">${esc(s.name)}</td><td style="text-align:right">${tag}</td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:6px 18px 4px">${head}</td></tr>
    <tr><td style="padding:6px 8px 0">${kv([
      ['Your profit', `${s.yourProfit == null ? '—' : $(s.yourProfit)}<div style="font-size:11.5px;font-weight:400;color:${C.muted}">${esc(s.yourProfitNote || '')}</div>`],
      ['Your cash in', `${$(s.capitalNeeded)}<div style="font-size:11.5px;font-weight:400;color:${C.muted}">${esc(s.capitalNote || '')}</div>`],
      ['Timeline', esc(s.timeline)],
    ], 3)}</td></tr>
    <tr><td style="padding:4px 18px 16px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.muted};margin:8px 0 6px">Why</div>
      <ul style="margin:0;padding-left:18px;color:${C.ink};font-size:13.5px;line-height:1.55">${s.reasoning.map(r => `<li style="margin-bottom:4px">${esc(r)}</li>`).join('')}</ul>
      ${numbers}
    </td></tr>
  </table>`;
}

export function dealSheetHtml(p) {
  const { lead: l, valuation: v = {}, analysis: a, comps = [], score = {}, links = {}, repairs, offers = [] } = p;
  const [sc, scBg] = SCORE_COLOR[score.label] || SCORE_COLOR.REVIEW;
  const ws = a?.strategies.find(s => s.key === 'wholesale');

  const header = `<tr><td style="background:${C.navy};padding:22px 24px;color:#fff">
    <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#c6a052;font-weight:700">JStar Acquisitions · New lead</div>
    <div style="font-size:22px;font-weight:800;margin:6px 0 4px;letter-spacing:-.01em">${esc(l.address)}</div>
    <div style="font-size:14px;color:#c3cde0">${esc(l.firstName)} ${esc(l.lastName)} · <a href="tel:${esc(l.phone)}" style="color:#fff">${esc(l.phone)}</a>${l.email ? ` · <a href="mailto:${esc(l.email)}" style="color:#fff">${esc(l.email)}</a>` : ''}</div>
  </td></tr>
  <tr><td style="padding:16px 24px 0">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${scBg};border-radius:8px"><tr>
      <td style="padding:12px 14px;width:90px"><div style="font-size:22px;font-weight:800;color:${sc}">${esc(score.label)}</div><div style="font-size:12px;color:${C.muted}">score ${score.score ?? '—'}</div></td>
      <td style="padding:12px 14px;font-size:13px;color:${C.ink};line-height:1.5">${esc((score.reasons || []).join(' · '))}</td>
    </tr></table>
  </td></tr>`;

  const recommend = a ? `<tr><td style="padding:18px 24px 0">
    <div style="border-left:3px solid ${C.gold};padding:4px 0 4px 14px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${C.gold}">${a.mode === 'wholesale' ? 'The call' : 'The play'}</div>
      <div style="font-size:17px;font-weight:700;color:${C.ink};margin-top:4px">${a.mode === 'wholesale'
        ? (a.outOfBox ? 'Outside buy box: pass or refer' : !a.recommended ? 'Pass' : `Offer ${$(a.strategies[0].headline.opening)}, max ${$(a.strategies[0].headline.value)}`)
        : (a.recommended ? esc(a.strategies.find(s => s.key === a.recommended).name) : a.outOfBox ? 'Outside buy box: pass or refer' : 'Pass')}</div>
      <div style="font-size:14px;color:${C.ink};line-height:1.5;margin-top:4px">${esc(a.why)}</div>
    </div>
  </td></tr>` : `<tr><td style="padding:18px 24px 0;color:${C.bad};font-size:14px">No numbers computed. ${esc((v.notes || []).join(' · '))}</td></tr>`;

  const seller = section('What the seller told us', kv([
    ['Property', `${esc(l.propertyTypeLabel || '')} · ${l.bedrooms ?? '?'}bd / ${l.bathrooms ?? '?'}ba · ${l.sqft ? l.sqft.toLocaleString() : '?'} sqft · built ${l.yearBuilt ?? '?'}`],
    ['Condition', `${esc(lbl('condition', l.condition))}${l.issues?.length ? ` · ${esc(l.issues.map(i => ({ hvac: 'HVAC', water_damage: 'water damage' })[i] || i).join(', '))}` : ''}`],
    ['Timeline', esc(lbl('timeline', l.timeline))], ['Reason', esc(lbl('reason', l.reason))],
    ['Occupancy', esc(lbl('occupancy', l.occupancy))], ['Mortgage', esc(lbl('owed', l.owed))],
    ...(l.occupancy === 'tenant' ? [
      ['Current rent', l.currentRent ? `${$(l.currentRent)}/mo${p.valuation?.marketRent ? ` <span style="font-weight:400;color:${C.muted};font-size:12.5px">market ~${$(p.valuation.marketRent)}</span>` : ''}` : 'Not given'],
      ['Lease / tenant', `${esc(lbl('leaseEnd', l.leaseEnd))} · ${esc(lbl('tenantPaying', l.tenantPaying))}`],
    ] : []),
    ['Asking', esc(l.asking || '—')], ['Source', `${esc(l.tracking?.utm_source || 'direct')}${l.tracking?.utm_campaign ? ' / ' + esc(l.tracking.utm_campaign) : ''}`],
  ]) + (l.reasonDetail ? `<div style="margin:8px 10px 0;padding:12px 14px;background:${C.soft};border-radius:8px;font-size:14px;line-height:1.5;color:${C.ink};font-style:italic">“${esc(l.reasonDetail)}”</div>` : ''));

  const strategies = a ? section(a.mode === 'wholesale' ? 'Your wholesale deal' : 'Three ways to do this deal', a.strategies.map(s => strategyCard(s, a.recommended)).join('')) : '';

  const pitch = ws ? section('Investor pitch (copy & send to your buyers list)', `
    <div style="background:${C.soft};border:1px dashed ${C.line};border-radius:8px;padding:14px;font-size:14px;line-height:1.6;color:${C.ink}">
      <b>${esc(l.city)}, ${esc(l.state)} · ${l.bedrooms ?? '?'}/${l.bathrooms ?? '?'} · ${l.sqft ? l.sqft.toLocaleString() : '?'} sqft · built ${l.yearBuilt ?? '?'}</b><br>
      Price: <b>${$(ws.pitch.price)}</b> · ARV: <b>${$(ws.pitch.arv)}</b> · Rehab est: <b>${$(ws.pitch.repairs)}</b><br>
      ${ws.pitch.buyer === 'landlord'
        ? `Tenant in place at <b>${$(ws.pitch.rent)}/mo</b> · <b>${pct(ws.pitch.capRate)} cap rate</b> after repairs<br>`
        : `Projected profit: <b>${$(ws.pitch.profit)}</b> (${pct(ws.pitch.roi)} cash-on-cash, ~${ws.pitch.months} months)<br>`}
      <span style="color:${C.muted};font-size:12.5px">Assignment of contract. Buyer to verify all numbers. Exact address on request.</span>
    </div>`) : '';

  const valuation = section('Valuation', kv([
    ['ARV (after repair)', `${$(v.arv)} <span style="font-weight:400;color:${C.muted};font-size:12.5px">${esc(v.method || '')}</span>`],
    ['ARV range', v.arvRange ? `${$(v.arvRange.low)} – ${$(v.arvRange.high)}` : '—'],
    ['As-is value', `${$(v.asIs)}${v.avmLow ? ` <span style="font-weight:400;color:${C.muted};font-size:12.5px">(${$(v.avmLow)}–${$(v.avmHigh)})</span>` : ''}`],
    [v.rentSource === 'actual' ? 'Rent (tenant pays)' : 'Rent estimate', `${$(v.rent)}/mo${v.rentLow ? ` <span style="font-weight:400;color:${C.muted};font-size:12.5px">(${$(v.rentLow)}–${$(v.rentHigh)})</span>` : ''}`],
    ['Confidence', `<span style="color:${v.confidence === 'high' ? C.good : v.confidence === 'medium' ? C.gold : C.bad}">${esc(v.confidence || '—')}</span>`],
    ['Comps', `${comps.length} used of ${v.compsMatched ?? comps.length} matched`],
  ]) + ((v.notes || []).length ? `<div style="margin:8px 10px 0;padding:10px 12px;background:${C.goldSoft};border-radius:8px;font-size:13px;color:${C.ink};line-height:1.5">⚠ ${(v.notes).map(esc).join('<br>⚠ ')}</div>` : ''));

  const repairTbl = repairs ? section(`Repair estimate · ${$(repairs.total)}`, `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:13px">
    ${repairs.lines.map(r => `<tr><td style="padding:7px 0;border-bottom:1px solid ${C.line};color:${C.ink};font-weight:600">${esc(r.item)}<div style="font-weight:400;color:${C.muted}">${esc(r.why)}</div></td><td style="padding:7px 0;border-bottom:1px solid ${C.line};text-align:right;font-weight:600;vertical-align:top">${$(r.cost)}</td></tr>`).join('')}
  </table>`) : '';

  const td = `style="padding:7px 6px;border-bottom:1px solid ${C.line};font-variant-numeric:tabular-nums"`;
  const nw = `style="padding:7px 6px;border-bottom:1px solid ${C.line};font-variant-numeric:tabular-nums;white-space:nowrap;vertical-align:top"`;
  const compTbl = section('Best comps for this address', `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:13px">
    <tr style="text-align:left;color:${C.muted};font-size:11px;text-transform:uppercase;letter-spacing:.05em"><th ${nw}>Match</th><th ${td}>Comp</th><th ${nw} align="right">Price</th></tr>
    ${comps.map(c => `<tr>
      <td ${nw}><b style="color:${c.match >= 75 ? C.good : c.match >= 55 ? C.gold : C.muted}">${c.match}%</b></td>
      <td style="padding:7px 6px;border-bottom:1px solid ${C.line};vertical-align:top"><div style="font-weight:600;color:${C.ink}">${esc(String(c.formattedAddress || '').split(',')[0])}</div><div style="color:${C.muted};font-size:12px;line-height:1.45">${c.squareFootage?.toLocaleString() ?? '—'} sqft · ${c.bedrooms ?? '—'}/${c.bathrooms ?? '—'} · built ${c.yearBuilt ?? '—'}${c.distance != null ? ' · ' + c.distance.toFixed(2) + ' mi' : ''}<br>${c.sold ? 'Off-market' : 'Listed'} ${esc((c.removedDate || c.listedDate || '').slice(0, 10))}</div></td>
      <td ${nw} align="right"><b>${$(c.price)}</b><div style="color:${C.muted};font-size:12px">$${c.ppsf}/sf</div></td>
    </tr>`).join('') || `<tr><td ${td} colspan="3">No matching comps returned</td></tr>`}
  </table>`);

  const ladder = offers.length ? section('Wholesale offer if condition is different', `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:13px">
    <tr style="text-align:left;color:${C.muted};font-size:11px;text-transform:uppercase;letter-spacing:.05em"><th ${td}>Condition</th><th ${td} align="right">Repairs</th><th ${td} align="right">Open</th><th ${td} align="right">MAO</th></tr>
    ${offers.map(o => `<tr style="${o.sellerReported ? `background:${C.goldSoft};font-weight:600` : ''}"><td ${td}>${esc(o.label)}</td><td ${nw} align="right">${$(o.repairs)}</td><td ${nw} align="right">${$(o.opening)}</td><td ${nw} align="right"><b>${$(o.mao)}</b></td></tr>`).join('')}
  </table>`) : '';

  const linkRow = `<tr><td style="padding:18px 24px 26px;font-size:14px">
    <a href="${links.zillow}" style="color:${C.brand};font-weight:600">Zillow</a> &nbsp;·&nbsp; <a href="${links.redfin}" style="color:${C.brand};font-weight:600">Redfin</a> &nbsp;·&nbsp; <a href="${links.googleMaps}" style="color:${C.brand};font-weight:600">Map</a>
    <div style="font-size:12px;color:${C.muted};margin-top:10px;line-height:1.5">Automated estimate from RentCast data. Verify ARV with MLS comps and repairs with a walkthrough before signing.</div>
  </td></tr>`;

  return `<div style="background:#eef1f6;padding:20px 8px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:${C.ink}">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid ${C.line}">
    ${header}${recommend}${strategies}${pitch}${seller}${valuation}${repairTbl}${compTbl}${ladder}${linkRow}
  </table></div>`;
}

// ── Meta Conversions API (server-side Lead, dedupes with the browser pixel via event_id) ──
const sha = v => (v ? crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex') : undefined);

export async function sendMetaCAPI({ lead, eventId, ip, userAgent, sourceUrl }) {
  const pixel = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_TOKEN;
  if (!pixel || !token) return { skipped: true };
  const version = process.env.META_GRAPH_VERSION || 'v21.0';
  const phone = String(lead.phone || '').replace(/\D/g, '');
  const user_data = {
    em: lead.email ? [sha(lead.email)] : undefined,
    ph: phone ? [sha(phone.length === 10 ? '1' + phone : phone)] : undefined,
    fn: lead.firstName ? [sha(lead.firstName)] : undefined,
    zp: lead.zip ? [sha(lead.zip)] : undefined,
    st: lead.state ? [sha(lead.state)] : undefined,
    country: [sha('us')],
    client_ip_address: ip,
    client_user_agent: userAgent,
    fbc: lead.tracking?.fbc,
    fbp: lead.tracking?.fbp,
  };
  const body = {
    data: [{
      event_name: 'Lead',
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: 'website',
      event_source_url: sourceUrl,
      user_data,
    }],
  };
  if (process.env.META_TEST_EVENT_CODE) body.test_event_code = process.env.META_TEST_EVENT_CODE;
  const res = await fetch(`https://graph.facebook.com/${version}/${pixel}/events?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status };
}
