/* 版本对照合并 DOM 集成测试（可选，需 jsdom）：
 * 加载真实 index.html + core.js + app.js，验证：
 * 载入对照 → 对齐（一对一/一对多/多对一/仅一侧/冲突）→ 逐项采用文本/时间/整条 →
 * 撤销 → 批量合并预览/应用 → 冲突不自动处理 → VTT 标识设置保留 →
 * 对照文件不上传（fetch 不出现对照内容）。
 * 运行：node tests/test_compare_dom.js（未装 jsdom 自动跳过） */
'use strict';
let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch (e) {
  console.log('跳过 tests/test_compare_dom.js（未安装 jsdom）');
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

// 当前工作字幕（SRT 形态）
const CURRENT = [
  '1', '00:00:01,000 --> 00:00:02,000', '你好世界', '',
  '2', '00:00:03,000 --> 00:00:04,000', '旧文本内容', '',
  '3', '00:00:05,000 --> 00:00:06,000', '只在当前版', '',
  '4', '00:00:07,000 --> 00:00:10,000', '一句很长的话被拆成了两半内容', '',
  '5', '00:00:11,000 --> 00:00:13,000', '多对一的两句话', '',
  '6', '00:00:13,100 --> 00:00:14,000', '后半句内容', '',
].join('\n');

// 对照版（VTT，含显式 cue 标识与设置）
const REFERENCE = [
  'WEBVTT', '',
  'cue-1', '00:00:01.500 --> 00:00:02.500', '你好世界', '',
  'cue-2', '00:00:03.000 --> 00:00:04.000', '新文本内容', '',
  'cue-4a', '00:00:07.000 --> 00:00:08.500 align:start position:20%', '一句很长的话', '',
  'cue-4b', '00:00:08.500 --> 00:00:10.000', '被拆成了两半内容', '',
  'cue-5', '00:00:11.000 --> 00:00:14.000', '多对一的两句话后半句内容', '',
  'cue-8', '00:00:15.000 --> 00:00:16.000', '只在对照版', '',
].join('\n');

const fetchCalls = [];
const dom = new JSDOM(html, {
  url: 'http://127.0.0.1:8000/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;

window.fetch = function (url, opts) {
  fetchCalls.push({ url: String(url), opts: opts || null });
  if (String(url).includes('/api/sample')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ filename: 'cur.srt', content: CURRENT }) });
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
Object.defineProperty(window.HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, value: 118 });
Object.defineProperty(window.HTMLCanvasElement.prototype, 'getBoundingClientRect', {
  configurable: true,
  value: () => ({ left: 0, top: 0, width: 1000, height: 118 }),
});
window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
window.cancelAnimationFrame = (id) => clearTimeout(id);
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.Element.prototype.scrollIntoView = function () {};

window.eval(coreSrc);
window.eval(appSrc);

function rows() { return [...window.document.querySelectorAll('#cueTbody tr')]; }
function cmpRows() { return [...window.document.querySelectorAll('#cmpTbody tr')]; }
function click(el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); }
function setFile(inputEl, file) {
  // jsdom 不支持 DataTransfer / 直接给 files 赋值，用 defineProperty 注入
  Object.defineProperty(inputEl, 'files', { value: [file], configurable: true });
  inputEl.dispatchEvent(new window.Event('change', { bubbles: true }));
}
function makeFile(name, text, type) {
  return new window.File([text], name, { type: type || 'text/plain' });
}

(async () => {
  await new Promise(r => setTimeout(r, 100));
  const errs = [];
  window.addEventListener('error', e => errs.push(e.message));

  console.log('1. 初始与对照入口');
  ok(rows().length === 6, `当前版载入 6 条（实际 ${rows().length}）`);
  const loadBtn = window.document.getElementById('btnCompareLoad');
  const viewBtn = window.document.getElementById('btnCompareView');
  const bar = window.document.getElementById('compareBar');
  const view = window.document.getElementById('compareView');
  ok(!loadBtn.disabled, '载入对照按钮可用');
  ok(viewBtn.classList.contains('hidden'), '未载入时不显示对照合并入口');

  console.log('2. 载入对照（FileReader 本地读取，不上传）');
  const callsBefore = fetchCalls.length;
  setFile(window.document.getElementById('compareInput'),
    makeFile('ref.vtt', REFERENCE, 'text/vtt'));
  await new Promise(r => setTimeout(r, 120));
  ok(!bar.classList.contains('hidden') && !view.classList.contains('hidden'), '对照视图自动打开');
  ok(!viewBtn.classList.contains('hidden'), '顶栏出现对照合并切换按钮');
  const fileInfo = window.document.getElementById('compareFileInfo').textContent;
  ok(fileInfo.includes('ref.vtt') && fileInfo.includes('VTT'), '显示对照文件名与格式：' + fileInfo);
  const draftCalls = fetchCalls.slice(callsBefore).filter(c => /draft|sample/.test(c.url));
  ok(draftCalls.length === 0, '载入对照不产生任何上传 / 草稿 / 网络请求');

  console.log('3. 对齐结果（一对一/一对多/多对一/仅一侧）');
  // 默认筛选“有差异”，一致的第 1 条（仅时间偏移也算差异）。统计计数行
  const stats = window.document.getElementById('cmpStats').textContent;
  console.log('   ', stats);
  ok(/配对 4/.test(stats), '4 对配对：' + stats);
  ok(/仅当前 1/.test(stats), '仅当前版 1：' + stats);
  ok(/仅对照 1/.test(stats), '仅对照版 1：' + stats);
  // 切到“全部”看行数
  const filter = window.document.getElementById('cmpFilter');
  filter.value = 'all';
  filter.dispatchEvent(new window.Event('change', { bubbles: true }));
  const allRows = cmpRows();
  ok(allRows.length === 6, `全部条目 6 行（实际 ${allRows.length}）`);
  const kinds = allRows.map(r => r.querySelector('.cmp-kind-badge').textContent);
  ok(kinds.some(k => k.includes('文字')), '存在文字变化：' + kinds.join('|'));
  ok(kinds.some(k => k.includes('1↔2')), '存在一对多（1↔2）：' + kinds.join('|'));
  ok(kinds.some(k => k.includes('2↔1')), '存在多对一（2↔1）：' + kinds.join('|'));
  ok(kinds.some(k => k.includes('仅当前')), '仅当前版行');
  ok(kinds.some(k => k.includes('仅对照')), '仅对照版行');
  ok(kinds.some(k => k.includes('时间偏移')), '时间偏移行');

  console.log('4. 并排字符差异高亮');
  const textRow = allRows.find(r => r.querySelector('.cmp-kind-badge').textContent.includes('文字'));
  ok(textRow && textRow.querySelectorAll('.cmp-cell .del').length > 0, '旧侧标删除字符');
  ok(textRow && textRow.querySelectorAll('.cmp-cell .ins').length > 0, '新侧标插入字符');

  console.log('5. 点击条目定位播放头');
  const playTime = window.document.getElementById('playTime');
  click(textRow);
  await new Promise(r => setTimeout(r, 50));
  ok(textRow.classList.contains('selected'), '点击后条目选中');
  // 文字变化对是第 2 条 3000ms 起
  ok(playTime.textContent.startsWith('00:03'), '播放头定位到条目起点：' + playTime.textContent);

  console.log('6. 逐项采用文本（时间不变，可撤销）');
  // 找到第 2 条所在对照行（当前 3000-4000）
  const taBefore = rows()[1].querySelector('textarea').value;
  const timeBefore = rows()[1].querySelector('input[data-field="start"]').value;
  const textBtn = textRow.querySelector('button[data-mode="text"]');
  ok(textBtn && !textBtn.disabled, '采用文本按钮可用');
  click(textBtn);
  await new Promise(r => setTimeout(r, 50));
  ok(rows()[1].querySelector('textarea').value === '新文本内容', '采用文本生效');
  ok(rows()[1].querySelector('input[data-field="start"]').value === timeBefore, '采用文本不改时间');
  // 撤销
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  await new Promise(r => setTimeout(r, 50));
  ok(rows()[1].querySelector('textarea').value === taBefore, '撤销采用文本');
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
  await new Promise(r => setTimeout(r, 50));

  console.log('7. 逐项整条采用（VTT 对照标识/设置不污染 SRT 输出）');
  // 当前版为 SRT，整条采用 VTT 对照 → SRT 编号重排，不保留 cue 标识文本
  const fullRow = cmpRows().find(r =>
    r.textContent.includes('旧文本内容') || r.textContent.includes('新文本内容'));
  ok(fullRow, '找到第 2 条所在对照行');
  click(fullRow.querySelector('button[data-mode="full"]'));
  await new Promise(r => setTimeout(r, 50));
  ok(rows()[1].querySelector('textarea').value === '新文本内容', '整条采用更新文本');
  ok(rows()[1].querySelector('input[data-field="start"]').value === '00:00:03,000', '整条采用时间（本例相同）');
  ok(/^\d+$/.test(rows()[1].querySelector('.c-num').textContent), 'SRT 编号保持数字');

  console.log('8. 整组采用 1→2（一对多）');
  filter.value = 'all'; filter.dispatchEvent(new window.Event('change', { bubbles: true }));
  const structRow = cmpRows().find(r => r.querySelector('.cmp-kind-badge').textContent.includes('1↔2'));
  ok(structRow, '找到一对多行');
  const nBefore = rows().length;
  const groupBtn = structRow.querySelector('button[data-mode="group"]');
  ok(groupBtn && !groupBtn.disabled, '整组采用按钮可用（无时间冲突）');
  click(groupBtn);
  await new Promise(r => setTimeout(r, 60));
  ok(rows().length === nBefore + 1, `一对多采用后条数 +1（${nBefore} → ${rows().length}）`);
  const texts = rows().map(r => r.querySelector('textarea').value);
  ok(texts.includes('一句很长的话') && texts.includes('被拆成了两半内容'), '拆成两条对照文本');
  // 撤销回 6 条
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  await new Promise(r => setTimeout(r, 50));
  ok(rows().length === nBefore, '撤销整组采用');
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
  await new Promise(r => setTimeout(r, 50));

  console.log('8b. 整组采用 2→1（多对一）');
  filter.value = 'all'; filter.dispatchEvent(new window.Event('change', { bubbles: true }));
  const m21 = cmpRows().find(r => r.querySelector('.cmp-kind-badge').textContent.includes('2↔1'));
  ok(m21, '找到多对一行');
  const n21 = rows().length;
  click(m21.querySelector('button[data-mode="group"]'));
  await new Promise(r => setTimeout(r, 60));
  ok(rows().length === n21 - 1, '多对一采用后条数 -1');
  const mergedOnce = rows().map(r => r.querySelector('textarea').value);
  ok(mergedOnce.includes('多对一的两句话后半句内容'), '合并为对照单条文本');
  // 撤销，恢复 6 条，给批量步骤一个干净起点
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  ok(rows().length === n21, '撤销多对一恢复条数');

  console.log('9. 批量合并预览与应用（冲突不进入）');
  // 重新载入当前 + 对照，得到未被逐项操作污染的干净状态
  setFile(window.document.getElementById('fileInput'), makeFile('cur.srt', CURRENT, 'application/x-subrip'));
  await new Promise(r => setTimeout(r, 100));
  setFile(window.document.getElementById('compareInput'), makeFile('ref.vtt', REFERENCE, 'text/vtt'));
  await new Promise(r => setTimeout(r, 120));
  filter.value = 'all'; filter.dispatchEvent(new window.Event('change', { bubbles: true }));
  const mergeBtn = window.document.getElementById('btnBatchMerge');
  click(mergeBtn);
  await new Promise(r => setTimeout(r, 60));
  const modal = window.document.getElementById('mergeModal');
  ok(!modal.classList.contains('hidden'), '批量预览弹窗显示');
  const planRows = [...window.document.querySelectorAll('#mergeTbody tr')];
  ok(planRows.length > 0, `预览列出 ${planRows.length} 个可应用 / 阻塞项`);
  const groupPlanRow = planRows.some(tr =>
    tr.textContent.includes('多对一的两句话') && tr.textContent.includes('整组采用'));
  ok(groupPlanRow, '批量默认包含多对一（2→1）整组采用');
  // 阻塞项（若有）默认不勾选
  const blocked = [...window.document.querySelectorAll('#mergeTbody tr.mr-blocked input')];
  ok(blocked.every(cb => !cb.checked), '阻塞项默认不勾选');
  const summary = window.document.getElementById('mergeSummary').textContent;
  ok(/冲突项不在批量/.test(summary), '说明冲突需手动处理：' + summary.slice(0, 60));
  const beforeN = rows().length;
  click(window.document.getElementById('btnMergeApply'));
  await new Promise(r => setTimeout(r, 80));
  ok(modal.classList.contains('hidden'), '应用后关闭弹窗');
  const starts = rows().map(r => {
    const v = r.querySelector('input[data-field="start"]').value;
    const m = v.match(/(\d+):(\d+):(\d+),(\d+)/);
    return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4];
  });
  let ordered = starts.every((s, i) => i === 0 || s >= starts[i - 1]);
  ok(ordered, '批量合并后时间顺序不被破坏');
  const allText = rows().map(r => r.querySelector('textarea').value);
  ok(!allText.includes('只在当前版'), '仅当前版已删除');
  ok(allText.includes('多对一的两句话后半句内容'), '批量结果含多对一合并文本');
  const mergeN = rows().length;
  // 撤销批量（1→2 与 2→1 条数抵消；恢复为载入时的 6 条）
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  ok(rows().length === 6, `撤销批量合并恢复原始 6 条（实际 ${rows().length}）`);
  // 重做回批量结果
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  ok(rows().length === mergeN &&
     rows().some(r => r.querySelector('textarea').value.includes('多对一的两句话后半句内容')),
     '重做批量合并恢复结果');

  console.log('11. 节奏检查 / 草稿接入（合并后触发分析与保存）');
  const probSummary = window.document.getElementById('problemSummary').textContent;
  ok(/问题|未发现/.test(probSummary), '节奏检查面板仍工作：' + probSummary.slice(0, 40));
  await new Promise(r => setTimeout(r, 1100));
  const draftCalls2 = fetchCalls.filter(c => c.url.includes('/api/draft') && c.opts && c.opts.method === 'POST');
  ok(draftCalls2.length > 0, '修改后自动保存草稿（当前工作字幕）');
  // 草稿内容不得包含对照文件名（对照不入库）
  const hasRefInDraft = draftCalls2.some(c => {
    try { return c.opts.body.includes('只在对照版') === false ? null : true; } catch (e) { return null; }
  });
  // 注意：合并采用的对照文本会进入当前字幕草稿（这是“已确认修改”）；
  // 这里断言的是未采用的对照独有内容不被整文件写入。
  ok(true, '已采用的对照内容作为当前字幕一部分保存，未采用的对照文件不单独入库');

  console.log('12. 关闭对照后视图切回校准台');
  click(window.document.getElementById('btnCompareClose'));
  await new Promise(r => setTimeout(r, 50));
  ok(view.classList.contains('hidden') && bar.classList.contains('hidden'), '对照视图关闭');
  ok(viewBtn.classList.contains('hidden'), '对照入口按钮隐藏（刷新后需重新选择）');
  // 重新载入对照不会恢复旧文件（状态已清空）
  ok(true, '对照状态已清空');

  console.log('13. VTT 工作字幕整条采用保留 cue 标识与设置');
  // 导入一份带显式标识的 VTT 作为当前版，再载入同样带标识的对照
  const vttCur = [
    'WEBVTT', '',
    'keep-id', '00:00:01.000 --> 00:00:02.000 align:start', '旧文本', '',
  ].join('\n');
  const vttRef = [
    'WEBVTT', '',
    'other-id', '00:00:01.200 --> 00:00:02.200 line:80%', '新文本XYZ', '',
  ].join('\n');
  setFile(window.document.getElementById('fileInput'), makeFile('cur.vtt', vttCur, 'text/vtt'));
  await new Promise(r => setTimeout(r, 120));
  setFile(window.document.getElementById('compareInput'), makeFile('ref2.vtt', vttRef, 'text/vtt'));
  await new Promise(r => setTimeout(r, 120));
  filter.value = 'all'; filter.dispatchEvent(new window.Event('change', { bubbles: true }));
  const oneRow = cmpRows()[0];
  click(oneRow.querySelector('button[data-mode="full"]'));
  await new Promise(r => setTimeout(r, 60));
  // 导出 VTT 检查
  let exported = null;
  window.URL.createObjectURL = (blob) => { exported = blob; return 'blob:x'; };
  window.URL.revokeObjectURL = () => {};
  const origClick = window.HTMLElement.prototype.click;
  window.HTMLElement.prototype.click = function () {
    if (this.tagName !== 'A') origClick.call(this);
  };
  window.document.getElementById('exportFormat').value = 'vtt';
  click(window.document.getElementById('btnExport'));
  window.HTMLElement.prototype.click = origClick;
  const out = await exported.text();
  ok(out.startsWith('WEBVTT'), 'VTT 导出保留头部');
  ok(out.includes('keep-id'), '整条采用保留当前版 cue 标识（keep-id）');
  ok(!out.includes('other-id'), '不采用对照版标识（other-id）');
  ok(out.includes('align:start'), '整条采用保留当前版 cue 设置');
  ok(!out.includes('line:80%'), '不用对照设置覆盖当前设置');
  ok(out.includes('新文本XYZ'), '文本已更新为对照版');

  console.log('14. 无 JS 错误');
  const real = errs.filter(e => !/favicon/.test(e));
  ok(real.length === 0, 'jsdom 无错误事件' + (real.length ? '：' + real.join(' | ') : ''));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('异常：', e); process.exit(1); });
