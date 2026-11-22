import React, { useState } from 'react';
import { TradingAccount } from '../../types/trade';
import { AppSettings } from '../../types/settings';
import { resolveConfiguredAccounts, PRIMARY_ACCOUNT_ID } from '../../utils/journalExtras';
import { formatCurrency } from '../../utils/calculations';
import { useLanguage } from '../../utils/language';
import { Briefcase, Plus, Trash2, Check, X, Layers } from 'lucide-react';

interface AccountSwitcherModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onUpdateSettings: (next: AppSettings) => void;
}

const ACCOUNT_TYPES: { key: TradingAccount['accountType']; label: string }[] = [
  { key: 'LIVE', label: 'Live' },
  { key: 'PROP', label: 'Prop Firm' },
  { key: 'DEMO', label: 'Demo' },
  { key: 'CENT', label: 'Cent' },
];

export const AccountSwitcherModal: React.FC<AccountSwitcherModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
}) => {
  const { tr } = useLanguage();
  const accounts = resolveConfiguredAccounts(settings);
  const activeId = settings.activeAccountId || 'ALL';

  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState('');
  const [broker, setBroker] = useState('');
  const [accountType, setAccountType] = useState<TradingAccount['accountType']>('LIVE');
  const [startingBalance, setStartingBalance] = useState(String(settings.startingBalance || 10000));

  if (!isOpen) return null;

  const selectAccount = (id: string) => {
    onUpdateSettings({
      ...settings,
      accounts,
      activeAccountId: id,
    });
    onClose();
  };

  const handleAddAccount = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;
    const balance = Math.max(1, parseFloat(startingBalance) || settings.startingBalance);

    const created: TradingAccount = {
      id: `ACC-${Date.now().toString(36).toUpperCase()}`,
      name: cleanName,
      broker: broker.trim() || undefined,
      accountType,
      startingBalance: balance,
      currency: settings.currency,
      createdAt: new Date().toISOString(),
    };

    const nextAccounts = [...accounts, created];
    onUpdateSettings({
      ...settings,
      accounts: nextAccounts,
      activeAccountId: created.id,
    });
    setName('');
    setBroker('');
    setIsAdding(false);
  };

  const handleDeleteAccount = (id: string) => {
    if (id === PRIMARY_ACCOUNT_ID || accounts.length <= 1) return;
    const nextAccounts = accounts.filter((a) => a.id !== id);
    onUpdateSettings({
      ...settings,
      accounts: nextAccounts,
      activeAccountId: activeId === id ? 'ALL' : activeId,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tr('Kelola Akun & Sub-Portofolio', 'Manage Accounts & Sub-Portfolios')}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/55 dark:bg-black/75 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg max-h-[85vh] flex flex-col rounded-t-[20px] sm:rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] text-[#0F172A] dark:text-[#F2F4F7] shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#E4E4E7] dark:border-[#20252D]">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-[#FAFAFA] dark:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-center">
              <Briefcase className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold">
                {tr('Multi-Akun & Sub-Portofolio', 'Multi-Account & Sub-Portfolios')}
              </h2>
              <p className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                {tr('Pisahkan ekuitas & statistik antar akun Live, Prop Firm, atau Cent.', 'Isolate equity & metrics across Live, Prop Firm, or Cent accounts.')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr('Tutup', 'Close')}
            className="p-1.5 rounded-full text-[#526071] dark:text-[#929BA9] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-3">
          {/* All Accounts Aggregate */}
          <button
            type="button"
            onClick={() => selectAccount('ALL')}
            className={`w-full flex items-center justify-between gap-3 p-3.5 rounded-xl border text-left transition-colors cursor-pointer ${
              activeId === 'ALL'
                ? 'border-[#0F172A] dark:border-white bg-[#FAFAFA] dark:bg-[#161A22]'
                : 'border-[#E4E4E7] dark:border-[#20252D] hover:bg-[#FAFAFA] dark:hover:bg-[#141922]'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <Layers className="h-4 w-4 text-[#526071] dark:text-[#929BA9] shrink-0" />
              <div className="min-w-0">
                <span className="text-xs font-bold block">{tr('Semua Akun (Gabungan)', 'All Accounts (Combined)')}</span>
                <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block">
                  {tr('Tampilkan seluruh transaksi dari semua portofolio.', 'Show all trades across every portfolio.')}
                </span>
              </div>
            </div>
            {activeId === 'ALL' && <Check className="h-4 w-4 text-[#059669] dark:text-[#00A878] shrink-0" />}
          </button>

          {/* Individual Accounts */}
          {accounts.map((acc) => {
            const isSelected = activeId === acc.id;
            return (
              <div
                key={acc.id}
                className={`flex items-center justify-between gap-2 p-3.5 rounded-xl border transition-colors ${
                  isSelected
                    ? 'border-[#0F172A] dark:border-white bg-[#FAFAFA] dark:bg-[#161A22]'
                    : 'border-[#E4E4E7] dark:border-[#20252D] hover:bg-[#FAFAFA] dark:hover:bg-[#141922]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => selectAccount(acc.id)}
                  className="flex-1 text-left min-w-0 cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold truncate">{acc.name}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] text-[#526071] dark:text-[#929BA9]">
                      {acc.accountType}
                    </span>
                  </div>
                  <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5 font-mono-numbers">
                    {acc.broker ? `${acc.broker} · ` : ''}
                    {tr('Modal:', 'Balance:')} {formatCurrency(acc.startingBalance, settings)}
                  </span>
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  {isSelected && <Check className="h-4 w-4 text-[#059669] dark:text-[#00A878]" />}
                  {acc.id !== PRIMARY_ACCOUNT_ID && accounts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleDeleteAccount(acc.id)}
                      aria-label={tr('Hapus akun', 'Delete account')}
                      className="p-1.5 rounded-full text-[#526071] hover:text-[#E11D48] cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* Add New Sub-Portfolio Form */}
          {isAdding ? (
            <form
              onSubmit={handleAddAccount}
              className="p-4 rounded-xl border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#0B0E13] space-y-3"
            >
              <span className="text-xs font-bold block">
                {tr('Tambah Sub-Portofolio Baru', 'Add New Sub-Portfolio')}
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={tr('Nama Akun (mis. FTMO 100K)', 'Account Name (e.g. FTMO 100K)')}
                  className="px-3 py-2 rounded-lg bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] text-xs focus:outline-none"
                />
                <input
                  type="text"
                  value={broker}
                  onChange={(e) => setBroker(e.target.value)}
                  placeholder={tr('Broker / Firma (Opsional)', 'Broker / Firm (Optional)')}
                  className="px-3 py-2 rounded-lg bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] text-xs focus:outline-none"
                />
                <select
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value as TradingAccount['accountType'])}
                  className="px-3 py-2 rounded-lg bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] text-xs focus:outline-none"
                >
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  step="any"
                  required
                  value={startingBalance}
                  onChange={(e) => setStartingBalance(e.target.value)}
                  placeholder={tr('Saldo Awal', 'Starting Balance')}
                  className="px-3 py-2 rounded-lg bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] text-xs font-mono-numbers focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="px-3 py-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] text-xs font-medium cursor-pointer"
                >
                  {tr('Batal', 'Cancel')}
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-full bg-[#0F172A] dark:bg-white text-white dark:text-[#0F172A] text-xs font-semibold cursor-pointer"
                >
                  {tr('Simpan Akun', 'Save Account')}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setIsAdding(true)}
              className="w-full py-2.5 rounded-xl border border-dashed border-[#D4D4D8] dark:border-[#2A313C] text-xs font-semibold text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:border-[#0F172A] dark:hover:border-white transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{tr('Tambah Akun / Portofolio Baru', 'Add New Account / Portfolio')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
