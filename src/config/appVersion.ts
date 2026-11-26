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

declare const __BUILD_GIT_SHA__: string | undefined;
declare const __BUILD_TIMESTAMP__: string | undefined;
declare const __BUILD_RUN_NUMBER__: string | undefined;
declare const __TESSERACT_VERSION__: string | undefined;
declare const __TESSERACT_CORE_VERSION__: string | undefined;

export const APP_VERSION = '1.5.0';
export const APP_CHANGE_CODE = 'VLO-2611-ALF14';
export const APP_RELEASE_DATE = '2026-11-26';
export const OCR_PIPELINE_VERSION = 'offline-mt5-ocr-v3.2-lossless-png';

export const BUILD_GIT_SHA: string =
  typeof __BUILD_GIT_SHA__ !== 'undefined' && __BUILD_GIT_SHA__ ? __BUILD_GIT_SHA__ : 'dev-local';
export const BUILD_TIMESTAMP: string =
  typeof __BUILD_TIMESTAMP__ !== 'undefined' && __BUILD_TIMESTAMP__
    ? __BUILD_TIMESTAMP__
    : APP_RELEASE_DATE;
export const BUILD_RUN_NUMBER: string =
  typeof __BUILD_RUN_NUMBER__ !== 'undefined' && __BUILD_RUN_NUMBER__
    ? __BUILD_RUN_NUMBER__
    : 'local';
export const OCR_ENGINE_NAME = 'tesseract.js (Local WASM LSTM)';
export const OCR_ENGINE_VERSION: string =
  typeof __TESSERACT_VERSION__ !== 'undefined' && __TESSERACT_VERSION__
    ? `${__TESSERACT_VERSION__} (core ${
        typeof __TESSERACT_CORE_VERSION__ !== 'undefined' && __TESSERACT_CORE_VERSION__
          ? __TESSERACT_CORE_VERSION__
          : '7.0.0'
      })`
    : '7.0.0 (core 7.0.0)';

export interface AppBuildIdentity {
  appVersion: string;
  changeCode: string;
  releaseDate: string;
  gitCommitSha: string;
  buildTimestamp: string;
  ciRunNumber: string;
  ocrEngine: string;
  ocrEngineVersion: string;
  ocrPipelineVersion: string;
}

export function getAppBuildIdentity(): AppBuildIdentity {
  return {
    appVersion: APP_VERSION,
    changeCode: APP_CHANGE_CODE,
    releaseDate: APP_RELEASE_DATE,
    gitCommitSha: BUILD_GIT_SHA,
    buildTimestamp: BUILD_TIMESTAMP,
    ciRunNumber: BUILD_RUN_NUMBER,
    ocrEngine: OCR_ENGINE_NAME,
    ocrEngineVersion: OCR_ENGINE_VERSION,
    ocrPipelineVersion: OCR_PIPELINE_VERSION,
  };
}

export const APP_VERSION_HISTORY: AppVersionEntry[] = [
  {
    version: '1.5.0',
    changeCode: 'VLO-2611-ALF14',
    date: '2026-11-26',
    titleId: 'Asisten Hidup Alfred/Jarvis: Jam Lokal & Tanggal Presisi, Forensik Mikro Jurnal, Pemisahan 3 Modul Pasar & Obrolan Non-Linear',
    titleEn: 'Living Alfred/Jarvis Companion: Exact Local Clock & Date Math, Micro-Forensic Journal Audit, 3-Module Market Separation & Non-Linear Chat',
    summaryId:
      'Menambahkan jam lokal & zona waktu presisi (WIB/WITA/WIT) plus resolver tanggal/periode lintas riwayat chat (anti salah minggu saat chat dini hari & 0% salah hitung total profit), audit mikro setiap trade (Hit TP vs Hit SL vs Manual Close kepagian, Planned RR vs Realized R, rasio RR terbalik, over-risk, tanpa SL, fee drag, disiplin & playbook), pemisahan tegas 3 modul pasar (Berita Trading vs Fundamental Emas vs Siklus & Confluence), deteksi proaktif berita penting tanpa memaksakan narasi news di obrolan jurnal murni, serta penguasaan lengkap struktur & cara pakai seluruh menu TradeVault.',
    summaryEn:
      'Added exact local clock & timezone awareness plus cross-turn conversational date/period resolution (eliminating wrong-week early-morning lookups and profit-sum errors), micro-forensic per-trade auditing (Hit TP vs Hit SL vs early Manual Close, Planned RR vs Realized R, inverted RR, over-risk, missing SL, fee drag, discipline & playbooks), strict separation of the 3 market intelligence modules (Trade News vs Fundamental Gold vs Cycle & Confluence), proactive high-impact news alerts without forcing news into pure journal discussions, and complete app navigation & how-to mastery.',
  },
  {
    version: '1.4.0',
    changeCode: 'VLO-2611-JRN13',
    date: '2026-11-26',
    titleId: 'Kecerdasan Jurnal Mendalam (Selisih Growth Kemarin vs Hari Ini), Penguasaan Fitur App & Anti-Padat APK',
    titleEn: 'Deep Journal Growth Delta Intelligence, Full App Mastery & Zero-Stall APK AI',
    summaryId:
      'Menambahkan perhitungan deterministik selisih growth harian/kemarin vs hari ini (akumulasi & return harian), riwayat 14 hari trading aktif, breakdown strategi, dan pengetahuan lengkap seluruh fitur TradeVault (Compounding, Monte Carlo, Kalkulator Risiko/Lot, Playbook, Dual-Horizon News, Fundamental Gold) lengkap dengan penjelasan adaptif super simpel. Mengalihkan prioritas chat AI ke Gemini Flash-Lite + circuit-breaker HTTP 404 & cooldown 120 dtk agar respons APK cepat (1,5–5 dtk) tanpa pesan "server padat".',
    summaryEn:
      'Added deterministic daily & yesterday-vs-today growth delta math (cumulative delta & daily compounded return), 14-day trading timeline, strategy breakdown, and complete TradeVault feature mastery (Compounding, Monte Carlo, Lot/Risk Calculator, Playbook, Dual-Horizon News, Fundamental Gold) with adaptive plain-language explanations. Switched AI Desk chat priority to Gemini Flash-Lite with HTTP 404 circuit-breaker & 120s provider cooldown for fast 1.5–5s APK replies without "busy server" fallbacks.',
  },
  {
    version: '1.3.9',
    changeCode: 'VLO-2611-SPC12',
    date: '2026-11-26',
    titleId: 'Tanya AI Single-Pass Anti-Timeout, Panggilan Bersih & Bahasa Fallback Manusiawi',
    titleEn: 'Single-Pass Anti-Timeout AI Desk, Clean Nicknames & Humanized Fallback',
    summaryId:
      'Mengupgrade Tanya AI (server lokal & Supabase Edge Function) menjadi Single-Pass Smart Assistant dengan batas waktu global 18,5 dtk, fast circuit-breaker (hemat kuota 3–5×), jalur cepat 7,5 dtk khusus cek harga XAU/USD, pembersih partikel panggilan Indonesia ("Wowo yaa" -> "Wowo"), auto-sync latar belakang khusus harga live tanpa tabrakan AI, serta mesin fallback lokal berbahasa manusiawi sesuai persona.',
    summaryEn:
      'Upgraded Tanya AI (local server & Supabase Edge Function) to a Single-Pass Smart Assistant with an 18.5s global deadline, fast circuit-breaker (3–5x lower quota usage), 7.5s fast-fail live XAU/USD price lane, Indonesian particle cleanup for agent nicknames, zero-AI background price sync, and natural persona-matched local fallback replies.',
  },
  {
    version: '1.3.8',
    changeCode: 'VLO-2611-JRV11',
    date: '2026-11-26',
    titleId: "Asisten Pribadi AI ala Jarvis/Alfred, Live XAUUSD & Memori Offline",
    titleEn: "Asisten Pribadi AI ala Jarvis/Alfred, Live XAUUSD & Memori Offline",
    summaryId: "Menambahkan 4-jalur router cerdas (basa-basi & ganti panggilan nama tanpa bocor data market, penjaga batas ranah, cek harga XAU/USD real-time dari Vela, serta auto-sync latar belakang berita/fundamental/Polymarket), memori jangka panjang offline (maks. 25 catatan + pengelola di menu Tema), serta tombol Akhiri Sesi & Auto-New-Day rollover (sinkron penuh dengan Supabase Edge Function).",
    summaryEn: "Menambahkan 4-jalur router cerdas (basa-basi & ganti panggilan nama tanpa bocor data market, penjaga batas ranah, cek harga XAU/USD real-time dari Vela, serta auto-sync latar belakang berita/fundamental/Polymarket), memori jangka panjang offline (maks. 25 catatan + pengelola di menu Tema), serta tombol Akhiri Sesi & Auto-New-Day rollover (sinkron penuh dengan Supabase Edge Function).",
  },
  {
    version: '1.3.7',
    changeCode: 'VLO-2611-AGT10',
    date: '2026-11-25',
    titleId: 'Multi-Agent News + ACC Boss Gemini, Chat AI Kustom (WA/IG DM) & Developer Console Tersembunyi',
    titleEn: 'Multi-Agent News + Boss Gemini ACC, Customizable AI Messenger & Hidden Developer Console',
    summaryId:
      'Membagi beban analisis Trade News (Groq) & Fundamental Emas (OpenRouter) dengan validasi ACC wajib Boss Gemini; meningkatkan Tanya AI menjadi asisten pribadi ala Jarvis/Alfred dengan 4-jalur router cerdas (basa-basi & panggilan nama tanpa bocor data market, tolak sopan di luar ranah, cek harga XAU/USD real-time dari Vela, dan auto-sync background berita/fundamental/Polymarket), memori jangka panjang offline (hingga 25 fakta), tombol Akhiri Sesi + Auto-New-Day rollover, serta Developer Console tersembunyi (7x tap + kode seri, Cleaning Service, Perekam Error & Analisa AI QA).',
    summaryEn:
      'Distributed Trade News (Groq) & Fundamental Gold (OpenRouter) analysis with mandatory Boss Gemini ACC sign-off; upgraded Tanya AI into a Jarvis/Alfred-style personal assistant featuring a 4-path intent router (zero-leak small talk & nickname detection, polite out-of-scope guard, real-time Vela XAU/USD spot lookup, and background Trade News/Fundamental/Polymarket auto-sync), persistent offline long-term memory (up to 25 items), Akhiri Sesi / Auto-New-Day rollover, and hidden Developer Console (7x tap + serial code, safe Cleaning Service, Error Recorder & AI QA Diagnosis).',
  },
  {
    version: '1.3.6',
    changeCode: 'VLO-2611-APK09',
    date: '2026-11-25',
    titleId: 'Vela Replay Chart, Auto-Fullscreen, APK Cache-Purge Native & Diagnostik Lengkap',
    titleEn: 'Vela Replay Chart, Auto-Fullscreen, Native APK Cache-Purge & Full Diagnostics',
    summaryId:
      'Menghapus Light Chart dan menjadikan Vela Replay (Twelve Data + Binance fallback + Bar Replay + Sesi Kustom + Auto-Fullscreen) sebagai chart kedua, menambahkan pembersihan HTTP cache WebView native saat upgrade APK, proxy fallback Binance/TwelveData, sinkronisasi 3-modul Makro/Fundamental/Cycle, serta panel Diagnostik Sistem APK di Pengaturan.',
    summaryEn:
      'Removed Light Chart in favor of Vela Replay (Twelve Data + Binance proxy fallback + Bar Replay + customizable Sessions + Auto-Fullscreen), added native Android WebView HTTP cache purge on APK upgrade, 3-module Macro/Fundamental/Cycle synchronization, and full APK System Diagnostics in Settings.',
  },
  {
    version: '1.3.5',
    changeCode: 'VLO-2611-AUD08',
    date: '2026-11-24',
    titleId: "Forensic Offline OCR diagnostics, build identity & Android high-res lossless pipeline",
    titleEn: "Forensic Offline OCR diagnostics, build identity & Android high-res lossless pipeline",
    summaryId: "Added deterministic build identity (Git SHA, timestamp, CI run, OCR pipeline version), forensic OCR diagnostics inspector, full legacy Service Worker & OCR CacheStorage purge with forced reload on upgrade, lossless high-res PNG preprocessing for tall Android MT5 screenshots, and restored multi-pass completeness gate.",
    summaryEn: "Added deterministic build identity (Git SHA, timestamp, CI run, OCR pipeline version), forensic OCR diagnostics inspector, full legacy Service Worker & OCR CacheStorage purge with forced reload on upgrade, lossless high-res PNG preprocessing for tall Android MT5 screenshots, and restored multi-pass completeness gate.",
  },
  {
    version: '1.3.4',
    changeCode: 'VLO-2611-SCN07',
    date: '2026-11-24',
    titleId: "Fix APK Offline OCR eng.traineddata tanpa .gz & anti-hang guard",
    titleEn: "Fix APK Offline OCR eng.traineddata tanpa .gz & anti-hang guard",
    summaryId: "Gunakan eng.traineddata tidak terkompresi (gzip: false) agar kompatibel dengan Android AAPT2 serta tambah errorHandler dan timeout guard Tesseract",
    summaryEn: "Gunakan eng.traineddata tidak terkompresi (gzip: false) agar kompatibel dengan Android AAPT2 serta tambah errorHandler dan timeout guard Tesseract",
  },
  {
    version: '1.3.3',
    changeCode: 'VLO-2611-SCN06',
    date: '2026-11-24',
    titleId: "Purge SW cache APK & akselerasi SIMD + Parallel OCR",
    titleEn: "Purge SW cache APK & akselerasi SIMD + Parallel OCR",
    summaryId: "Hapus jebakan cache Service Worker lama di APK, aktifkan WebAssembly SIMD, Blob zero-split, dan eksekusi OCR paralel",
    summaryEn: "Hapus jebakan cache Service Worker lama di APK, aktifkan WebAssembly SIMD, Blob zero-split, dan eksekusi OCR paralel",
  },
  {
    version: '1.3.2',
    changeCode: 'VLO-2611-SCN05',
    date: '2026-11-24',
    titleId: "Optimasi kecepatan Scan APK (Offline & Online)",
    titleEn: "Optimasi kecepatan Scan APK (Offline & Online)",
    summaryId: "Mempercepat OCR Offline 4-5x di HP (2.1MP single-pass early exit, non-IndexedDB worker init) dan mempercepat fallback Online Scan",
    summaryEn: "Mempercepat OCR Offline 4-5x di HP (2.1MP single-pass early exit, non-IndexedDB worker init) dan mempercepat fallback Online Scan",
  },
  {
    version: '1.3.1',
    changeCode: 'VLO-2611-MAC04',
    date: '2026-11-24',
    titleId: "Sinkronisasi Fundamental 3-Fitur & Real-Time Actual APK",
    titleEn: "Sinkronisasi Fundamental 3-Fitur & Real-Time Actual APK",
    summaryId: "Penyeragaman warna XAU/USD, ekstraksi actual PMI real-time, Intraday Tactical Overlay, dan dukungan native APK TradingView.",
    summaryEn: "Penyeragaman warna XAU/USD, ekstraksi actual PMI real-time, Intraday Tactical Overlay, dan dukungan native APK TradingView.",
  },
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
