export type Segment = {
    kind: 'study' | 'break';
    startedAt: number;
    endedAt: number | null;
};
export type Session = {
    id: string;
    name: string;
    startedAt: number | null;
    endedAt: number | null;
    segments: Segment[];
    entryType?: 'timer' | 'manual_range' | 'manual_duration';
    localDate?: string | null;
    durationMilliseconds?: number | null;
    activityId?: string | null;
    note?: string;
};
export type Activity = { id: string; name: string; icon: string; color: string };
export type Profile = { displayName: string };
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type HabitReminder = {
    habitId: string;
    enabled: boolean;
    localTime: string;
    timeZone: string;
    weekdays: Weekday[];
    skipIfGoalComplete: boolean;
};
export type TimerState = {
    habits: Habit[];
    reminders: HabitReminder[];
    activities: Activity[];
    profile: Profile;
    active: Session | null;
    completed: Session[];
};
export type Habit = { id: string; name: string; goalMinutes: number };
export type SessionInterval = {
    kind: Segment['kind'];
    startedAt: number;
    endedAt: number | null;
    milliseconds: number;
    segmentCount: number;
};
export type SessionSummary = {
    studyMilliseconds: number;
    breakMilliseconds: number;
    trackedMilliseconds: number;
    studyShare: number;
    breakCount: number;
    intervals: SessionInterval[];
};
export const emptyState = (): TimerState => ({ active: null, completed: [], habits: [], reminders: [], activities: [], profile: { displayName: '' } });
export function isDurationOnly(session: Session): boolean {
    return session.entryType === 'manual_duration';
}
export function duration(session: Session, now: number): number {
    if (isDurationOnly(session)) return session.durationMilliseconds ?? 0;
    return session.segments.reduce((total, segment) => total + (segment.kind === 'break' ? 0 : segmentDuration(segment, now)), 0);
}
export function durationByKind(session: Session, now: number, kind: Segment['kind']): number {
    if (isDurationOnly(session)) return kind === 'study' ? session.durationMilliseconds ?? 0 : 0;
    return session.segments.reduce((total, segment) => total + (segment.kind === kind ? segmentDuration(segment, now) : 0), 0);
}
export function trackedDuration(session: Session, now: number): number {
    if (isDurationOnly(session)) return session.durationMilliseconds ?? 0;
    return session.segments.reduce((total, segment) => total + segmentDuration(segment, now), 0);
}
export function isRunning(session: Session): boolean {
    return session.segments.at(-1)?.endedAt === null;
}
export function start(state: TimerState, name: string, now: number, id: string, activityId: string | null = null): TimerState {
    if (state.active || !name.trim())
        return state;
    return { ...state, active: { id, name: name.trim(), startedAt: now, endedAt: null, segments: [{ kind: 'study', startedAt: now, endedAt: null }], entryType: 'timer', localDate: null, durationMilliseconds: null, activityId, note: '' } };
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
    return { ...state, active: { ...state.active, segments: [...state.active.segments, { kind: state.active.segments.at(-1)!.kind, startedAt: Math.max(now, lastEnd), endedAt: null }] } };
}
export function stop(state: TimerState, now: number): TimerState {
    const closed = pause(state, now).active;
    if (!closed)
        return state;
    return { ...state, active: null, completed: [{ ...closed, endedAt: Math.max(now, closed.segments.at(-1)!.endedAt!) }, ...state.completed] };
}
export function todaySummary(state: TimerState, now: number) {
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const sessions = [...state.completed, ...(state.active ? [state.active] : [])];
    const dayKey = `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, '0')}-${String(dayStart.getDate()).padStart(2, '0')}`;
    const milliseconds = sessions.reduce((total, session) => total + (isDurationOnly(session)
        ? session.localDate === dayKey ? session.durationMilliseconds ?? 0 : 0
        : session.segments.reduce((sum, segment) => sum + (segment.kind === 'break' ? 0 : Math.max(0, Math.min(segment.endedAt ?? now, dayEnd.getTime(), now) - Math.max(segment.startedAt, dayStart.getTime()))), 0)), 0);
    return { milliseconds, count: state.completed.filter(session => isDurationOnly(session) ? session.localDate === dayKey : session.endedAt! >= dayStart.getTime() && session.endedAt! < dayEnd.getTime()).length };
}
export function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
}
export function formatDurationMilliseconds(ms: number): string {
    const safe = Math.max(0, Math.floor(ms));
    const milliseconds = safe % 1000;
    return `${formatDuration(safe)}.${String(milliseconds).padStart(3, '0')}`;
}
export function formatCompletedDuration(ms: number): string {
    const totalMinutes = Math.floor(Math.max(0, ms) / 60000);
    return `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, '0')}`;
}

export function sessionIntervals(session: Session, now: number): SessionInterval[] {
    if (isDurationOnly(session)) return [];
    const intervals: SessionInterval[] = [];
    for (const segment of session.segments) {
        const previous = intervals.at(-1);
        if (previous?.kind === segment.kind) {
            previous.endedAt = segment.endedAt;
            previous.milliseconds += segmentDuration(segment, now);
            previous.segmentCount += 1;
        } else {
            intervals.push({
                kind: segment.kind,
                startedAt: segment.startedAt,
                endedAt: segment.endedAt,
                milliseconds: segmentDuration(segment, now),
                segmentCount: 1,
            });
        }
    }
    return intervals;
}

export function summarizeSession(session: Session, now: number): SessionSummary {
    const studyMilliseconds = durationByKind(session, now, 'study');
    const breakMilliseconds = durationByKind(session, now, 'break');
    const trackedMilliseconds = studyMilliseconds + breakMilliseconds;
    const intervals = sessionIntervals(session, now);
    return {
        studyMilliseconds,
        breakMilliseconds,
        trackedMilliseconds,
        studyShare: trackedMilliseconds > 0 ? studyMilliseconds / trackedMilliseconds * 100 : 0,
        breakCount: intervals.filter(interval => interval.kind === 'break').length,
        intervals,
    };
}

export function segmentDuration(segment: Segment, now: number): number {
    return Math.max(0, (segment.endedAt ?? now) - segment.startedAt);
}
export function setSegment(state: TimerState, now: number): TimerState {
    if (!state.active || !isRunning(state.active)) return state;
    const closed = pause(state, now).active!;
    const last = closed.segments.at(-1)!;
    return { ...state, active: { ...closed, segments: [...closed.segments, {
        kind: last.kind === 'study' ? 'break' : 'study', startedAt: last.endedAt!, endedAt: null,
    }] } };
}
