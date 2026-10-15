// 危险操作二次确认 —— PRD FR-S2（删除数据 / 注销账号）、§8.8-4

import { X } from 'lucide-react';

export interface ConfirmSpec {
  title: string;
  message: string;
  confirmText: string;
  danger?: boolean;
  onConfirm(): void | Promise<void>;
}

export function ConfirmDialog({ spec, onClose }: { spec: ConfirmSpec; onClose(): void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{spec.title}</h2>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">{spec.message}</div>
        <div className="confirm-actions">
          <button className="btn" onClick={onClose}>取消</button>
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
