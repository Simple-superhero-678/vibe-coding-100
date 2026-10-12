#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
密钥特征词扫描（Day 23 建立，配套 tools/安全自查清单.md）

作用：一条命令回答「仓库里有没有真实密钥」。
用法：
    python tools/scan-secrets.py              # 扫仓库（git 跟踪文件）—— 上线判据用这个
    python tools/scan-secrets.py --全工作区     # 连被 .gitignore 的文件一起扫（宁多勿漏）

设计要点（都是踩过坑之后的防呆）：
  ⭐ 自带阳性对照：先拿假密钥验证正则真能命中；对照不过 → 直接判「本次扫描不可信」，
     绝不允许一个写坏的正则给出「0 条 = 干净」的假结论。
  ⭐ 用 `git ls-files -z`（原始字节）而不是 `git ls-files`：
     后者会把中文文件名转义成 \344\275… 八进制，导致「文件根本打不开、静默跳过」——
     实测一个 128 文件的仓库有 51 个中文名文件被跳过（40%），而输出看起来一切正常。
  ⭐ 跳过多少文件都要报出来。**静默跳过 = 假干净**。
  ⭐ 命中里含 < > … xxx 这类标记的算「占位符」，单独列，不当成真密钥（.env.example 必然有）。
"""
import os
import re
import subprocess
import sys
import time

# 密钥特征词（真密钥"值"的形态；不含 TCB_API_KEY 这类变量名引用）
模式 = re.compile(
    r"(sk-[A-Za-z0-9]{20,}"                                   # OpenAI 风格
    r"|AKID[A-Za-z0-9]{10,}"                                  # 腾讯云 SecretId 风格
    r"|postgres(ql)?://[^/@\s\"']+:[^/@\s\"']+@"              # 带账号密码的连接串
    r"|Bearer\s+[A-Za-z0-9_.\-]{24,}"                          # 长 Bearer token
    r"|(secret[_-]?id|secret[_-]?key|apikey|api[_-]?key|passwd|password|session[_-]?token)"
    r"\"?\s*[:=]\s*\"[A-Za-z0-9_+/.=\-]{16,}\")"              # xxx_key = "很长的一串"
)

# 参考判据：JWT 形态（eyJ…）。它会大量命中「浏览器扩展的校验元数据」，所以只作参考、不进主判据
JWT = re.compile(r"eyJ[A-Za-z0-9_\-]{30,}")

# 二进制扩展名（不按文本读）
跳过扩展 = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2',
        '.ttf', '.db', '.zip', '.pdf', '.mp4', '.hyb'}

# 占位符标记：命中里带这些字符 = 说明书里的示例，不是真密钥
占位符标记 = ('<', '>', '…', 'xxx', 'XXX', '****', '填', '你的')


def 阳性对照():
    """先用假密钥验证正则能命中——防「正则写坏 → 假干净」"""
    假样本 = [
        'sk-' + 'A' * 24,
        'AKID' + 'B' * 15,
        'postgresql://user:Pa55w0rd@host:5432/db',
        'Bearer ' + 'C' * 30,
        'secret_key = "' + 'D' * 20 + '"',
    ]
    return sum(1 for s in 假样本 if 模式.search(s)), len(假样本)


def 读文本(路径):
    """返回 ('ok', 文本) / ('二进制', None) / ('失败', None)"""
    try:
        with open(路径, 'rb') as f:
            头 = f.read(1024)
        if b'\x00' in 头:
            return '二进制', None
        with open(路径, 'r', encoding='utf-8', errors='replace') as f:
            return 'ok', f.read()
    except Exception:
        return '失败', None


def 扫(路径列表):
    """返回 (已扫, 凭据命中[(路径,命中原文)], 占位符命中[路径], jwt命中[路径], 跳过统计)"""
    自己 = os.path.abspath(__file__)
    凭据, 占位符, jwt, 已扫 = [], [], [], 0
    跳过 = {'扩展名(二进制)': 0, '含NUL二进制': 0, '体积超限': 0, '读取失败': 0, '扫描器自身': 0}
    for p in 路径列表:
        if os.path.abspath(p) == 自己:
            跳过['扫描器自身'] += 1
            continue
        if os.path.splitext(p)[1].lower() in 跳过扩展:
            跳过['扩展名(二进制)'] += 1
            continue
        try:
            if os.path.getsize(p) > 4 * 1024 * 1024:
                跳过['体积超限'] += 1
                continue
        except Exception:
            跳过['读取失败'] += 1
            continue
        状态, t = 读文本(p)
        if 状态 == '二进制':
            跳过['含NUL二进制'] += 1
            continue
        if 状态 == '失败':
            跳过['读取失败'] += 1
            continue
        已扫 += 1
        m = 模式.search(t)
        if m:
            if any(k in m.group(0) for k in 占位符标记):
                占位符.append(p)
            else:
                凭据.append((p, m.group(0)[:80]))
        if JWT.search(t):
            jwt.append(p)
    return 已扫, 凭据, 占位符, jwt, 跳过


def 仓库文件():
    # -z：用 NUL 分隔的原始字节，绕开中文名转义（详见文件头 ⭐）
    r = subprocess.run(['git', 'ls-files', '-z'], capture_output=True)
    if r.returncode != 0:
        print('!! 不是 git 仓库，或 git 不可用')
        sys.exit(2)
    return [x for x in r.stdout.decode('utf-8', 'replace').split('\x00') if x.strip()]


def 工作区文件():
    应跳过 = {'.git', 'node_modules'}
    出 = []
    for 根, 目录, 文件 in os.walk('.'):
        目录[:] = [d for d in 目录 if d not in 应跳过]
        for f in 文件:
            出.append(os.path.join(根, f))
    return 出


def 主():
    全工作区 = '--全工作区' in sys.argv
    print('=' * 62)
    print(' 密钥特征词扫描 · 异兽志（vibe coding打卡学习）')
    print(' 时间：' + time.strftime('%Y-%m-%d %H:%M:%S'))
    print(' 范围：' + ('全工作区（含被 .gitignore 忽略的文件）' if 全工作区 else '仓库（git 跟踪文件）'))
    print('=' * 62)

    通过, 总数 = 阳性对照()
    print(f'[0] 阳性对照（正则必须能命中假密钥）...... {通过}/{总数} ' +
          ('✅ 正则可信' if 通过 == 总数 else '❌ 正则有问题，本次结果不可信！'))
    if 通过 != 总数:
        sys.exit(3)

    文件 = 工作区文件() if 全工作区 else 仓库文件()
    已扫, 凭据, 占位符, jwt, 跳过 = 扫(文件)
    print(f'[1] 候选文件 .......................... {len(文件)} 个')
    print(f'    实际扫描文本 ...................... {已扫} 个')
    print(f'    跳过（逐类报出，不许静默）.......... ' +
          '，'.join(f'{k} {v} 个' for k, v in 跳过.items() if v))
    print(f'[2] 密钥特征词命中 ..................... {len(凭据)} 条 ' +
          ('✅' if not 凭据 else '❌ 需要处理！'))
    for p, s in 凭据[:20]:
        print(f'        {p}   ← {s}')
    if 占位符:
        print(f'    （占位符命中 {len(占位符)} 处，不算密钥）: ' + '，'.join(占位符[:5]))
    print(f'[3] 参考：JWT 形态（eyJ…）文件数 ......... {len(jwt)} 个')
    if jwt:
        print('        （多为浏览器缓存的扩展校验元数据，非密钥；确认方法见 tools/安全自查清单.md）')
    print('-' * 62)
    if 凭据:
        print('结论：发现疑似密钥，请逐条核实来源与是否有效。')
        sys.exit(1)
    print('结论：未发现任何真实密钥。' + ('（全工作区）' if 全工作区 else '（仓库）'))
    sys.exit(0)


if __name__ == '__main__':
    主()
