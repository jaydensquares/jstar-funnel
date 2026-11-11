// Stripe Checkout (plans and the custom-domain add-on) and the Stripe customer portal (switch plan, card, invoices, cancel).
import { currentUser, saveUser } from '../lib/auth.js';
import { tierOf, PLANS, PACKS, isActive, SELF_SERVE } from '../lib/plan.js';
import { stripe as api, priceFor } from '../lib/stripe.js';

const stripe = (path, params, opt) => api('POST', path, params, opt);
const portal = (u, origin) => stripe('billing_portal/sessions', { customer: u.stripeCustomerId, return_url: `${origin}/app#account`, configuration: process.env.STRIPE_PORTAL_CONFIG || undefined });

// One Stripe customer per account, reused for every checkout (no duplicates when someone abandons checkout and retries)
async function ensureCustomer(u) {
  if (u.stripeCustomerId) return u;
  const c = await stripe('customers', { email: u.email, name: u.company || u.name, 'metadata[uid]': u.id, 'metadata[slug]': u.slug }, { idem: `cust-${u.id}` });
  // Referral credits earned before they had a billing account
  if (u.refPending > 0) await stripe(`customers/${c.id}/balance_transactions`, { amount: -Math.round(u.refPending * 100), currency: 'usd', description: 'Referral credit' }, { idem: `refpend-${u.id}-${u.refPending}` }).catch(e => console.error('ref credit', e.message));
  return saveUser({ ...u, stripeCustomerId: c.id, refPending: 0 });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!String(req.headers['content-type'] || '').includes('application/json')) return res.status(415).json({ error: 'JSON only' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  let u = await currentUser(req).catch(() => null);
  if (!u) return res.status(401).json({ error: 'Log in again.' });
  if (u.memberOf) return res.status(403).json({ error: 'Your team owner handles billing.' });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'Online payments aren\'t switched on yet. We\'ll email you when they are.' });
  const origin = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  try {
    if (b.action === 'checkout') {
      // b.plan: starter | pro | team | domain (the custom-domain add-on for Starter); b.interval: month | year
      if (b.plan === 'agency') return res.status(400).json({ error: 'Agency is custom pricing. Book a call and we\'ll set it up.' });
      const key = [...SELF_SERVE, 'domain'].includes(b.plan) ? b.plan : 'pro';
      const interval = b.interval === 'year' && key !== 'domain' ? 'year' : 'month';
      const price = await priceFor(interval === 'year' ? key + '_year' : key);
      if (!price) return res.status(503).json({ error: 'That plan isn\'t available yet.' });
      const cur = tierOf(u);
      if (key === 'domain' && PLANS[cur].customDomain) return res.status(400).json({ error: 'Your plan already includes a custom domain.' });
      if (key !== 'domain' && cur === key && u.stripeSubId) return res.status(400).json({ error: 'You\'re already on this plan.' });
      // Switching between paid plans happens in the billing portal so the old subscription is replaced, not doubled
      if (key !== 'domain' && u.stripeSubId && u.stripeCustomerId) {
        const s = await portal(u, origin);
        return res.status(200).json({ url: s.url });
      }
      u = await ensureCustomer(u);
      const feature = key === 'domain' ? 'customDomain' : 'plan';
      const params = {
        mode: 'subscription',
        customer: u.stripeCustomerId,
        'line_items[0][price]': price, 'line_items[0][quantity]': '1',
        success_url: `${origin}/app?paid=${key}#${key === 'domain' ? 'domain' : 'leads'}`, cancel_url: `${origin}/app#account`,
        client_reference_id: u.id, 'metadata[uid]': u.id, 'metadata[feature]': feature, 'metadata[tier]': key,
        'subscription_data[metadata][uid]': u.id, 'subscription_data[metadata][feature]': feature, 'subscription_data[metadata][tier]': key, 'subscription_data[metadata][interval]': interval,
        'metadata[interval]': interval,
      };
      // Referred and paying monthly: first month free (yearly already includes 2 free months)
      const firstPlan = feature === 'plan' && !u.stripeSubId && !u.refUsed;
      if (firstPlan && u.referredBy && interval === 'month') params['discounts[0][coupon]'] = 'jstarpro-ref-1mo';
      else params.allow_promotion_codes = 'true';
      // Sales tax: turn on with STRIPE_TAX=1 once Stripe Tax is set up and you're registered in Texas
      if (process.env.STRIPE_TAX === '1') Object.assign(params, { 'automatic_tax[enabled]': 'true', 'customer_update[address]': 'auto', 'customer_update[name]': 'auto', billing_address_collection: 'required' });
      const s = await stripe('checkout/sessions', params);
      return res.status(200).json({ url: s.url });
    }
    if (b.action === 'pack') {
      // One-time add-on pack; credits are added by the webhook once payment clears
      const pack = PACKS[b.pack] ? b.pack : null;
      if (!pack) return res.status(400).json({ error: 'Pick a pack.' });
      if (!isActive(u)) return res.status(400).json({ error: 'Choose a plan first. Add-on packs work on top of a plan.' });
      const price = await priceFor('pack_' + pack);
      if (!price) return res.status(503).json({ error: 'That pack isn\'t available yet.' });
      u = await ensureCustomer(u);
      const params = {
        mode: 'payment', customer: u.stripeCustomerId,
        'line_items[0][price]': price, 'line_items[0][quantity]': '1',
        success_url: `${origin}/app?pack=${pack}#account`, cancel_url: `${origin}/app#account`,
        client_reference_id: u.id, 'metadata[uid]': u.id, 'metadata[feature]': 'pack', 'metadata[pack]': pack,
        'payment_intent_data[metadata][uid]': u.id, 'payment_intent_data[metadata][pack]': pack,
        'invoice_creation[enabled]': 'true',
      };
      if (process.env.STRIPE_TAX === '1') Object.assign(params, { 'automatic_tax[enabled]': 'true', 'customer_update[address]': 'auto', 'customer_update[name]': 'auto', billing_address_collection: 'required' });
      const s = await stripe('checkout/sessions', params);
      return res.status(200).json({ url: s.url });
    }
    if (b.action === 'portal') {
      if (!u.stripeCustomerId) return res.status(400).json({ error: 'No billing account yet.' });
      const s = await portal(u, origin);
      return res.status(200).json({ url: s.url });
    }
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    console.error('billing', e);
    return res.status(502).json({ error: 'Payment page couldn\'t open. Try again.' });
  }
}
