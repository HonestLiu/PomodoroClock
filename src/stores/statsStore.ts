// 统计状态：全部指标由 SQL/索引实时聚合，不做缓存（PRD §8.8-3）。

import { create } from 'zustand';
import { api, on } from '@/api';
import type { Goal, Stats } from '@/types';
import { DEFAULT_SETTINGS } from '@/types';

interface StatsState {
  stats: Stats | null;
  goal: Goal;
  revision: number;
  refresh(): Promise<void>;
  setGoal(minutes: number): Promise<void>;
}

let subscribed = false;

export const useStatsStore = create<StatsState>((set, get) => ({
  stats: null,
  goal: { id: 'default', daily_target_min: DEFAULT_SETTINGS.daily_target_min },
  revision: 0,

  async refresh() {
    if (!subscribed) {
      subscribed = true;
      on('data://changed', () => { void get().refresh(); });
    }
    const [stats, goal] = await Promise.all([api.get_stats(), api.get_goal()]);
    set((s) => ({ stats, goal, revision: s.revision + 1 }));
  },

  async setGoal(minutes) {
    const goal = await api.set_goal(minutes);
    await get().refresh();
    set({ goal });
  },
}));
