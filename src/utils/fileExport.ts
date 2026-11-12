import { Capacitor, registerPlugin } from '@capacitor/core';

export type ExportResult =
  | { status: 'saved'; fileName: string; bytesWritten: number }
  | { status: 'cancelled' };

export interface ExportFileOptions {
  data: Blob | string | Uint8Array;
  fileName: string;
  mimeType: string;
}

export interface WriteStagingChunkOptions {
  stagingId: string;
  base64Chunk: string;
  append: boolean;
  chunkIndex?: number;
}

export interface SaveStagedFileOptions {
  stagingId: string;
  fileName: string;
  mimeType: string;
}

export interface CleanupStagingOptions {
  stagingId: string;
}

export interface SafExportPluginInterface {
  writeStagingChunk(
    options: WriteStagingChunkOptions
  ): Promise<{ bytesStaged: number; chunkIndex: number }>;
  saveStagedFile(
    options: SaveStagedFileOptions
  ): Promise<{ status: 'saved' | 'cancelled'; fileName?: string; bytesWritten?: number }>;
  cleanupStaging(options: CleanupStagingOptions): Promise<{ cleaned: boolean }>;
}

export const SafExport = registerPlugin<SafExportPluginInterface>('SafExport');

/**
 * Ukuran chunk 510 KB (522.240 byte) — kelipatan 3 byte yang presisi
 * sehingga setiap potongan menghasilkan string Base64 tanpa padding '=' di tengah stream.
 */
export const SAF_CHUNK_SIZE_BYTES = 522240;

/**
 * Status mutex global lintas komponen untuk jalur ekspor native Android.
 */
let isAndroidExportActive = false;

/**
 * Memeriksa apakah terdapat proses ekspor native Android yang sedang berlangsung.
 */
export function isAndroidExportInProgress(): boolean {
  return isAndroidExportActive;
}

/**
 * Menghasilkan ID sesi staging acak secara kriptografis yang cocok dengan pola ^[a-zA-Z0-9_]{1,64}$.
 * Hanya menggunakan crypto.getRandomValues() tanpa fallback ke Math.random().
 */
export function generateStagingId(): string {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error(
      'CSPRNG_UNAVAILABLE: Sumber angka acak kriptografis (crypto.getRandomValues) tidak tersedia untuk membuat ID staging yang aman.'
    );
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return `s_${hex}`;
}

/**
 * Mengonversi Uint8Array menjadi string Base64 tanpa melebihi batas argumen call stack JS.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) return '';
  const SUB_CHUNK = 0x8000; // 32 KB per String.fromCharCode.apply
  const parts: string[] = [];
  for (let i = 0; i < bytes.byteLength; i += SUB_CHUNK) {
    const sub = bytes.subarray(i, Math.min(i + SUB_CHUNK, bytes.byteLength));
    parts.push(String.fromCharCode.apply(null, sub as unknown as number[]));
  }
  return btoa(parts.join(''));
}

/**
 * Mengekspor file menggunakan Native Android Storage Access Framework (ACTION_CREATE_DOCUMENT)
 * saat berjalan di platform native Capacitor, atau fallback ke anchor download di browser desktop.
 */
export async function exportFile(options: ExportFileOptions): Promise<ExportResult> {
  const { data, fileName, mimeType } = options;
  const sanitizedFileName = fileName.trim() || 'TradeVault_Export.bin';
  const resolvedMimeType = mimeType.trim() || 'application/octet-stream';

  if (Capacitor.isNativePlatform()) {
    if (isAndroidExportActive) {
      throw new Error(
        'BUSY: Ekspor file lain sedang berlangsung. Selesaikan atau batalkan proses penyimpanan sebelumnya terlebih dahulu.'
      );
    }

    isAndroidExportActive = true;
    let stagingId: string | null = null;

    try {
      stagingId = generateStagingId();

      if (data instanceof Blob) {
        const totalSize = data.size;
        if (totalSize === 0) {
          await SafExport.writeStagingChunk({
            stagingId,
            base64Chunk: '',
            append: false,
            chunkIndex: 0,
          });
        } else {
          let chunkIndex = 0;
          for (let offset = 0; offset < totalSize; offset += SAF_CHUNK_SIZE_BYTES) {
            const end = Math.min(offset + SAF_CHUNK_SIZE_BYTES, totalSize);
            const sliceBlob = data.slice(offset, end);
            const arrayBuffer = await sliceBlob.arrayBuffer();
            const chunkBytes = new Uint8Array(arrayBuffer);
            const base64Chunk = uint8ArrayToBase64(chunkBytes);

            await SafExport.writeStagingChunk({
              stagingId,
              base64Chunk,
              append: chunkIndex > 0,
              chunkIndex,
            });
            chunkIndex++;
          }
        }

        const saveRes = await SafExport.saveStagedFile({
          stagingId,
          fileName: sanitizedFileName,
          mimeType: resolvedMimeType,
        });

        if (saveRes.status === 'cancelled') {
          return { status: 'cancelled' };
        }
        return {
          status: 'saved',
          fileName: saveRes.fileName || sanitizedFileName,
          bytesWritten: typeof saveRes.bytesWritten === 'number' ? saveRes.bytesWritten : totalSize,
        };
      } else {
        const rawBytes =
          typeof data === 'string' ? new TextEncoder().encode(data) : data;
        const totalSize = rawBytes.byteLength;

        if (totalSize === 0) {
          await SafExport.writeStagingChunk({
            stagingId,
            base64Chunk: '',
            append: false,
            chunkIndex: 0,
          });
        } else {
          let chunkIndex = 0;
          for (let offset = 0; offset < totalSize; offset += SAF_CHUNK_SIZE_BYTES) {
            const end = Math.min(offset + SAF_CHUNK_SIZE_BYTES, totalSize);
            const chunkBytes = rawBytes.subarray(offset, end);
            const base64Chunk = uint8ArrayToBase64(chunkBytes);

            await SafExport.writeStagingChunk({
              stagingId,
              base64Chunk,
              append: chunkIndex > 0,
              chunkIndex,
            });
            chunkIndex++;
          }
        }

        const saveRes = await SafExport.saveStagedFile({
          stagingId,
          fileName: sanitizedFileName,
          mimeType: resolvedMimeType,
        });

        if (saveRes.status === 'cancelled') {
          return { status: 'cancelled' };
        }
        return {
          status: 'saved',
          fileName: saveRes.fileName || sanitizedFileName,
          bytesWritten: typeof saveRes.bytesWritten === 'number' ? saveRes.bytesWritten : totalSize,
        };
      }
    } catch (err) {
      if (stagingId !== null) {
        await SafExport.cleanupStaging({ stagingId }).catch(() => {});
      }
      throw err;
    } finally {
      isAndroidExportActive = false;
    }
  }

  // Fallback Browser Desktop
  const blob =
    data instanceof Blob
      ? data
      : typeof data === 'string'
      ? new Blob([data], { type: resolvedMimeType })
      : new Blob([data as unknown as BlobPart], { type: resolvedMimeType });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = sanitizedFileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60000);

  return {
    status: 'saved',
    fileName: sanitizedFileName,
    bytesWritten: blob.size,
  };
}
