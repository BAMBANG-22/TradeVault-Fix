# DOKUMEN AUDIT TEKNIS: DASHBOARD & GLOBAL CURRENCY SYSTEM TRADEVAULT
**Status:** Audit Selesai — Menunggu Persetujuan Pengguna Sebelum Modifikasi Kode  
**Aplikasi:** TradeVault (React + TypeScript + Vite + Tailwind CSS)  
**Tanggal:** 5 November 2026  

---

## 1. CURRENT IMPLEMENTATION (Kondisi Implementasi Saat Ini)

### A. Dashboard & Account Balance
- **Struktur Tampilan:** Bagian Account Balance pada `DashboardView.tsx` telah menerapkan konsep *Seamless Black* (tanpa kartu pembungkus luar), menyatu dengan latar belakang hitam.
- **Susunan Vertikal Dua Mata Uang:** Saldo utama (Primary) dan saldo konversi (Secondary) tersusun vertikal dalam satu blok. Saldo utama ditampilkan besar (`text-3xl sm:text-4xl font-bold font-mono-numbers`), sedangkan saldo sekunder ditampilkan proporsional di bawahnya (`text-xs sm:text-sm font-medium`).
- **Tombol Swap:** Terletak di sebelah kanan di antara kedua nilai mata uang dengan ikon `ArrowUpDown` yang berputar 180° tanpa pergeseran tata letak (*zero layout shift*). Preferensi tersimpan pada `localStorage` dengan kunci `tradevault_dashboard_currency_pref`.
- **Panel Kurs Terpisah:** Panel `LIVE USD/IDR RATE` terpisah telah dihilangkan dari Dashboard. Sistem hanya menggunakan data kurs secara internal.

### B. Mekanisme Kurs & Konversi Mata Uang
- **Penyedia Kurs Real-Time:** `src/utils/currencyRate.ts` memiliki fungsi `fetchLiveUsdIdrRate()` yang mengambil data dari `open.er-api.com` (primer) dengan fallback ke `api.frankfurter.app` (sekunder/ECB) dan `localStorage` cache `tradevault_usd_idr_rate_v1`.
- **Dasar Saldo Invarian:** Saldo akun asli di database/pengaturan (`settings.startingBalance` dan `capitalBreakdown.currentBalance`) bersifat invarian dalam satuan **USD**. Nilai IDR murni merupakan hasil proyeksi dinamis:
  $$\text{Saldo IDR} = \text{Saldo USD} \times \text{Kurs Aktual}$$
- **Snapshot Kurs Penutupan Transaksi:** Antarmuka `HistoricalExchangeRateSnapshot` sudah ada di `src/types/trade.ts` dan fungsi `transitionOpenTradeToClosed` di `src/utils/tradeLifecycle.ts` sudah menerima snapshot kurs penutupan transaksi.

### C. Kondisi Tampilan Mata Uang di Modul Lain
- **Trade Log, Detail Modal, Analytics, Risk Management, Calendar, & Equity Curve:** Saat ini sebagian besar masih memanggil `formatCurrency(amount, settings)` di mana `settings.currency` bernilai `'USD'`. Pilihan mata uang IDR saat ini baru berdampak visual pada kartu Account Balance di Dashboard dan belum terpropagasi secara global ke seluruh modul aplikasi.

---

## 2. FINDINGS (Temuan & Ketidaksesuaian yang Ditemukan)

1. **Temuan 1 — Cakupan Mata Uang Masih Bersifat Lokal di Dashboard:**
   - Preferensi swap mata uang (`preferredCurrency`) dikelola di dalam state lokal `DashboardView.tsx`.
   - Modul lain (`TradeTable`, `TradeDetailModal`, `AnalyticsView`, `RiskCalculatorView`, `DashboardCalendar`, `PerformanceCalendar`, `EquityChart`, `DrawdownChart`) belum membaca preferensi ini, sehingga saat pengguna menukar ke IDR di Dashboard, halaman lain masih menampilkan lambang dollar (`$`).

2. **Temuan 2 — Risiko Konversi Dinamis Terhadap Transaksi CLOSED:**
   - Jika konversi IDR diterapkan secara naif ke seluruh modul dengan rumus $\text{Nilai USD} \times \text{Kurs Hari Ini}$, maka seluruh transaksi CLOSED masa lalu akan mengalami perubahan nominal profit/loss setiap kali kurs rupiah bergerak naik atau turun.
   - Hal ini melanggar aturan mutlak finansial: **Profit/loss yang sudah terealisasi wajib terkunci pada nilai kurs saat transaksi ditutup**.

3. **Temuan 3 — Identifikasi Transaksi Lama (Legacy Trades):**
   - Transaksi lama yang dibuat sebelum sistem snapshot diterapkan tidak memiliki data `closeExchangeRate`.
   - Mengisi transaksi lama dengan kurs hari ini secara otomatis merupakan pelanggaran integritas data. Transaksi tersebut harus diklasifikasikan sebagai `UNVERIFIED_LEGACY`.

4. **Temuan 4 — Proteksi Angka Non-Moneter:**
   - Parameter trading seperti Lot Size (misal `0.05`), Harga Entry (`4000.00`), Stop Loss, Take Profit, Pips, R:R Ratio (`1:2.5`), Win Rate (`60%`), dan jumlah transaksi bukan merupakan nilai moneter dan tidak boleh dikonversi ke IDR.

---

## 3. CURRENCY DATA FLOW (Alur Data Mata Uang)

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        SUMBER DATA UTAMA (USD)                         │
│   • settings.startingBalance (USD)                                     │
│   • trade.riskAmount (USD)                                             │
│   • trade.netProfit / grossProfit / commission / swap (USD)            │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                  ┌─────────────────┴─────────────────┐
                  ▼                                   ▼
        [PILIHAN AKTIF: USD]                [PILIHAN AKTIF: IDR]
                  │                                   │
                  │              ┌────────────────────┴───────────────────┐
                  │              ▼                                        ▼
                  │     [KATEGORI DINAMIS/FLOAT]                [KATEGORI CLOSED/HISTORIS]
                  │     • Account Balance                       • Closed Net Profit
                  │     • Planned Trade Risk                    • Closed Gross Profit
                  │     • Open Position Floating P/L            • Closed Commission
                  │     • Open Risk Amount                      • Closed Swap
                  │     • Max Daily Loss Limit                  • Realized P/L Calendar
                  │              │                                        │
                  │              ▼                                        ▼
                  │     Dikalikan Kurs Real-Time                Menggunakan Kurs Kunci
                  │     (USD × Kurs Terbaru)                    Saat Close (Snapshot)
                  │              │                                        │
                  ▼              ▼                                        ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   TAMPILAN PENGGUNA                                    │
│   • Format Mata Uang Konsisten (Intl.NumberFormat id-ID atau en-US)                     │
│   • Nilai Asli USD di Database Supabase / LocalStorage TIDAK PERNAH TERMUTASI          │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. AFFECTED FILES (File yang Terdampak)

1. `src/types/trade.ts` — Memastikan kelengkapan antarmuka `HistoricalExchangeRateSnapshot` dan field pada `Trade`.
2. `src/utils/currencyRate.ts` — Pusat konversi mata uang global, penentu nilai historis vs dinamis, dan penyedia kurs.
3. `src/utils/calculations.ts` — Penyesuaian helper format moneter agar mendukung preferensi global (USD/IDR) dan snapshot historis.
4. `src/App.tsx` — Pengangkatan state preferensi mata uang ke tingkat global dan distribusi ke seluruh modul (Navbar, Dashboard, Trade Log, Analytics, Risk).
5. `src/components/dashboard/DashboardView.tsx` — Penyesuaian sinkronisasi state preferensi mata uang dengan konteks global.
6. `src/components/dashboard/DashboardCalendar.tsx` — Tampilan P/L harian dan detail tanggal menggunakan nilai historis CLOSED saat IDR aktif.
7. `src/components/dashboard/PerformanceCalendar.tsx` — Kalender performa bulanan dan kartu detail harian menggunakan nilai historis CLOSED saat IDR aktif.
8. `src/components/dashboard/EquityChart.tsx` & `DrawdownChart.tsx` — Sumbu dan tooltip grafik ekuitas menyesuaikan mata uang aktif.
9. `src/components/dashboard/RiskSnapshot.tsx` — Limit risiko harian dan drawdown berjalan menyesuaikan mata uang aktif.
10. `src/components/trades/TradeTable.tsx` — Daftar transaksi, ringkasan P/L, dan filter menampilkan nominal IDR historis pada transaksi CLOSED.
11. `src/components/trades/TradeDetailModal.tsx` — Tampilan rincian finansial (Gross, Net, Comm, Swap, Risk) membedakan nilai historis dan nilai dinamis.
12. `src/components/analytics/AnalyticsView.tsx` — Metrik total profit, expectancy, average win/loss, dan profit per sesi/hari dihitung akurat berdasarkan akumulasi nilai historis saat IDR aktif.
13. `src/components/risk/RiskCalculatorView.tsx` — Kalkulator ukuran posisi dan batas risiko harian menyesuaikan mata uang aktif.
14. `src/storage/utf8Base64Url.ts` & `src/utils/supabaseSync.ts` — Memastikan metadata snapshot kurs historis tersimpan aman dan tidak hilang saat sinkronisasi cloud Supabase.
15. `src/components/backup/JsonBackupModal.tsx` — Memastikan file backup JSON menyertakan data kurs historis.

---

## 5. DATA SAFETY ASSESSMENT (Penilaian Keamanan Data)

| Aspek | Tingkat Risiko | Mitigasi Keamanan |
| :--- | :---: | :--- |
| **Nilai USD Asli** | **Nol (Zero Risk)** | Seluruh perhitungan konversi bersifat murni *read-only projection* pada lapisan presentasi. Nilai numerik `trade.netProfit`, `trade.riskAmount`, dan `settings.startingBalance` yang tersimpan tidak dimodifikasi. |
| **Transaksi Lama (Legacy)** | **Nol (Zero Risk)** | Transaksi yang tidak memiliki snapshot kurs historis tidak akan diisi nilai tebakan atau kurs hari ini. Sistem memberi tanda *legacy* dan menjaga integritas nilai asli USD. |
| **Database Supabase** | **Nol (Zero Risk)** | Tidak ada skema DDL atau alter table yang dijalankan. Snapshot kurs dikodekan secara aman ke dalam metadata transaksi yang sudah didukung penuh oleh sinkronisasi cloud. |
| **Backup & Restore** | **Nol (Zero Risk)** | Struktur backup JSON mempertahankan seluruh field objek `Trade`, sehingga data kurs penutupan transaksi akan tetap utuh saat diekspor maupun diimpor. |

---

## 6. IMPLEMENTATION PLAN (Rancangan Urutan Implementasi)

1. **Langkah 1: Sentralisasi Pengaturan Mata Uang Global (`Global Currency Context / State`)**
   - Mengangkat state `preferredCurrency` ('USD' | 'IDR') ke tingkat root `App.tsx` atau custom hook reaktif berbasis event bus (`tradevault-currency-pref-change`) dan `localStorage`.
   - Memastikan pergantian mata uang di Account Balance Dashboard langsung memicu pembaruan serentak di seluruh tab tanpa *page reload*.

2. **Langkah 2: Mesin Konversi Terpusat (`formatGlobalMonetaryValue`)**
   - Menghubungkan fungsi pemformatan moneter terpusat yang secara otomatis membedakan:
     - **Nilai Dinamis / Real-Time**: Dikalikan kurs terbaru jika IDR aktif (Account Balance, Planned Risk, Open Trade Floating P/L, Limit Risiko).
     - **Nilai Historis Terkunci**: Menggunakan kurs penutupan (`closeExchangeRate`) jika IDR aktif (Closed Net Profit, Gross, Commission, Swap).
     - **Angka Non-Moneter**: Dilewati langsung tanpa konversi (Lot, Entry Price, SL/TP Price, R:R, Win Rate %, Pips).

3. **Langkah 3: Integrasi ke Komponen Tampilan**
   - Menyambungkan mesin konversi ke:
     - Dashboard (Performance Calendar, Daily Performance Card, Equity Curve, Risk Snapshot).
     - Trade Log (Tabel Transaksi, Kartu Tanggal, dan Status Filter).
     - Trade Detail Modal.
     - Analytics View.
     - Risk Management View.

4. **Langkah 4: Validasi & Audit Pengujian**
   - Menjalankan 316 uji finansial otomatis (`scripts/test-financial.ts`).
   - Melakukan pengujian 10 skenario wajib sesuai spesifikasi pengguna.
   - Menjalankan kompilasi TypeScript (`compile_applet`) dan linter (`lint_applet`).

---

## 7. TEST PLAN (Daftar Pengujian yang Akan Dijalankan)

| ID Uji | Skenario Pengujian | Hasil yang Diharapkan |
| :---: | :--- | :--- |
| **Test 1** | **Account Balance Real-time** | Saldo USD $1.000 dengan kurs 18.000 menampilkan Rp18.000.000. Saat kurs berubah menjadi 17.950, saldo USD tetap $1.000 dan saldo IDR berubah menjadi Rp17.950.000. |
| **Test 2** | **Swap Mata Uang Tanpa Layout Shift** | Menekan tombol swap menukar hierarki ukuran (IDR besar, USD kecil) dengan animasi halus, tanpa flicker dan tanpa mengubah saldo asli. |
| **Test 3** | **Global Conversion Dinamis** | Dengan kurs 18.000, Floating Profit $5 = Rp90.000, Floating Loss -$2 = -Rp36.000, Planned Risk $10 = Rp180.000 di seluruh modul terkait. |
| **Test 4** | **Closed Profit Terkunci** | Transaksi closed profit $1 saat kurs 18.000 menghasilkan Rp18.000. Saat kurs hari berikutnya berubah menjadi 18.200, profit historis transaksi tetap Rp18.000 (DILARANG menjadi Rp18.200). |
| **Test 5** | **Closed Loss Terkunci** | Transaksi closed loss -$2 saat kurs 18.000 menghasilkan -Rp36.000. Saat kurs berubah menjadi 18.200, loss historis tetap -Rp36.000. |
| **Test 6** | **Commission & Swap Terkunci** | Komisi dan swap pada transaksi CLOSED tetap menggunakan kurs saat penutupan dan tidak terpengaruh pergerakan kurs terbaru. |
| **Test 7** | **Invarian Data Transaksi** | Pergantian preferensi mata uang bolak-balik (USD $\leftrightarrow$ IDR) tidak memodifikasi data mentah transaksi di database/storage. |
| **Test 8** | **Integritas Transaksi Lama** | Transaksi lama yang belum memiliki snapshot kurs historis tidak diberi kurs palsu dan ditandai secara transparan sebagai *legacy*. |
| **Test 9** | **Konsistensi Antar Sesi & Sinkronisasi** | Nilai historis tetap konsisten setelah refresh halaman, sinkronisasi Supabase, serta proses backup dan restore JSON. |
| **Test 10** | **Proteksi Desain Visual** | Tampilan visual Dashboard *Seamless Black* yang sudah terpasang tetap terjaga 100% tanpa perubahan visual yang tidak diminta. |

---

## 8. APPROVAL REQUIRED (Bagian yang Membutuhkan Persetujuan Pengguna)

Sebelum kode diubah, mohon konfirmasi persetujuan Anda mengenai poin-poin berikut:

1. **Penanganan Transaksi Lama yang Belum Memiliki Snapshot Kurs:**
   - *Rekomendasi:* Transaksi lama yang ditutup sebelum fitur ini dibuat akan tetap menampilkan nominal aslinya dalam USD. Jika pengguna memilih IDR, transaksi lama dapat menampilkan estimasi dengan penanda *(Legacy/Unverified)* atau tetap mengutamakan USD murni, agar tidak ada kurs fiktif yang dimasukkan secara sepihak.
2. **Persetujuan Mulai Implementasi:**
   - Apakah rancangan alur konversi global, struktur file yang terdampak, dan 10 skenario pengujian di atas telah disetujui untuk mulai dikerjakan?
