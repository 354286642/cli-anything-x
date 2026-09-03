# 代码生成（anycli gen）

从 Java Controller 源码自动解析接口，写入注册表并生成 SKILL.md。

## 使用

```bash
anycli gen                          # 交互式：选项目/模块 → 扫描 → 勾选入库
anycli gen --dry-run <project> <module> <controllerPath>   # 预览 diff，不写文件
anycli gen --sync <project> <module> <controllerPath>      # 漂移检测 + 更新溯源信息
```

## 完整流程

```
anycli gen
  ├─ 选择项目（demo / cli-anything-x / ...）
  ├─ 选择子模块（已有模块 或 ➕ 新增子模块）
  │   └─ 新增：输入名称、描述 → 自动创建目录 + SKILL.md
  ├─ 输入 Java Controller 路径（目录或单个 .java 文件）
  ├─ 自动解析接口
  │   ├─ HTTP 方法、路径、描述（@ApiOperation / @Operation）
  │   ├─ PageRequest<T> / PageInfo<T> 内置固定模板（公司固定包装类，只解析泛型实参 data/list）
  │   ├─ 递归解析 DTO 字段（含继承、嵌套、@ApiModelProperty、校验注解定 required）
  │   ├─ 解析方法返回类型 → outputFields（激活 chain 自动推断）
  │   ├─ 采集请求 DTO 引用的枚举 → apis/{project}/_shared/{enum}.json
  │   └─ 生成带注释的 JSON 请求体示例
  ├─ 预览接口表格 → 空格多选（已有接口可覆盖）
  ├─ 确认 → 写入注册表（含溯源 source.path）+ 生成 SKILL.md
  ├─ 更新 anycli 路由表
  ├─ CRUD 组合检测（list+create 提示 anycli flow from-chain）
  └─ 安装 Skill 到 ~/.agents/skills/（推荐）
```

> 纯注册表模式不产生 TS 命令，收尾不再执行 `npm run build`（F-5）。

## Java 解析能力

`src/core/java-parser.ts` 支持：

| 注解 | 解析内容 |
|------|---------|
| `@RequestMapping` | 类级别基础路径 |
| `@GetMapping` / `@PostMapping` / `@PutMapping` / `@DeleteMapping` | HTTP 方法 + 路径 |
| `@ApiOperation(value = "...")` | 接口描述 |
| `@Operation(summary = "...")` | 接口描述（OpenAPI 3） |
| `@RequestBody` | 请求体参数（DTO 字段级展开） |
| `@RequestParam` | 查询参数（含 required / defaultValue） |
| `@PathVariable` | 路径参数 |
| `@ApiModelProperty` | 字段描述 |
| Javadoc `/** ... */` | 兜底描述 |

DTO 解析：
- 递归展开嵌套对象（深度 ≤3）
- 支持继承（extends，合并祖父/父类字段）
- `PageRequest<T>` / `PageInfo<T>` 为公司固定包装类：**内置写死**，不读源码，
  解析只处理泛型实参（PageRequest → `data`，PageInfo → `list`）
- 校验注解（@NotBlank/@NotNull/@NotEmpty）决定字段 required
- 生成带注释的 JSON 示例

返回类型解析（F-1）：
- `Result<T>` / `BaseResult<T>` → `data`，`PageInfo<T>` → `list[]`，`List<T>` → `[]`
- 响应 DTO 字段展开为 `outputFields` 摘要（与人工注册表风格一致），激活 `chains` 自动推断

枚举采集（F-2）：
- 请求 DTO 类图（含继承/泛型/嵌套）引用的 Java enum 自动解析为
  `apis/{project}/_shared/{enum}.json`（常量名 + 中文含义），并在注册表挂 `enumRefs`

## 项目级 gen 配置（F-3）

可选 `apis/{project}/gen.json`，扩展/覆盖包装类定义（缺省用内置 PageRequest/PageInfo）：

```json
{
  "wrappers": {
    "MyPageRequest": {
      "dataField": "data",
      "dataIsList": false,
      "fields": [
        { "name": "current", "type": "int", "desc": "当前页码", "defaultVal": "1" },
        { "name": "size", "type": "int", "desc": "每页大小", "defaultVal": "10" }
      ]
    }
  }
}
```

## 溯源与增量同步（F-4）

- `anycli gen` 入库时记录端点 `source.path`（Controller 相对路径）、
  注册表 `sourceFiles`（文件级 sha256）与 `lastSyncedAt`
- `anycli gen --dry-run <project> <module> <controllerPath>`：
  预览代码 ↔ 注册表 diff（新增 / 疑似下线 / 签名变化 / 文件 hash 变化），不写文件
- `anycli gen --sync <project> <module> <controllerPath>`：
  输出同样的漂移报告，并更新注册表溯源信息（不自动改接口条目；
  疑似下线接口需人工确认后在交互式 gen 或注册表中处理）

## 与注册表的关系

`anycli gen` 解析完成后：
1. 将接口写入 `apis/{project}/{module}.json`（合并策略：新接口全量写入，已有接口只更新机器字段）
2. 自动执行 `anycli skill build` 生成 SKILL.md
3. 更新路由表和技能总览页

## 新增项目（手动方式）

对于不需要 Java 解析的场景：

1. 创建 `apis/{project}/{module}.json`（参考 schema.json）
2. 执行 `anycli skill build {project}`
3. 执行 `anycli skill install`

CLI 会通过自动发现机制识别新项目，无需修改任何 TS 代码。
