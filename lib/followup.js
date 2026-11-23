// Automatic follow-up for seller leads that go quiet: 5 touches over 30 days by email, and by text through the
// account's GoHighLevel number when the seller gave text consent on the funnel. It stops on its own when the lead
// is marked dead or moved to deals, when the user logs a call or text, or when the seller unsubscribes.
import crypto from 'node:crypto';
import { sendPlainEmail } from './auth.js';
import { getGhl, ghlText } from './ghl.js';

export const STEPS = [1, 3, 7, 14, 30]; // days after the sequence starts
const DAY = 864e5;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const first = L => (L?.firstName || '').trim().split(' ')[0] || 'there';
const street = L => (L?.street || L?.address || 'your property').split(',')[0];
const phone10 = v => { const d = String(v || '').replace(/\D/g, ''); return d.length === 11 && d[0] === '1' ? d.slice(1) : d.length === 10 ? d : ''; };

const sig = s => crypto.createHmac('sha256', process.env.SESSION_SECRET || 'x').update('fu:' + s).digest('base64url').slice(0, 22);
export const fuToken = (scope, id) => Buffer.from(`${scope}|${id}`).toString('base64url') + '.' + sig(`${scope}|${id}`);
export const fuParse = t => { const [p, s] = String(t || '').split('.'); try { const raw = Buffer.from(p, 'base64url').toString(); return s && sig(raw) === s ? raw.split('|') : null; } catch { return null; } };

// The five messages. Plain, friendly, no pressure; each one says who is writing.
export function message(step, lead, biz) {
  const L = lead.lead || {}, n = first(L), st = street(L), who = biz.signer ? `${biz.signer.split(' ')[0]} with ${biz.company}` : biz.company;
  const call = biz.phone ? ` You can reach me at ${biz.phone}.` : '';
  return [
    { subject: `About ${st}`, text: `Hi ${n}, it's ${who}. Following up on ${st}. Still thinking about selling? I can make you a cash offer, buy it as-is and close on your timeline.${call}` },
    { subject: `Quick question about ${st}`, text: `Hi ${n}, ${who} again. Did you get a chance to think about an offer on ${st}? No repairs, no cleanup, no agent fees. Happy to answer any questions.${call}` },
    { subject: `Still interested in a cash offer?`, text: `Hi ${n}, just checking in on ${st}. If your plans changed, no problem. If you'd still like a no-obligation cash offer, reply and I'll put one together.` },
    { subject: `Offer still open on ${st}`, text: `Hi ${n}, it's ${who}. I'm still interested in ${st} if the timing works better now. Want me to send over numbers?${call}` },
    { subject: `Last check-in about ${st}`, text: `Hi ${n}, this is my last check-in about ${st}. If you ever want a fast, as-is cash offer, just reply here and I'll take care of it. Wishing you the best.` },
  ][step];
}

export const canText = (lead, ghl) => !!ghl && !!lead.lead?.smsConsent && !!phone10(lead.lead?.phone);
export const canEmail = lead => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lead.lead?.email || '');

// Should this lead's sequence stop before the next send? Returns the reason or null.
export function stopReason(lead) {
  const q = lead.seq || {};
  if (lead.optOut) return 'unsubscribed';
  if (['dead', 'converted'].includes(lead.status)) return lead.status === 'dead' ? 'marked dead' : 'moved to deals';
  if (lead.lastContactAt && lead.lastContactAt > (q.lastSentAt || q.startedAt || 0)) return 'you contacted them';
  if ((q.step || 0) >= STEPS.length) return 'finished';
  return null;
}

// Send the next touch. Returns { sent: ['email','text'], errors: [...] }.
export async function sendStep(lead, biz, settings, scope, base, { dry = false } = {}) {
  const q = lead.seq || {}, step = q.step || 0, m = message(step, lead, biz), L = lead.lead || {};
  const sent = [], errors = [];
  if (canEmail(lead)) {
    const unsub = `${base}/api/assist?u=${fuToken(scope, lead.id)}`;
    const addr = [biz.company, settings.address].filter(Boolean).join(' · ');
    const text = `${m.text}\n\n${biz.signer || ''}\n${biz.company}${biz.phone ? '\n' + biz.phone : ''}\n\n—\n${addr}\nDon't want these emails? Unsubscribe: ${unsub}`;
    const html = `<div style="font:15px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#282828;max-width:560px">
      <p>${esc(m.text)}</p><p>${esc(biz.signer || '')}<br>${esc(biz.company)}${biz.phone ? '<br>' + esc(biz.phone) : ''}</p>
      <p style="margin-top:28px;font-size:12px;color:#8a93a3">${esc(addr)}<br><a href="${esc(unsub)}" style="color:#8a93a3">Unsubscribe</a></p></div>`;
    if (dry) sent.push('email');
    else {
      try { await sendPlainEmail(L.email, m.subject, text, html, settings.notifyEmail || biz.email || undefined, biz.company); sent.push('email'); }
      catch (e) { errors.push('email: ' + e.message.slice(0, 120)); }
    }
  }
  const ghl = await getGhl(scope).catch(() => null);
  if (canText(lead, ghl)) {
    if (dry) sent.push('text');
    else {
      const r = await ghlText(ghl, { name: [L.firstName, L.lastName].filter(Boolean).join(' '), email: L.email, ghlId: lead.ghlId, ghlLoc: lead.ghlLoc }, phone10(L.phone), m.text + ' Reply STOP to opt out.').catch(e => ({ ok: false, error: e.message }));
      if (r.ok) sent.push('text'); else errors.push('text: ' + String(r.error || 'failed').slice(0, 120));
      if (r.contactId) { lead.ghlId = r.contactId; lead.ghlLoc = ghl.locationId; }
    }
  }
  return { sent, errors, subject: m.subject, text: m.text };
}

// Next state after a send attempt
export function advance(lead, result, now = Date.now()) {
  const q = lead.seq || {}, step = (q.step || 0) + 1;
  const ev = { at: now, kind: 'auto', outcome: result.sent.length ? 'followup_sent' : 'followup_failed', note: result.sent.length ? `Auto follow-up ${step} of ${STEPS.length} sent by ${result.sent.join(' and ')}` : `Auto follow-up ${step} couldn't send: ${result.errors.join('; ') || 'no email or text-consented phone'}` };
  const seq = { ...q, step, lastSentAt: now, nextAt: step < STEPS.length ? (q.startedAt || now) + STEPS[step] * DAY : null, on: step < STEPS.length && (result.sent.length > 0) };
  if (!seq.on) seq.stoppedReason = step >= STEPS.length ? 'finished' : 'could not send';
  return { ...lead, seq, activity: [ev, ...(lead.activity || [])].slice(0, 100), updatedAt: now };
}

export const startSeq = (lead, now = Date.now()) => ({ ...lead, seq: { on: true, step: 0, startedAt: now, nextAt: now + STEPS[0] * DAY, lastSentAt: null, stoppedReason: null }, updatedAt: now });
