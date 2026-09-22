// 异兽志 · 视图层「神话时间轴」（V2 · 神话部）
// 契约（TECH_DESIGN §6.2）：renderTimeline(容器, 条目[])
//
// 形状按 PRD §5 F2 定：六大类型分段（创世 / 始祖 / 洪水 / 战争 / 发明 / 斗争），
// 段内条目按 `序` 排出先后（PRD 8.2：时间轴按六大类型分段，能看出先后顺序）。
//
// ⚠️ 「能看出先后」有一个诚实的限度：六大类型之间**不是严格先后**（洪水与战争谁先谁后，
//    各家神话给的次序不一样），所以这里只保证「段内有序」，段与段的排列按 PRD 给的分类法次序，
//    不画一根代表绝对年代的横轴 —— 画了就是在编造一个学界没有共识的时间线。
//
// 本层不认识「数据从哪来」：只吃条目数组（§12.5）。类型次序是分类法，写在代码里；
// 谁属于哪一类、排第几，一律来自 JSON。

/* —— 小工具 —— */
function 建行(类名, 文本) {
  const 节点 = document.createElement('p');
  节点.className = 类名;
  节点.textContent = 文本;   // 一律 textContent，条目内容不进 innerHTML
  return 节点;
}

/* 六类型的次序（PRD §5 F2 的固定分类法）。段内的先后由数据里的 `序` 决定。 */
const 类型序 = ['创世', '始祖', '洪水', '战争', '发明', '斗争'];
/* 段的序号用汉字：与境界部阶章「一等」同一套读法，一眼看出这是「第几段」而非「第几年」 */
const 汉字 = ['一', '二', '三', '四', '五', '六', '七', '八'];

function 按序排(值们, 序) {
  return [...值们].sort((甲, 乙) => {
    const 甲位 = 序.indexOf(甲), 乙位 = 序.indexOf(乙);
    return (甲位 < 0 ? 序.length : 甲位) - (乙位 < 0 ? 序.length : 乙位);
  });
}

/* —— 一节点（一则神话）——
   整行可点开详情：data-id 在行上，装配层靠它反查条目。
   段内序号（第 n 则）写进 DOM —— PRD 8.2 要「能看出先后顺序」，
   而「先后」在这张图上由两件事表达：竖向排列 + 这个明确的序号。 */
function 建节点(条, 序, 末位) {
  const 节 = document.createElement('li');
  节.className = 'tl-item' + (末位 ? ' is-last' : '');
  节.dataset.id = 条.id;
  节.setAttribute('role', 'button');
  节.setAttribute('tabindex', '0');
  节.setAttribute('aria-label', `打开「${条.名}」的详情`);

  /* 轴上的刻度点：竖轴的偏移量写在 CSS 里，这里只给一个点 */
  const 点 = document.createElement('span');
  点.className = 'tl-dot';
  节.append(点);

  const 身 = document.createElement('div');
  身.className = 'tl-body';

  const 名 = document.createElement('h4');
  名.className = 'tl-name';

  const 号 = document.createElement('span');
  号.className = 'tl-n';
  号.textContent = String(序 + 1);

  名.append(号, document.createTextNode(条.名));
  身.append(名);

  if (条.别名 && 条.别名.length) 身.append(建行('tl-alias', 条.别名.join(' · ')));
  身.append(建行('tl-quote', 条.原文));
  身.append(建行('tl-src', 条.出处));

  节.append(身);
  return 节;
}

/**
 * 画时间轴。容器内容会被整体替换。
 * @param {HTMLElement} 容器
 * @param {object[]} 条目 数据层给的条目数组（已过校验）
 * @returns {number} 实际画出的条目数
 */
export function renderTimeline(容器, 条目) {
  const 列表 = 条目 || [];
  容器.textContent = '';

  if (!列表.length) {
    容器.append(建行('grid-empty', '这一部暂时没有条目。'));
    return 0;
  }

  const 轴 = document.createElement('div');
  轴.className = 'timeline';

  const 出现型 = 按序排(new Set(列表.map(条 => 条.类型).filter(Boolean)), 类型序);

  出现型.forEach((型, 位) => {
    const 段 = document.createElement('section');
    段.className = 'tl-era';

    const 头 = document.createElement('h3');
    头.className = 'tl-era-head';

    const 号 = document.createElement('span');
    号.className = 'tl-era-n';
    号.textContent = 汉字[位] || String(位 + 1);
    号.setAttribute('aria-hidden', 'true');   // 装饰性的段号，读屏读标题就够了

    const 题 = document.createElement('span');
    题.className = 'tl-era-name';
    题.textContent = 型;

    头.append(号, 题);
    段.append(头);

    const 排 = document.createElement('ol');
    排.className = 'tl-items';

    const 本段 = 列表.filter(条 => 条.类型 === 型)
      .sort((甲, 乙) => (甲.序 || 0) - (乙.序 || 0));   // 段内按 `序` 定先后

    本段.forEach((条, 序) => 排.append(建节点(条, 序, 序 === 本段.length - 1)));

    段.append(排);
    轴.append(段);
  });

  容器.append(轴);
  return 列表.length;
}
