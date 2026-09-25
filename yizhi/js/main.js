// 异兽志 · 入口
// 职责：启动、装配、绑定事件。数据从哪来、视图怎么画、怎么搜，都不该长在这个文件里。
//
// 与模块接口契约（TECH_DESIGN §6.2）的对应：
//   data.读包 / loadBu  → js/data.js            （M6 起 读包 拿整包，含部专属顶层字段）
//   views.renderGrid    → js/views/grid.js      （第 4 步起 · 异兽部）
//   views.renderTree    → js/views/tree.js      （M6 · 神仙部）
//   views.renderTimeline→ js/views/timeline.js  （M6 · 神话部）
//   views.renderGroups  → js/views/groups.js    （M6 · 妖怪部）
//   views.renderAxis    → js/views/axis.js      （M5 · 境界部）
//   views.renderResults → js/views/result.js    （M6 · 全站检索结果）
//   search.buildIndex / query → js/search.js
//   部工具条（吉凶筛选 / 序列开关）→ 本文件
//   store.* / transit.play / views.renderDetail / renderFavList
//
// 为什么筛选条不放 grid.js：契约强制 renderGrid 只吃 (容器, 条目[], 筛选态)，
// 而筛选条是「控件」—— 跟五部 tab、搜索框同类，是装配层的事。
//
// M6 的这次重写只干一件事：把「异兽志」这个单部页面变成「五部站」。
// 靠的是下面那张 部形态 表 —— 装配逻辑不认得「神仙」「境界」这些字，
// 只认得表里的四件事：用哪个视图画 / 台子挂什么 class / 工具条装什么 / 视图要什么额外参数。
// 再加一部（如 M6 之后的六部）只需往表里加一行。

import { 读包, 吉凶枚举, 部ofId } from './data.js';
import { renderGrid, 图源 } from './views/grid.js';
import { renderTree } from './views/tree.js';
import { renderTimeline } from './views/timeline.js';
import { renderGroups } from './views/groups.js';
import { renderAxis } from './views/axis.js';
import { renderResults } from './views/result.js';
import { renderDetail, 设收藏态, 写提示 } from './views/detail.js';
import { renderFavList } from './views/fav.js';
import { 建行 } from './views/card.js';
import { buildIndex, query } from './search.js';
import * as store from './store.js';
import { play as 播转场 } from './transit.js';
import { 打开请求, 关闭请求, 收藏切换, 导出请求 } from './events.js';

/* ══════════════════════════════════════════════════════════════════════
   状态
   ══════════════════════════════════════════════════════════════════════ */

const 五部 = ['神仙', '神话', '异兽', '妖怪', '境界'];

/* —— 部形态表：全站唯一的「哪部长什么样」的地方 ——
   台 = 视图台挂的 class（.grid 带乌丝栏的网格底 / .stage 素底）
   工具 = 部内工具条装什么：'吉凶'（异兽）| '序列'（境界）| null（其余三部）
   参数 = 交给视图的额外实参（契约里各视图的第三参数） */
const 部形态 = {
  神仙: { 视图: renderTree, 台: 'stage', 工具: null },
  神话: { 视图: renderTimeline, 台: 'stage', 工具: null },
  /* 异兽部的第三个参数就是当前筛选态。
     ⚠️ Day 12 自检发现：Day 7 重构「部形态表」时这一行漏了「参数」，于是 renderGrid
     收到 undefined、通过筛选直接放行 —— 点筛选按钮看着有反应（按钮态、站况文案都对），
     结果却一条不少，肉眼很难看出来。补回来，也提醒后来人：改这张表别漏第三个参数。 */
  异兽: { 视图: renderGrid, 台: 'grid', 工具: '吉凶', 参数: () => [当前筛选态()] },
  妖怪: {
    视图: renderGroups,
    台: 'stage',
    工具: null,
    /* 妖怪部的附注（形类释义 + 年表）在 JSON 顶层，不在条目里，所以要从整包取 */
    参数: () => [{ 形类释义: 当前包 && 当前包.形类释义, 年表: 当前包 && 当前包.年表 }],
  },
  境界: { 视图: renderAxis, 台: 'stage', 工具: '序列', 参数: () => [当前序列] },
};

let 当前部 = '异兽';
let 当前包 = null;             // 当前部的整包（含部专属顶层字段）
const 包缓存 = new Map();      // 部 → 整包（按需加载，切回来不再重读）
const 条目表 = new Map();      // id → 条目（**全站**，收藏与检索跨部捞取靠它）

let 基准 = [];                 // 当前部要显示的条目（部内浏览时 = 当前包.条目）
let 全站索引 = null;           // 首次检索时建（TECH_DESIGN §6.2 loadAll 的用途）
let 建索引中 = null;           // 建索引的进行中 Promise，防止连打字连着建五份
let 检索中 = false;            // 结果区当前显示的是检索结果还是部内浏览

const 选中吉凶 = new Set();    // 空集合 = 不筛。同维度多值可叠（或），不做多条件组合面板（PRD 8.2 边界）
let 当前序列 = '网文';         // 境界部当前序列：'网文' | '真丹道'

const 视图台 = document.getElementById('视图台');
const 搜索框 = document.getElementById('搜索框');
const 部工具 = document.getElementById('部工具');
const 筛选钮 = new Map();      // 值 → 按钮（键 '__全部' 是复位位）。留着是为了「只同步、不重建」

/* ══════════════════════════════════════════════════════════════════════
   小工具
   ══════════════════════════════════════════════════════════════════════ */

/* 建行 已挪到 views/card.js（Day 8 余力加练：四处抄了同一份） */

/* 空心块：只给 class，不给文字 —— 骨架要表达的是「形状」，写文字反而把形状盖住了 */
function 建样式块(类名) {
  const 节点 = document.createElement('span');
  节点.className = 类名;
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

function 设台(类名) {
  视图台.className = 类名;
}

/* ══════════════════════════════════════════════════════════════════════
   数据：按需加载
   ══════════════════════════════════════════════════════════════════════ */

/**
 * 取一部的整包。已读过的直接给缓存 —— 切部来回切不重复读文件。
 * 顺手把条目灌进 条目表：收藏与检索要在**全站**范围内按 id 捞条目。
 */
async function 取包(部名) {
  if (包缓存.has(部名)) return 包缓存.get(部名);

  const 包 = await 读包(部名);
  包缓存.set(部名, 包);
  包.条目.forEach(条 => 条目表.set(条.id, 条));
  return 包;
}

/** 按 id 拿一条；当前没载入那部就去载它（收藏夹里可能是任意一部的东西） */
async function 确保条目(id) {
  if (条目表.has(id)) return 条目表.get(id);
  const 部 = 部ofId(id);
  if (部) {
    try { await 取包(部); } catch (错) { console.warn('[异兽志] 为取条目而载入某部失败：', 部, 错); }
  }
  return 条目表.get(id) || null;
}

/** 建全站索引（只建一次）。并发的调用共享同一个进行中的 Promise。 */
function 建全站索引() {
  if (全站索引) return Promise.resolve(全站索引);
  if (建索引中) return 建索引中;

  建索引中 = Promise.allSettled(五部.map(取包)).then(结果 => {
    const 全部 = [];
    结果.forEach((项, 序) => {
      if (项.status === 'fulfilled') 全部.push(...项.value.条目);
      else console.warn('[异兽志] 建索引时跳过一部：', 五部[序], 项.reason);
    });
    if (全部.length) 全站索引 = buildIndex(全部);
    建索引中 = null;
    return 全站索引;
  });

  return 建索引中;
}

/* ══════════════════════════════════════════════════════════════════════
   渲染：五部 tab
   ══════════════════════════════════════════════════════════════════════ */

function 渲染部Tab() {
  const 容器 = document.getElementById('部tabs');
  容器.textContent = '';
  五部.forEach(名 => {
    const 钮 = document.createElement('button');
    钮.type = 'button';
    钮.className = 'bu';
    钮.textContent = 名;
    钮.setAttribute('aria-current', 名 === 当前部 ? 'true' : 'false');
    钮.addEventListener('click', () => 切部(名));
    容器.append(钮);
  });
}

/* ══════════════════════════════════════════════════════════════════════
   渲染：部工具条（异兽 = 吉凶筛选 / 境界 = 序列开关 / 其余 = 隐藏）
   ══════════════════════════════════════════════════════════════════════ */

function 渲染部工具() {
  const 工具 = 部形态[当前部].工具;

  部工具.textContent = '';
  筛选钮.clear();
  /* 重建时机只有三个：换部、换序列、进出检索 —— 都不在「每敲一个字」的路径上，
     所以不需要以前那套「基准签名没变就不重建」的防闪保护了。 */

  /* 检索结果是跨部的，部内工具在那种上下文里没有对象 —— 整条收起，
     不留一个「点了不知道筛什么」的控件（与零结果时收起筛选条同一条理由）。 */
  if (检索中 || !工具) { 部工具.hidden = true; return; }
  部工具.hidden = false;

  if (工具 === '吉凶') return 渲染筛选条();
  if (工具 === '序列') return 渲染序列开关();
}

/* —— 异兽部的吉凶筛选（F2，PRD 8.2）——
   条数标在按钮上，是为了让人「点之前」就看见点下去有没有东西。
   徽标基于「基准」而不是全量：筛完再看的数目才对得上（否则会显示整部的分布，点下去数字不符）。 */
function 渲染筛选条() {
  const 标签 = document.createElement('span');
  标签.className = 'filter-label';
  标签.textContent = '吉凶';
  部工具.append(标签);

  /* 「全部」放最前：它是复位位，不是第五个分类值，所以不计弱化、条数取基准全量 */
  const 全部钮 = 建筛选钮('全部', 基准.length, false);
  全部钮.addEventListener('click', () => { 选中吉凶.clear(); 应用筛选(); });
  筛选钮.set('__全部', 全部钮);
  部工具.append(全部钮);

  const 隔 = document.createElement('span');
  隔.className = 'chip-sep';
  隔.setAttribute('aria-hidden', 'true');
  部工具.append(隔);

  吉凶枚举.forEach(值 => {
    const 数 = 基准.filter(条 => 条.吉凶 === 值).length;
    const 钮 = 建筛选钮(值, 数, 数 === 0);
    钮.addEventListener('click', () => {
      if (选中吉凶.has(值)) 选中吉凶.delete(值);
      else 选中吉凶.add(值);
      应用筛选();
    });
    筛选钮.set(值, 钮);
    部工具.append(钮);
  });

  同步筛选条();
}

/* —— 境界部的双序列开关（PRD §4 的「杀手细节」）——
   两套序列并排一个开关，点一下就换。副题与说明来自 JSON 顶层（`序列`），
   不写在这里 —— 它们是内容（谁出的、什么性质），内容归 JSON（§12.2）。 */
function 渲染序列开关() {
  const 标签 = document.createElement('span');
  标签.className = 'filter-label';
  标签.textContent = '序列';
  部工具.append(标签);

  const 序们 = (当前包 && 当前包.序列) || [];
  序们.forEach(项 => {
    const 钮 = 建筛选钮(项.名, null, false);   // null 条数 = 不挂徽标
    钮.title = 项.副题 || '';
    钮.addEventListener('click', () => 切序列(项.名));
    筛选钮.set(项.名, 钮);
    部工具.append(钮);
  });

  同步序列开关();

  /* 副题 + 说明单起一行，占满整条：这两句正是「两套序列差在哪」的答案，不能省 */
  const 选中 = 序们.find(项 => 项.名 === 当前序列) || 序们[0];
  if (选中) {
    const 注 = document.createElement('p');
    注.className = 'filter-note';
    注.textContent = [选中.副题, 选中.说明].filter(Boolean).join(' · ');
    部工具.append(注);
  }
}

function 建筛选钮(文字, 条数, 弱化) {
  const 钮 = document.createElement('button');
  钮.type = 'button';
  钮.className = 'chip';
  钮.textContent = 文字;                 // 一律 textContent，条目内容不进 innerHTML
  if (弱化) 钮.dataset.空 = '1';          // 当前 0 条：只弱化不禁用，点了给出口

  if (条数 != null) {                    // 序列开关没有条数概念，不挂徽标
    const 标 = document.createElement('span');
    标.className = 'chip-n';
    标.textContent = String(条数);
    钮.append(标);
  }

  return 钮;
}

function 同步筛选条() {
  筛选钮.forEach((钮, 键) => {
    if (键 === '__全部') { 钮.setAttribute('aria-pressed', 选中吉凶.size === 0 ? 'true' : 'false'); return; }
    钮.setAttribute('aria-pressed', 选中吉凶.has(键) ? 'true' : 'false');
  });
}

function 同步序列开关() {
  筛选钮.forEach((钮, 键) => 钮.setAttribute('aria-pressed', 键 === 当前序列 ? 'true' : 'false'));
}

/* ══════════════════════════════════════════════════════════════════════
   铺台子：部内浏览
   ══════════════════════════════════════════════════════════════════════ */

function 当前筛选态() {
  return 选中吉凶.size ? { 吉凶: [...选中吉凶] } : null;
}

function 应用筛选() {
  同步筛选条();
  铺当前部();
}

/* 铺台子：部内浏览的唯一出口。
   换部、改筛选、清检索最后都走到这里，站况与空态出口因此只有一份。 */
function 铺当前部() {
  const 形态 = 部形态[当前部];
  设台(形态.台);

  const 额外 = 形态.参数 ? 形态.参数() : [];
  const 条数 = 形态.视图(视图台, 基准, ...额外);

  /* 异兽部：基准非空却零条 = 被筛选滤空了，不是没数据。给出口，不给死胡同（PRD 9.2 ②） */
  if (当前部 === '异兽' && !条数 && 基准.length) return 渲染筛空();

  写站况数(条数);
}

/* 多选取「或」：『筛「吉祥、凶恶」』会被读成「吉祥且凶恶」，而条目不可能两样都是，
   所以选中多个值时显式写「或」。单选不带连接词。 */
function 筛选说法() {
  return `筛「${[...选中吉凶].join(' 或 ')}」`;
}

function 写站况数(条数) {
  if (检索中) {
    写站况(`全站 · 搜「${搜索框.value.trim()}」 · ${条数} 条`);
    return;
  }

  /* 境界部把当前序列也写进站况：这一部「看的是哪套序列」是状态，不写出来就看不见 */
  const 序列词 = 部形态[当前部].工具 === '序列' && 当前序列 ? ` · ${当前序列}` : '';
  const 筛选词 = 选中吉凶.size ? ` · ${筛选说法()}` : '';
  写站况(`${当前部}部${序列词}${筛选词} · ${条数} 条`);
}

/* 筛选滤空的面板 —— 复用零结果的语言：这两块都是「出了状况，但有出路」 */
function 渲染筛空() {
  视图台.textContent = '';

  const 块 = document.createElement('div');
  块.className = 'zero';
  块.append(建行('zero-msg', `${筛选说法()}下暂时没有条目。`));
  块.append(建行('zero-lead', `这里一共 ${基准.length} 条，换个筛法看看。`));
  块.append(建动作钮(`清除筛选，看全部 ${基准.length} 条`, () => {
    选中吉凶.clear();
    应用筛选();
  }));

  视图台.append(块);
  写站况(`${当前部}部 · 筛选无结果`);
}

/* ══════════════════════════════════════════════════════════════════════
   加载中（第四种状态 / Day 8）
   ══════════════════════════════════════════════════════════════════════
   为什么补它：另外三种状态都有「事件」当触发者 —— 成功是默认路径、空是搜不到、
   错是读不到。只有加载中发生在**没人操作、也没东西坏**的那几百毫秒里，
   本地读 30KB 只要十几毫秒、根本看不见，慢网才暴露；而它没做好就是一片白，
   还容易被读成「页面还没打开」而不是「页面正在加载」。

   形制：不转圈。转圈是「现代 UI 语言」，与纸墨的调子不合。改成「淡墨纸样」——
   异兽部预告卡片（图 + 四行），其余四部形状各异（树 / 轴 / 分组）预告不了具体形状，
   就只预告「有内容要来」。淡墨压在墨的 6–7%，远看仍是纸纹。

   防闪：**不用 JS 定时器**，淡入延迟交给 CSS（.skeleton 的 animation-delay .12s）。
   数据十几毫秒就到时，骨架还没现身就被真内容换掉了。
   这里省掉的那个 clearTimeout，正是这类代码最容易漏掉、漏了就出鬼的地方。
   骨架的退场不需要谁去删：视图函数一律先 容器.textContent = ''（各 views/*.js 首行），
   加载失败那条路也在 渲染加载失败 里清空过。 */
function 渲染加载中(部名) {
  const 形态 = 部形态[部名];
  设台(形态.台);
  视图台.textContent = '';

  /* 是不是网格部，决定预告哪种形状 —— 判据用它自己的台 class，不另立一份名单 */
  const 是网格 = 形态.台 === 'grid';

  const 块 = document.createElement('div');
  块.className = 是网格 ? 'skeleton skeleton-grid' : 'skeleton';
  /* 屏读只说一句话，不逐块念「占位、占位、占位」 */
  块.setAttribute('role', 'status');
  块.setAttribute('aria-busy', 'true');
  块.setAttribute('aria-label', `正在读取${部名}部`);
  块.append(建行('sk-hint', `正在读取${部名}部…`));

  if (是网格) {
    /* 四张卡片：数量取「一屏可能看到的张数」，不必等于该部条数 ——
       骨架是预告，不是进度条；按 12 条铺满反而像在数数。 */
    for (let i = 0; i < 4; i++) {
      const 卡 = document.createElement('div');
      卡.className = 'sk-card';
      卡.append(建样式块('sk-figure'));

      const 身 = document.createElement('div');
      身.className = 'sk-body';
      /* 四行对应真卡片的 名 / 别名 / 原文 / 用法，宽度错开才像「一段文字」而不是「一排尺子」 */
      ['w62', 'w34', 'w92', 'w78'].forEach(宽 => 身.append(建样式块('sk-bar ' + 宽)));
      卡.append(身);

      块.append(卡);
    }
  } else {
    /* 非网格部：形状预告不了（树 / 轴 / 分组各不同），只预告「有内容要来」。
       六条、宽度错落 —— 四条等宽撑满看着像「几根灰杠」，错落的宽度才像一段条目列表。 */
    ['', 'w70', '', 'w48', 'w82', 'w56'].forEach(宽 => {
      块.append(建样式块(宽 ? 'sk-line ' + 宽 : 'sk-line'));
    });
  }

  视图台.append(块);
}

/* —— 数据没读到时的出路：一句人话 + 一个能点的按钮（TECH_DESIGN §9-1，不白屏、不弹 alert） —— */
function 渲染加载失败(错) {
  设台(部形态[当前部].台);
  视图台.textContent = '';
  部工具.hidden = true;

  const 块 = document.createElement('div');
  块.className = 'load-fail';
  块.append(建行('load-fail-msg', `${(错 && 错.部名) || 当前部}部数据没读到。`));
  if (错 && 错.原因) 块.append(建行('load-fail-why', `原因：${错.原因}`));
  块.append(建动作钮('重试', () => 切部(当前部)));

  视图台.append(块);
  写站况(`${当前部}部 · 未读到数据`);
}

/* ══════════════════════════════════════════════════════════════════════
   切部 / 切序列 / 检索
   ══════════════════════════════════════════════════════════════════════ */

async function 切部(名) {
  if (!五部.includes(名)) return;

  当前部 = 名;
  检索中 = false;
  搜索框.value = '';          // 换部时检索结果已无意义，一起清掉
  选中吉凶.clear();

  渲染部Tab();
  部工具.hidden = true;
  写站况(`${名}部 · 读取中`);
  渲染加载中(名);        // 读取期间先铺骨架，别留一片白 —— 第四种状态（Day 8）

  try {
    当前包 = await 取包(名);
  } catch (错) {
    当前包 = null;
    基准 = [];
    return 渲染加载失败(错);
  }

  基准 = 当前包.条目;

  /* 境界部：数据里没有当前选中的那套序列时，回到里头的第一套 ——
     否则会画出一根空轴，而那看起来像「这部没内容」。 */
  if (部形态[名].工具 === '序列') {
    const 名们 = (当前包.序列 || []).map(项 => 项.名);
    if (!名们.includes(当前序列)) 当前序列 = 名们[0] || '';
  }

  渲染部工具();
  铺当前部();
}

function 切序列(名) {
  if (名 === 当前序列) return;
  当前序列 = 名;
  渲染部工具();
  铺当前部();
}

/* 检索（F1）——
   M6 起是**全站检索**：五部一起搜。理由有两条，都是硬的：
     ① PRD 8.1 要求「输入'九尾狐'结果不止一条」——只搜异兽部永远只有一条；
     ② 别称本来就不受书籍限制（PRD §4 硬约束 2）：「妲己」指九尾狐，「九尾狐」也该指到妖怪部的狐妖。
   所以结果区换成统一的「列表」形态（views/result.js），并收起部内工具条。 */
async function 执行搜索(输入) {
  const 关键词 = String(输入 == null ? '' : 输入).trim();

  if (!关键词) {
    退出检索();
    return;
  }

  /* 数据还没备齐就先报「读取中」，不假装能搜、也不给死胡同 */
  if (!全站索引) {
    设台('stage');
    部工具.hidden = true;
    视图台.textContent = '';
    const 块 = document.createElement('div');
    块.className = 'zero';
    块.append(建行('zero-msg', '数据还在读，稍等一下再搜。'));
    视图台.append(块);
    写站况('全站 · 读取中');

    await 建全站索引();
    /* 等完再按当前输入重来一次：期间用户可能又打了字 */
    if (搜索框.value.trim() !== 关键词) return;
    if (!全站索引) { 渲染全站读不到(); return; }
  }

  const 结果 = query(全站索引, 关键词);
  检索中 = true;
  部工具.hidden = true;

  if (结果.直接命中.length) {
    设台('stage');
    renderResults(视图台, 结果.直接命中);
    写站况数(结果.直接命中.length);
    return;
  }

  渲染零结果(结果.相近, 关键词);
}

/* 五部全没读到才可能走到这里 —— 逐部失败已经在控制台记过，这里只给用户一句人话 */
function 渲染全站读不到() {
  设台('stage');
  视图台.textContent = '';
  const 块 = document.createElement('div');
  块.className = 'load-fail';
  块.append(建行('load-fail-msg', '五部数据都没读到，检索暂时不能用。'));
  块.append(建动作钮('重试', () => 切部(当前部)));
  视图台.append(块);
  写站况('全站 · 未读到数据');
}

function 退出检索() {
  检索中 = false;
  搜索框.value = '';
  基准 = 当前包 ? 当前包.条目 : [];
  渲染部工具();
  铺当前部();
}

/* —— 零结果不给死胡同（PRD 9.2 ② / TECH_DESIGN §9-9）：
     明说没找到 → 给相近条目（点了就换成它去搜）→ 再给「清空」这一步退路。 —— */
function 渲染零结果(相近, 关键词) {
  设台('stage');
  视图台.textContent = '';
  部工具.hidden = true;

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
      /* 相近条目可能来自别的部 —— 角标写清它属于哪一部，点了也才好找 */
      钮.textContent = `${条.名}（${条.部}）`;
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

  块.append(建动作钮(`清空，回到${当前部}部`, 清空搜索));

  视图台.append(块);
  写站况(`全站 · 搜「${关键词}」无结果`);
}

function 清空搜索() {
  搜索框.focus();
  退出检索();
}

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
   所以只留这一个出口，别处一律不许直接改这几个 DOM。

   M6 起收藏夹要跨五部捞条目：当前部载入的那一份不够用了，捞不到的按 id 前缀
   去载它所属的那一部（只读、顺手进缓存）—— 这样「收藏了一条境界、刷新后打开收藏夹」
   也能正常显示，而不是被误判成「已下架」（TECH_DESIGN §12.4）。 */
async function 收藏条目() {
  const ids = store.list();
  if (!ids.length) return [];

  await Promise.all(
    ids.filter(id => !条目表.has(id))
      .map(id => 部ofId(id))
      .filter(Boolean)
      .filter((部, 序, 全) => 全.indexOf(部) === 序)      // 同一部只载一次
      .map(部 => 取包(部).catch(错 => console.warn('[异兽志] 收藏夹载入某部失败：', 部, 错))),
  );

  /* 捞不到（条目被删）**不能静默消失** —— 收藏夹里少了东西而没有解释，
     比少东西本身更让人困惑。给一条「已下架」的占位，并在列表里留一个「移除」出口。 */
  return ids.map(id => 条目表.get(id)
    || { id, 名: '此条已下架', 部: 部ofId(id) || '', 出处: '', 已下架: true });
}

/* 导出时要把占位滤掉：占位不是内容，不该出现在导出文本里 */
function 可导出的收藏(收藏们) {
  return 收藏们.filter(条 => !条.已下架);
}

async function 同步收藏() {
  const 收藏们 = await 收藏条目();
  const 条数 = store.list().length;

  收藏计数.textContent = String(条数);
  收藏说明.textContent = `${条数} 条`;
  if (当前详情) 设收藏态(当前详情, store.has(当前详情.dataset.id));
  /* 收藏面板开着就重画：取消收藏后那一条要立刻消失（PRD 8.5） */
  if (收藏面板.open) renderFavList(收藏列表, 收藏们);

  return 收藏们;
}

/* 反馈统一从这里出去：详情面板开着就写在面板底部，否则写在收藏面板头下。
   Day 11 起多接了两个可选参数（语气 / 动作），见 views/detail.js 的 写提示。 */
function 提示(文本, 选项 = {}) {
  if (当前详情 && 当前详情.open) {
    写提示(当前详情, 文本, 选项);
    return;
  }
  收藏提示.textContent = 文本;
  收藏提示.classList.toggle('is-bad', 选项.语气 === 'bad');
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

/* 点一行 → 开详情。行可能是网格卡、竖轴行、谱系叶、时间轴节、六类条、检索结果行 ——
   它们的共同点是都带 data-id（M6 起统一用 data-id 委托，不再只认 .card）。 */
async function 点开行(目标) {
  const 行 = 目标.closest('[data-id]');
  if (!行) return;
  打开某id(行.dataset.id);
}

/* 按 id 开详情。收藏夹里的条目可能属于任意一部（甚至是还没载入的那部），
   所以先经 确保条目 把数据备齐，再开。转场要在这之前播，否则会先闪出一块空白。 */
async function 打开某id(id) {
  const 条 = await 确保条目(id);
  if (条) 打开详情(条);
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
   第一版加了早退，结果「移除」按钮点了没反应 —— 探针抓到了。

   Day 11：这个动作现在要给「四件套」反馈 —— 成功 / 可撤销 / 处理中 / 失败。
   处理中由视图在点击那一刻自置（views/detail.js），这里只负责结果那两条路。 */
async function 处理收藏(id, 来源 = '按钮') {
  const 条 = await 确保条目(id);
  const 名 = 条 ? 条.名 : '这条已下架的内容';

  try {
    const 现在 = store.toggle(id);
    await 同步收藏();          /* 这一步里已经把详情按钮刷成真状态 */

    const 面板 = 当前详情 && 当前详情.open && 当前详情.dataset.id === id ? 当前详情 : null;

    if (现在) {
      /* 成功：主按钮变「已收藏」并闪一下朱砂，再就近给一句 + 一个「撤销」出口。
         「撤销」只在**刚收藏成功**时给 —— 此刻用户最可能的下一步就是「点错了，撤回去」，
         而这个动作正好与主按钮相反、一步可达。取消收藏时不给：再点一次主按钮就是撤销，
         多给一个反而要人想「撤销的是哪一下」。 */
      if (面板) 设收藏态(面板, '已收藏', { 闪: true });
      提示(`已收藏「${名}」`, {
        动作: { 文字: '撤销', 无障碍文案: `撤销收藏「${名}」`, 点击: () => 处理收藏(id, '撤销') },
      });
      return;
    }

    提示(来源 === '撤销' ? `已撤销收藏「${名}」` : `已从收藏夹移出「${名}」`);
  } catch {
    /* 写失败（多半是 localStorage 写满）：不假装成功，也不清空已有收藏（TECH_DESIGN §9-8）。
       先把界面刷回真状态，再明说没存上，并给一个「重试」—— 失败态必须同时给出路。 */
    await 同步收藏();
    提示('没能存上：本机存储写满了，先取消几条再试。', {
      语气: 'bad',
      动作: { 文字: '重试', 无障碍文案: `重试收藏「${名}」`, 点击: () => 处理收藏(id, 来源) },
    });
  }
}

/* —— 导出 —— */
async function 处理导出({ id, 方式 }) {
  const 条 = await 确保条目(id);
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

async function 导出收藏夹() {
  const 收藏 = 可导出的收藏(await 收藏条目());
  if (!收藏.length) {
    收藏提示.textContent = '收藏夹是空的，没有可导出的内容。';
    return;
  }
  store.下载txt(store.exportText(收藏));
  收藏提示.textContent = `已导出 ${收藏.length} 条（含原文与出处）。`;
}

/* ══════════════════════════════════════════════════════════════════════
   事件绑定
   ══════════════════════════════════════════════════════════════════════ */

/* —— 输入即响应（PRD 9.2 ②）。数据在内存里，不需要防抖，敲一个字符就重铺一次 —— */
搜索框.addEventListener('input', () => 执行搜索(搜索框.value));

/* 原生 type=search 的 Esc 只清值不重铺，这里补上「清完要回到部内浏览」 */
搜索框.addEventListener('keydown', 事件 => {
  if (事件.key === 'Escape') {
    事件.preventDefault();
    清空搜索();
  }
});

/* —— 内容区上的点击（事件委托）——
   行是各 views 建的，但「点了之后干什么」是装配层的事，所以监听挂在这里。
   委托而不是逐行挂监听：重新铺一次（换部、筛选、检索）不用重新绑定。 */
视图台.addEventListener('click', 事件 => 点开行(事件.target));

/* 行带了 role="button"，键盘也得能开（Enter / 空格），否则等于只给鼠标用 */
视图台.addEventListener('keydown', 事件 => {
  if (事件.key !== 'Enter' && 事件.key !== ' ') return;
  if (!事件.target.closest('[data-id]')) return;
  事件.preventDefault();   // 空格默认会滚动页面
  点开行(事件.target);
});

/* —— 视图层派发上来的事件，统一在 document 上收（它们都 bubbles）—— */
document.addEventListener(打开请求, 事件 => { 打开某id(事件.detail.id); });
document.addEventListener(关闭请求, 事件 => {
  /* 关闭请求从两个地方来：详情的「收起」按钮、收藏面板的「收起」。
     用事件源判断该关哪个 —— 把当前开着的那个关掉就行。 */
  if (收藏面板.contains(事件.target)) 收起收藏面板();
  else 收起详情();
});

/* 来源（'按钮' | '撤销'）只影响文案，不影响动作 —— 两个入口做的是同一件事（toggle） */
document.addEventListener(收藏切换, 事件 => { 处理收藏(事件.detail.id, 事件.detail.来源 || '按钮'); });
document.addEventListener(导出请求, 事件 => { 处理导出(事件.detail); });

收藏入口.addEventListener('click', async () => {
  const 收藏们 = await 同步收藏();
  renderFavList(收藏列表, 收藏们);
  收藏提示.textContent = '';
  收藏面板.showModal();
});

document.getElementById('关收藏').addEventListener('click', 收起收藏面板);
document.getElementById('导出收藏').addEventListener('click', 导出收藏夹);
挂背板关(收藏面板, 收起收藏面板);

/* ══════════════════════════════════════════════════════════════════════
   启动
   ══════════════════════════════════════════════════════════════════════ */

渲染部Tab();
切部('异兽');
同步收藏();

/* localStorage 不可用（隐私模式 / 被禁用）时明说一句，别让人收藏半天才发现刷新就没了（TECH_DESIGN §9-7）。
   放在这里而不是页面顶部：不加一块常驻的提示条，只在收藏入口上标出来。 */
if (!store.可用()) {
  收藏入口.title = '本浏览器无法保存收藏（隐私模式或已禁用本地存储），收藏只在本次浏览有效';
  收藏说明.textContent = '本浏览器无法保存收藏，关掉页面即失效';
}

console.log('[异兽志] M6 已接：五部全通（神仙谱系树 / 神话时间轴 / 异兽图鉴 / 妖怪六类 / 境界竖轴）· 全站检索 · 图源目录 %s', 图源);
