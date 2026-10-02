# -*- coding: utf-8 -*-
"""路线回归：九档，逐个路由 dump DOM 后断言（不走探针）。

查的是「地址栏写什么 → 页面铺出什么」这一层：四部直达条数、跨部检索、
零结果空态、收藏直达、详情深链、id 打错回退。

这些档都是**正常态**（没有延时、没有弹层），所以这里用 --virtual-time-budget
直接 dump 就够 —— 它会把 fetch 一起快进。需要看中间态（加载中/错误）的档
在 state-check.py 里，那套必须走探针 + 真实时间。

跑法（在仓库根）：
    python tools/回归/route-check.py
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _壳  # noqa: E402

端口 = 8141

# (路径, 名称, [(类型, 参数, 期望), ...])；类型：计数 / 总条数 / 包含 / 不含
检查 = [
    ('', '空 hash → 默认入口异兽部', [('计数', 'data-id="yishou-', 12), ('不含', 'load-fail')]),
    ('#/部/神仙', '神仙部直达', [('计数', 'data-id="shenxian-', 30), ('不含', 'load-fail')]),
    ('#/部/妖怪', '妖怪部直达', [('计数', 'data-id="yaoguai-', 20), ('不含', 'load-fail')]),
    ('#/部/境界', '境界部直达（默认网文 9 阶）', [('计数', 'data-id="jingjie-', 9), ('不含', 'load-fail')]),
    ('#/搜/蛇', '检索直达：跨部搜「蛇」', [('包含', 'data-id="yaoguai-'), ('包含', 'data-id="yishou-'),
                                        ('总条数', '', 3), ('不含', 'load-fail')]),
    ('#/搜/zzz', '检索零结果（空态）', [('包含', '没找到「zzz」'), ('包含', '清空，回到')]),
    ('#/藏', '收藏直达（空收藏）', [('包含', 'panel-fav'), ('包含', '收藏夹还空着'), ('不含', 'load-fail')]),
    ('#/条/yishou-001', '详情深链', [('包含', '九尾狐 详情'), ('包含', 'crumb-bu'), ('包含', 'detail-crumb')]),
    ('#/条/不存在', '详情 id 打错 → 回退部浏览', [('计数', 'data-id="yishou-', 12)]),
]


def 站况(html):
    m = re.search(r'id="站况"[^>]*>([^<]*)<', html)
    return m.group(1).strip() if m else '(没找到站况)'


def 逐条断言(html, 断言们):
    差 = []
    for 断言 in 断言们:
        类型, 参数 = 断言[0], 断言[1]
        期望 = 断言[2] if len(断言) > 2 else True
        if 类型 == '计数':
            实际 = html.count(参数)
        elif 类型 == '总条数':
            实际 = len(re.findall(r'data-id="', html))
        elif 类型 == '包含':
            实际, 期望 = 参数 in html, True
        else:                                   # 不含
            实际, 期望 = 参数 in html, False
        if 实际 != 期望:
            差.append(f'{类型}({参数}) 实际={实际} 期望={期望}')
    return 差


_壳.自查()
服务 = _壳.造服务(端口)
败 = 0

try:
    for 序, (路径, 名称, 断言们) in enumerate(检查, 1):
        print(f'[{序}/{len(检查)}] {名称} …', flush=True)
        try:
            html = _壳.取页(路径, 端口, 虚拟时间=8000)
        except Exception as 错:
            败 += 1
            print(f'  ✗ 取页失败：{错}', flush=True)
            continue

        差 = 逐条断言(html, 断言们)
        if 差:
            败 += 1
            p = _壳.存现场(f'路线-{序}-{名称}.html', html)
            print(f'  ✗   {名称}｜站况：{站况(html)}｜{"；".join(差)}\n      现场已存 {p}', flush=True)
        else:
            print(f'  OK  {名称}｜站况：{站况(html)}', flush=True)
finally:
    sys.exit(_壳.收尾(服务, 败))
