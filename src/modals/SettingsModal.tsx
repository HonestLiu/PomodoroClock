// 设置弹窗 —— PRD §5.6 FR-S1/S2/S3（截图事实 S5）
// 左侧 7 项导航：账号 / 高级版 / 通用 / 番茄钟 / 清单管理 / 外观 / 关于

import { useEffect, useRef, useState } from 'react';
import {
  Crown, Info, ListChecks, Palette, Settings as SettingsIcon, Sliders, User as UserIcon, X,
} from 'lucide-react';
import { useUiStore, type SettingsTab } from '@/stores/uiStore';
import { useDataStore } from '@/stores/dataStore';
import { useTimerStore } from '@/stores/timerStore';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/api';
import { NOISE_LABELS, type NoiseKind } from '@/lib/noise';
import type { Settings } from '@/types';
import type { ConfirmSpec } from './ConfirmDialog';
import { useI18nStore, useI18n, type ZhKey } from '@/i18n';

const TABS: Array<{ key: SettingsTab; labelKey: ZhKey; icon: typeof UserIcon }> = [
  { key: 'account', labelKey: 'settings.tab.account', icon: UserIcon },
  { key: 'premium', labelKey: 'settings.tab.premium', icon: Crown },
  { key: 'general', labelKey: 'settings.tab.general', icon: SettingsIcon },
  { key: 'pomodoro', labelKey: 'settings.tab.pomodoro', icon: Sliders },
  { key: 'lists', labelKey: 'settings.tab.lists', icon: ListChecks },
  { key: 'appearance', labelKey: 'settings.tab.appearance', icon: Palette },
  { key: 'about', labelKey: 'settings.tab.about', icon: Info },
];

export function SettingsModal({ onConfirm }: { onConfirm(spec: ConfirmSpec): void }) {
  const ui = useUiStore();
  const { user, lists, updateUser, pickAvatar, createList, renameList, deleteList } = useDataStore();
  const setDefaultList = useDataStore((s) => s.setDefaultList);
  const timer = useTimerStore();
  const { t } = useI18n();

  const [settings, setSettings] = useState<Settings>(timer.settings);
  const [username, setUsername] = useState(user?.username ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [editingEmail, setEditingEmail] = useState(false);
  const [editingPwd, setEditingPwd] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [defaultListId, setDefaultListId] = useState<string | null>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);

  // 云同步（PocketBase）
  const cloud = useAuthStore();
  const [syncMode, setSyncMode] = useState<'login' | 'register'>('login');
  const [syncEmail, setSyncEmail] = useState('');
  const [syncPwd, setSyncPwd] = useState('');

  async function doCloudAuth() {
    if (!syncEmail.trim() || !syncPwd) return;
    const ok = syncMode === 'login'
      ? await cloud.login(syncEmail.trim(), syncPwd)
      : await cloud.register(syncEmail.trim(), syncPwd);
    if (ok) setSyncPwd('');
  }

  useEffect(() => {
    void api.get_default_list().then(setDefaultListId);
  }, [ui.settingsTab]);

  useEffect(() => { setSettings(timer.settings); }, [timer.settings]);
  useEffect(() => { setUsername(user?.username ?? ''); setEmail(user?.email ?? ''); }, [user]);

  if (!ui.settingsOpen) return null;

  async function patch<K extends keyof Settings>(key: K, value: Settings[K]) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    const saved = await api.set_setting(key, String(value));
    timer.setSettings(saved);
    // 每日目标同时写入 goals 表（报表日历口径）
    if (key === 'daily_target_min') await api.set_goal(Number(value));
  }

  return (
    <div className="overlay" onClick={() => ui.closeAllOverlays()}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{t('settings.title')}</h2>
          <button className="icon-btn" onClick={() => ui.closeAllOverlays()} aria-label="关闭"><X size={16} /></button>
        </div>

        <div className="settings-body">
          <nav className="settings-nav">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  className={ui.settingsTab === tab.key ? 'active' : ''}
                  onClick={() => ui.setSettingsTab(tab.key)}
                >
                  <Icon size={15} /> {t(tab.labelKey)}
                </button>
              );
            })}
          </nav>

          <div className="settings-pane">
            {/* ── 账号（S5） ── */}
            {ui.settingsTab === 'account' && (
              <>
                <div className="field">
                  <span className="field-label">{t('account.avatar')}</span>
                  <div className="field-body">
                    <span className="avatar-lg">
                      {user?.avatar_path
                        ? <img src={user.avatar_path} alt="" />
                        : (user?.username?.[0]?.toUpperCase() ?? 'U')}
                    </span>
                    <button className="btn" onClick={() => void pickAvatar()}>{t('account.upload')}</button>
                  </div>
                </div>

                <div className="field">
                  <span className="field-label">{t('account.username')}</span>
                  <div className="field-body">
                    <input
                      className="text-input" value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      onBlur={() => { if (username !== user?.username) void updateUser({ username }); }}
                    />
                  </div>
                </div>

                <div className="field">
                  <span className="field-label">{t('account.email')}</span>
                  <div className="field-body">
                    {editingEmail ? (
                      <>
                        <input className="text-input" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
                        <button
                          className="btn primary"
                          onClick={() => { void updateUser({ email }); setEditingEmail(false); }}
                        >
                          保存
                        </button>
                      </>
                    ) : (
                      <>
                        <span style={{ flex: 1, color: 'var(--text-2)' }}>{user?.email || '未绑定'}</span>
                        <button className="btn" onClick={() => setEditingEmail(true)}>{t('account.changeAccount')}</button>
                      </>
                    )}
                  </div>
                </div>

                <div className="field">
                  <span className="field-label">{t('account.password')}</span>
                  <div className="field-body">
                    {editingPwd ? <PasswordForm onDone={() => setEditingPwd(false)} /> : (
                      <>
                        <span style={{ flex: 1, color: 'var(--text-2)' }}>••••••••</span>
                        <button className="btn" onClick={() => setEditingPwd(true)}>{t('account.changePassword')}</button>
                      </>
                    )}
                  </div>
                </div>

                <div className="field" style={{ alignItems: 'flex-start' }}>
                  <span className="field-label">{t('account.accountMgmt')}</span>
                  <div className="field-body" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
                    <button
                      className="btn danger"
                      onClick={() => onConfirm({
                        title: '删除数据',
                        message: '此操作将清空本地全部任务、清单、专注记录、通知与设置，且不可恢复。确定继续吗？',
                        confirmText: '删除全部数据',
                        danger: true,
                        onConfirm: async () => { await api.clear_all_data(); await useDataStore.getState().reload(); },
                      })}
                    >
                      删除数据
                    </button>
                    <button
                      className="btn danger"
                      onClick={() => onConfirm({
                        title: '注销账号',
                        message: '注销将退出当前账号并清理本地数据。确定继续吗？',
                        confirmText: '注销账号',
                        danger: true,
                        onConfirm: async () => { await api.logout(); await useDataStore.getState().reload(); ui.closeAllOverlays(); },
                      })}
                    >
                      注销账号
                    </button>
                  </div>
                </div>

                {/* ── 云同步（PocketBase） ── */}
                <div className="field" style={{ alignItems: 'flex-start' }}>
                  <span className="field-label">{t('sync.title')}</span>
                  <div className="field-body" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
                    <span className="field-hint">{t('sync.desc')}</span>

                    {cloud.status === 'signedIn' && cloud.user ? (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-2)' }}>
                          <span>✓ {cloud.user.email}</span>
                          {cloud.lastSyncAt && (
                            <span>· {t('sync.lastSync', { v: new Date(cloud.lastSyncAt).toLocaleTimeString() })}</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button className="btn" disabled={cloud.syncState === 'busy'} onClick={() => void cloud.pushNow()}>
                            {t('sync.push')}
                          </button>
                          <button className="btn" disabled={cloud.syncState === 'busy'} onClick={() => void cloud.pullNow()}>
                            {t('sync.pull')}
                          </button>
                          <button className="btn" onClick={() => cloud.logout()}>{t('sync.logout')}</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <input
                          className="text-input" type="email" placeholder={t('sync.email')}
                          value={syncEmail} onChange={(e) => setSyncEmail(e.target.value)}
                        />
                        <input
                          className="text-input" type="password" placeholder={t('sync.password')}
                          value={syncPwd} onChange={(e) => setSyncPwd(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') void doCloudAuth(); }}
                        />
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button className="btn primary" disabled={cloud.syncState === 'busy' || !syncEmail || !syncPwd} onClick={() => void doCloudAuth()}>
                            {syncMode === 'login' ? t('sync.login') : t('sync.register')}
                          </button>
                          <button className="btn" onClick={() => setSyncMode(syncMode === 'login' ? 'register' : 'login')}>
                            {syncMode === 'login' ? t('sync.toRegister') : t('sync.toLogin')}
                          </button>
                        </div>
                      </>
                    )}

                    {cloud.syncMessage && (
                      <span
                        className="field-hint"
                        style={{ color: cloud.syncState === 'error' ? 'var(--accent-focus)' : 'var(--text-3)' }}
                      >
                        {cloud.syncMessage}
                      </span>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* ── 高级版（占位，规格定义） ── */}
            {ui.settingsTab === 'premium' && (
              <div style={{ textAlign: 'center', padding: '28px 0' }}>
                <Crown size={34} style={{ color: 'var(--accent-focus)' }} />
                <h3 style={{ margin: '14px 0 6px', fontSize: 17 }}>升级高级版</h3>
                <p className="field-hint" style={{ maxWidth: 380, margin: '0 auto 18px', lineHeight: 1.7 }}>
                  解锁无限清单、云端同步、高级报表与自定义背景。本期为占位页，订阅流程未实现。
                </p>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                  {[['月度', '¥18/月'], ['年度', '¥168/年'], ['终身', '¥398']].map(([n, p]) => (
                    <div key={n} className="panel" style={{ width: 132 }}>
                      <div className="panel-title">{n}</div>
                      <div style={{ fontSize: 20, fontWeight: 600, marginTop: 6, color: 'var(--accent-focus)' }}>{p}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── 通用 ── */}
            {ui.settingsTab === 'general' && (
              <>
                <div className="field">
                  <span className="field-label">语言 / Language</span>
                  <div className="field-body">
                    <select className="text-input" value={settings.language}
                      onChange={(e) => {
                        const lang = e.target.value as Settings['language'];
                        void patch('language', lang);
                        useI18nStore.getState().setLang(lang as 'zh' | 'en');
                      }}>
                      <option value="zh">简体中文</option>
                      <option value="en">English</option>
                    </select>
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">主题</span>
                  <div className="field-body">
                    <select className="text-input" value={settings.theme}
                      onChange={(e) => void patch('theme', e.target.value as Settings['theme'])}>
                      <option value="light">浅色</option>
                      <option value="dark">深色</option>
                    </select>
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">开机自启</span>
                  <div className="field-body">
                    <label className="switch">
                      <input type="checkbox" checked={settings.autostart}
                        onChange={(e) => void patch('autostart', e.target.checked)} />
                      <span className="track" />
                    </label>
                    <span className="field-hint">需 tauri-plugin-autostart（未打包）</span>
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">悬浮番茄小窗</span>
                  <div className="field-body">
                    <label className="switch">
                      <input type="checkbox" checked={ui.floatVisible}
                        onChange={(e) => ui.setFloatVisible(e.target.checked)} />
                      <span className="track" />
                    </label>
                    <span className="field-hint">右下角常驻计时小窗</span>
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">{t('notif.inApp')}</span>
                  <div className="field-body">
                    <label className="switch">
                      <input type="checkbox" checked={settings.notify_enabled}
                        onChange={(e) => void patch('notify_enabled', e.target.checked)} />
                      <span className="track" />
                    </label>
                    <span className="field-hint">铃铛面板内提醒</span>
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">{t('notif.system')}</span>
                  <div className="field-body">
                    <label className="switch">
                      <input type="checkbox" checked={settings.system_notify}
                        onChange={(e) => void patch('system_notify', e.target.checked)} />
                      <span className="track" />
                    </label>
                    <span className="field-hint">桌面系统通知（macOS/Windows）</span>
                  </div>
                </div>
              </>
            )}

            {/* ── 番茄钟 ── */}
            {ui.settingsTab === 'pomodoro' && (
              <>
                <NumField label={t('pomodoro.focusLen')} value={settings.focus_len_min} suffix={t('pomodoro.minutes')} onChange={(v) => void patch('focus_len_min', v)} />
                <NumField label={t('pomodoro.breakLen')} value={settings.break_len_min} suffix={t('pomodoro.minutes')} onChange={(v) => void patch('break_len_min', v)} />
                <NumField label={t('pomodoro.longBreakLen')} value={settings.long_break_len_min} suffix={t('pomodoro.minutes')} onChange={(v) => void patch('long_break_len_min', v)} />
                <NumField label={t('pomodoro.longBreakEvery')} value={settings.long_break_every} suffix={t('pomodoro.poms')} onChange={(v) => void patch('long_break_every', v)} />
                <NumField label={t('pomodoro.dailyGoal')} value={settings.daily_target_min} suffix={t('pomodoro.minutes')} onChange={(v) => void patch('daily_target_min', v)} />
                <div className="field">
                  <span className="field-label">自动开始下一轮</span>
                  <div className="field-body">
                    <label className="switch">
                      <input type="checkbox" checked={settings.auto_start_next}
                        onChange={(e) => void patch('auto_start_next', e.target.checked)} />
                      <span className="track" />
                    </label>
                  </div>
                </div>
              </>
            )}

            {/* ── 清单管理 ── */}
            {ui.settingsTab === 'lists' && (
              <>
                {lists.map((l) => (
                  <div className="field" key={l.id}>
                    <span className="field-label">{l.name}</span>
                    <div className="field-body">
                      <input
                        className="text-input" defaultValue={l.name}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== l.name) void renameList(l.id, v); }}
                      />
                      <button
                        className="btn"
                        style={defaultListId === l.id ? { color: 'var(--accent-focus)', borderColor: 'var(--accent-focus)' } : undefined}
                        onClick={() => void setDefaultList(defaultListId === l.id ? null : l.id).then(() => setDefaultListId(defaultListId === l.id ? null : l.id))}
                      >
                        {defaultListId === l.id ? '已设默认' : '设为默认'}
                      </button>
                      <button
                        className="btn danger"
                        onClick={() => onConfirm({
                          title: '删除清单',
                          message: `确定删除清单「${l.name}」吗？清单内任务将变为未指定清单。`,
                          confirmText: '删除',
                          danger: true,
                          onConfirm: async () => { await deleteList(l.id); },
                        })}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
                <div className="field">
                  <span className="field-label">新建清单</span>
                  <div className="field-body">
                    <input
                      className="text-input" placeholder="清单名称" value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                    />
                    <button
                      className="btn primary"
                      onClick={() => { const v = newListName.trim(); if (v) { void createList(v); setNewListName(''); } }}
                    >
                      创建
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* ── 外观 ── */}
            {ui.settingsTab === 'appearance' && (
              <>
                <div className="field">
                  <span className="field-label">主题</span>
                  <div className="field-body">
                    <select className="text-input" value={settings.theme}
                      onChange={(e) => void patch('theme', e.target.value as Settings['theme'])}>
                      <option value="light">浅色</option>
                      <option value="dark">深色</option>
                    </select>
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">专注背景</span>
                  <div className="field-body">
                    <select className="text-input" value={settings.wallpaper}
                      onChange={(e) => void patch('wallpaper', e.target.value)}>
                      <option value="waves">海浪</option>
                      {settings.wallpaper.startsWith('custom:') && <option value={settings.wallpaper}>自定义图片</option>}
                    </select>
                    <input
                      ref={bgInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => {
                          if (typeof reader.result === 'string') {
                            void patch('wallpaper', 'custom:' + reader.result);
                          }
                        };
                        reader.readAsDataURL(file);
                        e.target.value = '';
                      }}
                    />
                    <button className="btn" onClick={() => bgInputRef.current?.click()}>上传</button>
                    {settings.wallpaper.startsWith('custom:') && (
                      <button className="btn" onClick={() => void patch('wallpaper', 'waves')}>恢复默认</button>
                    )}
                    <span className="field-hint">支持 JPG / PNG / SVG</span>
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">白噪音</span>
                  <div className="field-body">
                    <select className="text-input" value={settings.noise}
                      onChange={(e) => void patch('noise', e.target.value)}>
                      {(Object.keys(NOISE_LABELS) as NoiseKind[]).map((k) => (
                        <option key={k} value={k}>{NOISE_LABELS[k]}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">专注时播放</span>
                  <div className="field-body">
                    <label className="switch">
                      <input type="checkbox" checked={settings.noise_on_focus}
                        onChange={(e) => void patch('noise_on_focus', e.target.checked)} />
                      <span className="track" />
                    </label>
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">休息时播放</span>
                  <div className="field-body">
                    <label className="switch">
                      <input type="checkbox" checked={settings.noise_on_break}
                        onChange={(e) => void patch('noise_on_break', e.target.checked)} />
                      <span className="track" />
                    </label>
                  </div>
                </div>
              </>
            )}

            {/* ── 关于 ── */}
            {ui.settingsTab === 'about' && (
              <div style={{ padding: '10px 0' }}>
                <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>FocusPomodoro</h3>
                <p className="field-hint" style={{ lineHeight: 1.8, margin: 0 }}>
                  版本 1.0.0 · 番茄钟 × 任务管理桌面应用<br />
                  技术栈：Tauri 2.x + React 19 + TypeScript + Vite<br />
                  数据存储：本地优先（SQLite / IndexedDB）<br />
                  本构建在离线环境下完成，未接入云端与更新服务。
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function NumField({
  label, value, suffix, onChange,
}: { label: string; value: number; suffix: string; onChange(v: number): void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => { setV(String(value)); }, [value]);
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="field-body">
        <input
          className="num-input" type="number" min={0} value={v}
          onChange={(e) => setV(e.target.value)}
          onBlur={() => { const n = Number(v); if (!Number.isNaN(n) && n !== value) onChange(n); }}
        />
        <span className="field-hint">{suffix}</span>
      </div>
    </div>
  );
}

function PasswordForm({ onDone }: { onDone(): void }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const mismatch = a.length > 0 && b.length > 0 && a !== b;
  return (
    <>
      <input className="text-input" type="password" placeholder="新密码" value={a} onChange={(e) => setA(e.target.value)} autoFocus />
      <input className="text-input" type="password" placeholder="确认密码" value={b} onChange={(e) => setB(e.target.value)} />
      <button className="btn primary" disabled={!a || mismatch} onClick={onDone}>保存</button>
      <button className="btn" onClick={onDone}>取消</button>
    </>
  );
}
