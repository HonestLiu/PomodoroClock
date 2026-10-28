// AI 对话状态（docs/05-modules/ai.md）—— 网页式 AI 对话流。
// 一条助手消息 = 一次能力调用：nl(建任务) / decompose(拆解) / plan(每日计划) / report(日报周报)。
// nl 与 decompose 可采纳落库；plan / report 只读展示（报告不入 tasks，天然无回滚）。

import { create } from 'zustand';
import type { AiClarify, Settings } from '@/types';
import { api } from '@/api';
import { parseTasks } from '@/lib/ai/nlParse';
import { decomposeGoal, type DecomNode } from '@/lib/ai/decompose';
import { buildDailyPlan, type PlanOutcome } from '@/lib/ai/plan';
import { buildReport, type ReportOutcome, type ReportWhat } from '@/lib/ai/report';
import { calibrationSummary } from '@/lib/ai/calib';
import { addDays, toDateKey } from '@/lib/date';
import { useDataStore } from './dataStore';
import { useTimerStore } from './timerStore';
import type { AiTaskCandidate } from '@/types';

/** 批量应用到所选候选的字段（只含调用方实际要设置的键） */
export type AiBatchPatch = Partial<
  Pick<AiTaskCandidate, 'list_id' | 'due_date' | 'due_time' | 'est_min' | 'priority' | 'repeat'>
>;

export type AiMsgRole = 'user' | 'assistant';
export type AiMsgStatus = 'parsing' | 'ok' | 'failed' | 'unconfigured' | 'adopted';
export type AiMode = 'nl' | 'decompose' | 'plan' | 'report';

export interface AiMessage {
  id: string;
  role: AiMsgRole;
  text: string;                 // user: 原句；assistant: 状态/说明文案 key 或自由文本
  status?: AiMsgStatus;
  kind?: AiMode;                // 本条助手消息对应的能力（用于渲染）
  items?: AiTaskCandidate[];    // nl 的候选任务
  selected?: Set<string>;
  createdIds?: string[];        // 本条消息已落库的任务（可撤销）
  clarify?: AiClarify[];
  sourceText?: string;          // 重新生成/澄清用的原始输入
  sourceExtra?: string;
  hint?: string;                // 失败原因（服务端短句/字段明细）

  // decompose
  tree?: DecomNode;
  criticalPath?: string;
  decomDegraded?: boolean;
  selectedNodes?: Set<string>;
  /** AI 生成的简短清单名（新建独立清单，不用原始提问句） */
  decomListName?: string;
  /** 拆解采纳时新建的独立清单（撤销时连同清空） */
  createdListId?: string;

  // plan / report
  plan?: PlanOutcome;
  report?: ReportOutcome;
}

interface AiChatState {
  messages: AiMessage[];
  sending: boolean;
  /** 下一个回车走的模式：nl 之外的 chip 设它，回车后自动归位 */
  pendingMode: AiMode;

  send(text: string): Promise<void>;
  setPendingMode(mode: AiMode): void;
  /** 直接插一条纯文本助手消息（说明/提示），不调用模型 */
  note(text: string): void;
  answerClarify(msgId: string, question: string, option: string): Promise<void>;
  retry(msgId: string): Promise<void>;
  toggle(msgId: string, itemId: string): void;
  selectAll(msgId: string): void;
  updateItem(msgId: string, itemId: string, patch: Partial<AiTaskCandidate>): Promise<void>;
  adopt(msgId: string): Promise<number>;
  undo(msgId: string): Promise<void>;
  /** 多选批量：删除所选候选（子项孤儿自动提升为顶层） */
  removeItems(msgId: string, itemIds: string[]): void;
  /** 多选批量：把同一补丁应用到所有所选候选 */
  bulkPatch(msgId: string, patch: AiBatchPatch): void;
  /** 拆解树：勾选/取消某节点（连带其子树） */
  toggleNode(msgId: string, nodeId: string): void;
  /** 全选整棵拆解树 */
  selectAllTree(msgId: string): void;
  /** 采纳所选拆解节点为任务树 */
  adoptTree(msgId: string): Promise<number>;
  clear(): void;
}

let seq = 0;
const nid = () => `m${++seq}_${Date.now().toString(36)}`;

/** 收集整棵树的节点 id */
export function subtreeIds(node: DecomNode): string[] {
  return [node.id, ...node.children.flatMap(subtreeIds)];
}

function settingsNow(): Settings {
  return useTimerStore.getState().settings as Settings;
}

/** 把「明天/后天/后天」或 YYYY-MM-DD 解析为日期；无法识别返回 null */
export function parsePlanDate(text: string, now = new Date()): Date | null {
  const t = (text || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return new Date(`${t}T00:00:00`);
  if (/明天|明日|tomorrow/.test(t)) return addDays(now, 1);
  if (/后天/.test(t)) return addDays(now, 2);
  if (/今天|今日|today/.test(t)) return now;
  return null;
}

export const useAiChatStore = create<AiChatState>((set, get) => {
  const push = (m: AiMessage) => set((s) => ({ messages: [...s.messages, m] }));
  const patchMsg = (id: string, patch: Partial<AiMessage>) =>
    set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));

  function calib() {
    const ds = useDataStore.getState();
    return calibrationSummary(ds.tasks, ds.records, settingsNow().focus_len_min || 25);
  }

  async function runParse(assistantId: string, text: string, extra?: string): Promise<void> {
    const ds = useDataStore.getState();
    const out = await parseTasks({ text, extra, settings: settingsNow(), lists: ds.lists, calib: calib() });
    if (out.status === 'ok') {
      patchMsg(assistantId, {
        status: 'ok', kind: 'nl', items: out.tasks, clarify: out.clarifies,
        selected: new Set(out.tasks.map((t) => t.id)), sourceText: text, sourceExtra: extra,
      });
    } else {
      patchMsg(assistantId, {
        status: out.status === 'unconfigured' ? 'unconfigured' : 'failed',
        kind: 'nl', items: [], clarify: [], sourceText: text, sourceExtra: extra,
        text: out.message || 'ai.failed', hint: out.hint || '',
      });
    }
  }

  async function runDecompose(assistantId: string, goal: string): Promise<void> {
    const ds = useDataStore.getState();
    const out = await decomposeGoal({ goal, settings: settingsNow(), lists: ds.lists, calib: calib() });
    if (out.status === 'ok' && out.root) {
      patchMsg(assistantId, {
        status: 'ok', kind: 'decompose', tree: out.root, criticalPath: out.critical_path,
        decomDegraded: out.degraded, decomListName: out.listName,
        selectedNodes: new Set(subtreeIds(out.root)), sourceText: goal,
      });
    } else {
      patchMsg(assistantId, {
        status: out.status === 'unconfigured' ? 'unconfigured' : 'failed',
        kind: 'decompose', tree: undefined, sourceText: goal, decomListName: 'AI 拆解',
        text: out.message || 'ai.failed', hint: out.hint || '',
      });
    }
  }

  async function runPlan(assistantId: string, text: string): Promise<void> {
    const ds = useDataStore.getState();
    const dateRef = parsePlanDate(text) ?? new Date();
    const out = await buildDailyPlan({ tasks: ds.tasks, records: ds.records, lists: ds.lists, settings: settingsNow(), calib: calib(), dateRef });
    // plan 内部已做降级（LLM 挂了走确定性排序），对外一律 ok；是否空待办由 plan.status === 'empty' 表达。
    patchMsg(assistantId, {
      status: 'ok', kind: 'plan', plan: out, sourceText: text || String(toDateKey(dateRef)),
    });
  }

  async function runReport(assistantId: string, text: string): Promise<void> {
    const ds = useDataStore.getState();
    const what: ReportWhat = /周/.test(text || '') ? 'week' : 'day';
    const out = await buildReport({ tasks: ds.tasks, records: ds.records, lists: ds.lists, settings: settingsNow(), calib: calib(), what });
    patchMsg(assistantId, {
      status: 'ok', kind: 'report', report: out, sourceText: text || what,
    });
  }

  /** 统一起点：push 用户句 + parsing 助手消息，按 pendingMode 分派。 */
  async function kick(text: string): Promise<void> {
    const md = get().pendingMode || 'nl';
    set({ sending: true, pendingMode: 'nl' });
    const t = text.trim();
    const aid = nid();
    if (t) push({ id: nid(), role: 'user', text: t });
    push({ id: aid, role: 'assistant', text: '', status: 'parsing', kind: md, sourceText: t || undefined });
    try {
      if (md === 'decompose') await runDecompose(aid, t);
      else if (md === 'plan') await runPlan(aid, t);
      else if (md === 'report') await runReport(aid, t);
      else await runParse(aid, t, undefined);
    } finally {
      set({ sending: false });
    }
  }

  return {
    messages: [],
    sending: false,
    pendingMode: 'nl',

    setPendingMode(mode) { set({ pendingMode: mode }); },

    note(text) {
      push({ id: nid(), role: 'assistant', text, status: 'ok' });
    },

    async send(text) {
      await kick(text);
    },

    async answerClarify(msgId, question, option) {
      const line = `${question} → ${option}`;
      const src = get().messages.find((m) => m.id === msgId)?.sourceText;
      if (!src) return;
      const aid = nid();
      set({ sending: true, pendingMode: 'nl' });
      push({ id: nid(), role: 'user', text: line });
      push({ id: aid, role: 'assistant', text: '', status: 'parsing', kind: 'nl', sourceText: src });
      try {
        await runParse(aid, src, line);
      } finally {
        set({ sending: false });
      }
    },

    async retry(msgId) {
      const m = get().messages.find((x) => x.id === msgId);
      const src = m?.sourceText;
      if (!src && m?.kind !== 'plan') return;
      set({ sending: true });
      try {
        if (m?.kind === 'decompose') await runDecompose(msgId, src ?? '');
        else if (m?.kind === 'plan') await runPlan(msgId, src ?? '');
        else if (m?.kind === 'report') await runReport(msgId, src ?? 'day');
        else if (src) await runParse(msgId, src, m?.sourceExtra);
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

    removeItems(msgId, itemIds) {
      set((s) => ({
        messages: s.messages.map((m) => {
          if (m.id !== msgId || !m.items?.length) return m;
          const del = new Set(itemIds);
          const kept = m.items.filter((c) => !del.has(c.id));
          // 被删父项的孤儿子项：提升为顶层（保留信息，不误删）
          const keptIds = new Set(kept.map((k) => k.id));
          const promoted = kept.map((c) => (c.parent_id && !keptIds.has(c.parent_id) ? { ...c, parent_id: null } : c));
          const sel = new Set(m.selected ?? []);
          for (const id of itemIds) sel.delete(id);
          return { ...m, items: promoted, selected: sel };
        }),
      }));
    },

    bulkPatch(msgId, patch) {
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) clean[k] = v;
      if (!Object.keys(clean).length) return;
      set((s) => ({
        messages: s.messages.map((m) => {
          if (m.id !== msgId || !m.items || !m.selected) return m;
          const sp = new Set(m.selected);
          return { ...m, items: m.items.map((c) => (sp.has(c.id) ? { ...c, ...clean } as AiTaskCandidate : c)) };
        }),
      }));
    },

    async adopt(msgId) {
      const m = get().messages.find((x) => x.id === msgId);
      const sel = m?.selected;
      if (!m?.items?.length || !sel) return 0;
      const picked = m.items.filter((c) => sel.has(c.id));
      if (!picked.length) return 0;
      const focusLen = settingsNow().focus_len_min || 25;
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
      // 拆解采纳时新建的独立清单：撤销时一并删除（此时清单已空）
      if (m?.createdListId) { try { await api.delete_list(m.createdListId); } catch { /* 忽略 */ } }
      useDataStore.getState().reload();
      patchMsg(msgId, { status: 'ok', createdIds: [], createdListId: undefined });
    },

    toggleNode(msgId, nodeId) {
      set((s) => ({
        messages: s.messages.map((m) => {
          if (m.id !== msgId || !m.tree || !m.selectedNodes) return m;
          const node = findNode(m.tree!, nodeId);
          if (!node) return m;
          const ids = subtreeIds(node);
          const next = new Set(m.selectedNodes);
          const on = next.has(nodeId);
          for (const id of ids) { if (on) next.delete(id); else next.add(id); }
          return { ...m, selectedNodes: next };
        }),
      }));
    },

    selectAllTree(msgId) {
      set((s) => ({
        messages: s.messages.map((m) => (m.id === msgId && m.tree
          ? { ...m, selectedNodes: new Set(subtreeIds(m.tree)) } : m)),
      }));
    },

    async adoptTree(msgId) {
      const m = get().messages.find((x) => x.id === msgId);
      const root = m?.tree;
      if (!root || !m?.selectedNodes) return 0;
      const focusLen = settingsNow().focus_len_min || 25;
      const idByTemp = new Map<string, string>();
      const sel = m.selectedNodes;
      let created = 0;
      set({ sending: true });
      try {
        // 每个拆解归属一个独立清单：以 AI 生成的简短清单名建新清单（不用整句提问），所有拆解任务都归它。
        const goalName = (m?.decomListName || root.title || 'AI 拆解').trim().slice(0, 60);
        const list = await api.create_list({ name: goalName });
        const listId = list.id;
        async function createNode(node: DecomNode, parentReal: string | null): Promise<void> {
          const rec = await api.create_task({
            title: node.title,
            parentId: parentReal,
            listId,
            notes: node.notes || undefined,
            tags: node.tags?.length ? node.tags : undefined,
            priority: node.priority,
            estPomodoros: node.est_min != null ? Math.round((node.est_min / focusLen) * 10) / 10 : undefined,
          });
          idByTemp.set(node.id, rec.id);
          created += 1;
          for (const kid of node.children) if (sel.has(kid.id)) await createNode(kid, rec.id);
        }
        for (const top of root.children) {
          if (sel.has(top.id)) await createNode(top, null);
        }
        patchMsg(msgId, { createdListId: listId });
      } finally {
        set({ sending: false });
      }
      useDataStore.getState().reload();
      patchMsg(msgId, { status: 'adopted', createdIds: [...idByTemp.values()] });
      return created;
    },

    clear() {
      set({ messages: [], sending: false, pendingMode: 'nl' });
    },
  };
});

function findNode(node: DecomNode, id: string): DecomNode | null {
  if (node.id === id) return node;
  for (const c of node.children) {
    const f = findNode(c, id);
    if (f) return f;
  }
  return null;
}