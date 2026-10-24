import { analyzeLead } from '../lib/pipeline.js';
import { lookupLinks } from '../lib/rentcast.js';
import { sendWebhook, sendEmail, sendSms, sendPush, sendMetaCAPI } from '../lib/notify.js';

// Two RentCast calls + email can take a few seconds
export const maxDuration = 30;

const num = v => {
  const n = Number(String(v ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const TYPE_LABEL = {
  single_family: 'Single family', townhouse: 'Townhouse', condo: 'Condo',
  multi_family: 'Multi-family (2–4)', manufactured: 'Mobile/manufactured',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

  // Bot honeypot — pretend success
  if (b.website) return res.status(200).json({ ok: true });

  const required = ['street', 'city', 'state', 'zip', 'firstName', 'phone'];
  const missing = required.filter(k => !String(b[k] || '').trim());
  if (missing.length) return res.status(400).json({ error: `Missing: ${missing.join(', ')}` });
  if (String(b.phone).replace(/\D/g, '').length < 10) return res.status(400).json({ error: 'Invalid phone' });

  const lead = {
    address: `${b.street.trim()}, ${b.city.trim()}, ${String(b.state || '').trim().toUpperCase()} ${b.zip.trim()}`,
    street: b.street, city: b.city, state: String(b.state || '').trim().toUpperCase(), zip: b.zip,
    propertyType: b.propertyType || 'single_family',
    propertyTypeLabel: TYPE_LABEL[b.propertyType] || 'Single family',
    bedrooms: num(b.bedrooms), bathrooms: num(b.bathrooms),
    sqft: num(b.sqft), yearBuilt: num(b.yearBuilt),
    condition: b.condition || 'moderate',
    issues: Array.isArray(b.issues) ? b.issues : [],
    occupancy: b.occupancy || '', timeline: b.timeline || '', reason: b.reason || '',
    owed: b.owed || '', asking: b.asking || '',
    reasonDetail: String(b.reasonDetail || '').trim().slice(0, 1000),
    currentRent: b.occupancy === 'tenant' ? num(b.currentRent) : null,
    leaseEnd: b.occupancy === 'tenant' ? (b.leaseEnd || '') : '',
    tenantPaying: b.occupancy === 'tenant' ? (b.tenantPaying || '') : '',
    firstName: b.firstName.trim(), lastName: (b.lastName || '').trim(),
    phone: b.phone.trim(), email: (b.email || '').trim(),
    smsConsent: !!b.smsConsent, consentText: b.consentText || '',
    tracking: b.tracking || {},
    submittedAt: new Date().toISOString(),
  };

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || undefined;
  const userAgent = req.headers['user-agent'];
  const eventId = b.eventId || `lead_${Date.now()}`;

  // Comps → ARV → repairs → 3 strategies → score
  let payload;
  try {
    payload = await analyzeLead(lead);
  } catch (e) {
    console.error('analysis failed', e);
    payload = { lead, error: e.message, valuation: { notes: [`Analysis failed: ${e.message}`] }, offers: [], comps: [], score: { score: 0, label: 'REVIEW', reasons: [] }, links: lookupLinks(lead.address) };
  }

  // Fan out notifications; never fail the seller's submit because of them
  const results = await Promise.allSettled([
    sendWebhook(payload),
    sendEmail(payload),
    sendSms(payload),
    sendPush(payload),
    sendMetaCAPI({ lead, eventId, ip, userAgent, sourceUrl: b.pageUrl }),
  ]);
  results.forEach((r, i) => r.status === 'rejected' && console.error(['webhook', 'email', 'sms', 'push', 'capi'][i], r.reason));

  // Seller only sees a thank-you — offers stay on your side
  return res.status(200).json({ ok: true });
}
