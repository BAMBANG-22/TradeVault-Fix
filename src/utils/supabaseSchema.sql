-- ====================================================================
-- SKRIP SQL LENGKAP TRADEVAULT JOURNAL UNTUK SUPABASE
-- Jalankan skrip ini di SQL Editor pada Supabase Dashboard Anda.
-- ====================================================================

-- 1. Buat Tabel Transaksi (trades)
CREATE TABLE IF NOT EXISTS public.trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    trade_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    instrument TEXT NOT NULL DEFAULT 'XAUUSD',
    direction TEXT NOT NULL CHECK (direction IN ('Buy', 'Sell')),
    setup TEXT NOT NULL,
    entry_price NUMERIC NOT NULL,
    stop_loss NUMERIC NOT NULL,
    take_profit NUMERIC NOT NULL,
    exit_price NUMERIC,
    lot_size NUMERIC NOT NULL DEFAULT 0.01,
    outcome TEXT NOT NULL CHECK (outcome IN ('WIN', 'LOSS', 'BREAKEVEN')),
    net_pnl NUMERIC NOT NULL DEFAULT 0,
    commission NUMERIC NOT NULL DEFAULT 0,
    swap NUMERIC NOT NULL DEFAULT 0,
    screenshot_url TEXT,
    notes TEXT,
    trading_session TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index untuk mempercepat query berdasarkan user_id dan tanggal transaksi
CREATE INDEX IF NOT EXISTS idx_trades_user_tradedate ON public.trades(user_id, trade_date DESC);

-- 2. Buat Tabel Pengaturan Akun (user_settings)
CREATE TABLE IF NOT EXISTS public.user_settings (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    currency TEXT NOT NULL DEFAULT 'USD',
    currency_symbol TEXT NOT NULL DEFAULT '$',
    starting_balance NUMERIC NOT NULL DEFAULT 10000,
    xauusd_contract_size NUMERIC NOT NULL DEFAULT 100,
    xauusd_point_value NUMERIC NOT NULL DEFAULT 0.01,
    broker_commission_per_lot NUMERIC NOT NULL DEFAULT 6,
    default_risk_percent NUMERIC NOT NULL DEFAULT 1.0,
    max_daily_loss_percent NUMERIC NOT NULL DEFAULT 3.0,
    max_daily_loss_amount NUMERIC NOT NULL DEFAULT 300,
    max_consecutive_loss_limit INTEGER NOT NULL DEFAULT 3,
    target_monthly_return_percent NUMERIC NOT NULL DEFAULT 8,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ====================================================================
-- 3. ROW LEVEL SECURITY (RLS) - KEAMANAN DATA PENGGUNA
-- ====================================================================

-- Aktifkan RLS pada tabel trades
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;

-- Kebijakan Akses (Policy) untuk tabel trades:
-- Hanya pemilik data (auth.uid() = user_id) yang dapat melihat, menambah, mengubah, dan menghapus.

DROP POLICY IF EXISTS "Pengguna hanya dapat melihat trade miliknya" ON public.trades;
CREATE POLICY "Pengguna hanya dapat melihat trade miliknya"
    ON public.trades FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Pengguna hanya dapat menambah trade untuk dirinya" ON public.trades;
CREATE POLICY "Pengguna hanya dapat menambah trade untuk dirinya"
    ON public.trades FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Pengguna hanya dapat mengubah trade miliknya" ON public.trades;
CREATE POLICY "Pengguna hanya dapat mengubah trade miliknya"
    ON public.trades FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Pengguna hanya dapat menghapus trade miliknya" ON public.trades;
CREATE POLICY "Pengguna hanya dapat menghapus trade miliknya"
    ON public.trades FOR DELETE
    USING (auth.uid() = user_id);

-- Aktifkan RLS pada tabel user_settings
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Pengguna hanya dapat melihat pengaturan miliknya" ON public.user_settings;
CREATE POLICY "Pengguna hanya dapat melihat pengaturan miliknya"
    ON public.user_settings FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Pengguna hanya dapat menyimpan pengaturannya" ON public.user_settings;
CREATE POLICY "Pengguna hanya dapat menyimpan pengaturannya"
    ON public.user_settings FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Pengguna hanya dapat memperbarui pengaturannya" ON public.user_settings;
CREATE POLICY "Pengguna hanya dapat memperbarui pengaturannya"
    ON public.user_settings FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Pengguna hanya dapat menghapus pengaturannya" ON public.user_settings;
CREATE POLICY "Pengguna hanya dapat menghapus pengaturannya"
    ON public.user_settings FOR DELETE
    USING (auth.uid() = user_id);

-- ====================================================================
-- 4. STORAGE BUCKET PRIVAT UNTUK SCREENSHOT CHART (trade-screenshots)
-- ====================================================================

-- Buat atau perbarui storage bucket privat (public = false) untuk screenshot chart
INSERT INTO storage.buckets (id, name, public)
VALUES ('trade-screenshots', 'trade-screenshots', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Hapus policy baca publik lama jika pernah dibuat sebelumnya
DROP POLICY IF EXISTS "Akses publik untuk membaca screenshot" ON storage.objects;

-- Kebijakan Akses Storage Privat:
-- Hanya pengguna terautentikasi yang dapat mengakses foldernya sendiri: (storage.foldername(name))[1] = auth.uid()::text

-- 1. SELECT: Pengguna hanya dapat membaca/membuat Signed URL untuk screenshot di foldernya sendiri
DROP POLICY IF EXISTS "Pengguna hanya dapat membaca screenshot miliknya" ON storage.objects;
CREATE POLICY "Pengguna hanya dapat membaca screenshot miliknya"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'trade-screenshots' AND
        (storage.foldername(name))[1] = auth.uid()::text
    );

-- 2. INSERT: Pengguna hanya dapat mengunggah file screenshot ke foldernya sendiri
DROP POLICY IF EXISTS "Pengguna dapat mengunggah screenshot miliknya" ON storage.objects;
CREATE POLICY "Pengguna dapat mengunggah screenshot miliknya"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'trade-screenshots' AND
        (storage.foldername(name))[1] = auth.uid()::text
    );

-- 3. UPDATE: Pengguna hanya dapat memperbarui screenshot di foldernya sendiri (mendukung opsi upsert)
DROP POLICY IF EXISTS "Pengguna dapat memperbarui screenshot miliknya" ON storage.objects;
CREATE POLICY "Pengguna dapat memperbarui screenshot miliknya"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'trade-screenshots' AND
        (storage.foldername(name))[1] = auth.uid()::text
    )
    WITH CHECK (
        bucket_id = 'trade-screenshots' AND
        (storage.foldername(name))[1] = auth.uid()::text
    );

-- 4. DELETE: Pengguna hanya dapat menghapus screenshot di foldernya sendiri
DROP POLICY IF EXISTS "Pengguna dapat menghapus screenshot miliknya" ON storage.objects;
CREATE POLICY "Pengguna dapat menghapus screenshot miliknya"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'trade-screenshots' AND
        (storage.foldername(name))[1] = auth.uid()::text
    );

-- ====================================================================
-- 5. TABEL CACHE ANALISIS MAKRO & BERITA XAU/USD (macro_news_snapshots)
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.macro_news_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instrument TEXT NOT NULL DEFAULT 'XAUUSD',
    data_fingerprint TEXT NOT NULL,
    snapshot_payload JSONB NOT NULL,
    impact_level TEXT NOT NULL DEFAULT 'MEDIUM',
    dominant_bias TEXT NOT NULL DEFAULT 'MIXED',
    source_mode TEXT NOT NULL DEFAULT 'AI',
    analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_macro_news_snapshots_analyzed_at
    ON public.macro_news_snapshots(instrument, analyzed_at DESC);

ALTER TABLE public.macro_news_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Semua pengguna dapat membaca cache macro_news_snapshots" ON public.macro_news_snapshots;
CREATE POLICY "Semua pengguna dapat membaca cache macro_news_snapshots"
    ON public.macro_news_snapshots FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Semua pengguna dapat menyimpan cache macro_news_snapshots" ON public.macro_news_snapshots;
DROP POLICY IF EXISTS "Pengguna terautentikasi dapat menyimpan cache macro_news_snapshots" ON public.macro_news_snapshots;
CREATE POLICY "Pengguna terautentikasi dapat menyimpan cache macro_news_snapshots"
    ON public.macro_news_snapshots FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() IS NOT NULL);

