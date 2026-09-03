import type { ApiEndpoint } from './java-parser.js';
import type { ApiEntry, ModuleRegistry, ChainDef } from './skill-builder.js';

/**
 * 从接口路径生成稳定逻辑 id
 * /api/order/search → order-search
 */
export function inferApiId(path: string): string {
  return path
    .replace(/^\//, '')
    .split('/')
    .filter(seg => seg !== 'api' && !seg.startsWith('{') && !seg.startsWith('$'))
    .join('-')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * 从 Java 解析结果转换为注册表 ApiEntry（机器字段）
 */
export function endpointToApiEntry(ep: ApiEndpoint): ApiEntry {
  // GET/DELETE 无请求体，参数走 query/path；DELETE 属破坏性操作，level 归 write（B-1）
  const hasBody = ep.httpMethod !== 'GET' && ep.httpMethod !== 'DELETE';
  const id = inferApiId(ep.path);

  const entry: ApiEntry = {
    id,
    summary: ep.description || id,
    method: ep.httpMethod as ApiEntry['method'],
    path: ep.path,
    level: ep.httpMethod === 'GET' ? 'read' : 'write',
    deprecated: false,
    version: '1.0.0',
    source: {
      controller: ep.controllerName,
      method: ep.methodName,
      ...(ep.sourceFile ? { path: ep.sourceFile } : {}),
    },
  };

  // B-3: query/path 参数统一登记到 queryParams（含 POST + @RequestParam 场景，
  // 此前被混入 bodyParams）；required/defaultValue 来自 @RequestParam 属性解析
  if (ep.queryParams.length > 0) {
    entry.queryParams = ep.queryParams.map(p => ({
      name: p.name,
      type: p.type,
      required: p.required ?? true,
      desc: p.description,
      ...(p.defaultValue !== undefined ? { default: p.defaultValue } : {}),
    }));
  }

  if (hasBody) {
    // B-3: bodyParams 展开为 DTO 字段级（含 @NotBlank/@NotNull/@NotEmpty 校验注解的 required）；
    // DTO 无法解析时（如 List<String>）回退现状「DTO 类名一条」
    if (ep.bodyFields && ep.bodyFields.length > 0) {
      entry.bodyParams = ep.bodyFields.map(p => ({
        name: p.name,
        type: p.type,
        required: p.required ?? false,
        desc: p.description,
      }));
    } else if (ep.params.some(p => p.source === 'body')) {
      entry.bodyParams = ep.params.filter(p => p.source === 'body').map(p => ({
        name: p.name,
        type: p.type,
        required: p.source === 'body',
        desc: p.description,
      }));
    }
    if (ep.bodyJsonExample) {
      try {
        const cleaned = ep.bodyJsonExample.replace(/\/\/.*$/gm, '').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
        entry.bodyTemplate = JSON.parse(cleaned);
      } catch {
        entry.bodyTemplate = ep.bodyJsonExample;
      }
    }
  }

  // F-1: 返回类型解析出的 outputFields（人工字段在 merge 时优先保留）
  if (ep.outputFields) {
    entry.outputFields = ep.outputFields;
  }

  // Auto-infer prerequisites from required params
  const requiredParams = (entry.bodyParams || entry.queryParams || []).filter(p => p.required);
  if (requiredParams.length > 0) {
    entry.prerequisites = ['已登录（anycli auth status）'];
  }

  // Auto-infer paramSources
  const paramSources: Record<string, string> = {};
  for (const param of (entry.bodyParams || entry.queryParams || [])) {
    if (param.name.includes('Id') || param.name.includes('Code')) {
      paramSources[param.name] = '来自上游接口返回（待补充具体来源）';
    } else if (param.name.includes('keyword') || param.name.includes('name')) {
      paramSources[param.name] = '用户提供';
    } else if (param.name.includes('page')) {
      paramSources[param.name] = '分页参数，从 1 开始';
    }
  }
  if (Object.keys(paramSources).length > 0) {
    entry.paramSources = paramSources;
  }

  return entry;
}

/**
 * 自动推断处理链：如果接口 B 的必填参数名出现在接口 A 的输出字段中，则 A → B
 */
export function inferChains(apis: ApiEntry[]): ChainDef[] {
  const chains: ChainDef[] = [];

  for (const target of apis) {
    const requiredInputs = (target.bodyParams || target.queryParams || [])
      .filter(p => p.required && (p.name.includes('Id') || p.name.includes('Code')))
      .map(p => p.name.toLowerCase());

    if (requiredInputs.length === 0) continue;

    for (const source of apis) {
      if (source.id === target.id) continue;
      const outputStr = (source.outputFields || '').toLowerCase();
      const matched = requiredInputs.some(input => outputStr.includes(input));
      if (matched) {
        chains.push({
          name: `${source.summary} → ${target.summary}`,
          steps: [source.id, target.id],
        });
      }
    }
  }

  return chains;
}

/**
 * 自动推断路由关键词：从模块名 + 接口描述中提取
 */
export function inferRoutingKeywords(moduleName: string, apis: ApiEntry[]): string[] {
  const keywords = new Set<string>();

  // 模块名本身
  const moduleWord = moduleName.replace(/^[a-z]+-/, '');
  keywords.add(moduleWord);

  // 从接口描述中提取关键词
  for (const api of apis) {
    const words = api.summary
      .replace(/[（(].*?[)）]/g, '')
      .split(/[/、，,\s]+/)
      .filter(w => w.length >= 2 && w.length <= 6);
    for (const word of words) {
      keywords.add(word);
    }
  }

  return [...keywords].slice(0, 10);
}

/**
 * 从 Java 解析结果构建完整注册表（含自动推断）
 */
export function buildRegistryFromEndpoints(
  project: string,
  moduleName: string,
  endpoints: ApiEndpoint[],
  existing?: ModuleRegistry,
): ModuleRegistry {
  const moduleId = `${project}-${moduleName}`;
  const newApis = endpoints.map(ep => endpointToApiEntry(ep));

  const registry: ModuleRegistry = {
    module: moduleId,
    version: existing?.version || '1.0.0',
    description: existing?.description || `${project} ${moduleName} 模块`,
    triggers: existing?.triggers || inferRoutingKeywords(moduleName, newApis),
    apis: [],
    routing: existing?.routing || {
      keywords: inferRoutingKeywords(moduleName, newApis),
      rule: `只要最终动作涉及${moduleName}相关操作，就归本模块。`,
      exclude: [],
    },
    principles: existing?.principles || [],
    chains: [],
    errorHandling: existing?.errorHandling || [
      { code: 'AUTH_EXPIRED', judgment: 'Session 过期', action: '`anycli auth login` 重新登录' },
      { code: 'FORBIDDEN', judgment: '无权限', action: '检查用户角色，不要重试' },
    ],
  };

  // Merge apis: new ones added, existing ones preserve human fields
  if (existing) {
    const existingMap = new Map(existing.apis.map(a => [a.id, a]));
    // 人工维护的注册表 id 未必与 inferApiId 推导结果一致，按 method+path 兜底匹配
    const pathIndex = new Map(existing.apis.map(a => [`${a.method} ${a.path}`, a]));
    const HUMAN_FIELDS: (keyof ApiEntry)[] = ['notes', 'examples', 'outputFields', 'level', 'avoidWhen', 'tips', 'enrichment'];

    for (const newApi of newApis) {
      let existingApi = existingMap.get(newApi.id);
      if (!existingApi) {
        const byPath = pathIndex.get(`${newApi.method} ${newApi.path}`);
        if (byPath) {
          // 复用已有 id，避免同一接口产生重复条目
          newApi.id = byPath.id;
          existingApi = byPath;
          existingMap.delete(byPath.id);
        }
      }
      if (!existingApi) {
        registry.apis.push(newApi);
      } else {
        const merged = { ...existingApi, ...newApi };
        for (const field of HUMAN_FIELDS) {
          if (existingApi[field] !== undefined) {
            (merged as Record<string, unknown>)[field] = existingApi[field];
          }
        }
        registry.apis.push(merged);
      }
      existingMap.delete(newApi.id);
    }
    for (const remaining of existingMap.values()) {
      registry.apis.push(remaining);
    }
    registry.customSections = existing.customSections;
    registry.enums = existing.enums;
    registry.enumRefs = existing.enumRefs;
    registry.sourceFiles = existing.sourceFiles;
    registry.lastSyncedAt = existing.lastSyncedAt;
  } else {
    registry.apis = newApis;
  }

  // Auto-infer chains
  registry.chains = existing?.chains || inferChains(registry.apis);

  return registry;
}
