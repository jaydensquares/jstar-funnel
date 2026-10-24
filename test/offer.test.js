// Runs the full pipeline against fake RentCast responses (no API key needed).
//   npm test            → prints the analysis
//   npm test -- --html  → also writes test/sample-deal-sheet.html
import fs from 'node:fs';

process.env.RENTCAST_API_KEY ||= 'test';
const today = Date.now();
const ago = d => new Date(today - d * 864e5).toISOString();

// 1,640 sqft 1978 SFR in Garland, TX. Mix of off-market (sold) and active comps.
const comps = [
  ['412 Oak Ridge Dr', 289000, 1610, 3, 2, 1976, 0.21, 'Inactive', 64],
  ['1803 Willow Bend', 305000, 1700, 3, 2, 1981, 0.34, 'Inactive', 102],
  ['927 Pecan Hollow', 279000, 1560, 3, 2, 1974, 0.42, 'Inactive', 151],
  ['2210 Brookhaven Ln', 318000, 1720, 4, 2, 1984, 0.55, 'Inactive', 88],
  ['655 Meadowcrest', 299500, 1655, 3, 2, 1979, 0.29, 'Active', 12],
  ['1450 Lakeview Ter', 262000, 1590, 3, 1.5, 1972, 0.71, 'Inactive', 190],
  ['3021 Sunset Ct', 335000, 1800, 4, 2.5, 1990, 0.88, 'Inactive', 45],
  ['740 Cedar Elm', 245000, 1480, 3, 2, 1970, 1.02, 'Inactive', 230],
  ['118 Rolling Hills', 299000, 1640, 3, 2, 1978, 0.18, 'Inactive', 33],
  ['5020 Granite Way', 455000, 2600, 4, 3, 2004, 0.9, 'Inactive', 60],  // filtered: too big
  ['88 Pine St', 158000, 980, 2, 1, 1955, 0.4, 'Inactive', 70],          // filtered: too small
].map(([a, price, squareFootage, bedrooms, bathrooms, yearBuilt, distance, status, days]) => ({
  formattedAddress: `${a}, Garland, TX 75040`, price, squareFootage, bedrooms, bathrooms, yearBuilt, distance, status,
  propertyType: 'Single Family', daysOld: days, removedDate: status === 'Inactive' ? ago(days) : null, listedDate: ago(days + 30),
}));

const calls = [];
globalThis.fetch = async url => {
  const u = String(url); calls.push(u);
  const body = u.includes('/avm/rent')
    ? { rent: 2150, rentRangeLow: 1950, rentRangeHigh: 2350 }
    : { price: 268000, priceRangeLow: 248000, priceRangeHigh: 292000, subjectProperty: { squareFootage: 1640, yearBuilt: 1978, bedrooms: 3, bathrooms: 2 }, comparables: comps };
  return { ok: true, status: 200, json: async () => body, text: async () => '' };
};

const { default: CONFIG } = await import('../config.js');
CONFIG.mode = 'all'; // first block tests all three strategies
const { analyzeLead } = await import('../lib/pipeline.js');
const { smsText, dealSheetHtml } = await import('../lib/notify.js');

const lead = {
  address: '1207 Shady Grove Dr, Garland, TX 75040', street: '1207 Shady Grove Dr', city: 'Garland', state: 'TX', zip: '75040',
  propertyType: 'single_family', propertyTypeLabel: 'Single family', bedrooms: 3, bathrooms: 2, sqft: null, yearBuilt: null,
  condition: 'moderate', issues: ['roof', 'hvac'], timeline: 'asap', reason: 'inherited', occupancy: 'vacant', owed: 'free_clear',
  asking: '$195,000', reasonDetail: "It was my mom's house. Nobody's lived there since last spring and the AC went out. I'm in Oklahoma and just want it handled.",
  firstName: 'Denise', lastName: 'Walker', phone: '(214) 555-0187', email: 'denise.w@example.com', tracking: { utm_source: 'facebook', utm_campaign: 'garland-inherited' },
};

const p = await analyzeLead(lead);
let fails = 0;
const check = (cond, msg) => { if (!cond) { fails++; console.error('✗', msg); } else console.log('✓', msg); };

console.log('\n' + smsText(p) + '\n');
for (const s of p.analysis.strategies) {
  console.log(`── ${s.name}${s.key === p.analysis.recommended ? '  ★' : ''}`);
  s.reasoning.forEach(r => console.log('  • ' + r));
}
console.log('\nPlay:', p.analysis.recommended, '—', p.analysis.why, '\n');

const [ws, fl, sf] = p.analysis.strategies;
check(p.lead.sqft === 1640, 'sqft filled from public record');
check(p.comps.length > 0 && p.comps.every(c => c.squareFootage < 2100 && c.squareFootage > 1200), 'out-of-range comps filtered');
check(p.comps[0].match >= p.comps.at(-1).match, 'comps ranked by match');
check(p.comps.every(c => c.sold), 'ARV uses off-market comps when enough exist');
check(ws.pitch.price - ws.headline.value === 10000, 'wholesale spread = assignment fee');
check(Math.abs(fl.numbers[6][1] - fl.yourProfit) < 1, 'flip profit consistent');
const { flipAt } = await import('../lib/strategies.js');
const atMax = flipAt(fl.headline.value, { arv: p.valuation.arv, repairs: p.repairs.total, tier: 'moderate' });
check(Math.abs(atMax.profit - fl.numbers[1][1]) < 1500, 'flip max purchase hits the profit target');
check(sf.headline.value > ws.headline.value, 'seller finance pays seller more than cash');
check(sf.numbers.find(n => n[0] === 'Monthly cash flow')[1] >= 249, 'seller finance meets min cash flow');
check(p.repairs.lines.length === 3, 'repair breakdown itemizes roof + hvac');

// ── Same house, tenant-occupied ──
console.log('\n════ TENANT SCENARIOS ════');
const base = { ...lead, sqft: null, yearBuilt: null, condition: 'cosmetic', issues: [], reason: 'landlord', asking: '' };
const vacant = await analyzeLead({ ...base, occupancy: 'vacant' });
const rented = await analyzeLead({ ...base, occupancy: 'tenant', currentRent: 1950, leaseEnd: '6to12', tenantPaying: 'yes' });
const deadbeat = await analyzeLead({ ...base, occupancy: 'tenant', currentRent: 1950, leaseEnd: 'mtm', tenantPaying: 'behind' });
const row = (name, x) => {
  const [w, f, s] = x.analysis.strategies;
  console.log(`${name.padEnd(22)} buyer price ${w.pitch.price} (${w.pitch.buyer}) · MAO ${w.headline.value} · flip max ${f.headline.value} / ${f.yourProfit} at MAO · SF ${s.headline.value} @ ${(Math.round(s.numbers.find(n => n[0] === 'Monthly cash flow')?.[1]) || 'n/a')}/mo · ${x.score.label} ${x.score.score} · play ${x.analysis.recommended}`);
};
row('Vacant', vacant); row('Tenant, paying', rented); row('Tenant, not paying', deadbeat);
console.log('\nTenant (paying) wholesale reasoning:'); rented.analysis.strategies[0].reasoning.forEach(r => console.log('  • ' + r));
console.log('Tenant (paying) flip reasoning:'); rented.analysis.strategies[1].reasoning.slice(0, 3).forEach(r => console.log('  • ' + r));
console.log('Notes:'); rented.valuation.notes.forEach(r => console.log('  ⚠ ' + r));
console.log();
check(rented.valuation.rent === 1950 && rented.valuation.rentSource === 'actual', 'tenant: uses actual rent');
check(rented.analysis.strategies[1].numbers.some(n => n[0] === 'Tenant buyout / eviction' && n[1] === 3000), 'tenant: long lease → cash-for-keys in flip');
check(deadbeat.analysis.strategies[1].numbers.some(n => n[0] === 'Tenant buyout / eviction' && n[1] === 3500), 'tenant: non-paying → eviction cost');
check(deadbeat.score.score > vacant.score.score, 'tenant: non-paying tenant raises motivation score');
check(rented.analysis.strategies[0].numbers.some(n => n[0] === 'Landlord buyer price'), 'tenant: landlord buyer price computed');
check(smsText(rented).includes('TENANT'), 'tenant: shows in text alert');

// ── Wholesale-only mode ──
console.log('\n════ WHOLESALE-ONLY MODE ════');
CONFIG.mode = 'wholesale';
calls.length = 0;
const w1 = await analyzeLead({ ...lead, sqft: null, yearBuilt: null });
console.log(smsText(w1)); console.log('Call:', w1.analysis.why, '\n');
check(w1.analysis.strategies.length === 1 && w1.analysis.strategies[0].key === 'wholesale', 'wholesale mode: only the wholesale deal');
check(!calls.some(u => u.includes('/avm/rent')), 'wholesale mode: skips the rent lookup');
check(!smsText(w1).includes('FLIP') && smsText(w1).includes('CALL:'), 'wholesale mode: text alert has no flip/seller-finance lines');
check(dealSheetHtml(w1).includes('Your wholesale deal') && !dealSheetHtml(w1).includes('Fix &amp; flip'), 'wholesale mode: deal sheet shows one card');
const mao = w1.analysis.strategies[0].headline.value;
const near = await analyzeLead({ ...lead, sqft: null, yearBuilt: null, asking: String(mao + 5000) });
check(/Close enough to negotiate/.test(near.analysis.why), 'wholesale mode: asking just over max → negotiate');
const under = await analyzeLead({ ...lead, sqft: null, yearBuilt: null, asking: String(mao - 20000) });
check(/Lock it up/.test(under.analysis.why), 'wholesale mode: asking under opening → lock it up');
calls.length = 0;
await analyzeLead({ ...lead, sqft: null, yearBuilt: null, occupancy: 'tenant', currentRent: 1900, leaseEnd: 'mtm', tenantPaying: 'yes' });
check(calls.some(u => u.includes('/avm/rent')), 'wholesale mode: still pulls rent for rented houses');
CONFIG.mode = 'all';

if (process.argv.includes('--html')) {
  fs.writeFileSync(new URL('./sample-deal-sheet-tenant.html', import.meta.url), dealSheetHtml(rented));
  fs.writeFileSync(new URL('./sample-deal-sheet.html', import.meta.url), dealSheetHtml(p));
  console.log('\nWrote test/sample-deal-sheet.html');
}
process.exit(fails ? 1 : 0);
