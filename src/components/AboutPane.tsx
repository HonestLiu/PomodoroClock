import { useEffect, useState } from 'react';
import { ArrowUpRight, ChartNoAxesCombined, Cloud, Database, Gift, PanelsTopLeft, Timer } from 'lucide-react';
import { version as buildVersion } from '../../package.json';
import appIcon from '@/assets/app-icon.png';
import { isTauri } from '@/api';
import { useI18n } from '@/i18n';
import { useDataStore } from '@/stores/dataStore';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import '@/styles/about.css';

/** Product information reflects the current app, not a hardcoded release snapshot. */
export function AboutPane() {
  const { t, lang } = useI18n();
  const { lists, tasks, records } = useDataStore();
  const cloud = useAuthStore();
  const native = isTauri();
  const [version, setVersion] = useState(buildVersion);
  useEffect(() => {
    let alive = true;
    if (native) void import('@tauri-apps/api/app').then(api => api.getVersion())
      .then(value => { if (alive) setVersion(value); }).catch(() => { /* Build metadata remains the fallback. */ });
    return () => { alive = false; };
  }, [native]);
  const signedIn = cloud.status === 'signedIn';
  // Authentication is not a connectivity probe. Do not label a session as connected.
  const status = cloud.status === 'unknown' ? 'about.syncUnknown' : !signedIn ? 'about.signedOut'
    : cloud.syncState === 'busy' ? 'about.syncBusy' : cloud.syncState === 'error' ? 'about.syncError'
      : cloud.syncState === 'ok' ? 'about.syncOk' : 'about.signedIn';
  const error = signedIn && cloud.syncState === 'error';
  const number = new Intl.NumberFormat(lang === 'en' ? 'en' : 'zh-CN');
  const counts = [
    { label: 'about.tasks', value: tasks.filter(task => !task.completed).length },
    { label: 'about.lists', value: lists.length },
    { label: 'about.records', value: records.filter(record => record.phase === 'focus' && Number.isFinite(record.duration_min) && record.duration_min > 0).length },
  ];
  const features = [
    { icon: Timer, title: 'about.focusTitle', description: 'about.focusDesc' },
    { icon: ChartNoAxesCombined, title: 'about.reportTitle', description: 'about.reportDesc' },
    { icon: Gift, title: 'about.rewardTitle', description: 'about.rewardDesc' },
    { icon: PanelsTopLeft, title: 'about.desktopTitle', description: 'about.desktopDesc' },
  ];
  const manageAccount = () => {
    useUiStore.getState().setSettingsTab('account');
    document.getElementById('settings-tab-account')?.focus();
  };
  return <div className="about-page">
    <header className="about-identity">
      <img className="about-app-icon" src={appIcon} width={96} height={96} alt={t('about.appName')} />
      <div className="about-identity-copy">
        <h3>{t('about.appName')}</h3>
        <p className="about-release">{t(native ? 'about.desktop' : 'about.browser')}<span aria-hidden> · </span>{t('about.version', { version })}</p>
        <p className="about-headline">{t('about.headline')}</p>
        <p className="about-intro">{t('about.intro')}</p>
      </div>
    </header>
    <section className="about-section" aria-labelledby="about-features-title">
      <h3 id="about-features-title">{t('about.features')}</h3>
      <div className="about-features">
        {features.map(({ icon: Icon, title, description }) => <article className="about-feature" key={title}>
          <Icon size={19} strokeWidth={1.65} aria-hidden />
          <div><h4>{t(title)}</h4><p>{t(description)}</p></div>
        </article>)}
      </div>
    </section>
    <section className="about-section" aria-labelledby="about-data-title">
      <h3 id="about-data-title">{t('about.dataTitle')}</h3>
      <div className="about-data-panel">
        <dl className="about-counts">{counts.map(item => <div key={item.label}>
          <dt>{t(item.label)}</dt><dd>{number.format(item.value)}</dd>
        </div>)}</dl>
        <div className="about-local-note"><Database size={16} aria-hidden /><div>
          <strong>{t('about.localTitle')}</strong><p>{t('about.localDesc')}</p>
        </div></div>
      </div>
    </section>
    <section className="about-section about-sync" aria-labelledby="about-sync-title">
      <div className="about-sync-heading"><h3 id="about-sync-title"><Cloud size={17} aria-hidden />{t('about.cloudTitle')}</h3>
        <span className={`about-sync-status${error ? ' error' : signedIn ? ' active' : ''}`} role="status">{t(status)}</span>
      </div>
      <p>{t(error ? 'about.syncErrorDesc' : native ? 'about.cloudDesc' : 'about.browserSync')}</p>
      {signedIn && cloud.lastSyncAt && <p className="about-sync-time">{t('about.lastSync', {
        time: new Intl.DateTimeFormat(lang === 'en' ? 'en' : 'zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(cloud.lastSyncAt),
      })}</p>}
      <button className="about-account-link" onClick={manageAccount}>{t('about.manageAccount')}<ArrowUpRight size={14} aria-hidden /></button>
      <p className="about-private-note">{t('about.privateRewards')}</p>
    </section>
    <details className="about-build-info">
      <summary>{t('about.buildInfo')}</summary>
      <dl>
        <div><dt>{t('about.currentVersion')}</dt><dd>{version}</dd></div>
        <div><dt>{t('about.runtime')}</dt><dd>{t(native ? 'about.desktop' : 'about.browser')}</dd></div>
        {native && <div><dt>{t('about.updates')}</dt><dd>{t('about.updateDesc')}</dd></div>}
      </dl>
    </details>
  </div>;
}
