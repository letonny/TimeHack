import type { Session, TimerState } from './timer.ts';

export function replaceCompletedSession(state: TimerState, session: Session): TimerState {
  if (state.active?.id === session.id) throw new Error('An active session cannot be edited here.');
  if (!state.completed.some(item => item.id === session.id)) throw new Error('Completed session not found.');
  return { ...state, completed: state.completed.map(item => item.id === session.id ? session : item) };
}

export function removeCompletedSession(state: TimerState, id: string): TimerState {
  if (state.active?.id === id) throw new Error('An active session cannot be deleted here.');
  if (!state.completed.some(item => item.id === id)) return state;
  return { ...state, completed: state.completed.filter(item => item.id !== id) };
}
