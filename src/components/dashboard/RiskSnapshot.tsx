import React, { useMemo } from 'react';
import { AppSettings } from '../../types/settings';
import { Trade } from '../../types/trade';
import {
  calculatePerformance,
  extractTradeLocalDateKey,
  formatLocalDateKey,
  computeTradeNetProfit,
  resolveTradeOutcome,
} from '../../utils/calculations';
import {
  UsdIdrRateRecord,
  useGlobalCurrency,
  formatDynamicAmount,
} from '../../utils/currencyRate';
import { useLanguage } from '../../utils/language';
import { ArrowRight } from 'lucide-react';

interface RiskSnapshotProps {
  trades: Trade[];
  settings: AppSettings;
  currentEquity: number;
  onNavigate: (tab: string) => void;
  isPrivacyMode?: boolean;
  preferredCurrency?: 'USD' | 'IDR';
  rateRecord?: UsdIdrRateRecord | null;
}

export const RiskSnapshot: React.FC<RiskSnapshotProps> = ({
  trades,
  settings,
  currentEquity,
  onNavigate,
  isPrivacyMode = false,
  preferredCurrency,
  rateRecord,
}) => {
  const { tr } = useLanguage();
  const globalCur = useGlobalCurrency();
  const activeCurrency = preferredCurrency || globalCur.preferredCurrency;
  const activeRateRecord = rateRecord || globalCur.rateRecord;

  const closedTrades = useMemo(() => {
    return trades.filter((t) => {
      const outcome = resolveTradeOutcome(t);
      return outcome === 'WIN' || outcome === 'LOSS' || outcome === 'BREAKEVEN';
    });
  }, [trades]);

  const { equityCurve } = useMemo(() => {
    return calculatePerformance(closedTrades, settings);
  }, [closedTrades, settings]);

  const peakEquity = useMemo(() => {
    const startBal = settings.startingBalance > 0 ? settings.startingBalance : 10000;
    if (equityCurve.length === 0) return startBal;
    return Math.max(startBal, ...equityCurve.map((p) => p.equity));
  }, [equityCurve, settings.startingBalance]);

  const effectiveEquity = currentEquity > 0 ? currentEquity : settings.startingBalance;

  const currentDrawdownAmount = useMemo(() => {
    if (effectiveEquity >= peakEquity) return 0;
    return Number((peakEquity - effectiveEquity).toFixed(2));
  }, [effectiveEquity, peakEquity]);

  const currentDrawdownPercent = useMemo(() => {
    if (peakEquity <= 0 || currentDrawdownAmount <= 0) return 0;
    return Number(((currentDrawdownAmount / peakEquity) * 100).toFixed(2));
  }, [currentDrawdownAmount, peakEquity]);

  const maxDrawdownLimit = settings.maxDrawdownLimitPercent || 10.0;
  const drawdownProgress = Math.min(100, Math.max(0, (currentDrawdownPercent / maxDrawdownLimit) * 100));

  const todayKey = formatLocalDateKey(new Date());

  const dailyLossToday = useMemo(() => {
    const todayTrades = closedTrades.filter(
      (t) => extractTradeLocalDateKey(t.dateTime) === todayKey
    );
    const todayNet = todayTrades.reduce((sum, t) => sum + computeTradeNetProfit(t), 0);
    return todayNet < 0 ? Math.abs(todayNet) : 0;
  }, [closedTrades, todayKey]);

  const dailyLossConfig = useMemo(() => {
    if (settings.maxDailyLossAmount && settings.maxDailyLossAmount > 0) {
      return {
        isConfigured: true,
        limitAmount: settings.maxDailyLossAmount,
        label: formatDynamicAmount(settings.maxDailyLossAmount, activeCurrency, activeRateRecord),
      };
    }
    if (settings.maxDailyLossPercent && settings.maxDailyLossPercent > 0) {
      const amt = (settings.startingBalance * settings.maxDailyLossPercent) / 100;
      return {
        isConfigured: true,
        limitAmount: amt,
        label: `${settings.maxDailyLossPercent}% (${formatDynamicAmount(amt, activeCurrency, activeRateRecord)})`,
      };
    }
    return {
      isConfigured: false,
      limitAmount: null,
      label: null,
    };
  }, [settings, activeCurrency, activeRateRecord]);

  const dailyLossUsagePercent = useMemo(() => {
    if (!dailyLossConfig.isConfigured || !dailyLossConfig.limitAmount) return null;
    return Number(((dailyLossToday / dailyLossConfig.limitAmount) * 100).toFixed(1));
  }, [dailyLossConfig, dailyLossToday]);

  const dailyLossProgress = useMemo(() => {
    if (dailyLossUsagePercent === null) return 0;
    return Math.min(100, Math.max(0, dailyLossUsagePercent));
  }, [dailyLossUsagePercent]);

  return (
    <div
      aria-label={tr('Ringkasan Risiko', 'Risk Snapshot')}
      className="space-y-4 font-sans select-none"
    >
      {/* Section Header: Text Only Title + Nav Link */}
      <div className="flex items-center justify-between pb-1">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#697586] dark:text-[#929BA9]">
          {tr('RINGKASAN RISIKO', 'RISK SNAPSHOT')}
        </h2>

        <button
          type="button"
          onClick={() => onNavigate('risk')}
          className="inline-flex items-center gap-1 text-xs font-semibold text-[#1769E8] dark:text-[#3478DC] hover:text-[#1458C4] dark:hover:text-[#2860B2] transition-colors cursor-pointer whitespace-nowrap"
        >
          <span>{tr('Kelola Risiko', 'Manage Risk')}</span>
          <ArrowRight className="h-3.5 w-3.5 stroke-[1.75]" />
        </button>
      </div>

      {/* Two Priority Indicators */}
      <div className="space-y-5 font-mono-numbers tabular-nums">
        {/* Indicator 1: Current Drawdown */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-sans font-medium text-[#151D2A] dark:text-[#F2F4F7]">
              {tr('Drawdown Saat Ini', 'Current Drawdown')}
            </span>
            <span
              className={`text-base font-bold ${
                currentDrawdownPercent > maxDrawdownLimit * 0.8
                  ? 'text-[#E11D48] dark:text-[#E05260]'
                  : currentDrawdownPercent > 0
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-[#059669] dark:text-[#00A878]'
              }`}
            >
              {currentDrawdownPercent.toFixed(2)}%
            </span>
          </div>

          <div className="w-full h-1 rounded-full bg-[#E2E8F0] dark:bg-[#20252D] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                drawdownProgress > 80
                  ? 'bg-[#E11D48] dark:bg-[#E05260]'
                  : drawdownProgress > 50
                  ? 'bg-amber-500'
                  : 'bg-[#059669] dark:bg-[#00A878]'
              }`}
              style={{ width: `${drawdownProgress}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] font-sans text-[#697586] dark:text-[#929BA9]">
            <span>
              {tr('Batas Maksimal:', 'Max Limit:')} {maxDrawdownLimit}%
            </span>
            <span>
              {currentDrawdownAmount > 0
                ? isPrivacyMode
                  ? '••••••'
                  : `-${formatDynamicAmount(currentDrawdownAmount, activeCurrency, activeRateRecord)}`
                : tr('Aman di Puncak Ekuitas', 'Safe at Peak Equity')}
            </span>
          </div>
        </div>

        {/* Indicator 2: Daily Loss Usage */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-sans font-medium text-[#151D2A] dark:text-[#F2F4F7]">
              {tr('Penggunaan Batas Loss Harian', 'Daily Loss Usage')}
            </span>
            <span
              className={`text-base font-bold ${
                !dailyLossConfig.isConfigured
                  ? 'text-[#697586] dark:text-[#929BA9] text-xs font-semibold font-sans'
                  : dailyLossUsagePercent !== null && dailyLossUsagePercent >= 100
                  ? 'text-[#E11D48] dark:text-[#E05260]'
                  : dailyLossUsagePercent !== null && dailyLossUsagePercent > 50
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-[#151D2A] dark:text-[#F2F4F7]'
              }`}
            >
              {dailyLossConfig.isConfigured && dailyLossUsagePercent !== null
                ? `${dailyLossUsagePercent.toFixed(1)}%`
                : tr('Belum Dikonfigurasi', 'Not Configured')}
            </span>
          </div>

          <div className="w-full h-1 rounded-full bg-[#E2E8F0] dark:bg-[#20252D] overflow-hidden">
            {dailyLossConfig.isConfigured ? (
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  dailyLossProgress >= 100
                    ? 'bg-[#E11D48] dark:bg-[#E05260]'
                    : dailyLossProgress > 50
                    ? 'bg-amber-500'
                    : 'bg-[#059669] dark:bg-[#00A878]'
                }`}
                style={{ width: `${dailyLossProgress}%` }}
              />
            ) : (
              <div className="h-full w-full bg-[#E2E8F0] dark:bg-[#20252D] opacity-40" />
            )}
          </div>

          <div className="flex items-center justify-between text-[11px] font-sans text-[#697586] dark:text-[#929BA9]">
            {dailyLossConfig.isConfigured ? (
              <>
                <span>
                  {tr('Batas:', 'Limit:')} {dailyLossConfig.label}
                </span>
                <span>
                  {tr('Hari ini:', 'Today:')}{' '}
                  {isPrivacyMode
                    ? '••••••'
                    : formatDynamicAmount(dailyLossToday, activeCurrency, activeRateRecord)}
                </span>
              </>
            ) : (
              <span>
                {tr(
                  'Atur batas risiko harian pada tab Manajemen Risiko',
                  'Configure daily loss limit in Risk Management tab'
                )}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
