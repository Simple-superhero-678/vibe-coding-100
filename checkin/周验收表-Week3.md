# 第 3 周验收表（Day 16–21 · 后端周）

> 验收日期：2026-10-11｜填表：小象（代填）｜复核：宝哥 + 同伴交叉验证
> 口径：每项写明「验证方法 + 结果 + 证据」，不用模糊表述。结果只取 PASS / FAIL / 未执行。

## 一、本周产出逐项验收

| # | 验收项（对应本周产出） | 验证方法 | 结果 | 证据 |
|---|---|---|---|---|
| W1 | schema / seed 脚本 | 打开 `db/schema.sql` + `db/seed.sql`，确认两张表 + 约束 + 可复现种子；对照 `db/README.md` 验证步骤 | **PASS** | 文件存在：`db/schema.sql` 建 `users`/`favorites`（主键·外键 `ON DELETE CASCADE`·唯一 `UNIQUE(user_id,entry_id)`·CHECK 长度 1–64），全部 `IF NOT EXISTS`；`db/seed.sql` 先删后插 5 用户 + 9 收藏，id 写死可复现；`db/README.md` 含「每张表 ≥5 行」验收判据 |
| W2 | GET / POST 公网接口 | 命令行 / 浏览器直连公网地址，看是否返回契约形状 `{ok,data}` | **PASS**（GET 已实时验证；POST 见证据） | ① **2026-10-11 live curl**：`/api/health`→`200 {"ok":true,"service":"yishou"}`；`/api/favorites?user_id=1111…`→`200 {"ok":true,"data":{"total":14,…}}`；`/api/hot`→`200 {"ok":true,"data":{"total":18,…}}` ② POST 写入 **2026-10-11 live curl 全链路实测**：`POST {"entry_id":"yishou-day21-check"}`→**201** `{"ok":true,"data":{"entry_id":"yishou-day21-check","created_at":"2026-10-11T06:40:28Z"}}`；重复提交→**409** `FAV_DUPLICATE`；刷新读回→`total` **14→15**（写进去的读得出来，持久化坐实）。另有 Day18/19 线上回归 201/409/400 全对（`cloudbase/README.md`）、公网检查台每次点击即一次真实 POST |
| W3 | 分层重构 | 看 `index.web.js` 是否只剩接口层、`repositories/` 是否独立；跑三道闸门测试 | **PASS** | `cloudbase/functions/favorites/index.web.js` 仅路由/方法分流/参数校验/状态码，**无 SQL/网关地址/连接池**；`repositories/favoritesRepository.js` 独占取数；`api-local-test.js` 93/93、`refactor-fingerprint.js` 22/22、`online-regress.js` 9/9（见 `cloudbase/README.md`） |
| W4 | 公网检查台 URL | 打开公网首页，确认 `#检查台` 挂载并向公网接口拉真实数据 | **PASS**（代码 + 接口已验证；真浏览器打开待同伴） | `yizhi/index.html:42` `<section id="检查台">` + `:143` 载 `js/station.js`；`yizhi/js/api.js` 导出 `取健康/取收藏表/写收藏表`；公网地址 `https://yishou-d9gyoykka49fb0634-1501173044.tcloudbaseapp.com/cbsite/`；其调用的 `/api/*` 已实测 200 |
| W5 | api-contract.md 完整性 | 通读契约，确认本周实现的接口都有形状/错误码/变更记录 | **PASS** | `api-contract.md` v0.4：§3.5 GET favorites / §3.6 POST favorites / §3.11 GET hot 均含请求·响应·错误码·排序口径；§6 变更记录 v0.1→v0.4 逐日登记；§0 如实标注 RLS/CORS 欠账 |

## 二、缺项如实标记（FAIL / 未执行）

| # | 缺项 | 状态 | 证据 / 说明 |
|---|---|---|---|
| G1 | RLS 行级安全未配（`public` schema 直连权限不可控） | **FAIL（欠账）** | `api-contract.md` §0 标注；属权限层，待配策略 |
| G2 | 临时认证 `?user_id` 顶替真 token（`POST /api/auth/session` 未落地） | **未执行（第 4 周）** | `api-contract.md` §1 临时口径；`auth/session` 仍为占位 |
| G3 | 前端 `store.js` 完整接线（收藏从云端读/写，目前仅检查台演示，未接进收藏面板 `#/藏`） | **未执行（今日不做新功能）** | `yizhi/js/station.js` 注释明确「完整接口接线是另一回事」 |
| G4 | `DELETE /api/favorites/{entry_id}` 取消收藏接口 | **未执行（第 4 周占位）** | `api-contract.md` §3.7 仍为占位 |
| G5 | 网关侧跨域设置（函数侧已收窄为反射可信来源，公网检查台实测可用） | **PASS（功能可用）/ 文档旧注待更新** | `favorites/index.web.js` 不再写 `*` 通配；检查台从公网静态站拉到数据即证明跨域放行；`api-contract.md` §0 旧注「跨域设置仍待配」应改为已解决 |

## 三、本周最花时间的一步 & 值不值

- 最花时间：**Day 19 分层重构**（把 SQL/网关代码从 `index.web.js` 拆进 `repositories/`，并加 `refactor-fingerprint` 逐字节比对）。
- 值不值：**值**。它让「改接口不碰数据库代码、改数据库不碰接口」成立，以后加接口只动一层；三道闸门（本机断言 / 逐字节指纹 / 线上回归）把「重构只动结构不动行为」钉死，避免线上悄悄回归。
