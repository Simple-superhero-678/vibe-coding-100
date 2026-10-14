// 异兽志 · 收藏层（F5）
// 契约（TECH_DESIGN §6.2）：
//   const KEY = 'yishou.fav.v1'
//   list()            → string[]         收藏的 id 列表
//   has(id)           → boolean
//   toggle(id)        → boolean          返回切换后的状态
//   remove(id)        → void
//   exportText(条目[]) → string          导出文本：名 + 原文 + 出处 + 写小说怎么用
//   复制到剪贴板(文本) → Promise<boolean>
//   下载txt(文本)      → void
//
// 分层目的（TECH_DESIGN §12.5）：视图层不认识「收藏存在哪」。
// 加后端只改这个文件，views/* 与装配层（main.js）一行不动。
//
// Day 28 起接入后端（方案 A · 最小打通）：
//   收藏的真源从 localStorage 迁到 CloudBase `public.favorites` 表。
//   对外接口仍全部同步（list/has/toggle/remove），内部维护一份内存缓存：
//     启动时 同步云端() 从云端拉全量 id 进缓存；toggle/remove 先改缓存、再异步写云端。
//   localStorage 退为「离线/接口挂了」的降级读源，不再作为唯一真源。
//   ⚠️ 临时口径：身份沿用 Day 17 的 `?user_id=<uuid>`（展示用户），真 token 落地后换成登录用户。
//
// 为什么 key 要带版本号（§12.3）：将来收藏的数据结构变了 → 起 yishou.fav.v2，
// 旧 key 原样留着，读的时候合并或提示一次；不要原地改结构试运气。
// 这个 key 只在本文件出现一次，要改只改这一处。

import { 取收藏id, 写收藏表, 删收藏表 } from './api.js';

export const KEY = 'yishou.fav.v1';

/* —— 存储后端 ——
   本机浏览器正常时是 localStorage；隐私模式 / 被策略禁用时（TECH_DESIGN §9-7）
   localStorage 的「读」就可能直接抛异常，所以连探测都要包在 try 里。
   降级目标：内存态（本次会话有效），浏览功能一律不受影响，只在控制台留一句。 */
const 内存兜底 = new Set();
let 用兜底 = false;

/* 云端缓存：list()/has() 的同步真源。启动时 同步云端() 填一次。 */
let 内存ids = null;
/* 云端是否在线（上次同步成功与否）。在线时读缓存、写云端；离线时回落 localStorage。 */
let 云端在线 = false;
/* 是否已经发起过首次同步（避免并发重复拉） */
let 同步承诺 = null;

/* 探测一次：能写能读能删，才算可用。只 try 一次 setItem 不够 ——
   Safari 老版本的隐私模式 setItem 抛异常，而有的环境 setItem 静默失败、getItem 返回 null。 */
function 探测存储() {
  try {
    const 探针 = '__yishou_probe__';
    localStorage.setItem(探针, '1');
    const 回读 = localStorage.getItem(探针);
    localStorage.removeItem(探针);
    return 回读 === '1';
  } catch {
    return false;
  }
}

if (!探测存储()) {
  用兜底 = true;
  console.warn('[store] localStorage 不可用，收藏降级为内存态（本次会话有效，关掉页面就没了）。');
}

/** 存储当前是否可用（main.js 拿去决定要不要在页面上说一句） */
export function 可用() {
  return !用兜底;
}

/* —— 读写 ——
   存的一律是「id 数组」。为什么不存整个条目对象：
   条目的真源是 data/*.json，存副本 = 同一份内容两个真源，改了 JSON 收藏里还是旧文。
   存 id 就是存一个指针，条目内容永远现读现用。 */

function 读原始() {
  if (用兜底) return [...内存兜底];
  try {
    const 文 = localStorage.getItem(KEY);
    if (!文) return [];
    const 值 = JSON.parse(文);
    /* 存进来的东西不完全可信（用户可能手改过、也可能是更早的版本）：
       不是数组就当空，滤掉非字符串，去重 —— 让上层永远拿到干净的 id 数组。 */
    if (!Array.isArray(值)) {
      console.warn('[store] 收藏数据不是数组，按空处理：', 值);
      return [];
    }
    return [...new Set(值.filter(项 => typeof 项 === 'string' && 项))];
  } catch (因) {
    /* 解析失败 = 数据坏了。不静默清空用户的东西，也不让页面崩：
       本次读作空数组（页面照常能用），原值留在 localStorage 里等人排查。 */
    console.error('[store] 收藏数据解析失败，本次按空处理（原值未改动）：', 因);
    return [];
  }
}

function 写原始(ids) {
  if (用兜底) {
    内存兜底.clear();
    ids.forEach(id => 内存兜底.add(id));
    return;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch (因) {
    /* 写满（QuotaExceeded）或写被拒 —— 硬要求：不清空用户已有的收藏（§9-8）。
       这里什么也不做，让 toggle 的返回值如实反映「没存上」，由 main.js 提示。 */
    console.error('[store] 收藏写入失败（可能已达上限）：', 因);
    throw 因;
  }
}

/* 从云端拉全量 id，填进内存缓存；成功则把云端态置为在线，并把云端结果也写进
   localStorage（让离线时能读到最近一次云端的样子）。 */
export async function 同步云端() {
  if (同步承诺) return 同步承诺;
  同步承诺 = (async () => {
    try {
      const ids = await 取收藏id();
      内存ids = ids;
      云端在线 = true;
      写原始(ids);           // 镜像一份到本地，作离线降级
      console.info(`[store] 收藏已从云端同步：${ids.length} 条`);
    } catch (因) {
      云端在线 = false;
      console.warn('[store] 云端同步失败，收藏回落本地：', 因);
    } finally {
      同步承诺 = null;
    }
  })();
  return 同步承诺;
}

/** 收藏的 id 列表（按收藏时间先后，旧的在前面）。
    云端已同步时读内存缓存；否则读 localStorage（含「接口还没回来」的启动瞬间）。 */
export function list() {
  if (内存ids) return [...内存ids];
  return 读原始();
}

export function has(id) {
  return list().includes(id);
}

/**
 * 切换收藏。先改内存缓存（同步、立即生效），再后台异步写云端 ——
 * 云端写失败不打断 UI（缓存已反映用户意图，接口稍后/下次会再对齐）。
 * @returns {boolean} 切换后的状态：true = 现在已收藏
 * @throws 本地写失败时抛异常（调用方据此提示「没存上」，不假装成功）
 */
export function toggle(id) {
  const ids = list();
  const 在里 = ids.includes(id);
  const 新的 = 在里 ? ids.filter(项 => 项 !== id) : [...ids, id];

  try {
    写原始(新的);
    内存ids = 新的;
  } catch (因) {
    console.error('[store] 写入异常：', 因);
    throw 因;
  }

  /* 后台写云端：加收藏走 POST，取消走 DELETE。结果只影响「下次同步」的底，不打断当前 UI。 */
  (在里 ? 删收藏表(id) : 写收藏表(id)).catch(因 => {
    console.warn('[store] 云端写入失败（本地已更新，下次同步会对齐）：', 因);
  });

  return !在里;
}

export function remove(id) {
  const ids = list();
  if (!ids.includes(id)) return;
  const 新的 = ids.filter(项 => 项 !== id);
  try {
    写原始(新的);
    内存ids = 新的;
  } catch (因) {
    console.error('[store] 取消失败：', 因);
    throw 因;
  }
  删收藏表(id).catch(因 => {
    console.warn('[store] 云端删除失败（本地已更新）：', 因);
  });
}

/* —— 导出 ——
   PRD 8.5 的硬要求：导出内容必须**同时包含原文和出处**（只有名称不算）。
   这里多给「写小说怎么用」，是因为那才是这个站存在的理由 ——
   导出去的东西要能直接贴进写作素材本，而不是一份书目。 */

function 导出单条(条, 序) {
  const 行 = [
    `${序}. ${条.名}${条.别名 && 条.别名.length ? `（${条.别名.join('、')}）` : ''}`,
    `   出处：${条.出处 || '（此条缺出处）'}`,
    `   原文：${条.原文 || '（此条缺原文）'}`,
  ];

  if (条.译文) 行.push(`   译文：${条.译文}`);

  if (条.异说 && 条.异说.length) {
    行.push('   异说：');
    条.异说.forEach(说 => 行.push(`     · ${说.出处} —— ${说.说法}`));
  }

  if (条.写小说怎么用) 行.push(`   写小说怎么用：${条.写小说怎么用}`);
  if (条.关键词 && 条.关键词.length) 行.push(`   关键词：${条.关键词.join('、')}`);

  return 行.join('\n');
}

/**
 * 生成导出文本。
 * @param {object[]} 条目 要导出的条目（通常是「收藏的那几条」）
 * @returns {string}
 */
export function exportText(条目) {
  const 列表 = Array.isArray(条目) ? 条目 : [];

  const 头 = [
    '异兽志 · 收藏摘录',
    `导出时间：${new Date().toLocaleString('zh-CN')}`,
    `共 ${列表.length} 条`,
    '—'.repeat(28),
  ].join('\n');

  if (!列表.length) return `${头}\n（收藏夹是空的。）`;

  const 尾 = ['—'.repeat(28), '来源：异兽志 · 图鉴'].join('\n');

  return `${头}\n\n${列表.map(导出单条).join('\n\n')}\n\n${尾}\n`;
}

/* —— 两种取出方式 ——
   两条都留着，因为用途真的不同：剪贴板适合贴进笔记 / 对话，
   下载适合攒成文件、离线带走。都失败也只提示，不阻塞阅读。 */

/**
 * 复制到剪贴板。
 * 注意：`navigator.clipboard` 需要安全上下文（https 或 localhost）。
 * 本地用 file:// 打开时它是 undefined —— 那也不能就此把路堵死，
 * 所以下面留了一条 execCommand 的旧路兜底。
 * @returns {Promise<boolean>} 是否成功
 */
export async function 复制到剪贴板(文本) {
  const 内容 = String(文本 == null ? '' : 文本);

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(内容);
      return true;
    }
  } catch (因) {
    console.warn('[store] clipboard API 失败，试旧路：', 因);
  }

  /* 旧路：临时 textarea + document.execCommand('copy')。
     已被标准标记为废弃，但它是 file:// 下唯一还能用的方式。 */
  try {
    const 域 = document.createElement('textarea');
    域.value = 内容;
    域.setAttribute('readonly', '');
    域.style.position = 'fixed';
    域.style.top = '-1000px';
    域.style.opacity = '0';
    document.body.append(域);
    域.select();
    const 成 = document.execCommand('copy');
    域.remove();
    if (!成) console.warn('[store] execCommand(copy) 返回 false');
    return 成;
  } catch (因) {
    console.error('[store] 复制失败：', 因);
    return false;
  }
}

/**
 * 下载为 .txt。用 Blob + 临时 <a download>，不请求服务器（本站也没有服务器）。
 * 文件名带日期，避免多次导出互相覆盖。
 */
export function 下载txt(文本, 文件名) {
  const 名 = 文件名 || `异兽志-收藏-${new Date().toISOString().slice(0, 10)}.txt`;
  /* 加 BOM：Windows 记事本靠它认 UTF-8，否则中文会显示成乱码 */
  const 块 = new Blob(['\uFEFF' + String(文本 == null ? '' : 文本)], { type: 'text/plain;charset=utf-8' });
  const 址 = URL.createObjectURL(块);

  const 链 = document.createElement('a');
  链.href = 址;
  链.download = 名;
  document.body.append(链);
  链.click();
  链.remove();

  /* 立刻 revoke 会让下载中断，延后释放 */
  setTimeout(() => URL.revokeObjectURL(址), 4000);
}
