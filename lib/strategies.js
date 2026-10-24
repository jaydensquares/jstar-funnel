import CONFIG from '../config.js';

const r500 = n => Math.round(n / 500) * 500;
const r10 = n => Math.round(n / 10) * 10;
const $ = n => (n == null || !isFinite(n) ? '—' : (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString());
const pct = n => (n == null || !isFinite(n) ? '—' : (n * 100).toFixed(1).replace(/\.0$/, '') + '%');

// Mortgage helpers (monthly)
export function pmt(annualRate, years, principal) {
  const r = annualRate / 12, n = years * 12;
  if (principal <= 0) return 0;
  return r === 0 ? principal / n : (principal * r) / (1 - (1 + r) ** -n);
}
export function pv(annualRate, years, payment) {
  const r = annualRate / 12, n = years * 12;
  if (payment <= 0) return 0;
  return r === 0 ? payment * n : (payment * (1 - (1 + r) ** -n)) / r;
}
export function balanceAfter(annualRate, years, principal, monthsPaid) {
  const r = annualRate / 12, p = pmt(annualRate, years, principal);
  if (r === 0) return Math.max(0, principal - p * monthsPaid);
  return Math.max(0, principal * (1 + r) ** monthsPaid - (p * ((1 + r) ** monthsPaid - 1)) / r);
}

// ─────────────────────────────────────────────────────────────
// Flip math — shared by "investor buys from us" and "we flip it"
// ─────────────────────────────────────────────────────────────
// Tenant adjustments: extra months before rehab can start, buyout/eviction cost, rent collected while waiting
const tenantAdj = t => ({ wait: t?.waitMonths || 0, extra: t?.extraCost || 0, income: t?.rentIncome || 0 });

export function flipAt(purchase, { arv, repairs, tier, tenant }, cfg = CONFIG) {
  const f = cfg.flip, hm = f.hardMoney;
  const ta = tenantAdj(tenant);
  const months = (f.monthsByTier[tier] ?? 4) + ta.wait;
  const buyClose = purchase * f.buyClosingPct;
  const loan = hm.ltc * (purchase + repairs);
  const points = loan * hm.points;
  const interest = loan * hm.rate * (months / 12);          // assumes full draw — conservative
  const holding = months * ((arv * (cfg.propertyTaxRate + cfg.insuranceRate)) / 12 + f.utilitiesMonthly);
  const sell = arv * (f.sellAgentPct + f.sellClosingPct);
  const totalCost = purchase + repairs + buyClose + points + interest + holding + sell + ta.extra;
  const profit = arv - totalCost + ta.income;
  const cashIn = purchase + repairs - loan + buyClose + points + interest + holding + ta.extra - ta.income;
  return {
    purchase, months, tenantExtra: ta.extra, tenantIncome: ta.income, buyClose, loan, points, interest, holding, sell, totalCost, profit, cashIn,
    roi: cashIn > 0 ? profit / cashIn : null,
    annualRoi: cashIn > 0 ? (profit / cashIn) * (12 / months) : null,
  };
}

// Highest purchase price that still leaves `target` profit (solved, not guessed)
export function maxFlipPurchase({ arv, repairs, tier, tenant }, target, cfg = CONFIG) {
  const f = cfg.flip, hm = f.hardMoney;
  const ta = tenantAdj(tenant);
  const months = (f.monthsByTier[tier] ?? 4) + ta.wait;
  const k = hm.ltc * (hm.points + hm.rate * (months / 12));
  const holding = months * ((arv * (cfg.propertyTaxRate + cfg.insuranceRate)) / 12 + f.utilitiesMonthly);
  const sell = arv * (f.sellAgentPct + f.sellClosingPct);
  return (arv - repairs - holding - sell - k * repairs - ta.extra + ta.income - target) / (1 + f.buyClosingPct + k);
}

const flipTarget = (arv, cfg) => Math.max(cfg.flip.minProfit, cfg.flip.minProfitPctArv * arv);

// What a buy-and-hold landlord pays for a rented house: NOI / cap rate − repairs
export function landlordPrice(d, cfg = CONFIG) {
  if (!d.tenant?.rent) return null;
  const sf = cfg.sellerFinance;
  const opex = sf.vacancyPct + sf.maintenancePct + sf.mgmtPct + sf.capexPct;
  // Taxes/insurance follow what the landlord has in it (price + repairs), so solve for total basis
  const rentNoi = d.tenant.rent * 12 * (1 - opex);
  const basis = rentNoi / (cfg.tenant.landlordCapRate + cfg.propertyTaxRate + cfg.insuranceRate);
  const price = basis - d.repairs;
  return price > 0 ? r500(price) : null;
}

// ─────────────────────────────────────────────────────────────
// 1) WHOLESALE — lock it up, assign to a cash buyer
// ─────────────────────────────────────────────────────────────
export function wholesale(d, cfg = CONFIG) {
  const { arv, repairs } = d;
  const flipperPrice = r500(arv * cfg.arvPercent - repairs);    // what a flipper pays (70% rule)
  const landlord = landlordPrice(d, cfg);                       // what a buy-and-hold buyer pays (rented houses)
  const toLandlord = landlord != null && landlord > flipperPrice;
  const investorPrice = toLandlord ? landlord : flipperPrice;
  const contract = r500(investorPrice - cfg.assignmentFee);       // what we sign with the seller (MAO)
  const opening = r500(contract * (1 - cfg.negotiationBuffer));
  const inv = flipAt(investorPrice, d, cfg);
  const target = flipTarget(arv, cfg);
  const viable = contract > 0 && (toLandlord || inv.profit >= target * 0.8);

  const reasoning = [
    `Flippers pay about ${pct(cfg.arvPercent)} of ARV minus repairs: ${$(arv)} × ${pct(cfg.arvPercent)} − ${$(repairs)} repairs = ${$(flipperPrice)}.`,
    ...(landlord != null ? [toLandlord
      ? `It's rented, so landlord buyers are the better exit. At ${$(d.tenant.rent)}/mo rent and a ${pct(cfg.tenant.landlordCapRate)} cap rate, a buy-and-hold investor can pay ${$(landlord)} after repairs, which beats the flipper price. Pitch it as a cash-flowing rental with the tenant in place.`
      : `A landlord buyer would pay about ${$(landlord)} based on ${$(d.tenant.rent)}/mo rent at a ${pct(cfg.tenant.landlordCapRate)} cap rate, which is below the flipper price, so sell to flippers.`] : []),
    `Subtract your ${$(cfg.assignmentFee)} assignment fee from ${$(investorPrice)} to get the most you can sign at: ${$(contract)}. Open at ${$(opening)} to leave room to negotiate.`,
    ...(toLandlord ? [] : [
      `If the investor buys at ${$(investorPrice)} and flips it with hard money, they net about ${$(inv.profit)} (${pct(inv.roi)} on ${$(inv.cashIn)} cash in, ${inv.months} months).`,
      inv.profit >= target ? `That clears a typical flipper's bar of ${$(target)}, so this should be easy to assign.` : `That's under a typical flipper's ${$(target)} target. Expect pushback; get the seller lower or cut your fee.`,
    ]),
  ];
  return {
    key: 'wholesale', name: 'Wholesale (assign the contract)', viable,
    headline: { label: 'Offer seller', value: contract, opening },
    yourProfit: cfg.assignmentFee,
    yourProfitNote: `assignment fee, ${$(cfg.assignmentFee + (contract - opening))} if they take the opening offer`,
    capitalNeeded: 1000, capitalNote: 'earnest money only',
    timeline: '2–4 weeks',
    pitch: {
      price: investorPrice, arv, repairs, profit: Math.round(inv.profit), roi: inv.roi, months: inv.months,
      buyer: toLandlord ? 'landlord' : 'flipper', rent: d.tenant?.rent, capRate: toLandlord ? cfg.tenant.landlordCapRate : null,
      text: `${d.address} | ARV ${$(arv)} | Rehab est. ${$(repairs)} | Price ${$(investorPrice)} | Projected profit ${$(inv.profit)} (${pct(inv.roi)} cash-on-cash, ~${inv.months} mo)`,
    },
    numbers: [
      ['Offer to seller (MAO)', contract], ['Opening offer', opening], ['Assignment fee', cfg.assignmentFee],
      ['Flipper price', flipperPrice], ...(landlord != null ? [['Landlord buyer price', landlord]] : []),
      ['Price to cash buyer', investorPrice], ['Investor net profit (as a flip)', inv.profit], ['Investor cash needed', inv.cashIn],
    ],
    reasoning,
  };
}

// ─────────────────────────────────────────────────────────────
// 2) FIX & FLIP — we buy it, rehab, sell retail
// ─────────────────────────────────────────────────────────────
export function fixAndFlip(d, ws, cfg = CONFIG) {
  const { arv, repairs } = d;
  const target = flipTarget(arv, cfg);
  const maxBuy = r500(maxFlipPurchase(d, target, cfg));
  const atMax = flipAt(maxBuy, d, cfg);
  const atContract = flipAt(ws.headline.value, d, cfg);   // if we keep the deal instead of assigning
  const viable = atContract.profit >= target && ws.headline.value > 0;
  const multiple = cfg.assignmentFee > 0 ? atContract.profit / cfg.assignmentFee : null;

  const reasoning = [
    `To make at least ${$(target)} (the higher of ${$(cfg.flip.minProfit)} or ${pct(cfg.flip.minProfitPctArv)} of ARV), the most you can pay is ${$(maxBuy)}.`,
    `Costs built in: ${$(repairs)} rehab, ${$(atMax.buyClose)} buy closing, ${$(atMax.points + atMax.interest)} hard money (${pct(cfg.flip.hardMoney.rate)} + ${cfg.flip.hardMoney.points * 100} pts, ${atMax.months} mo), ${$(atMax.holding)} taxes/insurance/utilities, ${$(atMax.sell)} to sell (agents + closing).`,
    `If you buy at the wholesale contract price (${$(ws.headline.value)}) and flip it yourself, you'd net about ${$(atContract.profit)}, ${multiple ? multiple.toFixed(1) + '×' : '—'} the assignment fee, with about ${$(atContract.cashIn)} of your own cash tied up for ${atContract.months} months.`,
    viable
      ? (multiple >= 2.5 ? 'Worth keeping if you have the cash and a contractor you trust.' : 'Profitable, but the extra risk and capital may not be worth it over a quick assignment.')
      : 'Margins are too thin to flip this yourself at the wholesale price.',
  ];
  if (d.tenant) reasoning.splice(2, 0, d.tenant.flipNote);
  if (d.confidence === 'low') reasoning.push('ARV confidence is low. Don\'t flip this without an agent\'s MLS comps.');

  return {
    key: 'flip', name: 'Fix & flip (we keep it)', viable,
    headline: { label: 'Max purchase', value: maxBuy },
    yourProfit: Math.round(atContract.profit),
    yourProfitNote: `if bought at ${$(ws.headline.value)}`,
    capitalNeeded: Math.round(atContract.cashIn), capitalNote: `with hard money at ${pct(cfg.flip.hardMoney.ltc)} LTC`,
    timeline: `${atContract.months} months`,
    multiple,
    numbers: [
      ['Max purchase (hits target)', maxBuy], ['Profit target', target], ['Rehab', repairs],
      ['Hard money interest + points', atContract.interest + atContract.points], ['Holding costs', atContract.holding],
      ...(d.tenant ? [['Tenant buyout / eviction', atContract.tenantExtra], ['Rent collected while waiting', atContract.tenantIncome]] : []),
      ['Selling costs', atContract.sell], ['Profit at contract price', atContract.profit], ['Cash in', atContract.cashIn],
    ],
    reasoning,
  };
}

// ─────────────────────────────────────────────────────────────
// 3) SELLER FINANCE — pay closer to their price, on terms
// ─────────────────────────────────────────────────────────────
export function sellerFinance(d, ws, cfg = CONFIG) {
  const sf = cfg.sellerFinance;
  const { arv, asIs, rent, repairs, lead } = d;
  const notes = [];
  if (!rent) {
    return {
      key: 'seller_finance', name: 'Seller finance (seller carries the note)', viable: false,
      headline: { label: 'Offer seller', value: null }, yourProfit: null, capitalNeeded: null, timeline: '—',
      numbers: [], reasoning: ['No rent estimate came back, so cash flow can\'t be calculated. Pull rent comps by hand.'],
    };
  }

  const opexPct = sf.vacancyPct + sf.maintenancePct + sf.mgmtPct + sf.capexPct;
  const taxIns = (arv * (cfg.propertyTaxRate + cfg.insuranceRate)) / 12;
  const noi = rent * (1 - opexPct) - taxIns;                // monthly, before debt
  const maxPI = noi - sf.minCashflow;
  const maxPrice = maxPI > 0 ? pv(sf.rate, sf.amortYears, maxPI) / (1 - sf.downPct) : 0;
  const cap = (asIs || arv - repairs) * sf.maxPriceOfAsIs;
  let price = r500(Math.min(maxPrice, cap));
  const asking = Number(String(lead.asking || '').replace(/[^\d]/g, '')) || 0;
  if (asking && asking <= price) { price = r500(asking); notes.push('Seller\'s asking price fits, so we can give them their number.'); }

  const down = price * sf.downPct;
  const note = price - down;
  const payment = pmt(sf.rate, sf.amortYears, note);
  const cashflow = noi - payment;
  const closing = price * sf.closingPct;
  const cashIn = down + repairs + closing;
  const coc = cashIn > 0 ? (cashflow * 12) / cashIn : null;
  const balloon = balanceAfter(sf.rate, sf.amortYears, note, sf.balloonYears * 12);
  const futureValue = arv * (1 + cfg.appreciation) ** sf.balloonYears;
  const equityAtBalloon = futureValue - balloon;
  const totalCashflow = cashflow * 12 * sf.balloonYears;

  // Wrap exit — sell on owner-finance terms to an end buyer
  const wrapPrice = r500(arv * sf.wrapPriceOfArv);
  const wrapDown = wrapPrice * sf.wrapDownPct;
  const wrapPmt = pmt(sf.wrapRate, 30, wrapPrice - wrapDown);
  const wrapSpread = wrapPmt - payment;                     // end buyer pays taxes/insurance
  const wrapUpfront = wrapDown - down - repairs - closing;

  const premium = price - ws.headline.value;
  const viable = price > 0 && cashflow >= sf.minCashflow - 1 && premium > 0;

  if (lead.owed === 'mortgage') notes.push('Seller has a mortgage. You\'d buy subject-to or wrap it, which brings due-on-sale risk and needs an attorney.');
  if (lead.owed === 'free_clear') notes.push('Free & clear is the cleanest setup for seller financing.');
  if (d.tenant) notes.push('Existing lease transfers with the sale. You collect rent from day one, which makes the first payments easy.');
  if (['behind'].includes(lead.reason)) notes.push('Seller is behind on payments. They may need cash now more than a higher price.');

  const reasoning = [
    `${d.tenant?.rentSource === 'actual' ? 'Tenant pays' : 'Rent estimate is'} ${$(rent)}/mo${d.tenant?.marketRent && d.tenant.rentSource === 'actual' ? ` (market is about ${$(d.tenant.marketRent)})` : ''}. After ${pct(opexPct)} for vacancy, maintenance, management and capex, plus ${$(taxIns)}/mo taxes and insurance, the house nets ${$(noi)}/mo before the note.`,
    `To keep at least ${$(sf.minCashflow)}/mo cash flow at ${pct(sf.rate)} over ${sf.amortYears} years with ${pct(sf.downPct)} down, you can pay up to ${$(maxPrice)}${maxPrice > cap ? `, capped at ${$(cap)} (${pct(sf.maxPriceOfAsIs)} of as-is value)` : ''}.`,
    premium > 0
      ? `Offer ${$(price)}. That's ${$(premium)} more than your cash offer, which is the selling point: they get a higher price in exchange for getting paid over time.`
      : 'Seller finance can\'t beat the cash offer here, so the rent doesn\'t support a higher price.',
    `Your payment to the seller is ${$(payment)}/mo, leaving ${$(cashflow)}/mo (${pct(coc)} cash-on-cash on ${$(cashIn)} in). Balloon of ${$(balloon)} due in year ${sf.balloonYears}, when estimated equity is ${$(equityAtBalloon)}.`,
    `Wrap option: resell at ${$(wrapPrice)} with ${pct(sf.wrapDownPct)} down at ${pct(sf.wrapRate)}. Their payment of ${$(wrapPmt)}/mo gives you a ${$(wrapSpread)}/mo spread, and ${wrapUpfront >= 0 ? `${$(wrapUpfront)} back up front` : `${$(-wrapUpfront)} of your cash stays in`}.`,
    ...notes,
  ];

  if (premium <= 0) {
    return {
      key: 'seller_finance', name: 'Seller finance (seller carries the note)', viable: false,
      headline: { label: 'Most the rent supports', value: price },
      yourProfit: null, yourProfitNote: 'not a fit', capitalNeeded: null, timeline: '—',
      numbers: [['Rent', rent], ['Net before note / mo', noi], ['Most the rent supports', price], ['Cash offer (for comparison)', ws.headline.value]],
      reasoning: [reasoning[0], reasoning[1],
        `That's below your ${$(ws.headline.value)} cash offer, so seller finance doesn't work here. The rent is too low relative to the price${taxIns > rent * 0.4 ? ' (taxes and insurance alone eat a big share of it)' : ''}.`,
        ...notes.filter(x => !/Free & clear|lease transfers/.test(x))],
    };
  }

  return {
    key: 'seller_finance', name: 'Seller finance (seller carries the note)', viable,
    headline: { label: 'Offer seller', value: price, terms: `${pct(sf.downPct)} down · ${pct(sf.rate)} · ${sf.amortYears}-yr amortization · ${sf.balloonYears}-yr balloon` },
    yourProfit: Math.round(totalCashflow + equityAtBalloon - cashIn),
    yourProfitNote: `${sf.balloonYears}-yr cash flow + equity at balloon − cash in`,
    capitalNeeded: Math.round(cashIn), capitalNote: 'down + rehab + closing',
    timeline: `${sf.balloonYears}-yr hold`,
    premium,
    numbers: [
      ['Offer to seller', price], ['Down payment', down], ['Monthly to seller', payment], ['Rent', rent],
      ['Monthly cash flow', cashflow], ['Cash in', cashIn], [`Balloon (year ${sf.balloonYears})`, balloon],
      ['Wrap spread / mo', wrapSpread],
    ],
    reasoning,
  };
}

// ─────────────────────────────────────────────────────────────
// Pick a play
// ─────────────────────────────────────────────────────────────
// Wholesale-only verdict: is the seller's number inside your spread?
function wholesaleVerdict(d, ws, cfg) {
  const asking = Number(String(d.lead.asking || '').replace(/[^\d]/g, '')) || 0;
  const mao = ws.headline.value, open = ws.headline.opening;
  if (cfg.maxArv && d.arv > cfg.maxArv) {
    return { recommended: null, outOfBox: true, why: `Outside your buy box. ARV is ${$(d.arv)}, above your ${$(cfg.maxArv)} limit, and cash buyers at this price are rare. Pass, or hand the lead to an agent you trust.` };
  }
  if (mao <= 0) return { recommended: null, why: 'Repairs eat the whole spread. There\'s no wholesale number that works. Pass.' };
  const thin = ws.viable ? '' : ' Heads up: the spread is thin for your buyers at this price, so get the seller lower or cut your fee.';
  let why;
  if (!asking) why = `No asking price given. Open at ${$(open)} and don't go above ${$(mao)}.`;
  else if (asking <= open) why = `Asking ${$(asking)} is under your opening offer. Lock it up fast.`;
  else if (asking <= mao) why = `Asking ${$(asking)} fits under your ${$(mao)} max. Contract at or a little under their number.`;
  else if (asking <= mao * 1.15) why = `Asking ${$(asking)} is ${$(asking - mao)} over your max. Close enough to negotiate: walk them through the repairs, or take a smaller fee (at a ${$(Math.max(0, cfg.assignmentFee - (asking - mao)))} fee their number works).`;
  else why = `Asking ${$(asking)} is ${pct(asking / mao - 1)} over your ${$(mao)} max. Make your offer anyway and follow up in 30–60 days; motivation tends to grow.`;
  return { recommended: 'wholesale', why: why + thin };
}

export function analyzeDeal(d, cfg = CONFIG) {
  if (!d.arv || d.repairs == null) return null;
  const ws = wholesale(d, cfg);
  if (cfg.mode === 'wholesale') return { ...wholesaleVerdict(d, ws, cfg), mode: 'wholesale', strategies: [ws] };
  const fl = fixAndFlip(d, ws, cfg);
  const sf = sellerFinance(d, ws, cfg);
  const asking = Number(String(d.lead.asking || '').replace(/[^\d]/g, '')) || 0;

  const sfPrice = sf.headline.value || 0;
  const bestCash = Math.max(ws.headline.value, fl.viable ? fl.headline.value : 0);
  const gapNote = asking && asking > Math.max(bestCash, sfPrice) * 1.05
    ? ` Seller is asking ${$(asking)}, which is above every exit (best is ${$(Math.max(bestCash, sfPrice))}). Expect a negotiation, or follow up in 30–60 days.`
    : '';

  let pick, why;
  if (cfg.maxArv && d.arv > cfg.maxArv) {
    const listNet = (d.asIs || d.arv) * (1 - cfg.flip.sellAgentPct - cfg.flip.sellClosingPct);
    return {
      recommended: null, outOfBox: true,
      why: `Outside your buy box. ARV is ${$(d.arv)}, above your ${$(cfg.maxArv)} limit. Cash buyers at this price are rare, and your max offer (${$(ws.headline.value)}) is about ${pct(1 - ws.headline.value / listNet)} below what the seller would net listing it with an agent (about ${$(listNet)}). Don't pitch a 70%-rule number. Pass, or hand the lead to an agent you trust.${gapNote}`,
      strategies: [ws, fl, sf],
    };
  }
  if (ws.headline.value <= 0 && !sf.viable) {
    pick = null; why = 'Numbers don\'t work on any exit at this ARV and repair level. Pass, or refer the seller to an agent.';
  } else if (asking && asking > ws.headline.value * 1.15 && sf.viable && sfPrice >= asking * 0.9) {
    pick = 'seller_finance'; why = `Seller wants ${$(asking)}, well above your cash number. Seller finance gets them to ${$(sfPrice)} and still cash flows.`;
  } else if (fl.viable && fl.multiple >= 2.5 && d.confidence !== 'low') {
    pick = 'flip'; why = `Flipping nets about ${$(fl.yourProfit)} (${fl.multiple.toFixed(1)}× the assignment fee) and the comps are solid. Keep it if you have ${$(fl.capitalNeeded)} to put in; otherwise wholesale it.`;
  } else if (ws.viable) {
    pick = 'wholesale'; why = 'Clean wholesale spread with no capital at risk. Lock it up and assign it.';
  } else if (sf.viable) {
    pick = 'seller_finance'; why = 'Cash margins are thin, but the rent supports a terms deal.';
  } else {
    pick = 'wholesale'; why = 'Thin across the board. Only pursue it if you can get the seller under your opening offer.';
  }
  return { recommended: pick, why: why + gapNote, strategies: [ws, fl, sf] };
}
