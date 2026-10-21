// AI 对话状态（docs/05-modules/ai.md）—— 网页式 AI 对话流。
// 一条助手消息 = 一次解析结果（含候选任务、澄清、采纳/撤销），按消息分批回滚（createdIds）。

import { create } from 'zustand';
import type { AiClarify, AiTaskCandidate, Settings } from '@/types';
import { api } from '@/api';
import { parseTasks, type ParseOutcome } from '@/lib/ai/nlParse';
import { calibrationSummary } from '@/lib/ai/calib';
import { useDataStore } from './dataStore';
import { useTimerStore } from './timerStore';

export type AiMsgRole = 'user' | 'assistant';
export type AiMsgStatus = 'parsing' | 'ok' | 'failed' | 'unconfigured' | 'adopted';

export interface AiMessage {
  id: string;
  role: AiMsgRole;
  text: string;                 // user: 原句；assistant: 状态/说明文案 key 或自由文本
  status?: AiMsgStatus;
  items?: AiTaskCandidate[];    // assistant 的候选任务
  selected?: Set<string>;
  createdIds?: string[];        // 本条消息已落库的任务（可撤销）
  clarify?: AiClarify[];
  sourceText?: string;          // 这条助手消息解析的原始输入（用于重新生成/澄清）
  sourceExtra?: string;
  hint?: string;                // 失败原因（服务端短句/字段明细），用于气泡内的次行提示
}

interface AiChatState {
  messages: AiMessage[];
  sending: boolean;

  send(text: string): Promise<void>;
  /** 直接插一条纯文本助手消息（说明/待接入提示），不调用模型 */
  note(text: string): void;
  /** 澄清点选：以「问题 → 选项」作为新一轮用户消息，并按确认口径重解析 */
  answerClarify(msgId: string, question: string, option: string): Promise<void>;
  retry(msgId: string): Promise<void>;
  toggle(msgId: string, itemId: string): void;
  selectAll(msgId: string): void;
  updateItem(msgId: string, itemId: string, patch: Partial<AiTaskCandidate>): Promise<void>;
  adopt(msgId: string): Promise<number>;
  undo(msgId: string): Promise<void>;
  clear(): void;
}

let seq = 0;
const nid = () => `m${++seq}_${Date.now().toString(36)}`;

export const useAiChatStore = create<AiChatState>((set, get) => {
  const push = (m: AiMessage) => set((s) => ({ messages: [...s.messages, m] }));
  const patchMsg = (id: string, patch: Partial<AiMessage>) =>
    set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));

  async function runParse(assistantId: string, text: string, extra?: string): Promise<ParseOutcome> {
    const ds = useDataStore.getState();
    const settings = useTimerStore.getState().settings as Settings;
    const calib = calibrationSummary(ds.tasks, ds.records, settings.focus_len_min || 25);
    const out = await parseTasks({ text, extra, settings, lists: ds.lists, calib });
    if (out.status === 'ok') {
      patchMsg(assistantId, {
        status: 'ok', items: out.tasks, clarify: out.clarifies,
        selected: new Set(out.tasks.map((t) => t.id)), sourceText: text, sourceExtra: extra,
      });
    } else {
      patchMsg(assistantId, {
        status: out.status === 'unconfigured' ? 'unconfigured' : 'failed',
        items: [], clarify: [], sourceText: text, sourceExtra: extra,
        text: out.message || 'ai.failed', hint: out.hint || '',
      });
    }
    return out;
  }

  return {
    messages: [],
    sending: false,

    note(text) {
      push({ id: nid(), role: 'assistant', text, status: 'ok' });
    },

    async send(text) {
      const t = text.trim();
      if (!t) return;
      const aid = nid();
      set({ sending: true });
      push({ id: nid(), role: 'user', text: t });
      push({ id: aid, role: 'assistant', text: '', status: 'parsing', sourceText: t });
      try {
        await runParse(aid, t);
      } finally {
        set({ sending: false });
      }
    },

    async answerClarify(msgId, question, option) {
      const line = `${question} → ${option}`;
      const src = get().messages.find((m) => m.id === msgId)?.sourceText;
      if (!src) return;
      const aid = nid();
      set({ sending: true });
      push({ id: nid(), role: 'user', text: line });
      push({ id: aid, role: 'assistant', text: '', status: 'parsing', sourceText: src });
      try {
        await runParse(aid, src, line);
      } finally {
        set({ sending: false });
      }
    },

    async retry(msgId) {
      const src = get().messages.find((m) => m.id === msgId)?.sourceText;
      if (!src) return;
      set({ sending: true });
      try {
        await runParse(msgId, src, get().messages.find((m) => m.id === msgId)?.sourceExtra);
      } finally {
        set({ sending: false });
      }
    },

    toggle(msgId, itemId) {
      set((s) => ({
        messages: s.messages.map((m) => {
          if (m.id !== msgId || !m.selected) return m;
          const next = new Set(m.selected);
          if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
          return { ...m, selected: next };
        }),
      }));
    },

    selectAll(msgId) {
      set((s) => ({
        messages: s.messages.map((m) => (m.id === msgId && m.items
          ? { ...m, selected: new Set(m.items.map((i) => i.id)) } : m)),
      }));
    },

    async updateItem(msgId, itemId, patch) {
      set((s) => ({
        messages: s.messages.map((m) => (m.id === msgId && m.items
          ? { ...m, items: m.items.map((c) => (c.id === itemId ? { ...c, ...patch } : c)) }
          : m)),
      }));
    },

    async adopt(msgId) {
      const m = get().messages.find((x) => x.id === msgId);
      const sel = m?.selected;
      if (!m?.items?.length || !sel) return 0;
      const picked = m.items.filter((c) => sel.has(c.id));
      if (!picked.length) return 0;
      const settings = useTimerStore.getState().settings as Settings;
      const focusLen = settings.focus_len_min || 25;
      const idByTemp = new Map<string, string>();
      const created: string[] = [];
      set({ sending: true });
      try {
        for (const c of picked) {
          const parentReal = c.parent_id ? idByTemp.get(c.parent_id) ?? null : null;
          const rec = await api.create_task({
            title: c.title,
            listId: c.list_id,
            dueDate: c.due_date,
            dueTime: c.due_time,
            priority: c.priority,
            repeat: c.repeat,
            parentId: parentReal,
            estPomodoros: c.est_min != null ? Math.round((c.est_min / focusLen) * 10) / 10 : undefined,
          });
          idByTemp.set(c.id, rec.id);
          created.push(rec.id);
        }
      } finally {
        set({ sending: false });
      }
      patchMsg(msgId, { status: 'adopted', createdIds: created });
      return created.length;
    },

    async undo(msgId) {
      const m = get().messages.find((x) => x.id === msgId);
      for (const id of [...(m?.createdIds ?? [])].reverse()) {
        try { await api.delete_task(id); } catch { /* 已删则忽略 */ }
      }
      useDataStore.getState().reload();
      patchMsg(msgId, { status: 'ok', createdIds: [] });
    },

    clear() {
      set({ messages: [], sending: false });
    },
  };
});