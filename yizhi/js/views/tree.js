// 异兽志 · 视图层「神仙谱系树」（V2 · 神仙部）
// 契约（TECH_DESIGN §6.2）：renderTree(容器, 条目[])
//
// 形状按 PRD §5 F2 定：三清 → 四御 → 职能部（雷 / 斗 / 兵 / 冥 / 山水）。
// ⚠️ **只做两级**（PRD §5 边界：谱系树与时间轴第一期只做两级，不做无限嵌套）：
//     第一级 = 三清 / 四御 / 职能部
//     第二级 = 职能部下的五个司
//   所以这里是「三个层段」，不是一个可无限展开的递归树 —— 别顺手写成递归。
//
// 本层不认识「数据从哪来」：只吃条目数组，不 import data.js（§12.5）。
// 层序与司序这两张表是 PRD 定死的分类法（与 data.js 里的吉凶枚举同性质），
// 写在代码里是它该在的地方 —— 内容（谁是哪一层、归哪个司）一律来自 JSON。

import { 建行 } from './card.js';

/* —— 小工具 —— */

/* 层与司的顺序：分类法，不是内容 */
const 层序 = ['三清', '四御', '职能部'];
const 司序 = ['雷', '斗', '兵', '冥', '山水'];
const 司名 = { 雷: '雷部', 斗: '斗部', 兵: '兵部', 冥: '冥部', 山水: '山水部' };

/* 按给定顺序排：不在表里的排到最后（数据里冒出没登记的值时，宁可排在末尾也不要静默丢） */
function 按序排(值们, 序) {
  return [...值们].sort((甲, 乙) => {
    const 甲位 = 序.indexOf(甲), 乙位 = 序.indexOf(乙);
    return (甲位 < 0 ? 序.length : 甲位) - (乙位 < 0 ? 序.length : 乙位);
  });
}

/* —— 一片叶子（一个神）——
   整行可点开详情：data-id 在行上，装配层靠它反查条目。 */
function 建叶(条) {
  const 叶 = document.createElement('li');
  叶.className = 'tree-leaf';
  叶.dataset.id = 条.id;
  叶.setAttribute('role', 'button');
  叶.setAttribute('tabindex', '0');
  叶.setAttribute('aria-label', `打开「${条.名}」的详情`);

  const 名 = document.createElement('h4');
  名.className = 'tree-name';
  名.textContent = 条.名;
  叶.append(名);

  if (条.别名 && 条.别名.length) 叶.append(建行('tree-alias', 条.别名.join(' · ')));
  叶.append(建行('tree-src', 条.出处));

  return 叶;
}

function 建叶列(列表) {
  const 排 = document.createElement('ul');
  排.className = 'tree-leaves';
  列表.forEach(条 => 排.append(建叶(条)));
  return 排;
}

/**
 * 画谱系树。容器内容会被整体替换。
 * @param {HTMLElement} 容器
 * @param {object[]} 条目 数据层给的条目数组（已过校验）
 * @returns {number} 实际画出的神数
 */
export function renderTree(容器, 条目) {
  const 列表 = 条目 || [];
  容器.textContent = '';

  if (!列表.length) {
    容器.append(建行('grid-empty', '这一部暂时没有条目。'));
    return 0;
  }

  const 树 = document.createElement('div');
  树.className = 'tree';

  /* 层段按数据里真实出现的 `谱系` 值来建，不凭空造空层 ——
     某层一条都没有时不该在页面上留一个空标题。 */
  const 出现层 = 按序排(new Set(列表.map(条 => 条.谱系).filter(Boolean)), 层序);

  出现层.forEach(层 => {
    const 段 = document.createElement('section');
    段.className = 'tree-tier';

    const 头 = document.createElement('h3');
    头.className = 'tree-tier-head';
    头.textContent = 层;
    段.append(头);

    const 本层 = 列表.filter(条 => 条.谱系 === 层);

    if (层 === '职能部') {
      /* 第二级：按司分班。司名是分类法的读法（雷 → 雷部），不是条目内容 */
      const 出现司 = 按序排(new Set(本层.map(条 => 条.司).filter(Boolean)), 司序);
      const 班列 = document.createElement('div');
      班列.className = 'tree-sects';

      出现司.forEach(司 => {
        const 班 = document.createElement('div');
        班.className = 'tree-sect';

        const 班头 = document.createElement('h4');
        班头.className = 'tree-sect-head';
        班头.textContent = 司名[司] || (司 + '部');

        const 本班 = 本层.filter(条 => 条.司 === 司)
          .sort((甲, 乙) => (甲.座次 || 0) - (乙.座次 || 0));

        班.append(班头, 建叶列(本班));
        班列.append(班);
      });

      段.append(班列);
    } else {
      段.append(建叶列(本层.sort((甲, 乙) => (甲.座次 || 0) - (乙.座次 || 0))));
    }

    树.append(段);
  });

  容器.append(树);
  return 列表.length;
}
