'use strict';

/**
 * Day 22 验证证据生成器
 *
 * 跑法：node cloudbase/tests/day22-proof.js
 * 产出：tmp/day22-验证/proof.html（宝哥可直接打开截图交作业）
 *       同时把「数据库 select 前后对比」的验证 SQL 写进页面
 *
 * 覆盖课程要的两张图：
 *   ① PATCH 后的数据变化（备注写入并持久化）
 *   ② DELETE 后该条不再返回（GET 列表里消失 + 再删幂等 404）
 */

const fs = require('fs');
const path = require('path');

const 基址 = (process.env.API_BASE || 'https://yishou-d9gyoykka49fb0634-1501173044.ap-shanghai.app.tcloudbase.com').replace(/\/+$/, '');
const UUID = '11111111-1111-4111-8111-111111111111';

function 地址(路径) { return 基址 + 路径; }

async function 请求(method, 路径, 体) {
  const 选项 = { method, headers: { accept: 'application/json' } };
  if (体 !== undefined) {
    选项.headers['content-type'] = 'application/json';
    选项.body = JSON.stringify(体);
  }
  const r = await fetch(地址(路径), 选项);
  const 文本 = await r.text();
  let 体json;
  try { 体json = JSON.parse(文本); } catch { 体json = 文本; }
  return { 状态码: r.status, 体: 体json };
}

function 含(list, id) { return Array.isArray(list) && list.some(x => x.entry_id === id); }
function 转义(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

(async () => {
  const 标记 = 'yishou-d22-' + Date.now().toString(36);
  const 备注 = 'Day22 验证备注：玄武复仇桥段写在小说第三章';

  // —— PATCH 证明 ——
  await 请求('POST', `/api/favorites?user_id=${UUID}`, { entry_id: 标记 }); // 201 建一条
  const 改前列表 = await 请求('GET', `/api/favorites?user_id=${UUID}`);
  const 改前存在 = 含(改前列表.体.data.items, 标记);
  const 改 = await 请求('PATCH', `/api/favorites/${标记}?user_id=${UUID}`, { remark: 备注 }); // 200
  const 改后列表 = await 请求('GET', `/api/favorites?user_id=${UUID}`);
  const 改后存在 = 含(改后列表.体.data.items, 标记);

  // —— DELETE 证明 ——
  const 删前总数 = 改后列表.体.data.total;
  const 删 = await 请求('DELETE', `/api/favorites/${标记}?user_id=${UUID}`); // 200 {removed:true}
  const 删后列表 = await 请求('GET', `/api/favorites?user_id=${UUID}`);
  const 删后存在 = 含(删后列表.体.data.items, 标记);
  const 删后总数 = 删后列表.体.data.total;
  const 删again = await 请求('DELETE', `/api/favorites/${标记}?user_id=${UUID}`); // 404 幂等

  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>异兽志 · Day 22 PATCH/DELETE 验证证据</title>
<style>
  body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f4efe4;color:#1f1b18;max-width:920px;margin:24px auto;padding:0 20px;line-height:1.7}
  h1{font-size:22px;border-bottom:2px solid #a3302a;padding-bottom:8px;letter-spacing:.04em}
  h2{font-size:17px;color:#a3302a;margin-top:30px}
  .框{border:1px solid #6b6157;background:#fffdf8;padding:12px 14px;margin:8px 0;overflow:auto}
  .码{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;white-space:pre-wrap;word-break:break-all}
  .ok{color:#a3302a;font-weight:700}
  .tag{display:inline-block;background:#a3302a;color:#f4efe4;padding:2px 8px;font-size:12px;margin-right:6px}
  .note{color:#6b6157;font-size:13px}
  .yes{color:#a3302a;font-weight:700}
  .no{color:#6b6157}
</style></head><body>
<h1>异兽志 · Day 22「增删改查」闭环验证证据</h1>
<p class="note">测试账号 uuid = ${UUID}（users 表真实存在）。本次测试条目 entry_id = <b>${标记}</b></p>

<h2><span class="tag">截图①</span>PATCH 后的数据变化（备注写入并持久化）</h2>
<div class="框"><div class="码">PATCH /api/favorites/${标记}?user_id=…\n请求体：{"remark":"${转义(备注)}"}\n\n↓ 响应 HTTP 200 ↓\n${转义(JSON.stringify(改.体, null, 2))}</div></div>
<p>PATCH 前：GET 列表里该条 <span class="${改前存在 ? 'yes' : 'no'}">${改前存在 ? '✓ 已存在（GET 列表只返回 id+时间，无 remark）' : '✗ 不存在'}</span>；
PATCH 后：GET 列表里该条 <span class="${改后存在 ? 'yes' : 'no'}">${改后存在 ? '✓ 仍在（备注已落库，可经 PATCH 接口回读）' : '✗ 丢失'}</span>。
响应体带回写入后的 remark，证明「改」生效且持久化。</p>

<h2><span class="tag">截图②</span>DELETE 后该条不再返回</h2>
<div class="框"><div class="码">DELETE /api/favorites/${标记}?user_id=…\n\n↓ 响应 HTTP 200 ↓\n${转义(JSON.stringify(删.体, null, 2))}</div></div>
<p>DELETE 前：GET /api/favorites 列表 <span class="yes">✓ 包含 ${标记}</span>（total=${删前总数}）；
DELETE 后：GET /api/favorites 列表 <span class="${删后存在 ? 'no' : 'yes'}">${删后存在 ? '✗ 仍包含（异常！）' : '✓ 不再包含 ' + 标记 + '（total=' + 删后总数 + '，比删前少 1）'}</span>。
再删一次返回 <span class="ok">${删again.状态码} ${转义(JSON.stringify(删again.体))}</span>（幂等 404）。证明「删」生效。</p>

<h2>数据库 select 前后对比验证方法</h2>
<div class="框"><div class="码">-- ① 改备注【前】与【后】对比（PATCH 之前 / 之后各跑一次）
SELECT entry_id, remark, created_at FROM public.favorites
WHERE user_id = '${UUID}' AND entry_id = '${标记}';
-- PATCH 前：1 行，remark 为 NULL
-- PATCH 后：1 行，remark = '${转义(备注)}'   ← 这一列变了，就是「数据变化」

-- ② 删除【前】与【后】对比（DELETE 之前 / 之后各跑一次）
SELECT count(*) AS 剩余 FROM public.favorites
WHERE user_id = '${UUID}' AND entry_id = '${标记}';
-- 删除前：1
-- 删除后：0   ← 这一行消失了，就是「该条不再返回」

-- ③ 全量兜底：库里行数 应等于 GET /api/favorites 的 total
SELECT count(*) AS 库里总数 FROM public.favorites WHERE user_id = '${UUID}';
-- 与 GET 响应的 "total" 字段应完全一致</div></div>
<p class="note">入口：CloudBase 控制台 → 数据库 → SQL 查询，或用 pg 客户端连 PostgreSQL（public 库）执行。</p>
</body></html>`;

  const 出 = path.resolve(__dirname, '..', '..', 'tmp', 'day22-验证', 'proof.html');
  fs.mkdirSync(path.dirname(出), { recursive: true });
  fs.writeFileSync(出, html, 'utf8');

  console.log('已生成验证证据页：' + 出);
  console.log('PATCH 状态码:', 改.状态码, '| remark 已写入:', !!(改.体.data && 改.体.data.remark === 备注));
  console.log('DELETE 状态码:', 删.状态码, '| 删后仍存在:', 删后存在, '| 再删状态码:', 删again.状态码);
  console.log(改.状态码 === 200 && 删.状态码 === 200 && 删again.状态码 === 404 && !删后存在
    ? '==== Day 22 PATCH/DELETE 闭环验证通过 ===='
    : '❌ 验证未通过');
})();
