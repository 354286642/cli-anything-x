import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ENRICH_SCHEMA,
  buildEnrichPrompt,
  buildCodexArgs,
  findControllerFile,
  parseEnrichOutput,
  mergeEnrichment,
  toEnrichment,
} from '../src/core/enrich.js';
import { buildReferenceMd } from '../src/core/skill-builder.js';
import type { ApiEntry, ModuleRegistry } from '../src/core/skill-builder.js';

const VALID_OUTPUT = JSON.stringify({
  summary: '分页查询样品库存',
  businessRules: ['库存按仓库维度汇总'],
  validations: ['pageNo 从 1 开始'],
  callChain: ['SampleController#sampleInventoryListPage → SampleService#queryInventory → SampleMapper#selectPage'],
  errorScenarios: ['Session 过期返回 AUTH_EXPIRED'],
  confidence: 'high',
});

function makeRegistry(apis: ApiEntry[]): ModuleRegistry {
  return { module: 'demo-sample', version: '1.0.0', apis };
}

function makeApi(overrides: Partial<ApiEntry> = {}): ApiEntry {
  return {
    id: 'sample-oms-inventory-list-page',
    summary: '样品库存分页列表',
    method: 'POST',
    path: '/${api.prefix}/sample/omsInventoryListPage',
    level: 'write',
    source: { controller: 'SampleController', method: 'sampleInventoryListPage', path: 'SampleController.java' },
    bodyParams: [
      { name: 'pageNo', type: 'int', required: false, desc: '页码从1开始' },
      { name: 'data', type: 'SampleQuery', required: true, desc: 'SampleQuery（泛型 data）' },
    ],
    outputFields: 'list[]: commodityCode 商品编码 / commodityName 商品名称',
    ...overrides,
  };
}

describe('parseEnrichOutput', () => {
  it('解析合法 JSON', () => {
    const result = parseEnrichOutput(VALID_OUTPUT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.summary).toBe('分页查询样品库存');
    expect(result.data.confidence).toBe('high');
    expect(result.data.callChain).toHaveLength(1);
  });

  it('容忍 code fence 包裹', () => {
    const result = parseEnrichOutput('```json\n' + VALID_OUTPUT + '\n```');
    expect(result.ok).toBe(true);
  });

  it('容忍前后有多余文本（截取大括号）', () => {
    const result = parseEnrichOutput('分析结果如下：\n' + VALID_OUTPUT + '\n以上。');
    expect(result.ok).toBe(true);
  });

  it('schema 违规：confidence 非法 + 缺数组', () => {
    const result = parseEnrichOutput(JSON.stringify({ summary: 'x', confidence: 'maybe' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('businessRules');
    expect(result.error).toContain('confidence');
  });

  it('宽容压平非字符串元素（数字/对象/嵌套数组）', () => {
    const raw = JSON.stringify({
      summary: 'x',
      businessRules: [123, { rule: '状态机', detail: '草稿可撤回' }],
      validations: [['a', 'b']],
      callChain: [{ class: 'SampleService', method: 'query' }],
      errorScenarios: [],
      confidence: 'low',
    });
    const result = parseEnrichOutput(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.businessRules).toEqual(['123', '状态机，草稿可撤回']);
    expect(result.data.validations).toEqual(['a；b']);
    expect(result.data.callChain).toEqual(['SampleService，query']);
  });

  it('空输出与非 JSON 报错', () => {
    expect(parseEnrichOutput('').ok).toBe(false);
    expect(parseEnrichOutput('完全没有 JSON').ok).toBe(false);
  });

  it('清洗：trim 并过滤空字符串', () => {
    const raw = JSON.stringify({
      summary: '  概括  ', businessRules: [' 规则一 ', ''], validations: [], callChain: [], errorScenarios: [], confidence: 'medium',
    });
    const result = parseEnrichOutput(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.summary).toBe('概括');
    expect(result.data.businessRules).toEqual(['规则一']);
  });
});

describe('buildCodexArgs', () => {
  it('参数快照', () => {
    const args = buildCodexArgs('C:\\code\\demo-server', 'C:\\tmp\\schema.json', 'C:\\tmp\\out.txt');
    expect(args).toEqual([
      'exec', '-C', 'C:\\code\\demo-server', '-s', 'read-only',
      '--json', '--output-schema', 'C:\\tmp\\schema.json', '-o', 'C:\\tmp\\out.txt',
    ]);
  });
});

describe('ENRICH_SCHEMA', () => {
  it('required 与属性齐全', () => {
    expect(ENRICH_SCHEMA.required).toContain('summary');
    expect(ENRICH_SCHEMA.required).toContain('confidence');
    expect(Object.keys(ENRICH_SCHEMA.properties)).toHaveLength(6);
    expect(ENRICH_SCHEMA.additionalProperties).toBe(false);
  });
});

describe('buildEnrichPrompt', () => {
  it('包含接口关键信息与入口文件', () => {
    const prompt = buildEnrichPrompt(makeApi(), makeRegistry([makeApi()]), '/repo/SampleController.java');
    expect(prompt).toContain('sample-oms-inventory-list-page');
    expect(prompt).toContain('POST /${api.prefix}/sample/omsInventoryListPage');
    expect(prompt).toContain('SampleQuery（泛型 data）');
    expect(prompt).toContain('/repo/SampleController.java');
    expect(prompt).toContain('sampleInventoryListPage');
    expect(prompt).toContain('JSON');
  });

  it('query 接口取 queryParams', () => {
    const api = makeApi({ queryParams: [{ name: 'id', type: 'Long', required: true }], bodyParams: undefined });
    const prompt = buildEnrichPrompt(api, makeRegistry([api]), '/repo/X.java');
    expect(prompt).toContain('id(Long，必填)');
  });
});

describe('findControllerFile', () => {
  function makeJavaTree(): string {
    const root = mkdtempSync(join(tmpdir(), 'anycli-enrich-test-'));
    mkdirSync(join(root, 'target', 'gen'), { recursive: true });
    mkdirSync(join(root, 'svc', 'src', 'main', 'java', 'com', 'example', 'sample', 'web'), { recursive: true });
    writeFileSync(join(root, 'target', 'gen', 'SampleController.java'), '// generated decoy');
    writeFileSync(join(root, 'svc', 'src', 'main', 'java', 'com', 'example', 'sample', 'web', 'SampleController.java'), '// real');
    writeFileSync(join(root, 'svc', 'src', 'main', 'java', 'com', 'example', 'sample', 'web', 'OrderControllerV2.java'), '// other');
    return root;
  }

  it('按 source.path 命中，优先 src/main/java 而非 target', () => {
    const root = makeJavaTree();
    try {
      const found = findControllerFile(root, makeApi());
      expect(found).not.toBeNull();
      expect(found!.replace(/\\/g, '/')).toContain('src/main/java/com/example/sample/web/SampleController.java');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('无 source.path 时按 controller 名兜底', () => {
    const root = makeJavaTree();
    try {
      const api = makeApi({ source: { controller: 'OrderControllerV2', method: 'listPage' } });
      const found = findControllerFile(root, api);
      expect(found).not.toBeNull();
      expect(found!.replace(/\\/g, '/')).toContain('OrderControllerV2.java');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('未命中返回 null（basename 精确匹配，不误伤 OrderControllerV2）', () => {
    const root = makeJavaTree();
    try {
      const api = makeApi({ source: { controller: 'SampleController', method: 'x', path: 'SampleControllerX.java' } });
      // path 候选未命中 → 兜底 SampleController.java 命中
      expect(findControllerFile(root, api)).not.toBeNull();
      // controller 也不存在 → null
      const missing = makeApi({ source: { controller: 'NoSuchController', method: 'x' } });
      expect(findControllerFile(root, missing)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('源码根不存在返回 null', () => {
    expect(findControllerFile(join(tmpdir(), 'anycli-no-such-dir-xyz'), makeApi())).toBeNull();
  });
});

describe('mergeEnrichment / toEnrichment', () => {
  it('写入并整体覆盖（幂等）', () => {
    const registry = makeRegistry([makeApi()]);
    const parsed = parseEnrichOutput(VALID_OUTPUT);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const first = toEnrichment(parsed.data, { enrichedBy: 'codex-cli 0.144.6', controllerFile: 'web/SampleController.java', at: new Date('2026-08-07T10:00:00Z') });
    expect(mergeEnrichment(registry, 'sample-oms-inventory-list-page', first)).toBe(true);
    expect(registry.apis[0].enrichment?.enrichedBy).toBe('codex-cli 0.144.6');
    expect(registry.apis[0].enrichment?.controllerFile).toBe('web/SampleController.java');
    expect(registry.apis[0].enrichment?.enrichedAt).toBe('2026-08-07T10:00:00.000Z');

    // 再次强化：整体覆盖
    const second = toEnrichment(
      { ...parsed.data, summary: '新版本概括', confidence: 'low' },
      { enrichedBy: 'codex-cli 0.145.0', at: new Date('2026-08-08T10:00:00Z') },
    );
    expect(mergeEnrichment(registry, 'sample-oms-inventory-list-page', second)).toBe(true);
    expect(registry.apis[0].enrichment?.summary).toBe('新版本概括');
    expect(registry.apis[0].enrichment?.enrichedBy).toBe('codex-cli 0.145.0');
    expect(registry.apis[0].enrichment?.controllerFile).toBeUndefined();
  });

  it('接口不存在返回 false', () => {
    const registry = makeRegistry([makeApi()]);
    const parsed = parseEnrichOutput(VALID_OUTPUT);
    if (!parsed.ok) return;
    const enrichment = toEnrichment(parsed.data, { enrichedBy: 'codex' });
    expect(mergeEnrichment(registry, 'no-such-api', enrichment)).toBe(false);
  });
});

describe('buildReferenceMd 渲染业务规则', () => {
  it('有 enrichment 时渲染「## 业务规则」小节', () => {
    const api = makeApi();
    const registry = makeRegistry([api]);
    const parsed = parseEnrichOutput(VALID_OUTPUT);
    if (!parsed.ok) return;
    api.enrichment = toEnrichment(parsed.data, { enrichedBy: 'codex-cli 0.144.6', controllerFile: 'SampleController.java', at: new Date('2026-08-07T10:00:00Z') });
    const md = buildReferenceMd(api, registry, 'demo');
    expect(md).toContain('## 业务规则');
    expect(md).toContain('codex-cli 0.144.6');
    expect(md).toContain('2026-08-07');
    expect(md).toContain('分页查询样品库存');
    expect(md).toContain('### 参数校验');
    expect(md).toContain('- pageNo 从 1 开始');
    expect(md).toContain('### 调用链路');
    expect(md).toContain('### 异常场景');
  });

  it('无 enrichment 时产物不含业务规则节', () => {
    const api = makeApi();
    const md = buildReferenceMd(api, makeRegistry([api]), 'demo');
    expect(md).not.toContain('## 业务规则');
  });

  it('空数组小节不渲染', () => {
    const api = makeApi();
    const parsed = parseEnrichOutput(JSON.stringify({
      summary: '概括', businessRules: ['规则'], validations: [], callChain: [], errorScenarios: [], confidence: 'low',
    }));
    if (!parsed.ok) return;
    api.enrichment = toEnrichment(parsed.data, { enrichedBy: 'codex' });
    const md = buildReferenceMd(api, makeRegistry([api]), 'demo');
    expect(md).toContain('### 业务规则');
    expect(md).not.toContain('### 参数校验');
    expect(md).not.toContain('### 调用链路');
  });
});