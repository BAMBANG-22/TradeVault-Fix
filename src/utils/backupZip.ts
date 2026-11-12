import JSZip from 'jszip';
import { Trade } from '../types/trade';
import { AppSettings, DEFAULT_SETTINGS } from '../types/settings';
import {
  downloadScreenshotBlob,
  uploadScreenshotBlobToSupabase,
  isStoragePath,
  mergeTradesDatasets,
} from './supabaseSync';
import { validateAndNormalizeTradeRecord } from '../storage/idbAdapter';
import { computeSha256Hex } from '../storage/utf8Base64Url';

export type ScreenshotSourceType = 'storage' | 'base64' | 'external' | 'invalid' | 'none';

export interface ScreenshotTaskItem {
  tradeId: string;
  index: number;
  sourceType: ScreenshotSourceType;
  originalRef: string;
  archiveFileName?: string;
  bytes?: Uint8Array | Blob;
  ext?: string;
  status: 'pending' | 'success' | 'failed' | 'skipped_external';
  error?: string;
  sizeBytes?: number;
  sha256Hex?: string;
}

export interface ZipBackupProgress {
  phase: 'idle' | 'scanning' | 'downloading' | 'packaging' | 'completed' | 'error';
  currentStep: number;
  totalSteps: number;
  currentTradeId?: string;
  message: string;
  percent: number;
}

export interface ZipBackupFailedItem {
  tradeId: string;
  sourceType: ScreenshotSourceType;
  pathOrRef: string;
  error: string;
}

export interface ZipBackupManifest {
  appName: string;
  backupType: 'FULL_ZIP_BACKUP';
  version: string;
  exportDate: string;
  exportUser?: {
    id: string;
    email?: string;
  } | null;
  summary: {
    totalTrades: number;
    totalScreenshotsFound: number;
    storageScreenshots: number;
    base64Screenshots: number;
    externalScreenshots: number;
    archivedScreenshots: number;
    failedScreenshots: number;
    totalArchiveSizeBytes: number;
    isPartialBackup: boolean;
  };
  screenshotMappings: Array<{
    tradeId: string;
    sourceType: ScreenshotSourceType;
    archivePath?: string;
    status: 'archived' | 'failed' | 'skipped_external';
    safeReference: string;
    sizeBytes?: number;
    sha256Hex?: string;
    error?: string;
  }>;
  externalReferences: Array<{
    tradeId: string;
    url: string;
    note: string;
  }>;
  failedItems: ZipBackupFailedItem[];
}

export interface GenerateZipResult {
  success: boolean;
  blob?: Blob;
  fileName?: string;
  manifest: ZipBackupManifest;
  failedItems: ZipBackupFailedItem[];
  error?: string;
  canRetry?: boolean;
}

// 150MB warning threshold for export browser heap safety
export const MAX_SAFE_TOTAL_SIZE_BYTES = 150 * 1024 * 1024;

// 200MB maximum hard limit for restore archive file
export const MAX_RESTORE_ZIP_SIZE_BYTES = 200 * 1024 * 1024;

const ALLOWED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

export interface ImageMimeDetection {
  isValid: boolean;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | null;
  ext: 'jpg' | 'png' | 'webp';
  reason?: string;
}

/**
 * Validates binary magic byte signatures to detect exact MIME type and extension:
 * - JPEG: FF D8 FF -> image/jpeg (.jpg)
 * - PNG:  89 50 4E 47 -> image/png (.png)
 * - WebP: RIFF (bytes 0-3) + WEBP (bytes 8-11) -> image/webp (.webp)
 * Rejects corrupt, unsupported, or masquerading files (e.g. exe/txt named as jpg).
 */
export function detectImageMimeType(
  bytes: Uint8Array,
  fallbackExt?: string
): ImageMimeDetection {
  if (!bytes || bytes.length < 4) {
    return { isValid: false, mimeType: null, ext: 'jpg', reason: 'Ukuran file gambar terlalu kecil' };
  }

  // 1. JPEG signature: FF D8 FF
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return { isValid: true, mimeType: 'image/jpeg', ext: 'jpg' };
  }

  // 2. PNG signature: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    return { isValid: true, mimeType: 'image/png', ext: 'png' };
  }

  // 3. WebP signature: RIFF (bytes 0-3) + WEBP (bytes 8-11)
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { isValid: true, mimeType: 'image/webp', ext: 'webp' };
  }

  return {
    isValid: false,
    mimeType: null,
    ext: 'jpg',
    reason: 'Signature biner bukan berkas gambar yang didukung (harus JPG, PNG, atau WebP valid)',
  };
}

export interface ArchiveImageEntry {
  blob: Blob;
  ext: string;
  sizeBytes: number;
  mimeType: string;
}

export interface ParsedZipArchive {
  isValid: boolean;
  fileName: string;
  fileSize: number;
  manifest?: ZipBackupManifest;
  trades: Trade[];
  settings?: AppSettings;
  imagesMap: Map<string, ArchiveImageEntry>;
  totalParsedTrades: number;
  validTradesCount: number;
  invalidTradesCount: number;
  storageScreenshotsCount: number;
  base64ScreenshotsCount: number;
  externalScreenshotsCount: number;
  archivedImagesCount: number;
  errors: string[];
  warnings: string[];
}

export interface RestoreZipProgress {
  phase: 'parsing' | 'uploading_images' | 'saving_trades' | 'completed' | 'error';
  currentStep: number;
  totalSteps: number;
  currentTradeId?: string;
  message: string;
  percent: number;
}

export interface RestoreZipResult {
  success: boolean;
  restoredTrades: Trade[];
  restoredSettings?: AppSettings;
  uploadedScreenshotsCount: number;
  failedScreenshots: Array<{ tradeId: string; archivePath: string; error: string }>;
  duplicateTradesUpdated: number;
  newTradesAdded: number;
  unchangedTradesKept: number;
  error?: string;
}

export interface ExecuteZipRestoreOptions {
  archive: ParsedZipArchive;
  existingTrades: Trade[];
  currentUser?: { id: string; email?: string } | null;
  activeOwnerScope?: string | null;
  mode: 'replace' | 'merge';
  syncToCloud: boolean;
  uploadCache?: Map<string, string>; // archive key -> uploaded storage path
  allowPartialScreenshots?: boolean;
  onProgress?: (progress: RestoreZipProgress) => void;
  abortSignal?: AbortSignal;
}

/**
 * Converts a valid Base64 data URL to Uint8Array binary.
 */
export function parseBase64Image(dataUrl: string): {
  isValid: boolean;
  bytes?: Uint8Array;
  mimeType?: string;
  ext?: string;
} {
  try {
    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
    if (!match) return { isValid: false };
    const mimeType = match[1].toLowerCase();
    const rawBase64 = match[2];
    const binary = atob(rawBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    let ext = 'jpg';
    if (mimeType.includes('png')) ext = 'png';
    else if (mimeType.includes('webp')) ext = 'webp';
    else if (mimeType.includes('gif')) ext = 'gif';
    else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = 'jpg';
    return { isValid: true, bytes, mimeType, ext };
  } catch {
    return { isValid: false };
  }
}

/**
 * Helper to convert Blob to Base64 data URL (useful for guest/offline restore).
 * Non-throwing fail-safe implementation.
 */
export async function blobToBase64(blob: Blob, fallbackMime: string = 'image/jpeg'): Promise<string> {
  if (!blob || !(blob instanceof Blob)) return '';
  try {
    if (typeof FileReader === 'undefined') {
      const arrayBuf = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64Data = btoa(binary);
      const mime = blob.type && blob.type.startsWith('image/') ? blob.type : fallbackMime;
      return `data:${mime};base64,${base64Data}`;
    }
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          let result = reader.result;
          if (!result.startsWith('data:image/')) {
            const mime = blob.type && blob.type.startsWith('image/') ? blob.type : fallbackMime;
            const commaIdx = result.indexOf(',');
            const base64Data = commaIdx !== -1 ? result.slice(commaIdx + 1) : result;
            result = `data:${mime};base64,${base64Data}`;
          }
          resolve(result);
        } else {
          resolve('');
        }
      };
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
  } catch {
    return '';
  }
}

/**
 * Generates safe and sanitized file names for archive entries.
 * Strictly avoids user ID folder prefixes or untrusted path characters.
 */
export function generateSafeArchiveFileName(tradeId: string, index: number, ext = 'jpg'): string {
  const cleanId = String(tradeId).trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'trade';
  const cleanExt = ext.replace(/[^a-zA-Z0-9]/g, '') || 'jpg';
  return `trade_${cleanId}_${index + 1}.${cleanExt}`;
}

/**
 * Executes a full backup export producing a portable ZIP archive.
 */
export async function generateFullZipBackup(
  trades: Trade[],
  settings: AppSettings,
  currentUser: { id: string; email?: string } | null,
  onProgress?: (p: ZipBackupProgress) => void,
  options?: {
    allowPartial?: boolean;
    abortSignal?: AbortSignal;
  }
): Promise<GenerateZipResult> {
  const allowPartial = options?.allowPartial ?? false;
  const abortSignal = options?.abortSignal;

  onProgress?.({
    phase: 'scanning',
    currentStep: 0,
    totalSteps: trades.length,
    message: 'Memindai transaksi dan referensi screenshot...',
    percent: 5,
  });

  // Step 1: Scan and categorize screenshots
  const taskItems: ScreenshotTaskItem[] = [];
  let storageCount = 0;
  let base64Count = 0;
  let externalCount = 0;

  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    const rawUrl = t.screenshotUrl ? String(t.screenshotUrl).trim() : '';

    if (!rawUrl) {
      continue;
    }

    if (rawUrl.startsWith('data:image/')) {
      base64Count++;
      taskItems.push({
        tradeId: t.id,
        index: i,
        sourceType: 'base64',
        originalRef: rawUrl,
        status: 'pending',
      });
    } else if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
      externalCount++;
      taskItems.push({
        tradeId: t.id,
        index: i,
        sourceType: 'external',
        originalRef: rawUrl,
        status: 'skipped_external',
      });
    } else if (isStoragePath(rawUrl)) {
      storageCount++;
      taskItems.push({
        tradeId: t.id,
        index: i,
        sourceType: 'storage',
        originalRef: rawUrl,
        status: 'pending',
      });
    } else {
      taskItems.push({
        tradeId: t.id,
        index: i,
        sourceType: 'invalid',
        originalRef: rawUrl,
        status: 'failed',
        error: 'Format path atau URL screenshot tidak dikenali.',
      });
    }
  }

  const downloadableItems = taskItems.filter(
    (item) => item.sourceType === 'storage' || item.sourceType === 'base64'
  );
  const totalDownloadSteps = downloadableItems.length;

  onProgress?.({
    phase: 'downloading',
    currentStep: 0,
    totalSteps: totalDownloadSteps,
    message: `Menyiapkan unduhan ${totalDownloadSteps} file screenshot...`,
    percent: 10,
  });

  // Step 2: Download / extract images with controlled concurrency (2 at a time)
  let completedDownloads = 0;
  let totalAccumulatedBytes = 0;
  const failedItems: ZipBackupFailedItem[] = [];

  const CONCURRENCY = 2;
  for (let i = 0; i < downloadableItems.length; i += CONCURRENCY) {
    if (abortSignal?.aborted) {
      throw new Error('Proses backup dibatalkan oleh pengguna.');
    }

    const chunk = downloadableItems.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (item) => {
        if (abortSignal?.aborted) return;

        try {
          if (item.sourceType === 'base64') {
            const parsed = parseBase64Image(item.originalRef);
            if (!parsed.isValid || !parsed.bytes) {
              item.status = 'failed';
              item.error = 'Data Base64 gambar tidak valid atau rusak.';
              failedItems.push({
                tradeId: item.tradeId,
                sourceType: 'base64',
                pathOrRef: 'data:image/...',
                error: item.error || 'Terjadi kesalahan saat memproses screenshot.',
              });
            } else {
              item.status = 'success';
              item.bytes = parsed.bytes;
              item.ext = parsed.ext || 'jpg';
              item.archiveFileName = generateSafeArchiveFileName(item.tradeId, item.index, item.ext);
              item.sizeBytes = parsed.bytes.byteLength;
              item.sha256Hex = await computeSha256Hex(parsed.bytes);
              totalAccumulatedBytes += item.sizeBytes;
            }
          } else if (item.sourceType === 'storage') {
            if (!currentUser?.id) {
              item.status = 'failed';
              item.error = 'Sesi pengguna Supabase tidak aktif. Tidak dapat mengunduh storage privat.';
              failedItems.push({
                tradeId: item.tradeId,
                sourceType: 'storage',
                pathOrRef: item.originalRef,
                error: item.error || 'Terjadi kesalahan saat memproses screenshot.',
              });
            } else {
              const res = await downloadScreenshotBlob(item.originalRef, currentUser.id);
              if (!res.success || !res.blob) {
                item.status = 'failed';
                item.error = res.error || 'Gagal mengunduh file dari storage.';
                failedItems.push({
                  tradeId: item.tradeId,
                  sourceType: 'storage',
                  pathOrRef: item.originalRef,
                  error: item.error || 'Terjadi kesalahan saat memproses screenshot.',
                });
              } else {
                item.status = 'success';
                item.bytes = res.blob;
                let ext = 'jpg';
                if (res.contentType?.includes('png') || item.originalRef.endsWith('.png')) ext = 'png';
                else if (res.contentType?.includes('webp') || item.originalRef.endsWith('.webp')) ext = 'webp';
                item.ext = ext;
                item.archiveFileName = generateSafeArchiveFileName(item.tradeId, item.index, ext);
                item.sizeBytes = res.blob.size;
                const blobBytes = new Uint8Array(await res.blob.arrayBuffer());
                item.sha256Hex = await computeSha256Hex(blobBytes);
                totalAccumulatedBytes += item.sizeBytes;
              }
            }
          }
        } catch (err: any) {
          item.status = 'failed';
          item.error = err?.message || 'Kesalahan tidak terduga saat memproses screenshot.';
          failedItems.push({
            tradeId: item.tradeId,
            sourceType: item.sourceType,
            pathOrRef: item.originalRef.slice(0, 80),
            error: item.error || 'Terjadi kesalahan saat memproses screenshot.',
          });
        } finally {
          completedDownloads++;
          const progressPercent =
            totalDownloadSteps > 0
              ? Math.min(85, Math.round(10 + (completedDownloads / totalDownloadSteps) * 75))
              : 85;

          onProgress?.({
            phase: 'downloading',
            currentStep: completedDownloads,
            totalSteps: totalDownloadSteps,
            currentTradeId: item.tradeId,
            message: `Mengunduh screenshot ${completedDownloads} dari ${totalDownloadSteps}...`,
            percent: progressPercent,
          });
        }
      })
    );
  }

  // Also record invalid format items in failedItems
  for (const item of taskItems) {
    if (item.sourceType === 'invalid') {
      failedItems.push({
        tradeId: item.tradeId,
        sourceType: 'invalid',
        pathOrRef: item.originalRef.slice(0, 80),
        error: item.error || 'Format screenshot tidak valid.',
      });
    }
  }

  // Build manifest structure
  const successfulArchived = taskItems.filter((t) => t.status === 'success');
  const externalItems = taskItems.filter((t) => t.sourceType === 'external');

  const manifest: ZipBackupManifest = {
    appName: 'TradeVault Journal',
    backupType: 'FULL_ZIP_BACKUP',
    version: '1.0',
    exportDate: new Date().toISOString(),
    exportUser: currentUser
      ? {
          id: currentUser.id,
          email: currentUser.email || undefined,
        }
      : null,
    summary: {
      totalTrades: trades.length,
      totalScreenshotsFound: taskItems.length,
      storageScreenshots: storageCount,
      base64Screenshots: base64Count,
      externalScreenshots: externalCount,
      archivedScreenshots: successfulArchived.length,
      failedScreenshots: failedItems.length,
      totalArchiveSizeBytes: totalAccumulatedBytes,
      isPartialBackup: failedItems.length > 0,
    },
    screenshotMappings: taskItems.map((item) => {
      let safeRef = '';
      if (item.sourceType === 'base64') safeRef = 'Base64 DataURL (disimpan sebagai biner arsip)';
      else if (item.sourceType === 'external') safeRef = item.originalRef;
      else safeRef = item.originalRef;

      return {
        tradeId: item.tradeId,
        sourceType: item.sourceType,
        archivePath: item.archiveFileName ? `screenshots/${item.archiveFileName}` : undefined,
        status:
          item.status === 'success'
            ? 'archived'
            : item.status === 'skipped_external'
            ? 'skipped_external'
            : 'failed',
        safeReference: safeRef,
        sizeBytes: item.sizeBytes,
        sha256Hex: item.sha256Hex,
        error: item.error,
      };
    }),
    externalReferences: externalItems.map((item) => ({
      tradeId: item.tradeId,
      url: item.originalRef,
      note: 'Gambar eksternal tidak diunduh ke arsip lokal untuk menjaga stabilitas dan ketersediaan sumber asli.',
    })),
    failedItems,
  };

  // If there are failures and user did NOT allow partial, HALT HERE
  if (failedItems.length > 0 && !allowPartial) {
    onProgress?.({
      phase: 'error',
      currentStep: completedDownloads,
      totalSteps: totalDownloadSteps,
      message: `${failedItems.length} file screenshot gagal diunduh. Cadangan lengkap belum dapat dibuat.`,
      percent: 85,
    });

    return {
      success: false,
      manifest,
      failedItems,
      canRetry: true,
      error: `Terdapat ${failedItems.length} file screenshot yang gagal diunduh dari Supabase Storage.`,
    };
  }

  // Step 3: Package into JSZip
  onProgress?.({
    phase: 'packaging',
    currentStep: completedDownloads,
    totalSteps: totalDownloadSteps,
    message: 'Mengemas file manifest, data transaksi, dan folder screenshot ke arsip ZIP...',
    percent: 88,
  });

  const zip = new JSZip();

  // 1. manifest.json
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  // 2. trades.json
  const tradesData = {
    appName: 'TradeVault Journal',
    version: '1.0',
    exportDate: manifest.exportDate,
    settings,
    trades: trades.map((t) => {
      const match = taskItems.find((task) => task.tradeId === t.id && task.status === 'success');
      return {
        ...t,
        _archivedScreenshot: match?.archiveFileName ? `screenshots/${match.archiveFileName}` : undefined,
      };
    }),
  };
  zip.file('trades.json', JSON.stringify(tradesData, null, 2));

  // 3. screenshots/ folder
  const screenshotsFolder = zip.folder('screenshots');
  if (screenshotsFolder) {
    for (const item of successfulArchived) {
      if (item.archiveFileName && item.bytes) {
        screenshotsFolder.file(item.archiveFileName, item.bytes, { binary: true });
      }
    }
  }

  // Generate ZIP blob
  const zipBlob = await zip.generateAsync(
    {
      type: 'blob',
      mimeType: 'application/zip',
      compression: 'DEFLATE',
      compressionOptions: {
        level: 1,
      },
    },
    (metadata) => {
      const packPercent = Math.min(99, Math.round(88 + (metadata.percent / 100) * 11));
      onProgress?.({
        phase: 'packaging',
        currentStep: completedDownloads,
        totalSteps: totalDownloadSteps,
        message: `Mengompresi arsip ZIP (${metadata.percent.toFixed(0)}%)...`,
        percent: packPercent,
      });
    }
  );

  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `TradeVault_FullBackup_${dateStr}.zip`;

  onProgress?.({
    phase: 'completed',
    currentStep: completedDownloads,
    totalSteps: totalDownloadSteps,
    message: 'Arsip backup ZIP berhasil dibuat.',
    percent: 100,
  });

  return {
    success: true,
    blob: zipBlob,
    fileName,
    manifest,
    failedItems,
  };
}

/**
 * ============================================================================
 * TAHAP 2: RESTORE BACKUP LENGKAP ZIP
 * ============================================================================
 */

/**
 * Validates and parses a ZIP archive file in memory.
 * Strictly verifies paths, structural integrity, and extracts images without executing or trusting raw metadata.
 */
export async function parseAndValidateZipArchive(file: File): Promise<ParsedZipArchive> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const imagesMap = new Map<string, ArchiveImageEntry>();

  // 1. File size check
  if (file.size > MAX_RESTORE_ZIP_SIZE_BYTES) {
    errors.push(
      `Ukuran file arsip (${(file.size / (1024 * 1024)).toFixed(1)} MB) melebihi batas maksimum 200 MB.`
    );
    return {
      isValid: false,
      fileName: file.name,
      fileSize: file.size,
      trades: [],
      imagesMap,
      totalParsedTrades: 0,
      validTradesCount: 0,
      invalidTradesCount: 0,
      storageScreenshotsCount: 0,
      base64ScreenshotsCount: 0,
      externalScreenshotsCount: 0,
      archivedImagesCount: 0,
      errors,
      warnings,
    };
  }

  // 2. Load with JSZip
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (err: any) {
    errors.push(`File tidak dapat dibuka sebagai arsip ZIP yang valid: ${err.message || 'Format tidak dikenali'}`);
    return {
      isValid: false,
      fileName: file.name,
      fileSize: file.size,
      trades: [],
      imagesMap,
      totalParsedTrades: 0,
      validTradesCount: 0,
      invalidTradesCount: 0,
      storageScreenshotsCount: 0,
      base64ScreenshotsCount: 0,
      externalScreenshotsCount: 0,
      archivedImagesCount: 0,
      errors,
      warnings,
    };
  }

  // 3. Strict security check on entry paths: Path traversal & dangerous character prevention
  for (const relativePath of Object.keys(zip.files)) {
    if (
      relativePath.includes('..') ||
      relativePath.startsWith('/') ||
      relativePath.startsWith('\\') ||
      relativePath.includes(':') ||
      relativePath.includes('\0')
    ) {
      errors.push(`File arsip ditolak: Terdeteksi path tidak aman ("${relativePath}").`);
      return {
        isValid: false,
        fileName: file.name,
        fileSize: file.size,
        trades: [],
        imagesMap,
        totalParsedTrades: 0,
        validTradesCount: 0,
        invalidTradesCount: 0,
        storageScreenshotsCount: 0,
        base64ScreenshotsCount: 0,
        externalScreenshotsCount: 0,
        archivedImagesCount: 0,
        errors,
        warnings,
      };
    }
  }

  // 4. Manifest parsing (optional but verified if present)
  let manifest: ZipBackupManifest | undefined;
  const manifestFile = zip.file('manifest.json');
  if (manifestFile) {
    try {
      const manifestText = await manifestFile.async('text');
      manifest = JSON.parse(manifestText);
      if (manifest && manifest.backupType !== 'FULL_ZIP_BACKUP') {
        warnings.push('Header manifest tidak mencantumkan FULL_ZIP_BACKUP, memvalidasi data trades...');
      }
    } catch (e: any) {
      warnings.push(`File manifest.json tidak dapat dibaca: ${e.message}`);
    }
  }

  // 5. Trades data parsing
  let parsedTradesRaw: any[] = [];
  let fileSettings: AppSettings | undefined;

  const tradesFile = zip.file('trades.json') || zip.file('backup.json');
  if (!tradesFile) {
    // Search for any .json file at root that could contain trades
    const jsonFiles = Object.keys(zip.files).filter(
      (name) => !zip.files[name].dir && name.endsWith('.json') && !name.includes('/') && name !== 'manifest.json'
    );
    if (jsonFiles.length > 0) {
      try {
        const text = await zip.file(jsonFiles[0])!.async('text');
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          parsedTradesRaw = parsed;
        } else if (parsed && Array.isArray(parsed.trades)) {
          parsedTradesRaw = parsed.trades;
          fileSettings = parsed.settings;
        }
      } catch (e: any) {
        errors.push(`Gagal membaca file JSON transaksi alternatif: ${e.message}`);
      }
    } else {
      errors.push('File trades.json tidak ditemukan di dalam arsip ZIP.');
    }
  } else {
    try {
      const text = await tradesFile.async('text');
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        parsedTradesRaw = parsed;
      } else if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.trades)) {
          parsedTradesRaw = parsed.trades;
        } else {
          errors.push('Struktur trades.json tidak memiliki daftar array transaksi.');
        }
        if (parsed.settings && typeof parsed.settings === 'object') {
          fileSettings = parsed.settings;
        }
      }
    } catch (e: any) {
      errors.push(`File trades.json rusak atau bukan JSON valid: ${e.message}`);
    }
  }

  // 6. Validate individual trades using strict 28-field validator
  const validTrades: Trade[] = [];
  let invalidTradesCount = 0;
  const validationOwnerScope = manifest?.exportUser?.id || 'GUEST';

  for (const t of parsedTradesRaw) {
    try {
      if (
        !t ||
        typeof t !== 'object' ||
        typeof t.id !== 'string' ||
        typeof t.dateTime !== 'string' ||
        typeof t.entryPrice !== 'number' ||
        typeof t.netProfit !== 'number' ||
        !Number.isFinite(t.entryPrice) ||
        t.entryPrice <= 0 ||
        !Number.isFinite(t.netProfit)
      ) {
        invalidTradesCount++;
        continue;
      }
      const validationRes = validateAndNormalizeTradeRecord(t, validationOwnerScope);
      if (!validationRes.isValid || !validationRes.normalizedTrade) {
        invalidTradesCount++;
        continue;
      }
      const normalized: Trade = { ...validationRes.normalizedTrade };
      if (typeof (t as any)._archivedScreenshot === 'string') {
        (normalized as any)._archivedScreenshot = (t as any)._archivedScreenshot;
      }
      validTrades.push(normalized);
    } catch {
      invalidTradesCount++;
    }
  }

  if (validTrades.length === 0 && parsedTradesRaw.length > 0) {
    errors.push('Semua entri transaksi dalam trades.json tidak memenuhi kriteria validasi.');
  }

  // 7. Extract and index images from zip entries (with SHA-256 verification against manifest)
  for (const [entryPath, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;

    // Check if under screenshots/ or has image extension
    const parts = entryPath.split('/');
    const fileNameOnly = parts[parts.length - 1];
    const ext = fileNameOnly.split('.').pop()?.toLowerCase() || '';

    if (ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
      // Validate safe file name characters
      if (!/^[a-zA-Z0-9_.-]+$/.test(fileNameOnly)) {
        warnings.push(`File gambar "${fileNameOnly}" diabaikan karena karakter nama tidak aman.`);
        continue;
      }

      try {
        const bytes = await zipEntry.async('uint8array');
        if (!bytes || bytes.length === 0) {
          warnings.push(`File gambar "${fileNameOnly}" kosong (0 bytes).`);
          continue;
        }

        const detection = detectImageMimeType(bytes, ext);
        if (!detection.isValid || !detection.mimeType) {
          warnings.push(
            `File gambar "${fileNameOnly}" diabaikan karena bukan format gambar yang valid (${detection.reason || 'signature tidak dikenal'}).`
          );
          continue;
        }

        // Verify SHA-256 checksum if manifest specifies one for this archive entry
        if (manifest && Array.isArray(manifest.screenshotMappings)) {
          const matchingMapping = manifest.screenshotMappings.find(
            (m) =>
              m.archivePath === entryPath ||
              m.archivePath === `screenshots/${fileNameOnly}`
          );
          if (matchingMapping && typeof matchingMapping.sha256Hex === 'string' && matchingMapping.sha256Hex.length === 64) {
            const actualSha256 = await computeSha256Hex(bytes);
            if (actualSha256.toLowerCase() !== matchingMapping.sha256Hex.toLowerCase()) {
              errors.push(
                `Integritas file screenshot "${entryPath}" gagal diverifikasi (SHA-256 mismatch).`
              );
              continue;
            }
          }
        }

        // Construct Blob with strictly typed image MIME type (never application/octet-stream)
        const blob = new Blob([bytes as any], { type: detection.mimeType });
        const entry: ArchiveImageEntry = {
          blob,
          ext: detection.ext,
          sizeBytes: blob.size,
          mimeType: detection.mimeType,
        };

        // Key by full entry path, bare filename, and relative path without screenshots/
        imagesMap.set(entryPath, entry);
        imagesMap.set(fileNameOnly, entry);
        if (entryPath.startsWith('screenshots/')) {
          imagesMap.set(entryPath.replace(/^screenshots\//, ''), entry);
        }
      } catch (err: any) {
        warnings.push(`Gagal mengekstrak file gambar "${entryPath}": ${err.message}`);
      }
    }
  }

  // 8. Analyze trade screenshot references
  let storageScreenshotsCount = 0;
  let base64ScreenshotsCount = 0;
  let externalScreenshotsCount = 0;

  for (const trade of validTrades) {
    const rawRef = trade.screenshotUrl ? String(trade.screenshotUrl).trim() : '';
    const archivedRef = (trade as any)._archivedScreenshot ? String((trade as any)._archivedScreenshot).trim() : '';

    if (archivedRef || imagesMap.has(rawRef) || (rawRef && imagesMap.has(rawRef.split('/').pop() || ''))) {
      storageScreenshotsCount++;
    } else if (rawRef.startsWith('data:image/')) {
      base64ScreenshotsCount++;
    } else if (rawRef.startsWith('http://') || rawRef.startsWith('https://')) {
      externalScreenshotsCount++;
    } else if (isStoragePath(rawRef)) {
      storageScreenshotsCount++;
    }
  }

  const isValid = errors.length === 0 && validTrades.length > 0;

  return {
    isValid,
    fileName: file.name,
    fileSize: file.size,
    manifest,
    trades: validTrades,
    settings: fileSettings,
    imagesMap,
    totalParsedTrades: parsedTradesRaw.length,
    validTradesCount: validTrades.length,
    invalidTradesCount,
    storageScreenshotsCount,
    base64ScreenshotsCount,
    externalScreenshotsCount,
    archivedImagesCount: imagesMap.size / 2, // Divided by 2 since stored by path and filename
    errors,
    warnings,
  };
}

/**
 * Executes restoration of trades, settings, and screenshot uploads from a validated ZIP archive.
 * Follows strict non-destructive rules, session verification, and folder isolation under auth.uid().
 */
export async function executeZipRestore(options: ExecuteZipRestoreOptions): Promise<RestoreZipResult> {
  const {
    archive,
    existingTrades,
    currentUser,
    mode,
    uploadCache = new Map<string, string>(),
    allowPartialScreenshots = false,
    onProgress,
    abortSignal,
  } = options;

  onProgress?.({
    phase: 'parsing',
    currentStep: 0,
    totalSteps: archive.trades.length,
    message: 'Mempersiapkan pemulihan transaksi dan file gambar...',
    percent: 5,
  });

  const workingTrades: Trade[] = archive.trades.map((t) => ({ ...t }));
  const preparedTrades: Trade[] = [];
  const failedScreenshots: Array<{ tradeId: string; archivePath: string; error: string }> = [];
  let successfulUploads = 0;

  // Total steps for progress = number of trades with archived or inline Base64 images
  const tradesWithImages: Array<{ trade: Trade; imageKey: string; entry: ArchiveImageEntry }> = [];

  for (const t of workingTrades) {
    const rawRef = t.screenshotUrl ? String(t.screenshotUrl).trim() : '';
    const archivedRef = (t as any)._archivedScreenshot ? String((t as any)._archivedScreenshot).trim() : '';

    let matchedEntry: ArchiveImageEntry | undefined;
    let matchedKey = '';

    // Check candidate keys against imagesMap
    const candidateKeys = [
      archivedRef,
      archivedRef.split('/').pop() || '',
      rawRef,
      rawRef.split('/').pop() || '',
    ].filter(Boolean);

    for (const key of candidateKeys) {
      if (archive.imagesMap.has(key)) {
        matchedEntry = archive.imagesMap.get(key);
        matchedKey = key;
        break;
      }
    }

    if (matchedEntry) {
      tradesWithImages.push({ trade: t, imageKey: matchedKey, entry: matchedEntry });
    } else if (rawRef.startsWith('data:image/') && currentUser?.id) {
      // Handle inline Base64 screenshot inside ZIP trades.json when logged in
      const parsed = parseBase64Image(rawRef);
      if (parsed.isValid && parsed.bytes) {
        const mimeType = parsed.mimeType || 'image/jpeg';
        const ext = parsed.ext || 'jpg';
        const blob = new Blob([parsed.bytes as any], { type: mimeType });
        const inlineKey = `inline_base64::${t.id}::${rawRef.length}::${rawRef.slice(0, 48)}::${rawRef.slice(-48)}`;
        tradesWithImages.push({
          trade: t,
          imageKey: inlineKey,
          entry: { blob, ext, sizeBytes: blob.size, mimeType },
        });
      } else {
        failedScreenshots.push({
          tradeId: t.id,
          archivePath: 'data:image/...',
          error: 'Data Base64 screenshot di dalam trades.json tidak valid atau rusak.',
        });
      }
    }
  }

  const totalImageUploadSteps = tradesWithImages.length;

  onProgress?.({
    phase: 'uploading_images',
    currentStep: 0,
    totalSteps: totalImageUploadSteps,
    message: totalImageUploadSteps > 0
      ? `Mengunggah ${totalImageUploadSteps} file screenshot ke storage privat...`
      : 'Memproses transaksi...',
    percent: 10,
  });

  // Step 1: Upload or convert screenshots with controlled concurrency
  let processedUploadSteps = 0;
  const CONCURRENCY = 2;

  for (let i = 0; i < tradesWithImages.length; i += CONCURRENCY) {
    if (abortSignal?.aborted) {
      throw new Error('Proses pemulihan dibatalkan oleh pengguna.');
    }

    const chunk = tradesWithImages.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (item) => {
        if (abortSignal?.aborted) return;

        const { trade, imageKey, entry } = item;

        try {
          if (currentUser?.id) {
            // Check upload cache first (prevents re-uploading on retry)
            if (uploadCache.has(imageKey)) {
              trade.screenshotUrl = uploadCache.get(imageKey)!;
              successfulUploads++;
            } else {
              // Upload to active user's folder strictly under auth.uid()
              const uploadRes = await uploadScreenshotBlobToSupabase(
                entry.blob,
                trade.id,
                currentUser.id,
                entry.ext
              );

              if (uploadRes.success && uploadRes.data) {
                uploadCache.set(imageKey, uploadRes.data);
                trade.screenshotUrl = uploadRes.data;
                successfulUploads++;
              } else {
                failedScreenshots.push({
                  tradeId: trade.id,
                  archivePath: imageKey,
                  error: uploadRes.error || 'Gagal mengunggah file ke Supabase Storage.',
                });
                // Do NOT leave a broken or untrusted storage path on the working copy
                trade.screenshotUrl = undefined;
              }
            }
          } else {
            // Unauthenticated guest: convert to Base64 data URL so guest can view locally
            const dataUrl = await blobToBase64(entry.blob, entry.mimeType || 'image/jpeg');
            trade.screenshotUrl = dataUrl;
            successfulUploads++;
          }
        } catch (err: any) {
          failedScreenshots.push({
            tradeId: trade.id,
            archivePath: imageKey,
            error: err.message || 'Kesalahan saat memproses gambar.',
          });
          trade.screenshotUrl = undefined;
        } finally {
          processedUploadSteps++;
          const progressPercent = totalImageUploadSteps > 0
            ? Math.min(85, Math.round(10 + (processedUploadSteps / totalImageUploadSteps) * 75))
            : 85;

          onProgress?.({
            phase: 'uploading_images',
            currentStep: processedUploadSteps,
            totalSteps: totalImageUploadSteps,
            currentTradeId: trade.id,
            message: `Memulihkan screenshot ${processedUploadSteps} dari ${totalImageUploadSteps}...`,
            percent: progressPercent,
          });
        }
      })
    );
  }

  // If there are failed screenshot uploads and partial restore is NOT explicitly accepted:
  // Halt before touching local state or Supabase database!
  if (failedScreenshots.length > 0 && !allowPartialScreenshots) {
    onProgress?.({
      phase: 'error',
      currentStep: processedUploadSteps,
      totalSteps: totalImageUploadSteps,
      message: `${failedScreenshots.length} screenshot gagal diunggah. Pemulihan dihentikan untuk melindungi kelengkapan data.`,
      percent: 85,
    });

    return {
      success: false,
      restoredTrades: [],
      uploadedScreenshotsCount: successfulUploads,
      failedScreenshots,
      duplicateTradesUpdated: 0,
      newTradesAdded: 0,
      unchangedTradesKept: 0,
      error: `Terdapat ${failedScreenshots.length} file screenshot yang gagal diunggah ke storage.`,
    };
  }

  // Step 2: Clean up trades (strip temporary _archivedScreenshot tag and sanitize paths)
  for (const t of workingTrades) {
    const cleanTrade = { ...t };
    delete (cleanTrade as any)._archivedScreenshot;

    // If screenshot is a storage path from another user account and not in imagesMap:
    // Sanitize to prevent broken image references
    if (
      cleanTrade.screenshotUrl &&
      isStoragePath(cleanTrade.screenshotUrl) &&
      currentUser?.id &&
      !cleanTrade.screenshotUrl.startsWith(`${currentUser.id}/`)
    ) {
      // Path belongs to a different user and was not re-uploaded from the ZIP
      cleanTrade.screenshotUrl = undefined;
    }

    // Guest mode: strip any unresolved cloud storage paths that cannot be displayed locally
    if (!currentUser?.id && cleanTrade.screenshotUrl && isStoragePath(cleanTrade.screenshotUrl)) {
      cleanTrade.screenshotUrl = undefined;
    }

    preparedTrades.push(cleanTrade);
  }

  // Step 3: Compute final trades list according to Merge or Replace mode using canonical owner-scoped UUID matching
  const verifiedOwnerScope = options.activeOwnerScope || (currentUser?.id ? currentUser.id : 'GUEST');
  const mergeOutcome = mergeTradesDatasets(
    existingTrades,
    preparedTrades,
    mode,
    verifiedOwnerScope
  );
  const finalTrades: Trade[] = mergeOutcome.finalTrades;
  const duplicateTradesUpdated = mergeOutcome.updatedCount;
  const newTradesAdded = mergeOutcome.addedCount;
  const unchangedTradesKept = mergeOutcome.keptCount;

  onProgress?.({
    phase: 'saving_trades',
    currentStep: totalImageUploadSteps,
    totalSteps: totalImageUploadSteps,
    message: 'Menyelesaikan pemulihan transaksi...',
    percent: 95,
  });

  onProgress?.({
    phase: 'completed',
    currentStep: totalImageUploadSteps,
    totalSteps: totalImageUploadSteps,
    message: 'Pemulihan data dan screenshot berhasil.',
    percent: 100,
  });

  return {
    success: true,
    restoredTrades: finalTrades,
    restoredSettings: archive.settings,
    uploadedScreenshotsCount: successfulUploads,
    failedScreenshots,
    duplicateTradesUpdated,
    newTradesAdded,
    unchangedTradesKept,
  };
}
