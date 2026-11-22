/**
 * Centralized Application Version & Change Code Registry.
 * Every code release / Git push updates APP_VERSION and assigns a unique APP_CHANGE_CODE.
 */

export interface AppVersionEntry {
  version: string;
  changeCode: string;
  date: string;
  titleId: string;
  titleEn: string;
  summaryId: string;
  summaryEn: string;
}

export const APP_VERSION = '1.3.0';
export const APP_CHANGE_CODE = 'VLO-2611-PRO01';
export const APP_RELEASE_DATE = '2026-11-22';

export const APP_VERSION_HISTORY: AppVersionEntry[] = [
  {
    version: '1.3.0',
    changeCode: 'VLO-2611-PRO01',
    date: '2026-11-22',
    titleId: 'Suite Trader Pro: Behavioral Analytics, Guardrail, Playbook, Review, Export, Multi-Account & PWA',
    titleEn: 'Pro Trader Suite: Behavioral Analytics, Guardrail, Playbook, Review, Export, Multi-Account & PWA',
    summaryId:
      'Penambahan 10 fitur pro tanpa mengubah UI editorial VLO: Cost of Mistakes & tag emosi, Guardrail Risiko & Checklist SOP pra-eksekusi, Review Mingguan/Bulanan, konteks Macro News di detail trade, Export PDF & Shareable PNG Card, Playbook Setup A+, Pintasan Keyboard & Quick Command (Cmd+K), PWA Offline-First, Multi-Akun / Sub-Portofolio, serta pembersihan dependensi tidak terpakai.',
    summaryEn:
      'Added 10 pro trader enhancements while preserving VLO editorial UI: Cost of Mistakes & emotion tagging, Risk Guardrail & Pre-Trade SOP Checklist, Weekly/Monthly Review Ritual, Macro News context in trade detail, PDF Report & Shareable HD PNG Card export, A+ Setup Playbook Library, Keyboard Shortcuts & Quick Command (Cmd+K), Offline-First PWA, Multi-Account / Sub-Portfolios, and unused dependency cleanup.',
  },
  {
    version: '1.2.1',
    changeCode: 'VLO-2611-FLD01',
    date: '2026-11-21',
    titleId: 'Fluiditas UI & Animasi Taktil 60fps',
    titleEn: 'Precision Tactile Fluidity UI & Motion',
    summaryId:
      'Menghidupkan kembali seluruh animasi modal/popover, transisi masuk dialog adaptif (desktop & mobile), transisi tab GPU-composited tanpa unmount state, micro-press klik tombol 60fps, dan editorial skeleton loader.',
    summaryEn:
      'Revived GPU-composited modal/popover enter animations, adaptive dialog entrances, state-preserving tab view transitions, universal 60fps tactile micro-press button feedback, and editorial skeleton placeholders.',
  },
  {
    version: '1.2.0',
    changeCode: 'VLO-2611-SND01',
    date: '2026-11-21',
    titleId: 'Sistem Suara Notifikasi & Tactile Click',
    titleEn: 'Notification Chimes & Tactile Click Sound System',
    summaryId:
      'Menambahkan micro-sound engine berbasis Web Audio API untuk efek klik/sentuhan UI, chime notifikasi/simpan transaksi, peringatan error, getaran haptic, serta pengaturan On/Off di Settings.',
    summaryEn:
      'Added a zero-lag Web Audio API micro-sound engine for tactile UI clicks/taps, trade/notification chimes, error tones, mobile haptic feedback, and dedicated On/Off toggles in Settings.',
  },
  {
    version: '1.1.2',
    changeCode: 'VLO-2611-LGO02',
    date: '2026-11-21',
    titleId: 'Optimasi 60fps Animasi Logo VloMech',
    titleEn: '60fps GPU Optimization for VloMech Logo Motion',
    summaryId:
      'Memindahkan animasi VloMech ke GPU-composited murni (tanpa SVG mask CPU rasterization) serta menunda hidrasi workspace berat hingga animasi Splash selesai.',
    summaryEn:
      'Refactored VloMech to pure GPU-composited transform/opacity keyframes (eliminating CPU SVG mask rasterization) and deferred heavy background workspace hydration until splash assembly completes.',
  },
  {
    version: '1.1.1',
    changeCode: 'VLO-2611-LGO01',
    date: '2026-11-21',
    titleId: 'Animasi Logo Mechanical Orbital Assembly',
    titleEn: 'Mechanical Orbital Assembly Logo Motion',
    summaryId:
      'Mengintegrasikan komponen VloMech untuk animasi logo mekanis-orbital yang lebih fluid pada Splash Screen dan Auth Modal dengan sinkronisasi tema Light & Dark.',
    summaryEn:
      'Integrated the VloMech Mechanical Orbital Assembly motion logo into Splash Screen and Auth Modal with full Light & Dark theme synchronization.',
  },
  {
    version: '1.1.0',
    changeCode: 'VLO-2611-RSK01',
    date: '2026-11-21',
    titleId: 'Penyelarasan Pip/SL Risiko, Mata Uang USD & IDR, & Sistem Kode Versi',
    titleEn: 'Risk Pip/SL Alignment, USD & IDR Currency Mode, & Version Code System',
    summaryId:
      'Menyamakan standar jarak SL XAUUSD Risk Management & Broker Settings dengan standar App (4000 → 3995 = 50 pips, 1 pip = 0.10), menambahkan konversi USD ↔ IDR di seluruh kalkulator & aturan Risiko, serta menambahkan sistem versi + kode perubahan unik.',
    summaryEn:
      'Aligned XAUUSD SL/pip rules across Risk Management and Broker Settings with App standard (4000 → 3995 = 50 pips, 1 pip = 0.10), added live USD ↔ IDR switching across Risk calculators & rules, and introduced version + unique change code tracking.',
  },
  {
    version: '1.0.0',
    changeCode: 'VLO-2611-ELM01',
    date: '2026-11-20',
    titleId: 'Editorial Pure-White Light Mode & Fundamental Gold',
    titleEn: 'Editorial Pure-White Light Mode & Fundamental Gold',
    summaryId:
      'Pembaruan antarmuka Light Mode putih editorial, modul Fundamental Gold, dan penyempurnaan modul Chart & SMC.',
    summaryEn:
      'Editorial pure-white Light Mode surface system, Fundamental Gold narrative workspace, and Chart & SMC refinements.',
  },
];

export function formatAppVersionLabel(includeChangeCode = false): string {
  return includeChangeCode
    ? `v${APP_VERSION} · #${APP_CHANGE_CODE}`
    : `v${APP_VERSION}`;
}
