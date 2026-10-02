# -*- coding: utf-8 -*-
"""回归总入口：按顺序跑完三套，最后给一句总结。

跑法（在仓库根）：
    python "tools/回归/run.py"                 # 全跑：路线 → 状态 → 链路
    python "tools/回归/run.py" 路线            # 只跑一套
    python "tools/回归/run.py" 状态 1 6        # 只跑状态套的第 1–6 档（一次全跑会顶到命令超时）
    python "tools/回归/run.py" 状态 7 11

为什么要有个总入口：三套各自能单跑，但改完代码想一次确认没碰坏东西时，
一条命令跑完最省事；分套打印也方便只看坏掉的那一套。
"""
import os
import subprocess
import sys

本目录 = os.path.dirname(os.path.abspath(__file__))
套件 = [
    ('路线', 'route-check.py', '九档：地址 → 页面 / 检索 / 收藏 / 详情深链'),
    ('状态', 'state-check.py', '十一档：加载中 / 成功 / 空 / 错误 × 三个消费方'),
    ('链路', 'flow-check.py', '一档：收藏与详情面板的完整交互链'),
]


def 名们():
    return [名 for 名, _, _ in 套件]


def _跑(脚本, 额外):
    路径 = os.path.join(本目录, 脚本)
    子 = subprocess.run([sys.executable, 路径] + 额外, cwd=os.path.dirname(os.path.dirname(本目录)))
    return 子.returncode


def main():
    参 = sys.argv[1:]
    要跑 = 套件
    if 参:
        名 = 参[0]
        命中 = [s for s in 套件 if s[0] == 名]
        if not 命中:
            print(f'没这套：{名}。可选的：{" / ".join(名们())}')
            return 2
        要跑 = 命中
        额外 = 参[1:]
    else:
        额外 = []

    结果 = []
    for 名, 脚本, 说明 in 要跑:
        print(f'\n════ {名} · {说明} ════', flush=True)
        码 = _跑(脚本, 额外)
        结果.append((名, 码))

    坏 = [名 for 名, 码 in 结果 if 码 != 0]
    print('\n════ 总结 ════')
    for 名, 码 in 结果:
        print(f'  {"OK " if 码 == 0 else "✗  "} {名}')
    print('全绿' if not 坏 else f'有失败：{"、".join(坏)}')
    return 1 if 坏 else 0


if __name__ == '__main__':
    sys.exit(main())
