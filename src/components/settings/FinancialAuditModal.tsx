import React, { useState, useEffect } from 'react';
import {
  runFinancialCalculationsTests,
  runPhase1StorageAndMigrationTests,
  TestSuiteSummary,
  Phase1TestSuiteSummary,
} from '../../utils/testRunner';
import { useLanguage } from '../../utils/language';
import {
  X,
  CheckCircle,
  XCircle,
  ShieldCheck,
  RotateCcw,
  Database,
} from 'lucide-react';

interface FinancialAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FinancialAuditModal: React.FC<FinancialAuditModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { tr } = useLanguage();
  const [activeTab, setActiveTab] = useState<'FINANCIAL' | 'PHASE1_STORAGE'>('FINANCIAL');
  const [suiteResult, setSuiteResult] = useState<TestSuiteSummary | null>(() =>
    runFinancialCalculationsTests()
  );
  const [phase1Result, setPhase1Result] = useState<Phase1TestSuiteSummary | null>(null);
  const [isRunningPhase1, setIsRunningPhase1] = useState<boolean>(false);
  const [filterCategory, setFilterCategory] = useState<string>('ALL');

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

  if (!isOpen) return null;

  const handleRerunFinancial = () => {
    const res = runFinancialCalculationsTests();
    setSuiteResult(res);
  };

  const handleRunPhase1StorageTests = async () => {
    setIsRunningPhase1(true);
    try {
      const res = await runPhase1StorageAndMigrationTests();
      setPhase1Result(res);
      setFilterCategory('ALL');
    } finally {
      setIsRunningPhase1(false);
    }
  };

  const currentSuite: TestSuiteSummary | null =
    activeTab === 'FINANCIAL' ? suiteResult : phase1Result;

  const categories = currentSuite
    ? Array.from(new Set(currentSuite.results.map((r) => r.category)))
    : [];

  const filteredResults = currentSuite
    ? filterCategory === 'ALL'
      ? currentSuite.results
      : currentSuite.results.filter((r) => r.category === filterCategory)
    : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl border border-[#DDE3EA] dark:border-[#252B34] bg-white dark:bg-[#11151B] p-5 sm:p-6 shadow-2xl text-[#151D2A] dark:text-[#F2F5F9] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#DDE3EA] dark:border-[#252B34]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#EEF2F6] dark:bg-[#171D26] text-[#697586] dark:text-[#929BA9] border border-[#DDE3EA] dark:border-[#252B34]">
              <ShieldCheck className="h-5 w-5 stroke-[1.75]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#151D2A] dark:text-[#F2F5F9]">
                {tr(
                  'Audit & Pengujian Otomatis Modul Finansial & Storage',
                  'Financial & Storage Automated Audit & Test Suite'
                )}
              </h3>
              <p className="text-xs text-[#697586] dark:text-[#929BA9]">
                {tr(
                  'Uji verifikasi rumus matematis dan isolasi database lokal dengan data sintetis terkontrol (tidak mengubah data riil Anda)',
                  'Verify mathematical formulas and local database isolation using controlled synthetic fixtures (does not alter your real data)'
                )}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-[#EEF2F6] dark:bg-[#171D26] text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F5F9]"
            aria-label={tr('Tutup modal audit finansial', 'Close financial audit modal')}
          >
            <X className="h-5 w-5 stroke-[1.75]" />
          </button>
        </div>

        {/* Mode Selector Tabs */}
        <div className="flex items-center gap-2 pt-3">
          <button
            onClick={() => {
              setActiveTab('FINANCIAL');
              setFilterCategory('ALL');
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              activeTab === 'FINANCIAL'
                ? 'bg-[#1769E8] text-white border-[#1769E8]'
                : 'bg-[#F5F7FA] dark:bg-[#080A0E] text-[#697586] dark:text-[#929BA9] border-[#DDE3EA] dark:border-[#252B34]'
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5 stroke-[1.75]" />
            <span>{tr('Audit Rumus Finansial', 'Financial Formula Audit')}</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('PHASE1_STORAGE');
              setFilterCategory('ALL');
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              activeTab === 'PHASE1_STORAGE'
                ? 'bg-[#1769E8] text-white border-[#1769E8]'
                : 'bg-[#F5F7FA] dark:bg-[#080A0E] text-[#697586] dark:text-[#929BA9] border-[#DDE3EA] dark:border-[#252B34]'
            }`}
          >
            <Database className="h-3.5 w-3.5 stroke-[1.75]" />
            <span>Phase 1: Isolated IndexedDB (AT-01..AT-17)</span>
          </button>
        </div>

        {/* Status Bar for Financial Tab */}
        {activeTab === 'FINANCIAL' && suiteResult && (
          <div className="my-3 p-3.5 rounded-xl bg-[#F5F7FA] dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#252B34] flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400 stroke-[1.75]" />
                <span>
                  {tr('Lulus:', 'Passed:')}{' '}
                  <strong className="text-emerald-600 dark:text-emerald-400 font-mono-numbers">
                    {suiteResult.passed}
                  </strong>{' '}
                  / {suiteResult.total}
                </span>
              </div>
              {suiteResult.failed > 0 && (
                <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
                  <XCircle className="h-4 w-4 stroke-[1.75]" />
                  <span>
                    {tr('Gagal:', 'Failed:')} {suiteResult.failed}
                  </span>
                </div>
              )}
              <span className="text-[#697586] dark:text-[#929BA9] font-mono-numbers">
                {tr('Waktu:', 'Time:')} {suiteResult.durationMs}ms
              </span>
            </div>

            <button
              onClick={handleRerunFinancial}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#1769E8] hover:bg-[#1458C4] text-white font-bold text-xs transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5 stroke-[1.75]" />
              <span>{tr('Jalankan Ulang Tes', 'Re-run Tests')}</span>
            </button>
          </div>
        )}

        {/* Status Bar for Phase 1 Storage Tab */}
        {activeTab === 'PHASE1_STORAGE' && (
          <div className="my-3 p-3.5 rounded-xl bg-[#F5F7FA] dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#252B34] space-y-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {phase1Result ? (
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400 stroke-[1.75]" />
                    <span>
                      PASS:{' '}
                      <strong className="text-emerald-600 dark:text-emerald-400 font-mono-numbers">
                        {phase1Result.passed}
                      </strong>{' '}
                      / {phase1Result.total}
                    </span>
                  </div>
                  {phase1Result.failed > 0 && (
                    <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
                      <XCircle className="h-4 w-4 stroke-[1.75]" />
                      <span>FAIL: {phase1Result.failed}</span>
                    </div>
                  )}
                  <span className="text-[#697586] dark:text-[#929BA9] font-mono-numbers">
                    DB: {phase1Result.databaseUsed} ({phase1Result.durationMs}ms)
                  </span>
                </div>
              ) : (
                <span className="text-[#697586] dark:text-[#929BA9]">
                  {tr(
                    'Status: BELUM DIJALANKAN — Klik tombol di samping untuk menjalankan AT-01 s/d AT-17 pada database uji terisolasi (tradevault_idb_test).',
                    'Status: NOT RUN — Click the button to run AT-01..AT-17 on the isolated test database (tradevault_idb_test).'
                  )}
                </span>
              )}

              <button
                onClick={handleRunPhase1StorageTests}
                disabled={isRunningPhase1}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#1769E8] hover:bg-[#1458C4] disabled:opacity-50 text-white font-bold text-xs transition-colors"
              >
                <RotateCcw
                  className={`h-3.5 w-3.5 stroke-[1.75] ${isRunningPhase1 ? 'animate-spin' : ''}`}
                />
                <span>
                  {isRunningPhase1
                    ? tr('Menjalankan AT-01..AT-17...', 'Running AT-01..AT-17...')
                    : phase1Result
                    ? tr('Jalankan Ulang AT-01..AT-17', 'Re-run AT-01..AT-17')
                    : tr('Jalankan Uji Isolasi Phase 1', 'Run Phase 1 Isolation Test')}
                </span>
              </button>
            </div>

            {phase1Result && (
              <div className="pt-2 border-t border-[#DDE3EA] dark:border-[#252B34] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono-numbers text-[#697586] dark:text-[#929BA9]">
                <span>
                  AT-17 localStorage Keys: {phase1Result.localStorageKeyCountBefore} →{' '}
                  {phase1Result.localStorageKeyCountAfter} (
                  {phase1Result.isLocalStorageUnchanged ? 'IDENTICAL' : 'CHANGED'})
                </span>
                <span>
                  SHA-256: {phase1Result.localStorageDigestBefore.slice(0, 12)}... ==={' '}
                  {phase1Result.localStorageDigestAfter.slice(0, 12)}...
                </span>
              </div>
            )}
          </div>
        )}

        {/* Category Filters */}
        {currentSuite && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-2 text-xs">
            <button
              onClick={() => setFilterCategory('ALL')}
              className={`px-2.5 py-1 rounded-lg border transition-colors shrink-0 ${
                filterCategory === 'ALL'
                  ? 'bg-[#1769E8] text-white border-[#1769E8] font-semibold'
                  : 'bg-[#F5F7FA] dark:bg-[#080A0E] text-[#697586] dark:text-[#929BA9] border-[#DDE3EA] dark:border-[#252B34]'
              }`}
            >
              {tr('Semua', 'All')} ({currentSuite.total})
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setFilterCategory(cat)}
                className={`px-2.5 py-1 rounded-lg border transition-colors shrink-0 ${
                  filterCategory === cat
                    ? 'bg-[#1769E8] text-white border-[#1769E8] font-semibold'
                    : 'bg-[#F5F7FA] dark:bg-[#080A0E] text-[#697586] dark:text-[#929BA9] border-[#DDE3EA] dark:border-[#252B34]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {/* Assertion List */}
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 mt-2">
          {filteredResults.map((item, i) => (
            <div
              key={i}
              className="flex items-center justify-between p-2.5 rounded-lg border bg-[#F5F7FA] dark:bg-[#080A0E] border-[#DDE3EA] dark:border-[#252B34] text-xs font-mono-numbers transition-colors"
            >
              <div className="flex items-center gap-2.5 pr-2">
                {item.passed ? (
                  <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 stroke-[1.75]" />
                ) : (
                  <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 stroke-[1.75]" />
                )}
                <div>
                  <span className="font-semibold text-[#151D2A] dark:text-[#F2F5F9]">
                    {item.name}
                  </span>
                  <span className="text-[10px] text-[#697586] dark:text-[#929BA9] block font-sans">
                    {item.category}
                    {item.details ? ` — ${item.details}` : ''}
                  </span>
                </div>
              </div>

              <div className="text-right shrink-0 max-w-[55%]">
                <span
                  className={`font-bold ${
                    item.passed
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {item.passed ? 'PASS' : `FAIL (expected: ${String(item.expected)})`}
                </span>
                {!item.passed && item.actual !== null && typeof item.actual === 'object' && (
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/5 dark:bg-white/5 p-2 text-left text-[10px] leading-relaxed font-mono">
                    {JSON.stringify(item.actual, null, 2)}
                  </pre>
                )}
                {!item.passed && (item.actual === null || typeof item.actual !== 'object') && (
                  <div className="mt-1 whitespace-pre-wrap break-words text-[10px] text-rose-600 dark:text-rose-400">
                    Actual: {String(item.actual)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-4 pt-3 border-t border-[#DDE3EA] dark:border-[#252B34] flex items-center justify-between text-xs">
          <span className="text-[#697586] dark:text-[#929BA9]">
            {tr(
              'Jaminan: Isolasi fixture sintetis & database uji (tradevault_idb_test). Data localStorage riil Anda 100% aman dan tidak tersentuh.',
              'Guarantee: Synthetic fixture & test DB isolation (tradevault_idb_test). Your real localStorage data is 100% safe and untouched.'
            )}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#EEF2F6] dark:bg-[#171D26] border border-[#DDE3EA] dark:border-[#252B34] text-[#151D2A] dark:text-[#F2F5F9] hover:bg-[#DDE3EA] dark:hover:bg-[#252B34]"
          >
            {tr('Tutup', 'Close')}
          </button>
        </div>
      </div>
    </div>
  );
};
