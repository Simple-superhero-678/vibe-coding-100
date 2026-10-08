'use strict';

/**
 * favoritesRepository.js —— `public.favorites` 表的**唯一**数据访问入口
 *
 * 分层位置（Day 19 拆出）：
 *   接口层 index.web.js  ← 只做「接请求 → 调本文件 → 返响应」
 *   数据访问层 本文件    ← 所有 SQL / 网关 URL / 连接池 / 时间归一化 / SQLSTATE 挖掘 /
 *                          错误码翻译，全部在这
 *
 * 为什么放在函数目录内部（而不是 cloudbase/repositories/ 共享一份）：
 *   `tcb fn deploy` 只打包**当前函数目录**，跨目录 require 在线上会找不到文件。
 *   所以 favorites / hot 各自持有一份本表的 repository —— 代码是重复的，
 *   但每个函数目录都能独立部署，这是该部署模型下的正确取舍（Day 19 记账）。
 *
 * 对外只暴露：
 *   建默认仓库()  —— 读环境变量选通路（PG_URL 有值走 pg，否则走网关）
 *   建网关仓库()  —— 通路①：CloudBase PG HTTP 网关（PostgREST 形态）
 *   建pg仓库()    —— 通路②：pg 驱动 TCP 直连
 * 三个都返回同一套方法签名（**读 + 写**），接口层不关心走的是哪条：
 *   · 总数(user_id)                  → number
 *   · 分页(user_id, limit, offset)   → [{ entry_id, created_at }]
 *   · 新增(user_id, entry_id)        → { entry_id, created_at }（冲突时抛 err.sqlstate）
 * 另导出三个纯函数给接口层/断言用（它们本来就是「仓库自身的事」）：
 *   · 收成UTC(v)                     → 契约形态时间串
 *   · 规范码(原)                     → 只留 5 位 SQLSTATE（吃掉网关的 DATABASE_ 前缀）
 *   · 翻错误(err, 动作)              → 读失败 → { code, message }
 *   · 翻写入错误(err)                → 写失败 → { 状态码, code, message }（23505→409 等）
 *
 * 依据：api-contract.md §2.2 / §3.5 / §3.6、cloudbase/README.md「数据通路」。
 */

/* ==========================================================================
 * 0. 时间归一化 + SQLSTATE 挖掘（契约要求 ISO 8601 UTC、无毫秒、以 Z 结尾）
 * ========================================================================== */

// 网关回的是 "2026-10-01T17:12:00+08:00"，契约示例是 "2026-10-01T09:12:00Z"
function 收成UTC(v) {
  if (v === null || v === undefined) return null;
  const s = String(v);
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/* —— 从报错文本/响应头里挖 PostgreSQL 的 SQLSTATE（定「错在哪」） —— */
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

/* ==========================================================================
 * 1. 通路①：CloudBase PG HTTP 网关（PostgREST 形态 · 默认通路）
 * ========================================================================== */

const 默认环境ID = 'yishou-d9gyoykka49fb0634';

function 建网关仓库({ 环境ID, 密钥 } = {}) {
  const env = String(环境ID || process.env.TCB_ENV_ID || 默认环境ID).trim();
  const key = String(密钥 !== undefined ? 密钥 : process.env.TCB_API_KEY || '').trim();
  if (!key) {
    throw new Error(
      '缺少环境变量 TCB_API_KEY（CloudBase 环境 API Key）。到函数配置 → 环境变量里加一条，' +
        '或改用 PG_URL 走 TCP 直连'
    );
  }
  const 基址 = `https://${env}.api.tcloudbasegateway.com/v1/rdb/rest`;

  async function 取(路径, 额外头) {
    const 头 = Object.assign(
      {
        authorization: 'Bearer ' + key,
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
      const err = new Error(`网关 ${响应.status}：${说明}`);
      err.code = '网关' + 响应.status;
      throw err;
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
      return JSON.parse(文本).map((r) => ({
        entry_id: r.entry_id,
        created_at: 收成UTC(r.created_at),
      }));
    },

    // 新增一行。用 Prefer: return=representation 让网关把插入后的整行回给我们
    // （不然 PostgREST 默认只回 201 + 空体，拿不到 created_at）
    async 新增(user_id, entry_id) {
      const 响应 = await fetch(基址 + '/favorites', {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + key,
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
        const err = new Error(`网关 ${响应.status}：${说明}`);
        err.code = '网关' + 响应.status;
        // 冲突的真正原因（23505 / 23503）在这里。两个来源都试，体认不出就低头
        err.sqlstate = 挖SQLSTATE(文本) || 挖头SQLSTATE(响应.headers);
        throw err;
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

/* ==========================================================================
 * 2. 通路②：直连 TCP（pg 驱动 · 配了 PG_URL 才走）
 * ========================================================================== */

function 要SSL(连接串) {
  return /sslmode=require/i.test(连接串) || process.env.PG_SSL === '1';
}

function 建pg仓库(连接串) {
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

/* ==========================================================================
 * 3. 通路选择（接口层只调这个）
 * ========================================================================== */

function 建默认仓库({ 标签 = 'favorites' } = {}) {
  const 连接串 = (process.env.PG_URL || '').trim();
  if (连接串) {
    console.log(`[${标签}] 数据通路：pg 直连 (PG_URL)`);
    return 建pg仓库(连接串);
  }
  console.log(`[${标签}] 数据通路：CloudBase PG HTTP 网关 (TCB_API_KEY)`);
  return 建网关仓库();
}

/* ==========================================================================
 * 4. 错误翻译（把数据库/网关的行话翻成契约 §1 的 code + 人话）
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

module.exports = {
  建默认仓库,
  建网关仓库,
  建pg仓库,
  收成UTC,
  规范码,
  挖SQLSTATE,
  挖头SQLSTATE,
  翻错误,
  翻写入错误,
};
