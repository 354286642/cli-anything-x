import { buildApiIndex } from './skill-builder.js';
import { getFlowEndApi } from './flow-compiler.js';
import type { FlowData, FlowStep } from './flow-compiler.js';
import type { ApiEntry } from './skill-builder.js';

export interface GroundingIssue {
  stepId: string;
  stepTitle: string;
  ref: string;
  message: string;
}

export interface GroundingResult {
  valid: boolean;
  issues: GroundingIssue[];
  checkedRefs: number;
}

/**
 * 校验 flow.json 中所有 apiRef / apiRefs 是否能在接口注册表中解析。
 * 也检查 flow 内部 apis[] 定义的 id 是否被 step 正确引用。
 */
export function validateFlowGrounding(
  flowData: FlowData,
  registryIndex: Map<string, { project: string; module: string; api: ApiEntry }> = buildApiIndex(),
): GroundingResult {
  const issues: GroundingIssue[] = [];
  let checkedRefs = 0;

  const localApiIds = new Set(flowData.apis.map((api) => api.id));

  for (const step of flowData.steps) {
    const refs = resolveStepApiRefs(step);
    for (const ref of refs) {
      checkedRefs++;

      if (localApiIds.has(ref)) {
        continue;
      }

      if (registryIndex.has(ref)) {
        continue;
      }

      issues.push({
        stepId: step.id,
        stepTitle: step.title,
        ref,
        message: `apiRef "${ref}" 未在 flow.apis[] 中定义，也未在接口注册表 (apis/) 中找到`,
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    checkedRefs,
  };
}

function resolveStepApiRefs(step: FlowStep): string[] {
  if (Array.isArray(step.apiRefs) && step.apiRefs.length) {
    return step.apiRefs.filter(Boolean);
  }
  if (step.apiRef) return [step.apiRef];
  return [];
}

// ── F-7: 字段级接地（warning 级，不阻断编译） ──

export interface FieldGroundingResult {
  warnings: string[];
}

/** 路径去首段（/api、/{prefix}、/${xxx}）后比较，兼容不同前缀写法 */
function normalizeApiPathForMatch(path: string): string {
  return (path || '').replace(/^\/[^/]+/, '').replace(/\/+$/, '');
}

/** 提取 JSON 模板顶层字段名；解析失败或非对象返回 null */
function topLevelKeys(template: unknown): string[] | null {
  let obj: unknown = template;
  if (typeof template === 'string') {
    try {
      obj = JSON.parse(template);
    } catch {
      return null;
    }
  }
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    return Object.keys(obj as Record<string, unknown>);
  }
  return null;
}

/**
 * F-7：字段级接地校验（仅输出 warning，不阻断）：
 * 1. steps 引用的 fieldRefs 须在 fieldGroups 中已定义（未定义字段字典时跳过）；
 * 2. endApi（兼容旧 submitCommand）的目标接口须能在注册表找到，
 *    且 bodyTemplate 顶层字段与目标接口请求体对齐（多出字段 / 缺必填字段）。
 */
export function validateFlowFieldGrounding(
  flowData: FlowData,
  registryIndex: Map<string, { project: string; module: string; api: ApiEntry }> = buildApiIndex(),
): FieldGroundingResult {
  const warnings: string[] = [];

  // 1. fieldRefs 存在性
  const fieldNames = new Set<string>();
  for (const group of flowData.fieldGroups || []) {
    for (const field of group.fields || []) fieldNames.add(field.name);
  }
  if (fieldNames.size > 0) {
    for (const step of flowData.steps) {
      for (const ref of step.fieldRefs || []) {
        if (!ref) continue;
        if (!fieldNames.has(ref)) {
          warnings.push(`[${step.id}] ${step.title}: fieldRef "${ref}" 未在 fieldGroups 中定义`);
        }
      }
    }
  }

  // 2. 流程结束接口接地 + 顶层字段对齐
  const submit = getFlowEndApi(flowData);
  if (submit && submit.path) {
    const submitNorm = normalizeApiPathForMatch(submit.path);
    let target: { id: string; api: ApiEntry } | null = null;
    for (const [id, entry] of registryIndex) {
      if (
        entry.api.method?.toUpperCase() === (submit.method || '').toUpperCase() &&
        normalizeApiPathForMatch(entry.api.path) === submitNorm
      ) {
        target = { id, api: entry.api };
        break;
      }
    }

    if (!target) {
      warnings.push(`流程结束接口 ${submit.method} ${submit.path} 未在接口注册表 (apis/) 中找到`);
    } else {
      const flowKeys = topLevelKeys(submit.bodyTemplate);
      if (flowKeys === null) {
        warnings.push(`endApi.bodyTemplate 无法解析为 JSON，跳过字段对齐校验（目标接口 ${target.id}）`);
      } else {
        const apiKeys = topLevelKeys(target.api.bodyTemplate);
        if (apiKeys) {
          const apiSet = new Set(apiKeys);
          for (const key of flowKeys) {
            if (!apiSet.has(key)) {
              warnings.push(`endApi.bodyTemplate 顶层字段 "${key}" 未在目标接口 ${target.id} 的请求体中定义（可能漂移，请对照后端 DTO 核实）`);
            }
          }
        }
        const flowSet = new Set(flowKeys);
        for (const param of target.api.bodyParams || []) {
          if (param.required && !flowSet.has(param.name)) {
            warnings.push(`目标接口 ${target.id} 的必填字段 "${param.name}" 在 endApi.bodyTemplate 中缺失`);
          }
        }
      }
    }
  }

  return { warnings };
}
