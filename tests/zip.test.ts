import { describe, it, expect } from 'vitest';
import { crc32, createZip } from '../src/core/zip.js';
import type { ZipEntry } from '../src/core/zip.js';

/** 迷你解包器：按 ZIP 规范解析 EOCD → 中央目录 → 本地头，用于 round-trip 验证 */
function readZip(buf: Buffer): Map<string, Buffer> {
  let eocdPos = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocdPos = i; break; }
  }
  expect(eocdPos).toBeGreaterThanOrEqual(0);
  const count = buf.readUInt16LE(eocdPos + 10);
  let pos = buf.readUInt32LE(eocdPos + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(pos)).toBe(0x02014b50);
    const nameLen = buf.readUInt16LE(pos + 28);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString('utf-8');
    expect(buf.readUInt32LE(localOffset)).toBe(0x04034b50);
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const size = buf.readUInt32LE(localOffset + 22);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    files.set(name, Buffer.from(buf.subarray(dataStart, dataStart + size)));
    pos += 46 + nameLen;
  }
  return files;
}

describe('crc32', () => {
  it('标准校验值 123456789 → 0xCBF43926', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('空缓冲区 → 0', () => {
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });
});

describe('createZip', () => {
  it('round-trip：多文件含嵌套目录', () => {
    const entries: ZipEntry[] = [
      { path: 'SKILL.md', data: '# 技能\n\n内容' },
      { path: 'references/api-one.md', data: '# api-one' },
      { path: 'references/api-two.md', data: '' },
    ];
    const files = readZip(createZip(entries));
    expect(files.size).toBe(3);
    expect(files.get('SKILL.md')!.toString('utf-8')).toBe('# 技能\n\n内容');
    expect(files.get('references/api-one.md')!.toString('utf-8')).toBe('# api-one');
    expect(files.get('references/api-two.md')!.toString('utf-8')).toBe('');
  });

  it('反斜杠路径统一为 /', () => {
    const files = readZip(createZip([{ path: 'references\\x.md', data: 'x' }]));
    expect(files.has('references/x.md')).toBe(true);
  });

  it('支持 Buffer 数据', () => {
    const files = readZip(createZip([{ path: 'a.bin', data: Buffer.from([1, 2, 3]) }]));
    expect([...files.get('a.bin')!]).toEqual([1, 2, 3]);
  });

  it('确定性：相同输入字节一致', () => {
    const entries: ZipEntry[] = [{ path: 'SKILL.md', data: '内容' }];
    expect(createZip(entries).equals(createZip(entries))).toBe(true);
  });

  it('空包合法', () => {
    const buf = createZip([]);
    expect(readZip(buf).size).toBe(0);
  });
});