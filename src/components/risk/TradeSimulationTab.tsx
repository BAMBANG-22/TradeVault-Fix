import React, { useState, useMemo, useEffect } from 'react';
import { AppSettings, CurrencyCode } from '../../types/settings';
import {
  simulateTrades,
  RiskMethod,
  RiskType,
  SequenceMode,
  CONSECUTIVE_LOSS_PRESETS,
  MONTE_CARLO_ITERATION_OPTIONS,
} from '../../utils/tradeSimulation';
import { formatCurrency } from '../../utils/calculations';
import { useGlobalCurrency } from '../../utils/currencyRate';
import { useLanguage } from '../../utils/language';
import { AlertTriangle, RefreshCw, HelpCircle, ArrowRightLeft } from 'lucide-react';

interface TradeSimulationTabProps {
  settings: AppSettings;
  currentEquity: number;
}

const CAPITAL_PRESETS_USD = [
  { label: '$100', value: 100 },
  { label: '$500', value: 500 },
  { label: '$1,000', value: 1000 },
  { label: '$2,500', value: 2500 },
  { label: '$5,000', value: 5000 },
  { label: '$10,000', value: 10000 },
];

const CAPITAL_PRESETS_IDR = [
  { label: 'Rp 1 Jt', value: 1_000_000 },
  { label: 'Rp 5 Jt', value: 5_000_000 },
  { label: 'Rp 10 Jt', value: 10_000_000 },
  { label: 'Rp 25 Jt', value: 25_000_000 },
  { label: 'Rp 50 Jt', value: 50_000_000 },
  { label: 'Rp 100 Jt', value: 100_000_000 },
];

/**
 * Formats integer/decimal strings with Indonesian thousand dots when currency is IDR,
 * e.g. "10000000" -> "10.000.000" so users can read and type Rupiah amounts effortlessly.
 */
function formatMoneyInputForDisplay(rawNumericStr: string, currency: CurrencyCode): string {
  if (!rawNumericStr) return '';
  if (currency === 'IDR') {
    const digitsOnly = rawNumericStr.replace(/[^0-9]/g, '');
    if (!digitsOnly) return '';
    return digitsOnly.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  return rawNumericStr;
}

/**
 * Compact axis formatter so large IDR values (e.g. Rp 17.958.563) never clip on SVG Y-axis.
 */
function formatAxisValue(amount: number, currency: CurrencyCode): string {
  if (!Number.isFinite(amount)) return '0';
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';

  if (currency === 'IDR') {
    if (abs >= 1_000_000_000_000) {
      return `${sign}Rp ${(abs / 1_000_000_000_000).toFixed(1).replace(/\.0$/, '')} T`;
    }
    if (abs >= 1_000_000_000) {
      return `${sign}Rp ${(abs / 1_000_000_000).toFixed(1).replace(/\.0$/, '')} M`;
    }
    if (abs >= 1_000_000) {
      return `${sign}Rp ${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')} Jt`;
    }
    if (abs >= 1_000) {
      return `${sign}Rp ${Math.round(abs / 1_000)} Rb`;
    }
    return `${sign}Rp ${Math.round(abs)}`;
  }

  const sym = currency === 'EUR' ? '€' : '$';
  if (abs >= 1_000_000_000) {
    return `${sign}${sym}${(abs / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}${sym}${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (abs >= 10_000) {
    return `${sign}${sym}${(abs / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return `${sign}${sym}${abs.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

export const TradeSimulationTab: React.FC<TradeSimulationTabProps> = ({
  settings,
  currentEquity,
}) => {
  const { preferredCurrency, effectiveRate } = useGlobalCurrency();
  const { tr } = useLanguage();

  const initialCurrency: CurrencyCode =
    preferredCurrency === 'IDR' || settings.currency === 'IDR'
      ? 'IDR'
      : settings.currency || 'USD';

  const [currency, setCurrency] = useState<CurrencyCode>(initialCurrency);
  const [startingCapitalInput, setStartingCapitalInput] = useState<string>(() => {
    if (initialCurrency === 'IDR') {
      const baseUsd = currentEquity > 0 ? currentEquity : settings.startingBalance || 1000;
      const converted =
        settings.currency === 'IDR'
          ? Math.round(baseUsd)
          : Math.round(baseUsd * (effectiveRate || 16250));
      return String(converted >= 100_000 ? converted : 10_000_000);
    }
    return '1000';
  });

  const [winRateInput, setWinRateInput] = useState<string>('55');
  const [rrRatioInput, setRrRatioInput] = useState<string>('2');
  const [riskType, setRiskType] = useState<RiskType>('percent');
  const [riskValueInput, setRiskValueInput] = useState<string>('1');
  const [tradesCountInput, setTradesCountInput] = useState<string>('50');
  const [riskMethod, setRiskMethod] = useState<RiskMethod>('balance');
  const [sequenceMode, setSequenceMode] = useState<SequenceMode>('expected_spread');
  const [customLossStreakInput, setCustomLossStreakInput] = useState<string>('5');
  const [monteCarloIterations, setMonteCarloIterations] = useState<number>(1000);
  const [randomSeedInput, setRandomSeedInput] = useState<string>('1');
  const [showTradeTable, setShowTradeTable] = useState<boolean>(false);
  const [showReadingGuide, setShowReadingGuide] = useState<boolean>(true);

  const activeSettings: AppSettings = useMemo(() => {
    let symbol = '$';
    if (currency === 'IDR') symbol = 'Rp';
    if (currency === 'EUR') symbol = '€';
    return {
      ...settings,
      currency,
      currencySymbol: symbol,
    };
  }, [settings, currency]);

  // Compute live account balance in whichever currency is selected in the simulator
  const liveAccountBalanceInSelectedCurrency = useMemo(() => {
    const rawLiveBalance = currentEquity > 0 ? currentEquity : settings.startingBalance || 1000;
    const baseIsIdr = settings.currency === 'IDR';
    const rate = effectiveRate > 0 ? effectiveRate : 16250;

    if (currency === 'IDR') {
      return baseIsIdr ? Math.round(rawLiveBalance) : Math.round(rawLiveBalance * rate);
    }
    if (currency === 'USD') {
      return baseIsIdr
        ? Number((rawLiveBalance / rate).toFixed(2))
        : Number(rawLiveBalance.toFixed(2));
    }
    return baseIsIdr
      ? Number((rawLiveBalance / rate).toFixed(2))
      : Number(rawLiveBalance.toFixed(2));
  }, [currentEquity, settings.startingBalance, settings.currency, currency, effectiveRate]);

  // Synchronize currency when user switches global USD/IDR preference in header/dashboard
  useEffect(() => {
    if (
      preferredCurrency &&
      preferredCurrency !== currency &&
      (currency === 'USD' || currency === 'IDR')
    ) {
      handleCurrencySwitch(preferredCurrency);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferredCurrency]);

  const handleCurrencySwitch = (nextCurrency: CurrencyCode) => {
    if (nextCurrency === currency) return;
    const rate = effectiveRate > 0 ? effectiveRate : 16250;
    const currentCap = Math.max(0, parseFloat(startingCapitalInput) || 0);
    const currentRiskVal = Math.max(0, parseFloat(riskValueInput) || 0);

    if (currency !== 'IDR' && nextCurrency === 'IDR') {
      // Convert USD/EUR -> IDR
      const nextCap = currentCap > 0 ? Math.round(currentCap * rate) : 10_000_000;
      setStartingCapitalInput(String(nextCap));
      if (riskType === 'nominal') {
        const nextRiskNom = currentRiskVal > 0 ? Math.round(currentRiskVal * rate) : 100_000;
        setRiskValueInput(String(nextRiskNom));
      }
    } else if (currency === 'IDR' && nextCurrency !== 'IDR') {
      // Convert IDR -> USD/EUR
      const nextCap = currentCap > 0 ? Number((currentCap / rate).toFixed(2)) : 1000;
      setStartingCapitalInput(String(nextCap));
      if (riskType === 'nominal') {
        const nextRiskNom =
          currentRiskVal > 0 ? Number((currentRiskVal / rate).toFixed(2)) : 10;
        setRiskValueInput(String(nextRiskNom));
      }
    }

    setCurrency(nextCurrency);
  };

  const startingCapital = Math.max(
    0,
    currency === 'IDR'
      ? Math.round(parseFloat(startingCapitalInput) || 0)
      : parseFloat(startingCapitalInput) || 0
  );

  // Smart switch between Percent (%) and Nominal (Rp / $) so switching to Nominal doesn't leave "1" (= Rp 1)
  const handleRiskTypeSwitch = (nextType: RiskType) => {
    if (nextType === riskType) return;
    const curVal = Math.max(0, parseFloat(riskValueInput) || 0);
    if (riskType === 'percent' && nextType === 'nominal') {
      const pct = curVal > 0 ? curVal : 1;
      const nominalAmt = (startingCapital * pct) / 100;
      if (currency === 'IDR') {
        setRiskValueInput(String(Math.max(1000, Math.round(nominalAmt))));
      } else {
        setRiskValueInput(String(Math.max(0.01, Number(nominalAmt.toFixed(2)))));
      }
    } else if (riskType === 'nominal' && nextType === 'percent') {
      if (startingCapital > 0 && curVal > 0) {
        const pct = Number(((curVal / startingCapital) * 100).toFixed(2));
        setRiskValueInput(String(Math.min(100, Math.max(0.1, pct))));
      } else {
        setRiskValueInput('1');
      }
    }
    setRiskType(nextType);
  };

  const handleMoneyInput = (rawVal: string, setter: (s: string) => void) => {
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
  };

  const handleWinRateChange = (raw: string) => {
    if (raw === '') {
      setWinRateInput('');
      return;
    }
    const cleaned = raw.replace(/,/g, '.').replace(/^0+(?=\d)/, '');
    const num = parseFloat(cleaned);
    if (!isNaN(num)) {
      if (num < 0) setWinRateInput('0');
      else if (num > 100) setWinRateInput('100');
      else setWinRateInput(cleaned);
    } else {
      setWinRateInput(cleaned);
    }
  };

  const handleCleanNumberInput = (
    val: string,
    setter: (s: string) => void,
    allowDecimal = true
  ) => {
    if (val === '') {
      setter('');
      return;
    }
    let cleaned = val.replace(/,/g, '.').replace(/^0+(?=\d)/, '');
    if (!allowDecimal) {
      cleaned = cleaned.replace(/[^0-9]/g, '');
    } else {
      cleaned = cleaned.replace(/[^0-9.]/g, '');
      const parts = cleaned.split('.');
      if (parts.length > 2) {
        cleaned = `${parts[0]}.${parts.slice(1).join('')}`;
      }
    }
    setter(cleaned);
  };

  const winRate = Math.min(100, Math.max(0, parseFloat(winRateInput) || 0));
  const rrRatio = Math.max(0.01, parseFloat(rrRatioInput) || 1.0);
  const riskValue = Math.max(
    0,
    riskType === 'nominal' && currency === 'IDR'
      ? Math.round(parseFloat(riskValueInput) || 0)
      : parseFloat(riskValueInput) || 0
  );
  const tradesCount = Math.max(1, Math.min(500, parseInt(tradesCountInput, 10) || 1));
  const customLossStreak = Math.max(0, parseInt(customLossStreakInput, 10) || 0);
  const randomSeed = Math.max(1, parseInt(randomSeedInput, 10) || 1);

  const simulation = useMemo(() => {
    return simulateTrades({
      startingCapital,
      winRate,
      rrRatio,
      riskType,
      riskValue,
      tradesCount,
      riskMethod,
      sequenceMode,
      randomSeed,
      customLossStreak,
      monteCarloIterations,
    });
  }, [
    startingCapital,
    winRate,
    rrRatio,
    riskType,
    riskValue,
    tradesCount,
    riskMethod,
    sequenceMode,
    randomSeed,
    customLossStreak,
    monteCarloIterations,
  ]);

  const handleSyncLiveEquity = () => {
    setStartingCapitalInput(String(liveAccountBalanceInSelectedCurrency));
  };

  // Equivalent cross-currency hint (IDR <-> USD)
  const crossCurrencyHint = useMemo(() => {
    const rate = effectiveRate > 0 ? effectiveRate : 16250;
    if (currency === 'IDR') {
      const eqUsd = startingCapital / rate;
      return `≈ $${eqUsd.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} USD (${tr('Kurs', 'Rate')} Rp ${Math.round(rate).toLocaleString('id-ID')})`;
    }
    if (currency === 'USD') {
      const eqIdr = Math.round(startingCapital * rate);
      return `≈ Rp ${eqIdr.toLocaleString('id-ID')} (${tr('Kurs', 'Rate')} Rp ${Math.round(rate).toLocaleString('id-ID')})`;
    }
    return null;
  }, [currency, startingCapital, effectiveRate, tr]);

  // First trade risk & reward preview
  const firstTradeRiskAmount = simulation.firstTradeRiskDollar;
  const firstTradeRewardAmount = firstTradeRiskAmount * rrRatio;

  // Chart geometry (wider left padding so IDR labels never clip)
  const chartHeight = 235;
  const chartWidth = 720;
  const padding = { top: 22, right: 24, bottom: 30, left: 86 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  const samplePathValues =
    sequenceMode === 'monte_carlo_random'
      ? simulation.monteCarlo.samplePaths.flatMap((sp) => sp.curve)
      : [];

  const maxEquity = Math.max(
    ...simulation.curve.map((c) => c.equity),
    ...samplePathValues,
    startingCapital,
    1
  );
  const minEquity = Math.min(
    ...simulation.curve.map((c) => c.equity),
    ...samplePathValues,
    startingCapital
  );

  const getY = (val: number) => {
    if (maxEquity === minEquity) return padding.top + innerHeight / 2;
    const norm = (val - minEquity) / (maxEquity - minEquity);
    return padding.top + innerHeight - norm * innerHeight;
  };

  const getX = (idx: number, total: number) => {
    if (total <= 1) return padding.left;
    return padding.left + (idx / (total - 1)) * innerWidth;
  };

  const points = simulation.curve.map((step, idx) => ({
    x: getX(idx, simulation.curve.length),
    y: getY(step.equity),
    equity: step.equity,
    drawdown: step.drawdownPercent,
    isWin: step.isWin,
    tradeNum: step.tradeNum,
  }));

  const linePath = points
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${
    chartHeight - padding.bottom
  } L ${points[0].x.toFixed(1)} ${chartHeight - padding.bottom} Z`;

  const isProfit = simulation.totalNetProfit >= 0;
  const isRoundingAdjusted = Math.abs(simulation.actualWinRatePercent - winRate) > 0.005;
  const primaryStrokeColor = isProfit ? '#3478DC' : '#E05260';

  const formattedProfitFactor = !Number.isFinite(simulation.profitFactor)
    ? '∞'
    : simulation.profitFactor.toFixed(2);

  const capitalPresets = currency === 'IDR' ? CAPITAL_PRESETS_IDR : CAPITAL_PRESETS_USD;

  return (
    <div className="space-y-6 pt-2">
      {/* ==========================================================================
          1. HEADER & CURRENCY / BALANCE CONTROLS
         ========================================================================== */}
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#DDE3EA] dark:border-[#20252D]">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F4F7]">
              {tr('Simulasi Berbasis Trade', 'Trade-Based Simulation')}
            </h2>
            <p className="text-xs text-[#667085] dark:text-[#98A2B3] mt-0.5">
              {tr(
                'Simulasi skenario performa trading, distribusi Win/Loss, dan probabilitas Monte Carlo dalam USD & IDR',
                'Simulate trading performance scenarios, Win/Loss distribution, and Monte Carlo probabilities in USD & IDR'
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Currency Switcher (USD / IDR / EUR) */}
            <div className="inline-flex items-center p-0.5 rounded-lg bg-[#EEF2F6] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D]">
              {(['USD', 'IDR', 'EUR'] as CurrencyCode[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => handleCurrencySwitch(c)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                    currency === c
                      ? 'bg-[#151D2A] text-white dark:bg-[#161A22] dark:text-[#F2F4F7] border border-black/10 dark:border-white/[0.14]'
                      : 'text-[#667085] dark:text-[#98A2B3] hover:text-[#151D2A] dark:hover:text-[#F2F4F7]'
                  }`}
                >
                  {c === 'IDR' ? 'IDR (Rp)' : c === 'USD' ? 'USD ($)' : 'EUR (€)'}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleSyncLiveEquity}
              className="px-3 py-1.5 rounded-lg border border-[#DDE3EA] dark:border-[#20252D] bg-[#F5F7FA] dark:bg-[#101318] hover:border-[#151D2A]/30 dark:hover:border-white/[0.2] text-xs font-medium text-[#151D2A] dark:text-[#F2F4F7] transition-colors font-mono-numbers tabular-nums"
            >
              {tr('Gunakan Saldo Akun', 'Use Account Balance')} ({formatCurrency(liveAccountBalanceInSelectedCurrency, activeSettings)})
            </button>
          </div>
        </div>

        {/* ========================================================================
            2. CORE PARAMETERS (Modal Awal, Win Rate, Risiko per Trade, R:R, Total Trade)
           ======================================================================== */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Modal Awal (Initial Capital) */}
          <div className="sm:col-span-2 lg:col-span-1">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[#667085] dark:text-[#98A2B3]">
                {tr('Modal Awal', 'Initial Capital')} ({activeSettings.currencySymbol})
              </label>
              <button
                type="button"
                onClick={() => handleCurrencySwitch(currency === 'IDR' ? 'USD' : 'IDR')}
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#3478DC] hover:underline"
                title={tr('Ubah mata uang dan konversi otomatis', 'Switch currency and convert automatically')}
              >
                <ArrowRightLeft className="w-3 h-3" />
                <span>{tr('Ke', 'To')} {currency === 'IDR' ? 'USD' : 'IDR'}</span>
              </button>
            </div>

            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold font-mono-numbers text-[#667085] dark:text-[#98A2B3] pointer-events-none">
                {activeSettings.currencySymbol}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={formatMoneyInputForDisplay(startingCapitalInput, currency)}
                onChange={(e) => handleMoneyInput(e.target.value, setStartingCapitalInput)}
                className={`w-full rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] ${
                  currency === 'IDR' ? 'pl-9' : 'pl-7'
                } pr-3.5 py-2.5 text-sm font-semibold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F4F7] focus:border-[#151D2A] dark:focus:border-white/[0.28] focus:outline-none transition-colors`}
                placeholder={currency === 'IDR' ? '10.000.000' : '1000'}
              />
            </div>

            {/* Quick Capital Presets */}
            <div className="flex flex-wrap items-center gap-1 mt-2">
              {capitalPresets.map((preset) => {
                const isSelected = Math.abs(startingCapital - preset.value) < 0.01;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setStartingCapitalInput(String(preset.value))}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-mono-numbers tabular-nums transition-colors border ${
                      isSelected
                        ? 'bg-[#151D2A] text-white border-[#151D2A] dark:bg-[#161A22] dark:text-[#F2F4F7] dark:border-white/[0.2]'
                        : 'bg-transparent text-[#667085] dark:text-[#98A2B3] border-[#DDE3EA] dark:border-[#20252D] hover:text-[#151D2A] dark:hover:text-[#F2F4F7]'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            {crossCurrencyHint && (
              <p className="text-[10px] font-mono-numbers tabular-nums text-[#667085] dark:text-[#98A2B3] mt-1.5">
                {crossCurrencyHint}
              </p>
            )}
          </div>

          {/* Win Rate (%) */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#667085] dark:text-[#98A2B3] mb-1.5">
              {tr('Tingkat Menang (%)', 'Win Rate (%)')}
            </label>
            <div className="relative">
              <input
                type="number"
                step="1"
                min="0"
                max="100"
                value={winRateInput}
                onChange={(e) => handleWinRateChange(e.target.value)}
                className="w-full rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] px-3.5 pr-8 py-2.5 text-sm font-semibold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F4F7] focus:border-[#151D2A] dark:focus:border-white/[0.28] focus:outline-none transition-colors"
                placeholder="55"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-mono-numbers text-[#667085] dark:text-[#98A2B3] pointer-events-none">
                %
              </span>
            </div>
            <p className="text-[10px] font-mono-numbers tabular-nums text-[#667085] dark:text-[#98A2B3] mt-1.5">
              {tr('Target', 'Target')}: {simulation.targetWinCount} {tr('Menang', 'Win')} / {simulation.targetLossCount} {tr('Rugi', 'Loss')}
            </p>
          </div>

          {/* Risiko per Trade (% atau Nominal IDR/USD) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[#667085] dark:text-[#98A2B3]">
                {tr('Risiko / Trade', 'Risk / Trade')} ({riskType === 'percent' ? '%' : activeSettings.currencySymbol})
              </label>
              <div className="inline-flex items-center p-0.5 rounded-md bg-[#EEF2F6] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D]">
                <button
                  type="button"
                  onClick={() => handleRiskTypeSwitch('percent')}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                    riskType === 'percent'
                      ? 'bg-[#151D2A] text-white dark:bg-[#161A22] dark:text-[#F2F4F7]'
                      : 'text-[#667085] dark:text-[#98A2B3]'
                  }`}
                >
                  %
                </button>
                <button
                  type="button"
                  onClick={() => handleRiskTypeSwitch('nominal')}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                    riskType === 'nominal'
                      ? 'bg-[#151D2A] text-white dark:bg-[#161A22] dark:text-[#F2F4F7]'
                      : 'text-[#667085] dark:text-[#98A2B3]'
                  }`}
                >
                  {activeSettings.currencySymbol}
                </button>
              </div>
            </div>

            {riskType === 'nominal' ? (
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold font-mono-numbers text-[#667085] dark:text-[#98A2B3] pointer-events-none">
                  {activeSettings.currencySymbol}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={formatMoneyInputForDisplay(riskValueInput, currency)}
                  onChange={(e) => handleMoneyInput(e.target.value, setRiskValueInput)}
                  className={`w-full rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] ${
                    currency === 'IDR' ? 'pl-9' : 'pl-7'
                  } pr-3.5 py-2.5 text-sm font-semibold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F4F7] focus:border-[#151D2A] dark:focus:border-white/[0.28] focus:outline-none transition-colors`}
                  placeholder={currency === 'IDR' ? '100.000' : '10'}
                />
              </div>
            ) : (
              <div className="relative">
                <input
                  type="number"
                  step="0.1"
                  min="0.01"
                  value={riskValueInput}
                  onChange={(e) => handleCleanNumberInput(e.target.value, setRiskValueInput)}
                  className="w-full rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] px-3.5 pr-8 py-2.5 text-sm font-semibold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F4F7] focus:border-[#151D2A] dark:focus:border-white/[0.28] focus:outline-none transition-colors"
                  placeholder="1"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-mono-numbers text-[#667085] dark:text-[#98A2B3] pointer-events-none">
                  %
                </span>
              </div>
            )}

            <p className="text-[10px] font-mono-numbers tabular-nums text-[#667085] dark:text-[#98A2B3] mt-1.5">
              1x SL (Trade #1): -{formatCurrency(firstTradeRiskAmount, activeSettings)}
            </p>
          </div>

          {/* Risk / Reward (1 : X) */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#667085] dark:text-[#98A2B3] mb-1.5">
              {tr('Rasio Risiko : Imbalan (1 : X)', 'Risk : Reward (1 : X)')}
            </label>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={rrRatioInput}
              onChange={(e) => handleCleanNumberInput(e.target.value, setRrRatioInput)}
              className="w-full rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] px-3.5 py-2.5 text-sm font-semibold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F4F7] focus:border-[#151D2A] dark:focus:border-white/[0.28] focus:outline-none transition-colors"
              placeholder="2"
            />
            <p className="text-[10px] font-mono-numbers tabular-nums text-[#059669] dark:text-[#00A878] mt-1.5">
              1x TP (Trade #1): +{formatCurrency(firstTradeRewardAmount, activeSettings)}
            </p>
          </div>

          {/* Total Trades */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#667085] dark:text-[#98A2B3] mb-1.5">
              {tr('Jumlah Transaksi', 'Total Trades')}
            </label>
            <input
              type="number"
              step="1"
              min="1"
              max="500"
              value={tradesCountInput}
              onChange={(e) => handleCleanNumberInput(e.target.value, setTradesCountInput, false)}
              className="w-full rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] px-3.5 py-2.5 text-sm font-semibold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F4F7] focus:border-[#151D2A] dark:focus:border-white/[0.28] focus:outline-none transition-colors"
              placeholder="50"
            />
            <p className="text-[10px] text-[#667085] dark:text-[#98A2B3] mt-1.5">
              {tr(`Simulasi ${tradesCount} eksekusi berurutan`, `Simulating ${tradesCount} consecutive executions`)}
            </p>
          </div>
        </div>

        {/* Risk Method, Sequence Mode & Simulate Action */}
        <div className="pt-4 border-t border-[#DDE3EA] dark:border-[#20252D] grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          {/* Risk Method */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#667085] dark:text-[#98A2B3] mb-1.5">
              {tr('Metode Perhitungan Risiko', 'Risk Calculation Method')}
            </label>
            <select
              value={riskMethod}
              onChange={(e) => setRiskMethod(e.target.value as RiskMethod)}
              className="w-full rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] px-3.5 py-2.5 text-xs font-medium text-[#151D2A] dark:text-[#F2F4F7] focus:border-[#151D2A] dark:focus:border-white/[0.28] focus:outline-none transition-colors"
            >
              <option value="balance" className="bg-white dark:bg-[#0B0D11]">
                {tr('Saldo Berjalan / Compounding (Risiko Mengikuti Ekuitas)', 'Running Balance / Compounding (Dynamic Risk)')}
              </option>
              <option value="initial_capital" className="bg-white dark:bg-[#0B0D11]">
                {tr('Modal Awal Tetap / Risiko Konstan', 'Fixed Initial Capital / Constant Risk')}
              </option>
            </select>
          </div>

          {/* Sequence Mode */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#667085] dark:text-[#98A2B3] mb-1.5">
              {tr('Pola Urutan Menang / Rugi', 'Win / Loss Sequence Pattern')}
            </label>
            <select
              value={sequenceMode}
              onChange={(e) => setSequenceMode(e.target.value as SequenceMode)}
              className="w-full rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] px-3.5 py-2.5 text-xs font-medium text-[#151D2A] dark:text-[#F2F4F7] focus:border-[#151D2A] dark:focus:border-white/[0.28] focus:outline-none transition-colors"
            >
              <option value="expected_spread" className="bg-white dark:bg-[#0B0D11]">
                {tr('Distribusi Merata (Proporsional)', 'Evenly Distributed (Proportional)')}
              </option>
              <option value="loss_streak_first" className="bg-white dark:bg-[#0B0D11]">
                {tr('Semua Rugi di Awal (Skenario Terburuk)', 'All Losses First (Worst-Case Scenario)')}
              </option>
              <option value="win_streak_first" className="bg-white dark:bg-[#0B0D11]">
                {tr('Semua Menang di Awal', 'All Wins First')}
              </option>
              <option value="custom_loss_streak" className="bg-white dark:bg-[#0B0D11]">
                {tr('Rugi Beruntun Kustom di Awal (Uji Ketahanan)', 'Custom Consecutive Losses First (Stress Test)')}
              </option>
              <option value="monte_carlo_random" className="bg-white dark:bg-[#0B0D11]">
                {tr('Urutan Acak Realistis (Monte Carlo)', 'Realistic Random Sequence (Monte Carlo)')}
              </option>
            </select>
          </div>

          {/* Simulate Action */}
          <div>
            <button
              type="button"
              onClick={() => {
                if (sequenceMode === 'monte_carlo_random') {
                  setRandomSeedInput(String(randomSeed + 1));
                }
              }}
              className="w-full rounded-xl bg-[#151D2A] hover:bg-[#1E293B] dark:bg-[#161A22] dark:hover:bg-[#1D232E] text-white dark:text-[#F2F4F7] border border-black/10 dark:border-white/[0.14] text-xs font-semibold py-2.5 px-4 transition-colors"
            >
              {sequenceMode === 'monte_carlo_random'
                ? tr(`Acak Ulang Urutan (Seed #${randomSeed})`, `Randomize Sequence (Seed #${randomSeed})`)
                : tr('Jalankan Simulasi', 'Run Simulation')}
            </button>
          </div>
        </div>

        {/* Custom Consecutive Loss Sub-Controls (only when custom_loss_streak selected) */}
        {sequenceMode === 'custom_loss_streak' && (
          <div className="p-3.5 rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-[#151D2A] dark:text-[#F2F4F7]">
                {tr('Jumlah Rugi Beruntun di Awal:', 'Initial Consecutive Losses:')}
              </span>
              {CONSECUTIVE_LOSS_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setCustomLossStreakInput(String(preset))}
                  className={`px-2.5 py-1 rounded-md border text-xs font-mono-numbers tabular-nums transition-colors ${
                    customLossStreak === preset
                      ? 'bg-[#151D2A] text-white border-[#151D2A] dark:bg-[#161A22] dark:text-[#F2F4F7] dark:border-white/[0.2] font-semibold'
                      : 'bg-transparent text-[#667085] dark:text-[#98A2B3] border-[#DDE3EA] dark:border-[#20252D]'
                  }`}
                >
                  {preset}x
                </button>
              ))}
              <input
                type="number"
                step="1"
                min="0"
                max="500"
                value={customLossStreakInput}
                onChange={(e) => handleCleanNumberInput(e.target.value, setCustomLossStreakInput, false)}
                className="w-20 rounded-lg bg-white dark:bg-[#0B0D11] border border-[#DDE3EA] dark:border-[#20252D] px-2.5 py-1 text-xs font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F4F7] focus:outline-none"
              />
            </div>

            <span className="text-xs font-mono-numbers tabular-nums text-[#667085] dark:text-[#98A2B3]">
              {tr('Rugi Beruntun Diterapkan:', 'Applied Loss Streak:')} <strong>{simulation.actualInitialLossStreak} trade</strong>
            </span>
          </div>
        )}

        {simulation.isLossStreakExceedingTotalLosses && simulation.lossStreakWarningMessage && (
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-300 text-xs flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{simulation.lossStreakWarningMessage}</span>
          </div>
        )}

        {simulation.isRiskCappedByEquity && (
          <div className="p-3 rounded-xl bg-[#E05260]/10 border border-[#E05260]/25 text-[#E05260] text-xs flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              {tr(
                `Saldo akun menyentuh batas ekuitas minimum pada satu atau lebih transaksi; risiko otomatis dibatasi sebesar sisa saldo agar ekuitas tidak pernah turun di bawah ${formatCurrency(0, activeSettings)}.`,
                `Account balance reached minimum equity on one or more trades; risk was automatically capped to remaining equity so balance never drops below ${formatCurrency(0, activeSettings)}.`
              )}
            </span>
          </div>
        )}
      </div>

      {/* ==========================================================================
          3. RESULT SUMMARY SECTION
         ========================================================================== */}
      <div className="pt-5 border-t border-[#DDE3EA] dark:border-[#20252D] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F4F7]">
              {tr(`Ringkasan Hasil Simulasi (${tradesCount} Transaksi)`, `Simulation Summary (${tradesCount} Trades)`)}
            </h3>
            <button
              type="button"
              onClick={() => setShowReadingGuide((prev) => !prev)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-[#EEF2F6] dark:bg-[#101318] text-[#151D2A] dark:text-[#F2F4F7] border border-[#DDE3EA] dark:border-[#20252D]"
            >
              <HelpCircle className="w-3 h-3 text-[#3478DC]" />
              <span>{showReadingGuide ? tr('Tutup Panduan', 'Hide Guide') : tr('Cara Membaca', 'Reading Guide')}</span>
            </button>
          </div>

          {isRoundingAdjusted && sequenceMode !== 'monte_carlo_random' && (
            <span className="text-[11px] text-[#667085] dark:text-[#98A2B3] font-mono-numbers tabular-nums">
              {tr(
                `Pembulatan transaksi utuh: ${winRate}% dari ${tradesCount} trade = ${simulation.winCount}M / ${simulation.lossCount}R (${simulation.actualWinRatePercent.toFixed(1)}% aktual)`,
                `Whole-trade rounding: ${winRate}% of ${tradesCount} trades = ${simulation.winCount}W / ${simulation.lossCount}L (${simulation.actualWinRatePercent.toFixed(1)}% actual)`
              )}
            </span>
          )}
        </div>

        {showReadingGuide && (
          <div className="p-3.5 rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] text-[11px] text-[#667085] dark:text-[#98A2B3] grid grid-cols-1 md:grid-cols-2 gap-3 leading-relaxed">
            <div>
              <strong className="text-[#151D2A] dark:text-[#F2F4F7] block mb-0.5">
                {tr(
                  '• Perbedaan Metode Saldo Berjalan vs Modal Awal Tetap:',
                  '• Running Balance vs Fixed Initial Capital Method:'
                )}
              </strong>
              {tr(
                `Pada Saldo Berjalan (Compounding), nilai risiko (${riskType === 'percent' ? `${riskValue}%` : formatCurrency(riskValue, activeSettings)}) dihitung ulang dari saldo terbaru sebelum setiap trade. Pada Modal Awal Tetap (Risiko Konstan), risiko setiap trade selalu tetap sebesar ${formatCurrency(firstTradeRiskAmount, activeSettings)}.`,
                `In Running Balance (Compounding), the risk (${riskType === 'percent' ? `${riskValue}%` : formatCurrency(riskValue, activeSettings)}) is recalculated from your latest balance before each trade. In Fixed Initial Capital, every trade risks a constant ${formatCurrency(firstTradeRiskAmount, activeSettings)}.`
              )}
            </div>
            <div>
              <strong className="text-[#151D2A] dark:text-[#F2F4F7] block mb-0.5">
                • Expectancy ({simulation.expectancyR >= 0 ? '+' : ''}{simulation.expectancyR.toFixed(2)}R / {simulation.expectancyDollar >= 0 ? '+' : '-'}{formatCurrency(Math.abs(simulation.expectancyDollar), activeSettings)} per trade):
              </strong>
              {tr(
                'Jika bernilai positif (+), strategi Anda secara matematis menguntungkan dalam jangka panjang. Jika negatif (-), strategi akan menggerus modal meskipun sesekali profit.',
                'If positive (+), your strategy has a mathematical edge over the long run. If negative (-), the strategy will erode capital over time despite occasional wins.'
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Winning Trades */}
          <div className="p-3.5 rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D]">
            <span className="text-[11px] text-[#667085] dark:text-[#98A2B3] block mb-1">
              {tr('Transaksi Profit (Menang)', 'Winning Trades')}
            </span>
            <div className="text-lg font-bold font-mono-numbers tabular-nums text-[#059669] dark:text-[#00A878]">
              {simulation.winCount} Trade
            </div>
            <span className="text-[10px] font-mono-numbers tabular-nums text-[#667085] dark:text-[#98A2B3] block mt-0.5">
              {simulation.actualWinRatePercent.toFixed(1)}% {tr('dari', 'of')} {tradesCount} trade
            </span>
          </div>

          {/* Losing Trades */}
          <div className="p-3.5 rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D]">
            <span className="text-[11px] text-[#667085] dark:text-[#98A2B3] block mb-1">
              {tr('Transaksi Rugi (Kalah)', 'Losing Trades')}
            </span>
            <div className="text-lg font-bold font-mono-numbers tabular-nums text-[#E11D48] dark:text-[#E05260]">
              {simulation.lossCount} Trade
            </div>
            <span className="text-[10px] font-mono-numbers tabular-nums text-[#667085] dark:text-[#98A2B3] block mt-0.5">
              {simulation.actualLossRatePercent.toFixed(1)}% ({tr('Maks Rugi Beruntun', 'Max Loss Streak')}: {simulation.actualMaxLossStreak}x)
            </span>
          </div>

          {/* Net Profit / Loss */}
          <div className="p-3.5 rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D]">
            <span className="text-[11px] text-[#667085] dark:text-[#98A2B3] block mb-1">
              {tr('Profit / Rugi Bersih', 'Net Profit / Loss')}
            </span>
            <div
              className={`text-base sm:text-lg font-bold font-mono-numbers tabular-nums ${
                isProfit ? 'text-[#059669] dark:text-[#00A878]' : 'text-[#E11D48] dark:text-[#E05260]'
              }`}
            >
              {isProfit ? '+' : '-'}
              {formatCurrency(Math.abs(simulation.totalNetProfit), activeSettings)}
            </div>
            <span className="text-[10px] font-mono-numbers tabular-nums text-[#667085] dark:text-[#98A2B3] block mt-0.5">
              Expectancy: {simulation.expectancyR >= 0 ? '+' : ''}
              {simulation.expectancyR.toFixed(2)}R
            </span>
          </div>

          {/* Final Balance */}
          <div className="p-3.5 rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D]">
            <span className="text-[11px] text-[#667085] dark:text-[#98A2B3] block mb-1">
              {tr('Saldo Akhir', 'Final Balance')}
            </span>
            <div className="text-base sm:text-lg font-bold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F4F7]">
              {formatCurrency(simulation.finalBalance, activeSettings)}
            </div>
            <span className="text-[10px] font-mono-numbers tabular-nums text-[#667085] dark:text-[#98A2B3] block mt-0.5">
              {tr('Awal', 'Initial')}: {formatCurrency(simulation.startingCapital, activeSettings)}
            </span>
          </div>

          {/* Return (%) & Max DD */}
          <div className="p-3.5 rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D]">
            <span className="text-[11px] text-[#667085] dark:text-[#98A2B3] block mb-1">
              {tr('Pertumbuhan Modal', 'Capital Growth')}
            </span>
            <div
              className={`text-lg font-bold font-mono-numbers tabular-nums ${
                simulation.totalGainPercent >= 0
                  ? 'text-[#059669] dark:text-[#00A878]'
                  : 'text-[#E11D48] dark:text-[#E05260]'
              }`}
            >
              {simulation.totalGainPercent > 0 ? '+' : ''}
              {simulation.totalGainPercent.toFixed(2)}%
            </div>
            <span className="text-[10px] font-mono-numbers tabular-nums text-[#E11D48] dark:text-[#E05260] block mt-0.5">
              Max DD: -{simulation.maxDrawdownPercent.toFixed(2)}%
            </span>
          </div>

          {/* Profit Factor */}
          <div className="p-3.5 rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D]">
            <span className="text-[11px] text-[#667085] dark:text-[#98A2B3] block mb-1">
              {tr('Faktor Profit', 'Profit Factor')}
            </span>
            <div className="text-lg font-bold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F4F7]">
              {formattedProfitFactor}
            </div>
            <span className="text-[10px] font-mono-numbers tabular-nums text-[#667085] dark:text-[#98A2B3] block mt-0.5">
              {tr('Rasio', 'Ratio')} 1 : {rrRatio} R/R
            </span>
          </div>
        </div>
      </div>

      {/* ==========================================================================
          4. PERFORMANCE PROJECTION CHART
         ========================================================================== */}
      <div className="pt-5 border-t border-[#DDE3EA] dark:border-[#20252D] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F4F7]">
              {tr(`Grafik Proyeksi Ekuitas (${tradesCount} Transaksi)`, `Projected Equity Curve (${tradesCount} Trades)`)}
            </h3>
            <p className="text-xs text-[#667085] dark:text-[#98A2B3] mt-0.5 font-mono-numbers tabular-nums">
              {tr('Penurunan Maksimum (Max Drawdown)', 'Maximum Drawdown')}: -{simulation.maxDrawdownPercent.toFixed(2)}% (-
              {formatCurrency(simulation.maxDrawdownDollar, activeSettings)})
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowTradeTable((prev) => !prev)}
            className="px-3 py-1.5 rounded-lg border border-[#DDE3EA] dark:border-[#20252D] bg-[#F5F7FA] dark:bg-[#101318] text-xs font-semibold text-[#151D2A] dark:text-[#F2F4F7] hover:border-[#151D2A]/30 dark:hover:border-white/[0.2] self-start sm:self-auto transition-colors"
          >
            {showTradeTable
              ? tr('Sembunyikan Tabel Rincian Trade', 'Hide Trade Breakdown Table')
              : tr('Lihat Tabel Rincian per Trade', 'View Trade-by-Trade Breakdown')}
          </button>
        </div>

        <div className="w-full overflow-x-auto">
          <div className="min-w-[540px] h-[235px]">
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-full">
              <defs>
                <linearGradient id="tradeSimGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={primaryStrokeColor} stopOpacity="0.16" />
                  <stop offset="100%" stopColor={primaryStrokeColor} stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
                const y = padding.top + pct * innerHeight;
                const val = maxEquity - pct * (maxEquity - minEquity);
                return (
                  <g key={pct}>
                    <line
                      x1={padding.left}
                      y1={y}
                      x2={chartWidth - padding.right}
                      y2={y}
                      className="stroke-[#DDE3EA] dark:stroke-white/[0.06]"
                      strokeDasharray="4 4"
                    />
                    <text
                      x={padding.left - 8}
                      y={y + 4}
                      fill="#98A2B3"
                      fontSize="10"
                      textAnchor="end"
                      fontFamily="Arial, Helvetica, sans-serif"
                    >
                      {formatAxisValue(val, currency)}
                    </text>
                  </g>
                );
              })}

              {/* Baseline Starting Capital */}
              <line
                x1={padding.left}
                y1={getY(startingCapital)}
                x2={chartWidth - padding.right}
                y2={getY(startingCapital)}
                stroke="#98A2B3"
                strokeOpacity="0.45"
                strokeDasharray="3 3"
              />

              {/* Sample Monte Carlo Paths when in random mode */}
              {sequenceMode === 'monte_carlo_random' &&
                simulation.monteCarlo.samplePaths.map((sp) => {
                  const spPath = sp.curve
                    .map((eqVal, idx) => {
                      const x = getX(idx, sp.curve.length);
                      const y = getY(eqVal);
                      return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
                    })
                    .join(' ');
                  return (
                    <path
                      key={sp.runIndex}
                      d={spPath}
                      fill="none"
                      stroke="#98A2B3"
                      strokeWidth="1"
                      strokeOpacity="0.3"
                    />
                  );
                })}

              <path d={areaPath} fill="url(#tradeSimGrad)" />
              <path
                d={linePath}
                fill="none"
                stroke={primaryStrokeColor}
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              <text
                x={padding.left}
                y={chartHeight - 6}
                fill="#98A2B3"
                fontSize="10"
                fontFamily="Arial, Helvetica, sans-serif"
              >
                {tr('Trade #0 (Awal)', 'Trade #0 (Start)')}
              </text>
              <text
                x={padding.left + innerWidth / 2}
                y={chartHeight - 6}
                fill="#98A2B3"
                fontSize="10"
                textAnchor="middle"
                fontFamily="Arial, Helvetica, sans-serif"
              >
                Trade #{Math.max(1, Math.round(tradesCount / 2))}
              </text>
              <text
                x={chartWidth - padding.right}
                y={chartHeight - 6}
                fill="#98A2B3"
                fontSize="10"
                textAnchor="end"
                fontFamily="Arial, Helvetica, sans-serif"
              >
                Trade #{tradesCount}
              </text>
            </svg>
          </div>
        </div>

        {/* ========================================================================
            5. MONTE CARLO PROBABILITY SUMMARY
           ======================================================================== */}
        <div className="pt-4 border-t border-[#DDE3EA] dark:border-[#20252D] space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F4F7] block">
                {tr(
                  `Simulasi Probabilitas Monte Carlo (${simulation.monteCarlo.iterationsRun.toLocaleString('id-ID')} Skenario Acak · Seed #${simulation.monteCarlo.seedUsed})`,
                  `Monte Carlo Probability Simulation (${simulation.monteCarlo.iterationsRun.toLocaleString('en-US')} Random Runs · Seed #${simulation.monteCarlo.seedUsed})`
                )}
              </span>
              <span className="text-[11px] text-[#667085] dark:text-[#98A2B3]">
                {tr(
                  `Menguji ${simulation.monteCarlo.iterationsRun.toLocaleString('id-ID')} kemungkinan urutan Menang/Rugi acak untuk melihat batas terburuk, rata-rata, dan terbaik`,
                  `Testing ${simulation.monteCarlo.iterationsRun.toLocaleString('en-US')} randomized Win/Loss sequences to estimate worst, median, and best outcomes`
                )}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center p-0.5 rounded-lg bg-[#EEF2F6] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D]">
                {MONTE_CARLO_ITERATION_OPTIONS.map((iter) => (
                  <button
                    key={iter}
                    type="button"
                    onClick={() => setMonteCarloIterations(iter)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-mono-numbers tabular-nums transition-colors ${
                      monteCarloIterations === iter
                        ? 'bg-[#151D2A] text-white dark:bg-[#161A22] dark:text-[#F2F4F7] font-semibold'
                        : 'text-[#667085] dark:text-[#98A2B3] hover:text-[#151D2A] dark:hover:text-[#F2F4F7]'
                    }`}
                  >
                    {iter.toLocaleString('id-ID')}x
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setRandomSeedInput(String(randomSeed + 1))}
                className="px-3 py-1.5 rounded-lg border border-[#DDE3EA] dark:border-[#20252D] bg-[#F5F7FA] dark:bg-[#101318] text-xs font-medium text-[#151D2A] dark:text-[#F2F4F7] inline-flex items-center gap-1.5 transition-colors"
              >
                <RefreshCw className="h-3 w-3" />
                <span>Seed #{randomSeed}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-1 text-xs">
            <div className="p-3 rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D]">
              <span className="text-[11px] text-[#667085] dark:text-[#98A2B3] block mb-0.5">
                {tr('Kemungkinan Terburuk (P5)', 'Worst Case (P5)')}
              </span>
              <span className="text-sm font-bold font-mono-numbers tabular-nums text-[#E11D48] dark:text-[#E05260]">
                {formatCurrency(simulation.monteCarlo.p5WorstCase, activeSettings)}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D]">
              <span className="text-[11px] text-[#667085] dark:text-[#98A2B3] block mb-0.5">
                {tr('Hasil Tengah / Median (P50)', 'Median Outcome (P50)')}
              </span>
              <span className="text-sm font-bold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F4F7]">
                {formatCurrency(simulation.monteCarlo.medianFinalBalance, activeSettings)}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D]">
              <span className="text-[11px] text-[#667085] dark:text-[#98A2B3] block mb-0.5">
                {tr('Kemungkinan Terbaik (P95)', 'Best Case (P95)')}
              </span>
              <span className="text-sm font-bold font-mono-numbers tabular-nums text-[#059669] dark:text-[#00A878]">
                {formatCurrency(simulation.monteCarlo.p95BestCase, activeSettings)}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D]">
              <span className="text-[11px] text-[#667085] dark:text-[#98A2B3] block mb-0.5">
                {tr('Peluang Profit Akhir', 'Probability of Profit')}
              </span>
              <span className="text-sm font-bold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F4F7]">
                {simulation.monteCarlo.probabilityOfProfit.toFixed(1)}%
              </span>
            </div>

            <div className="col-span-2 sm:col-span-1 p-3 rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D]">
              <span className="text-[11px] text-[#667085] dark:text-[#98A2B3] block mb-0.5">
                {tr('Rata-rata Max Drawdown', 'Average Max Drawdown')}
              </span>
              <span className="text-sm font-bold font-mono-numbers tabular-nums text-[#E11D48] dark:text-[#E05260]">
                -{simulation.monteCarlo.averageMaxDrawdown.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>

        {/* ========================================================================
            6. COLLAPSIBLE TRADE-BY-TRADE TABLE (DENGAN MODAL AWAL TRADE)
           ======================================================================== */}
        {showTradeTable && (
          <div className="pt-4 border-t border-[#DDE3EA] dark:border-[#20252D] overflow-x-auto max-h-80 rounded-xl">
            <table className="w-full text-left text-xs text-[#151D2A] dark:text-[#F2F4F7]">
              <thead className="border-b border-[#DDE3EA] dark:border-[#20252D] bg-[#F5F7FA] dark:bg-[#101318] text-[11px] uppercase tracking-wider text-[#667085] dark:text-[#98A2B3] sticky top-0">
                <tr>
                  <th className="py-2.5 px-3">Trade</th>
                  <th className="py-2.5 px-3">{tr('Hasil', 'Result')}</th>
                  <th className="py-2.5 px-3 font-mono-numbers">{tr('Saldo Awal', 'Start Balance')}</th>
                  <th className="py-2.5 px-3 font-mono-numbers">{tr('Risiko (1R)', 'Risk (1R)')}</th>
                  <th className="py-2.5 px-3 font-mono-numbers">{tr('Profit / Rugi', 'Profit / Loss')}</th>
                  <th className="py-2.5 px-3 font-mono-numbers">{tr('Saldo Akhir', 'End Balance')}</th>
                  <th className="py-2.5 px-3 font-mono-numbers">Drawdown</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#DDE3EA] dark:divide-[#20252D] font-mono-numbers tabular-nums">
                {simulation.curve.slice(1).map((step, idx) => {
                  const prevEquity = simulation.curve[idx]?.equity ?? startingCapital;
                  return (
                    <tr
                      key={step.tradeNum}
                      className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="py-2 px-3 text-[#667085] dark:text-[#98A2B3]">
                        #{step.tradeNum}
                      </td>
                      <td
                        className={`py-2 px-3 font-sans font-semibold ${
                          step.isWin
                            ? 'text-[#059669] dark:text-[#00A878]'
                            : 'text-[#E11D48] dark:text-[#E05260]'
                        }`}
                      >
                        {step.isWin ? tr('MENANG', 'WIN') : tr('RUGI', 'LOSS')}
                      </td>
                      <td className="py-2 px-3 text-[#667085] dark:text-[#98A2B3]">
                        {formatCurrency(prevEquity, activeSettings)}
                      </td>
                      <td className="py-2 px-3 text-[#667085] dark:text-[#98A2B3]">
                        {formatCurrency(step.riskAmount, activeSettings)}
                      </td>
                      <td
                        className={`py-2 px-3 font-medium ${
                          step.pnl >= 0
                            ? 'text-[#059669] dark:text-[#00A878]'
                            : 'text-[#E11D48] dark:text-[#E05260]'
                        }`}
                      >
                        {step.pnl >= 0 ? '+' : '-'}
                        {formatCurrency(Math.abs(step.pnl), activeSettings)}
                      </td>
                      <td className="py-2 px-3 font-bold text-[#151D2A] dark:text-[#F2F4F7]">
                        {formatCurrency(step.equity, activeSettings)}
                      </td>
                      <td className="py-2 px-3 text-[#E11D48] dark:text-[#E05260]">
                        {step.drawdownPercent > 0 ? `-${step.drawdownPercent.toFixed(2)}%` : '0.00%'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
