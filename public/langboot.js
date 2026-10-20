/* 首帧语言：与 src/i18n/store.ts 的 detectLang() 同一规则，便于读屏与断词。
 * 应用加载后由 i18n store 的 applyLang() 依据用户设置覆盖。
 * 独立成文件（而非 index.html 内联脚本）是为了满足生产 CSP：Tauri 打包后
 * script-src 只允许 'self'，内联脚本会被拦掉（dev 无 CSP 所以看不出来）。 */
try {
  document.documentElement.lang =
    (navigator.language || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh-CN';
} catch (e) {
  /* 忽略：保持默认 zh-CN */
}
