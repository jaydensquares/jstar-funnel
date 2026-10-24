import CONFIG from '../config.js';
import { computeARV, buildOffers, scoreLead, repairBreakdown } from './offer.js';
import { getValueAndComps, getRent, rentcastType, lookupLinks } from './rentcast.js';
import { analyzeDeal } from './strategies.js';

const $fmt = n => '$' + Math.round(n).toLocaleString();

// lead → full deal analysis (comps, ARV, repairs, 3 exit strategies, score)
export async function analyzeLead(lead) {
  const cfg = { ...CONFIG, ...(CONFIG.stateOverrides?.[lead.state] || {}) };
  const subject = {
    address: lead.address,
    propertyType: rentcastType(lead.propertyType),
    bedrooms: lead.bedrooms, bathrooms: lead.bathrooms, squareFootage: lead.sqft,
  };

  // Value + comps and rent in parallel
  // Wholesale-only mode skips the rent call (saves a RentCast request) unless rent matters for a rented house
  const needRent = cfg.mode !== 'wholesale' || lead.occupancy === 'tenant';
  const [valueRes, rentRes] = await Promise.allSettled([getValueAndComps(subject, cfg), needRent ? getRent(subject) : Promise.resolve(null)]);
  const avmData = valueRes.status === 'fulfilled' ? valueRes.value : null;
  const rentData = rentRes.status === 'fulfilled' ? rentRes.value : null;
  const notes = [];
  if (valueRes.status === 'rejected') { notes.push(`Comp pull failed: ${valueRes.reason?.message}`); console.error(valueRes.reason); }
  if (rentRes.status === 'rejected') { notes.push(`Rent pull failed: ${rentRes.reason?.message}`); console.error(rentRes.reason); }

  // Fill gaps from public record if the seller skipped them
  const sp = avmData?.subjectProperty || {};
  const filled = [];
  for (const [k, src] of [['sqft', 'squareFootage'], ['yearBuilt', 'yearBuilt'], ['bedrooms', 'bedrooms'], ['bathrooms', 'bathrooms']]) {
    if (!lead[k] && sp[src]) { lead[k] = sp[src]; filled.push(k); }
  }
  if (filled.length) notes.push(`Filled from public record: ${filled.join(', ')}`);
  if (lead.sqft && sp.squareFootage && Math.abs(lead.sqft - sp.squareFootage) / sp.squareFootage > 0.15) {
    notes.push(`Seller said ${lead.sqft} sqft, public record says ${sp.squareFootage}. Confirm on the call.`);
  }

  const arvResult = computeARV(
    { squareFootage: lead.sqft, bedrooms: lead.bedrooms, bathrooms: lead.bathrooms, yearBuilt: lead.yearBuilt, propertyType: subject.propertyType },
    avmData?.comparables || [], avmData, cfg,
  );
  arvResult.notes.unshift(...notes);
  if (!lead.sqft) arvResult.notes.push('No sqft, so offers weren\'t computed. Get sqft on the call.');

  const repairs = lead.sqft ? repairBreakdown(lead.condition, lead.sqft, lead.yearBuilt, lead.issues, cfg, lead.customRepairs) : null;
  const asIs = avmData?.price ?? (arvResult.arv && repairs ? arvResult.arv - repairs.total : null);
  const marketRent = rentData?.rent ?? null;

  // Tenant-occupied: use the real rent and figure out when we get the house back
  let tenant = null, rent = marketRent;
  if (lead.occupancy === 'tenant') {
    const t = cfg.tenant;
    const paying = lead.tenantPaying !== 'behind';
    const actual = lead.currentRent || null;
    const rentUsed = paying && actual ? actual : marketRent;
    let waitMonths = t.waitMonths[lead.leaseEnd] ?? t.waitMonths['3to6'];
    let extraCost = 0, flipNote;
    if (!paying) {
      waitMonths = t.eviction.months; extraCost = t.eviction.cost;
      flipNote = `Tenant isn't paying, so this budgets ${$fmt(t.eviction.cost)} and ${t.eviction.months} months for an eviction (or less with cash-for-keys) before rehab can start.`;
    } else if (waitMonths > t.maxWaitForFlip) {
      const lease = waitMonths;
      waitMonths = 1; extraCost = t.cashForKeys;
      flipNote = `Lease runs about ${lease} more months, too long to wait on a flip. This assumes ${$fmt(t.cashForKeys)} cash-for-keys and a month to get the house back.`;
    } else {
      flipNote = `Adds ${waitMonths} month${waitMonths > 1 ? 's' : ''} for the lease to end before rehab starts.`;
    }
    const rentIncome = paying && actual ? Math.round(actual * waitMonths * (1 - cfg.sellerFinance.mgmtPct)) : 0;
    if (rentIncome) flipNote += ` Rent collected meanwhile (about ${$fmt(rentIncome)}) offsets the carrying cost.`;
    tenant = { rent: rentUsed, marketRent, rentSource: paying && actual ? 'actual' : 'estimate', waitMonths, extraCost, rentIncome, flipNote };
    rent = rentUsed;

    const n = arvResult.notes;
    if (!actual) n.push('Tenant-occupied but no rent given. Using the market rent estimate. Ask for the lease.');
    if (!paying) n.push('Tenant is behind or not paying. The seller is likely motivated, but budget for an eviction.');
    if (actual && marketRent && actual < marketRent * t.belowMarketFlag) n.push(`Rent is ${$fmt(actual)} vs about ${$fmt(marketRent)} market. That's upside for a landlord buyer.`);
    if (actual && marketRent && actual > marketRent * 1.15) n.push(`Stated rent (${$fmt(actual)}) is well above the market estimate (${$fmt(marketRent)}). Verify with a lease and bank deposits.`);
    n.push('Occupied: condition is unverified. Schedule a walkthrough with proper notice to the tenant. Get the lease, rent roll and deposit amount; the deposit transfers to the buyer at closing.');
  }

  const analysis = repairs && arvResult.arv ? analyzeDeal({
    address: lead.address, arv: arvResult.arv, asIs, rent, repairs: repairs.total,
    tier: lead.condition, confidence: arvResult.confidence, lead, tenant,
  }, cfg) : null;

  const offers = buildOffers({ arv: arvResult.arv, sqft: lead.sqft, yearBuilt: lead.yearBuilt, sellerTier: lead.condition, flags: lead.issues }, cfg);
  const score = scoreLead(lead, offers, cfg);

  return {
    lead,
    valuation: {
      arv: arvResult.arv, arvPpsf: arvResult.ppsf, arvRange: arvResult.range, method: arvResult.method,
      confidence: arvResult.confidence, notes: arvResult.notes, compsMatched: arvResult.compsMatched,
      asIs, avm: avmData?.price ?? null, avmLow: avmData?.priceRangeLow ?? null, avmHigh: avmData?.priceRangeHigh ?? null,
      rent, marketRent, rentSource: tenant?.rentSource || 'estimate', rentLow: rentData?.rentRangeLow ?? null, rentHigh: rentData?.rentRangeHigh ?? null,
    },
    repairs,
    tenant,
    analysis,
    offers,
    comps: arvResult.compsUsed.map(c => ({
      formattedAddress: c.formattedAddress, price: c.price, squareFootage: c.squareFootage,
      ppsf: Math.round(c.ppsf), bedrooms: c.bedrooms, bathrooms: c.bathrooms, yearBuilt: c.yearBuilt,
      distance: c.distance, status: c.status, sold: c.sold, match: c.match,
      listedDate: c.listedDate, removedDate: c.removedDate, daysOnMarket: c.daysOnMarket,
    })),
    score,
    links: lookupLinks(lead.address),
    config: { state: lead.state, arvPercent: cfg.arvPercent, assignmentFee: cfg.assignmentFee, repairMultiplier: cfg.repairMultiplier ?? 1 },
  };
}
