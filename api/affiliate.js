// Affiliate program: join, see your link and earnings, update payout details. Clicks are counted from the sales page.
import { currentUser, sendPlainEmail } from '../lib/auth.js';
import { AFF, CODE, getAff, saveAff, affByCode, codeTaken, setCode, publicAff } from '../lib/affiliate.js';
import { layout, p as P, rows, button, esc as E } from '../lib/email.js';

export const maxDuration = 20;
const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const METHODS = ['paypal', 'zelle', 'venmo', 'cashapp'];
const BASE = () => process.env.PUBLIC_BASE_URL || 'https://getjstarpro.com';

function payoutFrom(b) {
  const method = str(b.method, 20).toLowerCase(), handle = str(b.handle, 120);
  if (!METHODS.includes(method)) return { error: 'Pick how you want to get paid.' };
  if (handle.length < 3) return { error: 'Enter your PayPal, Zelle, Venmo or Cash App handle.' };
  return { payout: { method, handle, name: str(b.payName, 80) } };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

  try {
    // Public: a visit through someone's link (the page calls this once per browser per code)
    if (b.action === 'click') {
      const a = await affByCode(b.code);
      if (a) await saveAff({ ...a, clicks: (a.clicks || 0) + 1 }).catch(() => {});
      return res.status(200).json({ ok: !!a });
    }

    const u = await currentUser(req).catch(() => null);
    if (!u) return res.status(401).json({ error: 'Log in again.' });
    const a = await getAff(u.id).catch(() => null);
    const out = x => res.status(200).json({ aff: publicAff(x), base: BASE(), suggested: u.slug, terms: AFF });

    if (b.action === 'me') return out(a);

    if (b.action === 'checkCode') {
      const code = str(b.code, 24).toLowerCase();
      if (!CODE.test(code)) return res.status(200).json({ ok: false, error: '3–24 letters, numbers or dashes.' });
      return res.status(200).json({ ok: !(await codeTaken(code, u.id)), error: 'That code is taken.' });
    }

    if (b.action === 'join') {
      if (a) return out(a);
      const code = str(b.code, 24).toLowerCase();
      if (!CODE.test(code)) return res.status(400).json({ error: 'Your link code: 3–24 letters, numbers or dashes.' });
      if (await codeTaken(code, u.id)) return res.status(409).json({ error: 'That code is taken. Try another.' });
      const p = payoutFrom(b); if (p.error) return res.status(400).json({ error: p.error });
      if (b.agree !== true) return res.status(400).json({ error: 'Check the box to agree to the Affiliate Terms.' });
      let n = { uid: u.id, name: u.name, email: u.email, company: u.company || '', status: 'active', payout: p.payout, clicks: 0, signups: 0, paying: 0, ledger: [], payouts: [], createdAt: Date.now(), agreed: { version: '2026-11-15', at: Date.now() } };
      n = await setCode(n, code); await saveAff(n);
      const link = `${BASE()}/?via=${code}`;
      await sendPlainEmail(u.email, 'Your JStar Pro affiliate link', `You're in. Share ${link} and earn ${AFF.rate * 100}% of what every customer you send pays for their first ${AFF.months} months.\n\nTrack clicks, signups and earnings any time: ${BASE()}/app#affiliate\n\nJStar Pro`,
        layout({ preheader: `Earn ${AFF.rate * 100}% for ${AFF.months} months on every customer you send.`, eyebrow: 'Affiliate program', title: "You're in. Here's your link.",
          body: P(`Share your link anywhere: YouTube, Instagram, TikTok, your coaching group or your buyers list. When someone signs up through it and pays, you earn <b>${AFF.rate * 100}%</b> of every payment for their first <b>${AFF.months} months</b>.`)
            + rows([['Your link', `<a href="${link}" style="color:#2f6fed;text-decoration:none">${E(link.replace('https://', ''))}</a>`], ['Commission', `${AFF.rate * 100}% for ${AFF.months} months`], ['Paid to', `${E(p.payout.method)} · ${E(p.payout.handle)}`]])
            + button(`${BASE()}/app#affiliate`, 'See your affiliate dashboard'),
          footer: 'You received this because you joined the JStar Pro affiliate program.' })).catch(() => {});
      return out(n);
    }

    if (!a) return res.status(404).json({ error: 'Join the affiliate program first.' });

    if (b.action === 'update') {
      let n = { ...a };
      if (b.method !== undefined) { const p = payoutFrom(b); if (p.error) return res.status(400).json({ error: p.error }); n.payout = p.payout; }
      if (b.code !== undefined) {
        const code = str(b.code, 24).toLowerCase();
        if (code !== a.code) {
          if (!CODE.test(code)) return res.status(400).json({ error: 'Your link code: 3–24 letters, numbers or dashes.' });
          if (await codeTaken(code, u.id)) return res.status(409).json({ error: 'That code is taken. Try another.' });
          n = await setCode(n, code);
        }
      }
      await saveAff(n);
      return out(n);
    }
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    console.error('affiliate', e);
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
}
