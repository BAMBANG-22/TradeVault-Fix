/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Client-side Context Collector, APK-Safe Transport, and Deterministic Offline Assistant
 * for TradeVault's Multi-Agent Office ("Tanya AI" / AI Desk).
 *
 * Quietly absorbs ALL offline journal records + online/cached market intelligence
 * without cluttering the UI with raw JSON tables, and provides an instant offline
 * fallback engine whenever Offline Mode or no-internet is active.
 */

import { Trade } from '../types/trade';
import { AppSettings } from '../types/settings';
import { calculatePerformance } from './calculations';
import { getTradeLifecycleStatus } from './tradeLifecycle';
import {
  getApiEndpointCandidates,
  isNewsCycleOfflineMode,
  nativeAwarePostJson,
} from './apiConfig';
import {
  loadLocalCachedCmeFedWatchSync,
  loadLocalCachedFundamentalGoldSnapshotSync,
  loadLocalCachedMacroSnapshotSync,
  loadOfflineActualsArchive,
} from './macroNewsEngine';
import { loadCachedPolymarketMacroSnapshot, fetchPolymarketMacroSentiment } from './polymarketMacroSentiment';
import { SMC_OFFLINE_SIGNALS_STORAGE_KEY } from './xauSmartHeatmap';
import { inspectMacroSyncConsistency } from './apkDiagnostics';
import { recordAppDiagnosticEvent } from './devDiagnosticsStore';
import {
  TradeVaultVelaProvider,
  getCachedLatestXauUsdQuoteSync,
} from './velaTradeVaultProvider';
import {
  executeClientSideFundamentalGoldAnalysis,
  executeClientSideMacroAnalysis,
} from './clientSideMacroAnalyzer';

export type AgentChatPersona = 'casual' | 'concise' | 'mentor';

export interface AgentChatThemeConfig {
  agentName: string;
  agentSubtitle: string;
  avatarDataUrl: string | null;
  persona: AgentChatPersona;
  bgColor: string;
  wallpaperDataUrl: string | null;
  wallpaperDim: number; // 0 to 85
  userBubbleColor: string;
  agentBubbleColor: string;
  showDivisionTrace: boolean;
}

export interface AgentChatThemePreset {
  id: string;
  label: string;
  bgColor: string;
  userBubbleColor: string;
  agentBubbleColor: string;
}

export const AGENT_CHAT_THEME_STORAGE_KEY = 'tradevault_chat_theme_v1';

export const AGENT_CHAT_THEME_PRESETS: AgentChatThemePreset[] = [
  {
    id: 'vlo-light',
    label: 'VLO Light',
    bgColor: '#F5F6F8',
    userBubbleColor: '#0F172A',
    agentBubbleColor: '#FFFFFF',
  },
  {
    id: 'vlo-dark',
    label: 'VLO Dark',
    bgColor: '#0B0E13',
    userBubbleColor: '#F2F4F7',
    agentBubbleColor: '#161B24',
  },
  {
    id: 'wa-dark',
    label: 'WA Dark',
    bgColor: '#0B141A',
    userBubbleColor: '#005C4B',
    agentBubbleColor: '#202C33',
  },
  {
    id: 'wa-light',
    label: 'WA Classic',
    bgColor: '#EFEAE2',
    userBubbleColor: '#D9FDD3',
    agentBubbleColor: '#FFFFFF',
  },
  {
    id: 'ig-dm',
    label: 'IG DM',
    bgColor: '#0A0A0A',
    userBubbleColor: '#3797F0',
    agentBubbleColor: '#262626',
  },
  {
    id: 'ig-violet',
    label: 'IG Violet',
    bgColor: '#0D0C14',
    userBubbleColor: '#7C3AED',
    agentBubbleColor: '#1E1B2E',
  },
];

export function getDefaultAgentChatTheme(isDarkTheme: boolean): AgentChatThemeConfig {
  const preset = isDarkTheme ? AGENT_CHAT_THEME_PRESETS[1] : AGENT_CHAT_THEME_PRESETS[0];
  return {
    agentName: 'VLO Head Desk',
    agentSubtitle: 'Tim Riset & Jurnal',
    avatarDataUrl: null,
    persona: 'casual',
    bgColor: preset.bgColor,
    wallpaperDataUrl: null,
    wallpaperDim: 35,
    userBubbleColor: preset.userBubbleColor,
    agentBubbleColor: preset.agentBubbleColor,
    showDivisionTrace: false,
  };
}

function isValidHexColor(val: unknown): val is string {
  return typeof val === 'string' && /^#[0-9a-fA-F]{6}$/.test(val.trim());
}

export function loadAgentChatTheme(isDarkTheme: boolean): AgentChatThemeConfig {
  const fallback = getDefaultAgentChatTheme(isDarkTheme);
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(AGENT_CHAT_THEME_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallback;
    const persona: AgentChatPersona =
      parsed.persona === 'concise' || parsed.persona === 'mentor' ? parsed.persona : 'casual';
    const rawStoredName =
      typeof parsed.agentName === 'string' && parsed.agentName.trim()
        ? parsed.agentName
            .trim()
            .replace(/\s+(?:ya+h?|yakk?|de+h+|do+ng+|ni+h+|si+h+|la+h+|a+ja+)$/i, '')
            .trim()
            .slice(0, 40)
        : '';
    const healedConfig: AgentChatThemeConfig = {
      agentName: rawStoredName || fallback.agentName,
      agentSubtitle:
        typeof parsed.agentSubtitle === 'string' && parsed.agentSubtitle.trim()
          ? parsed.agentSubtitle.trim().slice(0, 50)
          : fallback.agentSubtitle,
      avatarDataUrl:
        typeof parsed.avatarDataUrl === 'string' && parsed.avatarDataUrl.startsWith('data:image/')
          ? parsed.avatarDataUrl
          : null,
      persona,
      bgColor: isValidHexColor(parsed.bgColor) ? parsed.bgColor.trim() : fallback.bgColor,
      wallpaperDataUrl:
        typeof parsed.wallpaperDataUrl === 'string' && parsed.wallpaperDataUrl.startsWith('data:image/')
          ? parsed.wallpaperDataUrl
          : null,
      wallpaperDim:
        typeof parsed.wallpaperDim === 'number' && Number.isFinite(parsed.wallpaperDim)
          ? Math.max(0, Math.min(85, Math.round(parsed.wallpaperDim)))
          : fallback.wallpaperDim,
      userBubbleColor: isValidHexColor(parsed.userBubbleColor)
        ? parsed.userBubbleColor.trim()
        : fallback.userBubbleColor,
      agentBubbleColor: isValidHexColor(parsed.agentBubbleColor)
        ? parsed.agentBubbleColor.trim()
        : fallback.agentBubbleColor,
      showDivisionTrace: Boolean(parsed.showDivisionTrace),
    };
    // Persist healed nickname immediately so stale "Wowo yaa" never lingers in APK localStorage
    if (
      typeof parsed.agentName === 'string' &&
      rawStoredName &&
      parsed.agentName.trim() !== rawStoredName
    ) {
      try {
        window.localStorage.setItem(AGENT_CHAT_THEME_STORAGE_KEY, JSON.stringify(healedConfig));
      } catch {
        // ignore storage write failure
      }
    }
    return healedConfig;
  } catch {
    return fallback;
  }
}

export function saveAgentChatTheme(config: AgentChatThemeConfig): boolean {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return false;
  try {
    window.localStorage.setItem(AGENT_CHAT_THEME_STORAGE_KEY, JSON.stringify(config));
    return true;
  } catch {
    return false;
  }
}

export function resetAgentChatTheme(isDarkTheme: boolean): AgentChatThemeConfig {
  const defaults = getDefaultAgentChatTheme(isDarkTheme);
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      window.localStorage.removeItem(AGENT_CHAT_THEME_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
  return defaults;
}

/**
 * WCAG relative luminance contrast helper: returns crisp dark or light foreground colors
 * for any user-selected bubble or canvas hex color.
 */
export function getContrastPalette(hex: string): {
  text: string;
  muted: string;
  isLightSurface: boolean;
} {
  const clean = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.slice(1) : '0F172A';
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const isLightSurface = L > 0.42;
  return isLightSurface
    ? { text: '#0F172A', muted: 'rgba(15, 23, 42, 0.62)', isLightSurface: true }
    : { text: '#F8FAFC', muted: 'rgba(248, 250, 252, 0.68)', isLightSurface: false };
}

/**
 * Compress uploaded image file to a lightweight JPEG data URL via Canvas
 * so avatars & wallpapers stay fast and safe inside localStorage on mobile APK.
 */
export function compressImageFileToDataUrl(
  file: File,
  options: { maxDim: number; quality?: number; squareCrop?: boolean }
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('File harus berupa gambar (JPG, PNG, atau WEBP).'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Format gambar tidak valid.'));
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas tidak tersedia.'));
            return;
          }

          if (options.squareCrop) {
            const side = Math.min(img.width, img.height);
            const sx = Math.floor((img.width - side) / 2);
            const sy = Math.floor((img.height - side) / 2);
            const target = Math.min(options.maxDim, side);
            canvas.width = target;
            canvas.height = target;
            ctx.drawImage(img, sx, sy, side, side, 0, 0, target, target);
          } else {
            const scale = Math.min(1, options.maxDim / Math.max(img.width, img.height));
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          }

          const quality = options.quality ?? 0.78;
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Gagal memproses gambar.'));
        }
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

export interface AgentWorkflowStepClient {
  stepNumber: number;
  role:
    | 'BOSS_DISPATCH'
    | 'BOSS_DIRECT'
    | 'DIVISI_MAKRO'
    | 'DIVISI_JURNAL'
    | 'BOSS_AUDIT'
    | 'REVISION'
    | 'BOSS_SIGNOFF'
    | 'OFFLINE_ENGINE';
  divisionName: string;
  provider: 'gemini' | 'groq' | 'openrouter' | 'system' | 'offline';
  model: string;
  action: string;
  status: 'completed' | 'revised' | 'fallback';
  summary: string;
  latencyMs: number;
}

export interface AgentDeskActionCardClient {
  directionClarity: 'BUY' | 'SELL' | 'WAIT_MIXED' | 'INFO_ONLY';
  directionLabel: string;
  spikeWarning: string;
  riskReminder: string;
}

export interface AgentDeskMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  mode?: 'ONLINE_MULTI_AGENT' | 'OFFLINE_LOCAL';
  routeType?:
    | 'SMALL_TALK'
    | 'OUT_OF_SCOPE'
    | 'LIVE_PRICE_CHECK'
    | 'DIRECT_FOLLOWUP'
    | 'FULL_OFFICE';
  actionCard?: AgentDeskActionCardClient;
  workflowTrace?: AgentWorkflowStepClient[];
  revisionTriggered?: boolean;
  activeProviders?: string[];
  totalLatencyMs?: number;
  detectedAgentName?: string;
}

export interface AgentDeskAbsorbedSummary {
  tradesCount: number;
  closedCount: number;
  openOrPlannedCount: number;
  macroBias: string | null;
  macroMovementType: string | null;
  macroAnalyzedAt: string | null;
  fundamentalBias: string | null;
  fundamentalAnalyzedAt: string | null;
  polymarketCount: number;
  xauPrice: number | null;
  xauSource: string | null;
  memoryCount: number;
  isOfflineMode: boolean;
  isNavigatorOnline: boolean;
}

export type AgentMemoryCategory = 'preference' | 'market' | 'journal' | 'general';

export interface AgentMemoryItem {
  id: string;
  text: string;
  category: AgentMemoryCategory;
  createdAt: string;
}

export interface AgentSessionArchiveItem {
  id: string;
  endedAt: string;
  messageCount: number;
  summary: string;
}

export interface LiveXauUsdQuote {
  price: number;
  open15m: number | null;
  high15m: number | null;
  low15m: number | null;
  changePct15m: number | null;
  barTimeIso: string;
  fetchedAt: string;
  source: 'twelvedata' | 'binance' | 'cache';
}

export const AGENT_DESK_CHAT_STORAGE_KEY = 'tradevault_agent_desk_chat_v1';
export const AGENT_MEMORY_STORAGE_KEY = 'tradevault_agent_memory_v1';
export const AGENT_SESSION_DAY_KEY = 'tradevault_agent_last_session_day_v1';
export const AGENT_SESSION_ARCHIVE_KEY = 'tradevault_agent_session_archive_v1';
const LAST_XAU_QUOTE_STORAGE_KEY = 'tradevault_last_xau_quote_v1';

const MAX_AGENT_MEMORY_ITEMS = 25;
const MAX_SESSION_ARCHIVE_ITEMS = 15;
const XAU_LIVE_TTL_MS = 50_000;
const MACRO_AUTO_SYNC_MAX_AGE_MS = 25 * 60_000;
const FUNDAMENTAL_AUTO_SYNC_MAX_AGE_MS = 30 * 60_000;
const POLYMARKET_AUTO_SYNC_MAX_AGE_MS = 25 * 60_000;

let cachedLiveXauQuote: LiveXauUsdQuote | null = null;
let inFlightSyncPromise: Promise<void> | null = null;
let inFlightSyncIncludedFeeds = false;
let inFlightSyncForcedPrice = false;

// ============================================================================
// OFFLINE LONG-TERM MEMORY & SESSION ROLLOVER STORAGE
// ============================================================================

export function getTodayLocalDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function loadLastSessionDayKey(): string | null {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return null;
  try {
    const val = window.localStorage.getItem(AGENT_SESSION_DAY_KEY);
    return val && /^\d{4}-\d{2}-\d{2}$/.test(val.trim()) ? val.trim() : null;
  } catch {
    return null;
  }
}

export function saveLastSessionDayKey(dayKey = getTodayLocalDateKey()): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  try {
    window.localStorage.setItem(AGENT_SESSION_DAY_KEY, dayKey);
  } catch {
    // ignore storage errors
  }
}

export function loadAgentMemory(): AgentMemoryItem[] {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(AGENT_MEMORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    let mutated = false;
    const cleanedItems: AgentMemoryItem[] = parsed
      .filter((item: any) => item && typeof item.text === 'string' && item.text.trim().length > 0)
      .slice(0, MAX_AGENT_MEMORY_ITEMS)
      .map((item: any) => {
        let text = String(item.text).trim().slice(0, 220);
        // Auto-heal legacy v1.3.8 nickname memories containing trailing conversational particles (e.g. "Wowo yaa" -> "Wowo")
        const healedText = text.replace(
          /(nama\s+["'])([^"']+?)\s+(?:ya+h?|yakk?|de+h+|do+ng+|ni+h+|si+h+|la+h+|a+ja+)(["'])/i,
          '$1$2$3'
        );
        if (healedText !== text) {
          text = healedText;
          mutated = true;
        }
        return {
          id: String(item.id || `mem-${Math.random().toString(36).slice(2, 8)}`),
          text,
          category:
            item.category === 'preference' || item.category === 'market' || item.category === 'journal'
              ? item.category
              : 'general',
          createdAt: String(item.createdAt || new Date().toISOString()),
        };
      });
    if (mutated) {
      saveAgentMemory(cleanedItems);
    }
    return cleanedItems;
  } catch {
    return [];
  }
}

function saveAgentMemory(items: AgentMemoryItem[]): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  try {
    window.localStorage.setItem(
      AGENT_MEMORY_STORAGE_KEY,
      JSON.stringify(items.slice(0, MAX_AGENT_MEMORY_ITEMS))
    );
  } catch {
    // ignore storage errors
  }
}

export function addAgentMemoryNotes(
  notes: Array<{ text: string; category?: AgentMemoryCategory }>
): AgentMemoryItem[] {
  if (!Array.isArray(notes) || notes.length === 0) return loadAgentMemory();
  const current = loadAgentMemory();
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 70);

  let updated = [...current];
  for (const note of notes) {
    const cleanText = typeof note?.text === 'string' ? note.text.trim().slice(0, 220) : '';
    if (cleanText.length < 5) continue;
    const category: AgentMemoryCategory =
      note.category === 'preference' || note.category === 'market' || note.category === 'journal'
        ? note.category
        : 'general';

    const incomingKey = norm(cleanText);
    const isNicknameUpdate =
      category === 'preference' && /memanggil asisten dengan nama|user calls assistant/i.test(cleanText);

    updated = updated.filter((existing) => {
      if (isNicknameUpdate && /memanggil asisten dengan nama|user calls assistant/i.test(existing.text)) {
        return false;
      }
      return norm(existing.text) !== incomingKey;
    });

    updated.unshift({
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text: cleanText,
      category,
      createdAt: new Date().toISOString(),
    });
  }

  const trimmed = updated.slice(0, MAX_AGENT_MEMORY_ITEMS);
  saveAgentMemory(trimmed);
  return trimmed;
}

export function deleteAgentMemoryItem(id: string): AgentMemoryItem[] {
  const next = loadAgentMemory().filter((item) => item.id !== id);
  saveAgentMemory(next);
  return next;
}

export function clearAgentMemory(): AgentMemoryItem[] {
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      window.localStorage.removeItem(AGENT_MEMORY_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  return [];
}

export function loadAgentSessionArchive(): AgentSessionArchiveItem[] {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(AGENT_SESSION_ARCHIVE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_SESSION_ARCHIVE_ITEMS) : [];
  } catch {
    return [];
  }
}

function saveSessionArchiveEntry(summary: string, messageCount: number): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  try {
    const current = loadAgentSessionArchive();
    const next: AgentSessionArchiveItem[] = [
      {
        id: `sess-${Date.now()}`,
        endedAt: new Date().toISOString(),
        messageCount,
        summary: summary.trim().slice(0, 280),
      },
      ...current,
    ].slice(0, MAX_SESSION_ARCHIVE_ITEMS);
    window.localStorage.setItem(AGENT_SESSION_ARCHIVE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
}

// ============================================================================
// REAL-TIME XAU/USD SPOT QUOTE & ON-DEMAND AUTO-SYNC ENGINE
// ============================================================================

function persistLiveXauQuote(quote: LiveXauUsdQuote): void {
  cachedLiveXauQuote = quote;
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  try {
    window.localStorage.setItem(LAST_XAU_QUOTE_STORAGE_KEY, JSON.stringify(quote));
  } catch {
    // ignore quota errors
  }
}

export function getLatestKnownXauUsdQuote(): LiveXauUsdQuote | null {
  if (cachedLiveXauQuote) return cachedLiveXauQuote;

  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(LAST_XAU_QUOTE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.price === 'number' && Number.isFinite(parsed.price)) {
          cachedLiveXauQuote = parsed as LiveXauUsdQuote;
          return cachedLiveXauQuote;
        }
      }
    } catch {
      // ignore
    }
  }

  const syncBar = getCachedLatestXauUsdQuoteSync();
  if (syncBar) {
    const changePct15m =
      syncBar.open > 0 ? Number((((syncBar.price - syncBar.open) / syncBar.open) * 100).toFixed(3)) : null;
    return {
      price: syncBar.price,
      open15m: syncBar.open,
      high15m: syncBar.high,
      low15m: syncBar.low,
      changePct15m,
      barTimeIso: new Date(syncBar.barTimeMs).toISOString(),
      fetchedAt: new Date(syncBar.barTimeMs).toISOString(),
      source: 'cache',
    };
  }
  return null;
}

export async function fetchLiveXauUsdQuote(forceRefresh = false): Promise<LiveXauUsdQuote | null> {
  const isOfflineMode = isNewsCycleOfflineMode();
  const isNavigatorOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
  const existing = getLatestKnownXauUsdQuote();

  if (isOfflineMode || !isNavigatorOnline) {
    return existing;
  }

  if (
    !forceRefresh &&
    cachedLiveXauQuote &&
    cachedLiveXauQuote.source !== 'cache' &&
    Date.now() - new Date(cachedLiveXauQuote.fetchedAt).getTime() < XAU_LIVE_TTL_MS
  ) {
    return cachedLiveXauQuote;
  }

  try {
    let detectedSource: 'twelvedata' | 'binance' | 'cache' = 'twelvedata';
    const provider = new TradeVaultVelaProvider({
      preferredFeed: 'twelvedata',
      onStatus: (st) => {
        if (st.source === 'twelvedata' || st.source === 'binance' || st.source === 'cache') {
          detectedSource = st.source;
        }
      },
    });
    const bars = await provider.getBars('XAUUSD', '15', { limit: 12 });
    if (bars.length > 0) {
      const last = bars[bars.length - 1];
      const changePct15m =
        last.open > 0 ? Number((((last.close - last.open) / last.open) * 100).toFixed(3)) : null;
      const quote: LiveXauUsdQuote = {
        price: Number(last.close.toFixed(2)),
        open15m: Number(last.open.toFixed(2)),
        high15m: Number(last.high.toFixed(2)),
        low15m: Number(last.low.toFixed(2)),
        changePct15m,
        barTimeIso: new Date(last.time).toISOString(),
        fetchedAt: new Date().toISOString(),
        source: detectedSource,
      };
      persistLiveXauQuote(quote);
      return quote;
    }
  } catch {
    // fall through to cached quote
  }

  return getLatestKnownXauUsdQuote();
}

function isTimestampStale(isoString: string | undefined | null, maxAgeMs: number): boolean {
  if (!isoString) return true;
  const ts = new Date(isoString).getTime();
  if (!Number.isFinite(ts) || ts <= 0) return true;
  return Date.now() - ts > maxAgeMs;
}

export async function syncAgentDeskLiveContext(options?: {
  forcePrice?: boolean;
  syncMarketFeeds?: boolean;
  language?: 'id' | 'en';
  onStatus?: (text: string | null) => void;
}): Promise<void> {
  const isOfflineMode = isNewsCycleOfflineMode();
  const isNavigatorOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
  if (isOfflineMode || !isNavigatorOnline) return;

  if (inFlightSyncPromise) {
    const coversFeeds = !options?.syncMarketFeeds || inFlightSyncIncludedFeeds;
    const coversForcePrice = !options?.forcePrice || inFlightSyncForcedPrice;
    await inFlightSyncPromise;
    if (coversFeeds && coversForcePrice) {
      return;
    }
    // In-flight sync was a lighter background check (e.g. price-only on tab open); continue to sync needed feeds!
  }

  const isEn = options?.language === 'en';
  const existingQuote = getLatestKnownXauUsdQuote();
  const needXau =
    Boolean(options?.forcePrice) ||
    !existingQuote ||
    existingQuote.source === 'cache' ||
    isTimestampStale(existingQuote.fetchedAt, XAU_LIVE_TTL_MS);

  const macro = loadLocalCachedMacroSnapshotSync();
  const fundamental = loadLocalCachedFundamentalGoldSnapshotSync();
  const polymarket = loadCachedPolymarketMacroSnapshot();

  const needMacro =
    Boolean(options?.syncMarketFeeds) &&
    (!macro || isTimestampStale(macro.analyzedAt, MACRO_AUTO_SYNC_MAX_AGE_MS));
  const needFundamental =
    Boolean(options?.syncMarketFeeds) &&
    (!fundamental || isTimestampStale(fundamental.analyzedAt, FUNDAMENTAL_AUTO_SYNC_MAX_AGE_MS));
  const needPolymarket =
    Boolean(options?.syncMarketFeeds) &&
    (!polymarket || !polymarket.events?.length || isTimestampStale(polymarket.fetchedAt, POLYMARKET_AUTO_SYNC_MAX_AGE_MS));

  if (!needXau && !needMacro && !needFundamental && !needPolymarket) {
    return;
  }

  inFlightSyncIncludedFeeds = Boolean(options?.syncMarketFeeds);
  inFlightSyncForcedPrice = Boolean(options?.forcePrice);
  inFlightSyncPromise = (async () => {
    try {
      options?.onStatus?.(
        isEn ? 'syncing live market...' : 'menyinkronkan data live...'
      );
      const tasks: Array<Promise<unknown>> = [];
      if (needXau) {
        tasks.push(fetchLiveXauUsdQuote(Boolean(options?.forcePrice)));
      }
      if (needMacro) {
        tasks.push(executeClientSideMacroAnalysis(undefined, true));
      }
      if (needFundamental) {
        tasks.push(executeClientSideFundamentalGoldAnalysis({ forceRefresh: false }));
      }
      if (needPolymarket) {
        tasks.push(fetchPolymarketMacroSentiment({ forceRefresh: true }));
      }
      const syncCap = new Promise<void>((resolve) => setTimeout(resolve, 8_000));
      await Promise.race([Promise.allSettled(tasks), syncCap]);
    } finally {
      options?.onStatus?.(null);
      inFlightSyncPromise = null;
      inFlightSyncIncludedFeeds = false;
      inFlightSyncForcedPrice = false;
    }
  })();

  await inFlightSyncPromise;
}

function readLatestSmcSignalCompact(): Record<string, unknown> | null {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SMC_OFFLINE_SIGNALS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const valid = parsed.filter(
      (item: any) => item && typeof item === 'object' && (item.direction === 'BUY' || item.direction === 'SELL')
    );
    if (valid.length === 0) return null;
    valid.sort((a: any, b: any) => {
      const ta = new Date(a.createdAt || a.timestamp || 0).getTime() || 0;
      const tb = new Date(b.createdAt || b.timestamp || 0).getTime() || 0;
      return tb - ta;
    });
    const latest = valid[0];
    return {
      direction: latest.direction,
      status: latest.status || 'RECORDED',
      setupLabel: latest.setupLabel || latest.setup || null,
      entryPrice: latest.entryPrice ?? null,
      stopLoss: latest.stopLoss ?? null,
      takeProfit: latest.takeProfit ?? null,
      rrRatio: latest.rrRatio ?? null,
      createdAt: latest.createdAt || latest.timestamp || null,
    };
  } catch {
    return null;
  }
}

export function buildAgentDeskContext(
  trades: Trade[],
  settings: AppSettings,
  language: 'id' | 'en'
): {
  context: Record<string, unknown>;
  absorbedSummary: AgentDeskAbsorbedSummary;
} {
  const isOfflineMode = isNewsCycleOfflineMode();
  const isNavigatorOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;

  // 1. Offline Journal & Risk Context
  const { metrics } = calculatePerformance(trades, settings);
  const sortedTrades = [...trades].sort(
    (a, b) => new Date(b.dateTime || 0).getTime() - new Date(a.dateTime || 0).getTime()
  );

  const openOrPlannedTrades = sortedTrades
    .filter((t) => {
      const st = getTradeLifecycleStatus(t);
      return st === 'OPEN' || st === 'PLANNED';
    })
    .slice(0, 8)
    .map((t) => ({
      lifecycle: getTradeLifecycleStatus(t),
      instrument: t.instrument,
      position: t.position,
      lotSize: t.lotSize,
      entryPrice: t.entryPrice,
      stopLoss: t.stopLoss ?? null,
      takeProfit: t.takeProfit ?? null,
      riskPercentage: t.riskPercentage,
      strategy: t.strategy,
      dateTime: t.dateTime,
    }));

  const closedTrades = sortedTrades.filter((t) => getTradeLifecycleStatus(t) === 'CLOSED');
  const recentClosed = closedTrades.slice(0, 12).map((t) => ({
    dateTime: t.dateTime,
    instrument: t.instrument,
    position: t.position,
    session: t.session || 'Other',
    strategy: t.strategy,
    lotSize: t.lotSize,
    outcome: t.outcome,
    netProfit: Number((t.netProfit || 0).toFixed(2)),
    rMultiple: typeof t.rMultiple === 'number' ? Number(t.rMultiple.toFixed(2)) : null,
    emotionTag: t.emotionTag || null,
    mistakeTags: Array.isArray(t.mistakeTags) ? t.mistakeTags.slice(0, 3) : [],
    ruleCompliant: typeof t.ruleCompliant === 'boolean' ? t.ruleCompliant : null,
  }));

  // Aggregate mistakes, emotions, and sessions compactly
  const mistakeCounts: Record<string, { count: number; netImpact: number }> = {};
  const sessionStats: Record<string, { count: number; wins: number; netProfit: number }> = {};
  for (const t of closedTrades) {
    const sess = t.session || 'Other';
    if (!sessionStats[sess]) sessionStats[sess] = { count: 0, wins: 0, netProfit: 0 };
    sessionStats[sess].count += 1;
    if (t.outcome === 'WIN') sessionStats[sess].wins += 1;
    sessionStats[sess].netProfit += t.netProfit || 0;

    if (Array.isArray(t.mistakeTags)) {
      for (const m of t.mistakeTags) {
        if (!mistakeCounts[m]) mistakeCounts[m] = { count: 0, netImpact: 0 };
        mistakeCounts[m].count += 1;
        mistakeCounts[m].netImpact += t.netProfit || 0;
      }
    }
  }

  const topMistakes = Object.entries(mistakeCounts)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([tag, st]) => ({
      tag,
      count: st.count,
      netImpact: Number(st.netImpact.toFixed(2)),
    }));

  const sessionBreakdown = Object.entries(sessionStats).map(([session, st]) => ({
    session,
    trades: st.count,
    winRatePct: st.count > 0 ? Number(((st.wins / st.count) * 100).toFixed(1)) : 0,
    netProfit: Number(st.netProfit.toFixed(2)),
  }));

  // 2. Online / Cached Market Intelligence (Macro News, Fundamental Gold, FedWatch, Polymarket, SMC)
  const macro = loadLocalCachedMacroSnapshotSync();
  const fundamental = loadLocalCachedFundamentalGoldSnapshotSync();
  const fedWatch = loadLocalCachedCmeFedWatchSync() || macro?.cmeFedWatch || null;
  const polymarket = loadCachedPolymarketMacroSnapshot();
  const recentActuals = loadOfflineActualsArchive().slice(0, 6);
  const smcSignal = readLatestSmcSignalCompact();
  const syncAudit = inspectMacroSyncConsistency();

  const macroCompact = macro
    ? {
        analyzedAt: macro.analyzedAt,
        sourceMode: macro.sourceMode,
        impactLevel: macro.impactLevel,
        dominantBias: macro.dominantBias,
        buyProbability: macro.scenarioMatrix?.buyProbability ?? null,
        sellProbability: macro.scenarioMatrix?.sellProbability ?? null,
        mixedProbability: macro.scenarioMatrix?.mixedProbability ?? null,
        primaryEvent: macro.scenarioMatrix?.primaryEvent
          ? {
              title: macro.scenarioMatrix.primaryEvent.title,
              date: macro.scenarioMatrix.primaryEvent.date,
              impact: macro.scenarioMatrix.primaryEvent.impact,
              forecast: macro.scenarioMatrix.primaryEvent.forecast,
              previous: macro.scenarioMatrix.primaryEvent.previous,
              actual: macro.scenarioMatrix.primaryEvent.actual,
              eventBiasForGold: macro.scenarioMatrix.primaryEvent.eventBiasForGold,
            }
          : null,
        institutionalDeskThesis:
          language === 'en'
            ? macro.scenarioMatrix?.institutionalDeskThesisEn || macro.scenarioMatrix?.finalTakeEn
            : macro.scenarioMatrix?.institutionalDeskThesisId || macro.scenarioMatrix?.finalTakeId,
        actionPlan:
          language === 'en'
            ? macro.scenarioMatrix?.actionPlanEn
            : macro.scenarioMatrix?.actionPlanId,
        whipsawWarning:
          language === 'en'
            ? macro.scenarioMatrix?.whipsawWarningEn
            : macro.scenarioMatrix?.whipsawWarningId,
        dynamicPivotTriggered: Boolean(macro.scenarioMatrix?.dynamicPivotTriggered),
        dynamicPivotReason:
          language === 'en'
            ? macro.scenarioMatrix?.dynamicPivotReasonEn || null
            : macro.scenarioMatrix?.dynamicPivotReasonId || null,
        dualHorizon: macro.scenarioMatrix?.dualHorizon
          ? {
              movementType: macro.scenarioMatrix.dualHorizon.movementType,
              movementBadge:
                language === 'en'
                  ? macro.scenarioMatrix.dualHorizon.movementBadgeEn
                  : macro.scenarioMatrix.dualHorizon.movementBadgeId,
              initialCatalystBias: macro.scenarioMatrix.dualHorizon.initialCatalystBias,
              initialCatalystLabel:
                language === 'en'
                  ? macro.scenarioMatrix.dualHorizon.initialCatalystLabelEn
                  : macro.scenarioMatrix.dualHorizon.initialCatalystLabelId,
              sessionPrimaryBias: macro.scenarioMatrix.dualHorizon.sessionPrimaryBias,
              sessionPrimaryProbability: macro.scenarioMatrix.dualHorizon.sessionPrimaryProbability,
              hasSpeechEvent: macro.scenarioMatrix.dualHorizon.hasSpeechEvent,
              speechEventsNearby: macro.scenarioMatrix.dualHorizon.speechEventsNearby,
              isPricedIn: macro.scenarioMatrix.dualHorizon.isPricedIn,
              phase1Minute0to5:
                language === 'en'
                  ? macro.scenarioMatrix.dualHorizon.phase1Minute0to5En
                  : macro.scenarioMatrix.dualHorizon.phase1Minute0to5Id,
              phase2Minute15Plus:
                language === 'en'
                  ? macro.scenarioMatrix.dualHorizon.phase2Minute15PlusEn
                  : macro.scenarioMatrix.dualHorizon.phase2Minute15PlusId,
              spikeTriggerReasons:
                language === 'en'
                  ? macro.scenarioMatrix.dualHorizon.spikeTriggerReasonsEn || []
                  : macro.scenarioMatrix.dualHorizon.spikeTriggerReasonsId || [],
            }
          : null,
        threeSystemEffectiveBias: macro.threeSystemState?.effectiveFundamentalBias || null,
        threeSystemActiveSource: macro.threeSystemState?.effectiveSourceSystem || null,
        intermarketPulse: {
          dxy: macro.intermarketPulse?.dxy
            ? {
                price: macro.intermarketPulse.dxy.price,
                changePct: macro.intermarketPulse.dxy.changePercent,
                effect: macro.intermarketPulse.dxy.goldCorrelationEffect,
              }
            : null,
          us02y: macro.intermarketPulse?.us02y
            ? {
                price: macro.intermarketPulse.us02y.price,
                changePct: macro.intermarketPulse.us02y.changePercent,
                effect: macro.intermarketPulse.us02y.goldCorrelationEffect,
              }
            : null,
          us10y: macro.intermarketPulse?.us10y
            ? {
                price: macro.intermarketPulse.us10y.price,
                changePct: macro.intermarketPulse.us10y.changePercent,
                effect: macro.intermarketPulse.us10y.goldCorrelationEffect,
              }
            : null,
          usoil: macro.intermarketPulse?.usoil
            ? {
                price: macro.intermarketPulse.usoil.price,
                changePct: macro.intermarketPulse.usoil.changePercent,
                effect: macro.intermarketPulse.usoil.goldCorrelationEffect,
              }
            : null,
        },
        topHeadlines: (macro.breakingNews || []).slice(0, 4).map((h) => ({
          title: h.title,
          sentiment: h.sentimentForGold,
          channel: h.channelType,
          source: h.source,
        })),
        recentArchivedActuals: recentActuals.map((a) => ({
          title: a.title,
          actual: a.actual,
          forecast: a.forecast,
          previous: a.previous,
          date: a.date,
        })),
      }
    : null;

  const fundamentalCompact = fundamental
    ? {
        analyzedAt: fundamental.analyzedAt,
        sourceMode: fundamental.sourceMode,
        overallBias: fundamental.overallBias,
        bullishProbability: fundamental.bullishProbability,
        bearishProbability: fundamental.bearishProbability,
        regime: language === 'en' ? fundamental.regimeLabelEn : fundamental.regimeLabelId,
        horizons: {
          daily1D: fundamental.horizons?.daily1D
            ? {
                bias: fundamental.horizons.daily1D.bias,
                bullishPct: fundamental.horizons.daily1D.bullishProbability,
                bearishPct: fundamental.horizons.daily1D.bearishProbability,
                headline:
                  language === 'en'
                    ? fundamental.horizons.daily1D.headlineEn
                    : fundamental.horizons.daily1D.headlineId,
              }
            : null,
          weekly1W: fundamental.horizons?.weekly1W
            ? {
                bias: fundamental.horizons.weekly1W.bias,
                bullishPct: fundamental.horizons.weekly1W.bullishProbability,
                bearishPct: fundamental.horizons.weekly1W.bearishProbability,
              }
            : null,
          monthly1M: fundamental.horizons?.monthly1M
            ? {
                bias: fundamental.horizons.monthly1M.bias,
                bullishPct: fundamental.horizons.monthly1M.bullishProbability,
                bearishPct: fundamental.horizons.monthly1M.bearishProbability,
              }
            : null,
        },
        tacticalOverlayStatus: fundamental.tacticalOverlay?.status || 'NORMAL',
        tacticalOverlayHeadline:
          language === 'en'
            ? fundamental.tacticalOverlay?.headlineEn || null
            : fundamental.tacticalOverlay?.headlineId || null,
        headlineSummary:
          language === 'en'
            ? fundamental.narrative?.en?.headlineSummary || ''
            : fundamental.narrative?.id?.headlineSummary || '',
        horizonOutlookAndRisks:
          language === 'en'
            ? fundamental.narrative?.en?.sectionD_HorizonOutlookAndRisks || ''
            : fundamental.narrative?.id?.sectionD_HorizonOutlookAndRisks || '',
      }
    : null;

  const polymarketCompact = polymarket?.events?.length
    ? {
        fetchedAt: polymarket.fetchedAt,
        source: polymarket.source,
        topEvents: polymarket.events.slice(0, 6).map((e) => ({
          category: e.category,
          title: e.title,
          topOutcome: e.outcomes?.[0]
            ? `${e.outcomes[0].label} (${e.outcomes[0].probabilityPct}%)`
            : null,
        })),
      }
    : null;

  const xauQuote = getLatestKnownXauUsdQuote();
  const savedMemories = loadAgentMemory();

  const liveMarketQuote = {
    xauusd: xauQuote
      ? {
          price: xauQuote.price,
          open15m: xauQuote.open15m,
          high15m: xauQuote.high15m,
          low15m: xauQuote.low15m,
          changePct15m: xauQuote.changePct15m,
          barTimeIso: xauQuote.barTimeIso,
          fetchedAt: xauQuote.fetchedAt,
          source: xauQuote.source,
        }
      : null,
    intermarket:
      macroCompact?.intermarketPulse ||
      (fundamental?.evidenceSummary?.dxyPrice
        ? {
            dxy: {
              price: fundamental.evidenceSummary.dxyPrice,
              changePct: fundamental.evidenceSummary.dxyChangePct ?? null,
            },
          }
        : null),
  };

  const context: Record<string, unknown> = {
    runtime: {
      capturedAt: new Date().toISOString(),
      isOfflineMode,
      isNavigatorOnline,
      currency: settings.currency,
      currencySymbol: settings.currencySymbol,
    },
    liveMarketQuote,
    memoryNotes: savedMemories.slice(0, 20).map((m) => ({
      category: m.category,
      text: m.text,
    })),
    journal: {
      summary: {
        totalRecords: trades.length,
        closedTradesCount: metrics.totalTrades,
        openOrPlannedCount: openOrPlannedTrades.length,
        winRatePct: Number(metrics.winRate.toFixed(1)),
        profitFactor: metrics.isProfitFactorInfinite
          ? 'INF'
          : Number(metrics.profitFactor.toFixed(2)),
        totalNetProfit: Number(metrics.totalNetProfit.toFixed(2)),
        currentEquity: Number(metrics.currentEquity.toFixed(2)),
        startingBalance: Number(metrics.startingBalance.toFixed(2)),
        totalGainPercent: Number(metrics.totalGainPercent.toFixed(2)),
        averageRiskReward: Number(metrics.averageRiskReward.toFixed(2)),
        maxDrawdownPercent: Number(metrics.maxDrawdownPercent.toFixed(2)),
        currentStreak: metrics.currentStreak,
        dailyLossToday: Number(metrics.dailyLossToday.toFixed(2)),
        isDailyLossExceeded: metrics.isDailyLossExceeded,
        isAccountInCriticalDrawdown: metrics.isAccountInCriticalDrawdown,
      },
      riskGuardrails: {
        defaultRiskPercent: settings.defaultRiskPercent,
        maxTradeRiskPercent: settings.maxTradeRiskPercent ?? 2,
        maxDailyLossPercent: settings.maxDailyLossPercent,
        maxDailyLossAmount: settings.maxDailyLossAmount,
        maxConsecutiveLossLimit: settings.maxConsecutiveLossLimit,
        maxDrawdownLimitPercent: settings.maxDrawdownLimitPercent ?? 10,
      },
      openOrPlannedTrades,
      recentClosedTrades: recentClosed,
      sessionBreakdown,
      topMistakes,
    },
    macroNews: macroCompact,
    fundamentalGold: fundamentalCompact,
    cmeFedWatch: fedWatch
      ? {
          dominantOutcome: fedWatch.dominantOutcome,
          fomcMeetingDate: fedWatch.fomcMeetingDate,
          cutPct: fedWatch.cutProbability,
          holdPct: fedWatch.holdProbability,
          hikePct: fedWatch.hikeProbability,
          isPricedInSaturated: fedWatch.isPricedInSaturated,
          summary: language === 'en' ? fedWatch.summaryNoteEn : fedWatch.summaryNoteId,
        }
      : null,
    polymarket: polymarketCompact,
    smcSignal,
    syncStatus: {
      status: syncAudit.status,
      note: language === 'en' ? syncAudit.noteEn : syncAudit.noteId,
    },
  };

  return {
    context,
    absorbedSummary: {
      tradesCount: trades.length,
      closedCount: metrics.totalTrades,
      openOrPlannedCount: openOrPlannedTrades.length,
      macroBias: macro?.dominantBias || null,
      macroMovementType: macro?.scenarioMatrix?.dualHorizon?.movementType || null,
      macroAnalyzedAt: macro?.analyzedAt || null,
      fundamentalBias: fundamental?.overallBias || null,
      fundamentalAnalyzedAt: fundamental?.analyzedAt || null,
      polymarketCount: polymarket?.events?.length || 0,
      xauPrice: xauQuote?.price ?? null,
      xauSource: xauQuote?.source ?? null,
      memoryCount: savedMemories.length,
      isOfflineMode,
      isNavigatorOnline,
    },
  };
}

function cleanClientExtractedName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  let cleaned = raw
    .replace(/["'`~!?.,()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return undefined;

  cleaned = cleaned
    .replace(
      /\b(ya+h?|yakk?|de+h+|do+ng+|a+ja+|sa+ja+|ni+h+|si+h+|la+h+|ka+n|ko+k|yu+k+|o+ke+y?h?|si+p+|bo+s+|bro+|ga+n|ka+k|bang|min|pls|please|biar|supaya|karena|soal|soalnya|gitu)\b.*$/i,
      ''
    )
    .trim();

  const words = cleaned.split(/\s+/).filter(Boolean).slice(0, 2);
  cleaned = words.join(' ').trim();
  if (cleaned.length < 2 || cleaned.length > 24) return undefined;
  if (/^(kamu|lu|lo|anda|aku|saya|gue|gw|nama|panggil|ai|bot|null|none|undefined)$/i.test(cleaned)) {
    return undefined;
  }
  return cleaned
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function extractClientNicknameRename(message: string): string | undefined {
  const m = message.match(
    /(?:panggil(?:\s+kamu|\s+lu|\s+lo|\s+anda)?(?:\s+dengan)?|namamu(?:\s+sekarang)?|mulai\s+sekarang\s+(?:kamu\s+)?(?:saya\s+|aku\s+)?panggil(?:\s+kamu)?|call\s+you|your\s+name\s+is)\s+["']?([A-Za-z][A-Za-z0-9._\- ]{1,30})["']?/i
  );
  if (!m || !m[1]) return undefined;
  return cleanClientExtractedName(m[1]);
}

function classifyClientSyncNeed(message: string): {
  intentKind: 'SMALL_TALK' | 'OUT_OF_SCOPE' | 'LIVE_PRICE_CHECK' | 'MARKET_OR_JOURNAL';
  needsPrice: boolean;
  needsMarket: boolean;
} {
  const q = message.trim().toLowerCase();
  const tradingKeywords =
    /\b(xau|xauusd|gold|emas|dxy|yield|us10y|us02y|usoil|oil|forex|pair|market|pasar|chart|candle|harga|price|spot|news|berita|makro|macro|fundamental|fomc|fed|fedwatch|cpi|ppi|nfp|pmi|powell|polymarket|cycle|confluence|smc|heatmap|spike|sweep|whipsaw|buy|sell|long|short|entry|exit|sl|tp|stoploss|takeprofit|jurnal|journal|trade|trading|posisi|open|planned|lot|risiko|risk|drawdown|dd|win\s?rate|profit|loss|rugi|equity|saldo|balance|akun|playbook|guardrail|psikologi|emosi|fomo|sesi|session|london|new york|asia|evaluasi|audit|rekap)\b/i;
  const hasTradingTopic = tradingKeywords.test(q);

  const hasPriceCue =
    /\b(harga|price|spot|level|berapa|brp|skrg|sekarang|saat ini|di angka|dimana|di mana|running|update harga|cek harga)\b/i.test(
      q
    );
  const hasAssetCue = /\b(xau|xauusd|gold|emas|dxy|us10y|us02y|usoil|oil|btc|eurusd)\b/i.test(q);
  const asksDeepAnalysis =
    /\b(kenapa|mengapa|analisis|analisa|fundamental|berita|news|jurnal|journal|spike|sweep|prediksi|arah|kemana|ke mana|buy|sell|entry|posisi|risiko|risk|drawdown|win\s?rate|fomc|cpi|nfp|evaluasi|audit|bagusnya|ambil)\b/i.test(
      q
    );

  if (hasPriceCue && hasAssetCue && !asksDeepAnalysis) {
    return { intentKind: 'LIVE_PRICE_CHECK', needsPrice: true, needsMarket: false };
  }

  const outOfScopeTopics =
    /\b(cuaca|hujan|panas|mendung|suhu|bmkg|resep|masak|makanan|minuman|resto|nasi goreng|bola|skor|pertandingan|liga|timnas|film|anime|drakor|lagu|musik|artis|gosip|jodoh|pacar|zodiak|ramalan|tebak|pantun|puisi|game|mobile legends|pubg|ff|obat|sakit|dokter)\b/i;
  if (!hasTradingTopic && outOfScopeTopics.test(q)) {
    return { intentKind: 'OUT_OF_SCOPE', needsPrice: false, needsMarket: false };
  }

  const smallTalkPatterns =
    /^(halo|hai|hi|hello|hey|selamat pagi|selamat siang|selamat sore|selamat malam|pagi|siang|sore|malam|assalamualaikum|permisi|tes|test|testing|apa kabar|gm|gn|oke|ok|siap|makasih|terima kasih|thanks|thank you|sip|mantap|keren|good|nice|paham|noted|oh gitu|ohh|hmm|haha|wkwk|bro|bos)\b/i;
  const renamePattern =
    /\b(panggil\s+(?:kamu|lu|lo|anda)|namamu|mulai\s+sekarang.*panggil|ganti\s+nama|call\s+you|name\s+is)\b/i;

  if (
    !hasTradingTopic &&
    (renamePattern.test(q) ||
      smallTalkPatterns.test(q) ||
      q.length <= 45 ||
      (q.length <= 65 &&
        /\b(siapa kamu|siapa lu|lu siapa|kamu siapa|perkenalkan|kenalan|lagi apa|lg apa|bisa apa|tugasmu)\b/i.test(
          q
        )))
  ) {
    return { intentKind: 'SMALL_TALK', needsPrice: false, needsMarket: false };
  }

  const asksMacroOrMarket =
    /\b(xau|xauusd|gold|emas|market|pasar|news|berita|makro|macro|fundamental|fomc|fed|fedwatch|cpi|ppi|nfp|pmi|dxy|yield|oil|polymarket|cycle|confluence|spike|sweep|arah|buy|sell|hari ini|sekarang)\b/i.test(
      q
    );

  return {
    intentKind: 'MARKET_OR_JOURNAL',
    needsPrice: asksMacroOrMarket,
    needsMarket: asksMacroOrMarket,
  };
}

function formatReadableQuoteTime(iso: string | undefined | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return '';
  }
}

function formatPriceSourceLabel(source: string | undefined): string {
  if (source === 'twelvedata') return 'TwelveData';
  if (source === 'binance') return 'Binance';
  return 'data terakhir perangkat';
}

/**
 * Natural Human-Tone Local Fallback Engine when Offline Mode is enabled or cloud AI is slow/unreachable.
 * Respects persona (casual / concise / mentor), Small Talk, Out-of-Scope, Live Price lookup,
 * and plain-language Market/Journal summaries — zero raw IT errors or jargon walls.
 */
export function buildOfflineAgentDeskReply(params: {
  message: string;
  trades: Trade[];
  settings: AppSettings;
  language: 'id' | 'en';
  agentName?: string;
  persona?: AgentChatPersona;
  isCloudFallback?: boolean;
}): Omit<AgentDeskMessage, 'id' | 'role' | 'createdAt'> {
  const startedAt = Date.now();
  const isEn = params.language === 'en';
  const persona: AgentChatPersona = params.persona || 'casual';
  const detectedRename = extractClientNicknameRename(params.message);
  const effectiveName = detectedRename || params.agentName || 'Head Desk';
  const syncNeed = classifyClientSyncNeed(params.message);

  // Path 1: Small talk offline (ZERO market dump!)
  if (syncNeed.intentKind === 'SMALL_TALK') {
    if (detectedRename) {
      addAgentMemoryNotes([
        {
          text: `User memanggil asisten dengan nama "${detectedRename}".`,
          category: 'preference',
        },
      ]);
    }
    const content = detectedRename
      ? isEn
        ? `Got it — call me ${detectedRename} from now on. Whenever you want to check XAU/USD or your journal, just ping me.`
        : persona === 'concise'
        ? `Oke, panggil saja ${detectedRename}. Ada yang mau dicek dari market atau jurnal?`
        : `Sip, mulai sekarang panggil aku ${detectedRename} aja ya! Kalau nanti mau cek harga emas, berita makro, atau catatan jurnal, tinggal ngobrol aja.`
      : isEn
      ? `Hey! ${effectiveName} here. What would you like to check on XAU/USD or your TradeVault journal today?`
      : persona === 'concise'
      ? `Halo, ${effectiveName} di sini. Mau cek harga XAU/USD, berita, atau jurnal?`
      : `Halo! ${effectiveName} di sini. Santai aja, kalau lagi mau cek pergerakan XAU/USD, berita makro, atau evaluasi jurnalmu tinggal bilang ya.`;

    return {
      content,
      mode: 'OFFLINE_LOCAL',
      routeType: 'SMALL_TALK',
      detectedAgentName: detectedRename,
      workflowTrace: [],
      revisionTriggered: false,
      activeProviders: ['Offline Local'],
      totalLatencyMs: Math.max(1, Date.now() - startedAt),
    };
  }

  // Path 2: Out-of-scope guardrail offline
  if (syncNeed.intentKind === 'OUT_OF_SCOPE') {
    return {
      content: isEn
        ? `Haha that's outside my lane as ${effectiveName} — I'm strictly here for XAU/USD, macro news, fundamentals, and your TradeVault journal.`
        : `Waduh, kalau soal itu di luar keahlianku sebagai ${effectiveName} nih. Fokusku khusus nemenin kamu pantau XAU/USD, berita makro, fundamental emas, sama jurnal trading di TradeVault.`,
      mode: 'OFFLINE_LOCAL',
      routeType: 'OUT_OF_SCOPE',
      workflowTrace: [],
      revisionTriggered: false,
      activeProviders: ['Offline Local'],
      totalLatencyMs: Math.max(1, Date.now() - startedAt),
    };
  }

  const { context } = buildAgentDeskContext(params.trades, params.settings, params.language);
  const liveQuote = (context.liveMarketQuote as any)?.xauusd || null;

  // Path 3: Live price check (concise, warm, human — ZERO news/fundamental dump!)
  if (syncNeed.intentKind === 'LIVE_PRICE_CHECK') {
    const timeStr = formatReadableQuoteTime(liveQuote?.fetchedAt || liveQuote?.barTimeIso);
    const srcLabel = formatPriceSourceLabel(liveQuote?.source);
    const changeStr =
      typeof liveQuote?.changePct15m === 'number' && Number.isFinite(liveQuote.changePct15m)
        ? ` (${liveQuote.changePct15m >= 0 ? '+' : ''}${liveQuote.changePct15m.toFixed(2)}% di 15m terakhir)`
        : '';
    const changeStrEn =
      typeof liveQuote?.changePct15m === 'number' && Number.isFinite(liveQuote.changePct15m)
        ? ` (${liveQuote.changePct15m >= 0 ? '+' : ''}${liveQuote.changePct15m.toFixed(2)}% over last 15m)`
        : '';

    let content: string;
    if (liveQuote) {
      if (isEn) {
        content =
          persona === 'concise'
            ? `XAU/USD is around **$${liveQuote.price}**${changeStrEn} (updated ${timeStr || 'just now'} via ${srcLabel}).`
            : `XAU/USD is sitting around **$${liveQuote.price}**${changeStrEn}, last updated ${timeStr || 'recently'} from ${srcLabel}. Want me to check today's news direction too?`;
      } else if (persona === 'concise') {
        content = `Harga XAU/USD sekarang di sekitar **$${liveQuote.price}**${changeStr} (update ${timeStr || 'terbaru'}, ${srcLabel}).`;
      } else if (persona === 'mentor') {
        content = `XAU/USD saat ini bergerak di sekitar **$${liveQuote.price}**${changeStr}, berdasarkan update ${timeStr ? `pukul ${timeStr}` : 'terbaru'} dari ${srcLabel}. Pastikan tetap sabar menunggu area valid sebelum ambil keputusan ya.`;
      } else {
        content = `Harga emas (XAU/USD) sekarang lagi di sekitar **$${liveQuote.price}**${changeStr} nih — update terakhir ${timeStr ? `jam ${timeStr}` : 'barusan'} dari ${srcLabel}. Mau sekalian aku cekin arah beritanya hari ini?`;
      }
    } else {
      content = isEn
        ? `I don't have a fresh XAU/USD quote cached on this device yet. Once your connection is back, I'll pull the live price right away.`
        : `Aku belum dapat angka live XAU/USD terbaru di perangkat nih. Pastikan internet aktif dan Mode Offline mati ya, nanti langsung aku tarikkan harganya.`;
    }

    return {
      content,
      mode: 'OFFLINE_LOCAL',
      routeType: 'LIVE_PRICE_CHECK',
      workflowTrace: [],
      revisionTriggered: false,
      activeProviders: ['Offline Local'],
      totalLatencyMs: Math.max(1, Date.now() - startedAt),
    };
  }

  // Path 4: Plain-language human summary for Market / Journal (NO raw technical dump!)
  const journal = (context.journal as any) || {};
  const jSum = journal.summary || {};
  const macro = (context.macroNews as any) || null;
  const fund = (context.fundamentalGold as any) || null;
  const sym = params.settings.currencySymbol || '$';

  const q = params.message.toLowerCase();
  const asksMacro =
    /\b(news|berita|makro|macro|fundamental|gold|emas|xau|spike|sweep|arah|buy|sell|ambil|fomc|cpi|nfp|dxy|bearish|bullish|market|pasar|kemana|ke mana)\b/i.test(
      q
    );
  const asksJournal =
    /\b(jurnal|journal|trade|win|profit|loss|rugi|drawdown|lot|risiko|risk|posisi|open|planned|evaluasi|kesalahan|sesi|equity|saldo)\b/i.test(
      q
    );

  const paragraphs: string[] = [];

  if (params.isCloudFallback) {
    paragraphs.push(
      isEn
        ? `The cloud desk is a bit busy right now, so I'm reading straight from your latest synced data on this device.`
        : persona === 'concise'
        ? `Koneksi AI cloud lagi padat, jadi aku rangkum cepat dari data terbaru di perangkat ya.`
        : `Koneksi ke server AI lagi agak padat nih, jadi aku bantu bacakan langsung dari data terbaru yang ada di perangkatmu ya.`
    );
  }

  let directionClarity: AgentDeskActionCardClient['directionClarity'] = 'INFO_ONLY';
  let directionLabel = effectiveName;
  let spikeWarning = '-';
  const riskReminder = jSum.isDailyLossExceeded
    ? isEn
      ? 'Daily loss limit reached — pause trading today.'
      : 'Batas rugi harian sudah tercapai — istirahat dulu hari ini.'
    : isEn
    ? `Equity ${sym}${jSum.currentEquity ?? 0} · Standard risk ${params.settings.defaultRiskPercent}%/trade.`
    : `Ekuitas ${sym}${jSum.currentEquity ?? 0} · Risiko standar ${params.settings.defaultRiskPercent}%/trade.`;

  if (asksMacro || !asksJournal) {
    const spotNote = liveQuote
      ? isEn
        ? `XAU/USD is currently around **$${liveQuote.price}**. `
        : `Saat ini XAU/USD ada di sekitar **$${liveQuote.price}**. `
      : '';

    if (macro) {
      const bias = macro.dominantBias;
      const dh = macro.dualHorizon;
      directionClarity = bias === 'BUY' ? 'BUY' : bias === 'SELL' ? 'SELL' : 'WAIT_MIXED';
      directionLabel =
        bias === 'BUY'
          ? isEn
            ? 'Leans BUY'
            : 'Condong BUY'
          : bias === 'SELL'
          ? isEn
            ? 'Leans SELL'
            : 'Condong SELL'
          : isEn
          ? 'Wait / Mixed'
          : 'Tunggu / 2 Arah';

      const biasSentence =
        bias === 'SELL'
          ? isEn
            ? `From your latest Trade News snapshot, gold leans **downward (SELL)** (Sell ${macro.sellProbability ?? '-'}% vs Buy ${macro.buyProbability ?? '-'}%).`
            : `Dari data berita terakhir, emas lagi condong **turun (SELL)** (peluang Sell ${macro.sellProbability ?? '-'}% vs Buy ${macro.buyProbability ?? '-'}%).`
          : bias === 'BUY'
          ? isEn
            ? `From your latest Trade News snapshot, gold leans **upward (BUY)** (Buy ${macro.buyProbability ?? '-'}% vs Sell ${macro.sellProbability ?? '-'}%).`
            : `Dari data berita terakhir, emas lagi condong **naik (BUY)** (peluang Buy ${macro.buyProbability ?? '-'}% vs Sell ${macro.sellProbability ?? '-'}%).`
          : isEn
          ? `News sentiment is currently **mixed**, so waiting for cleaner confirmation is safer.`
          : `Sentimen beritanya lagi **campuran (belum satu arah)**, jadi lebih aman tunggu konfirmasi yang jelas dulu.`;

      let spikeSentence = '';
      if (dh) {
        const isTwoWay = dh.movementType === 'TWO_WAY_SWEEP_FIRST';
        spikeWarning = isTwoWay
          ? isEn
            ? '2-Way Sweep First risk at release'
            : 'Rawan sapuan 2 arah di menit awal rilis'
          : isEn
          ? '1-Way direct impulse pattern'
          : 'Pola dorongan 1 arah';

        if (isTwoWay) {
          spikeSentence = isEn
            ? ` Heads up though — it shows a **2-way sweep** pattern, meaning price can fake out first in the opening 5 minutes before following the real move after minute 15.`
            : ` Tapi hati-hati ya, polanya rawan **gerak 2 arah / tipuan dulu** di 5 menit awal rilis, baru arah aslinya kelihatan lebih jelas setelah menit ke-15.`;
        } else if (dh.initialCatalystBias === 'SELL') {
          spikeSentence = isEn
            ? ` Initial catalyst points to a sharp drop first (not a blind buy dip).`
            : ` Katalis awalnya juga cenderung bikin harga nyentak turun dulu, jadi jangan asal lawan arah.`;
        } else if (dh.initialCatalystBias === 'BUY') {
          spikeSentence = isEn
            ? ` Initial catalyst favors an upward push.`
            : ` Katalis awalnya cenderung mendorong harga naik duluan.`;
        }
      }

      const fundSentence = fund
        ? isEn
          ? ` Bigger-picture Fundamental Gold is **${fund.overallBias}** (1D ${fund.horizons?.daily1D?.bias || '-'}, 1W ${fund.horizons?.weekly1W?.bias || '-'}).`
          : ` Dari sisi Fundamental Emas, gambaran besarnya juga masih **${fund.overallBias}** (harian ${fund.horizons?.daily1D?.bias || '-'}, mingguan ${fund.horizons?.weekly1W?.bias || '-'}).`
        : '';

      paragraphs.push(`${spotNote}${biasSentence}${spikeSentence}${fundSentence}`);
    } else if (fund) {
      paragraphs.push(
        isEn
          ? `${spotNote}Fundamental Gold currently reads **${fund.overallBias}** (1D ${fund.horizons?.daily1D?.bias || '-'}, 1W ${fund.horizons?.weekly1W?.bias || '-'}).`
          : `${spotNote}Untuk Fundamental Emas saat ini kecenderungannya **${fund.overallBias}** (harian ${fund.horizons?.daily1D?.bias || '-'}, mingguan ${fund.horizons?.weekly1W?.bias || '-'}).`
      );
    } else {
      paragraphs.push(
        isEn
          ? `${spotNote}There isn't a cached Trade News snapshot on this device yet — open Trade News once while online so I can keep it updated for you.`
          : `${spotNote}Belum ada data berita terbaru yang tersimpan di perangkat ini. Coba buka menu Berita Trading sekali saat online biar aku bisa baca konteks lengkapnya ya.`
      );
    }
  }

  if (asksJournal || !asksMacro) {
    const openList = Array.isArray(journal.openOrPlannedTrades) ? journal.openOrPlannedTrades : [];
    const topM = Array.isArray(journal.topMistakes) && journal.topMistakes.length > 0 ? journal.topMistakes[0] : null;
    const openNote =
      openList.length > 0
        ? isEn
          ? ` You currently have **${openList.length}** open/planned position(s).`
          : ` Saat ini ada **${openList.length}** posisi aktif/rencana yang masih jalan.`
        : '';
    const mistakeNote = topM
      ? isEn
        ? ` Most common slip to watch: **${topM.tag}** (${topM.count}x).`
        : ` Catatan yang paling sering kejadian: **${topM.tag}** (${topM.count}x).`
      : '';
    const riskNote = jSum.isDailyLossExceeded
      ? isEn
        ? ` Note: your daily loss limit is already hit today, better sit out.`
        : ` Ingat ya, batas rugi harian sudah kena — lebih bijak stop entry dulu hari ini.`
      : '';

    paragraphs.push(
      isEn
        ? `On your journal: **${jSum.closedTradesCount ?? 0}** closed trades, Win Rate **${jSum.winRatePct ?? 0}%**, Profit Factor **${jSum.profitFactor ?? 0}**, Net PnL **${sym}${jSum.totalNetProfit ?? 0}** (Max DD ${jSum.maxDrawdownPercent ?? 0}%).${openNote}${mistakeNote}${riskNote}`
        : `Untuk jurnalmu, dari **${jSum.closedTradesCount ?? 0}** trade selesai, Win Rate ada di **${jSum.winRatePct ?? 0}%** dengan Profit Factor **${jSum.profitFactor ?? 0}** dan Net PnL **${sym}${jSum.totalNetProfit ?? 0}** (Max DD ${jSum.maxDrawdownPercent ?? 0}%).${openNote}${mistakeNote}${riskNote}`
    );
  }

  return {
    content: paragraphs.join('\n\n'),
    mode: 'OFFLINE_LOCAL',
    routeType: 'FULL_OFFICE',
    actionCard: {
      directionClarity,
      directionLabel,
      spikeWarning,
      riskReminder,
    },
    workflowTrace: [
      {
        stepNumber: 1,
        role: 'OFFLINE_ENGINE',
        divisionName: `${effectiveName} (Lokal)`,
        provider: 'offline',
        model: 'human-local-v3',
        action: isEn ? 'Local Assistant Summary' : 'Ringkasan Lokal Natural',
        status: 'fallback',
        summary: isEn
          ? 'Replied naturally from synced device data.'
          : 'Dijawab natural dari data terbaru di perangkat.',
        latencyMs: Math.max(1, Date.now() - startedAt),
      },
    ],
    revisionTriggered: false,
    activeProviders: ['Offline Local'],
    totalLatencyMs: Math.max(1, Date.now() - startedAt),
  };
}

export async function sendAgentDeskChatMessage(params: {
  message: string;
  history: AgentDeskMessage[];
  trades: Trade[];
  settings: AppSettings;
  language: 'id' | 'en';
  persona?: AgentChatPersona;
  agentName?: string;
  onSyncStatus?: (text: string | null) => void;
}): Promise<Omit<AgentDeskMessage, 'id' | 'role' | 'createdAt'>> {
  const isOfflineMode = isNewsCycleOfflineMode();
  const isNavigatorOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;

  if (isOfflineMode || !isNavigatorOnline) {
    return buildOfflineAgentDeskReply({
      message: params.message,
      trades: params.trades,
      settings: params.settings,
      language: params.language,
      agentName: params.agentName,
      persona: params.persona,
      isCloudFallback: false,
    });
  }

  // On-demand real-time background sync ONLY when user asks price or market/news questions
  const syncNeed = classifyClientSyncNeed(params.message);
  if (syncNeed.needsPrice || syncNeed.needsMarket) {
    await syncAgentDeskLiveContext({
      forcePrice: syncNeed.intentKind === 'LIVE_PRICE_CHECK',
      syncMarketFeeds: syncNeed.needsMarket,
      language: params.language,
      onStatus: params.onSyncStatus,
    });
  }

  const { context } = buildAgentDeskContext(params.trades, params.settings, params.language);
  const compactHistory = params.history
    .filter(
      (m) =>
        !(
          m.role === 'assistant' &&
          /^(Server Multi-Agent AI sedang tidak terjangkau|Multi-Agent cloud desk is temporarily unreachable)/i.test(
            m.content.trim()
          )
        )
    )
    .slice(-10)
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, 800),
    }));

  const payload = {
    message: params.message.trim(),
    language: params.language,
    persona: params.persona || 'casual',
    agentName: params.agentName || 'Head Desk',
    history: compactHistory,
    context,
  };

  const candidates = getApiEndpointCandidates('/api/agent-desk/chat');
  // Pure live price queries already have fresh TwelveData/Binance quote locally -> fail fast (7.5s) instead of waiting 26s!
  const requestTimeoutMs = syncNeed.intentKind === 'LIVE_PRICE_CHECK' ? 7_500 : 26_000;

  for (const url of candidates) {
    const res = await nativeAwarePostJson(url, payload, requestTimeoutMs);
    if (res.ok && res.json?.success && typeof res.json.answer === 'string' && res.json.answer.trim()) {
      const incomingMemories = Array.isArray(res.json.newMemoryNotes) ? res.json.newMemoryNotes : [];
      if (incomingMemories.length > 0) {
        addAgentMemoryNotes(incomingMemories);
      }

      const routeRaw = String(res.json.routeType || 'FULL_OFFICE');
      const routeType: AgentDeskMessage['routeType'] =
        routeRaw === 'SMALL_TALK' ||
        routeRaw === 'OUT_OF_SCOPE' ||
        routeRaw === 'LIVE_PRICE_CHECK' ||
        routeRaw === 'DIRECT_FOLLOWUP'
          ? routeRaw
          : 'FULL_OFFICE';

      const detectedAgentName = cleanClientExtractedName(res.json.detectedAgentName);

      return {
        content: res.json.answer.trim(),
        mode: 'ONLINE_MULTI_AGENT',
        routeType,
        actionCard: res.json.actionCard,
        workflowTrace: Array.isArray(res.json.workflowTrace) ? res.json.workflowTrace : [],
        revisionTriggered: Boolean(res.json.revisionTriggered),
        activeProviders: Array.isArray(res.json.activeProviders) ? res.json.activeProviders : [],
        totalLatencyMs: Number(res.json.totalLatencyMs) || 0,
        detectedAgentName,
      };
    }
    if (res.errorMessage) {
      recordAppDiagnosticEvent(
        'AI_DESK',
        `Agent chat request failed (${res.status || 'network'})`,
        `${url}: ${res.errorMessage}`
      );
    }
  }

  // Graceful human-toned local fallback (technical details stay silently inside Dev Diagnostics)
  return buildOfflineAgentDeskReply({
    message: params.message,
    trades: params.trades,
    settings: params.settings,
    language: params.language,
    agentName: params.agentName,
    persona: params.persona,
    isCloudFallback: true,
  });
}

function distillLocalFallbackFacts(messages: AgentDeskMessage[]): Array<{ text: string; category: AgentMemoryCategory }> {
  const facts: Array<{ text: string; category: AgentMemoryCategory }> = [];
  for (const m of messages) {
    if (m.role === 'user') {
      const rename = extractClientNicknameRename(m.content);
      if (rename) {
        facts.push({
          text: `User memanggil asisten dengan nama "${rename}".`,
          category: 'preference',
        });
      }
    }
  }
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === 'assistant' && m.routeType !== 'SMALL_TALK' && m.routeType !== 'OUT_OF_SCOPE');
  if (lastAssistant) {
    const firstSentence = lastAssistant.content.replace(/\*\*/g, '').split(/\n|\.\s/)[0]?.trim();
    if (firstSentence && firstSentence.length >= 16) {
      facts.push({
        text: `Pembahasan sesi sebelumnya: ${firstSentence.slice(0, 175)}.`,
        category: 'general',
      });
    }
  }
  return facts.slice(0, 3);
}

export async function endAgentDeskSession(params: {
  messages: AgentDeskMessage[];
  language: 'id' | 'en';
}): Promise<{
  archivedCount: number;
  savedMemoriesCount: number;
  sessionSummary: string;
}> {
  const isEn = params.language === 'en';
  if (!Array.isArray(params.messages) || params.messages.length === 0) {
    saveLastSessionDayKey(getTodayLocalDateKey());
    return {
      archivedCount: 0,
      savedMemoriesCount: loadAgentMemory().length,
      sessionSummary: isEn ? 'Ready for a fresh New Day.' : 'Siap memulai hari baru.',
    };
  }

  const isOfflineMode = isNewsCycleOfflineMode();
  const isNavigatorOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
  const existingMemories = loadAgentMemory();

  if (!isOfflineMode && isNavigatorOnline) {
    const compactHistory = params.messages.slice(-24).map((m) => ({
      role: m.role,
      content: m.content.slice(0, 600),
    }));
    const payload = {
      language: params.language,
      history: compactHistory,
      existingMemories: existingMemories.map((m) => m.text),
    };

    const candidates = getApiEndpointCandidates('/api/agent-desk/end-session');
    for (const url of candidates) {
      try {
        const res = await nativeAwarePostJson(url, payload, 15_000);
        if (res.ok && res.json?.success) {
          const facts = Array.isArray(res.json.memoryFacts) ? res.json.memoryFacts : [];
          const nextMemories = addAgentMemoryNotes(facts);
          const summary = String(
            res.json.sessionSummary ||
              (isEn ? 'Previous session distilled into long-term memory.' : 'Sesi sebelumnya diringkas ke memori asisten.')
          );
          saveSessionArchiveEntry(summary, params.messages.length);
          saveLastSessionDayKey(getTodayLocalDateKey());
          return {
            archivedCount: facts.length,
            savedMemoriesCount: nextMemories.length,
            sessionSummary: summary,
          };
        }
      } catch {
        // try next candidate
      }
    }
  }

  // Deterministic local fallback when offline or backend unreachable
  const localFacts = distillLocalFallbackFacts(params.messages);
  const nextMemories = addAgentMemoryNotes(localFacts);
  const fallbackSummary = isEn
    ? `Session (${params.messages.length} msgs) archived locally.`
    : `Sesi (${params.messages.length} pesan) diringkas & disimpan lokal.`;
  saveSessionArchiveEntry(fallbackSummary, params.messages.length);
  saveLastSessionDayKey(getTodayLocalDateKey());
  return {
    archivedCount: localFacts.length,
    savedMemoriesCount: nextMemories.length,
    sessionSummary: fallbackSummary,
  };
}
