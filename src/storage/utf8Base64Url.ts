import { Trade } from '../types/trade';
import { AppSettings } from '../types/settings';
import { DecodedTradeNotesResult, TradeNotesMetaPayload } from './databaseTypes';

const BASE64URL_REGEX = /^[A-Za-z0-9_-]+$/;

/**
 * Encodes any UTF-8 string (including Indonesian, international scripts, emoji, and JSON delimiters)
 * into a deterministic, URL-safe Base64URL string without padding ('=').
 */
export function encodeUtf8ToBase64Url(input: string): string {
  if (typeof input !== 'string') {
    throw new Error('ERR_INVALID_UTF8_INPUT: Input must be a string.');
  }
  if (input.length === 0) {
    return '';
  }

  const encoder = new TextEncoder();
  const bytes = encoder.encode(input);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * Decodes a Base64URL string back into a UTF-8 string with strict validation.
 * Rejects malformed characters, invalid padding lengths, or invalid UTF-8 byte sequences.
 */
export function decodeBase64UrlToUtf8(b64Url: string): string {
  if (typeof b64Url !== 'string') {
    throw new Error('ERR_INVALID_BASE64URL_INPUT: Input must be a string.');
  }
  const trimmed = b64Url.trim();
  if (trimmed.length === 0) {
    return '';
  }

  if (!BASE64URL_REGEX.test(trimmed) || trimmed.length % 4 === 1) {
    throw new Error('ERR_MALFORMED_BASE64URL: Input contains invalid Base64URL characters or length.');
  }

  let base64 = trimmed.replace(/-/g, '+').replace(/_/g, '/');
  const padMod = base64.length % 4;
  if (padMod === 2) {
    base64 += '==';
  } else if (padMod === 3) {
    base64 += '=';
  }

  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new Error('ERR_MALFORMED_BASE64URL: Failed to decode Base64 payload.');
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return decoder.decode(bytes);
  } catch {
    throw new Error('ERR_INVALID_UTF8_SEQUENCE: Decoded bytes are not valid UTF-8.');
  }
}

/**
 * Encodes extended Trade metadata into a collision-proof [MetaB64: <base64url>] tag appended to notes.
 * Safely preserves characters like ']', '}', quotes, newlines, and emoji inside notes/reasons.
 */
export function encodeTradeNotesWithMetaB64(
  trade: Trade,
  extraMeta?: Partial<TradeNotesMetaPayload>
): string {
  const payload: TradeNotesMetaPayload = {};

  if (extraMeta?.localId !== undefined) {
    payload.localId = extraMeta.localId;
  } else if (trade.id) {
    payload.localId = trade.id;
  }

  if (trade.riskAmount !== undefined && Number.isFinite(trade.riskAmount)) {
    payload.riskAmount = trade.riskAmount;
  }
  if (trade.riskPercentage !== undefined && Number.isFinite(trade.riskPercentage)) {
    payload.riskPercentage = trade.riskPercentage;
  }
  if (trade.rMultiple !== undefined && trade.rMultiple !== null && Number.isFinite(trade.rMultiple)) {
    payload.rMultiple = trade.rMultiple;
  }
  if (
    trade.disciplineRating !== undefined &&
    trade.disciplineRating !== null &&
    Number.isFinite(trade.disciplineRating)
  ) {
    payload.disciplineRating = trade.disciplineRating;
  }
  if (trade.isDemo !== undefined) {
    payload.isDemo = Boolean(trade.isDemo);
  }
  if (trade.entryReason !== undefined && trade.entryReason !== '') {
    payload.entryReason = trade.entryReason;
  }
  if (trade.postTradeEvaluation !== undefined && trade.postTradeEvaluation !== '') {
    payload.postTradeEvaluation = trade.postTradeEvaluation;
  }
  if (trade.executionNotes !== undefined && trade.executionNotes !== '') {
    payload.executionNotes = trade.executionNotes;
  }
  if (trade.closeExchangeRate && typeof trade.closeExchangeRate === 'object') {
    payload.closeExchangeRate = trade.closeExchangeRate;
  }

  if (extraMeta?.wallClockDateTime) payload.wallClockDateTime = extraMeta.wallClockDateTime;
  if (extraMeta?.ianaTimezone) payload.ianaTimezone = extraMeta.ianaTimezone;
  if (extraMeta?.tzOffsetMinutes !== undefined) payload.tzOffsetMinutes = extraMeta.tzOffsetMinutes;
  if (extraMeta?.syncRevision !== undefined) payload.syncRevision = extraMeta.syncRevision;
  if (extraMeta?.lastMutationId) payload.lastMutationId = extraMeta.lastMutationId;

  // Strip any existing [MetaB64: ...], [LocalID: ...], or [Meta: ...] tags from notes to avoid duplication
  let cleanUserNotes = trade.notes ?? '';
  cleanUserNotes = cleanUserNotes
    .replace(/\s*\[MetaB64:\s*[A-Za-z0-9_-]+\]\s*$/, '')
    .replace(/^\[LocalID:\s*[^\]]+\]\s*/, '')
    .replace(/\s*\[Meta:\s*\{[^}]*\}\]\s*$/, '');

  const jsonStr = JSON.stringify(payload);
  const encodedB64 = encodeUtf8ToBase64Url(jsonStr);

  if (cleanUserNotes.length > 0) {
    return `${cleanUserNotes} [MetaB64: ${encodedB64}]`;
  }
  return `[MetaB64: ${encodedB64}]`;
}

/**
 * Decodes Trade notes supporting both:
 * 1. New UTF-8 safe [MetaB64: <base64url>] format (immune to ']' and '}' inside text).
 * 2. Legacy [LocalID: ...] and [Meta: {...}] formats for full backward compatibility.
 */
export function decodeTradeNotesWithMeta(
  rawNotes: string | null | undefined
): DecodedTradeNotesResult {
  if (rawNotes === null || rawNotes === undefined || rawNotes === '') {
    return {
      cleanNotes: undefined,
      meta: {},
      formatDetected: 'NONE',
    };
  }

  let working = String(rawNotes);
  const meta: TradeNotesMetaPayload = {};
  let extractedLocalId: string | undefined;

  // 1. Check for [MetaB64: <token>] at the end of the string
  const metaB64Match = working.match(/(?:^|\s)\[MetaB64:\s*([^\]]+)\]\s*$/);
  if (metaB64Match && metaB64Match[1]) {
    const rawToken = metaB64Match[1].trim();
    try {
      const decodedJson = decodeBase64UrlToUtf8(rawToken);
      const parsed = JSON.parse(decodedJson);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        Object.assign(meta, parsed);
        if (typeof parsed.localId === 'string' && parsed.localId.trim() !== '') {
          extractedLocalId = parsed.localId.trim();
        }
        const prefixEnd = working.lastIndexOf(metaB64Match[0]);
        const remaining = working.slice(0, prefixEnd);
        return {
          cleanNotes: remaining.length > 0 ? remaining : undefined,
          extractedLocalId,
          meta,
          formatDetected: 'METAB64',
        };
      }
    } catch {
      return {
        cleanNotes: working,
        meta: {},
        formatDetected: 'NONE',
        metaParseWarning: true,
      };
    }
  }

  // 2. Fallback: Legacy [LocalID: ...] and [Meta: {...}] format
  let detectedLegacy = false;
  let metaParseWarning = false;

  const localIdMatch = working.match(/\[LocalID:\s*([^\]]+)\]/);
  if (localIdMatch && localIdMatch[1]) {
    extractedLocalId = localIdMatch[1].trim();
    meta.localId = extractedLocalId;
    working = working.replace(/\[LocalID:\s*[^\]]+\]\s*/, '').trim();
    detectedLegacy = true;
  }

  const legacyMetaMatch = working.match(/\[Meta:\s*(\{[^\]]*\})\]/);
  if (legacyMetaMatch && legacyMetaMatch[1]) {
    try {
      const parsedLegacy = JSON.parse(legacyMetaMatch[1]);
      if (parsedLegacy && typeof parsedLegacy === 'object') {
        if (parsedLegacy.riskAmount !== undefined) meta.riskAmount = Number(parsedLegacy.riskAmount);
        if (parsedLegacy.riskPercentage !== undefined)
          meta.riskPercentage = Number(parsedLegacy.riskPercentage);
        if (parsedLegacy.rMultiple !== undefined) meta.rMultiple = Number(parsedLegacy.rMultiple);
        if (parsedLegacy.disciplineRating !== undefined)
          meta.disciplineRating = Number(parsedLegacy.disciplineRating);
        if (parsedLegacy.isDemo !== undefined) meta.isDemo = Boolean(parsedLegacy.isDemo);
        if (typeof parsedLegacy.entryReason === 'string') meta.entryReason = parsedLegacy.entryReason;
        if (typeof parsedLegacy.postTradeEvaluation === 'string')
          meta.postTradeEvaluation = parsedLegacy.postTradeEvaluation;
        if (typeof parsedLegacy.executionNotes === 'string')
          meta.executionNotes = parsedLegacy.executionNotes;
        working = working.replace(/\s*\[Meta:\s*\{[^\]]*\}\]\s*/, '').trim();
        detectedLegacy = true;
      }
    } catch {
      metaParseWarning = true;
    }
  }

  return {
    cleanNotes: working.length > 0 ? working : undefined,
    extractedLocalId,
    meta,
    formatDetected: detectedLegacy ? 'LEGACY_META' : 'NONE',
    metaParseWarning: metaParseWarning || undefined,
  };
}

/**
 * Computes a lowercase hex SHA-256 digest of a UTF-8 string or binary buffer using Web Crypto API.
 */
export async function computeSha256Hex(
  input: string | ArrayBuffer | Uint8Array
): Promise<string> {
  let bytes: Uint8Array;
  if (typeof input === 'string') {
    bytes = new TextEncoder().encode(input);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else {
    throw new Error('ERR_INVALID_HASH_INPUT: Unsupported input type for SHA-256.');
  }

  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  const hashArray = new Uint8Array(hashBuffer);
  let hex = '';
  for (let i = 0; i < hashArray.length; i++) {
    hex += hashArray[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Produces a deterministic canonical JSON string across all 28 properties of a Trade record.
 * Rejects any non-finite numeric property (NaN, Infinity, -Infinity).
 */
export function canonicalizeTradeForDigest(trade: Trade): string {
  if (!trade || typeof trade !== 'object') {
    throw new Error('ERR_INVALID_TRADE_OBJECT');
  }

  const requiredNumbers: Array<[string, unknown]> = [
    ['entryPrice', trade.entryPrice],
    ['lotSize', trade.lotSize],
    ['riskAmount', trade.riskAmount],
    ['riskPercentage', trade.riskPercentage],
    ['grossProfit', trade.grossProfit],
    ['commission', trade.commission],
    ['swap', trade.swap],
    ['netProfit', trade.netProfit],
  ];

  for (const [key, val] of requiredNumbers) {
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      throw new Error(`ERR_NON_FINITE_NUMERIC_FIELD: Required numeric field "${key}" is not finite.`);
    }
  }

  const optionalNumbers: Array<[string, unknown]> = [
    ['stopLoss', trade.stopLoss],
    ['takeProfit', trade.takeProfit],
    ['exitPrice', trade.exitPrice],
    ['rMultiple', trade.rMultiple],
    ['disciplineRating', trade.disciplineRating],
  ];

  for (const [key, val] of optionalNumbers) {
    if (val !== undefined && val !== null) {
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        throw new Error(`ERR_NON_FINITE_NUMERIC_FIELD: Optional numeric field "${key}" is not finite.`);
      }
    }
  }

  // Deterministic ordered 28-tuple covering every property in src/types/trade.ts
  const orderedEntries: Array<[string, unknown]> = [
    ['id', String(trade.id).trim()],
    ['dateTime', String(trade.dateTime).trim()],
    ['instrument', String(trade.instrument || 'XAUUSD').trim().toUpperCase()],
    ['position', trade.position === 'SELL' ? 'SELL' : 'BUY'],
    ['strategy', String(trade.strategy || 'Umum').trim()],
    ['session', trade.session !== undefined && trade.session !== null ? String(trade.session) : null],
    ['entryPrice', Number(trade.entryPrice)],
    ['stopLoss', trade.stopLoss !== undefined && trade.stopLoss !== null ? Number(trade.stopLoss) : null],
    [
      'takeProfit',
      trade.takeProfit !== undefined && trade.takeProfit !== null ? Number(trade.takeProfit) : null,
    ],
    ['exitPrice', trade.exitPrice !== undefined && trade.exitPrice !== null ? Number(trade.exitPrice) : null],
    ['lotSize', Number(trade.lotSize)],
    ['riskAmount', Number(trade.riskAmount)],
    ['riskPercentage', Number(trade.riskPercentage)],
    ['outcome', String(trade.outcome)],
    ['grossProfit', Number(trade.grossProfit)],
    ['commission', Number(trade.commission)],
    ['swap', Number(trade.swap)],
    ['netProfit', Number(trade.netProfit)],
    ['rMultiple', trade.rMultiple !== undefined && trade.rMultiple !== null ? Number(trade.rMultiple) : null],
    [
      'screenshotUrl',
      trade.screenshotUrl !== undefined && trade.screenshotUrl !== null ? String(trade.screenshotUrl) : null,
    ],
    ['notes', trade.notes !== undefined && trade.notes !== null ? String(trade.notes) : null],
    [
      'entryReason',
      trade.entryReason !== undefined && trade.entryReason !== null ? String(trade.entryReason) : null,
    ],
    [
      'postTradeEvaluation',
      trade.postTradeEvaluation !== undefined && trade.postTradeEvaluation !== null
        ? String(trade.postTradeEvaluation)
        : null,
    ],
    [
      'disciplineRating',
      trade.disciplineRating !== undefined && trade.disciplineRating !== null
        ? Number(trade.disciplineRating)
        : null,
    ],
    [
      'executionNotes',
      trade.executionNotes !== undefined && trade.executionNotes !== null
        ? String(trade.executionNotes)
        : null,
    ],
    ['isDemo', Boolean(trade.isDemo)],
    ['createdAt', trade.createdAt !== undefined && trade.createdAt !== null ? String(trade.createdAt) : null],
    ['updatedAt', trade.updatedAt !== undefined && trade.updatedAt !== null ? String(trade.updatedAt) : null],
  ];

  return JSON.stringify(orderedEntries);
}

/**
 * Computes the canonical SHA-256 hex digest of all 28 properties of a Trade object.
 */
export async function computeCanonicalTradeDigest(trade: Trade): Promise<string> {
  const canonicalJson = canonicalizeTradeForDigest(trade);
  return computeSha256Hex(canonicalJson);
}

/**
 * Produces a deterministic canonical JSON string across all 20 properties of AppSettings.
 */
export function canonicalizeSettingsForDigest(settings: AppSettings): string {
  if (!settings || typeof settings !== 'object') {
    throw new Error('ERR_INVALID_SETTINGS_OBJECT');
  }

  const numericEntries: Array<[string, unknown]> = [
    ['startingBalance', settings.startingBalance],
    ['xauusdContractSize', settings.xauusdContractSize],
    ['xauusdPointValue', settings.xauusdPointValue],
    ['xauusdTickSize', settings.xauusdTickSize ?? 0.01],
    ['xauusdTickValue', settings.xauusdTickValue ?? 1.0],
    ['xauusdMinLot', settings.xauusdMinLot ?? 0.01],
    ['xauusdLotStep', settings.xauusdLotStep ?? 0.01],
    ['defaultLeverage', settings.defaultLeverage ?? 500],
    ['brokerCommissionPerLot', settings.brokerCommissionPerLot],
    ['defaultRiskPercent', settings.defaultRiskPercent],
    ['maxTradeRiskPercent', settings.maxTradeRiskPercent ?? 2.0],
    ['maxTradeRiskAmount', settings.maxTradeRiskAmount ?? 200],
    ['maxDailyLossPercent', settings.maxDailyLossPercent],
    ['maxDailyLossAmount', settings.maxDailyLossAmount],
    ['maxConsecutiveLossLimit', settings.maxConsecutiveLossLimit],
    ['maxDrawdownLimitPercent', settings.maxDrawdownLimitPercent ?? 10.0],
    ['targetMonthlyReturnPercent', settings.targetMonthlyReturnPercent],
  ];

  for (const [key, val] of numericEntries) {
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      throw new Error(`ERR_NON_FINITE_SETTINGS_NUMBER: Field "${key}" is not finite.`);
    }
  }

  const orderedEntries: Array<[string, unknown]> = [
    ['currency', String(settings.currency).trim()],
    ['currencySymbol', String(settings.currencySymbol).trim()],
    ...numericEntries.map(([k, v]): [string, number] => [k, Number(v)]),
    ['resetTimezone', String(settings.resetTimezone ?? 'WIB (UTC+7)').trim()],
  ];

  return JSON.stringify(orderedEntries);
}

/**
 * Computes the canonical SHA-256 hex digest of all 20 properties of an AppSettings object.
 */
export async function computeCanonicalSettingsDigest(settings: AppSettings): Promise<string> {
  const canonicalJson = canonicalizeSettingsForDigest(settings);
  return computeSha256Hex(canonicalJson);
}

/**
 * Decodes a Base64 image data URL into a binary Blob, Uint8Array, MIME type, byte size, and SHA-256 digest.
 * Designed to execute outside of any IndexedDB transaction.
 */
export async function decodeBase64DataUrlToBinary(dataUrl: string): Promise<{
  bytes: Uint8Array;
  blob: Blob;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  sizeBytes: number;
  sha256Hex: string;
}> {
  if (!dataUrl || typeof dataUrl !== 'string') {
    throw new Error('ERR_INVALID_SCREENSHOT_DATA_URL: Input must be a non-empty string.');
  }

  const trimmed = dataUrl.trim();
  const match = trimmed.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) {
    throw new Error('ERR_CORRUPTED_SCREENSHOT_BASE64: Data URL header or Base64 alphabet is invalid.');
  }

  const rawMime = match[1].toLowerCase();
  const cleanB64 = match[2].replace(/\s+/g, '');
  if (!cleanB64 || cleanB64.length % 4 === 1) {
    throw new Error('ERR_CORRUPTED_SCREENSHOT_BASE64: Base64 payload is empty or truncated.');
  }

  let binary: string;
  try {
    binary = atob(cleanB64);
  } catch {
    throw new Error('ERR_CORRUPTED_SCREENSHOT_BASE64: atob failed to decode image payload.');
  }

  if (binary.length === 0) {
    throw new Error('ERR_CORRUPTED_SCREENSHOT_BASE64: Decoded binary length is 0 bytes.');
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  let mimeType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg';
  if (rawMime === 'image/png') {
    mimeType = 'image/png';
  } else if (rawMime === 'image/webp') {
    mimeType = 'image/webp';
  }

  const sha256Hex = await computeSha256Hex(bytes);
  const blob = new Blob([bytes], { type: mimeType });

  return {
    bytes,
    blob,
    mimeType,
    sizeBytes: bytes.byteLength,
    sha256Hex,
  };
}
