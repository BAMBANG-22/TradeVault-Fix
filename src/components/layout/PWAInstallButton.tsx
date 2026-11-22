import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Smartphone, WifiOff, CheckCircle2, X } from 'lucide-react';
import { usePWAInstall, useOnlineStatus } from '../../hooks/usePWAInstall';
import { useLanguage } from '../../utils/language';

interface PWAInstallButtonProps {
  variant?: 'settings-row' | 'compact';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'settings-row' }) => {
  const { tr } = useLanguage();
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    if (variant === 'compact') return null;
    return (
      <div className="px-4 py-3.5 flex items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-[#059669] dark:text-[#00A878] stroke-[1.75] mt-0.5" />
          <div className="min-w-0">
            <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
              {tr('Aplikasi Terpasang (PWA)', 'App Installed (PWA)')}
            </span>
            <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5">
              {tr('Berjalan dalam mode aplikasi mandiri dengan cache offline.', 'Running in standalone mode with offline caching active.')}
            </span>
          </div>
        </div>
        <span className="text-[11px] font-semibold text-[#059669] dark:text-[#00A878] shrink-0">
          {tr('Aktif', 'Active')}
        </span>
      </div>
    );
  }

  const handleAction = () => {
    if (isInstallable) {
      void install();
    } else {
      setShowIOSGuide(true);
    }
  };

  if (variant === 'compact') {
    if (!isInstallable && !isIOS) return null;
    return (
      <>
        <button
          type="button"
          onClick={handleAction}
          className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#FAFAFA] dark:hover:bg-[#141922] transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Download className="h-4 w-4 shrink-0 stroke-[1.75]" />
            <span className="text-[13px] font-medium truncate">
              {isIOS ? tr('Pasang di iOS', 'Install on iOS') : tr('Pasang Aplikasi', 'Install App')}
            </span>
          </div>
        </button>
        {showIOSGuide && <InstallGuideModal isIOS={isIOS} onClose={() => setShowIOSGuide(false)} />}
      </>
    );
  }

  return (
    <>
      <div className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <Smartphone className="h-4 w-4 shrink-0 text-[#526071] dark:text-[#929BA9] stroke-[1.75] mt-0.5" />
          <div className="min-w-0">
            <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
              {tr('Instal Aplikasi (PWA Offline)', 'Install App (Offline PWA)')}
            </span>
            <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5">
              {isInstallable
                ? tr(
                    'Pasang VLO ke layar utama untuk akses instan dan dukungan offline.',
                    'Install VLO to your home screen for instant launch and offline support.'
                  )
                : isIOS
                ? tr(
                    'Tambahkan ke Layar Utama Safari iOS agar tampil layar penuh layaknya aplikasi.',
                    'Add to Safari Home Screen on iOS for a full-screen app experience.'
                  )
                : tr(
                    'Dukungan cache offline aktif. Gunakan menu browser "Install / Add to Home Screen".',
                    'Offline cache active. Use browser menu "Install / Add to Home Screen".'
                  )}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleAction}
          className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] text-xs font-semibold transition-colors shrink-0 cursor-pointer"
        >
          <Download className="h-3.5 w-3.5 stroke-[2]" />
          <span>
            {isInstallable
              ? tr('Pasang App', 'Install App')
              : tr('Panduan Pasang', 'Install Guide')}
          </span>
        </button>
      </div>
      {showIOSGuide && <InstallGuideModal isIOS={isIOS} onClose={() => setShowIOSGuide(false)} />}
    </>
  );
};

const InstallGuideModal: React.FC<{ isIOS: boolean; onClose: () => void }> = ({ isIOS, onClose }) => {
  const { tr } = useLanguage();
  const modalNode = (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 dark:bg-black/75 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] p-5 shadow-2xl space-y-4"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[#0F172A] dark:text-[#F2F4F7]">
            {isIOS
              ? tr('Pasang VLO di iPhone / iPad', 'Install VLO on iPhone / iPad')
              : tr('Cara Pasang VLO Journal', 'How to Install VLO Journal')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr('Tutup', 'Close')}
            className="p-1.5 rounded-full text-[#526071] dark:text-[#929BA9] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {isIOS ? (
          <ol className="text-xs text-[#526071] dark:text-[#929BA9] space-y-2 list-decimal list-inside leading-relaxed">
            <li>{tr('Ketuk tombol Bagikan (Share) di bilah bawah Safari.', 'Tap the Share button in the Safari toolbar.')}</li>
            <li>{tr('Gulir ke bawah lalu pilih "Tambahkan ke Layar Utama" (Add to Home Screen).', 'Scroll down and tap "Add to Home Screen".')}</li>
            <li>{tr('Ketuk "Tambah" untuk menyelesaikan pemasangan.', 'Tap "Add" to finish installation.')}</li>
          </ol>
        ) : (
          <ol className="text-xs text-[#526071] dark:text-[#929BA9] space-y-2 list-decimal list-inside leading-relaxed">
            <li>{tr('Buka VLO Journal di tab browser utama (Chrome / Edge / Safari).', 'Open VLO Journal in a main browser tab (Chrome / Edge / Safari).')}</li>
            <li>{tr('Klik ikon Instal di bilah alamat atau buka menu browser → "Install App / Add to Home Screen".', 'Click the Install icon in the address bar or open browser menu → "Install App / Add to Home Screen".')}</li>
          </ol>
        )}
        <button
          type="button"
          onClick={onClose}
          className="w-full py-2 rounded-full bg-[#0F172A] dark:bg-white text-white dark:text-[#0F172A] text-xs font-semibold cursor-pointer"
        >
          {tr('Mengerti', 'Got it')}
        </button>
      </div>
    </div>
  );
  return typeof document !== 'undefined' ? createPortal(modalNode, document.body) : modalNode;
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  const { tr } = useLanguage();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 lg:bottom-5 left-4 z-50 flex items-center gap-2 rounded-full bg-[#0F172A] dark:bg-[#161A22] border border-[#D97706]/50 px-3.5 py-2 text-[11px] font-semibold text-white shadow-lg animate-in fade-in duration-150"
    >
      <WifiOff className="h-3.5 w-3.5 text-[#F59E0B] shrink-0" />
      <span>{tr('Mode Offline — Menggunakan data cache lokal', 'Offline Mode — Using local cached data')}</span>
    </div>
  );
};
