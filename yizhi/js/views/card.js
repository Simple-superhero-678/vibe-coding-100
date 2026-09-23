// 异兽志 · 视图层「卡片地基」（Day 8 余力加练）
// 契约：不属于 TECH_DESIGN §6.2 列出的公开函数 —— 它是视图层的内部公共件。
//
// 为什么抽出来（和 portrait.js 同一个理由）：同一个零件被抄了四五遍，迟早走岔。
// 加练前实测的重复点：
//   ① `建行(类名, 文本)` 一模一样的 6 行，在 grid.js / result.js / fav.js / main.js 各存一份；
//   ② 「可点条目」四件套（data-id + role=button + tabindex=0 + aria-label）
//      在 grid.js 与 result.js 各抄一遍 —— 这四样少一样，键盘用户就够不着那条内容；
//   ③ 卡片骨架（印章 / 图 / 名 / 别名 / 引文 / 用法 / 出处）只在 grid.js，没导出，
//      别的列表想用只能再抄一份。
//
// 本层不认识「数据从哪来」：只吃条目，不 import data.js（TECH_DESIGN §12.5）。

import { 建图 } from './portrait.js';

/* —— 小工具 —— */
export function 建行(类名, 文本) {
  const 节点 = document.createElement('p');
  节点.className = 类名;
  节点.textContent = 文本;   // 一律 textContent，条目内容不进 innerHTML
  return 节点;
}

/* —— 可点条目 ——
   列表项整块可点（点开详情）。可点的东西就得是键盘够得着的，所以带 role/tabindex，
   由 main.js 的委托监听接 Enter / 空格。
   data-id 是「点了之后打开哪一条」的唯一凭据 —— 装配层靠它反查条目，
   而不是把整条数据塞进 DOM 里。
   集中到一处的原因：这四件套少写一样，坏的是「键盘用户」而不是「我」，
   键盘用户不会来报错，只会默默用不了。 */
export function 建可点条目({ 标签 = 'div', 类名 = '', id, 无障碍文案 } = {}) {
  const 节点 = document.createElement(标签);
  if (类名) 节点.className = 类名;
  if (id) 节点.dataset.id = id;
  节点.setAttribute('role', 'button');
  节点.setAttribute('tabindex', '0');
  if (无障碍文案) 节点.setAttribute('aria-label', 无障碍文案);
  return 节点;
}

/* —— 图鉴卡（异兽部等 grid 台用）——
   与「结果项」的区别是它带形象图：非异兽条目没有图，一列空白画心会把结果页毁掉，
   所以检索结果走下面的 建结果项，不走这里。 */
export function 建图鉴卡(条) {
  const 卡 = 建可点条目({
    标签: 'article',
    类名: 'card',
    id: 条.id,
    无障碍文案: `打开「${条.名}」的详情`,
  });

  const 印章 = document.createElement('span');
  印章.className = 'seal';
  /* 印章标「吉凶」，没有吉凶的条目（E 部境界）退一步标「部」——
     PRD 8.6 要的是「朱砂印章（方形角标，标吉凶或部类）」，两种都算数。
     一律写成「未分类」就把这条识别特征浪费了。 */
  印章.textContent = 条.吉凶 || 条.部 || '未分类';
  卡.append(印章);

  /* 无条件出图：没图时 建图() 自己返回安静空框（不出破图标），
     这里不能加 if —— 加了就少一个 .portrait-empty，重构即改行为。 */
  卡.append(建图(条));

  const 身 = document.createElement('div');
  身.className = 'card-body';

  const 名 = document.createElement('h2');
  名.className = 'card-name';
  名.textContent = 条.名;
  身.append(名);

  if (条.别名 && 条.别名.length) 身.append(建行('card-alias', 条.别名.join(' · ')));
  身.append(建行('card-quote', 条.原文));
  if (条.写小说怎么用) 身.append(建行('card-use', 条.写小说怎么用));
  身.append(建行('card-src', 条.出处));

  卡.append(身);
  return 卡;
}

/* —— 结果项（V1 检索结果区用）——
   一行一条，带上「它属于哪一部」的朱砂角标：M6 起检索是全站五部一起搜的，
   一条「九尾狐」可能同时命中异兽部与妖怪部的条目，部角标是「这条从哪来」的唯一凭据。 */
export function 建结果项(条) {
  const 项 = 建可点条目({
    标签: 'li',
    类名: 'result-item',
    id: 条.id,
    无障碍文案: `打开「${条.名}」的详情（${条.部}部）`,
  });

  const 角 = document.createElement('span');
  角.className = 'result-bu';
  角.textContent = 条.部;

  const 身 = document.createElement('div');
  身.className = 'result-body';

  const 头 = document.createElement('div');
  头.className = 'result-head';

  const 名 = document.createElement('h3');
  名.className = 'result-name';
  名.textContent = 条.名;
  头.append(名);
  /* 吉凶只有 A–D 部有（E 部境界无此字段），有才画 */
  if (条.吉凶) {
    const 印 = document.createElement('span');
    印.className = 'result-mark';
    印.textContent = 条.吉凶;
    头.append(印);
  }
  身.append(头);

  if (条.别名 && 条.别名.length) 身.append(建行('result-alias', `又称：${条.别名.join(' · ')}`));
  身.append(建行('result-quote', 条.原文));
  身.append(建行('result-src', 条.出处));

  项.append(角, 身);
  return 项;
}
