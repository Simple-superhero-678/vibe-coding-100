// 异兽志 · 视图层「图鉴网格」（V2 横排极简卡，09-21 拍板「选 C」）
// 契约（TECH_DESIGN §6.2）：renderGrid(容器, 条目[], 筛选态)
//
// 本层不认识「数据从哪来」：只吃条目数组，不 import data.js（TECH_DESIGN §12.5）。
// 也不接收图源：图源属渲染细节，按 §4.4.4 在视图层内判定，调用方只给数据 ——
// 但判定与出图的那几行挪到了 views/portrait.js，详情面板要共用同一份（M4）。

import { 图源 } from './portrait.js';
import { 建行, 建图鉴卡 } from './card.js';

/* 图源继续从这里转出去：main.js 一直在 import 它做启动日志，不因为搬家改调用方。 */
export { 图源 };

/* —— 筛选（契约第三个参数） ——
   筛选态 = null | undefined | { 吉凶?: string | string[] }     空值或缺项 = 不过滤该项
   本层只认这个谓词，不认识筛选条的按钮、选中态、清除出口 —— 那些在 main.js（第 6 步起）。
   「未分类」条目（吉凶值不在四值枚举内）天然不匹配任何选中值，
   于是「只在无筛选时出现」（TECH_DESIGN §9-6），不用额外分支。 */
function 通过筛选(条, 筛选态) {
  if (!筛选态 || !筛选态.吉凶) return true;
  const 要 = Array.isArray(筛选态.吉凶) ? 筛选态.吉凶 : [筛选态.吉凶];
  return 要.includes(条.吉凶);
}

/**
 * 画网格。容器内容会被整体替换。
 * @param {HTMLElement} 容器
 * @param {object[]} 条目 数据层给的条目数组（已过校验）
 * @param {object|null} 筛选态 见上
 * @returns {number} 实际画出的卡片数（调用方拿去写「N 条」）
 */
export function renderGrid(容器, 条目, 筛选态) {
  const 列表 = (条目 || []).filter(条 => 通过筛选(条, 筛选态));

  容器.textContent = '';   // 先清空，再统一铺新内容，避免新旧混排

  if (!列表.length) {
    容器.append(建行('grid-empty', '暂时没有可显示的条目。'));
  } else {
    列表.forEach(条 => 容器.append(建图鉴卡(条)));
  }

  return 列表.length;
}
