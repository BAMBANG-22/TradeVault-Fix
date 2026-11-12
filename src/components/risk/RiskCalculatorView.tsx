import React, { useState, useMemo, useEffect } from 'react';
import { AppSettings } from '../../types/settings';
import { Trade } from '../../types/trade';
import {
  calculateManualPositionPlan,
  calculateAutomaticLotSizing,
  BalanceSourceOption,
  RiskCapitalBasis,
  simulateConsecutiveLosses,
  evaluateTradingDiscipline,
  ConsecutiveLossMethod,
  MT5_SYMBOL_REGISTRY,
  getInstrumentPipSpec,
  POSITION_SIZING_RISK_PRESETS,
} from '../../utils/riskCalculator';
import { formatCurrency, computeTradeNetProfit, isClosedLifecycleTrade } from '../../utils/calculations';
import { useGlobalCurrency } from '../../utils/currencyRate';
import { useLanguage } from '../../utils/language';
import { CompoundingCalculatorTab } from './CompoundingCalculatorTab';
import { TradeSimulationTab } from './TradeSimulationTab';
import { AlertTriangle, Check, ChevronDown } from 'lucide-react';

interface RiskCalculatorViewProps {
  currentEquity: number;
  settings: AppSettings;
  onUpdateSettings: (newSettings: AppSettings) => void;
  dailyLossToday: number;
  trades: Trade[];
}

type RiskToolTab =
  | 'lot-calc'
  | 'protection-rules'
  | 'consecutive-loss'
  | 'discipline-eval'
  | 'compounding-calc'
  | 'trade-sim';

type LotCalculatorSubMode = 'LOT_CALCULATOR' | 'LOT_SIZING';
type SizingCapitalSourceOption = 'APP_EQUITY' | 'APP_BALANCE' | 'CUSTOM_BALANCE';
type DisciplinePeriod = 'LAST_20' | 'LAST_50' | 'ALL';

const MANUAL_LOT_QUICK_OPTIONS = ['0.01', '0.02', '0.05', '0.10'];

const INSTRUMENT_DEFAULTS: Record<
  string,
  {
    entry: string;
    slBuy: string;
    tpBuy: string;
    slSell: string;
    tpSell: string;
  }
> = {
  XAUUSD: { entry: '4000.00', slBuy: '3950.00', tpBuy: '4100.00', slSell: '4050.00', tpSell: '3900.00' },
  EURUSD: { entry: '1.0850', slBuy: '1.0800', tpBuy: '1.0950', slSell: '1.0900', tpSell: '1.0750' },
  GBPUSD: { entry: '1.2700', slBuy: '1.2650', tpBuy: '1.2800', slSell: '1.2750', tpSell: '1.2600' },
  USDJPY: { entry: '150.00', slBuy: '149.50', tpBuy: '151.00', slSell: '150.50', tpSell: '149.00' },
  BTCUSD: { entry: '65000.00', slBuy: '64500.00', tpBuy: '66000.00', slSell: '65500.00', tpSell: '64000.00' },
  AUDUSD: { entry: '0.6550', slBuy: '0.6500', tpBuy: '0.6650', slSell: '0.6600', tpSell: '0.6450' },
  NZDUSD: { entry: '0.6050', slBuy: '0.6000', tpBuy: '0.6150', slSell: '0.6100', tpSell: '0.5950' },
  USDCAD: { entry: '1.3600', slBuy: '1.3550', tpBuy: '1.3700', slSell: '1.3650', tpSell: '1.3500' },
  USDCHF: { entry: '0.8850', slBuy: '0.8800', tpBuy: '0.8950', slSell: '0.8900', tpSell: '0.8750' },
  US30: { entry: '39000.00', slBuy: '38900.00', tpBuy: '39200.00', slSell: '39100.00', tpSell: '38800.00' },
  NAS100: { entry: '18000.00', slBuy: '17900.00', tpBuy: '18200.00', slSell: '18100.00', tpSell: '17800.00' },
};

const RISK_TOOLS_META: {
  id: RiskToolTab;
  titleId: string;
  titleEn: string;
  subtitleId: string;
  subtitleEn: string;
}[] = [
  {
    id: 'lot-calc',
    titleId: 'Kalkulator Lot',
    titleEn: 'Lot Calculator',
    subtitleId: 'Kalkulator Lot & Ukuran Posisi',
    subtitleEn: 'Lot Calculator & Position Sizing',
  },
  {
    id: 'protection-rules',
    titleId: 'Proteksi & Aturan Risiko',
    titleEn: 'Risk Protection & Rules',
    subtitleId: 'Batas harian & pengaturan risiko',
    subtitleEn: 'Daily limits & risk settings',
  },
  {
    id: 'consecutive-loss',
    titleId: 'Simulasi Loss Beruntun',
    titleEn: 'Consecutive Loss Simulation',
    subtitleId: 'Simulasi kerugian beruntun',
    subtitleEn: 'Consecutive loss simulation',
  },
  {
    id: 'discipline-eval',
    titleId: 'Evaluasi Disiplin',
    titleEn: 'Discipline Evaluation',
    subtitleId: 'Kepatuhan aturan trading',
    subtitleEn: 'Trading rule compliance',
  },
  {
    id: 'compounding-calc',
    titleId: 'Simulator Compounding',
    titleEn: 'Compounding Simulator',
    subtitleId: 'Proyeksi pertumbuhan modal',
    subtitleEn: 'Capital growth projection',
  },
  {
    id: 'trade-sim',
    titleId: 'Simulasi Berbasis Trade',
    titleEn: 'Trade-Based Simulation',
    subtitleId: 'Skenario performa trading',
    subtitleEn: 'Trading performance scenarios',
  },
];

export const RiskCalculatorView: React.FC<RiskCalculatorViewProps> = ({
  currentEquity,
  settings,
  onUpdateSettings,
  dailyLossToday,
  trades,
}) => {
  const { tr } = useLanguage();
  const { preferredCurrency, formatDynamic, formatTradeFinancial } = useGlobalCurrency();
  const fmtMoney = (val: number) =>
    preferredCurrency === 'IDR' ? formatDynamic(val) : formatCurrency(val, settings);

  // Single-open accordion state: only one feature open at a time, or null when all closed
  const [activeTool, setActiveTool] = useState<RiskToolTab | null>('lot-calc');

  const handleToggleTool = (toolId: RiskToolTab) => {
    setActiveTool((prev) => (prev === toolId ? null : toolId));
  };

  // Active account balance fallback
  const activeBalance = currentEquity > 0 ? currentEquity : settings.startingBalance || 2500;

  // ============================================================================
  // 1. TODAY'S RISK & LOSS USAGE CALCULATIONS
  // ============================================================================
  const actualDailyLossAmount = Math.max(0, Number(dailyLossToday) || 0);
  const dailyLossPercentOfBalance =
    activeBalance > 0 ? (actualDailyLossAmount / activeBalance) * 100 : 0;

  const configuredDailyLimitAmount = Math.max(0, Number(settings.maxDailyLossAmount) || 0);
  const configuredDailyLimitPercent =
    Number(settings.maxDailyLossPercent) > 0
      ? Number(settings.maxDailyLossPercent)
      : activeBalance > 0
      ? (configuredDailyLimitAmount / activeBalance) * 100
      : 0;

  // Risk Usage is strictly: (Actual Daily Loss / Daily Loss Limit) * 100
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

  const dailyLossAlertEnabled = settings.dailyLossAlertEnabled !== false;
  const stopTradingAlertEnabled = settings.stopTradingAlertEnabled !== false;

  // ============================================================================
  // 2. FEATURE 01: LOT CALCULATOR (MANUAL) & POSITION SIZING (AUTOMATIC) STATE
  // ============================================================================
  const [lotSubMode, setLotSubMode] = useState<LotCalculatorSubMode>('LOT_CALCULATOR');
  const [instrument, setInstrument] = useState<string>('XAUUSD');

  // --- Mode A: LOT CALCULATOR (Manual Position Planner) ---
  const [manualBalanceSource, setManualBalanceSource] =
    useState<BalanceSourceOption>('APP_BALANCE');
  const [manualCustomBalanceInput, setManualCustomBalanceInput] = useState<string>(
    String(Number(activeBalance.toFixed(2)))
  );
  const [manualDirection, setManualDirection] = useState<'BUY' | 'SELL'>('BUY');
  const [manualLotSizeInput, setManualLotSizeInput] = useState<string>('0.01');
  const [manualEntryPriceInput, setManualEntryPriceInput] = useState<string>('4000.00');
  const [manualStopLossInput, setManualStopLossInput] = useState<string>('3950.00');
  const [manualTakeProfitInput, setManualTakeProfitInput] = useState<string>('4100.00');

  // --- Mode B: LOT SIZING (Automatic Position Sizing) ---
  const [sizingCapitalSource, setSizingCapitalSource] =
    useState<SizingCapitalSourceOption>('APP_EQUITY');
  const [sizingCustomBalanceInput, setSizingCustomBalanceInput] = useState<string>(
    String(Number(activeBalance.toFixed(2)))
  );
  const [sizingRiskPercentInput, setSizingRiskPercentInput] = useState<string>(
    String(settings.defaultRiskPercent || 1)
  );
  const [sizingDirection, setSizingDirection] = useState<'BUY' | 'SELL'>('BUY');
  const [sizingEntryPriceInput, setSizingEntryPriceInput] = useState<string>('4000.00');
  const [sizingStopLossInput, setSizingStopLossInput] = useState<string>('3950.00');

  const instrumentSpec = useMemo(
    () => getInstrumentPipSpec(instrument, settings),
    [instrument, settings]
  );

  const handleInstrumentChange = (newSymbol: string) => {
    setInstrument(newSymbol);
    const preset = INSTRUMENT_DEFAULTS[newSymbol];
    if (preset) {
      setManualEntryPriceInput(preset.entry);
      setManualStopLossInput(manualDirection === 'BUY' ? preset.slBuy : preset.slSell);
      setManualTakeProfitInput(manualDirection === 'BUY' ? preset.tpBuy : preset.tpSell);

      setSizingEntryPriceInput(preset.entry);
      setSizingStopLossInput(sizingDirection === 'BUY' ? preset.slBuy : preset.slSell);
    }
  };

  const handleManualDirectionChange = (newDir: 'BUY' | 'SELL') => {
    if (newDir === manualDirection) return;
    setManualDirection(newDir);
    const entryVal = parseFloat(manualEntryPriceInput);
    const slVal = parseFloat(manualStopLossInput);
    const tpVal = parseFloat(manualTakeProfitInput);
    if (Number.isFinite(entryVal) && entryVal > 0) {
      if (Number.isFinite(slVal) && slVal > 0) {
        const slDist = Math.abs(entryVal - slVal);
        const nextSl = newDir === 'BUY' ? entryVal - slDist : entryVal + slDist;
        if (nextSl > 0) {
          setManualStopLossInput(nextSl.toFixed(instrumentSpec.digits));
        }
      }
      if (Number.isFinite(tpVal) && tpVal > 0) {
        const tpDist = Math.abs(tpVal - entryVal);
        const nextTp = newDir === 'BUY' ? entryVal + tpDist : entryVal - tpDist;
        if (nextTp > 0) {
          setManualTakeProfitInput(nextTp.toFixed(instrumentSpec.digits));
        }
      }
    }
  };

  const handleSizingDirectionChange = (newDir: 'BUY' | 'SELL') => {
    if (newDir === sizingDirection) return;
    setSizingDirection(newDir);
    const entryVal = parseFloat(sizingEntryPriceInput);
    const slVal = parseFloat(sizingStopLossInput);
    if (Number.isFinite(entryVal) && entryVal > 0 && Number.isFinite(slVal) && slVal > 0) {
      const slDist = Math.abs(entryVal - slVal);
      const nextSl = newDir === 'BUY' ? entryVal - slDist : entryVal + slDist;
      if (nextSl > 0) {
        setSizingStopLossInput(nextSl.toFixed(instrumentSpec.digits));
      }
    }
  };

  const effectiveManualBalance =
    manualBalanceSource === 'APP_BALANCE'
      ? activeBalance
      : Math.max(0, parseFloat(manualCustomBalanceInput) || 0);

  const manualPositionPlanResult = useMemo(() => {
    const slTrim = manualStopLossInput.trim();
    const tpTrim = manualTakeProfitInput.trim();
    return calculateManualPositionPlan(
      {
        balanceSource: manualBalanceSource,
        accountBalance: effectiveManualBalance,
        symbol: instrument,
        direction: manualDirection,
        lotSize: parseFloat(manualLotSizeInput) || 0,
        entryPrice: parseFloat(manualEntryPriceInput) || 0,
        stopLossPrice: slTrim !== '' ? parseFloat(slTrim) : null,
        takeProfitPrice: tpTrim !== '' ? parseFloat(tpTrim) : null,
      },
      settings
    );
  }, [
    manualBalanceSource,
    effectiveManualBalance,
    instrument,
    manualDirection,
    manualLotSizeInput,
    manualEntryPriceInput,
    manualStopLossInput,
    manualTakeProfitInput,
    settings,
  ]);

  const effectiveSizingBalance =
    sizingCapitalSource === 'CUSTOM_BALANCE'
      ? Math.max(0, parseFloat(sizingCustomBalanceInput) || 0)
      : activeBalance;

  const effectiveSizingBasisType: RiskCapitalBasis =
    sizingCapitalSource === 'APP_EQUITY' ? 'EQUITY' : 'BALANCE';

  const automaticSizingResult = useMemo(() => {
    return calculateAutomaticLotSizing(
      {
        symbol: instrument,
        accountBasisType: effectiveSizingBasisType,
        accountBasisAmount: effectiveSizingBalance,
        riskPercent: parseFloat(sizingRiskPercentInput) || 0,
        direction: sizingDirection,
        entryPrice: parseFloat(sizingEntryPriceInput) || 0,
        stopLossPrice: parseFloat(sizingStopLossInput) || 0,
      },
      settings
    );
  }, [
    instrument,
    effectiveSizingBasisType,
    effectiveSizingBalance,
    sizingRiskPercentInput,
    sizingDirection,
    sizingEntryPriceInput,
    sizingStopLossInput,
    settings,
  ]);

  // ============================================================================
  // 3. FEATURE 02: PROTEKSI & ATURAN RISIKO STATE
  // ============================================================================
  const [ruleDailyLossPct, setRuleDailyLossPct] = useState<string>(
    String(settings.maxDailyLossPercent || 3)
  );
  const [ruleDailyLossAmt, setRuleDailyLossAmt] = useState<string>(
    String(settings.maxDailyLossAmount || 75)
  );
  const [ruleConsecutiveLosses, setRuleConsecutiveLosses] = useState<string>(
    String(settings.maxConsecutiveLossLimit || 3)
  );
  const [ruleMaxDrawdownPct, setRuleMaxDrawdownPct] = useState<string>(
    String(settings.maxDrawdownLimitPercent || 10)
  );
  const [ruleMaxTradeRiskPct, setRuleMaxTradeRiskPct] = useState<string>(
    String(settings.maxTradeRiskPercent || 2)
  );
  const [ruleResetTimezone, setRuleResetTimezone] = useState<string>(
    settings.resetTimezone || 'WIB (UTC+7)'
  );
  const [ruleDailyAlertOn, setRuleDailyAlertOn] = useState<boolean>(
    settings.dailyLossAlertEnabled !== false
  );
  const [ruleStopAlertOn, setRuleStopAlertOn] = useState<boolean>(
    settings.stopTradingAlertEnabled !== false
  );
  const [rulesSavedFeedback, setRulesSavedFeedback] = useState<boolean>(false);

  useEffect(() => {
    setRuleDailyLossPct(String(settings.maxDailyLossPercent || 3));
    setRuleDailyLossAmt(String(settings.maxDailyLossAmount || 75));
    setRuleConsecutiveLosses(String(settings.maxConsecutiveLossLimit || 3));
    setRuleMaxDrawdownPct(String(settings.maxDrawdownLimitPercent || 10));
    setRuleMaxTradeRiskPct(String(settings.maxTradeRiskPercent || 2));
    setRuleResetTimezone(settings.resetTimezone || 'WIB (UTC+7)');
    setRuleDailyAlertOn(settings.dailyLossAlertEnabled !== false);
    setRuleStopAlertOn(settings.stopTradingAlertEnabled !== false);
  }, [settings]);

  const handleRuleDailyLossPctChange = (val: string) => {
    setRuleDailyLossPct(val);
    const pct = parseFloat(val);
    if (Number.isFinite(pct) && pct >= 0) {
      const baseCap = settings.startingBalance > 0 ? settings.startingBalance : activeBalance;
      setRuleDailyLossAmt(String(Number(((baseCap * pct) / 100).toFixed(2))));
    }
  };

  const handleRuleDailyLossAmtChange = (val: string) => {
    setRuleDailyLossAmt(val);
    const amt = parseFloat(val);
    const baseCap = settings.startingBalance > 0 ? settings.startingBalance : activeBalance;
    if (Number.isFinite(amt) && amt >= 0 && baseCap > 0) {
      setRuleDailyLossPct(String(Number(((amt / baseCap) * 100).toFixed(2))));
    }
  };

  const handleSaveProtectionRules = () => {
    const baseCap = settings.startingBalance > 0 ? settings.startingBalance : activeBalance;
    const maxDailyPct = Math.max(0.1, parseFloat(ruleDailyLossPct) || 3);
    const maxDailyAmt = Math.max(1, parseFloat(ruleDailyLossAmt) || (baseCap * maxDailyPct) / 100);
    const maxConsec = Math.max(1, Math.floor(parseFloat(ruleConsecutiveLosses) || 3));
    const maxDdPct = Math.max(1, parseFloat(ruleMaxDrawdownPct) || 10);
    const maxTradePct = Math.max(0.1, parseFloat(ruleMaxTradeRiskPct) || 2);
    const maxTradeAmt = Number(((baseCap * maxTradePct) / 100).toFixed(2));

    onUpdateSettings({
      ...settings,
      maxDailyLossPercent: maxDailyPct,
      maxDailyLossAmount: maxDailyAmt,
      maxConsecutiveLossLimit: maxConsec,
      maxDrawdownLimitPercent: maxDdPct,
      maxTradeRiskPercent: maxTradePct,
      maxTradeRiskAmount: maxTradeAmt,
      resetTimezone: ruleResetTimezone,
      dailyLossAlertEnabled: ruleDailyAlertOn,
      stopTradingAlertEnabled: ruleStopAlertOn,
    });

    setRulesSavedFeedback(true);
    setTimeout(() => setRulesSavedFeedback(false), 2500);
  };

  // ============================================================================
  // 4. FEATURE 03: SIMULASI LOSS BERUNTUN STATE
  // ============================================================================
  const [consecBalanceInput, setConsecBalanceInput] = useState<string>(
    String(Math.round(activeBalance))
  );
  const [consecRiskInput, setConsecRiskInput] = useState<string>(
    String(settings.defaultRiskPercent || 1)
  );
  const [consecMethod, setConsecMethod] = useState<ConsecutiveLossMethod>(
    'PERCENT_RUNNING_EQUITY'
  );
  const [consecCountInput, setConsecCountInput] = useState<string>('5');

  const consecInitialBalance = Math.max(0, parseFloat(consecBalanceInput) || 0);
  const consecRiskVal = Math.max(0, parseFloat(consecRiskInput) || 0);
  const consecLossesCount = Math.max(1, Math.min(50, parseInt(consecCountInput, 10) || 1));

  const effectiveConsecRiskParam =
    consecMethod === 'PERCENT_RUNNING_EQUITY'
      ? consecRiskVal
      : (consecInitialBalance * consecRiskVal) / 100;

  const consecSteps = useMemo(() => {
    if (consecInitialBalance <= 0) return [];
    return simulateConsecutiveLosses(
      consecInitialBalance,
      effectiveConsecRiskParam,
      consecLossesCount,
      consecMethod
    );
  }, [consecInitialBalance, effectiveConsecRiskParam, consecLossesCount, consecMethod]);

  const finalConsecStep =
    consecSteps.length > 0 ? consecSteps[consecSteps.length - 1] : undefined;
  const consecRemainingBalance = finalConsecStep
    ? finalConsecStep.remainingEquity
    : consecInitialBalance;
  const consecTotalLoss = Math.max(0, consecInitialBalance - consecRemainingBalance);
  const consecDrawdownPct = finalConsecStep ? finalConsecStep.cumulativeDrawdownPercent : 0;

  // ============================================================================
  // 5. FEATURE 04: EVALUASI DISIPLIN STATE
  // ============================================================================
  const [disciplinePeriod, setDisciplinePeriod] = useState<DisciplinePeriod>('LAST_20');
  const [showDisciplineDetails, setShowDisciplineDetails] = useState<boolean>(false);

  const executedTradesSorted = useMemo(() => {
    const valid = (trades || []).filter(isClosedLifecycleTrade);
    return [...valid].sort((a, b) => {
      const tA = new Date(a.dateTime || 0).getTime();
      const tB = new Date(b.dateTime || 0).getTime();
      return tB - tA; // newest first for slicing
    });
  }, [trades]);

  const filteredDisciplineTrades = useMemo(() => {
    let subset = executedTradesSorted;
    if (disciplinePeriod === 'LAST_20') {
      subset = executedTradesSorted.slice(0, 20);
    } else if (disciplinePeriod === 'LAST_50') {
      subset = executedTradesSorted.slice(0, 50);
    }
    return [...subset].reverse();
  }, [executedTradesSorted, disciplinePeriod]);

  const disciplineEval = useMemo(
    () => evaluateTradingDiscipline(filteredDisciplineTrades, settings),
    [filteredDisciplineTrades, settings]
  );

  return (
    <div className="space-y-6 pb-8">
      {/* ==========================================================================
          1. PAGE HEADER & TOP SUMMARY SECTION (Balance, Daily Loss, Loss Limit, Loss Usage)
         ========================================================================== */}
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-[#DDE3EA] dark:border-white/[0.06]">
          <div>
            <h1 className="text-base sm:text-lg font-bold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F5F9]">
              {tr('Manajemen Risiko', 'Risk Management')}
            </h1>
            <p className="text-xs text-[#697586] dark:text-[#8E98A8] mt-0.5">
              {tr('Kelola risiko trading Anda secara terukur', 'Manage your trading risk')}
            </p>
          </div>

          <div className="text-xs font-mono-numbers tabular-nums text-[#697586] dark:text-[#8E98A8]">
            {tr('Saldo Aktif:', 'Active Balance:')}{' '}
            <strong className="text-[#151D2A] dark:text-[#F2F5F9]">
              {fmtMoney(activeBalance)}
            </strong>
          </div>
        </div>

        {/* 2-Column Top Summary: Left (Balance & Loss Limit) | Right (Daily Loss & Loss Usage) */}
        <div className="grid grid-cols-2 gap-6 pb-5 border-b border-[#DDE3EA] dark:border-white/[0.06]">
          {/* Left Column */}
          <div className="space-y-4 pr-3 sm:pr-6 border-r border-[#DDE3EA] dark:border-white/[0.06]">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8] block mb-1">
                {tr('Saldo', 'Balance')}
              </span>
              <div className="text-xl sm:text-2xl font-bold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9]">
                {fmtMoney(activeBalance)}
              </div>
            </div>

            <div className="pt-3 border-t border-[#DDE3EA] dark:border-white/[0.06]">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8] block mb-1">
                {tr('Batas Rugi Harian', 'Loss Limit')}
              </span>
              <div className="text-lg sm:text-xl font-bold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9]">
                {fmtMoney(configuredDailyLimitAmount)}
              </div>
              <span className="text-[11px] font-mono-numbers tabular-nums text-[#697586] dark:text-[#8E98A8] block mt-0.5">
                {configuredDailyLimitPercent.toFixed(2)}% {tr('dari saldo', 'of balance')}
              </span>
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-4 pl-1 sm:pl-2">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8] block mb-1">
                {tr('Rugi Hari Ini', 'Daily Loss')}
              </span>
              <div
                className={`text-xl sm:text-2xl font-bold font-mono-numbers tabular-nums ${
                  actualDailyLossAmount > 0
                    ? 'text-[#E05260]'
                    : 'text-[#151D2A] dark:text-[#F2F5F9]'
                }`}
              >
                {actualDailyLossAmount > 0
                  ? `-${fmtMoney(actualDailyLossAmount)}`
                  : fmtMoney(0)}
              </div>
              <span className="text-[11px] font-mono-numbers tabular-nums text-[#697586] dark:text-[#8E98A8] block mt-0.5">
                {dailyLossPercentOfBalance.toFixed(2)}% {tr('dari saldo', 'of balance')}
              </span>
            </div>

            <div className="pt-3 border-t border-[#DDE3EA] dark:border-white/[0.06]">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8] block mb-1">
                {tr('Pemakaian Batas Rugi', 'Loss Usage')}
              </span>
              <div
                className={`text-lg sm:text-xl font-bold font-mono-numbers tabular-nums ${
                  isDailyLimitExceeded
                    ? 'text-[#E05260]'
                    : isDailyLimitWarning
                    ? 'text-amber-500'
                    : 'text-[#151D2A] dark:text-[#F2F5F9]'
                }`}
              >
                {riskUsagePercent.toFixed(1)}%
              </div>
              <span className="text-[11px] font-mono-numbers tabular-nums text-[#697586] dark:text-[#8E98A8] block mt-0.5">
                {fmtMoney(actualDailyLossAmount)} / {fmtMoney(configuredDailyLimitAmount)}
              </span>
            </div>
          </div>
        </div>

        {/* Loss Usage Horizontal Progress Indicator */}
        <div className="space-y-2.5 pb-5 border-b border-[#DDE3EA] dark:border-white/[0.06]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8]">
                {tr('Pemakaian Batas Rugi', 'Loss Usage')}
              </span>
              <span className="text-xs font-semibold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9]">
                {fmtMoney(actualDailyLossAmount)} / {fmtMoney(configuredDailyLimitAmount)}
              </span>
            </div>
            <span
              className={`text-xs font-bold font-mono-numbers tabular-nums ${
                isDailyLimitExceeded
                  ? 'text-[#E05260]'
                  : isDailyLimitWarning
                  ? 'text-amber-500'
                  : 'text-[#151D2A] dark:text-[#F2F5F9]'
              }`}
            >
              {riskUsagePercent.toFixed(1)}% {tr('TERPAKAI', 'USED')}
            </span>
          </div>

          <div className="w-full h-2 rounded-full bg-[#DDE3EA] dark:bg-white/[0.07] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ease-out motion-reduce:transition-none ${
                isDailyLimitExceeded
                  ? 'bg-[#E05260]'
                  : isDailyLimitWarning
                  ? 'bg-amber-500'
                  : 'bg-[#3B82F6]'
              }`}
              style={{ width: `${riskUsageBarWidth}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-xs font-mono-numbers tabular-nums text-[#697586] dark:text-[#8E98A8]">
            {isDailyLimitExceeded ? (
              <span className="text-[#E05260] font-semibold">
                {excessDailyLossAmount > 0
                  ? tr(
                      `Batas Rugi Terlampaui (+${fmtMoney(excessDailyLossAmount)})`,
                      `Loss Limit Exceeded (+${fmtMoney(excessDailyLossAmount)})`
                    )
                  : tr('Batas Rugi Tercapai (100% terpakai)', 'Loss Limit Reached (100% used)')}
              </span>
            ) : (
              <span>
                <strong className="text-[#151D2A] dark:text-[#F2F5F9]">
                  {fmtMoney(remainingDailyRiskAmount)}
                </strong>{' '}
                {tr('tersisa', 'remaining')}
              </span>
            )}
            <span>
              {tr('Terpakai:', 'Used:')}{' '}
              <strong className="text-[#151D2A] dark:text-[#F2F5F9]">
                {fmtMoney(actualDailyLossAmount)}
              </strong>
            </span>
          </div>
        </div>

        {/* Conditional In-App Risk Alerts */}
        {isDailyLimitExceeded && stopTradingAlertEnabled && (
          <div className="p-3.5 rounded-xl bg-[#E05260]/10 border border-[#E05260]/30 text-[#E05260] text-xs flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block">
                {tr(
                  'Peringatan Berhenti Trading: Batas Rugi Harian Tercapai',
                  'Stop Trading Alert: Daily Loss Limit Reached'
                )}
              </span>
              <span className="text-[11px] opacity-90">
                {tr(
                  `Kerugian terealisasi hari ini (${fmtMoney(actualDailyLossAmount)}) telah mencapai batas harian Anda (${fmtMoney(configuredDailyLimitAmount)}). Hentikan trading hingga reset harian (${settings.resetTimezone || '00:00 WIB'}).`,
                  `Today's realized loss (${fmtMoney(actualDailyLossAmount)}) has reached your daily limit (${fmtMoney(configuredDailyLimitAmount)}). Pause trading until daily reset (${settings.resetTimezone || '00:00 WIB'}).`
                )}
              </span>
            </div>
          </div>
        )}

        {isDailyLimitWarning && dailyLossAlertEnabled && (
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block">
                {tr(
                  `Peringatan Rugi Harian: ${riskUsagePercent.toFixed(1)}% dari Batas Terpakai`,
                  `Daily Loss Alert: ${riskUsagePercent.toFixed(1)}% of Limit Used`
                )}
              </span>
              <span className="text-[11px] opacity-90">
                {tr(
                  `Sisa kuota risiko harian adalah ${fmtMoney(remainingDailyRiskAmount)}. Kurangi ukuran posisi atau hentikan trading jika kualitas setup rendah.`,
                  `Remaining daily risk allowance is ${fmtMoney(remainingDailyRiskAmount)}. Reduce position size or stop trading if setup quality is low.`
                )}
              </span>
            </div>
          </div>
        )}

        {/* ========================================================================
            2. PILIH FITUR — ROUNDED PILL / DROPDOWN FEATURE NAVIGATION (6 Features)
           ======================================================================== */}
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8]">
              {tr('Pilih Fitur', 'Select Feature')}
            </span>
            {activeTool && (
              <span className="text-[11px] text-[#697586] dark:text-[#8E98A8]">
                {tr('Klik fitur aktif untuk menutup', 'Click active feature to collapse')}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 min-[360px]:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {RISK_TOOLS_META.map((tool) => {
              const isSelected = activeTool === tool.id;
              return (
                <button
                  key={tool.id}
                  type="button"
                  aria-expanded={isSelected}
                  onClick={() => handleToggleTool(tool.id)}
                  className={`group px-4 py-3 rounded-full border text-left transition-all duration-200 flex items-center justify-between gap-2 ${
                    isSelected
                      ? 'bg-[#3B82F6]/12 dark:bg-[#3B82F6]/15 border-[#3B82F6] text-[#151D2A] dark:text-[#F2F5F9]'
                      : 'bg-[#F5F7FA] dark:bg-white/[0.03] border-[#DDE3EA] dark:border-white/[0.08] text-[#151D2A] dark:text-[#D5DCE6] hover:border-[#697586] dark:hover:border-white/[0.18]'
                  }`}
                >
                  <div className="min-w-0">
                    <span className="text-xs font-semibold block truncate">
                      {tr(tool.titleId, tool.titleEn)}
                    </span>
                    <span className="text-[10px] text-[#697586] dark:text-[#8E98A8] block truncate mt-0.5">
                      {tr(tool.subtitleId, tool.subtitleEn)}
                    </span>
                  </div>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none ${
                      isSelected
                        ? 'rotate-180 text-[#3B82F6]'
                        : 'text-[#697586] dark:text-[#8E98A8]'
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ==========================================================================
          FEATURE 01: LOT CALCULATOR & POSITION SIZING (Single-Open Accordion Panel)
         ========================================================================== */}
      {activeTool === 'lot-calc' && (
        <div className="pt-5 border-t border-[#DDE3EA] dark:border-white/[0.06] space-y-6 animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none">
          {/* Header & Segmented Mode Switcher: [ Lot Calculator ] [ Position Sizing ] */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#DDE3EA] dark:border-white/[0.06]">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F5F9]">
                {lotSubMode === 'LOT_CALCULATOR'
                  ? tr('Kalkulator Lot', 'Lot Calculator')
                  : tr('Ukuran Posisi Otomatis', 'Position Sizing')}
              </h2>
              <p className="text-xs text-[#697586] dark:text-[#8E98A8] mt-0.5">
                {lotSubMode === 'LOT_CALCULATOR'
                  ? tr(
                      'Perencana Posisi Manual — Simulasi perencanaan posisi trading dengan ukuran lot manual',
                      'Manual Position Planner — Simulate trading position planning with manual lot size'
                    )
                  : tr(
                      'Penentuan Lot Otomatis — Penentuan ukuran lot otomatis berdasarkan batas risiko akun',
                      'Automatic Position Sizing — Calculate automatic lot size based on account risk limit'
                    )}
              </p>
            </div>

            <div className="inline-grid grid-cols-2 p-1 rounded-full bg-[#F5F7FA] dark:bg-white/[0.04] border border-[#DDE3EA] dark:border-white/[0.08]">
              <button
                type="button"
                onClick={() => setLotSubMode('LOT_CALCULATOR')}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  lotSubMode === 'LOT_CALCULATOR'
                    ? 'bg-[#3B82F6] text-white'
                    : 'text-[#697586] dark:text-[#8E98A8] hover:text-[#151D2A] dark:hover:text-[#F2F5F9]'
                }`}
              >
                {tr('Kalkulator Lot', 'Lot Calculator')}
              </button>
              <button
                type="button"
                onClick={() => setLotSubMode('LOT_SIZING')}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  lotSubMode === 'LOT_SIZING'
                    ? 'bg-[#3B82F6] text-white'
                    : 'text-[#697586] dark:text-[#8E98A8] hover:text-[#151D2A] dark:hover:text-[#F2F5F9]'
                }`}
              >
                {tr('Ukuran Posisi', 'Position Sizing')}
              </button>
            </div>
          </div>

          {/* ====================================================================
              MODE A: LOT CALCULATOR — MANUAL POSITION PLANNER
             ==================================================================== */}
          {lotSubMode === 'LOT_CALCULATOR' ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* LEFT COLUMN: MANUAL POSITION PLANNER FORM */}
              <div className="lg:col-span-6 space-y-4">
                {/* 1. ACCOUNT BALANCE */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8]">
                      {tr('Saldo Akun', 'Account Balance')}
                    </label>
                    <select
                      value={manualBalanceSource}
                      onChange={(e) =>
                        setManualBalanceSource(e.target.value as BalanceSourceOption)
                      }
                      className="rounded-full bg-[#F5F7FA] dark:bg-[#0D1015] border border-[#DDE3EA] dark:border-white/[0.08] px-3 py-1 text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] focus:border-[#3B82F6] focus:outline-none"
                    >
                      <option value="APP_BALANCE">
                        {tr('Saldo Aplikasi', 'App Balance')}
                      </option>
                      <option value="CUSTOM_BALANCE">
                        {tr('Saldo Kustom', 'Custom Balance')}
                      </option>
                    </select>
                  </div>

                  {manualBalanceSource === 'APP_BALANCE' ? (
                    <div className="rounded-xl bg-[#F5F7FA] dark:bg-white/[0.03] border border-[#DDE3EA] dark:border-white/[0.08] px-3.5 py-2.5 flex items-center justify-between">
                      <span className="text-base font-bold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9]">
                        {fmtMoney(activeBalance)}
                      </span>
                      <span className="text-[11px] text-[#697586] dark:text-[#8E98A8]">
                        {tr('Saldo Aplikasi', 'App Balance')}
                      </span>
                    </div>
                  ) : (
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={manualCustomBalanceInput}
                      onChange={(e) => setManualCustomBalanceInput(e.target.value)}
                      className="w-full rounded-xl bg-[#F5F7FA] dark:bg-white/[0.03] border border-[#DDE3EA] dark:border-white/[0.08] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9] focus:border-[#3B82F6] focus:outline-none"
                      placeholder="3000.00"
                    />
                  )}
                </div>

                {/* 2. INSTRUMENT & 3. DIRECTION */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8] mb-1.5">
                      {tr('Instrumen', 'Instrument')}
                    </label>
                    <select
                      value={instrument}
                      onChange={(e) => handleInstrumentChange(e.target.value)}
                      className="w-full rounded-xl bg-[#F5F7FA] dark:bg-[#0D1015] border border-[#DDE3EA] dark:border-white/[0.08] px-3.5 py-2.5 text-sm font-semibold text-[#151D2A] dark:text-[#F2F5F9] focus:border-[#3B82F6] focus:outline-none"
                    >
                      {Object.keys(MT5_SYMBOL_REGISTRY).map((sym) => (
                        <option key={sym} value={sym}>
                          {sym}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8] mb-1.5">
                      {tr('Arah Posisi', 'Direction')}
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleManualDirectionChange('BUY')}
                        className={`py-2.5 px-3 rounded-full border text-xs font-semibold transition-colors ${
                          manualDirection === 'BUY'
                            ? 'bg-[#00A878]/15 text-[#00A878] border-[#00A878]/50'
                            : 'bg-transparent text-[#697586] dark:text-[#8E98A8] border-[#DDE3EA] dark:border-white/[0.08]'
                        }`}
                      >
                        BUY
                      </button>
                      <button
                        type="button"
                        onClick={() => handleManualDirectionChange('SELL')}
                        className={`py-2.5 px-3 rounded-full border text-xs font-semibold transition-colors ${
                          manualDirection === 'SELL'
                            ? 'bg-[#E05260]/15 text-[#E05260] border-[#E05260]/50'
                            : 'bg-transparent text-[#697586] dark:text-[#8E98A8] border-[#DDE3EA] dark:border-white/[0.08]'
                        }`}
                      >
                        SELL
                      </button>
                    </div>
                  </div>
                </div>

                {/* 4. LOT SIZE & 5. ENTRY PRICE */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8]">
                        {tr('Ukuran Lot', 'Lot Size')}
                      </label>
                      <div className="flex items-center gap-1">
                        {MANUAL_LOT_QUICK_OPTIONS.map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setManualLotSizeInput(opt)}
                            className={`px-2 py-0.5 rounded-full text-[10px] font-mono-numbers tabular-nums transition-colors ${
                              parseFloat(manualLotSizeInput) === parseFloat(opt)
                                ? 'bg-[#3B82F6]/15 text-[#3B82F6] border border-[#3B82F6]/30 font-semibold'
                                : 'text-[#697586] dark:text-[#8E98A8] hover:text-[#151D2A] dark:hover:text-[#F2F5F9]'
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>
                    <input
                      type="number"
                      step={manualPositionPlanResult.contractSpec.lotStep}
                      min={manualPositionPlanResult.contractSpec.minLot}
                      max={manualPositionPlanResult.contractSpec.maxLot}
                      value={manualLotSizeInput}
                      onChange={(e) => setManualLotSizeInput(e.target.value)}
                      className="w-full rounded-xl bg-[#F5F7FA] dark:bg-white/[0.03] border border-[#DDE3EA] dark:border-white/[0.08] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9] focus:border-[#3B82F6] focus:outline-none"
                      placeholder="0.01"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8] mb-1.5">
                      {tr('Harga Entry', 'Entry Price')}
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={manualEntryPriceInput}
                      onChange={(e) => setManualEntryPriceInput(e.target.value)}
                      className="w-full rounded-xl bg-[#F5F7FA] dark:bg-white/[0.03] border border-[#DDE3EA] dark:border-white/[0.08] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9] focus:border-[#3B82F6] focus:outline-none"
                    />
                  </div>
                </div>

                {/* 6. STOP LOSS & 7. TAKE PROFIT */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8] mb-1.5">
                      Stop Loss
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={manualStopLossInput}
                      onChange={(e) => setManualStopLossInput(e.target.value)}
                      className="w-full rounded-xl bg-[#F5F7FA] dark:bg-white/[0.03] border border-[#DDE3EA] dark:border-white/[0.08] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9] focus:border-[#3B82F6] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8] mb-1.5">
                      Take Profit
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={manualTakeProfitInput}
                      onChange={(e) => setManualTakeProfitInput(e.target.value)}
                      className="w-full rounded-xl bg-[#F5F7FA] dark:bg-white/[0.03] border border-[#DDE3EA] dark:border-white/[0.08] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9] focus:border-[#3B82F6] focus:outline-none"
                    />
                  </div>
                </div>

                {/* Validation Notice */}
                {(manualPositionPlanResult.lotError ||
                  manualPositionPlanResult.slError ||
                  manualPositionPlanResult.tpError ||
                  manualPositionPlanResult.errorMessage) && (
                  <div className="p-3 rounded-xl bg-[#E05260]/10 border border-[#E05260]/30 text-[#E05260] text-xs flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      {manualPositionPlanResult.lotError ||
                        manualPositionPlanResult.slError ||
                        manualPositionPlanResult.tpError ||
                        manualPositionPlanResult.errorMessage}
                    </span>
                  </div>
                )}
              </div>

              {/* RIGHT COLUMN: POSITION ANALYSIS (Clean Hairline Structure) */}
              <div className="lg:col-span-6 lg:pl-6 lg:border-l lg:border-[#DDE3EA] lg:dark:border-white/[0.06] flex flex-col justify-between space-y-5">
                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-[#DDE3EA] dark:border-white/[0.06]">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F5F9]">
                      {tr('Analisis Posisi', 'Position Analysis')}
                    </span>
                    <span className="text-xs font-mono-numbers tabular-nums text-[#697586] dark:text-[#8E98A8]">
                      {instrument} · {manualDirection} · {manualPositionPlanResult.lotSize || 0} Lot
                    </span>
                  </div>

                  {/* STOP LOSS ANALYSIS */}
                  <div className="space-y-2 pb-4 border-b border-[#DDE3EA] dark:border-white/[0.06]">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#697586] dark:text-[#8E98A8]">
                        {tr('Jarak Stop Loss', 'Stop Loss Distance')}
                      </span>
                      <span className="text-xs font-mono-numbers tabular-nums font-semibold text-[#151D2A] dark:text-[#F2F5F9]">
                        {manualPositionPlanResult.isLotValid &&
                        manualPositionPlanResult.isStopLossValid
                          ? `${manualPositionPlanResult.slDistancePips} pips`
                          : '--'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#697586] dark:text-[#8E98A8]">
                        {tr('Potensi Rugi', 'Potential Loss')}
                      </span>
                      <span className="text-base font-bold font-mono-numbers tabular-nums text-[#E05260]">
                        {manualPositionPlanResult.isLotValid &&
                        manualPositionPlanResult.isStopLossValid
                          ? `-${fmtMoney(manualPositionPlanResult.potentialLossUsd)}`
                          : '--'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#697586] dark:text-[#8E98A8]">
                        {tr('Risiko (% dari Saldo)', 'Risk (% of Balance)')}
                      </span>
                      <span className="text-xs font-semibold font-mono-numbers tabular-nums text-[#E05260]">
                        {manualPositionPlanResult.isLotValid &&
                        manualPositionPlanResult.isStopLossValid
                          ? `${manualPositionPlanResult.riskPercentOfBalance.toFixed(2)}%`
                          : '--'}
                      </span>
                    </div>
                  </div>

                  {/* TAKE PROFIT ANALYSIS */}
                  <div className="space-y-2 pb-4 border-b border-[#DDE3EA] dark:border-white/[0.06]">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#697586] dark:text-[#8E98A8]">
                        {tr('Jarak Take Profit', 'Take Profit Distance')}
                      </span>
                      <span className="text-xs font-mono-numbers tabular-nums font-semibold text-[#151D2A] dark:text-[#F2F5F9]">
                        {manualPositionPlanResult.isLotValid &&
                        manualPositionPlanResult.isTakeProfitValid
                          ? `${manualPositionPlanResult.tpDistancePips} pips`
                          : '--'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#697586] dark:text-[#8E98A8]">
                        {tr('Potensi Profit', 'Potential Profit')}
                      </span>
                      <span className="text-base font-bold font-mono-numbers tabular-nums text-[#00A878]">
                        {manualPositionPlanResult.isLotValid &&
                        manualPositionPlanResult.isTakeProfitValid
                          ? `+${fmtMoney(manualPositionPlanResult.potentialProfitUsd)}`
                          : '--'}
                      </span>
                    </div>
                  </div>

                  {/* RISK / REWARD */}
                  <div className="flex items-center justify-between py-1">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8]">
                      {tr('Risiko / Imbalan (R:R)', 'Risk / Reward')}
                    </span>
                    <span className="text-base font-bold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9]">
                      {manualPositionPlanResult.isLotValid &&
                      manualPositionPlanResult.hasRiskReward
                        ? manualPositionPlanResult.riskRewardFormatted
                        : '--'}
                    </span>
                  </div>
                </div>

                {/* Pre-commission & contract specification footnote */}
                <div className="pt-3 border-t border-[#DDE3EA] dark:border-white/[0.06] space-y-1 text-[11px] text-[#697586] dark:text-[#8E98A8]">
                  <p>
                    {tr(
                      'Hasil merupakan estimasi sebelum biaya komisi dan swap.',
                      'Results are estimates before broker commission and swap fees.'
                    )}
                  </p>
                  <p className="font-mono-numbers tabular-nums">
                    {tr('Kontrak:', 'Contract:')}{' '}
                    {manualPositionPlanResult.contractSpec.contractSize.toLocaleString()} · 1 pip ={' '}
                    {manualPositionPlanResult.contractSpec.pipSize} · {tr('Lot Min:', 'Min Lot:')}{' '}
                    {manualPositionPlanResult.contractSpec.minLot} (Step{' '}
                    {manualPositionPlanResult.contractSpec.lotStep})
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* ====================================================================
               MODE B: POSITION SIZING — AUTOMATIC POSITION SIZING
               ==================================================================== */
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* LEFT COLUMN: AUTOMATIC POSITION SIZING FORM */}
              <div className="lg:col-span-6 space-y-4">
                {/* 1. ACCOUNT BALANCE / EQUITY */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8]">
                      {tr('Basis Modal Akun', 'Account Balance')}
                    </label>
                    <select
                      value={sizingCapitalSource}
                      onChange={(e) =>
                        setSizingCapitalSource(e.target.value as SizingCapitalSourceOption)
                      }
                      className="rounded-full bg-[#F5F7FA] dark:bg-[#0D1015] border border-[#DDE3EA] dark:border-white/[0.08] px-3 py-1 text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] focus:border-[#3B82F6] focus:outline-none"
                    >
                      <option value="APP_EQUITY">{tr('Ekuitas Aplikasi', 'App Equity')}</option>
                      <option value="APP_BALANCE">{tr('Saldo Aplikasi', 'App Balance')}</option>
                      <option value="CUSTOM_BALANCE">{tr('Saldo Kustom', 'Custom Balance')}</option>
                    </select>
                  </div>

                  {sizingCapitalSource !== 'CUSTOM_BALANCE' ? (
                    <div className="rounded-xl bg-[#F5F7FA] dark:bg-white/[0.03] border border-[#DDE3EA] dark:border-white/[0.08] px-3.5 py-2.5 flex items-center justify-between">
                      <span className="text-base font-bold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9]">
                        {fmtMoney(activeBalance)}
                      </span>
                      <span className="text-[11px] text-[#697586] dark:text-[#8E98A8]">
                        {sizingCapitalSource === 'APP_EQUITY'
                          ? tr('Ekuitas Aplikasi', 'App Equity')
                          : tr('Saldo Aplikasi', 'App Balance')}
                      </span>
                    </div>
                  ) : (
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={sizingCustomBalanceInput}
                      onChange={(e) => setSizingCustomBalanceInput(e.target.value)}
                      className="w-full rounded-xl bg-[#F5F7FA] dark:bg-white/[0.03] border border-[#DDE3EA] dark:border-white/[0.08] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9] focus:border-[#3B82F6] focus:outline-none"
                      placeholder="3000.00"
                    />
                  )}
                </div>

                {/* 2. INSTRUMENT & 3. RISK PER TRADE */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8] mb-1.5">
                      {tr('Instrumen', 'Instrument')}
                    </label>
                    <select
                      value={instrument}
                      onChange={(e) => handleInstrumentChange(e.target.value)}
                      className="w-full rounded-xl bg-[#F5F7FA] dark:bg-[#0D1015] border border-[#DDE3EA] dark:border-white/[0.08] px-3.5 py-2.5 text-sm font-semibold text-[#151D2A] dark:text-[#F2F5F9] focus:border-[#3B82F6] focus:outline-none"
                    >
                      {Object.keys(MT5_SYMBOL_REGISTRY).map((sym) => (
                        <option key={sym} value={sym}>
                          {sym}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8]">
                        {tr('Risiko per Trade (%)', 'Risk per Trade (%)')}
                      </label>
                      <div className="flex items-center gap-1">
                        {POSITION_SIZING_RISK_PRESETS.map((pct) => (
                          <button
                            key={pct}
                            type="button"
                            onClick={() => setSizingRiskPercentInput(String(pct))}
                            className={`px-2 py-0.5 rounded-full text-[10px] font-mono-numbers tabular-nums transition-colors ${
                              parseFloat(sizingRiskPercentInput) === pct
                                ? 'bg-[#3B82F6]/15 text-[#3B82F6] border border-[#3B82F6]/30 font-semibold'
                                : 'text-[#697586] dark:text-[#8E98A8] hover:text-[#151D2A] dark:hover:text-[#F2F5F9]'
                            }`}
                          >
                            {pct}%
                          </button>
                        ))}
                      </div>
                    </div>
                    <input
                      type="number"
                      step="0.1"
                      min="0.01"
                      max="100"
                      value={sizingRiskPercentInput}
                      onChange={(e) => setSizingRiskPercentInput(e.target.value)}
                      className="w-full rounded-xl bg-[#F5F7FA] dark:bg-white/[0.03] border border-[#DDE3EA] dark:border-white/[0.08] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9] focus:border-[#3B82F6] focus:outline-none"
                      placeholder="1.00"
                    />
                  </div>
                </div>

                {/* 4. DIRECTION */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8] mb-1.5">
                    {tr('Arah Posisi', 'Direction')}
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleSizingDirectionChange('BUY')}
                      className={`py-2.5 px-3 rounded-full border text-xs font-semibold transition-colors ${
                        sizingDirection === 'BUY'
                          ? 'bg-[#00A878]/15 text-[#00A878] border-[#00A878]/50'
                          : 'bg-transparent text-[#697586] dark:text-[#8E98A8] border-[#DDE3EA] dark:border-white/[0.08]'
                      }`}
                    >
                      BUY
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSizingDirectionChange('SELL')}
                      className={`py-2.5 px-3 rounded-full border text-xs font-semibold transition-colors ${
                        sizingDirection === 'SELL'
                          ? 'bg-[#E05260]/15 text-[#E05260] border-[#E05260]/50'
                          : 'bg-transparent text-[#697586] dark:text-[#8E98A8] border-[#DDE3EA] dark:border-white/[0.08]'
                      }`}
                    >
                      SELL
                    </button>
                  </div>
                </div>

                {/* 5. ENTRY PRICE & 6. STOP LOSS */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8] mb-1.5">
                      {tr('Harga Entry', 'Entry Price')}
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={sizingEntryPriceInput}
                      onChange={(e) => setSizingEntryPriceInput(e.target.value)}
                      className="w-full rounded-xl bg-[#F5F7FA] dark:bg-white/[0.03] border border-[#DDE3EA] dark:border-white/[0.08] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9] focus:border-[#3B82F6] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8] mb-1.5">
                      Stop Loss
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={sizingStopLossInput}
                      onChange={(e) => setSizingStopLossInput(e.target.value)}
                      className="w-full rounded-xl bg-[#F5F7FA] dark:bg-white/[0.03] border border-[#DDE3EA] dark:border-white/[0.08] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9] focus:border-[#3B82F6] focus:outline-none"
                    />
                  </div>
                </div>

                {/* Validation Error Banner */}
                {!automaticSizingResult.isValid && automaticSizingResult.errorMessage && (
                  <div className="p-3 rounded-xl bg-[#E05260]/10 border border-[#E05260]/30 text-[#E05260] text-xs flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{automaticSizingResult.errorMessage}</span>
                  </div>
                )}

                {/* Execution Notice when Raw Lot < Min Lot or > Max Lot */}
                {automaticSizingResult.isValid && automaticSizingResult.executionNotice && (
                  <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs flex items-start gap-2.5">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{automaticSizingResult.executionNotice}</span>
                  </div>
                )}
              </div>

              {/* RIGHT COLUMN: RESULT — AUTOMATIC POSITION SIZING */}
              <div className="lg:col-span-6 lg:pl-6 lg:border-l lg:border-[#DDE3EA] lg:dark:border-white/[0.06] flex flex-col justify-between space-y-5">
                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-[#DDE3EA] dark:border-white/[0.06]">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F5F9]">
                      {tr('Hasil Perhitungan', 'Result')}
                    </span>
                    <span className="text-xs font-mono-numbers tabular-nums text-[#697586] dark:text-[#8E98A8]">
                      {instrument} · {sizingDirection}
                    </span>
                  </div>

                  {/* Recommended Lot */}
                  <div className="pb-4 border-b border-[#DDE3EA] dark:border-white/[0.06]">
                    <span className="text-xs text-[#697586] dark:text-[#8E98A8] block mb-1">
                      {tr('Rekomendasi Lot', 'Recommended Lot')}
                    </span>
                    <div
                      className={`text-2xl sm:text-3xl font-bold font-mono-numbers tabular-nums ${
                        automaticSizingResult.isValid && automaticSizingResult.isExecutable
                          ? 'text-[#3B82F6]'
                          : 'text-amber-500'
                      }`}
                    >
                      {automaticSizingResult.isValid
                        ? automaticSizingResult.isExecutable
                          ? `${automaticSizingResult.recommendedLot.toFixed(2)} Lot`
                          : tr(
                              '0.00 (Tidak dapat dieksekusi < Lot Min)',
                              '0.00 (Not executable < Min Lot)'
                            )
                        : '0.00'}
                    </div>
                    {automaticSizingResult.isValid && (
                      <span className="text-[11px] font-mono-numbers tabular-nums text-[#697586] dark:text-[#8E98A8] block mt-1">
                        {tr('Lot Mentah:', 'Raw Lot:')} {automaticSizingResult.rawLot.toFixed(4)} · Step:{' '}
                        {automaticSizingResult.contractSpec.lotStep} (Floored)
                      </span>
                    )}
                  </div>

                  {/* Breakdown Rows */}
                  <div className="space-y-2.5 text-xs">
                    <div className="flex items-center justify-between py-1.5 border-b border-[#DDE3EA] dark:border-white/[0.06]">
                      <span className="text-[#697586] dark:text-[#8E98A8]">
                        {tr('Nominal Risiko', 'Risk Amount')}
                      </span>
                      <span className="font-mono-numbers tabular-nums font-semibold text-[#151D2A] dark:text-[#F2F5F9]">
                        {fmtMoney(automaticSizingResult.riskAmountUsd)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between py-1.5 border-b border-[#DDE3EA] dark:border-white/[0.06]">
                      <span className="text-[#697586] dark:text-[#8E98A8]">
                        {tr('Risiko Aktual', 'Actual Risk')}
                      </span>
                      <span className="font-mono-numbers tabular-nums font-semibold text-[#E05260]">
                        {automaticSizingResult.isValid
                          ? `${automaticSizingResult.actualRiskPercent.toFixed(2)}% (${fmtMoney(automaticSizingResult.actualLossUsd)})`
                          : '--'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between py-1.5 border-b border-[#DDE3EA] dark:border-white/[0.06]">
                      <span className="text-[#697586] dark:text-[#8E98A8]">
                        {tr('Jarak Stop Loss', 'Stop Loss Distance')}
                      </span>
                      <span className="font-mono-numbers tabular-nums font-semibold text-[#151D2A] dark:text-[#F2F5F9]">
                        {automaticSizingResult.isValid
                          ? `${automaticSizingResult.slDistancePips} pips`
                          : '--'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between py-1.5">
                      <span className="text-[#697586] dark:text-[#8E98A8]">
                        {tr('Batas Risiko Maksimum', 'Maximum Allowed Risk')}
                      </span>
                      <span className="font-mono-numbers tabular-nums font-semibold text-[#151D2A] dark:text-[#F2F5F9]">
                        {automaticSizingResult.maximumAllowedRiskPercent.toFixed(2)}% (
                        {fmtMoney(automaticSizingResult.riskAmountUsd)})
                      </span>
                    </div>
                  </div>
                </div>

                <p className="text-[11px] text-[#697586] dark:text-[#8E98A8] pt-3 border-t border-[#DDE3EA] dark:border-white/[0.06]">
                  {tr(
                    `Rekomendasi Lot selalu dibulatkan ke bawah (floor) sesuai Lot Step (${automaticSizingResult.contractSpec.lotStep}) agar Risiko Aktual tidak pernah melampaui batas risiko yang dipilih.`,
                    `Recommended Lot is always rounded down (floored) to the Lot Step (${automaticSizingResult.contractSpec.lotStep}) so Actual Risk never exceeds your selected risk limit.`
                  )}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==========================================================================
          FEATURE 02: PROTEKSI & ATURAN RISIKO (Single-Open Accordion Panel)
         ========================================================================== */}
      {activeTool === 'protection-rules' && (
        <div className="pt-5 border-t border-[#DDE3EA] dark:border-white/[0.06] space-y-6 animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none">
          <div className="pb-4 border-b border-[#DDE3EA] dark:border-white/[0.06]">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F5F9]">
              {tr('Proteksi & Aturan Risiko', 'Risk Protection & Rules')}
            </h2>
            <p className="text-xs text-[#697586] dark:text-[#8E98A8] mt-0.5">
              {tr('Batas kerugian harian dan pengaturan risiko akun', 'Daily limits and risk settings')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Risk Limit Inputs */}
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8] mb-1.5">
                    {tr('Batas Rugi Harian (%)', 'Daily Loss Limit (%)')}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="100"
                    value={ruleDailyLossPct}
                    onChange={(e) => handleRuleDailyLossPctChange(e.target.value)}
                    className="w-full rounded-xl bg-[#F5F7FA] dark:bg-white/[0.03] border border-[#DDE3EA] dark:border-white/[0.08] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9] focus:border-[#3B82F6] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8] mb-1.5">
                    {tr(
                      `Maksimum Rugi Harian (${settings.currencySymbol})`,
                      `Maximum Daily Loss (${settings.currencySymbol})`
                    )}
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="1"
                    value={ruleDailyLossAmt}
                    onChange={(e) => handleRuleDailyLossAmtChange(e.target.value)}
                    className="w-full rounded-xl bg-[#F5F7FA] dark:bg-white/[0.03] border border-[#DDE3EA] dark:border-white/[0.08] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9] focus:border-[#3B82F6] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8] mb-1.5">
                    {tr('Batas Loss Beruntun (Trade)', 'Consecutive Loss Limit (Trades)')}
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    max="20"
                    value={ruleConsecutiveLosses}
                    onChange={(e) => setRuleConsecutiveLosses(e.target.value)}
                    className="w-full rounded-xl bg-[#F5F7FA] dark:bg-white/[0.03] border border-[#DDE3EA] dark:border-white/[0.08] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9] focus:border-[#3B82F6] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8] mb-1.5">
                    {tr('Maksimum Drawdown (%)', 'Maximum Drawdown (%)')}
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    max="100"
                    value={ruleMaxDrawdownPct}
                    onChange={(e) => setRuleMaxDrawdownPct(e.target.value)}
                    className="w-full rounded-xl bg-[#F5F7FA] dark:bg-white/[0.03] border border-[#DDE3EA] dark:border-white/[0.08] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9] focus:border-[#3B82F6] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8] mb-1.5">
                    {tr('Maks Risiko per Trade (%)', 'Max Risk per Trade (%)')}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="100"
                    value={ruleMaxTradeRiskPct}
                    onChange={(e) => setRuleMaxTradeRiskPct(e.target.value)}
                    className="w-full rounded-xl bg-[#F5F7FA] dark:bg-white/[0.03] border border-[#DDE3EA] dark:border-white/[0.08] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9] focus:border-[#3B82F6] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8] mb-1.5">
                    {tr('Waktu Reset Harian', 'Daily Reset')}
                  </label>
                  <select
                    value={ruleResetTimezone}
                    onChange={(e) => setRuleResetTimezone(e.target.value)}
                    className="w-full rounded-xl bg-[#F5F7FA] dark:bg-[#0D1015] border border-[#DDE3EA] dark:border-white/[0.08] px-3.5 py-2.5 text-sm text-[#151D2A] dark:text-[#F2F5F9] focus:border-[#3B82F6] focus:outline-none"
                  >
                    <option value="WIB (UTC+7)">00:00 WIB (UTC+7)</option>
                    <option value="WITA (UTC+8)">00:00 WITA (UTC+8)</option>
                    <option value="WIT (UTC+9)">00:00 WIT (UTC+9)</option>
                    <option value="UTC (Server)">00:00 UTC (Server)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Alert Settings & Save */}
            <div className="md:pl-6 md:border-l md:border-[#DDE3EA] md:dark:border-white/[0.06] flex flex-col justify-between space-y-5">
              <div className="space-y-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F5F9] block pb-2.5 border-b border-[#DDE3EA] dark:border-white/[0.06]">
                  {tr('Pengaturan Peringatan', 'Alert Settings')}
                </span>

                {/* Daily Loss Alert Toggle */}
                <div className="flex items-center justify-between py-1">
                  <div>
                    <span className="text-xs font-medium text-[#151D2A] dark:text-[#F2F5F9] block">
                      {tr('Peringatan Rugi Harian', 'Daily Loss Alert')}
                    </span>
                    <span className="text-[11px] text-[#697586] dark:text-[#8E98A8]">
                      {tr(
                        'Banner peringatan saat kerugian harian mencapai 75% dari batas harian',
                        'Warning banner when daily loss reaches 75% of daily limit'
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRuleDailyAlertOn((v) => !v)}
                    className={`px-3.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                      ruleDailyAlertOn
                        ? 'bg-[#3B82F6]/15 text-[#3B82F6] border-[#3B82F6]/40'
                        : 'bg-transparent text-[#697586] dark:text-[#8E98A8] border-[#DDE3EA] dark:border-white/[0.08]'
                    }`}
                  >
                    {ruleDailyAlertOn ? tr('AKTIF', 'ON') : tr('NONAKTIF', 'OFF')}
                  </button>
                </div>

                {/* Stop Trading Alert Toggle */}
                <div className="flex items-center justify-between py-1">
                  <div>
                    <span className="text-xs font-medium text-[#151D2A] dark:text-[#F2F5F9] block">
                      {tr('Peringatan Berhenti Trading', 'Stop Trading Alert')}
                    </span>
                    <span className="text-[11px] text-[#697586] dark:text-[#8E98A8]">
                      {tr(
                        'Banner peringatan saat kerugian harian mencapai 100% dari batas harian',
                        'Alert banner when daily loss reaches 100% of daily limit'
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRuleStopAlertOn((v) => !v)}
                    className={`px-3.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                      ruleStopAlertOn
                        ? 'bg-[#3B82F6]/15 text-[#3B82F6] border-[#3B82F6]/40'
                        : 'bg-transparent text-[#697586] dark:text-[#8E98A8] border-[#DDE3EA] dark:border-white/[0.08]'
                    }`}
                  >
                    {ruleStopAlertOn ? tr('AKTIF', 'ON') : tr('NONAKTIF', 'OFF')}
                  </button>
                </div>
              </div>

              <div className="space-y-3 pt-3 border-t border-[#DDE3EA] dark:border-white/[0.06]">
                <button
                  type="button"
                  onClick={handleSaveProtectionRules}
                  className="w-full rounded-full bg-[#3B82F6] hover:bg-[#2563EB] text-white text-xs font-semibold py-2.5 px-4 transition-colors inline-flex items-center justify-center gap-1.5"
                >
                  {rulesSavedFeedback ? (
                    <>
                      <Check className="h-4 w-4" />
                      <span>{tr('Pengaturan Tersimpan', 'Settings Saved')}</span>
                    </>
                  ) : (
                    <span>{tr('Simpan Pengaturan', 'Save Settings')}</span>
                  )}
                </button>

                <p className="text-[11px] text-[#697586] dark:text-[#8E98A8]">
                  {tr(
                    'Catatan: Peringatan proteksi risiko berfungsi sebagai pengingat di dalam aplikasi dan tolok ukur evaluasi disiplin di TradeVault. Fitur ini tidak memblokir order secara otomatis di terminal broker Anda.',
                    'Note: Risk protection alerts operate as in-app warnings and discipline evaluation benchmarks inside TradeVault. They do not automatically block orders at your broker terminal.'
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================================================
          FEATURE 03: SIMULASI LOSS BERUNTUN (Single-Open Accordion Panel)
         ========================================================================== */}
      {activeTool === 'consecutive-loss' && (
        <div className="pt-5 border-t border-[#DDE3EA] dark:border-white/[0.06] space-y-6 animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none">
          <div className="pb-4 border-b border-[#DDE3EA] dark:border-white/[0.06]">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F5F9]">
              {tr('Simulasi Loss Beruntun', 'Consecutive Loss Simulation')}
            </h2>
            <p className="text-xs text-[#697586] dark:text-[#8E98A8] mt-0.5">
              {tr('Simulasi ketahanan modal terhadap kerugian beruntun', 'Consecutive loss simulation')}
            </p>
          </div>

          {/* Input Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8] mb-1.5">
                {tr(`Saldo Awal (${settings.currencySymbol})`, `Initial Balance (${settings.currencySymbol})`)}
              </label>
              <input
                type="number"
                step="any"
                min="0"
                value={consecBalanceInput}
                onChange={(e) => setConsecBalanceInput(e.target.value)}
                className="w-full rounded-xl bg-[#F5F7FA] dark:bg-white/[0.03] border border-[#DDE3EA] dark:border-white/[0.08] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9] focus:border-[#3B82F6] focus:outline-none"
                placeholder="1000"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8] mb-1.5">
                {tr('Risiko per Trade (%)', 'Risk per Trade (%)')}
              </label>
              <input
                type="number"
                step="0.1"
                min="0.01"
                max="100"
                value={consecRiskInput}
                onChange={(e) => setConsecRiskInput(e.target.value)}
                className="w-full rounded-xl bg-[#F5F7FA] dark:bg-white/[0.03] border border-[#DDE3EA] dark:border-white/[0.08] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9] focus:border-[#3B82F6] focus:outline-none"
                placeholder="1"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8] mb-1.5">
                {tr('Metode Risiko', 'Risk Method')}
              </label>
              <select
                value={consecMethod}
                onChange={(e) => setConsecMethod(e.target.value as ConsecutiveLossMethod)}
                className="w-full rounded-xl bg-[#F5F7FA] dark:bg-[#0D1015] border border-[#DDE3EA] dark:border-white/[0.08] px-3.5 py-2.5 text-xs text-[#151D2A] dark:text-[#F2F5F9] focus:border-[#3B82F6] focus:outline-none"
              >
                <option value="PERCENT_RUNNING_EQUITY">
                  {tr('Persentase dari Sisa Saldo', 'Percentage of Remaining Balance')}
                </option>
                <option value="FIXED_NOMINAL">
                  {tr('Nominal Risiko Tetap', 'Fixed Risk Amount')}
                </option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8] mb-1.5">
                {tr('Jumlah Loss Beruntun', 'Number of Losses')}
              </label>
              <input
                type="number"
                step="1"
                min="1"
                max="50"
                value={consecCountInput}
                onChange={(e) => setConsecCountInput(e.target.value)}
                className="w-full rounded-xl bg-[#F5F7FA] dark:bg-white/[0.03] border border-[#DDE3EA] dark:border-white/[0.08] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9] focus:border-[#3B82F6] focus:outline-none"
                placeholder="5"
              />
            </div>

            <div>
              <button
                type="button"
                onClick={() => setConsecCountInput(String(consecLossesCount))}
                className="w-full rounded-full bg-[#3B82F6] hover:bg-[#2563EB] text-white text-xs font-semibold py-2.5 px-4 transition-colors"
              >
                {tr('Simulasikan', 'Simulate')}
              </button>
            </div>
          </div>

          {/* RESULT SUMMARY */}
          <div className="pt-4 border-t border-[#DDE3EA] dark:border-white/[0.06] space-y-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F5F9] block">
              {tr('Hasil Simulasi', 'Result')}
            </span>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-1">
              <div>
                <span className="text-xs text-[#697586] dark:text-[#8E98A8] block mb-1">
                  {tr('Saldo Awal', 'Initial Balance')}
                </span>
                <div className="text-lg font-bold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9]">
                  {fmtMoney(consecInitialBalance)}
                </div>
              </div>

              <div>
                <span className="text-xs text-[#697586] dark:text-[#8E98A8] block mb-1">
                  {tr('Sisa Saldo', 'Remaining Balance')}
                </span>
                <div className="text-lg font-bold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9]">
                  {fmtMoney(consecRemainingBalance)}
                </div>
              </div>

              <div>
                <span className="text-xs text-[#697586] dark:text-[#8E98A8] block mb-1">
                  {tr('Total Kerugian', 'Total Loss')}
                </span>
                <div className="text-lg font-bold font-mono-numbers tabular-nums text-[#E05260]">
                  -{fmtMoney(consecTotalLoss)}
                </div>
              </div>

              <div>
                <span className="text-xs text-[#697586] dark:text-[#8E98A8] block mb-1">
                  Drawdown
                </span>
                <div className="text-lg font-bold font-mono-numbers tabular-nums text-[#E05260]">
                  -{consecDrawdownPct.toFixed(2)}%
                </div>
              </div>
            </div>
          </div>

          {/* BALANCE PROJECTION */}
          <div className="pt-4 border-t border-[#DDE3EA] dark:border-white/[0.06] space-y-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F5F9] block">
              {tr('Proyeksi Saldo', 'Balance Projection')}
            </span>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-[#151D2A] dark:text-[#F2F5F9]">
                <thead className="border-b border-[#DDE3EA] dark:border-white/[0.06] text-[11px] uppercase tracking-wider text-[#697586] dark:text-[#8E98A8]">
                  <tr>
                    <th className="py-2.5 px-3">{tr('Tahap', 'Step')}</th>
                    <th className="py-2.5 px-3 font-mono-numbers">
                      {tr('Rugi per Trade', 'Loss per Trade')}
                    </th>
                    <th className="py-2.5 px-3 font-mono-numbers">
                      {tr('Sisa Saldo', 'Remaining Balance')}
                    </th>
                    <th className="py-2.5 px-3 font-mono-numbers">
                      {tr('Drawdown Kumulatif', 'Cumulative Drawdown')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#DDE3EA] dark:divide-white/[0.05] font-mono-numbers tabular-nums">
                  <tr>
                    <td className="py-2.5 px-3 font-sans font-medium text-[#697586] dark:text-[#8E98A8]">
                      {tr('Awal', 'Initial')}
                    </td>
                    <td className="py-2.5 px-3 text-[#697586] dark:text-[#8E98A8]">--</td>
                    <td className="py-2.5 px-3 font-semibold text-[#151D2A] dark:text-[#F2F5F9]">
                      {fmtMoney(consecInitialBalance)}
                    </td>
                    <td className="py-2.5 px-3 text-[#697586] dark:text-[#8E98A8]">0.00%</td>
                  </tr>
                  {consecSteps.map((step) => (
                    <tr
                      key={step.lossNumber}
                      className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="py-2.5 px-3 font-sans font-medium text-[#151D2A] dark:text-[#F2F5F9]">
                        {tr('Rugi', 'Loss')} {step.lossNumber}
                      </td>
                      <td className="py-2.5 px-3 text-[#E05260]">
                        -{fmtMoney(step.dollarLost)}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-[#151D2A] dark:text-[#F2F5F9]">
                        {fmtMoney(step.remainingEquity)}
                      </td>
                      <td className="py-2.5 px-3 text-[#E05260]">
                        -{step.cumulativeDrawdownPercent.toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================================================
          FEATURE 04: EVALUASI DISIPLIN (Single-Open Accordion Panel)
         ========================================================================== */}
      {activeTool === 'discipline-eval' && (
        <div className="pt-5 border-t border-[#DDE3EA] dark:border-white/[0.06] space-y-6 animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#DDE3EA] dark:border-white/[0.06]">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F5F9]">
                {tr('Evaluasi Disiplin', 'Discipline Evaluation')}
              </h2>
              <p className="text-xs text-[#697586] dark:text-[#8E98A8] mt-0.5">
                {tr('Audit kepatuhan aturan manajemen risiko', 'Trading rule compliance')}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-[#697586] dark:text-[#8E98A8]">
                {tr('Periode Evaluasi', 'Evaluation Period')}
              </label>
              <select
                value={disciplinePeriod}
                onChange={(e) => setDisciplinePeriod(e.target.value as DisciplinePeriod)}
                className="rounded-full bg-[#F5F7FA] dark:bg-[#0D1015] border border-[#DDE3EA] dark:border-white/[0.08] px-3.5 py-1.5 text-xs font-medium text-[#151D2A] dark:text-[#F2F5F9] focus:border-[#3B82F6] focus:outline-none"
              >
                <option value="LAST_20">{tr('20 Trade Terakhir', 'Last 20 Trades')}</option>
                <option value="LAST_50">{tr('50 Trade Terakhir', 'Last 50 Trades')}</option>
                <option value="ALL">{tr('Semua Trade', 'All Trades')}</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Discipline Score */}
            <div className="md:pr-6 md:border-r md:border-[#DDE3EA] md:dark:border-white/[0.06] flex flex-col justify-between space-y-4">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-[#697586] dark:text-[#8E98A8] block mb-2">
                  {tr('Skor Disiplin', 'Discipline Score')}
                </span>
                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-3xl sm:text-4xl font-bold font-mono-numbers tabular-nums ${
                      disciplineEval.disciplineScore >= 80
                        ? 'text-[#00A878]'
                        : disciplineEval.disciplineScore >= 60
                        ? 'text-amber-500'
                        : 'text-[#E05260]'
                    }`}
                  >
                    {disciplineEval.disciplineScore}
                  </span>
                  <span className="text-base font-mono-numbers tabular-nums text-[#697586] dark:text-[#8E98A8]">
                    / 100
                  </span>
                </div>
                <span className="text-xs text-[#697586] dark:text-[#8E98A8] block mt-1">
                  {tr(
                    `Dievaluasi dari ${disciplineEval.totalTradesEvaluated} transaksi di Jurnal Trade (Nilai ${disciplineEval.disciplineGrade})`,
                    `Evaluated from ${disciplineEval.totalTradesEvaluated} trades in Trade Log (Grade ${disciplineEval.disciplineGrade})`
                  )}
                </span>
              </div>

              <div className="pt-3 border-t border-[#DDE3EA] dark:border-white/[0.06] flex items-center justify-between text-xs">
                <span className="text-[#697586] dark:text-[#8E98A8]">
                  {tr('Runtutan Rugi Maks', 'Max Loss Streak')}
                </span>
                <span className="font-mono-numbers tabular-nums font-semibold text-[#151D2A] dark:text-[#F2F5F9]">
                  {disciplineEval.maxConsecutiveLossesEncountered} {tr('trade', 'trades')} (
                  {tr('Batas:', 'Limit:')} {settings.maxConsecutiveLossLimit || 3})
                </span>
              </div>
            </div>

            {/* RULE COMPLIANCE */}
            <div className="md:pr-6 md:border-r md:border-[#DDE3EA] md:dark:border-white/[0.06] space-y-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F5F9] block pb-2 border-b border-[#DDE3EA] dark:border-white/[0.06]">
                {tr('Kepatuhan Aturan', 'Rule Compliance')}
              </span>

              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between py-1.5 border-b border-[#DDE3EA] dark:border-white/[0.06]">
                  <span className="text-[#697586] dark:text-[#8E98A8]">
                    {tr('Risiko per Trade', 'Risk per Trade')}
                  </span>
                  <span className="font-mono-numbers tabular-nums font-semibold text-[#151D2A] dark:text-[#F2F5F9]">
                    {disciplineEval.riskPerTradeCompliantCount ?? 0} / {disciplineEval.totalTradesEvaluated}
                  </span>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-[#DDE3EA] dark:border-white/[0.06]">
                  <span className="text-[#697586] dark:text-[#8E98A8]">
                    {tr('Kepatuhan Stop Loss', 'Stop Loss Compliance')}
                  </span>
                  <span className="font-mono-numbers tabular-nums font-semibold text-[#151D2A] dark:text-[#F2F5F9]">
                    {disciplineEval.stopLossCompliantCount ?? 0} / {disciplineEval.totalTradesEvaluated}
                  </span>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-[#DDE3EA] dark:border-white/[0.06]">
                  <span className="text-[#697586] dark:text-[#8E98A8]">
                    {tr('Rencana Trading', 'Trading Plan')}
                  </span>
                  <span className="font-mono-numbers tabular-nums font-semibold text-[#151D2A] dark:text-[#F2F5F9]">
                    {disciplineEval.tradingPlanCompliantCount ?? 0} / {disciplineEval.totalTradesEvaluated}
                  </span>
                </div>

                <div className="flex items-center justify-between py-1.5">
                  <span className="text-[#697586] dark:text-[#8E98A8]">
                    {tr('Kepatuhan Batas Harian', 'Daily Limit Compliance')}
                  </span>
                  <span className="font-mono-numbers tabular-nums font-semibold text-[#151D2A] dark:text-[#F2F5F9]">
                    {disciplineEval.dailyLimitCompliantCount ?? 0} / {disciplineEval.totalTradesEvaluated}
                  </span>
                </div>
              </div>
            </div>

            {/* RULE VIOLATIONS */}
            <div className="flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F5F9] block pb-2 border-b border-[#DDE3EA] dark:border-white/[0.06]">
                  {tr('Pelanggaran Aturan', 'Rule Violations')}
                </span>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#697586] dark:text-[#8E98A8]">
                    {tr('Total Pelanggaran', 'Total Violations')}
                  </span>
                  <span
                    className={`text-xl font-bold font-mono-numbers tabular-nums ${
                      (disciplineEval.totalViolationsCount ?? 0) > 0
                        ? 'text-[#E05260]'
                        : 'text-[#00A878]'
                    }`}
                  >
                    {disciplineEval.totalViolationsCount ?? 0}
                  </span>
                </div>

                <div className="space-y-1.5 text-xs text-[#697586] dark:text-[#8E98A8]">
                  <div className="flex justify-between">
                    <span>{tr('Melebihi Risiko saat Loss', 'Over-Risk on Losses')}</span>
                    <span className="font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9]">
                      {disciplineEval.overRiskTradesCount}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>{tr('Risiko Rencana Berlebih', 'Excessive Planned Risk')}</span>
                    <span className="font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9]">
                      {disciplineEval.excessiveRiskTradesCount}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>{tr('Pelanggaran Batas Harian', 'Daily Limit Breaches')}</span>
                    <span className="font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9]">
                      {disciplineEval.dailyLossViolationsCount}
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowDisciplineDetails((v) => !v)}
                className="w-full rounded-full border border-[#DDE3EA] dark:border-white/[0.08] bg-transparent hover:border-[#3B82F6] text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] py-2 px-4 transition-colors"
              >
                {showDisciplineDetails
                  ? tr('Sembunyikan Detail', 'Hide Details')
                  : tr('Lihat Detail', 'View Details')}
              </button>
            </div>
          </div>

          {/* Expandable Details Section */}
          {showDisciplineDetails && (
            <div className="pt-4 border-t border-[#DDE3EA] dark:border-white/[0.06] space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {disciplineEval.auditFindings.map((finding, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-xl bg-[#F5F7FA] dark:bg-white/[0.02] border border-[#DDE3EA] dark:border-white/[0.06] space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs font-semibold ${
                          finding.type === 'VIOLATION'
                            ? 'text-[#E05260]'
                            : finding.type === 'WARNING'
                            ? 'text-amber-500'
                            : 'text-[#00A878]'
                        }`}
                      >
                        {finding.title}
                      </span>
                      <span className="text-[10px] uppercase font-mono-numbers tabular-nums text-[#697586] dark:text-[#8E98A8]">
                        {finding.type}
                      </span>
                    </div>
                    <p className="text-xs text-[#697586] dark:text-[#8E98A8] leading-relaxed">
                      {finding.description}
                    </p>
                  </div>
                ))}
              </div>

              {filteredDisciplineTrades.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-[#151D2A] dark:text-[#F2F5F9]">
                    <thead className="border-b border-[#DDE3EA] dark:border-white/[0.06] text-[11px] uppercase tracking-wider text-[#697586] dark:text-[#8E98A8]">
                      <tr>
                        <th className="py-2.5 px-3">{tr('Tanggal', 'Date')}</th>
                        <th className="py-2.5 px-3">{tr('Instrumen', 'Pair')}</th>
                        <th className="py-2.5 px-3 font-mono-numbers">Stop Loss</th>
                        <th className="py-2.5 px-3 font-mono-numbers">
                          {tr('Rencana Risiko', 'Planned Risk')}
                        </th>
                        <th className="py-2.5 px-3 font-mono-numbers">
                          {tr('L/R Terealisasi', 'Realized P/L')}
                        </th>
                        <th className="py-2.5 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#DDE3EA] dark:divide-white/[0.05] font-mono-numbers tabular-nums">
                      {[...filteredDisciplineTrades].reverse().slice(0, 20).map((t) => {
                        const net = computeTradeNetProfit(t);
                        const hasSL = t.stopLoss !== undefined && t.stopLoss > 0;
                        const hasRisk = t.riskAmount !== undefined && t.riskAmount > 0;
                        const isOverRisk =
                          net < 0 && hasRisk && Math.abs(net) > t.riskAmount! * 1.05;
                        const isCompliant = hasSL && !isOverRisk;
                        return (
                          <tr key={t.id}>
                            <td className="py-2 px-3 text-[#697586] dark:text-[#8E98A8]">
                              {(t.dateTime || '').slice(0, 10)}
                            </td>
                            <td className="py-2 px-3 font-sans font-medium">
                              {t.instrument} · {t.position}
                            </td>
                            <td className="py-2 px-3">
                              {hasSL ? t.stopLoss : tr('Tanpa SL', 'Missing')}
                            </td>
                            <td className="py-2 px-3">
                              {hasRisk ? fmtMoney(t.riskAmount!) : '--'}
                            </td>
                            <td
                              className={`py-2 px-3 font-semibold ${
                                net >= 0 ? 'text-[#00A878]' : 'text-[#E05260]'
                              }`}
                            >
                              {preferredCurrency === 'IDR'
                                ? formatTradeFinancial(t, 'netProfit', false, true)
                                : `${net >= 0 ? '+' : '-'}${formatCurrency(Math.abs(net), settings)}`}
                            </td>
                            <td
                              className={`py-2 px-3 font-sans font-semibold ${
                                isCompliant ? 'text-[#00A878]' : 'text-[#E05260]'
                              }`}
                            >
                              {isCompliant
                                ? tr('Patuh', 'Compliant')
                                : isOverRisk
                                ? tr('Melebihi Risiko', 'Over-Risk')
                                : tr('Tanpa SL', 'No SL')}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ==========================================================================
          FEATURE 05: SIMULATOR COMPOUNDING (Mounted with hidden fallback to preserve state)
         ========================================================================== */}
      <div
        className={
          activeTool === 'compounding-calc'
            ? 'pt-5 border-t border-[#DDE3EA] dark:border-white/[0.06] animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none'
            : 'hidden'
        }
      >
        <CompoundingCalculatorTab settings={settings} currentEquity={currentEquity} />
      </div>

      {/* ==========================================================================
          FEATURE 06: SIMULASI BERBASIS TRADE (Mounted with hidden fallback to preserve state)
         ========================================================================== */}
      <div
        className={
          activeTool === 'trade-sim'
            ? 'pt-5 border-t border-[#DDE3EA] dark:border-white/[0.06] animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none'
            : 'hidden'
        }
      >
        <TradeSimulationTab settings={settings} currentEquity={currentEquity} />
      </div>
    </div>
  );
};
