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
    simpleHash: simpleHash, draftKey: draftKey,
  };
});
