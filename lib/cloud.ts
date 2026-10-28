import { emptyState, type Habit, type Session, type TimerState } from './timer.ts';

export type Change = {
  eventId: string; entityType: 'habit' | 'session'; entityId: string;
  action: 'save' | 'delete' | 'import'; expectedRevision: number;
  payload: Habit | Session | Record<string, never>; occurredAt: string;
};
export type CloudCache = { version: 1; userId: string; state: TimerState; revisions: Record<string, number>; queue: Change[] };
export const cloudKey = (userId: string) => `timehack.cloud.v1.${userId}`;
export const LEGACY_CLAIM_KEY = 'timehack.legacy.claim.v1';
export const revisionKey = (type: Change['entityType'], id: string) => `${type}:${id}`;
export function newCache(userId: string): CloudCache { return { version: 1, userId, state: emptyState(), revisions: {}, queue: [] }; }
export function readCache(storage: Pick<Storage, 'getItem'>, userId: string): CloudCache | null {
  const raw = storage.getItem(cloudKey(userId));
  if (!raw) return null;
  const parsed = JSON.parse(raw) as CloudCache;
  if (parsed.version !== 1 || parsed.userId !== userId || !parsed.state || !Array.isArray(parsed.queue) || !parsed.revisions)
    throw new Error('Invalid account cache');
  return parsed;
}
export function writeCache(storage: Pick<Storage, 'setItem'>, cache: CloudCache) {
  storage.setItem(cloudKey(cache.userId), JSON.stringify(cache));
}
export function nextChange(cache: CloudCache, entityType: Change['entityType'], entityId: string, action: Change['action'], payload: Change['payload']): Change {
  const key = revisionKey(entityType, entityId);
  return { eventId: crypto.randomUUID(), entityType, entityId, action,
    expectedRevision: (cache.revisions[key] ?? 0) + cache.queue.filter(item => item.entityType === entityType && item.entityId === entityId).length,
    payload, occurredAt: new Date().toISOString() };
}
type HabitRow = { user_id: string; id: string; name: string; goal_minutes: number; revision: number; deleted_at: string | null };
type SessionRow = { user_id: string; id: string; name: string; started_at: string; ended_at: string | null; revision: number; deleted_at: string | null };
type SegmentRow = { user_id: string; session_id: string; position: number; kind: 'study' | 'break'; started_at: string; ended_at: string | null };
export function mapRows(userId: string, habits: HabitRow[], sessions: SessionRow[], segments: SegmentRow[]): Pick<CloudCache, 'state' | 'revisions'> {
  if ([...habits, ...sessions, ...segments].some(row => row.user_id !== userId)) throw new Error('Account data mismatch');
  const revisions: Record<string, number> = {};
  const state = emptyState();
  for (const row of habits) {
    revisions[revisionKey('habit', row.id)] = row.revision;
    if (!row.deleted_at) state.habits.push({ id: row.id, name: row.name, goalMinutes: row.goal_minutes });
  }
  for (const row of sessions) {
    revisions[revisionKey('session', row.id)] = row.revision;
    if (row.deleted_at) continue;
    const parts = segments.filter(part => part.session_id === row.id).sort((a, b) => a.position - b.position);
    if (!parts.length) throw new Error('A cloud session is missing its segments');
    const session: Session = { id: row.id, name: row.name, startedAt: Date.parse(row.started_at), endedAt: row.ended_at ? Date.parse(row.ended_at) : null,
      segments: parts.map(part => ({ kind: part.kind, startedAt: Date.parse(part.started_at), endedAt: part.ended_at ? Date.parse(part.ended_at) : null })) };
    if (session.endedAt === null) {
      if (state.active) throw new Error('Multiple active cloud sessions');
      state.active = session;
    } else state.completed.push(session);
  }
  state.completed.sort((a, b) => b.endedAt! - a.endedAt!);
  return { state, revisions };
}
export function canOfferImport(storage: Pick<Storage, 'getItem'>, userId: string, hasLegacyData: boolean): boolean {
  const claimed = storage.getItem(LEGACY_CLAIM_KEY);
  return hasLegacyData && (!claimed || claimed === userId);
}
