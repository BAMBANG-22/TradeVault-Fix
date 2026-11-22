import React, { useState } from 'react';
import { PlaybookSetup, TradingSession } from '../../types/trade';
import { AppSettings } from '../../types/settings';
import { getActivePlaybooks } from '../../utils/journalExtras';
import { useLanguage } from '../../utils/language';
import { BookOpen, Plus, Trash2, Edit2, X, Check, Sparkles, Image as ImageIcon } from 'lucide-react';

interface PlaybookLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onUpdateSettings: (next: AppSettings) => void;
  onSelectForNewTrade?: (playbook: PlaybookSetup) => void;
}

const SESSIONS: TradingSession[] = ['Asian', 'London', 'New York', 'Overlap', 'Other'];

export const PlaybookLibraryModal: React.FC<PlaybookLibraryModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  onSelectForNewTrade,
}) => {
  const { tr } = useLanguage();
  const playbooks = getActivePlaybooks(settings);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState('');
  const [session, setSession] = useState<TradingSession>('London');
  const [minRR, setMinRR] = useState('2.0');
  const [summary, setSummary] = useState('');
  const [criteriaText, setCriteriaText] = useState('');
  const [exampleUrl, setExampleUrl] = useState('');

  if (!isOpen) return null;

  const resetForm = () => {
    setEditingId(null);
    setIsAdding(false);
    setName('');
    setSession('London');
    setMinRR('2.0');
    setSummary('');
    setCriteriaText('');
    setExampleUrl('');
  };

  const startEdit = (pb: PlaybookSetup) => {
    setIsAdding(false);
    setEditingId(pb.id);
    setName(pb.name);
    setSession(pb.session);
    setMinRR(String(pb.minRR || 2));
    setSummary(pb.summary || '');
    setCriteriaText((pb.criteria || []).join('\n'));
    setExampleUrl(pb.exampleScreenshotUrl || '');
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;

    const criteria = criteriaText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const parsedRR = Math.max(0.5, parseFloat(minRR) || 2.0);
    const nowIso = new Date().toISOString();

    let nextPlaybooks: PlaybookSetup[];
    if (editingId) {
      nextPlaybooks = playbooks.map((p) =>
        p.id === editingId
          ? {
              ...p,
              name: cleanName,
              session,
              minRR: parsedRR,
              summary: summary.trim(),
              criteria,
              exampleScreenshotUrl: exampleUrl.trim() || undefined,
              updatedAt: nowIso,
            }
          : p
      );
    } else {
      const created: PlaybookSetup = {
        id: `pb-${Date.now().toString(36)}`,
        name: cleanName,
        session,
        minRR: parsedRR,
        summary: summary.trim(),
        criteria,
        exampleScreenshotUrl: exampleUrl.trim() || undefined,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      nextPlaybooks = [created, ...playbooks];
    }

    onUpdateSettings({
      ...settings,
      playbooks: nextPlaybooks,
    });
    resetForm();
  };

  const handleDelete = (id: string) => {
    const nextPlaybooks = playbooks.filter((p) => p.id !== id);
    onUpdateSettings({
      ...settings,
      playbooks: nextPlaybooks,
    });
    if (editingId === id) resetForm();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tr('Playbook Setup A+', 'A+ Setup Playbook Library')}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/55 dark:bg-black/75 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-2xl max-h-[88vh] flex flex-col rounded-t-[20px] sm:rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] text-[#0F172A] dark:text-[#F2F4F7] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#E4E4E7] dark:border-[#20252D] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded-xl bg-[#FAFAFA] dark:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-center shrink-0">
              <BookOpen className="h-4 w-4 text-[#0F172A] dark:text-[#F2F4F7]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold tracking-tight truncate">
                {tr('Playbook Setup A+', 'A+ Setup Playbook Library')}
              </h2>
              <p className="text-[11px] text-[#526071] dark:text-[#929BA9] truncate">
                {tr(
                  'Referensi SOP strategi pribadi yang terhubung langsung ke formulir transaksi.',
                  'Personal strategy SOP blueprints linked directly to your trade form.'
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!isAdding && !editingId && (
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setIsAdding(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] text-xs font-semibold cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{tr('Setup Baru', 'New Setup')}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={tr('Tutup', 'Close')}
              className="p-1.5 rounded-full text-[#526071] dark:text-[#929BA9] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {(isAdding || editingId) && (
            <form
              onSubmit={handleSaveForm}
              className="p-4 rounded-xl border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#0B0E13] space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F2F4F7]">
                  {editingId ? tr('Edit Playbook', 'Edit Playbook') : tr('Buat Playbook Baru', 'Create New Playbook')}
                </span>
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-[11px] font-medium text-[#526071] dark:text-[#929BA9] hover:underline cursor-pointer"
                >
                  {tr('Batal', 'Cancel')}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-medium text-[#526071] dark:text-[#929BA9] mb-1">
                    {tr('Nama Strategi / Setup', 'Strategy / Setup Name')} *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={tr('Mis. London Sweep + M5 CHoCH', 'e.g. London Sweep + M5 CHoCH')}
                    className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] text-xs focus:outline-none focus:border-[#0F172A] dark:focus:border-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[#526071] dark:text-[#929BA9] mb-1">
                    {tr('Sesi Ideal', 'Ideal Session')}
                  </label>
                  <select
                    value={session}
                    onChange={(e) => setSession(e.target.value as TradingSession)}
                    className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] text-xs focus:outline-none focus:border-[#0F172A] dark:focus:border-white"
                  >
                    {SESSIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-[#526071] dark:text-[#929BA9] mb-1">
                    {tr('Target Min. R:R', 'Min. R:R Target')}
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    value={minRR}
                    onChange={(e) => setMinRR(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] text-xs font-mono-numbers focus:outline-none focus:border-[#0F172A] dark:focus:border-white"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-medium text-[#526071] dark:text-[#929BA9] mb-1">
                    {tr('Ringkasan Setup', 'Setup Summary')}
                  </label>
                  <input
                    type="text"
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    placeholder={tr('Kondisi pasar utama agar setup valid...', 'Primary market condition for a valid setup...')}
                    className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] text-xs focus:outline-none focus:border-[#0F172A] dark:focus:border-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#526071] dark:text-[#929BA9] mb-1">
                  {tr('Kriteria Validasi (1 baris per poin)', 'Validation Criteria (1 line per rule)')}
                </label>
                <textarea
                  rows={3}
                  value={criteriaText}
                  onChange={(e) => setCriteriaText(e.target.value)}
                  placeholder={tr(
                    'Liquidity sweep di sesi Asia/London\nDisplacement + CHoCH M5/M15\nEntry di FVG dengan SL di balik swing',
                    'Asian/London liquidity sweep\nDisplacement + M5/M15 CHoCH\nFVG entry with SL beyond swing'
                  )}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] text-xs focus:outline-none focus:border-[#0F172A] dark:focus:border-white resize-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#526071] dark:text-[#929BA9] mb-1">
                  {tr('Tautan Contoh Chart (Opsional)', 'Example Chart URL (Optional)')}
                </label>
                <input
                  type="url"
                  value={exampleUrl}
                  onChange={(e) => setExampleUrl(e.target.value)}
                  placeholder="https://www.tradingview.com/x/..."
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] text-xs focus:outline-none focus:border-[#0F172A] dark:focus:border-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-3.5 py-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] text-xs font-medium text-[#526071] dark:text-[#929BA9] cursor-pointer"
                >
                  {tr('Batal', 'Cancel')}
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#0F172A] dark:bg-white text-white dark:text-[#0F172A] text-xs font-semibold cursor-pointer"
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>{tr('Simpan Playbook', 'Save Playbook')}</span>
                </button>
              </div>
            </form>
          )}

          {/* Playbook Cards */}
          <div className="space-y-3">
            {playbooks.map((pb) => (
              <div
                key={pb.id}
                className="p-4 rounded-xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] space-y-2.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-[#0F172A] dark:text-[#F2F4F7] truncate">
                        {pb.name}
                      </h3>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FAFAFA] dark:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] text-[#526071] dark:text-[#929BA9]">
                        {pb.session}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold font-mono-numbers bg-[#059669]/10 text-[#059669] dark:bg-[#00A878]/15 dark:text-[#00A878]">
                        Min 1:{pb.minRR}
                      </span>
                    </div>
                    {pb.summary && (
                      <p className="text-xs text-[#526071] dark:text-[#929BA9] mt-1 leading-relaxed text-editorial-justify">
                        {pb.summary}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {onSelectForNewTrade && (
                      <button
                        type="button"
                        onClick={() => {
                          onSelectForNewTrade(pb);
                          onClose();
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#FAFAFA] dark:bg-[#161A22] hover:bg-[#F4F4F5] dark:hover:bg-[#1E2430] border border-[#E4E4E7] dark:border-[#20252D] text-[11px] font-semibold text-[#0F172A] dark:text-[#F2F4F7] cursor-pointer"
                        title={tr('Catat trade baru dengan setup ini', 'Log a new trade with this setup')}
                      >
                        <Sparkles className="h-3 w-3" />
                        <span>{tr('Pakai', 'Use')}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => startEdit(pb)}
                      aria-label={tr('Edit playbook', 'Edit playbook')}
                      className="p-1.5 rounded-full text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#FAFAFA] dark:hover:bg-[#161A22] cursor-pointer"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(pb.id)}
                      aria-label={tr('Hapus playbook', 'Delete playbook')}
                      className="p-1.5 rounded-full text-[#526071] dark:text-[#929BA9] hover:text-[#E11D48] dark:hover:text-[#E05260] hover:bg-[#FAFAFA] dark:hover:bg-[#161A22] cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {pb.criteria && pb.criteria.length > 0 && (
                  <ul className="space-y-1 pt-2 border-t border-[#E4E4E7]/70 dark:border-[#20252D]/70">
                    {pb.criteria.map((rule, idx) => (
                      <li
                        key={idx}
                        className="flex items-start gap-2 text-xs text-[#0F172A] dark:text-[#E2E8F0]"
                      >
                        <Check className="h-3.5 w-3.5 text-[#059669] dark:text-[#00A878] shrink-0 mt-0.5" />
                        <span>{rule}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {pb.exampleScreenshotUrl && (
                  <div className="pt-1 flex items-center gap-1.5 text-[11px] text-[#526071] dark:text-[#929BA9]">
                    <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                    <a
                      href={pb.exampleScreenshotUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate hover:underline text-[#0F172A] dark:text-[#F2F4F7]"
                    >
                      {pb.exampleScreenshotUrl}
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
