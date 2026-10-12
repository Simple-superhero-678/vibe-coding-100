# Day 24 · 核心流程测试清单（检查台全链路 · 前后对照）

> 生成：2026-10-12（Day 24 · 板块①）｜项目：异兽志 · 前端检查台 + `public.favorites`
>
> **课程模板链路 → 本项目映射**
> 「打开检查台 → 读取 plan_days/checkins → 写入打卡 → 刷新确认 → 修改 → 删除」
> 　=　「打开检查台 → 读 favorites 表 → 写一条收藏 → 刷新确认 → PATCH 改备注 → DELETE 取消收藏」
>
> **用法**：同一份清单跑两遍（修复前 / 修复后），结果填「前」「后」两栏，证据文件各存一份。
> 本次「修复前」已跑（§七 有完整记录）；「修复后」在修复完成当天重跑（§八 待填）。

---

## 〇、环境矩阵

| 代号 | 环境 | 地址 | 备注 |
|---|---|---|---|
| E1 | GitHub Pages 站（主发布渠道） | `https://simple-superhero-678.github.io/vibe-coding-100/` | workflow 自动发布，无中间页 |
| E2 | CloudBase 静态站 | `https://yishou-d9gyoykka49fb0634-1501173044.tcloudbaseapp.com/cbsite/` | 有「页面访问提示」中间页：点「确定访问」 |
| E3 | 本机调试 | 本机起服务后 `http://127.0.0.1:<端口>/` | 起服务方法见 `tools/回归/README.md`；本轮未跑（对照由 E2 承担） |

---

## 一、六步链路（每步：怎么做 → 期望 → 修复前 → 修复后）

### 1 · 打开检查台

- 做法：打开首页，看 `#检查台` 区块（页面顶部）。
- 期望：区块出现；三格先「读取中…」再落定（不会长期停住）。
- **修复前：E1 区块在、两格红字**（详见 §七）；E2 正常。
- 修复后：（待填）

### 2 · 读取（健康 + favorites 表）

- 做法：看两格文本；另用 curl 对 `GET /api/favorites?user_id=…` 数 total 对账。
- 期望：健康格「服务正常（yishou）」；favorites 格「N 行真实数据 · 含：…」；N 与接口一致。
- **修复前：E1 两格均「读不到：连不上接口（网络或服务没响应）」；E2「服务正常（yishou）+ 18 行真实数据」（对照通过）**。
- 修复后：（待填）

### 3 · 写入（写一条进收藏表）

- 做法：点「写一条进收藏表」；**再点一次**。
- 重置（想看首次 201 就先删测试行）：见 §三 速查表的 `Req DELETE`。
- 期望：首次「201 · 写进去了…」；再点「409 · 接口拦下了重复写入（唯一约束在工作）」。
- **修复前：E1 点击即「写入失败：连不上接口（网络或服务没响应）」；E2 点击得 409（POST 链路完好的设计内证据）**。
- 修复后：（待填）

### 4 · 刷新确认

- 做法：F5 整页刷新 → 看 favorites 格；或重跑 §三 的 `Req GET` 看 total。
- 期望：数字 = 写入后的总数（写进去的读得出来），不回退。
- **修复前：E1 不可测（读取本身被拦）；E2 刷新读数正常**。
- 修复后：（待填）

### 5 · 修改（PATCH 改备注）

- 做法：检查台 UI 暂无此入口 → 命令行 PATCH（§三 速查表）。
- 期望：HTTP 200；响应体里 `remark` 回显 = 所写内容（列表接口只回 id+时间，备注要看 PATCH 响应或数据库）。
- **修复前：接口层可达（与浏览器无关）；浏览器侧无 UI 入口（记录在案）**。
- 修复后：（待填）

### 6 · 删除（DELETE 取消收藏）→ 删完再读

- 做法：命令行 DELETE；**再删一次**；再 GET 看 total 回落。
- 期望：200 `{"ok":true,"data":{"removed":true}}`；再删 404 `FAV_NOT_FOUND`（幂等）；total 回落。
- **修复前：接口层可达；浏览器侧无 UI 入口（记录在案）**。
- 修复后：（待填）

---

## 二、刁钻输入用例（目标：把「藏得深」的问题逼出来）

| # | 用例 | 输入 | 期望 | 修复前 | 修复后 |
|---|---|---|---|---|---|
| 1 | 空值 | `POST {}` | 400 + 点名 entry_id | 接口层已验（400） | ✅ 400 +「缺少必填字段：entry_id」 |
| 2 | 空白串 | `{"entry_id":"   "}` | 400 +「不能为空」 | 接口层已验（400） | ✅ 400 +「不能为空」 |
| 3 | 超长 | entry_id 65 字；remark 501 字 | 400 + 中文提示收到多少字 | 接口层已验（400） | ✅ 400（「收到 65 个 / 收到 501 个」） |
| 4 | 特殊字符 | remark 含引号 / 换行 / emoji | 200 存得进 | 待跑 | ✅ 200 原样存（「引号」🌟\n 都在） |
| 5 | **快速连点** | 写入按钮连点 ×2 | 不堆垃圾行 + 日志不误导 | ⚠️ 日志可能误报（见 §九-2） | 未修（记录 §九-2，待后续） |
| 6 | 陌生来源 | `Origin: https://evil.com` 打接口 | 无 CORS 头（白名单 ≠ 通配） | ✅ 无头（符合预期） | ✅ 仍无头（修复后复测） |

> 修复后实测原文：`tmp/day24-验证/修复后-刁钻输入.txt`

---

## 三、命令行速查（PowerShell · 本机实测口径）

```powershell
# —— 一次性准备 ——
$API = 'https://yishou-d9gyoykka49fb0634-1501173044.ap-shanghai.app.tcloudbase.com'
$UID = '11111111-1111-4111-8111-111111111111'
$C   = "$API/api/favorites?user_id=$UID"                  # 集合端点：GET 读 / POST 写
$I   = "$API/api/favorites/yishou-station?user_id=$UID"   # 单项端点（测试行固定用它）：PATCH 改 / DELETE 删

# 通用请求器（PowerShell 里 curl 传 JSON 会被吃引号，统一用它）
function Req($m, $u, $b) {
  try {
    $p = @{ Uri = $u; Method = $m; UseBasicParsing = $true }
    if ($b) { $p['ContentType'] = 'application/json'; $p['Body'] = $b }
    $r = Invoke-WebRequest @p
    "HTTP " + $r.StatusCode; $r.Content
  } catch {
    "HTTP " + $_.Exception.Response.StatusCode.value__
    (New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd()
  }
}

# —— 六步链路 ——
Req GET    $C                                       # 读：看 total
Req DELETE $I                                       # 重置：先清测试行（404 = 本来没有，也算重置完成）
Req POST   $C '{"entry_id":"yishou-station"}'       # 写：首次 201；再跑一次 409
Req GET    $C                                       # 刷新确认：total +1
Req PATCH  $I '{"remark":"Day24 全链路测试备注"}'    # 改：200，remark 回显
Req DELETE $I                                       # 删：200 {removed:true}；再删 404（幂等）
Req GET    $C                                       # 删后：total 回落

# —— 刁钻输入（§二）——
Req POST $C '{}'                                    # → 400
Req POST $C '{"entry_id":"   "}'                    # → 400
Req POST $C ('{"entry_id":"' + ('x' * 65) + '"}')   # → 400（超长）
Req PATCH $I ('{"remark":"' + ('x' * 501) + '"}')   # → 400（超长备注）
```

**跨域白名单三探针（curl · 30 秒 · 发布后必跑）**：

```bash
API='https://yishou-d9gyoykka49fb0634-1501173044.ap-shanghai.app.tcloudbase.com'
curl -s -D - -o /dev/null -H 'Origin: https://simple-superhero-678.github.io' "$API/api/health"
curl -s -D - -o /dev/null -H 'Origin: https://yishou-d9gyoykka49fb0634-1501173044.tcloudbaseapp.com' "$API/api/health"
curl -s -D - -o /dev/null -H 'Origin: https://evil.com' "$API/api/health"
# 断言：第 1、2 条响应头应含 access-control-allow-origin；第 3 条不得含（白名单不是通配）
```

---

## 四、问题反馈格式（对齐课程模板，字面照抄用）

```
【现象】        （一句话，先写「哪个环境、哪一格」）
【复现步骤】    （1. 2. 3.，每步都能被别人复现）
【报错原文】    （从 F12 控制台 / 响应头逐字抄，不改写）
【已尝试动作】  （刷新 / 换环境 / 换浏览器档案 / curl 对照……都试过什么）
```

填好后进入 §五 的诊断路径。

---

## 五、诊断路径（Day 24 模板）

**① 原因排序 → ② 每个原因的验证方法 → ③ 修复方案 → ④ 回归验证清单**

实例见 §七：六条候选原因逐一排除，只留一条。以后任何「页面坏 / 接口坏」都照这四段走。

---

## 六、证据文件（修复前 · 2026-10-12）

| 文件 | 内容 |
|---|---|
| `tmp/day24-验证/E1-github.io-修复前-console.txt` | **E1 浏览器控制台原文（CORS 报错逐字）** |
| `tmp/day24-验证/E1-github.io-修复前-摘要.txt` / `.json` | E1 检查台文本 / 写入日志 / 请求 host |
| `tmp/day24-验证/E1-github.io-修复前.png` | E1 检查台红字截图（无头取证，交作业图另由真浏览器截） |
| `tmp/day24-验证/E1-github.io-修复前-首页DOM.html` | E1 渲染后 DOM 全量 |
| `tmp/day24-验证/E2-cbsite-修复前-*` | E2 对照全套（读✅ 写✅ 的现场） |
| `tmp/day24-验证/E0-响应头对照-GET.txt` / `-OPTIONS.txt` | **curl 三来源响应头对照（锁定真原因的关键证据）** |

自动化取证脚本：`tmp/day24-capture.cjs`（CDP 直连：导航 → 等检查台落定 → 点写入 → 收控制台 → 截图，一条命令）。

---

## 七、修复前实测记录（2026-10-12）—— 锁定：E1 跨域白名单未放行

### ① 现象

E1 站「检查台」两格红字「读不到：连不上接口（网络或服务没响应）」+ 重试按钮；点「写一条进收藏表」红字「写入失败：连不上接口（网络或服务没响应）」。**E2 站同代码一切正常。**

### ② 复现步骤

1. 浏览器打开 E1 首页 → 等 3 秒；
2. 检查台两格红字（读失败）；
3. F12 → 控制台 → 3 条红色 CORS 报错（原文见 ③）；
4. 点写入按钮 → 红字（预检失败原文见 ③）。

### ③ 报错原文（逐字）

```
（health 读）
Access to fetch at 'https://yishou-d9gyoykka49fb0634-1501173044.ap-shanghai.app.tcloudbase.com/api/health'
from origin 'https://simple-superhero-678.github.io' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.

（favorites 读）
Access to fetch at '…/api/favorites?user_id=…&limit=3' from origin 'https://simple-superhero-678.github.io'
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.

（写入的预检）
Access to fetch at '…/api/favorites?user_id=…' from origin 'https://simple-superhero-678.github.io'
has been blocked by CORS policy: Response to preflight request doesn't pass access control check:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

### ④ 已尝试动作

刷新 ×3；换全新浏览器档案（无缓存）；curl 直打接口（通了）。均复现；**唯一变量是域名**——换 E2 域名就正常。

### ⑤ 原因排序（六条候选，逐一排除）

| # | 候选原因 | 验证方法 | 结论 |
|---|---|---|---|
| 1 | 代码被改坏 | 线上 station.js 与本地一致（8097B；Day 23 已做过 sha256 逐字节核验）；同代码 E2 正常 | 排除 |
| 2 | 接口挂了 | curl 直打 `/api/health` → 200 | 排除 |
| 3 | 数据库 / 数据没了 | E2 上读回 18 行真实数据；curl total 正常 | 排除 |
| 4 | 网络 / DNS | 静态资源全加载正常；curl 全通；失败只出现在浏览器 | 排除 |
| 5 | 缓存旧 JS | 全新档案首次打开即失败；接口 no-store | 排除 |
| 6 | **跨域白名单没放行 github.io** | 响应头对照（见下表） | **锁定 ✔** |

**关键对照（同一接口、三种来源）**：

| 探针 | Origin=github.io | Origin=cbsite | Origin=evil.com |
|---|---|---|---|
| `GET /api/health` 的 `access-control-allow-origin` | **无** | 有（反射） | 无（正确） |
| `OPTIONS /api/favorites`（预检） | 透传给函数（带 `x-cloudbase-upstream-*` 头），无 ACAO | **网关直接 204 接管**（无 upstream 头），有 ACAO | — |

→ 结论：网关对「本环境静态托管域名 + 本机调试地址」自动放行；**GitHub Pages 是另一个域名，需要显式加进网关跨域白名单**——从 Day 20 上线起一直没加，检查台在 E1 上从未真正工作过（此前浏览器验证都做在 E2 上，所以没暴露）。

> 📌 顺便记住这条方法论：**页面自己说的「连不上接口」是假线索**（网络好着呢）；真原因要看 F12 控制台的原文 + 响应头对照。

### ⑥ 修复方案

把 `https://simple-superhero-678.github.io` 加进 CloudBase 网关的跨域白名单（控制台入口执行时确认；先试工具通道）。**不放通配符、不改代码**——沿用 Day 20 定的分工「白名单语义归网关」。

### ⑦ 回归验证清单（修复后照跑）

1. 本清单 §一 六步全跑（E1 全绿 + E2 不回退）；
2. §三 跨域三探针：github.io 有头 / cbsite 有头 / evil.com 仍无头；
3. 线上回归 `node cloudbase/tests/online-regress.js` 15/15；
4. E1 控制台无 CORS 报错（修复后交作业截图）。

---

## 八、修复后实测记录（2026-10-12 晚 · 板块④）—— ✅ 全链路恢复

### 修复方案（Day 24 定案：函数侧补位）

- 配置路线被套餐封死（免费体验版不允许加「安全域名」；MCP / CLI / 对照实验三证，见 `cloudbase/README.md` Day 24 记录）
- **改为函数侧补位**：`health` / `favorites` / `hot` 三函数在 `Origin === 'https://simple-superhero-678.github.io'` 时自回 `access-control-allow-origin`（**精确来源、非通配**）；`favorites` / `hot` 另把该来源加进 OPTIONS 预检的 `可信来源` set（放行 content-type）。三函数已重新部署。

### 六步链路重跑（E1 · 修复后）

| 步 | 结果 | 证据 |
|---|---|---|
| 1 打开检查台 | 区块正常渲染，两格直接落定（无卡顿） | `E1-github.io-修复后-读写.json` |
| 2 读取 | 健康「服务正常（yishou）」；favorites 显示真实行数（写前 18） | 同上 |
| 3 写入 | 点按钮 → **「201 · 写进去了：yishou-station」**（先删旧行后的首次 201，零重试）→ 格子变 **19 行** | 同上 + `修复后-链路-改删读.txt` |
| 4 刷新确认 | 整页新开 → 仍 **19 行真实数据**（持久化成立） | `E1-github.io-修复后-刷新确认.json` |
| 5 修改 | PATCH 备注 → 200，remark 原样回显 | `修复后-链路-改删读.txt` |
| 6 删除 | DELETE → 200 `{removed:true}`；**再删 → 404（幂等）**；删后 GET → total 回落 **18** | 同上 |
| 刁钻输入 | 空值 / 空白 / 65 字 / 501 字 → 400（中文提示逐条对得上）；引号+emoji+换行 → 200 原样存 | `修复后-刁钻输入.txt` |
| Console | 仅剩 favicon 404 噪声，**CORS 红字全消** | 以上各 `.json` 的 console 字段 |

### 三来源回归（修复后复测）

| 探针 | 修复前 | 修复后 |
|---|---|---|
| github.io（health / favorites / OPTIONS） | ❌ 无 ACAO | ✅ 有 ACAO（单值，无双头） |
| cbsite | ✅ 有（网关反射） | ✅ 照旧（无重复头） |
| evil.com | ✅ 无（正确） | ✅ 仍无（未变通配） |
| 证据 | `E0-响应头对照-*.txt` | `修复后-响应头对照.txt` |

### 闸门 / 部署 / 截图

- 本机：api-local-test **128/128**（+6 条补位断言）· refactor-fingerprint **22/22**
- 线上：online-regress **15/15** · 三个云函数 `tcb fn deploy` 全部成功
- 修复前截图（真浏览器 F12）：`tools/自检记录/2026-10-12-Day24-F12报错-修复前.png`
- 修复后截图（真浏览器）：`tools/自检记录/2026-10-12-Day24-修复后正常.png`

### 结论

✅ 复现、定位、修复、验证四步证据齐全；E1（GitHub Pages 主站）检查台六步全链路恢复，cbsite 与安全对照均无回归。

---

## 九、本次发现的其他问题（记录 · 不在本日修复范围）

| # | 问题 | 证据 | 建议 |
|---|---|---|---|
| 1 | **E2（cbsite）站内容落后一版**：线上 station.js 6690B（缺 Day 23「中文错误」；本地 8097B）——手动上传通道自 Day 20 后未再同步 | 文件大小与关键词比对 | 后续补传；或拍板「只发 Pages」 |
| 2 | **写入按钮快速连点不防抖**：`aria-disabled` 不挡点击，连点会并发双请求，日志可能误报「409 拦下了重复写入」 | `yizhi/js/station.js` L129–146 | 余力加练候选（小修：在途标志位） |
| 3 | 两站 console 均有 `favicon.ico` 404 噪声（非错误） | E1/E2 console.txt | 可选：补 favicon 或忽略 |
