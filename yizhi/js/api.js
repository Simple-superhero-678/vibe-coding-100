// 异兽志 · 公网接口薄层（Day 20）
//
// 这是什么：前端第一次真正「越过文件、去调公网接口」的那一层。
// 检查台（js/station.js）只从这里拿数据；它不知道地址长什么样、也不知道 fetch 怎么写 ——
// 将来换域名、加鉴权头、改成同域代理，都只改这个文件。
//
// 为什么是绝对地址写死：本站无构建、无环境变量机制（纯静态 ES Module），
// 接口地址本身不是密钥（真正的密钥 TCB_API_KEY 只活在云函数环境变量里，从不进前端）。
// F12 Network 里看到的就是下面这个域名 —— 这正是今天要验收的一条。
//
// 口径依据：api-contract.md v0.4 —— 成功 {ok,data} / 失败 {ok:false,error:{code,message}}，
// 「空」与「错」必须分开（空表不是报错）。

/** 接口基址（CloudBase HTTP 网关 · 上海） */
export const 接口基址 = 'https://yishou-d9gyoykka49fb0634-1501173044.ap-shanghai.app.tcloudbase.com';

/** 检查台展示用的身份：users 表里真实存在的 uuid（Day 17 临时口径 ?user_id=<uuid>，真 token 落地后换） */
const 展示用户 = '11111111-1111-4111-8111-111111111111';

/* 统一出口：拿 JSON、分清「HTTP 错」「契约错」「网络错」，把三种都翻成 {code,message} 抛出。
   抛错而不是返 undefined —— 调用方（station.js）catch 后才知道该铺「错」而不是铺「空」。 */
async function 打(路径, 选项 = {}) {
  let 响应;
  try {
    响应 = await fetch(接口基址 + 路径, 选项);
  } catch (因) {
    // fetch 只在网络层失败时抛（断网 / DNS / 服务挂了）—— 这跟「接口回 500」是两回事
    throw { code: 'NETWORK', message: '连不上接口（网络或服务没响应）' };
  }

  let 体;
  try {
    体 = await 响应.json();
  } catch (因) {
    throw { code: 'BAD_JSON', message: `接口回了非 JSON（HTTP ${响应.status}）` };
  }

  if (!响应.ok || 体.ok === false) {
    const 错 = (体 && 体.error) || {};
    throw { code: 错.code || `HTTP_${响应.status}`, message: 错.message || `接口返回 ${响应.status}` };
  }
  // 形状兼容：health 是 Day 15 早期接口，回 {ok:true, service}（无 data 包装）；
  // favorites / hot 按契约回 {ok:true, data:{…}}。有 data 拆 data，没有就整体给。
  return 体 && 体.data !== undefined ? 体.data : 体;
}

/** 存活探针：GET /api/health → {service:'yishou'}（不连库，只证明函数活着） */
export async function 取健康() {
  return 打('/api/health');
}

/**
 * 读收藏表的真实行：GET /api/favorites?user_id=<展示用户>&limit=<条数>
 * @returns {Promise<{total:number, items:{entry_id:string, created_at:string}[]}>}
 *   total = 这位用户的总行数（favorites 表按 user_id 过滤后的真实行数）
 */
export async function 取收藏表(条数 = 3) {
  return 打(`/api/favorites?user_id=${展示用户}&limit=${条数}`);
}

/** 写入测试：POST /api/favorites —— 201 新增成功；409 = 接口把重复写入拦住了（同样是接口在真实工作） */
export async function 写收藏表(条目id) {
  return 打(`/api/favorites?user_id=${展示用户}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entry_id: 条目id }),
  });
}

/** 409 的错误码常量：station.js 要靠它区分「写进去了」和「被唯一约束拦住」 */
export const 重复码 = 'FAV_DUPLICATE';
