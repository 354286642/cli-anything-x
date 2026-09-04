import { getProfile } from './config.js';
import { warn } from './output.js';

/**
 * 传输安全：对 http 明文 URL 提示风险。
 * 由 Profile.auth.warnInsecureHttp 控制，默认提示（true）；设为 false 可关闭提示。
 */
export function shouldWarnInsecureHttp(): boolean {
  return getProfile().auth?.warnInsecureHttp !== false;
}

const warned = new Set<string>();

/** 若 URL 为 http 且未关闭风险提示，输出一次警告（同一 URL 只提示一次）。 */
export function warnIfInsecureHttp(url: string, hint = '会话凭证可能被明文传输'): void {
  if (!url || !shouldWarnInsecureHttp()) return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return; // 非法 URL 忽略
  }
  if (parsed.protocol !== 'http:') return;
  if (warned.has(url)) return;
  warned.add(url);
  warn(`${url} 使用 http 明文传输，${hint}。生产环境建议使用 https；如需关闭此提示：anycli config set auth.warn-insecure-http false`);
}
