/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useRef, useState } from 'react';
import { Menu, X, Bell, User } from 'lucide-react';
import { AppSettings } from '../../types/settings';
import { BrandLogo } from './BrandLogo';
import { NotificationCenter } from './NotificationCenter';
import { AppNotificationItem } from '../../utils/appNotifications';
import { getUserAvatarUrl } from '../../utils/supabaseClient';
import { useLanguage } from '../../utils/language';

interface NavbarProps {
  currentEquity: number;
  settings: AppSettings;
  activeTab: string;
  onNavigate: (tab: string) => void;
  onOpenMobileMenu: () => void;
  isMobileMenuOpen: boolean;
  onOpenLocalInfo: () => void;
  onOpenBackupModal: () => void;
  currentUser?: any;
  onOpenAuth: () => void;
  onOpenAccount: () => void;
  notifications: AppNotificationItem[];
  onMarkAllNotificationsRead: () => void;
  onClearNotifications: () => void;
  onSelectNotification: (item: AppNotificationItem) => void;
}

/**
 * Persistent App Header
 *
 * - Left: Hamburger menu button, official TradeVault symbol, and TRADEVAULT brand wordmark.
 * - Right: Circular notification center toggle button and circular profile icon button.
 * - Always persistent at top of viewport: remains static at top while content scrolls underneath.
 * - Respects Android / iOS safe area top.
 */
export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onNavigate,
  onOpenMobileMenu,
  isMobileMenuOpen,
  currentUser,
  onOpenAuth,
  onOpenAccount,
  notifications,
  onMarkAllNotificationsRead,
  onClearNotifications,
  onSelectNotification,
}) => {
  const { tr } = useLanguage();
  const [isNotifOpen, setIsNotifOpen] = useState<boolean>(false);
  const bellButtonRef = useRef<HTMLButtonElement | null>(null);

  const unreadCount = useMemo(
    () => notifications.reduce((acc, item) => acc + (item.read ? 0 : 1), 0),
    [notifications]
  );

  const desktopSectionLabels: Record<string, string> = {
    dashboard: tr('Dasbor', 'Dashboard'),
    trades: tr('Jurnal Trade', 'Trade Log'),
    detail: tr('Detail Transaksi', 'Trade Detail'),
    analytics: tr('Analitik', 'Analytics'),
    risk: tr('Manajemen Risiko', 'Risk Management'),
    'ai-desk': tr('Tanya AI', 'AI Desk'),
    'market-chart': tr('Chart Pasar', 'Market Chart'),
    'macro-news': tr('Berita Trading', 'Trade News'),
    'fundamental-gold': tr('Fundamental Emas', 'Fundamental Gold'),
    'cycle-confluence': tr('Siklus & Confluence', 'Cycle & Confluence'),
    'smc-signal': tr('Sinyal SMC', 'SMC Signal'),
    settings: tr('Pengaturan', 'Settings'),
  };
  const desktopSectionTitle = desktopSectionLabels[activeTab] || 'VLO';
  const isSecondaryMenuTab =
    activeTab === 'ai-desk' ||
    activeTab === 'market-chart' ||
    activeTab === 'macro-news' ||
    activeTab === 'fundamental-gold' ||
    activeTab === 'cycle-confluence' ||
    activeTab === 'smc-signal' ||
    activeTab === 'settings';

  return (
    <header
      data-testid="app-header"
      className="sticky top-0 z-30 w-full isolate h-[calc(3.5rem+env(safe-area-inset-top,0px))] pt-[env(safe-area-inset-top,0px)] border-b border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#050607] before:content-[''] before:absolute before:bottom-full before:left-0 before:right-0 before:h-20 before:bg-white dark:before:bg-[#050607] before:pointer-events-none"
    >
      <div className="w-full h-14 flex items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Left: Mobile/Tablet Hamburger & Brand Lockup; Desktop Contextual Section Title */}
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <button
            type="button"
            onClick={onOpenMobileMenu}
            data-testid="header-hamburger-button"
            className="relative inline-flex lg:hidden h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#0F172A] dark:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#101318] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 transition-colors cursor-pointer"
            aria-label={
              isMobileMenuOpen
                ? tr('Tutup Menu Navigasi', 'Close Navigation Menu')
                : tr('Buka Menu Navigasi', 'Open Navigation Menu')
            }
            aria-expanded={isMobileMenuOpen}
          >
            {isMobileMenuOpen ? (
              <X className="h-5 w-5 stroke-[1.75]" />
            ) : (
              <Menu className="h-5 w-5 stroke-[1.75]" />
            )}
            {isSecondaryMenuTab && !isMobileMenuOpen && (
              <span
                aria-hidden="true"
                className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[#0F172A] dark:bg-white ring-2 ring-white dark:ring-[#050607]"
              />
            )}
          </button>

          {/* Official VLO Logo Symbol + Persistent Brand Wordmark (Mobile & Tablet) */}
          <button
            type="button"
            data-tactile="none"
            onClick={() => onNavigate('dashboard')}
            className="group flex lg:hidden items-center gap-2.5 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 rounded-xl cursor-pointer"
            aria-label={tr('VLO — Kembali ke Dasbor', 'VLO — Back to Dashboard')}
          >
            <BrandLogo
              variant="symbol"
              withTile
              className="h-9 w-9"
              title={tr('Simbol VLO', 'VLO Symbol')}
            />
            <span
              data-testid="header-brand-wordmark"
              className="inline-flex items-center"
            >
              <BrandLogo
                variant="wordmark"
                className="h-[19px] sm:h-[21px] w-auto"
                title="VLO"
              />
            </span>
          </button>

          {/* Mobile & Tablet Active Section Breadcrumb Badge */}
          <div className="flex lg:hidden items-center gap-2 min-w-0">
            <span
              aria-hidden="true"
              className="h-3.5 w-[1px] bg-[#E4E4E7] dark:bg-[#20252D] shrink-0"
            />
            <span
              data-testid="mobile-active-section-label"
              className={`text-[11px] font-bold uppercase tracking-[0.08em] truncate select-none ${
                isSecondaryMenuTab
                  ? 'text-[#0F172A] dark:text-white'
                  : 'text-[#526071] dark:text-[#929BA9]'
              }`}
            >
              {desktopSectionTitle}
            </span>
          </div>

          {/* Desktop Contextual Section Title (Sidebar already displays brand & nav) */}
          <div className="hidden lg:flex items-center min-w-0">
            <span className="text-xs font-bold uppercase tracking-[0.12em] text-[#526071] dark:text-[#929BA9] truncate select-none">
              {desktopSectionTitle}
            </span>
          </div>
        </div>

        {/* Right: Notification center button & profile button */}
        <div className="relative flex items-center gap-1.5 sm:gap-2">
          <button
            ref={bellButtonRef}
            type="button"
            onClick={() => setIsNotifOpen((prev) => !prev)}
            data-testid="header-notification-button"
            aria-haspopup="dialog"
            aria-expanded={isNotifOpen}
            className={`relative inline-flex h-9 w-9 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 transition-colors cursor-pointer ${
              isNotifOpen
                ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#0F172A]'
                : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#101318]'
            }`}
            aria-label={tr('Notifikasi Terbaru', 'Recent Notifications')}
            title={tr('Notifikasi Terbaru', 'Recent Notifications')}
          >
            <Bell className="h-4 w-4 stroke-[1.75]" />
            {unreadCount > 0 && (
              <span
                aria-hidden="true"
                className={`absolute top-1.5 right-1.5 h-2 w-2 rounded-full ring-2 ${
                  isNotifOpen
                    ? 'bg-white dark:bg-[#0F172A] ring-[#0F172A] dark:ring-white'
                    : 'bg-[#0F172A] dark:bg-white ring-white dark:ring-[#050607]'
                }`}
              />
            )}
          </button>

          <NotificationCenter
            isOpen={isNotifOpen}
            onClose={() => setIsNotifOpen(false)}
            notifications={notifications}
            onMarkAllRead={onMarkAllNotificationsRead}
            onClearAll={onClearNotifications}
            onSelectNotification={(item) => {
              onSelectNotification(item);
              setIsNotifOpen(false);
            }}
            anchorRef={bellButtonRef}
          />

          <button
            type="button"
            onClick={currentUser ? onOpenAccount : onOpenAuth}
            data-testid="header-account-button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#FAFAFA] dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:border-[#0F172A]/40 dark:hover:border-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 transition-colors cursor-pointer overflow-hidden"
            aria-label={currentUser ? tr('Akun Pengguna', 'User Account') : tr('Masuk ke Akun', 'Sign In to Account')}
            title={
              currentUser
                ? currentUser.user_metadata?.full_name ||
                  currentUser.user_metadata?.name ||
                  currentUser.email ||
                  tr('Akun Pengguna', 'User Account')
                : tr('Masuk ke Akun', 'Sign In to Account')
            }
          >
            {currentUser && getUserAvatarUrl(currentUser) ? (
              <img
                src={getUserAvatarUrl(currentUser)}
                alt={currentUser.user_metadata?.full_name || currentUser.email || 'User'}
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <User className="h-4 w-4 stroke-[1.75]" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
};

