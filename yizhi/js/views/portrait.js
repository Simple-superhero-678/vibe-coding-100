// 异兽志 · 视图层「画心」（图 + 图源判定）
// 契约：不属于 TECH_DESIGN §6.2 列出的公开函数 —— 它是视图层的内部公共件。
//
// 为什么单独抽出来：网格与详情面板都要出图，两处各写一份「图源怎么判、图 404 怎么退」
// 迟早会走岔（比如只在一处补了 localhost 一档）。图源属渲染细节，按 §4.4.4 留在视图层内，
// 但只留一份。
//
// 本层不认识「数据从哪来」：只吃条目，不 import data.js（TECH_DESIGN §12.5）。

/* —— 图源（TECH_DESIGN §4.4.4，Day 7 补上 localhost 一档） ——
     file:// 或 http://localhost  → assets-private/   本地私有图（观山海原图），永不入库
     https://                     → assets/           公开图，上线用
     ?图源=public / ?图源=private → 强制覆盖，用于在本地预览另一套
   私有图没放时由 建图() 自动回退公开图，所以本地也能正常看到卡面。 */
export const 公开图目录 = 'assets/';
export const 私有图目录 = 'assets-private/';

export const 图源 = (() => {
  const 覆盖 = new URLSearchParams(location.search).get('图源');
  if (覆盖 === 'public') return 公开图目录;
  if (覆盖 === 'private') return 私有图目录;
  return location.protocol === 'https:' ? 公开图目录 : 私有图目录;
})();

export function 建空框() {
  const 框 = document.createElement('div');
  框.className = 'portrait-empty';
  return 框;
}

/* 图缺失的兜底：先试选定图源，私有图 404 就回退公开图，都 404 才给安静空框（不出破图标）
   注意：回退必须逐图判断，不能设全局开关 —— 私有图目录是陆续补的，
   某些条目有私有图、某些没有，全局开关会把有图的那些也错发到公开图。 */
export function 建图(条) {
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
