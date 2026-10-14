/* 工具页外壳：深浅色记忆 + 年份 + 自动插入「同类免费网站」区块。
   所有 /apps/ 下面的页面共用。 */
(function () {
  var root = document.documentElement;

  try {
    var saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);
  } catch (e) {}

  var btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) {}
    });
  }

  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();

  /* ======================================================================
     同类免费网站：别人已经做得更好、而且免费的，直接从这儿跳过去。
     按页面文件名匹配（/apps/calculator.html → calculator）。
     ⚠️ 以后加新工具页，记得在这里也补一条 —— tests/tools.test.cjs 会检查。
     ====================================================================== */
  var ALSO = {
    calculator: [
      ['Desmos 图形计算器', 'https://www.desmos.com/calculator', '画函数图像，比纯算数直观'],
      ['WolframAlpha', 'https://www.wolframalpha.com', '什么都能算，还给步骤'],
      ['Omni Calculator', 'https://www.omnicalculator.com', '几千个现成计算器']
    ],
    fraction: [
      ['WolframAlpha', 'https://www.wolframalpha.com', '分数运算、化简、转小数'],
      ['Symbolab', 'https://www.symbolab.com', '一步步看过程']
    ],
    equation: [
      ['WolframAlpha', 'https://www.wolframalpha.com', '高次方程、方程组也能解'],
      ['Symbolab', 'https://www.symbolab.com', '解方程带完整步骤'],
      ['Desmos', 'https://www.desmos.com/calculator', '画图看根在哪儿']
    ],
    geometry: [
      ['GeoGebra', 'https://www.geogebra.org', '几何作图、动态演示'],
      ['WolframAlpha', 'https://www.wolframalpha.com', '不规则图形也能算'],
      ['Omni Calculator', 'https://www.omnicalculator.com', '各种面积体积公式']
    ],
    unit: [
      ['UnitConverters', 'https://www.unitconverters.net', '单位特别全'],
      ['WolframAlpha', 'https://www.wolframalpha.com', '连「一光年等于多少米」都行']
    ],
    stats: [
      ['Calculator.net 统计', 'https://www.calculator.net/statistics-calculator.html', '输数据就出全部统计量'],
      ['WolframAlpha', 'https://www.wolframalpha.com', '还能画分布图']
    ],
    physics: [
      ['Omni Calculator', 'https://www.omnicalculator.com', '物理公式最全的一站'],
      ['WolframAlpha', 'https://www.wolframalpha.com', '带单位的物理计算']
    ],
    base: [
      ['RapidTables 进制转换', 'https://www.rapidtables.com/convert/number/', '二/八/十/十六进制互转'],
      ['CyberChef', 'https://gchq.github.io/CyberChef/', '还能做各种编码转换']
    ],
    number: [
      ['WolframAlpha', 'https://www.wolframalpha.com', '质因数分解、质数判定'],
      ['RapidTables', 'https://www.rapidtables.com', '各类数学小工具']
    ],
    percent: [
      ['Calculator.net 百分比', 'https://www.calculator.net/percent-calculator.html', '各种百分比算法'],
      ['Omni Calculator', 'https://www.omnicalculator.com', '折扣、涨幅、利润全有']
    ],
    currency: [
      ['XE 汇率', 'https://www.xe.com', '权威汇率'],
      ['Wise 汇率', 'https://wise.com/currency-converter', '实际换汇成本参考']
    ],
    worldclock: [
      ['timeanddate 世界时钟', 'https://www.timeanddate.com/worldclock', '时区、夏令时查得很细'],
      ['timeanddate 会议规划', 'https://www.timeanddate.com/worldclock/meeting.html', '约跨国会议用这个']
    ],
    tip: [
      ['Calculator.net 小费', 'https://www.calculator.net/tip-calculator.html', '小费 + 分账'],
      ['Omni Calculator', 'https://www.omnicalculator.com', '各国小费习惯也能查']
    ],
    size: [
      ['Omni Calculator 尺码', 'https://www.omnicalculator.com', '鞋码、衣服尺码换算'],
      ['WolframAlpha', 'https://www.wolframalpha.com', '各国尺码标准查询']
    ],
    datecalc: [
      ['timeanddate 日期推算', 'https://www.timeanddate.com/date/dateadd.html', '加减天数、算工作日'],
      ['timeanddate 间隔计算', 'https://www.timeanddate.com/date/duration.html', '两个日期差多少']
    ],
    text: [
      ['CyberChef', 'https://gchq.github.io/CyberChef/', '编码解码、正则、哈希全都有'],
      ['草料二维码', 'https://cli.im', '文字 / 网址生成二维码']
    ],
    bmi: [
      ['Calculator.net BMI', 'https://www.calculator.net/bmi-calculator.html', '还能按英制单位算'],
      ['Omni Calculator BMI', 'https://www.omnicalculator.com/health/bmi', '附带更多身体指标']
    ],
    loan: [
      ['Omni Calculator 房贷', 'https://www.omnicalculator.com/finance/mortgage', '各种还款方式都能算'],
      ['Calculator.net 贷款', 'https://www.calculator.net/loan-calculator.html', '月供、总利息一目了然']
    ],
    password: [
      ['Bitwarden 密码生成器', 'https://bitwarden.com/password-generator/', '开源密码管理器的生成器'],
      ['本站保险库', '/vault.html', '生成完直接存进去，用 U 盘当钥匙']
    ],
    countdown: [
      ['timeanddate 倒计时', 'https://www.timeanddate.com/countdown/', '做漂亮的倒计时'],
      ['Tomato Timer', 'https://tomato-timer.com', '在线番茄钟']
    ],
    random: [
      ['Random.org', 'https://www.random.org', '真随机数（大气噪声生成）'],
      ['Wheel of Names', 'https://wheelofnames.com', '转盘抽签']
    ]
  };

  /* 根据当前页面的文件名，把对应的一组外链追加到页面底部 */
  var main = document.querySelector('main.tool-page');
  if (!main) return;

  var m = location.pathname.match(/\/apps\/([a-z0-9_-]+?)(?:\.html)?\/?$/i);
  var key = m ? m[1].toLowerCase() : '';
  if (!key || key === 'index' || !ALSO[key]) return;

  var sec = document.createElement('section');
  sec.className = 'cat';
  sec.setAttribute('data-also', key);

  var h = document.createElement('h2');
  h.textContent = '同类免费网站（点了直接过去 ↗）';
  sec.appendChild(h);

  var lead = document.createElement('p');
  lead.className = 'lead';
  lead.textContent = '这些是别人做得更好的免费站点，会在新标签页打开。';
  sec.appendChild(lead);

  var grid = document.createElement('div');
  grid.className = 'tool-grid';

  ALSO[key].forEach(function (item) {
    var a = document.createElement('a');
    a.className = 'card';
    a.href = item[1];
    a.rel = 'noopener noreferrer';
    var outside = item[1].indexOf('http') === 0;
    if (outside) a.target = '_blank';

    var t = document.createElement('h3');
    t.textContent = item[0] + (outside ? ' ↗' : '');
    var p = document.createElement('p');
    p.textContent = item[2];

    a.appendChild(t);
    a.appendChild(p);
    grid.appendChild(a);
  });

  sec.appendChild(grid);
  main.appendChild(sec);
})();
