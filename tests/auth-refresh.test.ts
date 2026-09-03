import { describe, expect, it, vi, beforeEach } from 'vitest';
import { refreshSessionId } from '../src/core/auth.js';
import * as config from '../src/core/config.js';
import { AnycliError, ErrorCode } from '../src/core/errors.js';

const REFRESH_URL = 'https://api.example.com/user/api/user/createUserSession';

const profileWithDemo = (extra?: Record<string, unknown>) => ({
  env: 'test' as const,
  sessionId: 'old_session_id',
  projects: {
    demo: {
      prefix: 'api',
      auth: {
        type: 'session-id' as const,
        refreshUrl: REFRESH_URL,
        extraHeaders: {
          'x-tenant-id': 'demo-service',
          'x-ext-tenant-id': 'demo-service',
        },
      },
      ...extra,
    },
  },
});

describe('refreshSessionId', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('如果当前未登录，直接抛出 AUTH_REQUIRED 错误', async () => {
    vi.spyOn(config, 'getSessionId').mockReturnValue('');

    await expect(refreshSessionId()).rejects.toThrowError(
      new AnycliError(
        ErrorCode.AUTH_REQUIRED,
        '当前未登录，无法刷新，请先执行: anycli auth login',
        'anycli auth login'
      )
    );
  });

  it('如果当前 Profile 下没有项目配置，抛出 CONFIG_MISSING 错误', async () => {
    vi.spyOn(config, 'getSessionId').mockReturnValue('old_session_id');
    vi.spyOn(config, 'getProfile').mockReturnValue({
      env: 'test',
      sessionId: 'old_session_id',
      projects: {},
    });

    await expect(refreshSessionId()).rejects.toThrowError(
      new AnycliError(
        ErrorCode.CONFIG_MISSING,
        '当前 Profile 下未配置任何项目，无法刷新。请先运行: anycli init <project> 或 anycli config add-project'
      )
    );
  });

  it('没有任何项目配置 auth.refreshUrl 时，提示需在配置中提供刷新接口', async () => {
    vi.spyOn(config, 'getSessionId').mockReturnValue('old_session_id');
    vi.spyOn(config, 'getProfile').mockReturnValue({
      env: 'test',
      sessionId: 'old_session_id',
      projects: {
        demo: { prefix: 'api', auth: { type: 'session-id' as const } },
      },
    });

    await expect(refreshSessionId()).rejects.toThrowError(
      new AnycliError(
        ErrorCode.CONFIG_MISSING,
        '未配置任何可自动刷新的项目（需在项目配置中设置 auth.refreshUrl），请检查配置',
        'anycli config'
      )
    );
  });

  it('接口刷新成功时，更新本地 session 并返回新的 sessionId', async () => {
    let currentSession = 'old_session_id';
    vi.spyOn(config, 'getSessionId').mockImplementation(() => currentSession);
    vi.spyOn(config, 'getProfile').mockReturnValue(profileWithDemo());

    const setSessionIdSpy = vi.spyOn(config, 'setSessionId').mockImplementation((id: string) => {
      currentSession = id;
    });
    const setProfileFieldSpy = vi.spyOn(config, 'setProfileField').mockImplementation(() => {});

    const mockResponse = {
      success: true,
      code: '0',
      data: {
        sessionId: 'new_session_id_123',
      },
      msg: '操作成功',
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const result = await refreshSessionId();

    expect(result).toBe('new_session_id_123');
    expect(fetchSpy).toHaveBeenCalledWith(
      REFRESH_URL,
      {
        method: 'GET',
        headers: {
          'x-session-id': 'old_session_id',
          'x-tenant-id': 'demo-service',
          'x-ext-tenant-id': 'demo-service',
        },
      }
    );
    expect(setSessionIdSpy).toHaveBeenCalledWith('new_session_id_123');
    expect(setProfileFieldSpy).toHaveBeenCalledWith('sessionUpdatedAt', expect.any(Number));
  });

  it('接口返回 401 时抛出会话失效错误', async () => {
    vi.spyOn(config, 'getSessionId').mockReturnValue('old_session_id');
    vi.spyOn(config, 'getProfile').mockReturnValue(profileWithDemo());

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 401,
      ok: false,
    } as Response);

    await expect(refreshSessionId()).rejects.toThrowError(
      /刷新失败：原 Session 已失效或刷新接口未返回新的 sessionId/
    );
  });

  it('只刷新配置了 refreshUrl 的 session-id 项目，跳过其他策略', async () => {
    vi.spyOn(config, 'getSessionId').mockReturnValue('old_session_id');
    vi.spyOn(config, 'getProfile').mockReturnValue({
      env: 'test',
      sessionId: 'old_session_id',
      projects: {
        other: { prefix: 'api', auth: { type: 'bearer-token' as const, token: 'abc' } },
      },
    });

    await expect(refreshSessionId()).rejects.toThrowError(
      new AnycliError(
        ErrorCode.CONFIG_MISSING,
        '未配置任何可自动刷新的项目（需在项目配置中设置 auth.refreshUrl），请检查配置',
        'anycli config'
      )
    );
  });
});
