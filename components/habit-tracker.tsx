'use client';

import { useRef, useState } from 'react';
import { habitGoalProgress, habitGoalStreaks } from '@/lib/analytics';
import { activityForName, iconGlyph } from '@/lib/activity-metadata';
import type { Habit, TimerState } from '@/lib/timer';
import { ProgressRing } from './progress-ring';
import { ReminderSettings } from './reminder-settings';

export function HabitTracker({ state, now, ready, onSave, onDelete, onTrack, onSaveReminder, onDeleteReminder }: {
  state: TimerState; now: number | null; ready: boolean;
  onSave: (habit: Habit) => boolean | undefined; onDelete: (id: string) => void; onTrack: (name: string) => void;
  onSaveReminder: Parameters<typeof ReminderSettings>[0]['onSave']; onDeleteReminder: Parameters<typeof ReminderSettings>[0]['onDelete'];
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);
  const reset = () => { setEditing(null); setName(''); setGoal(''); };
  const progress = state.habits.map(habit => ({ habit, value: habitGoalProgress(state, habit, now ?? 0) }));
  const completed = progress.filter(item => item.value.percentage >= 100).length;
  const trackedMinutes = progress.reduce((total, item) => total + item.value.minutes, 0);

  return <div className="space-y-5">
    <section aria-label="Today habit summary" className="grid grid-cols-2 gap-3 lg:grid-cols-3"><div className="summary-tile"><p className="eyebrow">TOTAL HABITS</p><p className="mt-2 text-3xl font-bold tabular-nums">{state.habits.length}</p><p className="mt-1 text-xs text-slate-400">Configured daily goals</p></div><div className="summary-tile summary-tile--emerald"><p className="eyebrow">GOALS MET TODAY</p><p className="mt-2 text-3xl font-bold tabular-nums">{completed}{state.habits.length > 0 && <span className="ml-1 text-base font-normal text-slate-400">/ {state.habits.length}</span>}</p><p className="mt-1 text-xs text-slate-400">Based on productive time</p></div><div className="summary-tile summary-tile--violet col-span-2 lg:col-span-1"><p className="eyebrow">HABIT TIME TODAY</p><p className="mt-2 text-3xl font-bold tabular-nums">{Math.floor(trackedMinutes)}<span className="ml-1 text-base font-normal text-slate-400">min</span></p><p className="mt-1 text-xs text-slate-400">Across configured habits</p></div></section>
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,.8fr)] lg:items-start">
      <section className="panel order-2 min-w-0 p-5 sm:p-6" aria-labelledby="habit-form-title"><p className="eyebrow">DAILY TARGET</p><h2 id="habit-form-title" className="mt-1 text-xl font-bold">{editing ? 'Edit habit' : 'Create a habit'}</h2><p className="mt-2 text-sm text-slate-400">Match a habit to an activity. Productive minutes count automatically; breaks and pauses do not.</p>
        <form className="mt-5 space-y-4" onSubmit={event => { event.preventDefault(); if (onSave({ id: editing ?? crypto.randomUUID(), name, goalMinutes: Number(goal) })) reset(); }}><label className="block text-xs font-semibold text-slate-300">Habit name<input ref={nameInput} required maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Reading" className="mt-2 w-full rounded-xl border border-white/10 bg-[#151e26] p-3 text-base text-white"/></label><label className="block text-xs font-semibold text-slate-300">Daily goal (minutes)<input required type="number" min="1" max="1440" step="1" value={goal} onChange={event => setGoal(event.target.value)} placeholder="Minutes" className="mt-2 w-full rounded-xl border border-white/10 bg-[#151e26] p-3 text-base text-white"/></label><div className="flex flex-wrap gap-2"><button disabled={!ready} className="rounded-xl bg-[#35c9f4] px-5 py-3 text-sm font-bold text-[#0d1117]">{editing ? 'Save habit' : 'Add habit'}</button>{editing && <button type="button" onClick={reset} className="rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-300">Cancel</button>}</div></form>
      </section>
      <section className="panel order-1 min-w-0 overflow-hidden" aria-labelledby="habits-title"><div className="border-b border-white/8 p-5 sm:p-6"><p className="eyebrow">TODAY&apos;S HABITS</p><h2 id="habits-title" className="mt-1 text-xl font-bold sm:text-2xl">Your daily goals</h2><p className="mt-1 text-sm text-slate-400">Progress updates from recorded activity.</p></div>
        {!state.habits.length ? <div className="p-8 text-center text-sm text-slate-400">Create your first habit to give an activity a daily goal.</div> : <ul className="divide-y divide-white/8">{state.habits.map(habit => {
          const value = progress.find(item => item.habit.id === habit.id)!.value;
          const streaks = habitGoalStreaks(state, habit, now ?? 0);
          const activity = activityForName(state, habit.name);
          const reminder = state.reminders.find(item => item.habitId === habit.id);
          return <li id={`habit-${habit.id}`} key={habit.id} className="min-w-0 p-5 sm:p-6"><div className="flex min-w-0 items-center gap-3 sm:gap-4"><ProgressRing progress={value} label={`${habit.name} daily progress`} size={76} color={activity.color}/><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span aria-hidden="true" className="text-lg" style={{ color: activity.color }}>{iconGlyph(activity.icon)}</span><h3 className="min-w-0 break-words font-bold">{habit.name}</h3>{value.percentage >= 100 && <span className="rounded-full bg-emerald-300/10 px-2 py-1 text-[10px] font-bold text-emerald-300">COMPLETE</span>}</div><p className="mt-1 text-xs text-slate-400">{value.minutes.toFixed(1)} / {habit.goalMinutes} minutes · {value.remainingMinutes > 0 ? `${value.remainingMinutes.toFixed(1)} remaining` : 'Daily goal reached'}</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-[#34404a]"><div className="h-full rounded-full" style={{ width: `${value.visualPercentage}%`, backgroundColor: activity.color }}/></div></div></div>
            <div className="mt-4 flex flex-wrap items-center gap-2"><button disabled={!ready || !!state.active} type="button" onClick={() => onTrack(habit.name)} className="rounded-lg bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-200">▶ Track</button><button disabled={!ready} type="button" onClick={() => { setEditing(habit.id); setName(habit.name); setGoal(String(habit.goalMinutes)); nameInput.current?.focus(); }} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-200">Edit</button><button disabled={!ready} type="button" onClick={() => { onDelete(habit.id); if (editing === habit.id) reset(); }} className="rounded-lg px-3 py-2 text-xs text-rose-200">Delete</button>{(streaks.current > 0 || streaks.longest > 0) && <span className="ml-auto text-xs text-slate-400">{streaks.current} current · {streaks.longest} longest days</span>}</div>
            <ReminderSettings key={reminder ? JSON.stringify(reminder) : 'none'} habitId={habit.id} reminder={reminder} ready={ready} onSave={onSaveReminder} onDelete={onDeleteReminder}/>
          </li>;
        })}</ul>}
      </section>
    </div>
  </div>;
}
