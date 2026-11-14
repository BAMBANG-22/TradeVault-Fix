/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Capacitor, CapacitorHttp } from '@capacitor/core';

export const STANDALONE_BACKEND_URL_STORAGE_KEY = 'tradevault_standalone_backend_url_v1';

/**
 * Normalizes a standalone backend URL to its clean origin (e.g. "https://api.tradevault.example.com").
 * Strips trailing slashes and accidental "/api/*" path suffixes.
 * Strictly rejects Google AI Studio preview/dev URLs if entered accidentally? No, allow any valid HTTPS/HTTP
 * backend URL the user explicitly configures, while shipping ZERO hardcoded Google AI Studio URLs.
 */
export function sanitizeBackendBaseUrl(rawUrl: string | null | undefined): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let clean = rawUrl.trim().replace(/^['"]+|['"]+$/g, '');
  if (!clean) return '';

  const hasScheme = /^https?:\/\//i.test(clean);
  if (!hasScheme) {
    // Use http:// only for localhost / LAN IPs, otherwise https://
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
    return parsed.origin;
  } catch {
    return clean
      .replace(/\/api(?:\/.*)?$/i, '')
      .replace(/\/+$/, '');
  }
}

/**
 * Resolves the configured Standalone Backend Server URL in priority order:
 * 1. Explicit user override saved in localStorage (`tradevault_standalone_backend_url_v1`)
 *    so an already-built APK can be pointed to any self-hosted server at runtime without rebuilding.
 * 2. Build-time environment variable `VITE_API_BASE_URL` (set in `.env` or GitHub Actions Secrets).
 * Returns `''` when neither is set.
 */
export function getStandaloneBackendUrl(): string {
  let storedUrl = '';
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(STANDALONE_BACKEND_URL_STORAGE_KEY);
      if (raw) {
        storedUrl = sanitizeBackendBaseUrl(raw);
      }
    } catch {
      // ignore localStorage read failure
    }
  }
  if (storedUrl) {
    return storedUrl;
  }

  let envUrl = '';
  try {
    if (typeof import.meta !== 'undefined' && import.meta && (import.meta as any).env) {
      envUrl = sanitizeBackendBaseUrl((import.meta as any).env.VITE_API_BASE_URL || '');
    }
  } catch {
    // ignore import.meta access failure
  }

  if (!envUrl && typeof process !== 'undefined' && process?.env) {
    envUrl = sanitizeBackendBaseUrl(process.env.VITE_API_BASE_URL || '');
  }

  return envUrl;
}

export function getEnvStandaloneBackendUrl(): string {
  try {
    if (typeof import.meta !== 'undefined' && import.meta && (import.meta as any).env) {
      return sanitizeBackendBaseUrl((import.meta as any).env.VITE_API_BASE_URL || '');
    }
  } catch {
    // ignore
  }
  return '';
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

/**
 * Returns ordered candidate endpoint URLs for a backend API route (e.g. `/api/macro-news/analyze`).
 * - Inside native Capacitor APK: uses ONLY the configured Standalone Backend URL (`VITE_API_BASE_URL` or user setting),
 *   never wasting timeouts on `https://localhost/api/...` and never embedding Google AI Studio URLs.
 * - On Web / Dev Server: tries the configured Standalone Backend URL first (if set), then same-origin relative `/api/...`.
 */
export function getApiEndpointCandidates(apiPath: string): string[] {
  const normalizedPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const baseUrl = getStandaloneBackendUrl();
  const candidates: string[] = [];

  if (baseUrl) {
    candidates.push(`${baseUrl}${normalizedPath}`);
  }

  if (!isNativeAndroidOrIos()) {
    candidates.push(normalizedPath);
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
 * Verifies connectivity and Gemini AI availability on a standalone TradeVault backend (`server.ts`).
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
        'URL Server Backend belum diisi. Masukkan URL server Node.js mandiri Anda (misal Railway / Render / VPS).',
      messageEn:
        'Backend Server URL is empty. Enter your standalone Node.js server URL (e.g. Railway / Render / VPS).',
    };
  }

  const healthUrl = targetBase ? `${targetBase}/api/health` : '/api/health';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(healthUrl, {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return {
        reachable: false,
        geminiConfigured: false,
        url: targetBase || window.location.origin,
        messageId: `Server merespons HTTP ${res.status}. Pastikan server.ts aktif dan endpoint /api/health tersedia.`,
        messageEn: `Server responded with HTTP ${res.status}. Ensure server.ts is running and /api/health is available.`,
      };
    }

    const json = await res.json();
    const geminiConfigured = Boolean(json?.geminiConfigured);
    const isMarketOpen = typeof json?.isMarketOpen === 'boolean' ? json.isMarketOpen : undefined;

    if (!json?.ok) {
      return {
        reachable: false,
        geminiConfigured: false,
        url: targetBase || window.location.origin,
        messageId: 'Endpoint /api/health merespons format tidak valid.',
        messageEn: 'Endpoint /api/health returned an unexpected payload.',
      };
    }

    return {
      reachable: true,
      geminiConfigured,
      isMarketOpen,
      url: targetBase || window.location.origin,
      messageId: geminiConfigured
        ? 'Terhubung! Server Backend Mandiri & Gemini AI aktif siap digunakan.'
        : 'Server terhubung, namun GEMINI_API_KEY belum disetel di environment server tersebut.',
      messageEn: geminiConfigured
        ? 'Connected! Standalone Backend Server & Gemini AI are active.'
        : 'Server reachable, but GEMINI_API_KEY is not configured in that server environment.',
    };
  } catch (err: any) {
    return {
      reachable: false,
      geminiConfigured: false,
      url: targetBase || '',
      messageId: `Gagal terhubung ke server (${err?.message || 'network timeout'}). Periksa URL HTTPS & status server.`,
      messageEn: `Failed to reach server (${err?.message || 'network timeout'}). Verify HTTPS URL and server status.`,
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
 * Executes a CORS-free native Android/iOS HTTP JSON POST/GET via CapacitorHttp when running inside APK,
 * falling back to standard fetch on web browsers.
 */
export async function nativeAwarePostJson(
  url: string,
  payload: unknown,
  timeoutMs = 18000
): Promise<{ ok: boolean; json: any | null }> {
  if (isNativeAndroidOrIos() && /^https?:\/\//i.test(url)) {
    try {
      const response = await CapacitorHttp.post({
        url,
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
        data: payload,
      });

      const ok = response.status >= 200 && response.status < 300;
      if (typeof response.data === 'string') {
        try {
          return { ok, json: JSON.parse(response.data) };
        } catch {
          return { ok: false, json: null };
        }
      }
      return { ok, json: response.data ?? null };
    } catch {
      return { ok: false, json: null };
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
      return { ok: false, json: null };
    }
    try {
      return { ok: res.ok, json: JSON.parse(rawText) };
    } catch {
      return { ok: false, json: null };
    }
  } catch {
    return { ok: false, json: null };
  } finally {
    clearTimeout(timer);
  }
}
