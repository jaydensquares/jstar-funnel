// Accounts: signup, login, logout, me, update settings, change password
import { planStatus } from '../lib/plan.js';
import { createUser, getUserByEmail, getUserBySlug, checkPassword, hashPassword, sessionCookie, clearCookie, currentUser, publicUser, saveUser, RESERVED, resetToken, userFromResetToken, sendPlainEmail } from '../lib/auth.js';

export const maxDuration = 20;
const slow = () => new Promise(r => setTimeout(r, 700));
const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (!process.env.SESSION_SECRET) return res.status(503).json({ error: 'Accounts aren\'t set up yet.' });

  if (req.method === 'GET') {
    if (req.query?.action !== 'me') return res.status(400).json({ error: 'Unknown action.' });
    const u = await currentUser(req).catch(() => null);
    return u ? res.status(200).json({ user: publicUser(u), plan: planStatus(u) }) : res.status(401).json({ error: 'Not logged in.' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!String(req.headers['content-type'] || '').includes('application/json')) return res.status(415).json({ error: 'JSON only' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

  try {
    if (b.action === 'signup') {
      const name = str(b.name, 80), email = str(b.email, 120).toLowerCase(), company = str(b.company, 80), phone = str(b.phone, 30);
      const slug = str(b.username, 30).toLowerCase();
      const password = String(b.password || '');
      if (!name || !company) return res.status(400).json({ error: 'Enter your name and business name.' });
      if (!EMAIL.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
      if (!/^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/.test(slug)) return res.status(400).json({ error: 'Username: 3–30 letters, numbers or dashes.' });
      if (RESERVED.has(slug)) return res.status(400).json({ error: 'That username is taken.' });
      if (password.length < 8) return res.status(400).json({ error: 'Password needs at least 8 characters.' });
      if (String(phone).replace(/\D/g, '').length < 10) return res.status(400).json({ error: 'Enter a 10-digit phone number for your funnel.' });
      if (await getUserByEmail(email)) { await slow(); return res.status(409).json({ error: 'An account with that email already exists. Log in instead.' }); }
      if (await getUserBySlug(slug)) return res.status(409).json({ error: 'That username is taken.' });
      const u = await createUser({ name, email, password, company, slug, phone });
      res.setHeader('Set-Cookie', sessionCookie(u.id, 0));
      return res.status(200).json({ user: publicUser(u), plan: planStatus(u) });
    }

    if (b.action === 'login') {
      const u = await getUserByEmail(str(b.email, 120).toLowerCase());
      if (!u || u.disabled || !checkPassword(String(b.password || ''), u.passHash)) { await slow(); return res.status(401).json({ error: 'Wrong email or password.' }); }
      res.setHeader('Set-Cookie', sessionCookie(u.id, u.sessVer || 0));
      return res.status(200).json({ user: publicUser(u), plan: planStatus(u) });
    }

    if (b.action === 'forgot') {
      // Same answer whether or not the account exists, so emails can't be probed
      const done = () => res.status(200).json({ ok: true });
      const u = await getUserByEmail(str(b.email, 120).toLowerCase());
      if (!u || u.disabled) { await slow(); return done(); }
      const link = `https://${req.headers['x-forwarded-host'] || req.headers.host}/reset?t=${resetToken(u)}`;
      const first = (u.name || '').split(' ')[0] || 'there';
      await sendPlainEmail(u.email, 'Reset your JStar Pro password',
        `Hi ${first},\n\nSomeone asked to reset the password for your JStar Pro account. Open this link within the next hour to choose a new one:\n\n${link}\n\nIf you didn't ask for this, ignore this email. Your password won't change.`,
        `<p>Hi ${first},</p><p>Someone asked to reset the password for your JStar Pro account. Use the button below within the next hour to choose a new one.</p><p><a href="${link}" style="display:inline-block;background:#1a3f8f;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">Choose a new password</a></p><p style="color:#666;font-size:13px">If you didn't ask for this, ignore this email. Your password won't change.</p>`
      ).catch(e => console.error('reset email', e.message));
      return done();
    }

    if (b.action === 'reset') {
      const u = await userFromResetToken(b.token);
      if (!u) { await slow(); return res.status(400).json({ error: 'This reset link has expired or was already used. Request a new one.' }); }
      if (String(b.password || '').length < 8) return res.status(400).json({ error: 'Password needs at least 8 characters.' });
      const saved = await saveUser({ ...u, passHash: hashPassword(b.password), sessVer: (u.sessVer || 0) + 1 });
      res.setHeader('Set-Cookie', sessionCookie(saved.id, saved.sessVer));
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'logout') { res.setHeader('Set-Cookie', clearCookie()); return res.status(200).json({ ok: true }); }

    const u = await currentUser(req);
    if (!u) return res.status(401).json({ error: 'Not logged in.' });

    if (b.action === 'update') {
      const s = b.settings || {};
      const fix = (v, re, n) => { const x = str(v, n); return !x || re.test(x) ? x : null; };
      const next = {
        name: str(b.name ?? u.name, 80) || u.name, company: str(b.company ?? u.company, 80) || u.company, phone: str(b.phone ?? u.phone, 30) || u.phone,
        settings: {
          ...u.settings,
          notifyEmail: EMAIL.test(str(s.notifyEmail, 120)) ? str(s.notifyEmail, 120).toLowerCase() : u.settings.notifyEmail,
          address: str(s.address ?? u.settings.address, 160),
          metaPixelId: fix(s.metaPixelId ?? '', /^\d{6,20}$/, 20),
          metaCapiToken: str(s.metaCapiToken ?? u.settings.metaCapiToken, 400),
          googleAdsId: fix(s.googleAdsId ?? '', /^(AW|G)-[A-Z0-9]{4,20}$/i, 24),
          googleAdsLeadLabel: fix(s.googleAdsLeadLabel ?? '', /^[A-Za-z0-9_-]{4,40}$/, 40),
        },
      };
      const bad = Object.entries({ 'Meta Pixel ID (numbers only)': next.settings.metaPixelId, 'Google tag ID (like AW-123456789)': next.settings.googleAdsId, 'Google conversion label': next.settings.googleAdsLeadLabel }).find(([, v]) => v === null);
      if (bad) return res.status(400).json({ error: `Check your ${bad[0]}.` });
      const saved = await saveUser({ ...u, ...next });
      return res.status(200).json({ user: publicUser(saved), plan: planStatus(saved) });
    }

    if (b.action === 'password') {
      if (!checkPassword(String(b.current || ''), u.passHash)) { await slow(); return res.status(401).json({ error: 'Current password is wrong.' }); }
      if (String(b.password || '').length < 8) return res.status(400).json({ error: 'New password needs at least 8 characters.' });
      const saved = await saveUser({ ...u, passHash: hashPassword(b.password), sessVer: (u.sessVer || 0) + 1 });
      res.setHeader('Set-Cookie', sessionCookie(saved.id, saved.sessVer));
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    console.error('auth', e);
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
}
