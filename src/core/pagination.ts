export interface PaginationOptions {
  pageField?: string;
  sizeField?: string;
  pageSize?: number;
  maxPages?: number;
  listPath?: string;
  hasMorePath?: string;
}

const DEFAULT_OPTIONS: Required<PaginationOptions> = {
  pageField: 'pageNum',
  sizeField: 'pageSize',
  pageSize: 100,
  maxPages: 50,
  listPath: 'data.data.list',
  hasMorePath: '',
};

/**
 * 从嵌套对象中按 dot path 取值
 */
function getNestedValue(obj: unknown, path: string): unknown {
  return path.split('.').reduce((acc: unknown, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

/**
 * 设置嵌套对象中按 dot path 的值
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]] || typeof current[keys[i]] !== 'object') {
      current[keys[i]] = {};
    }
    current = current[keys[i]] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

/**
 * 分页聚合器：自动翻页合并结果
 */
export async function paginate<T = unknown>(
  requestFn: (body: Record<string, unknown>) => Promise<T>,
  bodyTemplate: Record<string, unknown>,
  options?: PaginationOptions,
): Promise<{ items: unknown[]; totalPages: number; totalItems: number }> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const allItems: unknown[] = [];
  let page = 1;

  while (page <= opts.maxPages) {
    const body = JSON.parse(JSON.stringify(bodyTemplate)) as Record<string, unknown>;
    setNestedValue(body, opts.pageField, page);
    setNestedValue(body, opts.sizeField, opts.pageSize);

    const response = await requestFn(body);
    const list = getNestedValue(response, opts.listPath);

    if (!Array.isArray(list) || list.length === 0) break;

    allItems.push(...list);

    if (list.length < opts.pageSize) break;
    page++;
  }

  return { items: allItems, totalPages: page, totalItems: allItems.length };
}
