// Daily job (Vercel Cron, 7am Central): follow-up reminders for every account, and on the 1st a recap of last month.
// Vercel sends Authorization: Bearer $CRON_SECRET. ?dry=1 (with the secret) returns what would be sent without sending.
import { listDocs, getDoc, putDoc } from '../lib/db.js';
import { listDeals } from '../lib/store.js';
import { sendPlainEmail } from '../lib/auth.js';
import { isActive, isOperator } from '../lib/plan.js';

export const maxDuration = 300;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $$ = n => '$' + Math.round(n || 0).toLocaleString();
const ymd = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d); // YYYY-MM-DD
const DAY = 864e5;
const nm = L => [L?.firstName, L?.lastName].filter(Boolean).join(' ') || 'Seller';
const BTN = (href, t) => `<a href="${href}" style="display:inline-block;background:#2f6fed;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">${t}</a>`;
const wrap = (title, inner) => `<div style="font-family:Arial,sans-serif;max-width:560px;color:#101828"><p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#2f6fed">JStar Pro</p><h2 style="margin:0 0 16px;font-size:22px">${title}</h2>${inner}<p style="margin-top:28px;font-size:12px;color:#98a2b3">Change these emails any time in Plan &amp; account.</p></div>`;

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
          const li = (l, why) => `<li style="margin:6px 0"><a href="${base}/app#leads/${l.id}" style="color:#2f6fed;font-weight:700">${esc(nm(l.lead))}</a>, ${esc(l.lead?.street || '')}${l.brief?.mao ? ` · up to ${$$(l.brief.mao)}` : ''} <span style="color:#667085">(${why})</span></li>`;
          const sec = (t, arr) => arr.length ? `<p style="margin:16px 0 4px;font-weight:700">${t}</p><ul style="padding-left:18px;margin:0">${arr.join('')}</ul>` : '';
          const html = wrap(`${r.total} thing${r.total > 1 ? 's' : ''} to follow up on today`, `<p>Morning ${esc(first_)}. Deals die from slow follow-up, so here's today's list.</p>`
            + sec('Follow-ups you scheduled', r.due.map(l => li(l, 'due ' + l.followUpAt)))
            + sec('New leads nobody has called yet', r.fresh.slice(0, 8).map(l => li(l, 'came in ' + new Date(l.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))))
            + sec('Hot and warm leads going cold', r.cold.slice(0, 8).map(l => li(l, `${l.brief.label.toLowerCase()}, no touch in ${Math.floor((now - (l.updatedAt || l.createdAt)) / DAY)} days`)))
            + sec('Closings in the next 3 days', r.closing.map(d => `<li style="margin:6px 0"><a href="${base}/underwriting#${d.id}" style="color:#2f6fed;font-weight:700">${esc(d.address?.street || 'Deal')}</a> closes ${esc(d.terms.closingDate)}</li>`))
            + `<p style="margin-top:20px">${BTN(base + '/app#leads', 'Open your leads')}</p>`);
          const text = `${r.total} follow-ups today: ${r.due.length} scheduled, ${r.fresh.length} new not called, ${r.cold.length} going cold, ${r.closing.length} closing soon. ${base}/app#leads`;
          if (!dry) await sendPlainEmail(to, `${r.total} follow-up${r.total > 1 ? 's' : ''} for today`, text, html);
          out.push({ uid: u.id, reminders: r.total });
        }
      }
      if (wantRecap) {
        const usage = await getDoc(`t/${u.id}/usage/${py}${String(pm).padStart(2, '0')}`).catch(() => null);
        const c = recap(u, leads, deals, usage, mStart, mEnd);
        const tile = (v, l, col = '#101828') => `<td style="padding:14px;border:1px solid #eef0f3;border-radius:10px;width:33%"><div style="font-size:24px;font-weight:700;color:${col}">${v}</div><div style="font-size:12.5px;color:#667085">${l}</div></td>`;
        const html = wrap(`Your ${mName} on JStar Pro`, `<p>Here's what you did in ${mName}, ${esc(first_)}.</p>
          <table style="width:100%;border-collapse:separate;border-spacing:8px"><tr>${tile(c.leads, 'New leads')}${tile(c.hot, 'Hot leads', '#f04438')}${tile(c.analyses, 'Deal analyses')}</tr>
          <tr>${tile(c.newDeals, 'Deals started')}${tile(c.contracts, 'Under contract', '#7a5af8')}${tile(c.blasts, 'Buyer blasts sent')}</tr>
          <tr>${tile($$(c.closedFees), `Fees closed (${c.closed} deal${c.closed === 1 ? '' : 's'})`, '#12b76a')}${tile($$(c.pendingFees), 'Fees pending now', '#2f6fed')}${tile(c.photos, 'Photo estimates')}</tr></table>
          <p>${c.closed ? 'Nice work. Keep the pipeline full.' : c.contracts ? 'You have deals under contract. Line up your buyers.' : 'New month, fresh start. Every lead in your inbox already has an offer worked out.'}</p><p>${BTN(base + '/app#leads', 'Open JStar Pro')}</p>`);
        const text = `${mName}: ${c.leads} leads (${c.hot} hot), ${c.analyses} analyses, ${c.newDeals} deals started, ${c.contracts} under contract, ${c.closed} closed for ${$$(c.closedFees)}. Pending fees: ${$$(c.pendingFees)}.`;
        if (!dry) await sendPlainEmail(to, `Your ${mName} recap: ${c.closed ? $$(c.closedFees) + ' closed' : c.leads + ' leads'}`, text, html);
        out.push({ uid: u.id, recap: c });
      }
      if (!dry) await putDoc(`t/${u.id}/cron`, { ...state, ...(wantRem ? { rem: today } : {}), ...(wantRecap ? { recap: today } : {}) }, { keep: 1 });
    } catch (e) { console.error('cron user', u.id, e.message); out.push({ uid: u.id, error: e.message }); }
  }
  return res.status(200).json({ ok: true, today, users: users.length, sent: out });
}
