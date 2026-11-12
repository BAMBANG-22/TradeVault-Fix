export type CompoundingInterval = 'daily' | 'weekly' | 'monthly';
export type CompoundingMode = 'compounding' | 'fixed_withdrawn';
export type DepositTiming = 'end_of_period' | 'start_of_period';

export const MIN_GROWTH_RATE_PERCENT = -99.99;
export const MAX_GROWTH_RATE_PERCENT = 1000;

export interface CompoundingInput {
  startingCapital: number;
  growthRatePercent: number; // e.g. 5 for +5%, -5 for -5%
  interval: CompoundingInterval;
  duration: number; // e.g. 30 periods (1..1000)
  regularDeposit?: number; // optional routine contribution (>= 0)
  depositTiming?: DepositTiming; // default 'end_of_period'
  mode: CompoundingMode;
}

export interface CompoundingPeriodStep {
  period: number;
  startBalance: number;
  growthProfit: number;
  withdrawnProfit: number;
  deposit: number;
  endBalance: number; // Saldo yang benar-benar ada di dalam akun pada akhir periode
  cumulativeProfit: number; // Total profit yang dihasilkan sampai periode ini
  cumulativeWithdrawnProfit: number; // Akumulasi profit yang sudah ditarik (mode fixed_withdrawn)
  cumulativeDeposits: number;
  combinedWealth: number; // endBalance + cumulativeWithdrawnProfit
}

export interface CompoundingResult {
  startingCapital: number;
  endingBalance: number; // Saldo akhir di dalam akun (tidak mencampurkan profit yang sudah ditarik)
  totalProfit: number; // Total profit kumulatif
  totalWithdrawnProfit: number; // Total profit yang ditarik keluar akun (mode fixed_withdrawn)
  combinedTotalWealth: number; // endingBalance + totalWithdrawnProfit
  totalDeposits: number;
  totalContributedCapital: number; // startingCapital + totalDeposits
  pureGrowthProfit: number; // Total profit murni di luar deposit
  totalGrowthPercent: number; // Profit / Total Setoran (%) untuk compounding, atau Profit / Modal Awal (%) untuk fixed_withdrawn
  profitToTotalContributedPercent: number; // (pureGrowthProfit / (startingCapital + totalDeposits)) * 100
  profitToInitialCapitalPercent: number; // (pureGrowthProfit / startingCapital) * 100
  clampedGrowthRatePercent: number;
  isGrowthRateClamped: boolean;
  steps: CompoundingPeriodStep[];
}

function roundCurrency2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Calculates compounding growth or fixed/withdrawn profit for TradeVault.
 *
 * Mathematical Rules:
 * 1. Mode Compounding (`mode === 'compounding'`):
 *    - Deposit di awal periode (`start_of_period`):
 *      activeCapital = startBalance + deposit
 *      growthProfit = round2(activeCapital * rate)
 *      endBalance = round2(activeCapital + growthProfit)
 *    - Deposit di akhir periode (`end_of_period`):
 *      growthProfit = round2(startBalance * rate)
 *      endBalance = round2(startBalance + growthProfit + deposit)
 *
 * 2. Mode Profit Tetap / Profit Ditarik (`mode === 'fixed_withdrawn'`):
 *    - Profit setiap periode dihitung berdasarkan modal pokok awal (`startingCapital`):
 *      growthProfit = round2(startingCapital * rate)
 *    - Jika `growthProfit >= 0`, profit tersebut dipisahkan/ditarik (`withdrawnProfit = growthProfit`)
 *      dan TIDAK dimasukkan kembali ke dalam saldo akun (`endBalance = round2(startBalance + deposit)`).
 *    - Jika `growthProfit < 0` (simulasi penurunan modal), tidak ada profit yang ditarik (`withdrawnProfit = 0`)
 *      dan kerugian mengurangi saldo akun (`endBalance = Math.max(0, round2(startBalance + growthProfit + deposit))`).
 *    - `endingBalance` merepresentasikan saldo yang masih berada di dalam akun (`startingCapital + totalDeposits`),
 *      sedangkan `totalWithdrawnProfit` mencatat akumulasi profit yang ditarik, dan `combinedTotalWealth`
 *      mencatat total kekayaan gabungan (`endingBalance + totalWithdrawnProfit`).
 */
export function calculateCompoundingGrowth(input: CompoundingInput): CompoundingResult {
  const startingCapital = roundCurrency2(Math.max(0, Number(input.startingCapital) || 0));
  const rawGrowthRatePct = Number.isFinite(Number(input.growthRatePercent))
    ? Number(input.growthRatePercent)
    : 0;
  const clampedGrowthRatePercent = Math.min(
    MAX_GROWTH_RATE_PERCENT,
    Math.max(MIN_GROWTH_RATE_PERCENT, rawGrowthRatePct)
  );
  const isGrowthRateClamped = clampedGrowthRatePercent !== rawGrowthRatePct;
  const growthRate = clampedGrowthRatePercent / 100;

  const duration = Math.max(1, Math.min(1000, Math.floor(Number(input.duration) || 1)));
  const regularDeposit = roundCurrency2(Math.max(0, Number(input.regularDeposit) || 0));
  const depositTiming = input.depositTiming || 'end_of_period';
  const mode = input.mode || 'compounding';

  const steps: CompoundingPeriodStep[] = [];
  let currentStart = startingCapital;
  let runningProfit = 0;
  let runningWithdrawn = 0;
  let runningDeposits = 0;

  for (let p = 1; p <= duration; p++) {
    let growthProfit = 0;
    let withdrawnProfit = 0;
    let endBalance = currentStart;

    if (mode === 'compounding') {
      if (depositTiming === 'start_of_period') {
        const principalWithDeposit = roundCurrency2(currentStart + regularDeposit);
        growthProfit = roundCurrency2(principalWithDeposit * growthRate);
        endBalance = Math.max(0, roundCurrency2(principalWithDeposit + growthProfit));
      } else {
        // end_of_period: saldo akhir = saldo awal × (1 + r) + deposit
        growthProfit = roundCurrency2(currentStart * growthRate);
        endBalance = Math.max(0, roundCurrency2(currentStart + growthProfit + regularDeposit));
      }
    } else {
      // Fixed / Withdrawn Profit mode:
      // Profit each period is calculated strictly from the initial principal capital.
      growthProfit = roundCurrency2(startingCapital * growthRate);
      if (growthProfit >= 0) {
        withdrawnProfit = growthProfit;
        endBalance = roundCurrency2(currentStart + regularDeposit);
      } else {
        withdrawnProfit = 0;
        endBalance = Math.max(0, roundCurrency2(currentStart + growthProfit + regularDeposit));
      }
    }

    runningProfit = roundCurrency2(runningProfit + growthProfit);
    runningWithdrawn = roundCurrency2(runningWithdrawn + withdrawnProfit);
    runningDeposits = roundCurrency2(runningDeposits + regularDeposit);
    const combinedWealth = roundCurrency2(endBalance + runningWithdrawn);

    steps.push({
      period: p,
      startBalance: currentStart,
      growthProfit,
      withdrawnProfit,
      deposit: regularDeposit,
      endBalance,
      cumulativeProfit: runningProfit,
      cumulativeWithdrawnProfit: runningWithdrawn,
      cumulativeDeposits: runningDeposits,
      combinedWealth,
    });

    currentStart = endBalance;
  }

  const finalStep = steps[steps.length - 1];
  const endingBalance = finalStep ? finalStep.endBalance : startingCapital;
  const totalProfit = runningProfit;
  const totalWithdrawnProfit = runningWithdrawn;
  const totalDeposits = runningDeposits;
  const totalContributedCapital = roundCurrency2(startingCapital + totalDeposits);
  const combinedTotalWealth = roundCurrency2(endingBalance + totalWithdrawnProfit);
  const pureGrowthProfit = totalProfit;

  const profitToTotalContributedPercent =
    totalContributedCapital > 0
      ? roundCurrency2((pureGrowthProfit / totalContributedCapital) * 100)
      : 0;
  const profitToInitialCapitalPercent =
    startingCapital > 0 ? roundCurrency2((pureGrowthProfit / startingCapital) * 100) : 0;

  const totalGrowthPercent =
    mode === 'fixed_withdrawn'
      ? profitToInitialCapitalPercent
      : profitToTotalContributedPercent;

  return {
    startingCapital,
    endingBalance,
    totalProfit,
    totalWithdrawnProfit,
    combinedTotalWealth,
    totalDeposits,
    totalContributedCapital,
    pureGrowthProfit,
    totalGrowthPercent,
    profitToTotalContributedPercent,
    profitToInitialCapitalPercent,
    clampedGrowthRatePercent,
    isGrowthRateClamped,
    steps,
  };
}
