import { getSessionId, setSessionId, setProfileField } from '../config.js';
import type { AuthStrategy, AuthContext, AuthStatus } from './types.js';
import { AnycliError, ErrorCode } from '../errors.js';

/**
 * session-id 鉴权策略。
 * - 凭证：Profile 级 sessionId（一次登录，多项目共享同一会话）。
 * - 请求头：x-session-id。
 * - 刷新：仅当 Profile.auth.refreshUrl 配置时启用（用户自填刷新接口），
 *   返回体约定 { success, data: { sessionId } }。
 */
export const sessionIdStrategy: AuthStrategy = {
  type: 'session-id',

  applyHeaders(headers, _ctx): Record<string, string> {
    const sessionId = getSessionId();
    if (!sessionId) {
      throw new AnycliError(
        ErrorCode.AUTH_REQUIRED,
        '未登录，请先执行: anycli auth login',
        'anycli auth login'
      );
    }
    headers['x-session-id'] = sessionId;
    return headers;
  },

  async refresh(ctx): Promise<boolean> {
    const { auth } = ctx;
    if (!auth.refreshUrl) return false;
    const sessionId = getSessionId();
    if (!sessionId) return false;

    const headers: Record<string, string> = {
      'x-session-id': sessionId,
      ...(auth.extraHeaders || {}),
    };

    let response: Response;
    try {
      response = await fetch(auth.refreshUrl, { method: 'GET', headers });
    } catch (error) {
      throw new AnycliError(
        ErrorCode.NETWORK_ERROR,
        `刷新请求失败: ${error instanceof Error ? error.message : '未知错误'}`
      );
    }

    if (response.status === 401) return false; // 原会话已失效，需重新登录
    if (!response.ok) {
      throw new AnycliError(
        ErrorCode.AUTH_EXPIRED,
        `刷新失败: HTTP ${response.status} ${response.statusText}`
      );
    }

    const body = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      data?: { sessionId?: string };
      msg?: string;
    };

    if (body.success && body.data?.sessionId) {
      setSessionId(body.data.sessionId);
      setProfileField('sessionUpdatedAt', Date.now());
      return true;
    }
    return false;
  },

  status(_ctx): AuthStatus {
    const sessionId = getSessionId();
    return {
      loggedIn: !!sessionId,
      type: 'session-id',
      detail: sessionId ? `${sessionId.slice(0, 8)}...` : undefined,
    };
  },

  async logout(): Promise<void> {
    setSessionId('');
  },
};
