import inquirer from 'inquirer';
import { getProfileToken, setProfileToken, setProfileAuthField, setProfileField } from '../config.js';
import type { AuthStrategy, AuthContext, AuthStatus } from './types.js';
import { AnycliError, ErrorCode } from '../errors.js';
import { warnIfInsecureHttp } from '../security.js';

/**
 * bearer-token 鉴权策略。
 * - 凭证：Profile 级 token（存于 Profile.auth.token，整个 CLI 一套授权，跟随环境）。
 * - 请求头：Authorization: Bearer <token>。
 * - 获取：anycli auth login（浏览器授权页 / 手动粘贴）。
 * - 刷新：仅当 Profile.auth.refreshUrl 配置时启用（用户自填刷新接口），
 *   返回体约定 { success, data: { token } }。
 */
export const bearerTokenStrategy: AuthStrategy = {
  type: 'bearer-token',

  applyHeaders(headers, ctx): Record<string, string> {
    const token = ctx.auth.token || '';
    if (!token) {
      throw new AnycliError(
        ErrorCode.AUTH_REQUIRED,
        '未配置 Bearer Token，请先执行: anycli auth login',
        'anycli auth login'
      );
    }
    headers['Authorization'] = `Bearer ${token}`;
    return headers;
  },

  async ensureAuth(ctx): Promise<void> {
    if (ctx.auth.token) return;
    const { token } = await inquirer.prompt<{ token: string }>([
      {
        type: 'password',
        name: 'token',
        message: '请输入 Bearer Token:',
        validate: (input: string) => input.trim().length > 0 || 'token 不能为空',
      },
    ]);
    setProfileAuthField('type', 'bearer-token');
    setProfileToken(token.trim());
  },

  async refresh(ctx): Promise<boolean> {
    const { auth } = ctx;
    if (!auth.refreshUrl) return false;
    warnIfInsecureHttp(auth.refreshUrl, '刷新接口与 token 可能被明文传输');
    const token = auth.token || '';
    if (!token) return false;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
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

    if (response.status === 401) return false; // 原 token 已失效，需重新登录
    if (!response.ok) {
      throw new AnycliError(
        ErrorCode.AUTH_EXPIRED,
        `刷新失败: HTTP ${response.status} ${response.statusText}`
      );
    }

    const body = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      data?: { token?: string };
      msg?: string;
    };

    if (body.success && body.data?.token) {
      setProfileToken(body.data.token);
      setProfileField('sessionUpdatedAt', Date.now());
      return true;
    }
    return false;
  },

  status(ctx): AuthStatus {
    const token = ctx.auth.token || getProfileToken();
    return {
      loggedIn: !!token,
      type: 'bearer-token',
      detail: token ? `${token.slice(0, 6)}...` : undefined,
    };
  },

  async logout(): Promise<void> {
    setProfileAuthField('token', undefined);
  },
};
