import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';

export interface ApiParam {
  name: string;
  type: string;
  description: string;
  source: 'body' | 'query' | 'path';
  required?: boolean;      // B-2: @RequestParam required 属性（未声明默认 true）
  defaultValue?: string;   // B-2: @RequestParam defaultValue 属性
}

export interface ApiEndpoint {
  httpMethod: string;
  path: string;
  description: string;
  methodName: string;
  controllerName: string;
  params: ApiParam[];
  bodyJsonExample: string;
  queryParams: ApiParam[];
  bodyFields?: ApiParam[]; // B-3: body DTO 顶层字段（字段级 bodyParams 来源）
  returnType?: string; // F-1: 方法返回类型签名
  bodyDtoClass?: string; // F-2: @RequestBody DTO 类名（枚举采集入口）
  sourceFile?: string; // F-4: Controller 文件路径（相对扫描根）
  outputFields?: string; // F-1: 响应 DTO 字段摘要（激活 inferChains）
}

function extractClassBasePath(source: string): string {
  const match = source.match(/@RequestMapping\s*\(\s*(?:value\s*=\s*|path\s*=\s*)?(?:\{\s*)?"([^"]+)"/);
  return match ? match[1] : '';
}

function extractControllerName(source: string): string {
  const match = source.match(/public\s+class\s+(\w+)/);
  return match ? match[1] : 'UnknownController';
}

function findClassBodyStart(source: string): number {
  const match = source.match(/public\s+class\s+\w+[^{]*\{/);
  return match ? (match.index ?? 0) + match[0].length : 0;
}

function extractDescription(block: string): string {
  const apiOpMatches = [...block.matchAll(/@ApiOperation\s*\(\s*(?:value\s*=\s*)?"([^"]+)"/g)];
  if (apiOpMatches.length > 0) return apiOpMatches[apiOpMatches.length - 1][1];
  const opMatches = [...block.matchAll(/@Operation\s*\([^)]*summary\s*=\s*"([^"]+)"/g)];
  if (opMatches.length > 0) return opMatches[opMatches.length - 1][1];
  const javadocMatch = block.match(/\/\*\*([\s\S]*?)\*\//);
  if (javadocMatch) {
    const lines = javadocMatch[1].split('\n').map((l) => l.replace(/^\s*\*\s*/, '').trim()).filter((l) => l && !l.startsWith('@'));
    if (lines.length > 0) return lines[0];
  }
  return '';
}

function extractMethodPath(annotation: string): string {
  const pathMatch = annotation.match(/(?:value\s*=\s*|path\s*=\s*)?(?:\{\s*)?"([^"]+)"/);
  return pathMatch ? pathMatch[1] : '';
}

function extractHttpMethod(annotationType: string, annotationBody: string): string {
  const mapping: Record<string, string> = { GetMapping: 'GET', PostMapping: 'POST', PutMapping: 'PUT', DeleteMapping: 'DELETE', PatchMapping: 'PATCH' };
  if (mapping[annotationType]) return mapping[annotationType];
  const methodMatch = annotationBody.match(/method\s*=\s*(?:\{\s*)?RequestMethod\.(\w+)/);
  if (methodMatch) return methodMatch[1].toUpperCase();
  return 'POST';
}

function extractMethodName(afterAnnotation: string): string {
  const match = afterAnnotation.match(/(?:public|private|protected)\s+\S+(?:<[^>]*>)?\s+(\w+)\s*\(/);
  return match ? match[1] : 'unknown';
}

function extractMethodSignature(afterAnnotation: string): string {
  const match = afterAnnotation.match(/(?:public|private|protected)\s+\S+(?:<[^>]*>)?\s+\w+\s*\(((?:[^()]*|\([^)]*\))*)\)/s);
  return match ? match[1] : '';
}

// ---------- project root & file search ----------

function findProjectRoot(startDir: string): string {
  let dir = startDir;
  let root = startDir;
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, 'pom.xml')) || existsSync(join(dir, 'build.gradle')) || existsSync(join(dir, '.git'))) {
      root = dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return root;
}

const SKIP_ENTRIES = ['node_modules', '.git', 'target', 'build', 'test', '.idea'];

// R-2: 每个 searchRoot 只建一次 className → 文件 索引，替代此前每个 DTO 引用一次的全仓递归扫描。
// 索引按与原扫描完全一致的 DFS/readdir 顺序收集；重名类取第一个命中（保持现状行为）并提示一次。
const javaFileIndexCache = new Map<string, Map<string, string[]>>();
const duplicateClassWarned = new Set<string>();

function buildJavaFileIndex(root: string): Map<string, string[]> {
  const index = new Map<string, string[]>();

  const walk = (dir: string, depth: number): void => {
    if (!existsSync(dir) || depth > 12) return;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (SKIP_ENTRIES.includes(entry.name)) continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (entry.name.endsWith('.java')) {
          const list = index.get(entry.name);
          if (list) list.push(fullPath);
          else index.set(entry.name, [fullPath]);
        }
      }
    } catch { /* ignore */ }
  };

  walk(root, 0);
  return index;
}

function findJavaFile(searchRoot: string, className: string): string | null {
  if (!searchRoot) return null;
  const rootKey = resolve(searchRoot);
  let index = javaFileIndexCache.get(rootKey);
  if (!index) {
    index = buildJavaFileIndex(rootKey);
    javaFileIndexCache.set(rootKey, index);
  }
  const fileName = `${className}.java`;
  const hits = index.get(fileName);
  if (!hits || hits.length === 0) return null;
  if (hits.length > 1) {
    const warnKey = `${rootKey}::${fileName}`;
    if (!duplicateClassWarned.has(warnKey)) {
      duplicateClassWarned.add(warnKey);
      console.warn(`[anycli gen] 类名重复 ${fileName}，取第一个命中: ${hits[0]}（候选: ${hits.join(', ')}）`);
    }
  }
  return hits[0];
}

// ---------- DTO parsing & JSON example ----------

interface DtoField {
  name: string;
  type: string;
  description: string;
  genericActual?: string;
  required: boolean; // B-3: 字段前置 @NotBlank/@NotNull/@NotEmpty 校验注解
}

function parseClassFields(source: string): { fields: DtoField[]; parentClass: string | null; typeParam: string | null } {
  const fields: DtoField[] = [];

  const extendsMatch = source.match(/public\s+class\s+\w+\s*(?:<\s*(\w+)\s*>)?\s*extends\s+(\w+)/);
  const parentClass = extendsMatch ? extendsMatch[2] : null;
  const typeParam = extendsMatch ? extendsMatch[1] : null;

  const genericMatch = source.match(/public\s+class\s+\w+\s*<\s*(\w+)\s*>/);
  const classTypeParam = genericMatch ? genericMatch[1] : typeParam;

  // B-3: 只匹配字段声明本身；描述/校验注解从「上一字段 → 本字段」之间的前置区域提取，
  // 兼容 @NotBlank 等校验注解夹在 @ApiModelProperty 与字段之间（任意顺序）
  const fieldPattern = /(?:private|protected)\s+(\S+(?:<[^>]*>)?)\s+(\w+)\s*;/g;

  let match;
  let lastFieldEnd = 0;
  while ((match = fieldPattern.exec(source)) !== null) {
    const preceding = source.slice(lastFieldEnd, match.index);
    lastFieldEnd = fieldPattern.lastIndex;
    const fieldType = match[1];
    const fieldName = match[2];

    if (!fieldName || ['serialVersionUID'].includes(fieldName)) continue;

    // B-3: @NotBlank/@NotNull/@NotEmpty 校验注解 → required
    const required = /@(NotBlank|NotNull|NotEmpty)\b/.test(preceding);

    // 描述回退链：@ApiModelProperty → @Schema → 前置区域最后一个 Javadoc
    let description = '';
    const apiMatches = [...preceding.matchAll(/@ApiModelProperty\s*\(\s*(?:value\s*=\s*)?"([^"]+)"[^)]*\)/g)];
    if (apiMatches.length > 0) {
      description = apiMatches[apiMatches.length - 1][1];
    } else {
      const schemaMatches = [...preceding.matchAll(/@Schema\s*\([^)]*(?:description|title)\s*=\s*"([^"]+)"[^)]*\)/g)];
      if (schemaMatches.length > 0) {
        description = schemaMatches[schemaMatches.length - 1][1];
      } else {
        const javadocMatches = [...preceding.matchAll(/\/\*\*([\s\S]*?)\*\//g)];
        if (javadocMatches.length > 0) {
          const javadoc = javadocMatches[javadocMatches.length - 1][1];
          const lines = javadoc.split('\n').map((l) => l.replace(/^\s*\*\s*/, '').trim()).filter((l) => l && !l.startsWith('@'));
          if (lines.length > 0) description = lines[0];
        }
      }
    }

    fields.push({ name: fieldName, type: fieldType, description: description || fieldName, required });
  }

  return { fields, parentClass, typeParam: classTypeParam };
}

function getDefaultValue(fieldType: string): string {
  const baseType = fieldType.replace(/<.*>/, '').trim();
  if (['String', 'string'].includes(baseType)) return '""';
  if (['Integer', 'int', 'Long', 'long', 'Short', 'short', 'Byte', 'byte', 'BigDecimal', 'Double', 'double', 'Float', 'float'].includes(baseType)) return '0';
  if (['Boolean', 'boolean'].includes(baseType)) return 'false';
  if (baseType.startsWith('List') || baseType.startsWith('Set') || baseType.startsWith('Collection') || baseType.endsWith('[]')) return '[]';
  if (['Date', 'LocalDate', 'LocalDateTime', 'LocalTime'].includes(baseType)) return '"2026-01-01"';
  if (['Map', 'HashMap', 'Object'].includes(baseType)) return '{}';
  return '{}';
}

/** 请求/响应包装类定义（F-3：项目级可配置，默认内置 PageRequest/PageInfo 公司固定格式） */
export interface WrapperField { name: string; type: string; desc: string; defaultVal?: string }
export interface WrapperDef { fields: WrapperField[]; dataField: string; dataIsList?: boolean }

const KNOWN_WRAPPERS: Record<string, WrapperDef> = {
  PageRequest: {
    fields: [
      { name: 'pageNo', type: 'int', desc: '\u9875\u7801\u4ece1\u5f00\u59cb', defaultVal: '1' },
      { name: 'pageSize', type: 'int', desc: '\u4e0d\u4f20\u9ed8\u8ba420', defaultVal: '20' },
      { name: 'orderBy', type: 'String', desc: '\u6392\u5e8f\u5b57\u6bb5\uff0c\u9ed8\u8ba4update_date' },
    ],
    dataField: 'data',
  },
  PageInfo: {
    fields: [
      { name: 'pageNum', type: 'int', desc: '\u5f53\u524d\u9875' },
      { name: 'pageSize', type: 'int', desc: '\u6bcf\u9875\u7684\u6570\u91cf' },
      { name: 'size', type: 'int', desc: '\u5f53\u524d\u9875\u7684\u6570\u91cf' },
      { name: 'total', type: 'long', desc: '\u603b\u8bb0\u5f55\u6570' },
      { name: 'pages', type: 'int', desc: '\u603b\u9875\u6570' },
      { name: 'prePage', type: 'int', desc: '\u524d\u4e00\u9875' },
      { name: 'nextPage', type: 'int', desc: '\u4e0b\u4e00\u9875' },
      { name: 'isFirstPage', type: 'boolean', desc: '\u662f\u5426\u4e3a\u7b2c\u4e00\u9875' },
      { name: 'isLastPage', type: 'boolean', desc: '\u662f\u5426\u4e3a\u6700\u540e\u4e00\u9875' },
      { name: 'hasPreviousPage', type: 'boolean', desc: '\u662f\u5426\u6709\u524d\u4e00\u9875' },
      { name: 'hasNextPage', type: 'boolean', desc: '\u662f\u5426\u6709\u4e0b\u4e00\u9875' },
    ],
    dataField: 'list',
    dataIsList: true,
  },
};

// F-3：当前生效的包装类表（默认内置；scanControllers/parseControllerSource 可临时注入项目级配置）
let activeWrappers: Record<string, WrapperDef> = KNOWN_WRAPPERS;

function withWrappers<T>(wrappers: Record<string, WrapperDef> | undefined, fn: () => T): T {
  if (!wrappers) return fn();
  const prev = activeWrappers;
  activeWrappers = { ...KNOWN_WRAPPERS, ...wrappers };
  try {
    return fn();
  } finally {
    activeWrappers = prev;
  }
}

function buildJsonExample(
  className: string,
  searchRoot: string,
  depth: number = 0,
  visited: Set<string> = new Set(),
  actualTypeMap: Map<string, string> = new Map(),
): string {
  if (depth > 3) return '{}';
  if (visited.has(className)) return '{}';
  visited.add(className);

  const wrapper = activeWrappers[className];
  if (wrapper) {
    const indent = '  '.repeat(depth + 1);
    const closingIndent = '  '.repeat(depth);
    const lines: string[] = [];
    for (const f of wrapper.fields) {
      const val = f.defaultVal || getDefaultValue(f.type);
      lines.push(`${indent}"${f.name}": ${val}, // ${f.desc}`);
    }
    const actualType = actualTypeMap.values().next().value;
    if (actualType) {
      const nested = buildJsonExample(actualType as string, searchRoot, depth + 1, new Set(visited), new Map());
      if (wrapper.dataIsList) {
        lines.push(`${indent}"${wrapper.dataField}": [${nested}], // ${actualType} \u5217\u8868`);
      } else {
        lines.push(`${indent}"${wrapper.dataField}": ${nested}, // ${actualType}`);
      }
    } else {
      lines.push(`${indent}"${wrapper.dataField}": ${wrapper.dataIsList ? '[]' : '{}'}`);
    }
    return `{\n${lines.join('\n')}\n${closingIndent}}`;
  }

  const file = findJavaFile(searchRoot, className);
  if (!file) {
    return `{} /* ${className} */`;
  }

  const source = readFileSync(file, 'utf-8');
  const { fields, parentClass, typeParam } = parseClassFields(source);

  const allFields: DtoField[] = [];

  if (parentClass && !['Object', 'Serializable'].includes(parentClass)) {
    const parentFile = findJavaFile(searchRoot, parentClass);
    if (parentFile) {
      const parentSource = readFileSync(parentFile, 'utf-8');
      const parentParsed = parseClassFields(parentSource);
      allFields.push(...parentParsed.fields);

      if (parentParsed.parentClass && !['Object', 'Serializable'].includes(parentParsed.parentClass)) {
        const grandFile = findJavaFile(searchRoot, parentParsed.parentClass);
        if (grandFile) {
          const grandSource = readFileSync(grandFile, 'utf-8');
          const grandParsed = parseClassFields(grandSource);
          allFields.unshift(...grandParsed.fields);
        }
      }
    }
  }

  allFields.push(...fields);

  const indent = '  '.repeat(depth + 1);
  const closingIndent = '  '.repeat(depth);
  const lines: string[] = [];

  for (const field of allFields) {
    let fieldType = field.type;

    if (typeParam && fieldType === typeParam) {
      const actualType = actualTypeMap.get(typeParam);
      if (actualType) {
        const nested = buildJsonExample(actualType, searchRoot, depth + 1, new Set(visited), new Map());
        const comment = field.description !== field.name ? ` // ${field.description}` : '';
        lines.push(`${indent}"${field.name}": ${nested},${comment}`);
        continue;
      }
    }

    const genericMatch = fieldType.match(/^(\w+)<(.+)>$/);
    if (genericMatch) {
      const outerType = genericMatch[1];
      const innerType = genericMatch[2].trim();
      if (['List', 'Set', 'Collection'].includes(outerType)) {
        if (isSimpleType(innerType)) {
          lines.push(`${indent}"${field.name}": [],${field.description !== field.name ? ` // ${field.description}` : ''}`);
        } else {
          const nested = buildJsonExample(innerType, searchRoot, depth + 1, new Set(visited), new Map());
          lines.push(`${indent}"${field.name}": [${nested}],${field.description !== field.name ? ` // ${field.description}` : ''}`);
        }
        continue;
      }
    }

    if (isSimpleType(fieldType)) {
      const defaultVal = getDefaultValue(fieldType);
      const comment = field.description !== field.name ? ` // ${field.description}` : '';
      lines.push(`${indent}"${field.name}": ${defaultVal},${comment}`);
    } else {
      const nested = buildJsonExample(fieldType, searchRoot, depth + 1, new Set(visited), new Map());
      const comment = field.description !== field.name ? ` // ${field.description}` : '';
      lines.push(`${indent}"${field.name}": ${nested},${comment}`);
    }
  }

  if (lines.length === 0) return '{}';
  return `{\n${lines.join('\n')}\n${closingIndent}}`;
}

function isSimpleType(type: string): boolean {
  const base = type.replace(/<.*>/, '').trim();
  return ['String', 'string', 'Integer', 'int', 'Long', 'long', 'Short', 'short', 'Byte', 'byte',
    'BigDecimal', 'Double', 'double', 'Float', 'float', 'Boolean', 'boolean', 'Character', 'char',
    'Date', 'LocalDate', 'LocalDateTime', 'LocalTime', 'Object'].includes(base);
}

/** B-2: 按顶层逗号切分方法签名（保留括号/泛型/花括号/字符串内部的逗号） */
function splitTopLevelParams(signature: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let inString = false;
  for (let i = 0; i < signature.length; i++) {
    const ch = signature[i];
    if (inString) {
      current += ch;
      if (ch === '\\') {
        current += signature[i + 1] ?? '';
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') { inString = true; current += ch; continue; }
    if (ch === '(' || ch === '<' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '>' || ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts.filter((p) => p.length > 0);
}

// B-3: 解析 body DTO 的顶层字段，供注册表 bodyParams 字段级登记。
// KNOWN_WRAPPERS 按固定格式展开（分页参数 + data/list 泛型实参）；
// 普通 DTO 解析自身字段并合并父类/祖父类字段（校验注解 → required）。
function resolveBodyFields(
  dtoClassName: string,
  searchRoot: string,
  typeMap: Map<string, string>,
): ApiParam[] | undefined {
  const wrapper = activeWrappers[dtoClassName];
  if (wrapper) {
    const fields: ApiParam[] = wrapper.fields.map((f) => ({
      name: f.name,
      type: f.type,
      description: f.desc,
      source: 'body',
      required: false,
    }));
    const actualType = typeMap.values().next().value as string | undefined;
    fields.push({
      name: wrapper.dataField,
      type: actualType || 'object',
      description: actualType ? `${actualType}（泛型 ${wrapper.dataField}）` : wrapper.dataField,
      source: 'body',
      required: true,
    });
    return fields;
  }

  const file = findJavaFile(searchRoot, dtoClassName);
  if (!file) return undefined;
  const source = readFileSync(file, 'utf-8');
  const { fields, parentClass } = parseClassFields(source);

  const allFields: DtoField[] = [];
  if (parentClass && !['Object', 'Serializable'].includes(parentClass)) {
    const parentFile = findJavaFile(searchRoot, parentClass);
    if (parentFile) {
      const parentParsed = parseClassFields(readFileSync(parentFile, 'utf-8'));
      allFields.push(...parentParsed.fields);
      if (parentParsed.parentClass && !['Object', 'Serializable'].includes(parentParsed.parentClass)) {
        const grandFile = findJavaFile(searchRoot, parentParsed.parentClass);
        if (grandFile) {
          allFields.unshift(...parseClassFields(readFileSync(grandFile, 'utf-8')).fields);
        }
      }
    }
  }
  allFields.push(...fields);

  return allFields.map((f) => ({
    name: f.name,
    type: f.type,
    description: f.description,
    source: 'body' as const,
    required: f.required,
  }));
}
// ---------- endpoint param extraction ----------

function extractEndpointParams(
  signature: string,
  searchRoot: string,
): { params: ApiParam[]; bodyJsonExample: string; queryParams: ApiParam[]; bodyFields?: ApiParam[]; bodyDtoClass?: string } {
  const params: ApiParam[] = [];
  const queryParams: ApiParam[] = [];
  let bodyJsonExample = '';
  let bodyFields: ApiParam[] | undefined;
  let bodyDtoClass: string | undefined;


  const bodyMatch = signature.match(/@RequestBody\s+(\w+)(?:<(\w+)>)?/);
  if (bodyMatch) {
    const dtoClassName = bodyMatch[1];
    bodyDtoClass = dtoClassName;
    const genericActual = bodyMatch[2];

    const typeMap = new Map<string, string>();
    if (genericActual) {
      typeMap.set('T', genericActual);
      const dtoFile = findJavaFile(searchRoot, dtoClassName);
      if (dtoFile) {
        const dtoSource = readFileSync(dtoFile, 'utf-8');
        const { typeParam } = parseClassFields(dtoSource);
        if (typeParam) typeMap.set(typeParam, genericActual);
      }
    }

    bodyJsonExample = buildJsonExample(dtoClassName, searchRoot, 0, new Set(), typeMap);

    params.push({ name: dtoClassName, type: dtoClassName, description: dtoClassName, source: 'body' });
    bodyFields = resolveBodyFields(dtoClassName, searchRoot, typeMap);
  }

  // B-2: 顶层逗号切分（保留注解括号/泛型/字符串内的逗号），
  // 完整解析 @RequestParam 的 value/name、required、defaultValue 属性
  for (const part of splitTopLevelParams(signature)) {
    if (!part.includes('@RequestParam')) continue;
    const typeAndName = part.match(/(\S+(?:<[^>]*>)?)\s+(\w+)\s*$/);
    if (!typeAndName) continue;
    const paramType = typeAndName[1];
    const varName = typeAndName[2];
    const attrMatch = part.match(/@RequestParam\s*\(([^)]*)\)/);
    const attrs = attrMatch ? attrMatch[1] : '';
    const nameAttr = attrs.match(/(?:value|name)\s*=\s*"([^"]+)"/);
    const requiredAttr = attrs.match(/required\s*=\s*(true|false)/);
    const defaultAttr = attrs.match(/defaultValue\s*=\s*"([^"]+)"/);
    const apiParam = part.match(/@ApiParam\s*\(\s*(?:value\s*=\s*)?"([^"]+)"/);
    const paramName = nameAttr ? nameAttr[1] : varName;
    const param: ApiParam = {
      name: paramName,
      type: paramType,
      description: apiParam ? apiParam[1] : paramName,
      source: 'query',
      required: requiredAttr?.[1] !== 'false',
      defaultValue: defaultAttr?.[1],
    };
    params.push(param);
    queryParams.push(param);
  }

  const pathVarPattern = /@PathVariable\s*(?:\(\s*(?:"([^"]+)")?\s*\))?\s*(\S+)\s+(\w+)/g;
  let pMatch;
  while ((pMatch = pathVarPattern.exec(signature)) !== null) {
    const param: ApiParam = { name: pMatch[1] || pMatch[3], type: pMatch[2], description: pMatch[1] || pMatch[3], source: 'path', required: true };
    params.push(param);
    queryParams.push(param);
  }

  return { params, bodyJsonExample, queryParams, bodyFields, bodyDtoClass };
}

// ---------- F-2: 枚举采集 ----------

export interface ParsedEnumValue { value: string; label: string }
export interface ParsedEnum { name: string; description?: string; values: ParsedEnumValue[] }

/** F-2：判断源码是否为枚举定义 */
function isEnumSource(source: string): boolean {
  return /\benum\s+\w+/.test(source);
}

/**
 * F-2：解析 Java 枚举常量。
 * 支持 NAME("label")、NAME("value", "label")、NAME 三种形态；
 * 常量段取枚举体开头到第一个顶层分号（避开后续静态集合声明）。
 */
export function parseEnumSource(source: string): ParsedEnum | null {
  const declMatch = source.match(/\benum\s+(\w+)/);
  if (!declMatch || declMatch.index === undefined) return null;
  const name = declMatch[1];

  let description: string | undefined;
  const before = source.slice(0, declMatch.index);
  const javadocs = [...before.matchAll(/\/\*\*([\s\S]*?)\*\//g)];
  if (javadocs.length > 0) {
    description = javadocs[javadocs.length - 1][1]
      .split('\n')
      .map((line) => line.replace(/^\s*\*+\s?/, '').trim())
      .filter(Boolean)
      .join(' ');
  }

  const bodyStart = source.indexOf('{', declMatch.index + declMatch[0].length);
  if (bodyStart === -1) return { name, description, values: [] };
  let end = -1;
  let depth = 0;
  for (let i = bodyStart + 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') depth--;
    else if (ch === ';' && depth === 0) { end = i; break; }
  }
  // 保留结尾分号，使最后一个常量（NAME(...)）能被模式命中
  const section = end === -1 ? source.slice(bodyStart + 1) : source.slice(bodyStart + 1, end + 1);

  const values: ParsedEnumValue[] = [];
  const constPattern = /([A-Z][A-Z0-9_]*)\s*(?:\(([^)]*)\))?\s*[;,]/g;
  let m;
  while ((m = constPattern.exec(section)) !== null) {
    const constName = m[1];
    const args = m[2] ? [...m[2].matchAll(/"([^"]*)"/g)].map((x) => x[1]) : [];
    // value 恒为枚举常量名（请求体按 Jackson 默认以枚举名序列化）；
    // label 取第一个中文字符串参数；首参为纯数字编码时改取第二参数。
    if (args.length === 0) {
      values.push({ value: constName, label: constName });
    } else if (/^[\d_]+$/.test(args[0]) && args.length >= 2) {
      values.push({ value: constName, label: args[1] });
    } else {
      values.push({ value: constName, label: args[0] });
    }
  }
  return { name, description, values };
}

/**
 * F-2：从端点的请求 DTO 类图（深度<=3，含继承与泛型实参）收集引用的枚举定义。
 * 包装类（如 PageRequest）的泛型实参经 bodyFields 的 data/list 类型字段间接覆盖。
 */
export function collectReferencedEnums(
  endpoints: ApiEndpoint[],
  controllerPath: string,
): ParsedEnum[] {
  let dir = controllerPath;
  if (existsSync(controllerPath) && statSync(controllerPath).isFile()) dir = dirname(controllerPath);
  const searchRoot = dir ? findProjectRoot(dir) : dir;
  if (!searchRoot) return [];

  const collected = new Map<string, ParsedEnum>();
  const visited = new Set<string>();

  function visit(className: string, depth: number): void {
    if (depth > 3 || visited.has(className) || isSimpleType(className)) return;
    visited.add(className);
    const file = findJavaFile(searchRoot, className);
    if (!file) return;
    const source = readFileSync(file, 'utf-8');
    if (isEnumSource(source)) {
      const parsed = parseEnumSource(source);
      if (parsed && parsed.values.length > 0) collected.set(parsed.name, parsed);
      return;
    }
    const { fields, parentClass } = parseClassFields(source);
    const typeNames: string[] = [];
    if (parentClass && !['Object', 'Serializable'].includes(parentClass)) typeNames.push(parentClass);
    for (const field of fields) {
      const generic = field.type.match(/^(\w+)<(.+)>$/);
      if (generic) {
        if (!['List', 'Set', 'Collection', 'Map'].includes(generic[1])) typeNames.push(generic[1]);
        typeNames.push(generic[2].trim());
      } else {
        typeNames.push(field.type);
      }
    }
    for (const typeName of typeNames) {
      if (!isSimpleType(typeName)) visit(typeName, depth + 1);
    }
  }

  for (const ep of endpoints) {
    if (ep.bodyDtoClass) visit(ep.bodyDtoClass, 0);
    for (const param of ep.bodyFields || []) {
      const base = param.type.replace(/<.*>/, '').trim();
      if (!isSimpleType(base) && base !== 'object') visit(base, 1);
    }
  }
  return [...collected.values()];
}

// ---------- F-1: 返回类型解析 → outputFields ----------

/** 提取方法返回类型（支持嵌套泛型，如 Result<PageInfo<X>>） */
function extractReturnType(afterAnnotation: string): string {
  const visMatch = afterAnnotation.match(/(?:public|private|protected)\s+/);
  if (!visMatch || visMatch.index === undefined) return '';
  let i = visMatch.index + visMatch[0].length;
  let type = '';
  let depth = 0;
  while (i < afterAnnotation.length) {
    const ch = afterAnnotation[i];
    if (ch === '<') depth++;
    else if (ch === '>') depth--;
    else if (depth === 0 && (/\s/.test(ch) || ch === '(')) break;
    type += ch;
    i++;
  }
  return type;
}

/** 迭代展开响应包装：Result/BaseResult → data；PageInfo → list[]；List/Set → [] */
function unwrapOutputType(type: string): { prefix: string[]; leaf: string } {
  let current = type.trim();
  const prefix: string[] = [];
  for (let i = 0; i < 6; i++) {
    const m = current.match(/^(\w+)<(.+)>$/);
    if (m && m[1] === 'PageInfo') {
      prefix.push('list[]');
      current = m[2].trim();
      continue;
    }
    if (m && ['Result', 'BaseResult'].includes(m[1])) {
      prefix.push('data');
      current = m[2].trim();
      continue;
    }
    if (m && m[1] === 'ResponseEntity') {
      prefix.push('body');
      current = m[2].trim();
      continue;
    }
    if (m && ['List', 'Set', 'Collection'].includes(m[1])) {
      prefix.push('[]');
      current = m[2].trim();
      continue;
    }
    break;
  }
  return { prefix, leaf: current };
}

const OUTPUT_MAX_FIELDS = 40;

/**
 * F-1：把方法返回类型解析为 outputFields 摘要字符串
 * （与人工注册表风格一致：`data.list[]: a 描述 / b 描述 ...`）。
 */
function resolveOutputFields(returnType: string, searchRoot: string): string | undefined {
  if (!returnType || returnType === 'void') return undefined;
  const { prefix, leaf } = unwrapOutputType(returnType);

  if (isSimpleType(leaf)) {
    const leafDesc = prefix.includes('list[]') || prefix.includes('[]') ? `${leaf} 列表` : leaf;
    return prefix.length > 0 ? `${prefix.join('.')}: ${leafDesc}` : leafDesc;
  }

  const file = searchRoot ? findJavaFile(searchRoot, leaf) : null;
  if (!file) {
    // 响应 DTO 不可解析（外部依赖等）：仅记录类型路径
    return prefix.length > 0 ? `${prefix.join('.')}: ${leaf}` : leaf;
  }
  const { fields } = parseClassFields(readFileSync(file, 'utf-8'));
  if (fields.length === 0) {
    return prefix.length > 0 ? `${prefix.join('.')}: ${leaf}` : leaf;
  }
  const shown = fields.slice(0, OUTPUT_MAX_FIELDS)
    .map((f) => (f.description !== f.name ? `${f.name} ${f.description}` : f.name));
  const suffix = fields.length > OUTPUT_MAX_FIELDS ? ' / …' : '';
  const fieldList = shown.join(' / ') + suffix;
  return prefix.length > 0 ? `${prefix.join('.')}: ${fieldList}` : fieldList;
}
// ---------- controller parsing ----------

export function parseControllerSource(
  source: string,
  controllerDir: string = '',
  wrappers?: Record<string, WrapperDef>,
): ApiEndpoint[] {
  return withWrappers(wrappers, () => parseControllerSourceInner(source, controllerDir));
}

function parseControllerSourceInner(source: string, controllerDir: string = ''): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];
  const basePath = extractClassBasePath(source);
  const controllerName = extractControllerName(source);
  const classBodyStart = findClassBodyStart(source);
  const classBody = source.slice(classBodyStart);
  const searchRoot = controllerDir ? findProjectRoot(controllerDir) : controllerDir;

  const methodAnnotationPattern = /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)/g;

  let match;
  let prevEnd = 0;

  while ((match = methodAnnotationPattern.exec(classBody)) !== null) {
    const annotationType = match[1];
    const annotationBody = match[2];

    if (annotationType === 'RequestMapping' && !annotationBody.includes('method')) continue;

    const methodPath = extractMethodPath(annotationBody);
    const httpMethod = extractHttpMethod(annotationType, annotationBody);
    const betweenBlock = classBody.slice(prevEnd, match.index);
    // B-5: 描述窗口在方法声明处截断，避免越过方法体吃到下一方法的注解/注释
    let afterForDesc = classBody.slice(match.index + match[0].length, match.index + match[0].length + 300);
    const declCut = afterForDesc.search(/(?:public|private|protected)\s+\S/);
    if (declCut >= 0) afterForDesc = afterForDesc.slice(0, declCut);
    const description = extractDescription(afterForDesc) || extractDescription(betweenBlock);

    const afterAnnotation = classBody.slice(match.index + match[0].length, match.index + match[0].length + 800);
    const methodName = extractMethodName(afterAnnotation);
    const signature = extractMethodSignature(afterAnnotation);
    const { params, bodyJsonExample, queryParams, bodyFields, bodyDtoClass } = extractEndpointParams(signature, searchRoot);
    const returnType = extractReturnType(afterAnnotation);
    const outputFields = resolveOutputFields(returnType, searchRoot);

    const fullPath = normalizePath(basePath, methodPath);

    // B-4: 路径含未解析占位符时提示人工确认（每占位符只提示一次）
    for (const ph of fullPath.match(/\$\{[^}]*\}/g) || []) {
      if (!placeholderWarned.has(ph)) {
        placeholderWarned.add(ph);
        console.warn(`[anycli gen] 路径含未解析占位符 ${ph}（如 ${controllerName}.${methodName} → ${fullPath}），请人工确认实际前缀后再入库`);
      }
    }

    endpoints.push({ httpMethod, path: fullPath, description: description || methodName, methodName, controllerName, params, bodyJsonExample, queryParams, bodyFields, returnType, outputFields, bodyDtoClass });
    prevEnd = match.index + match[0].length;
  }

  return endpoints;
}

// B-4: ${xxx} 占位符保留原样（不再静默替换为 /api），由 warn 提示人工确认
const placeholderWarned = new Set<string>();

function normalizePath(basePath: string, methodPath: string): string {
  const base = basePath.replace(/\/+$/, '');
  const method = methodPath.replace(/^\/+/, '');
  if (!method) return base || '/';
  return `${base}/${method}`;
}

export function scanControllers(
  inputPath: string,
  wrappers?: Record<string, WrapperDef>,
): { filePath: string; endpoints: ApiEndpoint[] }[] {
  return withWrappers(wrappers, () => scanControllersInner(inputPath));
}

function scanControllersInner(inputPath: string): { filePath: string; endpoints: ApiEndpoint[] }[] {
  const results: { filePath: string; endpoints: ApiEndpoint[] }[] = [];
  if (!existsSync(inputPath)) return results;

  const stat = statSync(inputPath);
  if (stat.isFile()) {
    if (inputPath.endsWith('.java')) {
      const source = readFileSync(inputPath, 'utf-8');
      const endpoints = parseControllerSource(source, dirname(inputPath));
      if (endpoints.length > 0) results.push({ filePath: inputPath, endpoints });
    }
    return results;
  }

  const entries = readdirSync(inputPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(inputPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...scanControllers(fullPath));
    } else if (entry.name.endsWith('Controller.java')) {
      const source = readFileSync(fullPath, 'utf-8');
      const endpoints = parseControllerSource(source, dirname(fullPath));
      if (endpoints.length > 0) results.push({ filePath: fullPath, endpoints });
    }
  }

  return results;
}
