// Operator endpoint: PIN-protected. Runs the same deal analysis as the seller form,
// but takes property details only (no seller contact info) and returns the deal sheet.
import { getActor } from '../lib/auth.js';
import { getDoc, putDoc, deleteDoc, listDocs, newId } from '../lib/db.js';
import { useQuota } from '../lib/usage.js';
import { brief } from '../lib/brief.js';
import { analyzeLead } from '../lib/pipeline.js';
import { dealSheetHtml, smsText, sendEmail, sendPush, investorPitch } from '../lib/notify.js';

export const maxDuration = 30;

const num = v => {
  const n = Number(String(v ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const TYPE_LABEL = {
  single_family: 'Single family', townhouse: 'Townhouse', condo: 'Condo',
  multi_family: 'Multi-family (2–4)', manufactured: 'Mobile/manufactured', land: 'Vacant lot / land',
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.OPERATOR_PIN) return res.status(503).json({ error: 'Operator PIN isn\'t set up yet. Add OPERATOR_PIN in Vercel → Settings → Environment Variables, then redeploy.' });

  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const actor = await getActor(req, b).catch(() => null);
  if (!actor) {
    await new Promise(r => setTimeout(r, 900));
    return res.status(401).json({ error: b.pin ? 'Wrong PIN.' : 'Log in again.' });
  }
  if (b.checkOnly) return res.status(200).json({ ok: true });
  // Recently searched: the last 10 addresses this account ran, reopenable without using another analysis
  const RK = `t/${actor.scope || 'owner'}/recent`;
  if (b.recent === 'list') {
    const docs = (await listDocs(RK).catch(() => [])).sort((x, y) => y.at - x.at).slice(0, 10);
    return res.status(200).json({ recent: docs.map(d => ({ id: d.id, at: d.at, address: d.address, label: d.out?.brief?.label || null, opening: d.out?.brief?.opening ?? null, mao: d.out?.brief?.mao ?? null, value: d.out?.brief?.value ?? null })) });
  }
  if (b.recent === 'get') {
    if (!/^[a-z0-9]{6,32}$/.test(String(b.id || ''))) return res.status(400).json({ error: 'Bad id.' });
    const d = await getDoc(`${RK}/${b.id}`).catch(() => null);
    return d ? res.status(200).json({ body: d.body, ...d.out, savedAt: d.at }) : res.status(404).json({ error: 'That search expired. Run it again.' });
  }
  const over = await useQuota(actor, 'runs');
  if (over) return res.status(429).json({ error: over });

  const missing = ['street', 'city', 'state', 'zip'].filter(k => !String(b[k] || '').trim());
  if (missing.length) return res.status(400).json({ error: `Missing: ${missing.join(', ')}` });

  const state = String(b.state).trim().toUpperCase();
  const customRepairs = (Array.isArray(b.customRepairs) ? b.customRepairs : [])
    .map(r => ({ item: String(r.item || '').trim().slice(0, 60), cost: num(r.cost) }))
    .filter(r => r.item && r.cost);

  const lead = {
    address: `${b.street.trim()}, ${b.city.trim()}, ${state} ${String(b.zip).trim()}`,
    street: b.street.trim(), city: b.city.trim(), state, zip: String(b.zip).trim(),
    propertyType: b.propertyType || 'single_family',
    propertyTypeLabel: TYPE_LABEL[b.propertyType] || 'Single family',
    bedrooms: num(b.bedrooms), bathrooms: num(b.bathrooms), sqft: num(b.sqft), yearBuilt: num(b.yearBuilt),
    condition: b.condition || 'moderate',
    issues: Array.isArray(b.issues) ? b.issues : [],
    customRepairs: customRepairs.length ? customRepairs : undefined,
    lotSqft: num(b.lotAcres) ? Math.round(num(b.lotAcres) * 43560) : num(b.lotSqft),
    landIssues: Array.isArray(b.landIssues) ? b.landIssues : [],
    occupancy: b.occupancy || '', timeline: b.timeline || '', reason: b.reason || '',
    owed: b.owed || '', asking: b.asking || '',
    currentRent: b.occupancy === 'tenant' ? num(b.currentRent) : null,
    leaseEnd: b.occupancy === 'tenant' ? (b.leaseEnd || '') : '',
    tenantPaying: b.occupancy === 'tenant' ? (b.tenantPaying || '') : '',
    reasonDetail: String(b.notes || '').trim().slice(0, 1000),
    firstName: 'Operator', lastName: 'run', phone: '', email: '',
    tracking: { utm_source: 'operator' },
    submittedAt: new Date().toISOString(),
  };

  let payload;
  try {
    payload = await analyzeLead(lead);
    payload.operator = true; // operator-only extras (buyer pitch) on the deal sheet
    payload.biz = actor.biz;
  } catch (e) {
    console.error('operator analysis failed', e);
    return res.status(500).json({ error: `Analysis failed: ${e.message}` });
  }

  if (b.notify) {
    const r = await Promise.allSettled(actor.owner ? [sendEmail(payload), sendPush(payload)] : [sendEmail(payload, { to: actor.user.settings?.notifyEmail || actor.user.email })]);
    r.forEach(x => x.status === 'rejected' && console.error('operator notify', x.reason));
  }

  const out = { html: dealSheetHtml(payload), summary: smsText(payload), brief: brief(payload), pitch: investorPitch(payload) };
  try {
    const key = lead.address.toLowerCase().replace(/[^a-z0-9]/g, '');
    const old = (await listDocs(RK).catch(() => [])).sort((x, y) => y.at - x.at);
    const keepBody = Object.fromEntries(Object.entries(b).filter(([k]) => !['pin', 'notify', 'recent', 'id'].includes(k)));
    const id = newId(); await putDoc(`${RK}/${id}`, { id, at: Date.now(), key, address: lead.address, body: keepBody, out });
    const drop = old.filter((d, i) => d.key === key || i >= 9);
    await Promise.all(drop.map(d => deleteDoc(`${RK}/${d.id}`).catch(() => {})));
  } catch (e) { console.error('recent save', e.message); }
  return res.status(200).json({ ok: true, ...out });
}

// Compact numbers for the batch table
