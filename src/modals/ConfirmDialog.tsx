// 危险操作二次确认 —— PRD FR-S2（删除数据 / 注销账号）、§8.8-4
// 键盘：Esc 关闭、Tab 循环、初始焦点落在「取消」（危险操作的默认安全项）。

import { useRef } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useModalA11y } from '@/components/useModalA11y';

export interface ConfirmSpec {
  title: string;
  message: string;
  confirmText: string;
  danger?: boolean;
  onConfirm(): void | Promise<void>;
}

export function ConfirmDialog({ spec, onClose }: { spec: ConfirmSpec; onClose(): void }) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  useModalA11y(true, onClose, rootRef, '.confirm-actions .btn');

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="modal confirm-modal"
        ref={rootRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="confirm-title">{spec.title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="modal-body" id="confirm-desc">{spec.message}</div>
        <div className="confirm-actions">
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button
            className={`btn ${spec.danger ? 'danger' : 'primary'}`}
            onClick={async () => { await spec.onConfirm(); onClose(); }}
          >
            {spec.confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
