import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { collectEndpoints, hashSourceFiles, planRegistryUpdate, planSyncDiff } from '../src/core/gen-pipeline.js';
import type { SourceFileInfo } from '../src/core/gen-pipeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, 'fixtures', 'java');

/** F-4：溯源（文件级 hash）与增量同步（代码 ↔ 注册表 diff）纯函数测试 */

function buildBaseline() {
  const { controllerFiles, endpoints } = collectEndpoints(FIXTURE_DIR);
  const { registry } = planRegistryUpdate('fixture', 'sample', endpoints, null, []);
  const files = hashSourceFiles(controllerFiles, FIXTURE_DIR);
  // 模拟 gen 收尾写入溯源（真实流程由 anycli gen/--sync 负责）
  registry.sourceFiles = files;
  return { registry, endpoints, files };
}

describe('F-4: hashSourceFiles 文件级 hash', () => {
  it('sha256 稳定、路径相对扫描根', () => {
    const { controllerFiles } = collectEndpoints(FIXTURE_DIR);
    const files = hashSourceFiles(controllerFiles, FIXTURE_DIR);
    expect(files.length).toBe(3);
    expect(files.every((f) => /^[a-f0-9]{64}$/.test(f.hash))).toBe(true);
    expect(files.map((f) => f.path).sort()).toContain('controllers/SampleOrderController.java');
    expect(hashSourceFiles(controllerFiles, FIXTURE_DIR)).toEqual(files);
  });
});

describe('F-4: collectEndpoints 溯源标注', () => {
  it('端点带 sourceFile（相对扫描根）', () => {
    const { endpoints } = collectEndpoints(FIXTURE_DIR);
    const listPage = endpoints.find((ep) => ep.methodName === 'listPage')!;
    expect(listPage.sourceFile).toBe('controllers/SampleOrderController.java');
  });

  it('planRegistryUpdate 将 source.path 写入注册表条目', () => {
    const { endpoints } = collectEndpoints(FIXTURE_DIR);
    const { registry } = planRegistryUpdate('fixture', 'sample', endpoints, null, []);
    const create = registry.apis.find((a) => a.id === 'sample-order-create')!;
    expect(create.source?.path).toBe('controllers/SampleOrderController.java');
    expect(create.source?.controller).toBe('SampleOrderController');
    expect(create.source?.method).toBe('create');
  });
});

describe('F-4: planSyncDiff 漂移检测', () => {
  it('代码与注册表一致：零漂移', () => {
    const { registry, endpoints, files } = buildBaseline();
    const diff = planSyncDiff(registry, endpoints, files);
    expect(diff.added).toEqual([]);
    expect(diff.missing).toEqual([]);
    expect(diff.signatureChanged).toEqual([]);
    expect(diff.fileChanges.changed).toEqual([]);
    expect(diff.fileChanges.added).toEqual([]);
    expect(diff.fileChanges.removed).toEqual([]);
  });

  it('代码多出的端点 → added；注册表多出的接口 → missing', () => {
    const { registry, endpoints, files } = buildBaseline();
    const extra = { ...endpoints[0], httpMethod: 'POST', path: '/api/brandNew', description: '新接口' };
    const diffAdded = planSyncDiff(registry, [...endpoints, extra], files);
    expect(diffAdded.added.map((ep) => ep.path)).toContain('/api/brandNew');

    const subset = endpoints.filter((ep) => ep.methodName !== 'create');
    const diffMissing = planSyncDiff(registry, subset, files);
    expect(diffMissing.missing.map((a) => a.id)).toContain('sample-order-create');
  });

  it('签名变化（query 参数增减）被报告', () => {
    const { registry, endpoints, files } = buildBaseline();
    const mutated = endpoints.map((ep) => (ep.methodName === 'getDetails'
      ? { ...ep, queryParams: [...ep.queryParams, { name: 'extra', type: 'String', description: 'extra', source: 'query' as const, required: false }] }
      : ep));
    const diff = planSyncDiff(registry, mutated, files);
    const item = diff.signatureChanged.find((c) => c.apiId === 'sample-order-get-details');
    expect(item).toBeDefined();
    expect(item!.changes.some((c) => c.includes('query 参数'))).toBe(true);
  });

  it('源文件 hash 变化 / 新增 / 移除', () => {
    const { registry, endpoints, files } = buildBaseline();
    const tampered: SourceFileInfo[] = files.map((f) => ({ ...f }));
    tampered[0] = { ...tampered[0], hash: 'deadbeef'.repeat(8) };
    const withNew = [...tampered, { path: 'controllers/NewController.java', hash: 'ab'.repeat(32) }];
    const diff = planSyncDiff(registry, endpoints, withNew);
    expect(diff.fileChanges.changed).toContain(files[0].path);
    expect(diff.fileChanges.added).toContain('controllers/NewController.java');

    const diffRemoved = planSyncDiff(registry, endpoints, files.slice(1));
    expect(diffRemoved.fileChanges.removed).toContain(files[0].path);
  });
});
