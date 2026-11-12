export type RiskMethod = 'balance' | 'initial_capital';
export type RiskType = 'percent' | 'nominal';
export type SequenceMode =
  | 'expected_spread'
  | 'win_streak_first'
  | 'loss_streak_first'
  | 'custom_loss_streak'
  | 'monte_carlo_random';

export const MONTE_CARLO_ITERATION_OPTIONS = [1000, 5000, 10000] as const;
export const CUSTOM_LOSS_STREAK_PRESETS = [1, 3, 5, 8, 10, 15] as const;
export const CONSECUTIVE_LOSS_PRESETS = CUSTOM_LOSS_STREAK_PRESETS;
export const MAX_MONTE_CARLO_SAMPLE_PATHS = 4;

export interface TradeSimulationInput {
  startingCapital: number;
  winRate: number; // 0 - 100
  rrRatio: number; // Reward : Risk ratio (e.g. 2.5 for 1:2.5)
  riskType: RiskType; // 'percent' or 'nominal'
  riskValue: number; // e.g. 1.5 (%) or 10 ($)
  tradesCount: number; // e.g. 30 (1..500)
  riskMethod: RiskMethod; // 'balance' (compounding) or 'initial_capital' (fixed)
  sequenceMode?: SequenceMode;
  customLossStreak?: number; // used when sequenceMode === 'custom_loss_streak'
  randomSeed?: number; // deterministic PRNG seed
  monteCarloRuns?: number; // default 1000 (supports 1000, 5000, 10000)
  monteCarloIterations?: number; // alias for monteCarloRuns
}

export interface TradeSimulationStep {
  tradeNum: number;
  isWin: boolean;
  riskAmount: number;
  pnl: number;
  equity: number;
  peakEquity: number;
  drawdownPercent: number;
  drawdownDollar: number;
  isRiskCapped?: boolean;
}

export interface MonteCarloSummary {
  runsCount: number;
  iterationsRun: number;
  seedUsed: number;
  percentileMethod: 'LINEAR_INTERPOLATION_R7';
  medianFinalBalance: number;
  p95BestCase: number;
  p5WorstCase: number;
  probabilityOfProfit: number; // % of runs with finalBalance > startingCapital
  averageMaxDrawdown: number; // average of max drawdown % across all runs
  samplePaths: { runIndex: number; label: string; curve: number[] }[];
}

export interface TradeSimulationResult {
  startingCapital: number;
  finalBalance: number;
  totalNetProfit: number;
  totalGainPercent: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  winCount: number;
  lossCount: number;
  targetWinCount: number;
  targetLossCount: number;
  actualWinRatePercent: number;
  actualLossRatePercent: number;
  requestedLossStreak: number;
  actualInitialLossStreak: number;
  actualMaxLossStreak: number;
  actualMaxWinStreak: number;
  isLossStreakExceedingTotalLosses: boolean;
  lossStreakWarningMessage?: string;
  isRiskCappedByEquity: boolean;
  expectancyR: number; // in R multiples per trade
  expectancyDollar: number; // in $ based on 1st trade risk
  firstTradeRiskDollar: number;
  maxDrawdownPercent: number;
  maxDrawdownDollar: number;
  maxDrawdownPercentTradeNum: number;
  maxDrawdownDollarTradeNum: number;
  curve: TradeSimulationStep[];
  monteCarlo: MonteCarloSummary;
  assumptions: string[];
}

function round2(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

/**
 * Deterministic 32-bit seed mixer (MurmurHash3 finalizer) to derive independent,
 * reproducible sub-seeds from a master seed and an iteration index.
 */
export function deriveMonteCarloRunSeed(masterSeed: number, runIndex: number): number {
  const cleanMaster = Number.isFinite(masterSeed) ? Math.floor(masterSeed) | 0 : 1;
  let h = cleanMaster ^ Math.imul((runIndex + 1) | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Mulberry32 deterministic seeded PRNG returning uniform floats in [0, 1).
 * Never uses Math.random().
 */
export function createSeededPrng(seed: number): () => number {
  let state = (Math.floor(seed) | 0) ^ 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Computes the p-th percentile (0 <= p <= 1) of a sorted ascending numeric array
 * using standard R-7 linear interpolation (equivalent to Excel PERCENTILE.INC / NumPy linear).
 * Guarantees P5 <= P50 (Median) <= P95 for any non-empty sorted array.
 */
export function computePercentileLinear(sortedAsc: ArrayLike<number>, p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  if (n === 1) return sortedAsc[0];
  const clampedP = Math.min(1, Math.max(0, p));
  const pos = clampedP * (n - 1);
  const lowerIdx = Math.floor(pos);
  const upperIdx = Math.min(n - 1, lowerIdx + 1);
  const weight = pos - lowerIdx;
  return sortedAsc[lowerIdx] + weight * (sortedAsc[upperIdx] - sortedAsc[lowerIdx]);
}

function distributeWinsEvenly(totalSlots: number, winsCount: number): boolean[] {
  const seq: boolean[] = [];
  if (totalSlots <= 0) return seq;
  if (winsCount >= totalSlots) return Array(totalSlots).fill(true);
  if (winsCount <= 0) return Array(totalSlots).fill(false);

  let accumulated = 0;
  for (let i = 0; i < totalSlots; i++) {
    accumulated += winsCount;
    if (accumulated >= totalSlots) {
      seq.push(true);
      accumulated -= totalSlots;
    } else {
      seq.push(false);
    }
  }
  return seq;
}

/**
 * Builds the sequence of wins and losses based on mode, win rate, custom loss streak, and deterministic seed.
 */
export function generateTradeSequence(
  tradesCount: number,
  winRate: number,
  mode: SequenceMode,
  customLossStreak: number = 5,
  randomSeed: number = 1
): boolean[] {
  if (tradesCount <= 0) return [];
  const winFraction = Math.min(100, Math.max(0, winRate)) / 100;
  const exactWins = Math.round(tradesCount * winFraction);
  const exactLosses = tradesCount - exactWins;

  if (mode === 'win_streak_first') {
    return [...Array(exactWins).fill(true), ...Array(exactLosses).fill(false)];
  }

  if (mode === 'loss_streak_first') {
    return [...Array(exactLosses).fill(false), ...Array(exactWins).fill(true)];
  }

  if (mode === 'custom_loss_streak') {
    const requestedLosses = Math.max(0, Math.floor(Number(customLossStreak) || 0));
    const placedInitialLosses = Math.min(requestedLosses, exactLosses);
    const remainingLosses = exactLosses - placedInitialLosses;
    const remainingSlots = tradesCount - placedInitialLosses;

    const initialStreakPart = Array(placedInitialLosses).fill(false);
    if (remainingSlots <= 0) {
      return initialStreakPart;
    }
    if (exactWins <= 0) {
      return Array(tradesCount).fill(false);
    }
    if (remainingLosses <= 0) {
      return [...initialStreakPart, ...Array(remainingSlots).fill(true)];
    }

    // When placedInitialLosses > 0 and exactWins > 0, place 1 win immediately after
    // the initial loss streak so the initial consecutive loss streak is strictly `placedInitialLosses`,
    // then distribute the remaining (exactWins - 1) wins and remainingLosses evenly across the rest.
    if (placedInitialLosses > 0) {
      const restPart = distributeWinsEvenly(remainingSlots - 1, exactWins - 1);
      return [...initialStreakPart, true, ...restPart];
    }

    return distributeWinsEvenly(tradesCount, exactWins);
  }

  if (mode === 'monte_carlo_random') {
    // Pure independent Bernoulli trials using deterministic seeded PRNG
    const prng = createSeededPrng(deriveMonteCarloRunSeed(randomSeed, 0));
    const seq: boolean[] = [];
    for (let i = 0; i < tradesCount; i++) {
      seq.push(prng() < winFraction);
    }
    return seq;
  }

  // Default: 'expected_spread'
  return distributeWinsEvenly(tradesCount, exactWins);
}

/**
 * Simulates a single sequence of trades, tracking running equity, peak equity, and drawdown from peak.
 */
function runSingleSequence(
  sequence: boolean[],
  startingCapital: number,
  rrRatio: number,
  riskType: RiskType,
  riskValue: number,
  riskMethod: RiskMethod
): { steps: TradeSimulationStep[]; anyRiskCapped: boolean } {
  const steps: TradeSimulationStep[] = [
    {
      tradeNum: 0,
      isWin: false,
      riskAmount: 0,
      pnl: 0,
      equity: round2(startingCapital),
      peakEquity: round2(startingCapital),
      drawdownPercent: 0,
      drawdownDollar: 0,
      isRiskCapped: false,
    },
  ];

  let currentEq = startingCapital;
  let peak = startingCapital;
  let anyRiskCapped = false;

  for (let i = 0; i < sequence.length; i++) {
    const isWin = sequence[i];

    // Compute requested risk in dollars for this trade
    let requestedRiskDollar = 0;
    if (riskMethod === 'initial_capital') {
      requestedRiskDollar =
        riskType === 'percent'
          ? (startingCapital * Math.max(0, riskValue)) / 100
          : Math.max(0, riskValue);
    } else {
      // 'balance' (compounding dynamic risk from current running equity)
      requestedRiskDollar =
        riskType === 'percent'
          ? (currentEq * Math.max(0, riskValue)) / 100
          : Math.max(0, riskValue);
    }

    // Safety guard: cannot risk more than available equity (equity never goes negative)
    let riskDollar = requestedRiskDollar;
    let isRiskCapped = false;
    if (currentEq <= 0) {
      riskDollar = 0;
      if (requestedRiskDollar > 0) {
        isRiskCapped = true;
        anyRiskCapped = true;
      }
    } else if (riskDollar > currentEq) {
      riskDollar = currentEq;
      isRiskCapped = true;
      anyRiskCapped = true;
    }

    const pnl = isWin ? riskDollar * rrRatio : -riskDollar;
    currentEq = Math.max(0, currentEq + pnl);

    if (currentEq > peak) {
      peak = currentEq;
    }

    const drawdownDollar = peak > currentEq ? peak - currentEq : 0;
    const drawdownPercent = peak > 0 ? (drawdownDollar / peak) * 100 : 0;

    steps.push({
      tradeNum: i + 1,
      isWin,
      riskAmount: round2(riskDollar),
      pnl: round2(pnl),
      equity: round2(currentEq),
      peakEquity: round2(peak),
      drawdownPercent: round2(drawdownPercent),
      drawdownDollar: round2(drawdownDollar),
      isRiskCapped,
    });
  }

  return { steps, anyRiskCapped };
}

/**
 * Fast allocation-free Monte Carlo single run evaluator for high iteration counts (1,000 - 10,000)
 * that computes final equity and max drawdown % without allocating step objects when sample curve is not needed.
 */
function runFastMonteCarloIteration(
  tradesCount: number,
  winFraction: number,
  startingCapital: number,
  rrRatio: number,
  riskType: RiskType,
  riskValue: number,
  riskMethod: RiskMethod,
  prng: () => number,
  recordCurve: boolean
): { endEquity: number; maxDrawdownPercent: number; curve?: number[] } {
  let currentEq = startingCapital;
  let peak = startingCapital;
  let maxDdPct = 0;
  const curve: number[] | undefined = recordCurve ? [round2(startingCapital)] : undefined;

  for (let i = 0; i < tradesCount; i++) {
    const isWin = prng() < winFraction;

    let riskDollar =
      riskMethod === 'initial_capital'
        ? riskType === 'percent'
          ? (startingCapital * riskValue) / 100
          : riskValue
        : riskType === 'percent'
        ? (currentEq * riskValue) / 100
        : riskValue;

    if (currentEq <= 0) {
      riskDollar = 0;
    } else if (riskDollar > currentEq) {
      riskDollar = currentEq;
    }

    const pnl = isWin ? riskDollar * rrRatio : -riskDollar;
    currentEq = Math.max(0, currentEq + pnl);

    if (currentEq > peak) {
      peak = currentEq;
    }

    const ddDollar = peak > currentEq ? peak - currentEq : 0;
    const ddPct = peak > 0 ? (ddDollar / peak) * 100 : 0;
    const roundedDdPct = round2(ddPct);
    if (roundedDdPct > maxDdPct) {
      maxDdPct = roundedDdPct;
    }

    if (curve) {
      curve.push(round2(currentEq));
    }
  }

  return {
    endEquity: round2(currentEq),
    maxDrawdownPercent: maxDdPct,
    curve,
  };
}

function computeStreakStats(sequence: boolean[]): {
  initialLossStreak: number;
  maxLossStreak: number;
  maxWinStreak: number;
} {
  let initialLossStreak = 0;
  for (let i = 0; i < sequence.length; i++) {
    if (!sequence[i]) {
      initialLossStreak++;
    } else {
      break;
    }
  }

  let maxLossStreak = 0;
  let maxWinStreak = 0;
  let curLoss = 0;
  let curWin = 0;

  for (let i = 0; i < sequence.length; i++) {
    if (sequence[i]) {
      curWin++;
      curLoss = 0;
      if (curWin > maxWinStreak) maxWinStreak = curWin;
    } else {
      curLoss++;
      curWin = 0;
      if (curLoss > maxLossStreak) maxLossStreak = curLoss;
    }
  }

  return { initialLossStreak, maxLossStreak, maxWinStreak };
}

/**
 * Runs full trade simulation with expectancy, drawdown analysis, custom consecutive loss stress test,
 * and deterministic seeded Monte Carlo multi-path simulation.
 */
export function simulateTrades(input: TradeSimulationInput): TradeSimulationResult {
  const startingCapital = Math.max(0, Number(input.startingCapital) || 0);
  const winRate = Math.min(100, Math.max(0, Number(input.winRate) || 0));
  const rrRatio = Math.max(0.01, Number(input.rrRatio) || 1.0);
  const riskType = input.riskType || 'percent';
  const riskValue = Math.max(0, Number(input.riskValue) || 0);
  const tradesCount = Math.max(1, Math.min(500, Math.floor(Number(input.tradesCount) || 1)));
  const riskMethod = input.riskMethod || 'balance';
  const sequenceMode = input.sequenceMode || 'expected_spread';
  const requestedLossStreak =
    input.customLossStreak !== undefined && input.customLossStreak !== null
      ? Math.max(0, Math.floor(Number(input.customLossStreak) || 0))
      : 5;
  const seedUsed =
    input.randomSeed !== undefined &&
    input.randomSeed !== null &&
    Number.isFinite(Number(input.randomSeed))
      ? Math.floor(Number(input.randomSeed))
      : 1;
  const requestedRuns = input.monteCarloIterations ?? input.monteCarloRuns;
  const rawMonteCarloRuns =
    requestedRuns !== undefined &&
    requestedRuns !== null &&
    Number(requestedRuns) > 0
      ? Math.floor(Number(requestedRuns))
      : 1000;
  const monteCarloRuns = Math.max(1, Math.min(10000, rawMonteCarloRuns));

  const winFraction = winRate / 100;
  const targetWinCount = Math.round(tradesCount * winFraction);
  const targetLossCount = tradesCount - targetWinCount;

  // 1. Generate the active sequence
  const sequence = generateTradeSequence(
    tradesCount,
    winRate,
    sequenceMode,
    requestedLossStreak,
    seedUsed
  );
  const { steps: curve, anyRiskCapped } = runSingleSequence(
    sequence,
    startingCapital,
    rrRatio,
    riskType,
    riskValue,
    riskMethod
  );

  const finalStep = curve[curve.length - 1];
  const finalBalance = finalStep ? finalStep.equity : round2(startingCapital);
  const totalNetProfit = round2(finalBalance - startingCapital);
  const totalGainPercent =
    startingCapital > 0 ? round2((totalNetProfit / startingCapital) * 100) : 0;

  const winCount = sequence.filter(Boolean).length;
  const lossCount = sequence.length - winCount;
  const actualWinRatePercent =
    tradesCount > 0 ? round2((winCount / tradesCount) * 100) : 0;
  const actualLossRatePercent =
    tradesCount > 0 ? round2((lossCount / tradesCount) * 100) : 0;

  const { initialLossStreak, maxLossStreak, maxWinStreak } = computeStreakStats(sequence);
  const isLossStreakExceedingTotalLosses =
    sequenceMode === 'custom_loss_streak' && requestedLossStreak > targetLossCount;
  const lossStreakWarningMessage = isLossStreakExceedingTotalLosses
    ? `Jumlah loss beruntun yang diminta (${requestedLossStreak} loss) melebihi total loss yang tersedia pada Win Rate ${winRate}% (${targetLossCount} loss dari ${tradesCount} transaksi). Simulasi menempatkan maksimal ${targetLossCount} loss yang tersedia di awal tanpa mengubah total Win/Loss.`
    : undefined;

  // Mathematical Expectancy (R multiples)
  const winProb = winRate / 100;
  const lossProb = 1 - winProb;
  const expectancyR = winProb * rrRatio - lossProb * 1.0;

  // Expectancy in dollars based on first trade risk
  const rawFirstTradeRisk =
    riskType === 'percent' ? (startingCapital * riskValue) / 100 : riskValue;
  const firstTradeRiskDollar = Math.min(startingCapital, Math.max(0, rawFirstTradeRisk));
  const expectancyDollar = expectancyR * firstTradeRiskDollar;

  // Max drawdown in the active curve (tracking both % and $ and their trade numbers)
  let maxDrawdownPercent = 0;
  let maxDrawdownDollar = 0;
  let maxDrawdownPercentTradeNum = 0;
  let maxDrawdownDollarTradeNum = 0;
  let rawGrossProfit = 0;
  let rawGrossLoss = 0;

  for (const s of curve) {
    if (s.tradeNum > 0) {
      if (s.pnl > 0) rawGrossProfit += s.pnl;
      else if (s.pnl < 0) rawGrossLoss += Math.abs(s.pnl);
    }
    if (s.drawdownPercent > maxDrawdownPercent) {
      maxDrawdownPercent = s.drawdownPercent;
      maxDrawdownPercentTradeNum = s.tradeNum;
    }
    if (s.drawdownDollar > maxDrawdownDollar) {
      maxDrawdownDollar = s.drawdownDollar;
      maxDrawdownDollarTradeNum = s.tradeNum;
    }
  }

  const grossProfit = round2(rawGrossProfit);
  const grossLoss = round2(rawGrossLoss);
  const profitFactor =
    grossLoss > 0 ? round2(rawGrossProfit / rawGrossLoss) : grossProfit > 0 ? Infinity : 0;

  // 2. Run deterministic seeded Monte Carlo simulation
  const endBalances = new Float64Array(monteCarloRuns);
  let sumMaxDd = 0;
  let profitableRuns = 0;
  const samplePathsData: { runIndex: number; label: string; curve: number[] }[] = [];

  for (let r = 0; r < monteCarloRuns; r++) {
    const iterSeed = deriveMonteCarloRunSeed(seedUsed, r + 1);
    const prng = createSeededPrng(iterSeed);
    const shouldRecordSample = r < MAX_MONTE_CARLO_SAMPLE_PATHS;

    const mcOut = runFastMonteCarloIteration(
      tradesCount,
      winFraction,
      startingCapital,
      rrRatio,
      riskType,
      riskValue,
      riskMethod,
      prng,
      shouldRecordSample
    );

    endBalances[r] = mcOut.endEquity;
    sumMaxDd += mcOut.maxDrawdownPercent;
    if (mcOut.endEquity > startingCapital) {
      profitableRuns++;
    }

    if (shouldRecordSample && mcOut.curve) {
      samplePathsData.push({
        runIndex: r + 1,
        label: `Simulasi Acak #${r + 1}`,
        curve: mcOut.curve,
      });
    }
  }

  endBalances.sort();

  const p5WorstCase = round2(computePercentileLinear(endBalances, 0.05));
  const medianFinalBalance = round2(computePercentileLinear(endBalances, 0.5));
  const p95BestCase = round2(computePercentileLinear(endBalances, 0.95));
  const probabilityOfProfit = round2((profitableRuns / monteCarloRuns) * 100);
  const avgMaxDd = round2(sumMaxDd / monteCarloRuns);

  const assumptions: string[] = [
    `Parameter: Win Rate input ${winRate}% (Aktual skenario: ${winCount}W / ${lossCount}L atau ${actualWinRatePercent}% Win), R:R 1:${rrRatio}, Risiko ${riskValue}${riskType === 'percent' ? '%' : '$'} per trade.`,
    riskMethod === 'balance'
      ? 'Metode Risiko: Saldo Berjalan (Compounding) — risiko persen dihitung dari ekuitas terkini sebelum setiap transaksi; Expectancy uang dihitung dari risiko transaksi pertama.'
      : 'Metode Risiko: Modal Awal Tetap (Flat Risk) — risiko selalu dihitung konstan dari modal pokok awal.',
    `Monte Carlo menjalankan ${monteCarloRuns.toLocaleString('id-ID')} iterasi percobaan Bernoulli independen menggunakan PRNG deterministik (Seed #${seedUsed}) dengan metode persentil interpolasi linier (P5, P50/Median, P95).`,
    'Slippage, komisi broker, dan biaya swap tidak diperhitungkan dalam simulasi statistik ini.',
  ];

  return {
    startingCapital: round2(startingCapital),
    finalBalance,
    totalNetProfit,
    totalGainPercent,
    grossProfit,
    grossLoss,
    profitFactor,
    winCount,
    lossCount,
    targetWinCount,
    targetLossCount,
    actualWinRatePercent,
    actualLossRatePercent,
    requestedLossStreak,
    actualInitialLossStreak: initialLossStreak,
    actualMaxLossStreak: maxLossStreak,
    actualMaxWinStreak: maxWinStreak,
    isLossStreakExceedingTotalLosses,
    lossStreakWarningMessage,
    isRiskCappedByEquity: anyRiskCapped,
    expectancyR: round2(expectancyR),
    expectancyDollar: round2(expectancyDollar),
    firstTradeRiskDollar: round2(firstTradeRiskDollar),
    maxDrawdownPercent: round2(maxDrawdownPercent),
    maxDrawdownDollar: round2(maxDrawdownDollar),
    maxDrawdownPercentTradeNum,
    maxDrawdownDollarTradeNum,
    curve,
    monteCarlo: {
      runsCount: monteCarloRuns,
      iterationsRun: monteCarloRuns,
      seedUsed,
      percentileMethod: 'LINEAR_INTERPOLATION_R7',
      medianFinalBalance,
      p95BestCase,
      p5WorstCase,
      probabilityOfProfit,
      averageMaxDrawdown: avgMaxDd,
      samplePaths: samplePathsData,
    },
    assumptions,
  };
}
