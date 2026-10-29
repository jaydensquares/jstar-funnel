import crypto from 'node:crypto';

// Timing-safe check against OPERATOR_PIN
export function pinMatches(given) {
  const want = String(process.env.OPERATOR_PIN || '');
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(want).digest();
  return want.length >= 4 && crypto.timingSafeEqual(a, b);
}
