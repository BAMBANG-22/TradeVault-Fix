import { Trade } from '../types/trade';
import { AppSettings } from '../types/settings';

export type OfflineSyncOperation =
  | {
      id: string;
      kind: 'upsert_trade';
      trade: Trade;
      originalId?: string;
      isEdit: boolean;
      queuedAt: number;
    }
  | {
      id: string;
      kind: 'delete_trade';
      tradeId: string;
      storagePathsToClean?: string[];
      queuedAt: number;
    }
  | {
      id: string;
      kind: 'update_settings';
      settings: AppSettings;
      queuedAt: number;
    };

const OFFLINE_SYNC_QUEUE_PREFIX = 'tradevault_offline_sync_queue_v1:';

function getQueueStorageKey(userId: string): string {
  return `${OFFLINE_SYNC_QUEUE_PREFIX}${userId}`;
}

export function isBrowserOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

export function isLikelyOfflineOrNetworkError(errorMsg?: string | null): boolean {
  if (!isBrowserOnline()) return true;
  if (!errorMsg) return false;
  const lower = errorMsg.toLowerCase();
  return (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network request failed') ||
    lower.includes('load failed') ||
    lower.includes('err_internet_disconnected') ||
    lower.includes('err_network') ||
    lower.includes('offline') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('fetch failed') ||
    lower.includes('tidak ada koneksi') ||
    lower.includes('koneksi internet')
  );
}

export function loadOfflineSyncQueue(userId: string | null | undefined): OfflineSyncOperation[] {
  if (!userId || typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(getQueueStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is OfflineSyncOperation =>
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        (item.kind === 'upsert_trade' ||
          item.kind === 'delete_trade' ||
          item.kind === 'update_settings')
    );
  } catch {
    return [];
  }
}

export function saveOfflineSyncQueue(
  userId: string | null | undefined,
  ops: OfflineSyncOperation[]
): { success: boolean; error?: string } {
  if (!userId || typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return { success: false, error: 'Storage tidak tersedia.' };
  }
  try {
    const key = getQueueStorageKey(userId);
    if (ops.length === 0) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(ops));
    }
    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error:
        err?.name === 'QuotaExceededError'
          ? 'Kapasitas penyimpanan luring perangkat penuh. Hapus sebagian screenshot lama atau lakukan backup.'
          : 'Gagal menyimpan antrean sinkronisasi offline.',
    };
  }
}

function makeOpId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function enqueueOfflineTradeUpsert(
  userId: string,
  trade: Trade,
  options: { isEdit: boolean; originalId?: string }
): { success: boolean; queueLength: number; error?: string } {
  const queue = loadOfflineSyncQueue(userId);
  const matchId = (options.originalId || trade.id).toLowerCase();
  const nextId = trade.id.toLowerCase();

  const nextQueue: OfflineSyncOperation[] = [];
  let coalesced = false;

  for (const op of queue) {
    if (op.kind === 'delete_trade') {
      if (op.tradeId.toLowerCase() === nextId || op.tradeId.toLowerCase() === matchId) {
        continue;
      }
      nextQueue.push(op);
      continue;
    }

    if (op.kind === 'upsert_trade') {
      const opCurrentId = op.trade.id.toLowerCase();
      const opOrigId = (op.originalId || op.trade.id).toLowerCase();
      if (opCurrentId === matchId || opCurrentId === nextId || opOrigId === matchId) {
        if (!coalesced) {
          nextQueue.push({
            ...op,
            trade,
            originalId: op.isEdit ? op.originalId || options.originalId || trade.id : undefined,
            isEdit: op.isEdit,
            queuedAt: Date.now(),
          });
          coalesced = true;
        }
        continue;
      }
    }

    nextQueue.push(op);
  }

  if (!coalesced) {
    nextQueue.push({
      id: makeOpId('upsert'),
      kind: 'upsert_trade',
      trade,
      originalId: options.isEdit ? options.originalId || trade.id : undefined,
      isEdit: options.isEdit,
      queuedAt: Date.now(),
    });
  }

  const saveRes = saveOfflineSyncQueue(userId, nextQueue);
  return {
    success: saveRes.success,
    queueLength: saveRes.success ? nextQueue.length : queue.length,
    error: saveRes.error,
  };
}

export function enqueueOfflineTradeDelete(
  userId: string,
  tradeId: string,
  storagePathsToClean?: string[]
): { success: boolean; queueLength: number; error?: string } {
  const queue = loadOfflineSyncQueue(userId);
  const targetLower = tradeId.toLowerCase();

  let wasCreatedOfflineOnly = false;
  let originalCloudIdToDelete = tradeId;
  const filtered: OfflineSyncOperation[] = [];

  for (const op of queue) {
    if (op.kind === 'upsert_trade') {
      const opCurrentId = op.trade.id.toLowerCase();
      const opOrigId = (op.originalId || op.trade.id).toLowerCase();
      if (opCurrentId === targetLower || opOrigId === targetLower) {
        if (!op.isEdit) {
          wasCreatedOfflineOnly = true;
        } else if (op.originalId) {
          originalCloudIdToDelete = op.originalId;
        }
        continue;
      }
    }
    if (op.kind === 'delete_trade' && op.tradeId.toLowerCase() === targetLower) {
      continue;
    }
    filtered.push(op);
  }

  if (!wasCreatedOfflineOnly) {
    filtered.push({
      id: makeOpId('delete'),
      kind: 'delete_trade',
      tradeId: originalCloudIdToDelete,
      storagePathsToClean:
        storagePathsToClean && storagePathsToClean.length > 0 ? storagePathsToClean : undefined,
      queuedAt: Date.now(),
    });
  }

  const saveRes = saveOfflineSyncQueue(userId, filtered);
  return {
    success: saveRes.success,
    queueLength: saveRes.success ? filtered.length : queue.length,
    error: saveRes.error,
  };
}

export function enqueueOfflineSettingsUpdate(
  userId: string,
  settings: AppSettings
): { success: boolean; queueLength: number; error?: string } {
  const queue: OfflineSyncOperation[] = loadOfflineSyncQueue(userId).filter(
    (op) => op.kind !== 'update_settings'
  );
  queue.push({
    id: makeOpId('settings'),
    kind: 'update_settings',
    settings,
    queuedAt: Date.now(),
  });
  const saveRes = saveOfflineSyncQueue(userId, queue);
  return {
    success: saveRes.success,
    queueLength: saveRes.success ? queue.length : Math.max(0, queue.length - 1),
    error: saveRes.error,
  };
}

export function applyPendingQueueToTrades(
  baseTrades: Trade[],
  queue: OfflineSyncOperation[]
): Trade[] {
  if (!queue.length) return baseTrades;
  let result = [...baseTrades];

  for (const op of queue) {
    if (op.kind === 'delete_trade') {
      const targetLower = op.tradeId.toLowerCase();
      result = result.filter((t) => t.id.toLowerCase() !== targetLower);
    } else if (op.kind === 'upsert_trade') {
      const matchIds = new Set<string>([op.trade.id.toLowerCase()]);
      if (op.originalId) matchIds.add(op.originalId.toLowerCase());
      const existingIdx = result.findIndex((t) => matchIds.has(t.id.toLowerCase()));
      if (existingIdx >= 0) {
        result[existingIdx] = op.trade;
      } else {
        result = [op.trade, ...result];
      }
    }
  }

  return result;
}
