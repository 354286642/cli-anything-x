import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { resolveWorkspace } from './config.js';


const WORKSPACE = resolveWorkspace();

// ── 数据类型 ──

export interface ApiParam {
  name: string;
  type: string;
  required?: boolean;
  desc?: string;
  default?: string; // B-2: @RequestParam defaultValue
}

export interface ApiExample {
  title: string;
  command: string;
}

export interface Enrichment {
  enrichedAt: string;
  enrichedBy: string;
  controllerFile?: string;
  confidence: 'high' | 'medium' | 'low';
  summary: string;
  businessRules: string[];
  validations: string[];
  callChain: string[];
  errorScenarios: string[];
}

export interface ApiEntry {
  id: string;
  summary: string;
  method: string;
  path: string;
  level: 'read' | 'write' | 'dangerous';
  deprecated?: boolean;
  version?: string;
  source?: { controller?: string; method?: string; line?: number; path?: string };
  queryParams?: ApiParam[];
  bodyParams?: ApiParam[];
  bodyTemplate?: Record<string, unknown> | string;
  queryTemplate?: Record<string, unknown> | string;
  enumRefs?: string[];
  notes?: string;
  examples?: ApiExample[];
  outputFields?: string;
  avoidWhen?: string[];
  prerequisites?: string[];
  tips?: string[];
  paramSources?: Record<string, string>;
  enrichment?: Enrichment;
}

export interface EnumValue {
  value: string;
  label: string;
}

export interface EnumDef {
  name: string;
  description?: string;
  values: EnumValue[];
}

export interface CustomSection {
  title: string;
  content: string;
}

export interface RoutingConfig {
  priority?: string;
  keywords?: string[];
  rule?: string;
  exclude?: string[];
}

export interface ChainDef {
  name: string;
  steps: string[];
}

export interface ErrorEntry {
  code?: string;
  symptom?: string;
  judgment?: string;
  action?: string;
}

export interface ModuleRegistry {
  module: string;
  version: string;
  description?: string;
  triggers?: string[];
  enums?: EnumDef[];
  enumRefs?: string[];
  apis: ApiEntry[];
  customSections?: CustomSection[];
  routing?: RoutingConfig;
  principles?: string[];
  chains?: ChainDef[];
  errorHandling?: ErrorEntry[];
  // F-4：溯源（anycli gen / gen --sync 写入）
  sourceFiles?: { path: string; hash: string }[];
  lastSyncedAt?: string;
}

// ── 加载注册表 ──

export function loadModuleRegistry(project: string, moduleName: string): ModuleRegistry | null {
  const filePath = join(WORKSPACE, 'apis', project, `${moduleName}.json`);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf-8')) as ModuleRegistry;
}

export function loadSharedEnum(project: string, enumName: string): EnumDef | null {
  const filePath = join(WORKSPACE, 'apis', project, '_shared', `${enumName}.json`);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf-8')) as EnumDef;
}

export function listRegistryModules(project: string): string[] {
  const dir = join(WORKSPACE, 'apis', project);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'schema.json' && f !== 'gen.json')
    .map((f) => f.replace('.json', ''));
}

export function listRegistryProjects(): string[] {
  const dir = join(WORKSPACE, 'apis');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== '_shared')
    .map((d) => d.name);
}

/**
 * 构建全局接口索引：apiId → { project, module, api }
 * 用于 flow 接地校验。
 */
export function buildApiIndex(
  sources?: Array<{ project: string; module: string; registry: ModuleRegistry }>,
): Map<string, { project: string; module: string; api: ApiEntry }> {
  const index = new Map<string, { project: string; module: string; api: ApiEntry }>();
  if (sources) {
    for (const { project, module, registry } of sources) {
      if (!registry) continue;
      for (const api of registry.apis) {
        index.set(api.id, { project, module, api });
        index.set(`${registry.module}.${api.id}`, { project, module, api });
      }
    }
    return index;
  }
  for (const project of listRegistryProjects()) {
    for (const moduleName of listRegistryModules(project)) {
      const registry = loadModuleRegistry(project, moduleName);
      if (!registry) continue;
      for (const api of registry.apis) {
        index.set(api.id, { project, module: moduleName, api });
        index.set(`${registry.module}.${api.id}`, { project, module: moduleName, api });
      }
    }
  }
  return index;
}

// ── 生成器：ModuleRegistry → SKILL.md（行为剧本格式） ──

export function buildSkillMd(registry: ModuleRegistry, project: string): string {
  const lines: string[] = [];
  const hasRichContent = !!(registry.routing || registry.principles || registry.chains);

  lines.push('---');
  lines.push(`name: ${registry.module}`);
  lines.push(`version: ${registry.version}`);
  if (registry.description) {
    lines.push('description: >');
    lines.push(`  ${registry.description}`);
    lines.push('  本模块为「接口清单 + 通用 request 调用」模式，不含专属 TS 命令，接口路径与参数仅在此维护一份。');
  }
  if (registry.triggers && registry.triggers.length > 0) {
    lines.push('triggers:');
    for (const trigger of registry.triggers) {
      lines.push(`  - ${trigger}`);
    }
  }
  lines.push('---');
  lines.push('');
  lines.push('<!-- AUTO-GENERATED from apis/ registry — 人工补充请写入 customSections -->');
  lines.push('');

  const moduleName = registry.module.replace(`${project}-`, '');
  const displayName = registry.description?.split('。')[0] || moduleName;
  lines.push(`# ${project.charAt(0).toUpperCase() + project.slice(1)} - ${displayName.replace(/^[A-Za-z]+\s*/, '')}`);
  lines.push('');
  lines.push(`> 本模块所有接口统一通过通用命令 \`anycli request ${project} <METHOD> <path>\` 调用。`);
  lines.push('> 调用前先按需读取 references/ 下对应文件查参数结构，不要猜字段。');
  lines.push('');

  // ── 路由优先级 ──
  if (registry.routing) {
    const routing = registry.routing;
    lines.push('## 路由优先级（何时用本模块）');
    lines.push('');
    if (routing.keywords && routing.keywords.length > 0) {
      lines.push(routing.priority || '出现以下语义时优先走本模块：');
      for (const kw of routing.keywords) {
        lines.push(`- ${kw}`);
      }
      lines.push('');
    } else if (routing.priority) {
      lines.push(routing.priority);
      lines.push('');
    }
    if (routing.rule) {
      lines.push(`**判定规则：** ${routing.rule}`);
      lines.push('');
    }
  }

  // ── 命令选择表 ──
  lines.push('## 选哪个接口');
  lines.push('');
  lines.push('| 想做什么 | 接口 | 方式 | 按需读取 reference |');
  lines.push('|---------|------|------|-------------------|');
  for (const api of registry.apis) {
    if (api.deprecated) continue;
    const refLink = `[reference](references/${api.id}.md)`;
    lines.push(`| ${api.summary} | \`${api.id}\` | ${api.method} | ${refLink} |`);
  }
  lines.push('');

  // ── 处理链 ──
  if (registry.chains && registry.chains.length > 0) {
    lines.push('## 处理链');
    lines.push('');
    for (const chain of registry.chains) {
      lines.push(`- **${chain.name}**：${chain.steps.map(s => `\`${s}\``).join(' → ')}`);
    }
    lines.push('');
  }

  // ── 执行原则 ──
  if (registry.principles && registry.principles.length > 0) {
    lines.push('## 执行原则');
    lines.push('');
    registry.principles.forEach((principle, idx) => {
      lines.push(`${idx + 1}. ${principle}`);
    });
    lines.push('');
  }

  // ── 错误处理 ──
  if (registry.errorHandling && registry.errorHandling.length > 0) {
    lines.push('## 错误处理');
    lines.push('');
    lines.push('| 错误码 / 现象 | 判断 | 动作 |');
    lines.push('|--------------|------|------|');
    for (const err of registry.errorHandling) {
      lines.push(`| ${err.code || err.symptom || ''} | ${err.judgment || ''} | ${err.action || ''} |`);
    }
    lines.push('');
  }

  // ── 范围边界 ──
  if (registry.routing?.exclude && registry.routing.exclude.length > 0) {
    lines.push('## 不在本模块范围');
    lines.push('');
    for (const item of registry.routing.exclude) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  // ── 枚举 ──
  const allEnums = resolveEnums(registry, project);
  if (allEnums.length > 0) {
    for (const enumDef of allEnums) {
      lines.push(`## ${enumDef.description || enumDef.name}`);
      lines.push('');
      lines.push('| 值 | 含义 |');
      lines.push('|----|------|');
      for (const val of enumDef.values) {
        lines.push(`| ${val.value} | ${val.label} |`);
      }
      lines.push('');
    }
  }

  // ── 接口参数速查 ──
  lines.push('## 接口参数速查');
  lines.push('');
  let idx = 0;
  for (const api of registry.apis) {
    if (api.deprecated) continue;
    idx++;
    lines.push(`### ${idx}. ${api.summary}`);
    lines.push('');
    lines.push('```bash');
    const paramType = api.queryParams?.length ? 'query' : 'body';
    if (paramType === 'query') {
      lines.push(`anycli request ${project} ${api.method} ${api.path} --query '<模板>'`);
    } else {
      lines.push(`anycli request ${project} ${api.method} ${api.path} --body '<模板>'`);
    }
    lines.push('```');
    lines.push('');

    const template = paramType === 'query' ? api.queryTemplate : api.bodyTemplate;
    if (template) {
      lines.push('```json');
      lines.push(typeof template === 'string' ? template : JSON.stringify(template, null, 2));
      lines.push('```');
      lines.push('');
    }

    const params = paramType === 'query' ? api.queryParams : api.bodyParams;
    if (params && params.length > 0) {
      lines.push('| 字段 | 类型 | 必填 | 说明 |');
      lines.push('|------|------|------|------|');
      for (const param of params) {
        lines.push(`| ${param.name} | ${param.type} | ${param.required ? '是' : '否'} | ${param.desc || ''}${param.default !== undefined ? `（默认 ${param.default}）` : ''} |`);
      }
      lines.push('');
    }

    if (api.notes) {
      lines.push(`> ⚠️ ${api.notes}`);
      lines.push('');
    }
  }

  // ── 人工补充区 ──
  if (registry.customSections && registry.customSections.length > 0) {
    for (const section of registry.customSections) {
      lines.push(`## ${section.title}`);
      lines.push('');
      lines.push(section.content);
      lines.push('');
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// ── 生成器：ApiEntry → references/{api-id}.md ──

export function buildReferenceMd(api: ApiEntry, registry: ModuleRegistry, project: string): string {
  const lines: string[] = [];

  lines.push(`# ${api.id}`);
  lines.push('');
  lines.push(api.summary);
  lines.push('');

  // 何时用
  lines.push('## 何时用');
  lines.push('');
  lines.push(`- ${api.summary}（\`${api.method} ${api.path}\`）`);
  if (api.outputFields) {
    lines.push(`- 输出：${api.outputFields.split('：')[0] || api.outputFields}`);
  }
  lines.push('');

  // Avoid when
  if (api.avoidWhen && api.avoidWhen.length > 0) {
    lines.push('## Avoid when');
    lines.push('');
    for (const item of api.avoidWhen) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  // Prerequisites
  if (api.prerequisites && api.prerequisites.length > 0) {
    lines.push('## Prerequisites');
    lines.push('');
    for (const item of api.prerequisites) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  // 参数
  const params = api.queryParams?.length ? api.queryParams : api.bodyParams;
  const paramType = api.queryParams?.length ? 'query' : 'body';
  if (params && params.length > 0) {
    lines.push('## 参数');
    lines.push('');
    lines.push('| 字段 | 类型 | 必填 | 说明 | 来源 |');
    lines.push('|------|------|------|------|------|');
    for (const param of params) {
      const source = api.paramSources?.[param.name] || '';
        lines.push(`| ${param.name} | ${param.type} | ${param.required ? '是' : '否'} | ${param.desc || ''}${param.default !== undefined ? `（默认 ${param.default}）` : ''} | ${source} |`);
    }
    lines.push('');
  }

  // bodyTemplate
  const template = paramType === 'query' ? api.queryTemplate : api.bodyTemplate;
  if (template) {
    lines.push(`## ${paramType} 模板`);
    lines.push('');
    lines.push('```json');
    lines.push(typeof template === 'string' ? template : JSON.stringify(template, null, 2));
    lines.push('```');
    lines.push('');
  }

  // Tips
  if (api.tips && api.tips.length > 0) {
    lines.push('## Tips');
    lines.push('');
    for (const tip of api.tips) {
      lines.push(`- ${tip}`);
    }
    lines.push('');
  }

  // Notes
  if (api.notes) {
    lines.push('## 注意事项');
    lines.push('');
    lines.push(`> ⚠️ ${api.notes}`);
    lines.push('');
  }

  // 输出字段
  if (api.outputFields) {
    lines.push('## 输出关键字段');
    lines.push('');
    lines.push(api.outputFields);
    lines.push('');
  }

  // Examples
  if (api.examples && api.examples.length > 0) {
    lines.push('## Examples');
    lines.push('');
    for (const example of api.examples) {
      lines.push(`**${example.title}**`);
      lines.push('```bash');
      lines.push(example.command);
      lines.push('```');
      lines.push('');
    }
  }

  // 技能强化（skill-enrich）：codex 分析 service 链路的结构化结果
  if (api.enrichment) {
    const en = api.enrichment;
    lines.push('## 业务规则');
    lines.push('');
    lines.push(`> 由 ${en.enrichedBy || 'agent'} 分析 service 链路生成（${(en.enrichedAt || '').slice(0, 10)}，置信度 ${en.confidence || '未知'}）`);
    lines.push('');
    if (en.summary) {
      lines.push(en.summary);
      lines.push('');
    }
    const sections: [string, string[] | undefined][] = [
      ['业务规则', en.businessRules],
      ['参数校验', en.validations],
      ['调用链路', en.callChain],
      ['异常场景', en.errorScenarios],
    ];
    for (const [title, items] of sections) {
      if (items && items.length > 0) {
        lines.push(`### ${title}`);
        lines.push('');
        for (const item of items) lines.push(`- ${item}`);
        lines.push('');
      }
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function resolveEnums(registry: ModuleRegistry, project: string): EnumDef[] {
  const enums: EnumDef[] = [];
  if (registry.enums) {
    enums.push(...registry.enums);
  }
  if (registry.enumRefs) {
    for (const ref of registry.enumRefs) {
      const shared = loadSharedEnum(project, ref);
      if (shared) enums.push(shared);
    }
  }
  return enums;
}

// ── 批量构建 ──

export interface BuildResult {
  module: string;
  outputPath: string;
  success: boolean;
  error?: string;
}

export function buildAllSkills(): BuildResult[] {
  const results: BuildResult[] = [];
  for (const project of listRegistryProjects()) {
    for (const moduleName of listRegistryModules(project)) {
      const registry = loadModuleRegistry(project, moduleName);
      if (!registry) {
        results.push({ module: moduleName, outputPath: '', success: false, error: 'Failed to load registry' });
        continue;
      }
      try {
        const result = buildModuleFiles(project, moduleName, registry);
        results.push(result);
      } catch (error) {
        results.push({
          module: moduleName,
          outputPath: '',
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return results;
}

/**
 * 构建单个模块的所有产物：SKILL.md + references/*.md
 */
export function buildModuleFiles(project: string, moduleName: string, registry: ModuleRegistry): BuildResult {
  const skillMd = buildSkillMd(registry, project);
  const outputDir = join(WORKSPACE, 'skills', project, moduleName);
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, 'SKILL.md');
  writeFileSync(outputPath, skillMd, 'utf-8');

  // Generate references/ for each api
  const hasRichApis = registry.apis.some(api => api.avoidWhen || api.tips || api.prerequisites || api.paramSources || api.enrichment);
  if (hasRichApis || registry.routing) {
    const refDir = join(outputDir, 'references');
    mkdirSync(refDir, { recursive: true });
    for (const api of registry.apis) {
      if (api.deprecated) continue;
      const refMd = buildReferenceMd(api, registry, project);
      writeFileSync(join(refDir, `${api.id}.md`), refMd, 'utf-8');
    }
  }

  return { module: registry.module, outputPath, success: true };
}

/**
 * 合并策略：新接口全量写入，已存在接口只更新机器字段，不覆盖人工字段。
 * 人工字段：notes, examples, outputFields, customSections, level
 */
export function mergeRegistry(existing: ModuleRegistry, incoming: Partial<ModuleRegistry>): ModuleRegistry {
  const merged: ModuleRegistry = { ...existing, ...incoming, apis: [] };

  const existingMap = new Map(existing.apis.map((api) => [api.id, api]));
  const incomingApis = incoming.apis || [];

  const HUMAN_FIELDS: (keyof ApiEntry)[] = ['notes', 'examples', 'outputFields', 'level', 'enrichment'];

  for (const incomingApi of incomingApis) {
    const existingApi = existingMap.get(incomingApi.id);
    if (!existingApi) {
      merged.apis.push(incomingApi);
    } else {
      const mergedApi = { ...existingApi, ...incomingApi };
      for (const field of HUMAN_FIELDS) {
        if (existingApi[field] !== undefined) {
          (mergedApi as Record<string, unknown>)[field] = existingApi[field];
        }
      }
      merged.apis.push(mergedApi);
    }
    existingMap.delete(incomingApi.id);
  }

  for (const remaining of existingMap.values()) {
    merged.apis.push(remaining);
  }

  if (incoming.customSections === undefined) {
    merged.customSections = existing.customSections;
  }

  return merged;
}
