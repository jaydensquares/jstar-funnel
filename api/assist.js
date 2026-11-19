// JStar AI helpers on a lead: write an offer, suggest replies to a seller (never above max offer),
// turn automatic follow-up on or off, and email the seller. GET ?u=<token> is the seller's unsubscribe link.
import { getActor, bizOf, sendPlainEmail } from '../lib/auth.js';
import { getDoc, putDoc } from '../lib/db.js';
import { useQuota, refundQuota } from '../lib/usage.js';
import { meter } from '../lib/meter.js';
import { isActive, isOperator } from '../lib/plan.js';
import { getGhl } from '../lib/ghl.js';
import { STEPS, fuParse, fuToken, startSeq, canEmail, canText, stopReason } from '../lib/followup.js';

export const maxDuration = 60;
const ID = /^[a-z0-9]{6,32}$/;
const MODEL = () => process.env.ASSIST_MODEL || process.env.AGENT_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const $$ = n => n == null || !Number.isFinite(+n) ? 'unknown' : '$' + Math.round(+n).toLocaleString();
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function facts(lead, biz) {
  const L = lead.lead || {}, b = lead.brief || {};
  return [
    `Seller: ${[L.firstName, L.lastName].filter(Boolean).join(' ') || 'unknown'}`,
    `Property: ${L.address || [L.street, L.city, L.state, L.zip].filter(Boolean).join(', ')}`,
    L.condition && `Condition (seller said): ${L.condition}`, L.timeline && `Timeline: ${L.timeline}`, L.reason && `Reason for selling: ${L.reason}`,
    L.reasonDetail && `Seller wrote: "${L.reasonDetail}"`, L.occupancy && `Occupancy: ${L.occupancy}`, L.asking && `Seller's asking price: ${L.asking}`, L.owed && `Owed: ${L.owed}`,
    `Estimated after-repair value: ${$$(b.value)}`, `Estimated repairs: ${$$(b.repairs)}`,
    `Our opening offer: ${$$(b.opening)}`, `Our MAXIMUM offer (never go above this): ${$$(b.mao)}`,
    `Buyer (us): ${biz.signer || ''} with ${biz.company}${biz.phone ? ', phone ' + biz.phone : ''}`,
    (lead.activity || []).length && `Recent contact: ${(lead.activity || []).slice(0, 4).map(a => `${new Date(a.at).toLocaleDateString('en-US')}: ${a.outcome}${a.note ? ' (' + a.note.slice(0, 120) + ')' : ''}`).join('; ')}`,
  ].filter(Boolean).join('\n');
}

const RULES = `You write for a real estate investor (a cash buyer / wholesaler) talking to a homeowner. Rules:
- Plain, warm, respectful, short sentences. No pressure tactics, no fake urgency, no guilt.
- Never offer, suggest or hint at a price above the MAXIMUM offer. If the seller wants more than the maximum, say so politely and offer to talk, or explain what drives the number (repairs, holding costs, the as-is cash close).
- Don't claim to be a licensed agent, lender or attorney. Don't give legal or tax advice. Don't promise anything about closing that the facts don't support.
- Don't invent facts about the property, comps or the seller. Use only what's given.
- Say who is writing (first name and company) in a first message.`;

async function ask(system, user, maxTokens = 700) {
  if (!process.env.ANTHROPIC_API_KEY) throw Object.assign(new Error('JStar AI is not set up yet.'), { code: 503 });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL(), max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!r.ok) { console.error('assist anthropic', r.status, (await r.text()).slice(0, 300)); throw new Error('model'); }
  meter('anthropic', 1, { assist: 1 });
  const j = await r.json();
  return (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
}
const json = t => { const m = String(t).match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } };

const page = (ok, msg) => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences</title><body style="font-family:system-ui;max-width:480px;margin:80px auto;padding:0 20px;color:#1d2433"><h1 style="font-size:22px">${ok ? "You're unsubscribed" : 'That link didn’t work'}</h1><p>${esc(msg)}</p></body>`;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  // Seller unsubscribe (link in every follow-up email)
  if (req.method === 'GET' && req.query?.u) {
    const t = fuParse(req.query.u), k = t && ID.test(t[1]) ? `t/${t[0]}/leads/${t[1]}` : null, lead = k && await getDoc(k).catch(() => null);
    if (!lead) return res.status(400).setHeader('Content-Type', 'text/html; charset=utf-8').send(page(false, 'This unsubscribe link is invalid or expired. Reply to the email and ask to be removed.'));
    await putDoc(k, { ...lead, optOut: true, seq: { ...(lead.seq || {}), on: false, stoppedReason: 'unsubscribed' }, activity: [{ at: Date.now(), kind: 'auto', outcome: 'unsubscribed', note: 'Seller unsubscribed from follow-up emails' }, ...(lead.activity || [])].slice(0, 100), updatedAt: Date.now() });
    return res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(page(true, "You won't get any more follow-up emails about this property."));
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const actor = await getActor(req, b).catch(() => null);
  if (!actor || actor.owner) return res.status(401).json({ error: 'Log in again.' });
  if (!ID.test(String(b.id || ''))) return res.status(400).json({ error: 'Bad lead id.' });
  const k = `t/${actor.scope}/leads/${b.id}`, lead = await getDoc(k);
  if (!lead) return res.status(404).json({ error: 'Lead not found.' });
  const u = actor.user, biz = bizOf(u), settings = u.settings || {};
  if (!isActive(u) && !isOperator(u)) return res.status(402).json({ error: 'Choose a plan to use JStar AI. Go to Plan & account.' });

  try {
    if (b.action === 'offer' || b.action === 'reply') {
      const quota = await useQuota(actor, 'agent'); if (quota) return res.status(402).json({ error: quota });
      try {
        if (b.action === 'offer') {
          const channel = b.channel === 'email' ? 'email' : 'text', tone = ['friendly', 'direct', 'flexible'].includes(b.tone) ? b.tone : 'friendly';
          const out = await ask(RULES, `${facts(lead, biz)}\n\nWrite a ${tone} ${channel} making a cash offer at our opening offer${b.amount ? ` of $${Math.round(+b.amount).toLocaleString()}` : ''}. ${channel === 'text' ? 'Under 320 characters. No subject.' : 'Give a subject line and a short email body (under 150 words), signed with the buyer name, company and phone.'} Mention it's cash, as-is (no repairs) and they pick the closing date. Invite them to reply or call.
Return only JSON: {"subject": "...or empty for text", "body": "..."}`);
          const j = json(out); if (!j?.body) throw new Error('model');
          if (b.amount && lead.brief?.mao && +b.amount > lead.brief.mao) j.warning = `That's above your max offer of ${$$(lead.brief.mao)}.`;
          return res.status(200).json({ subject: str(j.subject, 140), body: str(j.body, 1500), warning: j.warning || null });
        }
        const msg = str(b.message, 2000); if (msg.length < 2) { await refundQuota(actor, 'agent'); return res.status(400).json({ error: "Paste what the seller said." }); }
        const out = await ask(RULES, `${facts(lead, biz)}\n\nThe seller just said:\n"""${msg}"""\n${b.goal ? `What I want: ${str(b.goal, 300)}\n` : ''}
Suggest 3 different replies I could send by text (each under 320 characters): one that holds our number, one that asks a question to learn more, and one that offers a creative or flexible option (closing date, leaving items behind, covering moving costs) without going above the maximum offer. Also give a one-sentence read on the seller and whether their ask is within our maximum.
Return only JSON: {"read": "...", "replies": [{"label": "Hold the number", "text": "..."}, {"label": "Ask a question", "text": "..."}, {"label": "Get creative", "text": "..."}]}`, 900);
        const j = json(out); if (!Array.isArray(j?.replies) || !j.replies.length) throw new Error('model');
        return res.status(200).json({ read: str(j.read, 400), replies: j.replies.slice(0, 3).map(r => ({ label: str(r.label, 40), text: str(r.text, 600) })) });
      } catch (e) { await refundQuota(actor, 'agent'); throw e; }
    }

    if (b.action === 'seqStatus' || b.action === 'seqOn' || b.action === 'seqOff') {
      const ghl = await getGhl(actor.scope).catch(() => null);
      const ch = { email: canEmail(lead), text: canText(lead, ghl), ghl: !!ghl, address: !!settings.address };
      let next = lead;
      if (b.action === 'seqOn') {
        if (lead.optOut) return res.status(400).json({ error: 'This seller unsubscribed, so follow-ups are off for good.' });
        if (['dead', 'converted'].includes(lead.status)) return res.status(400).json({ error: 'Follow-up only runs on open leads.' });
        if (!ch.email && !ch.text) return res.status(400).json({ error: ghl ? 'This lead has no email and didn’t agree to texts, so there’s no way to follow up automatically.' : 'This lead has no email. Connect GoHighLevel (Deals → Send to buyers → Text) to follow up by text with sellers who agreed to texts.' });
        if (ch.email && !ch.address) return res.status(400).json({ error: 'Add your business mailing address in Settings first. The law requires it in follow-up emails.' });
        next = await putDoc(k, startSeq(lead));
      }
      if (b.action === 'seqOff' && lead.seq?.on) next = await putDoc(k, { ...lead, seq: { ...lead.seq, on: false, stoppedReason: 'turned off' }, updatedAt: Date.now() });
      return res.status(200).json({ seq: next.seq || null, channels: ch, steps: STEPS, stop: next.seq?.on ? stopReason(next) : null, optOut: !!next.optOut });
    }

    if (b.action === 'email') { // send an AI-written (and user-edited) email to the seller
      if (!canEmail(lead)) return res.status(400).json({ error: 'This lead has no email address.' });
      if (lead.optOut) return res.status(400).json({ error: 'This seller unsubscribed from emails.' });
      if (!settings.address) return res.status(400).json({ error: 'Add your business mailing address in Settings first.' });
      const subject = str(b.subject, 140) || 'About your property', body = str(b.body, 3000); if (body.length < 5) return res.status(400).json({ error: 'Write the email first.' });
      const unsub = `https://${process.env.PUBLIC_HOST || 'getjstarpro.com'}/api/assist?u=${fuToken(actor.scope, lead.id)}`, addr = [biz.company, settings.address].filter(Boolean).join(' · ');
      await sendPlainEmail(lead.lead.email, subject, `${body}\n\n—\n${addr}\nUnsubscribe: ${unsub}`,
        `<div style="font:15px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d2433;max-width:560px">${esc(body).replace(/\n/g, '<br>')}<p style="margin-top:28px;font-size:12px;color:#8a93a3">${esc(addr)}<br><a href="${esc(unsub)}" style="color:#8a93a3">Unsubscribe</a></p></div>`,
        settings.notifyEmail || u.email, biz.company);
      const ev = { at: Date.now(), kind: 'email', outcome: 'emailed', note: subject };
      const next = await putDoc(k, { ...lead, status: lead.status === 'new' ? 'contacted' : lead.status, activity: [ev, ...(lead.activity || [])].slice(0, 100), lastContactAt: ev.at, updatedAt: Date.now() });
      return res.status(200).json({ lead: next });
    }
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    if (e.code === 503) return res.status(503).json({ error: e.message });
    console.error('assist', e);
    return res.status(502).json({ error: e.message === 'model' ? 'JStar AI had trouble with that. Try again.' : 'Something went wrong. Try again.' });
  }
}
