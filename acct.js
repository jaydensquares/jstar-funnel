// Shared by the tool pages: lets logged-in account users in without the owner PIN,
// shows their business name in the header, and sends them to log in when a session expires.
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // ?owner in the URL forces the owner PIN screen, even if a customer account is logged in on this browser
  const ownerMode = new URLSearchParams(location.search).has('owner');
  window.acctUnlock = cb => ownerMode ? Promise.resolve() : fetch('/api/auth?action=me', { credentials: 'same-origin' })
    .then(r => (r.ok ? r.json() : null))
    .then(j => {
      if (!j?.user) return;
      if (j.plan?.tier === 'trial') { // no plan yet: keep the PIN screen (for the owner) and point customers to billing
        const g = document.getElementById('gate');
        if (g && !g.querySelector('.noplan')) g.insertAdjacentHTML('afterbegin', '<p class="banner noplan" style="margin:0 0 16px">You\'re logged in as ' + esc(j.user.email) + ', which doesn\'t have a plan yet. <a href="/app#account">Choose a plan</a>, or enter the owner PIN below.</p>');
        return;
      }
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
