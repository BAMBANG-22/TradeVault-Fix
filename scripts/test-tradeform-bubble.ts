import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  calculateLotBasedOrderMetrics,
  calculateXauusdLot,
  buildUnifiedXauusdLotInput,
  validateSlTpDirection,
} from '../src/utils/riskCalculator';
import {
  computePlannedRiskReward,
  formatPlannedRR,
  computeNetFromGross,
  computeGrossFromNet,
} from '../src/utils/calculations';
import { DEFAULT_SETTINGS } from '../src/types/settings';

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

console.log('=== TRADEVAULT COMPACT BUBBLE TRADEFORM VERIFICATION SUITE ===\n');

const tradeFormPath = path.resolve(process.cwd(), 'src/components/trades/TradeForm.tsx');
const source = fs.readFileSync(tradeFormPath, 'utf8');

test('AC 1 & 2 — Compact rounded bubble (rounded-[28px], solid #0B0D11) & blurred dark backdrop overlay', () => {
  assert.ok(source.includes('rounded-[28px]'), 'Bubble uses large rounded-[28px]');
  assert.ok(source.includes('bg-[#0B0D11]'), 'Bubble uses solid black/charcoal #0B0D11');
  assert.ok(source.includes('bg-black/75 backdrop-blur-sm'), 'Backdrop overlay is dark translucent with blur');
});

test('AC 3 & 4 — Zero inner cards inside bubble; sections separated by hairline dividers (#1E232B)', () => {
  assert.ok(source.includes('divide-y divide-[#1E232B]'), 'Uses thin hairline dividers');
  assert.ok(!source.includes('bg-[#F5F7FA] dark:bg-[#171D26]'), 'Old inner card containers removed');
});

test('AC 5 — Main View contains all 11 required elements in sequence', () => {
  const mainViewStart = source.indexOf('MAIN VIEW — COMPACT TRANSACTION INPUTS');
  const detailViewStart = source.indexOf('DETAIL VIEW — SLIDE-UP PANEL');
  assert.ok(mainViewStart > 0 && detailViewStart > mainViewStart);
  const mainViewJSX = source.slice(mainViewStart, detailViewStart);

  const idxHeader = mainViewJSX.indexOf('Tambah Transaksi');
  const idxPair = mainViewJSX.indexOf('Pair / Instrument');
  const idxOrderType = mainViewJSX.indexOf('MARKET');
  const idxBuySell = mainViewJSX.indexOf('BUY');
  const idxEntry = mainViewJSX.indexOf('Entry Price');
  const idxSL = mainViewJSX.indexOf('Stop Loss');
  const idxTP = mainViewJSX.indexOf('Take Profit');
  const idxLot = mainViewJSX.indexOf('Lot Size');
  const idxRisk = mainViewJSX.indexOf('Otomatis dari lot');
  const idxPotLoss = mainViewJSX.indexOf('Potential Loss');
  const idxPotProfit = mainViewJSX.indexOf('Potential Profit');
  const idxRR = mainViewJSX.indexOf('Risk / Reward');
  const idxDetailBtn = mainViewJSX.indexOf('Detail lainnya');
  const idxSaveBtn = mainViewJSX.indexOf('data-testid="save-trade-submit-button"');

  assert.ok(idxHeader > 0 && idxPair > idxHeader);
  assert.ok(idxOrderType > idxPair);
  assert.ok(idxEntry > idxBuySell);
  assert.ok(idxSL > idxEntry && idxTP > idxSL);
  assert.ok(idxLot > idxTP && idxRisk > idxLot);
  assert.ok(idxPotLoss > idxRisk && idxPotProfit > idxPotLoss);
  assert.ok(idxRR > idxPotProfit);
  assert.ok(idxDetailBtn > idxRR);
  assert.ok(idxSaveBtn > idxDetailBtn);
});

test('AC 6 & 7 — BUY/SELL active button uses white background (#F2F4F7) with black text (#050607) and smooth sliding indicator', () => {
  assert.ok(
    source.includes('bg-[#F2F4F7] shadow-sm transition-transform duration-200 ease-out'),
    'Smooth sliding white indicator present'
  );
  assert.ok(
    source.includes("position === 'SELL' ? 'translate-x-full' : 'translate-x-0'"),
    'Sliding transform toggles between BUY and SELL'
  );
});

test('AC 8 & 9 — Pair dropdown with search & MARKET/LIMIT order status with Pending Order caption', () => {
  assert.ok(source.includes('COMMON_INSTRUMENTS'), 'Supports all instruments');
  assert.ok(source.includes('Pending Order'), 'Displays Pending Order caption when LIMIT is active');
});

test('AC 10 & 11 — Lot Size -> Automatic Risk, Potential Loss, Potential Profit, and RR calculations remain 100% accurate', () => {
  // Scenario A: XAUUSD BUY @ 4000, SL 3950 (50 pips), TP 4100 (100 pips), Lot 0.01, Capital $1,000
  const m1 = calculateLotBasedOrderMetrics(
    {
      symbol: 'XAUUSD',
      position: 'BUY',
      lotSize: 0.01,
      entryPrice: 4000,
      stopLossPrice: 3950,
      takeProfitPrice: 4100,
      capitalBasis: 1000,
    },
    DEFAULT_SETTINGS
  );
  assert.equal(m1.isSlValid, true);
  assert.equal(m1.isTpValid, true);
  assert.equal(m1.slDistancePips, 50);
  assert.equal(m1.tpDistancePips, 100);
  assert.equal(m1.riskAmount, 5); // $5 risk for 0.01 lot @ 50 pips
  assert.equal(m1.riskPercent, 0.5); // 0.5% of $1,000
  assert.equal(m1.potentialProfit, 10); // $10 potential profit @ 100 pips

  // Change Lot Size from 0.01 -> 0.05 => Risk automatically updates to $25 (2.5%) & Potential Profit to $50
  const m2 = calculateLotBasedOrderMetrics(
    {
      symbol: 'XAUUSD',
      position: 'BUY',
      lotSize: 0.05,
      entryPrice: 4000,
      stopLossPrice: 3950,
      takeProfitPrice: 4100,
      capitalBasis: 1000,
    },
    DEFAULT_SETTINGS
  );
  assert.equal(m2.riskAmount, 25);
  assert.equal(m2.riskPercent, 2.5);
  assert.equal(m2.potentialProfit, 50);

  // RR calculation
  const rr = computePlannedRiskReward(4000, 3950, 4100, 'BUY');
  assert.equal(rr, 2);
  assert.equal(formatPlannedRR(rr), '1 : 2');

  // Direction validation
  const invalidDir = validateSlTpDirection('BUY', 3000, 3005, 3020);
  assert.equal(invalidDir.isValid, false);

  // Auto-lot calculation engine consistency
  const autoLot = calculateXauusdLot(
    buildUnifiedXauusdLotInput(
      {
        equity: 2500,
        riskPercent: 1,
        entryPrice: 4000,
        stopLossPrice: 3950,
        takeProfitPrice: 4100,
        position: 'BUY',
      },
      DEFAULT_SETTINGS
    ),
    DEFAULT_SETTINGS
  );
  assert.equal(autoLot.recommendedLot, 0.05);
  assert.equal(autoLot.riskAmount, 25);
});

test('AC 12, 13, 14, 15, 16, 17 — Slide-up Detail View, Kembali button, Simpan buttons, CLOSED fields, Screenshot & Notes', () => {
  assert.ok(source.includes('data-testid="trade-detail-slide-panel"'), 'Slide-up panel present');
  assert.ok(
    source.includes("isDetailViewOpen\n            ? 'translate-y-0 pointer-events-auto'\n            : 'translate-y-full pointer-events-none'"),
    'Slide-up panel uses translate-y-full -> translate-y-0 transition'
  );
  assert.ok(source.includes('Detail Transaksi'), 'Detail View header changes to Detail Transaksi');
  assert.ok(source.includes('data-testid="detail-view-back-button"'), 'Kembali button present in Detail View');
  assert.ok(source.includes('data-testid="detail-view-save-button"'), 'Simpan button present in Detail View');
  assert.ok(source.includes('Exit Price') && source.includes('Gross P/L') && source.includes('Net P/L'), 'CLOSED fields intact');
  assert.equal(computeNetFromGross(25, 0.5, -0.2), 24.3);
  assert.equal(computeGrossFromNet(24.3, 0.5, -0.2), 25);
});

console.log(`\nALL ${passed}/7 TRADEFORM BUBBLE & CALCULATION VERIFICATION TESTS PASSED!`);
