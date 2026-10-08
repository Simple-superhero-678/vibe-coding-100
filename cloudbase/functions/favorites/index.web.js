'use strict';

/**
 * favorites —— /api/favorites（收藏的读与写）
 *   GET  /api/favorites —— 收藏列表读取（Day 17）
 *   POST /api/favorites —— 新增一条收藏（Day 18）
 *
 * 形态：CloudBase「HTTP 云函数（Web 函数）」版 —— 自己用 http 起服务、监听 9000。
 * 依据：api-contract.md §3.5（GET）/ §3.6（POST）（响应形状、错误码一律以契约为准）
 * 部署：cloudbase/README.md「部署步骤 · favorites / hot」。
 *
 * 数据通路（Day 17 定案，两条腿）：
 *   ① 首选 CloudBase PG HTTP 网关（PostgREST 形态，官方推荐、免 VPC、免 pg 依赖）
 *      https://<envId>.api.tcloudbasegateway.com/v1/rdb/rest/<表>
 *      认证：Authorization: Bearer <环境 API Key>（service_role，绕过 RLS）
 *   ② 备选 直连 TCP（pg 驱动）：配了 PG_URL 时走这条（需 VPC/白名单，见 README）
 *   顺序：PG_URL 有值 → 走 ②；否则 → 走 ①。两条都不通就按 500 回人话。
 *
 * 结构上刻意分两层，为了「能在本机自动验」：
 *   造处理({ 查询者 }) —— 纯逻辑：路由、参数校验、组装 JSON、错误码。查询者是注入的，可换假的
 *   建默认查询者()     —— 真取数：网关 或 pg
 * 好处：本机跑断言时注入假查询者，不装依赖、不连库、不联网。
 *
 * 本版新增（Day 17）：
 *   · 从真库 public.favorites 读真数据（网关侧参数走 URL 查询串，值一律 encodeURIComponent）
 *   · 响应统一 { ok, data } / { ok, error:{code,message} }
 *   · 临时身份（甲 方案）：没有 Authorization 头时认 ?user_id=<uuid>，
 *     有 Bearer 时取 Bearer 的值当 user_id。Day 18 接上真 token 后删掉这一段。
 * 本版新增（Day 18）：
 *   · POST 写入：校验必填字段（中文报错）→ 插一行 → 回 201 {ok,data}
 *   · 防重复：靠数据库唯一约束 UNIQUE(user_id, entry_id)，
 *     冲突（SQLSTATE 23505）翻成 409 FAV_DUPLICATE —— 不在代码里写「先查再插」，
 *     那样并发下两个请求会同时通过检查、双双插入（契约 §2.2 已记账）
 *   · 服务端日志：每次写入打一行 [favorites] 开头的记录，便于以后排查
 *   · 冲突码归一化（真连库后补的）：网关口回的是 "DATABASE_23505" 而不是 "23505"，
 *     用 规范码() 只留 5 位 SQLSTATE；响应头 proxy-status 作为兜底来源
 */

const http = require('http');

const SERVICE = 'yishou';
const PORT = process.env.PORT || 9000; // Web 函数约定端口 9000

// 契约 §3.5：limit 默认 200、最大 500；offset 默认 0
const 默认条数 = 200;
const 最大条数 = 500;

// 只认 uuid 形态的 user_id（表里 user_id 是 uuid 列，格式不对不用去问数据库）
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ==========================================================================
 * 一、真取数（唯一碰数据库的地方）
 * ========================================================================== */

// 统一把各种时间串收成契约要求的形态：ISO 8601 UTC、无毫秒、以 Z 结尾
// 网关回的是 "2026-10-01T17:12:00+08:00"，契约示例是 "2026-10-01T09:12:00Z"
function 收成UTC(v) {
  if (v === null || v === undefined) return null;
  const s = String(v);
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/* —— 通路口：从报错文本/响应头里挖 PostgreSQL 的 SQLSTATE（定「错在哪」） —— */
// 23505 = 唯一约束冲突（这条收藏已经有了）→ 409 FAV_DUPLICATE
// 23503 = 外键约束冲突（user_id 在 users 表里不存在）
// 网关(PostgREST) 把它放在 {"code":"...",...}，也可能包一层 {"error":{...}}，两种都认

// ⚠️ 2026-10-08 实测（这条是真连库才暴露的）：网关口给的不是裸码，而是
//    {"code":"DATABASE_23505", "message":"duplicate key value violates unique constraint \"favorites_user_entry_key\""}
//    —— 前面多一层 DATABASE_ 前缀。原来直接拿它去比 '23505' 会认不出，
//    结果「重复收藏」被当成「服务器坏了」回了 500（契约 §3.6 要的是 409）。
//    所以这里统一归一化：不管给的是 23505 还是 DATABASE_23505，都只留 5 位 SQLSTATE。
function 规范码(原) {
  const s = String(原 === null || 原 === undefined ? '' : 原).trim();
  const m = /(\d{5})/.exec(s);
  return m ? m[1] : s;
}

// 来源①：响应体
function 挖SQLSTATE(文本) {
  try {
    const j = JSON.parse(文本);
    const 码 = (j && (j.code || (j.error && j.error.code))) || '';
    return 规范码(码);
  } catch (e) {
    return '';
  }
}

// 来源②（兜底）：响应头 proxy-status: PostgREST; error=23505
// 留这一手是为了防「将来网关连 code 字段都不给了」—— 头的形态由 PostgREST 约定，比体更稳
function 挖头SQLSTATE(响应头) {
  try {
    const 原 = (响应头 && 响应头.get && 响应头.get('proxy-status')) || '';
    return 规范码(原);
  } catch (e) {
    return '';
  }
}

/* —— 通路①：CloudBase PG HTTP 网关（PostgREST 形态） —— */
function 建网关查询者() {
  const 环境ID = (process.env.TCB_ENV_ID || 'yishou-d9gyoykka49fb0634').trim();
  const 密钥 = (process.env.TCB_API_KEY || '').trim();
  if (!密钥) {
    throw new Error(
      '缺少环境变量 TCB_API_KEY（CloudBase 环境 API Key）。到函数配置 → 环境变量里加一条，' +
        '或改用 PG_URL 走 TCP 直连'
    );
  }
  const 基址 = `https://${环境ID}.api.tcloudbasegateway.com/v1/rdb/rest`;

  async function 取(路径, 额外头) {
    const 头 = Object.assign(
      {
        authorization: 'Bearer ' + 密钥,
        accept: 'application/json',
      },
      额外头 || {}
    );
    const 响应 = await fetch(基址 + 路径, { headers: 头 });
    const 文本 = await 响应.text();
    if (!响应.ok) {
      let 说明 = 文本.slice(0, 300);
      try {
        const j = JSON.parse(文本);
        说明 = j.message || j.error || 说明;
      } catch (e) {
        /* 非 JSON 就直接用原文 */
      }
      const e = new Error(`网关 ${响应.status}：${说明}`);
      e.code = '网关' + 响应.status;
      throw e;
    }
    return { 文本, 响应头: 响应.headers };
  }

  return {
    // total 靠响应头 content-range 的「/总数」段：
    // 请求 limit=1 时回 "0-0/5"，取 5 即可 —— 表里没有 total 列
    async 总数(user_id) {
      const { 响应头 } = await 取(
        `/favorites?select=id&user_id=eq.${encodeURIComponent(user_id)}&limit=1`,
        { prefer: 'count=exact' }
      );
      const 范围 = 响应头.get('content-range') || '';
      const 总 = 范围.includes('/') ? 范围.split('/')[1] : '*';
      return 总 === '*' || 总 === '' ? 0 : parseInt(总, 10);
    },

    // ORDER BY created_at, id：created_at 不是唯一键，批量写入会撞在同一秒，
    // 只按它排 → 分页时同一行可能重复出现或被跳过
    async 分页(user_id, limit, offset) {
      const { 文本 } = await 取(
        `/favorites?select=entry_id,created_at` +
          `&user_id=eq.${encodeURIComponent(user_id)}` +
          `&order=created_at.asc,id.asc&limit=${limit}&offset=${offset}`
      );
      const 行 = JSON.parse(文本);
      return 行.map((r) => ({ entry_id: r.entry_id, created_at: 收成UTC(r.created_at) }));
    },

    // 新增一行。用 Prefer: return=representation 让网关把插入后的整行回给我们
    // （不然 PostgREST 默认只回 201 + 空体，拿不到 created_at）
    async 新增(user_id, entry_id) {
      const 响应 = await fetch(基址 + '/favorites', {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + 密钥,
          'content-type': 'application/json',
          accept: 'application/json',
          prefer: 'return=representation',
        },
        body: JSON.stringify({ user_id, entry_id }),
      });
      const 文本 = await 响应.text();
      if (!响应.ok) {
        let 说明 = 文本.slice(0, 300);
        try {
          const j = JSON.parse(文本);
          说明 = j.message || (j.error && j.error.message) || 说明;
        } catch (e) {
          /* 非 JSON 就直接用原文 */
        }
        const e = new Error(`网关 ${响应.status}：${说明}`);
        e.code = '网关' + 响应.status;
        // 冲突的真正原因（23505 / 23503）在这里。两个来源都试，体认不出就低头
        e.sqlstate = 挖SQLSTATE(文本) || 挖头SQLSTATE(响应.headers);
        throw e;
      }
      const 行 = JSON.parse(文本);
      const 一 = Array.isArray(行) ? 行[0] : 行;
      if (!一 || !一.entry_id) {
        throw new Error('网关没有回写入结果 —— 检查 Prefer: return=representation 是否被网关吃掉');
      }
      return { entry_id: 一.entry_id, created_at: 收成UTC(一.created_at) };
    },
  };
}

/* —— 通路②：直连 TCP（pg 驱动） —— */
function 要SSL(连接串) {
  return /sslmode=require/i.test(连接串) || process.env.PG_SSL === '1';
}

function 建pg查询者(连接串) {
  const { Pool } = require('pg'); // 懒加载：本机跑断言时不装 pg 也不报错
  const 池 = new Pool({
    connectionString: 连接串,
    max: 2, // 免费版资源点有限，别开大池子
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000, // 连不上要快失败，不要挂到函数超时
    ...(要SSL(连接串) ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  池.on('error', (e) => console.error('[pg] 空闲连接出错：', e.message));

  const 查询 = async (sql, 参数) => (await 池.query(sql, 参数)).rows;

  return {
    async 总数(user_id) {
      const 行 = await 查询('SELECT count(*)::int AS total FROM public.favorites WHERE user_id = $1', [
        user_id,
      ]);
      return 行.length ? 行[0].total : 0;
    },
    // created_at 在 SQL 里就定成字符串，不让驱动把它转成 JS Date（那样会多出 .000）
    async 分页(user_id, limit, offset) {
      return 查询(
        `SELECT entry_id,
                to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
         FROM public.favorites
         WHERE user_id = $1
         ORDER BY created_at ASC, id ASC
         LIMIT $2 OFFSET $3`,
        [user_id, limit, offset]
      );
    },
    // 插入一行并用 RETURNING 拿回服务端生成的时间；冲突交给数据库判（唯一约束）
    async 新增(user_id, entry_id) {
      try {
        const 行 = await 查询(
          `INSERT INTO public.favorites (user_id, entry_id)
           VALUES ($1, $2)
           RETURNING entry_id,
                     to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at`,
          [user_id, entry_id]
        );
        return 行[0];
      } catch (e) {
        // pg 驱动把 SQLSTATE 放在 e.code（23505 / 23503），统一挂到 sqlstate 上，
        // 两种通路就能共用同一个错误翻译
        e.sqlstate = e.sqlstate || e.code;
        throw e;
      }
    },
  };
}

function 建默认查询者() {
  const 连接串 = (process.env.PG_URL || '').trim();
  if (连接串) {
    console.log('[favorites] 数据通路：pg 直连 (PG_URL)');
    return 建pg查询者(连接串);
  }
  console.log('[favorites] 数据通路：CloudBase PG HTTP 网关 (TCB_API_KEY)');
  return 建网关查询者();
}

/* ==========================================================================
 * 二、错误翻译（把数据库/网关的行话翻成契约 §1 的 code + 人话）
 * ========================================================================== */

function 翻错误(err, 动作 = '读取') {
  const 码 = err && err.code;
  const 附注 = {
    网关401: 'API Key 无效或已失效（TCB_API_KEY）',
    网关403: 'API Key 权限不足或环境不对',
    网关404: '网关路径不对——检查 TCB_ENV_ID 与是否已开通 PG',
    '28P01': '账号或密码不对（连接串里的用户名/密码）',
    '3D000': '连接串里的数据库名不存在',
    '42P01': '表不存在 —— 建表脚本（db/schema.sql）是不是没在这个库跑过？',
    '42501': '权限不足 —— 该角色读不了 public.favorites',
    ENOTFOUND: '数据库主机名解析不了（PG_URL 里的 host 写错了）',
    ECONNREFUSED: '数据库拒绝连接（端口不对，或云函数不在可访问的白名单/VPC 里）',
    ETIMEDOUT: '连接数据库超时（网络不通，优先查白名单/VPC）',
  }[码];

  return {
    code: 'INTERNAL',
    message: 附注 ? `${动作}失败：${附注}` : `${动作}失败：${(err && err.message) || err}`,
  };
}

// 写入专用：先按 SQLSTATE 认「能认出来的错」，认不出来才退回通用翻译（当 500）
function 翻写入错误(err) {
  const 态 = String((err && (err.sqlstate || err.code)) || '');

  if (态 === '23505') {
    return {
      状态码: 409,
      code: 'FAV_DUPLICATE',
      message: '该条目已在收藏中（同一用户重复收藏同一条会被拒绝）',
    };
  }
  if (态 === '23503') {
    return {
      状态码: 400,
      code: 'BAD_REQUEST',
      message: '收藏要挂在真实用户上：user_id 在 users 表里找不到',
    };
  }
  if (态 === '23514' || 态 === '22001') {
    return {
      状态码: 400,
      code: 'BAD_REQUEST',
      message: 'entry_id 不符合数据库要求（长度 1–64、不能是空白）',
    };
  }

  return { 状态码: 500, ...翻错误(err, '写入') };
}

/* ==========================================================================
 * 三、纯逻辑：路由 + 参数 + 组装响应（查询者注入）
 * ========================================================================== */

// 身份（临时口径，Day 17 立、Day 18 的 POST 沿用）：优先 Authorization: Bearer xxx，否则退到 ?user_id=xxx
// 读和写共用同一套，免得两个接口对「你是谁」的判断悄悄分叉
function 解析身份(原始地址, 请求头) {
  const u = new URL(原始地址 || '/', 'http://localhost');
  const 授权 = (请求头 && (请求头.authorization || 请求头.Authorization)) || '';
  const Bearer = /^Bearer\s+(.+)$/i.exec(授权.trim());
  const 参 = u.searchParams.get('user_id');
  return (Bearer ? Bearer[1].trim() : '') || (参 === null ? '' : 参.trim());
}

function 解析入参(原始地址, 请求头) {
  const u = new URL(原始地址 || '/', 'http://localhost');
  const 取 = (名) => {
    const v = u.searchParams.get(名);
    return v === null ? null : v.trim();
  };

  const user_id = 解析身份(原始地址, 请求头);

  // —— limit / offset
  const 原limit = 取('limit');
  const 原offset = 取('offset');

  let limit = 默认条数;
  if (原limit !== null && 原limit !== '') {
    if (!/^\d+$/.test(原limit)) return { 错: 'limit 必须是整数' };
    limit = Math.min(parseInt(原limit, 10), 最大条数); // 契约：上限 500 —— 超了就夹住，不报错
    if (limit < 1) return { 错: 'limit 必须 ≥ 1' };
  }

  let offset = 0;
  if (原offset !== null && 原offset !== '') {
    if (!/^\d+$/.test(原offset)) return { 错: 'offset 必须是非负整数' };
    offset = parseInt(原offset, 10);
  }

  return { user_id, limit, offset };
}

// 读请求体（只读一次、限长，防止有人拿超大 body 把函数撑爆）
function 读请求体(req, 上限字节 = 4096) {
  return new Promise((resolve, reject) => {
    let 累计 = 0;
    const 块 = [];
    req.on('data', (c) => {
      累计 += c.length;
      if (累计 > 上限字节) {
        reject(new Error(`请求体超过 ${上限字节} 字节`));
        req.destroy();
        return;
      }
      块.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(块).toString('utf8')));
    req.on('error', reject);
  });
}

// 纯校验：POST 请求体 → { entry_id } 或 { 错: '中文说明' }
// 错误信息一律说清「缺了什么 / 哪里不对」，不写「参数错误」这种要人去猜的话
function 校验新收藏(体) {
  if (体 === null || typeof 体 !== 'object' || Array.isArray(体)) {
    return { 错: '请求体必须是一个 JSON 对象，例如 {"entry_id":"yishou-001"}' };
  }
  const 原 = 体.entry_id;
  if (原 === undefined || 原 === null) {
    return { 错: '缺少必填字段：entry_id（条目 id，例如 yishou-001）' };
  }
  if (typeof 原 !== 'string') {
    return { 错: 'entry_id 必须是字符串（条目 id，例如 yishou-001）' };
  }
  const 值 = 原.trim();
  if (值 === '') return { 错: 'entry_id 不能为空' };
  if (值.length > 64) return { 错: `entry_id 最长 64 个字符，收到 ${值.length} 个` };
  return { entry_id: 值 };
}

// 契约 §1：成功 {ok,data}；失败 {ok:false,error:{code,message}}
function 成功并(res, 状态码, data) {
  return 回(res, 状态码, { ok: true, data });
}
function 成功(res, data) {
  return 成功并(res, 200, data);
}
function 失败(res, 状态码, code, message) {
  return 回(res, 状态码, { ok: false, error: { code, message } });
}

function 回(res, 状态码, 体) {
  res.writeHead(状态码, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store', // 验收要「刷新后跟着变」，绝不能缓存
    'access-control-allow-origin': '*', // Day 17 先在函数侧放行，Day 18 前端接入时够用
    'access-control-allow-headers': 'authorization,content-type',
  });
  res.end(JSON.stringify(体));
}

// 读和写都要先知道「你是谁」。不合规时这里已经把响应发出去了，返回 null 让调用方直接 return
function 要身份(req, res) {
  const user_id = 解析身份(req.url, req.headers);
  if (!user_id) {
    // 契约 §1：没有身份来源 → 401。Day 17 临时：token 就是 user_id
    失败(
      res,
      401,
      'UNAUTHORIZED',
      '未登录。Day 17 临时方案：地址里加 ?user_id=<uuid>（或请求头 Authorization: Bearer <uuid>）'
    );
    return null;
  }
  if (!UUID.test(user_id)) {
    失败(res, 400, 'BAD_REQUEST', 'user_id 必须是 uuid 形态');
    return null;
  }
  return user_id;
}

function 造处理({ 查询者 }) {
  // —— GET：读列表（Day 17） ——
  async function 处理读取(req, res) {
    const 入参 = 解析入参(req.url, req.headers);
    if (入参.错) return 失败(res, 400, 'BAD_REQUEST', 入参.错);
    if (!要身份(req, res)) return;

    try {
      // 总数与当页分两次取（表里没有 total 列，契约 §3.5 已记这笔账）
      const total = await 查询者.总数(入参.user_id);
      const items = await 查询者.分页(入参.user_id, 入参.limit, 入参.offset);
      return 成功(res, { total, items });
    } catch (err) {
      console.error('[favorites] 查询失败：', err && err.message);
      const 错 = 翻错误(err);
      return 失败(res, 500, 错.code, 错.message);
    }
  }

  // —— POST：新增一条收藏（Day 18） ——
  async function 处理新增(req, res) {
    const user_id = 要身份(req, res);
    if (!user_id) return;

    let 原文;
    try {
      原文 = await 读请求体(req);
    } catch (e) {
      return 失败(res, 400, 'BAD_REQUEST', `请求体读取失败：${e.message}`);
    }

    let 体;
    try {
      体 = JSON.parse(原文 || '');
    } catch (e) {
      return 失败(res, 400, 'BAD_REQUEST', '请求体不是合法 JSON，例如 {"entry_id":"yishou-001"}');
    }

    const 校验 = 校验新收藏(体);
    if (校验.错) {
      console.log(`[favorites] 新增被拒（参数不合规）user=${user_id} 原因=${校验.错}`);
      return 失败(res, 400, 'BAD_REQUEST', 校验.错);
    }

    try {
      const 行 = await 查询者.新增(user_id, 校验.entry_id);
      // 服务端日志（余力加练）：写入成功留一行，事后能对上「谁在什么时候写了什么」
      console.log(`[favorites] 新增成功 user=${user_id} entry=${行.entry_id} created_at=${行.created_at}`);
      return 成功并(res, 201, 行); // 契约 §3.6：201
    } catch (err) {
      const 错 = 翻写入错误(err);
      if (错.状态码 === 409) {
        console.log(`[favorites] 新增被拒（重复收藏）user=${user_id} entry=${校验.entry_id}`);
      } else {
        console.error(`[favorites] 新增失败 user=${user_id} entry=${校验.entry_id} 原因=${err && err.message}`);
      }
      return 失败(res, 错.状态码, 错.code, 错.message);
    }
  }

  return async function 处理(req, res) {
    const 路径 = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';

    // 兜住「网关是否剥掉路径前缀」两种行为，与 health 一致
    if (路径 !== '/' && !路径.endsWith('/api/favorites')) {
      return 失败(res, 404, 'NOT_FOUND', `没有这个接口：${路径}`);
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization,content-type',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
      });
      return res.end();
    }
    if (req.method === 'GET') return 处理读取(req, res);
    if (req.method === 'POST') return 处理新增(req, res);

    // PATCH / DELETE / PUT 属第 4 周（今天不做），明确回 405 而不是 404：
    // 「这个地址有服务，只是不接受这个方法」和「没这个地址」是两回事，排错时区别很大
    return 失败(res, 405, 'METHOD_NOT_ALLOWED', `该接口只支持 GET 与 POST，收到 ${req.method}`);
  };
}

/* ==========================================================================
 * 四、导出（本机断言用）+ 启动（部署时用）
 * ========================================================================== */

module.exports = {
  造处理,
  建默认查询者,
  解析入参,
  解析身份,
  校验新收藏,
  翻写入错误,
  挖SQLSTATE,
  挖头SQLSTATE,
  规范码,
  收成UTC,
  默认条数,
  最大条数,
  SERVICE,
};

if (require.main === module) {
  // 取数初始化失败（比如没配环境变量）不该让函数起不来 ——
  // 起了服务才能把原因用 JSON 回给浏览器，而不是让调用方只看到 502
  let 查询者;
  try {
    查询者 = 建默认查询者();
  } catch (e) {
    查询者 = {
      总数: async () => {
        throw e;
      },
      分页: async () => {
        throw e;
      },
      新增: async () => {
        throw e;
      },
    };
    console.error('[favorites] 取数初始化失败：', e.message);
  }

  http.createServer(造处理({ 查询者 })).listen(PORT, () => {
    console.log(`${SERVICE}/favorites listening on ${PORT}`);
  });
}
