import { describe, it, expect } from 'vitest';
import { sanitizeNetworkLogs } from '../src/core/live-lens/sanitizer.js';
import { normalizeUrlPath } from '../src/core/live-lens/url-normalizer.js';
import { inferValueFlowDependencies } from '../src/core/live-lens/value-flow-engine.js';
import { generateLiveLensFlow } from '../src/core/live-lens/flow-generator.js';
import type { RawNetworkLogItem } from '../src/core/live-lens/sanitizer.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('CLI-Anything-X Live Lens 2.0 P0 核心引擎测试', () => {
  it('Sanitizer: 必须自动擦除 Cookie 与 Authorization 敏感 Header，混淆密码字段', () => {
    const rawLogs: RawNetworkLogItem[] = [
      {
        requestId: 'req-1',
        url: 'https://api.example.com/user/api/user/createUserSession',
        method: 'GET',
        headers: {
          'Cookie': 'sessionId=abc123xyz',
          'Authorization': 'Bearer token123',
          'x-tenant-id': 'demo-service',
        },
        postData: JSON.stringify({ password: 'mySecretPassword', username: 'demo-user' }),
        responseBody: JSON.stringify({ code: '0', data: { userToken: 'secretTokenValue' } }),
        timestamp: Date.now(),
        resourceType: 'XHR',
      },
    ];

    const sanitized = sanitizeNetworkLogs(rawLogs);
    expect(sanitized[0].headers['Cookie']).toBe('{{SESSION_ID}}');
    expect(sanitized[0].headers['Authorization']).toBe('{{SESSION_ID}}');
    expect(sanitized[0].headers['x-tenant-id']).toBe('demo-service');
    expect(sanitized[0].postData).toContain('"password":"***"');
    expect(sanitized[0].responseBody).toContain('"userToken":"***"');
  });

  it('Sanitizer: 仅保留 /api 路径段的业务接口', () => {
    const rawLogs: RawNetworkLogItem[] = [
      {
        requestId: 'tracker',
        url: 'https://api.example.com/tracker-service/event',
        method: 'POST', headers: {}, timestamp: Date.now(), resourceType: 'XHR',
      },
      {
        requestId: 'image',
        url: 'https://api.example.com/img/upload',
        method: 'POST', headers: {}, timestamp: Date.now(), resourceType: 'XHR',
      },
      {
        requestId: 'api-direct',
        url: 'https://api.example.com/api/workflow/list',
        method: 'POST', headers: {}, timestamp: Date.now(), resourceType: 'XHR',
      },
      {
        requestId: 'api-prefixed',
        url: 'https://api.example.com/demo-service/api/flow/create?source=web',
        method: 'POST', headers: {}, timestamp: Date.now(), resourceType: 'XHR',
      },
      {
        requestId: 'api-options',
        url: 'https://api.example.com/api/flow/create',
        method: 'OPTIONS', headers: {}, timestamp: Date.now(), resourceType: 'XHR',
      },
      {
        requestId: 'api-similar',
        url: 'https://api.example.com/apiary/health',
        method: 'POST', headers: {}, timestamp: Date.now(), resourceType: 'XHR',
      },
    ];

    const sanitized = sanitizeNetworkLogs(rawLogs);
    expect(sanitized.map((log) => log.requestId)).toEqual(['api-direct', 'api-prefixed']);
  });

  it('UrlNormalizer: 必须正确剥离 Origin 与 Project Prefix，识别跨 Host 野生接口', () => {
    const gateway = 'https://api.example.com';
    const prefix = 'user';

    // 内部同源接口
    const norm1 = normalizeUrlPath(
      'https://api.example.com/user/api/customer/list',
      gateway,
      prefix
    );
    expect(norm1.normalizedPath).toBe('/api/customer/list');
    expect(norm1.isCrossHost).toBe(false);

    // 外部跨 Host 接口
    const norm2 = normalizeUrlPath(
      'https://external-api.thirdparty.com/v1/notify',
      gateway,
      prefix
    );
    expect(norm2.normalizedPath).toBe('/v1/notify');
    expect(norm2.isCrossHost).toBe(true);
  });

  it('ValueFlowEngine: 必须正确跨步骤搜寻匹配前序 Response 的依赖路径', () => {
    const mockLogs: RawNetworkLogItem[] = [
      {
        requestId: 'req-1',
        url: 'https://api.example.com/user/api/customer/search',
        method: 'POST',
        headers: {},
        postData: JSON.stringify({ name: '李四' }),
        responseBody: JSON.stringify({
          code: '0',
          data: {
            list: [{ id: 10086, name: '李四' }],
          },
        }),
        timestamp: Date.now(),
        resourceType: 'XHR',
      },
      {
        requestId: 'req-2',
        url: 'https://api.example.com/user/api/customer/enable',
        method: 'POST',
        headers: {},
        postData: JSON.stringify({ customerId: 10086 }),
        responseBody: JSON.stringify({ code: '0', msg: '启用成功' }),
        timestamp: Date.now() + 1000,
        resourceType: 'XHR',
      },
    ];

    const deps = inferValueFlowDependencies(mockLogs);
    expect(deps.length).toBeGreaterThan(0);
    expect(deps[0].targetStepIndex).toBe(2);
    expect(deps[0].paramName).toBe('customerId');
    expect(deps[0].sourceStepIndex).toBe(1);
    expect(deps[0].sourceJsonPath).toBe('$.data.list[0].id');
    expect(deps[0].matchedValue).toBe(10086);
  });

  it('FlowGenerator: 必须组装出合规的 FlowData 对象并成功渲染 SKILL.md', () => {
    const mockLogs: RawNetworkLogItem[] = [
      {
        requestId: 'req-1',
        url: 'https://api.example.com/user/api/customer/enable',
        method: 'POST',
        headers: {},
        postData: JSON.stringify({ id: 10086 }),
        responseBody: JSON.stringify({ code: '0' }),
        timestamp: Date.now(),
        resourceType: 'XHR',
      },
    ];

    const originalCwd = process.cwd();
    const testRoot = mkdtempSync(join(tmpdir(), 'anycli-live-lens-'));
    try {
      process.chdir(testRoot);
      const res = generateLiveLensFlow({
        project: 'demo', business: 'unit-test-flow', networkLogs: mockLogs, dependencies: [], intentText: '单元测试意图',
      });
      expect(res.flowData.meta.name).toBe('flow-demo-unit-test-flow');
      expect(res.flowData.steps.length).toBe(1);
      expect(res.flowData.apis.length).toBe(1);
      expect(res.flowData.endApi?.method).toBe('POST');
    } finally {
      process.chdir(originalCwd);
      rmSync(testRoot, { recursive: true, force: true });
    }
  });
});
