import { describe, expect, it } from 'vitest';
import { analyzeFlowEnd, buildFlowEnhancePrompt, mergeEnhanceProposal, normalizeFlowForEnhance, parseEnhanceResult } from '../src/core/flow-enhance.js';
import type { RegistryIndex } from '../src/core/flow-enhance.js';

function demoRegistryIndex(): RegistryIndex {
  const index: RegistryIndex = new Map();
  index.set('launch-project-create', {
    project: 'demo',
    module: 'demo-project',
    api: {
      id: 'launch-project-create',
      summary: '创建项目',
      method: 'POST',
      path: '/create',
      level: 'write',
      bodyParams: [{ name: 'name', required: true, desc: '项目名称' }],
      queryParams: [],
    },
  });
  return index;
}

function baseFlow() {
  return {
    version: 1,
    meta: { name: 'flow-demo-check', description: '', type: 'flow', triggers: [] },
    title: '演示', businessGoal: '', scenarios: [], prerequisites: [],
    steps: [
      { id: 'step-1', title: '查询', fields: [], apis: ['lookup'], children: [] },
      { id: 'step-2', title: '结束查询', fields: [], apis: ['finish'], dependsOn: ['step-1'], children: [] },
    ],
    fieldGroups: [],
    apis: [
      { id: 'lookup', purpose: '查询前置数据', method: 'GET', path: '/api/lookup', description: '', evidence: { source: 'capture' } },
      { id: 'finish', purpose: '查询最终结果', method: 'GET', path: '/api/result', description: '', evidence: { source: 'capture' } },
    ],
    speechTemplates: [], agentStrategy: { prefillRules: [], mustAsk: [], forbidden: [] },
    endApi: { apiRef: 'finish', method: 'GET', path: '/api/result', bodyTemplate: '{}', evidenceSource: 'capture' },
    errorHandling: [], successCriteria: [], domainKnowledge: [], reference: { fields: '', examples: '', verify: '' },
  };
}

describe('flow-enhance', () => {
  it('兼容旧 submitCommand 并规范化编辑器嵌套步骤', () => {
    const raw = baseFlow();
    delete (raw as any).endApi;
    (raw as any).submitCommand = { method: 'GET', path: '/api/result', bodyTemplate: '{}' };
    const flow = normalizeFlowForEnhance(raw);
    expect(flow.endApi?.path).toBe('/api/result');
    expect(flow.steps).toHaveLength(2);
    expect(flow.steps[1].apiRefs).toEqual(['finish']);
  });

  it('Live Lens 参数依赖会成为结束字段的上游来源证据', () => {
    const raw = baseFlow();
    // 没有注册表时不会虚构字段；此处仅验证捕获来源及降级提示。
    const result = analyzeFlowEnd(raw, undefined, { networkLogs: [{ method: 'GET', url: 'https://x/api/result' }], dependencies: [] });
    expect(result.evidenceSource).toBe('capture');
    expect(result.warnings.some((w) => w.includes('未登记'))).toBe(true);
  });

  it('提案解析与合并会锁定 Flow 标识、接口清单和结束接口', () => {
    const raw = baseFlow();
    const analysis = analyzeFlowEnd(raw, undefined, { networkLogs: [] });
    const result = parseEnhanceResult(JSON.stringify({
      status: 'proposal',
      proposal: {
        flow: { ...raw, meta: { ...raw.meta, name: '被模型改写' }, apis: [], endApi: { method: 'POST', path: '/wrong', bodyTemplate: '{}' } },
        warnings: ['证据不足'], pendingConfirmations: ['确认筛选条件'],
      },
    }), analysis);
    expect(result.status).toBe('proposal');
    if (result.status !== 'proposal') return;
    const merged = mergeEnhanceProposal(raw, result.proposal);
    expect(merged.meta.name).toBe('flow-demo-check');
    expect(merged.apis).toHaveLength(2);
    expect(merged.endApi?.path).toBe('/api/result');
    expect(merged.meta.sourceRefs?.dto).toContain('流程结束接口：finish');
    expect(merged.speechTemplates).toHaveLength(1);
    expect(merged.speechTemplates[0].name).toBe('查询前确认');
  });

  it('写入结束接口的兜底话术使用字段中文描述并包含执行前确认', () => {
    const raw = {
      ...baseFlow(),
      apis: [{ id: 'write', purpose: '创建项目', method: 'POST', path: '/create', description: '', evidence: { source: 'registry', registryRef: { project: 'demo', module: 'demo-project', apiId: 'launch-project-create' } } }],
      endApi: { apiRef: 'write', method: 'POST', path: '/create', bodyTemplate: '{}', evidenceSource: 'registry' },
    };
    const result = parseEnhanceResult(JSON.stringify({ status: 'proposal', proposal: { flow: raw, warnings: [], pendingConfirmations: [] } }), analyzeFlowEnd(raw, undefined, undefined, demoRegistryIndex()));
    expect(result.status).toBe('proposal');
    if (result.status !== 'proposal') return;
    expect(result.proposal.flow.speechTemplates).toHaveLength(2);
    expect(result.proposal.flow.speechTemplates[0].template).toContain('项目名称（name）');
    expect(result.proposal.flow.speechTemplates[1].name).toBe('执行前确认');
  });

  it('将模型常见的 group 和枚举数组归一为 Flow 编译规范', () => {
    const flow = normalizeFlowForEnhance({ ...baseFlow(), fieldGroups: [{ group: '项目类型', fields: [{ name: 'type', type: 'string', required: true, options: ['A', 'B'] }] }] });
    expect(flow.fieldGroups[0].name).toBe('项目类型');
    expect(flow.fieldGroups[0].fields[0].options).toBe('A、B');
  });

  it('接受严格 Schema 中以字符串承载的 proposalJson', () => {
    const raw = baseFlow();
    const result = parseEnhanceResult(JSON.stringify({
      status: 'proposal', questions: [],
      proposalJson: JSON.stringify({ flow: raw, warnings: [], pendingConfirmations: [] }),
    }), analyzeFlowEnd(raw));
    expect(result.status).toBe('proposal');
    if (result.status === 'proposal') expect(result.proposal.flow.endApi?.path).toBe('/api/result');
  });

  it('模型需要信息时只接受有效的结构化问题', () => {
    const analysis = analyzeFlowEnd(baseFlow(), undefined, { networkLogs: [] });
    const result = parseEnhanceResult(JSON.stringify({ status: 'needs_input', questions: [{ id: 'purpose', title: '确认用途', question: '此次查询用于什么业务？', options: ['审批', '报表'] }] }), analysis);
    expect(result.status).toBe('needs_input');
    if (result.status === 'needs_input') expect(result.questions[0].options).toEqual(['审批', '报表']);
  });

  it('将用户补充的业务目标作为本次分析上下文，不改写 Flow', () => {
    const flow = baseFlow();
    const prompt = buildFlowEnhancePrompt(flow, analyzeFlowEnd(flow), undefined, '创建样品需求后查询审核结果');
    expect(prompt).toContain('用户补充的业务目标');
    expect(prompt).toContain('创建样品需求后查询审核结果');
    expect(flow.businessGoal).toBe('');
  });
});
