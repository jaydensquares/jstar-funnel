// Recorded mortgage, equity and distress data for one address (RealEstateAPI Property Detail).
// Off unless REAPI_API_KEY is set. Results are cached 30 days per address so repeat runs don't cost a lookup.
import crypto from 'node:crypto';
import { getDoc, putDoc } from './db.js';

const URL = 'https://api.realestateapi.com/v2/PropertyDetail';
const TTL = 30 * 864e5;
const num = v => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
const yes = v => v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true' || String(v).toUpperCase() === 'Y';
const pick = (o, ...keys) => { for (const k of keys) { const v = k.split('.').reduce((x, p) => x?.[p], o); if (v !== undefined && v !== null && v !== '') return v; } return null; };
const day = v => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d.toISOString().slice(0, 10); };
const DOC = { NOD: 'Notice of default', NOL: 'Notice of lis pendens', NOR: 'Notice of trustee sale', NTS: 'Notice of trustee sale', FOR: 'Foreclosure filed', LIS: 'Lis pendens', REO: 'Bank-owned (REO)' };

export const mortgageEnabled = () => !!process.env.REAPI_API_KEY;

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

export async function getMortgage(address) {
  const key = process.env.REAPI_API_KEY;
  if (!key || !address) return null;
  const ck = `cache/mtg/${crypto.createHash('sha256').update(String(address).trim().toLowerCase()).digest('hex').slice(0, 40)}`;
  const hit = await getDoc(ck).catch(() => null);
  if (hit && Date.now() - hit.at < TTL) return hit.m;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(URL, { method: 'POST', signal: ctl.signal, headers: { 'x-api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ address }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { console.error('mortgage lookup', r.status, JSON.stringify(j).slice(0, 300)); return null; }
    const m = normalize(j.data || j.property || j);
    if (m) await putDoc(ck, { at: Date.now(), m }, { keep: 1 }).catch(() => {});
    return m;
  } catch (e) { console.error('mortgage lookup', e.message); return null; }
  finally { clearTimeout(t); }
}
