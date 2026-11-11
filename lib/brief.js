// Short numbers summary of an analysis (used by Run deal, Batch and lead inboxes)
const num = v => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };

export function brief(p) {
  const asking = num(p.lead.asking);
  const m = p.mortgage;
  const base = { label: p.score?.label || null, score: p.score?.score ?? null, asking, land: !!p.land,
    reasons: (p.score?.reasons || []).slice(0, 6), sqft: num(p.lead.sqft),
    // Compact extras for the dashboard visuals (offer ladder, equity, comps chart)
    mortgage: m ? { balance: m.balance ?? null, equity: m.ourEquity ?? null, equityPct: m.equityPct ?? null, freeClear: !!m.freeClear, underwater: !!m.underwater,
      preForeclosure: !!m.flags?.preForeclosure, auction: !!m.flags?.auction, loans: (m.loans || []).length } : null,
    comps: (p.comps || []).slice(0, 10).map(c => ({ a: String(c.formattedAddress || '').split(',')[0], price: c.price, sqft: c.squareFootage, ppsf: c.ppsf, mi: c.distance, sold: !!c.sold })),
    fee: p.config?.assignmentFee ?? null };
  if (p.land) {
    const d = p.deal;
    return { ...base, value: d?.value ?? p.valuation?.value ?? null, mao: d?.mao ?? null, opening: d?.opening ?? null,
      call: d?.call?.text || 'No numbers (thin land comps or no lot size).', confidence: p.valuation?.confidence || null };
  }
  const a = p.analysis;
  const ws = a?.strategies?.find(s => s.key === 'wholesale');
  return { ...base, value: p.valuation?.arv ?? null, repairs: p.repairs?.total ?? null, arvRange: p.valuation?.arvRange || null,
    buyerPrice: ws?.pitch?.price ?? null,
    mao: ws?.headline?.value ?? null, opening: ws?.headline?.opening ?? null,
    call: !a ? 'No numbers (check comps/sqft).' : a.outOfBox ? 'Outside buy box.' : !a.recommended ? (a.why || 'Pass.') : a.why,
    confidence: p.valuation?.confidence || null };
}

// Where a lead came from, from its UTM tags / click IDs
export function leadSource(t = {}) {
  const src = String(t.utm_source || '').toLowerCase();
  if (t.gclid || t.gbraid || t.wbraid || /google|adwords/.test(src)) return t.gclid || t.gbraid || t.wbraid || t.utm_medium === 'cpc' ? 'Google Ads' : 'Google';
  if (t.fbclid || /facebook|instagram|^fb|^ig|meta/.test(src)) return 'Meta';
  if (src) return t.utm_source;
  if (/google\./.test(t.referrer || '')) return 'Google (organic)';
  if (/facebook|instagram/.test(t.referrer || '')) return 'Meta (organic)';
  return t.referrer ? 'Referral' : 'Direct';
}
