'use client';

import { useState } from 'react';
import { formatDurationMilliseconds, summarizeSession, type Session } from '@/lib/timer';
import { validateIntervalCorrection, type IntervalCorrection } from '@/lib/session-corrections';

const inputTime = (stamp: number) => {
  const date = new Date(stamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${date.getMilliseconds() ? `.${String(date.getMilliseconds()).padStart(3, '0')}` : ''}`;
};
const parseInput = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  const stamp = new Date(value).getTime();
  const date = new Date(stamp);
  if (!match || !Number.isSafeInteger(stamp) || date.getFullYear() !== Number(match[1]) || date.getMonth() + 1 !== Number(match[2])
    || date.getDate() !== Number(match[3]) || date.getHours() !== Number(match[4]) || date.getMinutes() !== Number(match[5])
    || date.getSeconds() !== Number(match[6] ?? 0) || date.getMilliseconds() !== Number((match[7] ?? '').padEnd(3, '0') || 0))
    throw new Error('Choose a valid date and time.');
  return stamp;
};
type DraftPart = { start: string; end: string };

export function IntervalEditor({ session, revisions, onCorrect, now }: {
  session: Session; revisions: Record<string, number>; now: number; onCorrect: (sessionId: string, correction: IntervalCorrection) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [segments, setSegments] = useState<DraftPart[]>(() => session.segments.map(part => ({ start: inputTime(part.startedAt), end: inputTime(part.endedAt!) })));
  const [sets, setSets] = useState<DraftPart[][]>(() => (session.sets ?? []).map(item => item.segments.map(part => ({ start: inputTime(part.startedAt), end: inputTime(part.endedAt!) }))));
  const makeCorrection = (): IntervalCorrection => ({
    segments: segments.map((part, index) => ({ kind: session.segments[index].kind,
      startedAt: part.start === inputTime(session.segments[index].startedAt) ? session.segments[index].startedAt : parseInput(part.start),
      endedAt: part.end === inputTime(session.segments[index].endedAt!) ? session.segments[index].endedAt! : parseInput(part.end) })),
    sets: (session.sets ?? []).map((item, index) => ({ id: item.id, expectedRevision: revisions[`set:${item.id}`] ?? 0,
      segments: sets[index].map((part, partIndex) => ({
        startedAt: part.start === inputTime(item.segments[partIndex].startedAt) ? item.segments[partIndex].startedAt : parseInput(part.start),
        endedAt: part.end === inputTime(item.segments[partIndex].endedAt!) ? item.segments[partIndex].endedAt! : parseInput(part.end),
      })) })),
  });
  let preview: Session | null = null;
  let validation = '';
  try { preview = validateIntervalCorrection(session, makeCorrection(), now); }
  catch (cause) { validation = cause instanceof Error ? cause.message : 'Invalid correction'; }
  const update = (kind: 'segment' | 'set', index: number, partIndex: number, field: 'start' | 'end', value: string) => {
    if (kind === 'segment') setSegments(current => current.map((part, i) => i === index ? { ...part, [field]: value } : part));
    else setSets(current => current.map((group, i) => i === index ? group.map((part, j) => j === partIndex ? { ...part, [field]: value } : part) : group));
  };
  const fields = (part: DraftPart, kind: 'segment' | 'set', index: number, partIndex: number) => <div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-xs text-slate-400">Start<input type="datetime-local" step="0.001" value={part.start} onChange={event => update(kind, index, partIndex, 'start', event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#151e26] p-2 text-sm text-white"/></label><label className="text-xs text-slate-400">End<input type="datetime-local" step="0.001" value={part.end} onChange={event => update(kind, index, partIndex, 'end', event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#151e26] p-2 text-sm text-white"/></label></div>;
  return <div className="mt-3"><button type="button" onClick={() => setOpen(value => !value)} className="rounded-lg border border-cyan-300/20 px-3 py-2 text-xs text-cyan-200">Edit Time</button>{open && <div className="mt-3 rounded-xl border border-white/10 bg-[#111b26] p-4"><p className="text-xs text-slate-400">Online correction · requires all account changes to finish syncing. Changing the first or last interval also changes the session boundary. Adjust adjacent intervals and SETs explicitly.</p>
    <div className="mt-4 space-y-3">{segments.map((part, index) => <div key={index} className="rounded-lg border border-white/8 p-3"><p className="text-sm font-medium">{session.segments[index].kind === 'study' ? session.name : session.segments[index].kind === 'break' ? 'Break' : session.segments[index].kind === 'travel_out' ? 'Outbound travel' : 'Return travel'} #{index + 1}</p>{fields(part, 'segment', index, 0)}<p className="mt-1 text-xs text-slate-400">{!Number.isNaN(new Date(part.end).getTime() - new Date(part.start).getTime()) ? formatDurationMilliseconds(Math.max(0, new Date(part.end).getTime() - new Date(part.start).getTime())) : 'Invalid time'}</p></div>)}</div>
    {!!sets.length && <div className="mt-5"><h4 className="text-sm font-semibold text-teal-200">Nested SET intervals</h4>{sets.map((group, index) => <div key={session.sets![index].id} className="mt-3 rounded-lg border border-teal-300/15 p-3"><p className="text-sm">{session.sets![index].description}</p>{group.map((part, partIndex) => <div key={partIndex}>{fields(part, 'set', index, partIndex)}<p className="mt-1 text-xs text-slate-400">{!Number.isNaN(new Date(part.end).getTime() - new Date(part.start).getTime()) ? formatDurationMilliseconds(Math.max(0, new Date(part.end).getTime() - new Date(part.start).getTime())) : 'Invalid time'}</p></div>)}</div>)}</div>}
    {preview && <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-300 sm:grid-cols-4"><span>Activity: {formatDurationMilliseconds(summarizeSession(preview, now).studyMilliseconds)}</span><span>Productive: {formatDurationMilliseconds(summarizeSession(preview, now).productiveMilliseconds)}</span><span>Breaks: {formatDurationMilliseconds(summarizeSession(preview, now).breakMilliseconds)}</span><span>Travel: {formatDurationMilliseconds(summarizeSession(preview, now).travelMilliseconds)}</span></div>}
    {(validation || message) && <p role="alert" className="mt-3 text-xs text-amber-200">{validation || message}</p>}
    <div className="mt-4 flex gap-2"><button disabled={busy || !!validation} type="button" onClick={async () => { setBusy(true); const result = await onCorrect(session.id, makeCorrection()); setBusy(false); if (result) setMessage(result); else { setMessage('Correction saved.'); setOpen(false); } }} className="rounded-lg bg-cyan-300 px-3 py-2 text-xs font-semibold text-slate-950">{busy ? 'Saving…' : 'Save corrected times'}</button><button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-xs text-slate-400">Cancel</button></div>
  </div>}</div>;
}
