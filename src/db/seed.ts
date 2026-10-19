// 截图还原数据 —— PRD §6.3
//
// 目标派生值（与 S1/S2/S4 对齐）：
//   总专注时间 8小时59分钟 (539min)、本周专注时间 8小时59分钟、今日专注时间 20分钟
//   专注天数 3、完成目标天数 2、每日目标 3小时、总完成任务 0、未读通知 25
// 日期按「今天」动态生成（PRD §5.1 FR-T2 注：实现时按实际日期动态计算）。

import type { Goal, Notification, Task, TaskList, TimerState, User } from '@/types';
import { DEFAULT_SETTINGS } from '@/types';
import type { DBShape } from './idb';
import { emptyDB, defaultTimerState } from './idb';
import { addDays, toDateKey } from '@/lib/date';

const uid = (p: string, n: number) => `${p}_${String(n).padStart(4, '0')}`;

/** 第 dayOffset 天的 HH:MM -> 时间戳 */
function at(dayOffset: number, hhmm: string): number {
  const d = addDays(new Date(), dayOffset);
  const [h, m] = hhmm.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

interface SeedRecord {
  task: 'math' | 'cs408' | 'words' | null;
  day: number;
  from: string;
  to: string;
  min: number;
}

// 今天 20min；昨天 259min；前天 260min —— 合计 539min，2 天达标（>=180min）
const SEED_RECORDS: SeedRecord[] = [
  { task: 'math', day: 0, from: '09:24', to: '09:44', min: 20 },

  { task: 'words', day: -1, from: '07:22', to: '07:41', min: 19 },
  { task: 'words', day: -1, from: '07:44', to: '08:09', min: 25 },
  { task: 'math', day: -1, from: '08:30', to: '08:55', min: 25 },
  { task: 'cs408', day: -1, from: '09:10', to: '09:35', min: 25 },
  { task: 'cs408', day: -1, from: '10:00', to: '10:25', min: 25 },
  { task: 'math', day: -1, from: '14:00', to: '14:25', min: 25 },
  { task: 'math', day: -1, from: '14:30', to: '14:55', min: 25 },
  { task: 'cs408', day: -1, from: '15:10', to: '15:35', min: 25 },
  { task: 'words', day: -1, from: '16:00', to: '16:25', min: 25 },
  { task: 'math', day: -1, from: '19:00', to: '19:40', min: 40 },

  { task: 'math', day: -2, from: '08:00', to: '08:25', min: 25 },
  { task: 'math', day: -2, from: '08:30', to: '08:55', min: 25 },
  { task: 'cs408', day: -2, from: '09:00', to: '09:25', min: 25 },
  { task: 'cs408', day: -2, from: '09:30', to: '09:55', min: 25 },
  { task: 'words', day: -2, from: '10:00', to: '10:25', min: 25 },
  { task: 'words', day: -2, from: '10:30', to: '10:55', min: 25 },
  { task: 'math', day: -2, from: '14:00', to: '14:25', min: 25 },
  { task: 'math', day: -2, from: '14:30', to: '14:55', min: 25 },
  { task: 'cs408', day: -2, from: '15:00', to: '15:25', min: 25 },
  { task: 'cs408', day: -2, from: '15:30', to: '15:55', min: 25 },
  { task: null, day: -2, from: '16:00', to: '16:10', min: 10 },
];

const NOTIF_TEMPLATES: Array<Pick<Notification, 'type' | 'title' | 'body'>> = [
  { type: 'focus_done', title: '番茄完成', body: '你完成了一个专注番茄，休息一下吧。' },
  { type: 'break_done', title: '休息结束', body: '休息结束，开始下一个专注番茄。' },
  { type: 'task_remind', title: '任务到期提醒', body: '你有任务今天到期，记得完成。' },
];

export function buildSeed(opts: { empty?: boolean } = {}): DBShape {
  const db = emptyDB();
  const now = Date.now();

  const user: User = {
    id: 'u_local',
    username: 'honestliu',
    email: 'honestliu@icloud.com',
    avatar_path: '',
    created_at: now,
    updated_at: now,
  };
  db.users.push(user);

  if (opts.empty) {
    db.goals.push({ id: 'default', daily_target_min: DEFAULT_SETTINGS.daily_target_min });
    db.timer_state.push(defaultTimerState());
    return db;
  }

  const list: TaskList = {
    id: 'list_default',
    name: '任务',
    sort_order: 0,
    is_smart: 0,
    icon_type: 'dot',
    icon_color: '',
    icon_glyph: '',
    folder_id: null,
    created_at: now,
    updated_at: now,
  };
  db.lists.push(list);

  const mkTask = (id: string, title: string, est: number, dueOffset: number | null, sort: number): Task => ({
    id,
    list_id: list.id,
    title,
    notes: '',
    est_pomodoros: est,
    due_date: dueOffset === null ? null : toDateKey(addDays(new Date(), dueOffset)),
    due_time: null,
    url: '',
    urgent: 0,
    repeat: 'none',
    lead_remind: 'none',
    tags: [],
    flag: 0,
    priority: 'none',
    reminded_at: null,
    completed: 0,
    completed_at: null,
    sort_order: sort,
    created_at: now,
    updated_at: now,
  });

  // S1：数学真题 7.8 / 408真题 / 单词，到期日 10月13日（截图当日 10月14日 -> 昨天）
  db.tasks.push(mkTask('task_math', '数学真题', 7.8, -1, 0));
  db.tasks.push(mkTask('task_cs408', '408真题', 2, -1, 1));
  db.tasks.push(mkTask('task_words', '单词', 1.5, -1, 2));

  const taskId = { math: 'task_math', cs408: 'task_cs408', words: 'task_words' } as const;

  SEED_RECORDS.forEach((r, i) => {
    const start = at(r.day, r.from);
    db.focus_records.push({
      id: uid('fr', i + 1),
      task_id: r.task ? taskId[r.task] : null,
      list_id: r.task ? list.id : null,
      start_at: start,
      end_at: at(r.day, r.to),
      duration_min: r.min,
      phase: 'focus',
      created_at: start,
    });
  });

  const goal: Goal = { id: 'default', daily_target_min: 180 };
  db.goals.push(goal);

  // S5：铃铛未读角标 25
  for (let i = 0; i < 25; i++) {
    const t = NOTIF_TEMPLATES[i % NOTIF_TEMPLATES.length];
    db.notifications.push({
      id: uid('ntf', i + 1),
      type: t.type,
      title: t.title,
      body: t.body,
      read: 0,
      created_at: now - i * 3600_000,
    });
  }

  db.settings.push({ key: 'daily_target_min', value: String(goal.daily_target_min) });
  db.timer_state.push(defaultTimerState());

  return db;
}

export type { TimerState };
