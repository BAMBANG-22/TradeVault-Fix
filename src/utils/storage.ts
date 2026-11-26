import { Trade } from '../types/trade';
import { AppSettings, DEFAULT_SETTINGS } from '../types/settings';
import { DEMO_TRADES } from './demoData';
import {
  decodeLifecycleMetaFromExecutionNotes,
  encodeLifecycleMetaIntoExecutionNotes,
} from './tradeLifecycle';

export const GUEST_TRADES_STORAGE_KEY = 'tradevault_trades_guest';
export const USER_TRADES_STORAGE_KEY_PREFIX = 'tradevault_trades_user_';
export const SETTINGS_STORAGE_KEY = 'tradevault_settings_v1';
export const USER_SETTINGS_STORAGE_KEY_PREFIX = 'tradevault_settings_user_';

const CANDLE_CACHE_KEY_PREFIX = 'tradevault_candle_cache_';
const CYCLE_CANDLE_CACHE_KEY = 'tradevault_cycle_confluence_td_v1';
const OFFLINE_SYNC_QUEUE_KEY_PREFIX = 'tradevault_offline_sync_queue_v1:';
const USER_AVATAR_CACHE_KEY_PREFIX = 'tradevault_user_avatar_';

const EXPENDABLE_MACRO_AND_CACHE_KEYS: readonly string[] = [
  'tradevault_macro_news_snapshot_v1',
  'tradevault_macro_group_snapshots_v1',
  'tradevault_macro_bias_history_v1',
  'tradevault_macro_actuals_archive_v1',
  'tradevault_macro_prenews_locks_v1',
  'tradevault_macro_postnews_locks_v1',
  'tradevault_macro_monthly_news_speech_v1',
  'tradevault_cme_fedwatch_cache_v1',
  'tradevault_fundamental_gold_snapshot_v1',
  'tradevault_macro_notified_fp_v1',
  'tradevault_macro_hist_backfill_last_v1',
  'tradevault_smc_offline_signals_v1',
  'tradevault_usd_idr_rate_v1',
  'vlo_app_notifications_v1',
];

function isQuotaExceededError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { name?: unknown; code?: unknown; message?: unknown };
  const name = typeof err.name === 'string' ? err.name : '';
  const code = typeof err.code === 'number' ? err.code : -1;
  const message = typeof err.message === 'string' ? err.message.toLowerCase() : '';
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014 ||
    message.includes('quota')
  );
}

function collectLocalStorageKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }
  } catch {
    // ignore enumeration failures
  }
  return keys;
}

function removeStorageKeys(keys: string[]): number {
  let removed = 0;
  for (const k of keys) {
    try {
      if (localStorage.getItem(k) !== null) {
        localStorage.removeItem(k);
        removed += 1;
      }
    } catch {
      // ignore individual removal errors
    }
  }
  return removed;
}

/**
 * Stages eviction of strictly rebuildable caches when localStorage throws QuotaExceededError.
 * Never removes active user trades, guest trades, settings, auth sessions (sb-*), or offline sync queues.
 */
function trySetItemWithCacheEviction(
  targetKey: string,
  serializedValue: string,
  activeUserId?: string | null
): { ok: boolean; lastError?: unknown; evictedAny: boolean } {
  try {
    localStorage.setItem(targetKey, serializedValue);
    return { ok: true, evictedAny: false };
  } catch (initialError) {
    if (!isQuotaExceededError(initialError)) {
      return { ok: false, lastError: initialError, evictedAny: false };
    }

    let evictedAny = false;
    const allKeys = collectLocalStorageKeys();
    const normalizedActiveUser =
      activeUserId && typeof activeUserId === 'string' && activeUserId.trim() !== ''
        ? activeUserId.trim()
        : null;

    // Tier 1A: Market chart & cycle candle caches (largest & 100% re-fetchable)
    const candleCacheKeys = allKeys.filter(
      (k) => k.startsWith(CANDLE_CACHE_KEY_PREFIX) || k === CYCLE_CANDLE_CACHE_KEY
    );
    if (removeStorageKeys(candleCacheKeys) > 0) {
      evictedAny = true;
      try {
        localStorage.setItem(targetKey, serializedValue);
        return { ok: true, evictedAny };
      } catch (err1A) {
        if (!isQuotaExceededError(err1A)) {
          return { ok: false, lastError: err1A, evictedAny };
        }
      }
    }

    // Tier 1B: Macro news snapshots/archives, notifications, & orphaned scan caches
    const macroAndScanKeys = [
      ...EXPENDABLE_MACRO_AND_CACHE_KEYS,
      ...allKeys.filter((k) => k.startsWith('tradevault_mt5_scan_cache_v')),
    ];
    if (removeStorageKeys(macroAndScanKeys) > 0) {
      evictedAny = true;
      try {
        localStorage.setItem(targetKey, serializedValue);
        return { ok: true, evictedAny };
      } catch (err1B) {
        if (!isQuotaExceededError(err1B)) {
          return { ok: false, lastError: err1B, evictedAny };
        }
      }
    }

    // Tier 1C: Inactive other-user mirrors only when they have NO pending offline sync queue
    const inactiveUserMirrorKeys = allKeys.filter((k) => {
      if (k === targetKey) return false;
      if (k.startsWith(USER_TRADES_STORAGE_KEY_PREFIX)) {
        const ownerId = k.slice(USER_TRADES_STORAGE_KEY_PREFIX.length);
        if (!ownerId || ownerId === normalizedActiveUser) return false;
        try {
          const hasPendingQueue = localStorage.getItem(`${OFFLINE_SYNC_QUEUE_KEY_PREFIX}${ownerId}`);
          return !hasPendingQueue;
        } catch {
          return false;
        }
      }
      if (k.startsWith(USER_AVATAR_CACHE_KEY_PREFIX)) {
        const ownerId = k.slice(USER_AVATAR_CACHE_KEY_PREFIX.length);
        return Boolean(ownerId && ownerId !== normalizedActiveUser);
      }
      return false;
    });

    if (removeStorageKeys(inactiveUserMirrorKeys) > 0) {
      evictedAny = true;
      try {
        localStorage.setItem(targetKey, serializedValue);
        return { ok: true, evictedAny };
      } catch (err1C) {
        return { ok: false, lastError: err1C, evictedAny };
      }
    }

    return { ok: false, lastError: initialError, evictedAny };
  }
}

function isInlineBase64Image(val: unknown): val is string {
  return typeof val === 'string' && val.trim().startsWith('data:image/');
}

function compactInlineScreenshotsOnTrade(trade: Trade): { trade: Trade; changed: boolean } {
  let changed = false;
  let nextScreenshotUrl = trade.screenshotUrl;
  if (isInlineBase64Image(nextScreenshotUrl)) {
    nextScreenshotUrl = undefined;
    changed = true;
  }

  let nextExecutionNotes = trade.executionNotes;
  if (typeof trade.executionNotes === 'string' && trade.executionNotes.includes('[TV_META:')) {
    const meta = decodeLifecycleMetaFromExecutionNotes(trade.executionNotes);
    let metaChanged = false;
    const nextMeta = { ...meta };
    if (isInlineBase64Image(nextMeta.beforeScreenshotUrl)) {
      delete nextMeta.beforeScreenshotUrl;
      metaChanged = true;
    }
    if (isInlineBase64Image(nextMeta.afterScreenshotUrl)) {
      delete nextMeta.afterScreenshotUrl;
      metaChanged = true;
    }
    if (metaChanged) {
      nextExecutionNotes = encodeLifecycleMetaIntoExecutionNotes(trade.executionNotes, nextMeta);
      changed = true;
    }
  }

  if (!changed) {
    return { trade, changed: false };
  }

  return {
    trade: {
      ...trade,
      screenshotUrl: nextScreenshotUrl,
      executionNotes: nextExecutionNotes,
    },
    changed: true,
  };
}

/**
 * Returns the exact localStorage key scoped to the user, or the guest key if unauthenticated.
 * Format: tradevault_trades_user_<userId> for verified users, or tradevault_trades_guest for guests.
 */
export function getTradesStorageKey(userId?: string | null): string {
  if (userId && typeof userId === 'string' && userId.trim() !== '') {
    return `${USER_TRADES_STORAGE_KEY_PREFIX}${userId.trim()}`;
  }
  return GUEST_TRADES_STORAGE_KEY;
}

/**
 * Returns the exact settings localStorage key scoped to the user, or the guest settings key if unauthenticated.
 * Format: tradevault_settings_user_<userId> for verified users, or tradevault_settings_v1 for guests.
 */
export function getSettingsStorageKey(userId?: string | null): string {
  if (userId && typeof userId === 'string' && userId.trim() !== '') {
    return `${USER_SETTINGS_STORAGE_KEY_PREFIX}${userId.trim()}`;
  }
  return SETTINGS_STORAGE_KEY;
}

/**
 * Atomically removes a trade by ID from the latest tradesRef.current array and updates the ref synchronously.
 * Prevents stale closure race conditions when a trade is deleted right after an adjacent state update.
 */
export function removeTradeFromLatestList(
  tradesRef: { current: Trade[] },
  deletedId: string
): Trade[] {
  const cleanId = String(deletedId || '').trim();
  const currentList = Array.isArray(tradesRef?.current) ? tradesRef.current : [];
  const filtered = currentList.filter((t) => t.id !== cleanId);
  if (tradesRef) {
    tradesRef.current = filtered;
  }
  return filtered;
}

/**
 * Atomically removes a set of trade IDs from the latest tradesRef.current array and updates the ref synchronously.
 */
export function removeTradesListFromLatestList(
  tradesRef: { current: Trade[] },
  deletedIds: Iterable<string>
): Trade[] {
  const idSet = new Set<string>();
  for (const id of deletedIds) {
    const clean = String(id || '').trim();
    if (clean) idSet.add(clean);
  }
  const currentList = Array.isArray(tradesRef?.current) ? tradesRef.current : [];
  const filtered = idSet.size > 0 ? currentList.filter((t) => !idSet.has(t.id)) : currentList;
  if (tradesRef) {
    tradesRef.current = filtered;
  }
  return filtered;
}

/**
 * Loads trades stored in localStorage.
 * - When userId is provided: strictly returns only trades from that user's scoped cache.
 *   Returns an empty array if no cache exists for that user (never falls back to guest/demo data).
 * - When userId is null/undefined (guest mode): returns guest trades, initializing with DEMO_TRADES
 *   on very first launch only.
 */
export function loadStoredTrades(userId?: string | null): Trade[] {
  try {
    const key = getTradesStorageKey(userId);
    const raw = localStorage.getItem(key);
    if (raw === null) {
      // If user is authenticated and has no cache yet, return empty list!
      // Do NOT load demo trades or pollute user's profile with guest data.
      if (userId && typeof userId === 'string' && userId.trim() !== '') {
        return [];
      }

      // Guest / unauthenticated initial launch: initialize guest storage with DEMO_TRADES
      saveStoredTrades(DEMO_TRADES, null);
      return DEMO_TRADES;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [];
  } catch (error) {
    console.error('Failed to load trades from storage:', error);
    return [];
  }
}

/**
 * Saves trades array to user-scoped or guest localStorage key.
 * Automatically recovers from QuotaExceededError by evicting rebuildable caches first
 * and only compacting oversized inline base64 screenshots in the localStorage mirror if needed.
 */
export function saveStoredTrades(
  trades: Trade[],
  userId?: string | null
): { success: boolean; error?: string; compactedScreenshots?: boolean } {
  const key = getTradesStorageKey(userId);
  let lastError: unknown;

  try {
    const serialized = JSON.stringify(trades);
    const directOrEvicted = trySetItemWithCacheEviction(key, serialized, userId);
    if (directOrEvicted.ok) {
      if (directOrEvicted.evictedAny) {
        console.warn('Recovered localStorage quota by clearing rebuildable chart/macro caches.');
      }
      return { success: true };
    }
    lastError = directOrEvicted.lastError;

    // Tier 2: If trades JSON itself still exceeds quota (caused by large inline base64 screenshots),
    // compact inline data:image/* strings from oldest trades first (keeping newest 5 if they fit),
    // then from all trades in the localStorage mirror. Trade metrics, SL/TP, notes, and Cloud paths remain intact.
    if (isQuotaExceededError(lastError) && Array.isArray(trades) && trades.length > 0) {
      const keepRecentCount = 5;
      const partialCompacted = trades.map((t, idx) =>
        idx < keepRecentCount ? t : compactInlineScreenshotsOnTrade(t).trade
      );
      try {
        localStorage.setItem(key, JSON.stringify(partialCompacted));
        console.warn(
          'Compacted older inline base64 screenshots in localStorage mirror to preserve all trade records.'
        );
        return { success: true, compactedScreenshots: true };
      } catch (err2a) {
        lastError = err2a;
      }

      if (isQuotaExceededError(lastError)) {
        const fullCompacted = trades.map((t) => compactInlineScreenshotsOnTrade(t).trade);
        try {
          localStorage.setItem(key, JSON.stringify(fullCompacted));
          console.warn(
            'Compacted all inline base64 screenshots in localStorage mirror to preserve all trade records.'
          );
          return { success: true, compactedScreenshots: true };
        } catch (err2b) {
          lastError = err2b;
        }
      }
    }
  } catch (error) {
    lastError = error;
  }

  console.error('Failed to save trades to storage:', lastError);
  const msg = isQuotaExceededError(lastError)
    ? 'Penyimpanan lokal browser penuh. Jika Anda menyimpan banyak screenshot gambar, kurangi ukuran screenshot atau hapus trade lama.'
    : 'Gagal menyimpan data ke penyimpanan lokal browser.';
  return { success: false, error: msg };
}

/**
 * Explicitly clears the local cache for a specific user.
 */
export function clearUserCache(userId: string): void {
  try {
    if (userId && typeof userId === 'string' && userId.trim() !== '') {
      localStorage.removeItem(getTradesStorageKey(userId));
      localStorage.removeItem(getSettingsStorageKey(userId));
    }
  } catch (error) {
    console.error('Failed to clear user cache:', error);
  }
}

/**
 * Checks whether cached trades exist for a given user.
 */
export function hasUserCache(userId: string): boolean {
  try {
    if (!userId) return false;
    return localStorage.getItem(getTradesStorageKey(userId)) !== null;
  } catch {
    return false;
  }
}

export function mergeWithExistingSettings(
  baseSettings: AppSettings,
  incomingSettings?: Partial<AppSettings> | null
): AppSettings {
  const safeBase: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...(baseSettings || {}),
  };

  if (!incomingSettings || typeof incomingSettings !== 'object') {
    return safeBase;
  }

  const result: AppSettings = { ...safeBase };

  if (typeof incomingSettings.currency === 'string' && incomingSettings.currency.trim() !== '') {
    result.currency = incomingSettings.currency.trim() as AppSettings['currency'];
  }
  if (
    typeof incomingSettings.currencySymbol === 'string' &&
    incomingSettings.currencySymbol.trim() !== ''
  ) {
    result.currencySymbol = incomingSettings.currencySymbol.trim();
  }
  if (
    typeof incomingSettings.resetTimezone === 'string' &&
    incomingSettings.resetTimezone.trim() !== ''
  ) {
    result.resetTimezone = incomingSettings.resetTimezone.trim();
  }
  if (
    incomingSettings.riskCapitalBasis === 'EQUITY' ||
    incomingSettings.riskCapitalBasis === 'BALANCE'
  ) {
    result.riskCapitalBasis = incomingSettings.riskCapitalBasis;
  }

  if (typeof incomingSettings.activeAccountId === 'string' && incomingSettings.activeAccountId.trim() !== '') {
    result.activeAccountId = incomingSettings.activeAccountId.trim();
  }
  if (Array.isArray(incomingSettings.accounts)) {
    result.accounts = incomingSettings.accounts;
  }
  if (Array.isArray(incomingSettings.preTradeChecklist)) {
    result.preTradeChecklist = incomingSettings.preTradeChecklist;
  }
  if (Array.isArray(incomingSettings.playbooks)) {
    result.playbooks = incomingSettings.playbooks;
  }
  if (typeof incomingSettings.dailyLossAlertEnabled === 'boolean') {
    result.dailyLossAlertEnabled = incomingSettings.dailyLossAlertEnabled;
  }
  if (typeof incomingSettings.stopTradingAlertEnabled === 'boolean') {
    result.stopTradingAlertEnabled = incomingSettings.stopTradingAlertEnabled;
  }

  const numericKeys: Array<keyof AppSettings> = [
    'startingBalance',
    'xauusdContractSize',
    'xauusdPointValue',
    'xauusdTickSize',
    'xauusdTickValue',
    'xauusdPipSize',
    'xauusdPipValuePer001Lot',
    'xauusdMinLot',
    'xauusdLotStep',
    'defaultLeverage',
    'brokerCommissionPerLot',
    'defaultRiskPercent',
    'maxTradeRiskPercent',
    'maxTradeRiskAmount',
    'maxDailyLossPercent',
    'maxDailyLossAmount',
    'maxConsecutiveLossLimit',
    'maxDrawdownLimitPercent',
    'targetMonthlyReturnPercent',
    'totalDeposits',
    'totalWithdrawals',
  ];

  for (const key of numericKeys) {
    const rawVal = incomingSettings[key];
    if (rawVal !== undefined && rawVal !== null && rawVal !== ('' as any)) {
      const numVal = Number(rawVal);
      if (Number.isFinite(numVal)) {
        (result as any)[key] = numVal;
      }
    }
  }

  return result;
}

const XAUUSD_PIP_ALIGNED_FLAG_KEY = 'vlo_xauusd_pip_aligned_v1';

export function loadStoredSettings(userId?: string | null): AppSettings {
  try {
    const key = getSettingsStorageKey(userId);
    const raw = localStorage.getItem(key);
    if (!raw) {
      try {
        localStorage.setItem(XAUUSD_PIP_ALIGNED_FLAG_KEY, '1');
      } catch {
        // ignore storage restrictions
      }
      return { ...DEFAULT_SETTINGS };
    }
    const parsed = JSON.parse(raw);
    const merged = mergeWithExistingSettings(DEFAULT_SETTINGS, parsed);

    try {
      const alreadyAligned = localStorage.getItem(XAUUSD_PIP_ALIGNED_FLAG_KEY) === '1';
      if (!alreadyAligned) {
        if (parsed?.xauusdPipSize === 1 || parsed?.xauusdPipSize === 1.0) {
          merged.xauusdPipSize = 0.1;
          saveStoredSettings(merged, userId);
        }
        localStorage.setItem(XAUUSD_PIP_ALIGNED_FLAG_KEY, '1');
      }
    } catch {
      // ignore storage restrictions
    }

    return merged;
  } catch (error) {
    console.error('Failed to load settings:', error);
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveStoredSettings(
  settings: AppSettings,
  userId?: string | null
): { success: boolean; error?: string } {
  try {
    const key = getSettingsStorageKey(userId);
    const serialized = JSON.stringify(settings);
    const res = trySetItemWithCacheEviction(key, serialized, userId);
    if (res.ok) {
      return { success: true };
    }
    console.error('Failed to save settings:', res.lastError);
    return { success: false, error: 'Gagal menyimpan pengaturan ke browser.' };
  } catch (error) {
    console.error('Failed to save settings:', error);
    return { success: false, error: 'Gagal menyimpan pengaturan ke browser.' };
  }
}

const STORAGE_PATH_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-zA-Z0-9_.-]+\.(jpg|jpeg|png|webp)$/i;

/**
 * Validates whether a given string is a valid, isolated Supabase Storage path.
 * Format: "<ownerUuid>/<filename>.<ext>"
 * Strictly rejects path traversal (.., \, //, %2f, %5c, null bytes) and invalid UUID owners.
 */
export function isStoragePath(path: unknown): boolean {
  if (!path || typeof path !== 'string') return false;
  const clean = path.trim();
  if (
    clean.startsWith('data:image/') ||
    clean.startsWith('http://') ||
    clean.startsWith('https://')
  ) {
    return false;
  }
  // Strictly reject directory traversal and null byte injections
  if (
    clean.includes('..') ||
    clean.includes('\\') ||
    clean.includes('\0') ||
    clean.includes('//') ||
    /%2f/i.test(clean) ||
    /%5c/i.test(clean)
  ) {
    return false;
  }
  return STORAGE_PATH_UUID_REGEX.test(clean);
}

/**
 * Fail-Closed sanitizer for screenshot sources during backup restore or data import.
 * - Guest mode (activeOwnerScope is null/'GUEST'): all Supabase storage paths and Supabase URLs are discarded.
 * - Authenticated mode: storage paths are retained only if the owner UUID strictly matches activeOwnerScope.
 * - Base64 images are verified for valid mime headers, magic byte signatures, and size <= 5MB.
 * - External HTTPS URLs (non-Supabase) are retained if well-formed.
 */
export function classifyAndSanitizeScreenshotSource(
  raw: string | undefined | null,
  activeOwnerScope?: string | null
): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const clean = raw.trim();
  if (!clean) return undefined;

  const isGuest =
    !activeOwnerScope ||
    typeof activeOwnerScope !== 'string' ||
    activeOwnerScope.trim().toUpperCase() === 'GUEST';
  const cleanOwner = !isGuest && activeOwnerScope ? activeOwnerScope.trim().toLowerCase() : null;

  // 1. Base64 Data URL validation
  if (clean.startsWith('data:image/')) {
    // Max 7MB string length (~5MB binary)
    if (clean.length > 7 * 1024 * 1024) {
      return undefined;
    }
    const match = clean.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return undefined;

    const payload = match[2];
    if (payload.length < 8) return undefined;

    // Magic byte signatures in base64:
    // PNG: iVBORw0KGgo (89 50 4E 47)
    // JPEG: /9j/ (FF D8 FF)
    // WEBP: UklGR (52 49 46 46)
    const isPng = payload.startsWith('iVBORw0KGgo');
    const isJpeg = payload.startsWith('/9j/');
    const isWebp = payload.startsWith('UklGR');

    if (isPng || isJpeg || isWebp) {
      return clean;
    }
    return undefined;
  }

  // 2. Supabase Storage Path
  if (isStoragePath(clean)) {
    if (isGuest || !cleanOwner) {
      // Fail-closed: Guest has no access to private cloud storage paths
      return undefined;
    }
    const pathOwner = clean.split('/')[0].toLowerCase();
    if (pathOwner === cleanOwner) {
      return clean;
    }
    // Storage path belongs to a different user scope: discard to prevent cross-account leak
    return undefined;
  }

  // 3. URLs
  if (clean.startsWith('https://') || clean.startsWith('http://')) {
    try {
      const parsedUrl = new URL(clean);
      const isSupabaseDomain = parsedUrl.hostname.endsWith('.supabase.co');

      if (isSupabaseDomain) {
        if (isGuest || !cleanOwner) {
          return undefined;
        }
        // If pointing to trade-screenshots bucket, verify owner segment
        const pathname = parsedUrl.pathname;
        const bucketPrefix = '/storage/v1/object/public/trade-screenshots/';
        const signedPrefix = '/storage/v1/object/sign/trade-screenshots/';
        if (pathname.includes(bucketPrefix) || pathname.includes(signedPrefix)) {
          const subPath = pathname.split('trade-screenshots/')[1] || '';
          if (isStoragePath(subPath)) {
            const pathOwner = subPath.split('/')[0].toLowerCase();
            if (pathOwner === cleanOwner) {
              return subPath;
            }
          }
          return undefined;
        }
        return undefined;
      }

      // External non-Supabase HTTPS URL
      if (parsedUrl.protocol === 'https:') {
        return clean;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export function generateBackupJson(trades: Trade[], settings: AppSettings): string {
  const payload = {
    appName: 'TradeVault Journal',
    version: '1.0',
    exportDate: new Date().toISOString(),
    settings,
    trades,
  };
  return JSON.stringify(payload, null, 2);
}

export function parseAndRestoreBackup(
  jsonString: string,
  currentSettings: AppSettings = DEFAULT_SETTINGS,
  activeOwnerScope?: string | null
): {
  success: boolean;
  message: string;
  trades?: Trade[];
  settings?: AppSettings;
} {
  try {
    const data = JSON.parse(jsonString);
    if (!data || typeof data !== 'object') {
      return { success: false, message: 'Format file backup tidak valid.' };
    }

    if (!Array.isArray(data.trades)) {
      return { success: false, message: 'Data trades tidak ditemukan dalam backup.' };
    }

    // Validate and sanitize trade items with fail-closed screenshot filtering
    const validTrades: Trade[] = data.trades
      .filter((t: any) => t && typeof t.id === 'string' && typeof t.dateTime === 'string')
      .map((t: Trade) => {
        const sanitizedScreenshot = classifyAndSanitizeScreenshotSource(
          t.screenshotUrl,
          activeOwnerScope
        );
        return {
          ...t,
          screenshotUrl: sanitizedScreenshot,
        };
      });

    const mergedSettings: AppSettings = mergeWithExistingSettings(
      currentSettings,
      data.settings
    );

    return {
      success: true,
      message: `Berhasil memulihkan ${validTrades.length} trade dan konfigurasi akun.`,
      trades: validTrades,
      settings: mergedSettings,
    };
  } catch (err: any) {
    return { success: false, message: `Gagal membaca file JSON: ${err.message}` };
  }
}

