// Stripe webhook: keeps each account's plan and the custom-domain add-on in sync with Stripe.
// Events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted,
//         invoice.paid, invoice.payment_failed
import crypto from 'node:crypto';
import { getUserById, saveUser, sendPlainEmail } from '../lib/auth.js';
import { getDoc, putDoc } from '../lib/db.js';
import { tierFromLookup, stripe } from '../lib/stripe.js';
import { PACKS, PLANS, PAID } from '../lib/plan.js';
import { addCredits } from '../lib/usage.js';
import { layout, p as P, small, button, rows, callout, esc as E } from '../lib/email.js';
const APP = 'https://getjstarpro.com/app';

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
      if (uid && feature === 'plan' && PAID.includes(tier)) {
        await setPlan(uid, { tier, interval: o.metadata?.interval || 'month' }, { stripeCustomerId: o.customer, stripeSubId: o.subscription, ...(o.discounts?.length || o.total_details?.amount_discount ? { refUsed: true } : {}) });
        // Welcome email, once per account
        const w = await getUserById(uid);
        if (w && !w.welcomed) {
          await saveUser({ ...w, welcomed: Date.now() });
          const pl = PLANS[tier], L = pl.limits, first = (w.name || '').split(' ')[0] || 'there', funnel = `https://getjstarpro.com/f/${w.slug}`;
          await sendPlainEmail(w.email, `Welcome to JStar Pro, ${first}`,
            `Hi ${first},\n\nYou're on JStar Pro ${pl.name}. Your seller funnel is live at ${funnel}.\n\nGet set up in 3 steps:\n1. Add your logo, phone and service area: ${APP}#funnel\n2. Point your ads or mailers at your funnel link.\n3. Run your first address: https://getjstarpro.com/operator\n\nQuestions? https://getjstarpro.com/support\n\nJStar Pro`,
            layout({ preheader: `Your ${pl.name} plan is active and your seller funnel is live.`, eyebrow: `${pl.name} plan · active`, title: `Welcome to JStar Pro, ${E(first)}`,
              body: P(`Your plan is active and your seller funnel is already live. Here's how to get your first deal moving.`)
                + rows([['Your funnel', `<a href="${funnel}" style="color:#2f6fed;text-decoration:none">${E(funnel.replace('https://', ''))}</a>`], ['Deal analyses', `${L.runs.toLocaleString()} / month`], ['Skip traces', `${L.skips} / month`], ['Photo estimates', `${L.photos} / month`]])
                + P(`<b>1.&nbsp; Brand your funnel.</b> Add your logo, phone number and service area so sellers know who they're talking to.<br><b>2.&nbsp; Send it traffic.</b> Point your ads, mailers or texts at your funnel link. Every lead lands with the math done.<br><b>3.&nbsp; Run your first address.</b> Comps, ARV, repairs, mortgage and your max offer in about 10 seconds.`)
                + button(`${APP}#leads`, 'Open JStar Pro') + small('Questions or need a hand setting up? Reach us any time at <a href="https://getjstarpro.com/support" style="color:#2f6fed">getjstarpro.com/support</a>.'),
              footer: 'You received this email because you started a JStar Pro subscription.' })).catch(e => console.error('welcome email', e.message));
        }
      }
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
          const rf = (r.name || '').split(' ')[0] || 'there';
          await sendPlainEmail(r.email, `You just earned $${amt} off your next JStar Pro bill`, `Hi ${rf},\n\n${u.company || u.name} just became a paying JStar Pro customer through your referral link. We added $${amt} in account credit, which takes 50% off your next bill. Every referral earns another 50% off.\n\nYour referral link: https://getjstarpro.com/?ref=${r.slug}\n\nThank you for spreading the word.\n\nJStar Pro`,
            layout({ preheader: `${u.company || u.name} joined through your link. $${amt} credit added.`, eyebrow: 'Referral reward', title: `You earned $${amt} off your next bill`,
              body: P(`Hi ${E(rf)},`) + P(`<b>${E(u.company || u.name)}</b> just became a paying JStar Pro customer through your referral link. Thank you for spreading the word.`)
                + rows([['Credit added', `<span style="color:#067647">$${amt}.00</span>`], ['Applied to', 'Your next invoice'], ['Total referrals paid', String((fresh.refStats?.paid || 0) + 1)]])
                + callout(`Every referral earns another 50% off a month. Share your link: <a href="https://getjstarpro.com/?ref=${E(r.slug)}" style="color:#2f6fed">getjstarpro.com/?ref=${E(r.slug)}</a>`, 'ok')
                + button(`${APP}#account`, 'View your referrals'),
              footer: 'You received this email because someone signed up with your JStar Pro referral link.' })).catch(() => {});
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
        const df = (u.name || '').split(' ')[0] || 'there';
        await sendPlainEmail(u.email, 'Action needed: your JStar Pro payment didn\'t go through',
          `Hi ${df},\n\nWe weren't able to process your JStar Pro payment of ${amt}. We'll retry automatically over the next few days.\n\nTo keep your funnel and tools running without interruption, update your payment method: open ${link} and tap Manage billing.\n\nJStar Pro`,
          layout({ preheader: `Update your payment method to keep your funnel and tools running.`, eyebrow: 'Billing', title: 'Your payment didn\'t go through',
            body: P(`Hi ${E(df)},`) + P(`We weren't able to process your latest JStar Pro payment. This usually happens when a card expires or the bank flags the charge.`)
              + rows([['Amount due', amt], ['Next step', 'Update your payment method']])
              + callout(`We'll retry automatically over the next few days. To avoid any interruption to your seller funnel and tools, update your card now.`, 'warn')
              + button(link, 'Update payment method') + small('Open Plan &amp; account and tap <b>Manage billing</b>. It takes less than a minute.'),
            footer: 'You received this email about the billing on your JStar Pro account.' })).catch(e => console.error('dunning email', e));
      }
    }
  } catch (e) { console.error('stripe webhook', e); return res.status(500).end(); }
  return res.status(200).json({ received: true });
}
