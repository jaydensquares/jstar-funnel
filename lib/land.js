// Vacant lot / land analysis: comps by $ per lot sq ft, no repairs.
import { percentile } from './offer.js';
import { getValueAndComps, lookupLinks } from './rentcast.js';

export const ACRE = 43560;
const round = (n, to = 500) => Math.round(n / to) * to;
const clamp01 = x => Math.max(0, Math.min(1, x));
const daysSince = d => (d ? (Date.now() - new Date(d).getTime()) / 864e5 : null);
const isSold = c => /inactive|sold/i.test(c.status || '');
const $fmt = n => '$' + Math.round(n).toLocaleString();
export const LAND_ISSUE_LABEL = { no_utilities: 'No utilities at lot', no_access: 'No road access', flood: 'Flood zone', hoa_restrict: 'HOA / deed restrictions' };

function landSimilarity(lot, c, L) {
  const age = daysSince(c.removedDate || c.listedDate) ?? L.daysOld / 2;
  let s = 1;
  s -= 0.40 * clamp01((c.distance ?? L.radiusMiles / 2) / L.radiusMiles);
  if (lot) s -= 0.35 * clamp01(Math.abs(Math.log(c.lotSize / lot)) / Math.log(L.lotTolerance));
  s -= 0.25 * clamp01(age / L.daysOld);
  if (typeof c.correlation === 'number') s = 0.6 * s + 0.4 * c.correlation;
  return Math.max(0, s);
}

export async function analyzeLand(lead, cfg) {
  const L = cfg.land;
  const notes = [];
  let data = null;
  try {
    data = await getValueAndComps(
      { address: lead.address, propertyType: 'Land' },
      { ...cfg, comps: { ...cfg.comps, maxRadiusMiles: L.radiusMiles, daysOld: L.daysOld } },
    );
  } catch (e) { notes.push(`Comp pull failed: ${e.message}`); console.error(e); }

  const sp = data?.subjectProperty || {};
  if (!lead.lotSqft && sp.lotSize) { lead.lotSqft = sp.lotSize; notes.push('Lot size filled from public record'); }
  else if (lead.lotSqft && sp.lotSize && Math.abs(lead.lotSqft - sp.lotSize) / sp.lotSize > 0.15) {
    notes.push(`You entered ${(lead.lotSqft / ACRE).toFixed(2)} ac, public record says ${(sp.lotSize / ACRE).toFixed(2)} ac. Check the survey/CAD.`);
  }
  const lot = lead.lotSqft || null;

  const matched = (data?.comparables || [])
    .filter(c => c.price && c.lotSize > 0)
    .filter(c => !c.propertyType || c.propertyType === 'Land')
    .filter(c => !lot || (c.lotSize / lot <= L.lotTolerance && lot / c.lotSize <= L.lotTolerance))
    .filter(c => c.distance == null || c.distance <= L.radiusMiles)
    .map(c => ({ ...c, ppsfLot: c.price / c.lotSize, sold: isSold(c), match: Math.round(landSimilarity(lot, c, L) * 100) }))
    .sort((a, b) => b.match - a.match);
  const soldTop = matched.filter(c => c.sold).slice(0, cfg.comps.useTop);
  const used = soldTop.length >= cfg.comps.minComps ? soldTop : matched.slice(0, cfg.comps.useTop);
  if (used.length && soldTop.length < cfg.comps.minComps && used.some(c => !c.sold)) notes.push('Value leans on active land listings (asking prices), not closed sales. Land sits a long time, so asking is often high.');

  let value = null, method = 'none', ppsfLot = null;
  if (used.length >= cfg.comps.minComps && lot) {
    ppsfLot = percentile(used.map(c => c.ppsfLot), 0.5);
    value = ppsfLot * lot;
    method = `median $/lot sqft of top ${used.length} land comps`;
  } else if (data?.price) {
    value = data.price;
    method = 'RentCast land AVM (thin comps)';
    notes.push('Not enough land comps nearby. Verify value with the county CAD, Zillow/Redfin sold lots, or a local builder.');
  }
  if (!lot) notes.push('No lot size, so value couldn\'t be computed from comps. Enter acres.');

  // Discounts for lot problems
  const adj = [];
  let mult = 1;
  for (const k of lead.landIssues || []) {
    const d = L.issueDiscounts[k];
    if (d) { mult *= 1 - d; adj.push({ item: LAND_ISSUE_LABEL[k] || k, pct: d }); }
  }
  const rawValue = value;
  if (value) value = value * mult;

  let deal = null;
  if (value) {
    const buyerPrice = round(value * L.buyerPercent, 500);
    const mao = Math.max(0, round(buyerPrice - L.assignmentFee, 500));
    const opening = round(mao * (1 - cfg.negotiationBuffer), 500);
    const asking = Number(String(lead.asking || '').replace(/[^\d]/g, '')) || 0;
    let call;
    if (mao <= 0) call = { verdict: 'pass', text: `Lot is worth too little to wholesale with a ${$fmt(L.assignmentFee)} fee.` };
    else if (!asking) call = { verdict: 'offer', text: `Open at ${$fmt(opening)}, walk away above ${$fmt(mao)}. Sell to a builder or land investor at ${$fmt(buyerPrice)}.` };
    else if (asking <= opening) call = { verdict: 'offer', text: `Asking ${$fmt(asking)} is at or under your opening number. Lock it up.` };
    else if (asking <= mao) call = { verdict: 'offer', text: `Asking ${$fmt(asking)} is under your max ${$fmt(mao)}. Room to take it, try to land closer to ${$fmt(opening)}.` };
    else if (asking <= mao * 1.15) call = { verdict: 'negotiate', text: `Asking ${$fmt(asking)} is ${Math.round((asking / mao - 1) * 100)}% over your max. Workable if they come down.` };
    else call = { verdict: 'pass', text: `Asking ${$fmt(asking)} is ${Math.round((asking / mao - 1) * 100)}% over your max ${$fmt(mao)}. Pass unless they move a lot.` };
    deal = { value: round(value, 1000), rawValue: round(rawValue, 1000), buyerPrice, mao, opening, fee: L.assignmentFee, buyerPercent: L.buyerPercent, adj, call };
  }

  // Score (reuse house rules where they apply)
  let score = 0; const reasons = [];
  const add = (n, why) => { score += n; reasons.push(why); };
  ({ asap: () => add(3, 'Wants to sell ASAP'), '30': () => add(2, 'Selling within 30 days'), '90': () => add(1, '60–90 day timeline') })[lead.timeline]?.();
  if (['inherited', 'behind', 'divorce', 'relocating'].includes(lead.reason)) add(2, `Motivation: ${lead.reason}`);
  if (lead.owed === 'free_clear') add(1, 'Free & clear');
  const asking = Number(String(lead.asking || '').replace(/[^\d]/g, '')) || 0;
  if (deal && asking) {
    if (asking <= deal.mao) add(3, 'Asking ≤ MAO');
    else if (asking <= deal.mao * 1.15) add(1, 'Asking within 15% of MAO');
    else reasons.push(`Asking $${asking.toLocaleString()} is ${Math.round((asking / deal.mao - 1) * 100)}% over MAO`);
  }
  const label = score >= cfg.scoring.hot ? 'HOT' : score >= cfg.scoring.warm ? 'WARM' : 'COLD';

  return {
    land: true,
    lead,
    valuation: {
      value: deal?.value ?? (value ? round(value, 1000) : null), method, ppsfLot: ppsfLot ? +ppsfLot.toFixed(2) : null,
      perAcre: ppsfLot ? round(ppsfLot * ACRE, 500) : null,
      range: used.length >= 3 && lot ? { low: round(percentile(used.map(c => c.ppsfLot), 0.25) * lot * mult, 1000), high: round(percentile(used.map(c => c.ppsfLot), 0.75) * lot * mult, 1000) } : null,
      avm: data?.price ?? null, avmLow: data?.priceRangeLow ?? null, avmHigh: data?.priceRangeHigh ?? null,
      confidence: used.length >= 6 ? 'medium' : used.length >= 3 ? 'low-medium' : 'low',
      compsMatched: matched.length, notes,
    },
    deal,
    comps: used.map(c => ({
      formattedAddress: c.formattedAddress, price: c.price, lotSize: c.lotSize, acres: +(c.lotSize / ACRE).toFixed(2),
      ppsfLot: +c.ppsfLot.toFixed(2), perAcre: round(c.ppsfLot * ACRE, 500), distance: c.distance, status: c.status, sold: c.sold, match: c.match,
      listedDate: c.listedDate, removedDate: c.removedDate, daysOnMarket: c.daysOnMarket,
    })),
    score: { score, label, reasons },
    links: lookupLinks(lead.address),
  };
}
