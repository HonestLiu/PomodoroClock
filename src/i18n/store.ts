// i18n 状态：语言切换即时生效并持久化（settings.md ★1）。
// 语言存于 settings.language，词表由 t() 按需读取。

import { create } from 'zustand';
import { zh, type ZhKey } from './zh';
import { en } from './en';

export type Lang = 'zh' | 'en';
type Dict = Record<string, string>;

const DICTS: Record<Lang, Dict> = { zh: zh as Dict, en: en as Dict };

export function detectLang(): Lang {
  try {
    const n = (navigator.language || 'zh').toLowerCase();
    return n.startsWith('en') ? 'en' : 'zh';
  } catch { return 'zh'; }
}

interface I18nState {
  lang: Lang;
  dict: Dict;
  setLang(lang: Lang): void;
  t(key: ZhKey | string, vars?: Record<string, string | number>): string;
}

export const useI18nStore = create<I18nState>((set, get) => ({
  lang: detectLang(),
  dict: DICTS[detectLang()] ?? zh,

  setLang: (lang) => set({ lang, dict: DICTS[lang] ?? zh }),

  t: (key, vars) => {
    const raw = get().dict[String(key)] ?? (zh as Dict)[String(key)] ?? String(key);
    if (!vars) return raw;
    return raw.replace(/\{(\w+)\}/g, (_, k) => String((vars as Record<string, unknown>)[k] ?? `{${k}}`));
  },
}));

/** 返回 { t, lang }；随语言变化触发重渲染 */
export const useI18n = (): { t: I18nState['t']; lang: Lang; dict: Dict } => {
  // 订阅 dict 以保证语言切换时组件重渲染
  const dict = useI18nStore((s) => s.dict);
  const lang = useI18nStore((s) => s.lang);
  const t = useI18nStore((s) => s.t);
  return { t, lang, dict };
};

export const tStatic = (key: ZhKey | string, vars?: Record<string, string | number>): string =>
  useI18nStore.getState().t(key, vars);
