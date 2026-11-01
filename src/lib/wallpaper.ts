// 专注背景自定义图片 —— 外观页多图管理（PRD §5.6 FR-S3「外观」）。
//
// 数据布局：
//   - settings.wallpaper  = 当前生效值：内置 `waves`，自定义选中为 `custom:<文件名>`
//   - settings.wallpapers = JSON 字符串，数组 [{ name: 文件名, data: dataURI }]，供列表/删除/选中用
// 云同步不携带这两块（大体积 dataURI 不应塞进 configs.data），跨设备仅同步内置背景。
//
// 历史兼容：旧版本把 dataURI 直接内联进 wallpaper（`custom:data:image/…`），
// resolve 在文件名查不到时会原样放回，保证升级不丢旧图。

export const CUSTOM_PREFIX = 'custom:';
export const WAVES_KEY = 'waves';

export interface CustomWallpaper {
  name: string;
  data: string;
}

/** 图片扩展名（展示时去掉，如 `手机壁纸.jpg` → `手机壁纸`） */
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|tiff?)$/i;

/** 列表/触发器上的显示名：去扩展名（对旧数据同样生效，存储键不变） */
export function wallpaperDisplayName(name: string): string {
  return name.replace(IMAGE_EXT, '') || name;
}

/** 解析 settings.wallpapers 的 JSON 字符串为数组；畸形/空回退空列表 */
export function parseWallpapers(json: string): CustomWallpaper[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((w) => w && typeof w.name === 'string' && typeof w.data === 'string') : [];
  } catch {
    return [];
  }
}

/** 序列化为 settings.wallpapers 的 JSON 字符串 */
export function serializeWallpapers(list: CustomWallpaper[]): string {
  return JSON.stringify(list.filter((w) => w && typeof w.name === 'string' && typeof w.data === 'string'));
}

/**
 * 根据当前 wallpaper 值 + 列表，解析出可用的背景 dataURI。
 * 返回 null 表示应使用内置背景（调用方持有内置 assets 引用，各自兜底）。
 */
export function resolveCustomWallpaper(wallpaper: string, wallpapersJson: string): string | null {
  if (!wallpaper.startsWith(CUSTOM_PREFIX)) return null;
  const key = wallpaper.slice(CUSTOM_PREFIX.length);
  // 历史内联 dataURI：直接回放（旧版把整段 data:… 塞进 custom: 前缀后）
  if (key.startsWith('data:')) return key;
  const hit = parseWallpapers(wallpapersJson).find((w) => w.name === key);
  return hit ? hit.data : null;
}