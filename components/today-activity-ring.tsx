'use client';

import { useEffect, useMemo, useState } from 'react';
import { activityForName, activityForSession, iconGlyph } from '@/lib/activity-metadata';
import { buildDayTimeline, type DayTimelineCategory } from '@/lib/analytics';
import type { TimerState } from '@/lib/timer';

const categoryColors: Record<Exclude<DayTimelineCategory, 'activity'>, string> = {
  break: '#fbbf24', untracked: '#475569', remaining: '#1e293b',
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

export function TodayActivityRing({ state, initialNow }: { state: TimerState; initialNow: number }) {
  const [now, setNow] = useState(initialNow);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  useEffect(() => {
    const update = window.setInterval(() => setNow(Date.now()), 1000);
    const visible = () => { if (!document.hidden) setNow(Date.now()); };
    document.addEventListener('visibilitychange', visible);
    return () => { window.clearInterval(update); document.removeEventListener('visibilitychange', visible); };
  }, []);

  const timeline = useMemo(() => buildDayTimeline(state, now, undefined, { includeBreaks: true }), [state, now]);
  const metadataFor = (name: string, sessionId?: string) => {
    const session = sessionId ? [...state.completed, ...(state.active ? [state.active] : [])].find(item => item.id === sessionId) : null;
    return session ? activityForSession(state, session) : activityForName(state, name);
  };
  const colorFor = (category: DayTimelineCategory, name: string, sessionId?: string) => category === 'activity' ? metadataFor(name, sessionId).color : categoryColors[category];
  const selected = timeline.slices.find(slice => slice.id === (hoveredId ?? selectedId)) ?? null;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const legend = new Map<string, { category: DayTimelineCategory | 'unscheduled'; name: string; milliseconds: number; color: string; icon?: string }>();
  for (const slice of timeline.slices) {
    const metadata = slice.category === 'activity' ? metadataFor(slice.name, slice.sessionId) : null;
    const key = `${slice.category}:${metadata?.id || slice.name}`;
    const item = legend.get(key);
    if (item) item.milliseconds += slice.milliseconds;
    else legend.set(key, { category: slice.category, name: slice.name, milliseconds: slice.milliseconds, color: colorFor(slice.category, slice.name, slice.sessionId), icon: metadata?.icon });
  }
  for (const session of state.completed.filter(item => item.entryType === 'manual_duration' && item.localDate === timeline.dayKey)) {
    const key = `unscheduled:${session.name}`;
    const item = legend.get(key), activity = activityForName(state, session.name);
    if (item) item.milliseconds += session.durationMilliseconds ?? 0;
    else legend.set(key, { category: 'unscheduled', name: `${session.name} · time not specified`, milliseconds: session.durationMilliseconds ?? 0, color: activity.color, icon: activity.icon });
  }

  return <section aria-labelledby="today-title">
    <h2 id="today-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">Today Overview</h2>
    <div className="panel mt-5 grid gap-8 p-5 sm:p-8 lg:grid-cols-[minmax(300px,1.05fr)_minmax(280px,.95fr)] lg:items-center">
      <div className="mx-auto w-full max-w-[500px]">
        <div className="relative aspect-square">
          <svg viewBox="0 0 100 100" className="size-full drop-shadow-[0_18px_50px_rgba(13,148,136,.12)]" aria-label={`Today's ${compactDuration(timeline.dayMilliseconds)} local-day activity ring. ${compactDuration(timeline.trackedMilliseconds)} total tracked time.`}>
            {timeline.slices.map(slice => {
              const length = slice.milliseconds / timeline.dayMilliseconds * circumference;
              const offset = (slice.startedAt - timeline.dayStartedAt) / timeline.dayMilliseconds * circumference;
              const label = `${slice.name}, ${compactDuration(slice.milliseconds)}, ${timeLabel(slice.startedAt)} to ${timeLabel(slice.endedAt)}`;
              return <circle key={slice.id} cx="50" cy="50" r={radius} fill="none" stroke={colorFor(slice.category, slice.name, slice.sessionId)} strokeWidth="13" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} transform="rotate(-90 50 50)" tabIndex={0} role="button" aria-label={label} className="cursor-pointer outline-none transition-[opacity,stroke-width] focus:opacity-100 focus:[stroke-width:15]" opacity={selected && selected.id !== slice.id ? .42 : 1} onMouseEnter={() => setHoveredId(slice.id)} onMouseLeave={() => setHoveredId(null)} onFocus={() => setHoveredId(slice.id)} onBlur={() => setHoveredId(null)} onClick={() => setSelectedId(current => current === slice.id ? null : slice.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(current => current === slice.id ? null : slice.id); } }}><title>{label}</title></circle>;
            })}
          </svg>
          <div className="pointer-events-none absolute inset-[23%] flex flex-col items-center justify-center rounded-full bg-[#111f33] text-center shadow-inner">
            <span className="text-[clamp(1.7rem,7vw,3.4rem)] font-semibold tracking-tight text-white">{compactDuration(timeline.trackedMilliseconds)}</span>
            <span className="mt-1 text-xs text-slate-400 sm:text-sm">Total Tracked Time</span>
          </div>
        </div>
        <p className="mt-3 text-center text-xs text-slate-500">A chronological view of today’s {compactDuration(timeline.dayMilliseconds)} local day.</p>
      </div>
      <div>
        <h3 className="text-sm font-medium text-slate-300">Today’s time</h3>
        <ul className="mt-3 space-y-2">{[...legend.values()].map(item => <li key={`${item.category}:${item.name}`}><button type="button" disabled={item.category === 'unscheduled'} className="flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left hover:border-white/8 hover:bg-white/[.025] disabled:cursor-default disabled:opacity-100" onClick={() => {
          const slice = timeline.slices.find(candidate => candidate.category === item.category && candidate.name === item.name);
          setSelectedId(slice?.id ?? null);
        }}><span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded text-[10px] text-slate-950" style={{ backgroundColor: item.color }}>{item.icon ? iconGlyph(item.icon) : ''}</span><span className="min-w-0 flex-1 truncate text-sm text-slate-300">{item.name}</span><span className="font-mono text-sm text-white">{compactDuration(item.milliseconds)}</span></button></li>)}</ul>
        {timeline.unscheduledMilliseconds > 0 && <p className="mt-3 text-xs leading-relaxed text-slate-500">Time-not-specified entries are included in Total Tracked Time but are not placed on the chronological ring.</p>}
        <div aria-live="polite" className="mt-5 min-h-20 rounded-xl border border-white/8 bg-[#0b1424]/70 p-4">
          {selected ? <><p className="text-sm font-medium text-white">{selected.name}</p><p className="mt-1 text-lg font-semibold text-teal-200">{compactDuration(selected.milliseconds)}</p><p className="mt-1 text-xs text-slate-400">{timeLabel(selected.startedAt)} – {timeLabel(selected.endedAt)}</p></> : <><p className="text-sm font-medium text-slate-300">Explore the ring</p><p className="mt-2 text-xs leading-relaxed text-slate-500">Hover, tap, or focus a segment to see when it happened and how long it lasted.</p></>}
        </div>
      </div>
    </div>
  </section>;
}
