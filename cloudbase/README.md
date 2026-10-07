# cloudbase/ — CloudBase 后端代码（Day 15 起）

> 这里放**云函数源码**，跟站点（`yizhi/`，纯前端）分开。
> 本目录**不进** GitHub Pages 发布（发布根目录是 `yizhi/`）。

## 环境信息（2026-10-06 建）

| 项 | 值 |
|---|---|
| 环境名称 | `yishou` |
| **环境 ID** | `yishou-d9gyoykka49fb0634` |
| 地域 | 上海（ap-shanghai） |
| 套餐 | 免费体验版（3000 资源点/月，不支持加购/按量） |
| 到期 | 2027-04-06 |
| 数据库类型 | **PostgreSQL**（创建时选定，不可切换） |
| **默认域名** | `yishou-d9gyoykka49fb0634-1501173044.ap-shanghai.app.tcloudbase.com` |

## 已有云函数

| 函数名 | 路由 | 认证 | 读什么 | 说明 |
|---|---|---|---|---|
| `health` | `GET /api/health` | 否 | 不连库 | 存活探针，只回 `{"ok":true,"service":"yishou"}`（Day 15） |
| `favorites` | `GET /api/favorites` | 是（临时 `user_id`） | `public.favorites` | 收藏列表读取，支持 `limit`/`offset`（Day 17） |
| `hot` | `GET /api/hot` | 否 | `public.favorites` 聚合 | 「收藏热门榜」：被收藏最多的条目 Top N（Day 17，口径见下） |

> **关于 `hot` 的名字**：清单里的「热搜」是打卡课程模板（打卡 App 示例）的说法。本项目（异兽志）没有外部热搜需求，
> Day 17 拍板把 `hot` 改口径为「**对现有 `favorites` 按 `entry_id` 聚合出的收藏榜**」——零建表、零外部数据源，读真库真行。

## 数据通路：为什么不是 `pg` 直连

Day 17 实测后的定案 —— **首选 CloudBase PG HTTP 网关，`pg` TCP 直连只作备选**：

| 通路 | 怎么走 | 代价 |
|---|---|---|
| ① **PG HTTP 网关**（默认） | `https://<envId>.api.tcloudbasegateway.com/v1/rdb/rest/<表>`，`Authorization: Bearer <环境 API Key>` | 零依赖（用内建 `fetch`）、**免 VPC/白名单**、免连接串；PostgREST 形态，**没有 GROUP BY**（`hot` 的聚合在函数里做） |
| ② `pg` TCP 直连（备选） | 配 `PG_URL` 时自动启用，`pg.Pool` + 参数化 SQL | 要装 `pg`、要连接串，按官方说法还要 **VPC + 白名单**（云函数不在库的白名单里就会 `ECONNREFUSED`） |

> 为什么换：控制台「连接信息」入口在本环境不可见，拿不到连接串；而 CloudBase 官方也把 TCP 列为「例外迁移路径」。
> 网关这条路一次就通（见下方验证记录）。两条路都留着，`PG_URL` 一配就自动切回 ②。

## 部署步骤（CloudBase CLI · 推荐 · `favorites` / `hot` · Day 17）

> 本机已装 `@cloudbase/cli`（3.8.5）且**登录态有效**（`tcb login` 会提示 `You are logged in`）。
> CLI 路径：`C:\Users\lxb07\.workbuddy\binaries\node\workspace\node_modules\.bin\tcb.cmd`

### 第 0 步：建一把环境 API Key（只做一次）

```bash
tcb env apikey create yishou-server -e yishou-d9gyoykka49fb0634 --type api_key --json
```

- `--type api_key` → 角色是 `service_role`（绕过 RLS，**只在服务端用，绝不放前端**）
- 返回里的 `ApiKey` 就是下文要用的**环境 API Key**
- 🔴 这把 Key **只填在函数环境变量里，不写进仓库、不进 Git**（AGENTS §五.3）

### 第 1 步：部署函数

⚠️ **必须 `cd` 进函数目录再执行** —— CLI 找 `scf_bootstrap` 看的是当前目录，`--dir` 只影响打包内容。

```bash
cd cloudbase/functions/favorites
tcb fn deploy favorites --httpFn --force -e yishou-d9gyoykka49fb0634 \
    --runtime Nodejs20.19 --install-dependency false
```

`hot` 同理（把两处 `favorites` 换成 `hot`）。三个文件缺一不可：

| 文件 | 作用 |
|---|---|
| `index.web.js` | Web 函数本体：自己起 `http` 服务、监听 9000 |
| `scf_bootstrap` | 平台启动脚本（`export PORT=9000; exec node index.web.js`）。**缺了 CLI 会报错并让你交互确认** |
| `package.json` | 声明 Node 工程。⚠️ **不要写 `main` 字段** —— 会被 CLI 误推断成入口 `index.web.main` |

### 第 2 步：配环境变量（密钥不进仓库的关键一步）

CLI 的 `fn deploy` 不带 `--env` 参数，环境变量走**管理接口**下发：

```bash
# 用 MCP 的 manageFunctions(action="updateFunctionConfig")：
{ "action": "updateFunctionConfig", "functionName": "favorites",
  "envVariables": { "TCB_ENV_ID": "yishou-d9gyoykka49fb0634", "TCB_API_KEY": "<第 0 步的 ApiKey>" },
  "timeout": 20 }
```

| 变量名 | 值 | 用途 |
|---|---|---|
| `TCB_API_KEY` | 第 0 步那把 ApiKey | 网关鉴权（**必填**） |
| `TCB_ENV_ID` | `yishou-d9gyoykka49fb0634` | 网关基址；不填时有默认值兜底 |
| `PG_URL` | 连接串（`postgresql://...`） | 可选：配了就走 `pg` 直连，不配走网关 |

### 第 3 步：挂路由

```bash
# 等价 MCP：manageGateway(action="createRoute", domain=…, path=…,
#                          upstreamResourceType="WEB_SCF", targetName="favorites")
```

| 上游 | 路径 | 类型 |
|---|---|---|
| 云函数 `favorites` | `/api/favorites` | `WEB_SCF` |
| 云函数 `hot` | `/api/hot` | `WEB_SCF` |

> ⚠️ HTTP 函数的类型是 **`WEB_SCF`**（不是 `SCF`）；控制台里对应的坑是「关联资源」默认选「云托管」，要手动切成「云函数」。
> 路由传播通常数秒~30 秒，别盲等 3–5 分钟。

## 验证记录（Day 17 实测，2026-10-07）

```bash
/tmp/favorites?user_id=11111111-1111-4111-8111-111111111111
→ 200 {"ok":true,"data":{"total":5,"items":[{"entry_id":"yishou-001","created_at":"2026-10-01T09:12:00Z"}, …]}}

/api/hot
→ 200 {"ok":true,"data":{"total":9,"items":[{"entry_id":"jingjie-003","fav_count":1}, …]}}
```

**「改一行数据、刷新后跟着变」**（完成标准第三条）：

| 步骤 | 结果 |
|---|---|
| `UPDATE public.favorites SET entry_id='yishou-002' WHERE id='f1a00001-…-000000000001'` | `rowCount: 1` |
| 立刻刷新 `/api/favorites?user_id=1111…` | 第一条变成 `"entry_id":"yishou-002"` ✅ |
| 再 `UPDATE … SET entry_id='yishou-001'`（复原） | 刷新后回到 `yishou-001` ✅ |

> 截图在 `tmp/day17-截图/`（`tmp/` 已 gitignore，作业证据不入库）。
> ⚠️ 无头浏览器画不出**地址栏** —— 交给老师的图请在真浏览器里点开上面两条链接再截。

## 备选部署路径（控制台 · Web 函数）

控制台路径同样可行，代码一字不用改：**创建云函数 → 模板 HTTP 云函数 → Node.js Hello World** →
「函数代码」替换 `index.js`（这里对应仓库里的 `index.web.js`，模板自带 `scf_bootstrap` 别动）→
「函数配置 / 环境变量」加上表里那两个变量 → 保存并部署 → HTTP 网关加路由（**关联资源切到「云函数」**）。

> 两条路径**只保留一份在线上**即可，别同一函数挂两条路由。

## 本机自测（不连数据库、不装依赖、不联网）

改完 `favorites` / `hot` 的逻辑，先在**本机**把纯逻辑 + 网关请求构造跑一遍再部署：

```
"C:\Users\lxb07\.workbuddy\binaries\node\versions\22.22.2-6\node.exe" cloudbase/tests/api-local-test.js
```

期望最后一行 `==== 44 / 44 通过 ====`。它验三层：
1. **纯逻辑**：路由、参数校验、排序、分页、错误码、JSON 形状（假查询者复刻 `db/seed.sql` 的 5 个用户 + 9 条收藏）
2. **聚合**：`hot` 的 `算榜单()` —— 票多在前、同票按 id 升序、limit 夹取
3. **网关通路**：用**假的 `fetch`** 捕获真实请求 URL —— 基址、`Prefer: count=exact` 解析、`order=created_at.asc,id.asc`、`user_id` URL 编码、`+08:00 → UTC Z` 时间归一化、401 错误码映射

**它不验「真连库通不通」** —— 那个只有部署后打公网地址才知道。

## 已知坑

- 默认域名 `*.app.tcloudbase.com` **浏览器直开会先弹「页面访问提示」中间页**（按钮带 1 秒倒计时、`disabled`），点「确定访问」才见内容 —— 正常现象，不是部署失败。
  ⚠️ **要交的截图必须点掉它**，否则图里是提示页而不是接口返回。无头 Edge 可以用 CDP 点 `#submitBtn` 绕过（`tail` 见 `tmp/` 里的截图脚本）。
- ⚠️ **`tcb fn deploy` 必须 `cd` 进函数目录执行**：CLI 找 `scf_bootstrap` 看的是**当前目录**，`--dir` 只决定打包什么。在仓库根跑会报「Web function requires scf_bootstrap startup file, not found in current directory」并转成交互提问。
- ⚠️ `package.json` 里**别写 `main`**：CLI 会据此猜入口（实测猜出 `index.web.main` 这种不存在的入口）。
- ⚠️ Node 22 及以后的运行时**不支持云端安装依赖**；本函数零依赖，部署时统一带 `--install-dependency false`。
- ⚠️ 改了代码**必须重新 `tcb fn deploy`**，否则线上还是旧逻辑（排错时最容易白查一轮的地方）。
- ⚠️ 首次请求有**冷启动**（可能几秒），别当挂死；接口已回 `cache-control: no-store`，刷新拿到的一定是新数据。
- ⚠️ 网关是 **PostgREST 形态，不支持 `GROUP BY` / `count()`**。`total` 靠 `Prefer: count=exact` 回的头 `content-range: 0-0/5` 取尾段；`hot` 的聚合拉回 `entry_id` 列表（上限 5000 行）在函数里算 —— 收藏量上万后要改 PG 视图或 RPC（契约 §3.11 已记账）。
- ⚠️ 网关回的时间是 `"2026-10-01T17:12:00+08:00"`（带时区偏移），契约要的是 `"2026-10-01T09:12:00Z"` → 函数里统一 `new Date(x).toISOString()` 后**去掉毫秒**。
- ⚠️ 两个函数都做「前缀是否被剥掉」的兜底，所以各自只会处理自己的路径；`favorites` 收到 `/api/hot` 会回 404（本机自测里有这条）。
- ⚠️ `updateFunctionConfig` 下发环境变量后**不需要重新部署代码**，配置变更即时生效；但**改了 `index.web.js` 就必须重新 deploy**。
