// JStar AI chat panel. Loaded by kit.js on every app page; talks to /api/agent.
(() => {
  if (window.__jstarAI) return; window.__jstarAI = true;
  const KEY = 'jsAiChat';
  const SUGGEST = ['Who should I call today?', 'Run 1207 Shady Oaks Ln, Houston TX 77008', 'Write a first text to my newest lead', 'Which of my buyers fit my latest deal?'];
  const css = `
  .jai-fab{position:fixed;right:22px;bottom:22px;z-index:900;display:flex;align-items:center;gap:10px;height:46px;padding:0 18px 0 14px;border:1px solid rgba(255,255,255,.08);border-radius:999px;cursor:pointer;
    background:#0a0a0a;color:#fff;font:600 14.5px var(--body,system-ui);box-shadow:0 6px 18px rgba(28,28,28,.18);transition:background .12s}
  .jai-fab:hover{background:#1f1f1f} .jai-fab svg{width:20px;height:20px;color:#ffc93c}
  .jai-fab.hide{display:none}
  .jai{position:fixed;z-index:950;right:16px;bottom:16px;top:16px;width:440px;max-width:calc(100vw - 32px);display:none;flex-direction:column;background:var(--card,#fff);color:var(--ink,#1c1c1c);
    border:1px solid var(--line,#e8e8e8);border-radius:12px;box-shadow:0 24px 60px rgba(28,28,28,.18);overflow:hidden;font-family:var(--body,system-ui)}
  .jai.open{display:flex;animation:jaiIn .18s ease-out}@keyframes jaiIn{from{opacity:0;transform:translateY(10px)}}
  .jai-hd{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line,#e8e8e8);background:#0a0a0a;color:#fff}
  .jai-hd .ic{width:34px;height:34px;border-radius:8px;background:#ffc93c;color:#0a0a0a;display:flex;align-items:center;justify-content:center;flex:none}
  .jai-hd .ic svg{width:20px;height:20px}.jai-hd b{display:block;font-size:15px}.jai-hd span{font-size:12px;color:#b0b0b0}
  .jai-hd .sp{flex:1}.jai-hd button{background:rgba(255,255,255,.1);border:0;color:#fff;width:34px;height:34px;border-radius:9px;cursor:pointer;display:flex;align-items:center;justify-content:center}
  .jai-hd button:hover{background:rgba(255,255,255,.2)}.jai-hd button svg{width:18px;height:18px}
  .jai-body{flex:1;overflow-y:auto;padding:18px 16px;display:flex;flex-direction:column;gap:14px;background:var(--bg,#f5f5f5)}
  .jai-hi h3{margin:6px 0 4px;font:700 20px var(--display,system-ui)}.jai-hi p{margin:0 0 14px;color:var(--muted,#767676);font-size:14px;line-height:1.5}
  .jai-sug{display:flex;flex-direction:column;gap:8px}.jai-sug button{text-align:left;padding:11px 14px;border-radius:12px;border:1px solid var(--line,#e8e8e8);background:var(--card,#fff);color:var(--ink,#1c1c1c);font:600 14px var(--body,system-ui);cursor:pointer}
  .jai-sug button:hover{border-color:var(--brand,#111111)}
  .jai-m{max-width:88%;font-size:14.5px;line-height:1.55;word-wrap:break-word}
  .jai-m.u{align-self:flex-end;background:var(--brand,#111111);color:var(--brand-ink, #fff);padding:10px 14px;border-radius:16px 16px 4px 16px;white-space:pre-wrap}
  .jai-m.a{align-self:flex-start;background:var(--card,#fff);border:1px solid var(--line,#e8e8e8);padding:12px 14px;border-radius:16px 16px 16px 4px}
  .jai-m.a p{margin:0 0 8px}.jai-m.a p:last-child{margin:0}.jai-m.a ul,.jai-m.a ol{margin:4px 0 8px;padding-left:20px}.jai-m.a li{margin:2px 0}
  .jai-m.a code{background:var(--line2,#f0f0f0);padding:1px 5px;border-radius:5px;font-size:13px}.jai-m.a a{color:var(--brand,#111111)}
  .jai-m.err{align-self:flex-start;color:var(--err,#d92d20);font-size:14px}
  .jai-steps{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}.jai-steps span{font-size:12px;font-weight:600;color:var(--muted,#767676);background:var(--line2,#f0f0f0);padding:3px 9px;border-radius:999px}
  .jai-card{margin-top:10px;border:1px solid var(--line,#e8e8e8);border-radius:12px;padding:12px;background:var(--bg,#f5f5f5)}
  .jai-card .ad{font-weight:700;font-size:14px;margin-bottom:8px}.jai-card .g{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .jai-card .g div{background:var(--card,#fff);border-radius:9px;padding:8px 10px}.jai-card .g small{display:block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#767676)}
  .jai-card .g b{font-size:17px;font-variant-numeric:tabular-nums}.jai-card a.go{display:inline-block;margin-top:10px;font-weight:700;font-size:13px;color:var(--brand,#111111);text-decoration:none}
  .jai-card .tag{float:right;font-size:12px;font-weight:700;padding:2px 8px;border-radius:999px}.tag.Hot{background:var(--hot-bg,#fef3f2);color:var(--hot,#b42318)}.tag.Warm{background:var(--warn-bg,#fffaeb);color:var(--warn,#93370d)}.tag.Cold{background:var(--brand-soft,#f0f0f0);color:var(--brand,#111111)}
  .jai-ph{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-top:1px solid var(--line2,#f0f0f0);font-size:14px}.jai-ph:first-of-type{border-top:0}
  .jai-ph a{color:var(--ink,#1c1c1c);font-weight:700;text-decoration:none;font-variant-numeric:tabular-nums}.jai-ph .dnc{color:var(--err,#d92d20);font-size:12px;font-weight:700}
  .jai-think{align-self:flex-start;display:flex;align-items:center;gap:10px;color:var(--muted,#767676);font-size:13px;font-weight:600}
  .jai-think i{width:7px;height:7px;border-radius:50%;background:var(--brand,#111111);animation:jaiB 1s infinite}.jai-think i:nth-child(2){animation-delay:.15s}.jai-think i:nth-child(3){animation-delay:.3s}
  @keyframes jaiB{0%,80%,100%{opacity:.25}40%{opacity:1}}
  .jai-ft{border-top:1px solid var(--line,#e8e8e8);padding:12px;background:var(--card,#fff)}
  .jai-in{display:flex;align-items:flex-end;gap:8px;border:1px solid var(--line,#e8e8e8);border-radius:14px;padding:6px 6px 6px 12px;background:var(--input,#fff)}
  .jai-in:focus-within{border-color:var(--brand,#111111);box-shadow:0 0 0 3px var(--brand-soft,#f0f0f0)}
  .jai-in textarea{flex:1;border:0!important;outline:0;box-shadow:none!important;border-radius:0!important;resize:none;background:transparent!important;width:auto!important;margin:0!important;color:var(--ink,#1c1c1c);font:400 15px/1.45 var(--body,system-ui);max-height:140px;padding:6px 0!important;min-height:24px}
  .jai-in button{flex:none;width:38px;height:38px;border:0;border-radius:10px;background:var(--brand,#111111);color:var(--brand-ink, #fff);cursor:pointer;display:flex;align-items:center;justify-content:center}
  .jai-in button:disabled{opacity:.4;cursor:default}.jai-in button svg{width:18px;height:18px}
  .jai-ft small{display:block;margin-top:6px;font-size:11.5px;color:var(--muted,#767676);text-align:center}
  @media (max-width:640px){.jai{inset:0;width:auto;max-width:none;border-radius:0;border:0}.jai-fab{right:14px;bottom:14px;height:52px;width:52px;padding:0;justify-content:center}.jai-fab span{display:none}}
  @media print{.jai,.jai-fab{display:none!important}}`;
  const SPARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.9L19 9.7l-5.2 1.8L12 16.5l-1.8-5L5 9.7l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const fab = document.createElement('button'); fab.className = 'jai-fab'; fab.type = 'button'; fab.setAttribute('aria-label', 'Ask JStar AI'); fab.innerHTML = SPARK + '<span>Ask JStar AI</span>';
  const box = document.createElement('section'); box.className = 'jai'; box.setAttribute('aria-label', 'JStar AI assistant');
  box.innerHTML = `<div class="jai-hd"><div class="ic">${SPARK}</div><div><b>JStar AI</b><span>Your acquisitions assistant</span></div><div class="sp"></div>
    <button type="button" data-a="new" title="New chat" aria-label="New chat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
    <button type="button" data-a="close" title="Close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <div class="jai-body" aria-live="polite"></div>
    <form class="jai-ft"><div class="jai-in"><textarea rows="1" placeholder="Ask about a lead, run an address, write a text..." aria-label="Message JStar AI"></textarea>
    <button type="submit" aria-label="Send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></div>
    <small>Runs and skip traces use your plan's credits. Double-check numbers before you offer.</small></form>`;
  document.body.append(fab, box);
  const body = box.querySelector('.jai-body'), ta = box.querySelector('textarea'), form = box.querySelector('form'), send = form.querySelector('button');

  let msgs = []; // {role, content, cards?, steps?}
  try { msgs = JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch {}
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-40))); } catch {} };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $m = n => n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US');
  const phone = n => { const d = String(n || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : n; };
  function md(t) {
    const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(((?:https:\/\/|\/)[^)\s]+)\)/g, '<a href="$2">$1</a>');
    const out = []; let list = null;
    for (const raw of String(t).split('\n')) {
      const line = raw.trimEnd(), ul = line.match(/^\s*[-•*]\s+(.*)/), ol = line.match(/^\s*\d+[.)]\s+(.*)/);
      if (ul || ol) { const tag = ul ? 'ul' : 'ol'; if (!list || list.tag !== tag) { if (list) out.push(`</${list.tag}>`); list = { tag }; out.push(`<${tag}>`); } out.push(`<li>${inline((ul || ol)[1])}</li>`); continue; }
      if (list) { out.push(`</${list.tag}>`); list = null; }
      if (line.trim()) out.push(`<p>${inline(line.replace(/^#+\s*/, ''))}</p>`);
    }
    if (list) out.push(`</${list.tag}>`);
    return out.join('');
  }
  function card(c) {
    if (c.type === 'run') return `<div class="jai-card">${c.score ? `<span class="tag ${esc(c.score)}">${esc(c.score)}</span>` : ''}<div class="ad">${esc(c.address)}</div>
      <div class="g"><div><small>Opening offer</small><b>${$m(c.opening)}</b></div><div><small>Max offer</small><b>${$m(c.mao)}</b></div><div><small>ARV</small><b>${$m(c.arv)}</b></div><div><small>Repairs</small><b>${$m(c.repairs)}</b></div></div>
      <a class="go" href="/operator?a=${encodeURIComponent(c.address || '')}">Open the full deal sheet →</a></div>`;
    if (c.type === 'skip') { if (!c.found) return '<div class="jai-card">No match found. That skip trace didn\'t use a credit.</div>';
      return c.people.map(p => `<div class="jai-card"><div class="ad">${esc(p.name)}${p.age ? ` · ${p.age}` : ''}</div>${(p.phones || []).map(x => `<div class="jai-ph"><a href="tel:${esc(x.number)}">${esc(phone(x.number))}</a><span>${x.do_not_call ? '<span class="dnc">DO NOT CALL</span>' : esc(x.type || '')}</span></div>`).join('')}${(p.emails || []).map(e => `<div class="jai-ph"><a href="mailto:${esc(e)}">${esc(e)}</a></div>`).join('')}</div>`).join(''); }
    return '';
  }
  const hi = () => `<div class="jai-hi"><h3>What are we working on?</h3><p>I can see your leads, deals and buyers. Ask me to prioritize calls, run an address, skip trace an owner, match buyers or write a text.</p>
    <div class="jai-sug">${SUGGEST.map(s => `<button type="button">${esc(s)}</button>`).join('')}</div></div>`;
  function render() {
    body.innerHTML = msgs.length ? msgs.map(m => m.role === 'user' ? `<div class="jai-m u">${esc(m.content)}</div>`
      : m.error ? `<div class="jai-m err">${esc(m.content)}</div>`
      : `<div class="jai-m a">${m.steps?.length ? `<div class="jai-steps">${[...new Set(m.steps.map(s => s.label))].map(l => `<span>✓ ${esc(l)}</span>`).join('')}</div>` : ''}${md(m.content)}${(m.cards || []).map(card).join('')}</div>`).join('') : hi();
    body.querySelectorAll('.jai-sug button').forEach(b => b.onclick = () => ask(b.textContent));
    body.scrollTop = body.scrollHeight;
  }
  let busy = false;
  const THINK = ['Thinking', 'Checking your leads', 'Pulling the numbers', 'Almost there'];
  async function ask(text) {
    text = String(text || '').trim(); if (!text || busy) return;
    busy = true; send.disabled = true; ta.value = ''; grow();
    msgs.push({ role: 'user', content: text }); save(); render();
    const th = document.createElement('div'); th.className = 'jai-think'; th.innerHTML = '<i></i><i></i><i></i><span>Thinking</span>'; body.appendChild(th); body.scrollTop = body.scrollHeight;
    let k = 0; const tick = setInterval(() => { th.querySelector('span').textContent = THINK[Math.min(++k, THINK.length - 1)]; }, 2600);
    try {
      const r = await fetch('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ messages: msgs.filter(m => !m.error).map(m => ({ role: m.role, content: m.content })) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Something went wrong. Try again.');
      msgs.push({ role: 'assistant', content: j.reply, cards: j.cards, steps: j.steps });
      if (j.changed) window.dispatchEvent(new CustomEvent('jstar:changed'));
    } catch (e) { msgs.push({ role: 'assistant', content: e.message, error: true }); }
    clearInterval(tick); busy = false; send.disabled = false; save(); render(); ta.focus();
  }
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; };
  ta.addEventListener('input', grow);
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(ta.value); } });
  form.addEventListener('submit', e => { e.preventDefault(); ask(ta.value); });
  const open = () => { box.classList.add('open'); fab.classList.add('hide'); render(); setTimeout(() => ta.focus(), 50); try { sessionStorage.setItem(KEY + 'Open', '1'); } catch {} };
  const close = () => { box.classList.remove('open'); fab.classList.remove('hide'); try { sessionStorage.removeItem(KEY + 'Open'); } catch {} };
  fab.onclick = open;
  box.querySelector('[data-a=close]').onclick = close;
  box.querySelector('[data-a=new]').onclick = () => { if (busy) return; msgs = []; save(); render(); ta.focus(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && box.classList.contains('open')) close(); });
  window.JStarAI = { open, ask: t => { open(); ask(t); } };
  try { if (sessionStorage.getItem(KEY + 'Open')) open(); } catch {}
})();
