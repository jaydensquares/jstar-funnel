// JStar Pro marketing site: menu, lazy product clips, video players, sticky trial bar, affiliate/referral capture.
(() => {
  const $ = id => document.getElementById(id);
  document.querySelectorAll('[data-yr]').forEach(e => { e.textContent = new Date().getFullYear(); });

  // Product menu (desktop dropdown, full-screen on phones)
  const btn = $('prodBtn'), burger = $('burger'), mega = $('mega');
  if (mega) {
    let opener = null;
    const set = open => {
      mega.hidden = !open; btn?.setAttribute('aria-expanded', String(open)); burger?.setAttribute('aria-expanded', String(open));
      document.body.style.overflow = open && matchMedia('(max-width:980px)').matches ? 'hidden' : '';
      if (!open && opener) { opener.focus(); opener = null; }
    };
    const toggle = e => { e.stopPropagation(); opener = e.currentTarget; set(mega.hidden); if (!mega.hidden) mega.querySelector('a')?.focus({ preventScroll: true }); };
    btn?.addEventListener('click', toggle); burger?.addEventListener('click', toggle);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !mega.hidden) set(false); });
    document.addEventListener('click', e => { if (!mega.hidden && !mega.contains(e.target)) { opener = null; set(false); } });
    mega.addEventListener('click', e => { if (e.target.closest('a[href^="#"]')) { opener = null; set(false); } });
  }

  // Product clips: load and play only while on screen
  const clips = [...document.querySelectorAll('video[data-src]')];
  if (clips.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => es.forEach(e => {
      const v = e.target;
      if (e.isIntersecting) { if (!v.src) { v.src = v.dataset.src; } v.play().catch(() => {}); } else if (v.src) v.pause();
    }), { threshold: .3 });
    clips.forEach(v => io.observe(v));
  }

  // Click-to-play videos with sound (VSLs)
  document.querySelectorAll('[data-vsl]').forEach(box => {
    const b = box.querySelector('button.play'); if (!b) return;
    b.addEventListener('click', () => { box.innerHTML = `<video poster="${box.dataset.poster}" controls autoplay playsinline><source src="${box.dataset.vsl}" type="video/mp4"></video>`; });
  });
  document.querySelectorAll('[data-watch]').forEach(a => a.addEventListener('click', e => {
    const box = $(a.dataset.watch); if (!box) return; e.preventDefault();
    box.scrollIntoView({ behavior: 'smooth', block: 'center' }); box.querySelector('button.play')?.click();
  }));

  // Phones: sticky trial button once the hero buttons scroll away, hidden over pricing and the final CTA
  (() => {
    const st = $('stick'); if (!st || !('IntersectionObserver' in window)) return; document.body.classList.add('has-stick');
    const seen = new Map(), watch = [document.querySelector('.hero .ctas'), $('pricing'), document.querySelector('.final')].filter(Boolean);
    const io = new IntersectionObserver(es => { es.forEach(x => seen.set(x.target, x.isIntersecting)); const on = seen.size === watch.length && ![...seen.values()].some(Boolean);
      st.classList.toggle('on', on); st.setAttribute('aria-hidden', String(!on)); st.querySelector('a').tabIndex = on ? 0 : -1; }, { threshold: 0 });
    watch.forEach(el => io.observe(el));
  })();

  // Affiliate links (?via=code): remembered 60 days, counted once per browser. Referral links (?ref=username): remembered for signup.
  try {
    const q = new URLSearchParams(location.search), v = (q.get('via') || '').toLowerCase();
    if (/^[a-z0-9-]{3,24}$/.test(v)) {
      localStorage.setItem('jsVia', JSON.stringify({ c: v, at: Date.now() }));
      if (localStorage.getItem('jsViaSeen') !== v) { localStorage.setItem('jsViaSeen', v); fetch('/api/affiliate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'click', code: v }) }).catch(() => {}); }
    }
    const rf = q.get('ref'); if (rf && /^[a-z0-9-]{3,30}$/i.test(rf)) localStorage.setItem('jsRef', rf.toLowerCase());
  } catch {}
})();

// Light / dark switch: follows the device until the visitor picks one, then remembers it
(() => {
  const b = document.getElementById('themeBtn'); if (!b) return;
  const root = document.documentElement, mq = matchMedia('(prefers-color-scheme: dark)');
  b.addEventListener('click', () => {
    const cur = root.dataset.theme || (mq.matches ? 'dark' : 'light'), next = cur === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next; try { localStorage.setItem('jtheme', next); } catch {}
  });
})();
