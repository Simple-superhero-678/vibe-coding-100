// 异兽志 · 后端检查台（Day 20）
//
// 这是什么：首页上的一块「牌记」—— 现场向公网接口要三样东西并如实展示：
//   ① 健康状态（GET /api/health）
//   ② favorites 表的真实行（GET /api/favorites?user_id=…）—— 控制台改数据，刷新这里就跟着变
//   ③ 一次写入测试（POST /api/favorites）
//
// 分层纪律：
//   · 数据只从 js/api.js 来 —— 本文件不知道接口地址，不自己 fetch；
//   · 不 import store.js（收藏的本地存取与 Day 21 的完整接口接线是另一回事）；
//   · 不进 main.js 的部形态渲染主链路 —— 自己挂自己的事件，main.js 一行不改。
//   · 「空 ≠ 错」（TECH_DESIGN §9）：读到 {total:0} 铺「空表」；连不上才铺「错」+ 重试。
//
// 写入测试用固定 id「yishou-station」：第一次 201 写进去，之后 409 被唯一约束拦下 ——
// 两种返回都是「接口在真实工作」的证据，且不会每次点击都往库里堆垃圾行。

import { 取健康, 取收藏表, 写收藏表, 重复码 } from './api.js';

const 台 = document.getElementById('检查台');
const 测试id = 'yishou-station';

/* —— 小工具 —— */

function 建格(题) {
  const 格 = document.createElement('div');
  格.className = 'station-cell';
  const 题$ = document.createElement('span');
  题$.className = 'station-cell-t';
  题$.textContent = 题;
  格.append(题$);
  return 格;
}

function 建点(类名) {
  const 点 = document.createElement('span');
  点.className = 'station-dot ' + 类名;
  return 点;
}

/** 把 2026-10-01T09:12:00Z 缩成 10-01 09:12（本地时区） */
function 短时间(原文) {
  const 时 = new Date(原文);
  if (isNaN(时)) return 原文; // 解析不了就原样亮出来，不装懂
  const 双 = (数) => String(数).padStart(2, '0');
  return `${双(时.getMonth() + 1)}-${双(时.getDate())} ${双(时.getHours())}:${双(时.getMinutes())}`;
}

/* —— 三格内容 —— */

// 落终态 = 整格重建（题 + 点 + 文案）。
// ⚠️ 不能只 append：「读取中…」占位若不同步撤掉，格子文本永远含「读取中」，
// 上一版就栽在这里（占位残留 → 「空≠错」的判定和自动化探针全被它骗了）。
function 落内容(格, 点类, 文本) {
  const 题 = 格.querySelector('.station-cell-t');
  const 文 = document.createElement('span');
  文.textContent = 文本;
  格.replaceChildren(题, 建点(点类), 文);
}

function 落错(格, 因) {
  const 题 = 格.querySelector('.station-cell-t');
  const 文 = document.createElement('span');
  文.textContent = `读不到：${因.message}`;
  const 重试 = document.createElement('button');
  重试.type = 'button';
  重试.className = 'station-retry';
  重试.textContent = '重试';
  重试.addEventListener('click', () => 刷新());
  格.replaceChildren(题, 建点('点-坏'), 文, 重试);
}

async function 铺健康(格) {
  try {
    const 数据 = await 取健康();
    落内容(格, '点-好', `服务正常（${数据.service}）`);
  } catch (因) {
    落错(格, 因);
  }
}

async function 铺收藏表(格) {
  try {
    const 数据 = await 取收藏表(3);
    let 文本;
    if (!数据.total) {
      // 空 ≠ 错：读到了，只是这位用户还没有收藏行
      文本 = 'favorites 表（该用户）：空表（0 行）';
    } else {
      const 近 = 数据.items
        .map((行) => `${行.entry_id}（${短时间(行.created_at)}）`)
        .join(' · ');
      // 接口固定 created_at 升序 → 这三条是表里最早的几条，文案用中性「含」不失实
      文本 = `${数据.total} 行真实数据 · 含：${近}`;
    }
    落内容(格, '点-好', 文本);
    格.lastChild.title = '来自 GET /api/favorites —— 在数据库控制台改这行数据，刷新页面就会跟着变';
  } catch (因) {
    落错(格, 因);
  }
}

/* —— 写入测试 —— */

async function 写入测试(格, 钮) {
  钮.setAttribute('aria-disabled', 'true'); // 组件基线：弱化 + not-allowed，文案还在
  const 记 = 格.querySelector('.station-log');
  记.textContent = '写入中…';
  try {
    const 行 = await 写收藏表(测试id);
    记.textContent = `201 · 写进去了：${行.entry_id}（${短时间(行.created_at)}）—— POST 真实落库`;
    // ⚠️ 只重拉 favorites 那一格，不能 整台刷新() —— 整台重建会把刚写的结果 log 冲掉
    if (数据格引用) await 铺收藏表(数据格引用);
  } catch (因) {
    if (因.code === 重复码) {
      记.textContent = '409 · 接口拦下了重复写入（唯一约束在工作，没有堆垃圾行）';
    } else {
      记.textContent = `写入失败：${因.message}`;
    }
  } finally {
    钮.removeAttribute('aria-disabled');
  }
}

/* —— 骨架与刷新 —— */

let 数据格引用 = null; // 写入成功后只重拉这一格（整台重建会把写入结果 log 冲掉）

function 铺骨架() {
  台.replaceChildren();

  const 题 = document.createElement('span');
  题.className = 'station-mark';
  题.textContent = '后端检查台';
  题.title = '数据实时来自公网接口（CloudBase 云函数 + PostgreSQL）';
  台.append(题);

  const 栏 = document.createElement('div');
  栏.className = 'station-grid';
  台.append(栏);

  const 健康格 = 建格('健康');
  const 数据格 = 建格('favorites 表');
  const 写格 = 建格('写入测试');
  栏.append(健康格, 数据格, 写格);
  数据格引用 = 数据格;

  const 钮 = document.createElement('button');
  钮.type = 'button';
  钮.className = 'station-act';
  钮.textContent = '写一条进收藏表';
  钮.addEventListener('click', () => 写入测试(写格, 钮));
  写格.append(钮);

  const 记 = document.createElement('span');
  记.className = 'station-log';
  记.setAttribute('role', 'status');
  写格.append(记);

  // 先铺「读取中」，再让三格各自去拉 —— 谁先回来谁先落，互不阻塞
  for (const 格 of [健康格, 数据格]) {
    const 等 = document.createElement('span');
    等.className = 'station-wait';
    等.textContent = '读取中…';
    格.append(等);
  }
  return { 健康格, 数据格 };
}

async function 刷新() {
  const { 健康格, 数据格 } = 铺骨架();
  await Promise.allSettled([铺健康(健康格), 铺收藏表(数据格)]);
}

/* 挂载：HTML 里没这个 section（比如旧版缓存）就静默退出，别把页面弄挂 */
if (台) {
  刷新();
} else {
  console.warn('[station] 页面上没有 #检查台，跳过挂载。');
}
