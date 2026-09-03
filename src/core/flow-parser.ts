import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { FlowMeta, FlowStep, FlowField, FlowFieldGroup, FlowApi, FlowSpeechTemplate, FlowAgentStrategy, FlowSubmitCommand, FlowErrorHandling, FlowReference, FlowData } from './flow-compiler.js';

// ─── 类型定义（与 flow-compiler.ts 保持一致） ───────────────────────────────────


// ─── 内部工具函数 ─────────────────────────────────────────────────────────────────

/** 解析 YAML frontmatter 块，返回元数据和正文 */
function parseFrontmatter(raw: string): { meta: FlowMeta; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return {
      meta: { name: '', description: '', type: 'flow', triggers: [] },
      body: raw,
    };
  }

  const yamlBlock = match[1];
  const body = raw.slice(match[0].length);

  const name = extractYamlValue(yamlBlock, 'name') ?? '';
  const description = extractYamlMultiline(yamlBlock, 'description') ?? extractYamlValue(yamlBlock, 'description') ?? '';
  const type = extractYamlValue(yamlBlock, 'type') ?? 'flow';
  const triggers = extractYamlList(yamlBlock, 'triggers');
  const sourceRefs = extractSourceRefs(yamlBlock);

  return {
    meta: { name, description, type, triggers, sourceRefs },
    body,
  };
}

/** 提取简单 key: value 行 */
function extractYamlValue(yaml: string, key: string): string | null {
  const regex = new RegExp(`^${key}:\\s*(.+)$`, 'm');
  const found = yaml.match(regex);
  if (!found) return null;
  const value = found[1].trim();
  // 多行折叠标记 > 或 | 时返回 null，由 extractYamlMultiline 处理
  if (value === '>' || value === '|' || value === '>-' || value === '|-') return null;
  return value.replace(/^["']|["']$/g, '');
}

/** 提取多行折叠值（> 或 |） */
function extractYamlMultiline(yaml: string, key: string): string | null {
  const regex = new RegExp(`^${key}:\\s*[>|][-+]?\\s*\\n((?:[ \\t]+.+\\n?)+)`, 'm');
  const found = yaml.match(regex);
  if (!found) return null;
  return found[1]
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
}

/** 提取 YAML 列表（- item 格式） */
function extractYamlList(yaml: string, key: string): string[] {
  const regex = new RegExp(`^${key}:\\s*\\n((?:\\s+-\\s+.+\\n?)+)`, 'm');
  const found = yaml.match(regex);
  if (!found) return [];
  return found[1]
    .split('\n')
    .map((line) => line.replace(/^\s+-\s+/, '').trim())
    .filter(Boolean);
}

/** 提取 source_refs 对象 */
function extractSourceRefs(yaml: string): FlowMeta['sourceRefs'] {
  const blockMatch = yaml.match(/^source_refs:\s*\n((?:[ \t]+.+[\n]?)+)/m);
  if (!blockMatch) return undefined;

  const block = blockMatch[1];
  const refs: FlowMeta['sourceRefs'] = {};

  const controllerMatch = block.match(/controller:\s*(.+)/);
  if (controllerMatch) refs.controller = controllerMatch[1].trim();

  const dtoMatch = block.match(/dto:\s*(.+)/);
  if (dtoMatch) refs.dto = dtoMatch[1].trim();

  const frontendMatch = block.match(/frontend:\s*(.+)/);
  if (frontendMatch) refs.frontend = frontendMatch[1].trim();

  return Object.keys(refs).length > 0 ? refs : undefined;
}

/** 按 ## 标题拆分章节 */
function splitSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = body.split('\n');
  let currentTitle = '';
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      if (currentTitle) {
        sections.set(currentTitle, currentLines.join('\n').trim());
      }
      currentTitle = headingMatch[1].trim();
      currentLines = [];
    } else if (currentTitle) {
      currentLines.push(line);
    }
  }
  if (currentTitle) {
    sections.set(currentTitle, currentLines.join('\n').trim());
  }
  return sections;
}

/** 解析无序/有序列表项 */
function parseListItems(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.match(/^\s*[-*]\s+(.+)$/) || line.match(/^\s*\d+[.)]\s+(.+)$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => match[1].trim());
}

/** 解析 Markdown 表格，返回行数组（跳过表头和分隔行） */
function parseMarkdownTable(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.split('\n').filter((line) => line.trim().startsWith('|'));
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    // 跳过分隔行（|---|---|）
    if (/^\|[\s\-:|]+\|$/.test(line.trim())) continue;
    // 跳过表头（第一行）
    if (idx === 0) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/** 提取代码块内容 */
function extractCodeBlocks(text: string): { lang: string; code: string }[] {
  const blocks: { lang: string; code: string }[] = [];
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  let codeMatch: RegExpExecArray | null;
  while ((codeMatch = regex.exec(text)) !== null) {
    blocks.push({ lang: codeMatch[1], code: codeMatch[2].trim() });
  }
  return blocks;
}

/** 解析流程总览中的步骤列表 */
function parseSteps(text: string): FlowStep[] {
  const steps: FlowStep[] = [];
  const lines = text.split('\n');
  let stepCounter = 0;
  let lastParentId: string | null = null;

  for (const line of lines) {
    // 匹配顶层步骤：Step N: xxx 或 N: xxx 或 N. xxx
    const topMatch = line.match(/^(?:Step\s+)?(\d+)[.:：]\s*(.+)$/);
    // 匹配子步骤：缩进的 Na: xxx 或 N.N: xxx
    const subMatch = line.match(/^\s+(\d+[a-z]|\d+\.\d+)[.:：]\s*(.+)$/);

    if (subMatch) {
      stepCounter++;
      const title = subMatch[2].trim();
      const step = buildStep(`step-${stepCounter}`, title, 1, lastParentId);
      steps.push(step);
    } else if (topMatch) {
      stepCounter++;
      const title = topMatch[2].trim();
      const stepId = `step-${stepCounter}`;
      const step = buildStep(stepId, title, 0, null);
      steps.push(step);
      lastParentId = stepId;
    }
  }
  return steps;
}

/** 构建单个 FlowStep 对象 */
function buildStep(id: string, rawTitle: string, level: number, parentId: string | null): FlowStep {
  const conditional = /\[条件\]/.test(rawTitle);
  const title = rawTitle.replace(/\[条件\]\s*/, '').trim();

  // 提取依赖：（依赖 Step X, Y）支持逗号分隔，纯数字归一为 step-n，去重
  const dependsOn: string[] = [];
  const seenDep = new Set<string>();
  const depRegex = /[（(]依赖\s*([^)）]+)[)）]/g;
  let depMatch: RegExpExecArray | null;
  while ((depMatch = depRegex.exec(rawTitle)) !== null) {
    for (const piece of depMatch[1].split(/[,，、]/)) {
      let dep = piece.trim().replace(/^Step\s+/i, '');
      if (!dep) continue;
      if (/^\d+$/.test(dep)) dep = `step-${dep}`;
      if (!seenDep.has(dep)) { seenDep.add(dep); dependsOn.push(dep); }
    }
  }

  // 提取条件描述
  let condition: string | null = null;
  if (conditional) {
    const condMatch = rawTitle.match(/\[条件\]\s*(.+?)(?:[（(]|$)/);
    condition = condMatch ? condMatch[1].trim() : null;
  }

  return {
    id,
    title,
    level,
    parentId,
    conditional,
    condition,
    dependsOn,
    apiRefs: [],
    fieldRefs: [],
    content: rawTitle,
  };
}

/** 解析快速话术模板章节 */
function parseSpeechTemplates(text: string): FlowSpeechTemplate[] {
  const templates: FlowSpeechTemplate[] = [];
  const subSections = text.split(/^###\s+/m).slice(1);

  for (const section of subSections) {
    const lines = section.split('\n');
    const name = lines[0].trim();
    const rest = lines.slice(1).join('\n');

    const codeBlocks = extractCodeBlocks(rest);
    const template = codeBlocks.length > 0 ? codeBlocks[0].code : '';

    // 提取 > 引用作为 note
    const noteMatch = rest.match(/^>\s*(.+)$/m);
    const note = noteMatch ? noteMatch[1].trim() : '';

    if (template) {
      templates.push({ name, template, note });
    }
  }
  return templates;
}

/** 解析 Agent 引导策略章节 */
function parseAgentStrategy(text: string): FlowAgentStrategy {
  const prefillRules: string[] = [];
  const mustAsk: string[] = [];
  const forbidden: string[] = [];

  // 按 ### 子标题分段
  const subSections = text.split(/^###\s+/m);
  for (const section of subSections) {
    const lowerSection = section.toLowerCase();
    if (lowerSection.startsWith('预填规则') || lowerSection.startsWith('prefill')) {
      // 解析表格或列表
      const tableRows = parseMarkdownTable(section);
      if (tableRows.length > 0) {
        for (const row of tableRows) {
          prefillRules.push(row.join(' | '));
        }
      } else {
        prefillRules.push(...parseListItems(section));
      }
    } else if (lowerSection.startsWith('必须追问') || lowerSection.startsWith('must')) {
      mustAsk.push(...parseListItems(section));
    } else if (lowerSection.startsWith('禁止') || lowerSection.startsWith('forbidden')) {
      forbidden.push(...parseListItems(section));
    }
  }

  // 如果没有子标题分段，尝试从整体列表提取
  if (prefillRules.length === 0 && mustAsk.length === 0 && forbidden.length === 0) {
    prefillRules.push(...parseListItems(text));
  }

  return { prefillRules, mustAsk, forbidden };
}

/** 解析提交命令章节 */
function parseSubmitCommand(text: string): FlowSubmitCommand {
  const codeBlocks = extractCodeBlocks(text);
  const bodyTemplate = codeBlocks.length > 0 ? codeBlocks[0].code : '';

  // 尝试从命令中提取 method 和 path
  let method = 'POST';
  let path = '';

  const curlMatch = bodyTemplate.match(/curl\s+-X\s+(\w+)\s+["']?([^\s"']+)/i);
  if (curlMatch) {
    method = curlMatch[1].toUpperCase();
    path = curlMatch[2];
  } else {
    // anycli 命令格式：anycli demo order create --data '{...}'
    const anycliMatch = bodyTemplate.match(/anycli\s+\w+\s+\w+\s+(\S+)/);
    if (anycliMatch) {
      path = anycliMatch[1];
    }
    // POST /api/xxx 格式
    const apiMatch = bodyTemplate.match(/(GET|POST|PUT|DELETE|PATCH)\s+(\/\S+)/i);
    if (apiMatch) {
      method = apiMatch[1].toUpperCase();
      path = apiMatch[2];
    }
  }

  return { method, path, bodyTemplate };
}

/** 解析辅助接口表格 */
function parseApis(text: string): FlowApi[] {
  const rows = parseMarkdownTable(text);
  const apis: FlowApi[] = [];

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    if (row.length < 2) continue;

    const purpose = row[0];
    const commandCell = row[1];
    const description = row.length > 2 ? row[2] : '';

    // 从命令中提取 method 和 path
    let method = 'POST';
    let path = commandCell;
    const methodMatch = commandCell.match(/(GET|POST|PUT|DELETE|PATCH)\s+(\/\S+)/i);
    if (methodMatch) {
      method = methodMatch[1].toUpperCase();
      path = methodMatch[2];
    }

    apis.push({
      id: `api-${idx + 1}`,
      purpose,
      method,
      path,
      description,
    });
  }
  return apis;
}

/** 解析错误处理表格 */
function parseErrorHandling(text: string): FlowErrorHandling[] {
  const rows = parseMarkdownTable(text);
  return rows
    .filter((row) => row.length >= 2)
    .map((row) => ({
      scenario: row[0],
      handling: row[1],
    }));
}

/** 提取文档标题（# 一级标题） */
function extractTitle(body: string): string {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : '';
}

// ─── 导出函数 ─────────────────────────────────────────────────────────────────────

/**
 * 加载 reference 目录下的参考文件
 */
export function loadReferenceFiles(flowDir: string): FlowReference {
  const reference: FlowReference = { fields: '', examples: '', verify: '' };
  const refDir = join(flowDir, 'reference');

  const fieldsPath = join(refDir, 'fields.md');
  if (existsSync(fieldsPath)) {
    reference.fields = readFileSync(fieldsPath, 'utf-8');
  }

  const examplesPath = join(refDir, 'examples.md');
  if (existsSync(examplesPath)) {
    reference.examples = readFileSync(examplesPath, 'utf-8');
  }

  const verifyPath = join(refDir, 'verify.md');
  if (existsSync(verifyPath)) {
    reference.verify = readFileSync(verifyPath, 'utf-8');
  }

  return reference;
}

/**
 * 将 SKILL.md 内容解析为结构化 FlowData
 */
export function parseSkillMd(content: string, flowDir?: string): FlowData {
  content = content.replace(/\r\n/g, '\n');
  const warnings: string[] = [];
  const { meta, body } = parseFrontmatter(content);
  const sections = splitSections(body);
  const title = extractTitle(body);

  // 业务目标
  const businessGoal = sections.get('业务目标') ?? '';
  if (!businessGoal) warnings.push("缺少 '业务目标' 章节");

  // 适用场景
  const scenariosSection = sections.get('适用场景') ?? '';
  const scenarios = parseListItems(scenariosSection);

  // 前置条件
  const prerequisitesSection = sections.get('前置条件') ?? '';
  const prerequisites = parseListItems(prerequisitesSection);

  // 流程总览 → steps
  const stepsSection = sections.get('流程总览') ?? '';
  const steps = parseSteps(stepsSection);

  // 快速话术模板
  const speechSection = sections.get('快速话术模板') ?? '';
  const speechTemplates = parseSpeechTemplates(speechSection);

  // Agent 引导策略
  const agentSection = sections.get('Agent 引导策略') ?? sections.get('Agent 引导策略：智能预填 + 确认修改') ?? '';
  const agentStrategy = parseAgentStrategy(agentSection);

  // 提交命令
  const submitSection = sections.get('提交命令') ?? '';
  const submitCommand = parseSubmitCommand(submitSection);

  // 辅助接口
  const apisSection = sections.get('辅助接口') ?? '';
  const apis = parseApis(apisSection);

  // 错误处理
  const errorSection = sections.get('错误处理') ?? '';
  const errorHandling = parseErrorHandling(errorSection);

  // 成功标准
  const successSection = sections.get('成功标准') ?? '';
  const successCriteria = parseListItems(successSection);

  // 领域知识
  const domainSection = sections.get('领域知识') ?? '';
  const domainKnowledge = parseListItems(domainSection);

  // reference 文件
  const reference = flowDir ? loadReferenceFiles(flowDir) : { fields: '', examples: '', verify: '' };

  // 检查无法结构化解析的章节
  const knownSections = new Set([
    '业务目标', '适用场景', '前置条件', '流程总览', '字段依赖图',
    '快速话术模板', 'Agent 引导策略', '提交命令', '辅助接口',
    '错误处理', '成功标准', '领域知识', '参考文件',
  ]);
  for (const sectionName of sections.keys()) {
    // 模糊匹配已知章节（处理带后缀的标题，如 "Agent 引导策略：智能预填 + 确认修改"）
    const isKnown = [...knownSections].some(
      (known) => sectionName === known || sectionName.startsWith(known)
    );
    if (!isKnown) {
      warnings.push(`章节 '${sectionName}' 无法结构化解析，已保留原文`);
    }
  }

  // 必填字段缺失警告
  if (!meta.name) warnings.push('缺少 frontmatter name 字段');
  if (!meta.description) warnings.push('缺少 frontmatter description 字段');
  if (steps.length === 0) warnings.push("未能从 '流程总览' 解析出步骤");

  const flowData: FlowData = {
    version: 1,
    meta,
    title,
    businessGoal,
    scenarios,
    prerequisites,
    steps,
    fieldGroups: [],
    apis,
    speechTemplates,
    agentStrategy,
    endApi: { method: submitCommand.method, path: submitCommand.path, bodyTemplate: submitCommand.bodyTemplate, evidenceSource: 'name-only' },
    errorHandling,
    successCriteria,
    domainKnowledge,
    reference,
  };

  if (warnings.length > 0) {
    flowData._parseWarnings = warnings;
  }

  return flowData;
}
