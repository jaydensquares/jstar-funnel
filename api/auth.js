// Accounts: signup, login, logout, me, update settings, change password
import crypto from 'node:crypto';
import { planStatus, seatsOf, isActive } from '../lib/plan.js';
import { getUsage } from '../lib/usage.js';
import { getDoc, putDoc } from '../lib/db.js';
import { teamOwner, getUserById, createUser, getUserByEmail, getUserBySlug, checkPassword, hashPassword, sessionCookie, clearCookie, currentUser, publicUser, saveUser, RESERVED, resetToken, userFromResetToken, sendPlainEmail } from '../lib/auth.js';

export const maxDuration = 20;
const slow = () => new Promise(r => setTimeout(r, 700));
const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (!process.env.SESSION_SECRET) return res.status(503).json({ error: 'Accounts aren\'t set up yet.' });

  if (req.method === 'GET') {
    if (req.query?.action !== 'me') return res.status(400).json({ error: 'Unknown action.' });
    const u = await currentUser(req).catch(() => null);
    if (!u) return res.status(401).json({ error: 'Not logged in.' });
    // Team members see the team owner's plan and usage
    const o = u.memberOf ? await teamOwner(u) : null;
    if (u.memberOf && !o) return res.status(200).json({ user: { ...publicUser(u), team: { removed: true } }, plan: { ...planStatus(null), name: 'No access' } });
    const acct = o || u;
    const usage = req.query?.usage ? await getUsage(acct).catch(() => null) : undefined;
    const user = o ? { ...publicUser(u), team: { owner: o.name, company: o.company, slug: o.slug, ownerDomain: o.domain || null } } : publicUser(u);
    return res.status(200).json({ user, plan: planStatus(acct), usage });
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
      if (b.agree !== true) return res.status(400).json({ error: 'Check the box to agree to the Terms and Privacy Policy.' });
      if (await getUserByEmail(email)) { await slow(); return res.status(409).json({ error: 'An account with that email already exists. Log in instead.' }); }
      if (await getUserBySlug(slug)) return res.status(409).json({ error: 'That username is taken.' });
      const u0 = await createUser({ name, email, password, company, slug, phone });
      // Referral: ?ref=<username> of an account with a plan
      const ref = /^[a-z0-9-]{3,30}$/.test(str(b.ref, 30).toLowerCase()) ? await getUserBySlug(str(b.ref, 30).toLowerCase()).catch(() => null) : null;
      const okRef = ref && ref.id !== u0.id && isActive(ref);
      const u = await saveUser({ ...u0, terms: { version: '2026-11-11', at: Date.now() }, ...(okRef ? { referredBy: ref.id } : {}) });
      if (okRef) { const r = await getUserById(ref.id); if (r) await saveUser({ ...r, refStats: { ...(r.refStats || {}), signups: (r.refStats?.signups || 0) + 1 } }).catch(() => {}); }
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

    if (b.action === 'support') {
      // Support form → saved, then emailed to the owner with reply-to set to the sender
      if (b.web) return res.status(200).json({ ok: true }); // honeypot
      const name = str(b.name, 80), email = str(b.email, 120).toLowerCase(), topic = str(b.topic, 60), message = str(b.message, 4000);
      if (!name || !EMAIL.test(email)) return res.status(400).json({ error: 'Enter your name and a valid email.' });
      if (message.length < 5) return res.status(400).json({ error: 'Add a message.' });
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
      const rk = `rl/support/${crypto.createHash('sha256').update(ip).digest('hex').slice(0, 24)}`;
      const rl = await getDoc(rk).catch(() => null), hour = Math.floor(Date.now() / 36e5);
      const n = rl?.hour === hour ? rl.n : 0;
      if (n >= 5) return res.status(429).json({ error: 'Too many messages. Try again in an hour.' });
      await putDoc(rk, { hour, n: n + 1 }, { keep: 1 }).catch(() => {});
      const me = await currentUser(req).catch(() => null);
      const id = `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
      const doc = { id, at: Date.now(), name, email, topic, message, uid: me?.id || null, company: me?.company || null, plan: me?.plan?.tier || null };
      await putDoc(`support/${id}`, doc, { keep: 1 }).catch(e => console.error('support save', e.message));
      const to = process.env.SUPPORT_EMAIL || process.env.NOTIFY_EMAIL;
      if (to) await sendPlainEmail(to, `[JStar Pro support] ${topic}: ${name}`,
        `${message}\n\nFrom: ${name} <${email}>${me ? `\nAccount: ${me.company} (${me.plan?.tier || 'no plan'})` : ''}\nTopic: ${topic}\nReply to this email to answer them.`,
        undefined, email).catch(e => console.error('support email', e.message));
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'inviteInfo') {
      const inv = /^[a-f0-9]{32}$/.test(String(b.token || '')) ? await getDoc(`invites/${b.token}`).catch(() => null) : null;
      if (!inv || inv.used || Date.now() - inv.at > 14 * 864e5) return res.status(404).json({ error: 'This invite has expired or was already used. Ask for a new one.' });
      const o = await getUserById(inv.owner);
      return o ? res.status(200).json({ company: o.company, owner: o.name, email: inv.email }) : res.status(404).json({ error: 'Invite not found.' });
    }
    if (b.action === 'join') {
      const inv = /^[a-f0-9]{32}$/.test(String(b.token || '')) ? await getDoc(`invites/${b.token}`).catch(() => null) : null;
      if (!inv || inv.used || Date.now() - inv.at > 14 * 864e5) return res.status(400).json({ error: 'This invite has expired or was already used. Ask for a new one.' });
      const o = await getUserById(inv.owner);
      if (!o || o.disabled) return res.status(400).json({ error: 'That team is no longer active.' });
      if ((o.team || []).length >= seatsOf(o)) return res.status(400).json({ error: 'That team is full. Ask the owner to free up a seat.' });
      const name = str(b.name, 80), email = str(b.email, 120).toLowerCase(), password = String(b.password || '');
      if (!name) return res.status(400).json({ error: 'Enter your name.' });
      if (!EMAIL.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
      if (password.length < 8) return res.status(400).json({ error: 'Password needs at least 8 characters.' });
      if (b.agree !== true) return res.status(400).json({ error: 'Check the box to agree to the Terms and Privacy Policy.' });
      if (await getUserByEmail(email)) { await slow(); return res.status(409).json({ error: 'An account with that email already exists. Use a different email for your team login.' }); }
      const slug = 'm-' + crypto.randomBytes(5).toString('hex');
      const m0 = await createUser({ name, email, password, company: o.company, slug, phone: o.phone || '' });
      const m = await saveUser({ ...m0, memberOf: o.id, terms: { version: '2026-11-11', at: Date.now() } });
      await saveUser({ ...o, team: [...(o.team || []), { uid: m.id, name, email, at: Date.now() }] });
      await putDoc(`invites/${b.token}`, { ...inv, used: Date.now(), uid: m.id }, { keep: 1 });
      res.setHeader('Set-Cookie', sessionCookie(m.id, 0));
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
          emailReminders: s.emailReminders === undefined ? u.settings.emailReminders !== false : !!s.emailReminders,
          emailRecap: s.emailRecap === undefined ? u.settings.emailRecap !== false : !!s.emailRecap,
        },
      };
      const bad = Object.entries({ 'Meta Pixel ID (numbers only)': next.settings.metaPixelId, 'Google tag ID (like AW-123456789)': next.settings.googleAdsId, 'Google conversion label': next.settings.googleAdsLeadLabel }).find(([, v]) => v === null);
      if (bad) return res.status(400).json({ error: `Check your ${bad[0]}.` });
      const saved = await saveUser({ ...u, ...next });
      return res.status(200).json({ user: publicUser(saved), plan: planStatus(saved) });
    }

    if (b.action === 'invite' || b.action === 'removeMember') {
      if (u.memberOf) return res.status(403).json({ error: 'Only the account owner can manage the team.' });
      if (b.action === 'removeMember') {
        const team = (u.team || []).filter(m => m.uid !== b.uid);
        const m = await getUserById(String(b.uid || ''));
        if (m?.memberOf === u.id) await saveUser({ ...m, memberOf: null, disabled: true, sessVer: (m.sessVer || 0) + 1 });
        const saved = await saveUser({ ...u, team });
        return res.status(200).json({ user: publicUser(saved) });
      }
      const seats = seatsOf(u), email = str(b.email, 120).toLowerCase();
      if (!seats) return res.status(403).json({ error: 'Team logins come with the Agency plan.' });
      if ((u.team || []).length >= seats) return res.status(400).json({ error: `Your plan includes ${seats} team logins and they're all in use.` });
      if (!EMAIL.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
      const token = crypto.randomBytes(16).toString('hex');
      await putDoc(`invites/${token}`, { owner: u.id, email, at: Date.now() }, { keep: 1 });
      const link = `https://${req.headers['x-forwarded-host'] || req.headers.host}/signup?invite=${token}`;
      await sendPlainEmail(email, `${u.name} invited you to ${u.company} on JStar Pro`,
        `${u.name} added you to ${u.company}'s JStar Pro account. Create your login here (the link works for 14 days):\n\n${link}`,
        `<p>${esc(u.name)} added you to <b>${esc(u.company)}</b>'s JStar Pro account.</p><p><a href="${link}" style="display:inline-block;background:#2f6fed;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">Create your login</a></p><p style="color:#666;font-size:13px">The link works for 14 days.</p>`
      ).catch(e => console.error('invite email', e.message));
      return res.status(200).json({ link });
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
