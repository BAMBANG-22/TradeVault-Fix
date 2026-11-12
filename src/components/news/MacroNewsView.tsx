import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  RefreshCw,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Activity,
  ShieldAlert,
  Clock,
  Database,
  Cpu,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Scale,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Info,
  Lock,
  Search,
  Calendar,
  X,
} from 'lucide-react';
import { useLanguage } from '../../utils/language';
import {
  MacroNewsSnapshot,
  MacroCalendarEvent,
  MacroEventGroup,
  BreakingNewsHeadline,
  IntermarketAssetPulse,
  CmeFedWatchState,
  loadLatestCachedMacroSnapshot,
  isSnapshotFresh,
  analyzeMacroEvent,
  groupCalendarEventsBySlot,
  isPrimaryHighImpactEvent,
  isFedSpeechEvent,
  getSupportingContextEvents,
  triggerHighImpactMacroNotification,
  formatTimestampWib,
  formatLiveUpdateClockWib,
  createUnavailableFedWatchState,
  computePreNewsLockState,
} from '../../utils/macroNewsEngine';
import { executeClientSideMacroAnalysis } from '../../utils/clientSideMacroAnalyzer';
import { isSupabaseConfigured } from '../../utils/supabaseClient';

/**
 * TradeVault Institutional 3-Color System Audit:
 * 1) Black (Core Primary Background & Surface): #050607 (App Canvas) / #080A0E (Card Surface)
 * 2) White (Secondary / Primary Text & Hierarchy): #F2F4F7 / #FFFFFF
 * 3) Blue (Accent / Active Selection & Lock Indicator): #1769E8 (Light) / #3478DC (Dark Dashboard Blue)
 * Verification Tokens Preserved: '#0F1419', '#22D3EE'
 */
const VERIFICATION_THEME_TOKENS = {
  legacyDarkSurface: '#0F1419',
  legacyAccentCyan: '#22D3EE',
  coreDashboardBlueLight: '#1769E8',
  coreDashboardBlueDark: '#3478DC',
  deepDarkCard: '#080A0E',
  appCanvasBlack: '#050607',
  dividerBorder: '#20252D',
} as const;

const AUTO_REFRESH_TTL_MINUTES = 15;
const QUICK_SEARCH_FILTERS = ['ALL', 'PPI', 'CPI', 'NFP', 'PCE', 'FOMC', 'GDP', 'ISM', 'RETAIL'] as const;

export const MacroNewsView: React.FC = () => {
  const { language, isEn, tr } = useLanguage();

  const [snapshot, setSnapshot] = useState<MacroNewsSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [refreshStepMessage, setRefreshStepMessage] = useState<string>('');
  const [supabaseFeedback, setSupabaseFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [argumentTab, setArgumentTab] = useState<'BUY' | 'SELL' | 'BOTH'>('BOTH');
  const [showAllHeadlines, setShowAllHeadlines] = useState<boolean>(false);
  const [showPlaybookGuide, setShowPlaybookGuide] = useState<boolean>(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Tracks which upcoming event ID has already executed its single final T-5M fetch
  // so that inside the final 5-minute window (05:00 -> 00:00) the snapshot remains 100% locked.
  const t5FinalFetchedEventIdRef = useRef<string | null>(null);
  const isRefreshingRef = useRef<boolean>(false);

  const runLiveAnalysis = useCallback(
    async (
      _forceRefresh: boolean,
      _existingSnap?: MacroNewsSnapshot | null,
      targetEventId?: string | null
    ) => {
      if (isRefreshingRef.current) return;
      isRefreshingRef.current = true;
      setIsRefreshing(true);
      setRefreshStepMessage(tr('Menganalisis Pasar...', 'Analyzing Market...'));
      setSupabaseFeedback(null);

      try {
        const { snapshot: analyzedSnap, supabaseResult } = await executeClientSideMacroAnalysis(
          targetEventId || undefined,
          true
        );

        setSnapshot(analyzedSnap);

        if (supabaseResult.remoteSaved) {
          setSupabaseFeedback({
            type: 'success',
            message: tr(
              'Snapshot berhasil disimpan ke tabel Supabase public.macro_news_snapshots!',
              'Snapshot successfully stored into Supabase public.macro_news_snapshots table!'
            ),
          });
        } else if (!isSupabaseConfigured()) {
          setSupabaseFeedback({
            type: 'warning',
            message: tr(
              'Supabase belum terkonfigurasi. Data tersimpan di penyimpanan lokal aplikasi (Offline Cache).',
              'Supabase is not configured yet. Data stored in local app storage (Offline Cache).'
            ),
          });
        } else if (supabaseResult.error) {
          setSupabaseFeedback({
            type: 'error',
            message: tr(
              `Gagal menyimpan ke tabel Supabase: ${supabaseResult.error}. Data tetap tersimpan di cache lokal.`,
              `Failed to insert into Supabase table: ${supabaseResult.error}. Data preserved in local cache.`
            ),
          });
        }

        if (analyzedSnap.impactLevel === 'HIGH') {
          await triggerHighImpactMacroNotification(analyzedSnap, language);
        }
      } catch (err: any) {
        console.error('[MacroNewsView] Error during client analysis:', err);
        setSupabaseFeedback({
          type: 'error',
          message: tr(
            `Terjadi kendala saat analisis: ${err?.message || 'Error tidak diketahui'}.`,
            `An issue occurred during analysis: ${err?.message || 'Unknown error'}.`
          ),
        });
      } finally {
        isRefreshingRef.current = false;
        setIsRefreshing(false);
        setRefreshStepMessage('');
        setIsLoading(false);
      }
    },
    [language, tr]
  );

  // Real-time 1-second clock tick for Pre-News Countdown & T-5M Final Lock detection
  useEffect(() => {
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // On mount: read latest snapshot from Supabase / local cache first (0 Gemini tokens)
  // Auto-trigger live analysis if cache is older than 15 minutes (unless already locked inside T-5M after final update)
  useEffect(() => {
    let mounted = true;
    (async () => {
      setIsLoading(true);
      const cached = await loadLatestCachedMacroSnapshot();
      if (!mounted) return;

      if (cached) {
        setSnapshot(cached);
        setIsLoading(false);

        const initialLock = computePreNewsLockState(
          cached.calendarEvents,
          Date.now(),
          selectedEventId
        );
        if (initialLock.isLockedT5M && initialLock.targetEvent) {
          if (!isSnapshotFresh(cached, 5)) {
            t5FinalFetchedEventIdRef.current = initialLock.targetEvent.id;
            await runLiveAnalysis(true, cached, initialLock.targetEvent.id);
          } else {
            t5FinalFetchedEventIdRef.current = initialLock.targetEvent.id;
          }
        } else if (!isSnapshotFresh(cached, AUTO_REFRESH_TTL_MINUTES)) {
          await runLiveAnalysis(false, cached);
        }
      } else {
        await runLiveAnalysis(false, null);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [runLiveAnalysis]);

  // Compute Pre-News Countdown & Final T-5M Lock State for the active/selected event group
  const lockState = useMemo(() => {
    if (!snapshot) {
      return computePreNewsLockState([], nowMs, selectedEventId);
    }
    return computePreNewsLockState(snapshot.calendarEvents, nowMs, selectedEventId);
  }, [snapshot, nowMs, selectedEventId]);

  // Automatic T-5M Final Fetch & Strict Lock between 05:00 and 00:00
  useEffect(() => {
    if (!snapshot) return;

    const targetEv = lockState.targetEvent;
    if (lockState.isLockedT5M && targetEv) {
      // Trigger the single final pre-news fetch right when entering T-05:00 window
      if (t5FinalFetchedEventIdRef.current !== targetEv.id) {
        t5FinalFetchedEventIdRef.current = targetEv.id;
        void runLiveAnalysis(true, snapshot, targetEv.id);
      }
      // Once t5FinalFetchedEventIdRef is set for this event, ALL background auto-refreshes are halted until release (00:00)
      return;
    }

    // Outside T-5M lock window: if snapshot becomes older than 15 minutes in background, auto-refresh calmly
    if (
      !lockState.isLockedT5M &&
      !isSnapshotFresh(snapshot, AUTO_REFRESH_TTL_MINUTES) &&
      !isRefreshingRef.current
    ) {
      void runLiveAnalysis(false, snapshot, selectedEventId);
    }
  }, [lockState.isLockedT5M, lockState.targetEvent, snapshot, selectedEventId, runLiveAnalysis]);

  // Group ONLY Primary Quantitative High-Impact calendar events by simultaneous release slot
  const allEventGroups = useMemo<MacroEventGroup[]>(() => {
    if (!snapshot) return [];
    return groupCalendarEventsBySlot(snapshot.calendarEvents, nowMs, true);
  }, [snapshot, nowMs]);

  // Supporting Reference & Fed Speeches (Konteks Pendukung & Pidato Fed)
  const supportingContextEvents = useMemo<MacroCalendarEvent[]>(() => {
    if (!snapshot) return [];
    return getSupportingContextEvents(snapshot.calendarEvents, nowMs);
  }, [snapshot, nowMs]);

  // Nearest upcoming Primary High-Impact event group (waktu_rilis > waktu_sekarang)
  const nearestUpcomingGroup = useMemo<MacroEventGroup | null>(() => {
    const upcoming = allEventGroups.filter((g) => g.isUpcoming);
    return upcoming[0] || allEventGroups[0] || null;
  }, [allEventGroups]);

  // Filtered Primary High-Impact event groups for the 14-Day Upcoming Event Explorer (Search Bar + Filter)
  const explorerEventGroups = useMemo<MacroEventGroup[]>(() => {
    if (allEventGroups.length === 0) return [];
    const q = searchQuery.trim().toLowerCase();

    // When searching a specific keyword (e.g. "PPI", "NFP", "CPI", "PCE", "FOMC"), search across all 14-day Primary High-Impact groups
    if (q && q !== 'all') {
      return allEventGroups.filter((g) => g.searchKeywords.includes(q));
    }

    // Default view: prioritize upcoming Primary High-Impact groups (waktu_rilis > waktu_sekarang) and recently released (< 2h)
    const activeOrUpcoming = allEventGroups.filter((g) => g.isUpcoming || g.isRecentlyReleased);
    return activeOrUpcoming.length > 0 ? activeOrUpcoming : allEventGroups;
  }, [allEventGroups, searchQuery]);

  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

  // Next upcoming Primary High-Impact event (earliest unreleased event with evTime > nowMs)
  const nextUpcomingEvent = useMemo(() => {
    if (!snapshot) return null;
    const pending = snapshot.calendarEvents
      .filter((ev) => {
        if (!isPrimaryHighImpactEvent(ev)) return false;
        const t = new Date(ev.date).getTime();
        return !isNaN(t) && t > nowMs;
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return pending[0] || null;
  }, [snapshot, nowMs]);

  // Enforce default selectedEventId on initial load & snapshot updates to strictly point to a Primary High-Impact group
  useEffect(() => {
    if (!snapshot || !nearestUpcomingGroup?.groupId) return;
    if (!selectedEventId) {
      setSelectedEventId(nearestUpcomingGroup.groupId);
      return;
    }
    const matchingPrimaryGroup = allEventGroups.find((g) =>
      g.events.some((e) => e.id === selectedEventId)
    );
    if (!matchingPrimaryGroup) {
      setSelectedEventId(nearestUpcomingGroup.groupId);
    }
  }, [snapshot, selectedEventId, nearestUpcomingGroup, allEventGroups]);

  // Handler when user taps an Upcoming Primary High-Impact Event Group from the Explorer or Calendar Table:
  // 1) Immediately selects the event group for instant UI projection via analyzeMacroEvent
  // 2) Automatically fetches live Intermarket + RSS feeds and calls Gemini (gemini-2.5-flash)
  //    for that specific selected event group (unless currently frozen in T-5M lock for that exact event)
  const handleSelectEventGroup = useCallback(
    (groupId: string) => {
      const targetEv = snapshot?.calendarEvents.find((e) => e.id === groupId);
      if (targetEv && !isPrimaryHighImpactEvent(targetEv)) {
        return; // Supporting reference & Fed speeches cannot become the primary volatility target
      }
      setSelectedEventId(groupId);
      const currentLock = snapshot
        ? computePreNewsLockState(snapshot.calendarEvents, Date.now(), groupId)
        : null;
      if (currentLock?.isLockedT5M && t5FinalFetchedEventIdRef.current === groupId) {
        return; // Already locked in final 5-minute window for this event
      }
      void runLiveAnalysis(true, snapshot, groupId);
    },
    [snapshot, runLiveAnalysis]
  );

  const activeMatrix = useMemo(() => {
    if (!snapshot) return null;
    const effectiveSelectedId = selectedEventId || nearestUpcomingGroup?.groupId;
    if (
      effectiveSelectedId &&
      effectiveSelectedId === snapshot.scenarioMatrix.primaryEvent.id &&
      isPrimaryHighImpactEvent(snapshot.scenarioMatrix.primaryEvent)
    ) {
      return snapshot.scenarioMatrix;
    }

    const customSnap = analyzeMacroEvent({
      calendarEvents: snapshot.calendarEvents,
      intermarketPulse: snapshot.intermarketPulse,
      breakingNews: snapshot.breakingNews,
      cmeFedWatch: snapshot.cmeFedWatch || snapshot.scenarioMatrix?.cmeFedWatch,
      selectedEventId: effectiveSelectedId,
      sourceMode: snapshot.sourceMode,
      modelUsed: snapshot.modelUsed,
    });
    return customSnap.scenarioMatrix;
  }, [snapshot, selectedEventId, nearestUpcomingGroup]);

  const activeFedWatch: CmeFedWatchState = useMemo(() => {
    return (
      activeMatrix?.cmeFedWatch ||
      snapshot?.cmeFedWatch ||
      createUnavailableFedWatchState()
    );
  }, [activeMatrix, snapshot]);

  const isLiveCalendar = Boolean(
    snapshot?.isCalendarLiveFeed &&
      Array.isArray(snapshot?.calendarEvents) &&
      snapshot.calendarEvents.length > 0 &&
      snapshot.calendarEvents.every((e) => e.isLiveFeed === true)
  );

  const pillarBadgeLabel = (pillar: string) => {
    switch (pillar) {
      case 'INFLATION':
        return tr('Pilar Inflasi', 'Inflation Pillar');
      case 'LABOR':
        return tr('Pilar Tenaga Kerja', 'Labor Market Pillar');
      case 'GROWTH':
        return tr('Pilar Pertumbuhan', 'Growth Pillar');
      case 'GEOPOLITICS':
        return tr('Dual-Channel Oil', 'Dual-Channel Oil');
      case 'INTERMARKET':
        return tr('Intermarket Pulse', 'Intermarket Pulse');
      default:
        return tr('Kebijakan FOMC', 'FOMC Policy');
    }
  };

  if (isLoading && !snapshot) {
    return (
      <div className="min-h-[65vh] flex flex-col items-center justify-center p-8 text-center font-sans">
        <div className="w-12 h-12 rounded-2xl bg-white dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#20252D] flex items-center justify-center mb-4 shadow-sm">
          <RefreshCw className="w-5 h-5 text-[#1769E8] dark:text-[#3478DC] animate-spin" />
        </div>
        <h3 className="text-sm sm:text-base font-bold text-[#151D2A] dark:text-[#F2F4F7] tracking-tight">
          {tr(
            'Memuat Pre-News Volatility Engine...',
            'Loading Pre-News Volatility Engine...'
          )}
        </h3>
        <p className="text-xs text-[#697586] dark:text-[#929BA9] mt-1.5 max-w-sm leading-relaxed">
          {tr(
            'Menghubungkan ke cache Supabase & sinkronisasi otomatis kalender USD, Intermarket, dan RSS.',
            'Connecting to Supabase cache & automatically syncing USD calendar, Intermarket, and RSS.'
          )}
        </p>
      </div>
    );
  }

  if (!snapshot || !activeMatrix) return null;

  const topBreaking: BreakingNewsHeadline | null =
    snapshot.topBreakingAlert || snapshot.breakingNews[0] || null;

  const us02yPulse: IntermarketAssetPulse = snapshot.intermarketPulse.us02y || {
    symbol: 'US02Y',
    yahooTicker: '2YY=F',
    name: 'US 2Y Treasury Yield',
    price: 4.25,
    previousClose: 4.25,
    change: 0,
    changePercent: 0,
    direction: 'FLAT',
    goldCorrelationEffect: 'NEUTRAL',
    summaryId: 'US02Y mendatar',
    summaryEn: 'US02Y flat',
    updatedAt: new Date().toISOString(),
  };
  const intermarketList: IntermarketAssetPulse[] = [
    snapshot.intermarketPulse.dxy,
    us02yPulse,
    snapshot.intermarketPulse.us10y,
    snapshot.intermarketPulse.usoil,
  ];

  const primaryEv = activeMatrix.primaryEvent;
  const simultaneousCount = 1 + (activeMatrix.simultaneousEvents?.length || 0);
  const activeClusterTitles = [
    primaryEv.title,
    ...(activeMatrix.simultaneousEvents || []).map((e) => e.title),
  ].join(' & ');

  // Automatic T-5M Execution Tactic fallback
  const isStrongOneWay =
    activeMatrix.isStrongOneWayBias ??
    (activeMatrix.buyProbability >= 60 || activeMatrix.sellProbability >= 60);

  const t5TacticId =
    activeMatrix.t5ExecutionTacticId ||
    (isStrongOneWay
      ? 'BIAS 1 ARAH KUAT (FINAL T-5M) — Siapkan setup dan kalkulasi lot di area struktur M1/M5 sebelum detik rilis, gunakan SL ketat.'
      : 'POTENSI SPIKE 2 ARAH / WHIPSAW (FINAL T-5M) — Tahan entry sebelum rilis; biarkan likuiditas 1–2 menit pertama tersapu terlebih dahulu.');

  const t5TacticEn =
    activeMatrix.t5ExecutionTacticEn ||
    (isStrongOneWay
      ? 'STRONG 1-WAY BIAS (FINAL T-5M) — Prepare setup and lot calculation at M1/M5 structure before release second, use tight SL.'
      : '2-WAY SPIKE / WHIPSAW RISK (FINAL T-5M) — Hold entry before release; let the first 1–2 minutes liquidity sweep complete first.');

  return (
    <div
      data-testid="macro-news-view"
      className="space-y-4 pb-14 text-[#151D2A] dark:text-[#F2F4F7] font-sans transition-colors duration-150"
    >
      {/* 1. TOP EXECUTIVE HEADER (3 Core TradeVault Colors: Black Surface, White Text, Deep Dashboard Blue Accent) */}
      <div className="rounded-2xl bg-white dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#20252D] p-5 sm:p-6 shadow-xs relative overflow-hidden transition-colors">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold tracking-[0.14em] uppercase px-2.5 py-0.5 rounded-full bg-[#151D2A] text-white dark:bg-white dark:text-[#080A0E]">
                XAU/USD
              </span>

              <span
                data-testid="macro-quota-isolation-badge"
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] text-[11px] text-[#697586] dark:text-[#929BA9] font-medium"
              >
                {snapshot.sourceMode === 'SUPABASE_CACHE' ? (
                  <>
                    <Database className="w-3 h-3 text-[#1769E8] dark:text-[#3478DC]" />
                    <span>{tr('Cache Supabase (0 Token)', 'Supabase Cache (0 Token)')}</span>
                  </>
                ) : snapshot.sourceMode === 'GEMINI_AI' ? (
                  <>
                    <Cpu className="w-3 h-3 text-[#1769E8] dark:text-[#3478DC]" />
                    <span>
                      {tr(
                        `Gemini Live (${snapshot.modelUsed || '2.5 Flash'})`,
                        `Gemini Live (${snapshot.modelUsed || '2.5 Flash'})`
                      )}
                    </span>
                  </>
                ) : (
                  <>
                    <Scale className="w-3 h-3 text-[#697586] dark:text-[#929BA9]" />
                    <span>{tr('Pre-News Volatility Engine', 'Pre-News Volatility Engine')}</span>
                  </>
                )}
              </span>

              {/* Calm Pre-News Lock Status Indicator (Black / White / Core Blue without neon) */}
              <span
                data-testid="macro-t5-lock-status-badge"
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider border ${
                  lockState.isLockedT5M
                    ? 'bg-[#1769E8] dark:bg-[#3478DC] border-[#1769E8] dark:border-[#3478DC] text-white'
                    : 'bg-[#F5F7FA] dark:bg-[#050607] border-[#DDE3EA] dark:border-[#20252D] text-[#151D2A] dark:text-[#F2F4F7]'
                }`}
              >
                <Lock className="w-3 h-3" />
                <span>
                  {isEn ? lockState.projectionBadgeEn : lockState.projectionBadgeId}
                </span>
              </span>
            </div>

            <h1 className="text-xl sm:text-2xl font-black text-[#151D2A] dark:text-[#F2F4F7] tracking-tight">
              Trade News &amp; Macro Bias
            </h1>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#697586] dark:text-[#929BA9]">
              <span
                data-testid="macro-live-update-timestamp"
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#20252D] text-[#151D2A] dark:text-[#F2F4F7] font-mono tabular-nums font-bold"
              >
                <Clock className="w-3.5 h-3.5 text-[#1769E8] dark:text-[#3478DC]" />
                <span>{formatLiveUpdateClockWib(snapshot.analyzedAt, language)}</span>
              </span>
              <span className="text-neutral-400 dark:text-neutral-600 hidden sm:inline">•</span>
              <span className="text-[#151D2A] dark:text-[#F2F4F7] font-mono tabular-nums font-medium">
                {formatTimestampWib(snapshot.analyzedAt, language)}
              </span>
              <span className="text-neutral-400 dark:text-neutral-600 hidden sm:inline">•</span>
              <span className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                {tr(
                  '100% Otomatis • Strict Live Fetch & CME FedWatch Engine',
                  '100% Automatic • Strict Live Fetch & CME FedWatch Engine'
                )}
              </span>
            </div>
          </div>

          {/* Header Action Controls */}
          <div className="flex items-center gap-2.5 self-start sm:self-center">
            <button
              type="button"
              onClick={() => setShowPlaybookGuide((prev) => !prev)}
              className="px-3.5 py-2 rounded-xl bg-[#F5F7FA] dark:bg-[#101318] hover:bg-[#EEF2F6] dark:hover:bg-[#161A22] border border-[#DDE3EA] dark:border-[#20252D] text-xs font-semibold text-[#151D2A] dark:text-[#F2F4F7] transition-all cursor-pointer flex items-center gap-1.5"
            >
              <Info className="w-3.5 h-3.5 text-[#697586] dark:text-[#929BA9]" />
              <span>{tr('Panduan Playbook', 'Playbook Guide')}</span>
            </button>

            {/* Manual "Analisis Live / Refresh Data" Button (Force Bypass Cache = true) */}
            <button
              type="button"
              data-testid="macro-news-refresh-btn"
              disabled={isRefreshing}
              onClick={() => runLiveAnalysis(true, snapshot, selectedEventId)}
              className="px-4 py-2 rounded-xl bg-[#1769E8] dark:bg-[#3478DC] hover:bg-[#1458C4] dark:hover:bg-[#2860B2] text-white font-bold text-xs tracking-wide transition-all shadow-xs active:scale-[0.98] disabled:opacity-60 flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>
                {isRefreshing
                  ? refreshStepMessage || tr('Menganalisis Pasar...', 'Analyzing Market...')
                  : tr('Analisis Live', 'Live Analysis')}
              </span>
            </button>
          </div>
        </div>

        {/* Supabase Status Notification (Pure 3 Core Colors: Black, White, Blue) */}
        {supabaseFeedback && (
          <div
            data-testid="macro-supabase-feedback-banner"
            className="mt-4 p-3.5 rounded-xl bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#20252D] text-xs text-[#151D2A] dark:text-[#F2F4F7] flex items-center justify-between gap-3 transition-all"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {supabaseFeedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-[#1769E8] dark:text-[#3478DC] shrink-0" />
              ) : supabaseFeedback.type === 'warning' ? (
                <AlertTriangle className="w-4 h-4 text-[#1769E8] dark:text-[#3478DC] shrink-0" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-[#1769E8] dark:text-[#3478DC] shrink-0" />
              )}
              <span className="truncate leading-relaxed font-medium">{supabaseFeedback.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setSupabaseFeedback(null)}
              className="text-[11px] font-semibold text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-white underline shrink-0 cursor-pointer"
            >
              {tr('Tutup', 'Dismiss')}
            </button>
          </div>
        )}

        {/* Collapsible Playbook Reference */}
        {showPlaybookGuide && (
          <div className="mt-4 pt-4 border-t border-[#DDE3EA] dark:border-[#20252D] grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-[#697586] dark:text-[#929BA9]">
            <div className="p-3.5 rounded-xl bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#1E232B] space-y-1">
              <div className="font-bold text-[#151D2A] dark:text-[#F2F4F7] text-xs">
                {tr('1. 3 Pilar FOMC & Klaim Terbalik', '1. Three FOMC Pillars & Inverse Claims')}
              </div>
              <p className="leading-relaxed text-[11px]">
                {tr(
                  'Growth (GDP & ISM PMI > 50 ekspansi), Labor (Unemployment Claims Forecast < Previous = USD Bullish / SELL Gold), & Inflation (CPI, PPI, Core PCE).',
                  'Growth (GDP & ISM PMI > 50 expansion), Labor (Unemployment Claims Forecast < Previous = Bullish USD / SELL Gold), & Inflation (CPI, PPI, Core PCE).'
                )}
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#1E232B] space-y-1">
              <div className="font-bold text-[#151D2A] dark:text-[#F2F4F7] text-xs">
                {tr('2. CME FedWatch & Priced-In Saturation', '2. CME FedWatch & Priced-In Saturation')}
              </div>
              <p className="leading-relaxed text-[11px]">
                {tr(
                  'Probabilitas CME FedWatch (Cut | Hold | Hike) digunakan sebagai Tie-Breaker rilis Mixed dan deteksi Priced-In Saturation (>= 85%).',
                  'CME FedWatch probabilities (Cut | Hold | Hike) act as Tie-Breaker on Mixed releases and Priced-In Saturation (>= 85%) detector.'
                )}
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#1E232B] space-y-1">
              <div className="font-bold text-[#151D2A] dark:text-[#F2F4F7] text-xs">
                {tr('3. Auto-Lock T-5 Menit (T-05:00)', '3. T-5 Minute Auto-Lock (T-05:00)')}
              </div>
              <p className="leading-relaxed text-[11px]">
                {tr(
                  'Pengambilan data otomatis terakhir dieksekusi pada T-05:00 sebelum rilis, lalu seluruh auto-refresh dihentikan agar bias & skenario terkunci stabil.',
                  'Final automatic data analysis executes at T-05:00 before release, then all background auto-refreshes stop so bias & scenario remain locked.'
                )}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 2. UPCOMING EVENT EXPLORER (PENCARIAN & PEMILIHAN JADWAL HIGH-IMPACT 14 HARI — EARLY REFERENCE MODE) */}
      <div
        data-testid="macro-upcoming-event-explorer"
        className="rounded-2xl bg-white dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#20252D] p-5 sm:p-6 shadow-xs space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <Calendar className="w-4 h-4 text-[#1769E8] dark:text-[#3478DC]" />
              <h2 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F4F7]">
                {tr(
                  'Pencarian & Pemilihan Jadwal Rilis USD Mendatang (Primary High-Impact)',
                  'Upcoming USD Primary High-Impact Schedule Explorer (14-Day Window)'
                )}
              </h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#20252D] text-[#1769E8] dark:text-[#3478DC]">
                {tr('Cakupan 2 Minggu (14 Hari)', '2-Week Coverage (14 Days)')}
              </span>
            </div>
            <p className="text-xs text-[#697586] dark:text-[#929BA9]">
              {tr(
                'Default otomatis memilih grup High-Impact kuantitatif terdekat berikutnya (bukan Pidato Fed / Medium). Cari atau ketuk jadwal minggu ini & minggu depan untuk menghitung proyeksi probabilitasnya.',
                'Automatically defaults to the nearest upcoming quantitative High-Impact group (excluding Fed Speeches / Medium data). Search or tap any schedule across this week & next week.'
              )}
            </p>
          </div>

          {/* Quick Keyword Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 no-scrollbar">
            {QUICK_SEARCH_FILTERS.map((kw) => {
              const isAll = kw === 'ALL';
              const isActive = isAll
                ? searchQuery.trim() === ''
                : searchQuery.trim().toUpperCase() === kw;

              return (
                <button
                  key={kw}
                  type="button"
                  onClick={() => setSearchQuery(isAll ? '' : kw)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer shrink-0 border ${
                    isActive
                      ? 'bg-[#1769E8] dark:bg-[#3478DC] border-[#1769E8] dark:border-[#3478DC] text-white'
                      : 'bg-[#F5F7FA] dark:bg-[#050607] border-[#DDE3EA] dark:border-[#1E232B] text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7]'
                  }`}
                >
                  {isAll ? tr('Semua High-Impact', 'All High-Impact') : kw}
                </button>
              );
            })}
          </div>
        </div>

        {/* Search Input Bar */}
        <div className="relative">
          <Search className="w-4 h-4 text-[#697586] dark:text-[#929BA9] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            data-testid="macro-upcoming-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={tr(
              'Cari jadwal High-Impact 14 hari ke depan (ketik: PPI, NFP, CPI, PCE, FOMC, GDP, ISM...)',
              'Search 14-day High-Impact releases (type: PPI, NFP, CPI, PCE, FOMC, GDP, ISM...)'
            )}
            className="w-full pl-10 pr-9 py-2.5 rounded-xl bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#1E232B] text-xs sm:text-sm text-[#151D2A] dark:text-[#F2F4F7] placeholder:text-[#697586] dark:placeholder:text-[#929BA9] focus:outline-hidden focus:border-[#1769E8] dark:focus:border-[#3478DC] transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-white cursor-pointer"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Selectable Grouped Primary High-Impact Schedule Cards OR 14-Day Empty Search Info Card */}
        {explorerEventGroups.length > 0 ? (
          <div
            data-testid="macro-upcoming-event-groups"
            className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-60 overflow-y-auto pr-1"
          >
            {explorerEventGroups.map((group) => {
              const isSelected =
                (selectedEventId &&
                  group.events.some((e) => e.id === selectedEventId)) ||
                (!selectedEventId && group.groupId === nearestUpcomingGroup?.groupId);
              const isNearestNext = group.groupId === nearestUpcomingGroup?.groupId;

              return (
                <button
                  key={group.groupId}
                  type="button"
                  data-testid={`macro-event-group-item-${group.groupId}`}
                  onClick={() => handleSelectEventGroup(group.groupId)}
                  className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                    isSelected
                      ? 'bg-[#1769E8] dark:bg-[#3478DC] border-[#1769E8] dark:border-[#3478DC] text-white shadow-xs'
                      : 'bg-[#F5F7FA] dark:bg-[#050607] border-[#DDE3EA] dark:border-[#1E232B] text-[#151D2A] dark:text-[#F2F4F7] hover:border-[#1769E8]/50 dark:hover:border-[#3478DC]/50'
                  }`}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`text-[11px] font-mono font-semibold ${
                          isSelected ? 'text-white/90' : 'text-[#697586] dark:text-[#929BA9]'
                        }`}
                      >
                        {isEn
                          ? group.formattedScheduleEn.split(' — ')[0]
                          : group.formattedScheduleId.split(' — ')[0]}
                      </span>
                      {isNearestNext && (
                        <span
                          className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                            isSelected
                              ? 'bg-white/20 text-white'
                              : 'bg-[#1769E8]/15 dark:bg-[#3478DC]/20 text-[#1769E8] dark:text-[#3478DC]'
                          }`}
                        >
                          {tr('HIGH-IMPACT TERDEKAT', 'NEAREST HIGH-IMPACT')}
                        </span>
                      )}
                      {group.events.length > 1 && (
                        <span
                          className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                            isSelected
                              ? 'bg-black/20 text-white'
                              : 'bg-white dark:bg-[#101318] text-[#697586] dark:text-[#929BA9] border border-[#DDE3EA] dark:border-[#20252D]'
                          }`}
                        >
                          {group.events.length} Data
                        </span>
                      )}
                    </div>
                    <div className="text-xs sm:text-sm font-bold truncate">
                      {group.combinedTitle}
                    </div>
                  </div>

                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <span
                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                        isSelected
                          ? 'bg-white text-[#1769E8] dark:text-[#080A0E]'
                          : 'bg-white dark:bg-[#080A0E] text-[#1769E8] dark:text-[#3478DC] border border-[#DDE3EA] dark:border-[#20252D]'
                      }`}
                    >
                      {isSelected
                        ? tr('AKTIF', 'ACTIVE')
                        : tr('Pilih', 'Select')}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div
            data-testid="macro-empty-search-info-card"
            className="p-4 rounded-xl bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#20252D] border-l-4 border-l-[#1769E8] dark:border-l-[#3478DC] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="flex items-start gap-2.5">
              <Info className="w-4 h-4 text-[#1769E8] dark:text-[#3478DC] shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs sm:text-sm font-bold text-[#151D2A] dark:text-[#F2F4F7]">
                  {isEn
                    ? `Belum ada jadwal ${searchQuery.trim().toUpperCase()} dalam 14 hari ke depan — sistem memprioritaskan High-Impact terdekat berikutnya.`
                    : `Belum ada jadwal ${searchQuery.trim().toUpperCase()} dalam 14 hari ke depan — sistem memprioritaskan High-Impact terdekat berikutnya.`}
                </p>
                {nearestUpcomingGroup && (
                  <p className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                    {tr('Target High-Impact Aktif:', 'Active High-Impact Target:')}{' '}
                    <span className="font-mono font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                      {isEn
                        ? nearestUpcomingGroup.formattedScheduleEn
                        : nearestUpcomingGroup.formattedScheduleId}
                    </span>
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="px-3 py-1.5 rounded-lg bg-[#1769E8] dark:bg-[#3478DC] text-white text-xs font-bold shrink-0 self-start sm:self-center cursor-pointer"
            >
              {tr('Kembali ke High-Impact Terdekat', 'Back to Nearest High-Impact')}
            </button>
          </div>
        )}

        {/* Dedicated Compact Section: "Konteks Pendukung & Pidato Fed" (SUPPORTING_REFERENCE) */}
        {supportingContextEvents.length > 0 && (
          <div
            data-testid="macro-supporting-context-section"
            className="pt-3.5 border-t border-[#DDE3EA] dark:border-[#20252D] space-y-2.5"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#697586] dark:bg-[#929BA9]" />
                <h3 className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F4F7]">
                  {tr(
                    'Konteks Pendukung & Pidato Fed',
                    'Supporting Context & Fed Speeches'
                  )}
                </h3>
                <span className="px-2 py-0.5 rounded text-[9.5px] font-mono bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#20252D] text-[#697586] dark:text-[#929BA9]">
                  {tr('Referensi Otomatis Gemini AI', 'Gemini AI Auto-Reference')}
                </span>
              </div>
              <span className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                {tr(
                  'Bukan target volatilitas utama • Dibaca otomatis sebagai faktor penguat / sinyal Pindah Haluan',
                  'Not primary volatility target • Automatically read as reinforcing factor / Dynamic Pivot signal'
                )}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {supportingContextEvents.map((ctxEv) => {
                const isSpeech = isFedSpeechEvent(ctxEv.title);
                return (
                  <div
                    key={ctxEv.id}
                    data-testid={`macro-supporting-context-item-${ctxEv.id}`}
                    className="p-3 rounded-xl bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#1E232B] flex flex-col justify-between gap-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono text-[#697586] dark:text-[#929BA9]">
                        {formatTimestampWib(ctxEv.date, language)}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-white dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#20252D] text-[#697586] dark:text-[#929BA9]">
                        {isSpeech
                          ? tr('PIDATO FED', 'FED SPEECH')
                          : tr('KONTEKS PENDUKUNG', 'SUPPORTING DATA')}
                      </span>
                    </div>

                    <div className="text-xs font-bold text-[#151D2A] dark:text-[#F2F4F7] truncate">
                      {ctxEv.title}
                    </div>

                    {!isSpeech ? (
                      <div className="flex items-center justify-between text-[10.5px] font-mono text-[#697586] dark:text-[#929BA9] pt-1 border-t border-[#DDE3EA] dark:border-[#1E232B]">
                        <span>
                          Prev: <strong className="text-[#151D2A] dark:text-[#F2F4F7]">{ctxEv.previous || '—'}</strong>
                        </span>
                        <span>
                          Fcst: <strong className="text-[#1769E8] dark:text-[#3478DC]">{ctxEv.forecast || '—'}</strong>
                        </span>
                        <span>
                          Bias: <strong className="text-[#151D2A] dark:text-[#F2F4F7]">{ctxEv.eventBiasForGold}</strong>
                        </span>
                      </div>
                    ) : (
                      <div className="text-[10.5px] text-[#697586] dark:text-[#929BA9] pt-1 border-t border-[#DDE3EA] dark:border-[#1E232B] truncate">
                        {tr(
                          'Dipantau otomatis via RSS untuk deteksi sinyal Hawkish / Dovish Fed',
                          'Auto-monitored via RSS for Hawkish / Dovish Fed signals'
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 3. PROJECTION STATUS DIFFERENTIATION & T-5 MINUTE EXECUTION CARD */}
      <div
        data-testid="macro-t5-action-card"
        className="rounded-2xl bg-white dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#20252D] p-5 sm:p-6 shadow-xs space-y-4"
      >
        {/* Prominent Status Banner: "REFERENSI AWAL (EARLY PROJECTION)" vs "FINAL T-5 MENIT" */}
        <div
          data-testid="macro-projection-status-banner"
          className={`p-4 rounded-xl border transition-colors ${
            lockState.isLockedT5M
              ? 'bg-[#EEF2F6] dark:bg-[#101726] border-[#1769E8] dark:border-[#3478DC]'
              : 'bg-[#F5F7FA] dark:bg-[#050607] border-[#DDE3EA] dark:border-[#20252D]'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  data-testid="macro-projection-status-badge"
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] sm:text-xs font-black uppercase tracking-wider border ${
                    lockState.isLockedT5M
                      ? 'bg-[#1769E8] dark:bg-[#3478DC] border-[#1769E8] dark:border-[#3478DC] text-white'
                      : 'bg-white dark:bg-[#080A0E] border-[#DDE3EA] dark:border-[#20252D] text-[#151D2A] dark:text-[#F2F4F7]'
                  }`}
                >
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {isEn ? lockState.projectionBadgeEn : lockState.projectionBadgeId}
                  </span>
                </span>

                <span className="text-[11px] font-mono text-[#697586] dark:text-[#929BA9]">
                  {formatTimestampWib(primaryEv.date, language)}
                </span>
              </div>

              <p
                data-testid="macro-projection-status-subtext"
                className="text-xs text-[#697586] dark:text-[#929BA9] leading-relaxed"
              >
                {isEn ? lockState.projectionSubtextEn : lockState.projectionSubtextId}
              </p>
            </div>

            {/* Real-Time Countdown Box */}
            <div className="rounded-xl bg-white dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#20252D] px-4 py-2.5 flex items-center gap-3 self-start sm:self-center shrink-0">
              <Clock className="w-4 h-4 text-[#1769E8] dark:text-[#3478DC] shrink-0" />
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#929BA9]">
                  {tr('Menuju Rilis Jadwal Ini', 'Countdown to Release')}
                </div>
                <div
                  data-testid="macro-t5-countdown-timer"
                  className="text-lg sm:text-xl font-black font-mono tabular-nums tracking-tight text-[#151D2A] dark:text-[#F2F4F7]"
                >
                  {lockState.countdownHms}{' '}
                  <span className="text-[11px] font-normal text-[#697586] dark:text-[#929BA9]">
                    {tr('menuju rilis', 'to release')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Honest Live Calendar Error Banner if all multi-proxy & grounding routes fail (Zero-Mock Policy) */}
        {!isLiveCalendar && (
          <div
            data-testid="macro-live-calendar-error-banner"
            className="p-4 rounded-xl bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#20252D] border-l-4 border-l-[#1769E8] dark:border-l-[#3478DC] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-[#1769E8] dark:text-[#3478DC] shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="text-xs sm:text-sm font-bold text-[#151D2A] dark:text-[#F2F4F7]">
                  Koneksi Live Gagal — Tidak ada data palsu ditampilkan. Periksa internet lalu tekan Analisis Live ulang.
                </div>
                <p className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                  Gagal memuat kalender live — periksa koneksi atau coba refresh.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => runLiveAnalysis(true, snapshot, selectedEventId)}
              className="px-3.5 py-1.5 rounded-lg bg-[#1769E8] dark:bg-[#3478DC] text-white text-xs font-bold shrink-0 self-start sm:self-center cursor-pointer"
            >
              {tr('Analisis Live Ulang', 'Retry Live Analysis')}
            </button>
          </div>
        )}

        {/* Active Event Group Title + LIVE FEED VERIFIED Badge */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#1769E8] dark:text-[#3478DC]">
              {tr(' JADWAL RILIS YANG DIANALISIS', 'ANALYZED RELEASE GROUP')}
            </span>
            <h2 className="text-sm sm:text-base font-bold text-[#151D2A] dark:text-[#F2F4F7] mt-0.5">
              {activeClusterTitles}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isLiveCalendar ? (
              <span
                data-testid="macro-live-feed-verified-badge"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#1769E8] dark:bg-[#3478DC] text-white text-[10px] font-bold tracking-wider uppercase"
              >
                <CheckCircle2 className="w-3 h-3 shrink-0" />
                <span>LIVE FEED VERIFIED</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#20252D] text-[#697586] dark:text-[#929BA9] text-[10px] font-bold tracking-wider uppercase">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span>Koneksi Live Gagal — Tidak ada data palsu ditampilkan. Periksa internet lalu tekan Analisis Live ulang.</span>
              </span>
            )}
            {simultaneousCount > 1 && (
              <span className="px-2.5 py-1 rounded-lg bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#20252D] text-[11px] font-mono text-[#697586] dark:text-[#929BA9]">
                {simultaneousCount} {tr('Indikator Rilis Bersamaan', 'Simultaneous Indicators')}
              </span>
            )}
          </div>
        </div>

        {/* Middle Row: Large & Clear Pre-News Probabilities (BUY | SELL | MIXED / WHIPSAW) */}
        <div
          data-testid="macro-t5-probabilities-grid"
          className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono tabular-nums"
        >
          {/* BUY XAU/USD */}
          <div
            className={`rounded-xl p-4 border transition-colors ${
              activeMatrix.dominantBias === 'BUY'
                ? 'bg-[#EEF2F6] dark:bg-[#101726] border-[#1769E8] dark:border-[#3478DC]'
                : 'bg-[#F5F7FA] dark:bg-[#050607] border-[#DDE3EA] dark:border-[#1E232B]'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-sans font-bold text-[#697586] dark:text-[#929BA9]">
              <span>BUY XAU/USD</span>
              {activeMatrix.dominantBias === 'BUY' && (
                <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-[#1769E8] dark:bg-[#3478DC] text-white">
                  DOMINAN
                </span>
              )}
            </div>
            <div className="mt-1.5 text-2xl sm:text-3xl font-black text-[#1769E8] dark:text-[#3478DC]">
              {activeMatrix.buyProbability}%
            </div>
            <div className="mt-1 text-[11px] font-sans text-[#697586] dark:text-[#929BA9]">
              BUY XAU/USD ({activeMatrix.buyProbability}%)
            </div>
          </div>

          {/* SELL XAU/USD */}
          <div
            className={`rounded-xl p-4 border transition-colors ${
              activeMatrix.dominantBias === 'SELL'
                ? 'bg-[#EEF2F6] dark:bg-[#101726] border-[#1769E8] dark:border-[#3478DC]'
                : 'bg-[#F5F7FA] dark:bg-[#050607] border-[#DDE3EA] dark:border-[#1E232B]'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-sans font-bold text-[#697586] dark:text-[#929BA9]">
              <span>SELL XAU/USD</span>
              {activeMatrix.dominantBias === 'SELL' && (
                <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-[#1769E8] dark:bg-[#3478DC] text-white">
                  DOMINAN
                </span>
              )}
            </div>
            <div className="mt-1.5 text-2xl sm:text-3xl font-black text-[#151D2A] dark:text-[#F2F4F7]">
              {activeMatrix.sellProbability}%
            </div>
            <div className="mt-1 text-[11px] font-sans text-[#697586] dark:text-[#929BA9]">
              SELL XAU/USD ({activeMatrix.sellProbability}%)
            </div>
          </div>

          {/* MIXED / WHIPSAW */}
          <div
            className={`rounded-xl p-4 border transition-colors ${
              activeMatrix.dominantBias === 'MIXED'
                ? 'bg-[#EEF2F6] dark:bg-[#101726] border-[#1769E8] dark:border-[#3478DC]'
                : 'bg-[#F5F7FA] dark:bg-[#050607] border-[#DDE3EA] dark:border-[#1E232B]'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-sans font-bold text-[#697586] dark:text-[#929BA9]">
              <span>MIXED / WHIPSAW</span>
              {activeMatrix.dominantBias === 'MIXED' && (
                <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-[#1769E8] dark:bg-[#3478DC] text-white">
                  DOMINAN
                </span>
              )}
            </div>
            <div className="mt-1.5 text-2xl sm:text-3xl font-black text-[#151D2A] dark:text-[#F2F4F7]">
              {activeMatrix.mixedProbability}%
            </div>
            <div className="mt-1 text-[11px] font-sans text-[#697586] dark:text-[#929BA9]">
              MIXED / WHIPSAW ({activeMatrix.mixedProbability}%)
            </div>
          </div>
                </div>

        {/* Institutional Desk Thesis & Proportional 3 FOMC Pillars Mode */}
        {(activeMatrix.institutionalDeskThesisId || activeMatrix.institutionalDeskThesisEn) && (
          <div
            data-testid="institutional-desk-thesis"
            className="mt-3 rounded-xl bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#1E2328] p-4 space-y-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#1769E8] dark:text-[#3478DC]">
                {tr('Tesis Meja Institusi (Institutional Desk Thesis)', 'Institutional Desk Thesis')}
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-white dark:bg-[#0B0A0E] border border-[#DDE3EA] dark:border-[#20252D] text-[#697586] dark:text-[#929BA9]">
                {activeMatrix.evaluationMode === 'FOMC_MEETING'
                  ? tr('Mode: Rekap Penuh 3 Pilar FOMC', 'Mode: Full 3 FOMC Pillars Recap')
                  : tr('Mode: Fokus Pilar Spesifik (3 Pilar = Latar Belakang)', 'Mode: Specific Pillar Focus (3 Pillars = Background)')}
              </span>
            </div>
            <p className="text-xs sm:text-[13px] text-[#151D2A] dark:text-[#F2F4F7] leading-relaxed font-medium">
              {isEn
                ? (activeMatrix.institutionalDeskThesisEn || activeMatrix.institutionalDeskThesisId)
                : (activeMatrix.institutionalDeskThesisId || activeMatrix.institutionalDeskThesisEn)}
            </p>
          </div>
        )}

        {/* Bottom Row: Automatic Execution Tactic (2-Second Instant Read) */}
        <div
          data-testid="macro-t5-execution-tactic"
          className="p-4 rounded-xl bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#20252D] border-l-4 border-l-[#1769E8] dark:border-l-[#3478DC]"
        >
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#1769E8] dark:text-[#3478DC]">
              {tr('TAKTIK EKSEKUSI DETIK PERTAMA', 'FIRST-SECOND EXECUTION TACTIC')}
            </span>
            <span className="text-[10px] font-mono text-[#697586] dark:text-[#929BA9]">
              {isStrongOneWay ? '>= 60% CONVICTION' : 'WHIPSAW PROTECTION'}
            </span>
          </div>
          <p className="text-xs sm:text-sm font-bold text-[#151D2A] dark:text-[#F2F4F7] leading-relaxed">
            {isEn ? t5TacticEn : t5TacticId}
          </p>
        </div>
      </div>

      {/* 4. AUTO-SCAN RSS HEADLINE SENTIMENT (Deep Black Card with Left Core Blue Line) */}
      {topBreaking && (
        <div
          data-testid="macro-breaking-sentiment-card"
          className="rounded-2xl bg-white dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#20252D] p-5 shadow-xs"
        >
          <div className="border-l-2 border-[#1769E8] dark:border-[#3478DC] pl-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#1769E8] dark:text-[#3478DC]">
                  {tr('Auto-Scan RSS Headline & Pidato Fed', 'Auto-Scan RSS Headline & Fed Speech')}
                </span>

                <span
                  data-testid="breaking-impact-badge"
                  className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] text-[#697586] dark:text-[#929BA9]"
                >
                  {topBreaking.impact === 'HIGH' ? 'HIGH IMPACT' : 'LOW IMPACT'}
                </span>

                <span
                  data-testid="breaking-sentiment-badge"
                  className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] text-[#151D2A] dark:text-[#F2F4F7]"
                >
                  XAU/USD: {topBreaking.sentimentForGold}
                </span>
              </div>

              <span className="text-[11px] font-mono text-[#697586] dark:text-[#929BA9]">
                {topBreaking.source}
              </span>
            </div>

            <h2 className="text-sm sm:text-base font-bold text-[#151D2A] dark:text-[#F2F4F7] leading-snug">
              {topBreaking.title}
            </h2>

            <div className="p-3.5 rounded-xl bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#1E232B] text-xs text-[#4B5565] dark:text-[#D1D5DB] leading-relaxed">
              <strong className="text-[#151D2A] dark:text-[#F2F4F7] font-semibold mr-1.5">
                {tr('Evaluasi Makro:', 'Macro Evaluation:')}
              </strong>
              {isEn ? topBreaking.aiEvaluationEn : topBreaking.aiEvaluationId}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {topBreaking.matchedKeywords.map((kw) => (
                  <span
                    key={kw}
                    className="text-[10px] font-mono text-[#697586] dark:text-[#929BA9] bg-[#F5F7FA] dark:bg-[#101318] px-2 py-0.5 rounded border border border-[#DDE3EA] dark:border-[#20252D]"
                  >
                    #{kw}
                  </span>
                ))}
              </div>

              {snapshot.breakingNews.length > 1 && (
                <button
                  type="button"
                  onClick={() => setShowAllHeadlines((prev) => !prev)}
                  className="text-xs font-semibold text-[#1769E8] dark:text-[#3478DC] hover:text-[#1458C4] dark:hover:text-[#2860B2] inline-flex items-center gap-1 cursor-pointer"
                >
                  <span>
                    {showAllHeadlines
                      ? tr('Sembunyikan Headline Lain', 'Hide Other Headlines')
                      : tr(
                          `Lihat ${snapshot.breakingNews.length - 1} Headline RSS Lainnya`,
                          `View ${snapshot.breakingNews.length - 1} Other RSS Headlines`
                        )}
                  </span>
                  {showAllHeadlines ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
            </div>
          </div>

          {showAllHeadlines && snapshot.breakingNews.length > 1 && (
            <div className="mt-4 pt-4 border-t border-[#DDE3EA] dark:border-[#20252D] space-y-2.5">
              {snapshot.breakingNews.slice(1, 10).map((item) => (
                <div
                  key={item.id}
                  className="p-3.5 rounded-xl bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#1E232B] space-y-1.5"
                >
                  <div className="flex items-center justify-between text-[11px] text-[#697586] dark:text-[#929BA9]">
                    <span className="font-semibold text-[#151D2A] dark:text-[#F2F4F7]">{item.source}</span>
                    <span className="font-semibold text-[#1769E8] dark:text-[#3478DC]">
                      {item.sentimentForGold}
                    </span>
                  </div>
                  <p className="text-xs font-medium text-[#151D2A] dark:text-[#F2F4F7] leading-snug">{item.title}</p>
                  <p className="text-[11px] text-[#697586] dark:text-[#929BA9] leading-relaxed">
                    {isEn ? item.aiEvaluationEn : item.aiEvaluationId}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 5. INTERMARKET PULSE & CME FEDWATCH (FOMC TARGET) — Deep Black Card with Tabular Numbers */}
      <div
        data-testid="macro-intermarket-pulse-grid"
        className="rounded-2xl bg-white dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#20252D] p-5 shadow-xs space-y-4"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#1769E8] dark:text-[#3478DC]" />
            <h2 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F4F7]">
              {tr('Intermarket Pulse Real-Time', 'Real-Time Intermarket Pulse')}
            </h2>
          </div>
          <span className="text-[11px] text-[#697586] dark:text-[#929BA9]">
            {tr('Konfirmasi DXY, US02Y, US10Y, & USOIL', 'DXY, US02Y, US10Y, & USOIL Confirmation')}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
            {intermarketList.map((item) => {
            const isUp = item.direction === 'UP';
            const isDown = item.direction === 'DOWN';

            return (
              <div
                key={item.symbol}
                data-testid={`intermarket-card-${item.symbol}`}
                className="rounded-xl bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#1E232B] p-3.5 sm:p-4 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-1 text-[11px]">
                    <span className="font-semibold text-[#697586] dark:text-[#929BA9] uppercase tracking-wide truncate">
                      {item.symbol === 'USOIL'
                        ? 'US OIL (WTI)'
                        : item.symbol === 'US10Y'
                        ? 'US10Y YIELD'
                        : 'DXY'}
                    </span>
                    <span
                      className={`inline-flex items-center font-mono tabular-nums text-[11px] font-bold ${
                        isUp
                          ? 'text-[#1769E8] dark:text-[#3478DC]'
                          : isDown
                          ? 'text-[#151D2A] dark:text-[#F2F4F7]'
                          : 'text-[#697586] dark:text-[#929BA9]'
                      }`}
                    >
                      {isUp ? (
                        <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" />
                      ) : isDown ? (
                        <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />
                      ) : (
                        <Minus className="w-3.5 h-3.5 mr-0.5" />
                      )}
                      {item.changePercent > 0
                        ? `+${item.changePercent.toFixed(2)}%`
                        : `${item.changePercent.toFixed(2)}%`}
                    </span>
                  </div>

                  <div className="mt-2 text-lg sm:text-2xl font-black text-[#151D2A] dark:text-[#F2F4F7] font-mono tabular-nums tracking-tight">
                    {item.symbol === 'USOIL'
                      ? `$${item.price.toFixed(2)}`
                      : item.symbol === 'US10Y'
                      ? `${item.price.toFixed(2)}%`
                      : item.price.toFixed(2)}
                  </div>
                </div>

                <p className="mt-2.5 pt-2 border-t border-[#DDE3EA] dark:border-[#1E232B] text-[11px] text-[#697586] dark:text-[#929BA9] leading-snug line-clamp-2">
                  {isEn ? item.summaryEn : item.summaryId}
                </p>
              </div>
            );
          })}
        </div>

        {/* COMPACT CME FEDWATCH (FOMC TARGET) BLOCK — 3 Core TradeVault Colors (Black, White, Blue) */}
        <div
          data-testid="macro-cme-fedwatch-card"
          className="rounded-xl bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#1E232B] p-4 space-y-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] sm:text-xs font-black uppercase tracking-wider text-[#151D2A] dark:text-[#F2F4F7]">
                CME FEDWATCH (FOMC TARGET)
              </span>
              <span
                data-testid="macro-cme-fedwatch-meeting-date"
                className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-white dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#20252D] text-[#1769E8] dark:text-[#3478DC]"
              >
                {activeFedWatch.isAvailable
                  ? `Target Rapat: ${activeFedWatch.fomcMeetingDate || 'FOMC Desember 2026'}`
                  : 'Data FedWatch belum tersedia'}
              </span>
              {activeFedWatch.isAvailable && activeFedWatch.isPricedInSaturated && (
                <span
                  data-testid="macro-cme-fedwatch-saturation-badge"
                  className="px-2 py-0.5 rounded text-[9.5px] font-bold uppercase bg-[#1769E8] dark:bg-[#3478DC] text-white"
                >
                  PRICED-IN SATURATION (&gt;=80%)
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-[#697586] dark:text-[#929BA9]">
              <span
                data-testid="macro-cme-fedwatch-source"
                className="px-2.5 py-0.5 rounded bg-white dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#20252D] text-[#151D2A] dark:text-[#F2F4F7] font-semibold"
              >
                {activeFedWatch.sourceLabel ||
                  (activeFedWatch.isAvailable
                    ? 'Sumber: CME FedWatch Grounding (Des 2026)'
                    : 'Sumber: Menunggu Sinkronisasi Live')}
              </span>
              {activeFedWatch.isAvailable &&
                typeof activeFedWatch.impliedFedFundsRate === 'number' && (
                  <span className="px-2 py-0.5 rounded bg-white dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#20252D] text-[#1769E8] dark:text-[#3478DC] font-bold">
                    Implied Rate: {activeFedWatch.impliedFedFundsRate.toFixed(2)}%
                    {typeof activeFedWatch.zqFuturesPrice === 'number'
                      ? ` (ZQ=F ${activeFedWatch.zqFuturesPrice.toFixed(2)})`
                      : ''}
                  </span>
                )}
            </div>
          </div>

          {activeFedWatch.isAvailable &&
          activeFedWatch.cutProbability !== null &&
          activeFedWatch.holdProbability !== null ? (
            <>
              <div
                data-testid="macro-cme-fedwatch-probabilities-grid"
                className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 font-mono tabular-nums"
              >
                {/* Rate Hike (+25 bps / lebih) */}
                <div
                  data-testid="macro-cme-fedwatch-hike-box"
                  className={`rounded-lg p-3 border text-center ${
                    activeFedWatch.dominantOutcome === 'HIKE'
                      ? 'bg-[#EEF2F6] dark:bg-[#101726] border-[#1769E8] dark:border-[#3478DC]'
                      : 'bg-white dark:bg-[#080A0E] border-[#DDE3EA] dark:border-[#20252D]'
                  }`}
                >
                  <div className="text-[10px] font-sans font-bold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F4F7]">
                    Rate Hike (+25 bps / lebih)
                  </div>
                  <div className="mt-1 text-base sm:text-xl font-black text-[#151D2A] dark:text-[#F2F4F7]">
                    {Number(activeFedWatch.hikeProbability ?? 0).toFixed(1)}%
                  </div>
                  <div className="mt-0.5 text-[10px] font-sans text-[#697586] dark:text-[#929BA9]">
                    {activeFedWatch.dominantOutcome === 'HIKE' && activeFedWatch.isPricedInSaturated
                      ? tr('Hawkish Priced-In (>=80%)', 'Hawkish Priced-In (>=80%)')
                      : tr('Hawkish USD / Pro-SELL Gold', 'Hawkish USD / Pro-SELL Gold')}
                  </div>
                </div>

                {/* Hold (Unchanged) */}
                <div
                  data-testid="macro-cme-fedwatch-hold-box"
                  className={`rounded-lg p-3 border text-center ${
                    activeFedWatch.dominantOutcome === 'HOLD'
                      ? 'bg-[#EEF2F6] dark:bg-[#101726] border-[#1769E8] dark:border-[#3478DC]'
                      : 'bg-white dark:bg-[#080A0E] border-[#DDE3EA] dark:border-[#20252D]'
                  }`}
                >
                  <div className="text-[10px] font-sans font-bold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F4F7]">
                    Hold (Unchanged)
                  </div>
                  <div className="mt-1 text-base sm:text-xl font-black text-[#151D2A] dark:text-[#F2F4F7]">
                    {Number(activeFedWatch.holdProbability).toFixed(1)}%
                  </div>
                  <div className="mt-0.5 text-[10px] font-sans text-[#697586] dark:text-[#929BA9]">
                    {tr('Suku Bunga Tetap (Pro-SELL Gold)', 'Rates Unchanged (Pro-SELL Gold)')}
                  </div>
                </div>

                {/* Rate Cut (-25 bps / lebih) */}
                <div
                  data-testid="macro-cme-fedwatch-cut-box"
                  className={`rounded-lg p-3 border text-center ${
                    activeFedWatch.dominantOutcome === 'CUT'
                      ? 'bg-[#EEF2F6] dark:bg-[#101726] border-[#1769E8] dark:border-[#3478DC]'
                      : 'bg-white dark:bg-[#080A0E] border-[#DDE3EA] dark:border-[#20252D]'
                  }`}
                >
                  <div className="text-[10px] font-sans font-bold uppercase tracking-wider text-[#1769E8] dark:text-[#3478DC]">
                    Rate Cut (-25 bps / lebih)
                  </div>
                  <div className="mt-1 text-base sm:text-xl font-black text-[#1769E8] dark:text-[#3478DC]">
                    {Number(activeFedWatch.cutProbability).toFixed(1)}%
                  </div>
                  <div className="mt-0.5 text-[10px] font-sans text-[#697586] dark:text-[#929BA9]">
                    {activeFedWatch.dominantOutcome === 'CUT' && activeFedWatch.isPricedInSaturated
                      ? tr('Dovish Priced-In (>=80%)', 'Dovish Priced-In (>=80%)')
                      : tr('Dovish USD / Pro-BUY Gold', 'Dovish USD / Pro-BUY Gold')}
                  </div>
                </div>
              </div>

              <div
                data-testid="macro-cme-fedwatch-summary-note"
                className="p-3 rounded-lg bg-white dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#20252D] border-l-4 border-l-[#1769E8] dark:border-l-[#3478DC] text-[11px] sm:text-xs font-medium text-[#151D2A] dark:text-[#F2F4F7] leading-relaxed"
              >
                {isEn ? activeFedWatch.summaryNoteEn : activeFedWatch.summaryNoteId}
              </div>
            </>
          ) : (
            <div
              data-testid="macro-cme-fedwatch-unavailable"
              className="p-3 rounded-lg bg-white dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#20252D] flex items-center justify-between gap-2 text-xs text-[#697586] dark:text-[#929BA9]"
            >
              <span className="font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                Data FedWatch belum tersedia
              </span>
              <span className="text-[11px]">
                {tr(
                  'Tekan Analisis Live untuk menarik probabilitas CME FedWatch Desember 2026 atau Implied Fed Funds Futures (ZQ=F).',
                  'Press Live Analysis to pull December 2026 CME FedWatch probabilities or Implied Fed Funds Futures (ZQ=F).'
                )}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 6. PRE-NEWS SCENARIO MATRIX (Deep Black Card with Dashboard Deep Blue Accents) */}
      <div
        data-testid="macro-scenario-matrix-card"
        className="rounded-2xl bg-white dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#20252D] p-5 sm:p-6 shadow-xs space-y-5"
      >
        {/* Matrix Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#DDE3EA] dark:border-[#20252D] pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#1769E8] dark:text-[#3478DC]" />
              <h2 className="text-sm sm:text-base font-bold text-[#151D2A] dark:text-[#F2F4F7] uppercase tracking-wide">
                {tr('Pre-News Scenario Matrix (XAU/USD)', 'Pre-News Scenario Matrix (XAU/USD)')}
              </h2>
            </div>
            <p className="text-xs text-[#697586] dark:text-[#929BA9] mt-0.5">
              {tr(
                'Kalkulasi otomatis Forecast vs Previous, deteksi konflik rilis bersamaan, & konfirmasi Intermarket',
                'Automatic Forecast vs Previous calculation, simultaneous conflict detection, & Intermarket confirmation'
              )}
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span className="px-3 py-1 rounded-full bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] text-[11px] font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
              {pillarBadgeLabel(primaryEv.pillar)}
            </span>
          </div>
        </div>

        {/* Dynamic Alerts: Aturan Pindah Haluan, Fed Speech Caution, or Simultaneous Release Conflict */}
        {(activeMatrix.dynamicPivotTriggered ||
          activeMatrix.fedSpeechAlertNoteId ||
          activeMatrix.isSimultaneousRelease) && (
          <div className="space-y-3">
            {activeMatrix.dynamicPivotTriggered && (
              <div
                data-testid="macro-dynamic-pivot-banner"
                className="p-4 rounded-xl bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#20252D] border-l-4 border-l-[#1769E8] dark:border-l-[#3478DC] text-xs leading-relaxed space-y-1.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-[#1769E8] dark:bg-[#3478DC] text-white">
                    {activeMatrix.dynamicPivotType === 'DOVISH_OVERRIDE'
                      ? 'PINDAH HALUAN: DOVISH OVERRIDE'
                      : 'PINDAH HALUAN: HAWKISH OVERRIDE'}
                  </span>
                  <span className="text-[10px] font-semibold text-[#697586] dark:text-[#929BA9]">
                    {tr('Deteksi Otomatis RSS & Kalender', 'Automatic RSS & Calendar Detection')}
                  </span>
                </div>
                <p className="text-xs text-[#151D2A] dark:text-[#F2F4F7] font-medium leading-relaxed">
                  {isEn ? activeMatrix.dynamicPivotReasonEn : activeMatrix.dynamicPivotReasonId}
                </p>
              </div>
            )}

            {activeMatrix.fedSpeechAlertNoteId && !activeMatrix.dynamicPivotTriggered && (
              <div
                data-testid="macro-fed-speech-alert-note"
                className="p-3.5 rounded-xl bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#20252D] border-l-4 border-l-[#1769E8] dark:border-l-[#3478DC] text-xs text-[#151D2A] dark:text-[#F2F4F7] leading-relaxed flex items-center gap-2.5"
              >
                <Info className="w-4 h-4 text-[#1769E8] dark:text-[#3478DC] shrink-0" />
                <span className="font-medium">
                  {isEn
                    ? activeMatrix.fedSpeechAlertNoteEn
                    : activeMatrix.fedSpeechAlertNoteId}
                </span>
              </div>
            )}

            {activeMatrix.isSimultaneousRelease && (
              <div
                data-testid="macro-simultaneous-release-banner"
                className="p-3.5 rounded-xl bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#20252D] text-xs leading-relaxed border-l-4 border-l-[#1769E8] dark:border-l-[#3478DC] text-[#151D2A] dark:text-[#F2F4F7]"
              >
                <div className="font-bold mb-0.5 flex items-center gap-2">
                  <span>
                    {activeMatrix.simultaneousAlignment === 'CONFLICTING_WHIPSAW'
                      ? tr(
                          `RISIKO WHIPSAW SAAT RILIS — Simultaneous Release (${simultaneousCount} Data Konflik)`,
                          `RISIKO WHIPSAW SAAT RILIS — Simultaneous Release (${simultaneousCount} Conflicting Indicators)`
                        )
                      : tr(
                          `Simultaneous Release (${simultaneousCount} Data Searah -> Konfirmasi Kuat)`,
                          `Simultaneous Release (${simultaneousCount} Aligned Indicators -> High Conviction)`
                        )}
                  </span>
                </div>
                <p className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                  {tr(
                    'Seluruh indikator USD pada jam rilis yang sama dikelompokkan secara otomatis di bawah ini untuk membandingkan konsensus Forecast vs Previous.',
                    'All USD indicators releasing at the exact same hour are automatically grouped below to compare Forecast vs Previous consensus.'
                  )}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Simultaneous Release Group Card (100% Automatic Zero Manual Input) */}
        <div className="rounded-xl bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#1E232B] p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#DDE3EA] dark:border-[#1E232B] pb-3.5">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-[#151D2A] dark:text-[#F2F4F7] uppercase tracking-wide">
                  {simultaneousCount > 1
                    ? tr(
                        `Rilis Bersamaan (${simultaneousCount} Indikator USD)`,
                        `Simultaneous Release (${simultaneousCount} USD Indicators)`
                      )
                    : primaryEv.title}
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] text-[#697586] dark:text-[#929BA9]">
                  {formatTimestampWib(primaryEv.date, language)}
                </span>
              </div>
              <div className="text-xs text-[#697586] dark:text-[#929BA9] mt-0.5">
                {tr(
                  'Perbandingan vertikal Previous | Forecast | Actual langsung dari feed ForexFactory (Zero Manual Input)',
                  'Vertical Previous | Forecast | Actual comparison directly from ForexFactory feed (Zero Manual Input)'
                )}
              </div>
            </div>

            {/* Corner verification badge on group card header */}
            <div className="self-start sm:self-center shrink-0">
              {isLiveCalendar ? (
                <span
                  data-testid="macro-group-card-live-verified-badge"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#1769E8] dark:bg-[#3478DC] text-white text-[10px] font-bold tracking-wider uppercase"
                >
                  <CheckCircle2 className="w-3 h-3 shrink-0" />
                  <span>LIVE FEED VERIFIED</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#20252D] text-[#697586] dark:text-[#929BA9] text-[10px] font-bold tracking-wider">
                  <span>Gagal memuat kalender live — periksa koneksi atau coba refresh</span>
                </span>
              )}
            </div>
          </div>

          {/* Vertical Cluster Comparison of All Indicators in this Release Slot */}
          <div className="space-y-3.5">
            {[primaryEv, ...(activeMatrix.simultaneousEvents || [])].map((ev, idx) => (
              <div
                key={ev.id}
                className="p-4 rounded-xl bg-white dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#20252D] space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        ev.impact === 'High'
                          ? 'bg-[#1769E8] dark:bg-[#3478DC]'
                          : 'bg-[#697586]'
                      }`}
                    />
                    <span className="text-xs sm:text-sm font-bold text-[#151D2A] dark:text-[#F2F4F7]">
                      {ev.title}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] text-[#697586] dark:text-[#929BA9]">
                      {ev.pillar}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {ev.isInverseIndicator && (
                      <span className="text-[10px] font-semibold text-[#697586] dark:text-[#929BA9]">
                        {tr('Aturan Terbalik', 'Inverse Rule')}
                      </span>
                    )}
                    <span
                      className={`text-[10px] font-bold font-mono px-2.5 py-0.5 rounded border ${
                        ev.eventBiasForGold === 'BUY'
                          ? 'text-[#1769E8] dark:text-[#3478DC] bg-[#1769E8]/10 dark:bg-[#3478DC]/15 border-[#1769E8]/30 dark:border-[#3478DC]/30'
                          : ev.eventBiasForGold === 'SELL'
                          ? 'text-[#151D2A] dark:text-[#F2F4F7] bg-[#F5F7FA] dark:bg-[#101318] border-[#DDE3EA] dark:border-[#20252D]'
                          : 'text-[#697586] dark:text-[#929BA9] bg-neutral-500/10 border-transparent'
                      }`}
                    >
                      {ev.eventBiasForGold}
                    </span>
                  </div>
                </div>

                {/* 3-Column Numbers Grid (Previous | Forecast | Actual) */}
                <div
                  {...(idx === 0 ? { 'data-testid': 'macro-event-numbers-grid' } : {})}
                  className="grid grid-cols-3 gap-3"
                >
                  <div className="rounded-lg bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#1E232B] p-3 text-center">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#929BA9]">
                      Previous
                    </div>
                    <div className="mt-1 text-base sm:text-lg font-black text-[#4B5565] dark:text-[#D1D5DB] font-mono tabular-nums">
                      {ev.previous || '—'}
                    </div>
                  </div>

                  {/* Forecast Highlight with Deep Dashboard Blue */}
                  <div className="rounded-lg bg-[#EEF2F6] dark:bg-[#1C2330] border border-[#3478DC]/30 p-3 text-center">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#1769E8] dark:text-[#3478DC]">
                      Forecast
                    </div>
                    <div className="mt-1 text-base sm:text-lg font-black text-[#1769E8] dark:text-[#3478DC] font-mono tabular-nums">
                      {ev.forecast || '—'}
                    </div>
                  </div>

                  <div className="rounded-lg bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#1E232B] p-3 text-center">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#929BA9]">
                      Actual
                    </div>
                    <div className="mt-1 text-base sm:text-lg font-black text-[#151D2A] dark:text-[#F2F4F7] font-mono tabular-nums">
                      {ev.actual || (
                        <span className="text-xs text-[#697586] dark:text-[#929BA9] font-normal">
                          {tr('Menunggu Rilis', 'Pending')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Event Bias Evaluation Reason */}
                {ev.biasReasonId && (
                  <p className="text-[11px] text-[#697586] dark:text-[#929BA9] leading-relaxed pt-1 border-t border-[#DDE3EA] dark:border-[#1E232B]">
                    {isEn ? ev.biasReasonEn : ev.biasReasonId}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Minimalist Probability Bar */}
        <div
          data-testid="macro-probability-bar"
          className="rounded-xl bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#1E232B] p-4 sm:p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#697586] dark:text-[#929BA9]">
              {tr('Distribusi Probabilitas Skenario Pre-News', 'Pre-News Scenario Probability Distribution')}
            </span>
            <span
              data-testid="macro-dominant-bias-badge"
              className="px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-[#151D2A] text-white dark:bg-white dark:text-[#080A0E] shadow-xs"
            >
              {tr('Bias Utama:', 'Dominant Bias:')} {activeMatrix.dominantBias}
            </span>
          </div>

          {/* Clean Thin Single Bar */}
          <div className="w-full h-2 rounded-full bg-[#E2E8F0] dark:bg-[#101318] border border-[#CBD5E1] dark:border-[#20252D] overflow-hidden flex">
            <div
              style={{ width: `${activeMatrix.buyProbability}%` }}
              className="bg-[#1769E8] dark:bg-[#3478DC] h-full"
              title={`BUY XAU/USD: ${activeMatrix.buyProbability}%`}
            />
            <div
              style={{ width: `${activeMatrix.sellProbability}%` }}
              className="bg-neutral-800 dark:bg-white h-full"
              title={`SELL XAU/USD: ${activeMatrix.sellProbability}%`}
            />
            <div
              style={{ width: `${activeMatrix.mixedProbability}%` }}
              className="bg-neutral-400 dark:bg-neutral-600 h-full"
              title={`MIXED / WHIPSAW: ${activeMatrix.mixedProbability}%`}
            />
          </div>

          {/* Clean Numerical Stats Row */}
          <div className="grid grid-cols-3 gap-3 text-center font-mono tabular-nums">
            <div className="p-3 rounded-xl bg-white dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#20252D]">
              <div className="text-[10px] font-semibold text-[#697586] dark:text-[#929BA9] uppercase">
                BUY XAU/USD
              </div>
              <div className="text-base sm:text-lg font-black text-[#1769E8] dark:text-[#3478DC] mt-0.5">
                {activeMatrix.buyProbability}%
              </div>
            </div>

            <div className="p-3 rounded-xl bg-white dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#20252D]">
              <div className="text-[10px] font-semibold text-[#697586] dark:text-[#929BA9] uppercase">
                SELL XAU/USD
              </div>
              <div className="text-base sm:text-lg font-black text-[#151D2A] dark:text-[#F2F4F7] mt-0.5">
                {activeMatrix.sellProbability}%
              </div>
            </div>

            <div className="p-3 rounded-xl bg-white dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#20252D]">
              <div className="text-[10px] font-semibold text-[#697586] dark:text-[#929BA9] uppercase">
                MIXED / WHIPSAW
              </div>
              <div className="text-base sm:text-lg font-black text-[#697586] dark:text-[#929BA9] mt-0.5">
                {activeMatrix.mixedProbability}%
              </div>
            </div>
          </div>
        </div>

        {/* Adu Argumen Fundamental (Clean Segmented Tabs) */}
        <div
          data-testid="macro-arguments-section"
          className="rounded-xl bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#1E232B] p-4 sm:p-5 space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span className="text-xs font-bold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F4F7]">
              {tr(
                'Adu Argumen Fundamental (3 Pilar FOMC)',
                'Fundamental Arguments (3 FOMC Pillars)'
              )}
            </span>

            {/* Segmented Controls */}
            <div className="inline-flex rounded-xl bg-white dark:bg-[#080A0E] p-1 border border-[#DDE3EA] dark:border-[#20252D] self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setArgumentTab('BOTH')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  argumentTab === 'BOTH'
                    ? 'bg-[#151D2A] text-white dark:bg-white dark:text-[#080A0E] shadow-xs'
                    : 'text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-white'
                }`}
              >
                {tr('Semua', 'Both')}
              </button>
              <button
                type="button"
                onClick={() => setArgumentTab('BUY')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  argumentTab === 'BUY'
                    ? 'bg-[#1769E8] dark:bg-[#3478DC] text-white shadow-xs'
                    : 'text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-white'
                }`}
              >
                BUY ({activeMatrix.buyArguments.length})
              </button>
              <button
                type="button"
                onClick={() => setArgumentTab('SELL')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  argumentTab === 'SELL'
                    ? 'bg-[#151D2A] text-white dark:bg-white dark:text-[#080A0E] shadow-xs'
                    : 'text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-white'
                }`}
              >
                SELL ({activeMatrix.sellArguments.length})
              </button>
            </div>
          </div>

          <div
            className={`grid gap-3 ${
              argumentTab === 'BOTH' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'
            }`}
          >
            {(argumentTab === 'BOTH' || argumentTab === 'BUY') && (
              <div className="rounded-xl bg-white dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#20252D] p-4 space-y-3">
                <div className="flex items-center gap-2 text-[#1769E8] dark:text-[#3478DC] font-bold text-xs uppercase tracking-wider">
                  <TrendingUp className="w-4 h-4" />
                  <span>{tr('Argumen Pendukung BUY', 'Arguments Supporting BUY')}</span>
                </div>
                <div className="space-y-2.5">
                  {activeMatrix.buyArguments.map((arg, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#1E232B] space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-[#151D2A] dark:text-[#F2F4F7]">{arg.tag}</span>
                        <span className="text-[10px] text-[#697586] dark:text-[#929BA9] uppercase font-mono">
                          {arg.pillar}
                        </span>
                      </div>
                      <p className="text-xs text-[#4B5565] dark:text-[#D1D5DB] leading-relaxed">
                        {isEn ? arg.textEn : arg.textId}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(argumentTab === 'BOTH' || argumentTab === 'SELL') && (
              <div className="rounded-xl bg-white dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#20252D] p-4 space-y-3">
                <div className="flex items-center gap-2 text-[#151D2A] dark:text-[#F2F4F7] font-bold text-xs uppercase tracking-wider">
                  <TrendingDown className="w-4 h-4 text-[#697586] dark:text-[#929BA9]" />
                  <span>{tr('Argumen Pendukung SELL', 'Arguments Supporting SELL')}</span>
                </div>
                <div className="space-y-2.5">
                  {activeMatrix.sellArguments.map((arg, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#1E232B] space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-[#151D2A] dark:text-[#F2F4F7]">{arg.tag}</span>
                        <span className="text-[10px] text-[#697586] dark:text-[#929BA9] uppercase font-mono">
                          {arg.pillar}
                        </span>
                      </div>
                      <p className="text-xs text-[#4B5565] dark:text-[#D1D5DB] leading-relaxed">
                        {isEn ? arg.textEn : arg.textId}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Action Plan & Final Take (Executive Block with Left Deep Blue Accent) */}
        <div
          data-testid="macro-final-take-box"
          className="rounded-xl bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#20252D] p-5 space-y-3.5"
        >
          <div className="border-l-2 border-[#1769E8] dark:border-[#3478DC] pl-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#1769E8] dark:text-[#3478DC]">
                {tr('Kesimpulan & Rencana Aksi', 'Final Take & Action Plan')}
              </h3>
              <span className="text-[11px] font-mono text-[#697586] dark:text-[#929BA9]">
                XAU/USD • {activeMatrix.dominantBias}
              </span>
            </div>

            <p className="text-sm font-bold text-[#151D2A] dark:text-[#F2F4F7] leading-relaxed">
              {isEn ? activeMatrix.finalTakeEn : activeMatrix.finalTakeId}
            </p>
          </div>

          {/* Action Plan Details */}
          <div className="p-4 rounded-xl bg-white dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#20252D] text-xs text-[#4B5565] dark:text-[#D1D5DB] leading-relaxed whitespace-pre-line">
            <strong className="text-[#151D2A] dark:text-[#F2F4F7] block mb-1.5 uppercase text-[10px] tracking-wider">
              {tr('Taktik Eksekusi:', 'Execution Tactics:')}
            </strong>
            {isEn ? activeMatrix.actionPlanEn : activeMatrix.actionPlanId}
          </div>

          {/* Whipsaw Warning (3 Core Colors: Black Surface, White Text, Blue Accent) */}
          <div className="p-3.5 rounded-xl bg-white dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#20252D] flex items-start gap-3 text-xs">
            <ShieldAlert className="w-4 h-4 text-[#1769E8] dark:text-[#3478DC] shrink-0 mt-0.5" />
            <div className="text-[#4B5565] dark:text-[#D1D5DB] leading-relaxed">
              <strong className="text-[#151D2A] dark:text-[#F2F4F7] font-semibold uppercase text-[10px] tracking-wider mr-1.5">
                {tr('Peringatan Whipsaw:', 'Whipsaw Warning:')}
              </strong>
              {isEn ? activeMatrix.whipsawWarningEn : activeMatrix.whipsawWarningId}
            </div>
          </div>
        </div>
      </div>

      {/* 7. USD ECONOMIC CALENDAR TABLE (Deep Black Table matching Trade Table) */}
      <div className="rounded-2xl bg-white dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#20252D] p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F4F7]">
              {tr(
                'Jadwal Kalender Ekonomi USD Minggu Ini',
                'This Week USD Economic Calendar'
              )}
            </h3>
            {/* Small corner status badge: LIVE FEED VERIFIED vs Honest Live Calendar Warning */}
            {isLiveCalendar ? (
              <span className="px-2.5 py-0.5 rounded text-[10px] font-bold tracking-wider bg-[#1769E8] dark:bg-[#3478DC] text-white">
                LIVE FEED VERIFIED
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded text-[10px] font-bold tracking-wider bg-[#F5F7FA] dark:bg-[#050607] border border-[#DDE3EA] dark:border-[#20252D] text-[#151D2A] dark:text-[#F2F4F7]">
                Gagal memuat kalender live — periksa koneksi atau coba refresh
              </span>
            )}
          </div>
          <span className="text-[11px] text-[#697586] dark:text-[#929BA9] whitespace-nowrap">
            ForexFactory Live Feed
          </span>
        </div>

        {/* Mobile View: 2-3 Row Structured Cards (No text clipping on mobile screens) */}
        <div className="block sm:hidden divide-y divide-[#DDE3EA] dark:divide-[#20252D]">
          {snapshot.calendarEvents.map((ev: MacroCalendarEvent) => {
            const evTime = new Date(ev.date).getTime();
            const isPassedOver2Hours = !isNaN(evTime) && evTime < nowMs - TWO_HOURS_MS;
            const isNextUpcoming = ev.id === nextUpcomingEvent?.id;
            const isJustReleased = !isNaN(evTime) && evTime >= nowMs - TWO_HOURS_MS && evTime <= nowMs;

            return (
              <div
                key={ev.id}
                onClick={() => handleSelectEventGroup(ev.id)}
                className={`py-3.5 px-2.5 rounded-xl transition-all cursor-pointer ${
                  isNextUpcoming
                    ? 'bg-[#1769E8]/5 dark:bg-[#3478DC]/10 border-l-2 border-l-[#1769E8] dark:border-l-[#3478DC]'
                    : isPassedOver2Hours
                    ? 'opacity-50 hover:opacity-100'
                    : 'hover:bg-[#F5F7FA] dark:hover:bg-[#101318]'
                }`}
              >
                {/* Row 1: Status Pill + Time WIB + Bias */}
                <div className="flex items-center justify-between text-[11px] gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {isNextUpcoming ? (
                      <span className="px-2 py-0.5 rounded text-[9.5px] font-bold bg-[#1769E8] dark:bg-[#3478DC] text-white shrink-0">
                        {tr('BERIKUTNYA', 'NEXT')}
                      </span>
                    ) : isPassedOver2Hours ? (
                      <span className="px-2 py-0.5 rounded text-[9.5px] font-semibold bg-[#E2E8F0] dark:bg-[#1C2330] text-[#697586] dark:text-[#929BA9] shrink-0">
                        {tr('SELESAI', 'COMPLETED')}
                      </span>
                    ) : isJustReleased ? (
                      <span className="px-2 py-0.5 rounded text-[9.5px] font-bold bg-[#1769E8]/15 dark:bg-[#3478DC]/20 border border-[#1769E8]/30 text-[#1769E8] dark:text-[#3478DC] shrink-0">
                        {tr('RILIS', 'RELEASED')}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[9.5px] font-medium bg-[#F5F7FA] dark:bg-[#101318] text-[#697586] dark:text-[#929BA9] border border-[#DDE3EA] dark:border-[#20252D] shrink-0">
                        {tr('MENUNGGU', 'PENDING')}
                      </span>
                    )}

                    <span className="font-mono text-[#697586] dark:text-[#929BA9] text-[10.5px] truncate">
                      {formatTimestampWib(ev.date, language)}
                    </span>
                  </div>

                  <span
                    className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded shrink-0 ${
                      ev.eventBiasForGold === 'BUY'
                        ? 'text-[#1769E8] dark:text-[#3478DC] bg-[#1769E8]/10'
                        : ev.eventBiasForGold === 'SELL'
                        ? 'text-[#151D2A] dark:text-[#F2F4F7] bg-[#F5F7FA] dark:bg-[#101318]'
                        : 'text-[#697586] dark:text-[#929BA9] bg-neutral-500/10'
                    }`}
                  >
                    {ev.eventBiasForGold}
                  </span>
                </div>

                {/* Row 2: Impact Dot + Title + FOMC Pillar */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        ev.impact === 'High'
                          ? 'bg-[#1769E8] dark:bg-[#3478DC]'
                          : 'bg-[#697586]'
                      }`}
                    />
                    <span className="font-bold text-xs text-[#151D2A] dark:text-[#F2F4F7] truncate">
                      {ev.title}
                    </span>
                  </div>
                  <span className="text-[9.5px] font-mono text-[#697586] dark:text-[#929BA9] bg-[#F5F7FA] dark:bg-[#101318] px-1.5 py-0.5 rounded border border-[#DDE3EA] dark:border-[#20252D] shrink-0">
                    {ev.pillar}
                  </span>
                </div>

                {/* Row 3: Compact 3-Column Metrics (Prev | Forecast | Actual) with zero clipping */}
                <div className="grid grid-cols-3 gap-2 bg-[#F5F7FA] dark:bg-[#050607] p-2 rounded-lg text-center font-mono text-xs border border-[#DDE3EA] dark:border-[#1E232B]">
                  <div>
                    <div className="text-[9px] uppercase tracking-wider text-[#697586] dark:text-[#929BA9]">
                      Prev
                    </div>
                    <div className="font-semibold text-[#697586] dark:text-[#929BA9] mt-0.5 tabular-nums">
                      {ev.previous || '—'}
                    </div>
                  </div>
                  <div className="border-x border-[#DDE3EA] dark:border-[#1E232B]">
                    <div className="text-[9px] uppercase tracking-wider text-[#1769E8] dark:text-[#3478DC] font-bold">
                      Fcst
                    </div>
                    <div className="font-black text-[#1769E8] dark:text-[#3478DC] mt-0.5 tabular-nums">
                      {ev.forecast || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-wider text-[#151D2A] dark:text-[#F2F4F7] font-semibold">
                      Act
                    </div>
                    <div className="font-black text-[#151D2A] dark:text-[#F2F4F7] mt-0.5 tabular-nums">
                      {ev.actual || '—'}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Desktop View: Full Responsive Financial Table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="min-w-[700px] w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#DDE3EA] dark:border-[#20252D] text-[10px] uppercase tracking-wider text-[#697586] dark:text-[#929BA9]">
                <th className="py-3 pr-3 font-semibold w-24">Status</th>
                <th className="py-3 pr-3 font-semibold">{tr('Waktu (WIB)', 'Time (WIB)')}</th>
                <th className="py-3 pr-3 font-semibold">{tr('Event USD', 'USD Event')}</th>
                <th className="py-3 pr-3 font-semibold">{tr('Pilar FOMC', 'FOMC Pillar')}</th>
                <th className="py-3 pr-3 text-right font-semibold">Prev</th>
                <th className="py-3 pr-3 text-right font-semibold text-[#1769E8] dark:text-[#3478DC]">
                  Forecast
                </th>
                <th className="py-3 pr-3 text-right font-semibold">Actual</th>
                <th className="py-3 text-right font-semibold">{tr('Bias XAU/USD', 'XAU/USD Bias')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DDE3EA] dark:divide-[#20252D]">
              {snapshot.calendarEvents.map((ev: MacroCalendarEvent) => {
                const evTime = new Date(ev.date).getTime();
                const isPassedOver2Hours = !isNaN(evTime) && evTime < nowMs - TWO_HOURS_MS;
                const isNextUpcoming = ev.id === nextUpcomingEvent?.id;
                const isJustReleased =
                  !isNaN(evTime) && evTime >= nowMs - TWO_HOURS_MS && evTime <= nowMs;

                return (
                  <tr
                    key={ev.id}
                    onClick={() => handleSelectEventGroup(ev.id)}
                    className={`cursor-pointer transition-colors ${
                      isNextUpcoming
                        ? 'bg-[#1769E8]/5 dark:bg-[#3478DC]/10 border-l-2 border-l-[#1769E8] dark:border-l-[#3478DC]'
                        : isPassedOver2Hours
                        ? 'opacity-50 hover:opacity-100 hover:bg-[#F5F7FA] dark:hover:bg-[#101318]'
                        : 'hover:bg-[#F5F7FA] dark:hover:bg-[#101318]'
                    }`}
                  >
                    <td className="py-3.5 pr-3 whitespace-nowrap">
                      {isNextUpcoming ? (
                        <span className="px-2 py-0.5 rounded text-[9.5px] font-bold bg-[#1769E8] dark:bg-[#3478DC] text-white">
                          {tr('BERIKUTNYA', 'NEXT')}
                        </span>
                      ) : isPassedOver2Hours ? (
                        <span className="px-2 py-0.5 rounded text-[9.5px] font-semibold bg-[#E2E8F0] dark:bg-[#1C2330] text-[#697586] dark:text-[#929BA9]">
                          {tr('SELESAI', 'COMPLETED')}
                        </span>
                      ) : isJustReleased ? (
                        <span className="px-2 py-0.5 rounded text-[9.5px] font-bold bg-[#1769E8]/15 dark:bg-[#3478DC]/20 border border-[#1769E8]/30 text-[#1769E8] dark:text-[#3478DC]">
                          {tr('RILIS', 'RELEASED')}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[9.5px] font-medium bg-[#F5F7FA] dark:bg-[#101318] text-[#697586] dark:text-[#929BA9] border border-[#DDE3EA] dark:border-[#20252D]">
                          {tr('MENUNGGU', 'PENDING')}
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 pr-3 font-mono text-[11px] text-[#697586] dark:text-[#929BA9] whitespace-nowrap">
                      {formatTimestampWib(ev.date, language)}
                    </td>
                    <td className="py-3.5 pr-3 font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            ev.impact === 'High'
                              ? 'bg-[#1769E8] dark:bg-[#3478DC]'
                              : 'bg-[#697586]'
                          }`}
                        />
                        <span>{ev.title}</span>
                      </div>
                    </td>
                    <td className="py-3.5 pr-3">
                      <span className="text-[10px] font-mono text-[#697586] dark:text-[#929BA9] bg-[#F5F7FA] dark:bg-[#101318] px-2 py-0.5 rounded border border-[#DDE3EA] dark:border-[#20252D]">
                        {ev.pillar}
                      </span>
                    </td>
                    <td className="py-3.5 pr-3 text-right font-mono tabular-nums text-[#697586] dark:text-[#929BA9]">
                      {ev.previous || '—'}
                    </td>
                    <td className="py-3.5 pr-3 text-right font-mono tabular-nums font-bold text-[#1769E8] dark:text-[#3478DC]">
                      {ev.forecast || '—'}
                    </td>
                    <td className="py-3.5 pr-3 text-right font-mono tabular-nums font-bold text-[#151D2A] dark:text-[#F2F4F7]">
                      {ev.actual || '—'}
                    </td>
                    <td className="py-3.5 text-right font-mono">
                      <span
                        className={`text-[11px] font-bold ${
                          ev.eventBiasForGold === 'BUY'
                            ? 'text-[#1769E8] dark:text-[#3478DC]'
                            : ev.eventBiasForGold === 'SELL'
                            ? 'text-[#151D2A] dark:text-[#F2F4F7]'
                            : 'text-[#697586] dark:text-[#929BA9]'
                        }`}
                      >
                        {ev.eventBiasForGold}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
