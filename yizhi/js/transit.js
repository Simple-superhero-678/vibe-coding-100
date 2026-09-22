// 异兽志 · 转场层（F4 · 云中仙槎）
// 契约（TECH_DESIGN §6.2）：play({onDone}) → {中断()}
//
// 分镜照 `yizhi/云中仙槎转场方案.md`（09-19 定稿）：
//   ① 舟内 0–0.8s   宣纸底 + 上下两道船帮剪影，中间留白当窗，窗外云气缓移
//   ② 出舟 0.8–1.6s 船帮向外滑出，视野打开
//   ③ 飞掠 1.6–2.8s 三层剪影横移，由慢到快；朱砂的舟钉在画面中下部不动
//   ④ 停靠 2.8–3.3s 各层减速归零，朱砂的舟升起并放大成印
//   ⑤ 到站 3.3s+    交给 M4 详情面板
//
// 「速度就是动感」：位移造速度，不加光效、不引动画库（PRD F4 明确）。
// 三层用不同的 tile 宽 × 不同周期错位横移 —— 位移量恒等于自己的 tile 宽，
// 铺一层 repeat-x 的底纹就无缝，不需要复制两份图案去接缝。
//
// 三条硬要求（PRD 8.4）：
//   · 约 3 秒后落到详情      → 首播 3300ms
//   · 中途点击或滚动能立即到站 → document 捕获阶段挂 click/wheel/touchstart/keydown
//   · 减少动态时直接跳过      → prefers-reduced-motion 命中则根本不建这一层

const 首播毫秒 = 3300;
const 短版毫秒 = 620;      // 第一次之后只放短版，看第二遍时不该再等 3 秒
let 播过 = false;          // 会话内记忆，不落盘 —— 刷新过就该重新放完整的

function 减少动态() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/* 转场层的骨架是写死的：这里没有任何条目数据、没有用户输入，
   所以用 innerHTML 一次性铺出来；条目内容一律走 textContent（见 views/grid.js 的纪律）。 */
function 建场(短版) {
  const 场 = document.createElement('div');
  场.className = 'voyage' + (短版 ? ' is-short' : '');
  场.setAttribute('aria-hidden', 'true');   // 纯装饰，读屏跳过

   /* 近景 → 中景 → 远山 从下往上叠；云气单独一层漂在最外面；
      .cabin 是 ① 段的前景船帮（② 段出画）；.boat 是那枚不动的朱砂。 */
  场.innerHTML = `
    <span class="voy-layer voy-l1"></span>
    <span class="voy-layer voy-l2"></span>
    <span class="voy-layer voy-l3"></span>
    <span class="voy-cloud"></span>
    <span class="voy-cabin">
      <span class="hull hull-top"></span>
      <span class="hull hull-bottom"></span>
    </span>
    <span class="voy-boat"></span>
  `;

  return 场;
}

/**
 * 播一次转场。
 * @param {{onDone?: Function}} 选项 onDone 在「到站」时**恰好被调用一次**（自然播完或被中断都算）
 * @returns {{中断: Function}} 句柄；调 中断() 立即到站
 */
export function play({ onDone } = {}) {
  const 收尾 = typeof onDone === 'function' ? onDone : () => {};

  let 到站过 = false;
  let 场 = null;
  let 计时器 = null;

  function 拆监听() {
    document.removeEventListener('click', 干扰, true);
    document.removeEventListener('wheel', 干扰, true);
    document.removeEventListener('touchstart', 干扰, true);
    document.removeEventListener('keydown', 干扰, true);
  }

  /* 任何「用户等不及了」的动作都算：点一下、滚一下、敲个键。
     不做 50ms 节流 —— 事件本身就是一次性的到站信号，到站过就短路了。 */
  function 干扰() {
    到站();
  }

  /**
   * 落到详情。
   * 关键点：**先到站、再收拾场面** —— onDone 立刻执行，详情面板马上就在，
   * 转场层只是随后淡出（.is-leaving 220ms），所以「立即到站」是真的立即，
   * 不是「等淡出动画播完」。 */
  function 到站() {
    if (到站过) return;
    到站过 = true;

    拆监听();
    if (计时器) { clearTimeout(计时器); 计时器 = null; }

    if (场) {
      const 死 = 场;
      场 = null;
      死.classList.add('is-leaving');
      setTimeout(() => 死.remove(), 260);
    }

    收尾();
  }

  /* 系统开了「减少动态效果」→ 不建场、不延时，直接到站（PRD 8.4 第三条） */
  if (减少动态()) {
    到站();
    return { 中断: 到站 };
  }

  场 = 建场(播过);
  document.body.append(场);
  播过 = true;

  /* 捕获阶段挂：转场层盖在整页上，点击命中的是它自己，
     只有捕获阶段才能保证在别处的处理器之前拿到这次点击。 */
  document.addEventListener('click', 干扰, true);
  document.addEventListener('wheel', 干扰, true);
  document.addEventListener('touchstart', 干扰, true);
  document.addEventListener('keydown', 干扰, true);

  计时器 = setTimeout(到站, 场.classList.contains('is-short') ? 短版毫秒 : 首播毫秒);

  return { 中断: 到站 };
}
