'use client';

import { useState } from 'react';
import { localDayStart } from '@/lib/analytics';
import type { HourBucket } from '@/lib/productivity-analytics';

export function AnalyticsMetric({ label, value, note, tone }: { label: string; value: string; note: string; tone: 'cyan' | 'emerald' | 'violet' | 'amber' }) {
  return <div className={`analytics-metric analytics-metric--${tone} min-w-0 rounded-2xl p-4 sm:p-5`}>
    <div className="flex items-center gap-2"><span className="analytics-metric-dot size-2 shrink-0 rounded-full"/><p className="min-w-0 text-[10px] font-bold leading-tight tracking-[.06em] text-[#aebdc9] uppercase xl:text-xs">{label}</p></div>
    <p className="mt-3 truncate text-[clamp(1.35rem,3vw,2.3rem)] font-bold leading-none tracking-tight tabular-nums" title={value}>{value}</p>
    <p className="mt-2 min-h-[2.3em] text-[11px] leading-tight text-[#9ba8b8] sm:text-xs">{note}</p>
  </div>;
}

const hours = (timestamp: number) => new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', timeZoneName: 'short' });
const minutes = (milliseconds: number) => `${Math.round(milliseconds / 60_000)} min`;

export function ActivityOverDayChart({ buckets, selectedActivity, activityNames, onSelectActivity, dayLabel, untimedMilliseconds }: {
  buckets: HourBucket[]; selectedActivity: string; activityNames: string[]; onSelectActivity: (value: string) => void;
  dayLabel: string; untimedMilliseconds: number;
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const selected = selectedIndex === null ? null : buckets[selectedIndex] ?? null;
  const hasTimed = buckets.some(bucket => bucket.productiveMilliseconds + bucket.breakMilliseconds > 0);
  return <section aria-labelledby="activity-chart-title" className="th-card analytics-card min-w-0 p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="analytics-eyebrow">DAILY PATTERN</p><h2 id="activity-chart-title" className="mt-1 text-xl font-bold sm:text-2xl">Activity over the day</h2><p className="mt-1 text-xs text-[#9ba8b8]">{dayLabel} · local time</p></div>
      <label className="text-xs text-[#9ba8b8]">Activity <select value={selectedActivity} onChange={event => { onSelectActivity(event.target.value); setSelectedIndex(null); }} className="ml-2 max-w-36 rounded-lg border border-white/10 bg-[#252d36] px-2 py-2 text-sm text-white"><option value="">All activities</option>{activityNames.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
    </div>
    {hasTimed ? <>
      <div className="mt-6 flex gap-2"><div aria-hidden="true" className="flex h-44 shrink-0 flex-col justify-between pb-5 text-[10px] text-[#798897]"><span>60m</span><span>30m</span><span>0</span></div>
        <div className="min-w-0 flex-1 overflow-x-auto pb-2"><div className="min-w-[510px]"><div className="analytics-chart-grid relative flex h-40 items-end gap-1 border-b border-white/10">{buckets.map((bucket, index) => {
          const productive = bucket.productiveMilliseconds / 3_600_000 * 100;
          const breaks = bucket.breakMilliseconds / 3_600_000 * 100;
          return <button key={bucket.startedAt} type="button" onClick={() => setSelectedIndex(index)} title={`${hours(bucket.startedAt)}: ${minutes(bucket.productiveMilliseconds)} productive, ${minutes(bucket.breakMilliseconds)} breaks`} aria-label={`${hours(bucket.startedAt)}: ${minutes(bucket.productiveMilliseconds)} productive, ${minutes(bucket.breakMilliseconds)} breaks`} aria-pressed={selectedIndex === index} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end rounded-sm focus-visible:outline-offset-0"><span className="block w-full rounded-t-sm bg-[#35c9f4] transition-colors group-hover:bg-[#75dfff]" style={{ height: `${productive}%` }}/><span className="block w-full bg-[#f4be59]" style={{ height: `${breaks}%` }}/></button>;
        })}</div><div className="mt-2 flex justify-between text-[10px] text-[#9ba8b8]">{[0, .25, .5, .75, 1].map(fraction => { const index = Math.floor(buckets.length * fraction); const timestamp = index === buckets.length ? buckets.at(-1)!.endedAt : buckets[index].startedAt; return <span key={fraction}>{new Date(timestamp).toLocaleTimeString([], { hour: 'numeric' })}</span>; })}</div></div></div></div>
      <p className="mt-2 text-[11px] text-[#9ba8b8] xl:hidden">Swipe the chart to view the full local day.</p><div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[#acb9c5]"><span><i className="mr-2 inline-block size-2 rounded-sm bg-[#35c9f4]"/>Productive</span><span><i className="mr-2 inline-block size-2 rounded-sm bg-[#f4be59]"/>Recorded breaks</span>{selected && <span role="status" className="text-white">{hours(selected.startedAt)} · {minutes(selected.productiveMilliseconds)} productive · {minutes(selected.breakMilliseconds)} breaks</span>}</div>
    </> : <div className="mt-6 rounded-xl border border-dashed border-white/10 bg-white/[.025] px-5 py-10 text-center"><p className="font-medium text-[#d7e2eb]">No timed activity on this day</p><p className="mt-2 text-sm text-[#9ba8b8]">Start a timer or add a time-range entry to see its daily pattern.</p></div>}
    {untimedMilliseconds > 0 && <p className="mt-4 text-xs text-[#9ba8b8]">{minutes(untimedMilliseconds)} of duration-only activity counts in totals but has no clock time to plot.</p>}
    {buckets.length !== 24 && <p className="mt-2 text-xs text-[#9ba8b8]">This local day has {buckets.length} hours because of daylight saving time.</p>}
  </section>;
}

export function ProductivityTrendChart({ points, label, comparison }: {
  points: { dayKey: string; milliseconds: number; future: boolean }[]; label: string; comparison: string | null;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const max = Math.max(60_000, ...points.map(point => point.milliseconds));
  const selected = points.find(point => point.dayKey === selectedKey);
  const hasActivity = points.some(point => point.milliseconds > 0);
  return <section aria-labelledby="trend-title" className="th-card analytics-card min-w-0 p-5 sm:p-6">
    <div><p className="analytics-eyebrow">PRODUCTIVE TIME</p><h2 id="trend-title" className="mt-1 text-xl font-bold sm:text-2xl">Your trend</h2><p className="mt-1 text-xs text-[#9ba8b8]">{label}{comparison ? ` · ${comparison}` : ''}</p></div>
    {hasActivity ? <div className="mt-6 overflow-x-auto pb-2"><div className={`flex h-40 items-end gap-2 border-b border-white/10 ${points.length > 14 ? 'min-w-[620px]' : 'min-w-[260px]'}`}>{points.map(point => <button key={point.dayKey} type="button" disabled={point.future} onClick={() => setSelectedKey(point.dayKey)} title={`${new Date(localDayStart(point.dayKey)).toLocaleDateString()}: ${minutes(point.milliseconds)} productive`} aria-label={`${new Date(localDayStart(point.dayKey)).toLocaleDateString()}: ${minutes(point.milliseconds)} productive`} aria-pressed={selectedKey === point.dayKey} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end"><span className="w-full max-w-9 rounded-t-md bg-gradient-to-t from-[#1577a0] to-[#42d9a2] transition-colors group-hover:from-[#35c9f4]" style={{ height: `${Math.max(point.milliseconds > 0 ? 3 : 0, point.milliseconds / max * 100)}%`, opacity: point.future ? .2 : 1 }}/></button>)}</div><div className={`mt-2 flex gap-2 text-center text-[10px] text-[#9ba8b8] ${points.length > 14 ? 'min-w-[620px]' : 'min-w-[260px]'}`}>{points.map((point, index) => <span key={point.dayKey} className="min-w-0 flex-1 truncate">{points.length <= 7 || index % 5 === 0 ? new Date(localDayStart(point.dayKey)).toLocaleDateString([], { month: 'numeric', day: 'numeric' }) : ''}</span>)}</div></div> : <div className="mt-6 rounded-xl border border-dashed border-white/10 bg-white/[.025] px-5 py-10 text-center text-sm text-[#9ba8b8]">Your productive time will appear here as you track activity.</div>}
    {selected && <p role="status" className="mt-3 text-sm text-[#d7e2eb]">{new Date(localDayStart(selected.dayKey)).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}: {minutes(selected.milliseconds)} productive</p>}
    <p className="mt-3 text-xs text-[#9ba8b8]">Paused and break time excluded. Duration-only entries are included on their saved date.</p>
  </section>;
}
