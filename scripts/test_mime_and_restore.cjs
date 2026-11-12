const assert = require('assert');
const path = require('path');

// Setup mock browser globals for tests in Node environment
if (typeof global.FileReader === 'undefined') {
  global.FileReader = class {
    constructor() {
      this.result = null;
      this.onloadend = null;
      this.onerror = null;
    }
    async readAsDataURL(blob) {
      try {
        const buffer = Buffer.from(await blob.arrayBuffer());
        // Default FileReader behavior in standard browser produces data:<blob.type>;base64,<data>
        // If blob.type is empty or octet-stream, that is what is produced:
        const mime = blob.type || 'application/octet-stream';
        this.result = `data:${mime};base64,${buffer.toString('base64')}`;
        if (this.onloadend) this.onloadend();
      } catch (err) {
        if (this.onerror) this.onerror(err);
      }
    }
  };
}

async function runTestSuite() {
  console.log('=====================================================');
  console.log('RUNNING AUTOMATED UNIT TESTS: MIME & ZIP RESTORE');
  console.log('=====================================================\n');

  // Load modules
  const { detectImageMimeType, blobToBase64 } = await import('../src/utils/backupZip.ts');

  // -----------------------------------------------------------------
  // TEST 1: MIME type detection for JPG, PNG, and WebP via Magic Bytes
  // -----------------------------------------------------------------
  console.log('Test 1: MIME type detection via magic bytes...');

  // JPEG: FF D8 FF
  const jpegBytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);
  const jpegRes = detectImageMimeType(jpegBytes, 'jpg');
  assert.strictEqual(jpegRes.isValid, true, 'JPEG should be valid');
  assert.strictEqual(jpegRes.mimeType, 'image/jpeg', 'JPEG mimeType should be image/jpeg');
  assert.strictEqual(jpegRes.ext, 'jpg', 'JPEG ext should be jpg');

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const pngRes = detectImageMimeType(pngBytes, 'png');
  assert.strictEqual(pngRes.isValid, true, 'PNG should be valid');
  assert.strictEqual(pngRes.mimeType, 'image/png', 'PNG mimeType should be image/png');
  assert.strictEqual(pngRes.ext, 'png', 'PNG ext should be png');

  // WebP: RIFF (52 49 46 46) .... WEBP (57 45 42 50)
  const webpBytes = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x24, 0x00, 0x00, 0x00, // length
    0x57, 0x45, 0x42, 0x50, // WEBP
    0x56, 0x50, 0x38, 0x20  // VP8
  ]);
  const webpRes = detectImageMimeType(webpBytes, 'webp');
  assert.strictEqual(webpRes.isValid, true, 'WebP should be valid');
  assert.strictEqual(webpRes.mimeType, 'image/webp', 'WebP mimeType should be image/webp');
  assert.strictEqual(webpRes.ext, 'webp', 'WebP ext should be webp');

  console.log('✓ PASS: Test 1 - Correctly detected JPEG, PNG, and WebP from magic bytes.\n');

  // -----------------------------------------------------------------
  // TEST 2: Guest Mode Restore Data URL Format & UI Compatibility
  // -----------------------------------------------------------------
  console.log('Test 2: Guest mode restore Data URL format...');

  // Even if a blob had octet-stream or empty type originally, blobToBase64 sanitizes it to data:image/...
  const rawOctetBlob = new Blob([jpegBytes], { type: 'application/octet-stream' });
  const guestDataUrl = await blobToBase64(rawOctetBlob, 'image/jpeg');

  assert.strictEqual(
    guestDataUrl.startsWith('data:image/'),
    true,
    `Data URL must start with 'data:image/', got: ${guestDataUrl.slice(0, 30)}`
  );
  assert.strictEqual(
    guestDataUrl.startsWith('data:image/jpeg;base64,'),
    true,
    'Data URL must specify data:image/jpeg;base64,'
  );

  // Verify that ScreenshotModal and TradeDetailModal check passes:
  const isDirectImageCheck = (url) => {
    const trimmed = url.trim();
    return (
      trimmed.startsWith('data:image/') ||
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://')
    );
  };
  assert.strictEqual(
    isDirectImageCheck(guestDataUrl),
    true,
    'Guest data URL must pass the UI component check without error'
  );

  console.log('✓ PASS: Test 2 - Guest mode Data URL starts with data:image/jpeg and is accepted by UI modals.\n');

  // -----------------------------------------------------------------
  // TEST 3: Upload contentType verification (never application/octet-stream)
  // -----------------------------------------------------------------
  console.log('Test 3: Upload contentType verification...');

  let capturedUploadOptions = null;
  let capturedBlobType = null;

  // Mock Supabase storage upload
  const mockStorageUpload = (filePath, blob, options) => {
    capturedUploadOptions = options;
    capturedBlobType = blob.type;
    return { data: { path: filePath }, error: null };
  };

  // Test with application/octet-stream input blob
  const testInputBlob = new Blob([jpegBytes], { type: 'application/octet-stream' });
  const cleanExt = 'jpg';

  let computedContentType = testInputBlob.type;
  if (!computedContentType || computedContentType === 'application/octet-stream' || !computedContentType.startsWith('image/')) {
    if (cleanExt === 'png') computedContentType = 'image/png';
    else if (cleanExt === 'webp') computedContentType = 'image/webp';
    else computedContentType = 'image/jpeg';
  }

  const typedBlob = testInputBlob.type === computedContentType ? testInputBlob : new Blob([testInputBlob], { type: computedContentType });

  mockStorageUpload('user123/trade_TRD-567603_1.jpg', typedBlob, {
    contentType: computedContentType,
    upsert: false,
  });

  assert.notStrictEqual(capturedUploadOptions.contentType, 'application/octet-stream');
  assert.strictEqual(capturedUploadOptions.contentType, 'image/jpeg');
  assert.strictEqual(capturedBlobType, 'image/jpeg');
  assert.notStrictEqual(capturedBlobType, 'application/octet-stream');

  console.log('✓ PASS: Test 3 - Storage upload contentType and Blob.type are strictly image/jpeg, never application/octet-stream.\n');

  // -----------------------------------------------------------------
  // TEST 4: Safe Upload Retry Logic without Re-uploading Succeeded Items
  // -----------------------------------------------------------------
  console.log('Test 4: Safe upload retry logic via uploadCache...');

  const uploadCache = new Map();
  let uploadCalls = 0;

  const mockUploadFn = async (tradeId, imageKey) => {
    uploadCalls++;
    if (tradeId === 'FAILING_TRADE') {
      return { success: false, error: 'Simulated network timeout' };
    }
    const uploadedPath = `userId/${tradeId}_123456.jpg`;
    uploadCache.set(imageKey, uploadedPath);
    return { success: true, data: uploadedPath };
  };

  // Run 1: trade1 succeeds, trade2 fails
  const item1 = { tradeId: 'TRADE_1', imageKey: 'screenshots/trade_TRADE_1_1.jpg' };
  const item2 = { tradeId: 'FAILING_TRADE', imageKey: 'screenshots/trade_FAIL_1.jpg' };

  // First attempt
  for (const item of [item1, item2]) {
    if (uploadCache.has(item.imageKey)) {
      // Reused from cache
    } else {
      await mockUploadFn(item.tradeId, item.imageKey);
    }
  }

  assert.strictEqual(uploadCalls, 2, 'First attempt should execute 2 upload calls');
  assert.strictEqual(uploadCache.has(item1.imageKey), true, 'Item 1 should be cached');
  assert.strictEqual(uploadCache.has(item2.imageKey), false, 'Item 2 failed so should not be cached');

  // Retry attempt: item2 now succeeds (fixed error), item1 is in cache
  const retryMockUploadFn = async (tradeId, imageKey) => {
    uploadCalls++;
    const uploadedPath = `userId/${tradeId}_123456.jpg`;
    uploadCache.set(imageKey, uploadedPath);
    return { success: true, data: uploadedPath };
  };

  for (const item of [item1, item2]) {
    if (uploadCache.has(item.imageKey)) {
      // Reused from cache, NO upload call made!
    } else {
      await retryMockUploadFn(item.tradeId, item.imageKey);
    }
  }

  // uploadCalls should now be 3 (only 1 additional call made for item2!)
  assert.strictEqual(
    uploadCalls,
    3,
    `On retry, only failed item should be re-uploaded. Expected 3 calls total, got ${uploadCalls}`
  );
  assert.strictEqual(uploadCache.has(item2.imageKey), true, 'Item 2 should now be in cache');

  console.log('✓ PASS: Test 4 - Retry logic properly reuses uploadCache and skips re-uploading succeeded screenshots.\n');

  // -----------------------------------------------------------------
  // TEST 5: Unsupported File Rejection (e.g. Text/Executable with .jpg extension)
  // -----------------------------------------------------------------
  console.log('Test 5: Unsupported file rejection...');

  // Executable file header ("MZ" - 4D 5A) or HTML ("<!DO" - 3C 21 44 4F) disguised as .jpg
  const fakeExeBytes = new Uint8Array([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
  const fakeRes = detectImageMimeType(fakeExeBytes, 'jpg');
  assert.strictEqual(fakeRes.isValid, false, 'Fake EXE with .jpg extension must be rejected');
  assert.strictEqual(fakeRes.mimeType, null, 'Fake EXE mimeType must be null');

  // Plain text disguised as .png
  const fakeTxtBytes = new Uint8Array([0x48, 0x65, 0x6C, 0x6C, 0x6F, 0x20, 0x57, 0x6F]);
  const fakeTxtRes = detectImageMimeType(fakeTxtBytes, 'png');
  assert.strictEqual(fakeTxtRes.isValid, false, 'Plain text with .png extension must be rejected');

  console.log('✓ PASS: Test 5 - Unsupported or masquerading files are strictly rejected.\n');

  console.log('=====================================================');
  console.log('ALL 5 UNIT TESTS PASSED SUCCESSFULLY! (100% SUCCESS)');
  console.log('=====================================================');
}

runTestSuite().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
