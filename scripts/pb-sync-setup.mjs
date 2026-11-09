#!/usr/bin/env node
// 创建/更新「多端数据同步」所需的 PocketBase 集合（sync_folders / sync_lists /
// sync_tasks / sync_records），字段与 src-tauri/src/commands/sync.rs 的列一一对应。
//
// 用法（需要 PocketBase 超级管理员账号）：
//   PB_ADMIN_EMAIL=you@example.com PB_ADMIN_PASSWORD=****** node scripts/pb-sync-setup.mjs
//   # 可选：PB_URL（默认 http://62.234.82.11:28193）
//
// 幂等：集合已存在则按本文件的字段定义覆盖（只影响这 4 个集合）。
//
// 权限规则：`user = @request.auth.id` —— 每个用户只能读写自己的行，
// 配合唯一索引 (user, local_id) 保证「同一台设备同一条本地记录只有一行」。

const PB_URL = (process.env.PB_URL || 'http://62.234.82.11:28193').replace(/\/+$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL || '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD || '';

/** 通用字段：谁的数据 + 本地主键 + 软删标记 + 业务时间戳 */
const common = (usersCollectionId) => [
  {
    name: 'user',
    type: 'relation',
    required: true,
    collectionId: usersCollectionId,
    cascadeDelete: false,
    maxSelect: 1,
    minSelect: 0,
  },
  { name: 'local_id', type: 'text', required: true, min: 0, max: 200, pattern: '' },
  { name: 'deleted', type: 'bool', required: false },
  { name: 'updated_at', type: 'number', required: false },
  { name: 'created_at', type: 'number', required: false },
  // PB 的系统时间字段不会自动加：缺了它们 sort=updated / 增量游标都用不了
  { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
  { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
];

const t = (name, required = false) => ({ name, type: 'text', required, min: 0, max: 0, pattern: '' });
const n = (name, required = false) => ({ name, type: 'number', required });

/** 集合定义（顺序 = 建立顺序，父在前便于人工检查） */
const COLLECTIONS = (usersCollectionId) => [
  {
    name: 'sync_folders',
    fields: [
      ...common(usersCollectionId),
      t('name'),
      t('color'),
      n('sort_order'),
    ],
  },
  {
    name: 'sync_lists',
    fields: [
      ...common(usersCollectionId),
      t('name'),
      n('sort_order'),
      n('is_smart'),
      t('icon_type'),
      t('icon_color'),
      t('icon_glyph'),
      t('folder_id'),
    ],
  },
  {
    name: 'sync_tasks',
    fields: [
      ...common(usersCollectionId),
      t('list_id'),
      t('title'),
      t('notes'),
      n('est_pomodoros'),
      t('due_date'),
      t('due_time'),
      t('url'),
      n('urgent'),
      t('repeat'),
      t('lead_remind'),
      t('tags'),
      n('flag'),
      t('priority'),
      n('reminded_at'),
      n('completed'),
      n('completed_at'),
      n('actual_minutes'),
      t('parent_id'),
      n('sort_order'),
    ],
  },
  {
    name: 'sync_records',
    fields: [
      ...common(usersCollectionId),
      t('task_id'),
      t('list_id'),
      n('start_at'),
      n('end_at'),
      n('duration_min'),
      t('phase'),
    ],
  },
];

const RULE = 'user = @request.auth.id';

async function api(path, { method = 'GET', token = '', body } = {}) {
  const res = await fetch(`${PB_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('缺少凭据：请设置 PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD（PocketBase 超级管理员）。');
    console.error('示例：PB_ADMIN_EMAIL=admin@example.com PB_ADMIN_PASSWORD=secret node scripts/pb-sync-setup.mjs');
    process.exit(2);
  }

  console.log(`PocketBase: ${PB_URL}`);
  const auth = await api('/api/collections/_superusers/auth-with-password', {
    method: 'POST',
    body: { identity: EMAIL, password: PASSWORD },
  });
  const token = auth.token;
  console.log('超级管理员登录成功');

  const users = await api('/api/collections/users', { token });
  if (!users?.id) throw new Error('找不到 users 集合');
  console.log(`users 集合 id: ${users.id}`);

  for (const spec of COLLECTIONS(users.id)) {
    // 只建唯一索引：PB 的 `updated` 是系统字段，建集合时还不能进索引表达式
    const indexes = [
      `CREATE UNIQUE INDEX \`idx_${spec.name}_user_local\` ON \`${spec.name}\` (\`user\`, \`local_id\`)`,
    ];
    const wanted = {
      name: spec.name,
      type: 'base',
      fields: spec.fields,
      indexes,
      listRule: RULE,
      viewRule: RULE,
      createRule: RULE,
      updateRule: RULE,
      deleteRule: RULE,
    };

    let existing = null;
    try {
      existing = await api(`/api/collections/${encodeURIComponent(spec.name)}`, { token });
    } catch (e) {
      if (e.status !== 404) throw e;
    }

    if (!existing) {
      const created = await api('/api/collections', { method: 'POST', token, body: wanted });
      console.log(`✓ 已创建 ${created.name}`);
      continue;
    }

    // 覆盖字段定义，但保留 id 等系统字段（按名字去重，spec 里的定义优先）
    const byName = new Map();
    for (const f of existing.fields || []) byName.set(f.name, f);
    for (const f of spec.fields) byName.set(f.name, f);
    const merged = [...byName.values()];
    await api(`/api/collections/${existing.id}`, {
      method: 'PATCH',
      token,
      body: { ...wanted, fields: merged },
    });
    console.log(`✓ 已更新 ${spec.name}`);
  }

  console.log('\n完成。回到应用：设置 → 账号 → 登录，任务/清单/专注记录会自动上传并多端同步。');
  console.log('提示：已登录的其它设备打开应用后会先拉取云端数据，再推送本地改动。');
}

main().catch((e) => {
  console.error('失败：', e.message);
  process.exit(1);
});
