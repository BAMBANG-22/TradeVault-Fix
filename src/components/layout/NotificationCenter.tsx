/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  CheckCheck,
  Trash2,
  ArrowUpRight,
  ArrowDownRight,
  Newspaper,
  Activity,
  X,
} from 'lucide-react';
import {
  AppNotificationItem,
  formatRelativeNotificationTime,
} from '../../utils/appNotifications';
import { useLanguage } from '../../utils/language';

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: AppNotificationItem[];
  onMarkAllRead: () => void;
  onClearAll: () => void;
  onSelectNotification: (item: AppNotificationItem) => void;
  anchorRef?: React.RefObject<HTMLButtonElement | null>;
}

const EXIT_DURATION_MS = 160;

/**
 * VLO Institutional Notification Center
 *
 * Design & Performance:
 * - Strictly aligned with VLO Carbon + Paper tokens (#FFFFFF/#101318, #DDE3EA/#20252D, #151D2A/#F2F4F7).
 * - Two-phase mount + rAF reveal for 60fps GPU-composited open & close (transform + opacity only).
 * - Zero backdrop-filter blur over live charts/WebViews to eliminate mobile GPU frame drops.
 */
export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  isOpen,
  onClose,
  notifications,
  onMarkAllRead,
  onClearAll,
  onSelectNotification,
  anchorRef,
}) => {
  const { isEn, tr } = useLanguage();
  const [shouldRender, setShouldRender] = useState<boolean>(isOpen);
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const [filter, setFilter] = useState<'all' | 'trade' | 'news'>('all');
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let rafId1 = 0;
    let rafId2 = 0;
    let exitTimer: number | undefined;

    if (isOpen) {
      setShouldRender(true);
      const reducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

      if (reducedMotion) {
        setIsVisible(true);
      } else {
        rafId1 = window.requestAnimationFrame(() => {
          rafId2 = window.requestAnimationFrame(() => {
            setIsVisible(true);
          });
        });
      }
    } else {
      setIsVisible(false);
      exitTimer = window.setTimeout(() => {
        setShouldRender(false);
      }, EXIT_DURATION_MS);
    }

    return () => {
      if (rafId1) window.cancelAnimationFrame(rafId1);
      if (rafId2) window.cancelAnimationFrame(rafId2);
      if (exitTimer !== undefined) window.clearTimeout(exitTimer);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!shouldRender) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef?.current?.contains(target)) return;
      onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [shouldRender, onClose, anchorRef]);

  const unreadCount = useMemo(
    () => notifications.reduce((acc, item) => acc + (item.read ? 0 : 1), 0),
    [notifications]
  );

  const filteredNotifications = useMemo(() => {
    if (filter === 'all') return notifications;
    return notifications.filter((item) => item.category === filter);
  }, [notifications, filter]);

  if (!shouldRender) return null;

  return (
    <>
      {/* Lightweight mobile scrim (solid alpha only — no heavy blur) */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`sm:hidden fixed inset-0 z-40 bg-black/35 dark:bg-black/60 transition-opacity duration-150 ease-out will-change-[opacity] ${
          isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Responsive GPU-Composited Panel matching VLO Carbon + Paper tokens */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label={tr('Notifikasi Terbaru', 'Recent Notifications')}
        data-testid="notification-center-panel"
        style={{
          contain: 'layout style paint',
        }}
        className={`vlo-notif-panel z-50 fixed inset-x-3 top-[calc(3.75rem+env(safe-area-inset-top,0px))] sm:inset-x-auto sm:absolute sm:right-0 sm:top-[calc(100%+0.5rem)] sm:w-[396px] max-h-[min(74vh,480px)] sm:max-h-[min(72vh,520px)] flex flex-col rounded-xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] shadow-[0_16px_40px_-12px_rgba(15,23,42,0.14),0_2px_8px_rgba(15,23,42,0.04)] dark:shadow-[0_24px_48px_-12px_rgba(0,0,0,0.75),inset_0_1px_0_rgba(255,255,255,0.04)] overflow-hidden ${
          isVisible ? 'vlo-notif-panel-open' : 'vlo-notif-panel-closed'
        }`}
      >
        {/* Top Bar */}
        <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2.5 shrink-0">
          <div className="flex items-baseline gap-2 min-w-0">
            <h2 className="text-[13px] font-bold tracking-tight text-[#0F172A] dark:text-[#F2F4F7] truncate">
              {tr('Notifikasi', 'Notifications')}
            </h2>
            {unreadCount > 0 && (
              <span className="text-[11px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9] shrink-0">
                · {unreadCount} {tr('baru', 'unread')}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="inline-flex items-center gap-1.5 min-h-[30px] px-2.5 py-1 rounded-full text-[11px] font-semibold text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 transition-colors cursor-pointer whitespace-nowrap"
                title={tr('Tandai semua sudah dibaca', 'Mark all as read')}
              >
                <CheckCheck className="h-3.5 w-3.5 stroke-[1.75]" />
                <span>{tr('Tandai dibaca', 'Mark read')}</span>
              </button>
            )}
            {notifications.length > 0 && (
              <button
                type="button"
                onClick={onClearAll}
                className="inline-flex items-center justify-center h-8 w-8 rounded-full text-[#526071] dark:text-[#929BA9] hover:text-[#E11D48] dark:hover:text-[#E05260] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 transition-colors cursor-pointer"
                aria-label={tr('Bersihkan semua notifikasi', 'Clear all notifications')}
                title={tr('Bersihkan semua notifikasi', 'Clear all notifications')}
              >
                <Trash2 className="h-3.5 w-3.5 stroke-[1.75]" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="sm:hidden inline-flex items-center justify-center h-8 w-8 rounded-full text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 transition-colors cursor-pointer"
              aria-label={tr('Tutup panel notifikasi', 'Close notifications')}
            >
              <X className="h-4 w-4 stroke-[1.75]" />
            </button>
          </div>
        </div>

        {/* Minimal Editorial Underline Filter Tabs */}
        <div className="flex items-center gap-5 px-4 border-b border-[#E4E4E7] dark:border-[#20252D] shrink-0">
          {(
            [
              { id: 'all', label: tr('Semua', 'All') },
              { id: 'trade', label: tr('Trade', 'Trades') },
              { id: 'news', label: tr('Berita Trading', 'Trade News') },
            ] as const
          ).map((tab) => {
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`relative py-2 text-[11px] font-semibold tracking-wide transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'text-[#0F172A] dark:text-[#F2F4F7]'
                    : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                }`}
              >
                {tab.label}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-px h-[2px] bg-[#0F172A] dark:bg-white"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Feed Body */}
        <div className="flex-1 overflow-y-auto overscroll-contain divide-y divide-[#E4E4E7]/70 dark:divide-[#1A1F27]">
          {filteredNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center px-6 py-11">
              <div className="h-9 w-9 rounded-lg bg-[#FAFAFA] dark:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-center text-[#526071] dark:text-[#929BA9] mb-3">
                <Bell className="h-4 w-4 stroke-[1.75]" />
              </div>
              <p className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                {tr('Belum ada notifikasi', 'No notifications yet')}
              </p>
              <p className="text-[11px] text-[#526071] dark:text-[#929BA9] mt-1 max-w-[28ch] leading-relaxed">
                {tr(
                  'Catatan trade, pembaruan SL/TP, dan ringkasan Trade News terbaru akan tampil di sini.',
                  'Logged trades, SL/TP updates, and concise Trade News summaries will appear here.'
                )}
              </p>
            </div>
          ) : (
            filteredNotifications.map((item) => {
              const Icon =
                item.category === 'news'
                  ? Newspaper
                  : item.tone === 'positive'
                  ? ArrowUpRight
                  : item.tone === 'negative'
                  ? ArrowDownRight
                  : Activity;

              const iconStrokeClass =
                item.tone === 'positive'
                  ? 'text-[#059669] dark:text-[#00A878]'
                  : item.tone === 'negative'
                  ? 'text-[#E11D48] dark:text-[#E05260]'
                  : item.tone === 'warning'
                  ? 'text-[#D97706] dark:text-[#F59E0B]'
                  : item.category === 'news'
                  ? 'text-[#0F172A] dark:text-[#F2F4F7]'
                  : 'text-[#526071] dark:text-[#929BA9]';

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectNotification(item)}
                  className={`group w-full flex items-start gap-3 px-4 py-3 text-left transition-colors duration-150 cursor-pointer min-h-[58px] ${
                    item.read
                      ? 'bg-transparent hover:bg-[#F4F4F5] dark:hover:bg-[#161A22]'
                      : 'bg-[#FAFAFA] dark:bg-[#14181F] hover:bg-[#F4F4F5] dark:hover:bg-[#191E28]'
                  }`}
                >
                  {/* VLO Monochrome Carbon/Paper Icon Well */}
                  <div
                    className={`mt-0.5 h-8 w-8 rounded-lg bg-[#FAFAFA] dark:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-center shrink-0 ${iconStrokeClass}`}
                  >
                    <Icon className="h-4 w-4 stroke-[1.75]" />
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Metadata & Relative Timestamp */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#526071] dark:text-[#929BA9] truncate">
                        {item.meta}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                          {formatRelativeNotificationTime(item.createdAt, isEn)}
                        </span>
                        {!item.read && (
                          <span
                            aria-hidden="true"
                            className="h-1.5 w-1.5 rounded-full bg-[#0F172A] dark:bg-white"
                          />
                        )}
                      </div>
                    </div>

                    {/* Title */}
                    <p
                      className={`text-[12.5px] leading-snug mt-0.5 truncate ${
                        item.read
                          ? 'font-medium text-[#0F172A] dark:text-[#F2F4F7]'
                          : 'font-bold text-[#0F172A] dark:text-[#F2F4F7]'
                      }`}
                    >
                      {item.title}
                    </p>

                    {/* Tabular Short Summary */}
                    <p className="text-[11px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9] leading-snug mt-0.5 line-clamp-2">
                      {item.summary}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </>
  );
};
