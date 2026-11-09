// Operator: AI photo analysis. Sends property photos to Claude (vision) and returns
// a condition tier, line-item repair estimate, red flags and walkthrough questions.
import { getActor } from '../lib/auth.js';
import { useQuota } from '../lib/usage.js';

export const maxDuration = 60;

const MAX_PHOTOS = 12;
const TIERS = ['turnkey', 'cosmetic', 'moderate', 'heavy', 'gut'];

const REPORT_TOOL = {
  name: 'report',
  description: 'Return the property condition and rehab estimate.',
  input_schema: {
    type: 'object',
    properties: {
      condition: { type: 'string', enum: TIERS, description: 'turnkey = move-in ready; cosmetic = paint/flooring/fixtures; moderate = kitchen/bath updates; heavy = roof/HVAC/foundation/major systems; gut = full gut or teardown' },
      condition_reason: { type: 'string', description: 'One or two sentences on why this tier.' },
      summary: { type: 'string', description: '2–4 sentence plain-English overview for the wholesaler.' },
      repairs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            item: { type: 'string', description: 'Short line item, e.g. "Kitchen cabinets + counters"' },
            low: { type: 'number', description: 'Low cost estimate in USD' },
            high: { type: 'number', description: 'High cost estimate in USD' },
            why: { type: 'string', description: 'What in the photos shows this is needed' },
            photos: { type: 'array', items: { type: 'integer' }, description: 'Photo numbers (1-based) showing this' },
          },
          required: ['item', 'low', 'high', 'why'],
        },
      },
      issues: { type: 'array', items: { type: 'string', enum: ['roof', 'foundation', 'hvac', 'plumbing', 'electrical', 'water_damage', 'windows'] }, description: 'Major systems that look like they need work' },
      red_flags: { type: 'array', items: { type: 'string' }, description: 'Serious concerns: structural, water, mold, fire, code, safety' },
      not_visible: { type: 'array', items: { type: 'string' }, description: 'Important things the photos do not show (roof, HVAC unit, panel, foundation, etc.)' },
      walkthrough_questions: { type: 'array', items: { type: 'string' }, description: 'Questions to ask the seller or check on a walkthrough' },
      confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    },
    required: ['condition', 'condition_reason', 'summary', 'repairs', 'issues', 'red_flags', 'not_visible', 'walkthrough_questions', 'confidence'],
  },
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const actor = await getActor(req, b).catch(() => null);
  if (!actor) { await new Promise(r => setTimeout(r, 900)); return res.status(401).json({ error: b.pin ? 'Wrong PIN.' : 'Log in again.' }); }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ error: 'AI photo analysis isn\'t set up yet. Add ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables, then redeploy.' });

  const photos = (Array.isArray(b.photos) ? b.photos : []).slice(0, MAX_PHOTOS)
    .map(p => String(p || '').match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/))
    .filter(Boolean);
  if (!photos.length) return res.status(400).json({ error: 'Add at least one photo.' });
  const over = await useQuota(actor, 'photos');
  if (over) return res.status(429).json({ error: over });

  const n = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const facts = [
    b.address && `Address: ${String(b.address).slice(0, 200)}`,
    b.state && `State: ${String(b.state).slice(0, 2)}`,
    n(b.sqft) && `Living area: ${n(b.sqft)} sqft`,
    n(b.yearBuilt) && `Year built: ${n(b.yearBuilt)}`,
    b.notes && `Notes from the wholesaler: ${String(b.notes).slice(0, 800)}`,
  ].filter(Boolean).join('\n') || 'No property details given.';

  const content = [];
  photos.forEach(([, media_type, data], i) => {
    content.push({ type: 'text', text: `Photo ${i + 1}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type, data } });
  });
  content.push({ type: 'text', text: `${facts}\n\nAnalyze these ${photos.length} photos and call the report tool.` });

  const system = `You are a residential rehab estimator helping a real estate wholesaler price a house for cash investors (flippers and landlords).
Judge condition only from what the photos show. Estimate repairs at investor-grade contractor pricing (not retail, not luxury finishes) for the property's state; if no state is given assume Texas.
Price each line item for the whole house where relevant (e.g. "Interior paint, whole house", "LVP flooring throughout") using the sqft if given. Include everything a flipper would do to make it sell at full ARV, but do not invent problems you can't see.
List major systems you can't see (roof, HVAC, electrical panel, foundation, plumbing) under not_visible rather than guessing a cost for them, unless the photos show a problem.
Be direct and practical. Reference photo numbers.
Always answer by calling the report tool exactly once. Do not reply with plain text.`;

  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
        max_tokens: 4000,
        system,
        tools: [REPORT_TOOL],
        tool_choice: { type: 'auto' },
        messages: [{ role: 'user', content }],
      }),
    });
  } catch (e) {
    console.error('anthropic fetch', e);
    return res.status(502).json({ error: 'Couldn\'t reach the AI. Try again.' });
  }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    console.error('anthropic', r.status, t.slice(0, 500));
    const msg = r.status === 401 ? 'The ANTHROPIC_API_KEY in Vercel is invalid.'
      : r.status === 429 ? 'AI rate limit hit. Wait a minute and try again.'
      : r.status === 413 ? 'Photos too large. Use fewer photos.'
      : /credit balance/i.test(t) ? 'Your Anthropic account is out of credits. Add credits at console.anthropic.com.'
      : `AI error ${r.status}.`;
    return res.status(502).json({ error: msg });
  }
  const j = await r.json();
  const out = j.content?.find(c => c.type === 'tool_use')?.input;
  if (!out) return res.status(502).json({ error: 'AI returned no report. Try again.' });

  const repairs = (out.repairs || []).map(x => ({
    item: String(x.item || '').slice(0, 60), low: Math.round(x.low || 0), high: Math.round(Math.max(x.high || 0, x.low || 0)),
    why: String(x.why || ''), photos: Array.isArray(x.photos) ? x.photos.filter(Number.isInteger) : [],
  })).filter(x => x.item && x.high > 0);
  const total = repairs.reduce((s, x) => ({ low: s.low + x.low, high: s.high + x.high }), { low: 0, high: 0 });

  return res.status(200).json({
    ok: true,
    condition: TIERS.includes(out.condition) ? out.condition : 'moderate',
    condition_reason: out.condition_reason || '', summary: out.summary || '',
    repairs, total, issues: out.issues || [], red_flags: out.red_flags || [], not_visible: out.not_visible || [],
    walkthrough_questions: out.walkthrough_questions || [], confidence: out.confidence || 'medium',
    photoCount: photos.length,
  });
}
