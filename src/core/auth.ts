import { getSessionId, setSessionId, getProjectConfig, getProfile, getProfileAuthConfig, getProfileToken } from './config.js';
import type { AuthStrategyType } from './config.js';
import { AnycliError, ErrorCode } from './errors.js';
import type { AuthStrategy, AuthContext } from './auth/types.js';
import { sessionIdStrategy } from './auth/session-id.js';
import { bearerTokenStrategy } from './auth/bearer-token.js';

/** 内置策略注册表（可扩展） */
const STRATEGIES: Record<string, AuthStrategy> = {
  'session-id': sessionIdStrategy,
  'bearer-token': bearerTokenStrategy,
};

/** 按类型获取鉴权策略 */
export function getStrategy(type: AuthStrategyType | string): AuthStrategy {
  const strategy = STRATEGIES[type];
  if (!strategy) {
    throw new AnycliError(
      ErrorCode.INVALID_PARAMS,
      `未知的鉴权类型: ${type}（当前支持: session-id, bearer-token）`
    );
  }
  return strategy;
}

export function requireSession(): string {
  const sessionId = getSessionId();
  if (!sessionId) {
    throw new AnycliError(
      ErrorCode.AUTH_REQUIRED,
      '未登录，请先执行: anycli auth login',
      'anycli auth login'
    );
  }
  return sessionId;
}

export function requireProject(projectName: string) {
  const config = getProjectConfig(projectName);
  if (!config) {
    throw new AnycliError(
      ErrorCode.CONFIG_MISSING,
      `项目 "${projectName}" 未配置，请先执行: anycli config init`,
      'anycli config init'
    );
  }
  return config;
}

/**
 * 静默刷新当前 Profile 的本地凭证（session-id / bearer-token 通用）。
 * 使用 Profile.auth 的统一配置：refreshUrl 用户自填的刷新接口、refreshIntervalMs 刷新间隔。
 * 返回新的凭证（sessionId 或 token）；刷新接口返回体约定 { success, data: { sessionId? | token? } }。
 */
export async function refreshCredential(): Promise<string> {
  const profile = getProfile();
  const profileAuth = profile.auth || { type: 'session-id' as AuthStrategyType };
  const isToken = profileAuth.type === 'bearer-token';
  const credential = isToken ? profileAuth.token : getSessionId();
  if (!credential) {
    throw new AnycliError(
      ErrorCode.AUTH_REQUIRED,
      '当前未登录，无法刷新，请先执行: anycli auth login',
      'anycli auth login'
    );
  }

  const auth = getProfileAuthConfig();
  const strategy = getStrategy(auth.type);
  if (!auth.refreshUrl || !strategy.refresh) {
    throw new AnycliError(
      ErrorCode.CONFIG_MISSING,
      '未配置凭证刷新接口（Profile.auth.refreshUrl），无法自动刷新，请检查配置',
      'anycli config set auth.refresh-url <url>'
    );
  }

  const ctx: AuthContext = { project: '', auth, profile };
  const ok = await strategy.refresh(ctx);
  if (ok) return isToken ? getProfileToken() : getSessionId();

  throw new AnycliError(
    ErrorCode.AUTH_EXPIRED,
    '刷新失败：原凭证已失效或刷新接口未返回新的凭证，请重新登录',
    'anycli auth login'
  );
}

export { getSessionId, setSessionId, sessionIdStrategy, bearerTokenStrategy };
export type { AuthStrategy, AuthContext } from './auth/types.js';
