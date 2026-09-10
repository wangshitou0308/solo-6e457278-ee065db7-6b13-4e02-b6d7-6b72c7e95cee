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
  var setMaxChars = $('setMaxChars'), setMaxLines = $('setMaxLines');
  var btnAutoFix = $('btnAutoFix'), fileInfo = $('fileInfo'), draftInfo = $('draftInfo');
  var btnRewrapAll = $('btnRewrapAll');
  var draftBanner = $('draftBanner'), draftBannerText = $('draftBannerText');
  var btnDraftRestore = $('btnDraftRestore'), btnDraftDismiss = $('btnDraftDismiss');
  var timelineWrap = $('timelineWrap'), canvas = $('timeline');
  var btnZoomOut = $('btnZoomOut'), btnZoomIn = $('btnZoomIn'), btnFit = $('btnFit');
  var cueTbody = $('cueTbody'), emptyState = $('emptyState'), cueListWrap = $('cueListWrap');
  var problemSummary = $('problemSummary'), problemList = $('problemList');
  var diffModal = $('diffModal'), diffSummary = $('diffSummary'), diffTbody = $('diffTbody');
  var btnDiffCancel = $('btnDiffCancel'), btnDiffApply = $('btnDiffApply');
  var rewrapModal = $('rewrapModal'), rewrapSummary = $('rewrapSummary'), rewrapTbody = $('rewrapTbody');
  var btnRewrapCancel = $('btnRewrapCancel'), btnRewrapApply = $('btnRewrapApply');
  var statusMsg = $('statusMsg');
  // 媒体对照
  var mediaBanner = $('mediaBanner'), mediaBannerText = $('mediaBannerText');
  var btnMediaPick = $('btnMediaPick'), btnMediaDismiss = $('btnMediaDismiss');
  var btnLoadMedia = $('btnLoadMedia'), mediaInput = $('mediaInput'), btnUnloadMedia = $('btnUnloadMedia');
  var mediaState = $('mediaState'), mediaClock = $('mediaClock'), mediaRate = $('mediaRate');
  var loopCueChk = $('loopCueChk'), loopPadBefore = $('loopPadBefore'), loopPadAfter = $('loopPadAfter');
  var btnSnapStart = $('btnSnapStart'), btnSnapEnd = $('btnSnapEnd');
  var btnMarkA1 = $('btnMarkA1'), btnMarkA2 = $('btnMarkA2'), btnAnchorSync = $('btnAnchorSync');
  var nowCueText = $('nowCueText');
  var mediaBox = $('mediaBox'), mediaVideo = $('mediaVideo');
  var audioBadge = $('audioBadge'), audioName = $('audioName'), nowCueOverlay = $('nowCueOverlay');
  var anchorModal = $('anchorModal'), anchorFormula = $('anchorFormula'), anchorError = $('anchorError');
  var anchorDiffTbody = $('anchorDiffTbody');
  var btnAnchorClose = $('btnAnchorClose'), btnAnchorApply = $('btnAnchorApply');
  var btnClearA1 = $('btnClearA1'), btnClearA2 = $('btnClearA2');
  var anchorCells = {
    a1: { cue: $('a1Cue'), src: $('a1Src'), dst: $('a1Dst') },
    a2: { cue: $('a2Cue'), src: $('a2Src'), dst: $('a2Dst') },
  };

  var ctx = canvas.getContext('2d');

  // ---------- 常量 ----------
  var RULER_H = 28;
  var MIN_PX = 0.002, MAX_PX = 2;       // 每毫秒像素数范围
  var MIN_DUR = 40;                      // 拖动时允许的最小时长 ms
  var EDGE_PX = 6;                       // 边缘拖拽判定宽度
  var TYPE_LABEL = {
    cps: '语速', short: '过短', gap: '间隔', overlap: '重叠', order: '时序',
    longline: '超长行', orphan: '孤立标点', toomany: '超行数',
  };

  // ---------- 状态 ----------
  var state = {
    doc: null,            // {format, header, cues:[{num,start,end,settings,lines,autoNum}]}
    fileName: null,
    fileKey: null,
    selected: -1,
    playheadMs: 0,
    playing: false,
    view: { startMs: 0, pxPerMs: 0.1 },
    settings: { cpsMax: 20, minDurMs: 1000, minGapMs: 100, allowOverlap: false,
      maxChars: 18, maxLines: 2 },
    problems: [],
    problemByCue: {},
    undoStack: [], redoStack: [],
    searchMatches: [], searchIdx: -1,
    dirty: false,
    pendingDraft: null,
    pendingChanges: null,
    // 媒体对照（对象 URL 仅在浏览器内存中，绝不发送到服务器）
    media: { url: null, name: null, isVideo: false, ready: false, duration: 0, pending: null },
    rate: 1,
    loop: { on: false, padBefore: 300, padAfter: 500 },
    anchors: { a1: null, a2: null },   // {cue, num, srcTime, dstTime}
    pendingSync: null,                  // 双锚点预览结果
    pendingRewrap: null,                // 批量分行预览计划
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

  // ---------- 播放头与媒体同步 ----------
  // 统一入口：移动播放头时同步媒体进度（fromMedia 为 true 时表示时间来自媒体本身，避免回写）
  function setPlayhead(ms, fromMedia) {
    state.playheadMs = Math.max(0, ms);
    if (state.media.ready && !fromMedia) {
      var t = state.playheadMs / 1000;
      if (Math.abs(mediaVideo.currentTime - t) > 0.04) mediaVideo.currentTime = t;
    }
    updatePlayUI();
    drawCanvas();
  }

  function hasMedia() { return state.media.ready; }

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
    if (state.playing) setPlaying(false);
    setPlayhead(0);
    state.undoStack.length = 0;
    state.redoStack.length = 0;
    state.dirty = false;
    state.pendingDraft = null;
    state.anchors.a1 = null;
    state.anchors.a2 = null;
    state.loop.on = false;
    loopCueChk.checked = false;
    lastUndoLabel = '';
    hideDraftBanner();
    fitAll();
    renderList();
    updateFileInfo();
    analyzeAndRender();
    drawCanvas();
    updateUndoButtons();
    updateButtons();
    updateSnapButtons();
    updateAnchorButtons();
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
    btnRewrapAll.disabled = !has;
  }

  // 最后一条不能与下一条合并；无文档时全部禁用
  function markRowOps() {
    if (!state.doc) return;
    state.doc.cues.forEach(function (_, i) {
      var tr = rowEls[i];
      if (!tr) return;
      var canMerge = i < state.doc.cues.length - 1;
      tr.querySelector('.op-merge').disabled = !canMerge;
      tr.querySelector('.op-split').disabled = false;
      tr.querySelector('.op-rewrap').disabled = false;
    });
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
        '<td class="c-text"><textarea spellcheck="false"></textarea></td>' +
        '<td class="c-ops">' +
          '<button class="op-split" title="在文本光标处拆分（或按 Ctrl+Enter）">拆</button>' +
          '<button class="op-merge" title="与下一条合并（时间覆盖原区间）">合</button>' +
          '<button class="op-rewrap" title="按每行字数 / 最多行数智能分行">排</button>' +
        '</td>';
      var ta = tr.querySelector('textarea');
      ta.value = cue.lines.join('\n');
      ta.rows = clamp(cue.lines.length, 1, 4);
      frag.appendChild(tr);
      rowEls.push(tr);
      fillRowTimes(i);
    });
    cueTbody.appendChild(frag);
    state.doc.cues.forEach(function (_, i) { fillRowTimes(i); });
    markSelectedRow();
    markRowOps();
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

  // ---------- 拆分 / 合并 / 智能分行 ----------

  // 文本框的 change 只在失焦时触发；结构操作前先把未失焦的编辑静默提交到模型。
  // 返回是否发生了提交（不单独压入撤销栈，文本修改并入随后的结构操作一步）。
  function commitRow(i) {
    if (!state.doc || i < 0 || i >= state.doc.cues.length) return false;
    var rowTa = rowEls[i] && rowEls[i].querySelector('textarea');
    if (!rowTa) return false;
    var cue = state.doc.cues[i];
    var lines = rowTa.value.split(/\r?\n/);
    while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    var same = lines.length === cue.lines.length &&
      lines.every(function (l, k) { return l === cue.lines[k]; });
    if (same) return false;
    cue.lines = lines;
    return true;
  }
  function commitAllRows() {
    if (!state.doc) return false;
    var any = false;
    for (var i = 0; i < state.doc.cues.length; i++) {
      if (commitRow(i)) any = true;
    }
    return any;
  }

  // 未指定光标时：在文本中部 45%~55% 区间找最晚的标点/空格断点，找不到则正中间
  function pickMiddleCaret(text) {
    var mid = Math.floor(text.length / 2);
    var lo = Math.floor(text.length * 0.45), hi = Math.ceil(text.length * 0.55);
    var best = -1;
    for (var k = Math.min(hi, text.length - 1); k >= lo; k--) {
      if (/[,.;:!?，。；：！？、…\s]/.test(text[k])) { best = k + 1; break; }
    }
    return best >= 0 ? best : mid;
  }

  // 在第 i 条、其文本框光标 caret 处拆分；未聚焦该行文本框时按文本中点回退
  function splitAtCaret(i, ta) {
    if (!state.doc) return;
    // 输入后未失焦直接拆分：先把文本框当前内容提交到模型
    var rowTa = ta || (rowEls[i] && rowEls[i].querySelector('textarea'));
    if (rowTa && document.activeElement === rowTa) commitRow(i);
    var cue = state.doc.cues[i];
    var full = cue.lines.join('\n');
    var caret = null;
    var focusedOther = document.activeElement &&
      document.activeElement.matches && document.activeElement.matches('textarea');
    if (rowTa && document.activeElement === rowTa) caret = rowTa.selectionStart;
    if (caret === null) {
      if (focusedOther) { setStatus('请先点击要拆分字幕的文本框'); return; }
      // 未聚焦文本框：优先在中点附近的断点（标点/空格）拆分，否则正中间
      caret = pickMiddleCaret(full);
    }
    var beforeLines = full.slice(0, caret).split(/\r?\n/);
    var afterLines = full.slice(caret).split(/\r?\n/);
    var inRange = state.playheadMs > cue.start && state.playheadMs < cue.end;
    var res = C.splitDoc(state.doc.cues, i, beforeLines, afterLines,
      Math.round(state.playheadMs), state.doc.format);
    if (res.error) { setStatus('无法拆分：' + res.error); return; }
    pushUndo('split');
    state.doc.cues = res.cues;
    state.anchors.a1 = null; state.anchors.a2 = null;
    updateAnchorButtons();
    renderList();
    // 选中后段，光标停在其文本开头，便于连续拆分
    var newSel = i + 1;
    selectCue(newSel, { scroll: true });
    afterChange('已在 ' + (inRange
      ? '播放头 ' + C.fmtMs(res.at, 'srt')
      : '按文字比例 ' + C.fmtMs(res.at, 'srt')) + ' 拆分为第 ' +
      state.doc.cues[i].num + ' / ' + state.doc.cues[newSel].num + ' 条');
    var nta = rowEls[newSel] && rowEls[newSel].querySelector('textarea');
    if (nta) { nta.focus(); nta.setSelectionRange(0, 0); }
  }

  // 合并第 i 条与其下一条
  function mergeWithNext(i) {
    if (!state.doc) return;
    commitRow(i);
    commitRow(i + 1);
    var a = state.doc.cues[i], b = state.doc.cues[i + 1];
    var res = C.mergeDoc(state.doc.cues, i, state.doc.format);
    if (res.error) { setStatus('无法合并：' + res.error); return; }
    pushUndo('merge');
    state.doc.cues = res.cues;
    state.anchors.a1 = null; state.anchors.a2 = null;
    updateAnchorButtons();
    renderList();
    selectCue(i, { scroll: true });
    afterChange('已合并第 ' + a.num + ' / ' + b.num + ' 条，时间覆盖 ' +
      C.fmtMs(res.cues[i].start, 'srt') + ' → ' + C.fmtMs(res.cues[i].end, 'srt'));
  }

  // 单条智能分行
  function rewrapOne(i) {
    if (!state.doc) return;
    commitRow(i);
    var cue = state.doc.cues[i];
    var res = C.rewrapCue(cue, state.settings.maxChars, state.settings.maxLines);
    if (!res.ok) {
      setStatus('第 ' + cue.num + ' 条无法智能分行：' + res.error);
      return false;
    }
    var changed = res.lines.length !== cue.lines.length ||
      res.lines.some(function (l, idx) { return l !== cue.lines[idx]; });
    if (!changed) {
      setStatus('第 ' + cue.num + ' 条已满足每行 ' + state.settings.maxChars +
        ' 字、最多 ' + state.settings.maxLines + ' 行，无需重排');
      return true;
    }
    pushUndo('rewrap');
    cue.lines = res.lines;
    renderList();
    selectCue(i, { scroll: false });
    afterChange('已对第 ' + cue.num + ' 条智能分行（' + res.lines.length + ' 行，未删字）');
    return true;
  }

  // 操作列按钮委托
  cueTbody.addEventListener('click', function (e) {
    var btn = e.target.closest('button.op-split, button.op-merge, button.op-rewrap');
    if (!btn) return;
    e.stopPropagation();
    var tr = e.target.closest('tr');
    if (!tr || !state.doc) return;
    var i = +tr.dataset.i;
    selectCue(i, { scroll: false });
    if (btn.classList.contains('op-split')) splitAtCaret(i, tr.querySelector('textarea'));
    else if (btn.classList.contains('op-merge')) mergeWithNext(i);
    else rewrapOne(i);
  });

  // 文本框中 Ctrl+Enter 在光标处拆分
  cueTbody.addEventListener('keydown', function (e) {
    if (!e.target.matches('textarea')) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'Enter' || e.keyCode === 13)) {
      e.preventDefault();
      var tr = e.target.closest('tr');
      if (tr) splitAtCaret(+tr.dataset.i, e.target);
    }
  });

  // ---------- 批量智能分行预览 ----------
  function openRewrapModal() {
    if (!state.doc) return;
    commitAllRows();
    var mc = state.settings.maxChars, ml = state.settings.maxLines;
    var plan = C.planRewrap(state.doc.cues, mc, ml);
    state.pendingRewrap = plan;
    var nChange = 0, nFail = 0, nSame = 0;
    rewrapTbody.innerHTML = '';
    var frag = document.createDocumentFragment();
    plan.forEach(function (item, i) {
      var cue = state.doc.cues[i];
      var tr = document.createElement('tr');
      var status, cls;
      if (!item.ok) { nFail++; cls = 'rw-fail'; status = '<span class="st-fail">无法重排</span>'; }
      else if (item.changed) { nChange++; cls = ''; status = '<span class="st-ok">将重排</span>'; }
      else { nSame++; cls = 'rw-same'; status = '<span class="st-skip">已合规</span>'; }
      tr.className = cls;
      var newCell;
      if (item.ok) {
        newCell = '<td class="rt-new">' + esc(item.lines.join('\n')) + '</td>';
      } else {
        newCell = '<td class="rt-err">' + esc(item.error) + '</td>';
      }
      tr.innerHTML =
        '<td class="mono">#' + esc(cue.num) + '</td>' +
        '<td class="rt-old">' + esc(cue.lines.join(' / ')) + '</td>' +
        newCell +
        '<td>' + status + '</td>';
      frag.appendChild(tr);
    });
    rewrapTbody.appendChild(frag);
    rewrapSummary.textContent =
      '规则：每行 ' + mc + ' 字、最多 ' + ml + ' 行；优先在标点或空格处换行，' +
      '不拆 HTML 标签、英文单词与数字串，且不删字。' +
      '将重排 ' + nChange + ' 条，已合规 ' + nSame + ' 条，无法满足 ' + nFail + ' 条。';
    btnRewrapApply.disabled = nChange === 0;
    rewrapModal.classList.remove('hidden');
  }
  function hideRewrap() {
    rewrapModal.classList.add('hidden');
    state.pendingRewrap = null;
  }
  btnRewrapAll.addEventListener('click', openRewrapModal);
  btnRewrapCancel.addEventListener('click', hideRewrap);
  rewrapModal.addEventListener('click', function (e) { if (e.target === rewrapModal) hideRewrap(); });
  btnRewrapApply.addEventListener('click', function () {
    var plan = state.pendingRewrap;
    if (!plan || !state.doc) { hideRewrap(); return; }
    var applied = 0;
    pushUndo('rewrapall');
    plan.forEach(function (item, i) {
      if (item.ok && item.changed) { state.doc.cues[i].lines = item.lines.slice(); applied++; }
    });
    hideRewrap();
    renderList();
    afterChange('已批量智能分行 ' + applied + ' 条（不删字，失败条目保持原样）');
  });

  // ---------- 选择 ----------
  function selectCue(i, opts) {
    opts = opts || {};
    if (!state.doc || i < 0 || i >= state.doc.cues.length) return;
    state.selected = i;
    markSelectedRow();
    updateSnapButtons();
    if (opts.center) centerTimelineOn(state.doc.cues[i]);
    if (opts.scroll && rowEls[i]) rowEls[i].scrollIntoView({ block: 'nearest' });
    drawCanvas();
  }

  // 吸附 / 锚点按钮依赖选中状态
  function updateSnapButtons() {
    var can = !!state.doc && state.selected >= 0;
    btnSnapStart.disabled = !can;
    btnSnapEnd.disabled = !can;
    btnMarkA1.disabled = !can;
    btnMarkA2.disabled = !can;
  }

  // ---------- 分析 ----------
  function analyzeAndRender() {
    if (!state.doc) {
      state.problems = [];
      problemSummary.textContent = '未载入字幕';
      problemList.innerHTML = '';
      return;
    }
    state.problems = C.analyze(state.doc.cues, state.settings)
      .concat(C.analyzeLayout(state.doc.cues, state.settings.maxChars, state.settings.maxLines));
    state.problemByCue = {};
    state.problems.forEach(function (p) {
      (state.problemByCue[p.cue] = state.problemByCue[p.cue] || []).push(p.type);
    });
    // 行标记（节奏问题 + 分行问题）
    rowEls.forEach(function (tr, i) {
      tr.classList.toggle('has-problem', !!state.problemByCue[i]);
      var ta = tr.querySelector('textarea');
      if (ta) {
        var types = state.problemByCue[i] || [];
        ta.classList.toggle('lay-longline', types.indexOf('longline') !== -1);
        ta.classList.toggle('lay-orphan', types.indexOf('orphan') !== -1);
        ta.classList.toggle('lay-toomany', types.indexOf('toomany') !== -1);
        var lay = [];
        if (types.indexOf('longline') !== -1) lay.push('超长行');
        if (types.indexOf('orphan') !== -1) lay.push('孤立标点');
        if (types.indexOf('toomany') !== -1) lay.push('超行数');
        ta.title = lay.length ? '分行问题：' + lay.join('、') : '';
      }
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
      setPlayhead(xToTime(x));
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
      setPlayhead(xToTime(x));
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
      setPlayhead(state.doc.cues[hit.idx].start);
    }
  });

  btnZoomIn.addEventListener('click', function () { zoomAt(1.5, xToTime(cssW / 2)); });
  btnZoomOut.addEventListener('click', function () { zoomAt(1 / 1.5, xToTime(cssW / 2)); });
  btnFit.addEventListener('click', function () { fitAll(); drawCanvas(); });

  // ---------- 播放（有媒体时驱动媒体，否则模拟播放头） ----------
  var rafId = null, lastTs = 0;
  function setPlaying(on) {
    if (on && !state.doc && !hasMedia()) return;
    state.playing = on;
    btnPlay.textContent = on ? '⏸ 暂停' : '▶ 播放';
    if (hasMedia()) {
      if (on) { mediaVideo.play().catch(function () { /* 忽略自动播放限制 */ }); }
      else mediaVideo.pause();
    }
    if (on) {
      lastTs = performance.now();
      rafId = requestAnimationFrame(tick);
    } else if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }
  // 单句循环区间（含前后留白），未开启或无选中时返回 null
  function loopRange() {
    if (!state.loop.on || !state.doc || state.selected < 0) return null;
    var c = state.doc.cues[state.selected];
    return {
      start: Math.max(0, c.start - state.loop.padBefore),
      end: c.end + state.loop.padAfter,
    };
  }
  function tick(ts) {
    if (!state.playing) return;
    var dt = ts - lastTs;
    lastTs = ts;
    var lr = loopRange();
    if (hasMedia()) {
      // 媒体 → 播放头 / 时间轴 / 列表 / 预览
      state.playheadMs = mediaVideo.currentTime * 1000;
      if (lr && state.playheadMs >= lr.end) {
        mediaVideo.currentTime = lr.start / 1000;
        state.playheadMs = lr.start;
      }
    } else {
      // 模拟播放头（倍速同样生效）
      state.playheadMs += dt * state.rate;
      if (lr && state.playheadMs >= lr.end) {
        state.playheadMs = lr.start;
      } else {
        var end = docEnd();
        if (state.playheadMs >= end + 800) {
          state.playheadMs = end + 800;
          setPlaying(false);
        }
      }
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
    if (state.media.ready) {
      mediaClock.textContent = C.fmtShort(state.playheadMs) + ' / ' + C.fmtShort(state.media.duration);
    }
    updateNowCue();
  }
  // 当前字幕预览（媒体条 + 视频叠加层）
  var lastNowCue = null;
  function updateNowCue() {
    var txt = '';
    if (state.doc) {
      var list = state.doc.cues;
      for (var i = 0; i < list.length; i++) {
        if (state.playheadMs >= list[i].start && state.playheadMs < list[i].end) {
          txt = list[i].lines.join(' ');
          break;
        }
      }
    }
    if (txt === lastNowCue) return;
    lastNowCue = txt;
    nowCueText.textContent = txt || (state.doc ? '（播放头处无字幕）' : '');
    nowCueText.classList.toggle('on', !!txt);
    nowCueOverlay.textContent = txt;
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

  // ---------- 媒体载入 / 卸载（仅对象 URL，不上传、不入库） ----------
  var MEDIA_MARK_KEY = 'subcal.media';   // localStorage 标记：刷新后提示重新选择媒体

  btnLoadMedia.addEventListener('click', function () { mediaInput.click(); });
  btnMediaPick.addEventListener('click', function () { mediaInput.click(); });
  mediaInput.addEventListener('change', function () {
    var f = mediaInput.files && mediaInput.files[0];
    mediaInput.value = '';
    if (f) loadMediaFile(f);
  });

  function loadMediaFile(f) {
    if (state.media.pending) URL.revokeObjectURL(state.media.pending.url);
    var url = URL.createObjectURL(f);
    var isVideo = /^video\//.test(f.type) || /\.(mp4|webm|mkv|mov|m4v)$/i.test(f.name);
    state.media.pending = { url: url, name: f.name, isVideo: isVideo };
    mediaVideo.src = url;
    mediaVideo.load();
    setStatus('正在读取媒体《' + f.name + '》…');
  }

  mediaVideo.addEventListener('loadedmetadata', function () {
    var p = state.media.pending;
    if (!p) return;
    if (state.media.url) URL.revokeObjectURL(state.media.url);   // 释放上一个对象 URL
    state.media.url = p.url;
    state.media.name = p.name;
    state.media.isVideo = p.isVideo;
    state.media.duration = (mediaVideo.duration || 0) * 1000;
    state.media.ready = true;
    state.media.pending = null;
    mediaVideo.playbackRate = state.rate;
    mediaBox.classList.remove('hidden');
    mediaVideo.classList.toggle('hidden', !p.isVideo);
    audioBadge.classList.toggle('hidden', p.isVideo);
    audioName.textContent = p.name;
    mediaState.textContent = p.name + ' · ' + (p.isVideo ? '视频' : '音频');
    mediaClock.classList.remove('hidden');
    btnUnloadMedia.classList.remove('hidden');
    hideMediaBanner();
    try { localStorage.setItem(MEDIA_MARK_KEY, JSON.stringify({ name: p.name })); } catch (e) {}
    setPlayhead(0);
    setStatus('已载入媒体《' + p.name + '》（仅本地对象 URL，不上传）。拖动播放头即可联动定位。');
  });

  mediaVideo.addEventListener('error', function () {
    var p = state.media.pending;
    if (!p) return;   // 卸载时清空 src 也会触发 error，忽略
    URL.revokeObjectURL(p.url);
    state.media.pending = null;
    var name = p.name;
    // 若此前已载入媒体，其 src 已被覆盖，一并复位到无媒体状态
    if (state.media.ready || state.media.url) resetMediaState();
    setStatus('无法解码媒体文件《' + name + '》，请换用浏览器支持的格式');
  });

  // 媒体元素自身状态变化 → 同步界面（如右键菜单控制、播放结束）
  mediaVideo.addEventListener('play', function () { if (!state.playing) setPlaying(true); });
  mediaVideo.addEventListener('pause', function () { if (state.playing) setPlaying(false); });
  mediaVideo.addEventListener('ended', function () { if (state.playing) setPlaying(false); });
  mediaVideo.addEventListener('seeked', function () {
    if (!state.media.ready) return;
    state.playheadMs = mediaVideo.currentTime * 1000;
    updatePlayUI();
    highlightActiveRow();
    drawCanvas();
  });

  mediaBox.addEventListener('click', function () {
    if (state.media.ready) setPlaying(!state.playing);
  });

  function resetMediaState() {
    if (state.playing) setPlaying(false);
    if (state.media.pending) {
      URL.revokeObjectURL(state.media.pending.url);
      state.media.pending = null;
    }
    if (state.media.url) URL.revokeObjectURL(state.media.url);
    state.media = { url: null, name: null, isVideo: false, ready: false, duration: 0, pending: null };
    mediaVideo.removeAttribute('src');
    mediaVideo.load();
    mediaBox.classList.add('hidden');
    mediaClock.classList.add('hidden');
    btnUnloadMedia.classList.add('hidden');
    mediaState.textContent = '未载入媒体 · 模拟播放头';
    try { localStorage.removeItem(MEDIA_MARK_KEY); } catch (e) {}
    updatePlayUI();
  }
  btnUnloadMedia.addEventListener('click', function () {
    resetMediaState();
    setStatus('已卸载媒体，回到模拟播放头模式');
  });

  // 刷新后对象 URL 已失效：提示重新选择媒体（字幕编辑状态由草稿恢复）
  function hideMediaBanner() { mediaBanner.classList.add('hidden'); }
  btnMediaDismiss.addEventListener('click', function () {
    try { localStorage.removeItem(MEDIA_MARK_KEY); } catch (e) {}
    hideMediaBanner();
  });
  function checkMediaMark() {
    var mark = null;
    try { mark = JSON.parse(localStorage.getItem(MEDIA_MARK_KEY) || 'null'); } catch (e) {}
    if (mark && mark.name) {
      mediaBannerText.textContent =
        '上次使用的媒体《' + mark.name + '》不会随页面保存，请重新选择媒体文件；字幕修改仍保留在本地草稿中。';
      mediaBanner.classList.remove('hidden');
    }
  }

  // ---------- 倍速 ----------
  mediaRate.addEventListener('change', function () {
    state.rate = parseFloat(mediaRate.value) || 1;
    if (state.media.ready) mediaVideo.playbackRate = state.rate;
    setStatus('播放倍速 ×' + state.rate);
  });

  // ---------- 单句循环（带前后留白） ----------
  loopCueChk.addEventListener('change', function () {
    if (loopCueChk.checked && (!state.doc || state.selected < 0)) {
      loopCueChk.checked = false;
      setStatus('请先选中一条字幕，再开启单句循环');
      return;
    }
    state.loop.on = loopCueChk.checked;
    if (state.loop.on) {
      var lr = loopRange();
      setPlayhead(lr.start);
      setPlaying(true);
      setStatus('单句循环 ' + C.fmtShort(lr.start) + ' ~ ' + C.fmtShort(lr.end) + '（含前后留白）');
    } else {
      setStatus('已关闭单句循环');
    }
  });
  function saveLoopPads() {
    state.loop.padBefore = clamp(+loopPadBefore.value || 0, 0, 5000);
    state.loop.padAfter = clamp(+loopPadAfter.value || 0, 0, 5000);
    loopPadBefore.value = state.loop.padBefore;
    loopPadAfter.value = state.loop.padAfter;
  }
  loopPadBefore.addEventListener('change', saveLoopPads);
  loopPadAfter.addEventListener('change', saveLoopPads);

  // ---------- 吸附：选中字幕的起点/终点 → 当前播放头 ----------
  function snapSelected(field) {
    if (!state.doc || state.selected < 0) return;
    var cue = state.doc.cues[state.selected];
    var t = Math.round(state.playheadMs);
    pushUndo('snap');
    if (field === 'start') cue.start = clamp(t, 0, cue.end - MIN_DUR);
    else cue.end = Math.max(t, cue.start + MIN_DUR);
    fillRowTimes(state.selected);
    afterChange('已将第 ' + cue.num + ' 条' + (field === 'start' ? '起点' : '终点') +
      ' 吸附到播放头 ' + C.fmtMs(t, 'srt'));
  }
  btnSnapStart.addEventListener('click', function () { snapSelected('start'); });
  btnSnapEnd.addEventListener('click', function () { snapSelected('end'); });

  // ---------- 双锚点整体校时 ----------
  function markAnchor(which) {
    if (!state.doc || state.selected < 0) {
      setStatus('请先选中一条字幕，再记录锚点');
      return;
    }
    var cue = state.doc.cues[state.selected];
    var a = {
      cue: state.selected, num: cue.num,
      srcTime: cue.start, dstTime: Math.round(state.playheadMs),
    };
    state.anchors[which] = a;
    updateAnchorButtons();
    setStatus('锚点' + (which === 'a1' ? '①' : '②') + '：第 ' + cue.num + ' 条起点 ' +
      C.fmtMs(a.srcTime, 'srt') + ' ↔ 媒体时间 ' + C.fmtMs(a.dstTime, 'srt'));
  }
  btnMarkA1.addEventListener('click', function () { markAnchor('a1'); });
  btnMarkA2.addEventListener('click', function () { markAnchor('a2'); });

  function updateAnchorButtons() {
    var n = (state.anchors.a1 ? 1 : 0) + (state.anchors.a2 ? 1 : 0);
    btnAnchorSync.disabled = !state.doc;
    btnAnchorSync.textContent = n ? '双锚点校时…（' + n + '/2）' : '双锚点校时…';
  }

  btnAnchorSync.addEventListener('click', function () {
    if (!state.doc) return;
    renderAnchorModal();
    anchorModal.classList.remove('hidden');
  });
  function hideAnchor() {
    anchorModal.classList.add('hidden');
    state.pendingSync = null;
  }
  btnAnchorClose.addEventListener('click', hideAnchor);
  anchorModal.addEventListener('click', function (e) { if (e.target === anchorModal) hideAnchor(); });
  btnClearA1.addEventListener('click', function () {
    state.anchors.a1 = null; updateAnchorButtons(); renderAnchorModal();
  });
  btnClearA2.addEventListener('click', function () {
    state.anchors.a2 = null; updateAnchorButtons(); renderAnchorModal();
  });

  function renderAnchorModal() {
    ['a1', 'a2'].forEach(function (k) {
      var a = state.anchors[k], cells = anchorCells[k];
      cells.cue.textContent = a ? ('#' + a.num) : '—';
      cells.src.textContent = a ? C.fmtMs(a.srcTime, 'srt') : '—';
      cells.dst.textContent = a ? C.fmtMs(a.dstTime, 'srt') : '—';
    });
    anchorFormula.textContent = '';
    anchorError.textContent = '';
    anchorDiffTbody.innerHTML = '';
    state.pendingSync = null;
    btnAnchorApply.disabled = true;
    var a1 = state.anchors.a1, a2 = state.anchors.a2;
    if (!a1 || !a2) {
      anchorError.textContent = '还需记录锚点' + (!a1 ? '①' : '') + (!a2 ? '②' : '') +
        '：选中字幕后，将播放头定位到该句在媒体中的实际位置，再点媒体条上的「记录锚点」按钮。';
      return;
    }
    var res = C.computeAnchorSync(cues(), a1, a2);
    if (res.error) {
      anchorError.textContent = res.error;
      return;
    }
    anchorFormula.textContent = '伸缩 ×' + res.a.toFixed(4) + ' · 偏移 ' +
      (res.b >= 0 ? '+' : '−') + C.fmtMs(Math.abs(res.b), 'srt') +
      ' · 将影响 ' + res.changes.length + ' / ' + cues().length + ' 条字幕';
    if (!res.changes.length) {
      anchorError.textContent = '变换后所有字幕时间不变，无需应用。';
      return;
    }
    var frag = document.createDocumentFragment();
    res.changes.forEach(function (ch) {
      var cue = state.doc.cues[ch.i];
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="mono">#' + esc(ch.num) + '</td>' +
        '<td><span class="old mono">' + C.fmtMs(ch.oldStart, 'srt') + '</span> → <span class="new">' + C.fmtMs(ch.newStart, 'srt') + '</span></td>' +
        '<td><span class="old mono">' + C.fmtMs(ch.oldEnd, 'srt') + '</span> → <span class="new">' + C.fmtMs(ch.newEnd, 'srt') + '</span></td>' +
        '<td class="muted">' + esc(cue.lines.join(' / ')) + '</td>';
      frag.appendChild(tr);
    });
    anchorDiffTbody.appendChild(frag);
    state.pendingSync = res;
    btnAnchorApply.disabled = false;
  }

  btnAnchorApply.addEventListener('click', function () {
    var res = state.pendingSync;
    if (!res || !state.doc) { hideAnchor(); return; }
    pushUndo('anchorsync');
    res.changes.forEach(function (ch) {
      var cue = state.doc.cues[ch.i];
      cue.start = ch.newStart;
      cue.end = ch.newEnd;
    });
    hideAnchor();
    // 时间已整体改写，原锚点失效
    state.anchors.a1 = null;
    state.anchors.a2 = null;
    updateAnchorButtons();
    renderList();
    afterChange('已应用双锚点校时（' + res.changes.length + ' 条）');
  });

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
    if (!anchorModal.classList.contains('hidden')) {
      if (e.key === 'Escape') hideAnchor();
      return;
    }
    if (!rewrapModal.classList.contains('hidden')) {
      if (e.key === 'Escape') hideRewrap();
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
      case ',': snapSelected('start'); break;
      case '.': snapSelected('end'); break;
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
    commitAllRows();
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
    commitAllRows();   // 文本框中尚未失焦的编辑也要入草稿
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
      if (!payload || !Array.isArray(payload.cues) || !payload.cues.length ||
          payload.cues.some(function (c) { return !c || !Array.isArray(c.lines); })) {
        setStatus('草稿内容无法识别，未恢复');
        hideDraftBanner();
        return;
      }
      pushUndo('restore');
      state.doc.cues = payload.cues;
      if (payload.header !== undefined) state.doc.header = payload.header;
      renderList();
      afterChange('已恢复本地草稿（' + payload.cues.length + ' 条）');
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
    // 导出前提交文本框中尚未失焦的编辑
    commitAllRows();
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
    setMaxChars.value = state.settings.maxChars;
    setMaxLines.value = state.settings.maxLines;
  }
  function saveSettings() {
    state.settings.cpsMax = clamp(+setCps.value || 20, 1, 60);
    state.settings.minDurMs = clamp(+setMinDur.value || 1000, 100, 10000);
    state.settings.minGapMs = clamp(+setMinGap.value || 0, 0, 2000);
    state.settings.allowOverlap = setOverlap.checked;
    state.settings.maxChars = clamp(+setMaxChars.value || 18, 2, 120);
    state.settings.maxLines = clamp(+setMaxLines.value || 2, 1, 8);
    localStorage.setItem('subcal.settings', JSON.stringify(state.settings));
    if (state.doc) {
      analyzeAndRender();
      state.doc.cues.forEach(function (_, i) { fillRowTimes(i); });
      drawCanvas();
    }
  }
  [setCps, setMinDur, setMinGap, setOverlap, setMaxChars, setMaxLines].forEach(function (el) {
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
    updateSnapButtons();
    updateAnchorButtons();
    loopPadBefore.value = state.loop.padBefore;
    loopPadAfter.value = state.loop.padAfter;
    resizeCanvas();
    if (window.ResizeObserver) {
      new ResizeObserver(resizeCanvas).observe(timelineWrap);
    } else {
      window.addEventListener('resize', resizeCanvas);
    }
    updatePlayUI();
    checkMediaMark();
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
