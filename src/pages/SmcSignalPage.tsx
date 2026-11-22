/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  RefreshCw,
  Compass,
  Wifi,
  WifiOff,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  CheckCircle2,
  XCircle,
  Bookmark,
  BookmarkCheck,
  PlusCircle,
  RotateCcw,
  Trash2,
  SlidersHorizontal,
  ChevronDown,
  X,
} from 'lucide-react';
import { setNewsCycleOfflineMode } from '../utils/apiConfig';
import {
  evaluateSmcSignalEngine,
  loadStoredSessionHoursWib,
  loadStoredManualAmdOverride,
  loadStoredTradingConfluenceMode,
  saveStoredTradingConfluenceMode,
  MANUAL_AMD_OVERRIDE_CHANGE_EVENT,
  MANUAL_AMD_OVERRIDE_STORAGE_KEY,
  SESSION_HOURS_WIB_CHANGE_EVENT,
  SESSION_HOURS_WIB_STORAGE_KEY,
  TRADING_CONFLUENCE_MODE_CHANGE_EVENT,
  TRADING_CONFLUENCE_MODE_STORAGE_KEY,
  type TradingConfluenceMode,
  type ManualAmdOverrideMode,
  type SessionHoursWibConfig,
  type SmcLimitOrderSetup,
} from '../utils/confluenceEngine';
import {
  getWibDateKey,
  getSignalHistoryEffectiveDateKey,
  getAvailableHistoryDates,
  filterSignalHistoryRecords,
  groupHistoryRecordsByDate,
  computeSignalHistorySummary,
  recordDeletedActiveSignal,
  reconcileIncomingSignalsWithDeleted,
  type SmcSignalOutcomeStatus,
  type SmcSignalBatchStatus,
  type SmcHistoryDateFilterMode,
  type SmcHistoryDirectionFilter,
  type SmcStoredSignalRecord,
  type SmcDeletedSignalRecord,
} from '../utils/smcSignalHistory';
import { useCycleConfluenceData } from '../hooks/useCycleConfluenceData';
import { useLanguage } from '../utils/language';

export type {
  SmcSignalOutcomeStatus,
  SmcSignalBatchStatus,
  SmcHistoryDateFilterMode,
  SmcHistoryDirectionFilter,
  SmcStoredSignalRecord,
};

interface SmcSignalPageProps {
  isActive?: boolean;
  onNavigate?: (tab: string) => void;
}

const OFFLINE_SIGNALS_STORAGE_KEY = 'tradevault_smc_offline_signals_v1';
const DELETED_SIGNALS_STORAGE_KEY = 'tradevault_smc_deleted_signals_v1';
const RESURFACE_DELETED_OPTION_STORAGE_KEY = 'tradevault_smc_resurface_deleted_v1';

/**
 * Returns YYYY-MM-DD in WIB (UTC+7) so daily signal sheets follow Indonesian trading days.
 */
function getCurrentWibDateKey(date: Date = new Date()): string {
  return getWibDateKey(date);
}

function getCurrentWibTimeLabel(date: Date = new Date()): string {
  try {
    const timeStr = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
    return `${timeStr.replace('.', ':')} WIB`;
  } catch {
    return 'WIB';
  }
}

function formatDateKeyHuman(dateKey: string, todayKey: string): string {
  if (!dateKey) return '—';
  try {
    const [y, m, d] = dateKey.split('-').map(Number);
    const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    const formatted = new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(dt);
    return dateKey === todayKey ? `Hari Ini · ${formatted}` : formatted;
  } catch {
    return dateKey;
  }
}

function normalizeSignalRecordsForDay(
  records: SmcStoredSignalRecord[],
  todayKey: string
): SmcStoredSignalRecord[] {
  return records.map((item) => {
    const isPastActive =
      item.status === 'ACTIVE' &&
      item.dateKey < todayKey &&
      item.promotedDateKey !== todayKey;
    return {
      ...item,
      batchStatus: isPastActive
        ? 'PREVIOUS'
        : item.batchStatus === 'PREVIOUS'
        ? 'PREVIOUS'
        : 'ON_GOING',
    };
  });
}

function loadStoredOfflineSignals(): SmcStoredSignalRecord[] {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(OFFLINE_SIGNALS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const todayKey = getCurrentWibDateKey();
    const valid = parsed.filter(
      (item) =>
        item &&
        typeof item.uid === 'string' &&
        typeof item.dateKey === 'string' &&
        typeof item.entryLimit === 'number' &&
        item.entryLimit > 0
    );
    return normalizeSignalRecordsForDay(valid, todayKey);
  } catch {
    return [];
  }
}

function saveStoredOfflineSignals(records: SmcStoredSignalRecord[]): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(OFFLINE_SIGNALS_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Ignore quota errors
  }
}

function loadStoredDeletedSignals(): SmcDeletedSignalRecord[] {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(DELETED_SIGNALS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SmcDeletedSignalRecord =>
        Boolean(
          item &&
            typeof item.signatureKey === 'string' &&
            typeof item.entryLimit === 'number' &&
            item.entryLimit > 0
        )
    );
  } catch {
    return [];
  }
}

function saveStoredDeletedSignals(records: SmcDeletedSignalRecord[]): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(DELETED_SIGNALS_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Ignore quota errors
  }
}

function loadResurfaceDeletedOption(): boolean {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return true;
  }
  try {
    const raw = window.localStorage.getItem(RESURFACE_DELETED_OPTION_STORAGE_KEY);
    return raw !== 'false';
  } catch {
    return true;
  }
}

function saveResurfaceDeletedOption(enabled: boolean): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(RESURFACE_DELETED_OPTION_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore quota errors
  }
}

const TIER_SORT_WEIGHT: Record<SmcLimitOrderSetup['tier'], number> = {
  A_PLUS: 1,
  B_STANDARD: 2,
  HIGH_RISK: 3,
};

interface MemoSignalCardProps {
  group: SmcStoredSignalRecord;
  todayDateKey: string;
  tr: <T = string>(idText: T, enText: T) => T;
  onToggleTake: (uid: string) => void;
  onToggleBatch: (uid: string, targetBatch: SmcSignalBatchStatus) => void;
  onDelete: (uid: string) => void;
  onRequestOutcome: (
    record: SmcStoredSignalRecord,
    outcome: Exclude<SmcSignalOutcomeStatus, 'ACTIVE'>
  ) => void;
}

const MemoSignalCard: React.FC<MemoSignalCardProps> = React.memo(
  ({ group, todayDateKey, tr, onToggleTake, onToggleBatch, onDelete, onRequestOutcome }) => {
    const isTierAPlus = group.tier === 'A_PLUS';
    const isTierB = group.tier === 'B_STANDARD';
    const isPreviousBatch = (group.batchStatus || 'ON_GOING') === 'PREVIOUS';
    const cardDateLabel = formatDateKeyHuman(group.dateKey, todayDateKey);
    const isBuy = group.direction === 'BUY';

    return (
      <article
        data-testid={`smc-group-card-${group.uid}`}
        style={{ contain: 'layout style' }}
        className={`rounded-xl border bg-white dark:bg-[#101318] p-4 sm:p-[18px] font-mono-numbers tabular-nums transition-colors duration-150 flex flex-col justify-between ${
          group.isTaken
            ? 'border-[#0F172A] dark:border-white/75'
            : isPreviousBatch
            ? 'border-[#E4E4E7]/85 dark:border-[#20252D]/85'
            : 'border-[#E4E4E7] dark:border-[#20252D]'
        }`}
      >
        <div>
          {/* Clean 2-Line Editorial Header (Zero Pill Sandwich) */}
          <div className="pb-3 mb-3 border-b border-[#E4E4E7]/80 dark:border-[#20252D]">
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex items-baseline gap-2 min-w-0">
                <span
                  className={`text-[11px] font-sans font-bold uppercase tracking-[0.08em] shrink-0 ${
                    isBuy
                      ? 'text-[#059669] dark:text-[#00A878]'
                      : 'text-[#E11D48] dark:text-[#E05260]'
                  }`}
                >
                  {group.direction}
                </span>
                <h2 className="text-[13px] sm:text-sm font-sans font-bold text-[#0F172A] dark:text-[#F2F4F7] truncate">
                  {group.headerTitle}
                </h2>
              </div>

              <span
                className={`text-[10px] font-sans font-semibold uppercase tracking-[0.06em] shrink-0 ${
                  isTierAPlus
                    ? 'text-[#0F172A] dark:text-[#F2F4F7]'
                    : isTierB
                    ? 'text-[#526071] dark:text-[#929BA9]'
                    : 'text-[#E11D48] dark:text-[#E05260]'
                }`}
              >
                {isTierAPlus ? 'A+' : isTierB ? 'Setup B' : 'High Risk'}
              </span>
            </div>

            <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-[#526071] dark:text-[#929BA9] font-sans">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
                <span className="truncate">
                  {cardDateLabel} · {group.createdTimeWib}
                </span>
                <span aria-hidden="true">·</span>
                <span className="text-[#0F172A] dark:text-[#CBD5E1] font-medium">
                  {isPreviousBatch ? 'Previous' : 'On Going'}
                </span>
                {group.isTaken && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-[#0F172A] dark:text-white">
                      {tr('Diambil', 'Taken')}
                    </span>
                  </>
                )}
                {group.resurfacedFromBatch && (
                  <span
                    data-testid={`smc-resurfaced-badge-${group.uid}`}
                    className="text-[#526071] dark:text-[#929BA9]"
                  >
                    · {group.resurfacedFromBatch === 'PREVIOUS'
                      ? tr('Muncul lagi', 'Re-shown')
                      : tr('Muncul lagi', 'Re-shown')}
                  </span>
                )}
              </div>

              {isPreviousBatch && (
                <button
                  type="button"
                  onClick={() => onToggleBatch(group.uid, 'ON_GOING')}
                  className="text-[11px] font-medium text-[#0F172A] dark:text-[#F2F4F7] underline underline-offset-2 decoration-[#CBD5E1] dark:decoration-[#3A4250] hover:decoration-current transition-colors shrink-0 cursor-pointer"
                >
                  {tr('Ke On Going', 'To On Going')}
                </button>
              )}
            </div>
          </div>

          {/* High-Clarity Price Matrix: Entry (Focus), SL (Rose Red), TP 1/2/Max (Emerald Green) */}
          <div className="space-y-2 text-xs">
            <div className="flex items-baseline justify-between gap-2 pb-2 border-b border-[#E4E4E7]/70 dark:border-[#20252D]/80">
              <div className="flex items-baseline gap-2">
                <span className="text-[11px] text-[#526071] dark:text-[#929BA9] font-sans font-medium">
                  Entry Limit
                </span>
                <span className="text-[10px] text-[#526071]/80 dark:text-[#929BA9]/80">
                  Spot {group.spotPriceAtCapture.toFixed(1)}
                </span>
              </div>
              <span className="text-base sm:text-[17px] font-bold tracking-tight text-[#0F172A] dark:text-[#F2F4F7]">
                {group.entryLimit.toFixed(1)}
              </span>
            </div>

            {/* Stop Loss — Clear & High-Contrast */}
            <div className="flex items-center justify-between gap-2 py-0.5">
              <span className="text-[11px] font-sans font-semibold text-[#E11D48] dark:text-[#E05260]">
                SL
              </span>
              <span className="text-[13px] font-bold text-[#E11D48] dark:text-[#E05260]">
                {group.stopLoss.toFixed(1)}{' '}
                <span className="text-[10px] font-normal opacity-80">
                  ({group.slPips}p + {group.slPoints}pt)
                </span>
              </span>
            </div>

            {/* Take Profit Levels — Clear & High-Contrast */}
            <div className="pt-1.5 border-t border-[#E4E4E7]/60 dark:border-[#20252D]/70 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-sans font-medium text-[#526071] dark:text-[#929BA9]">
                  TP 1
                </span>
                <span className="text-[13px] font-semibold text-[#059669] dark:text-[#00A878]">
                  {group.tp1.toFixed(1)}{' '}
                  <span className="text-[10px] font-normal opacity-80">(1:1)</span>
                </span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-sans font-medium text-[#526071] dark:text-[#929BA9]">
                  TP 2
                </span>
                <span className="text-[13px] font-semibold text-[#059669] dark:text-[#00A878]">
                  {group.tp2.toFixed(1)}{' '}
                  <span className="text-[10px] font-normal opacity-80">(1:2)</span>
                </span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-sans font-semibold text-[#059669] dark:text-[#00A878]">
                  TP Max
                </span>
                <span className="text-[13px] font-bold text-[#059669] dark:text-[#00A878]">
                  {group.tpMax.toFixed(1)}{' '}
                  <span className="text-[10px] font-normal opacity-80">({group.tpMaxRrLabel})</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Clean Monochrome Footer Actions + On-Demand TP/SL Outcome Row */}
        <div className="mt-4 pt-3 border-t border-[#E4E4E7]/80 dark:border-[#20252D] space-y-2.5 font-sans">
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid={`smc-take-signal-${group.uid}`}
              onClick={() => onToggleTake(group.uid)}
              className={`flex-1 h-9 px-4 rounded-full text-xs font-semibold transition-colors duration-150 flex items-center justify-center gap-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                group.isTaken
                  ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607]'
                  : 'bg-[#FAFAFA] dark:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] text-[#0F172A] dark:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#1E2430]'
              }`}
            >
              {group.isTaken ? (
                <BookmarkCheck className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <Bookmark className="w-3.5 h-3.5 shrink-0 opacity-70" />
              )}
              <span className="truncate">
                {group.isTaken
                  ? tr('Sedang Diambil', 'Signal Taken')
                  : tr('Ambil Sinyal', 'Take Signal')}
              </span>
            </button>

            <button
              type="button"
              title={tr('Hapus sinyal ini', 'Delete this signal')}
              aria-label={tr('Hapus sinyal ini', 'Delete this signal')}
              onClick={() => onDelete(group.uid)}
              className="h-9 w-9 rounded-full shrink-0 inline-flex items-center justify-center border border-[#E4E4E7] dark:border-[#20252D] text-[#526071] dark:text-[#929BA9] hover:text-[#E11D48] dark:hover:text-[#E05260] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {group.isTaken && (
            <div className="pt-2 border-t border-dashed border-[#E4E4E7] dark:border-[#20252D] space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-150">
              <div className="flex items-center justify-between text-[10px] font-medium text-[#526071] dark:text-[#929BA9]">
                <span>{tr('Catat hasil ke riwayat', 'Record outcome')}</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                <button
                  type="button"
                  data-testid={`smc-hit-tp1-${group.uid}`}
                  onClick={() => onRequestOutcome(group, 'HIT_TP1')}
                  className="h-8 px-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#161A22] text-[11px] font-semibold text-[#059669] dark:text-[#00A878] hover:border-[#059669]/50 dark:hover:border-[#00A878]/50 transition-colors duration-150 cursor-pointer"
                >
                  TP 1
                </button>
                <button
                  type="button"
                  data-testid={`smc-hit-tp2-${group.uid}`}
                  onClick={() => onRequestOutcome(group, 'HIT_TP2')}
                  className="h-8 px-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#161A22] text-[11px] font-semibold text-[#059669] dark:text-[#00A878] hover:border-[#059669]/50 dark:hover:border-[#00A878]/50 transition-colors duration-150 cursor-pointer"
                >
                  TP 2
                </button>
                <button
                  type="button"
                  data-testid={`smc-hit-tpmax-${group.uid}`}
                  onClick={() => onRequestOutcome(group, 'HIT_TP_MAX')}
                  className="h-8 px-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#161A22] text-[11px] font-semibold text-[#059669] dark:text-[#00A878] hover:border-[#059669]/50 dark:hover:border-[#00A878]/50 transition-colors duration-150 cursor-pointer"
                >
                  Max
                </button>
                <button
                  type="button"
                  data-testid={`smc-hit-sl-${group.uid}`}
                  onClick={() => onRequestOutcome(group, 'HIT_SL')}
                  className="h-8 px-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#161A22] text-[11px] font-semibold text-[#E11D48] dark:text-[#E05260] hover:border-[#E11D48]/50 dark:hover:border-[#E05260]/50 transition-colors duration-150 cursor-pointer"
                >
                  SL
                </button>
              </div>
            </div>
          )}
        </div>
      </article>
    );
  }
);

interface MemoHistorySignalCardProps {
  item: SmcStoredSignalRecord;
  todayDateKey: string;
  tr: <T = string>(idText: T, enText: T) => T;
  onRestore: (uid: string) => void;
  onDelete: (uid: string) => void;
}

const MemoHistorySignalCard: React.FC<MemoHistorySignalCardProps> = React.memo(
  ({ item, todayDateKey, tr, onRestore, onDelete }) => {
    const isWin = item.status !== 'HIT_SL';
    const statusBadgeLabel =
      item.status === 'HIT_TP1'
        ? 'HIT TP 1'
        : item.status === 'HIT_TP2'
        ? 'HIT TP 2'
        : item.status === 'HIT_TP_MAX'
        ? `HIT MAX (${item.tpMaxRrLabel})`
        : 'HIT SL';
    const effectiveClosedDateKey = getSignalHistoryEffectiveDateKey(item);
    const isBuy = item.direction === 'BUY';

    return (
      <article
        data-testid={`smc-history-card-${item.uid}`}
        style={{ contain: 'layout style' }}
        className="rounded-xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] p-4 sm:p-[18px] font-mono-numbers tabular-nums flex flex-col justify-between"
      >
        <div>
          <div className="pb-3 mb-3 border-b border-[#E4E4E7]/80 dark:border-[#20252D]">
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex items-baseline gap-2 min-w-0">
                <span
                  className={`text-[11px] font-sans font-bold uppercase tracking-[0.08em] shrink-0 ${
                    isBuy
                      ? 'text-[#059669] dark:text-[#00A878]'
                      : 'text-[#E11D48] dark:text-[#E05260]'
                  }`}
                >
                  {item.direction}
                </span>
                <h2 className="text-[13px] sm:text-sm font-sans font-bold text-[#0F172A] dark:text-[#F2F4F7] truncate">
                  {item.headerTitle}
                </h2>
              </div>

              <span
                className={`inline-flex items-center gap-1 text-[10px] font-sans font-bold uppercase tracking-[0.05em] shrink-0 ${
                  isWin
                    ? 'text-[#059669] dark:text-[#00A878]'
                    : 'text-[#E11D48] dark:text-[#E05260]'
                }`}
              >
                {isWin ? (
                  <CheckCircle2 className="w-3 h-3 shrink-0" />
                ) : (
                  <XCircle className="w-3 h-3 shrink-0" />
                )}
                <span>{statusBadgeLabel}</span>
              </span>
            </div>

            <p className="mt-1 text-[11px] text-[#526071] dark:text-[#929BA9] font-sans truncate">
              {formatDateKeyHuman(item.dateKey, todayDateKey)} {item.createdTimeWib} →{' '}
              {formatDateKeyHuman(effectiveClosedDateKey, todayDateKey)} {item.closedTimeWib || '—'}
            </p>
          </div>

          <div className="space-y-1.5 text-xs">
            <div className="flex items-baseline justify-between gap-2 pb-1.5 border-b border-[#E4E4E7]/70 dark:border-[#20252D]/80">
              <span className="text-[11px] text-[#526071] dark:text-[#929BA9] font-sans font-medium">
                Entry Limit
              </span>
              <span className="text-base font-bold tracking-tight text-[#0F172A] dark:text-[#F2F4F7]">
                {item.entryLimit.toFixed(1)}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 pt-0.5">
              <span className="text-[11px] font-sans font-semibold text-[#E11D48] dark:text-[#E05260]">
                SL
              </span>
              <span className="text-[13px] font-bold text-[#E11D48] dark:text-[#E05260]">
                {item.stopLoss.toFixed(1)}{' '}
                <span className="text-[10px] opacity-80 font-normal">
                  ({item.slPips}p + {item.slPoints}pt)
                </span>
              </span>
            </div>

            <div className="pt-1.5 border-t border-[#E4E4E7]/60 dark:border-[#20252D]/70 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-[#526071] dark:text-[#929BA9] font-sans">
                  TP 1
                </span>
                <span className="text-[13px] font-semibold text-[#059669] dark:text-[#00A878]">
                  {item.tp1.toFixed(1)}{' '}
                  <span className="text-[10px] opacity-80 font-normal">(1:1)</span>
                </span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-[#526071] dark:text-[#929BA9] font-sans">
                  TP 2
                </span>
                <span className="text-[13px] font-semibold text-[#059669] dark:text-[#00A878]">
                  {item.tp2.toFixed(1)}{' '}
                  <span className="text-[10px] opacity-80 font-normal">(1:2)</span>
                </span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-sans font-semibold text-[#059669] dark:text-[#00A878]">
                  TP Max
                </span>
                <span className="text-[13px] font-bold text-[#059669] dark:text-[#00A878]">
                  {item.tpMax.toFixed(1)}{' '}
                  <span className="text-[10px] opacity-80 font-normal">({item.tpMaxRrLabel})</span>
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#E4E4E7]/70 dark:border-[#20252D]/80">
              <span className="text-[11px] text-[#526071] dark:text-[#929BA9] font-sans font-medium">
                {tr('Hasil', 'Result')}
              </span>
              <span
                className={`text-sm font-bold ${
                  (item.resultPips ?? 0) >= 0
                    ? 'text-[#059669] dark:text-[#00A878]'
                    : 'text-[#E11D48] dark:text-[#E05260]'
                }`}
              >
                {(item.resultPips ?? 0) >= 0
                  ? `+${item.resultPips} pips`
                  : `${item.resultPips} pips`}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-[#E4E4E7]/80 dark:border-[#20252D] flex items-center gap-2 font-sans">
          <button
            type="button"
            onClick={() => onRestore(item.uid)}
            className="flex-1 h-9 px-4 rounded-full text-xs font-semibold bg-[#FAFAFA] dark:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] text-[#0F172A] dark:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#1E2430] inline-flex items-center justify-center gap-1.5 transition-colors duration-150 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 shrink-0 opacity-75" />
            <span className="truncate">{tr('Kembalikan ke Aktif', 'Restore to Active')}</span>
          </button>

          <button
            type="button"
            title={tr('Hapus riwayat ini', 'Delete this history item')}
            aria-label={tr('Hapus riwayat ini', 'Delete this history item')}
            onClick={() => onDelete(item.uid)}
            className="h-9 w-9 rounded-full shrink-0 inline-flex items-center justify-center border border-[#E4E4E7] dark:border-[#20252D] text-[#526071] dark:text-[#929BA9] hover:text-[#E11D48] dark:hover:text-[#E05260] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] transition-colors duration-150 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </article>
    );
  }
);

export const SmcSignalPage: React.FC<SmcSignalPageProps> = ({
  isActive = true,
  onNavigate,
}) => {
  const { tr } = useLanguage();

  const todayDateKey = getCurrentWibDateKey();

  const [tradingMode, setTradingModeState] = useState<TradingConfluenceMode>(() =>
    loadStoredTradingConfluenceMode('SCALP')
  );
  const setTradingMode = useCallback((mode: TradingConfluenceMode) => {
    setTradingModeState(mode);
    saveStoredTradingConfluenceMode(mode);
  }, []);
  const [selectedSide, setSelectedSide] = useState<'BUY' | 'SELL'>('BUY');
  const [hasUserToggledSide, setHasUserToggledSide] = useState<boolean>(false);
  const hasUserToggledSideRef = useRef<boolean>(false);
  hasUserToggledSideRef.current = hasUserToggledSide;
  const [selectedDateKey, setSelectedDateKey] = useState<string>(todayDateKey);
  const [previousDateFilter, setPreviousDateFilter] = useState<string>('ALL');
  const [historyDateFilterMode, setHistoryDateFilterMode] =
    useState<SmcHistoryDateFilterMode>('ALL');
  const [historyDirectionFilter, setHistoryDirectionFilter] =
    useState<SmcHistoryDirectionFilter>('ALL');
  const [historyCustomDateKey, setHistoryCustomDateKey] = useState<string>(todayDateKey);
  const [viewSection, setViewSection] = useState<'ACTIVE' | 'HISTORY'>('ACTIVE');
  const [batchFilter, setBatchFilter] = useState<'ALL' | 'ON_GOING' | 'TAKEN' | 'PREVIOUS'>('ALL');
  const [captureFeedback, setCaptureFeedback] = useState<string | null>(null);
  const [pendingOutcomeConfirm, setPendingOutcomeConfirm] = useState<{
    record: SmcStoredSignalRecord;
    outcome: Exclude<SmcSignalOutcomeStatus, 'ACTIVE'>;
  } | null>(null);
  const [recentOutcomeUndo, setRecentOutcomeUndo] = useState<{
    uid: string;
    previousRecord: SmcStoredSignalRecord;
    summaryText: string;
  } | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const [isOptionsMenuOpen, setIsOptionsMenuOpen] = useState<boolean>(false);
  const [isDateFilterOpen, setIsDateFilterOpen] = useState<boolean>(false);
  const [isChochDetailOpen, setIsChochDetailOpen] = useState<boolean>(false);
  const optionsMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!pendingOutcomeConfirm) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPendingOutcomeConfirm(null);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [pendingOutcomeConfirm]);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current !== null) {
        window.clearTimeout(undoTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOptionsMenuOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOptionsMenuOpen(false);
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (
        optionsMenuRef.current &&
        !optionsMenuRef.current.contains(e.target as Node)
      ) {
        setIsOptionsMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOptionsMenuOpen]);

  const [storedSignals, setStoredSignals] = useState<SmcStoredSignalRecord[]>(() =>
    loadStoredOfflineSignals()
  );
  const [deletedSignals, setDeletedSignals] = useState<SmcDeletedSignalRecord[]>(() =>
    loadStoredDeletedSignals()
  );
  const [resurfaceDeletedSignals, setResurfaceDeletedSignals] = useState<boolean>(() =>
    loadResurfaceDeletedOption()
  );

  const storedSignalsRef = useRef<SmcStoredSignalRecord[]>(storedSignals);
  storedSignalsRef.current = storedSignals;
  const deletedSignalsRef = useRef<SmcDeletedSignalRecord[]>(deletedSignals);
  deletedSignalsRef.current = deletedSignals;
  const resurfaceOptionRef = useRef<boolean>(resurfaceDeletedSignals);
  resurfaceOptionRef.current = resurfaceDeletedSignals;

  // Persist to localStorage whenever storedSignals / deletedSignals / resurface option change
  useEffect(() => {
    saveStoredOfflineSignals(storedSignals);
  }, [storedSignals]);

  useEffect(() => {
    saveStoredDeletedSignals(deletedSignals);
  }, [deletedSignals]);

  useEffect(() => {
    saveResurfaceDeletedOption(resurfaceDeletedSignals);
  }, [resurfaceDeletedSignals]);

  // Automatically roll selectedDateKey and archive prior days' ON_GOING signals to PREVIOUS on a new WIB calendar day
  const lastTodayRef = useRef<string>(todayDateKey);
  useEffect(() => {
    const checkDayRollover = () => {
      const currentKey = getCurrentWibDateKey();
      if (currentKey !== lastTodayRef.current) {
        const previousTodayKey = lastTodayRef.current;
        lastTodayRef.current = currentKey;
        setSelectedDateKey(currentKey);
        setHistoryCustomDateKey((prev) => (prev === previousTodayKey ? currentKey : prev));
        setStoredSignals((prev) => normalizeSignalRecordsForDay(prev, currentKey));
      }
    };
    const interval = window.setInterval(checkDayRollover, 30 * 1000);
    return () => window.clearInterval(interval);
  }, []);

  const [sessionConfig, setSessionConfig] = useState<SessionHoursWibConfig>(() =>
    loadStoredSessionHoursWib()
  );
  const [manualAmdOverride, setManualAmdOverride] = useState<ManualAmdOverrideMode>(() =>
    loadStoredManualAmdOverride()
  );

  useEffect(() => {
    const syncAll = () => {
      setManualAmdOverride(loadStoredManualAmdOverride());
      setSessionConfig(loadStoredSessionHoursWib());
      setTradingModeState(loadStoredTradingConfluenceMode('SCALP'));
    };
    const handleStorage = (e: StorageEvent) => {
      if (
        e.key === MANUAL_AMD_OVERRIDE_STORAGE_KEY ||
        e.key === SESSION_HOURS_WIB_STORAGE_KEY ||
        e.key === TRADING_CONFLUENCE_MODE_STORAGE_KEY
      ) {
        syncAll();
      } else if (e.key === OFFLINE_SIGNALS_STORAGE_KEY) {
        setStoredSignals(loadStoredOfflineSignals());
      } else if (e.key === DELETED_SIGNALS_STORAGE_KEY) {
        setDeletedSignals(loadStoredDeletedSignals());
      } else if (e.key === RESURFACE_DELETED_OPTION_STORAGE_KEY) {
        setResurfaceDeletedSignals(loadResurfaceDeletedOption());
      }
    };
    window.addEventListener(MANUAL_AMD_OVERRIDE_CHANGE_EVENT, syncAll);
    window.addEventListener(SESSION_HOURS_WIB_CHANGE_EVENT, syncAll);
    window.addEventListener(TRADING_CONFLUENCE_MODE_CHANGE_EVENT, syncAll);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(MANUAL_AMD_OVERRIDE_CHANGE_EVENT, syncAll);
      window.removeEventListener(SESSION_HOURS_WIB_CHANGE_EVENT, syncAll);
      window.removeEventListener(TRADING_CONFLUENCE_MODE_CHANGE_EVENT, syncAll);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const {
    livePrice,
    macroBias,
    rawMacroContext,
    candlesByTf,
    isLoading,
    isRefreshing,
    lastUpdatedAt,
    isOfflineMode,
    refresh,
  } = useCycleConfluenceData(tradingMode, isActive);

  const handleToggleOfflineMode = () => {
    setNewsCycleOfflineMode(!isOfflineMode);
  };

  const signalResult = useMemo(
    () =>
      evaluateSmcSignalEngine({
        tradingMode,
        livePrice,
        macroBias,
        rawMacroContext,
        candlesByTf,
        sessionConfig,
        manualAmdOverride,
      }),
    [tradingMode, livePrice, macroBias, rawMacroContext, candlesByTf, sessionConfig, manualAmdOverride]
  );

  const { cycleCompass, buyLimitGroups, sellLimitGroups, buyOption, sellOption, spotPrice } =
    signalResult;
  const twoStage = cycleCompass.twoStageValidation;
  const activeSidePlan = selectedSide === 'BUY' ? buyOption : sellOption;

  const liveDominantBiasLabel: 'BULLISH' | 'BEARISH' | 'NETRAL' =
    cycleCompass.dominantCycleBias === 'BULLISH'
      ? 'BULLISH'
      : cycleCompass.dominantCycleBias === 'BEARISH'
      ? 'BEARISH'
      : 'NETRAL';

  /**
   * Captures and locks real-time signals into Offline Storage (localStorage) for today's WIB date.
   * Rules:
   * 1. Existing ACTIVE signals from earlier batches move to `PREVIOUS`, while newly pulled ones become `ON_GOING`.
   * 2. Matching ACTIVE signals are promoted back to `ON_GOING` without duplicating.
   * 3. Deleted (`ON_GOING` / `PREVIOUS`) signals are either re-surfaced into `ON_GOING` (if option ON)
   *    or kept hidden/suppressed (if option OFF).
   */
  const captureSignalsToOfflineVault = useCallback(
    (
      isManualTrigger: boolean
    ): {
      added: number;
      resurfaced: number;
      promoted: number;
      keptInOnGoing: number;
      promotedFromPrevious: number;
      archivedToPrevious: number;
      suppressed: number;
    } => {
      if (!spotPrice || spotPrice <= 0) {
        return {
          added: 0,
          resurfaced: 0,
          promoted: 0,
          keptInOnGoing: 0,
          promotedFromPrevious: 0,
          archivedToPrevious: 0,
          suppressed: 0,
        };
      }

      const currentDayKey = getCurrentWibDateKey();
      const now = new Date();
      const nowIso = now.toISOString();
      const nowWib = getCurrentWibTimeLabel(now);
      const allIncoming = [...buyLimitGroups, ...sellLimitGroups];

      const result = reconcileIncomingSignalsWithDeleted({
        storedSignals: storedSignalsRef.current,
        deletedSignals: deletedSignalsRef.current,
        incomingGroups: allIncoming,
        tradingMode,
        currentDayKey,
        nowIso,
        nowWib,
        spotPrice,
        dominantBias: liveDominantBiasLabel,
        pdZone: cycleCompass.pdZone,
        positionPct: cycleCompass.positionPct,
        recommendedSide: cycleCompass.recommendedSide,
        resurfaceDeletedSignals: resurfaceOptionRef.current,
        mode: 'FULL_PULL',
        isManualTrigger,
      });

      if (result.nextSignals !== storedSignalsRef.current) {
        storedSignalsRef.current = result.nextSignals;
        setStoredSignals(result.nextSignals);
      }
      if (result.nextDeletedSignals !== deletedSignalsRef.current) {
        deletedSignalsRef.current = result.nextDeletedSignals;
        setDeletedSignals(result.nextDeletedSignals);
      }

      return {
        added: result.addedCount,
        resurfaced: result.resurfacedCount,
        promoted: result.promotedCount,
        keptInOnGoing: result.keptInOnGoingCount,
        promotedFromPrevious: result.promotedFromPreviousCount,
        archivedToPrevious: result.archivedToPreviousCount,
        suppressed: result.suppressedCount,
      };
    },
    [
      spotPrice,
      buyLimitGroups,
      sellLimitGroups,
      tradingMode,
      liveDominantBiasLabel,
      cycleCompass.pdZone,
      cycleCompass.positionPct,
      cycleCompass.recommendedSide,
    ]
  );

  // Auto-seed today's offline signal snapshot ONCE per day/mode when the page opens and today has 0 signals
  const autoSeedAttemptedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!spotPrice || spotPrice <= 0) return;
    const currentDayKey = getCurrentWibDateKey();
    const seedKey = `${currentDayKey}:${tradingMode}`;
    if (autoSeedAttemptedRef.current.has(seedKey)) return;
    autoSeedAttemptedRef.current.add(seedKey);

    const hasTodaySignalsForMode = storedSignalsRef.current.some(
      (r) => r.dateKey === currentDayKey && r.tradingMode === tradingMode
    );
    if (!hasTodaySignalsForMode) {
      captureSignalsToOfflineVault(false);
    }
  }, [spotPrice, tradingMode, storedSignals, captureSignalsToOfflineVault]);

  // Automatic background market re-analysis check (e.g. 1h / 6h later when market scan refreshes):
  // If `resurfaceDeletedSignals` is ON and the market scan detects a setup matching a deleted ON_GOING / PREVIOUS signal,
  // automatically re-surface it into ON_GOING cleanly.
  const lastAutoResurfaceCheckKeyRef = useRef<string>('');
  useEffect(() => {
    if (
      !resurfaceDeletedSignals ||
      !spotPrice ||
      spotPrice <= 0 ||
      isLoading ||
      isRefreshing ||
      !lastUpdatedAt
    ) {
      return;
    }
    const deletedForMode = deletedSignalsRef.current.filter((d) => d.tradingMode === tradingMode);
    if (deletedForMode.length === 0) return;

    const checkKey = `${tradingMode}|${lastUpdatedAt}|${spotPrice.toFixed(1)}`;
    if (lastAutoResurfaceCheckKeyRef.current === checkKey) return;
    lastAutoResurfaceCheckKeyRef.current = checkKey;

    const currentDayKey = getCurrentWibDateKey();
    const now = new Date();
    const nowIso = now.toISOString();
    const nowWib = getCurrentWibTimeLabel(now);
    const allIncoming = [...buyLimitGroups, ...sellLimitGroups];

    const res = reconcileIncomingSignalsWithDeleted({
      storedSignals: storedSignalsRef.current,
      deletedSignals: deletedSignalsRef.current,
      incomingGroups: allIncoming,
      tradingMode,
      currentDayKey,
      nowIso,
      nowWib,
      spotPrice,
      dominantBias: liveDominantBiasLabel,
      pdZone: cycleCompass.pdZone,
      positionPct: cycleCompass.positionPct,
      recommendedSide: cycleCompass.recommendedSide,
      resurfaceDeletedSignals: true,
      mode: 'AUTO_RESURFACE_ONLY',
    });

    if (res.resurfacedCount > 0) {
      storedSignalsRef.current = res.nextSignals;
      deletedSignalsRef.current = res.nextDeletedSignals;
      setStoredSignals(res.nextSignals);
      setDeletedSignals(res.nextDeletedSignals);
      setCaptureFeedback(
        tr(
          `[Analisa Pasar] ${res.resurfacedCount} sinyal yang pernah dihapus terdeteksi sama kembali & dimunculkan lagi ke On Going (${nowWib}).`,
          `[Market Scan] ${res.resurfacedCount} previously deleted signal setup matched again & re-appeared in On Going (${nowWib}).`
        )
      );
      window.setTimeout(() => setCaptureFeedback(null), 6000);
    }
  }, [
    resurfaceDeletedSignals,
    spotPrice,
    isLoading,
    isRefreshing,
    lastUpdatedAt,
    tradingMode,
    buyLimitGroups,
    sellLimitGroups,
    liveDominantBiasLabel,
    cycleCompass.pdZone,
    cycleCompass.positionPct,
    cycleCompass.recommendedSide,
    tr,
  ]);

  const formatPullFeedback = useCallback(
    (stats: {
      added: number;
      resurfaced: number;
      promoted: number;
      keptInOnGoing: number;
      promotedFromPrevious: number;
      archivedToPrevious: number;
      suppressed: number;
    }, fromCacheOnly: boolean): string => {
      const timeTag = getCurrentWibTimeLabel();
      const resurfaceNote =
        stats.resurfaced > 0 ? ` (termasuk ${stats.resurfaced} sinyal hapus yang muncul lagi)` : '';
      const archiveNote =
        stats.archivedToPrevious > 0
          ? `, ${stats.archivedToPrevious} sinyal lama dipindah ke Previous Data`
          : '';
      const keptNote =
        stats.keptInOnGoing > 0 ? ` · ${stats.keptInOnGoing} sinyal sama tetap di On Going` : '';
      const promotedPrevNote =
        stats.promotedFromPrevious > 0
          ? ` · ${stats.promotedFromPrevious} sinyal Previous kembali ke On Going`
          : '';
      const suppressedNote =
        stats.suppressed > 0 ? ` · ${stats.suppressed} sinyal terhapus tetap disembunyikan` : '';

      if (stats.added > 0) {
        return fromCacheOnly
          ? `${stats.added} sinyal masuk ke On Going dari cache${resurfaceNote}${archiveNote}${keptNote}${promotedPrevNote}${suppressedNote}.`
          : `${stats.added} sinyal terbaru masuk ke On Going${resurfaceNote}${archiveNote}${keptNote}${promotedPrevNote}${suppressedNote} · Prioritas: UTAMAKAN ${cycleCompass.recommendedSide} (${timeTag}).`;
      }
      if (stats.suppressed > 0 && stats.promoted === 0) {
        return `Tidak ada sinyal baru (${stats.suppressed} setup cocok dengan daftar hapus permanen) · Prioritas Real-Time: UTAMAKAN ${cycleCompass.recommendedSide} (${timeTag}).`;
      }
      if (stats.promotedFromPrevious > 0 && stats.keptInOnGoing === 0) {
        return `${stats.promotedFromPrevious} sinyal Previous sama dengan setup terbaru & kembali ke On Going${suppressedNote} · Prioritas: UTAMAKAN ${cycleCompass.recommendedSide} (${timeTag}).`;
      }
      return fromCacheOnly
        ? `Semua ${stats.promoted} sinyal masih sama dan tetap berada di On Going${suppressedNote}.`
        : `Semua ${stats.promoted} sinyal masih sama dengan sebelumnya dan tetap di On Going${suppressedNote} · Prioritas Real-Time: UTAMAKAN ${cycleCompass.recommendedSide} (${timeTag}).`;
    },
    [cycleCompass.recommendedSide]
  );

  // Pending manual capture flag after online refresh finishes
  const pendingManualCaptureRef = useRef<boolean>(false);
  const feedbackTimerRef = useRef<number | null>(null);

  const showTimedFeedback = useCallback((msg: string, durationMs: number = 5000) => {
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    setCaptureFeedback(msg);
    feedbackTimerRef.current = window.setTimeout(() => {
      setCaptureFeedback(null);
      feedbackTimerRef.current = null;
    }, durationMs);
  }, []);

  useEffect(() => {
    if (pendingManualCaptureRef.current && !isRefreshing && !isLoading && spotPrice > 0) {
      pendingManualCaptureRef.current = false;
      const stats = captureSignalsToOfflineVault(true);
      const currentDayKey = getCurrentWibDateKey();
      setSelectedDateKey(currentDayKey);
      setViewSection('ACTIVE');
      // Only follow Cycle recommendedSide automatically if user hasn't explicitly chosen a side tab
      if (!hasUserToggledSideRef.current) {
        setSelectedSide(cycleCompass.recommendedSide);
      }
      showTimedFeedback(formatPullFeedback(stats, false));
    }
  }, [
    isRefreshing,
    isLoading,
    spotPrice,
    lastUpdatedAt,
    captureSignalsToOfflineVault,
    cycleCompass.recommendedSide,
    formatPullFeedback,
    showTimedFeedback,
  ]);

  const handlePullNewRealtimeSignals = async () => {
    const currentDayKey = getCurrentWibDateKey();
    setSelectedDateKey(currentDayKey);
    if (!isOfflineMode) {
      pendingManualCaptureRef.current = true;
      const didRefresh = await refresh(true);
      // Only fallback immediately if refresh returned early (e.g. 12s cooldown) and won't trigger a fresh effect commit
      if (!didRefresh && pendingManualCaptureRef.current) {
        pendingManualCaptureRef.current = false;
        const stats = captureSignalsToOfflineVault(true);
        setViewSection('ACTIVE');
        if (!hasUserToggledSideRef.current) {
          setSelectedSide(cycleCompass.recommendedSide);
        }
        showTimedFeedback(formatPullFeedback(stats, false));
      }
    } else {
      const stats = captureSignalsToOfflineVault(true);
      setViewSection('ACTIVE');
      if (!hasUserToggledSideRef.current) {
        setSelectedSide(cycleCompass.recommendedSide);
      }
      showTimedFeedback(formatPullFeedback(stats, true));
    }
  };

  // Build available dates list (always includes todayDateKey + all distinct dates in storedSignals)
  const availableDates = useMemo(() => {
    const dateSet = new Set<string>([todayDateKey]);
    for (const r of storedSignals) {
      if (r.tradingMode === tradingMode) {
        dateSet.add(r.dateKey);
      }
    }
    return Array.from(dateSet).sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
  }, [storedSignals, tradingMode, todayDateKey]);

  // Signals filtered by selectedDateKey and tradingMode
  const dateSignalsForMode = useMemo(
    () =>
      storedSignals.filter(
        (r) => r.dateKey === selectedDateKey && r.tradingMode === tradingMode
      ),
    [storedSignals, selectedDateKey, tradingMode]
  );

  /**
   * Compass for the selected date:
   * - For TODAY (`selectedDateKey === todayDateKey`), ALWAYS use 100% REAL-TIME Cycle data (`signalResult.cycleCompass`)
   *   so Bias Dominan, Discount/Premium, CHoCH validation, and Prioritas Buy/Sell are NEVER stuck on stale morning snapshots!
   * - For past historical dates, show the last recorded compass snapshot on that date.
   */
  const activeDateCompass = useMemo(() => {
    if (selectedDateKey !== todayDateKey && dateSignalsForMode.length > 0) {
      const latestRecordOnDate = dateSignalsForMode[0];
      return {
        dominantBias: latestRecordOnDate.dominantBias,
        pdZone: latestRecordOnDate.pdZone,
        positionPct: latestRecordOnDate.positionPct,
        recommendedSide: latestRecordOnDate.recommendedSide,
        spotAtCapture: latestRecordOnDate.spotPriceAtCapture,
        capturedTimeWib: latestRecordOnDate.createdTimeWib,
        isLiveCycle: false,
      };
    }
    return {
      dominantBias: liveDominantBiasLabel,
      pdZone: cycleCompass.pdZone,
      positionPct: cycleCompass.positionPct,
      recommendedSide: cycleCompass.recommendedSide,
      spotAtCapture: spotPrice,
      capturedTimeWib: getCurrentWibTimeLabel(),
      isLiveCycle: true,
    };
  }, [
    selectedDateKey,
    todayDateKey,
    dateSignalsForMode,
    liveDominantBiasLabel,
    cycleCompass.pdZone,
    cycleCompass.positionPct,
    cycleCompass.recommendedSide,
    spotPrice,
  ]);

  useEffect(() => {
    if (!hasUserToggledSide) {
      setSelectedSide(activeDateCompass.recommendedSide);
    }
  }, [activeDateCompass.recommendedSide, hasUserToggledSide]);

  // Active signals across ALL dates for current tradingMode (Previous Data combines today's earlier batches + prior days)
  const allActiveSignalsForMode = useMemo(() => {
    return storedSignals.filter(
      (r) => r.tradingMode === tradingMode && r.status === 'ACTIVE'
    );
  }, [storedSignals, tradingMode]);

  // Distinct dates available in Previous Data for current mode
  const previousAvailableDates = useMemo(() => {
    const dateSet = new Set<string>();
    for (const r of allActiveSignalsForMode) {
      if ((r.batchStatus || 'ON_GOING') === 'PREVIOUS') {
        dateSet.add(r.dateKey);
      }
    }
    return Array.from(dateSet).sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
  }, [allActiveSignalsForMode]);

  // Reset previousDateFilter back to 'ALL' if selected filter date no longer has records
  useEffect(() => {
    if (previousDateFilter !== 'ALL' && !previousAvailableDates.includes(previousDateFilter)) {
      setPreviousDateFilter('ALL');
    }
  }, [previousDateFilter, previousAvailableDates]);

  const sortSignalsInsideBatch = useCallback(
    (list: SmcStoredSignalRecord[]) => {
      return [...list].sort((a, b) => {
        if (a.dateKey !== b.dateKey) return b.dateKey.localeCompare(a.dateKey);
        if (a.isTaken !== b.isTaken) return a.isTaken ? -1 : 1;
        const tierDiff = TIER_SORT_WEIGHT[a.tier] - TIER_SORT_WEIGHT[b.tier];
        if (tierDiff !== 0) return tierDiff;
        return b.createdAtIso.localeCompare(a.createdAtIso);
      });
    },
    []
  );

  // Active signals for the selected side (BUY or SELL):
  // - ON_GOING: latest real-time batch (or promoted active signals)
  // - PREVIOUS: ALL previous batches from today AND all prior dates combined (filterable by previousDateFilter)
  const onGoingSideSignals = useMemo(
    () =>
      sortSignalsInsideBatch(
        allActiveSignalsForMode.filter(
          (r) => r.direction === selectedSide && (r.batchStatus || 'ON_GOING') === 'ON_GOING'
        )
      ),
    [allActiveSignalsForMode, selectedSide, sortSignalsInsideBatch]
  );

  const allPreviousSideSignals = useMemo(
    () =>
      sortSignalsInsideBatch(
        allActiveSignalsForMode.filter(
          (r) => r.direction === selectedSide && (r.batchStatus || 'ON_GOING') === 'PREVIOUS'
        )
      ),
    [allActiveSignalsForMode, selectedSide, sortSignalsInsideBatch]
  );

  const filteredPreviousSideSignals = useMemo(() => {
    if (previousDateFilter === 'ALL') return allPreviousSideSignals;
    return allPreviousSideSignals.filter((r) => r.dateKey === previousDateFilter);
  }, [allPreviousSideSignals, previousDateFilter]);

  // Active signals with "Ambil Sinyal" (isTaken === true), regardless of ON_GOING or PREVIOUS batch
  const takenSideSignals = useMemo(
    () =>
      sortSignalsInsideBatch(
        allActiveSignalsForMode.filter(
          (r) => r.direction === selectedSide && r.isTaken
        )
      ),
    [allActiveSignalsForMode, selectedSide, sortSignalsInsideBatch]
  );

  const untakenOnGoingSideSignals = useMemo(
    () => onGoingSideSignals.filter((r) => !r.isTaken),
    [onGoingSideSignals]
  );

  const untakenFilteredPreviousSideSignals = useMemo(
    () => filteredPreviousSideSignals.filter((r) => !r.isTaken),
    [filteredPreviousSideSignals]
  );

  // Group Previous Data signals by dateKey (newest date first) so user can clearly distinguish today vs prior dates
  const groupedPreviousSideSignals = useMemo(() => {
    const groups = new Map<string, SmcStoredSignalRecord[]>();
    for (const sig of filteredPreviousSideSignals) {
      const existing = groups.get(sig.dateKey);
      if (existing) {
        existing.push(sig);
      } else {
        groups.set(sig.dateKey, [sig]);
      }
    }
    return Array.from(groups.entries()).sort((a, b) => (a[0] > b[0] ? -1 : a[0] < b[0] ? 1 : 0));
  }, [filteredPreviousSideSignals]);

  const groupedUntakenPreviousSideSignals = useMemo(() => {
    const groups = new Map<string, SmcStoredSignalRecord[]>();
    for (const sig of untakenFilteredPreviousSideSignals) {
      const existing = groups.get(sig.dateKey);
      if (existing) {
        existing.push(sig);
      } else {
        groups.set(sig.dateKey, [sig]);
      }
    }
    return Array.from(groups.entries()).sort((a, b) => (a[0] > b[0] ? -1 : a[0] < b[0] ? 1 : 0));
  }, [untakenFilteredPreviousSideSignals]);

  const onGoingSideCount = onGoingSideSignals.length;
  const takenSideCount = takenSideSignals.length;
  const previousSideCount = allPreviousSideSignals.length;
  const allActiveSideCount =
    takenSideCount + untakenOnGoingSideSignals.length + untakenFilteredPreviousSideSignals.length;

  const activeSideSignals = useMemo(() => {
    if (batchFilter === 'ON_GOING') return onGoingSideSignals;
    if (batchFilter === 'TAKEN') return takenSideSignals;
    if (batchFilter === 'PREVIOUS') return filteredPreviousSideSignals;
    return [...takenSideSignals, ...untakenOnGoingSideSignals, ...untakenFilteredPreviousSideSignals];
  }, [
    batchFilter,
    onGoingSideSignals,
    takenSideSignals,
    filteredPreviousSideSignals,
    untakenOnGoingSideSignals,
    untakenFilteredPreviousSideSignals,
  ]);

  const activeBuyCount = useMemo(() => {
    return allActiveSignalsForMode.filter((r) => {
      if (r.direction !== 'BUY') return false;
      const batch = r.batchStatus || 'ON_GOING';
      if (batchFilter === 'ON_GOING') return batch === 'ON_GOING';
      if (batchFilter === 'TAKEN') return Boolean(r.isTaken);
      if (batchFilter === 'PREVIOUS') {
        return batch === 'PREVIOUS' && (previousDateFilter === 'ALL' || r.dateKey === previousDateFilter);
      }
      return Boolean(r.isTaken) || batch === 'ON_GOING' || previousDateFilter === 'ALL' || r.dateKey === previousDateFilter;
    }).length;
  }, [allActiveSignalsForMode, batchFilter, previousDateFilter]);

  const activeSellCount = useMemo(() => {
    return allActiveSignalsForMode.filter((r) => {
      if (r.direction !== 'SELL') return false;
      const batch = r.batchStatus || 'ON_GOING';
      if (batchFilter === 'ON_GOING') return batch === 'ON_GOING';
      if (batchFilter === 'TAKEN') return Boolean(r.isTaken);
      if (batchFilter === 'PREVIOUS') {
        return batch === 'PREVIOUS' && (previousDateFilter === 'ALL' || r.dateKey === previousDateFilter);
      }
      return Boolean(r.isTaken) || batch === 'ON_GOING' || previousDateFilter === 'ALL' || r.dateKey === previousDateFilter;
    }).length;
  }, [allActiveSignalsForMode, batchFilter, previousDateFilter]);

  const totalActiveAllDates = allActiveSignalsForMode.length;

  // Combined History signals across all dates for current tradingMode
  const allHistorySignalsForMode = useMemo(
    () =>
      filterSignalHistoryRecords({
        records: storedSignals,
        tradingMode,
        filterMode: 'ALL',
        customDateKey: historyCustomDateKey,
        todayDateKey,
      }),
    [storedSignals, tradingMode, historyCustomDateKey, todayDateKey]
  );

  const todayHistoryCount = useMemo(
    () =>
      allHistorySignalsForMode.filter(
        (r) => getSignalHistoryEffectiveDateKey(r) === todayDateKey
      ).length,
    [allHistorySignalsForMode, todayDateKey]
  );

  const historyAvailableDates = useMemo(
    () => getAvailableHistoryDates(storedSignals, tradingMode, todayDateKey),
    [storedSignals, tradingMode, todayDateKey]
  );

  // History signals matching active date filter (before BUY/SELL filter) for accurate direction counts
  const dateFilteredHistorySignals = useMemo(
    () =>
      filterSignalHistoryRecords({
        records: storedSignals,
        tradingMode,
        filterMode: historyDateFilterMode,
        customDateKey: historyCustomDateKey,
        todayDateKey,
      }),
    [storedSignals, tradingMode, historyDateFilterMode, historyCustomDateKey, todayDateKey]
  );

  const historyBuyCount = useMemo(
    () => dateFilteredHistorySignals.filter((r) => r.direction === 'BUY').length,
    [dateFilteredHistorySignals]
  );

  const historySellCount = useMemo(
    () => dateFilteredHistorySignals.filter((r) => r.direction === 'SELL').length,
    [dateFilteredHistorySignals]
  );

  // Filtered History signals according to active date filter AND direction filter ('ALL' | 'BUY' | 'SELL')
  const filteredHistorySignals = useMemo(
    () =>
      filterSignalHistoryRecords({
        records: storedSignals,
        tradingMode,
        filterMode: historyDateFilterMode,
        customDateKey: historyCustomDateKey,
        todayDateKey,
        directionFilter: historyDirectionFilter,
      }),
    [
      storedSignals,
      tradingMode,
      historyDateFilterMode,
      historyCustomDateKey,
      todayDateKey,
      historyDirectionFilter,
    ]
  );

  // History grouped by effective completion date (newest date first) for combined 'ALL' view
  const groupedHistorySignals = useMemo(
    () => groupHistoryRecordsByDate(filteredHistorySignals),
    [filteredHistorySignals]
  );

  // History Stats (Hit TP vs Hit SL, Win Rate & Net Pips) matching active filter
  const historySummary = useMemo(
    () => computeSignalHistorySummary(filteredHistorySignals),
    [filteredHistorySignals]
  );

  const computeOutcomeResultPips = useCallback(
    (
      record: SmcStoredSignalRecord,
      outcome: Exclude<SmcSignalOutcomeStatus, 'ACTIVE'>
    ): number => {
      if (outcome === 'HIT_TP1') {
        return record.tp1Pips || Math.round(Math.abs(record.tp1 - record.entryLimit) * 10);
      }
      if (outcome === 'HIT_TP2') {
        return 100; // 1:2 = 100 pips
      }
      if (outcome === 'HIT_TP_MAX') {
        return Math.round(Math.abs(record.tpMax - record.entryLimit) * 10);
      }
      // HIT_SL: 50 pips + 20 point = 52 pips risk
      return -(record.slPips + Math.round(record.slPoints / 10));
    },
    []
  );

  const formatOutcomeShortLabel = useCallback(
    (
      record: SmcStoredSignalRecord,
      outcome: Exclude<SmcSignalOutcomeStatus, 'ACTIVE'>
    ): string => {
      if (outcome === 'HIT_TP1') return 'HIT TP 1 (1:1)';
      if (outcome === 'HIT_TP2') return 'HIT TP 2 (1:2)';
      if (outcome === 'HIT_TP_MAX') return `HIT TP MAX (${record.tpMaxRrLabel})`;
      return 'HIT SL';
    },
    []
  );

  // Handlers for interacting with signal cards (memoized so MemoSignalCard / MemoHistorySignalCard stay 60fps)
  const handleToggleTakeSignal = useCallback((uid: string) => {
    setStoredSignals((prev) =>
      prev.map((item) => (item.uid === uid ? { ...item, isTaken: !item.isTaken } : item))
    );
  }, []);

  const handleToggleBatchStatus = useCallback(
    (uid: string, targetBatch: SmcSignalBatchStatus) => {
      const currentDayKey = getCurrentWibDateKey();
      setStoredSignals((prev) =>
        prev.map((item) =>
          item.uid === uid
            ? {
                ...item,
                batchStatus: targetBatch,
                promotedDateKey: targetBatch === 'ON_GOING' ? currentDayKey : null,
              }
            : item
        )
      );
    },
    []
  );

  const handleRequestOutcomeConfirm = useCallback(
    (record: SmcStoredSignalRecord, outcome: Exclude<SmcSignalOutcomeStatus, 'ACTIVE'>) => {
      setPendingOutcomeConfirm({ record, outcome });
    },
    []
  );

  const handleMarkSignalOutcome = (
    record: SmcStoredSignalRecord,
    outcome: Exclude<SmcSignalOutcomeStatus, 'ACTIVE'>
  ) => {
    const now = new Date();
    const closedAtIso = now.toISOString();
    const closedDateKey = getCurrentWibDateKey(now);
    const closedTimeWib = getCurrentWibTimeLabel(now);
    const resultPips = computeOutcomeResultPips(record, outcome);

    const previousSnapshot: SmcStoredSignalRecord = { ...record };

    setStoredSignals((prev) =>
      prev.map((item) =>
        item.uid === record.uid
          ? {
              ...item,
              isTaken: true,
              status: outcome,
              closedAtIso,
              closedDateKey,
              closedTimeWib,
              resultPips,
            }
          : item
      )
    );

    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }
    const pipsText = resultPips >= 0 ? `+${resultPips} pips` : `${resultPips} pips`;
    setRecentOutcomeUndo({
      uid: record.uid,
      previousRecord: previousSnapshot,
      summaryText: tr(
        `${record.headerTitle} (${record.direction}) dicatat ${formatOutcomeShortLabel(
          record,
          outcome
        )} · ${pipsText} ke Riwayat TP / SL.`,
        `${record.headerTitle} (${record.direction}) recorded as ${formatOutcomeShortLabel(
          record,
          outcome
        )} · ${pipsText} in History.`
      ),
    });
    undoTimerRef.current = window.setTimeout(() => {
      setRecentOutcomeUndo(null);
      undoTimerRef.current = null;
    }, 9000);
  };

  const handleUndoRecentOutcome = () => {
    if (!recentOutcomeUndo) return;
    const { uid, previousRecord } = recentOutcomeUndo;
    setStoredSignals((prev) =>
      prev.map((item) => (item.uid === uid ? { ...previousRecord } : item))
    );
    setRecentOutcomeUndo(null);
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    showTimedFeedback(
      tr(
        `${previousRecord.headerTitle} (${previousRecord.direction}) dibatalkan & dikembalikan ke Sinyal Aktif.`,
        `${previousRecord.headerTitle} (${previousRecord.direction}) restored to Active Signals.`
      ),
      4000
    );
  };

  const handleRestoreToActive = useCallback((uid: string) => {
    const currentDayKey = getCurrentWibDateKey();
    setStoredSignals((prev) =>
      prev.map((item) =>
        item.uid === uid
          ? {
              ...item,
              status: 'ACTIVE',
              batchStatus: 'ON_GOING',
              promotedDateKey: currentDayKey,
              closedAtIso: null,
              closedDateKey: null,
              closedTimeWib: null,
              resultPips: null,
            }
          : item
      )
    );
  }, []);

  const handleDeleteSignal = useCallback(
    (uid: string) => {
      const target = storedSignalsRef.current.find((item) => item.uid === uid);
      const nextSignals = storedSignalsRef.current.filter((item) => item.uid !== uid);
      storedSignalsRef.current = nextSignals;
      setStoredSignals(nextSignals);

      if (target && target.status === 'ACTIVE') {
        const nextDeleted = recordDeletedActiveSignal(
          deletedSignalsRef.current,
          target,
          new Date().toISOString()
        );
        deletedSignalsRef.current = nextDeleted;
        setDeletedSignals(nextDeleted);

        showTimedFeedback(
          resurfaceOptionRef.current
            ? tr(
                `Sinyal ${target.headerTitle} dihapus. Akan muncul kembali jika analisa menemukan setup yang sama.`,
                `Signal ${target.headerTitle} deleted. It will re-appear if later analysis finds the same setup.`
              )
            : tr(
                `Sinyal ${target.headerTitle} dihapus & disembunyikan permanen.`,
                `Signal ${target.headerTitle} deleted & kept hidden.`
              ),
          4500
        );
      }
    },
    [showTimedFeedback, tr]
  );

  const handleToggleResurfaceDeleted = () => {
    const next = !resurfaceOptionRef.current;
    resurfaceOptionRef.current = next;
    setResurfaceDeletedSignals(next);
  };

  const handleClearDeletedArchiveForMode = () => {
    const remaining = deletedSignalsRef.current.filter((d) => d.tradingMode !== tradingMode);
    deletedSignalsRef.current = remaining;
    setDeletedSignals(remaining);
  };

  const deletedForModeCount = useMemo(
    () => deletedSignals.filter((d) => d.tradingMode === tradingMode).length,
    [deletedSignals, tradingMode]
  );

  const formattedUpdatedTime = useMemo(() => {
    if (!lastUpdatedAt) return '—';
    try {
      return new Date(lastUpdatedAt).toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return '—';
    }
  }, [lastUpdatedAt]);

  const confirmModalNode = pendingOutcomeConfirm
    ? (() => {
        const { record, outcome } = pendingOutcomeConfirm;
        const isSl = outcome === 'HIT_SL';
        const outcomeLabel = formatOutcomeShortLabel(record, outcome);
        const estimatedPips = computeOutcomeResultPips(record, outcome);
        const targetPrice =
          outcome === 'HIT_TP1'
            ? record.tp1
            : outcome === 'HIT_TP2'
            ? record.tp2
            : outcome === 'HIT_TP_MAX'
            ? record.tpMax
            : record.stopLoss;

        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="smc-outcome-confirm-title"
            data-testid="smc-outcome-confirm-modal"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 dark:bg-black/75 animate-in fade-in duration-150"
            onClick={() => setPendingOutcomeConfirm(null)}
          >
            <div
              style={{ contain: 'layout style' }}
              className="w-full max-w-sm rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] p-4 sm:p-5 shadow-[0_20px_48px_-12px_rgba(15,23,42,0.22)] dark:shadow-[0_24px_56px_-12px_rgba(0,0,0,0.78)] space-y-4 font-sans"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.06em]">
                    <span
                      className={
                        record.direction === 'BUY'
                          ? 'text-[#059669] dark:text-[#00A878]'
                          : 'text-[#E11D48] dark:text-[#E05260]'
                      }
                    >
                      {record.direction}
                    </span>
                    <span className="text-[#CBD5E1] dark:text-[#3A4250]">·</span>
                    <span
                      className={
                        isSl
                          ? 'text-[#E11D48] dark:text-[#E05260]'
                          : 'text-[#059669] dark:text-[#00A878]'
                      }
                    >
                      {outcomeLabel}
                    </span>
                  </div>
                  <h3
                    id="smc-outcome-confirm-title"
                    className="text-sm font-bold text-[#0F172A] dark:text-[#F2F4F7] truncate"
                  >
                    {tr('Konfirmasi Simpan ke Riwayat?', 'Confirm Save to History?')}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setPendingOutcomeConfirm(null)}
                  aria-label={tr('Tutup dialog', 'Close dialog')}
                  className="h-7 w-7 rounded-full inline-flex items-center justify-center text-[#526071] dark:text-[#929BA9] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="rounded-xl border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#161A22] p-3.5 space-y-2 text-xs font-mono-numbers tabular-nums">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-sans text-[#526071] dark:text-[#929BA9]">Sinyal</span>
                  <span className="font-sans font-semibold text-[#0F172A] dark:text-[#F2F4F7] truncate">
                    {record.headerTitle}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-sans text-[#526071] dark:text-[#929BA9]">Entry Limit</span>
                  <span className="font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                    {record.entryLimit.toFixed(1)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-sans text-[#526071] dark:text-[#929BA9]">
                    {isSl ? 'Level SL' : 'Target Level'}
                  </span>
                  <span
                    className={`font-bold ${
                      isSl
                        ? 'text-[#E11D48] dark:text-[#E05260]'
                        : 'text-[#059669] dark:text-[#00A878]'
                    }`}
                  >
                    {targetPrice.toFixed(1)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#E4E4E7] dark:border-[#20252D]">
                  <span className="font-sans font-semibold text-[#526071] dark:text-[#929BA9]">
                    {tr('Estimasi Hasil', 'Est. Result')}
                  </span>
                  <span
                    className={`font-bold ${
                      estimatedPips >= 0
                        ? 'text-[#059669] dark:text-[#00A878]'
                        : 'text-[#E11D48] dark:text-[#E05260]'
                    }`}
                  >
                    {estimatedPips >= 0 ? `+${estimatedPips} pips` : `${estimatedPips} pips`}
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-[#526071] dark:text-[#929BA9] leading-relaxed text-editorial-justify">
                {tr(
                  'Sinyal dipindahkan ke Riwayat TP / SL dan tetap dapat dikembalikan kapan saja.',
                  'Signal moves to TP / SL History and can be restored anytime.'
                )}
              </p>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  data-testid="smc-outcome-confirm-cancel"
                  onClick={() => setPendingOutcomeConfirm(null)}
                  className="flex-1 h-9 px-4 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] transition-colors cursor-pointer"
                >
                  {tr('Batal', 'Cancel')}
                </button>
                <button
                  type="button"
                  data-testid="smc-outcome-confirm-submit"
                  onClick={() => {
                    handleMarkSignalOutcome(record, outcome);
                    setPendingOutcomeConfirm(null);
                  }}
                  className={`flex-1 h-9 px-4 rounded-full text-xs font-bold text-white transition-opacity hover:opacity-90 cursor-pointer ${
                    isSl
                      ? 'bg-[#E11D48] dark:bg-[#E05260]'
                      : 'bg-[#059669] dark:bg-[#00A878] dark:text-[#050607]'
                  }`}
                >
                  {tr('Ya, Simpan', 'Yes, Save')}
                </button>
              </div>
            </div>
          </div>
        );
      })()
    : null;

  return (
    <div
      data-testid="smc-signal-page"
      className="space-y-5 pb-10 text-[#0F172A] dark:text-[#F2F4F7] font-sans overflow-x-hidden"
    >
      {/* =====================================================================
          HEADER EDITORIAL MINIMALIS + UNDERLINE TABS & GPU SLIDING MODE SWITCH
         ===================================================================== */}
      <div className="space-y-3.5">
        {/* Row 1: Title & Live Spot + Compact Monochrome Actions */}
        <div className="relative flex flex-wrap items-center justify-between gap-2.5">
          <div className="min-w-0">
            <h1 className="text-xs font-bold uppercase tracking-[0.14em] text-[#0F172A] dark:text-[#F2F4F7] truncate">
              SMC Signal · XAU/USD
            </h1>
            <p className="text-[11px] text-[#526071] dark:text-[#929BA9] font-mono-numbers tabular-nums mt-0.5 truncate">
              {spotPrice > 0 ? `$${spotPrice.toFixed(1)}` : tr('Memuat...', 'Loading...')}
              {` · ${isOfflineMode ? tr('Offline', 'Offline') : tr('Sync Lokal', 'Local Sync')} · ${formattedUpdatedTime}`}
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              data-testid="smc-signal-offline-toggle"
              onClick={handleToggleOfflineMode}
              title={
                isOfflineMode
                  ? tr('Mode Offline Aktif — klik untuk Online', 'Offline Mode — click for Online')
                  : tr('Mode Online Aktif — klik untuk Offline', 'Online Mode — click for Offline')
              }
              aria-label={isOfflineMode ? 'Mode Offline' : 'Mode Online'}
              className={`h-8 w-8 inline-flex items-center justify-center rounded-full border transition-colors duration-150 shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                isOfflineMode
                  ? 'bg-[#D97706]/10 dark:bg-[#F59E0B]/15 border-[#D97706]/40 dark:border-[#F59E0B]/40 text-[#B45309] dark:text-[#F59E0B]'
                  : 'bg-white dark:bg-[#101318] border-[#E4E4E7] dark:border-[#20252D] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
              }`}
            >
              {isOfflineMode ? (
                <WifiOff className="w-3.5 h-3.5 stroke-[2]" />
              ) : (
                <Wifi className="w-3.5 h-3.5 stroke-[1.75]" />
              )}
            </button>

            {onNavigate && (
              <button
                type="button"
                data-testid="smc-signal-open-cycle-button"
                onClick={() => onNavigate('cycle-confluence')}
                className="h-8 px-3 inline-flex items-center justify-center gap-1.5 rounded-full bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] text-xs font-medium text-[#0F172A] dark:text-[#F2F4F7] transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
              >
                <Compass className="w-3.5 h-3.5 stroke-[1.75] text-[#526071] dark:text-[#929BA9]" />
                <span>Cycle</span>
              </button>
            )}

            {/* Overflow Options Menu */}
            <div ref={optionsMenuRef} className="relative">
              <button
                type="button"
                data-testid="smc-signal-options-button"
                aria-expanded={isOptionsMenuOpen}
                aria-haspopup="menu"
                onClick={() => setIsOptionsMenuOpen((prev) => !prev)}
                title={tr('Pengaturan Sinyal', 'Signal Options')}
                className={`relative h-8 w-8 inline-flex items-center justify-center rounded-full border transition-colors duration-150 shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                  isOptionsMenuOpen
                    ? 'bg-[#0F172A] text-white border-[#0F172A] dark:bg-white dark:text-[#050607] dark:border-white'
                    : 'bg-white dark:bg-[#101318] border-[#E4E4E7] dark:border-[#20252D] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5 stroke-[1.75]" />
              </button>

              {isOptionsMenuOpen && (
                <div
                  role="menu"
                  style={{ contain: 'layout style' }}
                  className="absolute right-0 top-full mt-2 w-72 sm:w-80 max-w-[calc(100vw-2rem)] rounded-xl bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] shadow-[0_12px_32px_-8px_rgba(15,23,42,0.16)] dark:shadow-[0_16px_36px_-8px_rgba(0,0,0,0.75)] p-3.5 space-y-3 z-40 animate-in fade-in slide-in-from-top-1 duration-150"
                >
                  <div className="flex items-center justify-between border-b border-[#E4E4E7] dark:border-[#20252D] pb-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9]">
                      {tr('Pengaturan Sinyal', 'Signal Settings')}
                    </span>
                    {deletedForModeCount > 0 && (
                      <span className="text-[11px] font-mono-numbers text-[#526071] dark:text-[#929BA9]">
                        {deletedForModeCount} {tr('arsip', 'archived')}
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={resurfaceDeletedSignals}
                    data-testid="smc-resurface-deleted-toggle"
                    onClick={handleToggleResurfaceDeleted}
                    className="w-full px-3 py-2.5 rounded-lg border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#161A22] text-left transition-colors hover:border-[#0F172A]/35 dark:hover:border-white/30 cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                        <RotateCcw className="w-3.5 h-3.5 shrink-0 text-[#526071] dark:text-[#929BA9]" />
                        <span>
                          {tr('Munculkan Lagi Sinyal Dihapus', 'Re-surface Deleted Signals')}
                        </span>
                      </span>
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider ${
                          resurfaceDeletedSignals
                            ? 'text-[#059669] dark:text-[#00A878]'
                            : 'text-[#526071] dark:text-[#929BA9]'
                        }`}
                      >
                        {resurfaceDeletedSignals ? 'ON' : 'OFF'}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#526071] dark:text-[#929BA9] mt-1 leading-relaxed text-editorial-justify">
                      {resurfaceDeletedSignals
                        ? tr(
                            'Sinyal yang dihapus muncul lagi otomatis jika analisa nanti menemukan setup sama.',
                            'Deleted signals re-appear automatically if later analysis finds the same setup.'
                          )
                        : tr(
                            'Sinyal yang dihapus tetap tersembunyi sampai arsip di-reset.',
                            'Deleted signals stay hidden until the archive is reset.'
                          )}
                    </p>
                  </button>

                  {deletedForModeCount > 0 && (
                    <button
                      type="button"
                      data-testid="smc-clear-deleted-archive"
                      onClick={() => {
                        handleClearDeletedArchiveForMode();
                        setIsOptionsMenuOpen(false);
                      }}
                      className="w-full h-8 px-3 rounded-lg border border-[#E4E4E7] dark:border-[#20252D] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] text-xs font-semibold text-[#E11D48] dark:text-[#E05260] inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>
                        {tr('Reset Arsip Sinyal Dihapus', 'Reset Deleted Tracker')} ({deletedForModeCount})
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              data-testid="smc-signal-pull-new-button"
              onClick={() => void handlePullNewRealtimeSignals()}
              disabled={isRefreshing || isLoading}
              className="h-8 inline-flex items-center justify-center gap-1.5 px-3.5 rounded-full bg-[#0F172A] dark:bg-white text-white dark:text-[#050607] hover:opacity-90 text-xs font-semibold transition-opacity duration-150 disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
            >
              {isRefreshing || isLoading ? (
                <RefreshCw className="w-3.5 h-3.5 stroke-[2] animate-spin" />
              ) : (
                <PlusCircle className="w-3.5 h-3.5 stroke-[2]" />
              )}
              <span>{tr('Tarik Sinyal', 'Pull Signal')}</span>
            </button>
          </div>
        </div>

        {/* Quiet Monochrome Feedback / Undo Banners */}
        {captureFeedback && (
          <div className="px-3.5 py-2.5 rounded-xl bg-[#FAFAFA] dark:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] text-xs text-[#0F172A] dark:text-[#F2F4F7] animate-in fade-in duration-150">
            {captureFeedback}
          </div>
        )}

        {recentOutcomeUndo && (
          <div
            data-testid="smc-outcome-undo-banner"
            className="px-3.5 py-2.5 rounded-xl bg-[#FAFAFA] dark:bg-[#161A22] border border-[#0F172A]/25 dark:border-white/25 flex flex-wrap items-center justify-between gap-2 text-xs animate-in fade-in duration-150"
          >
            <span className="font-medium text-[#0F172A] dark:text-[#F2F4F7]">
              {recentOutcomeUndo.summaryText}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                data-testid="smc-outcome-undo-button"
                onClick={handleUndoRecentOutcome}
                className="h-7 px-3 rounded-full bg-[#0F172A] dark:bg-white text-white dark:text-[#050607] text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>{tr('Batalkan', 'Undo')}</span>
              </button>
              <button
                type="button"
                onClick={() => setRecentOutcomeUndo(null)}
                aria-label={tr('Tutup notifikasi', 'Dismiss notice')}
                className="h-7 w-7 rounded-full inline-flex items-center justify-center text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Row 2: Editorial Underline Tabs + GPU-Sliding Timeframe Switch */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-[#E4E4E7] dark:border-[#20252D]">
          <div
            role="tablist"
            aria-label="Sinyal Aktif atau Riwayat"
            className="flex items-center gap-5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewSection === 'ACTIVE'}
              data-testid="smc-view-active-button"
              onClick={() => setViewSection('ACTIVE')}
              className={`pb-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors duration-150 inline-flex items-baseline gap-1.5 whitespace-nowrap cursor-pointer ${
                viewSection === 'ACTIVE'
                  ? 'border-[#0F172A] dark:border-white text-[#0F172A] dark:text-[#F2F4F7]'
                  : 'border-transparent text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
              }`}
            >
              <span>{tr('Sinyal Aktif', 'Active Signals')}</span>
              <span className="text-[11px] font-mono-numbers tabular-nums opacity-65">
                {totalActiveAllDates}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={viewSection === 'HISTORY'}
              data-testid="smc-view-history-button"
              onClick={() => setViewSection('HISTORY')}
              className={`pb-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors duration-150 inline-flex items-baseline gap-1.5 whitespace-nowrap cursor-pointer ${
                viewSection === 'HISTORY'
                  ? 'border-[#0F172A] dark:border-white text-[#0F172A] dark:text-[#F2F4F7]'
                  : 'border-transparent text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
              }`}
            >
              <span>{tr('Riwayat TP / SL', 'TP / SL History')}</span>
              <span className="text-[11px] font-mono-numbers tabular-nums opacity-65">
                {allHistorySignalsForMode.length}
              </span>
            </button>
          </div>

          <div
            role="group"
            aria-label="Mode Timeframe"
            className="relative mb-1.5 inline-grid grid-cols-2 p-0.5 rounded-full bg-[#FAFAFA] dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D]"
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-2px)] rounded-full bg-[#0F172A] dark:bg-white transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                tradingMode === 'SWING' ? 'translate-x-full' : 'translate-x-0'
              }`}
            />
            <button
              type="button"
              data-testid="smc-signal-mode-scalp"
              onClick={() => setTradingMode('SCALP')}
              className={`relative z-10 h-7 px-3 rounded-full text-[11px] font-semibold transition-colors duration-150 whitespace-nowrap cursor-pointer ${
                tradingMode === 'SCALP'
                  ? 'text-white dark:text-[#050607]'
                  : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
              }`}
            >
              Scalping · M5–1H
            </button>
            <button
              type="button"
              data-testid="smc-signal-mode-swing"
              onClick={() => setTradingMode('SWING')}
              className={`relative z-10 h-7 px-3 rounded-full text-[11px] font-semibold transition-colors duration-150 whitespace-nowrap cursor-pointer ${
                tradingMode === 'SWING'
                  ? 'text-white dark:text-[#050607]'
                  : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
              }`}
            >
              Intraday · 1H–D1
            </button>
          </div>
        </div>
      </div>

      {/* =====================================================================
          CYCLE COMPASS STRIP: RINGKAS, MINIMALIS, CHoCH PENUH & BISA DIBUKA DETAIL
         ===================================================================== */}
      <div
        data-testid="smc-cycle-compass-card"
        style={{ contain: 'layout style' }}
        className="rounded-xl overflow-hidden border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] divide-y divide-[#E4E4E7] dark:divide-[#20252D]"
      >
        {/* Row 1: Bias Cycle + Prioritas Setup (Balanced 2-Column) */}
        <div className="grid grid-cols-2 divide-x divide-[#E4E4E7] dark:divide-[#20252D]">
          {/* 1. BIAS CYCLE */}
          <div className="min-w-0 px-3.5 py-2.5 sm:px-4 sm:py-3 flex flex-col justify-between gap-1">
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
              <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#526071] dark:text-[#929BA9]">
                {tr('Bias Cycle', 'Cycle Bias')}
              </span>
              <span className="text-[10px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                EQ ${cycleCompass.equilibriumPrice.toFixed(1)}
              </span>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 font-mono-numbers tabular-nums">
              <span
                className={`text-xs sm:text-sm font-bold ${
                  activeDateCompass.dominantBias === 'BULLISH'
                    ? 'text-[#059669] dark:text-[#00A878]'
                    : activeDateCompass.dominantBias === 'BEARISH'
                    ? 'text-[#E11D48] dark:text-[#E05260]'
                    : 'text-[#0F172A] dark:text-[#F2F4F7]'
                }`}
              >
                {activeDateCompass.dominantBias}
                {activeDateCompass.isLiveCycle &&
                typeof cycleCompass.cycleUptrendPct === 'number' &&
                typeof cycleCompass.cycleDowntrendPct === 'number'
                  ? activeDateCompass.dominantBias === 'BULLISH'
                    ? ` ${cycleCompass.cycleUptrendPct}%`
                    : activeDateCompass.dominantBias === 'BEARISH'
                    ? ` ${cycleCompass.cycleDowntrendPct}%`
                    : ''
                  : ''}
              </span>
              <span className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                {activeDateCompass.pdZone} {activeDateCompass.positionPct.toFixed(0)}%
              </span>
            </div>
          </div>

          {/* 2. PRIORITAS SETUP */}
          <div className="min-w-0 px-3.5 py-2.5 sm:px-4 sm:py-3 flex flex-col justify-between gap-1">
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
              <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#526071] dark:text-[#929BA9]">
                {tr('Prioritas', 'Priority')}
              </span>
              <span className="text-[10px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                {activeDateCompass.isLiveCycle ? 'LIVE' : activeDateCompass.capturedTimeWib}
              </span>
            </div>
            <span
              data-testid="smc-priority-recommendation-badge"
              className={`inline-flex items-center gap-1 text-xs sm:text-sm font-bold uppercase ${
                activeDateCompass.recommendedSide === 'BUY'
                  ? 'text-[#059669] dark:text-[#00A878]'
                  : 'text-[#E11D48] dark:text-[#E05260]'
              }`}
            >
              {activeDateCompass.recommendedSide === 'BUY' ? (
                <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <ArrowDownRight className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>
                {activeDateCompass.recommendedSide === 'BUY'
                  ? tr('Utamakan BUY', 'Prioritize BUY')
                  : tr('Utamakan SELL', 'Prioritize SELL')}
              </span>
            </span>
          </div>
        </div>

        {/* Row 2: VALIDASI CHoCH — Full-Width Uncut Status + Tap-to-Expand Complete Explanation */}
        <div data-testid="smc-choch-indication-card" className="min-w-0">
          <button
            type="button"
            data-testid="smc-choch-expand-toggle"
            aria-expanded={isChochDetailOpen}
            onClick={() => setIsChochDetailOpen((prev) => !prev)}
            className="w-full px-3.5 py-2.5 sm:px-4 sm:py-3 text-left flex flex-col gap-1.5 hover:bg-[#FAFAFA] dark:hover:bg-[#161A22]/70 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0F172A]/30 dark:focus-visible:ring-white/30"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                <span className="font-sans font-medium uppercase tracking-[0.08em]">
                  {tradingMode === 'SCALP' ? 'CHoCH · M5/M15' : 'CHoCH · 1H'}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {activeSidePlan.healthyObAudit.isHealthySmcOb ? 'OB+FVG ✓' : 'Cek OB+FVG'}
                </span>
                {selectedSide === 'BUY' && twoStage.narrowPullbackHighToBreak > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>PB ${twoStage.narrowPullbackHighToBreak.toFixed(1)}</span>
                  </>
                )}
                {selectedSide === 'SELL' && twoStage.narrowPullbackLowToBreak > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>PB ${twoStage.narrowPullbackLowToBreak.toFixed(1)}</span>
                  </>
                )}
              </div>

              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#526071] dark:text-[#929BA9] shrink-0">
                <span>
                  {isChochDetailOpen
                    ? tr('Tutup', 'Close')
                    : tr('Penjelasan', 'Details')}
                </span>
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                    isChochDetailOpen ? 'rotate-180' : 'rotate-0'
                  }`}
                />
              </span>
            </div>

            <p className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] font-mono-numbers leading-snug break-words">
              {tr(twoStage.statusBadgeId, twoStage.statusBadgeEn)}
            </p>
          </button>

          {isChochDetailOpen && (
            <div
              data-testid="smc-choch-detail-panel"
              className="px-3.5 pb-3 pt-2.5 sm:px-4 sm:pb-3.5 border-t border-dashed border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA]/70 dark:bg-[#161A22]/50 space-y-2 animate-in fade-in slide-in-from-top-1 duration-150"
            >
              <p className="text-xs text-[#334155] dark:text-[#CBD5E1] leading-relaxed text-editorial-justify">
                {tr(twoStage.summaryId, twoStage.summaryEn)}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                <span>
                  {twoStage.structureAnchorTf} LH ${twoStage.referenceLhPrice.toFixed(1)}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {twoStage.structureAnchorTf} HL ${twoStage.referenceHlPrice.toFixed(1)}
                </span>
                {twoStage.narrowPullbackHighToBreak > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-[#059669] dark:text-[#00A878]">
                      Buy CHoCH &gt; ${twoStage.narrowPullbackHighToBreak.toFixed(1)}
                    </span>
                  </>
                )}
                {twoStage.narrowPullbackLowToBreak > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-[#E11D48] dark:text-[#E05260]">
                      Sell CHoCH &lt; ${twoStage.narrowPullbackLowToBreak.toFixed(1)}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* =====================================================================
          FILTER BAR MONOKROM & FLUID + DRAWER TANGGAL ON-DEMAND
         ===================================================================== */}
      <div className="space-y-2.5">
        {viewSection === 'ACTIVE' ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            {/* GPU-Sliding BUY vs SELL Switch (Zero Inner Color Pills) */}
            <div
              role="tablist"
              aria-label="Pilih Opsi Buy atau Sell"
              className="relative w-full sm:w-auto grid grid-cols-2 p-0.5 rounded-full bg-[#FAFAFA] dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] shrink-0"
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-2px)] rounded-full bg-[#0F172A] dark:bg-white transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                  selectedSide === 'SELL' ? 'translate-x-full' : 'translate-x-0'
                }`}
              />
              <button
                type="button"
                role="tab"
                aria-selected={selectedSide === 'BUY'}
                data-testid="smc-signal-tab-buy"
                onClick={() => {
                  setHasUserToggledSide(true);
                  setSelectedSide('BUY');
                }}
                className={`relative z-10 h-8 sm:h-7 px-3.5 rounded-full text-xs font-semibold transition-colors duration-150 flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap ${
                  selectedSide === 'BUY'
                    ? 'text-white dark:text-[#050607]'
                    : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                }`}
              >
                <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
                <span>BUY</span>
                <span className="font-mono-numbers tabular-nums opacity-70">{activeBuyCount}</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={selectedSide === 'SELL'}
                data-testid="smc-signal-tab-sell"
                onClick={() => {
                  setHasUserToggledSide(true);
                  setSelectedSide('SELL');
                }}
                className={`relative z-10 h-8 sm:h-7 px-3.5 rounded-full text-xs font-semibold transition-colors duration-150 flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap ${
                  selectedSide === 'SELL'
                    ? 'text-white dark:text-[#050607]'
                    : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                }`}
              >
                <ArrowDownRight className="w-3.5 h-3.5 shrink-0" />
                <span>SELL</span>
                <span className="font-mono-numbers tabular-nums opacity-70">{activeSellCount}</span>
              </button>
            </div>

            {/* Clean Monochrome Status Filters + Single Date Button */}
            <div className="flex items-center justify-between gap-2 flex-1 min-w-0">
              <div
                role="group"
                aria-label="Filter status sinyal"
                className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5 min-w-0"
              >
                {[
                  {
                    id: 'ALL' as const,
                    testId: 'smc-batch-filter-all',
                    label: tr('Semua', 'All'),
                    count: allActiveSideCount,
                  },
                  {
                    id: 'ON_GOING' as const,
                    testId: 'smc-batch-filter-ongoing',
                    label: 'On Going',
                    count: onGoingSideCount,
                  },
                  {
                    id: 'TAKEN' as const,
                    testId: 'smc-batch-filter-taken',
                    label: tr('Diambil', 'Taken'),
                    count: takenSideCount,
                  },
                  {
                    id: 'PREVIOUS' as const,
                    testId: 'smc-batch-filter-previous',
                    label: 'Previous',
                    count: previousSideCount,
                  },
                ].map((tab) => {
                  const active = batchFilter === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      data-testid={tab.testId}
                      onClick={() => setBatchFilter(tab.id)}
                      className={`h-8 px-3 rounded-full text-[11px] font-semibold whitespace-nowrap shrink-0 transition-colors duration-150 cursor-pointer ${
                        active
                          ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607]'
                          : 'text-[#526071] dark:text-[#929BA9] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                      }`}
                    >
                      {tab.label}{' '}
                      <span className="font-mono-numbers tabular-nums opacity-70">{tab.count}</span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                data-testid="smc-signal-date-toggle-button"
                onClick={() => setIsDateFilterOpen((prev) => !prev)}
                className={`h-8 px-3 rounded-full border text-xs font-medium inline-flex items-center gap-1.5 transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                  isDateFilterOpen || previousDateFilter !== 'ALL'
                    ? 'bg-[#F4F4F5] dark:bg-[#161A22] border-[#0F172A]/45 dark:border-white/45 text-[#0F172A] dark:text-[#F2F4F7]'
                    : 'bg-white dark:bg-[#101318] border-[#E4E4E7] dark:border-[#20252D] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>
                  {previousDateFilter === 'ALL'
                    ? tr('Tanggal', 'Date')
                    : formatDateKeyHuman(previousDateFilter, todayDateKey)}
                </span>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-start sm:flex-row sm:flex-wrap sm:items-center sm:justify-start gap-2">
            {/* Monochrome History Range Switch */}
            <div
              role="group"
              aria-label="Filter Riwayat TP / SL"
              className="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-full py-0.5"
            >
              <button
                type="button"
                data-testid="smc-history-filter-all"
                onClick={() => {
                  setHistoryDateFilterMode('ALL');
                  setIsDateFilterOpen(false);
                }}
                className={`h-8 px-3 rounded-full text-xs font-semibold transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                  historyDateFilterMode === 'ALL'
                    ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607]'
                    : 'text-[#526071] dark:text-[#929BA9] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                }`}
              >
                {tr('Semua', 'All')}{' '}
                <span className="font-mono-numbers opacity-70">{allHistorySignalsForMode.length}</span>
              </button>

              <button
                type="button"
                data-testid="smc-history-filter-today"
                onClick={() => {
                  setHistoryDateFilterMode('TODAY');
                  setHistoryCustomDateKey(todayDateKey);
                  setIsDateFilterOpen(false);
                }}
                className={`h-8 px-3 rounded-full text-xs font-semibold transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                  historyDateFilterMode === 'TODAY'
                    ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607]'
                    : 'text-[#526071] dark:text-[#929BA9] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                }`}
              >
                {tr('Hari Ini', 'Today')}{' '}
                <span className="font-mono-numbers opacity-70">{todayHistoryCount}</span>
              </button>

              <button
                type="button"
                data-testid="smc-history-filter-custom"
                onClick={() => {
                  setHistoryDateFilterMode('CUSTOM');
                  setIsDateFilterOpen(true);
                }}
                className={`h-8 px-3 rounded-full text-xs font-semibold transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                  historyDateFilterMode === 'CUSTOM'
                    ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607]'
                    : 'text-[#526071] dark:text-[#929BA9] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                }`}
              >
                {tr('Pilih Tanggal', 'Choose Date')}
              </button>
            </div>

            <div className="flex items-center justify-start gap-1.5 flex-wrap">
              {/* Clean Monochrome Direction Filter */}
              <div
                role="group"
                aria-label="Filter Arah Riwayat BUY atau SELL"
                className="inline-flex items-center p-0.5 rounded-full bg-[#FAFAFA] dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D]"
              >
                <button
                  type="button"
                  data-testid="smc-history-dir-all"
                  onClick={() => setHistoryDirectionFilter('ALL')}
                  className={`h-7 px-2.5 rounded-full text-[11px] font-semibold transition-colors duration-150 cursor-pointer ${
                    historyDirectionFilter === 'ALL'
                      ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607]'
                      : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                  }`}
                >
                  {tr('Semua', 'All')} {dateFilteredHistorySignals.length}
                </button>
                <button
                  type="button"
                  data-testid="smc-history-dir-buy"
                  onClick={() => setHistoryDirectionFilter('BUY')}
                  className={`h-7 px-2.5 rounded-full text-[11px] font-semibold transition-colors duration-150 cursor-pointer ${
                    historyDirectionFilter === 'BUY'
                      ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607]'
                      : 'text-[#526071] dark:text-[#929BA9] hover:text-[#059669] dark:hover:text-[#00A878]'
                  }`}
                >
                  BUY {historyBuyCount}
                </button>
                <button
                  type="button"
                  data-testid="smc-history-dir-sell"
                  onClick={() => setHistoryDirectionFilter('SELL')}
                  className={`h-7 px-2.5 rounded-full text-[11px] font-semibold transition-colors duration-150 cursor-pointer ${
                    historyDirectionFilter === 'SELL'
                      ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607]'
                      : 'text-[#526071] dark:text-[#929BA9] hover:text-[#E11D48] dark:hover:text-[#E05260]'
                  }`}
                >
                  SELL {historySellCount}
                </button>
              </div>

              <button
                type="button"
                data-testid="smc-signal-date-toggle-button"
                onClick={() => setIsDateFilterOpen((prev) => !prev)}
                className={`h-8 px-3 rounded-full border text-xs font-medium inline-flex items-center gap-1.5 transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                  isDateFilterOpen || historyDateFilterMode === 'CUSTOM'
                    ? 'bg-[#F4F4F5] dark:bg-[#161A22] border-[#0F172A]/45 dark:border-white/45 text-[#0F172A] dark:text-[#F2F4F7]'
                    : 'bg-white dark:bg-[#101318] border-[#E4E4E7] dark:border-[#20252D] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>
                  {historyDateFilterMode === 'CUSTOM'
                    ? formatDateKeyHuman(historyCustomDateKey, todayDateKey)
                    : tr('Kalender', 'Calendar')}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Single Centralized On-Demand Date Drawer (Monochrome, GPU Entry) */}
        {(isDateFilterOpen ||
          (viewSection === 'HISTORY' && historyDateFilterMode === 'CUSTOM')) && (
          <div
            data-testid="smc-signal-date-bar"
            style={{ contain: 'layout style' }}
            className="rounded-xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] p-2.5 flex flex-wrap items-center justify-between gap-2 animate-in fade-in slide-in-from-top-1 duration-150"
          >
            {viewSection === 'ACTIVE' ? (
              <>
                <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
                  <button
                    type="button"
                    data-testid="smc-date-pill-all-previous"
                    onClick={() => {
                      setSelectedDateKey(todayDateKey);
                      setPreviousDateFilter('ALL');
                    }}
                    className={`h-7 px-3 rounded-full text-[11px] font-semibold transition-colors duration-150 whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                      previousDateFilter === 'ALL'
                        ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607]'
                        : 'bg-[#FAFAFA] dark:bg-[#161A22] text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] border border-[#E4E4E7] dark:border-[#20252D]'
                    }`}
                  >
                    <span>{tr('Semua Tanggal', 'All Dates')}</span>
                    <span className="font-mono-numbers opacity-75">
                      {allActiveSignalsForMode.filter((r) => (r.batchStatus || 'ON_GOING') === 'PREVIOUS').length}
                    </span>
                  </button>

                  {availableDates.map((dKey) => {
                    const isSelected = previousDateFilter === dKey;
                    const countActive = storedSignals.filter(
                      (r) =>
                        r.dateKey === dKey &&
                        r.tradingMode === tradingMode &&
                        r.status === 'ACTIVE'
                    ).length;

                    return (
                      <button
                        key={dKey}
                        type="button"
                        data-testid={`smc-date-pill-${dKey}`}
                        onClick={() => {
                          setSelectedDateKey(dKey);
                          setPreviousDateFilter(dKey);
                        }}
                        className={`h-7 px-3 rounded-full text-[11px] font-semibold transition-colors duration-150 whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                          isSelected
                            ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607]'
                            : 'bg-[#FAFAFA] dark:bg-[#161A22] text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] border border-[#E4E4E7] dark:border-[#20252D]'
                        }`}
                      >
                        <span>{formatDateKeyHuman(dKey, todayDateKey)}</span>
                        <span className="font-mono-numbers opacity-75">{countActive}</span>
                      </button>
                    );
                  })}
                </div>

                <input
                  type="date"
                  aria-label="Pilih Tanggal Sinyal"
                  value={previousDateFilter !== 'ALL' ? previousDateFilter : selectedDateKey}
                  onChange={(e) => {
                    if (e.target.value) {
                      setSelectedDateKey(e.target.value);
                      setPreviousDateFilter(e.target.value);
                    }
                  }}
                  className="h-8 px-3 w-full sm:w-auto rounded-full text-[11px] font-mono-numbers bg-[#FAFAFA] dark:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] text-[#0F172A] dark:text-[#F2F4F7] focus:outline-none shrink-0"
                />
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
                  {historyAvailableDates
                    .filter((dKey) => dKey !== todayDateKey || todayHistoryCount > 0)
                    .map((dKey) => {
                      const countHistOnDate = allHistorySignalsForMode.filter(
                        (r) => getSignalHistoryEffectiveDateKey(r) === dKey
                      ).length;
                      if (countHistOnDate === 0) return null;
                      const isSelectedCustom =
                        historyDateFilterMode === 'CUSTOM' && historyCustomDateKey === dKey;

                      return (
                        <button
                          key={`hist-pill-${dKey}`}
                          type="button"
                          data-testid={`smc-history-date-pill-${dKey}`}
                          onClick={() => {
                            setHistoryCustomDateKey(dKey);
                            setHistoryDateFilterMode('CUSTOM');
                          }}
                          className={`h-7 px-3 rounded-full text-[11px] font-semibold transition-colors duration-150 whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                            isSelectedCustom
                              ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607]'
                              : 'bg-[#FAFAFA] dark:bg-[#161A22] text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] border border-[#E4E4E7] dark:border-[#20252D]'
                          }`}
                        >
                          <span>{formatDateKeyHuman(dKey, todayDateKey)}</span>
                          <span className="font-mono-numbers opacity-75">{countHistOnDate}</span>
                        </button>
                      );
                    })}
                </div>

                <input
                  type="date"
                  data-testid="smc-history-date-picker"
                  aria-label="Pilih Tanggal Riwayat TP / SL"
                  value={historyCustomDateKey}
                  onChange={(e) => {
                    if (e.target.value) {
                      setHistoryCustomDateKey(e.target.value);
                      setHistoryDateFilterMode('CUSTOM');
                    }
                  }}
                  className="h-8 px-3 w-full sm:w-auto rounded-full text-[11px] font-mono-numbers bg-[#FAFAFA] dark:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] text-[#0F172A] dark:text-[#F2F4F7] focus:outline-none shrink-0"
                />
              </>
            )}
          </div>
        )}
      </div>

      {/* =====================================================================
          VIEW 1: DAFTAR SINYAL AKTIF (MINIMALIS EDITORIAL)
         ===================================================================== */}
      {viewSection === 'ACTIVE' && (() => {
        if (activeSideSignals.length === 0) {
          return (
            <div className="rounded-xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] p-8 text-center space-y-3">
              <p className="text-xs font-medium text-[#526071] dark:text-[#929BA9]">
                {tr(
                  `Tidak ada sinyal ${selectedSide} (${
                    batchFilter === 'ON_GOING'
                      ? 'On Going'
                      : batchFilter === 'TAKEN'
                      ? 'Diambil'
                      : batchFilter === 'PREVIOUS'
                      ? previousDateFilter === 'ALL'
                        ? 'Previous'
                        : `Previous · ${formatDateKeyHuman(previousDateFilter, todayDateKey)}`
                      : 'Aktif'
                  }).`,
                  `No ${selectedSide} signals available.`
                )}
              </p>
              <button
                type="button"
                onClick={() => void handlePullNewRealtimeSignals()}
                className="h-9 px-4 rounded-full bg-[#0F172A] dark:bg-white text-white dark:text-[#050607] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer hover:opacity-90 transition-opacity"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>{tr('Tarik Sinyal Baru', 'Pull New Signal')}</span>
              </button>
            </div>
          );
        }

        const displayOnGoingSignals =
          batchFilter === 'ALL' ? untakenOnGoingSideSignals : onGoingSideSignals;
        const displayPreviousGroups =
          batchFilter === 'ALL' ? groupedUntakenPreviousSideSignals : groupedPreviousSideSignals;
        const displayPreviousCount =
          batchFilter === 'ALL'
            ? untakenFilteredPreviousSideSignals.length
            : filteredPreviousSideSignals.length;

        return (
          <div data-testid={`smc-signal-groups-${selectedSide.toLowerCase()}`} className="space-y-7">
            {/* SECTION: POSISI DIAMBIL */}
            {(batchFilter === 'ALL' || batchFilter === 'TAKEN') && takenSideSignals.length > 0 && (
              <section data-testid="smc-taken-signals-section" className="space-y-3">
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#E4E4E7] dark:border-[#20252D]">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#0F172A] dark:text-[#F2F4F7]">
                    {tr('Posisi Diambil', 'Taken Signals')}
                  </h3>
                  <span className="text-[11px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                    {takenSideSignals.length}
                  </span>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,290px),1fr))] gap-3.5 sm:gap-4">
                  {takenSideSignals.map((group) => (
                    <MemoSignalCard
                      key={group.uid}
                      group={group}
                      todayDateKey={todayDateKey}
                      tr={tr}
                      onToggleTake={handleToggleTakeSignal}
                      onToggleBatch={handleToggleBatchStatus}
                      onDelete={handleDeleteSignal}
                      onRequestOutcome={handleRequestOutcomeConfirm}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* SECTION: ON GOING */}
            {(batchFilter === 'ALL' || batchFilter === 'ON_GOING') && displayOnGoingSignals.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#E4E4E7] dark:border-[#20252D]">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#0F172A] dark:text-[#F2F4F7]">
                    On Going
                  </h3>
                  <span className="text-[11px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                    {displayOnGoingSignals.length}
                  </span>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,290px),1fr))] gap-3.5 sm:gap-4">
                  {displayOnGoingSignals.map((group) => (
                    <MemoSignalCard
                      key={group.uid}
                      group={group}
                      todayDateKey={todayDateKey}
                      tr={tr}
                      onToggleTake={handleToggleTakeSignal}
                      onToggleBatch={handleToggleBatchStatus}
                      onDelete={handleDeleteSignal}
                      onRequestOutcome={handleRequestOutcomeConfirm}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* SECTION: PREVIOUS */}
            {(batchFilter === 'ALL' || batchFilter === 'PREVIOUS') &&
              displayPreviousGroups.length > 0 && (
                <section data-testid="smc-previous-data-grouped" className="space-y-4">
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#E4E4E7] dark:border-[#20252D]">
                    <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#526071] dark:text-[#929BA9]">
                      Previous
                    </h3>
                    <span className="text-[11px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                      {displayPreviousCount}
                    </span>
                  </div>

                  <div className="space-y-5">
                    {displayPreviousGroups.map(([dateKey, recordsOnDate]) => (
                      <div key={`prev-group-${dateKey}`} className="space-y-2.5">
                        <div className="flex items-center justify-between text-[11px] text-[#526071] dark:text-[#929BA9]">
                          <span className="font-medium">
                            {formatDateKeyHuman(dateKey, todayDateKey)}
                          </span>
                          <span className="font-mono-numbers tabular-nums opacity-75">
                            {recordsOnDate.length} {tr('sinyal', 'signals')}
                          </span>
                        </div>

                        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,290px),1fr))] gap-3.5 sm:gap-4">
                          {recordsOnDate.map((group) => (
                            <MemoSignalCard
                              key={group.uid}
                              group={group}
                              todayDateKey={todayDateKey}
                              tr={tr}
                              onToggleTake={handleToggleTakeSignal}
                              onToggleBatch={handleToggleBatchStatus}
                              onDelete={handleDeleteSignal}
                              onRequestOutcome={handleRequestOutcomeConfirm}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
          </div>
        );
      })()}

      {/* =====================================================================
          VIEW 2: RIWAYAT TP / SL
         ===================================================================== */}
      {viewSection === 'HISTORY' && (() => {
        const historyBannerLabel =
          historyDateFilterMode === 'ALL'
            ? tr('Semua Tanggal', 'All Dates')
            : historyDateFilterMode === 'TODAY'
            ? formatDateKeyHuman(todayDateKey, todayDateKey)
            : formatDateKeyHuman(historyCustomDateKey, todayDateKey);

        return (
          <div className="space-y-5">
            {/* Compact Editorial Summary Strip */}
            <div
              data-testid="smc-history-summary-bar"
              className="rounded-xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] px-4 py-3 flex flex-wrap items-center justify-between gap-2.5 text-xs font-mono-numbers tabular-nums"
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <span className="font-sans font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                  {historyBannerLabel}{' '}
                  <span className="text-[#526071] dark:text-[#929BA9] font-normal">
                    · {historySummary.totalClosed} {tr('sinyal', 'signals')}
                  </span>
                </span>
                <span className="font-semibold text-[#059669] dark:text-[#00A878]">
                  TP {historySummary.tpCount}
                </span>
                <span className="font-semibold text-[#E11D48] dark:text-[#E05260]">
                  SL {historySummary.slCount}
                </span>
                <span className="font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                  WR {historySummary.winRate}%
                </span>
              </div>
              <div
                className={`font-bold text-sm ${
                  historySummary.netPips >= 0
                    ? 'text-[#059669] dark:text-[#00A878]'
                    : 'text-[#E11D48] dark:text-[#E05260]'
                }`}
              >
                {historySummary.netPips >= 0
                  ? `+${historySummary.netPips}`
                  : historySummary.netPips}{' '}
                pips
              </div>
            </div>

            {filteredHistorySignals.length === 0 ? (
              <div className="rounded-xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] p-8 text-center text-xs font-medium text-[#526071] dark:text-[#929BA9]">
                {historyDateFilterMode === 'ALL'
                  ? tr(
                      'Belum ada sinyal yang dicatat Hit TP atau Hit SL.',
                      'No signals marked Hit TP or Hit SL yet.'
                    )
                  : historyDateFilterMode === 'TODAY'
                  ? tr(
                      'Belum ada sinyal yang dicatat Hit TP atau Hit SL hari ini.',
                      'No signals marked Hit TP or Hit SL today yet.'
                    )
                  : tr(
                      'Belum ada sinyal yang dicatat Hit TP atau Hit SL pada tanggal terpilih.',
                      'No signals marked Hit TP or Hit SL on the selected date.'
                    )}
              </div>
            ) : historyDateFilterMode === 'ALL' ? (
              <div className="space-y-5">
                {groupedHistorySignals.map(([dateKey, recordsOnDate]) => (
                  <div key={`hist-group-${dateKey}`} className="space-y-2.5">
                    <div className="flex items-center justify-between text-[11px] text-[#526071] dark:text-[#929BA9]">
                      <span className="font-medium">
                        {formatDateKeyHuman(dateKey, todayDateKey)}
                      </span>
                      <span className="font-mono-numbers tabular-nums opacity-75">
                        {recordsOnDate.length} {tr('sinyal', 'signals')}
                      </span>
                    </div>

                    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,290px),1fr))] gap-3.5 sm:gap-4">
                      {recordsOnDate.map((item) => (
                        <MemoHistorySignalCard
                          key={item.uid}
                          item={item}
                          todayDateKey={todayDateKey}
                          tr={tr}
                          onRestore={handleRestoreToActive}
                          onDelete={handleDeleteSignal}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,290px),1fr))] gap-3.5 sm:gap-4">
                {filteredHistorySignals.map((item) => (
                  <MemoHistorySignalCard
                    key={item.uid}
                    item={item}
                    todayDateKey={todayDateKey}
                    tr={tr}
                    onRestore={handleRestoreToActive}
                    onDelete={handleDeleteSignal}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {confirmModalNode && typeof document !== 'undefined'
        ? createPortal(confirmModalNode, document.body)
        : confirmModalNode}
    </div>
  );
};
