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
import { computeTradeNetProfit, isClosedLifecycleTrade } from '../../utils/calculations';
import { useGlobalCurrency, formatExactCurrency } from '../../utils/currencyRate';
import { useLanguage } from '../../utils/language';
import { CompoundingCalculatorTab } from './CompoundingCalculatorTab';
import { TradeSimulationTab } from './TradeSimulationTab';
import { AlertTriangle, Check, ChevronDown, ArrowRightLeft } from 'lucide-react';

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

const CAPITAL_PRESETS_USD = [
  { label: '$500', value: 500 },
  { label: '$1,000', value: 1000 },
  { label: '$2,500', value: 2500 },
  { label: '$5,000', value: 5000 },
  { label: '$10,000', value: 10000 },
];

const CAPITAL_PRESETS_IDR = [
  { label: 'Rp 5 Jt', value: 5_000_000 },
  { label: 'Rp 10 Jt', value: 10_000_000 },
  { label: 'Rp 25 Jt', value: 25_000_000 },
  { label: 'Rp 50 Jt', value: 50_000_000 },
  { label: 'Rp 100 Jt', value: 100_000_000 },
];

interface InstrumentPreset {
  entry: string;
  slBuy: string;
  tpBuy: string;
  slSell: string;
  tpSell: string;
}

const INSTRUMENT_DEFAULTS: Record<string, InstrumentPreset> = {
  XAUUSD: { entry: '4000.00', slBuy: '3995.00', tpBuy: '4010.00', slSell: '4005.00', tpSell: '3990.00' },
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

function getInstrumentPreset(symbol: string, xauusdPipSize?: number): InstrumentPreset | undefined {
  if (symbol === 'XAUUSD') {
    if (xauusdPipSize === 1.0) {
      return { entry: '4000.00', slBuy: '3950.00', tpBuy: '4100.00', slSell: '4050.00', tpSell: '3900.00' };
    }
    return { entry: '4000.00', slBuy: '3995.00', tpBuy: '4010.00', slSell: '4005.00', tpSell: '3990.00' };
  }
  return INSTRUMENT_DEFAULTS[symbol];
}

function formatMoneyInputForDisplay(rawNumericStr: string, currency: 'USD' | 'IDR'): string {
  if (!rawNumericStr) return '';
  if (currency === 'IDR') {
    const digitsOnly = rawNumericStr.replace(/[^0-9]/g, '');
    if (!digitsOnly) return '';
    return digitsOnly.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  return rawNumericStr;
}

function handleCleanMoneyInput(
  rawVal: string,
  setter: (s: string) => void,
  currency: 'USD' | 'IDR'
): void {
  if (rawVal === '') {
    setter('');
    return;
  }
  if (currency === 'IDR') {
    const digits = rawVal.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
    setter(digits);
    return;
  }
  let cleaned = rawVal.replace(/,/g, '.').replace(/^0+(?=\d)/, '');
  cleaned = cleaned.replace(/[^0-9.]/g, '');
  const parts = cleaned.split('.');
  if (parts.length > 2) {
    cleaned = `${parts[0]}.${parts.slice(1).join('')}`;
  }
  setter(cleaned);
}

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
  const { preferredCurrency, setPreferredCurrency, effectiveRate, formatTradeFinancial } =
    useGlobalCurrency();

  const rate = effectiveRate > 0 ? effectiveRate : 16250;
  const baseIsIdr = settings.currency === 'IDR';
  const initialRiskCurrency: 'USD' | 'IDR' =
    preferredCurrency === 'IDR' || settings.currency === 'IDR' ? 'IDR' : 'USD';
  const [riskCurrency, setRiskCurrency] = useState<'USD' | 'IDR'>(initialRiskCurrency);
  const riskCurrencySymbol = riskCurrency === 'IDR' ? 'Rp' : '$';

  const toUsdFromBase = (rawAppAmt: number) => (baseIsIdr ? rawAppAmt / rate : rawAppAmt);
  const usdToDisplay = (valUsd: number, cur: 'USD' | 'IDR' = riskCurrency) =>
    cur === 'IDR' ? Math.round(valUsd * rate) : Number(valUsd.toFixed(2));
  const displayToUsd = (valInCur: number, cur: 'USD' | 'IDR' = riskCurrency) =>
    cur === 'IDR' ? valInCur / rate : valInCur;
  const usdToSettingsBase = (valUsd: number) =>
    baseIsIdr ? Math.round(valUsd * rate) : Number(valUsd.toFixed(2));

  const fmtMoney = (valUsd: number) =>
    riskCurrency === 'IDR'
      ? formatExactCurrency(Math.round(valUsd * rate), 'IDR')
      : formatExactCurrency(valUsd, 'USD');

  const fmtBaseMoney = (rawAppAmt: number) => {
    if (riskCurrency === 'IDR' && baseIsIdr) {
      return formatExactCurrency(Math.round(rawAppAmt), 'IDR');
    }
    if (riskCurrency === 'USD' && !baseIsIdr) {
      return formatExactCurrency(rawAppAmt, 'USD');
    }
    return fmtMoney(toUsdFromBase(rawAppAmt));
  };

  const buildCrossCurrencyHint = (amountInRiskCur: number): string => {
    if (riskCurrency === 'IDR') {
      const eqUsd = amountInRiskCur / rate;
      return `≈ $${eqUsd.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} USD (${tr('Kurs', 'Rate')} Rp ${Math.round(rate).toLocaleString('id-ID')})`;
    }
    const eqIdr = Math.round(amountInRiskCur * rate);
    return `≈ Rp ${eqIdr.toLocaleString('id-ID')} (${tr('Kurs', 'Rate')} Rp ${Math.round(rate).toLocaleString('id-ID')})`;
  };

  // Single-open accordion state: only one feature open at a time, or null when all closed
  const [activeTool, setActiveTool] = useState<RiskToolTab | null>('lot-calc');

  const handleToggleTool = (toolId: RiskToolTab) => {
    setActiveTool((prev) => (prev === toolId ? null : toolId));
  };

  // Active account balance fallback (stored in settings.currency, normalized to USD)
  const activeBalance = currentEquity > 0 ? currentEquity : settings.startingBalance || 2500;
  const activeBalanceUsd = toUsdFromBase(activeBalance);
  const activeBalanceInRiskCurrency =
    riskCurrency === 'IDR' && baseIsIdr
      ? Math.round(activeBalance)
      : riskCurrency === 'USD' && !baseIsIdr
      ? Number(activeBalance.toFixed(2))
      : usdToDisplay(activeBalanceUsd, riskCurrency);

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
  const initialXauPreset = getInstrumentPreset('XAUUSD', settings.xauusdPipSize)!;
  const [lotSubMode, setLotSubMode] = useState<LotCalculatorSubMode>('LOT_CALCULATOR');
  const [instrument, setInstrument] = useState<string>('XAUUSD');

  // --- Mode A: LOT CALCULATOR (Manual Position Planner) ---
  const [manualBalanceSource, setManualBalanceSource] =
    useState<BalanceSourceOption>('APP_BALANCE');
  const [manualCustomBalanceInput, setManualCustomBalanceInput] = useState<string>(
    String(activeBalanceInRiskCurrency)
  );
  const [manualDirection, setManualDirection] = useState<'BUY' | 'SELL'>('BUY');
  const [manualLotSizeInput, setManualLotSizeInput] = useState<string>('0.01');
  const [manualEntryPriceInput, setManualEntryPriceInput] = useState<string>(
    initialXauPreset.entry
  );
  const [manualStopLossInput, setManualStopLossInput] = useState<string>(initialXauPreset.slBuy);
  const [manualTakeProfitInput, setManualTakeProfitInput] = useState<string>(
    initialXauPreset.tpBuy
  );

  // --- Mode B: LOT SIZING (Automatic Position Sizing) ---
  const [sizingCapitalSource, setSizingCapitalSource] =
    useState<SizingCapitalSourceOption>('APP_EQUITY');
  const [sizingCustomBalanceInput, setSizingCustomBalanceInput] = useState<string>(
    String(activeBalanceInRiskCurrency)
  );
  const [sizingRiskPercentInput, setSizingRiskPercentInput] = useState<string>(
    String(settings.defaultRiskPercent || 1)
  );
  const [sizingDirection, setSizingDirection] = useState<'BUY' | 'SELL'>('BUY');
  const [sizingEntryPriceInput, setSizingEntryPriceInput] = useState<string>(
    initialXauPreset.entry
  );
  const [sizingStopLossInput, setSizingStopLossInput] = useState<string>(initialXauPreset.slBuy);

  // Keep XAUUSD SL/TP aligned with app pip setting (4000 -> 3995 = 50 pips for 0.1, or 4000 -> 3950 = 50 pips for 1.0)
  useEffect(() => {
    if (instrument !== 'XAUUSD') return;
    const preset = getInstrumentPreset('XAUUSD', settings.xauusdPipSize);
    if (!preset) return;
    const isPresetSl = (val: string) =>
      ['3950.00', '3950', '3995.00', '3995', '4050.00', '4050', '4005.00', '4005'].includes(
        val.trim()
      );
    const isPresetTp = (val: string) =>
      ['4100.00', '4100', '4010.00', '4010', '3900.00', '3900', '3990.00', '3990'].includes(
        val.trim()
      );

    if (isPresetSl(manualStopLossInput)) {
      setManualStopLossInput(manualDirection === 'BUY' ? preset.slBuy : preset.slSell);
    }
    if (isPresetTp(manualTakeProfitInput)) {
      setManualTakeProfitInput(manualDirection === 'BUY' ? preset.tpBuy : preset.tpSell);
    }
    if (isPresetSl(sizingStopLossInput)) {
      setSizingStopLossInput(sizingDirection === 'BUY' ? preset.slBuy : preset.slSell);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.xauusdPipSize]);

  const instrumentSpec = useMemo(
    () => getInstrumentPipSpec(instrument, settings),
    [instrument, settings]
  );

  const handleInstrumentChange = (newSymbol: string) => {
    setInstrument(newSymbol);
    const preset = getInstrumentPreset(newSymbol, settings.xauusdPipSize);
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

  const effectiveManualBalanceUsd =
    manualBalanceSource === 'APP_BALANCE'
      ? activeBalanceUsd
      : Math.max(0, displayToUsd(parseFloat(manualCustomBalanceInput) || 0));

  const manualPositionPlanResult = useMemo(() => {
    const slTrim = manualStopLossInput.trim();
    const tpTrim = manualTakeProfitInput.trim();
    return calculateManualPositionPlan(
      {
        balanceSource: manualBalanceSource,
        accountBalance: effectiveManualBalanceUsd,
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
    effectiveManualBalanceUsd,
    instrument,
    manualDirection,
    manualLotSizeInput,
    manualEntryPriceInput,
    manualStopLossInput,
    manualTakeProfitInput,
    settings,
  ]);

  const effectiveSizingBalanceUsd =
    sizingCapitalSource === 'CUSTOM_BALANCE'
      ? Math.max(0, displayToUsd(parseFloat(sizingCustomBalanceInput) || 0))
      : activeBalanceUsd;

  const effectiveSizingBasisType: RiskCapitalBasis =
    sizingCapitalSource === 'APP_EQUITY' ? 'EQUITY' : 'BALANCE';

  const automaticSizingResult = useMemo(() => {
    return calculateAutomaticLotSizing(
      {
        symbol: instrument,
        accountBasisType: effectiveSizingBasisType,
        accountBasisAmount: effectiveSizingBalanceUsd,
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
    effectiveSizingBalanceUsd,
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
  const [ruleDailyLossAmt, setRuleDailyLossAmt] = useState<string>(() => {
    const initUsd = toUsdFromBase(settings.maxDailyLossAmount || 75);
    return String(usdToDisplay(initUsd, initialRiskCurrency));
  });
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
    const initUsd = toUsdFromBase(settings.maxDailyLossAmount || 75);
    setRuleDailyLossAmt(
      String(
        riskCurrency === 'IDR' && baseIsIdr
          ? Math.round(settings.maxDailyLossAmount || 75)
          : usdToDisplay(initUsd, riskCurrency)
      )
    );
    setRuleConsecutiveLosses(String(settings.maxConsecutiveLossLimit || 3));
    setRuleMaxDrawdownPct(String(settings.maxDrawdownLimitPercent || 10));
    setRuleMaxTradeRiskPct(String(settings.maxTradeRiskPercent || 2));
    setRuleResetTimezone(settings.resetTimezone || 'WIB (UTC+7)');
    setRuleDailyAlertOn(settings.dailyLossAlertEnabled !== false);
    setRuleStopAlertOn(settings.stopTradingAlertEnabled !== false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const ruleBaseCapInRiskCur = useMemo(() => {
    const rawBaseCap = settings.startingBalance > 0 ? settings.startingBalance : activeBalance;
    if (riskCurrency === 'IDR' && baseIsIdr) return Math.round(rawBaseCap);
    if (riskCurrency === 'USD' && !baseIsIdr) return Number(rawBaseCap.toFixed(2));
    return usdToDisplay(toUsdFromBase(rawBaseCap), riskCurrency);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.startingBalance, activeBalance, riskCurrency, baseIsIdr, rate]);

  const handleRuleDailyLossPctChange = (val: string) => {
    setRuleDailyLossPct(val);
    const pct = parseFloat(val);
    if (Number.isFinite(pct) && pct >= 0) {
      const nextAmt = (ruleBaseCapInRiskCur * pct) / 100;
      setRuleDailyLossAmt(
        String(riskCurrency === 'IDR' ? Math.round(nextAmt) : Number(nextAmt.toFixed(2)))
      );
    }
  };

  const handleRuleDailyLossAmtChange = (val: string) => {
    handleCleanMoneyInput(
      val,
      (cleaned) => {
        setRuleDailyLossAmt(cleaned);
        const amt = parseFloat(cleaned);
        if (Number.isFinite(amt) && amt >= 0 && ruleBaseCapInRiskCur > 0) {
          setRuleDailyLossPct(String(Number(((amt / ruleBaseCapInRiskCur) * 100).toFixed(2))));
        }
      },
      riskCurrency
    );
  };

  const handleSaveProtectionRules = () => {
    const baseCap = settings.startingBalance > 0 ? settings.startingBalance : activeBalance;
    const maxDailyPct = Math.max(0.1, parseFloat(ruleDailyLossPct) || 3);
    const parsedAmtInRiskCur = parseFloat(ruleDailyLossAmt);
    const maxDailyAmt =
      Number.isFinite(parsedAmtInRiskCur) && parsedAmtInRiskCur > 0
        ? usdToSettingsBase(displayToUsd(parsedAmtInRiskCur))
        : Number(((baseCap * maxDailyPct) / 100).toFixed(baseIsIdr ? 0 : 2));
    const maxConsec = Math.max(1, Math.floor(parseFloat(ruleConsecutiveLosses) || 3));
    const maxDdPct = Math.max(1, parseFloat(ruleMaxDrawdownPct) || 10);
    const maxTradePct = Math.max(0.1, parseFloat(ruleMaxTradeRiskPct) || 2);
    const maxTradeAmt = Number(((baseCap * maxTradePct) / 100).toFixed(baseIsIdr ? 0 : 2));

    onUpdateSettings({
      ...settings,
      maxDailyLossPercent: maxDailyPct,
      maxDailyLossAmount: Math.max(1, maxDailyAmt),
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
    String(
      initialRiskCurrency === 'IDR'
        ? Math.round(activeBalanceInRiskCurrency)
        : Number(activeBalanceInRiskCurrency.toFixed(2))
    )
  );
  const [consecRiskInput, setConsecRiskInput] = useState<string>(
    String(settings.defaultRiskPercent || 1)
  );
  const [consecMethod, setConsecMethod] = useState<ConsecutiveLossMethod>(
    'PERCENT_RUNNING_EQUITY'
  );
  const [consecCountInput, setConsecCountInput] = useState<string>('5');

  const handleRiskCurrencySwitch = (nextCurrency: 'USD' | 'IDR', propagateGlobal = true) => {
    if (nextCurrency === riskCurrency) return;

    const convertField = (rawStr: string, fallbackUsd: number): string => {
      const parsed = Math.max(0, parseFloat(rawStr) || 0);
      if (riskCurrency === 'USD' && nextCurrency === 'IDR') {
        const nextVal = parsed > 0 ? Math.round(parsed * rate) : Math.round(fallbackUsd * rate);
        return String(nextVal);
      }
      if (riskCurrency === 'IDR' && nextCurrency === 'USD') {
        const nextVal = parsed > 0 ? Number((parsed / rate).toFixed(2)) : fallbackUsd;
        return String(nextVal);
      }
      return rawStr;
    };

    setManualCustomBalanceInput((prev) => convertField(prev, 2500));
    setSizingCustomBalanceInput((prev) => convertField(prev, 2500));
    setRuleDailyLossAmt((prev) => convertField(prev, 75));
    setConsecBalanceInput((prev) => convertField(prev, 1000));
    setRiskCurrency(nextCurrency);

    if (propagateGlobal && nextCurrency !== preferredCurrency) {
      setPreferredCurrency(nextCurrency);
    }
  };

  useEffect(() => {
    if (preferredCurrency && preferredCurrency !== riskCurrency) {
      handleRiskCurrencySwitch(preferredCurrency, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferredCurrency]);

  const consecInitialBalance = Math.max(
    0,
    riskCurrency === 'IDR'
      ? Math.round(parseFloat(consecBalanceInput) || 0)
      : parseFloat(consecBalanceInput) || 0
  );
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#E4E4E7] dark:border-[#20252D]">
          <div>
            <h1 className="text-base sm:text-lg font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F2F4F7]">
              {tr('Manajemen Risiko', 'Risk Management')}
            </h1>
            <p className="text-xs text-[#526071] dark:text-[#929BA9] mt-0.5">
              {tr('Kelola risiko trading Anda secara terukur', 'Manage your trading risk')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Global Risk Currency Switcher (USD / IDR) */}
            <div className="inline-flex items-center p-0.5 rounded-full bg-[#F4F4F5] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D]">
              {(['USD', 'IDR'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => handleRiskCurrencySwitch(c, true)}
                  className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40 ${
                    riskCurrency === c
                      ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607]'
                      : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                  }`}
                >
                  {c === 'IDR' ? 'IDR (Rp)' : 'USD ($)'}
                </button>
              ))}
            </div>

            <div className="text-xs font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
              {tr('Saldo Aktif:', 'Active Balance:')}{' '}
              <strong className="text-[#0F172A] dark:text-[#F2F4F7]">
                {fmtBaseMoney(activeBalance)}
              </strong>
            </div>
          </div>
        </div>

        {/* 2-Column Top Summary: Left (Balance & Loss Limit) | Right (Daily Loss & Loss Usage) */}
        <div className="grid grid-cols-2 gap-6 pb-5 border-b border-[#E4E4E7] dark:border-[#20252D]">
          {/* Left Column */}
          <div className="space-y-4 pr-3 sm:pr-6 border-r border-[#E4E4E7] dark:border-[#20252D]">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] block mb-1">
                {tr('Saldo', 'Balance')}
              </span>
              <div className="text-xl sm:text-2xl font-bold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                {fmtBaseMoney(activeBalance)}
              </div>
              <span className="text-[10px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9] block mt-0.5">
                {buildCrossCurrencyHint(activeBalanceInRiskCurrency)}
              </span>
            </div>

            <div className="pt-3 border-t border-[#E4E4E7] dark:border-[#20252D]">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] block mb-1">
                {tr('Batas Rugi Harian', 'Loss Limit')}
              </span>
              <div className="text-lg sm:text-xl font-bold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                {fmtBaseMoney(configuredDailyLimitAmount)}
              </div>
              <span className="text-[11px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9] block mt-0.5">
                {configuredDailyLimitPercent.toFixed(2)}% {tr('dari saldo', 'of balance')}
              </span>
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-4 pl-1 sm:pl-2">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] block mb-1">
                {tr('Rugi Hari Ini', 'Daily Loss')}
              </span>
              <div
                className={`text-xl sm:text-2xl font-bold font-mono-numbers tabular-nums ${
                  actualDailyLossAmount > 0
                    ? 'text-[#E11D48] dark:text-[#E05260]'
                    : 'text-[#0F172A] dark:text-[#F2F4F7]'
                }`}
              >
                {actualDailyLossAmount > 0
                  ? `-${fmtBaseMoney(actualDailyLossAmount)}`
                  : fmtBaseMoney(0)}
              </div>
              <span className="text-[11px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9] block mt-0.5">
                {dailyLossPercentOfBalance.toFixed(2)}% {tr('dari saldo', 'of balance')}
              </span>
            </div>

            <div className="pt-3 border-t border-[#E4E4E7] dark:border-[#20252D]">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] block mb-1">
                {tr('Pemakaian Batas Rugi', 'Loss Usage')}
              </span>
              <div
                className={`text-lg sm:text-xl font-bold font-mono-numbers tabular-nums ${
                  isDailyLimitExceeded
                    ? 'text-[#E11D48] dark:text-[#E05260]'
                    : isDailyLimitWarning
                    ? 'text-[#D97706] dark:text-[#F59E0B]'
                    : 'text-[#0F172A] dark:text-[#F2F4F7]'
                }`}
              >
                {riskUsagePercent.toFixed(1)}%
              </div>
              <span className="text-[11px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9] block mt-0.5">
                {fmtBaseMoney(actualDailyLossAmount)} / {fmtBaseMoney(configuredDailyLimitAmount)}
              </span>
            </div>
          </div>
        </div>

        {/* Loss Usage Horizontal Progress Indicator */}
        <div className="space-y-2.5 pb-5 border-b border-[#E4E4E7] dark:border-[#20252D]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9]">
                {tr('Pemakaian Batas Rugi', 'Loss Usage')}
              </span>
              <span className="text-xs font-semibold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                {fmtBaseMoney(actualDailyLossAmount)} / {fmtBaseMoney(configuredDailyLimitAmount)}
              </span>
            </div>
            <span
              className={`text-xs font-bold font-mono-numbers tabular-nums ${
                isDailyLimitExceeded
                  ? 'text-[#E11D48] dark:text-[#E05260]'
                  : isDailyLimitWarning
                  ? 'text-[#D97706] dark:text-[#F59E0B]'
                  : 'text-[#0F172A] dark:text-[#F2F4F7]'
              }`}
            >
              {riskUsagePercent.toFixed(1)}% {tr('TERPAKAI', 'USED')}
            </span>
          </div>

          <div className="w-full h-2 rounded-full bg-[#F4F4F5] dark:bg-[#20252D] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ease-out motion-reduce:transition-none ${
                isDailyLimitExceeded
                  ? 'bg-[#E11D48] dark:bg-[#E05260]'
                  : isDailyLimitWarning
                  ? 'bg-[#D97706] dark:bg-[#F59E0B]'
                  : 'bg-[#0F172A] dark:bg-[#F2F4F7]'
              }`}
              style={{ width: `${riskUsageBarWidth}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-xs font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
            {isDailyLimitExceeded ? (
              <span className="text-[#E11D48] dark:text-[#E05260] font-semibold">
                {excessDailyLossAmount > 0
                  ? tr(
                      `Batas Rugi Terlampaui (+${fmtBaseMoney(excessDailyLossAmount)})`,
                      `Loss Limit Exceeded (+${fmtBaseMoney(excessDailyLossAmount)})`
                    )
                  : tr('Batas Rugi Tercapai (100% terpakai)', 'Loss Limit Reached (100% used)')}
              </span>
            ) : (
              <span>
                <strong className="text-[#0F172A] dark:text-[#F2F4F7]">
                  {fmtBaseMoney(remainingDailyRiskAmount)}
                </strong>{' '}
                {tr('tersisa', 'remaining')}
              </span>
            )}
            <span>
              {tr('Terpakai:', 'Used:')}{' '}
              <strong className="text-[#0F172A] dark:text-[#F2F4F7]">
                {fmtBaseMoney(actualDailyLossAmount)}
              </strong>
            </span>
          </div>
        </div>

        {/* Conditional In-App Risk Alerts */}
        {isDailyLimitExceeded && stopTradingAlertEnabled && (
          <div className="p-3.5 rounded-xl bg-[#E11D48]/10 dark:bg-[#E05260]/10 border border-[#E11D48]/30 dark:border-[#E05260]/30 text-[#E11D48] dark:text-[#E05260] text-xs flex items-start gap-2.5">
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
                  `Kerugian terealisasi hari ini (${fmtBaseMoney(actualDailyLossAmount)}) telah mencapai batas harian Anda (${fmtBaseMoney(configuredDailyLimitAmount)}). Hentikan trading hingga reset harian (${settings.resetTimezone || '00:00 WIB'}).`,
                  `Today's realized loss (${fmtBaseMoney(actualDailyLossAmount)}) has reached your daily limit (${fmtBaseMoney(configuredDailyLimitAmount)}). Pause trading until daily reset (${settings.resetTimezone || '00:00 WIB'}).`
                )}
              </span>
            </div>
          </div>
        )}

        {isDailyLimitWarning && dailyLossAlertEnabled && (
          <div className="p-3.5 rounded-xl bg-[#D97706]/10 dark:bg-[#F59E0B]/10 border border-[#D97706]/30 dark:border-[#F59E0B]/30 text-[#B45309] dark:text-[#F59E0B] text-xs flex items-start gap-2.5">
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
                  `Sisa kuota risiko harian adalah ${fmtBaseMoney(remainingDailyRiskAmount)}. Kurangi ukuran posisi atau hentikan trading jika kualitas setup rendah.`,
                  `Remaining daily risk allowance is ${fmtBaseMoney(remainingDailyRiskAmount)}. Reduce position size or stop trading if setup quality is low.`
                )}
              </span>
            </div>
          </div>
        )}

        {/* ========================================================================
            2. PILIH FITUR — FEATURE NAVIGATION (6 Features)
           ======================================================================== */}
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9]">
              {tr('Pilih Fitur', 'Select Feature')}
            </span>
            {activeTool && (
              <span className="text-[11px] text-[#526071] dark:text-[#929BA9]">
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
                  className={`group px-4 py-3 rounded-2xl border text-left transition-all duration-200 flex items-center justify-between gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40 ${
                    isSelected
                      ? 'bg-[#0F172A] text-white border-[#0F172A] dark:bg-white dark:text-[#050607] dark:border-white'
                      : 'bg-white dark:bg-[#101318] border-[#E4E4E7] dark:border-[#20252D] text-[#0F172A] dark:text-[#F2F4F7] hover:border-[#526071] dark:hover:border-[#2A313C] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none'
                  }`}
                >
                  <div className="min-w-0">
                    <span className="text-xs font-semibold block truncate">
                      {tr(tool.titleId, tool.titleEn)}
                    </span>
                    <span className={`text-[10px] block truncate mt-0.5 ${isSelected ? 'text-white/75 dark:text-[#050607]/70' : 'text-[#526071] dark:text-[#929BA9]'}`}>
                      {tr(tool.subtitleId, tool.subtitleEn)}
                    </span>
                  </div>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none ${
                      isSelected
                        ? 'rotate-180 text-white dark:text-[#050607]'
                        : 'text-[#526071] dark:text-[#929BA9]'
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
        <div className="pt-5 border-t border-[#E4E4E7] dark:border-[#20252D] space-y-6 animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none">
          {/* Header & Segmented Mode Switcher: [ Lot Calculator ] [ Position Sizing ] */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#E4E4E7] dark:border-[#20252D]">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-[#0F172A] dark:text-[#F2F4F7]">
                {lotSubMode === 'LOT_CALCULATOR'
                  ? tr('Simulasi Lot Manual', 'Manual Lot Simulator')
                  : tr('Hitung Lot Otomatis (% Risiko)', 'Auto Lot Sizing (% Risk)')}
              </h2>
              <p className="text-xs text-[#526071] dark:text-[#929BA9] mt-0.5">
                {lotSubMode === 'LOT_CALCULATOR'
                  ? tr(
                      'Masukkan ukuran Lot pilihan Anda → cek nominal potensi Rugi ($) & Profit ($) sebelum entry',
                      'Enter your chosen Lot size → check exact $ Risk & $ Profit before entering a trade'
                    )
                  : tr(
                      'Masukkan batas % risiko akun → dapatkan ukuran Lot ideal secara otomatis sesuai jarak Stop Loss',
                      'Enter your account % risk limit → automatically get the ideal Lot size for your Stop Loss distance'
                    )}
              </p>
            </div>

            <div className="inline-grid grid-cols-2 p-1 rounded-full bg-[#F4F4F5] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D]">
              <button
                type="button"
                onClick={() => setLotSubMode('LOT_CALCULATOR')}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40 ${
                  lotSubMode === 'LOT_CALCULATOR'
                    ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607]'
                    : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                }`}
              >
                {tr('Simulasi Lot', 'Lot Simulator')}
              </button>
              <button
                type="button"
                onClick={() => setLotSubMode('LOT_SIZING')}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40 ${
                  lotSubMode === 'LOT_SIZING'
                    ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607]'
                    : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                }`}
              >
                {tr('Cari Lot (% Risiko)', 'Auto Lot (% Risk)')}
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
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9]">
                      {tr(`Saldo Akun (${riskCurrencySymbol})`, `Account Balance (${riskCurrencySymbol})`)}
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          handleRiskCurrencySwitch(riskCurrency === 'IDR' ? 'USD' : 'IDR', true)
                        }
                        className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#0F172A] dark:text-[#F2F4F7] hover:underline cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                        title={tr(
                          'Ubah mata uang dan konversi otomatis',
                          'Switch currency and convert automatically'
                        )}
                      >
                        <ArrowRightLeft className="w-3 h-3" />
                        <span>
                          {tr('Ke', 'To')} {riskCurrency === 'IDR' ? 'USD' : 'IDR'}
                        </span>
                      </button>
                      <select
                        value={manualBalanceSource}
                        onChange={(e) =>
                          setManualBalanceSource(e.target.value as BalanceSourceOption)
                        }
                        className="rounded-full bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] px-3 py-1 text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                      >
                        <option value="APP_BALANCE">
                          {tr('Saldo Aplikasi', 'App Balance')}
                        </option>
                        <option value="CUSTOM_BALANCE">
                          {tr('Saldo Kustom', 'Custom Balance')}
                        </option>
                      </select>
                    </div>
                  </div>

                  {manualBalanceSource === 'APP_BALANCE' ? (
                    <div className="rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <div>
                        <span className="text-base font-bold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] block">
                          {fmtBaseMoney(activeBalance)}
                        </span>
                        <span className="text-[10px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                          {buildCrossCurrencyHint(activeBalanceInRiskCurrency)}
                        </span>
                      </div>
                      <span className="text-[11px] text-[#526071] dark:text-[#929BA9] shrink-0">
                        {tr('Saldo Aplikasi', 'App Balance')}
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="relative">
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold font-mono-numbers text-[#526071] dark:text-[#929BA9] pointer-events-none">
                          {riskCurrencySymbol}
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={formatMoneyInputForDisplay(manualCustomBalanceInput, riskCurrency)}
                          onChange={(e) =>
                            handleCleanMoneyInput(
                              e.target.value,
                              setManualCustomBalanceInput,
                              riskCurrency
                            )
                          }
                          className={`w-full rounded-xl bg-white dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none ${
                            riskCurrency === 'IDR' ? 'pl-9' : 'pl-7'
                          } pr-3.5 py-2.5 text-sm font-semibold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40`}
                          placeholder={riskCurrency === 'IDR' ? '25.000.000' : '2500'}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        {(riskCurrency === 'IDR' ? CAPITAL_PRESETS_IDR : CAPITAL_PRESETS_USD).map(
                          (preset) => {
                            const currentNum = parseFloat(manualCustomBalanceInput) || 0;
                            const isSelected = Math.abs(currentNum - preset.value) < 0.01;
                            return (
                              <button
                                key={preset.label}
                                type="button"
                                onClick={() => setManualCustomBalanceInput(String(preset.value))}
                                className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono-numbers tabular-nums transition-colors border cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40 ${
                                  isSelected
                                    ? 'bg-[#0F172A] text-white border-[#0F172A] dark:bg-white dark:text-[#050607] dark:border-white'
                                    : 'bg-transparent text-[#526071] dark:text-[#929BA9] border-[#E4E4E7] dark:border-[#20252D] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                                }`}
                              >
                                {preset.label}
                              </button>
                            );
                          }
                        )}
                      </div>
                      <p className="text-[10px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                        {buildCrossCurrencyHint(parseFloat(manualCustomBalanceInput) || 0)}
                      </p>
                    </div>
                  )}
                </div>

                {/* 2. INSTRUMENT & 3. DIRECTION */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] mb-1.5">
                      {tr('Instrumen', 'Instrument')}
                    </label>
                    <select
                      value={instrument}
                      onChange={(e) => handleInstrumentChange(e.target.value)}
                      className="w-full rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3.5 py-2.5 text-sm font-semibold text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                    >
                      {Object.keys(MT5_SYMBOL_REGISTRY).map((sym) => (
                        <option key={sym} value={sym}>
                          {sym}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] mb-1.5">
                      {tr('Arah Posisi', 'Direction')}
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleManualDirectionChange('BUY')}
                        className={`py-2.5 px-3 rounded-full border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40 ${
                          manualDirection === 'BUY'
                            ? 'bg-[#059669]/12 dark:bg-[#00A878]/15 text-[#059669] dark:text-[#00A878] border-[#059669]/45 dark:border-[#00A878]/50'
                            : 'bg-white dark:bg-[#101318] text-[#526071] dark:text-[#929BA9] border-[#E4E4E7] dark:border-[#20252D] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                        }`}
                      >
                        BUY
                      </button>
                      <button
                        type="button"
                        onClick={() => handleManualDirectionChange('SELL')}
                        className={`py-2.5 px-3 rounded-full border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40 ${
                          manualDirection === 'SELL'
                            ? 'bg-[#E11D48]/12 dark:bg-[#E05260]/15 text-[#E11D48] dark:text-[#E05260] border-[#E11D48]/45 dark:border-[#E05260]/50'
                            : 'bg-white dark:bg-[#101318] text-[#526071] dark:text-[#929BA9] border-[#E4E4E7] dark:border-[#20252D] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
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
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9]">
                        {tr('Ukuran Lot', 'Lot Size')}
                      </label>
                      <div className="flex items-center gap-1">
                        {MANUAL_LOT_QUICK_OPTIONS.map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setManualLotSizeInput(opt)}
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono-numbers tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40 ${
                              parseFloat(manualLotSizeInput) === parseFloat(opt)
                                ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607] font-semibold'
                                : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
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
                      className="w-full rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                      placeholder="0.01"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] mb-1.5">
                      {tr('Harga Entry', 'Entry Price')}
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={manualEntryPriceInput}
                      onChange={(e) => setManualEntryPriceInput(e.target.value)}
                      className="w-full rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                    />
                  </div>
                </div>

                {/* 6. STOP LOSS & 7. TAKE PROFIT */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] mb-1.5">
                      Stop Loss
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={manualStopLossInput}
                      onChange={(e) => setManualStopLossInput(e.target.value)}
                      className="w-full rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] mb-1.5">
                      Take Profit
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={manualTakeProfitInput}
                      onChange={(e) => setManualTakeProfitInput(e.target.value)}
                      className="w-full rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                    />
                  </div>
                </div>

                {/* Validation Notice */}
                {(manualPositionPlanResult.lotError ||
                  manualPositionPlanResult.slError ||
                  manualPositionPlanResult.tpError ||
                  manualPositionPlanResult.errorMessage) && (
                  <div className="p-3 rounded-xl bg-[#E11D48]/10 dark:bg-[#E05260]/10 border border-[#E11D48]/30 dark:border-[#E05260]/30 text-[#E11D48] dark:text-[#E05260] text-xs flex items-start gap-2">
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
              <div className="lg:col-span-6 lg:pl-6 lg:border-l lg:border-[#E4E4E7] lg:dark:border-[#20252D] flex flex-col justify-between space-y-5">
                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-[#E4E4E7] dark:border-[#20252D]">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#0F172A] dark:text-[#F2F4F7]">
                      {tr('Analisis Posisi', 'Position Analysis')}
                    </span>
                    <span className="text-xs font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                      {instrument} · {manualDirection} · {manualPositionPlanResult.lotSize || 0} Lot
                    </span>
                  </div>

                  {/* STOP LOSS ANALYSIS */}
                  <div className="space-y-2 pb-4 border-b border-[#E4E4E7] dark:border-[#20252D]">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#526071] dark:text-[#929BA9]">
                        {tr('Jarak Stop Loss', 'Stop Loss Distance')}
                      </span>
                      <span className="text-xs font-mono-numbers tabular-nums font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                        {manualPositionPlanResult.isLotValid &&
                        manualPositionPlanResult.isStopLossValid
                          ? `${manualPositionPlanResult.slDistancePips} pips`
                          : '--'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#526071] dark:text-[#929BA9]">
                        {tr('Potensi Rugi', 'Potential Loss')}
                      </span>
                      <span className="text-base font-bold font-mono-numbers tabular-nums text-[#E11D48] dark:text-[#E05260]">
                        {manualPositionPlanResult.isLotValid &&
                        manualPositionPlanResult.isStopLossValid
                          ? `-${fmtMoney(manualPositionPlanResult.potentialLossUsd)}`
                          : '--'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#526071] dark:text-[#929BA9]">
                        {tr('Risiko (% dari Saldo)', 'Risk (% of Balance)')}
                      </span>
                      <span className="text-xs font-semibold font-mono-numbers tabular-nums text-[#E11D48] dark:text-[#E05260]">
                        {manualPositionPlanResult.isLotValid &&
                        manualPositionPlanResult.isStopLossValid
                          ? `${manualPositionPlanResult.riskPercentOfBalance.toFixed(2)}%`
                          : '--'}
                      </span>
                    </div>
                  </div>

                  {/* TAKE PROFIT ANALYSIS */}
                  <div className="space-y-2 pb-4 border-b border-[#E4E4E7] dark:border-[#20252D]">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#526071] dark:text-[#929BA9]">
                        {tr('Jarak Take Profit', 'Take Profit Distance')}
                      </span>
                      <span className="text-xs font-mono-numbers tabular-nums font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                        {manualPositionPlanResult.isLotValid &&
                        manualPositionPlanResult.isTakeProfitValid
                          ? `${manualPositionPlanResult.tpDistancePips} pips`
                          : '--'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#526071] dark:text-[#929BA9]">
                        {tr('Potensi Profit', 'Potential Profit')}
                      </span>
                      <span className="text-base font-bold font-mono-numbers tabular-nums text-[#059669] dark:text-[#00A878]">
                        {manualPositionPlanResult.isLotValid &&
                        manualPositionPlanResult.isTakeProfitValid
                          ? `+${fmtMoney(manualPositionPlanResult.potentialProfitUsd)}`
                          : '--'}
                      </span>
                    </div>
                  </div>

                  {/* RISK / REWARD */}
                  <div className="flex items-center justify-between py-1">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9]">
                      {tr('Risiko / Imbalan (R:R)', 'Risk / Reward')}
                    </span>
                    <span className="text-base font-bold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                      {manualPositionPlanResult.isLotValid &&
                      manualPositionPlanResult.hasRiskReward
                        ? manualPositionPlanResult.riskRewardFormatted
                        : '--'}
                    </span>
                  </div>
                </div>

                {/* Pre-commission & contract specification footnote */}
                <div className="pt-3 border-t border-[#E4E4E7] dark:border-[#20252D] space-y-1 text-[11px] text-[#526071] dark:text-[#929BA9]">
                  <p>
                    {tr(
                      'Hasil merupakan estimasi sebelum biaya komisi dan swap.',
                      'Results are estimates before broker commission and swap fees.'
                    )}
                  </p>
                  <p className="font-mono-numbers tabular-nums">
                    {tr('Kontrak:', 'Contract:')}{' '}
                    {manualPositionPlanResult.contractSpec.contractSize.toLocaleString()} · 1 pip ={' '}
                    {manualPositionPlanResult.contractSpec.pipSize}
                    {instrument === 'XAUUSD' &&
                      (manualPositionPlanResult.contractSpec.pipSize === 1.0
                        ? ' (4000 → 3950 = 50 pips)'
                        : ' (4000 → 3995 = 50 pips)')}{' '}
                    · {tr('Lot Min:', 'Min Lot:')}{' '}
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
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9]">
                      {tr(
                        `Basis Modal Akun (${riskCurrencySymbol})`,
                        `Account Balance (${riskCurrencySymbol})`
                      )}
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          handleRiskCurrencySwitch(riskCurrency === 'IDR' ? 'USD' : 'IDR', true)
                        }
                        className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#0F172A] dark:text-[#F2F4F7] hover:underline cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                        title={tr(
                          'Ubah mata uang dan konversi otomatis',
                          'Switch currency and convert automatically'
                        )}
                      >
                        <ArrowRightLeft className="w-3 h-3" />
                        <span>
                          {tr('Ke', 'To')} {riskCurrency === 'IDR' ? 'USD' : 'IDR'}
                        </span>
                      </button>
                      <select
                        value={sizingCapitalSource}
                        onChange={(e) =>
                          setSizingCapitalSource(e.target.value as SizingCapitalSourceOption)
                        }
                        className="rounded-full bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none px-3 py-1 text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                      >
                        <option value="APP_EQUITY">{tr('Ekuitas Aplikasi', 'App Equity')}</option>
                        <option value="APP_BALANCE">{tr('Saldo Aplikasi', 'App Balance')}</option>
                        <option value="CUSTOM_BALANCE">{tr('Saldo Kustom', 'Custom Balance')}</option>
                      </select>
                    </div>
                  </div>

                  {sizingCapitalSource !== 'CUSTOM_BALANCE' ? (
                    <div className="rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <div>
                        <span className="text-base font-bold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] block">
                          {fmtBaseMoney(activeBalance)}
                        </span>
                        <span className="text-[10px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                          {buildCrossCurrencyHint(activeBalanceInRiskCurrency)}
                        </span>
                      </div>
                      <span className="text-[11px] text-[#526071] dark:text-[#929BA9] shrink-0">
                        {sizingCapitalSource === 'APP_EQUITY'
                          ? tr('Ekuitas Aplikasi', 'App Equity')
                          : tr('Saldo Aplikasi', 'App Balance')}
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="relative">
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold font-mono-numbers text-[#526071] dark:text-[#929BA9] pointer-events-none">
                          {riskCurrencySymbol}
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={formatMoneyInputForDisplay(sizingCustomBalanceInput, riskCurrency)}
                          onChange={(e) =>
                            handleCleanMoneyInput(
                              e.target.value,
                              setSizingCustomBalanceInput,
                              riskCurrency
                            )
                          }
                          className={`w-full rounded-xl bg-white dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none ${
                            riskCurrency === 'IDR' ? 'pl-9' : 'pl-7'
                          } pr-3.5 py-2.5 text-sm font-semibold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40`}
                          placeholder={riskCurrency === 'IDR' ? '25.000.000' : '2500'}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        {(riskCurrency === 'IDR' ? CAPITAL_PRESETS_IDR : CAPITAL_PRESETS_USD).map(
                          (preset) => {
                            const currentNum = parseFloat(sizingCustomBalanceInput) || 0;
                            const isSelected = Math.abs(currentNum - preset.value) < 0.01;
                            return (
                              <button
                                key={preset.label}
                                type="button"
                                onClick={() => setSizingCustomBalanceInput(String(preset.value))}
                                className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono-numbers tabular-nums transition-colors border cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40 ${
                                  isSelected
                                    ? 'bg-[#0F172A] text-white border-[#0F172A] dark:bg-white dark:text-[#050607] dark:border-white'
                                    : 'bg-transparent text-[#526071] dark:text-[#929BA9] border-[#E4E4E7] dark:border-[#20252D] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                                }`}
                              >
                                {preset.label}
                              </button>
                            );
                          }
                        )}
                      </div>
                      <p className="text-[10px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                        {buildCrossCurrencyHint(parseFloat(sizingCustomBalanceInput) || 0)}
                      </p>
                    </div>
                  )}
                </div>

                {/* 2. INSTRUMENT & 3. RISK PER TRADE */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] mb-1.5">
                      {tr('Instrumen', 'Instrument')}
                    </label>
                    <select
                      value={instrument}
                      onChange={(e) => handleInstrumentChange(e.target.value)}
                      className="w-full rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3.5 py-2.5 text-sm font-semibold text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
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
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9]">
                        {tr('Risiko per Trade (%)', 'Risk per Trade (%)')}
                      </label>
                      <div className="flex items-center gap-1">
                        {POSITION_SIZING_RISK_PRESETS.map((pct) => (
                          <button
                            key={pct}
                            type="button"
                            onClick={() => setSizingRiskPercentInput(String(pct))}
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono-numbers tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40 ${
                              parseFloat(sizingRiskPercentInput) === pct
                                ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607] font-semibold'
                                : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
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
                      className="w-full rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                      placeholder="1.00"
                    />
                  </div>
                </div>

                {/* 4. DIRECTION */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] mb-1.5">
                    {tr('Arah Posisi', 'Direction')}
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleSizingDirectionChange('BUY')}
                      className={`py-2.5 px-3 rounded-full border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40 ${
                        sizingDirection === 'BUY'
                          ? 'bg-[#059669]/12 dark:bg-[#00A878]/15 text-[#059669] dark:text-[#00A878] border-[#059669]/45 dark:border-[#00A878]/50'
                          : 'bg-white dark:bg-[#101318] text-[#526071] dark:text-[#929BA9] border-[#E4E4E7] dark:border-[#20252D] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                      }`}
                    >
                      BUY
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSizingDirectionChange('SELL')}
                      className={`py-2.5 px-3 rounded-full border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40 ${
                        sizingDirection === 'SELL'
                          ? 'bg-[#E11D48]/12 dark:bg-[#E05260]/15 text-[#E11D48] dark:text-[#E05260] border-[#E11D48]/45 dark:border-[#E05260]/50'
                          : 'bg-white dark:bg-[#101318] text-[#526071] dark:text-[#929BA9] border-[#E4E4E7] dark:border-[#20252D] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                      }`}
                    >
                      SELL
                    </button>
                  </div>
                </div>

                {/* 5. ENTRY PRICE & 6. STOP LOSS */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] mb-1.5">
                      {tr('Harga Entry', 'Entry Price')}
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={sizingEntryPriceInput}
                      onChange={(e) => setSizingEntryPriceInput(e.target.value)}
                      className="w-full rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] mb-1.5">
                      Stop Loss
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={sizingStopLossInput}
                      onChange={(e) => setSizingStopLossInput(e.target.value)}
                      className="w-full rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                    />
                  </div>
                </div>

                {/* Validation Error Banner */}
                {!automaticSizingResult.isValid && automaticSizingResult.errorMessage && (
                  <div className="p-3 rounded-xl bg-[#E11D48]/10 dark:bg-[#E05260]/10 border border-[#E11D48]/30 dark:border-[#E05260]/30 text-[#E11D48] dark:text-[#E05260] text-xs flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{automaticSizingResult.errorMessage}</span>
                  </div>
                )}

                {/* Execution Notice when Raw Lot < Min Lot or > Max Lot */}
                {automaticSizingResult.isValid && automaticSizingResult.executionNotice && (
                  <div className="p-3.5 rounded-xl bg-[#D97706]/10 dark:bg-[#F59E0B]/10 border border-[#D97706]/30 dark:border-[#F59E0B]/30 text-[#B45309] dark:text-[#F59E0B] text-xs flex items-start gap-2.5">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{automaticSizingResult.executionNotice}</span>
                  </div>
                )}
              </div>

              {/* RIGHT COLUMN: RESULT — AUTOMATIC POSITION SIZING */}
              <div className="lg:col-span-6 lg:pl-6 lg:border-l lg:border-[#E4E4E7] lg:dark:border-[#20252D] flex flex-col justify-between space-y-5">
                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-[#E4E4E7] dark:border-[#20252D]">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#0F172A] dark:text-[#F2F4F7]">
                      {tr('Hasil Perhitungan', 'Result')}
                    </span>
                    <span className="text-xs font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                      {instrument} · {sizingDirection}
                    </span>
                  </div>

                  {/* Recommended Lot */}
                  <div className="pb-4 border-b border-[#E4E4E7] dark:border-[#20252D]">
                    <span className="text-xs text-[#526071] dark:text-[#929BA9] block mb-1">
                      {tr('Rekomendasi Lot', 'Recommended Lot')}
                    </span>
                    <div
                      className={`text-2xl sm:text-3xl font-bold font-mono-numbers tabular-nums ${
                        automaticSizingResult.isValid && automaticSizingResult.isExecutable
                          ? 'text-[#0F172A] dark:text-[#F2F4F7]'
                          : 'text-[#D97706] dark:text-[#F59E0B]'
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
                      <span className="text-[11px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9] block mt-1">
                        {tr('Lot Mentah:', 'Raw Lot:')} {automaticSizingResult.rawLot.toFixed(4)} · Step:{' '}
                        {automaticSizingResult.contractSpec.lotStep} (Floored)
                      </span>
                    )}
                  </div>

                  {/* Breakdown Rows */}
                  <div className="space-y-2.5 text-xs">
                    <div className="flex items-center justify-between py-1.5 border-b border-[#E4E4E7] dark:border-[#20252D]">
                      <span className="text-[#526071] dark:text-[#929BA9]">
                        {tr('Nominal Risiko', 'Risk Amount')}
                      </span>
                      <span className="font-mono-numbers tabular-nums font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                        {fmtMoney(automaticSizingResult.riskAmountUsd)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between py-1.5 border-b border-[#E4E4E7] dark:border-[#20252D]">
                      <span className="text-[#526071] dark:text-[#929BA9]">
                        {tr('Risiko Aktual', 'Actual Risk')}
                      </span>
                      <span className="font-mono-numbers tabular-nums font-semibold text-[#E11D48] dark:text-[#E05260]">
                        {automaticSizingResult.isValid
                          ? `${automaticSizingResult.actualRiskPercent.toFixed(2)}% (${fmtMoney(automaticSizingResult.actualLossUsd)})`
                          : '--'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between py-1.5 border-b border-[#E4E4E7] dark:border-[#20252D]">
                      <span className="text-[#526071] dark:text-[#929BA9]">
                        {tr('Jarak Stop Loss', 'Stop Loss Distance')}
                      </span>
                      <span className="font-mono-numbers tabular-nums font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                        {automaticSizingResult.isValid
                          ? `${automaticSizingResult.slDistancePips} pips`
                          : '--'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between py-1.5">
                      <span className="text-[#526071] dark:text-[#929BA9]">
                        {tr('Batas Risiko Maksimum', 'Maximum Allowed Risk')}
                      </span>
                      <span className="font-mono-numbers tabular-nums font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                        {automaticSizingResult.maximumAllowedRiskPercent.toFixed(2)}% (
                        {fmtMoney(automaticSizingResult.riskAmountUsd)})
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-[#E4E4E7] dark:border-[#20252D] space-y-1 text-[11px] text-[#526071] dark:text-[#929BA9]">
                  <p>
                    {tr(
                      `Rekomendasi Lot selalu dibulatkan ke bawah (floor) sesuai Lot Step (${automaticSizingResult.contractSpec.lotStep}) agar Risiko Aktual tidak pernah melampaui batas risiko yang dipilih.`,
                      `Recommended Lot is always rounded down (floored) to the Lot Step (${automaticSizingResult.contractSpec.lotStep}) so Actual Risk never exceeds your selected risk limit.`
                    )}
                  </p>
                  <p className="font-mono-numbers tabular-nums">
                    {tr('Kontrak:', 'Contract:')}{' '}
                    {automaticSizingResult.contractSpec.contractSize.toLocaleString()} · 1 pip ={' '}
                    {automaticSizingResult.contractSpec.pipSize}
                    {instrument === 'XAUUSD' &&
                      (automaticSizingResult.contractSpec.pipSize === 1.0
                        ? ' (4000 → 3950 = 50 pips)'
                        : ' (4000 → 3995 = 50 pips)')}{' '}
                    · {tr('Lot Min:', 'Min Lot:')}{' '}
                    {automaticSizingResult.contractSpec.minLot} (Step{' '}
                    {automaticSizingResult.contractSpec.lotStep})
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==========================================================================
          FEATURE 02: PROTEKSI & ATURAN RISIKO (Single-Open Accordion Panel)
         ========================================================================== */}
      {activeTool === 'protection-rules' && (
        <div className="pt-5 border-t border-[#E4E4E7] dark:border-[#20252D] space-y-6 animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none">
          <div className="pb-4 border-b border-[#E4E4E7] dark:border-[#20252D]">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#0F172A] dark:text-[#F2F4F7]">
              {tr('Proteksi & Aturan Risiko', 'Risk Protection & Rules')}
            </h2>
            <p className="text-xs text-[#526071] dark:text-[#929BA9] mt-0.5">
              {tr('Batas kerugian harian dan pengaturan risiko akun', 'Daily limits and risk settings')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Risk Limit Inputs */}
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] mb-1.5">
                    {tr('Batas Rugi Harian (%)', 'Daily Loss Limit (%)')}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="100"
                    value={ruleDailyLossPct}
                    onChange={(e) => handleRuleDailyLossPctChange(e.target.value)}
                    className="w-full rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9]">
                      {tr(
                        `Maksimum Rugi Harian (${riskCurrencySymbol})`,
                        `Maximum Daily Loss (${riskCurrencySymbol})`
                      )}
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        handleRiskCurrencySwitch(riskCurrency === 'IDR' ? 'USD' : 'IDR', true)
                      }
                      className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#0F172A] dark:text-[#F2F4F7] hover:underline cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                    >
                      <ArrowRightLeft className="w-3 h-3" />
                      <span>
                        {tr('Ke', 'To')} {riskCurrency === 'IDR' ? 'USD' : 'IDR'}
                      </span>
                    </button>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold font-mono-numbers text-[#526071] dark:text-[#929BA9] pointer-events-none">
                      {riskCurrencySymbol}
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formatMoneyInputForDisplay(ruleDailyLossAmt, riskCurrency)}
                      onChange={(e) => handleRuleDailyLossAmtChange(e.target.value)}
                      className={`w-full rounded-xl bg-white dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none ${
                        riskCurrency === 'IDR' ? 'pl-9' : 'pl-7'
                      } pr-3.5 py-2.5 text-sm font-semibold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40`}
                    />
                  </div>
                  <p className="text-[10px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9] mt-1">
                    {buildCrossCurrencyHint(parseFloat(ruleDailyLossAmt) || 0)}
                  </p>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] mb-1.5">
                    {tr('Batas Loss Beruntun (Trade)', 'Consecutive Loss Limit (Trades)')}
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    max="20"
                    value={ruleConsecutiveLosses}
                    onChange={(e) => setRuleConsecutiveLosses(e.target.value)}
                    className="w-full rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] mb-1.5">
                    {tr('Maksimum Drawdown (%)', 'Maximum Drawdown (%)')}
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    max="100"
                    value={ruleMaxDrawdownPct}
                    onChange={(e) => setRuleMaxDrawdownPct(e.target.value)}
                    className="w-full rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] mb-1.5">
                    {tr('Maks Risiko per Trade (%)', 'Max Risk per Trade (%)')}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="100"
                    value={ruleMaxTradeRiskPct}
                    onChange={(e) => setRuleMaxTradeRiskPct(e.target.value)}
                    className="w-full rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] mb-1.5">
                    {tr('Waktu Reset Harian', 'Daily Reset')}
                  </label>
                  <select
                    value={ruleResetTimezone}
                    onChange={(e) => setRuleResetTimezone(e.target.value)}
                    className="w-full rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3.5 py-2.5 text-sm text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
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
            <div className="md:pl-6 md:border-l md:border-[#E4E4E7] md:dark:border-[#20252D] flex flex-col justify-between space-y-5">
              <div className="space-y-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#0F172A] dark:text-[#F2F4F7] block pb-2.5 border-b border-[#E4E4E7] dark:border-[#20252D]">
                  {tr('Pengaturan Peringatan', 'Alert Settings')}
                </span>

                {/* Daily Loss Alert Toggle */}
                <div className="flex items-center justify-between py-1">
                  <div>
                    <span className="text-xs font-medium text-[#0F172A] dark:text-[#F2F4F7] block">
                      {tr('Peringatan Rugi Harian', 'Daily Loss Alert')}
                    </span>
                    <span className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                      {tr(
                        'Banner peringatan saat kerugian harian mencapai 75% dari batas harian',
                        'Warning banner when daily loss reaches 75% of daily limit'
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRuleDailyAlertOn((v) => !v)}
                    className={`px-3.5 py-1 rounded-full text-xs font-semibold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40 ${
                      ruleDailyAlertOn
                        ? 'bg-[#0F172A] text-white border-[#0F172A] dark:bg-white dark:text-[#050607] dark:border-white'
                        : 'bg-transparent text-[#526071] dark:text-[#929BA9] border-[#E4E4E7] dark:border-[#20252D]'
                    }`}
                  >
                    {ruleDailyAlertOn ? tr('AKTIF', 'ON') : tr('NONAKTIF', 'OFF')}
                  </button>
                </div>

                {/* Stop Trading Alert Toggle */}
                <div className="flex items-center justify-between py-1">
                  <div>
                    <span className="text-xs font-medium text-[#0F172A] dark:text-[#F2F4F7] block">
                      {tr('Peringatan Berhenti Trading', 'Stop Trading Alert')}
                    </span>
                    <span className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                      {tr(
                        'Banner peringatan saat kerugian harian mencapai 100% dari batas harian',
                        'Alert banner when daily loss reaches 100% of daily limit'
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRuleStopAlertOn((v) => !v)}
                    className={`px-3.5 py-1 rounded-full text-xs font-semibold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40 ${
                      ruleStopAlertOn
                        ? 'bg-[#0F172A] text-white border-[#0F172A] dark:bg-white dark:text-[#050607] dark:border-white'
                        : 'bg-transparent text-[#526071] dark:text-[#929BA9] border-[#E4E4E7] dark:border-[#20252D]'
                    }`}
                  >
                    {ruleStopAlertOn ? tr('AKTIF', 'ON') : tr('NONAKTIF', 'OFF')}
                  </button>
                </div>
              </div>

              <div className="space-y-3 pt-3 border-t border-[#E4E4E7] dark:border-[#20252D]">
                <button
                  type="button"
                  onClick={handleSaveProtectionRules}
                  className="w-full rounded-full bg-[#0F172A] hover:bg-[#1E293B] dark:bg-white dark:hover:bg-[#E2E8F0] text-white dark:text-[#050607] text-xs font-semibold py-2.5 px-4 transition-colors inline-flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
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

                <p className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                  {tr(
                    'Catatan: Peringatan proteksi risiko berfungsi sebagai pengingat di dalam aplikasi dan tolok ukur evaluasi disiplin di VLO. Fitur ini tidak memblokir order secara otomatis di terminal broker Anda.',
                    'Note: Risk protection alerts operate as in-app warnings and discipline evaluation benchmarks inside VLO. They do not automatically block orders at your broker terminal.'
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
        <div className="pt-5 border-t border-[#E4E4E7] dark:border-[#20252D] space-y-6 animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#E4E4E7] dark:border-[#20252D]">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-[#0F172A] dark:text-[#F2F4F7]">
                {tr('Simulasi Loss Beruntun', 'Consecutive Loss Simulation')}
              </h2>
              <p className="text-xs text-[#526071] dark:text-[#929BA9] mt-0.5">
                {tr(
                  'Simulasi ketahanan modal terhadap kerugian beruntun dalam USD & IDR',
                  'Consecutive loss simulation in USD & IDR'
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center p-0.5 rounded-full bg-[#F4F4F5] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D]">
                {(['USD', 'IDR'] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => handleRiskCurrencySwitch(c, true)}
                    className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40 ${
                      riskCurrency === c
                        ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607]'
                        : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                    }`}
                  >
                    {c === 'IDR' ? 'IDR (Rp)' : 'USD ($)'}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setConsecBalanceInput(String(activeBalanceInRiskCurrency))}
                className="px-3.5 py-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] hover:border-[#0F172A]/45 dark:hover:border-white/45 text-xs font-medium text-[#0F172A] dark:text-[#F2F4F7] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none transition-colors font-mono-numbers tabular-nums cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
              >
                {tr('Gunakan Saldo Akun', 'Use Account Balance')} (
                {formatExactCurrency(activeBalanceInRiskCurrency, riskCurrency)})
              </button>
            </div>
          </div>

          {/* Input Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 items-start">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9]">
                  {tr(
                    `Saldo Awal (${riskCurrencySymbol})`,
                    `Initial Balance (${riskCurrencySymbol})`
                  )}
                </label>
                <button
                  type="button"
                  onClick={() =>
                    handleRiskCurrencySwitch(riskCurrency === 'IDR' ? 'USD' : 'IDR', true)
                  }
                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#0F172A] dark:text-[#F2F4F7] hover:underline cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                >
                  <ArrowRightLeft className="w-3 h-3" />
                  <span>
                    {tr('Ke', 'To')} {riskCurrency === 'IDR' ? 'USD' : 'IDR'}
                  </span>
                </button>
              </div>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold font-mono-numbers text-[#526071] dark:text-[#929BA9] pointer-events-none">
                  {riskCurrencySymbol}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={formatMoneyInputForDisplay(consecBalanceInput, riskCurrency)}
                  onChange={(e) =>
                    handleCleanMoneyInput(e.target.value, setConsecBalanceInput, riskCurrency)
                  }
                  className={`w-full rounded-xl bg-white dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none ${
                    riskCurrency === 'IDR' ? 'pl-9' : 'pl-7'
                  } pr-3.5 py-2.5 text-sm font-semibold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40`}
                  placeholder={riskCurrency === 'IDR' ? '10.000.000' : '1000'}
                />
              </div>
              <div className="flex flex-wrap items-center gap-1 mt-1.5">
                {(riskCurrency === 'IDR' ? CAPITAL_PRESETS_IDR : CAPITAL_PRESETS_USD).map(
                  (preset) => {
                    const isSelected = Math.abs(consecInitialBalance - preset.value) < 0.01;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => setConsecBalanceInput(String(preset.value))}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-mono-numbers tabular-nums transition-colors border cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40 ${
                          isSelected
                            ? 'bg-[#0F172A] text-white border-[#0F172A] dark:bg-white dark:text-[#050607] dark:border-white'
                            : 'bg-transparent text-[#526071] dark:text-[#929BA9] border-[#E4E4E7] dark:border-[#20252D] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  }
                )}
              </div>
              <p className="text-[10px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9] mt-1">
                {buildCrossCurrencyHint(consecInitialBalance)}
              </p>
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] mb-1.5">
                {tr('Risiko per Trade (%)', 'Risk per Trade (%)')}
              </label>
              <input
                type="number"
                step="0.1"
                min="0.01"
                max="100"
                value={consecRiskInput}
                onChange={(e) => setConsecRiskInput(e.target.value)}
                className="w-full rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                placeholder="1"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] mb-1.5">
                {tr('Metode Risiko', 'Risk Method')}
              </label>
              <select
                value={consecMethod}
                onChange={(e) => setConsecMethod(e.target.value as ConsecutiveLossMethod)}
                className="w-full rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3.5 py-2.5 text-xs text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
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
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] mb-1.5">
                {tr('Jumlah Loss Beruntun', 'Number of Losses')}
              </label>
              <input
                type="number"
                step="1"
                min="1"
                max="50"
                value={consecCountInput}
                onChange={(e) => setConsecCountInput(e.target.value)}
                className="w-full rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3.5 py-2.5 text-sm font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                placeholder="5"
              />
            </div>

            <div className="xl:pt-[22px]">
              <button
                type="button"
                onClick={() => setConsecCountInput(String(consecLossesCount))}
                className="w-full rounded-full bg-[#0F172A] hover:bg-[#1E293B] dark:bg-white dark:hover:bg-[#E2E8F0] text-white dark:text-[#050607] text-xs font-semibold py-2.5 px-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
              >
                {tr('Simulasikan', 'Simulate')}
              </button>
            </div>
          </div>

          {/* RESULT SUMMARY */}
          <div className="pt-4 border-t border-[#E4E4E7] dark:border-[#20252D] space-y-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#0F172A] dark:text-[#F2F4F7] block">
              {tr('Hasil Simulasi', 'Result')}
            </span>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-1">
              <div>
                <span className="text-xs text-[#526071] dark:text-[#929BA9] block mb-1">
                  {tr('Saldo Awal', 'Initial Balance')}
                </span>
                <div className="text-lg font-bold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                  {formatExactCurrency(consecInitialBalance, riskCurrency)}
                </div>
              </div>

              <div>
                <span className="text-xs text-[#526071] dark:text-[#929BA9] block mb-1">
                  {tr('Sisa Saldo', 'Remaining Balance')}
                </span>
                <div className="text-lg font-bold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                  {formatExactCurrency(consecRemainingBalance, riskCurrency)}
                </div>
              </div>

              <div>
                <span className="text-xs text-[#526071] dark:text-[#929BA9] block mb-1">
                  {tr('Total Kerugian', 'Total Loss')}
                </span>
                <div className="text-lg font-bold font-mono-numbers tabular-nums text-[#E11D48] dark:text-[#E05260]">
                  -{formatExactCurrency(consecTotalLoss, riskCurrency)}
                </div>
              </div>

              <div>
                <span className="text-xs text-[#526071] dark:text-[#929BA9] block mb-1">
                  Drawdown
                </span>
                <div className="text-lg font-bold font-mono-numbers tabular-nums text-[#E11D48] dark:text-[#E05260]">
                  -{consecDrawdownPct.toFixed(2)}%
                </div>
              </div>
            </div>
          </div>

          {/* BALANCE PROJECTION */}
          <div className="pt-4 border-t border-[#E4E4E7] dark:border-[#20252D] space-y-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#0F172A] dark:text-[#F2F4F7] block">
              {tr('Proyeksi Saldo', 'Balance Projection')}
            </span>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-[#0F172A] dark:text-[#F2F4F7]">
                <thead className="border-b border-[#E4E4E7] dark:border-[#20252D] text-[11px] uppercase tracking-wider text-[#526071] dark:text-[#929BA9]">
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
                <tbody className="divide-y divide-[#E4E4E7] dark:divide-[#20252D] font-mono-numbers tabular-nums">
                  <tr>
                    <td className="py-2.5 px-3 font-sans font-medium text-[#526071] dark:text-[#929BA9]">
                      {tr('Awal', 'Initial')}
                    </td>
                    <td className="py-2.5 px-3 text-[#526071] dark:text-[#929BA9]">--</td>
                    <td className="py-2.5 px-3 font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                      {formatExactCurrency(consecInitialBalance, riskCurrency)}
                    </td>
                    <td className="py-2.5 px-3 text-[#526071] dark:text-[#929BA9]">0.00%</td>
                  </tr>
                  {consecSteps.map((step) => (
                    <tr
                      key={step.lossNumber}
                      className="hover:bg-[#FAFAFA] dark:hover:bg-[#161A22] transition-colors"
                    >
                      <td className="py-2.5 px-3 font-sans font-medium text-[#0F172A] dark:text-[#F2F4F7]">
                        {tr('Rugi', 'Loss')} {step.lossNumber}
                      </td>
                      <td className="py-2.5 px-3 text-[#E11D48] dark:text-[#E05260]">
                        -{formatExactCurrency(step.dollarLost, riskCurrency)}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                        {formatExactCurrency(step.remainingEquity, riskCurrency)}
                      </td>
                      <td className="py-2.5 px-3 text-[#E11D48] dark:text-[#E05260]">
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
        <div className="pt-5 border-t border-[#E4E4E7] dark:border-[#20252D] space-y-6 animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#E4E4E7] dark:border-[#20252D]">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-[#0F172A] dark:text-[#F2F4F7]">
                {tr('Evaluasi Disiplin', 'Discipline Evaluation')}
              </h2>
              <p className="text-xs text-[#526071] dark:text-[#929BA9] mt-0.5">
                {tr('Audit kepatuhan aturan manajemen risiko', 'Trading rule compliance')}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-[#526071] dark:text-[#929BA9]">
                {tr('Periode Evaluasi', 'Evaluation Period')}
              </label>
              <select
                value={disciplinePeriod}
                onChange={(e) => setDisciplinePeriod(e.target.value as DisciplinePeriod)}
                className="rounded-full bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none px-3.5 py-1.5 text-xs font-medium text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
              >
                <option value="LAST_20">{tr('20 Trade Terakhir', 'Last 20 Trades')}</option>
                <option value="LAST_50">{tr('50 Trade Terakhir', 'Last 50 Trades')}</option>
                <option value="ALL">{tr('Semua Trade', 'All Trades')}</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Discipline Score */}
            <div className="md:pr-6 md:border-r md:border-[#E4E4E7] md:dark:border-[#20252D] flex flex-col justify-between space-y-4">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] block mb-2">
                  {tr('Skor Disiplin', 'Discipline Score')}
                </span>
                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-3xl sm:text-4xl font-bold font-mono-numbers tabular-nums ${
                      disciplineEval.disciplineScore >= 80
                        ? 'text-[#059669] dark:text-[#00A878]'
                        : disciplineEval.disciplineScore >= 60
                        ? 'text-[#D97706] dark:text-[#F59E0B]'
                        : 'text-[#E11D48] dark:text-[#E05260]'
                    }`}
                  >
                    {disciplineEval.disciplineScore}
                  </span>
                  <span className="text-base font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                    / 100
                  </span>
                </div>
                <span className="text-xs text-[#526071] dark:text-[#929BA9] block mt-1">
                  {tr(
                    `Dievaluasi dari ${disciplineEval.totalTradesEvaluated} transaksi di Jurnal Trade (Nilai ${disciplineEval.disciplineGrade})`,
                    `Evaluated from ${disciplineEval.totalTradesEvaluated} trades in Trade Log (Grade ${disciplineEval.disciplineGrade})`
                  )}
                </span>
              </div>

              <div className="pt-3 border-t border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-between text-xs">
                <span className="text-[#526071] dark:text-[#929BA9]">
                  {tr('Runtutan Rugi Maks', 'Max Loss Streak')}
                </span>
                <span className="font-mono-numbers tabular-nums font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                  {disciplineEval.maxConsecutiveLossesEncountered} {tr('trade', 'trades')} (
                  {tr('Batas:', 'Limit:')} {settings.maxConsecutiveLossLimit || 3})
                </span>
              </div>
            </div>

            {/* RULE COMPLIANCE */}
            <div className="md:pr-6 md:border-r md:border-[#E4E4E7] md:dark:border-[#20252D] space-y-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#0F172A] dark:text-[#F2F4F7] block pb-2 border-b border-[#E4E4E7] dark:border-[#20252D]">
                {tr('Kepatuhan Aturan', 'Rule Compliance')}
              </span>

              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between py-1.5 border-b border-[#E4E4E7] dark:border-[#20252D]">
                  <span className="text-[#526071] dark:text-[#929BA9]">
                    {tr('Risiko per Trade', 'Risk per Trade')}
                  </span>
                  <span className="font-mono-numbers tabular-nums font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                    {disciplineEval.riskPerTradeCompliantCount ?? 0} / {disciplineEval.totalTradesEvaluated}
                  </span>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-[#E4E4E7] dark:border-[#20252D]">
                  <span className="text-[#526071] dark:text-[#929BA9]">
                    {tr('Kepatuhan Stop Loss', 'Stop Loss Compliance')}
                  </span>
                  <span className="font-mono-numbers tabular-nums font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                    {disciplineEval.stopLossCompliantCount ?? 0} / {disciplineEval.totalTradesEvaluated}
                  </span>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-[#E4E4E7] dark:border-[#20252D]">
                  <span className="text-[#526071] dark:text-[#929BA9]">
                    {tr('Rencana Trading', 'Trading Plan')}
                  </span>
                  <span className="font-mono-numbers tabular-nums font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                    {disciplineEval.tradingPlanCompliantCount ?? 0} / {disciplineEval.totalTradesEvaluated}
                  </span>
                </div>

                <div className="flex items-center justify-between py-1.5">
                  <span className="text-[#526071] dark:text-[#929BA9]">
                    {tr('Kepatuhan Batas Harian', 'Daily Limit Compliance')}
                  </span>
                  <span className="font-mono-numbers tabular-nums font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                    {disciplineEval.dailyLimitCompliantCount ?? 0} / {disciplineEval.totalTradesEvaluated}
                  </span>
                </div>
              </div>
            </div>

            {/* RULE VIOLATIONS */}
            <div className="flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#0F172A] dark:text-[#F2F4F7] block pb-2 border-b border-[#E4E4E7] dark:border-[#20252D]">
                  {tr('Pelanggaran Aturan', 'Rule Violations')}
                </span>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#526071] dark:text-[#929BA9]">
                    {tr('Total Pelanggaran', 'Total Violations')}
                  </span>
                  <span
                    className={`text-xl font-bold font-mono-numbers tabular-nums ${
                      (disciplineEval.totalViolationsCount ?? 0) > 0
                        ? 'text-[#E11D48] dark:text-[#E05260]'
                        : 'text-[#059669] dark:text-[#00A878]'
                    }`}
                  >
                    {disciplineEval.totalViolationsCount ?? 0}
                  </span>
                </div>

                <div className="space-y-1.5 text-xs text-[#526071] dark:text-[#929BA9]">
                  <div className="flex justify-between">
                    <span>{tr('Melebihi Risiko saat Loss', 'Over-Risk on Losses')}</span>
                    <span className="font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                      {disciplineEval.overRiskTradesCount}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>{tr('Risiko Rencana Berlebih', 'Excessive Planned Risk')}</span>
                    <span className="font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                      {disciplineEval.excessiveRiskTradesCount}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>{tr('Pelanggaran Batas Harian', 'Daily Limit Breaches')}</span>
                    <span className="font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                      {disciplineEval.dailyLossViolationsCount}
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowDisciplineDetails((v) => !v)}
                className="w-full rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] hover:border-[#0F172A] dark:hover:border-white text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] py-2 px-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
              >
                {showDisciplineDetails
                  ? tr('Sembunyikan Detail', 'Hide Details')
                  : tr('Lihat Detail', 'View Details')}
              </button>
            </div>
          </div>

          {/* Expandable Details Section */}
          {showDisciplineDetails && (
            <div className="pt-4 border-t border-[#E4E4E7] dark:border-[#20252D] space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {disciplineEval.auditFindings.map((finding, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs font-semibold ${
                          finding.type === 'VIOLATION'
                            ? 'text-[#E11D48] dark:text-[#E05260]'
                            : finding.type === 'WARNING'
                            ? 'text-[#D97706] dark:text-[#F59E0B]'
                            : 'text-[#059669] dark:text-[#00A878]'
                        }`}
                      >
                        {finding.title}
                      </span>
                      <span className="text-[10px] uppercase font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                        {finding.type}
                      </span>
                    </div>
                    <p className="text-xs text-[#526071] dark:text-[#929BA9] leading-relaxed text-editorial-justify">
                      {finding.description}
                    </p>
                  </div>
                ))}
              </div>

              {filteredDisciplineTrades.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-[#0F172A] dark:text-[#F2F4F7]">
                    <thead className="border-b border-[#E4E4E7] dark:border-[#20252D] text-[11px] uppercase tracking-wider text-[#526071] dark:text-[#929BA9]">
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
                    <tbody className="divide-y divide-[#E4E4E7] dark:divide-[#20252D] font-mono-numbers tabular-nums">
                      {[...filteredDisciplineTrades].reverse().slice(0, 20).map((t) => {
                        const net = computeTradeNetProfit(t);
                        const hasSL = t.stopLoss !== undefined && t.stopLoss > 0;
                        const hasRisk = t.riskAmount !== undefined && t.riskAmount > 0;
                        const isOverRisk =
                          net < 0 && hasRisk && Math.abs(net) > t.riskAmount! * 1.05;
                        const isCompliant = hasSL && !isOverRisk;
                        return (
                          <tr key={t.id} className="hover:bg-[#FAFAFA] dark:hover:bg-[#161A22] transition-colors">
                            <td className="py-2 px-3 text-[#526071] dark:text-[#929BA9]">
                              {(t.dateTime || '').slice(0, 10)}
                            </td>
                            <td className="py-2 px-3 font-sans font-medium">
                              {t.instrument} · {t.position}
                            </td>
                            <td className="py-2 px-3">
                              {hasSL ? t.stopLoss : tr('Tanpa SL', 'Missing')}
                            </td>
                            <td className="py-2 px-3">
                              {hasRisk ? fmtBaseMoney(t.riskAmount!) : '--'}
                            </td>
                            <td
                              className={`py-2 px-3 font-semibold ${
                                net >= 0 ? 'text-[#059669] dark:text-[#00A878]' : 'text-[#E11D48] dark:text-[#E05260]'
                              }`}
                            >
                              {riskCurrency === 'IDR'
                                ? formatTradeFinancial(t, 'netProfit', false, true)
                                : `${net >= 0 ? '+' : '-'}${formatExactCurrency(
                                    Math.abs(toUsdFromBase(net)),
                                    'USD'
                                  )}`}
                            </td>
                            <td
                              className={`py-2 px-3 font-sans font-semibold ${
                                isCompliant ? 'text-[#059669] dark:text-[#00A878]' : 'text-[#E11D48] dark:text-[#E05260]'
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
            ? 'pt-5 border-t border-[#E4E4E7] dark:border-[#20252D] animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none'
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
            ? 'pt-5 border-t border-[#E4E4E7] dark:border-[#20252D] animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none'
            : 'hidden'
        }
      >
        <TradeSimulationTab settings={settings} currentEquity={currentEquity} />
      </div>
    </div>
  );
};
