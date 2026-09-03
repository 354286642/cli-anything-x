import { describe, expect, it, vi, beforeEach } from 'vitest';
import { refreshCredential } from '../src/core/auth.js';
import * as config from '../src/core/config.js';
import type { ProjectAuthConfig } from '../src/core/config.js';
import { AnycliError, ErrorCode } from '../src/core/errors.js';

const REFRESH_URL = 'https://api.example.com/user/api/user/createUserSession';

const sessionAuth: ProjectAuthConfig = {
  type: 'session-id',
  refreshUrl: REFRESH_URL,
  extraHeaders: {
    'x-tenant-id': 'demo-service',
    'x-ext-tenant-id': 'demo-service',
  },
};

const tokenAuth: ProjectAuthConfig = {
  type: 'bearer-token',
  token: 'old_token',
  refreshUrl: REFRESH_URL,
  extraHeaders: {
    'x-tenant-id': 'demo-service',
  },
};

describe('refreshCredential', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('未登录（无 sessionId / 无 token）时抛出 AUTH_REQUIRED 错误', async () => {
    vi.spyOn(config, 'getProfile').mockReturnValue({
      env: 'test',
      sessionId: '',
      auth: { type: 'session-id', refreshUrl: REFRESH_URL },
      projects: {},
    });
    vi.spyOn(config, 'getProfileAuthConfig').mockReturnValue(sessionAuth);
    vi.spyOn(config, 'getSessionId').mockReturnValue('');

    await expect(refreshCredential()).rejects.toThrowError(
      new AnycliError(
        ErrorCode.AUTH_REQUIRED,
        '当前未登录，无法刷新，请先执行: anycli auth login',
        'anycli auth login'
      )
    );
  });

  it('未配置刷新接口时，提示需配置 Profile.auth.refreshUrl', async () => {
    vi.spyOn(config, 'getProfile').mockReturnValue({
      env: 'test',
      sessionId: 'old_session_id',
      auth: { type: 'session-id' },
      projects: {},
    });
    vi.spyOn(config, 'getProfileAuthConfig').mockReturnValue({ type: 'session-id' });
    vi.spyOn(config, 'getSessionId').mockReturnValue('old_session_id');

    await expect(refreshCredential()).rejects.toThrowError(
      new AnycliError(
        ErrorCode.CONFIG_MISSING,
        '未配置凭证刷新接口（Profile.auth.refreshUrl），无法自动刷新，请检查配置',
        'anycli config set auth.refresh-url <url>'
      )
    );
  });

  it('session-id 刷新成功时，更新本地 session 并返回新的 sessionId', async () => {
    let currentSession = 'old_session_id';
    vi.spyOn(config, 'getProfile').mockReturnValue({
      env: 'test',
      sessionId: 'old_session_id',
      auth: { type: 'session-id', refreshUrl: REFRESH_URL },
      projects: {},
    });
    vi.spyOn(config, 'getProfileAuthConfig').mockReturnValue(sessionAuth);
    vi.spyOn(config, 'getSessionId').mockImplementation(() => currentSession);
    vi.spyOn(config, 'setSessionId').mockImplementation((id: string) => {
      currentSession = id;
    });
    vi.spyOn(config, 'setProfileField').mockImplementation(() => {});

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

    const result = await refreshCredential();

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
    expect(config.setSessionId).toHaveBeenCalledWith('new_session_id_123');
  });

  it('session-id 刷新接口返回 401 时抛出会话失效错误', async () => {
    vi.spyOn(config, 'getProfile').mockReturnValue({
      env: 'test',
      sessionId: 'old_session_id',
      auth: { type: 'session-id', refreshUrl: REFRESH_URL },
      projects: {},
    });
    vi.spyOn(config, 'getProfileAuthConfig').mockReturnValue(sessionAuth);
    vi.spyOn(config, 'getSessionId').mockReturnValue('old_session_id');
    vi.spyOn(config, 'setProfileField').mockImplementation(() => {});

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 401,
      ok: false,
    } as Response);

    await expect(refreshCredential()).rejects.toThrowError(
      /刷新失败：原凭证已失效或刷新接口未返回新的凭证/
    );
  });

  it('bearer-token 刷新成功时，更新 Profile token 并返回新的 token', async () => {
    let currentToken = 'old_token';
    vi.spyOn(config, 'getProfile').mockReturnValue({
      env: 'test',
      sessionId: '',
      auth: { type: 'bearer-token', token: 'old_token', refreshUrl: REFRESH_URL },
      projects: {},
    });
    vi.spyOn(config, 'getProfileAuthConfig').mockReturnValue(tokenAuth);
    vi.spyOn(config, 'getProfileToken').mockImplementation(() => currentToken);
    vi.spyOn(config, 'setProfileToken').mockImplementation((token: string) => {
      currentToken = token;
    });
    vi.spyOn(config, 'setProfileField').mockImplementation(() => {});

    const mockResponse = {
      success: true,
      code: '0',
      data: {
        token: 'new_token_456',
      },
      msg: '操作成功',
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const result = await refreshCredential();

    expect(result).toBe('new_token_456');
    expect(fetchSpy).toHaveBeenCalledWith(
      REFRESH_URL,
      {
        method: 'GET',
        headers: {
          Authorization: 'Bearer old_token',
          'Content-Type': 'application/json',
          'x-tenant-id': 'demo-service',
        },
      }
    );
    expect(config.setProfileToken).toHaveBeenCalledWith('new_token_456');
  });

  it('bearer-token 未配置刷新接口时提示需配置 Profile.auth.refreshUrl', async () => {
    vi.spyOn(config, 'getProfile').mockReturnValue({
      env: 'test',
      sessionId: '',
      auth: { type: 'bearer-token', token: 'old_token' },
      projects: {},
    });
    vi.spyOn(config, 'getProfileAuthConfig').mockReturnValue({ type: 'bearer-token', token: 'old_token' });
    vi.spyOn(config, 'getProfileToken').mockReturnValue('old_token');

    await expect(refreshCredential()).rejects.toThrowError(
      new AnycliError(
        ErrorCode.CONFIG_MISSING,
        '未配置凭证刷新接口（Profile.auth.refreshUrl），无法自动刷新，请检查配置',
        'anycli config set auth.refresh-url <url>'
      )
    );
  });
});
