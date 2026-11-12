package com.tradevault.journal;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(name = "SafExport")
public class SafExportPlugin extends Plugin {

    private static final String TAG = "SafExportPlugin";
    private static final String STAGING_PREFIX = "tv_stage_";
    private static final String STAGING_TMP_SUFFIX = ".tmp";
    private static final String STAGING_META_SUFFIX = ".meta";
    private static final String STAGING_META_TMP_SUFFIX = ".meta.tmp";
    private static final Pattern STAGING_ID_PATTERN = Pattern.compile("^[a-zA-Z0-9_]{1,64}$");

    public static final String STATE_WRITING = "WRITING";
    public static final String STATE_AWAITING_SAF = "AWAITING_SAF";
    public static final String STATE_COPYING = "COPYING";

    /**
     * Identitas unik proses JVM saat ini untuk membedakan sesi aktif pada proses berjalan
     * dari metadata yatim yang tertinggal akibat force-stop atau crash proses sebelumnya.
     */
    private static final String PROCESS_BOOT_ID = UUID.randomUUID().toString();

    private static final String BUNDLE_KEY_ACTIVE_EXPORT_ID = "tv_active_export_staging_id";
    private static final String BUNDLE_KEY_ACTIVE_SAF_ID = "tv_active_saf_staging_id";

    /**
     * Kebijakan umur maksimum (TTL) berbasis state:
     * - WRITING: 30 menit tanpa chunk baru dianggap terputus.
     * - AWAITING_SAF (proses hidup yang sama): hingga 24 jam agar dialog Save As yang dibiarkan
     *   terbuka > 30 menit tidak pernah dihapus oleh sweeper.
     * - AWAITING_SAF (proses berbeda / pasca-recreation atau force-stop): 6 jam, cukup untuk
     *   melindungi Activity/process recreation saat pengguna berada di dokumen picker > 30 menit,
     *   sekaligus menjamin file yatim pasca force-stop tidak tersimpan selamanya.
     * - COPYING: dilindungi baik oleh ACTIVE_COPYING_IDS di RAM maupun state persisten COPYING
     *   di .meta; jika tertinggal akibat force-stop, dipulihkan setelah 2 jam tanpa pembaruan.
     */
    private static final long WRITING_MAX_AGE_MS = 30L * 60L * 1000L; // 30 minutes
    private static final long AWAITING_SAF_LIVE_PROCESS_TTL_MS = 24L * 60L * 60L * 1000L; // 24 hours
    private static final long AWAITING_SAF_ORPHAN_RECOVERY_TTL_MS = 6L * 60L * 60L * 1000L; // 6 hours
    private static final long COPYING_ORPHAN_RECOVERY_TTL_MS = 2L * 60L * 60L * 1000L; // 2 hours
    private static final long COPYING_HEARTBEAT_INTERVAL_MS = 15L * 1000L; // 15 seconds

    private static final int COPY_BUFFER_SIZE = 8192; // 8 KB

    private static final Object STAGING_LOCK = new Object();
    private static final Set<String> ACTIVE_COPYING_IDS = new HashSet<>();
    private static String activeExportStagingId = null;
    private static String activeSafDialogStagingId = null;
    private static final ExecutorService IO_EXECUTOR = Executors.newSingleThreadExecutor();

    @Override
    public void load() {
        super.load();
        IO_EXECUTOR.execute(this::sweepExpiredStagingFiles);
    }

    @Override
    protected Bundle saveInstanceState() {
        Bundle bundle = super.saveInstanceState();
        if (bundle == null) {
            bundle = new Bundle();
        }
        synchronized (STAGING_LOCK) {
            if (activeExportStagingId != null) {
                bundle.putString(BUNDLE_KEY_ACTIVE_EXPORT_ID, activeExportStagingId);
            }
            if (activeSafDialogStagingId != null) {
                bundle.putString(BUNDLE_KEY_ACTIVE_SAF_ID, activeSafDialogStagingId);
            }
        }
        return bundle;
    }

    @Override
    protected void restoreState(Bundle state) {
        super.restoreState(state);
        if (state == null) {
            return;
        }
        final String restoredExportId = state.getString(BUNDLE_KEY_ACTIVE_EXPORT_ID);
        final String restoredSafId = state.getString(BUNDLE_KEY_ACTIVE_SAF_ID);

        synchronized (STAGING_LOCK) {
            if (isValidStagingId(restoredExportId) && activeExportStagingId == null) {
                activeExportStagingId = restoredExportId;
            }
            if (isValidStagingId(restoredSafId) && activeSafDialogStagingId == null) {
                activeSafDialogStagingId = restoredSafId;
            }
        }

        if (isValidStagingId(restoredSafId)) {
            IO_EXECUTOR.execute(() -> {
                synchronized (STAGING_LOCK) {
                    try {
                        if (getContext() == null) return;
                        File cacheDir = getContext().getCacheDir();
                        File stagingFile = getStagingTmpFile(cacheDir, restoredSafId);
                        File metaFile = getStagingMetaFile(cacheDir, restoredSafId);
                        if (stagingFile.exists() && metaFile.exists()) {
                            JSONObject meta = readMetaLocked(metaFile);
                            long now = System.currentTimeMillis();
                            long createdAt = meta != null ? meta.optLong("createdAt", now) : now;
                            int nextChunkIndex = meta != null ? meta.optInt("nextChunkIndex", 1) : 1;
                            String currentState = meta != null
                                ? meta.optString("state", STATE_AWAITING_SAF)
                                : STATE_AWAITING_SAF;
                            writeMetaLocked(
                                cacheDir,
                                metaFile,
                                restoredSafId,
                                createdAt,
                                now,
                                nextChunkIndex,
                                stagingFile.length(),
                                currentState
                            );
                        }
                    } catch (Exception e) {
                        Logger.warn(TAG, "Gagal menyegarkan metadata saat restoreState: " + e.getMessage());
                    }
                }
            });
        }
    }

    @PluginMethod
    public void writeStagingChunk(PluginCall call) {
        final String stagingId = call.getString("stagingId");
        final String base64Chunk = call.getString("base64Chunk");
        final Boolean appendObj = call.getBoolean("append", false);
        final boolean append = appendObj != null && appendObj;
        final Integer chunkIndexObj = call.getInt("chunkIndex");

        if (!isValidStagingId(stagingId)) {
            call.reject("Parameter stagingId tidak valid.");
            return;
        }
        if (base64Chunk == null) {
            call.reject("Parameter base64Chunk wajib diisi.");
            return;
        }

        final byte[] decodedBytes;
        try {
            decodedBytes = base64Chunk.isEmpty()
                ? new byte[0]
                : Base64.decode(base64Chunk, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("Data base64Chunk tidak valid: " + e.getMessage(), e);
            return;
        }

        IO_EXECUTOR.execute(() -> {
            synchronized (STAGING_LOCK) {
                if (isAnotherExportActiveLocked(stagingId)) {
                    call.reject(
                        "BUSY: Proses ekspor file lain sedang berlangsung di lapisan native. Selesaikan ekspor aktif terlebih dahulu."
                    );
                    return;
                }

                if (!append) {
                    activeExportStagingId = stagingId;
                    sweepExpiredStagingFilesLocked();
                }

                try {
                    File cacheDir = getContext().getCacheDir();
                    File stagingFile = getStagingTmpFile(cacheDir, stagingId);
                    File metaFile = getStagingMetaFile(cacheDir, stagingId);

                    long now = System.currentTimeMillis();
                    int expectedChunkIndex = 0;
                    long createdAt = now;

                    if (!append) {
                        if (chunkIndexObj != null && chunkIndexObj != 0) {
                            releaseActiveExportIfMatchesLocked(stagingId);
                            call.reject("Urutan chunk awal tidak valid (harus 0 saat append=false).");
                            return;
                        }
                    } else {
                        if (!stagingFile.exists() || !metaFile.exists()) {
                            releaseActiveExportIfMatchesLocked(stagingId);
                            call.reject("File staging tidak ditemukan untuk operasi append.");
                            return;
                        }
                        JSONObject existingMeta = readMetaLocked(metaFile);
                        if (existingMeta == null) {
                            releaseActiveExportIfMatchesLocked(stagingId);
                            deleteStagingFilesLocked(stagingId);
                            call.reject("Metadata staging rusak atau tidak dapat dibaca saat operasi append.");
                            return;
                        }
                        createdAt = existingMeta.optLong("createdAt", now);
                        expectedChunkIndex = existingMeta.optInt("nextChunkIndex", 1);
                        if (chunkIndexObj != null && chunkIndexObj != expectedChunkIndex) {
                            releaseActiveExportIfMatchesLocked(stagingId);
                            deleteStagingFilesLocked(stagingId);
                            call.reject(
                                "Urutan chunk tidak sesuai: diharapkan " +
                                expectedChunkIndex +
                                ", diterima " +
                                chunkIndexObj
                            );
                            return;
                        }
                    }

                    try (FileOutputStream fos = new FileOutputStream(stagingFile, append)) {
                        if (decodedBytes.length > 0) {
                            fos.write(decodedBytes);
                        }
                        fos.flush();
                    }

                    long currentLength = stagingFile.length();
                    int nextChunkIndex = (chunkIndexObj != null ? chunkIndexObj : expectedChunkIndex) + 1;
                    writeMetaLocked(
                        cacheDir,
                        metaFile,
                        stagingId,
                        createdAt,
                        now,
                        nextChunkIndex,
                        currentLength,
                        STATE_WRITING
                    );

                    JSObject ret = new JSObject();
                    ret.put("bytesStaged", currentLength);
                    ret.put("chunkIndex", nextChunkIndex - 1);
                    call.resolve(ret);
                } catch (Exception e) {
                    releaseActiveExportIfMatchesLocked(stagingId);
                    deleteStagingFilesLocked(stagingId);
                    call.reject("Gagal menulis chunk ke file staging: " + e.getMessage(), e);
                }
            }
        });
    }

    @PluginMethod
    public void saveStagedFile(PluginCall call) {
        final String stagingId = call.getString("stagingId");
        final String rawFileName = call.getString("fileName");
        final String rawMimeType = call.getString("mimeType", "application/octet-stream");

        if (!isValidStagingId(stagingId)) {
            call.reject("Parameter stagingId tidak valid.");
            return;
        }
        final String fileName = sanitizeFileName(rawFileName);
        if (fileName.isEmpty()) {
            synchronized (STAGING_LOCK) {
                if (! isAnotherExportActiveLocked(stagingId)) {
                    releaseActiveExportIfMatchesLocked(stagingId);
                }
            }
            deleteStagingAsync(stagingId);
            call.reject("Parameter fileName tidak boleh kosong.");
            return;
        }
        final String mimeType = (rawMimeType == null || rawMimeType.trim().isEmpty())
            ? "application/octet-stream"
            : rawMimeType.trim();

        synchronized (STAGING_LOCK) {
            if (
                isAnotherExportActiveLocked(stagingId) ||
                activeSafDialogStagingId != null ||
                !ACTIVE_COPYING_IDS.isEmpty()
            ) {
                call.reject(
                    "BUSY: Dialog penyimpanan dokumen (SAF) atau proses penyalinan ekspor lain sedang aktif."
                );
                return;
            }

            try {
                File cacheDir = getContext().getCacheDir();
                File stagingFile = getStagingTmpFile(cacheDir, stagingId);
                File metaFile = getStagingMetaFile(cacheDir, stagingId);

                if (!stagingFile.exists() || !metaFile.exists()) {
                    releaseActiveExportIfMatchesLocked(stagingId);
                    deleteStagingFilesLocked(stagingId);
                    call.reject("File atau metadata staging tidak ditemukan sebelum membuka dialog simpan.");
                    return;
                }

                JSONObject meta = readMetaLocked(metaFile);
                if (meta == null) {
                    releaseActiveExportIfMatchesLocked(stagingId);
                    deleteStagingFilesLocked(stagingId);
                    call.reject("Metadata staging rusak atau tidak dapat dibaca sebelum membuka dialog simpan.");
                    return;
                }

                long now = System.currentTimeMillis();
                long createdAt = meta.optLong("createdAt", now);
                int nextChunkIndex = meta.optInt("nextChunkIndex", 1);

                writeMetaLocked(
                    cacheDir,
                    metaFile,
                    stagingId,
                    createdAt,
                    now,
                    nextChunkIndex,
                    stagingFile.length(),
                    STATE_AWAITING_SAF
                );

                activeExportStagingId = stagingId;
                activeSafDialogStagingId = stagingId;
            } catch (Exception e) {
                releaseActiveExportIfMatchesLocked(stagingId);
                deleteStagingFilesLocked(stagingId);
                call.reject("Gagal memvalidasi file staging: " + e.getMessage(), e);
                return;
            }
        }

        try {
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(mimeType);
            intent.putExtra(Intent.EXTRA_TITLE, fileName);

            startActivityForResult(call, intent, "handleSaveDocumentResult");
        } catch (ActivityNotFoundException e) {
            synchronized (STAGING_LOCK) {
                releaseActiveExportIfMatchesLocked(stagingId);
            }
            deleteStagingAsync(stagingId);
            call.reject("Perangkat tidak mendukung dialog penyimpanan dokumen sistem (SAF).", e);
        } catch (Exception e) {
            synchronized (STAGING_LOCK) {
                releaseActiveExportIfMatchesLocked(stagingId);
            }
            deleteStagingAsync(stagingId);
            call.reject("Gagal membuka dialog penyimpanan dokumen: " + e.getMessage(), e);
        }
    }

    @ActivityCallback
    private void handleSaveDocumentResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            synchronized (STAGING_LOCK) {
                activeSafDialogStagingId = null;
                activeExportStagingId = null;
            }
            Logger.warn(
                TAG,
                "PluginCall bernilai null setelah Activity dibuat ulang; lock dilepas dan pembersihan staging ditangani oleh sweeper."
            );
            return;
        }

        final String stagingId = call.getString("stagingId");
        final String fileName = sanitizeFileName(call.getString("fileName"));

        if (
            result == null ||
            result.getResultCode() != Activity.RESULT_OK ||
            result.getData() == null ||
            result.getData().getData() == null
        ) {
            synchronized (STAGING_LOCK) {
                releaseActiveExportIfMatchesLocked(stagingId);
            }
            deleteStagingAsync(stagingId);
            JSObject cancelledRet = new JSObject();
            cancelledRet.put("status", "cancelled");
            call.resolve(cancelledRet);
            return;
        }

        final Uri destUri = result.getData().getData();

        IO_EXECUTOR.execute(() -> {
            File cacheDir;
            File stagingFile;
            File metaFile;
            long expectedBytes;
            long createdAt;
            int nextChunkIndex;

            synchronized (STAGING_LOCK) {
                try {
                    if (!isValidStagingId(stagingId)) {
                        releaseActiveExportIfMatchesLocked(stagingId);
                        call.reject("Parameter stagingId tidak valid saat menyelesaikan penyimpanan.");
                        return;
                    }
                    cacheDir = getContext().getCacheDir();
                    stagingFile = getStagingTmpFile(cacheDir, stagingId);
                    metaFile = getStagingMetaFile(cacheDir, stagingId);

                    if (!stagingFile.exists()) {
                        releaseActiveExportIfMatchesLocked(stagingId);
                        deleteStagingFilesLocked(stagingId);
                        call.reject("File staging tidak ditemukan saat menyalin ke lokasi tujuan.");
                        return;
                    }

                    expectedBytes = stagingFile.length();
                    ACTIVE_COPYING_IDS.add(stagingId);
                    long now = System.currentTimeMillis();
                    JSONObject meta = readMetaLocked(metaFile);
                    createdAt = meta != null ? meta.optLong("createdAt", now) : now;
                    nextChunkIndex = meta != null ? meta.optInt("nextChunkIndex", 1) : 1;

                    writeMetaLocked(
                        cacheDir,
                        metaFile,
                        stagingId,
                        createdAt,
                        now,
                        nextChunkIndex,
                        expectedBytes,
                        STATE_COPYING
                    );
                } catch (Exception e) {
                    ACTIVE_COPYING_IDS.remove(stagingId);
                    releaseActiveExportIfMatchesLocked(stagingId);
                    deleteStagingFilesLocked(stagingId);
                    call.reject("Gagal menyiapkan penyalinan file staging: " + e.getMessage(), e);
                    return;
                }
            }

            long totalBytesWritten = 0L;
            boolean copySucceeded = false;
            Exception copyException = null;
            long lastHeartbeatTime = System.currentTimeMillis();

            try {
                try (
                    InputStream in = new FileInputStream(stagingFile);
                    OutputStream out = getContext().getContentResolver().openOutputStream(destUri)
                ) {
                    if (out == null) {
                        throw new IOException("ContentResolver mengembalikan OutputStream null untuk URI tujuan.");
                    }
                    byte[] buffer = new byte[COPY_BUFFER_SIZE];
                    int bytesRead;
                    while ((bytesRead = in.read(buffer)) != -1) {
                        out.write(buffer, 0, bytesRead);
                        totalBytesWritten += bytesRead;

                        long now = System.currentTimeMillis();
                        if (now - lastHeartbeatTime >= COPYING_HEARTBEAT_INTERVAL_MS) {
                            lastHeartbeatTime = now;
                            synchronized (STAGING_LOCK) {
                                try {
                                    writeMetaLocked(
                                        cacheDir,
                                        metaFile,
                                        stagingId,
                                        createdAt,
                                        now,
                                        nextChunkIndex,
                                        expectedBytes,
                                        STATE_COPYING
                                    );
                                } catch (Exception ignored) {
                                    // Pembaruan heartbeat bersifat best-effort selama stream aktif
                                }
                            }
                        }
                    }
                    out.flush();
                }

                if (totalBytesWritten != expectedBytes) {
                    throw new IOException(
                        "Jumlah byte yang disalin (" +
                        totalBytesWritten +
                        ") tidak sesuai dengan ukuran staging (" +
                        expectedBytes +
                        ")."
                    );
                }

                copySucceeded = true;
            } catch (Exception e) {
                copyException = e;
            } finally {
                synchronized (STAGING_LOCK) {
                    ACTIVE_COPYING_IDS.remove(stagingId);
                    releaseActiveExportIfMatchesLocked(stagingId);
                    deleteStagingFilesLocked(stagingId);
                }
            }

            if (copySucceeded) {
                JSObject savedRet = new JSObject();
                savedRet.put("status", "saved");
                savedRet.put("fileName", fileName);
                savedRet.put("bytesWritten", totalBytesWritten);
                call.resolve(savedRet);
            } else {
                String message = copyException != null
                    ? copyException.getMessage()
                    : "Kesalahan penyalinan tidak diketahui";
                call.reject("Gagal menyalin data ke dokumen tujuan: " + message, copyException);
            }
        });
    }

    @PluginMethod
    public void cleanupStaging(PluginCall call) {
        final String stagingId = call.getString("stagingId");
        if (!isValidStagingId(stagingId)) {
            call.reject("Parameter stagingId tidak valid.");
            return;
        }

        IO_EXECUTOR.execute(() -> {
            synchronized (STAGING_LOCK) {
                if (
                    !ACTIVE_COPYING_IDS.contains(stagingId) &&
                    !stagingId.equals(activeSafDialogStagingId)
                ) {
                    releaseActiveExportIfMatchesLocked(stagingId);
                    deleteStagingFilesLocked(stagingId);
                }
            }
            JSObject ret = new JSObject();
            ret.put("cleaned", true);
            call.resolve(ret);
        });
    }

    private void deleteStagingAsync(final String stagingId) {
        if (!isValidStagingId(stagingId)) {
            return;
        }
        IO_EXECUTOR.execute(() -> {
            synchronized (STAGING_LOCK) {
                if (
                    !ACTIVE_COPYING_IDS.contains(stagingId) &&
                    !stagingId.equals(activeSafDialogStagingId)
                ) {
                    releaseActiveExportIfMatchesLocked(stagingId);
                    deleteStagingFilesLocked(stagingId);
                }
            }
        });
    }

    private static boolean isAnotherExportActiveLocked(String stagingId) {
        if (activeExportStagingId != null && !activeExportStagingId.equals(stagingId)) {
            return true;
        }
        if (activeSafDialogStagingId != null && !activeSafDialogStagingId.equals(stagingId)) {
            return true;
        }
        for (String copyingId : ACTIVE_COPYING_IDS) {
            if (!copyingId.equals(stagingId)) {
                return true;
            }
        }
        return false;
    }

    private static void releaseActiveExportIfMatchesLocked(String stagingId) {
        if (stagingId == null) {
            return;
        }
        if (stagingId.equals(activeSafDialogStagingId)) {
            activeSafDialogStagingId = null;
        }
        if (stagingId.equals(activeExportStagingId)) {
            activeExportStagingId = null;
        }
    }

    private void sweepExpiredStagingFiles() {
        synchronized (STAGING_LOCK) {
            sweepExpiredStagingFilesLocked();
        }
    }

    private void sweepExpiredStagingFilesLocked() {
        try {
            if (getContext() == null) return;
            File cacheDir = getContext().getCacheDir();
            if (cacheDir == null || !cacheDir.exists()) return;

            File[] files = cacheDir.listFiles();
            if (files == null) return;

            long now = System.currentTimeMillis();
            Set<String> evaluatedStagingIds = new HashSet<>();

            for (File file : files) {
                String name = file.getName();
                if (!name.startsWith(STAGING_PREFIX)) {
                    continue;
                }

                // File .meta.tmp yang ditemukan saat STAGING_LOCK dipegang adalah sisa
                // penulisan metadata yang terputus akibat crash proses sebelumnya.
                if (name.endsWith(STAGING_META_TMP_SUFFIX)) {
                    //noinspection ResultOfMethodCallIgnored
                    file.delete();
                    continue;
                }

                String stagingId = extractStagingIdFromFileName(name);
                if (stagingId == null || !evaluatedStagingIds.add(stagingId)) {
                    continue;
                }

                // Jangan pernah menghapus sesi yang sedang aktif di memori proses ini
                if (
                    ACTIVE_COPYING_IDS.contains(stagingId) ||
                    stagingId.equals(activeSafDialogStagingId) ||
                    stagingId.equals(activeExportStagingId)
                ) {
                    continue;
                }

                File metaFile = new File(cacheDir, STAGING_PREFIX + stagingId + STAGING_META_SUFFIX);
                JSONObject meta = readMetaLocked(metaFile);

                // Jika .meta tidak ada atau rusak/tidak terbaca, bersihkan secara deterministik
                if (meta == null) {
                    deleteStagingFilesLocked(stagingId);
                    continue;
                }

                String state = meta.optString("state", "");
                long updatedAt = meta.optLong("updatedAt", -1L);
                String metaProcessId = meta.optString("processId", "");

                if (updatedAt <= 0L || !isValidMetaState(state)) {
                    deleteStagingFilesLocked(stagingId);
                    continue;
                }

                long ageMs = Math.max(0L, now - updatedAt);
                boolean isCurrentProcess = PROCESS_BOOT_ID.equals(metaProcessId);
                boolean shouldDelete = false;

                if (STATE_COPYING.equals(state)) {
                    // Perlindungan berlapis berbasis metadata persisten:
                    // Sesi COPYING tidak dihapus meskipun ACTIVE_COPYING_IDS di RAM kosong,
                    // kecuali umur pembaruan melebihi batas pemulihan yatim pasca force-stop (2 jam).
                    if (!isCurrentProcess && ageMs > COPYING_ORPHAN_RECOVERY_TTL_MS) {
                        shouldDelete = true;
                    } else if (ageMs > COPYING_ORPHAN_RECOVERY_TTL_MS) {
                        shouldDelete = true;
                    }
                } else if (STATE_AWAITING_SAF.equals(state)) {
                    // Jangan menghapus sesi AWAITING_SAF hanya karena dialog Save As terbuka > 30 menit.
                    // Pada proses hidup yang sama dilindungi hingga 24 jam; pada proses berbeda
                    // (pasca Activity/process recreation atau force-stop) dilindungi hingga 6 jam.
                    long maxAllowedSafAge = isCurrentProcess
                        ? AWAITING_SAF_LIVE_PROCESS_TTL_MS
                        : AWAITING_SAF_ORPHAN_RECOVERY_TTL_MS;
                    if (ageMs > maxAllowedSafAge) {
                        shouldDelete = true;
                    }
                } else if (STATE_WRITING.equals(state)) {
                    if (ageMs > WRITING_MAX_AGE_MS) {
                        shouldDelete = true;
                    }
                }

                if (shouldDelete) {
                    deleteStagingFilesLocked(stagingId);
                }
            }
        } catch (Exception e) {
            Logger.warn(TAG, "Gagal menjalankan pembersihan file staging yatim: " + e.getMessage());
        }
    }

    private static boolean isValidMetaState(String state) {
        return (
            STATE_WRITING.equals(state) ||
            STATE_AWAITING_SAF.equals(state) ||
            STATE_COPYING.equals(state)
        );
    }

    private void deleteStagingFilesLocked(String stagingId) {
        if (!isValidStagingId(stagingId) || getContext() == null) {
            return;
        }
        File cacheDir = getContext().getCacheDir();
        if (cacheDir == null) return;

        File tmpFile = new File(cacheDir, STAGING_PREFIX + stagingId + STAGING_TMP_SUFFIX);
        File metaFile = new File(cacheDir, STAGING_PREFIX + stagingId + STAGING_META_SUFFIX);
        File metaTmpFile = new File(cacheDir, STAGING_PREFIX + stagingId + STAGING_META_TMP_SUFFIX);

        if (tmpFile.exists()) {
            //noinspection ResultOfMethodCallIgnored
            tmpFile.delete();
        }
        if (metaFile.exists()) {
            //noinspection ResultOfMethodCallIgnored
            metaFile.delete();
        }
        if (metaTmpFile.exists()) {
            //noinspection ResultOfMethodCallIgnored
            metaTmpFile.delete();
        }
    }

    private static boolean isValidStagingId(String stagingId) {
        return stagingId != null && STAGING_ID_PATTERN.matcher(stagingId).matches();
    }

    private static String sanitizeFileName(String rawFileName) {
        if (rawFileName == null) return "";
        return rawFileName.replace("\0", "").replace("/", "_").replace("\\", "_").trim();
    }

    private static String extractStagingIdFromFileName(String fileName) {
        if (!fileName.startsWith(STAGING_PREFIX)) return null;
        if (fileName.endsWith(STAGING_META_TMP_SUFFIX)) {
            String candidate = fileName.substring(
                STAGING_PREFIX.length(),
                fileName.length() - STAGING_META_TMP_SUFFIX.length()
            );
            return isValidStagingId(candidate) ? candidate : null;
        }
        if (fileName.endsWith(STAGING_TMP_SUFFIX)) {
            String candidate = fileName.substring(
                STAGING_PREFIX.length(),
                fileName.length() - STAGING_TMP_SUFFIX.length()
            );
            return isValidStagingId(candidate) ? candidate : null;
        }
        if (fileName.endsWith(STAGING_META_SUFFIX)) {
            String candidate = fileName.substring(
                STAGING_PREFIX.length(),
                fileName.length() - STAGING_META_SUFFIX.length()
            );
            return isValidStagingId(candidate) ? candidate : null;
        }
        return null;
    }

    private static File getStagingTmpFile(File cacheDir, String stagingId) throws IOException {
        File target = new File(cacheDir, STAGING_PREFIX + stagingId + STAGING_TMP_SUFFIX);
        ensureInsideCacheDir(cacheDir, target);
        return target;
    }

    private static File getStagingMetaFile(File cacheDir, String stagingId) throws IOException {
        File target = new File(cacheDir, STAGING_PREFIX + stagingId + STAGING_META_SUFFIX);
        ensureInsideCacheDir(cacheDir, target);
        return target;
    }

    private static File getStagingMetaTmpFile(File cacheDir, String stagingId) throws IOException {
        File target = new File(cacheDir, STAGING_PREFIX + stagingId + STAGING_META_TMP_SUFFIX);
        ensureInsideCacheDir(cacheDir, target);
        return target;
    }

    private static void ensureInsideCacheDir(File cacheDir, File target) throws IOException {
        String canonicalCache = cacheDir.getCanonicalPath();
        String canonicalTarget = target.getCanonicalPath();
        if (!canonicalTarget.startsWith(canonicalCache + File.separator)) {
            throw new SecurityException("Jalur file staging berada di luar direktori cache aplikasi.");
        }
    }

    private static void writeMetaLocked(
        File cacheDir,
        File metaFile,
        String stagingId,
        long createdAt,
        long updatedAt,
        int nextChunkIndex,
        long bytesStaged,
        String state
    ) throws IOException, JSONException {
        if (cacheDir == null || metaFile == null) {
            throw new IOException("Target file metadata staging tidak valid.");
        }
        File metaTmpFile = getStagingMetaTmpFile(cacheDir, stagingId);

        JSONObject meta = new JSONObject();
        meta.put("stagingId", stagingId);
        meta.put("createdAt", createdAt);
        meta.put("updatedAt", updatedAt);
        meta.put("nextChunkIndex", nextChunkIndex);
        meta.put("bytesStaged", bytesStaged);
        meta.put("state", state);
        meta.put("processId", PROCESS_BOOT_ID);

        byte[] bytes = meta.toString().getBytes(StandardCharsets.UTF_8);
        try (FileOutputStream fos = new FileOutputStream(metaTmpFile, false)) {
            fos.write(bytes);
            fos.flush();
            try {
                fos.getFD().sync();
            } catch (IOException ignored) {
                // Beberapa sistem file tidak mendukung sync descriptor; flush stream tetap selesai
            }
        } catch (IOException e) {
            if (metaTmpFile.exists()) {
                //noinspection ResultOfMethodCallIgnored
                metaTmpFile.delete();
            }
            throw e;
        }

        boolean replaced = metaTmpFile.renameTo(metaFile);
        if (!replaced) {
            if (metaFile.exists() && !metaFile.delete()) {
                if (metaTmpFile.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    metaTmpFile.delete();
                }
                throw new IOException("Gagal menghapus metadata lama saat penggantian atomik.");
            }
            replaced = metaTmpFile.renameTo(metaFile);
        }

        if (!replaced) {
            if (metaTmpFile.exists()) {
                //noinspection ResultOfMethodCallIgnored
                metaTmpFile.delete();
            }
            throw new IOException("Gagal mengganti file metadata staging secara atomik.");
        }
    }

    private static JSONObject readMetaLocked(File metaFile) {
        if (metaFile == null || !metaFile.exists()) return null;
        try (FileInputStream fis = new FileInputStream(metaFile)) {
            long fileLen = metaFile.length();
            if (fileLen <= 0L || fileLen > 65536L) return null;
            byte[] data = new byte[(int) fileLen];
            int totalRead = 0;
            while (totalRead < data.length) {
                int read = fis.read(data, totalRead, data.length - totalRead);
                if (read == -1) break;
                totalRead += read;
            }
            if (totalRead <= 0) return null;
            return new JSONObject(new String(data, 0, totalRead, StandardCharsets.UTF_8));
        } catch (Exception e) {
            return null;
        }
    }
}
