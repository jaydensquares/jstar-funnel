// Tiny JSON document store on the private Vercel Blob store.
// A document "key" (e.g. users/abc123) is saved as immutable versions <key>/<timestamp>.json;
// the newest version wins. Writing a new file per save avoids stale CDN reads after overwrites.
let sdk = null;
export function _setSdk(s) { sdk = s; } // tests
async function blob() { return sdk || (sdk = await import('@vercel/blob')); }

const KEY = /^[a-z0-9][a-z0-9/_.-]{0,200}$/;
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

async function blobsUnder(prefix) {
  const { list } = await blob();
  const out = []; let cursor;
  do {
    const r = await list({ prefix, cursor, limit: 1000 });
    out.push(...r.blobs); cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}

async function readPath(pathname) {
  const { get } = await blob();
  const r = await get(pathname, { access: 'private' });
  if (!r || (r.statusCode && r.statusCode !== 200) || !r.stream) return null;
  return JSON.parse(await new Response(r.stream).text());
}

// Group version files by document key → newest pathname
function latestByKey(blobs) {
  const by = new Map();
  for (const b of blobs) {
    const m = b.pathname.match(/^(.+)\/(\d{10,})\.json$/);
    if (!m) continue;
    const cur = by.get(m[1]);
    if (!cur || Number(m[2]) > cur.ts) by.set(m[1], { ts: Number(m[2]), pathname: b.pathname, all: [...(cur?.all || []), b] });
    else cur.all.push(b);
  }
  return by;
}

export async function getDoc(key) {
  if (!KEY.test(key)) return null;
  const v = latestByKey(await blobsUnder(key + '/')).get(key);
  return v ? readPath(v.pathname) : null;
}

export async function putDoc(key, obj, { keep = 3 } = {}) {
  if (!KEY.test(key)) throw new Error('bad key');
  const { put, del } = await blob();
  const ts = Date.now();
  await put(`${key}/${ts}.json`, JSON.stringify(obj), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
  const old = (await blobsUnder(key + '/')).filter(b => /\/\d{10,}\.json$/.test(b.pathname) && b.pathname.slice(key.length + 1).indexOf('/') === -1)
    .sort((a, b) => b.pathname.localeCompare(a.pathname)).slice(keep);
  if (old.length) await del(old.map(b => b.url)).catch(() => {});
  return obj;
}

export async function deleteDoc(key) {
  if (!KEY.test(key)) return false;
  const { del } = await blob();
  const all = (await blobsUnder(key + '/')).filter(b => b.pathname.slice(key.length + 1).indexOf('/') === -1);
  if (all.length) await del(all.map(b => b.url));
  return all.length > 0;
}

// All documents directly under a collection prefix, e.g. listDocs('t/abc/deals') → each deal's newest version
export async function listDocs(collection) {
  const latest = latestByKey(await blobsUnder(collection + '/'));
  const keys = [...latest.keys()].filter(k => k.slice(collection.length + 1).indexOf('/') === -1);
  const docs = await Promise.all(keys.map(k => readPath(latest.get(k).pathname).catch(() => null)));
  return docs.filter(Boolean);
}

// Delete every document under a prefix (e.g. a whole account's t/<uid>/ data)
export async function deleteTree(prefix) {
  if (!KEY.test(prefix)) return 0;
  const { del } = await blob();
  const all = await blobsUnder(prefix.replace(/\/?$/, '/'));
  for (let i = 0; i < all.length; i += 500) await del(all.slice(i, i + 500).map(b => b.url));
  return all.length;
}

// How many documents sit directly under a collection, without reading them
export async function countDocs(collection) {
  const latest = latestByKey(await blobsUnder(collection + '/'));
  return [...latest.keys()].filter(k => k.slice(collection.length + 1).indexOf('/') === -1).length;
}
