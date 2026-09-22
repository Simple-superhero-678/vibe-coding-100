// 异兽志 · 视图层「收藏列表」（V4，F5）
// 契约（TECH_DESIGN §6.2）：renderFavList(容器, 条目[])
//
// 本层不认识 localStorage：只吃「已经挑好的条目数组」，只画。
// 「哪几条被收藏了」这个问题由 main.js 问 store.js 去。
//
// 与详情面板同一套做法：按钮只派发事件（js/events.js），执行交给装配层。
// 列表项做成可点的 —— 收藏夹里看到一条想去看看，不该逼人回到网格里再搜一遍。

import { 打开请求, 收藏切换 } from '../events.js';

function 建行(类名, 文本) {
  const 节点 = document.createElement('p');
  节点.className = 类名;
  节点.textContent = 文本;   // 一律 textContent，条目内容不进 innerHTML
  return 节点;
}

/**
 * 画收藏列表。容器内容会被整体替换。
 * @param {HTMLElement} 容器
 * @param {object[]} 条目 已收藏的条目（顺序即 store.list() 的顺序）
 * @returns {number} 实际画出的条数
 */
export function renderFavList(容器, 条目) {
  const 列表 = Array.isArray(条目) ? 条目 : [];

  容器.textContent = '';

  /* 空态：说清怎么让它不空，而不是留一句「暂无数据」（PRD 8.6 禁占位文字） */
  if (!列表.length) {
    const 块 = document.createElement('div');
    块.className = 'fav-empty';
    块.append(建行('fav-empty-msg', '收藏夹还空着。'));
    块.append(建行('fav-empty-lead', '打开任意一条的详情，点「收藏」，它就会出现在这里。'));
    容器.append(块);
    return 0;
  }

  const 表 = document.createElement('ul');
  表.className = 'fav-list';

  列表.forEach(条 => {
    const 已下架 = !!条.已下架;

    const 项 = document.createElement('li');
    项.className = 'fav-item' + (已下架 ? ' is-gone' : '');
    项.dataset.id = 条.id;

    /* 打开：整块标题目做成按钮，点哪都是打开这一条。
       已下架的条目没有详情可开，所以它不是按钮 —— 做了按钮却打不开，比不给按钮更糟。 */
    const 开 = document.createElement(已下架 ? 'span' : 'button');
    开.className = 'fav-open';
    if (!已下架) {
      开.type = 'button';
      开.addEventListener('click', () => {
        项.dispatchEvent(new CustomEvent(打开请求, { bubbles: true, detail: { id: 条.id } }));
      });
    }

    const 名 = document.createElement('span');
    名.className = 'fav-name';
    名.textContent = 条.名;

    const 源 = document.createElement('span');
    源.className = 'fav-src';
    源.textContent = 已下架 ? '收藏时存的 id 已不在当前数据里' : 条.出处;

    /* 部标（M6）：收藏夹是跨五部的，不写清这条从哪一部来的，翻收藏时得靠记性 */
    if (!已下架 && 条.部) {
      const 部标 = document.createElement('span');
      部标.className = 'fav-bu';
      部标.textContent = 条.部;
      开.append(部标, 名, 源);
    } else {
      开.append(名, 源);
    }

    /* 已下架的那条也留着「移除」：收藏夹里有个点不开又清不掉的东西，最让人难受 */
    const 撤 = document.createElement('button');
    撤.type = 'button';
    撤.className = 'fav-remove';
    撤.textContent = 已下架 ? '移除' : '取消收藏';
    撤.setAttribute('aria-label', `从收藏夹移除 ${条.名}`);
    撤.addEventListener('click', () => {
      项.dispatchEvent(new CustomEvent(收藏切换, { bubbles: true, detail: { id: 条.id } }));
    });

    项.append(开, 撤);
    表.append(项);
  });

  容器.append(表);
  return 列表.length;
}
