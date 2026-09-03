import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DEFAULT_PATH_VARIABLES, loadPathVariables, resolvePathVariables } from '../src/core/path-vars.js';

describe('resolvePathVariables', () => {
  it('内置默认解析 api.prefix 并折叠重复斜杠', () => {
    const result = resolvePathVariables('/${api.prefix}/sample/omsInventoryListPage', DEFAULT_PATH_VARIABLES);
    expect(result.resolved).toBe('/api/sample/omsInventoryListPage');
    expect(result.unresolved).toEqual([]);
  });

  it('无占位符路径原样返回', () => {
    const result = resolvePathVariables('/api/order/listForEsPage', DEFAULT_PATH_VARIABLES);
    expect(result.resolved).toBe('/api/order/listForEsPage');
    expect(result.unresolved).toEqual([]);
  });

  it('未知占位符保留原样并上报', () => {
    const result = resolvePathVariables('/${unknown.var}/x/${unknown.var}/y', {});
    expect(result.resolved).toBe('/${unknown.var}/x/${unknown.var}/y');
    expect(result.unresolved).toEqual(['unknown.var']);
  });

  it('变量值不带前导斜杠也能正确拼接', () => {
    const result = resolvePathVariables('/${p}/x', { p: 'api' });
    expect(result.resolved).toBe('/api/x');
  });
});

describe('loadPathVariables', () => {
  function makePkgRoot(genJson?: string): string {
    const root = mkdtempSync(join(tmpdir(), 'anycli-pathvars-'));
    mkdirSync(join(root, 'apis', 'demo'), { recursive: true });
    if (genJson !== undefined) writeFileSync(join(root, 'apis', 'demo', 'gen.json'), genJson, 'utf-8');
    return root;
  }

  it('无 gen.json 返回内置默认', () => {
    const root = makePkgRoot();
    try {
      expect(loadPathVariables(root, 'demo')).toEqual(DEFAULT_PATH_VARIABLES);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('gen.json pathVariables 覆盖内置默认', () => {
    const root = makePkgRoot(JSON.stringify({ pathVariables: { 'api.prefix': '/openapi', 'other.var': '/v2' } }));
    try {
      const vars = loadPathVariables(root, 'demo');
      expect(vars['api.prefix']).toBe('/openapi');
      expect(vars['other.var']).toBe('/v2');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('gen.json 损坏退回内置默认', () => {
    const root = makePkgRoot('{bad json');
    try {
      expect(loadPathVariables(root, 'demo')).toEqual(DEFAULT_PATH_VARIABLES);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('非字符串变量值被忽略', () => {
    const root = makePkgRoot(JSON.stringify({ pathVariables: { 'a.b': 123 } }));
    try {
      expect(loadPathVariables(root, 'demo')).toEqual(DEFAULT_PATH_VARIABLES);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});