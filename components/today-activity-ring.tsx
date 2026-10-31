'use client';

import { useMemo, useState } from 'react';
import { activityForName, activityForSession } from '@/lib/activity-metadata';
import { buildDayTimeline, localDayKey, localDayStart, type DayTimelineCategory, type DayTimelineSlice } from '@/lib/analytics';
import { ringArc } from '@/lib/ring-geometry';
import { activityPiecesForSlice, sessionBreakdown, type BreakdownRow, type SessionBreakdown } from '@/lib/session-breakdown';
import type { IntervalCorrection } from '@/lib/session-corrections';
import type { Session, TimerState } from '@/lib/timer';
import { SessionEditor } from './session-editor';

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
const shortTime = (timestamp: number) => new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dateTime = (timestamp: number) => new Date(timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const rowTimeRange = (row: BreakdownRow) => localDayKey(row.startedAt) === localDayKey(row.endedAt)
  ? `${shortTime(row.startedAt)} – ${shortTime(row.endedAt)}`
  : `${dateTime(row.startedAt)} – ${dateTime(row.endedAt)}`;
const rowColor = (kind: BreakdownRow['kind']) => kind === 'break' ? 'bg-amber-300' : kind === 'travel_out' || kind === 'travel_return' ? 'bg-sky-300' : kind === 'set' ? 'bg-violet-300' : 'bg-teal-300';
type RingPiece = DayTimelineSlice & { label: string; rowKind: BreakdownRow['kind'] | DayTimelineCategory; setId?: string };

function HoverBreakdown({ breakdown, focused }: { breakdown: SessionBreakdown; focused: BreakdownRow | null }) {
  return <div id="ring-hover-tooltip" role="tooltip" className="pointer-events-none absolute bottom-2 left-1/2 z-20 hidden w-[min(260px,85%)] -translate-x-1/2 rounded-xl border border-cyan-300/20 bg-[#172430]/95 p-3 text-left shadow-2xl shadow-black/40 backdrop-blur-md md:block">
    <p className="truncate text-sm font-semibold text-white">{breakdown.name} <span className="font-mono text-cyan-200">{compactDuration(breakdown.activityMilliseconds)}</span></p>
    <p className="mt-1 text-[11px] text-slate-400">{breakdown.countsProductive ? 'Productive' : 'Personal'} activity · {breakdown.rows.length} recorded intervals</p>
    {focused && <p className="mt-2 truncate text-[11px] text-violet-200">{focused.kind === 'set' ? 'SET · ' : ''}{focused.label} · {rowTimeRange(focused)}</p>}
    <ul className="mt-2 space-y-1">{breakdown.rows.slice(0, 2).map((row, index) => <li key={`${index}:${row.startedAt}`} className="flex justify-between gap-2 text-[11px]"><span className="min-w-0 truncate text-slate-200">{row.label}</span><span className="shrink-0 font-mono text-slate-300">{compactDuration(row.milliseconds)}</span></li>)}</ul>
    {breakdown.rows.length > 2 && <p className="mt-1.5 text-[11px] text-cyan-200">+{breakdown.rows.length - 2} more · select for details</p>}
  </div>;
}

export function TodayActivityRing({ state, now, dayKey = localDayKey(now), onOpenTimer, revisions = {}, onSave, onCorrect }: {
  state: TimerState; now: number; dayKey?: string; onOpenTimer: () => void;
  revisions?: Record<string, number>; onSave?: (session: Session) => boolean;
  onCorrect?: (sessionId: string, correction: IntervalCorrection) => Promise<string | null>;
}) {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [hoveredPieceId, setHoveredPieceId] = useState<string | null>(null);

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
  const sessions = [...state.completed, ...(state.active ? [state.active] : [])];
  const visibleIds = new Set(timeline.slices.map(slice => slice.sessionId).filter((id): id is string => !!id));
  const selectedSession = sessions.find(session => session.id === selectedSessionId && visibleIds.has(session.id)) ?? null;
  const hoveredSession = sessions.find(session => session.id === hoveredSessionId && visibleIds.has(session.id)) ?? null;
  const selectedBreakdown = selectedSession ? sessionBreakdown(selectedSession, now) : null;
  const hoveredBreakdown = hoveredSession ? sessionBreakdown(hoveredSession, now) : null;
  const ringPieces = timeline.slices.flatMap<RingPiece>(slice => {
    if (slice.category !== 'activity' || !slice.sessionId) return [{ ...slice, label: slice.name, setId: undefined as string | undefined, rowKind: slice.category }];
    const session = sessions.find(item => item.id === slice.sessionId);
    if (!session) return [];
    return activityPiecesForSlice(session, slice.startedAt, slice.endedAt, now).map((part, index) => ({
      ...slice, id: `${slice.id}:${index}`, startedAt: part.startedAt, endedAt: part.endedAt,
      milliseconds: part.milliseconds, label: part.label, setId: part.setId, rowKind: part.kind,
    }));
  });
  const hoveredPiece = ringPieces.find(piece => piece.id === hoveredPieceId);
  const focusedRow: BreakdownRow | null = hoveredPiece && hoveredPiece.category === 'activity'
    ? { kind: hoveredPiece.rowKind === 'set' ? 'set' : 'activity', label: hoveredPiece.label,
      startedAt: hoveredPiece.startedAt, endedAt: hoveredPiece.endedAt, milliseconds: hoveredPiece.milliseconds, setId: hoveredPiece.setId }
    : null;
  const select = (id: string | undefined) => { if (id) setSelectedSessionId(current => current === id ? null : id); };
  const radii = [43, 35, 27];
  const hasTimedActivity = timeline.activityMilliseconds > 0 || timeline.breakMilliseconds > 0 || timeline.travelMilliseconds > 0;
  const hasActivity = hasTimedActivity || timeline.unscheduledMilliseconds > 0;
  const isToday = dayKey === localDayKey(now);
  const dayLabel = new Date(localDayStart(dayKey)).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  const legend = new Map<string, { category: DayTimelineCategory | 'unscheduled'; name: string; milliseconds: number; color: string; sessionId?: string }>();
  for (const slice of timeline.slices) {
    const metadata = slice.category === 'activity' ? metadataFor(slice.name, slice.sessionId) : null;
    const key = `${slice.category}:${metadata?.id || slice.name}:${slice.countsProductive === false ? 'personal' : 'productive'}`;
    const item = legend.get(key);
    if (item) item.milliseconds += slice.milliseconds;
    else legend.set(key, { category: slice.category, name: slice.category === 'activity' && slice.countsProductive === false ? `${slice.name} · personal` : slice.name, milliseconds: slice.milliseconds, color: colorFor(slice.category, slice.name, slice.sessionId), sessionId: slice.sessionId });
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
            {ringPieces.filter(slice => slice.sessionId && slice.milliseconds > 0 && (slice.category === 'activity' || slice.category === 'break' || slice.category === 'travel')).map(slice => {
              const lane = slice.category === 'break' ? 2 : slice.category === 'travel' ? 1 : Math.max(0, laneNames.indexOf(slice.name)) % radii.length;
              const radius = radii[lane];
              const circumference = 2 * Math.PI * radius;
              const arc = ringArc(slice.startedAt, slice.milliseconds, timeline.dayStartedAt, timeline.dayMilliseconds, circumference);
              const rounded = arc.length > 8;
              const visibleOffset = arc.offset + (rounded ? 2.75 : 0);
              const visibleLength = Math.max(0, arc.length - (rounded ? 5.5 : 0));
              const dash = `${visibleLength} ${circumference - visibleLength}`;
              const label = `${slice.rowKind === 'set' ? 'SET ' : ''}${slice.label}${slice.category === 'activity' ? slice.countsProductive === false ? ' personal' : ' productive' : ''}, ${compactDuration(slice.milliseconds)}, ${timeLabel(slice.startedAt)} to ${timeLabel(slice.endedAt)}. Select for full session breakdown.`;
              return <g key={slice.id}>
                <circle cx="50" cy="50" r={radius} fill="none" stroke={colorFor(slice.category, slice.name, slice.sessionId)} strokeWidth="5.5" strokeLinecap={rounded ? 'round' : 'butt'} strokeDasharray={dash} strokeDashoffset={-visibleOffset} transform="rotate(-90 50 50)" opacity={selectedSessionId && selectedSessionId !== slice.sessionId ? .4 : 1} pointerEvents="none" aria-hidden="true"/>
                <circle cx="50" cy="50" r={radius} fill="none" stroke="transparent" strokeWidth="13" strokeDasharray={dash} strokeDashoffset={-visibleOffset} transform="rotate(-90 50 50)" pointerEvents="stroke" tabIndex={0} role="button" aria-label={label} aria-pressed={selectedSessionId === slice.sessionId} aria-controls="ring-session-details" aria-describedby={hoveredPieceId === slice.id ? 'ring-hover-tooltip' : undefined} className="cursor-pointer outline-none focus-visible:stroke-white/30" onMouseEnter={() => { setHoveredSessionId(slice.sessionId!); setHoveredPieceId(slice.id); }} onMouseLeave={() => { setHoveredSessionId(null); setHoveredPieceId(null); }} onFocus={() => { setHoveredSessionId(slice.sessionId!); setHoveredPieceId(slice.id); }} onBlur={() => { setHoveredSessionId(null); setHoveredPieceId(null); }} onClick={() => select(slice.sessionId)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(slice.sessionId); } }}/>
              </g>;
            })}
          </svg>
          {hoveredBreakdown && <HoverBreakdown breakdown={hoveredBreakdown} focused={focusedRow}/>}
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
        <ul className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">{[...legend.values()].filter(item => item.category === 'activity' || item.category === 'unscheduled' || item.category === 'break' || item.category === 'travel').map(item => <li key={`${item.category}:${item.name}`}><button type="button" disabled={!item.sessionId} aria-label={item.sessionId ? `Select ${item.name} session breakdown` : item.name} aria-pressed={item.sessionId ? selectedSessionId === item.sessionId : undefined} className="flex min-h-11 items-center gap-2 text-left disabled:cursor-default disabled:opacity-100" onClick={() => select(item.sessionId)}><span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }}/><span className="min-w-0 truncate text-xs text-[#94a9c4]">{item.name}</span></button></li>)}</ul>
        {timeline.unscheduledMilliseconds > 0 && <p className="mt-2 text-[11px] leading-relaxed text-slate-500">Time-not-specified entries count toward the total but have no position on the ring.</p>}
        <div id="ring-session-details" aria-live="polite">{selectedSession && selectedBreakdown && <div className="mt-4 min-w-0 rounded-xl border border-cyan-300/15 bg-[var(--background)]/60 p-3 sm:p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="break-words text-sm font-semibold text-white">{selectedBreakdown.name}</p><p className="mt-1 text-xs text-slate-400">{selectedSession.startedAt !== null ? `${dateTime(selectedSession.startedAt)} – ${dateTime(selectedSession.endedAt ?? now)}` : dayLabel} · {selectedBreakdown.countsProductive ? 'Productive' : 'Personal'}</p></div><button type="button" onClick={() => setSelectedSessionId(null)} className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:text-white" aria-label="Close session breakdown">Close</button></div>
          <p className="mt-2 text-[11px] text-slate-500">Full session breakdown; ring arcs show only {dayLabel}. SETs are included in activity time.</p>
          <ol className="mt-3 max-h-[28rem] space-y-1.5 overflow-y-auto pr-1">{selectedBreakdown.rows.map((row, index) => <li key={`${index}:${row.startedAt}:${row.setId ?? row.kind}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-white/8 px-2.5 py-2 text-xs"><span className={`size-2 shrink-0 rounded-full ${rowColor(row.kind)}`}/><span className="min-w-0 flex-1 break-words text-slate-200">{row.label}</span><span className="text-slate-400">{rowTimeRange(row)}</span><span className="min-w-12 text-right font-mono text-white">{compactDuration(row.milliseconds)}</span></li>)}</ol>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4"><div className="rounded-lg bg-teal-300/8 p-2.5"><p className="text-slate-400">{selectedBreakdown.countsProductive ? 'Productive' : 'Personal'}</p><p className="mt-1 font-mono text-teal-200">{compactDuration(selectedBreakdown.activityMilliseconds)}</p></div><div className="rounded-lg bg-amber-300/8 p-2.5"><p className="text-slate-400">Breaks</p><p className="mt-1 font-mono text-amber-200">{compactDuration(selectedBreakdown.breakMilliseconds)}</p></div><div className="rounded-lg bg-sky-300/8 p-2.5"><p className="text-slate-400">Travel</p><p className="mt-1 font-mono text-sky-200">{compactDuration(selectedBreakdown.travelMilliseconds)}</p></div><div className="rounded-lg bg-white/5 p-2.5"><p className="text-slate-400">Full commitment</p><p className="mt-1 font-mono text-white">{compactDuration(selectedBreakdown.commitmentMilliseconds)}</p></div></div>
          <p className="mt-2 text-[11px] text-slate-500">Paused gaps are excluded from recorded intervals. Full commitment includes elapsed gaps.</p>
          {selectedSession.endedAt === null ? <button type="button" onClick={onOpenTimer} className="mt-3 rounded-lg border border-cyan-300/20 px-3 py-2 text-xs text-cyan-200">Open Timer</button> : onSave && <div className="mt-3 border-t border-white/8 pt-2"><p className="text-xs text-slate-400">Edit this session or correct its recorded times</p><SessionEditor key={`${selectedSession.id}:${revisions[`session:${selectedSession.id}`] ?? 0}`} session={selectedSession} state={state} now={now} onSave={onSave} revisions={revisions} onCorrect={onCorrect}/></div>}
        </div>}</div>
      </div>
    </div>
  </section>;
}
