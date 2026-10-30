'use client';

import { useMemo, useState } from 'react';
import {
  activityHistoryForDay, activityNames, activityStreaks, addLocalDays, dailyActivity,
  localDayKey, localDayStart,
} from '@/lib/analytics';
import type { TimerState } from '@/lib/timer';
import { activityForName, activityForSession, iconGlyph } from '@/lib/activity-metadata';

const levels = ['bg-white/5', 'bg-teal-950', 'bg-teal-800', 'bg-teal-500', 'bg-teal-300'];
const levelForMinutes = (minutes: number) => minutes === 0 ? 0 : minutes < 15 ? 1 : minutes < 30 ? 2 : minutes < 60 ? 3 : 4;
const formatMinutes = (minutes: number) => minutes < 1 && minutes > 0 ? '<1 min' : `${Math.round(minutes)} min`;

function calendarDays(now: number) {
  const today = localDayKey(now);
  const sunday = new Date(localDayStart(today));
  sunday.setDate(sunday.getDate() - sunday.getDay());
  const start = addLocalDays(localDayKey(sunday.getTime()), -51 * 7);
  return Array.from({ length: 52 }, (_, week) => Array.from({ length: 7 }, (_, day) => addLocalDays(start, week * 7 + day)));
}

export function ActivityCalendar({ state, now, selectedDay: controlledDay, onSelectDay }: { state: TimerState; now: number; selectedDay?: string; onSelectDay?: (dayKey: string) => void }) {
  const [filter, setFilter] = useState('');
  const [chosenDay, setChosenDay] = useState<string | null>(null);
  const today = localDayKey(now);
  const selectedDay = controlledDay ?? chosenDay ?? today;
  const weeks = useMemo(() => calendarDays(now), [now]);
  const totals = useMemo(() => dailyActivity(state, now, filter || undefined), [state, now, filter]);
  const history = useMemo(() => activityHistoryForDay(state, selectedDay, now, filter || undefined), [state, selectedDay, now, filter]);
  const streaks = useMemo(() => activityStreaks(state, now, filter || undefined), [state, now, filter]);
  const names = useMemo(() => activityNames(state), [state]);
  const selectedMinutes = (totals.get(selectedDay)?.milliseconds ?? 0) / 60000;
  const selectedLabel = new Date(localDayStart(selectedDay)).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return <section className="panel p-5 sm:p-6" aria-labelledby="activity-calendar-title">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="eyebrow">CONSISTENCY</p><h2 id="activity-calendar-title" className="mt-2 text-xl font-bold sm:text-2xl">Activity calendar</h2><p className="mt-2 max-w-2xl text-sm text-slate-400">Productive minutes by local calendar day. Recorded breaks and pauses do not advance activity streaks or habit goals.</p></div>
      <label className="text-xs text-slate-400">Activity
        <select value={filter} onChange={event => setFilter(event.target.value)} className="mt-2 block min-w-44 rounded-xl border border-white/10 bg-[var(--background)] px-3 py-2.5 text-sm text-white">
          <option value="">All activities</option>{names.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
    </div>
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl border border-white/8 bg-white/[.025] p-4"><p className="text-xs text-slate-400">Current streak</p><p className="mt-1 text-2xl font-semibold text-teal-200">{streaks.current} <span className="text-sm font-normal text-slate-400">{streaks.current === 1 ? 'day' : 'days'}</span></p><p className="mt-1 text-xs text-slate-500">Stays active when yesterday qualified and today is still open.</p></div>
      <div className="rounded-xl border border-white/8 bg-white/[.025] p-4"><p className="text-xs text-slate-400">Longest streak</p><p className="mt-1 text-2xl font-semibold text-white">{streaks.longest} <span className="text-sm font-normal text-slate-400">{streaks.longest === 1 ? 'day' : 'days'}</span></p><p className="mt-1 text-xs text-slate-500">Consecutive local days with recorded activity time.</p></div>
    </div>
    <div className="mt-6 overflow-x-auto pb-2" aria-label="52 week activity calendar">
      <div className="min-w-[780px]">
        <div className="mb-2 ml-8 grid grid-cols-[repeat(52,minmax(0,1fr))] gap-1 text-[10px] text-slate-500" aria-hidden="true">{weeks.map((week, index) => {
          const first = new Date(localDayStart(week[0]));
          const prior = index ? new Date(localDayStart(weeks[index - 1][0])).getMonth() : -1;
          return <span key={week[0]} className="truncate">{first.getMonth() !== prior ? first.toLocaleDateString([], { month: 'short' }) : ''}</span>;
        })}</div>
        <div className="flex gap-2">
          <div className="grid w-6 shrink-0 grid-rows-7 gap-1 text-[10px] text-slate-500" aria-hidden="true"><span/><span>Mon</span><span/><span>Wed</span><span/><span>Fri</span><span/></div>
          <div className="grid flex-1 grid-cols-[repeat(52,minmax(0,1fr))] gap-1" role="grid">{weeks.map(week => <div key={week[0]} className="grid grid-rows-7 gap-1">{week.map(dayKey => {
            const isFuture = dayKey > today;
            const minutes = (totals.get(dayKey)?.milliseconds ?? 0) / 60000;
            const dateLabel = new Date(localDayStart(dayKey)).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
            const description = `${dateLabel}: ${formatMinutes(minutes)} of study or focus activity${filter ? ` for ${filter}` : ''}`;
            return <button key={dayKey} type="button" disabled={isFuture} onClick={() => { setChosenDay(dayKey); onSelectDay?.(dayKey); }} aria-label={description} aria-pressed={selectedDay === dayKey} title={description} className={`aspect-square min-h-3 rounded-[3px] border ${selectedDay === dayKey ? 'border-white ring-1 ring-teal-200' : 'border-white/5'} ${isFuture ? 'bg-transparent' : levels[levelForMinutes(minutes)]}`} />;
          })}</div>)}</div>
        </div>
      </div>
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
      <p>Scroll to explore the full 52 weeks.</p><div className="flex items-center gap-1" aria-label="Activity intensity legend"><span className="mr-1">Less</span>{levels.map((level, index) => <span key={level} className={`size-3 rounded-[3px] border border-white/5 ${level}`} title={['No activity', 'Under 15 minutes', '15–29 minutes', '30–59 minutes', '60 minutes or more'][index]}><span className="sr-only">{['No activity', 'Under 15 minutes', '15 to 29 minutes', '30 to 59 minutes', '60 minutes or more'][index]}</span></span>)}<span className="ml-1">More</span></div>
    </div>
    <div className="mt-6 border-t border-white/8 pt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><div><h3 className="font-medium">{selectedLabel}</h3><p className="mt-1 text-sm text-slate-400">{filter || 'All activities'}</p></div><p className="font-mono text-lg text-teal-200">{formatMinutes(selectedMinutes)}</p></div>
      {!history.length ? <p className="mt-5 rounded-xl bg-white/[.025] p-4 text-sm text-slate-400">No study or focus activity logged for this day.</p> : <ul className="mt-4 divide-y divide-white/8">{history.map(item => { const session = [...state.completed, ...(state.active ? [state.active] : [])].find(candidate => candidate.id === item.sessionId); const activity = session ? activityForSession(state, session) : activityForName(state, item.name); return <li key={item.sessionId} className="flex items-center justify-between gap-4 py-3"><span aria-hidden="true" className="flex size-8 items-center justify-center rounded-lg text-xs text-slate-950" style={{ backgroundColor: activity.color }}>{iconGlyph(activity.icon)}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.name}</p><p className="mt-1 text-xs text-slate-500">{item.startedAt === null ? 'Time not specified' : new Date(item.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p></div><span className="shrink-0 text-sm text-slate-300">{formatMinutes(item.milliseconds / 60000)}</span></li>; })}</ul>}
    </div>
  </section>;
}
