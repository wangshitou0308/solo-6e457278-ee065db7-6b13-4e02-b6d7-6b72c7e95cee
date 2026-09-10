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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
