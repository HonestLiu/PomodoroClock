// 网页式 AI 对话（docs/05-modules/ai.md）
// 候选任务与确认操作都画在助手气泡里，不使用模态/对话框。
// compact：右侧抽屉用（临时 AI 能力）；完整版在独立 AI 页。

import { useEffect, useRef, useState } from 'react';
import { Check, RefreshCw, Send, Sparkles, Square, X } from 'lucide-react';
import { useAiChatStore, type AiMessage } from '@/stores/aiChatStore';
import { useDataStore } from '@/stores/dataStore';
import { useUiStore } from '@/stores/uiStore';
import { useI18n } from '@/i18n';
import type { AiFieldKey, AiTaskCandidate } from '@/types';
import '@/styles/ai.css';

const PRIORITIES = ['high', 'medium', 'low', 'none'] as const;
const FIELDS: AiFieldKey[] = ['title', 'project', 'due', 'est', 'priority', 'repeat'];

/** 首次使用引导：点一下就把示例句发出去 */
const EXAMPLES = [
  '明天下午三点前把报告初稿写完',
  '下周五前完成登录模块，周三前先做数据库设计',
];
/** 尚未接入的 AI 能力（点击只给一条诚实说明，不假装可用） */
const PENDING: Array<{ key: 'decompose' | 'plan' | 'report'; icon: string }> = [
  { key: 'decompose', icon: '✂' },
  { key: 'plan', icon: '📅' },
  { key: 'report', icon: '📊' },
];

interface Props {
  compact?: boolean;
  /** 抽屉里省空间：隐藏待接入 chips */
  hidePending?: boolean;
}

export function AiChat({ compact = false, hidePending = false }: Props) {
  const { t } = useI18n();
  const chat = useAiChatStore();
  const lists = useDataStore((s) => s.lists);
  const openSettings = useUiStore((s) => s.openSettings);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages]);

  function send(text: string) {
    const v = text.trim();
    if (!v || chat.sending) return;
    setDraft('');
    void chat.send(v);
  }

  /** 待接入能力：诚实说明，不调用模型 */
  function sendPending(key: string) {
    chat.note(`${t(`ai.feature.${key}`)} · ${t('ai.pending')}\n${t(`ai.stub.${key}`)}`);
  }

  function goManual() {
    chat.clear();
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.add-task input')?.focus());
  }

  function renderItem(msg: AiMessage, c: AiTaskCandidate) {
    const lo = (f: AiFieldKey) => ((c.prov[f]?.confidence ?? 1) < 0.5 ? ' low' : '');
    const lowConf = FIELDS.some((f) => (c.prov[f]?.confidence ?? 1) < 0.5);
    return (
      <div key={c.id} className={`ai-item${c.parent_id ? ' child' : ''}`}>
        <button
          type="button" className={`ai-check${msg.selected?.has(c.id) ? ' on' : ''}`}
          aria-pressed={!!msg.selected?.has(c.id)} aria-label={c.title}
          onClick={() => chat.toggle(msg.id, c.id)}
        >
          {msg.selected?.has(c.id) && <Check size={12} />}
        </button>
        <div className="ai-item-body">
          <input
            className="text-input ai-title" value={c.title} aria-label="title"
            onChange={(e) => void chat.updateItem(msg.id, c.id, { title: e.target.value })}
          />
          <div className="ai-fields">
            <select className="text-input" value={c.list_id ?? ''} aria-label={t('ai.fields.list')}
              onChange={(e) => void chat.updateItem(msg.id, c.id, { list_id: e.target.value || null })}>
              <option value="">{t('common.none')}</option>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            {c.raw_due && <span className="ai-rawdue" title={t('ai.fields.due')}>{c.raw_due}</span>}
            <input className={`text-input${lo('due')}`} type="date" value={c.due_date ?? ''} aria-label={t('ai.fields.due')}
              onChange={(e) => void chat.updateItem(msg.id, c.id, { due_date: e.target.value || null })} />
            <input className={`text-input${lo('due')}`} type="time" value={c.due_time ?? ''} aria-label="time"
              onChange={(e) => void chat.updateItem(msg.id, c.id, { due_time: e.target.value || null })} />
            <input className={`num-input${lo('est')}`} type="number" min={0} value={c.est_min ?? ''}
              aria-label={t('ai.fields.est')} placeholder={t('ai.fields.est')}
              onChange={(e) => void chat.updateItem(msg.id, c.id, { est_min: e.target.value === '' ? null : Number(e.target.value) })} />
            <select className={`text-input${lo('priority')}`} value={c.priority} aria-label={t('ai.fields.priority')}
              onChange={(e) => void chat.updateItem(msg.id, c.id, { priority: e.target.value as AiTaskCandidate['priority'] })}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{t(`ai.priority.${p}`)}</option>)}
            </select>
            {lowConf && <span className="ai-lowconf">{t('ai.lowconf')}</span>}
          </div>
        </div>
      </div>
    );
  }

  function renderAssistant(msg: AiMessage) {
    if (msg.status === 'parsing') {
      return <div className="ai-bubble ai-bubble--ai"><span className="ai-spin" aria-hidden />{t('ai.parsing')}</div>;
    }
    if (msg.status === 'unconfigured') {
      return (
        <div className="ai-bubble ai-bubble--ai">
          <p>{t('ai.unconfigured')}</p>
          <div className="ai-bubble-actions">
            <button className="btn" onClick={() => openSettings('general')}>{t('ai.configure')}</button>
            <button className="btn" onClick={goManual}>{t('ai.manual')}</button>
          </div>
        </div>
      );
    }
    if (msg.status === 'failed') {
      return (
        <div className="ai-bubble ai-bubble--ai ai-bubble--err">
          <p>{t(msg.text || 'ai.failed')}</p>
          {msg.hint && <p className="ai-bubble-hint">{msg.hint}</p>}
          <div className="ai-bubble-actions">
            <button className="btn" onClick={() => void chat.retry(msg.id)}><RefreshCw size={13} /> {t('ai.reset')}</button>
            <button className="btn" onClick={goManual}>{t('ai.manual')}</button>
          </div>
        </div>
      );
    }

    const hasItems = !!msg.items?.length;
    return (
      <div className="ai-bubble ai-bubble--ai">
        {msg.text && <p className="ai-bubble-text">{msg.text}</p>}
        {hasItems && <p className="ai-bubble-text">{t('ai.assistantIntro')}</p>}

        {msg.clarify && msg.clarify.length > 0 && (
          <div className="ai-clarify">
            {msg.clarify.map((c) => (
              <div key={c.id} className="ai-clarify-row">
                <span>{c.text}</span>
                <div className="seg" role="radiogroup">
                  {c.options.map((opt) => (
                    <button key={opt} type="button" onClick={() => void chat.answerClarify(msg.id, c.text, opt)}>
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {hasItems && <div className="ai-tasks">{msg.items!.map((c) => renderItem(msg, c))}</div>}

        {hasItems && (
          <div className="ai-bubble-actions">
            {msg.status === 'adopted' ? (
              <button className="btn" onClick={() => void chat.undo(msg.id)}><X size={13} /> {t('ai.undo')}</button>
            ) : (
              <>
                <button className="btn" onClick={() => chat.selectAll(msg.id)}><Square size={12} /> {t('ai.selectAll')}</button>
                <button className="btn primary" disabled={chat.sending || msg.selected?.size === 0}
                  onClick={() => void chat.adopt(msg.id)}>
                  {chat.sending ? t('ai.applying') : t('ai.apply')}
                </button>
              </>
            )}
            <button className="icon-btn" title={t('ai.reset')} onClick={() => void chat.retry(msg.id)}>
              <RefreshCw size={14} />
            </button>
          </div>
        )}
        {msg.status === 'adopted' && (
          <p className="ai-adopted"><Check size={13} /> {t('ai.adopt_done', { n: msg.createdIds?.length ?? 0 })}</p>
        )}
      </div>
    );
  }

  return (
    <div className={`ai-chat${compact ? ' compact' : ''}`}>
      <div className="ai-chat-scroll" ref={scrollRef}>
        {chat.messages.length === 0 && (
          <div className="ai-chat-empty">
            <Sparkles size={26} aria-hidden />
            <p className="ai-chat-empty-title">{t('ai.chatEmpty')}</p>
            <p className="ai-chat-empty-hint">{t('ai.pageHint')}</p>
            <div className="ai-chat-examples">
              {EXAMPLES.map((e) => (
                <button key={e} type="button" className="chip" onClick={() => send(e)}>{e}</button>
              ))}
            </div>
          </div>
        )}
        {chat.messages.map((m) => (
          <div key={m.id} className={`ai-msg ai-msg--${m.role}`}>
            <span className="ai-msg-who">
              {m.role === 'assistant' ? <Sparkles size={13} /> : <span className="ai-msg-me">{t('ai.me')}</span>}
            </span>
            <div className="ai-msg-body">
              {m.role === 'user' ? <div className="ai-bubble ai-bubble--user">{m.text}</div> : renderAssistant(m)}
            </div>
          </div>
        ))}
      </div>

      {!hidePending && (
        <div className="ai-chat-chips">
          {PENDING.map((p) => (
            <button key={p.key} type="button" className="chip chip--muted" title={t('ai.pending')}
              onClick={() => sendPending(p.key)}>
              {p.icon} {t(`ai.feature.${p.key}`)}
            </button>
          ))}
        </div>
      )}

      <div className="ai-chat-input">
        <input
          className="text-input" value={draft} placeholder={t('ai.placeholder')} aria-label="ai-chat-input"
          disabled={chat.sending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(draft); }}
        />
        <button className="btn primary" disabled={chat.sending || !draft.trim()} onClick={() => send(draft)}
          aria-label={t('ai.send')}><Send size={14} /></button>
        {chat.messages.length > 0 && (
          <button className="icon-btn" title={t('ai.newChat')} aria-label={t('ai.newChat')} onClick={() => chat.clear()}>
            <X size={15} />
          </button>
        )}
      </div>
    </div>
  );
}