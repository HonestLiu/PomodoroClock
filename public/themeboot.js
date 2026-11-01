/* Blocking same-origin script avoids a wrong-theme first paint under the Tauri CSP. */
(function () {
  var mode = 'system';
  try {
    var saved = localStorage.getItem('focus.theme');
    if (saved === 'light' || saved === 'dark') mode = saved;
  } catch (_) { /* Database settings load after app startup. */ }
  var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = mode === 'system' ? (dark ? 'dark' : 'light') : mode;
  document.querySelector('meta[name="color-scheme"]').content = mode === 'system' ? 'light dark' : mode;
})();
