/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import {
  LayoutDashboard,
  BookOpen,
  BarChart3,
  ShieldAlert,
  CandlestickChart,
  Newspaper,
  Globe,
  Compass,
  Target,
  X,
  Plus,
  User,
  ChevronRight,
  Moon,
  Sun,
  Settings,
  Layers,
  MessageSquareText,
} from 'lucide-react';
import { AppSettings } from '../../types/settings';
import { useTheme } from '../../utils/theme';
import { useLanguage } from '../../utils/language';
import { getUserAvatarUrl } from '../../utils/supabaseClient';
import { resolveConfiguredAccounts } from '../../utils/journalExtras';
import { APP_VERSION } from '../../config/appVersion';
import { BrandLogo } from './BrandLogo';
import { PWAInstallButton } from './PWAInstallButton';

interface MobileNavProps {
  activeTab: string;
  onNavigate: (tab: string) => void;
  isOpen: boolean;
  onClose: () => void;
  tradesCount: number;
  currentEquity: number;
  settings: AppSettings;
  onOpenLocalInfo: () => void;
  onOpenBackupModal: () => void;
  currentUser?: any;
  onOpenAuth: () => void;
  onOpenAccount: () => void;
  onAddTrade?: () => void;
  onOpenAccountSwitcher?: () => void;
}

export const MobileNav: React.FC<MobileNavProps> = ({
  activeTab,
  onNavigate,
  isOpen,
  onClose,
  settings,
  currentUser,
  onOpenAuth,
  onOpenAccount,
  onAddTrade,
  onOpenAccountSwitcher,
}) => {
  const { isDark, toggleTheme } = useTheme();
  const { isEn, tr } = useLanguage();

  const accounts = resolveConfiguredAccounts(settings);
  const activeAccountId = settings.activeAccountId || 'ALL';
  const activeAccountLabel =
    activeAccountId === 'ALL'
      ? tr('Semua Akun', 'All Accounts')
      : accounts.find((a) => a.id === activeAccountId)?.name || tr('Akun Utama', 'Primary Account');

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const bottomTabs = [
    { id: 'dashboard', label: tr('Dasbor', 'Dashboard'), icon: LayoutDashboard },
    { id: 'trades', label: tr('Jurnal Trade', 'Trade Log'), icon: BookOpen },
    { id: 'analytics', label: tr('Analitik', 'Analytics'), icon: BarChart3 },
    { id: 'risk', label: tr('Risiko', 'Risk'), icon: ShieldAlert },
  ];

  const mainMenuItems = [
    { id: 'dashboard', label: tr('Dasbor', 'Dashboard'), icon: LayoutDashboard },
    { id: 'trades', label: tr('Jurnal Trade', 'Trade Log'), icon: BookOpen },
    { id: 'analytics', label: tr('Analitik', 'Analytics'), icon: BarChart3 },
    { id: 'risk', label: tr('Manajemen Risiko', 'Risk Management'), icon: ShieldAlert },
  ];

  const insightMenuItems = [
    { id: 'ai-desk', label: tr('Tanya AI', 'AI Desk'), icon: MessageSquareText },
    { id: 'market-chart', label: tr('Chart Pasar', 'Market Chart'), icon: CandlestickChart },
    { id: 'macro-news', label: tr('Berita Trading', 'Trade News'), icon: Newspaper },
    { id: 'fundamental-gold', label: tr('Fundamental Emas', 'Fundamental Gold'), icon: Globe },
    { id: 'cycle-confluence', label: tr('Siklus & Confluence', 'Cycle & Confluence'), icon: Compass },
    { id: 'smc-signal', label: tr('Sinyal SMC', 'SMC Signal'), icon: Target },
  ];

  return (
    <>
      {/* Mobile Bottom Thumb Navigation Bar (5 Positions: Dashboard, Trade Log, [+], Analytics, Risk) */}
      <nav
        aria-label={tr('Navigasi Utama Bawah', 'Bottom Primary Navigation')}
        className="fixed bottom-0 left-0 right-0 z-40 lg:hidden border-t border-[#E4E4E7] dark:border-[#20252D] bg-white/[0.98] dark:bg-[#0B0D11]/[0.98] px-2 pt-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom,0px))]"
      >
        <div className="grid grid-cols-5 items-center">
          {bottomTabs.slice(0, 2).map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id || (tab.id === 'trades' && activeTab === 'detail');

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onNavigate(tab.id)}
                className={`flex flex-col items-center justify-center min-h-[44px] py-1 px-1 text-[10px] rounded-xl transition-colors cursor-pointer ${
                  isActive
                    ? 'text-[#151D2A] dark:text-[#F2F4F7] bg-black/[0.04] dark:bg-white/[0.06] font-bold'
                    : 'text-[#697586] dark:text-[#8E98A8] hover:text-[#151D2A] dark:hover:text-[#F2F4F7] font-medium'
                }`}
              >
                <Icon className={`h-4 w-4 mb-0.5 ${isActive ? 'stroke-[2.2]' : 'stroke-[1.75]'}`} />
                <span className="leading-tight truncate">{tab.label}</span>
              </button>
            );
          })}

          {/* Position 3 (Center): Monochrome Add Transaction Shortcut Button (Icon Only, No Text Label) */}
          <div className="flex items-center justify-center">
            <button
              type="button"
              data-tactile="none"
              onClick={() => {
                if (onAddTrade) {
                  onAddTrade();
                } else {
                  onNavigate('add-trade');
                }
              }}
              aria-label={tr('Tambah Transaksi', 'Add Trade')}
              title={tr('Tambah Transaksi', 'Add Trade')}
              data-testid="global-bottom-add-trade-button"
              className="flex items-center justify-center min-h-[44px] min-w-[48px] px-1 group cursor-pointer focus:outline-none"
            >
              <div className="flex items-center justify-center h-9 w-9 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] border border-black/10 dark:border-white/15 active:scale-95 shadow-xs transition-all duration-150">
                <Plus className="h-4 w-4 stroke-[2.25]" />
              </div>
            </button>
          </div>

          {bottomTabs.slice(2).map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onNavigate(tab.id)}
                className={`flex flex-col items-center justify-center min-h-[44px] py-1 px-1 text-[10px] rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 transition-colors cursor-pointer ${
                  isActive
                    ? 'text-[#0F172A] dark:text-[#F2F4F7] bg-[#F4F4F5] dark:bg-white/[0.06] font-bold'
                    : 'text-[#526071] dark:text-[#8E98A8] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] font-medium'
                }`}
              >
                <Icon className={`h-4 w-4 mb-0.5 ${isActive ? 'stroke-[2.2]' : 'stroke-[1.75]'}`} />
                <span className="leading-tight truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Slide-out Hamburger Drawer Overlay — Smooth Enter (Left-to-Right) & Exit (Right-to-Left) */}
      <div
        data-testid="mobile-drawer-overlay"
        aria-hidden={!isOpen}
        className={`fixed inset-0 z-50 lg:hidden transition-opacity duration-250 ease-out ${
          isOpen
            ? 'opacity-100 pointer-events-auto visible'
            : 'opacity-0 pointer-events-none invisible delay-250'
        }`}
      >
        {/* Lightweight Scrim (alpha only, no backdrop-blur over live charts) */}
        <div
          className={`fixed inset-0 bg-black/50 dark:bg-black/75 transition-opacity duration-250 ease-out ${
            isOpen ? 'opacity-100' : 'opacity-0'
          }`}
          onClick={onClose}
        />

        {/* Drawer Panel */}
        <div
          role="dialog"
          aria-modal={isOpen}
          aria-label={tr('Menu Navigasi Utama', 'Main Navigation Menu')}
          data-testid="mobile-drawer-panel"
          className={`fixed inset-y-0 left-0 z-10 w-72 max-w-[85vw] bg-white dark:bg-[#0E1218] border-r border-[#E4E4E7] dark:border-[#20252D] px-4 pt-[calc(0.875rem+env(safe-area-inset-top,0px))] pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] overflow-y-auto flex flex-col justify-between shadow-2xl transform transition-transform duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            isOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="space-y-4">
            {/* 1. Logo VLO */}
            <div
              data-testid="mobile-menu-logo-section"
              className="flex items-center justify-between pb-3.5 border-b border-[#E4E4E7] dark:border-[#20252D]"
            >
              <button
                type="button"
                data-tactile="none"
                onClick={() => {
                  onNavigate('dashboard');
                  onClose();
                }}
                className="group flex items-center gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 rounded-xl py-0.5 cursor-pointer"
                aria-label={tr('VLO — Kembali ke Dasbor', 'VLO — Back to Dashboard')}
              >
                <BrandLogo variant="symbol" withTile className="h-9 w-9 shrink-0" title="VLO" />
                <div className="flex flex-col justify-center min-w-0">
                  <BrandLogo variant="wordmark" className="h-[19px] w-auto" title="VLO" />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#526071] dark:text-[#8E98A8] leading-none mt-1">
                    {tr('Jurnal Trading', 'Trading Journal')}
                  </span>
                </div>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="min-h-[40px] min-w-[40px] -mr-2 flex items-center justify-center rounded-full text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161B24] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 transition-colors cursor-pointer"
                aria-label={tr('Tutup Menu', 'Close Menu')}
              >
                <X className="h-4 w-4 stroke-[1.75]" />
              </button>
            </div>

            {/* 2. Informasi Akun Aktif */}
            <div
              data-testid="mobile-menu-account-section"
              className="pb-3.5 border-b border-[#E4E4E7] dark:border-[#20252D]"
            >
              {currentUser ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAccount();
                  }}
                  className="w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-xl bg-[#FAFAFA] dark:bg-[#141922] hover:bg-[#F4F4F5] dark:hover:bg-[#1A202C] border border-[#E4E4E7] dark:border-[#20252D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 transition-colors cursor-pointer text-left group"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="h-8 w-8 rounded-full bg-white dark:bg-[#0E1218] border border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-center text-[#0F172A] dark:text-[#F2F4F7] shrink-0 overflow-hidden">
                      {getUserAvatarUrl(currentUser) ? (
                        <img
                          src={getUserAvatarUrl(currentUser)}
                          alt={currentUser.user_metadata?.full_name || currentUser.email || 'User'}
                          className="h-full w-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <User className="h-4 w-4 stroke-[1.75]" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <span
                        className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block truncate"
                        title={currentUser.email}
                      >
                        {currentUser.user_metadata?.full_name ||
                          currentUser.user_metadata?.name ||
                          currentUser.email}
                      </span>
                      <span className="text-[11px] text-[#526071] dark:text-[#8E98A8] block mt-0.5 truncate">
                        {currentUser.user_metadata?.full_name || currentUser.user_metadata?.name
                          ? currentUser.email
                          : tr('Akun aktif', 'Active account')}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-[#526071] dark:text-[#8E98A8] group-hover:text-[#0F172A] dark:group-hover:text-[#F2F4F7] shrink-0 stroke-[1.75] transition-colors" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAuth();
                  }}
                  className="w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-xl bg-[#FAFAFA] dark:bg-[#141922] hover:bg-[#F4F4F5] dark:hover:bg-[#1A202C] border border-[#E4E4E7] dark:border-[#20252D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 transition-colors cursor-pointer text-left group"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="h-8 w-8 rounded-full bg-white dark:bg-[#0E1218] border border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-center text-[#526071] dark:text-[#8E98A8] shrink-0">
                      <User className="h-4 w-4 stroke-[1.75]" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block truncate">
                        {tr('Belum masuk', 'Not signed in')}
                      </span>
                      <span className="text-[11px] text-[#526071] dark:text-[#8E98A8] block mt-0.5">
                        {tr('Ketuk untuk masuk akun', 'Tap to sign in')}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-[#526071] dark:text-[#8E98A8] group-hover:text-[#0F172A] dark:group-hover:text-[#F2F4F7] shrink-0 stroke-[1.75] transition-colors" />
                </button>
              )}

              {onOpenAccountSwitcher && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAccountSwitcher();
                  }}
                  className="mt-2 w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#0B0E13] hover:bg-[#F4F4F5] dark:hover:bg-[#141922] border border-[#E4E4E7] dark:border-[#20252D] transition-colors cursor-pointer text-left"
                >
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <Layers className="h-3.5 w-3.5 text-[#526071] dark:text-[#8E98A8] shrink-0 stroke-[1.75]" />
                    <span className="text-[11px] font-semibold text-[#0F172A] dark:text-[#F2F4F7] truncate">
                      {activeAccountLabel}
                    </span>
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-[#526071] dark:text-[#8E98A8] shrink-0 stroke-[1.75]" />
                </button>
              )}
            </div>

            {/* 3. Menu Utama (4 Tampilan Utama) */}
            <div
              data-testid="mobile-menu-main-section"
              className="pb-3.5 border-b border-[#E4E4E7] dark:border-[#20252D]"
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#526071] dark:text-[#8E98A8] block px-2 mb-1.5">
                {tr('MENU UTAMA', 'MAIN MENU')}
              </span>
              <nav className="flex flex-col space-y-0.5" aria-label={tr('Menu Utama', 'Main Menu')}>
                {mainMenuItems.map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    activeTab === item.id || (item.id === 'trades' && activeTab === 'detail');

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onNavigate(item.id);
                        onClose();
                      }}
                      className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-[13px] leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-[#F4F4F5] dark:bg-[#171D26] text-[#0F172A] dark:text-[#F2F4F7] font-semibold'
                          : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#FAFAFA] dark:hover:bg-[#141922] font-medium'
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 shrink-0 ${
                          isActive
                            ? 'text-[#0F172A] dark:text-[#F2F4F7] stroke-[2]'
                            : 'text-[#526071] dark:text-[#8E98A8] stroke-[1.75]'
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>

            {/* 4. Insight / Wawasan */}
            <div
              data-testid="mobile-menu-insight-section"
              className="pb-3.5 border-b border-[#E4E4E7] dark:border-[#20252D]"
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#526071] dark:text-[#8E98A8] block px-2 mb-1.5">
                {tr('WAWASAN', 'INSIGHT')}
              </span>
              <nav className="flex flex-col space-y-0.5" aria-label={tr('Wawasan Pasar', 'Market Insight')}>
                {insightMenuItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onNavigate(item.id);
                        onClose();
                      }}
                      className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-[13px] leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-[#F4F4F5] dark:bg-[#171D26] text-[#0F172A] dark:text-[#F2F4F7] font-semibold'
                          : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#FAFAFA] dark:hover:bg-[#141922] font-medium'
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 shrink-0 ${
                          isActive
                            ? 'text-[#0F172A] dark:text-[#F2F4F7] stroke-[2]'
                            : 'text-[#526071] dark:text-[#8E98A8] stroke-[1.75]'
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>

            {/* 4. Preferensi */}
            <div
              data-testid="mobile-menu-preferences-section"
              className="pb-3.5 border-b border-[#E4E4E7] dark:border-[#20252D]"
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#526071] dark:text-[#8E98A8] block px-2 mb-1.5">
                {tr('PREFERENSI', 'PREFERENCES')}
              </span>
              <button
                type="button"
                onClick={toggleTheme}
                data-testid="mobile-menu-theme-toggle"
                className="w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg text-left text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#FAFAFA] dark:hover:bg-[#141922] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 transition-colors cursor-pointer group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {isDark ? (
                    <Moon className="h-4 w-4 shrink-0 text-[#526071] dark:text-[#8E98A8] group-hover:text-[#0F172A] dark:group-hover:text-[#F2F4F7] stroke-[1.75]" />
                  ) : (
                    <Sun className="h-4 w-4 shrink-0 text-[#526071] dark:text-[#8E98A8] group-hover:text-[#0F172A] dark:group-hover:text-[#F2F4F7] stroke-[1.75]" />
                  )}
                  <div className="min-w-0">
                    <span className="text-[13px] font-medium text-[#0F172A] dark:text-[#F2F4F7] block leading-snug">
                      {tr('Tampilan', 'Appearance')}
                    </span>
                    <span className="text-[11px] text-[#526071] dark:text-[#8E98A8] block">
                      {isEn ? (isDark ? 'Dark' : 'Light') : (isDark ? 'Gelap' : 'Terang')}
                    </span>
                  </div>
                </div>
              </button>
              <div className="mt-1.5 px-1">
                <PWAInstallButton variant="compact" />
              </div>
            </div>

            {/* 6. Pengaturan (Hanya Pengaturan Aplikasi) */}
            <div
              data-testid="mobile-menu-settings-section"
              className="pb-2"
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#526071] dark:text-[#8E98A8] block px-2 mb-1.5">
                {tr('PENGATURAN', 'SETTINGS')}
              </span>
              <div className="flex flex-col space-y-0.5">
                <button
                  type="button"
                  onClick={() => {
                    onNavigate('settings');
                    onClose();
                  }}
                  className={`w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg text-[13px] leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 transition-colors cursor-pointer group ${
                    activeTab === 'settings'
                      ? 'bg-[#F4F4F5] dark:bg-[#171D26] text-[#0F172A] dark:text-[#F2F4F7] font-semibold'
                      : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#FAFAFA] dark:hover:bg-[#141922] font-medium'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Settings className="h-4 w-4 shrink-0 text-[#526071] dark:text-[#8E98A8] stroke-[1.75]" />
                    <span className="truncate">{tr('Pengaturan Aplikasi', 'App Settings')}</span>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#526071] dark:text-[#8E98A8] stroke-[1.75]" />
                </button>
              </div>
            </div>
          </div>

          {/* Footer & Informasi Versi App */}
          <div className="pt-3 mt-4 border-t border-[#E4E4E7] dark:border-[#20252D] px-2 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#526071] dark:text-[#8E98A8]">
              {tr('JURNAL VLO', 'VLO JOURNAL')}
            </span>
            <span
              className="text-[10px] font-mono-numbers tabular-nums font-medium text-[#526071] dark:text-[#8E98A8]"
              title={`v${APP_VERSION}`}
            >
              v{APP_VERSION}
            </span>
          </div>
        </div>
      </div>
    </>
  );
};
