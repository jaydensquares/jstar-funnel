// Stripe webhook: turns the custom-domain add-on on/off. Point Stripe at /api/stripe-webhook with
// events checkout.session.completed, customer.subscription.updated, customer.subscription.deleted.
import crypto from 'node:crypto';
import { getUserById, saveUser } from '../lib/auth.js';
import { getDoc, putDoc } from '../lib/db.js';

export const config = { api: { bodyParser: false } };

async function rawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  if (chunks.length) return Buffer.concat(chunks).toString('utf8');
  return typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
}

export function verify(payload, header, secret, toleranceSec = 300) {
  const parts = Object.fromEntries(String(header || '').split(',').map(p => p.split('=')).filter(p => p.length === 2).map(([k, v]) => [k, k === 'v1' ? null : v]));
  const v1s = String(header || '').split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  const t = Number(parts.t);
  if (!t || !v1s.length || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const want = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return v1s.some(s => s.length === want.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want)));
}

async function setDomainPlan(uid, on, extra = {}) {
  const u = await getUserById(uid);
  if (!u) return;
  await saveUser({ ...u, ...extra, plan: { ...(u.plan || {}), customDomain: on } });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(503).end();
  const payload = await rawBody(req);
  if (!verify(payload, req.headers['stripe-signature'], secret)) return res.status(400).json({ error: 'Bad signature' });
  const ev = JSON.parse(payload);
  try {
    const o = ev.data?.object || {};
    if (ev.type === 'checkout.session.completed' && o.metadata?.feature === 'customDomain') {
      const uid = o.client_reference_id || o.metadata?.uid;
      if (o.subscription) await putDoc(`idx/stripe-sub/${o.subscription}`.toLowerCase(), { uid });
      await setDomainPlan(uid, true, { stripeCustomerId: o.customer, stripeSubId: o.subscription });
    }
    if (ev.type === 'customer.subscription.updated' || ev.type === 'customer.subscription.deleted') {
      const uid = o.metadata?.uid || (await getDoc(`idx/stripe-sub/${o.id}`.toLowerCase()))?.uid;
      if (uid && (o.metadata?.feature === 'customDomain' || !o.metadata?.feature)) {
        const active = ev.type === 'customer.subscription.updated' && ['active', 'trialing', 'past_due'].includes(o.status);
        await setDomainPlan(uid, active);
      }
    }
  } catch (e) { console.error('stripe webhook', e); return res.status(500).end(); }
  return res.status(200).json({ received: true });
}
