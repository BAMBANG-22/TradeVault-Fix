/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { getSupabaseConfig, sanitizeSupabaseUrl } from './supabaseClient';

export const STANDALONE_BACKEND_URL_STORAGE_KEY = 'tradevault_standalone_backend_url_v1';
export const NEWS_CYCLE_OFFLINE_MODE_STORAGE_KEY = 'tradevault_news_cycle_offline_mode_v1';
export const NEWS_CYCLE_OFFLINE_MODE_CHANGE_EVENT = 'tradevault:news-cycle-offline-mode-change';
export const SUPABASE_EDGE_FUNCTION_SLUG = 'tradevault-api';

const SUPABASE_EDGE_SUPPORTED_PATHS = new Set([
  '/api/health',
  '/api/proxy',
  '/api/extract-trade-screenshot',
  '/api/extract-mt5-history',
  '/api/macro-news/analyze',
  '/api/macro-news/fundamental',
  '/api/agent-desk/chat',
  '/api/agent-desk/end-session',
  '/api/agent-desk/qa-diagnose',
]);

/**
 * Returns whether Offline Mode is enabled specifically for Trade News & Cycle & Confluence.
 * Scan Kilat AI (`tradeScreenshotScanner`) intentionally ignores this flag so users can still
 * scan trade screenshots daily using Gemini Hydrogen.
 */
export function isNewsCycleOfflineMode(): boolean {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return false;
  }
  try {
    return window.localStorage.getItem(NEWS_CYCLE_OFFLINE_MODE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setNewsCycleOfflineMode(enabled: boolean): boolean {
  const nextValue = Boolean(enabled);
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      window.localStorage.setItem(
        NEWS_CYCLE_OFFLINE_MODE_STORAGE_KEY,
        nextValue ? 'true' : 'false'
      );
      window.dispatchEvent(
        new CustomEvent(NEWS_CYCLE_OFFLINE_MODE_CHANGE_EVENT, { detail: { enabled: nextValue } })
      );
    } catch {
      // ignore localStorage write failure
    }
  }
  return nextValue;
}

/**
 * Normalizes a standalone backend URL (Node.js server OR Supabase Edge Function URL).
 * Strips trailing slashes and accidental `/api/*` endpoint suffixes while preserving
 * valid base paths such as `/functions/v1/tradevault-api`.
 */
export function sanitizeBackendBaseUrl(rawUrl: string | null | undefined): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let clean = rawUrl.trim().replace(/^['"]+|['"]+$/g, '');
  if (!clean) return '';

  // Reject API keys or tokens accidentally placed in VITE_API_BASE_URL
  if (/^(sb_publishable_|sb_secret_|eyJhbGci|AIza)/i.test(clean)) {
    return '';
  }

  const hasScheme = /^https?:\/\//i.test(clean);
  if (!hasScheme) {
    const isLocalHost =
      /^localhost(?::\d+)?(?:\/|$)/i.test(clean) ||
      /^127\.0\.0\.1(?::\d+)?(?:\/|$)/i.test(clean) ||
      /^10\.\d+\.\d+\.\d+(?::\d+)?(?:\/|$)/.test(clean) ||
      /^192\.168\.\d+\.\d+(?::\d+)?(?:\/|$)/.test(clean);
    clean = `${isLocalHost ? 'http' : 'https'}://${clean}`;
  }

  try {
    const parsed = new URL(clean);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    const host = parsed.hostname.toLowerCase();
    // Reject hostnames without a dot unless localhost / loopback
    if (host !== 'localhost' && host !== '127.0.0.1' && !host.includes('.')) {
      return '';
    }
    if (
      host === 'your-project-id.supabase.co' ||
      host === 'your-project.supabase.co' ||
      host === 'xxxx.supabase.co' ||
      host === 'example.supabase.co'
    ) {
      return '';
    }
    const cleanPath = parsed.pathname
      .replace(/\/api(?:\/.*)?$/i, '')
      .replace(/\/+$/, '');
    return `${parsed.origin}${cleanPath}`;
  } catch {
    return '';
  }
}

export function getEnvStandaloneBackendUrl(): string {
  try {
    if (typeof import.meta !== 'undefined' && import.meta && (import.meta as any).env) {
      const envUrl = sanitizeBackendBaseUrl((import.meta as any).env.VITE_API_BASE_URL || '');
      if (envUrl) return envUrl;
    }
  } catch {
    // ignore import.meta access failure
  }
  if (typeof process !== 'undefined' && process?.env) {
    return sanitizeBackendBaseUrl(process.env.VITE_API_BASE_URL || '');
  }
  return '';
}

export function getStoredStandaloneBackendUrl(): string {
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(STANDALONE_BACKEND_URL_STORAGE_KEY);
      if (raw) {
        return sanitizeBackendBaseUrl(raw);
      }
    } catch {
      // ignore localStorage read failure
    }
  }
  return '';
}

export const DEFAULT_DEPLOYED_SUPABASE_ORIGIN = 'https://hhotzotsdhkgymgtwfdk.supabase.co';

/**
 * Automatically derives the Supabase Edge Function endpoint URL from the active
 * Supabase project config (`https://<project>.supabase.co/functions/v1/tradevault-api`),
 * with a fallback to the project's deployed public Edge Function for Guest/Local mode on APK/Web.
 */
export function getSupabaseEdgeBackendUrl(): string {
  const cfg = getSupabaseConfig();
  const cleanOrigin = cfg.url ? sanitizeSupabaseUrl(cfg.url) : DEFAULT_DEPLOYED_SUPABASE_ORIGIN;
  if (!cleanOrigin) return `${DEFAULT_DEPLOYED_SUPABASE_ORIGIN}/functions/v1/${SUPABASE_EDGE_FUNCTION_SLUG}`;
  return `${cleanOrigin}/functions/v1/${SUPABASE_EDGE_FUNCTION_SLUG}`;
}

export function getBackendSourceInfo(): {
  url: string;
  source: 'custom' | 'env' | 'supabase-edge' | 'none';
} {
  const stored = getStoredStandaloneBackendUrl();
  if (stored) {
    return { url: stored, source: 'custom' };
  }
  const envUrl = getEnvStandaloneBackendUrl();
  if (envUrl) {
    return { url: envUrl, source: 'env' };
  }
  const edgeUrl = getSupabaseEdgeBackendUrl();
  if (edgeUrl) {
    return { url: edgeUrl, source: 'supabase-edge' };
  }
  return { url: '', source: 'none' };
}

/**
 * Resolves the active Standalone Backend URL in priority order:
 * 1. Explicit user override in localStorage (`tradevault_standalone_backend_url_v1`)
 * 2. Build-time `VITE_API_BASE_URL`
 * 3. Automatic Supabase Edge Function (`<VITE_SUPABASE_URL>/functions/v1/tradevault-api`)
 */
export function getStandaloneBackendUrl(): string {
  return getBackendSourceInfo().url;
}

export function saveStandaloneBackendUrl(url: string): string {
  const clean = sanitizeBackendBaseUrl(url);
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      if (clean) {
        window.localStorage.setItem(STANDALONE_BACKEND_URL_STORAGE_KEY, clean);
      } else {
        window.localStorage.removeItem(STANDALONE_BACKEND_URL_STORAGE_KEY);
      }
    } catch {
      // ignore localStorage write failure
    }
  }
  return clean;
}

export function clearStandaloneBackendUrl(): void {
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      window.localStorage.removeItem(STANDALONE_BACKEND_URL_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

export function isNativeAndroidOrIos(): boolean {
  try {
    return typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function isSupabaseEdgeUrl(url: string): boolean {
  if (!url) return false;
  const edgeBase = getSupabaseEdgeBackendUrl();
  if (edgeBase && url.startsWith(edgeBase)) return true;
  return /\.supabase\.co\/functions\/v1\//i.test(url);
}

/**
 * Attaches Supabase `apikey` & `Authorization: Bearer` headers automatically
 * when calling a Supabase Edge Function endpoint so both signed-in and offline
 * guest users can invoke the Edge Function seamlessly.
 */
export function buildBackendAuthHeaders(targetUrl: string): Record<string, string> {
  if (!isSupabaseEdgeUrl(targetUrl)) {
    return {};
  }
  const cfg = getSupabaseConfig();
  const anonKey = (cfg.anonKey || '').trim();
  if (!anonKey) {
    return {};
  }
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
  };
}

/**
 * Returns ordered candidate endpoint URLs for a backend API route (e.g. `/api/macro-news/analyze`).
 * - Inside native Capacitor APK: uses configured custom/env backend URL first, then automatic
 *   Supabase Edge Function URL (never wasting timeouts on `https://localhost/api/...`).
 * - On Web / Dev Server: tries custom/env backend URL first (if set), then same-origin `/api/...`,
 *   then Supabase Edge Function fallback.
 */
export function getApiEndpointCandidates(apiPath: string): string[] {
  const normalizedPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const stored = getStoredStandaloneBackendUrl();
  const envUrl = getEnvStandaloneBackendUrl();
  const edgeUrl = getSupabaseEdgeBackendUrl();
  const candidates: string[] = [];

  if (stored) {
    candidates.push(`${stored}${normalizedPath}`);
  }
  if (envUrl && envUrl !== stored) {
    candidates.push(`${envUrl}${normalizedPath}`);
  }

  if (!isNativeAndroidOrIos()) {
    candidates.push(normalizedPath);
  }

  if (edgeUrl && SUPABASE_EDGE_SUPPORTED_PATHS.has(normalizedPath)) {
    candidates.push(`${edgeUrl}${normalizedPath}`);
  }

  return Array.from(new Set(candidates));
}

export interface StandaloneBackendHealthResult {
  reachable: boolean;
  geminiConfigured: boolean;
  isMarketOpen?: boolean;
  url: string;
  messageId: string;
  messageEn: string;
}

/**
 * Verifies connectivity and Gemini AI availability on a standalone TradeVault backend
 * (either Supabase Edge Function `tradevault-api` or self-hosted `server.ts`).
 */
export async function testStandaloneBackendConnection(
  rawUrl?: string
): Promise<StandaloneBackendHealthResult> {
  const targetBase =
    rawUrl !== undefined ? sanitizeBackendBaseUrl(rawUrl) : getStandaloneBackendUrl();

  if (!targetBase && isNativeAndroidOrIos()) {
    return {
      reachable: false,
      geminiConfigured: false,
      url: '',
      messageId:
        'URL Server Backend / Supabase belum tersedia. Isi konfigurasi Supabase atau masukkan URL server backend.',
      messageEn:
        'Backend Server / Supabase URL is not available. Configure Supabase or enter a backend server URL.',
    };
  }

  const healthUrl = targetBase ? `${targetBase}/api/health` : '/api/health';
  const authHeaders = buildBackendAuthHeaders(healthUrl);

  try {
    let status = 0;
    let json: any = null;

    if (isNativeAndroidOrIos() && /^https?:\/\//i.test(healthUrl)) {
      const response = await CapacitorHttp.get({
        url: healthUrl,
        connectTimeout: 8000,
        readTimeout: 8000,
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          ...authHeaders,
        },
      });
      status = response.status;
      if (typeof response.data === 'string') {
        try {
          json = JSON.parse(response.data);
        } catch {
          json = null;
        }
      } else {
        json = response.data ?? null;
      }
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(healthUrl, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          ...authHeaders,
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      status = res.status;
      if (res.ok) {
        json = await res.json();
      }
    }

    if (status < 200 || status >= 300) {
      const isEdgeNotDeployed = isSupabaseEdgeUrl(healthUrl) && status === 404;
      return {
        reachable: false,
        geminiConfigured: false,
        url: targetBase || (typeof window !== 'undefined' ? window.location.origin : ''),
        messageId: isEdgeNotDeployed
          ? 'Edge Function "tradevault-api" belum dideploy di Supabase Anda (HTTP 404). Silakan deploy function "tradevault-api" terlebih dahulu.'
          : `Server merespons HTTP ${status}. Pastikan backend aktif dan endpoint /api/health tersedia.`,
        messageEn: isEdgeNotDeployed
          ? 'Edge Function "tradevault-api" is not deployed on your Supabase project yet (HTTP 404).'
          : `Server responded with HTTP ${status}. Ensure backend is running and /api/health is available.`,
      };
    }

    const geminiConfigured = Boolean(json?.geminiConfigured);
    const isMarketOpen = typeof json?.isMarketOpen === 'boolean' ? json.isMarketOpen : undefined;

    if (!json?.ok) {
      return {
        reachable: false,
        geminiConfigured: false,
        url: targetBase || (typeof window !== 'undefined' ? window.location.origin : ''),
        messageId: 'Endpoint /api/health merespons format tidak valid.',
        messageEn: 'Endpoint /api/health returned an unexpected payload.',
      };
    }

    const isEdge = isSupabaseEdgeUrl(healthUrl);
    return {
      reachable: true,
      geminiConfigured,
      isMarketOpen,
      url: targetBase || (typeof window !== 'undefined' ? window.location.origin : ''),
      messageId: geminiConfigured
        ? isEdge
          ? 'Terhubung ke Supabase Edge Functions & Gemini AI aktif siap digunakan!'
          : 'Terhubung! Server Backend Mandiri & Gemini AI aktif siap digunakan.'
        : 'Server terhubung, namun GEMINI_API_KEY / GEMINI_NEWS_API_KEY belum disetel di Secrets server tersebut.',
      messageEn: geminiConfigured
        ? isEdge
          ? 'Connected to Supabase Edge Functions & Gemini AI is active!'
          : 'Connected! Standalone Backend Server & Gemini AI are active.'
        : 'Server reachable, but GEMINI_API_KEY / GEMINI_NEWS_API_KEY is not configured in server secrets.',
    };
  } catch (err: any) {
    return {
      reachable: false,
      geminiConfigured: false,
      url: targetBase || '',
      messageId: `Gagal terhubung ke server (${err?.message || 'network timeout'}). Periksa URL HTTPS & status deploy.`,
      messageEn: `Failed to reach server (${err?.message || 'network timeout'}). Verify HTTPS URL and deploy status.`,
    };
  }
}

/**
 * Executes a CORS-free native Android/iOS HTTP GET request via CapacitorHttp when running inside APK,
 * leaving browser/WebView `window.fetch` untouched for Supabase Storage binary uploads.
 */
export async function nativeHttpGetText(
  targetUrl: string,
  timeoutMs = 7000,
  acceptHeader = 'application/json, application/xml, text/xml, text/plain, */*'
): Promise<string | null> {
  if (!isNativeAndroidOrIos()) {
    return null;
  }

  const authHeaders = buildBackendAuthHeaders(targetUrl);
  const isTradingViewTarget = /tradingview\.com/i.test(targetUrl);
  const domainHeaders: Record<string, string> = isTradingViewTarget
    ? {
        Origin: 'https://www.tradingview.com',
        Referer: 'https://www.tradingview.com/',
      }
    : {};

  try {
    const response = await CapacitorHttp.get({
      url: targetUrl,
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
      responseType: 'text',
      headers: {
        Accept: acceptHeader,
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        ...domainHeaders,
        ...authHeaders,
      },
    });

    if (response.status >= 200 && response.status < 300) {
      if (typeof response.data === 'string') {
        return response.data;
      }
      if (response.data !== null && response.data !== undefined) {
        return JSON.stringify(response.data);
      }
    }
  } catch {
    // Native HTTP failed; caller will try next fallback
  }

  return null;
}

/**
 * Executes a CORS-free native Android/iOS HTTP GET for external image URLs (such as TradingView snapshots)
 * returning a base64 `data:image/...` Data URL via CapacitorHttp.
 */
export async function nativeHttpGetImageDataUrl(
  targetUrl: string,
  timeoutMs = 8000
): Promise<string | null> {
  if (!isNativeAndroidOrIos() || !/^https?:\/\//i.test(targetUrl)) {
    return null;
  }

  const authHeaders = buildBackendAuthHeaders(targetUrl);
  const isTradingViewTarget = /tradingview\.com/i.test(targetUrl);
  const domainHeaders: Record<string, string> = isTradingViewTarget
    ? {
        Origin: 'https://www.tradingview.com',
        Referer: 'https://www.tradingview.com/',
      }
    : {};

  try {
    const response = await CapacitorHttp.get({
      url: targetUrl,
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
      responseType: 'blob',
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        ...domainHeaders,
        ...authHeaders,
      },
    });

    if (response.status >= 200 && response.status < 300 && typeof response.data === 'string' && response.data.length > 200) {
      const headersObj = (response.headers || {}) as Record<string, string>;
      const rawCt =
        headersObj['content-type'] ||
        headersObj['Content-Type'] ||
        headersObj['CONTENT-TYPE'] ||
        '';
      const mimeType = rawCt.split(';')[0].trim().toLowerCase();
      if (mimeType.includes('text/html')) {
        return null;
      }
      const cleanBase64 = response.data.replace(/\s+/g, '');
      if (cleanBase64.startsWith('data:image/')) {
        return cleanBase64;
      }
      const inferredMime = mimeType.startsWith('image/')
        ? mimeType
        : /\.jpe?g(\?|$)/i.test(targetUrl)
        ? 'image/jpeg'
        : /\.webp(\?|$)/i.test(targetUrl)
        ? 'image/webp'
        : 'image/png';
      return `data:${inferredMime};base64,${cleanBase64}`;
    }
  } catch {
    // Native image fetch failed; caller falls back to next candidate
  }

  return null;
}

/**
 * Executes a CORS-free native Android/iOS HTTP JSON POST via CapacitorHttp when running inside APK,
 * falling back to standard fetch on web browsers, and automatically attaching Supabase Edge headers.
 */
export async function nativeAwarePostJson(
  url: string,
  payload: unknown,
  timeoutMs = 18000
): Promise<{ ok: boolean; json: any | null; status?: number; errorMessage?: string }> {
  const authHeaders = buildBackendAuthHeaders(url);

  if (isNativeAndroidOrIos() && /^https?:\/\//i.test(url)) {
    try {
      const response = await CapacitorHttp.post({
        url,
        connectTimeout: Math.min(timeoutMs, 20000),
        readTimeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          ...authHeaders,
        },
        data: payload,
      });

      const status = Number(response.status || 0);
      const ok = status >= 200 && status < 300;
      if (typeof response.data === 'string') {
        const trimmed = response.data.trim();
        if (
          trimmed.startsWith('<!doctype') ||
          trimmed.startsWith('<!DOCTYPE') ||
          trimmed.startsWith('<html') ||
          trimmed.startsWith('<')
        ) {
          return {
            ok: false,
            json: null,
            status,
            errorMessage: `Backend mengembalikan halaman HTML (HTTP ${status || 'N/A'}).`,
          };
        }
        try {
          const parsed = JSON.parse(response.data);
          return {
            ok,
            json: parsed,
            status,
            errorMessage: ok ? undefined : String(parsed?.error || parsed?.message || `HTTP ${status}`),
          };
        } catch {
          return {
            ok: false,
            json: null,
            status,
            errorMessage: `Respon backend tidak valid (HTTP ${status || 'N/A'}).`,
          };
        }
      }
      const obj = response.data ?? null;
      return {
        ok,
        json: obj,
        status,
        errorMessage: ok
          ? undefined
          : String((obj as any)?.error || (obj as any)?.message || `HTTP ${status || 'Error'}`),
      };
    } catch (err: any) {
      const rawMsg = String(err?.message || err || 'Network error');
      const isTimeout = /timeout|timed out|abort/i.test(rawMsg);
      return {
        ok: false,
        json: null,
        errorMessage: isTimeout
          ? `Waktu koneksi habis (${Math.round(timeoutMs / 1000)} dtk) ke server APK.`
          : `Koneksi APK ke server gagal: ${rawMsg.slice(0, 120)}`,
      };
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        ...authHeaders,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const rawText = await res.text();
    const trimmed = rawText.trim();
    if (
      contentType.includes('text/html') ||
      trimmed.startsWith('<!doctype') ||
      trimmed.startsWith('<!DOCTYPE') ||
      trimmed.startsWith('<html') ||
      trimmed.startsWith('<')
    ) {
      return {
        ok: false,
        json: null,
        status: res.status,
        errorMessage: `Backend mengembalikan halaman HTML (HTTP ${res.status}).`,
      };
    }
    try {
      const parsed = JSON.parse(rawText);
      return {
        ok: res.ok,
        json: parsed,
        status: res.status,
        errorMessage: res.ok
          ? undefined
          : String(parsed?.error || parsed?.message || `HTTP ${res.status}`),
      };
    } catch {
      return {
        ok: false,
        json: null,
        status: res.status,
        errorMessage: `Respon JSON tidak valid dari backend (HTTP ${res.status}).`,
      };
    }
  } catch (err: any) {
    const rawMsg = String(err?.message || err || 'Network error');
    const isTimeout = err?.name === 'AbortError' || /timeout|abort/i.test(rawMsg);
    return {
      ok: false,
      json: null,
      errorMessage: isTimeout
        ? `Waktu koneksi habis (${Math.round(timeoutMs / 1000)} dtk).`
        : `Gagal menghubungi server: ${rawMsg.slice(0, 120)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
