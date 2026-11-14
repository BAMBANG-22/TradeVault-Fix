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
} from './macroNewsEngine';
import {
  fetchClientForexFactoryCalendar,
  fetchClientYahooAsset,
  fetchClientBreakingHeadlinesWithHealth,
  fetchClientFedFundsFuturesBackup,
  fetchClientVixPulse,
  fetchClientGoldPositioning,
} from './macroFeedFetcher';
import { getApiEndpointCandidates, nativeAwarePostJson } from './apiConfig';

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
    calendarEvents,
    intermarketPulse,
    breakingNews,
    rssFeedHealth,
    cmeFedWatchBackup,
    selectedEventId,
    forceRefresh = false,
    priorCalendarEvents,
  } = params;

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

  const requestPayload = {
    forceRefresh,
    selectedEventId,
    clientFeeds: {
      calendarEvents,
      intermarketPulse,
      breakingNews,
      rssFeedHealth,
      cmeFedWatch: fallbackFedWatch,
    },
  };

  // 2. Call standalone server Gemini proxy (configured via VITE_API_BASE_URL or in-app setting for APK)
  const endpoints = getApiEndpointCandidates('/api/macro-news/analyze');
  for (const endpoint of endpoints) {
    const res = await nativeAwarePostJson(endpoint, requestPayload, 18000);

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
 * 3. Save to Supabase `macro_news_snapshots` table with full error reporting.
 */
export async function executeClientSideMacroAnalysis(
  selectedEventId?: string,
  forceRefresh = false,
  priorCalendarEvents?: MacroCalendarEvent[]
): Promise<{
  snapshot: MacroNewsSnapshot;
  supabaseResult: { success: boolean; error?: string; remoteSaved: boolean };
}> {
  // Step 1: Pull all live public feeds in parallel (never hangs even if one fails)
  const [calendarEvents, dxy, us02y, usoil, us10y, vix, goldPositioning, rssResult] = await Promise.all([
    fetchClientForexFactoryCalendar(),
    fetchClientYahooAsset('DXY', 'DX-Y.NYB', 'US Dollar Index (DXY)', 104.85, 104.42),
    fetchClientYahooAsset('US02Y', '2YY=F', 'US 2Y Treasury Yield', 4.25, 4.22),
    fetchClientYahooAsset('USOIL', 'CL=F', 'US Oil WTI Crude', 73.4, 71.95),
    fetchClientYahooAsset('US10Y', '^TNX', 'US 10Y Treasury Yield', 4.38, 4.31),
    fetchClientVixPulse(),
    fetchClientGoldPositioning(),
    fetchClientBreakingHeadlinesWithHealth(),
  ]);

  const breakingNews = rssResult.headlines;
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
      for (const sEv of analyzedSnapshot.calendarEvents) {
        if (sEv.actual && sEv.actual.trim()) {
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
    analyzedSnapshot.calendarEvents = calendarEvents.map((cEv) => {
      if (!cEv.actual || !cEv.actual.trim()) {
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
          };
        }
      }
      return cEv;
    });
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

  // Step 3: Insert directly into Supabase `macro_news_snapshots` (only if live calendar is verified)
  const supabaseResult = await saveMacroSnapshotToCache(analyzedSnapshot);

  return {
    snapshot: analyzedSnapshot,
    supabaseResult,
  };
}


