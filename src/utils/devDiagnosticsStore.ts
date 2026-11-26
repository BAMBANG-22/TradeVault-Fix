/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Developer Console Utilities:
 * 1. Silent App Error Recorder (localStorage ring buffer, max 25 events)
 * 2. Safe Cleaning Service (purges stale SW/caches/market snapshots without touching user journal)
 * 3. SHA-256 Developer Passcode Gate (with pure-JS fallback for HTTP/WebView)
 * 4. Optional AI QA Diagnostics client (/api/agent-desk/qa-diagnose)
 */

import {
  getApiEndpointCandidates,
  isNewsCycleOfflineMode,
  nativeAwarePostJson,
} from './apiConfig';

export type DiagnosticEventSource =
  | 'RUNTIME'
  | 'PROMISE'
  | 'API'
  | 'AI_DESK'
  | 'NEWS'
  | 'CHART'
  | 'OCR'
  | 'SYNC';

export interface AppDiagnosticEvent {
  id: string;
  timestamp: string;
  source: DiagnosticEventSource;
  message: string;
  detail?: string;
}

export interface CleaningServiceReport {
  ranAtIso: string;
  unregisteredServiceWorkers: number;
  deletedCacheBuckets: number;
  clearedLocalKeys: string[];
  preservedJournalSafe: boolean;
  summaryId: string;
  summaryEn: string;
}

export interface AiQaDiagnosisClientResult {
  healthGrade: 'HEALTHY' | 'WARNING' | 'CRITICAL';
  summary: string;
  rootCauses: string[];
  recommendedActions: string[];
  provider: string;
  model: string;
  latencyMs: number;
}

const DEV_ERROR_LOG_STORAGE_KEY = 'tradevault_dev_error_log_v1';
const MAX_ERROR_EVENTS = 25;

// Salted SHA-256 digest for the developer passcode (never store plaintext code in bundle)
const DEV_GATE_SALT = 'vlo-dev-gate::';
const DEV_GATE_EXPECTED_DIGEST =
  'db9672a4de44b5cd2453c863c5e776e24694f154041d7e895c5d6e1d5b03a8fb';

let globalRecorderInstalled = false;

/**
 * Pure-JS SHA-256 fallback for environments without crypto.subtle (e.g. insecure HTTP dev contexts).
 */
function sha256PureJsHex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  const W = new Uint32Array(64);
  const rotr = (n: number, x: number) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      W[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(7, W[i - 15]) ^ rotr(18, W[i - 15]) ^ (W[i - 15] >>> 3);
      const s1 = rotr(17, W[i - 2]) ^ rotr(19, W[i - 2]) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }

    let a = H[0];
    let b = H[1];
    let c = H[2];
    let d = H[3];
    let e = H[4];
    let f = H[5];
    let g = H[6];
    let h = H[7];

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  return Array.from(H)
    .map((n) => n.toString(16).padStart(8, '0'))
    .join('');
}

export async function verifyDeveloperPasscode(rawInput: string): Promise<boolean> {
  const normalized = rawInput.trim();
  if (!normalized || normalized.length > 32) return false;
  const salted = `${DEV_GATE_SALT}${normalized}`;
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
      const encoded = new TextEncoder().encode(salted);
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
      const hex = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      return hex === DEV_GATE_EXPECTED_DIGEST;
    }
  } catch {
    // Fallback below
  }
  return sha256PureJsHex(salted) === DEV_GATE_EXPECTED_DIGEST;
}

export function getAppDiagnosticEvents(): AppDiagnosticEvent[] {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(DEV_ERROR_LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_ERROR_EVENTS) : [];
  } catch {
    return [];
  }
}

export function recordAppDiagnosticEvent(
  source: DiagnosticEventSource,
  message: string,
  detail?: string
): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  try {
    const cleanMsg = String(message || 'Unknown error').trim().slice(0, 220);
    if (!cleanMsg) return;
    // Ignore benign HMR / ResizeObserver noise
    if (/ResizeObserver loop|WebSocket|hmr/i.test(cleanMsg)) return;

    const current = getAppDiagnosticEvents();
    const entry: AppDiagnosticEvent = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      source,
      message: cleanMsg,
      detail: detail ? String(detail).trim().slice(0, 320) : undefined,
    };

    const next = [entry, ...current].slice(0, MAX_ERROR_EVENTS);
    window.localStorage.setItem(DEV_ERROR_LOG_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearAppDiagnosticEvents(): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  try {
    window.localStorage.removeItem(DEV_ERROR_LOG_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export function installGlobalErrorRecorder(): void {
  if (typeof window === 'undefined' || globalRecorderInstalled) return;
  globalRecorderInstalled = true;

  window.addEventListener('error', (event) => {
    const msg = event?.message || (event?.error ? String(event.error) : 'Uncaught runtime error');
    const detail = event?.filename ? `${event.filename}:${event.lineno || 0}` : undefined;
    recordAppDiagnosticEvent('RUNTIME', msg, detail);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    const msg =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
        ? reason
        : 'Unhandled promise rejection';
    recordAppDiagnosticEvent('PROMISE', msg);
  });
}

/**
 * Cleaning Service (Auto-Repair Aman):
 * Purges ONLY stale caches, service workers, and replaceable market snapshots.
 * STRICTLY preserves user trades, settings, accounts, playbooks, notifications, and chat history/theme.
 */
const SAFE_PURGE_KEY_PATTERNS: RegExp[] = [
  /^vela_candles_cache_/i,
  /^vela_chart_cache/i,
  /^tradevault_macro_news_cache/i,
  /^tradevault_fundamental_gold_cache/i,
  /^tradevault_cme_fedwatch_cache/i,
  /^tradevault_polymarket_macro_cache/i,
  /^tradevault_cftc_cot_cache/i,
  /^tradevault_mt5_ocr_diagnostics/i,
  /^vlo_sw_purged_change_code/i,
  /^tradevault_dev_error_log_v1$/i,
];

export async function runSafeCleaningService(): Promise<CleaningServiceReport> {
  const ranAtIso = new Date().toISOString();
  let unregisteredServiceWorkers = 0;
  let deletedCacheBuckets = 0;
  const clearedLocalKeys: string[] = [];

  // 1. Unregister stale Service Workers
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const reg of regs) {
        const ok = await reg.unregister();
        if (ok) unregisteredServiceWorkers += 1;
      }
    } catch {
      // Ignore SW errors
    }
  }

  // 2. Clear browser CacheStorage buckets (never touches localStorage journal data)
  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const names = await window.caches.keys();
      for (const name of names) {
        const ok = await window.caches.delete(name);
        if (ok) deletedCacheBuckets += 1;
      }
    } catch {
      // Ignore CacheStorage errors
    }
  }

  // 3. Remove ONLY replaceable cache keys in localStorage
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (!k) continue;
        if (SAFE_PURGE_KEY_PATTERNS.some((rx) => rx.test(k))) {
          keysToRemove.push(k);
        }
      }
      for (const k of keysToRemove) {
        window.localStorage.removeItem(k);
        clearedLocalKeys.push(k);
      }
    } catch {
      // Ignore storage access error
    }
  }

  const totalCleaned = unregisteredServiceWorkers + deletedCacheBuckets + clearedLocalKeys.length;
  return {
    ranAtIso,
    unregisteredServiceWorkers,
    deletedCacheBuckets,
    clearedLocalKeys,
    preservedJournalSafe: true,
    summaryId:
      totalCleaned > 0
        ? `Cleaning Service selesai: ${unregisteredServiceWorkers} SW dilepas, ${deletedCacheBuckets} CacheStorage dihapus, ${clearedLocalKeys.length} cache pasar dibersihkan. Data jurnal, akun, pengaturan & chat aman 100%.`
        : 'Sistem sudah bersih — tidak ada cache usang ditemukan. Data jurnal, akun & pengaturan tetap aman.',
    summaryEn:
      totalCleaned > 0
        ? `Cleaning Service done: ${unregisteredServiceWorkers} SW removed, ${deletedCacheBuckets} CacheStorage buckets cleared, ${clearedLocalKeys.length} market caches purged. Journal, accounts, settings & chat are 100% preserved.`
        : 'System is already clean — no stale caches found. Journal, accounts & settings remain untouched.',
  };
}

export async function runAiQaDiagnosticsAnalysis(params: {
  diagnosticReport: Record<string, unknown>;
  language: 'id' | 'en';
}): Promise<AiQaDiagnosisClientResult> {
  if (isNewsCycleOfflineMode() || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    throw new Error(
      params.language === 'en'
        ? 'Turn off Offline Mode and connect to the internet to run AI QA Diagnosis.'
        : 'Matikan Mode Offline dan hubungkan internet untuk menjalankan Analisa AI QA.'
    );
  }

  const candidates = getApiEndpointCandidates('/api/agent-desk/qa-diagnose');
  let lastError = '';

  for (const url of candidates) {
    const res = await nativeAwarePostJson(
      url,
      {
        language: params.language,
        diagnostics: params.diagnosticReport,
      },
      25_000
    );
    if (res.ok && res.json?.success && typeof res.json.summary === 'string') {
      return {
        healthGrade:
          res.json.healthGrade === 'CRITICAL' || res.json.healthGrade === 'WARNING'
            ? res.json.healthGrade
            : 'HEALTHY',
        summary: res.json.summary,
        rootCauses: Array.isArray(res.json.rootCauses) ? res.json.rootCauses : [],
        recommendedActions: Array.isArray(res.json.recommendedActions)
          ? res.json.recommendedActions
          : [],
        provider: String(res.json.providerUsed || res.json.provider || 'ai'),
        model: String(res.json.modelUsed || res.json.model || 'qa-analyst'),
        latencyMs: Number(res.json.latencyMs) || 0,
      };
    }
    if (res.errorMessage) {
      lastError = res.errorMessage;
    }
  }

  throw new Error(
    lastError ||
      (params.language === 'en'
        ? 'AI QA endpoint is unreachable. Ensure the latest Edge Function is deployed.'
        : 'Endpoint AI QA belum terjangkau. Pastikan Edge Function terbaru sudah di-deploy.')
  );
}
