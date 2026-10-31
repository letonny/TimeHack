'use client';

import { useMemo, useState } from 'react';
import { activityForName } from '@/lib/activity-metadata';
import { localDayKey, localDayStart } from '@/lib/analytics';
import { analyzeInsights, insightsDayKeys, makeInsightsRange, type InsightsPreset, type InsightsRange } from '@/lib/productivity-insights';
import { formatCompletedDuration, type TimerState } from '@/lib/timer';
import { AnalyticsMetric } from './home-analytics';

const formatTime = (milliseconds: number) => formatCompletedDuration(milliseconds);
const dayLabel = (day: string) => new Date(localDayStart(day)).toLocaleDateString([], { month: 'short', day: 'numeric' });
const fullDayLabel = (day: string) => new Date(localDayStart(day)).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const patternColors = ['#a78bfa', '#35c9f4', '#42d9a2', '#f4be59'];

function ChartEmpty({ children }: { children: string }) {
  return <div className="mt-5 rounded-xl border border-dashed border-white/10 bg-white/[.025] px-5 py-9 text-center text-sm text-slate-400">{children}</div>;
}

export function ProductivityInsights({ state, now }: { state: TimerState; now: number }) {
  const [preset, setPreset] = useState<InsightsPreset | 'custom'>(7);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [customError, setCustomError] = useState('');
  const [customRange, setCustomRange] = useState<InsightsRange | null>(null);
  const [selectedTrend, setSelectedTrend] = useState<number | null>(null);
  const todayKey = localDayKey(now);
  const latestCompletedAt = useMemo(() => state.completed.reduce((latest, session) => Math.max(latest, session.endedAt ?? 0), 0), [state.completed]);
  const tick = state.active ? 10_000 : 60_000;
  const analysisNow = Math.min(now, Math.max(Math.floor(now / tick) * tick, latestCompletedAt));
  const range = useMemo(() => preset === 'custom' && customRange ? customRange : makeInsightsRange(localDayStart(todayKey), preset === 'custom' ? 7 : preset), [preset, customRange, todayKey]);
  const report = useMemo(() => analyzeInsights(state, analysisNow, range), [state, analysisNow, range]);
  const maxTrend = Math.max(1, ...report.trend.map(point => point.productiveMilliseconds));
  const maxActivity = Math.max(1, ...report.activities.map(item => item.productiveMilliseconds + item.personalMilliseconds));
  const maxWeekday = Math.max(1, ...report.patterns.weekdayAverages.map(item => item.milliseconds));
  const maxTimeOfDay = Math.max(1, ...report.patterns.timeOfDay.map(item => item.milliseconds));
  const currentPeriodPartial = report.range.endDay === todayKey;
  const comparison = report.previousProductiveMilliseconds > 0
    ? (report.comparison.differenceMilliseconds >= 0 ? '+' : '−') + formatTime(Math.abs(report.comparison.differenceMilliseconds))
      + ' (' + Math.abs(report.comparison.percentChange ?? 0).toFixed(1) + '%) vs. previous ' + report.dayCount + ' days'
    : report.summary.productiveMilliseconds > 0 ? 'No recorded productive time in the previous equal-length period' : 'No recorded productive time in either period';
  const completedMinutes = report.activities.reduce((sum, item) => sum + item.productiveMilliseconds + item.personalMilliseconds, 0);

  function applyCustomRange() {
    try {
      if (!customStart || !customEnd || customEnd > todayKey) throw new Error('Choose valid dates up to today.');
      const next = { startDay: customStart, endDay: customEnd };
      insightsDayKeys(next);
      setCustomRange(next);
      setCustomError('');
      setSelectedTrend(null);
    } catch (error) {
      setCustomError(error instanceof Error ? error.message : 'Choose a valid date range.');
    }
  }

  return <div className="space-y-5" aria-label="Productivity insights">
    <section className="panel p-5 sm:p-6" aria-labelledby="insights-range-title">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow">PRODUCTIVITY INSIGHTS</p><h2 id="insights-range-title" className="mt-1 text-xl font-bold sm:text-2xl">Explore your time</h2><p className="mt-1 text-sm text-slate-400">Recorded activity from your account, grouped by local calendar day.</p></div><p className="text-sm text-slate-300">{dayLabel(report.range.startDay)} – {dayLabel(report.range.endDay)}</p></div>
      <div role="group" aria-label="Date range" className="mt-5 flex flex-wrap gap-2">{([7, 30, 90] as const).map(days => <button key={days} type="button" aria-pressed={preset === days} onClick={() => { setPreset(days); setSelectedTrend(null); }} className={'rounded-xl border px-4 py-2.5 text-sm font-semibold ' + (preset === days ? 'border-cyan-300/50 bg-cyan-300/15 text-cyan-100' : 'border-white/10 bg-white/[.035] text-slate-300')}>Last {days} days</button>)}<button type="button" aria-pressed={preset === 'custom'} onClick={() => { setPreset('custom'); setCustomStart(customRange?.startDay ?? range.startDay); setCustomEnd(customRange?.endDay ?? range.endDay); }} className={'rounded-xl border px-4 py-2.5 text-sm font-semibold ' + (preset === 'custom' ? 'border-cyan-300/50 bg-cyan-300/15 text-cyan-100' : 'border-white/10 bg-white/[.035] text-slate-300')}>Custom range</button></div>
      {preset === 'custom' && <div className="mt-4 flex flex-wrap items-end gap-3"><label className="min-w-[140px] flex-1 text-xs text-slate-400">From<input type="date" value={customStart} max={todayKey} onChange={event => setCustomStart(event.target.value)} className="mt-2 block w-full rounded-xl border border-white/10 bg-[#151e26] px-3 py-3 text-base text-white"/></label><label className="min-w-[140px] flex-1 text-xs text-slate-400">Through<input type="date" value={customEnd} max={todayKey} onChange={event => setCustomEnd(event.target.value)} className="mt-2 block w-full rounded-xl border border-white/10 bg-[#151e26] px-3 py-3 text-base text-white"/></label><button type="button" onClick={applyCustomRange} className="rounded-xl bg-[#35c9f4] px-5 py-3 text-sm font-bold text-[#0d1117]">Apply range</button></div>}
      {customError && <p role="alert" className="mt-2 text-sm text-amber-200">{customError}</p>}
    </section>

    <section aria-label="Insights overview" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <AnalyticsMetric label="Tracked activity" value={formatTime(report.summary.trackedMilliseconds)} note="Active time + breaks; travel separate · h:mm" tone="cyan"/>
      <AnalyticsMetric label="Productive time" value={formatTime(report.summary.productiveMilliseconds)} note="Pauses and breaks excluded · h:mm" tone="emerald"/>
      <AnalyticsMetric label="Leisure / personal" value={formatTime(report.summary.personalMilliseconds)} note="Classified active time · h:mm" tone="violet"/>
      <AnalyticsMetric label="Completed sessions" value={String(report.summary.completedSessions)} note="Counted on local completion date" tone="violet"/>
      <AnalyticsMetric label="Daily average" value={formatTime(report.summary.averageDailyProductiveMilliseconds)} note={currentPeriodPartial ? 'Calendar days, including today · h:mm' : 'All calendar days in range · h:mm'} tone="amber"/>
    </section>

    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,.8fr)]">
      <section className="panel min-w-0 p-5 sm:p-6" aria-labelledby="insights-trend-title"><p className="eyebrow">PRODUCTIVE TIME</p><h2 id="insights-trend-title" className="mt-1 text-xl font-bold sm:text-2xl">Time trend</h2><p className="mt-1 text-sm text-slate-400">{report.trend.length === report.dayCount ? 'Daily totals' : 'Seven-day groups'} · {comparison}</p>
        {report.summary.productiveMilliseconds > 0 ? <><div className="mt-6 overflow-x-auto pb-2"><div className={'flex h-44 items-end gap-1.5 border-b border-white/10 ' + (report.trend.length > 14 ? 'min-w-[620px]' : 'min-w-[320px]')}>{report.trend.map((point, index) => <button key={point.startDay} type="button" aria-pressed={selectedTrend === index} aria-label={fullDayLabel(point.startDay) + (point.endDay !== point.startDay ? ' through ' + fullDayLabel(point.endDay) : '') + ': ' + formatTime(point.productiveMilliseconds) + ' productive'} title={formatTime(point.productiveMilliseconds) + ' productive'} onClick={() => setSelectedTrend(index)} className="group flex h-full min-w-0 flex-1 items-end focus-visible:outline-offset-0"><span className="block w-full rounded-t-md bg-gradient-to-t from-[#1577a0] to-[#42d9a2] group-hover:to-[#8ce8c2]" style={{ height: (point.productiveMilliseconds ? Math.max(3, point.productiveMilliseconds / maxTrend * 100) : 0) + '%' }}/></button>)}</div><div className={'mt-2 flex gap-1.5 text-center text-[10px] text-slate-400 ' + (report.trend.length > 14 ? 'min-w-[620px]' : 'min-w-[320px]')}>{report.trend.map((point, index) => <span key={point.startDay} className="min-w-0 flex-1 truncate">{report.trend.length <= 14 || index % 5 === 0 ? dayLabel(point.startDay) : ''}</span>)}</div></div>{selectedTrend !== null && report.trend[selectedTrend] && <p role="status" className="mt-3 text-sm text-cyan-100">{fullDayLabel(report.trend[selectedTrend].startDay)}{report.trend[selectedTrend].endDay !== report.trend[selectedTrend].startDay ? ' – ' + fullDayLabel(report.trend[selectedTrend].endDay) : ''}: {formatTime(report.trend[selectedTrend].productiveMilliseconds)} productive</p>}</> : <ChartEmpty>No productive activity recorded in this range.</ChartEmpty>}
        <p className="mt-4 text-xs text-slate-400">Duration-only entries count on their saved date. {currentPeriodPartial ? 'Today is still in progress; the previous period is complete.' : 'The comparison uses the preceding equal-length period.'}</p>
      </section>
      <section className="panel min-w-0 p-5 sm:p-6" aria-labelledby="insights-distribution-title"><p className="eyebrow">TIME DISTRIBUTION</p><h2 id="insights-distribution-title" className="mt-1 text-xl font-bold sm:text-2xl">Where time went</h2><p className="mt-1 text-sm text-slate-400">Shares of all recorded active time in this range.</p>{completedMinutes > 0 ? <><div aria-label="Activity distribution" className="mt-6 flex h-4 overflow-hidden rounded-full bg-[#34404a]">{report.activities.map(item => <div key={item.key} title={item.name + ': ' + Math.round(item.share * 100) + '%'} style={{ width: item.share * 100 + '%', backgroundColor: activityForName(state, item.name).color }}/>)}</div><div className="mt-5 space-y-3">{report.activities.slice(0, 5).map(item => <div key={item.key} className="flex items-center justify-between gap-3 text-sm"><span className="min-w-0 truncate"><i className="mr-2 inline-block size-2.5 rounded-full" style={{ backgroundColor: activityForName(state, item.name).color }}/>{item.name}</span><span className="shrink-0 font-mono text-slate-300">{Math.round(item.share * 100)}%</span></div>)}</div></> : <ChartEmpty>No activity to distribute yet.</ChartEmpty>}</section>
    </div>

    <section className="panel min-w-0 p-5 sm:p-6" aria-labelledby="insights-activities-title"><p className="eyebrow">ACTIVITY COMPARISON</p><h2 id="insights-activities-title" className="mt-1 text-xl font-bold sm:text-2xl">Activity breakdown</h2><p className="mt-1 text-sm text-slate-400">Activities follow saved session names. Editing a session name changes its group.</p>
      {report.activities.length ? <div className="mt-5 space-y-4">{report.activities.map(item => { const color = activityForName(state, item.name).color; return <div key={item.key} className="rounded-xl border border-white/8 bg-white/[.025] p-4"><div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="min-w-0 break-words font-semibold"><span className="mr-2 inline-block size-2.5 rounded-full" style={{ backgroundColor: color }}/>{item.name}</h3><strong className="font-mono text-cyan-100">{formatTime(item.productiveMilliseconds + item.personalMilliseconds)}</strong></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-[#34404a]"><div className="h-full rounded-full" style={{ width: (item.productiveMilliseconds + item.personalMilliseconds) / maxActivity * 100 + '%', backgroundColor: color }}/></div><p className="mt-2 text-xs text-slate-400">{Math.round(item.share * 100)}% of active time · {formatTime(item.productiveMilliseconds)} productive · {formatTime(item.personalMilliseconds)} personal · {item.completedSessions} completed session{item.completedSessions === 1 ? '' : 's'} · {formatTime(item.averageCompletedSessionMilliseconds)} average completed session</p></div>; })}</div> : <ChartEmpty>Track or log an activity to see comparisons.</ChartEmpty>}
    </section>

    <div className="grid min-w-0 gap-5 xl:grid-cols-2">
      <section className="panel min-w-0 p-5 sm:p-6" aria-labelledby="insights-habits-title"><p className="eyebrow">HABIT CONSISTENCY</p><h2 id="insights-habits-title" className="mt-1 text-xl font-bold sm:text-2xl">Recorded habit activity</h2><p className="mt-1 text-sm text-slate-400">Current goals have no change history. Past squares show recorded time, not historical goal completion.</p>
        {report.habits.length ? <div className="mt-5 space-y-5">{report.habits.map(item => <div key={item.habit.id} className="rounded-xl border border-white/8 bg-white/[.025] p-4"><div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-semibold">{item.habit.name}</h3><span className="text-xs text-slate-400">{item.recordedDays} of {item.eligibleDays} days recorded</span></div><p className="mt-1 text-xs text-slate-400">{formatTime(item.totalMilliseconds)} recorded in range · current daily goal {item.habit.goalMinutes} min</p><div className="mt-3 flex flex-wrap gap-1" aria-label={item.habit.name + ' daily activity'}>{item.days.map(day => <span key={day.dayKey} role="img" aria-label={fullDayLabel(day.dayKey) + ': ' + formatTime(day.milliseconds) + ' recorded' + (day.state === 'current-goal-met' ? ', current goal met' : '')} title={fullDayLabel(day.dayKey) + ': ' + formatTime(day.milliseconds)} className={'size-3 rounded-[3px] border ' + (day.state === 'current-goal-met' ? 'border-emerald-300 bg-emerald-300' : day.state === 'recorded' ? 'border-cyan-400/70 bg-cyan-400/70' : 'border-white/10 bg-[#34404a]')}/>)}</div>{item.todayGoalReached !== null && <p className="mt-3 text-xs text-slate-300">Today: {formatTime(item.todayMilliseconds ?? 0)} / {item.habit.goalMinutes} min · {item.todayGoalReached ? 'current goal met' : 'in progress'}</p>}</div>)}</div> : <ChartEmpty>Create a time-based habit to see its recorded activity here.</ChartEmpty>}
      </section>
      <section className="panel min-w-0 p-5 sm:p-6" aria-labelledby="insights-patterns-title"><p className="eyebrow">PRODUCTIVITY PATTERNS</p><h2 id="insights-patterns-title" className="mt-1 text-xl font-bold sm:text-2xl">When you track</h2><p className="mt-1 text-sm text-slate-400">Timed productive intervals only; untimed entries have no clock placement.</p>
        {report.summary.productiveMilliseconds > report.days.reduce((sum, day) => sum + day.untimedMilliseconds, 0) ? <><h3 className="mt-6 text-sm font-semibold">Average by weekday</h3><div className="mt-3 grid grid-cols-7 gap-1.5">{report.patterns.weekdayAverages.map(item => <div key={item.weekday} className="min-w-0 text-center"><div className="flex h-20 items-end rounded-md bg-white/[.035]"><div className="w-full rounded-t-md bg-[#35c9f4]" style={{ height: item.milliseconds ? Math.max(4, item.milliseconds / maxWeekday * 100) + '%' : 0 }}/></div><p className="mt-1 text-[10px] text-slate-400">{weekdayNames[item.weekday].slice(0, 2)}</p><p className="truncate text-[10px] text-slate-300" title={formatTime(item.milliseconds)}>{formatTime(item.milliseconds)}</p></div>)}</div><h3 className="mt-6 text-sm font-semibold">Time of day</h3><div className="mt-3 space-y-3">{report.patterns.timeOfDay.map((item, index) => <div key={item.label} className="grid grid-cols-[70px_minmax(0,1fr)_55px] items-center gap-2 text-xs"><span className="text-slate-300">{item.label}</span><div className="h-2 rounded-full bg-[#34404a]"><div className="h-full rounded-full" style={{ width: item.milliseconds / maxTimeOfDay * 100 + '%', backgroundColor: patternColors[index] }}/></div><span className="text-right font-mono text-slate-300">{formatTime(item.milliseconds)}</span></div>)}</div></> : <ChartEmpty>Time-of-day patterns need timestamped sessions.</ChartEmpty>}
        <p className="mt-5 text-xs text-slate-400">Weekday averages include zero-activity calendar days in the selected range.</p>
      </section>
    </div>

    <div className="grid min-w-0 gap-5 xl:grid-cols-2">
      <section className="panel p-5 sm:p-6" aria-labelledby="insights-sessions-title"><p className="eyebrow">SESSION LENGTH</p><h2 id="insights-sessions-title" className="mt-1 text-xl font-bold">Completed sessions</h2><div className="mt-5 grid grid-cols-2 gap-3"><div className="summary-tile"><p className="text-xs text-slate-400">Average active</p><p className="mt-2 text-2xl font-bold">{formatTime(report.patterns.averageCompletedSessionMilliseconds)}</p></div><div className="summary-tile summary-tile--violet"><p className="text-xs text-slate-400">Longest active</p><p className="mt-2 text-2xl font-bold">{formatTime(report.patterns.longestCompletedSessionMilliseconds)}</p></div></div><div className="mt-4 grid grid-cols-4 gap-2 text-center">{report.patterns.sessionLengthCounts.map(item => <div key={item.label} className="rounded-lg bg-white/[.035] p-2"><p className="text-lg font-bold">{item.count}</p><p className="text-[10px] text-slate-400">{item.label}</p></div>)}</div><p className="mt-4 text-xs text-slate-400">Sessions count on their local completion date. Length uses each completed session’s active time, even if it began before this range.</p></section>
      <section className="panel p-5 sm:p-6" aria-labelledby="insights-breaks-title"><p className="eyebrow">RECORDED BREAKS</p><h2 id="insights-breaks-title" className="mt-1 text-xl font-bold">Break patterns</h2><div className="mt-5 grid grid-cols-2 gap-3"><div className="summary-tile summary-tile--violet"><p className="text-xs text-slate-400">Break time in range</p><p className="mt-2 text-2xl font-bold">{formatTime(report.summary.breakMilliseconds)}</p></div><div className="summary-tile"><p className="text-xs text-slate-400">Average recorded break</p><p className="mt-2 text-2xl font-bold">{formatTime(report.patterns.averageRecordedBreakMilliseconds)}</p></div></div><p className="mt-4 text-sm text-slate-300">{report.patterns.recordedBreakCount} recorded break interval{report.patterns.recordedBreakCount === 1 ? '' : 's'} · {formatTime(report.summary.productiveMilliseconds)} productive time</p><p className="mt-2 text-xs text-slate-400">Only explicitly recorded breaks appear. Overlapping clock time is counted once in totals.</p></section>
    </div>

    <section className="panel p-5 sm:p-6" aria-labelledby="insights-observations-title"><p className="eyebrow">DATA-BASED OBSERVATIONS</p><h2 id="insights-observations-title" className="mt-1 text-xl font-bold sm:text-2xl">What the records show</h2><p className="mt-1 text-xs text-slate-400">{dayLabel(report.range.startDay)} – {dayLabel(report.range.endDay)} · descriptive patterns, not predictions</p>{report.observations.length ? <ul className="mt-5 grid gap-3 md:grid-cols-2">{report.observations.map(value => <li key={value} className="rounded-xl border border-white/8 bg-white/[.035] p-4 text-sm text-slate-200">{value}</li>)}</ul> : <ChartEmpty>More recorded activity is needed for a reliable observation in this range.</ChartEmpty>}</section>
  </div>;
}
