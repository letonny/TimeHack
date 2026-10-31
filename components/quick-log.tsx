'use client';

import { useRef, useState } from 'react';
import { activityForName, recentActivityNames } from '@/lib/activity-metadata';
import { localDayKey } from '@/lib/analytics';
import { createManualDuration, createManualRange } from '@/lib/manual-entry';
import { type Session, type TimerState } from '@/lib/timer';

export function QuickLog({ state, now, ready, onSave }: { state: TimerState; now: number; ready: boolean; onSave: (session: Session) => boolean }) {
  const today = localDayKey(now);
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<'range' | 'duration'>('range');
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState(today);
  const [endTime, setEndTime] = useState('');
  const [date, setDate] = useState(today);
  const [hours, setHours] = useState('0');
  const [minutes, setMinutes] = useState('30');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const savedRef = useRef(false);
  const recent = recentActivityNames(state);
  const allNames = [...new Set([...recent, ...state.activities.map(activity => activity.name)])];
  const reset = () => { setName(''); setStartDate(today); setStartTime(''); setEndDate(today); setEndTime(''); setDate(today); setHours('0'); setMinutes('30'); setNote(''); setError(''); };
  const build = () => {
    const activity = activityForName(state, name);
    return method === 'range'
      ? createManualRange({ id: crypto.randomUUID(), name, startDate, startTime, endDate, endTime, activityId: activity.id || null, note, countsProductive: activity.countsProductive !== false }, now)
      : createManualDuration({ id: crypto.randomUUID(), name, localDate: date, hours: Number(hours), minutes: Number(minutes), activityId: activity.id || null, note, countsProductive: activity.countsProductive !== false }, today);
  };
  return <div className="mt-4">
    <button type="button" onClick={() => { savedRef.current = false; setOpen(value => !value); }} className="w-full rounded-xl border border-teal-300/30 bg-teal-300/5 px-5 py-3.5 text-sm font-semibold text-teal-200 hover:bg-teal-300/10">＋ Log Time</button>
    {open && <div className="mt-4 rounded-2xl border border-white/10 bg-[var(--background)]/70 p-4 sm:p-5">
      <div className="flex gap-2" role="tablist" aria-label="Manual entry method"><button type="button" role="tab" aria-selected={method === 'range'} onClick={() => { setMethod('range'); setError(''); }} className={`flex-1 rounded-lg px-3 py-2 text-xs ${method === 'range' ? 'bg-teal-300 text-slate-950' : 'bg-white/5 text-slate-300'}`}>Start & end</button><button type="button" role="tab" aria-selected={method === 'duration'} onClick={() => { setMethod('duration'); setError(''); }} className={`flex-1 rounded-lg px-3 py-2 text-xs ${method === 'duration' ? 'bg-teal-300 text-slate-950' : 'bg-white/5 text-slate-300'}`}>Duration only</button></div>
      {error && <p role="alert" className="mt-3 text-xs text-amber-200">{error}</p>}
      <form className="mt-5 space-y-4" onSubmit={event => { event.preventDefault(); if (savedRef.current) return; try { const entry = build(); if (onSave(entry)) { savedRef.current = true; reset(); setOpen(false); } else setError('The entry remains here. Resolve the save or synchronization issue and try again.'); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid entry'); } }}>
        {!!recent.length && <div><p className="text-xs text-slate-500">Recent</p><div className="mt-2 flex flex-wrap gap-2">{recent.map(value => <button type="button" key={value} onClick={() => setName(value)} className="rounded-full bg-white/5 px-3 py-1.5 text-xs text-slate-300">{value}</button>)}</div></div>}
        <label className="block text-xs text-slate-400">Activity<input required list="manual-activity-names" maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder="Cooking, gym, reading…" className="mt-2 w-full rounded-xl border border-white/10 bg-[var(--surface)] p-3 text-base text-white"/><datalist id="manual-activity-names">{allNames.map(value => <option key={value} value={value}/>)}</datalist></label>
        {method === 'range' ? <div className="grid gap-3 sm:grid-cols-2"><fieldset className="grid grid-cols-2 gap-2"><legend className="mb-2 text-xs text-slate-400">Start</legend><input aria-label="Start date" required type="date" value={startDate} onChange={event => setStartDate(event.target.value)} className="min-w-0 rounded-lg border border-white/10 bg-[var(--surface)] p-2 text-sm"/><input aria-label="Start time" required type="time" value={startTime} onChange={event => setStartTime(event.target.value)} className="min-w-0 rounded-lg border border-white/10 bg-[var(--surface)] p-2 text-sm"/></fieldset><fieldset className="grid grid-cols-2 gap-2"><legend className="mb-2 text-xs text-slate-400">End</legend><input aria-label="End date" required type="date" value={endDate} onChange={event => setEndDate(event.target.value)} className="min-w-0 rounded-lg border border-white/10 bg-[var(--surface)] p-2 text-sm"/><input aria-label="End time" required type="time" value={endTime} onChange={event => setEndTime(event.target.value)} className="min-w-0 rounded-lg border border-white/10 bg-[var(--surface)] p-2 text-sm"/></fieldset></div> : <div className="grid grid-cols-3 gap-2"><label className="text-xs text-slate-400">Date<input required type="date" max={today} value={date} onChange={event => setDate(event.target.value)} className="mt-2 w-full rounded-lg border border-white/10 bg-[var(--surface)] p-2 text-sm"/></label><label className="text-xs text-slate-400">Hours<input required type="number" min="0" max="24" step="1" value={hours} onChange={event => setHours(event.target.value)} className="mt-2 w-full rounded-lg border border-white/10 bg-[var(--surface)] p-2 text-sm"/></label><label className="text-xs text-slate-400">Minutes<input required type="number" min="0" max="59" step="1" value={minutes} onChange={event => setMinutes(event.target.value)} className="mt-2 w-full rounded-lg border border-white/10 bg-[var(--surface)] p-2 text-sm"/></label></div>}
        <label className="block text-xs text-slate-400">Note <span className="text-slate-600">(optional)</span><textarea maxLength={2000} value={note} onChange={event => setNote(event.target.value)} rows={3} placeholder="What did you work on?" className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-[var(--surface)] p-3 text-sm text-white"/></label>
        <button disabled={!ready} className="w-full rounded-xl bg-teal-300 px-4 py-3 text-sm font-semibold text-slate-950">Save entry</button>
      </form>
    </div>}
  </div>;
}
