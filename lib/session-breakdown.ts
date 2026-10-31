import { summarizeSession, type Session } from './timer.ts';

export type BreakdownRow = {
  kind: 'activity' | 'set' | 'break' | 'travel_out' | 'travel_return';
  label: string;
  startedAt: number;
  endedAt: number;
  milliseconds: number;
  setId?: string;
};

export type SessionBreakdown = {
  sessionId: string;
  name: string;
  countsProductive: boolean;
  rows: BreakdownRow[];
  activityMilliseconds: number;
  productiveMilliseconds: number;
  personalMilliseconds: number;
  breakMilliseconds: number;
  travelMilliseconds: number;
  recordedMilliseconds: number;
  commitmentMilliseconds: number;
};

/** Splits parent activity time around persisted SET intervals; SETs never add time. */
export function sessionBreakdown(session: Session, now: number): SessionBreakdown {
  const summary = summarizeSession(session, now);
  const rows: BreakdownRow[] = [];
  const add = (kind: BreakdownRow['kind'], label: string, startedAt: number, endedAt: number, setId?: string) => {
    if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt) return;
    rows.push({ kind, label, startedAt, endedAt, milliseconds: endedAt - startedAt, ...(setId ? { setId } : {}) });
  };
  for (const segment of session.segments) {
    const from = segment.startedAt;
    const to = segment.endedAt ?? now;
    if (to <= from) continue;
    if (segment.kind === 'break') { add('break', 'Break', from, to); continue; }
    if (segment.kind === 'travel_out') { add('travel_out', session.destination ? `Travel to ${session.destination}` : 'Outbound travel', from, to); continue; }
    if (segment.kind === 'travel_return') { add('travel_return', session.returnDestination ? `Return trip to ${session.returnDestination}` : 'Return trip', from, to); continue; }
    const children = (session.sets ?? []).flatMap(set => set.segments.map(part => ({
      id: set.id, label: set.description?.trim() || 'SET',
      startedAt: Math.max(from, part.startedAt), endedAt: Math.min(to, part.endedAt ?? now),
    }))).filter(part => part.endedAt > part.startedAt).sort((a, b) => a.startedAt - b.startedAt || a.endedAt - b.endedAt || a.id.localeCompare(b.id));
    let cursor = from;
    for (const child of children) {
      const childFrom = Math.max(cursor, child.startedAt);
      if (childFrom >= child.endedAt) continue;
      add('activity', session.name || 'Activity', cursor, childFrom);
      add('set', child.label, childFrom, child.endedAt, child.id);
      cursor = child.endedAt;
    }
    add('activity', session.name || 'Activity', cursor, to);
  }
  return {
    sessionId: session.id, name: session.name || 'Activity', countsProductive: session.countsProductive !== false,
    rows, activityMilliseconds: summary.studyMilliseconds,
    productiveMilliseconds: summary.productiveMilliseconds, personalMilliseconds: summary.personalMilliseconds,
    breakMilliseconds: summary.breakMilliseconds, travelMilliseconds: summary.travelMilliseconds,
    recordedMilliseconds: summary.trackedMilliseconds, commitmentMilliseconds: summary.commitmentMilliseconds,
  };
}

/** Returns only the visible portions of a parent activity slice for the ring. */
export function activityPiecesForSlice(session: Session, startedAt: number, endedAt: number, now: number): BreakdownRow[] {
  return sessionBreakdown(session, now).rows.filter(row => row.kind === 'activity' || row.kind === 'set')
    .map(row => ({ ...row, startedAt: Math.max(startedAt, row.startedAt), endedAt: Math.min(endedAt, row.endedAt) }))
    .filter(row => row.endedAt > row.startedAt)
    .map(row => ({ ...row, milliseconds: row.endedAt - row.startedAt }));
}
