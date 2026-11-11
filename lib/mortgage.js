// Recorded mortgage, equity and distress data for one address.
// Provider: Realie (REALIE_API_KEY, ~1 credit per address) or RealEstateAPI (REAPI_API_KEY). Off if neither is set.
// Results are cached 30 days per address so repeat runs don't cost a lookup.
import crypto from 'node:crypto';
import { getDoc, putDoc } from './db.js';
import { meter } from './meter.js';

const URL = 'https://api.realestateapi.com/v2/PropertyDetail';
const TTL = 30 * 864e5;
const num = v => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
const yes = v => v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true' || String(v).toUpperCase() === 'Y';
const pick = (o, ...keys) => { for (const k of keys) { const v = k.split('.').reduce((x, p) => x?.[p], o); if (v !== undefined && v !== null && v !== '') return v; } return null; };
const day = v => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d.toISOString().slice(0, 10); };
const DOC = { NOD: 'Notice of default', NOL: 'Notice of lis pendens', NOR: 'Notice of trustee sale', NTS: 'Notice of trustee sale', FOR: 'Foreclosure filed', LIS: 'Lis pendens', REO: 'Bank-owned (REO)' };

export const mortgageEnabled = () => !!(process.env.REALIE_API_KEY || process.env.REAPI_API_KEY);

// Remaining balance on an amortizing loan: amount at rate over term months, months elapsed since recording
export function amortizedBalance(amount, ratePct, termMonths, startISO, now = Date.now()) {
  if (!amount || !startISO) return amount || null;
  const n = termMonths || 360, k = Math.max(0, Math.round((now - new Date(startISO)) / (30.4375 * 864e5)));
  if (k >= n) return 0;
  const r = (ratePct || 6.5) / 1200;
  if (!r) return Math.round(amount * (1 - k / n));
  const pmt = amount * r / (1 - Math.pow(1 + r, -n));
  return Math.max(0, Math.round(amount * Math.pow(1 + r, k) - pmt * (Math.pow(1 + r, k) - 1) / r));
}
// Typical 30-yr rate by year a loan was recorded, used when the record has no rate
const RATE_BY_YEAR = { 2000: 8, 2003: 5.8, 2006: 6.4, 2009: 5, 2012: 3.7, 2014: 4.2, 2016: 3.7, 2018: 4.5, 2019: 3.9, 2020: 3.1, 2021: 3, 2022: 5.3, 2023: 6.8, 2024: 6.7, 2025: 6.6, 2026: 6.3 };
const rateFor = y => { let best = 6.5; for (const k of Object.keys(RATE_BY_YEAR).map(Number).sort((a, b) => a - b)) if (y >= k) best = RATE_BY_YEAR[k]; return best; };

// Realie v3 property record → our shape
export function normalizeRealie(d, now = Date.now()) {
  if (!d || typeof d !== 'object') return null;
  const transfers = (d.salesHistory || d.transfers || d.saleHistory || []).map(t => day(pick(t, 'recordingDate', 'transferDate', 'saleDate', 'documentDate', 'date'))).filter(Boolean).sort();
  const lastSale = transfers.at(-1) || day(pick(d, 'transferDate', 'lastSaleDate'));
  const released = m => (m.assignmentsReleases || []).some(x => /release|satisf|reconvey/i.test(String(x.recordType || '')));
  const open = (d.mortgages || []).filter(m => {
    const rec = day(m.recordingDate);
    if (released(m)) return false;
    if (rec && lastSale && rec < lastSale && !(m.relatedSaleDocumentNumber)) return false; // paid off when the house last sold
    if (m.dueDate && day(m.dueDate) && day(m.dueDate) < new Date(now).toISOString().slice(0, 10)) return false;
    return true;
  });
  const loans = open.map(m => {
    const rec = day(m.recordingDate), yr = rec ? +rec.slice(0, 4) : null;
    const months = m.term ? (/year/i.test(String(m.termUnit || '')) ? m.term * 12 : m.term) : null;
    const rate = num(m.interestRate) || num(m.estimatedInterestRate);
    const heloc = yes(m.heloc) || yes(m.equityLoan);
    return { lender: m.lender || null, amount: num(m.amount), rate, rateType: m.interestRateType || null, type: heloc ? 'HELOC / equity line' : (m.loanType || null),
      term: months, termType: months ? 'months' : null, date: rec, maturity: day(m.dueDate), position: m.lienPosition || null,
      est: heloc ? num(m.amount) : amortizedBalance(num(m.amount), rate || (yr ? rateFor(yr) : 6.5), months || 360, rec, now) };
  }).filter(l => l.amount);
  const fc = (d.foreclosures || []).filter(f => { const dt = day(pick(f, 'recordingDate', 'fileDate')); return !dt || !lastSale || dt >= lastSale; }).map(f => ({
    type: DOC[String(f.recordType || '').toUpperCase()] || f.recordType || 'Foreclosure filing',
    date: day(pick(f, 'recordingDate', 'fileDate')), amount: num(pick(f, 'pastDueAmount', 'unpaidBalance')), auction: day(f.auctionDate), lender: pick(f, 'lenderName', 'trusteeName') }));
  const liens = (d.liens || []).filter(l => { const dt = day(l.recordingDate); return !dt || !lastSale || dt >= lastSale; });
  const owner = d.propertyIdentification?.currentOwner || {};
  // Realie's own modeled lien balance when present; otherwise our amortized estimate
  const debt = d.realieDebtEstimate || d.legacyDebtEstimate || {};
  const modeled = num(pick(debt, 'lienBalance', 'totalLienBalance', 'openLienBalance'));
  const balance = loans.length ? (modeled != null ? modeled : loans.reduce((s, l) => s + (l.est || 0), 0)) : 0;
  return {
    balance, value: null, equity: null, equityPct: null, freeClear: loans.length === 0,
    loans: loans.map(({ est, ...l }) => l), foreclosure: fc, estimated: true,
    flags: {
      preForeclosure: fc.length > 0, auction: fc.some(f => f.auction && f.auction >= new Date(now).toISOString().slice(0, 10)), reo: fc.some(f => /reo|bank/i.test(f.type)),
      taxLien: liens.some(l => /tax/i.test(String(l.lienType || ''))), judgment: liens.some(l => !/tax/i.test(String(l.lienType || ''))),
      taxDelinquentYear: null, vacant: false, absentee: owner.ownerOccupied === false || owner.ownerOccupied === 'N',
      highEquity: false, negativeEquity: false,
    },
  };
}

// Normalize whatever shape the API returns into what the deal sheet needs
export function normalize(d) {
  if (!d || typeof d !== 'object') return null;
  const loans = (pick(d, 'currentMortgages', 'mortgages.current', 'openMortgages') || []).map(m => ({
    lender: pick(m, 'lenderName', 'lender', 'lenderNameStandardized'),
    amount: num(pick(m, 'amount', 'loanAmount', 'originalLoanAmount')),
    rate: num(pick(m, 'interestRate', 'rate')),
    rateType: pick(m, 'interestRateType', 'rateType'),
    type: pick(m, 'loanType', 'loanTypeCode', 'type'),
    term: num(pick(m, 'term', 'loanTerm')), termType: pick(m, 'termType'),
    date: day(pick(m, 'recordingDate', 'documentDate', 'loanDate')),
    maturity: day(pick(m, 'maturityDate')),
    position: pick(m, 'position', 'seq'),
  })).filter(l => l.amount || l.lender);
  const fc = (pick(d, 'foreclosureInfo', 'foreclosures') || []).map(f => ({
    type: DOC[String(pick(f, 'documentType', 'type') || '').toUpperCase()] || pick(f, 'documentType', 'type') || 'Foreclosure filing',
    date: day(pick(f, 'recordingDate', 'filingDate', 'documentDate')),
    amount: num(pick(f, 'defaultAmount', 'judgmentAmount', 'originalLoanAmount')),
    auction: day(pick(f, 'auctionDate')),
    lender: pick(f, 'lenderName', 'trusteeName'),
  }));
  const balance = num(pick(d, 'openMortgageBalance', 'estimatedMortgageBalance', 'mortgageBalance'));
  const value = num(pick(d, 'estimatedValue', 'avm', 'value'));
  let equity = num(pick(d, 'estimatedEquity', 'equity'));
  if (equity === null && value !== null && balance !== null) equity = value - balance;
  let equityPct = num(pick(d, 'equityPercent', 'equityPct'));
  if (equityPct === null && equity !== null && value) equityPct = Math.round(equity / value * 100);
  const freeClear = yes(pick(d, 'freeClear', 'freeAndClear')) || (balance === 0 && !loans.length && value !== null);
  return {
    balance: freeClear ? 0 : balance, value, equity, equityPct, freeClear,
    loans, foreclosure: fc,
    flags: {
      preForeclosure: yes(pick(d, 'preForeclosure')) || fc.length > 0,
      auction: yes(pick(d, 'auction')), reo: yes(pick(d, 'reo')),
      taxLien: yes(pick(d, 'taxLien')), judgment: yes(pick(d, 'judgment')),
      taxDelinquentYear: pick(d, 'taxInfo.taxDelinquentYear'),
      vacant: yes(pick(d, 'vacant')), absentee: yes(pick(d, 'absenteeOwner')),
      highEquity: yes(pick(d, 'highEquity')) || (equityPct !== null && equityPct >= 40),
      negativeEquity: equityPct !== null && equityPct < 0,
    },
  };
}

// lead: { address, street, state } (street + state are what Realie needs)
export async function getMortgage(lead) {
  const realie = process.env.REALIE_API_KEY, reapi = process.env.REAPI_API_KEY;
  const address = typeof lead === 'string' ? lead : lead?.address;
  if ((!realie && !reapi) || !address) return null;
  const ck = `cache/mtg2/${crypto.createHash('sha256').update(String(address).trim().toLowerCase()).digest('hex').slice(0, 40)}`;
  const hit = await getDoc(ck).catch(() => null);
  if (hit && Date.now() - hit.at < TTL) return hit.m;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
  try {
    let r, j, m;
    if (realie) {
      const street = (typeof lead === 'object' && lead.street) || String(address).split(',')[0];
      const state = (typeof lead === 'object' && lead.state) || (String(address).match(/,\s*([A-Z]{2})\b/) || [])[1] || 'TX';
      const qs = new URLSearchParams({ address: street.toUpperCase(), state });
      if (typeof lead === 'object' && lead.county && lead.city) { qs.set('city', lead.city.toUpperCase()); qs.set('county', String(lead.county).toUpperCase()); }
      meter('realie');
      r = await fetch(`https://app.realie.ai/api/public/property/address?${qs}`, { signal: ctl.signal, headers: { Authorization: realie, Accept: 'application/json' } });
      j = await r.json().catch(() => ({}));
      if (r.status === 404) { await putDoc(ck, { at: Date.now(), m: null }, { keep: 1 }).catch(() => {}); return null; }
      if (r.ok) {
        const rec = j.property || j.data || j;
        m = normalizeRealie(rec);
      }
    } else {
      meter('reapi');
      r = await fetch(URL, { method: 'POST', signal: ctl.signal, headers: { 'x-api-key': reapi, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ address }) });
      j = await r.json().catch(() => ({}));
      if (r.ok) m = normalize(j.data || j.property || j);
    }
    if (!r.ok) { console.error('mortgage lookup', r.status, JSON.stringify(j).slice(0, 300)); return null; }
    if (m) await putDoc(ck, { at: Date.now(), m }, { keep: 1 }).catch(() => {});
    return m;
  } catch (e) { console.error('mortgage lookup', e.message); return null; }
  finally { clearTimeout(t); }
}
