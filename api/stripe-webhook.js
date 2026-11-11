// Stripe webhook: keeps each account's plan and the custom-domain add-on in sync with Stripe.
// Events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted,
//         invoice.paid, invoice.payment_failed
import crypto from 'node:crypto';
import { getUserById, saveUser, sendPlainEmail } from '../lib/auth.js';
import { getDoc, putDoc } from '../lib/db.js';
import { tierFromLookup, stripe } from '../lib/stripe.js';
import { PACKS, PLANS, PAID } from '../lib/plan.js';
import { addCredits } from '../lib/usage.js';

// past_due stays on while Smart Retries work; unpaid / canceled / incomplete turn it off
const LIVE = ['active', 'trialing', 'past_due'];
const uidFor = async o => o.metadata?.uid || o.subscription_details?.metadata?.uid || o.parent?.subscription_details?.metadata?.uid
  || (await getDoc(`idx/stripe-sub/${o.subscription || o.parent?.subscription_details?.subscription || ''}`.toLowerCase()).catch(() => null))?.uid;

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
    if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') {
      const uid = o.client_reference_id || o.metadata?.uid;
      const feature = o.metadata?.feature, tier = o.metadata?.tier;
      // Add-on pack: add credits once per paid session
      if (uid && feature === 'pack' && PACKS[o.metadata?.pack] && o.payment_status === 'paid') {
        const ik = `idx/stripe-pack/${o.id}`.toLowerCase();
        if (!(await getDoc(ik).catch(() => null))) {
          const pk = PACKS[o.metadata.pack];
          await addCredits(uid, pk.kind, pk.n);
          await putDoc(ik, { uid, pack: o.metadata.pack, at: Date.now() }, { keep: 1 });
        }
      }
      if (uid && o.subscription) await putDoc(`idx/stripe-sub/${o.subscription}`.toLowerCase(), { uid, feature, tier });
      if (uid && feature === 'customDomain') await setPlan(uid, { customDomain: true, domainSubId: o.subscription }, { stripeCustomerId: o.customer });
      if (uid && feature === 'plan' && PAID.includes(tier)) await setPlan(uid, { tier, interval: o.metadata?.interval || 'month' }, { stripeCustomerId: o.customer, stripeSubId: o.subscription, ...(o.discounts?.length || o.total_details?.amount_discount ? { refUsed: true } : {}) });
    }
    if (ev.type === 'customer.subscription.updated' || ev.type === 'customer.subscription.deleted') {
      const ix = await getDoc(`idx/stripe-sub/${o.id}`.toLowerCase());
      const uid = o.metadata?.uid || ix?.uid;
      const feature = o.metadata?.feature || ix?.feature;
      const active = ev.type === 'customer.subscription.updated' && LIVE.includes(o.status);
      // Plan changes made in the billing portal swap the price; read the tier from the current price's lookup key
      const p = o.items?.data?.[0]?.price || {};
      const envTier = Object.fromEntries(PAID.map(k => [process.env['STRIPE_PRICE_' + k.toUpperCase()], k]).filter(([x]) => x))[p.id];
      const tierNow = [tierFromLookup(p.lookup_key), envTier, p.metadata?.tier, o.metadata?.tier, ix?.tier].find(t => PAID.includes(t));
      if (uid && feature === 'customDomain') await setPlan(uid, { customDomain: active });
      if (uid && feature === 'plan') {
        const u = await getUserById(uid);
        if (u && (!u.stripeSubId || u.stripeSubId === o.id)) await setPlan(uid, { tier: active && tierNow ? tierNow : 'trial', interval: p.recurring?.interval || 'month' }, { stripeSubId: active ? o.id : null, billingIssue: o.status === 'past_due' });
      }
    }
    // Renewal went through: clear any card-problem flag
    if (ev.type === 'invoice.paid') {
      const uid = await uidFor(o); let u = uid && await getUserById(uid);
      if (u?.billingIssue) u = await saveUser({ ...u, billingIssue: false });
      // Referral reward: the referred account's first real payment earns the referrer 50% off their next month (as account credit)
      if (u?.referredBy && !u.refRewarded && (o.amount_paid || 0) > 0 && (o.subscription || o.parent?.subscription_details?.subscription)) {
        await saveUser({ ...u, refRewarded: Date.now() });
        const r = await getUserById(u.referredBy);
        if (r) {
          const amt = Math.round((PLANS[r.plan?.tier]?.price || 49) / 2);
          if (r.stripeCustomerId) await stripe('POST', `customers/${r.stripeCustomerId}/balance_transactions`, { amount: -amt * 100, currency: 'usd', description: `Referral credit: ${u.company || u.name}` }, { idem: `ref-${u.id}` }).catch(e => console.error('ref credit', e.message));
          const fresh = await getUserById(r.id);
          await saveUser({ ...fresh, refPending: r.stripeCustomerId ? (fresh.refPending || 0) : (fresh.refPending || 0) + amt, refStats: { ...(fresh.refStats || {}), paid: (fresh.refStats?.paid || 0) + 1, earned: (fresh.refStats?.earned || 0) + amt } });
          await sendPlainEmail(r.email, 'You earned 50% off next month on JStar Pro', `${u.company || u.name} just became a paying JStar Pro customer from your referral link. We added $${amt} of credit to your account, which takes 50% off your next bill. Every referral earns another 50% off.\n\nThanks for spreading the word.\n\nJStar Pro`).catch(() => {});
        }
      }
    }
    // Card declined: Stripe's Smart Retries keep trying; tell the customer how to fix it
    if (ev.type === 'invoice.payment_failed') {
      const uid = await uidFor(o); const u = uid && await getUserById(uid);
      if (u) {
        await saveUser({ ...u, billingIssue: true });
        const amt = '$' + ((o.amount_due || 0) / 100).toFixed(2);
        const link = 'https://getjstarpro.com/app#account';
        await sendPlainEmail(u.email, 'Your JStar Pro payment didn\'t go through',
          `Hi ${u.name.split(' ')[0]},\n\nYour card was declined for your JStar Pro payment of ${amt}. We'll try again automatically over the next few days.\n\nTo keep your funnel and tools running, update your card: open ${link} and tap Manage billing.\n\nJStar Pro`).catch(e => console.error('dunning email', e));
      }
    }
  } catch (e) { console.error('stripe webhook', e); return res.status(500).end(); }
  return res.status(200).json({ received: true });
}
