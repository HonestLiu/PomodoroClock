import { useQuestStore } from '@/stores/questStore';
import { localDay } from '@/lib/quests/model';
import { useI18n } from '@/i18n';
import { QuestCards } from './QuestCards';
import '@/styles/quests.css';

export function QuestToday() {
  const data = useQuestStore(s => s.data);
  const { t } = useI18n();
  const ids = new Set(data.attempts.filter(a => a.status === 'accepted' && a.day === localDay(Date.now()) && Date.now() < a.expiresAt).map(a => a.questId));
  const quests = data.quests.filter(q => ids.has(q.id));
  if (!quests.length) return null;
  return <section className="quest-today" aria-labelledby="quest-today-title"><h2 id="quest-today-title">{t('quest.today')}</h2><p>{t('quest.todayHint')}</p><QuestCards quests={quests} /></section>;
}
