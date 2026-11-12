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
  X,
  Plus,
  PlusCircle,
  User,
  ChevronRight,
  Moon,
  Sun,
  Settings,
  Database,
  Info,
  HardDriveDownload,
} from 'lucide-react';
import { AppSettings } from '../../types/settings';
import { useTheme } from '../../utils/theme';
import { useLanguage } from '../../utils/language';
import { BrandLogo } from './BrandLogo';

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
}

export const MobileNav: React.FC<MobileNavProps> = ({
  activeTab,
  onNavigate,
  isOpen,
  onClose,
  tradesCount,
  onOpenLocalInfo,
  onOpenBackupModal,
  currentUser,
  onOpenAuth,
  onOpenAccount,
  onAddTrade,
}) => {
  const { isDark, toggleTheme } = useTheme();
  const { isEn, tr } = useLanguage();

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
    { id: 'add-trade', label: tr('Catat Trade Baru', 'New Trade'), icon: PlusCircle },
    { id: 'analytics', label: tr('Analitik', 'Analytics'), icon: BarChart3 },
    { id: 'risk', label: tr('Manajemen Risiko', 'Risk Management'), icon: ShieldAlert },
    { id: 'market-chart', label: tr('Chart Pasar', 'Market Chart'), icon: CandlestickChart },
    { id: 'macro-news', label: tr('Trade News', 'Trade News'), icon: Newspaper },
  ];

  return (
    <>
      {/* Mobile Bottom Thumb Navigation Bar (5 Positions: Dashboard, Trade Log, [+], Analytics, Risk) */}
      <nav
        aria-label={tr('Navigasi Utama Bawah', 'Bottom Primary Navigation')}
        className="fixed bottom-0 left-0 right-0 z-40 lg:hidden border-t border-[#DDE3EA] dark:border-[#20252D] bg-white/95 dark:bg-[#0B0D11]/95 backdrop-blur-md px-2 pt-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom,0px))] transition-colors duration-150"
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
              <div className="flex items-center justify-center h-9 w-9 rounded-xl bg-[#151D2A] hover:bg-[#1E293B] text-white dark:bg-[#1A202A] dark:hover:bg-[#242C3A] dark:text-[#F2F4F7] border border-black/10 dark:border-white/[0.14] active:scale-95 shadow-xs transition-all duration-150">
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
        </div>
      </nav>

      {/* Slide-out Hamburger Drawer Overlay — Smooth Enter (Left-to-Right) & Exit (Right-to-Left) */}
      <div
        data-testid="mobile-drawer-overlay"
        aria-hidden={!isOpen}
        className={`fixed inset-0 z-50 transition-opacity duration-250 ease-out ${
          isOpen
            ? 'opacity-100 pointer-events-auto visible'
            : 'opacity-0 pointer-events-none invisible delay-250'
        }`}
      >
        {/* Backdrop */}
        <div
          className={`fixed inset-0 bg-black/50 dark:bg-black/75 backdrop-blur-[2px] transition-opacity duration-250 ease-out ${
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
          className={`fixed inset-y-0 left-0 z-10 w-72 max-w-[85vw] bg-white dark:bg-[#0E1218] border-r border-[#DDE3EA] dark:border-[#202630] px-4 pt-[calc(0.875rem+env(safe-area-inset-top,0px))] pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] overflow-y-auto flex flex-col justify-between shadow-2xl transform transition-transform duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            isOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="space-y-4">
            {/* 1. Logo TradeVault */}
            <div
              data-testid="mobile-menu-logo-section"
              className="flex items-center justify-between pb-3 border-b border-[#DDE3EA] dark:border-[#202630]"
            >
              <div className="flex items-center gap-2.5">
                <BrandLogo variant="symbol" className="h-6 w-6 shrink-0" />
                <span className="text-[15px] font-bold tracking-tight text-[#151D2A] dark:text-[#F2F5F9]">
                  TradeVault
                </span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 -mr-1 rounded-lg text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F5F9] hover:bg-[#F5F7FA] dark:hover:bg-[#161B24] transition-colors cursor-pointer"
                aria-label={tr('Tutup Menu', 'Close Menu')}
              >
                <X className="h-4 w-4 stroke-[1.75]" />
              </button>
            </div>

            {/* 2. Informasi Akun Aktif */}
            <div
              data-testid="mobile-menu-account-section"
              className="pb-3.5 border-b border-[#DDE3EA] dark:border-[#202630]"
            >
              {currentUser ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAccount();
                  }}
                  className="w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-xl bg-[#F8FAFC] dark:bg-[#141922] hover:bg-[#F1F5F9] dark:hover:bg-[#1A202C] border border-[#DDE3EA] dark:border-[#202630] transition-colors cursor-pointer text-left group"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="h-8 w-8 rounded-lg bg-white dark:bg-[#0E1218] border border-[#DDE3EA] dark:border-[#252B34] flex items-center justify-center text-[#151D2A] dark:text-[#F2F5F9] shrink-0">
                      <User className="h-4 w-4 stroke-[1.75]" />
                    </div>
                    <div className="min-w-0">
                      <span
                        className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] block truncate"
                        title={currentUser.email}
                      >
                        {currentUser.email}
                      </span>
                      <span className="text-[11px] text-[#697586] dark:text-[#8E98A8] block mt-0.5">
                        {tr('Akun aktif', 'Active account')}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-[#697586] dark:text-[#8E98A8] group-hover:text-[#151D2A] dark:group-hover:text-[#F2F5F9] shrink-0 stroke-[1.75] transition-colors" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAuth();
                  }}
                  className="w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-xl bg-[#F8FAFC] dark:bg-[#141922] hover:bg-[#F1F5F9] dark:hover:bg-[#1A202C] border border-[#DDE3EA] dark:border-[#202630] transition-colors cursor-pointer text-left group"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="h-8 w-8 rounded-lg bg-white dark:bg-[#0E1218] border border-[#DDE3EA] dark:border-[#252B34] flex items-center justify-center text-[#697586] dark:text-[#8E98A8] shrink-0">
                      <User className="h-4 w-4 stroke-[1.75]" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] block truncate">
                        {tr('Belum masuk', 'Not signed in')}
                      </span>
                      <span className="text-[11px] text-[#697586] dark:text-[#8E98A8] block mt-0.5">
                        {tr('Ketuk untuk masuk akun', 'Tap to sign in')}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-[#697586] dark:text-[#8E98A8] group-hover:text-[#151D2A] dark:group-hover:text-[#F2F5F9] shrink-0 stroke-[1.75] transition-colors" />
                </button>
              )}
            </div>

            {/* 3. Menu Utama */}
            <div
              data-testid="mobile-menu-main-section"
              className="pb-3.5 border-b border-[#DDE3EA] dark:border-[#202630]"
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#697586] dark:text-[#8E98A8] block px-2 mb-1.5">
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
                        if (item.id === 'add-trade' && onAddTrade) {
                          onAddTrade();
                        } else {
                          onNavigate(item.id);
                        }
                        onClose();
                      }}
                      className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-[13px] leading-snug transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-[#F1F5F9] dark:bg-[#171D26] text-[#151D2A] dark:text-[#F2F5F9] font-semibold'
                          : 'text-[#5E6A7D] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F5F9] hover:bg-[#F8FAFC] dark:hover:bg-[#141922] font-medium'
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 shrink-0 ${
                          isActive
                            ? 'text-[#151D2A] dark:text-[#F2F5F9] stroke-[2]'
                            : 'text-[#697586] dark:text-[#8E98A8] stroke-[1.75]'
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
              className="pb-3.5 border-b border-[#DDE3EA] dark:border-[#202630]"
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#697586] dark:text-[#8E98A8] block px-2 mb-1.5">
                {tr('PREFERENSI', 'PREFERENCES')}
              </span>
              <button
                type="button"
                onClick={toggleTheme}
                data-testid="mobile-menu-theme-toggle"
                className="w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg text-left text-[#5E6A7D] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F5F9] hover:bg-[#F8FAFC] dark:hover:bg-[#141922] transition-colors cursor-pointer group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {isDark ? (
                    <Moon className="h-4 w-4 shrink-0 text-[#697586] dark:text-[#8E98A8] group-hover:text-[#151D2A] dark:group-hover:text-[#F2F5F9] stroke-[1.75]" />
                  ) : (
                    <Sun className="h-4 w-4 shrink-0 text-[#697586] dark:text-[#8E98A8] group-hover:text-[#151D2A] dark:group-hover:text-[#F2F5F9] stroke-[1.75]" />
                  )}
                  <div className="min-w-0">
                    <span className="text-[13px] font-medium text-[#151D2A] dark:text-[#F2F5F9] block leading-snug">
                      {tr('Tampilan', 'Appearance')}
                    </span>
                    <span className="text-[11px] text-[#697586] dark:text-[#8E98A8] block">
                      {isEn ? (isDark ? 'Dark' : 'Light') : (isDark ? 'Gelap' : 'Terang')}
                    </span>
                  </div>
                </div>
              </button>
            </div>

            {/* 5. Pengaturan */}
            <div
              data-testid="mobile-menu-settings-section"
              className="pb-3.5 border-b border-[#DDE3EA] dark:border-[#202630]"
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#697586] dark:text-[#8E98A8] block px-2 mb-1.5">
                {tr('PENGATURAN', 'SETTINGS')}
              </span>
              <div className="flex flex-col space-y-0.5">
                <button
                  type="button"
                  onClick={() => {
                    onNavigate('settings');
                    onClose();
                  }}
                  className={`w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg text-[13px] leading-snug transition-colors cursor-pointer group ${
                    activeTab === 'settings'
                      ? 'bg-[#F1F5F9] dark:bg-[#171D26] text-[#151D2A] dark:text-[#F2F5F9] font-semibold'
                      : 'text-[#5E6A7D] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F5F9] hover:bg-[#F8FAFC] dark:hover:bg-[#141922] font-medium'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Settings className="h-4 w-4 shrink-0 text-[#697586] dark:text-[#8E98A8] stroke-[1.75]" />
                    <span className="truncate">{tr('Pengaturan Aplikasi', 'App Settings')}</span>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#697586] dark:text-[#8E98A8] stroke-[1.75]" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    if (currentUser) {
                      onOpenAccount();
                    } else {
                      onOpenAuth();
                    }
                  }}
                  className="w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg text-[13px] leading-snug text-[#5E6A7D] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F5F9] hover:bg-[#F8FAFC] dark:hover:bg-[#141922] font-medium transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <User className="h-4 w-4 shrink-0 text-[#697586] dark:text-[#8E98A8] stroke-[1.75]" />
                    <span className="truncate">{tr('Pengaturan Akun', 'Account Settings')}</span>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#697586] dark:text-[#8E98A8] stroke-[1.75]" />
                </button>
              </div>
            </div>

            {/* 6. Data & Penyimpanan - DATA &amp; PENYIMPANAN */}
            <div data-testid="mobile-menu-storage-section" className="pb-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#697586] dark:text-[#8E98A8] block px-2 mb-1.5">
                {tr('DATA & PENYIMPANAN', 'DATA & STORAGE')}
              </span>
              <div className="flex flex-col space-y-0.5">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenLocalInfo();
                  }}
                  className="w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg text-[13px] leading-snug text-[#5E6A7D] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F5F9] hover:bg-[#F8FAFC] dark:hover:bg-[#141922] font-medium transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Database className="h-4 w-4 shrink-0 text-[#697586] dark:text-[#8E98A8] stroke-[1.75]" />
                    <span className="truncate">{tr('Penyimpanan Lokal', 'Local Storage')}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[11px] font-mono-numbers tabular-nums text-[#697586] dark:text-[#8E98A8]">
                      {tradesCount}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-[#697586] dark:text-[#8E98A8] stroke-[1.75]" />
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenLocalInfo();
                  }}
                  className="w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg text-[13px] leading-snug text-[#5E6A7D] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F5F9] hover:bg-[#F8FAFC] dark:hover:bg-[#141922] font-medium transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Info className="h-4 w-4 shrink-0 text-[#697586] dark:text-[#8E98A8] stroke-[1.75]" />
                    <span className="truncate">{tr('Info Penyimpanan', 'Storage Info')}</span>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#697586] dark:text-[#8E98A8] stroke-[1.75]" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenBackupModal();
                  }}
                  className="w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg text-[13px] leading-snug text-[#5E6A7D] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F5F9] hover:bg-[#F8FAFC] dark:hover:bg-[#141922] font-medium transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <HardDriveDownload className="h-4 w-4 shrink-0 text-[#697586] dark:text-[#8E98A8] stroke-[1.75]" />
                    <span className="truncate">{tr('Cadangan Data', 'Backup Data')}</span>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#697586] dark:text-[#8E98A8] stroke-[1.75]" />
                </button>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="pt-3 mt-4 border-t border-[#DDE3EA] dark:border-[#202630] px-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#697586] dark:text-[#8E98A8] block">
              {tr('JURNAL TRADEVAULT', 'TRADEVAULT JOURNAL')}
            </span>
          </div>
        </div>
      </div>
    </>
  );
};
