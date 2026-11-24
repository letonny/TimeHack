export class SessionLimitError extends Error {}

// JSONB prints one space after each structural comma and colon, and prints
// numeric values in decimal. Object key order has no effect on the byte count.
export function sessionPayloadBytes(payload: unknown): number {
  const json = JSON.stringify(payload);
  let bytes = new TextEncoder().encode(json).length;
  const tokens = /"(?:[^"\\]|\\.)*"|[:,]|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi;
  for (const [token] of json.matchAll(tokens)) {
    if (token === ',' || token === ':') bytes++;
    else if (token[0] !== '"' && token.includes('e')) {
      const [coefficient, exponent] = token.replace(/^-/, '').split('e');
      const digits = coefficient.replace('.', '').length;
      const point = coefficient.split('.')[0].length + Number(exponent);
      const decimalLength = point <= 0 ? 2 - point + digits : Math.max(point, digits) + Number(point < digits);
      bytes += decimalLength - token.length + Number(token.startsWith('-'));
    }
  }
  return bytes;
}

export function validateSessionSize(payload: object) {
  if ('segments' in payload && Array.isArray(payload.segments) && payload.segments.length > 1000)
    throw new SessionLimitError('This session exceeds 1,000 segments. The change could not be queued.');
  if (sessionPayloadBytes(payload) > 1048576)
    throw new SessionLimitError('This session exceeds the 1 MiB sync limit. The change could not be queued.');
}
