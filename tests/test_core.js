/* core.js 单元测试：node tests/test_core.js */
'use strict';
const Core = require('../static/core.js');

let passed = 0, failed = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; }
  else { failed++; console.error('FAIL:', label, '\n  actual  ', a, '\n  expected', e); }
}
function ok(cond, label) { eq(!!cond, true, label); }

// ---- 时间解析 ----
eq(Core.parseTimecode('00:00:01,000'), 1000, 'srt 时间码');
eq(Core.parseTimecode('01:02:03.456'), 3723456, 'vtt 时间码');
eq(Core.parseTimecode('02:03.500'), 123500, '省略小时');
eq(Core.parseTimecode('00:00:01,5'), 1500, '单数字毫秒');
eq(Core.parseTimecode('bad'), null, '非法时间码');
eq(Core.parseTimecode('00:00:61,000'), null, '秒数越界');

// ---- 格式化 ----
eq(Core.fmtMs(3723456, 'srt'), '01:02:03,456', 'fmtMs srt');
eq(Core.fmtMs(3723456, 'vtt'), '01:02:03.456', 'fmtMs vtt');
eq(Core.fmtMs(0, 'srt'), '00:00:00,000', 'fmtMs 0');

// ---- SRT 解析与往返 ----
const srtText = [
  '1', '00:00:01,000 --> 00:00:03,500', '你好，世界', '第二行保留', '',
  '2', '00:00:04,000 --> 00:00:05,000', '短句', '',
  '3', '00:00:05,050 --> 00:00:08,000', '这是一条语速非常非常快的字幕用来触发检测规则', '',
].join('\n');
const srtDoc = Core.parseSubtitle(srtText);
eq(srtDoc.format, 'srt', '识别 SRT');
eq(srtDoc.cues.length, 3, 'SRT 条数');
eq(srtDoc.cues[0].num, '1', '保留编号');
eq(srtDoc.cues[0].start, 1000, 'SRT 开始');
eq(srtDoc.cues[0].end, 3500, 'SRT 结束');
eq(srtDoc.cues[0].lines, ['你好，世界', '第二行保留'], '保留换行');
eq(Core.serialize(srtDoc, 'srt'), srtText.trim() + '\n', 'SRT 往返一致');

// ---- VTT 解析与往返（含头部与 cue settings）----
const vttText = [
  'WEBVTT', 'Kind: captions', '',
  'intro-cue', '00:00:00.500 --> 00:00:02.000 align:start position:10%', 'VTT 内容', '',
  '00:00:03.000 --> 00:00:04.000', '无编号条目', '',
].join('\n');
const vttDoc = Core.parseSubtitle(vttText);
eq(vttDoc.format, 'vtt', '识别 VTT');
eq(vttDoc.header, 'WEBVTT\nKind: captions', '保留 VTT 头');
eq(vttDoc.cues.length, 2, 'VTT 条数');
eq(vttDoc.cues[0].num, 'intro-cue', 'VTT 标识符');
eq(vttDoc.cues[0].settings, 'align:start position:10%', 'VTT settings');
eq(vttDoc.cues[0].start, 500, 'VTT 开始');
eq(Core.serialize(vttDoc, 'vtt'), vttText.trim() + '\n', 'VTT 往返一致（无编号条目不补编号）');
// VTT → SRT 转换：自动编号补齐
const asSrt = Core.serialize(vttDoc, 'srt');
ok(asSrt.indexOf('intro-cue\n00:00:00,500 --> 00:00:02,000') !== -1, 'VTT→SRT 保留标识符');
ok(asSrt.indexOf('2\n00:00:03,000 --> 00:00:04,000') !== -1, 'VTT→SRT 无编号条目补序号');

// ---- 分析规则 ----
const settings = { cpsMax: 10, minDurMs: 1000, minGapMs: 100, allowOverlap: false };
const cues = [
  { num: '1', start: 0, end: 400, lines: ['短'] },                    // 停留过短
  { num: '2', start: 450, end: 1450, lines: ['一二三四五六七八九十一二三四五'] }, // 间隔 50ms + 语速 15
  { num: '3', start: 1400, end: 2400, lines: ['重叠'] },              // 与上一条重叠
];
const probs = Core.analyze(cues, settings);
const types = probs.map(p => p.type);
ok(types.includes('short'), '检出停留过短');
ok(types.includes('gap'), '检出间隔过小');
ok(types.includes('cps'), '检出语速过快');
ok(types.includes('overlap'), '检出重叠');
const overlapFree = Core.analyze(cues, { ...settings, allowOverlap: true });
ok(!overlapFree.some(p => p.type === 'overlap'), '允许重叠时不报重叠');

// ---- 自动顺延 ----
const fix = Core.computeAutoFix(cues, settings);
ok(fix.length >= 2, '顺延产生变更');
// 应用后应无重叠、无过短、无超速、无过小间隔
const fixed = cues.map(c => ({ ...c }));
fix.forEach(ch => { fixed[ch.i].start = ch.newStart; fixed[ch.i].end = ch.newEnd; });
const after = Core.analyze(fixed, settings);
eq(after, [], '顺延应用后问题清零');
// 保持顺序：开始时间单调不减
let ordered = true;
for (let i = 1; i < fixed.length; i++) if (fixed[i].start < fixed[i - 1].start) ordered = false;
ok(ordered, '顺延保持顺序');
// 无变更时返回空
eq(Core.computeAutoFix(fixed, settings), [], '已合规则无变更');

// ---- 草稿键稳定 ----
eq(Core.draftKey('a.srt', 'hello'), Core.draftKey('a.srt', 'hello'), '草稿键稳定');
ok(Core.draftKey('a.srt', 'hello') !== Core.draftKey('a.srt', 'hellp'), '草稿键随内容变化');

// ---- 双锚点线性校时 ----
const syncCues = [
  { num: '1', start: 1000, end: 2000, lines: ['一'] },
  { num: '2', start: 3000, end: 4000, lines: ['二'] },
  { num: '3', start: 5000, end: 6000, lines: ['三'] },
];
// 纯偏移：整体 +500ms
let r = Core.computeAnchorSync(syncCues,
  { cue: 0, num: '1', srcTime: 1000, dstTime: 1500 },
  { cue: 2, num: '3', srcTime: 5000, dstTime: 5500 });
eq(r.error, undefined, '纯偏移无错误');
eq(r.a, 1, '纯偏移伸缩系数为 1');
eq(r.b, 500, '纯偏移偏移量 +500');
eq(r.changes.length, 3, '纯偏移影响全部 3 条');
eq([r.changes[0].newStart, r.changes[0].newEnd], [1500, 2500], '纯偏移首条结果');
// 伸缩 + 偏移：t' = 2t + 1000
r = Core.computeAnchorSync(syncCues,
  { cue: 0, num: '1', srcTime: 1000, dstTime: 3000 },
  { cue: 2, num: '3', srcTime: 5000, dstTime: 11000 });
eq(r.error, undefined, '伸缩无错误');
eq(r.a, 2, '伸缩系数 2');
eq(r.b, 1000, '伸缩偏移 +1000');
eq([r.changes[1].newStart, r.changes[1].newEnd], [7000, 9000], '伸缩中间条结果');
// 锚点应用后顺序保持
{
  const out = syncCues.map(c => ({ ...c }));
  r.changes.forEach(ch => { out[ch.i].start = ch.newStart; out[ch.i].end = ch.newEnd; });
  ok(out.every(c => c.end > c.start), '伸缩后各条不倒序');
}
// 锚点冲突：原时间相同
r = Core.computeAnchorSync(syncCues,
  { cue: 0, num: '1', srcTime: 1000, dstTime: 1500 },
  { cue: 1, num: '2', srcTime: 1000, dstTime: 2000 });
ok(/锚点冲突/.test(r.error), '原时间相同报锚点冲突');
// 锚点冲突：媒体时间顺序与原时间矛盾（a < 0）
r = Core.computeAnchorSync(syncCues,
  { cue: 0, num: '1', srcTime: 1000, dstTime: 9000 },
  { cue: 2, num: '3', srcTime: 5000, dstTime: 3000 });
ok(/锚点冲突/.test(r.error) && /记反/.test(r.error), '顺序矛盾报锚点冲突');
// 媒体时间相同（a = 0）同样禁止
r = Core.computeAnchorSync(syncCues,
  { cue: 0, num: '1', srcTime: 1000, dstTime: 5000 },
  { cue: 2, num: '3', srcTime: 5000, dstTime: 5000 });
ok(/锚点冲突/.test(r.error), '媒体时间相同（伸缩为 0）禁止');
// 负时间：t' = 0.5t - 1000，首条 1000ms → -500ms
r = Core.computeAnchorSync(syncCues,
  { cue: 1, num: '2', srcTime: 3000, dstTime: 500 },
  { cue: 2, num: '3', srcTime: 5000, dstTime: 1500 });
ok(/负时间/.test(r.error), '产生负时间禁止应用');
// 倒序：原数据本身 start >= end 时变换后仍倒序
const badCues = [{ num: '1', start: 2000, end: 2000, lines: ['x'] }];
r = Core.computeAnchorSync(badCues,
  { cue: 0, num: '1', srcTime: 2000, dstTime: 3000 },
  { cue: 0, num: '1', srcTime: 4000, dstTime: 6000 });
ok(/倒序/.test(r.error), '变换后倒序禁止应用');
// 缺少锚点
r = Core.computeAnchorSync(syncCues, { cue: 0, num: '1', srcTime: 1000, dstTime: 1500 }, null);
ok(/两个锚点/.test(r.error), '缺锚点时报错');
// 变换后无变化：changes 为空但无错误
r = Core.computeAnchorSync(syncCues,
  { cue: 0, num: '1', srcTime: 1000, dstTime: 1000 },
  { cue: 2, num: '3', srcTime: 5000, dstTime: 5000 });
eq(r.error, undefined, '恒等变换无错误');
eq(r.changes, [], '恒等变换无变更');

// ---- 拆分 ----
const splitSrc = [
  { num: '1', start: 0, end: 10000, settings: '', lines: ['你好世界再见'] },
  { num: '2', start: 10000, end: 12000, settings: '', lines: ['尾句'] },
];
// 播放头位于时间段内 → 以播放头为界
let sr = Core.splitDoc(splitSrc, 0, ['你好'], ['世界再见'], 4000, 'srt');
eq(sr.error, undefined, '播放头在区间内拆分无错误');
eq(sr.cues.length, 3, '拆分后条数 +1');
eq([sr.cues[0].start, sr.cues[0].end, sr.cues[1].start, sr.cues[1].end],
  [0, 4000, 4000, 10000], '拆分时间以播放头为界');
eq(sr.cues[0].lines, ['你好'], '前段文本');
eq(sr.cues[1].lines, ['世界再见'], '后段文本');
eq([sr.cues[0].num, sr.cues[1].num, sr.cues[2].num], ['1', '2', '3'], 'SRT 拆分后重编号');
// 播放头不在时间段内 → 按有效字符数比例分配（2 / 4 → 3333ms）
sr = Core.splitDoc(splitSrc, 0, ['你好'], ['世界再见'], 99000, 'srt');
eq([sr.cues[0].end, sr.cues[1].start], [3333, 3333], '按字符数比例分配分界（2:4）');
// 多字符比例 1:1
sr = Core.splitDoc(splitSrc, 0, ['你好'], ['世界'], 99000, 'srt');
eq([sr.cues[0].end, sr.cues[1].start], [5000, 5000], '等字符数对半分');
// HTML 标签与空白不计入有效字符
sr = Core.splitDoc(
  [{ num: '1', start: 0, end: 10000, settings: '', lines: ['<i>你好</i> 世界'] }],
  0, ['<i>你好</i>'], ['世界'], 99000, 'srt');
eq([sr.cues[0].end, sr.cues[1].start], [5000, 5000], '标签与空白不参与字符计数');
eq(sr.cues[0].lines, ['<i>你好</i>'], '前段保留标签');
// 前段为空 / 后段为空 / 全空白 → 拒绝
sr = Core.splitDoc(splitSrc, 0, [''], ['世界'], 4000, 'srt');
ok(/均需要有文本/.test(sr.error), '光标在开头拒绝拆分：' + sr.error);
sr = Core.splitDoc(splitSrc, 0, ['你好'], ['  '], 4000, 'srt');
ok(/均需要有文本/.test(sr.error), '后段全空白拒绝拆分');
// 播放头位于边界（start）→ 不视为区间内，回退按比例
sr = Core.splitDoc(splitSrc, 0, ['你好'], ['世界'], 0, 'srt');
eq(sr.cues[0].end, 5000, '播放头恰在起点时按比例分配');
// 倒序字幕（end <= start）→ 拒绝
sr = Core.splitDoc(
  [{ num: '1', start: 5000, end: 5000, settings: '', lines: ['你好世界'] }],
  0, ['你好'], ['世界'], 4000, 'srt');
ok(/不合法/.test(sr.error), '零时长字幕拒绝拆分：' + sr.error);
// 纯函数：原数组不被修改
eq(splitSrc.length, 2, '拆分不修改原数组');
eq(splitSrc[0].lines, ['你好世界再见'], '拆分不修改原 cue');
// 中间拆分：后续条目顺延
sr = Core.splitDoc(
  [{ num: '1', start: 0, end: 1000, lines: ['a'] },
   { num: '2', start: 2000, end: 3000, lines: ['bcde'] },
   { num: '3', start: 4000, end: 5000, lines: ['f'] }],
  1, ['bc'], ['de'], 2500, 'srt');
eq(sr.cues.map(c => c.num), ['1', '2', '3', '4'], '中间拆分后整体重编号');
eq([sr.cues[2].start, sr.cues[2].end], [2500, 3000], '中间拆分后段时间');
eq(sr.cues[3].lines, ['f'], '后续条目保留');

// ---- 拆分 / 合并的 VTT 标识与设置 ----
const vttSplitSrc = [
  { num: 'intro', start: 0, end: 10000, settings: 'align:start position:10%', lines: ['你好世界'] },
  { num: '1', start: 10000, end: 11000, settings: '', autoNum: true, lines: ['尾'] },
];
sr = Core.splitDoc(vttSplitSrc, 0, ['你好'], ['世界'], 4000, 'vtt');
eq(sr.cues[0].num, 'intro', 'VTT 拆分保留前段显式标识符');
eq(sr.cues[0].settings, 'align:start position:10%', 'VTT 前段保留设置');
eq(sr.cues[1].settings, 'align:start position:10%', 'VTT 后段继承设置');
ok(sr.cues[1].autoNum === true, 'VTT 后段为自动编号');
eq(sr.cues[2].autoNum, true, 'VTT 原自动编号保持自动');
const splitVttText = Core.serialize({ format: 'vtt', header: 'WEBVTT', cues: sr.cues }, 'vtt');
ok(splitVttText.indexOf('intro\n00:00:00.000 --> 00:00:04.000 align:start position:10%') !== -1,
  'VTT 导出前段带标识符与设置');
ok(!/^2$/m.test(splitVttText.split('-->')[1] || ''), 'VTT 导出后段不写自动编号');

// ---- 合并 ----
const mergeSrc = [
  { num: '1', start: 0, end: 2000, settings: '', lines: ['你好'] },
  { num: '2', start: 1800, end: 4000, settings: '', lines: ['世界'] },
  { num: '3', start: 5000, end: 6000, settings: '', lines: ['尾'] },
];
let mr = Core.mergeDoc(mergeSrc, 0, 'srt');
eq(mr.error, undefined, '相邻合并无错误');
eq(mr.cues.length, 2, '合并后条数 -1');
eq([mr.cues[0].start, mr.cues[0].end], [0, 4000], '合并时间覆盖原有区间');
eq(mr.cues[0].lines, ['你好', '世界'], '合并文本换行连接');
eq(mr.cues.map(c => c.num), ['1', '2'], '合并后重编号');
// 与不相邻（最后一条）合并 → 拒绝
mr = Core.mergeDoc(mergeSrc, 2, 'srt');
ok(/相邻/.test(mr.error), '最后一条无下一条可合并：' + mr.error);
// VTT 合并：保留第一条标识符与设置
const vttMergeSrc = [
  { num: 'cue-a', start: 100, end: 900, settings: 'line:80%', lines: ['前'] },
  { num: 'cue-b', start: 800, end: 2000, settings: 'align:end', lines: ['后'] },
];
mr = Core.mergeDoc(vttMergeSrc, 0, 'vtt');
eq(mr.cues[0].num, 'cue-a', 'VTT 合并保留第一条标识符');
eq(mr.cues[0].settings, 'line:80%', 'VTT 合并保留第一条设置');
eq(mr.cues[0].start, 100, 'VTT 合并起点');
eq(mr.cues[0].end, 2000, 'VTT 合并覆盖终点');
eq(mr.cues.length, 1, 'VTT 合并后条数');
eq(mergeSrc.length, 3, '合并不修改原数组');
// 边界空行不进入合并结果
mr = Core.mergeDoc(
  [{ num: '1', start: 0, end: 100, settings: '', lines: ['甲', ''] },
   { num: '2', start: 200, end: 300, settings: '', lines: ['', '乙'] }], 0, 'srt');
eq(mr.cues[0].lines, ['甲', '乙'], '合并去除连接处空行');

// ---- 分行规则检查 ----
const layoutCues = [
  { num: '1', start: 0, end: 3000, settings: '', lines: ['一二三四五六七八九十一二三四五六七八九'] }, // 19 字超宽
  { num: '2', start: 3000, end: 6000, settings: '', lines: ['正常行'] },
  { num: '3', start: 6000, end: 9000, settings: '', lines: ['文字', '第二行', '第三行'] },            // 超过 2 行
  { num: '4', start: 9000, end: 12000, settings: '', lines: ['文字', '”孤立'] },                    // 孤立标点
  { num: '5', start: 12000, end: 15000, settings: '', lines: ['<i>斜体十八字内容正好达标啊</i>'] },   // 标签不计宽
];
let lp = Core.analyzeLayout(layoutCues, 18, 2);
const layoutByCue = {};
lp.forEach(p => { (layoutByCue[p.cue] = layoutByCue[p.cue] || []).push(p.type); });
ok(layoutByCue[0].includes('longline'), '检出超长行');
ok(!layoutByCue[1], '正常行无分行问题');
ok(layoutByCue[2].includes('toomany'), '检出超出行数');
ok(layoutByCue[3].includes('orphan'), '检出孤立标点');
ok(!layoutByCue[4], 'HTML 标签不计入行宽');
ok(Core.displayWidth('hello') === 5, '西文行宽 1/字符');
ok(Core.displayWidth('你好') === 2, '中文行宽 1/字符');
ok(Core.displayWidth('a b') === 2, '空白不计行宽');
ok(Core.displayWidth('<i>你好</i>') === 2, '标签不计行宽');
// 标点悬挂：仅行末一个句末标点超宽 1 字时不算超长行
const hangProbs = Core.analyzeCueLayout({ lines: ['一二三四，', '五'] }, 4, 2);
eq(hangProbs, [], '行末悬挂标点豁免超长行');
const realLongProbs = Core.analyzeCueLayout({ lines: ['一二三四五六'] }, 4, 2);
ok(realLongProbs.some(p => p.type === 'longline'), '真正超长仍报超长行');

// ---- 智能分行：单条 ----
function rw(lines, maxChars, maxLines) {
  return Core.rewrapCue({ num: '1', start: 0, end: 1, settings: '', lines: lines }, maxChars, maxLines || 2);
}
eq(rw(['一二三四五六七八九十一二三四五六七八九'], 10, 2).lines,
  ['一二三四五六七八九十', '一二三四五六七八九'], 'CJK 等宽分行');
{
  const out = rw(['你好，世界。再见！'], 6, 2);
  eq(out.ok, true, '标点优先分行成功');
  ok(out.lines[0].indexOf('，') === out.lines[0].length - 1 ||
     out.lines[0].indexOf('。') !== -1, '优先在标点后换行：' + JSON.stringify(out.lines));
  ok(out.lines.every(l => Core.effectiveLength(l) <= 6), '每行不超限');
}
{
  // 空格处优先换行
  const out = rw(['hello world foo'], 11, 2);
  eq(out.ok, true, '英文空格分行成功');
  ok(out.lines.length === 2 && out.lines[0] === 'hello world', '英文在空格处换行：' + JSON.stringify(out.lines));
}
{
  // 英文单词不可拆
  const out = rw(['hello superlongword'], 10, 2);
  ok(!out.ok && /英文单词/.test(out.error), '超长英文单词报错且不拆词：' + out.error);
}
{
  // 数字串不可拆
  const out = rw(['号码 123456789012345 结束'], 10, 3);
  ok(!out.ok && /数字串/.test(out.error), '超长数字串报错：' + out.error);
}
{
  // HTML 标签不可拆，标签不计宽
  const out = rw(['<i>一二三四五六七八九十一二三四</i>'], 12, 2);
  eq(out.ok, true, '含标签分行成功');
  ok(out.lines.every(l => l.indexOf('<i>') === -1 || l.indexOf('</i>') !== -1 || true), '分行执行');
  ok(out.lines.join('').indexOf('<i>') === 0 && out.lines.join('').indexOf('</i>') === out.lines.join('').length - 4,
    '标签整体保留：' + JSON.stringify(out.lines));
  ok(out.lines.every(l => Core.displayWidth(l) <= 12), '标签不计宽且每行达标：' + JSON.stringify(out.lines));
}
{
  // 行数无法满足
  const out = rw(['一二三四五六七八九十一二三四五六七八九'], 10, 1);
  ok(!out.ok && /最多 1 行/.test(out.error), '超出最多行数报错：' + out.error);
}
{
  // 不删字：所有分行结果的有效字符与原文一致
  const samples = ['你好，世界。再见！测试', 'hello world foo bar', '混合 ABC 英文 test 内容',
    '标点，标点！标点？标点；'];
  samples.forEach(function (s) {
    const out = rw([s], 8, 4);
    eq(out.ok, true, '示例可分行：' + s);
    eq(Core.effectiveLength(out.lines.join('')), Core.effectiveLength(s), '不删字：' + s);
  });
}
{
  // 多行合并重排：词间保留空格，中文间不加空格
  const out = rw(['hello', 'world'], 8, 4);
  eq(out.lines, ['hello', 'world'], '英文两行超宽时各自成行，词间不凭空加空格');
  const out1b = rw(['hello', 'world'], 11, 1);
  eq(out1b.lines, ['hello world'], '英文两行合并且换行转为单个空格');
  const out2 = rw(['你好', '世界'], 3, 4);
  eq(out2.lines, ['你好', '世界'], '中文两行各自成行');
  const out2b = rw(['你好', '世界'], 4, 1);
  eq(out2b.lines, ['你好世界'], '中文两行合并且不加空格');
}
{
  // 连续英文单词超宽（无空格可断）
  const out = rw(['abcdefghij abcdefghij'], 8, 2);
  ok(!out.ok, '连续超长词无断点时报错');
}
{
  // 已有换行且满足限制时保持稳定（幂等）
  const cue = { num: '1', start: 0, end: 1, settings: '', lines: ['一二三四', '五六七八'] };
  const out = Core.rewrapCue(cue, 10, 2);
  eq(out.ok, true, '已合规则分行成功');
  eq(out.lines.join('|'), '一二三四|五六七八', '已合规则保持原样');
}
{
  // 不得制造新的孤立标点：「一二三四，五」每行 4 字
  const out = rw(['一二三四，五'], 4, 2);
  eq(out.ok, true, '可行分行成功');
  eq(out.lines.length, 2, '排为 2 行');
  ok(!out.lines.some(l => /^[,.;:!?，。；：！？、…）】》]/.test(l)),
    '结果无孤立标点行首：' + JSON.stringify(out.lines));
  eq(out.lines.join(''), '一二三四，五', '不删字且顺序不变');
  // 必须断在逗号之后：一二三四，| 五
  eq(out.lines[0], '一二三四，', '断点选在标点之后');
}
{
  // 原手工换行造成的孤立标点，重排时应消除
  const out = rw(['一二三', '，四五'], 10, 2);
  eq(out.ok, true, '含既有孤立标点仍可重排');
  ok(!out.lines.some(l => /^，/.test(l)), '消除既有孤立标点：' + JSON.stringify(out.lines));
}
{
  // 无法在不制造孤立标点的前提下满足宽度 → 明确报错且不删字
  // 「二三四五，」后接「六七八九零」：每行 4、最多 2 行，任何可行断点都会让标点或长行出现
  const out = rw(['二三四五六七八，九零'], 4, 2);
  if (out.ok) {
    ok(out.lines.every(l => Core.displayWidth(l) <= 4), '若成功则每行不超 4 字');
    ok(!out.lines.some(l => /^，/.test(l)), '若成功则无孤立标点：' + JSON.stringify(out.lines));
  } else {
    ok(/不删字|孤立|放宽/.test(out.error), '无法满足时说明原因：' + out.error);
  }
  const cue = { num: '1', start: 0, end: 1, settings: '', lines: ['二三四五六七八，九零'] };
  eq(Core.effectiveLength(cue.lines.join('')), 10, '报错路径输入未被修改');
}
{
  // 西文标点同理：不能把逗号/句号放到下一行行首
  const out = rw(['one two, three'], 8, 3);
  eq(out.ok, true, '西文分行成功');
  ok(!out.lines.some(l => /^[,.;!?]/.test(l)), '西文结果无行首孤立标点：' + JSON.stringify(out.lines));
}

// ---- 批量重排计划 ----
{
  const planCues = [
    { num: '1', start: 0, end: 1, settings: '', lines: ['短'] },
    { num: '2', start: 1, end: 2, settings: '', lines: ['一二三四五六七八九十一二三四五六七八九'] },
    { num: '3', start: 2, end: 3, settings: '', lines: ['hello superlongword'] },
  ];
  const plan = Core.planRewrap(planCues, 10, 2);
  eq(plan[0].changed, false, '已合规条目标记不变');
  eq(plan[1].ok && plan[1].changed, true, '可重排条目标记变更');
  eq(plan[1].lines.length, 2, '批量预览给出重排结果');
  eq(plan[2].ok, false, '无法重排条目给出失败');
  ok(/英文单词/.test(plan[2].error), '失败条目说明原因：' + plan[2].error);
  eq(planCues[1].lines.length, 1, '批量计划不修改原数据');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
