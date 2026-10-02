// 异兽志 · 数据层
// 职责：读 data/*.json → 校验 → 交给上层。
// 分层目的（TECH_DESIGN §12.5）：视图层不认识「数据从哪来」。将来换数据源（后端 API）只改这个文件。
//
// 契约（TECH_DESIGN §6.2）：
//   loadBu(部名)    → Promise<条目[]>      读 data/{前缀}.json；失败抛 {code, 部名, 原因}
//   loadAll()       → Promise<条目[]>      五部合并（仅检索需要全量时才调）
//   校验条目(条目)   → {通过, 缺项}
//
// M6 补记（09-22）：境界部需要读 JSON **顶层**的 `序列`（两套序列的副题与说明，
// 那是内容不是渲染细节，必须留在 JSON 里而不是写进 JS）。所以把「读整包」抽成 读包()，
// loadBu 改为它的薄封装 —— 契约里 loadBu 的签名与返回值一字未动，老调用方不受影响。

/* —— 配置：路径的唯一来源，都是公开常量，不是环境变量（TECH_DESIGN §10.1） —— */
const 数据目录 = 'data/';
const 部文件 = { 神仙: 'shenxian', 神话: 'shenhua', 异兽: 'yishou', 妖怪: 'yaoguai', 境界: 'jingjie' };

/* ══════════════════════════════════════════════════════════════════════
   本机调试开关：?态=慢 | 错 | 空（Day 13）
   ══════════════════════════════════════════════════════════════════════
   为什么要有它：本地读一份 JSON 只要十几毫秒，「加载中」一眨眼就过去，肉眼根本
   截不到；而「错误」原本得把 data/*.json 改名才造得出 —— 拍完还得记得改回来，
   忘了就是线上白屏。今天要给四种状态各截一屏图当验收证据，靠手工折腾不可复现，
   所以做成一个开关：地址后面挂 ?态=慢 / ?态=错 / ?态=空。

   为什么放在数据层而不是界面层：慢、坏、没内容说的是**数据源的行为**，
   不是界面的事。将来真接上后端 API，这三种也由后端造（延时、500、空结果），
   这一层原样留着即可（TECH_DESIGN §12.5：换数据源只改这个文件）。

   ⚠️ 只在**本机**生效。线上（GitHub Pages）这个参数被完全忽略 ——
      调试开关不该让访问者能把站点按成坏掉的样子。
   ⚠️ 它挂在 `?` 上（?态=错#/部/异兽），所以不碰 `#` 里的路由，
      也和早就存在的 ?图源=public 井水不犯河水。
*/
const 本机主机 = ['127.0.0.1', 'localhost', '[::1]', ''];
const 认识的态 = ['慢', '错', '空'];

/** @returns {''|'慢'|'错'|'空'} 只有本机、且值认识时才给态，其余一律空串（= 正常） */
export function 调试态() {
  if (!本机主机.includes(location.hostname)) return '';
  const 值 = new URLSearchParams(location.search || '').get('态');
  return 认识的态.includes(值) ? 值 : '';
}

/* 慢态用：把「读文件」这件事拉长到肉眼看得到的长度，好让骨架有机会被看见 */
const 慢态毫秒 = 2000;
function 睡(毫秒) {
  return new Promise(完成 => setTimeout(完成, 毫秒));
}

/* —— 枚举：与 PRD §6 / TECH_DESIGN §5.2 对齐。写代码按这几张表校验 ——
   吉凶枚举要导出：筛选条的按钮就是从这张表生成的（第 6 步）。
   枚举只留这一个真源 —— 校验、筛选条、将来其它地方都读它，不各写一份。 */
const 部枚举 = ['神仙', '神话', '异兽', '妖怪', '境界'];
export const 吉凶枚举 = ['吉祥', '凶恶', '灾祸', '无害'];

/* —— id 前缀表（TECH_DESIGN §5.3）：收藏存的是 id，而收藏夹要在**全站**捞条目，
     所以「这个 id 属于哪一部」必须能算出来 —— 否则刷新后打开收藏夹，
     只能拿当前已加载的那一部去对，其余全被误判成「已下架」。 —— */
export const 前缀表 = { 神仙: 'shenxian', 神话: 'shenhua', 异兽: 'yishou', 妖怪: 'yaoguai', 境界: 'jingjie' };

/** 由 id 反查它属于哪一部（认不出来时返回 null，调用方按「已下架」处理） */
export function 部ofId(id) {
  const 首 = String(id || '').split('-')[0];
  return 部枚举.find(名 => 前缀表[名] === 首) || null;
}

/* `别名` 必填但允许空数组；`吉凶` 只对 A–D 部必填（E 部境界无此字段） */
const 必填字段 = ['id', '部', '名', '原文', '出处', '写小说怎么用'];

/**
 * 校验单条。缺必填项即不通过 —— 这是「内容全面」的第一道闸（PRD 9.2 ③）。
 * @returns {{通过: boolean, 缺项: string[]}}
 */
export function 校验条目(条) {
  if (!条 || typeof 条 !== 'object') return { 通过: false, 缺项: ['整条'] };

  const 缺项 = 必填字段.filter(键 => !条[键] || String(条[键]).trim() === '');
  if (!Array.isArray(条.别名)) 缺项.push('别名');
  if (条.部 !== '境界' && !条.吉凶) 缺项.push('吉凶');

  return { 通过: 缺项.length === 0, 缺项 };
}

/**
 * 读一部的**整包**（含 schema / 部 / 更新 / 部专属顶层字段，如境界部的 `序列`）。
 * loadBu 是它的薄封装 —— 顶层字段只有需要它的那一部才用得上。
 * @param {string} 部名 '神仙' | '神话' | '异兽' | '妖怪' | '境界'
 * @returns {Promise<{schema:number, 部:string, 更新:string, 条目:object[]}>} 条目已过校验
 */
export async function 读包(部名) {
  const 文件 = 部文件[部名];
  if (!文件) {
    console.error('[data] 未知部名：', 部名);
    throw { code: 'BAD_BU', 部名, 原因: `未知的部名「${部名}」` };
  }

  const 地址 = 数据目录 + 文件 + '.json';
  const 模拟 = 调试态();

  /* 调试态「慢」：故意迟到 2 秒。放在取文件**之前** —— 要演的是「正在读」，
     卡在真 fetch 后面就变成「读完了还在装」，那和真实加载不是一回事。 */
  if (模拟 === '慢') await 睡(慢态毫秒);

  /* 调试态「错」：连文件都不去取，直接按「读不到」处理。失败的样子与真实
     LOAD_FAIL 完全一致 —— 上层（装配层）不用为它写任何分支。 */
  if (模拟 === '错') {
    console.warn('[data] 调试态「错」：不读文件，直接当读取失败抛给上层');
    throw { code: 'LOAD_FAIL', 部名, 文件: 地址, 原因: '调试开关：模拟读取失败' };
  }

  /* ① 取文件 */
  let 应答;
  try {
    应答 = await fetch(地址);
    if (!应答.ok) throw new Error(`HTTP ${应答.status}`);
  } catch (因) {
    console.error('[data] 读不到数据文件：', 地址, 因);
    throw { code: 'LOAD_FAIL', 部名, 文件: 地址, 原因: String((因 && 因.message) || 因) };
  }

  /* ② 解 JSON */
  let 包;
  try {
    包 = await 应答.json();
  } catch (因) {
    console.error('[data] JSON 解析失败：', 地址, 因);
    throw { code: 'PARSE_FAIL', 部名, 文件: 地址, 原因: String((因 && 因.message) || 因) };
  }

  /* ③ 文件级交叉校验：防止文件放错部（TECH_DESIGN §5.1）。只警告，不拦 */
  if (包.部 && 包.部 !== 部名) console.warn('[data] 文件里的「部」与文件名不符：', 地址, '写的是', 包.部);
  if (包.schema !== 1) console.warn('[data] schema 版本不是 1：', 地址, 包.schema);

  /* ④ 逐条校验：不合规的不进列表，控制台说清哪条缺哪项（TECH_DESIGN §9-3） */
  const 原条目 = Array.isArray(包.条目) ? 包.条目 : [];
  const 可用 = [];

  原条目.forEach((条, 序) => {
    const 结果 = 校验条目(条);
    if (!结果.通过) {
      console.error('[data] 第 %d 条不合规，已跳过。缺：%s', 序 + 1, 结果.缺项.join(' / '), 条);
      return;
    }
    if (条.部 !== '境界' && !吉凶枚举.includes(条.吉凶)) {
      console.warn('[data] %s 的吉凶值「%s」不在四值枚举内，按未分类处理（不参与筛选）', 条.id, 条.吉凶);
    }
    可用.push(条);
  });

  /* 调试态「空」：文件读到了、也没有坏条目，只是这个部一条内容都没有。
     放在校验**之后**：要演的是「数据源正常但没内容」，不是「数据坏了」。 */
  const 交付 = 模拟 === '空' ? [] : 可用;

  /* 顶层字段原样带出来，但把 条目 换成已校验的那一份 —— 调用方不会拿到没校验的数据 */
  return { ...包, 条目: 交付 };
}

/**
 * 读一部，只要条目数组。
 * @param {string} 部名 '神仙' | '神话' | '异兽' | '妖怪' | '境界'
 */
export async function loadBu(部名) {
  return (await 读包(部名)).条目;
}

/**
 * 五部全量。某部读失败不连坐其他部，只在控制台记一笔（TECH_DESIGN §9-1 的精神）。
 */
export async function loadAll() {
  const 结果 = await Promise.allSettled(部枚举.map(名 => loadBu(名)));
  const 全部 = [];

  结果.forEach((项, 序) => {
    if (项.status === 'fulfilled') 全部.push(...项.value);
    else console.warn('[data] loadAll 跳过一部：', 部枚举[序], 项.reason);
  });

  return 全部;
}
