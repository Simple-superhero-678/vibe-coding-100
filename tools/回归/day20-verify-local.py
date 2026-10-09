# -*- coding: utf-8 -*-
# Day 20 板块②本地验证：起服务 → Edge 跑探针 → 判定 → 清理（一条命令全包，不留常驻）
# 两个上一版的坑（本版修掉）：
#   ① /__never 必须由服务端真 hang（本地 404 秒完成 → load 立即触发 → dump 太早）
#   ② Edge 必须按进程树杀（taskkill /T /F），否则残留渲染进程握着管道卡死整条命令
import http.server, socketserver, threading, subprocess, tempfile, shutil, re, os, sys, time, functools

根 = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
站点 = os.path.join(根, 'yizhi')
探针源 = os.path.join(根, 'tools', '回归', '探针', 'probe20.html')
探针宿 = os.path.join(站点, '_probe20.html')
端口 = 8020

class 服务(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=站点, **k)
    def log_message(self, fmt, *args):  # 日志进 stderr 但压缩成一行，好读
        sys.stderr.write('[srv] %s\n' % (fmt % args))
    def do_GET(self):
        if self.path.startswith('/__never'):
            # 故意不响应：卡住页面 load，让 Edge --timeout 到点后才 dump（此时异步数据已回）
            time.sleep(300)
            return
        super().do_GET()

# ⚠️ 必须 Threading：hang 住 /__never 的请求不能堵死其它请求（单线程版全站排队，实测惨案）
class 线程服务(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True

httpd = 线程服务(('127.0.0.1', 端口), 服务)
threading.Thread(target=httpd.serve_forever, daemon=True).start()

profile = tempfile.mkdtemp(prefix='edge_day20_')
码 = 0
edge = None
try:
    shutil.copyfile(探针源, 探针宿)
    for p in (r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
              r'C:\Program Files\Microsoft\Edge\Application\msedge.exe'):
        if os.path.exists(p):
            edge = p
            break
    if not edge:
        print('没找到 Edge'); 码 = 2; sys.exit(2)

    cmd = [edge, '--headless=new', '--disable-gpu', '--timeout=28000',
           '--user-data-dir=' + profile,
           '--dump-dom', f'http://127.0.0.1:{端口}/_probe20.html']
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        dom, _ = proc.communicate(timeout=60)
        dom = dom.decode('utf-8', errors='replace')
    except subprocess.TimeoutExpired:
        subprocess.run(['taskkill', '/T', '/F', '/PID', str(proc.pid)],
                       capture_output=True)
        print('Edge 45 秒没退出，已按进程树杀掉')
        码 = 5
        dom = ''

    m = re.search(r'PROBE_JSON:(\{.*\})', dom)
    if not m:
        print('探针没落出结果。DOM 前 400 字：', dom[:400].replace('\n', ' ') if dom else '(空)')
        码 = 3 if not 码 else 码
    else:
        import json
        出 = json.loads(m.group(1))
        台文 = 出.get('检查台文本', '')
        公网 = 出.get('公网请求', [])
        写入 = 出.get('写入', '')

        checks = [
            ('检查台渲染出接口数据（服务正常）', '服务正常' in 台文),
            ('不是「读不到」的错态', '读不到' not in 台文),
            ('展示 favorites 真实行数', bool(re.search(r'\d+ 行真实数据', 台文))),
            ('F12 请求打公网地址（tcloudbase 域名）', isinstance(公网, list) and len(公网) >= 1),
            ('写入测试落出 201 或 409', bool(re.search(r'201|409', str(写入)))),
        ]
        print('=== 检查台原文 ===')
        print(台文 or '(空)')
        print('=== 公网请求（host）===')
        for u in (公网 if isinstance(公网, list) else [公网]):
            print(' ', u)
        print('=== 写入 ===')
        print(' ', 写入)
        print('=== 判定 ===')
        for 名, 好 in checks:
            print(('PASS ' if 好 else 'FAIL '), 名)
        码 = 0 if all(好 for _, 好 in checks) else 4
        print(f'==== {sum(好 for _, 好 in checks)} / {len(checks)} 通过 ====')
finally:
    httpd.shutdown()
    shutil.rmtree(profile, ignore_errors=True)
    if os.path.exists(探针宿):
        os.remove(探针宿)
sys.exit(码)
