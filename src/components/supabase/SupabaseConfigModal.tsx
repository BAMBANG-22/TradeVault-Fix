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
  Database,
  Key,
  Globe,
  Copy,
  Check,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  ShieldAlert,
  Terminal,
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
          'Harap masukkan Project URL dan Anon Key terlebih dahulu.',
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
          'Project URL dan Anon Key tidak boleh kosong.',
          'Project URL and Anon Key cannot be empty.'
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
          message: tr(
            'Gagal menyalin skrip SQL ke clipboard perangkat.',
            'Failed to copy SQL script to device clipboard.'
          ),
        });
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[#DDE3EA] dark:border-[#252B34] bg-white dark:bg-[#11151B] p-5 sm:p-6 shadow-2xl text-[#151D2A] dark:text-[#F2F5F9]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#DDE3EA] dark:border-[#252B34]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#EEF2F6] dark:bg-[#171D26] text-[#697586] dark:text-[#929BA9] border border-[#DDE3EA] dark:border-[#252B34]">
              <Database className="h-5 w-5 stroke-[1.75]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#151D2A] dark:text-[#F2F5F9]">
                {tr('Pengaturan Database Supabase', 'Supabase Database Settings')}
              </h3>
              <p className="text-xs text-[#697586] dark:text-[#929BA9]">
                {tr(
                  'Hubungkan jurnal ke database cloud PostgreSQL dengan autentikasi & Keamanan Baris (RLS)',
                  'Connect journal to PostgreSQL cloud database with authentication & Row Level Security'
                )}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-[#EEF2F6] hover:bg-[#DDE3EA] text-[#697586] hover:text-[#151D2A] dark:bg-[#171D26] dark:text-[#929BA9] dark:hover:text-[#F2F5F9]"
            aria-label={tr('Tutup pengaturan database Supabase', 'Close Supabase database settings')}
          >
            <X className="h-5 w-5 stroke-[1.75]" />
          </button>
        </div>

        {/* Step Guide Tabs */}
        <div className="my-4 p-4 rounded-xl bg-[#F5F7FA] dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#252B34] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#151D2A] dark:text-[#F2F5F9] flex items-center gap-1.5">
              <Terminal className="h-4 w-4 stroke-[1.75] text-[#697586] dark:text-[#929BA9]" />
              {tr('Panduan Langkah di Dashboard Supabase', 'Step-by-Step Guide in Supabase Dashboard')}
            </span>
            <a
              href="https://supabase.com/dashboard"
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-[#1769E8] dark:text-[#60A5FA] hover:underline flex items-center gap-1 font-medium"
            >
              <span>{tr('Buka Supabase', 'Open Supabase')}</span>
              <ExternalLink className="h-3 w-3 stroke-[1.75]" />
            </a>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div className="p-2.5 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] space-y-1">
              <span className="font-bold text-[#151D2A] dark:text-[#F2F5F9] block">
                {tr('1. Buat Proyek', '1. Create Project')}
              </span>
              <p className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                {tr(
                  'Daftar/masuk di Supabase, klik Proyek Baru, beri nama tradevault.',
                  'Sign up/sign in to Supabase, click New Project, and name it tradevault.'
                )}
              </p>
            </div>

            <div className="p-2.5 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] space-y-1">
              <span className="font-bold text-[#151D2A] dark:text-[#F2F5F9] block">
                {tr('2. Jalankan SQL', '2. Run SQL')}
              </span>
              <p className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                {tr(
                  'Buka tab SQL Editor, tempel skrip SQL kami, lalu klik Jalankan (Run).',
                  'Open the SQL Editor tab, paste our SQL script, and click Run.'
                )}
              </p>
            </div>

            <div className="p-2.5 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] space-y-1">
              <span className="font-bold text-[#151D2A] dark:text-[#F2F5F9] block">
                {tr('3. Salin Kunci API', '3. Copy API Keys')}
              </span>
              <p className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                {tr(
                  'Buka Pengaturan Proyek > API, salin Project URL & kunci publik anon.',
                  'Open Project Settings > API, copy the Project URL & anon public key.'
                )}
              </p>
            </div>
          </div>

          {/* SQL Copy Button */}
          <div className="pt-2 flex items-center justify-between">
            <span className="text-[11px] text-[#697586] dark:text-[#929BA9]">
              {tr(
                'Skrip SQL mencakup tabel trades, user_settings, bucket storage, & kebijakan RLS.',
                'SQL script includes trades table, user_settings, storage bucket, & RLS policies.'
              )}
            </span>
            <button
              onClick={handleCopySql}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#EEF2F6] hover:bg-[#DDE3EA] border border-[#DDE3EA] dark:bg-[#171D26] dark:hover:bg-[#252B34] dark:border-[#252B34] text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] transition-colors shrink-0"
            >
              {copiedSql ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 stroke-[1.75]" />
                  <span className="text-emerald-600 dark:text-emerald-400">
                    {tr('Tersalin!', 'Copied!')}
                  </span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-[#1769E8] dark:text-[#60A5FA] stroke-[1.75]" />
                  <span>{tr('Salin Skrip SQL', 'Copy SQL Script')}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Security Warning Notice */}
        <div className="mb-4 p-3 rounded-xl bg-[#F5F7FA] dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#252B34] text-xs text-[#697586] dark:text-[#929BA9] flex items-start gap-2.5">
          <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5 stroke-[1.75]" />
          <div className="leading-relaxed">
            <strong className="text-amber-600 dark:text-amber-400">
              {tr('Keamanan Kredensial:', 'Credential Security:')}
            </strong>{' '}
            {tr(
              'Hanya gunakan Project URL dan Kunci Publik Anon. Jangan pernah memasukkan kunci rahasia service_role di browser!',
              'Only use the Project URL and Anon Public Key. Never enter the service_role secret key in the browser!'
            )}
          </div>
        </div>

        {/* Form Inputs */}
        <div className="space-y-4 text-xs">
          <div>
            <label className="block text-[#151D2A] dark:text-[#F2F5F9] font-semibold mb-1 flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5 text-[#697586] dark:text-[#929BA9] stroke-[1.75]" />
              <span>Project URL</span>
            </label>
            <input
              type="text"
              placeholder="https://xyzcompany.supabase.co"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={() => {
                if (url.trim()) {
                  setUrl(sanitizeSupabaseUrl(url));
                }
              }}
              className="w-full rounded-lg bg-[#F5F7FA] dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#252B34] px-3 py-2 font-mono-numbers text-[#151D2A] dark:text-[#F2F5F9] placeholder-[#697586] dark:placeholder-[#929BA9] focus:border-[#1769E8] focus:outline-none"
            />
            <p className="text-[11px] text-[#697586] dark:text-[#929BA9] mt-1">
              {tr(
                'Gunakan domain dasar proyek (misal https://xxxx.supabase.co). Jangan menambahkan /auth/v1 atau path lain.',
                'Use the base project domain (e.g. https://xxxx.supabase.co). Do not append /auth/v1 or other paths.'
              )}
            </p>
          </div>

          <div>
            <label className="block text-[#151D2A] dark:text-[#F2F5F9] font-semibold mb-1 flex items-center gap-1.5">
              <Key className="h-3.5 w-3.5 text-[#697586] dark:text-[#929BA9] stroke-[1.75]" />
              <span>{tr('Kunci API Publik Anon', 'Anon Public API Key')}</span>
            </label>
            <textarea
              rows={2}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              value={anonKey}
              onChange={(e) => setAnonKey(e.target.value)}
              className="w-full rounded-lg bg-[#F5F7FA] dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#252B34] px-3 py-2 font-mono-numbers text-[#151D2A] dark:text-[#F2F5F9] placeholder-[#697586] dark:placeholder-[#929BA9] focus:border-[#1769E8] focus:outline-none"
            />
          </div>

          {/* Test Status Feedback */}
          {testResult && (
            <div
              className={`p-3 rounded-xl border bg-[#F5F7FA] dark:bg-[#080A0E] border-[#DDE3EA] dark:border-[#252B34] text-xs flex items-center gap-2 ${
                testResult.success
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400 stroke-[1.75]" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400 stroke-[1.75]" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}

          {/* Inline Confirmation Banner */}
          {pendingConfirm && (
            <div className="p-3.5 rounded-xl border border-[#DDE3EA] dark:border-[#252B34] bg-[#F5F7FA] dark:bg-[#080A0E] text-xs text-[#151D2A] dark:text-[#F2F5F9] space-y-2.5 animate-in fade-in duration-150">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5 stroke-[1.75]" />
                <span>
                  {pendingConfirm === 'save_unusual_url'
                    ? tr(
                        'Format URL biasanya seperti https://xxxx.supabase.co. Apakah Anda yakin ingin tetap menyimpan konfigurasi ini?',
                        'URL format is usually like https://xxxx.supabase.co. Are you sure you want to save this configuration anyway?'
                      )
                    : tr(
                        'Hapus konfigurasi Supabase dan kembali ke penyimpanan lokal browser?',
                        'Clear Supabase configuration and revert to local browser storage?'
                      )}
                </span>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingConfirm(null)}
                  className="px-3 py-1.5 rounded-lg bg-[#EEF2F6] hover:bg-[#DDE3EA] dark:bg-[#171D26] border border-[#DDE3EA] dark:border-[#252B34] text-[#151D2A] dark:text-[#F2F5F9] font-semibold transition-colors"
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
                  className={`px-3 py-1.5 rounded-lg font-bold transition-colors ${
                    pendingConfirm === 'clear_credentials'
                      ? 'bg-rose-600 hover:bg-rose-500 text-white'
                      : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                  }`}
                >
                  {pendingConfirm === 'save_unusual_url'
                    ? tr('Tetap Simpan', 'Save Anyway')
                    : tr('Ya, Hapus Kredensial', 'Yes, Clear Credentials')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-[#DDE3EA] dark:border-[#252B34]">
          <button
            type="button"
            onClick={handleClear}
            className="text-xs text-rose-600 dark:text-rose-400 hover:underline"
          >
            {tr('Hapus Kredensial Cloud', 'Clear Cloud Credentials')}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isTesting}
              onClick={handleTestConnection}
              className="px-3.5 py-2 rounded-lg bg-[#EEF2F6] hover:bg-[#DDE3EA] dark:bg-[#171D26] border border-[#DDE3EA] dark:border-[#252B34] text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] transition-colors"
            >
              {isTesting ? tr('Menguji...', 'Testing...') : tr('Uji Koneksi', 'Test Connection')}
            </button>

            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 rounded-lg bg-[#1769E8] hover:bg-[#1458C4] text-white text-xs font-bold transition-colors"
            >
              {tr('Simpan & Aktifkan', 'Save & Activate')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
