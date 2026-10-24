import CONFIG from '../config.js';

const BASE = 'https://api.rentcast.io/v1';

const TYPE_MAP = {
  single_family: 'Single Family',
  townhouse: 'Townhouse',
  condo: 'Condo',
  multi_family: 'Multi-Family',
  manufactured: 'Manufactured',
};

export function rentcastType(t) {
  return TYPE_MAP[t] || 'Single Family';
}

// Value estimate + comparables from RentCast /avm/value
export async function getValueAndComps(subject, cfg = CONFIG) {
  const key = process.env.RENTCAST_API_KEY;
  if (!key) throw new Error('RENTCAST_API_KEY not set');

  const params = new URLSearchParams({
    address: subject.address,
    propertyType: subject.propertyType,
    compCount: String(cfg.comps.count),
    maxRadius: String(cfg.comps.maxRadiusMiles),
    daysOld: String(cfg.comps.daysOld),
  });
  if (subject.bedrooms != null) params.set('bedrooms', String(subject.bedrooms));
  if (subject.bathrooms != null) params.set('bathrooms', String(subject.bathrooms));
  if (subject.squareFootage) params.set('squareFootage', String(subject.squareFootage));

  const res = await fetch(`${BASE}/avm/value?${params}`, {
    headers: { 'X-Api-Key': key, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`RentCast ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// Long-term rent estimate from RentCast /avm/rent/long-term (feeds the seller-finance math)
export async function getRent(subject) {
  const key = process.env.RENTCAST_API_KEY;
  if (!key) throw new Error('RENTCAST_API_KEY not set');
  const params = new URLSearchParams({ address: subject.address, propertyType: subject.propertyType, compCount: '15' });
  if (subject.bedrooms != null) params.set('bedrooms', String(subject.bedrooms));
  if (subject.bathrooms != null) params.set('bathrooms', String(subject.bathrooms));
  if (subject.squareFootage) params.set('squareFootage', String(subject.squareFootage));
  const res = await fetch(`${BASE}/avm/rent/long-term?${params}`, {
    headers: { 'X-Api-Key': key, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`RentCast rent ${res.status}`);
  return res.json();
}

// Quick links so you can eyeball the address on Zillow / Redfin yourself
export function lookupLinks(address) {
  const q = encodeURIComponent(address);
  const slug = address.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
  return {
    zillow: `https://www.zillow.com/homes/${slug}_rb/`,
    redfin: `https://www.google.com/search?q=${encodeURIComponent('site:redfin.com ' + address)}`,
    googleMaps: `https://www.google.com/maps/search/?api=1&query=${q}`,
  };
}
