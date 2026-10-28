'use client';

import { useState } from 'react';
import { activityForSession, iconGlyph } from '@/lib/activity-metadata';
import { addLocalDays, buildDayTimeline, localDayKey, localDayStart } from '@/lib/analytics';
import { formatCompletedDuration, type Session, type TimerState } from '@/lib/timer';
import { SessionEditor } from './session-editor';
import { SessionReport } from './session-report';

const clock = (timestamp: number) => new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function DailyTimeline({ state, now, dayKey, onSelectDay, onSave }: { state: TimerState; now: number; dayKey: string; onSelectDay: (dayKey: string) => void; onSave: (session: Session) => boolean }) {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const timeline = buildDayTimeline(state, now, dayKey, { includeBreaks: true });
  const unscheduled = state.completed.filter(session => session.entryType === 'manual_duration' && session.localDate === dayKey);
  const selected = selectedSessionId ? [...state.completed, ...(state.active ? [state.active] : [])].find(session => session.id === selectedSessionId) : null;
  const today = localDayKey(now);
  const label = new Date(localDayStart(dayKey)).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return <section className="panel mt-8 p-5 sm:p-8" aria-labelledby="timeline-title">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow">DAY BREAKDOWN</p><h2 id="timeline-title" className="mt-2 text-xl font-semibold">Daily Timeline</h2><p className="mt-1 text-sm text-slate-400">{label}</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => onSelectDay(addLocalDays(dayKey, -1))} className="rounded-lg bg-white/5 px-3 py-2 text-sm" aria-label="Previous day">←</button><button type="button" onClick={() => onSelectDay(today)} className="rounded-lg bg-white/5 px-3 py-2 text-xs text-slate-300">Today</button><button type="button" disabled={dayKey >= today} onClick={() => onSelectDay(addLocalDays(dayKey, 1))} className="rounded-lg bg-white/5 px-3 py-2 text-sm" aria-label="Next day">→</button></div></div>
    <ol className="relative mt-6 space-y-2 before:absolute before:top-3 before:bottom-3 before:left-[19px] before:w-px before:bg-white/10">{timeline.slices.map(slice => {
      const session = slice.sessionId ? [...state.completed, ...(state.active ? [state.active] : [])].find(item => item.id === slice.sessionId) : null;
      const activity = session ? activityForSession(state, session) : null;
      const tracked = slice.category === 'activity' || slice.category === 'break';
      const color = slice.category === 'break' ? '#fbbf24' : activity?.color ?? (slice.category === 'untracked' ? '#475569' : '#1e293b');
      const content = <><span aria-hidden="true" className="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-xl border-4 border-[#111f33] text-xs text-slate-950" style={{ backgroundColor: color }}>{slice.category === 'activity' ? iconGlyph(activity?.icon ?? 'circle') : slice.category === 'break' ? 'Ⅱ' : '·'}</span><span className="min-w-0 flex-1"><span className={`block text-sm font-medium ${tracked ? 'text-white' : 'text-slate-500'}`}>{slice.name}</span><span className="mt-1 block text-xs text-slate-500">{clock(slice.startedAt)} – {clock(slice.endedAt)}</span></span><span className="font-mono text-sm text-slate-300">{formatCompletedDuration(slice.milliseconds)}</span></>;
      return <li key={slice.id}>{session ? <button type="button" onClick={() => setSelectedSessionId(session.id)} className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-white/[.025]" aria-label={`Open ${session.name} session details`}>{content}</button> : <div className="flex items-center gap-3 rounded-xl p-2">{content}</div>}</li>;
    })}</ol>
    {!!unscheduled.length && <div className="mt-6 border-t border-white/8 pt-5"><h3 className="text-sm font-medium">Unscheduled / Time not specified</h3><ul className="mt-3 space-y-2">{unscheduled.map(session => { const activity = activityForSession(state, session); return <li key={session.id} className="rounded-xl bg-white/[.025] p-3"><div className="flex items-center gap-3"><span aria-hidden="true" className="flex size-9 items-center justify-center rounded-lg text-slate-950" style={{ backgroundColor: activity.color }}>{iconGlyph(activity.icon)}</span><button type="button" onClick={() => setSelectedSessionId(session.id)} className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-medium">{session.name}</span><span className="text-xs text-slate-500">Time not specified</span></button><span className="font-mono text-sm">{formatCompletedDuration(session.durationMilliseconds ?? 0)}</span><SessionEditor session={session} state={state} now={now} onSave={onSave}/></div></li>; })}</ul></div>}
    {selected && <div className="mt-6 border-t border-white/8 pt-6"><div className="mb-3 flex justify-end"><button type="button" onClick={() => setSelectedSessionId(null)} className="text-xs text-slate-500">Close details</button></div><SessionReport session={selected} now={selected.endedAt ?? now} title="Timeline selection"/>{selected.endedAt !== null && <div className="mt-3"><SessionEditor session={selected} state={state} now={now} onSave={onSave}/></div>}</div>}
  </section>;
}
