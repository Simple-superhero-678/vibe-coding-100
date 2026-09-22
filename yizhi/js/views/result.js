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

/* —— 小工具 —— */
function 建行(类名, 文本) {
  const 节点 = document.createElement('p');
  节点.className = 类名;
  节点.textContent = 文本;   // 一律 textContent，条目内容不进 innerHTML
  return 节点;
}

function 建结果(条) {
  const 项 = document.createElement('li');
  项.className = 'result-item';
  项.dataset.id = 条.id;
  项.setAttribute('role', 'button');
  项.setAttribute('tabindex', '0');
  项.setAttribute('aria-label', `打开「${条.名}」的详情（${条.部}部）`);

  /* 部角标：跨部结果里，这一枚是「这条从哪来」的唯一凭据 */
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
  列表.forEach(条 => 排.append(建结果(条)));
  容器.append(排);

  return 列表.length;
}
