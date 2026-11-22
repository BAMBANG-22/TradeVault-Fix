import assert from 'node:assert/strict';
import {
  DEFAULT_SESSION_HOURS_WIB,
  evaluateConfluenceMaster,
  evaluateRollingAmdStateMachine,
  type ConfluenceCandle,
} from '../src/utils/confluenceEngine';

function makeBar(timeSec: number, open: number, high: number, low: number, close: number): ConfluenceCandle {
  return {
    time: timeSec,
    open: Number(open.toFixed(2)),
    high: Number(high.toFixed(2)),
    low: Number(low.toFixed(2)),
    close: Number(close.toFixed(2)),
    volume: 1200,
  };
}

// Helper: convert WIB (UTC+7) clock on 2026-11-19 (Thursday) into unix seconds
function wibSec(day: number, hour: number, minute = 0): number {
  return Math.floor(Date.UTC(2026, 10, day, hour - 7, minute, 0) / 1000);
}

// ---------------------------------------------------------------------------
// 1. SCALP (15m) Double Accumulation at 22:15 WIB (Tokyo > 9h ago must still count!)
// ---------------------------------------------------------------------------
{
  const bars15m: ConfluenceCandle[] = [];
  // Prior day NY volatile bars to set realistic ATR(14) (~$4.0) before Tokyo starts, wait:
  // ATR(14) uses last 14 bars of `candles`, so put small compressed bars (~$2.2) in Tokyo & London
  // and slightly larger prior bars earlier, ensuring Tokyo & London avgBar < 1.2 * ATR14 and total range tight.
  // Tokyo: 04:00 -> 12:45 WIB (36 bars of 15m)
  let t = wibSec(19, 4, 0);
  for (let i = 0; i < 36; i++) {
    const mid = 2650 + (i % 2 === 0 ? 0.5 : -0.5);
    bars15m.push(makeBar(t, mid - 0.3, mid + 0.9, mid - 0.9, mid + (i % 2 === 0 ? 0.3 : -0.3)));
    t += 900;
  }
  // London: 13:00 -> 17:45 WIB (20 bars of 15m, compressed inside 2648.8–2651.2)
  for (let i = 0; i < 20; i++) {
    const mid = 2650 + (i % 2 === 0 ? 0.4 : -0.4);
    bars15m.push(makeBar(t, mid - 0.2, mid + 0.8, mid - 0.8, mid + (i % 2 === 0 ? 0.2 : -0.2)));
    t += 900;
  }
  // New York: 18:00 -> 22:15 WIB (18 bars of 15m, still inside range without sweeping London)
  for (let i = 0; i < 18; i++) {
    const mid = 2650 + (i % 2 === 0 ? 0.3 : -0.3);
    bars15m.push(makeBar(t, mid - 0.2, mid + 0.7, mid - 0.7, mid + (i % 2 === 0 ? 0.2 : -0.2)));
    t += 900;
  }

  const res = evaluateRollingAmdStateMachine(
    bars15m,
    'MIXED',
    DEFAULT_SESSION_HOURS_WIB,
    'NEUTRAL',
    'AUTO'
  );
  assert.equal(res.currentSession, 'NEW_YORK');
  assert.equal(res.phase, 'DOUBLE_ACCUMULATION', `Expected DOUBLE_ACCUMULATION at 22:15 WIB on 15m, got ${res.phase}`);
  assert.equal(res.gatekeeperStatus, 'PREPARE');
  assert.ok(res.tokyoRangeAtrRatio < 1.2, `Tokyo ratio should be < 1.2, got ${res.tokyoRangeAtrRatio}`);
  assert.ok(res.londonRangeAtrRatio < 1.2, `London ratio should be < 1.2, got ${res.londonRangeAtrRatio}`);
  console.log('✓ PASS [1/6]: SCALP 15m Double Accumulation detected cleanly at 22:15 WIB');
}

// ---------------------------------------------------------------------------
// 2. Stair-Stepping Trending Session must NOT falsely trigger Double Accumulation
// ---------------------------------------------------------------------------
{
  const bars15m: ConfluenceCandle[] = [];
  let t = wibSec(19, 4, 0);
  // Tokyo: 36 small bars stepping steadily UP +$28 (avg bar ~$1.5, ATR ~$1.6, so bar ratio < 1.2, BUT total range = $28 >> 5.2*ATR)
  let price = 2620;
  for (let i = 0; i < 36; i++) {
    bars15m.push(makeBar(t, price, price + 1.1, price - 0.3, price + 0.75));
    price += 0.75;
    t += 900;
  }
  // London: 20 compressed bars around 2647
  for (let i = 0; i < 20; i++) {
    const mid = 2647 + (i % 2 === 0 ? 0.3 : -0.3);
    bars15m.push(makeBar(t, mid - 0.2, mid + 0.7, mid - 0.7, mid + 0.2));
    t += 900;
  }
  // Early NY inside London box
  for (let i = 0; i < 3; i++) {
    bars15m.push(makeBar(t, 2647, 2647.5, 2646.5, 2647.1));
    t += 900;
  }

  const res = evaluateRollingAmdStateMachine(bars15m, 'BUY', DEFAULT_SESSION_HOURS_WIB, 'BULLISH', 'AUTO');
  assert.notEqual(
    res.phase,
    'DOUBLE_ACCUMULATION',
    'Stair-stepping $28 Tokyo trend must NOT trigger DOUBLE_ACCUMULATION'
  );
  console.log('✓ PASS [2/6]: Stair-stepping wide session trend rejected from DOUBLE_ACCUMULATION');
}

// ---------------------------------------------------------------------------
// 3. Manipulation (Judas Sweep) -> Post-Sweep Consolidation -> Distribution (MSS)
// ---------------------------------------------------------------------------
{
  // Build 1h bars: 8 prior-day NY bars + Tokyo box 2646–2654, London starts with a sweep below 2646 with rejection wick
  const baseBars: ConfluenceCandle[] = [];
  let t = wibSec(18, 20, 0);
  for (let i = 0; i < 8; i++) {
    baseBars.push(makeBar(t, 2649, 2652, 2647, 2650));
    t += 3600;
  }
  for (let i = 0; i < 9; i++) {
    const mid = 2650 + (i % 2 === 0 ? 1.5 : -1.5);
    baseBars.push(makeBar(t, mid - 1, 2654, 2646, mid + 1));
    t += 3600;
  }

  // 3a. Manipulation bar: sweeps low 2642 (< 2646), closes 2647 (rejection wick)
  const manipBars = [...baseBars, makeBar(t, 2649, 2649.5, 2642, 2647.5)];
  const manipRes = evaluateRollingAmdStateMachine(manipBars, 'BUY', DEFAULT_SESSION_HOURS_WIB, 'BULLISH', 'AUTO');
  assert.equal(manipRes.phase, 'MANIPULATION');
  assert.equal(manipRes.gatekeeperStatus, 'PREPARE');

  // 3b. Post-sweep consolidation: 2 stalled sideways bars after sweep without MSS above boxMid (2650)
  const stallBars = [
    ...manipBars,
    makeBar(t + 3600, 2647.5, 2648.8, 2646.8, 2648.0),
    makeBar(t + 7200, 2648.0, 2649.0, 2647.2, 2648.2),
  ];
  const stallRes = evaluateRollingAmdStateMachine(stallBars, 'BUY', DEFAULT_SESSION_HOURS_WIB, 'BULLISH', 'AUTO');
  assert.equal(stallRes.phase, 'POST_SWEEP_CONSOLIDATION');
  assert.equal(stallRes.gatekeeperStatus, 'PREPARE');

  // 3c. Distribution: strong bullish displacement closing above boxMid (2650)
  const distBars = [
    ...stallBars,
    makeBar(t + 10800, 2648.2, 2657.5, 2648.0, 2656.5),
  ];
  const distRes = evaluateRollingAmdStateMachine(distBars, 'BUY', DEFAULT_SESSION_HOURS_WIB, 'BULLISH', 'AUTO');
  assert.equal(distRes.phase, 'DISTRIBUTION');
  assert.equal(distRes.gatekeeperStatus, 'ACTIVE');
  assert.equal(distRes.dampeningFactor, 1.0);
  console.log('✓ PASS [3/6]: Manipulation -> Post-Sweep Consolidation -> Distribution transitions verified');
}

// ---------------------------------------------------------------------------
// 4. Skip-Manipulation (Early Distribution) & Guard against Reversal Sweep
// ---------------------------------------------------------------------------
{
  const baseBars: ConfluenceCandle[] = [];
  let t = wibSec(18, 20, 0);
  for (let i = 0; i < 8; i++) {
    baseBars.push(makeBar(t, 2649, 2652, 2647, 2650));
    t += 3600;
  }
  for (let i = 0; i < 9; i++) {
    baseBars.push(makeBar(t, 2649, 2652, 2647, 2650));
    t += 3600;
  }
  // Strong full-body bullish breakout (> 1.3x ATR, bodyRatio >= 0.60)
  const earlyDistBars = [...baseBars, makeBar(t, 2651, 2662, 2650.5, 2661)];
  const earlyRes = evaluateRollingAmdStateMachine(earlyDistBars, 'BUY', DEFAULT_SESSION_HOURS_WIB, 'BULLISH', 'AUTO');
  assert.equal(earlyRes.phase, 'EARLY_DISTRIBUTION');
  assert.equal(earlyRes.transitionModel, 'MODEL_B_ONE_WAY');
  assert.equal(earlyRes.gatekeeperStatus, 'ACTIVE');

  // Later reversal sweeps below box low 2647 -> must NOT remain falsely locked in EARLY_DISTRIBUTION
  const reversedSweepBars = [
    ...earlyDistBars,
    makeBar(t + 3600, 2661, 2661.5, 2644.5, 2648.5),
  ];
  const revRes = evaluateRollingAmdStateMachine(reversedSweepBars, 'BUY', DEFAULT_SESSION_HOURS_WIB, 'BULLISH', 'AUTO');
  assert.notEqual(revRes.phase, 'EARLY_DISTRIBUTION', 'Reversal sweep should clear EARLY_DISTRIBUTION');
  console.log('✓ PASS [4/6]: Skip-Manipulation Early Distribution & reversal sweep guard verified');
}

// ---------------------------------------------------------------------------
// 5. Post-Sweep Consolidation when active session has >= 6 compressed bars
// ---------------------------------------------------------------------------
{
  const bars: ConfluenceCandle[] = [];
  let t = wibSec(19, 4, 0);
  // Prior Tokyo (04:00–12:00 WIB) and London (13:00–17:00 WIB) with normal wider range
  for (let i = 0; i < 9; i++) {
    bars.push(makeBar(t, 2646, 2656, 2644, 2652));
    t += 3600;
  }
  for (let i = 0; i < 5; i++) {
    bars.push(makeBar(t, 2647, 2655, 2645, 2651));
    t += 3600;
  }
  // Active NY session (18:00–00:00 WIB): 7 compressed bars inside 2649–2653, then sweep + 2 stalled bars
  for (let i = 0; i < 4; i++) {
    bars.push(makeBar(t, 2650.5, 2652.0, 2649.5, 2651.0));
    t += 3600;
  }
  // Sweep below 2649.5 with rejection wick
  bars.push(makeBar(t, 2650.5, 2651.0, 2648.2, 2650.2));
  // Two small stalled sideways bars inside range
  bars.push(makeBar(t + 3600, 2650.2, 2650.9, 2649.7, 2650.3));
  bars.push(makeBar(t + 7200, 2650.3, 2650.8, 2649.8, 2650.4));

  const res = evaluateRollingAmdStateMachine(bars, 'MIXED', DEFAULT_SESSION_HOURS_WIB, 'NEUTRAL', 'AUTO');
  assert.equal(
    res.phase,
    'POST_SWEEP_CONSOLIDATION',
    `Expected POST_SWEEP_CONSOLIDATION on compressed active segment >=6 bars, got ${res.phase}`
  );
  console.log('✓ PASS [5/6]: Post-Sweep Consolidation works even with >= 6 compressed active-session bars');
}

// ---------------------------------------------------------------------------
// 6. Full Cycle Master AUTO mode invokes AMD automatically and applies dampening
// ---------------------------------------------------------------------------
{
  const bars15m: ConfluenceCandle[] = [];
  let t = wibSec(19, 4, 0);
  for (let i = 0; i < 50; i++) {
    const mid = 2650 + (i % 2 === 0 ? 0.5 : -0.5);
    bars15m.push(makeBar(t, mid - 0.3, mid + 0.8, mid - 0.8, mid + (i % 2 === 0 ? 0.3 : -0.3)));
    t += 900;
  }
  const master = evaluateConfluenceMaster({
    viewMode: 'FULL',
    tradingMode: 'SCALP',
    livePrice: 2650.2,
    macroBias: 'BUY',
    candlesByTf: { '1h': bars15m, '15min': bars15m, '5min': bars15m },
    manualAmdOverride: 'AUTO',
  });
  assert.ok(master.amdState, 'evaluateConfluenceMaster in FULL mode must automatically compute amdState');
  assert.equal(master.amdState.isManualOverride, false);
  assert.equal(master.amdState.manualOverrideMode, 'AUTO');
  assert.ok(master.amdState.dampeningFactor <= 0.65, 'Compressed/non-distribution AUTO AMD must dampen score');
  console.log('✓ PASS [6/6]: evaluateConfluenceMaster AUTO mode invokes AMD state machine automatically');
}

console.log('\n✅ ALL AUTOMATED AMD STATE MACHINE TESTS PASSED');
