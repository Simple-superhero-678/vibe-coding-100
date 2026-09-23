// 异兽志 · 视图层「检索结果」（V1 的结果区）
// 契约（M6 新增）：renderResults(容器, 条目[])
//
// 为什么检索结果与部内浏览**长得不一样**：
//   M6 起检索是全站五部一起搜的（TECH_DESIGN §6.2 loadAll 的用途），
//   一条「九尾狐」可能同时命中异兽部的条目与妖怪部的条目。
//   若沿用异兽部的图鉴卡，非异兽条目没有形象图 —— 一列空白画心会把结果页毁掉；
//   而且五部各有各的卡片语言（谱系树的叶、时间轴的节、六类的条），混排必然读不出来。
//   所以结果区统一成一种「列表」形态：一行一条，带上「它属于哪一部」的朱砂角标。
//
// 这不是新页面：F1 要求结果直接落在 V1，所以它画的还是同一个容器（结果区），
// 只是换了一副骨架 —— 与「不跳页、不做独立搜索结果页」（PRD §4）一致。
//
// 本层不认识「数据从哪来」：只吃条目数组（§12.5）。

import { 建行, 建结果项 } from './card.js';

/**
 * 画检索结果列表。容器内容会被整体替换。
 * @param {HTMLElement} 容器
 * @param {object[]} 条目 命中条目（跨部，按相关度已排好序）
 * @returns {number} 实际画出的条数
 */
export function renderResults(容器, 条目) {
  const 列表 = 条目 || [];
  容器.textContent = '';

  if (!列表.length) {
    容器.append(建行('grid-empty', '没有命中的条目。'));
    return 0;
  }

  const 排 = document.createElement('ol');
  排.className = 'result-list';
  列表.forEach(条 => 排.append(建结果项(条)));
  容器.append(排);

  return 列表.length;
}
