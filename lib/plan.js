// Paid features. COMP_EMAILS (comma-separated) get paid features free (testing / friends).
export function hasCustomDomain(u) {
  if (!u) return false;
  const comp = String(process.env.COMP_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  return !!u.plan?.customDomain || comp.includes(String(u.email).toLowerCase());
}
export const billingReady = () => !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_DOMAIN);
