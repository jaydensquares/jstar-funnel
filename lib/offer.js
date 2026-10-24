import CONFIG from '../config.js';

export const TIERS = [
  { key: 'turnkey', label: 'Move-in ready' },
  { key: 'cosmetic', label: 'Cosmetic (paint, flooring)' },
  { key: 'moderate', label: 'Updates (kitchen, baths)' },
  { key: 'heavy', label: 'Major repairs (roof, HVAC, foundation)' },
  { key: 'gut', label: 'Full gut / teardown' },
];
const TIER_LABEL = Object.fromEntries(TIERS.map(t => [t.key, t.label]));
const ITEM_LABEL = { roof: 'Roof', foundation: 'Foundation', hvac: 'HVAC', plumbing: 'Plumbing', electrical: 'Electrical', water_damage: 'Water damage', windows: 'Windows' };

const round = (n, to = 500) => Math.round(n / to) * to;

export function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

const clamp01 = x => Math.max(0, Math.min(1, x));
const daysSince = d => (d ? (Date.now() - new Date(d).getTime()) / 864e5 : null);
const isSold = c => /inactive|sold/i.test(c.status || '');

// 0–1 similarity to the subject house. Higher = better comp.
export function similarity(subject, c, cfg = CONFIG) {
  const k = cfg.comps;
  const age = c.daysOld ?? daysSince(c.removedDate || c.listedDate) ?? k.daysOld / 2;
  let s = 1;
  s -= 0.30 * clamp01((c.distance ?? k.maxDistanceMiles / 2) / k.maxDistanceMiles);
  if (subject.squareFootage) s -= 0.25 * clamp01(Math.abs(c.squareFootage - subject.squareFootage) / subject.squareFootage / k.sqftTolerance);
  if (subject.bedrooms != null && c.bedrooms != null) s -= 0.10 * clamp01(Math.abs(c.bedrooms - subject.bedrooms) / 2);
  if (subject.bathrooms != null && c.bathrooms != null) s -= 0.10 * clamp01(Math.abs(c.bathrooms - subject.bathrooms) / 2);
  if (subject.yearBuilt && c.yearBuilt) s -= 0.10 * clamp01(Math.abs(c.yearBuilt - subject.yearBuilt) / 30);
  s -= 0.15 * clamp01(age / k.daysOld);
  if (typeof c.correlation === 'number') s = 0.6 * s + 0.4 * c.correlation; // blend RentCast's own match score
  return Math.max(0, s);
}

export function selectComps(subject, comps, cfg = CONFIG) {
  const sqft = subject.squareFootage;
  return (comps || [])
    .filter(c => {
      if (!c.price || !c.squareFootage) return false;
      if (sqft && Math.abs(c.squareFootage - sqft) / sqft > cfg.comps.sqftTolerance) return false;
      if (c.distance != null && c.distance > cfg.comps.maxDistanceMiles) return false;
      if (subject.propertyType && c.propertyType && c.propertyType !== subject.propertyType) return false;
      return true;
    })
    .map(c => ({ ...c, ppsf: c.price / c.squareFootage, sold: isSold(c), match: Math.round(similarity(subject, c, cfg) * 100) }))
    .sort((a, b) => b.match - a.match);
}

export function computeARV(subject, comps, avm, cfg = CONFIG) {
  const matched = selectComps(subject, comps, cfg);
  // Prefer off-market (sold/removed) comps over active asking prices when there are enough
  const soldTop = matched.filter(c => c.sold).slice(0, cfg.comps.useTop);
  const used = soldTop.length >= cfg.comps.minComps ? soldTop : matched.slice(0, cfg.comps.useTop);
  const ppsfs = used.map(c => c.ppsf);
  const notes = [];
  let arv = null, ppsf = null, method = 'none';
  if (used.length && soldTop.length < cfg.comps.minComps && used.some(c => !c.sold)) notes.push('ARV leans on active listings (asking prices), not closed sales');

  if (used.length >= cfg.comps.minComps && subject.squareFootage) {
    ppsf = percentile(ppsfs, cfg.arvPercentile);
    arv = ppsf * subject.squareFootage;
    method = `${Math.round(cfg.arvPercentile * 100)}th pct $/sqft of top ${used.length} comps`;
  } else if (avm?.priceRangeHigh) {
    arv = avm.priceRangeHigh;
    method = 'AVM high range (thin comps)';
    notes.push('Not enough matching comps — verify ARV manually');
  } else if (avm?.price) {
    arv = avm.price * 1.1;
    method = 'AVM +10% (thin comps)';
    notes.push('No comp range — verify ARV manually');
  }

  if (arv && avm?.priceRangeHigh && arv > avm.priceRangeHigh * cfg.arvCapOverAvmHigh) {
    arv = avm.priceRangeHigh * cfg.arvCapOverAvmHigh;
    notes.push('ARV capped against AVM high range');
  }

  let confidence = 'low';
  if (used.length >= 6) {
    const spread = (percentile(ppsfs, 0.9) - percentile(ppsfs, 0.1)) / percentile(ppsfs, 0.5);
    confidence = spread < 0.35 ? 'high' : 'medium';
  } else if (used.length >= cfg.comps.minComps) {
    confidence = 'medium';
  }

  const sqftS = subject.squareFootage;
  return {
    arv: arv ? round(arv, 1000) : null,
    ppsf: ppsf ? Math.round(ppsf) : null,
    range: ppsfs.length && sqftS ? {
      low: round(percentile(ppsfs, 0.25) * sqftS, 1000),
      mid: round(percentile(ppsfs, 0.5) * sqftS, 1000),
      high: round(percentile(ppsfs, 0.9) * sqftS, 1000),
    } : null,
    method,
    confidence,
    compsUsed: used,
    compsMatched: matched.length,
    notes,
  };
}

// Itemized repair estimate with the reasoning behind each line
export function repairBreakdown(tier, sqft, yearBuilt, flags = [], cfg = CONFIG, custom = null) {
  // Known scope (from a walkthrough or the seller): use those line items instead of the $/sqft estimate
  if (custom?.length) {
    const lines = custom.map(c => ({ item: c.item, cost: Math.round(c.cost), why: c.why || 'Your estimate' }));
    const subtotal = lines.reduce((s, l) => s + l.cost, 0);
    const pct = cfg.contingencyPct ?? 0.10;
    if (pct) lines.push({ item: 'Contingency', cost: round(subtotal * pct, 500), why: `${Math.round(pct * 100)}% for surprises once work starts` });
    return { total: round(lines.reduce((s, l) => s + l.cost, 0), 500), lines, custom: true };
  }
  const region = cfg.repairMultiplier ?? 1;
  const ageMult = ageMultiplier(yearBuilt, cfg);
  const rate = cfg.repairPerSqft[tier] || 0;
  const lines = [];
  const base = Math.max(cfg.minRepair, rate * sqft * ageMult * region);
  lines.push({
    item: `${TIER_LABEL[tier] || tier} scope`,
    cost: round(base, 500),
    why: `$${rate}/sqft × ${sqft?.toLocaleString()} sqft${ageMult !== 1 ? ` × ${ageMult} (built ${yearBuilt})` : ''}${region !== 1 ? ` × ${region} regional` : ''}`,
  });
  if (!['heavy', 'gut'].includes(tier)) {
    for (const f of flags) {
      if (cfg.repairItems[f]) lines.push({ item: ITEM_LABEL[f] || f, cost: round(cfg.repairItems[f] * region, 500), why: 'Seller flagged this issue' });
    }
  } else if (flags.length) {
    lines.push({ item: flags.map(f => ITEM_LABEL[f] || f).join(', '), cost: 0, why: 'Already included in this repair tier' });
  }
  return { total: round(lines.reduce((s, l) => s + l.cost, 0), 500), lines };
}

export function ageMultiplier(yearBuilt, cfg = CONFIG) {
  if (!yearBuilt) return 1;
  const age = new Date().getFullYear() - yearBuilt;
  for (const b of cfg.ageMultipliers) if (age <= b.maxAge) return b.mult;
  return 1;
}

export function repairEstimate(tier, sqft, yearBuilt, flags = [], cfg = CONFIG) {
  const region = cfg.repairMultiplier ?? 1;
  const base = Math.max(cfg.minRepair, (cfg.repairPerSqft[tier] || 0) * sqft * ageMultiplier(yearBuilt, cfg) * region);
  const flagCost = ['heavy', 'gut'].includes(tier)
    ? 0
    : flags.reduce((s, f) => s + (cfg.repairItems[f] || 0), 0) * region;
  return round(base + flagCost, 500);
}

export function buildOffers({ arv, sqft, yearBuilt, sellerTier, flags = [] }, cfg = CONFIG) {
  if (!arv || !sqft) return [];
  const row = (tier, label, fl, sellerReported) => {
    const repairs = repairEstimate(tier, sqft, yearBuilt, fl, cfg);
    const mao = Math.max(0, round(arv * cfg.arvPercent - repairs - cfg.assignmentFee, 500));
    const opening = round(mao * (1 - cfg.negotiationBuffer), 500);
    return { tier, label, repairs, mao, opening, sellerReported };
  };
  const rows = TIERS.map(t => row(t.key, t.label, [], false));
  if (sellerTier && TIER_LABEL[sellerTier]) {
    const extra = flags.length && !['heavy', 'gut'].includes(sellerTier) ? ` + ${flags.join(', ')}` : '';
    rows.unshift(row(sellerTier, `SELLER SAYS: ${TIER_LABEL[sellerTier]}${extra}`, flags, true));
  }
  return rows;
}

export function scoreLead(lead, offers, cfg = CONFIG) {
  let score = 0;
  const reasons = [];
  const add = (n, why) => { score += n; reasons.push(why); };

  ({ asap: () => add(3, 'Wants to sell ASAP'), '30': () => add(2, 'Selling within 30 days'), '90': () => add(1, '60–90 day timeline') })[lead.timeline]?.();
  if (['inherited', 'behind', 'divorce', 'repairs', 'landlord'].includes(lead.reason)) add(2, `Motivation: ${lead.reason}`);
  if (lead.occupancy === 'vacant') add(1, 'Vacant');
  if (lead.occupancy === 'tenant' && lead.tenantPaying === 'behind') add(2, 'Non-paying tenant');
  else if (lead.occupancy === 'tenant' && lead.tenantPaying === 'late') add(1, 'Tenant pays late');
  if (['heavy', 'gut'].includes(lead.condition)) add(2, 'Distressed condition');
  else if (lead.condition === 'moderate') add(1, 'Needs updates');
  if (lead.owed === 'free_clear') add(1, 'Free & clear');

  const seller = offers.find(o => o.sellerReported);
  const asking = Number(String(lead.asking || '').replace(/[^\d]/g, '')) || 0;
  if (seller && asking) {
    if (asking <= seller.mao) add(3, 'Asking ≤ MAO');
    else if (asking <= seller.mao * 1.15) add(1, 'Asking within 15% of MAO');
    else reasons.push(`Asking $${asking.toLocaleString()} is ${Math.round((asking / seller.mao - 1) * 100)}% over MAO`);
  }

  const label = score >= cfg.scoring.hot ? 'HOT' : score >= cfg.scoring.warm ? 'WARM' : 'COLD';
  return { score, label, reasons };
}
