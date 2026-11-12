// Operator deal pipeline: list / get / save / delete (PIN-gated, private Blob storage)
import { getActor } from '../lib/auth.js';
import { listDeals, getDeal, saveDeal, deleteDeal } from '../lib/store.js';
import { getDoc } from '../lib/db.js';
import { addrKey } from '../lib/skip.js';

export const maxDuration = 30;
const STATUSES = ['lead', 'offer', 'contract', 'assigned', 'closed', 'dead'];
const clip = (v, n = 2000) => (v == null ? v : String(v).slice(0, n));

// Keep only known fields, trimmed
function clean(d) {
  const o = (x, keys, n) => Object.fromEntries(keys.map(k => [k, clip(x?.[k], n)]).filter(([, v]) => v != null && v !== ''));
  const num = v => (v === '' || v == null || !Number.isFinite(Number(String(v).replace(/[$,\s]/g, ''))) ? null : Number(String(v).replace(/[$,\s]/g, '')));
  const nums = x => Object.fromEntries(Object.entries(x || {}).filter(([k]) => /^[a-zA-Z]{1,24}$/.test(k)).map(([k, v]) => [k, num(v)]).filter(([, v]) => v != null));
  return {
    id: d.id, createdAt: d.createdAt, status: STATUSES.includes(d.status) ? d.status : 'lead',
    address: o(d.address, ['street', 'city', 'state', 'zip', 'county', 'legal'], 400),
    propertyType: clip(d.propertyType, 40),
    seller: o(d.seller, ['name', 'name2', 'phone', 'email', 'mailing'], 300),
    buyer: o(d.buyer, ['name', 'entity', 'phone', 'email'], 300),
    title: o(d.title, ['company', 'officer', 'phone', 'email'], 300),
    numbers: nums(d.numbers),
    terms: o(d.terms, ['contractDate', 'closingDate', 'optionDays', 'emDays', 'assignDate', 'buyerDepositDays', 'possession', 'extra'], 1500),
    analysis: d.analysis && typeof d.analysis === 'object' ? JSON.parse(JSON.stringify(d.analysis).slice(0, 6000)) : undefined,
    checklist: Object.fromEntries(Object.entries(d.checklist || {}).filter(([k, v]) => /^[a-z_]{1,40}$/.test(k) && typeof v === 'boolean')),
    signoff: d.signoff && typeof d.signoff === 'object' ? { at: Number(d.signoff.at) || null, numbers: nums(d.signoff.numbers) } : null,
    notes: clip(d.notes, 5000),
    history: Array.isArray(d.history) ? d.history.slice(-50).map(h => ({ at: Number(h.at) || null, text: clip(h.text, 200) })) : [],
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const actor = await getActor(req, b).catch(() => null);
  if (!actor) { await new Promise(r => setTimeout(r, 900)); return res.status(401).json({ error: b.pin ? 'Wrong PIN.' : 'Log in again.' }); }
  const sc = actor.scope;
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) return res.status(503).json({ error: 'Deal storage isn\'t connected.' });
  try {
    if (b.action === 'list') return res.status(200).json({ deals: await listDeals(sc) });
    if (b.action === 'get') { const d = await getDeal(String(b.id || ''), sc); return d ? res.status(200).json({ deal: d, biz: actor.biz }) : res.status(404).json({ error: 'Deal not found.' }); }
    if (b.action === 'save') {
      if (!b.deal || typeof b.deal !== 'object') return res.status(400).json({ error: 'No deal.' });
      const prev = b.deal.id ? await getDeal(String(b.deal.id), sc) : null;
      const d = clean({ ...b.deal, createdAt: prev?.createdAt });
      if (prev?.skip) d.skip = prev.skip; // skip trace results are only set by /api/skip
      else if (!prev) { const k = addrKey(sc, d.address); const c = k && await getDoc(k).catch(() => null); if (c?.skip) d.skip = c.skip; } // traced on Run an address before saving
      if (!d.address?.street) return res.status(400).json({ error: 'Deal needs an address.' });
      if (prev && prev.status !== d.status) d.history.push({ at: Date.now(), text: `Status: ${prev.status} → ${d.status}` });
      if (!prev) d.history.push({ at: Date.now(), text: 'Deal created' });
      return res.status(200).json({ deal: await saveDeal(d, sc) });
    }
    if (b.action === 'delete') return res.status(200).json({ ok: await deleteDeal(String(b.id || ''), sc) });
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    console.error('deals', e);
    return res.status(500).json({ error: 'Storage error. Try again.' });
  }
}
