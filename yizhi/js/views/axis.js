// 异兽志 · 视图层「境界竖轴」（V2 · 境界部）
// 契约（TECH_DESIGN §6.2）：renderAxis(容器, 条目[], 序列)
//
// 这一屏是全站最值得做的一屏（PRD §4「E 部的杀手细节」）：
//   炼气→渡劫 是**线性升级链**（每阶必走，是进度条）；
//   鬼仙→天仙 是**丹道五等仙品**（品第高低，可停可越，不是进度条）。
// 两套序列长得像，含义完全不同 —— 所以视觉上必须一眼分得开：
//   网文序：阶号用阿拉伯数字 1..9，阶章是墨色空圈 —— 像进度条上的刻度。
//   真丹道序：阶号用「一等..五等」汉字，阶章是朱砂实印 —— 像名次榜上的品第。
// 同一根轴、同一套排版，只换这两处，读者不必读说明就分得出这是两种东西。
//
// 本层不认识「数据从哪来」：只吃条目数组与一个序列名，不 import data.js（§12.5）。
// 序列开关（哪个序列被选中）属装配层 —— 与吉凶筛选条同理，本层只认第三个参数。

import { 建行 } from './card.js';

/* —— 小工具 —— */

/* 真丹道的阶号读作「一等..五等」：品第用汉字，进度用阿拉伯数字，这是刻意的区分 */
const 汉字 = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
function 阶号字样(条, 序列) {
  if (序列 === '真丹道') return (汉字[条.阶号 - 1] || 条.阶号) + '等';
  return String(条.阶号);
}

/* —— 一根轴行 ——
   整行可点（点开详情）。可点的东西就得键盘够得着 → role / tabindex 由装配层的委托监听接。
   data-id 是「点了打开哪一条」的唯一凭据，装配层靠它反查条目。 */
function 建轴行(条, 序列, 末位) {
  const 行 = document.createElement('li');
  行.className = 'axis-node' + (末位 ? ' is-last' : '');
  行.dataset.id = 条.id;
  行.setAttribute('role', 'button');
  行.setAttribute('tabindex', '0');
  行.setAttribute('aria-label', `打开「${条.名}」的详情`);

  const 章 = document.createElement('span');
  章.className = 'axis-rank';
  章.textContent = 阶号字样(条, 序列);

  const 身 = document.createElement('div');
  身.className = 'axis-body';

  const 名 = document.createElement('h3');
  名.className = 'axis-name';
  名.textContent = 条.名;
  身.append(名);

  if (条.别名 && 条.别名.length) 身.append(建行('axis-alias', 条.别名.join(' · ')));

  /* 原文：网文序列那一条本来就是白话（原文性质 = 当代网文通行设定），
     这里照样当引文排；真丹道是古文，另有译文在详情里，不在轴上展开。 */
  身.append(建行('axis-quote', 条.原文));

  const 脚 = document.createElement('p');
  脚.className = 'axis-src';
  脚.textContent = 条.出处;
  身.append(脚);

  行.append(章, 身);
  return 行;
}

/**
 * 画境界竖轴。只画当前序列的那几条 —— 两套序列绝不混排。
 * @param {HTMLElement} 容器
 * @param {object[]} 条目 数据层给的条目数组（已过校验，可含两套序列）
 * @param {string} 序列 '网文' | '真丹道'
 * @returns {number} 实际画出的阶数
 */
export function renderAxis(容器, 条目, 序列) {
  const 列表 = (条目 || [])
    .filter(条 => !序列 || 条.序列 === 序列)
    .sort((甲, 乙) => (甲.阶号 || 0) - (乙.阶号 || 0));

  容器.textContent = '';

  if (!列表.length) {
    容器.append(建行('grid-empty', '这套序列暂时没有内容。'));
    return 0;
  }

  const 轴 = document.createElement('div');
  轴.className = 'axis';
  轴.dataset.序列 = 序列 || '';

  const 排 = document.createElement('ol');
  排.className = 'axis-list';
  列表.forEach((条, 序) => 排.append(建轴行(条, 序列, 序 === 列表.length - 1)));

  轴.append(排);
  容器.append(轴);

  return 列表.length;
}
