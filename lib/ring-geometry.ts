/** SVG dash geometry that keeps each visible arc inside its actual time interval. */
export function ringArc(startedAt: number, milliseconds: number, dayStartedAt: number, dayMilliseconds: number, circumference: number) {
  const offset = (startedAt - dayStartedAt) / dayMilliseconds * circumference;
  const length = milliseconds / dayMilliseconds * circumference;
  const gap = Math.min(0.5, length * 0.1);
  return { offset: offset + gap, length: Math.max(0, length - gap * 2) };
}
