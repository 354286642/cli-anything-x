import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scanControllers, parseEnumSource, collectReferencedEnums } from '../src/core/java-parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, 'fixtures', 'java');
const ENUM_DIR = join(FIXTURE_DIR, 'enums');

/**
 * F-2：Java enum 自动采集。
 * value 恒为枚举常量名（请求体按 Jackson 默认以枚举名序列化），label 取中文描述参数。
 */

describe('F-2: parseEnumSource 枚举解析', () => {
  it('单参形态 NAME("label")：value=常量名，label=参数；描述取自 Javadoc', () => {
    const parsed = parseEnumSource(readFileSync(join(ENUM_DIR, 'SampleOrderStatusEnum.java'), 'utf8'))!;
    expect(parsed.name).toBe('SampleOrderStatusEnum');
    expect(parsed.description).toContain('样品状态');
    expect(parsed.values[0]).toEqual({ value: 'DRAFT', label: '草稿' });
    expect(parsed.values.map((v) => v.value)).toContain('SHIPPED');
    // 常量段在第一个顶层分号截止：后续静态集合声明不被误采
    expect(parsed.values.every((v) => /^[A-Z][A-Z0-9_]*$/.test(v.value))).toBe(true);
  });

  it('多参形态 NAME("名称", "编码", ...)：label 取首参中文', () => {
    const parsed = parseEnumSource(readFileSync(join(ENUM_DIR, 'LaunchPlatformEnum.java'), 'utf8'))!;
    expect(parsed.values[0]).toEqual({ value: 'TAO_BAO', label: '淘宝' });
    expect(parsed.values.some((v) => v.label === '抖音')).toBe(true);
  });

  it('首参为纯数字编码时 label 取第二参', () => {
    const source = [
      'public enum CodeFirstEnum {',
      '    FOO("01", "甲"),',
      '    BAR("02", "乙");',
      '}',
    ].join('\n');
    const parsed = parseEnumSource(source)!;
    expect(parsed.values).toEqual([
      { value: 'FOO', label: '甲' },
      { value: 'BAR', label: '乙' },
    ]);
  });

  it('无参常量：value=label=常量名', () => {
    const source = 'public enum BareEnum { ALPHA, BETA; }';
    const parsed = parseEnumSource(source)!;
    expect(parsed.values).toEqual([
      { value: 'ALPHA', label: 'ALPHA' },
      { value: 'BETA', label: 'BETA' },
    ]);
  });

  it('非枚举源码返回 null', () => {
    expect(parseEnumSource('public class NotEnum {}')).toBeNull();
  });
});

describe('F-2: collectReferencedEnums 请求 DTO 类图采集', () => {
  it('夹具端点采集到 CreateSampleOrderCmd 链路上的枚举', () => {
    const endpoints = scanControllers(FIXTURE_DIR).flatMap((r) => r.endpoints);
    const enums = collectReferencedEnums(endpoints, FIXTURE_DIR);
    const names = enums.map((e) => e.name);
    // 请求 DTO 直接引用
    expect(names).toContain('SampleOrderLocationEnum');
    expect(names).toContain('SampleOrderTypeEnum');
    expect(names).toContain('SampleOrderCompanyExpressRequirementEnum');
    // 嵌套明细 DTO 引用
    expect(names).toContain('SampleOrderExpirationRequirementEnum');
    // 每个枚举都有常量值
    for (const enumDef of enums) {
      expect(enumDef.values.length).toBeGreaterThan(0);
    }
  });

  it('无 body 的端点不采集', () => {
    const enums = collectReferencedEnums([], FIXTURE_DIR);
    expect(enums).toEqual([]);
  });
});
