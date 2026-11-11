// Owner dashboard: every account, its plan, usage and leads. PIN only.
import { pinMatches } from '../lib/pin.js';
import { getDoc, listDocs, countDocs } from '../lib/db.js';
import { getUserById, saveUser, resetToken } from '../lib/auth.js';
import { PLANS, DOMAIN_ADDON_PRICE, tierOf } from '../lib/plan.js';
import { meterKey, allowances } from '../lib/meter.js';

export const maxDuration = 60;
const ID = /^[a-z0-9]{6,32}$/;
const month = () => new Date().toISOString().slice(0, 7).replace('-', '');
const slow = () => new Promise(r => setTimeout(r, 800));

function row(u, usage, leads) {
  const tier = tierOf(u);
  const paying = !!u.stripeSubId && tier !== 'trial';
  return {
    id: u.id, name: u.name, email: u.email, company: u.company || '', slug: u.slug, phone: u.phone || '',
    createdAt: u.createdAt, disabled: !!u.disabled, tier, comp: !!u.plan?.comp, paying,
    domainAddon: !!u.plan?.customDomain, domain: u.domain ? { name: u.domain.name, status: u.domain.status } : null,
    usage: { runs: usage?.runs || 0, photos: usage?.photos || 0, listCalls: usage?.listCalls || 0 }, limits: PLANS[tier].limits,
    leads,
    mrr: (paying ? PLANS[tier].price : 0) + (u.plan?.domainSubId && u.plan?.customDomain ? DOMAIN_ADDON_PRICE : 0),
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  if (!pinMatches(b.pin)) { await slow(); return res.status(401).json({ error: 'Wrong PIN.' }); }

  try {
    if (b.action === 'list') {
      const users = await listDocs('users');
      const m = month();
      const rows = await Promise.all(users.map(async u => row(u,
        await getDoc(`t/${u.id}/usage/${m}`).catch(() => null),
        await countDocs(`t/${u.id}/leads`).catch(() => 0))));
      rows.sort((a, z) => (z.createdAt || 0) - (a.createdAt || 0));
      const totals = {
        accounts: rows.length,
        paying: rows.filter(r => r.paying).length,
        trial: rows.filter(r => r.tier === 'trial').length,
        comp: rows.filter(r => r.comp).length,
        mrr: rows.reduce((s, r) => s + r.mrr, 0),
        runs: rows.reduce((s, r) => s + r.usage.runs, 0),
        photos: rows.reduce((s, r) => s + r.usage.photos, 0),
        leads: rows.reduce((s, r) => s + r.leads, 0),
      };
      const prev = new Date(); prev.setUTCDate(1); prev.setUTCMonth(prev.getUTCMonth() - 1);
      const [cur, last] = await Promise.all([getDoc(meterKey(m)).catch(() => null), getDoc(meterKey(prev.toISOString().slice(0, 7).replace('-', ''))).catch(() => null)]);
      const support = (await listDocs('support').catch(() => [])).sort((a, z) => z.at - a.at).slice(0, 10);
      return res.status(200).json({ rows, totals, month: m, data: { cur: cur || {}, last: last || {}, allow: allowances() }, support });
    }

    if (!ID.test(String(b.id || ''))) return res.status(400).json({ error: 'Bad account id.' });
    const u = await getUserById(b.id);
    if (!u) return res.status(404).json({ error: 'Account not found.' });

    if (b.action === 'plan') {
      if (!PLANS[b.tier]) return res.status(400).json({ error: 'Bad plan.' });
      // A manual (comp) plan. A Stripe subscription change later will overwrite it.
      const saved = await saveUser({ ...u, plan: { ...(u.plan || {}), tier: b.tier, comp: b.tier !== 'trial' && !u.stripeSubId } });
      return res.status(200).json({ ok: true, tier: tierOf(saved) });
    }
    if (b.action === 'disable' || b.action === 'enable') {
      // Disabling also signs them out everywhere
      await saveUser({ ...u, disabled: b.action === 'disable', sessVer: (u.sessVer || 0) + (b.action === 'disable' ? 1 : 0) });
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'resetLink') {
      if (u.disabled) return res.status(400).json({ error: 'Enable the account first.' });
      const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'getjstarpro.com');
      return res.status(200).json({ link: `https://${host}/reset?t=${encodeURIComponent(resetToken(u, 24 * 3600))}`, expires: '24 hours' });
    }
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    console.error('admin', e);
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
}
