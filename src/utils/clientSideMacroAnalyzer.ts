import {
  MacroNewsSnapshot,
  MacroCalendarEvent,
  IntermarketAssetPulse,
  VixRiskPulse,
  GoldPositioningPulse,
  BreakingNewsHeadline,
  CmeFedWatchState,
  RssFeedHealthStatus,
  createUnavailableFedWatchState,
  computeDeterministicMacroSnapshot,
  saveMacroSnapshotToCache,
  evaluateSingleEventForGold,
  analyzeMacroEvent,
  detectPreviousRevisionsAndStreaks,
  loadLocalCachedMacroSnapshotSync,
  isPlaceholderMacroValue,
  recordReleasedActualsToOfflineArchive,
  hydrateEventsWithOfflineArchive,
  computeMacroThreeSystemState,
  recordBreakingNewsToMonthlyArchive,
  ensureHistoricalActualsArchiveSeeded,
  loadOfflineActualsArchive,
  FundamentalGoldSnapshot,
  computeFundamentalGoldSnapshot,
  loadLocalCachedFundamentalGoldSnapshotSync,
  loadLocalCachedCmeFedWatchSync,
  saveFundamentalGoldSnapshotToLocal,
  saveCmeFedWatchToLocal,
  computeFundamentalGoldCadenceSlot,
} from './macroNewsEngine';
import {
  fetchClientForexFactoryCalendar,
  fetchClientHistoricalActualsBackfill,
  fetchClientYahooAsset,
  fetchClientBreakingHeadlinesWithHealth,
  fetchClientFedFundsFuturesBackup,
  fetchClientVixPulse,
  fetchClientGoldPositioning,
  fetchClientExtendedFundamentalFeeds,
} from './macroFeedFetcher';
import {
  getApiEndpointCandidates,
  isNewsCycleOfflineMode,
  nativeAwarePostJson,
} from './apiConfig';

/**
 * Executes server-side Gemini analysis via /api/macro-news/analyze proxy.
 * Eliminates browser-side Gemini API calls so the application functions for every user.
 * Falls back deterministically to Master Playbook rules + live ZQ=F FedWatch backup if server or quota is unavailable.
 */
export async function analyzeMacroWithGeminiClient(params: {
  calendarEvents: MacroCalendarEvent[];
  intermarketPulse: {
    dxy: IntermarketAssetPulse;
    us02y?: IntermarketAssetPulse;
    usoil: IntermarketAssetPulse;
    us10y: IntermarketAssetPulse;
    vix?: VixRiskPulse;
    goldPositioning?: GoldPositioningPulse;
  };
  breakingNews: BreakingNewsHeadline[];
  rssFeedHealth?: RssFeedHealthStatus;
  cmeFedWatchBackup?: CmeFedWatchState;
  selectedEventId?: string;
  forceRefresh?: boolean;
  priorCalendarEvents?: MacroCalendarEvent[];
}): Promise<MacroNewsSnapshot> {
  const {
    calendarEvents: rawCalendarEvents,
    intermarketPulse,
    breakingNews,
    rssFeedHealth,
    cmeFedWatchBackup,
    selectedEventId,
    forceRefresh = false,
    priorCalendarEvents,
  } = params;

  // Persist any verified live actuals immediately, then hydrate missing/rolled-off actuals from Offline Archive
  recordReleasedActualsToOfflineArchive(rawCalendarEvents, 'LIVE_FEED');
  const calendarEvents = hydrateEventsWithOfflineArchive(rawCalendarEvents);

  const fallbackFedWatch =
    cmeFedWatchBackup && cmeFedWatchBackup.isAvailable
      ? cmeFedWatchBackup
      : createUnavailableFedWatchState();

  // 1. Calculate the baseline deterministic snapshot first as fallback
  const baselineSnapshot = computeDeterministicMacroSnapshot({
    calendarEvents,
    intermarketPulse,
    breakingNews,
    cmeFedWatch: fallbackFedWatch,
    selectedEventId,
    sourceMode: 'RULE_BASED_FALLBACK',
    modelUsed: 'deterministic-playbook-v1',
    priorCalendarEvents,
  });
  baselineSnapshot.rssFeedHealth = rssFeedHealth;
  baselineSnapshot.threeSystemState = computeMacroThreeSystemState({
    snapshot: baselineSnapshot,
    selectedEventId,
  });

  const requestPayload = {
    forceRefresh,
    selectedEventId,
    baselineSnapshot,
    clientFeeds: {
      calendarEvents,
      intermarketPulse,
      breakingNews,
      rssFeedHealth,
      cmeFedWatch: fallbackFedWatch,
    },
  };

  // 1b. If News & Cycle Offline Mode is active, NEVER call Gemini API
  if (isNewsCycleOfflineMode()) {
    return baselineSnapshot;
  }

  // 2. Call standalone server Gemini proxy (configured via VITE_API_BASE_URL or Supabase Edge for APK)
  const endpoints = getApiEndpointCandidates('/api/macro-news/analyze');
  for (const endpoint of endpoints) {
    const res = await nativeAwarePostJson(endpoint, requestPayload, 45000);

    if (res.ok && res.json?.success && res.json?.snapshot) {
      return res.json.snapshot as MacroNewsSnapshot;
    }
  }

  // 3. Resilient fallback to deterministic Master Playbook rules if server is unreachable
  return baselineSnapshot;
}

/**
 * End-to-end client-side workflow:
 * 1. Parallel fetch of ForexFactory + Yahoo Finance 2x2 Grid (DXY, US02Y, US10Y, USOIL) + VIX + GC=F + ZQ=F / ^IRX + Breaking News RSS.
 * 2. Analyze via server-side Gemini proxy (/api/macro-news/analyze) including Google Search Grounding for CME FedWatch & live ZQ=F Futures backup.
 * 3. Persist verified actuals to Offline Archive & save snapshot to Supabase `macro_news_snapshots`.
 */
const HIST_BACKFILL_LAST_SYNC_KEY = 'tradevault_macro_hist_backfill_last_v1';
const HIST_BACKFILL_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/**
 * Ensures the offline archive has the verified Sep–Nov 2026 baseline and pulls up to 90 days
 * of released USD macro actuals (CPI, PPI, NFP, PCE, FOMC, GDP, Retail Sales, ISM) at 0 Gemini tokens.
 */
export async function syncHistoricalActualsArchive(force = false): Promise<{
  totalRecords: number;
  syncedLiveCount: number;
}> {
  const seeded = ensureHistoricalActualsArchiveSeeded();
  if (isNewsCycleOfflineMode()) {
    return { totalRecords: seeded.length, syncedLiveCount: 0 };
  }

  let shouldFetch = force || seeded.length < 25;
  if (!shouldFetch && typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      const lastRaw = localStorage.getItem(HIST_BACKFILL_LAST_SYNC_KEY);
      const lastMs = lastRaw ? Number(lastRaw) : 0;
      if (!Number.isFinite(lastMs) || Date.now() - lastMs >= HIST_BACKFILL_COOLDOWN_MS) {
        shouldFetch = true;
      }
    } catch {
      shouldFetch = true;
    }
  }

  if (!shouldFetch) {
    return { totalRecords: seeded.length, syncedLiveCount: 0 };
  }

  try {
    const backfillEvents = await fetchClientHistoricalActualsBackfill(90);
    if (backfillEvents.length > 0) {
      const updated = recordReleasedActualsToOfflineArchive(backfillEvents, 'TV_ENRICH');
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(HIST_BACKFILL_LAST_SYNC_KEY, String(Date.now()));
        } catch {}
      }
      return { totalRecords: updated.length, syncedLiveCount: backfillEvents.length };
    }
  } catch {
    // Non-blocking: baseline seed remains available offline
  }
  return { totalRecords: loadOfflineActualsArchive().length, syncedLiveCount: 0 };
}

export async function executeClientSideMacroAnalysis(
  selectedEventId?: string,
  forceRefresh = false,
  priorCalendarEvents?: MacroCalendarEvent[]
): Promise<{
  snapshot: MacroNewsSnapshot;
  supabaseResult: { success: boolean; error?: string; remoteSaved: boolean };
}> {
  ensureHistoricalActualsArchiveSeeded();

  if (isNewsCycleOfflineMode()) {
    const cachedSnap = loadLocalCachedMacroSnapshotSync();
    if (cachedSnap) {
      return {
        snapshot: {
          ...cachedSnap,
          calendarEvents: hydrateEventsWithOfflineArchive(cachedSnap.calendarEvents),
        },
        supabaseResult: { success: false, remoteSaved: false },
      };
    }
    throw new Error('Mode Offline aktif dan belum ada cache lokal Trade News tersimpan.');
  }

  // Step 1: Pull all live public feeds + throttled 90-day 0-token historical backfill in parallel
  const [rawCalendarEvents, _backfillRes, dxy, us02y, usoil, us10y, vix, goldPositioning, rssResult] =
    await Promise.all([
      fetchClientForexFactoryCalendar(),
      syncHistoricalActualsArchive(forceRefresh),
      fetchClientYahooAsset('DXY', 'DX-Y.NYB', 'US Dollar Index (DXY)', 104.85, 104.42),
      fetchClientYahooAsset('US02Y', '2YY=F', 'US 2Y Treasury Yield', 4.25, 4.22),
      fetchClientYahooAsset('USOIL', 'CL=F', 'US Oil WTI Crude', 73.4, 71.95),
      fetchClientYahooAsset('US10Y', '^TNX', 'US 10Y Treasury Yield', 4.38, 4.31),
      fetchClientVixPulse(),
      fetchClientGoldPositioning(),
      fetchClientBreakingHeadlinesWithHealth(),
    ]);

  // Persist any fresh calendar actuals immediately and fill gaps/prior-week releases from Offline Archive
  if (rawCalendarEvents.length > 0) {
    recordReleasedActualsToOfflineArchive(rawCalendarEvents, 'LIVE_FEED');
  }
  const calendarEvents = hydrateEventsWithOfflineArchive(rawCalendarEvents);

  const breakingNews = rssResult.headlines;
  if (breakingNews.length > 0) {
    recordBreakingNewsToMonthlyArchive(breakingNews);
  }
  const rssFeedHealth = rssResult.rssFeedHealth;

  const intermarketPulse = { dxy, us02y, usoil, us10y, vix, goldPositioning };
  const cmeFedWatchBackup = await fetchClientFedFundsFuturesBackup(us10y);

  // Step 2: Analyze with server-side Gemini proxy
  const analyzedSnapshot = await analyzeMacroWithGeminiClient({
    calendarEvents,
    intermarketPulse,
    breakingNews,
    rssFeedHealth,
    cmeFedWatchBackup,
    selectedEventId,
    forceRefresh,
    priorCalendarEvents,
  });
  if (!analyzedSnapshot.rssFeedHealth && rssFeedHealth) {
    analyzedSnapshot.rssFeedHealth = rssFeedHealth;
  }

  // Preserve live calendar events from client or server (including server TradingView / Grounding actual enrichment)
  if (calendarEvents.length > 0 && calendarEvents.every((e) => e.isLiveFeed)) {
    const serverActualBySlot = new Map<string, { actual: string; actualNum: number | null; unit?: string }>();
    const serverActualByTitle = new Map<string, { actual: string; actualNum: number | null; unit?: string }>();
    if (Array.isArray(analyzedSnapshot.calendarEvents)) {
      const serverEnrichedWithNums = analyzedSnapshot.calendarEvents.filter(
        (sEv) => !isPlaceholderMacroValue(sEv.actual)
      );
      if (serverEnrichedWithNums.length > 0) {
        recordReleasedActualsToOfflineArchive(serverEnrichedWithNums, 'TV_ENRICH');
      }
      for (const sEv of analyzedSnapshot.calendarEvents) {
        if (!isPlaceholderMacroValue(sEv.actual)) {
          const titleKey = sEv.title.trim().toLowerCase();
          const slotKey = `${titleKey}|${(sEv.date || '').slice(0, 13)}`;
          const entry = {
            actual: sEv.actual.trim(),
            actualNum: sEv.actualNum ?? null,
            unit: sEv.unit,
          };
          serverActualBySlot.set(slotKey, entry);
          if (!serverActualByTitle.has(titleKey)) {
            serverActualByTitle.set(titleKey, entry);
          }
        }
      }
    }
    let anyActualUpdated = false;
    const mergedCal = calendarEvents.map((cEv) => {
      if (isPlaceholderMacroValue(cEv.actual)) {
        const titleKey = cEv.title.trim().toLowerCase();
        const slotKey = `${titleKey}|${(cEv.date || '').slice(0, 13)}`;
        const enriched = serverActualBySlot.get(slotKey) || serverActualByTitle.get(titleKey);
        if (enriched) {
          anyActualUpdated = true;
          const evalResult = evaluateSingleEventForGold(
            cEv.title,
            enriched.actualNum,
            cEv.forecastNum,
            cEv.previousNum
          );
          return {
            ...cEv,
            actual: enriched.actual,
            actualNum: enriched.actualNum,
            unit: enriched.unit || cEv.unit,
            eventBiasForGold: evalResult.bias,
            biasReasonId: evalResult.reasonId,
            biasReasonEn: evalResult.reasonEn,
            actualSource: 'TV_ENRICH' as const,
          };
        }
      }
      return cEv;
    });
    analyzedSnapshot.calendarEvents = hydrateEventsWithOfflineArchive(mergedCal);
    if (anyActualUpdated) {
      const refreshed = analyzeMacroEvent({
        calendarEvents: analyzedSnapshot.calendarEvents,
        intermarketPulse: analyzedSnapshot.intermarketPulse,
        breakingNews: analyzedSnapshot.breakingNews,
        cmeFedWatch: analyzedSnapshot.cmeFedWatch,
        selectedEventId,
        sourceMode: analyzedSnapshot.sourceMode,
        modelUsed: analyzedSnapshot.modelUsed,
        priorCalendarEvents,
      });
      analyzedSnapshot.scenarioMatrix = refreshed.scenarioMatrix;
      analyzedSnapshot.dominantBias = refreshed.dominantBias;
      analyzedSnapshot.dataFingerprint = refreshed.dataFingerprint;
    }
    analyzedSnapshot.isCalendarLiveFeed = true;
  } else {
    if (Array.isArray(analyzedSnapshot.calendarEvents)) {
      recordReleasedActualsToOfflineArchive(analyzedSnapshot.calendarEvents, 'LIVE_FEED');
      analyzedSnapshot.calendarEvents = hydrateEventsWithOfflineArchive(analyzedSnapshot.calendarEvents);
    }
    analyzedSnapshot.isCalendarLiveFeed =
      Array.isArray(analyzedSnapshot.calendarEvents) &&
      analyzedSnapshot.calendarEvents.length > 0 &&
      analyzedSnapshot.calendarEvents.every((e) => e.isLiveFeed === true);
  }

  // Ensure client-computed prior previous revisions are preserved if server did not receive priorCalendarEvents
  if (priorCalendarEvents && priorCalendarEvents.length > 0 && analyzedSnapshot.calendarEvents.length > 0) {
    const revCheck = detectPreviousRevisionsAndStreaks(analyzedSnapshot.calendarEvents, priorCalendarEvents);
    analyzedSnapshot.calendarEvents = revCheck.eventsWithRevisions;
    if (analyzedSnapshot.scenarioMatrix?.preNewsFlow && revCheck.previousRevisions.length > 0) {
      analyzedSnapshot.scenarioMatrix.preNewsFlow = {
        ...analyzedSnapshot.scenarioMatrix.preNewsFlow,
        previousRevisions: revCheck.previousRevisions,
      };
    }
  }

  // Ensure VIX and GC=F positioning remain attached if server did not include them
  if (analyzedSnapshot.intermarketPulse) {
    if (!analyzedSnapshot.intermarketPulse.vix?.isAvailable && vix.isAvailable) {
      analyzedSnapshot.intermarketPulse.vix = vix;
    }
    if (!analyzedSnapshot.intermarketPulse.goldPositioning?.isAvailable && goldPositioning.isAvailable) {
      analyzedSnapshot.intermarketPulse.goldPositioning = goldPositioning;
    }
  }

  // Ensure CME FedWatch is always populated with either CME Grounding or Live ZQ=F Futures Backup
  if (!analyzedSnapshot.cmeFedWatch || !analyzedSnapshot.cmeFedWatch.isAvailable) {
    analyzedSnapshot.cmeFedWatch =
      analyzedSnapshot.scenarioMatrix?.cmeFedWatch?.isAvailable
        ? analyzedSnapshot.scenarioMatrix.cmeFedWatch
        : cmeFedWatchBackup.isAvailable
        ? cmeFedWatchBackup
        : createUnavailableFedWatchState();
  }
  if (
    analyzedSnapshot.scenarioMatrix &&
    (!analyzedSnapshot.scenarioMatrix.cmeFedWatch ||
      !analyzedSnapshot.scenarioMatrix.cmeFedWatch.isAvailable)
  ) {
    analyzedSnapshot.scenarioMatrix.cmeFedWatch = analyzedSnapshot.cmeFedWatch;
  }

  if (forceRefresh) {
    analyzedSnapshot.analyzedAt = new Date().toISOString();
  }

  // Compute unified 3-System state and keep dominantBias aligned for Cycle & Signal (0 tokens)
  analyzedSnapshot.threeSystemState = computeMacroThreeSystemState({
    snapshot: analyzedSnapshot,
    selectedEventId,
  });
  analyzedSnapshot.dominantBias = analyzedSnapshot.threeSystemState.effectiveFundamentalBias;

  if (analyzedSnapshot.cmeFedWatch?.isAvailable) {
    saveCmeFedWatchToLocal(analyzedSnapshot.cmeFedWatch);
  }

  // Step 3: Insert directly into Supabase `macro_news_snapshots` (only if live calendar is verified)
  const supabaseResult = await saveMacroSnapshotToCache(analyzedSnapshot);

  return {
    snapshot: analyzedSnapshot,
    supabaseResult,
  };
}

/**
 * Resolves the cleanest, most up-to-date CME FedWatch state by combining:
 * 1) Fresh Gemini Google Search Grounding data (cached via Trade News or dedicated FedWatch cache),
 * 2) Live 30-Day Fed Funds Futures (`ZQ=F`) & `^IRX` T-Bill backup calculation.
 */
function resolveSyncedCmeFedWatchState(params: {
  futuresBackup: CmeFedWatchState;
  forceRefresh: boolean;
}): CmeFedWatchState {
  const { futuresBackup, forceRefresh } = params;
  const cachedFedWatch = loadLocalCachedCmeFedWatchSync(4 * 60 * 60 * 1000);
  const cachedMacroFedWatch = loadLocalCachedMacroSnapshotSync()?.cmeFedWatch;

  const groundedCandidate = [cachedFedWatch, cachedMacroFedWatch].find(
    (item): item is CmeFedWatchState =>
      Boolean(
        item &&
          item.isAvailable &&
          typeof item.sourceLabel === 'string' &&
          item.sourceLabel.includes('Grounding')
      )
  );

  if (!forceRefresh && groundedCandidate) {
    const merged: CmeFedWatchState = {
      ...groundedCandidate,
      impliedFedFundsRate:
        futuresBackup.isAvailable && futuresBackup.impliedFedFundsRate != null
          ? futuresBackup.impliedFedFundsRate
          : groundedCandidate.impliedFedFundsRate,
      zqFuturesPrice:
        futuresBackup.isAvailable && futuresBackup.zqFuturesPrice != null
          ? futuresBackup.zqFuturesPrice
          : groundedCandidate.zqFuturesPrice,
      irxTbillYield:
        futuresBackup.isAvailable && futuresBackup.irxTbillYield != null
          ? futuresBackup.irxTbillYield
          : groundedCandidate.irxTbillYield,
      targetRateRange:
        groundedCandidate.targetRateRange || futuresBackup.targetRateRange,
    };
    return merged;
  }

  if (futuresBackup.isAvailable) {
    saveCmeFedWatchToLocal(futuresBackup);
    return futuresBackup;
  }

  if (cachedFedWatch?.isAvailable) return cachedFedWatch;
  if (cachedMacroFedWatch?.isAvailable) return cachedMacroFedWatch;
  return createUnavailableFedWatchState();
}

/**
 * Executes comprehensive Structural Fundamental Gold (XAU/USD) analysis across
 * 1-Day, 1-Week, and 1-Month horizons using all macro pillars, US equities, real yields,
 * CFTC COT, China/G10 FX, bond stress, and geopolitical news wires.
 * Uses a smart fingerprint check so unchanged fundamental conditions preserve existing
 * AI narratives cleanly with an honest "Data masih sama" notice at 0 extra tokens.
 */
export async function executeClientSideFundamentalGoldAnalysis(options?: {
  forceRefresh?: boolean;
  forceRewriteAi?: boolean;
}): Promise<FundamentalGoldSnapshot> {
  const { forceRefresh = false, forceRewriteAi = false } = options || {};
  ensureHistoricalActualsArchiveSeeded();
  const previousSnapshot = loadLocalCachedFundamentalGoldSnapshotSync();

  const createUnavailableAsset = (
    symbol: 'DXY' | 'USOIL' | 'US10Y' | 'US02Y',
    yahooTicker: string,
    name: string
  ) => ({
    symbol,
    yahooTicker,
    name,
    price: 0,
    previousClose: 0,
    change: 0,
    changePercent: 0,
    direction: 'FLAT' as const,
    goldCorrelationEffect: 'NEUTRAL' as const,
    summaryId: `${name} belum tersedia`,
    summaryEn: `${name} unavailable`,
    updatedAt: new Date().toISOString(),
    isAvailable: false,
  });

  const isManualOffline = isNewsCycleOfflineMode();
  const isDeviceOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

  if (isManualOffline || isDeviceOffline) {
    if (previousSnapshot) {
      const updatedOffline: FundamentalGoldSnapshot = {
        ...previousSnapshot,
        analyzedAt: new Date().toISOString(),
        cadenceSchedule: computeFundamentalGoldCadenceSlot(),
        changeDetection: {
          ...previousSnapshot.changeDetection,
          hasChanged: false,
          statusTitleId: isManualOffline
            ? 'Mode Offline · Data Tersimpan'
            : 'Koneksi Terputus · Data Tersimpan',
          statusTitleEn: isManualOffline
            ? 'Offline Mode · Saved Readout'
            : 'No Connection · Saved Readout',
          statusDetailId: isManualOffline
            ? 'Mode Offline aktif. Menampilkan pembacaan fundamental terakhir yang tersimpan di perangkat.'
            : 'Perangkat sedang offline. Menampilkan pembacaan fundamental terakhir yang tersimpan tanpa menunggu timeout jaringan.',
          statusDetailEn: isManualOffline
            ? 'Offline Mode is active. Displaying the latest fundamental readout stored on device.'
            : 'Device is offline. Displaying the latest stored fundamental readout instantly.',
        },
      };
      return updatedOffline;
    }

    const offlineCalendar = hydrateEventsWithOfflineArchive([]);
    const offlineSnap = computeFundamentalGoldSnapshot({
      calendarEvents: offlineCalendar,
      intermarketPulse: {
        dxy: createUnavailableAsset('DXY', 'DX-Y.NYB', 'US Dollar Index (DXY)'),
        us02y: createUnavailableAsset('US02Y', '2YY=F', 'US 2Y Treasury Yield'),
        usoil: createUnavailableAsset('USOIL', 'CL=F', 'US Oil WTI Crude'),
        us10y: createUnavailableAsset('US10Y', '^TNX', 'US 10Y Treasury Yield'),
      },
      breakingNews: [],
      cmeFedWatch: createUnavailableFedWatchState(),
      previousSnapshot: null,
    });
    saveFundamentalGoldSnapshotToLocal(offlineSnap);
    return offlineSnap;
  }

  // Pull core macro feeds + extended cross-asset feeds in parallel with strict per-feed isolation (APK-safe)
  const [
    rawCalendarEvents,
    _backfillRes,
    dxy,
    us02y,
    usoil,
    us10y,
    vix,
    goldPositioning,
    rssResult,
    extendedFeeds,
  ] = await Promise.all([
    fetchClientForexFactoryCalendar().catch(() => []),
    syncHistoricalActualsArchive(forceRefresh).catch(() => null),
    fetchClientYahooAsset('DXY', 'DX-Y.NYB', 'US Dollar Index (DXY)', 104.85, 104.42).catch(() =>
      createUnavailableAsset('DXY', 'DX-Y.NYB', 'US Dollar Index (DXY)')
    ),
    fetchClientYahooAsset('US02Y', '2YY=F', 'US 2Y Treasury Yield', 4.25, 4.22).catch(() =>
      createUnavailableAsset('US02Y', '2YY=F', 'US 2Y Treasury Yield')
    ),
    fetchClientYahooAsset('USOIL', 'CL=F', 'US Oil WTI Crude', 73.4, 71.95).catch(() =>
      createUnavailableAsset('USOIL', 'CL=F', 'US Oil WTI Crude')
    ),
    fetchClientYahooAsset('US10Y', '^TNX', 'US 10Y Treasury Yield', 4.38, 4.31).catch(() =>
      createUnavailableAsset('US10Y', '^TNX', 'US 10Y Treasury Yield')
    ),
    fetchClientVixPulse().catch(() => undefined),
    fetchClientGoldPositioning().catch(() => undefined),
    fetchClientBreakingHeadlinesWithHealth().catch(() => ({
      headlines: [],
      health: [],
    })),
    fetchClientExtendedFundamentalFeeds().catch(() => ({
      externalEvents: [],
    })),
  ]);

  if (rawCalendarEvents.length > 0) {
    recordReleasedActualsToOfflineArchive(rawCalendarEvents, 'LIVE_FEED');
  }
  const calendarEvents = hydrateEventsWithOfflineArchive(rawCalendarEvents);
  const breakingNews = Array.isArray(rssResult?.headlines) ? rssResult.headlines : [];
  if (breakingNews.length > 0) {
    recordBreakingNewsToMonthlyArchive(breakingNews);
  }
  const intermarketPulse = { dxy, us02y, usoil, us10y, vix, goldPositioning };
  const futuresBackupFedWatch = await fetchClientFedFundsFuturesBackup(us10y).catch(() =>
    createUnavailableFedWatchState()
  );
  const cmeFedWatch = resolveSyncedCmeFedWatchState({
    futuresBackup: futuresBackupFedWatch,
    forceRefresh,
  });

  const deterministicSnapshot = computeFundamentalGoldSnapshot({
    calendarEvents,
    intermarketPulse,
    breakingNews,
    cmeFedWatch,
    extendedFeeds,
    previousSnapshot,
  });

  // Smart Unchanged Data Detection: If fundamental drivers haven't shifted and previous AI narrative exists, skip Gemini (0 tokens!)
  const isUnchangedWithPriorAi =
    !forceRewriteAi &&
    previousSnapshot &&
    previousSnapshot.sourceMode === 'GEMINI_AI' &&
    previousSnapshot.fundamentalFingerprint === deterministicSnapshot.fundamentalFingerprint;

  if (isUnchangedWithPriorAi && previousSnapshot) {
    const preservedUnchanged: FundamentalGoldSnapshot = {
      ...deterministicSnapshot,
      sourceMode: 'GEMINI_AI',
      modelUsed: previousSnapshot.modelUsed,
      narrative: {
        id: {
          ...previousSnapshot.narrative.id,
          dataStatusNote: deterministicSnapshot.changeDetection.statusDetailId,
          sectionA_StatusAndChange: `Belum ada pergeseran fundamental besar sejak pengecekan terakhir — struktur makro tetap konsisten. ${previousSnapshot.narrative.id.sectionA_StatusAndChange.replace(/^(Data fundamental masih sama seperti pengecekan sebelumnya|Belum ada pergeseran fundamental besar sejak pengecekan terakhir)[^.]*\.\s*/i, '')}`,
        },
        en: {
          ...previousSnapshot.narrative.en,
          dataStatusNote: deterministicSnapshot.changeDetection.statusDetailEn,
          sectionA_StatusAndChange: `No major fundamental shift since the last check — the macro regime remains intact. ${previousSnapshot.narrative.en.sectionA_StatusAndChange.replace(/^(Fundamental data remains consistent with the previous check|No major fundamental shift since the last check)[^.]*\.\s*/i, '')}`,
        },
      },
    };
    saveFundamentalGoldSnapshotToLocal(preservedUnchanged);
    return preservedUnchanged;
  }

  // Request AI Macro Desk Brief synthesis + grounded CME FedWatch sync from /api/macro-news/fundamental
  const endpoints = getApiEndpointCandidates('/api/macro-news/fundamental');
  const payload = {
    forceRefresh: forceRefresh || forceRewriteAi,
    baselineSnapshot: deterministicSnapshot,
    cmeFedWatch,
    previousSnapshot: previousSnapshot
      ? {
          fundamentalFingerprint: previousSnapshot.fundamentalFingerprint,
          analyzedAt: previousSnapshot.analyzedAt,
          overallBias: previousSnapshot.overallBias,
          bullishProbability: previousSnapshot.bullishProbability,
          marketRegime: previousSnapshot.marketRegime,
        }
      : null,
    contextSummary: {
      topHeadlines: breakingNews.slice(0, 8).map((h) => ({
        title: h.title,
        sentiment: h.sentimentForGold,
        channel: h.channelType,
        source: h.source,
      })),
      externalEvents: (extendedFeeds?.externalEvents || []).slice(0, 6),
    },
  };

  for (const endpoint of endpoints) {
    try {
      const res = await nativeAwarePostJson(endpoint, payload, 40000);
      const candidate = res.json?.snapshot as FundamentalGoldSnapshot | undefined;
      if (res.json?.cmeFedWatch?.isAvailable) {
        saveCmeFedWatchToLocal(res.json.cmeFedWatch as CmeFedWatchState);
      }
      if (
        res.ok &&
        res.json?.success &&
        candidate &&
        candidate.instrument === 'XAUUSD' &&
        candidate.horizons &&
        candidate.narrative?.id &&
        candidate.narrative?.en
      ) {
        saveFundamentalGoldSnapshotToLocal(candidate);
        return candidate;
      }
    } catch {
      // Fallback cleanly to next candidate or local deterministic engine
    }
  }

  // Resilient deterministic fallback if backend or quota is unavailable
  saveFundamentalGoldSnapshotToLocal(deterministicSnapshot);
  return deterministicSnapshot;
}



