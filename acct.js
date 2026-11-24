// Shared by the tool pages: lets logged-in account users in without the owner PIN,
// shows their business name in the header, and sends them to log in when a session expires.
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // ?owner in the URL forces the owner PIN screen, even if a customer account is logged in on this browser
  const ownerMode = new URLSearchParams(location.search).has('owner');
  // Hide the owner PIN box until we know whether someone is logged in, so it doesn't flash on every page change.
  // It shows again if there's no usable login (or after 3s if the check hangs).
  const root = document.documentElement;
  let me = null;
  if (!ownerMode) {
    root.classList.add('chk');
    const st = document.createElement('style'); st.textContent = 'html.chk #gate{display:none!important}'; root.appendChild(st);
    me = fetch('/api/auth?action=me', { credentials: 'same-origin' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
    const reveal = () => root.classList.remove('chk');
    me.then(j => { if (!j?.user || j.plan?.tier === 'trial') reveal(); });
    setTimeout(reveal, 3000);
  }
  window.acctUnlock = cb => ownerMode ? Promise.resolve() : me
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
