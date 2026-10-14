/* ============================================================================
   工具箱测试
   ----------------------------------------------------------------------------
   跟其他测试一样：**从真实页面里切片提取代码来跑**，不另抄一份。
   因为以前吃过亏：把算法抄到测试副本里，结果漏掉了真代码里的 bug。

   运行： node tests/tools.test.cjs
   ============================================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const APPS = path.join(ROOT, 'apps');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name); }
}
/* JSON.stringify 不认 BigInt，这里统一转成带 n 后缀的字符串再比 */
function str(v) {
  return JSON.stringify(v, function (k, x) {
    return typeof x === 'bigint' ? x.toString() + 'n' : x;
  });
}
function eq(a, b, name) {
  ok(str(a) === str(b), name + '（得到 ' + str(a) + '，期望 ' + str(b) + '）');
}
function near(a, b, name, eps) {
  ok(Math.abs(a - b) < (eps || 1e-9), name + '（得到 ' + a + '，期望 ' + b + '）');
}
function section(t) { console.log('\n' + t); }

/* 从页面里切一段代码出来跑 */
function slice(file, from, to) {
  const html = fs.readFileSync(path.join(APPS, file), 'utf8');
  const i = html.indexOf(from);
  const j = html.indexOf(to);
  if (i < 0) throw new Error(file + ' 里找不到起始标记：' + from);
  if (j < 0) throw new Error(file + ' 里找不到结束标记：' + to);
  if (j <= i) throw new Error(file + ' 的结束标记在起始标记前面');
  return html.slice(i, j);
}
function run(file, from, to) {
  const code = slice(file, from, to);
  const box = { console: console };
  vm.createContext(box);
  vm.runInContext(code + '\n', box, { timeout: 5000 });
  return box;
}

/* ======================================================================== */
section('[1] 计算器表达式解析器（CSP 禁了 eval，必须自己解析）');
{
  const c = run('calculator.html', "var MODE = 'deg';", '/* ---- 界面 ---- */');
  const cases = [
    ['1+2*3', 7], ['(1+2)*3', 9], ['2^10', 1024], ['sqrt(9)', 3],
    ['3*pi', 9.42477796076938], ['2(3+4)', 14], ['-3^2', -9], ['10/4', 2.5],
    ['sin(30)', 0.5], ['sin(90)', 1], ['cos(0)', 1], ['tan(45)', 1],
    ['log(100)', 2], ['ln(e)', 1], ['2^3^2', 512], ['2sin(30)', 1],
    ['(1+2', 3]            // 少一个右括号：故意宽容，自动补上
  ];
  cases.forEach(function (cs) {
    let got;
    try { got = c.evaluate(cs[0]); } catch (e) { got = 'ERR:' + e.message; }
    near(got, cs[1], cs[0] + ' = ' + cs[1], 1e-9);
  });

  ['1/0', 'sqrt(-1)', '1++', 'abc(1)'].forEach(function (s) {
    let threw = false;
    try { c.evaluate(s); } catch (e) { threw = true; }
    ok(threw, '非法式子要报错而不是算出错数：' + s);
  });

  eq(c.fmt(1024), '1024', 'fmt 整数不带小数点');
  eq(c.fmt(0.5), '0.5', 'fmt 小数');
}

/* ======================================================================== */
section('[2] 分数：约分 / 带分数 / 百分数');
{
  const f = run('fraction.html', 'function gcd(a, b)', 'function render(el');
  eq(f.gcd(12, 18), 6, 'gcd(12,18)');
  eq(f.gcd(7, 13), 1, '互质的两个数 gcd = 1');
  eq(f.reduce(12, 18), [2, 3], 'reduce(12,18)');
  eq(f.reduce(4, -8), [-1, 2], '分母是负数时把负号挪到分子');
  eq(f.reduce(-6, -9), [2, 3], '分子分母都负 → 正分数');
  eq(f.asText(5, 1), '5', '分母为 1 就只写整数');
  eq(f.asMixed(7, 2), '3 又 1/2', '假分数转带分数');
  eq(f.asMixed(3, 4), null, '真分数没有带分数形式');
  eq(f.pct(0.125), '12.5%', '小数转百分数');
  let threw = false;
  try { f.reduce(1, 0); } catch (e) { threw = true; }
  ok(threw, '分母为 0 要报错');
}

/* ======================================================================== */
section('[3] 数与因数：质数 / 分解 / 公约数 / 因数列表');
{
  const n = run('number.html', 'function isPrime(n)', 'function showError(el');
  ok(n.isPrime(97) === true, '97 是质数');
  ok(n.isPrime(2) === true, '2 是质数');
  ok(n.isPrime(1) === false, '1 不是质数');
  ok(n.isPrime(91) === false, '91 = 7×13，不是质数');
  eq(n.factorize(60).list, [2, 2, 3, 5], '60 分解质因数');
  eq(n.factorize(17).list, [17], '质数分解出它自己');
  eq(n.divisors(6), [1, 2, 3, 6], '6 的全部因数');
  eq(n.divisors(36).length, 9, '36 有 9 个因数');
  eq(n.gcd(24, 36).value, 12, 'gcd(24,36)');
  eq(n.gcd(17, 5).value, 1, '互质的 gcd = 1');
}

/* ======================================================================== */
section('[4] 进制转换');
{
  const b = run('base.html', 'function parseInBase', 'var NAMES = {');
  eq(b.parseInBase('1011', 2), 11n, '1011(二进制) = 11');
  eq(b.parseInBase('FF', 16), 255n, 'FF(十六进制) = 255');
  eq(b.parseInBase('ff', 16), 255n, '十六进制小写也认');
  eq(b.parseInBase('17', 8), 15n, '17(八进制) = 15');
  eq(b.parseInBase('-10', 10), -10n, '支持负数');
  ['2', 'g'].forEach(function (bad) {
    let threw = false;
    try { b.parseInBase(bad, 2); } catch (e) { threw = true; }
    ok(threw, '二进制里出现「' + bad + '」要报错');
  });
  eq(b.expand('101', 2), '1×2^2 + 0×2^1 + 1×2^0', '按权展开的写法');
}

/* ======================================================================== */
section('[5] 统计：中位数 / 众数');
{
  const s = run('stats.html', 'function f(v)', "document.getElementById('go')");
  near(s.medianOf([1, 2, 3]), 2, '奇数个的中位数', 0);
  near(s.medianOf([1, 2, 3, 4]), 2.5, '偶数个的中位数', 0);
  eq(s.modesOf([1, 1, 2]).list, [1], '众数');
  eq(s.modesOf([1, 1, 2, 2]).list, [1, 2], '两个并列众数');
  eq(s.modesOf([1, 2, 3]).list, [], '每个都只出现一次 → 没有众数');
}

/* ======================================================================== */
section('[6] 图形计算');
{
  const g = run('geometry.html', 'var PI = Math.PI;', 'var sel = document.getElementById');
  near(g.SHAPES.rect.run({ a: 3, b: 4 }).rows[0][1], 12, '长方形 3×4 面积', 0);
  near(g.SHAPES.rect.run({ a: 3, b: 4 }).rows[1][1], 14, '长方形周长', 0);
  near(g.SHAPES.triBH.run({ a: 6, h: 4 }).rows[0][1], 12, '三角形底6高4面积', 0);
  near(g.SHAPES.circle.run({ r: 1 }).rows[0][1], Math.PI, '单位圆面积', 1e-12);
  near(g.SHAPES.trap.run({ a: 2, b: 4, h: 5 }).rows[0][1], 15, '梯形面积', 0);
  near(g.SHAPES.cube.run({ a: 3 }).rows[1][1], 27, '正方体体积', 0);
  near(g.SHAPES.sphere.run({ r: 3 }).rows[1][1], 113.09733552923255, '球体积 4/3πr³', 1e-9);
  let threw = false;
  try { g.SHAPES.triABC.run({ a: 1, b: 2, c: 10 }); } catch (e) { threw = true; }
  ok(threw, '三条边围不成三角形要报错');
  near(g.SHAPES.triABC.run({ a: 3, b: 4, c: 5 }).rows[1][1], 6, '勾三股四弦五面积', 1e-9);
}

/* ======================================================================== */
section('[7] 物理公式');
{
  const p = run('physics.html', 'function f(v)', 'var sel = document.getElementById');
  near(p.FORMULAS.speed.solve('v', { s: 100, t: 10 }), 10, 'v = s/t', 0);
  near(p.FORMULAS.speed.solve('t', { s: 100, v: 20 }), 5, 't = s/v', 0);
  near(p.FORMULAS.ohm.solve('R', { U: 6, I: 2 }), 3, 'R = U/I', 0);
  near(p.FORMULAS.density.solve('m', { rho: 2, V: 3 }), 6, 'm = ρV', 0);
  near(p.FORMULAS.pressure.solve('p', { F: 100, S: 2 }), 50, 'p = F/S', 0);
  near(p.FORMULAS.lever.solve('F1', { L1: 2, F2: 30, L2: 1 }), 15, '杠杆 F₁ = F₂L₂/L₁', 0);
  near(p.FORMULAS.heat.solve('Q', { c: 4200, m: 2, dt: 10 }), 84000, 'Q = cmΔt', 0);
  near(p.FORMULAS.ework.solve('W', { U: 220, I: 2, t: 60 }), 26400, 'W = UIt', 0);
}

/* ======================================================================== */
section('[8] 单位换算');
{
  const u = run('unit.html', 'var CATS = {', 'var cat = document.getElementById');
  const conv = function (cat, v, a, b) {
    return v * u.CATS[cat].units[a] / u.CATS[cat].units[b];
  };
  const L = function (v, a, b) { return conv('length', v, a, b); };
  near(L(1, '千米(km)', '米(m)'), 1000, '1 千米 = 1000 米', 0);
  near(L(1, '米(m)', '厘米(cm)'), 100, '1 米 = 100 厘米', 0);
  near(L(1, '里', '米(m)'), 500, '1 里 = 500 米', 0);
  near(conv('mass', 1, '斤', '克(g)'), 500, '1 斤 = 500 克', 1e-9);
  near(conv('mass', 1, '吨(t)', '千克(kg)'), 1000, '1 吨 = 1000 千克', 0);
  near(conv('area', 1, '公顷(ha)', '平方米(m²)'), 10000, '1 公顷 = 10000 平方米', 0);
  near(conv('area', 1, '亩', '平方米(m²)'), 666.6667, '1 亩 ≈ 666.67 平方米', 1e-6);
  near(conv('speed', 36, '千米/小时(km/h)', '米/秒(m/s)'), 10, '36 km/h = 10 m/s', 1e-9);
  near(conv('time', 2, '小时(h)', '分钟(min)'), 120, '2 小时 = 120 分钟', 0);
  near(u.fromC('华氏度(℉)', 100), 212, '100℃ = 212℉', 1e-9);
  near(u.fromC('开尔文(K)', 0), 273.15, '0℃ = 273.15K', 1e-9);
  near(u.toC('华氏度(℉)', 32), 0, '32℉ = 0℃', 1e-9);
}

/* ======================================================================== */
section('[9] 所有工具页的硬性检查');
{
  const files = fs.readdirSync(APPS).filter(f => f.endsWith('.html'));
  ok(files.length >= 11, '工具页数量：' + files.length + ' 个');

  files.forEach(function (f) {
    const html = fs.readFileSync(path.join(APPS, f), 'utf8');
    ok(html.indexOf('nl-badge-frame') >= 0, f + '：有 Netlify 角标守卫');
    ok(html.indexOf('/assets/js/app-shell.js') >= 0, f + '：引用了共用外壳脚本');
    ok(html.indexOf('eval(') < 0 && html.indexOf('new Function') < 0,
      f + '：没有用 eval / new Function（CSP 会拦）');
    ok(html.indexOf('返回工具箱') >= 0 || f === 'index.html', f + '：有返回工具箱的入口');
    const scripts = html.match(/<script src="([^"]+)"/g) || [];
    const ext = scripts.filter(s => s.indexOf('http') >= 0);
    ok(ext.length === 0, f + '：没有外链脚本（只有字体是外链样式，可以）');
  });

  const idx = fs.readFileSync(path.join(APPS, 'index.html'), 'utf8');
  files.filter(f => f !== 'index.html').forEach(function (f) {
    ok(idx.indexOf('href="' + f + '"') >= 0 || idx.indexOf('href=' + f) >= 0,
      '工具箱首页列出了 ' + f);
  });
}

/* ======================================================================== */
section('[10] 每个工具页都要有「同类免费网站」跳板（app-shell.js 自动插入）');
{
  const shell = fs.readFileSync(path.join(ROOT, 'assets/js/app-shell.js'), 'utf8');
  const files = fs.readdirSync(APPS).filter(f => f.endsWith('.html') && f !== 'index.html');

  // 从真实的外壳脚本里取出 ALSO 的键名（不抄副本）
  const keys = [];
  const re = /^\s{4}([a-z0-9]+):\s*\[$/gm;
  let mm;
  while ((mm = re.exec(shell)) !== null) keys.push(mm[1]);
  ok(keys.length > 0, '外壳脚本里读到了 ' + keys.length + ' 组外链配置');

  files.forEach(function (f) {
    const key = f.replace(/\.html$/, '');
    ok(keys.indexOf(key) >= 0, key + ' 有对应的同类网站外链');
  });

  // 页面文件名 → key 的识别规则
  const rule = /\/apps\/([a-z0-9_-]+?)(?:\.html)?\/?$/i;
  const pick = function (p) { const x = p.match(rule); return x ? x[1].toLowerCase() : ''; };
  eq(pick('/apps/calculator.html'), 'calculator', '/apps/calculator.html → calculator');
  eq(pick('/apps/calculator'), 'calculator', '美化后的 /apps/calculator 也能认出来');
  eq(pick('/apps/'), '', '工具箱首页不插外链');
  eq(pick('/apps/index.html'), 'index', '首页识别成 index（会被跳过）');

  // 每个工具页都要有 main.tool-page，否则外链插不进去
  files.forEach(function (f) {
    const html = fs.readFileSync(path.join(APPS, f), 'utf8');
    ok(html.indexOf('class="tool-page"') >= 0, f + '：有 main.tool-page（外链要插这里）');
  });
}

console.log('\n============================');
console.log('  结果：' + pass + ' 通过 / ' + fail + ' 失败');
console.log('============================');
process.exit(fail ? 1 : 0);
