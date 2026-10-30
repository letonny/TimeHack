'use client';

import { useState } from 'react';
import { activityForName } from '@/lib/activity-metadata';
import { localDayKey } from '@/lib/analytics';
import { createManualDuration, createManualRange, localDateTime } from '@/lib/manual-entry';
import { trackedDuration, type Session, type TimerState } from '@/lib/timer';

const dateInput = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const timeInput = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

export function SessionEditor({ session, state, now, onSave }: { session: Session; state: TimerState; now: number; onSave: (session: Session) => boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(session.name);
  const [note, setNote] = useState(session.note ?? '');
  const [startDate, setStartDate] = useState(session.startedAt === null ? '' : dateInput(session.startedAt));
  const [startTime, setStartTime] = useState(session.startedAt === null ? '' : timeInput(session.startedAt));
  const [endDate, setEndDate] = useState(session.endedAt === null ? '' : dateInput(session.endedAt));
  const [endTime, setEndTime] = useState(session.endedAt === null ? '' : timeInput(session.endedAt));
  const totalMinutes = Math.floor(trackedDuration(session, now) / 60000);
  const [date, setDate] = useState(session.localDate ?? localDayKey(now));
  const [hours, setHours] = useState(String(Math.floor(totalMinutes / 60)));
  const [minutes, setMinutes] = useState(String(totalMinutes % 60));
  const [setLabels, setSetLabels] = useState<Record<string, string>>(() => Object.fromEntries((session.sets ?? []).map(item => [item.id, item.description])));
  const [error, setError] = useState('');
  const names = [...new Set(state.activities.map(activity => activity.name))];
  const save = () => {
    try {
      const activity = activityForName(state, name);
      let next: Session;
      if (session.entryType === 'manual_duration') next = createManualDuration({ id: session.id, name, localDate: date, hours: Number(hours), minutes: Number(minutes), activityId: activity.id || null, note }, localDayKey(now));
      else if (session.entryType === 'manual_range') next = createManualRange({ id: session.id, name, startDate, startTime, endDate, endTime, activityId: activity.id || null, note }, now);
      else {
        const trimmedName = name.trim(), trimmedNote = note.trim();
        if (!trimmedName || trimmedName.length > 120) throw new Error('Use an activity name between 1 and 120 characters.');
        if (trimmedNote.length > 2000) throw new Error('Notes must be 2,000 characters or fewer.');
        const startedAt = startDate === dateInput(session.startedAt!) && startTime === timeInput(session.startedAt!)
          ? session.startedAt! : localDateTime(startDate, startTime);
        const endedAt = endDate === dateInput(session.endedAt!) && endTime === timeInput(session.endedAt!)
          ? session.endedAt! : localDateTime(endDate, endTime);
        if (endedAt <= startedAt || endedAt > now) throw new Error('End time must follow start time and cannot be in the future.');
        const segments = session.segments.map((part, index) => ({ ...part,
          startedAt: index === 0 ? startedAt : part.startedAt,
          endedAt: index === session.segments.length - 1 ? endedAt : part.endedAt }));
        for (let index = 0; index < segments.length; index++) {
          if (segments[index].endedAt! < segments[index].startedAt || (index && segments[index].startedAt < segments[index - 1].endedAt!))
            throw new Error('The edited range overlaps recorded pauses or intervals.');
        }
        if ((session.sets ?? []).some(item => item.segments.some(part => !segments.some(parent => parent.kind === 'study' && parent.startedAt <= part.startedAt && parent.endedAt! >= (part.endedAt ?? now)))))
          throw new Error('The edited range must include every recorded SET within its activity interval.');
        const sets = (session.sets ?? []).map(item => ({ ...item, description: (setLabels[item.id] ?? item.description).trim() }));
        if (sets.some(item => !item.description || item.description.length > 120)) throw new Error('SET descriptions must be 1–120 characters.');
        next = { ...session, name: trimmedName, note: trimmedNote, activityId: activity.id || null, startedAt, endedAt, segments, sets };
      }
      if (onSave(next)) { setError(''); setOpen(false); }
      else setError('The edit remains here. Resolve the save or synchronization issue and try again.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid edit'); }
  };
  return <div className={open ? 'order-last w-full min-w-0' : ''}><button type="button" onClick={() => setOpen(value => !value)} className="rounded-lg px-3 py-2 text-xs text-teal-200 hover:bg-white/5">Edit</button>{open && <div className="mt-3 rounded-xl border border-white/10 bg-[var(--background)] p-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-slate-400">Activity<input list={`edit-activities-${session.id}`} required maxLength={120} value={name} onChange={event => setName(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-[var(--surface)] p-2 text-sm text-white"/><datalist id={`edit-activities-${session.id}`}>{names.map(value => <option key={value} value={value}/>)}</datalist></label><label className="text-xs text-slate-400">Note<textarea maxLength={2000} rows={2} value={note} onChange={event => setNote(event.target.value)} className="mt-1 w-full resize-y rounded-lg border border-white/10 bg-[var(--surface)] p-2 text-sm text-white"/></label></div>
      {session.entryType !== 'manual_duration' && <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><label className="text-xs text-slate-400">Start date<input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-[var(--surface)] p-2"/></label><label className="text-xs text-slate-400">Start time<input type="time" value={startTime} onChange={event => setStartTime(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-[var(--surface)] p-2"/></label><label className="text-xs text-slate-400">End date<input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-[var(--surface)] p-2"/></label><label className="text-xs text-slate-400">End time<input type="time" value={endTime} onChange={event => setEndTime(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-[var(--surface)] p-2"/></label></div>}
      {session.entryType === 'manual_duration' && <div className="mt-3 grid grid-cols-3 gap-2"><label className="text-xs text-slate-400">Date<input type="date" max={localDayKey(now)} value={date} onChange={event => setDate(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-[var(--surface)] p-2"/></label><label className="text-xs text-slate-400">Hours<input type="number" min="0" max="24" value={hours} onChange={event => setHours(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-[var(--surface)] p-2"/></label><label className="text-xs text-slate-400">Minutes<input type="number" min="0" max="59" value={minutes} onChange={event => setMinutes(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-[var(--surface)] p-2"/></label></div>}
      {session.entryType === 'timer' && !!session.sets?.length && <div className="mt-3 space-y-2"><p className="text-xs text-slate-400">SET descriptions</p>{session.sets.map(item => <label key={item.id} className="block text-xs text-slate-400">{new Date(item.segments[0].startedAt).toLocaleTimeString()}<input maxLength={120} value={setLabels[item.id] ?? item.description} onChange={event => setSetLabels(previous => ({ ...previous, [item.id]: event.target.value }))} className="mt-1 w-full rounded-lg border border-white/10 bg-[var(--surface)] p-2 text-sm text-white"/></label>)}</div>}
      {error && <p role="alert" className="mt-3 text-xs text-amber-200">{error}</p>}<div className="mt-3 flex gap-2"><button type="button" onClick={save} className="rounded-lg bg-teal-300 px-3 py-2 text-xs font-semibold text-slate-950">Save changes</button><button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-xs text-slate-400">Cancel</button></div></div>}</div>;
}
