import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  RefreshCw,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Info,
  Lock,
  Search,
} from 'lucide-react';
import { useLanguage } from '../../utils/language';
import {
  MacroNewsSnapshot,
  MacroCalendarEvent,
  MacroEventGroup,
  BreakingNewsHeadline,
  IntermarketAssetPulse,
  CmeFedWatchState,
  PillarArgumentItem,
  BiasHistoryPoint,
  RssFeedHealthStatus,
  loadLatestCachedMacroSnapshot,
  loadMacroBiasHistory,
  isSnapshotFresh,
  analyzeMacroEvent,
  computeDualHorizonAnalysis,
  groupCalendarEventsBySlot,
  isPrimaryHighImpactEvent,
  isFedSpeechEvent,
  getSupportingContextEvents,
  triggerHighImpactMacroNotification,
  formatTimestampWib,
  formatLiveUpdateClockWib,
  createUnavailableFedWatchState,
  computePreNewsLockState,
  evaluateSingleEventForGold,
  evaluateBreakingHeadlineContext,
} from '../../utils/macroNewsEngine';
import {
  evaluateConfluenceMaster,
  computeIntradaySpikeTargetMap,
  loadStoredManualAmdOverride,
  loadStoredSessionHoursWib,
  MANUAL_AMD_OVERRIDE_CHANGE_EVENT,
  MANUAL_AMD_OVERRIDE_STORAGE_KEY,
  MANUAL_AMD_OVERRIDE_OPTIONS,
  SESSION_HOURS_WIB_CHANGE_EVENT,
  SESSION_HOURS_WIB_STORAGE_KEY,
  getSessionLabelId,
  formatSessionWindowWib,
  type ManualAmdOverrideMode,
  type SessionHoursWibConfig,
} from '../../utils/confluenceEngine';
import { useCycleConfluenceData } from '../../hooks/useCycleConfluenceData';
import { executeClientSideMacroAnalysis } from '../../utils/clientSideMacroAnalyzer';
import {
  fetchLiveIntermarketPulseBundle,
  fetchClientBreakingHeadlinesWithHealth,
} from '../../utils/macroFeedFetcher';
import { isSupabaseConfigured } from '../../utils/supabaseClient';
import {
  IntermarketDetailSheet,
  ArgumentDetailSheet,
  TargetReleaseSheet,
  PlaybookSheet,
} from './MacroDetailPanels';

const AUTO_REFRESH_TTL_MINUTES = 5;
const INTERMARKET_LIVE_POLL_MS = 45_000;
const ADAPTIVE_RSS_CHECK_MS = 60_000;
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
  const [eventWindowFilter, setEventWindowFilter] = useState<'ALL' | 'UPCOMING' | 'RELEASED'>('ALL');
  const [argumentTab, setArgumentTab] = useState<'BUY' | 'SELL' | 'BOTH'>('BOTH');
  const [showAllHeadlines, setShowAllHeadlines] = useState<boolean>(false);
  const [showPlaybookGuide, setShowPlaybookGuide] = useState<boolean>(false);
  const [showFedSpeeches, setShowFedSpeeches] = useState<boolean>(false);
  const [showFullCalendar, setShowFullCalendar] = useState<boolean>(false);
  const [showTargetSelector, setShowTargetSelector] = useState<boolean>(false);
  const [showPreNewsFlow, setShowPreNewsFlow] = useState<boolean>(false);
  const [showBiasHistory, setShowBiasHistory] = useState<boolean>(false);
  const [showManipulationMap, setShowManipulationMap] = useState<boolean>(false);
  const [strategyTab, setStrategyTab] = useState<'EXECUTION' | 'THESIS'>('EXECUTION');
  const [biasHistory, setBiasHistory] = useState<BiasHistoryPoint[]>([]);
  const [calendarViewMode, setCalendarViewMode] = useState<'LIST' | 'TIMELINE'>('LIST');
  const [expandedCalendarEventIds, setExpandedCalendarEventIds] = useState<Record<string, boolean>>({});
  const [selectedIntermarketAsset, setSelectedIntermarketAsset] =
    useState<IntermarketAssetPulse | null>(null);
  const [selectedArgument, setSelectedArgument] = useState<{
    side: 'BUY' | 'SELL';
    item: PillarArgumentItem;
  } | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [lastIntermarketSyncIso, setLastIntermarketSyncIso] = useState<string | null>(null);
  const [liveRssFeedHealth, setLiveRssFeedHealth] = useState<RssFeedHealthStatus | null>(null);
  const [manualAmdOverride, setManualAmdOverride] = useState<ManualAmdOverrideMode>(() =>
    loadStoredManualAmdOverride()
  );
  const [sessionConfig, setSessionConfig] = useState<SessionHoursWibConfig>(() =>
    loadStoredSessionHoursWib()
  );
  const confluenceData = useCycleConfluenceData('SWING', true);

  // Sync Manual AMD Override & Session Hours WIB from Cycle & Confluence page via custom event + localStorage
  useEffect(() => {
    const syncOverride = () => {
      setManualAmdOverride(loadStoredManualAmdOverride());
    };
    const syncSessionConfig = () => {
      setSessionConfig(loadStoredSessionHoursWib());
    };
    const handleStorage = (e: StorageEvent) => {
      if (e.key === MANUAL_AMD_OVERRIDE_STORAGE_KEY) {
        syncOverride();
      } else if (e.key === SESSION_HOURS_WIB_STORAGE_KEY) {
        syncSessionConfig();
      }
    };
    window.addEventListener(MANUAL_AMD_OVERRIDE_CHANGE_EVENT, syncOverride);
    window.addEventListener(SESSION_HOURS_WIB_CHANGE_EVENT, syncSessionConfig);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(MANUAL_AMD_OVERRIDE_CHANGE_EVENT, syncOverride);
      window.removeEventListener(SESSION_HOURS_WIB_CHANGE_EVENT, syncSessionConfig);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // Tracks which upcoming event ID has already executed its single final T-5M fetch
  // so that inside the final 5-minute window (05:00 -> 00:00) the snapshot remains 100% locked.
  const t5FinalFetchedEventIdRef = useRef<string | null>(null);
  const isRefreshingRef = useRef<boolean>(false);
  const isIntermarketPollingRef = useRef<boolean>(false);
  const isRssPollingRef = useRef<boolean>(false);
  const lastAutoRefreshMsRef = useRef<number>(Date.now());

  const syncLiveIntermarketPulse = useCallback(async () => {
    if (isIntermarketPollingRef.current || isRefreshingRef.current) return;
    isIntermarketPollingRef.current = true;
    try {
      const liveBundle = await fetchLiveIntermarketPulseBundle();
      if (!liveBundle) return;

      setLastIntermarketSyncIso(liveBundle.fetchedAt);
      setSnapshot((prev) => {
        if (!prev) return prev;
        const pickAsset = (
          fresh: IntermarketAssetPulse | undefined,
          fallback: IntermarketAssetPulse | undefined
        ): IntermarketAssetPulse | undefined =>
          fresh && fresh.isAvailable !== false && Number.isFinite(fresh.price) && fresh.price > 0
            ? fresh
            : fallback;

        const nextDxy = pickAsset(liveBundle.dxy, prev.intermarketPulse.dxy) || prev.intermarketPulse.dxy;
        const nextUs02y = pickAsset(liveBundle.us02y, prev.intermarketPulse.us02y);
        const nextUsoil = pickAsset(liveBundle.usoil, prev.intermarketPulse.usoil) || prev.intermarketPulse.usoil;
        const nextUs10y = pickAsset(liveBundle.us10y, prev.intermarketPulse.us10y) || prev.intermarketPulse.us10y;
        const nextVix =
          liveBundle.vix && liveBundle.vix.isAvailable && liveBundle.vix.price > 0
            ? liveBundle.vix
            : prev.intermarketPulse.vix;
        const nextGoldPos =
          liveBundle.goldPositioning &&
          liveBundle.goldPositioning.isAvailable &&
          liveBundle.goldPositioning.price > 0
            ? liveBundle.goldPositioning
            : prev.intermarketPulse.goldPositioning;

        return {
          ...prev,
          intermarketPulse: {
            ...prev.intermarketPulse,
            dxy: nextDxy,
            us02y: nextUs02y,
            usoil: nextUsoil,
            us10y: nextUs10y,
            vix: nextVix,
            goldPositioning: nextGoldPos,
          },
        };
      });

      setSelectedIntermarketAsset((prevSelected) => {
        if (!prevSelected) return null;
        if (prevSelected.symbol === 'DXY' && liveBundle.dxy.isAvailable) return liveBundle.dxy;
        if (prevSelected.symbol === 'US02Y' && liveBundle.us02y.isAvailable) return liveBundle.us02y;
        if (prevSelected.symbol === 'US10Y' && liveBundle.us10y.isAvailable) return liveBundle.us10y;
        if (prevSelected.symbol === 'USOIL' && liveBundle.usoil.isAvailable) return liveBundle.usoil;
        return prevSelected;
      });
    } catch {
      // Silent background poll failure
    } finally {
      isIntermarketPollingRef.current = false;
    }
  }, []);

  const runLiveAnalysis = useCallback(
    async (
      _forceRefresh: boolean,
      existingSnap?: MacroNewsSnapshot | null,
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
          true,
          existingSnap?.calendarEvents
        );

        let finalSnap = analyzedSnap;
        const priorSnap = existingSnap;

        if (priorSnap) {
          const isAssetValid = (a?: IntermarketAssetPulse) =>
            Boolean(a && a.isAvailable !== false && Number.isFinite(a.price) && a.price > 0);

          const needCalendarPreserve =
            analyzedSnap.calendarEvents.length === 0 && priorSnap.calendarEvents.length > 0;
          const needFedWatchPreserve =
            !analyzedSnap.cmeFedWatch?.isAvailable && Boolean(priorSnap.cmeFedWatch?.isAvailable);
          const needPulsePreserve =
            (!isAssetValid(analyzedSnap.intermarketPulse?.dxy) &&
              isAssetValid(priorSnap.intermarketPulse?.dxy)) ||
            (!isAssetValid(analyzedSnap.intermarketPulse?.us02y) &&
              isAssetValid(priorSnap.intermarketPulse?.us02y)) ||
            (!isAssetValid(analyzedSnap.intermarketPulse?.us10y) &&
              isAssetValid(priorSnap.intermarketPulse?.us10y)) ||
            (!isAssetValid(analyzedSnap.intermarketPulse?.usoil) &&
              isAssetValid(priorSnap.intermarketPulse?.usoil));
          const needNewsPreserve =
            analyzedSnap.breakingNews.length === 0 && priorSnap.breakingNews.length > 0;

          if (needCalendarPreserve || needFedWatchPreserve || needPulsePreserve || needNewsPreserve) {
            const mergedCalendar = needCalendarPreserve
              ? priorSnap.calendarEvents
              : analyzedSnap.calendarEvents;
            const mergedFedWatch = needFedWatchPreserve
              ? priorSnap.cmeFedWatch
              : analyzedSnap.cmeFedWatch;
            const mergedPulse = {
              dxy: isAssetValid(analyzedSnap.intermarketPulse?.dxy)
                ? analyzedSnap.intermarketPulse.dxy
                : priorSnap.intermarketPulse.dxy,
              us02y: isAssetValid(analyzedSnap.intermarketPulse?.us02y)
                ? analyzedSnap.intermarketPulse.us02y
                : priorSnap.intermarketPulse.us02y,
              us10y: isAssetValid(analyzedSnap.intermarketPulse?.us10y)
                ? analyzedSnap.intermarketPulse.us10y
                : priorSnap.intermarketPulse.us10y,
              usoil: isAssetValid(analyzedSnap.intermarketPulse?.usoil)
                ? analyzedSnap.intermarketPulse.usoil
                : priorSnap.intermarketPulse.usoil,
              vix: analyzedSnap.intermarketPulse?.vix?.isAvailable
                ? analyzedSnap.intermarketPulse.vix
                : priorSnap.intermarketPulse?.vix,
              goldPositioning: analyzedSnap.intermarketPulse?.goldPositioning?.isAvailable
                ? analyzedSnap.intermarketPulse.goldPositioning
                : priorSnap.intermarketPulse?.goldPositioning,
            };
            const mergedNews = needNewsPreserve ? priorSnap.breakingNews : analyzedSnap.breakingNews;

            const recomputed = analyzeMacroEvent({
              calendarEvents: mergedCalendar,
              intermarketPulse: mergedPulse,
              breakingNews: mergedNews,
              cmeFedWatch: mergedFedWatch,
              selectedEventId: targetEventId || undefined,
              sourceMode: analyzedSnap.sourceMode,
              modelUsed: analyzedSnap.modelUsed,
              priorCalendarEvents: priorSnap.calendarEvents,
            });

            finalSnap = {
              ...recomputed,
              isCalendarLiveFeed: needCalendarPreserve
                ? priorSnap.isCalendarLiveFeed
                : analyzedSnap.isCalendarLiveFeed,
              analyzedAt: needCalendarPreserve ? priorSnap.analyzedAt : analyzedSnap.analyzedAt,
            };
          }
        }

        setSnapshot(finalSnap);
        if (finalSnap.rssFeedHealth) {
          setLiveRssFeedHealth(finalSnap.rssFeedHealth);
        }
        lastAutoRefreshMsRef.current = Date.now();

        if (_forceRefresh && supabaseResult.remoteSaved) {
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

        if (finalSnap.impactLevel === 'HIGH') {
          await triggerHighImpactMacroNotification(finalSnap, language);
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
  useEffect(() => {
    let mounted = true;
    (async () => {
      setIsLoading(true);
      const cached = await loadLatestCachedMacroSnapshot();
      if (!mounted) return;

      if (cached) {
        setSnapshot(cached);
        setIsLoading(false);
        // Immediately sync live Yahoo Finance Intermarket Pulse quotes even when macro snapshot is cached (< 15m)
        void syncLiveIntermarketPulse();

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
  }, [runLiveAnalysis, syncLiveIntermarketPulse]);

  // Lightweight 45-second background ticker poll for Intermarket Pulse (0 Gemini tokens)
  // Strictly active on weekdays (Monday-Friday / Senin-Jumat) while XAU/USD market is open
  useEffect(() => {
    if (!confluenceData.isMarketOpen) return;
    const timer = setInterval(() => {
      void syncLiveIntermarketPulse();
    }, INTERMARKET_LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [confluenceData.isMarketOpen, syncLiveIntermarketPulse]);

  // Initial RSS health check on mount so "4/4 Feed Aktif" shows immediately even when reading cached snapshot
  useEffect(() => {
    let active = true;
    fetchClientBreakingHeadlinesWithHealth()
      .then((res) => {
        if (!active) return;
        setLiveRssFeedHealth(res.rssFeedHealth);
        setSnapshot((prev) =>
          prev
            ? {
                ...prev,
                rssFeedHealth: res.rssFeedHealth,
                breakingNews: res.headlines.length > 0 ? res.headlines : prev.breakingNews,
                topBreakingAlert: res.headlines[0] || prev.topBreakingAlert,
              }
            : prev
        );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const lockState = useMemo(() => {
    if (!snapshot) {
      return computePreNewsLockState([], nowMs, selectedEventId);
    }
    return computePreNewsLockState(snapshot.calendarEvents, nowMs, selectedEventId);
  }, [snapshot, nowMs, selectedEventId]);

  // Determine if we are inside the High-Alert Release Window: T-30m before release through T+15m after release
  const isInAdaptiveFastWindow = useMemo(() => {
    if (!snapshot) return false;
    const THIRTY_MIN_MS = 30 * 60 * 1000;
    const FIFTEEN_MIN_MS = 15 * 60 * 1000;
    return snapshot.calendarEvents.some((ev) => {
      if (!isPrimaryHighImpactEvent(ev)) return false;
      const evMs = new Date(ev.date).getTime();
      if (!Number.isFinite(evMs)) return false;
      const diffMs = evMs - nowMs; // positive = upcoming, negative = already released
      return (diffMs > 0 && diffMs <= THIRTY_MIN_MS) || (diffMs <= 0 && Math.abs(diffMs) <= FIFTEEN_MIN_MS);
    });
  }, [snapshot, nowMs]);

  // Background RSS & Automatic Cache Invalidation Poll (checks every 60s for new articles or adaptive window refresh)
  useEffect(() => {
    if (!snapshot) return;
    const timer = setInterval(async () => {
      if (isRefreshingRef.current || isRssPollingRef.current) return;
      isRssPollingRef.current = true;
      try {
        const rssRes = await fetchClientBreakingHeadlinesWithHealth();
        setLiveRssFeedHealth(rssRes.rssFeedHealth);

        const normalizeTitle = (t: string) =>
          t.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim().slice(0, 65);

        const prevTopHash = (snapshot.breakingNews || [])
          .slice(0, 6)
          .map((h) => normalizeTitle(h.title))
          .join('|');
        const nextTopHash = (rssRes.headlines || [])
          .slice(0, 6)
          .map((h) => normalizeTitle(h.title))
          .join('|');

        const hasNewRssHeadline = Boolean(nextTopHash && nextTopHash !== prevTopHash);
        const adaptiveIntervalMs = isInAdaptiveFastWindow ? 60_000 : AUTO_REFRESH_TTL_MINUTES * 60_000;
        const elapsedSinceLastAnalysis = Date.now() - lastAutoRefreshMsRef.current;

        if (
          confluenceData.isMarketOpen &&
          (hasNewRssHeadline || elapsedSinceLastAnalysis >= adaptiveIntervalMs)
        ) {
          void runLiveAnalysis(false, snapshot, selectedEventId);
        } else {
          setSnapshot((prev) =>
            prev
              ? {
                  ...prev,
                  rssFeedHealth: rssRes.rssFeedHealth,
                }
              : prev
          );
        }
      } catch {
        // Silent background poll
      } finally {
        isRssPollingRef.current = false;
      }
    }, ADAPTIVE_RSS_CHECK_MS);

    return () => clearInterval(timer);
  }, [confluenceData.isMarketOpen, snapshot, isInAdaptiveFastWindow, selectedEventId, runLiveAnalysis]);

  // Automatic T-5M Final Fetch & Adaptive Periodic Refresh (60s in T-30m..T+15m, 5m normal)
  // Paused automatically on Saturday & Sunday when XAU/USD market is closed
  useEffect(() => {
    if (!snapshot || !confluenceData.isMarketOpen) return;

    const targetEv = lockState.targetEvent;
    if (lockState.isLockedT5M && targetEv) {
      if (t5FinalFetchedEventIdRef.current !== targetEv.id) {
        t5FinalFetchedEventIdRef.current = targetEv.id;
        void runLiveAnalysis(true, snapshot, targetEv.id);
      }
      return;
    }

    const ttlMinutes = isInAdaptiveFastWindow ? 1 : AUTO_REFRESH_TTL_MINUTES;
    if (
      !lockState.isLockedT5M &&
      !isSnapshotFresh(snapshot, ttlMinutes) &&
      !isRefreshingRef.current &&
      Date.now() - lastAutoRefreshMsRef.current >= ttlMinutes * 60_000
    ) {
      void runLiveAnalysis(false, snapshot, selectedEventId);
    }
  }, [confluenceData.isMarketOpen, lockState.isLockedT5M, lockState.targetEvent, isInAdaptiveFastWindow, snapshot, selectedEventId, runLiveAnalysis]);

  const allEventGroups = useMemo<MacroEventGroup[]>(() => {
    if (!snapshot) return [];
    return groupCalendarEventsBySlot(snapshot.calendarEvents, nowMs, true);
  }, [snapshot, nowMs]);

  const supportingContextEvents = useMemo<MacroCalendarEvent[]>(() => {
    if (!snapshot) return [];
    return getSupportingContextEvents(snapshot.calendarEvents, nowMs);
  }, [snapshot, nowMs]);

  const nearestUpcomingGroup = useMemo<MacroEventGroup | null>(() => {
    const upcoming = allEventGroups.filter((g) => g.isUpcoming);
    return upcoming[0] || allEventGroups[0] || null;
  }, [allEventGroups]);

  const explorerEventGroups = useMemo<MacroEventGroup[]>(() => {
    if (allEventGroups.length === 0) return [];
    const q = searchQuery.trim().toLowerCase();

    let base = allEventGroups;
    if (eventWindowFilter === 'UPCOMING') {
      base = allEventGroups.filter((g) => g.isUpcoming || g.isRecentlyReleased);
    } else if (eventWindowFilter === 'RELEASED') {
      base = [...allEventGroups]
        .filter((g) => !g.isUpcoming)
        .sort((a, b) => new Date(b.releaseDateIso).getTime() - new Date(a.releaseDateIso).getTime());
    }

    if (q && q !== 'all') {
      return base.filter((g) => g.searchKeywords.includes(q));
    }

    return base;
  }, [allEventGroups, searchQuery, eventWindowFilter]);

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

  const handleSelectEventGroup = useCallback(
    (groupId: string) => {
      const targetEv = snapshot?.calendarEvents.find((e) => e.id === groupId);
      if (targetEv && !isPrimaryHighImpactEvent(targetEv)) {
        return;
      }
      setSelectedEventId(groupId);
      const currentLock = snapshot
        ? computePreNewsLockState(snapshot.calendarEvents, Date.now(), groupId)
        : null;
      if (currentLock?.isLockedT5M && t5FinalFetchedEventIdRef.current === groupId) {
        return;
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

  useEffect(() => {
    let active = true;
    const targetTitle = activeMatrix?.primaryEvent?.title;
    loadMacroBiasHistory(targetTitle, 8)
      .then((pts) => {
        if (active) setBiasHistory(pts);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [snapshot?.analyzedAt, activeMatrix?.primaryEvent?.title]);

  const activeFedWatch: CmeFedWatchState = useMemo(() => {
    return (
      activeMatrix?.cmeFedWatch ||
      snapshot?.cmeFedWatch ||
      createUnavailableFedWatchState()
    );
  }, [activeMatrix, snapshot]);

  const contextualBreakingNews = useMemo(() => {
    const rawList = snapshot?.breakingNews || [];
    return rawList.map((item) => {
      const ctx = evaluateBreakingHeadlineContext(
        item.title,
        undefined,
        item.matchedKeywords || []
      );
      if (ctx.sentimentForGold !== 'NEUTRAL') {
        return {
          ...item,
          impact: ctx.impact,
          sentimentForGold: ctx.sentimentForGold,
          channelType: ctx.channelType,
          aiEvaluationId: ctx.aiEvaluationId,
          aiEvaluationEn: ctx.aiEvaluationEn,
        };
      }
      return item;
    });
  }, [snapshot?.breakingNews]);

  const confluenceBridge = useMemo(() => {
    const macroBias = activeMatrix?.dominantBias || snapshot?.dominantBias || 'MIXED';
    return evaluateConfluenceMaster({
      viewMode: 'FULL',
      tradingMode: 'SWING',
      livePrice: confluenceData.livePrice,
      macroBias,
      candlesByTf: confluenceData.candlesByTf,
      sessionConfig,
      manualAmdOverride,
    });
  }, [
    activeMatrix?.dominantBias,
    snapshot?.dominantBias,
    confluenceData.livePrice,
    confluenceData.candlesByTf,
    sessionConfig,
    manualAmdOverride,
  ]);

  const hasConfluenceCandles =
    (confluenceData.candlesByTf['15min']?.length ?? 0) >= 10 ||
    (confluenceData.candlesByTf['1h']?.length ?? 0) >= 10 ||
    (confluenceData.candlesByTf['4h']?.length ?? 0) >= 10 ||
    (confluenceData.candlesByTf['1day']?.length ?? 0) >= 10;
  const amdState = confluenceBridge.amdState;
  const activeSmc =
    confluenceBridge.ltfAnalysis ||
    confluenceBridge.mtfAnalysis ||
    confluenceBridge.htfAnalysis;
  const hasConfluenceLevels = Boolean(
    hasConfluenceCandles &&
      activeSmc &&
      activeSmc.swingHigh > 0 &&
      activeSmc.swingLow > 0 &&
      amdState &&
      amdState.nearestBslPrice > 0 &&
      amdState.nearestSslPrice > 0
  );

  const isLiveCalendar = Boolean(
    snapshot?.isCalendarLiveFeed &&
      Array.isArray(snapshot?.calendarEvents) &&
      snapshot.calendarEvents.length > 0 &&
      snapshot.calendarEvents.every((e) => e.isLiveFeed === true)
  );

  const filteredCalendarEvents = useMemo(() => {
    if (!snapshot) return [];
    const base = showFullCalendar
      ? snapshot.calendarEvents
      : snapshot.calendarEvents.filter((ev) => isPrimaryHighImpactEvent(ev));

    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
    const windowFiltered = base.filter((ev) => {
      const evMs = new Date(ev.date).getTime();
      if (!Number.isFinite(evMs)) return eventWindowFilter === 'ALL';
      if (eventWindowFilter === 'UPCOMING') {
        return evMs > nowMs || evMs >= nowMs - TWO_HOURS_MS;
      }
      if (eventWindowFilter === 'RELEASED') {
        return evMs <= nowMs;
      }
      return true;
    });

    const sorted =
      eventWindowFilter === 'RELEASED'
        ? [...windowFiltered].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        : windowFiltered;

    const q = searchQuery.trim().toLowerCase();
    if (!q || q === 'all') return sorted;

    return sorted.filter((ev) => {
      const hay = `${ev.title} ${ev.pillar} ${ev.impact} ${formatTimestampWib(
        ev.date,
        isEn ? 'en' : 'id'
      )}`.toLowerCase();
      return hay.includes(q);
    });
  }, [snapshot, showFullCalendar, eventWindowFilter, searchQuery, nowMs, isEn]);

  const timelineClusters = useMemo(() => {
    if (filteredCalendarEvents.length === 0) return [];
    const groups = groupCalendarEventsBySlot(filteredCalendarEvents, nowMs, true);
    if (eventWindowFilter === 'RELEASED') {
      return [...groups].sort(
        (a, b) => new Date(b.releaseDateIso).getTime() - new Date(a.releaseDateIso).getTime()
      );
    }
    return groups;
  }, [filteredCalendarEvents, nowMs, eventWindowFilter]);

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
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-8 text-center font-sans">
        <RefreshCw className="w-5 h-5 text-[#151D2A] dark:text-[#F2F4F7] animate-spin mb-4" />
        <h3 className="text-sm sm:text-base font-semibold text-[#151D2A] dark:text-[#F2F4F7] tracking-tight">
          {tr('Memuat Trade News...', 'Loading Trade News...')}
        </h3>
        <p className="text-xs sm:text-sm text-[#697586] dark:text-[#929BA9] mt-1.5 max-w-sm leading-relaxed">
          {tr(
            'Menghubungkan ke kalender ekonomi USD, data intermarket, dan umpan berita makro.',
            'Connecting to USD economic calendar, intermarket data, and macro news feeds.'
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
    price: 0,
    previousClose: 0,
    change: 0,
    changePercent: 0,
    direction: 'FLAT',
    goldCorrelationEffect: 'NEUTRAL',
    summaryId: 'Data US02Y belum tersedia',
    summaryEn: 'US02Y data unavailable',
    updatedAt: snapshot.analyzedAt || new Date().toISOString(),
    isAvailable: false,
  };

  const intermarketList: IntermarketAssetPulse[] = [
    snapshot.intermarketPulse.dxy,
    us02yPulse,
    snapshot.intermarketPulse.us10y,
    snapshot.intermarketPulse.usoil,
  ];

  const primaryEv = activeMatrix.primaryEvent;
  const clusterEvents = [primaryEv, ...(activeMatrix.simultaneousEvents || [])];
  const simultaneousCount = clusterEvents.length;
  const activeClusterTitles = clusterEvents.map((e) => e.title).join(' & ');

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

  const lockInfo = computePreNewsLockState(snapshot.calendarEvents, nowMs, primaryEv.id);
  const primaryTimeMs = new Date(primaryEv.date).getTime();
  const isSelectedPrimaryReleased = Number.isFinite(primaryTimeMs) && primaryTimeMs <= nowMs;
  const clusterHasAnyActual = clusterEvents.some((e) => Boolean(e.actual && e.actual.trim()));

  // 3-Phase Release Timer Calculations (>15m pre, <=15m pre, 0..+3m post sweep, >+3m post confirmation)
  const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
  const THREE_MINUTES_MS = 3 * 60 * 1000;
  const msUntilRelease = Number.isFinite(primaryTimeMs)
    ? Math.max(0, primaryTimeMs - nowMs)
    : lockInfo.remainingMs;
  const msAfterRelease =
    isSelectedPrimaryReleased && Number.isFinite(primaryTimeMs)
      ? Math.max(0, nowMs - primaryTimeMs)
      : 0;

  type ReleaseTimerPhase = 'PHASE_1_NORMAL' | 'PHASE_2_SPIKE_ZONE' | 'PHASE_3_SWEEP' | 'PHASE_4_CONFIRM';
  const releaseTimerPhase: ReleaseTimerPhase = !isSelectedPrimaryReleased
    ? msUntilRelease > FIFTEEN_MINUTES_MS
      ? 'PHASE_1_NORMAL'
      : 'PHASE_2_SPIKE_ZONE'
    : msAfterRelease <= THREE_MINUTES_MS
    ? 'PHASE_3_SWEEP'
    : 'PHASE_4_CONFIRM';

  const formatForwardTimerMmSs = (elapsedMs: number): string => {
    const totalSec = Math.max(1, Math.floor(elapsedMs / 1000));
    const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const ss = String(totalSec % 60).padStart(2, '0');
    return `+${mm}:${ss}`;
  };

  const releaseTimerDisplayValue =
    releaseTimerPhase === 'PHASE_1_NORMAL' || releaseTimerPhase === 'PHASE_2_SPIKE_ZONE'
      ? lockInfo.formattedCountdown || '--:--:--'
      : releaseTimerPhase === 'PHASE_3_SWEEP'
      ? formatForwardTimerMmSs(Math.min(THREE_MINUTES_MS, msAfterRelease))
      : msAfterRelease < 60 * 60 * 1000
      ? `${formatForwardTimerMmSs(msAfterRelease)} · ${
          clusterHasAnyActual ? tr('POST-NEWS', 'POST-NEWS') : tr('RILIS', 'RELEASED')
        }`
      : clusterHasAnyActual
      ? tr('POST-NEWS', 'POST-NEWS')
      : tr('SUDAH RILIS', 'RELEASED');

  // Automatic "PROTOKOL ANTI-SWEEP" Conditions from Snapshot Data
  const goldPosData =
    activeMatrix.preNewsFlow?.goldPositioning || snapshot.intermarketPulse?.goldPositioning;
  const gold3dChangePct =
    goldPosData && goldPosData.isAvailable !== false && Number.isFinite(goldPosData.change3dPercent)
      ? goldPosData.change3dPercent
      : null;

  const isExhaustionSell =
    activeMatrix.dominantBias === 'SELL' && gold3dChangePct !== null && gold3dChangePct <= -2.5;
  const isExhaustionBuy =
    activeMatrix.dominantBias === 'BUY' && gold3dChangePct !== null && gold3dChangePct >= 2.5;
  const isWideConsensusDeviation = activeMatrix.preNewsFlow?.consensusTightness === 'WIDE';

  const dxyAssetPulse = snapshot.intermarketPulse?.dxy;
  const dxyChangePct =
    dxyAssetPulse && dxyAssetPulse.isAvailable !== false && Number.isFinite(dxyAssetPulse.changePercent)
      ? dxyAssetPulse.changePercent
      : null;
  const us02yChangePct =
    us02yPulse && us02yPulse.isAvailable !== false && Number.isFinite(us02yPulse.changePercent)
      ? us02yPulse.changePercent
      : null;

  const isDxyUpYieldDown =
    dxyChangePct !== null && us02yChangePct !== null && dxyChangePct >= 0.5 && us02yChangePct <= -0.3;
  const isDxyDownYieldUp =
    dxyChangePct !== null && us02yChangePct !== null && dxyChangePct <= -0.5 && us02yChangePct >= 0.3;

  const amdPhaseUpper = String(amdState?.phase || '').toUpperCase();
  const isAutoAmdSweepPhase =
    manualAmdOverride === 'AUTO' &&
    hasConfluenceCandles &&
    (amdPhaseUpper === 'ACCUMULATION' ||
      amdPhaseUpper === 'DOUBLE_ACCUMULATION' ||
      amdPhaseUpper === 'RE-ACCUMULATION' ||
      amdPhaseUpper === 'MANIPULATION');

  const antiSweepReasons: string[] = [];
  if (manualAmdOverride === 'ACCUMULATION') {
    antiSweepReasons.push(
      tr(
        'Teknikal AMD (Manual Lock: Akumulasi): Pasar sedang terkompresi membangun likuiditas BSL/SSL — rilis berita berisiko tinggi memicu spike/sweep 2 arah (manipulasi) sebelum ekspansi tren.',
        'AMD Technical (Manual Lock: Accumulation): Market is compressed building BSL/SSL liquidity — news release carries high risk of triggering a 2-way manipulation sweep before trend expansion.'
      )
    );
  } else if (manualAmdOverride === 'MANIPULATION') {
    antiSweepReasons.push(
      tr(
        'Teknikal AMD (Manual Lock: Manipulasi): Pasar sedang dalam fase sapuan likuiditas / stop-hunt — hindari eksekusi instan saat rilis berita dan wajib tunggu konfirmasi penolakan (rejection) atau MSS.',
        'AMD Technical (Manual Lock: Manipulation): Market is in an active liquidity sweep / stop-hunt phase — avoid instant news execution and wait for rejection or MSS confirmation.'
      )
    );
  } else if (isAutoAmdSweepPhase) {
    antiSweepReasons.push(
      amdPhaseUpper === 'MANIPULATION'
        ? tr(
            `Teknikal AMD Gatekeeper (${amdState?.phase}): Pasar terdeteksi sedang melakukan sapuan likuiditas / stop-hunt — hindari instant entry saat detik rilis dan tunggu konfirmasi MSS.`,
            `AMD Gatekeeper Technical (${amdState?.phase}): Market is actively sweeping liquidity / stop-hunting — avoid instant release execution and wait for MSS confirmation.`
          )
        : tr(
            `Teknikal AMD Gatekeeper (${amdState?.phase}): Rentang sesi terkompresi membangun likuiditas BSL/SSL — rilis berita berpotensi tinggi memicu spike/sweep manipulasi lebih dulu.`,
            `AMD Gatekeeper Technical (${amdState?.phase}): Compressed session box building BSL/SSL liquidity — news release carries high risk of an initial manipulation sweep.`
          )
    );
  }
  if (isExhaustionSell && gold3dChangePct !== null) {
    antiSweepReasons.push(
      tr(
        `Exhaustion GC=F 3D (${gold3dChangePct.toFixed(2)}% ≤ -2.5%): Posisi jual sudah jenuh, rawan short-squeeze ke atas lebih dulu sebelum turun.`,
        `GC=F 3D Exhaustion (${gold3dChangePct.toFixed(2)}% ≤ -2.5%): Crowded short positioning, prone to an upward short-squeeze first before dropping.`
      )
    );
  }
  if (isExhaustionBuy && gold3dChangePct !== null) {
    antiSweepReasons.push(
      tr(
        `Exhaustion GC=F 3D (+${gold3dChangePct.toFixed(2)}% ≥ +2.5%): Posisi beli sudah jenuh, rawan long-liquidation ke bawah lebih dulu sebelum naik.`,
        `GC=F 3D Exhaustion (+${gold3dChangePct.toFixed(2)}% ≥ +2.5%): Crowded long positioning, prone to a downward long-liquidation first before rallying.`
      )
    );
  }
  if (isWideConsensusDeviation) {
    antiSweepReasons.push(
      tr(
        'Deviasi Konsensus Lebar: Ekspektasi pasar sudah timpang terhadap Previous, rawan memicu whipsaw / spike 2 arah di detik rilis.',
        'Wide Consensus Deviation: Market consensus is heavily skewed vs Previous, prone to triggering a 2-way whipsaw spike at release.'
      )
    );
  }
  if (isDxyUpYieldDown && dxyChangePct !== null && us02yChangePct !== null) {
    antiSweepReasons.push(
      tr(
        `Divergensi Intermarket: DXY naik +${dxyChangePct.toFixed(2)}% sementara US02Y Yield turun ${us02yChangePct.toFixed(2)}% (arus lintas aset berlawanan).`,
        `Intermarket Divergence: DXY up +${dxyChangePct.toFixed(2)}% while US02Y Yield down ${us02yChangePct.toFixed(2)}% (conflicting cross-asset flows).`
      )
    );
  } else if (isDxyDownYieldUp && dxyChangePct !== null && us02yChangePct !== null) {
    antiSweepReasons.push(
      tr(
        `Divergensi Intermarket: DXY turun ${dxyChangePct.toFixed(2)}% sementara US02Y Yield naik +${us02yChangePct.toFixed(2)}% (arus lintas aset berlawanan).`,
        `Intermarket Divergence: DXY down ${dxyChangePct.toFixed(2)}% while US02Y Yield up +${us02yChangePct.toFixed(2)}% (conflicting cross-asset flows).`
      )
    );
  }

  const antiSweepVerb =
    activeMatrix.dominantBias === 'BUY'
      ? 'BUY'
      : activeMatrix.dominantBias === 'SELL'
      ? 'SELL'
      : 'BUY/SELL';

  const dominantColorClass =
    activeMatrix.dominantBias === 'BUY'
      ? 'text-[#059669] dark:text-[#00A878]'
      : activeMatrix.dominantBias === 'SELL'
      ? 'text-[#E11D48] dark:text-[#E05260]'
      : 'text-[#151D2A] dark:text-[#F2F4F7]';

  const dominantProbability =
    activeMatrix.dominantBias === 'BUY'
      ? activeMatrix.buyProbability
      : activeMatrix.dominantBias === 'SELL'
      ? activeMatrix.sellProbability
      : activeMatrix.mixedProbability;

  const actionPlanLines = (isEn ? activeMatrix.actionPlanEn : activeMatrix.actionPlanId)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const manualAmdOptionMeta = MANUAL_AMD_OVERRIDE_OPTIONS.find((o) => o.id === manualAmdOverride);
  const sessionLabelForAmd = amdState
    ? `${getSessionLabelId(amdState.currentSession)} (${formatSessionWindowWib(
        amdState.currentSession,
        sessionConfig
      )})`
    : undefined;

  const candles1h = confluenceData.candlesByTf['1h'] || [];
  let candleMove6hUsd: number | undefined = goldPosData?.change6hUsd;
  if (candles1h.length >= 7) {
    const latestClose = candles1h[candles1h.length - 1]?.close;
    const close6hAgo = candles1h[candles1h.length - 7]?.close;
    if (Number.isFinite(latestClose) && Number.isFinite(close6hAgo) && close6hAgo > 0) {
      candleMove6hUsd = Number((latestClose - close6hAgo).toFixed(2));
    }
  }

  const prelimDualHorizon = computeDualHorizonAnalysis({
    breakingNews: contextualBreakingNews,
    goldPositioning: goldPosData,
    dominantBias: activeMatrix.dominantBias,
    buyProbability: activeMatrix.buyProbability,
    sellProbability: activeMatrix.sellProbability,
    mixedProbability: activeMatrix.mixedProbability,
    cmeFedWatch: activeFedWatch,
    dxy: snapshot.intermarketPulse.dxy,
    us02y: snapshot.intermarketPulse.us02y,
    us10y: snapshot.intermarketPulse.us10y,
    primaryEvent: primaryEv,
    isSimultaneousRelease: activeMatrix.isSimultaneousRelease,
    simultaneousAlignment: activeMatrix.simultaneousAlignment,
    amdContext: {
      phase: hasConfluenceCandles ? amdState?.phase : undefined,
      gatekeeperStatus: hasConfluenceCandles ? amdState?.gatekeeperStatus : undefined,
      manualOverrideMode: manualAmdOverride,
      isManualOverride: manualAmdOverride !== 'AUTO',
      currentSessionLabel: sessionLabelForAmd,
    },
    calendarEvents: snapshot.calendarEvents,
    intradayContext: {
      change6hUsd: candleMove6hUsd,
      atr14_1h: goldPosData?.atr14_1h,
    },
  });

  const spikeTargetMap = computeIntradaySpikeTargetMap({
    candlesByTf: confluenceData.candlesByTf,
    livePrice: confluenceData.livePrice,
    sessionConfig,
    initialCatalystBias: prelimDualHorizon.initialCatalystBias,
    sessionPrimaryBias: prelimDualHorizon.sessionPrimaryBias,
    amdState,
  });

  const dualHorizon = computeDualHorizonAnalysis({
    breakingNews: contextualBreakingNews,
    goldPositioning: goldPosData,
    dominantBias: activeMatrix.dominantBias,
    buyProbability: activeMatrix.buyProbability,
    sellProbability: activeMatrix.sellProbability,
    mixedProbability: activeMatrix.mixedProbability,
    cmeFedWatch: activeFedWatch,
    dxy: snapshot.intermarketPulse.dxy,
    us02y: snapshot.intermarketPulse.us02y,
    us10y: snapshot.intermarketPulse.us10y,
    primaryEvent: primaryEv,
    isSimultaneousRelease: activeMatrix.isSimultaneousRelease,
    simultaneousAlignment: activeMatrix.simultaneousAlignment,
    amdContext: {
      phase: hasConfluenceCandles ? amdState?.phase : undefined,
      gatekeeperStatus: hasConfluenceCandles ? amdState?.gatekeeperStatus : undefined,
      manualOverrideMode: manualAmdOverride,
      isManualOverride: manualAmdOverride !== 'AUTO',
      currentSessionLabel: sessionLabelForAmd,
    },
    calendarEvents: snapshot.calendarEvents,
    intradayContext: {
      change6hUsd: candleMove6hUsd,
      atr14_1h: spikeTargetMap.hasValidData ? spikeTargetMap.atr14_1h : goldPosData?.atr14_1h,
      bslPrice: spikeTargetMap.hasValidData ? spikeTargetMap.bslPrice : undefined,
      sslPrice: spikeTargetMap.hasValidData ? spikeTargetMap.sslPrice : undefined,
      poiLow: spikeTargetMap.hasValidData ? spikeTargetMap.layer1FvgOte.low : undefined,
      poiHigh: spikeTargetMap.hasValidData ? spikeTargetMap.layer1FvgOte.high : undefined,
      macro4hPdZone: spikeTargetMap.macro4hPdZone,
    },
  });

  if (dualHorizon.hasSpeechEvent && (isEn ? dualHorizon.speechAlertNoteEn : dualHorizon.speechAlertNoteId)) {
    const note = (isEn ? dualHorizon.speechAlertNoteEn : dualHorizon.speechAlertNoteId)!;
    if (!antiSweepReasons.includes(note)) {
      antiSweepReasons.unshift(note);
    }
  }
  if (dualHorizon.isPricedIn && (isEn ? dualHorizon.pricedInNoteEn : dualHorizon.pricedInNoteId)) {
    const note = (isEn ? dualHorizon.pricedInNoteEn : dualHorizon.pricedInNoteId)!;
    if (!antiSweepReasons.includes(note)) {
      antiSweepReasons.unshift(note);
    }
  }

  const effectiveRssHealth: RssFeedHealthStatus = liveRssFeedHealth ||
    snapshot.rssFeedHealth || {
      activeCount: contextualBreakingNews.length > 0 ? 4 : 0,
      totalCount: 4,
      sources: [
        { id: 'FINANCIAL_JUICE', name: 'FinancialJuice', active: true, itemCount: 0 },
        { id: 'CNBC', name: 'CNBC Fed/Econ', active: true, itemCount: 0 },
        { id: 'MARKETWATCH', name: 'MarketWatch', active: true, itemCount: 0 },
        { id: 'FXSTREET', name: 'FXStreet', active: true, itemCount: 0 },
      ],
      updatedAt: snapshot.analyzedAt || new Date().toISOString(),
    };

  const wireBreadth = {
    bullish: contextualBreakingNews.filter((h) => h.sentimentForGold === 'BULLISH').length,
    bearish: contextualBreakingNews.filter((h) => h.sentimentForGold === 'BEARISH').length,
    neutral: contextualBreakingNews.filter((h) => h.sentimentForGold === 'NEUTRAL').length,
    total: contextualBreakingNews.length,
  };

  // Strip redundant dominant bias percentage repetition from thesis & conclusion strings
  const stripBiasRepetition = (raw: string): string => {
    if (!raw) return '';
    return raw
      .replace(/\b(BUY|SELL|MIXED)\s+\d{1,3}%/gi, '$1')
      .replace(/\(\s*\d{1,3}%\s*\)/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  };

  const conciseExecutionPoints: Array<{ title: string; body: string; tone?: 'normal' | 'warning' }> = [
    {
      title: isSelectedPrimaryReleased
        ? tr('1. Validasi Pasca-Rilis (Post-News)', '1. Post-News Release Validation')
        : tr('1. Protokol Timing & Struktur (T-5M → +3M)', '1. Timing & Structure Protocol (T-5M → +3M)'),
      body: isSelectedPrimaryReleased
        ? clusterHasAnyActual
          ? tr(
              'Angka Actual telah rilis — tunggu candle M1/M5 menyelesaikan sapuan likuiditas awal, lalu konfirmasi Higher Low (untuk BUY) atau Lower High (untuk SELL) sebelum eksekusi.',
              'Actual figures are out — wait for M1/M5 candles to finish the initial liquidity sweep, then confirm a Higher Low (for BUY) or Lower High (for SELL) before entry.'
            )
          : tr(
              'Jadwal rilis telah lewat namun angka Actual sedang disinkronkan. Tahan entry hingga selisih Actual vs Forecast terkonfirmasi.',
              'Release time has passed while Actual figures are syncing. Hold entry until Actual vs Forecast deviation is confirmed.'
            )
        : stripBiasRepetition(isEn ? t5TacticEn : t5TacticId),
      tone: 'normal',
    },
    {
      title: tr('2. Mitigasi Whipsaw & Likuiditas', '2. Whipsaw & Liquidity Mitigation'),
      body: stripBiasRepetition(
        (isEn ? activeMatrix.whipsawWarningEn : activeMatrix.whipsawWarningId) ||
          (dualHorizon.movementType === 'TWO_WAY_SWEEP_FIRST'
            ? isEn
              ? dualHorizon.movementSummaryEn
              : dualHorizon.movementSummaryId
            : tr(
                'Hindari market order di detik 00:00 saat spread melebar; gunakan limit/stop terukur setelah struktur M5 tervalidasi.',
                'Avoid market orders at 00:00 when spreads widen; use measured orders after M5 structure validates.'
              ))
      ),
      tone:
        dualHorizon.movementType === 'TWO_WAY_SWEEP_FIRST' || Boolean(activeMatrix.whipsawWarningId)
          ? 'warning'
          : 'normal',
    },
    {
      title: tr('3. Eksekusi & Manajemen Risiko', '3. Execution & Risk Management'),
      body:
        actionPlanLines
          .slice(0, 2)
          .map((l) => stripBiasRepetition(l.replace(/^\d+[\).\s-]*/, '')))
          .join(' ') ||
        tr(
          'Batasi risiko maksimal 0.5%–1.0% ekuitas per transaksi dan tempatkan Stop Loss di luar ekor spike M5.',
          'Cap risk at 0.5%–1.0% equity per trade and place Stop Loss beyond the M5 spike wick.'
        ),
      tone: 'normal',
    },
  ];

  const conciseThesisPoints: Array<{ title: string; body: string }> = [
    {
      title: tr('1. Tesis Lintas Aset', '1. Cross-Asset Thesis'),
      body: stripBiasRepetition(
        (isEn
          ? activeMatrix.institutionalDeskThesisEn || activeMatrix.finalTakeEn
          : activeMatrix.institutionalDeskThesisId || activeMatrix.finalTakeId) || ''
      ),
    },
    {
      title: tr('2. Kesimpulan Fundamental Utama', '2. Core Fundamental Driver'),
      body: stripBiasRepetition((isEn ? activeMatrix.finalTakeEn : activeMatrix.finalTakeId) || ''),
    },
    {
      title: tr('3. Keseimbangan 3 Pilar FOMC', '3. 3-Pillar FOMC Balance'),
      body: activeMatrix.fomcPillarRecap
        ? `${tr('Inflasi', 'Inflation')}: ${activeMatrix.fomcPillarRecap.inflationPillarBias} · ${tr(
            'Tenaga Kerja',
            'Labor'
          )}: ${activeMatrix.fomcPillarRecap.laborPillarBias} · ${tr('Pertumbuhan', 'Growth')}: ${
            activeMatrix.fomcPillarRecap.growthPillarBias
          }. ${
            isEn
              ? activeMatrix.fomcPillarRecap.inflationPillarSummaryEn
              : activeMatrix.fomcPillarRecap.inflationPillarSummaryId
          }`
        : isEn
        ? dualHorizon.sessionPrimaryReasonEn
        : dualHorizon.sessionPrimaryReasonId,
    },
  ];

  const toggleExpandedEvent = (evId: string) => {
    setExpandedCalendarEventIds((prev) => ({ ...prev, [evId]: !prev[evId] }));
  };

  return (
    <div
      data-testid="macro-news-view"
      className="space-y-6 pb-10 text-[#151D2A] dark:text-[#F2F4F7] font-sans transition-colors duration-150"
    >
      {/* SECTION 01 — HEADER & INLINE STATUS (DIRECT ON CANVAS) */}
      <div className="space-y-3 pb-5 border-b border-[#DDE3EA] dark:border-[#20252D]">
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-[#DDE3EA] dark:border-[#20252D]">
          <div className="min-w-0">
            <h1 className="text-xs font-bold uppercase tracking-[0.12em] text-[#151D2A] dark:text-[#F2F4F7] truncate">
              {tr('TRADE NEWS · XAU/USD', 'TRADE NEWS · XAU/USD')}
            </h1>
            <p className="text-[11px] text-[#697586] dark:text-[#929BA9] font-mono-numbers tabular-nums truncate mt-0.5">
              {isInAdaptiveFastWindow
                ? tr('Sync Cepat: 60d (Jendela Rilis)', 'Fast Sync: 60s (Release Window)')
                : tr('Sync Otomatis: 5m · Multi-RSS', 'Auto-Sync: 5m · Multi-RSS')}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowPlaybookGuide(true)}
              className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] hover:border-black/25 dark:hover:border-white/25 text-xs font-semibold text-[#151D2A] dark:text-[#F2F4F7] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Info className="w-3.5 h-3.5 stroke-[1.75] text-[#697586] dark:text-[#929BA9]" />
              <span>{tr('Playbook', 'Playbook')}</span>
            </button>

            <button
              type="button"
              onClick={() => void runLiveAnalysis(true, snapshot, selectedEventId || undefined)}
              disabled={isRefreshing}
              className="min-h-[36px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#151D2A] dark:bg-white text-white dark:text-[#050607] hover:opacity-90 text-xs font-semibold transition-opacity disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 stroke-[2] ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>
                {isRefreshing
                  ? refreshStepMessage || tr('Sinkronisasi...', 'Syncing...')
                  : tr('Analisis Live', 'Live Sync')}
              </span>
            </button>
          </div>
        </div>

        {/* Unboxed Monochrome Status & Headline Strip */}
        <section
          aria-label={tr('Status Feed & Konteks Pasar', 'Feed Status & Market Context')}
          data-testid="macro-compact-top-status-card"
          className="space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono-numbers tabular-nums">
            <div className="flex flex-wrap items-center gap-2 text-[#697586] dark:text-[#929BA9]">
              <span
                data-testid="macro-projection-status-badge"
                className={`font-sans font-bold text-[11px] uppercase tracking-wider ${
                  isSelectedPrimaryReleased
                    ? 'text-[#1769E8] dark:text-[#3478DC]'
                    : 'text-[#E11D48] dark:text-[#E05260]'
                }`}
              >
                {isSelectedPrimaryReleased
                  ? clusterHasAnyActual
                    ? 'POST-NEWS'
                    : tr('MENUNGGU ACTUAL', 'PENDING ACTUAL')
                  : lockInfo.isLockedT5M
                  ? 'PRE-NEWS LOCK (T-5M)'
                  : 'PRE-NEWS'}
              </span>

              <span aria-hidden="true">·</span>

              <span
                data-testid="macro-market-hours-badge"
                className={`font-sans font-semibold text-[11px] uppercase tracking-wider ${
                  confluenceData.isMarketOpen
                    ? 'text-[#059669] dark:text-[#00A878]'
                    : 'text-[#D97706] dark:text-[#F59E0B]'
                }`}
              >
                {confluenceData.isMarketOpen
                  ? tr('LIVE (SENIN–JUMAT)', 'LIVE (MON–FRI)')
                  : tr('PASAR TUTUP (SABTU–MINGGU · DATA JUMAT)', 'MARKET CLOSED (SAT–SUN · FRI CLOSE)')}
              </span>

              <span aria-hidden="true">·</span>

              <span
                data-testid="macro-rss-feed-health-badge"
                title={effectiveRssHealth.sources
                  .map((s) => `${s.name}: ${s.active ? `Aktif (${s.itemCount})` : 'Off'}`)
                  .join(' · ')}
                className="text-[11px] font-medium"
              >
                {effectiveRssHealth.activeCount}/{effectiveRssHealth.totalCount}{' '}
                {tr('Feed Aktif', 'Feeds Active')} · {tr('Update', 'Updated')}{' '}
                {formatLiveUpdateClockWib(
                  effectiveRssHealth.updatedAt || snapshot.analyzedAt,
                  isEn ? 'en' : 'id'
                )}
              </span>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-[#697586] dark:text-[#929BA9]">
              <span
                data-testid="macro-market-sentiment-bar"
                className="font-mono-numbers tabular-nums"
              >
                RSS{' '}
                <span className="font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                  {wireBreadth.bullish}B
                </span>{' '}
                ·{' '}
                <span className="font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                  {wireBreadth.bearish}S
                </span>{' '}
                · <span>{wireBreadth.neutral}N</span>
              </span>
            </div>
          </div>

          {/* Top Breaking RSS Headline + Expandable Detail Toggles */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-[#DDE3EA] dark:border-[#20252D]">
            {topBreaking ? (
              <div className="min-w-0 flex-1 flex items-center gap-2 text-xs">
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-[#697586] dark:text-[#929BA9]">
                  {topBreaking.source}
                </span>
                <span className="text-[#697586] dark:text-[#929BA9]" aria-hidden="true">
                  ·
                </span>
                <p className="truncate font-medium text-[#151D2A] dark:text-[#F2F4F7]">
                  {topBreaking.title}
                </p>
              </div>
            ) : (
              <span className="text-xs text-[#697586] dark:text-[#929BA9]">
                {tr(
                  'Sumber RSS: FinancialJuice · CNBC · MarketWatch · FXStreet',
                  'RSS Sources: FinancialJuice · CNBC · MarketWatch · FXStreet'
                )}
              </span>
            )}

            <div
              data-testid="macro-supporting-context-section"
              className="flex items-center gap-3 shrink-0"
            >
              {snapshot.breakingNews.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAllHeadlines((prev) => !prev)}
                  className="min-h-[30px] inline-flex items-center gap-1 text-xs font-medium text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7] transition-colors cursor-pointer"
                >
                  <span>
                    {tr('Headline RSS', 'RSS')} ({snapshot.breakingNews.length})
                  </span>
                  {showAllHeadlines ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowFedSpeeches((prev) => !prev)}
                className="min-h-[30px] inline-flex items-center gap-1 text-xs font-medium text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7] transition-colors cursor-pointer"
              >
                <span>
                  {tr('Pidato Fed', 'Fed')} ({supportingContextEvents.length})
                </span>
                {showFedSpeeches ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          {!isLiveCalendar && (
            <div className="py-2 px-3 rounded-lg bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] text-xs text-[#151D2A] dark:text-[#F2F4F7]">
              {tr(
                'Koneksi Kalender Live Gagal — Tekan Analisis Live untuk menyegarkan.',
                'Live Calendar Connection Failed — Tap Live Sync to refresh.'
              )}
            </div>
          )}

          {supabaseFeedback && (
            <div
              data-testid="macro-supabase-feedback-banner"
              className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] text-xs text-[#697586] dark:text-[#929BA9]"
            >
              <span className="leading-snug">{supabaseFeedback.message}</span>
              <button
                type="button"
                onClick={() => setSupabaseFeedback(null)}
                className="px-2 py-0.5 text-xs font-semibold text-[#151D2A] dark:text-[#F2F4F7] shrink-0 cursor-pointer"
              >
                {tr('Tutup', 'Dismiss')}
              </button>
            </div>
          )}

          {/* Expandable RSS News Detail Panel */}
          {showAllHeadlines && contextualBreakingNews.length > 0 && (
            <div className="pt-2 border-t border-[#DDE3EA] dark:border-[#20252D] divide-y divide-[#DDE3EA] dark:divide-[#20252D] max-h-72 overflow-y-auto">
              {contextualBreakingNews.map((item) => (
                <div key={item.id} className="py-2.5 space-y-1">
                  <div className="flex items-center justify-between gap-2 text-[11px] font-mono-numbers tabular-nums">
                    <span className="text-[#697586] dark:text-[#929BA9]">
                      {item.source} · {formatTimestampWib(item.pubDate, isEn ? 'en' : 'id')}
                    </span>
                    <span
                      className={`font-semibold shrink-0 ${
                        item.sentimentForGold === 'BULLISH'
                          ? 'text-[#059669] dark:text-[#00A878]'
                          : item.sentimentForGold === 'BEARISH'
                          ? 'text-[#E11D48] dark:text-[#E05260]'
                          : 'text-[#697586] dark:text-[#929BA9]'
                      }`}
                    >
                      {item.sentimentForGold} XAU
                    </span>
                  </div>
                  <p className="text-xs font-medium text-[#151D2A] dark:text-[#F2F4F7] leading-snug">
                    {item.title}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Expandable Fed Context Panel */}
          {showFedSpeeches && (
            <div className="pt-2 border-t border-[#DDE3EA] dark:border-[#20252D] divide-y divide-[#DDE3EA] dark:divide-[#20252D]">
              {supportingContextEvents.length === 0 ? (
                <p className="py-2 text-xs text-[#697586] dark:text-[#929BA9]">
                  {tr(
                    'Belum ada jadwal pidato pejabat Fed atau rilis pendukung pada jendela waktu saat ini.',
                    'No Fed official speeches or supporting releases in the current window.'
                  )}
                </p>
              ) : (
                supportingContextEvents.map((ev) => (
                  <div key={ev.id} className="py-2.5 flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-0.5">
                      <span className="text-[11px] font-mono-numbers tabular-nums text-[#697586] dark:text-[#929BA9] block">
                        {formatTimestampWib(ev.date, isEn ? 'en' : 'id')} ·{' '}
                        {isFedSpeechEvent(ev.title) ? tr('Pidato Fed', 'Fed Speech') : tr('Konteks', 'Context')}
                      </span>
                      <p className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                        {ev.title}
                      </p>
                    </div>
                    <div className="text-right font-mono-numbers tabular-nums text-xs text-[#151D2A] dark:text-[#F2F4F7] shrink-0">
                      {ev.previous !== '-' || ev.forecast !== '-' ? (
                        <span>
                          Prev {ev.previous || '-'} · Fcst {ev.forecast || '-'}
                        </span>
                      ) : (
                        <span className="text-[#697586] dark:text-[#929BA9]">{ev.eventBiasForGold}</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </section>
      </div>

      {/* SECTION 02 — DOMINANT BIAS, ANTI-SWEEP PROTOCOL, POST-NEWS CONFIRMATION & TWO-HORIZON ANALYSIS */}
      <section
        aria-label={tr('Bias Dominan', 'Dominant Bias')}
        className="space-y-5 pb-6 border-b border-[#DDE3EA] dark:border-[#20252D]"
      >
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#697586] dark:text-[#929BA9]">
              {tr('BIAS DOMINAN', 'DOMINANT BIAS')}
            </h2>

            <span className="text-[#697586] dark:text-[#929BA9]" aria-hidden="true">
              ·
            </span>

            <span
              data-testid="macro-top-movement-status-badge"
              className="inline-flex items-center px-2 py-0.5 rounded bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] text-[10px] font-semibold uppercase tracking-wider font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F4F7]"
            >
              {isEn ? dualHorizon.movementBadgeEn : dualHorizon.movementBadgeId}
            </span>

            {dualHorizon.isPricedIn && (
              <span
                data-testid="macro-priced-in-badge"
                className="inline-flex items-center px-2 py-0.5 rounded bg-[#F5F7FA] dark:bg-[#101318] border border-[#D97706]/35 dark:border-[#F59E0B]/35 text-[10px] font-semibold uppercase tracking-wider font-mono-numbers tabular-nums text-[#D97706] dark:text-[#F59E0B]"
              >
                PRICED-IN 6H ({dualHorizon.move6hUsd >= 0 ? '+' : ''}${dualHorizon.move6hUsd.toFixed(1)})
              </span>
            )}

            {dualHorizon.hasSpeechEvent && (
              <span
                data-testid="macro-speech-event-badge"
                className="inline-flex items-center px-2 py-0.5 rounded bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] text-[10px] font-semibold uppercase tracking-wider font-mono-numbers tabular-nums text-[#697586] dark:text-[#929BA9]"
              >
                SPEECH / FOMC WINDOW
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowTargetSelector(true)}
            className="min-h-[32px] inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] hover:border-black/25 dark:hover:border-white/25 text-xs font-semibold text-[#151D2A] dark:text-[#F2F4F7] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>
              {tr('Target Rilis (14H)', 'Target Release (14D)')} · {allEventGroups.length}
            </span>
            <ChevronDown className="w-3.5 h-3.5 stroke-[2] text-[#697586] dark:text-[#929BA9]" />
          </button>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
          <div className="space-y-3.5 min-w-0 flex-1">
            <div className="space-y-1">
              <p className="text-xs sm:text-sm font-medium text-[#151D2A] dark:text-[#F2F4F7] leading-snug">
                {activeClusterTitles}
              </p>
              <p className="text-xs text-[#697586] dark:text-[#929BA9] font-mono-numbers tabular-nums">
                {formatTimestampWib(primaryEv.date, isEn ? 'en' : 'id')}{' '}
                <span className="font-sans">
                  ·{' '}
                  {simultaneousCount > 1
                    ? tr(`${simultaneousCount} Rilis Bersamaan`, `${simultaneousCount} Simultaneous Releases`)
                    : pillarBadgeLabel(primaryEv.pillar)}
                </span>
              </p>
            </div>

            <div className="space-y-2.5 max-w-xl">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <span
                  className={`text-3xl sm:text-4xl font-bold tracking-tight font-mono-numbers tabular-nums ${dominantColorClass}`}
                >
                  {activeMatrix.dominantBias} {dominantProbability}%
                </span>

                {activeMatrix.dynamicPivotTriggered && (
                  <span
                    className={`text-xs font-bold uppercase tracking-wider ${
                      activeMatrix.dominantBias === 'BUY'
                        ? 'text-[#059669] dark:text-[#00A878]'
                        : 'text-[#E11D48] dark:text-[#E05260]'
                    }`}
                  >
                    · {tr('PINDAH HALUAN', 'PIVOT OVERRIDE')}
                  </span>
                )}
              </div>

              {/* Probability Distribution Bar (Buy: Blue, Mixed: Grey, Sell: Red) */}
              <div className="space-y-1.5">
                <div className="h-1.5 w-full rounded-full overflow-hidden flex bg-[#EEF2F6] dark:bg-[#161A22]">
                  <div
                    style={{ width: `${activeMatrix.buyProbability}%` }}
                    className="bg-[#1769E8] dark:bg-[#3478DC] transition-all duration-200"
                  />
                  <div
                    style={{ width: `${activeMatrix.mixedProbability}%` }}
                    className="bg-[#CBD5E1] dark:bg-[#3A4250] transition-all duration-200"
                  />
                  <div
                    style={{ width: `${activeMatrix.sellProbability}%` }}
                    className="bg-[#E11D48] dark:bg-[#E05260] transition-all duration-200"
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] font-mono-numbers tabular-nums">
                  <span className="font-semibold text-[#1769E8] dark:text-[#3478DC]">
                    BUY {activeMatrix.buyProbability}%
                  </span>
                  <span className="font-semibold text-[#697586] dark:text-[#929BA9]">
                    MIXED {activeMatrix.mixedProbability}%
                  </span>
                  <span className="font-semibold text-[#E11D48] dark:text-[#E05260]">
                    SELL {activeMatrix.sellProbability}%
                  </span>
                </div>
              </div>

              {/* 1. Micro-Copy Penahan Ekspektasi */}
              <p
                data-testid="macro-bias-expectation-microcopy"
                className="text-xs text-[#697586] dark:text-[#929BA9] leading-relaxed"
              >
                {tr(
                  'Probabilitas arah hasil sesi setelah volatilitas awal mereda — bukan arah candle detik ke-0.',
                  'Session outcome directional probability after initial volatility settles — not the 0-second candle direction.'
                )}
              </p>
            </div>

            {/* 2. PROTOKOL ANTI-SWEEP (TradeVault Warning Standard) */}
            {antiSweepReasons.length > 0 ? (
              <div
                data-testid="macro-anti-sweep-alert"
                className="rounded-lg bg-[#F5F7FA] dark:bg-[#101318] border border-[#D97706]/35 dark:border-[#F59E0B]/35 px-3.5 py-2.5 space-y-1.5"
              >
                <div className="flex items-center gap-2 text-xs font-bold tracking-wide text-[#D97706] dark:text-[#F59E0B]">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-[#D97706] dark:text-[#F59E0B]" />
                  <span>
                    {tr(
                      `PROTOKOL ANTI-SWEEP: JANGAN INSTANT ${antiSweepVerb} DI DETIK KE-0`,
                      `ANTI-SWEEP PROTOCOL: DO NOT INSTANT ${antiSweepVerb} AT SECOND 0`
                    )}
                  </span>
                </div>
                <ul className="space-y-1.5 text-xs text-[#697586] dark:text-[#929BA9] leading-relaxed">
                  {antiSweepReasons.map((reason, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="font-mono-numbers shrink-0 text-[#D97706] dark:text-[#F59E0B]" aria-hidden="true">
                        —
                      </span>
                      <span className="text-[#151D2A] dark:text-[#F2F4F7]">{reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              activeMatrix.preNewsFlow &&
              (activeMatrix.preNewsFlow.fomcBlackoutActive ||
                activeMatrix.preNewsFlow.consensusTightness === 'TIGHT' ||
                (activeMatrix.preNewsFlow.goldPositioning?.isAvailable &&
                  activeMatrix.preNewsFlow.goldPositioning.state !== 'NEUTRAL')) && (
                <p
                  data-testid="macro-prenews-meta-line"
                  className="text-xs text-[#697586] dark:text-[#929BA9] leading-snug"
                >
                  {[
                    activeMatrix.preNewsFlow.fomcBlackoutActive
                      ? tr('FOMC Blackout Aktif', 'FOMC Blackout Active')
                      : null,
                    activeMatrix.preNewsFlow.consensusTightness === 'TIGHT'
                      ? tr('Konsensus Ketat (Rawan Whipsaw)', 'Tight Consensus (Whipsaw Risk)')
                      : null,
                    activeMatrix.preNewsFlow.goldPositioning?.isAvailable &&
                    activeMatrix.preNewsFlow.goldPositioning.state === 'CROWDED_HIGH'
                      ? tr(
                          `GC=F 3D Crowded Long (+${activeMatrix.preNewsFlow.goldPositioning.change3dPercent.toFixed(2)}%)`,
                          `GC=F 3D Crowded Long (+${activeMatrix.preNewsFlow.goldPositioning.change3dPercent.toFixed(2)}%)`
                        )
                      : activeMatrix.preNewsFlow.goldPositioning?.isAvailable &&
                        activeMatrix.preNewsFlow.goldPositioning.state === 'OVERSOLD_LOW'
                      ? tr(
                          `GC=F 3D Oversold (${activeMatrix.preNewsFlow.goldPositioning.change3dPercent.toFixed(2)}%)`,
                          `GC=F 3D Oversold (${activeMatrix.preNewsFlow.goldPositioning.change3dPercent.toFixed(2)}%)`
                        )
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )
            )}
          </div>

          {/* 3. Unboxed 3-Phase Release Timer Column */}
          <div
            data-testid="macro-release-phase-timer"
            className="lg:w-[290px] sm:text-right shrink-0 pt-4 lg:pt-0 border-t lg:border-t-0 lg:border-l border-[#DDE3EA] dark:border-[#20252D] lg:pl-6 space-y-1.5"
          >
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] block text-[#697586] dark:text-[#929BA9]">
              {releaseTimerPhase === 'PHASE_2_SPIKE_ZONE'
                ? tr('ZONA RAWAN SPIKE · TAHAN ENTRY', 'SPIKE RISK ZONE · HOLD ENTRY')
                : releaseTimerPhase === 'PHASE_3_SWEEP'
                ? tr('FASE LIQUIDITY SWEEP (0–3 MENIT)', 'LIQUIDITY SWEEP PHASE (0–3 MIN)')
                : releaseTimerPhase === 'PHASE_4_CONFIRM'
                ? tr('FASE KONFIRMASI PASCA-SPIKE', 'POST-SPIKE CONFIRMATION PHASE')
                : tr('MENUJU RILIS', 'COUNTDOWN')}
            </span>

            <span
              className={`text-2xl sm:text-3xl font-bold font-mono-numbers tabular-nums block ${
                isSelectedPrimaryReleased
                  ? 'text-[#1769E8] dark:text-[#3478DC]'
                  : 'text-[#E11D48] dark:text-[#E05260]'
              }`}
            >
              {releaseTimerDisplayValue}
            </span>

            {lockInfo.isLockedT5M && !isSelectedPrimaryReleased && (
              <span className="text-[11px] font-semibold text-[#151D2A] dark:text-[#F2F4F7] block">
                {tr('T-5M Final Lock Aktif', 'T-5M Final Lock Active')}
              </span>
            )}

            {releaseTimerPhase === 'PHASE_2_SPIKE_ZONE' && (
              <p className="text-[11px] text-[#697586] dark:text-[#929BA9] leading-snug">
                {tr(
                  'Hindari pending order terlalu dekat dengan harga berjalan karena spread melebar.',
                  'Avoid placing pending orders too close to current price due to widening spread.'
                )}
              </p>
            )}

            {releaseTimerPhase === 'PHASE_3_SWEEP' && (
              <p className="text-[11px] text-[#697586] dark:text-[#929BA9] leading-snug">
                {tr(
                  'Dilarang instant entry — tunggu spike selesai menyapu likuiditas high/low terlebih dahulu.',
                  'No instant entry — wait for the spike to finish sweeping high/low liquidity first.'
                )}
              </p>
            )}

            {releaseTimerPhase === 'PHASE_4_CONFIRM' && (
              <p className="text-[11px] text-[#697586] dark:text-[#929BA9] leading-snug">
                {activeMatrix.dominantBias === 'SELL'
                  ? tr(
                      'Validasi pembentukan Lower High di bawah puncak spike sebelum entry SELL.',
                      'Validate a Lower High below the spike peak before entering SELL.'
                    )
                  : activeMatrix.dominantBias === 'BUY'
                  ? tr(
                      'Validasi pembentukan Higher Low di atas dasar spike sebelum entry BUY.',
                      'Validate a Higher Low above the spike low before entering BUY.'
                    )
                  : tr(
                      'Validasi Lower High (untuk SELL) atau Higher Low (untuk BUY) di bawah/atas puncak spike sebelum entry.',
                      'Validate a Lower High (for SELL) or Higher Low (for BUY) below/above the spike extreme before entry.'
                    )}
              </p>
            )}
          </div>
        </div>

        {/* Seamless Two-Horizon Analysis */}
        <div
          data-testid="macro-dual-horizon-box"
          className="pt-4 border-t border-[#DDE3EA] dark:border-[#20252D] space-y-3.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#697586] dark:text-[#929BA9]">
              {tr('PEMISAHAN 2 HORIZON ANALISIS', 'DUAL-HORIZON ANALYSIS')}
            </span>

            {manualAmdOverride !== 'AUTO' && manualAmdOptionMeta ? (
              <span
                data-testid="macro-synced-amd-override-badge"
                className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F4F7]"
              >
                <Lock className="w-3 h-3 stroke-[2]" />
                <span>
                  {tr('AMD MANUAL:', 'AMD MANUAL:')}{' '}
                  {isEn ? manualAmdOptionMeta.labelEn : manualAmdOptionMeta.labelId}
                </span>
              </span>
            ) : hasConfluenceCandles && amdState ? (
              <span
                data-testid="macro-auto-amd-status-badge"
                className="text-[10px] font-semibold uppercase tracking-wider font-mono-numbers tabular-nums text-[#697586] dark:text-[#929BA9]"
              >
                AMD ENGINE: {amdState.phase} · {amdState.gatekeeperStatus}
              </span>
            ) : null}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[#DDE3EA] dark:divide-[#20252D] border-y border-[#DDE3EA] dark:border-[#20252D]">
            {/* a) KATALIS AWAL / POTENSI SPIKE */}
            <div
              data-testid="macro-initial-catalyst-card"
              className="py-3 sm:pr-5 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#697586] dark:text-[#929BA9]">
                  {tr('KATALIS AWAL / POTENSI SPIKE', 'INITIAL CATALYST / SPIKE POTENTIAL')}
                </span>
                <span
                  className={`text-xs font-bold font-mono-numbers tabular-nums ${
                    dualHorizon.initialCatalystBias === 'BUY'
                      ? 'text-[#059669] dark:text-[#00A878]'
                      : dualHorizon.initialCatalystBias === 'SELL'
                      ? 'text-[#E11D48] dark:text-[#E05260]'
                      : 'text-[#151D2A] dark:text-[#F2F4F7]'
                  }`}
                >
                  {isEn ? dualHorizon.initialCatalystLabelEn : dualHorizon.initialCatalystLabelId}
                </span>
              </div>
              <p className="text-xs text-[#151D2A] dark:text-[#F2F4F7] leading-relaxed">
                {isEn ? dualHorizon.initialCatalystReasonEn : dualHorizon.initialCatalystReasonId}
              </p>
            </div>

            {/* b) BIAS UTAMA SESI (HASIL AKHIR) */}
            <div
              data-testid="macro-session-bias-card"
              className="py-3 sm:pl-5 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#697586] dark:text-[#929BA9]">
                  {tr('BIAS UTAMA SESI (HASIL AKHIR)', 'MAIN SESSION BIAS (FINAL OUTCOME)')}
                </span>
                <span
                  className={`text-xs font-bold font-mono-numbers tabular-nums ${
                    dualHorizon.sessionPrimaryBias === 'BUY'
                      ? 'text-[#059669] dark:text-[#00A878]'
                      : dualHorizon.sessionPrimaryBias === 'SELL'
                      ? 'text-[#E11D48] dark:text-[#E05260]'
                      : 'text-[#151D2A] dark:text-[#F2F4F7]'
                  }`}
                >
                  {dualHorizon.sessionPrimaryBias} {dualHorizon.sessionPrimaryProbability}%
                </span>
              </div>
              <p className="text-xs text-[#151D2A] dark:text-[#F2F4F7] leading-relaxed">
                {isEn ? dualHorizon.sessionPrimaryReasonEn : dualHorizon.sessionPrimaryReasonId}
              </p>
            </div>
          </div>

          <p className="text-xs text-[#697586] dark:text-[#929BA9] leading-relaxed">
            {isEn ? dualHorizon.movementSummaryEn : dualHorizon.movementSummaryId}
          </p>

          {/* 3. Peta Manipulasi & Target Spike (Collapsible Bridge to Cycle & Confluence) */}
          <div
            data-testid="macro-manipulation-map-box"
            className="rounded-lg bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] overflow-hidden"
          >
            <button
              type="button"
              data-testid="macro-manipulation-map-toggle"
              aria-expanded={showManipulationMap}
              onClick={() => setShowManipulationMap((prev) => !prev)}
              className="w-full min-h-[46px] px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#151D2A] dark:text-[#F2F4F7]">
                    {tr(
                      'PETA MANIPULASI & TARGET SPIKE',
                      'MANIPULATION MAP & SPIKE TARGETS'
                    )}
                  </span>
                  {hasConfluenceLevels && spikeTargetMap.hasValidData && (
                    <span
                      data-testid="macro-spike-overall-status-badge"
                      className={`text-[10px] font-mono-numbers tabular-nums font-bold uppercase tracking-wider ${
                        spikeTargetMap.spikeTracking.overallState === 'SWEPT'
                          ? 'text-[#059669] dark:text-[#00A878]'
                          : spikeTargetMap.spikeTracking.overallState === 'IN_ZONE'
                          ? 'text-[#D97706] dark:text-[#F59E0B]'
                          : 'text-[#697586] dark:text-[#929BA9]'
                      }`}
                    >
                      ·{' '}
                      {spikeTargetMap.spikeTracking.overallState === 'SWEPT'
                        ? tr('SUDAH TERSAPU (SIAP FASE 2)', 'SWEPT (READY PHASE 2)')
                        : spikeTargetMap.spikeTracking.overallState === 'IN_ZONE'
                        ? tr('DI ZONA POI / SEDANG DIUJI', 'IN POI ZONE / TESTING')
                        : tr('MENUNGGU SAPUAN', 'PENDING SWEEP')}
                    </span>
                  )}
                </div>
                <p className="text-xs font-mono-numbers tabular-nums text-[#697586] dark:text-[#929BA9] truncate">
                  {hasConfluenceLevels && spikeTargetMap.hasValidData
                    ? dualHorizon.initialCatalystBias === 'BUY' &&
                      dualHorizon.sessionPrimaryBias === 'SELL'
                      ? tr(
                          `Target Sapuan: BSL $${spikeTargetMap.bslPrice.toFixed(2)} → POI $${spikeTargetMap.layer1FvgOte.low.toFixed(2)}–$${spikeTargetMap.layer1FvgOte.high.toFixed(2)}`,
                          `Sweep Target: BSL $${spikeTargetMap.bslPrice.toFixed(2)} → POI $${spikeTargetMap.layer1FvgOte.low.toFixed(2)}–$${spikeTargetMap.layer1FvgOte.high.toFixed(2)}`
                        )
                      : dualHorizon.initialCatalystBias === 'SELL' &&
                        dualHorizon.sessionPrimaryBias === 'BUY'
                      ? tr(
                          `Target Sapuan: SSL $${spikeTargetMap.sslPrice.toFixed(2)} → POI $${spikeTargetMap.layer1FvgOte.low.toFixed(2)}–$${spikeTargetMap.layer1FvgOte.high.toFixed(2)}`,
                          `Sweep Target: SSL $${spikeTargetMap.sslPrice.toFixed(2)} → POI $${spikeTargetMap.layer1FvgOte.low.toFixed(2)}–$${spikeTargetMap.layer1FvgOte.high.toFixed(2)}`
                        )
                      : dualHorizon.sessionPrimaryBias === 'SELL'
                      ? tr(
                          `Target Sapuan: BSL $${spikeTargetMap.bslPrice.toFixed(2)} → POI $${spikeTargetMap.layer1FvgOte.low.toFixed(2)}–$${spikeTargetMap.layer1FvgOte.high.toFixed(2)}`,
                          `Sweep Target: BSL $${spikeTargetMap.bslPrice.toFixed(2)} → POI $${spikeTargetMap.layer1FvgOte.low.toFixed(2)}–$${spikeTargetMap.layer1FvgOte.high.toFixed(2)}`
                        )
                      : dualHorizon.sessionPrimaryBias === 'BUY'
                      ? tr(
                          `Target Sapuan: SSL $${spikeTargetMap.sslPrice.toFixed(2)} → POI $${spikeTargetMap.layer1FvgOte.low.toFixed(2)}–$${spikeTargetMap.layer1FvgOte.high.toFixed(2)}`,
                          `Sweep Target: SSL $${spikeTargetMap.sslPrice.toFixed(2)} → POI $${spikeTargetMap.layer1FvgOte.low.toFixed(2)}–$${spikeTargetMap.layer1FvgOte.high.toFixed(2)}`
                        )
                      : tr(
                          `Target Sapuan: BSL $${spikeTargetMap.bslPrice.toFixed(2)} / SSL $${spikeTargetMap.sslPrice.toFixed(2)}`,
                          `Sweep Target: BSL $${spikeTargetMap.bslPrice.toFixed(2)} / SSL $${spikeTargetMap.sslPrice.toFixed(2)}`
                        )
                    : confluenceData.isLoading || confluenceData.isRefreshing
                    ? tr(
                        'Target Sapuan: Menyinkronkan BSL/SSL XAU/USD...',
                        'Sweep Target: Syncing XAU/USD BSL/SSL...'
                      )
                    : tr(
                        'Target Sapuan: Ketuk untuk detail & sinkronisasi BSL/SSL',
                        'Sweep Target: Tap for details & BSL/SSL sync'
                      )}
                </p>
              </div>

              <ChevronDown
                className={`w-4 h-4 shrink-0 text-[#697586] dark:text-[#929BA9] transition-transform duration-300 ease-out ${
                  showManipulationMap ? 'rotate-180' : 'rotate-0'
                }`}
              />
            </button>

            <div
              className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
                showManipulationMap
                  ? 'grid-rows-[1fr] opacity-100'
                  : 'grid-rows-[0fr] opacity-0 pointer-events-none'
              }`}
            >
              <div className="overflow-hidden">
                <div className="px-4 pb-3.5 pt-3 border-t border-[#DDE3EA] dark:border-[#20252D] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#DDE3EA] dark:border-[#20252D]">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#697586] dark:text-[#929BA9]">
                      {tr('JEMBATAN CYCLE & CONFLUENCE', 'CYCLE & CONFLUENCE BRIDGE')}
                    </span>
                    <span className="text-[11px] font-mono-numbers tabular-nums font-semibold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F4F7]">
                      {hasConfluenceCandles && amdState
                        ? `${amdState.isManualOverride ? 'MANUAL LOCK · ' : 'AUTO · '}${amdState.phase} · ${amdState.gatekeeperStatus}`
                        : manualAmdOverride !== 'AUTO'
                        ? `MANUAL LOCK · ${manualAmdOverride}`
                        : tr('MENYINKRONKAN XAU/USD...', 'SYNCING XAU/USD...')}
                    </span>
                  </div>

                  {/* 1) Penyebab Spike / Status Keselarasan */}
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#697586] dark:text-[#929BA9] block">
                      {tr('1. Penyebab Spike & Deteksi Pra-Rilis', '1. Pre-Release Detection & Spike Triggers')}
                    </span>
                    {(dualHorizon.spikeTriggerReasonsId?.length ?? 0) > 0 ? (
                      <ul className="space-y-1 text-xs leading-relaxed">
                        {(isEn
                          ? dualHorizon.spikeTriggerReasonsEn
                          : dualHorizon.spikeTriggerReasonsId
                        )?.map((reason, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span
                              className="font-mono-numbers shrink-0 text-[#697586] dark:text-[#929BA9]"
                              aria-hidden="true"
                            >
                              —
                            </span>
                            <span className="text-[#151D2A] dark:text-[#F2F4F7]">{reason}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-[#151D2A] dark:text-[#F2F4F7] leading-relaxed">
                        {isEn ? dualHorizon.movementSummaryEn : dualHorizon.movementSummaryId}
                      </p>
                    )}
                  </div>

                  {/* 2) Titik Akhir Spike & Otomasi Status Spike */}
                  <div className="pt-2.5 border-t border-[#DDE3EA] dark:border-[#20252D] space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#697586] dark:text-[#929BA9]">
                        {tr(
                          '2. Titik Akhir Spike & Otomasi Status',
                          '2. Spike Termination & Automated Status'
                        )}
                      </span>
                      <span
                        data-testid="macro-spike-map-subheader"
                        className="text-[10px] sm:text-[11px] font-mono-numbers tabular-nums font-semibold text-[#697586] dark:text-[#929BA9]"
                      >
                        MAKRO TF 4H: {spikeTargetMap.macro4hPdZone} · TARGET SPIKE: TF 1H/15M (CAP 1.8x ATR)
                      </span>
                    </div>

                    {/* Skenario Manipulasi 2 Fase Waktu */}
                    <div
                      data-testid="macro-manipulation-two-phases"
                      className="rounded-md border border-[#DDE3EA] dark:border-[#20252D] bg-white/70 dark:bg-[#0B0D11] p-3 space-y-2 text-xs leading-relaxed"
                    >
                      <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#697586] dark:text-[#929BA9] block">
                        {tr('SKENARIO MANIPULASI & EKSPANSI INTRADAY', 'INTRADAY MANIPULATION & EXPANSION SCENARIO')}
                      </span>
                      <div className="space-y-1.5 font-mono-numbers tabular-nums">
                        <p className="text-[#697586] dark:text-[#929BA9]">
                          <span className="font-sans font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                            {tr('Fase 1 (Menit 0–5 Rilis): ', 'Phase 1 (Min 0–5 Release): ')}
                          </span>
                          {isEn ? dualHorizon.phase1Minute0to5En : dualHorizon.phase1Minute0to5Id}
                        </p>
                        <p className="text-[#697586] dark:text-[#929BA9] pt-1.5 border-t border-[#DDE3EA] dark:border-[#20252D]">
                          <span className="font-sans font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                            {tr('Fase 2 (Menit 15+ / Lanjutan): ', 'Phase 2 (Min 15+ / Continuation): ')}
                          </span>
                          {isEn ? dualHorizon.phase2Minute15PlusEn : dualHorizon.phase2Minute15PlusId}
                        </p>
                      </div>
                    </div>

                    {hasConfluenceLevels && spikeTargetMap.hasValidData && amdState ? (
                      <div
                        data-testid="macro-spike-levels-status-grid"
                        className="rounded-md border border-[#DDE3EA] dark:border-[#20252D] bg-white/70 dark:bg-[#0B0D11] divide-y divide-[#DDE3EA] dark:divide-[#20252D] text-xs font-mono-numbers tabular-nums"
                      >
                        {/* Row 1: BSL Sesi & SSL Sesi */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[#DDE3EA] dark:divide-[#20252D]">
                          <div className="px-3 py-2.5 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-sans text-[10px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#929BA9]">
                                {tr(
                                  `BSL Sesi (${getSessionLabelId(spikeTargetMap.bslSourceSession)})`,
                                  `Session BSL (${getSessionLabelId(spikeTargetMap.bslSourceSession)})`
                                )}
                              </span>
                              <span
                                className={`font-sans text-[10px] font-bold uppercase tracking-wider ${
                                  spikeTargetMap.spikeTracking.bslState === 'SWEPT'
                                    ? 'text-[#059669] dark:text-[#00A878]'
                                    : spikeTargetMap.spikeTracking.bslState === 'IN_ZONE'
                                    ? 'text-[#D97706] dark:text-[#F59E0B]'
                                    : 'text-[#697586] dark:text-[#929BA9]'
                                }`}
                              >
                                {spikeTargetMap.spikeTracking.bslState === 'SWEPT'
                                  ? tr('TERSAPU', 'SWEPT')
                                  : spikeTargetMap.spikeTracking.bslState === 'IN_ZONE'
                                  ? tr('DIUJI LIVE', 'TESTING')
                                  : tr('MENUNGGU', 'PENDING')}
                              </span>
                            </div>
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-sm font-bold text-[#151D2A] dark:text-[#F2F4F7]">
                                ${spikeTargetMap.bslPrice.toFixed(2)}
                              </span>
                              <span className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                                +${spikeTargetMap.spikeTracking.bslDistanceUsd.toFixed(2)} ·{' '}
                                {spikeTargetMap.spikeTracking.bslCapRatioPct}% ATR Cap
                              </span>
                            </div>
                          </div>

                          <div className="px-3 py-2.5 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-sans text-[10px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#929BA9]">
                                {tr(
                                  `SSL Sesi (${getSessionLabelId(spikeTargetMap.sslSourceSession)})`,
                                  `Session SSL (${getSessionLabelId(spikeTargetMap.sslSourceSession)})`
                                )}
                              </span>
                              <span
                                className={`font-sans text-[10px] font-bold uppercase tracking-wider ${
                                  spikeTargetMap.spikeTracking.sslState === 'SWEPT'
                                    ? 'text-[#059669] dark:text-[#00A878]'
                                    : spikeTargetMap.spikeTracking.sslState === 'IN_ZONE'
                                    ? 'text-[#D97706] dark:text-[#F59E0B]'
                                    : 'text-[#697586] dark:text-[#929BA9]'
                                }`}
                              >
                                {spikeTargetMap.spikeTracking.sslState === 'SWEPT'
                                  ? tr('TERSAPU', 'SWEPT')
                                  : spikeTargetMap.spikeTracking.sslState === 'IN_ZONE'
                                  ? tr('DIUJI LIVE', 'TESTING')
                                  : tr('MENUNGGU', 'PENDING')}
                              </span>
                            </div>
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-sm font-bold text-[#151D2A] dark:text-[#F2F4F7]">
                                ${spikeTargetMap.sslPrice.toFixed(2)}
                              </span>
                              <span className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                                -${spikeTargetMap.spikeTracking.sslDistanceUsd.toFixed(2)} ·{' '}
                                {spikeTargetMap.spikeTracking.sslCapRatioPct}% ATR Cap
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Row 2: POI Lapis 1 & POI Lapis 2 */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[#DDE3EA] dark:divide-[#20252D]">
                          <div className="px-3 py-2.5 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-sans text-[10px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#929BA9]">
                                {tr(
                                  'POI Lapis 1 (FVG / OTE 0.57–0.70)',
                                  'Layer 1 POI (FVG / OTE 0.57–0.70)'
                                )}
                              </span>
                              <span
                                className={`font-sans text-[10px] font-bold uppercase tracking-wider ${
                                  spikeTargetMap.spikeTracking.layer1State === 'SWEPT'
                                    ? 'text-[#059669] dark:text-[#00A878]'
                                    : spikeTargetMap.spikeTracking.layer1State === 'IN_ZONE'
                                    ? 'text-[#D97706] dark:text-[#F59E0B]'
                                    : 'text-[#697586] dark:text-[#929BA9]'
                                }`}
                              >
                                {spikeTargetMap.spikeTracking.layer1State === 'SWEPT'
                                  ? tr('TERMITIGASI', 'MITIGATED')
                                  : spikeTargetMap.spikeTracking.layer1State === 'IN_ZONE'
                                  ? tr('DI ZONA POI', 'IN POI ZONE')
                                  : tr('MENUNGGU', 'PENDING')}
                              </span>
                            </div>
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-sm font-bold text-[#151D2A] dark:text-[#F2F4F7]">
                                ${spikeTargetMap.layer1FvgOte.low.toFixed(2)} – $
                                {spikeTargetMap.layer1FvgOte.high.toFixed(2)}
                              </span>
                              <span className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                                Δ ${spikeTargetMap.spikeTracking.layer1DistanceUsd.toFixed(2)}
                              </span>
                            </div>
                          </div>

                          <div className="px-3 py-2.5 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-sans text-[10px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#929BA9]">
                                {tr('POI Lapis 2 (Extreme OB)', 'Layer 2 POI (Extreme OB)')}
                              </span>
                              <span
                                className={`font-sans text-[10px] font-bold uppercase tracking-wider ${
                                  spikeTargetMap.spikeTracking.layer2State === 'SWEPT'
                                    ? 'text-[#059669] dark:text-[#00A878]'
                                    : spikeTargetMap.spikeTracking.layer2State === 'IN_ZONE'
                                    ? 'text-[#D97706] dark:text-[#F59E0B]'
                                    : 'text-[#697586] dark:text-[#929BA9]'
                                }`}
                              >
                                {spikeTargetMap.spikeTracking.layer2State === 'SWEPT'
                                  ? tr('TERMITIGASI', 'MITIGATED')
                                  : spikeTargetMap.spikeTracking.layer2State === 'IN_ZONE'
                                  ? tr('DI ZONA OB', 'IN OB ZONE')
                                  : tr('CADANGAN', 'STANDBY')}
                              </span>
                            </div>
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-sm font-bold text-[#151D2A] dark:text-[#F2F4F7]">
                                ${spikeTargetMap.layer2ExtremeOb.low.toFixed(2)} – $
                                {spikeTargetMap.layer2ExtremeOb.high.toFixed(2)}
                              </span>
                              <span className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                                Δ ${spikeTargetMap.spikeTracking.layer2DistanceUsd.toFixed(2)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-2 py-1 text-xs text-[#697586] dark:text-[#929BA9]">
                        <span>
                          {confluenceData.isLoading || confluenceData.isRefreshing
                            ? tr(
                                'Menarik level BSL/SSL & POI OB/OTE XAU/USD dari Cycle & Confluence...',
                                'Fetching XAU/USD BSL/SSL & OB/OTE levels from Cycle & Confluence...'
                              )
                            : confluenceData.twelveDataError ||
                              tr(
                                'Level BSL/SSL & OB/OTE belum tersedia karena data candle XAU/USD belum termuat.',
                                'BSL/SSL & OB/OTE levels unavailable until XAU/USD candles are loaded.'
                              )}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void confluenceData.refresh(true)}
                            disabled={confluenceData.isRefreshing}
                            className="px-2.5 py-1 rounded border border-[#DDE3EA] dark:border-[#20252D] text-[11px] font-semibold text-[#151D2A] dark:text-[#F2F4F7] hover:border-black/25 dark:hover:border-white/25 cursor-pointer disabled:opacity-50"
                          >
                            {tr('Sync Candle', 'Sync Candles')}
                          </button>
                          {!hasConfluenceCandles && (
                            <button
                              type="button"
                              onClick={() => confluenceData.loadSampleOrCachedCandles()}
                              className="px-2.5 py-1 rounded border border-[#DDE3EA] dark:border-[#20252D] text-[11px] font-semibold text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7] cursor-pointer"
                            >
                              {tr('Muat Cache', 'Load Cache')}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 3) Alasan Teknis AMD */}
                  <div className="pt-2.5 border-t border-[#DDE3EA] dark:border-[#20252D] space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#697586] dark:text-[#929BA9] block">
                      {tr(
                        '3. Alasan Teknis AMD & Likuiditas Sesi',
                        '3. AMD Technical & Session Liquidity Rationale'
                      )}
                    </span>
                    {hasConfluenceCandles && amdState ? (
                      <>
                        <p className="text-xs font-medium text-[#151D2A] dark:text-[#F2F4F7] leading-relaxed">
                          {sessionLabelForAmd ? `${sessionLabelForAmd} · ` : ''}
                          {amdState.headlineId}
                        </p>
                        <p className="text-xs text-[#697586] dark:text-[#929BA9] leading-relaxed">
                          {amdState.detailId} {amdState.nextSessionProjectionId}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-[#697586] dark:text-[#929BA9] leading-relaxed">
                        {manualAmdOverride === 'ACCUMULATION'
                          ? tr(
                              'Manual AMD Override mengunci status ke Akumulasi: likuiditas menumpuk di batas kotak sesi sehingga rilis berita cenderung menyapu sisi lemah terlebih dahulu.',
                              'Manual AMD Override locks state to Accumulation: liquidity builds along session box extremes so news tends to sweep stops first.'
                            )
                          : manualAmdOverride === 'MANIPULATION'
                          ? tr(
                              'Manual AMD Override mengunci status ke Manipulasi: pasar berada di fase sapuan likuiditas / Judas Swing; tunggu penolakan di POI sebelum mengikuti distribusi.',
                              'Manual AMD Override locks state to Manipulation: market is in a Judas Swing liquidity sweep; wait for POI rejection before joining distribution.'
                            )
                          : tr(
                              'Pembacaan AMD Gatekeeper otomatis akan melengkapi konteks likuiditas sesi segera setelah data candle XAU/USD aktif tersinkron.',
                              'Automatic AMD Gatekeeper context completes session liquidity mapping once active XAU/USD candle data finishes syncing.'
                            )}
                      </p>
                    )}
                  </div>

                  {/* 4) Audit Integrasi Cycle & Confluence (Spike Integration Audit) */}
                  {hasConfluenceLevels && spikeTargetMap.hasValidData && (
                    <div
                      data-testid="macro-spike-integration-audit"
                      className="pt-2.5 border-t border-[#DDE3EA] dark:border-[#20252D] space-y-1.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#697586] dark:text-[#929BA9]">
                          {tr(
                            '4. Audit Integrasi Cycle & Confluence',
                            '4. Cycle & Confluence Integration Audit'
                          )}
                        </span>
                        <span
                          className={`text-[10px] font-mono-numbers tabular-nums font-semibold ${
                            confluenceData.isMarketOpen
                              ? 'text-[#059669] dark:text-[#00A878]'
                              : 'text-[#D97706] dark:text-[#F59E0B]'
                          }`}
                        >
                          {confluenceData.isMarketOpen
                            ? tr('LIVE MARKET (SENIN–JUMAT)', 'LIVE MARKET (MON–FRI)')
                            : tr('PENUTUPAN JUMAT (SABTU–MINGGU TUTUP)', 'FRIDAY CLOSE (SAT–SUN CLOSED)')}{' '}
                          · 4H ({spikeTargetMap.integrationAudit.candleCount4h}) · 1H ({spikeTargetMap.integrationAudit.candleCount1h}) · 15M ({spikeTargetMap.integrationAudit.candleCount15m})
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono-numbers tabular-nums text-[#697586] dark:text-[#929BA9]">
                        <span>
                          Spot Acuan:{' '}
                          <strong className="font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                            ${spikeTargetMap.spotPrice.toFixed(2)}
                          </strong>
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          ATR(14) 1H:{' '}
                          <strong className="font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                            ${spikeTargetMap.atr14_1h.toFixed(2)}
                          </strong>
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          Radius Cap (1.8x):{' '}
                          <strong className="font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                            ±${spikeTargetMap.maxSweepDistance.toFixed(2)}
                          </strong>{' '}
                          (${spikeTargetMap.lowerAtrCapPrice.toFixed(2)}–${spikeTargetMap.upperAtrCapPrice.toFixed(2)})
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          Priced-In 6H:{' '}
                          <strong
                            className={`font-semibold ${
                              dualHorizon.isPricedIn
                                ? 'text-[#D97706] dark:text-[#F59E0B]'
                                : 'text-[#151D2A] dark:text-[#F2F4F7]'
                            }`}
                          >
                            {dualHorizon.move6hUsd >= 0 ? '+' : ''}${dualHorizon.move6hUsd.toFixed(2)}
                          </strong>
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          Clamp ATR:{' '}
                          <strong className="font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                            {spikeTargetMap.integrationAudit.isBslClampedByAtr ||
                            spikeTargetMap.integrationAudit.isSslClampedByAtr ||
                            spikeTargetMap.integrationAudit.isPoiClampedByAtr
                              ? tr('Aktif (1.8x ATR)', 'Active (1.8x ATR)')
                              : tr('Natural (Dalam Radius)', 'Natural (Within Cap)')}
                          </strong>
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bias History Overlay (Multi-Snapshot Probability Shift) */}
        <div className="pt-1 space-y-2">
          {biasHistory.length >= 2 ? (
            <>
              <button
                type="button"
                data-testid="macro-bias-history-toggle"
                onClick={() => setShowBiasHistory((prev) => !prev)}
                className="min-h-[34px] inline-flex items-center gap-1.5 text-xs font-semibold text-[#151D2A] dark:text-[#F2F4F7] hover:opacity-80 cursor-pointer"
              >
                <span>
                  {showBiasHistory
                    ? tr(`Sembunyikan Riwayat Pergeseran Bias (${biasHistory.length})`, `Hide Bias Shift History (${biasHistory.length})`)
                    : tr(`Lihat Riwayat Pergeseran Bias (${biasHistory.length})`, `View Bias Shift History (${biasHistory.length})`)}
                </span>
                {showBiasHistory ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              {showBiasHistory && (
                <div
                  data-testid="macro-bias-history-panel"
                  className="pt-3 border-t border-[#DDE3EA] dark:border-[#20252D] space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#697586] dark:text-[#929BA9]">
                    <span>{tr('Tren Pergeseran Probabilitas', 'Probability Shift Trajectory')}</span>
                    <span className="font-mono-numbers tabular-nums">
                      {biasHistory[0].dominantBias} ({Math.max(biasHistory[0].buyProbability, biasHistory[0].sellProbability, biasHistory[0].mixedProbability)}%) →{' '}
                      <span className="font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                        {biasHistory[biasHistory.length - 1].dominantBias} ({Math.max(
                          biasHistory[biasHistory.length - 1].buyProbability,
                          biasHistory[biasHistory.length - 1].sellProbability,
                          biasHistory[biasHistory.length - 1].mixedProbability
                        )}%)
                      </span>
                    </span>
                  </div>

                  {/* Clean Monochrome SVG Trajectory */}
                  <div className="w-full h-14">
                    <svg
                      viewBox="0 0 320 56"
                      preserveAspectRatio="none"
                      className="w-full h-full overflow-visible"
                      aria-label={tr('Grafik riwayat pergeseran bias', 'Bias shift history chart')}
                    >
                      <line x1="0" y1="28" x2="320" y2="28" stroke="currentColor" className="text-[#DDE3EA] dark:text-[#20252D]" strokeWidth="1" strokeDasharray="3 3" />
                      {(['buyProbability', 'sellProbability', 'mixedProbability'] as const).map((key) => {
                        const strokeClass =
                          key === 'buyProbability'
                            ? 'text-[#059669] dark:text-[#00A878]'
                            : key === 'sellProbability'
                            ? 'text-[#E11D48] dark:text-[#E05260]'
                            : 'text-[#929BA9]';
                        const pts = biasHistory
                          .map((pt, idx) => {
                            const x = biasHistory.length === 1 ? 160 : (idx / (biasHistory.length - 1)) * 320;
                            const y = 52 - (Math.max(0, Math.min(100, pt[key])) / 100) * 48;
                            return `${x.toFixed(1)},${y.toFixed(1)}`;
                          })
                          .join(' ');
                        return (
                          <polyline
                            key={key}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.75"
                            strokeLinejoin="round"
                            strokeLinecap="round"
                            className={strokeClass}
                            points={pts}
                          />
                        );
                      })}
                    </svg>
                  </div>

                  <div className="divide-y divide-[#DDE3EA] dark:divide-[#20252D] border-t border-[#DDE3EA] dark:border-[#20252D]">
                    {[...biasHistory].reverse().slice(0, 6).map((pt, idx) => (
                      <div
                        key={`${pt.analyzedAt}-${idx}`}
                        className="py-2 flex items-center justify-between gap-3 text-xs font-mono-numbers tabular-nums"
                      >
                        <div className="min-w-0 truncate text-[#697586] dark:text-[#929BA9]">
                          <span>{formatTimestampWib(pt.analyzedAt, isEn ? 'en' : 'id')}</span>
                          <span aria-hidden="true"> · </span>
                          <span
                            className={`font-sans font-semibold ${
                              pt.isPostNews
                                ? 'text-[#1769E8] dark:text-[#3478DC]'
                                : 'text-[#E11D48] dark:text-[#E05260]'
                            }`}
                          >
                            {pt.isPostNews ? 'Post-News' : 'Pre-News'}
                          </span>
                        </div>
                        <div className="shrink-0 flex items-center gap-2.5">
                          <span
                            className={`font-bold ${
                              pt.dominantBias === 'BUY'
                                ? 'text-[#059669] dark:text-[#00A878]'
                                : pt.dominantBias === 'SELL'
                                ? 'text-[#E11D48] dark:text-[#E05260]'
                                : 'text-[#151D2A] dark:text-[#F2F4F7]'
                            }`}
                          >
                            {pt.dominantBias}
                          </span>
                          <span className="text-[#697586] dark:text-[#929BA9]">
                            {pt.buyProbability}% / {pt.mixedProbability}% / {pt.sellProbability}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : biasHistory.length === 1 ? (
            <p className="text-[11px] text-[#697586] dark:text-[#929BA9]">
              {tr(
                'Titik histori bias pertama tercatat — overlay pergeseran multi-waktu muncul setelah pembaruan berikutnya.',
                'First bias history snapshot recorded — multi-point shift overlay appears after the next refresh.'
              )}
            </p>
          ) : null}
        </div>
      </section>

      {/* SECTION 03 — INTERMARKET PULSE (SEAMLESS UNIFIED 2x2 GRID, DIRECT ON CANVAS) */}
      <section
        aria-label={tr('Intermarket Pulse', 'Intermarket Pulse')}
        className="space-y-3 pb-6 border-b border-[#DDE3EA] dark:border-[#20252D]"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#697586] dark:text-[#929BA9]">
            {tr('INTERMARKET PULSE', 'INTERMARKET PULSE')}
          </h2>
          <div className="flex items-center gap-2 text-xs text-[#697586] dark:text-[#929BA9] font-mono-numbers tabular-nums">
            <span>
              {tr('Live', 'Live')} ·{' '}
              {formatLiveUpdateClockWib(
                lastIntermarketSyncIso ||
                  snapshot.intermarketPulse.dxy?.updatedAt ||
                  snapshot.analyzedAt
              )}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-sans">{tr('Ketuk untuk detail', 'Tap for details')}</span>
          </div>
        </div>

        <div
          data-testid="macro-intermarket-grid"
          className="grid grid-cols-2 divide-x divide-y divide-[#DDE3EA] dark:divide-[#20252D] border-y border-[#DDE3EA] dark:border-[#20252D]"
        >
          {intermarketList.map((asset) => {
            const displayLabel =
              asset.symbol === 'US02Y'
                ? 'US02Y Yield'
                : asset.symbol === 'US10Y'
                ? 'US10Y Yield'
                : asset.symbol === 'USOIL'
                ? 'US Oil (WTI)'
                : 'DXY';
            const isAssetAvailable = asset.isAvailable !== false && asset.price > 0;
            const formattedPrice = !isAssetAvailable
              ? '—'
              : asset.symbol === 'US02Y' || asset.symbol === 'US10Y'
              ? `${asset.price.toFixed(3)}%`
              : asset.symbol === 'USOIL'
              ? `$${asset.price.toFixed(2)}`
              : asset.price.toFixed(3);
            const isUp = isAssetAvailable && asset.changePercent > 0;
            const isDown = isAssetAvailable && asset.changePercent < 0;

            return (
              <button
                key={asset.symbol}
                type="button"
                data-testid={`intermarket-card-${asset.symbol.toLowerCase()}`}
                onClick={() => setSelectedIntermarketAsset(asset)}
                className="text-left p-4 sm:py-4 sm:px-5 bg-transparent hover:bg-[#F5F7FA] dark:hover:bg-[#101318] transition-colors duration-150 min-h-[104px] flex flex-col justify-between gap-2 cursor-pointer"
              >
                <div className="flex items-center justify-between gap-1.5 w-full">
                  <span className="text-xs font-semibold text-[#697586] dark:text-[#929BA9] truncate">
                    {displayLabel}
                  </span>
                  <span
                    className={`inline-flex items-center gap-0.5 text-xs font-semibold font-mono-numbers tabular-nums shrink-0 ${
                      isUp
                        ? 'text-[#059669] dark:text-[#00A878]'
                        : isDown
                        ? 'text-[#E11D48] dark:text-[#E05260]'
                        : 'text-[#697586] dark:text-[#929BA9]'
                    }`}
                  >
                    {isUp ? (
                      <ArrowUpRight className="w-3.5 h-3.5 stroke-[2]" />
                    ) : isDown ? (
                      <ArrowDownRight className="w-3.5 h-3.5 stroke-[2]" />
                    ) : (
                      <Minus className="w-3.5 h-3.5 stroke-[2]" />
                    )}
                    <span>
                      {!isAssetAvailable
                        ? '0.00%'
                        : isUp
                        ? `+${asset.changePercent.toFixed(2)}%`
                        : `${asset.changePercent.toFixed(2)}%`}
                    </span>
                  </span>
                </div>

                <div className="text-xl sm:text-2xl font-bold font-mono-numbers tabular-nums tracking-tight text-[#151D2A] dark:text-[#F2F4F7]">
                  {formattedPrice}
                </div>

                <div className="flex items-center justify-between gap-2 pt-1 w-full">
                  <span
                    data-testid={`intermarket-xau-badge-${asset.symbol.toLowerCase()}`}
                    className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider ${
                      asset.goldCorrelationEffect === 'BULLISH_GOLD'
                        ? 'text-[#059669] dark:text-[#00A878]'
                        : asset.goldCorrelationEffect === 'BEARISH_GOLD'
                        ? 'text-[#E11D48] dark:text-[#E05260]'
                        : 'text-[#697586] dark:text-[#929BA9]'
                    }`}
                  >
                    {asset.goldCorrelationEffect === 'BULLISH_GOLD'
                      ? 'BULLISH XAU'
                      : asset.goldCorrelationEffect === 'BEARISH_GOLD'
                      ? 'BEARISH XAU'
                      : tr('NETRAL XAU', 'NEUTRAL XAU')}
                  </span>
                  <span className="text-[11px] font-sans text-[#697586] dark:text-[#929BA9] font-medium">
                    {tr('Detail', 'Detail')}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {(activeMatrix.preNewsFlow?.yieldCurve ||
          (snapshot.intermarketPulse.us10y?.isAvailable !== false &&
            snapshot.intermarketPulse.us10y?.price > 0 &&
            us02yPulse.isAvailable !== false &&
            us02yPulse.price > 0) ||
          snapshot.intermarketPulse.vix?.isAvailable ||
          snapshot.intermarketPulse.goldPositioning?.isAvailable) && (
          <div
            data-testid="macro-intermarket-context-bar"
            className="pt-1 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[#697586] dark:text-[#929BA9] font-mono-numbers tabular-nums"
          >
            {(() => {
              const liveSpread =
                snapshot.intermarketPulse.us10y?.isAvailable !== false &&
                snapshot.intermarketPulse.us10y?.price > 0 &&
                us02yPulse.isAvailable !== false &&
                us02yPulse.price > 0
                  ? Number((snapshot.intermarketPulse.us10y.price - us02yPulse.price).toFixed(3))
                  : activeMatrix.preNewsFlow?.yieldCurve?.spread2s10s ?? null;
              if (liveSpread === null || !Number.isFinite(liveSpread)) return null;
              return (
                <span>
                  <span className="font-sans font-medium text-[#697586] dark:text-[#929BA9]">2s10s:</span>{' '}
                  <span className="font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                    {liveSpread >= 0 ? '+' : ''}
                    {liveSpread.toFixed(2)}%
                  </span>
                </span>
              );
            })()}
            {snapshot.intermarketPulse.vix?.isAvailable && (
              <span>
                <span className="font-sans font-medium text-[#697586] dark:text-[#929BA9]">VIX:</span>{' '}
                <span className="font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                  {snapshot.intermarketPulse.vix.price.toFixed(2)}
                </span>{' '}
                (
                {snapshot.intermarketPulse.vix.changePercent >= 0 ? '+' : ''}
                {snapshot.intermarketPulse.vix.changePercent.toFixed(2)}%)
              </span>
            )}
            {snapshot.intermarketPulse.goldPositioning?.isAvailable && (
              <span>
                <span className="font-sans font-medium text-[#697586] dark:text-[#929BA9]">GC=F 3D:</span>{' '}
                <span className="font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                  {snapshot.intermarketPulse.goldPositioning.change3dPercent >= 0 ? '+' : ''}
                  {snapshot.intermarketPulse.goldPositioning.change3dPercent.toFixed(2)}%
                </span>
              </span>
            )}
          </div>
        )}
      </section>

      {/* SECTION 04 — FED EXPECTATIONS / CME FEDWATCH (DIRECT ON CANVAS) */}
      <section
        aria-label={tr('Ekspektasi Fed dan CME FedWatch', 'Fed Expectations & CME FedWatch')}
        data-testid="macro-cme-fedwatch-card"
        className="space-y-4 pb-6 border-b border-[#DDE3EA] dark:border-[#20252D]"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="space-y-0.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#697586] dark:text-[#929BA9]">
              {tr('EKSPEKTASI FED · CME FEDWATCH (FOMC TARGET)', 'FED EXPECTATIONS · CME FEDWATCH (FOMC TARGET)')}
            </h2>
            <p className="text-sm sm:text-base font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
              {activeFedWatch.fomcMeetingDate}
            </p>
          </div>

          <div className="text-right space-y-0.5">
            <span
              data-testid="macro-cme-fedwatch-source"
              className="text-xs text-[#697586] dark:text-[#929BA9] block"
            >
              {activeFedWatch.isAvailable
                ? activeFedWatch.sourceLabel || tr('Live FedWatch Sync', 'Live FedWatch Sync')
                : tr('Data FedWatch belum tersedia', 'FedWatch data unavailable')}
            </span>
          </div>
        </div>

        {/* Implied Rate & Target Range Metadata */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-baseline gap-2">
            <span className="text-[#697586] dark:text-[#929BA9]">
              {tr('Implied Fed Funds Rate:', 'Implied Fed Funds Rate:')}
            </span>
            <span className="font-bold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F4F7]">
              {activeFedWatch.isAvailable && typeof activeFedWatch.impliedFedFundsRate === 'number'
                ? `${activeFedWatch.impliedFedFundsRate.toFixed(2)}%`
                : '—'}
            </span>
          </div>

          {activeFedWatch.isAvailable && activeFedWatch.targetRateRange && (
            <span className="text-xs font-mono-numbers tabular-nums text-[#697586] dark:text-[#929BA9]">
              {activeFedWatch.targetRateRange}
            </span>
          )}
        </div>

        {/* Unified Monochrome 3-Probability Comparison Row */}
        <div className="grid grid-cols-3 divide-x divide-[#DDE3EA] dark:divide-[#20252D] py-3 border-y border-[#DDE3EA] dark:border-[#20252D] font-mono-numbers tabular-nums">
          <div className="pr-3">
            <span className="text-[11px] font-sans font-medium text-[#697586] dark:text-[#929BA9] block">
              {tr('Rate Hike', 'Rate Hike')}
            </span>
            <span className="text-xl sm:text-2xl font-bold text-[#151D2A] dark:text-[#F2F4F7] mt-0.5 block">
              {activeFedWatch.isAvailable && activeFedWatch.hikeProbability !== null
                ? `${activeFedWatch.hikeProbability.toFixed(1)}%`
                : '—'}
            </span>
          </div>

          <div className="px-3">
            <span className="text-[11px] font-sans font-medium text-[#697586] dark:text-[#929BA9] block">
              {tr('Hold', 'Hold')}
            </span>
            <span className="text-xl sm:text-2xl font-bold text-[#151D2A] dark:text-[#F2F4F7] mt-0.5 block">
              {activeFedWatch.isAvailable && activeFedWatch.holdProbability !== null
                ? `${activeFedWatch.holdProbability.toFixed(1)}%`
                : '—'}
            </span>
          </div>

          <div className="pl-3">
            <span className="text-[11px] font-sans font-medium text-[#697586] dark:text-[#929BA9] block">
              {tr('Rate Cut', 'Rate Cut')}
            </span>
            <span className="text-xl sm:text-2xl font-bold text-[#151D2A] dark:text-[#F2F4F7] mt-0.5 block">
              {activeFedWatch.isAvailable && activeFedWatch.cutProbability !== null
                ? `${activeFedWatch.cutProbability.toFixed(1)}%`
                : '—'}
            </span>
          </div>
        </div>

        <p className="text-xs sm:text-[13px] text-[#697586] dark:text-[#929BA9] leading-relaxed">
          {activeFedWatch.isAvailable
            ? isEn
              ? activeFedWatch.summaryNoteEn
              : activeFedWatch.summaryNoteId
            : tr(
                'Data FedWatch belum tersedia sementara; probabilitas menunggu sinkronisasi futures atau grounding berikutnya.',
                'FedWatch data is temporarily unavailable; probabilities await next futures or grounding sync.'
              )}
        </p>
      </section>

      {/* SECTION 05 & 06 MERGED — TABBED EXECUTION PLAN & THESIS (DIRECT ON CANVAS) */}
      <section
        aria-label={tr('Rencana Eksekusi dan Tesis', 'Execution Plan & Thesis')}
        data-testid="macro-tactic-thesis-tab-card"
        className="space-y-4 pb-6 border-b border-[#DDE3EA] dark:border-[#20252D]"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center p-1 rounded-lg bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D]">
            <button
              type="button"
              data-testid="macro-tab-execution-plan"
              onClick={() => setStrategyTab('EXECUTION')}
              className={`min-h-[34px] px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                strategyTab === 'EXECUTION'
                  ? 'bg-[#151D2A] text-white dark:bg-white dark:text-[#050607]'
                  : 'text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7]'
              }`}
            >
              {tr('Rencana Eksekusi', 'Execution Plan')}
            </button>
            <button
              type="button"
              data-testid="macro-tab-thesis-pillars"
              onClick={() => setStrategyTab('THESIS')}
              className={`min-h-[34px] px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                strategyTab === 'THESIS'
                  ? 'bg-[#151D2A] text-white dark:bg-white dark:text-[#050607]'
                  : 'text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7]'
              }`}
            >
              {tr('Tesis & 3 Pilar', 'Thesis & 3 Pillars')}
            </button>
          </div>

          <span className="text-[11px] font-medium text-[#697586] dark:text-[#929BA9]">
            {activeMatrix.evaluationMode === 'FOMC_MEETING'
              ? tr('3 Pilar FOMC Penuh', 'Full 3 FOMC Pillars')
              : pillarBadgeLabel(primaryEv.pillar)}
          </span>
        </div>

        {strategyTab === 'EXECUTION' ? (
          <div className="divide-y divide-[#DDE3EA] dark:divide-[#20252D]">
            {conciseExecutionPoints.slice(0, 3).map((pt, idx) => (
              <div key={idx} className="py-3 first:pt-0 last:pb-0 space-y-1">
                <span className="text-xs font-semibold flex items-center gap-1.5 text-[#697586] dark:text-[#929BA9]">
                  {pt.tone === 'warning' && (
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-[#D97706] dark:text-[#F59E0B]" />
                  )}
                  <span className={pt.tone === 'warning' ? 'text-[#D97706] dark:text-[#F59E0B]' : ''}>
                    {pt.title}
                  </span>
                </span>
                <p className="text-xs sm:text-[13px] text-[#151D2A] dark:text-[#F2F4F7] leading-relaxed">
                  {pt.body}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="divide-y divide-[#DDE3EA] dark:divide-[#20252D]">
              {conciseThesisPoints.slice(0, 3).map((pt, idx) => (
                <div key={idx} className="py-3 first:pt-0 last:pb-0 space-y-1">
                  <span className="text-xs font-semibold text-[#697586] dark:text-[#929BA9] block">
                    {pt.title}
                  </span>
                  <p className="text-xs sm:text-[13px] text-[#151D2A] dark:text-[#F2F4F7] leading-relaxed">
                    {pt.body}
                  </p>
                </div>
              ))}
            </div>

            {activeMatrix.preNewsFlow && (
              <div className="pt-2.5 border-t border-[#DDE3EA] dark:border-[#20252D]">
                <button
                  type="button"
                  data-testid="macro-prenews-flow-toggle"
                  onClick={() => setShowPreNewsFlow((prev) => !prev)}
                  className="min-h-[32px] inline-flex items-center gap-1.5 text-xs font-semibold text-[#151D2A] dark:text-[#F2F4F7] hover:opacity-80 cursor-pointer"
                >
                  <span>
                    {showPreNewsFlow
                      ? tr('Sembunyikan Detail Alur Pra-Rilis', 'Hide Pre-News Flow Details')
                      : tr('Lihat Detail Alur Pra-Rilis', 'View Pre-News Flow Details')}
                  </span>
                  {showPreNewsFlow ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>

                {showPreNewsFlow && (
                  <div
                    data-testid="macro-prenews-flow-panel"
                    className="mt-2 divide-y divide-[#DDE3EA] dark:divide-[#20252D] border-t border-[#DDE3EA] dark:border-[#20252D] text-xs"
                  >
                    <div className="py-2.5 space-y-0.5">
                      <span className="font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                        {tr('Margin Konsensus', 'Consensus Margin')} · {activeMatrix.preNewsFlow.consensusTightness}
                      </span>
                      <p className="text-[#697586] dark:text-[#929BA9] leading-relaxed">
                        {isEn ? activeMatrix.preNewsFlow.consensusNoteEn : activeMatrix.preNewsFlow.consensusNoteId}
                      </p>
                    </div>
                    <div className="py-2.5 space-y-0.5">
                      <span className="font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                        {tr('Rantai Indikator Pendahulu', 'Leading Indicator Chain')} ·{' '}
                        {activeMatrix.preNewsFlow.leadingChain.direction}
                      </span>
                      <p className="text-[#697586] dark:text-[#929BA9] leading-relaxed">
                        {isEn
                          ? activeMatrix.preNewsFlow.leadingChain.summaryEn
                          : activeMatrix.preNewsFlow.leadingChain.summaryId}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* SECTION 07 — ECONOMIC CALENDAR (DIRECT ON CANVAS) */}
      <section
        aria-label={tr('Kalender Ekonomi USD', 'USD Economic Calendar')}
        data-testid="macro-calendar-section"
        className="space-y-4 pb-6 border-b border-[#DDE3EA] dark:border-[#20252D]"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#697586] dark:text-[#929BA9]">
              {tr('KALENDER EKONOMI USD', 'USD ECONOMIC CALENDAR')}
            </h2>
            <p className="text-xs text-[#697586] dark:text-[#929BA9] font-mono-numbers tabular-nums">
              {filteredCalendarEvents.length} / {snapshot.calendarEvents.length}{' '}
              {tr('jadwal ditampilkan', 'events shown')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              data-testid="macro-calendar-view-switch"
              className="inline-flex items-center p-1 rounded-lg bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D]"
            >
              <button
                type="button"
                onClick={() => setCalendarViewMode('LIST')}
                className={`min-h-[34px] px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  calendarViewMode === 'LIST'
                    ? 'bg-[#151D2A] text-white dark:bg-white dark:text-[#050607]'
                    : 'text-[#697586] dark:text-[#929BA9]'
                }`}
              >
                {tr('Daftar', 'List')}
              </button>
              <button
                type="button"
                onClick={() => setCalendarViewMode('TIMELINE')}
                className={`min-h-[34px] px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  calendarViewMode === 'TIMELINE'
                    ? 'bg-[#151D2A] text-white dark:bg-white dark:text-[#050607]'
                    : 'text-[#697586] dark:text-[#929BA9]'
                }`}
              >
                {tr('Timeline', 'Timeline')}
              </button>
            </div>

            <div className="inline-flex items-center p-1 rounded-lg bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D]">
              <button
                type="button"
                onClick={() => setShowFullCalendar(false)}
                className={`min-h-[34px] px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  !showFullCalendar
                    ? 'bg-[#151D2A] text-white dark:bg-white dark:text-[#050607]'
                    : 'text-[#697586] dark:text-[#929BA9]'
                }`}
              >
                {tr('High-Impact', 'High-Impact Only')}
              </button>
              <button
                type="button"
                onClick={() => setShowFullCalendar(true)}
                className={`min-h-[34px] px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  showFullCalendar
                    ? 'bg-[#151D2A] text-white dark:bg-white dark:text-[#050607]'
                    : 'text-[#697586] dark:text-[#929BA9]'
                }`}
              >
                {tr('Semua Event', 'All Events')}
              </button>
            </div>
          </div>
        </div>

        {/* Search & Window Controls */}
        <div className="space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
            <div className="relative flex-1 min-w-0">
              <Search className="w-4 h-4 text-[#697586] dark:text-[#929BA9] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={tr('Cari rilis USD (CPI, PPI, NFP, FOMC)...', 'Search USD release (CPI, PPI, NFP, FOMC)...')}
                className="w-full min-h-[40px] pl-9 pr-3 py-2 rounded-lg bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] text-xs sm:text-sm text-[#151D2A] dark:text-[#F2F4F7] placeholder-[#697586] dark:placeholder-[#929BA9] focus:outline-none focus:border-black/40 dark:focus:border-white/40"
              />
            </div>

            <div className="inline-flex items-center p-1 rounded-lg bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] self-start sm:self-auto shrink-0">
              {(
                [
                  { key: 'ALL', labelId: 'Semua', labelEn: 'All' },
                  { key: 'UPCOMING', labelId: 'Mendatang', labelEn: 'Upcoming' },
                  { key: 'RELEASED', labelId: 'Sudah Rilis', labelEn: 'Released' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setEventWindowFilter(opt.key)}
                  className={`min-h-[32px] px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    eventWindowFilter === opt.key
                      ? 'bg-[#151D2A] text-white dark:bg-white dark:text-[#050607]'
                      : 'text-[#697586] dark:text-[#929BA9]'
                  }`}
                >
                  {tr(opt.labelId, opt.labelEn)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            {QUICK_SEARCH_FILTERS.map((tag) => {
              const isSelected = (tag === 'ALL' && !searchQuery) || searchQuery.toUpperCase() === tag;
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setSearchQuery(tag === 'ALL' ? '' : tag)}
                  className={`min-h-[32px] px-3 py-1 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[#151D2A] text-white dark:bg-white dark:text-[#050607]'
                      : 'bg-[#F5F7FA] dark:bg-[#101318] text-[#697586] dark:text-[#929BA9] border border-[#DDE3EA] dark:border-[#20252D] hover:text-[#151D2A] dark:hover:text-[#F2F4F7]'
                  }`}
                >
                  {tag === 'ALL' ? tr('Semua', 'All') : tag}
                </button>
              );
            })}
          </div>
        </div>

        {/* Clean Scannable Calendar Rows or Event Impact Timeline */}
        {filteredCalendarEvents.length === 0 ? (
          <div className="py-8 text-center space-y-2 border-t border-[#DDE3EA] dark:border-[#20252D]">
            <p className="text-sm text-[#697586] dark:text-[#929BA9]">
              {tr('Tidak ada jadwal ekonomi yang cocok dengan filter ini.', 'No economic events match this filter.')}
            </p>
            {(searchQuery || eventWindowFilter !== 'ALL' || !showFullCalendar) && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setEventWindowFilter('ALL');
                  setShowFullCalendar(true);
                }}
                className="min-h-[38px] px-4 py-1.5 rounded-lg bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] text-xs font-semibold text-[#151D2A] dark:text-[#F2F4F7] cursor-pointer"
              >
                {tr('Tampilkan Semua Jadwal', 'Show All Releases')}
              </button>
            )}
          </div>
        ) : calendarViewMode === 'TIMELINE' ? (
          <div
            data-testid="macro-event-impact-timeline"
            className="relative border-t border-[#DDE3EA] dark:border-[#20252D] pt-4 space-y-5"
          >
            {timelineClusters.map((grp, idx) => {
              const grpTimeMs = new Date(grp.releaseDateIso).getTime();
              const isPastGrp = Number.isFinite(grpTimeMs) && grpTimeMs <= nowMs;
              const isTargetGrp = grp.events.some((e) => clusterEvents.some((c) => c.id === e.id));
              const hasActualInGrp = grp.events.some((e) => Boolean(e.actual && e.actual.trim() && e.actual.trim() !== '-'));
              const hasPrimaryInGrp = grp.events.some((e) => isPrimaryHighImpactEvent(e));

              const nodeColorClass = isTargetGrp
                ? 'bg-[#151D2A] dark:bg-white'
                : hasActualInGrp
                ? 'bg-[#697586] dark:bg-[#929BA9]'
                : 'bg-[#CBD5E1] dark:bg-[#3A4250]';

              return (
                <div key={grp.groupId} className="relative pl-6">
                  {idx < timelineClusters.length - 1 && (
                    <span
                      aria-hidden="true"
                      className="absolute left-[3.5px] top-3 bottom-[-22px] w-px bg-[#DDE3EA] dark:bg-[#20252D]"
                    />
                  )}
                  <span
                    aria-hidden="true"
                    className={`absolute left-0 top-1.5 w-2 h-2 rounded-full ${nodeColorClass}`}
                  />

                  <div className="space-y-1.5 pb-3 border-b border-[#DDE3EA] dark:border-[#20252D]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#697586] dark:text-[#929BA9] font-mono-numbers tabular-nums">
                          <span>{isEn ? grp.formattedScheduleEn : grp.formattedScheduleId}</span>
                          <span aria-hidden="true">·</span>
                          <span
                            className={`font-sans font-semibold ${
                              isPastGrp
                                ? 'text-[#1769E8] dark:text-[#3478DC]'
                                : 'text-[#E11D48] dark:text-[#E05260]'
                            }`}
                          >
                            {hasActualInGrp
                              ? tr('Post-News', 'Post-News')
                              : isPastGrp
                              ? tr('Menunggu Actual', 'Pending Actual')
                              : tr('Pre-News', 'Pre-News')}
                          </span>
                          {isTargetGrp && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-sans font-semibold text-[#151D2A] dark:text-white">
                                {tr('Target Aktif', 'Active Target')}
                              </span>
                            </>
                          )}
                        </div>
                        <h3 className="text-sm font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                          {grp.combinedTitle}
                        </h3>
                      </div>

                      {hasPrimaryInGrp && !isTargetGrp && (
                        <button
                          type="button"
                          onClick={() => handleSelectEventGroup(grp.primaryEvent.id)}
                          className="min-h-[34px] px-3 py-1 rounded-lg bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] hover:border-black/25 dark:hover:border-white/25 text-xs font-semibold text-[#151D2A] dark:text-[#F2F4F7] whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          {tr('Analisis', 'Analyze')}
                        </button>
                      )}
                    </div>

                    <div className="space-y-1">
                      {grp.events.map((ev) => {
                        const hasAct = Boolean(ev.actual && ev.actual.trim() && ev.actual.trim() !== '-');
                        const isRelWithAct = hasAct && (isPastGrp || ev.actualNum !== null);
                        const actColor = !isRelWithAct
                          ? 'text-[#151D2A] dark:text-[#F2F4F7]'
                          : ev.eventBiasForGold === 'SELL'
                          ? 'text-[#059669] dark:text-[#00A878]'
                          : ev.eventBiasForGold === 'BUY'
                          ? 'text-[#E11D48] dark:text-[#E05260]'
                          : 'text-[#151D2A] dark:text-[#F2F4F7]';
                        const preEval =
                          isRelWithAct && ev.forecastNum !== null && ev.previousNum !== null
                            ? evaluateSingleEventForGold(ev.title, null, ev.forecastNum, ev.previousNum)
                            : null;
                        const flipped = Boolean(
                          preEval &&
                            preEval.bias !== 'MIXED' &&
                            ev.eventBiasForGold !== 'MIXED' &&
                            preEval.bias !== ev.eventBiasForGold
                        );

                        return (
                          <div
                            key={ev.id}
                            className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono-numbers tabular-nums"
                          >
                            <span className="font-sans text-[#697586] dark:text-[#929BA9]">
                              {ev.title} · {pillarBadgeLabel(ev.pillar)}
                            </span>
                            <div className="flex flex-wrap items-center gap-2 text-[#151D2A] dark:text-[#F2F4F7]">
                              <span>Prev {ev.previous || '—'}</span>
                              <span>· Fcst {ev.forecast || '—'}</span>
                              <span>
                                · Act{' '}
                                <span className={`font-bold ${actColor}`}>
                                  {hasAct ? ev.actual : tr('Menunggu', 'Pending')}
                                </span>
                              </span>
                              {flipped && (
                                <span className="font-sans font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                                  · {tr('Surprise Reversal', 'Surprise Reversal')}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="divide-y divide-[#DDE3EA] dark:divide-[#20252D] border-t border-[#DDE3EA] dark:border-[#20252D]">
            {filteredCalendarEvents.map((ev) => {
              const isPrimaryItem = isPrimaryHighImpactEvent(ev);
              const isActiveTarget = clusterEvents.some((c) => c.id === ev.id);
              const evTimeMs = new Date(ev.date).getTime();
              const isPastItem = Number.isFinite(evTimeMs) && evTimeMs <= nowMs;
              const hasActualItem = Boolean(
                ev.actual && ev.actual.trim() && ev.actual.trim() !== '-'
              );
              const isReleasedWithActual = hasActualItem && (isPastItem || ev.actualNum !== null);

              // MANDATORY COLOR RULES FOR ACTUAL:
              // - Before release: White (#F2F4F7 dark / #151D2A light)
              // - After release Good for USD (engine eventBiasForGold === 'SELL'): Green
              // - After release Bad for USD (engine eventBiasForGold === 'BUY'): Red
              // - After release Neutral / no conclusion (engine eventBiasForGold === 'MIXED'): White
              const actualTextColorClass = !isReleasedWithActual
                ? 'text-[#151D2A] dark:text-[#F2F4F7]'
                : ev.eventBiasForGold === 'SELL'
                ? 'text-[#059669] dark:text-[#00A878]'
                : ev.eventBiasForGold === 'BUY'
                ? 'text-[#E11D48] dark:text-[#E05260]'
                : 'text-[#151D2A] dark:text-[#F2F4F7]';

              const usdInterpretationLabel = !isReleasedWithActual
                ? ev.eventBiasForGold === 'SELL'
                  ? tr('Pre-News: Pro USD (SELL XAU)', 'Pre-News: Pro USD (SELL XAU)')
                  : ev.eventBiasForGold === 'BUY'
                  ? tr('Pre-News: Lemah USD (BUY XAU)', 'Pre-News: Weak USD (BUY XAU)')
                  : tr('Pre-News: Netral', 'Pre-News: Neutral')
                : ev.eventBiasForGold === 'SELL'
                ? tr('Good for USD · SELL XAU/USD', 'Good for USD · SELL XAU/USD')
                : ev.eventBiasForGold === 'BUY'
                ? tr('Bad for USD · BUY XAU/USD', 'Bad for USD · BUY XAU/USD')
                : tr('Netral · MIXED XAU/USD', 'Neutral · MIXED XAU/USD');

              const preNewsEval =
                isReleasedWithActual && ev.forecastNum !== null && ev.previousNum !== null
                  ? evaluateSingleEventForGold(ev.title, null, ev.forecastNum, ev.previousNum)
                  : null;
              const isFlipped = Boolean(
                preNewsEval &&
                  preNewsEval.bias !== 'MIXED' &&
                  ev.eventBiasForGold !== 'MIXED' &&
                  preNewsEval.bias !== ev.eventBiasForGold
              );
              const isExpanded = Boolean(expandedCalendarEventIds[ev.id]);

              return (
                <div key={ev.id} className="py-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#697586] dark:text-[#929BA9] font-mono-numbers tabular-nums">
                        <span>{formatTimestampWib(ev.date, isEn ? 'en' : 'id')}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-sans">{pillarBadgeLabel(ev.pillar)}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-sans">{ev.impact}</span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={`font-sans font-semibold ${
                            isPastItem
                              ? 'text-[#1769E8] dark:text-[#3478DC]'
                              : 'text-[#E11D48] dark:text-[#E05260]'
                          }`}
                        >
                          {isPastItem ? tr('Sudah Rilis', 'Released') : tr('Pre-News', 'Pre-News')}
                        </span>
                        {isActiveTarget && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-sans font-semibold text-[#151D2A] dark:text-white">
                              {tr('Target Aktif', 'Active Target')}
                            </span>
                          </>
                        )}
                      </div>

                      <h3 className="text-sm sm:text-[15px] font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                        {ev.title}
                      </h3>
                    </div>

                    {isPrimaryItem && !isActiveTarget && (
                      <button
                        type="button"
                        onClick={() => handleSelectEventGroup(ev.id)}
                        className="min-h-[34px] px-3 py-1 rounded-lg bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] hover:border-black/25 dark:hover:border-white/25 text-xs font-semibold text-[#151D2A] dark:text-[#F2F4F7] whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {tr('Analisis', 'Analyze')}
                      </button>
                    )}
                  </div>

                  {/* Aligned 3-Column Numbers: Previous = White, Forecast = White, Actual = White pre-release / USD semantic post-release */}
                  <div className="grid grid-cols-3 gap-3 py-1 font-mono-numbers tabular-nums">
                    <div>
                      <span className="text-[11px] font-sans text-[#697586] dark:text-[#929BA9] block">
                        Previous
                      </span>
                      <span className="text-sm font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                        {ev.previous || '—'}
                      </span>
                      {ev.previousRevisedFrom && (
                        <span className="text-[11px] font-sans text-[#697586] dark:text-[#929BA9] block mt-0.5">
                          {tr(`Rev. dari ${ev.previousRevisedFrom}`, `Rev. from ${ev.previousRevisedFrom}`)}
                        </span>
                      )}
                    </div>

                    <div>
                      <span className="text-[11px] font-sans text-[#697586] dark:text-[#929BA9] block">
                        Forecast
                      </span>
                      <span className="text-sm font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                        {ev.forecast || '—'}
                      </span>
                    </div>

                    <div>
                      <span className="text-[11px] font-sans text-[#697586] dark:text-[#929BA9] block">
                        Actual
                      </span>
                      <span
                        data-testid={`calendar-actual-${ev.id}`}
                        className={`text-sm font-bold ${actualTextColorClass}`}
                      >
                        {hasActualItem ? ev.actual : tr('Menunggu', 'Pending')}
                      </span>
                    </div>
                  </div>

                  {/* Fundamental Interpretation & Pre-News -> Post-News Comparison */}
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-medium text-[#697586] dark:text-[#929BA9]">
                          {usdInterpretationLabel}
                        </span>
                        {preNewsEval && (
                          <span className="font-mono-numbers tabular-nums text-[#697586] dark:text-[#929BA9]">
                            · {`Pre ${preNewsEval.bias} → Post ${ev.eventBiasForGold}`}
                          </span>
                        )}
                        {isFlipped && (
                          <span className="font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                            · {tr('Surprise Reversal', 'Surprise Reversal')}
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleExpandedEvent(ev.id)}
                        className="min-h-[30px] inline-flex items-center gap-1 text-xs font-medium text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7] cursor-pointer"
                      >
                        <span>
                          {isExpanded ? tr('Tutup Detail', 'Hide Note') : tr('Interpretasi', 'Interpretation')}
                        </span>
                        {isExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>

                    {isExpanded && (
                      <p className="text-xs sm:text-[13px] text-[#697586] dark:text-[#929BA9] leading-relaxed pt-1">
                        {isEn ? ev.biasReasonEn : ev.biasReasonId}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* SECTION 08 — FUNDAMENTAL ARGUMENTS / ADU ARGUMEN (DIRECT ON CANVAS) */}
      <section
        aria-label={tr('Adu Argumen Fundamental', 'Fundamental Arguments')}
        data-testid="macro-arguments-section"
        className="space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#697586] dark:text-[#929BA9]">
              {tr('ADU ARGUMEN FUNDAMENTAL', 'FUNDAMENTAL ARGUMENTS')}
            </h2>
            <p className="text-xs text-[#697586] dark:text-[#929BA9]">
              {tr('Ketuk faktor argumen untuk detail pendukung', 'Tap any argument for supporting detail')}
            </p>
          </div>

          <div className="inline-flex items-center p-1 rounded-lg bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D]">
            {(['BOTH', 'BUY', 'SELL'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setArgumentTab(tab)}
                className={`min-h-[34px] px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  argumentTab === tab
                    ? 'bg-[#151D2A] text-white dark:bg-white dark:text-[#050607]'
                    : 'text-[#697586] dark:text-[#929BA9]'
                }`}
              >
                {tab === 'BOTH' ? tr('Semua', 'Both') : tab}
              </button>
            ))}
          </div>
        </div>

        <div
          className={`grid grid-cols-1 gap-6 ${
            argumentTab === 'BOTH' ? 'md:grid-cols-2 md:gap-8' : ''
          }`}
        >
          {(argumentTab === 'BOTH' || argumentTab === 'BUY') && (
            <div className="space-y-2">
              <div className="pb-2 border-b border-[#DDE3EA] dark:border-[#20252D] flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-[#059669] dark:text-[#00A878]">
                  {tr('BULLISH ARGUMENTS · BUY', 'BULLISH ARGUMENTS · BUY')}
                </h3>
                <span className="text-xs font-mono-numbers tabular-nums text-[#697586] dark:text-[#929BA9]">
                  {activeMatrix.buyArguments.length}
                </span>
              </div>

              <div className="divide-y divide-[#DDE3EA] dark:divide-[#20252D]">
                {activeMatrix.buyArguments.map((arg, i) => (
                  <button
                    key={`buy-${i}`}
                    type="button"
                    onClick={() => setSelectedArgument({ side: 'BUY', item: arg })}
                    className="w-full py-3.5 px-2 text-left flex items-start justify-between gap-3 rounded-lg hover:bg-[#F5F7FA] dark:hover:bg-[#101318] transition-colors cursor-pointer min-h-[52px]"
                  >
                    <div className="min-w-0 space-y-1">
                      <span className="text-[11px] font-semibold text-[#059669] dark:text-[#00A878] block">
                        {pillarBadgeLabel(arg.pillar)} · {arg.tag}
                      </span>
                      <p className="text-xs sm:text-[13px] text-[#151D2A] dark:text-[#F2F4F7] leading-relaxed">
                        {isEn ? arg.textEn : arg.textId}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#697586] dark:text-[#929BA9] shrink-0 mt-1" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {(argumentTab === 'BOTH' || argumentTab === 'SELL') && (
            <div className="space-y-2">
              <div className="pb-2 border-b border-[#DDE3EA] dark:border-[#20252D] flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-[#E11D48] dark:text-[#E05260]">
                  {tr('BEARISH ARGUMENTS · SELL', 'BEARISH ARGUMENTS · SELL')}
                </h3>
                <span className="text-xs font-mono-numbers tabular-nums text-[#697586] dark:text-[#929BA9]">
                  {activeMatrix.sellArguments.length}
                </span>
              </div>

              <div className="divide-y divide-[#DDE3EA] dark:divide-[#20252D]">
                {activeMatrix.sellArguments.map((arg, i) => (
                  <button
                    key={`sell-${i}`}
                    type="button"
                    onClick={() => setSelectedArgument({ side: 'SELL', item: arg })}
                    className="w-full py-3.5 px-2 text-left flex items-start justify-between gap-3 rounded-lg hover:bg-[#F5F7FA] dark:hover:bg-[#101318] transition-colors cursor-pointer min-h-[52px]"
                  >
                    <div className="min-w-0 space-y-1">
                      <span className="text-[11px] font-semibold text-[#E11D48] dark:text-[#E05260] block">
                        {pillarBadgeLabel(arg.pillar)} · {arg.tag}
                      </span>
                      <p className="text-xs sm:text-[13px] text-[#151D2A] dark:text-[#F2F4F7] leading-relaxed">
                        {isEn ? arg.textEn : arg.textId}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#697586] dark:text-[#929BA9] shrink-0 mt-1" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* INTERACTIVE DETAIL SHEETS */}
      <IntermarketDetailSheet
        asset={selectedIntermarketAsset}
        onClose={() => setSelectedIntermarketAsset(null)}
      />

      <ArgumentDetailSheet
        selected={selectedArgument}
        matrix={activeMatrix}
        snapshot={{ ...snapshot, breakingNews: contextualBreakingNews }}
        pillarLabel={pillarBadgeLabel}
        onClose={() => setSelectedArgument(null)}
      />

      <TargetReleaseSheet
        isOpen={showTargetSelector}
        onClose={() => setShowTargetSelector(false)}
        explorerEventGroups={explorerEventGroups}
        activeGroupId={selectedEventId || nearestUpcomingGroup?.groupId}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        eventWindowFilter={eventWindowFilter}
        onWindowFilterChange={setEventWindowFilter}
        onSelectGroup={handleSelectEventGroup}
      />

      <PlaybookSheet
        isOpen={showPlaybookGuide}
        onClose={() => setShowPlaybookGuide(false)}
      />
    </div>
  );
};
