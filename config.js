// ─────────────────────────────────────────────────────────────
// Offer engine settings. Tune these to your market + contractor bids.
// ─────────────────────────────────────────────────────────────
export default {
  // 'wholesale' = deal sheet shows only the assignment deal (and skips the rent lookup unless it's rented)
  // 'all'       = wholesale + fix & flip + seller finance
  mode: 'wholesale',

  // MAO = ARV × arvPercent − repairs − assignmentFee
  arvPercent: 0.70,
  assignmentFee: 10000,

  // Opening offer = MAO × (1 − negotiationBuffer). Gives you room to come up.
  negotiationBuffer: 0.05,

  // ARV = this percentile of comp $/sqft × subject sqft.
  // Upper-percentile comps approximate renovated condition.
  arvPercentile: 0.75,
  // Never let comp-based ARV exceed the AVM high range by more than this.
  arvCapOverAvmHigh: 1.10,

  // Rehab $/sqft by condition tier (calibrate with your contractors / buyers list)
  minRepair: 3000,
  repairPerSqft: {
    turnkey: 3,
    cosmetic: 15,
    moderate: 32,
    heavy: 55,
    gut: 85,
  },

  // Flat adds when the seller checks specific problems (only applied to
  // turnkey/cosmetic/moderate tiers — heavy/gut already assume these).
  repairItems: {
    roof: 14000,
    foundation: 15000,
    hvac: 9000,
    plumbing: 7000,
    electrical: 6000,
    water_damage: 8000,
    windows: 8000,
  },

  // Added on top of custom repair line items (from a walkthrough or seller's list)
  contingencyPct: 0.10,

  // Older houses cost more to fix
  ageMultipliers: [
    { maxAge: 15, mult: 1.0 },
    { maxAge: 40, mult: 1.1 },
    { maxAge: 999, mult: 1.2 },
  ],

  // Comp pull + filtering
  comps: {
    count: 25,             // comps requested from RentCast (5–25)
    maxRadiusMiles: 1.5,   // search radius
    daysOld: 270,          // how far back to look
    sqftTolerance: 0.25,   // keep comps within ±25% of subject sqft
    maxDistanceMiles: 1.5,
    minComps: 3,           // fewer than this → fall back to AVM, flag low confidence
    useTop: 8,             // best-matching comps used for ARV (ranked by similarity)
  },

  // Carrying costs (override per state — property tax varies a lot)
  propertyTaxRate: 0.019,  // annual, % of value (TX ≈ 1.6–2.2%)
  insuranceRate: 0.007,    // annual, % of value
  appreciation: 0.03,      // annual, used for seller-finance equity at balloon

  // ── Tenant-occupied properties ──
  tenant: {
    // Months until we can get the house back, by what the seller said about the lease
    waitMonths: { mtm: 1, lt3: 2, '3to6': 5, '6to12': 9, gt12: 14 },
    maxWaitForFlip: 3,       // longer than this → assume we pay cash-for-keys instead of waiting
    cashForKeys: 3000,
    eviction: { cost: 3500, months: 2 }, // non-paying tenant
    landlordCapRate: 0.08,   // return buy-and-hold buyers want on a rented house
    belowMarketFlag: 0.90,   // rent under 90% of market = upside worth mentioning
  },

  // ── Strategy: fix & flip (us, or the investor we assign to) ──
  flip: {
    buyClosingPct: 0.02,
    sellAgentPct: 0.055,   // listing + buyer agent
    sellClosingPct: 0.015, // title, concessions
    utilitiesMonthly: 250,
    monthsByTier: { turnkey: 2, cosmetic: 3, moderate: 4, heavy: 6, gut: 8 }, // rehab + sale
    hardMoney: { rate: 0.12, points: 0.02, ltc: 0.90 }, // lender funds 90% of purchase + rehab
    minProfit: 30000,      // floor
    minProfitPctArv: 0.12, // or 12% of ARV, whichever is higher
  },

  // ── Strategy: seller finance (seller carries the note, we rent or wrap) ──
  sellerFinance: {
    downPct: 0.05,         // down payment we give the seller
    rate: 0.04,            // interest on the seller's note
    amortYears: 30,
    balloonYears: 7,
    closingPct: 0.01,
    vacancyPct: 0.08, maintenancePct: 0.08, mgmtPct: 0.08, capexPct: 0.05, // % of rent
    minCashflow: 250,      // monthly, after all expenses
    maxPriceOfAsIs: 1.05,  // never pay more than 105% of as-is value
    // Wrap exit: resell on owner-finance terms to an end buyer
    wrapPriceOfArv: 1.0, wrapDownPct: 0.10, wrapRate: 0.095,
  },

  // Buy box: above this ARV, cash buyers are scarce and 70%-rule offers won't land
  maxArv: 1000000,

  // Lead score labels
  scoring: { hot: 8, warm: 5 },

  // ── Nationwide tuning ──
  // Override any setting above per state. repairMultiplier scales all rehab
  // costs (1.0 = the DFW-calibrated numbers above). Examples, not data —
  // set these from contractor bids and buyer feedback in each market.
  stateOverrides: {
    // CA: { repairMultiplier: 1.45, arvPercent: 0.75, assignmentFee: 20000 },
    // NY: { repairMultiplier: 1.5 },
    // OH: { repairMultiplier: 0.9, arvPercent: 0.65, assignmentFee: 7500 },
  },
};
