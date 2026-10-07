# db/ —— 数据库脚本（Day 16 起）

> 放**建表脚本**与**种子数据脚本**。
> 跟 `cloudbase/`（云函数源码）分开，也**不进** GitHub Pages 发布（发布根目录是 `yizhi/`）。
>
> ⚠️ **表的形状以 `api-contract.md` §2 为准** —— 那里是契约，这里是实现。
> **改表顺序：先改契约 → 再改 `schema.sql` → 再到控制台执行。** 反过来做，契约和库就会漂移。

---

## 一、文件

| 文件 | 作用 | 可重复执行 |
|---|---|---|
| `schema.sql` | **建表**：`users` / `favorites` + 主键、外键、唯一约束、CHECK、索引、字段注释（`COMMENT ON`） | ✅ 全部 `IF NOT EXISTS` |
| `seed.sql` | **种子数据**：先删后建，5 个用户 + 9 条收藏；id 全部写死，结果可复现 | ✅ 先删后插 |

两张表的分工（Day 16 的问题）：

- `users` —— 存「**人**」：一行 = 一个登录过的人
- `favorites` —— 存「**谁收了哪条**」：一行 = 一次收藏动作
- **关联字段**：`favorites.user_id` → `users.id`（外键，一对多）

---

## 二、环境信息

| 项 | 值 |
|---|---|
| 平台 | 腾讯云 CloudBase（云开发） |
| 环境 ID | `yishou-d9gyoykka49fb0634` |
| 数据库 | **PostgreSQL**（「SQL 型数据库」，创建时选定、**不可切换**） |
| Schema | `public`（唯一可被 PostgREST 访问的 schema） |
| 控制台 | `https://tcb.cloud.tencent.com` → 环境 `yishou` |
| 进入路径 | 左侧「**SQL 型数据库**」→ 中间栏「PostgreSQL 管理」 |

> 后端形态 = **B2 · 云函数 + 云数据库**（Day 16 定案，见 `api-contract.md` §5）。

---

## 三、首次执行（两条，顺序不能换）

### 第 1 步：建表

1. 控制台 → 左侧「SQL 型数据库」→ 中间栏「数据管理」→「**SQL 编辑器**」
2. 新开一个查询标签（顶部 `+`），把 `schema.sql` **整份**粘进去
3. 🔴 右下角「**角色**」切到 **管理员**（建表是 DDL，低权限角色会报权限不足）
4. 点「**执行**」
5. **期望**：无红字；结果区出现两行 `favorites` / `users`（脚本末尾的自检语句）；左侧「表」里出现这两张表

### 第 2 步：灌种子数据

1. **再新开一个查询标签**（别覆盖建表那段 SQL），粘 `seed.sql`
2. 角色仍是**管理员** → 执行
3. ⚠️ **会弹「检测到潜在问题：此查询包含破坏性操作」** —— 因为脚本里有 `DELETE`。
   判断标准：删的是不是**我们自己写死的那 5 个示例 id**？是 → 点「**运行查询**」。
4. **期望**：结果 9 行（`nickname` / `provider` / `entry_id` / `created_at`）—— 这就是两张表靠 `user_id` 拼起来的样子

---

## 四、验证（验收判据）

在 SQL 编辑器里跑下面几段。**验收要求：每张核心表至少 5 行。**

```sql
-- ① 每张表行数 —— 期望 users = 5、favorites = 9（两个都 ≥5 才算过）
SELECT 'users'     AS table_name, count(*) AS row_count FROM public.users
UNION ALL
SELECT 'favorites' AS table_name, count(*) AS row_count FROM public.favorites;

-- ② users 全表（5 行）
SELECT id, provider, provider_uid, nickname, created_at
FROM public.users
ORDER BY created_at;

-- ③ favorites 全表（9 行）
SELECT id, user_id, entry_id, created_at
FROM public.favorites
ORDER BY created_at;

-- ④ 关联验证：按人统计收藏条数（LEFT JOIN，没收藏的人也应出现在结果里）
SELECT u.nickname, u.provider, count(f.id) AS fav_count
FROM public.users AS u
LEFT JOIN public.favorites AS f ON f.user_id = u.id
GROUP BY u.id, u.nickname, u.provider
ORDER BY fav_count DESC;
```

### 可重复执行的验证（今天的一条完成标准）

把 `seed.sql` **原样再执行一遍**：

- **期望成功、无报错**，`favorites` 仍然是 **9 行**
- 如果是 18 行，说明没删干净（脚本坏了）；如果报主键冲突，说明 `DELETE` 没执行

### 可选：故意做坏，看约束拦不拦

这两段**故意会报错**，是让你亲眼确认约束真的在工作（在测试库里跑，跑完不影响数据）：

```sql
-- A. 重复收藏同一条 —— 应报 23505 unique_violation（这就是 409 FAV_DUPLICATE 的来源）
INSERT INTO public.favorites (user_id, entry_id)
VALUES ('11111111-1111-4111-8111-111111111111', 'yishou-001');

-- B. 收藏一个不存在的用户 —— 应报 23503 foreign_key_violation
INSERT INTO public.favorites (user_id, entry_id)
VALUES ('00000000-0000-4000-8000-000000000000', 'yishou-002');
```

### 要交的截图：在**数据编辑器**里拍

验收要的截图是「**表名 + 每张核心表 ≥5 行**」，SQL 结果区拍不到表名，要去数据页拍：

1. 左侧「SQL 型数据库」→「数据管理」→「**数据编辑器**」
2. 选 **`users`** 表 → 截图（画面里要有表名 `users` + 5 行数据）
3. 再选 **`favorites`** 表 → 截图（表名 `favorites` + 9 行数据）

---

## 五、已知坑（实测）

| # | 坑 | 说明 |
|---|---|---|
| 1 | 🔴 **角色必须选「管理员」** | 建表等 DDL 用低权限角色会报权限不足。位置在 SQL 编辑器右下角 |
| 2 | 🔴 **`seed.sql` 会弹「破坏性操作」确认** | 脚本带 `DELETE` 就会弹。看清删的是不是自己写死的示例 id，是就点「运行查询」 |
| 3 | ⚠️ **一次跑多条 SELECT，可能只显示最后一条的结果** | 想看中间某条，把它**单独选中**再执行 |
| 4 | ⚠️ 编辑器提示「SQL 里避免注释」 | 实测 `--` 注释**没问题**，脚本里的注释可以留着；`COMMENT ON` 是正经语句，不是注释 |
| 5 | 💡 **时间显示比脚本里大 8 小时** | 不是错。存的是 `timestamptz`（UTC 绝对时刻），界面按本地时区（+08）显示 |
| 6 | ⚠️ **`gen_random_uuid()` 报不存在** | PostgreSQL 13+ 内置。报错就把 `schema.sql` 里 `CREATE EXTENSION IF NOT EXISTS pgcrypto;` 的注释去掉，单独跑一次 |
| 7 | 💡 查询可点 ❤️「添加收藏」 | 存的是**SQL 文本**本身（上限 20 条），方便下次翻出来重跑 |
| 8 | ⚠️ **本目录脚本会删数据** | `seed.sql` 删的是自己写死的 5 个示例 id，不会误伤真实数据；但**别把 `DELETE` 改成清空全表**去生产库跑 |

---

## 六、下一步（Day 17 起）

| 项 | 说明 |
|---|---|
| **接口** | `api-contract.md` §3 的 10 个接口，B2 形态下每个 = 一个**云函数**（第 0 个 `health` 已在 `cloudbase/`） |
| **RLS** | 还没配。CloudBase PG 的 `public` schema 是唯一可被 PostgREST 访问的，**必须配行级安全 + 策略**，否则权限不可控（见 `TECH_DESIGN-后端预备方案.md` §7 红线 #3） |
| **CORS** | 静态站域名与接口域名不同，前端要调接口需在「HTTP 网关 → 跨域设置」放行 |
| **前端改动** | 只动 `yizhi/js/store.js`（保持 `list/has/toggle/remove` 签名），`views/*` 一行不改 |
