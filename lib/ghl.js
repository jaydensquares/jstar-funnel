// GoHighLevel (LeadConnector) connection for sending buyer texts through a user's own A2P-registered number.
// The Private Integration token is encrypted at rest and never sent back to the browser.
import crypto from 'node:crypto';
import { getDoc, putDoc, deleteDoc } from './db.js';

const BASE = process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com'; // override only for local tests
const keyOf = scope => `ghl/${scope || 'op'}`;
const aes = () => crypto.createHash('sha256').update('ghl:' + (process.env.SESSION_SECRET || 'x')).digest();

export const seal = s => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', aes(), iv); const e = Buffer.concat([c.update(String(s), 'utf8'), c.final()]); return [iv, c.getAuthTag(), e].map(x => x.toString('base64url')).join('.'); };
const open = s => { const [iv, tag, e] = String(s).split('.').map(x => Buffer.from(x, 'base64url')); const d = crypto.createDecipheriv('aes-256-gcm', aes(), iv); d.setAuthTag(tag); return Buffer.concat([d.update(e), d.final()]).toString('utf8'); };

export async function getGhl(scope) { const d = await getDoc(keyOf(scope)).catch(() => null); if (!d?.tok) return null; try { return { ...d, token: open(d.tok) }; } catch { return null; } }
export const saveGhl = (scope, { token, locationId, by }) => putDoc(keyOf(scope), { tok: seal(token), last4: token.slice(-4), locationId, at: Date.now(), by: by || null }, { keep: 1 });
export const dropGhl = scope => deleteDoc(keyOf(scope));
export const publicGhl = (g, canEdit) => g ? { connected: true, locationId: g.locationId, last4: g.last4, at: g.at, canEdit } : { connected: false, canEdit };

async function call(g, method, path, body, version) {
  for (let t = 0; t < 3; t++) {
    const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${g.token}`, Version: version, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 429 && t < 2) { await new Promise(x => setTimeout(x, 1500 * (t + 1))); continue; }
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, j };
  }
}
const errText = x => [].concat(x?.j?.message || x?.j?.msg || x?.j?.error || '').join(' ').slice(0, 200);

// Checks the token and location before saving
export async function testGhl(g) {
  const r = await call(g, 'GET', `/contacts/?locationId=${encodeURIComponent(g.locationId)}&limit=1`, null, '2021-07-28');
  if (r.ok) return { ok: true };
  if (r.status === 401) return { ok: false, error: 'GoHighLevel rejected that token. Make a new Private Integration token in the sub-account and paste it again.' };
  if (r.status === 403) return { ok: false, error: 'That token is missing permissions or belongs to another sub-account. Check the scopes and the Location ID.' };
  return { ok: false, error: `GoHighLevel said: ${errText(r) || 'error ' + r.status}` };
}

// Finds or creates the buyer as a contact (tagged once), then sends the SMS from the sub-account's number
export async function ghlText(g, buyer, phone10, message) {
  let id = buyer.ghlId && buyer.ghlLoc === g.locationId ? buyer.ghlId : null, created = false;
  if (!id) {
    const [first, ...rest] = String(buyer.name || '').trim().split(/\s+/);
    const u = await call(g, 'POST', '/contacts/upsert', { locationId: g.locationId, phone: '+1' + phone10, firstName: first || undefined, lastName: rest.join(' ') || undefined, email: buyer.email || undefined, companyName: buyer.company || undefined, source: 'JStar Pro buyers list' }, '2021-07-28');
    id = u?.j?.contact?.id; if (!id) return { ok: false, error: errText(u) || 'Could not add the contact.' };
    created = true;
    await call(g, 'POST', `/contacts/${id}/tags`, { tags: ['jstar pro buyer'] }, '2021-07-28').catch(() => {});
  }
  let s = await call(g, 'POST', '/conversations/messages', { type: 'SMS', contactId: id, message }, '2021-04-15');
  if (!s.ok && s.status === 422 && /status/i.test(errText(s))) s = await call(g, 'POST', '/conversations/messages', { type: 'SMS', contactId: id, message, status: 'pending' }, '2021-04-15');
  if (!s.ok && buyer.ghlId && !created && (s.status === 404 || /contact.*(not found|does not exist|invalid)/i.test(errText(s)))) return ghlText(g, { ...buyer, ghlId: null }, phone10, message); // contact was deleted in GHL
  return s.ok ? { ok: true, contactId: id, created } : { ok: false, contactId: id, created, error: errText(s) || 'error ' + s.status, dnd: /dnd|do not disturb|opt/i.test(errText(s)) };
}
