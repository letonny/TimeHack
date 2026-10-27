import { emptyState, type Session, type TimerState } from './timer.ts';
export const STORAGE_KEY = 'timehack.sessions.v1';
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
function validSession(value: unknown, active: boolean): value is Session {
    if (!value || typeof value !== 'object')
        return false;
    const s = value as Session;
    if (typeof s.id !== 'string' || !s.id || typeof s.name !== 'string' || !s.name.trim() || !timestamp(s.startedAt) || (active ? s.endedAt !== null : !timestamp(s.endedAt)) || !Array.isArray(s.segments) || !s.segments.length)
        return false;
    let previous = s.startedAt;
    return s.segments.every((segment, index) => {
        if (!segment || !timestamp(segment.startedAt) || segment.startedAt < previous)
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
    if (data?.version !== 1 || !Array.isArray(data.completed) || !data.completed.every((s: unknown) => validSession(s, false)) || (data.active !== null && !validSession(data.active, true)))
        throw new Error('Invalid saved session data');
    const ids = [...data.completed.map((s: Session) => s.id), ...(data.active ? [data.active.id] : [])];
    if (new Set(ids).size !== ids.length)
        throw new Error('Duplicate session IDs');
    return { active: data.active, completed: data.completed };
}
export function saveState(storage: StoragePort, state: TimerState): void {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...state }));
}
