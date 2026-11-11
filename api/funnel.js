// Serves a user's seller funnel (and its privacy/terms pages), branded from their account.
// Reached via /f/<username>[/privacy|/terms] or, on a connected custom domain, via middleware.
import { isActive } from '../lib/plan.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getUserBySlug, getUserByHost } from '../lib/auth.js';

const cache = {};
const file = name => (cache[name] ||= readFileSync(join(process.cwd(), name), 'utf8'));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const js = v => JSON.stringify(v).replace(/</g, '\\u003c');
const telHref = p => 'tel:+1' + String(p || '').replace(/\D/g, '').slice(-10);

const OWNER_ADDR = '45704 Corte Mislanca, Temecula, CA 92592';
const OWNER_TEL = 'tel:+18328330125';

function brandSpan(brand) {
  const parts = esc(brand).split(' ');
  return parts.length > 1 ? `${parts[0]} <span>${parts.slice(1).join(' ')}</span>` : parts[0];
}

function renderFunnel(u, base) {
  const brand = u.company || u.name, s = u.settings || {};
  let h = file('offer.html');
  const SITE = { brand, phone: u.phone, metaPixelId: s.metaPixelId || '', googleAdsId: s.googleAdsId || '', googleAdsLeadLabel: s.googleAdsLeadLabel || '', demo: false, tenant: u.slug, base, address: s.address || '' };
  h = h.replace(/window\.SITE = \{[\s\S]*?\n  \};/, `window.SITE = ${js(SITE)};`);
  h = h.replace(/<title>[^<]*<\/title>/, `<title>Get a Cash Offer | ${esc(brand)}</title>`);
  h = h.replace('aria-label="JStar Acquisitions home"', `aria-label="${esc(brand)} home"`);
  h = h.replace('<a class="logo" href="/"', `<a class="logo" href="${base || '/'}"`);
  // Policy links → this user's pages; drop the owner-only contact page
  h = h.replaceAll('/privacy.html', `${base}/privacy`).replaceAll('/terms.html', `${base}/terms`);
  h = h.replace(' &nbsp;·&nbsp; <a href="/contact.html">Contact</a>', '');
  // Footer address line uses the user's details
  h = h.replace(`<p><b>\${S.brand}</b> · ${OWNER_ADDR} · <a href="tel:+18328330125">(832) 833-0125</a></p>`,
    '<p><b>${S.brand}</b>${S.address ? " · " + S.address : ""} · <a href="tel:+1${S.phone.replace(/\\D/g, "").slice(-10)}">${S.phone}</a></p>');
  // Route the lead to this user's account
  h = h.replace('body.pageUrl = location.href;', 'body.pageUrl = location.href;\n    body.tenant = S.tenant;');
  // Remove the owner's GoHighLevel tracking + its native-submit hook
  h = h.replace(/<!-- GoHighLevel external tracking -->\s*<script[\s\S]*?<\/script>/, '');
  return h;
}

function renderPolicy(name, u, base) {
  const brand = u.company || u.name, addr = u.settings?.address || '';
  let h = file(name);
  h = h.replace('<a href="/">JStar <span>Acquisitions</span></a>', `<a href="${base || '/'}">${brandSpan(brand)}</a>`);
  h = h.replaceAll(`<a href="tel:+18328330125">(832) 833-0125</a>`, `<a href="${telHref(u.phone)}">${esc(u.phone)}</a>`);
  h = h.replaceAll(`JStar Acquisitions<br>${OWNER_ADDR}<br>`, `${esc(brand)}<br>${addr ? esc(addr) + '<br>' : ''}`);
  h = h.replaceAll(`JStar Acquisitions · ${OWNER_ADDR} · `, `${esc(brand)}${addr ? ' · ' + esc(addr) : ''} · `);
  h = h.replaceAll('JStar Acquisitions', esc(brand));
  h = h.replaceAll('/privacy.html', `${base}/privacy`).replaceAll('/terms.html', `${base}/terms`);
  h = h.replace(' &nbsp;·&nbsp; <a href="/contact.html">Contact</a>', '').replace('<a href="/">Home</a>', `<a href="${base || '/'}">Home</a>`);
  return h;
}

export default async function handler(req, res) {
  const q = req.query || {};
  const page = ['privacy', 'terms'].includes(q.page) ? q.page : 'funnel';
  let u = null, base = '';
  try {
    if (q.slug) { u = await getUserBySlug(String(q.slug).toLowerCase()); base = `/f/${String(q.slug).toLowerCase()}`; }
    else u = await getUserByHost(q.host || req.headers['x-forwarded-host'] || req.headers.host);
  } catch (e) { console.error('funnel lookup', e); }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!isActive(u)) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).send('<!doctype html><meta name="viewport" content="width=device-width"><title>Not found</title><p style="font:16px system-ui;padding:40px;text-align:center">This page isn\'t set up.</p>');
  }
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  const html = page === 'funnel' ? renderFunnel(u, base) : renderPolicy(page === 'privacy' ? 'privacy.html' : 'terms.html', u, base);
  return res.status(200).send(html);
}
