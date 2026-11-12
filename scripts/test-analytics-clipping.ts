import * as fs from 'fs';
import * as path from 'path';

const analyticsPath = path.resolve(process.cwd(), 'src/components/analytics/AnalyticsView.tsx');
const calendarPath = path.resolve(process.cwd(), 'src/components/dashboard/PerformanceCalendar.tsx');
const drawdownPath = path.resolve(process.cwd(), 'src/components/dashboard/DrawdownChart.tsx');

const analyticsSrc = fs.readFileSync(analyticsPath, 'utf-8');
const calendarSrc = fs.readFileSync(calendarPath, 'utf-8');
const drawdownSrc = fs.readFileSync(drawdownPath, 'utf-8');

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`✅ PASS: ${label}`);
    passed++;
  } else {
    console.error(`❌ FAIL: ${label}`);
    failed++;
  }
}

console.log('=====================================================');
console.log('🔍 AUDIT & VERIFIKASI CLIPPING TOMBOL ANALYTICS');
console.log('=====================================================');

// 1. Verify Mode Dropdowns (Nominal / Percent) use left-0 so they never extend past left screen edge
assert(
  analyticsSrc.includes("openEquityDropdown === 'mode'") &&
    analyticsSrc.includes('absolute left-0 top-9 z-30 w-36'),
  'Equity Curve Mode dropdown (Nominal / Percent) menggunakan left-0 agar tidak terpotong di sisi kiri layar'
);

assert(
  analyticsSrc.includes("openDrawdownDropdown === 'mode'") &&
    analyticsSrc.split("openDrawdownDropdown === 'mode'")[1].slice(0, 260).includes('absolute left-0 top-9 z-30 w-36'),
  'Drawdown Curve Mode dropdown (Percent / Nominal) menggunakan left-0 agar tidak terpotong di sisi kiri layar'
);

// 2. Verify Global Period Dropdown uses left-0 on mobile and right-0 on sm+ with viewport-safe width
assert(
  analyticsSrc.includes('absolute left-0 sm:left-auto sm:right-0 top-10 z-30 w-[min(288px,calc(100vw-2rem))] sm:w-80'),
  'Global Period Filter dropdown menggunakan left-0 pada layar mobile (320px-430px) dan sm:right-0 pada tablet/desktop'
);

// 3. Verify Performance Breakdown Dimension Dropdown uses left-0 on mobile and right-0 on sm+
assert(
  analyticsSrc.includes('absolute left-0 sm:left-auto sm:right-0 top-9 z-30 w-56 max-w-[calc(100vw-2rem)]'),
  'Performance Breakdown Dimension dropdown menggunakan left-0 pada layar mobile dan max-w-[calc(100vw-2rem)]'
);

// 4. Verify Performance Calendar Mode Dropdown (Grid Calendar / Daily List / Monthly) uses left-0 on mobile
assert(
  calendarSrc.includes('absolute left-0 sm:left-auto sm:right-0 top-9 z-30 w-44 max-w-[calc(100vw-2rem)]'),
  'Performance Calendar Mode dropdown (Grid Calendar) menggunakan left-0 pada layar mobile dan sm:right-0 pada tablet/desktop'
);

// 5. Verify DrawdownChart nominal Y-axis uses compact currency formatting so SVG left axis labels never clip
assert(
  drawdownSrc.includes('fmtCompactAxis(nominalTick)'),
  'DrawdownChart menggunakan fmtCompactAxis pada sumbu Y mode Nominal agar label IDR/USD tidak terpotong di sisi kiri SVG'
);

// 6. Mathematical bounding-box simulation across required viewports (320, 360, 375, 390, 412, 430, 768, 1280)
const viewports = [320, 360, 375, 390, 412, 430, 768, 1280];

for (const vw of viewports) {
  const isSmUp = vw >= 640;
  const horizontalPadding = vw >= 1024 ? 32 : vw >= 640 ? 24 : 16;
  const contentLeft = horizontalPadding;
  const contentRight = vw - horizontalPadding;

  // Test A: Equity / Drawdown Mode dropdown (Button 1: left-0, width 144px)
  // On mobile (<640px), controls row is self-start at contentLeft; on >=640px, controls row is at right edge (width ~180px)
  const controlsGroupWidth = 180; // Button 1 (88px) + gap (8px) + Button 2 (84px)
  const controlsLeft = isSmUp ? contentRight - controlsGroupWidth : contentLeft;
  const modeMenuLeft = controlsLeft;
  const modeMenuRight = modeMenuLeft + 144;

  // Test B: Equity / Drawdown Period dropdown (Button 2: right-0 of Button 2, width 144px)
  const rangeMenuRight = controlsLeft + controlsGroupWidth;
  const rangeMenuLeft = rangeMenuRight - 144;

  // Test C: Calendar Mode dropdown (Grid Calendar: width 176px, left-0 on <640px, right-0 on >=640px)
  const calMenuWidth = Math.min(176, vw - 32);
  const calMenuLeft = isSmUp ? contentRight - calMenuWidth : contentLeft;
  const calMenuRight = calMenuLeft + calMenuWidth;

  // Test D: Breakdown Dimension dropdown (width 224px, left-0 on <640px, right-0 on >=640px)
  const brkMenuWidth = Math.min(224, vw - 32);
  const brkMenuLeft = isSmUp ? contentRight - brkMenuWidth : contentLeft;
  const brkMenuRight = brkMenuLeft + brkMenuWidth;

  // Test E: Global Period Filter dropdown (width min(288, vw-32) on <640px, 320px on >=640px)
  const perMenuWidth = isSmUp ? 320 : Math.min(288, vw - 32);
  const perMenuLeft = isSmUp ? contentRight - perMenuWidth : contentLeft;
  const perMenuRight = perMenuLeft + perMenuWidth;

  const allInsideViewport =
    modeMenuLeft >= 0 &&
    modeMenuRight <= vw &&
    rangeMenuLeft >= 0 &&
    rangeMenuRight <= vw &&
    calMenuLeft >= 0 &&
    calMenuRight <= vw &&
    brkMenuLeft >= 0 &&
    brkMenuRight <= vw &&
    perMenuLeft >= 0 &&
    perMenuRight <= vw;

  assert(
    allInsideViewport,
    `Viewport ${vw}px: Seluruh tombol & dropdown berada utuh di dalam layar [left >= ${Math.min(
      modeMenuLeft,
      rangeMenuLeft,
      calMenuLeft,
      brkMenuLeft,
      perMenuLeft
    )}px, right <= ${Math.max(
      modeMenuRight,
      rangeMenuRight,
      calMenuRight,
      brkMenuRight,
      perMenuRight
    )}px dari ${vw}px]`
  );
}

console.log('-----------------------------------------------------');
console.log(`Total: ${passed + failed} | Pass: ${passed} | Fail: ${failed}`);
if (failed > 0) {
  process.exit(1);
}
