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
 * ⭐ Day 19 分层重构：本文件**只保留接口层**，职责就三件 ——
 *     接请求（路由 / 方法分流 / 参数校验 / 读体 / 身份） → 调函数（仓库） → 返响应（契约形状）。
 *   「查数据库」那段代码**全部移到了同目录的** `./repositories/favoritesRepository.js`：
 *     · 网关 URL 拼接、Bearer 鉴权、content-range 解析          → 建网关仓库()
 *     · pg 连接池、参数化 SQL、to_char 时间格式、INSERT…RETURNING → 建pg仓库()
 *     · PG_URL 分流                                            → 建默认仓库()
 *     · SQLSTATE 挖掘（DATABASE_23505 归一化）、proxy-status 兜底 → 规范码/挖SQLSTATE/挖头SQLSTATE
 *     · 数据库错误码 → 契约 code + 人话（读的 & 写的）             → 翻错误 / 翻写入错误
 *   本文件从 575 行瘦到 ~230 行，且**不再出现任何 SQL / 网关地址 / 连接池**。
 *
 * 为什么 repository 放在函数目录内部（不放 cloudbase/repositories/ 共享）：
 *   `tcb fn deploy` 只打包**当前函数目录**，跨目录 require 在线上会找不到文件。
 *   所以每个函数目录各持一份本表的 repository —— 见 README「目录结构」。
 *
 * 数据通路（Day 17 定案，两条腿，**细节已收进仓库文件**）：
 *   ① 首选 CloudBase PG HTTP 网关（PostgREST 形态，官方推荐、免 VPC、免 pg 依赖）
 *   ② 备选 直连 TCP（pg 驱动）：配了 PG_URL 时走这条
 *   顺序：PG_URL 有值 → 走 ②；否则 → 走 ①。两条都不通就按 500 回人话。
 *
 * 结构上分两层，为了「能在本机自动验」：
 *   造处理({ 查询者 }) —— 纯逻辑：路由、参数校验、组装 JSON、错误码。查询者是注入的，可换假的
 *   建默认查询者()     —— 真取数（来自 ./repositories/favoritesRepository.js）
 * 好处：本机跑断言时注入假查询者，不装依赖、不连库、不联网。
 *
 * 临时身份（甲 方案，Day 17 立、Day 18 的 POST 沿用）：没有 Authorization 头时认
 *   ?user_id=<uuid>，有 Bearer 时取 Bearer 的值当 user_id。待 POST /api/auth/session 落地后删掉。
 *
 * Day 18 验收口径（重构后一字未改）：
 *   · POST 校验必填字段（中文报错）→ 插一行 → 回 201 {ok,data}
 *   · 防重复靠数据库唯一约束 UNIQUE(user_id, entry_id)，冲突（SQLSTATE 23505）
 *     翻成 409 FAV_DUPLICATE —— 不在代码里写「先查再插」（并发下会双插，契约 §2.2 记账）
 *   · 服务端日志：每次写入打一行 [favorites] 开头的记录，便于以后排查
 */

const http = require('http');
const 仓库 = require('./repositories/favoritesRepository.js');

const SERVICE = 'yishou';
const PORT = process.env.PORT || 9000; // Web 函数约定端口 9000

// 契约 §3.5：limit 默认 200、最大 500；offset 默认 0
const 默认条数 = 200;
const 最大条数 = 500;

// 只认 uuid 形态的 user_id（表里 user_id 是 uuid 列，格式不对不用去问数据库）
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 可信来源（Day 20）：线上 CORS 由网关反射承担；这份白名单只用于 OPTIONS 分支的本机直连自测。
// 与网关实测口径对齐：自己的静态托管域名 + 本机调试地址；不用 * 通配符。
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

// 时间归一化与错误翻译的实现也在仓库里 —— 这里转出去，本机断言继续用
const 收成UTC = 仓库.收成UTC;
const 规范码 = 仓库.规范码;
const 挖SQLSTATE = 仓库.挖SQLSTATE;
const 挖头SQLSTATE = 仓库.挖头SQLSTATE;
const 翻写入错误 = 仓库.翻写入错误;

/* ==========================================================================
 * 二、纯逻辑：路由 + 参数 + 组装响应（查询者注入）
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
  // CORS（Day 20 收紧）：函数侧**不再写** access-control-allow-origin ——
  // 实测 CloudBase 网关会对可信来源（本环境静态托管域名 / localhost / 127.0.0.1）反射 Origin，
  // 陌生来源（如 evil.com）不反射；函数再写一个 '*' 会被拼成 "反射值,*" 双值非法头，浏览器直接拒收。
  // 白名单语义由网关承担：只放行自己的域名 + 本机调试地址，正好满足「禁通配符」的要求。
  res.writeHead(状态码, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store', // 验收要「刷新后跟着变」，绝不能缓存
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
      const 错 = 仓库.翻错误(err);
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
      const 错 = 仓库.翻写入错误(err);
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
      // 预检（Day 20 收紧）：线上由网关整体接管（实测函数写的头会被替换成按请求反射的值）。
      // 这里的白名单回显只服务本机直连自测 —— 可信来源才回 CORS 头，不给通配符。
      const origin = req.headers.origin || '';
      const 头 = { 'access-control-allow-methods': 'GET,POST,OPTIONS' };
      if (可信来源.has(origin)) {
        头['access-control-allow-origin'] = origin;
        头['access-control-allow-headers'] = 'authorization,content-type';
      }
      res.writeHead(204, 头);
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
 * 三、导出（本机断言用）+ 启动（部署时用）
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
  仓库, // 需要单独验仓库（如网关 URL 构造）时用
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
