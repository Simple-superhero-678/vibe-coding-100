'use strict';

/**
 * hot —— GET /api/hot（收藏热门榜）
 *
 * 形态：CloudBase「HTTP 云函数（Web 函数）」版，与 favorites 同款结构。
 * 依据：api-contract.md §3.11（Day 17 新增登记）
 * 部署：cloudbase/README.md「部署步骤 · favorites / hot」。
 *
 * 为什么是这个「hot」：清单里的「热搜」是打卡课程模板（打卡 App 示例）的说法，
 * 本项目（异兽志）没有外部热搜需求。按宝哥 Day 17 拍板改口径 —— hot =
 * 对现有 public.favorites 按 entry_id 聚合出的「被收藏最多」的条目榜：
 * 零建表、零外部数据源、读的是真库真行。
 *
 * 认证：否（榜单是聚合结果，不含任何个人信息）
 * 参数：limit（默认 10、最大 50）
 *
 * 数据通路：与 favorites 相同（PG_URL 有值走 pg 直连；否则走 CloudBase PG HTTP 网关）。
 * ⚠️ 网关是 PostgREST 形态，**不支持 GROUP BY**，所以聚合在函数里做：
 *    取回 entry_id 列表（上限 5000 行）后在 JS 里计数排序 —— 当前量级（个位数~千级）
 *    完全够用；将来若收藏量上万，再改成 PG 视图或 RPC（契约 §3.11 记账）。
 *
 * 说明：这里刻意把 favorites 里的几个小工具重写了一遍，不做跨目录 require ——
 * 每个函数目录独立部署，跨目录引用在线上会找不到文件。
 */

const http = require('http');

const SERVICE = 'yishou';
const PORT = process.env.PORT || 9000;

const 默认条数 = 10;
const 最大条数 = 50;
const 取回上限 = 5000; // 一次最多拉这么多行来聚合

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
    const 头 = Object.assign({ authorization: 'Bearer ' + 密钥, accept: 'application/json' }, 额外头 || {});
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
    async 聚合行() {
      const { 文本 } = await 取(`/favorites?select=entry_id&limit=${取回上限}`);
      return JSON.parse(文本).map((r) => ({ entry_id: r.entry_id }));
    },
  };
}

/* —— 通路②：直连 TCP（pg 驱动） —— */
function 要SSL(连接串) {
  return /sslmode=require/i.test(连接串) || process.env.PG_SSL === '1';
}

function 建pg查询者(连接串) {
  const { Pool } = require('pg');
  const 池 = new Pool({
    connectionString: 连接串,
    max: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000,
    ...(要SSL(连接串) ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  池.on('error', (e) => console.error('[pg] 空闲连接出错：', e.message));

  return {
    async 聚合行() {
      return (await 池.query('SELECT entry_id FROM public.favorites LIMIT $1', [取回上限])).rows;
    },
  };
}

function 建默认查询者() {
  const 连接串 = (process.env.PG_URL || '').trim();
  if (连接串) {
    console.log('[hot] 数据通路：pg 直连 (PG_URL)');
    return 建pg查询者(连接串);
  }
  console.log('[hot] 数据通路：CloudBase PG HTTP 网关 (TCB_API_KEY)');
  return 建网关查询者();
}

function 翻错误(err) {
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
    message: 附注 ? `读取失败：${附注}` : `读取失败：${(err && err.message) || err}`,
  };
}

function 回(res, 状态码, 体) {
  res.writeHead(状态码, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization,content-type',
  });
  res.end(JSON.stringify(体));
}
const 成功 = (res, data) => 回(res, 200, { ok: true, data });
const 失败 = (res, 状态码, code, message) => 回(res, 状态码, { ok: false, error: { code, message } });

// 纯逻辑：把一堆 entry_id 聚合成榜单（契约 §3.11：fav_count 降序，同票按 entry_id 升序兜底）
function 算榜单(行, limit) {
  const 计数 = new Map();
  for (const r of 行) {
    if (!r || !r.entry_id) continue;
    计数.set(r.entry_id, (计数.get(r.entry_id) || 0) + 1);
  }
  const 全 = [...计数.entries()].map(([entry_id, fav_count]) => ({ entry_id, fav_count }));
  全.sort((a, b) => b.fav_count - a.fav_count || (a.entry_id < b.entry_id ? -1 : a.entry_id > b.entry_id ? 1 : 0));
  return { total: 全.length, items: 全.slice(0, limit) };
}

function 造处理({ 查询者 }) {
  return async function 处理(req, res) {
    const 路径 = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';

    if (路径 !== '/' && !路径.endsWith('/api/hot')) {
      return 失败(res, 404, 'NOT_FOUND', `没有这个接口：${路径}`);
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization,content-type',
        'access-control-allow-methods': 'GET,OPTIONS',
      });
      return res.end();
    }
    if (req.method !== 'GET') {
      return 失败(res, 405, 'METHOD_NOT_ALLOWED', `该接口只支持 GET，收到 ${req.method}`);
    }

    const u = new URL(req.url || '/', 'http://localhost');
    const 原limit = u.searchParams.get('limit');
    let limit = 默认条数;
    if (原limit !== null && 原limit.trim() !== '') {
      const 值 = 原limit.trim();
      if (!/^\d+$/.test(值)) return 失败(res, 400, 'BAD_REQUEST', 'limit 必须是整数');
      limit = Math.max(1, Math.min(parseInt(值, 10), 最大条数)); // 超上限就夹住
    }

    try {
      const 行 = await 查询者.聚合行();
      return 成功(res, 算榜单(行, limit));
    } catch (err) {
      console.error('[hot] 查询失败：', err && err.message);
      const 错 = 翻错误(err);
      return 失败(res, 500, 错.code, 错.message);
    }
  };
}

module.exports = { 造处理, 建默认查询者, 算榜单, 默认条数, 最大条数, SERVICE };

if (require.main === module) {
  let 查询者;
  try {
    查询者 = 建默认查询者();
  } catch (e) {
    查询者 = {
      聚合行: async () => {
        throw e;
      },
    };
    console.error('[hot] 取数初始化失败：', e.message);
  }

  http.createServer(造处理({ 查询者 })).listen(PORT, () => {
    console.log(`${SERVICE}/hot listening on ${PORT}`);
  });
}
