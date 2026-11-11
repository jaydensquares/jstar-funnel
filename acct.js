// Shared by the tool pages: lets logged-in account users in without the owner PIN,
// shows their business name in the header, and sends them to log in when a session expires.
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  window.acctUnlock = cb => fetch('/api/auth?action=me', { credentials: 'same-origin' })
    .then(r => (r.ok ? r.json() : null))
    .then(j => {
      if (!j?.user) return;
      if (j.plan?.tier === 'trial') { location.replace('/app#account'); return; } // no plan yet: pay first
      window.ACCT = j.user;
      document.body.classList.add('acct');
      const ws = document.getElementById('ws');
      if (ws) ws.textContent = j.user.company || j.user.name;
      document.title = document.title.replace('JStar Acquisitions', j.user.company || j.user.name);
      cb(j.user);
    }).catch(() => {});
  window.acctExpired = () => {
    if (!window.ACCT) return false;
    location.href = '/login?next=' + encodeURIComponent(location.pathname + location.hash);
    return true;
  };
})();
