import type { Settings } from '@/types';

/** Keep the preference as 'system'; resolve only the rendered light/dark scheme. */
export function installTheme(preference: Settings['theme']): () => void {
  const mode = preference === 'light' || preference === 'dark' ? preference : 'system';
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const root = document.documentElement;
  const apply = () => {
    root.dataset.theme = mode === 'system' ? (media.matches ? 'dark' : 'light') : mode;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
    if (meta) meta.content = mode === 'system' ? 'light dark' : mode;
  };
  apply();
  // Paint-time cache only; database settings remain authoritative.
  try {
    if (mode === 'system') localStorage.removeItem('focus.theme');
    else localStorage.setItem('focus.theme', mode);
  } catch { /* Theme changes still work if browser storage is unavailable. */ }
  if (mode !== 'system') return () => {};
  media.addEventListener('change', apply);
  return () => media.removeEventListener('change', apply);
}
