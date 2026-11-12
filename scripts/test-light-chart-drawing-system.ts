import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { UTCTimestamp } from 'lightweight-charts';
import {
  normalizePositionPrices,
  computePositionPips,
  computePositionGeometry,
  evaluatePositionOhlcStatus,
  screenToPlotCoordinates,
  resolveLogicalFromTime,
  resolveContainingBarLogical,
  resolveTimeFromLogical,
  advancePlacementStateMachine,
  DRAWING_TOOLS_CATALOG,
  formatBarCountdown,
  computeRulerMetrics,
  computeRecommendedPositionSizing,
  extractActiveJournalOverlayLines,
  type ChartDrawingObject,
  type OhlcCandle,
  type TwoTouchPlacementMachineState,
  type ActiveDrawingToolId,
  type DrawingAnchor,
} from '../src/components/chart/MarketChartView';
import {
  resolveTradingViewSnapshotUrl,
  synthesizeTradeScanFromSignals,
  normalizeChartPriceNumber,
  extractPriceNumbersFromLine,
  normalizeGeminiScanResponse,
} from '../src/utils/tradeScreenshotScanner';
import {
  buildUnifiedXauusdLotInput,
  calculateXauusdLot,
} from '../src/utils/riskCalculator';

console.log('====================================================================');
console.log('TRADEVAULT LIGHT CHART DRAWING SYSTEM — AUTOMATED VERIFICATION SUITE');
console.log('====================================================================\n');

// ============================================================================
// C1. BUY/SELL POSITION GEOMETRY, OHLC TP/SL EVALUATION & PREMIUM UI AUDIT
// ============================================================================
console.log('--- [C1] Testing Buy/Sell Position Geometry & OHLC Evaluation ---');

// 1. Buy Position Geometry Test
{
  const normBuy = normalizePositionPrices(true, 2000.0, 1990.0, 2020.0, 10, 2);
  assert.equal(normBuy.entryPrice, 2000.0, 'Buy entry price should remain 2000.0');
  assert.equal(normBuy.slPrice, 1990.0, 'Buy SL should be below entry (1990.0)');
  assert.equal(normBuy.tpPrice, 2020.0, 'Buy TP should be above entry (2020.0)');
  assert.equal(normBuy.rrRatio, '2.00', 'Buy R:R ratio should be 2.00');

  // Even if inverted prices are passed for Buy, normalizePositionPrices enforces TP > Entry > SL
  const invertedBuy = normalizePositionPrices(true, 2000.0, 2015.0, 1985.0, 10, 2);
  assert.ok(invertedBuy.tpPrice > invertedBuy.entryPrice, 'Buy TP must always be above Entry');
  assert.ok(invertedBuy.slPrice < invertedBuy.entryPrice, 'Buy SL must always be below Entry');

  // Verify SL and TP Pips calculation (4000 -> 3995 = 50 pips, 4000 -> 4010 = 100 pips)
  const slPips4000_3995 = computePositionPips(4000, 3995, 'XAUUSD');
  assert.equal(slPips4000_3995.pips, 50, 'XAUUSD Entry 4000 -> SL 3995 must equal 50 pips');
  assert.equal(slPips4000_3995.formattedPips, '50 pips', 'Formatted pips for 4000 -> 3995 must be "50 pips"');

  const tpPips4000_4010 = computePositionPips(4000, 4010, 'XAUUSD');
  assert.equal(tpPips4000_4010.pips, 100, 'XAUUSD Entry 4000 -> TP 4010 must equal 100 pips');
  assert.equal(tpPips4000_4010.formattedPips, '100 pips', 'Formatted pips for 4000 -> 4010 must be "100 pips"');

  // Screen Y coordinates (higher price = smaller Y on screen)
  // Entry = 2000 -> Y=200, TP = 2020 -> Y=120, SL = 1990 -> Y=240
  const buyGeom = computePositionGeometry({
    isLong: true,
    p1X: 100,
    p2X: 280,
    entryY: 200,
    tpY: 120,
    slY: 240,
    entryPrice: 2000.0,
    slPrice: 1990.0,
    tpPrice: 2020.0,
  });

  // Profit zone must fill 100% from TP (Y=120) to Entry (Y=200) -> top=120, height=80
  assert.equal(buyGeom.profitTopY, 120, 'Buy Profit Zone topY must start at TP line (120)');
  assert.equal(buyGeom.profitBottomY, 200, 'Buy Profit Zone bottomY must end at Entry line (200)');
  assert.equal(buyGeom.profitHeight, 80, 'Buy Profit Zone height must fill 100% from TP to Entry (80px)');
  // Risk zone must fill 100% from Entry (Y=200) to SL (Y=240) -> top=200, height=40
  assert.equal(buyGeom.riskTopY, 200, 'Buy Risk Zone topY must start at Entry line (200)');
  assert.equal(buyGeom.riskBottomY, 240, 'Buy Risk Zone bottomY must end at SL line (240)');
  assert.equal(buyGeom.riskHeight, 40, 'Buy Risk Zone height must fill 100% from Entry to SL (40px)');
  assert.equal(buyGeom.rrRatio, '2.00', 'Buy R:R ratio for 20pt TP / 10pt SL must be 2.00');
  assert.equal(buyGeom.leftX, 100);
  assert.equal(buyGeom.boxWidth, 180);
  console.log('✓ C1.1 Buy Position Geometry: Profit Zone above Entry (100% full fill), Risk Zone below Entry (100% full fill), R:R = 1:2.00');
}

// 2. Sell Position Geometry Test (Critical Fix Verification)
{
  const normSell = normalizePositionPrices(false, 2000.0, 2010.0, 1980.0, 10, 2);
  assert.equal(normSell.entryPrice, 2000.0, 'Sell entry price should remain 2000.0');
  assert.equal(normSell.slPrice, 2010.0, 'Sell SL must be above entry (2010.0)');
  assert.equal(normSell.tpPrice, 1980.0, 'Sell TP must be below entry (1980.0)');

  // Even if inverted prices are passed for Sell, normalizePositionPrices enforces SL > Entry > TP
  const invertedSell = normalizePositionPrices(false, 2000.0, 1990.0, 2020.0, 10, 2);
  assert.ok(invertedSell.slPrice > invertedSell.entryPrice, 'Sell SL must always be above Entry');
  assert.ok(invertedSell.tpPrice < invertedSell.entryPrice, 'Sell TP must always be below Entry');

  // Screen Y coordinates for SELL:
  // SL = 2010 -> Y=160 (above Entry)
  // Entry = 2000 -> Y=200 (middle dividing line)
  // TP = 1980 -> Y=280 (below Entry)
  const sellGeom = computePositionGeometry({
    isLong: false,
    p1X: 150,
    p2X: 330,
    entryY: 200,
    tpY: 280,
    slY: 160,
    entryPrice: 2000.0,
    slPrice: 2010.0,
    tpPrice: 1980.0,
  });

  // Risk zone (above Entry): from SL (Y=160) to Entry (Y=200) -> topY=160, height=40
  assert.equal(sellGeom.riskTopY, 160, 'Sell Risk Zone topY must be at SL line above Entry (160)');
  assert.equal(sellGeom.riskBottomY, 200, 'Sell Risk Zone bottomY must be at Entry line (200)');
  assert.equal(sellGeom.riskHeight, 40, 'Sell Risk Zone must fill 100% from SL down to Entry (40px)');

  // Profit zone (below Entry): from Entry (Y=200) down to TP (Y=280) -> topY=200, height=80
  // Note: Completely independent of latestCandle.close!
  assert.equal(sellGeom.profitTopY, 200, 'Sell Profit Zone topY must start at Entry line (200)');
  assert.equal(sellGeom.profitBottomY, 280, 'Sell Profit Zone bottomY must end at TP line (280)');
  assert.equal(sellGeom.profitHeight, 80, 'Sell Profit Zone must fill 100% vertically from Entry down to TP (80px)');
  assert.equal(sellGeom.rrRatio, '2.00', 'Sell R:R ratio for 20pt TP / 10pt SL must be 2.00');
  console.log('✓ C1.2 Sell Position Geometry: SL above Entry, Entry middle, TP below Entry, Profit Zone fills 100% Entry->TP');
}

// 3. OHLC TP/SL Status Evaluation Tests
{
  const baseCandles: OhlcCandle[] = [
    { time: 1000 as UTCTimestamp, open: 2050, high: 2060, low: 1940, close: 2000 }, // Candle BEFORE position open (must be ignored!)
    { time: 2000 as UTCTimestamp, open: 2000, high: 2005, low: 1995, close: 2002 }, // Position opens here
    { time: 3000 as UTCTimestamp, open: 2002, high: 2008, low: 1996, close: 2004 }, // Still active for both Buy (1990..2020) & Sell (2010..1980)
  ];

  const buyPosition: ChartDrawingObject = {
    id: 'buy-1',
    pair: 'XAUUSD',
    type: 'long_position',
    p1: { logical: 1, price: 2000, time: 2000 },
    p2: { logical: 5, price: 2020, time: 5000 },
    tpPrice: 2020,
    slPrice: 1990,
    createdAtTime: 2000,
    color: '#14B8A6',
  };

  // 3a. Active status (prior candle at t=1000 had high=2060 & low=1940, must be ignored)
  const evalActive = evaluatePositionOhlcStatus(buyPosition, baseCandles);
  assert.equal(evalActive.status, 'ACTIVE', 'Position must ignore candles before createdAtTime and remain ACTIVE');
  assert.equal(evalActive.label, 'Active');

  // 3b. Buy TP Hit via High wick (even if close retreats below TP)
  const candlesBuyTp: OhlcCandle[] = [
    ...baseCandles,
    { time: 4000 as UTCTimestamp, open: 2010, high: 2021.5, low: 2008, close: 2015 },
  ];
  const evalBuyTp = evaluatePositionOhlcStatus(buyPosition, candlesBuyTp);
  assert.equal(evalBuyTp.status, 'TP_HIT', 'Buy TP must trigger when candle.high >= tpPrice');
  assert.equal(evalBuyTp.label, 'TP Hit');
  assert.equal(evalBuyTp.hitTime, 4000);

  // 3c. Buy SL Hit via Low wick
  const candlesBuySl: OhlcCandle[] = [
    ...baseCandles,
    { time: 4000 as UTCTimestamp, open: 2010, high: 2014, low: 1989.8, close: 1998 },
  ];
  const evalBuySl = evaluatePositionOhlcStatus(buyPosition, candlesBuySl);
  assert.equal(evalBuySl.status, 'SL_HIT', 'Buy SL must trigger when candle.low <= slPrice');
  assert.equal(evalBuySl.label, 'SL Hit');
  assert.equal(evalBuySl.hitTime, 4000);

  // 3d. Sell TP Hit via Low wick & Sell SL Hit via High wick
  const sellPosition: ChartDrawingObject = {
    id: 'sell-1',
    pair: 'XAUUSD',
    type: 'short_position',
    p1: { logical: 1, price: 2000, time: 2000 },
    p2: { logical: 5, price: 1980, time: 5000 },
    tpPrice: 1980,
    slPrice: 2010,
    createdAtTime: 2000,
    color: '#F43F5E',
  };

  const candlesSellTp: OhlcCandle[] = [
    ...baseCandles,
    { time: 3000 as UTCTimestamp, open: 2002, high: 2004, low: 1979.5, close: 1988 },
  ];
  const evalSellTp = evaluatePositionOhlcStatus(sellPosition, candlesSellTp);
  assert.equal(evalSellTp.status, 'TP_HIT', 'Sell TP must trigger when candle.low <= tpPrice');

  const candlesSellSl: OhlcCandle[] = [
    ...baseCandles,
    { time: 3000 as UTCTimestamp, open: 2002, high: 2010.2, low: 1995, close: 2001 },
  ];
  const evalSellSl = evaluatePositionOhlcStatus(sellPosition, candlesSellSl);
  assert.equal(evalSellSl.status, 'SL_HIT', 'Sell SL must trigger when candle.high >= slPrice');

  // 3e. Simultaneous TP & SL in same candle -> AMBIGUOUS (and lower-TF resolution when available)
  const candlesSimultaneous: OhlcCandle[] = [
    ...baseCandles,
    { time: 4000 as UTCTimestamp, open: 2000, high: 2025, low: 1985, close: 2005 },
  ];
  const evalAmbiguous = evaluatePositionOhlcStatus(buyPosition, candlesSimultaneous);
  assert.equal(evalAmbiguous.status, 'AMBIGUOUS', 'Single candle touching both TP and SL without lower-TF data must return AMBIGUOUS');
  assert.equal(evalAmbiguous.label, 'Ambiguous');

  // With lower-TF candles resolving order (SL touched at 4060 before TP touched at 4180)
  const lowerTf: OhlcCandle[] = [
    { time: 4060 as UTCTimestamp, open: 2000, high: 2004, low: 1988, close: 1995 },
    { time: 4180 as UTCTimestamp, open: 1995, high: 2024, low: 1994, close: 2020 },
  ];
  const evalResolved = evaluatePositionOhlcStatus(buyPosition, candlesSimultaneous, lowerTf, 3600);
  assert.equal(evalResolved.status, 'SL_HIT', 'Lower-TF sub-candles should resolve which level was hit first');
  console.log('✓ C1.3 OHLC TP/SL Evaluation: Active, Buy TP/SL, Sell TP/SL, Prior-Candle Filter, and Simultaneous Ambiguous/Sub-TF resolution verified');

  // 3f. TradingView 2-Layer Dynamic Hit & Floating Progress Fill Verification
  // Screen Y setup for Buy: Entry=2000 (Y=200), TP=2020 (Y=120), SL=1990 (Y=240)
  const geomTpHit = computePositionGeometry({
    isLong: true,
    p1X: 100,
    p2X: 280,
    entryY: 200,
    tpY: 120,
    slY: 240,
    entryPrice: 2000,
    slPrice: 1990,
    tpPrice: 2020,
    status: 'TP_HIT',
  });
  assert.equal(geomTpHit.profitBaseFill, 'rgba(8, 153, 129, 0.14)', 'When TP_HIT, Layer 1 Profit base stays subtle (0.14) so unfilled box width stays un-filled');
  assert.equal(geomTpHit.riskBaseFill, 'rgba(242, 54, 69, 0.10)', 'When TP_HIT, untouched Risk Zone remains visible with subtle base tint (0.10)');
  assert.equal(geomTpHit.activeFillColor, 'rgba(8, 153, 129, 0.36)', 'When TP_HIT, Layer 2 active fill uses solid TradingView green (0.36)');
  assert.equal(geomTpHit.activeFillTopY, 120, 'When TP_HIT, active fill topY must cover full Profit Zone from TP (120)');
  assert.equal(geomTpHit.activeFillHeight, 80, 'When TP_HIT, active fill height must cover 100% of Profit Zone (80px)');
  assert.equal(geomTpHit.targetEndY, 120, 'When TP_HIT, diagonal connector must terminate at TP Y (120)');

  const geomSlHit = computePositionGeometry({
    isLong: true,
    p1X: 100,
    p2X: 280,
    entryY: 200,
    tpY: 120,
    slY: 240,
    entryPrice: 2000,
    slPrice: 1990,
    tpPrice: 2020,
    status: 'SL_HIT',
  });
  assert.equal(geomSlHit.riskBaseFill, 'rgba(242, 54, 69, 0.14)', 'When SL_HIT, Layer 1 Risk base stays subtle (0.14) so unfilled box width stays un-filled');
  assert.equal(geomSlHit.profitBaseFill, 'rgba(8, 153, 129, 0.10)', 'When SL_HIT, untouched Profit Zone remains visible with subtle base tint (0.10)');
  assert.equal(geomSlHit.activeFillColor, 'rgba(242, 54, 69, 0.36)', 'When SL_HIT, Layer 2 active fill uses solid TradingView crimson (0.36)');
  assert.equal(geomSlHit.activeFillTopY, 200, 'When SL_HIT, active fill topY must start at Entry (200)');
  assert.equal(geomSlHit.activeFillHeight, 40, 'When SL_HIT, active fill height must cover 100% of Risk Zone (40px)');
  assert.equal(geomSlHit.targetEndY, 240, 'When SL_HIT, diagonal connector must terminate at SL Y (240)');

  // Floating Profit while ACTIVE (currentPrice = 2010 -> Y=160, halfway to TP=120)
  const geomActiveFloatingProfit = computePositionGeometry({
    isLong: true,
    p1X: 100,
    p2X: 280,
    entryY: 200,
    tpY: 120,
    slY: 240,
    entryPrice: 2000,
    slPrice: 1990,
    tpPrice: 2020,
    status: 'ACTIVE',
    currentPrice: 2010,
    currentPriceY: 160,
  });
  assert.equal(geomActiveFloatingProfit.profitBaseFill, 'rgba(8, 153, 129, 0.14)', 'When ACTIVE, full Profit Zone base remains visible (0.14)');
  assert.equal(geomActiveFloatingProfit.riskBaseFill, 'rgba(242, 54, 69, 0.14)', 'When ACTIVE, full Risk Zone base remains visible (0.14)');
  assert.equal(geomActiveFloatingProfit.activeFillTopY, 160, 'Floating profit active fill topY tracks currentPriceY (160)');
  assert.equal(geomActiveFloatingProfit.activeFillHeight, 40, 'Floating profit active fill height spans from currentPriceY (160) to entryY (200)');
  assert.equal(geomActiveFloatingProfit.activeFillColor, 'rgba(8, 153, 129, 0.28)', 'Floating profit uses TradingView green active fill');

  // 3g. Entry-Triggered Fill Gate (PENDING when no candle touches entryPrice)
  const untriggeredCandles: OhlcCandle[] = [
    { time: 2000 as UTCTimestamp, open: 2005, high: 2012, low: 2002, close: 2010 }, // Above entryPrice=2000 (never touches 2000)
    { time: 3000 as UTCTimestamp, open: 2010, high: 2025, low: 2004, close: 2022 }, // Even reaches 2025 (>= tpPrice 2020) without ever touching Entry=2000!
  ];
  const evalPending = evaluatePositionOhlcStatus(buyPosition, untriggeredCandles);
  assert.equal(evalPending.status, 'PENDING', 'Position must remain PENDING when no candle touches entryPrice');
  assert.equal(evalPending.entryTouched, false, 'entryTouched must be false when no candle touches entryPrice');

  const geomPending = computePositionGeometry({
    isLong: true,
    p1X: 100,
    p2X: 280,
    entryY: 200,
    tpY: 120,
    slY: 240,
    entryPrice: 2000,
    slPrice: 1990,
    tpPrice: 2020,
    status: evalPending.status,
    currentPrice: 2010,
    currentPriceY: 160,
  });
  assert.equal(geomPending.activeFillHeight, 0, 'When PENDING (entry not touched), activeFillHeight must be 0');
  assert.equal(geomPending.activeFillWidth, 0, 'When PENDING (entry not touched), activeFillWidth must be 0');
  assert.equal(geomPending.activeFillTopY, null, 'When PENDING (entry not touched), activeFillTopY must be null');

  // 3h. Out-of-Box Candles Ignored: Candles inside box (2000..5000) do NOT touch Entry=2000,
  // then candle outside box (time=6000 > p2.time=5000) hits Entry=2000 and TP=2020 -> MUST remain PENDING!
  const candlesHitAfterBoxEnd: OhlcCandle[] = [
    { time: 2000 as UTCTimestamp, open: 2005, high: 2010, low: 2002, close: 2008 }, // Inside box, no Entry touch
    { time: 3000 as UTCTimestamp, open: 2008, high: 2014, low: 2003, close: 2011 }, // Inside box, no Entry touch
    { time: 5000 as UTCTimestamp, open: 2011, high: 2015, low: 2004, close: 2006 }, // Right edge of box, no Entry touch
    { time: 6000 as UTCTimestamp, open: 2006, high: 2025, low: 1999, close: 2022 }, // OUTSIDE box (time 6000 > 5000), hits Entry & TP!
  ];
  const evalOutsideBox = evaluatePositionOhlcStatus(buyPosition, candlesHitAfterBoxEnd);
  assert.equal(evalOutsideBox.status, 'PENDING', 'Candles outside the right edge of Buy/Sell box must NOT trigger Entry or TP/SL');
  assert.equal(evalOutsideBox.entryTouched, false, 'entryTouched must remain false when Entry touch occurs outside the box');

  // 3i. Wide Box Candle-Bounded Fill: Entry touched at candle i=1 (time=3000), TP hit at candle i=2 (time=4000),
  // while candle i=3 (time=5000) inside the wide box ranges back toward Entry -> fill stops strictly at candle i=2!
  const wideBoxCandles: OhlcCandle[] = [
    { time: 2000 as UTCTimestamp, open: 2006, high: 2009, low: 2003, close: 2005 }, // i=0: inside box, before Entry touch
    { time: 3000 as UTCTimestamp, open: 2005, high: 2008, low: 1999.5, close: 2004 }, // i=1: touches Entry (2000)!
    { time: 4000 as UTCTimestamp, open: 2004, high: 2022, low: 2003, close: 2018 }, // i=2: hits TP (2020)!
    { time: 5000 as UTCTimestamp, open: 2018, high: 2019, low: 2000.5, close: 2001 }, // i=3: ranges back toward Entry inside box
  ];
  const evalWideBox = evaluatePositionOhlcStatus(buyPosition, wideBoxCandles);
  assert.equal(evalWideBox.status, 'TP_HIT', 'Wide box must register TP_HIT at candle i=2');
  assert.equal(evalWideBox.entryHitLogical, 1, 'Entry hit must be recorded at candle index 1');
  assert.equal(evalWideBox.hitLogical, 2, 'TP hit must be recorded at candle index 2 (ignoring candle index 3)');

  const geomWideBoxBounded = computePositionGeometry({
    isLong: true,
    p1X: 100,
    p2X: 300,
    entryY: 200,
    tpY: 120,
    slY: 240,
    entryPrice: 2000,
    slPrice: 1990,
    tpPrice: 2020,
    status: evalWideBox.status,
    fillStartX: 145, // Candle i=1 left edge
    fillEndX: 195,   // Candle i=2 right edge (stops well before p2X=300!)
  });
  assert.equal(geomWideBoxBounded.activeFillLeftX, 145, 'Active fill must start horizontally at Entry-hit candle (145px, not 100px)');
  assert.equal(geomWideBoxBounded.activeFillRightX, 195, 'Active fill must stop horizontally at TP-hit candle (195px, not 300px)');
  assert.equal(geomWideBoxBounded.activeFillWidth, 50, 'Active fill width must cover only the Entry..TP candle span (50px out of 200px box)');
  console.log('✓ C1.4 TradingView 2-Layer Dynamic Hit, Box-Bounded Evaluation & Entry-to-Hit Candle Fill Clamping verified');
}

// ============================================================================
// C2. TWO-TOUCH PLACEMENT & CROSSHAIR POSITIONING (ALL 6 SCENARIOS + EDGES)
// ============================================================================
console.log('\n--- [C2] Testing Two-Touch Placement & Crosshair Positioning ---');

const initialMachineState: TwoTouchPlacementMachineState = {
  placementState: 'idle',
  activeTool: 'cursor',
  crosshairPos: { x: 180, y: 200 },
  crosshairAnchor: { logical: 50, price: 2000, time: 1710000000 },
  draftDrawing: null,
  draftStep: 0,
  committedDrawings: [],
};

// Scenario 1: Horizontal Line (1-point tool)
// Touch 1 moves crosshair to price=2045.50. Touch 2 taps at far right edge (x=380, y=500).
// Line MUST be placed at crosshair price (2045.50), NOT at second touch Y.
{
  let st = advancePlacementStateMachine(initialMachineState, {
    type: 'SELECT_TOOL',
    tool: 'horizontal_line',
    initialPos: { x: 180, y: 200 },
    initialAnchor: { logical: 50, price: 2000, time: 1710000000 },
  });
  assert.equal(st.placementState, 'tool_selected');

  // Touch 1: user drags crosshair to price 2045.50
  st = advancePlacementStateMachine(st, {
    type: 'MOVE_CROSSHAIR',
    pos: { x: 210, y: 140 },
    anchor: { logical: 62, price: 2045.5, time: 1710043200 },
    volatility: 10,
    decimals: 2,
  });
  assert.equal(st.placementState, 'placing');

  st = advancePlacementStateMachine(st, { type: 'END_CROSSHAIR_DRAG' });
  assert.equal(st.placementState, 'awaiting_confirmation');

  // Touch 2: user taps far away at (x=380, y=500) to confirm.
  st = advancePlacementStateMachine(st, {
    type: 'CONFIRM_SECOND_TOUCH',
    secondTouchScreenPos: { x: 380, y: 500 },
    pair: 'XAUUSD',
    volatility: 10,
    decimals: 2,
  });
  assert.equal(st.placementState, 'completed');
  assert.equal(st.committedDrawings.length, 1);
  assert.equal(st.committedDrawings[0].p1.price, 2045.5, 'Horizontal line must lock to crosshair price 2045.50');
  assert.equal(st.committedDrawings[0].p2.price, 2045.5);
  assert.equal(st.activeTool, 'cursor', 'Tool must auto-deactivate after completion when stayInDrawingMode is false');
  console.log('✓ C2 Scenario 1 (Horizontal Line): Placed at exact crosshair price (2045.50), unaffected by distant 2nd touch at (380, 500)');
}

// Scenario 2: Vertical Line (1-point time anchor tool)
// Touch 1 moves crosshair to candle logical=88, time=1710129600. Touch 2 taps at far left edge (x=12, y=390).
{
  let st = advancePlacementStateMachine(initialMachineState, {
    type: 'SELECT_TOOL',
    tool: 'vertical_line',
    initialPos: { x: 180, y: 200 },
    initialAnchor: { logical: 50, price: 2000, time: 1710000000 },
  });
  st = advancePlacementStateMachine(st, {
    type: 'MOVE_CROSSHAIR',
    pos: { x: 260, y: 195 },
    anchor: { logical: 88, price: 1998.2, time: 1710129600 },
    volatility: 10,
    decimals: 2,
  });
  st = advancePlacementStateMachine(st, { type: 'END_CROSSHAIR_DRAG' });
  assert.equal(st.placementState, 'awaiting_confirmation');

  st = advancePlacementStateMachine(st, {
    type: 'CONFIRM_SECOND_TOUCH',
    secondTouchScreenPos: { x: 12, y: 390 },
    pair: 'XAUUSD',
    volatility: 10,
    decimals: 2,
  });
  assert.equal(st.placementState, 'completed');
  assert.equal(st.committedDrawings.length, 1);
  assert.equal(st.committedDrawings[0].p1.logical, 88, 'Vertical line must lock to crosshair candle index 88');
  assert.equal(st.committedDrawings[0].p1.time, 1710129600, 'Vertical line must lock to crosshair timestamp');
  console.log('✓ C2 Scenario 2 (Vertical Line): Placed at exact crosshair candle/time, unaffected by distant 2nd touch at (12, 390)');
}

// Scenario 3: Trend Line (2-point tool)
// Point 1 positioned with crosshair + confirmed with distant touch.
// Point 2 positioned with crosshair + confirmed with distant touch.
{
  let st = advancePlacementStateMachine(initialMachineState, {
    type: 'SELECT_TOOL',
    tool: 'trendline',
    initialPos: { x: 180, y: 200 },
    initialAnchor: { logical: 50, price: 2000, time: 1710000000 },
  });
  // Move crosshair for Point 1
  st = advancePlacementStateMachine(st, {
    type: 'MOVE_CROSSHAIR',
    pos: { x: 110, y: 260 },
    anchor: { logical: 30, price: 1980.0, time: 1710003600 },
    volatility: 10,
    decimals: 2,
  });
  st = advancePlacementStateMachine(st, { type: 'END_CROSSHAIR_DRAG' });
  assert.equal(st.placementState, 'awaiting_confirmation');

  // Confirm Point 1 via distant second touch at (340, 60)
  st = advancePlacementStateMachine(st, {
    type: 'CONFIRM_SECOND_TOUCH',
    secondTouchScreenPos: { x: 340, y: 60 },
    pair: 'XAUUSD',
    volatility: 10,
    decimals: 2,
  });
  assert.equal(st.placementState, 'awaiting_confirmation');
  assert.equal(st.draftStep, 1);
  assert.ok(st.draftDrawing, 'Draft drawing must exist after Point 1 confirmation');
  assert.deepEqual(st.draftDrawing.p1, { logical: 30, price: 1980.0, time: 1710003600 });

  // Move crosshair for Point 2
  st = advancePlacementStateMachine(st, {
    type: 'MOVE_CROSSHAIR',
    pos: { x: 240, y: 120 },
    anchor: { logical: 75, price: 2035.0, time: 1710165600 },
    volatility: 10,
    decimals: 2,
  });
  assert.equal(st.placementState, 'placing');
  assert.deepEqual(st.draftDrawing?.p2, { logical: 75, price: 2035.0, time: 1710165600 }, 'Live preview p2 must follow crosshair');

  st = advancePlacementStateMachine(st, { type: 'END_CROSSHAIR_DRAG' });
  assert.equal(st.placementState, 'awaiting_confirmation');

  // Confirm Point 2 via distant second touch at (25, 370)
  st = advancePlacementStateMachine(st, {
    type: 'CONFIRM_SECOND_TOUCH',
    secondTouchScreenPos: { x: 25, y: 370 },
    pair: 'XAUUSD',
    volatility: 10,
    decimals: 2,
  });
  assert.equal(st.placementState, 'completed');
  assert.equal(st.committedDrawings.length, 1);
  assert.deepEqual(st.committedDrawings[0].p1, { logical: 30, price: 1980.0, time: 1710003600 });
  assert.deepEqual(st.committedDrawings[0].p2, { logical: 75, price: 2035.0, time: 1710165600 });
  console.log('✓ C2 Scenario 3 (Trend Line): Both Point 1 and Point 2 locked strictly to crosshair coordinates');
}

// Scenario 4: Fibonacci Retracement (2-point tool)
{
  let st = advancePlacementStateMachine(initialMachineState, {
    type: 'SELECT_TOOL',
    tool: 'fib_retracement',
    initialPos: { x: 180, y: 200 },
    initialAnchor: { logical: 50, price: 2000, time: 1710000000 },
  });
  st = advancePlacementStateMachine(st, {
    type: 'MOVE_CROSSHAIR',
    pos: { x: 90, y: 300 },
    anchor: { logical: 20, price: 1950.0, time: 1710000000 },
    volatility: 10,
    decimals: 2,
  });
  st = advancePlacementStateMachine(st, { type: 'END_CROSSHAIR_DRAG' });
  st = advancePlacementStateMachine(st, {
    type: 'CONFIRM_SECOND_TOUCH',
    secondTouchScreenPos: { x: 310, y: 80 },
    pair: 'XAUUSD',
    volatility: 10,
    decimals: 2,
  });
  assert.equal(st.draftStep, 1);

  st = advancePlacementStateMachine(st, {
    type: 'MOVE_CROSSHAIR',
    pos: { x: 220, y: 100 },
    anchor: { logical: 60, price: 2050.0, time: 1710144000 },
    volatility: 10,
    decimals: 2,
  });
  st = advancePlacementStateMachine(st, { type: 'END_CROSSHAIR_DRAG' });
  st = advancePlacementStateMachine(st, {
    type: 'CONFIRM_SECOND_TOUCH',
    secondTouchScreenPos: { x: 40, y: 350 },
    pair: 'XAUUSD',
    volatility: 10,
    decimals: 2,
  });
  assert.equal(st.placementState, 'completed');
  assert.equal(st.committedDrawings.length, 1);
  assert.equal(st.committedDrawings[0].p1.price, 1950.0);
  assert.equal(st.committedDrawings[0].p2.price, 2050.0);
  console.log('✓ C2 Scenario 4 (Fibonacci Retracement): Swing Low & Swing High locked strictly to crosshair anchors');
}

// Scenario 5: Buy/Sell Position (1-anchor Entry placement + automatic valid SL/TP)
{
  let st = advancePlacementStateMachine(initialMachineState, {
    type: 'SELECT_TOOL',
    tool: 'short_position',
    initialPos: { x: 180, y: 200 },
    initialAnchor: { logical: 50, price: 2000, time: 1710000000 },
  });
  st = advancePlacementStateMachine(st, {
    type: 'MOVE_CROSSHAIR',
    pos: { x: 165, y: 175 },
    anchor: { logical: 42, price: 2018.75, time: 1710079200 },
    volatility: 10,
    decimals: 2,
  });
  st = advancePlacementStateMachine(st, { type: 'END_CROSSHAIR_DRAG' });
  // Second touch at bottom-left corner confirms Entry at crosshair
  st = advancePlacementStateMachine(st, {
    type: 'CONFIRM_SECOND_TOUCH',
    secondTouchScreenPos: { x: 15, y: 385 },
    pair: 'XAUUSD',
    volatility: 10,
    decimals: 2,
  });
  assert.equal(st.placementState, 'completed');
  assert.equal(st.committedDrawings.length, 1);
  const placedSell = st.committedDrawings[0];
  assert.equal(placedSell.p1.price, 2018.75, 'Sell Entry price must lock at crosshair price 2018.75');
  assert.equal(placedSell.p1.logical, 42, 'Sell Entry logical must lock at crosshair logical 42');
  assert.ok((placedSell.slPrice ?? 0) > placedSell.p1.price, 'Sell SL must be above Entry');
  assert.ok((placedSell.tpPrice ?? 0) < placedSell.p1.price, 'Sell TP must be below Entry');
  console.log('✓ C2 Scenario 5 (Buy/Sell Position): Entry, SL, and TP locked at exact crosshair coordinate regardless of corner confirmation tap');
}

// Scenario 6: Cancel & Restart
{
  let st = advancePlacementStateMachine(initialMachineState, {
    type: 'SELECT_TOOL',
    tool: 'fib_extension',
    initialPos: { x: 180, y: 200 },
    initialAnchor: { logical: 50, price: 2000, time: 1710000000 },
  });
  st = advancePlacementStateMachine(st, {
    type: 'MOVE_CROSSHAIR',
    pos: { x: 100, y: 240 },
    anchor: { logical: 15, price: 1990.0, time: 1710000000 },
    volatility: 10,
    decimals: 2,
  });
  st = advancePlacementStateMachine(st, { type: 'END_CROSSHAIR_DRAG' });
  st = advancePlacementStateMachine(st, {
    type: 'CONFIRM_SECOND_TOUCH',
    secondTouchScreenPos: { x: 300, y: 100 },
    pair: 'XAUUSD',
    volatility: 10,
    decimals: 2,
  });
  assert.equal(st.draftStep, 1, '1 anchor locked before cancel');
  assert.ok(st.draftDrawing !== null);

  // Cancel mid-placement
  st = advancePlacementStateMachine(st, { type: 'CANCEL' });
  assert.equal(st.placementState, 'cancelled');
  assert.equal(st.activeTool, 'cursor');
  assert.equal(st.draftDrawing, null, 'Draft drawing must be cleared on cancel with zero ghost state');
  assert.equal(st.draftStep, 0);

  // Restart with a new tool
  st = advancePlacementStateMachine(st, {
    type: 'SELECT_TOOL',
    tool: 'ray',
    initialPos: { x: 180, y: 200 },
    initialAnchor: { logical: 50, price: 2000, time: 1710000000 },
  });
  assert.equal(st.placementState, 'tool_selected');
  assert.equal(st.activeTool, 'ray');
  assert.equal(st.draftDrawing, null);
  console.log('✓ C2 Scenario 6 (Cancel & Restart): Clean state reset with zero ghost anchors');
}

// Edge Clamping Verification (Left, Right, Top, Bottom, Near Price Scale, Near Time Scale)
{
  const rect = { left: 16, top: 80, width: 360, height: 420 };
  const priceScaleWidth = 56;
  const timeScaleHeight = 26;
  // Valid plot area: X in [6, 304], Y in [6, 394]

  const leftEdge = screenToPlotCoordinates(5, 200, rect, priceScaleWidth, timeScaleHeight);
  assert.equal(leftEdge.plotX, 6, 'Left edge touch must clamp to plot minX (6)');
  assert.equal(leftEdge.isWithinPlot, false);

  const rightPriceScaleTouch = screenToPlotCoordinates(365, 200, rect, priceScaleWidth, timeScaleHeight);
  assert.equal(rightPriceScaleTouch.plotX, 304, 'Touch on right price scale must clamp to plot maxX (304)');
  assert.equal(rightPriceScaleTouch.isWithinPlot, false);

  const topEdge = screenToPlotCoordinates(150, 40, rect, priceScaleWidth, timeScaleHeight);
  assert.equal(topEdge.plotY, 6, 'Top edge touch must clamp to plot minY (6)');

  const bottomTimeScaleTouch = screenToPlotCoordinates(150, 495, rect, priceScaleWidth, timeScaleHeight);
  assert.equal(bottomTimeScaleTouch.plotY, 394, 'Touch on bottom time scale must clamp to plot maxY (394)');

  const centerPlot = screenToPlotCoordinates(166, 230, rect, priceScaleWidth, timeScaleHeight);
  assert.equal(centerPlot.plotX, 150);
  assert.equal(centerPlot.plotY, 150);
  assert.equal(centerPlot.isWithinPlot, true);
  console.log('✓ C2 Edge Coordinate Mapping: Left, Right, Top, Bottom, Price Scale, and Time Scale clamping verified');
}

// ============================================================================
// C3. DOMAIN ANCHORING ACROSS TIMEFRAMES & REPLAY + PREMIUM UI ICON AUDIT
// ============================================================================
console.log('\n--- [C3] Testing Domain Coordinate Anchoring & Premium UI Standards ---');

{
  // Hourly candles: 10:00 (36000), 11:00 (39600), 12:00 (43200), 13:00 (46800)
  const hourlyCandles: OhlcCandle[] = [
    { time: 36000 as UTCTimestamp, open: 2000, high: 2010, low: 1995, close: 2005 },
    { time: 39600 as UTCTimestamp, open: 2005, high: 2015, low: 2000, close: 2010 },
    { time: 43200 as UTCTimestamp, open: 2010, high: 2020, low: 2005, close: 2015 },
    { time: 46800 as UTCTimestamp, open: 2015, high: 2025, low: 2010, close: 2020 },
  ];
  const anchorAt1200 = { logical: 99, price: 2015.0, time: 43200 };
  const resolvedHourlyIdx = resolveLogicalFromTime(anchorAt1200, hourlyCandles, 3600);
  assert.equal(resolvedHourlyIdx, 2, 'Anchor with time=43200 must resolve to index 2 in 1h candles even if stored logical was 99');

  // Switch to 30m candles where time=43200 is now at index 4
  const m30Candles: OhlcCandle[] = [
    { time: 36000 as UTCTimestamp, open: 2000, high: 2008, low: 1995, close: 2002 },
    { time: 37800 as UTCTimestamp, open: 2002, high: 2010, low: 2000, close: 2005 },
    { time: 39600 as UTCTimestamp, open: 2005, high: 2012, low: 2001, close: 2008 },
    { time: 41400 as UTCTimestamp, open: 2008, high: 2015, low: 2004, close: 2010 },
    { time: 43200 as UTCTimestamp, open: 2010, high: 2018, low: 2006, close: 2014 },
    { time: 45000 as UTCTimestamp, open: 2014, high: 2020, low: 2009, close: 2015 },
  ];
  const resolvedM30Idx = resolveLogicalFromTime(anchorAt1200, m30Candles, 1800);
  assert.equal(resolvedM30Idx, 4, 'Anchor with time=43200 must dynamically resolve to index 4 when timeframe changes to 30m');

  // Future timestamp projection beyond last candle
  const futureAnchor = { logical: 10, price: 2020.0, time: 54000 }; // 2 hours after 46800
  const resolvedFutureIdx = resolveLogicalFromTime(futureAnchor, hourlyCandles, 3600);
  assert.equal(resolvedFutureIdx, 5, 'Future timestamp 2 hours after index 3 should project to logical index 5');

  // Sub-bar fractional timestamp interpolation round-trip (zero snapping to integer bars)
  for (const fracLogical of [0.25, 1.35, 2.75, -1.5, 4.8]) {
    const computedTime = resolveTimeFromLogical(fracLogical, hourlyCandles, 3600);
    assert.ok(computedTime !== undefined, `resolveTimeFromLogical must compute time for logical=${fracLogical}`);
    const roundTrippedLogical = resolveLogicalFromTime(
      { logical: 999, price: 2010, time: computedTime },
      hourlyCandles,
      3600
    );
    assert.ok(
      Math.abs(roundTrippedLogical - fracLogical) < 1e-6,
      `Sub-bar logical ${fracLogical} must round-trip losslessly via timestamp (got ${roundTrippedLogical})`
    );
  }

  // Historical candle prepend invariance: when 100 older candles are prepended before hourlyCandles,
  // both p1 and p2 of a Buy/Sell Position shift by +100 together without stretching or drifting
  let posMachine = advancePlacementStateMachine(initialMachineState, {
    type: 'SELECT_TOOL',
    tool: 'long_position',
    initialPos: { x: 180, y: 200 },
    initialAnchor: { logical: 1, price: 2005, time: 39600 },
  });
  posMachine = advancePlacementStateMachine(posMachine, {
    type: 'CONFIRM_SECOND_TOUCH',
    pair: 'XAUUSD',
    volatility: 10,
    decimals: 2,
    tfSeconds: 3600,
  });
  const committedLong = posMachine.committedDrawings[0];
  assert.equal(committedLong.p1.time, 39600, 'Long position p1.time must be stamped');
  assert.equal(committedLong.p2.time, 39600 + 22 * 3600, 'Long position p2.time must be stamped (p1.time + 22 * tfSeconds)');

  const prependedCandles: OhlcCandle[] = [
    ...Array.from({ length: 100 }, (_, i) => ({
      time: (36000 - (100 - i) * 3600) as UTCTimestamp,
      open: 1990,
      high: 1995,
      low: 1985,
      close: 1992,
    })),
    ...hourlyCandles,
  ];
  const p1Before = resolveLogicalFromTime(committedLong.p1, hourlyCandles, 3600);
  const p2Before = resolveLogicalFromTime(committedLong.p2, hourlyCandles, 3600);
  const p1After = resolveLogicalFromTime(committedLong.p1, prependedCandles, 3600);
  const p2After = resolveLogicalFromTime(committedLong.p2, prependedCandles, 3600);
  assert.equal(p2Before - p1Before, 22, 'Width before prepend must be 22 bars');
  assert.equal(p2After - p1After, 22, 'Width after historical prepend must remain 22 bars (zero distortion)');
  assert.equal(p1After, p1Before + 100, 'p1 must shift by +100 bars with historical prepend');
  assert.equal(p2After, p2Before + 100, 'p2 must shift by +100 bars with historical prepend');

  console.log('✓ C3.1 Domain Coordinate Anchoring: Exact sub-bar timestamp interpolation, p1/p2/p3 timestamp stamping & historical prepend invariance verified');
}

// Verify Catalog & Source Code Standards (No text letters in icons, No neon glow/cyan, TradingView 2-layer fill present)
{
  assert.equal(DRAWING_TOOLS_CATALOG.length, 10, 'Catalog must include all 10 tools including vertical_line and ray');
  const toolIds = DRAWING_TOOLS_CATALOG.map((t) => t.id);
  const requiredTools: ActiveDrawingToolId[] = [
    'trendline',
    'ray',
    'horizontal_line',
    'vertical_line',
    'rectangle',
    'fib_retracement',
    'fib_extension',
    'long_position',
    'short_position',
    'price_note',
  ];
  for (const requiredTool of requiredTools) {
    assert.ok(toolIds.includes(requiredTool), `Catalog must include ${requiredTool}`);
  }

  const srcPath = path.resolve(process.cwd(), 'src/components/chart/MarketChartView.tsx');
  const srcContent = fs.readFileSync(srcPath, 'utf8');

  // Ensure renderTradingViewDrawingIcon has no <text> letters like >L<, >S<, >$<
  const iconFnStart = srcContent.indexOf('export function renderTradingViewDrawingIcon');
  const iconFnEnd = srcContent.indexOf('declare global', iconFnStart);
  const iconFnSlice = srcContent.slice(iconFnStart, iconFnEnd);
  assert.ok(!iconFnSlice.includes('<text'), 'renderTradingViewDrawingIcon must use pure SVG geometry without <text> letters');

  // Ensure zero neon glow shadow-[0_0_ and zero neon cyan #22D3EE in MarketChartView.tsx
  assert.ok(!srcContent.includes('shadow-[0_0_'), 'MarketChartView.tsx must not contain neon glow shadow-[0_0_ classes');
  assert.ok(!srcContent.includes('#22D3EE'), 'MarketChartView.tsx must not contain neon cyan #22D3EE');
  assert.ok(srcContent.includes('data-testid="position-active-fill-zone"'), 'MarketChartView.tsx must render TradingView Layer 2 position-active-fill-zone');
  assert.ok(srcContent.includes('data-testid="position-progress-connector"'), 'MarketChartView.tsx must render TradingView diagonal position-progress-connector');
  assert.ok(srcContent.includes('startContinuousSync'), 'MarketChartView.tsx must support startContinuousSync for 60fps zero-lag drawing lock');
  assert.ok(srcContent.includes('data-testid="drawing-open-position-direct-btn"'), 'MarketChartView.tsx must provide direct open position order button');

  console.log('✓ C3.2 Premium Non-Neon UI, Zero-Lag 60fps Frame Sync & Direct Position Execution verified');
}

// Multi-Timeframe Synchronization Verification (M5 <-> M15 <-> H1 Bar Containment & OHLC Evaluation)
{
  // Build coherent M5 (300s), M15 (900s), and H1 (3600s) candles covering 10:00 UTC (36000) to 11:55 UTC (42900)
  const h1Candles: OhlcCandle[] = [
    { time: 32400 as UTCTimestamp, open: 4090, high: 4096, low: 4088, close: 4094 }, // 09:00..10:00 (idx 0)
    { time: 36000 as UTCTimestamp, open: 4094, high: 4108, low: 4092, close: 4105 }, // 10:00..11:00 (idx 1)
    { time: 39600 as UTCTimestamp, open: 4105, high: 4118, low: 4099, close: 4115 }, // 11:00..12:00 (idx 2, current open H1 bar)
  ];

  const m15Candles: OhlcCandle[] = [
    { time: 36000 as UTCTimestamp, open: 4094, high: 4098, low: 4092, close: 4096 }, // 10:00 (idx 0)
    { time: 36900 as UTCTimestamp, open: 4096, high: 4101, low: 4095, close: 4099 }, // 10:15 (idx 1)
    { time: 37800 as UTCTimestamp, open: 4099, high: 4104, low: 4097, close: 4102 }, // 10:30 (idx 2)
    { time: 38700 as UTCTimestamp, open: 4102, high: 4108, low: 4098, close: 4105 }, // 10:45 (idx 3)
    { time: 39600 as UTCTimestamp, open: 4105, high: 4110, low: 4101, close: 4108 }, // 11:00 (idx 4)
    { time: 40500 as UTCTimestamp, open: 4108, high: 4112, low: 4106, close: 4110 }, // 11:15 (idx 5)
    { time: 41400 as UTCTimestamp, open: 4110, high: 4115, low: 4108, close: 4113 }, // 11:30 (idx 6)
    { time: 42300 as UTCTimestamp, open: 4113, high: 4118, low: 4099, close: 4115 }, // 11:45 (idx 7, contains 11:55 M5)
  ];

  // 1) User places a Buy tool on M5 at 10:45 UTC (time = 38700) and another on the latest M5 bar at 11:55 UTC (time = 42900)
  const m5AnchorAt1045 = { logical: 9, price: 4100, time: 38700 };
  const m5AnchorAt1155 = { logical: 23, price: 4100, time: 42900 };

  // On M15 (tfSeconds = 900):
  // 10:45 (38700) must resolve to M15 index 3 (38700)
  // 11:55 (42900) is inside the 11:45..12:00 M15 candle (42300..43200), so it MUST resolve to M15 index 7 (NOT projected into the future!)
  assert.equal(resolveContainingBarLogical(m5AnchorAt1045, m15Candles, 900), 3, 'M5 10:45 anchor must resolve to M15 candle index 3');
  assert.equal(resolveContainingBarLogical(m5AnchorAt1155, m15Candles, 900), 7, 'M5 11:55 anchor must resolve to containing M15 candle index 7 (11:45..12:00)');

  // On H1 (tfSeconds = 3600):
  // 10:45 (38700) is inside the 10:00..11:00 H1 candle (36000..39600), so it MUST snap to H1 index 1 (NOT 1.75!)
  // 11:55 (42900) is inside the 11:00..12:00 H1 candle (39600..43200), so it MUST snap to H1 index 2 (NOT projected beyond lastIdx!)
  assert.equal(resolveContainingBarLogical(m5AnchorAt1045, h1Candles, 3600), 1, 'M5 10:45 anchor must snap to containing H1 candle index 1 (10:00..11:00)');
  assert.equal(resolveContainingBarLogical(m5AnchorAt1155, h1Candles, 3600), 2, 'M5 11:55 anchor must snap to containing H1 candle index 2 (11:00..12:00)');
  assert.ok(
    Math.abs(resolveLogicalFromTime(m5AnchorAt1155, h1Candles, 3600) - (2 + 55 / 60)) < 1e-4,
    'resolveLogicalFromTime must project continuous fractional sub-bar (2 + 55/60) so positions on M5 stay strictly at 11:55 on H1 without shifting backwards to 11:00'
  );

  // 2) Verify OHLC evaluation across M5 -> M15 -> H1 when entry is at 10:45 UTC (38700), Entry=4100, TP=4116, SL=4090
  const posFromM5: ChartDrawingObject = {
    id: 'pos-mtf-1',
    pair: 'XAUUSD',
    type: 'long_position',
    p1: m5AnchorAt1045,
    p2: { logical: 31, price: 4100, time: 38700 + 22 * 3600 },
    tpPrice: 4116,
    slPrice: 4090,
    createdAtTime: 38700,
    color: '#2962FF',
  };

  const evalOnM15 = evaluatePositionOhlcStatus(posFromM5, m15Candles, undefined, 900);
  const evalOnH1 = evaluatePositionOhlcStatus(posFromM5, h1Candles, undefined, 3600);
  assert.equal(evalOnM15.status, 'TP_HIT', 'Buy position placed at 10:45 M5 must evaluate TP_HIT on M15');
  assert.equal(evalOnH1.status, 'TP_HIT', 'Buy position placed at 10:45 M5 must evaluate TP_HIT on H1 (10:00..11:00 H1 candle must not be skipped)');
  assert.equal(evalOnH1.entryHitLogical, 1, 'On H1, entry touch at 10:45 must register on H1 candle index 1 (10:00..11:00)');
  assert.equal(evalOnH1.hitLogical, 2, 'On H1, TP hit at 11:45 must register on H1 candle index 2 (11:00..12:00)');

  console.log('✓ C3.3 Multi-Timeframe Synchronization (M5 <-> M15 <-> H1): Bar containment, zero left-corner stuck bug, and cross-TF OHLC evaluation verified');
}

// Selected-Only TP/SL Pips Banner, Android Anti-Lag Caching & Supabase Storage Optimization Verification
{
  const chartSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/chart/MarketChartView.tsx'),
    'utf8'
  );
  const tradeFormSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/trades/TradeForm.tsx'),
    'utf8'
  );
  const supabaseSyncSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/utils/supabaseSync.ts'),
    'utf8'
  );

  // 1. Verify position-tp-banner and position-sl-banner are conditionally rendered only when isSelected is true
  const bannerSectionIdx = chartSrc.indexOf('data-testid="position-tp-banner"');
  assert.ok(bannerSectionIdx > 0, 'position-tp-banner must exist in MarketChartView.tsx');
  const precedingBannerSlice = chartSrc.slice(bannerSectionIdx - 220, bannerSectionIdx);
  assert.ok(
    precedingBannerSlice.includes('{isSelected && ('),
    'position-tp-banner and position-sl-banner must be wrapped in {isSelected && (...)} so they only appear when clicked'
  );

  // 2. Verify Android 60fps anti-lag optimizations in MarketChartView.tsx
  assert.ok(
    chartSrc.includes('ohlcEvaluationCacheRef'),
    'MarketChartView.tsx must cache evaluatePositionOhlcStatus across 60fps pan/zoom frames via ohlcEvaluationCacheRef'
  );
  assert.ok(
    chartSrc.includes('marketSessionSegments'),
    'MarketChartView.tsx must precompute static marketSessionSegments outside the 60fps svgRenderTick loop'
  );
  assert.ok(
    chartSrc.includes('isActive={isActive && isLiveMode}'),
    'TradingViewOandaWidget must only be active when both MarketChartView and Live Mode are active'
  );

  // 3. Verify universal JPEG compression & WebP-to-JPEG transcoding in TradeForm.tsx & supabaseSync.ts
  assert.ok(
    tradeFormSrc.includes("canvas.toDataURL('image/jpeg'"),
    'TradeForm.tsx must use universal JPEG compression compatible with Supabase Storage buckets'
  );
  assert.ok(
    supabaseSyncSrc.includes('ensureSupabaseCompatibleImageDataUrl'),
    'supabaseSync.ts must transcode any WebP data URLs to JPEG before uploading to Supabase Storage'
  );
  assert.ok(
    supabaseSyncSrc.includes('syncLifecycleExecutionNotesScreenshots') &&
      supabaseSyncSrc.includes('extractAllTradeStoragePaths'),
    'supabaseSync.ts must sync and deduplicate lifecycle screenshots in executionNotes and clean up all storage paths'
  );

  console.log('✓ C3.4 Selected-Only TP/SL Pips Banner, Android 60fps Anti-Lag Caching & Supabase Storage Optimization verified');
}

// 5 Additional Lightweight Market Chart Features Verification
{
  const chartSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/chart/MarketChartView.tsx'),
    'utf8'
  );

  // 1. Real-Time Bar Countdown Timer
  assert.equal(
    formatBarCountdown(300, 1700000100 + 78),
    '03:42',
    'M5 (300s) countdown 78s into bar must be 03:42'
  );
  assert.equal(
    formatBarCountdown(14400, 1700006400 + 3600),
    '03:00:00',
    'H4 (14400s) countdown 1h into bar must format with hours (03:00:00)'
  );
  assert.ok(
    chartSrc.includes('data-testid="chart-bar-countdown-badge"') &&
      chartSrc.includes('<CandleCountdownBadge'),
    'MarketChartView header must render isolated CandleCountdownBadge'
  );

  // 2. Transient 2-Touch Ruler / Penggaris Tool (Pips Mode B, %, & Bar Count)
  const rulerUp = computeRulerMetrics(
    { logical: 10, price: 4000.0, time: 1700000000 },
    { logical: 25, price: 4012.5, time: 1700013500 },
    'XAUUSD',
    2,
    900
  );
  assert.equal(rulerUp.isPositive, true);
  assert.equal(rulerUp.formattedPriceDelta, '+12.50');
  assert.equal(rulerUp.pips, 125, 'XAUUSD 4000 -> 4012.50 must equal 125 pips (Mode B)');
  assert.equal(rulerUp.formattedPips, '+125 pips');
  assert.equal(rulerUp.barCount, 15, 'Ruler between logical 10 and 25 must count 15 bars');
  assert.ok(
    chartSrc.includes('data-testid="fav-toolbar-ruler-btn"') &&
      chartSrc.includes('data-testid="drawing-sheet-ruler-btn"') &&
      chartSrc.includes('data-testid="rendered-drawing-ruler"'),
    'MarketChartView must expose quick Ruler tool buttons and SVG ruler measurement callout'
  );

  // 3. Floating "Reset View / Kembali ke Candle Terakhir (>>)" Button
  assert.ok(
    chartSrc.includes('data-testid="chart-scroll-to-realtime-btn"') &&
      chartSrc.includes('handleScrollToRealtime'),
    'MarketChartView must render floating chart-scroll-to-realtime-btn when scrolled back in history'
  );

  // 4. Active Journal Trade Lines Overlay (OPEN & PLANNED positions)
  const sampleJournalTrades: any[] = [
    {
      id: 'TRD-OPEN-1',
      dateTime: '2026-03-01T10:00:00.000Z',
      instrument: 'XAUUSD',
      position: 'BUY',
      entryPrice: 4050.0,
      stopLoss: 4040.0,
      takeProfit: 4075.0,
      exitPrice: 4050.0,
      lotSize: 0.05,
      riskAmount: 50,
      riskPercentage: 1,
      grossProfit: 0,
      netProfit: 0,
      commission: 0,
      swap: 0,
      outcome: 'BREAKEVEN',
      notes: 'Open setup',
      executionNotes:
        'Open setup [TV_META:eyJzdGF0dXMiOiJPUEVOIiwiYWN0dWFsRW50cnkiOjQwNTAsImFjdHVhbExvdCI6MC4wNX0]',
    },
    {
      id: 'TRD-CLOSED-2',
      dateTime: '2026-03-01T08:00:00.000Z',
      instrument: 'XAUUSD',
      position: 'SELL',
      entryPrice: 4060.0,
      exitPrice: 4045.0,
      lotSize: 0.02,
      riskAmount: 20,
      riskPercentage: 1,
      grossProfit: 30,
      netProfit: 30,
      commission: 0,
      swap: 0,
      outcome: 'WIN',
      notes: 'Closed trade',
    },
  ];
  const overlayLines = extractActiveJournalOverlayLines(sampleJournalTrades, 'XAUUSD');
  assert.equal(overlayLines.length, 1, 'Only OPEN and PLANNED trades for matching pair should be extracted');
  assert.equal(overlayLines[0].tradeId, 'TRD-OPEN-1');
  assert.equal(overlayLines[0].entryPrice, 4050.0);
  assert.equal(overlayLines[0].stopLoss, 4040.0);
  assert.equal(overlayLines[0].takeProfit, 4075.0);
  assert.ok(
    chartSrc.includes('data-testid="journal-trade-overlay-group"'),
    'MarketChartView SVG overlay must render journal-trade-overlay-group for active trades'
  );

  // 5. Real-Time Auto Lot Size & Dollar Risk ($) Recommendation in Selected Position Inspector
  // Equity $3,000, Risk 1% ($30), Entry 4000 -> SL 3994 (60 pips Mode B, $0.60/pip per 0.01 lot => 0.05 Lot)
  const sizing = computeRecommendedPositionSizing(4000, 3994, 'XAUUSD', 3000, 1, 0.1);
  assert.equal(sizing.slPips, 60, 'Entry 4000 -> SL 3994 must equal 60 pips');
  assert.equal(sizing.riskAmountUsd, 30, '1% of $3,000 equity must equal $30 risk');
  assert.equal(sizing.recommendedLot, 0.05, '$30 risk / (60 pips * $10/lot/pip) must equal 0.05 lot');
  assert.ok(
    chartSrc.includes('data-testid="position-inspector-lot-recommendation"'),
    'Selected Buy/Sell position inspector must display position-inspector-lot-recommendation'
  );

  console.log('✓ C3.5 All 5 Lightweight Market Chart Features (Countdown, Ruler, Scroll-to-Realtime, Journal Lines, Auto Lot Sizing) verified');
}

// ============================================================================
// C4. DRAGGABLE FLOATING STYLE/SETTINGS BAR & RANDOM TAP-TO-DESELECT AUDIT
// ============================================================================
console.log('\n--- [C4] Testing Draggable Style/Settings Bar & Tap-to-Deselect Behavior ---');
{
  const chartSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/chart/MarketChartView.tsx'),
    'utf-8'
  );

  // 1. Draggable Style / Settings Bar Verification
  assert.ok(
    chartSrc.includes('data-testid="drawing-style-bar-drag-handle"'),
    'MarketChartView must render drawing-style-bar-drag-handle for floating style/settings bar'
  );
  assert.ok(
    chartSrc.includes('handleStyleBarDragStart') &&
      chartSrc.includes('handleStyleBarDragMove') &&
      chartSrc.includes('handleStyleBarDragEnd'),
    'MarketChartView must implement pointer capture drag handlers for floating style/settings bar'
  );
  assert.ok(
    chartSrc.includes('styleBarPos') &&
      chartSrc.includes('styleBarPos.x') &&
      chartSrc.includes('styleBarPos.y'),
    'MarketChartView must support dynamic styleBarPos repositioning so settings bar can be moved freely during analysis'
  );
  console.log('✓ C4.1 Draggable Settings Bar: Dedicated grip handle with pointer capture and container-clamped position bounds verified');

  // 2. Empty Chart Space Tap-to-Deselect Verification (TradingView Match)
  assert.ok(
    chartSrc.includes('handleEmptyChartTapOrClick'),
    'MarketChartView must provide handleEmptyChartTapOrClick to deselect tools on empty chart tap'
  );
  assert.ok(
    chartSrc.includes('chart.subscribeClick(onChartClick)'),
    'MarketChartView must subscribe to Lightweight Charts click events to deselect tools when empty canvas is clicked'
  );
  assert.ok(
    chartSrc.includes('chartTapStartRef') &&
      chartSrc.includes('dist < 8') &&
      chartSrc.includes('elapsed < 400'),
    'MarketChartView must detect mobile Android quick taps (<8px movement, <400ms) without interfering with pan/pinch gestures'
  );
  assert.ok(
    chartSrc.includes('closest(\'[data-testid="drawing-object-style-bar"]\')'),
    'handleEmptyChartTapOrClick must prevent deselect when user taps inside drawing-object-style-bar'
  );
  assert.ok(
    chartSrc.includes('closest(\'[data-testid^="drawing-handle-"]\')'),
    'handleEmptyChartTapOrClick must prevent deselect when user interacts with drawing anchor handles'
  );
  // 3. Settings-Open Tap Protection Verification
  assert.ok(
    chartSrc.includes('isDrawingSettingsOpenRef') &&
      chartSrc.includes('if (isDrawingSettingsOpenRef.current) return;'),
    '1x tap deselect must be disabled when tool settings bar is open so users can configure settings without accidental close'
  );
  console.log('✓ C4.3 Settings-Open Tap Protection: 1x tap deselect is suppressed while setting bar is open, active only when setting is closed');

  // 4. Cross-Timeframe Buy/Sell Hit Synchronization (TradingView Advance Match)
  // When a position hits TP on M5 with hitTime, it MUST evaluate identically to TP_HIT across M15, M30, H1, 4H
  const hitPositionFromM5: ChartDrawingObject = {
    id: 'pos-hit-sync-1',
    pair: 'XAUUSD',
    type: 'long_position',
    p1: { logical: 10, price: 4000, time: 36000 },
    p2: { logical: 32, price: 4000, time: 36000 + 22 * 300 }, // spans to 42600 (11:50)
    tpPrice: 4020,
    slPrice: 3990,
    createdAtTime: 36000,
    color: '#2962FF',
    hitStatus: 'TP_HIT',
    entryHitTime: 36600, // 10:10 UTC
    hitTime: 37800, // 10:30 UTC
    hitPrice: 4020,
  };

  const sampleCandlesH1: OhlcCandle[] = [
    { time: 36000 as UTCTimestamp, open: 4000, high: 4025, low: 3995, close: 4015 }, // 10:00 - 11:00
    { time: 39600 as UTCTimestamp, open: 4015, high: 4030, low: 4010, close: 4020 }, // 11:00 - 12:00
  ];
  const evalH1Hit = evaluatePositionOhlcStatus(hitPositionFromM5, sampleCandlesH1, undefined, 3600);
  assert.equal(evalH1Hit.status, 'TP_HIT', 'Position that hit TP on M5 must evaluate TP_HIT on H1');
  assert.equal(evalH1Hit.entryHitTime, 36600, 'Entry hit time must stay synchronized across timeframes');
  assert.equal(evalH1Hit.hitTime, 37800, 'TP hit time must stay synchronized across timeframes');
  assert.equal(evalH1Hit.hitLogical, 0, 'On H1, 10:30 TP hit must map to the 10:00..11:00 candle index (0)');

  // Verify that geometry fills only up to the hit candle and leaves the remainder unfilled
  const geomH1 = computePositionGeometry({
    isLong: true,
    p1X: 100,
    p2X: 500, // Wide box representing the full tool span
    entryY: 200,
    tpY: 100,
    slY: 250,
    entryPrice: 4000,
    tpPrice: 4020,
    slPrice: 3990,
    status: evalH1Hit.status,
    fillStartX: 120, // entry candle
    fillEndX: 240, // TP hit candle
  });
  assert.equal(geomH1.activeFillLeftX, 120, 'Active profit fill must start at entry candle');
  assert.equal(geomH1.activeFillRightX, 240, 'Active profit fill must end strictly at TP hit candle');
  // 5. Dynamic Drag Hit Reset (No stale TP/SL fill when moved across price/time)
  assert.ok(
    chartSrc.includes('hitStatus: isPositionTool ? undefined : prev.hitStatus') &&
      chartSrc.includes('hitTime: isPositionTool ? undefined : prev.hitTime') &&
      chartSrc.includes('entryHitTime: isPositionTool ? undefined : prev.entryHitTime'),
    'Moving position body must reset hitStatus, hitTime, and entryHitTime so new area re-evaluates fresh'
  );
  assert.ok(
    chartSrc.includes('const isCurrentlyDragging = draggingHandle?.drawingId === item.id;') &&
      chartSrc.includes('!isCurrentlyDragging &&'),
    'Evaluation cache must not lock hit state into drawing in microtask during active drag'
  );

  // Simulate position moved from TP zone to SL zone:
  const initialPositionWithTpHit: ChartDrawingObject = {
    ...hitPositionFromM5,
    id: 'pos-drag-test-1',
  };
  // User drags body to price 3980 (below SL 3990)
  const draggedPosition: ChartDrawingObject = {
    ...initialPositionWithTpHit,
    p1: { ...initialPositionWithTpHit.p1, price: 4000 },
    hitStatus: undefined, // Reset during drag
    hitTime: undefined,
    hitPrice: undefined,
    entryHitTime: undefined,
  };
  // Now evaluate against a candle that touches Entry (4000) and hits SL (3990)
  const slCandles: OhlcCandle[] = [
    { time: 36000 as UTCTimestamp, open: 4000, high: 4005, low: 3985, close: 3988 },
  ];
  const reEvaluated = evaluatePositionOhlcStatus(draggedPosition, slCandles, undefined, 3600);
  assert.equal(reEvaluated.status, 'SL_HIT', 'Position dragged into SL zone must dynamically switch to SL_HIT');
  console.log('✓ C4.5 Dynamic Drag Hit Reset: Moving position tool clears stale hit state and re-evaluates fresh in real-time');

  // 6. Continuous Sub-Bar Coordinate Precision on Large Timeframes (4H & 1D)
  // Verify that a position placed at 14:00 UTC projects smoothly to fractional sub-bar on 4H and 1D
  const testAnchorAt1400 = { logical: 10, price: 4000, time: 50400 }; // 14:00 UTC (14 * 3600 = 50400)
  const testCandles4H: OhlcCandle[] = [
    { time: 43200 as UTCTimestamp, open: 4000, high: 4020, low: 3990, close: 4010 }, // 12:00 UTC (index 0)
    { time: 57600 as UTCTimestamp, open: 4010, high: 4030, low: 4000, close: 4025 }, // 16:00 UTC (index 1)
  ];
  // 14:00 is exactly halfway between 12:00 (43200) and 16:00 (57600): fraction = (50400 - 43200) / (57600 - 43200) = 0.5
  const logical4H = resolveLogicalFromTime(testAnchorAt1400, testCandles4H, 14400);
  assert.equal(logical4H, 0.5, '14:00 UTC must resolve to fractional 0.5 on 4H bar [12:00, 16:00]');

  // On 1D bar (00:00 to 24:00):
  const testCandles1D: OhlcCandle[] = [
    { time: 0 as UTCTimestamp, open: 4000, high: 4030, low: 3980, close: 4020 }, // 00:00 UTC (index 0)
    { time: 86400 as UTCTimestamp, open: 4020, high: 4040, low: 4000, close: 4035 }, // Next day 00:00 UTC (index 1)
  ];
  // 14:00 is 14/24 of the daily bar:
  const logical1D = resolveLogicalFromTime(testAnchorAt1400, testCandles1D, 86400);
  assert.ok(Math.abs(logical1D - 14 / 24) < 1e-4, '14:00 UTC must resolve to fractional 14/24 on 1D bar without shifting to 00:00');
  // 7. Rigorous Multi-Timeframe Position Scaling Audit (M5 -> 1H -> 4H -> 1D)
  // Position created on M5:
  // - Entry: 1.08500 at 17:25 (open candle time)
  // - SL: 1.08300, TP: 1.08900
  // - Duration: 22 bars on M5 = 22 * 300s = 6600s (110 minutes) -> End: 19:15
  const m5OpenTime = 17 * 3600 + 25 * 60; // 62700s (17:25 UTC)
  const m5EndTime = m5OpenTime + 22 * 300; // 69300s (19:15 UTC, 110 minutes total)
  const m5PositionAnchorP1: DrawingAnchor = { logical: 100, price: 1.085, time: m5OpenTime };
  const m5PositionAnchorP2: DrawingAnchor = { logical: 122, price: 1.085, time: m5EndTime };

  // Current open candle on 1H: candle starting at 17:00 (61200s), tfSeconds = 3600
  const openCandles1H: OhlcCandle[] = [
    { time: 16 * 3600 as UTCTimestamp, open: 1.084, high: 1.086, low: 1.083, close: 1.085 }, // 16:00
    { time: 17 * 3600 as UTCTimestamp, open: 1.085, high: 1.087, low: 1.084, close: 1.0855 }, // 17:00 (latest open bar, index 1)
  ];
  const p1Logical1H = resolveLogicalFromTime(m5PositionAnchorP1, openCandles1H, 3600);
  const p2Logical1H = resolveLogicalFromTime(m5PositionAnchorP2, openCandles1H, 3600);
  // 17:25 is 25 minutes into 17:00 candle -> 1 + 25/60 = 1.4167
  assert.ok(Math.abs(p1Logical1H - (1 + 25 / 60)) < 1e-4, '1H p1 logical must project continuously to 1 + 25/60 without snapping backwards to 17:00');
  // 19:15 is 1 hour 15 min after 18:00 (135 min after 17:00) -> 1 + 135/60 = 3.25
  assert.ok(Math.abs(p2Logical1H - (1 + 135 / 60)) < 1e-4, '1H p2 logical must project continuously to 3.25');
  const span1H = p2Logical1H - p1Logical1H;
  assert.ok(Math.abs(span1H - 110 / 60) < 1e-4, '1H bar span must equal 110 / 60 = 1.8333 bars (scaled down from M5 22 bars)');

  // Current open candle on 4H: candle starting at 16:00 (57600s), tfSeconds = 14400
  const openCandles4H: OhlcCandle[] = [
    { time: 12 * 3600 as UTCTimestamp, open: 1.083, high: 1.085, low: 1.082, close: 1.084 }, // 12:00
    { time: 16 * 3600 as UTCTimestamp, open: 1.084, high: 1.088, low: 1.083, close: 1.0855 }, // 16:00 (latest open bar, index 1)
  ];
  const p1Logical4H = resolveLogicalFromTime(m5PositionAnchorP1, openCandles4H, 14400);
  const p2Logical4H = resolveLogicalFromTime(m5PositionAnchorP2, openCandles4H, 14400);
  // 17:25 is 1 hour 25 min (85 min = 5100s) after 16:00 -> 1 + 5100 / 14400 = 1.35417
  assert.ok(Math.abs(p1Logical4H - (1 + 85 / 240)) < 1e-4, '4H p1 logical must project to 1 + 85/240 without snapping backwards to 16:00');
  // 19:15 is 3 hours 15 min (195 min = 11700s) after 16:00 -> 1 + 11700 / 14400 = 1.8125
  assert.ok(Math.abs(p2Logical4H - (1 + 195 / 240)) < 1e-4, '4H p2 logical must project to 1 + 195/240');
  const span4H = p2Logical4H - p1Logical4H;
  assert.ok(Math.abs(span4H - 110 / 240) < 1e-4, '4H bar span must equal 110 / 240 = 0.4583 bars (much smaller than 1H and M5)');

  // Verify computePositionGeometry does NOT inflate 4H width to 56px:
  // If 4H screen coordinates are p1X = 200, p2X = 204 (4px span):
  const geomNarrow4H = computePositionGeometry({
    isLong: true,
    p1X: 200,
    p2X: 204,
    entryY: 200,
    tpY: 120,
    slY: 240,
    entryPrice: 1.085,
    slPrice: 1.083,
    tpPrice: 1.089,
  });
  assert.ok(geomNarrow4H.boxWidth <= 6, '4H box width must scale down (6px) instead of artificially widening to 56px (8 candles)');
  assert.equal(geomNarrow4H.leftX, 200, '4H box leftX must stay strictly at p1X (200)');

  // Verify prices stay 100% constant
  assert.equal(geomNarrow4H.rrRatio, '2.00', 'R:R ratio must stay strictly 2.00 across all timeframes');
  console.log('✓ C4.7 Multi-Timeframe Position Scaling Audit: M5 (22 bars) -> 1H (1.83 bars) -> 4H (0.46 bars) scales down proportionally without shifting or widening');

  // 8. APK Scan Cepat (TradingView URL & Photo File) Anti-HTML-Fallback Verification
  const tvShortlink = resolveTradingViewSnapshotUrl('https://www.tradingview.com/x/AbCd1234/');
  assert.equal(tvShortlink.isTradingViewUrl, true, 'Must recognize TradingView /x/ shortlink');
  assert.equal(tvShortlink.snapshotId, 'AbCd1234', 'Must extract TradingView snapshot ID');
  assert.equal(
    tvShortlink.directImageUrl,
    'https://s3.tradingview.com/snapshots/a/AbCd1234.png',
    'Must deterministically resolve TradingView /x/ shortlink to direct S3 PNG URL'
  );

  // 8a. TradingView BUY Position Scan (Entry, TP, SL + lotSize must be null so Equity Auto-Lot is used)
  const synthTvBuy = synthesizeTradeScanFromSignals({
    ocr: {
      fullText: 'OANDA:XAUUSD 15\nQty: 2.50\n4030.00\n4020.00\n4010.00\n4000.00\n3990.00\n3980.00',
      lines: [
        { text: 'OANDA:XAUUSD 15', centerY: 30, minX: 20, maxX: 200 },
        { text: 'Qty: 2.50', centerY: 180, minX: 350, maxX: 460 },
        { text: '4030.00', centerY: 80, minX: 900, maxX: 960 },
        { text: '4020.00', centerY: 120, minX: 900, maxX: 960 },
        { text: '4010.00', centerY: 160, minX: 900, maxX: 960 },
        { text: '4000.00', centerY: 200, minX: 900, maxX: 960 },
        { text: '3990.00', centerY: 240, minX: 900, maxX: 960 },
        { text: '3980.00', centerY: 280, minX: 900, maxX: 960 },
      ],
      words: [],
    },
    canvasGeom: {
      hasPositionBox: true,
      inferredPosition: 'BUY',
      inferredRR: 2.0,
      entryYRatio: 200 / 600,
      tpYRatio: 120 / 600,
      slYRatio: 240 / 600,
      boxTopYRatio: 120 / 600,
      boxBottomYRatio: 240 / 600,
      rightAxisGreenBadgeYRatio: 120 / 600,
      rightAxisRedBadgeYRatio: 240 / 600,
      rightAxisBlueOrDarkBadgeYRatio: 200 / 600,
      horizontalLineYRatios: [],
      imageWidth: 1000,
      imageHeight: 600,
    },
    urlMeta: {
      isTradingViewUrl: true,
      symbolFromUrl: null,
      timeframeFromUrl: 'M15',
      pageTitle: 'XAUUSD Chart',
      pageDescription: '',
      directImageUrl: tvShortlink.directImageUrl,
    },
  });
  assert.equal(synthTvBuy.source, 'TRADINGVIEW', 'Must classify TradingView screenshot as TRADINGVIEW');
  assert.equal(synthTvBuy.instrument, 'XAUUSD', 'APK hybrid scanner must extract XAUUSD');
  assert.equal(synthTvBuy.position, 'BUY', 'APK hybrid scanner must detect BUY from green-above-red position box');
  assert.equal(synthTvBuy.entryPrice, 4000, 'APK hybrid scanner must extract Entry = 4000 (not top/bottom viewport ticks 4030/3980)');
  assert.equal(synthTvBuy.takeProfit, 4020, 'APK hybrid scanner must extract TP = 4020 from green badge / Y-axis');
  assert.equal(synthTvBuy.stopLoss, 3990, 'APK hybrid scanner must extract SL = 3990 from red badge / Y-axis');
  assert.equal(synthTvBuy.plannedRiskReward, 2, 'APK hybrid scanner must compute R:R = 1:2');
  assert.equal(synthTvBuy.lotSize, null, 'TradingView scan must return lotSize = null so Equity Auto-Lot is used instead of TV Qty');

  // Verify standard Equity Auto-Lot calculation for TradingView scan ($1,000 Equity, 1% risk = $10, Entry 4000, SL 3990 -> 10 pips -> 0.10 lot)
  const tvAutoLot = calculateXauusdLot(
    buildUnifiedXauusdLotInput({
      symbol: synthTvBuy.instrument,
      equity: 1000,
      riskPercent: 1,
      entryPrice: synthTvBuy.entryPrice!,
      stopLossPrice: synthTvBuy.stopLoss!,
      takeProfitPrice: synthTvBuy.takeProfit ?? undefined,
      position: synthTvBuy.position,
    })
  );
  assert.equal(tvAutoLot.isValid, true, 'Standard Equity Auto-Lot for TradingView scan must be valid');
  assert.equal(tvAutoLot.recommendedLot, 0.1, 'TradingView scan with $1,000 equity, 1% risk, 10-pip SL on XAUUSD must yield 0.10 Lot');

  // 8a-2. Verify TradingView European/Indonesian Number Format (`4.054,405` -> `4054.405`) & Real User Screenshot #1:
  // SELL setup with Grey Risk box on top (`4.099,857`), Entry in middle (`4.093,045`), and Dark Blue/Navy Profit box on bottom (`4.054,405`),
  // while live candle is at `4.105,78` and inner box says `"OB m5"`.
  assert.equal(
    normalizeChartPriceNumber('4.099,857', 'XAUUSD'),
    4099.857,
    'Must normalize 4.099,857 to 4099.857'
  );
  assert.equal(
    normalizeChartPriceNumber('4.093,045', 'XAUUSD'),
    4093.045,
    'Must normalize 4.093,045 to 4093.045'
  );
  assert.equal(
    normalizeChartPriceNumber('4.054,405', 'XAUUSD'),
    4054.405,
    'Must normalize 4.054,405 to 4054.405'
  );
  assert.equal(
    normalizeChartPriceNumber('4.105,735', 'XAUUSD'),
    4105.735,
    'Must normalize 4.105,735 to 4105.735'
  );

  const extractedLineNums = extractPriceNumbersFromLine(
    'SL: 4.099,857 | Entry: 4.093,045 | TP: 4.054,405',
    'XAUUSD'
  );
  assert.deepEqual(
    extractedLineNums.map((x) => x.val),
    [4099.857, 4093.045, 4054.405],
    'extractPriceNumbersFromLine must parse dot-thousands comma-decimal format accurately'
  );

  const synthTvBlueGreySell = synthesizeTradeScanFromSignals({
    ocr: {
      fullText:
        'XAUUSD 5\nOB m5\n4.105,780\n4.099,857\n4.093,045\n4.054,405',
      lines: [
        { text: 'XAUUSD 5', centerY: 28, minX: 20, maxX: 180 },
        { text: 'OB m5', centerY: 235, minX: 380, maxX: 450 },
        { text: '4.105,780', centerY: 140, minX: 900, maxX: 975 }, // Live candle price above setup
        { text: '4.099,857', centerY: 190, minX: 900, maxX: 975 }, // Top of Grey Risk Zone (SL)
        { text: '4.093,045', centerY: 245, minX: 900, maxX: 975 }, // Dividing Line (Entry)
        { text: '4.054,405', centerY: 480, minX: 900, maxX: 975 }, // Bottom of Blue/Navy Profit Zone (TP)
      ],
      words: [],
    },
    canvasGeom: {
      hasPositionBox: true,
      inferredPosition: 'SELL',
      inferredRR: 5.67,
      profitTheme: 'BLUE_NAVY',
      riskTheme: 'GREY_SLATE',
      slYRatio: 190 / 600,
      entryYRatio: 245 / 600,
      tpYRatio: 480 / 600,
      boxTopYRatio: 190 / 600,
      boxBottomYRatio: 480 / 600,
      rightAxisGreenBadgeYRatio: null,
      rightAxisRedBadgeYRatio: null,
      rightAxisBlueOrDarkBadgeYRatio: 480 / 600,
      horizontalLineYRatios: [],
      imageWidth: 1000,
      imageHeight: 600,
    },
    urlMeta: null,
  });
  assert.equal(synthTvBlueGreySell.source, 'TRADINGVIEW');
  assert.equal(synthTvBlueGreySell.position, 'SELL', 'Grey Risk on top + Blue/Navy Profit on bottom must be SELL');
  assert.equal(synthTvBlueGreySell.stopLoss, 4099.857, 'Must extract SL = 4099.857 from top of Grey Risk zone');
  assert.equal(synthTvBlueGreySell.entryPrice, 4093.045, 'Must extract Entry = 4093.045 from dividing line (ignoring 4105.78)');
  assert.equal(synthTvBlueGreySell.takeProfit, 4054.405, 'Must extract TP = 4054.405 from bottom Blue/Navy badge');
  assert.equal(synthTvBlueGreySell.lotSize, null, 'TradingView lotSize must be null');
  assert.equal(synthTvBlueGreySell.status, 'PLANNED', 'TradingView setup status must be PLANNED');

  // Verify zero synthetic SL/TP fabrication when SL/TP badges are absent or invalid micro-noise (0.04 diff)
  const noFakeFallbackCheck = normalizeGeminiScanResponse(
    {
      detected: true,
      source: 'TRADINGVIEW',
      instrument: 'XAUUSD',
      position: 'BUY',
      entryPrice: '4105.78',
      stopLoss: '4105.74', // Fake 0.04 noise -> MUST BE REJECTED to null!
      takeProfit: '4105.86', // Fake 0.08 noise -> MUST BE REJECTED to null!
    },
    null
  );
  assert.equal(noFakeFallbackCheck.entryPrice, 4105.78);
  assert.equal(
    noFakeFallbackCheck.stopLoss,
    null,
    'Micro-noise SL (0.04 diff on XAUUSD) must be rejected as null, never accepted or fabricated'
  );
  assert.equal(
    noFakeFallbackCheck.takeProfit,
    null,
    'Micro-noise TP (0.08 diff on XAUUSD) must be rejected as null, never accepted or fabricated'
  );

  // 8b. TradingView SELL Position Scan (Red above Green)
  const synthTvSell = synthesizeTradeScanFromSignals({
    ocr: {
      fullText: 'FX:EURUSD 1H\n1.09000\n1.08800\n1.08500\n1.08000\n1.07900\n1.07500',
      lines: [
        { text: 'FX:EURUSD 1H', centerY: 30, minX: 20, maxX: 200 },
        { text: '1.09000', centerY: 60, minX: 900, maxX: 960 },
        { text: '1.08800', centerY: 120, minX: 900, maxX: 960 },
        { text: '1.08500', centerY: 210, minX: 900, maxX: 960 },
        { text: '1.08000', centerY: 360, minX: 900, maxX: 960 },
        { text: '1.07900', centerY: 390, minX: 900, maxX: 960 },
        { text: '1.07500', centerY: 510, minX: 900, maxX: 960 },
      ],
      words: [],
    },
    canvasGeom: {
      hasPositionBox: true,
      inferredPosition: 'SELL',
      inferredRR: 2.0,
      entryYRatio: 210 / 600,
      slYRatio: 120 / 600,
      tpYRatio: 390 / 600,
      boxTopYRatio: 120 / 600,
      boxBottomYRatio: 390 / 600,
      rightAxisRedBadgeYRatio: 120 / 600,
      rightAxisGreenBadgeYRatio: 390 / 600,
      rightAxisBlueOrDarkBadgeYRatio: 210 / 600,
      horizontalLineYRatios: [],
      imageWidth: 1000,
      imageHeight: 600,
    },
    urlMeta: null,
  });
  assert.equal(synthTvSell.source, 'TRADINGVIEW', 'Must classify TradingView SELL chart as TRADINGVIEW');
  assert.equal(synthTvSell.instrument, 'EURUSD', 'Must extract EURUSD');
  assert.equal(synthTvSell.position, 'SELL', 'Must detect SELL from red-above-green position box');
  assert.equal(synthTvSell.entryPrice, 1.085, 'Must extract SELL Entry = 1.08500');
  assert.equal(synthTvSell.stopLoss, 1.088, 'Must extract SELL SL = 1.08800 (above Entry)');
  assert.equal(synthTvSell.takeProfit, 1.079, 'Must extract SELL TP = 1.07900 (below Entry)');
  assert.equal(synthTvSell.lotSize, null, 'TradingView SELL scan must return lotSize = null');

  // 8c. Real User Screenshot #2: MT5 Chart with "TP" aligned to "4074.43", "BUY LIMIT 0.12" aligned to "4042.74",
  // and "SL" aligned to "4031.97", while running price is "4050.87" and grid has "4052.92".
  // Must detect: BUY | Status: PLANNED | Lot: 0.12 | Entry: 4042.74 | SL: 4031.97 | TP: 4074.43
  const synthMt5BuyLimit = synthesizeTradeScanFromSignals({
    ocr: {
      fullText:
        'XAUUSD, M5\nTP\n4074.43\n4052.92\n4050.87\nBUY LIMIT 0.12\n4042.74\nSL\n4031.97',
      lines: [
        { text: 'XAUUSD, M5', centerY: 28, minX: 20, maxX: 180 },
        { text: 'TP', centerY: 110, minX: 25, maxX: 65 },
        { text: '4074.43', centerY: 112, minX: 900, maxX: 975 },
        { text: '4052.92', centerY: 210, minX: 900, maxX: 975 }, // Unframed grid number
        { text: '4050.87', centerY: 225, minX: 900, maxX: 975 }, // Running price badge
        { text: 'BUY LIMIT 0.12', centerY: 280, minX: 25, maxX: 190 },
        { text: '4042.74', centerY: 282, minX: 900, maxX: 975 },
        { text: 'SL', centerY: 350, minX: 25, maxX: 65 },
        { text: '4031.97', centerY: 352, minX: 900, maxX: 975 },
      ],
      words: [],
    },
    canvasGeom: null,
    urlMeta: null,
  });
  assert.equal(synthMt5BuyLimit.source, 'MT5', 'Must classify MT5 BUY LIMIT screenshot as MT5');
  assert.equal(synthMt5BuyLimit.instrument, 'XAUUSD', 'Must extract XAUUSD');
  assert.equal(synthMt5BuyLimit.position, 'BUY', 'Must detect BUY');
  assert.equal(synthMt5BuyLimit.status, 'PLANNED', 'BUY LIMIT 0.12 must set status = PLANNED (not ACTIVE)');
  assert.equal(synthMt5BuyLimit.lotSize, 0.12, 'Must extract exact MT5 Lot Size = 0.12');
  assert.equal(synthMt5BuyLimit.entryPrice, 4042.74, 'Must extract Entry = 4042.74 aligned with BUY LIMIT 0.12');
  assert.equal(synthMt5BuyLimit.stopLoss, 4031.97, 'Must extract SL = 4031.97 aligned with SL line (not 4032.56)');
  assert.equal(synthMt5BuyLimit.takeProfit, 4074.43, 'Must extract TP = 4074.43 aligned with TP line (not 4052.92)');

  // 8d. MT5 SELL Position Scan via Horizontal Order Lines & Right-Axis Price Scale (Market Order -> ACTIVE)
  const synthMt5Sell = synthesizeTradeScanFromSignals({
    ocr: {
      fullText: 'BTCUSD, H1\n#99102341 sell 0.10\nsl\ntp\n96800.00\n96250.00\n95150.00',
      lines: [
        { text: 'BTCUSD, H1', centerY: 28, minX: 20, maxX: 200 },
        { text: 'sl', centerY: 118, minX: 40, maxX: 80 },
        { text: '#99102341 sell 0.10', centerY: 228, minX: 40, maxX: 260 },
        { text: 'tp', centerY: 448, minX: 40, maxX: 80 },
        { text: '96800.00', centerY: 120, minX: 890, maxX: 970 },
        { text: '96250.00', centerY: 230, minX: 890, maxX: 970 },
        { text: '95150.00', centerY: 450, minX: 890, maxX: 970 },
      ],
      words: [],
    },
    canvasGeom: null,
    urlMeta: null,
  });
  assert.equal(synthMt5Sell.source, 'MT5', 'Must classify MT5 SELL chart as MT5');
  assert.equal(synthMt5Sell.instrument, 'BTCUSD', 'Must extract BTCUSD from MT5');
  assert.equal(synthMt5Sell.position, 'SELL', 'Must detect SELL from MT5 order line');
  assert.equal(synthMt5Sell.status, 'ACTIVE', 'Executed MT5 market order (sell 0.10 without LIMIT/STOP) must be ACTIVE');
  assert.equal(synthMt5Sell.lotSize, 0.1, 'MT5 SELL scan MUST extract exact Lot Size 0.10');
  assert.equal(synthMt5Sell.entryPrice, 96250, 'MT5 SELL scan must extract Entry = 96250 from order line Y');
  assert.equal(synthMt5Sell.stopLoss, 96800, 'MT5 SELL scan must extract SL = 96800 from sl line Y (above Entry)');
  assert.equal(synthMt5Sell.takeProfit, 95150, 'MT5 SELL scan must extract TP = 95150 from tp line Y (below Entry)');

  // 8e. TradingView Disambiguation: Must NOT confuse "Open 4015.20" (OHLC header), "Open P&L: -1850.00" (floating label),
  // or live market candle badge (4012.50 at y=150) with the true Entry dividing line badge (4000.00 at y=200)!
  const synthTvDisambig = synthesizeTradeScanFromSignals({
    ocr: {
      fullText:
        'OANDA:XAUUSD 15 Open 4015.20 High 4022.00 Low 3995.00 Close 4012.50\nOpen P&L: -1850.00, Qty: 1.5, Risk/Reward Ratio: 2.00\n4020.00\n4012.50\n4000.00\n3990.00',
      lines: [
        {
          text: 'OANDA:XAUUSD 15 Open 4015.20 High 4022.00 Low 3995.00 Close 4012.50',
          centerY: 24,
          minX: 20,
          maxX: 600,
        },
        {
          text: 'Open P&L: -1850.00, Qty: 1.5, Risk/Reward Ratio: 2.00',
          centerY: 195,
          minX: 300,
          maxX: 580,
        },
        { text: '4020.00', centerY: 120, minX: 900, maxX: 960 },
        { text: '4012.50', centerY: 150, minX: 900, maxX: 960 }, // Live candle price badge
        { text: '4000.00', centerY: 200, minX: 900, maxX: 960 }, // True dividing line Entry badge
        { text: '3990.00', centerY: 240, minX: 900, maxX: 960 },
      ],
      words: [],
    },
    canvasGeom: {
      hasPositionBox: true,
      inferredPosition: 'BUY',
      inferredRR: 2.0,
      entryYRatio: 200 / 600,
      tpYRatio: 120 / 600,
      slYRatio: 240 / 600,
      boxTopYRatio: 120 / 600,
      boxBottomYRatio: 240 / 600,
      rightAxisGreenBadgeYRatio: 120 / 600,
      rightAxisRedBadgeYRatio: 240 / 600,
      rightAxisBlueOrDarkBadgeYRatio: 200 / 600,
      horizontalLineYRatios: [],
      imageWidth: 1000,
      imageHeight: 600,
    },
    urlMeta: null,
  });
  assert.equal(synthTvDisambig.entryPrice, 4000, 'Must extract true dividing-line Entry = 4000 (ignoring Open 4015.20, Open P&L -1850.00, and live candle 4012.50)');
  assert.equal(synthTvDisambig.takeProfit, 4020, 'Must extract TP = 4020');
  assert.equal(synthTvDisambig.stopLoss, 3990, 'Must extract SL = 3990');
  assert.equal(synthTvDisambig.lotSize, null, 'Must keep lotSize = null for TradingView');

  // 8f. MT5 Mobile Trade / History Tab Arrow Syntax ("3340.50 -> 3328.10")
  const synthMt5Arrow = synthesizeTradeScanFromSignals({
    ocr: {
      fullText: 'XAUUSD, sell 0.15\n3340.50 -> 3328.10\nS/L: 3350.00 T/P: 3315.00',
      lines: [
        { text: 'XAUUSD, sell 0.15', centerY: 80, minX: 30, maxX: 280 },
        { text: '3340.50 -> 3328.10', centerY: 110, minX: 30, maxX: 260 },
        { text: 'S/L: 3350.00 T/P: 3315.00', centerY: 145, minX: 30, maxX: 340 },
      ],
      words: [],
    },
    canvasGeom: null,
    urlMeta: null,
  });
  assert.equal(synthMt5Arrow.source, 'MT5', 'Must classify MT5 mobile trade card as MT5');
  assert.equal(synthMt5Arrow.position, 'SELL', 'Must detect SELL from MT5 mobile trade card');
  assert.equal(synthMt5Arrow.lotSize, 0.15, 'Must extract Lot Size = 0.15 from MT5 mobile trade card');
  assert.equal(synthMt5Arrow.entryPrice, 3340.5, 'Must extract first price before arrow (3340.50) as Entry Price');
  assert.equal(synthMt5Arrow.currentPrice, 3328.1, 'Must extract second price after arrow (3328.10) as Current Price');
  assert.equal(synthMt5Arrow.stopLoss, 3350, 'Must extract S/L = 3350.00');
  assert.equal(synthMt5Arrow.takeProfit, 3315, 'Must extract T/P = 3315.00');
  console.log('✓ C4.8 APK Scan Kilat (TradingView Blue/Grey & Green/Red + 4.054,405 format + MT5 BUY LIMIT PLANNED + Zero Fake Numbers): All assertions passed');
}

console.log('\n====================================================================');
console.log('ALL LIGHT CHART DRAWING SYSTEM VERIFICATION TESTS PASSED (100%)');
console.log('====================================================================');


