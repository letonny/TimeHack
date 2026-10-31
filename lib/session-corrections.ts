import { summarizeSession, type Session } from './timer.ts';

export type CorrectedSet = { id: string; expectedRevision: number; segments: { startedAt: number; endedAt: number }[] };
export type IntervalCorrection = { segments: { kind: Session['segments'][number]['kind']; startedAt: number; endedAt: number }[]; sets: CorrectedSet[] };

export function correctionAvailability(status: { ready: boolean; online: boolean; pending: number; busy: boolean; conflict: boolean }): string | null {
  return status.ready && status.online && status.pending === 0 && !status.busy && !status.conflict
    ? null : 'Time corrections require a connection and a fully synchronized account. Sync pending changes, then retry.';
}

export function validateIntervalCorrection(session: Session, correction: IntervalCorrection, now: number): Session {
  if (session.entryType !== 'timer' || session.endedAt === null || session.startedAt === null) throw new Error('Complete the timer session before editing its intervals.');
  if (correction.segments.length !== session.segments.length) throw new Error('The number of intervals cannot change.');
  let previous = -Infinity;
  const segments = correction.segments.map((part, index) => {
    if (part.kind !== session.segments[index].kind || !Number.isSafeInteger(part.startedAt) || !Number.isSafeInteger(part.endedAt)
      || part.startedAt < 0 || part.endedAt > now || part.endedAt < part.startedAt || part.startedAt < previous)
      throw new Error('Intervals must have valid, ordered start and end timestamps.');
    previous = part.endedAt;
    return part;
  });
  const first = segments[0].startedAt;
  const last = segments.at(-1)!.endedAt;
  const knownSets = new Map((session.sets ?? []).map(item => [item.id, item]));
  if (correction.sets.length !== knownSets.size || new Set(correction.sets.map(item => item.id)).size !== knownSets.size)
    throw new Error('Every SET must be included exactly once.');
  let previousSetEnd = -Infinity;
  const sets = correction.sets.map(item => {
    const original = knownSets.get(item.id);
    if (!original || original.segments.length !== item.segments.length) throw new Error('SET intervals cannot be added or removed.');
    let previousPartEnd = -Infinity;
    for (const part of item.segments) {
      if (!Number.isSafeInteger(part.startedAt) || !Number.isSafeInteger(part.endedAt) || part.endedAt < part.startedAt
        || part.startedAt < previousPartEnd || part.startedAt < previousSetEnd
        || !segments.some(parent => parent.kind === 'study' && parent.startedAt <= part.startedAt && parent.endedAt >= part.endedAt))
        throw new Error('SET intervals must be ordered, nonoverlapping, and inside activity time.');
      previousPartEnd = part.endedAt;
      previousSetEnd = part.endedAt;
    }
    return { ...original, segments: item.segments };
  });
  if (session.tripPhase) {
    const kinds = segments.map(item => item.kind);
    if (kinds[0] !== 'travel_out' || !kinds.includes('study') || kinds.slice(1).includes('travel_out')
      || (kinds.includes('travel_return') && kinds.lastIndexOf('travel_return') !== kinds.length - 1)
      || (kinds.includes('travel_return') && kinds.indexOf('travel_return') < kinds.lastIndexOf('study')))
      throw new Error('Trip phase order cannot change.');
  } else if (segments.some(item => item.kind === 'travel_out' || item.kind === 'travel_return')) throw new Error('Travel requires Trip Mode.');
  const next = { ...session, startedAt: first, endedAt: last, segments, sets };
  summarizeSession(next, now);
  return next;
}
