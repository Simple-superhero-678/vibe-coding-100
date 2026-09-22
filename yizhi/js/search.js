// 异兽志 · 检索层
// 契约（TECH_DESIGN §6.2）：
//   buildIndex(条目[]) → Index                  把 名 / 别名 / 关键词 建成倒排索引
//   query(索引, 输入)  → {直接命中[], 相近[]}   直接命中按权重：名 > 别名 > 关键词
//
// 本层不认识 DOM，也不认识「数据从哪来」：只吃条目数组，只吐条目数组。
// 零结果必须给「相近」（TECH_DESIGN §9-9 / PRD 9.2：零结果不给死胡同）。
//
// 为什么不引第三方检索库：一个部 12 条、全站几十条，中文也不需要词干化。
// 几十条的规模上，倒排 + 线性打分的可控性远高于装一个 fuse.js —— 纯静态、零依赖是硬约束（§2）。

/* —— 权重：只是分档，不参与界面展示 —— */
const 分_名完全 = 1200;
const 分_名包含 = 1000;
const 分_别名完全 = 900;
const 分_别名包含 = 700;
const 分_词完全 = 500;
const 分_词包含 = 400;

const 直接命中线 = 400;   // ≥ 此行算「直接命中」；低于它只做「相近」候选
const 相近上限 = 5;       // 零结果时最多给几条提示，多了反而是负担

/* —— 归一化 ——
   全角转半角（防手滑打了全角空格 / 全角字母）、去首尾空白、英文转小写。
   刻意不做繁简转换：古字（爰、兕、夔）被当异体字换掉会误伤条目本身。 */
function 归一(文本) {
  return String(文本 == null ? '' : 文本)
    .replace(/[\uFF01-\uFF5E]/g, 字 => String.fromCharCode(字.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .trim()
    .toLowerCase();
}

/* 二字组：中文没有天然词边界，2-gram 既当倒排的键，也当「像不像」的度量 */
function 二字组(文本) {
  const 组 = new Set();
  for (let i = 0; i + 2 <= 文本.length; i++) 组.add(文本.slice(i, i + 2));
  return 组;
}

/* 一条条目参与检索的全部字面（顺序即权重顺序） */
function 词表(项) {
  return [项.名, ...项.别名, ...项.关键词];
}

/**
 * 建索引。调用方在数据加载完成后调一次即可（§6.3 的调用串法：loadBu → buildIndex → query）。
 * @param {object[]} 条目列表
 * @returns {{项: Array, 倒排: Map<string, Set<number>>}}
 */
export function buildIndex(条目列表) {
  const 项 = (条目列表 || []).map(条 => ({
    条,
    名: 归一(条 && 条.名),
    别名: (Array.isArray(条 && 条.别名) ? 条.别名 : []).map(归一).filter(Boolean),
    关键词: (Array.isArray(条 && 条.关键词) ? 条.关键词 : []).map(归一).filter(Boolean),
  }));

  /* 倒排：二字组 → 条目下标集合。作用是把候选从「全部」缩到「可能相关」 */
  const 倒排 = new Map();
  项.forEach((t, 序) => {
    const 组 = new Set();
    词表(t).forEach(词 => 二字组(词).forEach(g => 组.add(g)));
    组.forEach(g => {
      if (!倒排.has(g)) 倒排.set(g, new Set());
      倒排.get(g).add(序);
    });
  });

  return { 项, 倒排 };
}

/* 相似度：没命中任何字面时，退到二字组重合比例（0–100），只用于排「相近」 */
function 相似分(t, q) {
  const 词们 = 词表(t);

  /* 单字输入算不出二字组：退到「有没有这个字」 */
  if (q.length < 2) return 词们.some(词 => 词.includes(q)) ? 30 : 0;

  const q组 = 二字组(q);
  let 最像 = 0;
  词们.forEach(词 => {
    const 词组 = 二字组(词);
    let 共 = 0;
    q组.forEach(g => { if (词组.has(g)) 共++; });
    最像 = Math.max(最像, 共 / q组.size);
  });
  return Math.round(最像 * 100);
}

/* 单条打分：先看字面命中（最高档胜出），都不中才退到相似度 */
function 打分(t, q) {
  if (t.名 === q) return 分_名完全;
  if (t.名.includes(q)) return 分_名包含 + q.length;

  let 分 = 0;
  for (const 别 of t.别名) {
    if (别 === q) { 分 = Math.max(分, 分_别名完全); break; }
    if (别.includes(q)) 分 = Math.max(分, 分_别名包含 + q.length);
  }
  for (const 词 of t.关键词) {
    if (词 === q) { 分 = Math.max(分, 分_词完全); break; }
    if (词.includes(q)) 分 = Math.max(分, 分_词包含 + q.length);
  }

  return 分 || 相似分(t, q);
}

/**
 * 查询。
 * @param {object} 索引 buildIndex 的返回
 * @param {string} 输入 用户的原始输入（可为空、可带空格全角，本层自己归一）
 * @returns {{直接命中: object[], 相近: object[]}} 元素是原样的条目对象，按相关度降序
 */
export function query(索引, 输入) {
  const q = 归一(输入);
  const 全部 = (索引 && Array.isArray(索引.项)) ? 索引.项 : [];

  /* 空输入 = 不过滤。调用方通常自己会先判空，但契约上要定义清楚，不留 undefined 行为 */
  if (!q) return { 直接命中: 全部.map(t => t.条), 相近: [] };

  /* 候选集：与输入共享过二字组的条目。
     单字输入（算不出二字组）或一个组都不共享时退到全量 —— 几十条，成本可忽略，且不会漏。 */
  let 候选;
  if (q.length < 2) {
    候选 = 全部.map((_, i) => i);
  } else {
    const 集 = new Set();
    二字组(q).forEach(g => {
      const 命中项 = 索引.倒排.get(g);
      if (命中项) 命中项.forEach(i => 集.add(i));
    });
    候选 = 集.size ? [...集] : 全部.map((_, i) => i);
  }

  const 有分 = 候选
    .map(i => ({ 项: 全部[i], 分: 打分(全部[i], q) }))
    .filter(x => x.分 > 0)
    /* 同分按 id 排：保证每次查询顺序一致（不然相邻两次渲染卡片会跳位） */
    .sort((a, b) => b.分 - a.分 || String(a.项.条.id).localeCompare(String(b.项.条.id)));

  return {
    直接命中: 有分.filter(x => x.分 >= 直接命中线).map(x => x.项.条),
    相近: 有分.filter(x => x.分 < 直接命中线).slice(0, 相近上限).map(x => x.项.条),
  };
}
