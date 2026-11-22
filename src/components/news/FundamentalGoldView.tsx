import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Wifi,
  WifiOff,
  Clock,
} from 'lucide-react';
import { useLanguage } from '../../utils/language';
import {
  isNewsCycleOfflineMode,
  setNewsCycleOfflineMode,
  NEWS_CYCLE_OFFLINE_MODE_CHANGE_EVENT,
  NEWS_CYCLE_OFFLINE_MODE_STORAGE_KEY,
} from '../../utils/apiConfig';
import {
  FundamentalGoldSnapshot,
  FundamentalDirectionBias,
  MacroNewsSnapshot,
  CME_FEDWATCH_LOCAL_STORAGE_KEY,
  MACRO_LOCAL_SYNC_EVENT,
  MACRO_SNAPSHOT_LOCAL_STORAGE_KEY,
  loadLocalCachedFundamentalGoldSnapshotSync,
  loadLocalCachedMacroSnapshotSync,
  formatLiveUpdateClockWib,
  formatTimestampWib,
} from '../../utils/macroNewsEngine';
import { executeClientSideFundamentalGoldAnalysis } from '../../utils/clientSideMacroAnalyzer';
import { SMC_OFFLINE_SIGNALS_STORAGE_KEY } from '../../utils/xauSmartHeatmap';
import { XauSmartHeatmapCard } from './XauSmartHeatmapCard';

interface FundamentalGoldViewProps {
  isActive?: boolean;
}

const AUTO_REFRESH_TTL_MS = 60 * 60 * 1000;

function getBiasTextColor(bias: FundamentalDirectionBias): string {
  if (bias === 'BULLISH') return 'text-[#059669] dark:text-[#00A878]';
  if (bias === 'BEARISH') return 'text-[#E11D48] dark:text-[#E05260]';
  return 'text-[#526071] dark:text-[#929BA9]';
}

function BiasArrow({
  bias,
  className = 'w-4 h-4',
}: {
  bias: FundamentalDirectionBias;
  className?: string;
}) {
  if (bias === 'BULLISH') return <ArrowUpRight className={className} />;
  if (bias === 'BEARISH') return <ArrowDownRight className={className} />;
  return <Minus className={className} />;
}

function formatSignedPct(val?: number): string {
  if (typeof val !== 'number' || !Number.isFinite(val)) return '—';
  return `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;
}

export const FundamentalGoldView: React.FC<FundamentalGoldViewProps> = ({ isActive = true }) => {
  const { isEn, tr } = useLanguage();
  const [snapshot, setSnapshot] = useState<FundamentalGoldSnapshot | null>(() =>
    loadLocalCachedFundamentalGoldSnapshotSync()
  );
  const [macroSnapshot, setMacroSnapshot] = useState<MacroNewsSnapshot | null>(() =>
    loadLocalCachedMacroSnapshotSync()
  );
  const [heatmapSyncVersion, setHeatmapSyncVersion] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [showSupportingData, setShowSupportingData] = useState<boolean>(false);
  const [isOfflineMode, setIsOfflineMode] = useState<boolean>(() => isNewsCycleOfflineMode());
  const hasAutoLoadedRef = useRef<boolean>(false);

  const syncCrossModuleFeeds = useCallback(() => {
    setMacroSnapshot(loadLocalCachedMacroSnapshotSync());
    setHeatmapSyncVersion((v) => v + 1);
  }, []);

  const runCheck = useCallback(
    async (opts?: { forceRefresh?: boolean; forceRewriteAi?: boolean }) => {
      setIsLoading(true);
      try {
        const next = await executeClientSideFundamentalGoldAnalysis({
          forceRefresh: Boolean(opts?.forceRefresh),
          forceRewriteAi: Boolean(opts?.forceRewriteAi),
        });
        setSnapshot(next);
        syncCrossModuleFeeds();
      } catch {
        const cached = loadLocalCachedFundamentalGoldSnapshotSync();
        if (cached) {
          setSnapshot(cached);
        }
        syncCrossModuleFeeds();
      } finally {
        setIsLoading(false);
      }
    },
    [syncCrossModuleFeeds]
  );

  useEffect(() => {
    const syncOfflineFlag = () => setIsOfflineMode(isNewsCycleOfflineMode());
    const handleStorage = (e: StorageEvent) => {
      if (e.key === NEWS_CYCLE_OFFLINE_MODE_STORAGE_KEY) {
        syncOfflineFlag();
      }
      if (
        e.key === MACRO_SNAPSHOT_LOCAL_STORAGE_KEY ||
        e.key === CME_FEDWATCH_LOCAL_STORAGE_KEY ||
        e.key === SMC_OFFLINE_SIGNALS_STORAGE_KEY
      ) {
        syncCrossModuleFeeds();
      }
    };
    window.addEventListener(NEWS_CYCLE_OFFLINE_MODE_CHANGE_EVENT, syncOfflineFlag);
    window.addEventListener(MACRO_LOCAL_SYNC_EVENT, syncCrossModuleFeeds);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(NEWS_CYCLE_OFFLINE_MODE_CHANGE_EVENT, syncOfflineFlag);
      window.removeEventListener(MACRO_LOCAL_SYNC_EVENT, syncCrossModuleFeeds);
      window.removeEventListener('storage', handleStorage);
    };
  }, [syncCrossModuleFeeds]);

  useEffect(() => {
    if (!isActive) return;
    syncCrossModuleFeeds();

    if (hasAutoLoadedRef.current) return;
    hasAutoLoadedRef.current = true;

    const cached = loadLocalCachedFundamentalGoldSnapshotSync();
    if (cached) {
      setSnapshot(cached);
      const analyzedMs = new Date(cached.analyzedAt).getTime();
      const isStale = !Number.isFinite(analyzedMs) || Date.now() - analyzedMs > AUTO_REFRESH_TTL_MS;
      if (isStale && !isNewsCycleOfflineMode()) {
        runCheck({ forceRefresh: false });
      }
    } else {
      runCheck({ forceRefresh: false });
    }
  }, [isActive, runCheck, syncCrossModuleFeeds]);

  const handleToggleOffline = () => {
    const next = !isOfflineMode;
    setNewsCycleOfflineMode(next);
    setIsOfflineMode(next);
    if (!next) {
      runCheck({ forceRefresh: true });
    } else {
      runCheck({ forceRefresh: false });
    }
  };

  const langBlock = snapshot ? (isEn ? snapshot.narrative.en : snapshot.narrative.id) : null;
  const overallTextClass = getBiasTextColor(snapshot?.overallBias || 'NEUTRAL');
  const dominantPercent = snapshot
    ? snapshot.overallBias === 'BEARISH'
      ? snapshot.bearishProbability
      : snapshot.bullishProbability
    : 50;

  const horizonItems = snapshot
    ? [
        {
          key: '1D',
          label: tr('1 Hari ke Depan', 'Next 1 Day'),
          subLabel: tr('Sentimen Harian', 'Near-Term Pulse'),
          data: snapshot.horizons.daily1D,
        },
        {
          key: '1W',
          label: tr('1 Minggu ke Depan', 'Next 1 Week'),
          subLabel: tr('Arah Mingguan', 'Weekly Swing'),
          data: snapshot.horizons.weekly1W,
        },
        {
          key: '1M',
          label: tr('1 Bulan ke Depan', 'Next 1 Month'),
          subLabel: tr('Struktur Besar', 'Broad Trend'),
          data: snapshot.horizons.monthly1M,
        },
      ]
    : [];

  const ev = snapshot?.evidenceSummary;
  const supportingMetrics = ev
    ? [
        {
          label: 'DXY (US Dollar)',
          value: ev.dxyPrice ? ev.dxyPrice.toFixed(2) : '—',
          sub: formatSignedPct(ev.dxyChangePct),
        },
        {
          label: 'US10Y Yield',
          value: ev.us10yPrice ? `${ev.us10yPrice.toFixed(2)}%` : '—',
          sub: formatSignedPct(ev.us10yChangePct),
        },
        {
          label: 'US02Y Yield',
          value: ev.us02yPrice ? `${ev.us02yPrice.toFixed(2)}%` : '—',
          sub: tr('Bunga Jangka Pendek', 'Front-End Rate'),
        },
        {
          label: 'Real Yield (TIP vs IEF)',
          value: formatSignedPct(ev.tipIefChangePct),
          sub: tr('Ekspektasi Inflasi Riil', 'Inflation-Adjusted Proxy'),
        },
        {
          label: 'S&P 500 (ES=F)',
          value: formatSignedPct(ev.esChangePct),
          sub: tr('Saham Utama AS', 'US Broad Equities'),
        },
        {
          label: 'Nasdaq 100 (NQ=F)',
          value: formatSignedPct(ev.nqChangePct),
          sub: tr('Saham Teknologi AS', 'Tech & Growth Appetite'),
        },
        {
          label: 'VIX / MOVE',
          value: `${ev.vixPrice ? ev.vixPrice.toFixed(1) : '—'} / ${ev.movePrice ? ev.movePrice.toFixed(0) : '—'}`,
          sub: tr('Volatilitas Saham & Obligasi', 'Equity & Bond Volatility'),
        },
        {
          label: 'GLD ETF / GVZ',
          value: `${formatSignedPct(ev.gldChangePct)} · ${ev.gvzPrice ? ev.gvzPrice.toFixed(1) : '—'}`,
          sub: tr('Arus ETF Emas Dunia', 'Gold ETF Flow & Vol'),
        },
        {
          label: 'USD/CNH (Yuan)',
          value: formatSignedPct(ev.usdCnhChangePct),
          sub: tr('Daya Beli Asia & PBoC', 'Asia & China FX Tone'),
        },
        {
          label: 'WTI Oil',
          value: formatSignedPct(ev.usOilChangePct),
          sub: tr('Tekanan Energi Inflasi', 'Energy Inflation Channel'),
        },
        {
          label: 'CFTC COT Gold',
          value:
            typeof ev.cftcNetPercentile === 'number' ? `${ev.cftcNetPercentile}/100` : '—',
          sub: ev.cftcReportDate || tr('Posisi Institusi', 'Managed Money'),
        },
        {
          label: 'CME FedWatch',
          value:
            ev.fedWatchDominant && ev.fedWatchDominant !== 'UNAVAILABLE'
              ? ev.fedWatchDominant === 'CUT' && typeof ev.fedWatchCutPct === 'number'
                ? `CUT ${ev.fedWatchCutPct.toFixed(1)}%`
                : ev.fedWatchDominant === 'HIKE' && typeof ev.fedWatchHikePct === 'number'
                ? `HIKE ${ev.fedWatchHikePct.toFixed(1)}%`
                : ev.fedWatchDominant === 'HOLD' && typeof ev.fedWatchHoldPct === 'number'
                ? `HOLD ${ev.fedWatchHoldPct.toFixed(1)}%`
                : ev.fedWatchDominant
              : '—',
          sub: ev.fedWatchMeeting
            ? `${ev.fedWatchMeeting}${
                typeof ev.fedWatchCutPct === 'number' && ev.fedWatchDominant !== 'CUT'
                  ? ` · Cut ${ev.fedWatchCutPct.toFixed(0)}%`
                  : ''
              }`
            : tr('Ekspektasi Suku Bunga', 'Fed Rate Pricing'),
        },
      ]
    : [];

  return (
    <div
      data-testid="fundamental-gold-view"
      className="space-y-8 pb-12 text-[#0F172A] dark:text-[#F2F4F7] font-sans"
    >
      {/* MINIMALIST HEADER & SINGLE META STRIP (Matches Dashboard & Trade News) */}
      <div className="space-y-2.5 pb-4 border-b border-[#E4E4E7] dark:border-[#20252D]">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xs font-bold uppercase tracking-[0.12em] text-[#0F172A] dark:text-[#F2F4F7] truncate">
                {tr('FUNDAMENTAL GOLD · XAU/USD', 'FUNDAMENTAL GOLD · XAU/USD')}
              </h1>
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  isOfflineMode
                    ? 'bg-[#D97706] dark:bg-[#F59E0B]'
                    : 'bg-[#059669] dark:bg-[#00A878]'
                }`}
              />
            </div>
            <p className="text-[11px] text-[#526071] dark:text-[#929BA9] font-mono-numbers tabular-nums truncate mt-0.5">
              {snapshot
                ? `${
                    isEn
                      ? snapshot.cadenceSchedule.currentSlotLabelEn
                      : snapshot.cadenceSchedule.currentSlotLabelId
                  } · ${formatLiveUpdateClockWib(snapshot.analyzedAt, isEn ? 'en' : 'id')}`
                : tr(
                    'Jadwal optimal 3x/hari (07:30 · 14:30 · 20:30 WIB)',
                    'Optimal cadence 3x/day (07:30 · 14:30 · 20:30 WIB)'
                  )}
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleToggleOffline}
              data-testid="fundamental-offline-toggle"
              aria-label={
                isOfflineMode
                  ? tr('Mode Offline Aktif', 'Offline Mode Active')
                  : tr('Mode Online Aktif', 'Online Mode Active')
              }
              title={
                isOfflineMode
                  ? tr('Mode Offline aktif. Klik untuk kembali Online.', 'Offline Mode active. Click to go Online.')
                  : tr('Aktifkan Mode Offline untuk hemat kuota.', 'Enable Offline Mode to save quota.')
              }
              className={`h-8 w-8 p-0 inline-flex items-center justify-center rounded-full border transition-colors shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                isOfflineMode
                  ? 'bg-[#D97706]/10 dark:bg-[#F59E0B]/15 border-[#D97706]/40 dark:border-[#F59E0B]/40 text-[#B45309] dark:text-[#F59E0B]'
                  : 'bg-white dark:bg-[#101318] border-[#E4E4E7] dark:border-[#20252D] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] text-[#059669] dark:text-[#00A878]'
              }`}
            >
              {isOfflineMode ? (
                <WifiOff className="w-3.5 h-3.5 stroke-[2]" />
              ) : (
                <Wifi className="w-3.5 h-3.5 stroke-[1.75]" />
              )}
            </button>

            <button
              type="button"
              onClick={() => runCheck({ forceRefresh: true, forceRewriteAi: true })}
              disabled={isLoading}
              data-testid="fundamental-refresh-button"
              className="h-8 inline-flex items-center justify-center gap-1.5 px-3.5 rounded-full bg-[#0F172A] dark:bg-white text-white dark:text-[#050607] hover:opacity-90 text-xs font-semibold transition-opacity disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
            >
              <RefreshCw className={`w-3.5 h-3.5 stroke-[2] ${isLoading ? 'animate-spin' : ''}`} />
              <span>
                {isLoading
                  ? tr('Menyusun...', 'Checking...')
                  : tr('Cek Pembaruan', 'Check Updates')}
              </span>
            </button>
          </div>
        </div>

        {/* Single Inline Status / Cadence Meta Line (No separate card) */}
        <div
          data-testid="fundamental-status-strip"
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-[#526071] dark:text-[#929BA9]"
        >
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <Clock className="w-3 h-3 shrink-0" />
            <span className="truncate">
              {snapshot
                ? isEn
                  ? snapshot.changeDetection.statusTitleEn
                  : snapshot.changeDetection.statusTitleId
                : tr('Menunggu pembacaan awal...', 'Waiting for initial readout...')}
            </span>
          </span>
          {snapshot?.changeDetection.previousAnalyzedAt && (
            <span className="font-mono-numbers tabular-nums shrink-0">
              {tr('Pembanding:', 'Previous:')}{' '}
              {formatTimestampWib(snapshot.changeDetection.previousAnalyzedAt, isEn ? 'en' : 'id')}
            </span>
          )}
        </div>
      </div>

      {/* Main Content or Initial Loading State */}
      {!snapshot ? (
        <div className="space-y-6 vlo-view-fade">
          <div className="space-y-4 pb-8 border-b border-[#E4E4E7] dark:border-[#20252D]">
            <div className="h-3 w-48 rounded vlo-skeleton" />
            <div className="h-9 w-56 rounded-xl vlo-skeleton" />
            <div className="h-2 w-full rounded-full vlo-skeleton" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              <div className="h-14 rounded-lg vlo-skeleton" />
              <div className="h-14 rounded-lg vlo-skeleton" />
              <div className="h-14 rounded-lg vlo-skeleton" />
            </div>
          </div>
          <div className="space-y-3">
            <div className="h-4 w-44 rounded vlo-skeleton" />
            <div className="h-3.5 w-full rounded vlo-skeleton" />
            <div className="h-3.5 w-11/12 rounded vlo-skeleton" />
            <p className="text-[11px] text-[#526071] dark:text-[#929BA9] pt-1">
              {tr(
                'Mengumpulkan data suku bunga, dolar AS, saham Wall Street, obligasi, dan berita global...',
                'Gathering US rates, Dollar, Wall Street equities, Treasury yields, and global headlines...'
              )}
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* SECTION 01 — HERO PROBABILITY & HORIZON MATRIX (OPEN CANVAS, ZERO CARD WRAPPER) */}
          <section
            data-testid="fundamental-hero-card"
            className="space-y-5 pb-8 border-b border-[#E4E4E7] dark:border-[#20252D]"
          >
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
              <div className="space-y-1.5">
                <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-[#526071] dark:text-[#929BA9]">
                  {tr('01 / ARAH FUNDAMENTAL EMAS & HORIZON', '01 / GOLD FUNDAMENTAL DIRECTION & HORIZONS')}
                </span>
                <div className="flex items-center gap-2 flex-wrap pt-0.5">
                  <span
                    data-testid="fundamental-overall-bias"
                    className={`inline-flex items-center gap-1.5 text-3xl sm:text-4xl font-bold tracking-tight font-mono-numbers tabular-nums ${overallTextClass}`}
                  >
                    <BiasArrow bias={snapshot.overallBias} className="w-7 h-7 sm:w-8 sm:h-8" />
                    <span>
                      {snapshot.overallBias === 'NEUTRAL'
                        ? tr('SEIMBANG', 'NEUTRAL')
                        : snapshot.overallBias}
                    </span>
                    <span>{dominantPercent}%</span>
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-[#526071] dark:text-[#929BA9]">
                  {tr('Regime Pasar:', 'Market Regime:')}{' '}
                  <span className="text-[#0F172A] dark:text-[#F2F4F7] font-semibold">
                    {isEn ? snapshot.regimeLabelEn : snapshot.regimeLabelId}
                  </span>
                </p>
              </div>

              <div className="flex items-center gap-4 text-xs font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#059669] dark:bg-[#00A878]" />
                  <span>BULLISH {snapshot.bullishProbability}%</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#E11D48] dark:bg-[#E05260]" />
                  <span>BEARISH {snapshot.bearishProbability}%</span>
                </span>
              </div>
            </div>

            {/* Minimal Split Probability Hairline Bar */}
            <div className="space-y-2.5">
              <div className="h-1.5 w-full rounded-full overflow-hidden flex bg-[#F4F4F5] dark:bg-[#1B2029]">
                <div
                  className="h-full bg-[#059669] dark:bg-[#00A878] transition-all duration-300"
                  style={{ width: `${snapshot.bullishProbability}%` }}
                />
                <div
                  className="h-full bg-[#E11D48] dark:bg-[#E05260] transition-all duration-300"
                  style={{ width: `${snapshot.bearishProbability}%` }}
                />
              </div>
              {langBlock?.headlineSummary && (
                <p className="text-sm sm:text-base font-medium leading-relaxed text-[#0F172A] dark:text-[#F2F4F7] text-editorial-justify">
                  {langBlock.headlineSummary}
                </p>
              )}
            </div>

            {/* 3 Horizon Breakdown — Hairline Column Strip (No Sub-Cards) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[#E4E4E7] dark:divide-[#20252D] pt-4 border-t border-[#E4E4E7] dark:border-[#20252D]">
              {horizonItems.map((h, idx) => {
                const hTextClass = getBiasTextColor(h.data.bias);
                const hPct =
                  h.data.bias === 'BEARISH'
                    ? h.data.bearishProbability
                    : h.data.bullishProbability;
                return (
                  <div
                    key={h.key}
                    data-testid={`fundamental-horizon-${h.key}`}
                    className={`flex items-center justify-between gap-3 py-2.5 sm:py-1 ${
                      idx === 0
                        ? 'sm:pr-5'
                        : idx === 1
                        ? 'sm:px-5'
                        : 'sm:pl-5'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                        {h.label}
                      </div>
                      <div className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                        {h.subLabel}
                      </div>
                    </div>
                    <div className="text-right font-mono-numbers tabular-nums">
                      <div className={`text-sm font-bold ${hTextClass}`}>
                        {h.data.bias === 'NEUTRAL' ? tr('NETRAL', 'NEUTRAL') : h.data.bias} {hPct}%
                      </div>
                      <div className="text-[10px] text-[#526071] dark:text-[#929BA9]">
                        {h.data.bullishProbability}% / {h.data.bearishProbability}%
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* SECTION 02 — XAU/USD SMART HEATMAP (HAIRLINE OPEN-CANVAS MATRIX) */}
          <XauSmartHeatmapCard
            snapshot={snapshot}
            macroSnapshot={macroSnapshot}
            syncVersion={heatmapSyncVersion}
          />

          {/* SECTION 03 — MACRO DESK BRIEF (A–D) DIRECT ON CANVAS */}
          {langBlock && (
            <section
              data-testid="fundamental-narrative-reader"
              className="space-y-5 pb-6 border-b border-[#E4E4E7] dark:border-[#20252D]"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="space-y-1">
                  <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-[#526071] dark:text-[#929BA9]">
                    {tr('03 / MACRO DESK BRIEF (A – D)', '03 / MACRO DESK BRIEF (A – D)')}
                  </span>
                  <h2 className="text-base sm:text-lg font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                    {tr('Narasi Fundamental Terstruktur', 'Structured Fundamental Narrative')}
                  </h2>
                </div>
                <span className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                  {snapshot.sourceMode === 'GEMINI_AI'
                    ? tr('Sintesis AI', 'AI Synthesis')
                    : tr('Kalkulasi Struktural', 'Structural Engine')}
                </span>
              </div>

              {(langBlock.dataStatusNote || snapshot.changeDetection.statusDetailId) && (
                <p className="text-xs text-[#526071] dark:text-[#929BA9] pl-3 border-l-2 border-[#E4E4E7] dark:border-[#20252D] leading-relaxed text-editorial-justify">
                  {langBlock.dataStatusNote ||
                    (isEn
                      ? snapshot.changeDetection.statusDetailEn
                      : snapshot.changeDetection.statusDetailId)}
                </p>
              )}

              <div className="divide-y divide-[#E4E4E7] dark:divide-[#20252D]">
                <div className="py-4 space-y-1.5">
                  <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-[#0F172A] dark:text-[#F2F4F7]">
                    {tr('A · Ringkasan Regime & Pergeseran Data', 'A · Macro Regime & What Shifted')}
                  </h3>
                  <p className="text-sm leading-relaxed text-[#334155] dark:text-[#CBD5E1] text-editorial-justify">
                    {langBlock.sectionA_StatusAndChange}
                  </p>
                </div>

                <div className="py-4 space-y-1.5">
                  <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-[#0F172A] dark:text-[#F2F4F7]">
                    {tr(
                      'B · Suku Bunga AS, Real Yield & Dolar (DXY)',
                      'B · US Rates, Real Yields & US Dollar (DXY)'
                    )}
                  </h3>
                  <p className="text-sm leading-relaxed text-[#334155] dark:text-[#CBD5E1] text-editorial-justify">
                    {langBlock.sectionB_RatesInflationAndGrowth}
                  </p>
                </div>

                <div className="py-4 space-y-1.5">
                  <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-[#0F172A] dark:text-[#F2F4F7]">
                    {tr(
                      'C · Arus Modal Global, Saham AS & Institusi',
                      'C · Global Capital Flows, US Equities & Institutions'
                    )}
                  </h3>
                  <p className="text-sm leading-relaxed text-[#334155] dark:text-[#CBD5E1] text-editorial-justify">
                    {langBlock.sectionC_CrossMarketEquitiesCentralBanks}
                  </p>
                </div>

                <div className="py-4 space-y-1.5">
                  <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-[#0F172A] dark:text-[#F2F4F7]">
                    {tr(
                      'D · Peta 1 Hari, 1 Minggu, 1 Bulan & Skenario Pembalik',
                      'D · 1-Day, 1-Week, 1-Month Roadmap & Invalidation Triggers'
                    )}
                  </h3>
                  <p className="text-sm leading-relaxed text-[#334155] dark:text-[#CBD5E1] text-editorial-justify">
                    {langBlock.sectionD_HorizonOutlookAndRisks}
                  </p>
                </div>
              </div>

              <div className="pt-2 space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#526071] dark:text-[#929BA9]">
                  {tr(
                    'Catatan Kejujuran · Risiko Divergensi 1 Minggu',
                    'Transparency Note · 1-Week Divergence Risk'
                  )}
                </div>
                <p className="text-xs leading-relaxed text-[#526071] dark:text-[#929BA9] text-editorial-justify">
                  {snapshot.marketRegime === 'DELEVERAGING_DASH_FOR_CASH'
                    ? tr(
                        'Saat saham jatuh berbarengan dengan VIX tinggi seperti sekarang, dana besar sering menjual Emas secara paksa untuk memenuhi margin call (Dash-for-Cash). Fase jual likuiditas bisa membuat harga mingguan terus tertekan meski nilai jangka panjang belum berubah — selalu tunggu struktur chart stabil sebelum mengambil keputusan.',
                        'During acute equity selloffs with elevated VIX, funds often liquidate profitable Gold positions to raise USD cash and cover margin calls (Dash-for-Cash). Weekly prices can stay pressured until forced selling clears — always verify price structure on the chart first.'
                      )
                    : tr(
                        'Persentase di atas mengukur bobot peluang dari data makro, bukan kepastian mutlak. Dalam 1 minggu, arah bisa menyimpang akibat likuidasi tunai (margin call), berita geopolitik/tarif mendadak, atau ambil untung institusi — gunakan persentase ini sebagai kompas arah besar dan validasikan kembali dengan struktur chart.',
                        'These percentages measure macro odds rather than certainty. Over any 1-week window, forced cash liquidation (margin calls), surprise headlines, or profit-taking can push price against fundamentals — use this as a structural compass alongside chart price action.'
                      )}
                </p>
              </div>
            </section>
          )}

          {/* COLLAPSIBLE SUPPORTING EVIDENCE (OPEN CANVAS TOGGLE, ZERO BOX WRAPPER) */}
          <section className="space-y-4">
            <button
              type="button"
              onClick={() => setShowSupportingData((prev) => !prev)}
              data-testid="fundamental-supporting-data-toggle"
              className="w-full py-2 flex items-center justify-between text-left hover:opacity-80 transition-opacity cursor-pointer"
            >
              <div className="space-y-0.5">
                <span className="text-xs font-bold uppercase tracking-[0.08em] text-[#0F172A] dark:text-[#F2F4F7] block">
                  {tr('Lihat Bukti Data Pendukung', 'View Supporting Market Evidence')}
                </span>
                <span className="text-xs text-[#526071] dark:text-[#929BA9] block">
                  {tr(
                    `${snapshot.drivers.length} faktor utama terukur · DXY, Obligasi, Saham AS, VIX, CFTC & Bank Sentral`,
                    `${snapshot.drivers.length} active factors · DXY, Yields, US Equities, VIX, CFTC & Central Banks`
                  )}
                </span>
              </div>
              {showSupportingData ? (
                <ChevronUp className="w-4 h-4 text-[#526071] dark:text-[#929BA9] shrink-0" />
              ) : (
                <ChevronDown className="w-4 h-4 text-[#526071] dark:text-[#929BA9] shrink-0" />
              )}
            </button>

            {showSupportingData && (
              <div
                data-testid="fundamental-supporting-data-panel"
                className="pt-2 space-y-6"
              >
                {snapshot.drivers.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#526071] dark:text-[#929BA9]">
                      {tr('Faktor Pendorong Utama', 'Key Weighted Drivers')}
                    </h4>
                    <div className="divide-y divide-[#E4E4E7] dark:divide-[#20252D] border-t border-b border-[#E4E4E7] dark:border-[#20252D]">
                      {snapshot.drivers.map((drv) => {
                        const drvColor = getBiasTextColor(drv.effect);
                        return (
                          <div key={drv.id} className="py-3 space-y-1">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                                {isEn ? drv.labelEn : drv.labelId}
                              </span>
                              <div className="flex items-center gap-2 font-mono-numbers text-[11px] tabular-nums">
                                <span className="text-[#526071] dark:text-[#929BA9]">
                                  {drv.metricText}
                                </span>
                                <span className={`font-bold ${drvColor}`}>{drv.effect}</span>
                              </div>
                            </div>
                            <p className="text-xs text-[#526071] dark:text-[#929BA9] leading-relaxed text-editorial-justify">
                              {isEn ? drv.explainEn : drv.explainId}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="space-y-2.5">
                  <h4 className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#526071] dark:text-[#929BA9]">
                    {tr('Ringkasan Angka Lintas Pasar', 'Cross-Asset Reference Numbers')}
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-px bg-[#E4E4E7] dark:bg-[#20252D] border border-[#E4E4E7] dark:border-[#20252D] rounded-xl overflow-hidden">
                    {supportingMetrics.map((m) => (
                      <div
                        key={m.label}
                        className="bg-white dark:bg-[#0B0E13] px-3.5 py-2.5 space-y-0.5"
                      >
                        <div className="text-[11px] font-medium text-[#526071] dark:text-[#929BA9] truncate">
                          {m.label}
                        </div>
                        <div className="text-xs font-bold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                          {m.value}
                        </div>
                        <div className="text-[10px] text-[#526071] dark:text-[#929BA9] truncate">
                          {m.sub}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};
