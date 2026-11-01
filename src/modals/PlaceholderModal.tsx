// 顶栏会员与好友面板；会员与设置页共用购买/收款码配置。

import { useRef } from 'react';
import { X } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { useI18n } from '@/i18n';
import { useModalA11y } from '@/components/useModalA11y';
import { MembershipPanel } from '@/components/MembershipPanel';

export function PlaceholderModal() {
  const ui = useUiStore();
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const close = () => ui.closeAllOverlays();

  const spec = ui.premiumOpen
    ? { title: t('title.premium'), body: '' }
    : ui.friendsOpen
      ? { title: t('title.friends'), body: t('placeholder.friendsBody') }
      : null;

  useModalA11y(spec !== null, close, rootRef, '.icon-btn');

  if (!spec) return null;

  return (
    <div className="overlay" onClick={close}>
      <div
        className={`modal${ui.premiumOpen ? ' membership-modal' : ''}`} ref={rootRef}
        role="dialog" aria-modal="true" aria-labelledby="placeholder-title"
        style={ui.premiumOpen ? undefined : { width: 'min(440px, 92vw)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="placeholder-title">{spec.title}</h2>
          <button className="icon-btn" onClick={close} aria-label={t('common.close')}>
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="modal-body">
          {ui.premiumOpen && <MembershipPanel />}
          {spec.body && <p className="field-hint" style={{ lineHeight: 1.8, margin: 0 }}>{spec.body}</p>}


        </div>
      </div>
    </div>
  );
}
