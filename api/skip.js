// Skip trace a lead or deal's property owner. Results are saved on the lead/deal, so opening it again costs nothing.
// A miss doesn't use a skip trace from the plan.
import { getActor } from '../lib/auth.js';
import { getDoc, putDoc } from '../lib/db.js';
import { getDeal, saveDeal } from '../lib/store.js';
import { useQuota, refundQuota, getUsage } from '../lib/usage.js';
import { traceAddress, addrKey } from '../lib/skip.js';

export const maxDuration = 30;
const ID = /^[a-z0-9]{6,32}$/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const actor = await getActor(req, b).catch(() => null);
  if (!actor) { await new Promise(r => setTimeout(r, 900)); return res.status(401).json({ error: b.pin ? 'Wrong PIN.' : 'Log in again.' }); }
  const sc = actor.scope;
  try {
    let doc, addr, save;
    if (b.leadId) {
      if (actor.owner || !ID.test(String(b.leadId))) return res.status(400).json({ error: 'Bad lead.' });
      const k = `t/${sc}/leads/${b.leadId}`; doc = await getDoc(k);
      if (!doc) return res.status(404).json({ error: 'Lead not found.' });
      const L = doc.lead || {}; addr = { street: L.street, city: L.city, state: L.state, zip: L.zip };
      save = skip => putDoc(k, { ...doc, skip, updatedAt: Date.now() });
    } else if (b.dealId) {
      doc = await getDeal(String(b.dealId), sc);
      if (!doc) return res.status(404).json({ error: 'Deal not found.' });
      addr = doc.address || {};
      save = skip => saveDeal({ ...doc, skip, history: [...(doc.history || []), { at: Date.now(), text: skip.hit ? `Skip traced: ${skip.persons.reduce((n, p) => n + p.phones.length, 0)} phones found` : 'Skip traced: no match' }] }, sc);
    } else if (b.address && typeof b.address === 'object') {
      // A one-off address from Run an address: cached per account, so tracing it again (or saving it as a deal) is free
      const a = b.address; addr = { street: a.street, city: a.city, state: a.state, zip: a.zip };
      const k = addrKey(sc, addr); if (!k) return res.status(400).json({ error: 'Enter the full address.' });
      doc = (await getDoc(k).catch(() => null)) || {};
      save = skip => putDoc(k, { skip, address: addr, at: Date.now() }, { keep: 1 });
    } else return res.status(400).json({ error: 'Pick a lead or deal.' });
    if (b.peek) return res.status(200).json({ skip: doc.skip || null, cached: true });

    if (doc.skip && !b.again) return res.status(200).json({ skip: doc.skip, cached: true });
    const over = await useQuota(actor, 'skips', 1);
    if (over) return res.status(429).json({ error: over });
    let skip;
    try { skip = await traceAddress(addr); }
    catch (e) { await refundQuota(actor, 'skips', 1); return res.status(e.status || 500).json({ error: e.message }); }
    if (!skip.hit) await refundQuota(actor, 'skips', 1);
    await save(skip);
    return res.status(200).json({ skip, usage: actor.owner ? null : await getUsage(actor.user) });
  } catch (e) {
    console.error('skip', e);
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
}
