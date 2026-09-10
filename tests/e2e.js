/* 浏览器端到端验证：载入示例 → 问题定位 → 自动顺延 → 撤销/重做 → 键盘微调 →
 * 搜索 → 拖拽 → 草稿恢复 → 导出。运行：node e2e.js */
'use strict';
const { chromium } = require('playwright-core');

const BASE = 'http://127.0.0.1:8123';
let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  ✓', label); }
  else { failed++; console.error('  ✗ FAIL:', label); }
}

(async () => {
  const browser = await chromium.launch();
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

  // ---- 控制台错误 ----
  const realErrors = errors.filter(e => !e.includes('favicon'));
  ok(realErrors.length === 0, '浏览器无 JS 错误' + (realErrors.length ? '：' + realErrors.join(' | ') : ''));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('E2E 异常：', e); process.exit(1); });
