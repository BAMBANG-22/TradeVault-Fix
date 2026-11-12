/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Menu, X, Bell, User } from 'lucide-react';
import { AppSettings } from '../../types/settings';
import { BrandLogo } from './BrandLogo';
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
}

/**
 * Persistent App Header
 *
 * - Left: Hamburger menu button, official TradeVault symbol, and TRADEVAULT brand wordmark.
 * - Right: Circular notification icon button & circular profile icon button.
 * - Always persistent at top of viewport: remains static at top while content scrolls underneath.
 * - Respects Android / iOS safe area top.
 */
export const Navbar: React.FC<NavbarProps> = ({
  onNavigate,
  onOpenMobileMenu,
  isMobileMenuOpen,
  currentUser,
  onOpenAuth,
  onOpenAccount,
}) => {
  const { tr } = useLanguage();

  return (
    <header
      data-testid="app-header"
      className="sticky top-0 z-30 w-full isolate h-[calc(3.5rem+env(safe-area-inset-top,0px))] pt-[env(safe-area-inset-top,0px)] border-b border-[#DDE3EA] dark:border-[#20252D] bg-white dark:bg-[#050607] backdrop-blur-md transition-colors duration-150 before:content-[''] before:absolute before:bottom-full before:left-0 before:right-0 before:h-20 before:bg-white dark:before:bg-[#050607] before:pointer-events-none"
    >
      <div className="w-full h-14 flex items-center justify-between px-4 sm:px-6">
        {/* Left: Hamburger Menu Button & Official TradeVault Brand Lockup */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenMobileMenu}
            data-testid="header-hamburger-button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#151D2A] dark:text-[#F2F4F7] hover:bg-[#F5F7FA] dark:hover:bg-[#101318] transition-colors cursor-pointer"
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
          </button>

          {/* Official TradeVault Logo Symbol + Persistent Brand Wordmark */}
          <button
            type="button"
            onClick={() => onNavigate('dashboard')}
            className="group flex items-center gap-2 focus:outline-none cursor-pointer"
            aria-label={tr('TradeVault — Kembali ke Dasbor', 'TradeVault — Back to Dashboard')}
          >
            <span className="inline-flex items-center justify-center">
              <BrandLogo
                variant="symbol"
                className="h-7 w-7"
                title={tr('Simbol TradeVault', 'TradeVault Symbol')}
              />
            </span>
            <span
              data-testid="header-brand-wordmark"
              className="inline-flex items-center"
            >
              <span className="text-sm sm:text-base font-extrabold tracking-[0.06em] uppercase select-none whitespace-nowrap">
                <span className="text-[#172033] dark:text-[#F8FAFC]">TRADE</span>
                <span className="text-[#1458C4] dark:text-[#38BDF8]">VAULT</span>
              </span>
            </span>
          </button>
        </div>

        {/* Right: Circular notification button & circular profile button */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            data-testid="header-notification-button"
            className="inline-flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7] hover:bg-[#F5F7FA] dark:hover:bg-[#101318] transition-colors cursor-pointer"
            aria-label={tr('Notifikasi', 'Notifications')}
            title={tr('Notifikasi', 'Notifications')}
          >
            <Bell className="h-4 w-4 stroke-[1.75]" />
          </button>

          <button
            type="button"
            onClick={currentUser ? onOpenAccount : onOpenAuth}
            data-testid="header-account-button"
            className="inline-flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7] hover:border-[#3478DC]/50 transition-colors cursor-pointer"
            aria-label={currentUser ? tr('Akun Pengguna', 'User Account') : tr('Masuk ke Akun', 'Sign In to Account')}
            title={currentUser ? (currentUser.email || tr('Akun Pengguna', 'User Account')) : tr('Masuk ke Akun', 'Sign In to Account')}
          >
            <User className="h-4 w-4 stroke-[1.75]" />
          </button>
        </div>
      </div>
    </header>
  );
};

