import { Trade } from '../types/trade';
import { AppSettings } from '../types/settings';
import { getSupabase } from './supabaseClient';
import { isDemoTrade } from './demoData';
import { mergeWithExistingSettings, loadStoredSettings, saveStoredSettings } from './storage';
import {
  classifyNetProfitOutcome,
  computeGrossFromNet,
  computeRealizedRMultiple,
  computeTradeNetProfit,
} from './calculations';
import {
  decodeTradeNotesWithMeta,
  encodeTradeNotesWithMetaB64,
} from '../storage/utf8Base64Url';
import {
  decodeLifecycleMetaFromExecutionNotes,
  encodeLifecycleMetaIntoExecutionNotes,
} from './tradeLifecycle';

export interface SyncResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Translates Supabase / Postgres database errors into informative Indonesian messages
 * without leaking secret tokens or credentials.
 */
export function translateDatabaseError(error: any): string {
  if (!error) return 'Terjadi kesalahan database yang tidak diketahui.';

  const message = (error.message || error.error_description || String(error)).toLowerCase();
  const code = error.code || '';

  // Row Level Security (RLS) violation
  if (
    message.includes('row-level security') ||
    message.includes('violates row-level security policy') ||
    code === '42501'
  ) {
    return 'Izin akses ditolak oleh Row Level Security (RLS). Pastikan Anda telah login dengan akun yang valid dan kebijakan RLS di Supabase mengizinkan operasi ini.';
  }

  // Foreign key violation (auth.users foreign key)
  if (
    message.includes('violates foreign key constraint') ||
    message.includes('trades_user_id_fkey') ||
    code === '23503'
  ) {
    return 'User ID tidak terdaftar dalam tabel otentikasi auth.users. Silakan logout lalu login kembali.';
  }

  // Schema cache / Column mismatch
  if (
    message.includes('schema cache') ||
    message.includes('could not find the') ||
    code === 'PGRST204'
  ) {
    return `Struktur kolom database tidak cocok: ${error.message}. Periksa skema tabel "trades" di Supabase.`;
  }

  // Check constraint violation (e.g. position Buy/Sell or outcome WIN/LOSS/BREAKEVEN)
  if (message.includes('violates check constraint') || code === '23514') {
    if (message.includes('trades_direction_check') || message.includes('direction')) {
      return 'Nilai arah transaksi tidak sesuai aturan database (hanya menerima "Buy" atau "Sell").';
    }
    return `Format data tidak sesuai dengan aturan tabel database: ${error.message}.`;
  }

  // Not-null constraint violation
  if (message.includes('violates not-null constraint') || code === '23502') {
    return `Field wajib tidak boleh bernilai kosong: ${error.message}.`;
  }

  // Network / server connection error
  if (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed')
  ) {
    return 'Gagal terhubung ke database Supabase. Periksa koneksi internet Anda atau status project Supabase.';
  }

  // Session / JWT expired
  if (
    message.includes('jwt expired') ||
    message.includes('invalid claim') ||
    message.includes('auth session missing') ||
    code === 'PGRST301'
  ) {
    return 'Sesi login Anda telah kedaluwarsa. Silakan keluar dan masuk kembali.';
  }

  return error.message || 'Terjadi kesalahan saat memproses data di database Supabase.';
}

/**
 * Normalizes and strictly validates trade direction for Supabase database constraints.
 * The PostgreSQL table public.trades expects exact title case values: 'Buy' or 'Sell'.
 */
export function normalizeTradeDirection(input: unknown): 'Buy' | 'Sell' {
  if (input === null || input === undefined) {
    throw new Error('Arah transaksi (direction/posisi) wajib diisi.');
  }

  const rawStr = String(input).trim();
  if (rawStr === '') {
    throw new Error('Arah transaksi (direction/posisi) tidak boleh kosong.');
  }

  const lower = rawStr.toLowerCase();

  if (lower === 'buy' || lower === 'beli' || lower === 'long') {
    return 'Buy';
  }

  if (lower === 'sell' || lower === 'jual' || lower === 'short') {
    return 'Sell';
  }

  throw new Error(
    `Arah transaksi "${rawStr}" tidak valid. Sistem hanya menerima Buy (Beli/Long) atau Sell (Jual/Short).`
  );
}

/**
 * Maps a database direction value ('Buy', 'Sell', etc.) back to application TradePosition ('BUY' | 'SELL').
 */
export function mapDatabaseDirectionToApp(rawDirection: unknown): 'BUY' | 'SELL' {
  if (!rawDirection) return 'BUY';
  const str = String(rawDirection).trim().toLowerCase();
  if (str === 'sell' || str === 'jual' || str === 'short') {
    return 'SELL';
  }
  return 'BUY';
}

export const TRADEVAULT_UUID_NAMESPACE = 'tradevault:v2:trade';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GENERIC_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FORBIDDEN_SENTINEL_UUIDS = new Set([
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000000000',
]);

const FORBIDDEN_CLOUD_SCOPE_TOKENS = new Set(['guest', 'anonymous', 'local', 'null', 'undefined']);

/**
 * Validates an ownerScope ('GUEST' or a valid non-sentinel owner identifier).
 * Rejects empty/whitespace strings and forbidden sentinel UUIDs.
 */
export function validateOwnerScope(ownerScope: string): string {
  if (typeof ownerScope !== 'string') {
    throw new Error('ERR_INVALID_OWNER_SCOPE: Owner scope must be a non-empty string.');
  }
  const clean = ownerScope.trim();
  if (!clean) {
    throw new Error('ERR_INVALID_OWNER_SCOPE: Owner scope cannot be empty or whitespace.');
  }
  if (clean.toUpperCase() === 'GUEST') {
    return 'GUEST';
  }
  if (FORBIDDEN_SENTINEL_UUIDS.has(clean.toLowerCase())) {
    throw new Error('ERR_INVALID_OWNER_SCOPE: Forbidden sentinel UUID cannot be used as ownerScope.');
  }
  return clean;
}

/**
 * Strictly validates that a cloud operation has an authenticated user UUID.
 * Rejects empty strings, 'GUEST', 'ANONYMOUS', 'LOCAL', nil/sentinel UUIDs, and non-UUID strings.
 */
export function requireAuthenticatedUserId(userId: string): string {
  if (typeof userId !== 'string') {
    throw new Error('ERR_INVALID_CLOUD_USER_ID: Cloud operation requires a valid authenticated user UUID.');
  }
  const clean = userId.trim();
  if (!clean) {
    throw new Error('ERR_INVALID_CLOUD_USER_ID: Cloud userId cannot be empty or whitespace.');
  }
  const lower = clean.toLowerCase();
  if (FORBIDDEN_CLOUD_SCOPE_TOKENS.has(lower)) {
    throw new Error(`ERR_INVALID_CLOUD_USER_ID: Scope "${clean}" is not allowed on cloud sync paths.`);
  }
  if (FORBIDDEN_SENTINEL_UUIDS.has(lower)) {
    throw new Error('ERR_INVALID_CLOUD_USER_ID: Sentinel or nil UUID is not a valid cloud userId.');
  }
  if (!GENERIC_UUID_REGEX.test(lower)) {
    throw new Error(`ERR_INVALID_CLOUD_USER_ID: "${clean}" is not a valid UUID.`);
  }
  return lower;
}

/**
 * Per-user registry of verified cloud primary key UUIDs and localId -> cloudUuid bindings.
 * Prevents an imported external/CSV UUID or another user's UUID from being treated as a
 * trusted cloud-bound UUID unless explicitly registered for that userScope.
 */
const registeredCloudUuidsByOwner = new Map<string, Set<string>>();
const knownSyncedUuidByOwnerAndLocalId = new Map<string, Map<string, string>>();
const knownSyncedUuidByLocalId = new Map<string, string>();

export function registerCloudTradeUuids(userId: string, cloudUuids: string[]): void {
  if (!userId || !Array.isArray(cloudUuids)) return;
  const cleanOwner = String(userId).trim().toLowerCase();
  if (!cleanOwner || FORBIDDEN_CLOUD_SCOPE_TOKENS.has(cleanOwner)) return;
  let set = registeredCloudUuidsByOwner.get(cleanOwner);
  if (!set) {
    set = new Set<string>();
    registeredCloudUuidsByOwner.set(cleanOwner, set);
  }
  for (const rawUuid of cloudUuids) {
    if (!rawUuid) continue;
    const cleanUuid = String(rawUuid).trim().toLowerCase();
    if (GENERIC_UUID_REGEX.test(cleanUuid) && !FORBIDDEN_SENTINEL_UUIDS.has(cleanUuid)) {
      set.add(cleanUuid);
    }
  }
}

export function isRegisteredCloudTradeUuid(ownerScope: string, candidateUuid: string): boolean {
  if (!ownerScope || !candidateUuid) return false;
  const cleanOwner = String(ownerScope).trim().toLowerCase();
  const cleanUuid = String(candidateUuid).trim().toLowerCase();
  if (!GENERIC_UUID_REGEX.test(cleanUuid) || FORBIDDEN_SENTINEL_UUIDS.has(cleanUuid)) {
    return false;
  }
  const set = registeredCloudUuidsByOwner.get(cleanOwner);
  return Boolean(set && set.has(cleanUuid));
}

export function clearRegisteredCloudTradeUuids(userId?: string): void {
  if (userId && typeof userId === 'string' && userId.trim()) {
    const cleanOwner = userId.trim().toLowerCase();
    registeredCloudUuidsByOwner.delete(cleanOwner);
    knownSyncedUuidByOwnerAndLocalId.delete(cleanOwner);
    return;
  }
  registeredCloudUuidsByOwner.clear();
  knownSyncedUuidByOwnerAndLocalId.clear();
}

export function registerKnownTradeUuid(localId: string, dbUuid: string, userId?: string): void {
  if (!localId || !dbUuid) return;
  const cleanLocal = String(localId).trim();
  const cleanUuid = String(dbUuid).trim().toLowerCase();
  if (!cleanLocal || !GENERIC_UUID_REGEX.test(cleanUuid) || FORBIDDEN_SENTINEL_UUIDS.has(cleanUuid)) {
    return;
  }
  knownSyncedUuidByLocalId.set(cleanLocal, cleanUuid);
  if (userId && typeof userId === 'string' && userId.trim()) {
    const cleanOwner = userId.trim().toLowerCase();
    let ownerMap = knownSyncedUuidByOwnerAndLocalId.get(cleanOwner);
    if (!ownerMap) {
      ownerMap = new Map<string, string>();
      knownSyncedUuidByOwnerAndLocalId.set(cleanOwner, ownerMap);
    }
    ownerMap.set(cleanLocal, cleanUuid);
    registerCloudTradeUuids(cleanOwner, [cleanUuid]);
  }
}

export function unregisterKnownTradeUuid(localId: string, userId?: string): void {
  if (!localId) return;
  const cleanLocal = String(localId).trim();
  knownSyncedUuidByLocalId.delete(cleanLocal);
  if (userId && typeof userId === 'string' && userId.trim()) {
    const cleanOwner = userId.trim().toLowerCase();
    knownSyncedUuidByOwnerAndLocalId.get(cleanOwner)?.delete(cleanLocal);
  } else {
    for (const ownerMap of knownSyncedUuidByOwnerAndLocalId.values()) {
      ownerMap.delete(cleanLocal);
    }
  }
}

export function clearKnownTradeUuids(): void {
  knownSyncedUuidByLocalId.clear();
  clearRegisteredCloudTradeUuids();
}

/**
 * Legacy hex-based UUID generator used for standard short IDs (<= 16 chars, e.g. "TRD-123456", "DEMO-XAU-101").
 * Preserved 100% for backward-compatible legacy_candidate_uuid lookup.
 */
export function legacyAsciiEnsureValidUuid(clean: string): string {
  let hex = '';
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i).toString(16);
    hex += code.length === 1 ? '0' + code : code;
  }
  while (hex.length < 32) {
    hex += 'a';
  }
  hex = hex.slice(0, 32);

  const p1 = hex.slice(0, 8);
  const p2 = hex.slice(8, 12);
  const p3 = '4' + hex.slice(13, 16);
  const p4 = '8' + hex.slice(17, 20);
  const p5 = hex.slice(20, 32);
  return `${p1}-${p2}-${p3}-${p4}-${p5}`;
}

/**
 * Full-string 4-lane 32-bit non-cryptographic Murmur3/FNV-1a avalanche mixer formatted as UUID v4.
 * Incorporates every UTF-16 code unit of the input string.
 */
function hashFullStringToUuidV4(clean: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  let h3 = 0x85ebca6b;
  let h4 = 0xc2b2ae35;

  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ (code + i), 0x85ebca6b);
    h3 = Math.imul(h3 ^ (code ^ (i << 3)), 0xc2b2ae35);
    h4 = Math.imul(h4 ^ (code + i * 31), 0x27d4eb2f);
  }

  const mix32 = (h: number): number => {
    let x = h >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x85ebca6b) >>> 0;
    x ^= x >>> 13;
    x = Math.imul(x, 0xc2b2ae35) >>> 0;
    x ^= x >>> 16;
    return x >>> 0;
  };

  const w1 = mix32(h1 ^ h4).toString(16).padStart(8, '0');
  const w2 = mix32(h2 ^ h1).toString(16).padStart(8, '0');
  const w3 = mix32(h3 ^ h2).toString(16).padStart(8, '0');
  const w4 = mix32(h4 ^ h3).toString(16).padStart(8, '0');

  const rawHex = `${w1}${w2}${w3}${w4}`;
  const p1 = rawHex.slice(0, 8);
  const p2 = rawHex.slice(8, 12);
  const p3 = '4' + rawHex.slice(13, 16);
  const variantNibble = ((parseInt(rawHex[16], 16) & 0x3) | 0x8).toString(16);
  const p4 = variantNibble + rawHex.slice(17, 20);
  const p5 = rawHex.slice(20, 32);

  return `${p1}-${p2}-${p3}-${p4}-${p5}`;
}

/**
 * Derives a deterministic UUID v4 from a canonical seed string using the 4-lane 32-bit hash mixer.
 */
export function deriveDeterministicUuidFromCanonicalSeed(canonicalSeed: string): string {
  if (typeof canonicalSeed !== 'string' || canonicalSeed.trim() === '') {
    throw new Error('ERR_EMPTY_CANONICAL_SEED: Canonical seed cannot be empty.');
  }
  return hashFullStringToUuidV4(canonicalSeed);
}

/**
 * Computes the legacy unscoped UUID for backward-compatible reconciliation with pre-Phase 2.1 rows.
 */
export function computeLegacyUnscopedUuid(id: string): string {
  if (typeof id !== 'string') {
    throw new Error('ERR_EMPTY_TRADE_ID: Trade ID must be a string.');
  }
  const clean = id.trim();
  if (!clean) {
    throw new Error('ERR_EMPTY_TRADE_ID: Trade ID cannot be empty or whitespace.');
  }
  if (FORBIDDEN_SENTINEL_UUIDS.has(clean.toLowerCase())) {
    throw new Error('ERR_FORBIDDEN_SENTINEL_UUID: Sentinel or nil UUID is not allowed.');
  }
  if (GENERIC_UUID_REGEX.test(clean)) {
    return clean.toLowerCase();
  }
  const boundUuid = knownSyncedUuidByLocalId.get(clean);
  if (boundUuid) {
    return boundUuid;
  }
  if (clean.length <= 16) {
    return legacyAsciiEnsureValidUuid(clean);
  }
  return hashFullStringToUuidV4(clean);
}

/**
 * Ensures any trade ID is converted into a deterministic, owner-scoped UUID v4.
 * - Strictly rejects empty/whitespace IDs and forbidden sentinel UUIDs (never returns 00000000-0000-4000-8000-000000000000).
 * - Preserves an existing UUID as-is ONLY if it is explicitly registered as a cloud-bound UUID for `ownerScope`
 *   (or bound via `registerKnownTradeUuid` for `ownerScope`).
 * - Otherwise (including imported external/CSV UUIDs or local IDs), derives a deterministic UUID scoped to `ownerScope`
 *   using `${TRADEVAULT_UUID_NAMESPACE}:${cleanScope.toLowerCase()}:${normalizedId}`.
 */
export function ensureValidUuid(id: string, ownerScope: string = 'GUEST'): string {
  if (id === null || id === undefined || typeof id !== 'string') {
    throw new Error('ERR_EMPTY_TRADE_ID: Trade ID cannot be null, undefined, or non-string.');
  }
  const clean = id.trim();
  if (!clean) {
    throw new Error('ERR_EMPTY_TRADE_ID: Trade ID cannot be empty or whitespace.');
  }

  const lowerId = clean.toLowerCase();
  if (FORBIDDEN_SENTINEL_UUIDS.has(lowerId)) {
    throw new Error(
      `ERR_FORBIDDEN_SENTINEL_UUID: Sentinel UUID "${lowerId}" is forbidden for storage or sync.`
    );
  }

  const cleanScope = validateOwnerScope(ownerScope);
  const lowerScope = cleanScope.toLowerCase();

  // 1. If `clean` is a registered cloud-bound UUID for this specific ownerScope, preserve it
  if (GENERIC_UUID_REGEX.test(clean) && isRegisteredCloudTradeUuid(cleanScope, lowerId)) {
    return lowerId;
  }

  // 2. If `clean` is a localId explicitly bound to a cloud UUID for this ownerScope, preserve it
  const scopedBound = knownSyncedUuidByOwnerAndLocalId.get(lowerScope)?.get(clean);
  if (scopedBound) {
    return scopedBound;
  }

  // 3. Otherwise derive a deterministic UUID scoped to (TRADEVAULT_UUID_NAMESPACE, lowerScope, clean)
  const normalizedTradeIdForSeed = UUID_REGEX.test(clean) || GENERIC_UUID_REGEX.test(clean) ? lowerId : clean;
  const canonicalSeed = `${TRADEVAULT_UUID_NAMESPACE}:${lowerScope}:${normalizedTradeIdForSeed}`;
  return deriveDeterministicUuidFromCanonicalSeed(canonicalSeed);
}

/**
 * Mandatory cloud-path UUID resolver: requires a verified authenticated userId (never defaults to GUEST).
 */
export function resolveCloudTradeUuid(id: string, authenticatedUserId: string): string {
  const validUserId = requireAuthenticatedUserId(authenticatedUserId);
  return ensureValidUuid(id, validUserId);
}

/**
 * Parses a trade date/time value accurately:
 * - Local datetime-local strings without timezone offset ("YYYY-MM-DDTHH:mm" or "YYYY-MM-DD HH:mm:ss")
 *   are interpreted in the user's local timezone.
 * - Database UTC / timezone-qualified strings ("...Z", "...+00:00", "...+00", "...+07:00")
 *   are parsed as exact instants in time.
 */
export function parseTradeDateTime(rawDate: unknown): Date | null {
  if (rawDate instanceof Date) {
    return isNaN(rawDate.getTime()) ? null : rawDate;
  }
  if (typeof rawDate !== 'string') return null;

  const clean = rawDate.trim();
  if (!clean) return null;

  const dateOnlyMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const year = parseInt(dateOnlyMatch[1], 10);
    const month = parseInt(dateOnlyMatch[2], 10) - 1;
    const day = parseInt(dateOnlyMatch[3], 10);
    const d = new Date(year, month, day, 0, 0, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }

  const localMatch = clean.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/
  );
  if (localMatch) {
    const year = parseInt(localMatch[1], 10);
    const month = parseInt(localMatch[2], 10) - 1;
    const day = parseInt(localMatch[3], 10);
    const hour = parseInt(localMatch[4], 10);
    const minute = parseInt(localMatch[5], 10);
    const second = localMatch[6] ? parseInt(localMatch[6], 10) : 0;
    const ms = localMatch[7] ? parseInt(localMatch[7].slice(0, 3).padEnd(3, '0'), 10) : 0;
    const d = new Date(year, month, day, hour, minute, second, ms);
    return isNaN(d.getTime()) ? null : d;
  }

  let normalizedIso = clean.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/, '$1T$2');
  normalizedIso = normalizedIso.replace(/([+-]\d{2})$/, '$1:00');
  normalizedIso = normalizedIso.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');

  const parsed = new Date(normalizedIso);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Formats a Date or timestamp string (including UTC timestamps from Supabase TIMESTAMPTZ)
 * into the local "YYYY-MM-DDTHH:mm" format required by <input type="datetime-local" />.
 */
export function normalizeTradeDateTimeLocal(rawDate: unknown): string {
  const parsed = parseTradeDateTime(rawDate);
  const d = parsed || new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Converts an application trade.dateTime (typically local "YYYY-MM-DDTHH:mm")
 * into an explicit UTC ISO 8601 timestamp string for PostgreSQL TIMESTAMPTZ column.
 */
export function formatTradeDateTimeForDatabase(rawDate: unknown): string {
  const parsed = parseTradeDateTime(rawDate);
  if (parsed) {
    return parsed.toISOString();
  }
  return new Date().toISOString();
}

/**
 * Maps an application Trade object to the exact database columns of public.trades.
 * Encodes all extended 28-field Trade metadata using collision-proof UTF-8 Base64URL ([MetaB64: ...]).
 */
export function mapTradeToDatabasePayload(trade: Trade, userId: string) {
  const validUserId = requireAuthenticatedUserId(userId);
  const dbUuid = resolveCloudTradeUuid(trade.id, validUserId);

  const formattedTradeDate = formatTradeDateTimeForDatabase(trade.dateTime);
  const direction: 'Buy' | 'Sell' = normalizeTradeDirection(trade.position);

  const normalizedNetPnl = computeTradeNetProfit(trade);
  const normalizedComm = Math.abs(Number(trade.commission) || 0);
  const normalizedSwp = Number(trade.swap) || 0;
  const outcome: 'WIN' | 'LOSS' | 'BREAKEVEN' = classifyNetProfitOutcome(normalizedNetPnl);

  const realizedR = computeRealizedRMultiple(trade);
  const demoFlag = isDemoTrade(trade);

  const tradeForMetaEncoding: Trade = {
    ...trade,
    rMultiple: realizedR !== null ? realizedR : trade.rMultiple,
    isDemo: demoFlag ? true : Boolean(trade.isDemo),
  };

  const combinedNotes = encodeTradeNotesWithMetaB64(tradeForMetaEncoding, {
    localId: trade.id,
  });

  const rawScreenshotUrl = trade.screenshotUrl ? String(trade.screenshotUrl).trim() : '';
  if (rawScreenshotUrl.startsWith('data:image/')) {
    throw new Error(
      `Screenshot untuk transaksi "${trade.id}" masih berupa Base64 dan harus diunggah ke Supabase Storage terlebih dahulu sebelum disimpan ke database.`
    );
  }

  return {
    id: dbUuid,
    user_id: validUserId,
    trade_date: formattedTradeDate,
    instrument: (trade.instrument || 'XAUUSD').toUpperCase().trim(),
    direction,
    setup: (trade.strategy || 'Umum').trim(),
    entry_price: Number(trade.entryPrice) || 0,
    stop_loss:
      trade.stopLoss !== undefined && trade.stopLoss !== null && !isNaN(Number(trade.stopLoss))
        ? Number(trade.stopLoss)
        : 0,
    take_profit:
      trade.takeProfit !== undefined && trade.takeProfit !== null && !isNaN(Number(trade.takeProfit))
        ? Number(trade.takeProfit)
        : 0,
    exit_price:
      trade.exitPrice !== undefined && trade.exitPrice !== null && !isNaN(Number(trade.exitPrice))
        ? Number(trade.exitPrice)
        : null,
    lot_size: Number(trade.lotSize) || 0.01,
    outcome,
    net_pnl: normalizedNetPnl,
    commission: normalizedComm,
    swap: normalizedSwp,
    screenshot_url: rawScreenshotUrl ? rawScreenshotUrl : null,
    notes: combinedNotes ? combinedNotes : null,
    trading_session: (trade.session || 'London').trim(),
    created_at: trade.createdAt ? new Date(trade.createdAt).toISOString() : new Date().toISOString(),
    updated_at: trade.updatedAt ? new Date(trade.updatedAt).toISOString() : new Date().toISOString(),
  };
}

/**
 * Maps a database row from public.trades back into an application Trade object.
 * Supports both [MetaB64: ...] (all 28 fields) and legacy [LocalID: ...] + [Meta: {...}].
 */
export function mapDatabaseRowToTrade(row: any): Trade {
  const rawRowId = row?.id ? String(row.id).trim() : '';
  const rawUserId = row?.user_id ? String(row.user_id).trim() : undefined;

  const decodedNotes = decodeTradeNotesWithMeta(row?.notes ? String(row.notes) : undefined);
  const displayId = decodedNotes.extractedLocalId || rawRowId;
  const cleanNotes = decodedNotes.cleanNotes;

  if (rawRowId) {
    if (rawUserId) {
      registerCloudTradeUuids(rawUserId, [rawRowId]);
    }
    if (displayId) {
      registerKnownTradeUuid(displayId, rawRowId, rawUserId);
    }
  }

  const meta = decodedNotes.meta;
  const riskAmount =
    meta.riskAmount !== undefined && Number.isFinite(Number(meta.riskAmount))
      ? Number(meta.riskAmount)
      : 0;
  const riskPercentage =
    meta.riskPercentage !== undefined && Number.isFinite(Number(meta.riskPercentage))
      ? Number(meta.riskPercentage)
      : 1;
  let rMultiple: number | undefined =
    meta.rMultiple !== undefined && Number.isFinite(Number(meta.rMultiple))
      ? Number(meta.rMultiple)
      : undefined;
  const disciplineRating: number | undefined =
    meta.disciplineRating !== undefined && Number.isFinite(Number(meta.disciplineRating))
      ? Number(meta.disciplineRating)
      : undefined;
  let isDemo = meta.isDemo !== undefined ? Boolean(meta.isDemo) : false;

  if (isDemoTrade({ id: displayId, isDemo })) {
    isDemo = true;
  }

  const rawNet = Number(row.net_pnl !== undefined ? row.net_pnl : row.net_profit) || 0;
  const netPnl = Number(rawNet.toFixed(2));
  const commission = Math.abs(Number(row.commission) || 0);
  const swap = Number(row.swap) || 0;
  const grossProfit = computeGrossFromNet(netPnl, commission, swap);

  const resolvedR = computeRealizedRMultiple({
    netProfit: netPnl,
    grossProfit,
    commission,
    swap,
    riskAmount,
    rMultiple,
  });
  rMultiple = resolvedR !== null ? resolvedR : undefined;

  const position: 'BUY' | 'SELL' = mapDatabaseDirectionToApp(row.direction || row.position);
  const strategy = String(row.setup || row.strategy || 'Umum');
  const session = row.trading_session || row.session || 'London';
  const rawDateStr = row.trade_date || row.date_time || row.created_at || new Date();
  const dateStr = normalizeTradeDateTimeLocal(rawDateStr);

  return {
    id: displayId,
    dateTime: dateStr,
    instrument: row.instrument || 'XAUUSD',
    position,
    strategy,
    session,
    entryPrice: Number(row.entry_price) || 0,
    stopLoss:
      row.stop_loss !== null && row.stop_loss !== undefined && Number(row.stop_loss) > 0
        ? Number(row.stop_loss)
        : undefined,
    takeProfit:
      row.take_profit !== null && row.take_profit !== undefined && Number(row.take_profit) > 0
        ? Number(row.take_profit)
        : undefined,
    exitPrice:
      row.exit_price !== null && row.exit_price !== undefined && Number(row.exit_price) > 0
        ? Number(row.exit_price)
        : undefined,
    lotSize: Number(row.lot_size) || 0.01,
    riskAmount,
    riskPercentage,
    outcome: classifyNetProfitOutcome(netPnl),
    grossProfit,
    commission,
    swap,
    netProfit: netPnl,
    rMultiple,
    screenshotUrl: row.screenshot_url || undefined,
    notes: cleanNotes,
    entryReason: meta.entryReason || undefined,
    postTradeEvaluation: meta.postTradeEvaluation || undefined,
    disciplineRating,
    executionNotes: meta.executionNotes || undefined,
    closeExchangeRate: meta.closeExchangeRate || undefined,
    isDemo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Fetch all trades belonging to the authenticated user from Supabase.
 * Strictly filters by authenticated user_id and ensures complete deduplication.
 */
export async function fetchTradesFromSupabase(userId: string): Promise<SyncResult<Trade[]>> {
  let validUserId: string;
  try {
    validUserId = requireAuthenticatedUserId(userId);
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'User ID tidak valid. Silakan login terlebih dahulu.',
    };
  }

  const client = getSupabase();
  if (!client) {
    return { success: false, error: 'Supabase client belum terkonfigurasi.' };
  }

  try {
    const { data, error } = await client
      .from('trades')
      .select('*')
      .eq('user_id', validUserId)
      .order('trade_date', { ascending: false });

    if (error) {
      console.error('Supabase fetch trades error:', error);
      return { success: false, error: translateDatabaseError(error) };
    }

    const rawRows = data || [];
    const seenIds = new Set<string>();
    const deduplicatedTrades: Trade[] = [];

    for (const row of rawRows) {
      const trade = mapDatabaseRowToTrade(row);
      if (!seenIds.has(trade.id)) {
        seenIds.add(trade.id);
        deduplicatedTrades.push(trade);
      }
    }

    return { success: true, data: deduplicatedTrades };
  } catch (err: any) {
    console.error('Unexpected error in fetchTradesFromSupabase:', err);
    return { success: false, error: translateDatabaseError(err) };
  }
}

/**
 * Update an existing trade in Supabase public.trades table.
 * Strictly uses .update(...) filtered by id and authenticated user_id,
 * and verifies that the database returned the updated row.
 */
export async function updateTradeInSupabase(
  trade: Trade,
  userId: string,
  originalId?: string
): Promise<SyncResult<Trade>> {
  let validUserId: string;
  try {
    validUserId = requireAuthenticatedUserId(userId);
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'User ID tidak valid. Sesi login diperlukan untuk memperbarui database cloud.',
    };
  }

  const client = getSupabase();
  if (!client) {
    return { success: false, error: 'Supabase client tidak tersedia. Periksa konfigurasi URL dan Key.' };
  }

  try {
    const targetId = originalId || trade.id;
    const targetUuid = resolveCloudTradeUuid(targetId, validUserId);

    const screenshotSync = await ensureTradeScreenshotSynced(trade, validUserId);
    if (!screenshotSync.success || !screenshotSync.data) {
      return {
        success: false,
        error:
          screenshotSync.error ||
          `Gagal mengunggah screenshot untuk transaksi "${trade.id}" ke Supabase Storage.`,
      };
    }
    const tradeWithSyncedScreenshot = screenshotSync.data.trade;

    const fullPayload = mapTradeToDatabasePayload(tradeWithSyncedScreenshot, validUserId);

    const updatePayload: Record<string, any> = {
      trade_date: fullPayload.trade_date,
      instrument: fullPayload.instrument,
      direction: fullPayload.direction,
      setup: fullPayload.setup,
      entry_price: fullPayload.entry_price,
      stop_loss: fullPayload.stop_loss,
      take_profit: fullPayload.take_profit,
      exit_price: fullPayload.exit_price,
      lot_size: fullPayload.lot_size,
      outcome: fullPayload.outcome,
      net_pnl: fullPayload.net_pnl,
      commission: fullPayload.commission,
      swap: fullPayload.swap,
      screenshot_url: fullPayload.screenshot_url,
      notes: fullPayload.notes,
      trading_session: fullPayload.trading_session,
      updated_at: new Date().toISOString(),
    };

    if (originalId && originalId !== trade.id) {
      updatePayload.id = resolveCloudTradeUuid(trade.id, validUserId);
    }

    const { data, error } = await client
      .from('trades')
      .update(updatePayload)
      .eq('id', targetUuid)
      .eq('user_id', validUserId)
      .select();

    if (error) {
      console.error('Supabase update trade error:', error);
      return { success: false, error: translateDatabaseError(error) };
    }

    if (!data || data.length === 0) {
      return {
        success: false,
        error: `Gagal memperbarui transaksi: baris dengan ID "${targetId}" tidak ditemukan di database cloud atau Anda tidak memiliki hak akses (RLS).`,
      };
    }

    if (originalId && originalId !== trade.id) {
      unregisterKnownTradeUuid(originalId, validUserId);
    }
    const updatedTrade = mapDatabaseRowToTrade(data[0]);
    return { success: true, data: updatedTrade };
  } catch (err: any) {
    console.error('Unexpected error in updateTradeInSupabase:', err);
    return { success: false, error: translateDatabaseError(err) };
  }
}

/**
 * Insert a brand new trade into Supabase public.trades table.
 * Strictly uses .insert(...) and verifies that the new row was created.
 */
export async function insertTradeToSupabase(
  trade: Trade,
  userId: string
): Promise<SyncResult<Trade>> {
  let validUserId: string;
  try {
    validUserId = requireAuthenticatedUserId(userId);
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'User ID tidak valid. Sesi login diperlukan untuk mencatat transaksi cloud.',
    };
  }

  const client = getSupabase();
  if (!client) {
    return { success: false, error: 'Supabase client tidak tersedia. Periksa konfigurasi URL dan Key.' };
  }

  try {
    const screenshotSync = await ensureTradeScreenshotSynced(trade, validUserId);
    if (!screenshotSync.success || !screenshotSync.data) {
      return {
        success: false,
        error:
          screenshotSync.error ||
          `Gagal mengunggah screenshot untuk transaksi "${trade.id}" ke Supabase Storage.`,
      };
    }
    const tradeWithSyncedScreenshot = screenshotSync.data.trade;

    const payload = mapTradeToDatabasePayload(tradeWithSyncedScreenshot, validUserId);

    const { data, error } = await client
      .from('trades')
      .insert(payload)
      .select();

    if (error) {
      console.error('Supabase insert trade error:', error);
      return { success: false, error: translateDatabaseError(error) };
    }

    if (!data || data.length === 0) {
      return {
        success: false,
        error: 'Database tidak mengembalikan data transaksi baru yang disimpan.',
      };
    }

    const insertedTrade = mapDatabaseRowToTrade(data[0]);
    return { success: true, data: insertedTrade };
  } catch (err: any) {
    console.error('Unexpected error in insertTradeToSupabase:', err);
    return { success: false, error: translateDatabaseError(err) };
  }
}

/**
 * Save or update a trade in Supabase.
 * If originalId is specified, performs an explicit .update(...) on the existing row.
 * Otherwise, performs an .insert(...) for the new trade.
 */
export async function saveTradeToSupabase(
  trade: Trade,
  userId: string,
  originalId?: string
): Promise<SyncResult<Trade>> {
  if (originalId) {
    return updateTradeInSupabase(trade, userId, originalId);
  }
  return insertTradeToSupabase(trade, userId);
}

/**
 * Idempotently upsert a trade into Supabase public.trades table using verified session userId.
 */
export async function upsertTradeToSupabase(
  trade: Trade,
  userId: string
): Promise<SyncResult<Trade>> {
  let validUserId: string;
  try {
    validUserId = requireAuthenticatedUserId(userId);
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'User ID tidak valid. Sesi login diperlukan untuk menyinkronkan transaksi.',
    };
  }

  const client = getSupabase();
  if (!client) {
    return { success: false, error: 'Supabase client tidak tersedia. Periksa konfigurasi URL dan Key.' };
  }

  try {
    const screenshotSync = await ensureTradeScreenshotSynced(trade, validUserId);
    if (!screenshotSync.success || !screenshotSync.data) {
      return {
        success: false,
        error:
          screenshotSync.error ||
          `Gagal mengunggah screenshot untuk transaksi "${trade.id}" ke Supabase Storage.`,
      };
    }
    const tradeWithSyncedScreenshot = screenshotSync.data.trade;

    const payload = mapTradeToDatabasePayload(tradeWithSyncedScreenshot, validUserId);

    const { data, error } = await client
      .from('trades')
      .upsert(payload, { onConflict: 'id' })
      .select();

    if (error) {
      console.error('Supabase upsert trade error:', error);
      return { success: false, error: translateDatabaseError(error) };
    }

    if (!data || data.length === 0) {
      return {
        success: false,
        error: 'Database tidak mengembalikan data transaksi yang disimpan.',
      };
    }

    const savedTrade = mapDatabaseRowToTrade(data[0]);
    return { success: true, data: savedTrade };
  } catch (err: any) {
    console.error('Unexpected error in upsertTradeToSupabase:', err);
    return { success: false, error: translateDatabaseError(err) };
  }
}

/**
 * Delete trade from Supabase (enforcing authenticated user_id and verifying result)
 */
export async function deleteTradeFromSupabase(tradeId: string, userId: string): Promise<SyncResult> {
  let validUserId: string;
  try {
    validUserId = requireAuthenticatedUserId(userId);
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'User ID tidak valid. Sesi login diperlukan untuk menghapus dari database cloud.',
    };
  }

  const client = getSupabase();
  if (!client) {
    return { success: false, error: 'Supabase client tidak tersedia.' };
  }

  try {
    const dbUuid = resolveCloudTradeUuid(tradeId, validUserId);
    const { data, error } = await client
      .from('trades')
      .delete()
      .eq('id', dbUuid)
      .eq('user_id', validUserId)
      .select();

    if (error) {
      console.error('Supabase delete trade error:', error);
      return { success: false, error: translateDatabaseError(error) };
    }

    if (!data || data.length === 0) {
      return {
        success: false,
        error: `Transaksi "${tradeId}" tidak ditemukan di database cloud atau Anda tidak memiliki izin akses (RLS).`,
      };
    }

    unregisterKnownTradeUuid(tradeId, validUserId);
    return { success: true };
  } catch (err: any) {
    console.error('Unexpected error in deleteTradeFromSupabase:', err);
    return { success: false, error: translateDatabaseError(err) };
  }
}

const STORAGE_PATH_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-zA-Z0-9_.-]+\.(jpg|jpeg|png|webp)$/i;

/**
 * Strict validator for Supabase Storage paths:
 * Pattern: <ownerUuid>/<filename>.<ext>
 * Disallows data URLs (Base64), external HTTP(S) links, directory traversal, and invalid UUIDs.
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
  // Strictly reject traversal and null byte tokens
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
 * Verified Owner Context (F-26):
 * Immutable request-bound session credentials preventing auth race conditions.
 */
export interface VerifiedOwnerContext {
  readonly boundUserId: string;
  readonly boundAccessToken: string;
  readonly boundAccessTokenHash: string;
  readonly authGeneration: number;
  readonly createdAt: number;
}

export function createVerifiedOwnerContext(
  userId: string,
  accessToken: string,
  generation: number = 0
): VerifiedOwnerContext {
  const cleanId = requireAuthenticatedUserId(userId);
  const cleanToken = String(accessToken || '').trim();
  let hash = 0x811c9dc5;
  for (let i = 0; i < cleanToken.length; i++) {
    hash = Math.imul(hash ^ cleanToken.charCodeAt(i), 0x01000193);
  }
  const tokenHash = (hash >>> 0).toString(16).padStart(8, '0');

  return Object.freeze({
    boundUserId: cleanId,
    boundAccessToken: cleanToken,
    boundAccessTokenHash: tokenHash,
    authGeneration: generation,
    createdAt: Date.now(),
  });
}

/**
 * SyncCacheStore interface (F-29):
 * Provides strict isolation between production and testing sync caches.
 */
export interface SyncCacheStore {
  getUploadCache(key: string): string | undefined;
  setUploadCache(key: string, storagePath: string): void;
  getBase64Cache(storagePath: string): string | undefined;
  setBase64Cache(storagePath: string, base64: string): void;
  evictByPath(storagePath: string): void;
  clear(): void;
  getMutationCount(): number;
  snapshot(): { uploadCache: Record<string, string>; base64Cache: Record<string, string> };
  restore(snap: { uploadCache: Record<string, string>; base64Cache: Record<string, string> }): void;
}

const MAX_BASE64_PATH_CACHE_ENTRIES = 50;

/**
 * Factory for creating an isolated sync cache store instance.
 */
export function createIsolatedSyncCacheStore(): SyncCacheStore {
  const uploadCache = new Map<string, string>();
  const base64Cache = new Map<string, string>();
  let mutationCount = 0;

  return {
    getUploadCache(key: string): string | undefined {
      return uploadCache.get(key);
    },
    setUploadCache(key: string, storagePath: string): void {
      uploadCache.set(key, storagePath);
      mutationCount++;
    },
    getBase64Cache(storagePath: string): string | undefined {
      return base64Cache.get(storagePath);
    },
    setBase64Cache(storagePath: string, base64: string): void {
      if (!base64Cache.has(storagePath) && base64Cache.size >= MAX_BASE64_PATH_CACHE_ENTRIES) {
        const oldest = base64Cache.keys().next().value;
        if (oldest) base64Cache.delete(oldest);
      }
      base64Cache.set(storagePath, base64);
      mutationCount++;
    },
    evictByPath(storagePath: string): void {
      for (const [k, v] of uploadCache.entries()) {
        if (v === storagePath) {
          uploadCache.delete(k);
          mutationCount++;
        }
      }
      if (base64Cache.delete(storagePath)) {
        mutationCount++;
      }
    },
    clear(): void {
      uploadCache.clear();
      base64Cache.clear();
      mutationCount++;
    },
    getMutationCount(): number {
      return mutationCount;
    },
    snapshot(): { uploadCache: Record<string, string>; base64Cache: Record<string, string> } {
      const snapUpload: Record<string, string> = {};
      for (const [k, v] of uploadCache.entries()) snapUpload[k] = v;
      const snapBase64: Record<string, string> = {};
      for (const [k, v] of base64Cache.entries()) snapBase64[k] = v;
      return { uploadCache: snapUpload, base64Cache: snapBase64 };
    },
    restore(snap: { uploadCache: Record<string, string>; base64Cache: Record<string, string> }): void {
      uploadCache.clear();
      for (const [k, v] of Object.entries(snap.uploadCache)) uploadCache.set(k, v);
      base64Cache.clear();
      for (const [k, v] of Object.entries(snap.base64Cache)) base64Cache.set(k, v);
      mutationCount++;
    },
  };
}

/**
 * Global runtime cache store used in production.
 */
export const runtimeSyncCacheStore = createIsolatedSyncCacheStore();

export function getCachedBase64ForStoragePath(
  storagePath: string,
  expectedUserId?: string | null,
  store: SyncCacheStore = runtimeSyncCacheStore
): string | undefined {
  if (!storagePath || typeof storagePath !== 'string') return undefined;
  const cleanPath = storagePath.trim();
  if (expectedUserId && typeof expectedUserId === 'string' && expectedUserId.trim() !== '') {
    const cleanExpectedUser = expectedUserId.trim().toLowerCase();
    const pathOwnerId = cleanPath.split('/')[0].toLowerCase();
    if (pathOwnerId && pathOwnerId !== cleanExpectedUser) {
      return undefined;
    }
  }
  return store.getBase64Cache(cleanPath);
}

export function setCachedBase64ForStoragePath(
  storagePath: string,
  base64DataUrl: string,
  store: SyncCacheStore = runtimeSyncCacheStore
): void {
  if (!storagePath || !base64DataUrl) return;
  const cleanPath = storagePath.trim();
  const cleanDataUrl = base64DataUrl.trim();
  if (!isStoragePath(cleanPath) || !cleanDataUrl.startsWith('data:image/')) return;
  store.setBase64Cache(cleanPath, cleanDataUrl);
}

export function buildScreenshotUploadCacheKey(
  userId: string,
  tradeId: string,
  base64DataUrl: string
): string {
  const cleanUser = String(userId).trim();
  const cleanTrade = String(tradeId).trim();
  const raw = String(base64DataUrl).trim();
  return `${cleanUser}::${cleanTrade}::${raw.length}::${raw.slice(0, 64)}::${raw.slice(-64)}`;
}

export function getCachedUploadedScreenshotPath(
  userId: string,
  tradeId: string,
  base64DataUrl: string,
  store: SyncCacheStore = runtimeSyncCacheStore
): string | undefined {
  if (!userId || !tradeId || !base64DataUrl) return undefined;
  return store.getUploadCache(buildScreenshotUploadCacheKey(userId, tradeId, base64DataUrl));
}

export function setCachedUploadedScreenshotPath(
  userId: string,
  tradeId: string,
  base64DataUrl: string,
  storagePath: string,
  store: SyncCacheStore = runtimeSyncCacheStore
): void {
  if (!userId || !tradeId || !base64DataUrl || !storagePath) return;
  if (isStoragePath(storagePath)) {
    const cleanPath = storagePath.trim();
    store.setUploadCache(
      buildScreenshotUploadCacheKey(userId, tradeId, base64DataUrl),
      cleanPath
    );
    store.setBase64Cache(cleanPath, base64DataUrl);
  }
}

/**
 * Evicts any cached upload entries pointing to a storage path that has been deleted or invalidated.
 */
export function evictScreenshotUploadCacheByPath(
  storagePath: string,
  store: SyncCacheStore = runtimeSyncCacheStore
): void {
  if (!storagePath || typeof storagePath !== 'string') return;
  const target = storagePath.trim();
  if (!target) return;
  store.evictByPath(target);
}

export function clearScreenshotUploadCache(store: SyncCacheStore = runtimeSyncCacheStore): void {
  store.clear();
}

export function clearSessionSyncCaches(store: SyncCacheStore = runtimeSyncCacheStore): void {
  store.clear();
  clearKnownTradeUuids();
}


/**
 * Converts a Blob into a normalized 'data:image/...;base64,...' string.
 * Compatible with both browser (FileReader) and Node/test environments (arrayBuffer).
 */
export async function encodeBlobToBase64DataUrl(
  blob: Blob,
  fallbackMime = 'image/jpeg'
): Promise<string | null> {
  if (!blob || !(blob instanceof Blob)) return null;
  const mime = blob.type && blob.type.startsWith('image/') ? blob.type : fallbackMime;

  try {
    if (typeof FileReader !== 'undefined') {
      return await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (typeof reader.result === 'string') {
            let res = reader.result;
            if (!res.startsWith('data:image/')) {
              const commaIdx = res.indexOf(',');
              const b64 = commaIdx !== -1 ? res.slice(commaIdx + 1) : res;
              res = `data:${mime};base64,${b64}`;
            }
            resolve(res);
          } else {
            resolve(null);
          }
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    }

    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return `data:${mime};base64,${base64}`;
  } catch {
    return null;
  }
}

/**
 * Verifies whether a private storage object path exists and is accessible by the active session.
 */
async function verifyStorageObjectAccessible(filePath: string): Promise<boolean> {
  if (!filePath || !isStoragePath(filePath)) return false;
  const client = getSupabase();
  if (!client) return false;

  const cleanPath = filePath.trim();
  try {
    const { data, error } = await client.storage
      .from('trade-screenshots')
      .createSignedUrl(cleanPath, 60);

    if (!error && data?.signedUrl) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Decodes a Base64 Data URL ('data:image/...;base64,...') into a typed Blob and file extension
 * without relying on network fetch().
 */
export function decodeBase64DataUrlToBlob(
  base64DataUrl: string
): { success: boolean; blob?: Blob; contentType?: string; ext?: 'jpg' | 'png' | 'webp'; error?: string } {
  if (!base64DataUrl || typeof base64DataUrl !== 'string') {
    return { success: false, error: 'Data gambar Base64 tidak valid.' };
  }
  const trimmed = base64DataUrl.trim();
  const match = trimmed.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,([\s\S]+)$/);
  if (!match) {
    return { success: false, error: 'Format Data URL Base64 gambar tidak dikenali.' };
  }

  const rawMime = match[1].toLowerCase();
  const base64Payload = match[2].replace(/\s+/g, '');
  if (!base64Payload) {
    return { success: false, error: 'Isi data gambar Base64 kosong.' };
  }

  try {
    const binaryStr = atob(base64Payload);
    if (binaryStr.length === 0) {
      return { success: false, error: 'Data biner gambar Base64 kosong (0 byte).' };
    }
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    let ext: 'jpg' | 'png' | 'webp' = 'jpg';
    let contentType = 'image/jpeg';
    if (rawMime.includes('png')) {
      ext = 'png';
      contentType = 'image/png';
    }

    const blob = new Blob([bytes], { type: contentType });
    return { success: true, blob, contentType, ext };
  } catch {
    return { success: false, error: 'Data Base64 gambar rusak dan tidak dapat didekode.' };
  }
}

/**
 * Transcodes any data:image/webp (or unsupported image format) Data URL into data:image/jpeg
 * via HTML5 Canvas when running in browser/APK WebView, preventing Supabase Storage buckets
 * configured only for JPEG/PNG from throwing "mime type image/webp is not supported".
 */
export async function ensureSupabaseCompatibleImageDataUrl(dataUrl: string): Promise<string> {
  const trimmed = (dataUrl || '').trim();
  if (!trimmed.startsWith('data:image/')) return trimmed;

  const mimeMatch = trimmed.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/i);
  const rawMime = mimeMatch ? mimeMatch[1].toLowerCase() : '';
  if (rawMime === 'image/jpeg' || rawMime === 'image/jpg' || rawMime === 'image/png') {
    return trimmed;
  }

  if (typeof document !== 'undefined' && typeof Image !== 'undefined') {
    try {
      const converted = await new Promise<string>((resolve) => {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.width || 1280;
            canvas.height = img.height || 720;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.fillStyle = '#0f172a';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = 'high';
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              const jpegUrl = canvas.toDataURL('image/jpeg', 0.88);
              canvas.width = 0;
              canvas.height = 0;
              if (jpegUrl && jpegUrl.startsWith('data:image/jpeg')) {
                resolve(jpegUrl);
                return;
              }
            }
          } catch {
            // Fall through to header rewrite fallback
          }
          resolve(trimmed.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/i, 'data:image/jpeg;base64,'));
        };
        img.onerror = () => {
          resolve(trimmed.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/i, 'data:image/jpeg;base64,'));
        };
        img.src = trimmed;
      });
      return converted;
    } catch {
      return trimmed.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/i, 'data:image/jpeg;base64,');
    }
  }

  return trimmed.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/i, 'data:image/jpeg;base64,');
}

/**
 * Uploads a Base64 screenshot to the private Supabase Storage bucket ('trade-screenshots')
 * and returns the relative object path: "<userId>/<tradeId>_<timestamp>_<suffix>.<ext>".
 * Does NOT return a public URL or Base64.
 * Reuses cached storage path ONLY if the exact same Base64 image for the same user & trade
 * is cached AND still exists in Supabase Storage.
 */
export async function uploadScreenshotToSupabase(
  base64DataUrl: string,
  tradeId: string,
  userId: string
): Promise<SyncResult<string>> {
  const client = getSupabase();
  if (!client) {
    return { success: false, error: 'Supabase client tidak tersedia. Periksa konfigurasi URL dan Key.' };
  }

  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    return { success: false, error: 'User ID tidak valid. Sesi login diperlukan untuk mengunggah screenshot.' };
  }

  if (!base64DataUrl || typeof base64DataUrl !== 'string') {
    return { success: false, error: 'Data gambar tidak valid.' };
  }

  const trimmedUrl = base64DataUrl.trim();
  const cleanUserId = userId.trim();

  // If not a Base64 data URL (e.g. already a valid storage path or external URL), do not re-upload
  if (!trimmedUrl.startsWith('data:image/')) {
    return { success: true, data: trimmedUrl };
  }

  // Check shared upload cache first to prevent duplicate uploads on retry
  const cachedPath = getCachedUploadedScreenshotPath(cleanUserId, tradeId, trimmedUrl);
  if (cachedPath && cachedPath.startsWith(`${cleanUserId}/`)) {
    const stillExists = await verifyStorageObjectAccessible(cachedPath);
    if (stillExists) {
      setCachedBase64ForStoragePath(cachedPath, trimmedUrl);
      return { success: true, data: cachedPath };
    }
    // Cached object was deleted from Storage; evict stale cache entry and re-upload
    evictScreenshotUploadCacheByPath(cachedPath);
  }

  try {
    // Ensure WebP or other non-standard MIME types are converted to JPEG before uploading
    const compatibleDataUrl = await ensureSupabaseCompatibleImageDataUrl(trimmedUrl);
    const decoded = decodeBase64DataUrlToBlob(compatibleDataUrl);
    if (!decoded.success || !decoded.blob || !decoded.contentType || !decoded.ext) {
      return { success: false, error: decoded.error || 'Gagal memproses data gambar Base64.' };
    }

    const cleanTradeId = String(tradeId).trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'trade';
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    let finalExt = decoded.ext === 'webp' ? 'jpg' : decoded.ext;
    let finalContentType = decoded.contentType === 'image/webp' ? 'image/jpeg' : decoded.contentType;
    let finalBlob =
      decoded.blob.type === finalContentType
        ? decoded.blob
        : new Blob([decoded.blob], { type: finalContentType });
    let filePath = `${cleanUserId}/${cleanTradeId}_${Date.now()}_${randomSuffix}.${finalExt}`;

    let { error: uploadError } = await client.storage
      .from('trade-screenshots')
      .upload(filePath, finalBlob, {
        contentType: finalContentType,
        upsert: false,
      });

    // Fallback: if bucket rejects MIME type for any reason, retry explicitly as image/jpeg (.jpg)
    if (
      uploadError &&
      /mime\s*type|not\s*supported/i.test(String(uploadError.message || uploadError))
    ) {
      finalExt = 'jpg';
      finalContentType = 'image/jpeg';
      finalBlob = new Blob([decoded.blob], { type: 'image/jpeg' });
      filePath = `${cleanUserId}/${cleanTradeId}_${Date.now()}_${randomSuffix}_jpg.jpg`;
      const retryRes = await client.storage
        .from('trade-screenshots')
        .upload(filePath, finalBlob, {
          contentType: 'image/jpeg',
          upsert: false,
        });
      uploadError = retryRes.error;
    }

    if (uploadError) {
      console.error('Supabase Storage upload error:', uploadError);
      return { success: false, error: translateDatabaseError(uploadError) };
    }

    // Cache and return the relative storage object path (NOT public URL and NOT base64)
    setCachedUploadedScreenshotPath(cleanUserId, tradeId, trimmedUrl, filePath);
    return { success: true, data: filePath };
  } catch (err: any) {
    console.error('Unexpected error in uploadScreenshotToSupabase:', err);
    return { success: false, error: translateDatabaseError(err) };
  }
}

/**
 * Ensures a trade's screenshotUrl is synced to Supabase Storage before saving to public.trades:
 * - If screenshotUrl is empty or an external HTTP(S) URL: returns as-is without uploading.
 * - If screenshotUrl is a Storage path ('<userId>/<file>.<ext>'):
 *   - If accessible in Storage under active userId, preserves the path without re-uploading.
 *   - If the object was deleted from Storage (or belonged to another user) and its Base64 data
 *     is available in base64ByStoragePathCache, automatically re-uploads it to Storage under userId.
 * - If screenshotUrl is a Base64 Data URL ('data:image/...'): uploads to Supabase Storage (or reuses
 *   verified cached path) and returns a cloned Trade with screenshotUrl set to the storage path.
 * - If upload fails: returns { success: false, error } without mutating or deleting the source trade's screenshotUrl.
 */
/**
 * Helper to extract all storage paths referenced by a trade (including main screenshotUrl
 * and lifecycle beforeScreenshotUrl / afterScreenshotUrl in executionNotes).
 */
export function extractAllTradeStoragePaths(trade: Partial<Trade> | null | undefined): string[] {
  if (!trade) return [];
  const paths: string[] = [];
  const addIfStoragePath = (val?: string | null) => {
    if (!val || typeof val !== 'string') return;
    const trimmed = val.trim();
    if (trimmed && isStoragePath(trimmed) && !paths.includes(trimmed)) {
      paths.push(trimmed);
    }
  };
  addIfStoragePath(trade.screenshotUrl);
  if (trade.executionNotes) {
    const meta = decodeLifecycleMetaFromExecutionNotes(trade.executionNotes);
    addIfStoragePath(meta.beforeScreenshotUrl);
    addIfStoragePath(meta.afterScreenshotUrl);
  }
  return paths;
}

/**
 * Syncs and deduplicates any Base64 screenshots embedded inside trade.executionNotes ([TV_META:...])
 * so that raw Base64 strings never bloat the database `notes` column or localStorage.
 */
async function syncLifecycleExecutionNotesScreenshots(
  trade: Trade,
  cleanUserId: string
): Promise<SyncResult<{ executionNotes?: string; wasUploaded: boolean }>> {
  if (!trade.executionNotes || typeof trade.executionNotes !== 'string') {
    return {
      success: true,
      data: { executionNotes: trade.executionNotes, wasUploaded: false },
    };
  }

  const meta = decodeLifecycleMetaFromExecutionNotes(trade.executionNotes);
  if (Object.keys(meta).length === 0) {
    return {
      success: true,
      data: { executionNotes: trade.executionNotes, wasUploaded: false },
    };
  }

  let changed = false;
  let wasUploaded = false;
  const nextMeta = { ...meta };
  const mainRef = trade.screenshotUrl ? String(trade.screenshotUrl).trim() : '';

  // 1. Handle beforeScreenshotUrl: if identical to main screenshotUrl, omit from [TV_META]
  // because resolveTradeLifecycle automatically falls back to trade.screenshotUrl.
  if (nextMeta.beforeScreenshotUrl) {
    const beforeRef = nextMeta.beforeScreenshotUrl.trim();
    if (beforeRef === mainRef) {
      delete nextMeta.beforeScreenshotUrl;
      changed = true;
    } else if (beforeRef.startsWith('data:image/')) {
      const uploadRes = await uploadScreenshotToSupabase(
        beforeRef,
        `${trade.id}_before`,
        cleanUserId
      );
      if (!uploadRes.success || !uploadRes.data) {
        return {
          success: false,
          error:
            uploadRes.error ||
            `Gagal mengunggah screenshot Before Trade untuk "${trade.id}" ke Supabase Storage.`,
        };
      }
      if (uploadRes.data === mainRef) {
        delete nextMeta.beforeScreenshotUrl;
      } else {
        nextMeta.beforeScreenshotUrl = uploadRes.data;
      }
      changed = true;
      wasUploaded = true;
    }
  }

  // 2. Handle afterScreenshotUrl: upload Base64 to Storage and store compact storage path
  if (nextMeta.afterScreenshotUrl) {
    const afterRef = nextMeta.afterScreenshotUrl.trim();
    if (afterRef.startsWith('data:image/')) {
      const uploadRes = await uploadScreenshotToSupabase(
        afterRef,
        `${trade.id}_after`,
        cleanUserId
      );
      if (!uploadRes.success || !uploadRes.data) {
        return {
          success: false,
          error:
            uploadRes.error ||
            `Gagal mengunggah screenshot After Trade untuk "${trade.id}" ke Supabase Storage.`,
        };
      }
      nextMeta.afterScreenshotUrl = uploadRes.data;
      changed = true;
      wasUploaded = true;
    }
  }

  if (!changed) {
    return {
      success: true,
      data: { executionNotes: trade.executionNotes, wasUploaded: false },
    };
  }

  const nextExecutionNotes = encodeLifecycleMetaIntoExecutionNotes(
    trade.executionNotes,
    nextMeta
  );
  return {
    success: true,
    data: {
      executionNotes: nextExecutionNotes || undefined,
      wasUploaded,
    },
  };
}

export async function ensureTradeScreenshotSynced(
  trade: Trade,
  userId: string
): Promise<SyncResult<{ trade: Trade; uploadedStoragePath?: string; wasUploaded: boolean }>> {
  const cleanUserId = userId.trim();
  const rawRef = trade.screenshotUrl ? String(trade.screenshotUrl).trim() : '';

  let syncedScreenshotUrl: string | undefined = rawRef || undefined;
  let uploadedStoragePath: string | undefined;
  let wasMainUploaded = false;

  if (rawRef) {
    if (!rawRef.startsWith('data:image/')) {
      if (isStoragePath(rawRef)) {
        const isOwnedByActiveUser = rawRef.startsWith(`${cleanUserId}/`);
        const isAccessible = isOwnedByActiveUser ? await verifyStorageObjectAccessible(rawRef) : false;

        if (!isAccessible) {
          const cachedBase64 = getCachedBase64ForStoragePath(rawRef);
          if (cachedBase64) {
            evictScreenshotUploadCacheByPath(rawRef);
            const reuploadRes = await uploadScreenshotToSupabase(cachedBase64, trade.id, cleanUserId);
            if (!reuploadRes.success || !reuploadRes.data) {
              return {
                success: false,
                error:
                  reuploadRes.error ||
                  `Gagal mengunggah ulang screenshot untuk transaksi "${trade.id}" ke Supabase Storage.`,
              };
            }
            syncedScreenshotUrl = reuploadRes.data;
            uploadedStoragePath = reuploadRes.data;
            wasMainUploaded = true;
          }
        }
      }
    } else {
      const existingCachedPath = getCachedUploadedScreenshotPath(cleanUserId, trade.id, rawRef);
      const wasAlreadyCached = Boolean(
        existingCachedPath &&
          existingCachedPath.startsWith(`${cleanUserId}/`) &&
          (await verifyStorageObjectAccessible(existingCachedPath))
      );

      const uploadRes = await uploadScreenshotToSupabase(rawRef, trade.id, cleanUserId);
      if (!uploadRes.success || !uploadRes.data) {
        return {
          success: false,
          error:
            uploadRes.error ||
            `Gagal mengunggah screenshot untuk transaksi "${trade.id}" ke Supabase Storage.`,
        };
      }
      syncedScreenshotUrl = uploadRes.data;
      uploadedStoragePath = uploadRes.data;
      wasMainUploaded = !wasAlreadyCached;
    }
  }

  const tradeWithMainSynced: Trade = {
    ...trade,
    screenshotUrl: syncedScreenshotUrl,
  };

  // Also sync and deduplicate any Base64 screenshots inside executionNotes ([TV_META:...])
  const metaSync = await syncLifecycleExecutionNotesScreenshots(tradeWithMainSynced, cleanUserId);
  if (!metaSync.success || !metaSync.data) {
    return {
      success: false,
      error: metaSync.error || `Gagal menyinkronkan metadata screenshot untuk "${trade.id}".`,
    };
  }

  return {
    success: true,
    data: {
      trade: {
        ...tradeWithMainSynced,
        executionNotes: metaSync.data.executionNotes,
      },
      uploadedStoragePath,
      wasUploaded: wasMainUploaded || metaSync.data.wasUploaded,
    },
  };
}

/**
 * Uploads a raw Blob screenshot to the private Supabase Storage bucket ('trade-screenshots')
 * under the active authenticated user's directory: "<userId>/<tradeId>_<timestamp>_<random>.<ext>".
 * Strictly uses the active user's ID and never trusts user IDs or paths from external backups.
 */
export async function uploadScreenshotBlobToSupabase(
  blob: Blob,
  tradeId: string,
  userId: string,
  preferredExt?: string
): Promise<SyncResult<string>> {
  const client = getSupabase();
  if (!client) {
    return { success: false, error: 'Supabase client tidak tersedia. Periksa konfigurasi URL dan Key.' };
  }
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    return { success: false, error: 'User ID tidak valid. Sesi login diperlukan untuk mengunggah screenshot.' };
  }
  if (!blob || !(blob instanceof Blob)) {
    return { success: false, error: 'File gambar Blob tidak valid.' };
  }

  try {
    const cleanTradeId = String(tradeId).trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'trade';
    const rawExt = (preferredExt || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const cleanExt = rawExt === 'webp' ? 'jpg' : rawExt;
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const filePath = `${userId.trim()}/${cleanTradeId}_${Date.now()}_${randomSuffix}.${cleanExt}`;

    let contentType = blob.type;
    if (
      !contentType ||
      contentType === 'application/octet-stream' ||
      contentType === 'image/webp' ||
      !contentType.startsWith('image/')
    ) {
      if (cleanExt === 'png') contentType = 'image/png';
      else contentType = 'image/jpeg';
    }

    // CRITICAL: Ensure the Blob instance itself has the detected image contentType
    // to prevent Supabase Storage from rejecting it as application/octet-stream or image/webp
    const typedBlob = blob.type === contentType ? blob : new Blob([blob], { type: contentType });

    let finalFilePath = filePath;
    let { error: uploadError } = await client.storage
      .from('trade-screenshots')
      .upload(finalFilePath, typedBlob, {
        contentType,
        upsert: false,
      });

    if (
      uploadError &&
      /mime\s*type|not\s*supported/i.test(String(uploadError.message || uploadError))
    ) {
      contentType = 'image/jpeg';
      const retryBlob = new Blob([blob], { type: 'image/jpeg' });
      finalFilePath = `${userId.trim()}/${cleanTradeId}_${Date.now()}_${randomSuffix}_jpg.jpg`;
      const retryRes = await client.storage
        .from('trade-screenshots')
        .upload(finalFilePath, retryBlob, {
          contentType: 'image/jpeg',
          upsert: false,
        });
      uploadError = retryRes.error;
    }

    if (uploadError) {
      console.error('Supabase Storage blob upload error:', uploadError);
      return { success: false, error: translateDatabaseError(uploadError) };
    }

    encodeBlobToBase64DataUrl(typedBlob, contentType)
      .then((b64) => {
        if (b64) setCachedBase64ForStoragePath(finalFilePath, b64);
      })
      .catch(() => {});

    return { success: true, data: finalFilePath };
  } catch (err: any) {
    console.error('Unexpected error in uploadScreenshotBlobToSupabase:', err);
    return { success: false, error: translateDatabaseError(err) };
  }
}

export interface SignedUrlDiagnosticResult {
  url: string | null;
  errorReason?: 'invalid_path' | 'not_authenticated' | 'wrong_user_folder' | 'not_found' | 'storage_error';
  errorMessage?: string;
}

/**
 * Resolves a displayable URL (signed URL or authenticated download Data URL fallback)
 * for a private storage path, along with accurate diagnostic information if loading fails.
 */
export async function resolveScreenshotSignedUrlWithDiagnostics(
  filePath: string,
  expiresIn = 3600
): Promise<SignedUrlDiagnosticResult> {
  if (!filePath || !isStoragePath(filePath)) {
    return {
      url: null,
      errorReason: 'invalid_path',
      errorMessage: 'Format tautan screenshot tidak dikenali.',
    };
  }

  const cleanPath = filePath.trim();
  const pathOwnerId = cleanPath.split('/')[0];
  const client = getSupabase();
  if (!client) {
    const cachedFallback = getCachedBase64ForStoragePath(cleanPath);
    if (cachedFallback) {
      return { url: cachedFallback };
    }
    return {
      url: null,
      errorReason: 'not_authenticated',
      errorMessage: 'Gagal memuat screenshot dari Storage privat. Pastikan sesi login aktif.',
    };
  }

  let activeUserId: string | null = null;
  let hasSessionCheck = false;
  try {
    if (client.auth && typeof client.auth.getSession === 'function') {
      hasSessionCheck = true;
      const { data: sessionData } = await client.auth.getSession();
      activeUserId = sessionData?.session?.user?.id || null;
    }
  } catch {
    // continue to storage call even if getSession is unavailable in mock tests
  }

  // Strictly block cross-account access if activeUserId belongs to a different user than pathOwnerId
  if (activeUserId && pathOwnerId && pathOwnerId !== activeUserId) {
    return {
      url: null,
      errorReason: 'wrong_user_folder',
      errorMessage:
        'Gagal memuat screenshot: Path gambar berasal dari folder akun pengguna lain dan dibatasi oleh privasi Storage.',
    };
  }

  const canUseMemoryCacheFallback =
    !hasSessionCheck || (Boolean(activeUserId) && pathOwnerId === activeUserId);

  try {
    // 1. Primary path: create temporary signed URL via Supabase Storage
    const { data, error } = await client.storage
      .from('trade-screenshots')
      .createSignedUrl(cleanPath, expiresIn);

    if (!error && data?.signedUrl) {
      return { url: data.signedUrl };
    }

    // 2. Fallback path: try authenticated blob download (in case signed URL endpoint failed transiently)
    try {
      if (typeof client.storage.from('trade-screenshots').download === 'function') {
        const { data: blobData, error: dlError } = await client.storage
          .from('trade-screenshots')
          .download(cleanPath);
        if (!dlError && blobData) {
          const dataUrl = await encodeBlobToBase64DataUrl(blobData, blobData.type || 'image/jpeg');
          if (dataUrl) {
            setCachedBase64ForStoragePath(cleanPath, dataUrl);
            return { url: dataUrl };
          }
        }
      }
    } catch {
      // ignore download fallback error
    }

    // 3. In-memory Base64 cache fallback (strictly isolated to the owning user session)
    if (canUseMemoryCacheFallback) {
      const cachedFallback = getCachedBase64ForStoragePath(cleanPath, activeUserId);
      if (cachedFallback) {
        return { url: cachedFallback };
      }
    }

    // 4. Determine accurate error reason for UI reporting
    const rawErrMsg = (error?.message || '').toLowerCase();

    if (!activeUserId && (rawErrMsg.includes('jwt') || rawErrMsg.includes('unauthorized') || rawErrMsg.includes('not authenticated'))) {
      return {
        url: null,
        errorReason: 'not_authenticated',
        errorMessage: 'Gagal memuat screenshot dari Storage privat. Pastikan sesi login aktif.',
      };
    }

    if (activeUserId && pathOwnerId && pathOwnerId !== activeUserId) {
      return {
        url: null,
        errorReason: 'wrong_user_folder',
        errorMessage:
          'Gagal memuat screenshot: Path gambar berasal dari folder akun pengguna lain dan dibatasi oleh privasi Storage.',
      };
    }

    if (
      rawErrMsg.includes('object not found') ||
      rawErrMsg.includes('not found') ||
      rawErrMsg.includes('does not exist') ||
      (error as any)?.statusCode === '404' ||
      (error as any)?.statusCode === 404 ||
      (error as any)?.status === 400
    ) {
      if (!activeUserId) {
        return {
          url: null,
          errorReason: 'not_authenticated',
          errorMessage: 'Gagal memuat screenshot dari Storage privat. Pastikan sesi login aktif.',
        };
      }
      return {
        url: null,
        errorReason: 'not_found',
        errorMessage:
          'File screenshot tidak ditemukan di Supabase Storage. Hal ini terjadi jika Backup JSON lama hanya menyimpan path referensi dan objek gambar di Storage sudah terhapus.',
      };
    }

    if (error) {
      console.warn('Gagal membuat signed URL untuk:', cleanPath, error.message);
    }

    return {
      url: null,
      errorReason: activeUserId ? 'storage_error' : 'not_authenticated',
      errorMessage: activeUserId
        ? `Gagal memuat screenshot dari Storage privat (${error?.message || 'akses ditolak atau objek tidak ditemukan'}).`
        : 'Gagal memuat screenshot dari Storage privat. Pastikan sesi login aktif.',
    };
  } catch (err: any) {
    console.error('Error saat membuat signed URL:', err);
    if (canUseMemoryCacheFallback) {
      const cachedFallback = getCachedBase64ForStoragePath(cleanPath, activeUserId);
      if (cachedFallback) {
        return { url: cachedFallback };
      }
    }
    return {
      url: null,
      errorReason: 'storage_error',
      errorMessage: 'Gagal memuat screenshot dari Storage privat. Pastikan sesi login aktif.',
    };
  }
}

/**
 * Creates a temporary signed URL for a private storage object path.
 * Returns null if path is invalid or creation fails.
 */
export async function createScreenshotSignedUrl(
  filePath: string,
  expiresIn = 3600
): Promise<string | null> {
  const result = await resolveScreenshotSignedUrlWithDiagnostics(filePath, expiresIn);
  return result.url;
}

/**
 * Deletes a screenshot file from the private storage bucket.
 * Strictly verifies that the path is a valid storage path before calling remove,
 * evicts the path from screenshotUploadCache so subsequent restores never reuse a deleted path,
 * and caches the image in base64ByStoragePathCache prior to removal so same-session JSON restores can re-upload it.
 */
export async function deleteScreenshotFromSupabase(
  filePath: string
): Promise<SyncResult> {
  if (!filePath || !isStoragePath(filePath)) {
    return { success: true };
  }

  const cleanPath = filePath.trim();
  // Always evict from upload cache immediately so deleted paths are never reused
  evictScreenshotUploadCacheByPath(cleanPath);

  const client = getSupabase();
  if (!client) {
    return { success: false, error: 'Supabase client tidak tersedia.' };
  }

  try {
    // Best-effort: cache Base64 in memory before deleting from Storage so if the user
    // immediately restores a legacy JSON backup (containing only cleanPath), it can be re-uploaded
    if (!getCachedBase64ForStoragePath(cleanPath)) {
      try {
        if (typeof client.storage.from('trade-screenshots').download === 'function') {
          const { data: blobData } = await client.storage
            .from('trade-screenshots')
            .download(cleanPath);
          if (blobData) {
            const b64 = await encodeBlobToBase64DataUrl(blobData, blobData.type || 'image/jpeg');
            if (b64) {
              setCachedBase64ForStoragePath(cleanPath, b64);
            }
          }
        }
      } catch {
        // non-blocking
      }
    }

    const { error } = await client.storage
      .from('trade-screenshots')
      .remove([cleanPath]);

    if (error) {
      console.warn('Gagal menghapus file dari storage:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    console.error('Error saat menghapus screenshot dari storage:', err);
    return { success: false, error: err?.message || 'Gagal menghapus file storage.' };
  }
}

/**
 * Safely downloads a screenshot Blob from the private 'trade-screenshots' bucket.
 * Strictly verifies that the user is authenticated and the path begins with the user's ID
 * to prevent accessing or traversing other users' directories.
 */
export async function downloadScreenshotBlob(
  filePath: string,
  activeUserId: string
): Promise<{ success: boolean; blob?: Blob; contentType?: string; error?: string }> {
  if (!activeUserId || typeof activeUserId !== 'string' || activeUserId.trim() === '') {
    return { success: false, error: 'User ID tidak valid. Sesi login diperlukan untuk mengunduh dari storage privat.' };
  }

  if (!filePath || !isStoragePath(filePath)) {
    return { success: false, error: `Path storage tidak valid: "${filePath}"` };
  }

  // Strictly enforce folder ownership: must match activeUserId/
  const trimmedUserId = activeUserId.trim();
  const cleanPath = filePath.trim();
  const pathParts = cleanPath.split('/');
  if (pathParts[0] !== trimmedUserId) {
    return {
      success: false,
      error: `Izin akses ditolak: Path storage "${cleanPath}" bukan milik folder pengguna aktif (${trimmedUserId}).`,
    };
  }

  const client = getSupabase();
  if (!client) {
    return { success: false, error: 'Koneksi Supabase belum diinisialisasi.' };
  }

  try {
    const { data, error } = await client.storage
      .from('trade-screenshots')
      .download(cleanPath);

    if (error || !data) {
      console.warn(`Gagal mengunduh screenshot "${cleanPath}":`, error?.message);
      return { success: false, error: error?.message || 'File tidak ditemukan di storage.' };
    }

    return {
      success: true,
      blob: data,
      contentType: data.type || 'image/jpeg',
    };
  } catch (err: any) {
    console.error(`Error downloadScreenshotBlob for "${cleanPath}":`, err);
    return { success: false, error: err?.message || 'Gagal mengunduh screenshot dari Supabase Storage.' };
  }
}

/**
 * Prepares a cloned array of trades for JSON backup export by resolving private Storage paths
 * into self-contained 'data:image/...;base64,...' strings whenever possible.
 * Does NOT mutate the live trades array or database rows.
 * Ensures that if a user exports a JSON backup while logged into Cloud, deletes their trades
 * (which deletes the Storage files), and later restores the JSON backup, all screenshots are
 * preserved and re-uploaded to Supabase Storage.
 */
export async function prepareTradesForJsonBackup(
  trades: Trade[],
  activeUserId?: string | null
): Promise<Trade[]> {
  let resolvedUserId = activeUserId ? String(activeUserId).trim() : '';
  if (!resolvedUserId) {
    const client = getSupabase();
    if (client?.auth && typeof client.auth.getSession === 'function') {
      try {
        const { data } = await client.auth.getSession();
        resolvedUserId = data?.session?.user?.id || '';
      } catch {
        // ignore
      }
    }
  }

  const prepared: Trade[] = [];
  for (const t of trades) {
    const rawUrl = t.screenshotUrl ? String(t.screenshotUrl).trim() : '';
    if (!rawUrl || !isStoragePath(rawUrl)) {
      prepared.push({ ...t });
      continue;
    }

    // 1. Check in-memory Base64 cache first
    const cachedB64 = getCachedBase64ForStoragePath(rawUrl);
    if (cachedB64) {
      prepared.push({ ...t, screenshotUrl: cachedB64 });
      continue;
    }

    // 2. Download from private Storage if user session is active and owns the folder
    if (resolvedUserId && rawUrl.startsWith(`${resolvedUserId}/`)) {
      const dl = await downloadScreenshotBlob(rawUrl, resolvedUserId);
      if (dl.success && dl.blob) {
        const b64 = await encodeBlobToBase64DataUrl(dl.blob, dl.contentType || 'image/jpeg');
        if (b64) {
          setCachedBase64ForStoragePath(rawUrl, b64);
          prepared.push({ ...t, screenshotUrl: b64 });
          continue;
        }
      }
    }

    prepared.push({ ...t });
  }

  return prepared;
}

/**
 * Resolves any screenshot URL or path for display:
 * - If Base64 or external HTTP(S) URL: returns as-is immediately.
 * - If private Storage path: requests a fresh signed URL from Supabase Storage.
 * - Otherwise returns null.
 */
export async function resolveScreenshotDisplayUrl(
  urlOrPath: string | null | undefined,
  expiresIn = 3600
): Promise<string | null> {
  if (!urlOrPath) return null;
  const clean = urlOrPath.trim();
  if (
    clean.startsWith('data:image/') ||
    clean.startsWith('http://') ||
    clean.startsWith('https://')
  ) {
    return clean;
  }
  if (isStoragePath(clean)) {
    return createScreenshotSignedUrl(clean, expiresIn);
  }
  return null;
}

/**
 * Fetch user account settings from Supabase
 */
export async function fetchSettingsFromSupabase(userId: string): Promise<AppSettings | null> {
  const client = getSupabase();
  if (!client || !userId || typeof userId !== 'string' || !userId.trim()) return null;
  const cleanUserId = userId.trim();

  try {
    const { data, error } = await client
      .from('user_settings')
      .select('*')
      .eq('user_id', cleanUserId)
      .single();

    if (error || !data) return null;

    return mergeWithExistingSettings(loadStoredSettings(cleanUserId), {
      currency: data.currency,
      currencySymbol: data.currency_symbol,
      startingBalance: Number(data.starting_balance),
      xauusdContractSize: Number(data.xauusd_contract_size),
      xauusdPointValue: Number(data.xauusd_point_value),
      brokerCommissionPerLot: Number(data.broker_commission_per_lot),
      defaultRiskPercent: Number(data.default_risk_percent),
      maxDailyLossPercent: Number(data.max_daily_loss_percent),
      maxDailyLossAmount: Number(data.max_daily_loss_amount),
      maxConsecutiveLossLimit: Number(data.max_consecutive_loss_limit),
      targetMonthlyReturnPercent: Number(data.target_monthly_return_percent),
    });
  } catch (err) {
    console.error('Failed to fetch settings from Supabase:', err);
    return null;
  }
}

/**
 * Loads settings for the active user on login or account switch:
 * - For guests (userId null/empty): returns guest settings from localStorage.
 * - For authenticated users: starts from that user's isolated local settings cache
 *   (`tradevault_settings_user_<userId>`, defaulting to DEFAULT_SETTINGS so another account's
 *   settings never leak), fetches cloud settings from `user_settings`, merges them while
 *   preserving valid optional fields via `mergeWithExistingSettings`, and saves back to the
 *   user's isolated local cache.
 */
export async function loadUserSettingsWithFallback(
  userId?: string | null,
  fetchCloudFn: (uid: string) => Promise<AppSettings | null> = fetchSettingsFromSupabase
): Promise<{ settings: AppSettings; source: 'cloud' | 'local_fallback' | 'local' }> {
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    return {
      settings: loadStoredSettings(null),
      source: 'local',
    };
  }

  const cleanUserId = userId.trim();
  const localUserSettings = loadStoredSettings(cleanUserId);

  try {
    const cloudSettings = await fetchCloudFn(cleanUserId);
    if (cloudSettings) {
      const merged = mergeWithExistingSettings(localUserSettings, cloudSettings);
      saveStoredSettings(merged, cleanUserId);
      return {
        settings: merged,
        source: 'cloud',
      };
    }
  } catch {
    // fallback to isolated user local settings
  }

  return {
    settings: localUserSettings,
    source: 'local_fallback',
  };
}

/**
 * Save user account settings to Supabase
 */
export async function saveSettingsToSupabase(settings: AppSettings, userId: string): Promise<boolean> {
  const client = getSupabase();
  if (!client) return false;

  try {
    const payload = {
      user_id: userId,
      currency: settings.currency,
      currency_symbol: settings.currencySymbol,
      starting_balance: settings.startingBalance,
      xauusd_contract_size: settings.xauusdContractSize,
      xauusd_point_value: settings.xauusdPointValue,
      broker_commission_per_lot: settings.brokerCommissionPerLot,
      default_risk_percent: settings.defaultRiskPercent,
      max_daily_loss_percent: settings.maxDailyLossPercent,
      max_daily_loss_amount: settings.maxDailyLossAmount,
      max_consecutive_loss_limit: settings.maxConsecutiveLossLimit,
      target_monthly_return_percent: settings.targetMonthlyReturnPercent,
      updated_at: new Date().toISOString(),
    };

    const { error } = await client
      .from('user_settings')
      .upsert(payload, { onConflict: 'user_id' });

    return !error;
  } catch (err) {
    console.error('Failed to save settings to Supabase:', err);
    return false;
  }
}

/**
 * Batch migrate / sync local trades to Supabase with idempotent upsert and progress callback.
 * - Uploads any Base64 screenshots ('data:image/...') to Supabase Storage before upserting to public.trades.
 * - Preserves existing valid storage paths and external URLs without redundant uploads.
 * - If a screenshot upload or DB upsert fails for a trade, preserves the original trade (including its
 *   source Base64 screenshot) in syncedTrades and increments failedCount so it can be retried safely.
 */
export async function migrateLocalTradesToSupabase(
  localTrades: Trade[],
  userId: string,
  onProgress?: (completed: number, total: number) => void
): Promise<{
  success: boolean;
  count: number;
  failedCount: number;
  syncedTrades: Trade[];
  error?: string;
}> {
  const client = getSupabase();
  if (!client) {
    return {
      success: false,
      count: 0,
      failedCount: localTrades.length,
      syncedTrades: localTrades.map((t) => ({ ...t })),
      error: 'Koneksi Supabase belum aktif.',
    };
  }

  let successCount = 0;
  let failedCount = 0;
  const total = localTrades.length;
  const syncedTrades: Trade[] = [];
  let firstError = '';

  try {
    for (let i = 0; i < total; i++) {
      const trade = localTrades[i];
      const res = await upsertTradeToSupabase(trade, userId);
      if (res.success && res.data) {
        successCount++;
        // Preserve all local trade fields while adopting the synced storage paths in screenshotUrl & executionNotes
        syncedTrades.push({
          ...trade,
          screenshotUrl: res.data.screenshotUrl || undefined,
          executionNotes: res.data.executionNotes || trade.executionNotes,
        });
      } else {
        failedCount++;
        // Preserve original trade (including source Base64 screenshot) untouched so data is never lost
        syncedTrades.push({ ...trade });
        if (!firstError) {
          firstError = res.error || `Gagal menyinkronkan transaksi "${trade.id}".`;
        }
      }
      if (onProgress) {
        onProgress(i + 1, total);
      }
    }

    if (successCount === total) {
      return {
        success: true,
        count: successCount,
        failedCount: 0,
        syncedTrades,
      };
    } else {
      return {
        success: successCount > 0 && failedCount === 0,
        count: successCount,
        failedCount,
        syncedTrades,
        error:
          firstError ||
          `Berhasil menyinkronkan ${successCount} dari ${total} transaksi (${failedCount} gagal).`,
      };
    }
  } catch (err: any) {
    // If an unexpected exception occurs mid-loop, preserve remaining trades untouched
    for (let j = syncedTrades.length; j < total; j++) {
      syncedTrades.push({ ...localTrades[j] });
    }
    return {
      success: false,
      count: successCount,
      failedCount: total - successCount,
      syncedTrades,
      error: translateDatabaseError(err),
    };
  }
}

/**
 * Merges or replaces an existing trades dataset with an incoming trades dataset
 * using owner-scoped canonical UUID matching and legacy unscoped UUID bridging.
 * - In 'replace' mode: deduplicates incomingTrades by canonical key and identifies obsolete existing trades.
 * - In 'merge' mode: updates matching trades (preserving existing screenshotUrl if incoming trade has none),
 *   adds new incoming trades, and preserves all unchanged existing trades.
 */
export function mergeTradesDatasets(
  existingTrades: Trade[],
  incomingTrades: Trade[],
  mode: 'replace' | 'merge',
  ownerScope: string = 'GUEST'
): {
  finalTrades: Trade[];
  obsoleteTrades: Trade[];
  addedCount: number;
  updatedCount: number;
  keptCount: number;
} {
  const cleanScope = validateOwnerScope(ownerScope);
  const existingByLowerId = new Map<string, Trade>();
  const existingByUuid = new Map<string, Trade>();
  const existingByLegacyUuid = new Map<string, Trade>();

  for (const ex of existingTrades) {
    if (!ex || !ex.id || !String(ex.id).trim()) continue;
    const lowerId = String(ex.id).trim().toLowerCase();
    const uuid = ensureValidUuid(ex.id, cleanScope);
    const legacyUuid = computeLegacyUnscopedUuid(ex.id);
    if (!existingByLowerId.has(lowerId)) {
      existingByLowerId.set(lowerId, ex);
    }
    if (!existingByUuid.has(uuid)) {
      existingByUuid.set(uuid, ex);
    }
    if (!existingByLegacyUuid.has(legacyUuid)) {
      existingByLegacyUuid.set(legacyUuid, ex);
    }
  }

  // Deduplicate incoming trades by case-insensitive ID, scoped canonical UUID, and legacy UUID (first occurrence wins)
  const deduplicatedIncoming: Trade[] = [];
  const incomingLowerIds = new Set<string>();
  const incomingUuids = new Set<string>();
  const incomingLegacyUuids = new Set<string>();

  for (const inc of incomingTrades) {
    if (!inc || !inc.id || !String(inc.id).trim()) continue;
    const lowerId = String(inc.id).trim().toLowerCase();
    const uuid = ensureValidUuid(inc.id, cleanScope);
    const legacyUuid = computeLegacyUnscopedUuid(inc.id);
    if (
      !incomingLowerIds.has(lowerId) &&
      !incomingUuids.has(uuid) &&
      !incomingLegacyUuids.has(legacyUuid)
    ) {
      incomingLowerIds.add(lowerId);
      incomingUuids.add(uuid);
      incomingLegacyUuids.add(legacyUuid);
      deduplicatedIncoming.push({ ...inc });
    }
  }

  const isMatchedByIncoming = (ex: Trade): boolean => {
    const lowerId = String(ex.id).trim().toLowerCase();
    const uuid = ensureValidUuid(ex.id, cleanScope);
    const legacyUuid = computeLegacyUnscopedUuid(ex.id);
    return (
      incomingLowerIds.has(lowerId) ||
      incomingUuids.has(uuid) ||
      incomingLegacyUuids.has(legacyUuid)
    );
  };

  if (mode === 'replace') {
    const obsoleteTrades = existingTrades.filter(
      (ex) => ex && ex.id && String(ex.id).trim() !== '' && !isMatchedByIncoming(ex)
    );
    return {
      finalTrades: deduplicatedIncoming,
      obsoleteTrades,
      addedCount: deduplicatedIncoming.length,
      updatedCount: 0,
      keptCount: 0,
    };
  }

  // Mode: 'merge'
  let addedCount = 0;
  let updatedCount = 0;
  const mergedIncoming: Trade[] = [];

  for (const inc of deduplicatedIncoming) {
    const lowerId = String(inc.id).trim().toLowerCase();
    const uuid = ensureValidUuid(inc.id, cleanScope);
    const legacyUuid = computeLegacyUnscopedUuid(inc.id);
    const existingMatch =
      existingByLowerId.get(lowerId) ||
      existingByUuid.get(uuid) ||
      existingByLegacyUuid.get(legacyUuid);

    if (existingMatch) {
      updatedCount++;
      const incomingHasScreenshot = Boolean(
        inc.screenshotUrl && String(inc.screenshotUrl).trim() !== ''
      );
      const existingHasScreenshot = Boolean(
        existingMatch.screenshotUrl && String(existingMatch.screenshotUrl).trim() !== ''
      );
      mergedIncoming.push({
        ...inc,
        id: existingMatch.id,
        screenshotUrl: incomingHasScreenshot
          ? inc.screenshotUrl
          : existingHasScreenshot
          ? existingMatch.screenshotUrl
          : undefined,
      });
    } else {
      addedCount++;
      mergedIncoming.push({ ...inc });
    }
  }

  const unchangedExisting = existingTrades.filter(
    (ex) => ex && ex.id && String(ex.id).trim() !== '' && !isMatchedByIncoming(ex)
  );

  return {
    finalTrades: [...mergedIncoming, ...unchangedExisting],
    obsoleteTrades: [],
    addedCount,
    updatedCount,
    keptCount: unchangedExisting.length,
  };
}

/**
 * Pure helper that determines which cloud trade UUIDs owned by `userId` are obsolete
 * when reconciling against `keepTrades`.
 * Recognizes both the Phase 2.1 user-scoped UUID (`resolveCloudTradeUuid(t.id, userId)`)
 * AND the pre-Phase 2.1 legacy unscoped UUID (`computeLegacyUnscopedUuid(t.id)`), ensuring
 * legacy cloud rows are NEVER falsely deleted during a namespace transition.
 */
export function computeObsoleteCloudTradeIdsToDelete(
  keepTrades: Trade[],
  cloudTradeIdsOwnedByUser: string[],
  userId: string
): string[] {
  const validUserId = requireAuthenticatedUserId(userId);
  const keepUuids = new Set<string>();

  for (const t of keepTrades) {
    if (!t || !t.id || !String(t.id).trim()) continue;
    const cleanId = String(t.id).trim();
    keepUuids.add(resolveCloudTradeUuid(cleanId, validUserId));
    keepUuids.add(computeLegacyUnscopedUuid(cleanId));
    if (GENERIC_UUID_REGEX.test(cleanId)) {
      keepUuids.add(cleanId.toLowerCase());
    }
  }

  const obsoleteIds: string[] = [];
  const seen = new Set<string>();
  for (const rawCloudId of cloudTradeIdsOwnedByUser) {
    if (!rawCloudId) continue;
    const cleanCloudId = String(rawCloudId).trim().toLowerCase();
    if (!cleanCloudId || seen.has(cleanCloudId)) continue;
    seen.add(cleanCloudId);
    if (!keepUuids.has(cleanCloudId)) {
      obsoleteIds.push(cleanCloudId);
    }
  }

  return obsoleteIds;
}

/**
 * Deletes a specific list of trades from Supabase public.trades (and removes their private storage
 * screenshots if not in keepScreenshotPaths and not referenced elsewhere).
 * Strictly enforces Database Row Deletion FIRST, then Storage cleanup (F-27).
 */
export async function deleteTradesListFromSupabase(
  tradesToDelete: Trade[],
  userId: string,
  keepScreenshotPaths: Set<string> = new Set()
): Promise<SyncResult<{ deletedCount: number }>> {
  let validUserId: string;
  try {
    validUserId = requireAuthenticatedUserId(userId);
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'User ID tidak valid. Sesi login diperlukan untuk menghapus data dari cloud.',
    };
  }

  const client = getSupabase();
  if (!client) {
    return { success: false, error: 'Supabase client tidak tersedia.' };
  }

  let deletedCount = 0;
  const seenUuids = new Set<string>();
  const tradeUuidsToDelete: string[] = [];
  const screenshotsPendingCleanup: Array<{ tradeId: string; storagePath: string }> = [];

  for (const trade of tradesToDelete) {
    if (!trade || !trade.id || !String(trade.id).trim()) continue;
    const dbUuid = resolveCloudTradeUuid(trade.id, validUserId);
    if (seenUuids.has(dbUuid)) continue;
    seenUuids.add(dbUuid);
    tradeUuidsToDelete.push(dbUuid);

    for (const storagePath of extractAllTradeStoragePaths(trade)) {
      if (!keepScreenshotPaths.has(storagePath)) {
        screenshotsPendingCleanup.push({ tradeId: trade.id, storagePath });
      }
    }
  }

  if (tradeUuidsToDelete.length === 0) {
    return { success: true, data: { deletedCount: 0 } };
  }

  try {
    // 1. TAHAP 1: HAPUS DARI DATABASE TERLEBIH DAHULU (Strict DB-First)
    for (const trade of tradesToDelete) {
      if (!trade || !trade.id) continue;
      const dbUuid = resolveCloudTradeUuid(trade.id, validUserId);

      const { data, error } = await client
        .from('trades')
        .delete()
        .eq('id', dbUuid)
        .eq('user_id', validUserId)
        .select();

      if (error) {
        console.error(`Supabase delete error for trade "${trade.id}":`, error);
        // DB delete failed: ABORT immediately. Zero screenshots are deleted!
        return {
          success: false,
          error: translateDatabaseError(error),
        };
      }

      if (data && data.length > 0) {
        deletedCount += data.length;
      }
      unregisterKnownTradeUuid(trade.id, validUserId);
    }

    // 2. TAHAP 2: BERSIHKAN SCREENSHOT DARI STORAGE HANYA SETELAH DB ROW TERHAPUS
    for (const item of screenshotsPendingCleanup) {
      try {
        await deleteScreenshotFromSupabase(item.storagePath);
      } catch (storageErr) {
        // Non-fatal: Record as orphan candidate, but do not fail the successful trade deletion
        console.warn(
          `[Orphan Warning] Screenshot storage "${item.storagePath}" gagal dihapus setelah baris trade terhapus:`,
          storageErr
        );
      }
    }

    return { success: true, data: { deletedCount } };
  } catch (err: any) {
    console.error('Unexpected error in deleteTradesListFromSupabase:', err);
    return {
      success: false,
      error: translateDatabaseError(err),
    };
  }
}

/**
 * Deletes all obsolete cloud trades for a user whose canonical or legacy UUID is NOT in keepTrades.
 * Also removes orphaned private Storage screenshots that belonged to deleted or overwritten trades.
 * Strictly enforces DB Row Deletion FIRST (F-27).
 */
export async function deleteObsoleteTradesFromSupabase(
  keepTrades: Trade[],
  previousLocalTrades: Trade[],
  userId: string
): Promise<SyncResult<{ deletedCount: number }>> {
  let validUserId: string;
  try {
    validUserId = requireAuthenticatedUserId(userId);
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'User ID tidak valid. Sesi login diperlukan untuk menyinkronkan penghapusan cloud.',
    };
  }

  const client = getSupabase();
  if (!client) {
    return { success: false, error: 'Supabase client tidak tersedia.' };
  }

  try {
    const keepUuids = new Set<string>();
    const keepScreenshotPaths = new Set<string>();

    for (const t of keepTrades) {
      if (!t || !t.id || !String(t.id).trim()) continue;
      const cleanId = String(t.id).trim();
      keepUuids.add(resolveCloudTradeUuid(cleanId, validUserId));
      keepUuids.add(computeLegacyUnscopedUuid(cleanId));
      if (GENERIC_UUID_REGEX.test(cleanId)) {
        keepUuids.add(cleanId.toLowerCase());
      }
      for (const pathItem of extractAllTradeStoragePaths(t)) {
        keepScreenshotPaths.add(pathItem);
      }
    }

    const candidateByUuid = new Map<string, Trade>();
    for (const prev of previousLocalTrades) {
      if (!prev || !prev.id || !String(prev.id).trim()) continue;
      candidateByUuid.set(resolveCloudTradeUuid(prev.id, validUserId), prev);
    }

    const cloudRes = await fetchTradesFromSupabase(validUserId);
    if (cloudRes.success && cloudRes.data) {
      for (const cloudTrade of cloudRes.data) {
        if (!cloudTrade || !cloudTrade.id || !String(cloudTrade.id).trim()) continue;
        const uuid = resolveCloudTradeUuid(cloudTrade.id, validUserId);
        if (!candidateByUuid.has(uuid)) {
          candidateByUuid.set(uuid, cloudTrade);
        } else {
          const existing = candidateByUuid.get(uuid)!;
          if (!existing.screenshotUrl && cloudTrade.screenshotUrl) {
            candidateByUuid.set(uuid, {
              ...existing,
              screenshotUrl: cloudTrade.screenshotUrl,
            });
          }
        }
      }
    }

    const obsoleteTrades: Trade[] = [];
    for (const [uuid, trade] of candidateByUuid.entries()) {
      const legacyUuid = computeLegacyUnscopedUuid(trade.id);
      if (!keepUuids.has(uuid) && !keepUuids.has(legacyUuid)) {
        obsoleteTrades.push(trade);
      }
    }

    if (obsoleteTrades.length === 0) {
      return { success: true, data: { deletedCount: 0 } };
    }

    // Delete obsolete trades (DB first, then storage)
    const deleteResult = await deleteTradesListFromSupabase(
      obsoleteTrades,
      validUserId,
      keepScreenshotPaths
    );

    // After obsolete trades are confirmed deleted from DB, cleanup screenshots of modified trades
    if (deleteResult.success) {
      for (const [uuid, prevTrade] of candidateByUuid.entries()) {
        const legacyPrevUuid = computeLegacyUnscopedUuid(prevTrade.id);
        if (keepUuids.has(uuid) || keepUuids.has(legacyPrevUuid)) {
          for (const oldPath of extractAllTradeStoragePaths(prevTrade)) {
            if (!keepScreenshotPaths.has(oldPath)) {
              try {
                await deleteScreenshotFromSupabase(oldPath);
              } catch (err) {
                console.warn(`Peringatan: Gagal membersihkan screenshot usang "${oldPath}":`, err);
              }
            }
          }
        }
      }
    }

    return deleteResult;
  } catch (err: any) {
    console.error('Unexpected error in deleteObsoleteTradesFromSupabase:', err);
    return {
      success: false,
      error: translateDatabaseError(err),
    };
  }
}




