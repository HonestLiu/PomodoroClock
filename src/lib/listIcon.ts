// 自定义清单图标：单色原点 ｜ 字体图标（iconfont / 任意 Unicode 字形）
// 色板与字形预置，供侧边栏渲染、新建清单弹层复用。

import type { TaskList, ListIconType, Folder } from '@/types';

/** 新建清单时的预置色板 */
export const LIST_ICON_COLORS = [
  '#4A7DE0', '#7BA05B', '#D9A441', '#E85D3F',
  '#9B7BD4', '#2BB3A3', '#E07DAA', '#8A8A8A',
] as const;

/** 清单夹色板（新建清单夹时用；驱动夹图标与嵌套导引线颜色） */
export const FOLDER_COLORS = [
  '#A8B8C0', '#7088F8', '#60C0E8', '#F0B050', '#C040B0', '#F06088', '#F0D050', '#98C860', '#F87850', '#A068F0',
  '#20A8D8', '#80E0A8', '#8848E0', '#4070F0', '#E858D0', '#E86860', '#A0A0A0', '#9A8579', '#60E0C0', '#484848',
] as const;

/** 字体图标预置字形（可任选，也允许在新建弹层里手输自定义字符） */
export const LIST_ICON_GLYPHS = ['★', '✓', '◆', '●', '☆', '♬', '☁', '♥'] as const;

export const DEFAULT_LIST_ICON_COLOR = '#4A7DE0';
export const DEFAULT_FOLDER_COLOR = '#8848E0';

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

/** 解析清单夹颜色：未设色时回退默认紫 */
export function resolveFolderColor(f: Pick<Folder, 'color'>): string {
  return (f.color || '').trim() ? f.color : DEFAULT_FOLDER_COLOR;
}