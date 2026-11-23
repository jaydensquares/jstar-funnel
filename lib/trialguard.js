// One free trial per person. Before checkout we skip the trial when the email (Gmail dots and +tags ignored) or phone
// already had one. After checkout we also check the card (Stripe's card fingerprint, the same for every account that
// uses that card) and the name + billing address. A repeat cancels the new trial right away, so nobody is charged, and
// they can pick a plan without a trial. Registry docs: trialreg/<hashed key> = { uid, at, kind }.
import crypto from 'node:crypto';
import { getDoc, putDoc } from './db.js';
import { stripe } from './stripe.js';

const h = s => crypto.createHash('sha256').update('jstar-trial:' + s).digest('hex').slice(0, 40);
export function normEmail(e) {
  let [local = '', dom = ''] = String(e || '').trim().toLowerCase().split('@');
  local = local.split('+')[0];
  if (dom === 'googlemail.com') dom = 'gmail.com';
  if (dom === 'gmail.com') local = local.replace(/\./g, '');
  return local && dom ? `${local}@${dom}` : '';
}
const normPhone = p => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
const normAddr = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  .replace(/street$|st$/, 'st').replace(/avenue$|ave$/, 'av').replace(/drive$|dr$/, 'dr').replace(/road$|rd$/, 'rd').replace(/lane$|ln$/, 'ln');

export function identityKeys(u) {
  const k = [];
  const e = normEmail(u?.email); if (e) k.push(['email', h('e:' + e)]);
  const p = normPhone(u?.phone); if (p) k.push(['phone', h('p:' + p)]);
  return k;
}
export function paymentKeys(pm) {
  const k = [];
  const fp = pm?.card?.fingerprint; if (fp) k.push(['card', h('c:' + fp)]);
  const b = pm?.billing_details || {}, a = b.address || {};
  const name = String(b.name || '').toLowerCase().replace(/[^a-z]/g, ''), line = normAddr(a.line1), zip = String(a.postal_code || '').slice(0, 5);
  if (name && line && zip) k.push(['billing', h(`b:${name}|${line}|${zip}`)]);
  return k;
}

// First key that already belongs to a different account, or null
export async function usedBy(keys, uid) {
  for (const [kind, key] of keys) {
    const d = await getDoc(`trialreg/${key}`).catch(() => null);
    if (d && d.uid !== uid) return { kind, uid: d.uid };
  }
  return null;
}
export async function register(keys, uid) {
  await Promise.all(keys.map(([kind, key]) => putDoc(`trialreg/${key}`, { uid, kind, at: Date.now() }, { keep: 1 }).catch(() => {})));
}

const LABEL = { card: 'card', billing: 'name and billing address', email: 'email', phone: 'phone number' };
// Called from the Stripe webhook right after a trial checkout. Returns { blocked, reason } or { blocked: false }.
export async function checkTrialCheckout(u, subId) {
  const sub = await stripe('GET', `subscriptions/${subId}`, { 'expand[]': 'default_payment_method' });
  const pm = typeof sub.default_payment_method === 'object' ? sub.default_payment_method : null;
  const keys = [...paymentKeys(pm), ...identityKeys(u)];
  const hit = await usedBy(keys, u.id);
  if (!hit) { await register(keys, u.id); return { blocked: false }; }
  if (sub.status === 'trialing') await stripe('DELETE', `subscriptions/${subId}`, {});
  return { blocked: true, reason: LABEL[hit.kind] || 'details', otherUid: hit.uid };
}
