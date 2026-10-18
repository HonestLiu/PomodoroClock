// 白噪音选择弹窗 —— 点计时页工具条「白噪音」或设置→外观的「白噪音」直接弹出。
// 结构对齐产品设计稿：标题 / 音量滑杆 / 音色列表（圆形封面 + 选中勾）/ 取消·确定。
// 封面取自音频文件内嵌封面（见 lib/noise.ts 的 NOISE_COVERS）。
// 交互：点某一项即刻试听（用户手势内启停，规避自动播放限制），「取消」回滚试听，
// 「确定」才写入设置（noise + noise_volume），避免误点就改了配置。

import { useEffect, useRef, useState } from 'react';
import { Check, VolumeX } from 'lucide-react';
import { NOISE_COVERS, NOISE_KINDS, NOISE_LABELS, type NoiseKind } from '@/lib/noise';
import { useNoiseStore, type NoisePick, type NoiseSnapshot } from '@/stores/noiseStore';
import { useUiStore } from '@/stores/uiStore';
import { useTimerStore } from '@/stores/timerStore';
import { api } from '@/api';
import { useI18n } from '@/i18n';
import { useModalA11y } from './useModalA11y';

export function NoisePicker() {
  const open = useUiStore((s) => s.noiseOpen);
  const setOpen = useUiStore((s) => s.openNoise);
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);

  // 草稿态：弹窗内先改草稿，确定才提交
  const [pick, setPick] = useState<NoisePick>('none');
  const [volume, setVolume] = useState(0.5);
  const snapshot = useRef<NoiseSnapshot>({ kind: 'waves', volume: 0.5, playing: false });

  const close = () => setOpen(false);
  const cancel = () => {
    useNoiseStore.getState().restore(snapshot.current);
    close();
  };

  useModalA11y(open, cancel, rootRef, '.noise-item.sel, .noise-item');

  // 每次打开都把草稿对齐到当前真实状态（用户可能刚在别处改过）
  useEffect(() => {
    if (!open) return;
    const s = useNoiseStore.getState();
    snapshot.current = { kind: s.kind, volume: s.volume, playing: s.playing };
    setPick(s.playing ? s.kind : 'none');
    setVolume(s.volume);
  }, [open]);

  if (!open) return null;

  /** 点选音色 = 立即试听（'none' 则停下） */
  function audition(next: NoisePick) {
    setPick(next);
    useNoiseStore.getState().select(next);
  }

  function onVolume(v: number) {
    setVolume(v);
    useNoiseStore.getState().setVolume(v);
    // 拖动音量但还没选音色时，顺手试听当前高亮项，让「调音量」有反馈
    if (pick === 'none') {
      const s = useNoiseStore.getState();
      useNoiseStore.getState().select(s.kind);
      setPick(s.kind);
    }
  }

  async function confirm() {
    const store = useNoiseStore.getState();
    store.select(pick);
    close();
    // 持久化：先写音量（弹窗里始终可能调过），再写音色（选「无」时不覆盖已存音色）
    const savedVolume = await api.set_setting('noise_volume', String(volume));
    const saved = pick === 'none' ? savedVolume : await api.set_setting('noise', pick);
    useTimerStore.getState().setSettings(saved);
  }

  /** role=listbox 的键盘约定：上下键（及 Home/End）移动焦点，Enter/Space 由按钮自身触发 */
  function onListKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const btns = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('.noise-item'));
    if (!btns.length) return;
    const i = btns.findIndex((b) => b === document.activeElement);
    const next = e.key === 'Home' ? 0
      : e.key === 'End' ? btns.length - 1
        : e.key === 'ArrowDown' ? Math.min(btns.length - 1, i + 1)
          : Math.max(0, i - 1);
    btns[next]?.focus();
  }

  const items: Array<{ key: NoisePick; label: string }> = [
    { key: 'none', label: t('noise.none') },
    ...NOISE_KINDS.map((k) => ({ key: k as NoisePick, label: NOISE_LABELS[k] })),
  ];

  return (
    <div className="overlay noise-overlay" onClick={cancel}>
      <div
        ref={rootRef}
        className="modal noise-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('noise.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="noise-head">{t('noise.title')}</div>

        <div className="noise-volume">
          <span>{t('noise.volume')}</span>
          <input
            className="noise-slider"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            aria-label={t('noise.volume')}
            style={{ ['--noise-pct' as string]: `${Math.round(volume * 100)}%` } as React.CSSProperties}
            onChange={(e) => onVolume(Number(e.target.value))}
          />
        </div>

        <div
          className="noise-list"
          role="listbox"
          aria-label={t('noise.title')}
          onKeyDown={onListKey}
        >
          {items.map(({ key, label }) => {
            const sel = pick === key;
            return (
              <button
                key={key}
                type="button"
                role="option"
                aria-selected={sel}
                className={`noise-item${sel ? ' sel' : ''}`}
                onClick={() => audition(key)}
              >
                {key === 'none' ? (
                  <span className="noise-thumb none" aria-hidden="true">
                    <VolumeX size={17} />
                  </span>
                ) : (
                  <img className="noise-thumb" src={NOISE_COVERS[key as NoiseKind]} alt="" />
                )}
                <span className="noise-name">{label}</span>
                {sel && <Check className="noise-check" size={16} aria-hidden="true" />}
              </button>
            );
          })}
        </div>

        <div className="noise-foot">
          <button className="btn" onClick={cancel}>{t('common.cancel')}</button>
          <button className="btn primary" onClick={() => void confirm()}>{t('common.confirm')}</button>
        </div>
      </div>
    </div>
  );
}
