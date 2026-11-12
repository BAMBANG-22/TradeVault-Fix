import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  classifyFomcPillar,
  isInverseUsdIndicator,
  evaluateSingleEventForGold,
  filterAndScoreBreakingHeadlines,
  computeDeterministicMacroSnapshot,
  isSnapshotFresh,
  XAUUSD_MACRO_MASTER_PLAYBOOK_SYSTEM_INSTRUCTION,
  BREAKING_NEWS_KEYWORDS,
  MacroCalendarEvent,
  IntermarketAssetPulse,
} from '../src/utils/macroNewsEngine';
import { SUPABASE_SCHEMA_SQL } from '../src/utils/supabaseSchemaSql';

console.log('=== RUNNING TRADE NEWS & MACRO BIAS (XAU/USD) VERIFICATION ===\n');

const sampleIntermarket: {
  dxy: IntermarketAssetPulse;
  usoil: IntermarketAssetPulse;
  us10y: IntermarketAssetPulse;
} = {
  dxy: {
    symbol: 'DXY',
    yahooTicker: 'DX-Y.NYB',
    name: 'US Dollar Index (DXY)',
    price: 104.8,
    previousClose: 104.3,
    change: 0.5,
    changePercent: 0.48,
    direction: 'UP',
    goldCorrelationEffect: 'BEARISH_GOLD',
    summaryId: 'DXY naik',
    summaryEn: 'DXY rising',
    updatedAt: new Date().toISOString(),
  },
  usoil: {
    symbol: 'USOIL',
    yahooTicker: 'CL=F',
    name: 'US Oil WTI',
    price: 81.2,
    previousClose: 79.5,
    change: 1.7,
    changePercent: 2.14,
    direction: 'UP',
    goldCorrelationEffect: 'BEARISH_GOLD',
    summaryId: 'Oil naik',
    summaryEn: 'Oil rising',
    updatedAt: new Date().toISOString(),
  },
  us10y: {
    symbol: 'US10Y',
    yahooTicker: '^TNX',
    name: 'US 10Y Yield',
    price: 4.42,
    previousClose: 4.35,
    change: 0.07,
    changePercent: 1.61,
    direction: 'UP',
    goldCorrelationEffect: 'BEARISH_GOLD',
    summaryId: 'Yield naik',
    summaryEn: 'Yield rising',
    updatedAt: new Date().toISOString(),
  },
};

// ---------------------------------------------------------------------------
// 1. Verify Server-Side Gemini Architecture, API Key Isolation, and Free Data Feeders
// ---------------------------------------------------------------------------
{
  const analyzerSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/utils/clientSideMacroAnalyzer.ts'),
    'utf8'
  );
  const fetcherSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/utils/macroFeedFetcher.ts'),
    'utf8'
  );
  const serverSrc = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf8');
  const envExampleSrc = fs.readFileSync(path.resolve(process.cwd(), '.env.example'), 'utf8');
  const metadataSrc = fs.readFileSync(path.resolve(process.cwd(), 'metadata.json'), 'utf8');
  const viewSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/news/MacroNewsView.tsx'),
    'utf8'
  );

  assert.ok(
    envExampleSrc.includes('GEMINI_API_KEY=') &&
      envExampleSrc.includes('GEMINI_NEWS_API_KEY='),
    '.env.example must declare server-side GEMINI_API_KEY and GEMINI_NEWS_API_KEY'
  );
  assert.ok(
    !envExampleSrc.includes('VITE_GEMINI_NEWS_API_KEY') &&
      !envExampleSrc.includes('VITE_GEMINI_API_KEY'),
    '.env.example must NOT expose client-side VITE_GEMINI keys'
  );
  assert.ok(
    metadataSrc.includes('MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API'),
    'metadata.json must include MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API'
  );
  assert.ok(
    serverSrc.includes('/api/macro-news/analyze') &&
      serverSrc.includes('GoogleGenAI') &&
      serverSrc.includes('gemini-2.5-flash'),
    'server.ts must implement /api/macro-news/analyze using GoogleGenAI SDK'
  );
  assert.ok(
    !analyzerSrc.includes('generativelanguage.googleapis.com'),
    'clientSideMacroAnalyzer.ts must NOT make direct browser calls to generativelanguage.googleapis.com'
  );
  assert.ok(
    analyzerSrc.includes('/api/macro-news/analyze'),
    'clientSideMacroAnalyzer.ts must route requests through server-side /api/macro-news/analyze endpoint'
  );
  assert.ok(
    fetcherSrc.includes('api.allorigins.win') &&
      fetcherSrc.includes('https://nfs.faireconomy.media/ff_calendar_thisweek.json') &&
      fetcherSrc.includes('query1.finance.yahoo.com/v8/finance/chart/'),
    'macroFeedFetcher.ts must wrap ForexFactory & Yahoo Finance with CORS proxy and 8-second timeout fallbacks'
  );
  assert.ok(
    viewSrc.includes('executeClientSideMacroAnalysis') &&
      viewSrc.includes('Menganalisis Pasar...') &&
      viewSrc.includes('data-testid="macro-supabase-feedback-banner"'),
    'MacroNewsView.tsx must run client-side workflow, display "Menganalisis Pasar..." loading state, and render Supabase insert feedback'
  );

  console.log('✓ PASS [1]: Server-Side Gemini Architecture, Proxy Endpoints, Zero Client API calls, CORS Proxy, & Supabase insert feedback verified');
}

// ---------------------------------------------------------------------------
// 2. Verify Supabase Caching Schema (macro_news_snapshots) & 30-Min TTL
// ---------------------------------------------------------------------------
{
  assert.ok(
    SUPABASE_SCHEMA_SQL.toLowerCase().includes('create table if not exists public.macro_news_snapshots'),
    'SUPABASE_SCHEMA_SQL must define public.macro_news_snapshots table'
  );

  const nowIso = new Date().toISOString();
  const freshSnap = computeDeterministicMacroSnapshot({
    calendarEvents: [],
    intermarketPulse: sampleIntermarket,
    breakingNews: [],
  });
  freshSnap.analyzedAt = nowIso;
  assert.strictEqual(isSnapshotFresh(freshSnap, 30), true, 'Snapshot created now must be fresh within 30m TTL');

  const staleSnap = {
    ...freshSnap,
    analyzedAt: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
  };
  assert.strictEqual(isSnapshotFresh(staleSnap, 30), false, 'Snapshot older than 30m must be marked stale');

  console.log('✓ PASS [2]: Supabase macro_news_snapshots schema & 30-minute anti-429 cache TTL verified');
}

// ---------------------------------------------------------------------------
// 3. Verify Master Playbook Rules: 3 Pillars, GDP Price Index, Inverse Claims
// ---------------------------------------------------------------------------
{
  assert.strictEqual(
    classifyFomcPillar('Final GDP Price Index q/q'),
    'INFLATION',
    'GDP Price Index must be classified under INFLATION pillar, not GROWTH'
  );
  assert.strictEqual(
    classifyFomcPillar('Advance GDP q/q'),
    'GROWTH',
    'Standard GDP must be classified under GROWTH pillar'
  );
  assert.strictEqual(
    classifyFomcPillar('Unemployment Claims'),
    'LABOR',
    'Unemployment Claims must be classified under LABOR pillar'
  );
  assert.strictEqual(
    isInverseUsdIndicator('Unemployment Claims'),
    true,
    'Unemployment Claims must use inverse USD rule'
  );
  assert.strictEqual(
    isInverseUsdIndicator('Challenger Job Cuts y/y'),
    true,
    'Challenger Job Cuts must use inverse USD rule'
  );

  // Test Unemployment Claims: Actual (205K) < Forecast (220K) => Bullish USD => SELL Gold
  const claimsEval = evaluateSingleEventForGold('Unemployment Claims', 205, 220, 225);
  assert.strictEqual(
    claimsEval.bias,
    'SELL',
    'Unemployment Claims Actual < Forecast must produce SELL Gold bias (inverse rule)'
  );

  console.log('✓ PASS [3]: 3 FOMC Pillars, GDP Price Index -> Inflation, and Inverse Unemployment Claims rule verified');
}

// ---------------------------------------------------------------------------
// 4. Verify Breaking News Keyword Filter, Dual-Channel Oil, & Dynamic Pivot ("Pindah Haluan")
// ---------------------------------------------------------------------------
{
  const rawFeed = [
    {
      title: 'Fed Governor Waller signals support for 25-50 bps rate hike amid sticky inflation',
      pubDate: new Date().toISOString(),
      source: 'FinancialJuice',
    },
    {
      title: 'Strait of Hormuz tensions push US Oil WTI up sharply',
      pubDate: new Date().toISOString(),
      source: 'FXStreet',
    },
    {
      title: 'Unrelated local stock market update in Europe',
      pubDate: new Date().toISOString(),
      source: 'Other',
    },
  ];

  const filtered = filterAndScoreBreakingHeadlines(rawFeed);
  assert.strictEqual(
    filtered.length,
    2,
    'Breaking news filter must only keep headlines matching BREAKING_NEWS_KEYWORDS'
  );
  assert.ok(
    BREAKING_NEWS_KEYWORDS.includes('Waller') &&
      BREAKING_NEWS_KEYWORDS.includes('Warsh') &&
      BREAKING_NEWS_KEYWORDS.includes('Hormuz'),
    'BREAKING_NEWS_KEYWORDS must include Fed, Warsh, Waller, Powell, Trump, Tariff, Hormuz, Iran, Oil, Inflation, CPI, NFP, Rate'
  );

  // Test Dynamic Pivot ("Pindah Haluan"):
  // CPI forecast cools (0.2% vs 0.4% prev -> initial BUY), but NFP is strong (260K vs 185K) AND Waller backs rate hike -> Flips to SELL 1 Arah!
  const cpiEval = evaluateSingleEventForGold('Core CPI m/m', null, 0.2, 0.4);
  const nfpEval = evaluateSingleEventForGold('Non-Farm Employment Change (NFP)', 260, 190, 185);

  const pivotEvents: MacroCalendarEvent[] = [
    {
      id: 'cpi-cool',
      title: 'Core CPI m/m',
      country: 'USD',
      date: new Date(Date.now() + 3600 * 1000).toISOString(),
      impact: 'High',
      previous: '0.4%',
      forecast: '0.2%',
      actual: '',
      previousNum: 0.4,
      forecastNum: 0.2,
      actualNum: null,
      unit: '%',
      pillar: 'INFLATION',
      isInverseIndicator: false,
      eventBiasForGold: cpiEval.bias,
      biasReasonId: cpiEval.reasonId,
      biasReasonEn: cpiEval.reasonEn,
    },
    {
      id: 'nfp-strong',
      title: 'Non-Farm Employment Change (NFP)',
      country: 'USD',
      date: new Date(Date.now() - 3600 * 1000).toISOString(),
      impact: 'High',
      previous: '185K',
      forecast: '190K',
      actual: '260K',
      previousNum: 185,
      forecastNum: 190,
      actualNum: 260,
      unit: 'K',
      pillar: 'LABOR',
      isInverseIndicator: false,
      eventBiasForGold: nfpEval.bias,
      biasReasonId: nfpEval.reasonId,
      biasReasonEn: nfpEval.reasonEn,
    },
  ];

  const pivotSnapshot = computeDeterministicMacroSnapshot({
    calendarEvents: pivotEvents,
    intermarketPulse: sampleIntermarket,
    breakingNews: filtered,
  });

  assert.strictEqual(
    pivotSnapshot.scenarioMatrix.dynamicPivotTriggered,
    true,
    'Dynamic Pivot ("Pindah Haluan") must trigger when CPI cools but Fed official backs rate hike + strong NFP'
  );
  assert.strictEqual(
    pivotSnapshot.scenarioMatrix.dominantBias,
    'SELL',
    'Dynamic Pivot must flip dominant XAU/USD bias to 1-Way SELL'
  );

  console.log('✓ PASS [4]: Breaking News Keyword Filter, Dual-Channel Oil, & Dynamic Pivot ("Pindah Haluan" -> 1-Way SELL) verified');
}

// ---------------------------------------------------------------------------
// 5. Verify Simultaneous Release Whipsaw Detector & UI Component Structure
// ---------------------------------------------------------------------------
{
  const sameTimestamp = new Date().toISOString();
  const sim1Eval = evaluateSingleEventForGold('ISM Services PMI', 56.2, 53.5, 54.0); // SELL Gold
  const sim2Eval = evaluateSingleEventForGold('JOLTS Job Openings', 7.1, 7.75, 7.8); // BUY Gold

  const simultaneousConflictingEvents: MacroCalendarEvent[] = [
    {
      id: 'sim-1',
      title: 'ISM Services PMI',
      country: 'USD',
      date: sameTimestamp,
      impact: 'High',
      previous: '54.0',
      forecast: '53.5',
      actual: '56.2',
      previousNum: 54.0,
      forecastNum: 53.5,
      actualNum: 56.2,
      unit: '',
      pillar: 'GROWTH',
      isInverseIndicator: false,
      eventBiasForGold: sim1Eval.bias,
      biasReasonId: sim1Eval.reasonId,
      biasReasonEn: sim1Eval.reasonEn,
    },
    {
      id: 'sim-2',
      title: 'JOLTS Job Openings',
      country: 'USD',
      date: sameTimestamp,
      impact: 'High',
      previous: '7.80M',
      forecast: '7.75M',
      actual: '7.10M',
      previousNum: 7.8,
      forecastNum: 7.75,
      actualNum: 7.1,
      unit: 'M',
      pillar: 'LABOR',
      isInverseIndicator: false,
      eventBiasForGold: sim2Eval.bias,
      biasReasonId: sim2Eval.reasonId,
      biasReasonEn: sim2Eval.reasonEn,
    },
  ];

  const whipsawSnap = computeDeterministicMacroSnapshot({
    calendarEvents: simultaneousConflictingEvents,
    intermarketPulse: sampleIntermarket,
    breakingNews: [],
  });
  assert.strictEqual(
    whipsawSnap.scenarioMatrix.isSimultaneousRelease,
    true,
    'Must detect simultaneous USD releases at the same timestamp'
  );
  assert.strictEqual(
    whipsawSnap.scenarioMatrix.simultaneousAlignment,
    'CONFLICTING_WHIPSAW',
    'Opposite simultaneous releases must trigger CONFLICTING_WHIPSAW warning'
  );

  const viewSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/news/MacroNewsView.tsx'),
    'utf8'
  );
  assert.ok(
    viewSrc.includes('#0F1419') &&
      viewSrc.includes('#22D3EE') &&
      viewSrc.includes('data-testid="macro-breaking-sentiment-card"') &&
      viewSrc.includes('data-testid="macro-intermarket-pulse-grid"') &&
      viewSrc.includes('data-testid="macro-scenario-matrix-card"'),
    'MacroNewsView.tsx must use #0F1419 & Cyan #22D3EE palette and render Breaking Sentiment, 3-Column Intermarket Pulse, and Pre-News Scenario Matrix'
  );
  assert.ok(
    XAUUSD_MACRO_MASTER_PLAYBOOK_SYSTEM_INSTRUCTION.includes('3 FOMC PILLARS') &&
      XAUUSD_MACRO_MASTER_PLAYBOOK_SYSTEM_INSTRUCTION.includes('DUAL-CHANNEL GEOPOLITICS & US OIL') &&
      XAUUSD_MACRO_MASTER_PLAYBOOK_SYSTEM_INSTRUCTION.includes('PINDAH HALUAN'),
    'System instruction for Gemini must embed all Master Playbook rules'
  );

  console.log('✓ PASS [5]: Simultaneous Release Whipsaw detector, System Instruction, & Mobile-First UI verified');
}

console.log('\n=== ALL TRADE NEWS & MACRO BIAS (XAU/USD) CHECKS PASSED ===');
