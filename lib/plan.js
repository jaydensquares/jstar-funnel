// Plans, limits and paid features.
// Stripe prices are found by lookup key (jstarpro_<plan>_monthly); STRIPE_PRICE_* env vars override.
// COMP_EMAILS (comma-separated) get Pro free (testing / friends).
export const PLANS = {
  // 'trial' is the stored key for an account with no paid plan: nothing is usable until they pay
  trial:   { name: 'No plan', price: 0,   customDomain: false, limits: { runs: 0,   photos: 0,  listCalls: 0 } },
  starter: { name: 'Starter', price: 49,  customDomain: false, limits: { runs: 100, photos: 10, listCalls: 8 } },
  pro:     { name: 'Pro',     price: 99,  customDomain: true,  limits: { runs: 300, photos: 30, listCalls: 24 } },
  team:    { name: 'Team',    price: 199, customDomain: true,  limits: { runs: 800, photos: 80, listCalls: 60 } },
};
export const DOMAIN_ADDON_PRICE = 19;
export const PRICE_ENV = { starter: 'STRIPE_PRICE_STARTER', pro: 'STRIPE_PRICE_PRO', team: 'STRIPE_PRICE_TEAM', domain: 'STRIPE_PRICE_DOMAIN' };

const comped = u => String(process.env.COMP_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean).includes(String(u?.email || '').toLowerCase());
export function tierOf(u) {
  if (!u) return 'trial';
  if (comped(u)) return u.plan?.tier && PLANS[u.plan.tier] && u.plan.tier !== 'trial' ? u.plan.tier : 'pro';
  return PLANS[u.plan?.tier] ? u.plan.tier : 'trial';
}
export const limitsOf = u => PLANS[tierOf(u)].limits;
export const isActive = u => !!u && !u.disabled && tierOf(u) !== 'trial';
export const hasCustomDomain = u => !!u && (PLANS[tierOf(u)].customDomain || !!u.plan?.customDomain);
// Prices are looked up in Stripe by lookup key at checkout (lib/stripe.js); a secret key is all that's needed here
export const billingReady = () => !!process.env.STRIPE_SECRET_KEY;
export const planStatus = u => ({
  tier: tierOf(u), name: PLANS[tierOf(u)].name, limits: limitsOf(u), customDomain: hasCustomDomain(u),
  domainAddon: !!u?.plan?.customDomain, hasBilling: !!u?.stripeCustomerId,
  ready: Object.fromEntries(Object.keys(PRICE_ENV).map(k => [k, billingReady(k)])),
});
