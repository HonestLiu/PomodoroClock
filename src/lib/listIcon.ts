// 自定义清单图标：单色原点 ｜ 字体图标（iconfont / 任意 Unicode 字形）
// 色板与字形预置，供侧边栏渲染、新建清单弹层复用。

import type { TaskList, ListIconType } from '@/types';

/** 新建清单时的预置色板 */
export const LIST_ICON_COLORS = [
  '#4A7DE0', '#7BA05B', '#D9A441', '#E85D3F',
  '#9B7BD4', '#2BB3A3', '#E07DAA', '#8A8A8A',
] as const;

/** 字体图标预置字形（可任选，也允许在新建弹层里手输自定义字符） */
export const LIST_ICON_GLYPHS = ['★', '✓', '◆', '●', '☆', '♬', '☁', '♥'] as const;

export const DEFAULT_LIST_ICON_COLOR = '#4A7DE0';

export interface ListIconSpec {
  icon_type: ListIconType;
  icon_color: string;
  icon_glyph: string;
}

/** 空图标配置 -> 默认规格（新建清单未选时用） */
export function defaultListIcon(): ListIconSpec {
  return { icon_type: 'dot', icon_color: DEFAULT_LIST_ICON_COLOR, icon_glyph: '' };
}

/** 解析清单实际图标颜色：未设色时回退默认蓝 */
export function resolveListIconColor(l: Pick<TaskList, 'icon_color'>): string {
  return (l.icon_color || '').trim() ? l.icon_color : DEFAULT_LIST_ICON_COLOR;
}