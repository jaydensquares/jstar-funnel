// Operator list puller: owners in a ZIP from RentCast property records → CSV for skip tracing.
// Each page of up to 500 records = 1 RentCast API call.
import { pinMatches } from '../lib/pin.js';

export const maxDuration = 60;

const TYPES = { sfr: ['Single Family', 'Townhouse', 'Condo'], multi: ['Multi-Family'], land: ['Land'], mobile: ['Manufactured'] };
const COMPANY = /\b(LLC|L\.L\.C|INC|CORP|CORPORATION|CO\b|COMPANY|LP|L\.P|LTD|LLP|PARTNERS|PARTNERSHIP|HOLDINGS|PROPERTIES|INVESTMENTS?|CAPITAL|GROUP|BANK|CHURCH|CITY OF|COUNTY|ISD|HOUSING|AUTHORITY|ASSOC|ASSOCIATION|HOMES|BUILDERS|DEVELOPMENT|REALTY|VENTURES|FUND|REIT|TRUST CO)\b/i;
const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const yearsSince = d => (d ? (Date.now() - new Date(d).getTime()) / (365.25 * 864e5) : null);

function splitName(full) {
  const parts = String(full || '').replace(/\s+/g, ' ').trim().split(' ');
  if (parts.length < 2) return { first: '', last: parts[0] || '' };
  const suffix = /^(JR|SR|II|III|IV)\.?$/i.test(parts.at(-1)) ? parts.pop() : '';
  return { first: parts[0], last: parts.at(-1) + (suffix ? ' ' + suffix : '') };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  if (!pinMatches(b.pin)) { await new Promise(r => setTimeout(r, 900)); return res.status(401).json({ error: 'Wrong PIN.' }); }
  const key = process.env.RENTCAST_API_KEY;
  if (!key) return res.status(503).json({ error: 'RENTCAST_API_KEY not set' });

  const zip = String(b.zip || '').trim();
  if (!/^\d{5}$/.test(zip)) return res.status(400).json({ error: 'ZIP needs 5 digits.' });
  const types = (Array.isArray(b.types) && b.types.length ? b.types : ['sfr', 'land']).flatMap(t => TYPES[t] || []);
  if (!types.length) return res.status(400).json({ error: 'Pick at least one property type.' });
  const maxCalls = Math.min(Math.max(Number(b.maxCalls) || 4, 1), 10);
  const minYears = Number(b.minYears) || 0;
  const absentee = !!b.absentee, skipCompanies = b.skipCompanies !== false;

  // Pull pages
  const all = []; let calls = 0;
  for (let page = 0; page < maxCalls; page++) {
    const params = new URLSearchParams({ zipCode: zip, propertyType: types.join('|'), limit: '500', offset: String(page * 500) });
    const r = await fetch(`https://api.rentcast.io/v1/properties?${params}`, { headers: { 'X-Api-Key': key, Accept: 'application/json' } });
    calls++;
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      if (!all.length) return res.status(502).json({ error: `RentCast ${r.status}: ${body.slice(0, 200)}` });
      break;
    }
    const rows = await r.json();
    if (!Array.isArray(rows)) break;
    all.push(...rows);
    if (rows.length < 500) break;
  }

  // Filter + tag
  const kept = []; const seenOwner = new Map();
  for (const p of all) {
    const names = p.owner?.names || [];
    const ownerName = names[0] || '';
    const isCompany = p.owner?.type === 'Organization' ? !/\b(TRUST|ESTATE)\b/i.test(ownerName) || COMPANY.test(ownerName) : COMPANY.test(ownerName);
    if (skipCompanies && (isCompany || !ownerName)) continue;
    const m = p.owner?.mailingAddress || {};
    const isAbsentee = p.ownerOccupied === false || (m.zipCode && p.zipCode && m.zipCode.slice(0, 5) !== p.zipCode.slice(0, 5));
    if (absentee && !isAbsentee && p.propertyType !== 'Land') continue;
    const yrs = yearsSince(p.lastSaleDate);
    if (minYears && yrs != null && yrs < minYears) continue;

    const tags = [];
    if (p.propertyType === 'Land') tags.push('Vacant lot');
    if (isAbsentee) tags.push(m.state && p.state && m.state !== p.state ? 'Out-of-state owner' : 'Absentee');
    if (yrs == null) tags.push('No sale on record');
    else if (yrs >= 20) tags.push('Owned 20+ yrs');
    else if (yrs >= 10) tags.push('Owned 10+ yrs');
    if (/\b(ESTATE|ETAL|ET AL|HEIRS?)\b/i.test(names.join(' '))) tags.push('Estate / heirs');
    if (/\bTRUST\b/i.test(ownerName)) tags.push('Trust');
    if (p.propertyType !== 'Land' && p.yearBuilt && p.yearBuilt < 1960) tags.push('Built pre-1960');

    const ownerKey = (ownerName + '|' + (m.addressLine1 || '')).toUpperCase();
    seenOwner.set(ownerKey, (seenOwner.get(ownerKey) || 0) + 1);
    const yrsTax = Object.keys(p.taxAssessments || {}).sort().at(-1);
    const { first, last } = isCompany || /\b(TRUST|ESTATE)\b/i.test(ownerName) ? { first: '', last: ownerName } : splitName(ownerName);
    kept.push({ p, m, first, last, ownerName, owner2: names[1] || '', tags, yrs, ownerKey, assessed: yrsTax ? p.taxAssessments[yrsTax].value : '' });
  }

  // Sort: most motivation signals first
  kept.sort((a, b) => b.tags.length - a.tags.length || (b.yrs ?? 99) - (a.yrs ?? 99));

  const head = ['First Name', 'Last Name', 'Owner Full Name', 'Owner 2', 'Property Address', 'Property City', 'Property State', 'Property Zip',
    'Mailing Address', 'Mailing City', 'Mailing State', 'Mailing Zip', 'Tags', 'Props Owned In List', 'Property Type', 'Beds', 'Baths', 'Sqft', 'Lot Acres',
    'Year Built', 'Last Sale Date', 'Last Sale Price', 'Years Owned', 'Assessed Value'];
  const lines = [head.join(',')];
  for (const k of kept) {
    const { p, m } = k;
    lines.push([k.first, k.last, k.ownerName, k.owner2, p.addressLine1 || (p.formattedAddress || '').split(',')[0], p.city, p.state, p.zipCode,
      [m.addressLine1, m.addressLine2].filter(Boolean).join(' '), m.city, m.state, m.zipCode, k.tags.join('; '), seenOwner.get(k.ownerKey),
      p.propertyType, p.bedrooms, p.bathrooms, p.squareFootage, p.lotSize ? (p.lotSize / 43560).toFixed(2) : '', p.yearBuilt,
      (p.lastSaleDate || '').slice(0, 10), p.lastSalePrice, k.yrs != null ? Math.floor(k.yrs) : '', k.assessed].map(csvCell).join(','));
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="jstar-${zip}-list.csv"`);
  res.setHeader('X-Scanned', String(all.length));
  res.setHeader('X-Kept', String(kept.length));
  res.setHeader('X-Calls', String(calls));
  res.setHeader('X-More', all.length >= maxCalls * 500 ? '1' : '0');
  return res.status(200).send(lines.join('\n'));
}
