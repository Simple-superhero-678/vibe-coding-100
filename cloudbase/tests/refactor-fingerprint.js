'use strict';

/**
 * Day 19 专用：重构前后「逐字节行为比对」
 *
 * 思路（不依赖任何测试框架）：
 *   1. 把「重构前」的两个云函数副本（tmp/day19-基线/）复制到一个临时目录，各起一个 http 服务
 *   2. 把「重构后」的当前实现，各起一个 http 服务
 *   3. 用**同一份请求清单**（含 GET 与 POST）打两边，逐字节比对：
 *        状态码 + 关键响应头 + 响应体原文
 *   4. 任何一处不一致就打印 diff 并以非 0 退出
 *
 * 为什么值得单独做：单元断言验的是「函数被调用后返回什么」，
 * 这里验的是「同一个 HTTP 请求，两个版本吐出来的字节一模一样」——
 * 覆盖路由、方法分流、错误码、JSON 字段顺序，比断言更贴「线上行为不变」这句话。
 *
 * 跑法：node cloudbase/tests/refactor-fingerprint.js
 * 期望：==== 重构前后行为比对：22 / 22 一致 ====
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const 根 = path.resolve(__dirname, '..', '..');
const 基线目录 = path.join(根, 'tmp', 'day19-基线');

/* —— 假查询者：同时提供新旧两套方法名，保证两边都能跑起来 —— */
const 假数据 = [
  { entry_id: 'yishou-001', created_at: '2026-10-01T09:12:00.000Z' },
  { entry_id: 'yishou-003', created_at: '2026-10-02T11:30:00.000Z' },
  { entry_id: 'yishou-001', created_at: '2026-10-03T08:00:00.000Z' },
];

function 造假查询者() {
  const 列表 = () => 假数据.slice();
  return {
    总数: async () => 3,
    分页: async (user_id, limit, offset) => 列表().slice(offset, offset + limit),
    新增: async (user_id, entry_id) => ({ entry_id, created_at: '2026-10-04T01:02:03Z' }),
    总收藏数: async () => 3,
    收藏分页: async (user_id, limit, offset) => 列表().slice(offset, offset + limit),
    聚合行: async () => 列表().map((r) => ({ entry_id: r.entry_id })),
  };
}

function 起服务(处理) {
  return new Promise((resolve) => {
    const srv = http.createServer(处理);
    srv.listen(0, '127.0.0.1', () => resolve({ srv, 端口: srv.address().port }));
  });
}

function 请求(端口, { method = 'GET', 路径, 头 = {}, 体 = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: 端口, method, path: 路径, headers: 头 },
      (res) => {
        const 块 = [];
        res.on('data', (c) => 块.push(c));
        res.on('end', () =>
          resolve({
            状态码: res.statusCode,
            'content-type': res.headers['content-type'] || '',
            'cache-control': res.headers['cache-control'] || '',
            body: Buffer.concat(块).toString('utf8'),
          })
        );
      }
    );
    req.on('error', reject);
    if (体 !== null) req.write(体);
    req.end();
  });
}

const UUID = '11111111-2222-3333-4444-555555555555';

/* —— 请求清单：覆盖 GET 读、POST 写、参数校验、身份校验、方法分流 —— */
const 清单 = [
  { 名: 'GET 正常读取', 路径: `/api/favorites?user_id=${UUID}`, 头: {} },
  { 名: 'GET 只取 1 条', 路径: `/api/favorites?user_id=${UUID}&limit=1&offset=1`, 头: {} },
  { 名: 'GET limit 非整数', 路径: `/api/favorites?user_id=${UUID}&limit=abc`, 头: {} },
  { 名: 'GET offset 非整数', 路径: `/api/favorites?user_id=${UUID}&offset=-1`, 头: {} },
  { 名: 'GET 无身份 401', 路径: '/api/favorites', 头: {} },
  { 名: 'GET 身份非 uuid 400', 路径: '/api/favorites?user_id=nope', 头: {} },
  { 名: 'GET 走 Bearer 头', 路径: '/api/favorites', 头: { authorization: `Bearer ${UUID}` } },
  { 名: 'GET 路径带前缀', 路径: `/x/api/favorites?user_id=${UUID}`, 头: {} },
  { 名: 'GET 不存在的接口', 路径: `/api/nope?user_id=${UUID}`, 头: {} },
  { 名: 'POST 正常新增 201', method: 'POST', 路径: `/api/favorites?user_id=${UUID}`, 头: { 'content-type': 'application/json' }, 体: '{"entry_id":"yishou-001"}' },
  { 名: 'POST 缺 entry_id 400', method: 'POST', 路径: `/api/favorites?user_id=${UUID}`, 头: { 'content-type': 'application/json' }, 体: '{}' },
  { 名: 'POST entry_id 空串 400', method: 'POST', 路径: `/api/favorites?user_id=${UUID}`, 头: { 'content-type': 'application/json' }, 体: '{"entry_id":"   "}' },
  { 名: 'POST entry_id 超长 400', method: 'POST', 路径: `/api/favorites?user_id=${UUID}`, 头: { 'content-type': 'application/json' }, 体: `{"entry_id":"${'x'.repeat(65)}"}` },
  { 名: 'POST 体不是 JSON 400', method: 'POST', 路径: `/api/favorites?user_id=${UUID}`, 头: { 'content-type': 'application/json' }, 体: 'not json' },
  { 名: 'POST 体是数组 400', method: 'POST', 路径: `/api/favorites?user_id=${UUID}`, 头: { 'content-type': 'application/json' }, 体: '[]' },
  { 名: 'POST 无身份 401', method: 'POST', 路径: '/api/favorites', 头: { 'content-type': 'application/json' }, 体: '{"entry_id":"a"}' },
  { 名: 'POST 未知方法 PUT 405', method: 'PUT', 路径: `/api/favorites?user_id=${UUID}`, 头: {} },
  { 名: 'OPTIONS 预检 204', method: 'OPTIONS', 路径: '/api/favorites', 头: {} },
  { 名: 'GET hot 榜单', 路径: '/api/hot', 头: {} },
  { 名: 'GET hot limit=2', 路径: '/api/hot?limit=2', 头: {} },
  { 名: 'GET hot limit 超上限夹住', 路径: '/api/hot?limit=999', 头: {} },
  { 名: 'GET hot limit 非整数 400', 路径: '/api/hot?limit=x', 头: {} },
];

/* —— 把两份实现各起服务 —— */

function 加载实现(目录, 名) {
  // 用绝对路径 require，避免缓存串味
  return require(path.join(目录, 名));
}

async function 主流程() {
  // 基线：先把 tmp/day19-基线 拷成「像函数目录一样」的结构
  const 基线根 = fs.mkdtempSync(path.join(os.tmpdir(), 'day19-基线-'));
  fs.copyFileSync(path.join(基线目录, 'favorites.index.web.js'), path.join(基线根, 'favorites.baseline.js'));
  fs.copyFileSync(path.join(基线目录, 'hot.index.web.js'), path.join(基线根, 'hot.baseline.js'));

  const 前收藏 = 加载实现(基线根, 'favorites.baseline.js');
  const 前热门 = 加载实现(基线根, 'hot.baseline.js');
  const 后收藏 = require(path.join(根, 'cloudbase', 'functions', 'favorites', 'index.web.js'));
  const 后热门 = require(path.join(根, 'cloudbase', 'functions', 'hot', 'index.web.js'));

  const 假 = 造假查询者();

  const 前收藏服 = await 起服务(前收藏.造处理({ 查询者: 假 }));
  const 前热门服 = await 起服务(前热门.造处理({ 查询者: 假 }));
  const 后收藏服 = await 起服务(后收藏.造处理({ 查询者: 假 }));
  const 后热门服 = await 起服务(后热门.造处理({ 查询者: 假 }));

  let 过 = 0;
  let 挂 = 0;

  try {
    for (const 例 of 清单) {
      const 是热门 = 例.路径.includes('/api/hot');
      const 前 = await 请求(是热门 ? 前热门服.端口 : 前收藏服.端口, 例);
      const 后 = await 请求(是热门 ? 后热门服.端口 : 后收藏服.端口, 例);
      const 相等 = JSON.stringify(前) === JSON.stringify(后);
      if (相等) {
        过++;
        console.log(`PASS  ${例.名}`);
      } else {
        挂++;
        console.log(`FAIL  ${例.名}`);
        console.log(`      前：${JSON.stringify(前)}`);
        console.log(`      后：${JSON.stringify(后)}`);
      }
    }
  } finally {
    前收藏服.srv.close();
    前热门服.srv.close();
    后收藏服.srv.close();
    后热门服.srv.close();
  }

  console.log('');
  console.log(`==== 重构前后行为比对：${过} / ${清单.length} 一致 ====`);
  if (挂 > 0) {
    console.log(`❌ 有 ${挂} 处不一致 —— 重构改变了对外行为，必须修`);
    process.exit(1);
  }
}

主流程().catch((e) => {
  console.error('比对脚本自身出错：', e);
  process.exit(2);
});
