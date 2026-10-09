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
 * ⭐ Day 19 分层重构：本文件**只保留接口层** —— 路由 / 参数校验 / JSON 组装 / 错误码。
 *   「查数据库」那段代码**全部移到了同目录的** `./repositories/favoritesRepository.js`：
 *     · 网关 URL 拼接、Bearer 鉴权、limit 拼接   → 建网关仓库()
 *     · pg 连接池、参数化 SQL                    → 建pg仓库()
 *     · PG_URL 分流                              → 建默认仓库()
 *     · 数据库错误码 → 契约 code + 人话            → 翻错误
 *   ⚠️ 聚合（算榜单）**留在本层**：它不是「取数」，是纯业务计算（可单测、不碰 IO），
 *   放接口层才符合「仓库只管取数、逻辑在接口层」的分层口径。
 *
 * ⚠️ 聚合为什么在 JS 里做：CloudBase 网关是 PostgREST 形态，**不支持 GROUP BY**，
 *   所以取回 entry_id 列表（上限 5000 行）后在 JS 里计数排序 —— 当前量级
 *   （个位数~千级）完全够用；将来若收藏量上万，再改成 PG 视图或 RPC（契约 §3.11 记账）。
 *
 * 为什么 repository 放在函数目录内部（不放 cloudbase/repositories/ 共享）：
 *   `tcb fn deploy` 只打包**当前函数目录**，跨目录 require 在线上会找不到文件。
 *   所以 favorites / hot 各持一份 —— 见 README「目录结构」。
 *
 * 认证：否（榜单是聚合结果，不含任何个人信息）
 * 参数：limit（默认 10、最大 50）
 *
 * 结构上分两层，为了「能在本机自动验」：
 *   造处理({ 查询者 }) —— 纯逻辑：路由、参数校验、组装 JSON、错误码。查询者是注入的，可换假的
 *   建默认查询者()     —— 真取数（来自 ./repositories/favoritesRepository.js）
 */

const http = require('http');
const 仓库 = require('./repositories/favoritesRepository.js');

const SERVICE = 'yishou';
const PORT = process.env.PORT || 9000;

const 默认条数 = 10;
const 最大条数 = 50;

// 可信来源（Day 20）：线上 CORS 由网关反射承担；这份白名单只用于 OPTIONS 分支的本机直连自测。
const 可信来源 = new Set([
  'https://yishou-d9gyoykka49fb0634-1501173044.tcloudbaseapp.com',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
]);

/* ==========================================================================
 * 一、真取数（= 仓库；本文件只转发，不自己连库）
 * ========================================================================== */

// 保留这个名字，接口层与线上入口都用它；实现已搬到 repositories/
function 建默认查询者(选项) {
  return 仓库.建默认仓库(选项);
}

const 翻错误 = 仓库.翻错误;

/* ==========================================================================
 * 二、纯逻辑：路由 + 参数 + 组装响应（查询者注入）
 * ========================================================================== */

function 回(res, 状态码, 体) {
  // CORS（Day 20 收紧）：函数侧不再写 access-control-allow-origin ——
  // 网关会对可信来源（本环境静态托管域名 / localhost / 127.0.0.1）反射 Origin，
  // 函数写的 '*' 会与反射值拼成 "值,*" 双值非法头（Day 20 实测），浏览器直接拒收。
  res.writeHead(状态码, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
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
      // 预检（Day 20 收紧）：线上由网关整体接管；这里的白名单回显只服务本机直连自测。
      const origin = req.headers.origin || '';
      const 头 = { 'access-control-allow-methods': 'GET,OPTIONS' };
      if (可信来源.has(origin)) {
        头['access-control-allow-origin'] = origin;
        头['access-control-allow-headers'] = 'authorization,content-type';
      }
      res.writeHead(204, 头);
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
      const 错 = 仓库.翻错误(err);
      return 失败(res, 500, 错.code, 错.message);
    }
  };
}

module.exports = { 造处理, 建默认查询者, 算榜单, 默认条数, 最大条数, SERVICE, 仓库 };

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
