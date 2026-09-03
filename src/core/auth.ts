import { getSessionId, setSessionId, getProjectConfig, getProfile, resolveAuthFromProjectConfig } from './config.js';
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
 * 静默刷新本地凭证（session-id 策略）。
 * 遍历当前 Profile 下所有配置了 auth.refreshUrl 的 session-id 项目逐个尝试刷新，
 * 任一成功即返回新 sessionId；未配置任何可刷新项目时明确报错。
 * 是否启用自动刷新由项目配置决定（公司项目在私有配置中提供 refreshUrl 与 8h 间隔）。
 */
export async function refreshSessionId(): Promise<string> {
  const sessionId = getSessionId();
  if (!sessionId) {
    throw new AnycliError(
      ErrorCode.AUTH_REQUIRED,
      '当前未登录，无法刷新，请先执行: anycli auth login',
      'anycli auth login'
    );
  }

  const profile = getProfile();
  const projects = Object.entries(profile.projects || {});
  if (projects.length === 0) {
    throw new AnycliError(
      ErrorCode.CONFIG_MISSING,
      '当前 Profile 下未配置任何项目，无法刷新。请先运行: anycli init <project> 或 anycli config add-project'
    );
  }

  let attempted = 0;
  for (const [project, projectConfig] of projects) {
    const auth = resolveAuthFromProjectConfig(projectConfig);
    if (auth.type !== 'session-id') continue;
    const strategy = getStrategy(auth.type);
    if (!auth.refreshUrl || !strategy.refresh) continue;

    attempted++;
    const ctx: AuthContext = { project, auth, profile };
    const ok = await strategy.refresh(ctx);
    if (ok) return getSessionId();
  }

  if (attempted === 0) {
    throw new AnycliError(
      ErrorCode.CONFIG_MISSING,
      '未配置任何可自动刷新的项目（需在项目配置中设置 auth.refreshUrl），请检查配置',
      'anycli config'
    );
  }

  throw new AnycliError(
    ErrorCode.AUTH_EXPIRED,
    '刷新失败：原 Session 已失效或刷新接口未返回新的 sessionId，请重新登录',
    'anycli auth login'
  );
}

export { getSessionId, setSessionId, sessionIdStrategy, bearerTokenStrategy };
export type { AuthStrategy, AuthContext } from './auth/types.js';
