import { describe, expect, it, vi, beforeEach } from 'vitest';
import { warnIfInsecureHttp, shouldWarnInsecureHttp } from '../src/core/security.js';
import * as config from '../src/core/config.js';
import * as output from '../src/core/output.js';

/**
 * 说明：本文件只测「跨模块」可安全 mock 的行为。
 * security.ts 通过 import 调用 config.getProfile（跨模块绑定），vi.spyOn 可拦截；
 * 反之 config.ts 模块内部互相调用不走 exports，spyOn 无法拦截且会真实读写用户 store，
 * 因此禁止在此直接调用 config 内部函数做断言。
 */
function mockProfile(auth: Partial<config.ProfileAuthConfig> = {}) {
  vi.spyOn(config, 'getProfile').mockReturnValue({
    env: 'test',
    sessionId: '',
    auth: { type: 'session-id', ...auth } as config.ProfileAuthConfig,
    projects: {},
  });
}

describe('传输安全 warnIfInsecureHttp', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('http 明文 URL 默认输出风险警告', () => {
    const warnSpy = vi.spyOn(output, 'warn').mockImplementation(() => {});
    mockProfile();
    warnIfInsecureHttp('http://gw-http-a.example.com');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('http 明文传输');
  });

  it('https URL 不提示', () => {
    const warnSpy = vi.spyOn(output, 'warn').mockImplementation(() => {});
    mockProfile();
    warnIfInsecureHttp('https://gw.example.com');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warnInsecureHttp=false 时 http 也不提示', () => {
    const warnSpy = vi.spyOn(output, 'warn').mockImplementation(() => {});
    mockProfile({ warnInsecureHttp: false });
    warnIfInsecureHttp('http://gw-http-b.example.com');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('同一 http URL 只提示一次', () => {
    const warnSpy = vi.spyOn(output, 'warn').mockImplementation(() => {});
    mockProfile();
    warnIfInsecureHttp('http://gw-http-c.example.com');
    warnIfInsecureHttp('http://gw-http-c.example.com');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('shouldWarnInsecureHttp 默认 true', () => {
    mockProfile();
    expect(shouldWarnInsecureHttp()).toBe(true);
  });

  it('shouldWarnInsecureHttp 识别显式 false', () => {
    mockProfile({ warnInsecureHttp: false });
    expect(shouldWarnInsecureHttp()).toBe(false);
  });
});
