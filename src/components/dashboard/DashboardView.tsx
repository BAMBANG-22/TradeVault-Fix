/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Trade } from '../../types/trade';
import { AppSettings } from '../../types/settings';
import {
  calculatePerformance,
  computePeriodTradesAndStartingBalance,
  computeTradeNetProfit,
  resolveTradeOutcome,
  formatCurrency,
  formatGrowthPercent,
  DashboardPeriodPreset,
  DASHBOARD_PERIOD_OPTIONS,
  resolveDashboardPeriodDates,
} from '../../utils/calculations';
import {
  UsdIdrRateRecord,
  PRIVACY_MODE_STORAGE_KEY,
  DASHBOARD_CURRENCY_PREF_KEY,
  getCachedUsdIdrRate,
  fetchLiveUsdIdrRate,
  computeDualCurrencyDisplay,
  calculateCapitalGrowthBreakdown,
  formatTradeFinancialValue,
  computeCumulativeProfitInDisplayCurrency,
  formatDynamicAmount,
} from '../../utils/currencyRate';
import { EquityChart } from './EquityChart';
import { DashboardCalendar } from './DashboardCalendar';
import { RiskSnapshot } from './RiskSnapshot';
import { Eye, EyeOff, ChevronDown, Check, ArrowRight, Plus, ArrowUpDown } from 'lucide-react';
import { useLanguage } from '../../utils/language';

interface DashboardViewProps {
  trades: Trade[];
  settings: AppSettings;
  onNavigate: (tab: string) => void;
  onAddTrade: () => void;
  onViewTrade: (trade: Trade) => void;
  onClearDemoTrades?: () => void;
  onDeleteTradesByDate?: (payload: {
    dateKey: string;
    headerLabel?: string;
    trades: Trade[];
    source: 'calendar';
    isFilteredSubset?: boolean;
    totalTradesOnDate?: number;
  }) => void;
}

const PERIOD_SHORT_LABELS: Record<DashboardPeriodPreset, string> = {
  '1D': '1D',
  '7D': '1W',
  '1M': '1M',
  '3M': '3M',
  '6M': '6M',
  '1Y': '1Y',
  'ALL': 'ALL',
};

const PERIOD_EN_LABELS: Record<DashboardPeriodPreset, string> = {
  '1D': 'Last 1 Day',
  '7D': 'Last 7 Days',
  '1M': 'Last 1 Month',
  '3M': 'Last 3 Months',
  '6M': 'Last 6 Months',
  '1Y': 'Last 1 Year',
  'ALL': 'All Time',
};

function formatRecentTradeDate(dateTimeStr: string, locale: string = 'id-ID'): string {
  if (!dateTimeStr) return '-';
  try {
    const dt = new Date(dateTimeStr);
    if (!isNaN(dt.getTime())) {
      const datePart = dt.toLocaleDateString(locale, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
      const timePart = dateTimeStr.includes('T') ? dateTimeStr.split('T')[1]?.slice(0, 5) : '';
      return timePart ? `${datePart} · ${timePart}` : datePart;
    }
  } catch {
    // Fallback below
  }
  return dateTimeStr.replace('T', ' · ').slice(0, 18);
}

function formatUsdNominalPnl(netProfit: number, isPrivacyMode: boolean): string {
  if (isPrivacyMode) {
    return '******';
  }
  const safe = Number.isFinite(netProfit) ? netProfit : 0;
  const rounded = Number(safe.toFixed(2));
  if (Math.abs(rounded) < 0.01) {
    return '$0.00';
  }
  const formattedAbs = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(rounded));
  return rounded > 0 ? `+${formattedAbs}` : `-${formattedAbs}`;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  trades,
  settings,
  onNavigate,
  onAddTrade,
  onViewTrade,
  onDeleteTradesByDate,
}) => {
  const { isEn, locale, tr } = useLanguage();

  // Global Privacy Mode (Hide Balance) persisted in localStorage
  const [isPrivacyMode, setIsPrivacyMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem(PRIVACY_MODE_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const syncPrivacyFromEvent = () => {
      try {
        setIsPrivacyMode(localStorage.getItem(PRIVACY_MODE_STORAGE_KEY) === 'true');
      } catch {
        // Ignore storage read errors
      }
    };
    window.addEventListener('tradevault-privacy-change', syncPrivacyFromEvent);
    window.addEventListener('storage', syncPrivacyFromEvent);
    return () => {
      window.removeEventListener('tradevault-privacy-change', syncPrivacyFromEvent);
      window.removeEventListener('storage', syncPrivacyFromEvent);
    };
  }, []);

  const handleTogglePrivacy = () => {
    const next = !isPrivacyMode;
    setIsPrivacyMode(next);
    try {
      localStorage.setItem(PRIVACY_MODE_STORAGE_KEY, String(next));
      window.dispatchEvent(new Event('tradevault-privacy-change'));
    } catch {
      // Ignore storage write errors
    }
  };

  // Live USD/IDR Exchange Rate state with localStorage cache fallback
  const [rateRecord, setRateRecord] = useState<UsdIdrRateRecord | null>(() =>
    getCachedUsdIdrRate()
  );

  const refreshExchangeRate = useCallback(async (signal?: AbortSignal) => {
    try {
      const record = await fetchLiveUsdIdrRate(signal);
      if (!signal?.aborted) {
        setRateRecord(record);
      }
    } catch {
      // Keep cached rate on network failure
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    refreshExchangeRate(controller.signal);

    const intervalId = window.setInterval(() => {
      refreshExchangeRate();
    }, 15 * 60 * 1000);

    return () => {
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [refreshExchangeRate]);

  // Overall Account Performance (All-Time) for Total Balance calculation
  const allTimePerformance = useMemo(
    () => calculatePerformance(trades, settings),
    [trades, settings]
  );

  const capitalBreakdown = useMemo(
    () =>
      calculateCapitalGrowthBreakdown(settings, allTimePerformance.metrics.totalNetProfit),
    [settings, allTimePerformance.metrics.totalNetProfit]
  );

  // User's active primary currency preference ('USD' | 'IDR')
  const [preferredCurrency, setPreferredCurrency] = useState<'USD' | 'IDR'>(() => {
    try {
      const stored = localStorage.getItem(DASHBOARD_CURRENCY_PREF_KEY);
      if (stored === 'USD' || stored === 'IDR') return stored;
    } catch {
      // Ignore storage read errors
    }
    return settings.currency === 'IDR' ? 'IDR' : 'USD';
  });

  useEffect(() => {
    const onPrefChange = () => {
      try {
        const stored = localStorage.getItem(DASHBOARD_CURRENCY_PREF_KEY);
        if (stored === 'USD' || stored === 'IDR') {
          setPreferredCurrency(stored);
        }
      } catch {
        // Ignore
      }
    };
    window.addEventListener('tradevault-currency-pref-change', onPrefChange);
    return () => window.removeEventListener('tradevault-currency-pref-change', onPrefChange);
  }, []);

  const [isSwapping, setIsSwapping] = useState<boolean>(false);

  const handleSwapCurrency = () => {
    setIsSwapping(true);
    const next: 'USD' | 'IDR' = preferredCurrency === 'USD' ? 'IDR' : 'USD';
    setPreferredCurrency(next);
    try {
      localStorage.setItem(DASHBOARD_CURRENCY_PREF_KEY, next);
      window.dispatchEvent(new Event('tradevault-currency-pref-change'));
    } catch {
      // Ignore storage write errors
    }
    setTimeout(() => {
      setIsSwapping(false);
    }, 240);
  };

  // Dual Currency Presentation (Strictly USD & IDR on Dashboard)
  const dualBalance = useMemo(
    () =>
      computeDualCurrencyDisplay(
        capitalBreakdown.currentBalance,
        settings.currency,
        rateRecord,
        isPrivacyMode,
        preferredCurrency
      ),
    [
      capitalBreakdown.currentBalance,
      settings.currency,
      rateRecord,
      isPrivacyMode,
      preferredCurrency,
    ]
  );

  // Period Dropdown State ('1D' | '7D' | '1M' | '3M' | '6M' | '1Y' | 'ALL')
  const [selectedPeriod, setSelectedPeriod] = useState<DashboardPeriodPreset>('ALL');
  const [isPeriodMenuOpen, setIsPeriodMenuOpen] = useState<boolean>(false);
  const periodMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isPeriodMenuOpen) return;

    const handleOutsideClick = (e: MouseEvent) => {
      if (periodMenuRef.current && !periodMenuRef.current.contains(e.target as Node)) {
        setIsPeriodMenuOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsPeriodMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isPeriodMenuOpen]);

  const { startDate: periodStartDate, endDate: periodEndDate } = useMemo(
    () => resolveDashboardPeriodDates(selectedPeriod),
    [selectedPeriod]
  );

  // Base settings using pure contributed capital (so deposits/withdrawals are never treated as trading profit)
  const effectiveCapitalSettings = useMemo(
    () => ({
      ...settings,
      startingBalance:
        capitalBreakdown.netContributedCapital > 0
          ? capitalBreakdown.netContributedCapital
          : settings.startingBalance,
    }),
    [settings, capitalBreakdown.netContributedCapital]
  );

  // Period-filtered trades & starting balance using the exact same Analytics engine
  const { filteredTrades: periodTrades, periodStartingBalance } = useMemo(
    () =>
      computePeriodTradesAndStartingBalance(
        trades,
        effectiveCapitalSettings,
        periodStartDate,
        periodEndDate
      ),
    [trades, effectiveCapitalSettings, periodStartDate, periodEndDate]
  );

  const periodSettings = useMemo(
    () => ({
      ...effectiveCapitalSettings,
      startingBalance: periodStartingBalance,
    }),
    [effectiveCapitalSettings, periodStartingBalance]
  );

  const { metrics: periodMetrics, equityCurve: periodEquityCurve } = useMemo(
    () => calculatePerformance(periodTrades, periodSettings),
    [periodTrades, periodSettings]
  );

  // Recent Trades: Maximum 3 latest trades sorted chronologically descending
  const recentThreeTrades = useMemo(
    () =>
      [...trades]
        .sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime())
        .slice(0, 3),
    [trades]
  );

  const isPeriodProfitPositive = periodMetrics.totalNetProfit >= 0;

  const todayFormattedDate = useMemo(() => {
    try {
      return new Date().toLocaleDateString(locale, {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return '';
    }
  }, [locale]);

  const periodDropdownControl = (
    <div ref={periodMenuRef} className="relative">
      <button
        type="button"
        data-testid="dashboard-period-dropdown-button"
        onClick={() => setIsPeriodMenuOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isPeriodMenuOpen}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] hover:border-[#0F172A]/40 dark:hover:border-white/40 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
      >
        <span>
          {selectedPeriod === 'ALL'
            ? tr('SEMUA', 'ALL')
            : PERIOD_SHORT_LABELS[selectedPeriod] || selectedPeriod}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 stroke-[2] text-[#526071] dark:text-[#929BA9] transition-transform duration-150 ${
            isPeriodMenuOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isPeriodMenuOpen && (
        <div
          role="listbox"
          aria-label={tr('Pilih Periode Performa', 'Select Performance Period')}
          data-testid="dashboard-period-dropdown-menu"
          className="absolute right-0 top-full mt-1.5 z-30 w-44 rounded-xl bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] py-1 shadow-xl"
        >
          {DASHBOARD_PERIOD_OPTIONS.map((opt) => {
            const isSelected = selectedPeriod === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-testid={`dashboard-period-option-${opt.id}`}
                onClick={() => {
                  setSelectedPeriod(opt.id);
                  setIsPeriodMenuOpen(false);
                }}
                className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-[#F4F4F5] dark:bg-[#161A22] text-[#0F172A] dark:text-white font-semibold'
                    : 'text-[#0F172A] dark:text-[#F2F4F7] hover:bg-[#FAFAFA] dark:hover:bg-[#161A22]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold">
                    {opt.id === 'ALL' ? tr('SEMUA', 'ALL') : PERIOD_SHORT_LABELS[opt.id]}
                  </span>
                  <span className="text-[#526071] dark:text-[#929BA9] text-[11px]">
                    {isEn ? PERIOD_EN_LABELS[opt.id] : opt.label}
                  </span>
                </div>
                {isSelected && <Check className="h-3.5 w-3.5 stroke-[2] text-[#0F172A] dark:text-white" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* TOP HEADER: DASHBOARD TITLE & CURRENT DATE */}
      <div className="flex items-center justify-between pb-3 border-b border-[#E4E4E7] dark:border-[#20252D]">
        <h1 className="text-xs font-bold uppercase tracking-[0.12em] text-[#0F172A] dark:text-[#F2F4F7]">
          {tr('DASBOR', 'DASHBOARD')}
        </h1>
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] font-medium text-[#526071] dark:text-[#929BA9]">
            {todayFormattedDate}
          </span>
        </div>
      </div>

      {/* BAND 1: 1. ACCOUNT BALANCE + 2. ACCOUNT PERFORMANCE */}
      <div className="space-y-6 md:space-y-0 md:grid md:grid-cols-12 md:gap-8 md:items-start">
        {/* 1. ACCOUNT BALANCE (Direct on background, zero card wrapper) */}
        <section aria-label={tr('Saldo Akun', 'Account Balance')} className="py-1 md:col-span-5 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5 min-w-0 flex-1">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#526071] dark:text-[#929BA9]">
                {tr('SALDO AKUN', 'ACCOUNT BALANCE')}
              </span>

              {/* Balances layout with vertical stack and swap button on the right */}
              <div className="flex items-center justify-between gap-4 pt-1">
                <div className="space-y-1 min-w-0 flex-1">
                  {/* Primary Currency Label */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold tracking-wider uppercase text-[#526071] dark:text-[#929BA9]">
                      {dualBalance.primaryCurrency}
                    </span>
                  </div>

                  {/* Primary Balance Value (Large) */}
                  <div
                    data-testid="dashboard-primary-balance"
                    className={`text-3xl sm:text-4xl font-bold tracking-tight font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] truncate transition-all duration-300 ${
                      isSwapping ? 'opacity-30 scale-[0.98]' : 'opacity-100 scale-100'
                    }`}
                  >
                    {dualBalance.primaryFormatted}
                  </div>

                  {/* Short monochrome accent line below primary balance */}
                  <div className="w-10 h-0.5 bg-[#0F172A] dark:bg-white rounded-full my-2.5" />

                  {/* Secondary Currency Label */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold tracking-wider uppercase text-[#526071] dark:text-[#929BA9]">
                      {dualBalance.secondaryCurrency}
                    </span>
                  </div>

                  {/* Secondary Converted Balance (Smaller) */}
                  <div
                    data-testid="dashboard-secondary-balance"
                    className={`text-xs sm:text-sm font-medium font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9] transition-all duration-300 ${
                      isSwapping ? 'opacity-30 scale-[0.98]' : 'opacity-100 scale-100'
                    }`}
                  >
                    {dualBalance.secondaryFormatted}
                  </div>
                </div>

                {/* Action Buttons Column: Privacy toggle at top, Swap button placed right between the two balances */}
                <div className="flex flex-col items-center justify-between gap-4 self-stretch shrink-0 py-0.5">
                  {/* Circular Privacy Toggle button */}
                  <button
                    type="button"
                    onClick={handleTogglePrivacy}
                    data-testid="dashboard-privacy-toggle"
                    className="inline-flex items-center justify-center p-2 rounded-full bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#FAFAFA] dark:hover:bg-[#161A22] hover:border-[#0F172A]/30 dark:hover:border-white/30 transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                    title={
                      isPrivacyMode
                        ? tr('Tampilkan Nominal Saldo', 'Show Balance Amount')
                        : tr('Sembunyikan Nominal Saldo', 'Hide Balance Amount')
                    }
                    aria-label={
                      isPrivacyMode
                        ? tr('Tampilkan Nominal Saldo', 'Show Balance Amount')
                        : tr('Sembunyikan Nominal Saldo', 'Hide Balance Amount')
                    }
                    aria-pressed={isPrivacyMode}
                  >
                    {isPrivacyMode ? (
                      <EyeOff className="h-4 w-4 stroke-[1.75]" />
                    ) : (
                      <Eye className="h-4 w-4 stroke-[1.75]" />
                    )}
                  </button>

                  {/* Currency Swap Button (placed right between the two balances) */}
                  <button
                    type="button"
                    onClick={handleSwapCurrency}
                    data-testid="dashboard-currency-swap-btn"
                    className="inline-flex items-center justify-center p-2 rounded-full bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#FAFAFA] dark:hover:bg-[#161A22] hover:border-[#0F172A]/30 dark:hover:border-white/30 transition-all duration-300 cursor-pointer shrink-0 group select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                    title={tr(
                      `Tukar saldo utama ke ${dualBalance.secondaryCurrency}`,
                      `Swap primary balance to ${dualBalance.secondaryCurrency}`
                    )}
                    aria-label={tr(
                      `Tukar saldo utama ke ${dualBalance.secondaryCurrency}`,
                      `Swap primary balance to ${dualBalance.secondaryCurrency}`
                    )}
                  >
                    <ArrowUpDown
                      className={`h-4 w-4 stroke-[2] transition-transform duration-300 ${
                        isSwapping ? 'rotate-180 scale-110 text-[#0F172A] dark:text-white' : ''
                      } group-hover:text-[#0F172A] dark:group-hover:text-[#F2F4F7]`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Thin divider (mobile only) */}
        <div className="border-b border-[#E4E4E7] dark:border-[#20252D] md:hidden" />

        {/* 2. ACCOUNT PERFORMANCE (Direct on background, zero card wrapper) */}
        <section
          aria-label={tr('Performa Akun', 'Account Performance')}
          className="space-y-4 py-1 md:col-span-7 md:pl-8 md:border-l md:border-[#E4E4E7] md:dark:border-[#20252D] min-w-0"
        >
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#526071] dark:text-[#929BA9]">
            {tr('PERFORMA AKUN', 'ACCOUNT PERFORMANCE')}
          </h2>

          {/* Unified 2x2 Metrics Grid directly on background */}
          <div
            data-testid="dashboard-account-metrics-grid"
            className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-x-6 gap-y-4 font-mono-numbers tabular-nums"
          >
            {/* Top-Left: Net Profit */}
            <div className="min-w-0">
              <span className="block text-xs font-sans text-[#526071] dark:text-[#929BA9]">
                {tr('Profit Bersih', 'Net Profit')}
              </span>
              <span
                data-testid="dashboard-account-net-profit"
                className={`block text-xl sm:text-2xl font-bold mt-0.5 ${
                  isPeriodProfitPositive
                    ? 'text-[#059669] dark:text-[#00A878]'
                    : 'text-[#E11D48] dark:text-[#E05260]'
                }`}
              >
                {isPrivacyMode
                  ? '******'
                  : preferredCurrency === 'IDR'
                  ? (() => {
                      const idrVal = computeCumulativeProfitInDisplayCurrency(
                        periodTrades,
                        'IDR',
                        rateRecord
                      );
                      const sign = idrVal > 0 ? '+' : idrVal < 0 ? '-' : '';
                      const formatted = new Intl.NumberFormat('id-ID', {
                        style: 'currency',
                        currency: 'IDR',
                        maximumFractionDigits: 0,
                      }).format(Math.abs(idrVal));
                      return `${sign}${formatted}`;
                    })()
                  : `${isPeriodProfitPositive ? '+' : ''}${formatCurrency(
                      periodMetrics.totalNetProfit,
                      settings,
                      false
                    )}`}
              </span>
            </div>

            {/* Top-Right: Pertumbuhan */}
            <div className="min-w-0">
              <span className="block text-xs font-sans text-[#526071] dark:text-[#929BA9]">
                {tr('Pertumbuhan', 'Growth')}
              </span>
              <span
                data-testid="dashboard-account-growth"
                className={`block text-xl sm:text-2xl font-bold mt-0.5 ${
                  periodMetrics.totalGainPercent >= 0
                    ? 'text-[#059669] dark:text-[#00A878]'
                    : 'text-[#E11D48] dark:text-[#E05260]'
                }`}
              >
                {formatGrowthPercent(
                  periodMetrics.totalGainPercent,
                  periodMetrics.hasValidGrowthPercent,
                  2
                )}
              </span>
            </div>

            {/* Bottom-Left: Win Rate */}
            <div className="min-w-0">
              <span className="block text-xs font-sans text-[#526071] dark:text-[#929BA9]">
                {tr('Tingkat Menang', 'Win Rate')}
              </span>
              <span
                data-testid="dashboard-account-win-rate"
                className="block text-lg sm:text-xl font-bold text-[#0F172A] dark:text-[#F2F4F7] mt-0.5"
              >
                {periodMetrics.winRate}%
              </span>
            </div>

            {/* Bottom-Right: Total Trades */}
            <div className="min-w-0">
              <span className="block text-xs font-sans text-[#526071] dark:text-[#929BA9]">
                {tr('Total Transaksi', 'Total Trades')}
              </span>
              <span
                data-testid="dashboard-account-total-trades"
                className="block text-lg sm:text-xl font-bold text-[#0F172A] dark:text-[#F2F4F7] mt-0.5"
              >
                {periodMetrics.totalTrades}
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* Thin divider */}
      <div className="border-b border-[#E4E4E7] dark:border-[#20252D]" />

      {/* BAND 2: 3. EQUITY CURVE + 4. PERFORMANCE CALENDAR */}
      <div className="space-y-6 lg:space-y-0 lg:grid lg:grid-cols-12 lg:gap-8 lg:items-start">
        {/* 3. EQUITY CURVE (Direct on background, zero card wrapper) */}
        <section aria-label={tr('Kurva Ekuitas', 'Equity Curve')} className="space-y-3 py-1 lg:col-span-7 min-w-0">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#526071] dark:text-[#929BA9]">
            {tr('KURVA EKUITAS', 'EQUITY CURVE')}
          </h2>

          <EquityChart
            equityCurve={periodEquityCurve}
            settings={periodSettings}
            startingBalance={periodStartingBalance}
            height={220}
            isPrivacyMode={isPrivacyMode}
            embedded={true}
            periodControl={periodDropdownControl}
          />
        </section>

        {/* Thin divider (mobile & tablet portrait) */}
        <div className="border-b border-[#E4E4E7] dark:border-[#20252D] lg:hidden" />

        {/* 4. PERFORMANCE CALENDAR */}
        <section
          aria-label={tr('Kalender Performa', 'Performance Calendar')}
          className="py-1 lg:col-span-5 lg:pl-8 lg:border-l lg:border-[#E4E4E7] lg:dark:border-[#20252D] min-w-0"
        >
          <DashboardCalendar
            trades={trades}
            settings={settings}
            isPrivacyMode={isPrivacyMode}
            onViewTrade={onViewTrade}
            onDeleteTradesByDate={onDeleteTradesByDate}
            preferredCurrency={preferredCurrency}
            rateRecord={rateRecord}
          />
        </section>
      </div>

      {/* Thin divider */}
      <div className="border-b border-[#E4E4E7] dark:border-[#20252D]" />

      {/* BAND 3: 5. RISK SNAPSHOT + 6. RECENT TRADES */}
      <div className="space-y-6 md:space-y-0 md:grid md:grid-cols-12 md:gap-8 md:items-start">
        {/* 5. RISK SNAPSHOT */}
        <section aria-label={tr('Ringkasan Risiko', 'Risk Snapshot')} className="py-1 md:col-span-5 min-w-0">
          <RiskSnapshot
            trades={trades}
            settings={settings}
            currentEquity={capitalBreakdown.currentBalance}
            onNavigate={onNavigate}
            isPrivacyMode={isPrivacyMode}
            preferredCurrency={preferredCurrency}
            rateRecord={rateRecord}
          />
        </section>

        {/* Thin divider (mobile only) */}
        <div className="border-b border-[#E4E4E7] dark:border-[#20252D] md:hidden" />

        {/* 6. RECENT TRADES (Seamless Black, zero card wrapper, zero blue accent) */}
        <section
          aria-label={tr('Transaksi Terbaru', 'Recent Trades')}
          className="space-y-2 py-1 md:col-span-7 md:pl-8 md:border-l md:border-[#E4E4E7] md:dark:border-[#20252D] min-w-0"
        >
          <div className="flex items-center justify-between pb-2.5 border-b border-[#E4E4E7] dark:border-[#20252D]">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#526071] dark:text-[#929BA9]">
              {tr('TRANSAKSI TERBARU', 'RECENT TRADES')}
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('trades')}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 rounded-full px-1.5 py-0.5"
            >
              <span>{tr('Lihat Semua', 'View All')}</span>
              <ArrowRight className="h-3.5 w-3.5 stroke-[1.75]" />
            </button>
          </div>

          {recentThreeTrades.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#526071] dark:text-[#929BA9]">
              {tr(
                'Belum ada transaksi yang dicatat. Gunakan tombol “Tambah Entry” di bawah untuk mulai mencatat.',
                'No trades recorded yet. Use the “Add Entry” button below to start logging.'
              )}
            </div>
          ) : (
            <div
              data-testid="dashboard-recent-trades-list"
              className="divide-y divide-[#E4E4E7] dark:divide-[#20252D]"
            >
              {recentThreeTrades.map((t) => {
                const netProfit = computeTradeNetProfit(t);
                const outcome = resolveTradeOutcome(t);
                const isWin = outcome === 'WIN';
                const isLoss = outcome === 'LOSS';
                const isBuy = t.position === 'BUY';

                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onViewTrade(t)}
                    className="w-full py-3.5 px-2.5 flex items-center justify-between gap-4 hover:bg-[#FAFAFA] dark:hover:bg-[#101318] rounded-xl transition-colors text-left cursor-pointer font-sans tabular-nums group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                  >
                    {/* Left: Instrument, BUY/SELL, Lot Size on Line 1; Date on Line 2 */}
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 text-xs sm:text-sm font-sans">
                        <span className="font-bold text-[#0F172A] dark:text-[#F2F4F7] group-hover:text-black dark:group-hover:text-white transition-colors truncate">
                          {t.instrument}
                        </span>
                        <span
                          data-testid={`recent-trade-side-${t.id}`}
                          className={`text-xs font-bold uppercase ${
                            isBuy
                              ? 'text-[#059669] dark:text-[#00A878]'
                              : 'text-[#E11D48] dark:text-[#E05260]'
                          }`}
                        >
                          {t.position === 'BUY' ? tr('BELI', 'BUY') : tr('JUAL', 'SELL')}
                        </span>
                        <span className="text-[#526071] dark:text-[#929BA9]" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-xs text-[#526071] dark:text-[#929BA9]">
                          {Number(t.lotSize || 0).toFixed(2)} Lot
                        </span>
                      </div>

                      <div className="text-[11px] font-sans text-[#526071] dark:text-[#929BA9]">
                        {formatRecentTradeDate(t.dateTime, locale)}
                        {outcome === 'BREAKEVEN' && (
                          <>
                            <span className="mx-1" aria-hidden="true">·</span>
                            <span>{tr('IMPAS', 'BE')}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Right: Nominal Net P/L */}
                    <div className="text-right shrink-0">
                      <span
                        data-testid={`recent-trade-pnl-${t.id}`}
                        className={`text-sm sm:text-base font-bold font-sans tabular-nums ${
                          isWin
                            ? 'text-[#059669] dark:text-[#00A878]'
                            : isLoss
                            ? 'text-[#E11D48] dark:text-[#E05260]'
                            : 'text-[#526071] dark:text-[#929BA9]'
                        }`}
                      >
                        {isPrivacyMode
                          ? '******'
                          : preferredCurrency === 'IDR'
                          ? formatTradeFinancialValue(
                              t,
                              'netProfit',
                              'IDR',
                              rateRecord,
                              false,
                              true
                            )
                          : formatUsdNominalPnl(netProfit, false)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Thin divider */}
      <div className="border-b border-[#E4E4E7] dark:border-[#20252D]" />

      {/* 7. SINGLE PRIMARY "TAMBAH ENTRY" BUTTON AT BOTTOM OF DASHBOARD (Seamless Black) */}
      <div className="pt-3 pb-6 flex justify-center">
        <button
          type="button"
          onClick={onAddTrade}
          data-testid="dashboard-add-entry-button"
          className="w-full sm:w-auto sm:min-w-[200px] flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-white dark:bg-[#101318] hover:bg-[#FAFAFA] dark:hover:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] hover:border-[#0F172A]/30 dark:hover:border-white/30 text-[#0F172A] dark:text-[#F2F4F7] text-xs sm:text-sm font-semibold transition-all duration-150 cursor-pointer shadow-[0_1px_2px_rgba(15,23,42,0.05)] dark:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
        >
          <Plus className="h-4 w-4 stroke-[2] text-[#526071] dark:text-[#929BA9]" />
          <span>{tr('Tambah Entry', 'Add Entry')}</span>
        </button>
      </div>
    </div>
  );
};
