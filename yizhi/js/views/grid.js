// 异兽志 · 视图层「图鉴网格」（V2 横排极简卡，09-21 拍板「选 C」）
// 契约（TECH_DESIGN §6.2）：renderGrid(容器, 条目[], 筛选态)
//
// 本层不认识「数据从哪来」：只吃条目数组，不 import data.js（TECH_DESIGN §12.5）。
// 也不接收图源：图源属渲染细节，按 §4.4.4 在本文件内判定，调用方只给数据。

/* —— 图源（TECH_DESIGN §4.4.4，Day 7 补上 localhost 一档） ——
     file:// 或 http://localhost  → assets-private/   本地私有图（观山海原图），永不入库
     https://                     → assets/           公开图，上线用
     ?图源=public / ?图源=private → 强制覆盖，用于在本地预览另一套
   私有图没放时由 建图() 自动回退公开图，所以本地也能正常看到卡面。 */
const 公开图目录 = 'assets/';
const 私有图目录 = 'assets-private/';

export const 图源 = (() => {
  const 覆盖 = new URLSearchParams(location.search).get('图源');
  if (覆盖 === 'public') return 公开图目录;
  if (覆盖 === 'private') return 私有图目录;
  return location.protocol === 'https:' ? 公开图目录 : 私有图目录;
})();

/* —— 小工具 —— */
function 建行(类名, 文本) {
  const 节点 = document.createElement('p');
  节点.className = 类名;
  节点.textContent = 文本;   // 一律 textContent，条目内容不进 innerHTML
  return 节点;
}

function 建空框() {
  const 框 = document.createElement('div');
  框.className = 'portrait-empty';
  return 框;
}

/* 图缺失的兜底：先试选定图源，私有图 404 就回退公开图，都 404 才给安静空框（不出破图标）
   注意：回退必须逐图判断，不能设全局开关 —— 私有图目录是陆续补的，
   某些条目有私有图、某些没有，全局开关会把有图的那些也错发到公开图。 */
function 建图(条) {
  if (!条.图) return 建空框();

  const 图 = document.createElement('img');
  图.className = 'portrait';
  图.alt = 条.名;
  图.src = 图源 + 条.图 + '.webp';

  图.addEventListener('error', () => {
    if (图源 === 私有图目录 && !图.dataset.已回退) {
      图.dataset.已回退 = '1';
      图.src = 公开图目录 + 条.图 + '.webp';
      return;
    }
    图.replaceWith(建空框());
  });

  return 图;
}

/* —— 卡片 —— */
function 建卡片(条) {
  const 卡 = document.createElement('article');
  卡.className = 'card';

  const 印章 = document.createElement('span');
  印章.className = 'seal';
  印章.textContent = 条.吉凶 || '未分类';
  卡.append(印章);

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
    列表.forEach(条 => 容器.append(建卡片(条)));
  }

  return 列表.length;
}
