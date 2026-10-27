import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duration, emptyState, formatDuration, pause, resume, start, stop, todaySummary } from '../lib/timer.ts';
import { loadState, saveState, STORAGE_KEY } from '../lib/storage.ts';
function memory() {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
test('timestamps recover elapsed time without timer ticks', () => {
    const state = start(emptyState(), ' Study ', 1000, 'a');
    assert.equal(state.active!.name, 'Study');
    assert.equal(duration(state.active!, 3601000), 3600000);
    assert.equal(start(state, 'Other', 2000, 'b'), state);
    assert.equal(start(emptyState(), '  ', 0, 'c').active, null);
});
test('pause/resume excludes breaks and preserves segments for future SET actions', () => {
    const initial = start(emptyState(), 'Read', 1000, 'a');
    const paused = pause(initial, 6000);
    assert.equal(duration(paused.active!, 100000), 5000);
    assert.equal(pause(paused, 7000), paused);
    const resumed = resume(paused, 20000);
    assert.equal(resume(resumed, 21000), resumed);
    const finished = stop(resumed, 23000);
    assert.equal(finished.active, null);
    assert.equal(duration(finished.completed[0], 99999), 8000);
    assert.equal(finished.completed[0].segments.length, 2);
    assert.equal(stop(finished, 24000), finished);
});
test('stop while paused adds no paused time and negative clock shifts do not subtract time', () => {
    const state = pause(start(emptyState(), 'Read', 1000, 'a'), 5000);
    assert.equal(duration(stop(state, 10000).completed[0], 10000), 4000);
    assert.equal(duration(state.active!, 0), 4000);
    assert.equal(duration(start(emptyState(), 'Read', 1000, 'b').active!, 0), 0);
});
test('today clips overnight segments and counts completions on local completion date', () => {
    const midnight = new Date(2026, 9, 27).getTime();
    const state = start(emptyState(), 'Overnight', midnight - 60000, 'a');
    assert.deepEqual(todaySummary(state, midnight + 120000), { milliseconds: 120000, count: 0 });
    const done = stop(state, midnight + 120000);
    assert.deepEqual(todaySummary(done, midnight + 180000), { milliseconds: 120000, count: 1 });
    const tomorrow = new Date(2026, 9, 28).getTime();
    assert.deepEqual(todaySummary(done, tomorrow), { milliseconds: 0, count: 0 });
});
test('duration formatting supports hours over 24', () => {
    assert.equal(formatDuration(3661999), '01:01:01');
    assert.equal(formatDuration(90000000), '25:00:00');
});
test('storage round trips running, paused, and completed sessions without losing elapsed time', () => {
    const storage = memory();
    assert.deepEqual(loadState(storage), emptyState());
    let state = start(emptyState(), 'Work', 1000, 'a');
    saveState(storage, state);
    assert.equal(duration(loadState(storage).active!, 6000), 5000);
    state = pause(state, 6000);
    saveState(storage, state);
    assert.equal(duration(loadState(storage).active!, 60000), 5000);
    state = stop(resume(loadState(storage), 20000), 25000);
    saveState(storage, state);
    assert.deepEqual(loadState(storage), state);
    const deleted = { ...state, completed: [] };
    saveState(storage, deleted);
    assert.deepEqual(loadState(storage), emptyState());
});
test('invalid and unsupported storage is rejected rather than overwritten', () => {
    const storage = memory();
    for (const raw of ['{', 'null', '{"version":2}', JSON.stringify({ version: 1, active: null, completed: [{ id: 'a' }] })]) {
        storage.setItem(STORAGE_KEY, raw);
        assert.throws(() => loadState(storage));
        assert.equal(storage.getItem(STORAGE_KEY), raw);
    }
    const state = start(emptyState(), 'Work', 1000, 'a');
    state.active!.segments[0].endedAt = 500;
    saveState(storage, state);
    assert.throws(() => loadState(storage));
});
test('storage permission and quota failures reach the caller', () => {
    const storage = { getItem: () => { throw new Error('Denied'); }, setItem: () => { throw new Error('Full'); } };
    assert.throws(() => loadState(storage), /Denied/);
    assert.throws(() => saveState(storage, emptyState()), /Full/);
});
