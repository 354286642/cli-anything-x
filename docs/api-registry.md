# 接口注册表

接口注册表是所有业务接口的**单一数据源**（Single Source of Truth）。SKILL.md 中的接口清单、flow 的接地校验、技能总览页等产物均从注册表生成，确保一致性。

## 目录结构

```
apis/
├── schema.json                    # JSON Schema，校验所有注册表文件
├── demo/
│   ├── order.json                # 订单模块（3 个接口）
│   ├── launch.json                # 投放计划模块（2 个接口）
│   ├── effect.json                # 效果数据模块（2 个接口）
│   └── _shared/
│       └── platform-enums.json    # 平台枚举（跨模块共享）
└── cli-anything-x/                  # 未来新项目
    └── ...
```

## 模块文件结构

每个 `apis/{project}/{module}.json` 遵循 `schema.json` 定义：

```json
{
  "module": "demo-order",
  "version": "1.0.0",
  "description": "Demo 订单管理模块。订单搜索、订单详情、订单选择。",
  "triggers": ["订单", "搜索订单", "order"],
  "enumRefs": ["platform-enums"],
  "apis": [ ... ],
  "customSections": [ ... ]
}
```

| 字段 | 说明 |
|------|------|
| `module` | 模块逻辑 id（`{项目}-{模块}`），不随目录变化 |
| `version` | 模块版本号（semver），接口变更时 bump |
| `triggers` | 触发词，用于 Agent 路由 |
| `enumRefs` | 引用的共享枚举文件名（`_shared/` 下，不含 `.json`） |
| `apis` | 接口数组（见下） |
| `customSections` | 人工补充的自由区（常见场景、错误处理等），生成器原样输出 |

## 单条接口 Schema

```json
{
  "id": "order-list-page",
  "summary": "订单搜索（订单广场 ES 搜索）",
  "method": "POST",
  "path": "/api/order/listForEsPage",
  "level": "read",
  "deprecated": false,
  "version": "1.0.0",
  "source": {
    "controller": "com.example.sample.order.web.SampleOrderController",
    "method": "listForEsPage",
    "line": 86
  },
  "bodyParams": [
    { "name": "pageNum", "type": "int", "required": true, "desc": "页码" }
  ],
  "bodyTemplate": { "pageNum": 1, "pageSize": 20, "data": {} },
  "enumRefs": ["platform"],
  "notes": "列表接口粉丝数字段为 fansNum，详情接口为 fansNums",
  "outputFields": "data.data.list[]：accountName / orderPlatformId / fansNum",
  "examples": [
    { "title": "抖音美妆订单", "command": "anycli request demo POST ..." }
  ]
}
```

### 关键字段说明

| 字段 | 机器/人工 | 说明 |
|------|-----------|------|
| `id` | 机器 | 稳定逻辑 id，flow apiRef 引用此值（不用 path） |
| `method` / `path` | 机器 | 后端变更时由 sync 更新 |
| `level` | 人工 | 操作分级：`read` / `write` / `dangerous` |
| `source` | 机器 | 溯源到 Controller 方法行号 |
| `bodyTemplate` | 机器 | 结构化对象，生成器序列化为 JSON 示例 |
| `notes` | 人工 | 坑/注意事项，合并时不被覆盖 |
| `examples` | 人工 | 调用示例，合并时不被覆盖 |
| `outputFields` | 人工 | 输出关键字段说明 |

## 共享枚举

放在 `apis/{project}/_shared/` 下，模块通过 `enumRefs` 引用：

```json
{
  "name": "platform",
  "description": "平台枚举（platform / platformList 取值）",
  "values": [
    { "value": "DOU_YIN", "label": "抖音" },
    { "value": "XIAO_HONG_SHU", "label": "小红书" }
  ]
}
```

## 命令

```bash
# 校验所有注册表格式
anycli skill validate

# 校验指定项目
anycli skill validate demo

# 从注册表生成 SKILL.md（见 skill-build 文档）
anycli skill build demo order
```

## 合并策略

`anycli gen` 或未来的 `anycli sync` 写入注册表时：

- **新接口**：全量写入
- **已存在接口**：只更新机器字段（method/path/params/bodyTemplate/source），不覆盖人工字段（notes/examples/outputFields/level）
- **删除接口**：标记 `deprecated: true`，不直接删除（可能有 flow 引用）

## 与 flow 的关系

flow.json 中 step 的 `apiRef` / `apiRefs` 可以引用：
1. flow 内部 `apis[]` 定义的 id（如 `api-1`）
2. 注册表中的接口 id（如 `order-list-page`）
3. 带模块前缀的 id（如 `demo-order.order-list-page`）

编译时接地校验会检查所有引用是否可解析，见 [flow.md](./flow.md#接地校验)。
