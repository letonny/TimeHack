import { activityKey } from './habits.ts';
import type { Activity, Session, TimerState } from './timer.ts';

export const ACTIVITY_ICONS = ['book', 'laptop', 'dumbbell', 'cooking', 'book-open', 'moon', 'circle'] as const;
export const ACTIVITY_COLORS = ['#2dd4bf', '#a78bfa', '#38bdf8', '#fb923c', '#4ade80', '#818cf8', '#94a3b8'] as const;

const defaults: Record<string, Omit<Activity, 'id' | 'name'>> = {
  studying: { icon: 'book', color: '#2dd4bf' }, study: { icon: 'book', color: '#2dd4bf' },
  coding: { icon: 'laptop', color: '#a78bfa' }, gym: { icon: 'dumbbell', color: '#38bdf8' },
  cooking: { icon: 'cooking', color: '#fb923c' }, reading: { icon: 'book-open', color: '#4ade80' },
  sleep: { icon: 'moon', color: '#818cf8' }, other: { icon: 'circle', color: '#94a3b8' },
};

export const iconGlyph = (icon: string) => ({ book: '▤', laptop: '⌨', dumbbell: '◆', cooking: '♨', 'book-open': '▥', moon: '☾', circle: '●' })[icon] ?? '●';

function fallback(name: string) {
  const key = activityKey(name);
  const known = defaults[key];
  if (known) return known;
  let hash = 0;
  for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return { icon: 'circle', color: ACTIVITY_COLORS[hash % ACTIVITY_COLORS.length] };
}

export function activityForSession(state: TimerState, session: Session): Activity {
  const stored = session.activityId ? state.activities.find(activity => activity.id === session.activityId) : undefined;
  if (stored) return stored;
  const byName = state.activities.find(activity => activityKey(activity.name) === activityKey(session.name));
  return byName ?? { id: '', name: session.name, ...fallback(session.name) };
}

export function activityForName(state: TimerState, name: string): Activity {
  return state.activities.find(activity => activityKey(activity.name) === activityKey(name)) ?? { id: '', name, ...fallback(name) };
}

export function saveActivity(state: TimerState, activity: Activity): TimerState {
  const name = activity.name.trim();
  if (!activity.id || !name || name.length > 120) throw new Error('Use an activity name between 1 and 120 characters.');
  if (!ACTIVITY_ICONS.includes(activity.icon as typeof ACTIVITY_ICONS[number])) throw new Error('Choose a supported activity icon.');
  if (!ACTIVITY_COLORS.includes(activity.color as typeof ACTIVITY_COLORS[number])) throw new Error('Choose a supported activity color.');
  if (state.activities.some(item => item.id !== activity.id && activityKey(item.name) === activityKey(name))) throw new Error('An activity with this name already exists.');
  const next = { ...activity, name };
  return { ...state, activities: state.activities.some(item => item.id === activity.id) ? state.activities.map(item => item.id === activity.id ? next : item) : [...state.activities, next] };
}

export function recentActivityNames(state: TimerState, limit = 6): string[] {
  const names = new Map<string, string>();
  for (const session of state.completed) {
    const key = activityKey(session.name);
    if (!names.has(key)) names.set(key, session.name);
    if (names.size === limit) break;
  }
  return [...names.values()];
}
