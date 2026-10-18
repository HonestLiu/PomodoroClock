// 白噪音播放状态 —— 全局唯一真相源。
// 计时页工具条、设置页外观、白噪音选择弹窗三处共用同一份状态，
// 否则「弹窗里选了一个、工具条还显示旧的」这类不同步问题必然出现。

import { create } from 'zustand';
import { setNoiseVolume, startNoise, stopNoise, type NoiseKind } from '@/lib/noise';

/** 选择结果：具体音色，或「无」（= 不播放） */
export type NoisePick = NoiseKind | 'none';

export interface NoiseSnapshot {
  kind: NoiseKind;
  volume: number;
  playing: boolean;
}

interface NoiseState extends NoiseSnapshot {
  /** 选中并立即播放（'none' = 停止，但保留已存音色） */
  select(pick: NoisePick): void;
  /** 只调音量：正在播放时实时生效 */
  setVolume(volume: number): void;
  /** 显式开/关 */
  setPlaying(on: boolean): void;
  /** 启动时从设置回填（不触发播放） */
  hydrate(kind: NoiseKind, volume: number): void;
  /** 撤销一次试听（弹窗「取消」），回到打开前的播放状态 */
  restore(snap: NoiseSnapshot): void;
}

export const useNoiseStore = create<NoiseState>((set, get) => ({
  kind: 'waves',
  volume: 0.5,
  playing: false,

  select: (pick) => {
    if (pick === 'none') {
      stopNoise();
      set({ playing: false });
      return;
    }
    // 在用户手势内直接启停，规避 WebView 的自动播放限制
    const ok = startNoise(pick, get().volume);
    set({ kind: pick, playing: ok });
  },

  setVolume: (volume) => {
    setNoiseVolume(volume);
    set({ volume });
  },

  setPlaying: (on) => {
    if (!on) {
      stopNoise();
      set({ playing: false });
      return;
    }
    const ok = startNoise(get().kind, get().volume);
    set({ playing: ok });
  },

  hydrate: (kind, volume) => set({ kind, volume }),

  restore: (snap) => {
    if (snap.playing) startNoise(snap.kind, snap.volume);
    else stopNoise();
    set({ ...snap });
  },
}));
