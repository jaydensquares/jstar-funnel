// Agent offers (see lib/agentoffers.js). POST JSON { action, ... }:
//   sender / saveSender     the user's sending address on our domain
//   search                  active listings in a ZIP or city with a listing agent email
//   underwrite              value + offer for up to 20 listings (1 "agent offer" each from the plan)
//   create                  start a campaign: queue the offers and send today's share right away
//   list / get / pause / resume / delete / preview
// GET ?u=<token> opts an agent out of every JStar Pro sender.
import crypto from 'node:crypto';
import { getActor } from '../lib/auth.js';
import { useQuota, refundQuota } from '../lib/usage.js';
import { getDoc, putDoc, deleteDoc, listDocs, newId } from '../lib/db.js';
import * as AO from '../lib/agentoffers.js';

export const maxDuration = 120;
const ID = /^[a-z0-9]{6,32}$/;
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/i;
const str = (v, n = 120) => String(v ?? '').trim().slice(0, n);
const num = v => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };
const sign = it => crypto.createHmac('sha256', process.env.SESSION_SECRET || 'x').update(`ao|${it.lid}|${it.address}|${it.agent?.email}`).digest('base64url').slice(0, 20);
const originOf = req => `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
const pub = c => ({ id: c.id, name: c.name, status: c.status, createdAt: c.createdAt, doneAt: c.doneAt || null, counts: AO.counts(c), total: c.items.length, today: AO.sentToday(c), dailyCap: c.settings.dailyCap });

function optPage(res, ok) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(ok ? 200 : 400).send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title><body style="font:16px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:80px auto;padding:0 20px;color:#1c1c1c"><h1 style="font-size:22px">${ok ? "You're unsubscribed" : 'That link didn\'t work'}</h1><p>${ok ? "You won't get any more offer emails sent through JStar Pro." : 'Reply STOP to the email instead and the sender will remove you.'}</p></body>`);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method === 'GET' || (req.method === 'POST' && req.query?.u)) {
    const email = AO.optEmail(req.query?.u);
    if (email) await putDoc(`aoopt/${AO.hash(email)}`, { at: Date.now() }, { keep: 1 }).catch(() => {});
    return optPage(res, !!email);
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const actor = await getActor(req, b).catch(() => null);
  if (!actor) { await new Promise(r => setTimeout(r, 900)); return res.status(401).json({ error: b.pin ? 'Wrong PIN.' : 'Log in again.' }); }
  const sc = actor.scope, B = AO.base(sc), action = b.action;
  try {
    if (action === 'sender') {
      const s = await AO.getSender(sc), u = actor.user || {};
      return res.status(200).json({
        domain: AO.offersDomain(),
        sender: s ? { ...s, email: `${s.handle}@${AO.offersDomain()}` } : null,
        suggest: { handle: AO.cleanHandle((u.name || actor.biz?.signer || '').split(/\s+/)[0]), name: u.name || actor.biz?.signer || '', replyTo: actor.member?.email || u.email || '', company: actor.biz?.company || '', phone: actor.biz?.phone || u.phone || '', address: u.settings?.address || '' },
        defaults: { ...AO.DEFAULTS, subject: AO.DEFAULT_SUBJECT, message: AO.DEFAULT_MESSAGE },
      });
    }
    if (action === 'saveSender') {
      if (!EMAIL.test(str(b.replyTo))) return res.status(400).json({ error: 'Add the email where agent replies should go.' });
      if (str(b.address, 160).length < 8) return res.status(400).json({ error: 'Add your business mailing address. The law requires it on offer emails.' });
      if (!str(b.name, 60)) return res.status(400).json({ error: 'Add the name agents will see.' });
      const r = await AO.saveSender(sc, b);
      return res.status(r.error ? 400 : 200).json(r);
    }

    if (action === 'search') {
      const zip = str(b.zip, 5).replace(/\D/g, ''), city = str(b.city, 60), state = str(b.state, 2).toUpperCase();
      if (zip.length !== 5 && !(city && /^[A-Z]{2}$/.test(state))) return res.status(400).json({ error: 'Enter a 5-digit ZIP, or a city and state.' });
      const r = await AO.searchListings({ zip: zip.length === 5 ? zip : '', city, state, minPrice: num(b.minPrice), maxPrice: num(b.maxPrice), minDom: num(b.minDom), minBeds: num(b.minBeds), types: Array.isArray(b.types) ? b.types.slice(0, 5) : [] });
      const done = new Set((await listDocs(`${B}/aoc`).catch(() => [])).flatMap(c => c.items.filter(i => ['sent', 'queued'].includes(i.status)).map(i => i.lid)));
      r.listings.forEach(l => { if (done.has(l.lid)) l.already = true; });
      return res.status(200).json(r);
    }

    if (action === 'underwrite') {
      const s = AO.cleanSettings(b.settings);
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 20).map(x => ({
        lid: str(x.lid || x.address, 120), address: str(x.address, 160), street: str(x.street || String(x.address || '').split(',')[0], 100), city: str(x.city, 60), state: str(x.state, 2).toUpperCase(), zip: str(x.zip, 10),
        type: str(x.type, 30), beds: num(x.beds), baths: Number(x.baths) || null, sqft: num(x.sqft), yearBuilt: num(x.yearBuilt), list: num(x.list), dom: num(x.dom),
        agent: { name: str(x.agent?.name, 80), email: str(x.agent?.email, 120).toLowerCase(), phone: str(x.agent?.phone, 30) }, office: str(x.office, 80),
      })).filter(x => x.address.length > 6 && EMAIL.test(x.agent.email));
      if (!items.length) return res.status(400).json({ error: 'No listings with an address and agent email to underwrite.' });
      const q = await useQuota(actor, 'offers', items.length); if (q) return res.status(402).json({ error: q });
      const out = []; let failed = 0;
      for (let i = 0; i < items.length; i += 5) {
        const r = await Promise.allSettled(items.slice(i, i + 5).map(x => AO.underwrite(x, s)));
        r.forEach((v, k) => { if (v.status === 'fulfilled') out.push(v.value); else { failed++; out.push({ ...items[i + k], skip: 'No value data for this address', offer: null }); } });
      }
      if (failed) await refundQuota(actor, 'offers', failed);
      return res.status(200).json({ items: out.map(x => ({ ...x, sig: sign(x) })), charged: items.length - failed });
    }

    if (action === 'preview') {
      const snd = await AO.getSender(sc) || { handle: 'you', name: actor.biz?.signer || '' };
      const s = AO.cleanSettings(b.settings), it = b.item || {};
      const e = AO.buildEmail({ ...it, agent: { name: str(it.agent?.name, 80), email: 'agent@example.com' }, offer: num(it.offer) || 0 }, snd, s, originOf(req));
      return res.status(200).json({ from: e.from, replyTo: e.reply_to || '', subject: e.subject, text: e.text });
    }

    if (action === 'create') {
      const snd = await AO.getSender(sc);
      if (!snd?.handle) return res.status(400).json({ error: 'Set up your sending email first.' });
      const s = AO.cleanSettings(b.settings);
      const seen = new Set();
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 1000).filter(x => x && x.sig === sign(x) && num(x.offer)).map(x => {
        const k = x.agent.email + '|' + x.lid; if (seen.has(k)) return null; seen.add(k);
        return { lid: x.lid, address: x.address, street: x.street, city: x.city, state: x.state, zip: x.zip, list: num(x.list), arv: num(x.arv), repairs: num(x.repairs), offer: num(x.offer), beds: x.beds, baths: x.baths, sqft: x.sqft, dom: x.dom, agent: x.agent, office: x.office, status: 'queued' };
      }).filter(Boolean);
      if (!items.length) return res.status(400).json({ error: 'Pick at least one underwritten listing with an offer.' });
      const c = { id: newId(), name: str(b.name, 80) || `Offers ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, status: 'sending', settings: s, items, createdAt: Date.now() };
      await putDoc(`${B}/aoc/${c.id}`, c, { keep: 2 });
      await putDoc(`aoactive/${AO.activeKey(sc)}`, { scope: sc, at: Date.now() }, { keep: 1 });
      const r = await AO.sendDue(sc, originOf(req));
      const fresh = await getDoc(`${B}/aoc/${c.id}`);
      return res.status(200).json({ campaign: pub(fresh || c), sentNow: r.sent });
    }

    if (action === 'list') {
      const all = (await listDocs(`${B}/aoc`).catch(() => [])).sort((a, z) => z.createdAt - a.createdAt);
      return res.status(200).json({ campaigns: all.map(pub) });
    }
    const id = String(b.id || '');
    if (['get', 'pause', 'resume', 'delete'].includes(action)) {
      if (!ID.test(id)) return res.status(400).json({ error: 'Missing campaign.' });
      const c = await getDoc(`${B}/aoc/${id}`); if (!c) return res.status(404).json({ error: 'Campaign not found.' });
      if (action === 'get') return res.status(200).json({ campaign: { ...pub(c), settings: c.settings, items: c.items } });
      if (action === 'delete') { await deleteDoc(`${B}/aoc/${id}`); return res.status(200).json({ ok: true }); }
      if (action === 'pause' && c.status === 'sending') c.status = 'paused';
      if (action === 'resume' && c.status === 'paused') { c.status = 'sending'; await putDoc(`aoactive/${AO.activeKey(sc)}`, { scope: sc, at: Date.now() }, { keep: 1 }); }
      await putDoc(`${B}/aoc/${id}`, { ...c, updatedAt: Date.now() }, { keep: 2 });
      if (action === 'resume') await AO.sendDue(sc, originOf(req));
      return res.status(200).json({ campaign: pub(await getDoc(`${B}/aoc/${id}`) || c) });
    }
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    console.error('offers', e);
    return res.status(500).json({ error: e.message && /Try again|isn't set up|No active/.test(e.message) ? e.message : 'Something went wrong. Try again.' });
  }
}
