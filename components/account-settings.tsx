'use client';

import { useState } from 'react';
import { ACTIVITY_COLORS, ACTIVITY_ICONS, iconGlyph } from '@/lib/activity-metadata';
import type { Activity, Profile } from '@/lib/timer';

export function AccountSettings({ profile, activities, ready, onSaveProfile, onSaveActivity, onDeleteActivity }: {
  profile: Profile; activities: Activity[]; ready: boolean;
  onSaveProfile: (profile: Profile) => boolean; onSaveActivity: (activity: Activity) => boolean; onDeleteActivity: (id: string) => boolean;
}) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string>('circle');
  const [color, setColor] = useState<string>('#2dd4bf');
  const reset = () => { setEditing(null); setName(''); setIcon('circle'); setColor('#2dd4bf'); };
  return <details className="mx-auto mb-7 max-w-3xl rounded-xl border border-white/8 bg-white/[.025] px-4 py-3 text-sm">
    <summary className="cursor-pointer text-slate-300">Account & activity settings</summary>
    <div className="mt-5 grid gap-7 border-t border-white/8 pt-5 sm:grid-cols-2">
      <form onSubmit={event => { event.preventDefault(); if (onSaveProfile({ displayName })) setDisplayName(displayName.trim()); }}><h2 className="font-medium">Display name</h2><p className="mt-1 text-xs text-slate-500">Optional. Used only in your dashboard greeting.</p><input maxLength={80} value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="Your preferred name" className="mt-3 w-full rounded-xl border border-white/10 bg-[#0b1424] p-3"/><button disabled={!ready} className="mt-3 rounded-lg bg-white/10 px-3 py-2 text-xs text-teal-200">Save name</button></form>
      <div><h2 className="font-medium">Custom activities</h2><p className="mt-1 text-xs text-slate-500">Reuse an icon and color everywhere this activity appears.</p><form className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); if (onSaveActivity({ id: editing ?? crypto.randomUUID(), name, icon, color })) reset(); }}><input required maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder="Activity name" className="w-full rounded-xl border border-white/10 bg-[#0b1424] p-3"/><div className="flex gap-2"><label className="min-w-0 flex-1 text-xs text-slate-400">Icon<select value={icon} onChange={event => setIcon(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#0b1424] p-2 text-white">{ACTIVITY_ICONS.map(value => <option key={value} value={value}>{iconGlyph(value)} {value}</option>)}</select></label><label className="min-w-0 flex-1 text-xs text-slate-400">Color<select value={color} onChange={event => setColor(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#0b1424] p-2 text-white">{ACTIVITY_COLORS.map(value => <option key={value} value={value}>{value}</option>)}</select></label></div><div className="flex gap-2"><button disabled={!ready} className="rounded-lg bg-teal-300 px-3 py-2 text-xs font-medium text-slate-950">{editing ? 'Update' : 'Add activity'}</button>{editing && <button type="button" onClick={reset} className="px-3 py-2 text-xs text-slate-400">Cancel</button>}</div></form></div>
    </div>
    {!!activities.length && <ul className="mt-5 grid gap-2 border-t border-white/8 pt-5 sm:grid-cols-2">{activities.map(activity => <li key={activity.id} className="flex items-center gap-3 rounded-lg bg-white/[.025] p-3"><span aria-hidden="true" className="flex size-8 items-center justify-center rounded-lg text-slate-950" style={{ backgroundColor: activity.color }}>{iconGlyph(activity.icon)}</span><span className="min-w-0 flex-1 truncate">{activity.name}</span><button type="button" onClick={() => { setEditing(activity.id); setName(activity.name); setIcon(activity.icon); setColor(activity.color); }} className="text-xs text-teal-200">Edit</button><button type="button" onClick={() => { if (window.confirm(`Delete activity “${activity.name}”? Existing sessions will keep their names.`)) onDeleteActivity(activity.id); }} className="text-xs text-slate-500">Delete</button></li>)}</ul>}
  </details>;
}
