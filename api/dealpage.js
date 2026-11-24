// Buyer-facing deal page: a public link per deal (/d/<token>) where cash buyers see the property and numbers,
// make an offer or request a showing. Offers land on the deal and the wholesaler gets an email.
//   GET  /d/<token>              the page (served through vercel.json rewrite → ?t=)
//   GET  /d/<token>/<photo>.jpg  a photo
//   POST { t, action: 'offer' }  public: a buyer's offer or showing request
//   POST { action: get | save | addPhoto | removePhoto | offerStatus, dealId }   signed in: manage the page
// Docs: <base>/dpage/<dealId> page settings · dp/<token> → { scope, dealId } · dpimg/<token>/<id> photo
//       <base>/doffers/<dealId> { items: [...] }
import crypto from 'node:crypto';
import { getActor, getUserById, bizOf, OWNER_BIZ, sendPlainEmail } from '../lib/auth.js';
import { getDeal, saveDeal } from '../lib/store.js';
import { getDoc, putDoc, deleteDoc } from '../lib/db.js';
import { layout, p as P, rows as R, button } from '../lib/email.js';

export const maxDuration = 30;
const base = sc => (sc ? `t/${sc}` : 'owner');
const ID = /^[a-z0-9]{6,32}$/, TOK = /^[a-z0-9]{10,24}$/, PID = /^[a-z0-9]{6,20}$/;
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/i;
const MAX_PHOTOS = 15, MAX_OFFERS = 200;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const str = (v, n = 120) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, n);
const num = v => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };
const $$ = n => (n ? '$' + Math.round(n).toLocaleString() : '');
const fmtPh = v => { const d = String(v || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(v || ''); };
const tok = () => crypto.randomBytes(9).toString('hex').replace(/[^a-z0-9]/g, '').slice(0, 14);
const pid = () => crypto.randomBytes(5).toString('hex');
const originOf = req => `https://${req.headers['x-forwarded-host'] || req.headers.host}`;

// Price buyers see: the page's price, else contract price + assignment fee
export function pagePrice(page, deal) { const n = deal?.numbers || {}; return page?.price || ((n.contractPrice || 0) + (n.assignmentFee || 0)) || null; }
function streetShown(page, deal) { const s = deal?.address?.street || ''; return page?.hideNumber ? s.replace(/^\s*[\d-]+[a-z]?\s+/i, '') : s; }
const pageUrl = (origin, t) => `${origin}/d/${t}`;

function cleanPage(x = {}, prev = {}) {
  const OCC = ['vacant', 'owner', 'tenant', 'unknown'];
  return {
    ...prev,
    on: !!x.on, price: num(x.price), showing: str(x.showing, 300), headline: str(x.headline, 120), desc: str(x.desc, 2500),
    beds: num(x.beds), baths: Number(String(x.baths || '').replace(/[^\d.]/g, '')) || null, sqft: num(x.sqft), yearBuilt: num(x.yearBuilt), lot: str(x.lot, 40),
    occupancy: OCC.includes(x.occupancy) ? x.occupancy : 'unknown', hideNumber: !!x.hideNumber, closeBy: str(x.closeBy, 40), emd: num(x.emd),
    updatedAt: Date.now(),
  };
}
async function loadPage(sc, dealId) { return getDoc(`${base(sc)}/dpage/${dealId}`).catch(() => null); }
async function ensurePage(sc, dealId) {
  let pg = await loadPage(sc, dealId);
  if (pg?.token) return pg;
  pg = { token: tok(), on: false, photos: [], createdAt: Date.now(), ...(pg || {}) };
  await putDoc(`dp/${pg.token}`, { scope: sc, dealId }, { keep: 1 });
  await putDoc(`${base(sc)}/dpage/${dealId}`, pg, { keep: 2 });
  return pg;
}
const offersOf = async (sc, dealId) => (await getDoc(`${base(sc)}/doffers/${dealId}`).catch(() => null))?.items || [];

async function bizFor(sc) {
  if (!sc) return { ...OWNER_BIZ, email: process.env.NOTIFY_EMAIL?.split(',')[0] || '', notify: process.env.NOTIFY_EMAIL?.split(',')[0] || '' };
  const u = await getUserById(sc); if (!u) return null;
  return { ...bizOf(u), notify: u.settings?.notifyEmail || u.email, active: !u.disabled };
}

// ── Public page ───────────────────────────────────────────
const OCC_L = { vacant: 'Vacant', owner: 'Owner occupied', tenant: 'Tenant occupied', unknown: '' };
function renderPage({ deal, page, biz, origin, offersCount }) {
  const a = deal.address || {}, n = deal.numbers || {};
  const price = pagePrice(page, deal), arv = n.arv || null, rep = n.repairs || null;
  const spread = arv && price ? arv - price - (rep || 0) - Math.round(arv * (n.buyerCostPct ?? 10) / 100) : null;
  const street = streetShown(page, deal), place = [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const title = page.headline || `${street}${a.city ? ', ' + a.city : ''}`;
  const photos = (page.photos || []).map(id => `/d/${page.token}/${id}.jpg`);
  const facts = [page.beds && `${page.beds} bd`, page.baths && `${page.baths} ba`, page.sqft && `${page.sqft.toLocaleString()} sf`, page.yearBuilt && `Built ${page.yearBuilt}`, page.lot && `Lot ${page.lot}`, OCC_L[page.occupancy]].filter(Boolean);
  const stats = [['Price', $$(price)], ['ARV', $$(arv)], ['Est. repairs', $$(rep)], ['Potential profit', spread > 0 ? $$(spread) : '']].filter(([, v]) => v);
  const company = biz.company || biz.signer || 'Off-market deal', phone = fmtPh(biz.phone);
  const ogImg = photos[0] ? origin + photos[0] : '';
  const desc = `${price ? $$(price) + ' · ' : ''}${arv ? 'ARV ' + $$(arv) + ' · ' : ''}${facts.slice(0, 3).join(' · ')}`;
  const closed = ['closed', 'dead', 'assigned'].includes(deal.status);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)} · ${esc(company)}</title><meta name="robots" content="noindex, nofollow"><meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc((price ? $$(price) + ' · ' : '') + title)}"><meta property="og:description" content="${esc(`Off-market from ${company}. ${desc}`)}">${ogImg ? `<meta property="og:image" content="${esc(ogImg)}"><meta name="twitter:card" content="summary_large_image">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..800&display=swap" rel="stylesheet">
<style>
:root{--bg:#f6f6f6;--card:#fff;--ink:#111;--ink2:#3d3d3d;--mut:#6b6b6b;--line:#e5e5e5;--acc:#ffc93c;--ok:#067647;--okbg:#ecfdf3;--err:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#0d0d0d;--card:#161616;--ink:#f2f2f2;--ink2:#cfcfcf;--mut:#9a9a9a;--line:#2a2a2a;--ok:#75e0a7;--okbg:#0f2a1d;--err:#ff9c8f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 Inter,system-ui,-apple-system,Segoe UI,sans-serif;letter-spacing:-.006em;-webkit-font-smoothing:antialiased}
a{color:inherit}.w{max-width:1120px;margin:0 auto;padding:0 20px}
header{background:#0a0a0a;color:#fff}header .w{display:flex;align-items:center;justify-content:space-between;gap:12px;height:64px}
header b{font-size:17px;letter-spacing:-.02em}header a.call{display:inline-flex;align-items:center;gap:8px;background:var(--acc);color:#111;font-weight:650;text-decoration:none;padding:9px 14px;border-radius:8px;font-size:14px;white-space:nowrap}
main{padding:28px 0 60px}.grid{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:28px;align-items:start}
.gal{display:grid;gap:8px}.gal .main{aspect-ratio:3/2;border-radius:14px;overflow:hidden;background:var(--line);position:relative}.gal .main img{width:100%;height:100%;object-fit:cover;display:block}
.gal .th{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none}.gal .th button{flex:none;width:92px;height:64px;border:2px solid transparent;border-radius:8px;overflow:hidden;padding:0;cursor:pointer;background:none}.gal .th button.on{border-color:var(--ink)}.gal .th img{width:100%;height:100%;object-fit:cover;display:block}
.gal .nav{position:absolute;top:50%;transform:translateY(-50%);width:40px;height:40px;border-radius:50%;border:0;background:rgba(0,0,0,.55);color:#fff;font-size:20px;cursor:pointer}.gal .prev{left:12px}.gal .next{right:12px}.gal .cnt{position:absolute;right:12px;bottom:12px;background:rgba(0,0,0,.6);color:#fff;font-size:12.5px;font-weight:600;padding:4px 9px;border-radius:99px}
.nophoto{aspect-ratio:3/2;border-radius:14px;background:repeating-linear-gradient(135deg,var(--card),var(--card) 12px,var(--bg) 12px,var(--bg) 24px);border:1px solid var(--line);display:grid;place-items:center;color:var(--mut);font-size:14px}
.tag{display:inline-block;font:700 11.5px/1 Inter,sans-serif;letter-spacing:.08em;text-transform:uppercase;background:var(--acc);color:#111;padding:6px 9px;border-radius:6px}
h1{font-size:clamp(26px,3.4vw,36px);line-height:1.12;letter-spacing:-.03em;margin:14px 0 4px;font-weight:700}.place{color:var(--mut);margin:0 0 6px}.facts{color:var(--ink2);font-size:15px;margin:0}
.stats{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);border-radius:14px;background:var(--card);margin:22px 0;overflow:hidden}.stats div{padding:16px 18px;border-left:1px solid var(--line)}.stats div:first-child{border-left:0}
.stats small{display:block;color:var(--mut);font-size:12.5px;font-weight:500}.stats b{font-size:22px;letter-spacing:-.02em;font-variant-numeric:tabular-nums}.stats div.hl b{color:var(--ok)}
.sec{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px;margin-bottom:16px}.sec h2{font-size:15px;margin:0 0 10px;letter-spacing:-.01em}.sec p{margin:0;color:var(--ink2);white-space:pre-line}
.kv{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;margin:0}.kv div{display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid var(--line);padding:8px 0;font-size:15px}.kv dt{color:var(--mut)}.kv dd{margin:0;font-weight:600;text-align:right}
aside .box{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px;position:sticky;top:20px;box-shadow:0 12px 32px rgba(0,0,0,.06)}
.price{font-size:32px;font-weight:750;letter-spacing:-.03em;font-variant-numeric:tabular-nums;margin:0}.price small{display:block;font-size:13px;color:var(--mut);font-weight:500;letter-spacing:0}
.seg{display:grid;grid-template-columns:1fr 1fr;background:var(--bg);border-radius:10px;padding:4px;margin:16px 0}.seg button{border:0;background:none;font:600 14px Inter,sans-serif;padding:9px;border-radius:7px;color:var(--mut);cursor:pointer}.seg button.on{background:var(--card);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.1)}
label{display:block;font-size:13px;font-weight:600;margin:12px 0 5px}input,select,textarea{width:100%;font:15px Inter,sans-serif;padding:11px 12px;border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--ink)}textarea{min-height:76px;resize:vertical}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--ink)}.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}.two label{margin-top:12px}
.go{width:100%;margin-top:16px;border:0;background:#111;color:#fff;font:650 15.5px Inter,sans-serif;padding:14px;border-radius:10px;cursor:pointer}@media (prefers-color-scheme:dark){.go{background:var(--acc);color:#111}}
.go:disabled{opacity:.6}.fine{font-size:12px;color:var(--mut);margin:10px 0 0}.err{color:var(--err);font-size:14px;margin-top:10px}.hp{position:absolute;left:-9999px}
.done{text-align:center;padding:20px 4px}.done .ck{width:52px;height:52px;border-radius:50%;background:var(--okbg);color:var(--ok);display:grid;place-items:center;margin:0 auto 12px;font-size:26px}.done h3{margin:0 0 6px;font-size:20px}.done p{color:var(--mut);margin:0}
.off{background:var(--bg);border-radius:10px;padding:16px;text-align:center;color:var(--ink2)}
.disc{font-size:12.5px;color:var(--mut);line-height:1.55;margin-top:22px}footer{border-top:1px solid var(--line);padding:22px 0;color:var(--mut);font-size:13px}footer a{color:var(--mut)}
.mbar{display:none}
@media (max-width:900px){.grid{grid-template-columns:1fr}aside .box{position:static}.stats{grid-template-columns:1fr 1fr}.stats div:nth-child(3){border-left:0}.stats div:nth-child(n+3){border-top:1px solid var(--line)}.kv{grid-template-columns:1fr}
.mbar{display:flex;position:fixed;left:0;right:0;bottom:0;gap:10px;padding:10px 16px calc(10px + env(safe-area-inset-bottom));background:var(--card);border-top:1px solid var(--line);z-index:5;align-items:center}.mbar b{font-size:19px;flex:1}.mbar a{background:#111;color:#fff;text-decoration:none;font-weight:650;padding:12px 18px;border-radius:10px;font-size:15px}main{padding-bottom:90px}}
@media (max-width:560px){header a.call span{display:none}.gal .th button{width:72px;height:52px}}
</style></head><body>
<header><div class="w"><b>${esc(company)}</b>${phone ? `<a class="call" href="tel:${esc(String(biz.phone).replace(/[^\d+]/g, ''))}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg><span>Call</span> ${esc(phone)}</a>` : ''}</div></header>
<main><div class="w grid"><div>
${photos.length ? `<div class="gal"><div class="main"><img id="gm" src="${photos[0]}" alt="${esc(street)}">${photos.length > 1 ? `<button class="nav prev" id="gp" aria-label="Previous photo">‹</button><button class="nav next" id="gn" aria-label="Next photo">›</button><span class="cnt" id="gc">1 / ${photos.length}</span>` : ''}</div>${photos.length > 1 ? `<div class="th">${photos.map((s, i) => `<button class="${i ? '' : 'on'}" data-i="${i}" aria-label="Photo ${i + 1}"><img src="${s}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}</div>` : '<div class="nophoto">Photos on request</div>'}
<div style="margin-top:22px"><span class="tag">Off-market</span></div>
<h1>${esc(title)}</h1>${page.headline ? `<p class="place">${esc([street, place].filter(Boolean).join(', '))}</p>` : `<p class="place">${esc(place)}</p>`}
${facts.length ? `<p class="facts">${esc(facts.join(' · '))}</p>` : ''}
${stats.length ? `<div class="stats">${stats.map(([k, v]) => `<div class="${k === 'Potential profit' ? 'hl' : ''}"><small>${k}</small><b>${v}</b></div>`).join('')}</div>` : ''}
${page.desc ? `<section class="sec"><h2>About the property</h2><p>${esc(page.desc)}</p></section>` : ''}
<section class="sec"><h2>Deal details</h2><dl class="kv">${[['Asking', $$(price)], ['After-repair value', $$(arv)], ['Estimated repairs', $$(rep)], ['Earnest money', $$(page.emd)], ['Close by', page.closeBy], ['Occupancy', OCC_L[page.occupancy]], ['Showings', page.showing], ['Property type', deal.propertyType && deal.propertyType.replace(/_/g, ' ')]].filter(([, v]) => v).map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></section>
<p class="disc">${esc(company)} has a contract to buy this property and is offering to assign that contract. We don't own the property and aren't selling it directly. Numbers are estimates for your own review: verify ARV, repairs and condition before you commit. Sold as-is. Cash or hard money only.</p>
</div>
<aside><div class="box" id="box">
<p class="price">${$$(price) || 'Make an offer'}<small>${price ? 'Asking price · cash or hard money' : 'Price on request'}</small></p>
${closed ? '<div class="off" style="margin-top:16px"><b>This deal is no longer available.</b><br>Call or reply to get first look at the next one.</div>' : `
<div class="seg" role="tablist"><button type="button" class="on" data-k="offer">Make an offer</button><button type="button" data-k="showing">Request a showing</button></div>
<form id="of" autocomplete="on" novalidate>
<div id="fOffer"><label for="fPrice">Your offer</label><input id="fPrice" inputmode="numeric" placeholder="${esc($$(price) || '$')}" autocomplete="off">
<div class="two"><div><label for="fClose">Close in</label><select id="fClose"><option>7 days</option><option selected>14 days</option><option>21 days</option><option>30 days</option><option>Flexible</option></select></div><div><label for="fPof">Funding</label><select id="fPof"><option value="cash">Cash (POF)</option><option value="hard">Hard money</option><option value="other">Other</option></select></div></div></div>
<div id="fShow" hidden><label for="fWhen">When works for you?</label><input id="fWhen" placeholder="Tomorrow after 3pm"></div>
<label for="fName">Name</label><input id="fName" autocomplete="name" required>
<div class="two"><div><label for="fEmail">Email</label><input id="fEmail" type="email" autocomplete="email"></div><div><label for="fPhone">Phone</label><input id="fPhone" type="tel" autocomplete="tel"></div></div>
<label for="fNote">Notes <span style="font-weight:400;color:var(--mut)">optional</span></label><textarea id="fNote" placeholder="Anything we should know"></textarea>
<input class="hp" id="fWeb" tabindex="-1" autocomplete="off" aria-hidden="true">
<button class="go" id="fGo" type="submit">Send my offer</button><div class="err" id="fErr" role="alert"></div>
<p class="fine">Not a binding contract. ${esc(company)} will reach out to confirm.${offersCount >= 3 ? ` ${offersCount} buyers have already made offers.` : ''}</p>
</form>`}
</div></aside></div></main>
${price && !closed ? `<div class="mbar"><b>${$$(price)}</b><a href="#box">Make an offer</a></div>` : ''}
<footer><div class="w">${esc(company)}${phone ? ' · ' + esc(phone) : ''} · <a href="https://getjstarpro.com/?ref=deal" rel="nofollow">Powered by JStar Pro</a></div></footer>
<script>
(() => {
  const P = ${JSON.stringify(photos)}; let i = 0; const m = document.getElementById('gm');
  const go = k => { if (!m) return; i = (k + P.length) % P.length; m.src = P[i]; const c = document.getElementById('gc'); if (c) c.textContent = (i + 1) + ' / ' + P.length; document.querySelectorAll('.th button').forEach((b, j) => b.classList.toggle('on', j === i)); };
  document.querySelectorAll('.th button').forEach(b => b.onclick = () => go(+b.dataset.i));
  const gp = document.getElementById('gp'), gn = document.getElementById('gn'); if (gp) { gp.onclick = () => go(i - 1); gn.onclick = () => go(i + 1); }
  const f = document.getElementById('of'); if (!f) return; let kind = 'offer';
  const $ = id => document.getElementById(id);
  document.querySelectorAll('.seg button').forEach(b => b.onclick = () => { kind = b.dataset.k; document.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b)); $('fOffer').hidden = kind !== 'offer'; $('fShow').hidden = kind !== 'showing'; $('fGo').textContent = kind === 'offer' ? 'Send my offer' : 'Request a showing'; });
  $('fPrice').addEventListener('input', e => { const d = e.target.value.replace(/\\D/g, ''); e.target.value = d ? '$' + Number(d).toLocaleString() : ''; });
  f.addEventListener('submit', async e => {
    e.preventDefault(); $('fErr').textContent = '';
    const body = { t: ${JSON.stringify(page.token)}, action: 'offer', kind, price: $('fPrice').value, close: $('fClose').value, pof: $('fPof').value, when: $('fWhen').value, name: $('fName').value, email: $('fEmail').value, phone: $('fPhone').value, note: $('fNote').value, web: $('fWeb').value };
    if (!body.name.trim()) { $('fErr').textContent = 'Add your name.'; return; }
    if (!body.email.trim() && !body.phone.trim()) { $('fErr').textContent = 'Add an email or phone so we can reach you.'; return; }
    if (kind === 'offer' && !body.price) { $('fErr').textContent = 'Enter your offer.'; return; }
    $('fGo').disabled = true;
    const r = await fetch('/api/dealpage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async x => ({ ok: x.ok, j: await x.json().catch(() => ({})) })).catch(() => ({ ok: false, j: {} }));
    $('fGo').disabled = false;
    if (!r.ok) { $('fErr').textContent = r.j.error || 'That didn\\'t go through. Try again or call us.'; return; }
    f.outerHTML = '<div class="done"><div class="ck">✓</div><h3>' + (kind === 'offer' ? 'Offer sent' : 'Request sent') + '</h3><p>We\\'ll get back to you shortly' + (${JSON.stringify(phone)} ? ', or call ' + ${JSON.stringify(phone)} : '') + '.</p></div>';
    document.querySelector('.seg')?.remove();
  });
})();
</script></body></html>`;
}

function notFound(res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(404).send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Deal not available</title><body style="font:16px/1.6 Inter,system-ui,sans-serif;max-width:460px;margin:90px auto;padding:0 20px;color:#111"><h1 style="font-size:22px">This deal isn\'t available</h1><p style="color:#666">It may have sold or the link was turned off. Reach out to whoever sent it to you for their next deal.</p></body>');
}

async function resolve(t) {
  if (!TOK.test(String(t || ''))) return null;
  const ref = await getDoc(`dp/${t}`).catch(() => null); if (!ref) return null;
  const [page, deal] = await Promise.all([loadPage(ref.scope, ref.dealId), getDeal(ref.dealId, ref.scope)]);
  if (!page || page.token !== t || !deal) return null;
  return { ...ref, page, deal };
}

export default async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex');
  const q = req.query || {};
  // ── Public GETs ──
  if (req.method === 'GET') {
    const t = String(q.t || '');
    if (q.img) {
      const id = String(q.img).replace(/\.jpg$/, '');
      if (!TOK.test(t) || !PID.test(id)) return res.status(404).end();
      const d = await getDoc(`dpimg/${t}/${id}`).catch(() => null);
      if (!d?.data) return res.status(404).end();
      const m = String(d.data).match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/); if (!m) return res.status(404).end();
      res.setHeader('Content-Type', m[1]); res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      return res.status(200).send(Buffer.from(m[2], 'base64'));
    }
    const r = await resolve(t);
    if (!r || !r.page.on) return notFound(res);
    const biz = await bizFor(r.scope); if (!biz || biz.active === false) return notFound(res);
    const n = (await offersOf(r.scope, r.dealId)).filter(o => o.kind === 'offer').length;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(renderPage({ deal: r.deal, page: r.page, biz, origin: originOf(req), offersCount: n }));
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Not allowed' });
  res.setHeader('Cache-Control', 'no-store');
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

  // ── Public: buyer offer / showing request ──
  if (b.action === 'offer') {
    if (b.web) return res.status(200).json({ ok: true }); // honeypot
    const r = await resolve(b.t);
    if (!r || !r.page.on || ['closed', 'dead', 'assigned'].includes(r.deal.status)) return res.status(404).json({ error: 'This deal isn\'t available anymore.' });
    const kind = b.kind === 'showing' ? 'showing' : 'offer';
    const o = { id: pid(), at: Date.now(), kind, name: str(b.name, 80), email: str(b.email, 120).toLowerCase(), phone: str(b.phone, 30), price: kind === 'offer' ? num(b.price) : null,
      close: kind === 'offer' ? str(b.close, 30) : '', pof: kind === 'offer' && ['cash', 'hard', 'other'].includes(b.pof) ? b.pof : '', when: kind === 'showing' ? str(b.when, 120) : '', note: str(b.note, 1000), status: 'new' };
    if (!o.name) return res.status(400).json({ error: 'Add your name.' });
    if (!EMAIL.test(o.email) && o.phone.replace(/\D/g, '').length < 10) return res.status(400).json({ error: 'Add a valid email or phone so we can reach you.' });
    if (o.email && !EMAIL.test(o.email)) o.email = '';
    if (kind === 'offer' && (!o.price || o.price < 1000)) return res.status(400).json({ error: 'Enter your offer price.' });
    const items = await offersOf(r.scope, r.dealId);
    if (items.length >= MAX_OFFERS) return res.status(429).json({ error: 'This deal has too many requests right now. Call us instead.' });
    if (items.some(x => x.at > Date.now() - 60e3 && ((o.email && x.email === o.email) || (o.phone && x.phone === o.phone)))) return res.status(200).json({ ok: true });
    await putDoc(`${base(r.scope)}/doffers/${r.dealId}`, { items: [...items, o] }, { keep: 2 });
    const fresh = await getDeal(r.dealId, r.scope);
    if (fresh) await saveDeal({ ...fresh, history: [...(fresh.history || []), { at: o.at, text: kind === 'offer' ? `Offer from ${o.name}: ${$$(o.price)}` : `Showing request from ${o.name}` }].slice(-50) }, r.scope).catch(() => {});
    const biz = await bizFor(r.scope);
    if (biz?.notify) {
      const a = r.deal.address || {}, street = a.street || 'your deal', origin = originOf(req);
      const subject = kind === 'offer' ? `${$$(o.price)} offer on ${street} from ${o.name}` : `Showing request for ${street} from ${o.name}`;
      const lines = [['Buyer', o.name], ['Offer', $$(o.price)], ['Close in', kind === 'offer' && o.close], ['Funding', { cash: 'Cash, proof of funds ready', hard: 'Hard money', other: 'Other' }[o.pof]], ['When', o.when], ['Phone', fmtPh(o.phone)], ['Email', o.email], ['Note', o.note]].filter(([, v]) => v);
      const html = layout({ eyebrow: kind === 'offer' ? 'New buyer offer' : 'Showing request', title: esc(street),
        body: P(kind === 'offer' ? `${esc(o.name)} offered <b>${$$(o.price)}</b> on ${esc(street)} through your buyer page.` : `${esc(o.name)} wants to see ${esc(street)}.`) + R(lines.map(([k, v]) => [k, esc(v)]))
          + P(`All offers on this deal: ${items.filter(x => x.kind === 'offer').length + (kind === 'offer' ? 1 : 0)}.`) + button(`${origin}/underwriting#${r.dealId}`, 'Open the deal') });
      await sendPlainEmail(biz.notify, subject, `${subject}\n\n${lines.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nOpen the deal: ${origin}/underwriting#${r.dealId}`, html, o.email || undefined, 'JStar Pro').catch(e => console.error('dealpage notify', e.message));
    }
    return res.status(200).json({ ok: true });
  }

  // ── Signed in: manage the page ──
  const actor = await getActor(req, b).catch(() => null);
  if (!actor) { await new Promise(r => setTimeout(r, 900)); return res.status(401).json({ error: b.pin ? 'Wrong PIN.' : 'Log in again.' }); }
  const sc = actor.scope, dealId = String(b.dealId || '');
  if (!ID.test(dealId)) return res.status(400).json({ error: 'Save the deal first.' });
  try {
    const deal = await getDeal(dealId, sc); if (!deal) return res.status(404).json({ error: 'Deal not found.' });
    const origin = originOf(req);
    if (b.action === 'get') {
      const pg = await ensurePage(sc, dealId);
      return res.status(200).json({ page: pg, url: pageUrl(origin, pg.token), price: pagePrice(pg, deal), offers: (await offersOf(sc, dealId)).sort((x, z) => z.at - x.at) });
    }
    if (b.action === 'save') {
      const prev = await ensurePage(sc, dealId);
      const pg = cleanPage(b.page, prev);
      await putDoc(`${base(sc)}/dpage/${dealId}`, pg, { keep: 2 });
      return res.status(200).json({ page: pg, url: pageUrl(origin, pg.token), price: pagePrice(pg, deal) });
    }
    if (b.action === 'addPhoto') {
      const pg = await ensurePage(sc, dealId);
      if ((pg.photos || []).length >= MAX_PHOTOS) return res.status(400).json({ error: `Up to ${MAX_PHOTOS} photos.` });
      const data = String(b.data || '');
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(data) || data.length > 3_000_000) return res.status(400).json({ error: 'Use a JPG or PNG under 2 MB.' });
      const id = pid();
      await putDoc(`dpimg/${pg.token}/${id}`, { data, at: Date.now() }, { keep: 1 });
      const cur = await loadPage(sc, dealId);
      const next = { ...cur, photos: [...(cur.photos || []), id].slice(0, MAX_PHOTOS), updatedAt: Date.now() };
      await putDoc(`${base(sc)}/dpage/${dealId}`, next, { keep: 2 });
      return res.status(200).json({ page: next });
    }
    if (b.action === 'removePhoto' || b.action === 'movePhoto') {
      const pg = await ensurePage(sc, dealId), id = String(b.id || '');
      let photos = [...(pg.photos || [])];
      if (b.action === 'removePhoto') { photos = photos.filter(x => x !== id); if (PID.test(id)) await deleteDoc(`dpimg/${pg.token}/${id}`).catch(() => {}); }
      else { const i = photos.indexOf(id); if (i > 0) { photos.splice(i, 1); photos.unshift(id); } }
      const next = { ...pg, photos, updatedAt: Date.now() };
      await putDoc(`${base(sc)}/dpage/${dealId}`, next, { keep: 2 });
      return res.status(200).json({ page: next });
    }
    if (b.action === 'offerStatus') {
      const items = await offersOf(sc, dealId), o = items.find(x => x.id === String(b.id || ''));
      if (!o) return res.status(404).json({ error: 'Offer not found.' });
      o.status = ['new', 'accepted', 'declined', 'contacted'].includes(b.status) ? b.status : o.status;
      await putDoc(`${base(sc)}/doffers/${dealId}`, { items }, { keep: 2 });
      return res.status(200).json({ offers: items.sort((x, z) => z.at - x.at) });
    }
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    console.error('dealpage', e);
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
}
