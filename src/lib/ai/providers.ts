// AI LLM 适配层（docs/05-modules/ai.md）
// 支持 Claude(anthropic /v1/messages) 与 OpenAI(/v1/chat/completions) 两种请求格式，
// 由设置页配置 provider/baseUrl/apiKey/model。结构化 JSON 输出 + 本地校验 + 自动重试 1 次。
// 失败一律返回 StructuredResult（含可行动的 i18n key + 服务端短句 hint），绝不让错误冒泡成白屏。

import type { Settings } from '@/types';

export type AiEngine = 'auto' | 'fake';

/** 可行动的错误分类（i18n key；UI 侧用 t() 出文案，未知 key 会原样回显） */
export type AiErrKey =
  | 'err.ai.network' | 'err.ai.auth' | 'err.ai.badreq' | 'err.ai.notfound'
  | 'err.ai.rate' | 'err.ai.server' | 'err.ai.json' | 'err.ai.unknown';

export type StructuredResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'timeout' }
  | { status: 'error'; message: AiErrKey | string; hint?: string }
  | { status: 'validation'; errors: string[] };

/** HTTP/网络错误：status=0 表示请求发不出去（被 CSP 拦 / DNS / 断网） */
class AiHttpError extends Error {
  status: number;
  hint?: string;
  constructor(status: number, hint?: string) {
    super(`HTTP ${status}`);
    this.status = status;
    this.hint = hint;
  }
}

/** HTTP 状态 → 可行动错误分类 */
function errKeyOf(status: number): AiErrKey {
  if (status === 0) return 'err.ai.network';
  if (status === 401 || status === 403) return 'err.ai.auth';
  if (status === 404) return 'err.ai.notfound';
  if (status === 429) return 'err.ai.rate';
  if (status === 400 || status === 422) return 'err.ai.badreq';
  if (status >= 500) return 'err.ai.server';
  return 'err.ai.unknown';
}

/** 时间上下文（需求 5）：每次调用必须注入，否则「下周五」必错。 */
export function timeContext(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()];
  const tzMin = -now.getTimezoneOffset();
  const tzSign = tzMin >= 0 ? '+' : '-';
  const tz = `${tzSign}${p(Math.floor(Math.abs(tzMin) / 60))}:${p(Math.abs(tzMin) % 60)}`;
  return [
    `当前时间(本地): ${now.toISOString()}`,
    `date=${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`,
    `weekday=${wd}`,
    `timezone=${tz}`,
    `以这个 timezone 为准解释一切"今天/明天/下周"之类时间。`,
  ].join('\n');
}

export interface LLMRequest {
  system: string;
  user: string;
  signal?: AbortSignal;
}

export interface LLMConfig {
  provider: Settings['ai_provider'];
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function aiConfig(settings: Settings): LLMConfig {
  return {
    provider: settings.ai_provider,
    baseUrl: settings.ai_base_url.trim(),
    apiKey: settings.ai_api_key.trim(),
    model: settings.ai_model.trim(),
  };
}

export function isAiConfigured(cfg: LLMConfig): boolean {
  // 选了服务商但没填 Key → 仍视为「未配置」，让 UI 引导去设置，而不是先撞 401
  return (cfg.provider === 'claude' || cfg.provider === 'openai') && !!cfg.apiKey;
}

/**
 * 端点 URL 归一化：容忍用户把 baseUrl 填成三种形态。
 *   https://host            → https://host/v1/chat/completions
 *   https://host/v1         → https://host/v1/chat/completions   （不再重复拼 v1）
 *   https://host/v1/chat/completions → 原样
 */
export function endpointUrl(baseUrl: string, provider: 'claude' | 'openai'): string {
  const path = provider === 'claude' ? 'v1/messages' : 'v1/chat/completions';
  const leaf = provider === 'claude' ? 'messages' : 'chat/completions';
  const b = (baseUrl || (provider === 'claude' ? 'https://api.anthropic.com' : 'https://api.openai.com'))
    .replace(/\/+$/, '');
  if (b.endsWith(`/${leaf}`)) return b;
  if (b.endsWith('/v1')) return `${b}/${leaf}`;
  return `${b}/${path}`;
}

function stripJsonFence(text: string): string {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : text).trim();
}

/** 从开头 i 起做括号配平，返回该对象的结束下标（含）；失败 -1。 */
function matchBraces(s: string, i: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = i; j < s.length; j += 1) {
    const ch = s[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) return j; }
  }
  return -1;
}

/**
 * 取 JSON 对象。真实模型常会把 JSON 夹在说明文字里，甚至输出多个对象，
 * 因此按顺序尝试：整段 → 首{末} → 逐个括号配平取第一个可解析对象。
 */
function parseJsonObject(raw: string): unknown {
  const s = stripJsonFence(raw).trim();
  const candidates: string[] = [];
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) candidates.push(s.slice(a, b + 1));
  // 括号配平：每个 '{' 起点各试一次，取第一个合法对象
  let i = s.indexOf('{');
  let guard = 0;
  while (i >= 0 && guard < 40) {
    const end = matchBraces(s, i);
    if (end > i) candidates.push(s.slice(i, end + 1));
    i = s.indexOf('{', i + 1);
    guard += 1;
  }
  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === 'object') return v;
    } catch { /* 试下一个 */ }
  }
  throw new AiHttpError(-1, s.slice(0, 160));
}

/** 服务端错误体里的短句（可行动，不是栈/原始报错文本） */
async function serverHint(res: Response): Promise<string> {
  try {
    const j = await res.json() as Record<string, any>;
    const m = j?.error?.message ?? j?.message ?? j?.detail;
    if (typeof m === 'string' && m.trim()) return m.trim().slice(0, 200);
  } catch { /* 忽略：非 JSON 错误体 */ }
  return '';
}

async function readBody(res: Response): Promise<{ ok: true; text: string } | never> {
  if (res.ok) return { ok: true, text: await res.text() };
  const hint = await serverHint(res);
  throw new AiHttpError(res.status, hint);
}

async function callClaude(cfg: LLMConfig, req: LLMRequest, timeoutMs: number): Promise<string> {
  const url = endpointUrl(cfg.baseUrl, 'claude');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onExternal = () => ctrl.abort();
  req.signal?.addEventListener('abort', onExternal);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: cfg.model || 'claude-sonnet-5-5',
        max_tokens: 2048,
        temperature: 0,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
      }),
    });
    const body = await readBody(res);
    const data = JSON.parse(body.text) as { content?: Array<{ type: string; text?: string }> };
    return data.content?.find((c) => c.type === 'text')?.text ?? '';
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener('abort', onExternal);
  }
}

async function callOpenAI(cfg: LLMConfig, req: LLMRequest, timeoutMs: number): Promise<string> {
  const url = endpointUrl(cfg.baseUrl, 'openai');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onExternal = () => ctrl.abort();
  req.signal?.addEventListener('abort', onExternal);

  const baseBody = {
    model: cfg.model || 'gpt-4o-mini',
    temperature: 0,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
  };
  const post = (body: Record<string, unknown>) => fetch(url, {
    method: 'POST',
    signal: ctrl.signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
  });

  try {
    // 第一发带 JSON mode；部分 OpenAI 兼容端不认 response_format → 400 时去掉重试一次
    let res = await post({ ...baseBody, response_format: { type: 'json_object' } });
    if (!res.ok && res.status === 400) res = await post(baseBody);
    const body = await readBody(res);
    const data = JSON.parse(body.text) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener('abort', onExternal);
  }
}

function engineFor(cfg: LLMConfig, engine: AiEngine): 'claude' | 'openai' | 'fake' {
  if (engine === 'fake') return 'fake';
  if (cfg.provider === 'claude') return 'claude';
  if (cfg.provider === 'openai') return 'openai';
  return 'fake';
}

function toError(e: unknown): { message: AiErrKey; hint?: string } {
  if ((e as Error)?.name === 'AbortError') return { message: 'err.ai.network' };
  if (e instanceof AiHttpError) {
    if (e.status === -1) return { message: 'err.ai.json', hint: e.hint };
    return { message: errKeyOf(e.status), hint: e.hint };
  }
  // fetch TypeError（CSP 拦截 / 断网 / CORS）与 JSON 解析失败之外的一般错误
  const msg = String((e as Error)?.message ?? '');
  if (/no-json-object|bad-json|Unexpected token/i.test(msg)) return { message: 'err.ai.json' };
  if (/Failed to fetch|Load failed|NetworkError|CORS/i.test(msg)) return { message: 'err.ai.network' };
  return { message: 'err.ai.unknown', hint: msg.slice(0, 160) };
}

/**
 * 主入口：跑一次结构化 LLM。
 * @param shape 用于校验返回 JSON 的「字段 → 类型」表；校验不过自动重试 1 次。
 */
export async function runStructuredLLM<T>(
  cfg: LLMConfig,
  engine: AiEngine,
  req: LLMRequest,
  shape: Record<string, 'string' | 'number' | 'boolean' | 'array' | 'any'>,
  hooks?: { fakeData: () => unknown },
  timeoutMs = 30_000,
): Promise<StructuredResult<T>> {
  const real = engineFor(cfg, engine);
  try {
    const content = real === 'fake'
      ? JSON.stringify(hooks?.fakeData() ?? {})
      : real === 'claude'
        ? await callClaude(cfg, req, timeoutMs)
        : await callOpenAI(cfg, req, timeoutMs);

    const obj = parseJsonObject(content || '') as Record<string, unknown>;
    const errs = validateObject(obj, shape);
    if (errs.length) {
      if (real !== 'fake') {
        const retryContent = real === 'claude'
          ? await callClaude(cfg, req, timeoutMs)
          : await callOpenAI(cfg, req, timeoutMs);
        const o2 = parseJsonObject(retryContent) as Record<string, unknown>;
        const e2 = validateObject(o2, shape);
        if (!e2.length) return { status: 'ok', data: o2 as T };
      }
      return { status: 'validation', errors: errs };
    }
    return { status: 'ok', data: obj as T };
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return { status: 'timeout' };
    const { message, hint } = toError(e);
    return { status: 'error', message, hint };
  }
}

/** 极简 schema 校验：按字段名断言 JS 类型；缺字段/类型错都返回。null 视为缺失。 */
export function validateObject(
  obj: Record<string, unknown>,
  shape: Record<string, 'string' | 'number' | 'boolean' | 'array' | 'any'>,
): string[] {
  const errs: string[] = [];
  for (const [k, type] of Object.entries(shape)) {
    const v = obj[k];
    if (v === undefined || v === null) { errs.push(`缺字段 ${k}`); continue; }
    const ok =
      type === 'array' ? Array.isArray(v)
      : type === 'any' ? true
      : typeof v === type;
    if (!ok) errs.push(`${k} 类型应为 ${type}，实际 ${Array.isArray(v) ? 'array' : typeof v}`);
  }
  return errs;
}

/** 设置页「测试连接」：发一条最小请求，返回可行动结论（不抛异常）。 */
export async function testConnection(cfg: LLMConfig, timeoutMs = 20_000): Promise<{ key: AiErrKey | 'ok'; hint?: string }> {
  if (!isAiConfigured(cfg)) return { key: 'err.ai.unknown' };
  try {
    const raw = cfg.provider === 'claude'
      ? await callClaude(cfg, { system: '只返回 {"ok":true} 这样的 JSON，不要解释。', user: 'ping' }, timeoutMs)
      : await callOpenAI(cfg, { system: '只返回 {"ok":true} 这样的 JSON，不要解释。', user: 'ping' }, timeoutMs);
    parseJsonObject(raw);
    return { key: 'ok' };
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return { key: 'err.ai.network', hint: 'timeout' };
    const { message, hint } = toError(e);
    return { key: message, hint };
  }
}