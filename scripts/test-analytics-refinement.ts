import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  calculatePerformance,
  computeDrawdownCurveSeries,
} from '../src/utils/calculations';
import { DEFAULT_SETTINGS, AppSettings } from '../src/types/settings';
import { Trade } from '../src/types/trade';
import {
  resolveEquityCurvePointAtClientX,
  buildSmoothSvgPath,
  computeDynamicChartTooltipPlacement,
} from '../src/components/dashboard/EquityChart';
import { resolveDrawdownInteractionState } from '../src/components/dashboard/DrawdownChart';

console.log('=====================================================');
console.log('TRADEVAULT — ANALYTICS UI REFINEMENT VERIFICATION SUITE');
console.log('TVES-Governed Acceptance & Visual Integrity Testing');
console.log('=====================================================\n');

let passedCount = 0;
let totalCount = 0;

function test(id: string, description: string, fn: () => void) {
  totalCount++;
  try {
    fn();
    passedCount++;
    console.log(`✅ PASS [${id}] ${description}`);
  } catch (err: any) {
    console.error(`❌ FAIL [${id}] ${description}`);
    console.error(`   Error: ${err?.message || err}`);
  }
}

const analyticsSrc = fs.readFileSync(path.resolve('src/components/analytics/AnalyticsView.tsx'), 'utf-8');
const radarSrc = fs.readFileSync(path.resolve('src/components/dashboard/RadarChart.tsx'), 'utf-8');
const drawdownSrc = fs.readFileSync(path.resolve('src/components/dashboard/DrawdownChart.tsx'), 'utf-8');
const equitySrc = fs.readFileSync(path.resolve('src/components/dashboard/EquityChart.tsx'), 'utf-8');

const stdSettings: AppSettings = {
  ...DEFAULT_SETTINGS,
  startingBalance: 10000,
  currency: 'USD',
  currencySymbol: '$',
};

// ============================================================================
// PART 1: PERFORMANCE PROFILE — 6 PILLARS VERIFICATION
// ============================================================================

test('PP-01', 'Performance Profile menampilkan kembali 6 Pillars Performance Profile (RadarChart + 6 Pilar Resmi)', () => {
  assert.ok(analyticsSrc.includes('Performance Profile'), 'Must render Section 2 heading');
  assert.ok(analyticsSrc.includes('<RadarChart'), 'Must render 6 Pillars RadarChart');
  const requiredPillars = [
    'Win Rate',
    'Profit Factor',
    'Average RR',
    'Expectancy',
    'Risk Control',
    'Consistency',
  ];
  for (const pillar of requiredPillars) {
    assert.ok(analyticsSrc.includes(`name: '${pillar}'`), `AnalyticsView must include pillar: ${pillar}`);
  }
  assert.ok(radarSrc.includes("label: 'Win Rate'"), 'RadarChart axis 1: Win Rate');
  assert.ok(radarSrc.includes("label: 'Profit Factor'"), 'RadarChart axis 2: Profit Factor');
  assert.ok(radarSrc.includes("label: 'Avg RR'"), 'RadarChart axis 3: Avg RR');
  assert.ok(radarSrc.includes("label: 'Expectancy'"), 'RadarChart axis 4: Expectancy');
  assert.ok(radarSrc.includes("label: 'Risk Control'"), 'RadarChart axis 5: Risk Control');
  assert.ok(radarSrc.includes("label: 'Consistency'"), 'RadarChart axis 6: Consistency');
});

test('PP-02', 'Kondisi data belum cukup (< 3 transaksi) ditangani secara jujur tanpa skor palsu', () => {
  // 0 trades
  const perf0 = calculatePerformance([], stdSettings);
  assert.strictEqual(perf0.radarIndicators.isDataSufficient, false);
  assert.strictEqual(perf0.radarIndicators.winRateScore, 0);
  assert.strictEqual(perf0.radarIndicators.profitFactorScore, 0);
  assert.strictEqual(perf0.radarIndicators.rewardRiskScore, 0);
  assert.strictEqual(perf0.radarIndicators.expectancyScore, 0);
  assert.strictEqual(perf0.radarIndicators.riskControlScore, 0);
  assert.strictEqual(perf0.radarIndicators.consistencyScore, 0);

  // 2 trades (< 3 threshold)
  const twoTrades: Trade[] = [
    {
      id: 'PP-T1',
      dateTime: '2026-10-01T10:00',
      instrument: 'XAUUSD',
      position: 'BUY',
      strategy: 'Breakout',
      entryPrice: 2700,
      lotSize: 0.1,
      riskAmount: 100,
      riskPercentage: 1,
      outcome: 'WIN',
      grossProfit: 200,
      commission: 0,
      swap: 0,
      netProfit: 200,
    },
    {
      id: 'PP-T2',
      dateTime: '2026-10-02T10:00',
      instrument: 'XAUUSD',
      position: 'BUY',
      strategy: 'Breakout',
      entryPrice: 2710,
      lotSize: 0.1,
      riskAmount: 100,
      riskPercentage: 1,
      outcome: 'WIN',
      grossProfit: 150,
      commission: 0,
      swap: 0,
      netProfit: 150,
    },
  ];
  const perf2 = calculatePerformance(twoTrades, stdSettings);
  assert.strictEqual(perf2.radarIndicators.isDataSufficient, false, '2 trades must be marked insufficient');
  assert.strictEqual(perf2.radarIndicators.riskControlScore, 0, 'Must not return fake 100 Risk Control score when < 3 trades');
  assert.strictEqual(perf2.radarIndicators.consistencyScore, 0, 'Must not return fake 100 Consistency score when < 3 trades');
  assert.ok(analyticsSrc.includes('Data Belum Cukup'), 'UI must display honest Data Belum Cukup status');
});

test('PP-03', 'Formula 6 Pilar (Win Rate, Profit Factor, Average RR, Expectancy, Risk Control, Consistency) akurat pada data aktual (>= 3 trade)', () => {
  const fourTrades: Trade[] = [
    {
      id: 'PP4-1',
      dateTime: '2026-10-01T10:00',
      instrument: 'XAUUSD',
      position: 'BUY',
      strategy: 'S1',
      entryPrice: 2700,
      lotSize: 0.1,
      riskAmount: 100,
      riskPercentage: 1,
      outcome: 'WIN',
      grossProfit: 200,
      commission: 0,
      swap: 0,
      netProfit: 200, // +2R, Day 1 (+200)
    },
    {
      id: 'PP4-2',
      dateTime: '2026-10-02T10:00',
      instrument: 'XAUUSD',
      position: 'SELL',
      strategy: 'S1',
      entryPrice: 2710,
      lotSize: 0.1,
      riskAmount: 100,
      riskPercentage: 1,
      outcome: 'LOSS',
      grossProfit: -100,
      commission: 0,
      swap: 0,
      netProfit: -100, // -1R, Day 2 (-100), DD: 100 / 10200 = 0.98%
    },
    {
      id: 'PP4-3',
      dateTime: '2026-10-03T10:00',
      instrument: 'XAUUSD',
      position: 'BUY',
      strategy: 'S1',
      entryPrice: 2705,
      lotSize: 0.1,
      riskAmount: 100,
      riskPercentage: 1,
      outcome: 'WIN',
      grossProfit: 300,
      commission: 0,
      swap: 0,
      netProfit: 300, // +3R, Day 3 (+300)
    },
    {
      id: 'PP4-4',
      dateTime: '2026-10-04T10:00',
      instrument: 'XAUUSD',
      position: 'BUY',
      strategy: 'S1',
      entryPrice: 2720,
      lotSize: 0.1,
      riskAmount: 100,
      riskPercentage: 1,
      outcome: 'WIN',
      grossProfit: 200,
      commission: 0,
      swap: 0,
      netProfit: 200, // +2R, Day 4 (+200)
    },
  ];
  const perf4 = calculatePerformance(fourTrades, stdSettings);
  assert.strictEqual(perf4.radarIndicators.isDataSufficient, true);
  // Win Rate = 3/4 = 75% -> score 100
  assert.strictEqual(perf4.metrics.winRate, 75);
  assert.strictEqual(perf4.radarIndicators.winRateScore, 100);
  // Profit Factor = 700 / 100 = 7.0 -> score 100
  assert.strictEqual(perf4.metrics.profitFactor, 7);
  assert.strictEqual(perf4.radarIndicators.profitFactorScore, 100);
  // Average RR = (+2 - 1 + 3 + 2) / 4 = +1.50R -> score 93
  assert.strictEqual(perf4.metrics.averageRiskReward, 1.5);
  assert.strictEqual(perf4.radarIndicators.rewardRiskScore, 93);
  // Expectancy = $600 / 4 = $150 (1.5% of $10,000) -> score 100
  assert.strictEqual(perf4.metrics.expectancy, 150);
  assert.strictEqual(perf4.radarIndicators.expectancyScore, 100);
  // Risk Control: Max DD = 0.98% (<= 5%) -> score 97
  assert.strictEqual(perf4.metrics.maxDrawdownPercent, 0.98);
  assert.strictEqual(perf4.radarIndicators.riskControlScore, 97);
  // Consistency: 3 profitable days out of 4 active days = 75%
  assert.strictEqual(perf4.radarIndicators.consistencyScore, 75);
});

// ============================================================================
// PART 2: DRAWDOWN ANALYSIS — CALCULATION & SMOOTH CURVE VERIFICATION
// ============================================================================

test('DD-01', 'Ekuitas terus naik -> Peak Equity terus diperbarui dan Drawdown selalu 0 (0.00% & $0)', () => {
  const risingTrades: Trade[] = [
    { id: 'R-1', dateTime: '2026-10-01T10:00', instrument: 'XAUUSD', position: 'BUY', strategy: 'S', entryPrice: 2700, lotSize: 0.1, riskAmount: 100, riskPercentage: 1, outcome: 'WIN', grossProfit: 500, commission: 0, swap: 0, netProfit: 500 },
    { id: 'R-2', dateTime: '2026-10-02T10:00', instrument: 'XAUUSD', position: 'BUY', strategy: 'S', entryPrice: 2710, lotSize: 0.1, riskAmount: 100, riskPercentage: 1, outcome: 'WIN', grossProfit: 700, commission: 0, swap: 0, netProfit: 700 },
    { id: 'R-3', dateTime: '2026-10-03T10:00', instrument: 'XAUUSD', position: 'BUY', strategy: 'S', entryPrice: 2720, lotSize: 0.1, riskAmount: 100, riskPercentage: 1, outcome: 'WIN', grossProfit: 300, commission: 0, swap: 0, netProfit: 300 },
  ];
  const perf = calculatePerformance(risingTrades, stdSettings);
  const ddSeries = computeDrawdownCurveSeries(perf.equityCurve, stdSettings);

  assert.strictEqual(ddSeries.maxDrawdownAmount, 0);
  assert.strictEqual(ddSeries.maxDrawdownPercent, 0);
  assert.deepStrictEqual(
    ddSeries.safeCurve.map((pt) => pt.peak),
    [10000, 10500, 11200, 11500]
  );
  assert.deepStrictEqual(
    ddSeries.safeCurve.map((pt) => pt.drawdownAmount),
    [0, 0, 0, 0]
  );
  assert.deepStrictEqual(
    ddSeries.safeCurve.map((pt) => pt.drawdownPercent),
    [0, 0, 0, 0]
  );
});

test('DD-02', 'Ekuitas turun dari puncak lalu pulih ke puncak baru -> Drawdown nominal & persentase akurat dan kembali ke 0 saat ATH baru', () => {
  // Start: $10,000 (Peak $10,000, DD $0 / 0%)
  // T1: +$2,000 -> Equity $12,000 (Peak $12,000, DD $0 / 0%)
  // T2: -$1,500 -> Equity $10,500 (Peak $12,000, DD $1,500 / 12.50%)
  // T3: -$1,500 -> Equity $9,000  (Peak $12,000, DD $3,000 / 25.00%)
  // T4: +$4,000 -> Equity $13,000 (Peak $13,000, DD $0 / 0%)
  const cycleTrades: Trade[] = [
    { id: 'C-1', dateTime: '2026-10-01T10:00', instrument: 'XAUUSD', position: 'BUY', strategy: 'S', entryPrice: 2700, lotSize: 0.5, riskAmount: 200, riskPercentage: 2, outcome: 'WIN', grossProfit: 2000, commission: 0, swap: 0, netProfit: 2000 },
    { id: 'C-2', dateTime: '2026-10-02T10:00', instrument: 'XAUUSD', position: 'SELL', strategy: 'S', entryPrice: 2720, lotSize: 0.5, riskAmount: 200, riskPercentage: 2, outcome: 'LOSS', grossProfit: -1500, commission: 0, swap: 0, netProfit: -1500 },
    { id: 'C-3', dateTime: '2026-10-03T10:00', instrument: 'XAUUSD', position: 'SELL', strategy: 'S', entryPrice: 2730, lotSize: 0.5, riskAmount: 200, riskPercentage: 2, outcome: 'LOSS', grossProfit: -1500, commission: 0, swap: 0, netProfit: -1500 },
    { id: 'C-4', dateTime: '2026-10-04T10:00', instrument: 'XAUUSD', position: 'BUY', strategy: 'S', entryPrice: 2700, lotSize: 0.5, riskAmount: 200, riskPercentage: 2, outcome: 'WIN', grossProfit: 4000, commission: 0, swap: 0, netProfit: 4000 },
  ];
  const perf = calculatePerformance(cycleTrades, stdSettings);
  const ddSeries = computeDrawdownCurveSeries(perf.equityCurve, stdSettings);

  assert.strictEqual(ddSeries.maxDrawdownAmount, 3000);
  assert.strictEqual(ddSeries.maxDrawdownPercent, 25);
  assert.deepStrictEqual(
    ddSeries.safeCurve.map((pt) => pt.peak),
    [10000, 12000, 12000, 12000, 13000]
  );
  assert.deepStrictEqual(
    ddSeries.safeCurve.map((pt) => pt.drawdownAmount),
    [0, 0, 1500, 3000, 0]
  );
  assert.deepStrictEqual(
    ddSeries.safeCurve.map((pt) => pt.drawdownPercent),
    [0, 0, 12.5, 25, 0]
  );
});

test('DD-03', 'Keamanan kondisi data kosong dan saldo awal 0 / negatif tanpa NaN atau Infinity', () => {
  // Empty curve
  const emptySeries = computeDrawdownCurveSeries([], stdSettings);
  assert.strictEqual(emptySeries.hasExecutedTrades, false);
  assert.strictEqual(emptySeries.maxDrawdownPercent, 0);
  assert.strictEqual(emptySeries.maxDrawdownAmount, 0);
  assert.ok(emptySeries.tickValues.every((v) => Number.isFinite(v)));

  // Zero starting balance with losing trade
  const zeroBalSettings: AppSettings = { ...stdSettings, startingBalance: 0 };
  const lossOnZero: Trade[] = [
    { id: 'Z-1', dateTime: '2026-10-01T10:00', instrument: 'XAUUSD', position: 'BUY', strategy: 'S', entryPrice: 2700, lotSize: 0.1, riskAmount: 50, riskPercentage: 0, outcome: 'LOSS', grossProfit: -100, commission: 0, swap: 0, netProfit: -100 },
  ];
  const zeroPerf = calculatePerformance(lossOnZero, zeroBalSettings);
  const zeroSeries = computeDrawdownCurveSeries(zeroPerf.equityCurve, zeroBalSettings);
  assert.strictEqual(zeroSeries.hasValidStartingBalance, false);
  assert.ok(
    zeroSeries.safeCurve.every(
      (pt) =>
        Number.isFinite(pt.equity) &&
        Number.isFinite(pt.peak) &&
        Number.isFinite(pt.drawdownAmount) &&
        Number.isFinite(pt.drawdownPercent)
    ),
    'All drawdown points must be finite numbers (never NaN or Infinity)'
  );
});

test('DD-04', 'Visual kurva Drawdown menggunakan monotone cubic Hermite spline (buildSmoothSvgPath) selaras dengan EquityChart', () => {
  assert.ok(drawdownSrc.includes('buildSmoothSvgPath'), 'DrawdownChart must import and use buildSmoothSvgPath from EquityChart');
  assert.ok(drawdownSrc.includes('stroke="#E11D48"'), 'DrawdownChart must use soft red curve stroke (#E11D48)');
  assert.ok(!drawdownSrc.includes('onMouseEnter={() => setHoveredIndex'), 'Must not use legacy static per-node circle hover');

  const samplePoints = [
    { x: 62, y: 18 },
    { x: 232.5, y: 18 },
    { x: 403, y: 86 },
    { x: 573.5, y: 154 },
    { x: 744, y: 18 },
  ];
  const smoothPath = buildSmoothSvgPath(samplePoints);
  assert.ok(smoothPath.startsWith('M 62.00 18.00 C'), 'Smooth SVG path must generate cubic Bezier segments');
  assert.ok(!smoothPath.includes('NaN'), 'Smooth SVG path must never contain NaN');
});

// ============================================================================
// PART 3: DRAWDOWN ANALYSIS — INTERACTION PARITY WITH EQUITY CURVE
// ============================================================================

test('DD-05', 'DrawdownChart menggunakan pola interaksi yang persis sama dengan EquityChart (touch & mouse handlers + global release cleanup)', () => {
  const requiredPatterns = [
    'resolveEquityCurvePointAtClientX',
    'hoveredPoint',
    'lastTouchEndTimeRef',
    'onMouseDown={handleMouseDown}',
    'onMouseMove={handleMouseMove}',
    'onMouseUp={handleMouseUp}',
    'onMouseLeave={handleMouseLeave}',
    'onTouchStart={handleTouchStart}',
    'onTouchMove={handleTouchMove}',
    'onTouchEnd={handleTouchEnd}',
    'onTouchCancel={handleTouchCancel}',
    'onPointerCancel={clearInteraction}',
    'onLostPointerCapture={clearInteraction}',
    "window.addEventListener('touchend'",
    "window.addEventListener('touchcancel'",
    "window.addEventListener('mouseup'",
    "window.addEventListener('pointercancel'",
    "window.addEventListener('blur'",
  ];

  for (const pattern of requiredPatterns) {
    assert.ok(equitySrc.includes(pattern), `EquityChart reference must contain: ${pattern}`);
    assert.ok(drawdownSrc.includes(pattern), `DrawdownChart must match EquityChart pattern: ${pattern}`);
  }
  assert.ok(!drawdownSrc.includes('selectedPoint'), 'DrawdownChart must never store a persistent selectedPoint');
});

test('DD-06', 'Simulasi Interaksi Android (Touch Hold -> Touch Move -> Touch End / Cancel) dan Laptop (Mouse Down/Move -> Mouse Up / Leave)', () => {
  const cycleTrades: Trade[] = [
    { id: 'I-1', dateTime: '2026-10-01T10:00', instrument: 'XAUUSD', position: 'BUY', strategy: 'S', entryPrice: 2700, lotSize: 0.5, riskAmount: 200, riskPercentage: 2, outcome: 'WIN', grossProfit: 1000, commission: 0, swap: 0, netProfit: 1000 },
    { id: 'I-2', dateTime: '2026-10-02T10:00', instrument: 'XAUUSD', position: 'SELL', strategy: 'S', entryPrice: 2720, lotSize: 0.5, riskAmount: 200, riskPercentage: 2, outcome: 'LOSS', grossProfit: -1100, commission: 0, swap: 0, netProfit: -1100 },
    { id: 'I-3', dateTime: '2026-10-03T10:00', instrument: 'XAUUSD', position: 'BUY', strategy: 'S', entryPrice: 2700, lotSize: 0.5, riskAmount: 200, riskPercentage: 2, outcome: 'WIN', grossProfit: 1500, commission: 0, swap: 0, netProfit: 1500 },
  ];
  const perf = calculatePerformance(cycleTrades, stdSettings);
  const { safeCurve } = computeDrawdownCurveSeries(perf.equityCurve, stdSettings);
  const rect = { left: 0, width: 760 };

  // 1. Android: Touch Start at start of curve (x = 62 -> index 0)
  const onTouchStart = resolveDrawdownInteractionState('touchstart', 62, rect, safeCurve);
  assert.ok(onTouchStart !== null, 'Touch start must activate point detail');
  assert.strictEqual(onTouchStart?.index, 0);

  // 2. Android: Touch Move to Trade #2 (index 2 out of 3: 62 + (2/3)*682 = 516.67)
  const onTouchMove = resolveDrawdownInteractionState('touchmove', 517, rect, safeCurve);
  assert.ok(onTouchMove !== null, 'Touch move must follow finger to Trade #2');
  assert.strictEqual(onTouchMove?.index, 2);
  assert.strictEqual(onTouchMove?.tradeId, 'I-2');
  assert.strictEqual(onTouchMove?.drawdownAmount, 1100);
  assert.strictEqual(onTouchMove?.drawdownPercent, 10);

  // 3. Android: Touch End -> detail MUST immediately disappear (null)
  const onTouchEnd = resolveDrawdownInteractionState('touchend', 517, rect, safeCurve);
  assert.strictEqual(onTouchEnd, null, 'Touch end must immediately hide tooltip/detail');

  // 4. Android: Touch Cancel -> detail MUST immediately disappear (null)
  const onTouchCancel = resolveDrawdownInteractionState('touchcancel', 517, rect, safeCurve);
  assert.strictEqual(onTouchCancel, null, 'Touch cancel must immediately hide tooltip/detail');

  // 5. Laptop: Mouse Down / Move across curve -> detail follows cursor
  const onMouseDown = resolveDrawdownInteractionState('mousedown', 289, rect, safeCurve);
  assert.strictEqual(onMouseDown?.index, 1);
  const onMouseMove = resolveDrawdownInteractionState('mousemove', 744, rect, safeCurve);
  assert.strictEqual(onMouseMove?.index, 3);
  assert.strictEqual(onMouseMove?.drawdownPercent, 0);

  // 6. Laptop: Mouse Up -> detail MUST immediately disappear (null)
  const onMouseUp = resolveDrawdownInteractionState('mouseup', 744, rect, safeCurve);
  assert.strictEqual(onMouseUp, null, 'Mouse up must immediately hide tooltip/detail');

  // 7. Laptop: Mouse Leave -> detail MUST immediately disappear (null)
  const onMouseLeave = resolveDrawdownInteractionState('mouseleave', 744, rect, safeCurve);
  assert.strictEqual(onMouseLeave, null, 'Mouse leave must immediately hide tooltip/detail');
});

// ============================================================================
// PART 4: DYNAMIC TOOLTIP POSITIONING (EQUITY CURVE & DRAWDOWN ANALYSIS)
// ============================================================================

test('TP-01', 'Kedua grafik (EquityChart & DrawdownChart) menggunakan mekanisme posisi tooltip dinamis bersama (computeDynamicChartTooltipPlacement) dan bebas posisi statis right-2', () => {
  assert.ok(
    equitySrc.includes('export function computeDynamicChartTooltipPlacement'),
    'EquityChart must export shared computeDynamicChartTooltipPlacement'
  );
  assert.ok(
    drawdownSrc.includes('computeDynamicChartTooltipPlacement'),
    'DrawdownChart must import and reuse computeDynamicChartTooltipPlacement'
  );
  assert.ok(
    equitySrc.includes('data-tooltip-side={tooltipPlacement?.side') &&
      equitySrc.includes('style={{ left: `${tooltipPlacement?.leftPx'),
    'EquityChart tooltip must bind dynamic side and leftPx'
  );
  assert.ok(
    drawdownSrc.includes('data-tooltip-side={tooltipPlacement?.side') &&
      drawdownSrc.includes('style={{ left: `${tooltipPlacement?.leftPx'),
    'DrawdownChart tooltip must bind dynamic side and leftPx'
  );
  assert.ok(
    !equitySrc.includes('top-2 right-2') && !drawdownSrc.includes('top-2 right-2'),
    'Neither chart may use static top-2 right-2 tooltip positioning'
  );
});

test('TP-02', 'Skenario Android (360px): Sentuh area kiri & paling kiri -> Tooltip muncul di KANAN titik, tidak menutupi titik/jari, dan tidak keluar batas container', () => {
  const containerWidth = 360;
  const tooltipWidth = 148;

  // Sentuh area paling kiri (index 0 dari 5 titik, touchX = 30px)
  const farLeft = computeDynamicChartTooltipPlacement({
    pointIndex: 0,
    totalPoints: 5,
    containerWidthPx: containerWidth,
    touchClientX: 30,
    containerLeftPx: 0,
    tooltipWidthPx: tooltipWidth,
  });
  assert.strictEqual(farLeft.side, 'right', 'Far-left touch must place tooltip on the right');
  assert.ok(farLeft.leftPx > farLeft.pointPx, 'Tooltip must be to the right of curve point');
  assert.ok(farLeft.leftPx > farLeft.touchPx, 'Tooltip must not cover user finger');
  assert.ok(farLeft.leftPx >= 8 && farLeft.leftPx + tooltipWidth <= containerWidth - 8, 'Tooltip must stay within container bounds');

  // Sentuh area kiri (index 1 dari 5 titik, touchX = 110px)
  const leftArea = computeDynamicChartTooltipPlacement({
    pointIndex: 1,
    totalPoints: 5,
    containerWidthPx: containerWidth,
    touchClientX: 110,
    containerLeftPx: 0,
    tooltipWidthPx: tooltipWidth,
  });
  assert.strictEqual(leftArea.side, 'right', 'Left-area touch must place tooltip on the right');
  assert.ok(leftArea.leftPx > leftArea.pointPx, 'Tooltip must be to the right of curve point');
  assert.ok(leftArea.leftPx >= leftArea.touchPx + 10, 'Tooltip must keep safe gap from finger');
  assert.ok(leftArea.leftPx + tooltipWidth <= containerWidth - 8, 'Tooltip must not overflow right container boundary');
});

test('TP-03', 'Skenario Android (360px): Sentuh area kanan & paling kanan -> Tooltip muncul di KIRI titik, tidak menutupi titik/jari, dan tidak keluar batas container', () => {
  const containerWidth = 360;
  const tooltipWidth = 148;

  // Sentuh area kanan (index 3 dari 5 titik, touchX = 270px)
  const rightArea = computeDynamicChartTooltipPlacement({
    pointIndex: 3,
    totalPoints: 5,
    containerWidthPx: containerWidth,
    touchClientX: 270,
    containerLeftPx: 0,
    tooltipWidthPx: tooltipWidth,
  });
  assert.strictEqual(rightArea.side, 'left', 'Right-area touch must place tooltip on the left');
  assert.ok(rightArea.leftPx + tooltipWidth < rightArea.pointPx, 'Tooltip right edge must be to the left of curve point');
  assert.ok(rightArea.leftPx + tooltipWidth <= rightArea.touchPx - 10, 'Tooltip must not cover user finger');
  assert.ok(rightArea.leftPx >= 8, 'Tooltip must not overflow left container boundary');

  // Sentuh area paling kanan (index 4 dari 5 titik, touchX = 352px)
  const farRight = computeDynamicChartTooltipPlacement({
    pointIndex: 4,
    totalPoints: 5,
    containerWidthPx: containerWidth,
    touchClientX: 352,
    containerLeftPx: 0,
    tooltipWidthPx: tooltipWidth,
  });
  assert.strictEqual(farRight.side, 'left', 'Far-right touch must place tooltip on the left');
  assert.ok(farRight.leftPx + tooltipWidth < farRight.pointPx, 'Tooltip must be to the left of far-right point');
  assert.ok(farRight.leftPx >= 8 && farRight.leftPx + tooltipWidth <= containerWidth - 8, 'Tooltip must stay within container bounds');
});

test('TP-04', 'Skenario Drag Kiri -> Tengah -> Kanan -> Kembali ke Kiri (Android 360px & Laptop 760px)', () => {
  for (const containerWidth of [360, 760]) {
    const tooltipWidth = 148;
    const plotLeft = (62 / 760) * containerWidth;
    const plotRight = (744 / 760) * containerWidth;
    const plotWidth = plotRight - plotLeft;

    // Step 1: Mulai dari kiri (20% lebar plot) -> Tooltip di kanan
    const step1Left = computeDynamicChartTooltipPlacement({
      pointIndex: 1,
      totalPoints: 5,
      containerWidthPx: containerWidth,
      touchClientX: plotLeft + plotWidth * 0.2,
      containerLeftPx: 0,
      tooltipWidthPx: tooltipWidth,
    });
    assert.strictEqual(step1Left.side, 'right');

    // Step 2: Geser dari kiri menuju tengah (40% lebar plot) -> Tooltip tetap di kanan & menyesuaikan posisi leftPx
    const step2NearMid = computeDynamicChartTooltipPlacement({
      pointIndex: 2,
      totalPoints: 5,
      containerWidthPx: containerWidth,
      touchClientX: plotLeft + plotWidth * 0.4,
      containerLeftPx: 0,
      tooltipWidthPx: tooltipWidth,
    });
    assert.strictEqual(step2NearMid.side, 'right');
    assert.ok(step2NearMid.leftPx > step1Left.leftPx, 'Tooltip must shift smoothly as finger moves toward center');

    // Step 3: Geser melewati batas tengah menuju kanan (65% lebar plot) -> Tooltip berpindah ke kiri
    const step3Right = computeDynamicChartTooltipPlacement({
      pointIndex: 3,
      totalPoints: 5,
      containerWidthPx: containerWidth,
      touchClientX: plotLeft + plotWidth * 0.65,
      containerLeftPx: 0,
      tooltipWidthPx: tooltipWidth,
    });
    assert.strictEqual(step3Right.side, 'left', 'Crossing midpoint to right must switch tooltip to left');

    // Step 4: Geser kembali ke area kiri (25% lebar plot) -> Tooltip berpindah kembali ke kanan
    const step4BackLeft = computeDynamicChartTooltipPlacement({
      pointIndex: 1,
      totalPoints: 5,
      containerWidthPx: containerWidth,
      touchClientX: plotLeft + plotWidth * 0.25,
      containerLeftPx: 0,
      tooltipWidthPx: tooltipWidth,
    });
    assert.strictEqual(step4BackLeft.side, 'right', 'Dragging back to left must switch tooltip back to right');
  }
});

// ============================================================================
// PART 5: REGRESSION VERIFICATION ON OTHER ANALYTICS SECTIONS
// ============================================================================

test('RG-AN-01', 'Section 1 (Performance Overview), Section 3 (Calendar), Section 4 (Equity Curve) tetap utuh tanpa regresi', () => {
  assert.ok(analyticsSrc.includes('Total Net Profit / Loss'), 'Section 1 Net Profit Hero intact');
  assert.ok(analyticsSrc.includes('<PerformanceCalendar'), 'Section 3 PerformanceCalendar intact');
  assert.ok(analyticsSrc.includes('<EquityChart'), 'Section 4 EquityChart intact');
});

test('RG-AN-02', 'Section 6 (Daily & Monthly), Section 7 (Session), Section 8 (Symbol), Section 9 (Additional Stats) & Filter Periode tetap utuh', () => {
  assert.ok(analyticsSrc.includes('dayOfWeekStats'), 'Section 6 Day of Week intact');
  assert.ok(analyticsSrc.includes('sessionStats'), 'Section 7 Session Analysis intact');
  assert.ok(analyticsSrc.includes('symbolStats'), 'Section 8 Symbol Breakdown intact');
  assert.ok(analyticsSrc.includes('consecutiveWinsMax'), 'Section 9 Streaks & Distribution intact');
  assert.ok(analyticsSrc.includes('handleCustomDateChange'), 'Date/Period Selector intact');
});

console.log('\n=====================================================');
console.log(`TOTAL TESTS : ${totalCount}`);
console.log(`PASSED      : ${passedCount}`);
console.log(`FAILED      : ${totalCount - passedCount}`);
console.log(`STATUS      : ${passedCount === totalCount ? '✨ ALL ACCEPTANCE TESTS PASSED' : '⚠️ SOME TESTS FAILED'}`);
console.log('=====================================================');

if (passedCount !== totalCount) {
  process.exit(1);
}

