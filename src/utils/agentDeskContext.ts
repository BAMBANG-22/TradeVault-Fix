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
import { calculatePerformance, computeTradeNetProfit } from './calculations';
import {
  getTradeLifecycleStatus,
  resolveTradeLifecycle,
  stripLifecycleMetaFromExecutionNotes,
} from './tradeLifecycle';
import { resolveTradeBehavior } from './journalExtras';
import {
  calculateAstronacciCycle,
  getSessionLabelId,
  getSessionWIB,
  loadStoredManualAmdOverride,
  loadStoredSessionHoursWib,
  loadStoredTradingConfluenceMode,
} from './confluenceEngine';
import { computeMonthlySeasonalityStats } from '../data/xauusdSeasonality';
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

const INDONESIAN_WEEKDAYS = [
  'Minggu',
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu',
] as const;

const ENGLISH_WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const INDONESIAN_MONTHS = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
] as const;

function formatLocalYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getLocalDayNameFromYmd(ymd: string): string {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return INDONESIAN_WEEKDAYS[d.getDay()] || '';
}

function formatReadableIndonesianDate(ymd: string): string {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  const year = Number(m[1]);
  const monthIdx = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(year, monthIdx, day);
  const dayName = INDONESIAN_WEEKDAYS[d.getDay()] || '';
  const monthName = INDONESIAN_MONTHS[monthIdx] || m[2];
  return `${dayName}, ${day} ${monthName} ${year}`;
}

function buildLocalClockSnapshot(nowDate: Date) {
  const tzOffsetMin = -nowDate.getTimezoneOffset(); // e.g., +420 for WIB
  const sign = tzOffsetMin >= 0 ? '+' : '-';
  const absMin = Math.abs(tzOffsetMin);
  const hh = String(Math.floor(absMin / 60)).padStart(2, '0');
  const mm = String(absMin % 60).padStart(2, '0');
  const tzLabel =
    tzOffsetMin === 420
      ? 'WIB (UTC+07:00)'
      : tzOffsetMin === 480
      ? 'WITA (UTC+08:00)'
      : tzOffsetMin === 540
      ? 'WIT (UTC+09:00)'
      : `UTC${sign}${hh}:${mm}`;

  const yesterdayDate = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - 1);
  const todayDateKey = formatLocalYmd(nowDate);
  const yesterdayDateKey = formatLocalYmd(yesterdayDate);

  return {
    localDateKey: todayDateKey,
    localReadableId: formatReadableIndonesianDate(todayDateKey),
    localDayNameId: INDONESIAN_WEEKDAYS[nowDate.getDay()],
    localDayNameEn: ENGLISH_WEEKDAYS[nowDate.getDay()],
    localTimeHHMM: `${String(nowDate.getHours()).padStart(2, '0')}:${String(nowDate.getMinutes()).padStart(2, '0')}`,
    timezone: tzLabel,
    isEarlyMorningLocal: nowDate.getHours() < 6,
    yesterdayDateKey,
    yesterdayReadableId: formatReadableIndonesianDate(yesterdayDateKey),
    yesterdayDayNameId: INDONESIAN_WEEKDAYS[yesterdayDate.getDay()],
  };
}

type MicroCloseClassification =
  | 'HIT_TP'
  | 'HIT_SL'
  | 'MANUAL_PROFIT'
  | 'MANUAL_LOSS'
  | 'MANUAL_BE'
  | 'UNKNOWN';

interface MicroTradeRecord {
  date: string;
  dayName: string;
  time: string;
  exitTime: string | null;
  instrument: string;
  position: 'BUY' | 'SELL';
  orderType: string;
  session: string;
  strategy: string;
  lotSize: number;
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  exitPrice: number | null;
  closeType: MicroCloseClassification;
  plannedRR: number | null;
  realizedR: number | null;
  tpCompletionPct: number | null;
  riskPercentage: number;
  riskAmount: number;
  grossProfit: number;
  commission: number;
  swap: number;
  netProfit: number;
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN';
  disciplineRating: number | null;
  checklistPassed: boolean | null;
  ruleCompliant: boolean | null;
  emotionTag: string | null;
  mistakeTags: string[];
  microAuditFlags: string[];
  entryReason: string | null;
  notes: string | null;
  postTradeEvaluation: string | null;
  executionNotes: string | null;
}

function classifyMicroTradeCloseType(
  t: Trade,
  explicitCloseType: string | undefined,
  entry: number,
  sl: number | null,
  tp: number | null,
  exit: number | null,
  netProfit: number
): MicroCloseClassification {
  if (explicitCloseType === 'TP') return 'HIT_TP';
  if (explicitCloseType === 'SL') return 'HIT_SL';
  if (explicitCloseType === 'Manual') {
    if (netProfit > 0.005) return 'MANUAL_PROFIT';
    if (netProfit < -0.005) return 'MANUAL_LOSS';
    return 'MANUAL_BE';
  }

  // Infer from exitPrice vs TP/SL if explicit closeType wasn't saved
  if (exit !== null && Number.isFinite(exit) && exit > 0) {
    const isBuy = t.position === 'BUY';
    const tpDist = tp !== null && Number.isFinite(tp) ? Math.abs(tp - entry) : 0;
    const slDist = sl !== null && Number.isFinite(sl) ? Math.abs(entry - sl) : 0;
    const tol = Math.max(0.05, Math.min(tpDist, slDist) * 0.06 || 0.25);

    if (tp !== null && Number.isFinite(tp)) {
      if ((isBuy && exit >= tp - tol) || (!isBuy && exit <= tp + tol)) {
        return 'HIT_TP';
      }
    }
    if (sl !== null && Number.isFinite(sl)) {
      if ((isBuy && exit <= sl + tol) || (!isBuy && exit >= sl - tol)) {
        return 'HIT_SL';
      }
    }
    if (tp !== null || sl !== null) {
      if (netProfit > 0.005) return 'MANUAL_PROFIT';
      if (netProfit < -0.005) return 'MANUAL_LOSS';
      return 'MANUAL_BE';
    }
  }
  return 'UNKNOWN';
}

function buildMicroTradeRecord(
  t: Trade,
  settings: AppSettings,
  toLocalDateKey: (iso?: string) => string
): MicroTradeRecord {
  const lifecycle = resolveTradeLifecycle(t);
  const behavior = resolveTradeBehavior(t);
  const netProfit = Number(computeTradeNetProfit(t).toFixed(2));
  const grossProfit = Number((Number(t.grossProfit) || 0).toFixed(2));
  const commission = Number((Number(t.commission) || 0).toFixed(2));
  const swap = Number((Number(t.swap) || 0).toFixed(2));
  const riskAmount = Number((Number(t.riskAmount) || 0).toFixed(2));
  const riskPercentage = Number((Number(t.riskPercentage) || 0).toFixed(2));

  const entry = Number(lifecycle.actualEntry ?? t.entryPrice ?? 0);
  const sl =
    typeof (lifecycle.plannedStopLoss ?? t.stopLoss) === 'number' &&
    Number.isFinite(lifecycle.plannedStopLoss ?? t.stopLoss) &&
    Number(lifecycle.plannedStopLoss ?? t.stopLoss) > 0
      ? Number(lifecycle.plannedStopLoss ?? t.stopLoss)
      : null;
  const tp =
    typeof (lifecycle.plannedTakeProfit ?? t.takeProfit) === 'number' &&
    Number.isFinite(lifecycle.plannedTakeProfit ?? t.takeProfit) &&
    Number(lifecycle.plannedTakeProfit ?? t.takeProfit) > 0
      ? Number(lifecycle.plannedTakeProfit ?? t.takeProfit)
      : null;
  const exit =
    typeof (lifecycle.actualExit ?? t.exitPrice) === 'number' &&
    Number.isFinite(lifecycle.actualExit ?? t.exitPrice) &&
    Number(lifecycle.actualExit ?? t.exitPrice) > 0
      ? Number(lifecycle.actualExit ?? t.exitPrice)
      : null;

  const closeType = classifyMicroTradeCloseType(t, lifecycle.closeType, entry, sl, tp, exit, netProfit);

  let plannedRR: number | null = null;
  if (entry > 0 && sl !== null && tp !== null) {
    const slDist = Math.abs(entry - sl);
    const tpDist = Math.abs(tp - entry);
    if (slDist > 0) {
      plannedRR = Number((tpDist / slDist).toFixed(2));
    }
  }

  let realizedR: number | null = null;
  if (typeof t.rMultiple === 'number' && Number.isFinite(t.rMultiple)) {
    realizedR = Number(t.rMultiple.toFixed(2));
  } else if (riskAmount > 0) {
    realizedR = Number((netProfit / riskAmount).toFixed(2));
  }

  let tpCompletionPct: number | null = null;
  if (entry > 0 && tp !== null && exit !== null) {
    const tpVec = tp - entry;
    if (Math.abs(tpVec) > 0) {
      const progress = ((exit - entry) / tpVec) * 100;
      if (Number.isFinite(progress)) {
        tpCompletionPct = Number(Math.max(-300, Math.min(300, progress)).toFixed(0));
      }
    }
  }

  const microAuditFlags: string[] = [];
  if (sl === null) microAuditFlags.push('NO_SL');
  if (plannedRR !== null && plannedRR < 1.0) {
    microAuditFlags.push(`INVERTED_RR(1:${plannedRR})`);
  }
  if (closeType === 'MANUAL_PROFIT' && tpCompletionPct !== null && tpCompletionPct > 0 && tpCompletionPct < 75) {
    microAuditFlags.push(`EARLY_MANUAL_PROFIT(${tpCompletionPct}%_of_TP)`);
  }
  if (closeType === 'MANUAL_LOSS') {
    microAuditFlags.push('MANUAL_CUT_LOSS');
  }
  if (riskPercentage > (settings.maxTradeRiskPercent ?? 2)) {
    microAuditFlags.push(`OVER_RISK(${riskPercentage}%>max_${settings.maxTradeRiskPercent ?? 2}%)`);
  }
  if (behavior.ruleCompliant === false) microAuditFlags.push('RULE_VIOLATED');
  if (behavior.checklistPassed === false) microAuditFlags.push('CHECKLIST_SKIPPED');
  if (grossProfit > 0 && Math.abs(commission) + Math.abs(swap) > grossProfit * 0.25) {
    microAuditFlags.push('HIGH_FEE_DRAG');
  }
  if (Array.isArray(lifecycle.activityLog)) {
    if (lifecycle.activityLog.some((ev) => ev.type === 'SL_CHANGED')) microAuditFlags.push('SL_MODIFIED');
    if (lifecycle.activityLog.some((ev) => ev.type === 'TP_CHANGED')) microAuditFlags.push('TP_MODIFIED');
  }

  const dateKey = toLocalDateKey(t.dateTime);
  const dtObj = t.dateTime ? new Date(t.dateTime) : null;
  const timeStr =
    dtObj && !Number.isNaN(dtObj.getTime())
      ? `${String(dtObj.getHours()).padStart(2, '0')}:${String(dtObj.getMinutes()).padStart(2, '0')}`
      : '';

  const cleanExecNotes = stripLifecycleMetaFromExecutionNotes(t.executionNotes);

  return {
    date: dateKey,
    dayName: getLocalDayNameFromYmd(dateKey),
    time: timeStr,
    exitTime: lifecycle.exitTime || null,
    instrument: t.instrument,
    position: t.position,
    orderType: lifecycle.orderType || 'Market',
    session: t.session || 'Other',
    strategy: (t.strategy || 'Unspecified').trim() || 'Unspecified',
    lotSize: Number(lifecycle.actualLot ?? t.lotSize ?? 0),
    entryPrice: entry,
    stopLoss: sl,
    takeProfit: tp,
    exitPrice: exit,
    closeType,
    plannedRR,
    realizedR,
    tpCompletionPct,
    riskPercentage,
    riskAmount,
    grossProfit,
    commission,
    swap,
    netProfit,
    outcome: t.outcome,
    disciplineRating: typeof t.disciplineRating === 'number' ? t.disciplineRating : null,
    checklistPassed: typeof behavior.checklistPassed === 'boolean' ? behavior.checklistPassed : null,
    ruleCompliant: typeof behavior.ruleCompliant === 'boolean' ? behavior.ruleCompliant : null,
    emotionTag: behavior.emotionTag || null,
    mistakeTags: behavior.mistakeTags.slice(0, 4),
    microAuditFlags,
    entryReason: t.entryReason ? t.entryReason.trim().slice(0, 140) : null,
    notes: t.notes ? t.notes.trim().slice(0, 140) : null,
    postTradeEvaluation: t.postTradeEvaluation ? t.postTradeEvaluation.trim().slice(0, 160) : null,
    executionNotes: cleanExecNotes ? cleanExecNotes.slice(0, 120) : null,
  };
}

interface ResolvedDateQuery {
  label: string;
  startDate: string;
  endDate: string;
}

const MONTH_NAME_TO_INDEX: Record<string, number> = {
  jan: 0,
  januari: 0,
  january: 0,
  feb: 1,
  februari: 1,
  february: 1,
  mar: 2,
  maret: 2,
  march: 2,
  apr: 3,
  april: 3,
  mei: 4,
  may: 4,
  jun: 5,
  juni: 5,
  june: 5,
  jul: 6,
  juli: 6,
  july: 6,
  agu: 7,
  agt: 7,
  agustus: 7,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  okt: 9,
  oktober: 9,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  des: 11,
  desember: 11,
  dec: 11,
  december: 11,
};

const WEEKDAY_WORD_TO_NUM: Record<string, number> = {
  minggu: 0,
  sunday: 0,
  senin: 1,
  monday: 1,
  selasa: 2,
  tuesday: 2,
  rabu: 3,
  wednesday: 3,
  kamis: 4,
  thursday: 4,
  jumat: 5,
  "jum'at": 5,
  friday: 5,
  sabtu: 6,
  saturday: 6,
};

function parseDateRangeFromText(text: string, nowDate: Date): ResolvedDateQuery | null {
  if (!text || !text.trim()) return null;
  const q = text.toLowerCase();
  const y = nowDate.getFullYear();
  const mo = nowDate.getMonth();
  const da = nowDate.getDate();

  // 1. Explicit ISO YYYY-MM-DD
  const isoMatch = q.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const key = `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
    return { label: formatReadableIndonesianDate(key), startDate: key, endDate: key };
  }

  // 2. Day + Month name (e.g., "26 nov", "26 november", "26 nov 2026")
  const dayMonthMatch = q.match(
    /\b(\d{1,2})\s+(jan(?:uari|uary)?|feb(?:ruari|ruary)?|mar(?:et|ch)?|apr(?:il)?|mei|may|jun(?:i|e)?|jul(?:i|y)?|agu(?:stus)?|agt|aug(?:ust)?|sep(?:t|tember)?|okt(?:ober)?|oct(?:ober)?|nov(?:ember)?|des(?:ember)?|dec(?:ember)?)(?:\s+(20\d{2}))?\b/i
  );
  if (dayMonthMatch) {
    const dayNum = Number(dayMonthMatch[1]);
    const mIdx = MONTH_NAME_TO_INDEX[dayMonthMatch[2].toLowerCase()];
    if (dayNum >= 1 && dayNum <= 31 && typeof mIdx === 'number') {
      let targetYear = dayMonthMatch[3] ? Number(dayMonthMatch[3]) : y;
      if (!dayMonthMatch[3] && mIdx > mo + 1) targetYear = y - 1;
      const key = `${targetYear}-${String(mIdx + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      return { label: formatReadableIndonesianDate(key), startDate: key, endDate: key };
    }
  }

  // 3. DD/MM or DD-MM (e.g., "26/11")
  const slashMatch = q.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](20\d{2}))?\b/);
  if (slashMatch) {
    const dayNum = Number(slashMatch[1]);
    const monthNum = Number(slashMatch[2]);
    if (dayNum >= 1 && dayNum <= 31 && monthNum >= 1 && monthNum <= 12) {
      const targetYear = slashMatch[3] ? Number(slashMatch[3]) : y;
      const key = `${targetYear}-${String(monthNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      return { label: formatReadableIndonesianDate(key), startDate: key, endDate: key };
    }
  }

  // 4. "tgl 26" / "tanggal 26"
  const tglMatch = q.match(/\b(?:tgl|tanggal)\s*(\d{1,2})\b/i);
  if (tglMatch) {
    const dayNum = Number(tglMatch[1]);
    if (dayNum >= 1 && dayNum <= 31) {
      let targetMonth = mo;
      let targetYear = y;
      if (dayNum > da) {
        targetMonth -= 1;
        if (targetMonth < 0) {
          targetMonth = 11;
          targetYear -= 1;
        }
      }
      const key = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      return { label: formatReadableIndonesianDate(key), startDate: key, endDate: key };
    }
  }

  // 5. Explicit weekday with "minggu lalu" / "pekan lalu" vs most recent weekday
  const weekdayLastWeek = q.match(
    /\b(senin|selasa|rabu|kamis|jumat|jum'at|sabtu|minggu|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:minggu|pekan)\s+(?:lalu|kemarin|kemaren)\b/i
  );
  if (weekdayLastWeek) {
    const targetDow = WEEKDAY_WORD_TO_NUM[weekdayLastWeek[1].toLowerCase()];
    if (typeof targetDow === 'number') {
      let diff = (nowDate.getDay() - targetDow + 7) % 7;
      if (diff === 0) diff = 7;
      const d = new Date(y, mo, da - diff - 7);
      const key = formatLocalYmd(d);
      return { label: formatReadableIndonesianDate(key), startDate: key, endDate: key };
    }
  }

  // 6. Relative keywords
  if (/\b(minggu\s+lalu|pekan\s+lalu|minggu\s+kemarin|minggu\s+kemaren|last\s+week)\b/i.test(q)) {
    const dow = (nowDate.getDay() + 6) % 7; // Mon=0..Sun=6
    const thisMon = new Date(y, mo, da - dow);
    const prevMon = new Date(thisMon.getFullYear(), thisMon.getMonth(), thisMon.getDate() - 7);
    const prevSun = new Date(thisMon.getFullYear(), thisMon.getMonth(), thisMon.getDate() - 1);
    const s = formatLocalYmd(prevMon);
    const e = formatLocalYmd(prevSun);
    return { label: `Minggu Lalu (${s} s/d ${e})`, startDate: s, endDate: e };
  }

  if (/\b(minggu\s+ini|pekan\s+ini|this\s+week)\b/i.test(q)) {
    const dow = (nowDate.getDay() + 6) % 7;
    const thisMon = new Date(y, mo, da - dow);
    const s = formatLocalYmd(thisMon);
    const e = formatLocalYmd(nowDate);
    return { label: `Minggu Ini (${s} s/d ${e})`, startDate: s, endDate: e };
  }

  if (/\b(bulan\s+lalu|bulan\s+kemarin|last\s+month)\b/i.test(q)) {
    const firstPrev = new Date(y, mo - 1, 1);
    const lastPrev = new Date(y, mo, 0);
    const s = formatLocalYmd(firstPrev);
    const e = formatLocalYmd(lastPrev);
    return {
      label: `Bulan Lalu (${INDONESIAN_MONTHS[firstPrev.getMonth()]} ${firstPrev.getFullYear()})`,
      startDate: s,
      endDate: e,
    };
  }

  if (/\b(bulan\s+ini|this\s+month)\b/i.test(q)) {
    const firstCur = new Date(y, mo, 1);
    const s = formatLocalYmd(firstCur);
    const e = formatLocalYmd(nowDate);
    return { label: `Bulan Ini (${INDONESIAN_MONTHS[mo]} ${y})`, startDate: s, endDate: e };
  }

  if (/\b(2\s*hari\s+lalu|dua\s+hari\s+lalu|kemarin\s+lusa|two\s+days\s+ago)\b/i.test(q)) {
    const d = new Date(y, mo, da - 2);
    const key = formatLocalYmd(d);
    return { label: formatReadableIndonesianDate(key), startDate: key, endDate: key };
  }

  if (/\b(kemarin|kemaren|kmrn|yesterday)\b/i.test(q)) {
    const d = new Date(y, mo, da - 1);
    const key = formatLocalYmd(d);
    return { label: `Kemarin (${formatReadableIndonesianDate(key)})`, startDate: key, endDate: key };
  }

  if (/\b(hari\s+ini|hr\s+ini|today)\b/i.test(q)) {
    const key = formatLocalYmd(nowDate);
    return { label: `Hari Ini (${formatReadableIndonesianDate(key)})`, startDate: key, endDate: key };
  }

  // 7. Standalone weekday name (e.g., "trade kamis", "hari rabu") — avoid matching generic "minggu" alone
  const singleWeekday = q.match(
    /\b(?:hari\s+)?(senin|selasa|rabu|kamis|jumat|jum'at|sabtu|monday|tuesday|wednesday|thursday|friday|saturday)\b/i
  );
  if (singleWeekday) {
    const targetDow = WEEKDAY_WORD_TO_NUM[singleWeekday[1].toLowerCase()];
    if (typeof targetDow === 'number') {
      const diff = (nowDate.getDay() - targetDow + 7) % 7;
      const d = new Date(y, mo, da - diff);
      const key = formatLocalYmd(d);
      return { label: formatReadableIndonesianDate(key), startDate: key, endDate: key };
    }
  }

  return null;
}

function summarizeMicroPeriod(
  label: string,
  startDate: string,
  endDate: string,
  matchedFrom: 'current_message' | 'conversation_history' | 'default_latest_active_day',
  allMicroClosed: MicroTradeRecord[],
  startingBal: number
) {
  const matched = allMicroClosed.filter((t) => t.date >= startDate && t.date <= endDate);
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let totalGrossProfit = 0;
  let totalCommission = 0;
  let totalSwap = 0;
  let totalNetProfit = 0;
  let totalR = 0;
  let rCount = 0;
  let plannedRRSum = 0;
  let plannedRRCount = 0;

  const closeTypeCounts = {
    hitTP: 0,
    hitSL: 0,
    manualProfit: 0,
    manualLoss: 0,
    manualBE: 0,
    unknown: 0,
  };
  const auditSummary = {
    invertedRRCount: 0,
    earlyManualProfitCount: 0,
    overRiskCount: 0,
    ruleViolatedCount: 0,
    noSlCount: 0,
  };

  for (const t of matched) {
    if (t.outcome === 'WIN') wins += 1;
    else if (t.outcome === 'LOSS') losses += 1;
    else breakeven += 1;

    totalGrossProfit += t.grossProfit;
    totalCommission += t.commission;
    totalSwap += t.swap;
    totalNetProfit += t.netProfit;

    if (typeof t.realizedR === 'number') {
      totalR += t.realizedR;
      rCount += 1;
    }
    if (typeof t.plannedRR === 'number') {
      plannedRRSum += t.plannedRR;
      plannedRRCount += 1;
    }

    if (t.closeType === 'HIT_TP') closeTypeCounts.hitTP += 1;
    else if (t.closeType === 'HIT_SL') closeTypeCounts.hitSL += 1;
    else if (t.closeType === 'MANUAL_PROFIT') closeTypeCounts.manualProfit += 1;
    else if (t.closeType === 'MANUAL_LOSS') closeTypeCounts.manualLoss += 1;
    else if (t.closeType === 'MANUAL_BE') closeTypeCounts.manualBE += 1;
    else closeTypeCounts.unknown += 1;

    if (t.microAuditFlags.some((f) => f.startsWith('INVERTED_RR'))) auditSummary.invertedRRCount += 1;
    if (t.microAuditFlags.some((f) => f.startsWith('EARLY_MANUAL_PROFIT'))) auditSummary.earlyManualProfitCount += 1;
    if (t.microAuditFlags.some((f) => f.startsWith('OVER_RISK'))) auditSummary.overRiskCount += 1;
    if (t.microAuditFlags.includes('RULE_VIOLATED')) auditSummary.ruleViolatedCount += 1;
    if (t.microAuditFlags.includes('NO_SL')) auditSummary.noSlCount += 1;
  }

  return {
    label,
    startDate,
    endDate,
    matchedFrom,
    tradesCount: matched.length,
    wins,
    losses,
    breakeven,
    winRatePct: matched.length > 0 ? Number(((wins / matched.length) * 100).toFixed(1)) : 0,
    totalGrossProfit: Number(totalGrossProfit.toFixed(2)),
    totalCommission: Number(totalCommission.toFixed(2)),
    totalSwap: Number(totalSwap.toFixed(2)),
    totalNetProfit: Number(totalNetProfit.toFixed(2)),
    periodGainDeltaOnStartingBalancePct:
      startingBal > 0 ? Number(((totalNetProfit / startingBal) * 100).toFixed(2)) : 0,
    totalR: Number(totalR.toFixed(2)),
    avgR: rCount > 0 ? Number((totalR / rCount).toFixed(2)) : null,
    avgPlannedRR: plannedRRCount > 0 ? Number((plannedRRSum / plannedRRCount).toFixed(2)) : null,
    closeTypeCounts,
    auditSummary,
    trades: matched.slice(0, 25),
  };
}

export function buildAgentDeskContext(
  trades: Trade[],
  settings: AppSettings,
  language: 'id' | 'en',
  options?: {
    message?: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }
): {
  context: Record<string, unknown>;
  absorbedSummary: AgentDeskAbsorbedSummary;
} {
  const isOfflineMode = isNewsCycleOfflineMode();
  const isNavigatorOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
  const nowDate = new Date();
  const localClock = buildLocalClockSnapshot(nowDate);

  // 1. Offline Journal & Micro-Forensic Risk Context
  const { metrics } = calculatePerformance(trades, settings);
  const sortedTrades = [...trades].sort(
    (a, b) => new Date(b.dateTime || 0).getTime() - new Date(a.dateTime || 0).getTime()
  );

  const openOrPlannedTrades = sortedTrades
    .filter((t) => {
      const st = getTradeLifecycleStatus(t);
      return st === 'OPEN' || st === 'PLANNED';
    })
    .slice(0, 10)
    .map((t) => {
      const lc = resolveTradeLifecycle(t);
      const entry = Number(lc.actualEntry ?? t.entryPrice ?? 0);
      const sl = lc.plannedStopLoss ?? t.stopLoss ?? null;
      const tp = lc.plannedTakeProfit ?? t.takeProfit ?? null;
      let plannedRR: number | null = null;
      if (entry > 0 && typeof sl === 'number' && sl > 0 && typeof tp === 'number' && tp > 0) {
        const slDist = Math.abs(entry - sl);
        if (slDist > 0) plannedRR = Number((Math.abs(tp - entry) / slDist).toFixed(2));
      }
      return {
        lifecycle: getTradeLifecycleStatus(t),
        orderType: lc.orderType,
        instrument: t.instrument,
        position: t.position,
        lotSize: lc.actualLot ?? t.lotSize,
        entryPrice: entry,
        stopLoss: sl,
        takeProfit: tp,
        plannedRR,
        riskPercentage: t.riskPercentage,
        strategy: t.strategy,
        session: t.session || 'Other',
        entryReason: t.entryReason ? t.entryReason.trim().slice(0, 120) : null,
        dateTime: t.dateTime,
      };
    });

  // Deterministic Local Calendar Date Keys & Daily/Period Growth Comparison
  const toLocalDateKeyFromIso = (isoStr: string | undefined): string => {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) {
      const m = isoStr.match(/^(\d{4}-\d{2}-\d{2})/);
      return m ? m[1] : '';
    }
    return formatLocalYmd(d);
  };

  const todayDateKey = localClock.localDateKey;
  const yesterdayDateKey = localClock.yesterdayDateKey;
  const startingBal = settings.startingBalance > 0 ? settings.startingBalance : metrics.startingBalance;

  const closedTradesDesc = sortedTrades.filter((t) => getTradeLifecycleStatus(t) === 'CLOSED');
  const closedChrono = [...closedTradesDesc].sort(
    (a, b) => new Date(a.dateTime || 0).getTime() - new Date(b.dateTime || 0).getTime()
  );

  // Build full micro-forensic records for ALL closed trades chronologically
  const allMicroClosedChrono: MicroTradeRecord[] = closedChrono.map((t) =>
    buildMicroTradeRecord(t, settings, toLocalDateKeyFromIso)
  );
  const allMicroClosedDesc = [...allMicroClosedChrono].reverse();
  const recentClosed = allMicroClosedDesc.slice(0, 12);

  // Aggregate mistakes, emotions, sessions, strategies, micro patterns, and chronological daily growth
  const mistakeCounts: Record<string, { count: number; netImpact: number }> = {};
  const sessionStats: Record<string, { count: number; wins: number; netProfit: number }> = {};
  const strategyStats: Record<
    string,
    { count: number; wins: number; netProfit: number; rSum: number; rCount: number }
  > = {};
  const dailyBucketMap = new Map<
    string,
    {
      date: string;
      trades: number;
      wins: number;
      losses: number;
      breakeven: number;
      grossProfit: number;
      commission: number;
      swap: number;
      netProfit: number;
      hitTP: number;
      hitSL: number;
      manualClose: number;
    }
  >();

  let profitBeforeToday = 0;
  let todayNetProfit = 0;
  let todayClosedCount = 0;
  let todayWins = 0;
  let todayLosses = 0;
  let yesterdayNetProfit = 0;
  let yesterdayClosedCount = 0;

  let totalHitTP = 0;
  let totalHitSL = 0;
  let totalManualProfit = 0;
  let totalManualLoss = 0;
  let totalEarlyManualProfit = 0;
  let totalInvertedRR = 0;
  let totalOverRisk = 0;
  let totalNoSl = 0;
  let disciplineSum = 0;
  let disciplineCount = 0;
  let checklistChecked = 0;
  let checklistPassedCount = 0;
  let ruleChecked = 0;
  let ruleCompliantCount = 0;
  let plannedRRSumAll = 0;
  let plannedRRCountAll = 0;
  let realizedRSumAll = 0;
  let realizedRCountAll = 0;

  for (const rec of allMicroClosedChrono) {
    const net = rec.netProfit;
    const dKey = rec.date;

    if (dKey === todayDateKey) {
      todayNetProfit += net;
      todayClosedCount += 1;
      if (rec.outcome === 'WIN') todayWins += 1;
      else if (rec.outcome === 'LOSS') todayLosses += 1;
    } else if (dKey && dKey < todayDateKey) {
      profitBeforeToday += net;
    }

    if (dKey === yesterdayDateKey) {
      yesterdayNetProfit += net;
      yesterdayClosedCount += 1;
    }

    if (rec.closeType === 'HIT_TP') totalHitTP += 1;
    else if (rec.closeType === 'HIT_SL') totalHitSL += 1;
    else if (rec.closeType === 'MANUAL_PROFIT') totalManualProfit += 1;
    else if (rec.closeType === 'MANUAL_LOSS') totalManualLoss += 1;

    if (rec.microAuditFlags.some((f) => f.startsWith('EARLY_MANUAL_PROFIT'))) totalEarlyManualProfit += 1;
    if (rec.microAuditFlags.some((f) => f.startsWith('INVERTED_RR'))) totalInvertedRR += 1;
    if (rec.microAuditFlags.some((f) => f.startsWith('OVER_RISK'))) totalOverRisk += 1;
    if (rec.microAuditFlags.includes('NO_SL')) totalNoSl += 1;

    if (rec.disciplineRating !== null) {
      disciplineSum += rec.disciplineRating;
      disciplineCount += 1;
    }
    if (rec.checklistPassed !== null) {
      checklistChecked += 1;
      if (rec.checklistPassed) checklistPassedCount += 1;
    }
    if (rec.ruleCompliant !== null) {
      ruleChecked += 1;
      if (rec.ruleCompliant) ruleCompliantCount += 1;
    }
    if (rec.plannedRR !== null) {
      plannedRRSumAll += rec.plannedRR;
      plannedRRCountAll += 1;
    }
    if (rec.realizedR !== null) {
      realizedRSumAll += rec.realizedR;
      realizedRCountAll += 1;
    }

    if (dKey) {
      const existing = dailyBucketMap.get(dKey) || {
        date: dKey,
        trades: 0,
        wins: 0,
        losses: 0,
        breakeven: 0,
        grossProfit: 0,
        commission: 0,
        swap: 0,
        netProfit: 0,
        hitTP: 0,
        hitSL: 0,
        manualClose: 0,
      };
      existing.trades += 1;
      if (rec.outcome === 'WIN') existing.wins += 1;
      else if (rec.outcome === 'LOSS') existing.losses += 1;
      else existing.breakeven += 1;
      existing.grossProfit += rec.grossProfit;
      existing.commission += rec.commission;
      existing.swap += rec.swap;
      existing.netProfit += net;
      if (rec.closeType === 'HIT_TP') existing.hitTP += 1;
      else if (rec.closeType === 'HIT_SL') existing.hitSL += 1;
      else if (
        rec.closeType === 'MANUAL_PROFIT' ||
        rec.closeType === 'MANUAL_LOSS' ||
        rec.closeType === 'MANUAL_BE'
      ) {
        existing.manualClose += 1;
      }
      dailyBucketMap.set(dKey, existing);
    }

    const sess = rec.session || 'Other';
    if (!sessionStats[sess]) sessionStats[sess] = { count: 0, wins: 0, netProfit: 0 };
    sessionStats[sess].count += 1;
    if (rec.outcome === 'WIN') sessionStats[sess].wins += 1;
    sessionStats[sess].netProfit += net;

    const strat = rec.strategy;
    if (!strategyStats[strat]) {
      strategyStats[strat] = { count: 0, wins: 0, netProfit: 0, rSum: 0, rCount: 0 };
    }
    strategyStats[strat].count += 1;
    if (rec.outcome === 'WIN') strategyStats[strat].wins += 1;
    strategyStats[strat].netProfit += net;
    if (rec.realizedR !== null) {
      strategyStats[strat].rSum += rec.realizedR;
      strategyStats[strat].rCount += 1;
    }

    for (const m of rec.mistakeTags) {
      if (!mistakeCounts[m]) mistakeCounts[m] = { count: 0, netImpact: 0 };
      mistakeCounts[m].count += 1;
      mistakeCounts[m].netImpact += net;
    }
  }

  // Build chronological cumulative daily growth timeline (last 30 active trading days)
  const sortedDayKeys = Array.from(dailyBucketMap.keys()).sort();
  let runningEq = startingBal;
  const allDailyGrowth = sortedDayKeys.map((date) => {
    const b = dailyBucketMap.get(date)!;
    const prevEq = runningEq;
    runningEq = prevEq + b.netProfit;
    const dayCumulativeDeltaPct = startingBal > 0 ? (b.netProfit / startingBal) * 100 : 0;
    const dayCompoundedPct = prevEq > 0 ? (b.netProfit / prevEq) * 100 : 0;
    const cumulativeGainPct = startingBal > 0 ? ((runningEq - startingBal) / startingBal) * 100 : 0;
    return {
      date,
      dayName: getLocalDayNameFromYmd(date),
      trades: b.trades,
      wins: b.wins,
      losses: b.losses,
      breakeven: b.breakeven,
      grossProfit: Number(b.grossProfit.toFixed(2)),
      commission: Number(b.commission.toFixed(2)),
      swap: Number(b.swap.toFixed(2)),
      netProfit: Number(b.netProfit.toFixed(2)),
      dayGainDeltaPct: Number(dayCumulativeDeltaPct.toFixed(2)),
      dayCompoundedReturnPct: Number(dayCompoundedPct.toFixed(2)),
      endEquity: Number(runningEq.toFixed(2)),
      cumulativeGainPct: Number(cumulativeGainPct.toFixed(2)),
      hitTP: b.hitTP,
      hitSL: b.hitSL,
      manualClose: b.manualClose,
    };
  });

  const dailyHistory = allDailyGrowth.slice(-30);
  const last14TradingDays = allDailyGrowth.slice(-14);
  const lastActiveDayBeforeToday =
    [...allDailyGrowth].reverse().find((d) => d.date < todayDateKey) || null;
  const latestActiveDay = allDailyGrowth.length > 0 ? allDailyGrowth[allDailyGrowth.length - 1] : null;

  // Smart Conversational Period Resolver: scans current message FIRST, then last 4 history turns!
  let focusedPeriod: ReturnType<typeof summarizeMicroPeriod> | null = null;
  const currentMsgDate = options?.message ? parseDateRangeFromText(options.message, nowDate) : null;
  if (currentMsgDate) {
    focusedPeriod = summarizeMicroPeriod(
      currentMsgDate.label,
      currentMsgDate.startDate,
      currentMsgDate.endDate,
      'current_message',
      allMicroClosedChrono,
      startingBal
    );
  } else if (Array.isArray(options?.history) && options.history.length > 0) {
    const recentTurns = options.history.slice(-4).reverse();
    for (const turn of recentTurns) {
      const histDate = parseDateRangeFromText(turn.content, nowDate);
      if (histDate) {
        focusedPeriod = summarizeMicroPeriod(
          histDate.label,
          histDate.startDate,
          histDate.endDate,
          'conversation_history',
          allMicroClosedChrono,
          startingBal
        );
        break;
      }
    }
  }
  if (!focusedPeriod && latestActiveDay) {
    focusedPeriod = summarizeMicroPeriod(
      `Hari Trading Aktif Terakhir (${formatReadableIndonesianDate(latestActiveDay.date)})`,
      latestActiveDay.date,
      latestActiveDay.date,
      'default_latest_active_day',
      allMicroClosedChrono,
      startingBal
    );
  }

  const beforeTodayEquity = Number((startingBal + profitBeforeToday).toFixed(2));
  const beforeTodayCumulativeGainPct =
    startingBal > 0 ? Number(((profitBeforeToday / startingBal) * 100).toFixed(2)) : 0;
  const currentTotalGainPct = Number(metrics.totalGainPercent.toFixed(2));
  const todayCumulativeGainDeltaPct = Number(
    (currentTotalGainPct - beforeTodayCumulativeGainPct).toFixed(2)
  );
  const todayCompoundedReturnPct =
    beforeTodayEquity > 0 ? Number(((todayNetProfit / beforeTodayEquity) * 100).toFixed(2)) : 0;
  const yesterdayCumulativeGainDeltaPct =
    startingBal > 0 ? Number(((yesterdayNetProfit / startingBal) * 100).toFixed(2)) : 0;

  const growthComparison = {
    todayDate: todayDateKey,
    yesterdayDate: yesterdayDateKey,
    startingBalance: Number(startingBal.toFixed(2)),
    beforeTodayEquity,
    beforeTodayCumulativeGainPct,
    currentEquity: Number(metrics.currentEquity.toFixed(2)),
    currentTotalGainPct,
    todayClosedTradesCount: todayClosedCount,
    todayWins,
    todayLosses,
    todayNetProfit: Number(todayNetProfit.toFixed(2)),
    todayCumulativeGainDeltaPct,
    todayCompoundedReturnPct,
    yesterdayClosedTradesCount: yesterdayClosedCount,
    yesterdayNetProfit: Number(yesterdayNetProfit.toFixed(2)),
    yesterdayCumulativeGainDeltaPct,
    lastActiveDayBeforeToday,
  };

  const microPatternsSummary = {
    totalClosedAnalyzed: allMicroClosedChrono.length,
    hitTPCount: totalHitTP,
    hitSLCount: totalHitSL,
    manualProfitCount: totalManualProfit,
    manualLossCount: totalManualLoss,
    earlyManualProfitCount: totalEarlyManualProfit,
    invertedPlannedRRCount: totalInvertedRR,
    overRiskCount: totalOverRisk,
    noStopLossCount: totalNoSl,
    avgPlannedRR: plannedRRCountAll > 0 ? Number((plannedRRSumAll / plannedRRCountAll).toFixed(2)) : null,
    avgRealizedR: realizedRCountAll > 0 ? Number((realizedRSumAll / realizedRCountAll).toFixed(2)) : null,
    avgDisciplineRating:
      disciplineCount > 0 ? Number((disciplineSum / disciplineCount).toFixed(2)) : null,
    checklistPassRatePct:
      checklistChecked > 0 ? Number(((checklistPassedCount / checklistChecked) * 100).toFixed(1)) : null,
    ruleComplianceRatePct:
      ruleChecked > 0 ? Number(((ruleCompliantCount / ruleChecked) * 100).toFixed(1)) : null,
  };

  const topMistakes = Object.entries(mistakeCounts)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 6)
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

  const strategyBreakdown = Object.entries(strategyStats)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8)
    .map(([strategy, st]) => ({
      strategy,
      trades: st.count,
      winRatePct: st.count > 0 ? Number(((st.wins / st.count) * 100).toFixed(1)) : 0,
      netProfit: Number(st.netProfit.toFixed(2)),
      avgR: st.rCount > 0 ? Number((st.rSum / st.rCount).toFixed(2)) : null,
    }));

  const playbooksCompact = Array.isArray(settings.playbooks)
    ? settings.playbooks.slice(0, 8).map((p) => ({
        name: p.name,
        session: p.session,
        minRR: p.minRR,
        summary: (p.summary || '').slice(0, 120),
      }))
    : [];

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

  // 3. Dedicated Cycle & Confluence Snapshot (strictly separate from Trade News & Fundamental Gold!)
  const astroCycle = calculateAstronacciCycle(nowDate);
  const seasonalityStats = computeMonthlySeasonalityStats(nowDate.getMonth(), xauQuote?.price ?? null);
  const sessionConfigWib = loadStoredSessionHoursWib();
  const activeSessionCode = getSessionWIB(Math.floor(nowDate.getTime() / 1000), sessionConfigWib);
  const cycleConfluenceCompact = {
    moduleName: 'Cycle & Confluence (Siklus & Confluence)',
    activeTradingMode: loadStoredTradingConfluenceMode(),
    manualAmdOverride: loadStoredManualAmdOverride(),
    activeSessionWib: {
      code: activeSessionCode,
      label: getSessionLabelId(activeSessionCode),
    },
    astronacciCycle: {
      lunarPhase: astroCycle.lunarPhase,
      lunarPhaseLabel: astroCycle.lunarPhaseLabelId,
      lunarAgeDays: Number(astroCycle.lunarAgeDays.toFixed(1)),
      illuminationPct: astroCycle.illuminationPct,
      nextLunarEvent: astroCycle.nextLunarEvent,
      daysUntilNextLunarEvent: Number(astroCycle.daysUntilNextLunarEvent.toFixed(1)),
      isSolarCardinalMonth: astroCycle.isSolarCardinalMonth,
      solarCardinalLabel: astroCycle.solarCardinalLabelId,
      isFibTimeCluster: astroCycle.isFibTimeCluster,
      astroScore: astroCycle.astroScore,
      summary: astroCycle.summaryId,
    },
    monthlySeasonalityXauUsd: {
      month: seasonalityStats.monthFullName,
      historicalWinRatePct: seasonalityStats.winRatePct,
      historicalAvgReturnPct: seasonalityStats.avgReturnPct,
      liveMonthReturnPct: seasonalityStats.liveMomPct,
      overextensionDirection: seasonalityStats.overextensionDirection,
    },
    latestSmcSignal: smcSignal,
  };

  // Lightweight peripheral market alert badge so Alfred knows whether there is impactful news today
  // WITHOUT drowning pure journal conversations in full news payloads!
  const primaryImpact = String(macroCompact?.primaryEvent?.impact || macroCompact?.impactLevel || '').toUpperCase();
  const hasHighImpactNews = Boolean(
    macroCompact &&
      (primaryImpact === 'HIGH' ||
        primaryImpact === 'EXTREME' ||
        macroCompact.dualHorizon?.movementType === 'TWO_WAY_SWEEP_FIRST' ||
        macroCompact.dualHorizon?.hasSpeechEvent)
  );
  const marketAlertBadge = {
    hasHighImpactNews,
    primaryEventTitle: macroCompact?.primaryEvent?.title || null,
    primaryEventDate: macroCompact?.primaryEvent?.date || null,
    primaryEventImpact: macroCompact?.primaryEvent?.impact || macroCompact?.impactLevel || null,
    tradeNewsBias: macroCompact?.dominantBias || null,
    tradeNewsMovementType: macroCompact?.dualHorizon?.movementType || null,
    fundamentalGoldBias: fundamentalCompact?.overallBias || null,
    cycleActiveSession: cycleConfluenceCompact.activeSessionWib.label,
    cycleLunarPhase: cycleConfluenceCompact.astronacciCycle.lunarPhaseLabel,
    xauSpotPrice: xauQuote?.price ?? null,
  };

  const context: Record<string, unknown> = {
    runtime: {
      capturedAtUtc: nowDate.toISOString(),
      localClock,
      isOfflineMode,
      isNavigatorOnline,
      currency: settings.currency,
      currencySymbol: settings.currencySymbol,
    },
    liveMarketQuote,
    marketAlertBadge,
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
        winRateExcludingBEPct: Number(metrics.winRateExcludingBE.toFixed(1)),
        profitFactor: metrics.isProfitFactorInfinite
          ? 'INF'
          : Number(metrics.profitFactor.toFixed(2)),
        expectancy: Number(metrics.expectancy.toFixed(2)),
        averageWin: Number(metrics.averageWin.toFixed(2)),
        averageLoss: Number(metrics.averageLoss.toFixed(2)),
        totalNetProfit: Number(metrics.totalNetProfit.toFixed(2)),
        totalGrossProfit: Number(metrics.totalGrossProfit.toFixed(2)),
        totalGrossLoss: Number(metrics.totalGrossLoss.toFixed(2)),
        totalCommission: Number(metrics.totalCommission.toFixed(2)),
        totalSwap: Number(metrics.totalSwap.toFixed(2)),
        currentEquity: Number(metrics.currentEquity.toFixed(2)),
        startingBalance: Number(metrics.startingBalance.toFixed(2)),
        totalGainPercent: Number(metrics.totalGainPercent.toFixed(2)),
        averageRiskReward: Number(metrics.averageRiskReward.toFixed(2)),
        maxDrawdownPercent: Number(metrics.maxDrawdownPercent.toFixed(2)),
        currentStreak: metrics.currentStreak,
        maxConsecutiveWins: metrics.consecutiveWinsMax,
        maxConsecutiveLosses: metrics.consecutiveLossesMax,
        dailyLossToday: Number(metrics.dailyLossToday.toFixed(2)),
        isDailyLossExceeded: metrics.isDailyLossExceeded,
        isAccountInCriticalDrawdown: metrics.isAccountInCriticalDrawdown,
      },
      focusedPeriod,
      growthComparison,
      microPatternsSummary,
      dailyHistory,
      last14TradingDays,
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
      strategyBreakdown,
      sessionBreakdown,
      topMistakes,
      playbooks: playbooksCompact,
    },
    macroNews: macroCompact,
    fundamentalGold: fundamentalCompact,
    cycleConfluence: cycleConfluenceCompact,
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
    /\b(xau|xauusd|gold|emas|dxy|yield|us10y|us02y|usoil|oil|forex|pair|market|pasar|chart|candle|harga|price|spot|news|berita|makro|macro|fundamental|fomc|fed|fedwatch|cpi|ppi|nfp|pmi|powell|polymarket|cycle|confluence|smc|heatmap|spike|sweep|whipsaw|buy|sell|long|short|entry|exit|sl|tp|stoploss|takeprofit|jurnal|journal|trade|trading|posisi|open|planned|lot|risiko|risk|drawdown|dd|win\s?rate|profit|loss|rugi|equity|saldo|balance|akun|playbook|guardrail|psikologi|emosi|fomo|sesi|session|london|new york|asia|evaluasi|audit|rekap|grow|growth|pertumbuhan|selisih|persen|persentase|modal|compound|compounding|monte\s?carlo|simulasi|simulation|expectancy|profit\s?factor|r[\s-]?multiple|kalkulator|calculator|radar|ocr|scan|vela|backtest|replay|strategi|strategy|streak|komisi|commission|swap|pip|pips|kurang\s+paham|belum\s+paham|gak\s+paham|ga\s+paham|bingung|jelasin|jelaskan|maksud|maksudnya|simpel|sederhana|contoh)\b/i;
  const hasTradingTopic = tradingKeywords.test(q);

  const hasPriceCue =
    /\b(harga|price|spot|level|berapa|brp|skrg|sekarang|saat ini|di angka|dimana|di mana|running|update harga|cek harga)\b/i.test(
      q
    );
  const hasAssetCue = /\b(xau|xauusd|gold|emas|dxy|us10y|us02y|usoil|oil|btc|eurusd)\b/i.test(q);
  const asksDeepAnalysis =
    /\b(kenapa|mengapa|analisis|analisa|fundamental|berita|news|jurnal|journal|spike|sweep|prediksi|arah|kemana|ke mana|buy|sell|entry|posisi|risiko|risk|drawdown|win\s?rate|fomc|cpi|nfp|evaluasi|audit|bagusnya|ambil|grow|growth|selisih|compound|monte\s?carlo|simulasi)\b/i.test(
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

  // Only run background market/news sync when the question genuinely asks about market outlook/news/live XAU —
  // NOT when the user is analyzing their own journal trades (even if those trades are on XAU/gold/buy/sell)!
  const explicitJournalCue =
    /\b(jurnal|journal|trade\s+(?:saya|ku|aku|kemarin|kemaren|hari\s+ini|tgl|tanggal|minggu|bulan)|evaluasi\s+trade|rekap|total\s+(?:profit|loss|grow|growth|trade)|selisih|hit\s*tp|hit\s*sl|manual\s*close|rasio|r[\s-]?multiple|win\s?rate|profit\s?factor|drawdown|monte\s?carlo|compound|compounding|kalkulator|playbook|cara\s+pakai|cara\s+menggunakan|fitur|menu)\b/i.test(
      q
    );
  const explicitMarketOutlookCue =
    /\b(news|berita|makro|macro|fundamental|fomc|fed|fedwatch|cpi|ppi|nfp|pmi|dxy|yield|us10y|us02y|oil|usoil|polymarket|cycle|siklus|confluence|astronacci|lunar|seasonality|smc|heatmap|spike|sweep|whipsaw|arah\s+(?:emas|gold|xau|market|pasar)|(?:emas|gold|xau)\s+(?:mau\s+)?(?:kemana|ke\s+mana|naik|turun|hari\s+ini)|market\s+hari\s+ini|harga\s+(?:emas|gold|xau)|spot|bullish|bearish)\b/i.test(
      q
    );
  const asksMacroOrMarket = explicitMarketOutlookCue && (!explicitJournalCue || /\b(news|berita|fundamental|fomc|cpi|nfp|cycle|siklus|confluence|arah|kemana|ke\s+mana)\b/i.test(q));

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

  const { context } = buildAgentDeskContext(params.trades, params.settings, params.language, {
    message: params.message,
  });
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
  const asksMonteCarlo = /\b(monte\s?carlo|simulasi\s+trade)\b/i.test(q);
  const asksCompounding = /\b(compound|compounding|gulung\s+modal|growth\s+plan)\b/i.test(q);
  const asksGrowthDelta =
    /\b(grow|growth|pertumbuhan|selisih|beda|perbandingan)\b/i.test(q) &&
    !/\b(news|berita|fomc|cpi|nfp|dxy|harga|price|spot)\b/i.test(q);
  const explicitMarketNewsCue =
    /\b(news|berita|makro|macro|fundamental|spike|sweep|arah|fomc|cpi|nfp|dxy|bearish|bullish|market|pasar|kemana|ke mana|cycle|siklus|confluence|astronacci|seasonality|smc)\b/i.test(
      q
    );
  const asksJournal =
    asksGrowthDelta ||
    /\b(jurnal|journal|trade|win|profit|loss|rugi|drawdown|lot|risiko|risk|posisi|open|planned|evaluasi|kesalahan|sesi|equity|saldo|grow|growth|selisih|persen|strategi|kemarin|kemaren|tgl|tanggal|hit\s*tp|hit\s*sl|manual|rasio|rr|disiplin)\b/i.test(
      q
    );
  const asksMacro =
    explicitMarketNewsCue ||
    (/\b(gold|emas|xau|xauusd|buy|sell|ambil)\b/i.test(q) && !asksJournal);

  // Instant accurate local answers for App Concepts (Monte Carlo / Compounding) when truly offline
  if (asksMonteCarlo && !asksMacro) {
    const simpleMode = /\b(kurang\s+paham|bingung|simpel|sederhana|contoh)\b/i.test(q);
    const mcReply = isEn
      ? simpleMode
        ? `Think of **Monte Carlo** like tossing a weighted coin 1,000 times in different orders. Even with a 60% win rate, sometimes you hit 4 losses in a row. Monte Carlo shuffles your trade outcomes thousands of times in TradeVault so you can see the realistic best case (P95), middle outcome (P50), and worst streak (P5) before risking real money.`
        : `**Monte Carlo Simulation** in TradeVault's Risk & Simulation tab runs 1,000–10,000 randomized trade sequences using your Win Rate, Risk-Reward, and Risk %. It reveals your Median outcome (P50), Best Case (P95), Worst Case (P5), Profit Probability, and Average Max Drawdown so you know if your account can survive unlucky losing streaks.`
      : simpleMode
      ? `Bayangin **Monte Carlo** kayak uji coba lempar koin ribuan kali dengan urutan acak. Misalnya strategimu punya Win Rate 60%, kan tetap mungkin tuh apes kena kalah 4x beruntun dulu baru menang. Nah, Monte Carlo mengacak urutan menang-kalahmu sampai 1.000–10.000 skenario supaya kamu tahu: kalau lagi hoki (P95) jadi berapa, kalau standar (P50) berapa, dan kalau lagi apes banget (P5) akunmu masih kuat nahan drawdown atau nggak.`
      : `**Simulasi Monte Carlo** di menu Risiko & Simulasi TradeVault itu alat "uji stres" strategi kamu dengan mengacak urutan menang-kalah sebanyak 1.000 sampai 10.000 kali berdasarkan Win Rate, RR, dan Risiko %. Hasilnya nunjukin saldo tengah yang paling realistis (**Median P50**), skenario terbaik (**P95**), skenario terburuk saat kena losing streak (**P5**), peluang profit, dan rata-rata Max Drawdown. Kalau masih terasa ribet, bilang aja ya — nanti aku jelasin pakai analogi yang lebih simpel lagi!`;

    return {
      content: mcReply,
      mode: 'OFFLINE_LOCAL',
      routeType: 'FULL_OFFICE',
      workflowTrace: [],
      revisionTriggered: false,
      activeProviders: ['Offline Local'],
      totalLatencyMs: Math.max(1, Date.now() - startedAt),
    };
  }

  if (asksCompounding && !asksMacro) {
    const compReply = isEn
      ? `In TradeVault's **Compounding Calculator**, there are two modes: **Compounding** (profits stay in your balance so each period's % grows on a larger equity: \`Final = Capital × (1 + r)^n\`) and **Fixed / Withdrawn** (you withdraw profits each period, so profit stays flat based on initial capital). Tell me your starting capital, % target per period, and number of days/periods if you want me to calculate a scenario!`
      : `Di fitur **Kalkulator Compounding** TradeVault ada 2 mode: **Compounding (Gulung Modal)** di mana profit dibiarkan di akun sehingga target % berikutnya dihitung dari saldo yang makin besar (\`Modal × (1 + r)^n\`), dan **Profit Tetap / Ditarik** di mana profit tiap periode ditarik keluar sehingga pertumbuhan selalu dihitung dari modal awal. Kalau mau aku hitungkan skenario modal + % per hari + jumlah harinya, sebutin aja angkanya ya!`;
    return {
      content: compReply,
      mode: 'OFFLINE_LOCAL',
      routeType: 'FULL_OFFICE',
      workflowTrace: [],
      revisionTriggered: false,
      activeProviders: ['Offline Local'],
      totalLatencyMs: Math.max(1, Date.now() - startedAt),
    };
  }

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
    const gc = journal.growthComparison || null;
    const fp = journal.focusedPeriod || null;
    if (asksGrowthDelta && gc) {
      const signDelta = gc.todayCumulativeGainDeltaPct >= 0 ? '+' : '';
      const signComp = gc.todayCompoundedReturnPct >= 0 ? '+' : '';
      const signPnl = gc.todayNetProfit >= 0 ? '+' : '';
      paragraphs.push(
        isEn
          ? `Comparing your cumulative growth up to yesterday (**${gc.beforeTodayCumulativeGainPct}%**, equity ${sym}${gc.beforeTodayEquity}) vs today (**${gc.currentTotalGainPct}%**, equity ${sym}${gc.currentEquity}): today's **${gc.todayClosedTradesCount}** closed trade(s) (${signPnl}${sym}${gc.todayNetProfit}) changed your total cumulative growth by **${signDelta}${gc.todayCumulativeGainDeltaPct}%** (or **${signComp}${gc.todayCompoundedReturnPct}%** daily return relative to yesterday's closing equity).`
          : `Perbandingan total growth jurnalmu sampai kemarin (**${gc.beforeTodayCumulativeGainPct}%**, ekuitas ${sym}${gc.beforeTodayEquity}) dengan hari ini (**${gc.currentTotalGainPct}%**, ekuitas ${sym}${gc.currentEquity}): dari **${gc.todayClosedTradesCount}** trade selesai hari ini (${signPnl}${sym}${gc.todayNetProfit}), **selisih total persen growth-nya adalah ${signDelta}${gc.todayCumulativeGainDeltaPct}%** (atau **${signComp}${gc.todayCompoundedReturnPct}%** jika dihitung sebagai return harian terhadap ekuitas penutupan kemarin).`
      );
    } else if (fp && fp.matchedFrom === 'current_message') {
      const signNet = fp.totalNetProfit >= 0 ? '+' : '';
      const ct = fp.closeTypeCounts || {};
      const manualTotal = (ct.manualProfit ?? 0) + (ct.manualLoss ?? 0) + (ct.manualBE ?? 0);
      paragraphs.push(
        fp.tradesCount === 0
          ? isEn
            ? `For **${fp.label}** (${fp.startDate}${fp.endDate !== fp.startDate ? ` to ${fp.endDate}` : ''}), there are **0 closed trades** logged in your journal.`
            : `Untuk periode **${fp.label}** (${fp.startDate}${fp.endDate !== fp.startDate ? ` s/d ${fp.endDate}` : ''}), belum ada trade selesai yang tercatat di jurnalmu.`
          : isEn
          ? `For **${fp.label}**: **${fp.tradesCount}** closed trade(s) (${fp.wins}W / ${fp.losses}L / ${fp.breakeven}BE, Win Rate **${fp.winRatePct}%**), Net PnL **${signNet}${sym}${fp.totalNetProfit}** (Gross ${sym}${fp.totalGrossProfit}, Comm ${sym}${fp.totalCommission}, Swap ${sym}${fp.totalSwap}). Breakdown: Hit TP ${ct.hitTP ?? 0}, Hit SL ${ct.hitSL ?? 0}, Manual Close ${manualTotal}.`
          : `Rekap **${fp.label}**: ada **${fp.tradesCount}** trade selesai (${fp.wins} menang, ${fp.losses} kalah, ${fp.breakeven} BE · Win Rate **${fp.winRatePct}%**), total Net PnL **${signNet}${sym}${fp.totalNetProfit}** (Gross ${sym}${fp.totalGrossProfit}, Komisi ${sym}${fp.totalCommission}, Swap ${sym}${fp.totalSwap}). Detail eksekusi: Hit TP ${ct.hitTP ?? 0}x, Hit SL ${ct.hitSL ?? 0}x, Manual Close ${manualTotal}x.`
      );
    } else {
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
          ? `On your journal: **${jSum.closedTradesCount ?? 0}** closed trades, Win Rate **${jSum.winRatePct ?? 0}%**, Profit Factor **${jSum.profitFactor ?? 0}**, Net PnL **${sym}${jSum.totalNetProfit ?? 0}** (Total Growth ${jSum.totalGainPercent ?? 0}%, Max DD ${jSum.maxDrawdownPercent ?? 0}%).${openNote}${mistakeNote}${riskNote}`
          : `Untuk jurnalmu, dari **${jSum.closedTradesCount ?? 0}** trade selesai, Win Rate ada di **${jSum.winRatePct ?? 0}%** dengan Profit Factor **${jSum.profitFactor ?? 0}** dan Net PnL **${sym}${jSum.totalNetProfit ?? 0}** (Total Growth ${jSum.totalGainPercent ?? 0}%, Max DD ${jSum.maxDrawdownPercent ?? 0}%).${openNote}${mistakeNote}${riskNote}`
      );
    }
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

  const { context } = buildAgentDeskContext(params.trades, params.settings, params.language, {
    message: params.message,
    history: compactHistory,
  });

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
