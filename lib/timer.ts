export type Segment = {
    kind: 'study' | 'break' | 'travel_out' | 'travel_return';
    startedAt: number;
    endedAt: number | null;
};
export type SessionSet = { id: string; sessionId: string; description: string; segments: { startedAt: number; endedAt: number | null }[] };
export type Session = {
    id: string;
    name: string;
    startedAt: number | null;
    endedAt: number | null;
    segments: Segment[];
    sets?: SessionSet[];
    entryType?: 'timer' | 'manual_range' | 'manual_duration';
    localDate?: string | null;
    durationMilliseconds?: number | null;
    activityId?: string | null;
    note?: string;
    tripPhase?: 'outbound' | 'arrived' | 'activity' | 'activity_finished' | 'return';
    destination?: string;
    returnDestination?: string;
    countsProductive?: boolean;
};
export type Activity = { id: string; name: string; icon: string; color: string; category?: string | null; countsProductive?: boolean };
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
    trackedActivityMilliseconds: number;
    productiveMilliseconds: number;
    personalMilliseconds: number;
    travelMilliseconds: number;
    commitmentMilliseconds: number;
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
    return session.segments.reduce((total, segment) => total + (segment.kind === 'study' ? segmentDuration(segment, now) : 0), 0);
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
export function activeSet(session: Session): SessionSet | null {
    return session.sets?.find(item => item.segments.at(-1)?.endedAt === null) ?? null;
}
export function setDuration(item: SessionSet, now: number): number {
    return item.segments.reduce((total, part) => total + Math.max(0, (part.endedAt ?? now) - part.startedAt), 0);
}
export function startSet(state: TimerState, now: number, id: string, description: string, expectedActiveSetId?: string | null): TimerState {
    const session = state.active;
    if (!session || !isRunning(session) || (session.tripPhase && session.tripPhase !== 'activity')) return state;
    if (expectedActiveSetId !== undefined && (activeSet(session)?.id ?? null) !== expectedActiveSetId) return state;
    const parent = session.segments.at(-1)?.kind === 'break' ? setSegment(state, now).active! : session;
    const label = description.trim().slice(0, 120) || 'SET';
    const sets = (parent.sets ?? []).map(item => item.segments.at(-1)?.endedAt === null
        ? { ...item, segments: item.segments.map(part => part.endedAt === null ? { ...part, endedAt: Math.max(now, part.startedAt) } : part) }
        : item);
    return { ...state, active: { ...parent, sets: [...sets, { id, sessionId: session.id, description: label, segments: [{ startedAt: now, endedAt: null }] }] } };
}
export function endSet(state: TimerState, now: number): TimerState {
    const session = state.active;
    if (!session || !activeSet(session)) return state;
    return { ...state, active: { ...session, sets: session.sets!.map(item => item.segments.at(-1)?.endedAt === null
        ? { ...item, segments: item.segments.map(part => part.endedAt === null ? { ...part, endedAt: Math.max(now, part.startedAt) } : part) }
        : item) } };
}
export function start(state: TimerState, name: string, now: number, id: string, activityId: string | null = null, countsProductive = true): TimerState {
    if (state.active || !name.trim())
        return state;
    return { ...state, active: { id, name: name.trim(), startedAt: now, endedAt: null, segments: [{ kind: 'study', startedAt: now, endedAt: null }], sets: [], entryType: 'timer', localDate: null, durationMilliseconds: null, activityId, note: '', countsProductive } };
}
export function startTrip(state: TimerState, name: string, now: number, id: string, activityId: string | null = null, destination = '', returnDestination = '', countsProductive = true): TimerState {
    if (state.active || !name.trim()) return state;
    return { ...state, active: { id, name: name.trim(), startedAt: now, endedAt: null,
        segments: [{ kind: 'travel_out', startedAt: now, endedAt: null }], sets: [], entryType: 'timer',
        localDate: null, durationMilliseconds: null, activityId, note: '', tripPhase: 'outbound',
        destination: destination.trim().slice(0, 120), returnDestination: returnDestination.trim().slice(0, 120), countsProductive } };
}
function closeTripPhase(state: TimerState, now: number, phase: Session['tripPhase'], expected: Session['tripPhase']): TimerState {
    if (!state.active || state.active.tripPhase !== expected) return state;
    const closed = isRunning(state.active) ? pause(state, now).active! : state.active;
    return { ...state, active: { ...closed, tripPhase: phase } };
}
export function arrive(state: TimerState, now: number): TimerState { return closeTripPhase(state, now, 'arrived', 'outbound'); }
export function finishActivity(state: TimerState, now: number): TimerState { return closeTripPhase(state, now, 'activity_finished', 'activity'); }
function beginTripPhase(state: TimerState, now: number, expected: Session['tripPhase'], phase: Session['tripPhase'], kind: Segment['kind']): TimerState {
    const session = state.active;
    if (!session || session.tripPhase !== expected || isRunning(session)) return state;
    const lastEnd = session.segments.at(-1)!.endedAt!;
    return { ...state, active: { ...session, tripPhase: phase,
        segments: [...session.segments, { kind, startedAt: Math.max(now, lastEnd), endedAt: null }] } };
}
export function startTripActivity(state: TimerState, now: number): TimerState { return beginTripPhase(state, now, 'arrived', 'activity', 'study'); }
export function startReturnTrip(state: TimerState, now: number): TimerState { return beginTripPhase(state, now, 'activity_finished', 'return', 'travel_return'); }
export function completeTrip(state: TimerState, now: number): TimerState {
    return state.active?.tripPhase === 'return' ? stop(state, now) : state;
}
export function finishWithoutReturnTrip(state: TimerState, now: number): TimerState {
    return state.active?.tripPhase === 'activity_finished' ? stop(state, now) : state;
}
export function pause(state: TimerState, now: number): TimerState {
    if (!state.active || !isRunning(state.active))
        return state;
    const closed = endSet(state, now).active!;
    return { ...state, active: { ...closed, segments: closed.segments.map(segment => segment.endedAt === null ? { ...segment, endedAt: Math.max(now, segment.startedAt) } : segment) } };
}
export function resume(state: TimerState, now: number): TimerState {
    if (!state.active || isRunning(state.active))
        return state;
    if (state.active.tripPhase === 'arrived' || state.active.tripPhase === 'activity_finished') return state;
    const lastEnd = state.active.segments.at(-1)!.endedAt!;
    return { ...state, active: { ...state.active, segments: [...state.active.segments, { kind: state.active.segments.at(-1)!.kind, startedAt: Math.max(now, lastEnd), endedAt: null }] } };
}
export function stop(state: TimerState, now: number): TimerState {
    if (state.active?.tripPhase && state.active.tripPhase !== 'return' && state.active.tripPhase !== 'activity_finished') return state;
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
        : session.segments.reduce((sum, segment) => sum + (segment.kind === 'study' ? Math.max(0, Math.min(segment.endedAt ?? now, dayEnd.getTime(), now) - Math.max(segment.startedAt, dayStart.getTime())) : 0), 0)), 0);
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
    const trackedMilliseconds = trackedDuration(session, now);
    const travelMilliseconds = durationByKind(session, now, 'travel_out') + durationByKind(session, now, 'travel_return');
    const commitmentMilliseconds = isDurationOnly(session) ? trackedMilliseconds : Math.max(0, (session.endedAt ?? now) - (session.startedAt ?? now));
    const intervals = sessionIntervals(session, now);
    return {
        studyMilliseconds,
        breakMilliseconds,
        trackedMilliseconds,
        trackedActivityMilliseconds: studyMilliseconds + breakMilliseconds,
        productiveMilliseconds: session.countsProductive === false ? 0 : studyMilliseconds,
        personalMilliseconds: session.countsProductive === false ? studyMilliseconds : 0,
        travelMilliseconds,
        commitmentMilliseconds,
        studyShare: trackedMilliseconds > 0 ? studyMilliseconds / trackedMilliseconds * 100 : 0,
        breakCount: intervals.filter(interval => interval.kind === 'break').length,
        intervals,
    };
}

export function segmentDuration(segment: Segment, now: number): number {
    return Math.max(0, (segment.endedAt ?? now) - segment.startedAt);
}
export function setSegment(state: TimerState, now: number): TimerState {
    if (!state.active || !isRunning(state.active) || (state.active.tripPhase && state.active.tripPhase !== 'activity')) return state;
    const closed = pause(state, now).active!;
    const last = closed.segments.at(-1)!;
    return { ...state, active: { ...closed, segments: [...closed.segments, {
        kind: last.kind === 'study' ? 'break' : 'study', startedAt: last.endedAt!, endedAt: null,
    }] } };
}
