'use client';

import { useMemo, useState } from 'react';
import { activityForName, activityForSession } from '@/lib/activity-metadata';
import { buildDayTimeline, localDayKey, localDayStart, type DayTimelineCategory } from '@/lib/analytics';
import { ringArc } from '@/lib/ring-geometry';
import type { TimerState } from '@/lib/timer';

const categoryColors: Record<Exclude<DayTimelineCategory, 'activity'>, string> = {
  break: '#ffd06d', travel: '#7dd3fc', untracked: '#293c55', remaining: '#293c55',
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

export function TodayActivityRing({ state, now, dayKey = localDayKey(now), onOpenTimer }: { state: TimerState; now: number; dayKey?: string; onOpenTimer: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const timeline = useMemo(() => buildDayTimeline(state, now, dayKey, { includeBreaks: true }), [state, now, dayKey]);
  const laneNames = [...new Set(timeline.slices.filter(slice => slice.category === 'activity').map(slice => slice.name))];
  const metadataFor = (name: string, sessionId?: string) => {
    const session = sessionId ? [...state.completed, ...(state.active ? [state.active] : [])].find(item => item.id === sessionId) : null;
    return session ? activityForSession(state, session) : activityForName(state, name);
  };
  const colorFor = (category: DayTimelineCategory, name: string, sessionId?: string) => {
    if (category !== 'activity') return categoryColors[category];
    const metadata = metadataFor(name, sessionId);
    return metadata.id ? metadata.color : ['#25c7ff', '#6cf878', '#b75dff', '#ff674c', '#15ebd1'][Math.max(0, laneNames.indexOf(name)) % 5];
  };
  const selected = timeline.slices.find(slice => slice.id === (hoveredId ?? selectedId)) ?? null;
  const radii = [43, 35, 27];
  const hasTimedActivity = timeline.activityMilliseconds > 0 || timeline.breakMilliseconds > 0 || timeline.travelMilliseconds > 0;
  const hasActivity = hasTimedActivity || timeline.unscheduledMilliseconds > 0;
  const isToday = dayKey === localDayKey(now);
  const dayLabel = new Date(localDayStart(dayKey)).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  const legend = new Map<string, { category: DayTimelineCategory | 'unscheduled'; name: string; milliseconds: number; color: string }>();
  for (const slice of timeline.slices) {
    const metadata = slice.category === 'activity' ? metadataFor(slice.name, slice.sessionId) : null;
    const key = `${slice.category}:${metadata?.id || slice.name}:${slice.countsProductive === false ? 'personal' : 'productive'}`;
    const item = legend.get(key);
    if (item) item.milliseconds += slice.milliseconds;
    else legend.set(key, { category: slice.category, name: slice.category === 'activity' && slice.countsProductive === false ? `${slice.name} · personal` : slice.name, milliseconds: slice.milliseconds, color: colorFor(slice.category, slice.name, slice.sessionId) });
  }
  for (const session of state.completed.filter(item => item.entryType === 'manual_duration' && item.localDate === timeline.dayKey)) {
    const key = `unscheduled:${session.name}`;
    const item = legend.get(key), activity = activityForName(state, session.name);
    if (item) item.milliseconds += session.durationMilliseconds ?? 0;
    else legend.set(key, { category: 'unscheduled', name: `${session.name} · time not specified`, milliseconds: session.durationMilliseconds ?? 0, color: activity.color });
  }

  return <section aria-labelledby="today-title" className="th-card th-ring-card min-w-0 p-5 sm:p-6">
    <div className="flex items-center justify-between gap-3"><div><p className="eyebrow">DAY DISTRIBUTION</p><h2 id="today-title" className="mt-2 text-xl font-bold tracking-tight sm:text-2xl">Your 24-hour day</h2><p className="mt-1 text-xs text-[#9ba8b8]">{dayLabel} · local time</p></div><span className="hidden rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 xl:inline">{isToday ? 'TODAY' : dayLabel}</span></div>
    <div className="mt-5">
      <div className="mx-auto w-full max-w-[290px] sm:max-w-[330px] 2xl:max-w-[360px]">
        <div className="relative aspect-square">
          <svg viewBox="0 0 100 100" className="size-full" aria-label={`${dayLabel} ${compactDuration(timeline.dayMilliseconds)} local-day activity ring. ${compactDuration(timeline.trackedActivityMilliseconds)} total tracked time.`}>
            <defs><linearGradient id="empty-ring-track" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#455c60"/><stop offset=".5" stopColor="#2b393d"/><stop offset="1" stopColor="#43575a"/></linearGradient></defs>
            {(hasTimedActivity ? radii : [43]).map(radius => <circle key={radius} cx="50" cy="50" r={radius} fill="none" stroke={hasTimedActivity ? '#304045' : 'url(#empty-ring-track)'} strokeWidth="5.5"/>)}
            {timeline.slices.filter(slice => slice.category === 'activity' || slice.category === 'break' || slice.category === 'travel').map(slice => {
              const lane = slice.category === 'break' ? 2 : slice.category === 'travel' ? 1 : Math.max(0, laneNames.indexOf(slice.name)) % radii.length;
              const radius = radii[lane];
              const circumference = 2 * Math.PI * radius;
              const arc = ringArc(slice.startedAt, slice.milliseconds, timeline.dayStartedAt, timeline.dayMilliseconds, circumference);
              const rounded = arc.length > 8;
              const visibleOffset = arc.offset + (rounded ? 2.75 : 0);
              const visibleLength = arc.length - (rounded ? 5.5 : 0);
              const label = `${slice.name}${slice.category === 'activity' ? slice.countsProductive === false ? ' (personal)' : ' (productive)' : ''}, ${compactDuration(slice.milliseconds)}, ${timeLabel(slice.startedAt)} to ${timeLabel(slice.endedAt)}`;
              return <circle key={slice.id} cx="50" cy="50" r={radius} fill="none" stroke={colorFor(slice.category, slice.name, slice.sessionId)} strokeWidth="5.5" strokeLinecap={rounded ? 'round' : 'butt'} strokeDasharray={`${visibleLength} ${circumference - visibleLength}`} strokeDashoffset={-visibleOffset} transform="rotate(-90 50 50)" tabIndex={0} role="button" aria-label={label} className="cursor-pointer outline-none transition-opacity focus:opacity-100" opacity={selected && selected.id !== slice.id ? .4 : 1} onMouseEnter={() => setHoveredId(slice.id)} onMouseLeave={() => setHoveredId(null)} onFocus={() => setHoveredId(slice.id)} onBlur={() => setHoveredId(null)} onClick={() => setSelectedId(current => current === slice.id ? null : slice.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(current => current === slice.id ? null : slice.id); } }}><title>{label}</title></circle>;
            })}
          </svg>
          <div className="pointer-events-none absolute inset-[28%] flex flex-col items-center justify-center rounded-full text-center">
            <span className="mb-1 text-[10px] font-semibold text-[#b0c1c5]">{hasTimedActivity ? 'TRACKED ACTIVITY' : hasActivity ? 'UNTIMED' : 'READY TO BEGIN'}</span>
            <span className="whitespace-nowrap text-[clamp(1.2rem,4vw,2.3rem)] font-bold tracking-tight tabular-nums text-white">{compactDuration(timeline.trackedActivityMilliseconds)}</span>
            <span className="mt-1 text-[10px] text-[#94a9c4] sm:text-xs">of {compactDuration(timeline.dayMilliseconds)}</span>
          </div>
        </div>
        {timeline.dayMilliseconds !== 86_400_000 && <p className="mt-1 text-center text-[11px] text-[#94a9c4]">{compactDuration(timeline.dayMilliseconds)} local day</p>}
      </div>
      {!hasActivity && <div className="mx-auto mt-4 max-w-sm text-center"><p className="text-sm text-[#aebec1]">{isToday ? 'Your first session will light up this ring.' : 'No activity was recorded for this day.'}</p>{isToday && <button type="button" onClick={onOpenTimer} className="mt-4 rounded-full bg-[#7ec8d5] px-6 py-3 text-sm font-bold text-[#102026] hover:bg-[#a4dce4]">Start tracking →</button>}</div>}
      <div className="min-w-0">
        <h3 className="sr-only">Activity breakdown</h3>
        <ul className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">{[...legend.values()].filter(item => item.category === 'activity' || item.category === 'unscheduled' || item.category === 'break' || item.category === 'travel').map(item => <li key={`${item.category}:${item.name}`}><button type="button" disabled={item.category === 'unscheduled'} className="flex items-center gap-2 text-left disabled:cursor-default disabled:opacity-100" onClick={() => {
          const slice = timeline.slices.find(candidate => candidate.category === item.category && candidate.name === item.name.replace(/ · personal$/, '') && (item.name.endsWith(' · personal') ? candidate.countsProductive === false : true));
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
