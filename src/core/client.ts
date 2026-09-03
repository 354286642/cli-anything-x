import { getStrategy, requireProject } from './auth.js';
import { AnycliError, ErrorCode } from './errors.js';
import { getGatewayUrl, getProjectAuthConfig, getProfile } from './config.js';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeout?: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
  };
}

const isVerbose = () => process.argv.includes('--verbose') || process.env.ANYCLI_VERBOSE === '1';

function log(...args: unknown[]): void {
  if (isVerbose()) {
    console.error('[anycli:debug]', ...args);
  }
}

/** 组装基础请求头：Content-Type + 项目级静态请求头（auth.extraHeaders） */
async function buildHeaders(projectName: string, ctx: { project: string; auth: ReturnType<typeof getProjectAuthConfig>; profile: ReturnType<typeof getProfile> }): Promise<Record<string, string>> {
  const strategy = getStrategy(ctx.auth.type);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(ctx.auth.extraHeaders || {}),
  };
  await strategy.applyHeaders(headers, ctx);
  return headers;
}

export function createClient(projectName: string) {
  const projectConfig = requireProject(projectName);
  const auth = getProjectAuthConfig(projectName);
  const profile = getProfile();
  const strategy = getStrategy(auth.type);
  const ctx = { project: projectName, auth, profile };

  const baseUrl = projectConfig.baseUrl || getGatewayUrl();

  async function doRequest<T = unknown>(options: RequestOptions, headers: Record<string, string>): Promise<T> {
    const { method = 'GET', path, query, body, timeout = 30000 } = options;

    const prefix = projectConfig.prefix || '';
    let url = `${baseUrl}/${prefix}${path}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          params.append(key, String(value));
        }
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

    log(`→ ${method} ${url}`);
    log(`  headers: ${JSON.stringify({ ...headers, Authorization: headers.Authorization ? `${String(headers.Authorization).slice(0, 12)}...` : undefined, 'x-session-id': headers['x-session-id'] ? `${String(headers['x-session-id']).slice(0, 8)}...` : undefined })}`);
    if (body) log(`  body: ${JSON.stringify(body).slice(0, 200)}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      log(`← ${response.status} ${response.statusText}`);

      if (response.status === 401) {
        throw new AnycliError(
          ErrorCode.AUTH_EXPIRED,
          '认证已过期或凭证无效',
          `anycli auth login`
        );
      }

      if (response.status === 403) {
        throw new AnycliError(ErrorCode.FORBIDDEN, '权限不足，无法访问该资源');
      }

      if (response.status === 404) {
        throw new AnycliError(ErrorCode.NOT_FOUND, `资源不存在: ${method} ${path}`);
      }

      if (response.status === 405) {
        throw new AnycliError(
          ErrorCode.INVALID_PARAMS,
          `请求方法不允许: ${method} ${path}（请检查接口路径和方法是否正确）`
        );
      }

      if (response.status === 429) {
        throw new AnycliError(ErrorCode.RATE_LIMITED, '请求过于频繁，请稍后重试');
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        log(`  response: ${text.slice(0, 500)}`);
        throw new AnycliError(
          ErrorCode.SERVER_ERROR,
          `服务器错误: HTTP ${response.status} ${response.statusText}`
        );
      }

      const json = await response.json() as T;
      log(`  data: ${JSON.stringify(json).slice(0, 300)}`);
      return json;
    } catch (error) {
      if (error instanceof AnycliError) throw error;

      if (error instanceof Error && error.name === 'AbortError') {
        throw new AnycliError(ErrorCode.TIMEOUT, `请求超时 (${timeout}ms)`);
      }

      throw new AnycliError(
        ErrorCode.NETWORK_ERROR,
        `网络错误: ${error instanceof Error ? error.message : '未知错误'}`,
        '请检查网络连接和 baseUrl 配置'
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async function request<T = unknown>(options: RequestOptions): Promise<T> {
    let headers = await buildHeaders(projectName, ctx);
    try {
      return await doRequest<T>(options, headers);
    } catch (error) {
      // 401 → 刷新一次 → 重试一次
      if (error instanceof AnycliError && error.code === ErrorCode.AUTH_EXPIRED && strategy.refresh) {
        const ok = await strategy.refresh(ctx);
        if (ok) {
          headers = await buildHeaders(projectName, ctx);
          return await doRequest<T>(options, headers);
        }
      }
      throw error;
    }
  }

  return {
    get: <T = unknown>(path: string, query?: RequestOptions['query']) =>
      request<T>({ method: 'GET', path, query }),
    post: <T = unknown>(path: string, body?: unknown, query?: RequestOptions['query']) =>
      request<T>({ method: 'POST', path, body, query }),
    put: <T = unknown>(path: string, body?: unknown) =>
      request<T>({ method: 'PUT', path, body }),
    delete: <T = unknown>(path: string, query?: RequestOptions['query']) =>
      request<T>({ method: 'DELETE', path, query }),
    request,
  };
}

export type AnycliClient = ReturnType<typeof createClient>;
