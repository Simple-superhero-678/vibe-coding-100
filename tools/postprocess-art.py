#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""异兽志 · 出图后处理（M2 批量出图专用）

为什么需要这个脚本
------------------
出图通道有三个绕不过去的毛病，每张图都得修一遍，手工修 12 张必出错：

  1. 出不了 3:4 —— 通道只给 1:1 / 2:3 / 3:2。我们出 2:3，再自下裁到精确 3:4。
  2. 纸底不对   —— 生成图自带的纸底偏暗偏黄（实测约 (204,186,167)），
                   而设计令牌的宣纸色是 #F4EFE4。不处理就直接贴卡片，
                   每张图都会变成卡片上的一块深色"补丁"。
  3. 自带水印   —— 右下角有出图工具的水印，裁底部 11.1% 时正好一并去掉。

处理三步
--------
  ① 裁到精确 3:4（自下裁；顺带裁掉水印与过量的下方留白）
  ② 纸底对齐：逐通道线性映射到设计令牌的宣纸色（最深墨保持不动，主体不被冲淡）
  ③ 统一规格：默认输出 900×1200 webp，文件名 = 条目 id

用法
----
  # 单张，指定输出名（正式入库用）
  python tools/postprocess-art.py 原图.png --name yishou-001 -o yizhi/assets

  # 整目录批处理（输出名 = 源文件名）
  python tools/postprocess-art.py 原图目录/ -o yizhi/assets

  # 保留原始尺寸、输出 png（样图预览用）
  python tools/postprocess-art.py 原图.png --png -o yizhi/预览/样图

依赖：Pillow
"""

import argparse
import re
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("缺少 Pillow。请用已装 pillow 的解释器运行，或先 pip install pillow")

# 设计令牌里的宣纸色（兜底值；查到 tokens.css 时以 tokens.css 为准）
FALLBACK_PAPER = (244, 239, 228)
TARGET_RATIO = 3 / 4          # 竖构 3:4
DEFAULT_SIZE = (900, 1200)    # 落地规格
INK_PERCENTILE = 0.01         # 取 1% 分位当"最深墨"
PAPER_BAND = 0.06             # 取顶部 6% 空白带测纸底
EXTS = {".png", ".jpg", ".jpeg", ".webp"}


def read_paper_color(tokens_css: Path):
    """从 tokens.css 读 --paper，保持"单一真源"。读不到就用兜底值。"""
    if not tokens_css.exists():
        return FALLBACK_PAPER, "兜底值"
    m = re.search(r"--paper:\s*#([0-9A-Fa-f]{6})", tokens_css.read_text(encoding="utf-8"))
    if not m:
        return FALLBACK_PAPER, "兜底值"
    h = m.group(1)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)), "tokens.css"


def make_lut(bg_c: int, ink_c: int, tgt_c: int):
    """单通道映射表：<= 最深墨的像素不动；纸底以上的像素线性拉到目标色。"""
    span = max(bg_c - ink_c, 1)
    slope = (tgt_c - ink_c) / span
    lut = []
    for v in range(256):
        if v <= ink_c:
            lut.append(v)
        else:
            lut.append(min(255, max(0, round(ink_c + (v - ink_c) * slope))))
    return lut


def _channels(img: Image.Image):
    """返回 (r, g, b) 三个 bytes。用 tobytes 而非 getdata，避免 Pillow 弃用告警。"""
    b = img.tobytes()
    return b[0::3], b[1::3], b[2::3]


def mean_rgb(img: Image.Image):
    r, g, b = _channels(img)
    n = len(r) or 1
    return (sum(r) // n, sum(g) // n, sum(b) // n)


def darkest_percentile(img: Image.Image, pct: float):
    """逐像素取三通道最小值，再取分位——代表"画面里最深的墨"。"""
    r, g, b = _channels(img)
    mv = r
    for ch in (g, b):
        mv = bytes(map(min, mv, ch))
    s = sorted(mv)
    return s[int(len(s) * pct)]


def process(src: Path, dst: Path, paper, keep_size: bool, out_size, report):
    im = Image.open(src).convert("RGB")
    w, h = im.size
    report(f"[{src.name}] 原图 {w}x{h}  比例 {w / h:.3f}")

    # ---- ① 裁到精确 3:4 ----
    crop_note = "比例已达标，未裁切"
    if w / h < TARGET_RATIO:                 # 太瘦长 → 自下裁
        target_h = round(w / TARGET_RATIO)
        cut = h - target_h
        im = im.crop((0, 0, w, target_h))
        crop_note = f"自下裁掉 {cut}px（{cut / h * 100:.1f}%）"
    elif w / h > TARGET_RATIO:               # 太宽 → 自右裁
        target_w = round(h * TARGET_RATIO)
        cut = w - target_w
        im = im.crop((0, 0, target_w, h))
        crop_note = f"自右裁掉 {cut}px（{cut / w * 100:.1f}%）"
    report(f"  ① 裁切：{crop_note} → {im.width}x{im.height}  比例 {im.width / im.height:.3f}")

    # ---- ② 纸底对齐 ----
    bg = mean_rgb(im.crop((0, 0, im.width, int(im.height * PAPER_BAND))))
    ink = darkest_percentile(im, INK_PERCENTILE)
    luts = [make_lut(bg[i], ink, paper[i]) for i in range(3)]
    im = Image.merge("RGB", [ch.point(luts[i]) for i, ch in enumerate(im.split())])
    bg2 = mean_rgb(im.crop((0, 0, im.width, int(im.height * PAPER_BAND))))
    report(f"  ② 对齐：纸底 {bg} → {bg2}  目标 {paper}  差值 {tuple(bg2[i] - paper[i] for i in range(3))}"
           f"（最深墨 {ink} 保持不动）")

    # ---- ③ 输出 ----
    if not keep_size:
        im = im.resize(out_size, Image.LANCZOS)
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.suffix.lower() == ".webp":
        im.save(dst, "WEBP", quality=92, method=6)
    else:
        im.save(dst)
    report(f"  ③ 输出：{dst}  {im.width}x{im.height}  {dst.stat().st_size / 1024:.0f} KB")
    report(f"  台账行：| {dst.name} | AI生成 | {src.name} | 纸底已对齐 #{'%02X%02X%02X' % paper} | 待验收 |")
    return True


def main():
    ap = argparse.ArgumentParser(description="异兽志出图后处理：裁 3:4 + 纸底对齐 + 统一规格")
    ap.add_argument("src", help="源图文件或目录")
    ap.add_argument("-o", "--out", default="yizhi/assets", help="输出目录（默认 yizhi/assets）")
    ap.add_argument("--name", help="单文件模式下的输出名（不含扩展名），填条目 id 如 yishou-001")
    ap.add_argument("--png", action="store_true", help="保留原始尺寸并输出 png（样图预览用）")
    ap.add_argument("--size", default="900x1200", help="输出尺寸，默认 900x1200（仅 webp 模式生效）")
    ap.add_argument("--tokens", default=None, help="tokens.css 路径，默认按脚本位置推断")
    args = ap.parse_args()

    root = Path(__file__).resolve().parent.parent
    tokens = Path(args.tokens) if args.tokens else root / "yizhi" / "css" / "tokens.css"
    paper, src_note = read_paper_color(tokens)
    if args.png:
        keep_size, out_size, ext = True, None, ".png"
    else:
        keep_size = False
        ext = ".webp"
        w, h = (int(x) for x in args.size.lower().split("x"))
        out_size = (w, h)

    out_dir = Path(args.out)
    src = Path(args.src)

    print(f"宣纸色 {'#%02X%02X%02X' % paper}（来源：{src_note}）  输出格式 {ext}"
          f"{'（原始尺寸）' if keep_size else f' {out_size[0]}x{out_size[1]}'}  输出目录 {out_dir}")

    files = []
    if src.is_dir():
        files = sorted(p for p in src.iterdir() if p.suffix.lower() in EXTS)
        if not files:
            sys.exit(f"目录里没有可处理的图片：{src}")
        jobs = [(f, out_dir / (args.name if args.name else f.stem)) for f in files]
    else:
        if not src.exists():
            sys.exit(f"找不到源图：{src}")
        jobs = [(src, out_dir / (args.name if args.name else src.stem))]

    ok = 0
    for f, stem in jobs:
        process(f, stem.with_suffix(ext), paper, keep_size, out_size, print)
        ok += 1
    print(f"完成 {ok}/{len(jobs)} 张")
    print("提醒：图已产出，但入 Git 前请先确认 assets/SOURCES.md 台账已登记。")


if __name__ == "__main__":
    main()
