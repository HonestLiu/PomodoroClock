import path from 'node:path';

/** Keep normal CLI commands intact; one signing environment feeds host + widget. */
export function macBuildContext(args, platform, env) {
  const separator = args.indexOf('--');
  const options = separator < 0 ? args : args.slice(0, separator);
  const command = options.find(arg => !arg.startsWith('-'));
  const targetIndex = options.findIndex(arg => arg === '--target' || arg === '-t');
  const target = (targetIndex < 0 ? options.find(arg => arg.startsWith('--target='))?.slice(9)
    : options[targetIndex + 1]) ?? env.CARGO_BUILD_TARGET;
  const nativeBuild = platform === 'darwin' && command === 'build'
    && !options.some(arg => arg === '--help' || arg === '-h')
    && (!target || target.endsWith('apple-darwin'));
  return nativeBuild ? { separator, options, target } : null;
}
export function planTauri(args, { platform, root, env, local = {} }) {
  const context = macBuildContext(args, platform, env);
  if (!context) return { args: [...args], env: { ...env }, configure: false, verify: false };
  const { separator, options, target } = context;
  const identity = env.APPLE_SIGNING_IDENTITY ?? local.identity;
  const team = env.APPLE_TEAM_ID ?? local.team;
  const verify = !options.includes('--no-sign') && !options.includes('--no-bundle');
  if (verify && (!identity || identity === '-' || !/^[A-Z0-9]{10}$/.test(team ?? ''))) {
    throw new Error('macOS 构建缺少有效签名配置。请配置 macos/signing.local，或设置 APPLE_SIGNING_IDENTITY 和 APPLE_TEAM_ID；不会自动退回无法同步小组件的临时签名。');
  }
  const nextEnv = { ...env };
  if (identity) nextEnv.APPLE_SIGNING_IDENTITY = identity;
  if (team) nextEnv.APPLE_TEAM_ID = team;
  const group = env.FOCUS_WIDGET_APP_GROUP ?? local.appGroup;
  if (group) nextEnv.FOCUS_WIDGET_APP_GROUP = group;
  const config = path.join(root, 'macos/build/signing.config.json');
  // Configuration belongs to Tauri, never after the runner's `--` separator.
  const nextArgs = [...options, '--config', config, ...(separator < 0 ? [] : args.slice(separator))];
  const targetDir = path.resolve(root, 'src-tauri', env.CARGO_TARGET_DIR ?? 'target');
  const profile = options.includes('--debug') || options.includes('-d') ? 'debug' : 'release';
  const app = path.join(targetDir, target ?? env.CARGO_BUILD_TARGET ?? '', profile, 'bundle/macos/FocusPomodoro.app');
  return { args: nextArgs, env: nextEnv, configure: true, verify, app };
}
