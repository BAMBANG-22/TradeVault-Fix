/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
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
  User,
  ChevronRight,
  Moon,
  Sun,
  Settings,
  Layers,
  Command,
} from 'lucide-react';
import { AppSettings } from '../../types/settings';
import { useTheme } from '../../utils/theme';
import { useLanguage } from '../../utils/language';
import { getUserAvatarUrl } from '../../utils/supabaseClient';
import { resolveConfiguredAccounts } from '../../utils/journalExtras';
import { APP_VERSION } from '../../config/appVersion';
import { BrandLogo } from './BrandLogo';
import { PWAInstallButton } from './PWAInstallButton';

interface SidebarProps {
  activeTab: string;
  onNavigate: (tab: string) => void;
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
  onOpenQuickCommand?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onNavigate,
  settings,
  currentUser,
  onOpenAuth,
  onOpenAccount,
  onOpenAccountSwitcher,
  onOpenQuickCommand,
}) => {
  const { isDark, toggleTheme } = useTheme();
  const { isEn, tr } = useLanguage();

  const accounts = resolveConfiguredAccounts(settings);
  const activeAccountId = settings.activeAccountId || 'ALL';
  const activeAccountLabel =
    activeAccountId === 'ALL'
      ? tr('Semua Akun', 'All Accounts')
      : accounts.find((a) => a.id === activeAccountId)?.name || tr('Akun Utama', 'Primary Account');

  const mainMenuItems = [
    { id: 'dashboard', label: tr('Dasbor', 'Dashboard'), icon: LayoutDashboard },
    { id: 'trades', label: tr('Jurnal Trade', 'Trade Log'), icon: BookOpen },
    { id: 'analytics', label: tr('Analitik', 'Analytics'), icon: BarChart3 },
    { id: 'risk', label: tr('Manajemen Risiko', 'Risk Management'), icon: ShieldAlert },
  ];

  const insightMenuItems = [
    { id: 'market-chart', label: tr('Chart Pasar', 'Market Chart'), icon: CandlestickChart },
    { id: 'macro-news', label: tr('Berita Trading', 'Trade News'), icon: Newspaper },
    { id: 'fundamental-gold', label: tr('Fundamental Emas', 'Fundamental Gold'), icon: Globe },
    { id: 'cycle-confluence', label: tr('Siklus & Confluence', 'Cycle & Confluence'), icon: Compass },
    { id: 'smc-signal', label: tr('Sinyal SMC', 'SMC Signal'), icon: Target },
  ];

  return (
    <aside
      data-testid="desktop-sidebar"
      className="hidden lg:flex w-64 flex-col justify-between border-r border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#0E1218] px-4 py-5 text-[#0F172A] dark:text-[#F2F4F7] transition-colors duration-150 sticky top-0 h-screen overflow-y-auto shrink-0"
    >
      <div className="space-y-4">
        {/* 1. Logo VLO */}
        <div
          data-testid="sidebar-logo-section"
          className="px-1 pb-3.5 border-b border-[#E4E4E7] dark:border-[#20252D]"
        >
          <button
            type="button"
            data-tactile="none"
            onClick={() => onNavigate('dashboard')}
            className="group flex items-center gap-3 w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 rounded-xl py-0.5 cursor-pointer"
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
        </div>

        {/* 2. Informasi Akun Aktif */}
        <div
          data-testid="sidebar-account-section"
          className="pb-3.5 border-b border-[#E4E4E7] dark:border-[#20252D]"
        >
          {currentUser ? (
            <button
              type="button"
              onClick={onOpenAccount}
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
              onClick={onOpenAuth}
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
              onClick={onOpenAccountSwitcher}
              className="mt-2 w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#0B0E13] hover:bg-[#F4F4F5] dark:hover:bg-[#141922] border border-[#E4E4E7] dark:border-[#20252D] transition-colors cursor-pointer text-left group"
              title={tr('Ganti Sub-Portofolio / Akun Trading', 'Switch Sub-Portfolio / Trading Account')}
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
          data-testid="sidebar-main-section"
          className="pb-3.5 border-b border-[#E4E4E7] dark:border-[#20252D]"
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#526071] dark:text-[#8E98A8] block px-2 mb-1.5">
            {tr('MENU UTAMA', 'MAIN MENU')}
          </span>
          <nav className="flex flex-col space-y-0.5" aria-label={tr('Navigasi Desktop', 'Desktop Navigation')}>
            {mainMenuItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                activeTab === item.id || (item.id === 'trades' && activeTab === 'detail');

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
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
          data-testid="sidebar-insight-section"
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
                  onClick={() => onNavigate(item.id)}
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
          data-testid="sidebar-preferences-section"
          className="pb-3.5 border-b border-[#E4E4E7] dark:border-[#20252D]"
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#526071] dark:text-[#8E98A8] block px-2 mb-1.5">
            {tr('PREFERENSI', 'PREFERENCES')}
          </span>
          <button
            type="button"
            onClick={toggleTheme}
            data-testid="sidebar-theme-toggle"
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

          {onOpenQuickCommand && (
            <button
              type="button"
              onClick={onOpenQuickCommand}
              className="mt-0.5 w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg text-left text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#FAFAFA] dark:hover:bg-[#141922] transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Command className="h-4 w-4 shrink-0 text-[#526071] dark:text-[#8E98A8] stroke-[1.75]" />
                <span className="text-[13px] font-medium text-[#0F172A] dark:text-[#F2F4F7] truncate">
                  {tr('Perintah Cepat', 'Quick Command')}
                </span>
              </div>
              <kbd className="text-[10px] font-mono-numbers px-1.5 py-0.5 rounded border border-[#E4E4E7] dark:border-[#20252D] text-[#526071] dark:text-[#8E98A8]">
                ⌘K
              </kbd>
            </button>
          )}

          <div className="mt-1 px-1">
            <PWAInstallButton variant="compact" />
          </div>
        </div>

        {/* 6. Pengaturan (Hanya Pengaturan Aplikasi) */}
        <div
          data-testid="sidebar-settings-section"
          className="pb-2"
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#526071] dark:text-[#8E98A8] block px-2 mb-1.5">
            {tr('PENGATURAN', 'SETTINGS')}
          </span>
          <div className="flex flex-col space-y-0.5">
            <button
              type="button"
              onClick={() => onNavigate('settings')}
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
    </aside>
  );
};
