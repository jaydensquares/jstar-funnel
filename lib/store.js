// Deal storage on a private Vercel Blob store.
// Each save writes a new immutable file deals/<id>/<timestamp>.json (no CDN staleness on overwrite);
// the newest file per id is the current version and older ones are cleaned up.
let sdk = null;
export function _setSdk(s) { sdk = s; } // tests
async function blob() { return sdk || (sdk = await import('@vercel/blob')); }

const ID = /^[a-z0-9]{6,32}$/;
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

async function readJson(pathname) {
  const { get } = await blob();
  const r = await get(pathname, { access: 'private' });
  if (!r || (r.statusCode && r.statusCode !== 200) || !r.stream) return null;
  return JSON.parse(await new Response(r.stream).text());
}

async function versions(prefix) {
  const { list } = await blob();
  const out = []; let cursor;
  do {
    const r = await list({ prefix, cursor, limit: 1000 });
    out.push(...r.blobs); cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}

const groupLatest = blobs => {
  const by = new Map();
  for (const b of blobs) {
    const m = b.pathname.match(/^deals\/([a-z0-9]+)\/(\d+)\.json$/);
    if (!m) continue;
    const cur = by.get(m[1]);
    if (!cur || Number(m[2]) > cur.ts) by.set(m[1], { ts: Number(m[2]), pathname: b.pathname, all: [...(cur?.all || []), b] });
    else cur.all.push(b);
  }
  return by;
};

export async function listDeals() {
  const latest = groupLatest(await versions('deals/'));
  const deals = await Promise.all([...latest.values()].map(v => readJson(v.pathname).catch(() => null)));
  return deals.filter(Boolean).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getDeal(id) {
  if (!ID.test(id)) return null;
  const v = groupLatest(await versions(`deals/${id}/`)).get(id);
  return v ? readJson(v.pathname) : null;
}

export async function saveDeal(deal) {
  const { put, del } = await blob();
  if (!deal.id || !ID.test(deal.id)) deal.id = newId();
  const now = Date.now();
  deal.createdAt ||= now; deal.updatedAt = now;
  await put(`deals/${deal.id}/${now}.json`, JSON.stringify(deal), { access: 'private', addRandomSuffix: false, contentType: 'application/json' });
  // Clean up older versions (keep the 3 newest in case something goes wrong)
  const old = (await versions(`deals/${deal.id}/`)).sort((a, b) => b.pathname.localeCompare(a.pathname)).slice(3);
  if (old.length) await del(old.map(b => b.url)).catch(() => {});
  return deal;
}

export async function deleteDeal(id) {
  if (!ID.test(id)) return false;
  const { del } = await blob();
  const all = await versions(`deals/${id}/`);
  if (all.length) await del(all.map(b => b.url));
  return all.length > 0;
}
