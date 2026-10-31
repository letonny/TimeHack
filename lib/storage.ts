import { saveHabit } from './habits.ts';
import { emptyState, type Session, type TimerState } from './timer.ts';
export const STORAGE_KEY = 'timehack.sessions.v1';
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
function validSession(value: unknown, active: boolean, legacy: boolean): value is Session {
    if (!value || typeof value !== 'object')
        return false;
    const s = value as Session;
    if (typeof s.id !== 'string' || !s.id || typeof s.name !== 'string' || !s.name.trim() || !timestamp(s.startedAt) || (active ? s.endedAt !== null : !timestamp(s.endedAt)) || !Array.isArray(s.segments) || !s.segments.length)
        return false;
    let previous = s.startedAt!;
    return s.segments.every((segment, index) => {
        if (!segment || (!legacy && !['study', 'break', 'travel_out', 'travel_return'].includes(segment.kind)) || !timestamp(segment.startedAt) || segment.startedAt < previous)
            return false;
        if (segment.endedAt === null)
            return active && index === s.segments.length - 1;
        if (!timestamp(segment.endedAt) || segment.endedAt < segment.startedAt || (!active && segment.endedAt > s.endedAt!))
            return false;
        previous = segment.endedAt;
        return true;
    });
}
export function loadState(storage: StoragePort): TimerState {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw)
        return emptyState();
    const data = JSON.parse(raw);
    if ((data?.version !== 1 && data?.version !== 2) || !Array.isArray(data.completed) || !data.completed.every((s: unknown) => validSession(s, false, data.version === 1)) || (data.active !== null && !validSession(data.active, true, data.version === 1)))
        throw new Error('Invalid saved session data');
    const ids = [...data.completed.map((s: Session) => s.id), ...(data.active ? [data.active.id] : [])];
    if (new Set(ids).size !== ids.length)
        throw new Error('Duplicate session IDs');
    const migrate = (session: Session): Session => ({ ...session, entryType: 'timer', localDate: null, durationMilliseconds: null, activityId: null, note: '', segments: session.segments.map(segment => ({ ...segment, kind: data.version === 1 ? 'study' : segment.kind })) });
    let state: TimerState = { active: data.active ? migrate(data.active) : null, completed: data.completed.map(migrate), habits: [], reminders: [], activities: [], profile: { displayName: '' } };
    if (data.version === 2) {
        if (!Array.isArray(data.habits)) throw new Error('Invalid habits');
        const habitIds = new Set<string>();
        for (const habit of data.habits) {
            if (!habit || typeof habit.id !== 'string' || typeof habit.name !== 'string' || habitIds.has(habit.id)) throw new Error('Invalid habit');
            state = saveHabit(state, habit);
            habitIds.add(habit.id);
        }
    }
    return state;
}
export function saveState(storage: StoragePort, state: TimerState): void {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, ...state }));
}
