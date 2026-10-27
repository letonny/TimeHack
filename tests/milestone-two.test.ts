import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duration, emptyState, isRunning, pause, resume, segmentDuration, setSegment, start, stop, todaySummary } from '../lib/timer.ts';
import { habitProgress, saveHabit } from '../lib/habits.ts';
import { loadState, saveState, STORAGE_KEY } from '../lib/storage.ts';
const minute = 60000;
const day = new Date(2026, 9, 27).getTime();
function memory() {
    const data = new Map<string, string>();
    return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
test('SET alternates study and break inside one session and excludes all breaks', () => {
    let state = start(emptyState(), 'Study', day, 's');
    state = setSegment(state, day + 10 * minute);
    assert.equal(state.active!.segments.at(-1)!.kind, 'break');
    assert.equal(duration(state.active!, day + 15 * minute), 10 * minute);
    state = setSegment(state, day + 15 * minute);
    state = setSegment(state, day + 25 * minute);
    state = stop(state, day + 30 * minute);
    const session = state.completed[0];
    assert.equal(session.id, 's');
    assert.deepEqual(session.segments.map(s => [s.kind, segmentDuration(s, day + 30 * minute)]), [['study', 10 * minute], ['break', 5 * minute], ['study', 10 * minute], ['break', 5 * minute]]);
    assert.equal(duration(session, day + 40 * minute), 20 * minute);
    assert.equal(todaySummary(state, day + 40 * minute).milliseconds, 20 * minute);
    assert.equal(setSegment(emptyState(), day).active, null);
});
test('pausing either mode freezes it, SET is inert while paused and resume preserves mode', () => {
    for (const mode of ['study', 'break']) {
        let state = start(emptyState(), 'Study', day, 's');
        if (mode === 'break') state = setSegment(state, day + minute);
        state = pause(state, day + 2 * minute);
        assert.equal(isRunning(state.active!), false);
        assert.equal(setSegment(state, day + 20 * minute), state);
        const productive = duration(state.active!, day + 20 * minute);
        const finishedPaused = stop(state, day + 20 * minute);
        assert.equal(duration(finishedPaused.completed[0], day + 20 * minute), productive);
        state = resume(state, day + 20 * minute);
        assert.equal(state.active!.segments.at(-1)!.kind, mode);
        state = stop(state, day + 21 * minute);
        assert.equal(duration(state.completed[0], day + 30 * minute), productive + (mode === 'study' ? minute : 0));
    }
});
test('daily habit progress matches normalized names, clips midnight and ignores other activities and breaks', () => {
    const habit = { id: 'h', name: 'Study', goalMinutes: 2 };
    let state = saveHabit(emptyState(), habit);
    state = start(state, ' STUDY ', day - minute, 's');
    state = setSegment(state, day + minute);
    assert.deepEqual(habitProgress(state, habit, day + 2 * minute), { minutes: 1, remaining: 1, percentage: 50 });
    state = setSegment(state, day + 2 * minute);
    state = stop(state, day + 5 * minute);
    state = stop(start(state, 'Gym', day + 6 * minute, 'g'), day + 10 * minute);
    assert.deepEqual(habitProgress(state, habit, day + 10 * minute), { minutes: 4, remaining: 0, percentage: 100 });
    assert.equal(habitProgress(state, habit, new Date(2026, 9, 28).getTime()).minutes, 0);
    state = saveHabit(state, { ...habit, goalMinutes: 8 });
    assert.equal(habitProgress(state, state.habits[0], day + 10 * minute).percentage, 50);
    assert.throws(() => saveHabit(state, { ...habit, id: 'other', name: ' study ' }));
    for (const goalMinutes of [0, -1, 1.5, NaN, 1441]) assert.throws(() => saveHabit(state, { ...habit, goalMinutes }));
});
test('refresh restores running/paused breaks, goals and segments; resumed study still counts accurately', () => {
    const storage = memory();
    let state = saveHabit(emptyState(), { id: 'h', name: 'Study', goalMinutes: 120 });
    state = setSegment(start(state, 'Study', day, 's'), day + 10 * minute);
    saveState(storage, state);
    state = loadState(storage);
    assert.equal(segmentDuration(state.active!.segments.at(-1)!, day + 15 * minute), 5 * minute);
    assert.equal(habitProgress(state, state.habits[0], day + 15 * minute).minutes, 10);
    state = pause(state, day + 15 * minute);
    saveState(storage, state);
    state = loadState(storage);
    assert.equal(isRunning(state.active!), false);
    state = setSegment(resume(state, day + 25 * minute), day + 30 * minute);
    state = stop(state, day + 40 * minute);
    saveState(storage, state);
    assert.deepEqual(loadState(storage), state);
    assert.equal(habitProgress(state, state.habits[0], day + 40 * minute).minutes, 20);
});
test('legacy sessions migrate as study and malformed segment kinds or habits are rejected', () => {
    const storage = memory();
    const old = start(emptyState(), 'Study', day, 's');
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, active: { ...old.active, segments: [{ startedAt: day, endedAt: null }] }, completed: [] }));
    const migrated = loadState(storage);
    assert.equal(migrated.active!.segments[0].kind, 'study');
    assert.deepEqual(migrated.habits, []);
    for (const override of [{ habits: [{ id: 'h', name: 'Study', goalMinutes: 0 }] }, { active: { ...migrated.active, segments: [{ kind: 'invalid', startedAt: day, endedAt: null }] } }]) {
        storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, ...migrated, ...override }));
        assert.throws(() => loadState(storage));
    }
});
test('clock moving backwards cannot overlap SET segments', () => {
    let state = setSegment(start(emptyState(), 'Study', 1000, 's'), 500);
    state = setSegment(state, 100);
    assert.deepEqual(state.active!.segments.map(s => s.startedAt), [1000, 1000, 1000]);
    assert.equal(duration(state.active!, 2000), 1000);
});
