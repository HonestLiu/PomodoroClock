// 倒数纪念日状态（doc 05-modules/countdown.md）
// 独立 store，数据经运行时抽象 api（红线：UI 不直连 db/*）。

import { create } from 'zustand';
import { api, on } from '@/api';
import type { Countdown } from '@/types';
import type { CreateCountdownArgs } from '@/api/types';

interface CountdownState {
  ready: boolean;
  items: Countdown[];
  revision: number;
  bootstrap(): Promise<void>;
  reload(): Promise<void>;
  create(args: CreateCountdownArgs): Promise<Countdown>;
  update(id: string, args: CreateCountdownArgs): Promise<Countdown>;
  remove(id: string): Promise<void>;
  reorder(ids: string[]): Promise<void>;
}

let subscribed = false;

export const useCountdownStore = create<CountdownState>((set, get) => ({
  ready: false,
  items: [],
  revision: 0,

  async bootstrap() {
    if (!subscribed) {
      subscribed = true;
      // 任意数据变更都刷新纪念日（与 dataStore 同一事件总线，口径一致）
      on('data://changed', () => { void get().reload(); });
    }
    await get().reload();
    set({ ready: true });
  },

  async reload() {
    const items = await api.list_countdowns();
    set((s) => ({ items, revision: s.revision + 1 }));
  },

  async create(args) {
    const c = await api.create_countdown(args);
    await get().reload();
    return c;
  },
  async update(id, args) {
    const c = await api.update_countdown(id, args);
    await get().reload();
    return c;
  },
  async remove(id) { await api.delete_countdown(id); await get().reload(); },
  async reorder(ids) { await api.reorder_countdowns(ids); await get().reload(); },
}));