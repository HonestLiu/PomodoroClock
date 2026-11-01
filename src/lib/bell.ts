// 铃声使用 Web Audio 短音效，不创建 HTMLAudioElement 或媒体播放会话。
// 白噪音仍由 noise.ts 的媒体播放器独立管理。
import bellUrl from '@/assets/bell.mp3';

let context: AudioContext | null = null;
let buffer: AudioBuffer | null = null;
let loading: Promise<AudioBuffer> | null = null;
let source: AudioBufferSourceNode | null = null;
let playbackVersion = 0;

function getContext(): AudioContext {
  if (!context || context.state === 'closed') {
    context = new AudioContext();
    buffer = null;
    loading = null;
  }
  return context;
}

function loadBell(ctx: AudioContext): Promise<AudioBuffer> {
  if (buffer) return Promise.resolve(buffer);
  if (!loading) {
    loading = fetch(bellUrl)
      .then((response) => {
        if (!response.ok) throw new Error('Bell audio unavailable');
        return response.arrayBuffer();
      })
      .then((bytes) => ctx.decodeAudioData(bytes))
      .then((decoded) => { buffer = decoded; return decoded; })
      .catch((error: unknown) => { loading = null; throw error; });
  }
  return loading;
}

/** 用户点击开始/恢复时解锁上下文并预加载，绝不启动音源。 */
export function primeBell(): void {
  try {
    const ctx = getContext();
    // resume 必须直接发生在用户手势内，不能等下载完成后才调用。
    const version = playbackVersion;
    void ctx.resume().then(() => {
      if (version === playbackVersion && !source) return ctx.suspend();
    }).catch(() => {});
    void loadBell(ctx).catch(() => {});
  } catch { /* 不支持 Web Audio 时静默降级，不回退到媒体播放器 */ }
}

/** 播放一次结束音效；重复调用打断旧音源，过期的异步请求不得补播。 */
export function playBell(): void {
  const version = ++playbackVersion;
  try {
    const ctx = getContext();
    if (source) {
      source.onended = null;
      source.stop();
      source.disconnect();
      source = null;
    }
    void Promise.all([ctx.resume(), loadBell(ctx)]).then(([, decoded]) => {
      if (version !== playbackVersion) return;
      const next = ctx.createBufferSource();
      next.buffer = decoded;
      next.connect(ctx.destination);
      next.onended = () => {
        next.disconnect();
        if (source === next) {
          source = null;
          // 播完暂停音频设备，缓存保留供下一次提醒使用。
          void ctx.suspend().catch(() => {});
        }
      };
      source = next;
      next.start();
    }).catch(() => { /* 加载/自动播放失败时静默降级 */ });
  } catch { /* 静默降级 */ }
}
