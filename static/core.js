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
      if (w > maxChars) over.push('第 ' + (li + 1) + ' 行 ' + w.toFixed(1) + ' 字宽');
      var body = stripTags(line).trim();
      if (body && ORPHAN_LEAD.test(body)) {
        probs.push({ type: 'orphan', msg: '第 ' + (li + 1) + ' 行以孤立标点开头（' + body.slice(0, 2) + '）' });
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

  // 对单条字幕做智能分行。成功返回 {ok:true, lines}；无法满足限制返回
  // {ok:false, error:'原因'}。绝不删除任何非空白字符。
  function rewrapCue(cue, maxChars, maxLines) {
    if (!(maxChars > 0) || !(maxLines > 0)) return { ok: false, error: '分行规则未配置' };
    // 现有排版已满足规则（无空行、每行不超限、行数不超限）→ 原样返回，不做无谓重排
    if (cue.lines.length >= 1 && cue.lines.length <= maxLines &&
      cue.lines.every(function (l) { return l !== '' && displayWidth(l) <= maxChars; })) {
      return { ok: true, lines: cue.lines.slice() };
    }
    var toks = tokenizeLines(cue.lines);
    // 单个不可拆单元超宽 → 无法在不拆词的前提下满足
    for (var k0 = 0; k0 < toks.length; k0++) {
      var wSingle = tokenWidth(toks[k0]);
      if (wSingle > maxChars) {
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
      if (curW + tokenWidth(t) <= maxChars) { curW += tokenWidth(t); i++; continue; }
      // 已溢出：在 [start, i] 范围内倒序挑选断点
      if (!bnd) {
        var seg = stripTags(buildLine(toks, start, i) + t.s).slice(0, 12);
        return {
          ok: false,
          error: '「' + seg + '…」附近存在无法断开的连续英文单词或数字串，超过每行 ' +
            maxChars + ' 字宽，无法分行',
        };
      }
      var cut = -1, softCut = -1, shortPreferCut = -1, j, r, z, w;
      for (j = i; j > start; j--) {
        r = boundaryKind(toks, j);
        if (!r) continue;
        w = 0;
        for (z = start; z < j; z++) w += tokenWidth(toks[z]);
        if (r === 'prefer' && w >= maxChars * 0.6) { cut = j; break; }
        if (r === 'soft' && softCut < 0) softCut = j;
        if (r === 'prefer' && shortPreferCut < 0) shortPreferCut = j;
      }
      if (cut < 0) cut = softCut >= 0 ? softCut : shortPreferCut;
      if (cut < 0) {
        return { ok: false, error: '该条存在无法断开的连续内容，超过每行 ' + maxChars + ' 字宽，无法分行' };
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
    // 安全校验：非空白字符一个都不能少、顺序不变
    var oldFlat = stripTags(cue.lines.join('')).replace(/[\s\u3000]+/g, '');
    var newFlat = stripTags(lines.join('')).replace(/[\s\u3000]+/g, '');
    if (oldFlat !== newFlat) {
      return { ok: false, error: '内部分行校验失败（字符发生变化），已放弃，请人工调整' };
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
    simpleHash: simpleHash, draftKey: draftKey,
  };
});
