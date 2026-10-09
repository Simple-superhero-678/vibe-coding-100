'use strict';

/**
 * Day 19 线上回归：逐个真实调用已上线接口，记录「状态码 + 响应体原文」
 *
 * 不走浏览器，不需要页面 —— 直接 fetch 接口基址。
 * 覆盖：
 *   GET  /api/health
 *   GET  /api/favorites?user_id=<UUID>
 *   GET  /api/favorites?limit=abc            （400 校验）
 *   GET  /api/favorites                      （401 无身份）
 *   GET  /api/hot
 *   GET  /api/hot?limit=2
 *   POST /api/favorites                      （201 新增；重复再打一次应 409 FAV_DUPLICATE）
 *   PUT  /api/favorites                      （405 方法不支持）
 *
 * 结果同时写 tmp/day19-截图/线上返回.json，供作业截图用。
 */

const fs = require('fs');
const path = require('path');

const 基址 = (process.env.API_BASE || 'https://yishou-d9gyoykka49fb0634-1501173044.ap-shanghai.app.tcloudbase.com').replace(/\/+$/, '');
// ⚠️ 必须用 users 表里**真实存在**的 uuid：favorites.user_id 有外键指向它，
//    随手编一个 uuid 会被数据库判 23503 → 400 BAD_REQUEST（这是正确行为，不是 bug）
const UUID = '11111111-1111-4111-8111-111111111111';
const 输出 = path.resolve(__dirname, '..', '..', 'tmp', 'day19-截图', '线上返回.json');

// Day 20：写入用例改用带时间戳的唯一 id —— 固定 id 会在第二次跑回归时撞 409（Day 19 的残留已实证）
const 写入ID = 'yishou-regress-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const 清单 = [
  { 名: 'GET /api/health', method: 'GET', 路径: '/api/health' },
  { 名: 'GET /api/favorites（无身份）', method: 'GET', 路径: '/api/favorites' },
  { 名: 'GET /api/favorites?limit=abc', method: 'GET', 路径: `/api/favorites?user_id=${UUID}&limit=abc` },
  { 名: 'GET /api/favorites（正常）', method: 'GET', 路径: `/api/favorites?user_id=${UUID}` },
  { 名: 'GET /api/hot', method: 'GET', 路径: '/api/hot' },
  { 名: 'GET /api/hot?limit=2', method: 'GET', 路径: '/api/hot?limit=2' },
  { 名: 'POST /api/favorites（新增）', method: 'POST', 路径: `/api/favorites?user_id=${UUID}`, 体: { entry_id: 写入ID } },
  { 名: 'POST /api/favorites（重复 → 409）', method: 'POST', 路径: `/api/favorites?user_id=${UUID}`, 体: { entry_id: 写入ID } },
  { 名: 'PUT /api/favorites（405）', method: 'PUT', 路径: `/api/favorites?user_id=${UUID}` },
];

async function 跑一条(例) {
  const 选项 = { method: 例.method, headers: { accept: 'application/json' } };
  if (例.体) {
    选项.headers['content-type'] = 'application/json';
    选项.body = JSON.stringify(例.体);
  }
  const t0 = Date.now();
  try {
    const 响应 = await fetch(基址 + 例.路径, 选项);
    const 文本 = await 响应.text();
    let 体;
    try {
      体 = JSON.parse(文本);
    } catch (e) {
      体 = 文本.slice(0, 200);
    }
    return { 名: 例.名, method: 例.method, 路径: 例.路径, 状态码: 响应.status, 耗时ms: Date.now() - t0, 体 };
  } catch (e) {
    return { 名: 例.名, method: 例.method, 路径: 例.路径, 状态码: 0, 耗时ms: Date.now() - t0, 体: { 错: e.message } };
  }
}

(async () => {
  const 全 = [];
  for (const 例 of 清单) {
    const r = await 跑一条(例);
    全.push(r);
    console.log(`${String(r.状态码).padEnd(4)} ${r.method.padEnd(6)} ${例.路径}`);
    console.log(`     ${JSON.stringify(r.体).slice(0, 220)}`);
    console.log('');
  }

  fs.mkdirSync(path.dirname(输出), { recursive: true });
  fs.writeFileSync(输出, JSON.stringify({ 抓取时间: new Date().toISOString(), 基址, 结果: 全 }, null, 2), 'utf8');
  console.log(`已写入 ${输出}`);

  const 期 = [200, 401, 400, 200, 200, 200, 201, 409, 405];
  const 实 = 全.map((x) => x.状态码);
  console.log(`状态码期望：${期.join(' ')}`);
  console.log(`状态码实得：${实.join(' ')}`);
  console.log(JSON.stringify(期) === JSON.stringify(实) ? '==== 线上回归：9 / 9 符合预期 ====' : '❌ 有不符合预期的状态码');
})();
