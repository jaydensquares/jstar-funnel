// Agent offers: find active MLS listings (RentCast /listings/sale), underwrite each one with the same ARV and repair
// math as a deal analysis, and email every listing agent a personalized cash offer from the user's own address on our
// domain (handle@OFFERS_DOMAIN), with replies going to the user's real inbox. Sends are paced to a daily cap.
//
// Docs (base = t/<scope> or "owner" for the PIN account):
//   <base>/aosender            { handle, name, replyTo, address, phone, company }
//   aohandles/<handle>         { scope }                      who owns an address
//   <base>/aoc/<id>            campaign { id, name, status, settings, items[], createdAt }
//   aoactive/<key>             { scope }                      accounts with a campaign still sending (cron reads these)
//   aoopt/<hash of email>      { at }                         agents who opted out of every JStar Pro sender
import crypto from 'node:crypto';
import { getDoc, putDoc, deleteDoc, listDocs } from './db.js';
import { meter } from './meter.js';
import { getValueAndComps, rentcastType } from './rentcast.js';
import { computeARV, repairEstimate } from './offer.js';
import CONFIG from '../config.js';

export const base = sc => (sc ? `t/${sc}` : 'owner');
export const activeKey = sc => sc || 'owner';
export const HARD_DAILY = 300; // most a single sender can send in a day
export const DEFAULTS = { pct: 70, tier: 'cosmetic', minOfList: 50, maxOfList: 95, closeDays: 14, dailyCap: 100 };
const round = (n, to = 500) => Math.round(n / to) * to;
const $$ = n => '$' + Math.round(n || 0).toLocaleString();
export const hash = s => crypto.createHash('sha256').update('ao:' + String(s).trim().toLowerCase()).digest('hex').slice(0, 32);
const sig = s => crypto.createHmac('sha256', process.env.SESSION_SECRET || 'x').update('aoopt:' + s).digest('base64url').slice(0, 22);
export const optToken = email => Buffer.from(String(email).toLowerCase()).toString('base64url') + '.' + sig(String(email).toLowerCase());
export function optEmail(token) {
  const [b, s] = String(token || '').split('.');
  const e = b ? Buffer.from(b, 'base64url').toString() : '';
  return e && s === sig(e) ? e : null;
}

// ── Sender address ────────────────────────────────────────
export function offersDomain() {
  const env = process.env.OFFERS_DOMAIN || '';
  if (env) return env.replace(/^@/, '').trim().toLowerCase();
  const from = process.env.NOTIFY_FROM || '';
  return ((from.match(/<([^>]+)>/) || [])[1] || from).split('@')[1]?.trim().toLowerCase() || 'getjstarpro.com';
}
const RESERVED = new Set(['admin', 'administrator', 'abuse', 'postmaster', 'hostmaster', 'webmaster', 'support', 'help', 'billing', 'security', 'noreply', 'no-reply', 'mailer-daemon', 'root', 'info', 'hello', 'team', 'sales', 'offers', 'jstar', 'jstarpro', 'jayden', 'contact', 'legal', 'privacy', 'notify', 'notifications', 'alerts', 'accounts', 'founder', 'ceo']);
export function cleanHandle(h) { return String(h || '').trim().toLowerCase().replace(/[^a-z0-9.-]/g, '').replace(/^[.-]+|[.-]+$/g, '').replace(/\.{2,}/g, '.').slice(0, 30); }
export function handleProblem(h) {
  if (!h || h.length < 3) return 'Use at least 3 letters or numbers.';
  if (RESERVED.has(h) || /^(admin|support|jstar|billing|security)/.test(h)) return 'That address is reserved. Try your name.';
  return null;
}
export const getSender = sc => getDoc(`${base(sc)}/aosender`).catch(() => null);
export async function saveSender(sc, s) {
  const prev = await getSender(sc);
  const h = cleanHandle(s.handle);
  const bad = handleProblem(h); if (bad) return { error: bad };
  if (h !== prev?.handle) {
    const own = await getDoc(`aohandles/${h}`).catch(() => null);
    if (own && own.scope !== activeKey(sc)) return { error: `${h}@${offersDomain()} is taken. Try another.` };
    await putDoc(`aohandles/${h}`, { scope: activeKey(sc), at: Date.now() }, { keep: 1 });
    if (prev?.handle) await deleteDoc(`aohandles/${prev.handle}`).catch(() => {});
  }
  const doc = { handle: h, name: String(s.name || '').trim().slice(0, 60), replyTo: String(s.replyTo || '').trim().slice(0, 120),
    company: String(s.company || '').trim().slice(0, 80), phone: String(s.phone || '').trim().slice(0, 30), address: String(s.address || '').trim().slice(0, 160), updatedAt: Date.now() };
  await putDoc(`${base(sc)}/aosender`, doc, { keep: 2 });
  return { sender: { ...doc, email: `${h}@${offersDomain()}` } };
}

// ── Listings ──────────────────────────────────────────────
const TYPES = { sfr: ['Single Family', 'Townhouse'], condo: ['Condo'], multi: ['Multi-Family'], land: ['Land'], mobile: ['Manufactured'] };
export function toListing(l) {
  const ag = l.listingAgent || {}, of = l.listingOffice || {};
  return {
    lid: String(l.id || l.formattedAddress || '').slice(0, 120), address: l.formattedAddress || '', street: l.addressLine1 || (l.formattedAddress || '').split(',')[0],
    city: l.city || '', state: l.state || '', zip: l.zipCode || '', type: l.propertyType || '', beds: l.bedrooms ?? null, baths: l.bathrooms ?? null,
    sqft: l.squareFootage || null, yearBuilt: l.yearBuilt || null, list: l.price || null, dom: l.daysOnMarket ?? null, listedDate: l.listedDate || null,
    agent: { name: String(ag.name || '').trim(), email: String(ag.email || of.email || '').trim().toLowerCase(), phone: ag.phone || of.phone || '' }, office: of.name || '',
  };
}
export async function searchListings(q) {
  const key = process.env.RENTCAST_API_KEY; if (!key) throw new Error('Property data isn\'t set up yet.');
  const p = new URLSearchParams({ status: 'Active', limit: '500' });
  if (q.zip) p.set('zipCode', q.zip); else { p.set('city', q.city); p.set('state', q.state); }
  meter('rentcast');
  const r = await fetch(`https://api.rentcast.io/v1/listings/sale?${p}`, { headers: { 'X-Api-Key': key, Accept: 'application/json' } });
  if (!r.ok) { console.error('listings', r.status, (await r.text().catch(() => '')).slice(0, 300)); throw new Error(r.status === 404 ? 'No active listings found there.' : 'Listing search is unavailable right now. Try again in a minute.'); }
  const rows = await r.json();
  const types = (q.types?.length ? q.types : ['sfr']).flatMap(t => TYPES[t] || []);
  const all = (Array.isArray(rows) ? rows : []).map(toListing);
  const fit = all.filter(l => (!types.length || types.includes(l.type))
    && (!q.minPrice || (l.list || 0) >= q.minPrice) && (!q.maxPrice || (l.list || 0) <= q.maxPrice)
    && (!q.minDom || (l.dom ?? 0) >= q.minDom) && (!q.minBeds || (l.beds || 0) >= q.minBeds));
  const withEmail = fit.filter(l => /@/.test(l.agent.email));
  return { total: all.length, matched: fit.length, listings: withEmail };
}

// ── Underwriting ──────────────────────────────────────────
export function priceOffer({ arv, sqft, yearBuilt, list }, s) {
  if (!arv || !sqft) return { skip: 'No value or square footage on record' };
  const repairs = repairEstimate(s.tier, sqft, yearBuilt, [], CONFIG);
  let offer = round(arv * s.pct / 100 - repairs, 500);
  if (list && offer > list * s.maxOfList / 100) offer = round(list * s.maxOfList / 100, 500);
  if (offer <= 0) return { repairs, offer: 0, skip: 'Numbers don\'t work at any price' };
  if (list && offer < list * s.minOfList / 100) return { repairs, offer, skip: `Offer is under ${s.minOfList}% of list` };
  return { repairs, offer };
}
export async function underwrite(l, s) {
  const subject = { address: l.address, propertyType: l.type && l.type !== 'Land' ? l.type : rentcastType('single_family'), bedrooms: l.beds ?? undefined, bathrooms: l.baths ?? undefined, squareFootage: l.sqft || undefined };
  const avm = await getValueAndComps(subject, CONFIG);
  const sp = avm?.subjectProperty || {};
  const sqft = l.sqft || sp.squareFootage || null, yearBuilt = l.yearBuilt || sp.yearBuilt || null;
  const a = computeARV({ squareFootage: sqft, bedrooms: l.beds ?? sp.bedrooms, bathrooms: l.baths ?? sp.bathrooms, yearBuilt, propertyType: subject.propertyType }, avm?.comparables || [], avm, CONFIG);
  const o = priceOffer({ arv: a.arv, sqft, yearBuilt, list: l.list }, s);
  const repairsBy = sqft ? Object.fromEntries(['turnkey', 'cosmetic', 'moderate', 'heavy', 'gut'].map(t => [t, repairEstimate(t, sqft, yearBuilt, [], CONFIG)])) : null;
  return { ...l, sqft, yearBuilt, arv: a.arv, confidence: a.confidence, comps: a.compsUsed?.length || 0, repairsBy, repairs: o.repairs ?? null, offer: o.offer ?? null, skip: o.skip || null };
}

export function cleanSettings(x = {}) {
  const n = (v, lo, hi, d) => { const k = Math.round(Number(v)); return Number.isFinite(k) ? Math.max(lo, Math.min(hi, k)) : d; };
  return {
    pct: n(x.pct, 40, 95, DEFAULTS.pct), tier: ['turnkey', 'cosmetic', 'moderate', 'heavy', 'gut'].includes(x.tier) ? x.tier : DEFAULTS.tier,
    minOfList: n(x.minOfList, 0, 100, DEFAULTS.minOfList), maxOfList: n(x.maxOfList, 50, 100, DEFAULTS.maxOfList),
    closeDays: n(x.closeDays, 3, 90, DEFAULTS.closeDays), dailyCap: n(x.dailyCap, 1, HARD_DAILY, DEFAULTS.dailyCap),
    subject: String(x.subject || '').slice(0, 140), message: String(x.message || '').slice(0, 3000),
  };
}

// ── Email ─────────────────────────────────────────────────
export const DEFAULT_SUBJECT = 'Cash offer on {street}';
export const DEFAULT_MESSAGE = `Hi {agent_first},

I'd like to make a cash offer on {street}: {offer}, as-is, closing in {close_days} days or on your seller's timeline. No financing or appraisal contingency, and I can send proof of funds.

If your seller is open to it, reply here and I'll send a written offer today. If the number isn't close, tell me where they'd need to be and I'll see what I can do.

Thanks,
{my_name}
{company_line}`;
const fmtPh = v => { const d = String(v || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(v || ''); };
export function fill(t, it, snd, s) {
  const first = (it.agent?.name || '').split(/\s+/)[0] || 'there';
  const v = { agent_first: first, agent_name: it.agent?.name || 'there', street: it.street || it.address, address: it.address, city: it.city, offer: $$(it.offer),
    list_price: it.list ? $$(it.list) : '', close_days: String(s.closeDays), my_name: snd.name || '', company: snd.company || '', phone: fmtPh(snd.phone),
    company_line: [snd.company, fmtPh(snd.phone)].filter(Boolean).join(' · ') };
  return String(t || '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)).replace(/\n{3,}/g, '\n\n').trim();
}
const escH = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function buildEmail(it, snd, s, origin) {
  const subject = fill(s.subject || DEFAULT_SUBJECT, it, snd, s);
  const body = fill(s.message || DEFAULT_MESSAGE, it, snd, s);
  const unsub = `${origin}/api/offers?u=${optToken(it.agent.email)}`;
  const foot = `${snd.address ? snd.address + '\n' : ''}Don't want offers like this? Unsubscribe: ${unsub}`;
  const html = `<div style="font:15px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1c1c;max-width:560px">${escH(body).replace(/\n/g, '<br>')}`
    + `<p style="margin:28px 0 0;font-size:12px;line-height:1.5;color:#8a8a8a">${snd.address ? escH(snd.address) + '<br>' : ''}Don't want offers like this? <a href="${unsub}" style="color:#8a8a8a">Unsubscribe</a></p></div>`;
  return {
    from: `${String(snd.name || snd.company || 'Cash buyer').replace(/[<>"\r\n]/g, '').slice(0, 60)} <${snd.handle}@${offersDomain()}>`,
    to: [it.agent.email], subject, ...(snd.replyTo ? { reply_to: snd.replyTo } : {}),
    headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    text: `${body}\n\n--\n${foot}`, html,
  };
}

const ymd = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
export const sentToday = c => (c.today?.day === ymd() ? c.today.n : 0);

// Send what's due for one account: up to the daily cap (shared by all its campaigns), oldest campaign first.
export async function sendDue(sc, origin, { send = resendBatch } = {}) {
  const snd = await getSender(sc);
  const camps = (await listDocs(`${base(sc)}/aoc`).catch(() => [])).filter(c => c.status === 'sending').sort((a, z) => a.createdAt - z.createdAt);
  if (!snd?.handle || !camps.length) { if (!camps.length) await deleteDoc(`aoactive/${activeKey(sc)}`).catch(() => {}); return { sent: 0 }; }
  const day = ymd();
  const cap = Math.min(HARD_DAILY, Math.max(...camps.map(c => c.settings?.dailyCap || DEFAULTS.dailyCap)));
  let left = cap - camps.reduce((s, c) => s + sentToday(c), 0), total = 0;
  for (const c of camps) {
    if (left <= 0) break;
    const due = c.items.filter(i => i.status === 'queued').slice(0, left);
    const ok = [];
    for (const it of due) {
      if (await getDoc(`aoopt/${hash(it.agent.email)}`).catch(() => null)) { it.status = 'optout'; continue; }
      ok.push(it);
    }
    for (let i = 0; i < ok.length; i += 100) {
      const chunk = ok.slice(i, i + 100);
      const good = await send(chunk.map(it => buildEmail(it, snd, c.settings, origin)));
      // A failed send stays queued and is retried on the next run; after 3 tries it's marked failed
      chunk.forEach(it => { if (good) { it.status = 'sent'; it.sentAt = Date.now(); } else { it.tries = (it.tries || 0) + 1; if (it.tries >= 3) it.status = 'failed'; } });
      if (good) { meter('resend', chunk.length); total += chunk.length; left -= chunk.length; } else break;
    }
    c.today = { day, n: (c.today?.day === day ? c.today.n : 0) + ok.filter(i => i.status === 'sent').length };
    if (!c.items.some(i => i.status === 'queued')) { c.status = 'done'; c.doneAt = Date.now(); }
    await putDoc(`${base(sc)}/aoc/${c.id}`, { ...c, updatedAt: Date.now() }, { keep: 2 });
  }
  const still = (await listDocs(`${base(sc)}/aoc`).catch(() => [])).some(c => c.status === 'sending');
  if (!still) await deleteDoc(`aoactive/${activeKey(sc)}`).catch(() => {});
  return { sent: total };
}
async function resendBatch(emails) {
  const key = process.env.RESEND_API_KEY; if (!key) return false;
  const r = await fetch('https://api.resend.com/emails/batch', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(emails) });
  if (!r.ok) console.error('agent offers send', r.status, (await r.text().catch(() => '')).slice(0, 300));
  return r.ok;
}
export const counts = c => c.items.reduce((m, i) => ((m[i.status] = (m[i.status] || 0) + 1), m), {});
