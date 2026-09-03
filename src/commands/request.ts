import { Command } from 'commander';
import inquirer from 'inquirer';
import { createClient, output, getDefaultFormat, AnycliError, ErrorCode, warn } from '../core/index.js';
import { loadPathVariables, resolvePathVariables } from '../core/path-vars.js';
import type { OutputFormat, RequestOptions } from '../core/index.js';
import { buildApiIndex } from '../core/skill-builder.js';
import { evaluatePolicy, writeAuditLog } from '../core/policy.js';
import type { PolicyContext, ApiLevel } from '../core/policy.js';
import { paginate } from '../core/pagination.js';
import { getActiveProfileName, getProfile } from '../core/config.js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

import { resolveWorkspace } from '../core/config.js';


const WORKSPACE = resolveWorkspace();

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const;
type Method = (typeof ALLOWED_METHODS)[number];

function parseJson(flag: string, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new AnycliError(
      ErrorCode.INVALID_PARAMS,
      `${flag} 不是合法的 JSON: ${raw.slice(0, 120)}`,
      '示例: --body \'{"pageNum":1,"data":{"keyword":"x"}}\'',
    );
  }
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]] || typeof current[keys[i]] !== 'object') {
      current[keys[i]] = {};
    }
    current = current[keys[i]] as Record<string, unknown>;
  }
  const lastKey = keys[keys.length - 1];
  const raw = value as string;
  if (raw === 'true') current[lastKey] = true;
  else if (raw === 'false') current[lastKey] = false;
  else if (/^\d+$/.test(raw)) current[lastKey] = parseInt(raw, 10);
  else current[lastKey] = raw;
}

export function registerRequestCommands(program: Command): void {
  program
    .command('request <project> [method] [path]')
    .description('通用接口调用（支持按 path 或按注册表 id 调用）')
    .option('--api <id>', '按注册表接口 id 调用（自动解析 method/path/template）')
    .option('--body <json>', '请求体 JSON（POST/PUT 用）')
    .option('--query <json>', '查询参数 JSON（拼到 URL）')
    .option('--set <pairs...>', '设置 body 字段（dot notation，如 data.keyword=keyword）')
    .option('--paginate', '自动分页聚合所有结果')
    .option('--timeout <ms>', '超时时间（毫秒，默认 30000）')
    .option('--format <format>', '输出格式: json | table | text')
    .option('--yes', '跳过确认提示（write/dangerous 操作）')
    .addHelpText(
      'after',
      `
示例:
  # 按 path 调用（传统方式）
  $ anycli request demo POST /api/items/search --body '{"pageNum":1,"pageSize":20,"data":{"keyword":"keyword"}}'

  # 按注册表 id 调用（推荐）
  $ anycli request demo --api items-search --set data.keyword=keyword

  # 分页聚合
  $ anycli request demo --api items-search --paginate --body '{"data":{"tagList":["tag_a"]}}'

说明:
  --api 从接口注册表 (apis/) 解析 method/path/bodyTemplate，自动校验参数。
  --set 合并到 bodyTemplate（dot notation），优先级高于 --body。
  --paginate 自动递增 pageNum 直到无更多数据，合并输出。`,
    )
    .action(
      async (
        project: string,
        method: string | undefined,
        path: string | undefined,
        options: {
          api?: string;
          body?: string;
          query?: string;
          set?: string[];
          paginate?: boolean;
          timeout?: string;
          format?: string;
          yes?: boolean;
        },
      ) => {
        let resolvedMethod: string;
        let resolvedPath: string;
        let bodyTemplate: Record<string, unknown> | undefined;
        let apiId = options.api || '';
        let level: ApiLevel = 'read';

        // Resolve from registry if --api is provided
        if (options.api) {
          const index = buildApiIndex();
          const entry = index.get(options.api) || index.get(`${project}-${options.api}`) || index.get(`${project}.${options.api}`);
          if (!entry) {
            throw new AnycliError(
              ErrorCode.INVALID_PARAMS,
              `接口 "${options.api}" 未在注册表中找到`,
              '请检查 apis/ 目录下的注册表文件，或使用 anycli skill validate 校验',
            );
          }
          resolvedMethod = entry.api.method;
          resolvedPath = entry.api.path;
          apiId = entry.api.id;
          level = entry.api.level as ApiLevel;
          if (entry.api.bodyTemplate && typeof entry.api.bodyTemplate === 'object') {
            bodyTemplate = JSON.parse(JSON.stringify(entry.api.bodyTemplate));
          }
        } else {
          if (!method || !path) {
            throw new AnycliError(
              ErrorCode.INVALID_PARAMS,
              '请提供 <method> <path> 或使用 --api <id>',
              '示例: anycli request demo POST /api/items/search --body \'{}\'',
            );
          }
          resolvedMethod = method.toUpperCase();
          resolvedPath = path;
        }

        // 解析路径中的 ${...} 占位符（如 ${api.prefix} → /api；可用 apis/{project}/gen.json pathVariables 覆盖）
        const pathVars = loadPathVariables(WORKSPACE, project);
        const pathResolve = resolvePathVariables(resolvedPath, pathVars);
        resolvedPath = pathResolve.resolved;
        if (pathResolve.unresolved.length > 0) {
          warn(`路径含未解析占位符（将按原样发送）: ${pathResolve.unresolved.map((u) => `\${${u}}`).join(', ')}`);
        }

        const upper = resolvedMethod.toUpperCase();
        if (!ALLOWED_METHODS.includes(upper as Method)) {
          throw new AnycliError(ErrorCode.INVALID_PARAMS, `不支持的请求方法: ${resolvedMethod}`);
        }

        // Build body: template + --body + --set
        let body: unknown = bodyTemplate;
        if (options.body !== undefined) {
          const parsed = parseJson('--body', options.body) as Record<string, unknown>;
          body = body ? { ...body as Record<string, unknown>, ...parsed } : parsed;
        }
        if (options.set && options.set.length > 0) {
          if (!body || typeof body !== 'object') body = {};
          for (const pair of options.set) {
            const eqIdx = pair.indexOf('=');
            if (eqIdx === -1) {
              throw new AnycliError(ErrorCode.INVALID_PARAMS, `--set 格式错误: ${pair}`, '格式: key=value（如 data.keyword=keyword）');
            }
            setNestedValue(body as Record<string, unknown>, pair.slice(0, eqIdx), pair.slice(eqIdx + 1));
          }
        }

        let timeout: number | undefined;
        if (options.timeout !== undefined) {
          timeout = parseInt(options.timeout, 10);
          if (Number.isNaN(timeout) || timeout <= 0) {
            throw new AnycliError(ErrorCode.INVALID_PARAMS, `--timeout 需为正整数毫秒: ${options.timeout}`);
          }
        }

        // Policy check
        const profileName = getActiveProfileName();
        const profile = getProfile();
        const policyCtx: PolicyContext = {
          project,
          apiId: apiId || resolvedPath,
          method: upper,
          path: resolvedPath,
          level,
          profile: profileName,
          env: profile.env,
        };

        const nonInteractive = process.argv.includes('--non-interactive') || !!process.env.CI;
        const decision = evaluatePolicy(policyCtx, nonInteractive);

        if (!decision.allowed) {
          throw new AnycliError(ErrorCode.FORBIDDEN, decision.reason || '操作被策略拒绝');
        }

        if (decision.requireConfirm && !options.yes) {
          const { confirmed } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirmed',
            message: `${decision.reason}\n确认执行？`,
            default: false,
          }]);
          if (!confirmed) {
            output({ success: false, error: { code: 'CANCELLED', message: '用户取消操作' } });
            return;
          }
        }

        // Execute
        const client = createClient(project);
        const startTime = Date.now();

        const requestOptions: RequestOptions = {
          method: upper as Method,
          path: resolvedPath,
          body,
          query: options.query !== undefined ? (parseJson('--query', options.query) as RequestOptions['query']) : undefined,
          timeout,
        };

        // Pagination mode
        if (options.paginate) {
          const result = await paginate(
            async (paginatedBody) => {
              return client.request({ ...requestOptions, body: paginatedBody });
            },
            (body || {}) as Record<string, unknown>,
          );
          const durationMs = Date.now() - startTime;
          writeAuditLog(policyCtx, 200, durationMs);
          const format = (options.format || getDefaultFormat()) as OutputFormat;
          output({ success: true, data: { items: result.items, totalPages: result.totalPages, totalItems: result.totalItems } }, format);
          return;
        }

        // Normal request with retry
        let lastError: unknown;
        const maxRetries = upper === 'GET' ? 2 : 0;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const result = await client.request(requestOptions);
            const durationMs = Date.now() - startTime;
            writeAuditLog(policyCtx, 200, durationMs);
            const format = (options.format || getDefaultFormat()) as OutputFormat;
            output(result, format);
            return;
          } catch (error) {
            lastError = error;
            if (error instanceof AnycliError && error.code === ErrorCode.NETWORK_ERROR && attempt < maxRetries) {
              continue;
            }
            break;
          }
        }

        const durationMs = Date.now() - startTime;
        writeAuditLog(policyCtx, 500, durationMs);
        throw lastError;
      },
    );
}
