import { DateTimeInput } from '@/components/controls/DateTimeInput';
import { Select } from '@/components/controls/Select';
// 网页式 AI 对话（docs/05-modules/ai.md）
// 候选任务、拆解树、每日计划、日报/周报都画在助手气泡里，不使用模态/对话框。
// 顶部 chips 切换 pendingMode：拆解/计划/周报会推一条提示并等输入；plan/report 空回车=默认参数。
// compact：右侧抽屉用；完整版在独立 AI 页。

import { useEffect, useRef, useState } from 'react';
import { Check, RefreshCw, Send, Settings2, Sparkles, Square, Trash2, X } from 'lucide-react';
import { useAiChatStore, type AiMessage, type AiMode } from '@/stores/aiChatStore';
import { useDataStore } from '@/stores/dataStore';
import { useUiStore } from '@/stores/uiStore';
import { useI18n } from '@/i18n';
import type { AiFieldKey, AiTaskCandidate, Recurrence } from '@/types';
import type { DecomNode } from '@/lib/ai/decompose';
import { formatMinutesShort, formatShortDate } from '@/lib/date';
import '@/styles/ai.css';

const PRIORITIES = ['high', 'medium', 'low', 'none'] as const;
const REPEAT_VALUES: Recurrence[] = ['none', 'hourly', 'daily', 'weekdays', 'weekends', 'weekly'];
const FIELDS: AiFieldKey[] = ['title', 'project', 'due', 'est', 'priority', 'repeat'];

/** 首次使用引导：点一下就把示例句发出去 */
const EXAMPLES = [
  '明天下午三点前把报告初稿写完',
  '下周五前完成登录模块，周三前先做数据库设计',
];

/** 已接入的 AI 能力（点击切换下一次输入的模式） */
const CAPABILITIES: Array<{ mode: AiMode; icon: string }> = [
  { mode: 'decompose', icon: '✂' },
  { mode: 'plan', icon: '📅' },
  { mode: 'report', icon: '📊' },
];

interface Props {
  compact?: boolean;
  /** 抽屉里省空间：隐藏能力 chips */
  hidePending?: boolean;
}

export function AiChat({ compact = false, hidePending = false }: Props) {
  const { t } = useI18n();
  const chat = useAiChatStore();
  const lists = useDataStore((s) => s.lists);
  const openSettings = useUiStore((s) => s.openSettings);
  const [draft, setDraft] = useState('');
  const [batchMsg, setBatchMsg] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages]);

  function sendDraft() {
    const v = draft.trim();
    const allowEmpty = chat.pendingMode === 'plan' || chat.pendingMode === 'report';
    if (!v && !allowEmpty) return;
    if (chat.sending) return;
    setDraft('');
    void chat.send(v);
  }

  /** 切换待输入模式 + 推一条提示 */
  function startCap(mode: AiMode) {
    chat.setPendingMode(mode);
    chat.note(t(`ai.prompt.${mode}`));
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function goManual() {
    chat.clear();
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.add-task input')?.focus());
  }

  const placeholder =
    chat.pendingMode === 'decompose' ? t('ai.placeholder.decompose')
    : chat.pendingMode === 'plan' ? t('ai.placeholder.plan')
    : chat.pendingMode === 'report' ? t('ai.placeholder.report')
    : t('ai.placeholder');
  const canSend = chat.pendingMode === 'plan' || chat.pendingMode === 'report'
    ? true : !!draft.trim();

  /* ── 功能一：NL 候选任务 ─────────────────────────────── */
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
            <Select className="text-input" value={c.list_id ?? ''} aria-label={t('ai.fields.list')}
              onChange={(e) => void chat.updateItem(msg.id, c.id, { list_id: e.target.value || null })}>
              <option value="">{t('common.none')}</option>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
            {c.raw_due && <span className="ai-rawdue" title={t('ai.fields.due')}>{c.raw_due}</span>}
            <DateTimeInput className={`text-input${lo('due')}`} type="date" value={c.due_date ?? ''} aria-label={t('ai.fields.due')}
              onChange={(e) => void chat.updateItem(msg.id, c.id, { due_date: e.target.value || null })} />
            <DateTimeInput className={`text-input${lo('due')}`} type="time" value={c.due_time ?? ''} aria-label="time"
              onChange={(e) => void chat.updateItem(msg.id, c.id, { due_time: e.target.value || null })} />
            <input className={`num-input${lo('est')}`} type="number" min={0} value={c.est_min ?? ''}
              aria-label={t('ai.fields.est')} placeholder={t('ai.fields.est')}
              onChange={(e) => void chat.updateItem(msg.id, c.id, { est_min: e.target.value === '' ? null : Number(e.target.value) })} />
            <Select className={`text-input${lo('priority')}`} value={c.priority} aria-label={t('ai.fields.priority')}
              onChange={(e) => void chat.updateItem(msg.id, c.id, { priority: e.target.value as AiTaskCandidate['priority'] })}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{t(`ai.priority.${p}`)}</option>)}
            </Select>
            {lowConf && <span className="ai-lowconf">{t('ai.lowconf')}</span>}
          </div>
        </div>
      </div>
    );
  }

  /* ── 多选批量：删除所选 + 批量设置（应用到所有勾选项） ── */
  function renderBatchBar(msg: AiMessage) {
    const selCount = msg.selected?.size ?? 0;
    const open = batchMsg === msg.id;
    return (
      <>
        <div className="ai-batch">
          <button type="button" className="btn ai-batch-del" disabled={selCount === 0}
            onClick={() => chat.removeItems(msg.id, [...(msg.selected ?? [])])}
            title={t('ai.batch.delete')}>
            <Trash2 size={13} /> {t('ai.batch.delete')}{selCount ? ` (${selCount})` : ''}
          </button>
          <button type="button" className={`btn${open ? ' ai-batch-set--on' : ''}`} disabled={selCount === 0}
            onClick={() => setBatchMsg(open ? null : msg.id)} title={t('ai.batch.set')}>
            <Settings2 size={13} /> {t('ai.batch.set')}
          </button>
          <span className="ai-batch-hint">{t('ai.batch.hint', { n: selCount })}</span>
        </div>
        {open && selCount > 0 && (
          <div className="ai-batch-panel">
            <Select className="text-input" defaultValue="" aria-label={t('ai.fields.list')}
              onChange={(e) => { if (e.target.value) void chat.bulkPatch(msg.id, { list_id: e.target.value }); e.target.value = ''; }}>
              <option value="">{t('ai.fields.list')}…</option>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
            <Select className="text-input" defaultValue="" aria-label={t('ai.fields.priority')}
              onChange={(e) => { if (e.target.value) void chat.bulkPatch(msg.id, { priority: e.target.value as AiTaskCandidate['priority'] }); e.target.value = ''; }}>
              <option value="">{t('ai.fields.priority')}…</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{t(`ai.priority.${p}`)}</option>)}
            </Select>
            <Select className="text-input" defaultValue="" aria-label={t('ai.fields.repeat')}
              onChange={(e) => { if (e.target.value) void chat.bulkPatch(msg.id, { repeat: e.target.value as Recurrence }); e.target.value = ''; }}>
              <option value="">{t('ai.fields.repeat')}…</option>
              {REPEAT_VALUES.map((r) => <option key={r} value={r}>{t(`task.repeat.${r}`)}</option>)}
            </Select>
            <DateTimeInput className="text-input" type="date" aria-label={t('ai.fields.due')}
              onChange={(e) => void chat.bulkPatch(msg.id, { due_date: e.target.value || null })} />
            <DateTimeInput className="text-input" type="time" aria-label="time"
              onChange={(e) => void chat.bulkPatch(msg.id, { due_time: e.target.value || null })} />
            <input className="num-input" type="number" min={0} placeholder={t('ai.fields.est')} aria-label={t('ai.fields.est')}
              onChange={(e) => void chat.bulkPatch(msg.id, { est_min: e.target.value === '' ? null : Number(e.target.value) })} />
          </div>
        )}
      </>
    );
  }

  /* ── 功能二：拆解树 ─────────────────────────────────── */
  function renderTreeNode(node: DecomNode, msg: AiMessage) {
    const sel = msg.selectedNodes?.has(node.id);
    return (
      <div key={node.id} className="ai-tnode">
        <div className="ai-tnode-row">
          <button type="button" className={`ai-check${sel ? ' on' : ''}`} aria-pressed={!!sel}
            onClick={() => chat.toggleNode(msg.id, node.id)}>
            {sel && <Check size={12} />}
          </button>
          <span className="ai-tnode-title">
            {node.priority && node.priority !== 'none' && (
              <span className={`task-prio task-prio-${node.priority}`} aria-hidden />
            )}
            {node.title}
          </span>
          {node.tags?.map((tag) => <span key={tag} className="ai-tnode-tag">{tag}</span>)}
          {node.est_min != null && <span className="ai-tnode-est">{formatMinutesShort(node.est_min)}</span>}
          {node.low_conf && <span className="ai-lowconf">{t('ai.lowconf')}</span>}
        </div>
        {node.acceptance_criteria && <div className="ai-tnode-accept">✓ {node.acceptance_criteria}</div>}
        {node.notes && <div className="ai-tnode-note">📝 {node.notes}</div>}
        {node.children.map((k) => <div key={k.id} className="ai-tnode-nest">{renderTreeNode(k, msg)}</div>)}
      </div>
    );
  }

  function renderDecompose(msg: AiMessage) {
    const root = msg.tree;
    if (!root) return null;
    const count = msg.selectedNodes?.size ?? 0;
    return (
      <div className="ai-bubble ai-bubble--ai">
        <p className="ai-bubble-text">{t('ai.mode.decompose')} ·「{msg.sourceText ?? ''}」</p>
        {msg.decomListName && <p className="ai-bubble-note">📁 {t('ai.decompose.list')}「{msg.decomListName}」</p>}
        {msg.decomDegraded && <p className="ai-note">{t('ai.decompose.degraded')}</p>}
        {msg.criticalPath && <p className="ai-note">⚡ {msg.criticalPath}</p>}
        {root.children.length === 0 && <p className="ai-note">{t('ai.decompose.empty')}</p>}
        <div className="ai-tree">
          {root.children.map((c) => renderTreeNode(c, msg))}
        </div>
        <div className="ai-bubble-actions">
          {msg.status === 'adopted' ? (
            <button className="btn" onClick={() => void chat.undo(msg.id)}><X size={13} /> {t('ai.undo')}</button>
          ) : (
            <>
              <button className="btn" onClick={() => chat.selectAllTree(msg.id)}><Square size={12} /> {t('ai.selectAll')}</button>
              <button className="btn primary" disabled={chat.sending || count === 0}
                onClick={() => void chat.adoptTree(msg.id)}>
                {chat.sending ? t('ai.applying') : t('ai.apply')} {count > 0 ? `(${count})` : ''}
              </button>
            </>
          )}
          <button className="icon-btn" title={t('ai.reset')} onClick={() => void chat.retry(msg.id)}>
            <RefreshCw size={14} />
          </button>
        </div>
        {msg.status === 'adopted' && (
          <p className="ai-adopted"><Check size={13} /> {t('ai.adopt_done', { n: msg.createdIds?.length ?? 0 })}</p>
        )}
      </div>
    );
  }

  /* ── 功能三：每日计划 ───────────────────────────────── */
  function renderPlan(msg: AiMessage) {
    const p = msg.plan;
    if (!p) return null;
    return (
      <div className="ai-bubble ai-bubble--ai">
        <p className="ai-bubble-text">
          {t('ai.mode.plan')} · {formatShortDate(p.dateKey)}
          {p.degraded && <span className="ai-note"> {t('ai.plan.degraded')}</span>}
        </p>
        {p.status === 'empty' && <p className="ai-note">{t('ai.plan.empty')}</p>}
        {p.status !== 'empty' && (
          <>
            <div className="ai-plan-cap">
              {t('ai.plan.used')} {formatMinutesShort(p.used_min)} / {t('ai.plan.capacity')} {formatMinutesShort(p.capacity_min)}
            </div>
            {p.conflict && (
              <div className="ai-plan-conflict">⚠ {t('ai.plan.conflict')}（{t('ai.plan.more')} {formatMinutesShort(p.conflict.overrun_min)}）</div>
            )}
            {p.blocks.map((b, i) => (
              <div key={i} className="ai-plan-block">
                <div className="ai-plan-block-head">{b.project || t('common.none')}</div>
                {b.items.map((it) => (
                  <div key={it.id} className="ai-plan-item">
                    <span className="ai-plan-item-title">{it.title}</span>
                    <span className="ai-plan-item-est">{formatMinutesShort(it.est_min)}</span>
                    {it.reason && <span className="ai-plan-item-reason">{it.reason}</span>}
                  </div>
                ))}
              </div>
            ))}
            {p.deferred.length > 0 && (
              <div className="ai-plan-deferred">
                <p className="ai-plan-deferred-title"><b>{t('ai.plan.deferred')}</b></p>
                {p.deferred.map((d) => (
                  <span key={d.id} className="ai-plan-deferred-item">{d.title}{d.reason ? `·${d.reason}` : ''}</span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  /* ── 功能四：日报 / 周报 ───────────────────────────── */
  function renderReport(msg: AiMessage) {
    const r = msg.report;
    if (!r) return null;
    return (
      <div className="ai-bubble ai-bubble--ai">
        <p className="ai-bubble-text">
          {t('ai.mode.report')} · {r.periodLabel}
          {r.degraded && <span className="ai-note"> {t('ai.report.degraded')}</span>}
        </p>
        {r.status === 'empty' && <p className="ai-note">{t('ai.report.empty')}</p>}
        {r.status !== 'empty' && (
          <>
            <div className="ai-report-stats">
              <div className="ai-report-stat"><span>{t('ai.report.total')}</span><b>{formatMinutesShort(r.total_min)}</b></div>
              <div className="ai-report-stat"><span>{t('ai.report.days')}</span><b>{r.focus_days}</b></div>
              <div className="ai-report-stat"><span>{t('ai.report.done')}</span><b>{r.done_tasks}/{r.open_tasks}</b></div>
              <div className="ai-report-stat"><span>{t('ai.report.rate')}</span><b>{r.completion_rate}%</b></div>
            </div>
            {r.top_projects.length > 0 && (
              <div className="ai-report-projects">
                <p className="ai-report-projects-title">{t('ai.report.project')}</p>
                {r.top_projects.map((p, i) => (
                  <div key={i} className="ai-report-proj">
                    <span className="ai-report-proj-name">{p.name}</span>
                    <span className="ai-report-proj-min">{formatMinutesShort(p.minutes)}</span>
                    <span className="ai-report-proj-pct">{p.percent}%</span>
                  </div>
                ))}
              </div>
            )}
            {r.upcoming_risk.length > 0 && (
              <div className="ai-report-risk"><p className="ai-report-risk-title">⚠ {t('ai.report.risk')}</p>
                {r.upcoming_risk.slice(0, 5).map((x, i) => (
                  <span key={i} className="ai-report-risk-item">「{x.title}」{t('ai.report.left', { n: x.days_left })}</span>
                ))}
              </div>
            )}
            {r.sections.map((s, i) => (
              <div key={i} className="ai-report-sec">
                <b className="ai-report-sec-title">{s.title}</b>
                <p className="ai-report-sec-body">{s.body}</p>
              </div>
            ))}
            {r.next_steps.length > 0 && (
              <div className="ai-report-next">
                <b className="ai-report-sec-title">{t('ai.report.next')}</b>
                <ul>{r.next_steps.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </div>
            )}
          </>
        )}
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
    if (msg.kind === 'decompose' && msg.tree) return renderDecompose(msg);
    if (msg.kind === 'plan' && msg.plan) return renderPlan(msg);
    if (msg.kind === 'report' && msg.report) return renderReport(msg);
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
        {hasItems && <div className="ai-tasks">{msg.items!.map((c) => renderItem(msg, c))}</div>}
        {hasItems && msg.status !== 'adopted' && renderBatchBar(msg)}
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
            <button className="icon-btn" title={t('ai.reset')} onClick={() => void chat.retry(msg.id)}><RefreshCw size={14} /></button>
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
                <button key={e} type="button" className="chip" onClick={() => { setDraft(e); void chat.send(e); }}>{e}</button>
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
          {CAPABILITIES.map((c) => (
            <button key={c.mode} type="button" className={`chip${chat.pendingMode === c.mode ? ' chip--active' : ' chip--muted'}`}
              onClick={() => startCap(c.mode)}>
              {c.icon} {t(`ai.mode.${c.mode}`)}
            </button>
          ))}
          {chat.pendingMode !== 'nl' && (
            <button type="button" className="chip" onClick={() => chat.setPendingMode('nl')}>{t('ai.mode.none')} ✕</button>
          )}
        </div>
      )}

      <div className="ai-chat-input">
        <input
          ref={inputRef}
          className="text-input" value={draft} placeholder={placeholder}
          aria-label="ai-chat-input"
          disabled={chat.sending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') sendDraft(); }}
        />
        <button className="btn primary" disabled={chat.sending || !canSend} onClick={sendDraft}
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