import assert from 'node:assert/strict';
import {
  evaluateConfluenceMaster,
  evaluateSmcSignalEngine,
  type ConfluenceCandle,
} from '../src/utils/confluenceEngine';
import {
  createUnavailableFedWatchState,
  MACRO_ACTUALS_ARCHIVE_STORAGE_KEY,
  MACRO_MONTHLY_NEWS_SPEECH_ARCHIVE_KEY,
  MACRO_POST_NEWS_ARCHIVE_KEY,
  MACRO_PRE_NEWS_LOCK_ARCHIVE_KEY,
  MACRO_SNAPSHOT_LOCAL_STORAGE_KEY,
  recordBreakingNewsToMonthlyArchive,
  type BreakingNewsHeadline,
  type MacroCalendarEvent,
  type MacroNewsSnapshot,
} from '../src/utils/macroNewsEngine';
import { resolveSyncedMacroContext } from '../src/hooks/useCycleConfluenceData';

// Minimal in-memory window + localStorage shim for Node verification
const memoryStore = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => (memoryStore.has(k) ? memoryStore.get(k)! : null),
    setItem: (k: string, v: string) => {
      memoryStore.set(k, String(v));
    },
    removeItem: (k: string) => {
      memoryStore.delete(k);
    },
    clear: () => {
      memoryStore.clear();
    },
  },
  configurable: true,
});
if (typeof (globalThis as any).window === 'undefined') {
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    configurable: true,
  });
}

function clearMacroStorage() {
  localStorage.clear();
  localStorage.removeItem(MACRO_SNAPSHOT_LOCAL_STORAGE_KEY);
  localStorage.removeItem(MACRO_ACTUALS_ARCHIVE_STORAGE_KEY);
  localStorage.removeItem(MACRO_PRE_NEWS_LOCK_ARCHIVE_KEY);
  localStorage.removeItem(MACRO_POST_NEWS_ARCHIVE_KEY);
  localStorage.removeItem(MACRO_MONTHLY_NEWS_SPEECH_ARCHIVE_KEY);
}

function makeLinearTrendCandles(params: {
  count: number;
  startPrice: number;
  step: number;
  endTimeSec: number;
  intervalSec: number;
  lastPullbackReverse?: boolean;
}): ConfluenceCandle[] {
  const { count, startPrice, step, endTimeSec, intervalSec, lastPullbackReverse } = params;
  const out: ConfluenceCandle[] = [];
  let price = startPrice;
  const firstTime = endTimeSec - (count - 1) * intervalSec;
  for (let i = 0; i < count; i++) {
    const t = firstTime + i * intervalSec;
    const isBull = step >= 0;
    let open = price;
    let close = Number((price + step).toFixed(2));
    // Add minor 2-bar pullback at ~75% so swing highs/lows & pullback triggers exist cleanly
    if (i === count - 6) {
      close = Number((open - step * 1.4).toFixed(2));
    } else if (lastPullbackReverse && i >= count - 2) {
      close = Number((open - step * 1.2).toFixed(2));
    }
    const high = Number((Math.max(open, close) + Math.abs(step) * 0.45 + 0.4).toFixed(2));
    const low = Number((Math.min(open, close) - Math.abs(step) * 0.45 - 0.4).toFixed(2));
    out.push({ time: t, open, high, low, close, volume: 1200 + i * 15 });
    price = close;
  }
  return out;
}

function makeBaseMacroSnapshot(
  ev: MacroCalendarEvent,
  breaking: BreakingNewsHeadline[],
  analyzedAt: string,
  dxyDir: 'UP' | 'DOWN'
): MacroNewsSnapshot {
  return {
    id: `snap-${analyzedAt}`,
    instrument: 'XAUUSD',
    dataFingerprint: 'corr-fp',
    analyzedAt,
    sourceMode: 'RULE_BASED_FALLBACK',
    modelUsed: 'rule-based-v1',
    impactLevel: 'HIGH',
    dominantBias: 'BUY',
    isCalendarLiveFeed: true,
    breakingNews: breaking,
    topBreakingAlert: breaking[0] || null,
    intermarketPulse: {
      dxy: {
        symbol: 'DXY',
        yahooTicker: 'DX-Y.NYB',
        name: 'US Dollar Index',
        price: dxyDir === 'UP' ? 105.6 : 103.8,
        previousClose: 104.5,
        change: dxyDir === 'UP' ? 1.1 : -0.7,
        changePercent: dxyDir === 'UP' ? 0.65 : -0.55,
        direction: dxyDir,
        goldCorrelationEffect: dxyDir === 'UP' ? 'BEARISH_GOLD' : 'BULLISH_GOLD',
        summaryId: 'DXY live',
        summaryEn: 'DXY live',
        updatedAt: analyzedAt,
        isAvailable: true,
      },
      us10y: {
        symbol: 'US10Y',
        yahooTicker: '^TNX',
        name: 'US 10Y Yield',
        price: dxyDir === 'UP' ? 4.45 : 4.1,
        previousClose: 4.25,
        change: dxyDir === 'UP' ? 0.2 : -0.15,
        changePercent: dxyDir === 'UP' ? 1.2 : -1.1,
        direction: dxyDir,
        goldCorrelationEffect: dxyDir === 'UP' ? 'BEARISH_GOLD' : 'BULLISH_GOLD',
        summaryId: 'US10Y live',
        summaryEn: 'US10Y live',
        updatedAt: analyzedAt,
        isAvailable: true,
      },
      usoil: {
        symbol: 'USOIL',
        yahooTicker: 'CL=F',
        name: 'US Oil',
        price: 72.0,
        previousClose: 72.0,
        change: 0,
        changePercent: 0,
        direction: 'FLAT',
        goldCorrelationEffect: 'NEUTRAL',
        summaryId: 'Oil flat',
        summaryEn: 'Oil flat',
        updatedAt: analyzedAt,
        isAvailable: true,
      },
    },
    cmeFedWatch: createUnavailableFedWatchState(),
    calendarEvents: [ev],
    scenarioMatrix: {
      primaryEvent: ev,
      simultaneousEvents: [],
      isSimultaneousRelease: false,
      simultaneousAlignment: 'SINGLE',
      evaluationMode: 'INDIVIDUAL_RELEASE',
      buyProbability: ev.eventBiasForGold === 'BUY' ? 72 : 18,
      sellProbability: ev.eventBiasForGold === 'SELL' ? 72 : 18,
      mixedProbability: 10,
      dominantBias: ev.eventBiasForGold,
      dynamicPivotTriggered: false,
      oilChannelDominance: 'NEUTRAL',
      whipsawWarningId: 'Waspada spike.',
      whipsawWarningEn: 'Watch spike.',
      actionPlanId: 'Ikuti rencana.',
      actionPlanEn: 'Follow plan.',
      finalTakeId: 'Kesimpulan.',
      finalTakeEn: 'Conclusion.',
      buyArguments: [],
      sellArguments: [],
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Trade News 3-System -> resolveSyncedMacroContext (Freshness & Offline APK Parity)
// ---------------------------------------------------------------------------
clearMacroStorage();
const releaseIso = '2026-11-18T13:30:00.000Z'; // Wednesday 20:30 WIB
const nowActive2hMs = new Date('2026-11-18T13:45:00.000Z').getTime();

const postReleaseEvent: MacroCalendarEvent = {
  id: 'ev-cpi-post',
  title: 'Core CPI m/m',
  country: 'USD',
  date: releaseIso,
  impact: 'High',
  previous: '0.2%',
  forecast: '0.3%',
  actual: '0.5%', // Hot CPI -> Bearish Gold (SELL)
  previousNum: 0.2,
  forecastNum: 0.3,
  actualNum: 0.5,
  unit: '%',
  pillar: 'INFLATION',
  isInverseIndicator: true,
  eventBiasForGold: 'SELL',
  biasReasonId: 'Inflasi lebih tinggi dari perkiraan -> bearish emas.',
  biasReasonEn: 'Hotter-than-expected inflation pressures gold.',
  isLiveFeed: true,
  eventCategory: 'PRIMARY_HIGH_IMPACT',
};

const hotSnap = makeBaseMacroSnapshot(
  postReleaseEvent,
  [],
  '2026-11-18T13:45:00.000Z',
  'UP'
);
localStorage.setItem(MACRO_SNAPSHOT_LOCAL_STORAGE_KEY, JSON.stringify(hotSnap));

// Even if Supabase still returns an earlier morning BUY snapshot, System 2 Post-News (2H) MUST win!
const syncedPostNews = resolveSyncedMacroContext(
  {
    bias: 'BUY',
    analyzedAt: '2026-11-18T09:00:00.000Z',
    source: 'supabase',
  },
  null,
  nowActive2hMs
);
assert.equal(syncedPostNews.effectiveFundamentalBias, 'SELL');
assert.equal(syncedPostNews.macroBias, 'SELL');
assert.equal(syncedPostNews.rawMacroContext.macroSourceSystem, 'SYSTEM_2_POST_NEWS');

// After 2H expires, System 3 Live Pulse reads newly archived Fed Speech from the 1-month archive
const after2hMs = new Date('2026-11-18T16:15:00.000Z').getTime();
const dovishSpeech: BreakingNewsHeadline = {
  id: 'speech-dovish',
  title: 'Fed Chair Powell signals readiness for deeper rate cuts as labor cools',
  source: 'FinancialJuice',
  pubDate: '2026-11-18T16:10:00.000Z',
  matchedKeywords: ['Fed', 'Powell', 'Rate'],
  impact: 'HIGH',
  sentimentForGold: 'BULLISH',
  channelType: 'FED_SPEECH',
  aiEvaluationId: 'Dovish mendukung Gold.',
  aiEvaluationEn: 'Dovish supports Gold.',
};
const coolSnap = makeBaseMacroSnapshot(
  postReleaseEvent,
  [],
  '2026-11-18T16:05:00.000Z',
  'DOWN'
);
localStorage.setItem(MACRO_SNAPSHOT_LOCAL_STORAGE_KEY, JSON.stringify(coolSnap));
recordBreakingNewsToMonthlyArchive([dovishSpeech], after2hMs);

const syncedLivePulse = resolveSyncedMacroContext(
  { bias: 'SELL', analyzedAt: '2026-11-18T13:45:00.000Z', source: 'supabase' },
  null,
  after2hMs
);
assert.equal(syncedLivePulse.rawMacroContext.macroSourceSystem, 'SYSTEM_3_LIVE_PULSE');
assert.ok(
  syncedLivePulse.rawMacroContext.fundamentalSpeechHeadline.includes('Powell'),
  'System 3 must surface newest headline from monthly offline archive'
);

console.log('✓ PASS [1/4]: Trade News 3-System -> Cycle/Signal macro resolution & freshness precedence verified');

// ---------------------------------------------------------------------------
// 2. Bullish Cycle at EQUILIBRIUM (~50%) must NEVER flip Signal recommendedSide to SELL
// ---------------------------------------------------------------------------
// Pick a Friday weekday timestamp (2026-11-20 15:00 UTC) inside active London/NY session
const baseEndSec = Math.floor(Date.UTC(2026, 10, 20, 15, 0, 0) / 1000);
const bullCandles1H = makeLinearTrendCandles({
  count: 45,
  startPrice: 2600,
  step: 2.2,
  endTimeSec: baseEndSec,
  intervalSec: 3600,
});
const bullCandlesM15 = makeLinearTrendCandles({
  count: 45,
  startPrice: 2650,
  step: 1.1,
  endTimeSec: baseEndSec,
  intervalSec: 900,
});
// Simulate M5 bars that briefly pull back on the final two bars while M15/1H remain strongly bullish
const bullCandlesM5 = makeLinearTrendCandles({
  count: 45,
  startPrice: 2670,
  step: 0.65,
  endTimeSec: baseEndSec,
  intervalSec: 300,
  lastPullbackReverse: true,
});
// Set spot price right near mid-range (~50% equilibrium of M15 swing)
const m15High = Math.max(...bullCandlesM15.map((c) => c.high));
const m15Low = Math.min(...bullCandlesM15.map((c) => c.low));
const eqSpot = Number(((m15High + m15Low) / 2).toFixed(2));
// Adjust final M5 bar close so spot sits right near EQ
bullCandlesM5[bullCandlesM5.length - 1].close = eqSpot;
bullCandlesM5[bullCandlesM5.length - 1].low = Math.min(
  bullCandlesM5[bullCandlesM5.length - 1].low,
  eqSpot - 1.5
);

const bullMaster = evaluateConfluenceMaster({
  viewMode: 'FULL',
  tradingMode: 'SCALP',
  livePrice: eqSpot,
  macroBias: 'BUY',
  candlesByTf: {
    '1h': bullCandles1H,
    '15min': bullCandlesM15,
    '5min': bullCandlesM5,
  },
  manualAmdOverride: 'DISTRIBUTION',
});

const bullSignal = evaluateSmcSignalEngine({
  tradingMode: 'SCALP',
  livePrice: eqSpot,
  macroBias: 'BUY',
  candlesByTf: {
    '1h': bullCandles1H,
    '15min': bullCandlesM15,
    '5min': bullCandlesM5,
  },
  manualAmdOverride: 'DISTRIBUTION',
});

assert.equal(bullMaster.dominantDirection, 'BULLISH', 'Master Cycle should be BULLISH');
assert.equal(bullSignal.cycleCompass.dominantCycleBias, 'BULLISH', 'Signal compass must match BULLISH');
assert.equal(bullSignal.cycleCompass.recommendedSide, 'BUY', 'Bullish Cycle near Equilibrium must recommend BUY, NEVER flip to SELL');
assert.equal(bullSignal.cycleCompass.cycleUptrendPct, bullMaster.uptrendPct);

console.log('✓ PASS [2/4]: Bullish Cycle near Equilibrium alignment (no false SELL flip) verified');

// ---------------------------------------------------------------------------
// 3. Bearish Cycle at EQUILIBRIUM (~50%) must NEVER flip Signal recommendedSide to BUY
// ---------------------------------------------------------------------------
const bearCandles1H = makeLinearTrendCandles({
  count: 45,
  startPrice: 2720,
  step: -2.2,
  endTimeSec: baseEndSec,
  intervalSec: 3600,
});
const bearCandlesM15 = makeLinearTrendCandles({
  count: 45,
  startPrice: 2680,
  step: -1.1,
  endTimeSec: baseEndSec,
  intervalSec: 900,
});
const bearCandlesM5 = makeLinearTrendCandles({
  count: 45,
  startPrice: 2655,
  step: -0.65,
  endTimeSec: baseEndSec,
  intervalSec: 300,
  lastPullbackReverse: true,
});
const bearM15High = Math.max(...bearCandlesM15.map((c) => c.high));
const bearM15Low = Math.min(...bearCandlesM15.map((c) => c.low));
const bearEqSpot = Number(((bearM15High + bearM15Low) / 2).toFixed(2));
bearCandlesM5[bearCandlesM5.length - 1].close = bearEqSpot;

const bearMaster = evaluateConfluenceMaster({
  viewMode: 'FULL',
  tradingMode: 'SCALP',
  livePrice: bearEqSpot,
  macroBias: 'SELL',
  candlesByTf: {
    '1h': bearCandles1H,
    '15min': bearCandlesM15,
    '5min': bearCandlesM5,
  },
  manualAmdOverride: 'DISTRIBUTION',
});

const bearSignal = evaluateSmcSignalEngine({
  tradingMode: 'SCALP',
  livePrice: bearEqSpot,
  macroBias: 'SELL',
  candlesByTf: {
    '1h': bearCandles1H,
    '15min': bearCandlesM15,
    '5min': bearCandlesM5,
  },
  manualAmdOverride: 'DISTRIBUTION',
});

assert.equal(bearMaster.dominantDirection, 'BEARISH', 'Master Cycle should be BEARISH');
assert.equal(bearSignal.cycleCompass.dominantCycleBias, 'BEARISH', 'Signal compass must match BEARISH');
assert.equal(bearSignal.cycleCompass.recommendedSide, 'SELL', 'Bearish Cycle near Equilibrium must recommend SELL, NEVER flip to BUY');
assert.equal(bearSignal.cycleCompass.cycleDowntrendPct, bearMaster.downtrendPct);

console.log('✓ PASS [3/4]: Bearish Cycle near Equilibrium alignment (no false BUY flip) verified');

// ---------------------------------------------------------------------------
// 4. Neutral Cycle (Gatekeeper LOCKED / Manual ACCUMULATION) keeps NETRAL parity
// ---------------------------------------------------------------------------
// Construct balanced flat range so isImpulsiveDropWithoutChoch / Rally do NOT force override
const neutralBars: ConfluenceCandle[] = [];
for (let i = 0; i < 45; i++) {
  const osc = i % 2 === 0 ? 1.0 : -1.0;
  const open = 2650 + osc * 0.5;
  const close = i === 44 ? 2650.0 : 2650 - osc * 0.5;
  neutralBars.push({
    time: baseEndSec - (44 - i) * 900,
    open,
    high: i === 20 ? 2655.0 : Math.max(open, close) + 1.2,
    low: i === 25 ? 2645.0 : Math.min(open, close) - 1.2,
    close,
    volume: 1000,
  });
}
const neutralMaster = evaluateConfluenceMaster({
  viewMode: 'FULL',
  tradingMode: 'SCALP',
  livePrice: 2650,
  macroBias: 'MIXED',
  candlesByTf: { '1h': neutralBars, '15min': neutralBars, '5min': neutralBars },
  manualAmdOverride: 'ACCUMULATION',
});
const neutralSignal = evaluateSmcSignalEngine({
  tradingMode: 'SCALP',
  livePrice: 2650,
  macroBias: 'MIXED',
  candlesByTf: { '1h': neutralBars, '15min': neutralBars, '5min': neutralBars },
  manualAmdOverride: 'ACCUMULATION',
});

assert.equal(neutralMaster.dominantDirection, 'NETRAL');
assert.equal(
  neutralSignal.cycleCompass.dominantCycleBias,
  'NEUTRAL',
  'Signal Bias Cycle MUST preserve NEUTRAL when Cycle Master is NETRAL'
);
assert.equal(neutralSignal.cycleCompass.cycleDominantDirection, 'NETRAL');
assert.equal(neutralSignal.cycleCompass.cycleUptrendPct, neutralMaster.uptrendPct);

console.log('✓ PASS [4/5]: Gatekeeper Locked / NETRAL Cycle <-> Signal parity verified');

// ---------------------------------------------------------------------------
// 5. Anti-Falling-Knife Parity: DISCOUNT without M5 CHoCH aligns both to BEARISH / SELL
// ---------------------------------------------------------------------------
const dropSpot = Number((bearM15Low + 2.0).toFixed(2));
const dropCandlesM5 = makeLinearTrendCandles({
  count: 45,
  startPrice: bearM15High,
  step: -0.9,
  endTimeSec: baseEndSec,
  intervalSec: 300,
  lastPullbackReverse: false,
});
dropCandlesM5[dropCandlesM5.length - 1].close = dropSpot;

const dropMaster = evaluateConfluenceMaster({
  viewMode: 'FULL',
  tradingMode: 'SCALP',
  livePrice: dropSpot,
  macroBias: 'BUY', // Even if Fundamental says BUY, impulsive drop without CHoCH keeps Cycle BEARISH!
  candlesByTf: {
    '1h': bearCandles1H,
    '15min': bearCandlesM15,
    '5min': dropCandlesM5,
  },
  manualAmdOverride: 'DISTRIBUTION',
});
const dropSignal = evaluateSmcSignalEngine({
  tradingMode: 'SCALP',
  livePrice: dropSpot,
  macroBias: 'BUY',
  candlesByTf: {
    '1h': bearCandles1H,
    '15min': bearCandlesM15,
    '5min': dropCandlesM5,
  },
  manualAmdOverride: 'DISTRIBUTION',
});

assert.equal(dropMaster.dominantDirection, 'BEARISH');
assert.equal(dropSignal.cycleCompass.dominantCycleBias, 'BEARISH');
assert.equal(dropSignal.cycleCompass.recommendedSide, 'SELL');

console.log('✓ PASS [5/5]: Anti-Falling-Knife (DISCOUNT without CHoCH) Cycle <-> Signal parity verified');
console.log('\nALL CYCLE <-> SIGNAL <-> TRADE NEWS CORRELATION TESTS PASSED ✓');
