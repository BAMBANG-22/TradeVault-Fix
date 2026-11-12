import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { runFinancialCalculationsTests } from '../src/utils/testRunner';
import {
  calculatePerformance,
  computeDailyLossForLocalDate,
  formatLocalDateKey,
  resolveActiveCalendarMonth,
  computePeriodTradesAndStartingBalance,
  computeEquityChartSeries,
  computeTradeNetProfit,
} from '../src/utils/calculations';
import { getTradesForCalendarDate } from '../src/components/dashboard/PerformanceCalendar';
import {
  loadStoredSettings,
  saveStoredSettings,
  getSettingsStorageKey,
  mergeWithExistingSettings,
  removeTradeFromLatestList,
  parseAndRestoreBackup,
} from '../src/utils/storage';
import { DEFAULT_SETTINGS, AppSettings } from '../src/types/settings';
import { Trade } from '../src/types/trade';
import {
  ensureValidUuid,
  registerKnownTradeUuid,
  clearSessionSyncCaches,
  setCachedBase64ForStoragePath,
  getCachedBase64ForStoragePath,
  setCachedUploadedScreenshotPath,
  getCachedUploadedScreenshotPath,
  resolveScreenshotSignedUrlWithDiagnostics,
  loadUserSettingsWithFallback,
  normalizeTradeDateTimeLocal,
  formatTradeDateTimeForDatabase,
  mapTradeToDatabasePayload,
  mapDatabaseRowToTrade,
  mergeTradesDatasets,
} from '../src/utils/supabaseSync';
import { SUPABASE_SCHEMA_SQL } from '../src/utils/supabaseSchemaSql';
import { detectImageMimeType } from '../src/utils/backupZip';

// Provide an isolated in-memory localStorage mock for Node test execution
// so real user browser data is never touched.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

(globalThis as any).localStorage = new MemoryStorage();

async function runStage45Tests() {
  console.log('================================================================');
  console.log('STAGE 4.5 — FOCUSED FIXES & REGRESSION AUTOMATED TEST SUITE');
  console.log('================================================================\n');

  // -------------------------------------------------------------------
  // 0. Run baseline financial, risk, compounding & DB mapping suite
  // -------------------------------------------------------------------
  const baseSuite = runFinancialCalculationsTests();
  assert.strictEqual(
    baseSuite.failed,
    0,
    `Baseline financial test suite had ${baseSuite.failed} failures`
  );
  console.log(`✓ PASS [0/7]: Baseline Financial, Risk & DB Suite (${baseSuite.passed}/${baseSuite.total} assertions passed)`);

  // -------------------------------------------------------------------
  // 1. Test Fix #1 & Fix #4: SQL Schema Security & Production Bundle SQL
  // -------------------------------------------------------------------
  const sqlFilePath = path.resolve(process.cwd(), 'src/utils/supabaseSchema.sql');
  const rawSqlFile = fs.readFileSync(sqlFilePath, 'utf8');

  assert.strictEqual(
    rawSqlFile.trim(),
    SUPABASE_SCHEMA_SQL.trim(),
    'src/utils/supabaseSchema.sql and SUPABASE_SCHEMA_SQL constant must match 100%'
  );

  // Bucket must be private (public = false)
  assert.strictEqual(
    SUPABASE_SCHEMA_SQL.includes("VALUES ('trade-screenshots', 'trade-screenshots', false)"),
    true,
    'trade-screenshots bucket must be created with public = false'
  );
  assert.strictEqual(
    SUPABASE_SCHEMA_SQL.includes("ON CONFLICT (id) DO UPDATE SET public = false"),
    true,
    'trade-screenshots bucket conflict clause must enforce public = false'
  );
  assert.strictEqual(
    SUPABASE_SCHEMA_SQL.includes("VALUES ('trade-screenshots', 'trade-screenshots', true)"),
    false,
    'trade-screenshots bucket must NOT be created with public = true'
  );

  // Public SELECT policy must be dropped and not recreated
  assert.strictEqual(
    SUPABASE_SCHEMA_SQL.includes('DROP POLICY IF EXISTS "Akses publik untuk membaca screenshot" ON storage.objects;'),
    true,
    'Legacy public SELECT policy must be explicitly dropped'
  );
  assert.strictEqual(
    SUPABASE_SCHEMA_SQL.includes('CREATE POLICY "Akses publik untuk membaca screenshot"'),
    false,
    'Legacy public SELECT policy must NOT be created'
  );

  // Authenticated SELECT, INSERT, UPDATE, DELETE policies scoped to auth.uid() folder must exist
  assert.strictEqual(
    SUPABASE_SCHEMA_SQL.includes('ON storage.objects FOR SELECT') &&
      SUPABASE_SCHEMA_SQL.includes('ON storage.objects FOR INSERT') &&
      SUPABASE_SCHEMA_SQL.includes('ON storage.objects FOR UPDATE') &&
      SUPABASE_SCHEMA_SQL.includes('ON storage.objects FOR DELETE'),
    true,
    'All four SELECT, INSERT, UPDATE, DELETE policies on storage.objects must be defined'
  );
  const folderCheckMatches = SUPABASE_SCHEMA_SQL.match(
    /\(storage\.foldername\(name\)\)\[1\]\s*=\s*auth\.uid\(\)::text/g
  );
  assert.strictEqual(
    Boolean(folderCheckMatches && folderCheckMatches.length >= 5),
    true,
    'All storage policies (including UPDATE USING and WITH CHECK) must enforce (storage.foldername(name))[1] = auth.uid()::text'
  );

  // Verify SupabaseConfigModal.tsx does not use alert(), confirm(), or fetch('/src/utils/supabaseSchema.sql')
  const modalPath = path.resolve(process.cwd(), 'src/components/supabase/SupabaseConfigModal.tsx');
  const modalSource = fs.readFileSync(modalPath, 'utf8');
  assert.strictEqual(
    modalSource.includes("fetch('/src/utils/supabaseSchema.sql')"),
    false,
    'SupabaseConfigModal must not rely on fetch("/src/utils/supabaseSchema.sql")'
  );
  assert.strictEqual(
    /\balert\s*\(/.test(modalSource) || /\bconfirm\s*\(/.test(modalSource),
    false,
    'SupabaseConfigModal must not use browser alert() or confirm()'
  );
  assert.strictEqual(
    modalSource.includes('SUPABASE_SCHEMA_SQL'),
    true,
    'SupabaseConfigModal must use bundled SUPABASE_SCHEMA_SQL constant'
  );

  // If production dist/assets exists, verify the compiled JS bundle contains the full SQL script
  const distAssetsDir = path.resolve(process.cwd(), 'dist/assets');
  if (fs.existsSync(distAssetsDir)) {
    const jsFiles = fs.readdirSync(distAssetsDir).filter((f) => f.endsWith('.js'));
    const combinedBundle = jsFiles
      .map((f) => fs.readFileSync(path.join(distAssetsDir, f), 'utf8'))
      .join('\n');
    assert.strictEqual(
      combinedBundle.includes('CREATE TABLE IF NOT EXISTS public.trades') &&
        combinedBundle.includes("VALUES ('trade-screenshots', 'trade-screenshots', false)"),
      true,
      'Compiled production bundle in dist/assets must embed the full SQL schema with private trade-screenshots bucket'
    );
  }
  console.log('✓ PASS [1/7]: SQL Schema Security (private bucket + SELECT/INSERT/UPDATE/DELETE folder policies) & Production Bundle SQL');

  // -------------------------------------------------------------------
  // 2. Test Fix #2: Cache Isolation on Logout and Account Switch
  // -------------------------------------------------------------------
  clearSessionSyncCaches();
  const sampleBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  const userAPath = 'user-a-uuid/TRD-100_1700000000_abc123.jpg';

  setCachedUploadedScreenshotPath('user-a-uuid', 'TRD-100', sampleBase64, userAPath);
  registerKnownTradeUuid('CUSTOM-LONG-ID-USER-A-99999', '11111111-2222-4333-8444-555555555555');

  // Same user ('user-a-uuid') can read its own cached screenshot
  assert.strictEqual(
    getCachedBase64ForStoragePath(userAPath, 'user-a-uuid'),
    sampleBase64,
    'User A should be able to access its own cached screenshot'
  );

  // Different user ('user-b-uuid') MUST NOT be able to read User A's cached screenshot even before cache clear
  assert.strictEqual(
    getCachedBase64ForStoragePath(userAPath, 'user-b-uuid'),
    undefined,
    'User B must be blocked from reading User A screenshot from base64ByStoragePathCache'
  );

  // On logout / account switch, clearSessionSyncCaches() must wipe all 3 caches
  clearSessionSyncCaches();
  assert.strictEqual(
    getCachedBase64ForStoragePath(userAPath),
    undefined,
    'base64ByStoragePathCache must be empty after clearSessionSyncCaches()'
  );
  assert.strictEqual(
    getCachedUploadedScreenshotPath('user-a-uuid', 'TRD-100', sampleBase64),
    undefined,
    'screenshotUploadCache must be empty after clearSessionSyncCaches()'
  );
  assert.notStrictEqual(
    ensureValidUuid('CUSTOM-LONG-ID-USER-A-99999'),
    '11111111-2222-4333-8444-555555555555',
    'knownSyncedUuidByLocalId must be cleared after clearSessionSyncCaches()'
  );
  console.log('✓ PASS [2/7]: Cache Isolation on Logout and Account Switch');

  // -------------------------------------------------------------------
  // 3. Test Fix #3: Settings Loading on Login, Fallback & Multi-Account Isolation
  // -------------------------------------------------------------------
  (globalThis as any).localStorage.clear();

  // Step 3a: User A saves custom settings including optional fields (resetTimezone, xauusdTickSize)
  const userALocalSettings: AppSettings = {
    ...DEFAULT_SETTINGS,
    startingBalance: 25000,
    resetTimezone: 'Asia/Jakarta',
    xauusdTickSize: 0.05,
  };
  saveStoredSettings(userALocalSettings, 'user-a');
  assert.strictEqual(getSettingsStorageKey('user-a'), 'tradevault_settings_user_user-a');
  assert.strictEqual(getSettingsStorageKey('user-b'), 'tradevault_settings_user_user-b');
  assert.strictEqual(getSettingsStorageKey(null), 'tradevault_settings_v1');

  // Step 3b: User B logs in for the first time and cloud settings fetch fails (returns null).
  // User B MUST get DEFAULT_SETTINGS ($10,000), NOT User A's $25,000!
  const userBFallbackRes = await loadUserSettingsWithFallback('user-b', async () => null);
  assert.strictEqual(userBFallbackRes.source, 'local_fallback');
  assert.strictEqual(
    userBFallbackRes.settings.startingBalance,
    DEFAULT_SETTINGS.startingBalance,
    'User B fallback must use DEFAULT_SETTINGS ($10,000) and never leak User A settings ($25,000)'
  );

  // Step 3c: User B logs in and cloud returns User B's settings ($50,000)
  const userBCloudRes = await loadUserSettingsWithFallback('user-b', async () => ({
    ...DEFAULT_SETTINGS,
    startingBalance: 50000,
    defaultRiskPercent: 2.0,
  }));
  assert.strictEqual(userBCloudRes.source, 'cloud');
  assert.strictEqual(userBCloudRes.settings.startingBalance, 50000);
  assert.strictEqual(userBCloudRes.settings.defaultRiskPercent, 2.0);
  assert.strictEqual(loadStoredSettings('user-b').startingBalance, 50000);

  // Step 3d: User A logs back in and cloud returns updated startingBalance ($30,000).
  // User A's optional local fields (resetTimezone: 'Asia/Jakarta', xauusdTickSize: 0.05) must be preserved!
  const userACloudRes = await loadUserSettingsWithFallback('user-a', async (uid) => {
    const base = loadStoredSettings(uid);
    return mergeWithExistingSettings(base, {
      startingBalance: 30000,
    });
  });
  assert.strictEqual(userACloudRes.source, 'cloud');
  assert.strictEqual(userACloudRes.settings.startingBalance, 30000);
  assert.strictEqual(
    userACloudRes.settings.resetTimezone,
    'Asia/Jakarta',
    'Optional field resetTimezone must be preserved via mergeWithExistingSettings'
  );
  assert.strictEqual(
    userACloudRes.settings.xauusdTickSize,
    0.05,
    'Optional field xauusdTickSize must be preserved via mergeWithExistingSettings'
  );
  console.log('✓ PASS [3/7]: Settings Loading on Login, Local Fallback, Optional Field Preservation & Account Isolation');

  // -------------------------------------------------------------------
  // 4. Test Fix #5: dailyLossToday After Midnight WIB & Date Boundary
  // -------------------------------------------------------------------
  const wibOffsetMinutes = 420; // UTC+7 (WIB)
  // Reference time: 2026-10-28 01:30 WIB -> in UTC this is 2026-10-27T18:30:00.000Z!
  // Notice that new Date('2026-10-27T18:30:00.000Z').toISOString().slice(0, 10) is '2026-10-27' (wrong day in WIB!),
  // whereas formatLocalDateKey(refTimeAfterMidnightWib, 420) is '2026-10-28'!
  const refTimeAfterMidnightWib = new Date('2026-10-27T18:30:00.000Z');
  assert.strictEqual(
    formatLocalDateKey(refTimeAfterMidnightWib, wibOffsetMinutes),
    '2026-10-28',
    '01:30 WIB on Oct 28 must resolve to local date 2026-10-28 even though UTC is still Oct 27'
  );

  const wibTrades: Trade[] = [
    {
      id: 'WIB-YESTERDAY',
      dateTime: '2026-10-27T22:15', // Yesterday night in WIB
      instrument: 'XAUUSD',
      position: 'BUY',
      strategy: 'Breakout',
      entryPrice: 2700,
      lotSize: 0.1,
      riskAmount: 100,
      riskPercentage: 1,
      outcome: 'LOSS',
      grossProfit: -200,
      commission: 0,
      swap: 0,
      netProfit: -200,
    },
    {
      id: 'WIB-TODAY-EARLY',
      dateTime: '2026-10-28T00:45', // 00:45 AM WIB today (after midnight WIB)
      instrument: 'XAUUSD',
      position: 'SELL',
      strategy: 'Pullback',
      entryPrice: 2710,
      lotSize: 0.1,
      riskAmount: 100,
      riskPercentage: 1,
      outcome: 'LOSS',
      grossProfit: -125,
      commission: 0,
      swap: 0,
      netProfit: -125,
    },
  ];

  const lossAt0130Wib = computeDailyLossForLocalDate(
    wibTrades,
    refTimeAfterMidnightWib,
    wibOffsetMinutes
  );
  assert.strictEqual(
    lossAt0130Wib,
    125,
    'At 01:30 WIB on 2026-10-28, dailyLossToday must equal $125 (the 00:45 WIB trade), not $200 from yesterday'
  );

  const perfAt0130Wib = calculatePerformance(
    wibTrades,
    DEFAULT_SETTINGS,
    refTimeAfterMidnightWib,
    wibOffsetMinutes
  );
  assert.strictEqual(perfAt0130Wib.metrics.dailyLossToday, 125);

  // Test exact date boundary transition: 2026-10-28 23:59 WIB vs 2026-10-29 00:01 WIB
  const ref2359Wib = new Date('2026-10-28T16:59:00.000Z'); // 23:59 WIB on Oct 28
  const ref0001NextDayWib = new Date('2026-10-28T17:01:00.000Z'); // 00:01 WIB on Oct 29
  assert.strictEqual(computeDailyLossForLocalDate(wibTrades, ref2359Wib, wibOffsetMinutes), 125);
  assert.strictEqual(
    computeDailyLossForLocalDate(wibTrades, ref0001NextDayWib, wibOffsetMinutes),
    0,
    'At 00:01 WIB on 2026-10-29, dailyLossToday must reset to 0 for the new calendar day'
  );
  console.log('✓ PASS [4/7]: dailyLossToday Accuracy After Midnight WIB (00:00–06:59) & Date Boundary Transition');

  // -------------------------------------------------------------------
  // 5. Test Fix #6: Delete Trade Using Latest tradesRef.current After Adjacent Update
  // -------------------------------------------------------------------
  const initialClosureTrades: Trade[] = [
    { ...wibTrades[0], id: 'TRD-1' },
    { ...wibTrades[1], id: 'TRD-2' },
  ];
  const tradesRef = { current: [...initialClosureTrades] };

  // Simulate an adjacent state update adding TRD-3 to tradesRef.current BEFORE delete completes
  const newlyAddedTrade: Trade = { ...wibTrades[0], id: 'TRD-3', netProfit: 350 };
  tradesRef.current = [newlyAddedTrade, ...tradesRef.current];

  // Now delete TRD-1 using removeTradeFromLatestList(tradesRef, 'TRD-1')
  const afterDelete = removeTradeFromLatestList(tradesRef, 'TRD-1');
  assert.strictEqual(afterDelete.length, 2, 'Should contain 2 trades (TRD-3 and TRD-2)');
  assert.strictEqual(
    afterDelete.some((t) => t.id === 'TRD-3'),
    true,
    'Adjacent newly added trade TRD-3 must NOT be lost when deleting TRD-1'
  );
  assert.strictEqual(
    afterDelete.some((t) => t.id === 'TRD-1'),
    false,
    'Deleted trade TRD-1 must be removed'
  );
  assert.strictEqual(
    tradesRef.current,
    afterDelete,
    'tradesRef.current must be updated synchronously to the filtered array'
  );
  console.log('✓ PASS [5/7]: Delete Trade Uses Latest tradesRef.current Without Losing Adjacent State Updates');

  // -------------------------------------------------------------------
  // 6. Test Fix #7: PerformanceCalendar Month Selection When Period Filter Changes
  // -------------------------------------------------------------------
  const allMonths = ['2026-08', '2026-09', '2026-10'];
  // User manually navigates to '2026-09' while allMonths are available
  assert.strictEqual(
    resolveActiveCalendarMonth('2026-09', allMonths),
    '2026-09',
    'Manual navigation to 2026-09 must be preserved while 2026-09 is in availableMonths'
  );

  // User changes Analytics period filter to August 2026 only -> availableMonths = ['2026-08']
  const filteredMonthsAug = ['2026-08'];
  assert.strictEqual(
    resolveActiveCalendarMonth('2026-09', filteredMonthsAug),
    '2026-08',
    'When period filter removes 2026-09 from availableMonths, calendar must automatically switch to 2026-08'
  );

  // User changes Analytics period filter to July–August 2026 -> availableMonths = ['2026-07', '2026-08']
  // and manually navigates to '2026-07'
  assert.strictEqual(
    resolveActiveCalendarMonth('2026-07', ['2026-07', '2026-08']),
    '2026-07',
    'Manual navigation to 2026-07 within filtered months must be preserved'
  );
  console.log('✓ PASS [6/7]: PerformanceCalendar Month Sync on Period Filter Change & Manual Navigation');

  // -------------------------------------------------------------------
  // 7. Regression Suite for Batches 4.1 – 4.4 & Stage 4B Equity Series
  // -------------------------------------------------------------------
  // 7a. Batch 4.1: Local datetime roundtrip & long ID collision prevention
  const inputLocalDt = '2026-10-28T03:15';
  const isoForDb = formatTradeDateTimeForDatabase(inputLocalDt);
  const roundtripLocalDt = normalizeTradeDateTimeLocal(isoForDb);
  assert.strictEqual(
    roundtripLocalDt,
    inputLocalDt,
    'Batch 4.1 regression: local datetime must survive DB TIMESTAMPTZ roundtrip without shifting hour or date'
  );

  const longId1 = 'XAUUSD-2026-10-28-SESSION-LONDON-001';
  const longId2 = 'XAUUSD-2026-10-28-SESSION-LONDON-002';
  assert.notStrictEqual(
    ensureValidUuid(longId1),
    ensureValidUuid(longId2),
    'Batch 4.1 regression: long IDs sharing >16-char prefix must produce distinct deterministic UUIDs'
  );

  // 7b. Batch 4.3: Base64 never enters DB payload screenshot_url (throws hard guard error)
  const tradeWithRawBase64: Trade = {
    ...wibTrades[0],
    id: 'TRD-B64-GUARD',
    screenshotUrl: sampleBase64,
  };
  assert.throws(
    () =>
      mapTradeToDatabasePayload(
        tradeWithRawBase64,
        '00000000-0000-4000-8000-000000000001'
      ),
    /masih berupa Base64/,
    'Batch 4.3 regression: mapTradeToDatabasePayload must throw hard guard error if raw Base64 is passed'
  );

  // 7c. Batch 4.4: Replace vs Merge & Backup Settings Merge
  const existingSet: Trade[] = [
    { ...wibTrades[0], id: 'TRD-A', netProfit: 100 },
    { ...wibTrades[1], id: 'TRD-B', netProfit: -50 },
  ];
  const incomingSet: Trade[] = [
    { ...wibTrades[0], id: 'TRD-A', netProfit: 250 },
    { ...wibTrades[1], id: 'TRD-C', netProfit: 175 },
  ];
  const replaceRes = mergeTradesDatasets(existingSet, incomingSet, 'replace');
  assert.strictEqual(replaceRes.finalTrades.length, 2);
  assert.strictEqual(replaceRes.obsoleteTrades.length, 1);
  assert.strictEqual(replaceRes.obsoleteTrades[0].id, 'TRD-B');

  const mergeRes = mergeTradesDatasets(existingSet, incomingSet, 'merge');
  assert.strictEqual(mergeRes.finalTrades.length, 3);

  // 7d. Stage 4B Batch 3/3A: Period starting balance & 0% initial growth/peak
  const periodInfo = computePeriodTradesAndStartingBalance(
    existingSet,
    DEFAULT_SETTINGS,
    '2026-10-28'
  );
  const periodPerf = calculatePerformance(periodInfo.filteredTrades, {
    ...DEFAULT_SETTINGS,
    startingBalance: periodInfo.periodStartingBalance,
  });
  const series = computeEquityChartSeries(
    periodPerf.equityCurve,
    DEFAULT_SETTINGS,
    'growth',
    periodInfo.periodStartingBalance
  );
  assert.strictEqual(series.values[0], 0);
  assert.strictEqual(series.peakValues[0], 0);

  console.log('✓ PASS [7/8]: Regression Suite for Stage 4B & Stage 4C (Batches 4.1–4.4)');

  // -------------------------------------------------------------------
  // 8. Interactive Calendar Date-to-Trade Mapping & Non-Mutation Tests
  // -------------------------------------------------------------------
  const calendarTestTrades: Trade[] = [
    {
      ...wibTrades[0],
      id: 'CAL-TRD-2',
      dateTime: '2026-10-28T15:30',
      grossProfit: 220,
      commission: -5,
      swap: 0,
      netProfit: 215,
      outcome: 'WIN',
    },
    {
      ...wibTrades[1],
      id: 'CAL-TRD-1',
      dateTime: '2026-10-28T09:15',
      grossProfit: -80,
      commission: -5,
      swap: 0,
      netProfit: -85,
      outcome: 'LOSS',
    },
    {
      ...wibTrades[0],
      id: 'CAL-TRD-3',
      dateTime: '2026-10-29T13:00',
      grossProfit: 100,
      commission: 0,
      swap: 0,
      netProfit: 100,
      outcome: 'WIN',
    },
  ];
  const snapshotBefore = JSON.stringify(calendarTestTrades);

  // 8a. Multiple trades on same date ('2026-10-28') sorted chronologically
  const oct28Trades = getTradesForCalendarDate(calendarTestTrades, '2026-10-28');
  assert.strictEqual(oct28Trades.length, 2, '2026-10-28 should map to exactly 2 trades');
  assert.strictEqual(oct28Trades[0].id, 'CAL-TRD-1', 'Earlier trade (09:15) must come first');
  assert.strictEqual(oct28Trades[1].id, 'CAL-TRD-2', 'Later trade (15:30) must come second');

  // 8b. Single trade date ('2026-10-29')
  const oct29Trades = getTradesForCalendarDate(calendarTestTrades, '2026-10-29');
  assert.strictEqual(oct29Trades.length, 1);
  assert.strictEqual(oct29Trades[0].id, 'CAL-TRD-3');

  // 8c. Empty date ('2026-10-30')
  const oct30Trades = getTradesForCalendarDate(calendarTestTrades, '2026-10-30');
  assert.strictEqual(oct30Trades.length, 0, 'Date with no trades must return empty array');

  // 8d. Sum of mapped trades Net P/L matches dailyPerformance for that date
  const calPerf = calculatePerformance(calendarTestTrades, DEFAULT_SETTINGS);
  const oct28Perf = calPerf.dailyPerformance.find((d) => d.date === '2026-10-28');
  assert.ok(oct28Perf, 'dailyPerformance must include 2026-10-28');
  const oct28SumPl = oct28Trades.reduce((acc, t) => acc + computeTradeNetProfit(t), 0);
  assert.strictEqual(
    oct28SumPl,
    oct28Perf!.netProfit,
    'Sum of mapped trades Net P/L must match dailyPerformance.netProfit ($130)'
  );

  // 8e. Read-only guarantee: input array is never mutated
  assert.strictEqual(
    JSON.stringify(calendarTestTrades),
    snapshotBefore,
    'getTradesForCalendarDate must never mutate input trades array'
  );
  console.log('✓ PASS [8/8]: Interactive Calendar Date-to-Trade Mapping, P/L Sum Agreement & Non-Mutation');

  console.log('\n================================================================');
  console.log('ALL STAGE 4.5 AUTOMATED TESTS PASSED (100% SUCCESS)');
  console.log('================================================================');
}

runStage45Tests().catch((err) => {
  console.error('Stage 4.5 test suite failed:', err);
  process.exit(1);
});
