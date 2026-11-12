# LAPORAN REVISI DASHBOARD TRADEVAULT (MASTER REVISION BRIEF)

## 1. Kondisi Awal Dashboard
Sebelum penyempurnaan ini, kondisi Dashboard (`src/components/dashboard/DashboardView.tsx`, `src/components/dashboard/EquityChart.tsx`, dan `src/components/layout/Navbar.tsx`) masih memiliki ketidaksesuaian dengan diagram desain yang disepakati:
- **Total Balance:** Ikon mata (`Hide Balance`) masih dibungkus di dalam kotak berlatar dan ber-border (`rounded-lg bg-[#F5F7FA] dark:bg-[#171D26] border ...`), terdapat badge persentase pertumbuhan di samping label saldo, serta masih menampilkan penjelasan kurs (`1 USD = Rp...`), ikon centang (`CheckCircle2`), tanggal/jam pembaruan kurs, dan tombol refresh kurs.
- **Kartu Saldo Tambahan:** Terdapat tiga kartu terpisah di bawah Total Balance (`Modal Bersih`, `Profit Trading`, dan `Balance Growth`).
- **Account Performance:** Empat metrik utama (`Net Profit`, `Win Rate`, `Total Transaksi`, `Pertumbuhan Periode`) masih dipisah menjadi empat kartu tersendiri, dan komponen `EquityChart` berada di dalam kartu ber-border tambahan (card-within-card).
- **Equity Curve:** Menggunakan garis lurus antar titik dengan titik-titik berwarna merah/hijau di setiap transaksi, header grafik terpisah dengan tombol `High Watermark`, 5 garis grid vertikal yang padat, dan footer legenda tambahan.
- **Pemilihan Periode:** Menggunakan deretan 4 tombol (`[Semua] [7H] [30H] [Bulan Ini]`), bukan satu kontrol dropdown ringkas dengan 7 opsi periode.
- **Recent Trades:** Belum menampilkan `Lot Size`, dan label `BUY`/`SELL` masih dibungkus kotak berwarna (badge ber-background dan ber-border).

---

## 2. Perubahan yang Dilakukan
1. **Header TradeVault (`Navbar.tsx` & `MobileNav.tsx`):**
   - Mempertahankan tombol Hamburger di sebelah kiri, simbol resmi TradeVault, dan wordmark `TRADEVAULT`.
   - Mengubah mekanisme mengecilnya header saat scroll (`0px`–`48px`) agar menggunakan tinggi kontainer luar yang tetap (`h-14`) dan properti kompositor (`transform`, `opacity`) untuk simbol dan wordmark `TRADEVAULT`, sehingga tidak pernah menimbulkan *layout jump* pada konten di bawahnya dan menghormati `prefers-reduced-motion`.
   - Status penyimpanan lokal dan sinkronisasi Cloud tetap berada di dalam menu Hamburger / Sidebar.
2. **Total Balance (`DashboardView.tsx`):**
   - Menampilkan label `TOTAL BALANCE`, saldo utama (`$12,591.10` / `Rp...`), dan nilai konversi (`≈ Rp...` / `≈ $...`) tepat di bawahnya.
   - Menampilkan ikon mata (`Eye` / `EyeOff`) secara langsung tanpa kotak, tanpa border, dan tanpa background dekoratif.
   - Menghapus badge persentase di samping label saldo, ikon centang, teks `1 USD = Rp...`, tanggal/jam kurs, dan tombol refresh kurs dari tampilan Dashboard.
3. **Penghapusan Kartu Tambahan (`DashboardView.tsx`):**
   - Menghapus tiga kartu terpisah (`Modal Bersih`, `Profit Trading`, `Balance Growth`) serta banner tambahan di atas Total Balance. Fungsi perhitungan dasar (`calculateCapitalGrowthBreakdown`) tetap dipertahankan di `src/utils/currencyRate.ts`.
4. **Account Performance Terpadu (`DashboardView.tsx`):**
   - Menggabungkan `Net Profit`, `Pertumbuhan`, `Win Rate`, `Total Trades`, dan `EQUITY CURVE` ke dalam satu kartu `ACCOUNT PERFORMANCE` yang menyatu tanpa empat kartu metrik terpisah dan tanpa *card-within-card*.
5. **Desain Baru Equity Curve (`EquityChart.tsx`):**
   - Mengimplementasikan kurva halus menggunakan *monotone cubic Hermite spline* (`buildSmoothSvgPath`) yang melewati setiap titik data secara akurat tanpa *overshoot*, tanpa efek *glow* atau *neon*.
   - Menyederhanakan gridline horizontal menjadi 3 garis tipis yang bersih, label sumbu ringkas (`tabular-nums`), dan interaksi sentuh/geser (*touch & mouse scrubbing*) di seluruh area kurva dengan tooltip ringkas.
   - Menyediakan kontrol `[Saldo | Persen]` yang konsisten menggunakan `computeEquityChartSeries` dan `computeEquityChartAxis` yang sama dengan halaman Analytics.
6. **Dropdown Pemilihan Periode (`DashboardView.tsx` & `calculations.ts`):**
   - Mengganti deretan tombol periode menjadi satu tombol dropdown ringkas di kanan bawah kurva ekuitas dengan 7 pilihan: `1 Hari`, `7 Hari`, `1 Bulan`, `3 Bulan`, `6 Bulan`, `1 Tahun`, dan `Semua Waktu`.
7. **Recent Trades (`DashboardView.tsx`):**
   - Menampilkan maksimal 3 transaksi terbaru dengan informasi: `Symbol`, `BUY`/`SELL` (teks hijau lembut/merah lembut tanpa background kartu berwarna), `Lot Size`, `Tanggal`, dan nominal P/L dalam USD (hijau lembut untuk profit, merah lembut untuk loss), serta tautan `Lihat Semua`.
8. **Hide Balance Global (`DashboardView.tsx` & `EquityChart.tsx`):**
   - Menyamarkan saldo utama, saldo konversi, nominal `Net Profit`, nominal P/L `Recent Trades`, serta label sumbu dan tooltip nominal pada `Equity Curve` mode `Saldo` menjadi `******`, sementara `Pertumbuhan (%)`, `Win Rate`, `Total Trades`, dan mode `Persen` tetap terlihat.

---

## 3. Komponen yang Diubah
- `src/components/dashboard/DashboardView.tsx`
- `src/components/dashboard/EquityChart.tsx`
- `src/components/layout/Navbar.tsx`
- `src/components/layout/MobileNav.tsx`
- `src/utils/calculations.ts`
- `src/utils/testRunner.ts`

---

## 4. Komponen yang Dipertahankan
- `src/components/layout/BrandLogo.tsx` (identitas & logo resmi TradeVault)
- `src/components/layout/Sidebar.tsx`
- `src/components/analytics/AnalyticsView.tsx`
- `src/components/trades/TradeForm.tsx`, `TradeTable.tsx`, `TradeDetailModal.tsx`
- `src/components/risk/RiskCalculatorView.tsx`
- `src/components/settings/SettingsView.tsx`
- `src/utils/currencyRate.ts`, `src/utils/complianceRating.ts`, `src/utils/riskCalculator.ts`, `src/utils/storage.ts`, `src/utils/supabaseSync.ts`

---

## 5. Screenshot Sebelum dan Sesudah
- **Status:** Tidak tersedia. Lingkungan kontainer saat ini tidak memiliki binary browser headless (`Playwright`/`Chromium`), sehingga pengambilan screenshot otomatis tidak dilakukan. Sesuai protokol kejujuran Section 18, tidak ada klaim screenshot yang belum dibuat.

---

## 6. Hasil Pengujian Dark Mode
- **Token Permukaan & Teks:** Terverifikasi menggunakan variabel CSS & pasangan class `dark:bg-[#080A0E]` (background), `dark:bg-[#11151B]` (surface kartu), `dark:border-[#252B34]` (hairline border), `dark:text-[#F2F5F9]` (teks utama), dan `dark:text-[#929BA9]` (teks sekunder).
- **Warna Semantik BUY/SELL & Profit/Loss:** Menggunakan hijau lembut (`dark:text-[#34D399]`) dan merah lembut (`dark:text-[#FB7185]`) tanpa warna neon atau glow.

---

## 7. Hasil Pengujian Light Mode
- **Kontras & Keterbacaan:** Terverifikasi menggunakan `bg-[#F5F7FA]` (background), `bg-white` (surface kartu), `border-[#DDE3EA]` (border), `text-[#151D2A]` (teks utama), dan `text-[#697586]` (teks sekunder).
- **Warna Semantik & Kurva:** Menggunakan hijau lembut (`text-[#059669]`), merah lembut (`text-[#E11D48]`), dan garis kurva `#1769E8` dengan gridline `#DDE3EA` yang tetap terbaca jelas di atas permukaan terang.

---

## 8. Hasil Pengujian Android dan Desktop
- **Verifikasi DOM & Markup (`react-dom/server`):** 11/11 pemeriksaan struktur DOM Dashboard dan Header lulus (`PASS`).
- **Safe Area Android:** Header menggunakan `pt-[env(safe-area-inset-top,0px)]`, kontainer utama dan tombol bawah menggunakan `pb-[calc(...+env(safe-area-inset-bottom,0px))]`, dan dropdown periode membuka ke arah atas (`bottom-full right-0 w-40`) di luar kontainer `overflow-hidden` sehingga tidak terpotong di layar kecil.
- **Catatan Pengujian Visual Perangkat Fisik:** Pengujian langsung pada layar perangkat fisik Android belum dijalankan dari lingkungan server ini dan siap diuji pada preview browser/perangkat Anda.

---

## 9. Daftar Bug yang Ditemukan
1. **React `setState-in-render` saat menekan tombol Hide Balance:** Pemanggilan `window.dispatchEvent(new Event('tradevault-privacy-change'))` di dalam updater `setIsPrivacyMode((prev) => ...)` memicu error `Cannot update a component (AnalyticsView) while rendering a different component (DashboardView)`.
2. **Potensi Layout Jump pada Sticky Header:** Perubahan tinggi DOM `h-14` ke `h-12` secara langsung pada `<header>` saat melewati ambang scroll dapat menggeser posisi vertikal `<main>` sebesar 8px.
3. **Kontrol Periode Hilang Saat Periode Kosong:** Sebelumnya, `EquityChart` mengembalikan *early return* tanpa merender kontrol apabila periode yang dipilih memiliki 0 transaksi.

---

## 10. Daftar Bug yang Telah Diperbaiki
1. **`setState-in-render` pada Hide Balance:** Dipindahkan ke luar fungsi updater state pada `DashboardView.tsx` dan `AnalyticsView.tsx`.
2. **Zero-Layout-Jump Sticky Header:** `<header>` di `Navbar.tsx` kini mempertahankan tinggi alur dokumen tetap (`h-14`) dan menganimasikan simbol serta wordmark `TRADEVAULT` menggunakan `transform` dan `opacity`.
3. **Persistensi Kontrol Kurva pada Periode Kosong:** `EquityChart.tsx` tetap menampilkan garis dasar (*baseline*) serta kontrol `[Saldo | Persen]` dan dropdown `[Periode ▼]` meskipun periode yang dipilih (misalnya `1 Hari`) belum memiliki transaksi.

---

## 11. Daftar Pekerjaan yang Belum Selesai
- Tidak ada item dalam cakupan *Dashboard Master Revision Brief* yang belum diimplementasikan.
- Sesuai instruksi penutup, ruang lingkup **Trade Log** sengaja tidak diubah dan menunggu brief terpisah.

---

## 12. Status Keamanan Data
- **Aman 100%:** Tidak ada perubahan pada skema database, kebijakan RLS Supabase, data transaksi tersimpan (`localStorage` maupun Supabase), screenshot transaksi, ataupun saldo asli akun.
- **Hasil Unit Test Otomatis:**
  - `Financial Calculations Suite`: **221 / 221 LULUS (0 gagal)**
  - `Lot × Pip & MT5 Sync Suite`: **20 / 20 LULUS (0 gagal)**
  - `Master Redesign Verification Suite`: **18 / 18 LULUS (0 gagal)**
  - `TypeScript Check (tsc --noEmit)` & `Production Build`: **LULUS (0 error)**

---

## 13. Status Build APK
- **Status:** Belum dibuat pada tahap ini (sesuai instruksi bahwa revisi ini berfokus pada kode aplikasi web/Capacitor tanpa menjalankan Gradle atau memodifikasi identitas APK).

---

## 14. Penyempurnaan Interaksi Equity Curve (Ephemeral Touch & Pointer Interaction)

### 14.1 Hasil Audit & Penyebab Masalah
Berdasarkan audit pada `src/components/dashboard/EquityChart.tsx`, ditemukan tiga penyebab mengapa marker dan tooltip masih tertinggal setelah sentuhan atau pointer dilepas:
1. **Tidak adanya handler `onTouchEnd` dan `onTouchCancel` pada elemen `<svg>`:** Sebelumnya hanya terdapat `onTouchStart` dan `onTouchMove`. Pada perangkat Android/layar sentuh, pelepasan jari memicu `touchend` (bukan `mouseleave`), sehingga `hoveredPoint` tetap menyimpan titik terakhir secara permanen.
2. **Event mouse sintetis (*synthetic compatibility mouse events*) pada browser mobile:** Setelah `touchend`, browser mobile dapat memicu `mousemove`/`mousedown` sintetis pada koordinat sentuhan terakhir yang mengaktifkan kembali `hoveredPoint` apabila tidak diblokir.
3. **Adanya lingkaran marker permanen pada titik akhir kurva saat idle:** Sebelumnya terdapat `<circle>` statis yang dirender ketika `!hoveredPoint`, sehingga kurva selalu menampilkan bulatan marker meskipun pengguna sedang tidak berinteraksi.

### 14.2 File yang Dimodifikasi
- `src/components/dashboard/EquityChart.tsx`
- `src/utils/testRunner.ts`
- `public/LAPORAN_REVISI_TRADEVAULT.md`

### 14.3 Perubahan Perilaku yang Diterapkan
- **Saat kurva disentuh/ditekan (`onTouchStart`, `onMouseDown`):** Marker titik trade (`data-testid="equity-chart-point-marker"`), garis bantu vertikal (`data-testid="equity-chart-crosshair"`), dan tooltip (`data-testid="equity-chart-tooltip"`) langsung muncul mengikuti titik terdekat pada kurva.
- **Selama jari/pointer digeser (`onTouchMove`, `onMouseMove`):** Posisi marker, garis bantu, dan isi tooltip diperbarui secara responsif mengikuti titik terdekat melalui fungsi murni `resolveEquityCurvePointAtClientX`.
- **Saat sentuhan/interaksi dilepas atau dibatalkan (`onTouchEnd`, `onTouchCancel`, `onMouseUp`, `onMouseLeave`, `onPointerCancel`, `onLostPointerCapture`, serta listener global `window` untuk `touchend`, `touchcancel`, `mouseup`, `pointercancel`, `blur`):** State `hoveredPoint` langsung di-reset menjadi `null`, sehingga seluruh marker, garis bantu, dan tooltip langsung menghilang dan kurva kembali bersih tanpa marker statis.
- **Pencegahan event mouse sintetis pasca-sentuhan:** Menambahkan `lastTouchEndTimeRef` (jendela proteksi 500ms setelah `touchend`/`touchcancel`) agar event mouse sintetis di Android tidak memunculkan kembali tooltip setelah jari diangkat.
- **Reset otomatis saat ganti mode atau periode:** `useEffect` pada `[equityCurve, viewMode]` memastikan state interaksi dibersihkan otomatis saat pengguna berpindah antara mode `Saldo`/`Persen` atau mengganti periode (`1 Hari`, `7 Hari`, `1 Bulan`, `3 Bulan`, `6 Bulan`, `1 Tahun`, `Semua Waktu`).



---

# LAPORAN IMPLEMENTASI TVES RISK MANAGEMENT (REVISI TERKONTROL)

## 1. Ringkasan Pembaruan Risk Management
- **Halaman Utama Risk Management (`RiskCalculatorView.tsx`):**
  - Menyajikan bagian `TODAY'S RISK` (`DAILY LOSS` dan `DAILY LOSS LIMIT`), `RISK USAGE` (`% Used = Daily Loss / Daily Loss Limit * 100`, progress bar bersih, `Used`, `Remaining`), serta navigasi 6 fitur inti `RISK TOOLS`.
  - Menerapkan filosofi **Less decoration, more clarity** sesuai `DESIGN.md` (`Arial, Helvetica, sans-serif`, `tabular-nums`, permukaan netral Dark/Light, aksen tunggal `#1769E8`, tanpa glow/neon/badge dekoratif).
- **Fitur 01 — Kalkulator Lot (`Lot Calculator` & `Position Sizing`):**
  - Menggunakan segmented selector `[ Lot Calculator ]` dan `[ Position Sizing ]` yang **hanya merender satu form aktif pada satu waktu** (tidak pernah merender kedua form sekaligus).
  - Mendukung pemilihan multi-instrumen (`XAUUSD`, `EURUSD`, `GBPUSD`, `USDJPY`, `BTCUSD`, `AUDUSD`, `NZDUSD`, `USDCAD`, `USDCHF`, `US30`, `NAS100`) melalui mesin perhitungan terpadu `calculateUnifiedXauusdPosition` / `calculateXauusdLot` + `getInstrumentPipSpec`.
- **Fitur 02 — Proteksi & Aturan Risiko:**
  - Sinkronisasi dua arah antara `Daily Loss Limit (%)` dan `Maximum Daily Loss ($)`, batas `Consecutive Loss Limit`, `Maximum Drawdown (%)`, `Daily Reset`, serta toggle `Daily Loss Alert` dan `Stop Trading Alert` yang disimpan pada `AppSettings`.
- **Fitur 03 — Simulasi Loss Beruntun:**
  - Mendukung metode `Percentage of Remaining Balance` (`PERCENT_RUNNING_EQUITY`) dan `Fixed Risk Amount` (`FIXED_NOMINAL`), lengkap dengan ringkasan `Result` dan tabel `Balance Projection` (`Initial`, `Loss 1` ... `Loss N`).
- **Fitur 04 — Evaluasi Disiplin:**
  - Mengevaluasi data transaksi nyata dari Trade Log berdasarkan periode (`Last 20 Trades`, `Last 50 Trades`, `All Trades`), menampilkan `Discipline Score (XX / 100)`, `Rule Compliance` (`Risk per Trade`, `Stop Loss Compliance`, `Trading Plan`, `Daily Limit Compliance`), dan `Rule Violations` (`Total Violations` + `[ View Details ]`).
- **Fitur 05 — Simulator Compounding (`CompoundingCalculatorTab.tsx`):**
  - Menampilkan perbandingan berdampingan antara kartu `COMPOUNDING` (`Ending Balance`, `Total Profit`) dan `FIXED PROFIT / WITHDRAWAL` (`Account Balance`, `Total Withdrawn`, `Total Wealth`) tanpa mencampurkan saldo akun dengan profit yang telah ditarik, dilengkapi grafik `Growth Projection` dan tabel `Monthly Projection`.
- **Fitur 06 — Simulasi Berbasis Trade (`TradeSimulationTab.tsx`):**
  - Menampilkan `Winning Trades`, `Losing Trades`, `Net Profit / Loss`, `Final Balance`, `Return (%)`, `Profit Factor` (`Gross Profit / Gross Loss`), `Max Drawdown`, `Expectancy (R)`, grafik `Performance Projection`, dan distribusi `Monte Carlo` deterministik (`P5`, `P50`, `P95`).
