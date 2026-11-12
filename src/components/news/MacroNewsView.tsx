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
  const [showFedSpeeches, setShowFedSpeeches] = useState<boolean>(false);
  const [showFullCalendar, setShowFullCalendar] = useState<boolean>(false);
  const [activeSectionTab, setActiveSectionTab] = useState<'THESIS' | 'RADAR' | 'CALENDAR'>('THESIS');
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

  const supportingEvents = getSupportingContextEvents(snapshot.calendarEvents);
  const lockInfo = computePreNewsLockState(snapshot.calendarEvents, nowMs, primaryEv.id);
  const dominantColorClass =
    activeMatrix.dominantBias === 'BUY'
      ? 'text-[#10B981]'
      : activeMatrix.dominantBias === 'SELL'
      ? 'text-[#F43F5E]'
      : 'text-[#22D3EE]';

  return (
    <div
      data-testid="macro-news-view"
      className="pb-20 text-[#151D2A] dark:text-[#F2F4F7] font-sans transition-colors duration-150 divide-y divide-[#E5E7EB] dark:divide-[#20252D]"
    >
      {/* 01 / TOP MINIMAL HEADER (Senada Dasbor TradeVault) */}
      <section className="pb-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#697586] dark:text-[#929BA9]">
              TRADE NEWS • XAU/USD
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-[#F3F4F6] dark:bg-[#131720] text-[#697586] dark:text-[#929BA9]">
              {snapshot.sourceMode === 'GEMINI_AI' ? snapshot.modelUsed || 'AI LIVE' : 'ENGINE LIVE'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPlaybookGuide((prev) => !prev)}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7] border border-[#E5E7EB] dark:border-[#20252D] transition-colors flex items-center gap-1.5"
            >
              <Info className="w-3.5 h-3.5" />
              <span>{tr('Playbook', 'Playbook')}</span>
            </button>
            <button
              type="button"
              onClick={() => void runLiveAnalysis(true, snapshot, selectedEventId || undefined)}
              disabled={isRefreshing}
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-[#1769E8] dark:bg-[#3478DC] text-white hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{isRefreshing ? refreshStepMessage || tr('Memuat...', 'Syncing...') : tr('Analisis Live', 'Live Sync')}</span>
            </button>
          </div>
        </div>

        {/* Status Bar & Lock State Ringkas */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#697586] dark:text-[#929BA9]">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[#1769E8] dark:text-[#3478DC] font-semibold">
              <Lock className="w-3 h-3" />
              {tr(lockInfo.projectionBadgeId, lockInfo.projectionBadgeEn)}
            </span>
          </div>
          <span className="font-mono">
            {formatLiveUpdateClockWib(new Date(nowMs).toISOString())} • {formatTimestampWib(snapshot.analyzedAt)}
          </span>
        </div>

        {supabaseFeedback && (
          <div className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg bg-[#F9FAFB] dark:bg-[#0D1117] border border-[#E5E7EB] dark:border-[#20252D] text-[11px] text-[#697586] dark:text-[#929BA9]">
            <span className="truncate">{supabaseFeedback.message}</span>
            <button
              type="button"
              onClick={() => setSupabaseFeedback(null)}
              className="text-[#151D2A] dark:text-[#F2F4F7] font-semibold shrink-0"
            >
              {tr('Tutup', 'Dismiss')}
            </button>
          </div>
        )}

        {/* 02 / HERO DECISION DISPLAY (Senada Angka Utama Saldo di Dasbor) */}
        <div className="pt-1 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#697586] dark:text-[#929BA9]">
                {tr('BIAS DOMINAN • ', 'DOMINANT BIAS • ')}{activeClusterTitles}
              </p>
              <div className="flex items-baseline gap-3">
                <span className={`text-3xl sm:text-4xl font-bold tracking-tight tabular-nums ${dominantColorClass}`}>
                  {activeMatrix.dominantBias} {activeMatrix.dominantBias === 'BUY' ? activeMatrix.buyProbability : activeMatrix.dominantBias === 'SELL' ? activeMatrix.sellProbability : activeMatrix.mixedProbability}%
                </span>
                {activeMatrix.dynamicPivotTriggered && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-[#F43F5E]/15 text-[#F43F5E]">
                    {tr('PINDAH HALUAN', 'PIVOT OVERRIDE')}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#697586] dark:text-[#929BA9]">
                {formatTimestampWib(primaryEv.date)} • {simultaneousCount > 1 ? tr(`${simultaneousCount} Indikator Bersamaan`, `${simultaneousCount} Simultaneous Events`) : pillarBadgeLabel(primaryEv.pillar)}
              </p>
            </div>

            {/* Countdown Box Minimalis */}
            <div className="text-right shrink-0">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#697586] dark:text-[#929BA9] block">
                {tr('MENUJU RILIS', 'COUNTDOWN')}
              </span>
              <span className="text-base sm:text-lg font-mono font-bold tabular-nums text-[#151D2A] dark:text-[#F2F4F7]">
                {lockInfo.formattedCountdown || '--:--:--'}
              </span>
            </div>
          </div>

          {/* Segmented Probability Bar Tunggal */}
          <div className="space-y-1.5">
            <div className="h-1.5 w-full rounded-full overflow-hidden flex bg-[#E5E7EB] dark:bg-[#161B26]">
              <div style={{ width: `${activeMatrix.buyProbability}%` }} className="bg-[#10B981] transition-all duration-300" />
              <div style={{ width: `${activeMatrix.sellProbability}%` }} className="bg-[#F43F5E] transition-all duration-300" />
              <div style={{ width: `${activeMatrix.mixedProbability}%` }} className="bg-[#22D3EE] transition-all duration-300" />
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
              <span className="text-[#10B981] font-semibold">BUY {activeMatrix.buyProbability}%</span>
              <span className="text-[#F43F5E] font-semibold">SELL {activeMatrix.sellProbability}%</span>
              <span className="text-[#22D3EE] font-semibold">MIXED {activeMatrix.mixedProbability}%</span>
            </div>
          </div>
        </div>
      </section>

      {/* 03 / INTERMARKET PULSE 2x2 & CME FEDWATCH */}
      <section className="py-5 space-y-5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#697586] dark:text-[#929BA9]">
            {tr('INTERMARKET PULSE REAL-TIME', 'REAL-TIME INTERMARKET PULSE')}
          </span>
          <span className="text-[11px] text-[#697586] dark:text-[#929BA9]">DXY • US02Y • US10Y • USOIL</span>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          {intermarketList.map((asset) => {
            const displayLabel =
              asset.symbol === 'US02Y'
                ? 'US02Y YIELD'
                : asset.symbol === 'US10Y'
                ? 'US10Y YIELD'
                : asset.symbol === 'USOIL'
                ? 'US OIL (WTI)'
                : asset.symbol;
            const formattedPrice =
              asset.symbol === 'US02Y' || asset.symbol === 'US10Y'
                ? `${asset.price.toFixed(2)}%`
                : asset.symbol === 'USOIL'
                ? `$${asset.price.toFixed(2)}`
                : asset.price.toFixed(2);
            const isUp = asset.changePercent > 0;
            const isDown = asset.changePercent < 0;

            return (
              <div key={asset.symbol} className="space-y-0.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#697586] dark:text-[#929BA9]">
                    {displayLabel}
                  </span>
                  <span
                    className={`text-[11px] font-mono font-semibold tabular-nums ${
                      isUp ? 'text-[#1769E8] dark:text-[#3478DC]' : isDown ? 'text-[#F43F5E]' : 'text-[#697586] dark:text-[#929BA9]'
                    }`}
                  >
                    {isUp ? `+${asset.changePercent.toFixed(2)}%` : `${asset.changePercent.toFixed(2)}%`}
                  </span>
                </div>
                <div className="text-xl font-bold tabular-nums tracking-tight text-[#151D2A] dark:text-[#F2F4F7]">
                  {formattedPrice}
                </div>
                <p className="text-[11px] text-[#697586] dark:text-[#929BA9] truncate">
                  {isEn ? asset.summaryEn : asset.summaryId}
                </p>
              </div>
            );
          })}
        </div>

        {/* CME FedWatch 1 Baris Ringkas */}
        <div className="pt-3 border-t border-[#E5E7EB]/60 dark:border-[#20252D]/60 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#697586] dark:text-[#929BA9]">
              CME FEDWATCH • {activeFedWatch.fomcMeetingDate}
            </span>
            <span className="text-[11px] font-mono text-[#697586] dark:text-[#929BA9]">
              {activeFedWatch.isAvailable && typeof activeFedWatch.impliedFedFundsRate === 'number'
                ? `Implied ${activeFedWatch.impliedFedFundsRate.toFixed(2)}%`
                : 'ZQ=F Sync'}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <span className="text-[10px] uppercase text-[#697586] dark:text-[#929BA9] block">RATE HIKE</span>
              <span className="text-sm font-bold font-mono tabular-nums text-[#F43F5E]">
                {(activeFedWatch.hikeProbability ?? 0).toFixed(1)}%
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase text-[#697586] dark:text-[#929BA9] block">HOLD</span>
              <span className="text-sm font-bold font-mono tabular-nums text-[#151D2A] dark:text-[#F2F4F7]">
                {(activeFedWatch.holdProbability ?? 0).toFixed(1)}%
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase text-[#697586] dark:text-[#929BA9] block">RATE CUT</span>
              <span className="text-sm font-bold font-mono tabular-nums text-[#10B981]">
                {(activeFedWatch.cutProbability ?? 0).toFixed(1)}%
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 04 / TESIS MEJA INSTITUSI & TAKTIK EKSEKUSI */}
      <section className="py-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#1769E8] dark:text-[#3478DC]">
            {tr('TESIS MEJA INSTITUSI', 'INSTITUTIONAL DESK THESIS')}
          </span>
          <span className="text-[10px] font-mono text-[#697586] dark:text-[#929BA9]">
            {activeMatrix.evaluationMode === 'FOMC_MEETING'
              ? tr('Mode: 3 Pilar FOMC Penuh', 'Mode: Full 3 FOMC Pillars')
              : tr('Mode: Fokus Pilar Spesifik', 'Mode: Specific Pillar Focus')}
          </span>
        </div>

        <p className="text-xs sm:text-[13px] leading-relaxed text-[#151D2A] dark:text-[#E5E7EB] pl-3 border-l-2 border-[#1769E8] dark:border-[#3478DC]">
          {isEn
            ? activeMatrix.institutionalDeskThesisEn || activeMatrix.finalTakeEn
            : activeMatrix.institutionalDeskThesisId || activeMatrix.finalTakeId}
        </p>

        <div className="pt-1 space-y-1.5 text-xs text-[#697586] dark:text-[#929BA9]">
          <p className="text-[#151D2A] dark:text-[#F2F4F7] font-medium">
            <span className="text-[#1769E8] dark:text-[#3478DC] font-bold uppercase text-[10px] tracking-wider mr-2">
              {tr('TAKTIK T-5M:', 'T-5M TACTIC:')}
            </span>
            {isEn ? t5TacticEn : t5TacticId}
          </p>
          {activeMatrix.whipsawWarningId && (
            <p className="text-[11px] text-[#F59E0B]">
              <span className="font-bold uppercase mr-1.5">{tr('Whipsaw:', 'Whipsaw:')}</span>
              {isEn ? activeMatrix.whipsawWarningEn : activeMatrix.whipsawWarningId}
            </p>
          )}
        </div>
      </section>

      {/* 05 / PEMILIH JADWAL TARGET 14 HARI */}
      <section className="py-5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#697586] dark:text-[#929BA9]">
            {tr('PILIH TARGET RILIS (14 HARI)', 'SELECT TARGET RELEASE (14D)')}
          </span>
          <span className="text-[11px] font-mono text-[#697586] dark:text-[#929BA9]">
            {explorerEventGroups.length} {tr('Grup', 'Groups')}
          </span>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {QUICK_SEARCH_FILTERS.map((tag) => {
            const isSelected = (tag === 'ALL' && !searchQuery) || searchQuery.toUpperCase() === tag;
            return (
              <button
                key={tag}
                type="button"
                onClick={() => setSearchQuery(tag === 'ALL' ? '' : tag)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 transition-colors ${
                  isSelected
                    ? 'bg-[#1769E8] dark:bg-[#3478DC] text-white'
                    : 'bg-[#F3F4F6] dark:bg-[#131720] text-[#697586] dark:text-[#929BA9]'
                }`}
              >
                {tag === 'ALL' ? tr('Semua', 'All') : tag}
              </button>
            );
          })}
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#697586] dark:text-[#929BA9] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={tr('Cari rilis USD (PPI, CPI, NFP, FOMC)...', 'Search USD release (PPI, CPI, NFP, FOMC)...')}
            className="w-full pl-8 pr-3 py-2 rounded-lg bg-[#F9FAFB] dark:bg-[#0D1117] border border-[#E5E7EB] dark:border-[#20252D] text-xs text-[#151D2A] dark:text-[#F2F4F7] placeholder-[#697586] focus:outline-none focus:border-[#3478DC]"
          />
        </div>

        <div className="divide-y divide-[#E5E7EB]/60 dark:divide-[#20252D]/60">
          {explorerEventGroups.map((group) => {
            const isActive = group.groupId === (selectedEventId || nearestUpcomingGroup?.groupId);
            return (
              <button
                key={group.groupId}
                type="button"
                onClick={() => handleSelectEventGroup(group.groupId)}
                className={`w-full py-2.5 px-2 text-left flex items-center justify-between gap-3 rounded-lg transition-colors ${
                  isActive ? 'bg-[#1769E8]/10 dark:bg-[#3478DC]/15' : 'hover:bg-[#F9FAFB] dark:hover:bg-[#0D1117]'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[11px] font-mono text-[#697586] dark:text-[#929BA9]">
                    <span>{formatTimestampWib(group.releaseDateIso)}</span>
                    <span>•</span>
                    <span>{group.events.length} Data</span>
                  </div>
                  <p className={`text-xs sm:text-sm font-semibold truncate ${isActive ? 'text-[#1769E8] dark:text-[#3478DC]' : 'text-[#151D2A] dark:text-[#F2F4F7]'}`}>
                    {group.combinedTitle}
                  </p>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${
                    isActive
                      ? 'bg-[#1769E8] dark:bg-[#3478DC] text-white'
                      : 'bg-[#F3F4F6] dark:bg-[#131720] text-[#697586] dark:text-[#929BA9]'
                  }`}
                >
                  {isActive ? tr('AKTIF', 'ACTIVE') : tr('PILIH', 'SELECT')}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 06 / PILL SWITCHER SUB-MODUL */}
      <section className="pt-5 space-y-4">
        <div className="grid grid-cols-3 p-1 rounded-xl bg-[#F3F4F6] dark:bg-[#0D1117] border border-[#E5E7EB] dark:border-[#20252D]">
          <button
            type="button"
            onClick={() => setActiveSectionTab('THESIS')}
            className={`py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
              activeSectionTab === 'THESIS'
                ? 'bg-white dark:bg-[#1A202C] text-[#151D2A] dark:text-[#F2F4F7] shadow-xs'
                : 'text-[#697586] dark:text-[#929BA9]'
            }`}
          >
            {tr('Rilis & Argumen', 'Data & Thesis')}
          </button>
          <button
            type="button"
            onClick={() => setActiveSectionTab('RADAR')}
            className={`py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
              activeSectionTab === 'RADAR'
                ? 'bg-white dark:bg-[#1A202C] text-[#151D2A] dark:text-[#F2F4F7] shadow-xs'
                : 'text-[#697586] dark:text-[#929BA9]'
            }`}
          >
            {`Radar & Fed (${snapshot.breakingNews.length + supportingEvents.length})`}
          </button>
          <button
            type="button"
            onClick={() => setActiveSectionTab('CALENDAR')}
            className={`py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
              activeSectionTab === 'CALENDAR'
                ? 'bg-white dark:bg-[#1A202C] text-[#151D2A] dark:text-[#F2F4F7] shadow-xs'
                : 'text-[#697586] dark:text-[#929BA9]'
            }`}
          >
            {tr(`Kalender (${snapshot.calendarEvents.length})`, `Calendar (${snapshot.calendarEvents.length})`)}
          </button>
        </div>

        {/* TAB 1: RINCIAN ANGKA RILIS BERSAMAAN + ADU ARGUMEN 3 PILAR */}
        {activeSectionTab === 'THESIS' && (
          <div className="space-y-6">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#697586] dark:text-[#929BA9]">
                  {tr('ANGKA INDIKATOR TARGET', 'TARGET INDICATOR NUMBERS')}
                </span>
                <span className="text-[10px] font-mono text-[#10B981]">LIVE FEED VERIFIED</span>
              </div>

              <div className="divide-y divide-[#E5E7EB]/60 dark:divide-[#20252D]/60">
                {[primaryEv, ...(activeMatrix.simultaneousEvents || [])].map((ev) => (
                  <div key={ev.id} className="py-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs sm:text-sm font-bold text-[#151D2A] dark:text-[#F2F4F7]">{ev.title}</span>
                        <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-[#F3F4F6] dark:bg-[#131720] text-[#697586] dark:text-[#929BA9]">
                          {ev.pillar}
                        </span>
                      </div>
                      <span
                        className={`text-[11px] font-bold uppercase ${
                          ev.eventBiasForGold === 'BUY'
                            ? 'text-[#10B981]'
                            : ev.eventBiasForGold === 'SELL'
                            ? 'text-[#F43F5E]'
                            : 'text-[#22D3EE]'
                        }`}
                      >
                        {ev.eventBiasForGold}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs font-mono tabular-nums">
                      <div>
                        <span className="text-[10px] text-[#697586] dark:text-[#929BA9] block">PREVIOUS</span>
                        <span className="font-semibold text-[#151D2A] dark:text-[#F2F4F7]">{ev.previous || '-'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[#1769E8] dark:text-[#3478DC] block">FORECAST</span>
                        <span className="font-semibold text-[#1769E8] dark:text-[#3478DC]">{ev.forecast || '-'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[#697586] dark:text-[#929BA9] block">ACTUAL</span>
                        <span className="font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                          {ev.actual || tr('Menunggu', 'Pending')}
                        </span>
                      </div>
                    </div>

                    <p className="text-[11px] text-[#697586] dark:text-[#929BA9] leading-relaxed">
                      {isEn ? ev.biasReasonEn : ev.biasReasonId}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3 pt-2 border-t border-[#E5E7EB]/60 dark:border-[#20252D]/60">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#697586] dark:text-[#929BA9]">
                  {tr('ADU ARGUMEN 3 PILAR', '3-PILLAR ARGUMENTS')}
                </span>
                <div className="flex items-center gap-1">
                  {(['BOTH', 'BUY', 'SELL'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setArgumentTab(tab)}
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        argumentTab === tab
                          ? 'bg-[#1769E8] dark:bg-[#3478DC] text-white'
                          : 'text-[#697586] dark:text-[#929BA9]'
                      }`}
                    >
                      {tab === 'BOTH' ? tr('Semua', 'All') : tab}
                    </button>
                  ))}
                </div>
              </div>

              <div className="divide-y divide-[#E5E7EB]/60 dark:divide-[#20252D]/60">
                {(argumentTab === 'BOTH' || argumentTab === 'BUY') &&
                  activeMatrix.buyArguments.map((arg, i) => (
                    <div key={`buy-${i}`} className="py-2.5 flex items-start gap-2.5">
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#10B981]/15 text-[#10B981] shrink-0 mt-0.5">
                        BUY
                      </span>
                      <p className="text-xs text-[#151D2A] dark:text-[#E5E7EB] leading-relaxed">
                        {isEn ? arg.textEn : arg.textId}
                      </p>
                    </div>
                  ))}
                {(argumentTab === 'BOTH' || argumentTab === 'SELL') &&
                  activeMatrix.sellArguments.map((arg, i) => (
                    <div key={`sell-${i}`} className="py-2.5 flex items-start gap-2.5">
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#F43F5E]/15 text-[#F43F5E] shrink-0 mt-0.5">
                        SELL
                      </span>
                      <p className="text-xs text-[#151D2A] dark:text-[#E5E7EB] leading-relaxed">
                        {isEn ? arg.textEn : arg.textId}
                      </p>
                    </div>
                  ))}
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-[#E5E7EB]/60 dark:border-[#20252D]/60">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#697586] dark:text-[#929BA9] block">
                {tr('RENCANA EKSEKUSI DESK', 'DESK EXECUTION PLAN')}
              </span>
              <p className="text-xs text-[#697586] dark:text-[#929BA9] whitespace-pre-line leading-relaxed">
                {isEn ? activeMatrix.actionPlanEn : activeMatrix.actionPlanId}
              </p>
            </div>
          </div>
        )}

        {/* TAB 2: RADAR RSS HEADLINES & PIDATO FOMC (DENGAN TOMBOL ON/OFF) */}
        {activeSectionTab === 'RADAR' && (
          <div className="space-y-5">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#697586] dark:text-[#929BA9]">
                  {tr('AUTO-SCAN RSS HEADLINES', 'AUTO-SCAN RSS HEADLINES')} ({snapshot.breakingNews.length})
                </span>
                {snapshot.breakingNews.length > 2 && (
                  <button
                    type="button"
                    onClick={() => setShowAllHeadlines((prev) => !prev)}
                    className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border border-[#E5E7EB] dark:border-[#20252D] text-[#1769E8] dark:text-[#3478DC] flex items-center gap-1"
                  >
                    <span>{showAllHeadlines ? tr('ON • Semua', 'ON • All') : tr('OFF • Ringkas', 'OFF • Compact')}</span>
                    {showAllHeadlines ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                )}
              </div>

              <div className="divide-y divide-[#E5E7EB]/60 dark:divide-[#20252D]/60">
                {(showAllHeadlines ? snapshot.breakingNews : snapshot.breakingNews.slice(0, 2)).map((item) => (
                  <div key={item.id} className="py-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="font-semibold text-[#697586] dark:text-[#929BA9]">{item.source}</span>
                      <span
                        className={`font-bold uppercase ${
                          item.sentimentForGold === 'BULLISH'
                            ? 'text-[#10B981]'
                            : item.sentimentForGold === 'BEARISH'
                            ? 'text-[#F43F5E]'
                            : 'text-[#697586] dark:text-[#929BA9]'
                        }`}
                      >
                        {item.sentimentForGold}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F4F7] leading-snug">{item.title}</p>
                    <p className="text-[11px] text-[#697586] dark:text-[#929BA9] leading-relaxed">
                      {isEn ? item.aiEvaluationEn : item.aiEvaluationId}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2.5 pt-3 border-t border-[#E5E7EB]/60 dark:border-[#20252D]/60">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#697586] dark:text-[#929BA9]">
                  {tr('PIDATO FED & KONTEKS PENDUKUNG', 'FED SPEECHES & CONTEXT')} ({supportingEvents.length})
                </span>
                <button
                  type="button"
                  onClick={() => setShowFedSpeeches((prev) => !prev)}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors flex items-center gap-1 ${
                    showFedSpeeches
                      ? 'bg-[#1769E8] dark:bg-[#3478DC] text-white'
                      : 'bg-[#F3F4F6] dark:bg-[#131720] text-[#697586] dark:text-[#929BA9]'
                  }`}
                >
                  <span>{showFedSpeeches ? tr('ON • Tampil', 'ON • Shown') : tr('OFF • Sembunyi', 'OFF • Hidden')}</span>
                  {showFedSpeeches ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              </div>

              {showFedSpeeches ? (
                <div className="divide-y divide-[#E5E7EB]/60 dark:divide-[#20252D]/60">
                  {supportingEvents.map((ev) => (
                    <div key={ev.id} className="py-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-[10px] font-mono text-[#697586] dark:text-[#929BA9] block">
                          {formatTimestampWib(ev.date)} • {isFedSpeechEvent(ev.title) ? 'PIDATO FED' : 'KONTEKS'}
                        </span>
                        <p className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F4F7] truncate">{ev.title}</p>
                      </div>
                      <span className="text-[10px] font-mono text-[#697586] dark:text-[#929BA9] shrink-0">
                        {ev.previous !== '-' ? `P:${ev.previous} F:${ev.forecast}` : ev.eventBiasForGold}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                  {tr(
                    `${supportingEvents.length} jadwal pidato pejabat FOMC & data pendukung dipantau otomatis di latar belakang. Ketuk tombol ON untuk melihat daftarnya.`,
                    `${supportingEvents.length} FOMC speeches & supporting releases monitored automatically in background. Tap ON to expand list.`
                  )}
                </p>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: JADWAL KALENDER EKONOMI USD MINGGU INI (DENGAN TOGGLE ON/OFF) */}
        {activeSectionTab === 'CALENDAR' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#697586] dark:text-[#929BA9]">
                {tr('KALENDER EKONOMI USD', 'USD ECONOMIC CALENDAR')} ({snapshot.calendarEvents.length})
              </span>
              <button
                type="button"
                onClick={() => setShowFullCalendar((prev) => !prev)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors flex items-center gap-1 ${
                  showFullCalendar
                    ? 'bg-[#1769E8] dark:bg-[#3478DC] text-white'
                    : 'bg-[#F3F4F6] dark:bg-[#131720] text-[#697586] dark:text-[#929BA9]'
                }`}
              >
                <span>{showFullCalendar ? tr('ON • Semua Event', 'ON • All Events') : tr('OFF • High-Impact Saja', 'OFF • High-Impact Only')}</span>
                {showFullCalendar ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            </div>

            <div className="divide-y divide-[#E5E7EB]/60 dark:divide-[#20252D]/60">
              {(showFullCalendar
                ? snapshot.calendarEvents
                : snapshot.calendarEvents.filter((ev) => isPrimaryHighImpactEvent(ev))
              ).map((ev) => (
                <div key={ev.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#697586] dark:text-[#929BA9]">
                      <span>{formatTimestampWib(ev.date)}</span>
                      <span>•</span>
                      <span>{ev.pillar}</span>
                    </div>
                    <p className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F4F7] truncate">{ev.title}</p>
                    <div className="flex items-center gap-3 text-[10px] font-mono text-[#697586] dark:text-[#929BA9] mt-0.5">
                      <span>Prev: {ev.previous || '-'}</span>
                      <span className="text-[#1769E8] dark:text-[#3478DC]">Fcst: {ev.forecast || '-'}</span>
                      <span>Act: {ev.actual || '-'}</span>
                    </div>
                  </div>
                  <span
                    className={`text-[11px] font-bold uppercase shrink-0 ${
                      ev.eventBiasForGold === 'BUY'
                        ? 'text-[#10B981]'
                        : ev.eventBiasForGold === 'SELL'
                        ? 'text-[#F43F5E]'
                        : 'text-[#697586] dark:text-[#929BA9]'
                    }`}
                  >
                    {ev.eventBiasForGold}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* MODAL PLAYBOOK RINGKAS */}
      {showPlaybookGuide && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#0B0E14] border border-[#E5E7EB] dark:border-[#20252D] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#151D2A] dark:text-[#F2F4F7]">
                {tr('Panduan Pre-News & 12 Hukum Makro', 'Pre-News & 12 Macro Rules Playbook')}
              </h3>
              <button
                type="button"
                onClick={() => setShowPlaybookGuide(false)}
                className="p-1 text-[#697586] dark:text-[#929BA9]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <ul className="space-y-2 text-xs text-[#697586] dark:text-[#929BA9] leading-relaxed list-disc pl-4">
              <li>{tr('Gunakan bias utama sebagai peta arah, lalu tunggu konfirmasi struktur M1/M5 saat detik rilis.', 'Use dominant bias as directional map, then wait for M1/M5 structure confirmation at release.')}</li>
              <li>{tr('Cek keselarasan 4 aset Intermarket (DXY, US02Y, US10Y, USOIL) sebelum masuk posisi.', 'Verify 4-asset Intermarket alignment (DXY, US02Y, US10Y, USOIL) before entry.')}</li>
              <li>{tr('Waspadai Pindah Haluan jika data aktual meleset jauh atau komentar pejabat Fed berbalik arah.', 'Watch for Pivot Override if actual data misses sharply or Fed commentary flips tone.')}</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};
