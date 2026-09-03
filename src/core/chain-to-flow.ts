import type { FlowData, FlowStep, FlowApi } from './flow-compiler.js';
import type { ApiEntry, ChainDef, ModuleRegistry } from './skill-builder.js';

export interface FlowFromChainResult {
  flowData: FlowData;
  business: string;
}

/**
 * F-6：从注册表处理链生成 flow 骨架 FlowData。
 *
 * - steps 直接取 chain 的 api id（注册表 id 可被接地校验解析，天然过校验）
 * - 最后一个 api 作为提交命令（method/path/bodyTemplate）
 * - 其余 api 进 flow.apis[] 作为辅助接口（SKILL.md 渲染到「辅助接口」节）
 * - 话术模板与预填策略留占位，由人工按 FLOW-SPEC §5/§6 补充
 */
export function buildFlowFromChain(
  project: string,
  registry: ModuleRegistry,
  chain: ChainDef,
  businessOverride?: string,
): FlowFromChainResult {
  const apiIndex = new Map<string, ApiEntry>();
  for (const api of registry.apis) apiIndex.set(api.id, api);

  const missingSteps = chain.steps.filter((stepId) => !apiIndex.has(stepId));
  if (missingSteps.length > 0) {
    throw new Error(`无法生成 flow：chain 步骤不在注册表中：${missingSteps.join(', ')}`);
  }
  if (chain.steps.length < 2) {
    throw new Error(`无法生成 flow：chain「${chain.name}」少于 2 个步骤`);
  }

  const resolved = chain.steps.map((stepId) => apiIndex.get(stepId)!);
  const source = resolved[0];
  const target = resolved[resolved.length - 1];
  const business = businessOverride || target.id;

  const auxApis: FlowApi[] = resolved.slice(0, -1).map((api) => ({
    id: api.id,
    purpose: api.summary,
    method: api.method,
    path: api.path,
    description: '',
  }));

  const steps: FlowStep[] = resolved.map((api, i) => ({
    id: `step-${i + 1}`,
    title: api.summary,
    level: 0,
    parentId: null,
    conditional: false,
    condition: null,
    dependsOn: i === 0 ? [] : [`step-${i}`],
    apiRefs: [api.id],
    fieldRefs: [],
    content: i === resolved.length - 1
      ? `提交动作：调用 ${api.id}（${api.method} ${api.path}）完成「${api.summary}」。（骨架占位：补充本步骤说明与请求体字段核对结果）`
      : `（骨架占位：补充本步骤说明 —— 调用 ${api.id} 取什么数据、哪些字段传给后续步骤）`,
  }));

  const bodyTemplate = target.bodyTemplate !== undefined && target.bodyTemplate !== null
    ? (typeof target.bodyTemplate === 'string'
      ? target.bodyTemplate
      : JSON.stringify(target.bodyTemplate, null, 2))
    : '{}';

  const flowData: FlowData = {
    version: 1,
    meta: {
      name: `flow-${project}-${business}`,
      description: `业务流程：${chain.name}。（anycli flow from-chain 自动生成骨架，请补充完整业务描述）`,
      type: 'flow',
      triggers: [],
    },
    title: `${source.summary} → ${target.summary}`,
    businessGoal: `（骨架占位：用业务语言描述本流程要达成什么）\n参考：沿处理链「${chain.name}」，最终调用 ${target.method} ${target.path} 完成「${target.summary}」。`,
    scenarios: ['（骨架占位：补充适用场景）'],
    prerequisites: [
      `已登录 ${project}（\`anycli auth status\` 检查）`,
      '（骨架占位：补充其他前置条件，如依赖数据已存在）',
    ],
    steps,
    fieldGroups: [],
    apis: auxApis,
    speechTemplates: [],
    agentStrategy: {
      prefillRules: [],
      mustAsk: [],
      forbidden: ['严禁随机生成测试数据或臆造必填字段（FLOW-SPEC §5.2）'],
    },
    endApi: { apiRef: target.id, method: target.method, path: target.path, bodyTemplate, evidenceSource: 'registry' },
    errorHandling: [
      { scenario: 'AUTH_EXPIRED / Session 过期', handling: '`anycli auth login` 重新登录' },
      { scenario: '（骨架占位：补充业务错误场景）', handling: '（补充处理方式）' },
    ],
    successCriteria: ['（骨架占位：补充成功判定标准，如接口返回 success=true 且数据落库）'],
    domainKnowledge: [
      '本骨架由 anycli flow from-chain 从注册表处理链自动生成，所有「骨架占位」内容需人工补充后再 flow build 发布。',
      '话术模板（speechTemplates）与预填策略（agentStrategy.prefillRules）未填充，请按 FLOW-SPEC §5/§6 编写。',
    ],
    reference: { fields: '', examples: '', verify: buildVerifyPlaceholder(project, target) },
  };

  return { flowData, business };
}

/** F-8：骨架自动生成 reference/verify.md 测试脚本占位 */
function buildVerifyPlaceholder(project: string, target: ApiEntry): string {
  const requestLine = 'anycli request ' + project + ' ' + target.method + ' ' + target.path + " --body '<参考提交命令模板>'";
  return [
    '# 验证脚本（test 环境端到端）',
    '',
    '> 骨架占位：补充 test 环境验证步骤（FLOW-SPEC §9），发布前跑通一遍。',
    '',
    '## 前置',
    '',
    '- 环境：test（`anycli config list` 确认）',
    '- 登录：`anycli auth status`',
    '',
    '## 步骤',
    '',
    '1. `' + requestLine + '` — 预期：success=true（骨架占位：填入真实请求体）',
    '2. （骨架占位：补充后续验证步骤与数据落库核对）',
    '',
    '## 成功标准',
    '',
    '- 接口返回 success=true',
    '- （骨架占位：补充数据层核对）',
    '',
  ].join('\n');
}
