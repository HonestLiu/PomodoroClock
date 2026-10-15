// 白噪音 —— PRD FR-P4。
// 播放本地打包的音频素材（src/assets/noise/*.mp3），循环播放、音量可调；
// 播放失败时优雅降级（§8.8-5）。

import wavesUrl from '@/assets/noise/waves.mp3';
import breezeUrl from '@/assets/noise/breeze.mp3';
import forestUrl from '@/assets/noise/forest.mp3';
import woodsUrl from '@/assets/noise/woods.mp3';
import cozyUrl from '@/assets/noise/cozy.mp3';

export type NoiseKind = 'waves' | 'rain' | 'wind' | 'woods' | 'cozy';

export const NOISE_LABELS: Record<NoiseKind, string> = {
  waves: '海浪',
  rain: '雨声',
  wind: '微风',
  woods: '树林',
  cozy: '温馨',
};

/** 每种白噪音对应的音频资源 */
const NOISE_AUDIO: Record<NoiseKind, string> = {
  waves: wavesUrl,
  rain: forestUrl,   // 雨打树冠
  wind: breezeUrl,
  woods: woodsUrl,
  cozy: cozyUrl,
};

let audio: HTMLAudioElement | null = null;

const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** 启动白噪音；播放失败（如浏览器阻止自动播放）时静默降级（返回 false） */
export function startNoise(kind: NoiseKind, volume: number): boolean {
  try {
    stopNoise();
    const url = NOISE_AUDIO[kind];
    if (!url) return false;
    const el = new Audio(url);
    el.loop = true;
    el.volume = clamp(volume);
    const p = el.play();
    if (p) {
      p.catch(() => {
        // 自动播放被阻止：清理资源
        el.pause();
        el.src = '';
        if (audio === el) audio = null;
      });
    }
    audio = el;
    return true;
  } catch {
    audio = null;
    return false;
  }
}

export function setNoiseVolume(volume: number): void {
  if (audio) audio.volume = clamp(volume);
}

export function stopNoise(): void {
  if (!audio) return;
  try {
    audio.pause();
    audio.src = '';
    audio.load();
  } catch { /* 已停止 */ }
  audio = null;
}

export const isNoisePlaying = () => audio !== null;