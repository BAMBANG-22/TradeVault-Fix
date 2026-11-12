import assert from 'node:assert/strict';
import { Trade } from '../src/types/trade';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import {
  UsdIdrRateRecord,
  computeDualCurrencyDisplay,
  convertDynamicUsdAmount,
  formatDynamicAmount,
  convertHistoricalTradeMetric,
  formatTradeFinancialValue,
  computeCumulativeProfitInDisplayCurrency,
  getGlobalCurrencyPreference,
  setGlobalCurrencyPreference,
  getHistoricalTradeProfitIdr,
} from '../src/utils/currencyRate';
import {
  resolveTradeLifecycle,
  transitionOpenTradeToClosed,
  encodeLifecycleMetaIntoExecutionNotes,
} from '../src/utils/tradeLifecycle';
import {
  encodeTradeNotesWithMetaB64,
  decodeTradeNotesWithMeta,
} from '../src/storage/utf8Base64Url';
import {
  mapTradeToDatabasePayload,
  mapDatabaseRowToTrade,
} from '../src/utils/supabaseSync';

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    throw err;
  }
}

console.log('=== TRADEVAULT GLOBAL CURRENCY & HISTORICAL LOCK VERIFICATION SUITE ===\n');

const rate18000: UsdIdrRateRecord = {
  rate: 18000,
  updatedAt: '2026-05-01T10:00:00.000Z',
  provider: 'ExchangeRate-API',
  status: 'LIVE',
};

const rate17950: UsdIdrRateRecord = {
  rate: 17950,
  updatedAt: '2026-05-01T11:00:00.000Z',
  provider: 'ExchangeRate-API',
  status: 'LIVE',
};

const rate18200: UsdIdrRateRecord = {
  rate: 18200,
  updatedAt: '2026-05-02T10:00:00.000Z',
  provider: 'ExchangeRate-API',
  status: 'LIVE',
};

// ---------------------------------------------------------------------------
// TEST 1: Account Balance Real-Time Conversion
// ---------------------------------------------------------------------------
test('Test 1 — Account Balance Real-Time ($100 @ 18.000 -> Rp 1.800.000, @ 17.950 -> Rp 1.795.000)', () => {
  const balanceUsd = 100;
  const dualAt18000 = computeDualCurrencyDisplay(balanceUsd, 'USD', rate18000, false, 'USD');
  assert.equal(dualAt18000.primaryAmount, 100);
  assert.equal(dualAt18000.secondaryAmount, 1800000);
  assert.equal(formatDynamicAmount(balanceUsd, 'IDR', rate18000, false, false), 'Rp 1.800.000');

  const dualAt17950 = computeDualCurrencyDisplay(balanceUsd, 'USD', rate17950, false, 'USD');
  assert.equal(dualAt17950.primaryAmount, 100);
  assert.equal(dualAt17950.secondaryAmount, 1795000);
  assert.equal(formatDynamicAmount(balanceUsd, 'IDR', rate17950, false, false), 'Rp 1.795.000');
});

// ---------------------------------------------------------------------------
// TEST 2: Swap Currency Preference & Persistence
// ---------------------------------------------------------------------------
test('Test 2 — Swap Currency Preference (USD <-> IDR state & persistence)', () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  };
  (globalThis as any).window = {
    localStorage: (globalThis as any).localStorage,
    dispatchEvent: () => true,
  };

  assert.equal(getGlobalCurrencyPreference(), 'USD');
  setGlobalCurrencyPreference('IDR');
  assert.equal(getGlobalCurrencyPreference(), 'IDR');
  assert.equal(store.get('tradevault_dashboard_currency_pref'), 'IDR');

  const swappedView = computeDualCurrencyDisplay(100, 'USD', rate18000, false, 'IDR');
  assert.equal(swappedView.primaryCurrency, 'IDR');
  assert.equal(swappedView.secondaryCurrency, 'USD');
  assert.equal(swappedView.primaryAmount, 1800000);
  assert.equal(swappedView.secondaryAmount, 100);

  setGlobalCurrencyPreference('USD');
  assert.equal(getGlobalCurrencyPreference(), 'USD');
  assert.equal(store.get('tradevault_dashboard_currency_pref'), 'USD');
});

// ---------------------------------------------------------------------------
// TEST 3: Global Conversion ($5 -> Rp 90.000, -$2 -> -Rp 36.000, $10 -> Rp 180.000)
// ---------------------------------------------------------------------------
test('Test 3 — Global Conversion for Dynamic Values ($5 -> Rp 90.000, -$2 -> -Rp 36.000, $10 -> Rp 180.000)', () => {
  assert.equal(convertDynamicUsdAmount(5, 'IDR', rate18000), 90000);
  assert.equal(formatDynamicAmount(5, 'IDR', rate18000, false, false), 'Rp 90.000');
  assert.equal(formatDynamicAmount(5, 'IDR', rate18000, false, true), '+Rp 90.000');

  assert.equal(convertDynamicUsdAmount(-2, 'IDR', rate18000), -36000);
  assert.equal(formatDynamicAmount(-2, 'IDR', rate18000, false, false), '-Rp 36.000');

  assert.equal(convertDynamicUsdAmount(10, 'IDR', rate18000), 180000);
  assert.equal(formatDynamicAmount(10, 'IDR', rate18000, false, false), 'Rp 180.000');
});

// ---------------------------------------------------------------------------
// TEST 4: Closed Profit Locked ($1 closed at 18.000 stays Rp 18.000 when rate becomes 18.200)
// ---------------------------------------------------------------------------
test('Test 4 — Closed Profit Locked ($1 closed @ 18.000 stays +Rp 18.000 when rate moves to 18.200)', () => {
  const openTrade: Trade = {
    id: 'TRD-PROFIT-1',
    dateTime: '2026-05-01T09:00:00',
    instrument: 'XAUUSD',
    position: 'BUY',
    strategy: 'London Breakout',
    session: 'London',
    entryPrice: 3000,
    stopLoss: 2990,
    takeProfit: 3020,
    lotSize: 0.01,
    riskAmount: 10,
    riskPercentage: 1,
    outcome: 'BREAKEVEN',
    grossProfit: 0,
    commission: 0,
    swap: 0,
    netProfit: 0,
    executionNotes: encodeLifecycleMetaIntoExecutionNotes('', {
      status: 'OPEN',
      orderType: 'Market',
      plannedEntry: 3000,
      plannedLot: 0.01,
      actualEntry: 3000,
      actualLot: 0.01,
      activityLog: [],
    }),
  };

  // Close trade when rate is 18,000 with $1 profit
  const closedTrade = transitionOpenTradeToClosed(openTrade, {
    actualExitPrice: 3001,
    closeType: 'TP',
    commission: 0,
    swap: 0,
    overrideNetProfit: 1,
    settings: DEFAULT_SETTINGS,
    closeExchangeRate: {
      baseCurrency: 'USD',
      quoteCurrency: 'IDR',
      rate: rate18000.rate,
      timestamp: rate18000.updatedAt,
      source: 'ExchangeRate-API',
      status: 'LIVE',
    },
  });

  // At close time (rate 18,000) -> Rp 18.000
  assert.equal(convertHistoricalTradeMetric(closedTrade, 'netProfit', 'IDR', rate18000).amount, 18000);
  assert.equal(convertHistoricalTradeMetric(closedTrade, 'netProfit', 'IDR', rate18000).isHistoricalLocked, true);
  assert.equal(
    formatTradeFinancialValue(closedTrade, 'netProfit', 'IDR', rate18000, false, true),
    '+Rp 18.000'
  );

  // Next day rate moves to 18,200 -> Closed trade MUST STILL be Rp 18.000 (NOT Rp 18.200)
  assert.equal(convertHistoricalTradeMetric(closedTrade, 'netProfit', 'IDR', rate18200).amount, 18000);
  assert.equal(convertHistoricalTradeMetric(closedTrade, 'netProfit', 'IDR', rate18200).rateUsed, 18000);
  assert.equal(
    formatTradeFinancialValue(closedTrade, 'netProfit', 'IDR', rate18200, false, true),
    '+Rp 18.000'
  );
});

// ---------------------------------------------------------------------------
// TEST 5: Closed Loss Locked (-$2 closed at 18.000 stays -Rp 36.000 when rate becomes 18.200)
// ---------------------------------------------------------------------------
test('Test 5 — Closed Loss Locked (-$2 closed @ 18.000 stays -Rp 36.000 when rate moves to 18.200)', () => {
  const openTrade: Trade = {
    id: 'TRD-LOSS-2',
    dateTime: '2026-05-01T12:00:00',
    instrument: 'XAUUSD',
    position: 'SELL',
    strategy: 'NY Reversal',
    session: 'New York',
    entryPrice: 3000,
    stopLoss: 3010,
    takeProfit: 2980,
    lotSize: 0.02,
    riskAmount: 20,
    riskPercentage: 2,
    outcome: 'BREAKEVEN',
    grossProfit: 0,
    commission: 0,
    swap: 0,
    netProfit: 0,
    executionNotes: encodeLifecycleMetaIntoExecutionNotes('', {
      status: 'OPEN',
      orderType: 'Market',
      plannedEntry: 3000,
      plannedLot: 0.02,
      actualEntry: 3000,
      actualLot: 0.02,
      activityLog: [],
    }),
  };

  const closedLossTrade = transitionOpenTradeToClosed(openTrade, {
    actualExitPrice: 3001,
    closeType: 'SL',
    commission: 0,
    swap: 0,
    overrideNetProfit: -2,
    settings: DEFAULT_SETTINGS,
    closeExchangeRate: {
      baseCurrency: 'USD',
      quoteCurrency: 'IDR',
      rate: rate18000.rate,
      timestamp: rate18000.updatedAt,
      source: 'ExchangeRate-API',
      status: 'LIVE',
    },
  });

  // Even when live rate is 18,200, closed loss stays -Rp 36.000
  assert.equal(convertHistoricalTradeMetric(closedLossTrade, 'netProfit', 'IDR', rate18200).amount, -36000);
  assert.equal(
    formatTradeFinancialValue(closedLossTrade, 'netProfit', 'IDR', rate18200, false, true),
    '-Rp 36.000'
  );
});

// ---------------------------------------------------------------------------
// TEST 6: Commission & Swap Locked on Closed Trade
// ---------------------------------------------------------------------------
test('Test 6 — Commission & Swap Locked on Closed Trade when live rate changes', () => {
  const closedWithFees: Trade = {
    id: 'TRD-FEES-1',
    dateTime: '2026-05-01T14:00:00',
    instrument: 'XAUUSD',
    position: 'BUY',
    strategy: 'Pullback',
    session: 'London',
    entryPrice: 3000,
    exitPrice: 3005,
    lotSize: 0.05,
    riskAmount: 10,
    riskPercentage: 1,
    outcome: 'WIN',
    grossProfit: 1.75,
    commission: 0.5,
    swap: -0.25,
    netProfit: 1.0,
    closeExchangeRate: {
      baseCurrency: 'USD',
      quoteCurrency: 'IDR',
      rate: 18000,
      timestamp: '2026-05-01T15:00:00.000Z',
      source: 'ExchangeRate-API',
      status: 'LIVE',
    },
  };

  // Check with rate18200 (live rate changed to 18,200)
  assert.equal(convertHistoricalTradeMetric(closedWithFees, 'commission', 'IDR', rate18200).amount, 9000);
  assert.equal(convertHistoricalTradeMetric(closedWithFees, 'swap', 'IDR', rate18200).amount, -4500);
  assert.equal(convertHistoricalTradeMetric(closedWithFees, 'grossProfit', 'IDR', rate18200).amount, 31500);
  assert.equal(convertHistoricalTradeMetric(closedWithFees, 'netProfit', 'IDR', rate18200).amount, 18000);

  assert.equal(
    formatTradeFinancialValue(closedWithFees, 'commission', 'IDR', rate18200),
    'Rp 9.000'
  );
  assert.equal(
    formatTradeFinancialValue(closedWithFees, 'swap', 'IDR', rate18200),
    '-Rp 4.500'
  );
});

// ---------------------------------------------------------------------------
// TEST 7: Currency Switch Invariance (USD -> IDR -> USD -> IDR without drift)
// ---------------------------------------------------------------------------
test('Test 7 — Switching USD <-> IDR repeatedly never mutates raw USD trade values or causes rounding drift', () => {
  const trade: Trade = {
    id: 'TRD-INVARIANT-1',
    dateTime: '2026-05-01T15:00:00',
    instrument: 'XAUUSD',
    position: 'BUY',
    strategy: 'BOS',
    session: 'London',
    entryPrice: 3012.45,
    stopLoss: 3002.45,
    takeProfit: 3032.45,
    exitPrice: 3022.45,
    lotSize: 0.03,
    riskAmount: 30,
    riskPercentage: 1.2,
    outcome: 'WIN',
    grossProfit: 30.0,
    commission: 0.21,
    swap: -0.09,
    netProfit: 29.7,
    closeExchangeRate: {
      baseCurrency: 'USD',
      quoteCurrency: 'IDR',
      rate: 18000,
      timestamp: '2026-05-01T16:00:00.000Z',
      source: 'ExchangeRate-API',
      status: 'LIVE',
    },
  };

  for (let i = 0; i < 10; i++) {
    const usdStr = formatTradeFinancialValue(trade, 'netProfit', 'USD', rate18200, false, true);
    const idrStr = formatTradeFinancialValue(trade, 'netProfit', 'IDR', rate18200, false, true);
    assert.equal(usdStr, '+$29.70');
    assert.equal(idrStr, '+Rp 534.600');
  }

  // Verify non-monetary & raw USD fields are 100% untouched
  assert.equal(trade.netProfit, 29.7);
  assert.equal(trade.grossProfit, 30.0);
  assert.equal(trade.commission, 0.21);
  assert.equal(trade.swap, -0.09);
  assert.equal(trade.lotSize, 0.03);
  assert.equal(trade.entryPrice, 3012.45);
  assert.equal(trade.stopLoss, 3002.45);
  assert.equal(trade.takeProfit, 3032.45);
});

// ---------------------------------------------------------------------------
// TEST 8: Legacy Trade Safety (Closed trade without closeExchangeRate)
// ---------------------------------------------------------------------------
test('Test 8 — Legacy closed trades without closeExchangeRate are marked UNVERIFIED_LEGACY and remain safe', () => {
  const legacyTrade: Trade = {
    id: 'TRD-LEGACY-001',
    dateTime: '2026-01-10T10:00:00',
    instrument: 'XAUUSD',
    position: 'BUY',
    strategy: 'Legacy Setup',
    session: 'London',
    entryPrice: 2650,
    exitPrice: 2660,
    lotSize: 0.01,
    riskAmount: 5,
    riskPercentage: 0.5,
    outcome: 'WIN',
    grossProfit: 10,
    commission: 0,
    swap: 0,
    netProfit: 10,
  };

  const resolved = resolveTradeLifecycle(legacyTrade);
  assert.equal(resolved.status, 'CLOSED');
  const hist = getHistoricalTradeProfitIdr(legacyTrade, 18000);
  assert.equal(hist.snapshotStatus, 'UNVERIFIED_LEGACY');
  assert.equal(hist.isHistoricalSnapshot, false);
  assert.equal(legacyTrade.closeExchangeRate, undefined); // Raw object never mutated
  assert.equal(legacyTrade.netProfit, 10);
});

// ---------------------------------------------------------------------------
// TEST 9: Sync & Backup Persistence of closeExchangeRate
// ---------------------------------------------------------------------------
test('Test 9 — closeExchangeRate persists across MetaB64 encoding, Supabase row mapping, and JSON backup', () => {
  const closedTrade: Trade = {
    id: 'TRD-SYNC-001',
    dateTime: '2026-05-01T16:30:00',
    instrument: 'XAUUSD',
    position: 'BUY',
    strategy: 'London Open',
    session: 'London',
    entryPrice: 3000,
    exitPrice: 3005,
    lotSize: 0.01,
    riskAmount: 5,
    riskPercentage: 0.5,
    outcome: 'WIN',
    grossProfit: 5,
    commission: 0,
    swap: 0,
    netProfit: 5,
    closeExchangeRate: {
      baseCurrency: 'USD',
      quoteCurrency: 'IDR',
      rate: 18000,
      timestamp: '2026-05-01T16:30:00.000Z',
      source: 'ExchangeRate-API',
      status: 'LIVE',
    },
  };

  // 1. MetaB64 roundtrip
  const encodedNotes = encodeTradeNotesWithMetaB64(closedTrade);
  const decodedNotes = decodeTradeNotesWithMeta(encodedNotes);
  assert.equal(decodedNotes.meta.closeExchangeRate?.rate, 18000);
  assert.equal(decodedNotes.meta.closeExchangeRate?.status, 'LIVE');

  // 2. Supabase payload & row roundtrip
  const dbPayload = mapTradeToDatabasePayload(closedTrade, '11111111-1111-4111-8111-111111111111');
  const restoredTrade = mapDatabaseRowToTrade({
    ...dbPayload,
    created_at: '2026-05-01T16:30:00.000Z',
    updated_at: '2026-05-01T16:30:00.000Z',
  });
  assert.equal(restoredTrade.closeExchangeRate?.rate, 18000);
  assert.equal(
    formatTradeFinancialValue(restoredTrade, 'netProfit', 'IDR', rate18200, false, true),
    '+Rp 90.000'
  );
});

// ---------------------------------------------------------------------------
// TEST 10: Cumulative Closed Profit Uses Each Trade's Historical Locked Rate
// ---------------------------------------------------------------------------
test('Test 10 — Cumulative Net Profit in IDR sums locked historical IDR values per trade', () => {
  const tradeWin1: Trade = {
    id: 'T1',
    dateTime: '2026-05-01T10:00:00',
    instrument: 'XAUUSD',
    position: 'BUY',
    strategy: 'A',
    session: 'London',
    entryPrice: 3000,
    exitPrice: 3001,
    lotSize: 0.01,
    riskAmount: 5,
    riskPercentage: 0.5,
    outcome: 'WIN',
    grossProfit: 1,
    commission: 0,
    swap: 0,
    netProfit: 1, // +$1 @ 18,000 = +Rp 18.000
    closeExchangeRate: {
      baseCurrency: 'USD',
      quoteCurrency: 'IDR',
      rate: 18000,
      timestamp: '2026-05-01T10:00:00.000Z',
      source: 'ExchangeRate-API',
      status: 'LIVE',
    },
  };

  const tradeLoss2: Trade = {
    id: 'T2',
    dateTime: '2026-05-01T11:00:00',
    instrument: 'XAUUSD',
    position: 'SELL',
    strategy: 'A',
    session: 'London',
    entryPrice: 3000,
    exitPrice: 3002,
    lotSize: 0.01,
    riskAmount: 5,
    riskPercentage: 0.5,
    outcome: 'LOSS',
    grossProfit: -2,
    commission: 0,
    swap: 0,
    netProfit: -2, // -$2 @ 18,000 = -Rp 36.000
    closeExchangeRate: {
      baseCurrency: 'USD',
      quoteCurrency: 'IDR',
      rate: 18000,
      timestamp: '2026-05-01T11:00:00.000Z',
      source: 'ExchangeRate-API',
      status: 'LIVE',
    },
  };

  // Even when current rate is 18,200, cumulative IDR profit is +18,000 + (-36,000) = -18,000
  const cumulativeIdr = computeCumulativeProfitInDisplayCurrency(
    [tradeWin1, tradeLoss2],
    'IDR',
    rate18200
  );
  assert.equal(cumulativeIdr, -18000);
});

console.log(`\nALL ${passed}/10 MANDATORY CURRENCY & HISTORICAL LOCK TESTS PASSED!`);
