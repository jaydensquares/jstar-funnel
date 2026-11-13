// Cash buyers list and deal blasts: list / save / delete / import buyers, email a deal to chosen buyers.
// GET ?u=<token> unsubscribes one buyer (link in every blast email).
import crypto from 'node:crypto';
import { getActor } from '../lib/auth.js';
import { getDoc, putDoc, deleteDoc, listDocs, newId } from '../lib/db.js';
import { getDeal, saveDeal } from '../lib/store.js';
import { layout, p as P, small, rows as R, callout, button } from '../lib/email.js';

export const maxDuration = 60;
const ID = /^[a-z0-9]{6,32}$/;
const TYPES = ['flipper', 'landlord', 'builder', 'any'];
const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const num = v => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $$ = n => '$' + Math.round(n).toLocaleString();
const col = scope => (scope ? `t/${scope}/buyers` : 'buyers');
const sig = s => crypto.createHmac('sha256', process.env.SESSION_SECRET || 'x').update('unsub:' + s).digest('base64url').slice(0, 22);
const unsubToken = (scope, id) => Buffer.from(`${scope}|${id}`).toString('base64url') + '.' + sig(`${scope}|${id}`);

function cleanBuyer(b, prev = {}) {
  return {
    id: prev.id || newId(), createdAt: prev.createdAt || Date.now(), updatedAt: Date.now(),
    name: str(b.name, 80), company: str(b.company, 80), email: EMAIL.test(str(b.email, 120)) ? str(b.email, 120).toLowerCase() : '',
    phone: str(b.phone, 30), areas: str(b.areas, 300), maxPrice: num(b.maxPrice), minPrice: num(b.minPrice),
    type: TYPES.includes(b.type) ? b.type : 'any', notes: str(b.notes, 1000), unsub: !!prev.unsub, lastSent: prev.lastSent || null,
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');

  if (req.method === 'GET' && req.query?.u) { // one-click unsubscribe
    const [p, s] = String(req.query.u).split('.');
    let ok = false;
    try { const raw = Buffer.from(p, 'base64url').toString(); if (s && sig(raw) === s) { const [scope, id] = raw.split('|'); const k = `${col(scope)}/${id}`; const d = ID.test(id) && await getDoc(k); if (d) { await putDoc(k, { ...d, unsub: true, updatedAt: Date.now() }); ok = true; } } } catch {}
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(ok ? 200 : 400).send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;max-width:480px;margin:80px auto;padding:0 20px;color:#101828"><h1 style="font-size:22px">${ok ? 'You\'re unsubscribed' : 'That link didn\'t work'}</h1><p>${ok ? 'You won\'t get deal emails from this buyers list anymore.' : 'Reply to the email you got and ask to be removed.'}</p></body>`);
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const actor = await getActor(req, b).catch(() => null);
  if (!actor) return res.status(401).json({ error: 'Log in again.' });
  const sc = actor.scope, key = id => `${col(sc)}/${id}`;

  try {
    if (b.action === 'list') return res.status(200).json({ buyers: (await listDocs(col(sc))).sort((a, z) => (a.name || '').localeCompare(z.name || '')) });
    if (b.action === 'save') {
      const prev = b.buyer?.id && ID.test(b.buyer.id) ? await getDoc(key(b.buyer.id)) : null;
      const d = cleanBuyer(b.buyer || {}, prev || {});
      if (!d.name) return res.status(400).json({ error: 'Add a name.' });
      if (!d.email && !d.phone && !b.buyer?.found) return res.status(400).json({ error: 'Add an email or phone.' });
      return res.status(200).json({ buyer: await putDoc(key(d.id), d) });
    }
    if (b.action === 'delete') return res.status(200).json({ ok: ID.test(String(b.id || '')) && await deleteDoc(key(b.id)) });
    if (b.action === 'import') {
      const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 500).map(r => cleanBuyer(r)).filter(r => r.name && (r.email || r.phone));
      const have = new Set((await listDocs(col(sc))).map(x => x.email || x.phone));
      const fresh = rows.filter(r => !have.has(r.email || r.phone));
      for (let i = 0; i < fresh.length; i += 10) await Promise.all(fresh.slice(i, i + 10).map(r => putDoc(key(r.id), r)));
      return res.status(200).json({ added: fresh.length, skipped: rows.length - fresh.length });
    }

    if (b.action === 'blast') {
      const deal = await getDeal(String(b.dealId || ''), sc);
      if (!deal) return res.status(404).json({ error: 'Deal not found.' });
      const ids = new Set((Array.isArray(b.ids) ? b.ids : []).slice(0, 300));
      const to = (await listDocs(col(sc))).filter(x => ids.has(x.id) && x.email && !x.unsub);
      if (!to.length) return res.status(400).json({ error: 'Pick at least one buyer with an email.' });
      const key2 = process.env.RESEND_API_KEY; if (!key2) return res.status(503).json({ error: 'Email isn\'t set up yet.' });
      const a = deal.address || {}, n = deal.numbers || {}, biz = { ...(actor.biz || {}) };
      const price = num(b.price) || ((n.contractPrice || 0) + (n.assignmentFee || 0)) || null;
      const spread = n.arv && price ? n.arv - price - (n.repairs || 0) : null;
      const addr = [a.street, a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      const fmtPh = v => { const d = String(v || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(v || ''); };
      if (biz.phone) biz.phone = fmtPh(biz.phone);
      const subject = str(b.subject, 140) || `Off-market: ${a.street || 'deal'}${a.city ? ', ' + a.city : ''}${price ? ' · ' + $$(price) : ''}`;
      const note = str(b.note, 2000), showing = str(b.showing, 500);
      const fromAddr = (String(process.env.NOTIFY_FROM || '').match(/<([^>]+)>/) || [])[1] || process.env.NOTIFY_FROM || 'onboarding@resend.dev';
      const replyTo = (actor.member?.email || biz.email || actor.user?.email || process.env.NOTIFY_EMAIL || '').split(',')[0];
      const mailAddr = actor.user?.settings?.address || '';
      const rows = [['Price', price && $$(price)], ['ARV', n.arv && $$(n.arv)], ['Repairs (est.)', n.repairs && $$(n.repairs)], ['Potential spread', spread > 0 && $$(spread)], ['Property', deal.propertyType], ['Showings', showing]].filter(([, v]) => v);
      const body = x => {
        const unsub = `https://${req.headers['x-forwarded-host'] || req.headers.host}/api/buyers?u=${unsubToken(sc, x.id)}`;
        const hi = `Hi ${esc((x.name || '').split(' ')[0] || 'there')},`;
        return {
          from: `${biz.company || 'JStar Pro'} <${fromAddr}>`, to: [x.email], subject, ...(replyTo ? { reply_to: replyTo } : {}),
          headers: { 'List-Unsubscribe': `<${unsub}>` },
          text: `${hi.replace(/&amp;/g, '&')}\n\nNew off-market deal: ${addr}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}${note ? '\n\n' + note : ''}\n\nReply to this email or call ${biz.phone || ''} to lock it up. First come, first served.\n\n${biz.company || ''}${mailAddr ? '\n' + mailAddr : ''}\nUnsubscribe: ${unsub}`,
          html: layout({ brand: { name: biz.company || 'Off-market deals', sub: biz.phone ? `Call or text ${biz.phone}` : '' }, legal: false,
            preheader: `${price ? $$(price) + ' · ' : ''}${spread > 0 ? $$(spread) + ' potential spread · ' : ''}${addr}`,
            eyebrow: 'New off-market deal', title: esc(addr),
            body: P(hi) + P(`We just locked up an off-market property and you're one of the first buyers we're sending it to.`)
              + R(rows.map(([k, v]) => [k, esc(v)]))
              + (note ? callout(esc(note).replace(/\n/g, '<br>'), 'info') : '')
              + P(`Reply to this email${biz.phone ? ` or call <b>${esc(biz.phone)}</b>` : ''} to lock it up. First come, first served.`)
              + (replyTo ? button(`mailto:${replyTo}?subject=${encodeURIComponent('Re: ' + subject)}`, "I'm interested") : ''),
            footer: `${esc(biz.company || '')}${mailAddr ? '<br>' + esc(mailAddr) : ''}<br>You're receiving this because you're on our cash buyers list. <a href="${unsub}" style="color:#98a2b3;text-decoration:underline">Unsubscribe</a>` }),
        };
      };
      let sent = 0, failed = 0;
      for (let i = 0; i < to.length; i += 100) {
        const r = await fetch('https://api.resend.com/emails/batch', { method: 'POST', headers: { Authorization: `Bearer ${key2}`, 'Content-Type': 'application/json' }, body: JSON.stringify(to.slice(i, i + 100).map(body)) });
        if (r.ok) sent += Math.min(100, to.length - i); else { failed += Math.min(100, to.length - i); console.error('blast', r.status, (await r.text().catch(() => '')).slice(0, 300)); }
      }
      if (!sent) return res.status(502).json({ error: 'Emails didn\'t send. Check that your sending domain is verified.' });
      await saveDeal({ ...deal, blasts: [...(deal.blasts || []), { at: Date.now(), sent, price }].slice(-20), history: [...(deal.history || []), { at: Date.now(), text: `Sent to ${sent} buyer${sent > 1 ? 's' : ''}${price ? ' at ' + $$(price) : ''}` }] }, sc);
      return res.status(200).json({ sent, failed });
    }
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    console.error('buyers', e);
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
}
