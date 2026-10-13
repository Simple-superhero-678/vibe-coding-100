#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""verify-project · 异兽志「发布前检查」

是什么：把「发布前该确认的事」拧成一条命令 —— 丁是丁卯是卯，逐项给 PASS/FAIL + 证据。
十项检查分三组：甲·安全红线 / 乙·线上活着 / 丙·本地发布物。检查项的来历见 SKILL.md。

用法：
    python run-check.py                 # 全项检查（默认）
    python run-check.py --标签 演示      # 记录文件名加后缀（同一天跑多次、互相不覆盖）
    python run-check.py --演练           # 自证「不会虚报通过」：往 station.js 注入假密钥 →
                                        # 检查应 FAIL → 自动恢复（字节级校验）→ 再跑应 PASS

退出码：0 = 全绿可以发布；1 = 有失败项；2 = 脚本自身出问题（找不到仓库根等）。

设计约束（跟着项目踩过的坑走）：
  - 网络项失败自动重试 3 次（间隔 2s）——一次抖动不算故障，连续三次才判 FAIL。
  - 所有文本按 UTF-8 读写；git 一律 `-z` 拿原始字节，避开中文文件名被转义成八进制的静默坑。
  - 每一项独立 try/except：某一项自己崩了，记为该项 FAIL（「查不了」绝不冒充「通过」）。
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time

# ---------------------------------------------------------------- 基础定位与常量


def 找仓库根():
    d = os.path.dirname(os.path.abspath(__file__))
    for _ in range(8):
        if os.path.isfile(os.path.join(d, 'yizhi', 'index.html')) and \
           os.path.isfile(os.path.join(d, 'tools', 'scan-secrets.py')):
            return d
        d = os.path.dirname(d)
    print('!! 找不到仓库根（从脚本位置向上找 yizhi/index.html + tools/scan-secrets.py 未果）')
    sys.exit(2)


仓库根 = 找仓库根()

页面站 = 'https://simple-superhero-678.github.io/vibe-coding-100/'
接口基址 = 'https://yishou-d9gyoykka49fb0634-1501173044.ap-shanghai.app.tcloudbase.com'
健康接口 = 接口基址 + '/api/health'
来源_githubio = 'https://simple-superhero-678.github.io'
来源_evil = 'https://evil.example.com'

五部期望 = [('shenxian.json', '神仙部', 30), ('shenhua.json', '神话部', 20),
           ('yishou.json', '异兽部', 13), ('yaoguai.json', '妖怪部', 20),
           ('jingjie.json', '境界部', 14)]

发布白名单后缀 = {'.html', '.css', '.js', '.json', '.webp', '.gitkeep'}


def 找工具(名, 候选=()):
    p = shutil.which(名)
    if p:
        return p
    for c in 候选:
        if os.path.isfile(c):
            return c
    return None


GIT = 找工具('git', (
    r'C:/Program Files/Git/bin/git.exe',
    r'D:/AI/projects/WorkBuddy/resources/vendor/PortableGit/mingw64/bin/git.exe',
))
CURL = 找工具('curl', (r'C:/Windows/System32/curl.exe',))
NODE = 找工具('node', (
    r'C:/Users/lxb07/.workbuddy/binaries/node/versions/22.22.2-6/node.exe',
    r'C:/Users/lxb07/AppData/Local/Programs/nodejs/node.exe',
))


def 跑(命令, 超时=60):
    env = dict(os.environ)
    env['PYTHONIOENCODING'] = 'utf-8'
    return subprocess.run(命令, cwd=仓库根, capture_output=True, text=True,
                          encoding='utf-8', errors='replace', timeout=超时, env=env)


def git(*参数, 超时=30):
    return 跑([GIT] + list(参数), 超时=超时)


def 摘行(文本, 关键词):
    for 行 in 文本.splitlines():
        if 关键词 in 行:
            return 行.strip()
    return None


def 重试(次数, 间隔, 一次):
    """一次() 返回 (好?, 值)。失败重试；返回 (值, 第几次成功/0)。"""
    最后 = '（未执行）'
    for 第 in range(1, 次数 + 1):
        try:
            好, 值 = 一次()
        except Exception as 因:
            好, 值 = False, f'{因!r}'
        if 好:
            return 值, 第
        最后 = 值
        if 第 < 次数:
            time.sleep(间隔)
    return 最后, 0


# ---------------------------------------------------------------- 甲·安全红线


def 检查_A1():
    """密钥扫描 —— 复用 tools/scan-secrets.py（自带阳性对照，防「正则写坏假干净」）"""
    脚本 = os.path.join('tools', 'scan-secrets.py')
    if not os.path.isfile(os.path.join(仓库根, 脚本)):
        return False, '找不到 tools/scan-secrets.py', []
    r = 跑([sys.executable, 脚本], 超时=180)
    出 = r.stdout
    对照 = 摘行(出, '[0] 阳性对照') or ''
    扫描 = 摘行(出, '实际扫描文本') or ''
    命中 = 摘行(出, '[2] 密钥特征词命中') or ''
    m1 = re.search(r'(\d+/\d+)', 对照)
    m2 = re.search(r'(\d+) 个', 扫描)
    m3 = re.search(r'(\d+) 条', 命中)
    摘要 = '对照 {} · 扫描 {} 个文本 · 命中 {} 条'.format(
        m1.group(1) if m1 else '?', m2.group(1) if m2 else '?', m3.group(1) if m3 else '?')
    if r.returncode == 0:
        return True, 摘要, []
    详情 = [行.strip() for 行 in 出.splitlines() if '←' in 行]
    return False, 摘要 + '（扫描器退出码 {}）'.format(r.returncode), 详情


def 检查_A2():
    """敏感路径忽略规则 —— .gitignore 红线是否还把该挡的挡在门外"""
    if not GIT:
        return False, '本机找不到 git，无法核对忽略规则', []
    路径表 = [
        ('.env', '环境变量文件'),
        ('tmp/verify-probe.txt', '临时目录'),
        ('checkin/_build/credential-probe.json', '打卡中间产物'),
        ('yizhi/assets-private/图.webp', '私有原图'),
        ('yizhi/预览/样图/图.png', '出图过程样张'),
    ]
    未命中 = []
    for 路径, 说明 in 路径表:
        r = git('check-ignore', '-v', '--', 路径)
        if r.returncode != 0:
            未命中.append(f'{路径}（{说明}）')
    跟踪 = git('ls-files', '-z', '--', '.env')
    被跟踪 = bool([x for x in 跟踪.stdout.split('\x00') if x.strip()])
    if 未命中:
        return False, f'{len(路径表) - len(未命中)}/{len(路径表)} 命中，有漏网', \
            [f'未被忽略：{x}' for x in 未命中]
    if 被跟踪:
        return False, '.env 被 git 跟踪了（红线）', ['.env 出现在 git ls-files 里']
    return True, f'{len(路径表)}/{len(路径表)} 命中忽略规则 · .env 未被跟踪', []


def 检查_A3():
    """站点目录卫生 —— yizhi/ 里不留过程文件（探针页 / 日志 / 脚本 / 临时物）"""
    违规 = []
    扫过 = 0
    根 = os.path.join(仓库根, 'yizhi')
    for 目录, _, 文件们 in os.walk(根):
        for f in 文件们:
            扫过 += 1
            if f.startswith('_') or f.endswith(('.log', '.py', '.tmp')):
                违规.append(os.path.relpath(os.path.join(目录, f), 仓库根).replace('\\', '/'))
    if 违规:
        return False, f'发现 {len(违规)} 个过程文件', 违规
    return True, f'扫描 {扫过} 个文件 · 过程文件 0 个', []


# ---------------------------------------------------------------- 乙·线上活着


def 检查_B1():
    """Pages 站点可访问"""
    if not CURL:
        return False, '本机找不到 curl', []
    def 一次():
        r = 跑([CURL, '-s', '--max-time', '15', '-o', os.devnull,
               '-w', '%{http_code}', 页面站], 超时=40)
        码 = r.stdout.strip()
        return 码 == '200', 码
    码, 第 = 重试(3, 2, 一次)
    if 第:
        return True, f'HTTP 200（第 {第} 次尝试）', []
    return False, f'连续 3 次都不是 200（最后：{码}）', []


def 检查_B2():
    """接口健康探针（不连库的存活探针）"""
    if not CURL:
        return False, '本机找不到 curl', []
    def 一次():
        r = 跑([CURL, '-s', '--max-time', '15', '-w', '\n::码=%{http_code}::', 健康接口], 超时=40)
        出 = r.stdout
        m = re.search(r'::码=(\d{3})::', 出)
        if not m:
            return False, '没拿到状态码（网络失败）'
        码 = m.group(1)
        体 = 出[:m.start()].strip()
        if 码 != '200':
            return False, f'HTTP {码}'
        try:
            o = json.loads(体)
        except Exception:
            return False, f'响应不是 JSON：{体[:60]}'
        if o.get('ok') is True and o.get('service') == 'yishou':
            return True, '{"ok":true,"service":"yishou"}'
        return False, f'响应不符预期：{体[:80]}'
    值, 第 = 重试(3, 2, 一次)
    if 第:
        return True, f'{值}（第 {第} 次尝试）', []
    return False, f'连续 3 次失败（最后：{值}）', []


def 检查_B3():
    """CORS 防线双探针 —— Day 24 跨域事故的哨兵"""
    if not CURL:
        return False, '本机找不到 curl', []

    def 取ACAO(origin):
        r = 跑([CURL, '-s', '--max-time', '15', '-o', os.devnull, '-D', '-',
               '-H', 'Origin: ' + origin, 健康接口], 超时=40)
        头 = r.stdout
        好 = r.returncode == 0 and bool(头.strip())
        m = re.search(r'(?im)^access-control-allow-origin:\s*(\S+)', 头)
        return 好, (m.group(1).strip() if m else None)

    值1 = 值2 = None
    for 第 in range(1, 4):
        好1, 值1 = 取ACAO(来源_githubio)
        好2, 值2 = 取ACAO(来源_evil)
        if 好1 and 好2:
            break
        if 第 < 3:
            time.sleep(2)
    else:
        return False, '网络失败：双探针连续 3 次没拿到完整响应', []
    if 值1 != 来源_githubio:
        return False, f'github.io 探针异常：ACAO = {值1!r}（应为 {来源_githubio}）', \
            ['函数侧补位可能丢了 —— 检查台会再次被浏览器拦下']
    if 值2 is not None:
        return False, f'evil 探针异常：居然回了 ACAO = {值2!r}', \
            ['CORS 可能退化成了通配，等于对全部站点开放']
    return True, 'github.io 有 ACAO ✓ · evil 无 ACAO ✓（防线在线）', []


# ---------------------------------------------------------------- 丙·本地发布物


def 检查_C1():
    """五部数据完整性 —— 条数 / id 唯一 / 必填字段"""
    问题 = []
    计数 = []
    所有id = []
    for 文件, 部名, 期望 in 五部期望:
        路径 = os.path.join(仓库根, 'yizhi', 'data', 文件)
        try:
            o = json.load(open(路径, encoding='utf-8'))
            条目 = o['条目']
        except Exception as 因:
            return False, f'{文件} 读不了：{因!r}', []
        计数.append(f'{部名}{len(条目)}')
        if len(条目) != 期望:
            问题.append(f'{文件} 应有 {期望} 条，实际 {len(条目)} 条')
        for 条 in 条目:
            for 键 in ('id', '名', '部'):
                if not 条.get(键):
                    问题.append(f"{文件} 有条目缺「{键}」")
            i = str(条.get('id', ''))
            所有id.append(i)
            if not i.startswith(文件[:-5] + '-'):
                问题.append(f'{i} 前缀与文件 {文件} 对不上')
    if len(所有id) != len(set(所有id)):
        问题.append(f'id 有重复（{len(所有id)} 个里只有 {len(set(所有id))} 个唯一）')
    if not 问题:
        return True, f'{" / ".join(计数)} = {len(所有id)} 条 · id 唯一 · 必填字段齐', []
    return False, f'发现 {len(问题)} 个问题', 问题


def 检查_C2():
    """JS 语法（19 个文件）—— node --check（Node 22 自动识别 ES Module 语法）"""
    if not NODE:
        return False, '本机找不到 node，语法检查无法进行', ['可改 NODE 候选路径或装 node']
    js = []
    for 子 in ('js', os.path.join('js', 'views')):
        目录 = os.path.join(仓库根, 'yizhi', 子)
        js += [os.path.join(目录, f) for f in sorted(os.listdir(目录)) if f.endswith('.js')]
    失败 = []
    for f in js:
        try:
            r = 跑([NODE, '--check', f], 超时=30)
        except Exception as 因:
            r = None
        首行 = ''
        if r is None:
            首行 = 'node 执行失败'
        elif r.returncode != 0:
            首行 = (r.stderr.strip().splitlines() or [''])[0]
        if 首行:
            失败.append(os.path.relpath(f, 仓库根).replace('\\', '/') + '：' + 首行)
    if 失败:
        return False, f'{len(失败)}/{len(js)} 个文件有语法错', 失败
    return True, f'{len(js)}/{len(js)} 个 JS 无语法错', []


def 检查_C3():
    """引用无悬空 —— html 引的 / js 导入的 / 数据文件 / 配图双向对齐"""
    悬空 = []
    计数 = {'html': 0, 'js': 0, 'data': 0, '图': 0}
    页 = os.path.join(仓库根, 'yizhi', 'index.html')
    html = open(页, encoding='utf-8').read()
    for m in re.finditer(r'(?:href|src)="([^"]+)"', html):
        值 = m.group(1)
        if 值.startswith(('http://', 'https://', '#', 'data:', 'mailto:')):
            continue
        计数['html'] += 1
        if 值.startswith('/'):
            悬空.append(f'index.html → {值}（绝对路径，Pages 子路径部署会 404）')
            continue
        目标 = os.path.normpath(os.path.join(os.path.dirname(页), 值))
        if not os.path.isfile(目标):
            悬空.append(f'index.html → {值}')
    js文件 = []
    for 子 in ('js', os.path.join('js', 'views')):
        目录 = os.path.join(仓库根, 'yizhi', 子)
        js文件 += [os.path.join(目录, f) for f in sorted(os.listdir(目录)) if f.endswith('.js')]
    for f in js文件:
        文本 = open(f, encoding='utf-8').read()
        for m in re.finditer(r"""(?:from|import)\s*['"](\.[^'"]+)['"]""", 文本):
            引用 = m.group(1)
            计数['js'] += 1
            目标 = os.path.normpath(os.path.join(os.path.dirname(f), 引用))
            if not os.path.isfile(目标):
                悬空.append(os.path.relpath(f, 仓库根).replace('\\', '/') + ' → ' + 引用)
    for 名 in ('shenxian', 'shenhua', 'yishou', 'yaoguai', 'jingjie'):
        计数['data'] += 1
        if not os.path.isfile(os.path.join(仓库根, 'yizhi', 'data', 名 + '.json')):
            悬空.append(f'data/{名}.json 不存在')
    异兽 = json.load(open(os.path.join(仓库根, 'yizhi', 'data', 'yishou.json'), encoding='utf-8'))
    图值 = set()
    for 条 in 异兽['条目']:
        v = 条.get('图')
        if not v:
            悬空.append(f'{条.get("id")} 缺「图」字段')
            continue
        图值.add(v)
        计数['图'] += 1
        if not os.path.isfile(os.path.join(仓库根, 'yizhi', 'assets', v + '.webp')):
            悬空.append(f'{v} 的图 assets/{v}.webp 不存在')
    资产目录 = os.path.join(仓库根, 'yizhi', 'assets')
    for f in sorted(os.listdir(资产目录)):
        if f.endswith('.webp') and f[:-5] not in 图值:
            悬空.append(f'孤儿图 assets/{f}（没有条目引用）')
    if 悬空:
        return False, f'发现 {len(悬空)} 处悬空', 悬空
    摘要 = 'html {} · js 导入 {} · data {} · 图 {}×2（正反双向）'.format(
        计数['html'], 计数['js'], 计数['data'], 计数['图'])
    return True, '全部解析命中：' + 摘要, []


def 检查_C4():
    """发布内容预演 —— 用 Pages workflow 同款排除规则本地模拟 _site，白名单核对"""
    if not GIT:
        return False, '本机找不到 git，无法列发布清单', []
    r = git('ls-files', '-z', '--', 'yizhi')
    跟踪 = [x for x in r.stdout.split('\x00') if x.strip()]
    发布, 排除 = [], []
    for p in 跟踪:
        部位 = p.split('/')[1:]  # 去掉 'yizhi' 前缀
        被排 = False
        for 段 in 部位[:-1]:
            if 段.startswith('_') or 段 in ('预览', 'assets-private'):
                被排 = True
        尾 = 部位[-1]
        if 尾.startswith('_') or 尾.endswith('.md'):
            被排 = True
        (排除 if 被排 else 发布).append(p)
    问题 = []
    if 'yizhi/index.html' not in 发布:
        问题.append('发布清单里没有 index.html —— 组装逻辑出错了')
    # 注意：用 endswith 判后缀，不能用 os.path.splitext —— 它会把 .gitkeep 这类
    # 点开头的文件名当成「无后缀」，导致误报（冒烟首跑实测踩到）。
    可疑 = [p for p in 发布
           if not any(p.lower().endswith(s) for s in 发布白名单后缀)]
    if 可疑:
        问题.append(f'有 {len(可疑)} 个白名单外的文件会被发布（若有意新增类型，同步更新白名单）')
    if 问题:
        return False, f'发布清单 {len(发布)} 个文件，有可疑项', 问题 + ['可疑：' + '、'.join(可疑[:10])]
    例 = '、'.join(os.path.basename(p) for p in 排除[:3])
    摘要 = f'将发布 {len(发布)} 个文件（白名单核对过）· 已排除 {len(排除)} 个（如 {例}）'
    分类 = {}
    for p in 发布:
        尾 = p.rsplit('.', 1)[-1].lower()
        分类[尾] = 分类.get(尾, 0) + 1
    构成 = ' · '.join(f'{k} {v}' for k, v in sorted(分类.items()))
    return True, 摘要, [f'发布构成：{构成}']


# ---------------------------------------------------------------- 附注：git 工作区


def 附注_工作区():
    行 = []
    if not GIT:
        return {'未提交数': None, '明细': ['本机找不到 git']}
    r = git('status', '--porcelain', '-z')
    条目 = [x for x in r.stdout.split('\x00') if x.strip()]
    明细 = []
    敏感的 = [x for x in 条目 if re.search(r'(?i)(\.env|credential|secret|\.pem)', x)]
    for x in 条目[:8]:
        明细.append(x)
    return {'未提交数': len(条目), '明细': 明细, '敏感名': 敏感的}


# ---------------------------------------------------------------- 演练（自证不虚报）


def 演练():
    """往 station.js 临时注入一行假密钥 → A1 必须 FAIL → 恢复（字节级校验）→ A1 必须 PASS。
    假密钥由运行时拼接，脚本源码里不含可被扫描命中的完整串。"""
    目标 = os.path.join(仓库根, 'yizhi', 'js', 'station.js')
    if not os.path.isfile(目标):
        print('!! 找不到注入目标 yizhi/js/station.js')
        return 2
    标记 = '<<<verify-project-演练>>>'
    假密钥 = 'sk-' + 'demoFAKE' + '1234567890' + 'abcdefghij'
    注入行 = '\n// ' + 标记 + ' 演示用假密钥（脚本会自动恢复，勿提交）：' + 假密钥 + '\n'

    print('══ 演练：证明「检查不会虚报通过」══')
    print('   动作：往 yizhi/js/station.js 注入一行假密钥 → A1 应该红 → 恢复 → A1 应该绿')
    print()
    原 = open(目标, 'rb').read()
    意外 = []
    try:
        with open(目标, 'ab') as f:
            f.write(注入行.encode('utf-8'))
        print('[1/4] 已注入假密钥 → yizhi/js/station.js')
        好, 证据, 详情 = 检查_A1()
        if 好:
            意外.append('注入后 A1 居然还是 PASS —— 检查链路会虚报通过！')
            print('[2/4] 跑 A1 ... 仍然 PASS ❌ 不符合预期')
        else:
            print(f'[2/4] 跑 A1 ... [FAIL] {证据} ✅ 符合预期（被抓出来了）')
            for d in 详情[:3]:
                print(f'        {d}')
    finally:
        with open(目标, 'wb') as f:
            f.write(原)
        复 = open(目标, 'rb').read()
        if 复 == 原:
            print('[3/4] 已恢复原样（字节级校验一致）✅')
        else:
            print('[3/4] ！！恢复失败，请人工检查 yizhi/js/station.js ❌')
            return 2
    好, 证据, 详情 = 检查_A1()
    if not 好:
        意外.append('恢复后 A1 还是 FAIL —— 恢复没干净或环境本来就脏')
        print(f'[4/4] 复跑 A1 ... [FAIL] {证据} ❌ 不符合预期')
    else:
        print(f'[4/4] 复跑 A1 ... [PASS] {证据} ✅')
    print()
    if 意外:
        print('结论：演练有问题 ❌ ' + '；'.join(意外))
        return 1
    print('结论：检查链路「脏了会红、干净才绿」—— 不虚报通过 ✅')
    return 0


# ---------------------------------------------------------------- 主流程


检查项 = [
    ('A1', '密钥扫描', 检查_A1),
    ('A2', '敏感路径忽略', 检查_A2),
    ('A3', '站点目录卫生', 检查_A3),
    ('B1', 'Pages 站点可访问', 检查_B1),
    ('B2', '接口健康探针', 检查_B2),
    ('B3', 'CORS 防线双探针', 检查_B3),
    ('C1', '五部数据完整性', 检查_C1),
    ('C2', 'JS 语法', 检查_C2),
    ('C3', '引用无悬空', 检查_C3),
    ('C4', '发布内容预演', 检查_C4),
]


def 主():
    参 = sys.argv[1:]
    if '--演练' in 参:
        sys.exit(演练())
    标签 = ''
    if '--标签' in 参:
        i = 参.index('--标签')
        if i + 1 < len(参):
            标签 = '-' + 参[i + 1]

    现在 = time.strftime('%Y-%m-%d %H:%M:%S')
    print('═' * 56)
    print(' 发布前检查（verify-project）· 异兽志')
    print(' 时间：' + 现在)
    print(' 仓库：' + 仓库根)
    print('═' * 56)
    print()

    结果 = []
    for 编号, 名称, 函数 in 检查项:
        起 = time.time()
        try:
            通过, 证据, 详情 = 函数()
        except Exception as 因:
            通过, 证据, 详情 = False, f'检查器自身出错：{因!r}', []
        耗时 = time.time() - 起
        标记 = '[PASS]' if 通过 else '[FAIL]'
        print(f'{标记} {编号} {名称} —— {证据}  ({耗时:.1f}s)')
        for d in 详情:
            print('        · ' + str(d))
        结果.append({'编号': 编号, '名称': 名称, '通过': 通过,
                    '状态': 'PASS' if 通过 else 'FAIL', '证据': 证据,
                    '详情': [str(x) for x in 详情]})

    附注 = 附注_工作区()
    print()
    print('···· 附注（不判定，只看一眼）····')
    未提交 = 附注['未提交数']
    if 未提交 is None:
        print(' git 工作区：拿不到（' + '；'.join(附注['明细']) + '）')
    elif 未提交 == 0:
        print(' git 工作区：干净，无未提交改动')
    else:
        print(f' git 工作区：{未提交} 个未提交条目（提交前逐条核对）')
        for x in 附注['明细'][:5]:
            print('   ' + x.replace('\x00', ' '))
    if 附注.get('敏感名'):
        print(' ！未提交里出现敏感名：' + '、'.join(附注['敏感名'][:3]))

    通过数 = sum(1 for r in 结果 if r['通过'])
    总 = len(结果)
    print()
    print('═' * 56)
    if 通过数 == 总:
        print(f' 总结：{通过数}/{总} 通过 —— 全绿，可以发布。')
    else:
        print(f' 总结：{通过数}/{总} 通过 —— 有 {总 - 通过数} 项失败，先修好再发。')
    print('═' * 56)

    记录 = {
        '工具': 'verify-project（发布前检查）',
        '时间': 现在,
        '仓库': 仓库根,
        '结果': {'通过': 通过数, '总数': 总, '全绿': 通过数 == 总},
        '项': 结果,
        '附注': 附注,
    }
    try:
        目录 = os.path.join(仓库根, 'tools', '自检记录')
        os.makedirs(目录, exist_ok=True)
        路径 = os.path.join(目录, time.strftime('%Y-%m-%d') + '-发布前检查' + 标签 + '.json')
        with open(路径, 'w', encoding='utf-8') as f:
            json.dump(记录, f, ensure_ascii=False, indent=2)
        print('记录已写入：' + os.path.relpath(路径, 仓库根).replace('\\', '/'))
    except Exception as 因:
        print(f'！记录写入失败（不挡检查结果）：{因!r}')

    sys.exit(0 if 通过数 == 总 else 1)


if __name__ == '__main__':
    主()
