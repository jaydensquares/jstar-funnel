// Daily job (Vercel Cron, 7am Central): follow-up reminders for every account, and on the 1st a recap of last month.
// Vercel sends Authorization: Bearer $CRON_SECRET. ?dry=1 (with the secret) returns what would be sent without sending.
import { listDocs, getDoc, putDoc } from '../lib/db.js';
import { listDeals } from '../lib/store.js';
import { sendPlainEmail } from '../lib/auth.js';
import { isActive, isOperator } from '../lib/plan.js';
import { layout, p as P, small, h3, button, stats, items, callout } from '../lib/email.js';

export const maxDuration = 300;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $$ = n => '$' + Math.round(n || 0).toLocaleString();
const ymd = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d); // YYYY-MM-DD
const DAY = 864e5;
const nm = L => [L?.firstName, L?.lastName].filter(Boolean).join(' ') || 'Seller';
const PREFS = base => `You're receiving this because email updates are on for your JStar Pro account. <a href="${base}/app#account" style="color:#98a2b3;text-decoration:underline">Manage email preferences</a>`;

export function reminders(user, leads, deals, today = ymd(), now = Date.now()) {
  const open = leads.filter(l => !['dead', 'converted'].includes(l.status));
  const due = open.filter(l => l.followUpAt && l.followUpAt <= today);
  const fresh = open.filter(l => l.status === 'new' && now - l.createdAt > DAY && !l.followUpAt);
  const cold = open.filter(l => ['HOT', 'WARM'].includes(l.brief?.label) && l.status === 'contacted' && now - (l.updatedAt || l.createdAt) > 3 * DAY && !l.followUpAt);
  const in3 = ymd(new Date(now + 3 * DAY));
  const closing = deals.filter(d => !['closed', 'dead'].includes(d.status) && d.terms?.closingDate && d.terms.closingDate >= today && d.terms.closingDate <= in3);
  return { due, fresh, cold, closing, total: due.length + fresh.length + cold.length + closing.length };
}

export function recap(user, leads, deals, usage, monthStart, monthEnd) {
  const inM = t => t >= monthStart && t < monthEnd;
  const L = leads.filter(l => inM(l.createdAt));
  const moved = (d, st) => (d.history || []).some(h => inM(h.at) && new RegExp(`→ ${st}$`).test(h.text || ''));
  const contracts = deals.filter(d => moved(d, 'contract')), closed = deals.filter(d => moved(d, 'closed'));
  const fee = d => d.numbers?.assignmentFee || 0;
  return {
    leads: L.length, hot: L.filter(l => l.brief?.label === 'HOT').length, analyses: usage?.runs || 0, photos: usage?.photos || 0,
    newDeals: deals.filter(d => inM(d.createdAt)).length, contracts: contracts.length, closed: closed.length, closedFees: closed.reduce((s, d) => s + fee(d), 0),
    pendingFees: deals.filter(d => ['contract', 'assigned'].includes(d.status)).reduce((s, d) => s + fee(d), 0),
    blasts: deals.reduce((s, d) => s + (d.history || []).filter(h => inM(h.at) && /^Sent to \d+ buyer/.test(h.text || '')).length, 0),
  };
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  const dry = !!req.query?.dry, today = ymd(), now = Date.now(), first = today.endsWith('-01');
  const base = `https://${process.env.PUBLIC_HOST || 'getjstarpro.com'}`;
  // Last month bounds (Central time, close enough at month scale)
  const [y, m] = today.split('-').map(Number), pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
  const mStart = Date.parse(`${py}-${String(pm).padStart(2, '0')}-01T06:00:00Z`), mEnd = Date.parse(`${y}-${String(m).padStart(2, '0')}-01T06:00:00Z`);
  const mName = new Date(mStart + DAY).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  const out = [];

  const users = (await listDocs('users')).filter(u => !u.disabled && !u.memberOf && (isActive(u) || isOperator(u)));
  for (const u of users) {
    try {
      const s = u.settings || {}, to = s.notifyEmail || u.email, state = (await getDoc(`t/${u.id}/cron`).catch(() => null)) || {};
      const wantRem = s.emailReminders !== false && state.rem !== today, wantRecap = first && s.emailRecap !== false && state.recap !== today;
      if (!wantRem && !wantRecap) continue;
      const leads = (await listDocs(`t/${u.id}/leads`)).map(({ html, ...l }) => l), deals = await listDeals(u.id);
      const first_ = (u.name || '').split(' ')[0] || 'there';
      if (wantRem) {
        const r = reminders(u, leads, deals, today, now);
        if (r.total) {
          const md = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const it = (l, why, tag, tagColor) => ({ href: `${base}/app#leads/${l.id}`, title: nm(l.lead), sub: `${esc(l.lead?.street || '')}${l.brief?.mao ? ` · up to ${$$(l.brief.mao)}` : ''} · ${why}`, tag, tagColor });
          const sec = (t, arr) => arr.length ? h3(t) + items(arr) : '';
          const html = layout({ preheader: `${r.due.length} scheduled, ${r.fresh.length} new, ${r.cold.length} going cold${r.closing.length ? `, ${r.closing.length} closing soon` : ''}.`,
            eyebrow: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Chicago' }), title: `${r.total} follow-up${r.total > 1 ? 's' : ''} for today`,
            body: P(`Good morning, ${esc(first_)}. Here's who to call today, in order of priority.`)
              + stats([[r.due.length, 'Scheduled'], [r.fresh.length, 'New, not called', r.fresh.length ? '#2f6fed' : undefined], [r.cold.length, 'Going cold', r.cold.length ? '#b54708' : undefined]])
              + sec('Follow-ups you scheduled', r.due.map(l => it(l, 'due ' + md(l.followUpAt + 'T12:00'))))
              + sec('New leads waiting on a call', r.fresh.slice(0, 8).map(l => it(l, 'came in ' + md(l.createdAt), l.brief?.label, l.brief?.label === 'HOT' ? '#b42318' : undefined)))
              + sec('Hot and warm leads going cold', r.cold.slice(0, 8).map(l => it(l, `no contact in ${Math.floor((now - (l.updatedAt || l.createdAt)) / DAY)} days`, l.brief.label, l.brief.label === 'HOT' ? '#b42318' : '#b54708')))
              + sec('Closing in the next 3 days', r.closing.map(d => ({ href: `${base}/underwriting#${d.id}`, title: d.address?.street || 'Deal', sub: `Closes ${md(d.terms.closingDate + 'T12:00')}`, tag: 'Closing', tagColor: '#067647' })))
              + '<div style="height:12px"></div>' + button(base + '/app#leads', 'Open your leads'),
            footer: PREFS(base) });
          const text = `${r.total} follow-ups today: ${r.due.length} scheduled, ${r.fresh.length} new not called, ${r.cold.length} going cold, ${r.closing.length} closing soon. ${base}/app#leads`;
          if (!dry) await sendPlainEmail(to, `${r.total} follow-up${r.total > 1 ? 's' : ''} for today`, text, html);
          out.push({ uid: u.id, reminders: r.total });
        }
      }
      if (wantRecap) {
        const usage = await getDoc(`t/${u.id}/usage/${py}${String(pm).padStart(2, '0')}`).catch(() => null);
        const c = recap(u, leads, deals, usage, mStart, mEnd);
        const html = layout({ preheader: `${c.leads} leads, ${c.contracts} under contract, ${$$(c.closedFees)} in fees closed.`, eyebrow: 'Monthly recap', title: `Your ${mName} on JStar Pro`,
          body: P(`Here's how ${mName} went, ${esc(first_)}.`)
            + stats([[$$(c.closedFees), `Fees closed (${c.closed} deal${c.closed === 1 ? '' : 's'})`, '#067647'], [$$(c.pendingFees), 'Fees pending', '#2f6fed'], [c.contracts, 'Under contract', '#7a5af8'], [c.leads, 'New leads'], [c.hot, 'Hot leads', '#b42318'], [c.newDeals, 'Deals started'], [c.analyses, 'Deal analyses'], [c.blasts, 'Buyer blasts'], [c.photos, 'Photo estimates']])
            + callout(c.closed ? 'Strong month. Keep the pipeline full so next month is even better.' : c.contracts ? 'You have deals under contract. Line up your buyers early with <b>Send to buyers</b> on each deal.' : 'New month, fresh start. Every lead in your inbox already has an offer worked out, so the fastest win is calling the newest ones first.', c.closed ? 'ok' : 'info')
            + button(base + '/app#leads', 'Open JStar Pro'),
          footer: PREFS(base) });
        const text = `${mName}: ${c.leads} leads (${c.hot} hot), ${c.analyses} analyses, ${c.newDeals} deals started, ${c.contracts} under contract, ${c.closed} closed for ${$$(c.closedFees)}. Pending fees: ${$$(c.pendingFees)}.`;
        if (!dry) await sendPlainEmail(to, `Your ${mName} recap: ${c.closed ? $$(c.closedFees) + ' closed' : c.leads + ' leads'}`, text, html);
        out.push({ uid: u.id, recap: c });
      }
      if (!dry) await putDoc(`t/${u.id}/cron`, { ...state, ...(wantRem ? { rem: today } : {}), ...(wantRecap ? { recap: today } : {}) }, { keep: 1 });
    } catch (e) { console.error('cron user', u.id, e.message); out.push({ uid: u.id, error: e.message }); }
  }
  return res.status(200).json({ ok: true, today, users: users.length, sent: out });
}
