'use strict';

/**
 * api-local-test.js —— 本机自测（不需要数据库、不需要装依赖、不需要联网）
 *   Day 17 立 · Day 18 加写接口（POST）用例
 *
 * 怎么跑：
 *   "C:\Users\lxb07\.workbuddy\binaries\node\versions\22.22.2-6\node.exe" cloudbase/tests/api-local-test.js
 *
 * 验什么：
 *   A. 两个云函数的【纯逻辑层】—— 路由、参数校验、排序、分页、错误码、JSON 形状
 *      （查询者是假的，内存里复刻 db/seed.sql 的 5 个用户 + 9 条收藏）
 *      Day 18 起假查询者还复刻了真库的两条约束：外键（23503）+ 唯一约束（23505），
 *      「写入 1–9」那批用例就是对着它们验「正常 201 / 重复 409 / 缺字段 400 / 写完能读回」
 *   B. 两个云函数的【真取数层 · 网关通路】—— 用假的 fetch 捕获真实请求 URL / 方法 / 请求体，
 *      断言 PostgREST 查询串写对了、user_id 做了 URL 编码、content-range 解析对、
 *      写入带 Prefer: return=representation、SQLSTATE 能挖出来、时间归一化成契约形态
 * 不验什么：真连库能不能通（那必须部署后在浏览器/函数日志里看）—— 见 cloudbase/README.md。
 */

const http = require('http');

const 收藏 = require('../functions/favorites/index.web.js');
const 热门 = require('../functions/hot/index.web.js');

/* ------------------------------------------------------------------ 假数据 */
const 用户1 = '11111111-1111-4111-8111-111111111111';
const 用户2 = '22222222-2222-4222-8222-222222222222';
const 用户4 = '44444444-4444-4444-8444-444444444444';

// 与 db/seed.sql 完全一致（user_id / entry_id / created_at）
const 全部收藏 = [
  { user_id: 用户1, entry_id: 'yishou-001', created_at: '2026-10-01T09:12:00Z' },
  { user_id: 用户1, entry_id: 'shenxian-004', created_at: '2026-10-01T09:30:00Z' },
  { user_id: 用户1, entry_id: 'shenhua-007', created_at: '2026-10-02T11:30:00Z' },
  { user_id: 用户1, entry_id: 'yaoguai-007', created_at: '2026-10-03T20:05:00Z' },
  { user_id: 用户1, entry_id: 'jingjie-003', created_at: '2026-10-04T07:45:00Z' },
  { user_id: 用户2, entry_id: 'yishou-005', created_at: '2026-10-02T10:00:00Z' },
  { user_id: 用户2, entry_id: 'yaoguai-020', created_at: '2026-10-05T18:20:00Z' },
  { user_id: '33333333-3333-4333-8333-333333333333', entry_id: 'shenxian-030', created_at: '2026-10-04T12:00:00Z' },
  { user_id: 用户4, entry_id: 'shenhua-014', created_at: '2026-10-06T09:00:00Z' },
];

function 造假查询者(记录, 选项 = {}) {
  // 内存里的一张「收藏表」，新增会真的往里加行 —— 这样才验得了「写完能读回」
  const 收藏表 = 全部收藏.map((r) => ({ ...r }));
  const 新行时间 = '2026-10-07T13:20:00Z'; // 比种子数据都晚，读回时排在最后

  return {
    async 总数(user_id) {
      记录.push({ 方法: '总数', 参数: [user_id] });
      return 收藏表.filter((r) => r.user_id === user_id).length;
    },
    async 分页(user_id, limit, offset) {
      记录.push({ 方法: '分页', 参数: [user_id, limit, offset] });
      const 我的 = 收藏表
        .filter((r) => r.user_id === user_id)
        .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
      return 我的.slice(offset, offset + limit).map((r) => ({ entry_id: r.entry_id, created_at: r.created_at }));
    },
    // 复刻真库的两条约束：外键（用户必须存在）+ 唯一约束（同一人同一条只能一行）
    async 新增(user_id, entry_id) {
      记录.push({ 方法: '新增', 参数: [user_id, entry_id] });
      if (选项.新增就抛) throw 选项.新增就抛;

      if (!全部收藏.some((r) => r.user_id === user_id)) {
        const e = new Error('insert or update on table "favorites" violates foreign key constraint "favorites_user_id_fkey"');
        e.sqlstate = '23503';
        throw e;
      }
      if (收藏表.some((r) => r.user_id === user_id && r.entry_id === entry_id)) {
        const e = new Error('duplicate key value violates unique constraint "favorites_user_entry_key"');
        e.sqlstate = '23505';
        throw e;
      }

      收藏表.push({ user_id, entry_id, created_at: 新行时间 });
      return { entry_id, created_at: 新行时间 };
    },
  };
}

function 造假聚合者(记录) {
  return {
    async 聚合行() {
      记录.push({ 方法: '聚合行', 参数: [] });
      return 全部收藏.map((r) => ({ entry_id: r.entry_id }));
    },
  };
}

/* ------------------------------------------------------------------ 测试工具 */
const 结果 = [];
function 断言(名称, 条件, 细节) {
  结果.push({ 名称, 通过: !!条件, 细节 });
  console.log(`${条件 ? 'PASS' : 'FAIL'}  ${名称}${条件 ? '' : '   ← ' + (细节 || '')}`);
}

async function 起服务(处理) {
  const 服务 = http.createServer(处理);
  await new Promise((r) => 服务.listen(0, '127.0.0.1', r));
  return { 服务, 端口: 服务.address().port, 基址: `http://127.0.0.1:${服务.address().port}` };
}

async function 取(基址, 路径, 选项) {
  const r = await fetch(基址 + 路径, 选项);
  let 体 = null;
  try {
    体 = await r.json();
  } catch (e) {
    /* 204 之类没有体 */
  }
  return { 状态: r.status, 体 };
}

// POST 用：把请求体塞进去，其余交给 取()。
// 体给字符串就原样发（用来测「非法 JSON」），给对象就 JSON.stringify，给 undefined 就不带体
function 发文(基址, 路径, 体, 头 = {}) {
  return 取(基址, 路径, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...头 },
    body: typeof 体 === 'string' ? 体 : JSON.stringify(体),
  });
}

// 假的 fetch：只记录请求、按脚本回一段 JSON / 一个 content-range
function 装假fetch(应答) {
  const 请求 = [];
  全局原fetch = global.fetch;
  global.fetch = async (url, init) => {
    请求.push({ url, headers: (init && init.headers) || {}, method: (init && init.method) || 'GET', body: init && init.body });
    const 一 = 应答(url);
    return {
      ok: 一.ok !== false,
      status: 一.status || 200,
      headers: { get: (k) => (一.headers || {})[String(k).toLowerCase()] || null },
      text: async () => 一.文本,
    };
  };
  return { 请求, 还原: () => (global.fetch = 全局原fetch) };
}
let 全局原fetch;

/* ------------------------------------------------------------------ 主流程 */
(async () => {
  /* ============ 一、favorites 纯逻辑 ============ */
  const 记录A = [];
  const a = await 起服务(收藏.造处理({ 查询者: 造假查询者(记录A) }));

  {
    const r = await 取(a.基址, `/api/favorites?user_id=${用户1}`);
    断言('favorites 1/ 命中用户 → 200 且 ok:true', r.状态 === 200 && r.体.ok === true, JSON.stringify(r.体));
    断言('favorites 1/ total = 5', r.体.data.total === 5, `实际 ${r.体.data.total}`);
    断言('favorites 1/ items 5 条', r.体.data.items.length === 5, `实际 ${r.体.data.items.length}`);
    断言(
      'favorites 1/ 升序（第一条是最早的 yishou-001）',
      r.体.data.items[0].entry_id === 'yishou-001',
      JSON.stringify(r.体.data.items)
    );
    断言(
      'favorites 1/ 只回 id 与时间两个字段',
      Object.keys(r.体.data.items[0]).sort().join(',') === 'created_at,entry_id',
      JSON.stringify(Object.keys(r.体.data.items[0]))
    );
    断言(
      'favorites 1/ 时间形态与契约示例一致（无毫秒）',
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(r.体.data.items[0].created_at),
      r.体.data.items[0].created_at
    );
  }

  {
    const r = await 取(a.基址, '/api/favorites', { headers: { authorization: `Bearer ${用户4}` } });
    断言('favorites 2/ Bearer <uuid> 也能用 → 该用户 1 条', r.状态 === 200 && r.体.data.total === 1, JSON.stringify(r.体));
  }

  {
    const r = await 取(a.基址, '/api/favorites');
    断言(
      'favorites 3/ 无身份 → 401 UNAUTHORIZED（契约 §1）',
      r.状态 === 401 && r.体.ok === false && r.体.error.code === 'UNAUTHORIZED',
      JSON.stringify(r.体)
    );
  }

  {
    const r = await 取(a.基址, '/api/favorites?user_id=abc');
    断言('favorites 4/ user_id 非 uuid → 400 BAD_REQUEST', r.状态 === 400 && r.体.error.code === 'BAD_REQUEST', JSON.stringify(r.体));
  }

  {
    const r = await 取(a.基址, `/api/favorites?user_id=${用户1}&limit=2`);
    断言('favorites 5/ limit=2 → items 2 条', r.体.data.items.length === 2, JSON.stringify(r.体.data));
    断言('favorites 5/ total 仍为 5（不是当页条数）', r.体.data.total === 5, `实际 ${r.体.data.total}`);
  }

  {
    记录A.length = 0;
    const r = await 取(a.基址, `/api/favorites?user_id=${用户1}&limit=999`);
    const 分页调用 = 记录A.find((c) => c.方法 === '分页');
    断言('favorites 6/ limit=999 不报错', r.状态 === 200, JSON.stringify(r.体));
    断言('favorites 6/ limit 夹到 500 才下传', 分页调用 && 分页调用.参数[1] === 500, JSON.stringify(分页调用 && 分页调用.参数));
  }

  {
    const r = await 取(a.基址, `/api/favorites?user_id=${用户1}&limit=abc`);
    断言('favorites 7/ limit 非整数 → 400 BAD_REQUEST', r.状态 === 400 && r.体.error.code === 'BAD_REQUEST', JSON.stringify(r.体));
  }

  {
    const r = await 取(a.基址, `/api/favorites?user_id=${用户1}&limit=2&offset=3`);
    断言(
      'favorites 8/ offset=3 limit=2 → yaoguai-007 / jingjie-003',
      r.体.data.items.map((i) => i.entry_id).join(',') === 'yaoguai-007,jingjie-003',
      JSON.stringify(r.体.data.items)
    );
  }

  {
    记录A.length = 0;
    await 取(a.基址, `/api/favorites?user_id=${用户1}`);
    断言(
      'favorites 9/ 身份以「值」的形式传给取数层，不拼进任何文本（防注入）',
      记录A.length === 2 && 记录A.every((c) => c.参数[0] === 用户1),
      JSON.stringify(记录A.map((c) => c.参数))
    );
  }

  {
    const 甲 = await 取(a.基址, `/api/favorites?user_id=${用户1}`, { method: 'PATCH' });
    断言('favorites 10/ PATCH → 405 METHOD_NOT_ALLOWED（第 4 周才做）', 甲.状态 === 405 && 甲.体.error.code === 'METHOD_NOT_ALLOWED', JSON.stringify(甲.体));
    断言('favorites 10/ 405 提示里点名支持 GET 与 POST', /GET/.test(甲.体.error.message) && /POST/.test(甲.体.error.message), 甲.体.error.message);
    const 甲2 = await 取(a.基址, `/api/favorites?user_id=${用户1}`, { method: 'DELETE' });
    断言('favorites 10/ DELETE → 405（今天不做删除）', 甲2.状态 === 405, String(甲2.状态));
    const 乙 = await 取(a.基址, `/api/favorites?user_id=${用户1}`, { method: 'OPTIONS' });
    断言('favorites 10/ OPTIONS → 204（预检放行）', 乙.状态 === 204, String(乙.状态));
    const 丙 = await 取(a.基址, '/api/favorites/nope');
    断言('favorites 10/ 未知子路径 → 404 NOT_FOUND', 丙.状态 === 404 && 丙.体.error.code === 'NOT_FOUND', JSON.stringify(丙.体));
    const 丁 = await 取(a.基址, '/api/hot');
    断言('favorites 10/ 收到 /api/hot 不越权处理 → 404', 丁.状态 === 404, String(丁.状态));
  }

  /* ============ 一之二、POST 写入（Day 18） ============ */

  {
    const r = await 发文(a.基址, `/api/favorites?user_id=${用户1}`, { entry_id: 'yishou-002' });
    断言('写入 1/ 正常新增 → 201', r.状态 === 201, String(r.状态) + ' ' + JSON.stringify(r.体));
    断言('写入 1/ ok:true + data 形状符合契约 §3.6', r.体.ok === true && r.体.data.entry_id === 'yishou-002', JSON.stringify(r.体));
    断言(
      '写入 1/ data 只有 entry_id 与 created_at 两个字段',
      Object.keys(r.体.data).sort().join(',') === 'created_at,entry_id',
      JSON.stringify(Object.keys(r.体.data))
    );
    断言(
      '写入 1/ created_at 是契约形态（ISO UTC、无毫秒）',
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(r.体.data.created_at),
      r.体.data.created_at
    );
    断言('写入 1/ 没有 error 字段（成功响应不带 error）', r.体.error === undefined, JSON.stringify(r.体));
  }

  {
    // 防重复：同一条再来一次 —— 这是「今天要掌握的那个问题」的核心用例
    const r = await 发文(a.基址, `/api/favorites?user_id=${用户1}`, { entry_id: 'yishou-002' });
    断言('写入 2/ 重复提交 → 409', r.状态 === 409, String(r.状态) + ' ' + JSON.stringify(r.体));
    断言('写入 2/ code = FAV_DUPLICATE（契约 §3.6）', r.体.error.code === 'FAV_DUPLICATE', JSON.stringify(r.体));
    断言('写入 2/ 提示是中文且说清「已在收藏中」', /已在收藏中/.test(r.体.error.message), r.体.error.message);
    断言('写入 2/ ok:false', r.体.ok === false, JSON.stringify(r.体));
  }

  {
    const r = await 发文(a.基址, `/api/favorites?user_id=${用户1}`, {});
    断言('写入 3/ 缺 entry_id → 400', r.状态 === 400, String(r.状态) + ' ' + JSON.stringify(r.体));
    断言('写入 3/ code = BAD_REQUEST', r.体.error.code === 'BAD_REQUEST', JSON.stringify(r.体));
    断言('写入 3/ 中文提示点名缺了 entry_id', /缺少必填字段/.test(r.体.error.message) && /entry_id/.test(r.体.error.message), r.体.error.message);
  }

  {
    const 例 = [
      [{ entry_id: 123 }, /必须是字符串/, 'entry_id 非字符串'],
      [{ entry_id: '   ' }, /不能为空/, 'entry_id 纯空白'],
      [{ entry_id: 'x'.repeat(65) }, /最长 64/, 'entry_id 超长'],
      [{ entry_id: null }, /缺少必填字段/, 'entry_id 显式 null'],
      [[{ entry_id: 'yishou-003' }], /必须是一个 JSON 对象/, '请求体是数组'],
      ['{不是 JSON', /不是合法 JSON/, '请求体不是合法 JSON'],
      [undefined, /不是合法 JSON/, '请求体为空'],
    ];
    for (const [体, 期望, 说明] of 例) {
      const r = await 发文(a.基址, `/api/favorites?user_id=${用户1}`, 体);
      断言(`写入 4/ ${说明} → 400 且提示对得上`, r.状态 === 400 && 期望.test(r.体.error.message), `${r.状态} ${JSON.stringify(r.体.error)}`);
    }
  }

  {
    const r = await 发文(a.基址, '/api/favorites', { entry_id: 'yishou-004' });
    断言('写入 5/ 没带身份 → 401 UNAUTHORIZED', r.状态 === 401 && r.体.error.code === 'UNAUTHORIZED', JSON.stringify(r.体));
  }

  {
    const r = await 发文(a.基址, '/api/favorites?user_id=not-a-uuid', { entry_id: 'yishou-004' });
    断言('写入 5/ user_id 非 uuid → 400', r.状态 === 400 && r.体.error.code === 'BAD_REQUEST', JSON.stringify(r.体));
  }

  {
    // 用户不存在（外键 23503）：收藏挂不到真人身上
    const 查无此人 = '99999999-9999-4999-8999-999999999999';
    const r = await 发文(a.基址, `/api/favorites?user_id=${查无此人}`, { entry_id: 'yishou-004' });
    断言('写入 6/ 用户不存在 → 400 BAD_REQUEST（外键拦下）', r.状态 === 400 && r.体.error.code === 'BAD_REQUEST', JSON.stringify(r.体));
    断言('写入 6/ 提示说明「user_id 在 users 表里找不到」', /users/.test(r.体.error.message), r.体.error.message);
  }

  {
    // 写入过程中数据库抛了个没见过的错 → 必须是 500 INTERNAL（是「错」，不是「空」）
    const b2 = await 起服务(
      收藏.造处理({
        查询者: 造假查询者([], { 新增就抛: Object.assign(new Error('connect ECONNREFUSED 10.0.0.9:5432'), { code: 'ECONNREFUSED' }) }),
      })
    );
    const r = await 发文(b2.基址, `/api/favorites?user_id=${用户1}`, { entry_id: 'yishou-004' });
    断言('写入 7/ 取数层报错 → 500 INTERNAL', r.状态 === 500 && r.体.error.code === 'INTERNAL', JSON.stringify(r.体));
    断言('写入 7/ 中文提示前缀是「写入失败」（不是「读取失败」）', /^写入失败/.test(r.体.error.message), r.体.error.message);
    b2.服务.close();
  }

  {
    // 注入面：新增的两个入参必须以「值」的形式传给取数层，不拼进任何 SQL 文本。
    // 单开一个服务/假库，免得这里的写入污染后面「写完再读」的计数
    const 记录丙 = [];
    const a3 = await 起服务(收藏.造处理({ 查询者: 造假查询者(记录丙) }));
    const 怪 = "yishou-001'; DROP TABLE public.favorites; --";
    await 发文(a3.基址, `/api/favorites?user_id=${用户1}`, { entry_id: 怪 });
    记录丙.length = 0;
    const 原样 = await 发文(a3.基址, `/api/favorites?user_id=${用户1}`, { entry_id: 'yishou-006' });
    const 写入调用 = 记录丙.find((c) => c.方法 === '新增');
    断言(
      '写入 8/ entry_id 原样作为「值」下传（不拼接、不改写）',
      写入调用 && 写入调用.参数[0] === 用户1 && 写入调用.参数[1] === 'yishou-006',
      JSON.stringify(写入调用 && 写入调用.参数)
    );
    断言('写入 8/ 带引号分号的 entry_id 也被当成普通字符串接受（不执行、不报错）', 原样.状态 === 201, `${原样.状态} ${JSON.stringify(原样.体)}`);
    a3.服务.close();
  }

  {
    // 写入 → 读回：本机把今天的「完成标准」先预演一遍
    const r = await 取(a.基址, `/api/favorites?user_id=${用户1}`);
    断言('写入 9/ 写完再读：total 5 → 6', r.体.data.total === 6, `实际 ${r.体.data.total}`);
    断言('写入 9/ 新写的 yishou-002 出现在列表里', r.体.data.items.some((i) => i.entry_id === 'yishou-002'), JSON.stringify(r.体.data.items));
    断言(
      '写入 9/ 新的排在最后（created_at 升序）',
      r.体.data.items[r.体.data.items.length - 1].entry_id === 'yishou-002',
      JSON.stringify(r.体.data.items.map((i) => i.entry_id))
    );
    断言('写入 9/ 另一个用户不受影响（仍是 1 条）', (await 取(a.基址, `/api/favorites?user_id=${用户4}`)).体.data.total === 1, '用户4');
  }

  {
    const b = await 起服务(
      收藏.造处理({
        查询者: {
          总数: async () => {
            const e = new Error('connect ECONNREFUSED 10.0.0.9:5432');
            e.code = 'ECONNREFUSED';
            throw e;
          },
          分页: async () => [],
        },
      })
    );
    const r = await 取(b.基址, `/api/favorites?user_id=${用户1}`);
    断言(
      'favorites 11/ 取数失败 → 500 INTERNAL（是「错」，不是空列表）',
      r.状态 === 500 && r.体.ok === false && r.体.error.code === 'INTERNAL',
      JSON.stringify(r.体)
    );
    断言('favorites 11/ message 给出可操作的排查方向（提到白名单/VPC）', /白名单|VPC/.test(r.体.error.message), r.体.error.message);
    b.服务.close();
  }

  a.服务.close();

  /* ============ 二、hot 纯逻辑 ============ */
  const 记录B = [];
  const c = await 起服务(热门.造处理({ 查询者: 造假聚合者(记录B) }));

  {
    const r = await 取(c.基址, '/api/hot');
    断言('hot 12/ 命中 /api/hot → 200 且 ok:true', r.状态 === 200 && r.体.ok === true, JSON.stringify(r.体));
    断言('hot 12/ total = 9（被收藏过的不同条目数）', r.体.data.total === 9, `实际 ${r.体.data.total}`);
    断言('hot 12/ 默认返回 10 条以内', r.体.data.items.length === 9, `实际 ${r.体.data.items.length}`);
    断言(
      'hot 12/ 同票时按 entry_id 升序（顺序稳定，可判断「刷新变了没」）',
      r.体.data.items.map((i) => i.entry_id).join(',') ===
        ['jingjie-003', 'shenhua-007', 'shenhua-014', 'shenxian-004', 'shenxian-030', 'yaoguai-007', 'yaoguai-020', 'yishou-001', 'yishou-005'].join(','),
      JSON.stringify(r.体.data.items.map((i) => i.entry_id))
    );
  }

  {
    const r = await 取(c.基址, '/api/hot?limit=3');
    断言('hot 13/ limit=3 → items 3 条', r.体.data.items.length === 3, JSON.stringify(r.体.data.items));
    断言('hot 13/ 仍带 fav_count 字段', typeof r.体.data.items[0].fav_count === 'number', JSON.stringify(r.体.data.items[0]));
  }

  {
    // 上限 50 的夹取 + 聚合正确性，直接在纯函数上验（比造 60 条假数据更直接）
    const 假行 = [];
    for (let i = 1; i <= 60; i++) 假行.push({ entry_id: 'x-' + String(i).padStart(3, '0') });
    // 再给 x-001 加两票，验证「票多在前」
    假行.push({ entry_id: 'x-001' }, { entry_id: 'x-001' });
    const 榜 = 热门.算榜单(假行, 50);
    断言('hot 13/ limit 夹到 50 → 最多 50 条', 榜.items.length === 50, `实际 ${榜.items.length}`);
    断言('hot 13/ total = 不同条目数（60）', 榜.total === 60, `实际 ${榜.total}`);
    断言('hot 13/ 票多的排最前（x-001 = 3 票）', 榜.items[0].entry_id === 'x-001' && 榜.items[0].fav_count === 3, JSON.stringify(榜.items[0]));
  }

  {
    const r = await 取(c.基址, '/api/hot?limit=x');
    断言('hot 13/ limit 非整数 → 400', r.状态 === 400, JSON.stringify(r.体));
  }

  {
    const r = await 取(c.基址, '/api/hot');
    断言('hot 14/ 不带任何身份也 200（公开聚合，无个人信息）', r.状态 === 200 && r.体.ok === true, JSON.stringify(r.体));
  }

  c.服务.close();

  /* ============ 三、网关通路：URL 构造 / 编码 / 时间归一化 ============ */
  process.env.TCB_API_KEY = 'test-key';
  process.env.TCB_ENV_ID = 'yishou-d9gyoykka49fb0634';
  delete process.env.PG_URL;

  {
    const 假 = 装假fetch((url) => {
      if (url.includes('limit=1')) return { ok: true, status: 206, headers: { 'content-range': '0-0/5' }, 文本: '[{"id":"x"}]' };
      return {
        ok: true,
        status: 206,
        headers: {},
        文本: JSON.stringify([
          { entry_id: 'yishou-001', created_at: '2026-10-01T17:12:00+08:00' },
          { entry_id: 'shenxian-004', created_at: '2026-10-01T17:30:00+08:00' },
        ]),
      };
    });

    const 网 = 收藏.建默认查询者();
    const 总 = await 网.总数(用户1);
    const 页 = await 网.分页(用户1, 2, 3);
    假.还原();

    const u1 = 假.请求[0].url;
    const u2 = 假.请求[1].url;
    断言('网关 15/ 基址 = <envId>.api.tcloudbasegateway.com/v1/rdb/rest', u1.startsWith('https://yishou-d9gyoykka49fb0634.api.tcloudbasegateway.com/v1/rdb/rest/favorites?'), u1);
    断言('网关 15/ 带 Bearer 鉴权', String(假.请求[0].headers.authorization).startsWith('Bearer '), 假.请求[0].headers.authorization);
    断言('网关 15/ 总数查 content-range：0-0/5 → 5', 总 === 5, String(总));
    断言('网关 15/ 总数请求带 Prefer: count=exact', 假.请求[0].headers.prefer === 'count=exact', String(假.请求[0].headers.prefer));
    断言(
      '网关 15/ 分页 URL 含 user_id=eq. / order=created_at.asc,id.asc / limit / offset',
      u2.includes('user_id=eq.' + 用户1) && u2.includes('order=created_at.asc,id.asc') && u2.includes('limit=2') && u2.includes('offset=3'),
      u2
    );
    const 恶 = await (async () => {
      const 假2 = 装假fetch(() => ({ ok: true, status: 206, headers: { 'content-range': '0-0/0' }, 文本: '[]' }));
      const 网2 = 收藏.建默认查询者();
      await 网2.总数('a b&c=1');
      假2.还原();
      return 假2.请求[0].url;
    })();
    断言('网关 15/ 恶意 user_id 被编码（不出现裸 &c=1）', !恶.includes('&c=1') && 恶.includes('a%20b%26c%3D1'), 恶);
    断言(
      '网关 15/ created_at 归一化 +08:00 → UTC Z（无毫秒）',
      页[0].created_at === '2026-10-01T09:12:00Z',
      页[0].created_at
    );
  }

  {
    const 假 = 装假fetch(() => ({
      ok: true,
      status: 200,
      headers: {},
      文本: JSON.stringify(全部收藏.map((r) => ({ entry_id: r.entry_id }))),
    }));
    const 网 = 热门.建默认查询者();
    const 行 = await 网.聚合行();
    假.还原();
    断言('网关 16/ hot 网关取的是 entry_id 列表', 假.请求[0].url.includes('select=entry_id'), 假.请求[0].url);
    断言('网关 16/ 网关通路也能聚合成 9 条榜单', 热门.算榜单(行, 10).total === 9, JSON.stringify(热门.算榜单(行, 10).total));
  }

  {
    // 网关返回错误时，应该连同状态码一起抛出来（好让 翻错误 翻译成人话）
    const 假 = 装假fetch(() => ({ ok: false, status: 401, headers: {}, 文本: '{"code":"X","message":"Unauthorized"}' }));
    let 抛了 = null;
    try {
      await 收藏.建默认查询者().总数(用户1);
    } catch (e) {
      抛了 = e;
    }
    假.还原();
    断言('网关 17/ 401 会抛出且带 code=网关401', 抛了 && 抛了.code === '网关401', 抛了 && (抛了.code + ' ' + 抛了.message));
  }

  {
    delete process.env.TCB_API_KEY;
    let 抛了 = null;
    try {
      收藏.建默认查询者();
    } catch (e) {
      抛了 = e;
    }
    断言('网关 18/ 没配密钥时给出点名 TCB_API_KEY 的人话报错', 抛了 && /TCB_API_KEY/.test(抛了.message), 抛了 && 抛了.message);
    process.env.TCB_API_KEY = 'test-key';
  }

  {
    // 网关通路的写入：请求怎么构造（method / Prefer / 体）
    const 假 = 装假fetch(() => ({
      ok: true,
      status: 201,
      headers: {},
      文本: JSON.stringify([{ entry_id: 'yishou-002', created_at: '2026-10-07T21:20:00+08:00' }]),
    }));
    const 网 = 收藏.建默认查询者();
    const 行 = await 网.新增(用户1, 'yishou-002');
    假.还原();
    const 请 = 假.请求[0];
    断言(
      '网关 19/ POST 打到 /v1/rdb/rest/favorites（无查询串）',
      请.url === 'https://yishou-d9gyoykka49fb0634.api.tcloudbasegateway.com/v1/rdb/rest/favorites',
      请.url
    );
    断言('网关 19/ 方法为 POST', 请.method === 'POST', String(请.method));
    断言(
      '网关 19/ 带 Prefer: return=representation（否则拿不到 created_at）',
      请.headers.prefer === 'return=representation',
      String(请.headers.prefer)
    );
    断言('网关 19/ content-type 是 JSON', /application\/json/.test(String(请.headers['content-type'])), String(请.headers['content-type']));
    断言(
      '网关 19/ 体里只有 user_id 与 entry_id（snake_case，与数据库字段同名）',
      请.body === JSON.stringify({ user_id: 用户1, entry_id: 'yishou-002' }),
      String(请.body)
    );
    断言(
      '网关 19/ 回的行归一化成契约形态（+08:00 → UTC Z、无毫秒）',
      行.entry_id === 'yishou-002' && 行.created_at === '2026-10-07T13:20:00Z',
      JSON.stringify(行)
    );
  }

  {
    // 唯一冲突：网关回 409，SQLSTATE 藏在体里 —— 必须能挖出来，否则翻不出 FAV_DUPLICATE
    // ⚠️ 下面这段「文本」是 2026-10-08 直连网关抓回来的**原样响应体**，一个字都没改。
    //    别改成自己以为的形状（曾经写成 {code:'23505'} 就漏掉了真机的 DATABASE_ 前缀）。
    const 真实体 = '{"code":"DATABASE_23505","message":"duplicate key value violates unique constraint \\"favorites_user_entry_key\\"","requestId":"7bc57bd1-304b-4ec8-8467-64da47f9dc68"}';
    const 假 = 装假fetch(() => ({ ok: false, status: 409, headers: {}, 文本: 真实体 }));
    let 抛了 = null;
    try {
      await 收藏.建默认查询者().新增(用户1, 'yishou-001');
    } catch (e) {
      抛了 = e;
    }
    假.还原();
    断言('网关 20/ 真实网关体（DATABASE_23505）也挖得出 sqlstate=23505', 抛了 && 抛了.sqlstate === '23505', 抛了 && 抛了.sqlstate);
    const 译 = 收藏.翻写入错误(抛了);
    断言('网关 20/ 翻译成 409 FAV_DUPLICATE + 中文提示', 译.状态码 === 409 && 译.code === 'FAV_DUPLICATE' && /已在收藏中/.test(译.message), JSON.stringify(译));
  }

  {
    // 裸码（老形态）仍然要认 —— 归一化不能把原来的能力弄丢
    断言('网关 20/ 裸码 23505 照样认', 收藏.规范码('23505') === '23505', 收藏.规范码('23505'));
    断言('网关 20/ DATABASE_23505 归一化成 23505', 收藏.规范码('DATABASE_23505') === '23505', 收藏.规范码('DATABASE_23505'));
    断言('网关 20/ 认不出的码原样返回（不会误判）', 收藏.规范码('SOMETHING_ELSE') === 'SOMETHING_ELSE', 收藏.规范码('SOMETHING_ELSE'));
  }

  {
    // 兜底来源②：体里连 code 字段都没有，只有响应头 proxy-status
    const 假 = 装假fetch(() => ({
      ok: false,
      status: 409,
      headers: { 'proxy-status': 'PostgREST; error=23505' },
      文本: JSON.stringify({ message: 'conflict' }),
    }));
    let 抛了 = null;
    try {
      await 收藏.建默认查询者().新增(用户1, 'yishou-001');
    } catch (e) {
      抛了 = e;
    }
    假.还原();
    断言('网关 20/ 体里没码时，用响应头 proxy-status 兜底', 抛了 && 抛了.sqlstate === '23505', 抛了 && 抛了.sqlstate);
    const 译 = 收藏.翻写入错误(抛了);
    断言('网关 20/ 兜底后同样翻成 409 FAV_DUPLICATE', 译.状态码 === 409 && 译.code === 'FAV_DUPLICATE', JSON.stringify(译));
  }

  {
    // 外键冲突（23503）与数据库 CHECK 违规（23514）也各有归宿
    const 译1 = 收藏.翻写入错误(Object.assign(new Error('violates foreign key constraint'), { code: '23503' }));
    断言('网关 20/ 23503 → 400 BAD_REQUEST', 译1.状态码 === 400 && 译1.code === 'BAD_REQUEST', JSON.stringify(译1));
    const 译2 = 收藏.翻写入错误(Object.assign(new Error('violates check constraint'), { code: '23514' }));
    断言('网关 20/ 23514 → 400 BAD_REQUEST', 译2.状态码 === 400 && 译2.code === 'BAD_REQUEST', JSON.stringify(译2));
    const 译3 = 收藏.翻写入错误(Object.assign(new Error('something odd'), { code: 'XX999' }));
    断言('网关 20/ 认不出的错 → 500 INTERNAL', 译3.状态码 === 500 && 译3.code === 'INTERNAL', JSON.stringify(译3));
  }

  /* ============ 汇总 ============ */
  const 失败 = 结果.filter((r) => !r.通过);
  console.log(`\n==== ${结果.length - 失败.length} / ${结果.length} 通过 ====`);
  if (失败.length) {
    console.log('未通过：\n' + 失败.map((r) => ' - ' + r.名称 + '：' + r.细节).join('\n'));
  }
  process.exit(失败.length ? 1 : 0);
})();
