import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Trade } from '../../types/trade';
import { useLanguage } from '../../utils/language';
import {
  Search,
  LayoutDashboard,
  List,
  BarChart3,
  Calculator,
  CandlestickChart,
  Newspaper,
  Globe,
  Compass,
  Target,
  Settings,
  Plus,
  BookOpen,
  Briefcase,
  Moon,
  CornerDownLeft,
  X,
} from 'lucide-react';

interface QuickCommandModalProps {
  isOpen: boolean;
  onClose: () => void;
  trades: Trade[];
  onNavigateTab: (tab: string) => void;
  onAddTrade: () => void;
  onOpenPlaybook: () => void;
  onOpenAccountSwitcher: () => void;
  onToggleTheme: () => void;
  onViewTrade: (trade: Trade) => void;
}

interface CommandItem {
  id: string;
  group: 'ACTION' | 'NAV' | 'TRADE';
  label: string;
  hint?: string;
  shortcut?: string;
  icon: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
}

export const QuickCommandModal: React.FC<QuickCommandModalProps> = ({
  isOpen,
  onClose,
  trades,
  onNavigateTab,
  onAddTrade,
  onOpenPlaybook,
  onOpenAccountSwitcher,
  onToggleTheme,
  onViewTrade,
}) => {
  const { tr } = useLanguage();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [isOpen]);

  const items = useMemo<CommandItem[]>(() => {
    const base: CommandItem[] = [
      {
        id: 'act-add',
        group: 'ACTION',
        label: tr('Tambah Transaksi Baru', 'Add New Trade'),
        shortcut: 'N',
        icon: Plus,
        onSelect: () => {
          onClose();
          onAddTrade();
        },
      },
      {
        id: 'act-playbook',
        group: 'ACTION',
        label: tr('Buka Playbook Setup A+', 'Open A+ Setup Playbook'),
        icon: BookOpen,
        onSelect: () => {
          onClose();
          onOpenPlaybook();
        },
      },
      {
        id: 'act-accounts',
        group: 'ACTION',
        label: tr('Ganti Akun / Sub-Portofolio', 'Switch Account / Sub-Portfolio'),
        icon: Briefcase,
        onSelect: () => {
          onClose();
          onOpenAccountSwitcher();
        },
      },
      {
        id: 'act-theme',
        group: 'ACTION',
        label: tr('Ganti Tema Terang / Gelap', 'Toggle Light / Dark Theme'),
        icon: Moon,
        onSelect: () => {
          onClose();
          onToggleTheme();
        },
      },
      { id: 'nav-dashboard', group: 'NAV', label: tr('Dasbor', 'Dashboard'), icon: LayoutDashboard, onSelect: () => { onClose(); onNavigateTab('dashboard'); } },
      { id: 'nav-trades', group: 'NAV', label: tr('Jurnal Trade', 'Trade Log'), shortcut: '/', icon: List, onSelect: () => { onClose(); onNavigateTab('trades'); } },
      { id: 'nav-analytics', group: 'NAV', label: tr('Analitik & Review', 'Analytics & Review'), icon: BarChart3, onSelect: () => { onClose(); onNavigateTab('analytics'); } },
      { id: 'nav-risk', group: 'NAV', label: tr('Manajemen Risiko & Compounding', 'Risk Management & Compounding'), icon: Calculator, onSelect: () => { onClose(); onNavigateTab('risk'); } },
      { id: 'nav-chart', group: 'NAV', label: tr('Chart Pasar', 'Market Chart'), icon: CandlestickChart, onSelect: () => { onClose(); onNavigateTab('market-chart'); } },
      { id: 'nav-news', group: 'NAV', label: tr('Berita Trading', 'Trade News'), icon: Newspaper, onSelect: () => { onClose(); onNavigateTab('macro-news'); } },
      { id: 'nav-gold', group: 'NAV', label: tr('Fundamental Emas', 'Fundamental Gold'), icon: Globe, onSelect: () => { onClose(); onNavigateTab('fundamental-gold'); } },
      { id: 'nav-cycle', group: 'NAV', label: tr('Siklus & Confluence', 'Cycle & Confluence'), icon: Compass, onSelect: () => { onClose(); onNavigateTab('cycle-confluence'); } },
      { id: 'nav-smc', group: 'NAV', label: tr('Sinyal SMC', 'SMC Signal'), icon: Target, onSelect: () => { onClose(); onNavigateTab('smc-signal'); } },
      { id: 'nav-settings', group: 'NAV', label: tr('Pengaturan', 'Settings'), icon: Settings, onSelect: () => { onClose(); onNavigateTab('settings'); } },
    ];

    const recentTradeItems: CommandItem[] = (trades || []).slice(0, 6).map((t) => ({
      id: `tr-${t.id}`,
      group: 'TRADE',
      label: `${t.instrument} · ${t.position} ${t.lotSize} Lot`,
      hint: `${(t.dateTime || '').slice(0, 10)} · ${t.strategy || t.outcome}`,
      icon: List,
      onSelect: () => {
        onClose();
        onViewTrade(t);
      },
    }));

    const q = query.trim().toLowerCase();
    const all = [...base, ...recentTradeItems];
    if (!q) return all;
    return all.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        (item.hint && item.hint.toLowerCase().includes(q))
    );
  }, [
    query,
    trades,
    tr,
    onClose,
    onAddTrade,
    onOpenPlaybook,
    onOpenAccountSwitcher,
    onToggleTheme,
    onNavigateTab,
    onViewTrade,
  ]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (items.length > 0 ? (prev + 1) % items.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (items.length > 0 ? (prev - 1 + items.length) % items.length : 0));
    } else if (e.key === 'Enter' && items[selectedIndex]) {
      e.preventDefault();
      items[selectedIndex].onSelect();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tr('Perintah Cepat', 'Quick Command')}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4 bg-black/55 dark:bg-black/75 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        className="w-full max-w-lg rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] text-[#0F172A] dark:text-[#F2F4F7] shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[#E4E4E7] dark:border-[#20252D]">
          <Search className="h-4 w-4 text-[#526071] dark:text-[#929BA9] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr('Cari menu, aksi cepat, atau transaksi...', 'Search menus, actions, or trades...')}
            className="flex-1 bg-transparent text-sm focus:outline-none placeholder-[#94A3B8] dark:placeholder-[#606875]"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={tr('Tutup', 'Close')}
            className="p-1 rounded-full text-[#526071] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-2 space-y-0.5">
          {items.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#526071] dark:text-[#929BA9]">
              {tr('Tidak ada perintah yang cocok.', 'No matching commands found.')}
            </div>
          ) : (
            items.map((item, idx) => {
              const Icon = item.icon;
              const isActive = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={item.onSelect}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-left text-xs transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#F4F4F5] dark:bg-[#171D26] text-[#0F172A] dark:text-[#F2F4F7] font-semibold'
                      : 'text-[#526071] dark:text-[#929BA9] hover:bg-[#FAFAFA] dark:hover:bg-[#141922]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon className="h-4 w-4 shrink-0 stroke-[1.75]" />
                    <div className="min-w-0">
                      <span className="block truncate">{item.label}</span>
                      {item.hint && (
                        <span className="block text-[10px] text-[#526071] dark:text-[#8E98A8] truncate">
                          {item.hint}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {item.shortcut && (
                      <kbd className="px-1.5 py-0.5 rounded bg-white dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] text-[10px] font-mono-numbers">
                        {item.shortcut}
                      </kbd>
                    )}
                    {isActive && <CornerDownLeft className="h-3.5 w-3.5 opacity-60" />}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="px-4 py-2 border-t border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#0B0E13] flex items-center justify-between text-[10px] text-[#526071] dark:text-[#929BA9]">
          <span>{tr('Shortcut: N Tambah · / Cari · Esc Tutup', 'Shortcuts: N Add · / Search · Esc Close')}</span>
          <span className="font-mono-numbers">Ctrl / ⌘ K</span>
        </div>
      </div>
    </div>
  );
};
