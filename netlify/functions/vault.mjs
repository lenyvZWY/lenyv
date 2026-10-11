/* ============================================================================
   自建同步接口 · /api/vault
   ============================================================================
   【它是干什么的】
   给密码本提供一个「存一团密文」的地方，跑在**你自己的 Netlify 站点**上。
   不经过任何第三方服务，也不需要注册任何账号。

   【为什么这一团东西可以随便存】
   前端传上来的 payload 是**已经在本机加密好的密文**。服务器没有钥匙，
   解不开，也不需要解。所以这里存的只是一堆它看不懂的字符。

   【怎么防止别人乱动】
   靠「同步码」：前端会给每个用户一段自己生成的随机码，
   这里用它的 SHA-256 当存储键 —— 也就是说，
   · 不知道同步码的人，猜不到键，读不到也写不了；
   · 即使数据库被人翻了个遍，看到的也只是哈希，反推不出同步码。

   【接口】
   GET    /api/vault?code=XXX   取回密文
   POST   /api/vault            存/覆盖密文（body: { code, payload, updatedAt }）
   DELETE /api/vault?code=XXX   抹掉云端这份（本地不受影响）
   ============================================================================ */

import { getStore } from '@netlify/blobs';

// 站点级存储：跟着站点走，重新部署不会丢
const STORE_NAME = 'vault-sync';

// 同步码最短长度。太短容易被猜到，所以卡死一个下限。
const CODE_MIN = 16;
const CODE_MAX = 200;

// 密文最大 2 MB。一团密码本远到不了这个量级，设上限是为了防止有人拿来当网盘。
const MAX_PAYLOAD = 2 * 1024 * 1024;

// 统一的 JSON 响应
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // 密文是私密的，明确告诉中间环节不要缓存
      'cache-control': 'no-store'
    }
  });
}

/* 同步码 → 存储键。
   不直接用同步码当键，而是先做一次 SHA-256 —— 这样即使存储被别人看到，
   也只能看到一串哈希，拿不到同步码本身。 */
async function keyOf(code) {
  const data = new TextEncoder().encode('vault-sync::' + code);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return 'v-' + Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// 校验同步码：必须是字符串，且长度在允许范围内
function codeError(code) {
  if (typeof code !== 'string') return '缺少同步码';
  if (code.length < CODE_MIN) return '同步码太短（至少 ' + CODE_MIN + ' 位）';
  if (code.length > CODE_MAX) return '同步码太长';
  return null;
}

/* 检查 payload 像不像一份保险库记录。
   只做很浅的一层检查 —— 服务器看不到明文，也验证不了内容，
   这一步只是拦住明显的垃圾数据，免得把一个坏记录写进去把好的顶掉。 */
function payloadError(payload) {
  if (typeof payload !== 'string') return 'payload 必须是字符串';
  if (payload.length > MAX_PAYLOAD) return '数据太大';
  let obj;
  try {
    obj = JSON.parse(payload);
  } catch (e) {
    return 'payload 不是合法 JSON';
  }
  if (!obj || typeof obj !== 'object') return 'payload 格式不对';
  if (!obj.primary || !obj.verifier) return 'payload 不像一份保险库记录';
  return null;
}

/* ============================================================================
   处理器：把 store 传进来，而不是在里面直接取 —— 这样测试可以塞一个假的进去
   ============================================================================ */
export function createHandler(store) {
  return async function handler(req) {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();

    // ---- 取回密文 ----
    if (method === 'GET') {
      const code = url.searchParams.get('code') || '';
      const bad = codeError(code);
      if (bad) return json({ error: bad }, 400);

      const found = await store.get(await keyOf(code), { type: 'json' });
      if (!found) return json({ error: '云端还没有数据' }, 404);
      return json({ ok: true, payload: found.payload, updatedAt: found.updatedAt });
    }

    // ---- 存 / 覆盖 ----
    if (method === 'POST') {
      let body;
      try {
        body = await req.json();
      } catch (e) {
        return json({ error: '请求体不是合法 JSON' }, 400);
      }

      const bad = codeError(body && body.code);
      if (bad) return json({ error: bad }, 400);

      const badPayload = payloadError(body && body.payload);
      if (badPayload) return json({ error: badPayload }, 400);

      // 时间戳由前端给（就是它本地记录的更新时间），拿不到就用当前时间
      const updatedAt = Number.isFinite(body.updatedAt) ? body.updatedAt : Date.now();

      await store.setJSON(await keyOf(body.code), { payload: body.payload, updatedAt });
      return json({ ok: true, updatedAt });
    }

    // ---- 抹掉云端这份 ----
    if (method === 'DELETE') {
      const code = url.searchParams.get('code') || '';
      const bad = codeError(code);
      if (bad) return json({ error: bad }, 400);

      await store.delete(await keyOf(code));
      return json({ ok: true });
    }

    return json({ error: '不支持的方法' }, 405);
  };
}

/* Netlify 调用的就是这个默认导出。
   在 Functions 运行时里，siteID / token 会被平台自动注入，不需要手写凭据。 */
export default async function (req) {
  return createHandler(getStore({ name: STORE_NAME, consistency: 'strong' }))(req);
}
