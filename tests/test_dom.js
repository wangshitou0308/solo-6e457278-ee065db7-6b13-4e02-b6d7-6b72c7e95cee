/* DOM 集成测试（可选）：用 jsdom 加载真实 index.html + app.js，
 * 验证拆分 / 合并 / 智能分行 / 批量重排 / 撤销 / 导出的界面流程。
 * 运行：npm install --no-save jsdom && node tests/test_dom.js
 * 未安装 jsdom 时自动跳过（退出码 0）。 */
'use strict';
let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch (e) {
  console.log('跳过 tests/test_dom.js（未安装 jsdom：npm install --no-save jsdom）');
  process.exit(0);
}
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  ✓', label); }
  else { failed++; console.error('  ✗ FAIL:', label); }
}

const html = fs.readFileSync(path.join(__dirname, '../static/index.html'), 'utf-8');
const coreSrc = fs.readFileSync(path.join(__dirname, '../static/core.js'), 'utf-8');
const appSrc = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf-8');

// 直接从 server.py 提取内置示例 SRT，保持单一数据源
const serverPy = fs.readFileSync(path.join(__dirname, '../server.py'), 'utf-8');
const sample = serverPy.match(/SAMPLE_SRT = """([\s\S]*?)"""/)[1].replace(/\r\n/g, '\n');

const dom = new JSDOM(html, {
  url: 'http://127.0.0.1:8000/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;

// fetch stub
window.fetch = function (url, opts) {
  if (String(url).includes('/api/sample')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ filename: '示例字幕.srt', content: sample }) });
  }
  if (String(url).includes('/api/draft')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ found: false, draft: null }),
    });
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
};
// canvas 2d stub
window.HTMLCanvasElement.prototype.getContext = function () {
  return new Proxy({}, { get: (t, p) => {
    if (p === 'measureText') return () => ({ width: 0 });
    if (p === 'canvas') return this;
    return typeof p === 'string' ? function () {} : undefined;
  }, set: () => true });
};
Object.defineProperty(window.HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, value: 1000 });
Object.defineProperty(window.HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, value: 150 });
Object.defineProperty(window.HTMLCanvasElement.prototype, 'getBoundingClientRect', {
  configurable: true,
  value: () => ({ left: 0, top: 0, width: 1000, height: 150 }),
});
window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
window.cancelAnimationFrame = (id) => clearTimeout(id);
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.Element.prototype.scrollIntoView = function () {};
// jsdom 默认窗口 1024，画布 clientWidth 为 0 时 app 使用 clientWidth||800
Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });

const scriptEl = window.document.createElement('script');
window.eval(coreSrc);
window.eval(appSrc);

function rows() { return [...window.document.querySelectorAll('#cueTbody tr')]; }
function ta(i) { return rows()[i].querySelector('textarea'); }
function timeVal(i, field) { return rows()[i].querySelector(`input[data-field="${field}"]`).value; }
function click(el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); }
// 完整模拟真实点击按钮：mousedown（此时焦点仍在文本框）→ 文本框失焦、按钮聚焦 → mouseup → click
function realClickButton(btn) {
  const prevFocused = window.document.activeElement;
  const taFocused = prevFocused && prevFocused.matches && prevFocused.matches('textarea') ? prevFocused : null;
  btn.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  if (taFocused) {
    taFocused.dispatchEvent(new window.Event('blur', { bubbles: false }));
    btn.focus();
  }
  btn.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
  click(btn);
}

(async () => {
  // 等待示例自动载入
  await new Promise(r => setTimeout(r, 100));
  const errs = [];
  window.addEventListener('error', e => errs.push(e.message));

  console.log('1. 首屏');
  ok(rows().length === 9, `示例 9 条（实际 ${rows().length}）`);
  ok(rows()[0].querySelector('.op-split'), '操作列存在');
  ok(rows()[8].querySelector('.op-merge').disabled, '最后一条合并禁用');
  const summary = window.document.getElementById('problemSummary').textContent;
  ok(/超长行/.test(summary), '分行问题纳入节奏检查：' + summary.slice(0, 60));

  console.log('2. 单条智能分行');
  const before = ta(3).value;
  click(rows()[3].querySelector('.op-rewrap'));
  const after = ta(3).value;
  ok(after !== before && after.includes('\n'), '第 4 条分行：' + JSON.stringify(after));
  ok(after.split('\n').length <= 2, '不超 2 行');
  ok(after.replace(/\s/g, '') === before.replace(/\s/g, ''), '不删字');
  // 撤销
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  ok(ta(3).value === before, '撤销分行');
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));

  console.log('3. 真实按钮点击顺序：保留点击前光标（按比例）');
  const t1 = ta(0);
  t1.focus();
  t1.setSelectionRange(4, 4);
  realClickButton(rows()[0].querySelector('.op-split'));
  ok(rows().length === 10, '拆分后 10 条');
  ok(ta(0).value === '欢迎来到' && ta(1).value === '字幕节奏校准台',
    '保留点击前光标拆分（不是中点）：' + JSON.stringify([ta(0).value, ta(1).value]));
  ok(timeVal(0, 'end') === timeVal(1, 'start'), '分界连续：' + timeVal(0, 'end'));
  ok(timeVal(0, 'end') === '00:00:01,336', '4:7 比例分界 1336ms（非中点 1545）：' + timeVal(0, 'end'));
  const nums = rows().slice(0, 3).map(r => r.querySelector('.c-num').textContent);
  ok(nums.join(',') === '1,2,3', '编号重排：' + nums.join(','));

  console.log('3b. 拆分后新文本框仍聚焦时 Ctrl+Z 撤销结构变更');
  ok(window.document.activeElement === ta(1), '后段新文本框自动聚焦');
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  ok(rows().length === 9, '文本框聚焦下 Ctrl+Z 撤销拆分');
  ok(ta(0).value === '欢迎来到字幕节奏校准台', '撤销后文本合并还原');

  console.log('3c. 800ms 内连续两次拆分分别入栈，撤销一次只回退最后一次');
  // 第 1 次：在第 4 字符后拆
  ta(0).focus(); ta(0).setSelectionRange(4, 4);
  realClickButton(rows()[0].querySelector('.op-split'));
  ok(rows().length === 10, '连续拆分第 1 次');
  // 第 2 次：对后段立即（<800ms）在第 2 字符后再拆（Ctrl+Enter 路径，焦点在新文本框）
  ta(1).focus(); ta(1).setSelectionRange(2, 2);
  ta(1).dispatchEvent(new window.KeyboardEvent('keydown',
    { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
  ok(rows().length === 11, '连续拆分第 2 次（共 11 条）');
  // 撤销一次：只回退第 2 次
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  ok(rows().length === 10, '撤销一次仅回退最后一次拆分（回到 10 条）');
  ok(ta(0).value === '欢迎来到', '第 1 次拆分仍保留');
  // 再撤销：回退第 1 次
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  ok(rows().length === 9, '第二次撤销回退第 1 次拆分（回到 9 条）');
  ok(ta(0).value === '欢迎来到字幕节奏校准台', '完全还原');

  console.log('4. 光标开头拒绝');
  const t1fresh = ta(0);
  t1fresh.focus();
  t1fresh.setSelectionRange(0, 0);
  rows()[0].querySelector('.op-split')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  ok(rows().length === 9, '开头不拆分（实际 ' + rows().length + '）');
  ok(window.document.getElementById('statusMsg').textContent.includes('均需要有文本'),
    '说明原因：' + window.document.getElementById('statusMsg').textContent);

  console.log('5. 未聚焦文本框时点拆 → 中点回退');
  // 真实浏览器中点击按钮会把焦点移到按钮（jsdom 的 click 不转移焦点，这里显式聚焦模拟）
  const splitBtn = rows()[0].querySelector('.op-split');
  splitBtn.focus();
  click(splitBtn);
  ok(rows().length === 10, '中点回退拆分成功');
  ok(ta(0).value.length > 0 && ta(1).value.length > 0, '两侧均有文本');
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));

  console.log('6. 播放头在区间内拆分');
  // fitAll 使用 canvas.clientWidth||800；桩中 clientWidth=1000
  const canvas = window.document.getElementById('timeline');
  function canvasMouse(type, x, y) {
    const ev = new window.MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true });
    canvas.dispatchEvent(ev);
  }
  // 读取实际视图计算 2000ms 的 x：从 fitAll 逻辑复刻
  const cw = 1000, end = 23000, pad = Math.max(end * 0.04, 920);
  // app 的 pad 为 max(end*0.04,500)；用实际行末时间重算
  function xForTime(t) {
    // 通过 fit 后视图：startMs=-pad, pxPerMs=cw/(end+2pad)
    const p = Math.max(end * 0.04, 500);
    const ppm = cw / (end + 2 * p);
    return (t - (-p)) * ppm;
  }
  click(window.document.getElementById('btnFit'));
  canvasMouse('mousedown', xForTime(2000), 10);
  canvasMouse('mouseup', xForTime(2000), 10);
  ta(0).focus(); ta(0).setSelectionRange(4, 4);
  click(rows()[0].querySelector('.op-split'));
  ok(rows().length === 10, '播放头拆分条数');
  ok(timeVal(0, 'end') === '00:00:02,000', '以播放头 2000 为界：' + timeVal(0, 'end'));
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));

  console.log('7. 合并');
  const n = rows().length;
  const s0 = timeVal(0, 'start'), e1 = timeVal(1, 'end');
  click(rows()[0].querySelector('.op-merge'));
  ok(rows().length === n - 1, '合并条数 -1');
  ok(ta(0).value.includes('\n'), '合并文本两行');
  ok(timeVal(0, 'start') === s0 && timeVal(0, 'end') === e1, '时间覆盖原区间');
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  ok(rows().length === n, '撤销合并');

  console.log('8. 批量重排预览');
  click(window.document.getElementById('btnRewrapAll'));
  const modal = window.document.getElementById('rewrapModal');
  ok(!modal.classList.contains('hidden'), '预览弹窗显示');
  const rwRows = window.document.querySelectorAll('#rewrapTbody tr');
  ok(rwRows.length === 9, '预览 9 行');
  const willN = window.document.querySelectorAll('#rewrapTbody tr .st-ok').length;
  const failN = window.document.querySelectorAll('#rewrapTbody tr .st-fail').length;
  ok(willN > 0, `将重排 ${willN} 条`);
  click(window.document.getElementById('btnRewrapApply'));
  ok(modal.classList.contains('hidden'), '应用后关闭');
  const afterSummary = window.document.getElementById('problemSummary').textContent;
  ok(!/超长行|超行数/.test(afterSummary), '应用后无分行问题');
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  ok(/超长行/.test(window.document.getElementById('problemSummary').textContent), '撤销恢复问题');

  console.log('9. 设置变更重新检查');
  const mc = window.document.getElementById('setMaxChars');
  mc.value = '40';
  mc.dispatchEvent(new window.Event('change', { bubbles: true }));
  ok(!/超长行/.test(window.document.getElementById('problemSummary').textContent), '放宽规则后重检');
  mc.value = '18';
  mc.dispatchEvent(new window.Event('change', { bubbles: true }));

  console.log('10. 搜索仍可用（拆分后重编号）');
  // 先撤销第 11 节之前可能的拆分影响：此时仍是 9 条（前面均已撤销）
  ok(rows().length === 9, '搜索前置状态为 9 条（实际 ' + rows().length + '）');
  const si = window.document.getElementById('searchInput');
  si.value = '字幕';
  si.dispatchEvent(new window.Event('input', { bubbles: true }));
  const hits = window.document.querySelectorAll('#cueTbody tr.search-hit').length;
  ok(hits >= 1, `搜索命中 ${hits} 行`);
  si.value = '';
  si.dispatchEvent(new window.Event('input', { bubbles: true }));

  console.log('11. 输入未失焦直接拆分（编辑先提交）');
  const editTa = ta(0);
  editTa.focus();
  editTa.value = '全新输入的字幕内容ABC';
  editTa.setSelectionRange(7, 7);   // 「全新输入的字幕」|「内容ABC」
  click(rows()[0].querySelector('.op-split'));
  ok(rows().length === 10, '基于新输入拆分条数 +1');
  ok(ta(0).value === '全新输入的字幕' && ta(1).value === '内容ABC',
    '拆分使用未失焦的新文本：' + JSON.stringify([ta(0).value, ta(1).value]));
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  ok(rows().length === 9, '撤销恢复条数');

  console.log('12. 导出（拆分/重排后 SRT 编号连续）');
  // 做一次拆分再导出
  ta(0).focus(); ta(0).setSelectionRange(4, 4);
  click(rows()[0].querySelector('.op-split'));
  let exported = null;
  window.URL.createObjectURL = (blob) => { exported = blob; return 'blob:x'; };
  window.URL.revokeObjectURL = () => {};
  // 模拟下载点击
  const origClick = window.HTMLElement.prototype.click;
  window.HTMLElement.prototype.click = function () {
    if (this.tagName === 'A') { /* 不真正导航 */ }
    else origClick.call(this);
  };
  click(window.document.getElementById('btnExport'));
  window.HTMLElement.prototype.click = origClick;
  const text = await exported.text();
  const blocks = text.trim().split(/\n\n+/);
  ok(blocks.length === 10, `导出 ${blocks.length} 块`);
  blocks.forEach((b, i) => {
    const firstLine = b.split('\n')[0];
    ok(firstLine === String(i + 1), `第 ${i + 1} 块编号正确（实际 ${firstLine}）`);
  });
  ok(/\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/.test(text), 'SRT 时间格式');

  ok(errs.length === 0, 'jsdom 无错误事件' + (errs.length ? '：' + errs.join(' | ') : ''));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('异常：', e); process.exit(1); });
