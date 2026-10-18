// 添加任务：输入后回车即创建 —— PRD FR-T1

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useDataStore } from '@/stores/dataStore';
import { useI18n } from '@/i18n';

export function AddTask({ placeholder, listId, dueDate }: { placeholder: string; listId?: string | null; dueDate?: string | null }) {
  const [value, setValue] = useState('');
  const createTask = useDataStore((s) => s.createTask);
  const { t } = useI18n();

  async function submit() {
    const title = value.trim();
    if (!title) return;
    setValue('');
    await createTask({ title, listId: listId ?? undefined, dueDate: dueDate ?? undefined });
  }

  return (
    <div className="add-task">
      <Plus size={16} className="plus" aria-hidden />
      <input
        value={value}
        aria-label={t('a11y.taskInput')}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
      />
    </div>
  );
}
