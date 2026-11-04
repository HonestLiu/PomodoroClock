import type { FloatStyle, Settings, TimerState } from '@/types';
import { displayMs } from '@/timer/engine';

export const FLOAT_STYLES: FloatStyle[] = ['card', 'orb', 'bar'];
export const normalizeFloatStyle = (style: unknown): FloatStyle => style === 'orb' || style === 'bar' ? style : 'card';
export const floatWindowSize = (style: FloatStyle): [number, number] => style === 'orb' ? [148, 168] : style === 'bar' ? [124, 44] : [216, 134];
export interface OrbSnapshot {
  style?: FloatStyle;
  wallpaper?: string;
  todayCount?: number;
  state: TimerState;
  settings: Pick<Settings, 'focus_len_min' | 'break_len_min' | 'long_break_len_min' | 'long_break_every'>;
  phaseDurationMs: number;
  now: number;
  title: string;
  theme: 'light' | 'dark';
  lang: 'zh' | 'en';
  settling: boolean;
}
export type OrbAction = 'toggle' | 'open' | 'hide';
export function orbTime(snapshot: OrbSnapshot, now: number): number {
  return displayMs(snapshot.state, now, snapshot.phaseDurationMs);
}
export function orbProgress(snapshot: OrbSnapshot, now: number): number {
  if (snapshot.state.phase === 'idle' || snapshot.state.mode === 'stopwatch') return 0;
  return Math.max(0, Math.min(1, 1 - orbTime(snapshot, now) / Math.max(1, snapshot.phaseDurationMs)));
}
