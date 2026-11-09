// Stripe Checkout for the custom-domain add-on, and the Stripe customer portal (manage / cancel).
import { currentUser } from '../lib/auth.js';
import { billingReady, priceId, tierOf, PLANS } from '../lib/plan.js';

const stripe = async (path, params) => {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `Stripe ${r.status}`);
  return j;
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!String(req.headers['content-type'] || '').includes('application/json')) return res.status(415).json({ error: 'JSON only' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const u = await currentUser(req).catch(() => null);
  if (!u) return res.status(401).json({ error: 'Log in again.' });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'Online payments aren\'t switched on yet. We\'ll email you when they are.' });
  const origin = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  try {
    if (b.action === 'checkout') {
      // b.plan: starter | pro | team | domain (the custom-domain add-on for Starter)
      const key = ['starter', 'pro', 'team', 'domain'].includes(b.plan) ? b.plan : 'pro';
      if (!billingReady(key)) return res.status(503).json({ error: 'That plan isn\'t available yet.' });
      const cur = tierOf(u);
      if (key === 'domain' && PLANS[cur].customDomain) return res.status(400).json({ error: 'Your plan already includes a custom domain.' });
      if (key !== 'domain' && cur === key && u.stripeSubId) return res.status(400).json({ error: 'You\'re already on this plan.' });
      // Switching between paid plans happens in the billing portal so the old subscription is replaced, not doubled
      if (key !== 'domain' && u.stripeSubId && u.stripeCustomerId) {
        const s = await stripe('billing_portal/sessions', { customer: u.stripeCustomerId, return_url: `${origin}/app#account` });
        return res.status(200).json({ url: s.url });
      }
      const feature = key === 'domain' ? 'customDomain' : 'plan';
      const params = {
        mode: 'subscription',
        'line_items[0][price]': priceId(key), 'line_items[0][quantity]': '1',
        success_url: `${origin}/app?paid=${key}#${key === 'domain' ? 'domain' : 'leads'}`, cancel_url: `${origin}/app#account`,
        client_reference_id: u.id, 'metadata[uid]': u.id, 'metadata[feature]': feature, 'metadata[tier]': key,
        'subscription_data[metadata][uid]': u.id, 'subscription_data[metadata][feature]': feature, 'subscription_data[metadata][tier]': key,
        allow_promotion_codes: 'true',
      };
      if (u.stripeCustomerId) params.customer = u.stripeCustomerId; else params.customer_email = u.email;
      const s = await stripe('checkout/sessions', params);
      return res.status(200).json({ url: s.url });
    }
    if (b.action === 'portal') {
      if (!u.stripeCustomerId) return res.status(400).json({ error: 'No billing account yet.' });
      const s = await stripe('billing_portal/sessions', { customer: u.stripeCustomerId, return_url: `${origin}/app#account` });
      return res.status(200).json({ url: s.url });
    }
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    console.error('billing', e);
    return res.status(502).json({ error: 'Payment page couldn\'t open. Try again.' });
  }
}
