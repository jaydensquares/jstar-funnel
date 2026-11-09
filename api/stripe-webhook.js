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

async function setPlan(uid, patch, extra = {}) {
  const u = await getUserById(uid);
  if (!u) return;
  await saveUser({ ...u, ...extra, plan: { ...(u.plan || {}), ...patch } });
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
    if (ev.type === 'checkout.session.completed') {
      const uid = o.client_reference_id || o.metadata?.uid;
      const feature = o.metadata?.feature, tier = o.metadata?.tier;
      if (uid && o.subscription) await putDoc(`idx/stripe-sub/${o.subscription}`.toLowerCase(), { uid, feature, tier });
      if (uid && feature === 'customDomain') await setPlan(uid, { customDomain: true, domainSubId: o.subscription }, { stripeCustomerId: o.customer });
      if (uid && feature === 'plan' && ['starter', 'pro', 'team'].includes(tier)) await setPlan(uid, { tier }, { stripeCustomerId: o.customer, stripeSubId: o.subscription });
    }
    if (ev.type === 'customer.subscription.updated' || ev.type === 'customer.subscription.deleted') {
      const ix = await getDoc(`idx/stripe-sub/${o.id}`.toLowerCase());
      const uid = o.metadata?.uid || ix?.uid;
      const feature = o.metadata?.feature || ix?.feature;
      const active = ev.type === 'customer.subscription.updated' && ['active', 'trialing', 'past_due'].includes(o.status);
      // Plan changes made in the billing portal swap the price; read the tier from the current price
      const priceToTier = Object.fromEntries(['starter', 'pro', 'team'].map(k => [process.env['STRIPE_PRICE_' + k.toUpperCase()], k]).filter(([p]) => p));
      const tierNow = priceToTier[o.items?.data?.[0]?.price?.id] || o.metadata?.tier || ix?.tier;
      if (uid && feature === 'customDomain') await setPlan(uid, { customDomain: active });
      if (uid && feature === 'plan') {
        const u = await getUserById(uid);
        if (u && (!u.stripeSubId || u.stripeSubId === o.id)) await setPlan(uid, { tier: active ? tierNow : 'trial' }, { stripeSubId: active ? o.id : null });
      }
    }
  } catch (e) { console.error('stripe webhook', e); return res.status(500).end(); }
  return res.status(200).json({ received: true });
}
