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

| 函数名 | 路由 | 说明 |
|---|---|---|
| `health` | `GET /api/health` | 存活探针，只回 `{"ok":true,"service":"yishou"}`。不连库、无业务逻辑 |

## 两个版本，按创建方式二选一

CloudBase 控制台有两条创建路径，云函数**入口写法不同**，所以这里备了两份：

| 文件 | 入口形态 | 用在哪 |
|---|---|---|
| `functions/health/index.web.js` | Web 函数：自己用 `http` 起服务、监听 9000 | ✅ **控制台「创建云函数 → 通过模板创建 → HTTP 云函数 → Node.js Hello World」走这条**（模板自带 `scf_bootstrap`，只换 `index.js`） |
| `functions/health/index.js` | 事件函数：`exports.main(event, context)`，返回 `{statusCode, headers, body}` | 若有「自定义 / 不使用模板创建」入口，或将来用 CLI 部署时走这条 |

> 两者**只保留一份在线上**即可，别同时挂两条路由。

## 部署步骤（控制台 · Web 函数路线）

1. 左侧 **云函数 / 托管** → **创建云函数** → 模板选 **HTTP 云函数 → Node.js Hello World**
2. 函数名称改 **`health`**（⚠️ 创建后不可改名） → 创建
3. 进 `health` → **函数代码** → 只替换 **`index.js`**（`scf_bootstrap`、`package.json` 保持模板原样）→ 粘贴 `functions/health/index.web.js` 全部内容 → **保存并部署**
4. 左侧 **HTTP 网关** → **路由管理** → **添加路由**：资源选云函数 `health`，路径填 `/api/health` → 确认
5. 等 3–5 分钟，浏览器打开：

```
https://yishou-d9gyoykka49fb0634-1501173044.ap-shanghai.app.tcloudbase.com/api/health
```

期望看到：`{"ok":true,"service":"yishou"}`

## 已知坑

- 默认域名 `*.app.tcloudbase.com` **浏览器直开会先弹安全提示中间页**，点「继续访问」才见内容 —— 正常现象，不是部署失败。
- 路由生效要等 3–5 分钟，别刚点完就断言失败。
- 事件版若返回被包了一层的 `{"statusCode":200,...}`，说明该环境按「透传」处理返回体 → 把 `return { statusCode, headers, body }` 改成直接 `return { ok: true, service: SERVICE }`。
- Web 函数版对 `/` 与 `/api/health` 都放行，是为了兜住「网关是否剥掉路径前缀」两种行为，不表示接口有两条。
