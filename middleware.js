// Custom domains: when a request comes in on a customer's own domain, show their funnel.
// jstaracquire.com, *.vercel.app and localhost are left alone.
import { rewrite } from '@vercel/functions';

export const config = { matcher: ['/', '/privacy', '/terms', '/privacy.html', '/terms.html'] };

const OWN = /(^|\.)jstaracquire\.com$|\.vercel\.app$|^localhost$|^127\.0\.0\.1$/i;
const PLATFORM = /(^|\.)getjstarpro\.com$/i; // JStar Pro's own domain

export default function middleware(request) {
  const url = new URL(request.url);
  const host = (request.headers.get('host') || url.hostname).toLowerCase().replace(/:\d+$/, '');
  if (PLATFORM.test(host)) {
    if (url.pathname === '/') return rewrite(new URL('/software', request.url));
    const legal = url.pathname.replace(/^\/|\.html$/g, '');
    if (legal === 'terms' || legal === 'privacy') return rewrite(new URL(`/legal/${legal}`, request.url));
    return;
  }
  if (OWN.test(host)) return; // normal site
  const page = url.pathname.replace(/^\//, '').replace(/\.html$/, '');
  const dest = new URL(`/api/funnel?host=${encodeURIComponent(host)}${page ? `&page=${page}` : ''}`, request.url);
  return rewrite(dest);
}
