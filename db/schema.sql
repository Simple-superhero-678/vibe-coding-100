-- =============================================================================
-- 异兽志 · 后端数据库 · 建表脚本（schema.sql）
-- -----------------------------------------------------------------------------
-- 目标库 ：CloudBase PostgreSQL（环境 yishou-d9gyoykka49fb0634 · schema public）
-- 依据   ：api-contract.md §2 —— 表结构唯一真源是契约，改表先改契约再改这里
-- 执行处 ：CloudBase 控制台 → SQL 型数据库 → SQL 编辑器（整份粘贴 → 运行）
-- 可重复 ：全部 IF NOT EXISTS，重复执行不报错、不覆盖已有数据
-- 日期   ：Day 16（2026-10-07）
--
-- 本脚本只建「表 + 约束 + 注释」，不插数据（数据在 seed.sql）、不写接口、
-- 不配 RLS（RLS 属权限层，Day 17 起配）。
--
-- 两张表的分工（今天要掌握的问题）：
--   users     —— 存「人」：一行 = 一个登录过的人
--   favorites —— 存「谁收了哪条」：一行 = 一次收藏动作
--   关联字段  —— favorites.user_id  →  users.id（外键，一对多）
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. 依赖
-- -----------------------------------------------------------------------------
-- gen_random_uuid() 在 PostgreSQL 13+ 是内置函数，正常不需要扩展。
-- 若执行时报 “function gen_random_uuid() does not exist”，把下面这行的
-- 注释去掉、单独跑一次，然后再整份跑本脚本：
-- CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- -----------------------------------------------------------------------------
-- 1. users —— 用户表
-- -----------------------------------------------------------------------------
-- 存什么：一行 = 一个登录过的人（谁、从哪个平台来、平台上是谁、显示名叫什么）
-- 不存什么：密码、手机号、邮箱、真实姓名 —— 一个都不存
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text        NOT NULL,
  provider_uid  text        NOT NULL,
  nickname      text,
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- 空字符串不是「有效值」，用 CHECK 挡掉（NOT NULL 只挡 NULL）
  CONSTRAINT users_provider_not_blank     CHECK (btrim(provider) <> ''),
  CONSTRAINT users_provider_uid_not_blank CHECK (btrim(provider_uid) <> ''),

  -- 同一个人重复登录，不该建出第二个用户行
  CONSTRAINT users_provider_uid_key       UNIQUE (provider, provider_uid)
);

COMMENT ON TABLE  public.users              IS '用户表：一行 = 一个登录过的人。不存密码/手机号/邮箱/真实姓名';
COMMENT ON COLUMN public.users.id           IS '主键，uuid。用 uuid 而非自增整数：不暴露「你是我第几个用户」，将来合并多平台数据也不会撞号';
COMMENT ON COLUMN public.users.provider     IS '登录来源标签，如 github / anonymous。用 text 而非 varchar(n)：长度不定，PG 里 text 与 varchar 性能相同，varchar 只多了个长度检查';
COMMENT ON COLUMN public.users.provider_uid IS '第三方平台给的唯一 id。可能是很长的数字串或字符串 → 必须 text，用整数会溢出';
COMMENT ON COLUMN public.users.nickname     IS '界面显示用昵称。可空是语义：第三方可能没给昵称，「空」= 还没拿到，不是错误';
COMMENT ON COLUMN public.users.created_at   IS '首次登录时间。必须 timestamptz 而非 timestamp：带时区，跨时区/夏令时不会算错（契约要求 ISO 8601 UTC）';


-- -----------------------------------------------------------------------------
-- 2. favorites —— 收藏表（核心表）
-- -----------------------------------------------------------------------------
-- 存什么：一行 = 一次收藏动作（谁、收了哪一条、什么时候收的）
-- 关联  ：user_id → users.id
-- 注意  ：entry_id 故意【不建外键】—— 条目真源是 data/*.json，不在数据库里。
--         后果：条目被删后收藏会指向不存在的 id → 前端显示「此条已下架」并允许移除
--         （TECH_DESIGN.md §12.4 已有该态）。契约 §2.2 明确不建。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.favorites (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL,
  entry_id    text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- 关联字段：谁的收藏。类型必须与 users.id 完全一致，否则外键建不起来
  -- ON DELETE CASCADE：注销用户时连带删掉他的收藏（契约 §3.4 要的行为），
  -- 交给数据库保证，比在云函数里写两条删语句可靠（漏一条就留脏数据）
  CONSTRAINT favorites_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE CASCADE,

  -- 防重复收藏：这是 409 FAV_DUPLICATE 的【数据层保证】。
  -- 只靠云函数写 if 判断会漏 —— 并发下两个请求可能同时通过检查。
  CONSTRAINT favorites_user_entry_key UNIQUE (user_id, entry_id),

  -- 输入校验（安全红线 #6）：挡住空串与超长字符串
  CONSTRAINT favorites_entry_id_not_blank CHECK (btrim(entry_id) <> ''),
  CONSTRAINT favorites_entry_id_len       CHECK (length(entry_id) BETWEEN 1 AND 64)
);

COMMENT ON TABLE  public.favorites            IS '收藏表：一行 = 一次收藏动作。与 users 是一对多，靠 user_id 关联';
COMMENT ON COLUMN public.favorites.id         IS '行主键。这张表永远按 (user_id, entry_id) 查，「第几行」没有业务意义';
COMMENT ON COLUMN public.favorites.user_id    IS '外键 → users.id。类型必须与 users.id 一模一样（uuid 对 text 是不兼容的，外键会建不起来）';
COMMENT ON COLUMN public.favorites.entry_id   IS '条目 id，如 yishou-001，与 data/*.json 里的 id 完全一致。存 text：内容真源是 JSON，数据库只存这个「指针」';
COMMENT ON COLUMN public.favorites.created_at IS '收藏时间。契约：列表按它【升序】排（旧的在前面），时间由服务端生成 → DEFAULT now() 正好，前端不用传';

-- 关于索引：契约 §2.2 说「给 user_id 建索引」，本脚本【不单独建】。
-- 原因：上面 UNIQUE (user_id, entry_id) 已经生成一个以 user_id 为前导列的索引，
-- 「按 user_id 查」它能直接命中；再建一个单列索引是纯冗余（白占空间、拖慢写入）。
-- （按 created_at 排序的索引也没建：单用户收藏量是几百条级，全表扫描足够快。）


-- -----------------------------------------------------------------------------
-- 3. 自检（可选）：跑完会列出本次建出的两张表
-- -----------------------------------------------------------------------------
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('users', 'favorites')
ORDER BY table_name;
-- 期望输出两行：favorites / users
