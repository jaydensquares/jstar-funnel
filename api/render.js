// "Show after repairs": sends one property photo to OpenAI's image editing model and returns a concept image of the
// same space after a typical investor-grade flip. Every result is labeled in the app as an AI concept, not the property.
import { getActor } from '../lib/auth.js';
import { useQuota, refundQuota } from '../lib/usage.js';
import { meter } from '../lib/meter.js';

export const maxDuration = 120;
const MODEL = () => process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2.6-sunburst';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const actor = await getActor(req, b).catch(() => null);
  if (!actor) { await new Promise(r => setTimeout(r, 900)); return res.status(401).json({ error: b.pin ? 'Wrong PIN.' : 'Log in again.' }); }
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "After-repair renderings aren't set up yet." });

  const img = String(b.photo || '');
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img) || img.length > 4_000_000) return res.status(400).json({ error: 'Pick one photo (JPG, PNG or WebP).' });
  const over = await useQuota(actor, 'renders');
  if (over) return res.status(429).json({ error: over });

  const fixes = (Array.isArray(b.repairs) ? b.repairs : []).map(x => String(x || '').trim().slice(0, 80)).filter(Boolean).slice(0, 12);
  const kind = b.kind === 'exterior' ? 'exterior' : b.kind === 'interior' ? 'interior' : 'auto';
  const prompt = `This is a real photo of a distressed house that a real estate investor plans to renovate and resell.
Edit it to show how this exact space could look after a typical investor-grade flip renovation.

Keep exactly the same: camera angle, framing and perspective; room layout and dimensions; walls, ceiling height, window and door positions and sizes; stairs and built-in structure; roofline, footprint, lot, driveway and neighboring houses. Do not add rooms, additions, extra windows, pools, people, pets, vehicles, text, logos or watermarks.

Change: ${fixes.length ? fixes.join('; ') + '; plus ' : ''}fix all visible damage, clutter, trash and stains. Use clean, neutral, mid-range finishes a flipper would use${kind === 'exterior' ? ': fresh exterior paint, new roof shingles where the roof shows, clean siding and trim, a new front door, trimmed lawn and simple landscaping' : kind === 'interior' ? ': neutral light paint, luxury vinyl plank flooring, white shaker cabinets, quartz-look counters, modern but affordable light fixtures and hardware' : ' (neutral paint, LVP flooring, white shaker cabinets with quartz-look counters inside; new roof shingles, fresh paint and trimmed landscaping outside)'}. No luxury upgrades.

Photorealistic, natural daylight, like a real-estate listing photo of the finished flip.`;

  try {
    const r = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), images: [{ image_url: img }], prompt, size: 'auto', quality: 'medium', output_format: 'jpeg', output_compression: 82, n: 1 }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.data?.[0]?.b64_json) {
      console.error('render openai', r.status, JSON.stringify(j).slice(0, 400));
      await refundQuota(actor, 'renders');
      const msg = j.error?.code === 'moderation_blocked' ? "That photo couldn't be edited. Try a different photo of the house." : r.status === 429 ? 'Too many renderings at once. Try again in a minute.' : r.status === 401 || r.status === 403 ? "After-repair renderings aren't set up correctly yet." : "The rendering didn't come through. Try again.";
      return res.status(502).json({ error: msg });
    }
    meter('openai_image', 1, { model: MODEL() });
    return res.status(200).json({ image: `data:image/jpeg;base64,${j.data[0].b64_json}` });
  } catch (e) {
    console.error('render', e);
    await refundQuota(actor, 'renders');
    return res.status(502).json({ error: "The rendering didn't come through. Try again." });
  }
}
