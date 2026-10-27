'use client';
import { useEffect, useState } from 'react';
import { emptyState, setSegment, pause, resume, start, stop, type Habit, type TimerState } from '@/lib/timer';
import { saveHabit } from '@/lib/habits';
import { loadState, saveState, STORAGE_KEY } from '@/lib/storage';
export function useTimer() {
    const [state, setState] = useState<TimerState>(emptyState);
    const [now, setNow] = useState<number | null>(null);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        function restore() {
            try {
                setState(loadState(window.localStorage));
                setError('');
            }
            catch {
                setError('Saved data could not be read. Tracking is disabled to protect your existing sessions. Check browser storage permissions or back up and clear the timehack.sessions.v1 entry.');
                setReady(false);
                return;
            }
            setNow(Date.now());
            setReady(true);
        }
        restore();
        const interval = window.setInterval(() => setNow(Date.now()), 500);
        const sync = (event: StorageEvent) => { if (event.key === STORAGE_KEY || event.key === null)
            restore(); };
        const visible = () => setNow(Date.now());
        window.addEventListener('storage', sync);
        document.addEventListener('visibilitychange', visible);
        return () => { clearInterval(interval); window.removeEventListener('storage', sync); document.removeEventListener('visibilitychange', visible); };
    }, []);
    function update(transform: (current: TimerState, time: number) => TimerState) {
        if (!ready)
            return;
        try {
            // Read before every action to avoid overwriting another tab's latest session.
            const time = Date.now();
            const next = transform(loadState(window.localStorage), time);
            saveState(window.localStorage, next);
            setState(next);
            setNow(time);
            setError('');
            return true;
        }
        catch {
            setError('Your change could not be saved. Use a unique habit name and a whole-minute goal from 1 to 1440; check browser storage permissions if the problem persists.');
            return false;
        }
    }
    return { state, now, ready, error,
        start: (name: string) => update((current, time) => start(current, name, time, crypto.randomUUID())),
        set: () => update(setSegment),
        saveHabit: (habit: Habit) => update(current => saveHabit(current, habit)),
        deleteHabit: (id: string) => update(current => ({ ...current, habits: current.habits.filter(habit => habit.id !== id) })),
        pause: () => update(pause), resume: () => update(resume), stop: () => update(stop),
        remove: (id: string) => update(current => ({ ...current, completed: current.completed.filter(session => session.id !== id) })),
    };
}
