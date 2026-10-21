// 设置弹窗 —— PRD §5.6 FR-S1/S2/S3（截图事实 S5）
// 左侧 7 项导航：账号 / 高级版 / 通用 / 番茄钟 / 清单管理 / 外观 / 关于
//
// 账号页（S5）＝「软件账号」页：账号即 PocketBase 账号，一页两态——
// 未登录：居中登录/注册卡（邮箱、密码[、确认密码]）＋ 下方「本地数据」；
// 已登录：同一张卡变账号卡（头像/首字母、用户名/邮箱、已登录徽标、同步区、退出登录）＋「本地数据」。
// 头像来自 PocketBase 的 users.avatar 文件字段（点头像更换，可移除）；其余资料（昵称等）不在此编辑。

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera, Crown, GripVertical, Info, ListChecks,
  Palette, Settings as SettingsIcon, Sliders, Trash2, User as UserIcon, X,
} from 'lucide-react';
import { useUiStore, type SettingsTab } from '@/stores/uiStore';
import { useDataStore } from '@/stores/dataStore';
import { useTimerStore } from '@/stores/timerStore';
import { useAuthStore } from '@/stores/authStore';
import { pendingCounts, dataSyncError, forceFullSync } from '@/lib/syncData';
import { api } from '@/api';
import { pbAvatarFileUrl } from '@/lib/pb';
import { listAggregate } from '@/lib/derive';
import { resolveListIconColor } from '@/lib/listIcon';
import { formatMinutesShort } from '@/lib/date';
import { NOISE_LABELS, type NoiseKind } from '@/lib/noise';
import { aiConfig, testConnection } from '@/lib/ai/providers';
import type { Settings, StartupPage } from '@/types';
import type { ConfirmSpec } from './ConfirmDialog';
import { useI18nStore, useI18n, type ZhKey } from '@/i18n';
import { useModalA11y } from '@/components/useModalA11y';

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
  const timer = useTimerStore();
  const { t } = useI18n();
  const modalRef = useRef<HTMLDivElement>(null);

  const [settings, setSettings] = useState<Settings>(timer.settings);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState('');
  const bgInputRef = useRef<HTMLInputElement>(null);

  useModalA11y(ui.settingsOpen, () => ui.closeAllOverlays(), modalRef, '.settings-nav button.active');

  useEffect(() => { setSettings(timer.settings); }, [timer.settings]);
  if (!ui.settingsOpen) return null;

  async function patch<K extends keyof Settings>(key: K, value: Settings[K]) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    const saved = await api.set_setting(key, String(value));
    timer.setSettings(saved);
    // 每日目标同时写入 goals 表（报表日历口径）
    if (key === 'daily_target_min') await api.set_goal(Number(value));
  }

  /** AI 连通性测试：用当前表单配置发一条最小请求，给出可行动结论 */
  async function runAiTest() {
    setTesting(true); setTestMsg('');
    const r = await testConnection(aiConfig(settings));
    setTestMsg(r.key === 'ok'
      ? t('ai.test.ok')
      : `${t(r.key)}${r.hint ? ` · ${r.hint}` : ''}`);
    setTesting(false);
  }

  const activeTab = TABS.find((x) => x.key === ui.settingsTab) ?? TABS[0];
  const activeIdx = TABS.indexOf(activeTab);

  /** 方向键在 7 个 tab 之间移动（role=tablist 的键盘约定） */
  function onNavKey(e: React.KeyboardEvent) {
    const delta = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1
      : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = TABS[(activeIdx + delta + TABS.length) % TABS.length];
    ui.setSettingsTab(next.key);
    const el = document.getElementById(`settings-tab-${next.key}`);
    el?.focus();
  }

  return (
    <div className="overlay" onClick={() => ui.closeAllOverlays()}>
      <div
        className="modal settings-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="settings-title">{t('settings.title')}</h2>
          <button className="icon-btn" onClick={() => ui.closeAllOverlays()} aria-label={t('common.close')}>
            <X size={16} aria-hidden />
          </button>
        </div>

        <div className="settings-body">
          <nav className="settings-nav" role="tablist" aria-label={t('settings.title')} onKeyDown={onNavKey}>
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const selected = ui.settingsTab === tab.key;
              return (
                <button
                  key={tab.key}
                  id={`settings-tab-${tab.key}`}
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`settings-pane-${tab.key}`}
                  tabIndex={selected ? 0 : -1}
                  className={selected ? 'active' : ''}
                  onClick={() => ui.setSettingsTab(tab.key)}
                >
                  <Icon size={15} aria-hidden /> {t(tab.labelKey)}
                </button>
              );
            })}
          </nav>

          <div
            className="settings-pane"
            role="tabpanel"
            id={`settings-pane-${activeTab.key}`}
            aria-labelledby={`settings-tab-${activeTab.key}`}
          >
            {/* ── 账号（S5）：软件账号 = PocketBase 账号，一页两态 ── */}
            {ui.settingsTab === 'account' && <AccountPane onConfirm={onConfirm} />}

            {/* ── 高级版（占位，规格定义） ── */}
            {ui.settingsTab === 'premium' && (
              <div style={{ textAlign: 'center', padding: '28px 0' }}>
                <Crown size={34} style={{ color: 'var(--accent-focus)' }} aria-hidden />
                <h3 style={{ margin: '14px 0 6px', fontSize: 17 }}>{t('premium.upgrade')}</h3>
                <p className="field-hint" style={{ maxWidth: 380, margin: '0 auto 18px', lineHeight: 1.7 }}>
                  {t('premium.desc')}
                </p>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                  {([
                    [t('premium.monthly'), t('premium.priceMonthly')],
                    [t('premium.yearly'), t('premium.priceYearly')],
                    [t('premium.lifetime'), t('premium.priceLifetime')],
                  ] as const).map(([name, price]) => (
                    <div key={name} className="panel" style={{ width: 132 }}>
                      <div className="panel-title">{name}</div>
                      <div style={{ fontSize: 20, fontWeight: 600, marginTop: 6, color: 'var(--accent-focus)' }}>{price}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── 通用 ── */}
            {ui.settingsTab === 'general' && (
              <>
                <div className="field">
                  <span className="field-label">{t('appearance.lang')}</span>
                  <div className="field-body">
                    <select
                      className="text-input" value={settings.language} aria-label={t('appearance.lang')}
                      onChange={(e) => {
                        const lang = e.target.value as Settings['language'];
                        void patch('language', lang);
                        useI18nStore.getState().setLang(lang as 'zh' | 'en');
                      }}
                    >
                      <option value="zh">简体中文</option>
                      <option value="en">English</option>
                    </select>
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">{t('appearance.theme')}</span>
                  <div className="field-body">
                    <select
                      className="text-input" value={settings.theme} aria-label={t('appearance.theme')}
                      onChange={(e) => void patch('theme', e.target.value as Settings['theme'])}
                    >
                      <option value="light">{t('appearance.light')}</option>
                      <option value="dark">{t('appearance.dark')}</option>
                    </select>
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">{t('general.autostart')}</span>
                  <div className="field-body">
                    <label className="switch">
                      <input
                        type="checkbox" checked={settings.autostart} aria-label={t('general.autostart')}
                        onChange={(e) => void patch('autostart', e.target.checked)}
                      />
                      <span className="track" />
                    </label>
                    <span className="field-hint">{t('general.autostartHint')}</span>
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">{t('general.float')}</span>
                  <div className="field-body">
                    <label className="switch">
                      <input
                        type="checkbox" checked={ui.floatVisible} aria-label={t('general.float')}
                        onChange={(e) => ui.setFloatVisible(e.target.checked)}
                      />
                      <span className="track" />
                    </label>
                    <span className="field-hint">{t('general.floatHint')}</span>
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">{t('general.startupPage')}</span>
                  <div className="field-body">
                    <select
                      className="text-input"
                      value={settings.startup_page}
                      aria-label={t('general.startupPage')}
                      onChange={(e) => void patch('startup_page', e.target.value as StartupPage)}
                    >
                      <option value="timer">{t('general.startup.timer')}</option>
                      <option value="today">{t('nav.today')}</option>
                      <option value="tomorrow">{t('nav.tomorrow')}</option>
                      <option value="week">{t('nav.week')}</option>
                      <option value="scheduled">{t('nav.scheduled')}</option>
                      <option value="tasks">{t('nav.tasks')}</option>
                      <option value="completed">{t('nav.completed')}</option>
                      <option value="records">{t('nav.records')}</option>
                      <option value="calendar">{t('nav.calendar')}</option>
                      <option value="countdown">{t('nav.countdown')}</option>
                      <option value="ai">{t('nav.ai')}</option>
                    </select>
                    <span className="field-hint">{t('general.startupPageHint')}</span>
                  </div>
                </div>

                {/* AI 服务（docs/05-modules/ai.md）：Claude / OpenAI 两种格式可配，Key 仅本地存 */}
                <div className="section-title">{t('ai.settingsTitle')}</div>
                <div className="field">
                  <span className="field-label">{t('ai.provider')}</span>
                  <div className="field-body">
                    <select
                      className="text-input"
                      value={settings.ai_provider}
                      aria-label={t('ai.provider')}
                      onChange={(e) => void patch('ai_provider', e.target.value as Settings['ai_provider'])}
                    >
                      <option value="none">{t('ai.provider.none')}</option>
                      <option value="claude">{t('ai.provider.claude')}</option>
                      <option value="openai">{t('ai.provider.openai')}</option>
                    </select>
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">{t('ai.model')}</span>
                  <div className="field-body">
                    <input className="text-input" value={settings.ai_model} aria-label={t('ai.model')}
                      placeholder="claude-sonnet-5-5 / gpt-4o-mini"
                      onChange={(e) => void patch('ai_model', e.target.value)} />
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">{t('ai.baseUrl')}</span>
                  <div className="field-body">
                    <input className="text-input" value={settings.ai_base_url} aria-label={t('ai.baseUrl')}
                      placeholder="https://api.anthropic.com"
                      onChange={(e) => void patch('ai_base_url', e.target.value)} />
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">{t('ai.apiKey')}</span>
                  <div className="field-body">
                    <input className="text-input" type="password" autoComplete="off"
                      value={settings.ai_api_key} aria-label={t('ai.apiKey')}
                      placeholder="sk-… / sk-ant-…"
                      onChange={(e) => void patch('ai_api_key', e.target.value)} />
                    <span className="field-hint">{t('ai.apiKeyHint')}</span>
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">{t('ai.model')}</span>
                  <div className="field-body">
                    <span className="field-hint">{t('ai.modelHint')}</span>
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">{t('ai.test')}</span>
                  <div className="field-body">
                    <button type="button" className="btn" disabled={testing} onClick={() => void runAiTest()}>
                      {t('ai.test')}
                    </button>
                    {testMsg && (
                      <span className="field-hint" style={{ color: 'var(--text-2)' }}>{testMsg}</span>
                    )}
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">{t('notif.inApp')}</span>
                  <div className="field-body">
                    <label className="switch">
                      <input
                        type="checkbox" checked={settings.notify_enabled} aria-label={t('notif.inApp')}
                        onChange={(e) => void patch('notify_enabled', e.target.checked)}
                      />
                      <span className="track" />
                    </label>
                    <span className="field-hint">{t('notif.inAppHint')}</span>
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">{t('notif.system')}</span>
                  <div className="field-body">
                    <label className="switch">
                      <input
                        type="checkbox" checked={settings.system_notify} aria-label={t('notif.system')}
                        onChange={(e) => void patch('system_notify', e.target.checked)}
                      />
                      <span className="track" />
                    </label>
                    <span className="field-hint">{t('notif.systemHint')}</span>
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
                  <span className="field-label">{t('pomodoro.autoNext')}</span>
                  <div className="field-body">
                    <label className="switch">
                      <input
                        type="checkbox" checked={settings.auto_start_next} aria-label={t('pomodoro.autoNext')}
                        onChange={(e) => void patch('auto_start_next', e.target.checked)}
                      />
                      <span className="track" />
                    </label>
                  </div>
                </div>
              </>
            )}

            {/* ── 清单管理 ── */}
            {ui.settingsTab === 'lists' && <ListsPane onConfirm={onConfirm} />}

            {/* ── 外观 ── */}
            {ui.settingsTab === 'appearance' && (
              <>
                <div className="field">
                  <span className="field-label">{t('appearance.theme')}</span>
                  <div className="field-body">
                    <select
                      className="text-input" value={settings.theme} aria-label={t('appearance.theme')}
                      onChange={(e) => void patch('theme', e.target.value as Settings['theme'])}
                    >
                      <option value="light">{t('appearance.light')}</option>
                      <option value="dark">{t('appearance.dark')}</option>
                    </select>
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">{t('appearance.wallpaper')}</span>
                  <div className="field-body">
                    <select
                      className="text-input" value={settings.wallpaper} aria-label={t('appearance.wallpaper')}
                      onChange={(e) => void patch('wallpaper', e.target.value)}
                    >
                      <option value="waves">{t('noise.waves')}</option>
                      {settings.wallpaper.startsWith('custom:') && <option value={settings.wallpaper}>{t('appearance.custom')}</option>}
                    </select>
                    <input
                      ref={bgInputRef}
                      type="file"
                      accept="image/*"
                      aria-label={t('appearance.upload')}
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
                    <button className="btn" onClick={() => bgInputRef.current?.click()}>{t('appearance.upload')}</button>
                    {settings.wallpaper.startsWith('custom:') && (
                      <button className="btn" onClick={() => void patch('wallpaper', 'waves')}>{t('appearance.reset')}</button>
                    )}
                    <span className="field-hint">{t('appearance.wallpaperHint')}</span>
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">{t('appearance.noise')}</span>
                  <div className="field-body">
                    {/* 点一下直接弹选择窗（含音量滑杆与封面列表），不再用下拉框 */}
                    <button
                      className="btn" aria-haspopup="dialog"
                      onClick={() => ui.openNoise(true)}
                    >
                      {t('noise.pick')}
                    </button>
                    <span className="field-hint">
                      {NOISE_LABELS[settings.noise as NoiseKind] ?? NOISE_LABELS.waves}
                      {' · '}{Math.round(settings.noise_volume * 100)}%
                    </span>
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">{t('appearance.noiseFocus')}</span>
                  <div className="field-body">
                    <label className="switch">
                      <input
                        type="checkbox" checked={settings.noise_on_focus} aria-label={t('appearance.noiseFocus')}
                        onChange={(e) => void patch('noise_on_focus', e.target.checked)}
                      />
                      <span className="track" />
                    </label>
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">{t('appearance.noiseBreak')}</span>
                  <div className="field-body">
                    <label className="switch">
                      <input
                        type="checkbox" checked={settings.noise_on_break} aria-label={t('appearance.noiseBreak')}
                        onChange={(e) => void patch('noise_on_break', e.target.checked)}
                      />
                      <span className="track" />
                    </label>
                  </div>
                </div>
              </>
            )}

            {/* ── 关于 ── */}
            {ui.settingsTab === 'about' && <AboutPane />}
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
          className="num-input" type="number" min={0} value={v} aria-label={label}
          onChange={(e) => setV(e.target.value)}
          onBlur={() => { const n = Number(v); if (!Number.isNaN(n) && n !== value) onChange(n); }}
        />
        <span className="field-hint">{suffix}</span>
      </div>
    </div>
  );
}

/** 账号页（S5）：软件账号 = PocketBase 账号。未登录→登录/注册卡；已登录→账号卡 + 同步区。 */
function AccountPane({ onConfirm }: { onConfirm(spec: ConfirmSpec): void }) {
  const { t } = useI18n();
  const cloud = useAuthStore();
  const signedIn = cloud.status === 'signedIn';
  const busy = cloud.syncState === 'busy';

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [nick, setNick] = useState('');
  // 数据同步（任务/清单/专注记录）状态：待上传条数 + 最近一次失败原因
  const [dataPending, setDataPending] = useState(0);
  const [dataErr, setDataErr] = useState('');
  // 已登录：就地编辑资料（昵称；邮箱 PB 不允许改）
  // 已登录：「编辑资料」表单（昵称 + 头像 + 修改密码 三合一）
  const [editing, setEditing] = useState(false);
  const [nickDraft, setNickDraft] = useState('');
  const [email, setEmail] = useState('');
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  // 已登录：就地修改密码（真实写 PB 账号）
  const [editingPwd, setEditingPwd] = useState(false);
  const [op, setOp] = useState('');
  const [np1, setNp1] = useState('');
  const [np2, setNp2] = useState('');
  const pwdMismatch = np2.length > 0 && np1 !== np2;
  // 退出登录后留在账号页，用一行提示代替「整个弹层消失」
  const [notice, setNotice] = useState('');
  // 头像：点圆形按钮 -> 隐藏的 file input（PB users.avatar 文件字段）
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const avatarName = typeof cloud.user?.avatar === 'string' ? cloud.user.avatar : '';
  const avatarUrl = cloud.user && avatarName ? pbAvatarFileUrl(cloud.user, 96) : '';

  const mismatch = mode === 'register' && pwd2.length > 0 && pwd !== pwd2;
  const canSubmit = !!email.trim() && !!pwd && !mismatch && !busy;

  /** 用户名回退：PB 的 name 可能为空 → 用 email 的 @ 前缀 */
  const email0 = cloud.user?.email ?? '';
  const name = (cloud.user?.name ?? '').trim() || email0.split('@')[0] || t('account.untitled');
  const initial = (name || '?')[0]?.toUpperCase() ?? '?';

  useEffect(() => {
    if (!signedIn) {
      setDataPending(0);
      setDataErr('');
      return;
    }
    let alive = true;
    const tick = async () => {
      try {
        const c = await pendingCounts();
        if (alive) setDataPending(c.dirty + c.tombstones);
      } catch {
        /* 读数失败不影响主流程 */
      }
      if (alive) setDataErr(dataSyncError());
    };
    void tick();
    const id = window.setInterval(() => void tick(), 1500);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [signedIn]);

  const syncLabel = busy
    ? t('sync.syncing')
    : cloud.lastSyncAt
      ? t('sync.lastSync', { v: new Date(cloud.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
      : t('sync.ready');

  async function submit() {
    if (!canSubmit) return;
    setNotice('');
    const ok = mode === 'login'
      ? await cloud.login(email.trim(), pwd)
      : await cloud.register(email.trim(), pwd, nick.trim());
    if (ok) { setPwd(''); setPwd2(''); setNick(''); }
  }

  /** 已登录改密码：交给 authStore（内部走 PB，<8 位/不一致各有提示） */
  async function savePwd() {
    if (!op || !np1 || pwdMismatch) return;
    // PB 的 users 集合强制校验 oldPassword，必须带当前密码
    const ok = await cloud.changePassword(op, np1);
    if (ok) { setOp(''); setNp1(''); setNp2(''); setEditingPwd(false); }
  }

  /** 进入「编辑资料」：回填昵称，折叠态密码子表单一并展开 */
  function openEdit() {
    setNickDraft((cloud.user?.name ?? '').trim());
    setEditing(true);
  }

  /** 已登录改昵称：写 PB users.name（32 字符上限与非法值由 authStore 校验并播报） */
  async function saveProfile() {
    const v = nickDraft.trim();
    if (v === (cloud.user?.name ?? '').trim()) { closeEdit(); return; }
    const ok = await cloud.updateNickname(v);
    if (ok) closeEdit();
  }

  function closeEdit() {
    setEditing(false);
    setNickDraft('');
    setEditingPwd(false);
    setOp(''); setNp1(''); setNp2('');
  }

  /** 退出登录：可逆的低风险操作，不二次确认；也不关闭设置弹层（原地切回登录卡并提示） */
  async function signOut() {
    closeEdit();
    setMode('login'); setEmail(''); setPwd(''); setPwd2('');
    setNotice(t('account.signedOut'));
    cloud.logout();
    await api.logout();
    await useDataStore.getState().reload();
  }

  /** 选图 -> 上传。无论成败都清空 input.value，否则同一张图第二次不触发 change */
  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try { await cloud.uploadAvatar(file); } finally { setUploading(false); }
  }

  async function removeAvatar() {
    setUploading(true);
    try { await cloud.removeAvatar(); } finally { setUploading(false); }
  }

  /** 忘记密码：只在真正发信成功时看到成功文案（authStore 已写好 syncMessage） */
  async function forgot() {
    if (!email.trim()) return;
    setNotice('');
    await cloud.sendResetEmail(email.trim());
  }

  return (
    <>
      {signedIn ? (
        <>
          {/* ── 账号：只读身份卡（点头像/按钮进入「编辑资料」） ── */}
          <div className="acct-section">
            <div className="section-title">{t('account.identity')}</div>
            <div className="acct-profile">
              <button
                type="button"
                className="acct-avatar"
                onClick={openEdit}
                aria-label={t('account.editProfile')}
                title={t('account.editProfile')}
              >
                {avatarUrl ? <img src={avatarUrl} alt="" /> : initial}
                <span className="acct-avatar-edit" aria-hidden><Camera size={13} aria-hidden /></span>
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg"
                hidden
                onChange={(e) => void onPickAvatar(e)}
              />
              <div className="acct-id">
                <div className="acct-name-row">
                  <span className="acct-name" title={name}>{name}</span>
                </div>
                <span className="acct-email" title={email0}>{email0}</span>
              </div>
              <div className="acct-side">
                <span className="acct-badge">
                  <span className="acct-dot" aria-hidden />
                  {t('account.signedIn')}
                </span>
                <button
                  type="button" className="btn"
                  aria-expanded={editing}
                  onClick={() => (editing ? closeEdit() : openEdit())}
                >
                  {t('account.editProfile')}
                </button>
              </div>
            </div>
          </div>

          {/* ── 编辑资料：昵称 + 头像 + 修改密码（统一在这里，不再散落在各处） ── */}
          <div className="acct-section">
            <div className="section-title">{t('account.editSection')}</div>
            {!editing ? (
              <div className="field">
                <span className="field-label">{t('account.editProfile')}</span>
                <div className="field-body acct-row-actions">
                  <button className="btn" onClick={openEdit}>{t('account.editProfile')}</button>
                  <span className="field-hint">{t('account.editHint')}</span>
                </div>
              </div>
            ) : (
              <div className="acct-form" role="group" aria-label={t('account.editSection')}>
                <div className="field">
                  <span className="field-label">{t('account.nickname')}</span>
                  <div className="field-body">
                    <input
                      className="text-input" type="text" maxLength={32} autoComplete="nickname"
                      value={nickDraft} aria-label={t('account.nickname')} placeholder={t('account.nicknameHint')}
                      onChange={(e) => setNickDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void saveProfile();
                        if (e.key === 'Escape') closeEdit();
                      }}
                    />
                  </div>
                </div>

                <div className="field">
                  <span className="field-label">{t('account.avatarSection')}</span>
                  <div className="field-body acct-row-actions">
                    <span className="acct-avatar-sm" aria-hidden>
                      {avatarUrl ? <img src={avatarUrl} alt="" /> : initial}
                    </span>
                    <button
                      type="button" className="acct-link"
                      disabled={uploading}
                      onClick={() => avatarInputRef.current?.click()}
                    >
                      {uploading ? t('account.avatarUploading') : t('account.avatarChange')}
                    </button>
                    {avatarName && (
                      <button
                        type="button" className="acct-link"
                        disabled={uploading}
                        onClick={() => void removeAvatar()}
                      >
                        {t('account.avatarRemove')}
                      </button>
                    )}
                    <span className="field-hint">{t('account.avatarHint')}</span>
                  </div>
                </div>

                <div className="field">
                  <span className="field-label">{t('account.passwordSection')}</span>
                  <div className="field-body acct-row-actions">
                    <button
                      type="button" className="btn"
                      aria-expanded={editingPwd}
                      onClick={() => setEditingPwd(!editingPwd)}
                    >
                      {t('sync.changePwd')}
                    </button>
                  </div>
                </div>

                {editingPwd && (
                  <div className="acct-form" style={{ border: 'none', padding: '0 0 6px' }}>
                    <div className="field">
                      <span className="field-label">{t('sync.oldPwd')}</span>
                      <div className="field-body">
                        <input
                          className="text-input" type="password" autoComplete="current-password"
                          value={op} aria-label={t('sync.oldPwd')}
                          onChange={(e) => setOp(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="field">
                      <span className="field-label">{t('sync.newPwd')}</span>
                      <div className="field-body">
                        <input
                          className="text-input" type="password" autoComplete="new-password"
                          value={np1} aria-label={t('sync.newPwd')}
                          onChange={(e) => setNp1(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="field">
                      <span className="field-label">{t('sync.passwordConfirm')}</span>
                      <div className="field-body">
                        <input
                          className="text-input" type="password" autoComplete="new-password"
                          value={np2} aria-label={t('sync.passwordConfirm')}
                          onChange={(e) => setNp2(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && np1 && !pwdMismatch) void savePwd(); }}
                        />
                      </div>
                    </div>
                    {pwdMismatch && <span className="acct-err" role="alert">{t('sync.pwdMismatch')}</span>}
                    <div className="acct-form-actions">
                      <button
                        className="btn primary"
                        disabled={!op || !np1 || pwdMismatch || busy}
                        onClick={() => void savePwd()}
                      >
                        {t('sync.changePwd')}
                      </button>
                      <button
                        className="btn"
                        onClick={() => { setEditingPwd(false); setOp(''); setNp1(''); setNp2(''); }}
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                )}

                <p className="acct-hint">{t('account.emailLocked')}</p>
                <div className="acct-form-actions">
                  <button className="btn primary" disabled={busy} onClick={() => void saveProfile()}>
                    {t('common.save')}
                  </button>
                  <button className="btn" onClick={closeEdit}>{t('common.cancel')}</button>
                </div>
              </div>
            )}
          </div>

          {/* ── 账号操作 ── */}
          <div className="acct-section">
            <div className="section-title">{t('account.actionsSection')}</div>
            <div className="field">
              <span className="field-label">{t('account.signOut')}</span>
              <div className="field-body acct-row-actions">
                <button className="btn" onClick={() => void signOut()}>
                  {t('account.signOut')}
                </button>
                <span className="field-hint">{t('account.signedOut')}</span>
              </div>
            </div>
          </div>

          {/* ── 同步 ── */}
          <div className="acct-section">
            <div className="section-title">{t('sync.section')}</div>
            <div className="field">
              <span className="field-label">{t('sync.section')}</span>
              <div className="field-body acct-row-actions">
                <span className={`acct-readout${cloud.syncState === 'error' ? ' acct-err' : ''}`} role="status" aria-live="polite">
                  {cloud.syncMessage || syncLabel}
                  {!cloud.syncMessage && dataPending > 0 ? ` · ${t('sync.pending', { v: dataPending })}` : ''}
                </span>
              </div>
            </div>
            <div className="field">
              <span className="field-label">{t('sync.push')}</span>
              <div className="field-body acct-row-actions">
                <button className="btn" disabled={busy} onClick={() => void cloud.pushNow()}>{t('sync.push')}</button>
                <button className="btn" disabled={busy} onClick={() => void cloud.pullNow()}>{t('sync.pull')}</button>
              </div>
            </div>
            <div className="field">
              <span className="field-label">{t('sync.dataLabel')}</span>
              <div className="field-body acct-row-actions">
                <button className="btn" disabled={busy} onClick={() => void forceFullSync()}>{t('sync.full')}</button>
                <span className={`field-hint${dataErr ? ' acct-err' : ''}`} role="status" aria-live="polite">
                  {dataErr || (dataPending > 0 ? t('sync.pending', { v: dataPending }) : t('sync.none'))}
                </span>
              </div>
            </div>
            <p className="acct-hint">{t('sync.autoHint')}</p>
          </div>
        </>
      ) : (
        /* ── 未登录：登录/注册，融入同一套 field 栅格 ── */
        <div className="acct-section">
          <div className="section-title">{t('account.title')}</div>
          <p className="acct-blurb">{t('account.subtitle')}</p>

          {mode === 'register' && (
            <div className="field">
              <span className="field-label">{t('account.nickname')}</span>
              <div className="field-body">
                <input
                  className="text-input" type="text" maxLength={32} autoComplete="nickname"
                  value={nick} aria-label={t('account.nickname')} placeholder={t('account.nicknameHint')}
                  onChange={(e) => setNick(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
                />
              </div>
            </div>
          )}
          <div className="field">
            <span className="field-label">{t('sync.email')}</span>
            <div className="field-body">
              <input
                className="text-input" type="email" autoComplete="username"
                value={email} aria-label={t('sync.email')} placeholder="you@example.com"
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <span className="field-label">{t('sync.password')}</span>
            <div className="field-body">
              <input
                className="text-input" type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={pwd} aria-label={t('sync.password')}
                onChange={(e) => setPwd(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
              />
            </div>
          </div>
          {mode === 'register' && (
            <div className="field">
              <span className="field-label">{t('sync.passwordConfirm')}</span>
              <div className="field-body">
                <input
                  className="text-input" type="password" autoComplete="new-password"
                  value={pwd2} aria-label={t('sync.passwordConfirm')}
                  onChange={(e) => setPwd2(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
                />
              </div>
            </div>
          )}
          {mismatch && <span className="acct-err" role="alert">{t('sync.pwdMismatch')}</span>}

          <div className="field">
            <span className="field-label" />
            <div className="field-body acct-row-actions">
              <button className="btn primary" disabled={!canSubmit} onClick={() => void submit()}>
                {busy ? t('sync.syncing') : mode === 'login' ? t('sync.login') : t('sync.register')}
              </button>
              <button
                type="button" className="acct-link"
                onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setPwd2(''); }}
              >
                {mode === 'login' ? t('account.switchToRegister') : t('account.switchToLogin')}
              </button>
              {mode === 'login' && (
                <button type="button" className="acct-link" onClick={() => void forgot()}>
                  {t('sync.forgot')}
                </button>
              )}
            </div>
          </div>

          {notice && !cloud.syncMessage && (
            <div className="login-msg info" role="status">{notice}</div>
          )}
          {cloud.syncMessage && (
            <div className={cloud.syncState === 'error' ? 'login-msg error' : 'login-msg ok'} role="status">
              {cloud.syncMessage}
            </div>
          )}
        </div>
      )}

      {/* 本地数据：两态都有，删除的是本地库 */}
      <div className="acct-section">
        <div className="section-title">{t('account.localData')}</div>
        <div className="field">
          <span className="field-label">{t('account.deleteData')}</span>
          <div className="field-body acct-row-actions">
            <button
              className="btn danger"
              onClick={() => onConfirm({
                title: t('confirm.deleteDataTitle'),
                message: signedIn
                  ? `${t('confirm.deleteDataMsg')}\n${t('account.deleteDataCloudWarn')}`
                  : t('confirm.deleteDataMsg'),
                confirmText: t('confirm.deleteAll'),
                danger: true,
                onConfirm: async () => { await api.clear_all_data(); await useDataStore.getState().reload(); },
              })}
            >
              {t('account.deleteData')}
            </button>
          </div>
        </div>
        <p className="acct-hint">{t('account.deleteDataHint')}</p>
        {signedIn && <p className="acct-hint warn">{t('account.deleteDataCloudWarn')}</p>}
      </div>
    </>
  );
}

/**
 * 清单管理页 —— 把清单的「归属 / 统计 / 图标 / 排序 / 默认」都收在这里。
 * 图标与字形的完整编辑复用侧边栏的 `CreateListModal`（`ui.openListEdit`），避免两套图标选择器。
 */
function ListsPane({ onConfirm }: { onConfirm(spec: ConfirmSpec): void }) {
  const ui = useUiStore();
  const {
    lists, folders, tasks, records, createList, renameList, deleteList,
    reorderLists, setListFolder, createFolder, deleteFolder,
  } = useDataStore();
  const { t } = useI18n();
  const [defaultListId, setDefaultListId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [overId, setOverId] = useState<string | null>(null);

  useEffect(() => { void api.get_default_list().then(setDefaultListId); }, []);

  const ds = useMemo(() => ({ tasks, lists, records }), [tasks, lists, records]);
  const stats = useMemo(() => {
    const m = new Map<string, { count: number; minutes: number }>();
    for (const l of lists) m.set(l.id, listAggregate(ds, l.id));
    return m;
  }, [ds, lists]);

  /** 键盘重排：焦点在清单行按 Alt + ↑/↓（与侧边栏一致） */
  function move(id: string, dir: -1 | 1) {
    const ids = lists.map((l) => l.id);
    const from = ids.indexOf(id);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= ids.length) return;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void reorderLists(next);
  }

  function onDrop(targetId: string) {
    if (!overId || overId === targetId) { setOverId(null); return; }
    const ids = lists.map((l) => l.id);
    const from = ids.indexOf(overId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) { setOverId(null); return; }
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void reorderLists(next);
    setOverId(null);
  }

  function add() {
    const v = newName.trim();
    if (!v) return;
    void createList(v);
    setNewName('');
  }

  return (
    <>
      {/* ── 新建清单 ── */}
      <div className="section-title">{t('lists.new')}</div>
      <div className="field">
        <span className="field-label">{t('lists.namePlaceholder')}</span>
        <div className="field-body">
          <input
            className="text-input" value={newName} placeholder={t('lists.namePlaceholder')}
            aria-label={t('lists.namePlaceholder')}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          />
          <button className="btn primary" onClick={add} disabled={!newName.trim()}>
            {t('lists.create')}
          </button>
          <button className="btn" onClick={() => ui.openListCreate(true)} title={t('lists.createHint')}>
            {t('lists.detail')}
          </button>
        </div>
      </div>
      <p className="acct-hint">{t('lists.createHint')}</p>

      {/* ── 默认清单 ── */}
      <div className="section-title">{t('lists.defaultSection')}</div>
      <div className="field">
        <span className="field-label">{t('lists.section')}</span>
        <div className="field-body">
          <select
            className="text-input" value={defaultListId ?? ''} aria-label={t('lists.defaultSection')}
            onChange={(e) => {
              const v = e.target.value || null;
              setDefaultListId(v);
              void useDataStore.getState().setDefaultList(v);
            }}
          >
            <option value="">{t('common.none')}</option>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <span className="field-hint">{t('lists.defaultRow')}</span>
        </div>
      </div>

      {/* ── 清单列表 ── */}
      <div className="section-title">{t('lists.section')}</div>
      {lists.length === 0 && <p className="acct-hint">{t('lists.empty')}</p>}
      {lists.map((l) => {
        const agg = stats.get(l.id) ?? { count: 0, minutes: 0 };
        return (
          <div
            key={l.id}
            className={`list-row-wrap${overId === l.id ? ' drag-over' : ''}`}
            draggable
            onDragStart={() => setOverId(l.id)}
            onDragOver={(e) => { e.preventDefault(); if (overId !== l.id) setOverId(l.id); }}
            onDragLeave={() => setOverId((p) => (p === l.id ? null : p))}
            onDrop={(e) => { e.preventDefault(); onDrop(l.id); }}
            onDragEnd={() => setOverId(null)}
          >
            <div className="field">
              <span className="field-label">
                <span className="list-grip" aria-hidden><GripVertical size={12} /></span>
                {l.icon_type === 'font' && l.icon_glyph
                  ? <span className="list-glyph" style={{ color: resolveListIconColor(l) }}>{l.icon_glyph}</span>
                  : <span className="list-dot" style={{ background: resolveListIconColor(l) }} />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
                {defaultListId === l.id && (
                  <span className="list-default-tag">{t('lists.default')}</span>
                )}
              </span>
              <div className="field-body">
                <input
                  className="text-input" defaultValue={l.name} aria-label={t('lists.namePlaceholder')}
                  style={{ flex: '1 1 120px', minWidth: 90 }}
                  onKeyDown={(e) => {
                    if (!e.altKey) return;
                    if (e.key === 'ArrowUp') { e.preventDefault(); move(l.id, -1); }
                    if (e.key === 'ArrowDown') { e.preventDefault(); move(l.id, 1); }
                  }}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== l.name) void renameList(l.id, v); }}
                />
                <span className="field-hint" style={{ whiteSpace: 'nowrap' }}>
                  {t('lists.stats', { count: agg.count, min: formatMinutesShort(agg.minutes) })}
                </span>
                <select
                  className="text-input" value={l.folder_id ?? ''} aria-label={t('lists.folder')}
                  style={{ flex: '0 0 auto', width: 'auto', minWidth: 96 }}
                  onChange={(e) => void setListFolder(l.id, e.target.value || null)}
                >
                  <option value="">{t('lists.noFolder')}</option>
                  {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <button
                  className="btn" onClick={() => ui.openListEdit(l.id)}
                  title={t('lists.detail')}
                >
                  {t('lists.detail')}
                </button>
                <button
                  className="btn danger" title={t('lists.delete')}
                  onClick={() => onConfirm({
                    title: t('lists.delete'),
                    message: t('lists.deleteMsg', { name: l.name }),
                    confirmText: t('common.delete'),
                    danger: true,
                    onConfirm: async () => { await deleteList(l.id); },
                  })}
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              </div>
            </div>
          </div>
        );
      })}
      {folders.length > 0 && <p className="acct-hint">{t('lists.reorderHint')}</p>}

      {/* ── 清单夹 ── */}
      <div className="section-title">{t('lists.foldersSection')}</div>
      {folders.length === 0 && <p className="acct-hint">{t('lists.foldersEmpty')}</p>}
      {folders.map((f) => {
        const inside = lists.filter((l) => l.folder_id === f.id);
        return (
          <div className="field" key={f.id}>
            <span className="field-label">
              <span className="list-dot" style={{ background: f.color }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
            </span>
            <div className="field-body">
              <input
                className="text-input" defaultValue={f.name} aria-label={t('folder.name')}
                style={{ flex: '1 1 120px', minWidth: 90 }}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== f.name) void useDataStore.getState().renameFolder(f.id, v); }}
              />
              <span className="field-hint" style={{ whiteSpace: 'nowrap' }}>
                {t('lists.stats', { count: inside.length, min: '' })}
              </span>
              <button className="btn" onClick={() => ui.openFolderEdit(f.id)} title={t('folder.editTitle')}>
                {t('lists.detail')}
              </button>
              <button
                className="btn danger" title={t('menu.deleteFolder')}
                onClick={() => onConfirm({
                  title: t('confirm.deleteFolderTitle'),
                  message: t('confirm.deleteFolderMsg'),
                  confirmText: t('common.delete'),
                  danger: true,
                  onConfirm: async () => { await deleteFolder(f.id); },
                })}
              >
                <Trash2 size={13} aria-hidden />
              </button>
            </div>
          </div>
        );
      })}
      <div className="field">
        <span className="field-label">{t('folder.new')}</span>
        <div className="field-body">
          <input
            className="text-input" value={newFolderName} placeholder={t('folder.namePlaceholder')}
            aria-label={t('folder.namePlaceholder')}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && newFolderName.trim()) { void createFolder(newFolderName.trim(), '#8848E0'); setNewFolderName(''); } }}
          />
          <button
            className="btn" disabled={!newFolderName.trim()}
            onClick={() => { void createFolder(newFolderName.trim(), '#8848E0'); setNewFolderName(''); }}
          >
            {t('lists.create')}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * 关于页 —— 应用标识、本地数据规模、技术栈、云同步状态。
 * 版本号与 package.json 保持一致（当前 1.0.0）。
 */
function AboutPane() {
  const { t } = useI18n();
  const { lists, tasks, records } = useDataStore();
  const cloud = useAuthStore();
  const signedIn = cloud.status === 'signedIn';
  const pbUrl = (import.meta.env.VITE_PB_URL as string | undefined)?.trim() ?? '';

  return (
    <>
      <div className="section-title">{t('about.sectionOverview')}</div>
      <div className="about-head">
        <div className="about-mark" aria-hidden>🍅</div>
        <div className="about-id">
          <div className="about-name">{t('about.appName')}</div>
          <div className="about-version">{t('about.version')} 1.0.0</div>
        </div>
      </div>
      <p className="acct-hint" style={{ marginTop: 2 }}>{t('about.tagline')}</p>
      <p className="acct-hint">{t('about.stack')}</p>

      <div className="section-title">{t('about.sectionData')}</div>
      <div className="field">
        <span className="field-label">{t('about.sectionData')}</span>
        <div className="field-body">
          <span className="acct-readout">
            {t('about.counts', {
              tasks: tasks.filter((x) => x.completed === 0).length,
              lists: lists.length,
              records: records.length,
            })}
          </span>
        </div>
      </div>
      <p className="acct-hint">{t('about.storage')}</p>
      <p className="acct-hint">{t('about.offline')}</p>

      <div className="section-title">{t('about.sectionBackend')}</div>
      <div className="field">
        <span className="field-label">{t('sync.section')}</span>
        <div className="field-body">
          <span className={`acct-badge${signedIn ? '' : ' muted'}`}>
            <span
              className="acct-dot"
              style={signedIn ? undefined : { background: 'var(--text-3)' }}
              aria-hidden
            />
            {signedIn
              ? t('about.backendReady')
              : pbUrl ? t('about.backendDown') : t('about.backendNone')}
          </span>
          {pbUrl && <span className="field-hint">{pbUrl}</span>}
        </div>
      </div>
      {!signedIn && <p className="acct-hint">{t('about.backendHint')}</p>}
    </>
  );
}
