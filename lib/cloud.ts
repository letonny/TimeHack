import { emptyState, type Activity, type Habit, type HabitReminder, type Profile, type Session, type SessionSet, type TimerState, type Weekday } from './timer.ts';
import { validateReminder } from './reminders.ts';

export type Change = {
  eventId: string; entityType: 'habit' | 'session' | 'activity' | 'profile' | 'reminder' | 'set'; entityId: string;
  action: 'save' | 'delete' | 'import'; expectedRevision: number;
  operation?: 'correct';
  payload: Habit | Session | SessionSet | Activity | Profile | HabitReminder | Record<string, never>; occurredAt: string;
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
  parsed.state.activities ??= [];
  parsed.state.reminders ??= [];
  if (!Array.isArray(parsed.state.reminders)) throw new Error('Invalid reminder cache');
  parsed.state.reminders = parsed.state.reminders.map(validateReminder);
  parsed.state.profile ??= { displayName: '' };
  parsed.state.completed = parsed.state.completed.map(session => ({ entryType: 'timer' as const, localDate: null, durationMilliseconds: null, activityId: null, note: '', ...session, sets: session.sets ?? [] }));
  if (parsed.state.active) parsed.state.active = { entryType: 'timer', localDate: null, durationMilliseconds: null, activityId: null, note: '', ...parsed.state.active, sets: parsed.state.active.sets ?? [] };
  return parsed;
}
export function writeCache(storage: Pick<Storage, 'setItem'>, cache: CloudCache) {
  storage.setItem(cloudKey(cache.userId), JSON.stringify(cache));
}
/** Compare cache contents, not object insertion order changed by hydration. */
export function sameCache(left: CloudCache, right: CloudCache): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]));
    return value;
  };
  const hydrated = (cache: CloudCache) => readCache({ getItem: () => JSON.stringify(cache) }, cache.userId);
  return JSON.stringify(canonical(hydrated(left))) === JSON.stringify(canonical(hydrated(right)));
}
export function nextChange(cache: CloudCache, entityType: Change['entityType'], entityId: string, action: Change['action'], payload: Change['payload'], operation?: Change['operation']): Change {
  const key = revisionKey(entityType, entityId);
  return { eventId: crypto.randomUUID(), entityType, entityId, action,
    expectedRevision: (cache.revisions[key] ?? 0) + cache.queue.filter(item => item.entityType === entityType && item.entityId === entityId).length,
    payload, occurredAt: new Date().toISOString(), ...(operation ? { operation } : {}) };
}
export function sessionChanges(before: Session | null, after: Session | null): Pick<Change, 'entityType' | 'entityId' | 'action' | 'payload' | 'operation'>[] {
  if (!after) return [];
  const changes: Pick<Change, 'entityType' | 'entityId' | 'action' | 'payload' | 'operation'>[] = [];
  const changedSets = (after.sets ?? []).filter(item => {
    const old = before?.sets?.find(previous => previous.id === item.id);
    return !old || JSON.stringify(old) !== JSON.stringify(item);
  });
  // Close existing SETs before pausing/finishing the parent. Create new SETs
  // after a parent transition (including a legacy break -> study transition).
  for (const item of changedSets.filter(item => before?.sets?.some(old => old.id === item.id)))
    changes.push({ entityType: 'set', entityId: item.id, action: 'save', payload: item });
  if (!before || JSON.stringify({ ...before, sets: undefined }) !== JSON.stringify({ ...after, sets: undefined }))
    changes.push({ entityType: 'session', entityId: after.id, action: 'save', payload: after });
  for (const item of changedSets.filter(item => !before?.sets?.some(old => old.id === item.id)))
    changes.push({ entityType: 'set', entityId: item.id, action: 'save', payload: item });
  return changes;
}
type HabitRow = { user_id: string; id: string; name: string; goal_minutes: number; revision: number; deleted_at: string | null };
type SessionRow = { user_id: string; id: string; name: string; started_at: string; ended_at: string | null; revision: number; deleted_at: string | null; entry_type?: 'timer' | 'manual_range'; activity_id?: string | null; note?: string | null; trip_phase?: Session['tripPhase'] | null; destination?: string | null; return_destination?: string | null; counts_productive?: boolean };
type ManualDurationRow = { user_id: string; id: string; name: string; local_date: string; duration_milliseconds: number; activity_id: string | null; note: string; revision: number; deleted_at: string | null; counts_productive?: boolean };
type SegmentRow = { user_id: string; session_id: string; position: number; kind: Session['segments'][number]['kind']; started_at: string; ended_at: string | null };
type ActivityRow = { user_id: string; id: string; name: string; icon: string; color: string; category?: string | null; counts_productive?: boolean; revision: number; deleted_at: string | null };
type ProfileRow = { user_id: string; display_name: string; revision: number };
type ReminderRow = { user_id: string; habit_id: string; enabled: boolean; local_time: string; time_zone: string; weekday_mask: number; skip_if_goal_complete: boolean; revision: number; deleted_at: string | null };
type SetRow = { user_id: string; id: string; session_id: string; description: string; segments: { startedAt: number; endedAt: number | null }[]; revision: number; deleted_at: string | null };
export function mapRows(userId: string, habits: HabitRow[], sessions: SessionRow[], segments: SegmentRow[], activities: ActivityRow[] = [], profiles: ProfileRow[] = [], manualDurations: ManualDurationRow[] = [], reminders: ReminderRow[] = [], sets: SetRow[] = []): Pick<CloudCache, 'state' | 'revisions'> {
  if ([...habits, ...sessions, ...segments, ...activities, ...profiles, ...manualDurations, ...reminders, ...sets].some(row => row.user_id !== userId)) throw new Error('Account data mismatch');
  const revisions: Record<string, number> = {};
  const state = emptyState();
  for (const row of habits) {
    revisions[revisionKey('habit', row.id)] = row.revision;
    if (!row.deleted_at) state.habits.push({ id: row.id, name: row.name, goalMinutes: row.goal_minutes });
  }
  for (const row of activities) {
    revisions[revisionKey('activity', row.id)] = row.revision;
    if (!row.deleted_at) state.activities.push({ id: row.id, name: row.name, icon: row.icon, color: row.color, category: row.category ?? null, countsProductive: row.counts_productive !== false });
  }
  const profile = profiles[0];
  if (profile) {
    revisions[revisionKey('profile', userId)] = profile.revision;
    state.profile = { displayName: profile.display_name };
  }
  for (const row of sessions) {
    revisions[revisionKey('session', row.id)] = row.revision;
    if (row.deleted_at) continue;
    const parts = segments.filter(part => part.session_id === row.id).sort((a, b) => a.position - b.position);
    const entryType = row.entry_type ?? 'timer';
    if (!parts.length) throw new Error('A cloud session is missing its segments');
    const session: Session = { id: row.id, name: row.name, startedAt: Date.parse(row.started_at), endedAt: row.ended_at ? Date.parse(row.ended_at) : null,
      segments: parts.map(part => ({ kind: part.kind, startedAt: Date.parse(part.started_at), endedAt: part.ended_at ? Date.parse(part.ended_at) : null })),
      entryType, localDate: null, durationMilliseconds: null, activityId: row.activity_id ?? null, note: row.note ?? '', sets: [], countsProductive: row.counts_productive !== false,
      ...(row.trip_phase ? { tripPhase: row.trip_phase, destination: row.destination ?? '', returnDestination: row.return_destination ?? '' } : {}) };
    if (entryType === 'timer' && session.endedAt === null) {
      if (state.active) throw new Error('Multiple active cloud sessions');
      state.active = session;
    } else state.completed.push(session);
  }
  for (const row of manualDurations) {
    if (revisions[revisionKey('session', row.id)] !== undefined) throw new Error('Duplicate cloud session id');
    revisions[revisionKey('session', row.id)] = row.revision;
    if (row.deleted_at) continue;
    state.completed.push({ id: row.id, name: row.name, startedAt: null, endedAt: null, segments: [],
      entryType: 'manual_duration', localDate: row.local_date, durationMilliseconds: Number(row.duration_milliseconds),
      activityId: row.activity_id, note: row.note, countsProductive: row.counts_productive !== false });
  }
  for (const row of reminders) {
    revisions[revisionKey('reminder', row.habit_id)] = row.revision;
    if (row.deleted_at) continue;
    const weekdays = ([1, 2, 3, 4, 5, 6, 7] as Weekday[]).filter(day => (row.weekday_mask & (1 << (day - 1))) !== 0);
    state.reminders.push({ habitId: row.habit_id, enabled: row.enabled,
      localTime: row.local_time.slice(0, 5), timeZone: row.time_zone, weekdays,
      skipIfGoalComplete: row.skip_if_goal_complete });
  }
  for (const row of sets) {
    revisions[revisionKey('set', row.id)] = row.revision;
    if (row.deleted_at) continue;
    const session = state.active?.id === row.session_id ? state.active : state.completed.find(item => item.id === row.session_id);
    if (!session) continue;
    if (!Array.isArray(row.segments)) throw new Error('Invalid SET intervals');
    session.sets ??= [];
    session.sets.push({ id: row.id, sessionId: row.session_id, description: row.description, segments: row.segments });
  }
  for (const session of [...state.completed, ...(state.active ? [state.active] : [])]) session.sets?.sort((a, b) => a.segments[0].startedAt - b.segments[0].startedAt);
  const order = (session: Session) => session.endedAt ?? (session.localDate ? new Date(`${session.localDate}T23:59:59`).getTime() : 0);
  state.completed.sort((a, b) => order(b) - order(a));
  return { state, revisions };
}
export function canOfferImport(storage: Pick<Storage, 'getItem'>, userId: string, hasLegacyData: boolean): boolean {
  const claimed = storage.getItem(LEGACY_CLAIM_KEY);
  return hasLegacyData && (!claimed || claimed === userId);
}
