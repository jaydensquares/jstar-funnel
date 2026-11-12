// Minimal Stripe REST client (no SDK) plus price lookup by lookup_key.
// Prices are found by lookup key (jstarpro_<plan>_monthly), so no price IDs need to be pasted into env vars.
// STRIPE_PRICE_<PLAN> env vars still win if set.

const enc = (obj, prefix = '', out = new URLSearchParams()) => {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' ? enc(x, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else if (typeof v === 'object') enc(v, key, out);
    else out.append(key, String(v));
  }
  return out;
};

export async function stripe(method, path, params = {}, { idem } = {}) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not set');
  const qs = enc(params).toString();
  const get = method === 'GET';
  const headers = { Authorization: `Bearer ${key}` };
  if (!get) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (idem && !get) headers['Idempotency-Key'] = idem;
  const r = await fetch(`https://api.stripe.com/v1/${path}${get && qs ? '?' + qs : ''}`, { method, headers, body: get ? undefined : qs });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error?.message || `Stripe ${r.status}`); e.status = r.status; e.code = j.error?.code; throw e; }
  return j;
}

export const LOOKUP = { starter: 'jstarpro_starter_monthly', pro: 'jstarpro_pro_monthly', team: 'jstarpro_team_monthly', domain: 'jstarpro_domain_monthly',
  starter_year: 'jstarpro_starter_yearly', pro_year: 'jstarpro_pro_yearly', team_year: 'jstarpro_team_yearly',
  pack_runs: 'jstarpro_pack_runs', pack_photos: 'jstarpro_pack_photos', pack_lists: 'jstarpro_pack_lists', pack_skips: 'jstarpro_pack_skips' };
// jstarpro_<tier>_<monthly|yearly> → tier
export const tierFromLookup = lk => (String(lk || '').match(/^jstarpro_(starter|pro|team|agency)_(monthly|yearly)$/) || [])[1] || null;

const cache = new Map();
export async function priceFor(key) {
  const env = process.env['STRIPE_PRICE_' + key.toUpperCase()];
  if (env) return env;
  if (cache.has(key)) return cache.get(key);
  const r = await stripe('GET', 'prices', { 'lookup_keys': [LOOKUP[key]], active: true, limit: 1 });
  const id = r.data?.[0]?.id || null;
  if (id) cache.set(key, id);
  return id;
}
