/**
 * Offline On-Device MT5 / Chart OCR Engine powered by locally bundled Tesseract.js LSTM assets (`public/ocr/`).
 * - Zero external CDN calls (works 100% offline in both Web browser and Capacitor Android APK).
 * - Chromatic channel-max preprocessing preserves thin red '-' minus signs and blue profit digits in Dark Mode.
 * - Coordinate-aware Y-band reconstruction keeps split left/right MT5 columns aligned on the same row.
 */

import type { Worker, Word } from 'tesseract.js';

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
}

let cachedWorkerPromise: Promise<Worker> | null = null;
let workerQueuePromise: Promise<void> = Promise.resolve();

function isBrowserLikeEnv(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function resolveBrowserAssetUrl(relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, '');
  try {
    return new URL(clean, window.location.href).href;
  } catch {
    return `/${clean}`;
  }
}

async function createOfflineTesseractWorker(): Promise<Worker> {
  const tesseractMod = await import('tesseract.js');
  const { createWorker, OEM, PSM } = tesseractMod;

  if (isBrowserLikeEnv()) {
    const worker = await createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: resolveBrowserAssetUrl('ocr/worker.min.js'),
      corePath: resolveBrowserAssetUrl('ocr/tesseract-core-lstm.wasm.js'),
      langPath: resolveBrowserAssetUrl('ocr'),
      cacheMethod: 'write',
      gzip: true,
    });
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });
    return worker;
  }

  // Node.js execution path (used in automated verification scripts)
  const cwd = typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : '.';
  const localLangDir = `${cwd.replace(/[\\/]+$/, '')}/public/ocr`;
  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    langPath: localLangDir,
    cacheMethod: 'none',
    gzip: true,
  });
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.AUTO,
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
  });
  return worker;
}

async function getOfflineWorker(): Promise<Worker> {
  if (!cachedWorkerPromise) {
    cachedWorkerPromise = createOfflineTesseractWorker().catch((err) => {
      cachedWorkerPromise = null;
      throw err;
    });
  }
  return cachedWorkerPromise;
}

export async function terminateOfflineTesseractWorker(): Promise<void> {
  const existing = cachedWorkerPromise;
  cachedWorkerPromise = null;
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
    .filter((h) => Number.isFinite(h) && h > 0)
    .sort((a, b) => a - b);
  const medianH = heights.length > 0 ? heights[Math.floor(heights.length / 2)] : 18;
  const rowTolerance = Math.max(8, medianH * 0.62);

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
        lineText += gap > medianH * 1.4 ? `   ${cleanToken}` : ` ${cleanToken}`;
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
 * - Variant 0 (Primary): 2x upscaled + 24px white padding + Chromatic Contrast Extraction
 *   (uses max RGB channel delta from background so red '-' losses & blue profits become jet black).
 * - Variant 1 (Soft Fallback): 2x upscaled soft grayscale inversion without aggressive contrast cliff.
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
        const srcW = img.width;
        const srcH = img.height;
        if (!srcW || !srcH) {
          resolve([dataUrl]);
          return;
        }

        // Scale smaller screenshots up so tiny digits & thin '-' minus glyphs have 24-44px height
        const scale = srcW < 1100 ? Math.min(2.2, 1600 / srcW) : srcW < 1600 ? 1.4 : 1;
        const innerW = Math.round(srcW * scale);
        const innerH = Math.round(srcH * scale);
        const pad = 24;
        const outW = innerW + pad * 2;
        const outH = innerH + pad * 2;

        const renderVariant = (mode: 'chromatic_sharp' | 'soft_luma'): string => {
          const canvas = document.createElement('canvas');
          canvas.width = outW;
          canvas.height = outH;
          const ctx = canvas.getContext('2d');
          if (!ctx) return dataUrl;

          ctx.fillStyle = mode === 'chromatic_sharp' ? '#ffffff' : '#ffffff';
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
          const step = Math.max(16, Math.floor(pixels.length / 4000) * 4);
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

          for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];

            if (mode === 'chromatic_sharp') {
              // Chromatic channel delta preserves red negative profits and blue positive profits equally!
              const deltaR = isDarkBg ? r - bgR : bgR - r;
              const deltaG = isDarkBg ? g - bgG : bgG - g;
              const deltaB = isDarkBg ? b - bgB : bgB - b;
              const luma = 0.299 * r + 0.587 * g + 0.114 * b;
              const deltaLuma = isDarkBg ? luma - bgLum : bgLum - luma;

              const inkStrength = Math.max(0, deltaR, deltaG, deltaB, deltaLuma);
              // Smooth noise floor (<14) to crisp white; boost foreground (>24) to crisp black
              let v: number;
              if (inkStrength <= 12) {
                v = 255;
              } else {
                const normalized = Math.min(1, (inkStrength - 12) / 115);
                // Mild gamma makes thin strokes like '-' or '.' solid without thickening digits together
                v = Math.round(255 * (1 - Math.pow(normalized, 0.72)));
              }
              pixels[i] = v;
              pixels[i + 1] = v;
              pixels[i + 2] = v;
            } else {
              let lum = 0.299 * r + 0.587 * g + 0.114 * b;
              if (isDarkBg) lum = 255 - lum;
              const stretched = Math.max(
                0,
                Math.min(255, Math.round((lum - 128) * 1.35 + 128))
              );
              pixels[i] = stretched;
              pixels[i + 1] = stretched;
              pixels[i + 2] = stretched;
            }
            pixels[i + 3] = 255;
          }

          ctx.putImageData(imgData, pad, pad);
          const url = canvas.toDataURL('image/png');
          canvas.width = 0;
          canvas.height = 0;
          return url;
        };

        const primary = renderVariant('chromatic_sharp');
        const soft = renderVariant('soft_luma');
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
      const worker = await getOfflineWorker();
      const targetPsm = options?.psm
        ? (options.psm as unknown as typeof PSM.AUTO)
        : PSM.AUTO;
      await worker.setParameters({
        tessedit_pageseg_mode: targetPsm,
        preserve_interword_spaces: '1',
        user_defined_dpi: '300',
      });

      const recognized = await worker.recognize(
        imageInput,
        {},
        { text: true, blocks: true }
      );
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
      });
    } catch (err) {
      // Reset cached worker if WASM threw so subsequent offline scans recover cleanly
      cachedWorkerPromise = null;
      resultReject(err);
    }
  });

  return outPromise;
}
