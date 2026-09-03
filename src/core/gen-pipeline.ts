import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { scanControllers } from './java-parser.js';
import type { ApiEndpoint, WrapperDef } from './java-parser.js';
import { buildRegistryFromEndpoints } from './api-infer.js';
import type { ApiEntry, ModuleRegistry } from './skill-builder.js';

/**
 * gen 管线纯函数（Phase 0 抽取，R 类零行为变化）。
 * 交互与文件写入仍留在 src/commands/gen.ts，这里只保留可单测的计算步骤。
 */

export interface CollectedEndpoints {
  controllerCount: number;
  controllerFiles: string[];
  endpoints: ApiEndpoint[];
}

/** 扫描 Controller 目录/文件并汇总全部端点（wrappers：F-3 项目级包装类配置） */
export function collectEndpoints(
  controllerPath: string,
  wrappers?: Record<string, WrapperDef>,
): CollectedEndpoints {
  const controllerResults = scanControllers(controllerPath, wrappers);
  const scanRoot = statSync(controllerPath).isFile() ? dirname(controllerPath) : controllerPath;
  const endpoints: ApiEndpoint[] = [];
  const controllerFiles: string[] = [];
  for (const result of controllerResults) {
    controllerFiles.push(result.filePath);
    const relFile = relative(scanRoot, result.filePath).replace(/\\/g, '/');
    for (const endpoint of result.endpoints) {
      endpoints.push({ ...endpoint, sourceFile: relFile });
    }
  }
  return { controllerCount: controllerResults.length, controllerFiles, endpoints };
}

export interface RegistryUpdatePlan {
  registry: ModuleRegistry;
  /** true = 新建注册表（无既有注册表，含旧模块迁移）；false = 更新既有注册表 */
  created: boolean;
}

/**
 * 计算本次 gen 的注册表更新结果（纯函数，不读写文件）。
 * - 有既有注册表：merge 重建（人工字段由 buildRegistryFromEndpoints 保护）；
 * - 无注册表：以旧 SKILL.md 表格解析出的 legacyApis 为种子建表（可为空）。
 */
export function planRegistryUpdate(
  project: string,
  moduleName: string,
  endpoints: ApiEndpoint[],
  existing: ModuleRegistry | null,
  legacyApis: ApiEntry[],
): RegistryUpdatePlan {
  if (existing) {
    return {
      registry: buildRegistryFromEndpoints(project, moduleName, endpoints, existing),
      created: false,
    };
  }
  const baseRegistry: ModuleRegistry | undefined = legacyApis.length > 0
    ? { module: `${project}-${moduleName}`, version: '1.0.0', apis: legacyApis }
    : undefined;
  return {
    registry: buildRegistryFromEndpoints(project, moduleName, endpoints, baseRegistry),
    created: true,
  };
}

// ---------- F-4：溯源与增量同步 ----------

export interface SourceFileInfo { path: string; hash: string }

/** 计算源文件 sha256（F-4 拍板：文件级 hash，跨仓场景更稳）；path 相对 baseDir */
export function hashSourceFiles(filePaths: string[], baseDir: string): SourceFileInfo[] {
  return filePaths.map((filePath) => ({
    path: relative(baseDir, filePath).replace(/\\/g, '/'),
    hash: createHash('sha256').update(readFileSync(filePath)).digest('hex'),
  }));
}

export interface SyncDiff {
  /** 代码中有、注册表没有的端点 */
  added: ApiEndpoint[];
  /** 注册表有（未标 deprecated）、代码中不存在的接口 */
  missing: ApiEntry[];
  /** method+path 匹配但签名（描述/body 字段/query 参数）变化 */
  signatureChanged: { apiId: string; changes: string[] }[];
  /** 溯源文件 hash 对比 */
  fileChanges: { changed: string[]; added: string[]; removed: string[] };
}

/**
 * F-4：代码 ↔ 注册表漂移检测（纯函数，不读写文件）。
 * 匹配键为 method+path；仅报告，不自动标 deprecated。
 */
export function planSyncDiff(
  registry: ModuleRegistry,
  endpoints: ApiEndpoint[],
  currentFiles: SourceFileInfo[],
): SyncDiff {
  const codeKeys = new Set(endpoints.map((ep) => `${ep.httpMethod} ${ep.path}`));
  const regActive = registry.apis.filter((a) => !a.deprecated);

  const added: ApiEndpoint[] = [];
  const signatureChanged: { apiId: string; changes: string[] }[] = [];

  for (const ep of endpoints) {
    const api = regActive.find((a) => `${a.method} ${a.path}` === `${ep.httpMethod} ${ep.path}`);
    if (!api) {
      added.push(ep);
      continue;
    }
    const changes: string[] = [];
    if (ep.description && api.summary !== ep.description) {
      changes.push(`描述：${api.summary} → ${ep.description}`);
    }
    const regBodyNames = (api.bodyParams || []).map((p) => p.name).sort().join(',');
    const newBodyNames = (ep.bodyFields || []).map((p) => p.name).sort().join(',');
    if (newBodyNames && regBodyNames !== newBodyNames) {
      changes.push(`body 字段：[${regBodyNames}] → [${newBodyNames}]`);
    }
    const regQueryNames = (api.queryParams || []).map((p) => p.name).sort().join(',');
    const newQueryNames = ep.queryParams.map((p) => p.name).sort().join(',');
    if (regQueryNames !== newQueryNames) {
      changes.push(`query 参数：[${regQueryNames}] → [${newQueryNames}]`);
    }
    if (changes.length > 0) signatureChanged.push({ apiId: api.id, changes });
  }

  const missing = regActive.filter((a) => !codeKeys.has(`${a.method} ${a.path}`));

  const prevFiles = new Map((registry.sourceFiles || []).map((f) => [f.path, f.hash]));
  const currFiles = new Map(currentFiles.map((f) => [f.path, f.hash]));
  const changed = [...currFiles.entries()]
    .filter(([path, hash]) => prevFiles.has(path) && prevFiles.get(path) !== hash)
    .map(([path]) => path);
  const addedFiles = [...currFiles.keys()].filter((path) => !prevFiles.has(path));
  const removedFiles = [...prevFiles.keys()].filter((path) => !currFiles.has(path));

  return { added, missing, signatureChanged, fileChanges: { changed, added: addedFiles, removed: removedFiles } };
}
