/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Comprehensive Android APK & Web Runtime Self-Diagnostic Probe.
 * Verifies build identity, WebView/SW cache purge status, Supabase Edge AI keys & proxy allowlist,
 * live real-time feeds (Vela/TwelveData, Polymarket), offline caches, and 3-feature Macro/Fundamental/Cycle sync.
 */

import { CapacitorHttp } from '@capacitor/core';
import { getAppBuildIdentity, type AppBuildIdentity } from '../config/appVersion';
import {
  buildBackendAuthHeaders,
  getApiEndpointCandidates,
  getBackendSourceInfo,
  isNativeAndroidOrIos,
  isNewsCycleOfflineMode,
} from './apiConfig';
import {
  loadLocalCachedCmeFedWatchSync,
  loadLocalCachedFundamentalGoldSnapshotSync,
  loadLocalCachedMacroSnapshotSync,
  loadOfflineActualsArchive,
} from './macroNewsEngine';
import {
  fetchPolymarketMacroSentiment,
  loadCachedPolymarketMacroSnapshot,
} from './polymarketMacroSentiment';
import { TradeVaultVelaProvider } from './velaTradeVaultProvider';

export interface NativeAndroidAppInfo {
  available: boolean;
  versionCode: number;
  versionName: string;
  lastUpdateTime: number;
  webViewCacheClearedOnBoot: boolean;
}

export interface BackendDiagnosticResult {
  status: 'ok' | 'degraded' | 'offline_skipped' | 'error';
  url: string;
  source: 'custom' | 'env' | 'supabase-edge' | 'none';
  httpStatus: number;
  service?: string;
  scannerGeminiConfigured: boolean;
  newsGeminiConfigured: boolean;
  groqConfigured?: boolean;
  openRouterConfigured?: boolean;
  agentDeskReady?: boolean;
  apiKeysStrictlySeparated: boolean;
  proxyCapabilities?: {
    polymarket: boolean;
    cftc: boolean;
    twelvedata: boolean;
    binance: boolean;
  };
  latencyMs: number;
  note: string;
}

export interface LiveFeedDiagnosticResult {
  status: 'ok' | 'cache' | 'offline_skipped' | 'error';
  source: string;
  count: number;
  latencyMs: number;
  note: string;
}

export interface MacroSyncConsistencyAudit {
  status: 'aligned' | 'partial' | 'drift' | 'empty';
  macroBias: string;
  macroAnalyzedAt: string | null;
  macroSourceMode: string | null;
  fundamentalBias: string;
  fundamentalAnalyzedAt: string | null;
  fundamentalSourceMode: string | null;
  fedWatchDominant: string | null;
  fedWatchUpdatedAt: string | null;
  offlineActualsCount: number;
  localCandleBuckets: number;
  polymarketCachedCount: number;
  polymarketFetchedAt: string | null;
  noteId: string;
  noteEn: string;
}

export interface FullApkSystemProbeResult {
  probedAtIso: string;
  build: AppBuildIdentity;
  nativeApp: NativeAndroidAppInfo;
  swPurgedChangeCode: string | null;
  cachePurgeMatchesBuild: boolean;
  isOfflineMode: boolean;
  navigatorOnline: boolean;
  backend: BackendDiagnosticResult;
  velaChartFeed: LiveFeedDiagnosticResult;
  polymarketFeed: LiveFeedDiagnosticResult;
  macroSync: MacroSyncConsistencyAudit;
}

export function readNativeAndroidAppInfo(): NativeAndroidAppInfo {
  if (typeof window !== 'undefined' && typeof window.TradeVaultSystemBars?.getNativeAppInfo === 'function') {
    try {
      const raw = window.TradeVaultSystemBars.getNativeAppInfo();
      const parsed = JSON.parse(raw);
      return {
        available: true,
        versionCode: Number(parsed?.versionCode) || 0,
        versionName: String(parsed?.versionName || 'unknown'),
        lastUpdateTime: Number(parsed?.lastUpdateTime) || 0,
        webViewCacheClearedOnBoot: Boolean(parsed?.webViewCacheClearedOnBoot),
      };
    } catch {
      // ignore bridge parse error
    }
  }
  return {
    available: false,
    versionCode: 0,
    versionName: 'web',
    lastUpdateTime: 0,
    webViewCacheClearedOnBoot: false,
  };
}

function countLocalCandleCacheBuckets(): number {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return 0;
  let count = 0;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith('tradevault_candle_cache_v5_')) {
        count += 1;
      }
    }
  } catch {
    // ignore storage iteration error
  }
  return count;
}

export function inspectMacroSyncConsistency(): MacroSyncConsistencyAudit {
  const macro = loadLocalCachedMacroSnapshotSync();
  const fundamental = loadLocalCachedFundamentalGoldSnapshotSync();
  const fedWatch = loadLocalCachedCmeFedWatchSync();
  const poly = loadCachedPolymarketMacroSnapshot();
  const offlineActualsCount = loadOfflineActualsArchive().length;
  const localCandleBuckets = countLocalCandleCacheBuckets();

  const macroBias = macro?.dominantBias || 'NONE';
  const fundamentalBias = fundamental?.overallBias || 'NONE';
  const mappedFundamental =
    fundamentalBias === 'BULLISH'
      ? 'BUY'
      : fundamentalBias === 'BEARISH'
      ? 'SELL'
      : fundamentalBias === 'NEUTRAL'
      ? 'MIXED'
      : 'NONE';

  let status: MacroSyncConsistencyAudit['status'] = 'empty';
  let noteId = 'Belum ada snapshot Trade News atau Fundamental Gold di cache perangkat.';
  let noteEn = 'No Trade News or Fundamental Gold snapshots stored on device yet.';

  if (macro && fundamental) {
    const macroMs = macro.analyzedAt ? Date.parse(macro.analyzedAt) : 0;
    const fundMs = fundamental.analyzedAt ? Date.parse(fundamental.analyzedAt) : 0;
    const gapMinutes =
      Number.isFinite(macroMs) && Number.isFinite(fundMs)
        ? Math.round(Math.abs(macroMs - fundMs) / 60000)
        : 0;
    const opposingDirection =
      (macroBias === 'BUY' && mappedFundamental === 'SELL') ||
      (macroBias === 'SELL' && mappedFundamental === 'BUY');

    if (opposingDirection && gapMinutes > 90) {
      status = 'drift';
      noteId = `Arah Trade News (${macroBias}) dan Fundamental Gold (${fundamentalBias}) terpaut ${gapMinutes} menit — refresh salah satu modul untuk sinkronisasi.`;
      noteEn = `Trade News (${macroBias}) and Fundamental Gold (${fundamentalBias}) differ by ${gapMinutes}m — refresh to resync.`;
    } else {
      status = 'aligned';
      noteId = `Trade News (${macroBias}), Fundamental Gold (${fundamentalBias}), dan Cycle Confluence tersinkronisasi (${gapMinutes}m selisih).`;
      noteEn = `Trade News (${macroBias}), Fundamental Gold (${fundamentalBias}), and Cycle Confluence are synced (${gapMinutes}m delta).`;
    }
  } else if (macro || fundamental) {
    status = 'partial';
    noteId = macro
      ? `Trade News aktif (${macroBias}); Fundamental Gold akan otomatis tersinkron saat dibuka.`
      : `Fundamental Gold aktif (${fundamentalBias}); Cycle Confluence telah memakai bias ini.`;
    noteEn = macro
      ? `Trade News active (${macroBias}); Fundamental Gold will auto-sync when opened.`
      : `Fundamental Gold active (${fundamentalBias}); Cycle Confluence already uses this bias.`;
  }

  return {
    status,
    macroBias,
    macroAnalyzedAt: macro?.analyzedAt || null,
    macroSourceMode: macro?.sourceMode || null,
    fundamentalBias,
    fundamentalAnalyzedAt: fundamental?.analyzedAt || null,
    fundamentalSourceMode: fundamental?.sourceMode || null,
    fedWatchDominant: fedWatch?.isAvailable ? fedWatch.dominantOutcome : null,
    fedWatchUpdatedAt: fedWatch?.updatedAt || null,
    offlineActualsCount,
    localCandleBuckets,
    polymarketCachedCount: poly?.events?.length || 0,
    polymarketFetchedAt: poly?.fetchedAt || null,
    noteId,
    noteEn,
  };
}

async function probeBackendHealth(offlineMode: boolean): Promise<BackendDiagnosticResult> {
  const info = getBackendSourceInfo();
  const candidates = getApiEndpointCandidates('/api/health');
  const targetUrl = candidates[0] || '/api/health';

  if (offlineMode) {
    return {
      status: 'offline_skipped',
      url: targetUrl,
      source: info.source,
      httpStatus: 0,
      scannerGeminiConfigured: false,
      newsGeminiConfigured: false,
      apiKeysStrictlySeparated: false,
      latencyMs: 0,
      note: 'Mode Offline aktif (probe server dilewati)',
    };
  }

  const start = Date.now();
  const authHeaders = buildBackendAuthHeaders(targetUrl);

  try {
    let status = 0;
    let json: any = null;

    if (isNativeAndroidOrIos() && /^https?:\/\//i.test(targetUrl)) {
      const response = await CapacitorHttp.get({
        url: targetUrl,
        connectTimeout: 7500,
        readTimeout: 7500,
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          ...authHeaders,
        },
      });
      status = response.status;
      json = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7500);
      const res = await fetch(targetUrl, {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json', ...authHeaders },
        signal: controller.signal,
      });
      clearTimeout(timer);
      status = res.status;
      if (res.ok) json = await res.json();
    }

    const latencyMs = Date.now() - start;
    if (status >= 200 && status < 300 && json?.ok) {
      const scannerOk = Boolean(json.scannerGeminiConfigured ?? json.geminiConfigured);
      const newsOk = Boolean(json.newsGeminiConfigured ?? json.geminiConfigured);
      const groqOk = Boolean(json.groqConfigured);
      const openRouterOk = Boolean(json.openRouterConfigured);
      const agentDeskOk = Boolean(json.agentDeskReady ?? (scannerOk || newsOk || groqOk || openRouterOk));
      const proxyCaps =
        json.proxyCapabilities && typeof json.proxyCapabilities === 'object'
          ? {
              polymarket: Boolean(json.proxyCapabilities.polymarket),
              cftc: Boolean(json.proxyCapabilities.cftc),
              twelvedata: Boolean(json.proxyCapabilities.twelvedata),
              binance: Boolean(json.proxyCapabilities.binance),
            }
          : undefined;

      const needsEdgeRedeploy = !proxyCaps || !proxyCaps.polymarket || !proxyCaps.binance;
      return {
        status: scannerOk && newsOk && !needsEdgeRedeploy ? 'ok' : 'degraded',
        url: targetUrl,
        source: info.source,
        httpStatus: status,
        service: String(json.service || 'backend'),
        scannerGeminiConfigured: scannerOk,
        newsGeminiConfigured: newsOk,
        groqConfigured: groqOk,
        openRouterConfigured: openRouterOk,
        agentDeskReady: agentDeskOk,
        apiKeysStrictlySeparated: Boolean(json.apiKeysStrictlySeparated),
        proxyCapabilities: proxyCaps,
        latencyMs,
        note: needsEdgeRedeploy
          ? 'Edge Function aktif, namun perlu redeploy terbaru untuk proxy Polymarket/Binance'
          : !scannerOk || !newsOk
          ? 'Server aktif, tetapi salah satu Gemini API Key secret belum terpasang'
          : 'Backend AI & Proxy siap penuh',
      };
    }

    return {
      status: 'error',
      url: targetUrl,
      source: info.source,
      httpStatus: status,
      scannerGeminiConfigured: false,
      newsGeminiConfigured: false,
      apiKeysStrictlySeparated: false,
      latencyMs,
      note: `HTTP ${status || 'ERR'} dari ${targetUrl}`,
    };
  } catch (err: any) {
    return {
      status: 'error',
      url: targetUrl,
      source: info.source,
      httpStatus: 0,
      scannerGeminiConfigured: false,
      newsGeminiConfigured: false,
      apiKeysStrictlySeparated: false,
      latencyMs: Date.now() - start,
      note: err?.message || 'Gagal menghubungi backend',
    };
  }
}

async function probeVelaChartFeed(offlineMode: boolean): Promise<LiveFeedDiagnosticResult> {
  const start = Date.now();
  let lastSource = 'unavailable';
  let lastNote = '';
  try {
    const provider = new TradeVaultVelaProvider({
      preferredFeed: 'twelvedata',
      onStatus: (st) => {
        lastSource = st.source;
        if (st.note) lastNote = st.note;
      },
    });
    const bars = await provider.getBars('XAUUSD', '60', { limit: 50 });
    const latencyMs = Date.now() - start;
    if (bars.length > 0) {
      return {
        status: lastSource === 'cache' ? 'cache' : 'ok',
        source: lastSource,
        count: bars.length,
        latencyMs,
        note: lastNote || `${bars.length} candle XAUUSD H1 (${lastSource})`,
      };
    }
    return {
      status: offlineMode ? 'offline_skipped' : 'error',
      source: lastSource,
      count: 0,
      latencyMs,
      note: lastNote || 'Candle XAUUSD belum tersedia',
    };
  } catch (err: any) {
    return {
      status: 'error',
      source: lastSource,
      count: 0,
      latencyMs: Date.now() - start,
      note: err?.message || 'Vela feed error',
    };
  }
}

async function probePolymarketFeed(offlineMode: boolean): Promise<LiveFeedDiagnosticResult> {
  const start = Date.now();
  try {
    const snap = await fetchPolymarketMacroSentiment({ forceRefresh: false });
    const latencyMs = Date.now() - start;
    if (snap.events.length > 0) {
      return {
        status: snap.source === 'CACHE_OFFLINE' ? 'cache' : 'ok',
        source: snap.source,
        count: snap.events.length,
        latencyMs,
        note: `${snap.events.length} event aktif (${snap.source})`,
      };
    }
    return {
      status: offlineMode ? 'offline_skipped' : 'error',
      source: snap.source,
      count: 0,
      latencyMs,
      note: snap.errorDetailId || 'Polymarket tidak dapat dijangkau',
    };
  } catch (err: any) {
    return {
      status: 'error',
      source: 'UNAVAILABLE',
      count: 0,
      latencyMs: Date.now() - start,
      note: err?.message || 'Polymarket probe error',
    };
  }
}

export async function runFullApkSystemProbe(): Promise<FullApkSystemProbeResult> {
  const build = getAppBuildIdentity();
  const nativeApp = readNativeAndroidAppInfo();
  const isOfflineMode = isNewsCycleOfflineMode();
  const navigatorOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
  const swPurgedChangeCode = (() => {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem('vlo_sw_purged_change_code_v2');
    } catch {
      return null;
    }
  })();

  const [backend, velaChartFeed, polymarketFeed] = await Promise.all([
    probeBackendHealth(isOfflineMode || !navigatorOnline),
    probeVelaChartFeed(isOfflineMode || !navigatorOnline),
    probePolymarketFeed(isOfflineMode || !navigatorOnline),
  ]);

  const macroSync = inspectMacroSyncConsistency();

  return {
    probedAtIso: new Date().toISOString(),
    build,
    nativeApp,
    swPurgedChangeCode,
    cachePurgeMatchesBuild: swPurgedChangeCode === build.changeCode,
    isOfflineMode,
    navigatorOnline,
    backend,
    velaChartFeed,
    polymarketFeed,
    macroSync,
  };
}
