/* 字幕节奏校准台 — 浏览器主流程
 * 依赖 static/core.js（window.SubCore）与后端 /api/*。
 */
(function () {
  'use strict';

  var C = window.SubCore;

  // ---------- DOM ----------
  function $(id) { return document.getElementById(id); }
  var btnImport = $('btnImport'), fileInput = $('fileInput'), btnSample = $('btnSample');
  var btnUndo = $('btnUndo'), btnRedo = $('btnRedo');
  var btnPlay = $('btnPlay'), playTime = $('playTime');
  var searchInput = $('searchInput'), searchCount = $('searchCount');
  var exportFormat = $('exportFormat'), btnExport = $('btnExport');
  var setCps = $('setCps'), setMinDur = $('setMinDur'), setMinGap = $('setMinGap'), setOverlap = $('setOverlap');
  var btnAutoFix = $('btnAutoFix'), fileInfo = $('fileInfo'), draftInfo = $('draftInfo');
  var draftBanner = $('draftBanner'), draftBannerText = $('draftBannerText');
  var btnDraftRestore = $('btnDraftRestore'), btnDraftDismiss = $('btnDraftDismiss');
  var timelineWrap = $('timelineWrap'), canvas = $('timeline');
  var btnZoomOut = $('btnZoomOut'), btnZoomIn = $('btnZoomIn'), btnFit = $('btnFit');
  var cueTbody = $('cueTbody'), emptyState = $('emptyState'), cueListWrap = $('cueListWrap');
  var problemSummary = $('problemSummary'), problemList = $('problemList');
  var diffModal = $('diffModal'), diffSummary = $('diffSummary'), diffTbody = $('diffTbody');
  var btnDiffCancel = $('btnDiffCancel'), btnDiffApply = $('btnDiffApply');
  var statusMsg = $('statusMsg');

  var ctx = canvas.getContext('2d');

  // ---------- 常量 ----------
  var RULER_H = 28;
  var MIN_PX = 0.002, MAX_PX = 2;       // 每毫秒像素数范围
  var MIN_DUR = 40;                      // 拖动时允许的最小时长 ms
  var EDGE_PX = 6;                       // 边缘拖拽判定宽度
  var TYPE_LABEL = { cps: '语速', short: '过短', gap: '间隔', overlap: '重叠', order: '时序' };

  // ---------- 状态 ----------
  var state = {
    doc: null,            // {format, header, cues:[{num,start,end,settings,lines,autoNum}]}
    fileName: null,
    fileKey: null,
    selected: -1,
    playheadMs: 0,
    playing: false,
    view: { startMs: 0, pxPerMs: 0.1 },
    settings: { cpsMax: 20, minDurMs: 1000, minGapMs: 100, allowOverlap: false },
    problems: [],
    problemByCue: {},
    undoStack: [], redoStack: [],
    searchMatches: [], searchIdx: -1,
    dirty: false,
    pendingDraft: null,
    pendingChanges: null,
  };
  var rowEls = [];        // 每行 DOM 缓存
  var activeRowIdx = -1;  // 播放头当前所在字幕行

  // ---------- 工具 ----------
  function setStatus(msg) { statusMsg.textContent = msg; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function cues() { return state.doc ? state.doc.cues : []; }
  function docEnd() {
    var e = 0;
    cues().forEach(function (c) { if (c.end > e) e = c.end; });
    return e;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }

  // ---------- 撤销 / 重做 ----------
  var lastUndoLabel = '', lastUndoTime = 0;
  function snapshot() { return JSON.stringify(state.doc.cues); }
  function pushUndo(label) {
    if (!state.doc) return;
    var now = Date.now();
    // 同类操作 800ms 内合并为一步（拖拽、连续微调）
    if (label && label === lastUndoLabel && now - lastUndoTime < 800) {
      lastUndoTime = now;
      return;
    }
    state.undoStack.push(snapshot());
    if (state.undoStack.length > 100) state.undoStack.shift();
    state.redoStack.length = 0;
    lastUndoLabel = label; lastUndoTime = now;
    updateUndoButtons();
  }
  function doUndo() {
    if (!state.doc || !state.undoStack.length) return;
    state.redoStack.push(snapshot());
    state.doc.cues = JSON.parse(state.undoStack.pop());
    lastUndoLabel = '';
    renderList();
    afterChange('已撤销');
  }
  function doRedo() {
    if (!state.doc || !state.redoStack.length) return;
    state.undoStack.push(snapshot());
    state.doc.cues = JSON.parse(state.redoStack.pop());
    lastUndoLabel = '';
    renderList();
    afterChange('已重做');
  }
  function updateUndoButtons() {
    btnUndo.disabled = !state.undoStack.length;
    btnRedo.disabled = !state.redoStack.length;
  }

  // ---------- 变更后的统一刷新 ----------
  function afterChange(label) {
    analyzeAndRender();
    drawCanvas();
    scheduleAutosave();
    updateUndoButtons();
    if (label) setStatus(label);
  }

  // ---------- 载入文档 ----------
  function loadDocument(text, fileName) {
    var doc;
    try {
      doc = C.parseSubtitle(text);
    } catch (e) {
      setStatus('解析失败：' + e.message);
      return;
    }
    if (!doc.cues.length) {
      setStatus('未能从 ' + fileName + ' 解析到任何字幕条目');
      return;
    }
    state.doc = doc;
    state.fileName = fileName;
    state.fileKey = C.draftKey(fileName, text);
    state.selected = -1;
    state.playheadMs = 0;
    state.playing = false;
    state.undoStack.length = 0;
    state.redoStack.length = 0;
    state.dirty = false;
    state.pendingDraft = null;
    lastUndoLabel = '';
    hideDraftBanner();
    fitAll();
    renderList();
    updateFileInfo();
    analyzeAndRender();
    drawCanvas();
    updateUndoButtons();
    updateButtons();
    setStatus('已载入 ' + fileName + '（' + doc.cues.length + ' 条，' + doc.format.toUpperCase() + '）');
    checkDraft();
  }

  function updateFileInfo() {
    if (!state.doc) { fileInfo.textContent = ''; return; }
    fileInfo.textContent = state.fileName + ' · ' + state.doc.format.toUpperCase() +
      ' · ' + state.doc.cues.length + ' 条 · 总长 ' + C.fmtShort(docEnd());
  }

  function updateButtons() {
    var has = !!state.doc;
    btnExport.disabled = !has;
    btnAutoFix.disabled = !has;
  }

  // ---------- 字幕列表 ----------
  function renderList() {
    rowEls = [];
    cueTbody.innerHTML = '';
    emptyState.style.display = state.doc && state.doc.cues.length ? 'none' : 'flex';
    if (!state.doc) return;
    var frag = document.createDocumentFragment();
    state.doc.cues.forEach(function (cue, i) {
      var tr = document.createElement('tr');
      tr.dataset.i = i;
      tr.innerHTML =
        '<td class="c-num">' + esc(cue.num) + '</td>' +
        '<td class="time-cell"><input class="tcode" data-field="start" spellcheck="false"></td>' +
        '<td class="time-cell"><input class="tcode" data-field="end" spellcheck="false"></td>' +
        '<td class="dur"></td>' +
        '<td class="cps"></td>' +
        '<td class="c-text"><textarea spellcheck="false"></textarea></td>';
      var ta = tr.querySelector('textarea');
      ta.value = cue.lines.join('\n');
      ta.rows = clamp(cue.lines.length, 1, 3);
      frag.appendChild(tr);
      rowEls.push(tr);
      fillRowTimes(i);
    });
    cueTbody.appendChild(frag);
    state.doc.cues.forEach(function (_, i) { fillRowTimes(i); });
    markSelectedRow();
    runSearch(false);
  }

  function fillRowTimes(i) {
    var tr = rowEls[i];
    if (!tr) return;
    var cue = state.doc.cues[i];
    var dur = cue.end - cue.start;
    var cps = C.cueCps(cue);
    var inStart = tr.querySelector('input[data-field="start"]');
    var inEnd = tr.querySelector('input[data-field="end"]');
    if (document.activeElement !== inStart) inStart.value = C.fmtMs(cue.start, 'srt');
    if (document.activeElement !== inEnd) inEnd.value = C.fmtMs(cue.end, 'srt');
    inStart.classList.remove('invalid');
    inEnd.classList.remove('invalid');
    var durTd = tr.querySelector('td.dur');
    durTd.textContent = dur + 'ms';
    durTd.classList.toggle('short', dur < state.settings.minDurMs);
    var cpsTd = tr.querySelector('td.cps');
    cpsTd.textContent = isFinite(cps) ? cps.toFixed(1) : '—';
    cpsTd.classList.toggle('over', cps > state.settings.cpsMax);
  }

  function markSelectedRow() {
    rowEls.forEach(function (tr, i) {
      tr.classList.toggle('selected', i === state.selected);
    });
  }

  // 行内事件（委托）
  cueTbody.addEventListener('click', function (e) {
    var tr = e.target.closest('tr');
    if (!tr) return;
    var i = +tr.dataset.i;
    var inField = e.target.closest('input,textarea');
    selectCue(i, { center: !inField, scroll: false });
  });
  cueTbody.addEventListener('change', function (e) {
    var tr = e.target.closest('tr');
    if (!tr || !state.doc) return;
    var i = +tr.dataset.i;
    var cue = state.doc.cues[i];
    if (e.target.matches('input.tcode')) {
      var ms = C.parseTimecode(e.target.value);
      if (ms === null) {
        e.target.classList.add('invalid');
        setStatus('无法识别时间格式：' + e.target.value);
        return;
      }
      var field = e.target.dataset.field;
      pushUndo('edit');
      if (field === 'start') cue.start = Math.min(ms, cue.end - MIN_DUR);
      else cue.end = Math.max(ms, cue.start + MIN_DUR);
      fillRowTimes(i);
      afterChange('已修改第 ' + cue.num + ' 条时间');
    } else if (e.target.matches('textarea')) {
      pushUndo('text');
      cue.lines = e.target.value.split(/\r?\n/);
      while (cue.lines.length > 1 && cue.lines[cue.lines.length - 1] === '') cue.lines.pop();
      afterChange('已修改第 ' + cue.num + ' 条文本');
    }
  });

  // ---------- 选择 ----------
  function selectCue(i, opts) {
    opts = opts || {};
    if (!state.doc || i < 0 || i >= state.doc.cues.length) return;
    state.selected = i;
    markSelectedRow();
    if (opts.center) centerTimelineOn(state.doc.cues[i]);
    if (opts.scroll && rowEls[i]) rowEls[i].scrollIntoView({ block: 'nearest' });
    drawCanvas();
  }

  // ---------- 分析 ----------
  function analyzeAndRender() {
    if (!state.doc) {
      state.problems = [];
      problemSummary.textContent = '未载入字幕';
      problemList.innerHTML = '';
      return;
    }
    state.problems = C.analyze(state.doc.cues, state.settings);
    state.problemByCue = {};
    state.problems.forEach(function (p) {
      (state.problemByCue[p.cue] = state.problemByCue[p.cue] || []).push(p.type);
    });
    // 行标记
    rowEls.forEach(function (tr, i) {
      tr.classList.toggle('has-problem', !!state.problemByCue[i]);
    });
    // 汇总
    var counts = {};
    state.problems.forEach(function (p) { counts[p.type] = (counts[p.type] || 0) + 1; });
    if (!state.problems.length) {
      problemSummary.innerHTML = '<span class="ok">✓ 当前规则下未发现问题</span>';
    } else {
      problemSummary.innerHTML = '<span>共 ' + state.problems.length + ' 个问题：</span>' +
        Object.keys(counts).map(function (t) {
          return '<span class="badge ' + t + '">' + (TYPE_LABEL[t] || t) + ' ' + counts[t] + '</span>';
        }).join('');
    }
    // 列表
    problemList.innerHTML = '';
    var frag = document.createDocumentFragment();
    state.problems.forEach(function (p) {
      var cue = state.doc.cues[p.cue];
      var li = document.createElement('li');
      li.innerHTML =
        '<span class="badge ' + p.type + '">' + (TYPE_LABEL[p.type] || p.type) + '</span>' +
        '<span class="p-num">#' + esc(cue.num) + '</span>' +
        '<span class="p-msg">' + esc(p.msg) +
        '<span class="p-text">' + esc(cue.lines.join(' / ')) + '</span></span>';
      li.addEventListener('click', function () {
        selectCue(p.cue, { center: true, scroll: true });
        setStatus('定位到第 ' + cue.num + ' 条');
      });
      frag.appendChild(li);
    });
    problemList.appendChild(frag);
  }

  // ---------- 时间轴 ----------
  var cssW = 0, cssH = 0;
  function resizeCanvas() {
    var dpr = window.devicePixelRatio || 1;
    cssW = canvas.clientWidth; cssH = canvas.clientHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawCanvas();
  }

  function xToTime(x) { return state.view.startMs + x / state.view.pxPerMs; }
  function timeToX(t) { return (t - state.view.startMs) * state.view.pxPerMs; }

  function clampView() {
    state.view.startMs = clamp(state.view.startMs, -2000, Math.max(docEnd() + 1000, 1000));
  }

  function fitAll() {
    var end = docEnd();
    var w = canvas.clientWidth || 800;
    var pad = Math.max(end * 0.04, 500);
    var span = end + pad * 2 || 10000;
    state.view.pxPerMs = clamp(w / span, MIN_PX, MAX_PX);
    state.view.startMs = -pad;
    clampView();
  }

  function zoomAt(factor, anchorMs) {
    var v = state.view;
    var np = clamp(v.pxPerMs * factor, MIN_PX, MAX_PX);
    var real = np / v.pxPerMs;
    v.startMs = anchorMs - (anchorMs - v.startMs) / real;
    v.pxPerMs = np;
    clampView();
    drawCanvas();
  }

  function centerTimelineOn(cue) {
    var viewDur = cssW / state.view.pxPerMs;
    state.view.startMs = (cue.start + cue.end) / 2 - viewDur / 2;
    clampView();
    drawCanvas();
  }

  var TICK_STEPS = [10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000];
  function pickStep() {
    for (var i = 0; i < TICK_STEPS.length; i++) {
      if (TICK_STEPS[i] * state.view.pxPerMs >= 80) return TICK_STEPS[i];
    }
    return TICK_STEPS[TICK_STEPS.length - 1];
  }

  function drawCanvas() {
    if (!cssW) return;
    ctx.clearRect(0, 0, cssW, cssH);
    drawRuler();
    if (state.doc) drawCues();
    drawPlayhead();
  }

  function drawRuler() {
    ctx.fillStyle = '#161d2e';
    ctx.fillRect(0, 0, cssW, RULER_H);
    ctx.strokeStyle = '#2b3652';
    ctx.beginPath();
    ctx.moveTo(0, RULER_H - 0.5);
    ctx.lineTo(cssW, RULER_H - 0.5);
    ctx.stroke();
    var step = pickStep();
    var start = state.view.startMs;
    var end = xToTime(cssW);
    ctx.font = '10px ' + getComputedStyle(document.body).fontFamily;
    ctx.textBaseline = 'top';
    for (var t = Math.ceil(start / step) * step; t <= end; t += step) {
      var x = Math.round(timeToX(t)) + 0.5;
      ctx.strokeStyle = '#3a4a6e';
      ctx.beginPath();
      ctx.moveTo(x, RULER_H - 8);
      ctx.lineTo(x, RULER_H);
      ctx.stroke();
      ctx.fillStyle = '#8595b6';
      ctx.fillText(C.fmtShort(t), x + 3, 6);
      // 次刻度
      var minor = step / 4;
      ctx.strokeStyle = '#232d47';
      for (var k = 1; k < 4; k++) {
        var mx = Math.round(timeToX(t + minor * k)) + 0.5;
        if (mx >= cssW) break;
        ctx.beginPath();
        ctx.moveTo(mx, RULER_H - 4);
        ctx.lineTo(mx, RULER_H);
        ctx.stroke();
      }
    }
  }

  function drawCues() {
    var blockY = RULER_H + 8;
    var blockH = cssH - blockY - 12;
    if (blockH < 20) blockH = 20;
    var viewEnd = xToTime(cssW);
    ctx.font = '11px ' + getComputedStyle(document.body).fontFamily;
    ctx.textBaseline = 'middle';
    state.doc.cues.forEach(function (cue, i) {
      if (cue.end < state.view.startMs || cue.start > viewEnd) return;
      var x1 = timeToX(cue.start);
      var x2 = timeToX(cue.end);
      if (x2 - x1 < 2) x2 = x1 + 2;
      var probs = state.problemByCue[i] || [];
      var selected = i === state.selected;
      var active = state.playheadMs >= cue.start && state.playheadMs < cue.end;
      // 填充
      var fill = '#2a3d66';
      if (probs.indexOf('overlap') !== -1 || probs.indexOf('order') !== -1) fill = '#5c2a2a';
      else if (probs.length) fill = '#5c4a14';
      if (selected) fill = probs.length ? '#8a6d1f' : '#3f6fd8';
      ctx.fillStyle = fill;
      roundRect(x1, blockY, x2 - x1, blockH, 4);
      ctx.fill();
      // 边框
      ctx.lineWidth = selected ? 2 : 1;
      ctx.strokeStyle = selected ? '#9fc0ff' : (active ? '#34d399' : '#4a5b85');
      roundRect(x1 + 0.5, blockY + 0.5, x2 - x1 - 1, blockH - 1, 4);
      ctx.stroke();
      // 选中时画边缘手柄
      if (selected) {
        ctx.fillStyle = '#9fc0ff';
        ctx.fillRect(x1, blockY + 4, 3, blockH - 8);
        ctx.fillRect(x2 - 3, blockY + 4, 3, blockH - 8);
      }
      // 文本
      var label = '#' + cue.num + '  ' + cue.lines.join(' ');
      ctx.save();
      ctx.beginPath();
      ctx.rect(x1 + 4, blockY, Math.max(0, x2 - x1 - 8), blockH);
      ctx.clip();
      ctx.fillStyle = selected ? '#ffffff' : '#c4d2ee';
      ctx.fillText(label, x1 + 6, blockY + blockH / 2);
      ctx.restore();
    });
  }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPlayhead() {
    var x = timeToX(state.playheadMs);
    if (x < -10 || x > cssW + 10) return;
    ctx.strokeStyle = '#f87171';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, cssH);
    ctx.stroke();
    ctx.fillStyle = '#f87171';
    ctx.beginPath();
    ctx.moveTo(x - 5, 0);
    ctx.lineTo(x + 5, 0);
    ctx.lineTo(x, 8);
    ctx.closePath();
    ctx.fill();
  }

  // ---------- 时间轴交互 ----------
  var drag = null; // {mode, idx, startX, origStart, origEnd, viewStart, moved}

  function hitTest(x, y) {
    if (!state.doc || y < RULER_H) return null;
    var blockY = RULER_H + 8;
    var blockH = cssH - blockY - 12;
    if (y < blockY || y > blockY + Math.max(blockH, 20)) return null;
    var t = xToTime(x);
    var list = state.doc.cues;
    for (var i = 0; i < list.length; i++) {
      var x1 = timeToX(list[i].start), x2 = timeToX(list[i].end);
      if (x2 - x1 < 2) x2 = x1 + 2;
      if (x >= x1 - 2 && x <= x2 + 2) {
        if (x <= x1 + EDGE_PX) return { idx: i, mode: 'resize-l' };
        if (x >= x2 - EDGE_PX) return { idx: i, mode: 'resize-r' };
        return { idx: i, mode: 'move' };
      }
    }
    return null;
  }

  canvas.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    var rect = canvas.getBoundingClientRect();
    var x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (y < RULER_H) {
      drag = { mode: 'scrub', moved: false };
      state.playheadMs = Math.max(0, xToTime(x));
      updatePlayUI(); drawCanvas();
      return;
    }
    var hit = hitTest(x, y);
    if (hit) {
      var cue = state.doc.cues[hit.idx];
      selectCue(hit.idx, {});
      drag = {
        mode: hit.mode, idx: hit.idx, startX: x,
        origStart: cue.start, origEnd: cue.end, moved: false,
      };
    } else {
      drag = { mode: 'pan', startX: x, viewStart: state.view.startMs, moved: false };
    }
  });

  window.addEventListener('mousemove', function (e) {
    if (!drag) return;
    var rect = canvas.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var dx = x - (drag.startX || 0);
    if (Math.abs(dx) > 2) drag.moved = true;
    if (drag.mode === 'scrub') {
      state.playheadMs = Math.max(0, xToTime(x));
      updatePlayUI(); drawCanvas();
      return;
    }
    if (drag.mode === 'pan') {
      state.view.startMs = drag.viewStart - dx / state.view.pxPerMs;
      clampView(); drawCanvas();
      return;
    }
    // 移动 / 调整边缘
    var cue = state.doc.cues[drag.idx];
    var dt = Math.round(dx / state.view.pxPerMs);
    if (!drag.moved) return;
    if (!drag.undoPushed) { pushUndo('drag'); drag.undoPushed = true; }
    if (drag.mode === 'move') {
      var dur = drag.origEnd - drag.origStart;
      var ns = Math.max(0, drag.origStart + dt);
      cue.start = ns;
      cue.end = ns + dur;
    } else if (drag.mode === 'resize-l') {
      cue.start = clamp(drag.origStart + dt, 0, cue.end - MIN_DUR);
    } else if (drag.mode === 'resize-r') {
      cue.end = Math.max(drag.origEnd + dt, cue.start + MIN_DUR);
    }
    fillRowTimes(drag.idx);
    analyzeAndRender();
    drawCanvas();
  });

  window.addEventListener('mouseup', function () {
    if (!drag) return;
    var wasMoved = drag.moved && drag.undoPushed;
    var idx = drag.idx;
    drag = null;
    if (wasMoved) {
      var cue = state.doc.cues[idx];
      afterChange('已调整第 ' + cue.num + ' 条：' +
        C.fmtMs(cue.start, 'srt') + ' → ' + C.fmtMs(cue.end, 'srt'));
    }
  });

  canvas.addEventListener('mousemove', function (e) {
    if (drag) return;
    var rect = canvas.getBoundingClientRect();
    var hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) { canvas.style.cursor = e.offsetY < RULER_H ? 'col-resize' : 'default'; return; }
    canvas.style.cursor = hit.mode === 'move' ? 'move' : 'ew-resize';
  });

  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var x = e.clientX - rect.left;
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      state.view.startMs += (e.deltaX || e.deltaY) / state.view.pxPerMs;
      clampView(); drawCanvas();
    } else {
      zoomAt(Math.pow(1.0015, -e.deltaY), xToTime(x));
    }
  }, { passive: false });

  canvas.addEventListener('dblclick', function (e) {
    var rect = canvas.getBoundingClientRect();
    var hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) {
      state.playheadMs = state.doc.cues[hit.idx].start;
      updatePlayUI(); drawCanvas();
    }
  });

  btnZoomIn.addEventListener('click', function () { zoomAt(1.5, xToTime(cssW / 2)); });
  btnZoomOut.addEventListener('click', function () { zoomAt(1 / 1.5, xToTime(cssW / 2)); });
  btnFit.addEventListener('click', function () { fitAll(); drawCanvas(); });

  // ---------- 播放 ----------
  var rafId = null, lastTs = 0;
  function setPlaying(on) {
    if (!state.doc) return;
    state.playing = on;
    btnPlay.textContent = on ? '⏸ 暂停' : '▶ 播放';
    if (on) {
      lastTs = performance.now();
      rafId = requestAnimationFrame(tick);
    } else if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }
  function tick(ts) {
    if (!state.playing) return;
    var dt = ts - lastTs;
    lastTs = ts;
    state.playheadMs += dt;
    var end = docEnd();
    if (state.playheadMs >= end + 800) {
      state.playheadMs = end + 800;
      setPlaying(false);
    }
    // 跟随播放头
    if (timeToX(state.playheadMs) > cssW - 40) {
      state.view.startMs = state.playheadMs - 0.2 * (cssW / state.view.pxPerMs);
      clampView();
    }
    updatePlayUI();
    highlightActiveRow();
    drawCanvas();
    rafId = requestAnimationFrame(tick);
  }
  function updatePlayUI() {
    playTime.textContent = C.fmtShort(state.playheadMs);
  }
  function highlightActiveRow() {
    var idx = -1;
    var list = cues();
    for (var i = 0; i < list.length; i++) {
      if (state.playheadMs >= list[i].start && state.playheadMs < list[i].end) { idx = i; break; }
    }
    if (idx === activeRowIdx) return;
    if (activeRowIdx >= 0 && rowEls[activeRowIdx]) rowEls[activeRowIdx].classList.remove('active-play');
    if (idx >= 0 && rowEls[idx]) rowEls[idx].classList.add('active-play');
    activeRowIdx = idx;
  }
  btnPlay.addEventListener('click', function () { setPlaying(!state.playing); });

  // ---------- 键盘 ----------
  function nudgeSelected(mode, dir, step) {
    if (!state.doc || state.selected < 0) return;
    var cue = state.doc.cues[state.selected];
    pushUndo('nudge');
    var d = dir * step;
    if (mode === 'both') {
      var dur = cue.end - cue.start;
      cue.start = Math.max(0, cue.start + d);
      cue.end = cue.start + dur;
    } else if (mode === 'start') {
      cue.start = clamp(cue.start + d, 0, cue.end - MIN_DUR);
    } else {
      cue.end = Math.max(cue.end + d, cue.start + MIN_DUR);
    }
    fillRowTimes(state.selected);
    afterChange(null);
    setStatus('第 ' + cue.num + ' 条：' + C.fmtMs(cue.start, 'srt') + ' → ' + C.fmtMs(cue.end, 'srt'));
  }

  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    var typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (e.key === 'Escape' && typing) { e.target.blur(); return; }
    if (typing) return;
    if (!diffModal.classList.contains('hidden')) {
      if (e.key === 'Escape') hideDiff();
      return;
    }
    var step = e.shiftKey ? 500 : (e.altKey ? 10 : 100);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) doRedo(); else doUndo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault(); doRedo(); return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault(); searchInput.focus(); searchInput.select(); return;
    }
    switch (e.key) {
      case ' ':
        e.preventDefault();
        setPlaying(!state.playing);
        break;
      case 'ArrowLeft':
        e.preventDefault(); nudgeSelected('both', -1, step); break;
      case 'ArrowRight':
        e.preventDefault(); nudgeSelected('both', 1, step); break;
      case '[': nudgeSelected('start', -1, step); break;
      case ']': nudgeSelected('start', 1, step); break;
      case ';': nudgeSelected('end', -1, step); break;
      case "'": nudgeSelected('end', 1, step); break;
      case '0': fitAll(); drawCanvas(); break;
      case 'ArrowUp':
        e.preventDefault();
        if (state.selected > 0) selectCue(state.selected - 1, { center: false, scroll: true });
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (state.selected >= 0 && state.selected < cues().length - 1) {
          selectCue(state.selected + 1, { center: false, scroll: true });
        }
        break;
    }
  });

  // ---------- 搜索 ----------
  function runSearch(jump) {
    var q = searchInput.value.trim().toLowerCase();
    state.searchMatches = [];
    if (q && state.doc) {
      state.doc.cues.forEach(function (c, i) {
        if (c.lines.join('\n').toLowerCase().indexOf(q) !== -1) state.searchMatches.push(i);
      });
    }
    state.searchIdx = -1;
    rowEls.forEach(function (tr, i) {
      tr.classList.toggle('search-hit', q !== '' && state.searchMatches.indexOf(i) !== -1);
      tr.classList.remove('search-cur');
    });
    searchCount.textContent = q ? (state.searchMatches.length + ' 处匹配') : '';
    if (jump && state.searchMatches.length) jumpSearch(1);
  }
  function jumpSearch(dir) {
    var m = state.searchMatches;
    if (!m.length) { setStatus('无匹配'); return; }
    state.searchIdx = (state.searchIdx + dir + m.length) % m.length;
    var idx = m[state.searchIdx];
    rowEls.forEach(function (tr) { tr.classList.remove('search-cur'); });
    if (rowEls[idx]) rowEls[idx].classList.add('search-cur');
    searchCount.textContent = (state.searchIdx + 1) + '/' + m.length;
    selectCue(idx, { center: true, scroll: true });
  }
  searchInput.addEventListener('input', function () { runSearch(false); });
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!state.searchMatches.length) runSearch(false);
      jumpSearch(e.shiftKey ? -1 : 1);
      searchInput.blur();
    }
  });

  // ---------- 自动顺延与差异预览 ----------
  btnAutoFix.addEventListener('click', function () {
    if (!state.doc) return;
    var changes = C.computeAutoFix(state.doc.cues, state.settings);
    if (!changes.length) {
      setStatus('当前规则下无需顺延');
      return;
    }
    state.pendingChanges = changes;
    diffSummary.textContent = '将调整 ' + changes.length + ' 条字幕（保持原有顺序，仅延长停留或向后顺延）：';
    diffTbody.innerHTML = '';
    var frag = document.createDocumentFragment();
    changes.forEach(function (ch) {
      var cue = state.doc.cues[ch.i];
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="mono">#' + esc(ch.num) + '</td>' +
        '<td><span class="old mono">' + C.fmtMs(ch.oldStart, 'srt') + '</span> → <span class="new">' + C.fmtMs(ch.newStart, 'srt') + '</span></td>' +
        '<td><span class="old mono">' + C.fmtMs(ch.oldEnd, 'srt') + '</span> → <span class="new">' + C.fmtMs(ch.newEnd, 'srt') + '</span></td>' +
        '<td class="muted">' + esc(cue.lines.join(' / ')) + '</td>';
      frag.appendChild(tr);
    });
    diffTbody.appendChild(frag);
    diffModal.classList.remove('hidden');
  });
  function hideDiff() {
    diffModal.classList.add('hidden');
    state.pendingChanges = null;
  }
  btnDiffCancel.addEventListener('click', hideDiff);
  diffModal.addEventListener('click', function (e) { if (e.target === diffModal) hideDiff(); });
  btnDiffApply.addEventListener('click', function () {
    var changes = state.pendingChanges;
    if (!changes || !state.doc) { hideDiff(); return; }
    pushUndo('autofix');
    changes.forEach(function (ch) {
      var cue = state.doc.cues[ch.i];
      cue.start = ch.newStart;
      cue.end = ch.newEnd;
    });
    hideDiff();
    renderList();
    afterChange('已应用自动顺延（' + changes.length + ' 条）');
  });

  // ---------- 草稿 ----------
  var saveTimer = null;
  function scheduleAutosave() {
    if (!state.doc || !state.fileKey) return;
    state.dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 900);
  }
  function draftPayload() {
    return JSON.stringify({
      format: state.doc.format,
      header: state.doc.header,
      cues: state.doc.cues,
      fileName: state.fileName,
    });
  }
  function saveDraft() {
    if (!state.dirty || !state.doc) return;
    fetch('/api/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: state.fileKey,
        filename: state.fileName,
        format: state.doc.format,
        content: draftPayload(),
      }),
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      state.dirty = false;
      draftInfo.textContent = '草稿已保存 ' + new Date().toLocaleTimeString();
    }).catch(function () {
      draftInfo.textContent = '草稿保存失败';
    });
  }
  function checkDraft() {
    if (!state.fileKey) return;
    fetch('/api/draft?key=' + encodeURIComponent(state.fileKey))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.found || !data.draft) return;
        state.pendingDraft = data.draft;
        var when = new Date(data.draft.updated_at * 1000).toLocaleString();
        draftBannerText.textContent = '检测到《' + data.draft.filename + '》的本地草稿（保存于 ' + when + '），是否恢复上次未导出的修改？';
        draftBanner.classList.remove('hidden');
      })
      .catch(function () { /* 无草稿或服务器异常，忽略 */ });
  }
  function hideDraftBanner() {
    draftBanner.classList.add('hidden');
    state.pendingDraft = null;
  }
  btnDraftRestore.addEventListener('click', function () {
    var d = state.pendingDraft;
    if (!d || !state.doc) { hideDraftBanner(); return; }
    try {
      var payload = JSON.parse(d.content);
      if (!payload.cues || payload.cues.length !== state.doc.cues.length) {
        setStatus('草稿与当前文件条目数不一致，未恢复');
        hideDraftBanner();
        return;
      }
      pushUndo('restore');
      state.doc.cues = payload.cues;
      if (payload.header !== undefined) state.doc.header = payload.header;
      renderList();
      afterChange('已恢复本地草稿');
    } catch (e) {
      setStatus('草稿内容损坏，未恢复');
    }
    hideDraftBanner();
  });
  btnDraftDismiss.addEventListener('click', function () {
    if (state.fileKey) {
      fetch('/api/draft?key=' + encodeURIComponent(state.fileKey), { method: 'DELETE' }).catch(function () {});
    }
    draftInfo.textContent = '';
    hideDraftBanner();
  });
  window.addEventListener('beforeunload', function () {
    if (state.dirty && state.doc && state.fileKey) {
      fetch('/api/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          key: state.fileKey,
          filename: state.fileName,
          format: state.doc.format,
          content: draftPayload(),
        }),
      }).catch(function () {});
    }
  });

  // ---------- 导入 / 示例 / 导出 ----------
  btnImport.addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () {
    var f = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () { loadDocument(String(reader.result || ''), f.name); };
    reader.onerror = function () { setStatus('读取文件失败'); };
    reader.readAsText(f, 'utf-8');
  });

  btnSample.addEventListener('click', function () {
    fetch('/api/sample')
      .then(function (r) { return r.json(); })
      .then(function (data) { loadDocument(data.content, data.filename); })
      .catch(function () { setStatus('无法获取示例字幕（服务器未响应）'); });
  });

  btnExport.addEventListener('click', function () {
    if (!state.doc) return;
    var sel = exportFormat.value;
    var fmt = sel === 'orig' ? state.doc.format : sel;
    var text = C.serialize(state.doc, fmt);
    var base = (state.fileName || 'subtitle').replace(/\.(srt|vtt)$/i, '');
    var outName = base + '-calibrated.' + fmt;
    var mime = fmt === 'vtt' ? 'text/vtt' : 'application/x-subrip';
    var blob = new Blob([text], { type: mime + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = outName;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 100);
    // 导出完成 → 清除该文件草稿
    if (state.fileKey) {
      fetch('/api/draft?key=' + encodeURIComponent(state.fileKey), { method: 'DELETE' }).catch(function () {});
    }
    state.dirty = false;
    draftInfo.textContent = '已导出，草稿已清除';
    setStatus('已导出 ' + outName + '（' + fmt.toUpperCase() + '，保持原编号与换行）');
  });

  // ---------- 规则设置 ----------
  function loadSettings() {
    try {
      var saved = JSON.parse(localStorage.getItem('subcal.settings') || '{}');
      Object.keys(state.settings).forEach(function (k) {
        if (saved[k] !== undefined) state.settings[k] = saved[k];
      });
    } catch (e) { /* 忽略损坏的设置 */ }
    setCps.value = state.settings.cpsMax;
    setMinDur.value = state.settings.minDurMs;
    setMinGap.value = state.settings.minGapMs;
    setOverlap.checked = state.settings.allowOverlap;
  }
  function saveSettings() {
    state.settings.cpsMax = clamp(+setCps.value || 20, 1, 60);
    state.settings.minDurMs = clamp(+setMinDur.value || 1000, 100, 10000);
    state.settings.minGapMs = clamp(+setMinGap.value || 0, 0, 2000);
    state.settings.allowOverlap = setOverlap.checked;
    localStorage.setItem('subcal.settings', JSON.stringify(state.settings));
    if (state.doc) {
      analyzeAndRender();
      state.doc.cues.forEach(function (_, i) { fillRowTimes(i); });
      drawCanvas();
    }
  }
  [setCps, setMinDur, setMinGap, setOverlap].forEach(function (el) {
    el.addEventListener('change', saveSettings);
  });

  // ---------- 撤销 / 重做按钮 ----------
  btnUndo.addEventListener('click', doUndo);
  btnRedo.addEventListener('click', doRedo);

  // ---------- 初始化 ----------
  function init() {
    loadSettings();
    updateButtons();
    updateUndoButtons();
    resizeCanvas();
    if (window.ResizeObserver) {
      new ResizeObserver(resizeCanvas).observe(timelineWrap);
    } else {
      window.addEventListener('resize', resizeCanvas);
    }
    updatePlayUI();
    // 首次启动自动载入内置示例，无需任何外部服务
    fetch('/api/sample')
      .then(function (r) { return r.json(); })
      .then(function (data) { loadDocument(data.content, data.filename); })
      .catch(function () { setStatus('服务器未响应，请确认通过 python3 server.py 启动'); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
