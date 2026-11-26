/**
 * Offline On-Device MT5 / Chart OCR Engine powered by locally bundled Tesseract.js LSTM assets (`public/ocr/`).
 * - Zero external CDN calls (works 100% offline in both Web browser and Capacitor Android APK).
 * - Chromatic channel-max preprocessing preserves thin red '-' minus signs and blue profit digits in Dark Mode.
 * - Coordinate-aware Y-band reconstruction keeps split left/right MT5 columns aligned on the same row.
 */

import type { Worker, Word } from 'tesseract.js';
import { Capacitor } from '@capacitor/core';
import { getAppBuildIdentity, AppBuildIdentity } from '../config/appVersion';

export interface OfflineOcrWordBox {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  centerY: number;
  centerX: number;
}

export interface OfflineOcrLine {
  text: string;
  centerY: number;
  minX: number;
  maxX: number;
}

export interface OfflineOcrResult {
  fullText: string;
  lines: OfflineOcrLine[];
  words: OfflineOcrWordBox[];
  confidence: number;
  telemetry?: {
    workerInitMs: number;
    workerReused: boolean;
    recognizeMs: number;
    psm: string;
    inputType: string;
    resolvedAssets: {
      workerPath: string;
      corePath: string;
      langPath: string;
      gzip: boolean;
    };
  };
}

export interface OcrPreprocessTelemetry {
  mode: PrecisionOcrVariantMode;
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
  scaleApplied: number;
  paddingPx: number;
  detectedBackground: 'dark' | 'light' | 'unknown';
  backgroundLuma: number;
  encoding: string;
  preprocessMs: number;
  stepsExecuted: string[];
}

export interface OcrPassDiagnostic {
  passIndex: number;
  variantMode: PrecisionOcrVariantMode;
  psm: '3' | '6' | '11';
  preprocess: OcrPreprocessTelemetry | null;
  workerInitMs: number;
  workerReused: boolean;
  recognizeMs: number;
  confidence: number;
  wordBoxCount: number;
  lineCount: number;
  parsedRowsCount: number;
  score: number;
  rawText: string;
  sampleBoxes: Array<{ text: string; left: number; top: number; width: number; height: number }>;
  error?: string;
}

export interface Mt5OcrScanDiagnostic {
  id: string;
  timestampIso: string;
  build: AppBuildIdentity;
  platform: {
    isNativeCapacitor: boolean;
    capacitorPlatform: string;
    origin: string;
    navigatorOnline: boolean;
    hasServiceWorkerController: boolean;
    userAgent: string;
  };
  requestedMode: 'auto' | 'offline';
  resolvedEngine: 'gemini' | 'offline-ocr' | 'cache' | 'error';
  invokedFallback: boolean;
  fallbackReason?: string;
  imageIndex: number;
  inputDimensions: { width: number; height: number } | null;
  totalDurationMs: number;
  passes: OcrPassDiagnostic[];
  finalRawText: string;
  finalConfidence: number;
  finalWordBoxCount: number;
  parserOutputSummary: Array<{
    instrument: string;
    position: string;
    lotSize: number;
    entryPrice: number;
    exitPrice: number;
    stopLoss: number | null;
    takeProfit: number | null;
    netProfit: number;
    closeType: string;
    closeDateTime: string | null;
    ocrSignRecovered?: boolean;
  }>;
  validationFailures: string[];
  error?: string;
}

export interface OfflineOcrRuntimeProbe {
  build: AppBuildIdentity;
  isNativeCapacitor: boolean;
  capacitorPlatform: string;
  origin: string;
  href: string;
  hasServiceWorkerController: boolean;
  serviceWorkerCount: number;
  cacheBucketNames: string[];
  resolvedUrls: {
    workerPath: string;
    corePath: string;
    langPath: string;
    trainedDataUrl: string;
  };
  assetChecks: Array<{
    name: string;
    url: string;
    ok: boolean;
    status: number;
    bytes: number | null;
    contentType: string;
    error?: string;
  }>;
}

const MAX_DIAGNOSTIC_HISTORY = 10;
const recentMt5OcrDiagnostics: Mt5OcrScanDiagnostic[] = [];

export function recordMt5OcrScanDiagnostic(entry: Mt5OcrScanDiagnostic): void {
  recentMt5OcrDiagnostics.unshift(entry);
  if (recentMt5OcrDiagnostics.length > MAX_DIAGNOSTIC_HISTORY) {
    recentMt5OcrDiagnostics.length = MAX_DIAGNOSTIC_HISTORY;
  }
}

export function getRecentMt5OcrScanDiagnostics(): Mt5OcrScanDiagnostic[] {
  return [...recentMt5OcrDiagnostics];
}

export function clearMt5OcrScanDiagnostics(): void {
  recentMt5OcrDiagnostics.length = 0;
}

export function getRuntimePlatformSnapshot() {
  let isNative = false;
  let capPlatform = 'web';
  try {
    isNative = typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform();
    capPlatform = typeof Capacitor !== 'undefined' ? Capacitor.getPlatform() : 'web';
  } catch {
    isNative = false;
    capPlatform = 'web';
  }
  return {
    isNativeCapacitor: isNative,
    capacitorPlatform: capPlatform,
    origin: typeof window !== 'undefined' ? window.location.origin : 'node',
    navigatorOnline: typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
    hasServiceWorkerController:
      typeof navigator !== 'undefined' && Boolean(navigator.serviceWorker?.controller),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'node',
  };
}

let cachedWorkerPromise: Promise<Worker> | null = null;
let workerQueuePromise: Promise<void> = Promise.resolve();
let lastPsmApplied: string | null = null;
let lastWorkerInitMs = 0;
let lastResolvedAssets = {
  workerPath: '',
  corePath: '',
  langPath: '',
  gzip: false,
};

function isBrowserLikeEnv(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function resolveBrowserAssetUrl(relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, '');
  try {
    const base =
      typeof window !== 'undefined' && window.location.origin && window.location.origin !== 'null'
        ? `${window.location.origin}/`
        : window.location.href;
    return new URL(clean, base).href;
  } catch {
    return `/${clean}`;
  }
}

export async function probeOfflineOcrRuntimeEnvironment(): Promise<OfflineOcrRuntimeProbe> {
  const snap = getRuntimePlatformSnapshot();
  const build = getAppBuildIdentity();
  const workerPath = isBrowserLikeEnv() ? resolveBrowserAssetUrl('ocr/worker.min.js') : 'public/ocr/worker.min.js';
  const corePath = isBrowserLikeEnv() ? resolveBrowserAssetUrl('ocr') : 'public/ocr';
  const langPath = isBrowserLikeEnv() ? resolveBrowserAssetUrl('ocr') : 'public/ocr';
  const trainedDataUrl = isBrowserLikeEnv()
    ? resolveBrowserAssetUrl('ocr/eng.traineddata')
    : 'public/ocr/eng.traineddata';

  let serviceWorkerCount = 0;
  let cacheBucketNames: string[] = [];
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      serviceWorkerCount = regs.length;
    } catch {}
  }
  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      cacheBucketNames = await window.caches.keys();
    } catch {}
  }

  const assetsToProbe = [
    { name: 'worker.min.js', url: workerPath },
    { name: 'eng.traineddata', url: trainedDataUrl },
    { name: 'tesseract-core-simd-lstm.wasm.js', url: resolveBrowserAssetUrl('ocr/tesseract-core-simd-lstm.wasm.js') },
    {
      name: 'tesseract-core-relaxedsimd-lstm.wasm.js',
      url: resolveBrowserAssetUrl('ocr/tesseract-core-relaxedsimd-lstm.wasm.js'),
    },
    { name: 'tesseract-core-lstm.wasm.js', url: resolveBrowserAssetUrl('ocr/tesseract-core-lstm.wasm.js') },
  ];

  const assetChecks = await Promise.all(
    assetsToProbe.map(async (asset) => {
      if (!isBrowserLikeEnv() || typeof fetch !== 'function') {
        return {
          name: asset.name,
          url: asset.url,
          ok: false,
          status: 0,
          bytes: null,
          contentType: '',
          error: 'Non-browser environment',
        };
      }
      try {
        const res = await fetch(asset.url, { cache: 'no-store' });
        const buf = res.ok ? await res.arrayBuffer() : null;
        return {
          name: asset.name,
          url: asset.url,
          ok: res.ok && (buf ? buf.byteLength > 0 : false),
          status: res.status,
          bytes: buf ? buf.byteLength : null,
          contentType: res.headers.get('content-type') || '',
        };
      } catch (err: any) {
        return {
          name: asset.name,
          url: asset.url,
          ok: false,
          status: 0,
          bytes: null,
          contentType: '',
          error: String(err?.message || err || 'Fetch failed'),
        };
      }
    })
  );

  return {
    build,
    isNativeCapacitor: snap.isNativeCapacitor,
    capacitorPlatform: snap.capacitorPlatform,
    origin: snap.origin,
    href: typeof window !== 'undefined' ? window.location.href : 'node',
    hasServiceWorkerController: snap.hasServiceWorkerController,
    serviceWorkerCount,
    cacheBucketNames,
    resolvedUrls: {
      workerPath,
      corePath,
      langPath,
      trainedDataUrl,
    },
    assetChecks,
  };
}

async function createOfflineTesseractWorker(): Promise<Worker> {
  const initStart = Date.now();
  const tesseractMod = await import('tesseract.js');
  const { createWorker, OEM, PSM } = tesseractMod;
  lastPsmApplied = null;

  const isBrowser = isBrowserLikeEnv();
  const resolvedWorkerPath = isBrowser ? resolveBrowserAssetUrl('ocr/worker.min.js') : 'node-default';
  const resolvedCorePath = isBrowser ? resolveBrowserAssetUrl('ocr') : 'node-default';
  const resolvedLangPath = isBrowser
    ? resolveBrowserAssetUrl('ocr')
    : `${(
        typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : '.'
      ).replace(/[\\/]+$/, '')}/public/ocr`;

  lastResolvedAssets = {
    workerPath: resolvedWorkerPath,
    corePath: resolvedCorePath,
    langPath: resolvedLangPath,
    gzip: false,
  };

  const baseOptions: Record<string, any> = isBrowser
    ? {
        workerPath: resolvedWorkerPath,
        corePath: resolvedCorePath,
        langPath: resolvedLangPath,
        workerBlobURL: false,
        cacheMethod: 'none',
        // Android Gradle AAPT2 auto-decompresses *.gz assets and strips the .gz suffix inside APKs,
        // so we bundle uncompressed `public/ocr/eng.traineddata` with `gzip: false` for 100% parity.
        gzip: false,
      }
    : {
        langPath: resolvedLangPath,
        cacheMethod: 'none',
        gzip: false,
      };

  // tesseract.js swallows loadLanguage/initialize rejections inside `.catch(() => {})` without
  // rejecting the createWorker Promise. Passing `errorHandler` + an init timeout guarantees fast,
  // deterministic failure instead of infinite loading if any worker step fails.
  const worker = await new Promise<Worker>((resolve, reject) => {
    let settled = false;
    const finishResolve = (w: Worker) => {
      if (settled) return;
      settled = true;
      clearTimeout(initTimer);
      resolve(w);
    };
    const finishReject = (err: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(initTimer);
      reject(err instanceof Error ? err : new Error(String(err || 'Tesseract worker init failed')));
    };

    const initTimer = setTimeout(() => {
      finishReject(new Error('Inisialisasi mesin OCR offline timeout (20s).'));
    }, 20_000);

    createWorker('eng', OEM.LSTM_ONLY, {
      ...baseOptions,
      errorHandler: (err: unknown) => {
        finishReject(err);
      },
    })
      .then(finishResolve)
      .catch(finishReject);
  });

  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
  });
  lastPsmApplied = String(PSM.SINGLE_BLOCK);
  lastWorkerInitMs = Date.now() - initStart;
  return worker;
}

async function getOfflineWorker(): Promise<{ worker: Worker; reused: boolean; initMs: number }> {
  const wasCached = Boolean(cachedWorkerPromise);
  if (!cachedWorkerPromise) {
    cachedWorkerPromise = createOfflineTesseractWorker().catch((err) => {
      cachedWorkerPromise = null;
      lastPsmApplied = null;
      throw err;
    });
  }
  const start = Date.now();
  const worker = await cachedWorkerPromise;
  return {
    worker,
    reused: wasCached,
    initMs: wasCached ? Date.now() - start : lastWorkerInitMs,
  };
}

/**
 * Starts initializing the local WASM + LSTM eng.traineddata worker in the background
 * so offline OCR starts immediately when a screenshot is chosen.
 */
export function prewarmOfflineTesseractWorker(): void {
  if (!isBrowserLikeEnv()) return;
  void getOfflineWorker().catch(() => {
    // Ignore warmup failures; actual scan handles errors cleanly
  });
}

export async function terminateOfflineTesseractWorker(): Promise<void> {
  const existing = cachedWorkerPromise;
  cachedWorkerPromise = null;
  lastPsmApplied = null;
  if (existing) {
    try {
      const worker = await existing;
      await worker.terminate();
    } catch {
      // ignore termination failure
    }
  }
}

/**
 * Reconstructs clean horizontal rows from word bounding boxes so left-column labels/prices
 * and right-column timestamps/profits remain paired even when MT5 renders wide whitespace gaps.
 */
export function reconstructStructuredLinesFromWords(
  words: OfflineOcrWordBox[]
): OfflineOcrLine[] {
  if (!Array.isArray(words) || words.length === 0) return [];

  const heights = words
    .map((w) => w.height)
    .filter((h) => Number.isFinite(h) && h >= 8)
    .sort((a, b) => a - b);
  const fallbackHeights = words
    .map((w) => w.height)
    .filter((h) => Number.isFinite(h) && h > 0)
    .sort((a, b) => a - b);
  const activeHeights = heights.length > 0 ? heights : fallbackHeights;
  const medianH =
    activeHeights.length > 0 ? activeHeights[Math.floor(activeHeights.length / 2)] : 18;
  const rowTolerance = Math.max(9, medianH * 0.68);

  const sortedByY = [...words].sort((a, b) => a.centerY - b.centerY || a.left - b.left);
  const bands: Array<{ meanY: number; items: OfflineOcrWordBox[] }> = [];

  for (const w of sortedByY) {
    let targetBand: { meanY: number; items: OfflineOcrWordBox[] } | null = null;
    let bestDist = Infinity;
    for (const band of bands) {
      const dist = Math.abs(w.centerY - band.meanY);
      if (dist <= rowTolerance && dist < bestDist) {
        bestDist = dist;
        targetBand = band;
      }
    }
    if (targetBand) {
      targetBand.items.push(w);
      targetBand.meanY =
        targetBand.items.reduce((acc, item) => acc + item.centerY, 0) /
        targetBand.items.length;
    } else {
      bands.push({ meanY: w.centerY, items: [w] });
    }
  }

  bands.sort((a, b) => a.meanY - b.meanY);

  const lines: OfflineOcrLine[] = [];
  for (const band of bands) {
    band.items.sort((a, b) => a.left - b.left);
    let lineText = '';
    let prevRight = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;

    for (const item of band.items) {
      const cleanToken = item.text.trim();
      if (!cleanToken) continue;
      if (item.left < minX) minX = item.left;
      const itemRight = item.left + item.width;
      if (itemRight > maxX) maxX = itemRight;

      if (!lineText) {
        lineText = cleanToken;
      } else {
        const gap = item.left - prevRight;
        lineText += gap > medianH * 1.35 ? `   ${cleanToken}` : ` ${cleanToken}`;
      }
      prevRight = itemRight;
    }

    if (lineText) {
      lines.push({
        text: lineText,
        centerY: band.meanY,
        minX: Number.isFinite(minX) ? minX : 0,
        maxX: Number.isFinite(maxX) ? maxX : 0,
      });
    }
  }

  return lines;
}

/**
 * Generates high-precision Black-on-White OCR image variants from a Data URL in the browser:
 * - Variant 0 (Primary): Upscaled + 24px white padding + Chromatic Contrast Extraction
 *   (uses max RGB channel delta from background so red '-' losses, blue profits, and muted grey S/L & T/P labels become crisp black).
 * - Variant 1 (Soft Fallback): Upscaled soft grayscale inversion with boosted contrast for tricky anti-aliased screens.
 */
export type PrecisionOcrVariantMode = 'chromatic_sharp' | 'soft_luma';

function renderCanvasOcrVariantWithTelemetry(
  img: HTMLImageElement,
  mode: PrecisionOcrVariantMode,
  fallbackUrl: string
): { dataUrl: string; telemetry: OcrPreprocessTelemetry } {
  const startMs = Date.now();
  const srcW = img.width;
  const srcH = img.height;
  const stepsExecuted: string[] = [];
  if (!srcW || !srcH) {
    return {
      dataUrl: fallbackUrl,
      telemetry: {
        mode,
        sourceWidth: srcW,
        sourceHeight: srcH,
        outputWidth: srcW,
        outputHeight: srcH,
        scaleApplied: 1,
        paddingPx: 0,
        detectedBackground: 'unknown',
        backgroundLuma: 0,
        encoding: 'passthrough',
        preprocessMs: Date.now() - startMs,
        stepsExecuted: ['invalid-source-passthrough'],
      },
    };
  }

  // Preserve crisp glyph height (~22-30px) on full-screen Android portrait screenshots (e.g. 1080x2400)
  // while keeping pixel count bounded to 2.2MP for fast SIMD WASM execution.
  const maxOcrWidth = 1080;
  let scale =
    srcW < 760
      ? Math.min(1.5, maxOcrWidth / srcW)
      : srcW > maxOcrWidth
      ? maxOcrWidth / srcW
      : 1;
  const maxPixelBudget = 2_200_000;
  if (srcW * scale * (srcH * scale) > maxPixelBudget) {
    scale = Math.max(0.55, Math.sqrt(maxPixelBudget / (srcW * srcH)));
  }
  const innerW = Math.round(srcW * scale);
  const innerH = Math.round(srcH * scale);
  const pad = 20;
  const outW = innerW + pad * 2;
  const outH = innerH + pad * 2;
  stepsExecuted.push(
    `resize(${srcW}x${srcH}->${innerW}x${innerH},scale=${scale.toFixed(2)},pad=${pad}px)`
  );

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return {
      dataUrl: fallbackUrl,
      telemetry: {
        mode,
        sourceWidth: srcW,
        sourceHeight: srcH,
        outputWidth: srcW,
        outputHeight: srcH,
        scaleApplied: 1,
        paddingPx: 0,
        detectedBackground: 'unknown',
        backgroundLuma: 0,
        encoding: 'passthrough-no-ctx',
        preprocessMs: Date.now() - startMs,
        stepsExecuted: ['canvas-2d-unavailable'],
      },
    };
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, pad, pad, innerW, innerH);

  const imgData = ctx.getImageData(pad, pad, innerW, innerH);
  const pixels = imgData.data;

  // Estimate background RGB median from sparse grid
  const rSamples: number[] = [];
  const gSamples: number[] = [];
  const bSamples: number[] = [];
  const step = Math.max(16, Math.floor(pixels.length / 3000) * 4);
  for (let i = 0; i < pixels.length; i += step) {
    rSamples.push(pixels[i]);
    gSamples.push(pixels[i + 1]);
    bSamples.push(pixels[i + 2]);
  }
  rSamples.sort((a, b) => a - b);
  gSamples.sort((a, b) => a - b);
  bSamples.sort((a, b) => a - b);
  const mid = Math.floor(rSamples.length / 2);
  const bgR = rSamples[mid] ?? 18;
  const bgG = gSamples[mid] ?? 22;
  const bgB = bSamples[mid] ?? 28;
  const bgLum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;
  const isDarkBg = bgLum < 128;
  stepsExecuted.push(
    `bg-median-detect(${isDarkBg ? 'dark' : 'light'},luma=${Math.round(bgLum)})`
  );

  // Precomputed LUT for fast branchless-style intensity mapping on millions of pixels
  if (mode === 'chromatic_sharp') {
    const lut = new Uint8ClampedArray(256);
    for (let s = 0; s < 256; s++) {
      if (s <= 10) {
        lut[s] = 255;
      } else {
        const normalized = Math.min(1, (s - 10) / 88);
        lut[s] = Math.round(255 * (1 - Math.pow(normalized, 0.62)));
      }
    }
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const deltaR = isDarkBg ? r - bgR : bgR - r;
      const deltaG = isDarkBg ? g - bgG : bgG - g;
      const deltaB = isDarkBg ? b - bgB : bgB - b;
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      const deltaLuma = isDarkBg ? luma - bgLum : bgLum - luma;
      const inkStrength = Math.max(0, deltaR, deltaG, deltaB, deltaLuma) | 0;
      const v = lut[inkStrength > 255 ? 255 : inkStrength];
      pixels[i] = v;
      pixels[i + 1] = v;
      pixels[i + 2] = v;
      pixels[i + 3] = 255;
    }
    stepsExecuted.push('chromatic-channel-max-lut(gamma=0.62)');
  } else {
    for (let i = 0; i < pixels.length; i += 4) {
      let lum = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      if (isDarkBg) lum = 255 - lum;
      const stretched = Math.max(0, Math.min(255, Math.round((lum - 128) * 1.55 + 128)));
      pixels[i] = stretched;
      pixels[i + 1] = stretched;
      pixels[i + 2] = stretched;
      pixels[i + 3] = 255;
    }
    stepsExecuted.push('soft-luma-contrast-stretch(1.55x)');
  }

  ctx.putImageData(imgData, pad, pad);
  // Encode preprocessed Black-on-White text as lossless PNG so thin 1px '-' minus signs and '.' decimals
  // never suffer lossy WebP mosquito artifacts.
  const url = canvas.toDataURL('image/png');
  stepsExecuted.push('encode-lossless-png');
  canvas.width = 0;
  canvas.height = 0;

  return {
    dataUrl: url,
    telemetry: {
      mode,
      sourceWidth: srcW,
      sourceHeight: srcH,
      outputWidth: outW,
      outputHeight: outH,
      scaleApplied: Number(scale.toFixed(3)),
      paddingPx: pad,
      detectedBackground: isDarkBg ? 'dark' : 'light',
      backgroundLuma: Math.round(bgLum),
      encoding: 'image/png',
      preprocessMs: Date.now() - startMs,
      stepsExecuted,
    },
  };
}

/**
 * Generates a single Black-on-White OCR image variant on demand along with full preprocessing telemetry.
 */
export async function preparePrecisionOcrVariantWithTelemetry(
  dataUrl: string,
  mode: PrecisionOcrVariantMode = 'chromatic_sharp'
): Promise<{ dataUrl: string; telemetry: OcrPreprocessTelemetry | null }> {
  if (!isBrowserLikeEnv() || typeof Image === 'undefined') {
    return { dataUrl, telemetry: null };
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve({ dataUrl, telemetry: null });
    img.onload = () => {
      try {
        resolve(renderCanvasOcrVariantWithTelemetry(img, mode, dataUrl));
      } catch {
        resolve({ dataUrl, telemetry: null });
      }
    };
    img.src = dataUrl;
  });
}

/**
 * Generates a single Black-on-White OCR image variant on demand (avoids wasting CPU encoding unused variants).
 */
export async function preparePrecisionOcrVariant(
  dataUrl: string,
  mode: PrecisionOcrVariantMode = 'chromatic_sharp'
): Promise<string> {
  const { dataUrl: out } = await preparePrecisionOcrVariantWithTelemetry(dataUrl, mode);
  return out;
}

/**
 * Generates high-precision Black-on-White OCR image variants from a Data URL in the browser.
 */
export async function preparePrecisionOcrVariants(dataUrl: string): Promise<string[]> {
  if (!isBrowserLikeEnv() || typeof Image === 'undefined') {
    return [dataUrl];
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve([dataUrl]);
    img.onload = () => {
      try {
        const primary = renderCanvasOcrVariantWithTelemetry(img, 'chromatic_sharp', dataUrl).dataUrl;
        const soft = renderCanvasOcrVariantWithTelemetry(img, 'soft_luma', dataUrl).dataUrl;
        resolve(primary === soft ? [primary] : [primary, soft]);
      } catch {
        resolve([dataUrl]);
      }
    };
    img.src = dataUrl;
  });
}

function collectWordsFromTesseractData(data: any): OfflineOcrWordBox[] {
  const words: OfflineOcrWordBox[] = [];
  if (!data || !Array.isArray(data.blocks)) return words;

  for (const block of data.blocks) {
    const paragraphs = Array.isArray(block?.paragraphs) ? block.paragraphs : [];
    for (const para of paragraphs) {
      const lines = Array.isArray(para?.lines) ? para.lines : [];
      for (const line of lines) {
        const lineWords: Word[] = Array.isArray(line?.words) ? line.words : [];
        for (const w of lineWords) {
          const text = String(w?.text || '').trim();
          if (!text || !w?.bbox) continue;
          const x0 = Number(w.bbox.x0) || 0;
          const y0 = Number(w.bbox.y0) || 0;
          const x1 = Number(w.bbox.x1) || x0;
          const y1 = Number(w.bbox.y1) || y0;
          const width = Math.max(1, x1 - x0);
          const height = Math.max(1, y1 - y0);
          words.push({
            text,
            left: x0,
            top: y0,
            width,
            height,
            centerX: x0 + width / 2,
            centerY: y0 + height / 2,
          });
        }
      }
    }
  }
  return words;
}

function fastDataUrlToRecognizeInput(input: string | Buffer): string | Buffer | Blob {
  if (
    typeof input !== 'string' ||
    !input.startsWith('data:image/') ||
    !isBrowserLikeEnv() ||
    typeof Blob === 'undefined' ||
    typeof atob !== 'function'
  ) {
    return input;
  }
  try {
    const commaIdx = input.indexOf(',');
    if (commaIdx === -1) return input;
    const header = input.slice(0, commaIdx);
    const mimeMatch = header.match(/^data:([^;]+)/i);
    const mime = mimeMatch ? mimeMatch[1] : 'image/webp';
    const binStr = atob(input.slice(commaIdx + 1));
    const len = binStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binStr.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  } catch {
    return input;
  }
}

/**
 * Runs 100% offline on-device OCR on an image Data URL / Buffer / image source.
 * Serialized through `workerQueuePromise` so concurrent callers safely share one lightweight WASM worker.
 */
export async function runOfflineTesseractOcr(
  imageInput: string | Buffer,
  options?: { psm?: '3' | '4' | '6' | '11' }
): Promise<OfflineOcrResult> {
  let resultResolve!: (val: OfflineOcrResult) => void;
  let resultReject!: (err: unknown) => void;
  const outPromise = new Promise<OfflineOcrResult>((res, rej) => {
    resultResolve = res;
    resultReject = rej;
  });

  workerQueuePromise = workerQueuePromise.then(async () => {
    try {
      const { PSM } = await import('tesseract.js');
      const { worker, reused, initMs } = await getOfflineWorker();
      const targetPsm = options?.psm
        ? (options.psm as unknown as typeof PSM.SINGLE_BLOCK)
        : PSM.SINGLE_BLOCK;
      if (lastPsmApplied !== String(targetPsm)) {
        await worker.setParameters({
          tessedit_pageseg_mode: targetPsm,
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
        });
        lastPsmApplied = String(targetPsm);
      }

      const recognizeTarget = fastDataUrlToRecognizeInput(imageInput);
      const inputType =
        typeof Blob !== 'undefined' && recognizeTarget instanceof Blob
          ? `Blob(${recognizeTarget.type || 'bin'},${recognizeTarget.size}B)`
          : typeof Buffer !== 'undefined' && Buffer.isBuffer(recognizeTarget)
          ? `Buffer(${recognizeTarget.length}B)`
          : 'string';

      const recognizeStart = Date.now();
      let recognizeTimer: ReturnType<typeof setTimeout> | null = null;
      const recognized = await Promise.race([
        worker.recognize(recognizeTarget as any, {}, { text: true, blocks: true }),
        new Promise<never>((_, reject) => {
          recognizeTimer = setTimeout(() => {
            reject(new Error('Proses OCR offline melebihi batas waktu (25s).'));
          }, 25_000);
        }),
      ]).finally(() => {
        if (recognizeTimer !== null) clearTimeout(recognizeTimer);
      });
      const recognizeMs = Date.now() - recognizeStart;
      const words = collectWordsFromTesseractData(recognized?.data);
      const reconstructed = reconstructStructuredLinesFromWords(words);
      const rawText = String(recognized?.data?.text || '');
      const structuredText =
        reconstructed.length > 0
          ? reconstructed.map((l) => l.text).join('\n')
          : rawText;

      resultResolve({
        fullText: structuredText,
        lines: reconstructed,
        words,
        confidence: Number(recognized?.data?.confidence || 0),
        telemetry: {
          workerInitMs: initMs,
          workerReused: reused,
          recognizeMs,
          psm: String(targetPsm),
          inputType,
          resolvedAssets: { ...lastResolvedAssets },
        },
      });
    } catch (err) {
      // Terminate & reset cached worker if WASM threw or timed out so subsequent offline scans recover cleanly
      await terminateOfflineTesseractWorker().catch(() => {});
      resultReject(err);
    }
  });

  return outPromise;
}
