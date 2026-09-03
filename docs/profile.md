# 多 Profile 管理

每个 Profile 独立持有 env、sessionId、projects 配置，互不干扰。适合同时操作 test/prod、多租户场景。

## 基本操作

```bash
# 创建 Profile
anycli config profile create prod-main --env prod
anycli config profile create test-main --env test
anycli config profile create prod-b --clone prod-main   # 克隆（不继承 session）

# 切换
anycli config use test-main

# 一次性指定（不影响活跃 Profile）
anycli --profile prod-main request demo POST /api/order/listForEsPage --body '{}'

# 查看
anycli config profile list           # 所有 Profile（* 标记活跃）
anycli config profile show test-main # 详情
anycli config profile delete old-one # 删除
```

## 解析优先级

`--profile` 参数 > `ANYCLI_PROFILE` 环境变量 > `activeProfile` 配置

## 配置文件

`~/.anycli/config.json`：

```json
{
  "activeProfile": "default",
  "defaultFormat": "json",
  "profiles": {
    "default": {
      "env": "prod",
      "sessionId": "xxx",
      "projects": {
        "demo": {
          "baseUrl": "https://gateway.example.com",
          "prefix": "demo-service",
          "tenantId": "demo-service",
          "extTenantId": "demo-service"
        }
      }
    }
  }
}
```

## 认证

每个请求自动携带：

| Header | 说明 |
|--------|------|
| `x-session-id` | 登录会话（按 Profile 隔离） |
| `x-tenant-id` | 项目标识 |
| `x-ext-tenant-id` | 扩展租户 |

```bash
anycli auth login                    # 浏览器登录（保存到当前 Profile）
anycli --profile test-main auth login  # 登录到指定 Profile
anycli auth status                   # 检查状态
anycli auth set-session <id>         # CI/CD 用
```

## 环境

| 环境 | 网关地址 |
|------|----------|
| test | https://test-gateway.example.com |
| prod | https://gateway.example.com |

## SessionId 定时自动刷新（保活）

为了避免 `sessionId` 在 12 小时后彻底失效导致用户必须重新扫码登录，CLI 提供了基于系统定时任务的后台刷新机制。只要当前的 `sessionId` 依然处于有效期内，定时任务每 8 小时会在后台自动调用刷新接口换取新 Token 并静默写入配置文件。

### 使用与管理

在成功执行 `anycli auth login` 登录后，系统会交互式询问是否开启自动刷新服务（选择 `y` 即可一步到位）。您也可以通过以下命令手动维护：

```bash
# 安装每 8 小时自动刷新 SessionId 的定时任务
# 自动检测当前 OS（Windows 计划任务 / macOS & Linux crontab），动态定位 CLI 运行脚本，不写死目录
anycli auth scheduler install

# 卸载已安装的自动刷新定时任务
anycli auth scheduler uninstall

# 手动执行一次静默刷新（通常供定时任务调用）
anycli auth refresh --silent
```

