/* 字幕节奏校准台 — 浏览器主流程
 * 依赖 static/core.js（window.SubCore）与后端 /api/*。
 */
(function () {
  'use strict';

  var C = window.SubCore;

  // ---------- DOM ----------
  function $(id) { return document.getElementById(id); }
  var btnImport = $('btnImport'), fileInput = $('fileInput'), btnSample = $('btnSample'),
    btnSampleVtt = $('btnSampleVtt');
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
  // 版本对照
  var btnCompareLoad = $('btnCompareLoad'), compareInput = $('compareInput');
  var btnCompareView = $('btnCompareView'), btnCompareClose = $('btnCompareClose');
  var compareBar = $('compareBar'), compareView = $('compareView');
  var compareFileInfo = $('compareFileInfo'), cmpStats = $('cmpStats');
  var cmpFilter = $('cmpFilter'), cmpHighOnly = $('cmpHighOnly');
  var btnBatchMerge = $('btnBatchMerge');
  var cmpTbody = $('cmpTbody');
  var cmpCanvas = $('compareTimeline'), cmpCtx = cmpCanvas.getContext('2d');
  var mergeModal = $('mergeModal'), mergeSummary = $('mergeSummary'), mergeTbody = $('mergeTbody');
  var btnMergeCancel = $('btnMergeCancel'), btnMergeApply = $('btnMergeApply');
  var timelineWrapEl = $('timelineWrap'), cueListWrapEl = $('cueListWrap');
  // 镜头切换检测
  var sceneRange = $('sceneRange'), sceneRangeInputs = $('sceneRangeInputs');
  var sceneFrom = $('sceneFrom'), sceneTo = $('sceneTo');
  var sceneInterval = $('sceneInterval'), sceneSens = $('sceneSens'), sceneSensVal = $('sceneSensVal');
  var sceneTol = $('sceneTol');
  var btnSceneScan = $('btnSceneScan'), btnSceneCancel = $('btnSceneCancel');
  var btnSceneSnapAll = $('btnSceneSnapAll'), btnSceneClear = $('btnSceneClear');
  var sceneProgress = $('sceneProgress'), sceneProgressFill = $('sceneProgressFill');
  var sceneState = $('sceneState');
  var cutModal = $('cutModal'), cutInfo = $('cutInfo'), cutCueInfo = $('cutCueInfo');
  var cutThumbBefore = $('cutThumbBefore'), cutThumbAfter = $('cutThumbAfter');
  var cutTBefore = $('cutTBefore'), cutTAfter = $('cutTAfter'), cutThumbHint = $('cutThumbHint');
  var btnCutSnapStart = $('btnCutSnapStart'), btnCutSnapEnd = $('btnCutSnapEnd'), btnCutClose = $('btnCutClose');
  var cutBatchModal = $('cutBatchModal'), cutBatchSummary = $('cutBatchSummary');
  var cutBatchTbody = $('cutBatchTbody');
  var btnCutBatchCancel = $('btnCutBatchCancel'), btnCutBatchApply = $('btnCutBatchApply');
  var anchorCells = {
    a1: { cue: $('a1Cue'), src: $('a1Src'), dst: $('a1Dst') },
    a2: { cue: $('a2Cue'), src: $('a2Src'), dst: $('a2Dst') },
  };
  // 逐词时间码
  var wordPanel = $('wordPanel'), wordPanelCue = $('wordPanelCue'),
    wordPanelRange = $('wordPanelRange'), wordPanelCount = $('wordPanelCount'),
    wordArmChk = $('wordArmChk'), btnWordClear = $('btnWordClear'),
    wordRulerWrap = $('wordRulerWrap'), wordRuler = $('wordRuler'),
    wordChips = $('wordChips');
  var wordRulerCtx = wordRuler.getContext('2d');
  var wordBoundsModal = $('wordBoundsModal'), wordBoundsCue = $('wordBoundsCue'),
    wbAbsState = $('wbAbsState'), wbScaleState = $('wbScaleState'),
    wbScaleDesc = $('wbScaleDesc'), btnWbAbs = $('btnWbAbs'), btnWbScale = $('btnWbScale'),
    btnWbCancel = $('btnWbCancel'), wbNewHead = $('wbNewHead'),
    wordBoundsDiffBody = document.querySelector('#wordBoundsDiff tbody');

  var ctx = canvas.getContext('2d');

  // ---------- 常量 ----------
  var RULER_H = 28;
  var MIN_PX = 0.002, MAX_PX = 2;       // 每毫秒像素数范围
  var MIN_DUR = 40;                      // 拖动时允许的最小时长 ms
  var EDGE_PX = 6;                       // 边缘拖拽判定宽度
  var TYPE_LABEL = {
    cps: '语速', short: '过短', gap: '间隔', overlap: '重叠', order: '时序',
    longline: '超长行', orphan: '孤立标点', toomany: '超行数',
    'cut-cross': '跨切点', 'cut-near': '近切点', wordtime: '词元时间戳',
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
    // 版本对照（对照文件仅留在浏览器内存，刷新后需重新选择）
    refDoc: null, refName: null,        // {format, header, cues}
    refResult: null,                    // alignDocuments 结果 {entries, stats}
    compareOn: false,                   // 是否显示对照视图
    cmpView: { startMs: 0, pxPerMs: 0.1 },
    cmpFilter: 'diff', cmpHighOnly: false,
    cmpSelected: -1,                    // 当前选中的对照条目
    adopted: {},                        // 已逐项采用的条目：entryIdx → 模式
    pendingMerge: null,                 // 批量合并预览
    // 镜头切换检测（分析数据与缩略图只在内存，卸载媒体 / 刷新即清除）
    scene: {
      cuts: [],                         // [{time, strength(0..1)}]
      thumbs: {},                       // cutIdx → {before, after}（dataURL，仅内存）
      running: false, cancel: false,
      cfg: { range: 'all', from: 0, to: 0, interval: 250, sens: 60, tol: 400 },
    },
    cutDetail: null,                    // {cue, cutIdx} 切点详情弹窗当前条目
    pendingCutSnap: null,               // 批量吸附预览计划
    // WebVTT 逐词时间码
    word: {
      errors: [],                       // analyzeWordTimings 结果（含 cue/行列定位）
      errorByCue: {},
      pendingBounds: null,              // 改 cue 区间时的两方案选择弹窗状态
      editTok: -1,                      // chips 中正在输入时间的 token 下标
    },
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
  // 只有连续的拖拽与键盘微调合并为一步；拆分/合并/分行等结构操作每次独立入栈
  var COALESCE_LABELS = { drag: true, nudge: true };
  function snapshot() { return JSON.stringify(state.doc.cues); }
  function pushUndo(label) {
    if (!state.doc) return;
    var now = Date.now();
    if (label && COALESCE_LABELS[label] &&
      label === lastUndoLabel && now - lastUndoTime < 800) {
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
    syncCompareAfterEdit();
    renderWordPanel();
  }
  function doRedo() {
    if (!state.doc || !state.redoStack.length) return;
    state.undoStack.push(snapshot());
    state.doc.cues = JSON.parse(state.redoStack.pop());
    lastUndoLabel = '';
    renderList();
    afterChange('已重做');
    syncCompareAfterEdit();
    renderWordPanel();
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
    wordPanel.classList.add('hidden');
    wordBoundsModal.classList.add('hidden');
    state.word.pendingBounds = null;
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
    resetCompare(true);
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
    updateSceneButtons();
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
      var cue0 = state.doc.cues[i];
      var ns = field === 'start' ? Math.min(ms, cue0.end - MIN_DUR) : cue0.start;
      var ne = field === 'end' ? Math.max(ms, cue0.start + MIN_DUR) : cue0.end;
      if (!requestBoundsChange(i, ns, ne, { label: 'edit' })) {
        // 存在词元标记：待弹窗选择，输入框先显示目标值，模型未改
        return;
      }
      fillRowTimes(i);
      afterChange('已修改第 ' + cue0.num + ' 条时间');
    } else if (e.target.matches('textarea')) {
      pushUndo('text');
      cue.lines = e.target.value.split(/\r?\n/);
      while (cue.lines.length > 1 && cue.lines[cue.lines.length - 1] === '') cue.lines.pop();
      afterChange('已修改第 ' + cue.num + ' 条文本');
      renderWordPanel();
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

  // 记忆“点击操作按钮前”文本框中的光标：按钮 mousedown 先于文本框 blur，
  // 在捕获阶段记下，点击处理函数即可沿用用户在文本中放置光标的位置。
  var caretBeforeClick = null;   // {i, caret}
  function rowIndexOfTa(el) {
    var tr = el && el.closest ? el.closest('tr') : null;
    return tr ? +tr.dataset.i : -1;
  }
  cueTbody.addEventListener('mousedown', function (e) {
    // 在「拆」按钮上按下时（mousedown 先于文本框 blur），记下当前文本光标
    var btn = e.target.closest && e.target.closest('button.op-split');
    if (!btn) return;
    var tr = e.target.closest('tr');
    var ae = document.activeElement;
    if (tr && ae && ae.matches && ae.matches('textarea') &&
      ae.closest('tr') === tr) {
      caretBeforeClick = { i: +tr.dataset.i, caret: ae.selectionStart };
    }
  }, true);

  // 在第 i 条、其文本框光标 caret 处拆分；点击按钮导致文本框失焦时，
  // 使用 mousedown 前记忆的光标；没有历史光标（如键盘选中后点按钮）才按中点回退
  function splitAtCaret(i, ta) {
    if (!state.doc) return;
    var rowTa = ta || (rowEls[i] && rowEls[i].querySelector('textarea'));
    // 输入后未失焦直接拆分（Ctrl+Enter）：先把文本框当前内容提交到模型
    if (rowTa && document.activeElement === rowTa) commitRow(i);
    var cue = state.doc.cues[i];
    var full = cue.lines.join('\n');
    var caret = null;
    if (rowTa && document.activeElement === rowTa) {
      caret = rowTa.selectionStart;
    } else if (caretBeforeClick && caretBeforeClick.i === i &&
      caretBeforeClick.caret >= 0 && caretBeforeClick.caret <= full.length) {
      caret = caretBeforeClick.caret;
    }
    if (caret === null) caret = pickMiddleCaret(full);
    caretBeforeClick = null;
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
    renderWordPanel();
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
      .concat(C.analyzeLayout(state.doc.cues, state.settings.maxChars, state.settings.maxLines))
      .concat(state.scene.cuts.length
        ? C.analyzeCutConflicts(state.doc.cues, state.scene.cuts, state.scene.cfg.tol)
        : [])
      .concat(C.analyzeWordTimings(state.doc.cues));
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
        if (p.type === 'cut-cross' || p.type === 'cut-near') {
          // 切点问题：展示切点前后缩略图并同步定位媒体
          openCutDetail(p.cue, p.cutIdx);
        } else if (p.type === 'wordtime') {
          // 逐词时间戳错误：展开词元轨道并定位到具体行列
          locateWordError(p);
        } else {
          setStatus('定位到第 ' + cue.num + ' 条');
        }
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
    drawSceneCuts();
    drawPlayhead();
  }

  // 镜头切点叠加层：竖线透明度随变化强度，顶部三角标记
  function drawSceneCuts() {
    if (!state.scene.cuts.length) return;
    state.scene.cuts.forEach(function (cut) {
      var x = timeToX(cut.time);
      if (x < -2 || x > cssW + 2) return;
      var strength = clamp(cut.strength || 0, 0, 1);
      ctx.strokeStyle = 'rgba(94, 234, 212, ' + (0.3 + 0.5 * strength).toFixed(3) + ')';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, RULER_H);
      ctx.lineTo(x, cssH - 4);
      ctx.stroke();
      ctx.fillStyle = 'rgba(94, 234, 212, ' + (0.55 + 0.45 * strength).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(x - 4, RULER_H + 1);
      ctx.lineTo(x + 4, RULER_H + 1);
      ctx.lineTo(x, RULER_H + 7);
      ctx.closePath();
      ctx.fill();
    });
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
      // 整块平移：词元标记随之平移（保持相对节奏），越界则回退并提示
      var tr = C.translateWordTimes(cue, ns - drag.origStart,
        { start: cue.start, end: cue.end });
      if (!tr.error) {
        cue.lines = tr.lines;
        drag.wordTranslated = true;
      } else {
        cue.start = drag.origStart; cue.end = drag.origEnd;
        setStatus('无法继续平移：' + tr.error);
        drag.moved = false;
        return;
      }
    } else if (drag.mode === 'resize-l') {
      cue.start = clamp(drag.origStart + dt, 0, cue.end - MIN_DUR);
    } else if (drag.mode === 'resize-r') {
      cue.end = Math.max(drag.origEnd + dt, cue.start + MIN_DUR);
    }
    fillRowTimes(drag.idx);
    analyzeAndRender();
    drawCanvas();
    refreshWordPanelLive();
  });

  window.addEventListener('mouseup', function () {
    if (!drag) return;
    var wasMoved = drag.moved && drag.undoPushed;
    var d = drag;
    drag = null;
    if (!wasMoved) return;
    var cue = state.doc.cues[d.idx];
    var changedBounds = d.mode !== 'move' &&
      (cue.start !== d.origStart || cue.end !== d.origEnd);
    if (changedBounds && cueHasWordMarks(cue)) {
      // 起止被拖动且含词元标记：弹出两方案选择；取消则整体回退（含撤销栈）
      requestBoundsChange(d.idx, cue.start, cue.end, {
        label: 'drag', alreadyMutated: true,
        orig: { start: d.origStart, end: d.origEnd },
      });
    } else {
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
    updateWordPreview();
    refreshWordPanelLive();
    if (state.compareOn) drawCompareCanvas();
  }
  // 当前字幕预览改由 updateWordPreview() 统一渲染（保留标签并逐词高亮）
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
    // 更换媒体：旧切点与新画面不再对应，连同内存中的缩略图一并清除
    if (state.scene.running) state.scene.cancel = true;
    clearCutData(true);
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
    // 区间检测的默认终点跟随新媒体时长（Infinity 时长留空，检测时解析后再回填）
    if (p.isVideo && isFinite(state.media.duration) && state.media.duration > 0) {
      sceneTo.value = (state.media.duration / 1000).toFixed(1);
    } else if (p.isVideo) {
      sceneTo.value = '';
    }
    updateSceneButtons();
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
    // 卸载媒体：中止进行中的检测，并清除只存在于内存的切点与缩略图
    if (state.scene.running) state.scene.cancel = true;
    clearCutData(true);
    if (scanVideo) {
      scanVideo.removeAttribute('src');
      scanVideo.load();
      scanReadyUrl = null;
    }
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
    updateSceneButtons();
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
    var ns = field === 'start' ? clamp(t, 0, cue.end - MIN_DUR) : cue.start;
    var ne = field === 'end' ? Math.max(t, cue.start + MIN_DUR) : cue.end;
    if (!requestBoundsChange(state.selected, ns, ne, { label: 'snap' })) return;
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
      adaptCueWordsForBatch(cue, ch.oldStart, ch.oldEnd, ch.newStart, ch.newEnd);
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
    var d = dir * step;
    var ns, ne;
    if (mode === 'both') {
      var dur = cue.end - cue.start;
      ns = Math.max(0, cue.start + d);
      ne = ns + dur;
    } else if (mode === 'start') {
      ns = clamp(cue.start + d, 0, cue.end - MIN_DUR);
      ne = cue.end;
    } else {
      ns = cue.start;
      ne = Math.max(cue.end + d, cue.start + MIN_DUR);
    }
    if (ns === cue.start && ne === cue.end) return;
    // 整体平移时词元随之平移（在 requestBoundsChange 内按方案处理）；
    // 起止调整则走“绝对 / 缩放”方案选择
    var moved = mode === 'both';
    if (!requestBoundsChange(state.selected, ns, ne,
      { label: 'nudge', translate: moved })) return;
    fillRowTimes(state.selected);
    afterChange(null);
    setStatus('第 ' + cue.num + ' 条：' + C.fmtMs(cue.start, 'srt') + ' → ' + C.fmtMs(cue.end, 'srt'));
  }

  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    var typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    // 结构变更（拆分/合并/分行）后新文本框仍聚焦：textarea 中的 Ctrl+Z/Y
    // 必须回退结构操作而非浏览器原生文本撤销；时间码输入框保留原生撤销。
    var undoKey = (e.ctrlKey || e.metaKey) &&
      (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y');
    if (undoKey && (tag === 'textarea' || !typing)) {
      e.preventDefault();
      if (e.key.toLowerCase() === 'y' || e.shiftKey) doRedo(); else doUndo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !typing) {
      e.preventDefault(); searchInput.focus(); searchInput.select(); return;
    }
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
    if (!mergeModal.classList.contains('hidden')) {
      if (e.key === 'Escape') hideMergeModal();
      return;
    }
    if (!cutModal.classList.contains('hidden')) {
      if (e.key === 'Escape') hideCutDetail();
      return;
    }
    if (!cutBatchModal.classList.contains('hidden')) {
      if (e.key === 'Escape') hideCutBatch();
      return;
    }
    if (!wordBoundsModal.classList.contains('hidden')) {
      if (e.key === 'Escape') { hideWordBounds(false); setStatus('已取消：区间与词元均未改变'); }
      return;
    }
    var step = e.shiftKey ? 500 : (e.altKey ? 10 : 100);
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
      case 'm': case 'M': markNextAtPlayhead(); break;
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
        // 搜索覆盖逐词时间戳：合法的内联时间戳标签不参与匹配（其余标签按原文检索）
        var hay = c.lines.map(function (l) {
          return l.replace(/<(?:\d{1,3}:)?\d{1,2}:\d{2}[.,]\d{1,3}>/g, '');
        }).join('\n').toLowerCase();
        if (hay.indexOf(q) !== -1) state.searchMatches.push(i);
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
      adaptCueWordsForBatch(cue, ch.oldStart, ch.oldEnd, ch.newStart, ch.newEnd);
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

  btnSampleVtt.addEventListener('click', function () {
    fetch('/api/sample?kind=vtt')
      .then(function (r) { return r.json(); })
      .then(function (data) { loadDocument(data.content, data.filename); })
      .catch(function () { setStatus('无法获取 WebVTT 示例（服务器未响应）'); });
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

  // ============================================================
  // 版本对照合并（对照文件只在浏览器内存，不上传、不入库、刷新重选）
  // ============================================================

  var cmpRowEls = [];
  var cmpCssW = 0, cmpCssH = 0;

  function resetCompare(silent) {
    state.refDoc = null;
    state.refName = null;
    state.refResult = null;
    state.adopted = {};
    state.cmpSelected = -1;
    state.pendingMerge = null;
    state.compareOn = false;
    cmpRowEls = [];
    compareInput.value = '';
    btnCompareView.classList.add('hidden');
    btnCompareView.textContent = '对照合并';
    hideCompareView();
    mergeModal.classList.add('hidden');
    if (!silent) setStatus('已关闭对照：对照文件只在内存中，刷新后需重新选择');
  }

  // ---------- 载入对照文件 ----------
  btnCompareLoad.addEventListener('click', function () {
    if (!state.doc) { setStatus('请先载入或导入当前工作字幕，再选择对照文件'); return; }
    compareInput.click();
  });
  compareInput.addEventListener('change', function () {
    var f = compareInput.files && compareInput.files[0];
    compareInput.value = '';
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      var doc;
      try {
        doc = C.parseSubtitle(String(reader.result || ''));
      } catch (e) {
        setStatus('对照文件解析失败：' + e.message);
        return;
      }
      if (!doc.cues.length) {
        setStatus('未能从对照文件 ' + f.name + ' 解析到任何字幕条目');
        return;
      }
      state.refDoc = doc;
      state.refName = f.name;
      state.adopted = {};
      state.cmpSelected = -1;
      runAlign();
      compareFileInfo.textContent = f.name + ' · ' + doc.format.toUpperCase() + ' · ' + doc.cues.length + ' 条';
      btnCompareView.classList.remove('hidden');
      showCompareView();
      fitCompareAll();
      setStatus('已载入对照《' + f.name + '》（' + doc.cues.length + ' 条，' + doc.format.toUpperCase() +
        '），仅在本地浏览器处理，不上传、不入库');
    };
    reader.onerror = function () { setStatus('读取对照文件失败'); };
    reader.readAsText(f, 'utf-8');
  });

  btnCompareView.addEventListener('click', function () {
    if (state.compareOn) hideCompareView(); else showCompareView();
  });
  btnCompareClose.addEventListener('click', function () {
    state.refDoc = null;
    state.refName = null;
    state.refResult = null;
    state.adopted = {};
    state.cmpSelected = -1;
    btnCompareView.classList.add('hidden');
    hideCompareView();
    setStatus('已关闭对照；当前工作字幕的修改保留。对照文件刷新后需重新选择');
  });

  function showCompareView() {
    if (!state.refDoc) return;
    state.compareOn = true;
    compareBar.classList.remove('hidden');
    compareView.classList.remove('hidden');
    timelineWrapEl.classList.add('hidden');
    cueListWrapEl.classList.add('hidden');
    btnCompareView.textContent = '返回校准台';
    renderCompare();
    resizeCompareCanvas();
  }
  function hideCompareView() {
    state.compareOn = false;
    compareBar.classList.add('hidden');
    compareView.classList.add('hidden');
    timelineWrapEl.classList.remove('hidden');
    cueListWrapEl.classList.remove('hidden');
    btnCompareView.textContent = '对照合并';
    resizeCanvas();
    drawCanvas();
  }

  // ---------- 对齐 ----------
  function runAlign() {
    if (!state.doc || !state.refDoc) { state.refResult = null; return; }
    state.refResult = C.alignDocuments(state.doc.cues, state.refDoc.cues);
  }

  function cmpFilterVal() { return cmpFilter.value || 'all'; }
  cmpFilter.addEventListener('change', function () {
    state.cmpFilter = cmpFilter.value;
    renderCompare();
  });
  cmpHighOnly.addEventListener('change', function () {
    state.cmpHighOnly = cmpHighOnly.checked;
    renderCompare();
  });

  function entryFiltered(e) {
    var f = cmpFilterVal();
    var high = state.cmpHighOnly;
    if (high && e.kind === 'pair' && e.conflict) return true;
    if (high && e.kind !== 'pair') return true;
    if (f === 'all') return false;
    if (f === 'diff') {
      if (e.kind === 'pair') return !(e.textChanged || e.timeChanged || e.alen !== 1 || e.blen !== 1);
      return false;
    }
    if (f === 'conflict') return !(e.kind === 'pair' && e.conflict);
    if (f === 'text') return !(e.kind === 'pair' && e.textChanged);
    if (f === 'time') return !(e.kind === 'pair' && e.timeChanged);
    if (f === 'struct') return !(e.kind === 'pair' && (e.alen !== 1 || e.blen !== 1));
    if (f === 'only') return e.kind === 'pair';
    return false;
  }

  function entryTypeLabel(e) {
    if (e.kind === 'only-a') return { cls: 'kb-only-a', text: '仅当前版' };
    if (e.kind === 'only-b') return { cls: 'kb-only-b', text: '仅对照版' };
    if (e.conflict) return { cls: 'kb-conflict', text: '冲突' };
    if (e.alen !== 1 || e.blen !== 1) return { cls: 'kb-struct', text: e.alen + '↔' + e.blen + ' 结构' };
    if (e.textChanged && e.timeChanged) return { cls: 'kb-both', text: '文字+时间' };
    if (e.textChanged) return { cls: 'kb-text', text: '文字变化' };
    if (e.timeChanged) return { cls: 'kb-time', text: '时间偏移' };
    return { cls: 'kb-same', text: '一致' };
  }

  function fmtShift(d) {
    var sign = d > 0 ? '+' : (d < 0 ? '−' : '±');
    return sign + Math.abs(d) + 'ms';
  }

  // 字符级差异并排渲染（del 仅左、ins 仅右）
  function diffHtml(segs, side) {
    var out = '';
    segs.forEach(function (g) {
      if (g.t === 'eq') out += esc(g.s);
      else if (g.t === 'del' && side === 'a') out += '<span class="del">' + esc(g.s) + '</span>';
      else if (g.t === 'ins' && side === 'b') out += '<span class="ins">' + esc(g.s) + '</span>';
    });
    return out;
  }

  function refCueLines(bj) { return state.refDoc.cues[bj].lines.join('\n'); }
  function curCueLines(ai) { return state.doc.cues[ai].lines.join('\n'); }

  // ---------- 对照条目列表 ----------
  function renderCompare() {
    cmpRowEls = [];
    cmpTbody.innerHTML = '';
    var res = state.refResult;
    if (!res) { cmpStats.textContent = ''; return; }
    var shown = 0;
    var frag = document.createDocumentFragment();
    res.entries.forEach(function (e, idx) {
      if (entryFiltered(e)) return;
      shown++;
      var tr = document.createElement('tr');
      tr.dataset.idx = idx;
      var rowCls = '';
      if (e.conflict) rowCls += ' row-conflict';
      if (e.kind === 'only-a') rowCls += ' row-only-a';
      if (e.kind === 'only-b') rowCls += ' row-only-b';
      if (state.adopted[idx]) rowCls += ' row-adopted';
      if (idx === state.cmpSelected) rowCls += ' selected';
      tr.className = rowCls.trim();
      tr.innerHTML = renderEntryRow(e, idx);
      frag.appendChild(tr);
      cmpRowEls.push({ idx: idx, el: tr });
    });
    cmpTbody.appendChild(frag);
    updateCmpStats(res, shown);
  }

  function updateCmpStats(res, shown) {
    var s = res.stats;
    cmpStats.textContent = '当前版 ' + state.doc.cues.length + ' 条 · 对照版 ' +
      state.refDoc.cues.length + ' 条 · 配对 ' + s.pairs +
      '（仅当前 ' + s.onlyA + ' / 仅对照 ' + s.onlyB + '）· 冲突 ' + s.conflicts +
      ' · 已逐项采用 ' + Object.keys(state.adopted).length + ' · 显示 ' + shown + ' 项';
  }

  function renderEntryRow(e, idx) {
    var badge = entryTypeLabel(e);
    var kindCell = '<span class="cmp-kind-badge ' + badge.cls + '">' + badge.text + '</span>';
    if (e.kind === 'pair' && e.conflict && e.reasons.length) {
      kindCell += '<span class="cmp-conf-note">' + e.reasons.map(esc).join('<br>') + '</span>';
    }
    if (state.adopted[idx]) {
      kindCell += '<span class="cmp-conf-note" style="color:var(--good)">已采用：' +
        ({ text: '文本', time: '时间', full: '整条', group: '整组' }[state.adopted[idx]] || state.adopted[idx]) + '</span>';
    }
    var aTime = '', bTime = '', aText = '', bText = '';
    if (e.kind === 'pair') {
      var ga = spanOf(state.doc.cues, e.ai, e.alen);
      var gb = spanOf(state.refDoc.cues, e.bj, e.blen);
      aTime = groupTimeHtml(state.doc.cues, e.ai, e.alen);
      bTime = groupTimeHtml(state.refDoc.cues, e.bj, e.blen);
      if (e.alen === 1 && e.blen === 1 && e.textChanged) {
        var segs = C.diffSegments(e.aRaw, e.bRaw);
        aText = '<div class="cmp-cell cmp-side-a">' + diffHtml(segs, 'a') + '</div>';
        bText = '<div class="cmp-cell cmp-side-b">' + diffHtml(segs, 'b') + '</div>';
      } else if (e.alen === 1 && e.blen === 1 && !e.textChanged) {
        aText = '<div class="cmp-cell cmp-side-a">' + esc(e.aRaw) + '</div>';
        bText = '<div class="cmp-cell cmp-side-b">' + esc(e.bRaw) + '</div>';
      } else {
        aText = '<div class="cmp-cell cmp-side-a">' + esc(e.aRaw) + '</div>';
        bText = '<div class="cmp-cell cmp-side-b">' + esc(e.bRaw) + '</div>';
      }
      if (e.alen === 1 && e.blen === 1 && e.timeChanged) {
        bTime += '<span class="dt shift">Δ起 ' + fmtShift(e.dStart) + ' Δ止 ' + fmtShift(e.dEnd) + '</span>';
      }
    } else if (e.kind === 'only-a') {
      aTime = groupTimeHtml(state.doc.cues, e.ai, 1);
      aText = '<div class="cmp-cell cmp-side-a">' + esc(curCueLines(e.ai)) + '</div>';
      bText = '<div class="cmp-cell empty cmp-side-b">（对照版无对应条目）</div>';
    } else {
      bTime = groupTimeHtml(state.refDoc.cues, e.bj, 1);
      aText = '<div class="cmp-cell empty cmp-side-a">（当前版无对应条目）</div>';
      bText = '<div class="cmp-cell cmp-side-b">' + esc(refCueLines(e.bj)) + '</div>';
    }
    return '<td class="cmp-kind">' + kindCell + '</td>' +
      '<td class="cmp-time">' + aTime + '</td>' +
      '<td class="cmp-text">' + aText + '</td>' +
      '<td class="cmp-time">' + bTime + '</td>' +
      '<td class="cmp-text">' + bText + '</td>' +
      '<td class="cmp-ops">' + entryOpsHtml(e, idx) + '</td>';
  }

  function spanOf(cues, start, len) {
    var s = cues[start].start, en = cues[start].end;
    for (var k = 1; k < len; k++) {
      s = Math.min(s, cues[start + k].start);
      en = Math.max(en, cues[start + k].end);
    }
    return { start: s, end: en };
  }
  function groupTimeHtml(cues, start, len) {
    var out = '';
    for (var k = 0; k < len; k++) {
      var c = cues[start + k];
      out += '<div>' + C.fmtMs(c.start, 'srt') + '<br>→ ' + C.fmtMs(c.end, 'srt') + '</div>';
    }
    return out;
  }

  function entryOpsHtml(e, idx) {
    var h = '';
    var errs = C.entryActionErrors(state.doc.cues, state.refDoc.cues, e);
    function btn(mode, cls, label, title, disabled, reason) {
      h += '<button class="' + cls + '" data-mode="' + mode + '"' +
        (disabled ? ' disabled title="' + esc(reason || '当前不可用') + '"' : ' title="' + esc(title) + '"') +
        '>' + label + '</button>';
    }
    if (e.kind === 'pair') {
      var structural = e.alen !== 1 || e.blen !== 1;
      if (structural) {
        btn('group', 'op-group', '整组采用', '用对照版的 ' + e.blen + ' 条整体替换当前版的 ' + e.alen +
          ' 条（保留标识 / 设置，校验时间顺序）', !!errs.group, errs.group);
      } else {
        btn('text', 'op-text', '采用文本', '只采用对照文本（时间与标识不变）', !!errs.text, errs.text);
        btn('time', 'op-time', '采用时间', '只采用对照时间（文本与标识不变）', !!errs.time, errs.time);
        btn('full', 'op-full', '整条采用', '文本 + 时间均采用对照版（保留 WebVTT 标识 / 设置）',
          !!errs.full, errs.full);
      }
    } else if (e.kind === 'only-b') {
      btn('insert', 'op-insert', '插入', '把这条对照字幕插入当前时间轴（需落在相邻条目间隙）',
        !!errs.insert, errs.insert);
    } else {
      btn('delete', 'op-del', '删除', '从当前工作字幕删除该条', false);
    }
    return h;
  }

  // 点击条目：定位播放头；点操作按钮：采用
  cmpTbody.addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr');
    if (!tr) return;
    var idx = +tr.dataset.idx;
    var btnEl = ev.target.closest('button[data-mode]');
    if (btnEl) {
      ev.stopPropagation();
      if (!btnEl.disabled) applyEntry(idx, btnEl.dataset.mode);
      return;
    }
    selectEntry(idx, { seek: true, scrollMain: true });
  });

  function entrySeekTime(e) {
    if (e.kind === 'only-b') return state.refDoc.cues[e.bj].start;
    return state.doc.cues[e.ai].start;
  }

  function selectEntry(idx, opts) {
    opts = opts || {};
    state.cmpSelected = idx;
    cmpRowEls.forEach(function (r) { r.el.classList.toggle('selected', r.idx === idx); });
    var e = state.refResult.entries[idx];
    if (opts.seek) {
      var t = entrySeekTime(e);
      setPlayhead(t);
      // 同步主时间轴选中（仅当前版条目可选中）
      if (e.kind !== 'only-b') {
        selectCue(e.ai, { center: false, scroll: false });
      }
    }
    if (opts.scrollMain && state.doc && e.kind !== 'only-b' && rowEls[e.ai]) {
      rowEls[e.ai].scrollIntoView({ block: 'nearest' });
    }
    drawCompareCanvas();
  }

  // ---------- 逐项采用 ----------
  function applyEntry(idx, mode) {
    if (!state.doc || !state.refDoc) return;
    var e = state.refResult.entries[idx];
    var res;
    commitAllRows();
    var cues = state.doc.cues, ref = state.refDoc.cues;
    if (mode === 'text') res = C.adoptText(cues, e.ai, ref[e.bj].lines);
    else if (mode === 'time') res = C.adoptTime(cues, e.ai, ref[e.bj].start, ref[e.bj].end);
    else if (mode === 'full') res = C.adoptFull(cues, e.ai, ref[e.bj], state.doc.format);
    else if (mode === 'group') res = C.replaceGroup(cues, e.ai, e.alen, ref, e.bj, e.blen, state.doc.format);
    else if (mode === 'insert') res = C.insertOnlyB(cues, e.aBefore, ref[e.bj], state.doc.format);
    else if (mode === 'delete') res = C.deleteOnlyA(cues, e.ai, state.doc.format);
    if (!res || res.error) {
      setStatus('无法采用：' + (res && res.error ? res.error : '未知操作'));
      return;
    }
    pushUndo('compare');
    state.doc.cues = res.cues;
    state.anchors.a1 = null; state.anchors.a2 = null;
    updateAnchorButtons();
    renderList();
    afterChange(null);
    // 结构变化后重新对齐，把本次采用标到新对齐结果的对应条目上
    var prevEntry = e, prevMode = mode;
    runAlign();
    state.adopted = recomputeAdopted();
    selectEntryAfterAdoption(prevEntry);   // 内部 renderCompare
    drawCompareCanvas();
    var label = { text: '文本', time: '时间', full: '整条', group: '整组', insert: '插入对照条', delete: '删除仅当前条' }[mode];
    setStatus('已采用对照版' + label + '（撤销可回退，节奏检查 / 草稿 / 导出已同步）');
  }

  // 单项采用后：在新对齐结果中选中对应对照条目
  function selectEntryAfterAdoption(prevEntry) {
    var entries = state.refResult.entries;
    state.cmpSelected = -1;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (prevEntry.kind === 'pair' && e.kind === 'pair' && e.bj === prevEntry.bj) {
        state.cmpSelected = i;
        break;
      }
    }
    renderCompare();
  }

  // ---------- 批量合并预览 ----------
  function defaultActions() {
    var actions = {};
    var res = state.refResult;
    res.entries.forEach(function (e, i) {
      if (entryFiltered(e)) return;
      if (e.kind === 'pair') {
        if (e.conflict) return;                      // 冲突留待手动
        if (!(e.textChanged || e.timeChanged || e.alen !== 1 || e.blen !== 1)) return;
        var done = state.adopted[i];
        if (e.alen !== 1 || e.blen !== 1) {
          // 结构组：已整组采用则跳过
          if (done === 'group') return;
          actions[i] = 'group';
        } else if (done === 'full') {
          return;                                   // 整条已采用
        } else if (done === 'text') {
          if (e.timeChanged) actions[i] = 'time';   // 仅文本已采用 → 批量补时间
        } else if (done === 'time') {
          if (e.textChanged) actions[i] = 'text';   // 仅时间已采用 → 批量补文本
        } else {
          actions[i] = 'full';
        }
      } else if (e.kind === 'only-b') {
        if (state.adopted[i] === 'insert') return;
        actions[i] = 'insert';
      } else if (e.kind === 'only-a') {
        actions[i] = 'delete';
      }
    });
    return actions;
  }

  btnBatchMerge.addEventListener('click', function () {
    if (!state.refResult) return;
    commitAllRows();
    var actions = defaultActions();
    var plan = C.planMerge(state.doc.cues, state.refDoc.cues,
      state.refResult.entries, actions, state.doc.format);
    state.pendingMerge = { actions: actions, plan: plan };
    renderMergeModal();
    mergeModal.classList.remove('hidden');
  });

  var MODE_LABEL = { text: '采用文本', time: '采用时间', full: '整条采用', group: '整组采用', insert: '插入', delete: '删除' };

  function renderMergeModal() {
    var pend = state.pendingMerge;
    var plan = pend.plan, actions = pend.actions;
    mergeTbody.innerHTML = '';
    var frag = document.createDocumentFragment();
    var blockedByIdx = {};
    plan.blocked.forEach(function (b) { blockedByIdx[b.idx] = b; });
    var appliedByIdx = {};
    plan.applied.forEach(function (a) { appliedByIdx[a.idx] = a.mode; });
    plan.applied.forEach(function (a) {
      var e = state.refResult.entries[a.idx];
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><label><input type="checkbox" data-idx="' + a.idx + '" checked> ' +
        '<span class="mr-mode">' + MODE_LABEL[a.mode] + '</span></label></td>' +
        '<td>' + esc(entryTypeLabel(e).text) + '</td>' +
        '<td class="mr-old">' + esc(entrySideText(e, 'a')) + '</td>' +
        '<td class="mr-new">' + esc(entrySideText(e, 'b')) + '</td>' +
        '<td class="muted">将应用</td>';
      frag.appendChild(tr);
    });
    plan.blocked.forEach(function (b) {
      var e = state.refResult.entries[b.idx];
      var tr = document.createElement('tr');
      tr.className = 'mr-blocked';
      tr.innerHTML =
        '<td><label><input type="checkbox" data-idx="' + b.idx + '"> ' +
        '<span class="mr-mode">' + (MODE_LABEL[b.mode] || b.mode) + '</span></label></td>' +
        '<td>' + esc(entryTypeLabel(e).text) + '</td>' +
        '<td class="mr-old">' + esc(entrySideText(e, 'a')) + '</td>' +
        '<td class="mr-new">' + esc(entrySideText(e, 'b')) + '</td>' +
        '<td class="mr-reason">跳过：' + esc(b.reason) + '</td>';
      frag.appendChild(tr);
    });
    mergeTbody.appendChild(frag);
    mergeSummary.textContent = '将应用 ' + plan.applied.length + ' 项，跳过 ' + plan.blocked.length +
      ' 项（冲突项不在批量范围内，需手动处理）。可勾选调整；跳过节拍后后续条目仍按各自校验执行。';
    btnMergeApply.disabled = plan.applied.length === 0;
  }

  function entrySideText(e, side) {
    if (side === 'a') {
      if (e.kind === 'only-b') return '（无）';
      if (e.kind === 'only-a') return curCueLines(e.ai);
      return e.aRaw;
    }
    if (e.kind === 'only-a') return '（删除）';
    if (e.kind === 'only-b') return refCueLines(e.bj);
    return e.bRaw;
  }

  // 复选框切换：从计划中增减，重新用 planMerge 模拟
  mergeTbody.addEventListener('change', function (ev) {
    var cb = ev.target.closest('input[type="checkbox"][data-idx]');
    if (!cb) return;
    var pend = state.pendingMerge;
    var idx = +cb.dataset.idx;
    var baseMode = null;
    pend.plan.applied.forEach(function (a) { if (a.idx === idx) baseMode = a.mode; });
    pend.plan.blocked.forEach(function (b) { if (b.idx === idx) baseMode = b.mode; });
    if (cb.checked) pend.actions[idx] = baseMode;
    else delete pend.actions[idx];
    pend.plan = C.planMerge(state.doc.cues, state.refDoc.cues,
      state.refResult.entries, pend.actions, state.doc.format);
    renderMergeModal();
  });

  function hideMergeModal() {
    mergeModal.classList.add('hidden');
    state.pendingMerge = null;
  }
  btnMergeCancel.addEventListener('click', hideMergeModal);
  mergeModal.addEventListener('click', function (ev) { if (ev.target === mergeModal) hideMergeModal(); });
  btnMergeApply.addEventListener('click', function () {
    var pend = state.pendingMerge;
    if (!pend || !state.doc) { hideMergeModal(); return; }
    var plan = pend.plan;
    if (!plan.applied.length) { hideMergeModal(); return; }
    commitAllRows();
    pushUndo('comparebatch');
    state.doc.cues = plan.cues;
    state.anchors.a1 = null; state.anchors.a2 = null;
    updateAnchorButtons();
    hideMergeModal();
    renderList();
    afterChange(null);
    runAlign();
    state.adopted = recomputeAdopted();
    renderCompare();
    drawCompareCanvas();
    setStatus(plan.blocked.length
      ? '批量合并应用 ' + plan.applied.length + ' 项；' + plan.blocked.length +
        ' 项因时间冲突被跳过，冲突项请手动处理（撤销可整体回退）'
      : '已批量合并 ' + plan.applied.length + ' 项（冲突未自动处理；时间顺序与 cue 标识已校验，撤销可回退）');
  });

  // ---------- 双层时间轴 ----------
  function cmpTimeToX(t) { return (t - state.cmpView.startMs) * state.cmpView.pxPerMs; }
  function cmpXToTime(x) { return state.cmpView.startMs + x / state.cmpView.pxPerMs; }
  function cmpDocEnd() {
    var e = docEnd();
    if (state.refDoc) state.refDoc.cues.forEach(function (c) { if (c.end > e) e = c.end; });
    return e;
  }
  function fitCompareAll() {
    var end = cmpDocEnd();
    var w = cmpCanvas.clientWidth || 800;
    var pad = Math.max(end * 0.04, 500);
    var span = end + pad * 2 || 10000;
    state.cmpView.pxPerMs = clamp(w / span, MIN_PX, MAX_PX);
    state.cmpView.startMs = -pad;
    drawCompareCanvas();
  }
  function resizeCompareCanvas() {
    var dpr = window.devicePixelRatio || 1;
    cmpCssW = cmpCanvas.clientWidth; cmpCssH = cmpCanvas.clientHeight;
    cmpCanvas.width = Math.round(cmpCssW * dpr);
    cmpCanvas.height = Math.round(cmpCssH * dpr);
    cmpCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawCompareCanvas();
  }

  var CMP_RULER_H = 22;
  function drawCompareCanvas() {
    if (!cmpCssW || !state.refDoc || !state.refResult || !state.doc) return;
    // 对齐结果可能引用了切换文档前的旧索引：整体越界时不绘制（载入新文档会重算）
    var stale = state.refResult.entries.some(function (e) {
      if (e.kind === 'pair') return e.ai + e.alen > state.doc.cues.length ||
        e.bj + e.blen > state.refDoc.cues.length;
      if (e.kind === 'only-a') return e.ai >= state.doc.cues.length;
      return e.bj >= state.refDoc.cues.length;
    });
    if (stale) return;
    cmpCtx.clearRect(0, 0, cmpCssW, cmpCssH);
    // 背景与轨道
    cmpCtx.fillStyle = '#161d2e';
    cmpCtx.fillRect(0, 0, cmpCssW, CMP_RULER_H);
    var trackH = (cmpCssH - CMP_RULER_H - 8) / 2;
    var ay = CMP_RULER_H + 4, by = ay + trackH + 4;
    cmpCtx.fillStyle = '#111a2b';
    cmpCtx.fillRect(0, ay, cmpCssW, trackH);
    cmpCtx.fillRect(0, by, cmpCssW, trackH);
    cmpCtx.fillStyle = '#8595b6';
    cmpCtx.font = '10px ' + getComputedStyle(document.body).fontFamily;
    cmpCtx.textBaseline = 'top';
    cmpCtx.fillText('当前', 6, ay + 3);
    cmpCtx.fillStyle = '#7fd6b0';
    cmpCtx.fillText('对照', 6, by + 3);
    drawCmpRuler();
    var res = state.refResult;
    // 配对连线（细）
    cmpCtx.lineWidth = 1;
    res.entries.forEach(function (e) {
      if (e.kind !== 'pair') return;
      var ga = spanOf(state.doc.cues, e.ai, e.alen);
      var gb = spanOf(state.refDoc.cues, e.bj, e.blen);
      var x1 = cmpTimeToX((ga.start + ga.end) / 2);
      var x2 = cmpTimeToX((gb.start + gb.end) / 2);
      cmpCtx.strokeStyle = e.conflict ? 'rgba(248,113,113,0.55)' : 'rgba(133,149,182,0.35)';
      cmpCtx.beginPath();
      cmpCtx.moveTo(x1, ay + trackH - 1);
      cmpCtx.lineTo(x2, by + 1);
      cmpCtx.stroke();
    });
    // 当前轨色块
    state.doc.cues.forEach(function (c, i) {
      drawCmpBlock(c, ay, trackH, '#2a3d66', '#4a5b85', i === state.selected);
    });
    // 对照轨色块（冲突对红框）
    var conflictB = {};
    res.entries.forEach(function (e) {
      if (e.kind === 'pair' && e.conflict) {
        for (var k = 0; k < e.blen; k++) conflictB[e.bj + k] = true;
      }
    });
    state.refDoc.cues.forEach(function (c, i) {
      drawCmpBlock(c, by, trackH, conflictB[i] ? '#5c2a2a' : '#1f5240',
        conflictB[i] ? '#f87171' : '#3a8f6f', false);
    });
    // 播放头（贯通双层）
    var px = cmpTimeToX(state.playheadMs);
    if (px >= -10 && px <= cmpCssW + 10) {
      cmpCtx.strokeStyle = '#f87171';
      cmpCtx.lineWidth = 1.5;
      cmpCtx.beginPath();
      cmpCtx.moveTo(px, 0);
      cmpCtx.lineTo(px, cmpCssH);
      cmpCtx.stroke();
    }
  }

  function drawCmpRuler() {
    var step = pickCmpStep();
    var start = state.cmpView.startMs, end = cmpXToTime(cmpCssW);
    cmpCtx.font = '10px ' + getComputedStyle(document.body).fontFamily;
    cmpCtx.textBaseline = 'top';
    for (var t = Math.ceil(start / step) * step; t <= end; t += step) {
      var x = Math.round(cmpTimeToX(t)) + 0.5;
      cmpCtx.strokeStyle = '#3a4a6e';
      cmpCtx.beginPath();
      cmpCtx.moveTo(x, CMP_RULER_H - 7);
      cmpCtx.lineTo(x, CMP_RULER_H);
      cmpCtx.stroke();
      cmpCtx.fillStyle = '#8595b6';
      cmpCtx.fillText(C.fmtShort(t), x + 3, 4);
    }
  }
  function pickCmpStep() {
    for (var i = 0; i < TICK_STEPS.length; i++) {
      if (TICK_STEPS[i] * state.cmpView.pxPerMs >= 80) return TICK_STEPS[i];
    }
    return TICK_STEPS[TICK_STEPS.length - 1];
  }

  function drawCmpBlock(c, y, h, fill, stroke, selected) {
    var x1 = cmpTimeToX(c.start), x2 = cmpTimeToX(c.end);
    if (x2 < -20 || x1 > cmpCssW + 20) return;
    if (x2 - x1 < 2) x2 = x1 + 2;
    cmpCtx.fillStyle = fill;
    roundRectCtx(cmpCtx, x1, y + 2, x2 - x1, h - 4, 3);
    cmpCtx.fill();
    cmpCtx.lineWidth = selected ? 2 : 1;
    cmpCtx.strokeStyle = selected ? '#9fc0ff' : stroke;
    roundRectCtx(cmpCtx, x1 + 0.5, y + 2.5, x2 - x1 - 1, h - 5, 3);
    cmpCtx.stroke();
    cmpCtx.save();
    cmpCtx.beginPath();
    cmpCtx.rect(x1 + 3, y, Math.max(0, x2 - x1 - 6), h);
    cmpCtx.clip();
    cmpCtx.fillStyle = '#c4d2ee';
    cmpCtx.font = '10px ' + getComputedStyle(document.body).fontFamily;
    cmpCtx.textBaseline = 'middle';
    cmpCtx.fillText('#' + c.num + ' ' + c.lines.join(' '), x1 + 4, y + h / 2 + 1);
    cmpCtx.restore();
  }
  function roundRectCtx(ctx2, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx2.beginPath();
    ctx2.moveTo(x + r, y);
    ctx2.arcTo(x + w, y, x + w, y + h, r);
    ctx2.arcTo(x + w, y + h, x, y + h, r);
    ctx2.arcTo(x, y + h, x, y, r);
    ctx2.arcTo(x, y, x + w, y, r);
    ctx2.closePath();
  }

  // 双层时间轴交互：点色块定位，点空白平移，滚轮缩放
  var cmpDrag = null;
  function cmpHitTest(x, y) {
    var trackH = (cmpCssH - CMP_RULER_H - 8) / 2;
    var ay = CMP_RULER_H + 4, by = ay + trackH + 4;
    var t = cmpXToTime(x);
    function hit(cues) {
      for (var i = 0; i < cues.length; i++) {
        var x1 = cmpTimeToX(cues[i].start), x2 = cmpTimeToX(cues[i].end);
        if (x >= x1 - 2 && x <= x2 + 2) return i;
      }
      return -1;
    }
    if (y >= ay && y <= ay + trackH) return { track: 'a', i: hit(state.doc.cues) };
    if (y >= by && y <= by + trackH) return { track: 'b', i: hit(state.refDoc.cues) };
    return null;
  }
  cmpCanvas.addEventListener('mousedown', function (ev) {
    if (ev.button !== 0 || !state.refResult) return;
    var rect = cmpCanvas.getBoundingClientRect();
    var x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    if (y < CMP_RULER_H) {
      cmpDrag = { mode: 'scrub', startX: x };
      setPlayhead(cmpXToTime(x));
      drawCompareCanvas();
      return;
    }
    var h = cmpHitTest(x, y);
    if (h && h.i >= 0) {
      cmpDrag = { mode: 'hit', hit: h };
    } else {
      cmpDrag = { mode: 'pan', startX: x, viewStart: state.cmpView.startMs };
    }
  });
  window.addEventListener('mousemove', function (ev) {
    if (!cmpDrag || !state.compareOn) return;
    var rect = cmpCanvas.getBoundingClientRect();
    var x = ev.clientX - rect.left;
    if (cmpDrag.mode === 'scrub') {
      setPlayhead(cmpXToTime(x));
      drawCompareCanvas();
    } else if (cmpDrag.mode === 'pan') {
      state.cmpView.startMs = cmpDrag.viewStart - (x - cmpDrag.startX) / state.cmpView.pxPerMs;
      drawCompareCanvas();
    }
  });
  window.addEventListener('mouseup', function (ev) {
    if (!cmpDrag || !state.compareOn) { cmpDrag = null; return; }
    if (cmpDrag.mode === 'hit') {
      var h = cmpDrag.hit;
      var c = h.track === 'a' ? state.doc.cues[h.i] : state.refDoc.cues[h.i];
      setPlayhead(c.start);
      if (h.track === 'a') selectCue(h.i, { center: false, scroll: false });
      // 找到包含该 cue 的对照条目并滚动到
      var idx = entryIdxOfCue(h.track, h.i);
      if (idx >= 0) {
        state.cmpSelected = idx;
        renderCompare();
        var row = cmpRowEls.find(function (r) { return r.idx === idx; });
        if (row) row.el.scrollIntoView({ block: 'nearest' });
      }
      drawCompareCanvas();
    }
    cmpDrag = null;
  });
  cmpCanvas.addEventListener('wheel', function (ev) {
    if (!state.compareOn) return;
    ev.preventDefault();
    var rect = cmpCanvas.getBoundingClientRect();
    var x = ev.clientX - rect.left;
    if (ev.shiftKey || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {
      state.cmpView.startMs += (ev.deltaX || ev.deltaY) / state.cmpView.pxPerMs;
      drawCompareCanvas();
    } else {
      var np = clamp(state.cmpView.pxPerMs * Math.pow(1.0015, -ev.deltaY), MIN_PX, MAX_PX);
      var anchor = cmpXToTime(x);
      var real = np / state.cmpView.pxPerMs;
      state.cmpView.startMs = anchor - (anchor - state.cmpView.startMs) / real;
      state.cmpView.pxPerMs = np;
      drawCompareCanvas();
    }
  }, { passive: false });

  function entryIdxOfCue(track, i) {
    var entries = state.refResult.entries;
    for (var k = 0; k < entries.length; k++) {
      var e = entries[k];
      if (track === 'a' && e.kind !== 'only-b' && i >= e.ai && i < e.ai + (e.alen || 1)) return k;
      if (track === 'b' && e.kind !== 'only-a' && i >= e.bj && i < e.bj + (e.blen || 1)) return k;
    }
    return -1;
  }

  // 播放头变化时双层时间轴同步重绘（updatePlayUI 内调用 syncComparePlayhead）

  // 撤销 / 重做 / 外部编辑后：重新对齐，并按“当前内容是否真的等于对照版”
  // 重算已采用标记（不能直接迁移旧标记，否则撤销后仍显示已采用、批量也会漏项）。
  function syncCompareAfterEdit() {
    if (!state.refDoc) return;
    runAlign();
    state.adopted = recomputeAdopted();
    renderCompare();
    drawCompareCanvas();
  }

  function recomputeAdopted() {
    var out = {};
    if (!state.refResult) return out;
    var cur = state.doc.cues, ref = state.refDoc.cues;
    function norm(lines) { return C.normalizeText(lines.join(' ')); }
    state.refResult.entries.forEach(function (e, i) {
      if (e.kind === 'pair') {
        if (e.ai + e.alen > cur.length) return;
        var aText = norm(cur.slice(e.ai, e.ai + e.alen).flatMap(function (c) { return c.lines; }));
        var bText = norm(ref.slice(e.bj, e.bj + e.blen).flatMap(function (c) { return c.lines; }));
        var textMatch = aText === bText;
        var ga = spanOf(cur, e.ai, e.alen), gb = spanOf(ref, e.bj, e.blen);
        var timeMatch = ga.start === gb.start && ga.end === gb.end;
        var structural = e.alen !== 1 || e.blen !== 1;
        if (structural) {
          // 结构组：只有当前侧条数、各条时间与文本都已等于对照版，才算整组采用；
          // 不能只看合并文本（1↔2 的两侧合起来文本天然相同）。
          var sameShape = e.alen === e.blen &&
            e.alen === countOverlapping(cur, ga) && e.blen === countOverlapping(ref, gb);
          if (sameShape) {
            var perLine = true;
            for (var k = 0; k < e.alen; k++) {
              if (cur[e.ai + k].start !== ref[e.bj + k].start ||
                  cur[e.ai + k].end !== ref[e.bj + k].end ||
                  norm(cur[e.ai + k].lines) !== norm(ref[e.bj + k].lines)) {
                perLine = false; break;
              }
            }
            if (perLine) out[i] = 'group';
          }
          return;
        }
        if (textMatch && timeMatch) out[i] = 'full';
        else if (textMatch) out[i] = 'text';
        else if (timeMatch) out[i] = 'time';
      } else if (e.kind === 'only-b') {
        var r = ref[e.bj];
        var hit = cur.some(function (c) {
          return c.start === r.start && c.end === r.end && norm(c.lines) === norm(r.lines);
        });
        if (hit) out[i] = 'insert';
      }
      // only-a 删除状态无法可靠回推，保持无标记
    });
    return out;
  }

  // 与区间 [s,e] 时间上重叠（非零）的 cue 数量，用于结构组形状校验
  function countOverlapping(list, span) {
    var n = 0;
    list.forEach(function (c) {
      if (c.start < span.end && c.end > span.start) n++;
    });
    return n;
  }

  // ============================================================
  // 镜头切换辅助校时
  // 取帧在独立的隐藏 <video> 元素上进行（与播放互不影响）；
  // 切点数据与缩略图只保存在内存，卸载媒体或刷新页面即清除。
  // ============================================================

  var SCENE_CFG_KEY = 'subcal.scenecfg';
  var scanVideo = null, scanCanvas = null, scanCtx = null, scanReadyUrl = null;

  // ---------- 配置 ----------
  function loadSceneCfg() {
    try {
      var saved = JSON.parse(localStorage.getItem(SCENE_CFG_KEY) || '{}');
      ['range', 'interval', 'sens', 'tol'].forEach(function (k) {
        if (saved[k] !== undefined) state.scene.cfg[k] = saved[k];
      });
    } catch (e) { /* 忽略损坏的配置 */ }
    var cfg = state.scene.cfg;
    sceneRange.value = cfg.range;
    sceneInterval.value = cfg.interval;
    sceneSens.value = cfg.sens;
    sceneSensVal.textContent = cfg.sens;
    sceneTol.value = cfg.tol;
    sceneRangeInputs.classList.toggle('hidden', cfg.range !== 'part');
  }
  function readSceneCfg() {
    var cfg = state.scene.cfg;
    cfg.range = sceneRange.value === 'part' ? 'part' : 'all';
    cfg.interval = clamp(Math.round(+sceneInterval.value || 250), 40, 2000);
    cfg.sens = clamp(Math.round(+sceneSens.value || 60), 1, 100);
    cfg.tol = clamp(Math.round(+sceneTol.value || 0), 0, 2000);
    cfg.from = Math.max(0, +sceneFrom.value || 0);
    cfg.to = Math.max(0, +sceneTo.value || 0);
    sceneInterval.value = cfg.interval;
    sceneSens.value = cfg.sens;
    sceneSensVal.textContent = cfg.sens;
    sceneTol.value = cfg.tol;
    try {
      localStorage.setItem(SCENE_CFG_KEY, JSON.stringify({
        range: cfg.range, interval: cfg.interval, sens: cfg.sens, tol: cfg.tol,
      }));
    } catch (e) {}
  }
  sceneRange.addEventListener('change', function () {
    sceneRangeInputs.classList.toggle('hidden', sceneRange.value !== 'part');
    readSceneCfg();
  });
  [sceneInterval, sceneSens, sceneTol, sceneFrom, sceneTo].forEach(function (el) {
    el.addEventListener('change', function () {
      readSceneCfg();
      if (el === sceneTol) { analyzeAndRender(); updateSceneButtons(); }
    });
  });
  sceneSens.addEventListener('input', function () { sceneSensVal.textContent = sceneSens.value; });

  // 灵敏度 1..100 → 判定阈值 0.56..0.06（越高越灵敏，候选越多）
  function sensToThreshold(sens) {
    return 0.58 - clamp(sens, 1, 100) / 100 * 0.52;
  }

  // ---------- 按钮与状态 ----------
  function updateSceneButtons() {
    var hasVideo = state.media.ready && state.media.isVideo;
    btnSceneScan.disabled = !hasVideo || state.scene.running;
    btnSceneCancel.classList.toggle('hidden', !state.scene.running);
    btnSceneSnapAll.disabled = !state.scene.cuts.length || !state.doc || state.scene.running;
    btnSceneClear.classList.toggle('hidden', !state.scene.cuts.length);
    if (state.scene.running) return;   // 运行中由进度函数更新文案
    if (state.scene.cuts.length) {
      sceneState.textContent = state.scene.cuts.length + ' 个切点 · 容差 ' +
        state.scene.cfg.tol + 'ms（仅内存，卸载媒体即清除）';
    } else if (state.media.ready && !state.media.isVideo) {
      sceneState.textContent = '当前媒体为音频，无画面可供检测';
    } else if (!state.media.ready) {
      sceneState.textContent = '载入视频后可检测镜头切换';
    } else {
      sceneState.textContent = '未检测';
    }
  }
  function setSceneProgress(frac, text) {
    sceneProgressFill.style.width = Math.round(clamp(frac, 0, 1) * 100) + '%';
    if (text) sceneState.textContent = text;
  }
  function sceneProgressShow(on) {
    sceneProgress.classList.toggle('hidden', !on);
    if (!on) sceneProgressFill.style.width = '0';
  }

  // ---------- 取帧（独立 video 元素，不影响播放与编辑） ----------
  function ensureScanVideo() {
    return new Promise(function (resolve, reject) {
      if (!state.media.ready || !state.media.url) {
        reject(new Error('未载入媒体，无法取帧'));
        return;
      }
      if (scanVideo && scanReadyUrl === state.media.url) { resolve(); return; }
      if (!scanVideo) {
        scanVideo = document.createElement('video');
        scanVideo.muted = true;
        scanVideo.preload = 'auto';
        scanCanvas = document.createElement('canvas');
        scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });
      }
      var settled = false;
      var timer = setTimeout(function () {
        finish(new Error('读取视频元数据超时（文件可能损坏或编码不受支持）'));
      }, 8000);
      function onMeta() {
        if (!scanVideo.videoWidth) {
          finish(new Error('该媒体不包含视频画面（可能是纯音频），无法进行镜头检测'));
          return;
        }
        scanReadyUrl = state.media.url;
        finish(null);
      }
      function onErr() {
        var code = scanVideo.error && scanVideo.error.code;
        var why = ({ 1: '读取被中止', 2: '网络错误',
          3: '解码失败（编码不受支持或文件损坏）', 4: '格式或编码不受支持' })[code] || '未知错误';
        finish(new Error('视频解码失败：' + why));
      }
      function finish(err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        scanVideo.removeEventListener('loadedmetadata', onMeta);
        scanVideo.removeEventListener('error', onErr);
        if (err) reject(err); else resolve();
      }
      scanVideo.addEventListener('loadedmetadata', onMeta);
      scanVideo.addEventListener('error', onErr);
      scanVideo.removeAttribute('src');
      scanVideo.src = state.media.url;
      scanVideo.load();
    });
  }

  // 取得有限的视频总时长（ms）。本地 WebM（如 MediaRecorder 录制）常上报
  // Infinity：在取帧专用 video 上定位到极大时间，浏览器落到真实末尾后会
  // 更新 duration；仍无法取得时 reject 并说明原因，避免无界扫描。
  function resolveScanDuration() {
    return new Promise(function (resolve, reject) {
      if (isFinite(state.media.duration) && state.media.duration > 0) {
        resolve(Math.round(state.media.duration));
        return;
      }
      if (!scanVideo || scanReadyUrl !== state.media.url) {
        reject(new Error('取帧器未就绪，无法确定视频时长'));
        return;
      }
      var settled = false;
      var timer = setTimeout(function () {
        finish(new Error('视频缺少时长元数据，且定位末尾超时（8s），无法确定总时长；' +
          '请换用封装完整的文件，或改用「选定区间」并填写明确的起止秒数'));
      }, 8000);
      function onUpdate() {
        var d = scanVideo.duration;
        if (isFinite(d) && d > 0) finish(null, Math.round(d * 1000));
      }
      function onSeeked() {
        // 定位到末尾后 duration 可能稍后才更新：先检查一次，仍未知则等 durationchange
        onUpdate();
      }
      function onErr() { finish(new Error('确定视频时长时解码出错')); }
      function finish(err, ms) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        scanVideo.removeEventListener('seeked', onSeeked);
        scanVideo.removeEventListener('durationchange', onUpdate);
        scanVideo.removeEventListener('error', onErr);
        if (err) reject(err); else resolve(ms);
      }
      scanVideo.addEventListener('seeked', onSeeked);
      scanVideo.addEventListener('durationchange', onUpdate);
      scanVideo.addEventListener('error', onErr);
      try {
        scanVideo.currentTime = Number.MAX_SAFE_INTEGER / 1000;   // 落到真实末尾
      } catch (e) {
        finish(new Error('无法定位视频末尾：' + (e && e.message ? e.message : e)));
      }
    });
  }

  // 在 tMs 处取一帧并缩放到指定宽度，返回 ImageData；失败时说明原因
  function grabFrameAt(tMs, width) {
    return new Promise(function (resolve, reject) {
      if (!scanVideo || scanReadyUrl !== state.media.url) {
        reject(new Error('取帧器未就绪（媒体可能已卸载）'));
        return;
      }
      var settled = false;
      var timer = setTimeout(function () {
        finish(new Error('在 ' + C.fmtShort(tMs) + ' 处取帧超时（解码缓慢或文件已不可用）'));
      }, 6000);
      function onSeek() {
        try {
          var vw = scanVideo.videoWidth, vh = scanVideo.videoHeight;
          if (!vw || !vh) { finish(new Error('无法读取视频画面尺寸（可能为纯音频）')); return; }
          var w = width || 160;
          var h = Math.max(2, Math.round(w * vh / vw));
          if (scanCanvas.width !== w) scanCanvas.width = w;
          if (scanCanvas.height !== h) scanCanvas.height = h;
          scanCtx.drawImage(scanVideo, 0, 0, w, h);
          finish(null, scanCtx.getImageData(0, 0, w, h));
        } catch (e) {
          finish(new Error('画面读取失败：' + (e && e.message ? e.message : e)));
        }
      }
      function onErr() { finish(new Error('取帧过程中视频解码出错')); }
      function finish(err, img) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        scanVideo.removeEventListener('seeked', onSeek);
        scanVideo.removeEventListener('error', onErr);
        if (err) reject(err); else resolve(img);
      }
      scanVideo.addEventListener('seeked', onSeek);
      scanVideo.addEventListener('error', onErr);
      try {
        scanVideo.currentTime = Math.max(0, tMs / 1000);
      } catch (e) {
        finish(new Error('无法定位到 ' + C.fmtShort(tMs) + '：' + (e && e.message ? e.message : e)));
      }
    });
  }

  function imgToDataURL(img) {
    var c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d').putImageData(img, 0, 0);
    return c.toDataURL('image/jpeg', 0.7);
  }

  // ---------- 检测主流程（粗扫 → 候选区间细化，可取消） ----------
  async function runSceneScan() {
    if (state.scene.running) return;
    if (!state.media.ready) { setStatus('请先载入本地视频，再进行镜头检测'); return; }
    if (!state.media.isVideo) { setStatus('当前媒体是音频，没有画面可供镜头检测'); return; }
    readSceneCfg();
    var cfg = state.scene.cfg;
    // 时长已知时先校验区间；未知（部分 WebM 上报 Infinity）则待解析出真实时长后再校验
    if (cfg.range === 'part' && isFinite(state.media.duration) && state.media.duration > 0) {
      var d0 = Math.round(state.media.duration);
      var f0 = clamp(Math.round(cfg.from * 1000), 0, d0);
      var t0 = cfg.to > 0 ? clamp(Math.round(cfg.to * 1000), 0, d0) : d0;
      if (t0 - f0 < cfg.interval * 2) {
        setStatus('选定区间过短（' + C.fmtShort(f0) + ' ~ ' + C.fmtShort(t0) +
          '），需至少覆盖 2 个采样间隔');
        return;
      }
    }
    state.scene.running = true;
    state.scene.cancel = false;
    clearCutData(true);
    updateSceneButtons();
    sceneProgressShow(true);
    try {
      setSceneProgress(0.02, '正在准备视频解码…');
      await ensureScanVideo();
      // 整段分析必须先取得有限时长，避免 Infinity 导致无界扫描
      var durMs;
      if (isFinite(state.media.duration) && state.media.duration > 0) {
        durMs = Math.round(state.media.duration);
      } else {
        setSceneProgress(0.04, '视频缺少时长元数据，正在定位末尾确定时长…');
        durMs = await resolveScanDuration();
        state.media.duration = durMs;   // 媒体时钟同步显示真实总时长
        updatePlayUI();
        if (!(+sceneTo.value > 0)) sceneTo.value = (durMs / 1000).toFixed(1);
      }
      var fromMs = 0, toMs = durMs;
      if (cfg.range === 'part') {
        fromMs = clamp(Math.round(cfg.from * 1000), 0, durMs);
        toMs = cfg.to > 0 ? clamp(Math.round(cfg.to * 1000), 0, durMs) : durMs;
        if (toMs - fromMs < cfg.interval * 2) {
          throw new Error('选定区间过短（' + C.fmtShort(fromMs) + ' ~ ' + C.fmtShort(toMs) +
            '），需至少覆盖 2 个采样间隔');
        }
      }
      var threshold = sensToThreshold(cfg.sens);
      // —— 第一遍：按采样间隔粗扫，比较相邻帧亮度与色彩直方图 ——
      var samples = [];
      var total = Math.max(1, Math.floor((toMs - fromMs) / cfg.interval) + 1);
      var n = 0;
      for (var t = fromMs; t <= toMs + 1; t += cfg.interval) {
        if (state.scene.cancel) throw { cancelled: true };
        var ts = Math.min(t, durMs - 1);
        var img = await grabFrameAt(ts, 160);
        samples.push({ t: t, metrics: C.frameMetrics(img.data, 8) });
        n++;
        if (n % 3 === 0 || n >= total) {
          setSceneProgress(0.05 + 0.55 * Math.min(1, n / total),
            '粗扫 ' + n + '/' + total + ' 帧（可取消，播放与编辑不受影响）');
        }
      }
      if (samples.length < 2) throw new Error('区间内有效采样不足 2 帧，无法比较相邻帧');
      var cands = C.findCutCandidates(samples, threshold, Math.max(2 * cfg.interval, 300));
      // —— 第二遍：在每个候选区间内加密采样，细化切点位置 ——
      var cuts = [];
      for (var ci = 0; ci < cands.length; ci++) {
        if (state.scene.cancel) throw { cancelled: true };
        var c = cands[ci];
        var lo = samples[c.i - 1].t, hi = c.t;
        var step = Math.max(33, Math.round((hi - lo) / 8));
        var fine = [];
        for (var ft = lo; ft < hi; ft += step) {
          var fimg = await grabFrameAt(Math.min(ft, durMs - 1), 160);
          fine.push({ t: Math.round(ft), metrics: C.frameMetrics(fimg.data, 8) });
        }
        // 必须覆盖候选边界后的那一帧（切点位于 (lo, hi] 内）：
        // 若步进取整漏掉 hi，细样本会全是切前帧，相邻差异全零，
        // 零差异样本会被误当作切点，位置与强度都不对
        if (!fine.length || fine[fine.length - 1].t < hi) {
          var himg = await grabFrameAt(Math.min(hi, durMs - 1), 160);
          fine.push({ t: Math.round(hi), metrics: C.frameMetrics(himg.data, 8) });
        }
        var r = C.refineCutWindow(fine);
        if (r) cuts.push({ time: Math.round(r.t), strength: r.score });
        setSceneProgress(0.6 + 0.4 * ((ci + 1) / cands.length),
          '细化切点 ' + (ci + 1) + '/' + cands.length);
      }
      // 细化后可能出现过近的重复切点：200ms 内保留强度最高者
      cuts.sort(function (a, b) { return a.time - b.time; });
      var merged = [];
      cuts.forEach(function (ct) {
        var last = merged[merged.length - 1];
        if (last && ct.time - last.time < 200) {
          if (ct.strength > last.strength) merged[merged.length - 1] = ct;
        } else {
          merged.push(ct);
        }
      });
      state.scene.cuts = merged;
      state.scene.thumbs = {};
      setSceneProgress(1, '');
      setStatus('镜头检测完成：' + merged.length + ' 个切点（' +
        C.fmtShort(fromMs) + ' ~ ' + C.fmtShort(toMs) + '，采样 ' + n + ' 帧）');
    } catch (e) {
      if (e && e.cancelled) {
        setStatus('已取消镜头检测');
      } else if (!state.media.ready) {
        setStatus('镜头检测中止：媒体已卸载，分析数据已清除');
      } else {
        setStatus('镜头检测失败：' + (e && e.message ? e.message : e));
      }
    } finally {
      state.scene.running = false;
      state.scene.cancel = false;
      sceneProgressShow(false);
      updateSceneButtons();
      analyzeAndRender();
      drawCanvas();
    }
  }
  btnSceneScan.addEventListener('click', runSceneScan);
  btnSceneCancel.addEventListener('click', function () {
    if (state.scene.running) {
      state.scene.cancel = true;
      sceneState.textContent = '正在取消…';
    }
  });

  // ---------- 清除（卸载媒体 / 手动清除；数据仅内存） ----------
  function clearCutData(silent) {
    state.scene.cuts = [];
    state.scene.thumbs = {};
    state.cutDetail = null;
    state.pendingCutSnap = null;
    cutModal.classList.add('hidden');
    cutBatchModal.classList.add('hidden');
    updateSceneButtons();
    analyzeAndRender();
    drawCanvas();
    if (!silent) setStatus('已清除镜头切点（数据本就在内存中，未写入任何存储）');
  }
  btnSceneClear.addEventListener('click', function () { clearCutData(false); });

  // ---------- 切点详情弹窗（前后缩略图 + 逐条吸附） ----------
  function openCutDetail(cueIdx, cutIdx) {
    var cut = state.scene.cuts[cutIdx];
    if (!cut || !state.doc) return;
    state.cutDetail = { cue: cueIdx, cutIdx: cutIdx };
    renderCutModal();
    cutModal.classList.remove('hidden');
    setPlayhead(cut.time);   // 同步定位媒体与播放头
    fillCutThumbs(cutIdx);
    setStatus('切点 ' + C.fmtMs(cut.time, 'srt') + '：已同步定位媒体');
  }
  function hideCutDetail() {
    cutModal.classList.add('hidden');
    state.cutDetail = null;
  }
  btnCutClose.addEventListener('click', hideCutDetail);
  cutModal.addEventListener('click', function (e) { if (e.target === cutModal) hideCutDetail(); });

  // 逐条吸附校验：负时间、无效时长，以及规则不允许的相邻重叠
  // （与批量计划 planCutSnap 的排除规则一致；返回原因文案，null 表示可吸附）
  function cutSnapError(cueIdx, cutIdx, field) {
    var cue = state.doc.cues[cueIdx];
    var cut = state.scene.cuts[cutIdx];
    if (!cue || !cut) return '数据已失效';
    if (field === 'start') {
      if (cut.time < 0) return '切点时间为负，不能吸附';
      if (cue.end - cut.time < MIN_DUR) {
        return '吸附后时长不足 ' + MIN_DUR + 'ms（终点 ' + C.fmtMs(cue.end, 'srt') + '）';
      }
      if (!state.settings.allowOverlap && cueIdx > 0) {
        var prevEnd = state.doc.cues[cueIdx - 1].end;
        if (cut.time < prevEnd) {
          return '吸附后起点早于上一条终点 ' + C.fmtMs(prevEnd, 'srt') +
            '，规则不允许重叠（可在设置中开启「允许重叠」）';
        }
      }
    } else {
      if (cut.time - cue.start < MIN_DUR) {
        return '吸附后时长不足 ' + MIN_DUR + 'ms（起点 ' + C.fmtMs(cue.start, 'srt') + '）';
      }
      if (!state.settings.allowOverlap && cueIdx + 1 < state.doc.cues.length) {
        var nextStart = state.doc.cues[cueIdx + 1].start;
        if (cut.time > nextStart) {
          return '吸附后终点晚于下一条起点 ' + C.fmtMs(nextStart, 'srt') +
            '，规则不允许重叠（可在设置中开启「允许重叠」）';
        }
      }
    }
    return null;
  }

  function renderCutModal() {
    var d = state.cutDetail;
    if (!d || !state.doc) return;
    var cut = state.scene.cuts[d.cutIdx];
    var cue = state.doc.cues[d.cue];
    if (!cut || !cue) { hideCutDetail(); return; }
    cutInfo.textContent = '切点 ' + C.fmtMs(cut.time, 'srt') + ' · 变化强度 ' +
      Math.round(clamp(cut.strength, 0, 1) * 100) + '% · 第 ' + (d.cutIdx + 1) + '/' +
      state.scene.cuts.length + ' 个';
    cutCueInfo.innerHTML = '第 <span class="mono">#' + esc(cue.num) + '</span> 条 · ' +
      '<span class="mono">' + C.fmtMs(cue.start, 'srt') + ' → ' + C.fmtMs(cue.end, 'srt') +
      '</span> · ' + esc(cue.lines.join(' / '));
    var errS = cutSnapError(d.cue, d.cutIdx, 'start');
    var errE = cutSnapError(d.cue, d.cutIdx, 'end');
    btnCutSnapStart.disabled = !!errS;
    btnCutSnapStart.title = errS || '把第 ' + cue.num + ' 条起点改为 ' + C.fmtMs(cut.time, 'srt');
    btnCutSnapEnd.disabled = !!errE;
    btnCutSnapEnd.title = errE || '把第 ' + cue.num + ' 条终点改为 ' + C.fmtMs(cut.time, 'srt');
    cutTBefore.textContent = C.fmtShort(Math.max(0, cut.time - 80));
    cutTAfter.textContent = C.fmtShort(cut.time + 80);
  }

  // 懒截取切点前后缩略图（仅内存缓存，卸载媒体即失效）
  async function fillCutThumbs(cutIdx) {
    var cut = state.scene.cuts[cutIdx];
    if (!cut) return;
    var cached = state.scene.thumbs[cutIdx];
    if (cached) { showCutThumbs(cached); return; }
    cutThumbBefore.removeAttribute('src');
    cutThumbAfter.removeAttribute('src');
    cutThumbHint.textContent = '正在截取切点前后画面…';
    try {
      if (!state.media.ready) throw new Error('媒体已卸载，无法截取');
      await ensureScanVideo();
      var durMs = Math.round(state.media.duration);
      var before = await grabFrameAt(clamp(cut.time - 80, 0, Math.max(0, durMs - 1)), 240);
      var after = await grabFrameAt(clamp(cut.time + 80, 0, Math.max(0, durMs - 1)), 240);
      var thumbs = { before: imgToDataURL(before), after: imgToDataURL(after) };
      state.scene.thumbs[cutIdx] = thumbs;
      if (state.cutDetail && state.cutDetail.cutIdx === cutIdx &&
        !cutModal.classList.contains('hidden')) {
        showCutThumbs(thumbs);
      }
    } catch (e) {
      if (!cutModal.classList.contains('hidden')) {
        cutThumbHint.textContent = '缩略图截取失败：' + (e && e.message ? e.message : e);
      }
    }
  }
  function showCutThumbs(thumbs) {
    cutThumbBefore.src = thumbs.before;
    cutThumbAfter.src = thumbs.after;
    cutThumbHint.textContent = '';
  }

  // 逐条吸附：把当前详情字幕的起点 / 终点吸附到切点
  function doCutSnap(field) {
    var d = state.cutDetail;
    if (!d || !state.doc) return;
    var cue = state.doc.cues[d.cue];
    var cut = state.scene.cuts[d.cutIdx];
    if (!cue || !cut) { hideCutDetail(); return; }
    var err = cutSnapError(d.cue, d.cutIdx, field);
    if (err) { setStatus('无法吸附：' + err); return; }
    pushUndo('cutsnap');
    var oldS = cue.start, oldE = cue.end;
    if (field === 'start') cue.start = cut.time;
    else cue.end = cut.time;
    adaptCueWordsForBatch(cue, oldS, oldE, cue.start, cue.end);
    fillRowTimes(d.cue);
    afterChange('已将第 ' + cue.num + ' 条' + (field === 'start' ? '起点' : '终点') +
      ' 吸附到切点 ' + C.fmtMs(cut.time, 'srt'));
    renderCutModal();
  }
  btnCutSnapStart.addEventListener('click', function () { doCutSnap('start'); });
  btnCutSnapEnd.addEventListener('click', function () { doCutSnap('end'); });

  // ---------- 批量吸附预览 ----------
  btnSceneSnapAll.addEventListener('click', function () {
    if (!state.doc || !state.scene.cuts.length) return;
    commitAllRows();
    var plan = C.planCutSnap(state.doc.cues, state.scene.cuts, state.scene.cfg.tol, {
      allowOverlap: state.settings.allowOverlap,
      minDurMs: MIN_DUR,
    });
    if (!plan.changes.length && !plan.skipped.length) {
      setStatus('容差 ' + state.scene.cfg.tol + 'ms 内没有需要吸附的起止点');
      return;
    }
    state.pendingCutSnap = plan;
    renderCutBatch();
    cutBatchModal.classList.remove('hidden');
  });

  function renderCutBatch() {
    var plan = state.pendingCutSnap;
    if (!plan || !state.doc) return;
    cutBatchSummary.textContent = '容差 ' + state.scene.cfg.tol + 'ms：将调整 ' +
      plan.changes.length + ' 条；排除 ' + plan.skipped.length +
      ' 条（负时间 / 无效时长 / 倒序 / 规则不允许的重叠）。应用后可用 Ctrl+Z 整体撤销。';
    cutBatchTbody.innerHTML = '';
    var frag = document.createDocumentFragment();
    plan.changes.forEach(function (ch) {
      var cue = state.doc.cues[ch.i];
      var tr = document.createElement('tr');
      var edge = [];
      if (ch.snapStart) edge.push('起点');
      if (ch.snapEnd) edge.push('终点');
      tr.innerHTML =
        '<td class="mono">#' + esc(ch.num) + '</td>' +
        '<td>' + (ch.snapStart
          ? '<span class="old mono">' + C.fmtMs(ch.oldStart, 'srt') + '</span> → <span class="new">' +
            C.fmtMs(ch.newStart, 'srt') + '</span>'
          : '<span class="mono">' + C.fmtMs(ch.oldStart, 'srt') + '</span>') + '</td>' +
        '<td>' + (ch.snapEnd
          ? '<span class="old mono">' + C.fmtMs(ch.oldEnd, 'srt') + '</span> → <span class="new">' +
            C.fmtMs(ch.newEnd, 'srt') + '</span>'
          : '<span class="mono">' + C.fmtMs(ch.oldEnd, 'srt') + '</span>') + '</td>' +
        '<td><span class="cb-edge">吸附' + edge.join('+') + '</span> ' +
          esc(cue.lines.join(' / ')) + '</td>';
      frag.appendChild(tr);
    });
    plan.skipped.forEach(function (sk) {
      var cue = state.doc.cues[sk.i];
      var tr = document.createElement('tr');
      tr.className = 'cbskip';
      tr.innerHTML =
        '<td class="mono">#' + esc(sk.num) + '</td>' +
        '<td class="mono">' + C.fmtMs(cue.start, 'srt') + '</td>' +
        '<td class="mono">' + C.fmtMs(cue.end, 'srt') + '</td>' +
        '<td><span class="cb-reason">排除：' + esc(sk.reason) + '</span> ' +
          esc(cue.lines.join(' / ')) + '</td>';
      frag.appendChild(tr);
    });
    cutBatchTbody.appendChild(frag);
    btnCutBatchApply.disabled = plan.changes.length === 0;
  }

  function hideCutBatch() {
    cutBatchModal.classList.add('hidden');
    state.pendingCutSnap = null;
  }
  btnCutBatchCancel.addEventListener('click', hideCutBatch);
  cutBatchModal.addEventListener('click', function (e) { if (e.target === cutBatchModal) hideCutBatch(); });
  btnCutBatchApply.addEventListener('click', function () {
    var plan = state.pendingCutSnap;
    if (!plan || !state.doc) { hideCutBatch(); return; }
    if (!plan.changes.length) { hideCutBatch(); return; }
    pushUndo('cutsnapbatch');
    plan.changes.forEach(function (ch) {
      var cue = state.doc.cues[ch.i];
      adaptCueWordsForBatch(cue, ch.oldStart, ch.oldEnd, ch.newStart, ch.newEnd);
      cue.start = ch.newStart;
      cue.end = ch.newEnd;
    });
    hideCutBatch();
    renderList();
    afterChange('已批量吸附 ' + plan.changes.length + ' 条到切点' +
      (plan.skipped.length ? '（排除 ' + plan.skipped.length + ' 条不合规项）' : ''));
  });

  // ============================================================
  // WebVTT 逐词时间码（词元轨道）
  // 选中字幕时在时间轴与列表之间展开词元轨道：
  //   · 播放媒体（或模拟播放头）时按 M 依次把当前时间标记为下一词元起点
  //   · 拖动词元轨道上的标记竖线，或点击词元输入时间
  //   · 标记必须严格递增且位于 cue 区间内；标签 / 实体 / 英文单词 / 数字串不拆
  //   · 改 cue 起止时比较“保持绝对时间 / 按比例缩放”，越界方案禁用
  // ============================================================

  var wordCssW = 0, wordCssH = 34;

  function selectedCue() {
    return (state.doc && state.selected >= 0) ? state.doc.cues[state.selected] : null;
  }
  // 测试 / 调试钩子
  window.__dbgSelectedSpan = function () {
    var c = selectedCue();
    return c ? { start: c.start, end: c.end } : null;
  };
  window.__dbgPlayhead = function () { return state.playheadMs; };
  function cueHasWordMarks(cue) {
    if (!cue) return false;
    return C.parseCueWords(cue).marks.length > 0;
  }

  // 词元轨道是否对当前选中条可见（有正文即展示，便于手工标记）
  function wordPanelVisible() {
    return !!selectedCue();
  }

  function currentWordData() {
    var cue = selectedCue();
    if (!cue) return null;
    return C.parseCueWords(cue);
  }

  // ---------- 渲染 ----------
  function renderWordPanel() {
    var cue = selectedCue();
    var show = !!cue;
    wordPanel.classList.toggle('hidden', !show);
    if (!cue) return;
    var w = C.parseCueWords(cue);
    wordPanelCue.textContent = '#' + cue.num;
    wordPanelRange.textContent = C.fmtMs(cue.start, 'srt') + ' → ' + C.fmtMs(cue.end, 'srt');
    var nErr = w.errors.length;
    wordPanelCount.textContent = w.marks.length + ' 个标记' +
      (nErr ? ' · ' + nErr + ' 处错误' : '');
    wordPanelCount.classList.toggle('has-err', nErr > 0);
    renderWordChips(cue, w);
    resizeWordRuler();
    drawWordRuler();
  }

  // 词元 chips：每个不可拆正文单元一块；已标记显示起点时间
  function renderWordChips(cue, w) {
    wordChips.innerHTML = '';
    var errOffs = {};
    w.errors.forEach(function (e) { errOffs[e.off] = e; });
    var markByTok = {};
    w.marks.forEach(function (m) { markByTok[m.tok] = m; });
    var activeTok = state.playheadMs !== undefined ? C.activeWord(cue, state.playheadMs) : -1;
    var frag = document.createDocumentFragment();
    var prevContentLine = -1;
    w.toks.forEach(function (t, i) {
      if (t.type === 'ts') return;
      if (t.type === 'space') {
        if (t.s.indexOf('\n') !== -1) frag.appendChild(document.createElement('br'));
        else {
          var sp = document.createElement('span');
          sp.className = 'wc-space';
          sp.textContent = t.s;
          frag.appendChild(sp);
        }
        return;
      }
      if (t.type === 'tag') {
        var tag = document.createElement('span');
        tag.className = 'wc-tag';
        tag.textContent = t.s;
        tag.title = '标签（不可标记，导出时保留）';
        frag.appendChild(tag);
        return;
      }
      // 正文单元
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'wc-chip' +
        (markByTok[i] ? ' marked' : '') +
        (i === activeTok ? ' active' : '');
      chip.dataset.tok = i;
      var label = t.type === 'entity' ? C.decodeEntity(t.s) : t.s;
      chip.textContent = label;
      var mk = markByTok[i];
      if (mk) {
        var tm = document.createElement('span');
        tm.className = 'wc-time mono';
        tm.textContent = C.fmtShort(mk.time);
        chip.appendChild(tm);
      }
      var err = errOffs[t.off];
      if (err) {
        chip.classList.add('wc-err');
        chip.title = err.msg;
      } else if (mk) {
        chip.title = '词元起点 ' + C.fmtMs(mk.time, 'srt') + '（点击输入时间，可清除）';
      } else {
        chip.title = '点击输入起点时间；播放时按 M 顺序标记';
      }
      frag.appendChild(chip);
    });
    wordChips.appendChild(frag);
  }

  // ---------- 词元轨道画布（cue 区间内的标记竖线 + 播放头） ----------
  function wordX(t) {
    var cue = selectedCue();
    if (!cue) return 0;
    var dur = Math.max(1, cue.end - cue.start);
    return (t - cue.start) / dur * wordCssW;
  }
  function wordTimeFromX(x) {
    var cue = selectedCue();
    var dur = Math.max(1, cue.end - cue.start);
    return cue.start + clamp(x, 0, wordCssW) / wordCssW * dur;
  }
  function resizeWordRuler() {
    var dpr = window.devicePixelRatio || 1;
    wordCssW = wordRulerWrap.clientWidth || 800;
    wordCssH = 34;
    wordRuler.style.width = wordCssW + 'px';
    wordRuler.width = Math.round(wordCssW * dpr);
    wordRuler.height = Math.round(wordCssH * dpr);
    wordRuler.style.height = wordCssH + 'px';
    wordRulerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function drawWordRuler() {
    var cue = selectedCue();
    if (!cue || !wordCssW) return;
    var ctx2 = wordRulerCtx;
    ctx2.clearRect(0, 0, wordCssW, wordCssH);
    // 区间轨道
    ctx2.fillStyle = '#111a2b';
    ctx2.fillRect(0, 10, wordCssW, wordCssH - 14);
    ctx2.strokeStyle = '#2b3652';
    ctx2.strokeRect(0.5, 10.5, wordCssW - 1, wordCssH - 15);
    var w = C.parseCueWords(cue);
    var badOff = {};
    w.errors.forEach(function (e) {
      if (e.kind === 'order' || e.kind === 'outrange') badOff[e.time] = e.kind;
    });
    // 标记竖线
    w.marks.forEach(function (m) {
      var x = wordX(m.time);
      var bad = m.time < cue.start || m.time > cue.end;
      ctx2.strokeStyle = bad ? '#f87171' : '#5eead4';
      ctx2.lineWidth = 1.5;
      ctx2.beginPath();
      ctx2.moveTo(x, 8); ctx2.lineTo(x, wordCssH - 3);
      ctx2.stroke();
      ctx2.fillStyle = bad ? '#f87171' : '#5eead4';
      ctx2.beginPath();
      ctx2.moveTo(x - 4, 10); ctx2.lineTo(x + 4, 10); ctx2.lineTo(x, 5);
      ctx2.closePath(); ctx2.fill();
    });
    // 播放头（仅在 cue 区间内）
    if (state.playheadMs >= cue.start && state.playheadMs <= cue.end) {
      var px = wordX(state.playheadMs);
      ctx2.strokeStyle = '#f87171';
      ctx2.lineWidth = 1.5;
      ctx2.beginPath();
      ctx2.moveTo(px, 2); ctx2.lineTo(px, wordCssH - 2);
      ctx2.stroke();
    }
    ctx2.fillStyle = '#8595b6';
    ctx2.font = '10px ' + getComputedStyle(document.body).fontFamily;
    ctx2.textBaseline = 'top';
    ctx2.fillText(C.fmtShort(cue.start), 2, 18);
    ctx2.fillText(C.fmtShort(cue.end), wordCssW - 42, 18);
  }

  // 拖拽 / 播放头移动时仅轻量刷新（不重建 chips，避免输入中失焦）
  function refreshWordPanelLive() {
    if (wordPanel.classList.contains('hidden')) return;
    updateWordChipsActive();
    drawWordRuler();
  }
  function updateWordChipsActive() {
    var cue = selectedCue();
    if (!cue) return;
    var active = C.activeWord(cue, state.playheadMs);
    var chips = wordChips.querySelectorAll('.wc-chip');
    chips.forEach(function (el) {
      el.classList.toggle('active', +el.dataset.tok === active);
    });
  }

  // ---------- 标记 / 修改 / 清除 ----------
  function applyWordLines(cue, lines, label) {
    pushUndo(label || 'word');
    cue.lines = lines;
    renderList();
    selectCue(state.selected, { scroll: false });
    afterChange(null);
  }

  function setMark(cue, tok, time, label) {
    var res = C.setWordTime(cue, tok, Math.round(time));
    if (res.error) { setStatus('无法标记：' + res.error); return false; }
    applyWordLines(cue, res.lines, label || 'wordmark');
    return true;
  }

  // M 键：把播放头标记为“下一个未标记词元”的起点（按正文顺序）
  function markNextAtPlayhead() {
    var cue = selectedCue();
    if (!cue || !wordArmChk.checked) return;
    var w = C.parseCueWords(cue);
    var marked = {};
    w.marks.forEach(function (m) { marked[m.tok] = true; });
    var next = -1;
    for (var i = 0; i < w.toks.length; i++) {
      if (C.isContentTok(w.toks[i]) && !marked[i]) { next = i; break; }
    }
    if (next < 0) { setStatus('该条词元已全部标记，可改用预览对比或导出 VTT'); return; }
    if (state.playheadMs < cue.start || state.playheadMs > cue.end) {
      setStatus('播放头 ' + C.fmtShort(state.playheadMs) + ' 不在第 ' + cue.num +
        ' 条区间内，词元起点必须位于字幕区间内（未标记）');
      return;
    }
    if (setMark(cue, next, state.playheadMs, 'wordmark')) {
      var label = w.toks[next].type === 'entity' ? C.decodeEntity(w.toks[next].s) : w.toks[next].s;
      setStatus('已把「' + label + '」起点标记为 ' + C.fmtMs(Math.round(state.playheadMs), 'srt') +
        '（' + (w.marks.length + 1) + ' 个词元）');
    }
  }

  // chips 点击：已标记 → 弹出内联时间输入；未标记 → 直接用当前播放头
  wordChips.addEventListener('click', function (e) {
    var chip = e.target.closest('.wc-chip');
    if (!chip) return;
    var cue = selectedCue();
    if (!cue) return;
    var tok = +chip.dataset.tok;
    var w = C.parseCueWords(cue);
    var mk = w.marks.find(function (m) { return m.tok === tok; });
    if (!mk) {
      if (state.playheadMs >= cue.start && state.playheadMs <= cue.end) {
        setMark(cue, tok, state.playheadMs, 'wordmark');
      } else {
        openWordTimeEditor(chip, cue, tok, null);
      }
      return;
    }
    openWordTimeEditor(chip, cue, tok, mk);
  });

  // 内联时间输入（含清除按钮）
  function openWordTimeEditor(chip, cue, tok, mk) {
    var existing = wordChips.querySelector('.wc-edit');
    if (existing) existing.remove();
    state.word.editTok = tok;
    var box = document.createElement('span');
    box.className = 'wc-edit';
    box.addEventListener('click', function (ev) { ev.stopPropagation(); });
    var input = document.createElement('input');
    input.className = 'mono';
    input.spellcheck = false;
    input.value = mk ? C.fmtMs(mk.time, 'srt') : C.fmtMs(clamp(state.playheadMs, cue.start, cue.end), 'srt');
    var ok = document.createElement('button');
    ok.type = 'button'; ok.className = 'mini primary'; ok.textContent = '确定';
    var clr = document.createElement('button');
    clr.type = 'button'; clr.className = 'mini'; clr.textContent = '清除';
    var cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'mini'; cancel.textContent = '×';
    box.appendChild(input); box.appendChild(ok); box.appendChild(clr); box.appendChild(cancel);
    chip.insertAdjacentElement('afterend', box);
    input.focus(); input.select();
    function finish() { box.remove(); state.word.editTok = -1; }
    function save() {
      var ms = C.parseTimecode(input.value);
      if (ms === null) { input.classList.add('invalid'); setStatus('无法识别时间格式：' + input.value); return; }
      if (setMark(cue, tok, ms, 'wordedit')) finish();
    }
    ok.addEventListener('click', save);
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); save(); }
      else if (ev.key === 'Escape') finish();
      ev.stopPropagation();
    });
    clr.addEventListener('click', function () {
      var res = C.clearWordTime(cue, tok);
      if (res.error) { setStatus(res.error); return; }
      applyWordLines(cue, res.lines, 'wordclear');
      finish();
    });
    cancel.addEventListener('click', finish);
  }

  btnWordClear.addEventListener('click', function () {
    var cue = selectedCue();
    if (!cue || !cueHasWordMarks(cue)) return;
    var res = C.clearAllWordTimes(cue);
    applyWordLines(cue, res.lines, 'wordclearall');
    setStatus('已清空第 ' + cue.num + ' 条的全部词元标记（正文与标签保留）');
  });

  // ---------- 词元轨道拖拽标记 ----------
  var wordDrag = null;
  wordRuler.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    var cue = selectedCue();
    if (!cue) return;
    var rect = wordRuler.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var w = C.parseCueWords(cue);
    var hit = null;
    w.marks.forEach(function (m) {
      if (Math.abs(wordX(m.time) - x) <= 6) hit = m;
    });
    if (hit) {
      wordDrag = { tok: hit.tok, orig: hit.time, moved: false, undo: false };
    } else {
      // 点空白：把播放头 / 媒体定位到 cue 区间内该时刻
      var t = Math.round(wordTimeFromX(x));
      setPlayhead(t);
    }
  });
  window.addEventListener('mousemove', function (e) {
    if (!wordDrag || wordPanel.classList.contains('hidden')) return;
    var cue = selectedCue();
    if (!cue) { wordDrag = null; return; }
    var rect = wordRuler.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var t = Math.round(wordTimeFromX(x));
    if (t === wordDrag.orig && !wordDrag.moved) return;
    wordDrag.moved = true;
    // 相邻标记约束（预览态，不写模型）
    var probe2 = C.parseCueWords(cue);
    var dragMk = probe2.marks.find(function (m) { return m.tok === wordDrag.tok; });
    if (dragMk) dragMk.time = clamp(t, cue.start, cue.end);
    var prevT = -Infinity, nextT = Infinity;
    probe2.marks.forEach(function (m) {
      if (m.tok === wordDrag.tok) return;
      if (m.time <= wordDrag.orig && m.time > prevT) prevT = m.time;
      if (m.time >= wordDrag.orig && m.time < nextT) nextT = m.time;
    });
    var bad = t <= prevT || t >= nextT || t < cue.start || t > cue.end;
    wordRuler.classList.toggle('drag-bad', bad);
    drawWordRulerStatic(cue, probe2, t);
  });
  // 用给定 marks 数据重绘（拖拽预览）
  function drawWordRulerStatic(cue, w, dragT) {
    var ctx2 = wordRulerCtx;
    ctx2.clearRect(0, 0, wordCssW, wordCssH);
    ctx2.fillStyle = '#111a2b';
    ctx2.fillRect(0, 10, wordCssW, wordCssH - 14);
    ctx2.strokeStyle = '#2b3652';
    ctx2.strokeRect(0.5, 10.5, wordCssW - 1, wordCssH - 15);
    w.marks.forEach(function (m) {
      var x = wordX(m.time);
      ctx2.strokeStyle = '#5eead4';
      ctx2.lineWidth = 1.5;
      ctx2.beginPath(); ctx2.moveTo(x, 8); ctx2.lineTo(x, wordCssH - 3); ctx2.stroke();
      ctx2.fillStyle = '#5eead4';
      ctx2.beginPath();
      ctx2.moveTo(x - 4, 10); ctx2.lineTo(x + 4, 10); ctx2.lineTo(x, 5);
      ctx2.closePath(); ctx2.fill();
    });
    var dx = wordX(clamp(dragT, cue.start, cue.end));
    ctx2.strokeStyle = '#fbbf24';
    ctx2.lineWidth = 2;
    ctx2.beginPath(); ctx2.moveTo(dx, 2); ctx2.lineTo(dx, wordCssH - 2); ctx2.stroke();
  }
  window.addEventListener('mouseup', function (e) {
    if (!wordDrag) return;
    var d = wordDrag;
    wordDrag = null;
    wordRuler.classList.remove('drag-bad');
    if (!d.moved) return;
    var cue = selectedCue();
    if (!cue) return;
    var rect = wordRuler.getBoundingClientRect();
    var t = Math.round(wordTimeFromX(e.clientX - rect.left));
    setMark(cue, d.tok, t, 'worddrag');
  });

  // 批量改时（自动顺延 / 双锚点 / 切点吸附等）时处理词元标记：
  // 优先保持绝对时间；若标记会越界且缩放合法则按新区间缩放；都不行则保留绝对时间
  // （随后由词元检查面板报越界，绝不静默删除标记）。
  function adaptCueWordsForBatch(cue, oldStart, oldEnd, newStart, newEnd) {
    if (!cueHasWordMarks(cue)) return;
    if (oldStart === newStart && oldEnd === newEnd) return;
    var probe = C.parseCueWords(cue);
    var baseCue = { start: oldStart, end: oldEnd, lines: cue.lines };
    var plan = C.planWordBounds(baseCue, newStart, newEnd);
    if (plan.absolute.ok) return;
    if (plan.scale.ok) {
      var sc = C.scaleWordTimes(baseCue, newStart, newEnd);
      if (!sc.error) cue.lines = sc.lines;
    }
  }

  // ---------- 改 cue 起止：两方案比较 ----------
  // 请求把第 i 条区间改为 [ns, ne]。
  //   · 无词元标记：直接应用（pushUndo 一次），返回 true
  //   · 有词元标记：弹窗比较“保持绝对时间 / 按比例缩放”；越界方案禁用。
  //     opts.alreadyMutated（拖拽）：模型已临时改成新区间，取消时回退 orig；
  //     opts.translate（键盘整体平移）：等价于绝对时间平移，仅在可行时直接应用。
  // 返回 true 表示已应用；false 表示弹窗待决或被拒绝（调用方不得继续 afterChange）。
  function requestBoundsChange(i, ns, ne, opts) {
    opts = opts || {};
    if (!state.doc) return false;
    var cue = state.doc.cues[i];
    if (ns === cue.start && ne === cue.end && !opts.alreadyMutated) return true;
    if (!cueHasWordMarks(cue)) {
      pushUndo(opts.label || 'edit');
      cue.start = ns; cue.end = ne;
      renderList();
      selectCue(i, { scroll: false });
      afterChange(null);
      return true;
    }
    // 记录“原始 cue 快照”（弹窗取消时 alreadyMutated 需要恢复）
    var origCue = JSON.parse(JSON.stringify(cue));
    var baseCue = opts.alreadyMutated && opts.orig
      ? { start: opts.orig.start, end: opts.orig.end, lines: cue.lines }
      : { start: cue.start, end: cue.end, lines: cue.lines };
    var plan = C.planWordBounds(baseCue, ns, ne);
    // 键盘整体平移：绝对时间随区间平移后仍合法则直接平移，不打断操作
    if (opts.translate) {
      var delta = ns - baseCue.start;
      var tr = C.translateWordTimes(baseCue, delta, { start: ns, end: ne });
      if (!tr.error) {
        pushUndo(opts.label || 'nudge');
        cue.start = ns; cue.end = ne; cue.lines = tr.lines;
        renderList();
        selectCue(i, { scroll: false });
        afterChange(null);
        return true;
      }
      // 平移会让标记越界 → 落到弹窗比较（缩放仍可能可用）
    }
    openWordBoundsModal(i, baseCue, ns, ne, plan, opts, origCue);
    return false;
  }

  function openWordBoundsModal(i, baseCue, ns, ne, plan, opts, origCue) {
    var cue = state.doc.cues[i];
    state.word.pendingBounds = {
      i: i, ns: ns, ne: ne, baseCue: baseCue, plan: plan, opts: opts, origCue: origCue,
    };
    wordBoundsCue.textContent = '第 ' + cue.num + ' 条：' +
      C.fmtMs(baseCue.start, 'srt') + ' → ' + C.fmtMs(baseCue.end, 'srt') +
      ' 改为 ' + C.fmtMs(ns, 'srt') + ' → ' + C.fmtMs(ne, 'srt') +
      ' · ' + plan.nMarks + ' 个词元标记';
    // 绝对时间
    wbAbsState.innerHTML = plan.absolute.ok
      ? '<span class="ok">✓ 全部标记仍在新区间内</span>'
      : '<span class="bad">✗ ' + esc(plan.absolute.reason) + '</span>';
    btnWbAbs.disabled = !plan.absolute.ok;
    // 缩放
    wbScaleDesc.textContent = '词元随新区间线性映射（' +
      C.fmtMs(baseCue.start, 'srt') + '→' + C.fmtMs(ns, 'srt') + ' …）。';
    wbScaleState.innerHTML = plan.scale.ok
      ? '<span class="ok">✓ 映射后仍严格递增且不越界</span>'
      : '<span class="bad">✗ ' + esc(plan.scale.reason) + '</span>';
    btnWbScale.disabled = !plan.scale.ok;
    renderWordBoundsDiff(baseCue, ns, ne, plan);
    wordBoundsModal.classList.remove('hidden');
  }

  function renderWordBoundsDiff(baseCue, ns, ne, plan) {
    var w = C.parseCueWords(baseCue);
    wordBoundsDiffBody.innerHTML = '';
    var frag = document.createDocumentFragment();
    w.marks.forEach(function (m, k) {
      var text = '';
      for (var j = m.tok; j < w.toks.length; j++) {
        if (C.isContentTok(w.toks[j])) { text += w.toks[j].type === 'entity' ? C.decodeEntity(w.toks[j].s) : w.toks[j].s; }
        var stop = false;
        for (var q = j + 1; q < w.toks.length; q++) {
          if (w.toks[q].type === 'ts') { stop = true; break; }
          if (C.isContentTok(w.toks[q])) { stop = true; break; }
        }
        if (stop) break;
      }
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + esc(text.slice(0, 8)) + '</td>' +
        '<td class="mono old">' + C.fmtMs(m.time, 'srt') + '</td>' +
        '<td><span class="mono abs">' + C.fmtMs(plan.absolute.marks[k], 'srt') + '</span>' +
        ' / <span class="mono scl">' + C.fmtMs(plan.scale.marks[k] !== undefined ? plan.scale.marks[k] : m.time, 'srt') + '</span></td>';
      frag.appendChild(tr);
    });
    wordBoundsDiffBody.appendChild(frag);
  }

  function hideWordBounds(apply) {
    var pb = state.word.pendingBounds;
    if (pb && !apply && pb.opts && pb.opts.alreadyMutated) {
      // 拖拽产生的临时改动被取消：恢复拖拽前 cue，并撤回拖拽开始时压入的空快照
      var cue = state.doc.cues[pb.i];
      cue.start = pb.origCue.start;
      cue.end = pb.origCue.end;
      cue.lines = pb.origCue.lines;
      if (state.undoStack.length) {
        state.undoStack.pop();
        updateUndoButtons();
      }
      renderList();
      selectCue(pb.i, { scroll: false });
      afterChange(null);
    } else if (pb && !apply && pb.i !== undefined) {
      // 时间框输入 / 吸附等来源：模型从未改变，仅还原输入框显示
      fillRowTimes(pb.i);
    }
    state.word.pendingBounds = null;
    wordBoundsModal.classList.add('hidden');
  }
  btnWbCancel.addEventListener('click', function () {
    hideWordBounds(false);
    setStatus('已取消：区间与词元均未改变');
  });
  wordBoundsModal.addEventListener('click', function (e) {
    if (e.target === wordBoundsModal) {
      hideWordBounds(false);
      setStatus('已取消：区间与词元均未改变');
    }
  });

  function applyWordBounds(mode) {
    var pb = state.word.pendingBounds;
    if (!pb) return;
    var cue = state.doc.cues[pb.i];
    var res;
    if (mode === 'absolute') {
      if (!pb.plan.absolute.ok) { setStatus('保持绝对时间会越界，该方案不可应用'); return; }
      // 区间改变、词元文本不动
      res = { lines: cue.lines };
    } else {
      res = C.scaleWordTimes(pb.baseCue, pb.ns, pb.ne);
      if (res.error) { setStatus('按比例缩放不可应用：' + res.error); return; }
    }
    // alreadyMutated（拖拽）时撤销快照已在拖拽开始压入；此处不重复压栈
    if (!pb.opts.alreadyMutated) pushUndo(pb.opts.label || 'edit');
    cue.start = pb.ns; cue.end = pb.ne;
    cue.lines = res.lines;
    state.word.pendingBounds = null;
    wordBoundsModal.classList.add('hidden');
    renderList();
    selectCue(pb.i, { scroll: false });
    afterChange(mode === 'absolute' ? '已保持词元绝对时间，仅调整区间' : '已按比例缩放词元时间并调整区间');
  }
  btnWbAbs.addEventListener('click', function () { applyWordBounds('absolute'); });
  btnWbScale.addEventListener('click', function () { applyWordBounds('scale'); });

  // ---------- 错误定位 ----------
  function locateWordError(p) {
    var cue = state.doc.cues[p.cue];
    setStatus('第 ' + cue.num + ' 条 ' + p.msg);
    // 在文本框中定位到行列位置
    var ta = rowEls[p.cue] && rowEls[p.cue].querySelector('textarea');
    if (ta && p.line !== undefined) {
      var lines = ta.value.split('\n');
      var pos = 0;
      for (var k = 0; k < p.line - 1 && k < lines.length; k++) pos += lines[k].length + 1;
      pos += Math.max(0, p.col - 1);
      ta.focus();
      ta.setSelectionRange(pos, Math.min(ta.value.length, pos + (p.len || 1)));
    }
    renderWordPanel();
    // 高亮出错 chip
    setTimeout(function () {
      var bad = wordChips.querySelector('.wc-err');
      if (bad) {
        bad.classList.add('flash');
        bad.scrollIntoView({ block: 'nearest', inline: 'center' });
      }
    }, 0);
  }

  // ---------- 预览区随播放头高亮当前词元 ----------
  // nowCueText / 视频叠加层改用 cuePreviewHtml（保留 v/c/ruby 标签，逐词高亮）
  var lastNowSig = '';
  function updateWordPreview() {
    if (!state.doc) { lastNowSig = ''; return; }
    var list = state.doc.cues;
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (state.playheadMs >= list[i].start && state.playheadMs < list[i].end) { idx = i; break; }
    }
    var sig = idx < 0 ? ('empty:' + Math.round(state.playheadMs / 100)) :
      idx + ':' + list[idx].start + ':' + list[idx].end + ':' + Math.round(state.playheadMs / 50);
    if (sig === lastNowSig) return;
    lastNowSig = sig;
    if (idx < 0) {
      nowCueText.textContent = '（播放头处无字幕）';
      nowCueText.classList.add('on');
      nowCueOverlay.innerHTML = '';
      return;
    }
    var pv = C.cuePreviewHtml(list[idx], state.playheadMs);
    nowCueText.classList.add('on');
    nowCueText.innerHTML = pv.html || esc(list[idx].lines.join(' '));
    nowCueOverlay.innerHTML = pv.html || esc(list[idx].lines.join(' '));
  }

  // ---------- 初始化 ----------
  function init() {
    loadSettings();
    loadSceneCfg();
    updateButtons();
    updateUndoButtons();
    updateSnapButtons();
    updateAnchorButtons();
    updateSceneButtons();
    loopPadBefore.value = state.loop.padBefore;
    loopPadAfter.value = state.loop.padAfter;
    resizeCanvas();
    if (window.ResizeObserver) {
      new ResizeObserver(resizeCanvas).observe(timelineWrap);
      new ResizeObserver(function () { if (!wordPanel.classList.contains('hidden')) { resizeWordRuler(); drawWordRuler(); } })
        .observe(wordRulerWrap);
      new ResizeObserver(function () { if (state.compareOn) resizeCompareCanvas(); }).observe(compareView);
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
