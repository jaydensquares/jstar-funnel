#!/usr/bin/env node
// Local test server: the seller page + the backend, same as Vercel runs them.
//   RENTCAST_API_KEY=xxx npm run dev   → open http://localhost:3000, fill out the form
// Without email keys, each deal sheet is saved to ./leads/ and printed here.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.DEV_SAVE_DIR ||= path.join(root, 'leads');
const handlers = {};
for (const f of fs.readdirSync(path.join(root, 'api')).filter(f => f.endsWith('.js'))) {
  handlers['/api/' + f.replace(/\.js$/, '')] = (await import(path.join(root, 'api', f))).default;
}
const PORT = Number(process.env.PORT) || 3000;

http.createServer(async (req, res) => {
  const handler = handlers[req.url.split('?')[0]];
  if (handler) {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
    // Minimal Vercel-style response helpers
    res.status = code => { res.statusCode = code; return res; };
    res.json = obj => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
    try { await handler(req, res); } catch (e) { console.error(e); res.statusCode = 500; res.end('{"error":"server error"}'); }
    return;
  }
  const pathname = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(root, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('Not found'); }
  res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : 'text/plain');
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Funnel running → http://localhost:${PORT}\nDeal sheets save to ${process.env.DEV_SAVE_DIR}`));
