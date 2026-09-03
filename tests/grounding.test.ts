import { describe, it, expect } from 'vitest';
import { validateFlowGrounding } from '../src/core/grounding.js';
import type { FlowData } from '../src/core/flow-compiler.js';
import type { ApiEntry } from '../src/core/skill-builder.js';

function makeFlowData(overrides: Partial<FlowData> = {}): FlowData {
  return {
    version: 1,
    meta: { name: 'test-flow', description: 'test', type: 'flow', triggers: ['test'] },
    title: 'Test Flow',
    businessGoal: '',
    scenarios: [],
    prerequisites: [],
    steps: [],
    fieldGroups: [],
    apis: [],
    speechTemplates: [],
    agentStrategy: { prefillRules: [], mustAsk: [], forbidden: [] },
    submitCommand: { method: 'POST', path: '', bodyTemplate: '{}' },
    errorHandling: [],
    successCriteria: [],
    domainKnowledge: [],
    reference: { fields: '', examples: '', verify: '' },
    ...overrides,
  };
}

describe('grounding validation', () => {
  it('passes when step references local api', () => {
    const flow = makeFlowData({
      apis: [{ id: 'api-1', purpose: 'test', method: 'POST', path: '/test', description: '' }],
      steps: [{
        id: 'step-1', title: 'Step 1', level: 0, parentId: null,
        conditional: false, condition: null, dependsOn: [],
        apiRefs: ['api-1'], fieldRefs: [], content: '',
      }],
    });
    const result = validateFlowGrounding(flow);
    expect(result.valid).toBe(true);
    expect(result.checkedRefs).toBe(1);
  });

  it('passes when step references registry api', () => {
    const registryIndex = new Map<string, { project: string; module: string; api: ApiEntry }>();
    registryIndex.set('order-list-page', {
      project: 'demo',
      module: 'demo-order',
      api: { id: 'order-list-page', summary: '订单分页列表', method: 'POST', path: '/api/order/listForEsPage', level: 'read' },
    });
    const flow = makeFlowData({
      steps: [{
        id: 'step-1', title: 'Step 1', level: 0, parentId: null,
        conditional: false, condition: null, dependsOn: [],
        apiRefs: ['order-list-page'], fieldRefs: [], content: '',
      }],
    });
    const result = validateFlowGrounding(flow, registryIndex);
    expect(result.valid).toBe(true);
    expect(result.checkedRefs).toBe(1);
  });
  it('fails when step references unknown api', () => {
    const flow = makeFlowData({
      steps: [{
        id: 'step-1', title: 'Step 1', level: 0, parentId: null,
        conditional: false, condition: null, dependsOn: [],
        apiRefs: ['nonexistent-api'], fieldRefs: [], content: '',
      }],
    });
    const result = validateFlowGrounding(flow);
    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].ref).toBe('nonexistent-api');
    expect(result.issues[0].stepId).toBe('step-1');
  });

  it('handles legacy apiRef field', () => {
    const flow = makeFlowData({
      steps: [{
        id: 'step-1', title: 'Step 1', level: 0, parentId: null,
        conditional: false, condition: null, dependsOn: [],
        apiRef: 'nonexistent-legacy', fieldRefs: [], content: '',
      }],
    });
    const result = validateFlowGrounding(flow);
    expect(result.valid).toBe(false);
    expect(result.issues[0].ref).toBe('nonexistent-legacy');
  });

  it('passes with no api refs', () => {
    const flow = makeFlowData({
      steps: [{
        id: 'step-1', title: 'Step 1', level: 0, parentId: null,
        conditional: false, condition: null, dependsOn: [],
        fieldRefs: [], content: '',
      }],
    });
    const result = validateFlowGrounding(flow);
    expect(result.valid).toBe(true);
    expect(result.checkedRefs).toBe(0);
  });
});
