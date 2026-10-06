'use strict';

/**
 * 云函数 health —— 对应公网接口 GET /api/health
 *
 * 唯一职责：证明「后端活着」。
 * 不连数据库、不读环境变量、不写任何业务逻辑（Day 15 范围内）。
 *
 * 为什么长这样：
 * - 云函数入口固定是 exports.main(event, context)。
 *   event 里装的是「这一次调用」的信息：HTTP 请求时含方法、路径、请求头、body。
 * - HTTP 网关把 /api/health 这条路由指向本函数；
 *   函数返回 { statusCode, headers, body } 即表示「这次 HTTP 响应由我来定」。
 */

const SERVICE = 'yishou'; // 项目英文名，与 data/*.json 里 id 的前缀（yishou-）一致

exports.main = async (event) => {
  // 只实现 GET，其余方法回 405。
  // 控制台「测试」触发时不带 method，按 GET 放行，方便自测。
  const method = (event && (event.httpMethod || event.method)) || 'GET';
  if (String(method).toUpperCase() !== 'GET') {
    return {
      statusCode: 405,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok: false, error: 'METHOD_NOT_ALLOWED' }),
    };
  }

  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store', // 健康检查不缓存
    },
    // 契约：{ "ok": true, "service": "yishou" }
    body: JSON.stringify({ ok: true, service: SERVICE }),
  };
};
