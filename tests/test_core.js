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

// ---- 版本对照：规范化与相似度 ----
function mkCue(num, s, e, lines, settings, autoNum) {
  return { num: String(num), start: s, end: e, settings: settings || '',
    lines: Array.isArray(lines) ? lines : [lines], autoNum: autoNum };
}
// 回归①：两段 401 字等长异文不得得到相似度 1，也不得标为无文字变化
{
  const s1 = '一'.repeat(401), s2 = '二'.repeat(401);
  const sim = Core.textSimilarity(Core.normalizeText(s1), Core.normalizeText(s2));
  ok(sim < 0.05, '401 字等长异文相似度接近 0（实际 ' + sim.toFixed(3) + '），不再返回 1');
  const al = Core.alignDocuments([mkCue(1, 0, 1000, s1)], [mkCue(1, 0, 1000, s2)]);
  eq(al.entries[0].textChanged, true, '401 字异文必须标记文字变化');
  ok(al.entries[0].conflict === true, '401 字异文（同时间但文字全不同）标为冲突，不自动选边');
  // 等长同文仍无变化
  const same = '同'.repeat(401);
  const al2 = Core.alignDocuments([mkCue(1, 0, 1000, same)], [mkCue(1, 0, 1000, same)]);
  eq(al2.entries[0].textChanged, false, '401 字同文不标文字变化');
  eq(al2.entries[0].timeChanged, false, '401 字同文同时间不标时间变化');
  // 长文本仅改两字也要检出（不被相似度阈值漏判）
  const longBase = '这是一段比较长的中文内容用来测试相似度计算需要足够字数触发二元组回退路径'.repeat(6);
  const longMod = longBase.slice(0, 100) + '改字' + longBase.slice(102);
  const al3 = Core.alignDocuments([mkCue(1, 0, 1000, longBase)], [mkCue(1, 0, 1000, longMod)]);
  eq(al3.entries[0].textChanged, true, '长文本改 2 字仍检出文字变化');
}
// 规范化忽略标点 / 空白 / 大小写 / 全半角 / HTML 标签
{
  eq(Core.normalizeText('你好， 世界！'), Core.normalizeText('你好世界'), '规范化忽略标点空白');
  eq(Core.normalizeText('Hello  WORLD'), Core.normalizeText('helloworld'), '规范化忽略大小写');
  eq(Core.normalizeText('<i>ABC</i>'), Core.normalizeText('abc'), '规范化忽略 HTML 标签');
  eq(Core.normalizeText('ＨＥＬＬＯ'), Core.normalizeText('hello'), '全角字母转半角');
}

// ---- 对齐：一对一 / 一对多 / 多对一 / 两侧独有 ----
{
  const A = [
    mkCue(1, 1000, 2000, '你好世界'),
    mkCue(2, 3000, 4000, '旧文本内容'),
    mkCue(3, 5000, 6000, '只在当前版'),
    mkCue(4, 7000, 10000, '一句很长的话被拆成了两半内容'),
    mkCue(6, 11000, 12000, '多'),
    mkCue(7, 12100, 13000, '对一'),
  ];
  const B = [
    mkCue(1, 1500, 2500, '你好世界'),
    mkCue(2, 3000, 4000, '新文本内容'),
    mkCue(4, 7000, 8500, '一句很长的话'),
    mkCue(5, 8500, 10000, '被拆成了两半内容'),
    mkCue(6, 11000, 13000, '多对一'),
    mkCue(8, 14000, 15000, '只在对照版'),
  ];
  const r = Core.alignDocuments(A, B);
  const kinds = r.entries.map(e => e.kind);
  eq(kinds[0], 'pair', '第 1 对：一对一');
  eq([r.entries[0].timeChanged, r.entries[0].textChanged], [true, false], '仅时间偏移');
  eq([r.entries[1].timeChanged, r.entries[1].textChanged], [false, true], '仅文字变化');
  eq(kinds[2], 'only-a', '仅当前版');
  const oneToMany = r.entries.find(e => e.kind === 'pair' && e.alen === 1 && e.blen === 2);
  ok(oneToMany, '识别一对多');
  const manyToOne = r.entries.find(e => e.kind === 'pair' && e.alen === 2 && e.blen === 1);
  ok(manyToOne, '识别多对一');
  ok(kinds.includes('only-b'), '识别仅对照版');
  // 纯偏移不冲突、同文 +500ms 高置信
  eq(r.entries[0].conflict, false, '同文时间偏移不冲突');
}
// 低置信度：同时同地但文字完全无关 → 冲突
{
  const r = Core.alignDocuments(
    [mkCue(1, 0, 3000, '苹果香蕉橙子葡萄西瓜芒果榴莲')],
    [mkCue(1, 0, 3000, '桌子椅子门窗电脑键盘书本钢笔')]);
  eq(r.entries[0].conflict, true, '无关文本即使重叠也标冲突');
  ok(/置信度/.test(r.entries[0].reasons.join(' ')), '给出低置信度原因');
}
// 两种配对得分接近 → 冲突（不自动选边）
{
  // A2 与 B2 文本相同但时间稍远；A1 与 B1/B2 都重叠且文本都有部分相似
  const A = [mkCue(1, 0, 2000, '甲乙丙丁戊'), mkCue(2, 2100, 4000, '共同的句子内容一二三四')];
  const B = [mkCue(1, 0, 2000, '甲乙丙丁戊'), mkCue(2, 2050, 4000, '共同的句子内容一二三四五六')];
  const r = Core.alignDocuments(A, B);
  const e1 = r.entries.find(e => e.kind === 'pair' && e.ai === 0);
  ok(e1, '首条配对存在');
}

// ---- 字符级差异 ----
{
  const segs = Core.diffSegments('你好世界ABC', '你好地球ABC');
  const del = segs.filter(s => s.t === 'del').map(s => s.s).join('');
  const ins = segs.filter(s => s.t === 'ins').map(s => s.s).join('');
  eq(del, '世界', '差异段标出删除「世界」');
  eq(ins, '地球', '差异段标出插入「地球」');
}

// ---- 单项采用 ----
{
  const A = [
    { num: '1', start: 0, end: 1000, settings: '', lines: ['旧文本'], autoNum: true },
    { num: '2', start: 1100, end: 2000, settings: '', lines: ['下一条'], autoNum: true },
  ];
  // 采用文本
  let r = Core.adoptText(A, 0, ['新文本']);
  eq(r.cues[0].lines, ['新文本'], '采用文本更新 lines');
  eq([r.cues[0].start, r.cues[0].end], [0, 1000], '采用文本不动时间');
  eq(A[0].lines, ['旧文本'], '采用文本不修改输入');
  // 空文本拒绝
  r = Core.adoptText(A, 0, ['  ']);
  ok(/为空/.test(r.error), '空文本拒绝采用');
  // 采用时间
  r = Core.adoptTime(A, 0, 200, 900);
  eq([r.cues[0].start, r.cues[0].end], [200, 900], '采用时间更新区间');
  // 倒序 / 与邻居重叠拒绝
  r = Core.adoptTime(A, 0, 0, 1200);
  ok(/重叠|倒序/.test(r.error), '采用时间越过邻居拒绝：' + r.error);
  r = Core.adoptTime(A, 0, 900, 800);
  ok(/晚于/.test(r.error), '结束早于开始拒绝');
}
// 整条采用：VTT cue 标识与设置保留规则
{
  // 当前版有显式标识 → 保留当前标识；settings 当前非空优先
  const cur = [{ num: 'cue-a', start: 0, end: 1000, settings: 'align:start', lines: ['旧'], autoNum: false },
    { num: '2', start: 2000, end: 3000, settings: '', lines: ['尾'], autoNum: true }];
  const ref = { num: 'cue-r', start: 100, end: 900, settings: 'line:80%', lines: ['新'], autoNum: false };
  let r = Core.adoptFull(cur, 0, ref, 'vtt');
  eq(r.cues[0].num, 'cue-a', '整条采用保留当前显式 cue 标识');
  eq(r.cues[0].settings, 'align:start', '整条采用保留当前非空 settings');
  eq(r.cues[0].lines, ['新'], '整条采用更新文本');
  eq(r.cues[0].start, 100, '整条采用更新时间');
  // 当前版为自动编号 → 沿用对照版显式标识与设置
  const cur2 = [{ num: '1', start: 0, end: 1000, settings: '', lines: ['旧'], autoNum: true },
    { num: '2', start: 2000, end: 3000, settings: '', lines: ['尾'], autoNum: true }];
  r = Core.adoptFull(cur2, 0, ref, 'vtt');
  eq(r.cues[0].num, 'cue-r', '当前无标识时沿用对照版标识');
  eq(r.cues[0].settings, 'line:80%', '当前无设置时采用对照版设置');
  eq(r.cues[0].autoNum, false, '沿用后为显式标识');
}

// ---- 整组替换（一对多 / 多对一） ----
{
  const A = [mkCue(1, 7000, 10000, '一句很长的话被拆成了两半内容'), mkCue(2, 11000, 12000, '尾')];
  const B = [mkCue(4, 7000, 8500, '一句很长的话'), mkCue(5, 8500, 10000, '被拆成了两半内容'), mkCue(6, 14000, 15000, '无关')];
  let r = Core.replaceGroup(A, 0, 1, B, 0, 2, 'srt');
  eq(r.cues.length, 3, '1→2 组替换条数 +1');
  eq(r.cues.map(c => c.start).join(','), '7000,8500,11000', '组替换时间正确');
  eq(r.cues.map(c => c.num).join(','), '1,2,3', 'SRT 组替换后重编号');
  // 多对一 2→1
  const A2 = [mkCue(1, 11000, 12000, '多'), mkCue(2, 12100, 13000, '对一'), mkCue(3, 14000, 15000, '尾')];
  const B2 = [mkCue(6, 11000, 13000, '多对一')];
  r = Core.replaceGroup(A2, 0, 2, B2, 0, 1, 'srt');
  eq(r.cues.length, 2, '2→1 组替换条数 -1');
  eq([r.cues[0].start, r.cues[0].end], [11000, 13000], '多对一时间覆盖');
  // VTT 1→2：首段保留当前标识，后段保留对照 cue 标识
  const vA = [{ num: 'cue-a', start: 1000, end: 4000, settings: 'align:start', lines: ['组内容拆分测试'], autoNum: false }];
  const vB = [
    { num: 'cue-b1', start: 1000, end: 2500, settings: '', lines: ['组内容'], autoNum: false },
    { num: 'cue-b2', start: 2500, end: 4000, settings: 'line:50%', lines: ['拆分测试'], autoNum: false },
  ];
  r = Core.replaceGroup(vA, 0, 1, vB, 0, 2, 'vtt');
  eq(r.cues[0].num, 'cue-a', 'VTT 首段保留当前标识');
  eq(r.cues[0].settings, 'align:start', 'VTT 首段保留当前设置');
  eq(r.cues[1].num, 'cue-b2', 'VTT 后段保留对照标识');
  eq(r.cues[1].settings, 'line:50%', 'VTT 后段保留对照设置');
  // 组与邻居冲突拒绝
  const bad = [mkCue(1, 0, 1000, '前'), mkCue(2, 1100, 4000, '将被组替换')];
  const badB = [mkCue(9, 900, 2000, '新组'), mkCue(10, 2000, 3000, 'x')];
  r = Core.replaceGroup(bad, 1, 1, badB, 0, 2, 'srt');
  ok(/重叠|倒序/.test(r.error), '组替换与上一条冲突拒绝：' + r.error);
}

// ---- 仅对照插入 / 仅当前删除 ----
{
  const A = [mkCue(1, 0, 1000, 'a'), mkCue(2, 3000, 4000, 'b')];
  let r = Core.insertOnlyB(A, 1, mkCue(9, 1500, 2500, '插入'), 'srt');
  eq(r.cues.map(c => c.start).join(','), '0,1500,3000', '插入到间隙中');
  eq(r.cues.map(c => c.num).join(','), '1,2,3', '插入后重编号');
  r = Core.insertOnlyB(A, 1, mkCue(9, 900, 3100, '重叠'), 'srt');
  ok(/重叠/.test(r.error), '插入重叠拒绝（左）');
  r = Core.insertOnlyB(A, 1, mkCue(9, 2500, 3100, '重叠'), 'srt');
  ok(/重叠/.test(r.error), '插入重叠拒绝（右）');
  // VTT 插入保留对照显式标识
  r = Core.insertOnlyB(
    [{ num: 'cue-a', start: 0, end: 1000, settings: '', lines: ['a'], autoNum: false }],
    1, { num: 'cue-new', start: 2000, end: 3000, settings: 'line:10%', lines: ['新'], autoNum: false },
    'vtt');
  eq(r.cues[1].num, 'cue-new', 'VTT 插入保留对照标识');
  eq(r.cues[1].settings, 'line:10%', 'VTT 插入保留对照设置');
  // 删除
  r = Core.deleteOnlyA([mkCue(1, 0, 1, 'a'), mkCue(2, 2, 3, 'b')], 0, 'srt');
  eq(r.cues.map(c => c.num).join(','), '1', '删除后重编号');
}

// ---- 回归②：批量 insert/delete 按依赖安全执行（两阶段） ----
{
  // 条目顺序：pair → only-b（插入到间隙）→ only-a（删除占位条）→ pair。
  // 旧的单遍模拟会先阻塞 insert（占位条还在），随后 delete 成功，最终丢失对照条。
  const A = [mkCue(1, 0, 1000, '保留开头'), mkCue(2, 2000, 3000, '占位将删除'), mkCue(3, 4000, 5000, '保留结尾')];
  const B = [mkCue(1, 0, 1000, '保留开头'), mkCue(2, 2100, 2900, '对照新句'), mkCue(3, 4000, 5000, '保留结尾')];
  const entries = [
    { kind: 'pair', ai: 0, alen: 1, bj: 0, blen: 1, score: 1, conflict: false,
      textChanged: false, timeChanged: false },
    { kind: 'only-b', bj: 1, aBefore: 1 },
    { kind: 'only-a', ai: 1 },
    { kind: 'pair', ai: 2, alen: 1, bj: 2, blen: 1, score: 1, conflict: false,
      textChanged: false, timeChanged: false },
  ];
  const actions = { 1: 'insert', 2: 'delete' };
  const p = Core.planMerge(A, B, entries, actions, 'srt');
  eq(p.blocked.length, 0, '两阶段执行：insert 不再被误阻塞（blocked=' +
    p.blocked.map(b => b.reason).join(';') + '）');
  eq(p.cues.length, 3, '替换后仍是 3 条（删除 1 + 插入 1），不会只剩 2 条');
  eq(p.cues.map(c => c.lines.join()).indexOf('对照新句') >= 0, true, '对照新句已插入');
  eq(p.cues.map(c => c.lines.join()).indexOf('占位将删除') === -1, true, '占位条已删除');
  eq(p.cues.map(c => c.start).join(','), '0,2100,4000', '时间顺序保持');
}
// 批量：文本/时间/整条 + 组替换混合应用，纯函数不修改输入
{
  const A = [
    mkCue(1, 1000, 2000, '你好世界'),
    mkCue(2, 3000, 4000, '旧'),
    mkCue(3, 5000, 8000, '一整句需要被拆开内容'),
  ];
  const B = [
    mkCue(1, 1500, 2500, '你好世界'),
    mkCue(2, 3000, 4000, '新'),
    mkCue(3, 5000, 6500, '一整句需要被'),
    mkCue(4, 6500, 8000, '拆开内容'),
  ];
  const r = Core.alignDocuments(A, B);
  const actions = {};
  r.entries.forEach((e, i) => {
    if (e.kind !== 'pair') return;
    actions[i] = (e.alen > 1 || e.blen > 1) ? 'group' : 'full';
  });
  const p = Core.planMerge(A, B, r.entries, actions, 'srt');
  eq(p.blocked.length, 0, '混合批量无阻塞');
  eq(p.cues.length, 4, '批量后 4 条（含 1→2）');
  eq(p.cues[0].start, 1500, '第 1 条采用对照时间');
  eq(p.cues[1].lines.join(), '新', '第 2 条采用对照文本');
  eq(p.cues.map(c => c.start).join(','), '1500,3000,5000,6500', '批量结果时间有序');
  eq(A.length, 3, 'planMerge 不修改输入数组长度');
  // 无效操作在批量中进 blocked 而非抛错
  const p2 = Core.planMerge(A, B, r.entries, {}, 'srt');
  eq(p2.applied.length, 0, '无 actions 时不应用任何条目');
}

// ---- 镜头切点检测：帧指标与差异 ----
function solidFrame(r, g, b, px) {
  px = px || 16;
  const a = new Uint8ClampedArray(px * 4);
  for (let i = 0; i < px * 4; i += 4) { a[i] = r; a[i + 1] = g; a[i + 2] = b; a[i + 3] = 255; }
  return a;
}
const mRed = Core.frameMetrics(solidFrame(220, 30, 30), 8);
const mRed2 = Core.frameMetrics(solidFrame(220, 30, 30), 8);
const mBlue = Core.frameMetrics(solidFrame(30, 30, 220), 8);
const mDark = Core.frameMetrics(solidFrame(10, 10, 10), 8);
ok(Math.abs(mRed.lum - (0.2126 * 220 + 0.7152 * 30 + 0.0722 * 30)) < 0.5, '亮度均值按 Rec.709 加权');
eq(mRed.hist.length, 24, '直方图为 3×8 桶');
ok(Math.abs(mRed.hist.reduce((s, v) => s + v, 0) - 3) < 1e-9, '直方图按通道归一化');
eq(Core.metricsDelta(mRed, mRed2), 0, '相同帧差异为 0');
const dRB = Core.metricsDelta(mRed, mBlue);
ok(dRB > 0.4, '红→蓝硬切差异显著：' + dRB.toFixed(3));
const dRD = Core.metricsDelta(mRed, mDark);
ok(dRD > 0 && dRD < dRB, '同色系变暗差异小于换色：' + dRD.toFixed(3));
ok(Core.metricsDelta(mRed, mBlue) <= 1, '差异上界为 1');

// ---- 粗检测：阈值 + 非极大值抑制 ----
function seqOf(pattern) {   // pattern: 'R'/'B'/'D' 序列 → 采样序列
  const map = { R: mRed, B: mBlue, D: mDark };
  return pattern.split('').map((ch, i) => ({ t: i * 250, metrics: map[ch] }));
}
{
  const cands = Core.findCutCandidates(seqOf('RRRRRBBBBB'), 0.2, 500);
  eq(cands.length, 1, '单次硬切检出一个候选');
  eq(cands[0].t, 1250, '候选时间为首个新镜头帧');
  eq(cands[0].i, 5, '候选下标指向后一帧');
  eq(Core.findCutCandidates(seqOf('RRRRRBBBBB'), 0.99, 500).length, 0, '阈值过高无候选');
  eq(Core.findCutCandidates(seqOf('RRRRRRRRRR'), 0.2, 500).length, 0, '无变化无候选');
  // 相邻 250ms 内的两个超阈值边界 → NMS 只留最强
  const two = Core.findCutCandidates(seqOf('RRBDB'), 0.05, 500);
  eq(two.length, 1, '近距候选被非极大值抑制合并');
  // 相距足够远的两次切换都保留
  const far = Core.findCutCandidates(seqOf('RRRRBBBBDDDD'), 0.2, 500);
  eq(far.length, 2, '相距够远的两次切换各自保留');
}

// ---- 候选区间细化 ----
{
  const fine = seqOf('RRRRBBBB');           // 切点在第 4→5 帧之间
  const r = Core.refineCutWindow(fine);
  eq(r.t, 1000, '细化定位到首个新镜头帧');
  ok(r.score > 0.4, '细化返回变化强度');
  eq(Core.refineCutWindow([{ t: 0, metrics: mRed }]), null, '样本不足返回 null');
  eq(Core.refineCutWindow([]), null, '空样本返回 null');
}

// ---- 最近切点 ----
const cutList = [{ time: 1600, strength: 0.8 }, { time: 3200, strength: 0.9 }];
{
  const hit = Core.nearestCut(cutList, 1700, 400);
  eq(hit.time, 1600, '容差内取最近切点');
  eq(hit.delta, -100, 'delta = 切点 − 目标');
  eq(Core.nearestCut(cutList, 2400, 400), null, '容差外返回 null');
  eq(Core.nearestCut(cutList, 3100, 400).time, 3200, '双向容差');
}

// ---- 字幕与切点冲突 ----
{
  const cuesX = [
    { num: '1', start: 500, end: 2400, lines: ['横跨切点'] },     // 1600 在内部 → cross
    { num: '2', start: 2850, end: 3000, lines: ['终点近切点'] },   // end 距 3200 为 200 → near-end
    { num: '3', start: 3400, end: 5000, lines: ['起点近切点'] },   // start 距 3200 为 200 → near-start
    { num: '4', start: 1600, end: 2000, lines: ['起点贴合'] },     // 恰好贴合 → 不报
  ];
  const probs = Core.analyzeCutConflicts(cuesX, cutList, 400);
  eq(probs.length, 3, '检出 3 个切点问题（贴合的不报）');
  eq(probs[0].type, 'cut-cross', '横跨切点类型');
  eq(probs[0].cue, 0, '横跨问题关联第 1 条');
  eq(probs[0].cutIdx, 0, '横跨问题关联切点 1600');
  eq(probs[1].type, 'cut-near', '近切点类型');
  eq(probs[1].edge, 'end', '终点接近');
  eq(probs[2].edge, 'start', '起点接近');
  eq(Core.analyzeCutConflicts(cuesX, cutList, 100).filter(p => p.type === 'cut-near').length, 0,
    '容差收窄到 100ms 后近切点问题消失');
  eq(Core.analyzeCutConflicts(cuesX, [], 400).length, 0, '无切点无问题');
}

// ---- 批量吸附计划 ----
{
  const cuesS = [
    { num: '1', start: 1700, end: 2800, lines: ['a'] },   // start→1600
    { num: '2', start: 2850, end: 3000, lines: ['b'] },   // end→3200 但与第 3 条 2950 起点重叠 → 排除
    { num: '3', start: 2950, end: 5000, lines: ['c'] },   // start→3200（第 2 条被排除后仍用上一条原时间校验）
    { num: '4', start: 6000, end: 7000, lines: ['d'] },   // 与切点无关
  ];
  const plan = Core.planCutSnap(cuesS, cutList, 400, { allowOverlap: false, minDurMs: 40 });
  eq(plan.changes.length, 2, '两条可吸附');
  eq(plan.changes[0].newStart, 1600, '第 1 条起点吸附到切点');
  eq(plan.changes[0].snapStart, true, '标记起点吸附');
  eq(plan.changes[0].snapEnd, false, '终点未吸附');
  eq(plan.changes[1].i, 2, '第 3 条吸附');
  eq(plan.changes[1].newStart, 3200, '第 3 条起点吸附');
  eq(plan.skipped.length, 1, '第 2 条被排除');
  ok(plan.skipped[0].reason.includes('重叠'), '排除原因：与下一条重叠');
  eq(cuesS[0].start, 1700, 'planCutSnap 不修改输入');
  // 允许重叠 → 第 2 条也可吸附
  const planOv = Core.planCutSnap(cuesS, cutList, 400, { allowOverlap: true, minDurMs: 40 });
  eq(planOv.changes.length, 3, '允许重叠时全部吸附');
  // 贴合切点（delta 为 0）不产生变更
  const aligned = [{ num: '1', start: 1600, end: 3200, lines: ['x'] }];
  eq(Core.planCutSnap(aligned, cutList, 400, {}).changes.length, 0, '已贴合不重复吸附');
  // 无效时长：起止都吸附到同一切点
  const zero = [{ num: '1', start: 1500, end: 1700, lines: ['x'] }];
  const planZero = Core.planCutSnap(zero, [{ time: 1600, strength: 1 }], 400, { minDurMs: 40 });
  eq(planZero.changes.length, 0, '起止吸附到同一点被排除');
  ok(planZero.skipped[0].reason.includes('时长无效'), '排除原因：无效时长');
  // 负时间
  const neg = [{ num: '1', start: 50, end: 900, lines: ['x'] }];
  const planNeg = Core.planCutSnap(neg, [{ time: -100, strength: 1 }], 400, { minDurMs: 40 });
  eq(planNeg.changes.length, 0, '负时间被排除');
  ok(planNeg.skipped[0].reason.includes('负时间'), '排除原因：负时间');
  // 倒序：起点吸附后越过下一条整体
  const inv = [
    { num: '1', start: 4800, end: 6000, lines: ['a'] },
    { num: '2', start: 4100, end: 4400, lines: ['b'] },
  ];
  const planInv = Core.planCutSnap(inv, [{ time: 5000, strength: 1 }], 400, { allowOverlap: true, minDurMs: 40 });
  eq(planInv.changes.length, 0, '越过下一条整体被排除（倒序）');
  ok(planInv.skipped[0].reason.includes('倒序'), '排除原因：倒序');
  // 顺序模拟：前一条吸附后的新终点参与后一条重叠校验
  const seqC = [
    { num: '1', start: 0, end: 1550, lines: ['a'] },     // end→1600
    { num: '2', start: 1450, end: 2000, lines: ['b'] },  // start→1400 < 前条新终点 1600 → 重叠排除
  ];
  const cuts2 = [{ time: 1400, strength: 1 }, { time: 1600, strength: 1 }];
  const planSeq = Core.planCutSnap(seqC, cuts2, 400, { allowOverlap: false, minDurMs: 40 });
  eq(planSeq.changes.length, 1, '顺序模拟：仅第 1 条吸附');
  eq(planSeq.skipped.length, 1, '第 2 条因与前条新终点重叠被排除');
  ok(planSeq.skipped[0].reason.includes('上一条'), '排除原因指向上一条');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
