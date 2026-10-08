'use strict';

/**
 * favoritesRepository.js —— `public.favorites` 表的**唯一**数据访问入口（hot 函数这一份）
 *
 * 分层位置（Day 19 拆出）：
 *   接口层 index.web.js  ← 只做「接请求 → 调本文件 → 返响应」
 *   数据访问层 本文件    ← 所有 SQL / 网关 URL / 连接池 / 时间归一化 / 错误码翻译，全部在这
 *
 * 为什么放在函数目录内部（而不是 cloudbase/repositories/ 共享一份）：
 *   `tcb fn deploy` 只打包**当前函数目录**，跨目录 require 在线上会找不到文件。
 *   所以 favorites / hot 各自持有一份同表的 repository —— 代码是重复的，
 *   但每个函数目录都能独立部署，这是该部署模型下的正确取舍（Day 19 记账）。
 *
 * 与 favorites 那份的差异（刻意保留的取舍，别顺手「统一」）：
 *   hot 只读、只聚合，**不需要** 总数/分页/新增，也不需要 SQLSTATE 挖掘与写错误翻译。
 *   它要的是「把全表的 entry_id 拉回来自己在 JS 里计数」——
 *   因为 CloudBase 网关是 PostgREST 形态**不支持 GROUP BY**（契约 §3.11 已记这笔账）。
 *
 * 对外只暴露：
 *   建默认仓库()  —— 读环境变量选通路（PG_URL 有值走 pg，否则走网关）
 *   建网关仓库()  —— 通路①：CloudBase PG HTTP 网关（PostgREST 形态）
 *   建pg仓库()    —— 通路②：pg 驱动 TCP 直连
 *   三个都返回同一套方法签名（**只读**）：
 *     · 聚合行()  → [{ entry_id }]（上限 取回上限 行，聚合由接口层的 算榜单 做）
 *   另导出 翻错误(err, 动作) 供接口层把取数失败翻成 500 人话。
 *
 * 依据：api-contract.md §3.11、cloudbase/README.md「数据通路」。
 */

const 取回上限 = 5000; // 一次最多拉这么多行来聚合（当前量级个位数~千级，够用）

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
    // 全表的 entry_id 拉回来（不做聚合 —— 网关不支持 GROUP BY），由接口层算榜单
    async 聚合行() {
      const { 文本 } = await 取(`/favorites?select=entry_id&limit=${取回上限}`);
      return JSON.parse(文本).map((r) => ({ entry_id: r.entry_id }));
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

  return {
    async 聚合行() {
      return (await 池.query('SELECT entry_id FROM public.favorites LIMIT $1', [取回上限])).rows;
    },
  };
}

/* ==========================================================================
 * 3. 通路选择（接口层只调这个）
 * ========================================================================== */

function 建默认仓库({ 标签 = 'hot' } = {}) {
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

module.exports = {
  建默认仓库,
  建网关仓库,
  建pg仓库,
  翻错误,
  取回上限,
};
