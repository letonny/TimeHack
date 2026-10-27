import { todaySummary, type Habit, type TimerState } from './timer.ts';
export const activityKey = (name: string) => name.trim().toLowerCase();
export function saveHabit(state: TimerState, habit: Habit): TimerState {
    if (!habit.id || !habit.name.trim() || habit.name.trim().length > 120 || !Number.isInteger(habit.goalMinutes) || habit.goalMinutes <= 0 || habit.goalMinutes > 1440)
        throw new Error('Use a name and a whole-minute goal between 1 and 1440.');
    if (state.habits.some(item => item.id !== habit.id && activityKey(item.name) === activityKey(habit.name)))
        throw new Error('A habit with this name already exists.');
    const next = { ...habit, name: habit.name.trim() };
    return { ...state, habits: state.habits.some(item => item.id === habit.id) ? state.habits.map(item => item.id === habit.id ? next : item) : [...state.habits, next] };
}
export function habitProgress(state: TimerState, habit: Habit, now: number) {
    const matches = (name: string) => activityKey(name) === activityKey(habit.name);
    const milliseconds = todaySummary({ ...state, completed: state.completed.filter(session => matches(session.name)), active: state.active && matches(state.active.name) ? state.active : null }, now).milliseconds;
    const minutes = milliseconds / 60000;
    return { minutes, remaining: Math.max(0, habit.goalMinutes - minutes), percentage: Math.min(100, minutes / habit.goalMinutes * 100) };
}
