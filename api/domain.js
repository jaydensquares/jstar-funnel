// Connect a user's own domain to their funnel (paid add-on).
// With VERCEL_TOKEN set, domains are added to this Vercel project automatically; otherwise the
// request is saved and the owner is emailed to add it by hand.
import { currentUser, saveUser } from '../lib/auth.js';
import { getDoc, putDoc, deleteDoc } from '../lib/db.js';
import { hasCustomDomain, billingReady, planStatus } from '../lib/plan.js';

const PROJECT = process.env.VERCEL_PROJECT_ID_FOR_DOMAINS || 'prj_HFqbTRkTUiddw95yD5WuyNiyZB54';
const TEAM = process.env.VERCEL_TEAM_ID_FOR_DOMAINS || 'team_KawbQc8YndyEwVaEQdQ1yvzy';
const DOMAIN = /^(?=.{4,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,24}$/;
const BLOCK = /(^|\.)(jstaracquire\.com|vercel\.app|vercel\.com|google\.com|facebook\.com)$/;
const RECORDS = apex => [
  { type: 'A', name: '@', value: '76.76.21.21', note: `for ${apex}` },
  { type: 'CNAME', name: 'www', value: 'cname.vercel-dns.com', note: `for www.${apex}` },
];

async function vercel(method, path, body) {
  const r = await fetch(`https://api.vercel.com${path}${path.includes('?') ? '&' : '?'}teamId=${TEAM}`, {
    method, headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

async function emailOwner(subject, text) {
  const key = process.env.RESEND_API_KEY, to = process.env.NOTIFY_EMAIL;
  if (!key || !to) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.NOTIFY_FROM || 'Leads <onboarding@resend.dev>', to: to.split(',')[0].trim(), subject, text }),
  }).catch(() => {});
}

const view = u => ({ entitled: hasCustomDomain(u), billingReady: billingReady('domain'), hasBilling: !!u.stripeCustomerId, domain: u.domain || null, auto: !!process.env.VERCEL_TOKEN, plan: planStatus(u) });

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!String(req.headers['content-type'] || '').includes('application/json')) return res.status(415).json({ error: 'JSON only' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  let u = await currentUser(req).catch(() => null);
  if (!u) return res.status(401).json({ error: 'Log in again.' });

  try {
    if (b.action === 'status') return res.status(200).json(view(u));

    if (b.action === 'connect') {
      if (!hasCustomDomain(u)) return res.status(402).json({ error: 'Custom domains come with Pro and Team, or as an add-on to Starter.' });
      if (u.domain?.name) return res.status(400).json({ error: 'Remove your current domain first.' });
      const apex = String(b.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
      if (!DOMAIN.test(apex) || BLOCK.test(apex)) return res.status(400).json({ error: 'Enter a domain like sellmyhousefast.com' });
      const taken = await getDoc(`idx/host/${apex}`);
      if (taken && taken.uid !== u.id) return res.status(409).json({ error: 'That domain is already connected to another account.' });

      let status = 'requested', verification = [];
      if (process.env.VERCEL_TOKEN) {
        const a = await vercel('POST', `/v10/projects/${PROJECT}/domains`, { name: apex });
        if (!a.ok && a.j?.error?.code !== 'domain_already_in_use_by_project' && a.status !== 409) {
          console.error('vercel add domain', a.status, a.j);
          return res.status(400).json({ error: a.j?.error?.message || 'Could not add that domain.' });
        }
        await vercel('POST', `/v10/projects/${PROJECT}/domains`, { name: `www.${apex}`, redirect: apex });
        verification = a.j?.verification || [];
        status = 'pending';
      } else {
        await emailOwner(`Add domain: ${apex}`, `${u.name} (${u.email}, @${u.slug}) connected ${apex}.\nAdd ${apex} and www.${apex} (redirect to apex) to the jstar-funnel Vercel project.`);
      }
      await putDoc(`idx/host/${apex}`, { uid: u.id });
      u = await saveUser({ ...u, domain: { name: apex, status, records: RECORDS(apex), verification, at: Date.now() } });
      return res.status(200).json(view(u));
    }

    if (b.action === 'check') {
      if (!u.domain?.name) return res.status(200).json(view(u));
      let status = u.domain.status;
      if (process.env.VERCEL_TOKEN) {
        const [d, c] = await Promise.all([
          vercel('GET', `/v9/projects/${PROJECT}/domains/${u.domain.name}`),
          vercel('GET', `/v6/domains/${u.domain.name}/config`),
        ]);
        if (d.ok && d.j.verified === false && d.j.verification?.length) { status = 'verify'; u.domain.verification = d.j.verification; }
        else if (c.ok) status = c.j.misconfigured ? 'pending' : 'live';
      }
      u = await saveUser({ ...u, domain: { ...u.domain, status, checkedAt: Date.now() } });
      return res.status(200).json(view(u));
    }

    if (b.action === 'remove') {
      const name = u.domain?.name;
      if (name) {
        if (process.env.VERCEL_TOKEN) {
          await vercel('DELETE', `/v9/projects/${PROJECT}/domains/www.${name}`);
          await vercel('DELETE', `/v9/projects/${PROJECT}/domains/${name}`);
        } else await emailOwner(`Remove domain: ${name}`, `${u.email} removed ${name}. Remove it from the Vercel project.`);
        const ix = await getDoc(`idx/host/${name}`);
        if (ix?.uid === u.id) await deleteDoc(`idx/host/${name}`);
      }
      u = await saveUser({ ...u, domain: null });
      return res.status(200).json(view(u));
    }
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    console.error('domain', e);
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
}
