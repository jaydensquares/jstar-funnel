// Branded, email-client-safe HTML for every JStar Pro email (tables + inline styles, 600px, works in Gmail/Outlook/Apple Mail).
// Use layout() for the shell and the small helpers for the pieces inside it.
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const BASE = () => `https://${process.env.PUBLIC_HOST || 'getjstarpro.com'}`;
const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif`;
export const C = { ink: '#101828', body: '#344054', muted: '#667085', faint: '#98a2b3', line: '#eaecf0', soft: '#f6f8fc', bg: '#eef2f8', navy: '#0a1633', brand: '#2f6fed', gold: '#ffc93c', ok: '#067647', okBg: '#ecfdf3', warn: '#b54708', warnBg: '#fffaeb', bad: '#b42318', badBg: '#fef3f2' };

export const p = (html, style = '') => `<p style="margin:0 0 16px;font:400 15px/1.65 ${FONT};color:${C.body};${style}">${html}</p>`;
export const small = html => `<p style="margin:0 0 12px;font:400 13px/1.6 ${FONT};color:${C.muted}">${html}</p>`;
export const h3 = t => `<p style="margin:24px 0 10px;font:700 12px/1.4 ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${C.muted}">${t}</p>`;

// Bulletproof button (VML for Outlook)
export function button(href, label, { color = C.brand } = {}) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 8px"><tr><td align="center" bgcolor="${color}" style="border-radius:10px">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${href}" style="height:46px;v-text-anchor:middle;width:240px" arcsize="20%" fillcolor="${color}" stroke="f"><center style="color:#ffffff;font-family:Arial;font-size:15px;font-weight:bold">${esc(label)}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${href}" style="display:inline-block;padding:13px 26px;font:700 15px/20px ${FONT};color:#ffffff;text-decoration:none;border-radius:10px;background:${color}">${esc(label)}</a><!--<![endif]-->
</td></tr></table>`;
}

// Label/value rows
export function rows(list) {
  const r = list.filter(([, v]) => v != null && v !== '' && v !== false);
  if (!r.length) return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;border:1px solid ${C.line};border-radius:12px;border-collapse:separate;overflow:hidden">${r.map(([k, v], i) =>
    `<tr><td style="padding:12px 16px;${i ? `border-top:1px solid ${C.line};` : ''}font:400 14px/1.4 ${FONT};color:${C.muted}">${esc(k)}</td><td align="right" style="padding:12px 16px;${i ? `border-top:1px solid ${C.line};` : ''}font:700 14px/1.4 ${FONT};color:${C.ink}">${v}</td></tr>`).join('')}</table>`;
}

// Tinted note
export function callout(html, tone = 'info') {
  const t = { info: [C.soft, C.body, C.brand], ok: [C.okBg, C.ok, C.ok], warn: [C.warnBg, C.warn, C.warn], bad: [C.badBg, C.bad, C.bad] }[tone] || [];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px"><tr><td style="background:${t[0]};border-left:3px solid ${t[2]};border-radius:8px;padding:14px 16px;font:400 14px/1.6 ${FONT};color:${t[1]}">${html}</td></tr></table>`;
}

// Stat tiles, 3 per row: [[value, label, color?], ...]
export function stats(tiles) {
  const rowsOf = []; for (let i = 0; i < tiles.length; i += 3) rowsOf.push(tiles.slice(i, i + 3));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 16px;border-collapse:separate;border-spacing:0 8px">${rowsOf.map(r => `<tr>${r.map(([v, l, col], i) =>
    `<td width="33%" valign="top" style="${i ? 'padding-left:8px' : ''}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:${C.soft};border:1px solid ${C.line};border-radius:12px;padding:14px 14px 12px"><div style="font:700 22px/1.2 ${FONT};color:${col || C.ink}">${v}</div><div style="margin-top:4px;font:400 12px/1.4 ${FONT};color:${C.muted}">${esc(l)}</div></td></tr></table></td>`).join('')}</tr>`).join('')}</table>`;
}

// List of linked items: [{ href, title, sub, tag }]
export function items(list) {
  if (!list.length) return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;border:1px solid ${C.line};border-radius:12px;border-collapse:separate">${list.map((x, i) =>
    `<tr><td style="padding:12px 16px;${i ? `border-top:1px solid ${C.line};` : ''}"><a href="${x.href}" style="font:700 15px/1.4 ${FONT};color:${C.ink};text-decoration:none">${esc(x.title)}</a>${x.tag ? ` <span style="font:700 11px/1 ${FONT};letter-spacing:.04em;text-transform:uppercase;color:${x.tagColor || C.brand}">&nbsp;${esc(x.tag)}</span>` : ''}<div style="margin-top:2px;font:400 13px/1.5 ${FONT};color:${C.muted}">${x.sub || ''}</div></td>
     <td align="right" valign="middle" style="padding:12px 16px 12px 0;${i ? `border-top:1px solid ${C.line};` : ''}"><a href="${x.href}" style="font:700 13px/1 ${FONT};color:${C.brand};text-decoration:none">Open&nbsp;&rarr;</a></td></tr>`).join('')}</table>`;
}

/**
 * The shell.
 * brand: { name, sub } shown in the header (defaults to JStar Pro); pass a customer's company for emails they send (buyer blasts)
 * footer: html for the bottom note; legal: false to hide JStar Pro links (customer-branded emails)
 */
export function layout({ preheader = '', eyebrow = '', title = '', body = '', footer = '', brand = null, legal = true }) {
  const head = brand
    ? `<span style="font:800 18px/1 ${FONT};color:#ffffff;letter-spacing:-.01em">${esc(brand.name)}</span>${brand.sub ? `<div style="margin-top:4px;font:400 12px/1.4 ${FONT};color:#9fb0d4">${esc(brand.sub)}</div>` : ''}`
    : `<a href="${BASE()}" style="text-decoration:none"><span style="display:inline-block;width:26px;height:26px;border-radius:7px;background:${C.gold};text-align:center;font:900 15px/26px ${FONT};color:${C.navy};vertical-align:middle">&#9733;</span><span style="font:800 18px/1 ${FONT};color:#ffffff;letter-spacing:-.01em;vertical-align:middle">&nbsp;&nbsp;JStar <span style="color:${C.gold}">Pro</span></span></a>`;
  const links = legal ? `<a href="${BASE()}/support" style="color:${C.faint};text-decoration:underline">Support</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="${BASE()}/legal/terms" style="color:${C.faint};text-decoration:underline">Terms</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="${BASE()}/legal/privacy" style="color:${C.faint};text-decoration:underline">Privacy</a><br>JStar Pro · Dallas–Fort Worth, Texas` : '';
  return `<!doctype html><html lang="en" xmlns:v="urn:schemas-microsoft-com:vml"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>${esc(title)}</title>
<style>@media (max-width:620px){.wrap{width:100%!important}.pad{padding:24px 20px!important}.h1{font-size:22px!important}}</style></head>
<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg}"><tr><td align="center" style="padding:28px 12px 40px">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px">
<tr><td style="background:${C.navy};border-radius:16px 16px 0 0;padding:22px 32px" class="pad">${head}</td></tr>
<tr><td style="background:#ffffff;padding:34px 32px 30px;border-radius:0 0 16px 16px;box-shadow:0 1px 3px rgba(16,24,40,.06)" class="pad">
${eyebrow ? `<p style="margin:0 0 8px;font:700 12px/1.4 ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${C.brand}">${esc(eyebrow)}</p>` : ''}
${title ? `<h1 class="h1" style="margin:0 0 18px;font:800 25px/1.25 ${FONT};color:${C.ink};letter-spacing:-.015em">${title}</h1>` : ''}
${body}
</td></tr>
<tr><td style="padding:22px 32px 0;font:400 12px/1.7 ${FONT};color:${C.faint};text-align:center" class="pad">${footer ? footer + (links ? '<br><br>' : '') : ''}${links}</td></tr>
</table></td></tr></table></body></html>`;
}
