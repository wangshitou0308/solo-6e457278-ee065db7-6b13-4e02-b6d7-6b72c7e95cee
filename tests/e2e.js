/* 浏览器端到端验证：载入示例 → 问题定位 → 自动顺延 → 撤销/重做 → 键盘微调 →
 * 搜索 → 拖拽 → 草稿恢复 → 导出 → 吸附/单句循环 → 双锚点校时 → 本地媒体对照 →
 * 刷新媒体提示。运行：node e2e.js */
'use strict';
const { chromium } = require('playwright-core');

const BASE = 'http://127.0.0.1:8123';
let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  ✓', label); }
  else { failed++; console.error('  ✗ FAIL:', label); }
}

// 生成测试用 WAV（16-bit 单声道正弦波），Chromium 可直接解码
function makeWav(seconds, freq) {
  const rate = 8000, n = Math.floor(seconds * rate), dataSize = n * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * freq * i / rate) * 12000), 44 + i * 2);
  }
  return buf;
}

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // ---- 1. 首屏自动载入示例 ----
  console.log('1. 首屏与示例载入');
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('#cueTbody tr').length > 0, null, { timeout: 5000 });
  const rowCount = await page.locator('#cueTbody tr').count();
  ok(rowCount === 9, `示例载入 9 条字幕（实际 ${rowCount}）`);
  ok((await page.locator('#fileInfo').textContent()).includes('示例字幕.srt'), '文件信息显示');
  ok(await page.locator('#btnExport').isEnabled(), '导出按钮可用');
  ok(await page.locator('#btnAutoFix').isEnabled(), '自动顺延按钮可用');
  const probText = await page.locator('#problemSummary').textContent();
  ok(/共 \d+ 个问题/.test(probText), '问题汇总显示：' + probText.trim());
  const probCount = await page.locator('#problemList li').count();
  ok(probCount > 0, `问题列表 ${probCount} 条`);

  // ---- 2. 点击问题定位 ----
  console.log('2. 问题定位');
  await page.locator('#problemList li').first().click();
  await page.waitForTimeout(200);
  ok(await page.locator('#cueTbody tr.selected').count() === 1, '点击问题后选中对应字幕行');

  // ---- 3. 时间轴缩放与播放头 ----
  console.log('3. 时间轴');
  const zoomBefore = await page.evaluate(() => window.__dbgView ? window.__dbgView() : null);
  await page.locator('#btnZoomIn').click();
  await page.locator('#btnFit').click();
  ok(true, '缩放/适配按钮无异常');
  await page.locator('#btnPlay').click();
  await page.waitForTimeout(400);
  await page.locator('#btnPlay').click();
  const t1 = await page.locator('#playTime').textContent();
  ok(t1 !== '00:00.0', '播放头前进到 ' + t1);

  // ---- 4. 键盘微调 ----
  console.log('4. 键盘微调');
  await page.locator('#cueTbody tr').nth(1).click();  // 选中第 2 条
  const startBefore = await page.locator('#cueTbody tr').nth(1).locator('input[data-field="start"]').inputValue();
  await page.keyboard.press('ArrowRight');           // +100ms
  await page.waitForTimeout(100);
  const startAfter = await page.locator('#cueTbody tr').nth(1).locator('input[data-field="start"]').inputValue();
  ok(startBefore !== startAfter, `→ 键平移生效（${startBefore} → ${startAfter}）`);
  await page.keyboard.press('[');                     // 起点 -100ms，应还原
  await page.waitForTimeout(100);
  const startBack = await page.locator('#cueTbody tr').nth(1).locator('input[data-field="start"]').inputValue();
  ok(startBack === startBefore, `[ 键起点回退（${startBack}）`);

  // ---- 5. 撤销 / 重做 ----
  console.log('5. 撤销/重做');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(900); // 超过合并窗口
  await page.keyboard.press('ArrowRight');
  const nudged = await page.locator('#cueTbody tr').nth(1).locator('input[data-field="start"]').inputValue();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  const undone = await page.locator('#cueTbody tr').nth(1).locator('input[data-field="start"]').inputValue();
  ok(nudged !== undone, `撤销生效（${nudged} → ${undone}）`);
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(150);
  const redone = await page.locator('#cueTbody tr').nth(1).locator('input[data-field="start"]').inputValue();
  ok(redone === nudged, '重做生效');

  // ---- 6. 自动顺延 + 差异预览 ----
  console.log('6. 自动顺延');
  await page.locator('#btnAutoFix').click();
  await page.waitForTimeout(200);
  ok(await page.locator('#diffModal').isVisible(), '差异预览弹窗出现');
  const diffRows = await page.locator('#diffTbody tr').count();
  ok(diffRows > 0, `差异预览 ${diffRows} 行`);
  ok((await page.locator('#diffTbody tr').first().innerHTML()).includes('→'), '显示修改前 → 后');
  await page.locator('#btnDiffApply').click();
  await page.waitForTimeout(300);
  const afterSummary = await page.locator('#problemSummary').textContent();
  ok(afterSummary.includes('未发现问题'), '顺延应用后问题清零：' + afterSummary.trim());
  // 撤销顺延应恢复问题
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  const backSummary = await page.locator('#problemSummary').textContent();
  ok(/共 \d+ 个问题/.test(backSummary), '撤销顺延后问题恢复');
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(200);

  // ---- 7. 搜索 ----
  console.log('7. 文本搜索');
  await page.locator('#searchInput').fill('时间轴');
  await page.waitForTimeout(200);
  const hitCount = await page.locator('#cueTbody tr.search-hit').count();
  ok(hitCount === 1, `搜索"时间轴"命中 ${hitCount} 行`);
  await page.locator('#searchInput').press('Enter');
  await page.waitForTimeout(200);
  ok(await page.locator('#cueTbody tr.search-cur').count() === 1, '回车跳转到匹配行');
  await page.locator('#searchInput').fill('');
  await page.keyboard.press('Escape');

  // ---- 8. 时间轴拖拽 ----
  console.log('8. 拖拽校时');
  // 重新载入示例，保证干净状态
  await page.locator('#btnSample').click();
  await page.waitForTimeout(400);
  const box = await page.locator('#timeline').boundingBox();
  const dragInfo = await page.evaluate(() => {
    // 从画布状态推算第 1 条字幕的屏幕位置
    const st = window.__state_for_test;
    return null;
  }).catch(() => null);
  // 用行内时间反推像素：第一条 500ms~2800ms，通过 fitAll 后的视图计算
  const pos = await page.evaluate(() => {
    // 暴露内部状态不可行，改从 canvas 直接计算：
    // 视图信息画在 canvas 上，这里通过 DOM 无法获取，故模拟在画布上按像素拖动：
    // 先点击画布中央偏左的色块区域（第一条字幕附近）
    return { w: document.getElementById('timeline').clientWidth };
  });
  // 直接在第一条字幕块上拖动：先 mousedown 在块上，移动 40px，松开
  const startValBefore = await page.locator('#cueTbody tr').first().locator('input[data-field="start"]').inputValue();
  // 第一条字幕块的位置：用 JS 计算时间→像素（视图起点 -900ms 左右，pxPerMs 已知为 w/span）
  const px = await page.evaluate(() => {
    // 从 undo 栈不可达；改为解析第一行输入的时间并复刻 fitAll 的视图计算
    const inp = document.querySelector('#cueTbody tr input[data-field="start"]');
    const end = 23000; // 示例最后一条结束 23s
    const w = document.getElementById('timeline').clientWidth;
    const pad = Math.max(end * 0.04, 500);
    const span = end + pad * 2;
    const pxPerMs = w / span;
    const startMs = -pad;
    const t = 1000; // 第一条字幕中部约 1s 处
    return (t - startMs) * pxPerMs;
  });
  await page.mouse.move(box.x + px, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + px + 40, box.y + 60, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const startValAfter = await page.locator('#cueTbody tr').first().locator('input[data-field="start"]').inputValue();
  ok(startValBefore !== startValAfter, `拖拽整体移动生效（${startValBefore} → ${startValAfter}）`);

  // ---- 9. 草稿保存与恢复 ----
  console.log('9. 草稿恢复');
  await page.waitForTimeout(1200); // 等待自动保存
  const draftInfo = await page.locator('#draftInfo').textContent();
  ok(draftInfo.includes('草稿已保存'), '草稿自动保存：' + draftInfo);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('#cueTbody tr').length > 0, null, { timeout: 5000 });
  await page.waitForTimeout(500);
  ok(await page.locator('#draftBanner').isVisible(), '重新载入后草稿恢复提示出现');
  const restoredStart = await page.locator('#cueTbody tr').first().locator('input[data-field="start"]').inputValue();
  ok(restoredStart === startValBefore, `恢复前显示原始值（${restoredStart}），草稿另存修改`);
  await page.locator('#btnDraftRestore').click();
  await page.waitForTimeout(300);
  const restored = await page.locator('#cueTbody tr').first().locator('input[data-field="start"]').inputValue();
  ok(restored === startValAfter, `恢复草稿后与修改一致（${restored}）`);

  // ---- 10. 导出 ----
  console.log('10. 导出');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    page.locator('#btnExport').click(),
  ]);
  const fname = download.suggestedFilename();
  ok(/示例字幕-calibrated\.srt$/.test(fname), '导出文件名：' + fname);
  const path = await download.path();
  const fs = require('fs');
  const content = fs.readFileSync(path, 'utf-8');
  ok(content.startsWith('1\n00:00:'), '导出内容保持原编号');
  ok(content.includes('欢迎来到字幕节奏校准台'), '导出内容包含文本');
  ok(/\d+\n\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/.test(content), 'SRT 时间格式正确');
  // 导出后草稿应被清除
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('#cueTbody tr').length > 0, null, { timeout: 5000 });
  await page.waitForTimeout(600);
  ok(await page.locator('#draftBanner').isHidden(), '导出后不再提示草稿');

  // ---- 11. 导入 VTT ----
  console.log('11. 导入 WebVTT');
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nVTT 测试一\n\n00:00:03.500 --> 00:00:05.000\nVTT 测试二\n';
  await page.locator('#fileInput').setInputFiles({ name: 'test.vtt', mimeType: 'text/vtt', buffer: Buffer.from(vtt) });
  await page.waitForTimeout(400);
  ok((await page.locator('#fileInfo').textContent()).includes('VTT'), 'VTT 识别成功');
  ok(await page.locator('#cueTbody tr').count() === 2, 'VTT 解析 2 条');
  // 导出为 VTT 保持格式
  const [dl2] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    page.locator('#btnExport').click(),
  ]);
  ok(dl2.suggestedFilename().endsWith('.vtt'), 'VTT 导出扩展名正确');
  const vttOut = fs.readFileSync(await dl2.path(), 'utf-8');
  ok(vttOut.startsWith('WEBVTT'), 'VTT 导出保留头部');

  // ---- 12. 吸附校时与单句循环（模拟播放头） ----
  console.log('12. 吸附校时');
  await page.locator('#btnSample').click();
  await page.waitForTimeout(400);
  if (await page.locator('#draftBanner').isVisible()) await page.locator('#btnDraftDismiss').click();
  // 未选中字幕时开启单句循环应回弹
  await page.locator('#loopCueChk').click();
  await page.waitForTimeout(100);
  ok(!(await page.locator('#loopCueChk').isChecked()), '未选中字幕时单句循环回弹');

  // 视图复位后按时间点击标尺定位播放头（复刻 fitAll 的视图计算）
  async function docEndMs() {
    return await page.evaluate(() => {
      const rows = document.querySelectorAll('#cueTbody tr');
      const v = rows[rows.length - 1].querySelector('input[data-field="end"]').value;
      const m = v.match(/(\d+):(\d+):(\d+),(\d+)/);
      return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4];
    });
  }
  async function setPlayhead(t) {
    await page.locator('#btnFit').click();
    await page.waitForTimeout(80);
    const box = await page.locator('#timeline').boundingBox();
    const end = await docEndMs();
    const pad = Math.max(end * 0.04, 500);
    const x = (t + pad) * (box.width / (end + pad * 2));
    await page.mouse.click(box.x + x, box.y + 10);
    await page.waitForTimeout(80);
  }
  async function rowTime(row, field) {
    const v = await page.locator('#cueTbody tr').nth(row).locator(`input[data-field="${field}"]`).inputValue();
    const m = v.match(/(\d+):(\d+):(\d+),(\d+)/);
    return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4];
  }

  await page.locator('#cueTbody tr').nth(1).click();   // 选中第 2 条（2850–3000）
  await setPlayhead(2500);
  await page.locator('#btnSnapStart').click();
  const snappedStart = await rowTime(1, 'start');
  ok(Math.abs(snappedStart - 2500) < 120, `起点吸附到播放头（${snappedStart} ≈ 2500）`);
  await page.waitForTimeout(900);   // 超过撤销合并窗口
  await setPlayhead(5000);
  await page.locator('#btnSnapEnd').click();
  const snappedEnd = await rowTime(1, 'end');
  ok(Math.abs(snappedEnd - 5000) < 120, `终点吸附到播放头（${snappedEnd} ≈ 5000）`);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  ok(Math.abs((await rowTime(1, 'end')) - 3000) < 2, '撤销终点吸附');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  ok(Math.abs((await rowTime(1, 'start')) - 2850) < 2, '撤销起点吸附');
  // 快捷键吸附
  await page.waitForTimeout(900);
  await setPlayhead(2500);
  await page.keyboard.press(',');
  await page.waitForTimeout(120);
  ok(Math.abs((await rowTime(1, 'start')) - 2500) < 120, '快捷键 , 吸附起点');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);

  // ---- 13. 单句循环（模拟模式） ----
  console.log('13. 单句循环');
  await page.locator('#cueTbody tr').first().click();  // 第 1 条 500–2800，循环区间 200–3300
  await page.locator('#loopCueChk').click();
  await page.waitForTimeout(100);
  ok(await page.locator('#loopCueChk').isChecked(), '选中后可开启单句循环');
  ok((await page.locator('#btnPlay').textContent()).includes('暂停'), '循环开启后自动播放');
  await page.waitForTimeout(600);
  const loopTime = await page.locator('#playTime').textContent();
  ok(loopTime !== '00:00.0', '循环播放中（' + loopTime + '）');
  await page.locator('#loopCueChk').click();
  await page.locator('#btnPlay').click();   // 停止
  await page.waitForTimeout(100);

  // ---- 14. 双锚点整体校时 ----
  console.log('14. 双锚点整体校时');
  await page.locator('#btnAnchorSync').click();
  await page.waitForTimeout(150);
  ok(await page.locator('#anchorModal').isVisible(), '校时弹窗打开');
  ok((await page.locator('#anchorError').textContent()).includes('还需记录锚点'), '提示缺少锚点');
  ok(await page.locator('#btnAnchorApply').isDisabled(), '缺锚点时应用禁用');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  // 锚点①：第 1 条起点 500 → 播放头 1500
  await page.locator('#cueTbody tr').first().click();
  await setPlayhead(1500);
  await page.locator('#btnMarkA1').click();
  ok((await page.locator('#statusMsg').textContent()).includes('锚点①'), '记录锚点①');
  // 锚点②与①为同一条字幕 → 原时间相同 → 冲突
  await setPlayhead(2500);
  await page.locator('#btnMarkA2').click();
  await page.locator('#btnAnchorSync').click();
  await page.waitForTimeout(150);
  ok((await page.locator('#anchorError').textContent()).includes('锚点冲突'), '原时间相同报锚点冲突');
  ok(await page.locator('#btnAnchorApply').isDisabled(), '冲突时应用禁用');
  await page.locator('#btnClearA2').click();
  await page.waitForTimeout(100);
  ok((await page.locator('#anchorError').textContent()).includes('还需记录锚点②'), '清除锚点②后提示缺少');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  // 正常：锚点② = 第 3 条起点 2950 → 播放头 4000（整体约 +1000ms 并轻微伸缩）
  await page.locator('#cueTbody tr').nth(2).click();
  await setPlayhead(4000);
  await page.locator('#btnMarkA2').click();
  await page.locator('#btnAnchorSync').click();
  await page.waitForTimeout(150);
  const formula = await page.locator('#anchorFormula').textContent();
  ok(/伸缩 ×1\.\d+/.test(formula) && formula.includes('偏移'), '显示变换公式：' + formula.trim());
  const syncRows = await page.locator('#anchorDiffTbody tr').count();
  ok(syncRows === 9, `预览全部 9 条差异（实际 ${syncRows}）`);
  ok(await page.locator('#btnAnchorApply').isEnabled(), '应用按钮可用');
  await page.locator('#btnAnchorApply').click();
  await page.waitForTimeout(300);
  const synced = await rowTime(0, 'start');
  ok(Math.abs(synced - 1500) < 150, `锚点校时应用（第 1 条 ${synced} ≈ 1500）`);
  ok((await page.locator('#statusMsg').textContent()).includes('双锚点校时'), '状态提示已应用');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  ok((await rowTime(0, 'start')) === 500, '撤销锚点校时恢复原时间');
  // 负时间：锚点 2850→0 与 2950→100 使第 1 条变为负
  await page.locator('#cueTbody tr').nth(1).click();
  await setPlayhead(0);
  await page.locator('#btnMarkA1').click();
  await page.locator('#cueTbody tr').nth(2).click();
  await setPlayhead(100);
  await page.locator('#btnMarkA2').click();
  await page.locator('#btnAnchorSync').click();
  await page.waitForTimeout(150);
  ok((await page.locator('#anchorError').textContent()).includes('负时间'), '产生负时间时禁止并说明');
  ok(await page.locator('#btnAnchorApply').isDisabled(), '负时间时应用禁用');
  await page.locator('#btnClearA1').click();
  await page.locator('#btnClearA2').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);

  // ---- 15. 本地媒体对照（WAV 对象 URL） ----
  console.log('15. 本地媒体对照');
  await page.locator('#mediaInput').setInputFiles({ name: 'test-tone.wav', mimeType: 'audio/wav', buffer: makeWav(4, 440) });
  await page.waitForFunction(
    () => document.getElementById('mediaState').textContent.includes('test-tone.wav'), null, { timeout: 5000 });
  ok(true, '媒体载入并显示文件名');
  ok(await page.locator('#mediaBox').isVisible(), '媒体区显示');
  ok(await page.locator('#audioBadge').isVisible(), '音频标识显示');
  const clock = await page.locator('#mediaClock').textContent();
  ok(clock.includes('/ 00:04.0'), '媒体时长显示：' + clock.trim());
  await page.locator('#btnPlay').click();
  await page.waitForTimeout(700);
  const mt = await page.locator('#playTime').textContent();
  ok(mt !== '00:00.0', '媒体驱动播放头（' + mt + '）');
  await page.locator('#btnPlay').click();
  await setPlayhead(2000);
  const mediaPos = await page.evaluate(() => document.getElementById('mediaVideo').currentTime);
  ok(Math.abs(mediaPos - 2) < 0.3, '播放头定位媒体（' + mediaPos.toFixed(2) + 's ≈ 2s）');
  await page.locator('#mediaRate').selectOption('2');
  const rate = await page.evaluate(() => document.getElementById('mediaVideo').playbackRate);
  ok(rate === 2, '倍速作用于媒体元素');
  await page.locator('#mediaRate').selectOption('1');

  // ---- 16. 刷新后提示重新选择媒体 ----
  console.log('16. 刷新媒体提示');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('#cueTbody tr').length > 0, null, { timeout: 5000 });
  await page.waitForTimeout(400);
  ok(await page.locator('#mediaBanner').isVisible(), '刷新后提示重新选择媒体');
  ok((await page.locator('#mediaState').textContent()).includes('模拟播放头'), '刷新后回到模拟播放头');
  ok(await page.locator('#draftBanner').isVisible(), '字幕草稿提示仍独立存在');
  await page.locator('#btnMediaDismiss').click();
  await page.waitForTimeout(100);
  ok(await page.locator('#mediaBanner').isHidden(), '关闭媒体提示');
  await page.locator('#btnDraftDismiss').click();   // 清理草稿，避免影响后续运行
  await page.waitForTimeout(200);

  // ---- 17. 分行规则检查 ----
  console.log('17. 分行规则检查');
  await page.locator('#btnSample').click();
  await page.waitForTimeout(400);
  if (await page.locator('#draftBanner').isVisible()) await page.locator('#btnDraftDismiss').click();
  ok(await page.locator('#setMaxChars').inputValue() === '18', '默认每行 18 字');
  ok(await page.locator('#setMaxLines').inputValue() === '2', '默认最多 2 行');
  const layoutSummary = await page.locator('#problemSummary').textContent();
  ok(/超长行/.test(layoutSummary), '汇总出现超长行徽章：' + layoutSummary.trim().slice(0, 80));
  const longItems = await page.locator('#problemList li').filter({ hasText: '超过每行' }).count();
  ok(longItems > 0, `问题列表列出超长行（${longItems} 条）`);
  // 点击分行问题可定位
  await page.locator('#problemList li').filter({ hasText: '超过每行' }).first().click();
  await page.waitForTimeout(150);
  ok(await page.locator('#cueTbody tr.selected').count() === 1, '点击分行问题定位到字幕');
  // 调宽每行字数后问题消失（设置持久化）
  await page.locator('#setMaxChars').fill('40');
  await page.locator('#setMaxChars').dispatchEvent('change');
  await page.waitForTimeout(150);
  const looseSummary = await page.locator('#problemSummary').textContent();
  ok(!/超长行/.test(looseSummary), '放宽每行字数后超长行消失');
  await page.locator('#setMaxChars').fill('18');
  await page.locator('#setMaxChars').dispatchEvent('change');
  await page.waitForTimeout(150);

  // ---- 18. 单条智能分行 ----
  console.log('18. 单条智能分行');
  const taRow = page.locator('#cueTbody tr').nth(3);   // 示例第 4 条为长句
  const taBefore = await taRow.locator('textarea').inputValue();
  await taRow.locator('.op-rewrap').click();
  await page.waitForTimeout(200);
  const taAfter = await taRow.locator('textarea').inputValue();
  ok(taAfter !== taBefore && taAfter.includes('\n'), '智能分行产生换行：' + JSON.stringify(taAfter));
  const rwLines = taAfter.split('\n');
  ok(rwLines.length <= 2, '不超过最多 2 行');
  ok(rwLines.every(l => Array.from(l).length <= 18), '每行不超过 18 字');
  ok(taAfter.replace(/\n/g, '') === taBefore.replace(/\n/g, ''), '分行不删字');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  ok((await taRow.locator('textarea').inputValue()) === taBefore, '撤销智能分行');
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(150);

  // ---- 19. 光标拆分（播放头在区间外 → 按字符比例） ----
  console.log('19. 拆分');
  const n0 = await page.locator('#cueTbody tr').count();
  await page.evaluate(() => {
    const ta = document.querySelectorAll('#cueTbody tr')[0].querySelector('textarea');
    ta.focus(); ta.setSelectionRange(4, 4);  // 「欢迎来到」|「字幕节奏校准台」
  });
  await page.locator('#cueTbody tr').nth(0).locator('.op-split').click();
  await page.waitForTimeout(200);
  ok(await page.locator('#cueTbody tr').count() === n0 + 1, '拆分后条数 +1');
  const splitTexts = await page.$$eval('#cueTbody tr', trs =>
    trs.slice(0, 2).map(tr => tr.querySelector('textarea').value));
  ok(splitTexts[0] === '欢迎来到' && splitTexts[1] === '字幕节奏校准台',
    '按光标拆分文本：' + JSON.stringify(splitTexts));
  const splitEnd = await page.locator('#cueTbody tr').nth(0).locator('input[data-field="end"]').inputValue();
  const splitStart = await page.locator('#cueTbody tr').nth(1).locator('input[data-field="start"]').inputValue();
  ok(splitEnd === splitStart, '分界时间连续：' + splitEnd);
  // 500~2800，4:7 → 500+2300*4/11 = 1336
  ok(splitEnd === '00:00:01,336', '按有效字符比例分配（≈1336ms）：' + splitEnd);
  const splitNums = await page.$$eval('#cueTbody tr .c-num', els => els.slice(0, 3).map(e => e.textContent));
  ok(splitNums.join(',') === '1,2,3', 'SRT 编号重排：' + splitNums.join(','));
  // 光标在文本开头 → 拒绝
  const nRefuse = await page.locator('#cueTbody tr').count();
  await page.evaluate(() => {
    const ta = document.querySelectorAll('#cueTbody tr')[0].querySelector('textarea');
    ta.focus(); ta.setSelectionRange(0, 0);
  });
  await page.locator('#cueTbody tr').nth(0).locator('.op-split').click();
  await page.waitForTimeout(150);
  ok(await page.locator('#cueTbody tr').count() === nRefuse, '光标在开头不拆分');
  ok((await page.locator('#statusMsg').textContent()).includes('均需要有文本'), '状态栏说明拆分原因');
  // Ctrl+Enter 快捷键
  await page.evaluate(() => {
    const ta = document.querySelectorAll('#cueTbody tr')[0].querySelector('textarea');
    ta.focus(); ta.setSelectionRange(2, 2);
  });
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(150);
  ok(await page.locator('#cueTbody tr').count() === nRefuse + 1, 'Ctrl+Enter 快捷拆分');
  // 撤销全部拆分
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);

  // ---- 20. 播放头在区间内时以播放头为界 ----
  console.log('20. 播放头为界拆分');
  await page.locator('#cueTbody tr').nth(0).click();
  await setPlayhead(2000);   // 第 1 条 500~2800 区间内
  await page.evaluate(() => {
    const ta = document.querySelectorAll('#cueTbody tr')[0].querySelector('textarea');
    ta.focus(); ta.setSelectionRange(4, 4);
  });
  await page.locator('#cueTbody tr').nth(0).locator('.op-split').click();
  await page.waitForTimeout(200);
  const headEnd = await page.locator('#cueTbody tr').nth(0).locator('input[data-field="end"]').inputValue();
  const headStart = await page.locator('#cueTbody tr').nth(1).locator('input[data-field="start"]').inputValue();
  ok(headEnd === '00:00:02,000' && headStart === '00:00:02,000', '播放头为界（02,000）：' + headEnd);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);

  // ---- 21. 合并相邻字幕 ----
  console.log('21. 合并');
  const nMerge = await page.locator('#cueTbody tr').count();
  const mergeTimes = await page.$$eval('#cueTbody tr', trs => [
    trs[0].querySelector('input[data-field="start"]').value,
    trs[1].querySelector('input[data-field="end"]').value,
  ]);
  await page.locator('#cueTbody tr').nth(0).locator('.op-merge').click();
  await page.waitForTimeout(200);
  ok(await page.locator('#cueTbody tr').count() === nMerge - 1, '合并后条数 -1');
  const mergedText = await page.locator('#cueTbody tr').nth(0).locator('textarea').inputValue();
  ok(mergedText.includes('\n'), '合并文本含两行：' + JSON.stringify(mergedText));
  const mergedRange = await page.$$eval('#cueTbody tr', trs => [
    trs[0].querySelector('input[data-field="start"]').value,
    trs[0].querySelector('input[data-field="end"]').value,
  ]);
  ok(mergedRange[0] === mergeTimes[0] && mergedRange[1] === mergeTimes[1],
    '合并时间覆盖原区间：' + mergedRange.join(' ~ '));
  const mergeNums = await page.$$eval('#cueTbody tr .c-num', els => els.slice(0, 3).map(e => e.textContent));
  ok(mergeNums.join(',') === '1,2,3', '合并后编号重排：' + mergeNums.join(','));
  ok(await page.locator('#cueTbody tr').last().locator('.op-merge').isDisabled(), '最后一条合并按钮禁用');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  ok(await page.locator('#cueTbody tr').count() === nMerge, '撤销合并');

  // ---- 22. 批量重排预览 ----
  console.log('22. 批量智能分行');
  await page.locator('#btnRewrapAll').click();
  await page.waitForTimeout(200);
  ok(await page.locator('#rewrapModal').isVisible(), '批量重排预览出现');
  const rwSummary = await page.locator('#rewrapSummary').textContent();
  ok(/每行 18 字、最多 2 行/.test(rwSummary) && /将重排 \d+ 条/.test(rwSummary),
    '预览汇总说明规则：' + rwSummary.trim().slice(0, 80));
  const totalRows = await page.locator('#rewrapTbody tr').count();
  ok(totalRows === 9, `预览覆盖全部 9 条（实际 ${totalRows}）`);
  ok(await page.locator('#btnRewrapApply').isEnabled(), '存在变更时应用按钮可用');
  const changed = await page.locator('#rewrapTbody tr .st-ok').count();
  ok(changed > 0, `标记 ${changed} 条将重排`);
  await page.locator('#btnRewrapApply').click();
  await page.waitForTimeout(300);
  ok(await page.locator('#rewrapModal').isHidden(), '应用后关闭预览');
  const afterLayout = await page.locator('#problemSummary').textContent();
  ok(!/超长行|超行数/.test(afterLayout), '应用后无超长行/超行数：' + afterLayout.trim().slice(0, 80));
  // 草稿自动保存（接入既有草稿流程）
  await page.waitForTimeout(1200);
  ok((await page.locator('#draftInfo').textContent()).includes('草稿已保存'), '重排后自动保存草稿');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  ok(/超长行/.test(await page.locator('#problemSummary').textContent()), '撤销批量重排恢复问题');
  // 取消不修改
  await page.locator('#btnRewrapAll').click();
  await page.waitForTimeout(200);
  await page.locator('#btnRewrapCancel').click();
  await page.waitForTimeout(100);
  ok(await page.locator('#rewrapModal').isHidden(), '取消关闭预览');

  // ---- 23. 无法满足限制时说明原因且不删字 ----
  console.log('23. 无法分行的原因');
  const vttLong = [
    'WEBVTT', '',
    '00:00:01.000 --> 00:00:03.000',
    'hello superlongincomprehensibleword',
    '',
  ].join('\n');
  await page.locator('#fileInput').setInputFiles({ name: 'long.vtt', mimeType: 'text/vtt', buffer: Buffer.from(vttLong) });
  await page.waitForTimeout(300);
  await page.locator('#cueTbody tr').nth(0).locator('.op-rewrap').click();
  await page.waitForTimeout(150);
  const failStatus = await page.locator('#statusMsg').textContent();
  ok(/英文单词/.test(failStatus) && /无法分行|不能拆开/.test(failStatus), '超长单词说明原因：' + failStatus);
  const taKept = await page.locator('#cueTbody tr').nth(0).locator('textarea').inputValue();
  ok(taKept === 'hello superlongincomprehensibleword', '失败时不删字不改写');
  await page.locator('#btnRewrapAll').click();
  await page.waitForTimeout(200);
  const failCell = await page.locator('#rewrapTbody tr.rw-fail .rt-err').first().textContent();
  ok(/英文单词/.test(failCell), '批量预览列出失败原因：' + failCell);
  await page.locator('#btnRewrapCancel').click();

  // ---- 24. VTT 拆分的 cue 标识与设置 ----
  console.log('24. VTT 标识与设置');
  const vttCue = [
    'WEBVTT', '',
    'intro-cue',
    '00:00:01.000 --> 00:00:05.000 align:start position:20%',
    '你好世界内容拆分测试文字',
    '',
  ].join('\n');
  await page.locator('#fileInput').setInputFiles({ name: 'cue.vtt', mimeType: 'text/vtt', buffer: Buffer.from(vttCue) });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const ta = document.querySelectorAll('#cueTbody tr')[0].querySelector('textarea');
    ta.focus(); ta.setSelectionRange(4, 4);
  });
  await page.locator('#cueTbody tr').nth(0).locator('.op-split').click();
  await page.waitForTimeout(200);
  ok(await page.locator('#cueTbody tr').count() === 2, 'VTT 拆分成功');
  const [dlVtt] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    page.locator('#btnExport').click(),
  ]);
  const splitVttOut = fs.readFileSync(await dlVtt.path(), 'utf-8');
  ok(splitVttOut.startsWith('WEBVTT'), 'VTT 导出保留头部');
  ok(splitVttOut.includes('intro-cue\n00:00:01.000 -->'), '前段保留 cue 标识符');
  ok((splitVttOut.match(/align:start position:20%/g) || []).length === 2,
    '前后两段均保留 cue 设置');
  ok(!/^2$/m.test(splitVttOut.split('intro-cue')[1] || ''), '后段不写入自动编号');

  // ---- 控制台错误 ----
  const realErrors = errors.filter(e => !e.includes('favicon'));
  ok(realErrors.length === 0, '浏览器无 JS 错误' + (realErrors.length ? '：' + realErrors.join(' | ') : ''));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('E2E 异常：', e); process.exit(1); });
