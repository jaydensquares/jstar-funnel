// Homepage only: 25% off popup, monthly/yearly pricing, the product tour and the savings calculator.
(() => {
  const $ = id => document.getElementById(id);

  // ── 25% off popup: once per visitor, on exit intent (desktop) or after 40 seconds ──
  (() => {
    const box = $('offer'); if (!box) return; let seen = false, opener = null;
    try { seen = !!localStorage.getItem('jsOffer'); } catch {}
    const mark = v => { try { localStorage.setItem('jsOffer', v); } catch {} };
    const close = () => { box.hidden = true; document.removeEventListener('keydown', onKey); if (opener && opener.focus) opener.focus(); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    const open = () => { if (seen || !box.hidden) return; seen = true; mark('shown'); opener = document.activeElement; box.hidden = false; document.addEventListener('keydown', onKey); $('ofName').focus(); };
    if (!seen) {
      const t0 = Date.now();
      document.addEventListener('mouseout', e => { if (!e.relatedTarget && e.clientY <= 0 && Date.now() - t0 > 5000) open(); });
      setTimeout(open, 40000);
    }
    $('offerX').onclick = $('offerNo').onclick = close;
    box.addEventListener('mousedown', e => { if (e.target === box) close(); });
    $('offerForm').addEventListener('submit', async e => {
      e.preventDefault(); const err = $('ofErr'); err.textContent = '';
      const name = $('ofName').value.trim(), email = $('ofEmail').value.trim(), phone = $('ofPhone').value.trim();
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err.textContent = 'Enter your name and a valid email.'; return; }
      if (phone.replace(/\D/g, '').length < 10) { err.textContent = 'Enter a phone number with area code.'; return; }
      if (!$('ofAgree').checked) { err.textContent = 'Check the box so we can contact you.'; return; }
      let via = ''; try { const x = JSON.parse(localStorage.getItem('jsVia') || 'null'); if (x) via = x.c; } catch {}
      $('ofGo').disabled = true; $('ofGo').textContent = 'Saving…';
      try {
        const r = await fetch('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'offer', name, email, phone, agree: true, via, web: $('ofWeb').value }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'That didn\'t save. Try again.');
        mark('claimed'); try { localStorage.setItem('jsOfferEmail', email); } catch {}
        $('ofShow').textContent = email; $('offerForm').hidden = true; $('offerDone').hidden = false;
      } catch (x) { err.textContent = x.message; $('ofGo').disabled = false; $('ofGo').textContent = 'Claim my 25% off'; }
    });
  })();

  // ── Monthly / yearly pricing (yearly = 10 months) ──
  $('billTog')?.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return; const y = b.dataset.i === 'year';
    $('billTog').querySelectorAll('button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    document.querySelectorAll('.plan .pr[data-m]').forEach(el => { const m = +el.dataset.m; el.innerHTML = y ? `$${(m * 10).toLocaleString()}<span> / year</span><small class="yr">About $${Math.round(m * 10 / 12)}/mo · you save $${m * 2}</small>` : `$${m}<span> / month</span>`; });
    document.querySelectorAll('.plan a[data-plan]').forEach(a => { a.href = `/signup?plan=${a.dataset.plan}${y ? '&billing=year' : ''}`; });
  });

  // ── Product tour: clip plays while on screen and advances when it ends ──
  (() => {
    const tabs = $('tabs'), v = $('tv'); if (!tabs || !v) return;
    const items = [...tabs.querySelectorAll(':scope > li')], keys = items.map(li => li.querySelector('button').dataset.key);
    let cur = 0, loaded = false;
    const load = k => { v.innerHTML = `<source src="/media/${k}.mp4" type="video/mp4"><source src="/media/${k}.webm" type="video/webm">`; v.load(); };
    function show(i) {
      cur = (i + items.length) % items.length;
      items.forEach((li, k) => { li.classList.toggle('on', k === cur); li.querySelector('button').setAttribute('aria-selected', String(k === cur)); });
      v.poster = `/media/${keys[cur]}.jpg`;
      if (loaded) { load(keys[cur]); v.play().catch(() => {}); }
    }
    items.forEach((li, i) => li.querySelector('button').addEventListener('click', () => show(i)));
    v.addEventListener('ended', () => show(cur + 1));
    v.addEventListener('timeupdate', () => { $('tp').style.width = (v.duration ? v.currentTime / v.duration * 100 : 0) + '%'; });
    if ('IntersectionObserver' in window) new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { if (!loaded) { loaded = true; load(keys[cur]); } v.play().catch(() => {}); } else v.pause();
    }), { threshold: .35 }).observe($('slide'));
    show(0);
    let sx = null;
    $('slide').addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
    $('slide').addEventListener('touchend', e => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) show(cur + (dx < 0 ? 1 : -1)); sx = null; });
  })();

  // ── Savings calculator ──
  (() => {
    const box = $('tools'); if (!box) return;
    const TOOLS = [
      ['Lead lists, comps and mortgage data', 'PropStream Essentials', 99, true],
      ['Seller funnel / page builder', 'ClickFunnels', 97, true],
      ['Driving for dollars', 'DealMachine', 119, true],
      ['Deal analysis app', 'DealCheck Pro, billed monthly', 29, true],
      ['Rehab estimating', 'FlipperForce Solo', 79, true],
      ['Deal tracking / CRM', 'REsimpli. Untick if you use its dialer and texting.', 149, false],
      ['Contracts / e-signature', 'DocuSign Personal. JStar Pro fills the contract; you still sign it.', 11, false],
    ];
    box.innerHTML = TOOLS.map(([n, d, a, on], i) => `<div class="tool ${on ? '' : 'off'}"><input type="checkbox" id="t${i}" ${on ? 'checked' : ''}><label for="t${i}"><b>${n}</b><span>${d}</span></label><div class="amt"><span>$</span><input type="text" inputmode="numeric" value="${a}" placeholder="0" aria-label="${n} monthly cost"><span>/mo</span></div></div>`).join('');
    const money = n => '$' + Math.round(n).toLocaleString();
    function total() {
      let now = 0;
      box.querySelectorAll('.tool').forEach(t => {
        const on = t.querySelector('input[type=checkbox]').checked; t.classList.toggle('off', !on);
        const val = Number(String(t.querySelector('.amt input').value).replace(/[^\d.]/g, '')) || 0;
        if (on) now += val;
      });
      const ours = Number($('planSel').value), diff = (now - ours) * 12;
      $('now').textContent = money(now) + '/mo'; $('ours').textContent = money(ours) + '/mo';
      $('saveLbl').textContent = diff >= 0 ? 'You\'d save each year' : 'Extra each year';
      $('save').textContent = money(Math.abs(diff));
    }
    box.addEventListener('input', e => {
      if (e.target.matches('.amt input')) { const cb = e.target.closest('.tool').querySelector('input[type=checkbox]'); if (e.target.value && !cb.checked) cb.checked = true; }
      total();
    });
    $('planSel').addEventListener('change', total);
    total();
  })();
})();
