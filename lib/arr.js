// ARR history rebuilt from Stripe subscriptions (list prices, before coupons and referral credits).
// A subscription counts from when it first pays (trial end, else start) until it ends or cancels.
import { stripe } from './stripe.js';

const monthly = item => {
  const p = item?.price || item?.plan || {}, amt = (p.unit_amount ?? p.amount ?? 0) * (item?.quantity || 1) / 100;
  const iv = p.recurring?.interval || p.interval || 'month', n = p.recurring?.interval_count || p.interval_count || 1;
  return iv === 'year' ? amt / (12 * n) : iv === 'week' ? amt * 52 / 12 / n : iv === 'day' ? amt * 365 / 12 / n : amt / n;
};

export async function listSubs() {
  const out = []; let after;
  for (let i = 0; i < 20; i++) {
    const r = await stripe('GET', 'subscriptions', { status: 'all', limit: 100, ...(after ? { starting_after: after } : {}) });
    out.push(...(r.data || []));
    if (!r.has_more || !r.data?.length) break;
    after = r.data.at(-1).id;
  }
  return out;
}

// → { spans: [{ from, to, mrr, id }], months: [{ m, mrr, arr, new, churn, subs }], now: { mrr, arr, subs } }
export function arrFrom(subs, now = Date.now()) {
  const spans = subs.filter(s => !['incomplete', 'incomplete_expired'].includes(s.status)).map(s => {
    const from = (s.trial_end || s.start_date || s.created) * 1000;
    const to = s.ended_at ? s.ended_at * 1000 : s.status === 'canceled' ? (s.canceled_at || s.ended_at || s.created) * 1000 : null;
    const mrr = (s.items?.data || []).reduce((t, it) => t + monthly(it), 0);
    return { id: s.id, from, to, mrr: Math.round(mrr * 100) / 100 };
  }).filter(x => x.mrr > 0 && (x.to == null || x.to > x.from));
  const live = t => spans.filter(x => x.from <= t && (x.to == null || x.to > t));
  const sum = a => Math.round(a.reduce((t, x) => t + x.mrr, 0) * 100) / 100;
  const first = spans.length ? Math.min(...spans.map(x => x.from)) : now;
  const d = new Date(first); let y = d.getUTCFullYear(), mo = d.getUTCMonth();
  const end = new Date(now), months = [];
  while (y < end.getUTCFullYear() || (y === end.getUTCFullYear() && mo <= end.getUTCMonth())) {
    const start = Date.UTC(y, mo, 1), next = Date.UTC(y, mo + 1, 1), at = Math.min(next - 1, now);
    const a = live(at), mrr = sum(a);
    months.push({ m: `${y}-${String(mo + 1).padStart(2, '0')}`, mrr, arr: Math.round(mrr * 12), subs: a.length,
      new: sum(spans.filter(x => x.from >= start && x.from < next && x.from <= now)), churn: sum(spans.filter(x => x.to != null && x.to >= start && x.to < next && x.to <= now)) });
    if (++mo > 11) { mo = 0; y++; }
  }
  const cur = live(now), mrr = sum(cur);
  return { months: months.slice(-24), now: { mrr, arr: Math.round(mrr * 12), subs: cur.length } };
}
