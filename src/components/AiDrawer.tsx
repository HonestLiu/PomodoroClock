// 右侧 AI 抽屉 —— 其他页面的「AI 入口」点开的侧边栏（docs/05-modules/ai.md）
// 复用 AiNlComposer：这里做快速 AI 操作；完整工作台在独立 AI 页。

import { useEffect } from 'react';
import { Sparkles, X } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { AiChat } from '@/components/AiChat';
import { useI18n } from '@/i18n';
import '@/styles/ai.css';

export function AiDrawer() {
  const { t } = useI18n();
  const open = useUiStore((s) => s.aiDrawerOpen);
  const setOpen = useUiStore((s) => s.openAiDrawer);
  const navigate = useUiStore((s) => s.navigate);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <>
      <div className="ai-drawer-backdrop" onClick={() => setOpen(false)} aria-hidden />
      <aside className="ai-drawer" role="dialog" aria-modal="true" aria-label={t('ai.drawerTitle')}>
        <div className="ai-drawer-head">
          <h2><Sparkles size={16} aria-hidden /> {t('ai.drawerTitle')}</h2>
          <div className="ai-drawer-actions">
            <button
              type="button" className="btn"
              onClick={() => { setOpen(false); navigate({ name: 'ai' }); }}
            >
              {t('ai.openPage')}
            </button>
            <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={() => setOpen(false)}>
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="ai-drawer-body">
          <AiChat compact hidePending />
        </div>
      </aside>
    </>
  );
}