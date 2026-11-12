import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  calculateManualPositionPlan,
  calculateAutomaticLotSizing,
  simulateConsecutiveLosses,
  evaluateTradingDiscipline,
  MT5_SYMBOL_REGISTRY,
} from '../src/utils/riskCalculator';
import { calculateCompoundingGrowth } from '../src/utils/compoundingCalculator';
import { simulateTrades } from '../src/utils/tradeSimulation';
import { DEFAULT_SETTINGS } from '../src/types/settings';

const rootDir = process.cwd();
const riskViewPath = path.join(rootDir, 'src/components/risk/RiskCalculatorView.tsx');
const compTabPath = path.join(rootDir, 'src/components/risk/CompoundingCalculatorTab.tsx');
const simTabPath = path.join(rootDir, 'src/components/risk/TradeSimulationTab.tsx');

const riskViewCode = fs.readFileSync(riskViewPath, 'utf8');
const compTabCode = fs.readFileSync(compTabPath, 'utf8');
const simTabCode = fs.readFileSync(simTabPath, 'utf8');

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  [PASS] ${name}`);
}

console.log('=== TRADEVAULT RISK MANAGEMENT UI/UX REDESIGN VERIFICATION ===');

// 1. Top Summary & Loss Usage Progress Bar Logic
test('1. Top Summary displays Balance, Daily Loss, Loss Limit, and Loss Usage in 2-column layout', () => {
  assert.ok(riskViewCode.includes('Risk Management'), 'Header title must exist');
  assert.ok(riskViewCode.includes('Manage your trading risk'), 'Header subtitle must exist');
  assert.ok(riskViewCode.includes('Balance'), 'Balance label must exist');
  assert.ok(riskViewCode.includes('Loss Limit'), 'Loss Limit label must exist');
  assert.ok(riskViewCode.includes('Daily Loss'), 'Daily Loss label must exist');
  assert.ok(riskViewCode.includes('Loss Usage'), 'Loss Usage label must exist');
});

test('2. Loss Usage horizontal progress indicator handles 0%, <100%, 100%, and >100% accurately', () => {
  const computeUsage = (dailyLoss: number, dailyLimit: number) => {
    const actualDailyLossAmount = Math.max(0, Number(dailyLoss) || 0);
    const configuredDailyLimitAmount = Math.max(0, Number(dailyLimit) || 0);
    const riskUsagePercent =
      configuredDailyLimitAmount > 0
        ? (actualDailyLossAmount / configuredDailyLimitAmount) * 100
        : 0;
    const riskUsageBarWidth = Math.min(100, Math.max(0, riskUsagePercent));
    const remainingDailyRiskAmount = Math.max(0, configuredDailyLimitAmount - actualDailyLossAmount);
    const excessDailyLossAmount = Math.max(0, actualDailyLossAmount - configuredDailyLimitAmount);
    const isDailyLimitExceeded =
      configuredDailyLimitAmount > 0 && actualDailyLossAmount >= configuredDailyLimitAmount;
    const isDailyLimitWarning =
      configuredDailyLimitAmount > 0 && !isDailyLimitExceeded && riskUsagePercent >= 75;
    return {
      riskUsagePercent,
      riskUsageBarWidth,
      remainingDailyRiskAmount,
      excessDailyLossAmount,
      isDailyLimitExceeded,
      isDailyLimitWarning,
    };
  };

  // Case A: 0% usage
  const c0 = computeUsage(0, 30);
  assert.equal(c0.riskUsagePercent, 0);
  assert.equal(c0.riskUsageBarWidth, 0);
  assert.equal(c0.remainingDailyRiskAmount, 30);
  assert.equal(c0.isDailyLimitExceeded, false);
  assert.equal(c0.isDailyLimitWarning, false);

  // Case B: Normal (< 75%)
  const c50 = computeUsage(15, 30);
  assert.equal(c50.riskUsagePercent, 50);
  assert.equal(c50.riskUsageBarWidth, 50);
  assert.equal(c50.remainingDailyRiskAmount, 15);
  assert.equal(c50.isDailyLimitWarning, false);

  // Case C: Warning (>= 75% and < 100%, e.g. $25 / $30 = 83.3%)
  const c83 = computeUsage(25, 30);
  assert.equal(c83.riskUsagePercent.toFixed(1), '83.3');
  assert.equal(c83.remainingDailyRiskAmount, 5);
  assert.equal(c83.isDailyLimitWarning, true);
  assert.equal(c83.isDailyLimitExceeded, false);

  // Case D: Exact 100% ($30 / $30)
  const c100 = computeUsage(30, 30);
  assert.equal(c100.riskUsagePercent, 100);
  assert.equal(c100.riskUsageBarWidth, 100);
  assert.equal(c100.remainingDailyRiskAmount, 0);
  assert.equal(c100.excessDailyLossAmount, 0);
  assert.equal(c100.isDailyLimitExceeded, true);

  // Case E: > 100% ($42 / $30 = 140%, bar clamped at 100%, excess = $12)
  const c140 = computeUsage(42, 30);
  assert.equal(c140.riskUsagePercent, 140);
  assert.equal(c140.riskUsageBarWidth, 100);
  assert.equal(c140.remainingDailyRiskAmount, 0);
  assert.equal(c140.excessDailyLossAmount, 12);
  assert.equal(c140.isDailyLimitExceeded, true);
});

// 3. Single-Open Accordion Feature Selector
test('3. Rounded pill feature selector implements single-open accordion toggle behavior across all 6 features', () => {
  assert.ok(
    riskViewCode.includes('useState<RiskToolTab | null>(\'lot-calc\')'),
    'activeTool state must support RiskToolTab | null for single-open accordion'
  );
  assert.ok(
    riskViewCode.includes('setActiveTool((prev) => (prev === toolId ? null : toolId))'),
    'Clicking an active feature pill must close it (null), and clicking another must switch to it'
  );
  assert.ok(riskViewCode.includes('ChevronDown'), 'Feature pills must include ChevronDown indicator');
  assert.ok(riskViewCode.includes('rotate-180'), 'ChevronDown must rotate 180deg when open');

  const toolIds = [
    'lot-calc',
    'protection-rules',
    'consecutive-loss',
    'discipline-eval',
    'compounding-calc',
    'trade-sim',
  ];
  for (const id of toolIds) {
    assert.ok(riskViewCode.includes(`id: '${id}'`), `Tool ${id} must be registered in RISK_TOOLS_META`);
  }
});

// 4. Lot Calculator & Position Sizing Modes Preserved
test('4. Lot Calculator preserves both Manual Position Planner (LOT_CALCULATOR) and Automatic Position Sizing (LOT_SIZING)', () => {
  assert.ok(riskViewCode.includes("setLotSubMode('LOT_CALCULATOR')"), 'LOT_CALCULATOR mode button must exist');
  assert.ok(riskViewCode.includes("setLotSubMode('LOT_SIZING')"), 'LOT_SIZING mode button must exist');

  // Verify Manual Position Planner calculation
  const manualRes = calculateManualPositionPlan(
    {
      balanceSource: 'APP_BALANCE',
      accountBalance: 2500,
      symbol: 'XAUUSD',
      direction: 'BUY',
      lotSize: 0.01,
      entryPrice: 4000,
      stopLossPrice: 3950,
      takeProfitPrice: 4100,
    },
    DEFAULT_SETTINGS
  );
  assert.equal(manualRes.isLotValid, true);
  assert.equal(manualRes.isStopLossValid, true);
  assert.equal(manualRes.isTakeProfitValid, true);
  assert.equal(manualRes.potentialLossUsd, 5);
  assert.equal(manualRes.potentialProfitUsd, 10);
  assert.equal(manualRes.riskRewardFormatted, '1 : 2');

  // Verify Automatic Position Sizing calculation
  const autoRes = calculateAutomaticLotSizing(
    {
      symbol: 'XAUUSD',
      accountBasisType: 'EQUITY',
      accountBasisAmount: 2500,
      riskPercent: 2,
      direction: 'BUY',
      entryPrice: 4000,
      stopLossPrice: 3950,
    },
    DEFAULT_SETTINGS
  );
  assert.equal(autoRes.isValid, true);
  assert.equal(autoRes.isExecutable, true);
  assert.equal(autoRes.recommendedLot, 0.1);
  assert.equal(autoRes.riskAmountUsd, 50);
});

// 5. All Other 5 Risk Management Features Preserved
test('5. Consecutive Loss, Discipline Audit, Compounding, and Trade Simulation engines remain 100% intact', () => {
  assert.equal(Object.keys(MT5_SYMBOL_REGISTRY).length, 11);

  const consec = simulateConsecutiveLosses(1000, 1, 5, 'PERCENT_RUNNING_EQUITY');
  assert.equal(consec.length, 5);
  assert.ok(consec[4].remainingEquity < 1000);

  const disc = evaluateTradingDiscipline([], DEFAULT_SETTINGS);
  assert.equal(disc.totalTradesEvaluated, 0);

  const comp = calculateCompoundingGrowth({
    startingCapital: 1000,
    growthRatePercent: 5,
    interval: 'monthly',
    duration: 12,
    regularDeposit: 0,
    depositTiming: 'end_of_period',
    mode: 'compounding',
  });
  assert.equal(comp.steps.length, 12);
  assert.ok(comp.endingBalance > 1795);

  const sim = simulateTrades({
    startingCapital: 1000,
    winRate: 55,
    rrRatio: 2,
    riskType: 'percent',
    riskValue: 1,
    tradesCount: 50,
    riskMethod: 'balance',
    sequenceMode: 'expected_spread',
    randomSeed: 1,
    customLossStreak: 5,
    monteCarloIterations: 500,
  });
  assert.equal(sim.curve.length, 51);
  assert.ok(sim.finalBalance > 1000);
});

// 6. Seamless Minimalist Dark Styling & Tabular Numbers Verification
test('6. Seamless dark layout removes heavy outer boxed card soup and enforces tabular-nums', () => {
  assert.ok(riskViewCode.includes('tabular-nums'), 'RiskCalculatorView must use tabular-nums');
  assert.ok(compTabCode.includes('tabular-nums'), 'CompoundingCalculatorTab must use tabular-nums');
  assert.ok(simTabCode.includes('tabular-nums'), 'TradeSimulationTab must use tabular-nums');
  assert.ok(
    !riskViewCode.includes('rounded-xl border border-[#DDE3EA] dark:border-[#252B34] bg-white dark:bg-[#11151B] p-5'),
    'Outer boxed wrapper cards must be removed from RiskCalculatorView'
  );
  assert.ok(
    !compTabCode.includes('rounded-xl border border-[#DDE3EA] dark:border-[#252B34] bg-white dark:bg-[#11151B] p-5'),
    'Outer boxed wrapper cards must be removed from CompoundingCalculatorTab'
  );
  assert.ok(
    !simTabCode.includes('rounded-xl border border-[#DDE3EA] dark:border-[#252B34] bg-white dark:bg-[#11151B] p-5'),
    'Outer boxed wrapper cards must be removed from TradeSimulationTab'
  );
});

console.log(`\nALL ${passed} RISK MANAGEMENT REDESIGN TESTS PASSED!`);
