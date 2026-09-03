import { describe, it, expect } from 'vitest';
import {
  SESSION_PLACEHOLDER,
  FEISHU_SESSION_FETCH_GUIDE,
  resolveTextVariables,
  buildFullUrl,
  buildCurlBlock,
  buildStandaloneFiles,
  exportStandaloneZip,
  sanitizeAnycliRefs,
  anycliRequestToCurl,
} from '../src/core/standalone-export.js';
import type { ExportContext } from '../src/core/standalone-export.js';
import type { ModuleRegistry } from '../src/core/skill-builder.js';

const ctx: ExportContext = {
  baseUrl: 'https://api.example.com',
  envLabel: '正式环境 (prod)',
  prefix: 'demo-service',
  tenantId: 'demo-service',
  extTenantId: 'demo-service',
  exportedAt: '2026-08-10T12:00:00.000Z',
};
const vars = { 'api.prefix': '/api' };

const registry: ModuleRegistry = {
  module: 'demo-order',
  version: '1.0.0',
  description: '样品需求模块',
  triggers: ['样品'],
  apis: [
    {
      id: 'sample-list',
      summary: '样品列表',
      method: 'POST',
      path: '/${api.prefix}/sample/list',
      level: 'read',
      bodyParams: [{ name: 'pageNum', type: 'number', required: true, desc: '页码' }],
      bodyTemplate: { pageNum: 1, pageSize: 20, data: {} },
      enrichment: {
        enrichedAt: '2026-08-09T10:00:00Z',
        enrichedBy: 'codex',
        confidence: 'high',
        summary: '样品服务聚合查询',
        businessRules: ['库存为 0 的样品不出现在列表'],
        validations: [],
        callChain: [],
        errorScenarios: [],
      },
    },
    {
      id: 'sample-detail',
      summary: '样品详情',
      method: 'GET',
      path: '/${api.prefix}/sample/detail',
      level: 'read',
      queryParams: [{ name: 'id', type: 'string', required: true, desc: '样品 ID' }],
      prerequisites: ['已登录（anycli auth status）'],
      examples: [
        { title: '指定样品', command: 'anycli request demo GET /${api.prefix}/sample/detail --query \'{"id":"S001"}\'' },
      ],
    },
  ],
  errorHandling: [{ code: 'AUTH_EXPIRED', judgment: 'Session 过期', action: '`anycli auth login` 重新登录' }],
};

function curlLines(block: string): string[] {
  const lines = block.split('\n');
  expect(lines[0]).toBe('```bash');
  expect(lines[lines.length - 1]).toBe('```');
  return lines.slice(1, -1);
}

describe('resolveTextVariables', () => {
  it('不破坏 https:// 前缀（不整体折叠斜杠）', () => {
    const text = '网关 https://api.example.com 地址';
    const { resolved, unresolved } = resolveTextVariables(text, {});
    expect(resolved).toBe(text);
    expect(unresolved).toEqual([]);
  });

  it('变量值以 / 开头且占位符前是 / 时去掉值的前导 /', () => {
    const { resolved } = resolveTextVariables('path/${p}/x', { p: '/api' });
    expect(resolved).toBe('path/api/x');
  });

  it('未知占位符原样保留并收集 unresolved', () => {
    const { resolved, unresolved } = resolveTextVariables('${a}/${b}/${a}', {});
    expect(resolved).toBe('${a}/${b}/${a}');
    expect(unresolved).toEqual(['a', 'b']);
  });
});

describe('buildFullUrl', () => {
  it('与 client.ts 一致：baseUrl + / + prefix + path', () => {
    expect(buildFullUrl(ctx, '/api/sample/list')).toBe('https://api.example.com/demo-service/api/sample/list');
  });

  it('prefix 为空时不加多余斜杠', () => {
    expect(buildFullUrl({ ...ctx, prefix: '' }, '/api/x')).toBe('https://api.example.com/api/x');
  });
});

describe('buildCurlBlock', () => {
  it('POST：完整 URL + 请求头 + body 模板，占位符已解析', () => {
    const { block, unresolved } = buildCurlBlock(registry.apis[0], ctx, vars);
    expect(unresolved).toEqual([]);
    const lines = curlLines(block);
    expect(lines[0]).toBe("curl -X POST 'https://api.example.com/demo-service/api/sample/list' \\");
    expect(block).toContain(`x-session-id: ${SESSION_PLACEHOLDER}`);
    expect(block).toContain('x-tenant-id: demo-service');
    expect(lines[lines.length - 1]).toBe(`  -d '{"pageNum":1,"pageSize":20,"data":{}}'`);
  });

  it('续行符：除最后一行外每行以 ` \\` 结尾，最后一行没有', () => {
    const { block } = buildCurlBlock(registry.apis[0], ctx, vars);
    const lines = curlLines(block);
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines.slice(0, -1)) expect(line.endsWith(' \\')).toBe(true);
    expect(lines[lines.length - 1].endsWith('\\')).toBe(false);
  });

  it('GET 无 queryTemplate 时提示参数见下表', () => {
    const { block } = buildCurlBlock(registry.apis[1], ctx, vars);
    expect(curlLines(block)[0]).toBe("curl -X GET 'https://api.example.com/demo-service/api/sample/detail?<参数见下表>' \\");
  });

  it('GET 带 queryTemplate 时渲染查询串', () => {
    const api = { ...registry.apis[1], queryTemplate: { id: 'S001' } };
    const { block } = buildCurlBlock(api, ctx, vars);
    expect(curlLines(block)[0]).toContain('/api/sample/detail?id=S001');
  });

  it('未解析占位符保留原样并上报 unresolved', () => {
    const api = { ...registry.apis[0], path: '/${nope.var}/x' };
    const { block, unresolved } = buildCurlBlock(api, ctx, vars);
    expect(unresolved).toEqual(['nope.var']);
    expect(block).toContain('${nope.var}');
  });
});

describe('buildStandaloneFiles', () => {
  it('文件集 = SKILL.md + 每接口一个 reference（deprecated 跳过）', () => {
    const regWithDeprecated: ModuleRegistry = {
      ...registry,
      apis: [...registry.apis, { id: 'old-api', summary: '旧接口', method: 'GET', path: '/old', level: 'read', deprecated: true }],
    };
    const { files, unresolved } = buildStandaloneFiles(regWithDeprecated, 'demo', ctx, vars);
    expect(unresolved).toEqual([]);
    expect(files.map((f) => f.path)).toEqual(['demo-order/SKILL.md', 'demo-order/config.json', 'demo-order/references/sample-list.md', 'demo-order/references/sample-detail.md']);
  });

  it('SKILL.md：只保留路由与使用说明，不重复接口 curl 细节', () => {
    const { files } = buildStandaloneFiles(registry, 'demo', ctx, vars);
    const skill = files.find((f) => f.path === 'demo-order/SKILL.md')!.data;
    expect(skill).not.toContain('${api.prefix}');
    expect(skill).toContain(SESSION_PLACEHOLDER);
    expect(skill).toContain('使用前必读');
    expect(skill).toContain('references/sample-list.md');
    expect(skill).toContain('references/sample-detail.md');
    expect(skill).not.toContain('curl -X');
    expect(skill).not.toContain('接口速查');
    expect(skill).not.toContain('库存为 0 的样品不出现在列表');
    expect(skill).not.toContain('anycli request');
    expect(skill).not.toContain('anycli auth');
    expect(skill).toContain('HTTP 401 = 会话过期');
    expect(skill).toContain('name: demo-order-executable');
    expect(skill).toContain('身份标识');
    expect(skill).toContain('config.json');
    expect(skill).not.toContain('F12');

    const cfg = JSON.parse(files.find((f) => f.path === 'demo-order/config.json')!.data) as { _note: string; sessionId: string };
    expect(cfg.sessionId).toBe('');
    expect(cfg._note).toContain('{{SESSION_ID}}');
  });

  it('reference：含「## 请求」curl 小节（位于「何时用」之后）与 enrichment「## 业务规则」', () => {
    const { files } = buildStandaloneFiles(registry, 'demo', ctx, vars);
    const ref = files.find((f) => f.path === 'demo-order/references/sample-list.md')!.data;
    expect(ref).toContain('## 请求');
    expect(ref).toContain('## 业务规则');
    expect(ref).toContain('库存为 0 的样品不出现在列表');
    expect(ref.indexOf('## 何时用')).toBeLessThan(ref.indexOf('## 请求'));
    expect(ref.indexOf('## 请求')).toBeLessThan(ref.indexOf('## 参数'));
    expect(ref).toContain(SESSION_PLACEHOLDER);
    expect(ref).toContain('config.json');

    const refDetail = files.find((f) => f.path === 'demo-order/references/sample-detail.md')!.data;
    expect(refDetail).not.toContain('anycli auth');
    expect(refDetail).toContain('确认 sessionId 有效');
    expect(refDetail).not.toContain('anycli request');
    expect(refDetail).toContain("curl -X GET 'https://api.example.com/demo-service/api/sample/detail?id=S001'");
  });

  it('飞书模式：通过 MCP 获取 sessionId，不生成 config.json', () => {
    const { files } = buildStandaloneFiles(registry, 'demo', ctx, vars, { authMode: 'feishu-mcp' });
    expect(files.map((f) => f.path)).toEqual([
      'demo-order/SKILL.md',
      'demo-order/references/sample-list.md',
      'demo-order/references/sample-detail.md',
    ]);
    const skill = files.find((f) => f.path === 'demo-order/SKILL.md')!.data;
    expect(skill).toContain(`name: demo-order-feishu-executable`);
    expect(skill).toContain(FEISHU_SESSION_FETCH_GUIDE);
    expect(skill).toContain('不要要求用户手填或把 sessionId 持久化到文件');
    expect(skill).toContain('重新调用上述 MCP 工具获取新的 sessionId 后重试');
    expect(skill).not.toContain('config.json');

    const ref = files.find((f) => f.path === 'demo-order/references/sample-list.md')!.data;
    expect(ref).toContain(FEISHU_SESSION_FETCH_GUIDE);
    expect(ref).toContain('不要要求用户手填或持久化 sessionId');
  });
});

describe('sanitizeAnycliRefs', () => {
  it('anycli auth 指令重写为自包含说法', () => {
    expect(sanitizeAnycliRefs('请 `anycli auth login` 重新登录')).toBe('请 重新获取 sessionId 后重试（获取方式见 SKILL.md「使用前必读」）');
    expect(sanitizeAnycliRefs('anycli auth status')).toBe('确认 sessionId 有效');
  });
});

describe('anycliRequestToCurl', () => {
  it('GET --query → 带查询串的 curl（路径占位符已解析）', () => {
    const curl = anycliRequestToCurl('anycli request demo GET /${api.prefix}/sample/detail --query \'{"id":"S001"}\'', ctx, vars);
    expect(curl).toContain("curl -X GET 'https://api.example.com/demo-service/api/sample/detail?id=S001'");
    expect(curl).toContain(`x-session-id: ${SESSION_PLACEHOLDER}`);
  });

  it('POST --body → 带请求体的 curl', () => {
    const curl = anycliRequestToCurl("anycli request demo POST /api/x --body '{\"a\":1}'", ctx, vars);
    expect(curl).toContain(`  -d '{"a":1}'`);
  });

  it('无法识别或不支持的参数返回 null', () => {
    expect(anycliRequestToCurl('anycli skill build', ctx, vars)).toBeNull();
    expect(anycliRequestToCurl('anycli request demo POST /api/x --set a=1', ctx, vars)).toBeNull();
  });
});

describe('exportStandaloneZip', () => {
  it('生成 {module}-executable.zip（PK 魔数 + 文件数）', () => {
    const result = exportStandaloneZip(registry, 'demo', ctx, vars);
    expect(result.zipName).toBe('demo-order-executable.zip');
    expect(result.fileCount).toBe(4);
    expect(result.zipBuffer.subarray(0, 2).toString()).toBe('PK');
  });

  it('存在未解析占位符时抛错（拒绝导出残缺 URL）', () => {
    const badRegistry: ModuleRegistry = {
      ...registry,
      apis: [{ id: 'x', summary: 'x', method: 'GET', path: '/${unknown.var}/x', level: 'read' }],
    };
    expect(() => exportStandaloneZip(badRegistry, 'demo', ctx, vars)).toThrow(/\$\{unknown\.var\}/);
  });

  it('飞书模式生成独立文件名且不改变普通导出', () => {
    const result = exportStandaloneZip(registry, 'demo', ctx, vars, { authMode: 'feishu-mcp' });
    expect(result.zipName).toBe('demo-order-feishu-executable.zip');
    expect(result.fileCount).toBe(3);
    expect(result.zipBuffer.subarray(0, 2).toString()).toBe('PK');
  });
});
