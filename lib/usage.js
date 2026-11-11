// Monthly usage caps per account, set by its plan (the owner/PIN is unlimited).
import { getDoc, putDoc } from './db.js';
import { limitsOf, tierOf, isOperator } from './plan.js';

const month = () => new Date().toISOString().slice(0, 7).replace('-', '');
const key = uid => `t/${uid}/usage/${month()}`;
const LABEL = { runs: 'deal analyses', photos: 'photo analyses', listCalls: 'list records' };

const ckey = uid => `t/${uid}/credits`;
export const getCredits = async uid => (await getDoc(ckey(uid)).catch(() => null)) || {};
export async function addCredits(uid, kind, n) {
  const c = await getCredits(uid);
  return putDoc(ckey(uid), { ...c, [kind]: (c[kind] || 0) + n, updatedAt: Date.now() }, { keep: 2 });
}

export async function getUsage(user) {
  const c = await getCredits(user.id);
  const lim = limitsOf(user);
  return { month: month(), ...(await getDoc(key(user.id)).catch(() => null) || {}), limits: isOperator(user) ? { runs: null, photos: null, listCalls: null } : lim, tier: tierOf(user), operator: isOperator(user),
    credits: { runs: c.runs || 0, photos: c.photos || 0, listCalls: c.listCalls || 0 } };
}

// Returns null if allowed (and records it), or an error message if over the plan's cap.
// actor: { owner } or { scope, user }
export async function useQuota(actor, kind, n = 1) {
  if (!actor || actor.owner) return null;
  if (isOperator(actor.user)) { // unlimited, but still counted so the admin page shows usage
    const u = (await getDoc(key(actor.scope)).catch(() => null)) || {};
    await putDoc(key(actor.scope), { ...u, [kind]: (u[kind] || 0) + n }, { keep: 1 }).catch(() => {});
    return null;
  }
  const limit = limitsOf(actor.user)[kind];
  const u = (await getDoc(key(actor.scope)).catch(() => null)) || {};
  const used = u[kind] || 0;
  if (tierOf(actor.user) === 'trial') return 'Choose a plan to start using JStar Pro. Go to Plan & account in your dashboard.';
  // Past the plan's monthly amount: draw the rest from add-on credits
  const over = Math.min(n, used + n - limit);
  if (over > 0) {
    const c = await getCredits(actor.scope);
    if ((c[kind] || 0) < over) return `You've used this month's ${LABEL[kind]} on your plan (${limit}). Buy an add-on pack or upgrade in Plan & account, or wait until the 1st.`;
    await putDoc(ckey(actor.scope), { ...c, [kind]: c[kind] - over, updatedAt: Date.now() }, { keep: 2 });
  }
  await putDoc(key(actor.scope), { ...u, [kind]: used + n }, { keep: 1 });
  return null;
}
