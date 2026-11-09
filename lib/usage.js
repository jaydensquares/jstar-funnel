// Monthly usage caps per account, set by its plan (the owner/PIN is unlimited).
import { getDoc, putDoc } from './db.js';
import { limitsOf, tierOf } from './plan.js';

const month = () => new Date().toISOString().slice(0, 7).replace('-', '');
const key = uid => `t/${uid}/usage/${month()}`;
const LABEL = { runs: 'deal analyses', photos: 'photo analyses', listCalls: 'list records' };

export async function getUsage(user) {
  return { month: month(), ...(await getDoc(key(user.id)).catch(() => null) || {}), limits: limitsOf(user), tier: tierOf(user) };
}

// Returns null if allowed (and records it), or an error message if over the plan's cap.
// actor: { owner } or { scope, user }
export async function useQuota(actor, kind, n = 1) {
  if (!actor || actor.owner) return null;
  const limit = limitsOf(actor.user)[kind];
  const u = (await getDoc(key(actor.scope)).catch(() => null)) || {};
  const used = u[kind] || 0;
  if (used + n > limit) {
    return tierOf(actor.user) === 'trial'
      ? `Your trial includes ${limit} ${LABEL[kind]}. Choose a plan to keep going.`
      : `You've used this month's ${LABEL[kind]} on your plan (${limit}). Upgrade or wait until the 1st.`;
  }
  await putDoc(key(actor.scope), { ...u, [kind]: used + n }, { keep: 1 });
  return null;
}
