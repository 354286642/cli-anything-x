import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

// ── 数据类型定义 ──

export interface FlowMeta {
  name: string;
  description: string;
  type: string;
  triggers: string[];
  sourceRefs?: { controller?: string; dto?: string; frontend?: string };
}

export interface FlowStep {
  id: string;
  title: string;
  level: number;
  parentId: string | null;
  conditional: boolean;
  condition: string | null;
  dependsOn: string[];
  apiRef?: string | null;
  apiRefs?: string[];
  fieldRefs: string[];
  content: string;
}

export interface FlowField {
  name: string;
  type: string;
  required: boolean;
  condition: string | null;
  options: string | null;
  description: string;
}

export interface FlowFieldGroup {
  name: string;
  fields: FlowField[];
}

export interface FlowApi {
  id: string;
  purpose: string;
  method: string;
  path: string;
  description: string;
  evidence?: {
    source: 'registry' | 'capture' | 'name-only';
    registryRef?: { project: string; module: string; apiId: string };
  };
}

export interface FlowSpeechTemplate {
  name: string;
  template: string;
  note: string;
}

export interface FlowAgentStrategy {
  prefillRules: string[];
  mustAsk: string[];
  forbidden: string[];
}

export interface FlowSubmitCommand {
  method: string;
  path: string;
  bodyTemplate: string;
}

/** 流程的业务终点，可以是写入、查询或校验接口。 */
export interface FlowEndApi extends FlowSubmitCommand {
  apiRef?: string;
  evidenceSource?: 'registry' | 'capture' | 'name-only';
}

export interface FlowErrorHandling {
  scenario: string;
  handling: string;
}

export interface FlowReference {
  fields: string;
  examples: string;
  verify: string;
}

export interface FlowData {
  version: number;
  meta: FlowMeta;
  title: string;
  businessGoal: string;
  scenarios: string[];
  prerequisites: string[];
  steps: FlowStep[];
  fieldGroups: FlowFieldGroup[];
  apis: FlowApi[];
  speechTemplates: FlowSpeechTemplate[];
  agentStrategy: FlowAgentStrategy;
  /** 新字段：流程结束接口。 */
  endApi?: FlowEndApi;
  /** @deprecated 仅用于读取旧 flow.json，写入时应使用 endApi。 */
  submitCommand?: FlowSubmitCommand;
  errorHandling: FlowErrorHandling[];
  successCriteria: string[];
  domainKnowledge: string[];
  reference: FlowReference;
  _parseWarnings?: string[];
}

// ── 编译器：flow.json → SKILL.md + reference/ ──

export function compileFlow(data: FlowData): { skillMd: string; references: Record<string, string> } {
  const sections: string[] = [];

  sections.push(yamlFrontmatter(data.meta));
  sections.push('<!-- AUTO-GENERATED from flow.json — 请勿手动编辑 -->');
  sections.push('');
  sections.push(`# ${data.title}`);

  if (data.businessGoal) {
    sections.push('## 业务目标');
    sections.push('');
    sections.push(data.businessGoal);
  }

  if (data.scenarios.length > 0) {
    sections.push('## 适用场景');
    sections.push('');
    for (const scenario of data.scenarios) {
      sections.push(`- ${scenario}`);
    }
  }

  if (data.prerequisites.length > 0) {
    sections.push('## 前置条件');
    sections.push('');
    for (const prereq of data.prerequisites) {
      sections.push(`- ${prereq}`);
    }
  }

  if (data.steps.length > 0) {
    sections.push('## 流程总览');
    sections.push('');
    sections.push(renderStepsOverview(data.steps, data.apis));
    sections.push('');
    sections.push('## 步骤详情');
    sections.push('');
    sections.push(renderStepsDetail(data.steps, data.apis));
  }

  if (data.fieldGroups.length > 0) {
    sections.push('## 字段依赖图');
    sections.push('');
    sections.push('```');
    sections.push(generateFieldDependencyGraph(data.fieldGroups));
    sections.push('```');
  }

  if (data.speechTemplates.length > 0) {
    sections.push('## 快速话术模板');
    sections.push('');
    for (const tpl of data.speechTemplates) {
      sections.push(`### ${tpl.name}`);
      sections.push('');
      sections.push('```');
      sections.push(tpl.template);
      sections.push('```');
      if (tpl.note) {
        sections.push('');
        sections.push(`> ${tpl.note}`);
      }
      sections.push('');
    }
  }

  if (data.agentStrategy) {
    sections.push('## Agent 引导策略：智能预填 + 确认修改');
    sections.push('');
    if (data.agentStrategy.prefillRules.length > 0) {
      sections.push('### 可预填字段（有合理默认值）');
      sections.push('');
      for (const rule of data.agentStrategy.prefillRules) {
        sections.push(`- ${rule}`);
      }
      sections.push('');
    }
    if (data.agentStrategy.mustAsk.length > 0) {
      sections.push('### 必须追问字段（无默认、不可编造）');
      sections.push('');
      for (const item of data.agentStrategy.mustAsk) {
        sections.push(`- ${item}`);
      }
      sections.push('');
    }
    if (data.agentStrategy.forbidden.length > 0) {
      sections.push('### 禁止行为');
      sections.push('');
      for (const item of data.agentStrategy.forbidden) {
        sections.push(`- ${item}`);
      }
    }
  }

  const endApi = getFlowEndApi(data);
  if (endApi && endApi.path) {
    sections.push('## 流程结束接口调用示例');
    sections.push('');
    sections.push('```bash');
    const body = (endApi.bodyTemplate || '').trim();
    const alreadyCommand = /^anycli\s+/i.test(body) || /anycli\s+request/i.test(body);
    if (alreadyCommand) {
      // 剥离导入残留的残缺前导命令行（--body 后空换行且下接 anycli）
      const stripped = body.replace(/^anycli[^\n]*?--body\s+'?\s*\n(?=anycli\s+)/i, '');
      sections.push(stripped);
    } else {
      sections.push(`anycli request <project> ${endApi.method} ${cleanApiPath(endApi.path)} --body '`);
      sections.push(endApi.bodyTemplate);
      sections.push("'");
    }
    sections.push('```');
  }

  if (data.apis.length > 0) {
    sections.push('## 辅助接口');
    sections.push('');
    sections.push(markdownTable(
      ['用途', '命令/接口', '说明'],
      data.apis.map((api) => [
        api.purpose,
        `${api.method} ${cleanApiPath(api.path)}`,
        api.description,
      ]),
    ));
  }

  if (data.errorHandling.length > 0) {
    sections.push('## 错误处理');
    sections.push('');
    sections.push(markdownTable(
      ['错误场景', '处理方式'],
      data.errorHandling.map((eh) => [eh.scenario, eh.handling]),
    ));
  }

  if (data.successCriteria.length > 0) {
    sections.push('## 成功标准');
    sections.push('');
    for (const criterion of data.successCriteria) {
      sections.push(`- ${criterion}`);
    }
  }

  if (data.domainKnowledge.length > 0) {
    sections.push('## 领域知识');
    sections.push('');
    for (const knowledge of data.domainKnowledge) {
      sections.push(`- ${knowledge}`);
    }
  }

  sections.push('## 参考文件');
  sections.push('');
  sections.push(renderReferenceLinks(data));

  const skillMd = sections.join('\n') + '\n';

  const references: Record<string, string> = {};
  if (data.reference.fields) references['fields.md'] = data.reference.fields;
  if (data.reference.examples) references['examples.md'] = data.reference.examples;
  if (data.reference.verify) references['verify.md'] = data.reference.verify;

  return { skillMd, references };
}

/** 统一读取新旧流程终点，保证旧 submitCommand 产物仍可编译。 */
export function getFlowEndApi(data: Pick<FlowData, 'endApi' | 'submitCommand'>): FlowEndApi | undefined {
  if (data.endApi && data.endApi.path) return data.endApi;
  if (data.submitCommand && data.submitCommand.path) return data.submitCommand;
  return undefined;
}

// ── 文件写入 ──

export function writeFlowFiles(flowDir: string, data: FlowData): void {
  const { skillMd, references } = compileFlow(data);

  writeFileSync(join(flowDir, 'SKILL.md'), skillMd, 'utf-8');

  const refDir = join(flowDir, 'reference');
  if (Object.keys(references).length > 0) {
    mkdirSync(refDir, { recursive: true });
    for (const [filename, content] of Object.entries(references)) {
      writeFileSync(join(refDir, filename), content, 'utf-8');
    }
  }
}

// ── 内部工具函数 ──

function yamlFrontmatter(meta: FlowMeta): string {
  const lines: string[] = ['---'];
  lines.push(`name: ${meta.name}`);
  lines.push('description: >');
  for (const line of wrapText(meta.description, 70)) {
    lines.push(`  ${line}`);
  }
  lines.push(`type: ${meta.type}`);
  lines.push('triggers:');
  for (const trigger of meta.triggers) {
    lines.push(`  - ${trigger}`);
  }
  if (meta.sourceRefs) {
    lines.push('source_refs:');
    if (meta.sourceRefs.controller) lines.push(`  controller: ${meta.sourceRefs.controller}`);
    if (meta.sourceRefs.dto) lines.push(`  dto: ${meta.sourceRefs.dto}`);
    if (meta.sourceRefs.frontend) lines.push(`  frontend: ${meta.sourceRefs.frontend}`);
  }
  lines.push('---');
  return lines.join('\n');
}

// ── 步骤索引 / 依赖归一化 / 接口映射 ──

interface StepIndexEntry { num: string; title: string; }

function buildStepIndex(steps: FlowStep[]): Map<string, StepIndexEntry> {
  const map = new Map<string, StepIndexEntry>();
  let topCounter = 0;
  const childCounter = new Map<string, number>();
  for (const step of steps) {
    if (step.level === 0) {
      topCounter++;
      map.set(step.id, { num: String(topCounter), title: step.title });
    } else {
      const parentNum = step.parentId && map.has(step.parentId) ? map.get(step.parentId)!.num : '?';
      const cidx = (childCounter.get(parentNum) || 0) + 1;
      childCounter.set(parentNum, cidx);
      map.set(step.id, { num: `${parentNum}.${cidx}`, title: step.title });
    }
  }
  return map;
}

function cleanApiPath(path: string): string {
  return (path || '').replace(/[`\u2018\u2019]/g, '').trim();
}

function buildApiMap(apis: FlowApi[]): Map<string, FlowApi> {
  const map = new Map<string, FlowApi>();
  for (const api of apis) {
    if (api.id) map.set(api.id, { ...api, path: cleanApiPath(api.path) });
  }
  return map;
}

function resolveApiRefs(step: FlowStep): string[] {
  if (Array.isArray(step.apiRefs) && step.apiRefs.length) return step.apiRefs.filter(Boolean);
  if (step.apiRef) return [step.apiRef];
  return [];
}

/** 归一化依赖：纯数字 n → step-n；去重；过滤自身与未知 id */
function normalizeDepends(dependsOn: string[], selfId: string, known: Set<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of dependsOn || []) {
    let dep = (raw || '').trim();
    if (!dep) continue;
    if (/^\d+$/.test(dep)) dep = `step-${dep}`;
    if (dep === selfId) continue;
    if (known.size > 0 && !known.has(dep)) continue;
    if (seen.has(dep)) continue;
    seen.add(dep);
    out.push(dep);
  }
  return out;
}

function apiLabel(apiId: string, apiMap: Map<string, FlowApi>): string {
  const api = apiMap.get(apiId);
  return api && api.purpose ? api.purpose : apiId;
}

function stepRefLabel(depId: string, idx: Map<string, StepIndexEntry>): string {
  const e = idx.get(depId);
  return e ? `Step ${e.num}「${e.title}」` : depId;
}

function renderStepsOverview(steps: FlowStep[], apis: FlowApi[]): string {
  const idx = buildStepIndex(steps);
  const apiMap = buildApiMap(apis);
  const known = new Set(steps.map((s) => s.id));
  const lines: string[] = [];
  for (const step of steps) {
    const e = idx.get(step.id)!;
    const condTag = step.conditional ? ' `条件`' : '';
    const deps = normalizeDepends(step.dependsOn, step.id, known);
    const refs = resolveApiRefs(step);
    const parts: string[] = [];
    if (step.conditional && step.condition) parts.push(`当 ${step.condition}`);
    if (deps.length) parts.push('依赖 ' + deps.map((d) => stepRefLabel(d, idx)).join('、'));
    if (refs.length) parts.push('调用 ' + refs.map((r) => `「${apiLabel(r, apiMap)}」`).join('、'));
    const indent = step.level === 0 ? '' : '   ';
    const marker = step.level === 0 ? `${e.num}.` : '-';
    const tail = parts.length ? ` — ${parts.join('；')}` : '';
    lines.push(`${indent}${marker} **${step.title}**${condTag}${tail}`);
  }
  return lines.join('\n');
}

function renderStepsDetail(steps: FlowStep[], apis: FlowApi[]): string {
  const idx = buildStepIndex(steps);
  const apiMap = buildApiMap(apis);
  const known = new Set(steps.map((s) => s.id));
  const blocks: string[] = [];
  for (const step of steps) {
    const e = idx.get(step.id)!;
    const deps = normalizeDepends(step.dependsOn, step.id, known);
    const refs = resolveApiRefs(step);
    const fields = (step.fieldRefs || []).filter(Boolean);
    const head = step.level === 0 ? `### Step ${e.num}：${step.title}` : `#### Step ${e.num}：${step.title}`;
    const lines: string[] = [head, ''];
    const meta: string[] = [];
    if (step.conditional && step.condition) meta.push(`- **触发条件**：${step.condition}`);
    if (deps.length) meta.push(`- **依赖步骤**：${deps.map((d) => stepRefLabel(d, idx)).join('、')}`);
    if (refs.length) {
      meta.push('- **调用接口**：' + refs.map((r) => {
        const api = apiMap.get(r);
        return api ? `${api.purpose || api.id}（\`${api.method} ${api.path}\`）` : `\`${r}\``;
      }).join('；'));
    }
    if (fields.length) meta.push(`- **关联字段**：${fields.map((f) => `\`${f}\``).join('、')}`);
    if (meta.length) { lines.push(...meta); lines.push(''); }
    let body = (step.content || '').trim();
    // 清洗导入残留：content 仅为「标题 + 依赖标注」时视为无效
    if (body) {
      const afterTitle = body.startsWith(step.title || '') ? body.slice((step.title || '').length).trim() : body;
      if (afterTitle === '' || /^(?:[（(]依赖[^)）]*[)）])+$/.test(afterTitle)) body = '';
    }
    let bodyPrinted = false;
    if (body && body !== (step.title || '').trim()) {
      lines.push(body);
      lines.push('');
      bodyPrinted = true;
    }
    if (meta.length === 0 && !bodyPrinted) {
      lines.push('_（暂无更多配置 — 可在编辑器为此步骤补充触发条件、关联接口 / 字段、步骤说明）_');
      lines.push('');
    }
    blocks.push(lines.join('\n').replace(/\n+$/, ''));
  }
  return blocks.join('\n\n');
}

interface DepTreeNode {
  fieldName: string;
  label: string;
  children: DepTreeNode[];
}

function generateFieldDependencyGraph(fieldGroups: FlowFieldGroup[]): string {
  const allFields: FlowField[] = [];
  for (const group of fieldGroups) {
    allFields.push(...group.fields);
  }

  const rootFields: FlowField[] = [];
  const childMap = new Map<string, FlowField[]>();

  for (const field of allFields) {
    const parent = parseConditionParent(field.condition);
    if (parent) {
      if (!childMap.has(parent)) childMap.set(parent, []);
      childMap.get(parent)!.push(field);
    } else {
      rootFields.push(field);
    }
  }

  const lines: string[] = [];
  for (const field of rootFields) {
    const reqTag = field.required ? '必填' : '可选';
    lines.push(`${field.name} (${reqTag})`);
    renderDepChildren(field.name, childMap, lines, '  ', new Set());
  }

  return lines.join('\n');
}

function renderDepChildren(
  parentName: string,
  childMap: Map<string, FlowField[]>,
  lines: string[],
  indent: string,
  visited: Set<string>,
): void {
  if (visited.has(parentName)) return;
  visited.add(parentName);

  const children = childMap.get(parentName);
  if (!children || children.length === 0) return;

  for (let idx = 0; idx < children.length; idx++) {
    const child = children[idx];
    const isLast = idx === children.length - 1;
    const connector = isLast ? '└→' : '├→';
    const condLabel = child.condition ? `[${child.condition}] ` : '';
    const reqTag = child.required ? '必填' : '条件';
    lines.push(`${indent}${connector} ${condLabel}${child.name} (${reqTag})`);

    const nextIndent = indent + (isLast ? '   ' : '│  ');
    renderDepChildren(child.name, childMap, lines, nextIndent, visited);
  }
}

function parseConditionParent(condition: string | null): string | null {
  if (!condition) return null;

  const eqMatch = condition.match(/^(\w+)\s*=/);
  if (eqMatch) return eqMatch[1];

  const inMatch = condition.match(/^(\w+)\s*∈/);
  if (inMatch) return inMatch[1];

  const cnMatch = condition.match(/^([\u4e00-\u9fa5\w]+)\s*[=∈]/);
  if (cnMatch) return cnMatch[1];

  return null;
}

function markdownTable(headers: string[], rows: string[][]): string {
  const lines: string[] = [];
  lines.push(`| ${headers.join(' | ')} |`);
  lines.push(`|${headers.map(() => '------').join('|')}|`);
  for (const row of rows) {
    lines.push(`| ${row.join(' | ')} |`);
  }
  return lines.join('\n');
}

function renderReferenceLinks(data: FlowData): string {
  const lines: string[] = [];
  lines.push('本流程的详细内容按模块拆分到 `reference/` 目录，Agent 按需查阅：');
  lines.push('');
  lines.push('| 文件 | 内容 | 何时查阅 |');
  lines.push('|------|------|---------|');
  if (data.reference.fields) {
    lines.push('| [reference/fields.md](./reference/fields.md) | 完整字段字典 + 条件规则 | 组装 JSON 遇字段条件不确定时 |');
  }
  if (data.reference.examples) {
    lines.push('| [reference/examples.md](./reference/examples.md) | 话术示例集 | 解析困难时参考 few-shot |');
  }
  if (data.reference.verify) {
    lines.push('| [reference/verify.md](./reference/verify.md) | 验证脚本 | 验证流程可用性时 |');
  }
  return lines.join('\n');
}

function wrapText(text: string, maxWidth: number): string[] {
  if (text.length <= maxWidth) return [text];
  const lines: string[] = [];
  let current = '';
  for (const char of text) {
    current += char;
    if (current.length >= maxWidth) {
      lines.push(current);
      current = '';
    }
  }
  if (current) lines.push(current);
  return lines;
}
