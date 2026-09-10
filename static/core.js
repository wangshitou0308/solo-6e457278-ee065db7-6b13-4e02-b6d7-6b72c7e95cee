/* 字幕节奏校准台 — 核心纯逻辑（解析 / 序列化 / 分析 / 自动顺延）
 * 同时兼容浏览器（挂到 window.SubCore）与 Node（module.exports），便于单元测试。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SubCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NL = String.fromCharCode(10);

  // ---------- 时间工具 ----------

  // 解析 "HH:MM:SS,mmm" / "HH:MM:SS.mmm" / "MM:SS.mmm" → 毫秒；非法返回 null
  function parseTimecode(s) {
    if (!s) return null;
    const m = String(s).trim().match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
    if (!m) return null;
    const h = m[1] ? parseInt(m[1], 10) : 0;
    const min = parseInt(m[2], 10);
    const sec = parseInt(m[3], 10);
    let ms = parseInt(m[4], 10);
    if (m[4].length === 1) ms *= 100;
    else if (m[4].length === 2) ms *= 10;
    if (sec >= 60 || min >= 60) return null;
    return ((h * 60 + min) * 60 + sec) * 1000 + ms;
  }

  function pad(n, w) { return String(n).padStart(w, '0'); }

  // 毫秒 → "00:00:01,000"（srt）或 "00:00:01.000"（vtt）
  function fmtMs(ms, format) {
    ms = Math.max(0, Math.round(ms));
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const x = ms % 1000;
    const sep = format === 'vtt' ? '.' : ',';
    return pad(h, 2) + ':' + pad(m, 2) + ':' + pad(s, 2) + sep + pad(x, 3);
  }

  // 毫秒 → 简短显示 "01:23.4"
  function fmtShort(ms) {
    ms = Math.max(0, Math.round(ms));
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const x = Math.floor((ms % 1000) / 100);
    return pad(m, 2) + ':' + pad(s, 2) + '.' + x;
  }

  // ---------- 解析 ----------

  function detectFormat(text) {
    return /^\s*WEBVTT/.test(text) ? 'vtt' : 'srt';
  }

  // 解析单个字幕块（已按空行切分）
  function parseBlock(blockLines) {
    const timeIdx = blockLines.findIndex(function (l) { return l.indexOf('-->') !== -1; });
    if (timeIdx === -1) return null;
    const num = blockLines.slice(0, timeIdx).join(' ').trim();
    const timeLine = blockLines[timeIdx];
    const arrowPos = timeLine.indexOf('-->');
    const start = parseTimecode(timeLine.slice(0, arrowPos));
    const rightParts = timeLine.slice(arrowPos + 3).trim().split(/\s+/);
    const end = parseTimecode(rightParts[0]);
    if (start === null || end === null) return null;
    const settings = rightParts.slice(1).join(' ');
    return { num: num, start: start, end: end, settings: settings, lines: blockLines.slice(timeIdx + 1) };
  }

  // 解析整个文件 → { format, header, cues:[{num,start,end,settings,lines}] }
  function parseSubtitle(text) {
    const format = detectFormat(text);
    const all = String(text).replace(/\r\n?/g, NL).split(NL);
    const doc = { format: format, header: '', cues: [] };
    let i = 0;
    if (format === 'vtt') {
      // 头部：WEBVTT 行及其后到首个空行之间的元数据，原样保留
      const headerLines = [];
      while (i < all.length && all[i].trim() !== '') { headerLines.push(all[i]); i++; }
      doc.header = headerLines.join(NL) || 'WEBVTT';
      while (i < all.length && all[i].trim() === '') i++;
    }
    let block = [];
    function flush() {
      if (block.length) {
        const cue = parseBlock(block);
        if (cue) doc.cues.push(cue);
        block = [];
      }
    }
    for (; i < all.length; i++) {
      const line = all[i];
      if (line.trim() === '') flush();
      else block.push(line);
    }
    flush();
    // 缺编号时按顺序补齐并标记（SRT 导出需要编号；VTT 导出时省略自动编号以保持原样）
    doc.cues.forEach(function (c, idx) {
      if (!c.num) { c.num = String(idx + 1); c.autoNum = true; }
    });
    return doc;
  }

  // ---------- 序列化（保持原编号与换行） ----------

  function serialize(doc, outFormat) {
    const format = outFormat || doc.format || 'srt';
    const blocks = doc.cues.map(function (c, idx) {
      const num = c.num || String(idx + 1);
      const timeLine = fmtMs(c.start, format) + ' --> ' + fmtMs(c.end, format) +
        (format === 'vtt' && c.settings ? ' ' + c.settings : '');
      const head = (format === 'vtt' && c.autoNum) ? '' : num + NL;
      return head + timeLine + NL + c.lines.join(NL);
    });
    if (format === 'vtt') {
      const header = (doc.header && doc.header.trim()) ? doc.header.trim() : 'WEBVTT';
      return header + NL + NL + blocks.join(NL + NL) + NL;
    }
    return blocks.join(NL + NL) + NL;
  }

  // ---------- 分析 ----------

  function countChars(cue) {
    return cue.lines.join('').replace(/<[^>]+>/g, '').replace(/\s+/g, '').length;
  }

  function cueCps(cue) {
    const dur = cue.end - cue.start;
    if (dur <= 0) return Infinity;
    return countChars(cue) / (dur / 1000);
  }

  // settings: { cpsMax, minDurMs, minGapMs, allowOverlap }
  function analyze(cues, settings) {
    const s = settings;
    const probs = [];
    cues.forEach(function (c, i) {
      const dur = c.end - c.start;
      if (dur <= 0) {
        probs.push({ cue: i, type: 'order', msg: '结束时间不晚于开始时间' });
      } else {
        const cps = cueCps(c);
        if (cps > s.cpsMax) {
          probs.push({ cue: i, type: 'cps', msg: '语速 ' + cps.toFixed(1) + ' 字/秒，超过上限 ' + s.cpsMax, value: cps });
        }
        if (dur < s.minDurMs) {
          probs.push({ cue: i, type: 'short', msg: '停留 ' + dur + 'ms，短于 ' + s.minDurMs + 'ms', value: dur });
        }
      }
      if (i > 0) {
        const gap = c.start - cues[i - 1].end;
        if (gap < 0) {
          if (!s.allowOverlap) {
            probs.push({ cue: i, type: 'overlap', msg: '与第 ' + (cues[i - 1].num || i) + ' 条重叠 ' + (-gap) + 'ms', value: gap });
          }
        } else if (gap < s.minGapMs) {
          probs.push({ cue: i, type: 'gap', msg: '与上一条间隔 ' + gap + 'ms，小于 ' + s.minGapMs + 'ms', value: gap });
        }
      }
    });
    return probs;
  }

  // ---------- 自动顺延（保持顺序） ----------

  // 返回变更列表 [{i, num, oldStart, oldEnd, newStart, newEnd}]，不修改原数据
  function computeAutoFix(cues, settings) {
    const s = settings;
    const proposed = cues.map(function (c) { return { start: c.start, end: c.end }; });
    for (let i = 0; i < cues.length; i++) {
      const p = proposed[i];
      // 需要的停留时长：同时满足最短停留与语速上限
      const needDur = Math.max(s.minDurMs, Math.ceil(countChars(cues[i]) / s.cpsMax * 1000));
      if (p.end - p.start < needDur) p.end = p.start + needDur;
      if (i > 0 && !s.allowOverlap) {
        const earliest = proposed[i - 1].end + s.minGapMs;
        if (p.start < earliest) {
          const shift = earliest - p.start;
          p.start += shift;
          p.end += shift;
        }
      }
    }
    const changes = [];
    cues.forEach(function (c, i) {
      if (proposed[i].start !== c.start || proposed[i].end !== c.end) {
        changes.push({
          i: i, num: c.num || String(i + 1),
          oldStart: c.start, oldEnd: c.end,
          newStart: proposed[i].start, newEnd: proposed[i].end,
        });
      }
    });
    return changes;
  }

  // ---------- 双锚点线性校时 ----------

  // 锚点：{ cue, num, srcTime, dstTime }
  //   srcTime 记录时刻字幕的原时间（ms），dstTime 该句在媒体中的正确时间（ms）。
  // 由两对 (srcTime → dstTime) 确定线性变换 t' = a·t + b（a 为伸缩，b 为偏移），
  // 返回 { a, b, changes:[{i,num,oldStart,oldEnd,newStart,newEnd}] }；
  // 锚点冲突或变换产生负时间 / 倒序时返回 { error: '原因' }，不修改原数据。
  function computeAnchorSync(cues, a1, a2) {
    if (!a1 || !a2) return { error: '需要先后记录两个锚点' };
    if (a1.srcTime === a2.srcTime) {
      return {
        error: '锚点冲突：两个锚点的原时间相同（均为 ' + fmtMs(a1.srcTime, 'srt') +
          '），无法确定线性变换，请换用两条不同时间点的字幕',
      };
    }
    const a = (a2.dstTime - a1.dstTime) / (a2.srcTime - a1.srcTime);
    const b = a1.dstTime - a * a1.srcTime;
    if (!isFinite(a) || a <= 0) {
      return {
        error: '锚点冲突：媒体正确时间的先后与原时间矛盾（伸缩系数 ' +
          (isFinite(a) ? a.toFixed(4) : '∞') + ' ≤ 0），请检查两个锚点是否记反',
      };
    }
    const changes = [];
    for (let i = 0; i < cues.length; i++) {
      const c = cues[i];
      const ns = Math.round(a * c.start + b);
      const ne = Math.round(a * c.end + b);
      const label = '第 ' + (c.num || (i + 1)) + ' 条';
      if (ns < 0 || ne < 0) {
        return {
          error: '禁止应用：' + label + ' 变换后出现负时间（' +
            fmtMs(Math.min(ns, ne), 'srt') + '），请改用更靠后的锚点或减小偏移',
        };
      }
      if (ne <= ns) {
        return {
          error: '禁止应用：' + label + ' 变换后结束时间不晚于开始时间（倒序为 ' +
            fmtMs(ns, 'srt') + ' → ' + fmtMs(ne, 'srt') + '）',
        };
      }
      if (ns !== c.start || ne !== c.end) {
        changes.push({
          i: i, num: c.num || String(i + 1),
          oldStart: c.start, oldEnd: c.end,
          newStart: ns, newEnd: ne,
        });
      }
    }
    return { a: a, b: b, changes: changes };
  }

  // ---------- 结构操作：拆分 / 合并 / 重编号 ----------

  function stripTags(s) { return String(s).replace(/<[^>]+>/g, ''); }
  // 有效字符：去除 HTML 标签与全部空白后的字符数
  function effectiveLength(text) {
    return stripTags(text).replace(/\s+/g, '').length;
  }

  function cloneCue(c) {
    return { num: c.num, start: c.start, end: c.end, settings: c.settings || '',
      lines: c.lines.slice(), autoNum: c.autoNum };
  }

  // 拆分 / 合并后重排编号：
  // SRT：全部按顺序编号；VTT：显式标识符原样保留，仅为缺编号条目补占位序号。
  function renumber(cues, format) {
    cues.forEach(function (c, idx) {
      if (format === 'vtt' && !c.autoNum) return;
      c.num = String(idx + 1);
    });
  }

  // 计算拆分分界时间。
  // 播放头严格位于原时间段内 → 以播放头为界；否则按前后有效字符数比例分配。
  function splitTime(cue, beforeText, afterText, playhead) {
    if (playhead !== null && playhead !== undefined &&
      playhead > cue.start && playhead < cue.end) {
      return Math.round(playhead);
    }
    var wb = effectiveLength(beforeText);
    var wa = effectiveLength(afterText);
    var total = wb + wa;
    var t = cue.start + (cue.end - cue.start) * wb / total;
    return Math.round(t);
  }

  // 在 cue 数组第 i 条处拆分，返回新数组（不修改原数据）；无法拆分时返回 { error }。
  // beforeLines/afterLines：光标前后的文本行；playhead：当前播放头（ms）。
  function splitDoc(cues, i, beforeLines, afterLines, playhead, format) {
    if (!Array.isArray(cues) || i < 0 || i >= cues.length) return { error: '指定的字幕不存在' };
    var cue = cues[i];
    var before = beforeLines.slice();
    var after = afterLines.slice();
    while (before.length && before[0].trim() === '') before.shift();
    while (before.length && before[before.length - 1].trim() === '') before.pop();
    while (after.length && after[0].trim() === '') after.shift();
    while (after.length && after[after.length - 1].trim() === '') after.pop();
    if (!before.length || !after.length) {
      return { error: '光标前后均需要有文本才能拆分（不能把全部文字留在一侧）' };
    }
    var t = splitTime(cue, before.join('\n'), after.join('\n'), playhead);
    if (!(t > cue.start && t < cue.end)) {
      var byHead = playhead !== null && playhead !== undefined &&
        playhead > cue.start && playhead < cue.end;
      return {
        error: byHead
          ? '播放头 ' + fmtMs(Math.round(playhead), 'srt') + ' 不在该条时间段 ' +
            fmtMs(cue.start, 'srt') + ' ~ ' + fmtMs(cue.end, 'srt') + ' 内，无法拆分'
          : '按字符数分配的分界时间不合法（' + fmtMs(t, 'srt') +
            '），请先检查该条起止时间是否正常',
      };
    }
    var a = cloneCue(cue);
    var b = cloneCue(cue);
    a.lines = before;
    a.end = t;
    b.lines = after;
    b.start = t;
    // VTT 中由拆分新增的后段视为无显式标识符（导出时省略编号）；
    // SRT 全部按顺序编号，新增段同样带编号。
    b.autoNum = format === 'vtt';
    var out = cues.slice(0, i).concat([a, b], cues.slice(i + 1));
    renumber(out, format);
    return { cues: out, at: t, insertAt: i + 1 };
  }

  // 合并相邻的第 i / i+1 条，返回新数组（不修改原数据）；无法合并时返回 { error }。
  // 合并后的时间覆盖原有区间；标识符与 cue 设置保留第一条；文本行间空行不保留。
  function mergeDoc(cues, i, format) {
    if (!Array.isArray(cues) || i < 0 || i + 1 >= cues.length) {
      return { error: '没有可合并的相邻字幕（需要选中非最后一条并与其下一条合并）' };
    }
    var a = cues[i], b = cues[i + 1];
    var start = Math.min(a.start, b.start);
    var end = Math.max(a.end, b.end);
    if (!(end > start)) return { error: '合并后时间区间不合法（' + fmtMs(start, 'srt') + '），已取消' };
    var la = a.lines.slice(), lb = b.lines.slice();
    while (la.length && la[la.length - 1].trim() === '') la.pop();
    while (lb.length && lb[0].trim() === '') lb.shift();
    var merged = cloneCue(a);
    merged.start = start;
    merged.end = end;
    merged.lines = la.concat(lb);
    var out = cues.slice(0, i).concat([merged], cues.slice(i + 2));
    renumber(out, format);
    return { cues: out, mergedAt: i };
  }

  // ---------- 分行规则检查 ----------

  // 行显示宽度：每个可见字符（含西文、数字）按 1 计；HTML 标签与空白不计。
  function displayWidth(line) {
    var s = stripTags(line);
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      if (/\s/.test(s[i]) || s[i] === ' ' || s[i] === '　') continue;
      w += 1;
    }
    return w;
  }

  // 孤立标点：行首出现后引号/括号类、句末标点或省略号（标点与文字被拆开）
  var ORPHAN_LEAD = /^(?:\.\.\.|…|[,.;:!?，。；：！？、’”〟）】》〉」』]|['"])\s*/;

  function analyzeCueLayout(cue, maxChars, maxLines) {
    var probs = [];
    var over = [];
    cue.lines.forEach(function (line, li) {
      var w = displayWidth(line);
      if (w > maxChars) {
        // 标点悬挂豁免：超宽仅来自行末的一个句末标点（智能分行允许的排版）
        var body = stripTags(line).replace(/\s+$/, '');
        var lastCh = body.slice(-1);
        var hanging = BREAK_AFTER_RE.test(lastCh) &&
          displayWidth(body.slice(0, -1)) <= maxChars && w <= maxChars + 1;
        if (!hanging) over.push('第 ' + (li + 1) + ' 行 ' + w.toFixed(1) + ' 字宽');
      }
      var leadBody = stripTags(line).trim();
      if (leadBody && ORPHAN_LEAD.test(leadBody)) {
        probs.push({ type: 'orphan', msg: '第 ' + (li + 1) + ' 行以孤立标点开头（' + leadBody.slice(0, 2) + '）' });
      }
    });
    if (over.length) probs.push({ type: 'longline', msg: over.join('、') + '，超过每行 ' + maxChars + ' 字宽' });
    if (cue.lines.length > maxLines) {
      probs.push({ type: 'toomany', msg: cue.lines.length + ' 行，超过最多 ' + maxLines + ' 行' });
    }
    return probs;
  }

  function analyzeLayout(cues, maxChars, maxLines) {
    var probs = [];
    cues.forEach(function (c, i) {
      analyzeCueLayout(c, maxChars, maxLines).forEach(function (p) {
        probs.push({ cue: i, type: p.type, msg: p.msg });
      });
    });
    return probs;
  }

  // ---------- 智能分行 ----------

  // 可在其后换行的标点（含西文标点）
  var BREAK_AFTER_RE = /^[,.;:!?，。；：！？、…）】》〉」』]$/;
  var HWS = '[\\t \\u00A0\\u3000]';             // 水平空白（含全角空格），不含换行
  var TRIM_HWS = new RegExp('^' + HWS + '+|' + HWS + '+$', 'g');

  // 把 cue 全文切成不可拆单元：tag / space / word（英文单词或数字串）/ punct / char
  function tokenizeLines(lines) {
    var text = lines.join('\n');
    var toks = [];
    var re = /<[^>]+>|[\t\n\r \u00A0\u202F\u3000]|[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*|(?:[\uD800-\uDBFF][\uDC00-\uDFFF])|./g;
    var m;
    while ((m = re.exec(text)) !== null) {
      var s = m[0], type;
      if (s.charAt(0) === '<') type = 'tag';
      else if (/^\s+$/.test(s) || s === '\u00A0' || s === '\u202F' || s === '\u3000') type = 'space';
      else if (/^[A-Za-z0-9]/.test(s)) type = 'word';
      else if (BREAK_AFTER_RE.test(s)) type = 'punct';
      else type = 'char';
      toks.push({ s: s, type: type });
    }
    return toks;
  }

  function tokenWidth(t) {
    if (t.type === 'tag' || t.type === 'space') return 0;
    return t.s.length;   // word（英文单词 / 数字串）与单字符均按每个字符 1 计
  }

  function tokenName(t) {
    if (t.type === 'word') return (/^[0-9]/.test(t.s) ? '数字串' : '英文单词');
    return '字符';
  }

  function isNewline(t) { return t.type === 'space' && t.s.indexOf('\n') !== -1; }

  // 从位置 j 向前找最近的非标签 token
  function prevNonTag(toks, j) {
    for (var k = j - 1; k >= 0; k--) {
      if (toks[k].type !== 'tag') return toks[k];
    }
    return null;
  }

  // token j 与其前一个 token 之间的断点等级：'prefer'（标点/原换行）、
  // 'soft'（CJK 等字符边界）、null（相邻的词/数字串之间，不可断）
  function boundaryKind(toks, j) {
    var t = toks[j];
    if (isNewline(t)) return 'prefer';
    if (t.type === 'space' || !j) return null;
    var prev = prevNonTag(toks, j);
    if (!prev || (prev.type === 'word' && t.type === 'word')) return null;
    if (prev.type === 'punct') return 'prefer';
    return 'soft';
  }

  // 换行处两侧的词间空白：两侧为 word 时保留一个空格，其余不保留
  function newlineGap(toks, j) {
    var l = -1, r = -1, k;
    for (k = j - 1; k >= 0; k--) {
      if (toks[k].type !== 'space' && toks[k].type !== 'tag') { l = k; break; }
    }
    for (k = j + 1; k < toks.length; k++) {
      if (toks[k].type !== 'space' && toks[k].type !== 'tag') { r = k; break; }
    }
    return (l >= 0 && r >= 0 && toks[l].type === 'word' && toks[r].type === 'word') ? ' ' : '';
  }

  // 由 token 区间重建一行文本：原换行按词间规则转换，首尾水平空白去掉，标签原样保留
  function buildLine(toks, lo, hi) {
    var out = '';
    for (var k = lo; k < hi; k++) {
      var t = toks[k];
      if (isNewline(t)) out += newlineGap(toks, k);
      else out += t.s;
    }
    return out.replace(TRIM_HWS, '');
  }

  // 在位置 j 断开后，下一行行首（跳过标签/空白）是否会是孤立标点；返回该标点或 null
  function leadingOrphanAt(toks, j) {
    for (var k = j; k < toks.length; k++) {
      var t = toks[k];
      if (t.type === 'tag' || t.type === 'space') continue;
      return ORPHAN_LEAD.test(stripTags(t.s)) ? stripTags(t.s) : null;
    }
    return null;
  }

  function segWidth(toks, lo, hi) {
    var w = 0;
    for (var k = lo; k < hi; k++) w += tokenWidth(toks[k]);
    return w;
  }

  // 溢出时收集可行断点（不产生孤立标点），返回 {full, punct, soft}。
  // 优先级：① 限宽内最晚的断点，且若右侧紧跟标点则让标点附在同一行（跟随）；
  // ② 限宽内最晚断点、右侧标点悬挂（仅超宽 1 字）；③ 限宽内最晚的 CJK 软断点。
  function collectCuts(toks, start, i, maxChars) {
    var soft = -1, j, r, w, a, tail;
    // 收集限宽内全部可行断点（正序），便于在“标点跟随 / 悬挂”与普通断点间择优
    var okCuts = [];
    for (j = start + 1; j <= i; j++) {
      r = boundaryKind(toks, j);
      if (!r || leadingOrphanAt(toks, j)) continue;
      w = segWidth(toks, start, j);
      if (w > maxChars) continue;
      if (r === 'soft' && soft < 0) soft = j;
      okCuts.push(j);
    }
    if (!okCuts.length) return { full: -1, punct: -1, soft: soft };
    // 倒序：优先让“断点右侧跨过至多一个正文字符后紧跟的标点”跟随本行
    for (var ci = okCuts.length - 1; ci >= 0; ci--) {
      j = okCuts[ci];
      w = segWidth(toks, start, j);
      // 右侧紧邻标点（可能先跨过空白）
      a = j;
      while (a < i && toks[a].type === 'space') a++;
      if (a < i && toks[a].type === 'punct') {
        tail = a + 1;
        if (!leadingOrphanAt(toks, tail)) {
          if (w + tokenWidth(toks[a]) <= maxChars) return { full: tail, punct: -1, soft: soft };
          if (w <= maxChars && w + tokenWidth(toks[a]) <= maxChars + 1) {
            return { full: -1, punct: tail, soft: soft };
          }
        }
      }
      // 断点后第一个正文 token，再往右紧跟标点：允许把“一个字符 + 标点”带入本行
      var b = a;
      if (b < i && toks[b].type !== 'punct' && tokenWidth(toks[b]) <= 1) {
        var c = b + 1;
        while (c < i && toks[c].type === 'space') c++;
        if (c < i && toks[c].type === 'punct') {
          tail = c + 1;
          if (!leadingOrphanAt(toks, tail)) {
            var wt = w + tokenWidth(toks[b]) + tokenWidth(toks[c]);
            // 字符 + 标点恰好填满
            if (wt <= maxChars) return { full: tail, punct: -1, soft: soft };
            // 标点悬挂：正文（含那一个字符）不超宽、含标点最多超宽 1 字
            if (wt - tokenWidth(toks[c]) <= maxChars && wt <= maxChars + 1) {
              return { full: -1, punct: tail, soft: soft };
            }
          }
        }
      }
    }
    var latest = okCuts[okCuts.length - 1];
    return { full: latest, punct: -1, soft: soft };
  }

  // 对单条字幕做智能分行。成功返回 {ok:true, lines}；无法满足限制返回
  // {ok:false, error:'原因'}。绝不删除任何非空白字符，也不制造新的孤立标点。
  function rewrapCue(cue, maxChars, maxLines) {
    if (!(maxChars > 0) || !(maxLines > 0)) return { ok: false, error: '分行规则未配置' };
    // 现有排版已满足规则且不存在孤立标点 → 原样返回，不做无谓重排
    var alreadyOk = cue.lines.length >= 1 && cue.lines.length <= maxLines &&
      cue.lines.every(function (l) {
        var body = stripTags(l).trim();
        return l !== '' && displayWidth(l) <= maxChars &&
          !(body && ORPHAN_LEAD.test(body));
      });
    if (alreadyOk) return { ok: true, lines: cue.lines.slice() };
    var toks = tokenizeLines(cue.lines);
    // 单个不可拆单元超宽（标点除外，标点可悬挂）→ 无法在不拆词的前提下满足
    for (var k0 = 0; k0 < toks.length; k0++) {
      var wSingle = tokenWidth(toks[k0]);
      if (wSingle > maxChars && toks[k0].type !== 'punct') {
        return {
          ok: false,
          error: tokenName(toks[k0]) + '「' + stripTags(toks[k0].s) + '」宽 ' + wSingle.toFixed(1) +
            '，已超过每行 ' + maxChars + ' 字宽，且不能拆开，无法分行',
        };
      }
    }
    var lines = [];
    var start = 0, i = 0, curW = 0;
    while (i < toks.length) {
      var t = toks[i];
      if (i === start) {
        // 行首吞掉空白（含原换行）；标签与正文开始新行
        if (t.type === 'space') { i++; start = i; continue; }
        curW = tokenWidth(t);
        i++;
        continue;
      }
      var bnd = boundaryKind(toks, i);
      // 行尾标点（逗号/句号等）即使让宽度轻微超宽也继续收入本行，
      // 避免把标点孤立到下一行行首；其超宽由 collectCuts 的标点悬挂兜底
      if (t.type === 'punct' && i > start && curW <= maxChars) {
        curW += tokenWidth(t); i++; continue;
      }
      if (curW + tokenWidth(t) <= maxChars) { curW += tokenWidth(t); i++; continue; }
      // 已溢出
      if (!bnd) {
        var seg = stripTags(buildLine(toks, start, i) + t.s).slice(0, 12);
        return {
          ok: false,
          error: '「' + seg + '…」附近存在无法断开的连续英文单词或数字串，超过每行 ' +
            maxChars + ' 字宽，无法分行',
        };
      }
      var cuts = collectCuts(toks, start, i, maxChars);
      var cut = cuts.full >= 0 ? cuts.full : (cuts.punct >= 0 ? cuts.punct : cuts.soft);
      if (cut < 0) {
        return {
          ok: false,
          error: '每行 ' + maxChars + ' 字宽内找不到既不超宽、又不把标点孤立到行首的断点' +
            '（不删字），请放宽每行字数 / 行数或手动调整该条',
        };
      }
      var lineText = buildLine(toks, start, cut);
      if (lineText) lines.push(lineText);
      if (lines.length >= maxLines) {
        return { ok: false, error: '按每行 ' + maxChars + ' 字宽重排至少需要 ' + (maxLines + 1) +
          ' 行，超过最多 ' + maxLines + ' 行的限制（不删字），请放宽每行字数或行数' };
      }
      start = cut; i = cut; curW = 0;
    }
    var last = buildLine(toks, start, toks.length);
    if (last) lines.push(last);
    if (!lines.length) return { ok: false, error: '该条没有有效文本，无需分行' };
    if (lines.length > maxLines) {
      return { ok: false, error: '按每行 ' + maxChars + ' 字宽重排需要 ' + lines.length +
        ' 行，超过最多 ' + maxLines + ' 行的限制（不删字），请放宽每行字数或行数' };
    }
    // 安全校验一：非空白字符一个都不能少、顺序不变
    var oldFlat = stripTags(cue.lines.join('')).replace(/\s+/g, '');
    var newFlat = stripTags(lines.join('')).replace(/\s+/g, '');
    if (oldFlat !== newFlat) {
      return { ok: false, error: '内部分行校验失败（字符发生变化），已放弃，请人工调整' };
    }
    // 安全校验二：结果中不得残留以孤立标点开头的行
    for (var li = 0; li < lines.length; li++) {
      var body = stripTags(lines[li]).trim();
      if (body && ORPHAN_LEAD.test(body)) {
        return {
          ok: false,
          error: '重排后第 ' + (li + 1) + ' 行仍会以孤立标点开头，当前每行 ' + maxChars +
            ' 字 / 最多 ' + maxLines + ' 行下无可行断点（不删字），请放宽规则或手动调整',
        };
      }
    }
    return { ok: true, lines: lines };
  }

  // 批量重排计划：对每条字幕给出预览结果，不修改原数据。
  function planRewrap(cues, maxChars, maxLines) {
    return cues.map(function (c) {
      var res = rewrapCue(c, maxChars, maxLines);
      var item = { ok: res.ok, changed: false };
      if (res.ok) {
        item.lines = res.lines;
        item.changed = res.lines.length !== c.lines.length ||
          res.lines.some(function (l, idx) { return l !== c.lines[idx]; });
      } else {
        item.error = res.error;
      }
      return item;
    });
  }

  // ---------- 版本对照：规范化文本 / 相似度 ----------

  var ALIGN_DEFAULTS = {
    TIME_W: 0.6,          // 时间得分权重
    TEXT_W: 0.4,          // 文本得分权重
    MATCH_MIN: 0.5,       // 低于该分不配为一对（按仅当前/仅对照处理）
    CONF_MIN: 0.74,       // 高置信度门槛
    TIE_MARGIN: 0.12,     // 与备选配对分差 ≤ 此值 → 配对不唯一，标冲突
    GROUP_TIE: 0.08,      // 组内单配与整体得分过近 → 一对多/多对一不明确
    GAP: 0.22,            // 每跳过一侧一条的扣分
    MAX_GROUP: 3,         // 一对多 / 多对一单侧最多条数
    NEAR_MS: 60000,       // 粗筛：时间相距过远的候选直接跳过
  };

  // 规范化文本：去 HTML 标签、全角转半角、小写，只保留字母数字与中日韩文字/假名，
  // 忽略标点、空白与换行差异，用于相似度计算。
  function normalizeText(s) {
    var t = stripTags(String(s))
      .replace(/[！-～]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); })
      .replace(/　/g, ' ')
      .toLowerCase();
    var out = '';
    for (var k = 0; k < t.length; k++) {
      var ch = t[k];
      if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') ||
          ('一' <= ch && ch <= '鿿') || ('㐀' <= ch && ch <= '䶿') ||
          ('぀' <= ch && ch <= 'ヿ')) {
        out += ch;
      }
    }
    return out;
  }

  function codePoints(s) { return Array.from(String(s)); }

  function levenshtein(a, b) {
    var n = a.length, m = b.length;
    if (!n) return m;
    if (!m) return n;
    if (n * m > 160000) {
      // 超长文本的防御性上界：退化为“较短长度 / 较长长度”，避免平方级开销
      return Math.max(n, m) - Math.min(n, m);
    }
    var prev = [], cur = [], k;
    for (k = 0; k <= m; k++) prev[k] = k;
    for (var i = 1; i <= n; i++) {
      cur[0] = i;
      var ca = a[i - 1];
      for (var j = 1; j <= m; j++) {
        var cost = ca === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      var tmp = prev; prev = cur; cur = tmp;
    }
    return prev[m];
  }

  // 规范化文本相似度 0..1（编辑距离比例）
  function textSimilarity(a, b) {
    if (!a && !b) return 1;
    var d = levenshtein(a, b);
    return 1 - d / Math.max(a.length, b.length);
  }

  function groupNormText(cues, start, len) {
    var parts = [];
    for (var k = 0; k < len; k++) parts.push(cues[start + k].lines.join(' '));
    return normalizeText(parts.join(' '));
  }
  // 组内原始文本（保留换行与标签，供差异渲染）
  function groupRawText(cues, start, len) {
    var parts = [];
    for (var k = 0; k < len; k++) parts.push(cues[start + k].lines.join('\n'));
    return parts.join('\n');
  }
  function groupSpan(cues, start, len) {
    var s = cues[start].start, e = cues[start].end;
    for (var k = 1; k < len; k++) {
      s = Math.min(s, cues[start + k].start);
      e = Math.max(e, cues[start + k].end);
    }
    return { start: s, end: e };
  }

  // 两个时间区间的接近度 0..1：有重叠取 IoU，无重叠按中点距离衰减（取两者较大值）
  function intervalTimeScore(s1, e1, s2, e2) {
    var overlap = Math.min(e1, e2) - Math.max(s1, s2);
    var iou = 0;
    if (overlap > 0) {
      var union = Math.max(e1, e2) - Math.min(s1, s2);
      iou = union > 0 ? overlap / union : 1;
    }
    var dur = Math.max(1, ((e1 - s1) + (e2 - s2)) / 2);
    var center = dur / (dur + Math.abs((s1 + e1) / 2 - (s2 + e2) / 2));
    return Math.max(iou, center);
  }

  // ---------- 序列对齐：一对一 / 一对多 / 多对一 + 两侧缺口 ----------

  // 对齐当前版 cuesA 与对照版 cuesB，返回 { entries, stats }。
  // entry:
  //   {kind:'pair', ai, alen, bj, blen, score, conflict, reasons[],
  //    textChanged, timeChanged, dStart, dEnd, ...}
  //   {kind:'only-a', ai}（仅当前版）  {kind:'only-b', bj, aBefore}（仅对照版）
  // 低置信度或配对方式不唯一的 pair 标 conflict，不替用户选边。
  function alignDocuments(cuesA, cuesB, opts) {
    var cfg = {};
    Object.keys(ALIGN_DEFAULTS).forEach(function (k) {
      cfg[k] = (opts && opts[k] !== undefined) ? opts[k] : ALIGN_DEFAULTS[k];
    });
    var n = cuesA.length, m = cuesB.length;
    var memo = {};
    function blockScore(i, la, j, lb) {
      var key = i + ',' + la + ',' + j + ',' + lb;
      if (memo[key] !== undefined) return memo[key];
      var ga = groupSpan(cuesA, i, la), gb = groupSpan(cuesB, j, lb);
      var dur = Math.max(ga.end - ga.start, gb.end - gb.start, 1);
      var dc = Math.abs((ga.start + ga.end) / 2 - (gb.start + gb.end) / 2);
      // 粗筛：中点距离过远（超过 60s 且超过 5 倍自身时长）→ 必然低于 MATCH_MIN
      if (dc > cfg.NEAR_MS && dc > 5 * dur) return (memo[key] = null);
      var ts = intervalTimeScore(ga.start, ga.end, gb.start, gb.end);
      var sim = textSimilarity(groupNormText(cuesA, i, la), groupNormText(cuesB, j, lb));
      var score = cfg.TIME_W * ts + cfg.TEXT_W * sim;
      // 多成员组（一对多 / 多对一）天然弱于一对一：每多吞并一条扣 0.15，
      // 避免偶然的区间覆盖把无关条目卷进同组。
      score -= 0.15 * ((la - 1) + (lb - 1));
      return (memo[key] = score >= cfg.MATCH_MIN ? score : null);
    }

    // DP：dp[i][j] 为对齐 A 前 i 条、B 前 j 条的最高得分
    var dp = [], back = [];
    for (var i = 0; i <= n; i++) {
      dp.push(new Array(m + 1).fill(0));
      back.push(new Array(m + 1).fill(null));
    }
    for (i = 1; i <= n; i++) { dp[i][0] = -i * cfg.GAP; back[i][0] = { d: 'a' }; }
    for (var j = 1; j <= m; j++) { dp[0][j] = -j * cfg.GAP; back[0][j] = { d: 'b' }; }
    for (i = 1; i <= n; i++) {
      for (j = 1; j <= m; j++) {
        var best = dp[i - 1][j] - cfg.GAP, bd = { d: 'a' };
        var v = dp[i][j - 1] - cfg.GAP;
        if (v > best) { best = v; bd = { d: 'b' }; }
        for (var la = 1; la <= cfg.MAX_GROUP && la <= i; la++) {
          for (var lb = 1; lb <= cfg.MAX_GROUP && lb <= j; lb++) {
            if (la !== 1 && lb !== 1) continue;   // 不支持多对多
            var s = blockScore(i - la, la, j - lb, lb);
            if (s === null) continue;
            v = dp[i - la][j - lb] + s;
            if (v > best) { best = v; bd = { d: 'm', la: la, lb: lb, score: s }; }
          }
        }
        dp[i][j] = best; back[i][j] = bd;
      }
    }

    // 回溯
    var blocks = [];
    var ii = n, jj = m;
    while (ii > 0 || jj > 0) {
      var b = back[ii][jj];
      if (b.d === 'a') { blocks.push({ kind: 'only-a', ai: ii - 1 }); ii--; }
      else if (b.d === 'b') { blocks.push({ kind: 'only-b', bj: jj - 1, aBefore: ii }); jj--; }
      else {
        blocks.push({ kind: 'pair', ai: ii - b.la, alen: b.la, bj: jj - b.lb, blen: b.lb, score: b.score });
        ii -= b.la; jj -= b.lb;
      }
    }
    blocks.reverse();

    // 备选配对扫描（窗口 ±2，含不同组大小）：找与该块争夺同一侧条目的最强候选
    function bestAlt(e) {
      var bestAltScore = -1;
      var i0 = Math.max(0, e.ai - 2), i1 = Math.min(n - 1, e.ai + e.alen + 1);
      var j0 = Math.max(0, e.bj - 2), j1 = Math.min(m - 1, e.bj + e.blen + 1);
      for (var x = i0; x <= i1; x++) {
        for (var la = 1; la <= cfg.MAX_GROUP && x + la <= n; la++) {
          for (var y = j0; y <= j1; y++) {
            for (var lb = 1; lb <= cfg.MAX_GROUP && y + lb <= m; lb++) {
              if (la !== 1 && lb !== 1) continue;
              var sameA = x === e.ai && la === e.alen;
              var sameB = y === e.bj && lb === e.blen;
              var touchesA = x < e.ai + e.alen && x + la > e.ai;
              var touchesB = y < e.bj + e.blen && y + lb > e.bj;
              if (sameA && sameB) continue;
              if (!(touchesA || touchesB)) continue;
              var s = blockScore(x, la, y, lb);
              if (s !== null && s > bestAltScore) bestAltScore = s;
            }
          }
        }
      }
      return bestAltScore;
    }

    var entries = [];
    var stats = { pairs: 0, onlyA: 0, onlyB: 0, conflicts: 0, changed: 0 };
    blocks.forEach(function (e) {
      if (e.kind === 'only-a') { stats.onlyA++; entries.push(e); return; }
      if (e.kind === 'only-b') { stats.onlyB++; entries.push(e); return; }
      stats.pairs++;
      var ga = groupSpan(cuesA, e.ai, e.alen), gb = groupSpan(cuesB, e.bj, e.blen);
      var rawA = groupRawText(cuesA, e.ai, e.alen);
      var rawB = groupRawText(cuesB, e.bj, e.blen);
      var sim = textSimilarity(normalizeText(rawA), normalizeText(rawB));
      e.aRaw = rawA; e.bRaw = rawB;
      e.textChanged = sim < 0.985;
      e.dStart = gb.start - ga.start;
      e.dEnd = gb.end - ga.end;
      e.timeChanged = e.alen === 1 && e.blen === 1
        ? (Math.abs(e.dStart) > 1 || Math.abs(e.dEnd) > 1)
        : (ga.start !== gb.start || ga.end !== gb.end);
      e.conflict = false;
      e.reasons = [];
      if (e.score < cfg.CONF_MIN) {
        e.conflict = true;
        e.reasons.push('置信度偏低（' + Math.round(e.score * 100) + '%）');
      }
      var alt = bestAlt(e);
      if (alt >= 0 && e.score - alt <= cfg.TIE_MARGIN) {
        e.conflict = true;
        e.reasons.push('存在得分接近的其它配对（' + Math.round(alt * 100) + '%），配对方式不唯一');
      }
      // 一对多 / 多对一的内聚性：组内任一单配几乎和整体同样好 → 分组依据不足
      if (e.alen > 1 || e.blen > 1) {
        var bestSingle = -1;
        for (var x = e.ai; x < e.ai + e.alen; x++) {
          for (var y = e.bj; y < e.bj + e.blen; y++) {
            var s = blockScore(x, 1, y, 1);
            if (s !== null && s > bestSingle) bestSingle = s;
          }
        }
        if (bestSingle >= 0 && e.score - bestSingle <= cfg.GROUP_TIE) {
          e.conflict = true;
          e.reasons.push('组内单条配对与整组得分接近，拆分 / 合并方式不明确');
        }
      }
      if (e.conflict) stats.conflicts++;
      if (e.textChanged || e.timeChanged) stats.changed++;
      entries.push(e);
    });
    return { entries: entries, stats: stats, config: cfg };
  }

  // ---------- 字符级差异（LCS），供并排文本渲染 ----------
  // 返回 [{t:'eq'|'del'|'ins', s}]；del 只出现在旧侧，ins 只出现在新侧。
  function diffSegments(a, b) {
    var A = codePoints(a), B = codePoints(b);
    var n = A.length, m = B.length;
    var lcs = [];
    for (var i = 0; i <= n; i++) lcs.push(new Array(m + 1).fill(0));
    for (i = n - 1; i >= 0; i--) {
      for (var j = m - 1; j >= 0; j--) {
        lcs[i][j] = A[i] === B[j] ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    var segs = [], i = 0, j = 0;
    function push(t, s) {
      var last = segs[segs.length - 1];
      if (last && last.t === t) last.s += s;
      else segs.push({ t: t, s: s });
    }
    while (i < n && j < m) {
      if (A[i] === B[j]) { push('eq', A[i]); i++; j++; }
      else if (lcs[i + 1][j] >= lcs[i][j + 1]) { push('del', A[i]); i++; }
      else { push('ins', B[j]); j++; }
    }
    while (i < n) { push('del', A[i]); i++; }
    while (j < m) { push('ins', B[j]); j++; }
    return segs;
  }

  // ---------- 合并操作（纯函数：不修改输入，返回 {cues} 或 {error}） ----------

  // 采用对照文本（时间与标识不变）
  function adoptText(cues, at, lines) {
    if (!Array.isArray(cues) || at < 0 || at >= cues.length) return { error: '指定的字幕不存在' };
    var ls = (lines || []).slice();
    while (ls.length > 1 && ls[ls.length - 1] === '') ls.pop();
    if (effectiveLength(ls.join('\n')) === 0) return { error: '对照文本为空，不能采用' };
    var out = cues.map(cloneCue);
    out[at].lines = ls;
    return { cues: out };
  }

  // 单条改时的“不把时序变得更糟”校验：不倒序、不与原本分离的邻居新产生重叠
  function timeOrderError(cues, at, start, end) {
    if (start < 0) return '开始时间不能为负（' + fmtMs(start, 'srt') + '）';
    if (!(end > start)) return '结束时间必须晚于开始时间（' + fmtMs(start, 'srt') + ' → ' + fmtMs(end, 'srt') + '）';
    if (at > 0) {
      var prevBound = Math.min(cues[at - 1].end, cues[at].start);
      if (start < prevBound) {
        return '会与上一条产生新的重叠 / 倒序（起点早于 ' + fmtMs(prevBound, 'srt') + '）';
      }
    }
    if (at + 1 < cues.length) {
      var nextBound = Math.max(cues[at + 1].start, cues[at].end);
      if (end > nextBound) {
        return '会与下一条产生新的重叠 / 倒序（终点晚于 ' + fmtMs(nextBound, 'srt') + '）';
      }
    }
    return null;
  }

  function adoptTime(cues, at, start, end) {
    if (!Array.isArray(cues) || at < 0 || at >= cues.length) return { error: '指定的字幕不存在' };
    var err = timeOrderError(cues, at, start, end);
    if (err) return { error: err };
    var out = cues.map(cloneCue);
    out[at].start = start; out[at].end = end;
    return { cues: out };
  }

  // 标识合并：当前版显式 cue 标识优先（属于当前轨道），否则沿用对照版标识；
  // settings 保留当前版非空设置，否则采用对照版，绝不把已有设置清空。
  function mergeIdentity(curCue, refCue) {
    if (curCue && !curCue.autoNum) return { num: curCue.num, autoNum: false };
    if (refCue && !refCue.autoNum) return { num: refCue.num, autoNum: false };
    return { num: curCue ? curCue.num : (refCue ? refCue.num : ''), autoNum: true };
  }
  function mergeSettings(curCue, refCue) {
    if (curCue && curCue.settings) return curCue.settings;
    if (refCue && refCue.settings) return refCue.settings;
    return '';
  }

  // 整条采用（一对一）：文本 + 时间来自对照版；标识 / 设置按 mergeIdentity 保留
  function adoptFull(cues, at, refCue, format) {
    if (!Array.isArray(cues) || at < 0 || at >= cues.length) return { error: '指定的字幕不存在' };
    if (effectiveLength((refCue.lines || []).join('\n')) === 0) return { error: '对照文本为空，不能采用' };
    var err = timeOrderError(cues, at, refCue.start, refCue.end);
    if (err) return { error: err };
    var out = cues.map(cloneCue);
    var dst = cloneCue(refCue);
    var id = mergeIdentity(out[at], refCue);
    dst.num = id.num; dst.autoNum = id.autoNum;
    dst.settings = mergeSettings(out[at], refCue);
    out[at] = dst;
    renumber(out, format);
    return { cues: out };
  }

  // 成组替换：把当前版 [at, at+alen) 替换为对照版 refCues[bStart, bStart+bLen)。
  // 覆盖一对一之外的整组采用（一对多拆分 / 多对一合并）。
  function replaceGroup(cues, at, alen, refCues, bStart, blen, format) {
    if (at < 0 || at + alen > cues.length || alen < 1) return { error: '当前版区间无效' };
    if (bStart < 0 || bStart + blen > refCues.length || blen < 1) return { error: '对照版区间无效' };
    if (alen === 1 && blen === 1) return adoptFull(cues, at, refCues[bStart], format);
    var seg = [];
    for (var k = 0; k < blen; k++) {
      var r = refCues[bStart + k];
      if (!(r.end > r.start)) {
        return { error: '对照版第 ' + r.num + ' 条时长无效，已取消整组采用' };
      }
      if (k > 0 && r.start < refCues[bStart + k - 1].end) {
        return { error: '对照版该组内部存在重叠 / 倒序，已取消整组采用' };
      }
      var c = cloneCue(r);
      if (k === 0) {
        var id = mergeIdentity(cues[at], r);
        c.num = id.num; c.autoNum = id.autoNum;
        c.settings = mergeSettings(cues[at], r);
      }
      // k>0 完整保留对照条目的显式标识与设置；无标识则为自动编号
      seg.push(c);
    }
    // 与组外邻居的时序校验（不新造重叠 / 倒序）
    var first = seg[0], last = seg[seg.length - 1];
    if (at > 0) {
      var prevBound = Math.min(cues[at - 1].end, cues[at].start);
      if (first.start < prevBound) {
        return { error: '整组采用后会与上一条产生新的重叠 / 倒序（起点早于 ' + fmtMs(prevBound, 'srt') + '）' };
      }
    }
    if (at + alen < cues.length) {
      var nextBound = Math.max(cues[at + alen].start, cues[at + alen - 1].end);
      if (last.end > nextBound) {
        return { error: '整组采用后会与下一条产生新的重叠 / 倒序（终点晚于 ' + fmtMs(nextBound, 'srt') + '）' };
      }
    }
    var out = cues.slice(0, at).concat(seg, cues.slice(at + alen));
    renumber(out, format);
    return { cues: out };
  }

  // 插入“仅对照版”条目：复制对照 cue 到 at（0..n）位置，须落在相邻条目的间隙中
  function insertOnlyB(cues, at, refCue, format) {
    if (at < 0 || at > cues.length) return { error: '插入位置无效' };
    if (!(refCue.end > refCue.start)) return { error: '对照条目的时长无效' };
    if (at > 0 && refCue.start < cues[at - 1].end) {
      return { error: '对照条与上一条重叠（早于 ' + fmtMs(cues[at - 1].end, 'srt') + '），请先手动调整后再插入' };
    }
    if (at < cues.length && refCue.end > cues[at].start) {
      return { error: '对照条与下一条重叠（晚于 ' + fmtMs(cues[at].start, 'srt') + '），请先手动调整后再插入' };
    }
    var c = cloneCue(refCue);
    c.autoNum = format === 'vtt' ? !!refCue.autoNum : true;
    if (format !== 'vtt' || refCue.autoNum) c.num = '';
    var out = cues.slice(0, at).concat([c], cues.slice(at));
    renumber(out, format);
    return { cues: out };
  }

  // 删除“仅当前版”条目
  function deleteOnlyA(cues, at, format) {
    if (at < 0 || at >= cues.length) return { error: '指定的字幕不存在' };
    var out = cues.slice(0, at).concat(cues.slice(at + 1));
    renumber(out, format);
    return { cues: out };
  }

  // 预计算某条对照条目上每个手动操作是否可用（返回错误说明，null 表示可用）
  function entryActionErrors(cur, ref, e) {
    var res = {};
    if (e.kind === 'pair') {
      var refLines = [];
      for (var k = 0; k < e.blen; k++) refLines = refLines.concat(ref[e.bj + k].lines.slice());
      res.text = (e.alen === 1 && e.blen === 1 && effectiveLength(refLines.join('\n')) > 0)
        ? null : '多对多结构请使用整组采用';
      if (e.alen === 1 && e.blen === 1) {
        var r = ref[e.bj];
        res.time = timeOrderError(cur, e.ai, r.start, r.end);
        res.full = res.time || (effectiveLength(r.lines.join('\n')) === 0 ? '对照文本为空' : null);
      } else {
        res.time = '结构不同（' + e.alen + ' ↔ ' + e.blen + '），请使用整组采用';
        res.full = res.time;
      }
      res.group = null;
      var rg = replaceGroup(cur, e.ai, e.alen, ref, e.bj, e.blen, 'srt');
      if (rg.error) res.group = rg.error;
    } else if (e.kind === 'only-b') {
      var ins = insertOnlyB(cur, e.aBefore, ref[e.bj], 'srt');
      res.insert = ins.error || null;
    } else {
      res.del = null;
    }
    return res;
  }

  // ---------- 批量合并计划（模拟应用，不修改输入） ----------
  // actions: { [entryIdx]: 'text'|'time'|'full'|'group'|'insert'|'delete' }
  // 按时间轴顺序逐条模拟；当前条件下不可应用的条目进 blocked 并跳过，不影响其余条目。
  // 返回 { cues, applied:[{idx,mode}], blocked:[{idx,mode,reason}] }。
  function planMerge(cues, refCues, entries, actions, format) {
    var w = cues.map(cloneCue);
    var delta = 0;
    var applied = [], blocked = [];
    function fail(idx, mode, reason) { blocked.push({ idx: idx, mode: mode, reason: reason }); }
    entries.forEach(function (e, idx) {
      var mode = actions[idx];
      if (!mode) return;
      var res;
      if (e.kind === 'pair') {
        var at = e.ai + delta;
        if (mode === 'text') {
          if (e.alen !== 1 || e.blen !== 1) { fail(idx, mode, '仅一对一可采用文本'); return; }
          res = adoptText(w, at, refCues[e.bj].lines);
        } else if (mode === 'time') {
          if (e.alen !== 1 || e.blen !== 1) { fail(idx, mode, '仅一对一可采用时间'); return; }
          res = adoptTime(w, at, refCues[e.bj].start, refCues[e.bj].end);
        } else if (mode === 'full') {
          if (e.alen !== 1 || e.blen !== 1) { fail(idx, mode, '结构不同请使用整组采用'); return; }
          res = adoptFull(w, at, refCues[e.bj], format);
        } else if (mode === 'group') {
          res = replaceGroup(w, at, e.alen, refCues, e.bj, e.blen, format);
          if (!res.error) delta += e.blen - e.alen;
        } else { fail(idx, mode, '未知操作'); return; }
        if (res.error) fail(idx, mode, res.error);
        else { w = res.cues; applied.push({ idx: idx, mode: mode }); }
      } else if (e.kind === 'only-b' && mode === 'insert') {
        res = insertOnlyB(w, e.aBefore + delta, refCues[e.bj], format);
        if (res.error) fail(idx, mode, res.error);
        else { w = res.cues; delta += 1; applied.push({ idx: idx, mode: mode }); }
      } else if (e.kind === 'only-a' && mode === 'delete') {
        res = deleteOnlyA(w, e.ai + delta, format);
        if (res.error) fail(idx, mode, res.error);
        else { w = res.cues; delta -= 1; applied.push({ idx: idx, mode: mode }); }
      } else {
        fail(idx, mode, '操作与条目类型不匹配');
      }
    });
    return { cues: w, applied: applied, blocked: blocked };
  }

  // ---------- 草稿键 ----------

  // FNV-1a 简易哈希，用于生成草稿键
  function simpleHash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  function draftKey(fileName, content) {
    return simpleHash(fileName + '::' + content.length + '::' + content.slice(0, 4096));
  }

  return {
    parseTimecode: parseTimecode, fmtMs: fmtMs, fmtShort: fmtShort,
    detectFormat: detectFormat, parseSubtitle: parseSubtitle, serialize: serialize,
    countChars: countChars, cueCps: cueCps, analyze: analyze, computeAutoFix: computeAutoFix,
    computeAnchorSync: computeAnchorSync,
    splitDoc: splitDoc, mergeDoc: mergeDoc, renumber: renumber,
    effectiveLength: effectiveLength, displayWidth: displayWidth,
    analyzeLayout: analyzeLayout, analyzeCueLayout: analyzeCueLayout,
    rewrapCue: rewrapCue, planRewrap: planRewrap,
    // 版本对照与合并
    normalizeText: normalizeText, textSimilarity: textSimilarity,
    intervalTimeScore: intervalTimeScore, diffSegments: diffSegments,
    alignDocuments: alignDocuments,
    adoptText: adoptText, adoptTime: adoptTime, adoptFull: adoptFull,
    replaceGroup: replaceGroup, insertOnlyB: insertOnlyB, deleteOnlyA: deleteOnlyA,
    entryActionErrors: entryActionErrors, planMerge: planMerge,
    simpleHash: simpleHash, draftKey: draftKey,
  };
});
