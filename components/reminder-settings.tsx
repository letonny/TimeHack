'use client';

import { useState } from 'react';
import { reminderSummary, validateReminder, WEEKDAYS } from '@/lib/reminders';
import type { HabitReminder, Weekday } from '@/lib/timer';

const allDays = WEEKDAYS.map(day => day.value);
const commonZones = ['UTC', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/New_York', 'Europe/London', 'Europe/Paris', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'];

export function ReminderSettings({ habitId, reminder, ready, onSave, onDelete }: {
  habitId: string;
  reminder?: HabitReminder;
  ready: boolean;
  onSave: (reminder: HabitReminder) => boolean | undefined;
  onDelete: (habitId: string) => boolean | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(reminder?.enabled ?? true);
  const [localTime, setLocalTime] = useState(reminder?.localTime ?? '09:00');
  const [timeZone, setTimeZone] = useState(reminder?.timeZone ?? '');
  const [weekdays, setWeekdays] = useState<Weekday[]>(reminder?.weekdays ?? allDays);
  const [skipIfGoalComplete, setSkipIfGoalComplete] = useState(reminder?.skipIfGoalComplete ?? true);
  const [zones, setZones] = useState(commonZones);
  const [error, setError] = useState('');

  function toggleOpen() {
    if (!open) {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setTimeZone(current => current || detected);
      const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
      const supported = intl.supportedValuesOf?.('timeZone') ?? [];
      setZones([...new Set([detected, ...commonZones, ...supported])].filter(Boolean).sort());
    }
    setOpen(value => !value);
  }

  function toggleDay(day: Weekday) {
    setWeekdays(current => current.includes(day) ? current.filter(value => value !== day) : [...current, day].sort());
  }

  function close() {
    setOpen(false);
    setError('');
  }

  return <div className="mt-4 border-t border-white/8 pt-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-[.14em] text-slate-500">Reminder schedule</p>
        <p className="mt-1 text-sm text-slate-300">{reminder ? reminderSummary(reminder) : 'No reminder configured.'}</p>
        {reminder && <p className="mt-1 text-xs text-slate-400">Delivery also requires notifications enabled on this device.</p>}
      </div>
      <button type="button" disabled={!ready} onClick={toggleOpen} aria-expanded={open}
        className="rounded-lg border border-white/10 px-3 py-2 text-xs text-teal-200 hover:bg-white/5 disabled:opacity-50">
        {reminder ? 'Reminder settings' : 'Add reminder'}
      </button>
    </div>

    {open && <form className="mt-4 rounded-xl border border-white/10 bg-[var(--background)] p-4" onSubmit={event => {
      event.preventDefault();
      try {
        const value = validateReminder({ habitId, enabled, localTime, timeZone, weekdays, skipIfGoalComplete });
        if (onSave(value)) close();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Invalid reminder settings.');
      }
    }}>
      <div className="flex items-start gap-3">
        <input id={`reminder-enabled-${habitId}`} type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} className="mt-1 size-4 accent-teal-300"/>
        <label htmlFor={`reminder-enabled-${habitId}`} className="text-sm"><span className="font-medium">Enable this schedule</span><span className="mt-1 block text-xs text-slate-500">Push delivery requires device permission and an active subscription.</span></label>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-slate-400">Local reminder time
          <input required type="time" step="60" value={localTime} onChange={event => setLocalTime(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-[var(--surface)] p-2.5 text-sm text-white"/>
        </label>
        <label className="text-xs text-slate-400">IANA time zone
          <input required list={`reminder-zones-${habitId}`} value={timeZone} onChange={event => setTimeZone(event.target.value)} placeholder="America/Chicago" autoComplete="off" className="mt-1 w-full rounded-lg border border-white/10 bg-[var(--surface)] p-2.5 text-sm text-white"/>
          <datalist id={`reminder-zones-${habitId}`}>{zones.map(zone => <option key={zone} value={zone}/>)}</datalist>
        </label>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">DST policy: repeated local times use the first occurrence; nonexistent times move to the first valid minute after the gap.</p>

      <fieldset className="mt-4"><legend className="text-xs text-slate-400">Weekdays</legend>
        <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">{WEEKDAYS.map(day => <label key={day.value} className={`cursor-pointer rounded-lg border px-2 py-2 text-center text-xs ${weekdays.includes(day.value) ? 'border-teal-300/50 bg-teal-300/10 text-teal-100' : 'border-white/10 text-slate-400'}`}>
          <input type="checkbox" checked={weekdays.includes(day.value)} onChange={() => toggleDay(day.value)} className="sr-only"/><span title={day.label}>{day.short}</span>
        </label>)}</div>
      </fieldset>

      <label className="mt-4 flex items-start gap-3 text-sm"><input type="checkbox" checked={skipIfGoalComplete} onChange={event => setSkipIfGoalComplete(event.target.checked)} className="mt-1 size-4 accent-teal-300"/><span>Skip when today&apos;s habit goal is already complete</span></label>
      {error && <p role="alert" className="mt-3 text-xs text-amber-200">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" disabled={!ready} className="rounded-lg bg-teal-300 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-50">Save schedule</button>
        <button type="button" onClick={close} className="rounded-lg px-3 py-2 text-sm text-slate-400">Cancel</button>
        {reminder && <button type="button" disabled={!ready} onClick={() => {
          if (window.confirm('Delete this reminder schedule? The habit and its history will stay unchanged.') && onDelete(habitId)) close();
        }} className="rounded-lg px-3 py-2 text-sm text-rose-200 disabled:opacity-50">Delete schedule</button>}
      </div>
    </form>}
  </div>;
}
