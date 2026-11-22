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
  CheckCircle2,
  XCircle,
  Calculator,
  RotateCcw,
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 dark:bg-black/75 p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr('Audit Rumus Finansial', 'Financial Formula Audit')}
        className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] shadow-[0_20px_50px_-12px_rgba(15,23,42,0.22)] dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)] overflow-hidden text-[#0F172A] dark:text-[#F2F4F7]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-lg bg-[#FAFAFA] dark:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-center text-[#526071] dark:text-[#929BA9] shrink-0">
              <Calculator className="h-4 w-4 stroke-[1.75]" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                {tr('Audit Rumus Finansial', 'Financial Formula Audit')}
              </h3>
              <p className="text-[11px] text-[#526071] dark:text-[#929BA9] mt-0.5">
                {tr(
                  'Verifikasi kalkulasi metrik dan isolasi penyimpanan lokal',
                  'Verify metric calculations and local storage isolation'
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-full text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
            aria-label={tr('Tutup modal audit finansial', 'Close financial audit modal')}
          >
            <X className="h-4 w-4 stroke-[1.75]" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex-1 overflow-hidden flex flex-col gap-3.5">
          {/* Segmented Mode Switcher */}
          <div className="grid grid-cols-2 gap-1 p-1 rounded-full bg-[#F4F4F5] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] shrink-0">
            <button
              type="button"
              onClick={() => {
                setActiveTab('FINANCIAL');
                setFilterCategory('ALL');
              }}
              className={`min-h-[34px] py-1.5 px-3 rounded-full text-xs transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                activeTab === 'FINANCIAL'
                  ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#0F172A] font-semibold'
                  : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] font-medium'
              }`}
            >
              {tr('Rumus Finansial', 'Financial Formulas')}
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('PHASE1_STORAGE');
                setFilterCategory('ALL');
              }}
              className={`min-h-[34px] py-1.5 px-3 rounded-full text-xs transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                activeTab === 'PHASE1_STORAGE'
                  ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#0F172A] font-semibold'
                  : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] font-medium'
              }`}
            >
              {tr('Isolasi IndexedDB (AT-01..17)', 'IndexedDB Isolation (AT-01..17)')}
            </button>
          </div>

          {/* Status Bar: Financial */}
          {activeTab === 'FINANCIAL' && suiteResult && (
            <div className="p-3.5 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
              <div className="flex flex-wrap items-center gap-4 font-mono-numbers tabular-nums">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-[#059669] dark:text-[#00A878] stroke-[1.75]" />
                  <span className="text-[#526071] dark:text-[#929BA9]">
                    {tr('Lulus:', 'Passed:')}{' '}
                    <strong className="text-[#059669] dark:text-[#00A878]">
                      {suiteResult.passed}/{suiteResult.total}
                    </strong>
                  </span>
                </div>
                {suiteResult.failed > 0 && (
                  <div className="flex items-center gap-1.5 text-[#E11D48] dark:text-[#E05260]">
                    <XCircle className="h-4 w-4 stroke-[1.75]" />
                    <strong>
                      {tr('Gagal:', 'Failed:')} {suiteResult.failed}
                    </strong>
                  </div>
                )}
                <span className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                  {suiteResult.durationMs}ms
                </span>
              </div>

              <button
                type="button"
                onClick={handleRerunFinancial}
                className="min-h-[34px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] text-xs font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
              >
                <RotateCcw className="h-3.5 w-3.5 stroke-[1.75]" />
                <span>{tr('Uji Ulang', 'Re-run')}</span>
              </button>
            </div>
          )}

          {/* Status Bar: Phase 1 Storage */}
          {activeTab === 'PHASE1_STORAGE' && (
            <div className="p-3.5 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] space-y-2 text-xs shrink-0">
              <div className="flex flex-wrap items-center justify-between gap-3">
                {phase1Result ? (
                  <div className="flex flex-wrap items-center gap-4 font-mono-numbers tabular-nums">
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 text-[#059669] dark:text-[#00A878] stroke-[1.75]" />
                      <span className="text-[#526071] dark:text-[#929BA9]">
                        {tr('Lulus:', 'Passed:')}{' '}
                        <strong className="text-[#059669] dark:text-[#00A878]">
                          {phase1Result.passed}/{phase1Result.total}
                        </strong>
                      </span>
                    </div>
                    {phase1Result.failed > 0 && (
                      <div className="flex items-center gap-1.5 text-[#E11D48] dark:text-[#E05260]">
                        <XCircle className="h-4 w-4 stroke-[1.75]" />
                        <strong>FAIL: {phase1Result.failed}</strong>
                      </div>
                    )}
                    <span className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                      {phase1Result.databaseUsed} · {phase1Result.durationMs}ms
                    </span>
                  </div>
                ) : (
                  <span className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                    {tr(
                      'Belum dijalankan · Uji database terisolasi (tradevault_idb_test)',
                      'Not run yet · Isolated test database (tradevault_idb_test)'
                    )}
                  </span>
                )}

                <button
                  type="button"
                  onClick={handleRunPhase1StorageTests}
                  disabled={isRunningPhase1}
                  className="min-h-[34px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] disabled:opacity-50 text-xs font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                >
                  <RotateCcw
                    className={`h-3.5 w-3.5 stroke-[1.75] ${isRunningPhase1 ? 'animate-spin' : ''}`}
                  />
                  <span>
                    {isRunningPhase1
                      ? tr('Menjalankan...', 'Running...')
                      : phase1Result
                      ? tr('Uji Ulang', 'Re-run')
                      : tr('Jalankan Uji', 'Run Tests')}
                  </span>
                </button>
              </div>

              {phase1Result && (
                <div className="pt-2 border-t border-[#E4E4E7] dark:border-[#20252D] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                  <span>
                    localStorage Keys: {phase1Result.localStorageKeyCountBefore} →{' '}
                    {phase1Result.localStorageKeyCountAfter} (
                    {phase1Result.isLocalStorageUnchanged ? 'UNCHANGED' : 'CHANGED'})
                  </span>
                  <span>
                    SHA-256: {phase1Result.localStorageDigestBefore.slice(0, 10)}…
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Category Filters */}
          {currentSuite && categories.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] shrink-0">
              <button
                type="button"
                onClick={() => setFilterCategory('ALL')}
                className={`px-3 py-1 rounded-full border transition-colors shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                  filterCategory === 'ALL'
                    ? 'bg-[#0F172A] text-white border-[#0F172A] dark:bg-white dark:text-[#0F172A] dark:border-white font-semibold'
                    : 'bg-[#FAFAFA] dark:bg-[#0B0E13] text-[#526071] dark:text-[#929BA9] border-[#E4E4E7] dark:border-[#20252D] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                }`}
              >
                {tr('Semua', 'All')} ({currentSuite.total})
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setFilterCategory(cat)}
                  className={`px-3 py-1 rounded-full border transition-colors shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                    filterCategory === cat
                      ? 'bg-[#0F172A] text-white border-[#0F172A] dark:bg-white dark:text-[#0F172A] dark:border-white font-semibold'
                      : 'bg-[#FAFAFA] dark:bg-[#0B0E13] text-[#526071] dark:text-[#929BA9] border-[#E4E4E7] dark:border-[#20252D] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}

          {/* Assertion List */}
          <div className="flex-1 overflow-y-auto rounded-xl border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#0B0E13] divide-y divide-[#E4E4E7] dark:divide-[#20252D]">
            {filteredResults.map((item, i) => (
              <div
                key={i}
                className="px-3.5 py-2.5 flex items-start justify-between gap-3 text-xs"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  {item.passed ? (
                    <CheckCircle2 className="h-4 w-4 text-[#059669] dark:text-[#00A878] shrink-0 mt-0.5 stroke-[1.75]" />
                  ) : (
                    <XCircle className="h-4 w-4 text-[#E11D48] dark:text-[#E05260] shrink-0 mt-0.5 stroke-[1.75]" />
                  )}
                  <div className="min-w-0">
                    <span className="font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                      {item.name}
                    </span>
                    <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5">
                      {item.category}
                      {item.details ? ` · ${item.details}` : ''}
                    </span>
                  </div>
                </div>

                <div className="text-right shrink-0 max-w-[45%]">
                  <span
                    className={`text-[11px] font-bold font-mono-numbers tabular-nums ${
                      item.passed
                        ? 'text-[#059669] dark:text-[#00A878]'
                        : 'text-[#E11D48] dark:text-[#E05260]'
                    }`}
                  >
                    {item.passed ? 'PASS' : `FAIL (${String(item.expected)})`}
                  </span>
                  {!item.passed && item.actual !== null && typeof item.actual === 'object' && (
                    <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] p-2 text-left text-[10px] font-mono-numbers">
                      {JSON.stringify(item.actual, null, 2)}
                    </pre>
                  )}
                  {!item.passed && (item.actual === null || typeof item.actual !== 'object') && (
                    <div className="mt-0.5 text-[10px] text-[#E11D48] dark:text-[#E05260] font-mono-numbers break-words">
                      Actual: {String(item.actual)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#0B0E13]/60 flex items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] text-[#526071] dark:text-[#929BA9]">
            {tr(
              'Uji berjalan pada data sintetis — jurnal asli tetap aman.',
              'Runs on synthetic test fixtures — real journal stays untouched.'
            )}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[38px] px-4 py-2 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] hover:bg-[#F4F4F5] dark:bg-[#161A22] dark:hover:bg-[#1E2430] text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
          >
            {tr('Tutup', 'Close')}
          </button>
        </div>
      </div>
    </div>
  );
};
