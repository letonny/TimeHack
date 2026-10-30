'use client';

import { useMemo, useState } from 'react';
import { activityForName, activityForSession } from '@/lib/activity-metadata';
import { buildDayTimeline, type DayTimelineCategory } from '@/lib/analytics';
import { ringArc } from '@/lib/ring-geometry';
import type { TimerState } from '@/lib/timer';

const categoryColors: Record<Exclude<DayTimelineCategory, 'activity'>, string> = {
  break: '#ffd06d', untracked: '#293c55', remaining: '#293c55',
};
const compactDuration = (milliseconds: number) => {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h${minutes ? ` ${minutes}m` : ''}`;
  if (minutes) return `${minutes}m${seconds ? ` ${seconds}s` : ''}`;
  return `${seconds}s`;
};
const timeLabel = (timestamp: number) => new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

export function TodayActivityRing({ state, now }: { state: TimerState; now: number }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const timeline = useMemo(() => buildDayTimeline(state, now, undefined, { includeBreaks: true }), [state, now]);
  const metadataFor = (name: string, sessionId?: string) => {
    const session = sessionId ? [...state.completed, ...(state.active ? [state.active] : [])].find(item => item.id === sessionId) : null;
    return session ? activityForSession(state, session) : activityForName(state, name);
  };
  const colorFor = (category: DayTimelineCategory, name: string, sessionId?: string) => category === 'activity' ? metadataFor(name, sessionId).color : categoryColors[category];
  const selected = timeline.slices.find(slice => slice.id === (hoveredId ?? selectedId)) ?? null;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const legend = new Map<string, { category: DayTimelineCategory | 'unscheduled'; name: string; milliseconds: number; color: string }>();
  for (const slice of timeline.slices) {
    const metadata = slice.category === 'activity' ? metadataFor(slice.name, slice.sessionId) : null;
    const key = `${slice.category}:${metadata?.id || slice.name}`;
    const item = legend.get(key);
    if (item) item.milliseconds += slice.milliseconds;
    else legend.set(key, { category: slice.category, name: slice.name, milliseconds: slice.milliseconds, color: colorFor(slice.category, slice.name, slice.sessionId) });
  }
  for (const session of state.completed.filter(item => item.entryType === 'manual_duration' && item.localDate === timeline.dayKey)) {
    const key = `unscheduled:${session.name}`;
    const item = legend.get(key), activity = activityForName(state, session.name);
    if (item) item.milliseconds += session.durationMilliseconds ?? 0;
    else legend.set(key, { category: 'unscheduled', name: `${session.name} · time not specified`, milliseconds: session.durationMilliseconds ?? 0, color: activity.color });
  }

  return <section aria-labelledby="today-title" className="th-card min-w-0 p-4 sm:p-6">
    <div><h2 id="today-title" className="text-lg font-semibold tracking-tight">Your 24-hour day</h2><p className="mt-1 hidden text-xs text-[#94a9c4] sm:block">Time-of-day activity · Tap a segment for details</p></div>
    <div className="mt-5">
      <div className="mx-auto w-full max-w-[240px] sm:max-w-[310px]">
        <div className="relative aspect-square">
          <svg viewBox="0 0 100 100" className="size-full" aria-label={`Today's ${compactDuration(timeline.dayMilliseconds)} local-day activity ring. ${compactDuration(timeline.trackedMilliseconds)} total tracked time.`}>
            <circle cx="50" cy="50" r={radius} fill="none" stroke="#293c55" strokeWidth="8"/>
            {timeline.slices.map(slice => {
              const arc = ringArc(slice.startedAt, slice.milliseconds, timeline.dayStartedAt, timeline.dayMilliseconds, circumference);
              const label = `${slice.name}, ${compactDuration(slice.milliseconds)}, ${timeLabel(slice.startedAt)} to ${timeLabel(slice.endedAt)}`;
              return <circle key={slice.id} cx="50" cy="50" r={radius} fill="none" stroke={colorFor(slice.category, slice.name, slice.sessionId)} strokeWidth="8" strokeLinecap="butt" strokeDasharray={`${arc.length} ${circumference - arc.length}`} strokeDashoffset={-arc.offset} transform="rotate(-90 50 50)" tabIndex={0} role="button" aria-label={label} className="cursor-pointer outline-none transition-opacity focus:opacity-100" opacity={selected && selected.id !== slice.id ? .4 : 1} onMouseEnter={() => setHoveredId(slice.id)} onMouseLeave={() => setHoveredId(null)} onFocus={() => setHoveredId(slice.id)} onBlur={() => setHoveredId(null)} onClick={() => setSelectedId(current => current === slice.id ? null : slice.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(current => current === slice.id ? null : slice.id); } }}><title>{label}</title></circle>;
            })}
          </svg>
          <div className="pointer-events-none absolute inset-[25%] flex flex-col items-center justify-center rounded-full text-center">
            <span className="mb-1 text-[10px] font-semibold text-[#94a9c4]">TODAY&apos;S ACTIVITY</span>
            <span className="font-mono text-[clamp(1.55rem,6vw,2.7rem)] font-semibold tracking-tight tabular-nums text-white">{compactDuration(timeline.trackedMilliseconds)}</span>
            <span className="mt-1 text-[10px] text-[#94a9c4] sm:text-xs">of 24 hours</span>
          </div>
        </div>
        {timeline.dayMilliseconds !== 86_400_000 && <p className="mt-1 text-center text-[11px] text-[#94a9c4]">{compactDuration(timeline.dayMilliseconds)} local day</p>}
      </div>
      <div className="min-w-0">
        <h3 className="sr-only">Activity breakdown</h3>
        <ul className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">{[...legend.values()].filter(item => item.category === 'activity' || item.category === 'unscheduled' || item.category === 'break').map(item => <li key={`${item.category}:${item.name}`}><button type="button" disabled={item.category === 'unscheduled'} className="flex items-center gap-2 text-left disabled:cursor-default disabled:opacity-100" onClick={() => {
          const slice = timeline.slices.find(candidate => candidate.category === item.category && candidate.name === item.name);
          setSelectedId(slice?.id ?? null);
        }}><span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }}/><span className="min-w-0 truncate text-xs text-[#94a9c4]">{item.name}</span></button></li>)}</ul>
        {timeline.unscheduledMilliseconds > 0 && <p className="mt-2 text-[11px] leading-relaxed text-slate-500">Time-not-specified entries count toward the total but have no position on the ring.</p>}
        {selected && <div aria-live="polite" className="mt-4 rounded-xl border border-white/8 bg-[var(--background)]/60 p-3">
          <p className="text-sm font-medium text-white">{selected.name}</p><p className="mt-1 font-mono text-sm text-teal-200">{compactDuration(selected.milliseconds)}</p><p className="mt-1 text-[11px] text-slate-400">{timeLabel(selected.startedAt)} – {timeLabel(selected.endedAt)}</p>
        </div>}
      </div>
    </div>
  </section>;
}
