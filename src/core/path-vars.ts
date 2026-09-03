/**
 * standalone-export / CLI request 共用的路径占位符解析。
 *
 * 注册表路径可能含 Spring 风格占位符（如 /${api.prefix}/sample/x）。
 * 内置默认值，可用 apis/{project}/gen.json 的 pathVariables 覆盖：
 *   { "pathVariables": { "api.prefix": "/api" } }
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/** 内置默认（用户确认：api.prefix 默认对应 /api，一般不改） */
export const DEFAULT_PATH_VARIABLES: Record<string, string> = {
  'api.prefix': '/api',
};

/** 读取项目级变量表：内置默认 + gen.json pathVariables 覆盖 */
export function loadPathVariables(packageRoot: string, project: string): Record<string, string> {
  const vars = { ...DEFAULT_PATH_VARIABLES };
  const genJsonPath = join(packageRoot, 'apis', project, 'gen.json');
  if (!existsSync(genJsonPath)) return vars;
  try {
    const gen = JSON.parse(readFileSync(genJsonPath, 'utf-8')) as { pathVariables?: unknown };
    if (gen && typeof gen.pathVariables === 'object' && gen.pathVariables !== null) {
      for (const [key, value] of Object.entries(gen.pathVariables as Record<string, unknown>)) {
        if (typeof value === 'string') vars[key] = value;
      }
    }
  } catch {
    // gen.json 损坏时退回内置默认，不阻塞主流程
  }
  return vars;
}

export interface ResolveResult {
  resolved: string;
  unresolved: string[];
}

/**
 * 替换路径中的 ${name} 占位符；返回解析结果与未解析变量名列表。
 * 替换后折叠重复斜杠（路径以 / 开头且变量值以 / 开头时会产生 //）。
 */
export function resolvePathVariables(path: string, vars: Record<string, string>): ResolveResult {
  const unresolved: string[] = [];
  const replaced = path.replace(/\$\{([^}]+)\}/g, (raw, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name];
    if (!unresolved.includes(name)) unresolved.push(name);
    return raw;
  });
  return { resolved: replaced.replace(/\/{2,}/g, '/'), unresolved };
}