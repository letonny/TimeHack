'use client';
import { useState } from 'react';
import { habitGoalProgress, habitGoalStreaks } from '@/lib/analytics';
import type { Habit, TimerState } from '@/lib/timer';
import { ProgressRing } from './progress-ring';
export function HabitTracker({ state, now, ready, onSave, onDelete, onTrack }: {
    state: TimerState; now: number | null; ready: boolean;
    onSave: (habit: Habit) => boolean | undefined; onDelete: (id: string) => void; onTrack: (name: string) => void;
}) {
    const [editing, setEditing] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [goal, setGoal] = useState('120');
    function reset() { setEditing(null); setName(''); setGoal('120'); }
    return <section className="panel mt-8 p-6 sm:p-8" aria-labelledby="habits-title">
        <h2 id="habits-title" className="text-lg font-semibold">Daily habits</h2>
        <p className="mt-2 text-sm text-slate-400">Match an activity name to a habit to count its study/focus time automatically. Goals reset at local midnight. Recorded breaks and pauses do not advance goals.</p>
        <form className="mt-5 flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); if (onSave({ id: editing ?? crypto.randomUUID(), name, goalMinutes: Number(goal) })) reset(); }}>
            <label className="min-w-0 flex-1 basis-44 text-sm">Habit name<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder="Study" className="mt-2 w-full rounded-xl border border-white/10 bg-[#0b1424] p-3 text-base"/></label>
            <label className="text-sm">Daily goal (minutes)<input required type="number" min="1" max="1440" step="1" value={goal} onChange={event => setGoal(event.target.value)} className="mt-2 block w-36 rounded-xl border border-white/10 bg-[#0b1424] p-3 text-base"/></label>
            <button disabled={!ready} className="primary">{editing ? 'Save habit' : 'Add habit'}</button>
            {editing && <button type="button" onClick={reset} className="p-3 text-sm">Cancel</button>}
        </form>
        {!state.habits.length && <p className="mt-6 text-sm text-slate-400">Create your first habit to give today a goal.</p>}
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">{state.habits.map(habit => {
            const progress = habitGoalProgress(state, habit, now ?? 0);
            const streaks = habitGoalStreaks(state, habit, now ?? 0);
            return <li key={habit.id} className="min-w-0 rounded-xl border border-white/10 p-4">
                <div className="flex items-center gap-4"><ProgressRing progress={progress} label={`${habit.name} daily progress`} size={104}/><div className="min-w-0"><h3 className="break-words font-medium">{habit.name}</h3><p className="mt-2 text-sm text-slate-300">{progress.minutes.toFixed(1)} / {habit.goalMinutes} minutes</p><p className="mt-1 text-xs text-slate-400">{progress.remainingMinutes > 0 ? `${progress.remainingMinutes.toFixed(1)} remaining` : `${Math.max(0, progress.minutes - habit.goalMinutes).toFixed(1)} above goal`}</p></div></div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs"><p className="rounded-lg bg-white/5 p-2 text-slate-400">Current goal streak<br/><span className="mt-1 inline-block text-base font-medium text-teal-200">{streaks.current} days</span></p><p className="rounded-lg bg-white/5 p-2 text-slate-400">Longest goal streak<br/><span className="mt-1 inline-block text-base font-medium text-white">{streaks.longest} days</span></p></div>
                <div className="mt-3 flex flex-wrap gap-2 text-sm"><button disabled={!ready || !!state.active} type="button" onClick={() => onTrack(habit.name)} className="rounded-lg bg-teal-300/10 px-3 py-2 text-teal-200">Track</button><button disabled={!ready} type="button" onClick={() => { setEditing(habit.id); setName(habit.name); setGoal(String(habit.goalMinutes)); }} className="px-3 py-2">Edit</button><button disabled={!ready} type="button" onClick={() => { onDelete(habit.id); if (editing === habit.id) reset(); }} className="px-3 py-2 text-slate-400">Delete</button></div>
            </li>;
        })}</ul>
    </section>;
}
