// AI 助手独立页（docs/05-modules/ai.md）—— 网页式 AI 对话样式
// 侧边栏入口（排在「纪念」之后）。未接入的能力在输入框上方以 chips 提示，点击给说明气泡（诚实占位）。

import { Sparkles } from 'lucide-react';
import { AiChat } from '@/components/AiChat';
import { useI18n } from '@/i18n';
import '@/styles/ai.css';

export function AiPage() {
  const { t } = useI18n();
  return (
    <div className="content ai-page ai-page--chat">
      <div className="ai-page-head">
        <Sparkles size={20} style={{ color: 'var(--accent-blue)' }} aria-hidden />
        <h1 className="page-title">{t('ai.pageTitle')}</h1>
      </div>
      <AiChat />
    </div>
  );
}