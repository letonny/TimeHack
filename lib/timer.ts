// Each running interval is a segment. Future SET/break actions can close a
// segment and start another without changing the session's identity.
export type Segment = {
    startedAt: number;
    endedAt: number | null;
};
export type Session = {
    id: string;
    name: string;
    startedAt: number;
    endedAt: number | null;
    segments: Segment[];
};
export type TimerState = {
    active: Session | null;
    completed: Session[];
};
export const emptyState = (): TimerState => ({ active: null, completed: [] });
export function duration(session: Session, now: number): number {
    return session.segments.reduce((total, segment) => total + Math.max(0, (segment.endedAt ?? now) - segment.startedAt), 0);
}
export function isRunning(session: Session): boolean {
    return session.segments.at(-1)?.endedAt === null;
}
export function start(state: TimerState, name: string, now: number, id: string): TimerState {
    if (state.active || !name.trim())
        return state;
    return { ...state, active: { id, name: name.trim(), startedAt: now, endedAt: null, segments: [{ startedAt: now, endedAt: null }] } };
}
export function pause(state: TimerState, now: number): TimerState {
    if (!state.active || !isRunning(state.active))
        return state;
    return { ...state, active: { ...state.active, segments: state.active.segments.map(segment => segment.endedAt === null ? { ...segment, endedAt: Math.max(now, segment.startedAt) } : segment) } };
}
export function resume(state: TimerState, now: number): TimerState {
    if (!state.active || isRunning(state.active))
        return state;
    const lastEnd = state.active.segments.at(-1)!.endedAt!;
    return { ...state, active: { ...state.active, segments: [...state.active.segments, { startedAt: Math.max(now, lastEnd), endedAt: null }] } };
}
export function stop(state: TimerState, now: number): TimerState {
    const closed = pause(state, now).active;
    if (!closed)
        return state;
    return { active: null, completed: [{ ...closed, endedAt: Math.max(now, closed.segments.at(-1)!.endedAt!) }, ...state.completed] };
}
export function todaySummary(state: TimerState, now: number) {
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const sessions = [...state.completed, ...(state.active ? [state.active] : [])];
    const milliseconds = sessions.reduce((total, session) => total + session.segments.reduce((sum, segment) => sum + Math.max(0, Math.min(segment.endedAt ?? now, dayEnd.getTime(), now) - Math.max(segment.startedAt, dayStart.getTime())), 0), 0);
    return { milliseconds, count: state.completed.filter(session => session.endedAt! >= dayStart.getTime() && session.endedAt! < dayEnd.getTime()).length };
}
export function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
}
