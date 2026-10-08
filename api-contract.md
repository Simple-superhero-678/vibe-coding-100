# API 契约（api-contract.md）

> **状态：Day 17 —— 第一个读接口已上线（`GET /api/favorites` + `GET /api/hot`）。**
> 这份文件是**第 3 周（Day 16 起）建表与写接口的唯一依据**，接口形状以此为准，实现见各自的 Day。
> 已完成：`GET /api/health`（Day 15）· `users` / `favorites` 两张表 + 种子数据（Day 16，脚本在 `db/`）· `GET /api/favorites`、`GET /api/hot`（Day 17，代码在 `cloudbase/functions/`）。
> ⚠️ **表结构的唯一真源是本文件 §2**。改表的顺序：**先改这里 → 再改 `db/schema.sql` → 再到控制台执行**，否则契约与数据库会漂移。
> ⚠️ **Day 17 的临时口径**：`/api/favorites` 的认证用 `?user_id=<uuid>` 顶替 token（见 §1 与 §3.5），Day 18 接上 `/api/auth/session` 后**必须删掉**。

---

## 0. 现状速览

| 项 | 值 |
|---|---|
| 前端站点 | 纯静态原生站（ES Module + JSON + localStorage），无构建步骤，无后端 |
| 前端在线地址 | `https://yishou-d9gyoykka49fb0634-1501173044.tcloudbaseapp.com/cbsite/`（CloudBase 静态托管） |
| 接口基址（Base URL） | `https://yishou-d9gyoykka49fb0634-1501173044.ap-shanghai.app.tcloudbase.com`（CloudBase HTTP 网关） |
| 环境 ID | `yishou-d9gyoykka49fb0634` |
| 后端形态 | **B2 · 云函数 + 云数据库**（Day 16 定案，见 §5） |
| 数据库 | CloudBase **PostgreSQL**（「SQL 型数据库」，schema `public`） |
| 已建数据表 | `users` / `favorites`（Day 16；脚本 `db/schema.sql` + `db/seed.sql`，步骤见 `db/README.md`） |
| 已实现接口 | `GET /api/health`（Day 15）· `GET /api/favorites`、`GET /api/hot`（Day 17）· **`POST /api/favorites`（Day 18）** |
| 未处理 | ⚠️ **RLS 未配**（CloudBase PG 的 `public` schema 可被 PostgREST 访问，权限需靠 RLS 兜住）· ⚠️ **跨域**：Day 17 已在函数侧回 `access-control-allow-origin`，网关侧「跨域设置」仍待配（前端接入时确认） |

页面需要后端的原因只有一个：**收藏现在只存在浏览器本地（localStorage），换设备就没了**。除此之外的读取（五部 JSON）都是静态文件，不需要接口。

---

## 1. 通用约定（所有接口都遵守）

- **前缀**：一律 `/api`。
- **编码**：`Content-Type: application/json; charset=utf-8`，不用 form-data。
- **认证**：登录成功后拿到 token，之后每个请求带
  `Authorization: Bearer <token>`。
  未带 token 的请求按「未登录」处理（只有 `/api/health` 和 `/api/auth/*` 允许匿名）。
  - 🔴 **临时口径：`?user_id=<uuid>` 顶替 token**（Day 17 立 · Day 18 的 `POST /api/favorites` 沿用）。
    `/api/auth/session` 还没实现，**没有任何地方能签发真 token**，为了让读/写接口能在浏览器地址栏里直接验证，
    `/api/favorites`（读与写都算）允许用 `?user_id=<uuid>` 顶替 token（请求头 `Authorization: Bearer <uuid>` 同样认）。
    这不是设计，是**欠账**：**待 `POST /api/auth/session` 落地后删掉这一段**，恢复成「只认真 token」
    （原定「Day 18 删」，Day 18 当天决定改用 `POST /api/favorites` 而不是 `auth/session`，故顺延）。
- **字段命名**：响应与请求体一律 **`snake_case`**，与数据库字段同名（少一层映射，排错更快）。
- **时间**：ISO 8601 UTC 字符串，如 `2026-10-06T16:00:00Z`。由服务端生成，前端不传。
- **成功响应**：**一定**带 `"ok": true`。

  ```json
  { "ok": true, "data": {} }
  ```

- **错误响应**（统一形状，前端只认这一种）：

  ```json
  {
    "ok": false,
    "error": {
      "code": "FAV_DUPLICATE",
      "message": "该条目已在收藏中"
    }
  }
  ```

  | HTTP | `code` | 含义 | 前端应做什么 |
  |---|---|---|---|
  | 400 | `BAD_REQUEST` | 参数缺失 / 类型不对 | 提示「请求有误」，不改本地状态 |
  | 401 | `UNAUTHORIZED` | 没带 token / token 过期 | 回落到本地收藏，引导登录 |
  | 404 | `FAV_NOT_FOUND` | 要取消的收藏不存在 | **静默成功**（本地也删掉，幂等） |
  | 409 | `FAV_DUPLICATE` | 重复收藏同一条 | **按成功处理**（幂等，不报错给用户） |
  | 429 | `RATE_LIMITED` | 请求过密 | 提示稍后再试 |
  | 500 | `INTERNAL` | 服务端出错 | 提示「读取失败」+ 重试入口（**这是「错」，不是「空」**） |

- **「空」与「错」必须分开**（沿用站点既有口径）：
  - 空 = 请求成功但列表为空 → 显示空态 + 出路（去逛条目）。
  - 错 = 请求失败 → 显示失败态 + 重试 + 原因。
  - **禁止**把「请求失败」显示成「你还没收藏」。

---

## 2. 数据表（Day 16 已建 · 建表脚本 `db/schema.sql`）

字段定义与理由见 `TECH_DESIGN-后端预备方案.md` §4，这里只列接口要用到的部分。

👉 **本节的表结构＝数据库里的实际结构（Day 16 已对齐）**。建表脚本、种子数据、控制台执行与验证步骤见 `db/README.md`。

### 2.1 `users` — 用户

| 字段 | 类型 | 默认 / 约束 | 说明 |
|---|---|---|---|
| `id` | uuid | 主键，`DEFAULT gen_random_uuid()` | 平台生成 |
| `provider` | text | `NOT NULL` + 非空白 CHECK | 登录来源，如 `github` / `anonymous` |
| `provider_uid` | text | `NOT NULL` + 非空白 CHECK | 第三方的唯一 id |
| `nickname` | text | 可空 | 界面显示用 |
| `created_at` | timestamptz | `NOT NULL DEFAULT now()` | 首次登录时间 |

**约束**：`UNIQUE (provider, provider_uid)` —— 同一个人重复登录不建第二行（Day 16 加，v0.1 未写）。
**索引**：无额外索引（主键 + 上面这个唯一约束已够）。
**不存**：密码、手机号、邮箱、真实姓名。一个都不存。

### 2.2 `favorites` — 收藏（核心表）

| 字段 | 类型 | 默认 / 约束 | 说明 |
|---|---|---|---|
| `id` | uuid | 主键，`DEFAULT gen_random_uuid()` | 行主键 |
| `user_id` | uuid | `NOT NULL`，外键 → `users.id`，`ON DELETE CASCADE` | 谁的收藏 |
| `entry_id` | text | `NOT NULL`，长度 1–64 且非空白 | 条目 id（如 `yishou-001`），**与 `data/*.json` 里的 `id` 完全一致** |
| `created_at` | timestamptz | `NOT NULL DEFAULT now()` | 收藏时间，列表按它排序 |

- **唯一约束**：`UNIQUE (user_id, entry_id)` —— 防重复收藏。⚠️ 这不只是「防手滑」：它是 `409 FAV_DUPLICATE` 的**数据层保证**，光靠云函数写 `if (已收藏)` 在并发下会双插。
- **索引**：⚠️ **不单独建 `user_id` 索引**（v0.1 原写「给 `user_id` 建索引」，Day 16 修正）—— 上面的唯一约束已生成一个**以 `user_id` 为前导列**的索引，「按 `user_id` 查」直接命中；再建单列索引是纯冗余（白占空间、拖慢写入）。
- **删除行为**：`ON DELETE CASCADE` —— 注销用户时数据库自动删掉他的全部收藏（§3.4 要的行为），不用云函数写两条删语句、也就不会漏删留脏数据。
- ⚠️ `entry_id` **不建外键**：条目不在数据库里（真源是 `data/*.json`）。后果是可能指向已删除的条目 → **接口不做校验**，前端显示「此条已下架」并允许移除（`TECH_DESIGN.md` §12.4 已有该态）。

### 2.3 `events` — 浏览/搜索埋点（**可选，今天不建**）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | bigserial | 自增主键 |
| `user_id` | uuid / 可空 | 未登录为空 |
| `event_type` | text | `search` / `open` / `filter` / `export` |
| `payload` | jsonb | 搜索词、条目 id、筛选条件 |
| `created_at` | timestamptz | 时间 |

### 2.4 `entries` — 条目后端化（**可选，今天不建**）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | text / 主键 | `yishou-001` |
| `bu` | text | 部 |
| `data` | jsonb | 除 id 外全部字段原样存 |
| `updated_at` | timestamptz | 最后修改时间 |
| `updated_by` | uuid → `users.id` | 谁改的 |

> 只有真要「在网页上改条目」时才建。建了就必须定死唯一真源（推荐：数据库为准，定期导出回 JSON 提交 git）。

---

## 3. 接口清单

| 路径 | 方法 | 用途 | 认证 | 状态 |
|---|---|---|---|---|
| `/api/health` | GET | 存活探测 | 否 | ✅ **Day 15 已实现** |
| `/api/auth/session` | POST | 用第三方凭证换 token | 否 | 占位 |
| `/api/me` | GET | 读当前用户 | 是 | 占位 |
| `/api/me` | DELETE | 注销（连带删收藏） | 是 | 占位 |
| **`/api/favorites`** | **GET** | **收藏列表读取（列表读取接口）** | 是（Day 17 临时 `user_id`） | ✅ **Day 17 已实现** |
| **`/api/hot`** | **GET** | **收藏热门榜（Day 17 新增）** | 否 | ✅ **Day 17 已实现** |
| **`/api/favorites`** | **POST** | **新增一条收藏（写入接口）** | 是（Day 17 临时 `user_id`） | ✅ **Day 18 已实现** |
| `/api/favorites/{entry_id}` | DELETE | 取消一条收藏 | 是 | 占位（第 4 周） |
| `/api/favorites/sync` | PUT | 批量覆盖（本地收藏迁到账号） | 是 | 占位 |
| `/api/events` | POST | 埋点（可选） | 否 | 占位 |
| `/api/entries` | GET | 条目列表读取（可选） | 否 | 占位 |

---

### 3.1 `GET /api/health` ✅ 已实现

- **认证**：否
- **请求参数**：无
- **响应 200**：

  ```json
  { "ok": true, "service": "yishou" }
  ```

- **实测地址**：`https://yishou-d9gyoykka49fb0634-1501173044.ap-shanghai.app.tcloudbase.com/api/health`
- **说明**：本契约里唯一不需要 `data` 包裹的接口（它只是存活探测）。其余接口一律 `{ok, data}`。

---

### 3.2 `POST /api/auth/session` — 登录 / 换 token

- **认证**：否（这是拿 token 的地方）
- **请求体**：

  ```json
  { "provider": "github", "provider_token": "<第三方返回的凭证>" }
  ```

  匿名体验也可支持：`{ "provider": "anonymous" }`
- **响应 200**：

  ```json
  {
    "ok": true,
    "data": {
      "token": "eyJhbGciOi...",
      "expires_at": "2026-11-05T16:00:00Z",
      "user": { "id": "uuid", "nickname": "爱飞的驴肉", "provider": "github" }
    }
  }
  ```

- **错误**：`401 UNAUTHORIZED`（第三方凭证无效）
- **前端在哪用**：首次进站点或点「登录」时；token 存哪由 `store.js` 决定（建议与收藏同层管理）。

---

### 3.3 `GET /api/me` — 读当前用户

- **认证**：是
- **请求参数**：无
- **响应 200**：

  ```json
  {
    "ok": true,
    "data": { "id": "uuid", "nickname": "爱飞的驴肉", "provider": "github", "created_at": "2026-09-01T02:11:00Z" }
  }
  ```

- **错误**：`401 UNAUTHORIZED`
- **前端在哪用**：判断「现在是登录态还是游客态」，决定收藏从服务端读还是本地读。

---

### 3.4 `DELETE /api/me` — 注销

- **认证**：是
- **请求体**：

  ```json
  { "confirm": true }
  ```

- **响应 200**：`{ "ok": true, "data": { "deleted": true } }`
- **副作用**：连带删除该用户全部 `favorites` 行（`users` + `favorites` 一起走）。
- **错误**：`400 BAD_REQUEST`（没传 `confirm`）、`401 UNAUTHORIZED`
- **前端在哪用**：设置区的「注销并清除云端数据」。**要二次确认**。

---

### 3.5 `GET /api/favorites` — 收藏列表读取（列表读取接口）✅ 已实现（Day 17）

- **代码**：`cloudbase/functions/favorites/index.web.js`（Web 函数版）；部署与验证见 `cloudbase/README.md`
- **认证**：是（🔴 Day 17 临时：无 token 时认 `?user_id=<uuid>`，见 §1）
- **请求参数**（query，都可选）：

  | 参数 | 类型 | 默认 | 说明 |
  |---|---|---|---|
  | `bu` | text | 无 | 按部过滤：`神仙`/`神话`/`异兽`/`妖怪`/`境界`。**服务端不认部名 → 忽略该参数**（部归属由前端按本地 JSON 判断，见备注） |
  | `limit` | int | 200 | 上限，最大 500 |
  | `offset` | int | 0 | 偏移 |

- **响应 200**：

  ```json
  {
    "ok": true,
    "data": {
      "total": 3,
      "items": [
        { "entry_id": "yishou-001", "created_at": "2026-10-01T09:12:00Z" },
        { "entry_id": "shenxian-004", "created_at": "2026-10-02T11:30:00Z" },
        { "entry_id": "yaoguai-007", "created_at": "2026-10-03T20:05:00Z" }
      ]
    }
  }
  ```

- **排序**：`created_at` **升序**（旧的在前面）—— 与现前端 `store.list()` 的语义一致，迁移时不用改视图。
  - ⚠️ **实现补了一条**：`ORDER BY created_at ASC, id ASC`。`created_at` **不是唯一键**（同一秒批量写入会撞在一起），
    只按它排会让分页出现「同一行重复出现 / 某行被跳过」。契约原文只写了 `created_at`，Day 17 实现时补了 `id` 兜底。
- **`created_at` 的字符串形态**：一律归一化成 `2026-10-01T09:12:00Z`（**不带毫秒**），与本节示例一字不差。
  - 走 **PG HTTP 网关**（默认通路）时，网关回的是带偏移的 `2026-10-01T17:12:00+08:00` → 函数里 `new Date(x).toISOString()` 再去掉毫秒。
  - 走 **`pg` 直连**（配了 `PG_URL` 时的备选通路）时，在 SQL 里用 `to_char(... AT TIME ZONE 'UTC', …)` 直接产出，避免驱动把 `timestamptz` 转成 JS Date 后多出 `.000`（Day 17 实测发现）。
- **`total` 在表里没有对应列**：网关通路靠 `Prefer: count=exact` 的响应头 `content-range: 0-0/5` 取尾段；
  `pg` 通路靠 `SELECT count(*)::int …` —— 这是「契约里的一项在表里找不到对应列」的实例。
- **数据通路（Day 17 定案）**：优先 CloudBase PG HTTP 网关（PostgREST 形态，免依赖免 VPC），`PG_URL` 配了则自动切回 `pg` TCP 直连。**响应形状与本节完全一致，通路不影响契约。**
- ⚠️ **只返回 id 与时间，不返回条目内容**：条目真源仍是 `data/*.json`，前端拿 id 去现读现用（与 `store.js` 的设计一致，避免同一份内容两个真源）。
- **条目已不存在**（JSON 里删了）：接口**照常返回该 id**，前端显示「此条已下架」并可移除。
- **✅ 线上地址（Day 17 部署并实测通过）**：
  `https://yishou-d9gyoykka49fb0634-1501173044.ap-shanghai.app.tcloudbase.com/api/favorites?user_id=<uuid>`
  → 实测 `{"ok":true,"data":{"total":5,"items":[{"entry_id":"yishou-001","created_at":"2026-10-01T09:12:00Z"}, …]}}`；
  改一行库数据后刷新，第一条随之变成 `yishou-002`。
- **错误**：`400 BAD_REQUEST`（`limit` 非整数 / `user_id` 非 uuid）、`401 UNAUTHORIZED`（没带身份）、`405 METHOD_NOT_ALLOWED`（Day 17 补登：非 GET 时返回，§1 错误表里原先没有这一码）、`429`、`500 INTERNAL`
- **前端在哪用**：`store.js` 的 `list()`；收藏面板 `#/藏` 的铺数据。

---

### 3.6 `POST /api/favorites` — 新增一条收藏 ✅ 已实现（Day 18）

- **认证**：是（Day 18 沿用 Day 17 临时口径，见 §1）
- **请求体**：

  ```json
  { "entry_id": "yishou-001" }
  ```

- **请求校验**（一律先校验、后落库；错误信息**必须用中文说清「缺了什么 / 哪里不对」**）：
  `entry_id` 缺失、非字符串、纯空白、超过 64 字符 → **`400 BAD_REQUEST`**；请求体不是合法 JSON → 同样 `400`。
  例：`缺少必填字段：entry_id（条目 id，例如 yishou-001）` / `entry_id 最长 64 个字符，收到 65 个`
- **响应 201**：

  ```json
  { "ok": true, "data": { "entry_id": "yishou-001", "created_at": "2026-10-06T16:00:00Z" } }
  ```

  `created_at` 由**服务端**生成，形态与 §3.5 一致（ISO 8601 UTC、无毫秒、以 `Z` 结尾）；请求体里传了也会被忽略。
- **幂等约定**：重复收藏返回 **`409 FAV_DUPLICATE`**，但**前端必须当成功处理**（`toggle` 是幂等的，用户连点两下不该看到报错）。
  🔒 **防重复靠数据库唯一约束 `UNIQUE(user_id, entry_id)`，不是靠云函数里的「先查再插」** —— 并发下两个请求会同时通过检查、双双插入，只有数据库约束拦得住。函数负责把约束冲突（SQLSTATE `23505`）翻成 `409 FAV_DUPLICATE`。
- **错误**：`400 BAD_REQUEST`（缺 `entry_id` / 非字符串 / 空白 / 超 64 字 / 体不是 JSON / `user_id` 不在 `users` 表）· `401 UNAUTHORIZED` · `405 METHOD_NOT_ALLOWED`（`PUT` / `PATCH` 等）· `409 FAV_DUPLICATE` · `500 INTERNAL`
- **前端在哪用**：`store.js` 的 `toggle(id)` 中「加入收藏」那一支。

---

### 3.7 `DELETE /api/favorites/{entry_id}` — 取消一条收藏

- **认证**：是
- **请求参数**：路径参数 `entry_id`
- **响应 200**：

  ```json
  { "ok": true, "data": { "removed": true } }
  ```

- **幂等约定**：删不存在的返回 **`404 FAV_NOT_FOUND`**，前端**静默当成功**（本地也删掉，不弹错）。
- **错误**：`401`、`404`、`500`
- **前端在哪用**：`store.js` 的 `toggle(id)` 中「取消收藏」那一支，与 `remove(id)`。

---

### 3.8 `PUT /api/favorites/sync` — 批量覆盖（本地迁账号）

- **认证**：是
- **请求体**：

  ```json
  { "ids": ["yishou-001", "shenxian-004"], "mode": "merge" }
  ```

  `mode`：`merge`（与云端取并集，**默认**）／`replace`（以本地为准覆盖）
- **响应 200**：

  ```json
  { "ok": true, "data": { "total": 2, "items": [ { "entry_id": "yishou-001", "created_at": "..." } ] } }
  ```

- **用途**：用户此前在浏览器里攒了收藏（localStorage `yishou.fav.v1`），登录后一次性搬上云端。
- **错误**：`400`（`ids` 不是字符串数组，或超过 500 条）、`401`、`500`
- **前端在哪用**：登录成功后的那一次迁移，只调一次。

---

### 3.9 `POST /api/events` — 埋点（可选）

- **认证**：否（未登录也采，`user_id` 留空）
- **请求体**：

  ```json
  { "event_type": "search", "payload": { "q": "九尾狐", "bu": "异兽", "hits": 1 } }
  ```

- **响应 202**：`{ "ok": true, "data": { "accepted": true } }`
- **约束**：**不采**任何个人身份信息，`payload` 只放搜索词与筛选条件。
- **前端在哪用**：`events.js` 里的动作分发处。

---

### 3.10 `GET /api/entries` — 条目列表读取（可选，仅后端化时）

- **认证**：否
- **请求参数**：`bu`（部名）、`limit`、`offset`
- **响应 200**：

  ```json
  { "ok": true, "data": { "total": 12, "items": [ { "id": "yishou-001", "bu": "异兽", "data": { "名": "九尾狐" } } ] } }
  ```

- **说明**：建了 `entries` 表才需要它。**不建表就永远不做** —— 静态 JSON 更省、更快，是当前的正确选择。

---

### 3.11 `GET /api/hot` — 收藏热门榜 ✅ 已实现（Day 17 新增登记）

- **代码**：`cloudbase/functions/hot/index.web.js`
- **认证**：否（榜单是聚合结果，**不含任何个人信息**）
- **请求参数**（query，可选）：

  | 参数 | 类型 | 默认 | 说明 |
  |---|---|---|---|
  | `limit` | int | 10 | 返回条数，最大 50（超了夹住，不报错） |

- **响应 200**：

  ```json
  {
    "ok": true,
    "data": {
      "total": 9,
      "items": [
        { "entry_id": "yishou-001", "fav_count": 2 },
        { "entry_id": "shenxian-004", "fav_count": 1 }
      ]
    }
  }
  ```

- **`total`**：被收藏过的**不同条目数**（`count(DISTINCT entry_id)`），不是收藏总行数。
- **排序**：`fav_count` 降序；**同票时按 `entry_id` 升序兜底** —— 否则同票行的顺序由数据库自行决定，
  「刷新后有没有变」这件事就没法判断。
- **错误**：`400 BAD_REQUEST`（`limit` 非整数）、`405`、`500 INTERNAL`

> **口径说明（Day 17 拍板）**：课程清单里的「热搜」是打卡 App 示例的说法，本项目（异兽志）**没有外部热搜需求**。
> 因此 `hot` 定为「**对现有 `public.favorites` 按 `entry_id` 聚合出的收藏榜**」：零建表、零外部数据源、
> 读的是真库真行。⚠️ 当前种子数据（9 条收藏落在 9 个**不同**条目上）会让榜单全是 `fav_count = 1`；
> 要让榜首真的分出高低，得有多个人收藏同一条 —— 那属于写接口（Day 18 起）之后的事。
> **若将来真要接外部热搜**：属「别人产出 + 要回看历史」→ 需新建表 + 定时同步任务，按 `TECH_DESIGN-后端预备方案.md` 另开一天做，不要就地改本接口。

---

## 4. 与前端现有代码的对应关系

| 前端位置 | 现在怎么做 | 接后端后怎么改 |
|---|---|---|
| `js/store.js` | 读 / 写 `localStorage['yishou.fav.v1']`（id 数组） | **只改这个文件**：改成调 3.5–3.8。文件头已写明「将来若加后端，只改这个文件，views/* 一行不动」 |
| `js/views/*.js` | 只管调 `store` 的函数 | **不动** |
| `js/data.js` | `fetch('data/*.json')` 读五部 | **不动**（除非走可选表 `entries`） |
| 未登录时 | —— | 回落 localStorage，功能不降级；登录后再 `sync` 合并 |

**上线前必须补的两件事**：① 跨域（CORS）配好，否则前端域名调不到接口域名；② token 的存放位置与过期处理（过期 = 回落到本地收藏，且提示一次）。

---

## 5. 后端形态（✅ Day 16 已定：**B2**）

🔴 **已拍板：走 B2 · 云函数 + 云数据库。** 理由 = 环境 Day 15 已开通、且「数据库类型创建时选定**不可切换**」（已选 PostgreSQL）；改投 B1 要新注册一个平台、前面的环境作废重来，不划算。

下表保留作对照（B1 仍未排除，只是本版不采用）：

| | **B1 · 托管数据库 + 第三方登录**（`TECH_DESIGN-后端预备方案.md` §3 推荐） | **B2 · 云函数 + 云数据库**（Day 15 实际开通的 CloudBase 路线） |
|---|---|---|
| 形态 | 静态前端**直连**托管数据库（行级安全 RLS 兜住权限） | 静态前端 → 云函数 → 数据库 |
| 接口怎么落地 | 「接口」= 平台自动生成的 REST 端点 + RLS 规则，几乎零服务端代码 | 每个接口 = **一个云函数**（今天写的 `health` 就是这个模式的第 0 个） |
| 与今天的关系 | 云函数只留 `health`，其余全走直连 | 3.2–3.10 每个都要写成云函数 |
| 主要代价 | 要**新注册**一个平台账号；RLS 规则要写对，写错 = 数据裸奔 | 已开通、能立刻开工；但函数数量多、三处排错（浏览器 + 函数日志 + 数据库） |

**落地口径（B2）**：§3 的每个接口 = 一个**云函数**（第 0 个 `health` 已在 `cloudbase/functions/health/`）。本契约的路径与 JSON 形状两种形态都不用改 —— 换形态只换实现层，契约不动。
**另需补**：RLS 策略（CloudBase PG 的 `public` schema 可被 PostgREST 直连，不配策略 = 权限不可控）+ HTTP 网关跨域设置。

---

## 6. 变更记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-10-08（Day 18 · 部署实测） | v0.4 | **第一个写接口上线并通过公网验证**：§3.6 `POST /api/favorites` 标记已实现（与 `GET /api/favorites` 同一个云函数，按方法分流）。三条验证全部对上契约 —— 正常写入 `201` / 重复提交 `409 FAV_DUPLICATE` / 缺必填字段 `400` + 中文提示；数据库侧确认「写进去的读得出来」（`GET` 的 `total` 与表行数一致，重复请求不增行）。补记三处口径 —— ① §3.6 请求校验细则（空白 / 超 64 字 / 体非 JSON 一律 400，提示必须中文点名缺什么）；② §3.6 明确「防重复靠数据库唯一约束而非函数里的先查再插」；③ §1 临时认证口径由「Day 18 删」改为「**待 `POST /api/auth/session` 落地后删**」（Day 18 当天选择先做写接口，未做 auth）。§3 错误码补登 `405`。⚠️ **实测发现**：PG 网关口回的唯一冲突码是 `DATABASE_23505`（带前缀）而不是裸 `23505`，函数需归一化后再判，否则「重复收藏」会被当成 `500` 回给前端 —— 详细排错见 `cloudbase/README.md` |
| 2026-10-07（Day 17 · 部署实测） | v0.3.1 | **两个读接口上线并通过公网验证**：`GET /api/favorites` / `GET /api/hot` 已挂到默认域名（HTTP 网关，上游类型 `WEB_SCF`）。**数据通路定案**：优先 CloudBase PG HTTP 网关 + 环境 API Key（`service_role`，仅服务端），`PG_URL` 配了则切回 `pg` 直连；§3.5 补记 `created_at` 归一化与 `total` 的两种取法。⚠️ 网关是 PostgREST 形态，**不支持 `GROUP BY`**，`/api/hot` 的聚合在函数内完成（契约 §3.11 记账）。实现与排错见 `cloudbase/README.md` |
| 2026-10-07（Day 17） | v0.3 | **第一个读接口落地**：§3.5 `GET /api/favorites` 标记已实现（代码 `cloudbase/functions/favorites/index.web.js`），补记三处实现口径 —— ① `total` 需额外 `count(*)`（表里没有总数列）；② 排序补 `id` 兜底（`created_at` 非唯一键）；③ `created_at` 由 `to_char` 产出无毫秒 ISO 串。**新增 §3.11 `GET /api/hot`**（收藏热门榜，Day 17 拍板改口径：不接外部热搜）。**新增 §1 临时认证口径**（无 token 时认 `?user_id=`，Day 18 删）。§3 错误码补登 `405 METHOD_NOT_ALLOWED`。§0 更新已实现接口与 CORS 现状 |
| 2026-10-07（Day 16） | v0.2 | §2 表结构与数据库对齐：`users` 加 `UNIQUE(provider, provider_uid)`；`favorites` 外键补 `ON DELETE CASCADE`、`entry_id` 补长度 CHECK、**修正索引口径（不单独建 `user_id` 索引）**；§0 补后端形态/数据库/已建表；§5 B1/B2 定案为 **B2**。实现见 `db/schema.sql` + `db/seed.sql`，步骤见 `db/README.md` |
| 2026-10-07（Day 15） | v0.1 | 初版：登记 `users` / `favorites`（+ 两个可选表）与 10 个接口的占位，无实现。B1/B2 形态待定。 |
