# gen 加固表征测试夹具

本目录是 `tests/java-parser.test.ts` 表征测试的**纯合成夹具**，全部类名、字段、
路径与描述均为虚构示例，不包含任何真实业务代码或内部资料。

## 构成

- `controllers/SampleOrderController.java` — 示例「样品单」业务 Controller（虚构）：
  类级 `${api.prefix}` 占位符、POST/GET 映射、`@ApiOperation`、
  `PageRequest<T>` 泛型请求、带/不带属性的 `@RequestParam`、`@ApiParam`、
  泛型返回类型（`PageInfo<T>` / `List<String>` / `BaseResult<String>` / `void`）等。
- `controllers/SyntheticCoverageController.java` — 解析面补齐：DELETE 映射、
  `@PathVariable`（带/不带 name）、`@PatchMapping`、类级/方法级多路径数组、
  `@RequestMapping(method=...)`、方法级 `${}` 占位符、
  `@RequestParam(required=false, defaultValue=...)`、OpenAPI3 `@Operation(summary)`。
- `controllers/JavadocOnlyController.java` — 无 Swagger 注解时的 Javadoc 描述回退
  （独立文件，避免跨方法注解窗口干扰）。
- `dto/` — Controller 直接/嵌套引用的请求 DTO 与 VO（含继承链、嵌套列表、枚举引用）。
- `enums/` — DTO 字段引用的枚举（样品状态、类型、平台等，均为虚构取值）。

## 说明

- `PageRequest`/`PageInfo` 为框架内置固定包装类，java-parser 内置 KNOWN_WRAPPERS
  按固定格式展开（data/list 字段），不需要源码；解析只处理其泛型实参。
- `Query`/`Command`/`ViewObject` 等父类来自外部依赖（无源码），
  恰好覆盖「父类找不到时跳过」的解析路径。

## 修改夹具的约束

- 本目录是解析器表征测试的唯一数据源：任何新增/删除 Controller、端点、
  DTO 字段或描述，都会反映到 `java-parser.test.ts` 的快照断言中。
- 改动夹具必须同步更新对应断言并重新生成快照（`npx vitest -u java-parser`），
  且快照 diff 应与改动逐条吻合。
- 保持纯合成：禁止将任何真实代码、公司名、个人名或内部路径引入本目录。
