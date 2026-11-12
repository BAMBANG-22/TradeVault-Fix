import { Trade, TradeOutcome, TradePosition, HistoricalExchangeRateSnapshot } from '../types/trade';
import { AppSettings, CurrencyCode } from '../types/settings';

/**
 * Phase 1 Strict Database Isolation Constants.
 * In Phase 1, ONLY 'tradevault_idb_test' is permitted to be opened.
 * 'tradevault_idb' is reserved for future phases and is strictly blocked in Phase 1.
 */
export const PHASE_1_TEST_DB_NAME = 'tradevault_idb_test' as const;
export const PRODUCTION_DB_NAME_BLOCKED_IN_PHASE_1 = 'tradevault_idb' as const;
export const LOCAL_DB_SCHEMA_VERSION = 1 as const;

export const LOCAL_DB_TABLES = {
  TRADES: 'trades',
  SETTINGS: 'settings',
  SCREENSHOT_METADATA: 'screenshot_metadata',
  SCREENSHOT_FILES: 'screenshot_files',
  OUTBOX_SYNC_QUEUE: 'outbox_sync_queue',
  MIGRATION_STATE: 'migration_state',
  QUARANTINED_RECORDS: 'quarantined_records',
} as const;

export type LocalTableName = (typeof LOCAL_DB_TABLES)[keyof typeof LOCAL_DB_TABLES];

/**
 * Scope identifier isolating GUEST data from each authenticated user account.
 */
export type OwnerScope = 'GUEST' | string;

export type SyncStatus =
  | 'LOCAL_ONLY'
  | 'PENDING_SYNC'
  | 'SYNCING'
  | 'SYNCED'
  | 'SYNC_CONFLICT'
  | 'SYNC_FAILED';

export type ScreenshotLifecycleStatus = 'STAGED' | 'ACTIVE' | 'PENDING_DELETE';

export type ScreenshotUploadStatus =
  | 'LOCAL_ONLY'
  | 'PENDING_UPLOAD'
  | 'UPLOADING'
  | 'SYNCED'
  | 'UPLOAD_FAILED';

/**
 * Migration status semantics:
 * - IN_PROGRESS: Shadow migration is currently executing.
 * - VERIFIED_SHADOW: Shadow copy in IndexedDB has been verified against source snapshot and per-record canonical digests.
 *   NOTE: VERIFIED_SHADOW does NOT mean IndexedDB is the active source of truth. localStorage remains the sole active source of truth in Phase 1.
 * - COMPLETED_WITH_QUARANTINE: Valid records were verified and stored, while malformed source records/assets were isolated in quarantined_records.
 * - FAILED: Migration failed due to write error, read-back digest mismatch, or source snapshot mutation; rolled back / rejected.
 */
export type MigrationStatus =
  | 'IN_PROGRESS'
  | 'VERIFIED_SHADOW'
  | 'COMPLETED_WITH_QUARANTINE'
  | 'FAILED';

export type OutboxEntityType = 'TRADE' | 'SETTINGS' | 'SCREENSHOT';

export type OutboxOperationType =
  | 'INSERT_TRADE'
  | 'UPDATE_TRADE'
  | 'DELETE_TRADE'
  | 'UPSERT_SETTINGS'
  | 'UPLOAD_SCREENSHOT'
  | 'DELETE_SCREENSHOT';

export type OutboxQueueStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED_RETRYABLE'
  | 'FAILED_FATAL';

export type CorruptionScope =
  | 'TOP_LEVEL_JSON'
  | 'ARRAY_ITEM_RECORD'
  | 'SETTINGS_RECORD'
  | 'SCREENSHOT_DECODE_FAILURE';

/**
 * Entity 1: trades
 * Preserves all 27 properties of the application Trade interface plus local-first identity,
 * scope isolation, and compare-and-swap revision metadata.
 */
export interface LocalTradeRow {
  /** Global primary key (UUID v4 lowercase) */
  canonical_uuid: string;
  /** 'GUEST' or authenticated user UUID */
  owner_scope: OwnerScope;
  /** Application display ID (e.g. 'TRD-123456'), unique within [owner_scope, id] */
  id: string;
  /** Deterministic legacy UUID candidate used exclusively as a read-only matching hint */
  legacy_candidate_uuid: string;
  /** 1 if canonical_uuid is already bound to a verified cloud row; 0 if local/unbound */
  is_cloud_bound: 0 | 1;

  // --- All 27 Trade properties ---
  dateTime: string;
  dateTime_utc_ms: number;
  wall_clock_datetime: string;
  iana_timezone: string;
  tz_offset_minutes: number;
  instrument: string;
  position: TradePosition;
  strategy: string;
  session: string | null;
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  exitPrice: number | null;
  lotSize: number;
  riskAmount: number;
  riskPercentage: number;
  outcome: TradeOutcome;
  grossProfit: number;
  commission: number;
  swap: number;
  netProfit: number;
  rMultiple: number | null;
  screenshotUrl: string | null;
  screenshot_id: string | null;
  notes: string | null;
  entryReason: string | null;
  postTradeEvaluation: string | null;
  disciplineRating: number | null;
  executionNotes: string | null;
  isDemo: 0 | 1;
  createdAt: string;
  updatedAt: string;

  // --- Sync & Integrity Metadata ---
  sync_status: SyncStatus;
  sync_revision: number;
  last_mutation_id: string;
  canonical_digest: string;
}

/**
 * Entity 2: settings
 * Preserves all 20 properties of the application AppSettings interface per owner_scope.
 */
export interface LocalSettingsRow {
  /** Primary Key ('GUEST' or authenticated user UUID) */
  owner_scope: OwnerScope;

  // --- All 20 AppSettings properties ---
  currency: CurrencyCode;
  currencySymbol: string;
  startingBalance: number;
  xauusdContractSize: number;
  xauusdPointValue: number;
  xauusdTickSize: number;
  xauusdTickValue: number;
  xauusdMinLot: number;
  xauusdLotStep: number;
  defaultLeverage: number;
  brokerCommissionPerLot: number;
  defaultRiskPercent: number;
  maxTradeRiskPercent: number;
  maxTradeRiskAmount: number;
  maxDailyLossPercent: number;
  maxDailyLossAmount: number;
  maxConsecutiveLossLimit: number;
  maxDrawdownLimitPercent: number;
  resetTimezone: string;
  targetMonthlyReturnPercent: number;

  // --- Sync & Integrity Metadata ---
  updated_at: string;
  sync_status: SyncStatus;
  sync_revision: number;
  canonical_digest: string;
}

/**
 * Entity 3: screenshot_metadata
 * Tracks lifecycle, SHA-256 binary integrity, and persistent lease ownership.
 */
export interface ScreenshotMetadataRow {
  /** Primary Key (UUID v4) */
  screenshot_id: string;
  owner_scope: OwnerScope;
  /** Logical reference to trades.canonical_uuid (null while STAGED before trade save) */
  trade_canonical_uuid: string | null;
  mime_type: 'image/jpeg' | 'image/png' | 'image/webp';
  size_bytes: number;
  sha256_hash: string;
  lifecycle_status: ScreenshotLifecycleStatus;
  upload_status: ScreenshotUploadStatus;
  remote_storage_path: string | null;
  /** Persistent lease owner identifier: "<sessionInstanceId>::<opType>::<opUuid>" */
  lease_owner_id: string | null;
  lease_acquired_at: number | null;
  lease_expires_at: number | null;
  created_at: number;
  updated_at: number;
}

/**
 * Entity 4: screenshot_files
 * Stores binary Blob payload separately from trades metadata.
 */
export interface ScreenshotFileRow {
  /** Primary Key (1:1 with screenshot_metadata.screenshot_id) */
  screenshot_id: string;
  owner_scope: OwnerScope;
  blob_data: Blob;
  mime_type: 'image/jpeg' | 'image/png' | 'image/webp';
  size_bytes: number;
  sha256_hash: string;
  created_at: number;
}

/**
 * Entity 5: outbox_sync_queue
 * Local mutation queue enforcing idempotency (mutation_id) and monotonic sync_revision.
 */
export interface OutboxSyncQueueRow {
  /** Primary Key (UUID v4) */
  outbox_id: string;
  owner_scope: OwnerScope;
  entity_type: OutboxEntityType;
  entity_key: string;
  operation_type: OutboxOperationType;
  /** Unique idempotency key preserved across retries of the same logical mutation */
  mutation_id: string;
  /** Monotonic compare-and-swap revision number */
  sync_revision: number;
  payload_json: string;
  status: OutboxQueueStatus;
  retry_count: number;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * Entity 6: migration_state
 * Records shadow migration state and snapshot verification digests per owner_scope.
 */
export interface MigrationStateRow {
  /** Primary Key ('GUEST' or authenticated user UUID) */
  owner_scope: OwnerScope;
  status: MigrationStatus;
  schema_version: number;
  /** Strictly 0 in Phase 1: IndexedDB is a shadow copy only, never the active source of truth */
  is_active_source_of_truth: 0 | 1;
  source_trades_key: string;
  source_settings_key: string;
  snapshot_checksum_start: string;
  snapshot_checksum_end: string | null;
  migrated_trades_count: number;
  migrated_screenshots_count: number;
  quarantined_count: number;
  failure_reason: string | null;
  started_at: number;
  completed_at: number | null;
}

/**
 * Entity 7: quarantined_records
 * Preserves raw corrupted JSON strings, malformed array records, or corrupted screenshot payloads
 * without modifying or deleting the source data.
 */
export interface QuarantinedRecordRow {
  /** Primary Key (UUID v4) */
  quarantine_id: string;
  owner_scope: OwnerScope;
  source_storage_key: string;
  corruption_scope: CorruptionScope;
  record_index: number | null;
  record_local_id: string | null;
  reason_code: string;
  diagnostic_detail: string;
  raw_payload: string;
  created_at: number;
}

/**
 * Metadata embedded in [MetaB64: ...] or legacy [Meta: {...}] tags.
 */
export interface TradeNotesMetaPayload {
  localId?: string;
  riskAmount?: number;
  riskPercentage?: number;
  rMultiple?: number;
  disciplineRating?: number;
  isDemo?: boolean;
  entryReason?: string;
  postTradeEvaluation?: string;
  executionNotes?: string;
  wallClockDateTime?: string;
  ianaTimezone?: string;
  tzOffsetMinutes?: number;
  syncRevision?: number;
  lastMutationId?: string;
  closeExchangeRate?: HistoricalExchangeRateSnapshot;
}

export interface DecodedTradeNotesResult {
  cleanNotes: string | undefined;
  extractedLocalId?: string;
  meta: TradeNotesMetaPayload;
  formatDetected: 'METAB64' | 'LEGACY_META' | 'NONE';
  metaParseWarning?: boolean;
}

export interface ValidatedTradeResult {
  isValid: boolean;
  normalizedTrade?: Trade;
  reasonCode?: string;
  detail?: string;
}

export interface ValidatedSettingsResult {
  isValid: boolean;
  normalizedSettings?: AppSettings;
  reasonCode?: string;
  detail?: string;
}

export interface PutTradeOptions {
  ownerScope: OwnerScope;
  isCloudBound?: 0 | 1;
  canonicalUuid?: string;
  uuidGenerator?: () => string;
  nowMs?: number;
}

export interface StageScreenshotParams {
  screenshotId?: string;
  ownerScope: OwnerScope;
  tradeCanonicalUuid?: string | null;
  base64DataUrl?: string;
  preDecoded?: {
    blob: Blob;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
    sizeBytes: number;
    sha256Hex: string;
  };
  lifecycleStatus?: ScreenshotLifecycleStatus;
  uploadStatus?: ScreenshotUploadStatus;
  remoteStoragePath?: string | null;
  leaseOwnerId?: string | null;
  leaseAcquiredAt?: number | null;
  leaseExpiresAt?: number | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface EnqueueOutboxParams {
  ownerScope: OwnerScope;
  entityType: OutboxEntityType;
  entityKey: string;
  operationType: OutboxOperationType;
  payload: unknown;
  /** Optional existing mutationId when retrying the exact same logical mutation */
  existingMutationId?: string;
  /** Expected base sync revision for compare-and-swap verification */
  expectedBaseRevision?: number;
  nowMs?: number;
}

export interface OrphanCleanupOptions {
  /** Required isolation boundary: cleanup evaluates and mutates screenshots only for this owner scope. */
  ownerScope: OwnerScope;
  nowMs?: number;
  /** Must be explicitly true AND target DB must be 'tradevault_idb_test' to perform actual deletion */
  allowDeleteInIsolatedTestDbOnly: boolean;
}

export interface OrphanCleanupReport {
  isDryRun: boolean;
  skippedBecauseMigrationInProgress: boolean;
  deletedScreenshotIds: string[];
  wouldDeleteCandidateIds: string[];
  transitionedToPendingUploadIds: string[];
  retainedCount: number;
}

export interface SyncErrorClassification {
  errorCategory:
    | 'RLS_PERMISSION_DENIED'
    | 'NETWORK_OR_SERVER_FAILURE'
    | 'PRIMARY_KEY_UUID_CONFLICT'
    | 'OTHER_UNIQUE_CONSTRAINT_CONFLICT'
    | 'CLOUD_BOUND_CONFLICT'
    | 'SELF_RETRY_IDEMPOTENT'
    | 'UNKNOWN_DATABASE_ERROR';
  reallocateUuid: boolean;
  isRetryable: boolean;
  reason: string;
}

export interface IStorageSnapshotProvider {
  getItem(key: string): string | null;
  keys(): string[];
}

export interface LocalStorageSnapshotDigest {
  keyCount: number;
  sortedKeys: string[];
  entries: Record<string, string>;
  sha256Digest: string;
}

export interface ShadowMigrationOptions {
  adapter: ILocalDatabaseAdapter;
  snapshotProvider: IStorageSnapshotProvider;
  ownerScope: OwnerScope;
  tradesStorageKey: string;
  settingsStorageKey: string;
  /** Optional in-memory raw objects to test AT-07B (NaN / Infinity handling) */
  inMemoryTradeObjectsOverride?: unknown[];
  nowMs?: number;
  /** Test hook invoked right before final source snapshot verification (used by AT-09) */
  onBeforeFinalSnapshotCheck?: () => Promise<void> | void;
  /** Test hook invoked immediately after atomic batch write commits (used by Phase 2.0 HT-07) */
  onAfterAtomicBatchWrite?: () => Promise<void> | void;
  /** Test hook to simulate an abrupt process crash right after atomic batch write commits without rollback (used by Phase 2.0 HT-07) */
  simulateCrashAfterAtomicBatchWrite?: boolean;
  /** Test hook to simulate a write failure on a specific valid trade index (used by AT-08) */
  simulateWriteFailureOnTradeIndex?: number;
  /** Test hook to simulate a read-back digest corruption after write (used by AT-05/AT-08) */
  simulateReadBackDigestMismatch?: boolean;
}

export interface ShadowMigrationReport {
  status: MigrationStatus;
  ownerScope: OwnerScope;
  migratedTradesCount: number;
  migratedScreenshotsCount: number;
  quarantinedCount: number;
  snapshotChecksumStart: string;
  snapshotChecksumEnd: string | null;
  isActiveSourceOfTruth: false;
  failureReason?: string;
  recoveredFromInterruptedMigration?: boolean;
}

export interface PreparedMigrationScreenshot {
  screenshotId: string;
  ownerScope: OwnerScope;
  tradeLocalId: string;
  blob: Blob;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  sizeBytes: number;
  sha256Hex: string;
  createdAt: number;
}

export interface PreparedMigrationTrade {
  row: LocalTradeRow;
  expectedDigest: string;
  preparedScreenshot?: PreparedMigrationScreenshot;
}

export interface PreparedMigrationBatch {
  ownerScope: OwnerScope;
  trades: PreparedMigrationTrade[];
  settingsRow: LocalSettingsRow;
  quarantinedRows: QuarantinedRecordRow[];
  nowMs: number;
  simulateWriteFailureOnTradeIndex?: number;
}

/**
 * Logical Schema Metadata Specification used by AT-16 to verify full parity
 * across TypeScript contracts, IndexedDB stores/indexes, and SQLite DDL.
 */
export interface EntityColumnSpec {
  name: string;
  logicalType: 'TEXT' | 'REAL' | 'INTEGER' | 'BLOB';
  nullable: boolean;
  isPrimaryKey?: boolean;
}

export interface EntitySchemaSpec {
  tableName: LocalTableName;
  primaryKey: string;
  uniqueIndexes: Array<{ name: string; columns: string[] }>;
  nonUniqueIndexes: Array<{ name: string; columns: string[] }>;
  logicalRelationships: Array<{
    fromColumn: string;
    toTable: LocalTableName;
    toColumn: string;
    relationType: 'LOGICAL_1_TO_1' | 'LOGICAL_MANY_TO_1';
  }>;
  columns: EntityColumnSpec[];
}

export interface ILocalDatabaseAdapter {
  readonly dbName: string;
  open(): Promise<void>;
  close(): Promise<void>;
  destroyDatabaseForTestingOnly(): Promise<void>;

  putTrade(trade: Trade, options: PutTradeOptions): Promise<LocalTradeRow>;
  getTradeByCanonicalUuid(canonicalUuid: string): Promise<LocalTradeRow | null>;
  getTradeByOwnerAndLocalId(ownerScope: OwnerScope, localId: string): Promise<LocalTradeRow | null>;
  getTradesByOwner(ownerScope: OwnerScope): Promise<LocalTradeRow[]>;
  getAllTradesAcrossOwners(): Promise<LocalTradeRow[]>;

  putSettings(settings: AppSettings, ownerScope: OwnerScope, nowMs?: number): Promise<LocalSettingsRow>;
  getSettingsByOwner(ownerScope: OwnerScope): Promise<LocalSettingsRow | null>;

  stageScreenshot(params: StageScreenshotParams): Promise<ScreenshotMetadataRow>;
  getScreenshotMetadata(screenshotId: string): Promise<ScreenshotMetadataRow | null>;
  getScreenshotFile(screenshotId: string): Promise<ScreenshotFileRow | null>;
  getScreenshotMetadataByOwner(ownerScope: OwnerScope): Promise<ScreenshotMetadataRow[]>;
  getScreenshotFilesByOwner(ownerScope: OwnerScope): Promise<ScreenshotFileRow[]>;
  acquireScreenshotLease(
    screenshotId: string,
    leaseOwnerId: string,
    durationMs?: number,
    nowMs?: number
  ): Promise<boolean>;
  renewScreenshotLease(
    screenshotId: string,
    leaseOwnerId: string,
    durationMs?: number,
    nowMs?: number
  ): Promise<boolean>;
  releaseScreenshotLease(screenshotId: string, leaseOwnerId: string, nowMs?: number): Promise<void>;
  cleanupOrphanScreenshots(options: OrphanCleanupOptions): Promise<OrphanCleanupReport>;

  enqueueOutboxMutation(params: EnqueueOutboxParams): Promise<OutboxSyncQueueRow>;
  getOutboxQueueByOwner(ownerScope: OwnerScope): Promise<OutboxSyncQueueRow[]>;

  setMigrationState(state: MigrationStateRow): Promise<void>;
  getMigrationState(ownerScope: OwnerScope): Promise<MigrationStateRow | null>;
  getQuarantinedRecordsByOwner(ownerScope: OwnerScope): Promise<QuarantinedRecordRow[]>;

  rollbackShadowMigrationScope(ownerScope: OwnerScope): Promise<void>;
  writeShadowMigrationBatchAtomically(batch: PreparedMigrationBatch): Promise<void>;
}
