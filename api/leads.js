// A user's funnel leads: list / get / set status / move to deals / delete
import { getActor } from '../lib/auth.js';
import { getDoc, putDoc, deleteDoc, listDocs } from '../lib/db.js';
import { saveDeal } from '../lib/store.js';
import { getUsage } from '../lib/usage.js';

export const maxDuration = 30;
const ID = /^[a-z0-9]{6,32}$/;
const STAT = ['new', 'contacted', 'converted', 'dead'];

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const actor = await getActor(req, b).catch(() => null);
  if (!actor) return res.status(401).json({ error: 'Log in again.' });
  if (actor.owner) return res.status(200).json({ leads: [], note: 'Owner leads go to your email/GHL.' });
  const col = `t/${actor.scope}/leads`;
  const key = id => `${col}/${id}`;
  try {
    if (b.action === 'list') {
      const leads = (await listDocs(col)).sort((a, z) => z.createdAt - a.createdAt).map(({ html, ...l }) => l);
      return res.status(200).json({ leads, usage: await getUsage(actor.scope) });
    }
    if (!ID.test(String(b.id || ''))) return res.status(400).json({ error: 'Bad lead id.' });
    const lead = await getDoc(key(b.id));
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });

    if (b.action === 'get') return res.status(200).json({ lead });
    if (b.action === 'status') {
      if (!STAT.includes(b.status)) return res.status(400).json({ error: 'Bad status.' });
      return res.status(200).json({ lead: await putDoc(key(b.id), { ...lead, status: b.status, updatedAt: Date.now() }) });
    }
    if (b.action === 'convert') {
      if (lead.dealId) return res.status(200).json({ dealId: lead.dealId });
      const L = lead.lead || {}, br = lead.brief || {};
      const deal = await saveDeal({
        status: 'lead', propertyType: L.propertyType,
        address: { street: L.street, city: L.city, state: L.state, zip: L.zip },
        seller: { name: [L.firstName, L.lastName].filter(Boolean).join(' '), phone: L.phone, email: L.email },
        numbers: Object.fromEntries(Object.entries({ arv: br.value, repairs: br.repairs, contractPrice: br.opening, assignmentFee: 10000, buyerCostPct: 10, asking: br.asking }).filter(([, v]) => v != null)),
        analysis: { summary: lead.summary, mao: br.mao, opening: br.opening, call: br.call, confidence: br.confidence, label: br.label },
        notes: [L.reasonDetail && `Seller: "${L.reasonDetail}"`, `Source: ${lead.source}`].filter(Boolean).join('\n'),
        terms: { optionDays: 10, emDays: 3 },
        history: [{ at: Date.now(), text: `Created from funnel lead (${lead.source})` }],
      }, actor.scope);
      await putDoc(key(b.id), { ...lead, status: 'converted', dealId: deal.id, updatedAt: Date.now() });
      return res.status(200).json({ dealId: deal.id });
    }
    if (b.action === 'delete') return res.status(200).json({ ok: await deleteDoc(key(b.id)) });
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    console.error('leads', e);
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
}
