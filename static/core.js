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

  // 解析整个文件 → { format, header, regions:[{raw,settings,id,errors}], cues:[{num,start,end,settings,lines}] }
  function parseSubtitle(text) {
    const format = detectFormat(text);
    const all = String(text).replace(/\r\n?/g, NL).split(NL);
    const doc = { format: format, header: '', regions: [], cues: [] };
    let i = 0;
    if (format === 'vtt') {
      // 头部：WEBVTT 行及其后到首个空行之间的元数据，原样保留；
      // 头部未以空行结束就直接出现 REGION 块时，从 REGION 行起按正文处理
      const headerLines = [];
      while (i < all.length && all[i].trim() !== '' && all[i].trim() !== 'REGION') { headerLines.push(all[i]); i++; }
      doc.header = headerLines.join(NL) || 'WEBVTT';
      while (i < all.length && all[i].trim() === '') i++;
    }
    let block = [];
    function flush() {
      if (block.length) {
        // REGION 块（WebVTT 区域定义）单独解析并保留原文，不参与 cue 解析
        if (format === 'vtt' && block[0].trim() === 'REGION') {
          doc.regions.push(parseRegionBlock(block));
        } else {
          const cue = parseBlock(block);
          if (cue) doc.cues.push(cue);
        }
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
      // 逐词时间码只写入 WebVTT：导出 SRT 时剥去内联时间戳标签（其余标签 / 实体保留）
      const outLines = format === 'vtt' ? c.lines : stripWordTimestamps(c.lines);
      return head + timeLine + NL + outLines.join(NL);
    });
    if (format === 'vtt') {
      const header = (doc.header && doc.header.trim()) ? doc.header.trim() : 'WEBVTT';
      // REGION 块随头部之后原样输出（保留未知设置与原有顺序）
      const regionBlocks = (doc.regions || []).map(function (r) {
        return r && r.raw ? r.raw.trim() : '';
      }).filter(Boolean);
      const parts = [header].concat(regionBlocks, blocks);
      return parts.join(NL + NL) + NL;
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
      // 超长文本的防御性回退：字符二元组 Dice 系数（多集合交集），
      // 线性开销。等长但内容不同的文本（如 401 字异文）不会被误判为距离 0。
      return Math.round((1 - bigramDice(a, b)) * Math.max(n, m));
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
    var n = a.length, m = b.length;
    if (n * m > 160000) {
      // 超长文本走线性的二元组 Dice，避免平方级 LCS/编辑距离开销，
      // 同时保证等长异文不会得到相似度 1。
      return bigramDice(a, b);
    }
    var d = levenshtein(a, b);
    return 1 - d / Math.max(a.length, b.length);
  }

  // 字符二元组 Dice 系数（多集合计数）：完全不同→0，完全一致→1
  function bigramDice(a, b) {
    function grams(s) {
      var m = new Map();
      for (var k = 0; k + 1 < s.length; k++) {
        var g = s.slice(k, k + 2);
        m.set(g, (m.get(g) || 0) + 1);
      }
      return m;
    }
    if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
    var ga = grams(a), gb = grams(b), inter = 0;
    ga.forEach(function (cnt, g) {
      var cb = gb.get(g);
      if (cb) inter += Math.min(cnt, cb);
    });
    return 2 * inter / (a.length - 1 + b.length - 1);
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
              // 两侧区间都被当前组完全包含 → 只是组内的一种子配对，
              // 不是竞争性的另一种整体划分（由内聚性检查单独判断）。
              var containedA = x >= e.ai && x + la <= e.ai + e.alen;
              var containedB = y >= e.bj && y + lb <= e.bj + e.blen;
              if (containedA && containedB && (la !== e.alen || lb !== e.blen)) continue;
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
      e.aRaw = rawA; e.bRaw = rawB;
      // 规范化后逐字符比较即为“有无文字变化”的精确信号
      // （标点 / 空白 / 大小写 / HTML 标签差异已在规范化时忽略，Dice 阈值不会漏判小修改）。
      var normA = normalizeText(rawA), normB = normalizeText(rawB);
      e.similarity = normA && normB ? textSimilarity(normA, normB) : (normA === normB ? 1 : 0);
      e.textChanged = normA !== normB;
      e.dStart = gb.start - ga.start;
      e.dEnd = gb.end - ga.end;
      e.timeChanged = e.alen === 1 && e.blen === 1
        ? (Math.abs(e.dStart) > 1 || Math.abs(e.dEnd) > 1)
        : (ga.start !== gb.start || ga.end !== gb.end);
      // cue 布局设置（line/position/size/align/vertical/region 原文）差异：仅一对一比较
      e.settingsChanged = e.alen === 1 && e.blen === 1 &&
        (cuesA[e.ai].settings || '') !== (cuesB[e.bj].settings || '');
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
      // 一对多 / 多对一的内聚性：若把整组缩成任意“一对一”子配对，
      // 其覆盖率折算得分仍与整组接近，则分组依据不足。覆盖率 = 子配对时长 / 整组时长，
      // 这样完美合并时单配即使文本相同，也只覆盖一半 → 折算约半分，不会误报。
      if (e.alen > 1 || e.blen > 1) {
        var gSpanA = groupSpan(cuesA, e.ai, e.alen);
        var gSpanB = groupSpan(cuesB, e.bj, e.blen);
        var gDur = Math.max(gSpanA.end - gSpanA.start, gSpanB.end - gSpanB.start, 1);
        var bestSingle = -1;
        for (var x = e.ai; x < e.ai + e.alen; x++) {
          for (var y = e.bj; y < e.bj + e.blen; y++) {
            var sSingle = blockScore(x, 1, y, 1);
            if (sSingle === null) continue;
            var pA = groupSpan(cuesA, x, 1), pB = groupSpan(cuesB, y, 1);
            var cov = Math.min(pA.end - pA.start, pB.end - pB.start) / gDur;
            var adjusted = sSingle * Math.max(0.35, Math.min(1, cov + 0.15));
            if (adjusted > bestSingle) bestSingle = adjusted;
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
    // 超长文本不构造平方级字符 LCS 表：退化为按行 LCS（行数通常很少），
    // 差异段以整行 + 换行粒度输出，渲染与字符级一致。
    if (n * m > 250000) {
      var LA = String(a).split('\n'), LB = String(b).split('\n');
      var nL = LA.length, mL = LB.length, T = [];
      for (var r0 = 0; r0 <= nL; r0++) T.push(new Array(mL + 1).fill(0));
      for (r0 = nL - 1; r0 >= 0; r0--) {
        for (var c0 = mL - 1; c0 >= 0; c0--) {
          T[r0][c0] = LA[r0] === LB[c0] ? T[r0 + 1][c0 + 1] + 1
            : Math.max(T[r0 + 1][c0], T[r0][c0 + 1]);
        }
      }
      var lineSegs = [], li = 0, lj = 0;
      function linePush(t, s) {
        var last = lineSegs[lineSegs.length - 1];
        if (last && last.t === t) last.s += s;
        else lineSegs.push({ t: t, s: s });
      }
      while (li < nL && lj < mL) {
        if (LA[li] === LB[lj]) { linePush('eq', LA[li] + '\n'); li++; lj++; }
        else if (T[li + 1][lj] >= T[li][lj + 1]) { linePush('del', LA[li] + '\n'); li++; }
        else { linePush('ins', LB[lj] + '\n'); lj++; }
      }
      while (li < nL) { linePush('del', LA[li] + (li < nL - 1 ? '\n' : '')); li++; }
      while (lj < mL) { linePush('ins', LB[lj] + (lj < mL - 1 ? '\n' : '')); lj++; }
      return lineSegs;
    }
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
        res.settings = null;
      } else {
        res.time = '结构不同（' + e.alen + ' ↔ ' + e.blen + '），请使用整组采用';
        res.full = res.time;
        res.settings = '结构不同（' + e.alen + ' ↔ ' + e.blen + '），布局采用仅支持一对一';
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

  // ---------- 批量合并计划（两阶段模拟，不修改输入） ----------
  // actions: { [entryIdx]: 'text'|'time'|'full'|'group'|'insert'|'delete' }
  //
  // 阶段一：先执行全部 only-a 删除；阶段二：按条目顺序执行其余操作。
  // 这样“删除”不会因排在后面而让前面的 insert 误判间隙冲突，反之亦然。
  // 插入 / 替换的间隙校验同时查看右侧尚未处理条目的“将来目标状态”，
  // 而不是其当前时间，避免 insert 先被阻塞、delete 随后成功的依赖问题。
  // 当前条件下不可应用的条目进 blocked 并跳过，不影响其余条目。
  // 返回 { cues, applied, blocked:[{idx,mode,reason}] }。
  function planMerge(cues, refCues, entries, actions, format) {
    var w = cues.map(cloneCue);
    var wRef = cues.map(function (c, k) { return { kind: 'keep', ai: k }; });
    var applied = [], blocked = [];
    function fail(idx, mode, reason) { blocked.push({ idx: idx, mode: mode, reason: reason }); }

    // 处理位置 pos（条目数组下标）右侧、尚未处理条目中将占用的最早起点。
    // “右侧”按插入时刻的当前版位置 afterPos 判定，而不是数组顺序。
    //   Infinity：右侧无条目；null：右侧紧接不占位内容（继续跳过）
    function futureRightStart(pos, delSet, afterPos) {
      for (var p = pos; p < entries.length; p++) {
        var f = entries[p];
        var fm = actions[p];
        if (f.kind === 'only-a') {
          if (f.ai < afterPos) continue;             // 在插入点左侧
          if (delSet.has(p)) continue;               // 将被删除，不占位
          return cues[f.ai].start;
        }
        if (f.kind === 'only-b') {
          if (f.aBefore < afterPos) continue;        // 属于更靠左的间隙
          return fm === 'insert' ? refCues[f.bj].start : null;
        }
        // pair：整组位于插入点左侧则跳过
        if (f.ai + f.alen <= afterPos) continue;
        if (fm === 'full' || fm === 'time' || fm === 'group') return refCues[f.bj].start;
        return cues[f.ai].start;                     // text / 未操作：时间不变
      }
      return Infinity;
    }
    function firstFinite(a, b) {
      if (a === null) return b;
      if (b === null) return a;
      if (a === Infinity) return b;
      if (b === Infinity) return a;
      return Math.min(a, b);
    }

    // ---------- 阶段一：删除（按当前版位置倒序，避免索引漂移） ----------
    var delSet = new Set();
    var delA = [];
    entries.forEach(function (e, idx) {
      if (e.kind === 'only-a' && actions[idx] === 'delete') {
        delSet.add(idx);
        delA.push({ e: e, idx: idx });
      }
    });
    delA.sort(function (x, y) { return y.e.ai - x.e.ai; });
    delA.forEach(function (d) {
      if (d.e.ai < 0 || d.e.ai >= w.length) { fail(d.idx, 'delete', '当前版条目索引已失效，请重新生成预览'); return; }
      var res = deleteOnlyA(w, d.e.ai, format);
      if (res.error) { fail(d.idx, 'delete', res.error); delSet.delete(d.idx); return; }
      w = res.cues;
      wRef.splice(d.e.ai, 1);
      applied.push({ idx: d.idx, mode: 'delete' });
    });

    // ---------- 阶段二：pair 采用 + only-b 插入，按条目顺序 ----------
    function curIndex(ai) {
      var removedBefore = 0;
      delSet.forEach(function (p) { if (entries[p].ai < ai) removedBefore++; });
      return ai - removedBefore;
    }
    // shiftBefore[ai]：当前版第 ai 条“之前”（即间隙 ai）已发生的净条数变化
    // （成功的组替换 blen−alen 与间隙插入 +1）。长度 n+1 以容纳末尾间隙。
    var shiftBefore = new Array(cues.length + 1).fill(0);
    function addShift(fromAi, d) {
      for (var k = fromAi; k < shiftBefore.length; k++) shiftBefore[k] += d;
    }
    // 当前版条目 ai 在工作数组中的下标（删除在阶段一已发生，组替换 / 插入在此累计）
    function workIndex(ai) {
      return curIndex(ai) + (shiftBefore[ai] || 0);
    }
    // 间隙 aBefore 的插入下标（删除已计入 curIndex，组替换 / 插入计入 shiftBefore）
    function gapIndex(aBefore) {
      return curIndex(aBefore) + (shiftBefore[aBefore] || 0);
    }

    entries.forEach(function (e, idx) {
      var mode = actions[idx];
      var res;
      if (e.kind === 'pair') {
        // 防御：对照侧索引失效（对照条目不存在）→ 列入阻塞而非崩溃
        if (e.bj < 0 || e.bj + e.blen > refCues.length) {
          if (mode) fail(idx, mode, '对照条目索引已失效，请重新生成预览');
          return;
        }
        var at = workIndex(e.ai);
        if (mode && (at < 0 || at + e.alen > w.length)) {
          fail(idx, mode, '目标位置已失效（结构被先前操作改变），请重新生成预览');
          return;
        }
        if (mode === 'text') {
          if (e.alen !== 1 || e.blen !== 1) { fail(idx, mode, '仅一对一可采用文本'); return; }
          res = adoptText(w, at, refCues[e.bj].lines);
        } else if (mode === 'settings') {
          if (e.alen !== 1 || e.blen !== 1) { fail(idx, mode, '仅一对一可采用布局设置'); return; }
          res = adoptSettings(w, at, refCues[e.bj].settings || '');
        } else if (mode === 'time' || mode === 'full') {
          if (e.alen !== 1 || e.blen !== 1) {
            fail(idx, mode, '结构不同请使用整组采用'); return;
          }
          var r1 = refCues[e.bj];
          var rs1 = futureRightStart(idx + 1, delSet, e.ai + 1);
          if (rs1 !== null && rs1 !== Infinity && r1.end > rs1) {
            fail(idx, mode, '采用后终点晚于后序条目的目标起点 ' + fmtMs(rs1, 'srt') +
              '（请先处理后续条目或手动调整）');
            return;
          }
          res = mode === 'time'
            ? adoptTime(w, at, r1.start, r1.end)
            : adoptFull(w, at, r1, format);
        } else if (mode === 'group') {
          var newLast = refCues[e.bj + e.blen - 1];
          var rs3 = futureRightStart(idx + 1, delSet, e.ai + e.alen);
          if (rs3 !== null && rs3 !== Infinity && newLast.end > rs3) {
            fail(idx, mode, '整组采用后末条终点晚于后序条目的目标起点 ' + fmtMs(rs3, 'srt') +
              '（请先处理后续条目或手动调整）');
            return;
          }
          res = replaceGroup(w, at, e.alen, refCues, e.bj, e.blen, format);
          if (!res.error) {
            var refs = [];
            for (var k = 0; k < e.blen; k++) refs.push({ kind: 'ref', bj: e.bj + k });
            wRef.splice.apply(wRef, [at, e.alen].concat(refs));
            // 组替换的净增从当前侧“第一条之后”的间隙开始计入
            // （1→2 新条插在 e.ai+1；2→1 净变化为 0）
            addShift(e.ai + 1, e.blen - e.alen);
          }
        } else {
          return;   // 未选择操作
        }
        if (res.error) fail(idx, mode, res.error);
        else { w = res.cues; applied.push({ idx: idx, mode: mode }); }
        return;
      }
      if (e.kind === 'only-b' && mode === 'insert') {
        var gpos = gapIndex(e.aBefore);
        var r = refCues[e.bj];
        if (!r) { fail(idx, 'insert', '对照条目索引失效（对照文件可能已变化）'); return; }
        if (gpos < 0 || gpos > w.length) {
          fail(idx, 'insert', '插入位置失效（结构已被先前操作改变），请关闭批量预览重试');
          return;
        }
        var leftEnd = gpos > 0 ? w[gpos - 1].end : -Infinity;
        // 右邻只认前向扫描结果（严格位于该间隙之后）；gpos 处当前若是占位则兜底
        var rightStart = futureRightStart(idx + 1, delSet, e.aBefore + 1);
        if (rightStart === null && gpos < w.length) rightStart = w[gpos].start;
        if (r.start < leftEnd) {
          fail(idx, 'insert', '对照条与上一条重叠（早于 ' + fmtMs(leftEnd, 'srt') +
            '，该间隙的删除 / 采用未全部生效）');
          return;
        }
        if (rightStart !== Infinity && r.end > rightStart) {
          fail(idx, 'insert', '对照条与下一条重叠（晚于 ' + fmtMs(rightStart, 'srt') +
            '，该间隙的删除 / 采用未全部生效）');
          return;
        }
        res = insertOnlyB(w, gpos, r, format);
        if (res.error) { fail(idx, 'insert', res.error); return; }
        w = res.cues;
        wRef.splice(gpos, 0, { kind: 'ref', bj: e.bj });
        addShift(e.aBefore, 1);
        applied.push({ idx: idx, mode: 'insert' });
        return;
      }
      if (e.kind === 'only-a' && delSet.has(idx)) return;   // 阶段一已处理
      if (mode) fail(idx, mode, '操作与条目类型不匹配');
    });
    return { cues: w, applied: applied, blocked: blocked };
  }

  // ---------- 镜头切点检测（纯计算；取帧由 app.js 在浏览器中完成） ----------

  // 单帧指标：亮度均值（0..255，Rec.709 加权）+ RGB 三通道归一化直方图。
  // rgba：RGBA 像素数组（Uint8ClampedArray）；bins：每通道直方图桶数。
  function frameMetrics(rgba, bins) {
    bins = bins || 8;
    var hist = new Array(bins * 3);
    for (var k = 0; k < hist.length; k++) hist[k] = 0;
    var lumSum = 0;
    var n = Math.floor(rgba.length / 4);
    for (var i = 0; i < n * 4; i += 4) {
      var r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      lumSum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      hist[Math.min(bins - 1, (r * bins) >> 8)]++;
      hist[bins + Math.min(bins - 1, (g * bins) >> 8)]++;
      hist[2 * bins + Math.min(bins - 1, (b * bins) >> 8)]++;
    }
    if (n > 0) {
      for (var j = 0; j < hist.length; j++) hist[j] /= n;
    }
    return { lum: n ? lumSum / n : 0, hist: hist, bins: bins };
  }

  // 相邻帧变化强度 0..1：亮度差与直方图距离（1 − 三通道交集均值）的加权和
  function metricsDelta(a, b, lumWeight) {
    var w = lumWeight === undefined ? 0.45 : lumWeight;
    var lumD = Math.abs(a.lum - b.lum) / 255;
    var inter = 0;
    for (var k = 0; k < a.hist.length; k++) inter += Math.min(a.hist[k], b.hist[k]);
    var histD = 1 - inter / 3;
    return w * lumD + (1 - w) * histD;
  }

  // 粗检测：samples 为按时间升序的 [{t, metrics}]，返回变化强度 ≥ threshold 的
  // 候选切点 [{t, score, i}]（t/i 为相邻帧对中后一帧的时间与下标）。
  // minGapMs 内只保留最强的一个（非极大值抑制），避免一次切换报多个候选。
  function findCutCandidates(samples, threshold, minGapMs, lumWeight) {
    var kept = [];
    for (var i = 1; i < samples.length; i++) {
      var score = metricsDelta(samples[i - 1].metrics, samples[i].metrics, lumWeight);
      if (score < threshold) continue;
      var cand = { t: samples[i].t, score: score, i: i };
      var last = kept[kept.length - 1];
      if (last && cand.t - last.t < minGapMs) {
        if (cand.score > last.score) kept[kept.length - 1] = cand;
      } else {
        kept.push(cand);
      }
    }
    return kept;
  }

  // 细化：在候选区间的细采样序列中定位变化最大的相邻帧对，
  // 切点取后一帧时间；返回 {t, score}。样本不足、或相邻差异全为零
  // （细采样未覆盖到变化后的帧）时返回 null——零差异不是真实切点。
  function refineCutWindow(fineSamples, lumWeight) {
    if (!fineSamples || fineSamples.length < 2) return null;
    var best = -1, bestScore = -1;
    for (var i = 1; i < fineSamples.length; i++) {
      var s = metricsDelta(fineSamples[i - 1].metrics, fineSamples[i].metrics, lumWeight);
      if (s > bestScore) { bestScore = s; best = i; }
    }
    if (best < 0 || bestScore <= 0) return null;
    return { t: fineSamples[best].t, score: bestScore };
  }

  // 距离 t 最近且 |cut - t| ≤ tolMs 的切点；cuts 为 [{time, strength}]。
  // 返回 {idx, time, delta}（delta = cut.time − t），无命中返回 null。
  function nearestCut(cuts, t, tolMs) {
    var best = null;
    for (var i = 0; i < cuts.length; i++) {
      var d = cuts[i].time - t;
      if (Math.abs(d) <= tolMs && (!best || Math.abs(d) < Math.abs(best.delta))) {
        best = { idx: i, time: cuts[i].time, delta: d };
      }
    }
    return best;
  }

  // 字幕与切点的冲突检查：
  //   cut-cross  切点落在字幕内部，且距起止均超过容差（字幕横跨镜头切换）
  //   cut-near   起点 / 终点距切点在 (0, tolMs] 内但未贴合（edge: 'start' | 'end'）
  // 恰好贴合（delta 为 0）不报问题。返回 [{cue, type, edge, cutIdx, cutTime, delta, msg}]
  function analyzeCutConflicts(cues, cuts, tolMs) {
    var probs = [];
    if (!cuts || !cuts.length) return probs;
    cues.forEach(function (c, i) {
      cuts.forEach(function (cut, ci) {
        var t = cut.time;
        var dStart = t - c.start, dEnd = t - c.end;
        if (dStart !== 0 && Math.abs(dStart) <= tolMs) {
          probs.push({
            cue: i, type: 'cut-near', edge: 'start', cutIdx: ci, cutTime: t, delta: dStart,
            msg: '起点距切点 ' + Math.abs(dStart) + 'ms 未贴合（切点 ' + fmtShort(t) + '）',
          });
        } else if (dEnd !== 0 && Math.abs(dEnd) <= tolMs) {
          probs.push({
            cue: i, type: 'cut-near', edge: 'end', cutIdx: ci, cutTime: t, delta: dEnd,
            msg: '终点距切点 ' + Math.abs(dEnd) + 'ms 未贴合（切点 ' + fmtShort(t) + '）',
          });
        } else if (t > c.start && t < c.end) {
          probs.push({
            cue: i, type: 'cut-cross', cutIdx: ci, cutTime: t,
            delta: 0,
            msg: '字幕横跨镜头切点 ' + fmtShort(t) + '（可考虑拆分或调整边界）',
          });
        }
      });
    });
    return probs;
  }

  // 批量吸附计划：把容差内未贴合的起点 / 终点吸附到最近切点，不修改原数据。
  // 顺序模拟（前一条采用新时间后再校验后一条），逐项排除：
  //   负时间、无效时长（end − start < minDurMs）、与邻条完全倒序、
  //   以及规则不允许的重叠（opts.allowOverlap 为 false 时）。
  // 返回 { changes:[{i,num,oldStart,oldEnd,newStart,newEnd,snapStart,snapEnd}],
  //        skipped:[{i,num,reason}] }
  function planCutSnap(cues, cuts, tolMs, opts) {
    opts = opts || {};
    var allowOverlap = !!opts.allowOverlap;
    var minDur = opts.minDurMs === undefined ? 1 : opts.minDurMs;
    var changes = [], skipped = [];
    var proposed = cues.map(function (c) { return { start: c.start, end: c.end }; });
    cues.forEach(function (c, i) {
      var hitS = nearestCut(cuts, c.start, tolMs);
      var hitE = nearestCut(cuts, c.end, tolMs);
      var ns = hitS && hitS.delta !== 0 ? hitS.time : null;
      var ne = hitE && hitE.delta !== 0 ? hitE.time : null;
      if (ns === null && ne === null) return;   // 起止都与切点无关
      var newStart = ns === null ? c.start : ns;
      var newEnd = ne === null ? c.end : ne;
      function skip(reason) {
        skipped.push({ i: i, num: c.num || String(i + 1), reason: reason });
      }
      if (newStart < 0) {
        return skip('吸附后出现负时间（' + fmtMs(newStart, 'srt') + '）');
      }
      if (!(newEnd - newStart >= minDur)) {
        return skip('吸附后时长无效（' + (newEnd - newStart) + 'ms，不足 ' + minDur + 'ms）');
      }
      if (i > 0 && newEnd <= proposed[i - 1].start) {
        return skip('吸附后与上一条倒序（终点不晚于上一条起点 ' +
          fmtMs(proposed[i - 1].start, 'srt') + '）');
      }
      if (i + 1 < cues.length && newStart >= cues[i + 1].end) {
        return skip('吸附后与下一条倒序（起点不早于下一条终点 ' +
          fmtMs(cues[i + 1].end, 'srt') + '）');
      }
      if (!allowOverlap) {
        if (i > 0 && newStart < proposed[i - 1].end) {
          return skip('吸附后与上一条重叠（上一条终点 ' + fmtMs(proposed[i - 1].end, 'srt') +
            '，规则不允许重叠）');
        }
        if (i + 1 < cues.length && newEnd > cues[i + 1].start) {
          return skip('吸附后与下一条重叠（下一条起点 ' + fmtMs(cues[i + 1].start, 'srt') +
            '，规则不允许重叠）');
        }
      }
      proposed[i] = { start: newStart, end: newEnd };
      changes.push({
        i: i, num: c.num || String(i + 1),
        oldStart: c.start, oldEnd: c.end,
        newStart: newStart, newEnd: newEnd,
        snapStart: ns !== null, snapEnd: ne !== null,
      });
    });
    return { changes: changes, skipped: skipped };
  }

  // ---------- WebVTT 逐词时间码（inline timestamp） ----------
  //
  // WebVTT cue 文本中可内嵌时间戳，例如：
  //   <v 小明>欢迎<00:00:01.200>来到<00:00:01.600>校准台
  // 标签（<v>/<c>/<ruby>/<i>…）、实体（&amp;…）、英文单词与数字串均为
  // 不可拆单元，不能在中间插入时间戳。解析只报告问题，绝不擅自修正。

  var TS_OPEN = /^<(?:\d{1,3}:)?\d{1,2}:\d{2}[.,]\d{1,3}>$/;

  // 把一条 cue 的全部文本行切成单元：
  //   {s, type, line}  type ∈ 'ts' | 'tag' | 'entity' | 'word' | 'space' | 'char'
  // 词元轨道可标记 / 高亮的“正文单元”为 entity / word / char。
  function tokenizeCueText(lines) {
    var text = lines.join('\n');
    var re = /<[^>]*>|&(?:#[0-9]{1,7}|#x[0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});|[\t\n\r   　]|[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*|(?:[\uD800-\uDBFF][\uDC00-\uDFFF])|./g;
    var toks = [], m, line = 0;
    while ((m = re.exec(text)) !== null) {
      var s = m[0], type;
      if (s.charAt(0) === '<') {
        if (TS_OPEN.test(s)) type = 'ts';
        else type = 'tag';
      } else if (s.charAt(0) === '&') type = 'entity';
      else if (/^\s+$/.test(s) || s === ' ' || s === ' ' || s === '　') type = 'space';
      else if (/^[A-Za-z0-9]/.test(s)) type = 'word';
      else type = 'char';
      var nl = 0;
      for (var k = 0; k < s.length; k++) if (s.charCodeAt(k) === 10) nl++;
      toks.push({ s: s, type: type, line: line, off: m.index });
      line += nl;
    }
    return toks;
  }

  // 解析时间戳标签内部文本（接受逗号小数，SRT 手工文本里也能定位）
  function timestampInside(tagText) {
    var inner = String(tagText).slice(1, -1).trim();
    if (!TS_OPEN.test('<' + inner + '>')) return null;
    return parseTimecode(inner);
  }

  function isContentTok(t) { return t.type === 'entity' || t.type === 'word' || t.type === 'char'; }

  // 解析一条 cue 的词元轨道：
  //   { toks, marks:[{tok, time, tagTok, line, col, len}], errors:[{kind,...}] }
  // 不修改 cue。错误类型：
  //   badtime    时间戳格式错误（定位到 cue、行列与文本偏移）
  //   order      时间戳未严格递增
  //   outrange   时间戳超出 cue 区间 [start, end]
  function parseCueWords(cue) {
    var toks = tokenizeCueText(cue.lines || []);
    var fullText = (cue.lines || []).join('\n');
    var marks = [], errors = [], lastTime = null;
    function lineCol(off) {
      var line = 1, col = 1;
      for (var k = 0; k < off && k < fullText.length; k++) {
        if (fullText.charCodeAt(k) === 10) { line++; col = 1; } else col++;
      }
      return { line: line, col: col };
    }
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t.type !== 'tag' && t.type !== 'ts') continue;
      if (t.type === 'tag') {
        // 形似时间戳的非法标签（仅由数字与 : . , 空格组成且含数字）：
        // 报格式错误并给出具体行列，不当作普通标签悄悄吞掉
        var inner = t.s.slice(1, -1).trim();
        if (/^[\d\s:.,]+$/.test(inner) && /\d/.test(inner) && !TS_OPEN.test(t.s)) {
          var p1 = lineCol(t.off);
          errors.push({
            type: 'wordtime', kind: 'badtime', tagTok: i,
            msg: '时间戳格式错误「' + t.s + '」（第 ' + p1.line + ' 行第 ' + p1.col +
              ' 字），应为 <HH:MM:SS.mmm>，未擅自修改',
            off: t.off, len: t.s.length, line: p1.line, col: p1.col,
          });
        }
        continue;
      }
      var tm = timestampInside(t.s);
      if (tm === null) {
        var p2 = lineCol(t.off);
        errors.push({
          type: 'wordtime', kind: 'badtime', tagTok: i,
          msg: '时间戳格式错误「' + t.s + '」（第 ' + p2.line + ' 行第 ' + p2.col + ' 字）',
          off: t.off, len: t.s.length, line: p2.line, col: p2.col,
        });
        continue;
      }
      if (lastTime !== null && tm <= lastTime) {
        var p3 = lineCol(t.off);
        errors.push({
          type: 'wordtime', kind: 'order', tagTok: i, time: tm, prev: lastTime,
          msg: '时间戳 ' + fmtMs(tm, 'srt') + ' 未严格递增（不晚于上一个 ' +
            fmtMs(lastTime, 'srt') + '，第 ' + p3.line + ' 行第 ' + p3.col + ' 字），未擅自调整',
          off: t.off, len: t.s.length, line: p3.line, col: p3.col,
        });
      }
      if (tm < cue.start || tm > cue.end) {
        var p4 = lineCol(t.off);
        errors.push({
          type: 'wordtime', kind: 'outrange', tagTok: i, time: tm,
          msg: '时间戳 ' + fmtMs(tm, 'srt') + ' 超出该字幕区间 ' +
            fmtMs(cue.start, 'srt') + ' ~ ' + fmtMs(cue.end, 'srt') +
            '（第 ' + p4.line + ' 行第 ' + p4.col + ' 字），未擅自调整',
          off: t.off, len: t.s.length, line: p4.line, col: p4.col,
        });
      }
      // 找它后面的第一个正文单元（标签 / 空白不附时间戳；遇到下一个时间戳即停止）
      var target = -1;
      for (var j = i + 1; j < toks.length; j++) {
        if (toks[j].type === 'ts') break;
        if (isContentTok(toks[j])) { target = j; break; }
      }
      if (target >= 0) {
        var p5 = lineCol(toks[target].off);
        marks.push({
          tok: target, time: tm, tagTok: i,
          line: p5.line, col: p5.col, off: toks[target].off,
        });
      }
      lastTime = tm;
    }
    return { toks: toks, marks: marks, errors: errors };
  }

  // 全文档逐词时间戳校验，返回带 cue 下标准备给界面定位的错误列表。
  // 每条错误含 type:'wordtime'、kind（badtime/order/outrange）、
  // tagTok（出错时间戳标签的 token 下标）与行列 / 偏移，供界面精确定位。
  function analyzeWordTimings(cues) {
    var out = [];
    cues.forEach(function (c, i) {
      parseCueWords(c).errors.forEach(function (e) {
        out.push({
          cue: i, type: 'wordtime', kind: e.kind, tagTok: e.tagTok,
          msg: e.msg, off: e.off, len: e.len, line: e.line, col: e.col,
          time: e.time,
        });
      });
    });
    return out;
  }

  // 仅剥离合法的逐词时间戳标签（SRT 导出用：逐词时间码只写入 WebVTT 导出结果）。
  // 形似时间戳的非法标签原样保留，继续由错误检查提示人工处理。
  function stripWordTimestampsLine(line) {
    return String(line).replace(/<[^>]*>/g, function (tag) {
      return TS_OPEN.test(tag) ? '' : tag;
    });
  }
  function stripWordTimestamps(lines) { return lines.map(stripWordTimestampsLine); }

  // 由 token 序列重建文本行（\n 单元恢复换行）
  function rebuildLines(toks) {
    var lines = [''];
    toks.forEach(function (t) {
      if (t.type === 'space' && t.s.indexOf('\n') !== -1) {
        var parts = t.s.split('\n');
        lines[lines.length - 1] += parts[0];
        for (var k = 1; k < parts.length; k++) lines.push(parts[k]);
      } else {
        lines[lines.length - 1] += t.s;
      }
    });
    return lines;
  }

  // 判断 toks[i] 是否直接邻接另一个英文/数字词单元（实体夹在单词中间时
  // 不可单独标记，否则会把 AT&amp;T 这类词拆成两半）
  function adjacentWord(toks, i) {
    var j;
    for (j = i - 1; j >= 0; j--) {
      if (toks[j].type === 'word') return true;
      if (toks[j].type === 'char' || toks[j].type === 'ts') break;
    }
    for (j = i + 1; j < toks.length; j++) {
      if (toks[j].type === 'word') return true;
      if (toks[j].type === 'char' || toks[j].type === 'ts') break;
    }
    return false;
  }

  // 在 token 下标 tokIndex 处设置词元起点 time（ms）。已有同一词元的时间戳则改写，
  // 否则把新时间戳插到该正文单元正前方。WebVTT 规定时间戳必须位于标签之外，
  // 因此不跨过紧贴它的标签（标签仍属于上一词元的样式范围）。
  // 返回 {lines}；校验不通过返回 {error}。绝不修改输入。
  function setWordTime(cue, tokIndex, time) {
    var w = parseCueWords(cue);
    var toks = w.toks;
    if (tokIndex < 0 || tokIndex >= toks.length || !isContentTok(toks[tokIndex])) {
      return { error: '该单元不是可标记的词元（标签、空白不能标记）' };
    }
    if (toks[tokIndex].type === 'entity' && adjacentWord(toks, tokIndex)) {
      return { error: '实体「' + toks[tokIndex].s + '」位于英文单词或数字串中间，' +
        '不能单独标记（不可拆单元）' };
    }
    if (!(time >= cue.start && time <= cue.end)) {
      return { error: '词元起点 ' + fmtMs(Math.round(time), 'srt') + ' 必须位于字幕区间 ' +
        fmtMs(cue.start, 'srt') + ' ~ ' + fmtMs(cue.end, 'srt') + ' 内' };
    }
    var existing = w.marks.find(function (mk) { return mk.tok === tokIndex; });
    if (existing) {
      toks[existing.tagTok].s = '<' + fmtMs(Math.round(time), 'vtt') + '>';
    } else {
      toks.splice(tokIndex, 0, {
        s: '<' + fmtMs(Math.round(time), 'vtt') + '>',
        type: 'ts', line: toks[tokIndex].line, off: -1,
      });
    }
    // 严格递增校验
    var times = [];
    for (var i = 0; i < toks.length; i++) {
      if (toks[i].type === 'ts') times.push(timestampInside(toks[i].s));
    }
    for (i = 1; i < times.length; i++) {
      if (times[i] <= times[i - 1]) {
        return { error: '词元起点必须严格递增：' + fmtMs(times[i - 1], 'srt') + ' → ' +
          fmtMs(times[i], 'srt') + ' 不合法（未应用，请先调整前一个标记）' };
      }
    }
    return { lines: rebuildLines(toks) };
  }

  // 删除指定词元的时间戳标记。返回 {lines} 或 {error}。
  function clearWordTime(cue, tokIndex) {
    var w = parseCueWords(cue);
    var mk = w.marks.find(function (m) { return m.tok === tokIndex; });
    if (!mk) return { error: '该词元没有时间戳标记' };
    w.toks.splice(mk.tagTok, 1);
    return { lines: rebuildLines(w.toks) };
  }

  // 删除该 cue 的全部逐词时间戳（保留正文与其它标签）
  function clearAllWordTimes(cue) {
    return { lines: rebuildLines(parseCueWords(cue).toks.filter(function (t) { return t.type !== 'ts'; })) };
  }

  // 修改 cue 起止区间时的两种词元方案（不修改输入）：
  //   absolute：保持各词元绝对时间不变；区间越界即不可用
  //   scale：按新区间线性映射；旧区间非正时长时不可用
  // 返回 { absolute:{ok, reason, marks:[{time}]}, scale:{...}, nMarks }
  function planWordBounds(cue, newStart, newEnd) {
    var w = parseCueWords(cue);
    var times = w.marks.map(function (m) { return m.time; });
    var res = { nMarks: times.length, nErrors: w.errors.length };
    res.absolute = { ok: times.every(function (t) { return t >= newStart && t <= newEnd; }) };
    if (!times.length) res.absolute.ok = true;
    if (!res.absolute.ok) {
      var bad = times.find(function (t) { return t < newStart || t > newEnd; });
      res.absolute.reason = '存在词元标记 ' + fmtMs(bad, 'srt') + ' 落在新区间 ' +
        fmtMs(newStart, 'srt') + ' ~ ' + fmtMs(newEnd, 'srt') + ' 之外，不能保持绝对时间';
    }
    var oldDur = cue.end - cue.start;
    if (oldDur > 0) {
      var mapped = times.map(function (t) {
        return Math.round(newStart + (t - cue.start) * (newEnd - newStart) / oldDur);
      });
      var mono = true;
      for (var i = 1; i < mapped.length; i++) if (mapped[i] <= mapped[i - 1]) mono = false;
      var inside = mapped.every(function (t) { return t >= newStart && t <= newEnd; });
      res.scale = { ok: mono && inside, marks: mapped,
        reason: (!mono ? '缩放后词元时间不再严格递增' : !inside ? '缩放后仍有标记越界' : '') };
    } else {
      res.scale = { ok: false, marks: [], reason: '原字幕区间时长为 0，无法按比例缩放' };
    }
    res.absolute.marks = times.slice();
    return res;
  }

  // 按方案重写 cue 内全部时间戳标签（绝对方案不改文本）。
  // mode='scale' 时按映射表（与 parseCueWords 的 marks 同序）替换；
  // mode='translate' 时整体平移 deltaMs（整块移动用，不做比例变换）。
  // 返回 {lines}；产生非递增 / 越界时返回 {error}。
  function rewriteWordTimes(cue, mode, mappedTimes, deltaMs, bounds) {
    var w = parseCueWords(cue);
    var toks = w.toks;
    var tsIdx = 0, newTimes = [];
    for (var i = 0; i < toks.length; i++) {
      if (toks[i].type !== 'ts') continue;
      var oldTm = timestampInside(toks[i].s);
      var nt;
      if (mode === 'scale') nt = mappedTimes[tsIdx];
      else nt = oldTm + (deltaMs || 0);
      nt = Math.round(nt);
      toks[i].s = '<' + fmtMs(nt, 'vtt') + '>';
      newTimes.push(nt);
      tsIdx++;
    }
    for (i = 1; i < newTimes.length; i++) {
      if (newTimes[i] <= newTimes[i - 1]) {
        return { error: '调整后词元时间 ' + fmtMs(newTimes[i - 1], 'srt') + ' → ' +
          fmtMs(newTimes[i], 'srt') + ' 不再严格递增，未应用' };
      }
    }
    if (bounds) {
      var lo = bounds.start !== undefined ? bounds.start : bounds.from;
      var hi = bounds.end !== undefined ? bounds.end : bounds.to;
      var out = newTimes.some(function (t) { return t < lo || t > hi; });
      if (out) {
        return { error: '调整后存在词元标记超出字幕区间 ' + fmtMs(lo, 'srt') +
          ' ~ ' + fmtMs(hi, 'srt') + '，未应用' };
      }
    }
    return { lines: rebuildLines(toks) };
  }

  // 整块平移（保持相对节奏；bounds 为平移后应落在的字幕新区间）
  function translateWordTimes(cue, deltaMs, bounds) {
    return rewriteWordTimes(cue, 'translate', null, deltaMs, bounds);
  }
  // 按新区间比例缩放（调用方应先用 planWordBounds 确认 scale.ok）
  function scaleWordTimes(cue, newStart, newEnd) {
    var plan = planWordBounds(cue, newStart, newEnd);
    if (!plan.scale.ok) return { error: plan.scale.reason };
    return rewriteWordTimes(cue, 'scale', plan.scale.marks, 0,
      { start: newStart, end: newEnd });
  }

  // 播放头处应高亮的词元下标（最后一个 t ≤ playhead 的标记）；无则 -1
  function activeWord(cue, playheadMs) {
    var w = parseCueWords(cue);
    var idx = -1;
    w.marks.forEach(function (m) { if (m.time <= playheadMs) idx = m.tok; });
    return idx;
  }

  // ---------- 预览 HTML（白名单标签渲染为真实 HTML，未知标签转义；按播放头高亮当前词元） ----------
  var VTT_VOICE_RE = /^<v(?:\s+([^>]*?))?\s*>$/i;
  var VTT_CLASS_RE = /^<c(?:\.[0-9A-Za-z_-]+)*(?:\s+[^>]*)?>$/i;
  var VTT_LANG_RE = /^<lang(?:\s+([0-9A-Za-z-]+))?>$/i;
  var SAFE_TAG_RE = /^<\/?(i|b|u|ruby|rt|rp)(?:\s+[^<>]*)?>$/i;

  function escHtml(s) {
    return String(s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }

  function decodeEntity(s) {
    var m;
    if ((m = /^#(\d+);$/.exec(s))) return String.fromCodePoint(Math.min(+m[1], 0x10FFFF));
    if ((m = /^#x([0-9a-fA-F]+);$/.exec(s))) {
      return String.fromCodePoint(Math.min(parseInt(m[1], 16), 0x10FFFF));
    }
    var named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    var name = /^&([a-zA-Z][a-zA-Z0-9]*);$/.exec(s);
    return name && named[name[1].toLowerCase()] !== undefined
      ? named[name[1].toLowerCase()] : s;
  }

  // 返回 {html, activeTok}。只把白名单标签渲染成真实 HTML；
  // <v>/<c>/<lang> 转为带样式的 span；未知标签整体转义，绝不注入。
  function cuePreviewHtml(cue, playheadMs) {
    var w = parseCueWords(cue);
    var active = playheadMs === undefined || playheadMs === null ? -1 : activeWord(cue, playheadMs);
    var html = '', depth = 0;
    function wrapActive(i, s) {
      return i === active ? '<span class="w-active">' + s + '</span>' : s;
    }
    w.toks.forEach(function (t, i) {
      if (t.type === 'ts') return;
      if (t.type === 'entity') { html += wrapActive(i, escHtml(decodeEntity(t.s))); return; }
      if (t.type === 'space') {
        html += t.s.indexOf('\n') !== -1 ? t.s.replace(/\n/g, '<br>') : escHtml(t.s);
        return;
      }
      var mv, ml;
      if (t.type === 'tag') {
        var lower = t.s.toLowerCase();
        if (lower === '</v>' || lower === '</c>' || lower === '</lang>') {
          if (depth > 0) { html += '</span>'; depth--; }
          return;
        }
        if (SAFE_TAG_RE.test(t.s)) { html += t.s; return; }
        if ((mv = VTT_VOICE_RE.exec(t.s))) {
          var who = (mv[1] || '').trim();
          html += '<span class="vtt-voice"' + (who ? ' title="' + escHtml(who) + '"' : '') + '>';
          depth++;
          return;
        }
        if ((ml = VTT_LANG_RE.exec(t.s))) {
          html += '<span class="vtt-lang"' + (ml[1] ? ' title="' + escHtml(ml[1]) + '"' : '') + '>';
          depth++;
          return;
        }
        if (VTT_CLASS_RE.test(t.s)) { html += '<span class="vtt-class">'; depth++; return; }
        html += escHtml(t.s);   // 未知标签不渲染为真实 HTML
        return;
      }
      // 正文单元（word / char）
      html += wrapActive(i, escHtml(t.s));
    });
    return { html: html, activeTok: active };
  }

  // ---------- WebVTT 画面布局（cue settings 与 REGION 块） ----------
  //
  // cue.settings 始终是原始字符串（未知设置与原有顺序原样保留，导出时回写）；
  // doc.regions 保留 REGION 块原文。以下函数负责解析 / 校验 / 布局计算 / 编辑改写，
  // 导入内容只报告问题，绝不擅自改写。

  var LAYOUT_KEYS = ['line', 'position', 'size', 'align', 'vertical', 'region'];
  var LINE_HEIGHT_PCT = 5.5;   // 预览估算：一行字幕约占画面高度的 5.5%

  // "50%" → 50；否则 null
  function parsePct(v) {
    var m = /^(-?\d+(?:\.\d+)?)%$/.exec(String(v).trim());
    return m ? parseFloat(m[1]) : null;
  }

  // "10%,90%" → {x:10, y:90}；否则 null
  function parseAnchorValue(v) {
    var m = /^\s*(-?\d+(?:\.\d+)?)%,\s*(-?\d+(?:\.\d+)?)%\s*$/.exec(String(v));
    return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
  }

  // line 值："80%" / "80%,center" / "-1" / "-1,end" → {v, pct, align}；非法 null
  function parseLineValue(v) {
    var m = /^(-?\d+(?:\.\d+)?)(%)?(?:,(start|center|end))?$/.exec(String(v).trim());
    if (!m) return null;
    return { v: parseFloat(m[1]), pct: !!m[2], align: m[3] || 'start' };
  }

  // position 值："25%" / "25%,line-right" → {v, align(可空)}；非法 null
  function parsePositionValue(v) {
    var m = /^(-?\d+(?:\.\d+)?)%(?:,(line-left|line-right|center|start|end))?$/.exec(String(v).trim());
    if (!m) return null;
    return { v: parseFloat(m[1]), align: m[2] || null };
  }

  // 单个 cue 设置值校验：返回错误文案或 null（未知键不校验，原样保留）
  function validateCueSetting(key, value) {
    switch (key) {
      case 'line': {
        var p = parseLineValue(value);
        if (!p) return 'line 值「' + value + '」无法识别（应为行号或 0–100%，可带 ,start/,center/,end）';
        if (p.pct && (p.v < 0 || p.v > 100)) return 'line 百分比「' + value + '」越界（0–100%）';
        return null;
      }
      case 'position': {
        var m = /^(-?\d+(?:\.\d+)?)%(?:,(line-left|line-right|center|start|end))?$/.exec(String(value).trim());
        if (!m) return 'position 值「' + value + '」无法识别（应为 0–100%，可带 ,line-left/,line-right/,center/,start/,end）';
        var pv = parseFloat(m[1]);
        if (pv < 0 || pv > 100) return 'position「' + value + '」越界（0–100%）';
        return null;
      }
      case 'size': {
        var sv = parsePct(value);
        if (sv === null) return 'size 值「' + value + '」无法识别（应为 0–100%）';
        if (sv < 0 || sv > 100) return 'size「' + value + '」越界（0–100%）';
        return null;
      }
      case 'align':
        return /^(start|center|end|left|right)$/.test(value) ? null
          : 'align 值「' + value + '」无法识别（start/center/end/left/right）';
      case 'vertical':
        return /^(rl|lr)$/.test(value) ? null : 'vertical 值「' + value + '」无法识别（rl/lr）';
      case 'region':
        return value ? null : 'region 缺少区域标识';
      default:
        return null;   // 未知设置：原样保留，不校验
    }
  }

  // 解析 cue settings 字符串 → { tokens:[{key,value,raw}]（顺序保留）, errors:[{kind,key,raw,msg}] }
  // 只报告问题（badform/dup/range），不改写任何内容。
  function parseCueSettings(settings) {
    var tokens = [], errors = [], seen = {};
    String(settings || '').split(/\s+/).forEach(function (part) {
      if (!part) return;
      var ci = part.indexOf(':');
      if (ci <= 0) {
        errors.push({ kind: 'badform', key: '', raw: part,
          msg: '无法识别的设置「' + part + '」（应为 键:值 形式）' });
        tokens.push({ key: '', value: part, raw: part });
        return;
      }
      var key = part.slice(0, ci), value = part.slice(ci + 1);
      if (seen[key] !== undefined) {
        errors.push({ kind: 'dup', key: key, raw: part,
          msg: '设置「' + key + '」重复出现（「' + part + '」与先前的「' + key + ':' + seen[key] + '」）' });
      } else {
        seen[key] = value;
      }
      tokens.push({ key: key, value: value, raw: part });
      var verr = validateCueSetting(key, value);
      if (verr) errors.push({ kind: 'range', key: key, raw: part, msg: verr });
    });
    return { tokens: tokens, errors: errors };
  }

  // tokens → {key: value}（重复键取第一个，与浏览器行为一致）
  function tokenMap(tokens) {
    var map = {};
    tokens.forEach(function (t) {
      if (t.key && map[t.key] === undefined) map[t.key] = t.value;
    });
    return map;
  }

  // 单个区域设置值校验：返回错误文案或 null（未知键不校验）
  function validateRegionSetting(key, value) {
    switch (key) {
      case 'id':
        return value ? null : '区域 id 不能为空';
      case 'width': {
        var w = parsePct(value);
        if (w === null || w < 0 || w > 100) return '区域 width「' + value + '」越界（0–100%）';
        return null;
      }
      case 'lines':
        return /^\d+$/.test(value) ? null : '区域 lines「' + value + '」应为非负整数';
      case 'regionanchor':
      case 'viewportanchor': {
        var a = parseAnchorValue(value);
        if (!a) return '区域 ' + key + '「' + value + '」应为 x%,y% 形式';
        if (a.x < 0 || a.x > 100 || a.y < 0 || a.y > 100) {
          return '区域 ' + key + '「' + value + '」越界（0–100%）';
        }
        return null;
      }
      case 'scroll':
        return (value === '' || value === 'up') ? null : '区域 scroll「' + value + '」无法识别（仅支持 up）';
      default:
        return null;
    }
  }

  // 解析 REGION 块（首行已是 REGION）→ {raw, settings:[{key,value,raw}], id, errors}
  function parseRegionBlock(lines) {
    var settings = [], errors = [], seen = {};
    for (var k = 1; k < lines.length; k++) {
      var line = lines[k];
      if (!line.trim()) continue;
      var ci = line.indexOf(':');
      if (ci <= 0) {
        errors.push({ kind: 'badform', key: '', raw: line,
          msg: '无法识别的区域设置「' + line.trim() + '」（应为 键:值 形式）' });
        settings.push({ key: '', value: line.trim(), raw: line });
        continue;
      }
      var key = line.slice(0, ci).trim(), value = line.slice(ci + 1).trim();
      if (seen[key] !== undefined) {
        errors.push({ kind: 'dup', key: key, raw: line,
          msg: '区域设置「' + key + '」重复出现（「' + value + '」与先前的「' + seen[key] + '」）' });
      } else {
        seen[key] = value;
      }
      settings.push({ key: key, value: value, raw: line });
      var verr = validateRegionSetting(key, value);
      if (verr) errors.push({ kind: 'range', key: key, raw: line, msg: verr });
    }
    var id = '';
    settings.forEach(function (t) { if (t.key === 'id' && !id) id = t.value; });
    return { raw: lines.join(NL), settings: settings, id: id, errors: errors };
  }

  // 单条 cue 的布局设置校验（含区域存在性与组合冲突），返回问题列表。
  // 所有问题都定位到具体字幕（cue 下标），且绝不擅自改写。
  function analyzeCueSettings(doc, i) {
    var cue = doc.cues[i];
    var p = parseCueSettings(cue.settings);
    var errs = [];
    p.errors.forEach(function (e) {
      errs.push({ cue: i, type: 'layout', kind: e.kind, msg: e.msg + '，未擅自改写' });
    });
    var map = tokenMap(p.tokens);
    if (map.region !== undefined) {
      var rid = map.region, found = false;
      (doc.regions || []).forEach(function (r) { if (r.id && r.id === rid) found = true; });
      if (!found) {
        errs.push({ cue: i, type: 'layout', kind: 'noregion',
          msg: '引用的区域「' + rid + '」在 REGION 块中不存在，未擅自改写' });
      }
      // 组合冲突：区域字幕的 line/position/size 按规范会被忽略
      ['line', 'position', 'size'].forEach(function (k) {
        if (map[k] !== undefined) {
          errs.push({ cue: i, type: 'layout', kind: 'combo',
            msg: 'region 与 ' + k + ' 同时设置：按规范区域字幕将忽略 ' + k + '，未擅自改写' });
        }
      });
    }
    return errs;
  }

  function analyzeLayoutSettings(doc) {
    var out = [];
    if (!doc || doc.format !== 'vtt') return out;
    doc.cues.forEach(function (_, i) { out = out.concat(analyzeCueSettings(doc, i)); });
    return out;
  }

  // ---------- 布局计算（预览近似：全部按画面百分比） ----------

  function defaultPositionForAlign(align) {
    if (align === 'start' || align === 'left') return 0;
    if (align === 'end' || align === 'right') return 100;
    return 50;
  }
  function alignOffset(align, len) {
    if (align === 'center') return len / 2;
    if (align === 'end' || align === 'right') return len;
    return 0;
  }
  // position 锚点偏移：显式位置对齐（line-left/line-right/center/start/end）优先，
  // 未给出时按文本对齐推导（start/left→0，center→一半，end/right→全部）。
  // 例如 position:25%,line-right 表示字幕框右边缘落在 25% 处。
  function positionAnchorOffset(posAlign, textAlign, len) {
    if (!posAlign) return alignOffset(textAlign, len);
    if (posAlign === 'center') return len / 2;
    if (posAlign === 'line-right' || posAlign === 'end') return len;
    return 0;   // line-left / start
  }

  // 计算一条 cue 在画面上的字幕框（百分比坐标）。
  // opts: { regions, lineHeightPct }
  // 返回 { x, y, w, h, vertical, align, region, source:'region'|'cue'|'default' }
  function computeCueBox(cue, opts) {
    opts = opts || {};
    var lh = opts.lineHeightPct || LINE_HEIGHT_PCT;
    var p = parseCueSettings(cue.settings);
    var map = tokenMap(p.tokens);
    var nLines = Math.max(1, (cue.lines || []).length);
    var vertical = (map.vertical === 'rl' || map.vertical === 'lr') ? map.vertical : null;
    var align = map.align || 'center';
    var explicit = false;
    LAYOUT_KEYS.forEach(function (k) { if (map[k] !== undefined) explicit = true; });
    // 区域字幕：位置由 REGION 定义决定（cue 上的 line/position/size 被忽略）
    if (map.region !== undefined) {
      var region = null;
      (opts.regions || []).forEach(function (r) { if (r.id && r.id === map.region) region = r; });
      if (region) {
        var rm = tokenMap(region.settings);
        var rw = rm.width !== undefined ? parsePct(rm.width) : 100;
        if (rw === null) rw = 100;
        var rlines = (rm.lines !== undefined && /^\d+$/.test(rm.lines)) ? parseInt(rm.lines, 10) : 3;
        var va = parseAnchorValue(rm.viewportanchor || '') || { x: 0, y: 100 };
        var ra = parseAnchorValue(rm.regionanchor || '') || { x: 0, y: 100 };
        var w2 = rw, h2 = Math.max(1, rlines) * lh;
        return {
          x: va.x - ra.x / 100 * w2, y: va.y - ra.y / 100 * h2,
          w: w2, h: h2, vertical: vertical, align: align,
          region: region.id, source: 'region',
        };
      }
      // 区域不存在：按默认位置预览（错误由 analyzeCueSettings 报告）
    }
    var size = map.size !== undefined ? parsePct(map.size) : 100;
    if (size === null) size = 100;
    var posParsed = map.position !== undefined ? parsePositionValue(map.position) : null;
    var pos = posParsed ? posParsed.v : defaultPositionForAlign(align);
    var posAlign = posParsed ? posParsed.align : null;
    var line = map.line !== undefined ? parseLineValue(map.line) : null;
    if (!vertical) {
      var w = size, h = nLines * lh;
      var x = pos - positionAnchorOffset(posAlign, align, w);
      var y;
      if (!line) y = 100 - h;                 // 默认贴底
      else if (line.pct) y = line.v - alignOffset(line.align, h);
      else y = line.v >= 0 ? line.v * lh : 100 - h + (line.v + 1) * lh;   // 行号（负值自底部数）
      return { x: x, y: y, w: w, h: h, vertical: null, align: align,
        region: null, source: explicit ? 'cue' : 'default' };
    }
    // 竖排：size 为高度，position 为纵向锚点，line 为横向锚点
    var h3 = size, w3 = nLines * lh;
    var y3 = pos - positionAnchorOffset(posAlign, align, h3);
    var x3;
    if (!line) x3 = vertical === 'rl' ? 100 - w3 : 0;   // rl 默认靠右，lr 默认靠左
    else if (line.pct) x3 = line.v - alignOffset(line.align, w3);
    else x3 = line.v >= 0 ? line.v * lh : 100 - w3 + (line.v + 1) * lh;
    return { x: x3, y: y3, w: w3, h: h3, vertical: vertical, align: align,
      region: null, source: explicit ? 'cue' : 'default' };
  }

  // 百分比数值 → "50%"（保留一位小数，去掉多余的 .0）
  function fmtPct(v) {
    var r = Math.round(v * 10) / 10;
    return (Math.abs(r - Math.round(r)) < 0.001 ? String(Math.round(r)) : String(r)) + '%';
  }

  // 由字幕框反推 line/position/size 更新值（拖动 / 缩放时调用，不修改输入）。
  // 锚点换算遵循 computeCueBox 的同一套规则：position 按其位置对齐锚定
  // （line-right 等后缀原样保留），line 写成百分比形式并沿用原有 line 对齐。
  function boxToSettings(cue, box) {
    var p = parseCueSettings(cue.settings);
    var map = tokenMap(p.tokens);
    var align = map.align || 'center';
    var vertical = (map.vertical === 'rl' || map.vertical === 'lr') ? map.vertical : null;
    var line = map.line !== undefined ? parseLineValue(map.line) : null;
    var la = line ? line.align : 'start';
    var posParsed = map.position !== undefined ? parsePositionValue(map.position) : null;
    var posAlign = posParsed ? posParsed.align : null;
    var posSuffix = posAlign ? ',' + posAlign : '';
    var updates = {};
    if (!vertical) {
      updates.size = fmtPct(box.w);
      updates.position = fmtPct(box.x + positionAnchorOffset(posAlign, align, box.w)) + posSuffix;
      updates.line = fmtPct(box.y + alignOffset(la, box.h));
    } else {
      updates.size = fmtPct(box.h);
      updates.position = fmtPct(box.y + positionAnchorOffset(posAlign, align, box.h)) + posSuffix;
      updates.line = fmtPct(box.x + alignOffset(la, box.w));
    }
    return updates;
  }

  // 把 updates（{key: 新值|null}，null 表示移除该键）写回 settings 字符串：
  // 已涉及的键原位替换或删除，新键按规范顺序追加；未知设置与原有顺序原样保留。
  function applyLayoutUpdates(settings, updates) {
    var p = parseCueSettings(settings);
    var done = {};
    var out = [];
    p.tokens.forEach(function (t) {
      if (t.key && Object.prototype.hasOwnProperty.call(updates, t.key)) {
        if (updates[t.key] !== null && updates[t.key] !== undefined && updates[t.key] !== '') {
          out.push(t.key + ':' + updates[t.key]);
        }
        done[t.key] = true;
      } else {
        out.push(t.raw);
      }
    });
    LAYOUT_KEYS.forEach(function (k) {
      if (done[k]) return;
      var v = updates[k];
      if (v !== null && v !== undefined && v !== '') out.push(k + ':' + v);
    });
    return out.join(' ');
  }

  // ---------- 同时刻布局冲突（安全区 / 遮挡 / 书写方向） ----------

  // opts: { safePct }（安全边距，画面百分比，默认 5）
  // 返回 [{cue, type:'lay-safe'|'lay-occlude'|'lay-vmode', msg, other?}]
  // 默认位置的字幕由播放器自动堆叠，不参与安全区与遮挡检查；SRT 不检查。
  function analyzeLayoutConflicts(doc, opts) {
    opts = opts || {};
    var safe = opts.safePct === undefined ? 5 : opts.safePct;
    var probs = [];
    if (!doc || doc.format !== 'vtt') return probs;
    var boxes = doc.cues.map(function (c) { return computeCueBox(c, { regions: doc.regions }); });
    var EPS = 0.05;
    doc.cues.forEach(function (c, i) {
      var b = boxes[i];
      if (b.source === 'default') return;
      var out = [];
      if (b.x < safe - EPS) out.push('左');
      if (b.y < safe - EPS) out.push('上');
      if (b.x + b.w > 100 - safe + EPS) out.push('右');
      if (b.y + b.h > 100 - safe + EPS) out.push('下');
      if (out.length) {
        probs.push({ cue: i, type: 'lay-safe',
          msg: '字幕框' + out.join('、') + '侧越出安全区（边距 ' + safe + '%）' });
      }
    });
    for (var i = 0; i < doc.cues.length; i++) {
      for (var j = i + 1; j < doc.cues.length; j++) {
        var a = doc.cues[i], b2 = doc.cues[j];
        if (a.start >= b2.end || b2.start >= a.end) continue;   // 不同时出现
        var ba = boxes[i], bb = boxes[j];
        if (ba.source !== 'default' || bb.source !== 'default') {
          var ov = ba.x < bb.x + bb.w - EPS && bb.x < ba.x + ba.w - EPS &&
                   ba.y < bb.y + bb.h - EPS && bb.y < ba.y + ba.h - EPS;
          if (ov) {
            probs.push({ cue: j, type: 'lay-occlude', other: i,
              msg: '与第 ' + (a.num || (i + 1)) + ' 条同时出现且字幕框相互遮挡' });
          }
        }
        var va = ba.vertical, vb = bb.vertical;
        if (!!va !== !!vb || (va && vb && va !== vb)) {
          probs.push({ cue: j, type: 'lay-vmode', other: i,
            msg: '与第 ' + (a.num || (i + 1)) + ' 条同时出现，书写方向冲突（' +
              (va ? '竖排 ' + va : '横排') + ' ↔ ' + (vb ? '竖排 ' + vb : '横排') + '）' });
        }
      }
    }
    return probs;
  }

  // ---------- 布局批量套用 ----------

  // 把第 srcIdx 条的布局键（line/position/size/align/vertical/region）套用到目标字幕：
  // 目标未出现在源中的布局键被移除，未知设置与原有顺序保留。不修改原数据。
  // 返回 [{i, num, oldSettings, newSettings, changed, error?}]；
  // 源布局自身含错误、或引用的区域不存在时，所有目标标记为不可用并说明原因。
  function planLayoutApply(doc, srcIdx, targetIdxs) {
    var src = doc.cues[srcIdx];
    var sp = parseCueSettings(src.settings);
    var srcMap = tokenMap(sp.tokens);
    var items = [];
    (targetIdxs || []).forEach(function (i) {
      var cue = doc.cues[i];
      var item = { i: i, num: cue.num || String(i + 1), oldSettings: cue.settings || '' };
      if (i === srcIdx) {
        item.error = '源字幕自身，无需套用';
        items.push(item);
        return;
      }
      if (sp.errors.length) {
        item.error = '源布局含错误（' + sp.errors[0].msg + '），请先修正后再套用';
        items.push(item);
        return;
      }
      if (srcMap.region !== undefined) {
        var found = false;
        (doc.regions || []).forEach(function (r) { if (r.id && r.id === srcMap.region) found = true; });
        if (!found) {
          item.error = '源布局引用的区域「' + srcMap.region + '」不存在，无法套用';
          items.push(item);
          return;
        }
      }
      var updates = {};
      LAYOUT_KEYS.forEach(function (k) {
        updates[k] = srcMap[k] !== undefined ? srcMap[k] : null;
      });
      item.newSettings = applyLayoutUpdates(cue.settings, updates);
      item.changed = item.newSettings !== (cue.settings || '');
      items.push(item);
    });
    return items;
  }

  // ---------- 版本对照：采用布局设置 ----------

  // 单条采用对照版 cue settings 原文（时间与文本不动）。返回 {cues} 或 {error}。
  function adoptSettings(cues, at, settingsStr) {
    if (!Array.isArray(cues) || at < 0 || at >= cues.length) return { error: '指定的字幕不存在' };
    var out = cues.map(cloneCue);
    out[at].settings = settingsStr || '';
    return { cues: out };
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
    // 镜头切点检测
    frameMetrics: frameMetrics, metricsDelta: metricsDelta,
    findCutCandidates: findCutCandidates, refineCutWindow: refineCutWindow,
    nearestCut: nearestCut, analyzeCutConflicts: analyzeCutConflicts,
    planCutSnap: planCutSnap,
    // WebVTT 逐词时间码
    tokenizeCueText: tokenizeCueText, parseCueWords: parseCueWords,
    analyzeWordTimings: analyzeWordTimings, isContentTok: isContentTok,
    setWordTime: setWordTime, clearWordTime: clearWordTime, clearAllWordTimes: clearAllWordTimes,
    planWordBounds: planWordBounds, scaleWordTimes: scaleWordTimes,
    translateWordTimes: translateWordTimes, rewriteWordTimes: rewriteWordTimes,
    stripWordTimestamps: stripWordTimestamps, cuePreviewHtml: cuePreviewHtml,
    activeWord: activeWord, decodeEntity: decodeEntity,
    // WebVTT 画面布局
    parseCueSettings: parseCueSettings, validateCueSetting: validateCueSetting,
    parseRegionBlock: parseRegionBlock, validateRegionSetting: validateRegionSetting,
    tokenMap: tokenMap, parsePct: parsePct, parseLineValue: parseLineValue,
    parsePositionValue: parsePositionValue, positionAnchorOffset: positionAnchorOffset,
    parseAnchorValue: parseAnchorValue, fmtPct: fmtPct,
    analyzeCueSettings: analyzeCueSettings, analyzeLayoutSettings: analyzeLayoutSettings,
    computeCueBox: computeCueBox, boxToSettings: boxToSettings,
    applyLayoutUpdates: applyLayoutUpdates, analyzeLayoutConflicts: analyzeLayoutConflicts,
    planLayoutApply: planLayoutApply, adoptSettings: adoptSettings,
    LAYOUT_KEYS: LAYOUT_KEYS, LINE_HEIGHT_PCT: LINE_HEIGHT_PCT,
    simpleHash: simpleHash, draftKey: draftKey,
  };
});
