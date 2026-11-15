// Affiliate program: anyone with a JStar Pro login can share getjstarpro.com/?via=<code>
// and earn a cash commission on what the customers they send pay us.
//   aff/<uid>       the affiliate: code, payout details, counters, commission ledger, payouts
//   affcode/<code>  code -> uid
import { getDoc, putDoc, deleteDoc, newId } from './db.js';

export const AFF = { rate: 0.30, months: 12, holdDays: 30, cookieDays: 60, minPayout: 50 };
export const CODE = /^[a-z0-9](?:[a-z0-9-]{1,22})[a-z0-9]$/;
const RESERVED = new Set(['admin', 'jstar', 'jstarpro', 'jstar-pro', 'support', 'test', 'free', 'discount', 'coupon']);
const DAY = 864e5;

export const getAff = uid => (/^[a-z0-9]{6,32}$/.test(uid || '') ? getDoc(`aff/${uid}`) : null);
export const saveAff = a => putDoc(`aff/${a.uid}`, { ...a, updatedAt: Date.now() });

export async function affByCode(code) {
  code = String(code || '').toLowerCase();
  if (!CODE.test(code)) return null;
  const ix = await getDoc(`affcode/${code}`).catch(() => null);
  if (!ix) return null;
  const a = await getAff(ix.uid);
  return a && a.code === code && a.status === 'active' ? a : null;
}

export async function codeTaken(code, uid) {
  if (RESERVED.has(code)) return true;
  const ix = await getDoc(`affcode/${code}`).catch(() => null);
  return !!ix && ix.uid !== uid;
}

export async function setCode(a, code) {
  const old = a.code;
  await putDoc(`affcode/${code}`, { uid: a.uid });
  if (old && old !== code) await deleteDoc(`affcode/${old}`).catch(() => {});
  return { ...a, code };
}

// Commission lines move pending -> payable after the hold (refund window), then paid
export function totals(a, now = Date.now()) {
  const t = { pending: 0, payable: 0, paid: 0, voided: 0, lifetime: 0 };
  for (const l of a.ledger || []) {
    if (l.status === 'void') { t.voided += l.amount; continue; }
    t.lifetime += l.amount;
    if (l.status === 'paid') t.paid += l.amount;
    else if (now - l.at >= AFF.holdDays * DAY) t.payable += l.amount;
    else t.pending += l.amount;
  }
  for (const k in t) t[k] = Math.round(t[k] * 100) / 100;
  return t;
}

export const lineState = (l, now = Date.now()) => l.status === 'paid' || l.status === 'void' ? l.status : now - l.at >= AFF.holdDays * DAY ? 'payable' : 'pending';

// Called for every paid invoice. Returns the new ledger line, or null when nothing is owed.
export async function recordCommission(customer, invoice, now = Date.now()) {
  if (!customer?.affiliateId || customer.affiliateId === customer.id) return null;
  const paid = (invoice.amount_paid || 0) / 100;
  if (paid <= 0) return null;
  const first = customer.affFirstPaidAt || now;
  if (now - first > AFF.months * 30.5 * DAY) return null;
  const a = await getAff(customer.affiliateId);
  if (!a || a.status === 'banned') return null;
  if ((a.ledger || []).some(l => l.invoice === invoice.id)) return null; // webhook retries
  const line = { id: newId(), invoice: invoice.id, customer: customer.id, who: customer.company || customer.name || 'Customer', paid, amount: Math.round(paid * AFF.rate * 100) / 100, at: now, status: 'open' };
  const firstPay = !(a.ledger || []).some(l => l.customer === customer.id);
  await saveAff({ ...a, ledger: [line, ...(a.ledger || [])].slice(0, 2000), paying: (a.paying || 0) + (firstPay ? 1 : 0) });
  return { line, first: !customer.affFirstPaidAt, affiliate: a };
}

// Mark every payable line paid and record the payout
export function payOut(a, { method, ref } = {}, now = Date.now()) {
  let amount = 0;
  const ledger = (a.ledger || []).map(l => {
    if (lineState(l, now) !== 'payable') return l;
    amount += l.amount; return { ...l, status: 'paid', paidAt: now };
  });
  amount = Math.round(amount * 100) / 100;
  if (!amount) return { a, amount: 0 };
  const payouts = [{ id: newId(), amount, at: now, method: method || a.payout?.method || '', ref: ref || '' }, ...(a.payouts || [])];
  return { a: { ...a, ledger, payouts }, amount };
}

export const publicAff = (a, now = Date.now()) => a && ({
  code: a.code, status: a.status, payout: a.payout || {}, createdAt: a.createdAt,
  clicks: a.clicks || 0, signups: a.signups || 0, paying: a.paying || 0,
  totals: totals(a, now),
  ledger: (a.ledger || []).slice(0, 100).map(l => ({ id: l.id, who: l.who, paid: l.paid, amount: l.amount, at: l.at, state: lineState(l, now) })),
  payouts: (a.payouts || []).slice(0, 50),
  terms: AFF,
});
