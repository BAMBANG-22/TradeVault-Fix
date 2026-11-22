import React, { useState, useEffect } from 'react';
import {
  getSupabaseConfig,
  saveSupabaseConfig,
  clearSupabaseConfig,
  testSupabaseConnection,
  sanitizeSupabaseUrl,
} from '../../utils/supabaseClient';
import { SUPABASE_SCHEMA_SQL } from '../../utils/supabaseSchemaSql';
import {
  X,
  Cloud,
  Copy,
  Check,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  ShieldAlert,
} from 'lucide-react';
import { useLanguage } from '../../utils/language';

interface SupabaseConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigSaved: () => void;
}

export const SupabaseConfigModal: React.FC<SupabaseConfigModalProps> = ({
  isOpen,
  onClose,
  onConfigSaved,
}) => {
  const { tr } = useLanguage();
  const [url, setUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    hasTables?: boolean;
  } | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<
    'save_unusual_url' | 'clear_credentials' | null
  >(null);

  useEffect(() => {
    if (isOpen) {
      const cfg = getSupabaseConfig();
      setUrl(cfg.url);
      setAnonKey(cfg.anonKey);
      setTestResult(null);
      setPendingConfirm(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || isTesting) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pendingConfirm) {
          setPendingConfirm(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isTesting, pendingConfirm, onClose]);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    const cleanUrl = sanitizeSupabaseUrl(url);
    const cleanKey = anonKey.trim();

    if (!cleanUrl || !cleanKey) {
      setTestResult({
        success: false,
        message: tr(
          'Masukkan Project URL dan Anon Key terlebih dahulu.',
          'Please enter Project URL and Anon Key first.'
        ),
      });
      return;
    }

    setUrl(cleanUrl);
    saveSupabaseConfig(cleanUrl, cleanKey);
    setIsTesting(true);
    setTestResult(null);
    setPendingConfirm(null);

    const res = await testSupabaseConnection();
    setIsTesting(false);
    setTestResult(res);
  };

  const commitSaveConfig = (cleanUrl: string, cleanKey: string) => {
    setUrl(cleanUrl);
    setPendingConfirm(null);
    saveSupabaseConfig(cleanUrl, cleanKey);
    onConfigSaved();
    onClose();
  };

  const handleSave = () => {
    const cleanUrl = sanitizeSupabaseUrl(url);
    const cleanKey = anonKey.trim();

    if (!cleanUrl || !cleanKey) {
      setTestResult({
        success: false,
        message: tr(
          'Project URL dan Anon Key wajib diisi.',
          'Project URL and Anon Key are required.'
        ),
      });
      return;
    }

    if (!cleanUrl.startsWith('https://') || !cleanUrl.includes('.supabase.co')) {
      setPendingConfirm('save_unusual_url');
      return;
    }

    commitSaveConfig(cleanUrl, cleanKey);
  };

  const handleClear = () => {
    setPendingConfirm('clear_credentials');
  };

  const confirmClearCredentials = () => {
    clearSupabaseConfig();
    setUrl('');
    setAnonKey('');
    setTestResult(null);
    setPendingConfirm(null);
    onConfigSaved();
  };

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(SUPABASE_SCHEMA_SQL);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 2500);
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = SUPABASE_SCHEMA_SQL;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        setCopiedSql(true);
        setTimeout(() => setCopiedSql(false), 2500);
      } catch {
        setTestResult({
          success: false,
          message: tr('Gagal menyalin skrip SQL.', 'Failed to copy SQL script.'),
        });
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 dark:bg-black/75 p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr('Konfigurasi Cloud Supabase', 'Supabase Cloud Configuration')}
        className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] shadow-[0_20px_50px_-12px_rgba(15,23,42,0.22)] dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)] overflow-hidden text-[#0F172A] dark:text-[#F2F4F7]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-lg bg-[#FAFAFA] dark:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-center text-[#526071] dark:text-[#929BA9] shrink-0">
              <Cloud className="h-4 w-4 stroke-[1.75]" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                {tr('Konfigurasi Cloud Supabase', 'Supabase Cloud Configuration')}
              </h3>
              <p className="text-[11px] text-[#526071] dark:text-[#929BA9] mt-0.5">
                {tr(
                  'Hubungkan database cloud pribadi dengan keamanan RLS',
                  'Connect your personal cloud database with RLS protection'
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-full text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
            aria-label={tr('Tutup konfigurasi Supabase', 'Close Supabase configuration')}
          >
            <X className="h-4 w-4 stroke-[1.75]" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Quick Setup Strip — Flat Divided Columns */}
          <div className="rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] divide-y divide-[#E4E4E7] dark:divide-[#20252D]">
            <div className="px-3.5 py-2.5 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                {tr('Langkah Setup Cepat', 'Quick Setup Steps')}
              </span>
              <a
                href="https://supabase.com/dashboard"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0F172A] dark:text-white hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
              >
                <span>{tr('Buka Dashboard', 'Open Dashboard')}</span>
                <ExternalLink className="h-3 w-3 stroke-[1.75]" />
              </a>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[#E4E4E7] dark:divide-[#20252D] text-[11px]">
              <div className="px-3.5 py-2.5">
                <span className="font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                  {tr('1. Buat Proyek', '1. Create Project')}
                </span>
                <span className="text-[#526071] dark:text-[#929BA9] block mt-0.5">
                  {tr('Proyek baru di Supabase', 'New project in Supabase')}
                </span>
              </div>

              <div className="px-3.5 py-2.5">
                <span className="font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                  {tr('2. Jalankan SQL', '2. Run SQL')}
                </span>
                <span className="text-[#526071] dark:text-[#929BA9] block mt-0.5">
                  {tr('Tempel & Run di SQL Editor', 'Paste & Run in SQL Editor')}
                </span>
              </div>

              <div className="px-3.5 py-2.5">
                <span className="font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                  {tr('3. Salin API Key', '3. Copy API Key')}
                </span>
                <span className="text-[#526071] dark:text-[#929BA9] block mt-0.5">
                  {tr('Project Settings → API', 'Project Settings → API')}
                </span>
              </div>
            </div>

            <div className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                {tr('Tabel trades, user_settings, storage & RLS', 'Tables, storage bucket & RLS policies')}
              </span>
              <button
                type="button"
                onClick={handleCopySql}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] text-[11px] font-semibold text-[#0F172A] dark:text-[#F2F4F7] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
              >
                {copiedSql ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-[#059669] dark:text-[#00A878] stroke-[1.75]" />
                    <span className="text-[#059669] dark:text-[#00A878]">{tr('Tersalin', 'Copied')}</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 text-[#0F172A] dark:text-white stroke-[1.75]" />
                    <span>{tr('Salin Skrip SQL', 'Copy SQL Script')}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Credentials Form */}
          <div className="space-y-3 text-xs">
            <div>
              <label className="block font-semibold text-[#0F172A] dark:text-[#F2F4F7] mb-1.5">
                Project URL
              </label>
              <input
                type="text"
                placeholder="https://xxxx.supabase.co"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onBlur={() => {
                  if (url.trim()) {
                    setUrl(sanitizeSupabaseUrl(url));
                  }
                }}
                className="w-full min-h-[40px] rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3 py-2 font-mono-numbers text-[#0F172A] dark:text-[#F2F4F7] placeholder-[#929BA9] focus:border-[#0F172A] dark:focus:border-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/25 dark:focus-visible:ring-white/25"
              />
              <p className="text-[11px] text-[#526071] dark:text-[#929BA9] mt-1">
                {tr(
                  'Domain dasar proyek tanpa /auth/v1 atau path tambahan.',
                  'Base project domain without /auth/v1 or extra paths.'
                )}
              </p>
            </div>

            <div>
              <label className="block font-semibold text-[#0F172A] dark:text-[#F2F4F7] mb-1.5">
                {tr('Anon Public Key', 'Anon Public Key')}
              </label>
              <textarea
                rows={2}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                value={anonKey}
                onChange={(e) => setAnonKey(e.target.value)}
                className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3 py-2 font-mono-numbers text-[#0F172A] dark:text-[#F2F4F7] placeholder-[#929BA9] focus:border-[#0F172A] dark:focus:border-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/25 dark:focus-visible:ring-white/25"
              />
            </div>
          </div>

          {/* Security Note */}
          <div className="p-3 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] flex items-start gap-2.5 text-[11px] text-[#526071] dark:text-[#929BA9]">
            <ShieldAlert className="h-4 w-4 text-[#D97706] dark:text-[#F59E0B] shrink-0 mt-0.5 stroke-[1.75]" />
            <span>
              {tr(
                'Hanya gunakan Public Anon Key. Jangan masukkan kunci service_role di browser.',
                'Use the Public Anon Key only. Never enter service_role keys in the browser.'
              )}
            </span>
          </div>

          {/* Test Status */}
          {testResult && (
            <div
              className={`p-3 rounded-xl border bg-[#FAFAFA] dark:bg-[#0B0E13] border-[#E4E4E7] dark:border-[#20252D] text-xs flex items-center gap-2 ${
                testResult.success
                  ? 'text-[#059669] dark:text-[#00A878]'
                  : 'text-[#E11D48] dark:text-[#E05260]'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 stroke-[1.75]" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0 stroke-[1.75]" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}

          {/* Inline Confirmation */}
          {pendingConfirm && (
            <div className="p-3.5 rounded-xl border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#0B0E13] text-xs space-y-2.5 animate-in fade-in duration-150">
              <div className="flex items-start gap-2 text-[#0F172A] dark:text-[#F2F4F7]">
                <AlertTriangle className="h-4 w-4 text-[#D97706] dark:text-[#F59E0B] shrink-0 mt-0.5 stroke-[1.75]" />
                <span className="text-[11px] leading-relaxed">
                  {pendingConfirm === 'save_unusual_url'
                    ? tr(
                        'Format URL berbeda dari standar https://xxxx.supabase.co. Tetap simpan?',
                        'URL format differs from https://xxxx.supabase.co. Save anyway?'
                      )
                    : tr(
                        'Hapus kredensial cloud dan kembali ke penyimpanan lokal?',
                        'Clear cloud credentials and revert to local storage?'
                      )}
                </span>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingConfirm(null)}
                  className="px-3.5 py-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] text-[11px] font-semibold text-[#0F172A] dark:text-[#F2F4F7] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                >
                  {tr('Batal', 'Cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (pendingConfirm === 'save_unusual_url') {
                      commitSaveConfig(sanitizeSupabaseUrl(url), anonKey.trim());
                    } else {
                      confirmClearCredentials();
                    }
                  }}
                  className={`px-3.5 py-1.5 rounded-full text-[11px] font-semibold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                    pendingConfirm === 'clear_credentials'
                      ? 'bg-[#E11D48] hover:bg-[#BE123C] text-white dark:bg-[#E05260] dark:hover:bg-[#E11D48]'
                      : 'bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A]'
                  }`}
                >
                  {pendingConfirm === 'save_unusual_url'
                    ? tr('Tetap Simpan', 'Save Anyway')
                    : tr('Ya, Hapus', 'Yes, Clear')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#0B0E13]/60 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={handleClear}
            className="text-xs font-medium text-[#E11D48] dark:text-[#E05260] hover:underline cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E11D48]/40"
          >
            {tr('Hapus Kredensial', 'Clear Credentials')}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isTesting}
              onClick={handleTestConnection}
              className="min-h-[38px] px-4 py-2 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] hover:bg-[#F4F4F5] dark:bg-[#161A22] dark:hover:bg-[#1E2430] text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] transition-colors disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
            >
              {isTesting ? tr('Menguji...', 'Testing...') : tr('Uji Koneksi', 'Test Connection')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="min-h-[38px] px-4 py-2 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] text-xs font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
            >
              {tr('Simpan & Aktifkan', 'Save & Activate')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
