# -*- coding: utf-8 -*-
"""链路回归：收藏 / 详情面板的一条完整交互链（一档，走探针）。

验的是两条最容易悄悄坏掉的链（2026-10-02 都真坏过一次）：
  ① 取消收藏后面板要立刻跟着变（播藏 / 同步收藏 都重画面板 → 已收进 铺收藏 一处）；
  ② 关掉浮层要把地址收回来（靠 dialog 的 close 回调 —— 元素先 remove() 就不派发了）。

⚠️ 必须带 --force-prefers-reduced-motion 跑：否则点卡片先播 3 秒「云中仙槎」转场，
探针会抢在详情面板挂载之前读 DOM 而报 null。

跑法（在仓库根）：
    python tools/回归/flow-check.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _壳  # noqa: E402

端口 = 8148
探针 = '_probe-回归-flow.html'

断言们 = [
    ('含', 'A=进藏后条数:2'),
    ('含', 'B=取消后条数:1'),
    ('含', 'C=取消后计数:1'),
    ('含', 'D=取消后存储:1'),
    ('含', 'E=关面板后地址:#/部/异兽'),
    ('含', 'F=关面板后面板开:false'),
    ('含', 'G=详情地址:#/条/yishou-'),
    ('含', 'H=详情收藏后计数:2'),
    ('含', 'K=详情收藏后存储:2'),
    ('含', 'I=收详情后地址:#/部/异兽'),
    ('含', 'J=收详情后详情开:false'),
]

_壳.自查()
_壳.装探针('flow.html', 探针)
服务 = _壳.造服务(端口, 卡住='/__never')

败 = 0
try:
    try:
        html = _壳.取页(探针, 端口, 预算=12000, 跳过转场=True)
    except Exception as 错:
        print(f'  ✗   取页失败：{错}', flush=True)
        sys.exit(_壳.收尾(服务, 1))

    现场 = _壳.取结果(html)
    差 = _壳.断言(现场, 断言们)

    if 差:
        败 = len(差)
        p = _壳.存现场('链路.html', html)
        print(f'  ✗   收藏/详情链路｜{"、".join(差)}', flush=True)
        print(f'      现场：{现场[:400]}', flush=True)
        print(f'      已存 {p}', flush=True)
    else:
        print(f'  OK  收藏/详情链路｜{现场}', flush=True)
finally:
    _壳.撤探针(探针)

sys.exit(_壳.收尾(服务, 败))
