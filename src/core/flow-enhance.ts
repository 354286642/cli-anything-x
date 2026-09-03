/**
 * Flow Enhance 的纯逻辑：统一普通 API 导入和 Live Lens 录制，
 * 从用户确认的流程结束接口反向推导字段来源。进程/SSE 管理由编辑器服务负责。
 */
import type { ApiEntry } from './skill-builder.js';
import { buildApiIndex } from './skill-builder.js';
import { getFlowEndApi } from './flow-compiler.js';
import type { FlowData, FlowEndApi, FlowStep } from './flow-compiler.js';

export type RegistryIndex = Map<string, { project: string; module: string; api: ApiEntry }>;
export type EvidenceSource = 'registry' | 'capture' | 'name-only';
export type FieldSourceKind = 'user-input' | 'default' | 'profile' | 'upstream-api' | 'computed' | 'unknown';

export interface CaptureDependency {
  targetStepIndex: number;
  sourceStepIndex: number;
  paramName: string;
  sourceJsonPath: string;
}

export interface CaptureEvidence {
  networkLogs?: Array<{ method?: string; url?: string; postData?: string | null; responseBody?: string | null }>;
  dependencies?: CaptureDependency[];
  intentText?: string;
}

export interface FieldTrace {
  field: string;
  required: boolean;
  source: FieldSourceKind;
  detail: string;
  upstreamStepId?: string;
}

export interface ReverseAnalysis {
  endApi: FlowEndApi;
  evidenceSource: EvidenceSource;
  traces: FieldTrace[];
  warnings: string[];
  registryApi?: ApiEntry;
}

export interface EnhanceQuestion {
  id: string;
  title: string;
  question: string;
  options?: string[];
  recommended?: string;
}

export interface EnhanceProposal {
  flow: FlowData;
  fieldTraces: FieldTrace[];
  warnings: string[];
  pendingConfirmations: string[];
}

export type EnhanceResult =
  | { status: 'needs_input'; questions: EnhanceQuestion[]; analysis: ReverseAnalysis }
  | { status: 'proposal'; proposal: EnhanceProposal };

/** 给 codex --output-schema 使用。模型只能返回提问或完整候选 Flow。 */
export const FLOW_ENHANCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'questions', 'proposalJson'],
  properties: {
    status: { type: 'string', enum: ['needs_input', 'proposal'] },
    questions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'title', 'question', 'options', 'recommended'],
        properties: {
          id: { type: 'string' }, title: { type: 'string' }, question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } }, recommended: { type: 'string' },
        },
      },
    },
    /** Flow 结构嵌套较深；以 JSON 字符串承载，避免 strict schema 对每层对象的限制。 */
    proposalJson: { type: 'string' },
  },
} as const;

function value(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseLegacyCommand(command: string): FlowEndApi | undefined {
  const match = command.match(/anycli\s+request\s+\S+\s+(GET|POST|PUT|DELETE|PATCH)\s+(\S+)/i);
  if (!match) return undefined;
  return { method: match[1].toUpperCase(), path: match[2], bodyTemplate: '{}', evidenceSource: 'name-only' };
}

function flattenSteps(input: any[], parentId: string | null = null, level = 0, out: FlowStep[] = []): FlowStep[] {
  for (const item of input || []) {
    const step: FlowStep = {
      id: value(item.id) || `step-${out.length + 1}`,
      title: value(item.title), level: Number.isFinite(item.level) ? item.level : level,
      parentId: item.parentId === undefined ? parentId : item.parentId,
      conditional: Boolean(item.conditional || item.condition), condition: value(item.condition) || null,
      dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn.filter(Boolean) : [],
      apiRefs: Array.isArray(item.apiRefs) ? item.apiRefs.filter(Boolean) : Array.isArray(item.apis) ? item.apis.filter(Boolean) : [],
      fieldRefs: Array.isArray(item.fieldRefs) ? item.fieldRefs.filter(Boolean) : Array.isArray(item.fields) ? item.fields.filter(Boolean) : [],
      content: value(item.content),
    };
    out.push(step);
    if (Array.isArray(item.children)) flattenSteps(item.children, step.id, step.level + 1, out);
  }
  return out;
}

function normalizeFieldGroups(input: any[]): FlowData['fieldGroups'] {
  return (input || []).map((group: any) => ({
    name: value(group.name) || value(group.group),
    fields: (Array.isArray(group.fields) ? group.fields : []).map((field: any) => ({
      name: value(field.name), type: value(field.type) || 'string', required: Boolean(field.required),
      condition: value(field.condition) || null,
      options: Array.isArray(field.options) ? field.options.filter(Boolean).join('、') : (value(field.options) || null),
      description: value(field.description),
    })),
  })).filter((group: any) => group.name);
}

function applyEndApiSourceRefs(flow: FlowData, analysis: ReverseAnalysis): void {
  const api = analysis.registryApi;
  const source = api?.source as { controller?: string; method?: string; path?: string } | undefined;
  const endpoint = `${analysis.endApi.apiRef || api?.id || '未命名接口'}（${analysis.endApi.method} ${analysis.endApi.path}）`;
  flow.meta.sourceRefs = {
    ...(flow.meta.sourceRefs || {}),
    controller: source?.path ? `${source.path}${source.method ? `#${source.method}` : ''}` : (flow.meta.sourceRefs?.controller || `流程结束接口：${endpoint}`),
    dto: `流程结束接口：${endpoint}；证据来源：${analysis.evidenceSource}`,
  };
}

function buildBaseSpeechTemplates(analysis: ReverseAnalysis): FlowData['speechTemplates'] {
  const apiName = analysis.registryApi?.summary || analysis.endApi.apiRef || '完成该流程';
  const params = [
    ...(analysis.registryApi?.queryParams || []),
    ...(analysis.registryApi?.bodyParams || []),
  ];
  const fields = analysis.traces
    .filter((trace) => trace.required && (trace.source === 'user-input' || trace.source === 'unknown'))
    .map((trace) => {
      const param = params.find((item) => item.name === trace.field);
      return param?.desc ? `${param.desc}（${trace.field}）` : trace.field;
    });
  const isQuery = analysis.endApi.method.toUpperCase() === 'GET';
  const fieldText = fields.length ? `请您补充或确认：${fields.join('、')}。` : '请您确认查询范围或必要条件。';
  const note = `基于流程结束接口 ${analysis.endApi.method} ${analysis.endApi.path} 自动生成；请按实际业务语气调整。`;
  if (isQuery) return [{
    name: '查询前确认',
    template: `我将为您${apiName}。${fieldText}确认后我会执行流程结束接口并核对返回结果。`,
    note,
  }];
  return [
    {
      name: '流程信息收集',
      template: `我将为您${apiName}。${fieldText}我会先核对品牌与人员等前置信息，再执行流程结束接口。`,
      note,
    },
    {
      name: '执行前确认',
      template: `信息已整理完成，请确认品牌、人员、项目周期、金额和类型均无误。确认后我将执行流程结束接口，并反馈接口返回的结果。`,
      note,
    },
  ];
}

/** 将 Flow 编辑器编辑态和历史 flow.json 统一成编译器可消费的 FlowData。 */
export function normalizeFlowForEnhance(raw: unknown): FlowData {
  const data = (raw && typeof raw === 'object' ? raw : {}) as any;
  const legacy = typeof data.submitCommand === 'object' ? data.submitCommand : parseLegacyCommand(value(data.submitCommand));
  const endApi = data.endApi && typeof data.endApi === 'object' ? data.endApi : legacy;
  return {
    version: typeof data.version === 'number' ? data.version : 1,
    meta: { name: value(data.meta?.name), description: value(data.meta?.description), type: value(data.meta?.type) || 'flow', triggers: Array.isArray(data.meta?.triggers) ? data.meta.triggers.filter(Boolean) : [], ...(data.meta?.sourceRefs ? { sourceRefs: data.meta.sourceRefs } : {}) },
    title: value(data.title), businessGoal: value(data.businessGoal),
    scenarios: Array.isArray(data.scenarios) ? data.scenarios.filter(Boolean) : [],
    prerequisites: Array.isArray(data.prerequisites) ? data.prerequisites.filter(Boolean) : [],
    steps: flattenSteps(Array.isArray(data.steps) ? data.steps : []),
    fieldGroups: normalizeFieldGroups(data.fieldGroups),
    apis: Array.isArray(data.apis) ? data.apis : [],
    speechTemplates: Array.isArray(data.speechTemplates) ? data.speechTemplates : [],
    agentStrategy: { prefillRules: data.agentStrategy?.prefillRules || [], mustAsk: data.agentStrategy?.mustAsk || [], forbidden: data.agentStrategy?.forbidden || [] },
    ...(endApi ? { endApi: { method: value(endApi.method).toUpperCase() || 'POST', path: value(endApi.path), bodyTemplate: value(endApi.bodyTemplate) || '{}', ...(value(endApi.apiRef) ? { apiRef: value(endApi.apiRef) } : {}), ...(endApi.evidenceSource ? { evidenceSource: endApi.evidenceSource } : {}) } } : {}),
    errorHandling: Array.isArray(data.errorHandling) ? data.errorHandling : [],
    successCriteria: Array.isArray(data.successCriteria) ? data.successCriteria.filter(Boolean) : [],
    domainKnowledge: Array.isArray(data.domainKnowledge) ? data.domainKnowledge.filter(Boolean) : [],
    reference: { fields: value(data.reference?.fields), examples: value(data.reference?.examples), verify: value(data.reference?.verify) },
  };
}

function resolveRegistryApi(flow: FlowData, endApi: FlowEndApi, index?: RegistryIndex): ApiEntry | undefined {
  const registry = index ?? buildApiIndex();
  const local = flow.apis.find((api) => api.id === endApi.apiRef || (api.method === endApi.method && api.path === endApi.path));
  const registryRef = local?.evidence?.registryRef;
  if (registryRef) return registry.get(registryRef.apiId)?.api;
  if (endApi.apiRef && registry.has(endApi.apiRef)) return registry.get(endApi.apiRef)?.api;
  for (const entry of registry.values()) {
    if (entry.api.method.toUpperCase() === endApi.method.toUpperCase() && entry.api.path === endApi.path) return entry.api;
  }
  return undefined;
}

function sourceForParam(param: any): FieldTrace {
  const name = value(param.name);
  const source = value(param.source || param.paramSource);
  const defaultValue = param.default;
  if (defaultValue !== undefined && defaultValue !== null && String(defaultValue) !== '') return { field: name, required: Boolean(param.required), source: 'default', detail: `接口默认值：${defaultValue}` };
  if (/profile|session|登录|当前用户/i.test(source)) return { field: name, required: Boolean(param.required), source: 'profile', detail: source };
  if (/上游|返回|接口|response/i.test(source)) return { field: name, required: Boolean(param.required), source: 'upstream-api', detail: source };
  if (/计算|转换|derive|compute/i.test(source)) return { field: name, required: Boolean(param.required), source: 'computed', detail: source };
  return { field: name, required: Boolean(param.required), source: param.required ? 'unknown' : 'user-input', detail: source || (param.required ? '未找到可信来源，需要业务确认' : '可由用户按需提供') };
}

/** 先完成确定性的字段来源盘点，模型基于该结果补全业务语义。 */
export function analyzeFlowEnd(flowRaw: unknown, selectedEndApi?: FlowEndApi, capture?: CaptureEvidence, registryIndex?: RegistryIndex): ReverseAnalysis {
  const flow = normalizeFlowForEnhance(flowRaw);
  const endApi = selectedEndApi || getFlowEndApi(flow);
  if (!endApi || !endApi.path) throw new Error('请先选择流程结束接口');
  const local = flow.apis.find((api) => api.id === endApi.apiRef || (api.method === endApi.method && api.path === endApi.path));
  const registryApi = resolveRegistryApi(flow, endApi, registryIndex);
  if (registryApi && (!endApi.bodyTemplate || endApi.bodyTemplate === '{}') && registryApi.bodyTemplate) {
    endApi.bodyTemplate = typeof registryApi.bodyTemplate === 'string' ? registryApi.bodyTemplate : JSON.stringify(registryApi.bodyTemplate, null, 2);
  }
  if ((!endApi.bodyTemplate || endApi.bodyTemplate === '{}') && capture?.networkLogs) {
    const log = capture.networkLogs.find((item) => item.method?.toUpperCase() === endApi.method.toUpperCase() && item.url?.includes(endApi.path));
    if (log?.postData) endApi.bodyTemplate = log.postData;
  }
  const evidenceSource: EvidenceSource = local?.evidence?.source || endApi.evidenceSource || (registryApi ? 'registry' : capture?.networkLogs?.length ? 'capture' : 'name-only');
  const params = registryApi ? [ ...(registryApi.queryParams || []), ...(registryApi.bodyParams || []) ].map((param) => ({ ...param, source: registryApi.paramSources?.[param.name] })) : [];
  const traces = params.map(sourceForParam);
  const warnings: string[] = [];
  if (!registryApi) warnings.push(evidenceSource === 'capture' ? '结束接口未登记到 CLI 注册表，将依据脱敏抓包和步骤依赖分析。' : '结束接口只有名称或路径，不能推断未观察到的字段契约。');
  if (capture?.dependencies?.length) {
    for (const dep of capture.dependencies) {
      const trace = traces.find((item) => item.field === dep.paramName);
      if (trace && trace.source === 'unknown') {
        trace.source = 'upstream-api';
        trace.detail = `Live Lens：第 ${dep.sourceStepIndex} 步 ${dep.sourceJsonPath}`;
        trace.upstreamStepId = flow.steps[dep.sourceStepIndex - 1]?.id;
      }
    }
  }
  return { endApi: { ...endApi, evidenceSource }, evidenceSource, traces, warnings, ...(registryApi ? { registryApi } : {}) };
}

export function buildFlowEnhancePrompt(flowRaw: unknown, analysis: ReverseAnalysis, capture?: CaptureEvidence, businessGoalContext?: string): string {
  const flow = normalizeFlowForEnhance(flowRaw);
  return [
    '你是资深业务流程架构师。请以用户确认的「流程结束接口」为锚点反向推导完整流程。',
    '不得把结束接口默认视为提交；它可能是查询、校验或写入。不得臆造未知接口字段、参数来源或业务规则。',
    '', '## 流程结束接口', JSON.stringify(analysis.endApi, null, 2),
    '', '## 确定性字段来源盘点', JSON.stringify(analysis.traces, null, 2),
    '', '## 已匹配注册表接口（若存在，可继续只读查看 Controller/DTO/service）', JSON.stringify(analysis.registryApi || {}, null, 2),
    '', '## 当前 Flow', JSON.stringify(flow, null, 2),
    '', '## Live Lens 脱敏证据（若存在）', JSON.stringify(capture || {}, null, 2),
    '', '## 用户补充的业务目标（若存在）', businessGoalContext?.trim() || '（未补充；请仅依据已提供证据分析）',
    '', '## 输出要求',
    '先从结束接口的必填和校验反向确认每个字段的来源，递归安排前置查询、转换和用户输入；步骤必须从根输入走向结束接口。',
    '始终输出 status、questions、proposalJson 三个字段。证据不足且会影响流程语义时，输出 status=needs_input 和 1-3 个结构化 questions，proposalJson 传空字符串；否则输出 status=proposal，questions 传空数组。',
    '当 status=proposal 时，proposalJson 必须是一个 JSON 字符串；该字符串解析后为 { flow, warnings, pendingConfirmations }，其中 flow 是完整 Flow JSON。',
    'flow 必须保留当前 apis、meta.name、meta.type 和用户确认的 endApi，不可写 submitCommand。请补全 meta.sourceRefs：Controller 使用结束接口源码位置，DTO 溯源明确写出结束接口 id、方法、路径与证据来源。',
    '请至少生成一条 speechTemplates：基于结束接口所需的用户输入字段，说明如何向用户收集和确认信息；查询型结束接口则说明查询条件与结果确认。所有文本使用简体中文。',
  ].join('\n');
}

export function parseEnhanceResult(raw: string, analysis: ReverseAnalysis): EnhanceResult {
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Codex 输出不是合法 JSON'); }
  if (parsed?.status === 'needs_input') {
    const questions = Array.isArray(parsed.questions) ? parsed.questions.filter((q: any) => value(q?.question)).slice(0, 3).map((q: any, index: number) => ({ id: value(q.id) || `question-${index + 1}`, title: value(q.title) || '需要确认', question: value(q.question), ...(Array.isArray(q.options) ? { options: q.options.filter(Boolean).slice(0, 5) } : {}), ...(value(q.recommended) ? { recommended: value(q.recommended) } : {}) })) : [];
    if (!questions.length) throw new Error('Codex 请求补充信息但未提供有效问题');
    return { status: 'needs_input', questions, analysis };
  }
  let rawProposal = parsed?.proposal;
  if (!rawProposal && typeof parsed?.proposalJson === 'string') {
    try { rawProposal = JSON.parse(parsed.proposalJson); } catch { throw new Error('Codex 的 proposalJson 不是合法 JSON'); }
  }
  if (parsed?.status === 'proposal' && rawProposal?.flow) {
    const proposed = normalizeFlowForEnhance(rawProposal.flow);
    const locked = analysis.endApi;
    proposed.meta.name = normalizeFlowForEnhance(rawProposal.flow).meta.name || proposed.meta.name;
    proposed.endApi = locked;
    applyEndApiSourceRefs(proposed, analysis);
    if (proposed.speechTemplates.length === 0) proposed.speechTemplates = buildBaseSpeechTemplates(analysis);
    return { status: 'proposal', proposal: { flow: proposed, fieldTraces: analysis.traces, warnings: [...analysis.warnings, ...(rawProposal.warnings || [])].filter(Boolean), pendingConfirmations: (rawProposal.pendingConfirmations || []).filter(Boolean) } };
  }
  throw new Error('Codex 输出缺少 status=needs_input 或 status=proposal');
}

/** 应用提案时再次锁定不可由模型更改的 API 清单、Flow ID 和结束接口。 */
export function mergeEnhanceProposal(currentRaw: unknown, proposal: EnhanceProposal): FlowData {
  const current = normalizeFlowForEnhance(currentRaw);
  const merged = normalizeFlowForEnhance(proposal.flow);
  merged.meta.name = current.meta.name;
  merged.meta.type = current.meta.type;
  merged.apis = current.apis;
  merged.endApi = getFlowEndApi(current) || proposal.flow.endApi;
  return merged;
}
