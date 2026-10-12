'use strict';

/**
 * Day 23：三类错误（输入错 / 网络错 / 服务端错）中文提示验证
 *
 * 跑法：node tools/day23-三类错误验证.js
 * 产出：控制台报告 + tmp/day23-三类错误.txt（供作业截图）
 *
 * 三条都走**真实代码**，不复制逻辑：
 *   ① 输入错   —— 起一个真云函数（favorites 的 造处理），真发一次 HTTP，读回来的 error.message
 *   ② 服务端错 —— 同上，但注入一个「一查就抛原始英文错」的假查询者，看对外是不是人话
 *   ③ 网络错   —— 真 import 前端 yizhi/js/api.js（搬进临时 ESM 沙盒），把 fetch 打瘸，捕获它抛的错
 *   最后把三条都过一遍前端 station.js 的 中文错误()，打印「用户实际看到的文案」。
 *
 * 为什么要沙盒：yizhi/js/*.js 是 ES Module，而本仓库没有 package.json。
 *   Node 默认把 .js 当 CommonJS → 直接 import 会 SyntaxError。
 *   所以把两个文件原样复制到临时目录 + 放一个 {"type":"module"} 的 package.json —— 测的还是真源码。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const 根 = path.resolve(__dirname, '..');
const UUID = '11111111-1111-4111-8111-111111111111';
const 报告行 = [];
function 记(s = '') {
  报告行.push(s);
  console.log(s);
}

/* —— 起一个真云函数 —— */
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
        res.on('end', () => resolve({ 状态码: res.statusCode, 体: Buffer.concat(块).toString('utf8') }));
      }
    );
    req.on('error', reject);
    if (体 !== null) req.write(体);
    req.end();
  });
}

/* —— 前端模块沙盒（真源码，不改一行）—— */
async function 装前端沙盒() {
  const 沙盒 = fs.mkdtempSync(path.join(os.tmpdir(), 'day23-前端-'));
  fs.copyFileSync(path.join(根, 'yizhi', 'js', 'api.js'), path.join(沙盒, 'api.js'));
  fs.copyFileSync(path.join(根, 'yizhi', 'js', 'station.js'), path.join(沙盒, 'station.js'));
  fs.writeFileSync(path.join(沙盒, 'package.json'), '{"type":"module"}', 'utf8');
  // station.js 顶层就 document.getElementById —— 给个最小桩，让它能加载
  globalThis.document = {
    getElementById: () => null,
    createElement: () => ({ style: {}, append() {}, setAttribute() {}, addEventListener() {}, querySelector: () => null, replaceChildren() {} }),
  };
  const 网址 = 'file://' + path.join(沙盒, 'station.js').replace(/\\/g, '/');
  return import(网址);
}

(async () => {
  const 收藏 = require(path.join(根, 'cloudbase', 'functions', 'favorites', 'index.web.js'));
  const 前端 = await 装前端沙盒();
  const 中文错误 = 前端.中文错误;
  if (typeof 中文错误 !== 'function') throw new Error('拿不到 station.js 的 中文错误 —— 检查它是不是 export 了');

  let 挂 = 0;
  const 断言 = (名, 过, 实得) => {
    记(`   ${过 ? 'PASS' : 'FAIL'}  ${名}` + (过 ? '' : `   ← 实得：${实得}`));
    if (!过) 挂++;
  };

  记('==============================================================');
  记(' 三类错误的中文提示 · 验证报告（Day 23）');
  记(' 时间：' + new Date().toISOString().replace('T', ' ').slice(0, 19));
  记('==============================================================');
  记('');

  /* ============ ① 输入错 ============ */
  记('① 输入错（请求本身不合法）—— 真发 HTTP 打真云函数');
  {
    const 假 = { 总数: async () => 0, 分页: async () => [], 新增: async () => ({}), 改备注: async () => ({}), 移除: async () => ({}) };
    const 服 = await 起服务(收藏.造处理({ 查询者: 假 }));
    try {
      const r = await 请求(服.端口, {
        method: 'POST',
        路径: `/api/favorites?user_id=${UUID}`,
        头: { 'content-type': 'application/json' },
        体: '{}',
      });
      const 体 = JSON.parse(r.体);
      记(`   HTTP ${r.状态码} · code=${体.error.code}`);
      记(`   服务端原文：${体.error.message}`);
      记(`   用户看到  ：${中文错误(体.error)}`);
      断言('输入错是中文', /[\u4e00-\u9fa5]/.test(体.error.message), 体.error.message);
      断言('输入错说清了缺什么（不是「参数错误」这种空话）', /entry_id/.test(体.error.message), 体.error.message);
    } finally {
      服.srv.close();
    }
  }
  记('');

  /* ============ ② 服务端错 ============ */
  记('② 服务端错（数据库甩了个认不出的错）—— 本次整改的主角');
  {
    const 原始英文 = 'relation "favorites" does not exist';
    const 假 = {
      总数: async () => {
        throw new Error(原始英文);
      },
      分页: async () => [],
      新增: async () => ({}),
      改备注: async () => ({}),
      移除: async () => ({}),
    };
    const 服 = await 起服务(收藏.造处理({ 查询者: 假 }));
    try {
      const r = await 请求(服.端口, { 路径: `/api/favorites?user_id=${UUID}`, 头: {} });
      const 体 = JSON.parse(r.体);
      记(`   HTTP ${r.状态码} · code=${体.error.code}`);
      记(`   改前（老代码把 err.message 原样拼进去）→  读取失败：${原始英文}`);
      记(`   改后（服务端返回的 message）        →  ${体.error.message}`);
      记(`   用户看到                            →  ${中文错误(体.error)}`);
      记(`   （上面那行 [数据层] 日志就是「对内留痕」——原始英文只进服务端日志，不出网）`);
      断言('服务端错是中文', /[\u4e00-\u9fa5]/.test(体.error.message), 体.error.message);
      断言('响应体里不再出现原始英文报错', !r.体.includes('does not exist'), r.体);
      断言('响应体里不再出现表名（不泄露内部结构）', !r.体.includes('favorites"'), r.体);
      断言('code 仍是契约里的 INTERNAL', 体.error.code === 'INTERNAL', 体.error.code);
    } finally {
      服.srv.close();
    }
  }
  记('');

  /* ============ ③ 网络错 ============ */
  记('③ 网络错（压根连不上）—— 真 import 前端 api.js，把 fetch 打瘸');
  {
    const 沙盒 = fs.mkdtempSync(path.join(os.tmpdir(), 'day23-网络-'));
    fs.copyFileSync(path.join(根, 'yizhi', 'js', 'api.js'), path.join(沙盒, 'api.js'));
    fs.writeFileSync(path.join(沙盒, 'package.json'), '{"type":"module"}', 'utf8');
    const { 取健康 } = await import('file://' + path.join(沙盒, 'api.js').replace(/\\/g, '/'));
    const 真fetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new TypeError('fetch failed');
    };
    let 抛了 = null;
    try {
      await 取健康();
    } catch (e) {
      抛了 = e;
    } finally {
      globalThis.fetch = 真fetch;
    }
    记(`   api.js 抛出：code=${抛了 && 抛了.code} · ${抛了 && 抛了.message}`);
    记(`   用户看到    ：${中文错误(抛了)}`);
    断言('网络错是中文', 抛了 && /[\u4e00-\u9fa5]/.test(抛了.message), 抛了 && 抛了.message);
    断言('网络错有专门的 code（前端可按 code 分档）', 抛了 && 抛了.code === 'NETWORK', 抛了 && 抛了.code);
  }
  记('');

  /* ============ 边角：英文/空的兜底 ============ */
  记('④ 边角兜底（表里没有的 code + 英文 message）—— 保证绝不糊 undefined 或英文');
  {
    const 怪 = { code: 'WEIRD_500', message: 'Internal Server Error' };
    记(`   输入：${JSON.stringify(怪)}`);
    记(`   用户看到：${中文错误(怪)}`);
    断言('认不出的 code 也有中文兜底', /[\u4e00-\u9fa5]/.test(中文错误(怪)), 中文错误(怪));
    const 空 = {};
    记(`   输入：${JSON.stringify(空)}（连 message 都没有）`);
    记(`   用户看到：${中文错误(空)}`);
    断言('连 message 都没有也不会显示 undefined', 中文错误(空) !== 'undefined' && /[\u4e00-\u9fa5]/.test(中文错误(空)), 中文错误(空));
  }

  记('');
  记('--------------------------------------------------------------');
  记(挂 === 0 ? `==== 三类错误中文提示：全部通过 ====` : `❌ 有 ${挂} 条断言没过`);

  const 出 = path.join(根, 'tmp', 'day23-三类错误.txt');
  fs.mkdirSync(path.dirname(出), { recursive: true });
  fs.writeFileSync(出, 报告行.join('\n'), 'utf8');
  console.log('已写入 ' + 出);
  process.exit(挂 === 0 ? 0 : 1);
})().catch((e) => {
  console.error('验证脚本自身出错：', e);
  process.exit(2);
});
