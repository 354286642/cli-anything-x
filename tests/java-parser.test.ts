import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { scanControllers } from '../src/core/java-parser.js';
import type { ApiEndpoint } from '../src/core/java-parser.js';
import { buildRegistryFromEndpoints, endpointToApiEntry } from '../src/core/api-infer.js';
import { buildSkillMd } from '../src/core/skill-builder.js';
import type { ModuleRegistry } from '../src/core/skill-builder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, 'fixtures', 'java');

/**
 * Phase 0 安全网：表征测试（characterization test）。
 *
 * 夹具 = 纯合成「样品单」模块（SampleOrderController + 请求 DTO + 枚举，
 * 全虚构，见 tests/fixtures/java/README.md）
 *      + 合成补齐（DELETE/@PathVariable/多路径数组/defaultValue/@Operation/Javadoc 回退）。
 *
 * 快照锁定 scanControllers → endpointToApiEntry → buildRegistryFromEndpoints → buildSkillMd
 * 的现状输出。任何 B/F 类行为变更必须：先更新对应断言，再用 vitest -u 重建快照，
 * 且快照 diff 与该批次登记的变更逐条吻合。
 */

let cachedScan: { filePath: string; endpoints: ApiEndpoint[] }[] | null = null;
function getScanned() {
  if (!cachedScan) cachedScan = scanControllers(FIXTURE_DIR);
  return cachedScan;
}

function getController(suffix: string) {
  const found = getScanned().find((r) => r.filePath.endsWith(suffix));
  if (!found) throw new Error(`fixture controller not found: ${suffix}`);
  return found;
}

describe('scanControllers 夹具扫描', () => {
  it('发现全部 3 个夹具 Controller，端点清单快照', { timeout: 120_000 }, () => {
    const summary = getScanned().map((r) => ({
      file: relative(FIXTURE_DIR, r.filePath).replace(/\\/g, '/'),
      endpointCount: r.endpoints.length,
      endpoints: r.endpoints.map((ep) => `${ep.httpMethod} ${ep.path} (${ep.methodName})`),
    }));
    expect(summary).toMatchSnapshot();
    expect(getScanned()).toHaveLength(3);
  });
});

describe('真实 SampleOrderController 端点表征', () => {
  it('27 个端点全量快照', { timeout: 120_000 }, () => {
    expect(getController('SampleOrderController.java').endpoints).toMatchSnapshot();
  });

  it('B-4：类级 ${api.prefix} 占位符保留原样（不再静默替换为 /api）', () => {
    const endpoints = getController('SampleOrderController.java').endpoints;
    expect(endpoints.length).toBe(27);
    for (const ep of endpoints) {
      expect(ep.path.startsWith('/${api.prefix}/sampleOrder/')).toBe(true);
    }
  });

  it('PageRequest<T> 走内置 wrapper 模板并解析泛型实参 DTO', () => {
    const listPage = getController('SampleOrderController.java').endpoints.find(
      (ep) => ep.methodName === 'listPage',
    )!;
    expect(listPage.bodyJsonExample).toContain('"pageNo": 1');
    expect(listPage.bodyJsonExample).toContain('"pageSize": 20');
    expect(listPage.bodyJsonExample).toContain('"data":');
    expect(listPage.bodyJsonExample).toContain('"code"');
  });

  it('GET @RequestParam 进入 queryParams', () => {
    const getDetails = getController('SampleOrderController.java').endpoints.find(
      (ep) => ep.methodName === 'getDetails',
    )!;
    expect(getDetails.httpMethod).toBe('GET');
    expect(getDetails.queryParams.map((p) => p.name)).toEqual(['id']);
  });

  it('@ApiParam 描述被采集（ignoreException）', () => {
    const ep = getController('SampleOrderController.java').endpoints.find(
      (e) => e.methodName === 'ignoreException',
    )!;
    expect(ep.queryParams.map((p) => p.description)).toEqual(['物流单号']);
  });
});

describe('F-1：方法返回类型 → outputFields', () => {
  function getEp(methodName: string): ApiEndpoint {
    const ep = getController('SampleOrderController.java').endpoints.find(
      (e) => e.methodName === methodName,
    );
    if (!ep) throw new Error('endpoint not found: ' + methodName);
    return ep;
  }

  it('PageInfo<SampleOrderVO>：list[] 前缀 + 字段摘要（超 40 字段截断）', () => {
    const ep = getEp('listPage');
    expect(ep.returnType).toBe('PageInfo<SampleOrderVO>');
    expect(ep.outputFields!.startsWith('list[]: id / groupId 关联分组id / code 样品单号')).toBe(true);
    expect(ep.outputFields!.endsWith('/ …')).toBe(true);
  });

  it('裸 DTO 返回（SampleOrderDetailsVO）：无前缀，全量字段', () => {
    const ep = getEp('getDetails');
    expect(ep.returnType).toBe('SampleOrderDetailsVO');
    expect(ep.outputFields).toBe(
      'sampleOrderInfo 需求信息 / auditInfo 审核信息 / sampleDeliveryList 样品的物流情况，可能有多个 / returnInfoList 退货信息.一个样品信息可能对应多个退货信息',
    );
  });

  it('List<String> 简单类型列表 → []: String 列表', () => {
    const ep = getEp('create');
    expect(ep.returnType).toBe('List<String>');
    expect(ep.outputFields).toBe('[]: String 列表');
  });

  it('BaseResult<String> → data: String', () => {
    const ep = getEp('exportSampleOrder');
    expect(ep.returnType).toBe('BaseResult<String>');
    expect(ep.outputFields).toBe('data: String');
  });

  it('void 返回不产生 outputFields', () => {
    for (const name of ['update', 'ignoreException']) {
      const ep = getEp(name);
      expect(ep.returnType).toBe('void');
      expect(ep.outputFields).toBeUndefined();
    }
  });
});

describe('合成 Controller 解析面覆盖（现状行为）', () => {
  it('DELETE/@PathVariable/PATCH/多路径数组/占位符端点快照', { timeout: 120_000 }, () => {
    expect(getController('SyntheticCoverageController.java').endpoints).toMatchSnapshot();
  });

  it('B-4：类级多路径数组取第一个路径，占位符保留原样', () => {
    const endpoints = getController('SyntheticCoverageController.java').endpoints;
    for (const ep of endpoints) {
      expect(ep.path.startsWith('/${fixture.api.prefix}/synthetic')).toBe(true);
    }
  });

  it('DELETE 映射被解析且 @PathVariable 进入 queryParams', () => {
    const removeById = getController('SyntheticCoverageController.java').endpoints.find(
      (ep) => ep.methodName === 'removeById',
    )!;
    expect(removeById.httpMethod).toBe('DELETE');
    expect(removeById.path).toBe('/${fixture.api.prefix}/synthetic/remove/{id}');
    expect(removeById.queryParams.map((p) => `${p.source}:${p.name}`)).toEqual(['path:id']);
  });

  it('方法级多路径数组取第一个；@Operation(summary) 作为描述来源', () => {
    const multiPath = getController('SyntheticCoverageController.java').endpoints.find(
      (ep) => ep.methodName === 'multiPath',
    )!;
    expect(multiPath.path).toBe('/${fixture.api.prefix}/synthetic/multiPathA');
    expect(multiPath.description).toBe('OpenAPI3 summary 回退');
  });

  it('@RequestMapping(method=...) 解析 HTTP 方法与多路径数组', () => {
    const endpoints = getController('SyntheticCoverageController.java').endpoints;
    const viaMapping = endpoints.find((ep) => ep.methodName === 'viaRequestMappingMultiPath')!;
    expect(viaMapping.httpMethod).toBe('GET');
    expect(viaMapping.path).toBe('/${fixture.api.prefix}/synthetic/viaMappingA');
    const putVia = endpoints.find((ep) => ep.methodName === 'putViaRequestMapping')!;
    expect(putVia.httpMethod).toBe('PUT');
  });

  it('B-4：方法级占位符保留原样', () => {
    const echo = getController('SyntheticCoverageController.java').endpoints.find(
      (ep) => ep.methodName === 'echoWithPlaceholder',
    )!;
    expect(echo.path).toBe('/${fixture.api.prefix}/synthetic/${fixture.subPath}/echo');
  });

  it('B-2：带属性的 @RequestParam 完整解析 required/defaultValue', () => {
    const endpoints = getController('SyntheticCoverageController.java').endpoints;
    const multiPath = endpoints.find((ep) => ep.methodName === 'multiPath')!;
    expect(multiPath.queryParams).toEqual([
      { name: 'pageNo', type: 'Integer', description: 'pageNo', source: 'query', required: false, defaultValue: '1' },
      { name: 'keyword', type: 'String', description: 'keyword', source: 'query', required: false },
    ]);
    const queryWithDefault = endpoints.find((ep) => ep.methodName === 'queryWithDefault')!;
    expect(queryWithDefault.queryParams).toEqual([
      { name: 'name', type: 'String', description: 'name', source: 'query', required: true },
      { name: 'pageSize', type: 'Integer', description: 'pageSize', source: 'query', required: false, defaultValue: '20' },
    ]);
  });

  it('B-2：真实 Controller 带属性 @RequestParam 被采集（importSampleOrder）', () => {
    const ep = getController('SampleOrderController.java').endpoints.find(
      (e) => e.methodName === 'importSampleOrder',
    )!;
    expect(ep.queryParams).toEqual([
      {
        name: 'sourceCode',
        type: 'String',
        description: '如果导入时选择的是从办公室领用，则需要指定办公室编码',
        source: 'query',
        required: false,
      },
    ]);
  });

  it('Javadoc 描述回退（独立 Controller，无干扰）', () => {
    const describe_ = getController('JavadocOnlyController.java').endpoints.find(
      (ep) => ep.methodName === 'describe',
    )!;
    expect(describe_.description).toBe('Javadoc 描述回退');
    expect(describe_.path).toBe('/javadocOnly/describe');
  });
});

describe('endpointToApiEntry 表征', () => {
  it('全部端点 → ApiEntry 快照', { timeout: 120_000 }, () => {
    const entries = getScanned().flatMap((r) => r.endpoints).map(endpointToApiEntry);
    expect(entries).toMatchSnapshot();
  });

  it('GET → read；其余方法（含 DELETE）→ write（B-1）', () => {
    const endpoints = getScanned().flatMap((r) => r.endpoints);
    for (const ep of endpoints) {
      const entry = endpointToApiEntry(ep);
      if (ep.httpMethod === 'GET') {
        expect(entry.level, `${ep.methodName} 应为 read`).toBe('read');
      } else {
        expect(entry.level, `${ep.methodName} 应为 write`).toBe('write');
      }
    }
  });

  it('B-1：DELETE level=write，且 query/path 参数保留在 queryParams（不误入 bodyParams）', () => {
    const removeById = endpointToApiEntry(
      getController('SyntheticCoverageController.java').endpoints.find(
        (ep) => ep.methodName === 'removeById',
      )!,
    );
    expect(removeById.method).toBe('DELETE');
    expect(removeById.level).toBe('write');
    expect(removeById.bodyParams).toBeUndefined();
    expect(removeById.bodyTemplate).toBeUndefined();
    expect(removeById.queryParams).toEqual([
      { name: 'id', type: 'String', required: true, desc: 'id' },
    ]);
  });

  it('B-3：body 接口 bodyParams 展开为 DTO 字段级（校验注解 → required）', () => {
    const create = endpointToApiEntry(
      getController('SampleOrderController.java').endpoints.find((ep) => ep.methodName === 'create')!,
    );
    const names = create.bodyParams!.map((p) => p.name);
    expect(names).toContain('isConfirm');
    expect(names).toContain('detailsList');
    expect(names).toContain('itemCode');
    expect(names).toContain('itemType');
    expect(names.length).toBeGreaterThan(5);
    // @NotBlank/@NotNull 校验注解 → required
    expect(create.bodyParams!.find((p) => p.name === 'isConfirm')!.required).toBe(true);
    expect(create.bodyParams!.find((p) => p.name === 'itemCode')!.required).toBe(true);
    expect(create.bodyParams!.find((p) => p.name === 'sourceCode')!.required).toBe(false);
    // bodyTemplate 保持不变（JSON 示例）
    expect(typeof create.bodyTemplate).toBe('object');
    expect((create.bodyTemplate as Record<string, unknown>).itemCode).toBe('');
  });

  it('B-3：继承链展开（UpdateSampleOrderCmd extends CreateSampleOrderCmd）', () => {
    const update = endpointToApiEntry(
      getController('SampleOrderController.java').endpoints.find((ep) => ep.methodName === 'update')!,
    );
    const names = update.bodyParams!.map((p) => p.name);
    expect(names).toContain('itemCode'); // 父类字段
    expect(names).toContain('id'); // 自身字段
    expect(update.bodyParams!.find((p) => p.name === 'id')!.required).toBe(true); // @NotBlank
  });

  it('B-3：PageRequest<T> 展开为 wrapper 字段 + 泛型 data', () => {
    const listPage = endpointToApiEntry(
      getController('SampleOrderController.java').endpoints.find((ep) => ep.methodName === 'listPage')!,
    );
    expect(listPage.bodyParams!.map((p) => p.name)).toEqual(['pageNo', 'pageSize', 'orderBy', 'data']);
    expect(listPage.bodyParams!.find((p) => p.name === 'data')!.type).toBe('SampleOrderQuery');
  });

  it('B-3：POST + @RequestParam 归入 queryParams（不再混入 bodyParams）', () => {
    const cancel = endpointToApiEntry(
      getController('SampleOrderController.java').endpoints.find(
        (ep) => ep.methodName === 'cancelSampleOrder',
      )!,
    );
    expect(cancel.method).toBe('POST');
    expect(cancel.bodyParams).toBeUndefined();
    expect(cancel.queryParams).toEqual([
      { name: 'id', type: 'String', required: true, desc: 'id' },
    ]);
  });
});

describe('buildRegistryFromEndpoints / buildSkillMd 表征', () => {
  function buildFreshRegistry(): ModuleRegistry {
    const endpoints = getScanned().flatMap((r) => r.endpoints);
    return buildRegistryFromEndpoints('fixture', 'sample', endpoints);
  }

  it('全新注册表快照', { timeout: 120_000 }, () => {
    expect(buildFreshRegistry()).toMatchSnapshot();
  });

  it('F-1 激活：outputFields 填充 → inferChains 推出 6 条 chain，steps 均为合法 api id', () => {
    const registry = buildFreshRegistry();
    expect(registry.chains).toHaveLength(6);
    const ids = new Set(registry.apis.map((a) => a.id));
    for (const chain of registry.chains) {
      expect(chain.steps.length).toBeGreaterThanOrEqual(2);
      for (const step of chain.steps) {
        expect(ids.has(step)).toBe(true);
      }
    }
    // listPage 输出含 itemCode → create/update 的必填参数 itemCode 命中
    expect(registry.chains.some((c) => c.steps[0] === 'sample-order-list-page' && c.steps[1] === 'sample-order-create')).toBe(true);
    expect(registry.chains.some((c) => c.steps[0] === 'sample-order-list-page' && c.steps[1] === 'sample-order-update')).toBe(true);
  });

  it('buildSkillMd 产物快照', { timeout: 120_000 }, () => {
    expect(buildSkillMd(buildFreshRegistry(), 'fixture')).toMatchSnapshot();
  });

  it('merge：人工字段（notes/tips/level/outputFields/examples）不被重建覆盖', () => {
    const fresh = buildFreshRegistry();
    const humanModified: ModuleRegistry = JSON.parse(JSON.stringify(fresh));
    const target = humanModified.apis.find((a) => a.id === 'sample-order-create')!;
    target.notes = '人工备注';
    target.tips = ['人工提示'];
    target.level = 'read';
    target.outputFields = 'ids 列表';
    target.examples = [{ title: '人工示例', command: 'anycli request fixture POST /api/sampleOrder/create' }];

    const endpoints = getScanned().flatMap((r) => r.endpoints);
    const merged = buildRegistryFromEndpoints('fixture', 'sample', endpoints, humanModified);
    const mergedCreate = merged.apis.find((a) => a.id === 'sample-order-create')!;
    expect(mergedCreate.notes).toBe('人工备注');
    expect(mergedCreate.tips).toEqual(['人工提示']);
    expect(mergedCreate.level).toBe('read');
    expect(mergedCreate.outputFields).toBe('ids 列表');
    expect(mergedCreate.examples).toHaveLength(1);
    expect(merged.apis.length).toBe(fresh.apis.length);
  });

  it('merge：同 method+path 的既有 id 被复用，不产生重复条目', () => {
    const fresh = buildFreshRegistry();
    const renamed: ModuleRegistry = JSON.parse(JSON.stringify(fresh));
    renamed.apis[0].id = 'custom-legacy-id';

    const endpoints = getScanned().flatMap((r) => r.endpoints);
    const merged = buildRegistryFromEndpoints('fixture', 'sample', endpoints, renamed);
    expect(merged.apis.length).toBe(fresh.apis.length);
    expect(merged.apis.some((a) => a.id === 'custom-legacy-id')).toBe(true);
  });
});
describe('gen-pipeline 纯函数（Phase 0 抽取）', () => {
  it('collectEndpoints 汇总全部 Controller 端点', { timeout: 120_000 }, async () => {
    const { collectEndpoints } = await import('../src/core/gen-pipeline.js');
    const { controllerCount, endpoints } = collectEndpoints(FIXTURE_DIR);
    expect(controllerCount).toBe(3);
    expect(endpoints.length).toBe(27 + 8 + 1);
    expect(endpoints.map((ep) => ep.methodName)).toContain('listPage');
    expect(endpoints.map((ep) => ep.methodName)).toContain('removeById');
  });

  it('planRegistryUpdate：无注册表且无 legacy 种子 → created=true', async () => {
    const { planRegistryUpdate } = await import('../src/core/gen-pipeline.js');
    const endpoints = getScanned().flatMap((r) => r.endpoints);
    const plan = planRegistryUpdate('fixture', 'sample', endpoints, null, []);
    expect(plan.created).toBe(true);
    expect(plan.registry.module).toBe('fixture-sample');
    expect(plan.registry.apis.length).toBe(endpoints.length);
  });

  it('planRegistryUpdate：legacy 种子按 method+path 复用 id', async () => {
    const { planRegistryUpdate } = await import('../src/core/gen-pipeline.js');
    const endpoints = getScanned().flatMap((r) => r.endpoints);
    const legacy = [{
      id: 'legacy-create-id',
      summary: '旧清单叫法',
      method: 'POST',
      path: '/api/sampleOrder/create',
      level: 'write' as const,
      deprecated: false,
      version: '1.0.0',
    }];
    const plan = planRegistryUpdate('fixture', 'sample', endpoints, null, legacy);
    expect(plan.created).toBe(true);
    const created = plan.registry.apis.find((a) => a.path === '/api/sampleOrder/create' && a.method === 'POST')!;
    expect(created.id).toBe('legacy-create-id');
    expect(plan.registry.apis.filter((a) => a.path === '/api/sampleOrder/create').length).toBe(1);
  });

  it('planRegistryUpdate：既有注册表 → created=false 且人工字段保留', async () => {
    const { planRegistryUpdate } = await import('../src/core/gen-pipeline.js');
    const endpoints = getScanned().flatMap((r) => r.endpoints);
    const existing = planRegistryUpdate('fixture', 'sample', endpoints, null, []).registry;
    existing.apis.find((a) => a.id === 'sample-order-create')!.notes = '人工备注';
    const plan = planRegistryUpdate('fixture', 'sample', endpoints, existing, []);
    expect(plan.created).toBe(false);
    expect(plan.registry.apis.find((a) => a.id === 'sample-order-create')!.notes).toBe('人工备注');
  });
});
