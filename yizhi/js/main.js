// 异兽志 · 入口
// 职责：启动、装配、绑定事件。数据从哪来、视图怎么画、怎么搜，都不该长在这个文件里。
//
// 与模块接口契约（TECH_DESIGN §6.2）的对应：
//   data.loadBu       → js/data.js           （第 3 步起）
//   views.renderGrid  → js/views/grid.js     （第 4 步起）
//   search.buildIndex / query → js/search.js （第 5 步起）
//   吉凶筛选条        → 本文件               （第 6 步起；见下方说明）
//   store.*           → js/store.js          （M4 第 7 步）
//   transit.play      → js/transit.js        （M4 第 8 步）
//   views.renderDetail / renderFavList → js/views/detail.js / fav.js（M4 第 8 步）
//
// 为什么筛选条不放 grid.js：契约强制 renderGrid 只吃 (容器, 条目[], 筛选态)，
// 而筛选条是「控件」—— 跟五部 tab、搜索框同类，是装配层的事。
// grid.js 只留谓词（通过筛选），把「按钮长什么样、点了算选中还是取消、空了给什么出口」留给这里。

import { loadBu, 吉凶枚举 } from './data.js';
import { renderGrid, 图源 } from './views/grid.js';
import { renderDetail, 设收藏态, 写提示 } from './views/detail.js';
import { renderFavList } from './views/fav.js';
import { buildIndex, query } from './search.js';
import * as store from './store.js';
import { play as 播转场 } from './transit.js';
import { 打开请求, 关闭请求, 收藏切换, 导出请求 } from './events.js';

/* —— 状态 ——
   两个集合刻意分开：
     条目 = 当前部的全量，只在载入时变；
     基准 = 当前搜索命中的那几条；没搜索时就是条目。筛选叠在基准之上。
   分开的好处是「清空搜索」不用重新读文件，「改筛选」也不用重新搜。 */
const 当前部 = '异兽';
let 条目 = [];
let 基准 = [];
let 索引 = null;               // 数据到位后由 buildIndex 建好；未就绪时搜索框不假装能搜
const 选中吉凶 = new Set();    // 空集合 = 不筛。同维度多值可叠，不做多条件组合面板（PRD 8.2 边界）

const 网格 = document.getElementById('图鉴网格');
const 搜索框 = document.getElementById('搜索框');
const 筛选条 = document.getElementById('吉凶筛选');
const 筛选钮 = new Map();      // 值 → 按钮（键 '__全部' 是复位位）。留着是为了「只同步、不重建」
let 上次基准签名 = null;       // 基准没变就不重建按钮 —— 否则在搜索框每敲一个字，整条筛选栏都会闪一下

/* E 部境界无 `吉凶` 字段（TECH_DESIGN §5.2），切到那部时整条筛选隐藏 */
const 部有吉凶 = 当前部 !== '境界';

/* —— 五部 tab 的就绪状态：只有异兽部有数据，其余 M6 补 —— */
const 五部 = [
  { 名: '神仙', 就绪: false },
  { 名: '神话', 就绪: false },
  { 名: '异兽', 就绪: true },
  { 名: '妖怪', 就绪: false },
  { 名: '境界', 就绪: false },
];

/* —— 小工具 —— */
function 建行(类名, 文本) {
  const 节点 = document.createElement('p');
  节点.className = 类名;
  节点.textContent = 文本;
  return 节点;
}

function 写站况(文本) {
  document.getElementById('站况').textContent = 文本;
}

/* 统一的「动作按钮」——零结果、筛空、加载失败三处都用它，样式与五部 tab 一致 */
function 建动作钮(文字, 点击) {
  const 钮 = document.createElement('button');
  钮.type = 'button';
  钮.className = 'bu';
  钮.textContent = 文字;
  钮.addEventListener('click', 点击);
  return 钮;
}

/* —— 渲染：五部 tab —— */
function 渲染部Tab() {
  const 容器 = document.getElementById('部tabs');
  容器.textContent = '';
  五部.forEach(部 => {
    const 钮 = document.createElement('button');
    钮.type = 'button';
    钮.className = 'bu';
    钮.textContent = 部.名;
    if (部.就绪) {
      钮.setAttribute('aria-current', 部.名 === 当前部 ? 'true' : 'false');
    } else {
      钮.disabled = true;   // 数据未录入：置灰不可点，不写「敬请期待」这类占位文字（PRD 8.6）
    }
    容器.append(钮);
  });
}

/* —— 渲染：吉凶筛选条（F2，PRD 8.2） ——
   条数标在按钮上，是为了让人「点之前」就看见点下去有没有东西。
   徽标基于「基准」而不是全量：搜完再筛时数目才对得上（否则会显示整部的分布，点下去数字不符）。 */
function 渲染筛选条() {
  if (!部有吉凶) { 筛选条.hidden = true; return; }
  筛选条.hidden = false;

  /* 基准没变就只同步选中态，不重建 DOM —— 否则输入关键词时筛选栏会逐字闪 */
  const 签名 = 基准.map(条 => 条.id + ':' + 条.吉凶).join('|');
  if (签名 === 上次基准签名 && 筛选钮.size) { 同步筛选条(); return; }
  上次基准签名 = 签名;

  筛选条.textContent = '';
  筛选钮.clear();

  const 标签 = document.createElement('span');
  标签.className = 'filter-label';
  标签.textContent = '吉凶';
  筛选条.append(标签);

  /* 「全部」放最前：它是复位位，不是第五个分类值，所以不计弱化、条数取基准全量 */
  const 全部钮 = 建筛选钮('全部', 基准.length, false);
  全部钮.addEventListener('click', () => { 选中吉凶.clear(); 应用筛选(); });
  筛选钮.set('__全部', 全部钮);
  筛选条.append(全部钮);

  const 隔 = document.createElement('span');
  隔.className = 'chip-sep';
  隔.setAttribute('aria-hidden', 'true');
  筛选条.append(隔);

  吉凶枚举.forEach(值 => {
    const 数 = 基准.filter(条 => 条.吉凶 === 值).length;
    const 钮 = 建筛选钮(值, 数, 数 === 0);
    钮.addEventListener('click', () => {
      if (选中吉凶.has(值)) 选中吉凶.delete(值);
      else 选中吉凶.add(值);
      应用筛选();
    });
    筛选钮.set(值, 钮);
    筛选条.append(钮);
  });

  同步筛选条();
}

function 建筛选钮(文字, 条数, 弱化) {
  const 钮 = document.createElement('button');
  钮.type = 'button';
  钮.className = 'chip';
  钮.textContent = 文字;                 // 一律 textContent，条目内容不进 innerHTML
  if (弱化) 钮.dataset.空 = '1';          // 当前 0 条：只弱化不禁用，点了给出口

  const 标 = document.createElement('span');
  标.className = 'chip-n';
  标.textContent = String(条数);
  钮.append(标);

  return 钮;
}

function 同步筛选条() {
  筛选钮.forEach((钮, 键) => {
    const 选中 = 键 === '__全部' ? 选中吉凶.size === 0 : 选中吉凶.has(键);
    钮.setAttribute('aria-pressed', 选中 ? 'true' : 'false');
  });
}

/* —— 筛选 → 渲染 —— */
function 当前筛选态() {
  return 选中吉凶.size ? { 吉凶: [...选中吉凶] } : null;
}

function 应用筛选() {
  同步筛选条();
  铺网格();
}

/* 铺网格：搜索与筛选的唯一出口。
   两者都只是改「基准」和「选中吉凶」，最后都走到这里，站况与出口逻辑因此只有一份。 */
function 铺网格() {
  const 条数 = renderGrid(网格, 基准, 当前筛选态());

  /* 基准非空却零条 = 被筛选滤空了，不是没数据。给出口，不给死胡同（PRD 9.2 ②） */
  if (!条数 && 基准.length) return 渲染筛空();

  写站况数(条数);
}

/* 多选取「或」：『筛「吉祥、凶恶」』会被读成「吉祥且凶恶」，而条目不可能两样都是，
   所以选中多个值时显式写「或」。单选不带连接词。 */
function 筛选说法() {
  return `筛「${[...选中吉凶].join(' 或 ')}」`;
}

function 写站况数(条数) {
  const 词 = 搜索框.value.trim();
  const 动作 = [词 ? `搜「${词}」` : '', 选中吉凶.size ? 筛选说法() : '']
    .filter(Boolean).join(' + ');
  写站况(动作 ? `${当前部}部 · ${动作} · ${条数} 条` : `${当前部}部 · ${条数} 条`);
}

/* 筛选滤空的面板 —— 复用零结果的语言：这两块都是「出了状况，但有出路」 */
function 渲染筛空() {
  网格.textContent = '';

  const 块 = document.createElement('div');
  块.className = 'zero';
  块.append(建行('zero-msg', `${筛选说法()}下暂时没有条目。`));
  块.append(建行('zero-lead', `这里一共 ${基准.length} 条，换个筛法看看。`));
  块.append(建动作钮(`清除筛选，看全部 ${基准.length} 条`, () => {
    选中吉凶.clear();
    应用筛选();
  }));

  网格.append(块);
  写站况(`${当前部}部 · 筛选无结果`);
}

/* —— 数据没读到时的出路：一句人话 + 一个能点的按钮（TECH_DESIGN §9-1，不白屏、不弹 alert） —— */
function 渲染加载失败(错) {
  网格.textContent = '';
  筛选条.hidden = true;   // 条目都没读到，筛选条没有意义

  const 块 = document.createElement('div');
  块.className = 'load-fail';
  块.append(建行('load-fail-msg', `${(错 && 错.部名) || 当前部}部数据没读到。`));
  if (错 && 错.原因) 块.append(建行('load-fail-why', `原因：${错.原因}`));
  块.append(建动作钮('重试', 载入));

  网格.append(块);
  写站况(`${当前部}部 · 未读到数据`);
}

/* —— 零结果不给死胡同（PRD 9.2 ② / TECH_DESIGN §9-9）：
     明说没找到 → 给相近条目（点了就换成它去搜）→ 再给「清空」这一步退路。 —— */
function 渲染零结果(相近, 关键词) {
  网格.textContent = '';
  筛选条.hidden = true;   // 当前显示的是提示面板而不是条目列表，筛选条留着会自相矛盾

  const 块 = document.createElement('div');
  块.className = 'zero';
  块.append(建行('zero-msg', `没找到「${关键词}」。`));

  if (相近.length) {
    块.append(建行('zero-lead', '是不是想找：'));
    const 排 = document.createElement('div');
    排.className = 'zero-near';
    相近.forEach(条 => {
      const 钮 = document.createElement('button');
      钮.type = 'button';
      钮.className = 'near';
      钮.textContent = 条.名;
      钮.addEventListener('click', () => {
        搜索框.value = 条.名;
        搜索框.focus();
        执行搜索(条.名);
      });
      排.append(钮);
    });
    块.append(排);
  } else {
    块.append(建行('zero-lead', '试试输入名字、俗称或小说称号（例：妲己）。'));
  }

  /* 文案要跟着筛选状态走：清空搜索不会一并清筛选，别让按钮说「看全部」却只给一半 */
  块.append(建动作钮(
    选中吉凶.size ? '清空搜索（筛选保留）' : `清空，看全部 ${条目.length} 条`,
    清空搜索,
  ));

  网格.append(块);
  写站况(`${当前部}部 · 搜「${关键词}」无结果`);
}

/* —— 搜索 ——
   筛选叠在搜索结果之上：先搜出范围，再在范围里按吉凶挑。这是网文作者的真实用法
   （「找狐类，但不要凶的」）。搜索零命中时筛选条隐藏，不留下一个没对象的控件。 */
function 执行搜索(输入) {
  const 关键词 = String(输入 == null ? '' : 输入).trim();

  if (!关键词) {                 // 空输入 = 回到整部（筛选保留）
    基准 = 条目;
    渲染筛选条();
    铺网格();
    return;
  }

  /* 数据还没读到就不假装能搜，也不给死胡同 */
  if (!索引) {
    网格.textContent = '';
    筛选条.hidden = true;

    const 块 = document.createElement('div');
    块.className = 'zero';
    块.append(建行('zero-msg', `${当前部}部数据还在读，稍等一下再搜。`));
    块.append(建动作钮('重试', 载入));
    网格.append(块);

    写站况(`${当前部}部 · 读取中`);
    return;
  }

  const 结果 = query(索引, 关键词);

  if (结果.直接命中.length) {
    基准 = 结果.直接命中;
    渲染筛选条();
    铺网格();
    return;
  }

  渲染零结果(结果.相近, 关键词);
}

function 清空搜索() {
  搜索框.value = '';
  搜索框.focus();
  执行搜索('');
}

/* —— 启动 —— */
async function 载入() {
  网格.textContent = '';
  筛选条.hidden = true;
  写站况(`${当前部}部 · 读取中`);

  try {
    条目 = await loadBu(当前部);
  } catch (错) {
    条目 = [];
    基准 = [];
    索引 = null;
    渲染加载失败(错);
    return;
  }

  索引 = buildIndex(条目);
  基准 = 条目;                  // 新数据到手 = 搜索范围归零到整部

  /* 读数据时用户可能已经在搜索框里打了字：按当前输入决定铺什么，不要把搜索状态冲掉 */
  if (搜索框.value.trim()) 执行搜索(搜索框.value);
  else {
    渲染筛选条();
    铺网格();
  }
}

/* —— 输入即响应（PRD 9.2 ②）。数据在内存里，不需要防抖，敲一个字符就重铺一次 —— */
搜索框.addEventListener('input', () => 执行搜索(搜索框.value));

/* 原生 type=search 的 Esc 只清值不重铺，这里补上「清完要回到整部列表」 */
搜索框.addEventListener('keydown', 事件 => {
  if (事件.key === 'Escape') {
    事件.preventDefault();
    清空搜索();
  }
});

/* ══════════════════════════════════════════════════════════════════════
   M4 · 详情（F3）+ 转场（F4）+ 收藏与导出（F5）
   ══════════════════════════════════════════════════════════════════════
   这一段的职责只有一件事：把「视图想干什么」翻译成「store 做什么」。
   收藏存哪、导出怎么下载，全在 store.js；转场怎么播，全在 transit.js。
   这里不认识 localStorage，也不认识 CSS 动画。 */

const 面板挂载 = document.getElementById('面板挂载');
const 收藏面板 = document.getElementById('收藏面板');
const 收藏列表 = document.getElementById('收藏列表');
const 收藏计数 = document.getElementById('收藏计数');
const 收藏说明 = document.getElementById('收藏说明');
const 收藏提示 = document.getElementById('收藏提示');
const 收藏入口 = document.getElementById('收藏入口');

let 当前详情 = null;      // 同时只该开着一张详情

/* —— 收藏的四个落点 ——
   一次 toggle 会牵动四处：详情里的按钮、入口上的计数、收藏面板的列表、localStorage 本身。
   所以只留这一个出口「同步收藏」，别处一律不许直接改这几个 DOM。 */
function 收藏条目() {
  const ids = store.list();
  /* 用 id 去当前部里捞。捞不到（条目被删、或收藏的是别的部的）**不能静默消失** ——
     收藏夹里少了东西而没有解释，比少东西本身更让人困惑。
     给一条「已下架」的占位，并且在列表里留一个「移除」出口（TECH_DESIGN §12.4）。
     M6 五部全通后这里要改成去全量里捞。 */
  return ids.map(id => 条目.find(条 => 条.id === id)
    || { id, 名: '此条已下架', 出处: '', 已下架: true });
}

/* 导出时要把占位滤掉：占位不是内容，不该出现在导出文本里 */
function 可导出的收藏() {
  return 收藏条目().filter(条 => !条.已下架);
}

function 同步收藏() {
  const 条数 = store.list().length;
  收藏计数.textContent = String(条数);
  收藏说明.textContent = `${条数} 条`;
  if (当前详情) 设收藏态(当前详情, store.has(当前详情.dataset.id));
  /* 收藏面板开着就重画：取消收藏后那一条要立刻消失（PRD 8.5） */
  if (收藏面板.open) renderFavList(收藏列表, 收藏条目());
}

function 提示(文本) {
  if (当前详情 && 当前详情.open) {
    写提示(当前详情, 文本);
    return;
  }
  收藏提示.textContent = 文本;
}

/* —— 开关面板 ——
   为什么要「先收起收藏面板再播转场」：<dialog> 打开时进的是浏览器 top layer，
   那是一层独立于 z-index 的层 —— 转场层再高的 z-index 也压不住它。
   所以从收藏夹点进详情时，必须先把收藏面板收起来，否则转场被它盖住、只听见播完了。 */
function 收起收藏面板() {
  if (收藏面板.open) 收藏面板.close();
}

function 收起详情() {
  if (!当前详情) return;
  const 旧 = 当前详情;
  当前详情 = null;
  旧.close();     // close 事件里已挂 remove
  旧.remove();    // 兜底：close 事件是异步派发的，这里不等它
}

function 挂详情(条) {
  const 面板 = renderDetail(条);
  设收藏态(面板, store.has(条.id));

  /* 原生 Esc 关闭也走 close 事件 —— 面板用完就摘掉，
     不留在 DOM 里堆着（否则连开十条就有十个 dialog 挂着）。 */
  面板.addEventListener('close', () => 面板.remove());
  挂背板关(面板, () => 收起详情());

  面板挂载.append(面板);
  面板.showModal();
  当前详情 = 面板;
}

/**
 * 打开一条的详情。
 * @param {object} 条
 * @param {{转场?: boolean}} 选项 转场=false 直接落详情（给「不想要那 3 秒」的场合）
 */
function 打开详情(条, { 转场 = true } = {}) {
  if (!条) return;

  收起收藏面板();
  收起详情();

  const 落 = () => 挂详情(条);
  if (!转场) { 落(); return; }

  /* 转场只在「从这里到那一条」时播；它自己会在播完或被中断时恰好调一次 onDone，
     所以「等满 3 秒」和「点了就走」两条路最终都落到同一个 落()。 */
  播转场({ onDone: 落 });
}

/* 点背板关掉面板：<dialog> 的原生能力里没有这条（只有 Esc）。
   判断用坐标而不是 target —— dialog 自身的 padding 是 0，落在矩形内又没有子元素可命中的情况极少，
   但「点在哪」这件事用坐标说最不含糊。 */
function 挂背板关(面板, 关掉) {
  面板.addEventListener('click', 事件 => {
    if (事件.target !== 面板) return;
    const 框 = 面板.getBoundingClientRect();
    const 在框内 = 事件.clientX >= 框.left && 事件.clientX <= 框.right
      && 事件.clientY >= 框.top && 事件.clientY <= 框.bottom;
    if (!在框内) 关掉();
  });
}

/* —— 收藏切换 ——
   注意这里**不能**因为「条目找不到」就早退：收藏夹里那些已下架的条目，
   恰恰只有这个动作能把它们移掉（TECH_DESIGN §12.4）。
   第一版加了早退，结果「移除」按钮点了没反应 —— 探针抓到了。 */
function 处理收藏(id) {
  const 条 = 条目.find(项 => 项.id === id);
  const 名 = 条 ? 条.名 : '这条已下架的内容';

  try {
    const 现在 = store.toggle(id);
    同步收藏();
    提示(现在 ? `已收藏「${名}」` : `已从收藏夹移出「${名}」`);
  } catch {
    /* 写失败（多半是 localStorage 写满）：不假装成功，也不清空已有收藏（TECH_DESIGN §9-8）。
       先把界面刷回真状态，再明说没存上。 */
    同步收藏();
    提示('没能存上：本机存储写满了，先取消几条再试。');
  }
}

/* —— 导出 —— */
async function 处理导出({ id, 方式 }) {
  const 条 = 条目.find(项 => 项.id === id);
  if (!条) return;

  const 文 = store.exportText([条]);

  if (方式 === '复制') {
    const 成 = await store.复制到剪贴板(文);
    提示(成 ? '已复制（含原文与出处）' : '复制失败：浏览器不允许访问剪贴板，改用「下载 txt」。');
    return;
  }

  store.下载txt(文, `异兽志-${条.名}.txt`);
  提示('已下载 txt 文件。');
}

function 导出收藏夹() {
  const 收藏 = 可导出的收藏();
  if (!收藏.length) {
    收藏提示.textContent = '收藏夹是空的，没有可导出的内容。';
    return;
  }
  store.下载txt(store.exportText(收藏));
  收藏提示.textContent = `已导出 ${收藏.length} 条（含原文与出处）。`;
}

/* —— 网格上的点击（事件委托）——
   卡片是 grid.js 建的，但「点了之后干什么」是装配层的事，所以监听挂在这里。
   委托而不是逐张卡挂监听：重新铺一次网格（搜索、筛选）不用重新绑定。 */
网格.addEventListener('click', 事件 => {
  const 卡 = 事件.target.closest('.card');
  if (!卡) return;
  打开详情(条目.find(条 => 条.id === 卡.dataset.id));
});

/* 卡片带了 role="button"，键盘也得能开（Enter / 空格），否则等于只给鼠标用 */
网格.addEventListener('keydown', 事件 => {
  if (事件.key !== 'Enter' && 事件.key !== ' ') return;
  const 卡 = 事件.target.closest('.card');
  if (!卡) return;
  事件.preventDefault();   // 空格默认会滚动页面
  打开详情(条目.find(条 => 条.id === 卡.dataset.id));
});

/* —— 视图层派发上来的事件，统一在 document 上收（它们都 bubbles）—— */
document.addEventListener(打开请求, 事件 => {
  打开详情(条目.find(条 => 条.id === 事件.detail.id));
});

document.addEventListener(关闭请求, 事件 => {
  /* 关闭请求从两个地方来：详情的「收起」按钮、收藏面板的「收起」。
     用事件源判断该关哪个 —— 把当前开着的那个关掉就行。 */
  if (收藏面板.contains(事件.target)) 收起收藏面板();
  else 收起详情();
});

document.addEventListener(收藏切换, 事件 => 处理收藏(事件.detail.id));
document.addEventListener(导出请求, 事件 => 处理导出(事件.detail));

收藏入口.addEventListener('click', () => {
  renderFavList(收藏列表, 收藏条目());
  收藏说明.textContent = `${store.list().length} 条`;
  收藏提示.textContent = '';
  收藏面板.showModal();
});

document.getElementById('关收藏').addEventListener('click', 收起收藏面板);
document.getElementById('导出收藏').addEventListener('click', 导出收藏夹);
挂背板关(收藏面板, 收起收藏面板);

/* —— 启动 —— */
渲染部Tab();
载入();
同步收藏();

/* localStorage 不可用（隐私模式 / 被禁用）时明说一句，别让人收藏半天才发现刷新就没了（TECH_DESIGN §9-7）。
   放在这里而不是页面顶部：不加一块常驻的提示条，只在收藏入口上标出来。 */
if (!store.可用()) {
  收藏入口.title = '本浏览器无法保存收藏（隐私模式或已禁用本地存储），收藏只在本次浏览有效';
  收藏说明.textContent = '本浏览器无法保存收藏，关掉页面即失效';
}

console.log('[异兽志] Day 7 · M4 已接：详情 F3 / 转场 F4 / 收藏与导出 F5 · 图源目录 %s', 图源);
