import { Trade } from '../types/trade';
import { AppSettings, DEFAULT_SETTINGS } from '../types/settings';
import { DEMO_TRADES } from './demoData';

export const GUEST_TRADES_STORAGE_KEY = 'tradevault_trades_guest';
export const USER_TRADES_STORAGE_KEY_PREFIX = 'tradevault_trades_user_';
export const SETTINGS_STORAGE_KEY = 'tradevault_settings_v1';
export const USER_SETTINGS_STORAGE_KEY_PREFIX = 'tradevault_settings_user_';

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
 */
export function saveStoredTrades(
  trades: Trade[],
  userId?: string | null
): { success: boolean; error?: string } {
  try {
    const key = getTradesStorageKey(userId);
    const serialized = JSON.stringify(trades);
    localStorage.setItem(key, serialized);
    return { success: true };
  } catch (error: any) {
    console.error('Failed to save trades to storage:', error);
    const msg =
      error?.name === 'QuotaExceededError'
        ? 'Penyimpanan lokal browser penuh. Jika Anda menyimpan banyak screenshot gambar, kurangi ukuran screenshot atau hapus trade lama.'
        : 'Gagal menyimpan data ke penyimpanan lokal browser.';
    return { success: false, error: msg };
  }
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

  const numericKeys: Array<
    Exclude<
      keyof AppSettings,
      'currency' | 'currencySymbol' | 'resetTimezone' | 'riskCapitalBasis'
    >
  > = [
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

export function loadStoredSettings(userId?: string | null): AppSettings {
  try {
    const key = getSettingsStorageKey(userId);
    const raw = localStorage.getItem(key);
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed = JSON.parse(raw);
    return mergeWithExistingSettings(DEFAULT_SETTINGS, parsed);
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
    localStorage.setItem(key, JSON.stringify(settings));
    return { success: true };
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

