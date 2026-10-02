# -*- coding: utf-8 -*-
"""回归脚本的公共壳：路径推算、本地服务、无头 Edge 取样、探针页的装与撤。

为什么要有它（2026-10-02 的教训）：
探针页原来手写在 yizhi/ 里、用完即删。下一次跑回归时探针页已经不在了，
于是 11 档全红、整轮只跑 12 秒 —— 症状极像产品代码被改坏，实际是取样器没了。
现在探针页跟脚本放在一起（tools/回归/探针/），跑之前由脚本自己拷进站点、
跑完自己删掉（try/finally），站点目录里不留东西，脚本也随时可跑。

约定：
  · 站点根 = 仓库根/yizhi（服务根目录就是它，不是仓库根）
  · dump 现场落在 tools/回归/_dump/（已 gitignore）
  · 所有路径从本文件位置推算，不写死绝对路径 —— 换机器、换目录都不用改
"""
import http.server
import os
import re
import shutil
import socketserver
import subprocess
import tempfile
import threading
import time
from html import unescape

本目录 = os.path.dirname(os.path.abspath(__file__))
仓库根 = os.path.dirname(os.path.dirname(本目录))
站点根 = os.path.join(仓库根, 'yizhi')
探针目录 = os.path.join(本目录, '探针')
dump目录 = os.path.join(本目录, '_dump')

edge候选 = [
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
]


def 找edge():
    for 路径 in edge候选:
        if os.path.exists(路径):
            return 路径
    raise SystemExit('找不到 msedge.exe。装了 Edge 但路径不同的话，改 tools/回归/_壳.py 里的 edge候选。')


def 自查():
    """开跑前先把「跑不动」的原因说清楚，别让人对着空白输出猜。"""
    if not os.path.exists(os.path.join(站点根, 'index.html')):
        raise SystemExit(f'站点根不像站点：{站点根}（里面没有 index.html）')
    return 找edge()


def 造服务(端口, 卡住=None):
    """起一个多线程本地服务，返回实例（用完 shutdown()）。

    卡住 = 一个路径前缀；命中它就睡 20 秒不返回。
    用途：把页面的 load 事件钉住，好让 Edge 的 --timeout 在**真实时间**上取样 ——
    --dump-dom 默认的取样点在 load 那一刻，而我们的数据是异步 fetch 的，
    直接 dump 会同一档两轮红绿交替（实测）。
    """
    class 处理器(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=站点根, **k)

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store, must-revalidate')
            super().end_headers()

        def do_GET(self):
            if 卡住 and self.path.startswith(卡住):
                time.sleep(20)
                return
            super().do_GET()

        def log_message(self, *a):
            pass

    class 服务(socketserver.ThreadingTCPServer):
        allow_reuse_address = True
        daemon_threads = True          # 必须多线程，否则 /__never 会独吞整个进程

    实例 = 服务(('127.0.0.1', 端口), 处理器)
    threading.Thread(target=实例.serve_forever, daemon=True).start()
    return 实例


def 取页(路径, 端口, 预算=6000, 跳过转场=False, 超时=180, 虚拟时间=None):
    """用无头 Edge 取一页脚本执行后的 DOM。

    · 默认走 --timeout=<预算>（真实时间）—— 验异步渲染用这个
    · 虚拟时间=None 表示不用 --virtual-time-budget；只有「纯静态、不验中间态」
      的档才用它（它会把 setTimeout 快进，慢态骨架会被直接吃掉）
    · 每个实例一个独立 user-data-dir，否则互相锁死；且每轮都是干净 profile，
      不会出现「上一轮的缓存/收藏态」污染这一轮
    """
    档 = tempfile.mkdtemp(prefix='edge-reg-')
    参数 = [找edge(), '--headless=new', '--disable-gpu', '--no-first-run',
            '--no-default-browser-check', '--disable-extensions']
    if 跳过转场:
        # 不跳过的话，点卡片要先播 3 秒「云中仙槎」，探针会抢在详情挂载前读 DOM
        参数.append('--force-prefers-reduced-motion')
    if 虚拟时间:
        参数.append(f'--virtual-time-budget={虚拟时间}')
    else:
        参数.append(f'--timeout={预算}')
    参数 += [f'--user-data-dir={档}', '--dump-dom', f'http://127.0.0.1:{端口}/{路径}']

    try:
        结果 = subprocess.run(参数, capture_output=True, timeout=超时)
        return 结果.stdout.decode('utf-8', 'replace')
    finally:
        shutil.rmtree(档, ignore_errors=True)


def 取结果(html):
    """把探针页写进 <body data-result="…"> 的那串「字段=值」抠出来。"""
    m = re.search(r'data-result="([^"]*)"', html)
    return unescape(m.group(1)) if m else ''


def 装探针(名, 目标名):
    """把 探针/<名> 拷进站点根，返回落地路径。

    为什么要拷：Edge 只能通过 http 读**站点目录里**的页，
    探针要同源才能操作 iframe 里的内容（读 DOM、点按钮、看 localStorage）。
    """
    源 = os.path.join(探针目录, 名)
    if not os.path.exists(源):
        raise SystemExit(f'探针页不见了：{源}\n（它应该跟脚本一起躺在 tools/回归/探针/ 里）')
    目标 = os.path.join(站点根, 目标名)
    shutil.copyfile(源, 目标)
    return 目标


def 撤探针(*目标名):
    """把拷进站点的探针页删掉 —— 站点目录必须保持干净（它会整个被发布）。"""
    for 名 in 目标名:
        p = os.path.join(站点根, 名)
        if os.path.exists(p):
            os.remove(p)


def 存现场(名, html):
    """留一份 dump 供事后翻案用（_dump/ 已 gitignore）。"""
    os.makedirs(dump目录, exist_ok=True)
    路径 = os.path.join(dump目录, 名)
    with open(路径, 'w', encoding='utf-8') as f:
        f.write(html)
    return 路径


def 断言(现场, 断言们):
    """跑一组 (含/不含, 片段) 断言，返回没过的那些描述。"""
    差 = []
    for 式, 片 in 断言们:
        有 = 片 in 现场
        if 有 != (式 == '含'):
            差.append(f'{式}「{片}」')
    return 差


def 收尾(服务, 败):
    """统一收尾：关服务 + 打印结果 + 返回退出码。"""
    服务.shutdown()
    print(f'\n结果：{"全绿" if 败 == 0 else str(败) + " 项失败"}', flush=True)
    return 1 if 败 else 0
