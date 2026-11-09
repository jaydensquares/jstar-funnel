// Deals, scoped per account: owner (PIN) deals live at deals/<id>, user deals at t/<uid>/deals/<id>
import { getDoc, putDoc, deleteDoc, listDocs, newId, _setSdk as _db } from './db.js';
export { newId };
export const _setSdk = _db;

const ID = /^[a-z0-9]{6,32}$/;
const col = scope => (scope ? `t/${scope}/deals` : 'deals');

export async function listDeals(scope = '') {
  return (await listDocs(col(scope))).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
export async function getDeal(id, scope = '') { return ID.test(id) ? getDoc(`${col(scope)}/${id}`) : null; }
export async function saveDeal(deal, scope = '') {
  if (!deal.id || !ID.test(deal.id)) deal.id = newId();
  const now = Date.now(); deal.createdAt ||= now; deal.updatedAt = now;
  return putDoc(`${col(scope)}/${deal.id}`, deal);
}
export async function deleteDeal(id, scope = '') { return ID.test(id) ? deleteDoc(`${col(scope)}/${id}`) : false; }
