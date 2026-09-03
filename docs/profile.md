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
      "gatewayUrl": "https://gateway.example.com",
      "loginUrl": "https://login.example.com",
      "sessionId": "xxx",
      "auth": {
        "type": "session-id",
        "refreshUrl": "https://gateway.example.com/refresh",
        "refreshIntervalMs": 28800000,
        "extraHeaders": { "x-tenant-id": "demo-service" }
      },
      "projects": {
        "demo": {
          "baseUrl": "https://gateway.example.com",
          "prefix": "demo-service",
          "auth": {
            "extraHeaders": {
              "x-tenant-id": "demo-service",
              "x-ext-tenant-id": "demo-service"
            }
          }
        }
      }
    }
  }
}
```

## 认证

整个 CLI **一套授权方式**（session-id / bearer-token），跟随 Profile（环境）配置，不按项目细分。每次请求自动携带：

| Header | 说明 | 来源 |
|--------|------|------|
| `x-session-id` 或 `Authorization: Bearer` | 认证头（按 Profile 授权方式注入） | `Profile.auth` |
| `x-tenant-id` / `x-ext-tenant-id` | 项目租户标识（自定义静态头） | 项目 `auth.extraHeaders` |

```bash
anycli auth login                     # 选择授权方式并浏览器授权（保存到当前 Profile）
anycli auth login --type bearer-token # 指定授权方式
anycli --profile test-main auth login # 登录到指定 Profile
anycli auth token                     # 交互输入 bearer-token（Profile 级）
anycli auth status                    # 检查状态
anycli auth set-session <id>          # CI/CD 用（session-id）
```

## 环境

| 环境 | 网关地址 |
|------|----------|
| test | https://test-gateway.example.com |
| prod | https://gateway.example.com |

## 凭证定时自动刷新（保活）

为了避免凭证（sessionId / token）过期导致需重新登录，CLI 提供基于系统定时任务的后台刷新机制。**刷新接口地址与间隔均由用户配置**（`Profile.auth.refreshUrl` / `refreshIntervalMs`），不配置则不自动刷新；刷新接口返回体约定 `{ success, data: { sessionId | token } }`。

### 使用与管理

在成功执行 `anycli auth login` 登录后，系统会交互式询问是否开启自动刷新，并引导填写刷新接口地址与间隔。也可手动配置与维护：

```bash
# 配置刷新接口与间隔
anycli config set auth.refresh-url <url>
anycli config set auth.refresh-interval 28800000   # 8 小时（毫秒）

# 安装定时任务（自动检测当前 OS：Windows 计划任务 / macOS & Linux crontab）
anycli auth scheduler install
anycli auth scheduler uninstall

# 手动执行一次静默刷新（通常供定时任务调用）
anycli auth refresh --silent
```

