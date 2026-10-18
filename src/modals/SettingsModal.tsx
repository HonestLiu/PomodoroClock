// 设置弹窗 —— PRD §5.6 FR-S1/S2/S3（截图事实 S5）
// 左侧 7 项导航：账号 / 高级版 / 通用 / 番茄钟 / 清单管理 / 外观 / 关于
//
// 账号页（S5）＝「软件账号」页：账号即 PocketBase 账号，一页两态——
// 未登录：居中登录/注册卡（邮箱、密码[、确认密码]）＋ 下方「本地数据」；
// 已登录：同一张卡变账号卡（头像/首字母、用户名/邮箱、已登录徽标、同步区、退出登录）＋「本地数据」。
// 头像来自 PocketBase 的 users.avatar 文件字段（点头像更换，可移除）；其余资料（昵称等）不在此编辑。

import { useEffect, useRef, useState } from 'react';
import {
  Camera, Crown, Info, ListChecks, Palette,
  Settings as SettingsIcon, Sliders, User as UserIcon, X,
} from 'lucide-react';
import { useUiStore, type SettingsTab } from '@/stores/uiStore';
import { useDataStore } from '@/stores/dataStore';
import { useTimerStore } from '@/stores/timerStore';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/api';
import { pbAvatarFileUrl } from '@/lib/pb';
import { NOISE_LABELS, type NoiseKind } from '@/lib/noise';
import type { Settings } from '@/types';
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
  const { lists, createList, renameList, deleteList } = useDataStore();
  const setDefaultList = useDataStore((s) => s.setDefaultList);
  const timer = useTimerStore();
  const { t } = useI18n();
  const modalRef = useRef<HTMLDivElement>(null);

  const [settings, setSettings] = useState<Settings>(timer.settings);
  const [newListName, setNewListName] = useState('');
  const [defaultListId, setDefaultListId] = useState<string | null>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);

  useModalA11y(ui.settingsOpen, () => ui.closeAllOverlays(), modalRef, '.settings-nav button.active');

  useEffect(() => {
    void api.get_default_list().then(setDefaultListId);
  }, [ui.settingsTab]);

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
            {ui.settingsTab === 'lists' && (
              <>
                {lists.map((l) => (
                  <div className="field" key={l.id}>
                    <span className="field-label">{l.name}</span>
                    <div className="field-body">
                      <input
                        className="text-input" defaultValue={l.name}
                        aria-label={t('lists.namePlaceholder')}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== l.name) void renameList(l.id, v); }}
                      />
                      <button
                        className="btn"
                        aria-pressed={defaultListId === l.id}
                        style={defaultListId === l.id ? { color: 'var(--accent-focus)', borderColor: 'var(--accent-focus)' } : undefined}
                        onClick={() => void setDefaultList(defaultListId === l.id ? null : l.id).then(() => setDefaultListId(defaultListId === l.id ? null : l.id))}
                      >
                        {defaultListId === l.id ? t('lists.default') : t('lists.setDefault')}
                      </button>
                      <button
                        className="btn danger"
                        onClick={() => onConfirm({
                          title: t('lists.delete'),
                          message: t('lists.deleteMsg', { name: l.name }),
                          confirmText: t('common.delete'),
                          danger: true,
                          onConfirm: async () => { await deleteList(l.id); },
                        })}
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  </div>
                ))}
                <div className="field">
                  <span className="field-label">{t('lists.new')}</span>
                  <div className="field-body">
                    <input
                      className="text-input" placeholder={t('lists.namePlaceholder')} value={newListName}
                      aria-label={t('lists.namePlaceholder')}
                      onChange={(e) => setNewListName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        const v = newListName.trim();
                        if (v) { void createList(v); setNewListName(''); }
                      }}
                    />
                    <button
                      className="btn primary"
                      onClick={() => { const v = newListName.trim(); if (v) { void createList(v); setNewListName(''); } }}
                    >
                      {t('lists.create')}
                    </button>
                  </div>
                </div>
              </>
            )}

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
            {ui.settingsTab === 'about' && (
              <div style={{ padding: '10px 0' }}>
                <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>FocusPomodoro</h3>
                <p className="field-hint" style={{ lineHeight: 1.8, margin: 0 }}>
                  {t('about.tagline')}<br />
                  {t('about.stack')}<br />
                  {t('about.storage')}<br />
                  {t('about.offline')}
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
  // 已登录：就地编辑资料（昵称；邮箱 PB 不允许改）
  const [editingProfile, setEditingProfile] = useState(false);
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

  /** 已登录改昵称：写 PB users.name（32 字符上限与非法值由 authStore 校验并播报） */
  async function saveProfile() {
    const v = nickDraft.trim();
    if (v === (cloud.user?.name ?? '').trim()) { setEditingProfile(false); return; }
    const ok = await cloud.updateNickname(v);
    if (ok) setEditingProfile(false);
  }

  function closeProfile() {
    setEditingProfile(false);
    setNickDraft('');
  }

  /** 退出登录：可逆的低风险操作，不二次确认；也不关闭设置弹层（原地切回登录卡并提示） */
  async function signOut() {
    setEditingPwd(false); setOp(''); setNp1(''); setNp2('');
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
      <div className={`account-card${signedIn ? ' signed-in' : ''}`}>
        {signedIn ? (
          <>
            <div className="account-head">
              <button
                type="button"
                className="account-avatar"
                onClick={() => avatarInputRef.current?.click()}
                aria-label={t('account.avatarChange')}
                title={t('account.avatarChange')}
                aria-busy={uploading || undefined}
                disabled={uploading}
              >
                {avatarUrl ? <img src={avatarUrl} alt="" /> : initial}
                <span className="account-avatar-edit" aria-hidden>
                  {uploading ? <span className="account-avatar-loading">{t('account.avatarUploading')}</span> : <Camera size={16} aria-hidden />}
                </span>
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg"
                hidden
                onChange={(e) => void onPickAvatar(e)}
              />
              <div className="account-id">
                <div className="account-name-row">
                  <div className="account-name" title={name}>{name}</div>
                  <button
                    type="button" className="account-edit"
                    aria-expanded={editingProfile}
                    onClick={() => {
                      if (editingProfile) { closeProfile(); return; }
                      setNickDraft((cloud.user?.name ?? '').trim());
                      setEditingProfile(true);
                    }}
                  >
                    {t('account.editProfile')}
                  </button>
                </div>
                <div className="account-email" title={email0}>{email0}</div>
                <div className="account-avatar-hint">{t('account.avatarHint')}</div>
              </div>
              <span className="account-badge">
                <span className="account-dot" aria-hidden />
                {t('account.signedIn')}
              </span>
            </div>

            {editingProfile && (
              <div className="account-profile-form" role="group" aria-label={t('account.editProfile')}>
                <label className="account-field">
                  <span className="account-field-label">{t('account.nickname')}</span>
                  <input
                    className="text-input" type="text" maxLength={32} autoComplete="nickname"
                    value={nickDraft} aria-label={t('account.nickname')} placeholder={t('account.nicknameHint')}
                    onChange={(e) => setNickDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveProfile();
                      if (e.key === 'Escape') closeProfile();
                    }}
                  />
                </label>
                <span className="account-email-locked">{t('account.emailLocked')}</span>
                <div className="account-pwd-actions">
                  <button className="btn primary" disabled={busy} onClick={() => void saveProfile()}>
                    {t('common.save')}
                  </button>
                  <button className="btn" onClick={closeProfile}>{t('common.cancel')}</button>
                </div>
              </div>
            )}

            <div className="account-sync">
              <div className="account-sync-title">{t('sync.section')}</div>
              <div
                className={`account-sync-state${cloud.syncState === 'error' ? ' error' : ''}`}
                role="status" aria-live="polite"
              >
                {cloud.syncMessage || syncLabel}
              </div>
              <div className="account-sync-actions">
                <button className="btn" disabled={busy} onClick={() => void cloud.pushNow()}>{t('sync.push')}</button>
                <button className="btn" disabled={busy} onClick={() => void cloud.pullNow()}>{t('sync.pull')}</button>
              </div>
              <p className="account-hint">{t('sync.autoHint')}</p>
            </div>

            {editingPwd && (
              <div className="account-pwd-form">
                <label className="account-field">
                  <span className="account-field-label">{t('sync.oldPwd')}</span>
                  <input
                    className="text-input" type="password" autoComplete="current-password"
                    value={op} aria-label={t('sync.oldPwd')}
                    onChange={(e) => setOp(e.target.value)}
                  />
                </label>
                <label className="account-field">
                  <span className="account-field-label">{t('sync.newPwd')}</span>
                  <input
                    className="text-input" type="password" autoComplete="new-password"
                    value={np1} aria-label={t('sync.newPwd')}
                    onChange={(e) => setNp1(e.target.value)}
                  />
                </label>
                <label className="account-field">
                  <span className="account-field-label">{t('sync.passwordConfirm')}</span>
                  <input
                    className="text-input" type="password" autoComplete="new-password"
                    value={np2} aria-label={t('sync.passwordConfirm')}
                    onChange={(e) => setNp2(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && np1 && !pwdMismatch) void savePwd(); }}
                  />
                </label>
                {pwdMismatch && <span className="account-error" role="alert">{t('sync.pwdMismatch')}</span>}
                <div className="account-pwd-actions">
                  <button className="btn primary" disabled={!op || !np1 || pwdMismatch || busy} onClick={() => void savePwd()}>
                    {t('common.save')}
                  </button>
                  <button className="btn" onClick={() => { setEditingPwd(false); setOp(''); setNp1(''); setNp2(''); }}>
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            )}

            <div className="account-foot">
              {avatarName && (
                <button className="account-avatar-remove" disabled={uploading} onClick={() => void removeAvatar()}>
                  {t('account.avatarRemove')}
                </button>
              )}
              <button className="btn" onClick={() => { setEditingPwd((v) => !v); setOp(''); setNp1(''); setNp2(''); }}>
                {t('sync.changePwd')}
              </button>
              <button className="btn" onClick={() => void signOut()}>
                {t('account.signOut')}
              </button>
            </div>
          </>
        ) : (
          <div className="account-form-wrap">
            <div className="account-logo" aria-hidden>F</div>
            <h3 className="account-title">{t('account.title')}</h3>
            <p className="account-subtitle">{t('account.subtitle')}</p>

            <div className="account-form">
              {mode === 'register' && (
                <label className="account-field">
                  <span className="account-field-label">{t('account.nickname')}</span>
                  <input
                    className="text-input" type="text" maxLength={32} autoComplete="nickname"
                    value={nick} aria-label={t('account.nickname')} placeholder={t('account.nicknameHint')}
                    onChange={(e) => setNick(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
                  />
                </label>
              )}
              <label className="account-field">
                <span className="account-field-label">{t('sync.email')}</span>
                <input
                  className="text-input" type="email" autoComplete="username"
                  value={email} aria-label={t('sync.email')} placeholder="you@example.com"
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label className="account-field">
                <span className="account-field-label">{t('sync.password')}</span>
                <input
                  className="text-input" type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={pwd} aria-label={t('sync.password')}
                  onChange={(e) => setPwd(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
                />
              </label>
              {mode === 'register' && (
                <label className="account-field">
                  <span className="account-field-label">{t('sync.passwordConfirm')}</span>
                  <input
                    className="text-input" type="password" autoComplete="new-password"
                    value={pwd2} aria-label={t('sync.passwordConfirm')}
                    onChange={(e) => setPwd2(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
                  />
                </label>
              )}
              {mismatch && <span className="account-error" role="alert">{t('sync.pwdMismatch')}</span>}

              <button className="btn primary account-submit" disabled={!canSubmit} onClick={() => void submit()}>
                {busy ? t('sync.syncing') : mode === 'login' ? t('sync.login') : t('sync.register')}
              </button>
              <div className="account-links">
                <button
                  type="button" className="account-switch"
                  onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setPwd2(''); }}
                >
                  {mode === 'login' ? t('account.switchToRegister') : t('account.switchToLogin')}
                </button>
                {mode === 'login' && (
                  <button type="button" className="account-switch" onClick={() => void forgot()}>
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
      </div>

      {/* 本地数据：两态都有，删除的是本地库 */}
      <div className="account-local-data">
        <div className="account-local-head">{t('account.localData')}</div>
        <p className="account-hint">{t('account.deleteDataHint')}</p>
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
        {signedIn && <p className="account-hint warn">{t('account.deleteDataCloudWarn')}</p>}
      </div>
    </>
  );
}
