/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Isolated, read-only collapsible panel displaying external Polymarket prediction odds
 * as supplementary macro sentiment at the bottom of Fundamental Gold.
 * Strictly decoupled from XAUUSD bias scores, macro rules, and Trade News execution logic.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  HelpCircle,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { useLanguage } from '../../utils/language';
import { formatTimestampWib } from '../../utils/macroNewsEngine';
import {
  fetchPolymarketMacroSentiment,
  formatCompactUsdVolume,
  formatPolymarketEndDate,
  loadCachedPolymarketMacroSnapshot,
  type PolymarketMacroCategory,
  type PolymarketMacroSnapshot,
} from '../../utils/polymarketMacroSentiment';

interface PolymarketMacroSentimentPanelProps {
  isOfflineMode: boolean;
}

type FilterTab = 'ALL' | PolymarketMacroCategory;
const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export const PolymarketMacroSentimentPanel: React.FC<PolymarketMacroSentimentPanelProps> = ({
  isOfflineMode,
}) => {
  const { isEn, tr } = useLanguage();
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [showGuide, setShowGuide] = useState<boolean>(false);
  const [activeCategory, setActiveCategory] = useState<FilterTab>('ALL');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [snapshot, setSnapshot] = useState<PolymarketMacroSnapshot | null>(() =>
    loadCachedPolymarketMacroSnapshot()
  );
  const hasAutoFetchedRef = useRef<boolean>(false);
  const isFetchingRef = useRef<boolean>(false);

  const loadSentiment = useCallback(async (forceRefresh = false) => {
    if (isFetchingRef.current && !forceRefresh) return;
    isFetchingRef.current = true;
    setIsLoading(true);
    try {
      const next = await fetchPolymarketMacroSentiment({ forceRefresh });
      setSnapshot(next);
    } finally {
      isFetchingRef.current = false;
      setIsLoading(false);
    }
  }, []);

  // Lazy-fetch only when the user opens this optional section (zero overhead when collapsed)
  useEffect(() => {
    if (!isExpanded) return;
    if (!hasAutoFetchedRef.current) {
      hasAutoFetchedRef.current = true;
      void loadSentiment(false);
    }
  }, [isExpanded, loadSentiment]);

  // Re-sync honest offline/online status if user toggles offline mode while panel is open
  useEffect(() => {
    if (!isExpanded || !hasAutoFetchedRef.current) return;
    void loadSentiment(false);
  }, [isOfflineMode, isExpanded, loadSentiment]);

  // Auto-refresh every 5 minutes strictly while panel is expanded and online
  useEffect(() => {
    if (!isExpanded || isOfflineMode) return;
    const timer = window.setInterval(() => {
      void loadSentiment(true);
    }, AUTO_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isExpanded, isOfflineMode, loadSentiment]);

  const categoryLabels: Record<PolymarketMacroCategory, string> = useMemo(
    () => ({
      GOLD: 'Gold / XAU',
      FED_RATES: 'The Fed',
      MACRO_ECONOMY: tr('Makro AS', 'US Macro'),
      GEOPOLITICS: tr('Geopolitik', 'Geopolitics'),
    }),
    [tr]
  );

  const filterTabs: Array<{ id: FilterTab; label: string }> = useMemo(
    () => [
      { id: 'ALL', label: tr('Semua', 'All') },
      { id: 'GOLD', label: 'Gold / XAU' },
      { id: 'FED_RATES', label: 'The Fed' },
      { id: 'MACRO_ECONOMY', label: tr('Makro AS', 'US Macro') },
      { id: 'GEOPOLITICS', label: tr('Geopolitik', 'Geopolitics') },
    ],
    [tr]
  );

  const visibleEvents = useMemo(() => {
    if (!snapshot?.events?.length) return [];
    if (activeCategory === 'ALL') return snapshot.events;
    return snapshot.events.filter((ev) => ev.category === activeCategory);
  }, [snapshot, activeCategory]);

  const statusMeta = useMemo(() => {
    if (isLoading && !snapshot) {
      return {
        label: tr('Memuat Polymarket...', 'Loading Polymarket...'),
        className: 'text-[#526071] dark:text-[#929BA9]',
      };
    }
    if (!snapshot) {
      return {
        label: tr('Belum dimuat', 'Not loaded'),
        className: 'text-[#526071] dark:text-[#929BA9]',
      };
    }
    if (snapshot.source === 'LIVE_DIRECT' || snapshot.source === 'LIVE_PROXY') {
      return {
        label:
          snapshot.source === 'LIVE_PROXY'
            ? tr('Live · Polymarket (Proxy)', 'Live · Polymarket (Proxy)')
            : tr('Live · Polymarket', 'Live · Polymarket'),
        className: 'text-[#059669] dark:text-[#00A878]',
      };
    }
    if (snapshot.source === 'CACHE_OFFLINE') {
      return {
        label: tr('Cache Offline', 'Offline Cache'),
        className: 'text-[#D97706] dark:text-[#F59E0B]',
      };
    }
    return {
      label: tr('Tidak Terjangkau', 'Unreachable'),
      className: 'text-[#E11D48] dark:text-[#E05260]',
    };
  }, [isLoading, snapshot, tr]);

  return (
    <section
      data-testid="polymarket-macro-sentiment-section"
      className="pt-6 border-t border-[#E4E4E7] dark:border-[#20252D] space-y-4"
    >
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        data-testid="polymarket-macro-sentiment-toggle"
        className="w-full py-2 flex items-center justify-between text-left hover:opacity-80 transition-opacity cursor-pointer"
      >
        <div className="space-y-0.5 pr-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-[#0F172A] dark:text-[#F2F4F7]">
              {tr('Sentimen Pasar Prediksi (Polymarket)', 'Prediction Market Sentiment (Polymarket)')}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.06em] px-1.5 py-0.5 rounded border border-[#E4E4E7] dark:border-[#2A303C] text-[#526071] dark:text-[#929BA9]">
              {tr('Referensi Tambahan · Non-Rule', 'Supplementary · Non-Rule')}
            </span>
          </div>
          <span className="text-xs text-[#526071] dark:text-[#929BA9] block">
            {tr(
              'Hanya kontrak aktif mendatang (Gold, The Fed, Makro AS & Geopolitik) — terpisah 100% dari skor & hukum bias XAUUSD.',
              'Upcoming active contracts only (Gold, Fed, US Macro & Geopolitics) — 100% isolated from XAUUSD bias rules and scoring.'
            )}
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-[#526071] dark:text-[#929BA9] shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-[#526071] dark:text-[#929BA9] shrink-0" />
        )}
      </button>

      {isExpanded && (
        <div
          data-testid="polymarket-macro-sentiment-panel"
          className="space-y-4 pt-1"
        >
          {/* Isolation & Non-Rule Notice */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 pb-3 border-b border-[#E4E4E7] dark:border-[#20252D]">
            <div className="flex items-start gap-2 text-[11px] text-[#526071] dark:text-[#929BA9] leading-relaxed">
              <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#526071] dark:text-[#929BA9]" />
              <span>
                {tr(
                  'Read-only & otomatis filter kontrak yang belum lewat jatuh tempo. Tidak masuk ke formula bias Fundamental Gold, Trade News, maupun Cycle Confluence.',
                  'Read-only & strictly filtered to unexpired contracts. Excluded from Fundamental Gold, Trade News, and Cycle Confluence bias formulas.'
                )}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0 text-[11px] font-mono-numbers tabular-nums">
              <span
                data-testid="polymarket-feed-status"
                className={`font-semibold ${statusMeta.className}`}
              >
                {statusMeta.label}
              </span>
              {snapshot?.fetchedAt && (
                <span className="text-[#526071] dark:text-[#929BA9]">
                  {formatTimestampWib(snapshot.fetchedAt)}
                </span>
              )}
              <button
                type="button"
                disabled={isLoading}
                onClick={() => void loadSentiment(true)}
                data-testid="polymarket-refresh-button"
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0F172A] dark:text-[#F2F4F7] hover:opacity-75 disabled:opacity-40 transition-opacity cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                <span>{tr('Perbarui', 'Refresh')}</span>
              </button>
            </div>
          </div>

          {/* Category Filter Strip + Compact How-to-Read Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {filterTabs.map((tab) => {
                const isSelected = activeCategory === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveCategory(tab.id)}
                    className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#0F172A] text-white dark:bg-[#F2F4F7] dark:text-[#0B0E13]'
                        : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] border border-[#E4E4E7] dark:border-[#20252D]'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setShowGuide((prev) => !prev)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] cursor-pointer"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>{tr('Cara Membaca', 'How to Read')}</span>
            </button>
          </div>

          {/* Inline XAUUSD Reading Guide */}
          {showGuide && (
            <div className="rounded-lg border border-[#E4E4E7] dark:border-[#20252D] px-3.5 py-3 space-y-1.5 text-[11px] text-[#526071] dark:text-[#929BA9] leading-relaxed">
              <p className="font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                {tr(
                  'Panduan singkat membaca sentimen Polymarket untuk XAUUSD:',
                  'Quick guide to reading Polymarket odds for XAUUSD:'
                )}
              </p>
              <p>
                <strong className="text-[#0F172A] dark:text-[#F2F4F7]">1. The Fed:</strong>{' '}
                {tr(
                  'Peluang Rate Cut naik -> cenderung mendukung XAUUSD naik (dovish). Peluang Rate Hike / 0 cut tinggi -> cenderung menekan XAUUSD (hawkish/USD kuat).',
                  'Higher Rate Cut odds -> generally bullish Gold (dovish). Higher Rate Hike / hold odds -> generally bearish Gold (hawkish/strong USD).'
                )}
              </p>
              <p>
                <strong className="text-[#0F172A] dark:text-[#F2F4F7]">2. Gold / XAU:</strong>{' '}
                {tr(
                  'Menunjukkan probabilitas harga menyentuh level target (↑ naik / ↓ turun) sebelum tanggal tutup kontrak. Perhatikan Vol 24j besar agar tidak terkecoh market sepi.',
                  'Shows crowd odds of Gold touching a level (↑ up / ↓ down) before contract expiry. Prioritize higher 24h Volume for more reliable pricing.'
                )}
              </p>
              <p>
                <strong className="text-[#0F172A] dark:text-[#F2F4F7]">3. Geopolitik & Makro AS:</strong>{' '}
                {tr(
                  'Peluang eskalasi konflik naik atau peluang gencatan senjata (ceasefire) turun -> memicu permintaan safe-haven XAUUSD. Sebaliknya, ceasefire tinggi cenderung meredakan premi risiko emas.',
                  'Rising conflict risk or falling ceasefire odds -> supports safe-haven Gold demand. High ceasefire odds tend to ease risk premiums.'
                )}
              </p>
            </div>
          )}

          {/* Warning notice if falling back to cache or unreachable */}
          {snapshot?.errorDetailId && (
            <p className="text-[11px] text-[#D97706] dark:text-[#F59E0B] leading-relaxed">
              {tr(snapshot.errorDetailId, snapshot.errorDetailEn || snapshot.errorDetailId)}
            </p>
          )}

          {/* Event Probability List */}
          {isLoading && visibleEvents.length === 0 ? (
            <div className="py-6 text-xs text-[#526071] dark:text-[#929BA9]">
              {tr(
                'Mengambil data probabilitas pasar dari Polymarket...',
                'Fetching live market probabilities from Polymarket...'
              )}
            </div>
          ) : visibleEvents.length === 0 ? (
            <div className="py-6 text-xs text-[#526071] dark:text-[#929BA9]">
              {tr(
                'Belum ada kontrak aktif mendatang pada kategori ini atau koneksi Polymarket sedang tidak tersedia.',
                'No upcoming active contracts available in this category or Polymarket feed is currently unavailable.'
              )}
            </div>
          ) : (
            <div className="divide-y divide-[#E4E4E7] dark:divide-[#20252D] border-t border-b border-[#E4E4E7] dark:border-[#20252D]">
              {visibleEvents.map((ev) => {
                const formattedEnd = formatPolymarketEndDate(ev.endDate, isEn);
                return (
                  <div key={ev.id} className="py-3.5 space-y-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#526071] dark:text-[#929BA9]">
                          <span>{categoryLabels[ev.category]}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-numbers tabular-nums">
                            {tr('Vol 24j', '24h Vol')} {formatCompactUsdVolume(ev.volume24hr)}
                          </span>
                          {formattedEnd && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono-numbers tabular-nums">
                                {tr(`Tutup ${formattedEnd}`, `Ends ${formattedEnd}`)}
                              </span>
                            </>
                          )}
                        </div>
                        <h4 className="text-xs sm:text-[13px] font-semibold text-[#0F172A] dark:text-[#F2F4F7] leading-snug">
                          {ev.title}
                        </h4>
                      </div>

                      {ev.polymarketUrl && (
                        <a
                          href={ev.polymarketUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={tr('Buka kontrak di Polymarket', 'Open market on Polymarket')}
                          className="inline-flex items-center gap-1 text-[10px] font-medium text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] shrink-0 pt-0.5"
                        >
                          <span>Polymarket</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>

                  {/* Probability Bars */}
                  <div className="space-y-1.5">
                    {ev.outcomes.map((outcome) => {
                      const clampedPct = Math.min(100, Math.max(0, outcome.probabilityPct));
                      const isLeading = outcome.probabilityPct >= 50;
                      return (
                        <div key={`${ev.id}-${outcome.label}`} className="space-y-1">
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="text-[#334155] dark:text-[#CBD5E1] truncate">
                              {outcome.label}
                            </span>
                            <span
                              className={`font-mono-numbers tabular-nums font-bold shrink-0 ${
                                isLeading
                                  ? 'text-[#0F172A] dark:text-[#F2F4F7]'
                                  : 'text-[#526071] dark:text-[#929BA9]'
                              }`}
                            >
                              {outcome.probabilityPct.toFixed(1)}%
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-[#E4E4E7] dark:bg-[#1E242E] overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                isLeading
                                  ? 'bg-[#0F172A] dark:bg-[#D1D5DB]'
                                  : 'bg-[#94A3B8] dark:bg-[#475569]'
                              }`}
                              style={{ width: `${clampedPct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
