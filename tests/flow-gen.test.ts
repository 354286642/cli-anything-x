import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scanControllers } from '../src/core/java-parser.js';
import { buildRegistryFromEndpoints } from '../src/core/api-infer.js';
import { buildFlowFromChain } from '../src/core/chain-to-flow.js';
import { compileFlow } from '../src/core/flow-compiler.js';
import { validateFlowGrounding, validateFlowFieldGrounding } from '../src/core/grounding.js';
import type { FlowData } from '../src/core/flow-compiler.js';
import type { ApiEntry, ModuleRegistry } from '../src/core/skill-builder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, 'fixtures', 'java');

/**
 * 批次 4（F-6/F-7）：chain → flow 骨架 与 字段级接地 warning。
 * 夹具注册表由 tests/fixtures/java 现场构建（含 F-1 推出的 6 条 chains），
 * 接地索引通过参数注入，不依赖 apis/ 真实注册表。
 */

let cachedRegistry: ModuleRegistry | null = null;
function getFixtureRegistry(): ModuleRegistry {
  if (!cachedRegistry) {
    const endpoints = scanControllers(FIXTURE_DIR).flatMap((r) => r.endpoints);
    cachedRegistry = buildRegistryFromEndpoints('fixture', 'sample', endpoints);
  }
  return cachedRegistry;
}

function getFixtureIndex(): Map<string, { project: string; module: string; api: ApiEntry }> {
  const registry = getFixtureRegistry();
  const index = new Map<string, { project: string; module: string; api: ApiEntry }>();
  for (const api of registry.apis) {
    index.set(api.id, { project: 'fixture', module: 'sample', api });
    index.set(registry.module + '.' + api.id, { project: 'fixture', module: 'sample', api });
  }
  return index;
}

function firstChain() {
  const registry = getFixtureRegistry();
  const chains = registry.chains || [];
  if (chains.length === 0) throw new Error('fixture registry 应含 chains（F-1 激活）');
  return chains[0];
}

describe('F-6: buildFlowFromChain（chain → flow 骨架）', () => {
  it('steps 直接取 chain 的 api id，末尾 api 为流程结束接口', () => {
    const registry = getFixtureRegistry();
    const { flowData, business } = buildFlowFromChain('fixture', registry, firstChain());
    expect(business).toBe('sample-order-create');
    expect(flowData.meta.name).toBe('flow-fixture-sample-order-create');
    expect(flowData.meta.type).toBe('flow');
    expect(flowData.steps.map((s) => s.apiRefs)).toEqual([['sample-order-list-page'], ['sample-order-create']]);
    expect(flowData.steps[0].dependsOn).toEqual([]);
    expect(flowData.steps[1].dependsOn).toEqual(['step-1']);
    const target = registry.apis.find((a) => a.id === 'sample-order-create')!;
    expect(flowData.endApi?.method).toBe(target.method);
    expect(flowData.endApi?.path).toBe(target.path);
    expect(flowData.endApi?.bodyTemplate).toBe(JSON.stringify(target.bodyTemplate, null, 2));
  });

  it('flow.apis[] 仅登记中间 api 为辅助接口（不含提交接口）', () => {
    const registry = getFixtureRegistry();
    const { flowData } = buildFlowFromChain('fixture', registry, firstChain());
    expect(flowData.apis.map((a) => a.id)).toEqual(['sample-order-list-page']);
    expect(flowData.apis[0].purpose).toBe('样品单列表');
  });

  it('business 可通过参数覆盖', () => {
    const registry = getFixtureRegistry();
    const { flowData, business } = buildFlowFromChain('fixture', registry, firstChain(), 'create-sample');
    expect(business).toBe('create-sample');
    expect(flowData.meta.name).toBe('flow-fixture-create-sample');
  });

  it('骨架天然过接地校验（steps 引用注册表 id 可解析）', () => {
    const registry = getFixtureRegistry();
    const { flowData } = buildFlowFromChain('fixture', registry, firstChain());
    const grounding = validateFlowGrounding(flowData, getFixtureIndex());
    expect(grounding.valid).toBe(true);
    expect(grounding.checkedRefs).toBe(2);
  });

  it('骨架字段级接地零警告（endApi 与注册表请求体一致）', () => {
    const registry = getFixtureRegistry();
    const { flowData } = buildFlowFromChain('fixture', registry, firstChain());
    const { warnings } = validateFlowFieldGrounding(flowData, getFixtureIndex());
    expect(warnings).toEqual([]);
  });

  it('compileFlow 渲染含流程总览/流程结束接口/错误处理章节', () => {
    const registry = getFixtureRegistry();
    const { flowData } = buildFlowFromChain('fixture', registry, firstChain());
    const { skillMd } = compileFlow(flowData);
    expect(skillMd).toContain('## 流程总览');
    expect(skillMd).toContain('**样品单列表**');
    expect(skillMd).toContain('## 流程结束接口调用示例');
    expect(skillMd).toContain('anycli request <project> POST');
    expect(skillMd).toContain('## 错误处理');
    expect(skillMd).toContain('AUTH_EXPIRED');
    const { references } = compileFlow(flowData);
    expect(references['verify.md']).toContain('验证脚本（test 环境端到端）');
    expect(references['verify.md']).toContain('anycli request fixture POST');
  });

  it('chain 步骤不在注册表时中止', () => {
    const registry = getFixtureRegistry();
    expect(() => buildFlowFromChain('fixture', registry, { name: '假链', steps: ['no-such-api', 'sample-order-create'] }))
      .toThrowError(/不在注册表中/);
  });

  it('chain 少于 2 步时中止', () => {
    const registry = getFixtureRegistry();
    expect(() => buildFlowFromChain('fixture', registry, { name: '单步', steps: ['sample-order-create'] }))
      .toThrowError(/少于 2 个步骤/);
  });

  it('F-8：骨架自动生成 verify.md 占位（含目标接口调用行）', () => {
    const registry = getFixtureRegistry();
    const { flowData } = buildFlowFromChain('fixture', registry, firstChain());
    expect(flowData.reference.verify).toContain('# 验证脚本（test 环境端到端）');
    expect(flowData.reference.verify).toContain('anycli request fixture POST');
    expect(flowData.reference.verify).toContain('骨架占位');
  });
});

describe('F-7: validateFlowFieldGrounding（字段级接地 warning）', () => {
  it('存量 flow：detailsList 未定义 + 流程结束接口不在注册表，各出警告', () => {
    const raw = readFileSync(join(__dirname, 'fixtures/flows/field-grounding/flow.json'), 'utf8');
    const flowData = JSON.parse(raw) as FlowData;
    const { warnings } = validateFlowFieldGrounding(flowData, new Map());
    expect(warnings.some((w) => w.includes('fieldRef "detailsList" 未在 fieldGroups 中定义'))).toBe(true);
    expect(warnings.some((w) => w.includes('未在接口注册表 (apis/) 中找到'))).toBe(true);
  });

  it('endApi 多出字段与缺必填字段分别告警', () => {
    const registry = getFixtureRegistry();
    const target = registry.apis.find((a) => a.id === 'sample-order-create')!;
    const body = JSON.parse(JSON.stringify(target.bodyTemplate)) as Record<string, unknown>;
    const requiredParam = (target.bodyParams || []).find((p) => p.required && body[p.name] !== undefined);
    expect(requiredParam).toBeDefined();
    body['hallucinatedField'] = 'x';
    delete body[requiredParam!.name];

    const base = buildFlowFromChain('fixture', registry, firstChain()).flowData;
    const flowData = JSON.parse(JSON.stringify(base)) as FlowData;
    flowData.endApi = { method: target.method, path: target.path, bodyTemplate: JSON.stringify(body) };

    const { warnings } = validateFlowFieldGrounding(flowData, getFixtureIndex());
    expect(warnings.some((w) => w.includes('"hallucinatedField"') && w.includes('未在目标接口'))).toBe(true);
    expect(warnings.some((w) => w.includes('"' + requiredParam!.name + '"') && w.includes('缺失'))).toBe(true);
  });

  it('字段字典未定义时跳过 fieldRefs 校验', () => {
    const registry = getFixtureRegistry();
    const base = buildFlowFromChain('fixture', registry, firstChain()).flowData;
    const flowData = JSON.parse(JSON.stringify(base)) as FlowData;
    flowData.steps[0].fieldRefs = ['whateverField'];
    const { warnings } = validateFlowFieldGrounding(flowData, getFixtureIndex());
    expect(warnings.filter((w) => w.includes('fieldRef'))).toEqual([]);
  });

  it('endApi bodyTemplate 非 JSON 时告警跳过对齐校验', () => {
    const registry = getFixtureRegistry();
    const base = buildFlowFromChain('fixture', registry, firstChain()).flowData;
    const flowData = JSON.parse(JSON.stringify(base)) as FlowData;
    flowData.endApi!.bodyTemplate = 'not-json {{占位}}';
    const { warnings } = validateFlowFieldGrounding(flowData, getFixtureIndex());
    expect(warnings.some((w) => w.includes('无法解析为 JSON'))).toBe(true);
  });
});
