// 异兽志 · 视图层「妖怪六类分组」（V2 · 妖怪部）
// 契约（TECH_DESIGN §6.2）：renderGroups(容器, 条目[])
//   M6 补记（09-22）：第三个参数 `附注` —— PRD §5 F2 要求妖怪部除六类分组外
//   还有「妖怪史分期年表」，六类也各有一句界定。两者都是**内容**，必须留在 JSON 顶层
//   （`形类释义` / `年表`）而不是写进 JS，所以由装配层从整包里取出来交给本层一起画：
//     renderGroups(容器, 条目[], { 形类释义, 年表 })
//
// 形状按 PRD §5 F2 定：六类形态分组（妖 / 魔 / 鬼 / 怪 / 精 / 灵）+ 分期年表。
//
// 本层不认识「数据从哪来」：只吃条目数组与附注（§12.5）。
// 六类的**次序**是分类法（与 data.js 里的吉凶枚举同性质），写在代码里；释义与年表来自 JSON。

/* —— 小工具 —— */
function 建行(类名, 文本) {
  const 节点 = document.createElement('p');
  节点.className = 类名;
  节点.textContent = 文本;   // 一律 textContent，条目内容不进 innerHTML
  return 节点;
}

/* 六类的次序（PRD §4 / §5 F2 的固定分类法） */
const 形类序 = ['妖', '魔', '鬼', '怪', '精', '灵'];

function 按序排(值们, 序) {
  return [...值们].sort((甲, 乙) => {
    const 甲位 = 序.indexOf(甲), 乙位 = 序.indexOf(乙);
    return (甲位 < 0 ? 序.length : 甲位) - (乙位 < 0 ? 序.length : 乙位);
  });
}

/* —— 一条（一只妖怪）——
   整行可点开详情：data-id 在行上，装配层靠它反查条目。 */
function 建条(条) {
  const 项 = document.createElement('li');
  项.className = 'grp-item';
  项.dataset.id = 条.id;
  项.setAttribute('role', 'button');
  项.setAttribute('tabindex', '0');
  项.setAttribute('aria-label', `打开「${条.名}」的详情`);

  const 名 = document.createElement('h4');
  名.className = 'grp-name';
  名.textContent = 条.名;
  项.append(名);

  if (条.别名 && 条.别名.length) 项.append(建行('grp-alias', 条.别名.join(' · ')));
  项.append(建行('grp-quote', 条.原文));
  项.append(建行('grp-src', 条.出处));

  return 项;
}

/* —— 妖怪史分期年表 ——
   四段（先秦 / 汉魏六朝 / 唐 / 明清）横向排开：它是「脉络」，不是条目，所以不进分组列表。
   没有年表数据时整块不出现，不留一个空标题。 */
function 建年表(年表) {
  if (!Array.isArray(年表) || !年表.length) return null;

  const 块 = document.createElement('section');
  块.className = 'grp-chronicle';

  const 头 = document.createElement('h3');
  头.className = 'grp-chronicle-head';
  头.textContent = '妖怪史分期';
  块.append(头);

  const 排 = document.createElement('ol');
  排.className = 'chr-items';

  年表.forEach(期 => {
    const 项 = document.createElement('li');
    项.className = 'chr-item';

    const 名 = document.createElement('h4');
    名.className = 'chr-name';
    名.textContent = 期.期;

    const 文 = document.createElement('p');
    文.className = 'chr-text';
    文.textContent = 期.说明;

    项.append(名, 文);
    if (期.出处) 项.append(建行('chr-src', 期.出处));
    排.append(项);
  });

  块.append(排);
  return 块;
}

/**
 * 画六类分组 + 分期年表。容器内容会被整体替换。
 * @param {HTMLElement} 容器
 * @param {object[]} 条目 数据层给的条目数组（已过校验）
 * @param {{形类释义?: object, 年表?: object[]}} [附注] JSON 顶层的 `形类释义` / `年表`（可缺）
 * @returns {number} 实际画出的条目数
 */
export function renderGroups(容器, 条目, 附注) {
  const 列表 = 条目 || [];
  const 类释 = (附注 && 附注.形类释义) || {};
  容器.textContent = '';

  if (!列表.length) {
    容器.append(建行('grid-empty', '这一部暂时没有条目。'));
    return 0;
  }

  const 包 = document.createElement('div');
  包.className = 'groups';

  const 出现类 = 按序排(new Set(列表.map(条 => 条.形类).filter(Boolean)), 形类序);

  出现类.forEach(类 => {
    const 组 = document.createElement('section');
    组.className = 'grp';

    const 头 = document.createElement('h3');
    头.className = 'grp-head';

    const 题 = document.createElement('span');
    题.className = 'grp-class';
    题.textContent = 类;

    头.append(题);
    /* 释义来自 JSON；没给就不画这半截，不留一句空话 */
    if (类释[类]) {
      const 释 = document.createElement('span');
      释.className = 'grp-gloss';
      释.textContent = 类释[类];
      头.append(释);
    }

    组.append(头);

    const 排 = document.createElement('ul');
    排.className = 'grp-list';

    const 本类 = 列表.filter(条 => 条.形类 === 类)
      .sort((甲, 乙) => (甲.座次 || 0) - (乙.座次 || 0));

    本类.forEach(条 => 排.append(建条(条)));

    组.append(排);
    包.append(组);
  });

  容器.append(包);

  const 表 = 建年表(附注 && 附注.年表);
  if (表) 容器.append(表);

  return 列表.length;
}
