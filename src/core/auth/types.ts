import type { ProjectAuthConfig, ProfileData, AuthStrategyType } from '../config.js';

/** 鉴权策略上下文（一次请求/一次刷新时携带的项目与配置上下文） */
export interface AuthContext {
  project: string;
  auth: ProjectAuthConfig;
  profile: ProfileData;
}

/** 鉴权状态查询结果 */
export interface AuthStatus {
  loggedIn: boolean;
  type: AuthStrategyType | string;
  detail?: string;
}

/**
 * 可插拔鉴权策略接口。
 * 框架内置 session-id / bearer-token，其余（oauth2/api-key）可据此扩展实现。
 */
export interface AuthStrategy {
  readonly type: AuthStrategyType | string;
  /** 向请求头注入鉴权信息（如 x-session-id、Authorization: Bearer xxx） */
  applyHeaders(
    headers: Record<string, string>,
    ctx: AuthContext
  ): Record<string, string> | Promise<Record<string, string>>;
  /** 主动获取/登录凭证（交互输入、浏览器授权等），未登录时的入口 */
  ensureAuth?(ctx: AuthContext): Promise<void>;
  /** 刷新凭证；返回 true 表示刷新成功。请求 401 时由 client 自动触发并重试一次 */
  refresh?(ctx: AuthContext): Promise<boolean>;
  /** 查询当前登录状态 */
  status(ctx: AuthContext): AuthStatus;
  /** 清除本策略的本地凭证 */
  logout?(ctx: AuthContext): Promise<void>;
}
