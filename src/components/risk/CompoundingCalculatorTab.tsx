import React, { useState, useMemo, useEffect } from 'react';
import { AppSettings, CurrencyCode } from '../../types/settings';
import {
  calculateCompoundingGrowth,
  CompoundingInterval,
  DepositTiming,
  MIN_GROWTH_RATE_PERCENT,
  MAX_GROWTH_RATE_PERCENT,
} from '../../utils/compoundingCalculator';
import { formatCurrency } from '../../utils/calculations';
import { useGlobalCurrency } from '../../utils/currencyRate';
import { useLanguage } from '../../utils/language';
import { AlertTriangle, HelpCircle, ChevronDown, ArrowRightLeft } from 'lucide-react';

interface CompoundingCalculatorTabProps {
  settings: AppSettings;
  currentEquity: number;
}

type TableViewMode = 'comparison' | 'compounding_only' | 'fixed_only';

const DURATION_PRESETS = [
  { labelId: '3 Bulan', labelEn: '3 Months', shortLabelId: '3B', shortLabelEn: '3M', interval: 'monthly' as CompoundingInterval, duration: '3' },
  { labelId: '6 Bulan', labelEn: '6 Months', shortLabelId: '6B', shortLabelEn: '6M', interval: 'monthly' as CompoundingInterval, duration: '6' },
  { labelId: '12 Bulan', labelEn: '12 Months', shortLabelId: '12B', shortLabelEn: '12M', interval: 'monthly' as CompoundingInterval, duration: '12' },
  { labelId: '24 Bulan', labelEn: '24 Months', shortLabelId: '24B', shortLabelEn: '24M', interval: 'monthly' as CompoundingInterval, duration: '24' },
  { labelId: '30 Hari', labelEn: '30 Days', shortLabelId: '30H', shortLabelEn: '30D', interval: 'daily' as CompoundingInterval, duration: '30' },
];

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
function formatCapitalInputForDisplay(rawNumericStr: string, currency: CurrencyCode): string {
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

export const CompoundingCalculatorTab: React.FC<CompoundingCalculatorTabProps> = ({
  settings,
  currentEquity,
}) => {
  const { preferredCurrency, effectiveRate } = useGlobalCurrency();
  const { tr } = useLanguage();

  // Initialize currency from global preference (USD / IDR) or account settings
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

  const [interval, setInterval] = useState<CompoundingInterval>('monthly');
  const [growthRateInput, setGrowthRateInput] = useState<string>('5');
  const [durationInput, setDurationInput] = useState<string>('12');
  const [depositInput, setDepositInput] = useState<string>('0');
  const [depositTiming, setDepositTiming] = useState<DepositTiming>('end_of_period');
  const [showAdvancedDeposit, setShowAdvancedDeposit] = useState<boolean>(false);
  const [tableViewMode, setTableViewMode] = useState<TableViewMode>('comparison');
  const [showReadingGuide, setShowReadingGuide] = useState<boolean>(true);
  const [tablePage, setTablePage] = useState<number>(1);
  const rowsPerPage = 12;

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
    // EUR fallback
    return baseIsIdr
      ? Number((rawLiveBalance / rate).toFixed(2))
      : Number(rawLiveBalance.toFixed(2));
  }, [currentEquity, settings.startingBalance, settings.currency, currency, effectiveRate]);

  // Synchronize currency when user switches global USD/IDR preference in header/dashboard
  useEffect(() => {
    if (preferredCurrency && preferredCurrency !== currency && (currency === 'USD' || currency === 'IDR')) {
      handleCurrencySwitch(preferredCurrency);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferredCurrency]);

  const handleCurrencySwitch = (nextCurrency: CurrencyCode) => {
    if (nextCurrency === currency) return;
    const rate = effectiveRate > 0 ? effectiveRate : 16250;
    const currentCap = Math.max(0, parseFloat(startingCapitalInput) || 0);
    const currentDep = Math.max(0, parseFloat(depositInput) || 0);

    if (currency !== 'IDR' && nextCurrency === 'IDR') {
      // Convert USD/EUR -> IDR using live exchange rate
      const nextCap = currentCap > 0 ? Math.round(currentCap * rate) : 10_000_000;
      const nextDep = currentDep > 0 ? Math.round(currentDep * rate) : 0;
      setStartingCapitalInput(String(nextCap));
      setDepositInput(String(nextDep));
    } else if (currency === 'IDR' && nextCurrency !== 'IDR') {
      // Convert IDR -> USD/EUR using live exchange rate
      const nextCap = currentCap > 0 ? Number((currentCap / rate).toFixed(2)) : 1000;
      const nextDep = currentDep > 0 ? Number((currentDep / rate).toFixed(2)) : 0;
      setStartingCapitalInput(String(nextCap));
      setDepositInput(String(nextDep));
    }

    setCurrency(nextCurrency);
    setTablePage(1);
  };

  const startingCapital = Math.max(
    0,
    currency === 'IDR'
      ? Math.round(parseFloat(startingCapitalInput) || 0)
      : parseFloat(startingCapitalInput) || 0
  );

  const rawParsedGrowthRate =
    growthRateInput === '' || growthRateInput === '-' || growthRateInput === '-.'
      ? 0
      : parseFloat(growthRateInput);
  const growthRate = Number.isFinite(rawParsedGrowthRate) ? rawParsedGrowthRate : 0;
  const isGrowthRateOutOfBounds =
    Number.isFinite(rawParsedGrowthRate) &&
    (rawParsedGrowthRate < MIN_GROWTH_RATE_PERCENT || rawParsedGrowthRate > MAX_GROWTH_RATE_PERCENT);

  const duration = Math.max(1, Math.min(365, parseInt(durationInput, 10) || 1));
  const regularDeposit = Math.max(
    0,
    currency === 'IDR'
      ? Math.round(parseFloat(depositInput) || 0)
      : parseFloat(depositInput) || 0
  );

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

  // Compute BOTH Compounding and Fixed Balance (Profit Withdrawn) simultaneously
  const compoundingResult = useMemo(() => {
    return calculateCompoundingGrowth({
      startingCapital,
      growthRatePercent: growthRate,
      interval,
      duration,
      regularDeposit,
      depositTiming,
      mode: 'compounding',
    });
  }, [startingCapital, growthRate, interval, duration, regularDeposit, depositTiming]);

  const withdrawnResult = useMemo(() => {
    return calculateCompoundingGrowth({
      startingCapital,
      growthRatePercent: growthRate,
      interval,
      duration,
      regularDeposit,
      depositTiming,
      mode: 'fixed_withdrawn',
    });
  }, [startingCapital, growthRate, interval, duration, regularDeposit, depositTiming]);

  const intervalUnitLabel =
    interval === 'daily'
      ? tr('Hari', 'Day')
      : interval === 'weekly'
      ? tr('Minggu', 'Week')
      : tr('Bulan', 'Month');
  const intervalReturnLabel =
    interval === 'daily'
      ? tr('Target Return Harian (%)', 'Daily Target Return (%)')
      : interval === 'weekly'
      ? tr('Target Return Mingguan (%)', 'Weekly Target Return (%)')
      : tr('Target Return Bulanan (%)', 'Monthly Target Return (%)');

  const handleCapitalOrDepositInput = (rawVal: string, setter: (s: string) => void) => {
    if (rawVal === '') {
      setter('');
      return;
    }
    if (currency === 'IDR') {
      // In IDR mode, dots and commas typed by users are thousand separators, strip all non-digits
      const digits = rawVal.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
      setter(digits);
      return;
    }
    // In USD/EUR mode, allow standard decimal numbers
    let cleaned = rawVal.replace(/,/g, '.').replace(/^0+(?=\d)/, '');
    cleaned = cleaned.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    if (parts.length > 2) {
      cleaned = `${parts[0]}.${parts.slice(1).join('')}`;
    }
    setter(cleaned);
  };

  const handleCleanNumberInput = (
    val: string,
    setter: (s: string) => void,
    allowDecimal = true,
    allowNegative = false
  ) => {
    if (val === '') {
      setter('');
      return;
    }
    if (allowNegative && (val === '-' || val === '-0' || val === '-.')) {
      setter(val);
      return;
    }
    const isNeg = allowNegative && val.startsWith('-');
    const unsigned = isNeg ? val.slice(1) : val;
    let cleaned = unsigned.replace(/,/g, '.').replace(/^0+(?=\d)/, '');
    if (!allowDecimal) {
      cleaned = cleaned.replace(/[^0-9]/g, '');
    } else {
      cleaned = cleaned.replace(/[^0-9.]/g, '');
      const parts = cleaned.split('.');
      if (parts.length > 2) {
        cleaned = `${parts[0]}.${parts.slice(1).join('')}`;
      }
    }
    setter(isNeg ? `-${cleaned}` : cleaned);
  };

  const formatSignedCurrency = (amount: number) => {
    if (amount > 0) return `+${formatCurrency(amount, activeSettings)}`;
    if (amount < 0) return `-${formatCurrency(Math.abs(amount), activeSettings)}`;
    return formatCurrency(0, activeSettings);
  };

  const formatSignedPercent = (pct: number) => {
    if (pct > 0) return `+${pct.toFixed(2)}%`;
    return `${pct.toFixed(2)}%`;
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

  // Compounding vs Fixed Balance difference
  const compoundingAdvantageAmount =
    compoundingResult.combinedTotalWealth - withdrawnResult.combinedTotalWealth;
  const compoundingAdvantagePercent =
    compoundingResult.totalContributedCapital > 0
      ? (compoundingAdvantageAmount / compoundingResult.totalContributedCapital) * 100
      : 0;
  const fixedPeriodProfit =
    withdrawnResult.steps.length > 0 ? withdrawnResult.steps[0].growthProfit : 0;

  // Pagination for table
  const totalPages = Math.max(1, Math.ceil(compoundingResult.steps.length / rowsPerPage));
  const startIdx = (tablePage - 1) * rowsPerPage;
  const paginatedCompSteps = compoundingResult.steps.slice(startIdx, startIdx + rowsPerPage);

  // Chart geometry (wider left padding so IDR labels never clip)
  const chartHeight = 235;
  const chartWidth = 720;
  const padding = { top: 22, right: 24, bottom: 30, left: 86 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  const allPlottedValues = [
    startingCapital,
    ...compoundingResult.steps.map((s) => s.endBalance),
    ...withdrawnResult.steps.map((s) => s.endBalance),
    ...withdrawnResult.steps.map((s) => s.combinedWealth),
  ];

  const maxBalance = Math.max(...allPlottedValues, 1);
  const minBalance = Math.min(...allPlottedValues);

  const getY = (val: number) => {
    if (maxBalance === minBalance) return padding.top + innerHeight / 2;
    const norm = (val - minBalance) / (maxBalance - minBalance);
    return padding.top + innerHeight - norm * innerHeight;
  };

  const getX = (idx: number, total: number) => {
    if (total <= 1) return padding.left;
    return padding.left + (idx / (total - 1)) * innerWidth;
  };

  const totalPoints = compoundingResult.steps.length + 1;
  const points = [
    {
      x: getX(0, totalPoints),
      compY: getY(startingCapital),
      fixedWealthY: getY(startingCapital),
      fixedBalY: getY(startingCapital),
      period: 0,
    },
    ...compoundingResult.steps.map((s, idx) => {
      const wStep = withdrawnResult.steps[idx];
      return {
        x: getX(idx + 1, totalPoints),
        compY: getY(s.endBalance),
        fixedWealthY: getY(wStep ? wStep.combinedWealth : startingCapital),
        fixedBalY: getY(wStep ? wStep.endBalance : startingCapital),
        period: s.period,
      };
    }),
  ];

  const compLinePath = points
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.compY.toFixed(1)}`)
    .join(' ');
  const compAreaPath = `${compLinePath} L ${points[points.length - 1].x.toFixed(1)} ${
    chartHeight - padding.bottom
  } L ${points[0].x.toFixed(1)} ${chartHeight - padding.bottom} Z`;

  const fixedWealthLinePath = points
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.fixedWealthY.toFixed(1)}`)
    .join(' ');

  const fixedBalanceLinePath = points
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.fixedBalY.toFixed(1)}`)
    .join(' ');

  const isNegativeGrowth = compoundingResult.clampedGrowthRatePercent < 0;
  const primaryStrokeColor = isNegativeGrowth ? '#E05260' : '#3478DC';

  const capitalPresets = currency === 'IDR' ? CAPITAL_PRESETS_IDR : CAPITAL_PRESETS_USD;
  const step1Comp = compoundingResult.steps[0];
  const step2Comp = compoundingResult.steps[1];
  const step1Fixed = withdrawnResult.steps[0];

  return (
    <div className="space-y-6 pt-2">
      {/* ==========================================================================
          1. HEADER & CURRENCY / BALANCE CONTROLS
         ========================================================================== */}
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#DDE3EA] dark:border-[#20252D]">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F4F7]">
              {tr('Simulator Compounding', 'Compounding Simulator')}
            </h2>
            <p className="text-xs text-[#667085] dark:text-[#98A2B3] mt-0.5">
              {tr(
                'Proyeksi pertumbuhan modal (Compounding vs Saldo Tetap / Tarik Profit) dalam USD & IDR',
                'Capital growth projection (Compounding vs Fixed Balance / Profit Withdrawal) in USD & IDR'
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

            {/* Use Current Account Balance Button (automatically formatted in active currency) */}
            <button
              type="button"
              onClick={() => {
                setStartingCapitalInput(String(liveAccountBalanceInSelectedCurrency));
                setTablePage(1);
              }}
              className="px-3 py-1.5 rounded-lg border border-[#DDE3EA] dark:border-[#20252D] bg-[#F5F7FA] dark:bg-[#101318] hover:border-[#151D2A]/30 dark:hover:border-white/[0.2] text-xs font-medium text-[#151D2A] dark:text-[#F2F4F7] transition-colors font-mono-numbers tabular-nums"
            >
              {tr('Gunakan Saldo Akun', 'Use Account Balance')} ({formatCurrency(liveAccountBalanceInSelectedCurrency, activeSettings)})
            </button>
          </div>
        </div>

        {/* ========================================================================
            2. MAIN INPUT PARAMETERS
           ======================================================================== */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
                value={formatCapitalInputForDisplay(startingCapitalInput, currency)}
                onChange={(e) => {
                  handleCapitalOrDepositInput(e.target.value, setStartingCapitalInput);
                  setTablePage(1);
                }}
                className={`w-full rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] ${
                  currency === 'IDR' ? 'pl-9' : 'pl-7'
                } pr-3.5 py-2.5 text-sm font-semibold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F4F7] focus:border-[#151D2A] dark:focus:border-white/[0.28] focus:outline-none transition-colors`}
                placeholder={currency === 'IDR' ? '10.000.000' : '1000'}
              />
            </div>

            {/* Quick Capital Presets for IDR / USD */}
            <div className="flex flex-wrap items-center gap-1 mt-2">
              {capitalPresets.map((preset) => {
                const isSelected = Math.abs(startingCapital - preset.value) < 0.01;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setStartingCapitalInput(String(preset.value));
                      setTablePage(1);
                    }}
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

          {/* Return (%) & Periode */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[#667085] dark:text-[#98A2B3]">
                {intervalReturnLabel}
              </label>
              <select
                value={interval}
                onChange={(e) => {
                  setInterval(e.target.value as CompoundingInterval);
                  setTablePage(1);
                }}
                className="bg-transparent text-[11px] font-semibold text-[#151D2A] dark:text-[#F2F4F7] focus:outline-none cursor-pointer"
              >
                <option value="monthly" className="bg-white dark:bg-[#0B0D11] text-[#151D2A] dark:text-[#F2F4F7]">
                  {tr('Per Bulan', 'Monthly')}
                </option>
                <option value="weekly" className="bg-white dark:bg-[#0B0D11] text-[#151D2A] dark:text-[#F2F4F7]">
                  {tr('Per Minggu', 'Weekly')}
                </option>
                <option value="daily" className="bg-white dark:bg-[#0B0D11] text-[#151D2A] dark:text-[#F2F4F7]">
                  {tr('Per Hari', 'Daily')}
                </option>
              </select>
            </div>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                value={growthRateInput}
                onChange={(e) => handleCleanNumberInput(e.target.value, setGrowthRateInput, true, true)}
                className="w-full rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] px-3.5 pr-8 py-2.5 text-sm font-semibold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F4F7] focus:border-[#151D2A] dark:focus:border-white/[0.28] focus:outline-none transition-colors"
                placeholder="5"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-mono-numbers text-[#667085] dark:text-[#98A2B3] pointer-events-none">
                %
              </span>
            </div>
            <p className="text-[10px] font-mono-numbers tabular-nums text-[#667085] dark:text-[#98A2B3] mt-1.5">
              {tr('Profit periode ke-1', '1st period profit')}: {formatSignedCurrency(step1Comp ? step1Comp.growthProfit : 0)}
            </p>
          </div>

          {/* Durasi Periode */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[#667085] dark:text-[#98A2B3]">
                {tr('Durasi', 'Duration')} ({intervalUnitLabel})
              </label>
              <div className="flex items-center gap-1">
                {DURATION_PRESETS.slice(0, 4).map((p) => {
                  const isActive = interval === p.interval && durationInput === p.duration;
                  return (
                    <button
                      key={p.labelId}
                      type="button"
                      onClick={() => {
                        setInterval(p.interval);
                        setDurationInput(p.duration);
                        setTablePage(1);
                      }}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-mono-numbers tabular-nums transition-colors border ${
                        isActive
                          ? 'bg-[#151D2A] text-white border-[#151D2A] dark:bg-[#161A22] dark:text-[#F2F4F7] dark:border-white/[0.2] font-semibold'
                          : 'bg-transparent text-[#667085] dark:text-[#98A2B3] border-transparent hover:text-[#151D2A] dark:hover:text-[#F2F4F7]'
                      }`}
                    >
                      {tr(p.shortLabelId, p.shortLabelEn)}
                    </button>
                  );
                })}
              </div>
            </div>
            <input
              type="number"
              step="1"
              min="1"
              max="365"
              value={durationInput}
              onChange={(e) => {
                handleCleanNumberInput(e.target.value, setDurationInput, false);
                setTablePage(1);
              }}
              className="w-full rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] px-3.5 py-2.5 text-sm font-semibold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F4F7] focus:border-[#151D2A] dark:focus:border-white/[0.28] focus:outline-none transition-colors"
              placeholder="12"
            />
            <p className="text-[10px] text-[#667085] dark:text-[#98A2B3] mt-1.5">
              {tr(
                `Simulasi selama ${duration} ${intervalUnitLabel.toLowerCase()} ke depan`,
                `Simulated over the next ${duration} ${intervalUnitLabel.toLowerCase()}${duration > 1 ? 's' : ''}`
              )}
            </p>
          </div>

          {/* Tambah Deposit Rutin & Reset */}
          <div className="flex flex-col justify-between gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#667085] dark:text-[#98A2B3]">
                {tr('Setoran Tambahan', 'Recurring Deposit')}
              </span>
              {regularDeposit > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setDepositInput('0');
                    setShowAdvancedDeposit(false);
                  }}
                  className="text-[10px] text-[#E05260] hover:underline"
                >
                  {tr('Reset Deposit', 'Reset Deposit')}
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowAdvancedDeposit((prev) => !prev)}
              className={`w-full rounded-xl border px-3.5 py-2.5 text-xs font-semibold transition-colors flex items-center justify-between ${
                showAdvancedDeposit || regularDeposit > 0
                  ? 'bg-[#EEF2F6] dark:bg-[#161A22] border-[#151D2A]/20 dark:border-white/[0.16] text-[#151D2A] dark:text-[#F2F4F7]'
                  : 'bg-[#F5F7FA] dark:bg-[#101318] border-[#DDE3EA] dark:border-[#20252D] text-[#667085] dark:text-[#98A2B3] hover:text-[#151D2A] dark:hover:text-[#F2F4F7]'
              }`}
            >
              <span className="truncate font-mono-numbers tabular-nums">
                {regularDeposit > 0
                  ? `+${formatCurrency(regularDeposit, activeSettings)} / ${intervalUnitLabel}`
                  : tr('+ Tambah Deposit Rutin (Opsional)', '+ Add Recurring Deposit (Optional)')}
              </span>
              <ChevronDown
                className={`w-3.5 h-3.5 shrink-0 transition-transform ${
                  showAdvancedDeposit ? 'rotate-180' : ''
                }`}
              />
            </button>

            <p className="text-[10px] text-[#667085] dark:text-[#98A2B3]">
              {regularDeposit > 0
                ? `${tr('Total setoran', 'Total deposits')}: ${formatCurrency(compoundingResult.totalDeposits, activeSettings)}`
                : tr('Tanpa deposit tambahan per periode', 'No additional deposit per period')}
            </p>
          </div>
        </div>

        {/* Optional Regular Deposit Section */}
        {(showAdvancedDeposit || regularDeposit > 0) && (
          <div className="p-4 rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#667085] dark:text-[#98A2B3] mb-1.5">
                {tr(`Deposit Rutin per ${intervalUnitLabel}`, `Recurring Deposit per ${intervalUnitLabel}`)} ({activeSettings.currencySymbol})
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold font-mono-numbers text-[#667085] dark:text-[#98A2B3] pointer-events-none">
                  {activeSettings.currencySymbol}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={formatCapitalInputForDisplay(depositInput, currency)}
                  onChange={(e) => handleCapitalOrDepositInput(e.target.value, setDepositInput)}
                  className={`w-full rounded-xl bg-white dark:bg-[#0B0D11] border border-[#DDE3EA] dark:border-[#20252D] ${
                    currency === 'IDR' ? 'pl-9' : 'pl-7'
                  } pr-3.5 py-2 text-sm font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F4F7] focus:border-[#151D2A] dark:focus:border-white/[0.28] focus:outline-none transition-colors`}
                  placeholder="0"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#667085] dark:text-[#98A2B3] mb-1.5">
                {tr('Waktu Setor Deposit (Mode Compounding)', 'Deposit Timing (Compounding Mode)')}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDepositTiming('end_of_period')}
                  className={`py-2 px-3 rounded-lg border text-xs font-semibold transition-colors ${
                    depositTiming === 'end_of_period'
                      ? 'bg-[#151D2A] text-white border-[#151D2A] dark:bg-[#161A22] dark:text-[#F2F4F7] dark:border-white/[0.18]'
                      : 'bg-white dark:bg-[#0B0D11] text-[#667085] dark:text-[#98A2B3] border-[#DDE3EA] dark:border-[#20252D]'
                  }`}
                >
                  {tr('Akhir Periode', 'End of Period')}
                </button>
                <button
                  type="button"
                  onClick={() => setDepositTiming('start_of_period')}
                  className={`py-2 px-3 rounded-lg border text-xs font-semibold transition-colors ${
                    depositTiming === 'start_of_period'
                      ? 'bg-[#151D2A] text-white border-[#151D2A] dark:bg-[#161A22] dark:text-[#F2F4F7] dark:border-white/[0.18]'
                      : 'bg-white dark:bg-[#0B0D11] text-[#667085] dark:text-[#98A2B3] border-[#DDE3EA] dark:border-[#20252D]'
                  }`}
                >
                  {tr('Awal Periode', 'Start of Period')}
                </button>
              </div>
            </div>
          </div>
        )}

        {isGrowthRateOutOfBounds && (
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-300 text-xs flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              {tr(
                `Persentase return dibatasi pada rentang matematis (${MIN_GROWTH_RATE_PERCENT}% s/d +${MAX_GROWTH_RATE_PERCENT}%). Nilai yang digunakan: ${compoundingResult.clampedGrowthRatePercent}%.`,
                `Return percentage is bounded within mathematical limits (${MIN_GROWTH_RATE_PERCENT}% to +${MAX_GROWTH_RATE_PERCENT}%). Applied value: ${compoundingResult.clampedGrowthRatePercent}%.`
              )}
            </span>
          </div>
        )}
      </div>

      {/* ==========================================================================
          3. SIDE-BY-SIDE SUMMARY: SKENARIO 1 (COMPOUNDING) vs SKENARIO 2 (FIXED BALANCE)
         ========================================================================== */}
      <div className="pt-5 border-t border-[#DDE3EA] dark:border-[#20252D] space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* SKENARIO 1: MODE COMPOUNDING (PROFIT DIGULUNG) */}
          <div className="p-4 rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] space-y-3.5">
            <div className="flex items-start justify-between gap-2 pb-3 border-b border-[#DDE3EA] dark:border-[#20252D]">
              <div>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#3478DC]" />
                  <span className="text-xs font-bold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F4F7]">
                    {tr('Skenario 1: Mode Compounding', 'Scenario 1: Compounding Mode')}
                  </span>
                </div>
                <p className="text-[11px] text-[#667085] dark:text-[#98A2B3] mt-1">
                  {tr(
                    `Profit tidak ditarik — langsung digabung ke modal ${intervalUnitLabel.toLowerCase()} berikutnya (bunga berbunga).`,
                    `Profits are not withdrawn — reinvested directly into the next ${intervalUnitLabel.toLowerCase()}'s principal.`
                  )}
                </p>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#3478DC]/15 text-[#3478DC] shrink-0">
                {tr('Profit Digulung', 'Reinvested')}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-[11px] text-[#667085] dark:text-[#98A2B3] block mb-1">
                  {tr('Saldo Akhir Akun', 'Ending Account Balance')} ({duration} {intervalUnitLabel})
                </span>
                <div className="text-lg sm:text-xl font-bold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F4F7]">
                  {formatCurrency(compoundingResult.endingBalance, activeSettings)}
                </div>
                <span className="text-[11px] font-mono-numbers tabular-nums text-[#667085] dark:text-[#98A2B3] block mt-0.5">
                  {tr('Modal Awal', 'Initial Capital')}: {formatCurrency(startingCapital, activeSettings)}
                </span>
              </div>

              <div>
                <span className="text-[11px] text-[#667085] dark:text-[#98A2B3] block mb-1">
                  {tr('Total Profit Compound', 'Total Compounded Profit')}
                </span>
                <div
                  className={`text-lg sm:text-xl font-bold font-mono-numbers tabular-nums ${
                    compoundingResult.pureGrowthProfit >= 0
                      ? 'text-[#059669] dark:text-[#00A878]'
                      : 'text-[#E11D48] dark:text-[#E05260]'
                  }`}
                >
                  {formatSignedCurrency(compoundingResult.pureGrowthProfit)}
                </div>
                <span className="text-[11px] font-mono-numbers tabular-nums text-[#667085] dark:text-[#98A2B3] block mt-0.5">
                  {tr('Pertumbuhan', 'Total Growth')}: {formatSignedPercent(compoundingResult.profitToTotalContributedPercent)}
                </span>
              </div>
            </div>

            <div className="pt-2.5 border-t border-[#DDE3EA] dark:border-[#20252D] flex items-center justify-between text-[11px] text-[#667085] dark:text-[#98A2B3]">
              <span>{tr(`Alur Profit per ${intervalUnitLabel}:`, `Profit Flow per ${intervalUnitLabel}:`)}</span>
              <span className="font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F4F7]">
                {step1Comp ? formatSignedCurrency(step1Comp.growthProfit) : '0'}
                {step2Comp ? ` → ${formatSignedCurrency(step2Comp.growthProfit)} → ...` : ''} ({tr('Makin Besar', 'Growing')})
              </span>
            </div>
          </div>

          {/* SKENARIO 2: MODE FIXED BALANCE (PROFIT DITARIK TIAP PERIODE) */}
          <div className="p-4 rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] space-y-3.5">
            <div className="flex items-start justify-between gap-2 pb-3 border-b border-[#DDE3EA] dark:border-[#20252D]">
              <div>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#00A878]" />
                  <span className="text-xs font-bold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F4F7]">
                    {tr('Skenario 2: Mode Saldo Tetap', 'Scenario 2: Fixed Balance Mode')}
                  </span>
                </div>
                <p className="text-[11px] text-[#667085] dark:text-[#98A2B3] mt-1">
                  {tr(
                    `Profit selalu ditarik keluar setiap akhir ${intervalUnitLabel.toLowerCase()} — modal di akun dijaga tetap.`,
                    `Profits are withdrawn at the end of every ${intervalUnitLabel.toLowerCase()} — principal in account stays constant.`
                  )}
                </p>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#00A878]/15 text-[#059669] dark:text-[#00A878] shrink-0">
                {tr('Profit Ditarik', 'Withdrawn')}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <span className="text-[11px] text-[#667085] dark:text-[#98A2B3] block mb-1">
                  {tr('Saldo Tetap di Akun', 'Fixed Account Balance')}
                </span>
                <div className="text-sm sm:text-base font-bold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F4F7]">
                  {formatCurrency(withdrawnResult.endingBalance, activeSettings)}
                </div>
                <span className="text-[10px] text-[#667085] dark:text-[#98A2B3] block mt-0.5">
                  {tr('Modal tidak berubah', 'Principal unchanged')}
                </span>
              </div>

              <div>
                <span className="text-[11px] text-[#667085] dark:text-[#98A2B3] block mb-1">
                  {tr('Total Profit Ditarik', 'Total Withdrawn Profit')}
                </span>
                <div
                  className={`text-sm sm:text-base font-bold font-mono-numbers tabular-nums ${
                    withdrawnResult.totalWithdrawnProfit >= 0
                      ? 'text-[#059669] dark:text-[#00A878]'
                      : 'text-[#E11D48] dark:text-[#E05260]'
                  }`}
                >
                  {formatSignedCurrency(withdrawnResult.totalWithdrawnProfit)}
                </div>
                <span className="text-[10px] font-mono-numbers tabular-nums text-[#667085] dark:text-[#98A2B3] block mt-0.5">
                  {duration}x {tr('tarik', 'withdrawals')} @ {formatCurrency(Math.max(0, fixedPeriodProfit), activeSettings)}
                </span>
              </div>

              <div>
                <span className="text-[11px] text-[#667085] dark:text-[#98A2B3] block mb-1">
                  {tr('Total Hasil Gabungan', 'Combined Total Wealth')}
                </span>
                <div className="text-sm sm:text-base font-bold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F4F7]">
                  {formatCurrency(withdrawnResult.combinedTotalWealth, activeSettings)}
                </div>
                <span className="text-[10px] text-[#667085] dark:text-[#98A2B3] block mt-0.5">
                  {tr('Saldo Akun + Tarik', 'Account + Withdrawn')}
                </span>
              </div>
            </div>

            <div className="pt-2.5 border-t border-[#DDE3EA] dark:border-[#20252D] flex items-center justify-between text-[11px] text-[#667085] dark:text-[#98A2B3]">
              <span>{tr(`Alur Profit per ${intervalUnitLabel}:`, `Profit Flow per ${intervalUnitLabel}:`)}</span>
              <span className="font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F4F7]">
                {tr(
                  `Tetap ${step1Fixed ? formatSignedCurrency(step1Fixed.growthProfit) : '0'} setiap ${intervalUnitLabel.toLowerCase()}`,
                  `Constant ${step1Fixed ? formatSignedCurrency(step1Fixed.growthProfit) : '0'} each ${intervalUnitLabel.toLowerCase()}`
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Ringkasan Selisih Efek Compounding */}
        {compoundingAdvantageAmount > 0 && (
          <div className="px-4 py-3 rounded-xl bg-[#EEF2F6]/70 dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <span className="text-[#667085] dark:text-[#98A2B3]">
              {tr(
                `Keunggulan Mode Compounding dibanding Saldo Tetap setelah ${duration} ${intervalUnitLabel.toLowerCase()}:`,
                `Compounding Mode advantage over Fixed Balance after ${duration} ${intervalUnitLabel.toLowerCase()}${duration > 1 ? 's' : ''}:`
              )}
            </span>
            <span className="font-mono-numbers tabular-nums font-bold text-[#059669] dark:text-[#00A878]">
              +{formatCurrency(compoundingAdvantageAmount, activeSettings)} {tr('lebih besar', 'higher')} ({formatSignedPercent(compoundingAdvantagePercent)})
            </span>
          </div>
        )}
      </div>

      {/* ==========================================================================
          4. GROWTH PROJECTION CHART (3 Jelas Garis: Compounding, Total Hasil Fixed, Saldo Akun Fixed)
         ========================================================================== */}
      <div className="pt-5 border-t border-[#DDE3EA] dark:border-[#20252D] space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F4F7]">
              {tr('Grafik Proyeksi Pertumbuhan', 'Growth Projection Chart')}
            </h3>
            <p className="text-[11px] text-[#667085] dark:text-[#98A2B3] mt-0.5">
              {tr(
                'Perbandingan kurva eksponensial Compounding vs garis lurus Saldo Tetap',
                'Comparison of exponential Compounding curve vs linear Fixed Balance growth'
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-[11px]">
            <span className="inline-flex items-center gap-1.5 text-[#151D2A] dark:text-[#F2F4F7] font-medium">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: primaryStrokeColor }}
              />
              <span>
                {tr('Saldo Compounding', 'Compounding Balance')} ({formatCurrency(compoundingResult.endingBalance, activeSettings)})
              </span>
            </span>

            <span className="inline-flex items-center gap-1.5 text-[#667085] dark:text-[#98A2B3]">
              <span className="h-0.5 w-3.5 bg-[#00A878] inline-block" />
              <span>
                {tr('Total Hasil Tetap: Modal + Profit Ditarik', 'Fixed Total Wealth: Principal + Withdrawn')} ({formatCurrency(withdrawnResult.combinedTotalWealth, activeSettings)})
              </span>
            </span>

            <span className="inline-flex items-center gap-1.5 text-[#667085] dark:text-[#98A2B3]">
              <span className="h-0.5 w-3.5 bg-[#667085] dark:bg-[#98A2B3] inline-block opacity-70" />
              <span>
                {tr('Saldo Tetap di Akun', 'Fixed Account Balance')} ({formatCurrency(withdrawnResult.endingBalance, activeSettings)})
              </span>
            </span>
          </div>
        </div>

        <div className="w-full overflow-x-auto">
          <div className="min-w-[540px] h-[235px]">
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-full">
              <defs>
                <linearGradient id="compGrowthGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={primaryStrokeColor} stopOpacity="0.16" />
                  <stop offset="100%" stopColor={primaryStrokeColor} stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
                const y = padding.top + pct * innerHeight;
                const val = maxBalance - pct * (maxBalance - minBalance);
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

              <path d={compAreaPath} fill="url(#compGrowthGrad)" />

              {/* Line 3: Fixed Account Balance (Flat Principal in Trading Account) */}
              <path
                d={fixedBalanceLinePath}
                fill="none"
                stroke="#667085"
                strokeWidth="1.25"
                strokeDasharray="2 3"
                strokeOpacity="0.7"
              />

              {/* Line 2: Fixed Profit Total Wealth Line (Principal + Cumulative Withdrawn Profit) */}
              <path
                d={fixedWealthLinePath}
                fill="none"
                stroke="#00A878"
                strokeWidth="1.75"
                strokeDasharray="5 4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Line 1: Compounding Ending Balance Line */}
              <path
                d={compLinePath}
                fill="none"
                stroke={primaryStrokeColor}
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* X Axis Labels */}
              <text
                x={padding.left}
                y={chartHeight - 6}
                fill="#98A2B3"
                fontSize="10"
                fontFamily="Arial, Helvetica, sans-serif"
              >
                {tr('Awal', 'Start')} ({intervalUnitLabel} 0)
              </text>
              <text
                x={padding.left + innerWidth / 2}
                y={chartHeight - 6}
                fill="#98A2B3"
                fontSize="10"
                textAnchor="middle"
                fontFamily="Arial, Helvetica, sans-serif"
              >
                {intervalUnitLabel} {Math.max(1, Math.round(duration / 2))}
              </text>
              <text
                x={chartWidth - padding.right}
                y={chartHeight - 6}
                fill="#98A2B3"
                fontSize="10"
                textAnchor="end"
                fontFamily="Arial, Helvetica, sans-serif"
              >
                {intervalUnitLabel} {duration}
              </text>
            </svg>
          </div>
        </div>
      </div>

      {/* ==========================================================================
          5. CARA MEMBACA SIMULASI & TABEL PROJECTION PERIODE DEMI PERIODE
         ========================================================================== */}
      <div className="pt-5 border-t border-[#DDE3EA] dark:border-[#20252D] space-y-4">
        {/* Interactive Guide Toggle & Table Mode Selector */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F4F7]">
              {tr(`Tabel Rincian Proyeksi per ${intervalUnitLabel}`, `Projection Breakdown per ${intervalUnitLabel}`)}
            </h3>
            <button
              type="button"
              onClick={() => setShowReadingGuide((prev) => !prev)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-[#EEF2F6] dark:bg-[#101318] text-[#151D2A] dark:text-[#F2F4F7] border border-[#DDE3EA] dark:border-[#20252D]"
            >
              <HelpCircle className="w-3 h-3 text-[#3478DC]" />
              <span>{showReadingGuide ? tr('Tutup Panduan Baca', 'Hide Reading Guide') : tr('Cara Membaca Tabel', 'How to Read Table')}</span>
            </button>
          </div>

          {/* Mode Tampilan Tabel */}
          <div className="inline-flex items-center p-0.5 rounded-lg bg-[#EEF2F6] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setTableViewMode('comparison')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                tableViewMode === 'comparison'
                  ? 'bg-[#151D2A] text-white dark:bg-[#161A22] dark:text-[#F2F4F7] border border-black/10 dark:border-white/[0.14]'
                  : 'text-[#667085] dark:text-[#98A2B3] hover:text-[#151D2A] dark:hover:text-[#F2F4F7]'
              }`}
            >
              {tr('Perbandingan', 'Comparison')}
            </button>
            <button
              type="button"
              onClick={() => setTableViewMode('compounding_only')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                tableViewMode === 'compounding_only'
                  ? 'bg-[#151D2A] text-white dark:bg-[#161A22] dark:text-[#F2F4F7] border border-black/10 dark:border-white/[0.14]'
                  : 'text-[#667085] dark:text-[#98A2B3] hover:text-[#151D2A] dark:hover:text-[#F2F4F7]'
              }`}
            >
              {tr('Fokus Compound', 'Compounding Only')}
            </button>
            <button
              type="button"
              onClick={() => setTableViewMode('fixed_only')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                tableViewMode === 'fixed_only'
                  ? 'bg-[#151D2A] text-white dark:bg-[#161A22] dark:text-[#F2F4F7] border border-black/10 dark:border-white/[0.14]'
                  : 'text-[#667085] dark:text-[#98A2B3] hover:text-[#151D2A] dark:hover:text-[#F2F4F7]'
              }`}
            >
              {tr('Fokus Saldo Tetap', 'Fixed Balance Only')}
            </button>
          </div>
        </div>

        {/* Panduan Cara Membaca Simulasi (Menggunakan Angka Aktual Pengguna) */}
        {showReadingGuide && step1Comp && (
          <div className="p-4 rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] space-y-2.5 text-xs">
            <div className="font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
              {tr(
                `Cara Membaca Perbandingan Simulasi Ini (Modal Awal ${formatCurrency(startingCapital, activeSettings)}, Return ${compoundingResult.clampedGrowthRatePercent}% per ${intervalUnitLabel.toLowerCase()}):`,
                `How to Read This Simulation Comparison (Initial Capital ${formatCurrency(startingCapital, activeSettings)}, Return ${compoundingResult.clampedGrowthRatePercent}% per ${intervalUnitLabel.toLowerCase()}):`
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] text-[#667085] dark:text-[#98A2B3] leading-relaxed">
              <div className="p-3 rounded-lg bg-white dark:bg-[#0B0D11] border border-[#DDE3EA] dark:border-[#20252D]">
                <span className="font-semibold text-[#3478DC] block mb-1">
                  {tr('1. Kolom Skenario Compounding (Gulung Modal)', '1. Compounding Scenario Columns (Reinvested Profit)')}
                </span>
                {tr(
                  `Pada ${intervalUnitLabel} 1, modal ${formatCurrency(step1Comp.startBalance, activeSettings)} menghasilkan profit ${formatSignedCurrency(step1Comp.growthProfit)} sehingga Saldo Akhir menjadi ${formatCurrency(step1Comp.endBalance, activeSettings)}.`,
                  `In ${intervalUnitLabel} 1, principal ${formatCurrency(step1Comp.startBalance, activeSettings)} generates ${formatSignedCurrency(step1Comp.growthProfit)} profit, bringing Ending Balance to ${formatCurrency(step1Comp.endBalance, activeSettings)}.`
                )}
                {step2Comp && (
                  <>
                    {' '}
                    {tr(
                      `Pada ${intervalUnitLabel} 2, profit ${compoundingResult.clampedGrowthRatePercent}% dihitung dari saldo baru ${formatCurrency(step2Comp.startBalance, activeSettings)} (bukan modal awal lagi), menghasilkan ${formatSignedCurrency(step2Comp.growthProfit)} → Saldo naik ke ${formatCurrency(step2Comp.endBalance, activeSettings)}.`,
                      `In ${intervalUnitLabel} 2, the ${compoundingResult.clampedGrowthRatePercent}% return is calculated from the new balance ${formatCurrency(step2Comp.startBalance, activeSettings)} (not the initial principal), generating ${formatSignedCurrency(step2Comp.growthProfit)} → Balance rises to ${formatCurrency(step2Comp.endBalance, activeSettings)}.`
                    )}
                  </>
                )}
              </div>

              <div className="p-3 rounded-lg bg-white dark:bg-[#0B0D11] border border-[#DDE3EA] dark:border-[#20252D]">
                <span className="font-semibold text-[#059669] dark:text-[#00A878] block mb-1">
                  {tr('2. Kolom Skenario Saldo Tetap (Tarik Profit)', '2. Fixed Balance Scenario Columns (Withdrawn Profit)')}
                </span>
                {tr(
                  `Setiap akhir ${intervalUnitLabel.toLowerCase()}, profit sebesar ${formatSignedCurrency(step1Fixed ? step1Fixed.growthProfit : 0)} langsung ditarik ke rekening bank. Akibatnya:`,
                  `At the end of every ${intervalUnitLabel.toLowerCase()}, the ${formatSignedCurrency(step1Fixed ? step1Fixed.growthProfit : 0)} profit is withdrawn to your bank account. As a result:`
                )}
                <ul className="list-disc list-inside mt-1 space-y-0.5">
                  <li>
                    {tr(
                      `Saldo di Akun tetap ${formatCurrency(step1Fixed ? step1Fixed.endBalance : startingCapital, activeSettings)}.`,
                      `Account Balance remains fixed at ${formatCurrency(step1Fixed ? step1Fixed.endBalance : startingCapital, activeSettings)}.`
                    )}
                  </li>
                  <li>
                    {tr(
                      `Tarik Kumulatif adalah total uang profit yang sudah Anda kantongi sejak ${intervalUnitLabel} 1.`,
                      `Cumulative Withdrawn is the total profit pocketed since ${intervalUnitLabel} 1.`
                    )}
                  </li>
                  <li>
                    {tr(
                      'Total Hasil = Saldo di Akun + Total Profit yang sudah ditarik.',
                      'Combined Total = Account Balance + Total Withdrawn Profit.'
                    )}
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* TABLE VIEW 1: SIDE-BY-SIDE COMPARISON WITH GROUP HEADERS */}
        {tableViewMode === 'comparison' && (
          <div className="overflow-x-auto rounded-xl border border-[#DDE3EA] dark:border-[#20252D]">
            <table className="w-full text-left text-xs text-[#151D2A] dark:text-[#F2F4F7]">
              <thead>
                {/* Group Header Row */}
                <tr className="border-b border-[#DDE3EA] dark:border-[#20252D] bg-[#EEF2F6]/70 dark:bg-[#101318] text-[10px] font-bold uppercase tracking-wider">
                  <th className="py-2 px-3 text-[#667085] dark:text-[#98A2B3] border-r border-[#DDE3EA] dark:border-[#20252D]">
                    {tr('Periode', 'Period')}
                  </th>
                  <th
                    colSpan={3}
                    className="py-2 px-3 text-[#3478DC] border-r border-[#DDE3EA] dark:border-[#20252D]"
                  >
                    {tr('Skenario 1: Compounding (Profit Digulung)', 'Scenario 1: Compounding (Reinvested Profit)')}
                  </th>
                  <th
                    colSpan={3}
                    className="py-2 px-3 text-[#059669] dark:text-[#00A878] border-r border-[#DDE3EA] dark:border-[#20252D]"
                  >
                    {tr('Skenario 2: Saldo Tetap (Profit Ditarik)', 'Scenario 2: Fixed Balance (Withdrawn Profit)')}
                  </th>
                  <th className="py-2 px-3 text-[#151D2A] dark:text-[#F2F4F7]">
                    {tr('Selisih', 'Difference')}
                  </th>
                </tr>

                {/* Sub-Column Header Row */}
                <tr className="border-b border-[#DDE3EA] dark:border-[#20252D] bg-[#F5F7FA] dark:bg-[#0B0D11] text-[11px] uppercase tracking-wider text-[#667085] dark:text-[#98A2B3]">
                  <th className="py-2.5 px-3 border-r border-[#DDE3EA] dark:border-[#20252D]">
                    {intervalUnitLabel}
                  </th>
                  {/* Compounding columns */}
                  <th className="py-2.5 px-3 font-mono-numbers">{tr('Modal Awal', 'Start Balance')}</th>
                  <th className="py-2.5 px-3 font-mono-numbers">{tr(`Profit ${intervalUnitLabel} Ini`, `Period Profit`)}</th>
                  <th className="py-2.5 px-3 font-mono-numbers border-r border-[#DDE3EA] dark:border-[#20252D]">
                    {tr('Saldo Akhir', 'End Balance')}
                  </th>
                  {/* Fixed Balance columns */}
                  <th className="py-2.5 px-3 font-mono-numbers">{tr('Saldo di Akun', 'Account Balance')}</th>
                  <th className="py-2.5 px-3 font-mono-numbers">{tr('Tarik Kumulatif', 'Cum. Withdrawn')}</th>
                  <th className="py-2.5 px-3 font-mono-numbers border-r border-[#DDE3EA] dark:border-[#20252D]">
                    {tr('Total Hasil', 'Combined Total')}
                  </th>
                  {/* Advantage column */}
                  <th className="py-2.5 px-3 font-mono-numbers">{tr('Efek Compound', 'Compound Advantage')}</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-[#DDE3EA] dark:divide-[#20252D] font-mono-numbers tabular-nums">
                {paginatedCompSteps.map((cStep, idx) => {
                  const globalIdx = startIdx + idx;
                  const wStep = withdrawnResult.steps[globalIdx];
                  const fixedTotal = wStep ? wStep.combinedWealth : startingCapital;
                  const diff = cStep.combinedWealth - fixedTotal;
                  return (
                    <tr
                      key={cStep.period}
                      className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="py-2.5 px-3 font-sans font-semibold text-[#667085] dark:text-[#98A2B3] border-r border-[#DDE3EA] dark:border-[#20252D]">
                        {intervalUnitLabel} {cStep.period}
                      </td>
                      {/* Compounding */}
                      <td className="py-2.5 px-3 text-[#667085] dark:text-[#98A2B3]">
                        {formatCurrency(cStep.startBalance, activeSettings)}
                      </td>
                      <td
                        className={`py-2.5 px-3 ${
                          cStep.growthProfit >= 0
                            ? 'text-[#059669] dark:text-[#00A878]'
                            : 'text-[#E11D48] dark:text-[#E05260]'
                        }`}
                      >
                        {formatSignedCurrency(cStep.growthProfit)}
                      </td>
                      <td className="py-2.5 px-3 font-bold text-[#151D2A] dark:text-[#F2F4F7] border-r border-[#DDE3EA] dark:border-[#20252D]">
                        {formatCurrency(cStep.endBalance, activeSettings)}
                      </td>

                      {/* Fixed Balance */}
                      <td className="py-2.5 px-3 text-[#667085] dark:text-[#98A2B3]">
                        {formatCurrency(wStep ? wStep.endBalance : startingCapital, activeSettings)}
                      </td>
                      <td
                        className={`py-2.5 px-3 ${
                          (wStep?.cumulativeWithdrawnProfit ?? 0) >= 0
                            ? 'text-[#059669] dark:text-[#00A878]'
                            : 'text-[#E11D48] dark:text-[#E05260]'
                        }`}
                      >
                        {formatSignedCurrency(wStep ? wStep.cumulativeWithdrawnProfit : 0)}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-[#151D2A] dark:text-[#F2F4F7] border-r border-[#DDE3EA] dark:border-[#20252D]">
                        {formatCurrency(fixedTotal, activeSettings)}
                      </td>

                      {/* Selisih Efek Compound */}
                      <td
                        className={`py-2.5 px-3 font-semibold ${
                          diff > 0
                            ? 'text-[#3478DC]'
                            : diff < 0
                            ? 'text-[#E11D48] dark:text-[#E05260]'
                            : 'text-[#667085] dark:text-[#98A2B3]'
                        }`}
                      >
                        {formatSignedCurrency(diff)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* TABLE VIEW 2: FOKUS COMPOUNDING */}
        {tableViewMode === 'compounding_only' && (
          <div className="overflow-x-auto rounded-xl border border-[#DDE3EA] dark:border-[#20252D]">
            <table className="w-full text-left text-xs text-[#151D2A] dark:text-[#F2F4F7]">
              <thead className="border-b border-[#DDE3EA] dark:border-[#20252D] bg-[#F5F7FA] dark:bg-[#101318] text-[11px] uppercase tracking-wider text-[#667085] dark:text-[#98A2B3]">
                <tr>
                  <th className="py-2.5 px-3">{intervalUnitLabel}</th>
                  <th className="py-2.5 px-3 font-mono-numbers">{tr('Modal Awal Periode', 'Period Start Balance')}</th>
                  <th className="py-2.5 px-3 font-mono-numbers">
                    {tr('Profit Periode', 'Period Profit')} ({compoundingResult.clampedGrowthRatePercent}%)
                  </th>
                  {regularDeposit > 0 && (
                    <th className="py-2.5 px-3 font-mono-numbers">{tr('Deposit Rutin', 'Recurring Deposit')}</th>
                  )}
                  <th className="py-2.5 px-3 font-mono-numbers">{tr('Saldo Akhir Compound', 'Compounded End Balance')}</th>
                  <th className="py-2.5 px-3 font-mono-numbers">{tr('Total Profit Kumulatif', 'Cumulative Profit')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#DDE3EA] dark:divide-[#20252D] font-mono-numbers tabular-nums">
                {paginatedCompSteps.map((cStep) => (
                  <tr
                    key={cStep.period}
                    className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="py-2.5 px-3 font-sans font-semibold text-[#667085] dark:text-[#98A2B3]">
                      {intervalUnitLabel} {cStep.period}
                    </td>
                    <td className="py-2.5 px-3 text-[#667085] dark:text-[#98A2B3]">
                      {formatCurrency(cStep.startBalance, activeSettings)}
                    </td>
                    <td
                      className={`py-2.5 px-3 font-medium ${
                        cStep.growthProfit >= 0
                          ? 'text-[#059669] dark:text-[#00A878]'
                          : 'text-[#E11D48] dark:text-[#E05260]'
                      }`}
                    >
                      {formatSignedCurrency(cStep.growthProfit)}
                    </td>
                    {regularDeposit > 0 && (
                      <td className="py-2.5 px-3 text-[#667085] dark:text-[#98A2B3]">
                        +{formatCurrency(cStep.deposit, activeSettings)}
                      </td>
                    )}
                    <td className="py-2.5 px-3 font-bold text-[#151D2A] dark:text-[#F2F4F7]">
                      {formatCurrency(cStep.endBalance, activeSettings)}
                    </td>
                    <td
                      className={`py-2.5 px-3 font-semibold ${
                        cStep.cumulativeProfit >= 0
                          ? 'text-[#059669] dark:text-[#00A878]'
                          : 'text-[#E11D48] dark:text-[#E05260]'
                      }`}
                    >
                      {formatSignedCurrency(cStep.cumulativeProfit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* TABLE VIEW 3: FOKUS FIXED BALANCE (TARIK PROFIT) */}
        {tableViewMode === 'fixed_only' && (
          <div className="overflow-x-auto rounded-xl border border-[#DDE3EA] dark:border-[#20252D]">
            <table className="w-full text-left text-xs text-[#151D2A] dark:text-[#F2F4F7]">
              <thead className="border-b border-[#DDE3EA] dark:border-[#20252D] bg-[#F5F7FA] dark:bg-[#101318] text-[11px] uppercase tracking-wider text-[#667085] dark:text-[#98A2B3]">
                <tr>
                  <th className="py-2.5 px-3">{intervalUnitLabel}</th>
                  <th className="py-2.5 px-3 font-mono-numbers">{tr('Saldo Tetap di Akun', 'Fixed Account Balance')}</th>
                  <th className="py-2.5 px-3 font-mono-numbers">
                    {tr(`Profit Ditarik ${intervalUnitLabel} Ini`, `Profit Withdrawn This ${intervalUnitLabel}`)}
                  </th>
                  <th className="py-2.5 px-3 font-mono-numbers">
                    {tr('Akumulasi Profit Ditarik (Di Bank)', 'Cumulative Withdrawn Profit (Bank)')}
                  </th>
                  <th className="py-2.5 px-3 font-mono-numbers">
                    {tr('Total Hasil (Saldo Akun + Profit Ditarik)', 'Combined Total (Account + Withdrawn)')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#DDE3EA] dark:divide-[#20252D] font-mono-numbers tabular-nums">
                {paginatedCompSteps.map((cStep, idx) => {
                  const globalIdx = startIdx + idx;
                  const wStep = withdrawnResult.steps[globalIdx];
                  if (!wStep) return null;
                  return (
                    <tr
                      key={wStep.period}
                      className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="py-2.5 px-3 font-sans font-semibold text-[#667085] dark:text-[#98A2B3]">
                        {intervalUnitLabel} {wStep.period}
                      </td>
                      <td className="py-2.5 px-3 text-[#667085] dark:text-[#98A2B3]">
                        {formatCurrency(wStep.endBalance, activeSettings)}
                      </td>
                      <td
                        className={`py-2.5 px-3 ${
                          wStep.withdrawnProfit >= 0
                            ? 'text-[#059669] dark:text-[#00A878]'
                            : 'text-[#E11D48] dark:text-[#E05260]'
                        }`}
                      >
                        {formatSignedCurrency(wStep.withdrawnProfit)}
                      </td>
                      <td
                        className={`py-2.5 px-3 font-semibold ${
                          wStep.cumulativeWithdrawnProfit >= 0
                            ? 'text-[#059669] dark:text-[#00A878]'
                            : 'text-[#E11D48] dark:text-[#E05260]'
                        }`}
                      >
                        {formatSignedCurrency(wStep.cumulativeWithdrawnProfit)}
                      </td>
                      <td className="py-2.5 px-3 font-bold text-[#151D2A] dark:text-[#F2F4F7]">
                        {formatCurrency(wStep.combinedWealth, activeSettings)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-3 border-t border-[#DDE3EA] dark:border-[#20252D] text-xs">
            <button
              type="button"
              onClick={() => setTablePage((p) => Math.max(1, p - 1))}
              disabled={tablePage <= 1}
              className="px-3.5 py-1.5 rounded-lg border border-[#DDE3EA] dark:border-[#20252D] bg-[#F5F7FA] dark:bg-[#101318] text-[#151D2A] dark:text-[#F2F4F7] disabled:opacity-40 transition-colors"
            >
              {tr('Sebelumnya', 'Previous')}
            </button>
            <span className="font-mono-numbers tabular-nums text-[#667085] dark:text-[#98A2B3]">
              {tr('Halaman', 'Page')} {tablePage} {tr('dari', 'of')} {totalPages} ({compoundingResult.steps.length} {intervalUnitLabel})
            </span>
            <button
              type="button"
              onClick={() => setTablePage((p) => Math.min(totalPages, p + 1))}
              disabled={tablePage >= totalPages}
              className="px-3.5 py-1.5 rounded-lg border border-[#DDE3EA] dark:border-[#20252D] bg-[#F5F7FA] dark:bg-[#101318] text-[#151D2A] dark:text-[#F2F4F7] disabled:opacity-40 transition-colors"
            >
              {tr('Berikutnya', 'Next')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
