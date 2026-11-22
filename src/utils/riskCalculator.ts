import { AppSettings, DEFAULT_SETTINGS } from '../types/settings';
import { Trade } from '../types/trade';
import { computePlannedRiskReward, computeTradeNetProfit } from './calculations';

export interface LotCalculationInput {
  symbol?: string; // default 'XAUUSD'; supports 'EURUSD', 'GBPUSD', 'USDJPY', 'BTCUSD', etc.
  equity: number;
  riskPercent: number; // e.g. 1.0 for 1%
  riskAmountManual?: number; // if user wants to specify fixed dollar risk
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice?: number;
  position: 'BUY' | 'SELL';
  contractSize?: number; // default 100 oz
  tickSize?: number; // default 0.01
  tickValue?: number; // default 1.00 per standard lot
  minLot?: number; // default 0.01
  maxLot?: number; // default 100.00
  lotStep?: number; // default 0.01
  commissionPerLot?: number; // optional broker commission per 1.00 lot
  leverage?: number; // default 500 (1:500)
  accountCurrency?: string;
}

export const XAUUSD_PIP_SIZE = 0.1; // Standar Pip XAUUSD TradeVault: 1 pip = 0.10 perubahan harga XAUUSD (4000 -> 3995 = 50 pips)
export const POSITION_SIZING_RISK_PRESETS = [0.5, 1.0, 1.5, 2.0, 3.0] as const;

export interface LotCalculationResult {
  symbol?: string;
  riskAmount: number;
  slDistancePrice: number; // in $ (e.g. $5.00)
  slDistancePips: number; // in pips (1 pip = 0.10 perubahan harga XAUUSD, e.g. 50 pips)
  slDistancePoints: number; // in points (e.g. 500 points)
  pipValuePerStandardLot?: number; // $10.00 per pip for 1.00 standard lot (100 oz)
  pipValuePer001Lot?: number; // $0.10 per pip for 0.01 lot (100 oz)
  pipValueForRecommendedLot?: number; // recommendedLot * pipValuePerStandardLot
  calculatedLot: number; // unrounded exact (e.g. 0.05)
  recommendedLot: number; // floored to broker lot step (e.g. 0.05)
  isBelowMinLot: boolean;
  isCappedAtMaxLot?: boolean;
  minLot: number;
  maxLot?: number;
  lotStep: number;
  lossPerLot: number;
  estimatedLossAtSL: number;
  // Take Profit & R:R
  hasCustomTP: boolean;
  tpDistancePrice: number;
  tpDistancePips: number;
  estimatedProfitAtTP: number;
  rewardRiskRatio: number;
  tpScenarios: {
    ratio: string;
    targetPrice: number;
    profitAmount: number;
    gainPercent: number;
  }[];
  // Margin Estimation
  hasMarginEstimate: boolean;
  requiredMargin: number;
  freeMarginRemaining: number;
  marginLevelPercent: number;
  leverage: number;
  isValid: boolean;
  errorMessage?: string;
}

export type ConsecutiveLossMethod = 'PERCENT_RUNNING_EQUITY' | 'FIXED_NOMINAL';

export interface ConsecutiveLossStep {
  lossNumber: number;
  remainingEquity: number;
  dollarLost: number;
  cumulativeDrawdownPercent: number;
  isAccountBlown: boolean;
}

export interface DisciplineEvaluationResult {
  hasSufficientData: boolean;
  totalTradesEvaluated: number;
  lossTradesEvaluated: number;
  tradesWithIncompleteData: number;
  // Risk Violations
  overRiskTradesCount: number; // loss exceeded planned risk amount (+5% tolerance)
  excessiveRiskTradesCount: number; // planned risk % exceeded max allowed trade risk
  dailyLossViolationsCount: number; // days where daily loss exceeded daily limit
  maxConsecutiveLossesEncountered: number;
  consecutiveLossBreachesCount: number; // times streak hit or exceeded limit
  // Rule Compliance Breakdown (X / N)
  riskPerTradeCompliantCount?: number;
  stopLossCompliantCount?: number;
  tradingPlanCompliantCount?: number;
  dailyLimitCompliantCount?: number;
  dailyLimitTotalDays?: number;
  dailyLimitCompliantDays?: number;
  totalViolationsCount?: number;
  // Discipline score
  disciplineScore: number; // 0 - 100
  disciplineGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  auditFindings: {
    type: 'VIOLATION' | 'WARNING' | 'COMPLIANT';
    title: string;
    description: string;
  }[];
}

const BIGINT_SCALE_8 = 100_000_000n; // 10^8 exact decimal scaling

/**
 * Converts a finite decimal number into a scaled BigInt (10^8 units) without IEEE-754 binary
 * drift (such as 0.29 * 100 = 28.999999999999996).
 * Uses canonical 10-decimal string representation first to eliminate binary representation noise
 * at the 10^-16 ulp level, then applies exact integer rounding ('NEAREST' | 'FLOOR' | 'CEIL')
 * to 8 decimal places.
 */
export function parseDecimalToScaledBigInt(
  value: number,
  mode: 'NEAREST' | 'FLOOR' | 'CEIL' = 'NEAREST'
): bigint {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('ERR_NON_FINITE_DECIMAL: Value must be a finite number.');
  }
  if (value === 0) return 0n;

  const isNegative = value < 0;
  const absVal = Math.abs(value);
  // Format to 10 decimal digits to strip IEEE-754 1e-16 noise while preserving 8+2 fractional digits
  const fixed10 = absVal.toFixed(10);
  const [intPartStr, frac10Str = '0000000000'] = fixed10.split('.');
  const paddedFrac10 = frac10Str.padEnd(10, '0').slice(0, 10);

  const main8Str = paddedFrac10.slice(0, 8);
  const rem2Num = parseInt(paddedFrac10.slice(8, 10), 10);

  let scaledAbs = BigInt(intPartStr) * BIGINT_SCALE_8 + BigInt(main8Str);

  if (rem2Num > 0) {
    if (mode === 'NEAREST') {
      if (rem2Num >= 50) {
        scaledAbs += 1n;
      }
    } else if (mode === 'CEIL') {
      if (!isNegative) {
        scaledAbs += 1n;
      }
    } else if (mode === 'FLOOR') {
      if (isNegative) {
        scaledAbs += 1n;
      }
    }
  }

  return isNegative ? -scaledAbs : scaledAbs;
}

function scaledBigIntToNumber(scaled: bigint, decimals: number): number {
  const isNeg = scaled < 0n;
  const absScaled = isNeg ? -scaled : scaled;
  const intPart = absScaled / BIGINT_SCALE_8;
  const fracPart = absScaled % BIGINT_SCALE_8;
  const fracStr = fracPart.toString().padStart(8, '0');
  const num = Number(`${isNeg ? '-' : ''}${intPart.toString()}.${fracStr}`);
  return Number(num.toFixed(decimals));
}

function countStepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 2;
  const str = step.toFixed(8).replace(/0+$/, '');
  const dotIdx = str.indexOf('.');
  if (dotIdx === -1) return 2;
  return Math.max(2, str.length - dotIdx - 1);
}

/**
 * Converts XAUUSD price difference into TradeVault standard pips (1 pip = 0.10 perubahan harga XAUUSD).
 * Examples:
 * - Entry 4000, SL 3995 -> 50 pips
 * - Entry 4000, SL 3994 -> 60 pips
 * - Entry 4000, SL 3999 -> 10 pips
 * - Entry 4000, SL 3999.5 -> 5 pips
 * - Entry 4000, TP 4010 -> 100 pips
 */
export function convertXauusdPriceToPips(
  priceA: number,
  priceB: number,
  pipSize: number = XAUUSD_PIP_SIZE
): number {
  if (!Number.isFinite(priceA) || !Number.isFinite(priceB)) return 0;
  const activePipSize =
    typeof pipSize === 'number' && Number.isFinite(pipSize) && pipSize > 0
      ? pipSize
      : XAUUSD_PIP_SIZE;
  const aScaled = parseDecimalToScaledBigInt(priceA, 'NEAREST');
  const bScaled = parseDecimalToScaledBigInt(priceB, 'NEAREST');
  const diffScaled = aScaled > bScaled ? aScaled - bScaled : bScaled - aScaled;
  const pipSizeScaled = parseDecimalToScaledBigInt(activePipSize, 'NEAREST');
  const pipsScaled = (diffScaled * BIGINT_SCALE_8 + pipSizeScaled / 2n) / pipSizeScaled;
  return scaledBigIntToNumber(pipsScaled, 2);
}

export interface UnifiedXauusdCalculatorParams {
  symbol?: string;
  equity: number;
  riskPercent: number;
  riskAmountManual?: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice?: number;
  position: 'BUY' | 'SELL';
  contractSize?: number;
  minLot?: number;
  lotStep?: number;
  maxLot?: number;
  leverage?: number;
  accountCurrency?: string;
}

/**
 * Shared parameter normalizer ensuring Trade Log Auto-Lot Calculator and
 * Risk Calculator -> Position Sizing / Lot Calculator pass identical inputs and broker specifications
 * into `calculateXauusdLot()`.
 */
export function buildUnifiedXauusdLotInput(
  params: UnifiedXauusdCalculatorParams,
  settings: Partial<AppSettings> = DEFAULT_SETTINGS
): LotCalculationInput {
  const symbolKey = (params.symbol || 'XAUUSD').trim().toUpperCase();
  const isDefaultXau = !params.symbol || symbolKey === 'XAUUSD';
  const spec = !isDefaultXau ? getInstrumentPipSpec(symbolKey, settings) : undefined;
  return {
    symbol: isDefaultXau ? 'XAUUSD' : spec?.symbol || symbolKey,
    equity: params.equity,
    riskPercent: params.riskPercent,
    riskAmountManual: params.riskAmountManual,
    entryPrice: params.entryPrice,
    stopLossPrice: params.stopLossPrice,
    takeProfitPrice: params.takeProfitPrice,
    position: params.position,
    contractSize:
      params.contractSize ??
      (isDefaultXau ? settings?.xauusdContractSize ?? 100 : spec?.contractSize ?? 100),
    minLot:
      params.minLot ?? (isDefaultXau ? settings?.xauusdMinLot ?? 0.01 : spec?.minLot ?? 0.01),
    lotStep:
      params.lotStep ?? (isDefaultXau ? settings?.xauusdLotStep ?? 0.01 : spec?.lotStep ?? 0.01),
    maxLot: params.maxLot ?? (spec?.maxLot ?? 100),
    leverage: params.leverage ?? settings?.defaultLeverage ?? 500,
    accountCurrency: params.accountCurrency ?? settings?.currency ?? 'USD',
  };
}

/**
 * Calculate position sizing for XAUUSD (Gold) and all supported MT5 instruments using exact scaled BigInt rational arithmetic (10^8 scale),
 * conservative floor on risk budget, lotStep/minLot/maxLot alignment, and strict invariant enforcement:
 * estimatedLossAtSL <= riskAmount.
 *
 * Strictly separates three distinct quantities:
 * A. Jarak harga: abs(Entry - SL)
 * B. Jarak pip: jarak harga / pipSize (Mode B = 1.00, Mode A = 0.10 for XAUUSD)
 * C. Nilai uang: jarak pip × pip value sesuai lot ($10.00/pip per 1.00 lot; $0.10/pip per 0.01 lot pada 100 oz)
 */
export function calculateXauusdLot(
  input: LotCalculationInput,
  settings: AppSettings = DEFAULT_SETTINGS
): LotCalculationResult {
  const symbolRaw = (input.symbol || 'XAUUSD').trim().toUpperCase();
  const isXauusd = !input.symbol || symbolRaw === 'XAUUSD' || symbolRaw.startsWith('XAUUSD');
  const instrumentSpec = !isXauusd ? getInstrumentPipSpec(symbolRaw, settings) : undefined;
  const effectiveSymbol = isXauusd ? 'XAUUSD' : instrumentSpec?.symbol || symbolRaw;
  const effectivePipSize = isXauusd
    ? typeof settings?.xauusdPipSize === 'number' &&
      Number.isFinite(settings.xauusdPipSize) &&
      settings.xauusdPipSize > 0
      ? settings.xauusdPipSize
      : XAUUSD_PIP_SIZE
    : instrumentSpec!.pipSize;
  const priceDigits = isXauusd ? 2 : instrumentSpec!.digits;

  const rawContractSize =
    input.contractSize !== undefined && input.contractSize !== null
      ? Number(input.contractSize)
      : isXauusd
      ? settings?.xauusdContractSize ?? 100
      : instrumentSpec!.contractSize;
  const rawEquity =
    input.equity !== undefined && input.equity !== null ? Number(input.equity) : 1000;
  const rawLotStep =
    input.lotStep !== undefined && input.lotStep !== null
      ? Number(input.lotStep)
      : isXauusd
      ? settings?.xauusdLotStep ?? 0.01
      : instrumentSpec!.lotStep;
  const rawMinLot =
    input.minLot !== undefined && input.minLot !== null
      ? Number(input.minLot)
      : isXauusd
      ? settings?.xauusdMinLot ?? 0.01
      : instrumentSpec!.minLot;
  const rawMaxLot =
    input.maxLot !== undefined && input.maxLot !== null
      ? Number(input.maxLot)
      : isXauusd
      ? 100
      : instrumentSpec!.maxLot;
  const rawCommissionPerLot =
    input.commissionPerLot !== undefined && input.commissionPerLot !== null
      ? Number(input.commissionPerLot)
      : 0;
  const leverage =
    input.leverage !== undefined && input.leverage !== null && Number(input.leverage) > 0
      ? Number(input.leverage)
      : settings?.defaultLeverage || 500;

  // Resolve base pip value per 0.01 lot (default $0.10/pip per 0.01 lot -> $10.00/pip per 1.00 lot at 100 oz)
  const basePipValuePer001 = isXauusd
    ? settings &&
      typeof settings.xauusdPipValuePer001Lot === 'number' &&
      Number.isFinite(settings.xauusdPipValuePer001Lot) &&
      settings.xauusdPipValuePer001Lot > 0
      ? Number(settings.xauusdPipValuePer001Lot)
      : 0.1
    : instrumentSpec!.pipValuePer001Lot;

  const hasManualRisk =
    input.riskAmountManual !== undefined &&
    input.riskAmountManual !== null &&
    Number(input.riskAmountManual) > 0;

  const entry = Number(input.entryPrice);
  const sl = Number(input.stopLossPrice);
  const tp =
    input.takeProfitPrice !== undefined &&
    input.takeProfitPrice !== null &&
    !isNaN(Number(input.takeProfitPrice)) &&
    Number(input.takeProfitPrice) > 0
      ? Number(input.takeProfitPrice)
      : undefined;

  const safeMinLotDisplay = Number.isFinite(rawMinLot) && rawMinLot > 0 ? rawMinLot : 0.01;
  const safeMaxLotDisplay = Number.isFinite(rawMaxLot) && rawMaxLot > 0 ? rawMaxLot : 100;
  const safeLotStepDisplay = Number.isFinite(rawLotStep) && rawLotStep > 0 ? rawLotStep : 0.01;
  const safeEquityDisplay = Number.isFinite(rawEquity) && rawEquity > 0 ? rawEquity : 0;
  const safeContractDisplay =
    Number.isFinite(rawContractSize) && rawContractSize > 0 ? rawContractSize : 100;
  const defaultPipValPerStdLot = isXauusd
    ? Number((basePipValuePer001 * safeContractDisplay).toFixed(4))
    : instrumentSpec!.pipValuePerStandardLot;
  const defaultPipValPer001Lot = Number((defaultPipValPerStdLot / 100).toFixed(4));

  const defaultResult: LotCalculationResult = {
    symbol: effectiveSymbol,
    riskAmount: 0,
    slDistancePrice: 0,
    slDistancePips: 0,
    slDistancePoints: 0,
    pipValuePerStandardLot: defaultPipValPerStdLot,
    pipValuePer001Lot: defaultPipValPer001Lot,
    pipValueForRecommendedLot: 0,
    calculatedLot: 0,
    recommendedLot: 0,
    isBelowMinLot: false,
    isCappedAtMaxLot: false,
    minLot: safeMinLotDisplay,
    maxLot: safeMaxLotDisplay,
    lotStep: safeLotStepDisplay,
    lossPerLot: 0,
    estimatedLossAtSL: 0,
    hasCustomTP: false,
    tpDistancePrice: 0,
    tpDistancePips: 0,
    estimatedProfitAtTP: 0,
    rewardRiskRatio: 0,
    tpScenarios: [],
    hasMarginEstimate: false,
    requiredMargin: 0,
    freeMarginRemaining: safeEquityDisplay,
    marginLevelPercent: 0,
    leverage,
    isValid: false,
  };

  // Validate lotStep, minLot, maxLot, contractSize, and commissionPerLot
  if (!Number.isFinite(rawLotStep) || rawLotStep <= 0) {
    return {
      ...defaultResult,
      errorMessage: 'Parameter lotStep harus berupa angka positif (> 0).',
    };
  }
  if (!Number.isFinite(rawMinLot) || rawMinLot <= 0) {
    return {
      ...defaultResult,
      errorMessage: 'Parameter minLot harus berupa angka positif (> 0).',
    };
  }
  if (!Number.isFinite(rawMaxLot) || rawMaxLot <= 0) {
    return {
      ...defaultResult,
      errorMessage: 'Parameter maxLot harus berupa angka positif (> 0).',
    };
  }
  if (rawMinLot > rawMaxLot) {
    return {
      ...defaultResult,
      errorMessage: `Parameter minLot (${rawMinLot}) tidak boleh melebihi maxLot (${rawMaxLot}).`,
    };
  }
  if (!Number.isFinite(rawContractSize) || rawContractSize <= 0) {
    return {
      ...defaultResult,
      errorMessage: 'Ukuran kontrak (contractSize) harus berupa angka positif (> 0).',
    };
  }
  if (!Number.isFinite(rawCommissionPerLot) || rawCommissionPerLot < 0) {
    return {
      ...defaultResult,
      errorMessage: 'Komisi per lot tidak boleh bernilai negatif.',
    };
  }

  // Compute conservative risk budget in scaled BigInt (FLOOR so risk budget is NEVER rounded up)
  let riskAmountScaled: bigint;
  let rawRiskAmountFloat: number;
  if (hasManualRisk) {
    const manualVal = Number(input.riskAmountManual);
    if (!Number.isFinite(manualVal) || manualVal <= 0) {
      return {
        ...defaultResult,
        errorMessage: 'Nominal risiko manual harus berupa angka positif (> 0).',
      };
    }
    riskAmountScaled = parseDecimalToScaledBigInt(manualVal, 'FLOOR');
    rawRiskAmountFloat = manualVal;
  } else {
    if (!Number.isFinite(rawEquity) || rawEquity <= 0) {
      return {
        ...defaultResult,
        errorMessage: 'Saldo ekuitas (equity) harus berupa angka positif (> 0).',
      };
    }
    const rawRiskPct =
      input.riskPercent !== undefined && input.riskPercent !== null
        ? Number(input.riskPercent)
        : 1.0;
    if (!Number.isFinite(rawRiskPct) || rawRiskPct <= 0) {
      return {
        ...defaultResult,
        errorMessage: 'Persentase risiko (riskPercent) harus berupa angka positif (> 0).',
      };
    }
    const equityScaled = parseDecimalToScaledBigInt(rawEquity, 'FLOOR');
    const riskPctScaled = parseDecimalToScaledBigInt(rawRiskPct, 'FLOOR');
    riskAmountScaled = (equityScaled * riskPctScaled) / (100n * BIGINT_SCALE_8);
    rawRiskAmountFloat = scaledBigIntToNumber(riskAmountScaled, 6);
  }

  if (riskAmountScaled <= 0n) {
    return {
      ...defaultResult,
      errorMessage: 'Batas risiko efektif bernilai nol atau negatif.',
    };
  }

  const riskAmountDisplay = Number(
    (Number(riskAmountScaled) / Number(BIGINT_SCALE_8)).toFixed(6)
  );
  defaultResult.riskAmount = Number(riskAmountDisplay.toFixed(2));

  if (!Number.isFinite(entry) || !Number.isFinite(sl) || entry <= 0 || sl <= 0) {
    return {
      ...defaultResult,
      errorMessage: 'Masukkan harga Entry dan Stop Loss yang valid (angka positif).',
    };
  }

  // Direction & Price Validation
  if (input.position === 'BUY') {
    if (sl >= entry) {
      return {
        ...defaultResult,
        errorMessage:
          'Untuk posisi BUY, Stop Loss ($' +
          sl.toFixed(priceDigits) +
          ') harus berada di bawah Entry Price ($' +
          entry.toFixed(priceDigits) +
          ').',
      };
    }
    if (tp !== undefined && tp <= entry) {
      return {
        ...defaultResult,
        errorMessage:
          'Untuk posisi BUY, Take Profit ($' +
          tp.toFixed(priceDigits) +
          ') harus berada di atas Entry Price ($' +
          entry.toFixed(priceDigits) +
          ').',
      };
    }
  } else {
    // SELL
    if (sl <= entry) {
      return {
        ...defaultResult,
        errorMessage:
          'Untuk posisi SELL, Stop Loss ($' +
          sl.toFixed(priceDigits) +
          ') harus berada di atas Entry Price ($' +
          entry.toFixed(priceDigits) +
          ').',
      };
    }
    if (tp !== undefined && tp >= entry) {
      return {
        ...defaultResult,
        errorMessage:
          'Untuk posisi SELL, Take Profit ($' +
          tp.toFixed(priceDigits) +
          ') harus berada di bawah Entry Price ($' +
          entry.toFixed(priceDigits) +
          ').',
      };
    }
  }

  // ===========================================================================
  // A. JARAK HARGA: abs(Entry - SL)
  // ===========================================================================
  const entryScaled = parseDecimalToScaledBigInt(entry, 'NEAREST');
  const slScaled = parseDecimalToScaledBigInt(sl, 'NEAREST');
  const slDistanceScaled = entryScaled > slScaled ? entryScaled - slScaled : slScaled - entryScaled;

  // Minimum SL distance check: 0.001 in 10^8 scale = 100_000n for XAUUSD; point/2 for FX/CFD
  const minSlThresholdScaled = isXauusd
    ? 100_000n
    : parseDecimalToScaledBigInt(instrumentSpec!.point / 2, 'NEAREST');
  if (slDistanceScaled <= minSlThresholdScaled) {
    return {
      ...defaultResult,
      errorMessage: 'Jarak Stop Loss terlalu sempit (kurang dari $0.01).',
    };
  }

  const slDistancePriceExact = Number(slDistanceScaled) / Number(BIGINT_SCALE_8);
  const pointDivisor = isXauusd ? 0.01 : instrumentSpec!.point;
  const slDistancePoints = Math.round(slDistancePriceExact / pointDivisor);

  // ===========================================================================
  // B. JARAK PIP: jarak harga / effectivePipSize (default 0.10 for XAUUSD)
  // ===========================================================================
  const pipSizeScaled = parseDecimalToScaledBigInt(effectivePipSize, 'NEAREST');
  const slDistancePipsScaled = (slDistanceScaled * BIGINT_SCALE_8) / pipSizeScaled;
  const slDistancePips = Number((slDistancePriceExact / effectivePipSize).toFixed(2));

  // ===========================================================================
  // C. NILAI UANG: jarak pip × pip value sesuai lot
  // Standard XAUUSD (100 oz):
  //   0.01 lot -> $0.10/pip (50 pips = $5, 100 pips = $10)
  //   0.05 lot -> $0.50/pip (50 pips = $25, 100 pips = $50)
  //   0.10 lot -> $1.00/pip (50 pips = $50, 100 pips = $100)
  //   1.00 lot -> $10.00/pip (50 pips = $500, 100 pips = $1,000)
  // ===========================================================================
  const pipValuePerStandardLot = isXauusd
    ? Number((basePipValuePer001 * rawContractSize).toFixed(4))
    : instrumentSpec!.pipValuePerStandardLot;
  const pipValuePer001Lot = Number((pipValuePerStandardLot / 100).toFixed(4));
  const pipValuePerStandardLotScaled = parseDecimalToScaledBigInt(
    pipValuePerStandardLot,
    'NEAREST'
  );
  const commissionPerLotScaled = parseDecimalToScaledBigInt(rawCommissionPerLot, 'CEIL');
  const priceLossProduct16 = slDistancePipsScaled * pipValuePerStandardLotScaled;
  const priceLossPerLotScaled =
    (priceLossProduct16 + (BIGINT_SCALE_8 - 1n)) / BIGINT_SCALE_8;
  const lossPerLotScaled = priceLossPerLotScaled + commissionPerLotScaled;

  if (lossPerLotScaled <= 0n) {
    return {
      ...defaultResult,
      errorMessage: 'Perhitungan loss per lot bernilai nol.',
    };
  }

  const lotStepScaled = parseDecimalToScaledBigInt(rawLotStep, 'NEAREST');
  const minLotScaled = parseDecimalToScaledBigInt(rawMinLot, 'NEAREST');
  const rawMaxLotScaled = parseDecimalToScaledBigInt(rawMaxLot, 'FLOOR');

  if (lotStepScaled <= 0n || minLotScaled <= 0n || rawMaxLotScaled <= 0n) {
    return {
      ...defaultResult,
      errorMessage: 'Konfigurasi lotStep, minLot, atau maxLot terlalu kecil.',
    };
  }

  // Align maxLot down to a valid multiple of lotStep (Requirement 8)
  const alignedMaxSteps = rawMaxLotScaled / lotStepScaled;
  const alignedMaxLotScaled = alignedMaxSteps * lotStepScaled;
  if (alignedMaxLotScaled < minLotScaled) {
    return {
      ...defaultResult,
      errorMessage:
        'Batas maxLot setelah disejajarkan ke kelipatan lotStep lebih kecil dari minLot.',
    };
  }

  // Cost of 1 lotStep in 10^16 units & riskBudget in 10^16 units
  const costPerStep16 = lossPerLotScaled * lotStepScaled;
  const riskBudget16 = riskAmountScaled * BIGINT_SCALE_8;

  // Exact integer step count (floored)
  const rawStepsCount = riskBudget16 / costPerStep16;
  const isCappedAtMaxLot = rawStepsCount > alignedMaxSteps;
  const cappedStepsCount = isCappedAtMaxLot ? alignedMaxSteps : rawStepsCount;

  let candidateLotScaled = cappedStepsCount * lotStepScaled;

  // Enforce integer invariant in 10^16 rational arithmetic:
  // candidateLotScaled * lossPerLotScaled <= riskBudget16
  while (
    candidateLotScaled > 0n &&
    candidateLotScaled * lossPerLotScaled > riskBudget16
  ) {
    candidateLotScaled -= lotStepScaled;
  }

  // Requirement 9: If candidate lot is below minLot, NEVER raise lot above risk budget; set recommendedLot = 0
  const isBelowMinLot = candidateLotScaled < minLotScaled;
  const finalLotScaled = isBelowMinLot ? 0n : candidateLotScaled;

  const stepDecimals = countStepDecimals(rawLotStep);
  const recommendedLot = scaledBigIntToNumber(finalLotScaled, stepDecimals);
  const pipValueForRecommendedLot = Number((recommendedLot * pipValuePerStandardLot).toFixed(4));

  // Exact loss at SL in 10^8 scaled units (ceiling to 10^-8 so loss is never underestimated)
  const exactLoss16 = finalLotScaled * lossPerLotScaled;
  const estimatedLossScaled =
    (exactLoss16 + (BIGINT_SCALE_8 - 1n)) / BIGINT_SCALE_8;
  const estimatedLossAtSL = Number(
    (Number(estimatedLossScaled) / Number(BIGINT_SCALE_8)).toFixed(2)
  );

  const lossPerLotFloat = Number(lossPerLotScaled) / Number(BIGINT_SCALE_8);
  const exactCalculatedLot = rawRiskAmountFloat / lossPerLotFloat;

  // Take Profit & R:R calculations if custom TP is given
  let hasCustomTP = false;
  let tpDistancePrice = 0;
  let tpDistancePips = 0;
  let estimatedProfitAtTP = 0;
  let rewardRiskRatio = 0;

  if (tp !== undefined) {
    hasCustomTP = true;
    const tpScaled = parseDecimalToScaledBigInt(tp, 'NEAREST');
    // A. Jarak harga TP: abs(TP - Entry)
    const tpDistScaled = tpScaled > entryScaled ? tpScaled - entryScaled : entryScaled - tpScaled;
    tpDistancePrice = Number(tpDistScaled) / Number(BIGINT_SCALE_8);
    // B. Jarak pip TP: jarak harga / effectivePipSize
    tpDistancePips = Number((tpDistancePrice / effectivePipSize).toFixed(2));
    // C. Nilai uang TP: jarak pip × pip value sesuai lot
    estimatedProfitAtTP = Number((tpDistancePips * pipValueForRecommendedLot).toFixed(2));
    rewardRiskRatio = computePlannedRiskReward(entry, sl, tp, input.position) ?? 0;
  }

  // Preset R:R scenarios (1:2, 1:3, 1:5)
  const presetRatios = [
    { label: '1:2', mult: 2.0 },
    { label: '1:3', mult: 3.0 },
    { label: '1:5', mult: 5.0 },
  ];

  const tpScenarios = presetRatios.map((r) => {
    const tpPrice =
      input.position === 'BUY'
        ? entry + slDistancePriceExact * r.mult
        : entry - slDistancePriceExact * r.mult;

    const profit = estimatedLossAtSL > 0 ? estimatedLossAtSL * r.mult : rawRiskAmountFloat * r.mult;
    const gainPct = rawEquity > 0 ? (profit / rawEquity) * 100 : 0;

    return {
      ratio: r.label,
      targetPrice: Number(tpPrice.toFixed(priceDigits)),
      profitAmount: Number(profit.toFixed(2)),
      gainPercent: Number(gainPct.toFixed(2)),
    };
  });

  // Margin estimation
  const notionalValue = recommendedLot * rawContractSize * entry;
  const requiredMargin = leverage > 0 ? Number((notionalValue / leverage).toFixed(2)) : 0;
  const freeMarginRemaining = Number((rawEquity - requiredMargin).toFixed(2));
  const marginLevelPercent =
    requiredMargin > 0 ? Number(((rawEquity / requiredMargin) * 100).toFixed(1)) : 0;

  return {
    symbol: effectiveSymbol,
    riskAmount: Number(rawRiskAmountFloat.toFixed(2)),
    slDistancePrice: Number(slDistancePriceExact.toFixed(5)),
    slDistancePips,
    slDistancePoints,
    pipValuePerStandardLot,
    pipValuePer001Lot,
    pipValueForRecommendedLot,
    calculatedLot: Number(exactCalculatedLot.toFixed(3)),
    recommendedLot,
    isBelowMinLot,
    isCappedAtMaxLot,
    minLot: rawMinLot,
    maxLot: scaledBigIntToNumber(alignedMaxLotScaled, stepDecimals),
    lotStep: rawLotStep,
    lossPerLot: Number(lossPerLotFloat.toFixed(2)),
    estimatedLossAtSL,
    hasCustomTP,
    tpDistancePrice: Number(tpDistancePrice.toFixed(5)),
    tpDistancePips,
    estimatedProfitAtTP,
    rewardRiskRatio,
    tpScenarios,
    hasMarginEstimate: leverage > 0 && entry > 0,
    requiredMargin,
    freeMarginRemaining,
    marginLevelPercent,
    leverage,
    isValid: true,
  };
}

export const calculateInstrumentLot = calculateXauusdLot;

/**
 * Single authoritative entry point for both Trade Log Auto-Lot Calculator and
 * Risk Calculator -> Position Sizing / Lot Calculator. Normalizes inputs and broker specifications
 * before invoking `calculateXauusdLot()`.
 */
export function calculateUnifiedXauusdPosition(
  params: UnifiedXauusdCalculatorParams,
  settings: AppSettings = DEFAULT_SETTINGS
): LotCalculationResult {
  const normalizedInput = buildUnifiedXauusdLotInput(params, settings);
  return calculateXauusdLot(normalizedInput, settings);
}

/**
 * Simulate consecutive losses and drawdown impact under geometric vs linear models
 */
export function simulateConsecutiveLosses(
  startingCapital: number,
  riskPercentOrNominal: number,
  stepsCount: number = 10,
  method: ConsecutiveLossMethod = 'PERCENT_RUNNING_EQUITY'
): ConsecutiveLossStep[] {
  const steps: ConsecutiveLossStep[] = [];
  let runningCapital = Math.max(1, startingCapital);
  const capitalBase = runningCapital;

  for (let i = 1; i <= stepsCount; i++) {
    let dollarLost = 0;

    if (method === 'PERCENT_RUNNING_EQUITY') {
      const riskFraction = (riskPercentOrNominal || 1.0) / 100;
      dollarLost = runningCapital * riskFraction;
      runningCapital = Math.max(0, runningCapital - dollarLost);
    } else {
      // Fixed nominal dollar risk per trade
      dollarLost = riskPercentOrNominal;
      runningCapital = Math.max(0, runningCapital - dollarLost);
    }

    const cumulativeDrawdownPercent =
      capitalBase > 0 ? ((capitalBase - runningCapital) / capitalBase) * 100 : 100;

    steps.push({
      lossNumber: i,
      remainingEquity: Number(runningCapital.toFixed(2)),
      dollarLost: Number(dollarLost.toFixed(2)),
      cumulativeDrawdownPercent: Number(cumulativeDrawdownPercent.toFixed(2)),
      isAccountBlown: runningCapital <= 0,
    });
  }

  return steps;
}

/**
 * Evaluate trading discipline & risk compliance based on actual Trade Log records
 */
export function evaluateTradingDiscipline(
  trades: Trade[],
  settings: AppSettings
): DisciplineEvaluationResult {
  if (!trades || trades.length < 3) {
    const count = trades?.length || 0;
    return {
      hasSufficientData: false,
      totalTradesEvaluated: count,
      lossTradesEvaluated: 0,
      tradesWithIncompleteData: 0,
      overRiskTradesCount: 0,
      excessiveRiskTradesCount: 0,
      dailyLossViolationsCount: 0,
      maxConsecutiveLossesEncountered: 0,
      consecutiveLossBreachesCount: 0,
      riskPerTradeCompliantCount: count,
      stopLossCompliantCount: count,
      tradingPlanCompliantCount: count,
      dailyLimitCompliantCount: count,
      dailyLimitTotalDays: 0,
      dailyLimitCompliantDays: 0,
      totalViolationsCount: 0,
      disciplineScore: 100,
      disciplineGrade: 'A',
      auditFindings: [
        {
          type: 'WARNING',
          title: 'Data Belum Cukup',
          description:
            'Diperlukan minimal 3 transaksi tercatat pada Trade Log untuk melakukan audit kepatuhan risiko secara obyektif.',
        },
      ],
    };
  }

  let lossTradesEvaluated = 0;
  let tradesWithIncompleteData = 0;
  let overRiskTradesCount = 0;
  let excessiveRiskTradesCount = 0;
  let riskPerTradeCompliantCount = 0;
  let stopLossCompliantCount = 0;
  let tradingPlanCompliantCount = 0;

  const maxAllowedRiskPercent = settings.maxTradeRiskPercent || 2.0;
  const maxAllowedRiskAmount = settings.maxTradeRiskAmount || 200;

  // Track streaks
  let currentStreak = 0;
  let maxStreak = 0;
  let consecutiveLossBreachesCount = 0;
  const limitConsecutive = settings.maxConsecutiveLossLimit || 3;

  trades.forEach((t) => {
    const net = computeTradeNetProfit(t);
    const isLoss = t.outcome === 'LOSS' || net < -0.01;

    // Check risk plan presence
    const hasRiskAmount = t.riskAmount !== undefined && t.riskAmount > 0;
    const hasSL = t.stopLoss !== undefined && t.stopLoss > 0;
    const hasStrategy = Boolean(t.strategy && t.strategy.trim().length > 0);

    if (hasSL) {
      stopLossCompliantCount++;
    }
    if (!hasRiskAmount && !hasSL) {
      tradesWithIncompleteData++;
    }

    // Check if initial planned risk was excessive
    let isTradeExcessive = false;
    if (t.riskPercentage && t.riskPercentage > maxAllowedRiskPercent) {
      excessiveRiskTradesCount++;
      isTradeExcessive = true;
    } else if (hasRiskAmount && t.riskAmount! > maxAllowedRiskAmount) {
      excessiveRiskTradesCount++;
      isTradeExcessive = true;
    }

    let isTradeOverRisk = false;
    if (isLoss) {
      lossTradesEvaluated++;
      const actualLoss = Math.abs(net);

      // Slippage tolerance: 5%
      if (hasRiskAmount && actualLoss > t.riskAmount! * 1.05) {
        overRiskTradesCount++;
        isTradeOverRisk = true;
      }

      currentStreak++;
      if (currentStreak > maxStreak) {
        maxStreak = currentStreak;
      }
      if (currentStreak === limitConsecutive) {
        consecutiveLossBreachesCount++;
      }
    } else {
      currentStreak = 0;
    }

    if (!isTradeExcessive && !isTradeOverRisk) {
      riskPerTradeCompliantCount++;
    }
    if (hasStrategy && (hasSL || hasRiskAmount) && !isTradeOverRisk) {
      tradingPlanCompliantCount++;
    }
  });

  // Daily Loss Violations check
  const dailyMap: { [date: string]: number } = {};
  trades.forEach((t) => {
    const d = (t.dateTime || '').slice(0, 10);
    if (!d) return;
    dailyMap[d] = (dailyMap[d] || 0) + computeTradeNetProfit(t);
  });

  let dailyLossViolationsCount = 0;
  const violatedDaysSet = new Set<string>();
  const allDays = Object.keys(dailyMap);
  allDays.forEach((d) => {
    const dayNet = dailyMap[d];
    if (dayNet < 0) {
      const dayLoss = Math.abs(dayNet);
      if (
        dayLoss >= settings.maxDailyLossAmount ||
        (settings.startingBalance > 0 &&
          (dayLoss / settings.startingBalance) * 100 >= settings.maxDailyLossPercent)
      ) {
        dailyLossViolationsCount++;
        violatedDaysSet.add(d);
      }
    }
  });

  const dailyLimitCompliantCount = trades.filter((t) => {
    const d = (t.dateTime || '').slice(0, 10);
    return !d || !violatedDaysSet.has(d);
  }).length;
  const dailyLimitTotalDays = allDays.length;
  const dailyLimitCompliantDays = Math.max(0, dailyLimitTotalDays - dailyLossViolationsCount);
  const totalViolationsCount =
    overRiskTradesCount +
    excessiveRiskTradesCount +
    dailyLossViolationsCount +
    tradesWithIncompleteData;

  // Calculate Discipline Score (0 to 100)
  let score = 100;
  // Deduct for over-risk on loss trades
  if (lossTradesEvaluated > 0) {
    const overRiskRatio = overRiskTradesCount / lossTradesEvaluated;
    score -= overRiskRatio * 35;
  }
  // Deduct for daily loss breaches
  score -= dailyLossViolationsCount * 15;
  // Deduct for excessive risk trades
  score -= (excessiveRiskTradesCount / trades.length) * 20;
  // Deduct for incomplete risk data
  score -= (tradesWithIncompleteData / trades.length) * 15;

  score = Math.max(0, Math.min(100, Math.round(score)));

  let disciplineGrade: 'A' | 'B' | 'C' | 'D' | 'F' = 'A';
  if (score >= 90) disciplineGrade = 'A';
  else if (score >= 80) disciplineGrade = 'B';
  else if (score >= 70) disciplineGrade = 'C';
  else if (score >= 60) disciplineGrade = 'D';
  else disciplineGrade = 'F';

  const auditFindings: {
    type: 'VIOLATION' | 'WARNING' | 'COMPLIANT';
    title: string;
    description: string;
  }[] = [];

  if (overRiskTradesCount > 0) {
    auditFindings.push({
      type: 'VIOLATION',
      title: `${overRiskTradesCount} Transaksi Rugi Melampaui Rencana Risiko`,
      description: `Terdapat transaksi rugi dengan kerugian riil lebih besar dari Stop Loss yang direncanakan (toleransi slippage 5%). Waspadai pelebaran SL manual atau averaging down.`,
    });
  }

  if (dailyLossViolationsCount > 0) {
    auditFindings.push({
      type: 'VIOLATION',
      title: `${dailyLossViolationsCount} Kali Melanggar Batas Kerugian Harian`,
      description: `Tercatat hari trading di mana akumulasi rugi harian melampaui ${settings.maxDailyLossPercent}% (${settings.currencySymbol}${settings.maxDailyLossAmount}).`,
    });
  }

  if (excessiveRiskTradesCount > 0) {
    auditFindings.push({
      type: 'WARNING',
      title: `${excessiveRiskTradesCount} Posisi Mengambil Risiko Terlalu Besar`,
      description: `Posisi dipasang dengan rencana risiko di atas batas aman ${maxAllowedRiskPercent}% per trade.`,
    });
  }

  if (tradesWithIncompleteData > 0) {
    auditFindings.push({
      type: 'WARNING',
      title: `${tradesWithIncompleteData} Transaksi Tanpa Catatan Stop Loss Lengkap`,
      description: `Beberapa transaksi tidak mencatat level Stop Loss atau nominal risiko awal, sehingga evaluasi eksekusi menggunakan estimasi.`,
    });
  }

  if (auditFindings.length === 0) {
    auditFindings.push({
      type: 'COMPLIANT',
      title: 'Disiplin Eksekusi Sangat Baik',
      description:
        'Seluruh transaksi mematuhi rencana Stop Loss, batas risiko per posisi, dan tidak ada pelanggaran batas kerugian harian.',
    });
  }

  return {
    hasSufficientData: true,
    totalTradesEvaluated: trades.length,
    lossTradesEvaluated,
    tradesWithIncompleteData,
    overRiskTradesCount,
    excessiveRiskTradesCount,
    dailyLossViolationsCount,
    maxConsecutiveLossesEncountered: maxStreak,
    consecutiveLossBreachesCount,
    riskPerTradeCompliantCount,
    stopLossCompliantCount,
    tradingPlanCompliantCount,
    dailyLimitCompliantCount,
    dailyLimitTotalDays,
    dailyLimitCompliantDays,
    totalViolationsCount,
    disciplineScore: score,
    disciplineGrade,
    auditFindings,
  };
}

// ============================================================================
// MT5 SYMBOL SPECIFICATION REGISTRY & LOT-BASED PIP VALUE ENGINE (TVES / MT5)
// ============================================================================

export type Mt5ProfitCalcMode = 'CFD_GOLD' | 'FOREX' | 'CFD_INDEX' | 'CRYPTO';

export interface Mt5SymbolSpec {
  symbol: string;
  description: string;
  contractSize: number;
  digits: number;
  point: number;
  tickSize: number;
  tickValue: number; // USD value per tick for 1.00 standard lot
  pipSize: number; // Price distance equal to 1 pip
  pipValuePer001Lot: number; // USD value per 1 pip for 0.01 lot
  pipValuePerStandardLot: number; // USD value per 1 pip for 1.00 lot
  minLot: number;
  maxLot: number;
  lotStep: number;
  profitCalcMode: Mt5ProfitCalcMode;
}

export const MT5_SYMBOL_REGISTRY: Record<string, Mt5SymbolSpec> = {
  XAUUSD: {
    symbol: 'XAUUSD',
    description: 'Gold vs US Dollar (Standar Lot × Pip = $0.10 / pip per 0.01 lot)',
    contractSize: 100,
    digits: 2,
    point: 0.01,
    tickSize: 0.01,
    tickValue: 1.0,
    pipSize: 0.1, // Baseline: 4000 -> 3995 = 50 pips ($25 untuk 0.05 lot); dapat diubah ke 1.00 di Settings
    pipValuePer001Lot: 0.1, // 0.01 lot × 1 pip = $0.10 (10 pips = $1.00, 50 pips = $5.00)
    pipValuePerStandardLot: 10.0, // 1.00 lot × 1 pip = $10.00 (50 pips = $500.00)
    minLot: 0.01,
    maxLot: 100.0,
    lotStep: 0.01,
    profitCalcMode: 'CFD_GOLD',
  },
  EURUSD: {
    symbol: 'EURUSD',
    description: 'Euro vs US Dollar (Standar Forex 100,000 unit)',
    contractSize: 100000,
    digits: 5,
    point: 0.00001,
    tickSize: 0.00001,
    tickValue: 1.0,
    pipSize: 0.0001,
    pipValuePer001Lot: 0.1,
    pipValuePerStandardLot: 10.0,
    minLot: 0.01,
    maxLot: 100.0,
    lotStep: 0.01,
    profitCalcMode: 'FOREX',
  },
  GBPUSD: {
    symbol: 'GBPUSD',
    description: 'Great Britain Pound vs US Dollar (Standar Forex 100,000 unit)',
    contractSize: 100000,
    digits: 5,
    point: 0.00001,
    tickSize: 0.00001,
    tickValue: 1.0,
    pipSize: 0.0001,
    pipValuePer001Lot: 0.1,
    pipValuePerStandardLot: 10.0,
    minLot: 0.01,
    maxLot: 100.0,
    lotStep: 0.01,
    profitCalcMode: 'FOREX',
  },
  AUDUSD: {
    symbol: 'AUDUSD',
    description: 'Australian Dollar vs US Dollar (Standar Forex 100,000 unit)',
    contractSize: 100000,
    digits: 5,
    point: 0.00001,
    tickSize: 0.00001,
    tickValue: 1.0,
    pipSize: 0.0001,
    pipValuePer001Lot: 0.1,
    pipValuePerStandardLot: 10.0,
    minLot: 0.01,
    maxLot: 100.0,
    lotStep: 0.01,
    profitCalcMode: 'FOREX',
  },
  NZDUSD: {
    symbol: 'NZDUSD',
    description: 'New Zealand Dollar vs US Dollar (Standar Forex 100,000 unit)',
    contractSize: 100000,
    digits: 5,
    point: 0.00001,
    tickSize: 0.00001,
    tickValue: 1.0,
    pipSize: 0.0001,
    pipValuePer001Lot: 0.1,
    pipValuePerStandardLot: 10.0,
    minLot: 0.01,
    maxLot: 100.0,
    lotStep: 0.01,
    profitCalcMode: 'FOREX',
  },
  USDJPY: {
    symbol: 'USDJPY',
    description: 'US Dollar vs Japanese Yen (3 Digits, 1 pip = 0.01)',
    contractSize: 100000,
    digits: 3,
    point: 0.001,
    tickSize: 0.001,
    tickValue: 1.0,
    pipSize: 0.01,
    pipValuePer001Lot: 0.1,
    pipValuePerStandardLot: 10.0,
    minLot: 0.01,
    maxLot: 100.0,
    lotStep: 0.01,
    profitCalcMode: 'FOREX',
  },
  USDCAD: {
    symbol: 'USDCAD',
    description: 'US Dollar vs Canadian Dollar (5 Digits, 1 pip = 0.0001)',
    contractSize: 100000,
    digits: 5,
    point: 0.00001,
    tickSize: 0.00001,
    tickValue: 1.0,
    pipSize: 0.0001,
    pipValuePer001Lot: 0.1,
    pipValuePerStandardLot: 10.0,
    minLot: 0.01,
    maxLot: 100.0,
    lotStep: 0.01,
    profitCalcMode: 'FOREX',
  },
  USDCHF: {
    symbol: 'USDCHF',
    description: 'US Dollar vs Swiss Franc (5 Digits, 1 pip = 0.0001)',
    contractSize: 100000,
    digits: 5,
    point: 0.00001,
    tickSize: 0.00001,
    tickValue: 1.0,
    pipSize: 0.0001,
    pipValuePer001Lot: 0.1,
    pipValuePerStandardLot: 10.0,
    minLot: 0.01,
    maxLot: 100.0,
    lotStep: 0.01,
    profitCalcMode: 'FOREX',
  },
  BTCUSD: {
    symbol: 'BTCUSD',
    description: 'Bitcoin vs US Dollar (1 Kontrak = 1 BTC, 1 pip = $1.00)',
    contractSize: 1,
    digits: 2,
    point: 0.01,
    tickSize: 0.01,
    tickValue: 0.01,
    pipSize: 1.0,
    pipValuePer001Lot: 0.01,
    pipValuePerStandardLot: 1.0,
    minLot: 0.01,
    maxLot: 50.0,
    lotStep: 0.01,
    profitCalcMode: 'CRYPTO',
  },
  US30: {
    symbol: 'US30',
    description: 'Dow Jones Industrial Average Index CFD',
    contractSize: 10,
    digits: 2,
    point: 0.01,
    tickSize: 0.01,
    tickValue: 0.1,
    pipSize: 1.0,
    pipValuePer001Lot: 0.1,
    pipValuePerStandardLot: 10.0,
    minLot: 0.01,
    maxLot: 100.0,
    lotStep: 0.01,
    profitCalcMode: 'CFD_INDEX',
  },
  NAS100: {
    symbol: 'NAS100',
    description: 'Nasdaq 100 Index CFD',
    contractSize: 10,
    digits: 2,
    point: 0.01,
    tickSize: 0.01,
    tickValue: 0.1,
    pipSize: 1.0,
    pipValuePer001Lot: 0.1,
    pipValuePerStandardLot: 10.0,
    minLot: 0.01,
    maxLot: 100.0,
    lotStep: 0.01,
    profitCalcMode: 'CFD_INDEX',
  },
};

/**
 * Resolves the authoritative MT5 Symbol Specification for a given symbol, applying user settings
 * for XAUUSD (`xauusdPipSize`, `xauusdPipValuePer001Lot`, `xauusdContractSize`, `xauusdMinLot`, `xauusdLotStep`)
 * or custom MT5 symbol spec overrides.
 */
export function getInstrumentPipSpec(
  symbolRaw?: string,
  settings?: Partial<AppSettings>,
  customOverride?: Partial<Mt5SymbolSpec>
): Mt5SymbolSpec {
  const cleanSymbol = (symbolRaw || 'XAUUSD').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  let baseKey = 'XAUUSD';
  if (MT5_SYMBOL_REGISTRY[cleanSymbol]) {
    baseKey = cleanSymbol;
  } else if (cleanSymbol.startsWith('XAUUSD') || cleanSymbol.includes('GOLD')) {
    baseKey = 'XAUUSD';
  } else {
    for (const key of Object.keys(MT5_SYMBOL_REGISTRY)) {
      if (cleanSymbol.startsWith(key)) {
        baseKey = key;
        break;
      }
    }
  }

  const baseSpec = { ...MT5_SYMBOL_REGISTRY[baseKey], symbol: baseKey };

  if (baseKey === 'XAUUSD' && settings) {
    if (
      typeof settings.xauusdPipSize === 'number' &&
      Number.isFinite(settings.xauusdPipSize) &&
      settings.xauusdPipSize > 0
    ) {
      baseSpec.pipSize = settings.xauusdPipSize;
    }
    if (
      typeof settings.xauusdContractSize === 'number' &&
      Number.isFinite(settings.xauusdContractSize) &&
      settings.xauusdContractSize > 0
    ) {
      baseSpec.contractSize = settings.xauusdContractSize;
    }
    const basePipVal001 =
      typeof settings.xauusdPipValuePer001Lot === 'number' &&
      Number.isFinite(settings.xauusdPipValuePer001Lot) &&
      settings.xauusdPipValuePer001Lot > 0
        ? settings.xauusdPipValuePer001Lot
        : 0.1;
    baseSpec.pipValuePerStandardLot = Number((basePipVal001 * baseSpec.contractSize).toFixed(4));
    baseSpec.pipValuePer001Lot = Number((baseSpec.pipValuePerStandardLot / 100).toFixed(4));
    if (
      typeof settings.xauusdMinLot === 'number' &&
      Number.isFinite(settings.xauusdMinLot) &&
      settings.xauusdMinLot > 0
    ) {
      baseSpec.minLot = settings.xauusdMinLot;
    }
    if (
      typeof settings.xauusdLotStep === 'number' &&
      Number.isFinite(settings.xauusdLotStep) &&
      settings.xauusdLotStep > 0
    ) {
      baseSpec.lotStep = settings.xauusdLotStep;
    }
  }

  if (customOverride) {
    Object.assign(baseSpec, customOverride);
    if (customOverride.pipValuePer001Lot && !customOverride.pipValuePerStandardLot) {
      baseSpec.pipValuePerStandardLot = Number((customOverride.pipValuePer001Lot * 100).toFixed(4));
    } else if (customOverride.pipValuePerStandardLot && !customOverride.pipValuePer001Lot) {
      baseSpec.pipValuePer001Lot = Number((customOverride.pipValuePerStandardLot / 100).toFixed(4));
    }
  }

  return baseSpec;
}

export type RiskCapitalBasis = 'EQUITY' | 'BALANCE';

export interface SlTpValidationResult {
  isValid: boolean;
  slValid: boolean;
  tpValid: boolean;
  slError?: string;
  tpError?: string;
  errorMessage?: string;
}

/**
 * Strictly validates Stop Loss and Take Profit direction against Entry Price for BUY and SELL:
 * - BUY:  SL < Entry, TP > Entry
 * - SELL: SL > Entry, TP < Entry
 * Empty / 0 SL or TP is treated as "not set" (valid optional state, not a directional violation).
 */
export function validateSlTpDirection(
  position: 'BUY' | 'SELL',
  entryPrice: number,
  stopLossPrice?: number | null,
  takeProfitPrice?: number | null
): SlTpValidationResult {
  let slValid = true;
  let tpValid = true;
  let slError: string | undefined;
  let tpError: string | undefined;

  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    const msg = 'Harga Entry wajib berupa angka positif (> 0).';
    return {
      isValid: false,
      slValid: false,
      tpValid: false,
      slError: msg,
      errorMessage: msg,
    };
  }

  const hasSL = stopLossPrice !== undefined && stopLossPrice !== null && stopLossPrice !== 0;
  if (hasSL) {
    if (!Number.isFinite(stopLossPrice!) || stopLossPrice! < 0) {
      slValid = false;
      slError = 'Harga Stop Loss harus berupa angka positif yang valid.';
    } else if (position === 'BUY' && stopLossPrice! >= entryPrice) {
      slValid = false;
      slError = 'Stop Loss untuk posisi BUY wajib berada di bawah harga Entry (SL < Entry).';
    } else if (position === 'SELL' && stopLossPrice! <= entryPrice) {
      slValid = false;
      slError = 'Stop Loss untuk posisi SELL wajib berada di atas harga Entry (SL > Entry).';
    }
  }

  const hasTP = takeProfitPrice !== undefined && takeProfitPrice !== null && takeProfitPrice !== 0;
  if (hasTP) {
    if (!Number.isFinite(takeProfitPrice!) || takeProfitPrice! < 0) {
      tpValid = false;
      tpError = 'Harga Take Profit harus berupa angka positif yang valid.';
    } else if (position === 'BUY' && takeProfitPrice! <= entryPrice) {
      tpValid = false;
      tpError = 'Take Profit untuk posisi BUY wajib berada di atas harga Entry (TP > Entry).';
    } else if (position === 'SELL' && takeProfitPrice! >= entryPrice) {
      tpValid = false;
      tpError = 'Take Profit untuk posisi SELL wajib berada di bawah harga Entry (TP < Entry).';
    }
  }

  return {
    isValid: slValid && tpValid,
    slValid,
    tpValid,
    slError,
    tpError,
    errorMessage: slError || tpError,
  };
}

export interface LotBasedOrderInput {
  symbol?: string;
  position: 'BUY' | 'SELL';
  lotSize: number;
  entryPrice?: number;
  stopLossPrice?: number | null;
  takeProfitPrice?: number | null;
  exitPrice?: number | null;
  // Optional direct pip distance inputs (for pip-based calculation or tests 1..4)
  slDistancePipsInput?: number | null;
  tpDistancePipsInput?: number | null;
  // Optional Target RR helper (ONLY applied if > 0 and SL distance is valid)
  targetRR?: number | null;
  // Capital Basis for Risk % calculation
  capitalBasis?: number;
  capitalBasisAmount?: number;
  capitalBasisType?: RiskCapitalBasis;
  // Optional cost & realized P/L inputs
  commission?: number;
  swap?: number;
  actualGrossProfit?: number | null;
  // Optional symbol specification override
  customSpecOverride?: Partial<Mt5SymbolSpec>;
}

export interface LotBasedOrderResult {
  isValid: boolean;
  isSlValid: boolean;
  isTpValid: boolean;
  errorMessage?: string;
  lotError?: string;
  entryError?: string;
  slError?: string;
  tpError?: string;
  slErrorMessage?: string;
  tpErrorMessage?: string;
  symbol: string;
  spec: Mt5SymbolSpec;
  pipSize: number;
  position: 'BUY' | 'SELL';
  lotSize: number;
  pipValuePer001Lot: number;
  pipValuePerStandardLot: number;
  pipValueForLot: number; // Nilai per pip ($) = (Lot / 0.01) × pipValuePer001Lot
  pipValueUsd: number; // Alias of pipValueForLot for UI & test callers
  slDistancePrice: number | null;
  slDistancePips: number | null;
  tpDistancePrice: number | null;
  tpDistancePips: number | null;
  computedStopLossPrice: number | null;
  computedTakeProfitPrice: number | null;
  riskAmount: number | null; // Nilai risiko ($) = Nilai per pip × Jarak SL (pips)
  potentialProfit: number | null; // Potensi profit ($) = Nilai per pip × Jarak TP (pips)
  riskPercentage: number | null; // Risk % = (Risk Amount / Capital Basis) × 100%
  riskPercent: number | null; // Alias of riskPercentage
  capitalBasisType: RiskCapitalBasis;
  capitalBasisAmount: number;
  plannedRR: number | null; // TP Distance (pips) / SL Distance (pips)
  plannedRRFormatted: string; // "1 : 2" or "Tidak tersedia"
  estimatedExitGrossProfit: number | null;
  realizedGrossProfit: number | null;
  realizedNetProfit: number | null;
  realizedRMultiple: number | null;
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN' | null;
}

/**
 * Format a numeric Risk-to-Reward ratio cleanly (e.g., 2 -> "1 : 2", 2.5 -> "1 : 2.5", null -> "Tidak tersedia").
 */
export function formatDynamicRR(rr: number | null | undefined): string {
  if (rr === null || rr === undefined || !Number.isFinite(rr) || rr <= 0) {
    return 'Tidak tersedia';
  }
  const rounded = Number(rr.toFixed(2));
  const str = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  return `1 : ${str}`;
}

/**
 * Core Authoritative Engine: LOT × JARAK PIP = NILAI UANG
 * Calculates Pip Value, SL Distance (pips), TP Distance (pips), Risk Amount ($),
 * Potential Profit ($), Risk Percentage (%), Planned RR, and Realized P/L + R-Multiple.
 */
export function calculateLotBasedOrderMetrics(
  input: LotBasedOrderInput,
  settings: Partial<AppSettings> = DEFAULT_SETTINGS
): LotBasedOrderResult {
  const spec = getInstrumentPipSpec(input.symbol, settings, input.customSpecOverride);
  const position: 'BUY' | 'SELL' = input.position === 'SELL' ? 'SELL' : 'BUY';
  const capitalBasisType: RiskCapitalBasis =
    input.capitalBasisType || settings.riskCapitalBasis || 'EQUITY';
  const resolvedBasisInput =
    input.capitalBasisAmount !== undefined && Number.isFinite(input.capitalBasisAmount)
      ? input.capitalBasisAmount
      : input.capitalBasis !== undefined && Number.isFinite(input.capitalBasis)
      ? input.capitalBasis
      : undefined;
  const capitalBasisAmount =
    resolvedBasisInput !== undefined ? resolvedBasisInput : settings.startingBalance ?? 10000;

  const rawLot = Number(input.lotSize);
  const isLotValid = Number.isFinite(rawLot) && !isNaN(rawLot) && rawLot > 0;
  const lotError = !isLotValid
    ? 'Ukuran Lot wajib berupa angka positif (> 0), minimal 0.01 lot.'
    : undefined;

  // Validate Entry Price if provided or if price-based SL/TP is used
  const hasEntryInput = input.entryPrice !== undefined && input.entryPrice !== null;
  const rawEntry = hasEntryInput ? Number(input.entryPrice) : undefined;
  const hasDirectSlPips =
    input.slDistancePipsInput !== undefined &&
    input.slDistancePipsInput !== null &&
    Number(input.slDistancePipsInput) > 0;
  const hasDirectTpPips =
    input.tpDistancePipsInput !== undefined &&
    input.tpDistancePipsInput !== null &&
    Number(input.tpDistancePipsInput) > 0;

  let entryError: string | undefined;
  if (hasEntryInput) {
    if (!Number.isFinite(rawEntry!) || isNaN(rawEntry!) || rawEntry! <= 0) {
      entryError = 'Harga Entry wajib berupa angka positif (> 0).';
    }
  } else if (!hasDirectSlPips && !hasDirectTpPips) {
    entryError = 'Harga Entry wajib diisi (> 0).';
  }

  // Pip Value calculation using exact scaled BigInt (10^8) to avoid floating-point noise:
  // Nilai per pip = (Lot / 0.01) × pipValuePer001Lot = Lot × pipValuePerStandardLot
  let pipValueForLot = 0;
  if (isLotValid) {
    const lotScaled = parseDecimalToScaledBigInt(rawLot, 'NEAREST');
    const pipStdScaled = parseDecimalToScaledBigInt(spec.pipValuePerStandardLot, 'NEAREST');
    const valScaled = (lotScaled * pipStdScaled + BIGINT_SCALE_8 / 2n) / BIGINT_SCALE_8;
    pipValueForLot = scaledBigIntToNumber(valScaled, 4);
  }

  let slError: string | undefined;
  let tpError: string | undefined;
  let slDistancePrice: number | null = null;
  let slDistancePips: number | null = null;
  let tpDistancePrice: number | null = null;
  let tpDistancePips: number | null = null;
  let computedStopLossPrice: number | null = null;
  let computedTakeProfitPrice: number | null = null;

  // 1. Resolve Stop Loss Distance (Pips & Price)
  const hasSlPriceInput =
    input.stopLossPrice !== undefined &&
    input.stopLossPrice !== null &&
    input.stopLossPrice !== 0;

  if (hasDirectSlPips) {
    const rawSlPips = Number(input.slDistancePipsInput);
    if (!Number.isFinite(rawSlPips) || rawSlPips <= 0) {
      slError = 'Jarak Stop Loss (pips) harus berupa angka positif (> 0).';
    } else {
      slDistancePips = Number(rawSlPips.toFixed(2));
      slDistancePrice = Number((slDistancePips * spec.pipSize).toFixed(spec.digits));
      if (rawEntry && rawEntry > 0 && !entryError) {
        computedStopLossPrice = Number(
          (position === 'BUY' ? rawEntry - slDistancePrice : rawEntry + slDistancePrice).toFixed(
            spec.digits
          )
        );
      }
    }
  } else if (hasSlPriceInput) {
    const rawSlPrice = Number(input.stopLossPrice);
    if (!Number.isFinite(rawSlPrice) || isNaN(rawSlPrice) || rawSlPrice <= 0) {
      slError = 'Harga Stop Loss harus berupa angka positif (> 0).';
    } else if (rawEntry && rawEntry > 0 && !entryError) {
      const dirCheck = validateSlTpDirection(position, rawEntry, rawSlPrice, undefined);
      if (!dirCheck.slValid) {
        slError = dirCheck.slError;
      } else {
        computedStopLossPrice = rawSlPrice;
        const entryScaled = parseDecimalToScaledBigInt(rawEntry, 'NEAREST');
        const slScaled = parseDecimalToScaledBigInt(rawSlPrice, 'NEAREST');
        const diffScaled = entryScaled > slScaled ? entryScaled - slScaled : slScaled - entryScaled;
        slDistancePrice = scaledBigIntToNumber(diffScaled, spec.digits);

        const pipSizeScaled = parseDecimalToScaledBigInt(spec.pipSize, 'NEAREST');
        const pipsScaled = (diffScaled * BIGINT_SCALE_8 + pipSizeScaled / 2n) / pipSizeScaled;
        slDistancePips = scaledBigIntToNumber(pipsScaled, 2);
      }
    }
  }

  // 2. Resolve Take Profit Distance (Pips & Price) — via Optional Target RR or Direct TP Pips or Manual TP Price
  const hasTargetRR =
    input.targetRR !== undefined &&
    input.targetRR !== null &&
    Number.isFinite(Number(input.targetRR)) &&
    Number(input.targetRR) > 0;
  const hasTpPriceInput =
    input.takeProfitPrice !== undefined &&
    input.takeProfitPrice !== null &&
    input.takeProfitPrice !== 0;

  if (hasTargetRR && slDistancePips !== null && slDistancePips > 0) {
    const rrVal = Number(input.targetRR);
    tpDistancePips = Number((slDistancePips * rrVal).toFixed(2));
    tpDistancePrice = Number((tpDistancePips * spec.pipSize).toFixed(spec.digits));
    if (rawEntry && rawEntry > 0 && !entryError) {
      computedTakeProfitPrice = Number(
        (position === 'BUY' ? rawEntry + tpDistancePrice : rawEntry - tpDistancePrice).toFixed(
          spec.digits
        )
      );
    }
  } else if (hasDirectTpPips) {
    const rawTpPips = Number(input.tpDistancePipsInput);
    if (!Number.isFinite(rawTpPips) || rawTpPips <= 0) {
      tpError = 'Jarak Take Profit (pips) harus berupa angka positif (> 0).';
    } else {
      tpDistancePips = Number(rawTpPips.toFixed(2));
      tpDistancePrice = Number((tpDistancePips * spec.pipSize).toFixed(spec.digits));
      if (rawEntry && rawEntry > 0 && !entryError) {
        computedTakeProfitPrice = Number(
          (position === 'BUY' ? rawEntry + tpDistancePrice : rawEntry - tpDistancePrice).toFixed(
            spec.digits
          )
        );
      }
    }
  } else if (hasTpPriceInput) {
    const rawTpPrice = Number(input.takeProfitPrice);
    if (!Number.isFinite(rawTpPrice) || isNaN(rawTpPrice) || rawTpPrice <= 0) {
      tpError = 'Harga Take Profit harus berupa angka positif (> 0).';
    } else if (rawEntry && rawEntry > 0 && !entryError) {
      const dirCheck = validateSlTpDirection(position, rawEntry, undefined, rawTpPrice);
      if (!dirCheck.tpValid) {
        tpError = dirCheck.tpError;
      } else {
        computedTakeProfitPrice = rawTpPrice;
        const entryScaled = parseDecimalToScaledBigInt(rawEntry, 'NEAREST');
        const tpScaled = parseDecimalToScaledBigInt(rawTpPrice, 'NEAREST');
        const diffScaled = tpScaled > entryScaled ? tpScaled - entryScaled : entryScaled - tpScaled;
        tpDistancePrice = scaledBigIntToNumber(diffScaled, spec.digits);

        const pipSizeScaled = parseDecimalToScaledBigInt(spec.pipSize, 'NEAREST');
        const pipsScaled = (diffScaled * BIGINT_SCALE_8 + pipSizeScaled / 2n) / pipSizeScaled;
        tpDistancePips = scaledBigIntToNumber(pipsScaled, 2);
      }
    }
  }

  const isSlValid = !slError;
  const isTpValid = !tpError;
  const isValid = !lotError && !entryError && isSlValid && isTpValid;
  const errorMessage = lotError || entryError || slError || tpError;

  // 3. Calculate Risk Amount ($), Potential Profit ($), Risk Percentage (%), and Planned RR
  let riskAmount: number | null = null;
  let potentialProfit: number | null = null;
  let riskPercentage: number | null = null;
  let plannedRR: number | null = null;

  if (isLotValid && !slError && slDistancePips !== null && slDistancePips > 0) {
    const pipValScaled = parseDecimalToScaledBigInt(pipValueForLot, 'NEAREST');
    const slPipsScaled = parseDecimalToScaledBigInt(slDistancePips, 'NEAREST');
    const riskScaled = (pipValScaled * slPipsScaled + BIGINT_SCALE_8 / 2n) / BIGINT_SCALE_8;
    riskAmount = scaledBigIntToNumber(riskScaled, 2);

    if (capitalBasisAmount > 0 && Number.isFinite(capitalBasisAmount)) {
      riskPercentage = Number(((riskAmount / capitalBasisAmount) * 100).toFixed(2));
    }
  }

  if (isLotValid && !tpError && tpDistancePips !== null && tpDistancePips > 0) {
    const pipValScaled = parseDecimalToScaledBigInt(pipValueForLot, 'NEAREST');
    const tpPipsScaled = parseDecimalToScaledBigInt(tpDistancePips, 'NEAREST');
    const profitScaled = (pipValScaled * tpPipsScaled + BIGINT_SCALE_8 / 2n) / BIGINT_SCALE_8;
    potentialProfit = scaledBigIntToNumber(profitScaled, 2);
  }

  if (
    !slError &&
    !tpError &&
    slDistancePips !== null &&
    slDistancePips > 0 &&
    tpDistancePips !== null &&
    tpDistancePips > 0
  ) {
    plannedRR = Number((tpDistancePips / slDistancePips).toFixed(2));
  }

  // 4. Optional Exit Price / Realized P/L & Realized R-Multiple
  let estimatedExitGrossProfit: number | null = null;
  if (
    isLotValid &&
    !entryError &&
    rawEntry &&
    rawEntry > 0 &&
    input.exitPrice !== undefined &&
    input.exitPrice !== null &&
    Number(input.exitPrice) > 0
  ) {
    const rawExit = Number(input.exitPrice);
    if (Number.isFinite(rawExit) && rawExit > 0) {
      const signedPriceDiff = position === 'BUY' ? rawExit - rawEntry : rawEntry - rawExit;
      const signedPips = signedPriceDiff / spec.pipSize;
      estimatedExitGrossProfit = Number((signedPips * pipValueForLot).toFixed(2));
    }
  }

  let realizedGrossProfit: number | null = null;
  if (
    input.actualGrossProfit !== undefined &&
    input.actualGrossProfit !== null &&
    Number.isFinite(Number(input.actualGrossProfit))
  ) {
    realizedGrossProfit = Number(Number(input.actualGrossProfit).toFixed(2));
  } else if (estimatedExitGrossProfit !== null) {
    realizedGrossProfit = estimatedExitGrossProfit;
  }

  let realizedNetProfit: number | null = null;
  let realizedRMultiple: number | null = null;
  let outcome: 'WIN' | 'LOSS' | 'BREAKEVEN' | null = null;

  if (realizedGrossProfit !== null) {
    const comm = Math.abs(Number(input.commission) || 0);
    const swp = Number(input.swap) || 0;
    realizedNetProfit = computeTradeNetProfit({
      grossProfit: realizedGrossProfit,
      commission: comm,
      swap: swp,
    });
    if (realizedNetProfit > 0) outcome = 'WIN';
    else if (realizedNetProfit < 0) outcome = 'LOSS';
    else outcome = 'BREAKEVEN';

    if (riskAmount !== null && riskAmount > 0) {
      realizedRMultiple = Number((realizedNetProfit / riskAmount).toFixed(2));
    }
  }

  return {
    isValid,
    isSlValid,
    isTpValid,
    errorMessage,
    lotError,
    entryError,
    slError,
    tpError,
    slErrorMessage: slError,
    tpErrorMessage: tpError,
    symbol: spec.symbol,
    spec,
    pipSize: spec.pipSize,
    position,
    lotSize: isLotValid ? rawLot : 0,
    pipValuePer001Lot: spec.pipValuePer001Lot,
    pipValuePerStandardLot: spec.pipValuePerStandardLot,
    pipValueForLot,
    pipValueUsd: pipValueForLot,
    slDistancePrice,
    slDistancePips,
    tpDistancePrice,
    tpDistancePips,
    computedStopLossPrice,
    computedTakeProfitPrice,
    riskAmount,
    potentialProfit,
    riskPercentage,
    riskPercent: riskPercentage,
    capitalBasisType,
    capitalBasisAmount,
    plannedRR,
    plannedRRFormatted: formatDynamicRR(plannedRR),
    estimatedExitGrossProfit,
    realizedGrossProfit,
    realizedNetProfit,
    realizedRMultiple,
    outcome,
  };
}

export interface TargetTpResult {
  isValid: boolean;
  errorMessage?: string;
  targetRR: number;
  slDistancePips: number | null;
  tpDistancePips: number | null;
  targetTpPrice: number | null;
  targetTakeProfitPrice: number | null;
  riskAmount: number | null;
  potentialProfit: number | null;
  plannedRRFormatted: string;
}

/**
 * Helper to compute Target TP Price, TP Distance (pips), and Potential Profit ($)
 * from SL Distance and an explicit Target RR (e.g., 1, 2, 3, or custom).
 * Supports both object parameter and positional parameter call signatures.
 */
export function calculateTargetTpFromRR(
  symbolOrParams:
    | string
    | {
        symbol?: string;
        position: 'BUY' | 'SELL';
        entryPrice: number;
        stopLossPrice?: number | null;
        slDistancePips?: number | null;
        targetRR: number;
        lotSize: number;
      },
  positionOrSettings?: 'BUY' | 'SELL' | Partial<AppSettings>,
  entryPriceArg?: number,
  stopLossPriceArg?: number | null,
  lotSizeArg?: number,
  targetRRArg?: number,
  settingsArg?: Partial<AppSettings>
): TargetTpResult {
  const isObjectCall = typeof symbolOrParams === 'object' && symbolOrParams !== null;
  const params = isObjectCall
    ? symbolOrParams
    : {
        symbol: symbolOrParams as string,
        position: (positionOrSettings as 'BUY' | 'SELL') || 'BUY',
        entryPrice: Number(entryPriceArg),
        stopLossPrice: stopLossPriceArg,
        slDistancePips: undefined,
        lotSize: Number(lotSizeArg),
        targetRR: Number(targetRRArg),
      };
  const settings: Partial<AppSettings> = isObjectCall
    ? ((positionOrSettings as Partial<AppSettings>) || DEFAULT_SETTINGS)
    : settingsArg || DEFAULT_SETTINGS;

  if (!Number.isFinite(params.targetRR) || params.targetRR <= 0) {
    return {
      isValid: false,
      errorMessage: 'Target RR wajib lebih besar dari 0.',
      targetRR: params.targetRR,
      slDistancePips: null,
      tpDistancePips: null,
      targetTpPrice: null,
      targetTakeProfitPrice: null,
      riskAmount: null,
      potentialProfit: null,
      plannedRRFormatted: 'Tidak tersedia',
    };
  }

  const res = calculateLotBasedOrderMetrics(
    {
      symbol: params.symbol,
      position: params.position,
      lotSize: params.lotSize,
      entryPrice: params.entryPrice,
      stopLossPrice: params.stopLossPrice,
      slDistancePipsInput: params.slDistancePips,
      targetRR: params.targetRR,
    },
    settings
  );

  return {
    isValid: res.isValid && res.computedTakeProfitPrice !== null,
    errorMessage: res.errorMessage,
    targetRR: params.targetRR,
    slDistancePips: res.slDistancePips,
    tpDistancePips: res.tpDistancePips,
    targetTpPrice: res.computedTakeProfitPrice,
    targetTakeProfitPrice: res.computedTakeProfitPrice,
    riskAmount: res.riskAmount,
    potentialProfit: res.potentialProfit,
    plannedRRFormatted: res.plannedRRFormatted,
  };
}

// ============================================================================
// FEATURE 01 SHARED ENGINE: LOT CALCULATOR (MANUAL) & LOT SIZING (AUTOMATIC)
// ============================================================================

export type SlDistanceInputUnit = 'PIPS' | 'POINTS' | 'PRICE_DISTANCE' | 'ENTRY_SL_PRICE';

export interface ResolvedInstrumentContractSpec {
  symbol: string;
  description: string;
  contractSize: number;
  digits: number;
  point: number;
  tickSize: number;
  pipSize: number;
  minLot: number;
  maxLot: number;
  lotStep: number;
  baseCurrency: string;
  quoteCurrency: string;
  accountCurrency: string;
  requiresQuoteConversion: boolean;
  isConversionPriceAvailable: boolean;
  referencePriceUsed: number | null;
  pipValueInQuotePerStandardLot: number; // e.g., $10 for XAUUSD/EURUSD, 1000 JPY for USDJPY, 10 CAD for USDCAD
  pipValuePerStandardLotUsd: number; // USD value per 1 pip for 1.00 standard lot
  pipValuePer001LotUsd: number; // USD value per 1 pip for 0.01 lot
  tickValuePerStandardLotUsd: number; // USD value per 1 tick for 1.00 standard lot
}

/**
 * Resolves full contract specification and accurate USD pip/tick value for any supported instrument,
 * including dynamic quote-currency conversion for pairs quoted in JPY, CAD, or CHF (USDJPY, USDCAD, USDCHF).
 * Never assumes all instruments share the same contract size, pip size, or fixed $10 pip value.
 */
export function resolveInstrumentContractSpec(
  symbolRaw: string,
  referencePrice?: number | null,
  settings: Partial<AppSettings> = DEFAULT_SETTINGS
): ResolvedInstrumentContractSpec {
  const baseSpec = getInstrumentPipSpec(symbolRaw, settings);
  const sym = baseSpec.symbol;

  let baseCurrency = 'USD';
  let quoteCurrency = 'USD';
  if (sym === 'XAUUSD') {
    baseCurrency = 'XAU';
    quoteCurrency = 'USD';
  } else if (sym === 'BTCUSD') {
    baseCurrency = 'BTC';
    quoteCurrency = 'USD';
  } else if (sym === 'US30' || sym === 'NAS100') {
    baseCurrency = sym;
    quoteCurrency = 'USD';
  } else if (sym.length === 6) {
    baseCurrency = sym.slice(0, 3);
    quoteCurrency = sym.slice(3, 6);
  }

  const requiresQuoteConversion = quoteCurrency !== 'USD';
  const hasValidRefPrice =
    referencePrice !== undefined &&
    referencePrice !== null &&
    Number.isFinite(Number(referencePrice)) &&
    Number(referencePrice) > 0;

  // In quote currency: 1 pip for 1.00 lot = contractSize * pipSize
  // Special case for XAUUSD when user customizes xauusdPipValuePer001Lot in settings:
  const pipValueInQuotePerStandardLot =
    sym === 'XAUUSD'
      ? baseSpec.pipValuePerStandardLot
      : Number((baseSpec.contractSize * baseSpec.pipSize).toFixed(6));

  const ticksPerPip = baseSpec.tickSize > 0 ? baseSpec.pipSize / baseSpec.tickSize : 1;

  let pipValuePerStandardLotUsd = 0;
  let tickValuePerStandardLotUsd = 0;
  let isConversionPriceAvailable = true;
  let referencePriceUsed: number | null = null;

  if (!requiresQuoteConversion) {
    pipValuePerStandardLotUsd = pipValueInQuotePerStandardLot;
    tickValuePerStandardLotUsd = Number((pipValuePerStandardLotUsd / ticksPerPip).toFixed(6));
  } else if (hasValidRefPrice) {
    referencePriceUsed = Number(referencePrice);
    // Quote currency is JPY, CAD, or CHF with USD base (USDJPY, USDCAD, USDCHF):
    // Value in USD = Value in Quote Currency / Exchange Rate (USD/Quote)
    pipValuePerStandardLotUsd = Number(
      (pipValueInQuotePerStandardLot / referencePriceUsed).toFixed(6)
    );
    tickValuePerStandardLotUsd = Number((pipValuePerStandardLotUsd / ticksPerPip).toFixed(6));
  } else {
    isConversionPriceAvailable = false;
    pipValuePerStandardLotUsd = 0;
    tickValuePerStandardLotUsd = 0;
  }

  const pipValuePer001LotUsd = Number((pipValuePerStandardLotUsd / 100).toFixed(6));

  return {
    symbol: sym,
    description: baseSpec.description,
    contractSize: baseSpec.contractSize,
    digits: baseSpec.digits,
    point: baseSpec.point,
    tickSize: baseSpec.tickSize,
    pipSize: baseSpec.pipSize,
    minLot: baseSpec.minLot,
    maxLot: baseSpec.maxLot,
    lotStep: baseSpec.lotStep,
    baseCurrency,
    quoteCurrency,
    accountCurrency: settings.currency || 'USD',
    requiresQuoteConversion,
    isConversionPriceAvailable,
    referencePriceUsed,
    pipValueInQuotePerStandardLot,
    pipValuePerStandardLotUsd,
    pipValuePer001LotUsd,
    tickValuePerStandardLotUsd,
  };
}

export interface ManualLotComparisonInput {
  symbol: string;
  accountBalance: number;
  slDistanceUnit: SlDistanceInputUnit;
  slDistanceValue?: number;
  direction?: 'BUY' | 'SELL';
  entryPrice?: number;
  stopLossPrice?: number;
  referenceQuotePrice?: number;
  lotSizes: number[];
}

export interface ManualLotComparisonRow {
  lotSize: number;
  slDistancePips: number;
  slDistancePoints: number;
  slDistancePrice: number;
  potentialLossUsd: number;
  riskPercentOfBalance: number;
  exceedsBalance: boolean;
  isBelowMinLot: boolean;
  isAboveMaxLot: boolean;
  isNonStandardStep: boolean;
  statusNote?: string;
}

export interface ManualLotComparisonResult {
  isValid: boolean;
  errorMessage?: string;
  symbol: string;
  contractSpec: ResolvedInstrumentContractSpec;
  accountBalance: number;
  slDistanceUnit: SlDistanceInputUnit;
  slDistancePips: number;
  slDistancePoints: number;
  slDistancePrice: number;
  rows: ManualLotComparisonRow[];
}

/**
 * Mode A — LOT CALCULATOR (Manual Risk Calculation):
 * User specifies one or more manual lot sizes and Stop Loss distance.
 * Computes Potential Loss ($) and Risk (%) of Account Balance for each manual lot without
 * altering or rounding the user's lot inputs or recommending an automatic lot.
 */
export function calculateManualLotComparison(
  input: ManualLotComparisonInput,
  settings: Partial<AppSettings> = DEFAULT_SETTINGS
): ManualLotComparisonResult {
  const unit: SlDistanceInputUnit = input.slDistanceUnit || 'PIPS';
  const refPrice =
    unit === 'ENTRY_SL_PRICE'
      ? input.stopLossPrice && input.stopLossPrice > 0
        ? input.stopLossPrice
        : input.entryPrice
      : input.referenceQuotePrice;

  const contractSpec = resolveInstrumentContractSpec(input.symbol, refPrice, settings);
  const balance = Number(input.accountBalance);

  const emptyResult: ManualLotComparisonResult = {
    isValid: false,
    symbol: contractSpec.symbol,
    contractSpec,
    accountBalance: Number.isFinite(balance) && balance > 0 ? balance : 0,
    slDistanceUnit: unit,
    slDistancePips: 0,
    slDistancePoints: 0,
    slDistancePrice: 0,
    rows: [],
  };

  if (!Number.isFinite(balance) || balance <= 0) {
    return {
      ...emptyResult,
      errorMessage: 'Account Balance wajib berupa angka positif (> 0).',
    };
  }

  let slDistancePrice = 0;
  let slDistancePips = 0;
  let slDistancePoints = 0;

  if (unit === 'ENTRY_SL_PRICE') {
    const entry = Number(input.entryPrice);
    const sl = Number(input.stopLossPrice);
    const dir = input.direction === 'SELL' ? 'SELL' : 'BUY';

    if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(sl) || sl <= 0) {
      return {
        ...emptyResult,
        errorMessage: 'Masukkan Entry Price dan Stop Loss yang valid (> 0).',
      };
    }

    const dirCheck = validateSlTpDirection(dir, entry, sl, undefined);
    if (!dirCheck.slValid) {
      return {
        ...emptyResult,
        errorMessage: dirCheck.slError,
      };
    }

    const entryScaled = parseDecimalToScaledBigInt(entry, 'NEAREST');
    const slScaled = parseDecimalToScaledBigInt(sl, 'NEAREST');
    const diffScaled = entryScaled > slScaled ? entryScaled - slScaled : slScaled - entryScaled;
    slDistancePrice = Number(diffScaled) / Number(BIGINT_SCALE_8);
    slDistancePips = Number((slDistancePrice / contractSpec.pipSize).toFixed(2));
    slDistancePoints = Math.round(slDistancePrice / contractSpec.point);
  } else {
    const rawDist = Number(input.slDistanceValue);
    if (!Number.isFinite(rawDist) || rawDist <= 0) {
      return {
        ...emptyResult,
        errorMessage: 'Stop Loss Distance wajib berupa angka positif (> 0).',
      };
    }

    if (unit === 'PIPS') {
      slDistancePips = Number(rawDist.toFixed(2));
      slDistancePrice = Number((slDistancePips * contractSpec.pipSize).toFixed(contractSpec.digits));
      slDistancePoints = Math.round(slDistancePrice / contractSpec.point);
    } else if (unit === 'POINTS') {
      slDistancePoints = Math.round(rawDist);
      slDistancePrice = Number(
        (slDistancePoints * contractSpec.point).toFixed(contractSpec.digits)
      );
      slDistancePips = Number((slDistancePrice / contractSpec.pipSize).toFixed(2));
    } else {
      // PRICE_DISTANCE
      slDistancePrice = Number(rawDist.toFixed(contractSpec.digits));
      slDistancePips = Number((slDistancePrice / contractSpec.pipSize).toFixed(2));
      slDistancePoints = Math.round(slDistancePrice / contractSpec.point);
    }
  }

  if (slDistancePips <= 0 || slDistancePrice <= 0) {
    return {
      ...emptyResult,
      errorMessage: 'Jarak Stop Loss terlalu kecil atau bernilai nol.',
    };
  }

  if (contractSpec.requiresQuoteConversion && !contractSpec.isConversionPriceAvailable) {
    return {
      ...emptyResult,
      slDistancePips,
      slDistancePoints,
      slDistancePrice,
      errorMessage: `Instrumen ${contractSpec.symbol} menggunakan mata uang kuotasi ${contractSpec.quoteCurrency}. Masukkan harga pasar ${contractSpec.symbol} saat ini untuk mengonversi nilai pip ke USD secara akurat.`,
    };
  }

  const validLotInputs = (input.lotSizes || []).filter(
    (l) => typeof l === 'number' && Number.isFinite(l) && l > 0
  );

  if (validLotInputs.length === 0) {
    return {
      ...emptyResult,
      slDistancePips,
      slDistancePoints,
      slDistancePrice,
      errorMessage: 'Masukkan minimal satu ukuran Lot (> 0) untuk dihitung risikonya.',
    };
  }

  const lotStepScaled = parseDecimalToScaledBigInt(contractSpec.lotStep, 'NEAREST');

  const rows: ManualLotComparisonRow[] = validLotInputs.map((lotVal) => {
    const exactLossUsd = lotVal * slDistancePips * contractSpec.pipValuePerStandardLotUsd;
    const potentialLossUsd = Number(exactLossUsd.toFixed(2));
    const riskPercentOfBalance = Number(((potentialLossUsd / balance) * 100).toFixed(2));
    const exceedsBalance = potentialLossUsd > balance;
    const isBelowMinLot = lotVal < contractSpec.minLot;
    const isAboveMaxLot = lotVal > contractSpec.maxLot;

    const lotScaled = parseDecimalToScaledBigInt(lotVal, 'NEAREST');
    const isNonStandardStep = lotStepScaled > 0n ? lotScaled % lotStepScaled !== 0n : false;

    const notes: string[] = [];
    if (isBelowMinLot) notes.push(`< Min Lot (${contractSpec.minLot})`);
    if (isAboveMaxLot) notes.push(`> Max Lot (${contractSpec.maxLot})`);
    if (isNonStandardStep) notes.push(`Di luar kelipatan Lot Step (${contractSpec.lotStep})`);
    if (exceedsBalance) notes.push('Melebihi saldo akun');

    return {
      lotSize: lotVal,
      slDistancePips,
      slDistancePoints,
      slDistancePrice,
      potentialLossUsd,
      riskPercentOfBalance,
      exceedsBalance,
      isBelowMinLot,
      isAboveMaxLot,
      isNonStandardStep,
      statusNote: notes.length > 0 ? notes.join(' · ') : undefined,
    };
  });

  return {
    isValid: true,
    symbol: contractSpec.symbol,
    contractSpec,
    accountBalance: balance,
    slDistanceUnit: unit,
    slDistancePips,
    slDistancePoints,
    slDistancePrice,
    rows,
  };
}

export type BalanceSourceOption = 'APP_BALANCE' | 'CUSTOM_BALANCE';

export interface ManualPositionPlanInput {
  balanceSource?: BalanceSourceOption;
  accountBalance: number;
  symbol: string;
  direction: 'BUY' | 'SELL';
  lotSize: number;
  entryPrice: number;
  stopLossPrice?: number | null;
  takeProfitPrice?: number | null;
}

export interface ManualPositionPlanResult {
  isValid: boolean;
  errorMessage?: string;
  balanceSource: BalanceSourceOption;
  accountBalance: number;
  symbol: string;
  direction: 'BUY' | 'SELL';
  lotSize: number;
  entryPrice: number;
  contractSpec: ResolvedInstrumentContractSpec;

  // Lot validation
  isLotValid: boolean;
  lotError?: string;

  // Stop Loss section
  hasStopLoss: boolean;
  isStopLossValid: boolean;
  slError?: string;
  slDistancePrice: number;
  slDistancePips: number;
  slDistancePoints: number;
  potentialLossUsd: number;
  riskPercentOfBalance: number;
  exceedsBalance: boolean;

  // Take Profit section
  hasTakeProfit: boolean;
  isTakeProfitValid: boolean;
  tpError?: string;
  tpDistancePrice: number;
  tpDistancePips: number;
  tpDistancePoints: number;
  potentialProfitUsd: number;

  // Risk / Reward section
  hasRiskReward: boolean;
  riskRewardRatio: number;
  riskRewardFormatted: string;
}

/**
 * Mode A — LOT CALCULATOR (Manual Position Planner):
 * User manually enters Account Balance (App or Custom), Instrument, Direction (BUY/SELL),
 * Lot Size, Entry Price, Stop Loss, and Take Profit.
 * Computes Stop Loss Distance, Potential Loss ($), Risk (% of balance),
 * Take Profit Distance, Potential Profit ($), and Risk / Reward (1 : X).
 * Never determines or alters lot size automatically.
 */
export function calculateManualPositionPlan(
  input: ManualPositionPlanInput,
  settings: Partial<AppSettings> = DEFAULT_SETTINGS
): ManualPositionPlanResult {
  const balanceSource: BalanceSourceOption =
    input.balanceSource === 'CUSTOM_BALANCE' ? 'CUSTOM_BALANCE' : 'APP_BALANCE';
  const balance = Number(input.accountBalance);
  const dir: 'BUY' | 'SELL' = input.direction === 'SELL' ? 'SELL' : 'BUY';
  const lotSize = Number(input.lotSize);
  const entry = Number(input.entryPrice);

  const hasSlInput =
    input.stopLossPrice !== undefined &&
    input.stopLossPrice !== null &&
    String(input.stopLossPrice).trim() !== '' &&
    Number(input.stopLossPrice) !== 0;
  const sl = hasSlInput ? Number(input.stopLossPrice) : NaN;

  const hasTpInput =
    input.takeProfitPrice !== undefined &&
    input.takeProfitPrice !== null &&
    String(input.takeProfitPrice).trim() !== '' &&
    Number(input.takeProfitPrice) !== 0;
  const tp = hasTpInput ? Number(input.takeProfitPrice) : NaN;

  const refPrice =
    Number.isFinite(entry) && entry > 0
      ? entry
      : Number.isFinite(sl) && sl > 0
      ? sl
      : null;

  const contractSpec = resolveInstrumentContractSpec(input.symbol, refPrice, settings);

  const baseResult: ManualPositionPlanResult = {
    isValid: false,
    balanceSource,
    accountBalance: Number.isFinite(balance) && balance > 0 ? balance : 0,
    symbol: contractSpec.symbol,
    direction: dir,
    lotSize: Number.isFinite(lotSize) && lotSize > 0 ? lotSize : 0,
    entryPrice: Number.isFinite(entry) && entry > 0 ? entry : 0,
    contractSpec,
    isLotValid: false,
    hasStopLoss: hasSlInput,
    isStopLossValid: false,
    slDistancePrice: 0,
    slDistancePips: 0,
    slDistancePoints: 0,
    potentialLossUsd: 0,
    riskPercentOfBalance: 0,
    exceedsBalance: false,
    hasTakeProfit: hasTpInput,
    isTakeProfitValid: false,
    tpDistancePrice: 0,
    tpDistancePips: 0,
    tpDistancePoints: 0,
    potentialProfitUsd: 0,
    hasRiskReward: false,
    riskRewardRatio: 0,
    riskRewardFormatted: '--',
  };

  if (!Number.isFinite(balance) || balance <= 0) {
    return {
      ...baseResult,
      errorMessage: 'Account Balance wajib berupa angka positif (> 0).',
    };
  }

  // Validate Lot Size against minLot, maxLot, and lotStep
  if (!Number.isFinite(lotSize) || lotSize <= 0) {
    return {
      ...baseResult,
      lotError: 'Ukuran Lot wajib berupa angka positif (> 0).',
      errorMessage: 'Ukuran Lot wajib berupa angka positif (> 0).',
    };
  }

  const lotScaled = parseDecimalToScaledBigInt(lotSize, 'NEAREST');
  const minLotScaled = parseDecimalToScaledBigInt(contractSpec.minLot, 'NEAREST');
  const maxLotScaled = parseDecimalToScaledBigInt(contractSpec.maxLot, 'NEAREST');
  const lotStepScaled = parseDecimalToScaledBigInt(contractSpec.lotStep, 'NEAREST');

  if (lotScaled < minLotScaled) {
    const msg = `Ukuran Lot (${lotSize}) di bawah batas minimum instrumen ${contractSpec.symbol} (${contractSpec.minLot} lot).`;
    return {
      ...baseResult,
      lotError: msg,
      errorMessage: msg,
    };
  }

  if (lotScaled > maxLotScaled) {
    const msg = `Ukuran Lot (${lotSize}) melebihi batas maksimum instrumen ${contractSpec.symbol} (${contractSpec.maxLot} lot).`;
    return {
      ...baseResult,
      lotError: msg,
      errorMessage: msg,
    };
  }

  if (lotStepScaled > 0n && lotScaled % lotStepScaled !== 0n) {
    const msg = `Ukuran Lot (${lotSize}) harus sesuai kelipatan Lot Step instrumen ${contractSpec.symbol} (${contractSpec.lotStep}).`;
    return {
      ...baseResult,
      lotError: msg,
      errorMessage: msg,
    };
  }

  baseResult.isLotValid = true;

  if (!Number.isFinite(entry) || entry <= 0) {
    return {
      ...baseResult,
      errorMessage: 'Masukkan Entry Price yang valid (> 0).',
    };
  }

  const entryScaled = parseDecimalToScaledBigInt(entry, 'NEAREST');

  // Evaluate Stop Loss if provided
  if (hasSlInput) {
    if (!Number.isFinite(sl) || sl <= 0) {
      baseResult.slError = 'Harga Stop Loss harus berupa angka positif (> 0).';
    } else {
      const slCheck = validateSlTpDirection(dir, entry, sl, undefined);
      if (!slCheck.slValid) {
        baseResult.slError = slCheck.slError;
      } else {
        const slScaled = parseDecimalToScaledBigInt(sl, 'NEAREST');
        const diffScaled = entryScaled > slScaled ? entryScaled - slScaled : slScaled - entryScaled;
        const slDistancePrice = Number(
          (Number(diffScaled) / Number(BIGINT_SCALE_8)).toFixed(contractSpec.digits)
        );
        const slDistancePips = Number((slDistancePrice / contractSpec.pipSize).toFixed(2));
        const slDistancePoints = Math.round(slDistancePrice / contractSpec.point);

        if (slDistancePrice <= 0 || slDistancePips <= 0) {
          baseResult.slError = 'Jarak Stop Loss terlalu kecil atau sama dengan Entry Price.';
        } else {
          // Resolve pip value at SL price for non-USD quote pairs (e.g., USDJPY, USDCAD, USDCHF)
          const slSpec = resolveInstrumentContractSpec(input.symbol, sl, settings);
          const exactLoss = lotSize * slDistancePips * slSpec.pipValuePerStandardLotUsd;
          const potentialLossUsd = Number(exactLoss.toFixed(2));
          const riskPercentOfBalance = Number(((potentialLossUsd / balance) * 100).toFixed(2));

          baseResult.isStopLossValid = true;
          baseResult.slDistancePrice = slDistancePrice;
          baseResult.slDistancePips = slDistancePips;
          baseResult.slDistancePoints = slDistancePoints;
          baseResult.potentialLossUsd = potentialLossUsd;
          baseResult.riskPercentOfBalance = riskPercentOfBalance;
          baseResult.exceedsBalance = potentialLossUsd > balance;
        }
      }
    }
  }

  // Evaluate Take Profit if provided
  if (hasTpInput) {
    if (!Number.isFinite(tp) || tp <= 0) {
      baseResult.tpError = 'Harga Take Profit harus berupa angka positif (> 0).';
    } else {
      // Check TP direction independently even if SL is not provided
      const tpCheck =
        dir === 'BUY'
          ? tp > entry
            ? { tpValid: true }
            : {
                tpValid: false,
                tpError: 'Untuk posisi BUY, Take Profit harus berada di atas Entry Price.',
              }
          : tp < entry
          ? { tpValid: true }
          : {
              tpValid: false,
              tpError: 'Untuk posisi SELL, Take Profit harus berada di bawah Entry Price.',
            };

      if (!tpCheck.tpValid) {
        baseResult.tpError = tpCheck.tpError;
      } else {
        const tpScaled = parseDecimalToScaledBigInt(tp, 'NEAREST');
        const diffScaled = tpScaled > entryScaled ? tpScaled - entryScaled : entryScaled - tpScaled;
        const tpDistancePrice = Number(
          (Number(diffScaled) / Number(BIGINT_SCALE_8)).toFixed(contractSpec.digits)
        );
        const tpDistancePips = Number((tpDistancePrice / contractSpec.pipSize).toFixed(2));
        const tpDistancePoints = Math.round(tpDistancePrice / contractSpec.point);

        if (tpDistancePrice <= 0 || tpDistancePips <= 0) {
          baseResult.tpError = 'Jarak Take Profit terlalu kecil atau sama dengan Entry Price.';
        } else {
          const tpSpec = resolveInstrumentContractSpec(input.symbol, tp, settings);
          const exactProfit = lotSize * tpDistancePips * tpSpec.pipValuePerStandardLotUsd;
          const potentialProfitUsd = Number(exactProfit.toFixed(2));

          baseResult.isTakeProfitValid = true;
          baseResult.tpDistancePrice = tpDistancePrice;
          baseResult.tpDistancePips = tpDistancePips;
          baseResult.tpDistancePoints = tpDistancePoints;
          baseResult.potentialProfitUsd = potentialProfitUsd;
        }
      }
    }
  }

  // Evaluate Risk / Reward when both SL and TP are valid
  if (
    baseResult.isStopLossValid &&
    baseResult.isTakeProfitValid &&
    baseResult.slDistancePrice > 0
  ) {
    const rr = Number((baseResult.tpDistancePrice / baseResult.slDistancePrice).toFixed(2));
    baseResult.hasRiskReward = rr > 0;
    baseResult.riskRewardRatio = rr;
    baseResult.riskRewardFormatted = `1 : ${Number(rr.toFixed(2))}`;
  }

  const firstError = baseResult.slError || baseResult.tpError;
  baseResult.isValid =
    baseResult.isLotValid &&
    !firstError &&
    (baseResult.isStopLossValid || baseResult.isTakeProfitValid);
  baseResult.errorMessage = firstError;

  return baseResult;
}

export interface AutomaticLotSizingInput {
  symbol: string;
  accountBasisType: RiskCapitalBasis;
  accountBasisAmount: number;
  riskPercent: number;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLossPrice: number;
}

export interface AutomaticLotSizingResult {
  isValid: boolean;
  isExecutable: boolean;
  errorMessage?: string;
  executionNotice?: string;
  symbol: string;
  contractSpec: ResolvedInstrumentContractSpec;
  accountBasisType: RiskCapitalBasis;
  accountBasisAmount: number;
  maximumAllowedRiskPercent: number;
  riskAmountUsd: number;
  rawLot: number;
  recommendedLot: number;
  actualLossUsd: number;
  actualRiskPercent: number;
  slDistancePrice: number;
  slDistancePips: number;
  slDistancePoints: number;
  isBelowMinLot: boolean;
  isCappedAtMaxLot: boolean;
  minLotRequiredRiskUsd: number;
  minLotRequiredRiskPercent: number;
}

/**
 * Mode B — LOT SIZING (Automatic Lot Calculation):
 * User specifies Account Basis (Equity or Balance), Risk per Trade (%), Direction, Entry Price, and Stop Loss.
 * Calculates allowed Risk Amount ($), Raw Lot, Recommended Lot (floored to instrument lotStep),
 * and Actual Risk ($ and %) after rounding.
 */
export function calculateAutomaticLotSizing(
  input: AutomaticLotSizingInput,
  settings: Partial<AppSettings> = DEFAULT_SETTINGS
): AutomaticLotSizingResult {
  const basisType: RiskCapitalBasis = input.accountBasisType === 'BALANCE' ? 'BALANCE' : 'EQUITY';
  const basisAmount = Number(input.accountBasisAmount);
  const riskPct = Number(input.riskPercent);
  const entry = Number(input.entryPrice);
  const sl = Number(input.stopLossPrice);
  const dir: 'BUY' | 'SELL' = input.direction === 'SELL' ? 'SELL' : 'BUY';

  // Use Stop Loss price (or Entry price fallback) as the conversion rate at SL execution for USDJPY/USDCAD/USDCHF
  const refPrice = Number.isFinite(sl) && sl > 0 ? sl : Number.isFinite(entry) && entry > 0 ? entry : null;
  const contractSpec = resolveInstrumentContractSpec(input.symbol, refPrice, settings);

  const emptyResult: AutomaticLotSizingResult = {
    isValid: false,
    isExecutable: false,
    symbol: contractSpec.symbol,
    contractSpec,
    accountBasisType: basisType,
    accountBasisAmount: Number.isFinite(basisAmount) && basisAmount > 0 ? basisAmount : 0,
    maximumAllowedRiskPercent: Number.isFinite(riskPct) && riskPct > 0 ? riskPct : 0,
    riskAmountUsd: 0,
    rawLot: 0,
    recommendedLot: 0,
    actualLossUsd: 0,
    actualRiskPercent: 0,
    slDistancePrice: 0,
    slDistancePips: 0,
    slDistancePoints: 0,
    isBelowMinLot: false,
    isCappedAtMaxLot: false,
    minLotRequiredRiskUsd: 0,
    minLotRequiredRiskPercent: 0,
  };

  if (!Number.isFinite(basisAmount) || basisAmount <= 0) {
    return {
      ...emptyResult,
      errorMessage: `Nominal Account ${basisType === 'EQUITY' ? 'Equity' : 'Balance'} wajib berupa angka positif (> 0).`,
    };
  }

  if (!Number.isFinite(riskPct) || riskPct <= 0) {
    return {
      ...emptyResult,
      errorMessage: 'Risk per Trade (%) wajib berupa angka positif (> 0).',
    };
  }

  // Conservative floor on allowed risk budget in scaled 10^8 BigInt
  const basisScaled = parseDecimalToScaledBigInt(basisAmount, 'FLOOR');
  const riskPctScaled = parseDecimalToScaledBigInt(riskPct, 'FLOOR');
  const riskAmountScaled = (basisScaled * riskPctScaled) / (100n * BIGINT_SCALE_8);
  const rawRiskAmountFloat = scaledBigIntToNumber(riskAmountScaled, 6);
  const riskAmountUsd = Number(rawRiskAmountFloat.toFixed(2));
  emptyResult.riskAmountUsd = riskAmountUsd;

  if (riskAmountScaled <= 0n) {
    return {
      ...emptyResult,
      errorMessage: 'Risk Amount bernilai nol. Tingkatkan saldo atau persentase risiko.',
    };
  }

  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(sl) || sl <= 0) {
    return {
      ...emptyResult,
      errorMessage: 'Masukkan Entry Price dan Stop Loss yang valid (> 0).',
    };
  }

  const dirCheck = validateSlTpDirection(dir, entry, sl, undefined);
  if (!dirCheck.slValid) {
    return {
      ...emptyResult,
      errorMessage: dirCheck.slError,
    };
  }

  const entryScaled = parseDecimalToScaledBigInt(entry, 'NEAREST');
  const slScaled = parseDecimalToScaledBigInt(sl, 'NEAREST');
  const slDistScaled = entryScaled > slScaled ? entryScaled - slScaled : slScaled - entryScaled;
  const minThresholdScaled = parseDecimalToScaledBigInt(contractSpec.point / 2, 'NEAREST');

  if (slDistScaled <= minThresholdScaled) {
    return {
      ...emptyResult,
      errorMessage: 'Jarak Stop Loss terlalu sempit.',
    };
  }

  const slDistancePrice = Number(
    (Number(slDistScaled) / Number(BIGINT_SCALE_8)).toFixed(contractSpec.digits)
  );
  const pipSizeScaled = parseDecimalToScaledBigInt(contractSpec.pipSize, 'NEAREST');
  const slDistancePipsScaled = (slDistScaled * BIGINT_SCALE_8) / pipSizeScaled;
  const slDistancePips = Number((slDistancePrice / contractSpec.pipSize).toFixed(2));
  const slDistancePoints = Math.round(slDistancePrice / contractSpec.point);

  const pipValStdScaled = parseDecimalToScaledBigInt(
    contractSpec.pipValuePerStandardLotUsd,
    'NEAREST'
  );
  const lossPerLot16 = slDistancePipsScaled * pipValStdScaled;
  const lossPerLotScaled = (lossPerLot16 + (BIGINT_SCALE_8 - 1n)) / BIGINT_SCALE_8;

  if (lossPerLotScaled <= 0n) {
    return {
      ...emptyResult,
      errorMessage: 'Perhitungan nilai kerugian per lot bernilai nol.',
    };
  }

  const lossPerLotFloat = Number(lossPerLotScaled) / Number(BIGINT_SCALE_8);
  const rawLot = Number((rawRiskAmountFloat / lossPerLotFloat).toFixed(4));

  const lotStepScaled = parseDecimalToScaledBigInt(contractSpec.lotStep, 'NEAREST');
  const minLotScaled = parseDecimalToScaledBigInt(contractSpec.minLot, 'NEAREST');
  const maxLotScaled = parseDecimalToScaledBigInt(contractSpec.maxLot, 'FLOOR');
  const alignedMaxSteps = maxLotScaled / lotStepScaled;

  const costPerStep16 = lossPerLotScaled * lotStepScaled;
  const riskBudget16 = riskAmountScaled * BIGINT_SCALE_8;
  const rawStepsCount = riskBudget16 / costPerStep16;
  const isCappedAtMaxLot = rawStepsCount > alignedMaxSteps;
  const cappedStepsCount = isCappedAtMaxLot ? alignedMaxSteps : rawStepsCount;

  let candidateLotScaled = cappedStepsCount * lotStepScaled;
  while (
    candidateLotScaled > 0n &&
    candidateLotScaled * lossPerLotScaled > riskBudget16
  ) {
    candidateLotScaled -= lotStepScaled;
  }

  const isBelowMinLot = candidateLotScaled < minLotScaled;
  const finalLotScaled = isBelowMinLot ? 0n : candidateLotScaled;
  const stepDecimals = countStepDecimals(contractSpec.lotStep);
  const recommendedLot = scaledBigIntToNumber(finalLotScaled, stepDecimals);

  const exactActualLoss16 = finalLotScaled * lossPerLotScaled;
  const actualLossScaled = (exactActualLoss16 + (BIGINT_SCALE_8 - 1n)) / BIGINT_SCALE_8;
  const actualLossUsd = Number((Number(actualLossScaled) / Number(BIGINT_SCALE_8)).toFixed(2));
  const actualRiskPercent = Number(((actualLossUsd / basisAmount) * 100).toFixed(2));

  const minLotRequiredRiskUsd = Number((contractSpec.minLot * lossPerLotFloat).toFixed(2));
  const minLotRequiredRiskPercent = Number(
    ((minLotRequiredRiskUsd / basisAmount) * 100).toFixed(2)
  );

  let executionNotice: string | undefined;
  if (isBelowMinLot) {
    executionNotice = `Ukuran lot terhitung (${rawLot.toFixed(3)} lot) berada di bawah batas minimum lot instrumen ${contractSpec.symbol} (${contractSpec.minLot.toFixed(2)} lot). Pada jarak SL ${slDistancePips} pips, lot minimum ${contractSpec.minLot.toFixed(2)} membutuhkan risiko $${minLotRequiredRiskUsd.toFixed(2)} (${minLotRequiredRiskPercent.toFixed(2)}% dari ${basisType === 'EQUITY' ? 'Equity' : 'Balance'}), yang melebihi batas risiko $${riskAmountUsd.toFixed(2)} (${riskPct.toFixed(2)}%).`;
  } else if (isCappedAtMaxLot) {
    executionNotice = `Ukuran lot dibatasi pada batas maksimum instrumen (${contractSpec.maxLot.toFixed(2)} lot).`;
  }

  return {
    isValid: true,
    isExecutable: !isBelowMinLot && recommendedLot >= contractSpec.minLot,
    executionNotice,
    symbol: contractSpec.symbol,
    contractSpec,
    accountBasisType: basisType,
    accountBasisAmount: basisAmount,
    maximumAllowedRiskPercent: Number(riskPct.toFixed(2)),
    riskAmountUsd,
    rawLot,
    recommendedLot,
    actualLossUsd,
    actualRiskPercent,
    slDistancePrice,
    slDistancePips,
    slDistancePoints,
    isBelowMinLot,
    isCappedAtMaxLot,
    minLotRequiredRiskUsd,
    minLotRequiredRiskPercent,
  };
}



