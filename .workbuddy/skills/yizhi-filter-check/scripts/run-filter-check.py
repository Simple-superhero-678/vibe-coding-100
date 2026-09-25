"""异兽志 · 筛选交互自检（Skill: yizhi-filter-check 的执行体）

一条命令做完六件事：
  起本地服务 → 把探针页复制进 yizhi/ → 跑第一轮（原数据）
  → 临时改 yishou.json 造夹具跑第二轮 → 还原数据 + 删探针页 → 写调用记录

用法：python .workbuddy/skills/yizhi-filter-check/scripts/run-filter-check.py
退出码：0 = 两轮全过；1 = 有用例失败或出意外

设计依据（本机踩过的坑，都写进技能 local-web-verify 了）：
  · 本机 bash 里 rm/mkdir/sleep 都是 127 → 建目录删文件全在 python 里做，不调 shell
  · 不写常驻服务 → 服务起在 python 后台线程，跑完就 shutdown
  · --window-size 的视口 ≠ CSS px → 探针页用同源 iframe 锁宽 1180（改版式时才需要，本脚本不改版式）
  · --dump-dom 的取样点 ≈ load → 探针页挂一个 /__never 卡住 load，跑完自己摘掉
"""

import datetime
import functools
import glob
import html as H
import http.server
import json
import os
import re
import shutil
import socketserver
import subprocess
import sys
import threading
import time
import urllib.request

这里 = os.path.dirname(os.path.abspath(__file__))


def 找项目根(起):
    d = 起
    for _ in range(8):
        if os.path.isfile(os.path.join(d, 'yizhi', 'index.html')):
            return d
        d = os.path.dirname(d)
    raise SystemExit('找不到项目根（向上 8 级都没看到 yizhi/index.html）')


项目 = 找项目根(这里)
站点 = os.path.join(项目, 'yizhi')
数据档 = os.path.join(站点, 'data', 'yishou.json')
探针源 = os.path.join(这里, 'probe-filter.html')
探针页 = os.path.join(站点, '_probe-filter.html')
记录目录 = os.path.join(项目, 'tools', '自检记录')
记录档 = os.path.join(记录目录, datetime.date.today().isoformat() + '-筛选自检.json')
端口 = 8770
替换次数校验 = 2          # yishou.json 里「灾祸」应有的条数；数据改了要同步改这里

# ── 找 Edge ────────────────────────────────────────────────────────────
候选 = glob.glob(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe') \
     + glob.glob(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe') \
     + glob.glob(r'C:\Program Files\Google\Chrome\Application\chrome.exe')
if not 候选:
    raise SystemExit('没找到 Edge/Chrome')
EDGE = 候选[0]


class 静音(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):
        # 不发 no-store 的话，Edge 会按启发式规则把 main.js / css 缓存进 profile，
        # 于是「改完代码重跑」跑的还是旧代码 —— 这类假故障最会骗人。
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def do_GET(self):
        # /__never：永不返回。把探针页的 load 卡住，取样点才不会落在探针跑完之前。
        # 探针收尾时摘掉那个 img，请求被取消，load 随即完成 —— 于是不必等 --timeout。
        if self.path.startswith('/__never'):
            time.sleep(600)
            return
        return super().do_GET()


def 起服务():
    handler = functools.partial(静音, directory=站点)
    httpd = socketserver.ThreadingTCPServer(('127.0.0.1', 端口), handler)
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    for _ in range(80):
        try:
            urllib.request.urlopen('http://127.0.0.1:%d/index.html' % 端口, timeout=1).read(1)
            return httpd
        except Exception:
            time.sleep(0.1)
    raise SystemExit('本地服务起不来（端口 %d 可能被占）' % 端口)


def 跑一轮(夹具):
    """夹具 True/False → 跑一次探针页，返回解析好的结果字典。"""
    profile = os.path.join(项目, 'tmp', 'edge-profile-filter-' + ('fixture' if 夹具 else 'base'))
    shutil.rmtree(profile, ignore_errors=True)   # 每轮都从空 profile 起：缓存是「假故障」的头号来源
    os.makedirs(profile, exist_ok=True)
    址 = 'http://127.0.0.1:%d/_probe-filter.html' % 端口 + ('?夹具=1' if 夹具 else '')
    cmd = [EDGE, '--headless=new', '--disable-gpu', '--no-first-run',
           '--user-data-dir=' + profile,
           '--timeout=' + os.environ.get('FILTER_TIMEOUT', '35000'),
           '--dump-dom', 址]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8',
                           errors='replace', timeout=240)
        html = r.stdout or ''
    except subprocess.TimeoutExpired:
        html = ''
        print('  [edge] 超时 240s，没拿到 DOM')
    # 留一份 dump：失败时只有它能说明「当时页面上到底长什么样」
    档案 = os.path.join(项目, 'tmp', 'edge-probe-filter-%s.html' % ('fixture' if 夹具 else 'base'))
    try:
        with open(档案, 'w', encoding='utf-8') as f:
            f.write(html)
    except Exception as 因:
        print('  [dump] 写不进 %s：%s' % (档案, 因))
    return 解析(html)


def 解析(html):
    标记 = re.search(r'data-探针="(PASS|FAIL)"', html)
    计数 = re.search(r'data-用例="(\d+/\d+)"', html)
    块 = re.search(r'<pre id="out">(.*?)</pre>', html, re.S)
    明细 = None
    if 块:
        try:
            明细 = json.loads(H.unescape(块.group(1)))
        except Exception as 因:
            明细 = {'解析失败': str(因)}
    return {
        '标记': 标记.group(1) if 标记 else None,
        '用例数': 计数.group(1) if 计数 else None,
        '明细': 明细,
    }


def 摘失败(轮):
    明细 = 轮['结果'].get('明细') or {}
    用例 = 明细.get('结果') or []
    return [u for u in 用例 if not u.get('通过')]


def main():
    # 原字节备份：文本模式会做换行转换（本机 core.autocrlf=true，工作区是 CRLF），
    # 用 bytes 读、bytes 写才能真正做到「原样还回去」，也就不会有假 diff。
    原始字节 = open(数据档, 'rb').read()
    原始 = 原始字节.decode('utf-8')
    os.makedirs(记录目录, exist_ok=True)
    httpd = 起服务()
    print('[服务] 就绪 http://127.0.0.1:%d/  → %s' % (端口, 站点))

    轮次 = []
    shutil.copyfile(探针源, 探针页)
    try:
        print('[第一轮] 原数据 …')
        轮次.append({'轮': '原数据（无夹具）', '夹具': 0, '结果': 跑一轮(False)})

        改后, 次数 = re.subn(r'"吉凶":\s*"灾祸"', '"吉凶": "无害"', 原始)
        if 次数 != 替换次数校验:
            raise SystemExit('夹具替换了 %d 处，期望 %d 处 —— 数据变过了？先核对 yishou.json' % (次数, 替换次数校验))
        open(数据档, 'wb').write(改后.encode('utf-8'))
        print('[第二轮] 数据夹具（%d 条「灾祸」暂记为「无害」，让「灾祸」计数变 0）…' % 次数)
        轮次.append({'轮': '数据夹具（%d 条「灾祸」暂记为「无害」，造出 0 条值）' % 次数,
                     '夹具': 1, '结果': 跑一轮(True)})
    finally:
        open(数据档, 'wb').write(原始字节)
        已还原 = open(数据档, 'rb').read() == 原始字节
        if os.path.exists(探针页):
            os.remove(探针页)
        httpd.shutdown()
        print('[清理] 数据已还原 = %s · 探针页已删 = %s · 服务已停'
              % (已还原, not os.path.exists(探针页)))

    全过 = 已还原 and all(轮['结果']['标记'] == 'PASS' and 轮['结果']['明细'] for 轮 in 轮次)
    记录 = {
        '自检': '异兽志 · 筛选交互自检',
        'Skill': 'yizhi-filter-check',
        '时间': datetime.datetime.now().isoformat(timespec='seconds'),
        '站点': 'yizhi/',
        '检查项': ['三态：有结果 / 无结果 / 清空恢复', '筛选条口径：标条数 · 0 条只弱化不禁用 · 多选读作「或」',
                   '无障碍：aria-pressed 同步 · 键盘可达 · 计数可读 · 焦点环', '契约边界：只从 UI 外部驱动'],
        '夹具说明': '把 yishou.json 里 %d 条「吉凶: 灾祸」临时改成「无害」，让「灾祸」计数变 0，'
                    '从而真实点出「0 条只弱化不禁用 → 筛空面板 → 清除出口」这条 UI 路径；跑完按原字节还原。' % 替换次数校验,
        '数据夹具已还原': 已还原,
        '探针页已删除': not os.path.exists(探针页),
        '轮次': 轮次,
        '结论': '通过' if 全过 else '未通过',
    }
    open(记录档, 'w', encoding='utf-8').write(json.dumps(记录, ensure_ascii=False, indent=2))

    print('──────── 结果 ────────')
    for 轮 in 轮次:
        r = 轮['结果']
        print('  %-46s %-4s 用例 %s' % (轮['轮'], r['标记'] or '(没读到标记)', r['用例数'] or '—'))
        for u in 摘失败(轮):
            print('    ✗ %s：%s' % (u['用例'], u['详情']))
    print('  结论：%s' % 记录['结论'])
    print('  记录：%s' % 记录档)
    return 0 if 全过 else 1


def 跑截图(名, 夹具=False):
    """把页面停在某个筛选态（名 = 原始 | 吉祥 | 凶恶 | 灾祸 | 无害），截图存 tmp/筛选-<名>.png。
    夹具=True 时先临时改数据（造 0 条值），所以在夹具下点「灾祸」拍到的就是筛空面板。
    只为「人眼过版面 / 留证据」用；无头截图没有地址栏，带地址栏的图得人自己开浏览器截。"""
    图 = os.path.join(项目, 'tmp', '筛选-%s%s.png' % (名, '-夹具' if 夹具 else ''))
    profile = os.path.join(项目, 'tmp', 'edge-profile-shot')
    shutil.rmtree(profile, ignore_errors=True)
    os.makedirs(profile, exist_ok=True)
    原始字节 = open(数据档, 'rb').read()
    httpd = 起服务()
    shutil.copyfile(探针源, 探针页)
    try:
        if 夹具:
            改后, 次数 = re.subn(r'"吉凶":\s*"灾祸"', '"吉凶": "无害"', 原始字节.decode('utf-8'))
            if 次数 != 替换次数校验:
                raise SystemExit('夹具替换了 %d 处，期望 %d 处' % (次数, 替换次数校验))
            open(数据档, 'wb').write(改后.encode('utf-8'))
        址 = 'http://127.0.0.1:%d/_probe-filter.html?截图=%s%s' % (
            端口, urllib.request.quote(名), '&夹具=1' if 夹具 else '')
        cmd = [EDGE, '--headless=new', '--disable-gpu', '--no-first-run',
               '--user-data-dir=' + profile, '--window-size=1440,1100',
               '--timeout=' + os.environ.get('FILTER_TIMEOUT', '35000'),
               '--screenshot=' + 图, 址]
        r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8',
                           errors='replace', timeout=240)
        if os.path.exists(图):
            print('[截图] 退出码 %d · %s（%d KB）' % (r.returncode, 图, os.path.getsize(图) // 1024))
            return 图
        print('[截图] 没出图，退出码 %d' % r.returncode)
        return None
    finally:
        if 夹具:
            open(数据档, 'wb').write(原始字节)      # 只有真动过才写回；否则连碰都不碰这个文件
        if os.path.exists(探针页):
            os.remove(探针页)
        httpd.shutdown()


if __name__ == '__main__':
    if '--截图' in sys.argv:
        位 = sys.argv.index('--截图') + 1
        名 = sys.argv[位] if len(sys.argv) > 位 else '吉祥'
        sys.exit(0 if 跑截图(名, 夹具='--夹具' in sys.argv) else 1)
    sys.exit(main())
