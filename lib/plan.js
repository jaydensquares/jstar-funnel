// Plans, limits and paid features.
// Stripe prices are found by lookup key (jstarpro_<plan>_monthly); STRIPE_PRICE_* env vars override.
// COMP_EMAILS (comma-separated) get Pro free (testing / friends).
export const PLANS = {
  // 'trial' is the stored key for an account with no paid plan: nothing is usable until they pay
  trial:   { name: 'No plan', price: 0,   customDomain: false, limits: { runs: 0,   photos: 0,  listCalls: 0 } },
  starter: { name: 'Starter', price: 49,  customDomain: false, limits: { runs: 100, photos: 10, listCalls: 8 } },
  pro:     { name: 'Pro',     price: 99,  customDomain: true,  limits: { runs: 300, photos: 30, listCalls: 24 } },
  team:    { name: 'Team',    price: 199, customDomain: true,  limits: { runs: 800, photos: 80, listCalls: 60 } },
  // Agency: custom pricing (book a call); set from the admin page. Limits are the default and can be raised per account.
  agency:  { name: 'Agency',  price: null, custom: true, customDomain: true, seats: 5, limits: { runs: 2000, photos: 200, listCalls: 160 } },
};
export const PAID = ['starter', 'pro', 'team', 'agency'];
export const SELF_SERVE = ['starter', 'pro', 'team'];
export const YEARLY_MONTHS = 10; // pay yearly = 2 months free
export const seatsOf = u => PLANS[tierOf(u)]?.seats || 0;
export const DOMAIN_ADDON_PRICE = 19;
// One-time add-on packs: credits used after the plan's monthly amount runs out; they don't expire
export const PACKS = {
  runs:   { name: '100 deal analyses',  kind: 'runs',      n: 100, price: 25 },
  photos: { name: '25 photo estimates', kind: 'photos',    n: 25,  price: 15 },
  lists:  { name: '5,000 list records', kind: 'listCalls', n: 10,  price: 25 }, // 10 calls × 500 records
};
export const PRICE_ENV = { starter: 'STRIPE_PRICE_STARTER', pro: 'STRIPE_PRICE_PRO', team: 'STRIPE_PRICE_TEAM', agency: 'STRIPE_PRICE_AGENCY', domain: 'STRIPE_PRICE_DOMAIN' };

const comped = u => String(process.env.COMP_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean).includes(String(u?.email || '').toLowerCase());
// The operator account (Jayden's own, flagged from the admin page) gets every paid feature with no limits
export const isOperator = u => !!u?.operator;
export function tierOf(u) {
  if (!u) return 'trial';
  if (isOperator(u)) return 'team';
  if (comped(u)) return u.plan?.tier && PLANS[u.plan.tier] && u.plan.tier !== 'trial' ? u.plan.tier : 'pro';
  return PLANS[u.plan?.tier] ? u.plan.tier : 'trial';
}
const UNLIMITED = { runs: Infinity, photos: Infinity, listCalls: Infinity };
export const limitsOf = u => isOperator(u) ? UNLIMITED : { ...PLANS[tierOf(u)].limits, ...(u?.plan?.limits || {}) };
export const isActive = u => !!u && !u.disabled && tierOf(u) !== 'trial';
export const hasCustomDomain = u => !!u && (PLANS[tierOf(u)].customDomain || !!u.plan?.customDomain);
// Prices are looked up in Stripe by lookup key at checkout (lib/stripe.js); a secret key is all that's needed here
export const billingReady = () => !!process.env.STRIPE_SECRET_KEY;
export const planStatus = u => ({
  tier: tierOf(u), name: isOperator(u) ? 'Operator' : PLANS[tierOf(u)].name, operator: isOperator(u),
  limits: isOperator(u) ? { runs: null, photos: null, listCalls: null } : limitsOf(u), customDomain: hasCustomDomain(u),
  domainAddon: !!u?.plan?.customDomain, hasBilling: !!u?.stripeCustomerId, interval: u?.plan?.interval || 'month', seats: seatsOf(u),
  ready: Object.fromEntries(Object.keys(PRICE_ENV).map(k => [k, billingReady(k)])),
});
