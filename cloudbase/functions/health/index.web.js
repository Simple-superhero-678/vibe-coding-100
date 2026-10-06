'use strict';

/**
 * health —— 「HTTP 云函数（Web 函数）」版
 *
 * 用在哪：CloudBase 控制台「创建云函数 → 通过模板创建 → HTTP 云函数 → Node.js Hello World」
 * 这条路子下，函数自己是一个 web 服务（模板自带的 scf_bootstrap 负责把它拉起来）。
 * 所以本文件用 Node 内置 http 模块起服务、监听 9000。
 *
 * 只实现 GET /api/health，不连数据库、不读环境变量、无业务逻辑（Day 15 范围）。
 * 模板自带的 scf_bootstrap / package.json 都不用动，只把 index.js 换成这份。
 */

const http = require('http');

const SERVICE = 'yishou';                 // 项目英文名，与 data/*.json 里 id 前缀（yishou-）一致
const PORT = process.env.PORT || 9000;    // Web 函数约定端口 9000

const server = http.createServer((req, res) => {
  // 只取路径，丢掉查询串
  const path = (req.url || '/').split('?')[0];

  const send = (code, obj) => {
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store', // 健康检查不缓存
    });
    res.end(JSON.stringify(obj));
  };

  // 只认 GET
  if (req.method !== 'GET') {
    return send(405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  // 两种都放行，避免路由「是否剥掉前缀」带来的不确定性：
  //   ① 网关把 /api/health 原样透传  → path = /api/health
  //   ② 网关剥掉前缀后转给函数      → path = /
  if (path === '/' || path.endsWith('/api/health')) {
    return send(200, { ok: true, service: SERVICE }); // 契约：{ "ok": true, "service": "yishou" }
  }

  return send(404, { ok: false, error: 'NOT_FOUND' });
});

server.listen(PORT, () => {
  console.log(`health listening on ${PORT}`);
});
