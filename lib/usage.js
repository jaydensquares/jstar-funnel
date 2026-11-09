// Monthly usage caps for logged-in users (the owner/PIN is unlimited).
import { getDoc, putDoc } from './db.js';

export const LIMITS = {
  runs: Number(process.env.USER_LIMIT_RUNS || 150),      // deal analyses (Run deal, Batch rows, funnel leads)
  photos: Number(process.env.USER_LIMIT_PHOTOS || 30),   // AI photo analyses
  listCalls: Number(process.env.USER_LIMIT_LIST_CALLS || 20), // RentCast calls from Pull list (500 records each)
};
const month = () => new Date().toISOString().slice(0, 7).replace('-', '');
const key = uid => `t/${uid}/usage/${month()}`;

export async function getUsage(uid) {
  return { month: month(), ...(await getDoc(key(uid)).catch(() => null) || {}), limits: LIMITS };
}

// Returns null if allowed (and records it), or an error message if over the cap.
export async function useQuota(actor, kind, n = 1) {
  if (!actor || actor.owner) return null;
  const u = (await getDoc(key(actor.scope)).catch(() => null)) || {};
  const used = u[kind] || 0;
  if (used + n > LIMITS[kind]) return `You've hit this month's limit (${LIMITS[kind]} ${kind === 'runs' ? 'deal runs' : kind === 'photos' ? 'photo analyses' : 'list pulls'}). It resets on the 1st.`;
  await putDoc(key(actor.scope), { ...u, [kind]: used + n }, { keep: 1 });
  return null;
}
