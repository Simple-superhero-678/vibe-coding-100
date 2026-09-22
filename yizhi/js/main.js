// 异兽志 · 入口
// 职责：启动、装配、绑定事件。数据从哪来、视图怎么画、怎么搜，都不该长在这个文件里。
//
// 与模块接口契约（TECH_DESIGN §6.2）的对应：
//   data.loadBu       → js/data.js           （第 3 步起）
//   views.renderGrid  → js/views/grid.js     （第 4 步起）
//   search.buildIndex / query → js/search.js （第 5 步起）
//   吉凶筛选条        → 本文件               （第 6 步起；见下方说明）
//
// 为什么筛选条不放 grid.js：契约强制 renderGrid 只吃 (容器, 条目[], 筛选态)，
// 而筛选条是「控件」—— 跟五部 tab、搜索框同类，是装配层的事。
// grid.js 只留谓词（通过筛选），把「按钮长什么样、点了算选中还是取消、空了给什么出口」留给这里。

import { loadBu, 吉凶枚举 } from './data.js';
import { renderGrid, 图源 } from './views/grid.js';
import { buildIndex, query } from './search.js';

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

渲染部Tab();
载入();

console.log('[异兽志] Day 7 第 6 步 · 吉凶筛选条已接 · 图源目录 %s', 图源);
