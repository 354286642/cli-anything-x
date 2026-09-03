import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseControllerSource, scanControllers } from '../src/core/java-parser.js';
import type { WrapperDef } from '../src/core/java-parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, 'fixtures', 'java');

/**
 * F-3：KNOWN_WRAPPERS 项目级可配置。
 * 默认内置 PageRequest/PageInfo（公司固定格式）不变；
 * apis/{project}/gen.json 的 wrappers 可新增/覆盖包装类定义。
 */

const CUSTOM_WRAPPERS: Record<string, WrapperDef> = {
  MyPageReq: {
    fields: [
      { name: 'current', type: 'int', desc: '当前页码', defaultVal: '1' },
      { name: 'size', type: 'int', desc: '每页大小', defaultVal: '10' },
    ],
    dataField: 'payload',
  },
};

const CUSTOM_CONTROLLER = [
  'package com.example;',
  '',
  '@RestController',
  '@RequestMapping("/demo")',
  'public class DemoController {',
  '',
  '    @ApiOperation("演示分页查询")',
  '    @PostMapping("/page")',
  '    public Result pageQuery(@RequestBody MyPageReq<DemoQuery> query) {',
  '        return null;',
  '    }',
  '}',
].join('\n');

const BUILTIN_CONTROLLER = [
  'package com.example;',
  '',
  '@RestController',
  '@RequestMapping("/demo")',
  'public class DemoController {',
  '',
  '    @ApiOperation("内置分页查询")',
  '    @PostMapping("/page")',
  '    public Result pageQuery(@RequestBody PageRequest<DemoQuery> query) {',
  '        return null;',
  '    }',
  '}',
].join('\n');

describe('F-3：KNOWN_WRAPPERS 项目级配置', () => {
  it('默认行为不变：无配置时 PageRequest 按内置固定格式展开', () => {
    const endpoints = parseControllerSource(BUILTIN_CONTROLLER);
    const names = endpoints[0].bodyFields!.map((p) => p.name);
    expect(names).toEqual(['pageNo', 'pageSize', 'orderBy', 'data']);
    expect(endpoints[0].bodyFields![3].type).toBe('DemoQuery');
    expect(endpoints[0].bodyJsonExample).toContain('"pageNo": 1');
    expect(endpoints[0].bodyJsonExample).toContain('"pageSize": 20');
  });

  it('自定义 wrapper：按配置字段 + dataField 展开', () => {
    const endpoints = parseControllerSource(CUSTOM_CONTROLLER, '', CUSTOM_WRAPPERS);
    const fields = endpoints[0].bodyFields!;
    expect(fields.map((p) => p.name)).toEqual(['current', 'size', 'payload']);
    expect(fields[2].type).toBe('DemoQuery');
    expect(fields[0].required).toBe(false);
    expect(endpoints[0].bodyJsonExample).toContain('"current": 1');
    expect(endpoints[0].bodyJsonExample).toContain('"payload":');
  });

  it('项目配置可覆盖内置 PageRequest', () => {
    const override: Record<string, WrapperDef> = {
      PageRequest: {
        fields: [{ name: 'page', type: 'int', desc: '页码' }],
        dataField: 'data',
      },
    };
    const endpoints = parseControllerSource(BUILTIN_CONTROLLER, '', override);
    const names = endpoints[0].bodyFields!.map((p) => p.name);
    expect(names).toEqual(['page', 'data']);
  });

  it('scanControllers 注入配置用后自动恢复默认（无状态泄漏）', () => {
    scanControllers(FIXTURE_DIR, CUSTOM_WRAPPERS);
    const def = scanControllers(FIXTURE_DIR);
    const sampleOrder = def.find((r) => r.filePath.endsWith('SampleOrderController.java'))!;
    const listPage = sampleOrder.endpoints.find((ep) => ep.methodName === 'listPage')!;
    expect(listPage.bodyJsonExample).toContain('"pageNo": 1');
    expect(listPage.bodyJsonExample).toContain('"data":');
  });
});
