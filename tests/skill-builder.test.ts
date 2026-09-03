import { describe, it, expect } from 'vitest';
import { buildSkillMd, mergeRegistry, buildApiIndex } from '../src/core/skill-builder.js';
import type { ModuleRegistry } from '../src/core/skill-builder.js';

const sampleRegistry: ModuleRegistry = {
  module: 'demo-order',
  version: '1.0.0',
  description: 'Demo 订单管理模块。订单搜索、订单详情、订单选择。',
  triggers: ['订单', '搜索订单', 'order'],
  enumRefs: ['platform-enums'],
  apis: [
    {
      id: 'order-list-page',
      summary: '订单搜索（订单广场 ES 搜索）',
      method: 'POST',
      path: '/api/order/listForEsPage',
      level: 'read',
      bodyParams: [
        { name: 'pageNum', type: 'int', required: true, desc: '页码' },
        { name: 'data.keyword', type: 'string', required: false, desc: '关键词' },
      ],
      bodyTemplate: { pageNum: 1, pageSize: 20, data: { keyword: '' } },
      notes: '列表接口粉丝数字段为 fansNum',
      examples: [{ title: '搜索订单', command: 'anycli request demo POST /api/order/listForEsPage --body \'{}\'' }],
    },
  ],
  customSections: [
    { title: '错误处理', content: '| 错误码 | 处理 |\n|--------|------|\n| AUTH_EXPIRED | anycli auth login |' },
  ],
};

describe('skill-builder', () => {
  describe('buildSkillMd', () => {
    it('generates valid markdown with frontmatter', () => {
      const md = buildSkillMd(sampleRegistry, 'demo');
      expect(md).toContain('---');
      expect(md).toContain('name: demo-order');
      expect(md).toContain('version: 1.0.0');
      expect(md).toContain('AUTO-GENERATED from apis/ registry');
    });

    it('includes api table', () => {
      const md = buildSkillMd(sampleRegistry, 'demo');
      expect(md).toContain('## 选哪个接口');
      expect(md).toContain('order-list-page');
      expect(md).toContain('POST');
    });

    it('includes body template as JSON', () => {
      const md = buildSkillMd(sampleRegistry, 'demo');
      expect(md).toContain('```json');
      expect(md).toContain('"pageNum": 1');
    });

    it('includes params table', () => {
      const md = buildSkillMd(sampleRegistry, 'demo');
      expect(md).toContain('| pageNum | int | 是 | 页码 |');
      expect(md).toContain('| data.keyword | string | 否 | 关键词 |');
    });

    it('includes notes as warning', () => {
      const md = buildSkillMd(sampleRegistry, 'demo');
      expect(md).toContain('⚠️ 列表接口粉丝数字段为 fansNum');
    });

    it('includes custom sections', () => {
      const md = buildSkillMd(sampleRegistry, 'demo');
      expect(md).toContain('## 错误处理');
      expect(md).toContain('AUTH_EXPIRED');
    });

    it('includes triggers in frontmatter', () => {
      const md = buildSkillMd(sampleRegistry, 'demo');
      expect(md).toContain('  - 订单');
      expect(md).toContain('  - order');
    });
  });

  describe('mergeRegistry', () => {
    it('adds new apis from incoming', () => {
      const incoming: Partial<ModuleRegistry> = {
        apis: [
          { id: 'new-api', summary: 'New', method: 'GET', path: '/new', level: 'read' },
        ],
      };
      const merged = mergeRegistry(sampleRegistry, incoming);
      expect(merged.apis).toHaveLength(2);
      expect(merged.apis.find((a) => a.id === 'new-api')).toBeTruthy();
    });

    it('preserves human fields on existing apis', () => {
      const incoming: Partial<ModuleRegistry> = {
        apis: [
          {
            id: 'order-list-page',
            summary: 'Updated summary',
            method: 'POST',
            path: '/api/order/listForEsPage',
            level: 'write',
            notes: 'should not overwrite',
          },
        ],
      };
      const merged = mergeRegistry(sampleRegistry, incoming);
      const api = merged.apis.find((a) => a.id === 'order-list-page')!;
      expect(api.summary).toBe('Updated summary');
      expect(api.notes).toBe('列表接口粉丝数字段为 fansNum');
      expect(api.level).toBe('read');
    });

    it('preserves customSections when not provided in incoming', () => {
      const merged = mergeRegistry(sampleRegistry, { apis: [] });
      expect(merged.customSections).toEqual(sampleRegistry.customSections);
    });
  });

  describe('buildApiIndex', () => {
    it('indexes apis by id and module.id', () => {
      const index = buildApiIndex([{ project: 'demo', module: 'demo-order', registry: sampleRegistry }]);
      expect(index.has('order-list-page')).toBe(true);
      expect(index.has('demo-order.order-list-page')).toBe(true);
    });
  });
});
