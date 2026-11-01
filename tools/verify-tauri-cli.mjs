import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { planTauri } from '../scripts/tauri-plan.mjs';

const context = { platform: 'darwin', root: '/project', env: {}, local: { identity: 'development-cert', team: 'ABC1234567' } };
test('plain macOS build shares one signing environment with its child hooks', () => {
  const plan = planTauri(['build'], context);
  assert.equal(plan.env.APPLE_SIGNING_IDENTITY, 'development-cert');
  assert.equal(plan.env.APPLE_TEAM_ID, 'ABC1234567');
  assert.deepEqual(plan.args, ['build', '--config', '/project/macos/build/signing.config.json']);
  assert.equal(plan.configure, true); assert.equal(plan.verify, true);
  assert.equal(plan.app, '/project/src-tauri/target/release/bundle/macos/FocusPomodoro.app');
});
test('explicit environment overrides local machine configuration', () => {
  const plan = planTauri(['build'], { ...context, env: { APPLE_SIGNING_IDENTITY: 'ci-cert', APPLE_TEAM_ID: 'CI12345678', FOCUS_WIDGET_APP_GROUP: 'CI12345678.shared' } });
  assert.equal(plan.env.APPLE_SIGNING_IDENTITY, 'ci-cert'); assert.equal(plan.env.APPLE_TEAM_ID, 'CI12345678');
  assert.equal(plan.env.FOCUS_WIDGET_APP_GROUP, 'CI12345678.shared');
});
test('preserves custom flags and places signing config before Cargo arguments', () => {
  const plan = planTauri(['build', '--debug', '--config', 'custom.json', '--', '--locked'], context);
  assert.deepEqual(plan.args, ['build', '--debug', '--config', 'custom.json', '--config', '/project/macos/build/signing.config.json', '--', '--locked']);
  assert.equal(plan.app, '/project/src-tauri/target/debug/bundle/macos/FocusPomodoro.app');
});
test('Windows/Linux, dev, help, version, and non-macOS targets pass through', () => {
  for (const [platform, args, env] of [
    ['win32', ['build'], {}], ['linux', ['build'], {}], ['darwin', ['dev'], {}],
    ['darwin', ['build', '--help'], {}], ['darwin', ['--version'], {}],
    ['darwin', ['build', '--target', 'x86_64-pc-windows-msvc'], {}],
    ['darwin', ['build'], { CARGO_BUILD_TARGET: 'x86_64-unknown-linux-gnu' }],
  ]) {
    const plan = planTauri(args, { ...context, platform, env, local: {} });
    assert.deepEqual(plan.args, args); assert.equal(plan.configure, false); assert.equal(plan.verify, false);
  }
});
test('missing, ad-hoc, and malformed team configuration fail instead of silently degrading widgets', () => {
  for (const local of [{}, { identity: '-', team: 'ABC1234567' }, { identity: 'cert', team: 'wrong' }]) {
    assert.throws(() => planTauri(['build'], { ...context, local }), /签名配置/);
  }
});
test('intentional no-sign or no-bundle builds do not require a signing identity', () => {
  for (const flag of ['--no-sign', '--no-bundle']) {
    const plan = planTauri(['build', flag], { ...context, local: {} });
    assert.equal(plan.configure, true); assert.equal(plan.verify, false); assert.ok(plan.args.includes(flag));
  }
});
test('universal targets and custom Cargo directories use the correct bundle path', () => {
  const plan = planTauri(['build', '-d', '--target=universal-apple-darwin'], { ...context, env: { CARGO_TARGET_DIR: '/build cache' } });
  assert.equal(plan.app, '/build cache/universal-apple-darwin/debug/bundle/macos/FocusPomodoro.app');
});
