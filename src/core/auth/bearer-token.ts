import inquirer from 'inquirer';
import { getProjectConfig, setProjectConfig } from '../config.js';
import type { AuthStrategy, AuthContext, AuthStatus } from './types.js';
import { AnycliError, ErrorCode } from '../errors.js';

/**
 * bearer-token 鉴权策略。
 * - 凭证：项目级 auth.token，存于 ~/.anycli/config 的项目配置中（按项目隔离）。
 * - 请求头：Authorization: Bearer <token>。
 * - 获取方式：默认交互输入（anycli auth token <project>），用户也可直接编辑配置文件。
 */
export const bearerTokenStrategy: AuthStrategy = {
  type: 'bearer-token',

  applyHeaders(headers, ctx): Record<string, string> {
    const token = ctx.auth.token || '';
    if (!token) {
      throw new AnycliError(
        ErrorCode.AUTH_REQUIRED,
        `项目 "${ctx.project}" 未配置 token，请先执行: anycli auth token ${ctx.project}`,
        `anycli auth token ${ctx.project}`
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
        message: `请输入项目 "${ctx.project}" 的 Bearer Token:`,
        validate: (input: string) => input.trim().length > 0 || 'token 不能为空',
      },
    ]);
    const config = getProjectConfig(ctx.project);
    if (!config) {
      throw new AnycliError(
        ErrorCode.CONFIG_MISSING,
        `项目 "${ctx.project}" 未配置，请先执行: anycli config init`,
        'anycli config init'
      );
    }
    setProjectConfig(ctx.project, {
      ...config,
      auth: { ...ctx.auth, type: 'bearer-token', token: token.trim() },
    });
  },

  status(ctx): AuthStatus {
    return {
      loggedIn: !!ctx.auth.token,
      type: 'bearer-token',
      detail: ctx.auth.token ? `${ctx.auth.token.slice(0, 6)}...` : undefined,
    };
  },

  async logout(ctx): Promise<void> {
    const config = getProjectConfig(ctx.project);
    if (config?.auth?.type === 'bearer-token') {
      const { token: _removed, ...rest } = config.auth;
      void _removed;
      setProjectConfig(ctx.project, { ...config, auth: rest });
    }
  },
};
