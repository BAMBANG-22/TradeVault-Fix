/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Trade } from '../types/trade';
import { decodeLifecycleMetaFromExecutionNotes } from './tradeLifecycle';
import { MacroNewsSnapshot } from './macroNewsEngine';
import { playErrorTone, playNotificationPing } from './soundEngine';

export type AppNotificationCategory = 'trade' | 'news';
export type AppNotificationTone = 'positive' | 'negative' | 'info' | 'warning';

export interface AppNotificationItem {
  id: string;
  category: AppNotificationCategory;
  title: string;
  summary: string;
  meta: string;
  tone: AppNotificationTone;
  createdAt: string;
  read: boolean;
  tradeId?: string;
  targetTab?: string;
  dedupeKey?: string;
}

const STORAGE_KEY = 'vlo_app_notifications_v1';
const MAX_NOTIFICATIONS = 25;
export const NOTIFICATIONS_UPDATED_EVENT = 'vlo-notifications-updated';

function safeEmitUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(NOTIFICATIONS_UPDATED_EVENT));
  }
}

export function loadAppNotifications(): AppNotificationItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is AppNotificationItem =>
          Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.title === 'string')
      )
      .slice(0, MAX_NOTIFICATIONS);
  } catch {
    return [];
  }
}

function saveAppNotifications(items: AppNotificationItem[]): AppNotificationItem[] {
  const capped = items.slice(0, MAX_NOTIFICATIONS);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(capped));
    } catch {
      // Ignore storage quota errors gracefully
    }
  }
  safeEmitUpdated();
  return capped;
}

export function pushAppNotification(
  input: Omit<AppNotificationItem, 'id' | 'createdAt' | 'read'> & {
    createdAt?: string;
  }
): AppNotificationItem | null {
  const existing = loadAppNotifications();

  if (input.dedupeKey && existing.some((item) => item.dedupeKey === input.dedupeKey)) {
    return null;
  }

  const nextItem: AppNotificationItem = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    category: input.category,
    title: input.title,
    summary: input.summary,
    meta: input.meta,
    tone: input.tone,
    createdAt: input.createdAt || new Date().toISOString(),
    read: false,
    tradeId: input.tradeId,
    targetTab: input.targetTab,
    dedupeKey: input.dedupeKey,
  };

  saveAppNotifications([nextItem, ...existing]);
  if (input.category === 'news') {
    if (input.tone === 'negative') {
      playErrorTone();
    } else {
      playNotificationPing();
    }
  }
  return nextItem;
}

export function markNotificationRead(id: string): AppNotificationItem[] {
  const current = loadAppNotifications();
  let changed = false;
  const next = current.map((item) => {
    if (item.id === id && !item.read) {
      changed = true;
      return { ...item, read: true };
    }
    return item;
  });
  return changed ? saveAppNotifications(next) : current;
}

export function markAllNotificationsRead(): AppNotificationItem[] {
  const current = loadAppNotifications();
  const hasUnread = current.some((item) => !item.read);
  if (!hasUnread) return current;
  return saveAppNotifications(current.map((item) => ({ ...item, read: true })));
}

export function clearAppNotifications(): AppNotificationItem[] {
  return saveAppNotifications([]);
}

function formatPriceCompact(value?: number): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  if (value >= 100) return value.toFixed(2).replace(/\.00$/, '');
  return value.toFixed(5).replace(/0+$/, '').replace(/\.$/, '');
}

function formatSignedUsd(value: number): string {
  const absStr = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return value >= 0 ? `+$${absStr}` : `-$${absStr}`;
}

export function pushTradeNotification(
  trade: Trade,
  action: 'created' | 'updated',
  previousTrade?: Trade | null,
  isEn = false
): AppNotificationItem | null {
  const meta = decodeLifecycleMetaFromExecutionNotes(trade.executionNotes);
  const prevMeta = previousTrade
    ? decodeLifecycleMetaFromExecutionNotes(previousTrade.executionNotes)
    : {};

  const status = meta.status || (trade.outcome ? 'CLOSED' : 'OPEN');
  const prevStatus = prevMeta.status;
  const pair = (trade.instrument || 'XAUUSD').toUpperCase();
  const dir = trade.position;
  const lotStr = Number.isFinite(trade.lotSize) ? `${trade.lotSize.toFixed(2)} lot` : '';

  const entryStr = formatPriceCompact(meta.actualEntry ?? meta.plannedEntry ?? trade.entryPrice);
  const slStr = formatPriceCompact(trade.stopLoss ?? meta.plannedStopLoss);
  const tpStr = formatPriceCompact(trade.takeProfit ?? meta.plannedTakeProfit);
  const exitStr = formatPriceCompact(trade.exitPrice ?? meta.actualExit);

  let title = '';
  let metaLabel = '';
  let tone: AppNotificationTone = 'info';

  if (status === 'CANCELLED') {
    title = isEn ? `${dir} ${pair} Cancelled` : `${dir} ${pair} Dibatalkan`;
    metaLabel = isEn ? 'Trade Journal · Cancelled' : 'Catat Trade · Batal';
    tone = 'warning';
  } else if (status === 'CLOSED') {
    const net = Number.isFinite(trade.netProfit) ? trade.netProfit : 0;
    const rStr =
      typeof trade.rMultiple === 'number' && Number.isFinite(trade.rMultiple)
        ? ` (${trade.rMultiple >= 0 ? '+' : ''}${trade.rMultiple.toFixed(2)}R)`
        : '';

    if (meta.closeType === 'TP' || trade.outcome === 'WIN') {
      title = isEn
        ? `${dir} ${pair} TP · ${formatSignedUsd(net)}${rStr}`
        : `${dir} ${pair} TP · ${formatSignedUsd(net)}${rStr}`;
      metaLabel =
        action === 'created'
          ? isEn
            ? 'Trade Logged · Win'
            : 'Catat Trade · TP'
          : isEn
          ? 'Trade Updated · TP'
          : 'Update Trade · TP';
      tone = 'positive';
    } else if (meta.closeType === 'SL' || trade.outcome === 'LOSS') {
      title = `${dir} ${pair} SL · ${formatSignedUsd(net)}${rStr}`;
      metaLabel =
        action === 'created'
          ? isEn
            ? 'Trade Logged · SL'
            : 'Catat Trade · SL'
          : isEn
          ? 'Trade Updated · SL'
          : 'Update Trade · SL';
      tone = 'negative';
    } else if (trade.outcome === 'BREAKEVEN') {
      title = `${dir} ${pair} BE · ${formatSignedUsd(net)}`;
      metaLabel = isEn ? 'Trade Journal · BE' : 'Catat Trade · BE';
      tone = 'info';
    } else {
      title = `${dir} ${pair} Closed · ${formatSignedUsd(net)}${rStr}`;
      metaLabel = isEn ? 'Trade Journal · Closed' : 'Catat Trade · Ditutup';
      tone = net >= 0 ? 'positive' : 'negative';
    }
  } else if (status === 'PLANNED') {
    const slChanged =
      action === 'updated' && previousTrade && previousTrade.stopLoss !== trade.stopLoss;
    const tpChanged =
      action === 'updated' && previousTrade && previousTrade.takeProfit !== trade.takeProfit;

    if (slChanged || tpChanged) {
      title = isEn ? `${dir} ${pair} SL/TP Updated` : `${dir} ${pair} SL/TP Diubah`;
      metaLabel = isEn ? 'Pending Order · SL/TP' : 'Pending · Update SL/TP';
    } else {
      title =
        action === 'created'
          ? isEn
            ? `New Setup ${dir} ${pair}`
            : `Setup Baru ${dir} ${pair}`
          : isEn
          ? `Setup Updated ${dir} ${pair}`
          : `Setup Diperbarui ${dir} ${pair}`;
      metaLabel = isEn ? 'Trade Plan · Pending' : 'Catat Trade · Rencana';
    }
    tone = 'info';
  } else {
    // OPEN position
    const slChanged =
      action === 'updated' && previousTrade && previousTrade.stopLoss !== trade.stopLoss;
    const tpChanged =
      action === 'updated' && previousTrade && previousTrade.takeProfit !== trade.takeProfit;

    if (action === 'updated' && prevStatus === 'PLANNED') {
      title = isEn ? `Entry Active · ${dir} ${pair}` : `Entry Aktif · ${dir} ${pair}`;
      metaLabel = isEn ? 'Position Opened' : 'Posisi Aktif';
    } else if (slChanged && !tpChanged) {
      title = isEn ? `SL Updated · ${dir} ${pair}` : `Update SL · ${dir} ${pair}`;
      metaLabel = isEn ? 'Active Trade · SL' : 'Trade Aktif · Ubah SL';
    } else if (tpChanged && !slChanged) {
      title = isEn ? `TP Updated · ${dir} ${pair}` : `Update TP · ${dir} ${pair}`;
      metaLabel = isEn ? 'Active Trade · TP' : 'Trade Aktif · Ubah TP';
    } else if (slChanged && tpChanged) {
      title = isEn ? `SL & TP Updated · ${dir} ${pair}` : `Update SL & TP · ${dir} ${pair}`;
      metaLabel = isEn ? 'Active Trade · SL/TP' : 'Trade Aktif · SL/TP';
    } else {
      title =
        action === 'created'
          ? isEn
            ? `Entry ${dir} ${pair}`
            : `Entry ${dir} ${pair}`
          : isEn
          ? `Updated ${dir} ${pair}`
          : `Pembaruan ${dir} ${pair}`;
      metaLabel =
        action === 'created'
          ? isEn
            ? 'Catat Trade · Open'
            : 'Catat Trade · Baru'
          : isEn
          ? 'Trade Updated'
          : 'Update Trade';
    }
    tone = 'info';
  }

  const parts: string[] = [];
  if (lotStr) parts.push(lotStr);
  if (entryStr) parts.push(`Entry ${entryStr}`);
  if (status === 'CLOSED' && exitStr) {
    parts.push(`Exit ${exitStr}`);
  }
  if (slStr) parts.push(`SL ${slStr}`);
  if (tpStr) parts.push(`TP ${tpStr}`);

  return pushAppNotification({
    category: 'trade',
    title,
    summary: parts.join(' · ') || trade.id,
    meta: metaLabel,
    tone,
    tradeId: trade.id,
    targetTab: 'detail',
  });
}

export function pushBatchTradesNotification(
  trades: Trade[],
  isEn = false
): AppNotificationItem | null {
  if (!Array.isArray(trades) || trades.length === 0) return null;
  const count = trades.length;
  const totalNet = trades.reduce(
    (sum, t) => sum + (Number.isFinite(t.netProfit) ? t.netProfit : 0),
    0
  );
  const pairs = Array.from(new Set(trades.map((t) => (t.instrument || 'XAUUSD').toUpperCase()))).slice(
    0,
    3
  );

  return pushAppNotification({
    category: 'trade',
    title: isEn
      ? `Scan MT5 · ${count} Trades Logged`
      : `Scan MT5 · ${count} Trade Dicatat`,
    summary: `${pairs.join(', ')} · Net ${formatSignedUsd(totalNet)}`,
    meta: isEn ? 'Batch Import · Trade Log' : 'Scan Keseluruhan · Jurnal',
    tone: totalNet >= 0 ? 'positive' : 'negative',
    targetTab: 'trades',
  });
}

export function pushMacroNewsShortNotification(
  snapshot: MacroNewsSnapshot,
  isEn = false
): AppNotificationItem | null {
  if (!snapshot) return null;

  const primaryEvent = snapshot.scenarioMatrix?.primaryEvent || snapshot.calendarEvents?.[0];
  const latestBreaking = snapshot.topBreakingAlert || snapshot.breakingNews?.[0];
  const fedWatch = snapshot.cmeFedWatch;
  const dxy = snapshot.intermarketPulse?.dxy;

  const bias = snapshot.dominantBias || snapshot.scenarioMatrix?.dominantBias || 'MIXED';
  const biasLabel =
    bias === 'BUY'
      ? isEn
        ? 'XAU Bias: Bullish'
        : 'Bias XAU: Bullish'
      : bias === 'SELL'
      ? isEn
        ? 'XAU Bias: Bearish'
        : 'Bias XAU: Bearish'
      : isEn
      ? 'XAU Bias: Mixed'
      : 'Bias XAU: Campuran';

  const tone: AppNotificationTone =
    bias === 'BUY' ? 'positive' : bias === 'SELL' ? 'negative' : 'info';

  let title = '';
  let summaryParts: string[] = [];
  let metaLabel = isEn ? 'Trade News · Update' : 'Trade News · Ringkas';

  if (primaryEvent && primaryEvent.title) {
    const hasActual = Boolean(primaryEvent.actual && primaryEvent.actual.trim() !== '');
    if (hasActual) {
      title = `${primaryEvent.country || 'USD'} ${primaryEvent.title}`;
      summaryParts.push(
        `Actual ${primaryEvent.actual}${primaryEvent.forecast ? ` vs Est ${primaryEvent.forecast}` : ''}`
      );
      metaLabel = isEn ? 'Trade News · Released' : 'Trade News · Rilis Data';
    } else {
      title = `${primaryEvent.country || 'USD'} ${primaryEvent.title}`;
      if (primaryEvent.forecast || primaryEvent.previous) {
        const fc = primaryEvent.forecast ? `Est ${primaryEvent.forecast}` : '';
        const prev = primaryEvent.previous ? `Prev ${primaryEvent.previous}` : '';
        summaryParts.push([fc, prev].filter(Boolean).join(' / '));
      }
      metaLabel =
        primaryEvent.impact === 'High'
          ? isEn
            ? 'Trade News · High Impact'
            : 'Trade News · High Impact'
          : isEn
          ? 'Trade News · Schedule'
          : 'Trade News · Jadwal';
    }
  } else if (latestBreaking?.title) {
    title =
      latestBreaking.title.length > 64
        ? `${latestBreaking.title.slice(0, 61)}...`
        : latestBreaking.title;
    metaLabel = isEn ? 'Trade News · Headline' : 'Trade News · Berita Baru';
  } else {
    title = isEn ? 'XAUUSD Macro & FedWatch Update' : 'Pembaruan Makro XAUUSD & FedWatch';
  }

  summaryParts.push(biasLabel);

  if (fedWatch?.isAvailable && typeof fedWatch.cutProbability === 'number') {
    summaryParts.push(`Cut ${Math.round(fedWatch.cutProbability)}%`);
  } else if (dxy?.isAvailable && Number.isFinite(dxy.price)) {
    summaryParts.push(`DXY ${dxy.price.toFixed(2)}`);
  }

  const dedupeKey = [
    'news',
    snapshot.dataFingerprint || snapshot.analyzedAt || '',
    primaryEvent?.id || '',
    primaryEvent?.actual || '',
    latestBreaking?.title?.slice(0, 32) || '',
    bias,
  ].join('|');

  return pushAppNotification({
    category: 'news',
    title,
    summary: summaryParts.filter(Boolean).join(' · '),
    meta: metaLabel,
    tone,
    targetTab: 'macro-news',
    dedupeKey,
  });
}

export function formatRelativeNotificationTime(iso: string, isEn = false): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 45) return isEn ? 'Just now' : 'Baru saja';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return isEn ? `${diffMin}m ago` : `${diffMin}m lalu`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return isEn ? `${diffHr}j ago`.replace('j', 'h') : `${diffHr}j lalu`;
  const date = new Date(ts);
  return date.toLocaleDateString(isEn ? 'en-US' : 'id-ID', {
    day: '2-digit',
    month: 'short',
  });
}
