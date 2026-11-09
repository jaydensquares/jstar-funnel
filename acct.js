// Shared by the tool pages: lets logged-in account users in without the owner PIN,
// shows their business name in the header, and sends them to log in when a session expires.
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  window.acctUnlock = cb => fetch('/api/auth?action=me', { credentials: 'same-origin' })
    .then(r => (r.ok ? r.json() : null))
    .then(j => {
      if (!j?.user) return;
      window.ACCT = j.user;
      document.body.classList.add('acct');
      const logo = document.querySelector('header .logo');
      if (logo) { const p = esc(j.user.company || j.user.name).split(' '); logo.innerHTML = p.length > 1 ? `${p[0]} <span>${p.slice(1).join(' ')}</span>` : p[0]; logo.href = '/app.html'; }
      cb(j.user);
    }).catch(() => {});
  window.acctExpired = () => {
    if (!window.ACCT) return false;
    location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.hash);
    return true;
  };
})();
