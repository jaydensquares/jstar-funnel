// Estimated cost of serving each account, for the owner dashboard. Unit costs are what one use costs us from the
// vendors at their published prices (Nov 2026). Override any of them in Vercel with COST_<KIND>, e.g. COST_RUNS=0.07.
//   runs      deal analysis: RentCast value (+ rent when needed) and a Realie mortgage lookup   ~$0.085
//   photos    photo repair report: Claude reading up to 12 photos                                ~$0.06
//   renders   AI after-repair render: OpenAI image edit, medium quality                          ~$0.06
//   listCalls owner list page of up to 500 records: one RentCast call                            ~$0.04
//   skips     skip trace hit: 5 Tracerfy credits at $0.02 (misses are free and refunded)         ~$0.10
//   agent     JStar AI message: Claude Sonnet 5.5, 2–3 model calls on average                     ~$0.02
import { AFF } from './affiliate.js';

const DEF = { runs: 0.085, photos: 0.06, renders: 0.06, listCalls: 0.04, skips: 0.10, agent: 0.02 };
export const KINDS = Object.keys(DEF);
export const unitCosts = () => Object.fromEntries(KINDS.map(k => [k, Number(process.env['COST_' + k.toUpperCase()]) || DEF[k]]));

const r2 = n => Math.round(n * 100) / 100;
export const stripeFee = amount => amount > 0 ? r2(amount * 0.029 + 0.30) : 0;

// usage: this month's counts. mrr: what they pay per month. u: the user (for affiliate commission).
export function accountCost(usage = {}, mrr = 0, u = {}, units = unitCosts()) {
  const parts = Object.fromEntries(KINDS.map(k => [k, r2((usage[k] || 0) * units[k])]));
  const data = r2(Object.values(parts).reduce((s, v) => s + v, 0));
  const stripe = stripeFee(mrr);
  const affActive = !!u.affiliateId && mrr > 0 && Date.now() - (u.affAt || 0) < AFF.months * 30.44 * 864e5;
  const affiliate = affActive ? r2(mrr * AFF.rate) : 0;
  const cost = r2(data + stripe + affiliate);
  const profit = r2(mrr - cost);
  return { parts, data, stripe, affiliate, cost, profit, margin: mrr > 0 ? Math.round(profit / mrr * 100) : null };
}

// What the vendor meters say we actually called this month, across every account, the funnel and operators.
export function vendorSpend(meter = {}) {
  const tok = (meter.anthropicIn || 0) * 2 / 1e6 + (meter.anthropicOut || 0) * 10 / 1e6; // photo reports, Sonnet 5.5 rates
  const agentCalls = meter.agent || 0, assistCalls = meter.assist || 0;
  const lines = [
    ['RentCast', (meter.rentcast || 0) * 0.04, `${(meter.rentcast || 0).toLocaleString()} calls × ~$0.04`],
    ['Realie', (meter.realie || 0) * 0.025, `${(meter.realie || 0).toLocaleString()} lookups × ~$0.025`],
    ['Tracerfy', (meter.tracerfyCredits || 0) * 0.02, `${(meter.tracerfyCredits || 0).toLocaleString()} credits × $0.02`],
    ['Anthropic', tok + agentCalls * 0.008 + assistCalls * 0.005, `photo reports + ${agentCalls.toLocaleString()} JStar AI calls + ${assistCalls.toLocaleString()} offer/reply drafts`],
    ['OpenAI', (meter.openai_image || 0) * 0.06, `${(meter.openai_image || 0).toLocaleString()} after-repair renders × ~$0.06`],
  ].map(([name, amt, sub]) => ({ name, amount: r2(amt), sub }));
  return { lines, total: r2(lines.reduce((s, l) => s + l.amount, 0)) };
}
