/* ============================================================
   自建同步后端 · 回归测试
   ------------------------------------------------------------
   运行：  node tests/sync.test.mjs
   （需在项目根目录运行）

   原理：直接 import 那个函数里的 createHandler（真的那份代码），
   塞一个「内存假存储」进去跑 —— 不需要联网，也不需要 Netlify 环境。
   ============================================================ */
import { createHandler } from '../netlify/functions/vault.mjs';

/* 假存储：接口跟 Netlify Blobs 用到的那三个方法一模一样 */
function makeStore() {
  const data = new Map();
  return {
    data,
    async setJSON(key, value) { data.set(key, JSON.parse(JSON.stringify(value))); },
    async get(key, opts) {
      if (!data.has(key)) return null;
      const v = data.get(key);
      return opts && opts.type === 'json' ? JSON.parse(JSON.stringify(v)) : JSON.stringify(v);
    },
    async delete(key) { data.delete(key); }
  };
}

const API = 'https://example.com/api/vault';
const CODE = 'ABCDEFGH-23456789-KLMNPQRS';           // 24 位，合法
const CODE2 = 'ZZZZZZZZ-22222222-ZZZZZZZZ';          // 另一串，合法

// 造一份「像保险库记录」的密文（内容本身是假的，只是形状对）
const GOOD = JSON.stringify({
  id: 'main',
  primary: { wrap: { iv: 'aa', ct: 'bb' } },
  verifier: { iv: 'cc', ct: 'dd' },
  data: { iv: 'ee', ct: 'ff' }
});

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  \u2714 ' + m)) : (fail++, console.log('  \u2718 ' + m)); };
const section = s => console.log('\n' + s);

const post = (handler, body) => handler(new Request(API, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body)
}));
const get = (handler, code) => handler(new Request(API + '?code=' + encodeURIComponent(code)));
const del = (handler, code) => handler(new Request(API + '?code=' + encodeURIComponent(code), { method: 'DELETE' }));

section('[1] 存了能取回来');
{
  const store = makeStore();
  const h = createHandler(store);

  const wrote = await post(h, { code: CODE, payload: GOOD, updatedAt: 1700000000000 });
  ok(wrote.status === 200, 'POST 返回 200');
  const wroteBody = await wrote.json();
  ok(wroteBody.ok === true && wroteBody.updatedAt === 1700000000000, '返回里带上了 ok 和时间戳');

  const read = await get(h, CODE);
  ok(read.status === 200, 'GET 返回 200');
  const readBody = await read.json();
  ok(readBody.payload === GOOD, '取回来的密文和存进去的一模一样');
  ok(readBody.updatedAt === 1700000000000, '时间戳也取回来了');
}

section('[2] 云端没数据 → 404（前端会当成正常情况，不当错误）');
{
  const h = createHandler(makeStore());
  const res = await get(h, CODE);
  ok(res.status === 404, 'GET 不存在的同步码 → 404');
}

section('[3] 同步码校验');
{
  const h = createHandler(makeStore());
  ok((await get(h, '')).status === 400, '空同步码 → 400');
  ok((await get(h, 'short')).status === 400, '太短（5 位）→ 400');
  ok((await post(h, { payload: GOOD })).status === 400, 'POST 没带同步码 → 400');
  ok((await post(h, { code: 'x'.repeat(300), payload: GOOD })).status === 400, '同步码过长 → 400');
}

section('[4] 数据校验（拦住明显的垃圾，别把好记录顶掉）');
{
  const h = createHandler(makeStore());
  ok((await post(h, { code: CODE, payload: '这不是 JSON' })).status === 400, 'payload 不是 JSON → 400');
  ok((await post(h, { code: CODE, payload: '{"foo":1}' })).status === 400, 'payload 不像保险库记录 → 400');
  ok((await post(h, { code: CODE })).status === 400, 'payload 不是字符串 → 400');
  ok((await post(h, { code: CODE, payload: 'x'.repeat(3 * 1024 * 1024) })).status === 400, '超过 2MB → 400');
  ok((await post(h, '这不是 JSON')).status === 400, '请求体本身不是 JSON → 400');
}

section('[5] 隔离性：换一串同步码，读不到别人的东西');
{
  const store = makeStore();
  const h = createHandler(store);
  await post(h, { code: CODE, payload: GOOD, updatedAt: 1 });

  const other = await get(h, CODE2);
  ok(other.status === 404, '另一串同步码读到 404（互相看不见）');

  // 覆盖测试：用 CODE2 写一份，不能影响 CODE
  await post(h, { code: CODE2, payload: JSON.stringify({ primary: 1, verifier: 2 }), updatedAt: 2 });
  const again = await get(h, CODE);
  const againBody = await again.json();
  ok(againBody.payload === GOOD, '别人写自己的，不会动到我的数据');
  ok(store.data.size === 2, '两串码存成了两条独立的记录');
}

section('[6] 隐私：存的键是哈希，不含同步码原文');
{
  const store = makeStore();
  const h = createHandler(store);
  await post(h, { code: CODE, payload: GOOD, updatedAt: 1 });

  const keys = [...store.data.keys()];
  ok(keys.length === 1, '只占了一个键位');
  ok(!keys[0].includes(CODE), '键里看不到同步码原文');
  ok(!keys[0].includes('ABCDEFGH'), '连同步码的片段都没有');
  ok(/^v-[0-9a-f]{64}$/.test(keys[0]), '键的形状是 v- + 64 位十六进制（SHA-256）');

  // 同样的同步码每次算出来的键必须一样，否则第二次就读不到了
  const h2 = createHandler(store);
  const r = await get(h2, CODE);
  ok(r.status === 200, '同样一串码，换个处理器也能读到（键是稳定算出来的）');
}

section('[7] 覆盖写入 = 更新，不是新增');
{
  const store = makeStore();
  const h = createHandler(store);
  await post(h, { code: CODE, payload: GOOD, updatedAt: 1 });
  const NEW = JSON.stringify({ primary: { wrap: 1 }, verifier: { x: 2 }, data: null });
  await post(h, { code: CODE, payload: NEW, updatedAt: 2 });
  ok(store.data.size === 1, '还是只占一个键位');
  const r = await (await get(h, CODE)).json();
  ok(r.payload === NEW && r.updatedAt === 2, '内容被更新成新的了');
}

section('[8] 删除');
{
  const store = makeStore();
  const h = createHandler(store);
  await post(h, { code: CODE, payload: GOOD, updatedAt: 1 });
  const d = await del(h, CODE);
  ok(d.status === 200, 'DELETE 返回 200');
  ok((await get(h, CODE)).status === 404, '删掉之后就读不到了');
  ok((await del(h, CODE)).status === 200, '重复删除也不报错（幂等）');
}

section('[9] 其它方法应该被拒绝');
{
  const h = createHandler(makeStore());
  const res = await h(new Request(API, { method: 'PUT', body: '{}' }));
  ok(res.status === 405, 'PUT → 405');
}

section('[10] 响应头');
{
  const h = createHandler(makeStore());
  const res = await get(h, CODE);
  ok(res.headers.get('cache-control') === 'no-store', '带 no-store，不让中间环节缓存密文');
  ok((res.headers.get('content-type') || '').includes('application/json'), '返回的是 JSON');
}

console.log('\n============================');
console.log('  结果：' + pass + ' 通过 / ' + fail + ' 失败');
console.log('============================');
process.exit(fail ? 1 : 0);
