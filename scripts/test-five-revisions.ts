import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { resolveActiveCalendarMonth, formatLocalDateKey } from '../src/utils/calculations';
import {
  calculateLotBasedOrderMetrics,
  calculateXauusdLot,
  convertXauusdPriceToPips,
  calculateManualPositionPlan,
  calculateAutomaticLotSizing,
} from '../src/utils/riskCalculator';
import { DEFAULT_SETTINGS, AppSettings } from '../src/types/settings';
import { saveStoredSettings, loadStoredSettings } from '../src/utils/storage';

console.log('=== RUNNING TRADEVAULT 5 TECHNICAL REVISIONS VERIFICATION ===\n');

// ---------------------------------------------------------------------------
// REVISION 1: Calendar Default Month Always Current Runtime Month
// ---------------------------------------------------------------------------
{
  const runtimeNow = new Date('2026-11-06T08:00:00Z');
  const expectedCurrentMonth = formatLocalDateKey(runtimeNow).slice(0, 7); // '2026-11'

  // Case 1: Only October trades exist, no November trades yet
  const availableOctOnly = ['2026-10'];
  const activeWhenOpenedWithOctTrades = resolveActiveCalendarMonth('', availableOctOnly, runtimeNow);
  assert.strictEqual(
    activeWhenOpenedWithOctTrades,
    expectedCurrentMonth,
    'Calendar must default to current runtime month (2026-11) on open/refresh even when only 2026-10 trades exist'
  );

  // Case 2: No trades at all
  const activeWhenEmpty = resolveActiveCalendarMonth('', [], runtimeNow);
  assert.strictEqual(
    activeWhenEmpty,
    expectedCurrentMonth,
    'Calendar must default to current runtime month (2026-11) when no trades exist'
  );

  // Case 3: Manual navigation during session is preserved
  const availableWithCurrent = ['2026-09', '2026-10', '2026-11'];
  assert.strictEqual(
    resolveActiveCalendarMonth('2026-10', availableWithCurrent, runtimeNow),
    '2026-10',
    'Manual navigation to October 2026 must be preserved during session'
  );

  // Verify DashboardCalendar.tsx and PerformanceCalendar.tsx source code
  const dashCalSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/dashboard/DashboardCalendar.tsx'),
    'utf8'
  );
  assert.ok(
    !dashCalSrc.includes('return sortedDates[sortedDates.length - 1].slice(0, 7);'),
    'DashboardCalendar must not initialize activeMonth from last trade date'
  );

  console.log('✓ PASS [Revision 1]: Calendar always defaults to current runtime month on open/refresh & supports manual navigation');
}

// ---------------------------------------------------------------------------
// REVISION 2: Dark Theme & Light Theme Consistency
// ---------------------------------------------------------------------------
{
  const indexCss = fs.readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8');
  assert.ok(
    indexCss.includes('html.dark .tv-smoked-glass-card') &&
      indexCss.includes('html.light .tv-smoked-glass-card'),
    'index.css must define theme-aware .tv-smoked-glass-card for both html.dark and html.light'
  );

  const tradeTableSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/trades/TradeTable.tsx'),
    'utf8'
  );
  assert.ok(
    !tradeTableSrc.includes('rgba(20, 24, 30, 0.85)'),
    'TradeTable DateGroupCard must not have hardcoded dark inline background gradient'
  );
  assert.ok(
    tradeTableSrc.includes('tv-smoked-glass-card'),
    'TradeTable DateGroupCard must use theme-aware tv-smoked-glass-card class'
  );

  const dashCalSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/dashboard/DashboardCalendar.tsx'),
    'utf8'
  );
  assert.ok(
    !dashCalSrc.includes('rgba(20, 24, 30, 0.85)'),
    'DashboardCalendar daily card must not have hardcoded dark inline background gradient'
  );

  const tradeFormSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/trades/TradeForm.tsx'),
    'utf8'
  );
  assert.ok(
    tradeFormSrc.includes('bg-white dark:bg-[#0B0D11]'),
    'TradeForm popup must have Light Theme surface (bg-white) alongside Dark Theme surface (dark:bg-[#0B0D11])'
  );

  console.log('✓ PASS [Revision 2]: Dark Theme and Light Theme surfaces, text, and borders are consistent across all views');
}

// ---------------------------------------------------------------------------
// REVISION 3: Bottom Navigation 5-Position Structure & Monochrome Theme
// ---------------------------------------------------------------------------
{
  const mobileNavSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/layout/MobileNav.tsx'),
    'utf8'
  );

  // Check bottomTabs only has 4 tabs (dashboard, trades, analytics, risk) + 1 center [+] button = 5 positions
  const bottomTabsMatch = mobileNavSrc.match(/const bottomTabs = \[([\s\S]*?)\];/);
  assert.ok(bottomTabsMatch, 'bottomTabs array must exist in MobileNav.tsx');
  const bottomTabsBlock = bottomTabsMatch![1];
  assert.ok(bottomTabsBlock.includes("id: 'dashboard'"), 'bottomTabs must include Dashboard');
  assert.ok(bottomTabsBlock.includes("id: 'trades'"), 'bottomTabs must include Trade Log');
  assert.ok(bottomTabsBlock.includes("id: 'analytics'"), 'bottomTabs must include Analytics');
  assert.ok(bottomTabsBlock.includes("id: 'risk'"), 'bottomTabs must include Risk');
  assert.ok(!bottomTabsBlock.includes("id: 'detail'"), 'bottomTabs must NOT include Detail');

  // Ensure mainMenuItems has the 5 required items in order (Dashboard, Trade Log, Catat Trade Baru, Analytics, Risk Management)
  const mainMenuItemsMatch = mobileNavSrc.match(/const mainMenuItems = \[([\s\S]*?)\];/);
  assert.ok(mainMenuItemsMatch, 'mainMenuItems array must exist in MobileNav.tsx');
  const mainMenuBlock = mainMenuItemsMatch![1];
  assert.ok(mainMenuBlock.includes("id: 'dashboard'") && mainMenuBlock.includes("id: 'trades'") && mainMenuBlock.includes("id: 'add-trade'") && mainMenuBlock.includes("id: 'analytics'") && mainMenuBlock.includes("id: 'risk'"), 'mainMenuItems must include all 5 main menu items');
  assert.ok(!mainMenuBlock.includes("id: 'detail'"), 'mainMenuItems must NOT add a Detail menu item');

  // Ensure grid-cols-5 and monochrome styling on bottom nav (no bright blue #1769E8 on bottom nav)
  assert.ok(mobileNavSrc.includes('grid-cols-5'), 'Bottom Navigation must use 5-column layout');
  const navSection = mobileNavSrc.split('Slide-out Hamburger Drawer Overlay')[0];
  assert.ok(
    !navSection.includes('#1769E8'),
    'Bottom Navigation and center [+] button must use monochrome theme colors instead of bright blue #1769E8'
  );

  console.log('✓ PASS [Revision 3]: Bottom Navigation has strictly 5 positions (Dashboard, Trade Log, [+], Analytics, Risk) with monochrome theme styling');
}

// ---------------------------------------------------------------------------
// REVISION 4: Burger Menu / Side Drawer Smooth Enter & Exit Animation
// ---------------------------------------------------------------------------
{
  const mobileNavSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/layout/MobileNav.tsx'),
    'utf8'
  );

  assert.ok(
    !mobileNavSrc.includes('{isOpen && ('),
    'MobileNav drawer must not conditionally unmount immediately on close ({isOpen && ...})'
  );
  assert.ok(
    mobileNavSrc.includes("isOpen ? 'translate-x-0' : '-translate-x-full'") &&
      mobileNavSrc.includes('transition-transform duration-250'),
    'MobileNav drawer panel must smoothly transition between -translate-x-full and translate-x-0'
  );

  console.log('✓ PASS [Revision 4]: Burger Menu / Side Drawer supports smooth slide-in (left-to-right) and slide-out (right-to-left) animations');
}

// ---------------------------------------------------------------------------
// REVISION 5: Pip Mode A & Mode B Applied to Trade Form & Calculations
// ---------------------------------------------------------------------------
{
  const modeBSettings: AppSettings = {
    ...DEFAULT_SETTINGS,
    xauusdPipSize: 1.0, // Mode B: 1.00 Harga = 1 Pip
    xauusdContractSize: 100,
    xauusdPipValuePer001Lot: 0.1,
    startingBalance: 3000,
  };

  // Verify Mode B exact table from user prompt:
  // Entry: 4,000 -> SL 3,995 = 5 pips, SL 3,990 = 10 pips, SL 3,950 = 50 pips, SL 3,940 = 60 pips
  const modeBTableCases = [
    { sl: 3995, expectedPips: 5 },
    { sl: 3990, expectedPips: 10 },
    { sl: 3950, expectedPips: 50 },
    { sl: 3940, expectedPips: 60 },
  ];

  for (const tc of modeBTableCases) {
    const buyMetrics = calculateLotBasedOrderMetrics(
      {
        symbol: 'XAUUSD',
        position: 'BUY',
        lotSize: 0.05,
        entryPrice: 4000,
        stopLossPrice: tc.sl,
        takeProfitPrice: 4100,
        capitalBasis: 3000,
      },
      modeBSettings
    );
    assert.strictEqual(
      buyMetrics.slDistancePips,
      tc.expectedPips,
      `Mode B BUY Entry 4000 -> SL ${tc.sl} must be ${tc.expectedPips} pips`
    );
    assert.strictEqual(
      convertXauusdPriceToPips(4000, tc.sl, modeBSettings.xauusdPipSize),
      tc.expectedPips,
      `convertXauusdPriceToPips Mode B 4000 -> ${tc.sl} must be ${tc.expectedPips} pips`
    );
  }

  // Verify Mode B SELL direction: Entry 4000, SL 4050 = 50 pips, TP 3900 = 100 pips, RR = 1 : 2
  const sellModeB = calculateLotBasedOrderMetrics(
    {
      symbol: 'XAUUSD',
      position: 'SELL',
      lotSize: 0.05,
      entryPrice: 4000,
      stopLossPrice: 4050,
      takeProfitPrice: 3900,
      capitalBasis: 3000,
    },
    modeBSettings
  );
  assert.strictEqual(sellModeB.slDistancePips, 50, 'Mode B SELL 4000 -> SL 4050 must be 50 pips');
  assert.strictEqual(sellModeB.tpDistancePips, 100, 'Mode B SELL 4000 -> TP 3900 must be 100 pips');
  assert.strictEqual(sellModeB.plannedRRFormatted, '1 : 2', 'Mode B SELL RR must be 1 : 2');
  assert.strictEqual(sellModeB.riskAmount, 25, 'Mode B SELL 0.05 lot 50 pips risk must be $25');
  assert.strictEqual(sellModeB.potentialProfit, 50, 'Mode B SELL 0.05 lot 100 pips profit must be $50');

  // Verify Mode A (xauusdPipSize = 0.1): Entry 4000 -> SL 3995 = 50 pips, SL 3950 = 500 pips
  const modeASettings: AppSettings = {
    ...modeBSettings,
    xauusdPipSize: 0.1, // Mode A: 0.10 Harga = 1 Pip
  };
  const buyModeA_3995 = calculateLotBasedOrderMetrics(
    {
      symbol: 'XAUUSD',
      position: 'BUY',
      lotSize: 0.05,
      entryPrice: 4000,
      stopLossPrice: 3995,
      takeProfitPrice: 4010,
      capitalBasis: 3000,
    },
    modeASettings
  );
  assert.strictEqual(buyModeA_3995.slDistancePips, 50, 'Mode A BUY 4000 -> SL 3995 must be 50 pips');
  assert.strictEqual(buyModeA_3995.tpDistancePips, 100, 'Mode A BUY 4000 -> TP 4010 must be 100 pips');

  const buyModeA_3950 = calculateLotBasedOrderMetrics(
    {
      symbol: 'XAUUSD',
      position: 'BUY',
      lotSize: 0.05,
      entryPrice: 4000,
      stopLossPrice: 3950,
      takeProfitPrice: 4100,
      capitalBasis: 3000,
    },
    modeASettings
  );
  assert.strictEqual(buyModeA_3950.slDistancePips, 500, 'Mode A BUY 4000 -> SL 3950 must be 500 pips');

  // Verify calculateXauusdLot, calculateLotCalculatorManual, and calculateLotSizingAuto also respect Mode B & Mode A
  const autoLotModeB = calculateXauusdLot(
    {
      equity: 3000,
      riskPercent: 1,
      entryPrice: 4000,
      stopLossPrice: 3950,
      takeProfitPrice: 4100,
      position: 'BUY',
    },
    modeBSettings
  );
  assert.strictEqual(autoLotModeB.slDistancePips, 50, 'calculateXauusdLot Mode B 4000 -> 3950 must be 50 pips');

  const autoLotModeA = calculateXauusdLot(
    {
      equity: 3000,
      riskPercent: 1,
      entryPrice: 4000,
      stopLossPrice: 3950,
      takeProfitPrice: 4100,
      position: 'BUY',
    },
    modeASettings
  );
  assert.strictEqual(autoLotModeA.slDistancePips, 500, 'calculateXauusdLot Mode A 4000 -> 3950 must be 500 pips');

  const manualModeB = calculateManualPositionPlan(
    {
      symbol: 'XAUUSD',
      direction: 'BUY',
      accountBalance: 3000,
      lotSize: 0.05,
      entryPrice: 4000,
      stopLossPrice: 3950,
      takeProfitPrice: 4100,
    },
    modeBSettings
  );
  assert.strictEqual(manualModeB.slDistancePips, 50, 'Manual Lot Calculator Mode B 4000 -> 3950 must be 50 pips');

  const sizingModeB = calculateAutomaticLotSizing(
    {
      symbol: 'XAUUSD',
      direction: 'BUY',
      accountBasisType: 'BALANCE',
      accountBasisAmount: 3000,
      riskPercent: 1,
      entryPrice: 4000,
      stopLossPrice: 3950,
    },
    modeBSettings
  );
  assert.strictEqual(sizingModeB.slDistancePips, 50, 'Position Sizing Auto Mode B 4000 -> 3950 must be 50 pips');

  // Verify TradeForm.tsx uses resolvedPipSize instead of hardcoded XAUUSD_PIP_SIZE
  const tradeFormSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/trades/TradeForm.tsx'),
    'utf8'
  );
  assert.ok(
    tradeFormSrc.includes('pipSize: resolvedPipSize') &&
      tradeFormSrc.includes('settings.xauusdPipSize'),
    'TradeForm.tsx must pass settings.xauusdPipSize (resolvedPipSize) into xauBrokerSpecOverride'
  );

  console.log('✓ PASS [Revision 5]: Pip Mode A (0.10 = 1 Pip) & Mode B (1.00 = 1 Pip) work accurately in TradeForm and Risk Calculators');
}

// ---------------------------------------------------------------------------
// REVISION A: Hamburger Menu & Desktop Sidebar 6-Section Hierarchy
// ---------------------------------------------------------------------------
{
  const mobileNavSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/layout/MobileNav.tsx'),
    'utf8'
  );
  const sidebarSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/layout/Sidebar.tsx'),
    'utf8'
  );

  for (const [name, src] of [
    ['MobileNav.tsx', mobileNavSrc],
    ['Sidebar.tsx', sidebarSrc],
  ] as const) {
    // 1. Check section order: BrandLogo -> Akun aktif -> MENU UTAMA -> PREFERENSI -> PENGATURAN -> DATA & PENYIMPANAN
    const logoIdx = src.indexOf('<BrandLogo');
    const accountIdx = src.indexOf('Akun aktif');
    const mainMenuIdx = src.indexOf('MENU UTAMA');
    const prefIdx = src.indexOf('PREFERENSI');
    const settingsIdx = src.indexOf('PENGATURAN');
    const storageIdx = src.indexOf('DATA &amp; PENYIMPANAN');

    assert.ok(logoIdx > 0, `${name} must render BrandLogo at the top`);
    assert.ok(accountIdx > logoIdx, `${name} must render Akun Aktif immediately below Logo`);
    assert.ok(mainMenuIdx > accountIdx, `${name} must render MENU UTAMA after Akun Aktif`);
    assert.ok(prefIdx > mainMenuIdx, `${name} must render PREFERENSI after MENU UTAMA`);
    assert.ok(settingsIdx > prefIdx, `${name} must render PENGATURAN after PREFERENSI`);
    assert.ok(storageIdx > settingsIdx, `${name} must render DATA & PENYIMPANAN after PENGATURAN`);

    // 2. Verify duplicate SALDO BERJALAN card was removed from menu
    assert.ok(!src.includes('SALDO BERJALAN'), `${name} must not duplicate SALDO BERJALAN card from Dashboard`);

    // 3. Verify all required labels exist
    assert.ok(src.includes('Belum masuk'), `${name} must show 'Belum masuk' when user is not logged in`);
    assert.ok(src.includes('Pengaturan Aplikasi') && src.includes('Pengaturan Akun'), `${name} must show Pengaturan Aplikasi and Pengaturan Akun`);
    assert.ok(
      src.includes('Penyimpanan Lokal') &&
        src.includes('Info Penyimpanan') &&
        src.includes('Backup Data'),
      `${name} must show Penyimpanan Lokal, Info Penyimpanan, and Backup Data`
    );
    assert.ok(
      src.includes("isDark ? 'Gelap' : 'Terang'") && src.includes('Tampilan'),
      `${name} must show single-row Tampilan Gelap/Terang toggle`
    );
  }

  console.log('✓ PASS [Revision A]: Hamburger Menu & Desktop Sidebar follow exact 6-section hierarchy with active account, single theme icon, Pengaturan, and Data & Penyimpanan');
}

// ---------------------------------------------------------------------------
// REVISION B: Non-Blocking Toast Notification with Swipe-to-Dismiss
// ---------------------------------------------------------------------------
{
  const appSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');

  assert.ok(
    appSrc.includes('data-testid="toast-notification-wrapper"') &&
      appSrc.includes('pointer-events-none'),
    'Toast wrapper must use pointer-events-none so it never blocks the app'
  );
  assert.ok(
    appSrc.includes('data-testid="toast-notification-card"') &&
      appSrc.includes('bg-[#FFFFFF]'),
    'Toast card must use crisp white surface (#FFFFFF) in both Dark Mode and Light Mode'
  );
  assert.ok(
    appSrc.includes('onTouchStart') &&
      appSrc.includes('onTouchMove') &&
      appSrc.includes('onTouchEnd') &&
      appSrc.includes('shouldDismissUpward'),
    'Toast card must support swipe-to-dismiss touch gestures'
  );
  assert.ok(
    appSrc.includes('data-testid="toast-close-button"') &&
      appSrc.includes('aria-label="Tutup notifikasi"'),
    'Toast card must include an accessible manual close button (X)'
  );
  assert.ok(
    appSrc.includes('toastIdCounterRef.current === nextId'),
    'Auto-dismiss timer must guard against race conditions so older timers never clear newer notifications'
  );

  console.log('✓ PASS [Revision B]: Toast Notification uses clean white card, non-blocking pointer-events, swipe-to-dismiss, manual close button, and race-safe timer');
}

console.log('\n=== ALL TECHNICAL & UI/UX REVISIONS PASSED ===');

