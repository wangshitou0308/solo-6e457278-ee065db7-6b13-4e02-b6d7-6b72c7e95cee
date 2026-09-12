/* 逐词时间码 DOM 集成测试：用 jsdom 加载真实 index.html + app.js，
 * 验证 VTT 示例载入、词元轨道渲染、M 键顺序标记、输入时间、严格递增/区间校验、
 * 改区间两方案比较、撤销重做、草稿、搜索、SRT 剥离 / VTT 保留导出。
 * 运行：node tests/test_words_dom.js（未装 jsdom 时自动跳过）。 */
'use strict';
let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch (e) {
  console.log('跳过 tests/test_words_dom.js（未安装 jsdom）');
  process.exit(0);
}
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  ✓', label); }
  else { failed++; console.error('  ✗ FAIL:', label); }
}
function eq(actual, expected, label) {
  ok(actual === expected, label + `（实际 ${JSON.stringify(actual)}）`);
}

const html = fs.readFileSync(path.join(__dirname, '../static/index.html'), 'utf-8');
const coreSrc = fs.readFileSync(path.join(__dirname, '../static/core.js'), 'utf-8');
const appSrc = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf-8');
const serverPy = fs.readFileSync(path.join(__dirname, '../server.py'), 'utf-8');
const sampleVtt = serverPy.match(/SAMPLE_VTT = """([\s\S]*?)"""/)[1].replace(/\r\n/g, '\n');

const dom = new JSDOM(html, {
  url: 'http://127.0.0.1:8000/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;

window.fetch = function (url) {
  if (String(url).includes('/api/sample')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ filename: '示例-逐词时间码.vtt', content: sampleVtt }) });
  }
  if (String(url).includes('/api/draft')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ found: false, draft: null }) });
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
};
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
// wordRulerWrap 用 clientWidth
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 1000; } });
window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
window.cancelAnimationFrame = (id) => clearTimeout(id);
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.Element.prototype.scrollIntoView = function () {};

window.eval(coreSrc);
window.eval(appSrc);

const doc = window.document;
function rows() { return [...doc.querySelectorAll('#cueTbody tr')]; }
function click(el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); }
function key(target, spec) {
  target.dispatchEvent(new window.KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, spec)));
}
// 通过词元轨道把播放头定位到选中 cue 区间内的 tMs
function wordRulerSeek(tMs) {
  const ruler = doc.getElementById('wordRuler');
  const span = window.__dbgSelectedSpan();
  const x = (tMs - span.start) / (span.end - span.start) * 1000;
  ruler.dispatchEvent(new window.MouseEvent('mousedown', { clientX: x, clientY: 15, button: 0, bubbles: true }));
  ruler.dispatchEvent(new window.MouseEvent('mouseup', { clientX: x, clientY: 15, button: 0, bubbles: true }));
}
const tick = () => new Promise(r => setTimeout(r, 20));

(async () => {
  await new Promise(r => setTimeout(r, 100));
  const errs = [];
  window.addEventListener('error', e => errs.push(e.message));

  console.log('1. VTT 示例与词元轨道');
  eq(rows().length, 6, 'VTT 示例 6 条（实际 ' + rows().length + '）');
  // 选中第 1 条 → 展开词元轨道
  click(rows()[0]);
  await new Promise(r => setTimeout(r, 20));
  ok(!doc.getElementById('wordPanel').classList.contains('hidden'), '选中后展开词元轨道');
  const chips = () => [...doc.querySelectorAll('#wordChips .wc-chip')];
  const marked = () => chips().filter(c => c.classList.contains('marked'));
  // cue-1 有 4 个标记（“欢迎”两词未标，使用/字幕/节奏/校准台各一个）
  ok(marked().length === 4, 'cue-1 显示 4 个已标记词元（实际 ' + marked().length + '）');
  ok(chips().length >= 6, '全部正文词元可点');
  // 标签渲染为不可标记
  const tagEls = doc.querySelectorAll('#wordChips .wc-tag');
  ok(tagEls.length >= 2, '<v> 与 </v> 标签保留显示（' + tagEls.length + '）');

  console.log('2. M 键顺序标记下一个未标记词元');
  // 清空该条，从头顺序标记：700ms → 欢；1200ms → 迎
  click(doc.getElementById('btnWordClear'));
  await new Promise(r => setTimeout(r, 20));
  ok(marked().length === 0, '清空后无标记');
  wordRulerSeek(700);
  key(doc, { key: 'm' });
  await new Promise(r => setTimeout(r, 20));
  ok(marked().length === 1, 'M 标记第一个词元：' + marked().length);
  ok(/欢/.test(marked()[0].textContent), '第一个标记为「欢」：' + marked()[0].textContent);
  wordRulerSeek(1200);
  key(doc, { key: 'm' });
  await new Promise(r => setTimeout(r, 20));
  ok(marked().length === 2, 'M 标记第二个词元：' + marked().length);
  ok(/迎/.test(marked()[1].textContent), '第二个标记为「迎」：' + marked()[1].textContent);
  // 播放头早于上一标记再 M → 严格递增被拒
  wordRulerSeek(700);
  key(doc, { key: 'm' });
  await new Promise(r => setTimeout(r, 20));
  ok(/严格递增/.test(doc.getElementById('statusMsg').textContent),
    '倒序标记被拒：' + doc.getElementById('statusMsg').textContent);
  ok(marked().length === 2, '被拒后标记数不变');

  // 撤销两次 M
  key(doc, { key: 'z', ctrlKey: true });
  await new Promise(r => setTimeout(r, 20));
  key(doc, { key: 'z', ctrlKey: true });
  await new Promise(r => setTimeout(r, 20));
  ok(marked().length === 0, '撤销清除 M 标记');

  console.log('3. 严格递增与区间校验');
  // 在最后一个已标记词元之后，把播放头移到早于其标记的时刻再 M → 拒绝
  // 选一个新条 cue（cue-6），手动标记两个，制造倒序
  click(rows()[5]);
  await new Promise(r => setTimeout(r, 20));
  const chips6 = () => [...doc.querySelectorAll('#wordChips .wc-chip')];
  // 点一个已标记 chip → 出现输入框，改成区间外时间应被拒
  const markedChip = chips6().find(c => c.classList.contains('marked'));
  click(markedChip);
  let editor = doc.querySelector('#wordChips .wc-edit');
  ok(editor, '点击已标记词元出现时间输入框');
  editor.querySelector('input').value = '00:00:00,100';  // 早于 cue-6 起点 20s
  click(editor.querySelectorAll('button')[0]);           // 确定
  await new Promise(r => setTimeout(r, 20));
  ok(/必须位于字幕区间/.test(doc.getElementById('statusMsg').textContent),
    '区间外时间被拒绝：' + doc.getElementById('statusMsg').textContent);
  ok(doc.querySelector('#wordChips .wc-edit'), '被拒后输入框保留，模型未改');
  // 关闭编辑框
  click(doc.querySelector('#wordChips .wc-edit').querySelectorAll('button')[2]);

  console.log('4. 清除单个 / 全部标记');
  click(rows()[5]);
  const nBefore = marked().length;
  click(doc.querySelectorAll('#wordChips .wc-chip.marked')[0]);
  editor = doc.querySelector('#wordChips .wc-edit');
  click(editor.querySelectorAll('button')[1]);  // 清除
  await new Promise(r => setTimeout(r, 20));
  ok(marked().length === nBefore - 1, '清除单个标记：' + marked().length);
  click(doc.getElementById('btnWordClear'));
  await new Promise(r => setTimeout(r, 20));
  ok(marked().length === 0, '清空该条全部标记');

  console.log('5. 改 cue 区间：两方案比较，越界禁用');
  // 给 cue-1 重新顺序标记两个点（700 / 1200ms），再测试改起点
  click(rows()[0]);
  await new Promise(r => setTimeout(r, 20));
  wordRulerSeek(700); key(doc, { key: 'm' }); await tick();
  wordRulerSeek(1200); key(doc, { key: 'm' }); await tick();
  const startInput = rows()[0].querySelector('input[data-field="start"]');
  startInput.value = '00:00:01,000';
  startInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick();
  const modal = doc.getElementById('wordBoundsModal');
  ok(!modal.classList.contains('hidden'), '含标记时改区间弹出方案选择');
  ok(doc.getElementById('btnWbAbs').disabled, '保持绝对时间（700ms 会越界）被禁用');
  ok(!doc.getElementById('btnWbScale').disabled, '按比例缩放可用');
  ok(/落在新区间/.test(doc.getElementById('wbAbsState').textContent), '说明绝对方案越界原因');
  // 取消 → 区间与标记都不改
  click(doc.getElementById('btnWbCancel'));
  await tick();
  eq(rows()[0].querySelector('input[data-field="start"]').value, '00:00:00,500', '取消后区间还原');
  // 整体平移（→ 键）：标记随之平移，不弹窗
  key(doc, { key: 'ArrowRight' });
  await tick();
  eq(rows()[0].querySelector('input[data-field="start"]').value, '00:00:00,600', '→ 键平移区间 +100ms');
  eq(Math.round(window.__dbgPlayhead() >= 0 ? window.__dbgPlayhead() : -1) >= 0, true, '播放头可读');
  // 标记 700 → 800（fmtShort 00:00.8）
  ok([...doc.querySelectorAll('#wordChips .wc-chip.marked .wc-time')]
    .some(s => /00\.8/.test(s.textContent)), '标记随整体平移 +100ms');
  key(doc, { key: 'z', ctrlKey: true }); await tick();

  console.log('6. 撤销 / 重做覆盖逐词编辑');
  key(doc, { key: 'z', ctrlKey: true }); await tick();
  key(doc, { key: 'z', ctrlKey: true }); await tick();
  ok(!doc.getElementById('wordPanel').classList.contains('hidden'), '撤销后面板正常');
  key(doc, { key: 'y', ctrlKey: true }); await tick();
  key(doc, { key: 'y', ctrlKey: true }); await tick();
  ok(marked().length === 2, '重做恢复 2 个标记：' + marked().length);

  console.log('7. 搜索包含逐词内容（时间戳不干扰）');
  const si = doc.getElementById('searchInput');
  si.value = '校准台';
  si.dispatchEvent(new window.Event('input', { bubbles: true }));
  ok(doc.querySelectorAll('#cueTbody tr.search-hit').length >= 1, '搜索命中含时间戳的词');
  // 搜索数字串（cue-5 的 12345）
  si.value = '12345';
  si.dispatchEvent(new window.Event('input', { bubbles: true }));
  ok(doc.querySelectorAll('#cueTbody tr.search-hit').length >= 1, '搜索数字串命中');
  si.value = '';
  si.dispatchEvent(new window.Event('input', { bubbles: true }));

  console.log('8. 导出：VTT 保留时间戳，SRT 剥离');
  let vttOut = null, srtOut = null;
  window.URL.createObjectURL = (blob) => ({
    async text() { return blob.__text; },
  });
  // jsdom Blob 可取 text：直接截获 Blob 内容
  const OrigBlob = window.Blob;
  window.Blob = class extends OrigBlob {
    constructor(parts, opts) { super(parts, opts); this.__text = parts.join(''); }
  };
  let captured = null;
  window.URL.createObjectURL = (blob) => { captured = blob; return 'blob:x'; };
  window.URL.revokeObjectURL = () => {};
  const origClick = window.HTMLElement.prototype.click;
  window.HTMLElement.prototype.click = function () {
    if (this.tagName === 'A') { /* 不导航 */ } else origClick.call(this);
  };
  doc.getElementById('exportFormat').value = 'vtt';
  click(doc.getElementById('btnExport'));
  vttOut = captured.__text;
  // 文档中仍含未改动条目的内联时间戳（VTT 用 '.' 小数分隔）
  ok(/<\d{2}:\d{2}:\d{2}\.\d{3}>/.test(vttOut), 'VTT 导出保留逐词时间戳');
  ok(/<v 小明>/.test(vttOut), 'VTT 导出保留说话人标签');
  ok(/<ruby>/.test(vttOut), 'VTT 导出保留 ruby 标签');
  doc.getElementById('exportFormat').value = 'srt';
  click(doc.getElementById('btnExport'));
  srtOut = captured.__text;
  ok(!/<\d{2}:/.test(srtOut), 'SRT 导出不含逐词时间戳');
  ok(/<v 小明>/.test(srtOut), 'SRT 导出仍保留非时间戳标签');
  ok(/校准台/.test(srtOut) && /词元/.test(srtOut), 'SRT 导出正文完整');
  window.HTMLElement.prototype.click = origClick;

  console.log('9. 预览随播放头高亮当前词元');
  // cue-2 区间 3.4~6.5，标记 3.9/4.6/5.1/5.6；4.0s 应高亮“字幕”
  click(rows()[1]);
  await tick();
  wordRulerSeek(4000);
  await tick();
  const actives = doc.querySelectorAll('#wordChips .wc-chip.active');
  ok(actives.length === 1, '4.0s 时恰有一个当前词元高亮（' + actives.length + '）');
  if (actives.length) {
    // 3.9s 标记在「字」上，4.0s 当前词元为「字」（单字粒度，下一标记 4.6s 才到「幕」）
    ok(/^字/.test(actives[0].textContent), '4.0s 高亮「字」（实际 ' + actives[0].textContent + '）');
  }
  ok(/w-active/.test(doc.getElementById('nowCueText').innerHTML), '预览区当前词元高亮');
  // 标签在预览中保留为真实 HTML（ruby 在 cue-4、<v> 在 cue-1）
  click(rows()[3]);
  await tick();
  const span = window.__dbgSelectedSpan();
  wordRulerSeek(Math.round((span.start + span.end) / 2));
  await tick();
  ok(/<ruby>/.test(doc.getElementById('nowCueText').innerHTML), 'ruby 标签在预览中保留');
  click(rows()[0]);
  await tick();
  const span1 = window.__dbgSelectedSpan();
  wordRulerSeek(Math.round((span1.start + span1.end) / 2));
  await tick();
  ok(/vtt-voice/.test(doc.getElementById('nowCueText').innerHTML), '<v> 说话人标签在预览中保留');
  ok(errs.length === 0, 'jsdom 无错误事件' + (errs.length ? '：' + errs.join(' | ') : ''));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('异常：', e); process.exit(1); });
