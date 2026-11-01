// Audio lifecycle regressions: node tools/verify-audio.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadAudioModule(path) {
  const instances = [];
  class Audio {
    currentTime = 0;
    volume = 1;
    muted = false;
    pauses = 0;
    plays = [];
    constructor(src) { this.src = src; instances.push(this); }
    play() {
      this.plays.push({ muted: this.muted, volume: this.volume });
      return new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    }
    pause() { this.pauses++; }
    load() {}
  }
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/^import (\w+) from ['"][^'"]+['"];$/gm, 'const $1 = "$1";')
    .replace(/^import \{ tStatic \}[^\n]+/m, 'const tStatic = (key: string) => key;');
  const contexts = [];
  class AudioContext {
    state = 'suspended';
    destination = {};
    sources = [];
    resumes = 0;
    constructor() { contexts.push(this); }
    resume() { this.resumes++; this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    decodeAudioData() { return Promise.resolve({ decoded: true }); }
    createBufferSource() {
      const node = {
        starts: 0, stops: 0, disconnects: 0,
        connect() {},
        start() { this.starts++; },
        stop() { this.stops++; },
        disconnect() { this.disconnects++; },
      };
      this.sources.push(node);
      return node;
    }
  }
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, Audio, AudioContext,
    fetch: () => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)) }),
  });
  return { api: exports, instances, contexts };
}

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
{
  const { api, instances, contexts } = loadAudioModule('../src/lib/bell.ts');
  api.primeBell();
  api.primeBell();
  await settle();
  assert.equal(instances.length, 0, 'bell never creates a media element');
  assert.equal(contexts.length, 1, 'reuse audio context');
  const ctx = contexts[0];
  assert.equal(ctx.sources.length, 0, 'starting timer never starts a sound');
  api.playBell();
  await settle();
  const first = ctx.sources[0];
  assert.equal(first.starts, 1);
  api.playBell();
  await settle();
  assert.equal(first.stops, 1, 'repeated bell stops previous source');
  assert.equal(first.disconnects, 1);
  ctx.sources[1].onended();
  assert.equal(ctx.state, 'suspended', 'release audio device after completion');
  api.playBell();
  await settle();
  assert.equal(ctx.sources[2].starts, 1, 'next reminder resumes correctly');
}
{
  const { api, contexts } = loadAudioModule('../src/lib/bell.ts');
  api.playBell();
  api.playBell();
  await settle();
  assert.equal(contexts[0].sources.length, 1, 'late decode cannot replay stale reminder');
}

{
  const { api, instances } = loadAudioModule('../src/lib/noise.ts');
  api.startNoise('waves', 0.5);
  const waves = instances[0];
  waves.currentTime = 42;
  api.setNoiseVolume(0.3);
  api.startNoise('waves', 0.3);
  assert.equal(instances.length, 1, 'same sound must reuse audio');
  assert.equal(waves.currentTime, 42, 'keep playback position');
  assert.equal(waves.volume, 0.3);
  assert.equal(waves.pauses, 0);
  api.startNoise('rain', 0.4);
  assert.equal(waves.pauses, 1, 'switching sound stops previous audio');
  // A stale play rejection must not stop its replacement.
  waves.reject(new Error('interrupted'));
  await Promise.resolve();
  assert.equal(api.isNoisePlaying(), true);
  api.stopNoise();
  assert.equal(api.isNoisePlaying(), false);
  api.startNoise('rain', 0.4);
  assert.equal(instances.length, 3, 'stopped sound can restart');
}
console.log('Audio lifecycle regressions passed.');
