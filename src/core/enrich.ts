/**
 * skill-enrich：本地 codex 分析接口 service 链路，产出结构化强化信息
 *
 * 纯函数模块：不 spawn 进程（进程管理在 tools/editor/server.mjs）。
 * 数据落点：ApiEntry.enrichment（注册表人工字段，gen merge 不覆盖），
 * 由 buildReferenceMd 渲染为「## 业务规则」小节。
 */
import { existsSync, readdirSync } from 'fs';
import { basename, join } from 'path';
import type { ApiEntry, Enrichment, ModuleRegistry } from './skill-builder.js';

// ── codex --output-schema 用的 JSON Schema ──

export const ENRICH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'businessRules', 'validations', 'callChain', 'errorScenarios', 'confidence'],
  properties: {
    summary: { type: 'string', description: '一句话概括该接口的业务职责（中文）' },
    businessRules: {
      type: 'array',
      items: { type: 'string' },
      description: '业务规则（状态流转、计算逻辑、业务约束），每条一句中文。数组元素必须是纯字符串，不要输出对象',
    },
    validations: {
      type: 'array',
      items: { type: 'string' },
      description: '参数与前置校验（必填、格式、权限、前置状态），每条一句中文。数组元素必须是纯字符串，不要输出对象',
    },
    callChain: {
      type: 'array',
      items: { type: 'string' },
      description: '调用链路，形如 "ClassName#method → ClassName#method → Mapper/RPC"。数组元素必须是纯字符串，不要输出对象',
    },
    errorScenarios: {
      type: 'array',
      items: { type: 'string' },
      description: '异常场景与表现（抛什么错、返回什么码、何时触发），每条一句中文。数组元素必须是纯字符串，不要输出对象',
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
} as const;

export interface RawEnrichOutput {
  summary: string;
  businessRules: string[];
  validations: string[];
  callChain: string[];
  errorScenarios: string[];
  confidence: 'high' | 'medium' | 'low';
}

// ── prompt 构建 ──

export function buildEnrichPrompt(entry: ApiEntry, registry: ModuleRegistry, controllerFile: string): string {
  const lines: string[] = [];
  lines.push('你是资深 Java 后端工程师。请分析一个 Spring 接口的完整业务逻辑，产出供 AI 技能使用的结构化说明。');
  lines.push('');
  lines.push('## 目标接口');
  lines.push(`- 模块：${registry.module}`);
  lines.push(`- 接口 ID：${entry.id}`);
  lines.push(`- 摘要：${entry.summary}`);
  lines.push(`- 方法与路径：${entry.method} ${entry.path}`);
  const params = entry.queryParams?.length ? entry.queryParams : entry.bodyParams;
  if (params && params.length > 0) {
    lines.push(`- 请求参数：${params.map((p) => `${p.name}(${p.type}${p.required ? '，必填' : ''}${p.desc && p.desc !== p.type ? `，${p.desc}` : ''})`).join('、')}`);
  }
  if (entry.outputFields) {
    lines.push(`- 返回字段说明：${entry.outputFields}`);
  }
  lines.push('');
  lines.push('## 入口文件');
  lines.push(`${controllerFile}（Controller 方法名：${entry.source?.method || '未知'}）`);
  lines.push('');
  lines.push('## 分析任务');
  lines.push('从入口文件出发定位对应 Controller 方法，沿 service 链路深入：');
  lines.push('1. Controller 层：参数绑定、注解、显式校验');
  lines.push('2. Service 层：业务规则、状态流转、计算逻辑、权限与前置校验');
  lines.push('3. 依赖：Mapper/DAO 的 SQL 行为、对其他服务或 RPC 的调用、缓存与事务');
  lines.push('4. 异常：抛出的异常、返回的错误码及其触发条件');
  lines.push('');
  lines.push('## 输出要求');
  lines.push('只输出一个符合给定 JSON Schema 的 JSON 对象，不要输出任何其他文字或 markdown：');
  lines.push('- summary：一句话概括业务职责');
  lines.push('- businessRules / validations / callChain / errorScenarios：见 schema 说明');
  lines.push('- confidence：对本次分析把握的置信度（high/medium/low）');
  lines.push('所有文本使用简体中文；某方面确实没有信息时给空数组，不要编造。');
  lines.push('重要：四个数组的元素必须全部是纯字符串，例如 "businessRules": ["状态从草稿提交后不可修改"]，禁止输出对象或嵌套结构。');
  return lines.join('\n');
}

// ── codex 调用参数（prompt 走 stdin）──

export function buildCodexArgs(javaSourceRoot: string, schemaTmpPath: string, outTmpPath: string): string[] {
  return [
    'exec',
    '-C', javaSourceRoot,
    '-s', 'read-only',
    '--json',
    '--output-schema', schemaTmpPath,
    '-o', outTmpPath,
  ];
}

// ── Controller 文件定位 ──

const SKIP_DIRS = new Set(['target', '.git', 'node_modules', 'build', 'out', '.idea', 'logs']);

function walkJavaFiles(dir: string, onFile: (file: string) => void, depth = 0): void {
  if (depth > 16) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkJavaFiles(full, onFile, depth + 1);
    } else if (entry.isFile() && entry.name.endsWith('.java')) {
      onFile(full);
    }
  }
}

function preferBest(matches: string[]): string {
  const score = (p: string): number => {
    const normalized = p.replace(/\\/g, '/');
    if (normalized.includes('src/main/java')) return 2;
    if (normalized.includes('/controller/') || normalized.includes('/web/')) return 1;
    return 0;
  };
  return [...matches].sort((a, b) => score(b) - score(a))[0];
}

/**
 * 在 javaSourceRoot 下定位接口对应的 Controller 文件。
 * 优先按注册表 source.path（文件名）精确匹配，兜底 source.controller + ".java"。
 * 返回绝对路径；未找到返回 null。
 */
export function findControllerFile(javaSourceRoot: string, entry: ApiEntry): string | null {
  if (!javaSourceRoot || !existsSync(javaSourceRoot)) return null;
  const candidates: string[] = [];
  if (entry.source?.path) candidates.push(entry.source.path);
  if (entry.source?.controller) {
    const fallback = `${entry.source.controller}.java`;
    if (!candidates.includes(fallback)) candidates.push(fallback);
  }
  if (candidates.length === 0) return null;
  for (const candidate of candidates) {
    const matches: string[] = [];
    walkJavaFiles(javaSourceRoot, (file) => {
      if (basename(file) === candidate) matches.push(file);
    });
    if (matches.length > 0) return preferBest(matches);
  }
  return null;
}

// ── 输出解析 ──

export type ParseEnrichResult = { ok: true; data: RawEnrichOutput } | { ok: false; error: string };

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n?\s*```\s*$/);
  return fence ? fence[1].trim() : trimmed;
}

/** 把模型可能输出的对象/数组/数字元素压平成可读字符串（schema 要求字符串，宽容兜底）。 */
function coerceStringItem(item: unknown): string | null {
  if (typeof item === 'string') return item.trim() || null;
  if (typeof item === 'number' || typeof item === 'boolean') return String(item);
  if (item && typeof item === 'object') {
    if (Array.isArray(item)) {
      const parts = item.map(coerceStringItem).filter((p): p is string => p !== null);
      return parts.length > 0 ? parts.join('；') : null;
    }
    const values = Object.values(item as Record<string, unknown>)
      .map((v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' || typeof v === 'boolean' ? String(v) : ''))
      .filter(Boolean);
    if (values.length > 0) return values.join('，');
    return JSON.stringify(item);
  }
  return null;
}

export function parseEnrichOutput(lastMessage: string): ParseEnrichResult {
  if (!lastMessage || !lastMessage.trim()) return { ok: false, error: '输出为空' };
  const text = stripCodeFence(lastMessage);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // 兜底：从文本中截取第一个 { 到最后一个 }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return { ok: false, error: '输出不是合法 JSON' };
    try {
      raw = JSON.parse(text.slice(start, end + 1));
    } catch {
      return { ok: false, error: '输出不是合法 JSON' };
    }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: '输出不是 JSON 对象' };
  }
  const obj = raw as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof obj.summary !== 'string' || !obj.summary.trim()) errors.push('summary 缺失或不是字符串');
  const arrayFields = ['businessRules', 'validations', 'callChain', 'errorScenarios'] as const;
  const cleaned: Record<(typeof arrayFields)[number], string[]> = {
    businessRules: [], validations: [], callChain: [], errorScenarios: [],
  };
  for (const field of arrayFields) {
    const value = obj[field];
    if (!Array.isArray(value)) {
      errors.push(`${field} 缺失或不是数组`);
      continue;
    }
    cleaned[field] = value
      .map((item) => coerceStringItem(item))
      .filter((item): item is string => item !== null);
  }
  const confidence = obj.confidence;
  if (confidence !== 'high' && confidence !== 'medium' && confidence !== 'low') {
    errors.push('confidence 必须是 high/medium/low');
  }
  if (errors.length > 0) return { ok: false, error: errors.join('；') };
  return {
    ok: true,
    data: {
      summary: (obj.summary as string).trim(),
      businessRules: cleaned.businessRules,
      validations: cleaned.validations,
      callChain: cleaned.callChain,
      errorScenarios: cleaned.errorScenarios,
      confidence: confidence as 'high' | 'medium' | 'low',
    },
  };
}

// ── 写回注册表 ──

export function toEnrichment(
  raw: RawEnrichOutput,
  meta: { enrichedBy: string; controllerFile?: string; at?: Date },
): Enrichment {
  return {
    enrichedAt: (meta.at || new Date()).toISOString(),
    enrichedBy: meta.enrichedBy,
    ...(meta.controllerFile ? { controllerFile: meta.controllerFile } : {}),
    confidence: raw.confidence,
    summary: raw.summary,
    businessRules: raw.businessRules,
    validations: raw.validations,
    callChain: raw.callChain,
    errorScenarios: raw.errorScenarios,
  };
}

/** 整体覆盖写回对应接口的 enrichment（幂等）；接口不存在返回 false。 */
export function mergeEnrichment(registry: ModuleRegistry, apiId: string, enrichment: Enrichment): boolean {
  const api = registry.apis.find((a) => a.id === apiId);
  if (!api) return false;
  api.enrichment = enrichment;
  return true;
}