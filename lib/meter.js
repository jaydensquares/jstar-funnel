// Counts paid data/AI calls per month (RentCast, Realie, Anthropic) for the owner dashboard.
// Best effort: a lost count never blocks a run. Monthly allowances come from env so the admin page can show headroom.
import { waitUntil } from '@vercel/functions';
import { getDoc, putDoc } from './db.js';

const month = () => new Date().toISOString().slice(0, 7).replace('-', '');
export const meterKey = (m = month()) => `meter/${m}`;
let q = Promise.resolve(); // serialize writes within one function instance

export function meter(provider, n = 1, extra = {}) {
  q = q.then(async () => {
    const k = meterKey(), d = (await getDoc(k).catch(() => null)) || {};
    const next = { ...d, [provider]: (d[provider] || 0) + n, updatedAt: Date.now() };
    for (const [f, v] of Object.entries(extra)) next[f] = (d[f] || 0) + v;
    await putDoc(k, next, { keep: 1 });
  }).catch(e => console.error('meter', e.message));
  try { waitUntil(q); } catch {} // keep the function alive until the count is written
  return q;
}

// Allowance per month per provider (env overrides); null = not set
export const allowances = () => ({
  rentcast: Number(process.env.RENTCAST_MONTHLY_CALLS) || 50,
  realie: Number(process.env.REALIE_MONTHLY_CALLS) || 25,
  anthropic: null,
});
