// Accounts + sessions. Passwords: scrypt. Sessions: HMAC-signed, HttpOnly cookie (30 days).
import crypto from 'node:crypto';
import { getDoc, putDoc, newId } from './db.js';
import { pinMatches } from './pin.js';

const COOKIE = 'js_sess';
const MAX_AGE = 30 * 864e2; // seconds (30 days)
export const RESERVED = new Set(['admin', 'api', 'app', 'www', 'f', 'login', 'signup', 'jstar', 'jstaracquire', 'operator', 'support', 'help', 'billing', 'settings', 'privacy', 'terms']);

const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET not set');
  return s;
};
const b64 = b => Buffer.from(b).toString('base64url');
const sign = data => crypto.createHmac('sha256', secret()).update(data).digest('base64url');
export const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function checkPassword(pw, stored) {
  const [alg, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64'), 32, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(hash, 'base64');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export function sessionCookie(uid, ver = 0) {
  const body = b64(JSON.stringify({ u: uid, v: ver, e: Math.floor(Date.now() / 1000) + MAX_AGE }));
  return `${COOKIE}=${body}.${sign(body)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function readSession(req) {
  const raw = String(req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(COOKIE + '='));
  if (!raw) return null;
  const [body, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!body || !sig) return null;
  const want = sign(body);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString());
    return s.e > Date.now() / 1000 ? s : null;
  } catch { return null; }
}

export const getUserById = uid => (/^[a-z0-9]{6,32}$/.test(uid) ? getDoc(`users/${uid}`) : null);
export async function getUserBySlug(slug) {
  const ix = /^[a-z0-9-]{3,30}$/.test(slug) ? await getDoc(`idx/slug/${slug}`) : null;
  return ix ? getUserById(ix.uid) : null;
}
export async function getUserByEmail(email) {
  const ix = await getDoc(`idx/email/${sha(String(email).trim().toLowerCase())}`);
  return ix ? getUserById(ix.uid) : null;
}
export async function getUserByHost(host) {
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
  if (!/^[a-z0-9.-]{3,253}$/.test(h)) return null;
  const ix = await getDoc(`idx/host/${h}`);
  return ix ? getUserById(ix.uid) : null;
}

// Logged-in user from the session cookie (or null). Password changes bump user.sessVer to log out old sessions.
export async function currentUser(req) {
  let s; try { s = readSession(req); } catch { return null; }
  if (!s) return null;
  const u = await getUserById(s.u);
  return u && (u.sessVer || 0) === (s.v || 0) && !u.disabled ? u : null;
}

// Who is calling a tool endpoint: the owner (PIN) or a logged-in user.
// scope: '' for the owner's own data, user id for a user's data.
export async function getActor(req, body) {
  if (body?.pin && pinMatches(body.pin)) return { owner: true, scope: '', biz: OWNER_BIZ };
  // Session requests must be JSON (blocks cross-site form posts)
  if (!String(req.headers['content-type'] || '').includes('application/json')) return null;
  const u = await currentUser(req);
  if (!u) return null;
  return { owner: false, user: u, scope: u.id, biz: bizOf(u) };
}

export const OWNER_BIZ = { company: 'JStar Acquisitions', signer: 'Jayden Squares', title: 'Owner', phone: '(832) 833-0125', email: '' };
export const bizOf = u => ({ company: u.company || u.name, signer: u.name, title: 'Owner', phone: u.phone || '', email: u.email || '' });

export function publicUser(u) {
  if (!u) return null;
  const { passHash, sessVer, ...rest } = u;
  return rest;
}

export async function createUser({ name, email, password, company, slug, phone }) {
  const id = newId();
  const user = {
    id, name, email: email.toLowerCase(), company, slug, phone, passHash: hashPassword(password), sessVer: 0,
    createdAt: Date.now(),
    settings: { notifyEmail: email.toLowerCase(), address: '', metaPixelId: '', metaCapiToken: '', googleAdsId: '', googleAdsLeadLabel: '' },
    plan: { tier: 'trial', customDomain: false },
    domain: null,
  };
  await putDoc(`users/${id}`, user);
  await putDoc(`idx/email/${sha(user.email)}`, { uid: id });
  await putDoc(`idx/slug/${slug}`, { uid: id });
  return user;
}
export const saveUser = u => putDoc(`users/${u.id}`, { ...u, updatedAt: Date.now() });
