// 异兽志 · 视图层「详情面板」（V3，F3）
// 契约（TECH_DESIGN §6.2）：renderDetail(条目)
//
// 本层不认识「收藏存在哪」也不认识 localStorage：
// 面板上的收藏 / 导出按钮只负责**派发事件**，由 main.js 去调 store.js。
// 这是 §12.5 那条分层纪律在按钮上的具体落法 —— 视图层一旦 import store.js，
// 将来收藏改走后端就要来改这个文件。
//
// 内容是照 PRD 8.3 的五件套给的：原文 / 出处 / 译文 / 异说 / 写小说怎么用。
// 两条容易被做错的地方，这里刻意按验收线写死：
//   · 异说的存在意义是「说法不一致」这件事本身 —— 所以先给一句标注再说分歧，
//     不能只是并排贴几条（PRD 8.3 的「不合格长什么样」头一条就是它）。
//   · 没有异说的条目，整块**不出现**；缺译文的，写「此条暂无译文」而不是留白
//     （PRD 9.2 ③：缺项明示，不用空白糊弄）。

import { 建图 } from './portrait.js';
import { 关闭请求, 收藏切换, 导出请求 } from '../events.js';
import { 建行 } from './card.js';

/* 事件名集中在 js/events.js：这里是「发」的一端，main.js 是「听」的一端。 */

/* —— 小工具 —— */

function 建钮(文字, 类名) {
  const 钮 = document.createElement('button');
  钮.type = 'button';
  钮.className = 类名;
  钮.textContent = 文字;
  return 钮;
}

/* 一段「标签 + 内容」。标签是朱砂的小竖线 + 竖排小字，与卡片的「用法 / 出处」同语言 */
function 建段(标签, 内容节点, 额外类) {
  const 段 = document.createElement('section');
  段.className = 'detail-row' + (额外类 ? ' ' + 额外类 : '');

  const 签 = document.createElement('h3');
  签.className = 'detail-label';
  签.textContent = 标签;

  段.append(签, 内容节点);
  return 段;
}

/* —— 各块内容 —— */

function 建原文(条) {
  const 块 = document.createElement('blockquote');
  块.className = 'detail-quote' + (条.原文性质 ? ' is-plain' : '');
  块.textContent = 条.原文;
  return 块;
}

/* 「原文」这一栏的标签 ——
   M6 起境界部的网文九境没有古籍原文（PRD §4 E 部规则：不假托古籍、不编造原文），
   它们的 `原文` 字段装的是**当代通行设定**。那就照实标成「通行设定」：
   同样是引文块，但读者一眼知道这不是从古书里抄的。 */
function 原文标签(条) {
  return 条.原文性质 || '原文';
}

function 建出处(条) {
  const 块 = document.createElement('p');
  块.className = 'detail-src';
  块.textContent = 条.出处;
  return 块;
}

function 建译文(条) {
  /* 缺译文不是「没这一块」，而是「这一块暂时空着」—— 明说，别留白（PRD 9.2 ③） */
  const 块 = document.createElement('p');
  块.className = 'detail-trans';
  if (条.译文) {
    块.textContent = 条.译文;
  } else if (条.原文性质) {
    /* 原文本来就是白话（通行设定），给它配一句译文是废话 —— 说清原因，而不是写「暂无译文」 */
    块.classList.add('detail-none');
    块.textContent = '此条所录即当代通行说明，没有古文需要转译。';
  } else {
    块.classList.add('detail-none');
    块.textContent = '此条暂无译文。原文已录，译文待补。';
  }
  return 块;
}

/* 异说：先说「不一致」，再列分歧。每条的出处单起一行 —— 
   分岐的关键往往就在「谁说的」，挤在一行里读不出这个。 */
function 建异说(条) {
  const 块 = document.createElement('div');
  块.className = 'detail-yi';

  块.append(建行('detail-yi-head', `此条有 ${条.异说.length} 说，说法不一致`));

  const 表 = document.createElement('ul');
  表.className = 'detail-yi-list';
  条.异说.forEach(说 => {
    const 项 = document.createElement('li');

    const 源 = document.createElement('span');
    源.className = 'yi-src';
    源.textContent = 说.出处;

    const 文 = document.createElement('span');
    文.className = 'yi-said';
    文.textContent = 说.说法;

    项.append(源, 文);
    表.append(项);
  });
  块.append(表);

  return 块;
}

function 建用法(条) {
  const 块 = document.createElement('p');
  块.className = 'detail-use';
  块.textContent = 条.写小说怎么用;
  return 块;
}

/* —— 面板 —— */

/**
 * 画详情面板。**只画，不打开** —— 何时 showModal 由 main.js 决定
 * （转场播完才打开，那属于装配层的事）。
 * @param {object} 条 一条通过校验的条目
 * @returns {HTMLDialogElement} 面板节点（`.detail`），已带 data-id
 */
export function renderDetail(条) {
  const 面板 = document.createElement('dialog');
  面板.className = 'detail';
  面板.dataset.id = 条.id;
  /* 无障碍名：读屏念「九尾狐，对话框」比念「对话框」有用得多 */
  面板.setAttribute('aria-label', `${条.名} 详情`);

  /* —— 头：名 + 别名 + 归属 —— */
  const 头 = document.createElement('header');
  头.className = 'detail-head';

  const 名 = document.createElement('h2');
  名.className = 'detail-name';
  名.textContent = 条.名;
  头.append(名);

  if (条.别名 && 条.别名.length) 头.append(建行('detail-alias', `又称：${条.别名.join(' · ')}`));

  const 隶 = document.createElement('p');
  隶.className = 'detail-meta';
  /* 归属行：哪一部 + 吉凶（A–D 部有）+ 序列（境界部有）。缺的都不占位。 */
  隶.textContent = `${条.部}部`
    + (条.吉凶 ? ` · ${条.吉凶}` : '')
    + (条.序列 ? ` · ${条.序列}` : '');
  头.append(隶);

  面板.append(头);

  /* —— 身：图在左（章式），五件套在右 ——
     M6 起只有异兽部有形象图。没图就不摆这一栏（见 detail.css 的 .no-figure）——
     「图缺失时给安静空框」是卡片上的兜底，不是详情页的：这里图位很大，空着比没有更难看。 */
  const 身 = document.createElement('div');
  身.className = 'detail-body' + (条.图 ? '' : ' no-figure');

  if (条.图) {
    const 图区 = document.createElement('figure');
    图区.className = 'detail-figure';
    图区.append(建图(条));
    if (条.吉凶) {
      const 印 = document.createElement('figcaption');
      印.className = 'detail-seal';
      印.textContent = 条.吉凶;
      图区.append(印);
    }
    身.append(图区);
  }

  const 文区 = document.createElement('div');
  文区.className = 'detail-text';

  文区.append(建段(原文标签(条), 建原文(条), 'row-quote'));
  文区.append(建段('出处', 建出处(条)));
  文区.append(建段('译文', 建译文(条)));
  if (条.异说 && 条.异说.length) 文区.append(建段('异说', 建异说(条)));
  /* 没有异说 → 这一块根本不 append，也不会出现「暂无异说」的空壳（PRD 8.3 末条） */
  文区.append(建段('写小说怎么用', 建用法(条), 'row-use'));

  if (条.兆) 文区.append(建段('兆', 建行('detail-omen', 条.兆)));

  if (条.关键词 && 条.关键词.length) {
    const 签排 = document.createElement('div');
    签排.className = 'detail-keys';
    条.关键词.forEach(词 => {
      const 签 = document.createElement('span');
      签.className = 'detail-key';
      签.textContent = 词;
      签排.append(签);
    });
    文区.append(建段('关键词', 签排));
  }

  身.append(文区);
  面板.append(身);

  /* —— 操作区 ——
     收藏按钮的文字由 设收藏态() 统一写；导出这两个按钮只是「要做什么」，
     真正生成文本、碰剪贴板 / Blob 的是 store.js，中间隔着一次自定义事件。 */
  const 操 = document.createElement('footer');
  操.className = 'detail-actions';

  const 收藏 = 建钮('收藏', 'act act-fav');
  收藏.dataset.act = '收藏';
  收藏.setAttribute('aria-pressed', 'false');
  收藏.setAttribute('aria-disabled', 'false');
  收藏.addEventListener('click', () => {
    /* 处理中不接第二次。判据用 aria-disabled 而不是 disabled ——
       disabled 会把焦点从按钮上踢走，键盘用户点一次就丢了位置，
       等按钮回来还得重新 Tab 过来；aria-disabled 只声明状态，拦截交给这一行。 */
    if (收藏.getAttribute('aria-disabled') === 'true') return;
    /* 先自己应一声「收到了」，再去等装配层 —— 见下面 设收藏态 的说明 */
    设收藏态(面板, '处理中');
    面板.dispatchEvent(new CustomEvent(收藏切换, { bubbles: true, detail: { id: 条.id, 来源: '按钮' } }));
  });

  const 复制 = 建钮('复制全文', 'act act-copy');
  复制.dataset.act = '复制';
  复制.addEventListener('click', () => {
    面板.dispatchEvent(new CustomEvent(导出请求, { bubbles: true, detail: { id: 条.id, 方式: '复制' } }));
  });

  const 下载 = 建钮('下载 txt', 'act act-download');
  下载.dataset.act = '下载';
  下载.addEventListener('click', () => {
    面板.dispatchEvent(new CustomEvent(导出请求, { bubbles: true, detail: { id: 条.id, 方式: '下载' } }));
  });

  const 关 = 建钮('收起', 'act act-close');
  关.dataset.act = '关闭';
  /* 关闭是「面板自己的事」，不需要上报 store：派一个同名事件让 main 调 close()，
     是为了让面板不持有「我是怎么被打开的」这份上下文。 */
  关.addEventListener('click', () => {
    面板.dispatchEvent(new CustomEvent(关闭请求, { bubbles: true, detail: { id: 条.id } }));
  });

  /* 提示位：文案由 main.js 写（「已收藏」「复制成功」「本次没存上」都发生在这里）
     一块空位常驻，避免文案出现时把底下的按钮挤得跳一下。 */
  const 提示 = document.createElement('p');
  提示.className = 'act-hint';
  提示.setAttribute('role', 'status');
  提示.textContent = '';

  操.append(收藏, 复制, 下载, 关, 提示);
  面板.append(操);

  return 面板;
}

/* ══════════════════════════════════════════════════════════════════════
   Day 11 · 交互反馈
   ══════════════════════════════════════════════════════════════════════
   今天要回答的问题：用户怎么最明确地知道「生效了」？
   答案不是提示文字 —— 提示会被忽略、会被读一半；**被点的那个东西自己变了**才是硬信号。
   所以这里的做法是「主按钮自己给状态」+「就近一句说明 + 一个能立刻反悔的出口」两条通道叠加：
     ① 按钮态（收藏 → 处理中… → 已收藏）：不读字也看得见
     ② 反馈条（一句话 + 可选的「撤销 / 重试」）：说清发生了什么、现在能做什么
   两条都在**原位置**上变化 —— 不新增浮层、不弹窗、不把布局顶开（PRD 8.6）。

   ⚠️ 为什么「处理中」这一态由视图自己置、不等装配层回话：
      点下去到存储写完之间有一段谁也不知道结果的等待（慢网、首次跨部载入数据时尤其明显）。
      这一态就是那句「我收到了，正在办」；没有它，用户会以为没点中，然后再点一次。
   ⚠️ 为什么用 aria-disabled 而不是 disabled：见 收藏 按钮的点击守卫。 */

const 收藏文案 = { 未收藏: '收藏', 已收藏: '已收藏', 处理中: '处理中…' };

/**
 * 同步收藏按钮的样子。main.js 每次收藏变化后调它 ——
 * 面板不自己去问 store，问也是 main 的事。
 * @param {HTMLDialogElement} 面板 renderDetail 的返回值
 * @param {'未收藏'|'已收藏'|'处理中'|boolean} 态 传 boolean 时按「未收藏 / 已收藏」处理（旧签名，仍可用）
 * @param {{闪?: boolean}} 选项 闪 = 本次变化播一次描边闪动（只在「已收藏」时生效）
 */
export function 设收藏态(面板, 态, { 闪 = false } = {}) {
  const 钮 = 面板.querySelector('.act-fav');
  if (!钮) return;

  /* 旧签名兼容：boolean → 两个稳定态之一 */
  const 名 = 态 === true ? '已收藏' : 态 === false ? '未收藏' : 态;
  const 键 = 收藏文案[名] ? 名 : '未收藏';
  const 忙 = 键 === '处理中';

  钮.textContent = 收藏文案[键];
  钮.setAttribute('aria-pressed', 键 === '已收藏' ? 'true' : 'false');
  钮.setAttribute('aria-disabled', 忙 ? 'true' : 'false');
  钮.setAttribute('aria-busy', 忙 ? 'true' : 'false');

  if (闪 && 键 === '已收藏') 播一次闪动(钮);
}

/* 描边闪一下（.28s，只播一次）。全站第二条动效，仍然只让**朱砂**动。
   用途单一 —— 让「刚刚那下成了」抢到一次注意力。所以它由调用方点名要（闪: true），
   不做成「每次设态都播」：那样每开一条详情都在闪，就成了噪音。 */
function 播一次闪动(钮) {
  /* 尊重系统的「减少动态效果」：撤掉动画，反馈靠文案与颜色照旧成立 */
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  钮.classList.remove('is-flash');
  void 钮.offsetWidth;   /* 强制一次重排：连着两次收藏时，同一个 class 要能重新起动画 */
  钮.classList.add('is-flash');
  钮.addEventListener('animationend', () => 钮.classList.remove('is-flash'), { once: true });
}

/**
 * 在面板底部写一条反馈（收藏成功 / 已撤销 / 没存上）。
 * 空文本 = 清空。位置是常驻的那一行，只换内容，不动布局。
 * @param {HTMLDialogElement} 面板
 * @param {string} 文本
 * @param {{语气?: 'ok'|'bad', 动作?: {文字: string, 无障碍文案?: string, 点击: Function}}} 选项
 *        语气 bad = 朱砂色（失败专用，与「危/损」同色，不引入第二种红）
 *        动作 = 就近的下一步（「撤销」「重试」），**一次性** —— 点过即失效，防连点
 *        无障碍文案：按钮上只写「撤销」两个字，读屏单独念出来不知撤销的是哪一条，
 *                   所以给它一句完整的 name（例：撤销收藏「九尾狐」）
 */
export function 写提示(面板, 文本, 选项 = {}) {
  const 位 = 面板.querySelector('.act-hint');
  if (!位) return;

  const { 语气 = 'ok', 动作 } = 选项;

  位.textContent = '';                                   /* 连带清掉上一条的动作按钮 */
  位.classList.toggle('is-bad', 语气 === 'bad');

  if (!文本) return;

  /* 文本与按钮分成两个节点：反馈条是 flex，文本可换行、按钮不缩水。
     用 span 不用 建行()—— 反馈条本身就是 <p>，<p> 里塞 <p> 是非法结构。 */
  const 句 = document.createElement('span');
  句.className = 'act-hint-text';
  句.textContent = 文本;
  位.append(句);

  if (动作) {
    const 钮 = document.createElement('button');
    钮.type = 'button';
    钮.className = 'hint-act';
    钮.textContent = 动作.文字;
    if (动作.无障碍文案) 钮.setAttribute('aria-label', 动作.无障碍文案);
    钮.addEventListener('click', 事件 => {
      钮.disabled = true;      /* 一次性：连点两下「撤销」不该翻转两次 */
       动作.点击(事件);
    });
    位.append(钮);
  }
}
