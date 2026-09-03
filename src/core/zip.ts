/**
 * 最小 ZIP 打包器（STORE 不压缩，零依赖）。
 * 用于可执行技能包导出：内容均为小型 markdown 文本，无需压缩；
 * 固定 DOS 时间戳保证同样输入产出字节一致的 zip（幂等）。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** zip 内路径，统一转为 / 分隔 */
  path: string;
  data: Buffer | string;
}

// 固定时间戳：2020-01-01 00:00:00（DOS 格式），避免环境性 diff
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;
const FLAG_UTF8 = 0x0800;

export function createZip(entries: ZipEntry[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path.replace(/\\/g, '/'), 'utf-8');
    const data = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf-8') : entry.data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(FLAG_UTF8, 6);   // general purpose flags: UTF-8 文件名
    local.writeUInt16LE(0, 8);           // method: store
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);           // extra length
    localChunks.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(20, 4);          // version made by
    central.writeUInt16LE(20, 6);          // version needed
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(0, 10);          // method
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    // extra/comment/disk/attrs 均 0
    central.writeUInt32LE(offset, 42);     // local header offset
    centralChunks.push(central, name);

    offset += 30 + name.length + data.length;
  }

  const centralBuf = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);        // EOCD signature
  eocd.writeUInt16LE(entries.length, 8);     // entries on this disk
  eocd.writeUInt16LE(entries.length, 10);    // total entries
  eocd.writeUInt32LE(centralBuf.length, 12); // central directory size
  eocd.writeUInt32LE(offset, 16);            // central directory offset
  return Buffer.concat([...localChunks, centralBuf, eocd]);
}