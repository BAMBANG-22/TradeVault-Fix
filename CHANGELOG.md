# Changelog

## v1.3.8 · #VLO-2611-JRV11 (2026-11-26)
- Asisten Pribadi AI ala Jarvis/Alfred, Live XAUUSD & Memori Offline: Menambahkan 4-jalur router cerdas (basa-basi & ganti panggilan nama tanpa bocor data market, penjaga batas ranah, cek harga XAU/USD real-time dari Vela, serta auto-sync latar belakang berita/fundamental/Polymarket), memori jangka panjang offline (maks. 25 catatan + pengelola di menu Tema), serta tombol Akhiri Sesi & Auto-New-Day rollover (sinkron penuh dengan Supabase Edge Function).

## v1.3.7 · #VLO-2611-AGT10 (2026-11-25)
- Multi-Agent News + ACC Boss Gemini, Asisten Pribadi AI ala Jarvis/Alfred & Developer Console Tersembunyi: Membagi beban Trade News (Groq → OpenRouter) dan Fundamental Emas (OpenRouter → Groq) dengan review & ACC wajib Boss Gemini; meluncurkan Tanya AI bergaya WhatsApp/IG DM dengan 4-jalur router cerdas (basa-basi & panggilan nama tanpa membocorkan data market, penjaga batas ranah, cek harga XAU/USD live dari Vela, serta background auto-sync berita/fundamental/Polymarket), memori jangka panjang offline (maks. 25 catatan + pengelola di menu Tema), tombol **Akhiri Sesi** + Auto-New-Day rollover; serta menyembunyikan Cloud, Backend & Diagnostik di balik gerbang Pengembang (7x tap versi + kode seri SHA-256) lengkap dengan tombol Sembunyikan, Cleaning Service, Perekam Error otomatis, dan Analisa AI QA.

## v1.3.6 · #VLO-2611-APK09 (2026-11-25)
- Vela Replay Chart, Auto-Fullscreen, APK Cache-Purge Native & Diagnostik Lengkap: Menghapus Light Chart dan menjadikan Vela Replay sebagai chart kedua dengan Twelve Data + proxy fallback, Bar Replay, Sesi Trading Kustom, dan Auto-Fullscreen; menambahkan pembersihan HTTP cache WebView native di MainActivity saat upgrade APK; menyinkronkan Trade News, Fundamental Gold, dan Cycle Confluence; serta memperluas panel Diagnostik APK & OCR di Pengaturan.

## v1.3.5 · #VLO-2611-AUD08 (2026-11-24)
- Forensic Offline OCR diagnostics, build identity & Android high-res lossless pipeline: Added deterministic build identity (Git SHA, timestamp, CI run, OCR pipeline version), forensic OCR diagnostics inspector, full legacy Service Worker & OCR CacheStorage purge with forced reload on upgrade, lossless high-res PNG preprocessing for tall Android MT5 screenshots, and restored multi-pass completeness gate.

## v1.3.4 · #VLO-2611-SCN07 (2026-11-24)
- Fix APK Offline OCR eng.traineddata tanpa .gz & anti-hang guard: Gunakan eng.traineddata tidak terkompresi (gzip: false) agar kompatibel dengan Android AAPT2 serta tambah errorHandler dan timeout guard Tesseract

## v1.3.3 · #VLO-2611-SCN06 (2026-11-24)
- Purge SW cache APK & akselerasi SIMD + Parallel OCR: Hapus jebakan cache Service Worker lama di APK, aktifkan WebAssembly SIMD, Blob zero-split, dan eksekusi OCR paralel

## v1.3.2 · #VLO-2611-SCN05 (2026-11-24)
- Optimasi kecepatan Scan APK (Offline & Online): Mempercepat OCR Offline 4-5x di HP (2.1MP single-pass early exit, non-IndexedDB worker init) dan mempercepat fallback Online Scan

## v1.3.1 · #VLO-2611-MAC04 (2026-11-24)
- Sinkronisasi Fundamental 3-Fitur & Real-Time Actual APK: Penyeragaman warna XAU/USD, ekstraksi actual PMI real-time, Intraday Tactical Overlay, dan dukungan native APK TradingView.

## v1.3.0 · #VLO-2611-PRO01 (2026-11-22)
- Suite Trader Pro: Behavioral Analytics, Guardrail, Playbook, Review, Export, Multi-Account & PWA: Penambahan 10 fitur pro tanpa mengubah UI editorial VLO: Cost of Mistakes & tag emosi, Guardrail Risiko & Checklist SOP pra-eksekusi, Review Mingguan/Bulanan, konteks Macro News di detail trade, Export PDF & Shareable PNG Card, Playbook Setup A+, Pintasan Keyboard & Quick Command (Cmd+K), PWA Offline-First, Multi-Akun / Sub-Portofolio, serta pembersihan dependensi tidak terpakai.

All notable releases and Git push revisions for VLO Journal carry a semantic version (`vX.Y.Z`) and a unique change code (`#VLO-YYMM-XXXX`).

Run `npm run version:bump` before committing/pushing a new change to automatically increment the version and issue a new change code.

## v1.2.1 · #VLO-2611-FLD01 (2026-11-21)
- **Precision Tactile Fluidity UI & Motion**: Revived `.animate-in` / `.fade-in` / `.slide-in-from-top-*` for Tailwind v4 (`.animate-in.fixed > :first-child` adaptive desktop & mobile modal card entrance), added GPU-composited state-preserving tab transitions (`.vlo-view-enter` / `.vlo-view-fade`), added `@layer base` universal tactile `:active` micro-press (`scale: 0.98`) with `data-tactile="none"` opt-out on brand tiles, and replaced plain spinners with `.vlo-skeleton` placeholders.

## v1.2.0 · #VLO-2611-SND01 (2026-11-21)
- **Notification Chimes & Tactile Click System**: Added zero-lag Web Audio API sound engine (`src/utils/soundEngine.ts`) for UI click/touch feedback, trade/toast chimes, macro news alert pings, haptic touch vibration, and On/Off + Test controls in Settings.

## v1.1.2 · #VLO-2611-LGO02 (2026-11-21)
- **60fps VloMech Logo Optimization**: Moved VloMech styles to global CSS with pure GPU-composited `transform`/`opacity` keyframes (eliminating CPU SVG `<mask>` rasterization & `non-scaling-stroke`), stabilized splash timer refs, and deferred heavy background workspace hydration via `startTransition` until splash assembly finishes.

## v1.1.1 · #VLO-2611-LGO01 (2026-11-21)
- **Mechanical Orbital Assembly Logo**: Integrated `VloMech` fluid orbital logo motion into Splash Screen and Auth Modal with app Light & Dark theme synchronization.

## v1.1.0 · #VLO-2611-RSK01 (2026-11-21)
- **Risk Pip/SL Rule Alignment**: Aligned XAUUSD default pip standard (`1 pip = 0.10`, `4000 -> 3995 = 50 pips`) across Risk Management, Broker Settings, and Market Chart.
- **Risk USD & IDR Currency Mode**: Added synchronized `USD ($) | IDR (Rp)` switching, live FX conversion, Rupiah thousand-dot input formatting, quick presets, and cross-currency hints across all Risk calculators, Risk Protection Limits, and Consecutive Loss Simulation.
- **App Version & Change Code System**: Added centralized `src/config/appVersion.ts`, synced `package.json`, displayed `v1.1.0 · #VLO-2611-RSK01` in navigation/settings, and added version history drawer + bump script.

## v1.0.0 · #VLO-2611-ELM01 (2026-11-20)
- Editorial Pure-White Light Mode surface refresh, preserved Dark Mode, and Fundamental Gold narrative module.
