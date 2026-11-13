// Owner lists from RentCast property records (each page of up to 500 records = 1 API call).
// Actions:
//   pull (default)  filtered owners in a ZIP → JSON records (the page builds the CSV)
//   save / lists / get / delete / rename   saved lists per account (index at t/<scope>/listidx)
//   stack           merge saved lists, rank owners that show up on several
//   buyers          recent investor buyers in a ZIP (LLCs + non-owner-occupied purchases), grouped by buyer
//   near            properties next to a GPS point (driving for dollars)
//   drive           add a driving-for-dollars property (photo, tags, notes) to the "Driving for dollars" list
import crypto from 'node:crypto';
import { getActor } from '../lib/auth.js';
import { useQuota } from '../lib/usage.js';
import { meter } from '../lib/meter.js';
import { getDoc, putDoc, deleteDoc, newId } from '../lib/db.js';

export const maxDuration = 60;

const TYPES = { sfr: ['Single Family', 'Townhouse', 'Condo'], multi: ['Multi-Family'], land: ['Land'], mobile: ['Manufactured'] };
const COMPANY = /\b(LLC|L\.L\.C|INC|CORP|CORPORATION|CO\b|COMPANY|LP|L\.P|LTD|LLP|PARTNERS|PARTNERSHIP|HOLDINGS|PROPERTIES|INVESTMENTS?|CAPITAL|GROUP|BANK|CHURCH|CITY OF|COUNTY|ISD|HOUSING|AUTHORITY|ASSOC|ASSOCIATION|HOMES|BUILDERS|DEVELOPMENT|REALTY|VENTURES|FUND|REIT|TRUST CO)\b/i;
const PUBLIC = /\b(CITY OF|COUNTY|ISD|HOUSING AUTHORITY|STATE OF|UNITED STATES|CHURCH|BANK|FEDERAL|MORTGAGE|FANNIE|FREDDIE|HUD|SECRETARY)\b/i;
const yearsSince = d => (d ? (Date.now() - new Date(d).getTime()) / (365.25 * 864e5) : null);
const num = v => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
const str = (v, n = 120) => String(v ?? '').trim().slice(0, n);
const pkey = r => crypto.createHash('sha1').update(String((r.addr || '') + '|' + (r.zip || '')).toUpperCase().replace(/[^A-Z0-9|]/g, '')).digest('hex').slice(0, 16);
const MAX_LIST = 5000, MAX_LISTS = 50;

function splitName(full) {
  const parts = String(full || '').replace(/\s+/g, ' ').trim().split(' ');
  if (parts.length < 2) return { first: '', last: parts[0] || '' };
  const suffix = /^(JR|SR|II|III|IV)\.?$/i.test(parts.at(-1)) ? parts.pop() : '';
  return { first: parts[0], last: parts.at(-1) + (suffix ? ' ' + suffix : '') };
}

async function pullPages(params, maxCalls, key) {
  const all = []; let calls = 0, err = null;
  for (let page = 0; page < maxCalls; page++) {
    const q = new URLSearchParams({ ...params, limit: '500', offset: String(page * 500) });
    const r = await fetch(`https://api.rentcast.io/v1/properties?${q}`, { headers: { 'X-Api-Key': key, Accept: 'application/json' } });
    calls++; meter('rentcast');
    if (!r.ok) { if (!all.length) err = r.status; console.error('list source', r.status, (await r.text().catch(() => '')).slice(0, 300)); break; }
    const rows = await r.json(); if (!Array.isArray(rows)) break;
    all.push(...rows); if (rows.length < 500) break;
  }
  return { all, calls, err };
}

// One RentCast property → a compact record
function toRecord(p) {
  const names = p.owner?.names || [], ownerName = names[0] || '';
  const isCompany = p.owner?.type === 'Organization' ? !/\b(TRUST|ESTATE)\b/i.test(ownerName) || COMPANY.test(ownerName) : COMPANY.test(ownerName);
  const m = p.owner?.mailingAddress || {};
  const absentee = p.ownerOccupied === false || !!(m.zipCode && p.zipCode && m.zipCode.slice(0, 5) !== p.zipCode.slice(0, 5));
  const outOfState = !!(m.state && p.state && m.state !== p.state);
  const yrs = yearsSince(p.lastSaleDate);
  const tags = [];
  if (p.propertyType === 'Land') tags.push('Vacant lot');
  if (absentee) tags.push(outOfState ? 'Out-of-state owner' : 'Absentee');
  if (yrs == null) tags.push('No sale on record'); else if (yrs >= 20) tags.push('Owned 20+ yrs'); else if (yrs >= 10) tags.push('Owned 10+ yrs');
  if (/\b(ESTATE|ETAL|ET AL|HEIRS?)\b/i.test(names.join(' '))) tags.push('Estate / heirs');
  if (/\bTRUST\b/i.test(ownerName)) tags.push('Trust');
  if (isCompany) tags.push('LLC / company');
  if (p.propertyType !== 'Land' && p.yearBuilt && p.yearBuilt < 1960) tags.push('Built pre-1960');
  const ty = Object.keys(p.taxAssessments || {}).sort().at(-1);
  const { first, last } = isCompany || /\b(TRUST|ESTATE)\b/i.test(ownerName) ? { first: '', last: ownerName } : splitName(ownerName);
  const r = {
    addr: p.addressLine1 || (p.formattedAddress || '').split(',')[0], city: p.city, st: p.state, zip: p.zipCode,
    owner: ownerName, owner2: names[1] || '', first, last, company: isCompany, absentee, oos: outOfState,
    mail: [m.addressLine1, m.addressLine2].filter(Boolean).join(' '), mcity: m.city || '', mst: m.state || '', mzip: m.zipCode || '',
    type: p.propertyType, bd: p.bedrooms ?? null, ba: p.bathrooms ?? null, sqft: p.squareFootage ?? null, lot: p.lotSize ? +(p.lotSize / 43560).toFixed(2) : null,
    yb: p.yearBuilt ?? null, sale: (p.lastSaleDate || '').slice(0, 10) || null, salePrice: p.lastSalePrice ?? null, yrs: yrs != null ? +yrs.toFixed(1) : null,
    assessed: ty ? p.taxAssessments[ty].value : null, lat: p.latitude ?? null, lng: p.longitude ?? null, tags,
  };
  r.k = pkey(r); return r;
}

const idxKey = sc => `t/${sc || 'owner'}/listidx`;
const listKey = (sc, id) => `t/${sc || 'owner'}/lists/${id}`;
async function getIdx(sc) { return (await getDoc(idxKey(sc)).catch(() => null)) || { lists: [] }; }
async function saveList(sc, { id, name, source, zip, filters, records }) {
  const idx = await getIdx(sc); id = id || newId();
  const recs = records.slice(0, MAX_LIST).map(r => ({ ...r, k: r.k || pkey(r) }));
  await putDoc(listKey(sc, id), { id, name, source, zip, filters, at: Date.now(), records: recs });
  const meta = { id, name, source, zip, count: recs.length, at: Date.now() };
  idx.lists = [meta, ...idx.lists.filter(l => l.id !== id)].slice(0, MAX_LISTS);
  await putDoc(idxKey(sc), idx, { keep: 2 });
  return meta;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const actor = await getActor(req, b).catch(() => null);
  if (!actor) { await new Promise(r => setTimeout(r, 900)); return res.status(401).json({ error: b.pin ? 'Wrong PIN.' : 'Log in again.' }); }
  const sc = actor.scope, action = b.action || 'pull';
  const ID = /^[a-z0-9]{6,32}$/;
  try {
    // ── Saved lists ─────────────────────────────────────────
    if (action === 'lists') return res.status(200).json({ lists: (await getIdx(sc)).lists });
    if (action === 'get') {
      if (!ID.test(String(b.id || ''))) return res.status(400).json({ error: 'Bad list.' });
      const l = await getDoc(listKey(sc, b.id)).catch(() => null);
      return l ? res.status(200).json({ list: l }) : res.status(404).json({ error: 'List not found.' });
    }
    if (action === 'save') {
      const recs = Array.isArray(b.records) ? b.records.filter(r => r && r.addr) : [];
      if (!recs.length) return res.status(400).json({ error: 'Nothing to save.' });
      const meta = await saveList(sc, { name: str(b.name, 60) || `List ${new Date().toLocaleDateString('en-US')}`, source: str(b.source, 20) || 'pull', zip: str(b.zip, 5), filters: b.filters || null, records: recs });
      return res.status(200).json({ list: meta });
    }
    if (action === 'rename') {
      if (!ID.test(String(b.id || ''))) return res.status(400).json({ error: 'Bad list.' });
      const l = await getDoc(listKey(sc, b.id)); if (!l) return res.status(404).json({ error: 'List not found.' });
      const meta = await saveList(sc, { ...l, name: str(b.name, 60) || l.name }); return res.status(200).json({ list: meta });
    }
    if (action === 'delete') {
      if (!ID.test(String(b.id || ''))) return res.status(400).json({ error: 'Bad list.' });
      await deleteDoc(listKey(sc, b.id)); const idx = await getIdx(sc); idx.lists = idx.lists.filter(l => l.id !== b.id); await putDoc(idxKey(sc), idx, { keep: 2 });
      return res.status(200).json({ ok: true });
    }
    if (action === 'stack') {
      const ids = (Array.isArray(b.ids) ? b.ids : []).filter(i => ID.test(String(i))).slice(0, 10);
      if (ids.length < 2) return res.status(400).json({ error: 'Pick at least 2 lists to stack.' });
      const lists = (await Promise.all(ids.map(i => getDoc(listKey(sc, i)).catch(() => null)))).filter(Boolean);
      const by = new Map();
      for (const l of lists) for (const r of l.records || []) {
        const k = r.k || pkey(r), cur = by.get(k);
        if (!cur) by.set(k, { ...r, k, lists: [l.name], hits: 1 });
        else if (!cur.lists.includes(l.name)) { cur.lists.push(l.name); cur.hits++; cur.tags = [...new Set([...(cur.tags || []), ...(r.tags || [])])]; if (r.photo && !cur.photo) cur.photo = r.photo; if (r.dtags) cur.dtags = [...new Set([...(cur.dtags || []), ...r.dtags])]; }
      }
      const min = Math.max(1, Number(b.min) || 2);
      const out = [...by.values()].filter(r => r.hits >= min).sort((a, z) => z.hits - a.hits || (z.tags?.length || 0) - (a.tags?.length || 0));
      return res.status(200).json({ records: out.slice(0, MAX_LIST), total: by.size, lists: lists.map(l => ({ id: l.id, name: l.name, count: (l.records || []).length })) });
    }

    const key = process.env.RENTCAST_API_KEY;
    if (!key) return res.status(503).json({ error: 'Property records aren\'t connected yet.' });

    // ── Driving for dollars ─────────────────────────────────
    if (action === 'near') {
      const lat = Number(b.lat), lng = Number(b.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return res.status(400).json({ error: 'No location.' });
      const over = await useQuota(actor, 'listCalls', 1); if (over) return res.status(429).json({ error: over });
      const q = new URLSearchParams({ latitude: lat.toFixed(6), longitude: lng.toFixed(6), radius: '0.12', limit: '40' });
      const r = await fetch(`https://api.rentcast.io/v1/properties?${q}`, { headers: { 'X-Api-Key': key, Accept: 'application/json' } }); meter('rentcast');
      if (!r.ok) return res.status(502).json({ error: 'Couldn\'t find houses here. Try again or type the address.' });
      const rows = await r.json();
      const d = (a, o) => { const R = 3958.8, dLa = (o.lat - a.lat) * Math.PI / 180, dLo = (o.lng - a.lng) * Math.PI / 180, x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(o.lat * Math.PI / 180) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
      const recs = (Array.isArray(rows) ? rows : []).map(toRecord).filter(x => x.lat != null).map(x => ({ ...x, ft: Math.round(d({ lat, lng }, x) * 5280) })).sort((a, z) => a.ft - z.ft).slice(0, 8);
      return res.status(200).json({ records: recs });
    }
    if (action === 'lookup') {
      const address = str(b.address, 200); if (address.length < 8) return res.status(400).json({ error: 'Type the full address.' });
      const over = await useQuota(actor, 'listCalls', 1); if (over) return res.status(429).json({ error: over });
      const r = await fetch(`https://api.rentcast.io/v1/properties?${new URLSearchParams({ address })}`, { headers: { 'X-Api-Key': key, Accept: 'application/json' } }); meter('rentcast');
      if (!r.ok) return res.status(r.status === 404 ? 404 : 502).json({ error: r.status === 404 ? 'No public record for that address. Check the spelling and ZIP.' : 'Couldn\'t look that up. Try again.' });
      const rows = await r.json(); const list = (Array.isArray(rows) ? rows : [rows]).filter(Boolean).map(toRecord);
      return list.length ? res.status(200).json({ records: list.slice(0, 3) }) : res.status(404).json({ error: 'No public record for that address. Check the spelling and ZIP.' });
    }
    if (action === 'drive') {
      const r = b.record || {}; if (!r.addr) return res.status(400).json({ error: 'Pick a house first.' });
      const photo = typeof b.photo === 'string' && /^data:image\/jpeg;base64,/.test(b.photo) && b.photo.length < 400000 ? b.photo : null;
      const idx = await getIdx(sc); let meta = idx.lists.find(l => l.source === 'drive');
      const cur = meta ? await getDoc(listKey(sc, meta.id)).catch(() => null) : null;
      const rec = { ...r, k: r.k || pkey(r), dtags: (Array.isArray(b.tags) ? b.tags : []).map(t => str(t, 30)).slice(0, 12), note: str(b.note, 500), photo, drivenAt: Date.now(), lat: r.lat ?? (Number(b.lat) || null), lng: r.lng ?? (Number(b.lng) || null) };
      rec.tags = [...new Set([...(r.tags || []), ...rec.dtags])];
      const records = [rec, ...((cur?.records) || []).filter(x => x.k !== rec.k)].map((x, i) => (i < 60 ? x : { ...x, photo: null })); // keep photos on the newest 60
      meta = await saveList(sc, { id: meta?.id, name: meta?.name || 'Driving for dollars', source: 'drive', zip: '', filters: null, records });
      return res.status(200).json({ list: meta, record: { ...rec, photo: undefined } });
    }

    // ── Pull a list / find buyers ───────────────────────────
    const zip = String(b.zip || '').trim();
    if (!/^\d{5}$/.test(zip)) return res.status(400).json({ error: 'ZIP needs 5 digits.' });
    const types = (Array.isArray(b.types) && b.types.length ? b.types : action === 'buyers' ? ['sfr', 'multi'] : ['sfr', 'land']).flatMap(t => TYPES[t] || []);
    if (!types.length) return res.status(400).json({ error: 'Pick at least one property type.' });
    const maxCalls = Math.min(Math.max(Number(b.maxCalls) || 4, 1), 10);
    const over = await useQuota(actor, 'listCalls', maxCalls);
    if (over) return res.status(429).json({ error: over });
    const params = { zipCode: zip, propertyType: types.join('|') };
    if (action === 'buyers') { const months = Math.min(Math.max(Number(b.months) || 12, 1), 36); params.saleDateRange = String(Math.round(months * 30.4)); }
    const { all, calls, err } = await pullPages(params, maxCalls, key);
    if (err && !all.length) return res.status(502).json({ error: err === 429 ? 'Property records are busy. Try again in a minute.' : 'Couldn\'t pull property records for that ZIP. Try again.' });
    const more = all.length >= maxCalls * 500;

    if (action === 'buyers') {
      // Group recent purchases by buyer (owner name + mailing address). Investor = company/LLC or doesn't live there.
      const months = Math.min(Math.max(Number(b.months) || 12, 1), 36), cut = Date.now() - months * 30.4 * 864e5;
      const groups = new Map();
      for (const p of all) {
        const r = toRecord(p);
        if (!r.sale || new Date(r.sale).getTime() < cut || !r.owner || PUBLIC.test(r.owner)) continue;
        if (!r.company && !r.absentee) continue;
        const gk = (r.company ? r.owner.replace(/[^A-Z0-9]/gi, '') : r.owner + '|' + (r.mail || '')).toUpperCase(); // LLCs often use several mailing addresses
        const g = groups.get(gk) || { name: r.owner, company: r.company, mail: r.mail, mcity: r.mcity, mst: r.mst, mzip: r.mzip, buys: [] };
        g.buys.push({ addr: r.addr, city: r.city, zip: r.zip, date: r.sale, price: r.salePrice, type: r.type, sqft: r.sqft, bd: r.bd, ba: r.ba });
        groups.set(gk, g);
      }
      const buyers = [...groups.values()].map(g => {
        const prices = g.buys.map(x => x.price).filter(Boolean).sort((a, z) => a - z);
        g.buys.sort((a, z) => z.date.localeCompare(a.date));
        return { ...g, count: g.buys.length, last: g.buys[0].date, minPrice: prices[0] || null, maxPrice: prices.at(-1) || null, k: crypto.createHash('sha1').update((g.name + g.mail).toUpperCase()).digest('hex').slice(0, 12) };
      }).sort((a, z) => z.count - a.count || z.last.localeCompare(a.last)).slice(0, 150);
      return res.status(200).json({ buyers, scanned: all.length, calls, more, months });
    }

    // Filters
    const f = {
      absentee: !!b.absentee, oos: !!b.outOfState, skipCompanies: b.skipCompanies !== false, onlyCompanies: !!b.onlyCompanies,
      minYears: Number(b.minYears) || 0, maxYears: Number(b.maxYears) || 0,
      minSqft: num(b.minSqft), maxSqft: num(b.maxSqft), minBeds: num(b.minBeds), builtBefore: num(b.builtBefore), builtAfter: num(b.builtAfter),
      minAssessed: num(b.minAssessed), maxAssessed: num(b.maxAssessed), minLot: num(b.minLot), noSale: !!b.noSale,
      estate: !!b.estate, trust: !!b.trust, mustTags: Array.isArray(b.mustTags) ? b.mustTags : [],
    };
    const kept = [], owners = new Map();
    for (const p of all) {
      const r = toRecord(p);
      if (!r.owner) continue;
      if (f.onlyCompanies ? !r.company : (f.skipCompanies && r.company)) continue;
      if (f.absentee && !r.absentee && r.type !== 'Land') continue;
      if (f.oos && !r.oos) continue;
      if (f.minYears && r.yrs != null && r.yrs < f.minYears) continue;
      if (f.maxYears && (r.yrs == null || r.yrs > f.maxYears)) continue;
      if (f.noSale && r.yrs != null) continue;
      if (f.minSqft && !(r.sqft >= f.minSqft)) continue;
      if (f.maxSqft && !(r.sqft <= f.maxSqft)) continue;
      if (f.minBeds && !(r.bd >= f.minBeds)) continue;
      if (f.builtBefore && !(r.yb && r.yb < f.builtBefore)) continue;
      if (f.builtAfter && !(r.yb && r.yb >= f.builtAfter)) continue;
      if (f.minAssessed && !(r.assessed >= f.minAssessed)) continue;
      if (f.maxAssessed && !(r.assessed && r.assessed <= f.maxAssessed)) continue;
      if (f.minLot && !(r.lot >= f.minLot)) continue;
      if (f.estate && !r.tags.includes('Estate / heirs')) continue;
      if (f.trust && !r.tags.includes('Trust')) continue;
      const ok = (r.owner + '|' + r.mail).toUpperCase(); owners.set(ok, (owners.get(ok) || 0) + 1); r._ok = ok;
      kept.push(r);
    }
    for (const r of kept) { r.owned = owners.get(r._ok); delete r._ok; if (r.owned >= 3) r.tags.push(`Owns ${r.owned} here`); }
    kept.sort((a, z) => z.tags.length - a.tags.length || (z.yrs ?? 99) - (a.yrs ?? 99));
    return res.status(200).json({ records: kept.slice(0, MAX_LIST), scanned: all.length, kept: kept.length, calls, more, filters: f });
  } catch (e) {
    console.error('list', e);
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
}
