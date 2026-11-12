// Skip tracing through Tracerfy: owner phones (ranked, with DNC/litigator flags), emails and mailing address.
// A hit costs Tracerfy credits; a miss is free. TRACERFY_API_KEY is set in Vercel.
import { meter } from './meter.js';

const URL = 'https://tracerfy.com/v1/api/trace/lookup/';
const s = (v, n = 120) => (v == null ? '' : String(v).slice(0, n).trim());
const cap = v => s(v).toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

export const skipReady = () => !!process.env.TRACERFY_API_KEY;

// Where a one-off address's trace is kept for an account (owner/PIN scope is '')
import crypto from 'node:crypto';
export function addrKey(scope, a) {
  const n = [a?.street, a?.city, a?.state, a?.zip].map(x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
  if (!n[0] || !(n[3] || (n[1] && n[2]))) return null;
  return `t/${scope || 'owner'}/skips/${crypto.createHash('sha256').update(n.join('|')).digest('hex').slice(0, 24)}`;
}

// Keep only the fields we show, in a fixed shape
export function cleanSkip(r) {
  if (!r || typeof r !== 'object') return null;
  const persons = (Array.isArray(r.persons) ? r.persons : []).slice(0, 4).map(p => ({
    name: cap([p.first_name ?? p.firstName, p.last_name ?? p.lastName].filter(Boolean).join(' ') || p.name),
    age: Number(p.age) || null, deceased: !!p.deceased, owner: p.property_owner ?? p.owner ?? null, litigator: !!p.litigator,
    mailing: p.mailing_address || p.mailing ? (m => [s(m.street || m.address), s(m.city), [s(m.state), s(m.zip)].filter(Boolean).join(' ')].filter(Boolean).join(', '))(p.mailing_address || p.mailing) : (typeof p.mailing === 'string' ? s(p.mailing, 200) : ''),
    phones: (Array.isArray(p.phones) ? p.phones : []).slice(0, 8).map(x => ({ number: s(x.number, 20).replace(/\D/g, ''), type: s(x.type, 20), carrier: s(x.carrier, 40), dnc: !!x.dnc, rank: Number(x.rank) || null }))
      .filter(x => x.number.length >= 10).sort((a, z) => (a.rank || 99) - (z.rank || 99)),
    emails: (Array.isArray(p.emails) ? p.emails : []).slice(0, 5).map(e => s(typeof e === 'string' ? e : e.email, 120)).filter(e => e.includes('@')),
  }));
  return { at: Number(r.at) || Date.now(), hit: !!r.hit && persons.length > 0, persons };
}

export async function traceAddress({ street, city, state, zip }) {
  const key = process.env.TRACERFY_API_KEY;
  if (!key) throw Object.assign(new Error('Skip tracing isn\'t connected yet.'), { status: 503 });
  if (!street || !(zip || (city && state))) throw Object.assign(new Error('Needs a street address with a city and state or ZIP.'), { status: 400 });
  const r = await fetch(URL, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ address: s(street, 200), city: s(city, 80), state: s(state, 2).toUpperCase(), zip: s(zip, 10) }),
    signal: AbortSignal.timeout(25000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('tracerfy', r.status, JSON.stringify(j).slice(0, 300));
    if (r.status === 404) return cleanSkip({ hit: false, persons: [] });
    throw Object.assign(new Error(r.status === 402 ? 'Skip tracing is paused. The account owner needs to top up credits.' : r.status === 429 ? 'Skip tracing is busy. Try again in a minute.' : 'Couldn\'t skip trace that address. Try again.'), { status: 502 });
  }
  const out = cleanSkip({ ...j, at: Date.now() });
  if (out.hit) meter('tracerfy', 1, { tracerfyCredits: Number(j.credits_deducted) || 5 });
  return out;
}
