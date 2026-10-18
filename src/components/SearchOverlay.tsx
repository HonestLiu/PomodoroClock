// 搜索覆盖层 —— PRD §5.8 FR-S / search.md
// 即时过滤、分组显示；↑↓ 选择、回车定位到任务/清单并高亮；Esc 关闭；⌘/Ctrl+K 或 / 唤起。

import { useEffect, useMemo, useState } from 'react';
import { Search, ListTodo, FolderOpen } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { useDataStore } from '@/stores/dataStore';
import { searchLists, searchTasks, type Dataset } from '@/lib/derive';
import { useI18n } from '@/i18n';

type Entry =
  | { kind: 'task'; id: string; title: string }
  | { kind: 'list'; id: string; name: string };

export function SearchOverlay() {
  const open = useUiStore((s) => s.searchOpen);
  const openSearch = useUiStore((s) => s.openSearch);
  const navigate = useUiStore((s) => s.navigate);
  const triggerHighlight = useUiStore((s) => s.triggerHighlight);
  const { tasks, lists, records, revision } = useDataStore();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const { t } = useI18n();

  useEffect(() => { if (open) { setQ(''); setSel(0); } }, [open]);

  const entries = useMemo<Entry[]>(() => {
    const ds: Dataset = { tasks, lists, records };
    const ts = searchTasks(ds, q).slice(0, 20).map((t) => ({ kind: 'task' as const, id: t.id, title: t.title }));
    const ls = searchLists(ds, q).slice(0, 8).map((l) => ({ kind: 'list' as const, id: l.id, name: l.name }));
    return [...ts, ...ls];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tasks, lists, records, revision]);

  // 结果数量变化时收敛选中项
  useEffect(() => { setSel((s0) => Math.min(s0, Math.max(0, entries.length - 1))); }, [entries.length]);

  function goTo(entry: Entry) {
    if (entry.kind === 'task') {
      navigate({ name: 'tasks' });
      triggerHighlight(entry.id);
    } else {
      navigate({ name: 'list', id: entry.id });
    }
    openSearch(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') openSearch(false);
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s0) => Math.min(entries.length - 1, s0 + 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s0) => Math.max(0, s0 - 1)); }
      if (e.key === 'Enter') { const e2 = entries[sel]; if (e2) goTo(e2); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entries, sel]);

  if (!open) return null;

  const taskCount = entries.filter((e) => e.kind === 'task').length;
  const listCount = entries.filter((e) => e.kind === 'list').length;
  const hasResults = entries.length > 0;

  return (
    <div className="search-overlay" onClick={() => openSearch(false)}>
      <div
        className="search-panel" role="dialog" aria-modal="true" aria-label={t('search.placeholder')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="search-input-row">
          <Search size={17} aria-hidden />
          <input
            autoFocus
            value={q}
            aria-label={t('a11y.searchInput')}
            placeholder={t('search.placeholder2')}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
          />
          <span style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{t('search.hint')}</span>
        </div>

        <div className="sr-only" role="status" aria-live="polite">
          {q.trim() ? t('a11y.searchResults', { n: entries.length }) : ''}
        </div>

        <div className="search-results" role="listbox" aria-label={t('search.placeholder')}>
          {!q.trim() && <div className="empty">{t('search.empty')}</div>}
          {q.trim() && !hasResults && <div className="empty">{t('search.noResult')}</div>}

          {taskCount > 0 && <div className="search-sec">{t('search.task')}</div>}
          {entries.filter((e) => e.kind === 'task').map((e) => {
            const idx = entries.indexOf(e);
            return (
              <button
                key={e.id}
                className={`search-hit${sel === idx ? ' active' : ''}`}
                role="option" aria-selected={sel === idx}
                onMouseEnter={() => setSel(idx)}
                onClick={() => goTo(e)}
              >
                <ListTodo size={14} style={{ color: 'var(--text-2)' }} aria-hidden />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(e as { title: string }).title}</span>
              </button>
            );
          })}

          {listCount > 0 && <div className="search-sec">{t('search.list')}</div>}
          {entries.filter((e) => e.kind === 'list').map((e) => {
            const idx = entries.indexOf(e);
            return (
              <button
                key={e.id}
                className={`search-hit${sel === idx ? ' active' : ''}`}
                role="option" aria-selected={sel === idx}
                onMouseEnter={() => setSel(idx)}
                onClick={() => goTo(e)}
              >
                <FolderOpen size={14} style={{ color: 'var(--text-2)' }} aria-hidden />
                <span style={{ flex: 1 }}>{(e as { name: string }).name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
