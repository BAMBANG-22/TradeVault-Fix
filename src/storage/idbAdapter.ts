import { Trade } from '../types/trade';
import { AppSettings, DEFAULT_SETTINGS } from '../types/settings';
import {
  computeLegacyUnscopedUuid,
  ensureValidUuid,
  isRegisteredCloudTradeUuid,
  parseTradeDateTime,
  validateOwnerScope,
} from '../utils/supabaseSync';
import {
  EnqueueOutboxParams,
  EntitySchemaSpec,
  ILocalDatabaseAdapter,
  LOCAL_DB_SCHEMA_VERSION,
  LOCAL_DB_TABLES,
  LocalSettingsRow,
  LocalTableName,
  LocalTradeRow,
  MigrationStateRow,
  OrphanCleanupOptions,
  OrphanCleanupReport,
  OutboxSyncQueueRow,
  OwnerScope,
  PHASE_1_TEST_DB_NAME,
  PreparedMigrationBatch,
  PutTradeOptions,
  QuarantinedRecordRow,
  ScreenshotFileRow,
  ScreenshotMetadataRow,
  StageScreenshotParams,
  SyncErrorClassification,
  ValidatedSettingsResult,
  ValidatedTradeResult,
} from './databaseTypes';
import {
  computeCanonicalSettingsDigest,
  computeCanonicalTradeDigest,
  computeSha256Hex,
  decodeBase64DataUrlToBinary,
} from './utf8Base64Url';

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ResolvedTradeIdentity {
  canonicalUuid: string;
  ownerScope: string;
  localId: string;
  legacyCandidateUuid: string;
  isCloudBound: 0 | 1;
}

/**
 * Resolves the canonical owner-scoped UUID and legacy unscoped candidate UUID for any Trade record.
 * Used identically by idbAdapter.putTrade() and migrationService.runShadowMigration() so the
 * same (ownerScope, trade.id) always produces the exact same canonical_uuid and legacy_candidate_uuid.
 */
export function resolveCanonicalTradeIdentity(
  rawTradeId: string,
  ownerScope: string,
  explicitCloudUuid?: string,
  explicitIsCloudBound?: 0 | 1
): ResolvedTradeIdentity {
  const cleanScope = validateOwnerScope(ownerScope);
  const cleanId = typeof rawTradeId === 'string' ? rawTradeId.trim() : '';
  if (!cleanId) {
    throw new Error('ERR_EMPTY_TRADE_ID: Trade ID cannot be empty or whitespace.');
  }

  const legacyCandidateUuid = computeLegacyUnscopedUuid(cleanId);

  if (explicitIsCloudBound === 1 && explicitCloudUuid && UUID_V4_REGEX.test(explicitCloudUuid.trim())) {
    return {
      canonicalUuid: explicitCloudUuid.trim().toLowerCase(),
      ownerScope: cleanScope,
      localId: cleanId,
      legacyCandidateUuid,
      isCloudBound: 1,
    };
  }

  const isRegisteredCloud = isRegisteredCloudTradeUuid(cleanScope, cleanId);
  const canonicalUuid = ensureValidUuid(cleanId, cleanScope);

  return {
    canonicalUuid,
    ownerScope: cleanScope,
    localId: cleanId,
    legacyCandidateUuid,
    isCloudBound: isRegisteredCloud ? 1 : 0,
  };
}

export const DEFAULT_SCREENSHOT_LEASE_DURATION_MS = 15 * 60 * 1000; // 15 minutes
export const STUCK_UPLOADING_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
export const ORPHAN_STAGED_MIN_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * In-memory lock set for the current execution context.
 * Always paired with persistent lease fields in screenshot_metadata.
 */
const activeScreenshotLocks = new Set<string>();

export function lockScreenshotInMemory(screenshotId: string): void {
  activeScreenshotLocks.add(screenshotId);
}

export function unlockScreenshotInMemory(screenshotId: string): void {
  activeScreenshotLocks.delete(screenshotId);
}

export function isScreenshotLockedInMemory(screenshotId: string): boolean {
  return activeScreenshotLocks.has(screenshotId);
}

/**
 * Authoritative logical schema specification for all 7 entities.
 * Used by IndexedDB onupgradeneeded, SQLite DDL parity checks, and AT-16 verification.
 */
export const LOGICAL_ENTITY_SCHEMA_SPECS: Record<LocalTableName, EntitySchemaSpec> = {
  trades: {
    tableName: 'trades',
    primaryKey: 'canonical_uuid',
    uniqueIndexes: [{ name: 'idx_trades_owner_local_id', columns: ['owner_scope', 'id'] }],
    nonUniqueIndexes: [
      { name: 'idx_trades_owner_legacy_uuid', columns: ['owner_scope', 'legacy_candidate_uuid'] },
      { name: 'idx_trades_owner_date', columns: ['owner_scope', 'dateTime_utc_ms'] },
      { name: 'idx_trades_sync_status', columns: ['owner_scope', 'sync_status'] },
    ],
    logicalRelationships: [
      {
        fromColumn: 'screenshot_id',
        toTable: 'screenshot_metadata',
        toColumn: 'screenshot_id',
        relationType: 'LOGICAL_1_TO_1',
      },
    ],
    columns: [
      { name: 'canonical_uuid', logicalType: 'TEXT', nullable: false, isPrimaryKey: true },
      { name: 'owner_scope', logicalType: 'TEXT', nullable: false },
      { name: 'id', logicalType: 'TEXT', nullable: false },
      { name: 'legacy_candidate_uuid', logicalType: 'TEXT', nullable: false },
      { name: 'is_cloud_bound', logicalType: 'INTEGER', nullable: false },
      { name: 'dateTime', logicalType: 'TEXT', nullable: false },
      { name: 'dateTime_utc_ms', logicalType: 'INTEGER', nullable: false },
      { name: 'wall_clock_datetime', logicalType: 'TEXT', nullable: false },
      { name: 'iana_timezone', logicalType: 'TEXT', nullable: false },
      { name: 'tz_offset_minutes', logicalType: 'INTEGER', nullable: false },
      { name: 'instrument', logicalType: 'TEXT', nullable: false },
      { name: 'position', logicalType: 'TEXT', nullable: false },
      { name: 'strategy', logicalType: 'TEXT', nullable: false },
      { name: 'session', logicalType: 'TEXT', nullable: true },
      { name: 'entryPrice', logicalType: 'REAL', nullable: false },
      { name: 'stopLoss', logicalType: 'REAL', nullable: true },
      { name: 'takeProfit', logicalType: 'REAL', nullable: true },
      { name: 'exitPrice', logicalType: 'REAL', nullable: true },
      { name: 'lotSize', logicalType: 'REAL', nullable: false },
      { name: 'riskAmount', logicalType: 'REAL', nullable: false },
      { name: 'riskPercentage', logicalType: 'REAL', nullable: false },
      { name: 'outcome', logicalType: 'TEXT', nullable: false },
      { name: 'grossProfit', logicalType: 'REAL', nullable: false },
      { name: 'commission', logicalType: 'REAL', nullable: false },
      { name: 'swap', logicalType: 'REAL', nullable: false },
      { name: 'netProfit', logicalType: 'REAL', nullable: false },
      { name: 'rMultiple', logicalType: 'REAL', nullable: true },
      { name: 'screenshotUrl', logicalType: 'TEXT', nullable: true },
      { name: 'screenshot_id', logicalType: 'TEXT', nullable: true },
      { name: 'notes', logicalType: 'TEXT', nullable: true },
      { name: 'entryReason', logicalType: 'TEXT', nullable: true },
      { name: 'postTradeEvaluation', logicalType: 'TEXT', nullable: true },
      { name: 'disciplineRating', logicalType: 'INTEGER', nullable: true },
      { name: 'executionNotes', logicalType: 'TEXT', nullable: true },
      { name: 'isDemo', logicalType: 'INTEGER', nullable: false },
      { name: 'createdAt', logicalType: 'TEXT', nullable: false },
      { name: 'updatedAt', logicalType: 'TEXT', nullable: false },
      { name: 'sync_status', logicalType: 'TEXT', nullable: false },
      { name: 'sync_revision', logicalType: 'INTEGER', nullable: false },
      { name: 'last_mutation_id', logicalType: 'TEXT', nullable: false },
      { name: 'canonical_digest', logicalType: 'TEXT', nullable: false },
    ],
  },
  settings: {
    tableName: 'settings',
    primaryKey: 'owner_scope',
    uniqueIndexes: [],
    nonUniqueIndexes: [{ name: 'idx_settings_sync_status', columns: ['sync_status'] }],
    logicalRelationships: [],
    columns: [
      { name: 'owner_scope', logicalType: 'TEXT', nullable: false, isPrimaryKey: true },
      { name: 'currency', logicalType: 'TEXT', nullable: false },
      { name: 'currencySymbol', logicalType: 'TEXT', nullable: false },
      { name: 'startingBalance', logicalType: 'REAL', nullable: false },
      { name: 'xauusdContractSize', logicalType: 'REAL', nullable: false },
      { name: 'xauusdPointValue', logicalType: 'REAL', nullable: false },
      { name: 'xauusdTickSize', logicalType: 'REAL', nullable: false },
      { name: 'xauusdTickValue', logicalType: 'REAL', nullable: false },
      { name: 'xauusdMinLot', logicalType: 'REAL', nullable: false },
      { name: 'xauusdLotStep', logicalType: 'REAL', nullable: false },
      { name: 'defaultLeverage', logicalType: 'REAL', nullable: false },
      { name: 'brokerCommissionPerLot', logicalType: 'REAL', nullable: false },
      { name: 'defaultRiskPercent', logicalType: 'REAL', nullable: false },
      { name: 'maxTradeRiskPercent', logicalType: 'REAL', nullable: false },
      { name: 'maxTradeRiskAmount', logicalType: 'REAL', nullable: false },
      { name: 'maxDailyLossPercent', logicalType: 'REAL', nullable: false },
      { name: 'maxDailyLossAmount', logicalType: 'REAL', nullable: false },
      { name: 'maxConsecutiveLossLimit', logicalType: 'INTEGER', nullable: false },
      { name: 'maxDrawdownLimitPercent', logicalType: 'REAL', nullable: false },
      { name: 'resetTimezone', logicalType: 'TEXT', nullable: false },
      { name: 'targetMonthlyReturnPercent', logicalType: 'REAL', nullable: false },
      { name: 'updated_at', logicalType: 'TEXT', nullable: false },
      { name: 'sync_status', logicalType: 'TEXT', nullable: false },
      { name: 'sync_revision', logicalType: 'INTEGER', nullable: false },
      { name: 'canonical_digest', logicalType: 'TEXT', nullable: false },
    ],
  },
  screenshot_metadata: {
    tableName: 'screenshot_metadata',
    primaryKey: 'screenshot_id',
    uniqueIndexes: [],
    nonUniqueIndexes: [
      { name: 'idx_screenshot_meta_owner', columns: ['owner_scope'] },
      { name: 'idx_screenshot_meta_trade', columns: ['trade_canonical_uuid'] },
      { name: 'idx_screenshot_meta_lifecycle', columns: ['lifecycle_status', 'updated_at'] },
      { name: 'idx_screenshot_meta_upload', columns: ['upload_status', 'updated_at'] },
    ],
    logicalRelationships: [
      {
        fromColumn: 'trade_canonical_uuid',
        toTable: 'trades',
        toColumn: 'canonical_uuid',
        relationType: 'LOGICAL_MANY_TO_1',
      },
      {
        fromColumn: 'screenshot_id',
        toTable: 'screenshot_files',
        toColumn: 'screenshot_id',
        relationType: 'LOGICAL_1_TO_1',
      },
    ],
    columns: [
      { name: 'screenshot_id', logicalType: 'TEXT', nullable: false, isPrimaryKey: true },
      { name: 'owner_scope', logicalType: 'TEXT', nullable: false },
      { name: 'trade_canonical_uuid', logicalType: 'TEXT', nullable: true },
      { name: 'mime_type', logicalType: 'TEXT', nullable: false },
      { name: 'size_bytes', logicalType: 'INTEGER', nullable: false },
      { name: 'sha256_hash', logicalType: 'TEXT', nullable: false },
      { name: 'lifecycle_status', logicalType: 'TEXT', nullable: false },
      { name: 'upload_status', logicalType: 'TEXT', nullable: false },
      { name: 'remote_storage_path', logicalType: 'TEXT', nullable: true },
      { name: 'lease_owner_id', logicalType: 'TEXT', nullable: true },
      { name: 'lease_acquired_at', logicalType: 'INTEGER', nullable: true },
      { name: 'lease_expires_at', logicalType: 'INTEGER', nullable: true },
      { name: 'created_at', logicalType: 'INTEGER', nullable: false },
      { name: 'updated_at', logicalType: 'INTEGER', nullable: false },
    ],
  },
  screenshot_files: {
    tableName: 'screenshot_files',
    primaryKey: 'screenshot_id',
    uniqueIndexes: [],
    nonUniqueIndexes: [{ name: 'idx_screenshot_files_owner', columns: ['owner_scope'] }],
    logicalRelationships: [
      {
        fromColumn: 'screenshot_id',
        toTable: 'screenshot_metadata',
        toColumn: 'screenshot_id',
        relationType: 'LOGICAL_1_TO_1',
      },
    ],
    columns: [
      { name: 'screenshot_id', logicalType: 'TEXT', nullable: false, isPrimaryKey: true },
      { name: 'owner_scope', logicalType: 'TEXT', nullable: false },
      { name: 'blob_data', logicalType: 'BLOB', nullable: false },
      { name: 'mime_type', logicalType: 'TEXT', nullable: false },
      { name: 'size_bytes', logicalType: 'INTEGER', nullable: false },
      { name: 'sha256_hash', logicalType: 'TEXT', nullable: false },
      { name: 'created_at', logicalType: 'INTEGER', nullable: false },
    ],
  },
  outbox_sync_queue: {
    tableName: 'outbox_sync_queue',
    primaryKey: 'outbox_id',
    uniqueIndexes: [{ name: 'idx_outbox_mutation_id', columns: ['mutation_id'] }],
    nonUniqueIndexes: [
      { name: 'idx_outbox_owner_status', columns: ['owner_scope', 'status', 'created_at'] },
      { name: 'idx_outbox_entity', columns: ['owner_scope', 'entity_type', 'entity_key'] },
    ],
    logicalRelationships: [],
    columns: [
      { name: 'outbox_id', logicalType: 'TEXT', nullable: false, isPrimaryKey: true },
      { name: 'owner_scope', logicalType: 'TEXT', nullable: false },
      { name: 'entity_type', logicalType: 'TEXT', nullable: false },
      { name: 'entity_key', logicalType: 'TEXT', nullable: false },
      { name: 'operation_type', logicalType: 'TEXT', nullable: false },
      { name: 'mutation_id', logicalType: 'TEXT', nullable: false },
      { name: 'sync_revision', logicalType: 'INTEGER', nullable: false },
      { name: 'payload_json', logicalType: 'TEXT', nullable: false },
      { name: 'status', logicalType: 'TEXT', nullable: false },
      { name: 'retry_count', logicalType: 'INTEGER', nullable: false },
      { name: 'last_error_code', logicalType: 'TEXT', nullable: true },
      { name: 'last_error_message', logicalType: 'TEXT', nullable: true },
      { name: 'created_at', logicalType: 'INTEGER', nullable: false },
      { name: 'updated_at', logicalType: 'INTEGER', nullable: false },
    ],
  },
  migration_state: {
    tableName: 'migration_state',
    primaryKey: 'owner_scope',
    uniqueIndexes: [],
    nonUniqueIndexes: [{ name: 'idx_migration_status', columns: ['status'] }],
    logicalRelationships: [],
    columns: [
      { name: 'owner_scope', logicalType: 'TEXT', nullable: false, isPrimaryKey: true },
      { name: 'status', logicalType: 'TEXT', nullable: false },
      { name: 'schema_version', logicalType: 'INTEGER', nullable: false },
      { name: 'is_active_source_of_truth', logicalType: 'INTEGER', nullable: false },
      { name: 'source_trades_key', logicalType: 'TEXT', nullable: false },
      { name: 'source_settings_key', logicalType: 'TEXT', nullable: false },
      { name: 'snapshot_checksum_start', logicalType: 'TEXT', nullable: false },
      { name: 'snapshot_checksum_end', logicalType: 'TEXT', nullable: true },
      { name: 'migrated_trades_count', logicalType: 'INTEGER', nullable: false },
      { name: 'migrated_screenshots_count', logicalType: 'INTEGER', nullable: false },
      { name: 'quarantined_count', logicalType: 'INTEGER', nullable: false },
      { name: 'failure_reason', logicalType: 'TEXT', nullable: true },
      { name: 'started_at', logicalType: 'INTEGER', nullable: false },
      { name: 'completed_at', logicalType: 'INTEGER', nullable: true },
    ],
  },
  quarantined_records: {
    tableName: 'quarantined_records',
    primaryKey: 'quarantine_id',
    uniqueIndexes: [],
    nonUniqueIndexes: [{ name: 'idx_quarantine_owner', columns: ['owner_scope', 'created_at'] }],
    logicalRelationships: [],
    columns: [
      { name: 'quarantine_id', logicalType: 'TEXT', nullable: false, isPrimaryKey: true },
      { name: 'owner_scope', logicalType: 'TEXT', nullable: false },
      { name: 'source_storage_key', logicalType: 'TEXT', nullable: false },
      { name: 'corruption_scope', logicalType: 'TEXT', nullable: false },
      { name: 'record_index', logicalType: 'INTEGER', nullable: true },
      { name: 'record_local_id', logicalType: 'TEXT', nullable: true },
      { name: 'reason_code', logicalType: 'TEXT', nullable: false },
      { name: 'diagnostic_detail', logicalType: 'TEXT', nullable: false },
      { name: 'raw_payload', logicalType: 'TEXT', nullable: false },
      { name: 'created_at', logicalType: 'INTEGER', nullable: false },
    ],
  },
};

/**
 * Strictly validates and normalizes a raw Trade record without silently coercing invalid numbers.
 * Any missing required string or non-finite required/optional number is rejected.
 */
export function validateAndNormalizeTradeRecord(
  raw: unknown,
  ownerScope: OwnerScope
): ValidatedTradeResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      isValid: false,
      reasonCode: 'NOT_AN_OBJECT',
      detail: 'Trade record must be a non-null plain object.',
    };
  }

  const obj = raw as Record<string, unknown>;

  if (!ownerScope || typeof ownerScope !== 'string' || ownerScope.trim() === '') {
    return {
      isValid: false,
      reasonCode: 'INVALID_OWNER_SCOPE',
      detail: 'ownerScope must be a non-empty string.',
    };
  }

  if (typeof obj.id !== 'string' || obj.id.trim() === '') {
    return {
      isValid: false,
      reasonCode: 'MISSING_REQUIRED_FIELD',
      detail: 'Required field "id" is missing or empty.',
    };
  }

  if (typeof obj.dateTime !== 'string' || obj.dateTime.trim() === '') {
    return {
      isValid: false,
      reasonCode: 'MISSING_REQUIRED_FIELD',
      detail: 'Required field "dateTime" is missing or empty.',
    };
  }

  const parsedDate = parseTradeDateTime(obj.dateTime);
  if (!parsedDate || isNaN(parsedDate.getTime())) {
    return {
      isValid: false,
      reasonCode: 'INVALID_DATETIME',
      detail: `Field "dateTime" ("${String(obj.dateTime)}") cannot be parsed into a valid Date.`,
    };
  }

  if (typeof obj.instrument !== 'string' || obj.instrument.trim() === '') {
    return {
      isValid: false,
      reasonCode: 'MISSING_REQUIRED_FIELD',
      detail: 'Required field "instrument" is missing or empty.',
    };
  }

  if (obj.position !== 'BUY' && obj.position !== 'SELL') {
    return {
      isValid: false,
      reasonCode: 'INVALID_ENUM_VALUE',
      detail: 'Field "position" must be "BUY" or "SELL".',
    };
  }

  if (obj.outcome !== 'WIN' && obj.outcome !== 'LOSS' && obj.outcome !== 'BREAKEVEN') {
    return {
      isValid: false,
      reasonCode: 'INVALID_ENUM_VALUE',
      detail: 'Field "outcome" must be "WIN", "LOSS", or "BREAKEVEN".',
    };
  }

  const requiredNumericKeys: Array<keyof Trade> = [
    'entryPrice',
    'lotSize',
    'riskAmount',
    'riskPercentage',
    'grossProfit',
    'commission',
    'swap',
    'netProfit',
  ];

  for (const key of requiredNumericKeys) {
    const val = obj[key as string];
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      return {
        isValid: false,
        reasonCode: 'NON_FINITE_REQUIRED_NUMBER',
        detail: `Required numeric field "${String(key)}" is missing, null, non-numeric, NaN, or Infinity.`,
      };
    }
  }

  if ((obj.lotSize as number) <= 0) {
    return {
      isValid: false,
      reasonCode: 'INVALID_LOT_SIZE',
      detail: 'Field "lotSize" must be strictly greater than 0.',
    };
  }

  const optionalNumericKeys: Array<keyof Trade> = [
    'stopLoss',
    'takeProfit',
    'exitPrice',
    'rMultiple',
    'disciplineRating',
  ];

  for (const key of optionalNumericKeys) {
    const val = obj[key as string];
    if (val !== undefined && val !== null) {
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        return {
          isValid: false,
          reasonCode: 'NON_FINITE_OPTIONAL_NUMBER',
          detail: `Optional numeric field "${String(key)}" contains non-finite or non-numeric value.`,
        };
      }
    }
  }

  const normalizedTrade: Trade = {
    id: String(obj.id).trim(),
    dateTime: String(obj.dateTime).trim(),
    instrument: String(obj.instrument).trim().toUpperCase(),
    position: obj.position as 'BUY' | 'SELL',
    strategy:
      typeof obj.strategy === 'string' && obj.strategy.trim() !== ''
        ? obj.strategy.trim()
        : 'Umum',
    session:
      obj.session !== undefined && obj.session !== null && String(obj.session).trim() !== ''
        ? String(obj.session).trim()
        : undefined,
    entryPrice: obj.entryPrice as number,
    stopLoss:
      obj.stopLoss !== undefined && obj.stopLoss !== null ? (obj.stopLoss as number) : undefined,
    takeProfit:
      obj.takeProfit !== undefined && obj.takeProfit !== null
        ? (obj.takeProfit as number)
        : undefined,
    exitPrice:
      obj.exitPrice !== undefined && obj.exitPrice !== null ? (obj.exitPrice as number) : undefined,
    lotSize: obj.lotSize as number,
    riskAmount: obj.riskAmount as number,
    riskPercentage: obj.riskPercentage as number,
    outcome: obj.outcome as 'WIN' | 'LOSS' | 'BREAKEVEN',
    grossProfit: obj.grossProfit as number,
    commission: obj.commission as number,
    swap: obj.swap as number,
    netProfit: obj.netProfit as number,
    rMultiple:
      obj.rMultiple !== undefined && obj.rMultiple !== null ? (obj.rMultiple as number) : undefined,
    screenshotUrl:
      typeof obj.screenshotUrl === 'string' && obj.screenshotUrl.trim() !== ''
        ? obj.screenshotUrl.trim()
        : undefined,
    notes: typeof obj.notes === 'string' ? obj.notes : undefined,
    entryReason: typeof obj.entryReason === 'string' ? obj.entryReason : undefined,
    postTradeEvaluation:
      typeof obj.postTradeEvaluation === 'string' ? obj.postTradeEvaluation : undefined,
    disciplineRating:
      obj.disciplineRating !== undefined && obj.disciplineRating !== null
        ? (obj.disciplineRating as number)
        : undefined,
    executionNotes: typeof obj.executionNotes === 'string' ? obj.executionNotes : undefined,
    isDemo: obj.isDemo !== undefined ? Boolean(obj.isDemo) : undefined,
    createdAt:
      typeof obj.createdAt === 'string' && obj.createdAt.trim() !== ''
        ? obj.createdAt.trim()
        : undefined,
    updatedAt:
      typeof obj.updatedAt === 'string' && obj.updatedAt.trim() !== ''
        ? obj.updatedAt.trim()
        : undefined,
  };

  return {
    isValid: true,
    normalizedTrade,
  };
}

/**
 * Validates and normalizes all 20 AppSettings properties.
 */
export function validateAndNormalizeSettingsRecord(raw: unknown): ValidatedSettingsResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      isValid: false,
      reasonCode: 'INVALID_SETTINGS_OBJECT',
      detail: 'Settings payload is not a valid object.',
    };
  }

  const obj = raw as Record<string, unknown>;
  const numericKeys: Array<
    Exclude<keyof AppSettings, 'currency' | 'currencySymbol' | 'resetTimezone'>
  > = [
    'startingBalance',
    'xauusdContractSize',
    'xauusdPointValue',
    'xauusdTickSize',
    'xauusdTickValue',
    'xauusdMinLot',
    'xauusdLotStep',
    'defaultLeverage',
    'brokerCommissionPerLot',
    'defaultRiskPercent',
    'maxTradeRiskPercent',
    'maxTradeRiskAmount',
    'maxDailyLossPercent',
    'maxDailyLossAmount',
    'maxConsecutiveLossLimit',
    'maxDrawdownLimitPercent',
    'targetMonthlyReturnPercent',
  ];

  const normalized: AppSettings = {
    ...DEFAULT_SETTINGS,
  };

  if (obj.currency !== undefined) {
    if (obj.currency !== 'USD' && obj.currency !== 'IDR' && obj.currency !== 'EUR') {
      return {
        isValid: false,
        reasonCode: 'INVALID_CURRENCY_CODE',
        detail: `Unsupported currency code "${String(obj.currency)}".`,
      };
    }
    normalized.currency = obj.currency;
  }

  if (obj.currencySymbol !== undefined) {
    if (typeof obj.currencySymbol !== 'string' || obj.currencySymbol.trim() === '') {
      return {
        isValid: false,
        reasonCode: 'INVALID_CURRENCY_SYMBOL',
        detail: 'currencySymbol must be a non-empty string.',
      };
    }
    normalized.currencySymbol = obj.currencySymbol.trim();
  }

  if (obj.resetTimezone !== undefined) {
    if (typeof obj.resetTimezone !== 'string' || obj.resetTimezone.trim() === '') {
      return {
        isValid: false,
        reasonCode: 'INVALID_RESET_TIMEZONE',
        detail: 'resetTimezone must be a non-empty string.',
      };
    }
    normalized.resetTimezone = obj.resetTimezone.trim();
  }

  for (const key of numericKeys) {
    if (obj[key] !== undefined) {
      const val = obj[key];
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        return {
          isValid: false,
          reasonCode: 'NON_FINITE_SETTINGS_NUMBER',
          detail: `Numeric setting "${String(key)}" is non-finite or not a number.`,
        };
      }
      (normalized as unknown as Record<string, unknown>)[key] = val;
    }
  }

  return {
    isValid: true,
    normalizedSettings: normalized,
  };
}

/**
 * Converts a stored LocalTradeRow back into the exact 27-field application Trade interface.
 */
export function mapLocalRowToTrade(row: LocalTradeRow): Trade {
  const trade: Trade = {
    id: row.id,
    dateTime: row.dateTime,
    instrument: row.instrument,
    position: row.position,
    strategy: row.strategy,
    entryPrice: row.entryPrice,
    lotSize: row.lotSize,
    riskAmount: row.riskAmount,
    riskPercentage: row.riskPercentage,
    outcome: row.outcome,
    grossProfit: row.grossProfit,
    commission: row.commission,
    swap: row.swap,
    netProfit: row.netProfit,
  };

  if (row.session !== null) trade.session = row.session;
  if (row.stopLoss !== null) trade.stopLoss = row.stopLoss;
  if (row.takeProfit !== null) trade.takeProfit = row.takeProfit;
  if (row.exitPrice !== null) trade.exitPrice = row.exitPrice;
  if (row.rMultiple !== null) trade.rMultiple = row.rMultiple;
  if (row.screenshotUrl !== null) trade.screenshotUrl = row.screenshotUrl;
  if (row.notes !== null) trade.notes = row.notes;
  if (row.entryReason !== null) trade.entryReason = row.entryReason;
  if (row.postTradeEvaluation !== null) trade.postTradeEvaluation = row.postTradeEvaluation;
  if (row.disciplineRating !== null) trade.disciplineRating = row.disciplineRating;
  if (row.executionNotes !== null) trade.executionNotes = row.executionNotes;
  trade.isDemo = row.isDemo === 1;
  if (row.createdAt) trade.createdAt = row.createdAt;
  if (row.updatedAt) trade.updatedAt = row.updatedAt;

  return trade;
}

/**
 * Converts a stored LocalSettingsRow back into the exact 20-property AppSettings interface.
 */
export function mapLocalRowToSettings(row: LocalSettingsRow): AppSettings {
  return {
    currency: row.currency,
    currencySymbol: row.currencySymbol,
    startingBalance: row.startingBalance,
    xauusdContractSize: row.xauusdContractSize,
    xauusdPointValue: row.xauusdPointValue,
    xauusdTickSize: row.xauusdTickSize,
    xauusdTickValue: row.xauusdTickValue,
    xauusdMinLot: row.xauusdMinLot,
    xauusdLotStep: row.xauusdLotStep,
    defaultLeverage: row.defaultLeverage,
    brokerCommissionPerLot: row.brokerCommissionPerLot,
    defaultRiskPercent: row.defaultRiskPercent,
    maxTradeRiskPercent: row.maxTradeRiskPercent,
    maxTradeRiskAmount: row.maxTradeRiskAmount,
    maxDailyLossPercent: row.maxDailyLossPercent,
    maxDailyLossAmount: row.maxDailyLossAmount,
    maxConsecutiveLossLimit: row.maxConsecutiveLossLimit,
    maxDrawdownLimitPercent: row.maxDrawdownLimitPercent,
    resetTimezone: row.resetTimezone,
    targetMonthlyReturnPercent: row.targetMonthlyReturnPercent,
  };
}

/**
 * Pure PostgreSQL / Supabase error classifier (AT-15).
 * Never makes network calls and never treats an empty RLS SELECT as proof of non-existence.
 */
export function classifySupabaseSyncError(
  error: {
    code?: string;
    message?: string;
    details?: string;
    constraint?: string;
    status?: number;
  } | null,
  isCloudBound: 0 | 1,
  isConfirmedSelfRetry = false
): SyncErrorClassification {
  if (!error) {
    return {
      errorCategory: 'UNKNOWN_DATABASE_ERROR',
      reallocateUuid: false,
      isRetryable: false,
      reason: 'Empty error object.',
    };
  }

  const code = String(error.code || '').trim();
  const message = String(error.message || '').toLowerCase();
  const details = String(error.details || '').toLowerCase();
  const constraint = String(error.constraint || '').toLowerCase();

  // 1. RLS / Permission Violation (42501) -> NEVER reallocate UUID
  if (
    code === '42501' ||
    message.includes('row-level security') ||
    message.includes('violates row-level security policy') ||
    message.includes('permission denied')
  ) {
    return {
      errorCategory: 'RLS_PERMISSION_DENIED',
      reallocateUuid: false,
      isRetryable: false,
      reason: 'RLS or permission error (42501) must never trigger UUID reallocation.',
    };
  }

  // 2. Network / Server 5xx Failure -> NEVER reallocate UUID
  if (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('timeout') ||
    (typeof error.status === 'number' && error.status >= 500)
  ) {
    return {
      errorCategory: 'NETWORK_OR_SERVER_FAILURE',
      reallocateUuid: false,
      isRetryable: true,
      reason: 'Network or 5xx failure must retry with the exact same UUID and mutation_id.',
    };
  }

  // 3. Unique Constraint Violation (23505)
  if (code === '23505' || message.includes('duplicate key value violates unique constraint')) {
    if (isConfirmedSelfRetry) {
      return {
        errorCategory: 'SELF_RETRY_IDEMPOTENT',
        reallocateUuid: false,
        isRetryable: false,
        reason: '23505 caused by idempotent self-retry of an already succeeded insert.',
      };
    }

    if (isCloudBound === 1) {
      return {
        errorCategory: 'CLOUD_BOUND_CONFLICT',
        reallocateUuid: false,
        isRetryable: false,
        reason: 'Record is already cloud-bound (is_cloud_bound = 1); UUID must never be regenerated.',
      };
    }

    const isTradesPrimaryKeyConstraint =
      constraint === 'trades_pkey' ||
      message.includes('"trades_pkey"') ||
      details.includes('trades_pkey');

    if (isTradesPrimaryKeyConstraint) {
      return {
        errorCategory: 'PRIMARY_KEY_UUID_CONFLICT',
        reallocateUuid: true,
        isRetryable: true,
        reason:
          'Verified trades_pkey collision on an unbound local record (is_cloud_bound = 0) that is not a self-retry.',
      };
    }

    return {
      errorCategory: 'OTHER_UNIQUE_CONSTRAINT_CONFLICT',
      reallocateUuid: false,
      isRetryable: false,
      reason:
        '23505 occurred on a non-primary-key constraint or unverified constraint; UUID reallocation is prohibited.',
    };
  }

  return {
    errorCategory: 'UNKNOWN_DATABASE_ERROR',
    reallocateUuid: false,
    isRetryable: false,
    reason: `Unclassified database error (code: ${code || 'none'}).`,
  };
}

// ============================================================================
// Spec-Compliant In-Memory Transactional Store Engine Fallback
// Used ONLY in headless Node CLI environments where window.indexedDB is absent.
// In browser environments, native window.indexedDB is used directly.
// ============================================================================

interface InternalStoreDefinition {
  name: LocalTableName;
  keyPath: string;
  indexes: Map<string, { name: string; keyPath: string | string[]; unique: boolean }>;
  records: Map<string, Record<string, unknown>>;
}

const nodeFallbackDatabases = new Map<string, Map<LocalTableName, InternalStoreDefinition>>();

function extractKeyValue(record: Record<string, unknown>, keyPath: string | string[]): string {
  if (Array.isArray(keyPath)) {
    return keyPath.map((k) => String(record[k] ?? '')).join('::');
  }
  return String(record[keyPath] ?? '');
}

function createConstraintError(message: string): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException(message, 'ConstraintError');
  }
  const err = new Error(message);
  err.name = 'ConstraintError';
  return err;
}

function ensureNodeFallbackDbInitialized(dbName: string): Map<LocalTableName, InternalStoreDefinition> {
  let dbStores = nodeFallbackDatabases.get(dbName);
  if (!dbStores) {
    dbStores = new Map<LocalTableName, InternalStoreDefinition>();
    for (const spec of Object.values(LOGICAL_ENTITY_SCHEMA_SPECS)) {
      const indexes = new Map<string, { name: string; keyPath: string | string[]; unique: boolean }>();
      for (const uIdx of spec.uniqueIndexes) {
        indexes.set(uIdx.name, {
          name: uIdx.name,
          keyPath: uIdx.columns.length === 1 ? uIdx.columns[0] : uIdx.columns,
          unique: true,
        });
      }
      for (const nuIdx of spec.nonUniqueIndexes) {
        indexes.set(nuIdx.name, {
          name: nuIdx.name,
          keyPath: nuIdx.columns.length === 1 ? nuIdx.columns[0] : nuIdx.columns,
          unique: false,
        });
      }
      dbStores.set(spec.tableName, {
        name: spec.tableName,
        keyPath: spec.primaryKey,
        indexes,
        records: new Map(),
      });
    }
    nodeFallbackDatabases.set(dbName, dbStores);
  }
  return dbStores;
}

function cloneRecordForStorage<T>(val: T): T {
  if (!val || typeof val !== 'object') return val;
  if (val instanceof Blob) return val;
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    if (v instanceof Blob) {
      copy[k] = v;
    } else if (v !== undefined && typeof v === 'object' && v !== null) {
      copy[k] = JSON.parse(JSON.stringify(v));
    } else {
      copy[k] = v;
    }
  }
  return copy as T;
}

interface SynchronousStoreHandle {
  add(row: Record<string, unknown>): void;
  put(row: Record<string, unknown>): void;
  delete(primaryKey: string): void;
}

/**
 * Isolated IndexedDB Adapter for Phase 1.
 * Strictly enforces that only 'tradevault_idb_test' can be opened in Phase 1.
 */
export class IdbDatabaseAdapter implements ILocalDatabaseAdapter {
  public readonly dbName: string;
  private idbConnection: IDBDatabase | null = null;
  private isOpen = false;
  private openPromise: Promise<void> | null = null;
  private openGeneration = 0;
  private openInvocationCount = 0;
  private readonly useNativeIdb: boolean;

  constructor(dbName: string = PHASE_1_TEST_DB_NAME) {
    if (dbName !== PHASE_1_TEST_DB_NAME) {
      throw new Error(
        `ERR_PRODUCTION_DB_BLOCKED_IN_PHASE_1: Phase 1 strictly permits only "${PHASE_1_TEST_DB_NAME}". Attempted to use "${dbName}".`
      );
    }
    this.dbName = dbName;
    this.useNativeIdb = typeof globalThis !== 'undefined' && typeof globalThis.indexedDB !== 'undefined';
  }

  /**
   * Diagnostic counter for testing CC-RACE-02 connection coalescing.
   */
  public getOpenInvocationCountForTesting(): number {
    return this.openInvocationCount;
  }

  public async open(): Promise<void> {
    if (this.dbName !== PHASE_1_TEST_DB_NAME) {
      throw new Error(`ERR_PRODUCTION_DB_BLOCKED_IN_PHASE_1: Cannot open "${this.dbName}".`);
    }
    if (this.isOpen && (!this.useNativeIdb || this.idbConnection !== null)) {
      return;
    }
    if (this.openPromise !== null) {
      return this.openPromise;
    }

    const currentGeneration = ++this.openGeneration;
    const pendingOpen = this.executeOpenAttempt(currentGeneration);

    this.openPromise = pendingOpen;

    try {
      await pendingOpen;
    } finally {
      if (this.openPromise === pendingOpen) {
        this.openPromise = null;
      }
    }
  }

  private async executeOpenAttempt(currentGeneration: number): Promise<void> {
    this.openInvocationCount++;

    if (!this.useNativeIdb) {
      ensureNodeFallbackDbInitialized(this.dbName);
      await Promise.resolve();
      if (this.openGeneration !== currentGeneration) {
        return;
      }
      this.isOpen = true;
      return;
    }

    const openedDb = await new Promise<IDBDatabase | null>((resolve, reject) => {
      let req: IDBOpenDBRequest;
      try {
        req = globalThis.indexedDB.open(this.dbName, LOCAL_DB_SCHEMA_VERSION);
      } catch (syncOpenErr) {
        reject(syncOpenErr instanceof Error ? syncOpenErr : new Error(String(syncOpenErr)));
        return;
      }

      req.onupgradeneeded = () => {
        const db = req.result;
        for (const spec of Object.values(LOGICAL_ENTITY_SCHEMA_SPECS)) {
          if (!db.objectStoreNames.contains(spec.tableName)) {
            const store = db.createObjectStore(spec.tableName, { keyPath: spec.primaryKey });
            for (const uIdx of spec.uniqueIndexes) {
              const kp = uIdx.columns.length === 1 ? uIdx.columns[0] : uIdx.columns;
              store.createIndex(uIdx.name, kp, { unique: true });
            }
            for (const nuIdx of spec.nonUniqueIndexes) {
              const kp = nuIdx.columns.length === 1 ? nuIdx.columns[0] : nuIdx.columns;
              store.createIndex(nuIdx.name, kp, { unique: false });
            }
          }
        }
      };

      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          if (this.idbConnection === db) {
            this.idbConnection = null;
            this.isOpen = false;
          }
        };

        if (this.openGeneration !== currentGeneration) {
          // close() was called while indexedDB.open() was still in flight.
          // Immediately close the newly opened handle so it never leaks.
          db.close();
          resolve(null);
          return;
        }

        resolve(db);
      };

      req.onerror = () => reject(req.error || new Error('ERR_IDB_OPEN_FAILED'));
    });

    if (this.openGeneration === currentGeneration && openedDb !== null) {
      this.idbConnection = openedDb;
      this.isOpen = true;
    }
  }

  public async close(): Promise<void> {
    const inFlightOpen = this.openPromise;
    this.openGeneration++;
    this.openPromise = null;

    if (this.idbConnection) {
      this.idbConnection.close();
      this.idbConnection = null;
    }
    this.isOpen = false;

    if (inFlightOpen) {
      try {
        await inFlightOpen;
      } catch {
        // Ignore open errors when closing an in-flight open attempt.
      }
    }
  }

  public async destroyDatabaseForTestingOnly(): Promise<void> {
    if (this.dbName !== PHASE_1_TEST_DB_NAME) {
      throw new Error(
        `ERR_FORBIDDEN_DATABASE_DESTROY: destroyDatabaseForTestingOnly is restricted to "${PHASE_1_TEST_DB_NAME}".`
      );
    }
    await this.close();

    if (!this.useNativeIdb) {
      nodeFallbackDatabases.delete(this.dbName);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const req = globalThis.indexedDB.deleteDatabase(this.dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error('ERR_IDB_DELETE_FAILED'));
      req.onblocked = () =>
        reject(
          new Error(
            'ERR_IDB_DELETE_BLOCKED: Another connection is still holding the isolated Phase 1 test database open.'
          )
        );
    });
  }

  /**
   * Returns live store & index metadata from the initialized database for AT-16 verification.
   */
  public async inspectLiveStoreMetadata(): Promise<
    Array<{
      storeName: string;
      keyPath: string;
      indexes: Array<{ name: string; keyPath: string | string[]; unique: boolean }>;
    }>
  > {
    await this.open();

    if (!this.useNativeIdb) {
      const dbStores = ensureNodeFallbackDbInitialized(this.dbName);
      const out: Array<{
        storeName: string;
        keyPath: string;
        indexes: Array<{ name: string; keyPath: string | string[]; unique: boolean }>;
      }> = [];
      for (const store of dbStores.values()) {
        out.push({
          storeName: store.name,
          keyPath: store.keyPath,
          indexes: Array.from(store.indexes.values()),
        });
      }
      return out;
    }

    const db = this.idbConnection!;
    const names = Array.from(db.objectStoreNames) as LocalTableName[];
    const tx = db.transaction(names, 'readonly');
    const result = names.map((name) => {
      const store = tx.objectStore(name);
      const idxNames = Array.from(store.indexNames);
      const indexes = idxNames.map((iName) => {
        const idx = store.index(iName);
        return {
          name: idx.name,
          keyPath: Array.isArray(idx.keyPath) ? Array.from(idx.keyPath) : String(idx.keyPath),
          unique: idx.unique,
        };
      });
      return {
        storeName: store.name,
        keyPath: String(store.keyPath),
        indexes,
      };
    });
    return result;
  }

  /**
   * Executes a synchronous write callback inside an atomic transaction.
   * CRITICAL: The callback must NOT be async or return a Promise; all async work
   * (hashing, Blob creation) must be completed before calling this method.
   */
  public async executeAtomicWriteTransaction(
    storeNames: LocalTableName[],
    syncWriteCallback: (stores: Record<LocalTableName, SynchronousStoreHandle>) => void
  ): Promise<void> {
    await this.open();

    // Enforce synchronous callback contract (reject async functions that would cause TransactionInactiveError)
    if (syncWriteCallback.constructor.name === 'AsyncFunction') {
      const inactiveErr = new Error(
        'ERR_ASYNC_INSIDE_IDB_TRANSACTION: Async callbacks inside executeAtomicWriteTransaction are prohibited because they cause TransactionInactiveError.'
      );
      inactiveErr.name = 'TransactionInactiveError';
      throw inactiveErr;
    }

    if (!this.useNativeIdb) {
      const dbStores = ensureNodeFallbackDbInitialized(this.dbName);
      // Snapshot current records of involved stores for atomic rollback on any error
      const backupByStore = new Map<LocalTableName, Map<string, Record<string, unknown>>>();
      for (const sName of storeNames) {
        const storeDef = dbStores.get(sName);
        if (!storeDef) throw new Error(`ERR_UNKNOWN_STORE: ${sName}`);
        const snapshot = new Map<string, Record<string, unknown>>();
        for (const [k, v] of storeDef.records.entries()) {
          snapshot.set(k, cloneRecordForStorage(v));
        }
        backupByStore.set(sName, snapshot);
      }

      const handles = {} as Record<LocalTableName, SynchronousStoreHandle>;
      for (const sName of storeNames) {
        const storeDef = dbStores.get(sName)!;
        handles[sName] = {
          add: (row: Record<string, unknown>) => {
            const pk = extractKeyValue(row, storeDef.keyPath);
            if (!pk) {
              throw createConstraintError(`Primary key "${storeDef.keyPath}" is empty in store "${sName}".`);
            }
            if (storeDef.records.has(pk)) {
              throw createConstraintError(
                `ConstraintError: Primary key "${pk}" already exists in store "${sName}".`
              );
            }
            // Enforce unique indexes
            for (const idx of storeDef.indexes.values()) {
              if (idx.unique) {
                const candidateIdxKey = extractKeyValue(row, idx.keyPath);
                for (const existingRow of storeDef.records.values()) {
                  if (extractKeyValue(existingRow, idx.keyPath) === candidateIdxKey) {
                    throw createConstraintError(
                      `ConstraintError: Unique index "${idx.name}" violated for key "${candidateIdxKey}" in store "${sName}".`
                    );
                  }
                }
              }
            }
            storeDef.records.set(pk, cloneRecordForStorage(row));
          },
          put: (row: Record<string, unknown>) => {
            const pk = extractKeyValue(row, storeDef.keyPath);
            if (!pk) {
              throw createConstraintError(`Primary key "${storeDef.keyPath}" is empty in store "${sName}".`);
            }
            // Enforce unique indexes against other primary keys
            for (const idx of storeDef.indexes.values()) {
              if (idx.unique) {
                const candidateIdxKey = extractKeyValue(row, idx.keyPath);
                for (const [existingPk, existingRow] of storeDef.records.entries()) {
                  if (
                    existingPk !== pk &&
                    extractKeyValue(existingRow, idx.keyPath) === candidateIdxKey
                  ) {
                    throw createConstraintError(
                      `ConstraintError: Unique index "${idx.name}" violated on put() for key "${candidateIdxKey}" in store "${sName}".`
                    );
                  }
                }
              }
            }
            storeDef.records.set(pk, cloneRecordForStorage(row));
          },
          delete: (primaryKey: string) => {
            storeDef.records.delete(String(primaryKey));
          },
        };
      }

      try {
        syncWriteCallback(handles);
      } catch (err) {
        // Atomic rollback of all touched stores!
        for (const [sName, snapshot] of backupByStore.entries()) {
          const storeDef = dbStores.get(sName)!;
          storeDef.records = snapshot;
        }
        throw err;
      }
      return;
    }

    // Native Browser IndexedDB Execution
    const db = this.idbConnection!;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeNames, 'readwrite');
      let requestError: Error | null = null;

      const handles = {} as Record<LocalTableName, SynchronousStoreHandle>;
      for (const sName of storeNames) {
        const os = tx.objectStore(sName);
        handles[sName] = {
          add: (row: Record<string, unknown>) => {
            const req = os.add(row);
            req.onerror = () => {
              requestError = req.error || createConstraintError('IDB add() failed.');
            };
          },
          put: (row: Record<string, unknown>) => {
            const req = os.put(row);
            req.onerror = () => {
              requestError = req.error || createConstraintError('IDB put() failed.');
            };
          },
          delete: (primaryKey: string) => {
            const req = os.delete(primaryKey);
            req.onerror = () => {
              requestError = req.error || new Error('IDB delete() failed.');
            };
          },
        };
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        reject(requestError || tx.error || createConstraintError('IDB transaction error.'));
      };
      tx.onabort = () => {
        reject(requestError || tx.error || createConstraintError('IDB transaction aborted.'));
      };

      try {
        syncWriteCallback(handles);
      } catch (syncErr) {
        requestError = syncErr instanceof Error ? syncErr : new Error(String(syncErr));
        try {
          tx.abort();
        } catch {
          // ignore if already aborting
        }
        reject(requestError);
      }
    });
  }

  private async readAllFromStore<T>(storeName: LocalTableName): Promise<T[]> {
    await this.open();
    if (!this.useNativeIdb) {
      const dbStores = ensureNodeFallbackDbInitialized(this.dbName);
      const storeDef = dbStores.get(storeName)!;
      return Array.from(storeDef.records.values()).map((r) => cloneRecordForStorage(r) as unknown as T);
    }

    const db = this.idbConnection!;
    return new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction([storeName], 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result || []) as T[]);
      req.onerror = () => reject(req.error || new Error(`Failed to read store ${storeName}`));
    });
  }

  private async readByPrimaryKey<T>(storeName: LocalTableName, key: string): Promise<T | null> {
    await this.open();
    if (!this.useNativeIdb) {
      const dbStores = ensureNodeFallbackDbInitialized(this.dbName);
      const storeDef = dbStores.get(storeName)!;
      const found = storeDef.records.get(key);
      return found ? (cloneRecordForStorage(found) as unknown as T) : null;
    }

    const db = this.idbConnection!;
    return new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction([storeName], 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? (req.result as T) : null);
      req.onerror = () => reject(req.error || new Error(`Failed to get key ${key} from ${storeName}`));
    });
  }

  public async getTradeByCanonicalUuid(canonicalUuid: string): Promise<LocalTradeRow | null> {
    if (!canonicalUuid) return null;
    return this.readByPrimaryKey<LocalTradeRow>('trades', canonicalUuid.trim().toLowerCase());
  }

  public async getTradeByOwnerAndLocalId(
    ownerScope: OwnerScope,
    localId: string
  ): Promise<LocalTradeRow | null> {
    await this.open();
    const cleanScope = String(ownerScope).trim();
    const cleanId = String(localId).trim();

    if (!this.useNativeIdb) {
      const all = await this.readAllFromStore<LocalTradeRow>('trades');
      return all.find((r) => r.owner_scope === cleanScope && r.id === cleanId) || null;
    }

    const db = this.idbConnection!;
    return new Promise<LocalTradeRow | null>((resolve, reject) => {
      const tx = db.transaction(['trades'], 'readonly');
      const store = tx.objectStore('trades');
      const idx = store.index('idx_trades_owner_local_id');
      const req = idx.get([cleanScope, cleanId]);
      req.onsuccess = () => resolve(req.result ? (req.result as LocalTradeRow) : null);
      req.onerror = () => reject(req.error || new Error('Failed to query idx_trades_owner_local_id'));
    });
  }

  public async getTradesByOwner(ownerScope: OwnerScope): Promise<LocalTradeRow[]> {
    const cleanScope = String(ownerScope).trim();
    const all = await this.readAllFromStore<LocalTradeRow>('trades');
    return all
      .filter((r) => r.owner_scope === cleanScope)
      .sort((a, b) => b.dateTime_utc_ms - a.dateTime_utc_ms);
  }

  public async getAllTradesAcrossOwners(): Promise<LocalTradeRow[]> {
    return this.readAllFromStore<LocalTradeRow>('trades');
  }

  /**
   * Inserts or updates a Trade record in IndexedDB.
   * - Performs all validation and SHA-256 canonical digest computation BEFORE opening the transaction.
   * - Uses store.add() for new records so the unique index ['owner_scope', 'id'] and primary key
   *   'canonical_uuid' serve as the final guard against race conditions or accidental overwrites.
   * - Handles ConstraintError only AFTER the failed transaction has aborted by retrying in a new transaction.
   */
  public async putTrade(trade: Trade, options: PutTradeOptions): Promise<LocalTradeRow> {
    await this.open();

    const validation = validateAndNormalizeTradeRecord(trade, options.ownerScope);
    if (!validation.isValid || !validation.normalizedTrade) {
      throw new Error(
        `ERR_NON_FINITE_NUMERIC_FIELD: ${validation.reasonCode} - ${validation.detail}`
      );
    }

    const cleanTrade = validation.normalizedTrade;
    const canonicalDigest = await computeCanonicalTradeDigest(cleanTrade);
    const identity = resolveCanonicalTradeIdentity(
      cleanTrade.id,
      options.ownerScope,
      options.canonicalUuid,
      options.isCloudBound
    );
    const legacyCandidateUuid = identity.legacyCandidateUuid;
    const parsedDate = parseTradeDateTime(cleanTrade.dateTime) || new Date();
    const nowIso = new Date(options.nowMs ?? Date.now()).toISOString();
    const isCloudBound: 0 | 1 =
      options.isCloudBound !== undefined ? (options.isCloudBound === 1 ? 1 : 0) : identity.isCloudBound;
    const hasCustomUuidGenerator = typeof options.uuidGenerator === 'function';
    const uuidGenerator = options.uuidGenerator ?? (() => crypto.randomUUID());

    const MAX_ATTEMPTS = 4;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Check if this [owner_scope, id] already exists
      const existingSameScope = await this.getTradeByOwnerAndLocalId(
        options.ownerScope,
        cleanTrade.id
      );

      let targetCanonicalUuid: string;
      let isNewInsert: boolean;
      let nextSyncRevision = 1;

      if (existingSameScope) {
        // Updating an existing record belonging to the exact same [owner_scope, id]
        targetCanonicalUuid = existingSameScope.canonical_uuid;
        isNewInsert = false;
        nextSyncRevision = existingSameScope.sync_revision + 1;
      } else if (isCloudBound === 1 && options.canonicalUuid) {
        // Cloud-bound record: preserve its verified cloud UUID; never regenerate
        targetCanonicalUuid = options.canonicalUuid.trim().toLowerCase();
        isNewInsert = true;
      } else {
        // New unbound local record:
        // On attempt 1 (without a custom test uuidGenerator override), use the deterministic owner-scoped canonicalUuid
        if (attempt === 1 && options.canonicalUuid && UUID_V4_REGEX.test(options.canonicalUuid)) {
          targetCanonicalUuid = options.canonicalUuid.trim().toLowerCase();
        } else if (attempt === 1 && !hasCustomUuidGenerator) {
          targetCanonicalUuid = identity.canonicalUuid;
        } else {
          targetCanonicalUuid = uuidGenerator().trim().toLowerCase();
        }
        isNewInsert = true;
      }

      const rowToWrite: LocalTradeRow = {
        canonical_uuid: targetCanonicalUuid,
        owner_scope: options.ownerScope.trim(),
        id: cleanTrade.id,
        legacy_candidate_uuid: legacyCandidateUuid,
        is_cloud_bound: isCloudBound,
        dateTime: cleanTrade.dateTime,
        dateTime_utc_ms: parsedDate.getTime(),
        wall_clock_datetime: cleanTrade.dateTime,
        iana_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        tz_offset_minutes: parsedDate.getTimezoneOffset(),
        instrument: cleanTrade.instrument,
        position: cleanTrade.position,
        strategy: cleanTrade.strategy,
        session: cleanTrade.session ?? null,
        entryPrice: cleanTrade.entryPrice,
        stopLoss: cleanTrade.stopLoss ?? null,
        takeProfit: cleanTrade.takeProfit ?? null,
        exitPrice: cleanTrade.exitPrice ?? null,
        lotSize: cleanTrade.lotSize,
        riskAmount: cleanTrade.riskAmount,
        riskPercentage: cleanTrade.riskPercentage,
        outcome: cleanTrade.outcome,
        grossProfit: cleanTrade.grossProfit,
        commission: cleanTrade.commission,
        swap: cleanTrade.swap,
        netProfit: cleanTrade.netProfit,
        rMultiple: cleanTrade.rMultiple ?? null,
        screenshotUrl: cleanTrade.screenshotUrl ?? null,
        screenshot_id: existingSameScope?.screenshot_id ?? null,
        notes: cleanTrade.notes ?? null,
        entryReason: cleanTrade.entryReason ?? null,
        postTradeEvaluation: cleanTrade.postTradeEvaluation ?? null,
        disciplineRating: cleanTrade.disciplineRating ?? null,
        executionNotes: cleanTrade.executionNotes ?? null,
        isDemo: cleanTrade.isDemo ? 1 : 0,
        createdAt: cleanTrade.createdAt ?? existingSameScope?.createdAt ?? nowIso,
        updatedAt: cleanTrade.updatedAt ?? nowIso,
        sync_status: existingSameScope?.sync_status ?? 'LOCAL_ONLY',
        sync_revision: nextSyncRevision,
        last_mutation_id: crypto.randomUUID(),
        canonical_digest: canonicalDigest,
      };

      try {
        await this.executeAtomicWriteTransaction(['trades'], (stores) => {
          if (isNewInsert) {
            // MANDATORY: Use add() as final guard so any collision throws ConstraintError and aborts
            stores.trades.add(rowToWrite as unknown as Record<string, unknown>);
          } else {
            stores.trades.put(rowToWrite as unknown as Record<string, unknown>);
          }
        });
        return rowToWrite;
      } catch (err: unknown) {
        const errName = err instanceof Error ? err.name : '';
        const errMsg = err instanceof Error ? err.message : String(err);
        const isConstraintErr =
          errName === 'ConstraintError' || errMsg.includes('ConstraintError');

        // Handle ConstraintError ONLY after the failed transaction has aborted.
        // Only retry with a fresh UUID if this was a new unbound insert (isCloudBound === 0).
        if (isConstraintErr && isNewInsert && isCloudBound === 0 && attempt < MAX_ATTEMPTS) {
          continue;
        }
        throw err;
      }
    }

    throw new Error('ERR_UUID_COLLISION_RECOVERY_EXHAUSTED: Failed to allocate unique canonical_uuid.');
  }

  public async putSettings(
    settings: AppSettings,
    ownerScope: OwnerScope,
    nowMs?: number
  ): Promise<LocalSettingsRow> {
    await this.open();

    const validation = validateAndNormalizeSettingsRecord(settings);
    if (!validation.isValid || !validation.normalizedSettings) {
      throw new Error(
        `ERR_INVALID_SETTINGS: ${validation.reasonCode} - ${validation.detail}`
      );
    }

    const norm = validation.normalizedSettings;
    const digest = await computeCanonicalSettingsDigest(norm);
    const cleanScope = String(ownerScope).trim();
    const existing = await this.getSettingsByOwner(cleanScope);

    const row: LocalSettingsRow = {
      owner_scope: cleanScope,
      currency: norm.currency,
      currencySymbol: norm.currencySymbol,
      startingBalance: norm.startingBalance,
      xauusdContractSize: norm.xauusdContractSize,
      xauusdPointValue: norm.xauusdPointValue,
      xauusdTickSize: norm.xauusdTickSize ?? 0.01,
      xauusdTickValue: norm.xauusdTickValue ?? 1.0,
      xauusdMinLot: norm.xauusdMinLot ?? 0.01,
      xauusdLotStep: norm.xauusdLotStep ?? 0.01,
      defaultLeverage: norm.defaultLeverage ?? 500,
      brokerCommissionPerLot: norm.brokerCommissionPerLot,
      defaultRiskPercent: norm.defaultRiskPercent,
      maxTradeRiskPercent: norm.maxTradeRiskPercent ?? 2.0,
      maxTradeRiskAmount: norm.maxTradeRiskAmount ?? 200,
      maxDailyLossPercent: norm.maxDailyLossPercent,
      maxDailyLossAmount: norm.maxDailyLossAmount,
      maxConsecutiveLossLimit: norm.maxConsecutiveLossLimit,
      maxDrawdownLimitPercent: norm.maxDrawdownLimitPercent ?? 10.0,
      resetTimezone: norm.resetTimezone ?? 'WIB (UTC+7)',
      targetMonthlyReturnPercent: norm.targetMonthlyReturnPercent,
      updated_at: new Date(nowMs ?? Date.now()).toISOString(),
      sync_status: 'LOCAL_ONLY',
      sync_revision: existing ? existing.sync_revision + 1 : 1,
      canonical_digest: digest,
    };

    await this.executeAtomicWriteTransaction(['settings'], (stores) => {
      if (!existing) {
        stores.settings.add(row as unknown as Record<string, unknown>);
      } else {
        stores.settings.put(row as unknown as Record<string, unknown>);
      }
    });

    return row;
  }

  public async getSettingsByOwner(ownerScope: OwnerScope): Promise<LocalSettingsRow | null> {
    return this.readByPrimaryKey<LocalSettingsRow>('settings', String(ownerScope).trim());
  }

  public async stageScreenshot(params: StageScreenshotParams): Promise<ScreenshotMetadataRow> {
    await this.open();

    // Perform async binary decoding and SHA-256 calculation BEFORE opening the IDB transaction
    let decoded = params.preDecoded;
    if (!decoded) {
      if (!params.base64DataUrl) {
        throw new Error('ERR_MISSING_SCREENSHOT_PAYLOAD: Either base64DataUrl or preDecoded is required.');
      }
      decoded = await decodeBase64DataUrlToBinary(params.base64DataUrl);
    }

    const now = params.createdAt ?? Date.now();
    const screenshotId = params.screenshotId ?? crypto.randomUUID();
    const cleanScope = String(params.ownerScope).trim();

    const metaRow: ScreenshotMetadataRow = {
      screenshot_id: screenshotId,
      owner_scope: cleanScope,
      trade_canonical_uuid: params.tradeCanonicalUuid ?? null,
      mime_type: decoded.mimeType,
      size_bytes: decoded.sizeBytes,
      sha256_hash: decoded.sha256Hex,
      lifecycle_status: params.lifecycleStatus ?? 'STAGED',
      upload_status: params.uploadStatus ?? 'LOCAL_ONLY',
      remote_storage_path: params.remoteStoragePath ?? null,
      lease_owner_id: params.leaseOwnerId ?? null,
      lease_acquired_at: params.leaseAcquiredAt ?? null,
      lease_expires_at: params.leaseExpiresAt ?? null,
      created_at: now,
      updated_at: params.updatedAt ?? now,
    };

    const fileRow: ScreenshotFileRow = {
      screenshot_id: screenshotId,
      owner_scope: cleanScope,
      blob_data: decoded.blob,
      mime_type: decoded.mimeType,
      size_bytes: decoded.sizeBytes,
      sha256_hash: decoded.sha256Hex,
      created_at: now,
    };

    await this.executeAtomicWriteTransaction(
      ['screenshot_metadata', 'screenshot_files'],
      (stores) => {
        stores.screenshot_metadata.add(metaRow as unknown as Record<string, unknown>);
        stores.screenshot_files.add(fileRow as unknown as Record<string, unknown>);
      }
    );

    return metaRow;
  }

  public async getScreenshotMetadata(screenshotId: string): Promise<ScreenshotMetadataRow | null> {
    return this.readByPrimaryKey<ScreenshotMetadataRow>('screenshot_metadata', screenshotId);
  }

  public async getScreenshotFile(screenshotId: string): Promise<ScreenshotFileRow | null> {
    return this.readByPrimaryKey<ScreenshotFileRow>('screenshot_files', screenshotId);
  }

  public async getScreenshotMetadataByOwner(
    ownerScope: OwnerScope
  ): Promise<ScreenshotMetadataRow[]> {
    const cleanScope = String(ownerScope).trim();
    const all = await this.readAllFromStore<ScreenshotMetadataRow>('screenshot_metadata');
    return all.filter((row) => row.owner_scope === cleanScope);
  }

  public async getScreenshotFilesByOwner(ownerScope: OwnerScope): Promise<ScreenshotFileRow[]> {
    const cleanScope = String(ownerScope).trim();
    const all = await this.readAllFromStore<ScreenshotFileRow>('screenshot_files');
    return all.filter((row) => row.owner_scope === cleanScope);
  }

  public async acquireScreenshotLease(
    screenshotId: string,
    leaseOwnerId: string,
    durationMs = DEFAULT_SCREENSHOT_LEASE_DURATION_MS,
    nowMs = Date.now()
  ): Promise<boolean> {
    const existing = await this.getScreenshotMetadata(screenshotId);
    if (!existing) return false;

    if (
      existing.lease_owner_id &&
      existing.lease_owner_id !== leaseOwnerId &&
      existing.lease_expires_at !== null &&
      existing.lease_expires_at > nowMs
    ) {
      return false;
    }

    const updated: ScreenshotMetadataRow = {
      ...existing,
      lease_owner_id: leaseOwnerId,
      lease_acquired_at: nowMs,
      lease_expires_at: nowMs + durationMs,
      updated_at: nowMs,
    };

    await this.executeAtomicWriteTransaction(['screenshot_metadata'], (stores) => {
      stores.screenshot_metadata.put(updated as unknown as Record<string, unknown>);
    });
    lockScreenshotInMemory(screenshotId);
    return true;
  }

  public async renewScreenshotLease(
    screenshotId: string,
    leaseOwnerId: string,
    durationMs = DEFAULT_SCREENSHOT_LEASE_DURATION_MS,
    nowMs = Date.now()
  ): Promise<boolean> {
    const existing = await this.getScreenshotMetadata(screenshotId);
    if (!existing || existing.lease_owner_id !== leaseOwnerId) return false;

    const updated: ScreenshotMetadataRow = {
      ...existing,
      lease_expires_at: nowMs + durationMs,
      updated_at: nowMs,
    };

    await this.executeAtomicWriteTransaction(['screenshot_metadata'], (stores) => {
      stores.screenshot_metadata.put(updated as unknown as Record<string, unknown>);
    });
    return true;
  }

  public async releaseScreenshotLease(
    screenshotId: string,
    leaseOwnerId: string,
    nowMs = Date.now()
  ): Promise<void> {
    unlockScreenshotInMemory(screenshotId);
    const existing = await this.getScreenshotMetadata(screenshotId);
    if (!existing || existing.lease_owner_id !== leaseOwnerId) return;

    const updated: ScreenshotMetadataRow = {
      ...existing,
      lease_owner_id: null,
      lease_acquired_at: null,
      lease_expires_at: null,
      updated_at: nowMs,
    };

    await this.executeAtomicWriteTransaction(['screenshot_metadata'], (stores) => {
      stores.screenshot_metadata.put(updated as unknown as Record<string, unknown>);
    });
  }

  /**
   * Evaluates screenshot leases and orphan status under the 5 safety gates.
   * Strictly refuses to delete any records unless target DB is 'tradevault_idb_test'
   * AND options.allowDeleteInIsolatedTestDbOnly === true.
   */
  public async cleanupOrphanScreenshots(
    options: OrphanCleanupOptions
  ): Promise<OrphanCleanupReport> {
    await this.open();
    const nowMs = options.nowMs ?? Date.now();
    const isDeleteAuthorized =
      this.dbName === PHASE_1_TEST_DB_NAME && options.allowDeleteInIsolatedTestDbOnly === true;

    const cleanScope = String(options.ownerScope).trim();
    if (!cleanScope) {
      throw new Error('ERR_SCREENSHOT_CLEANUP_OWNER_SCOPE_REQUIRED');
    }

    // Gate 1: Never run cleanup while this owner scope has an IN_PROGRESS migration.
    const allMigrations = await this.readAllFromStore<MigrationStateRow>('migration_state');
    if (
      allMigrations.some(
        (migration) =>
          migration.owner_scope === cleanScope && migration.status === 'IN_PROGRESS'
      )
    ) {
      return {
        isDryRun: !isDeleteAuthorized,
        skippedBecauseMigrationInProgress: true,
        deletedScreenshotIds: [],
        wouldDeleteCandidateIds: [],
        transitionedToPendingUploadIds: [],
        retainedCount: 0,
      };
    }

    const [allTradesInStore, allOutboxInStore, allMetaInStore] = await Promise.all([
      this.readAllFromStore<LocalTradeRow>('trades'),
      this.readAllFromStore<OutboxSyncQueueRow>('outbox_sync_queue'),
      this.readAllFromStore<ScreenshotMetadataRow>('screenshot_metadata'),
    ]);
    // Cleanup must never cross owner boundaries, even inside the isolated test database.
    const allTrades = allTradesInStore.filter((row) => row.owner_scope === cleanScope);
    const allOutbox = allOutboxInStore.filter((row) => row.owner_scope === cleanScope);
    const allMeta = allMetaInStore.filter((row) => row.owner_scope === cleanScope);

    // Build set of all referenced screenshot IDs and trade canonical UUIDs
    const referencedScreenshotIds = new Set<string>();
    const activeTradeUuids = new Set<string>();

    for (const t of allTrades) {
      activeTradeUuids.add(t.canonical_uuid);
      if (t.screenshot_id) {
        referencedScreenshotIds.add(t.screenshot_id);
      }
    }

    for (const ob of allOutbox) {
      if (
        ob.status === 'PENDING' ||
        ob.status === 'PROCESSING' ||
        ob.status === 'FAILED_RETRYABLE'
      ) {
        if (ob.entity_type === 'SCREENSHOT') {
          referencedScreenshotIds.add(ob.entity_key);
        }
        if (ob.payload_json) {
          for (const meta of allMeta) {
            if (ob.payload_json.includes(meta.screenshot_id)) {
              referencedScreenshotIds.add(meta.screenshot_id);
            }
          }
        }
      }
    }

    const metaMap = new Map<string, ScreenshotMetadataRow>();
    const toTransitionToPendingUpload: string[] = [];
    const toDeleteOrphanIds: string[] = [];
    let retainedCount = 0;

    for (const meta of allMeta) {
      metaMap.set(meta.screenshot_id, meta);

      const hasInMemoryLock = isScreenshotLockedInMemory(meta.screenshot_id);
      const hasActiveLease =
        meta.lease_owner_id !== null &&
        meta.lease_expires_at !== null &&
        meta.lease_expires_at > nowMs;

      const isReferencedByTradeOrOutbox =
        referencedScreenshotIds.has(meta.screenshot_id) ||
        (meta.trade_canonical_uuid !== null && activeTradeUuids.has(meta.trade_canonical_uuid));

      // Rule 1: UPLOADING items older than 15 minutes with no active lease and valid binary
      // transition to PENDING_UPLOAD (and are NEVER deleted).
      if (meta.upload_status === 'UPLOADING') {
        const ageSinceUpdate = nowMs - meta.updated_at;
        if (ageSinceUpdate > STUCK_UPLOADING_THRESHOLD_MS && !hasActiveLease && !hasInMemoryLock) {
          const fileRow = await this.getScreenshotFile(meta.screenshot_id);
          if (fileRow && fileRow.size_bytes > 0) {
            const buf = await fileRow.blob_data.arrayBuffer();
            const computedHash = await computeSha256Hex(buf);
            if (computedHash === meta.sha256_hash) {
              toTransitionToPendingUpload.push(meta.screenshot_id);
            }
          }
        }
        retainedCount++;
        continue;
      }

      // Rule 2: ACTIVE items remain unchanged
      if (meta.lifecycle_status === 'ACTIVE') {
        retainedCount++;
        continue;
      }

      // Rule 3: STAGED items evaluation
      if (meta.lifecycle_status === 'STAGED') {
        const lastActivityMs = Math.max(
          meta.created_at,
          meta.updated_at,
          meta.lease_expires_at ?? 0
        );
        const ageMs = nowMs - lastActivityMs;

        if (
          ageMs > ORPHAN_STAGED_MIN_AGE_MS &&
          !isReferencedByTradeOrOutbox &&
          !hasActiveLease &&
          !hasInMemoryLock
        ) {
          toDeleteOrphanIds.push(meta.screenshot_id);
        } else {
          retainedCount++;
        }
        continue;
      }

      retainedCount++;
    }

    if (!isDeleteAuthorized) {
      return {
        isDryRun: true,
        skippedBecauseMigrationInProgress: false,
        deletedScreenshotIds: [],
        wouldDeleteCandidateIds: toDeleteOrphanIds,
        transitionedToPendingUploadIds: [],
        retainedCount: allMeta.length,
      };
    }

    // Perform atomic update/deletion in isolated test database
    if (toTransitionToPendingUpload.length > 0 || toDeleteOrphanIds.length > 0) {
      await this.executeAtomicWriteTransaction(
        ['screenshot_metadata', 'screenshot_files'],
        (stores) => {
          for (const id of toTransitionToPendingUpload) {
            const orig = metaMap.get(id)!;
            const updated: ScreenshotMetadataRow = {
              ...orig,
              upload_status: 'PENDING_UPLOAD',
              lease_owner_id: null,
              lease_acquired_at: null,
              lease_expires_at: null,
              updated_at: nowMs,
            };
            stores.screenshot_metadata.put(updated as unknown as Record<string, unknown>);
          }

          for (const orphanId of toDeleteOrphanIds) {
            stores.screenshot_metadata.delete(orphanId);
            stores.screenshot_files.delete(orphanId);
          }
        }
      );
    }

    return {
      isDryRun: false,
      skippedBecauseMigrationInProgress: false,
      deletedScreenshotIds: toDeleteOrphanIds,
      wouldDeleteCandidateIds: toDeleteOrphanIds,
      transitionedToPendingUploadIds: toTransitionToPendingUpload,
      retainedCount,
    };
  }

  /**
   * Enqueues a local mutation in outbox_sync_queue with idempotency key (mutation_id)
   * and compare-and-swap (CAS) revision verification (AT-14).
   * Makes ZERO network requests.
   */
  public async enqueueOutboxMutation(
    params: EnqueueOutboxParams
  ): Promise<OutboxSyncQueueRow> {
    await this.open();
    const now = params.nowMs ?? Date.now();
    const cleanScope = String(params.ownerScope).trim();
    const allOutbox = await this.readAllFromStore<OutboxSyncQueueRow>('outbox_sync_queue');

    // 1. If existingMutationId is supplied (retry of the exact same logical mutation),
    // preserve the exact same mutation_id and increment retry_count idempotently.
    if (params.existingMutationId) {
      const existingByMutation = allOutbox.find(
        (r) => r.mutation_id === params.existingMutationId
      );
      if (existingByMutation) {
        const retriedRow: OutboxSyncQueueRow = {
          ...existingByMutation,
          retry_count: existingByMutation.retry_count + 1,
          updated_at: now,
        };
        await this.executeAtomicWriteTransaction(['outbox_sync_queue'], (stores) => {
          stores.outbox_sync_queue.put(retriedRow as unknown as Record<string, unknown>);
        });
        return retriedRow;
      }
    }

    // 2. Compare-And-Swap (CAS) revision verification for this entity
    const entityHistory = allOutbox
      .filter(
        (r) =>
          r.owner_scope === cleanScope &&
          r.entity_type === params.entityType &&
          r.entity_key === params.entityKey
      )
      .sort((a, b) => b.sync_revision - a.sync_revision);

    const latestRevision = entityHistory.length > 0 ? entityHistory[0].sync_revision : 0;

    if (
      params.expectedBaseRevision !== undefined &&
      params.expectedBaseRevision !== latestRevision
    ) {
      throw new Error(
        `ERR_CAS_REVISION_CONFLICT: Expected base sync_revision ${params.expectedBaseRevision}, but current revision is ${latestRevision}.`
      );
    }

    const nextRevision = latestRevision + 1;
    const newRow: OutboxSyncQueueRow = {
      outbox_id: crypto.randomUUID(),
      owner_scope: cleanScope,
      entity_type: params.entityType,
      entity_key: params.entityKey,
      operation_type: params.operationType,
      mutation_id: params.existingMutationId ?? crypto.randomUUID(),
      sync_revision: nextRevision,
      payload_json: JSON.stringify(params.payload ?? {}),
      status: 'PENDING',
      retry_count: 0,
      last_error_code: null,
      last_error_message: null,
      created_at: now,
      updated_at: now,
    };

    await this.executeAtomicWriteTransaction(['outbox_sync_queue'], (stores) => {
      stores.outbox_sync_queue.add(newRow as unknown as Record<string, unknown>);
    });

    return newRow;
  }

  public async getOutboxQueueByOwner(ownerScope: OwnerScope): Promise<OutboxSyncQueueRow[]> {
    const cleanScope = String(ownerScope).trim();
    const all = await this.readAllFromStore<OutboxSyncQueueRow>('outbox_sync_queue');
    return all
      .filter((r) => r.owner_scope === cleanScope)
      .sort((a, b) => a.sync_revision - b.sync_revision);
  }

  public async setMigrationState(state: MigrationStateRow): Promise<void> {
    await this.executeAtomicWriteTransaction(['migration_state'], (stores) => {
      stores.migration_state.put(state as unknown as Record<string, unknown>);
    });
  }

  public async getMigrationState(ownerScope: OwnerScope): Promise<MigrationStateRow | null> {
    return this.readByPrimaryKey<MigrationStateRow>('migration_state', String(ownerScope).trim());
  }

  public async getQuarantinedRecordsByOwner(
    ownerScope: OwnerScope
  ): Promise<QuarantinedRecordRow[]> {
    const cleanScope = String(ownerScope).trim();
    const all = await this.readAllFromStore<QuarantinedRecordRow>('quarantined_records');
    return all.filter((r) => r.owner_scope === cleanScope);
  }

  /**
   * Removes only shadow-migration rows belonging to one owner scope.
   * The failed migration_state row is intentionally retained for diagnostics.
   * This method is restricted to the isolated Phase 1 test database.
   */
  public async rollbackShadowMigrationScope(ownerScope: OwnerScope): Promise<void> {
    if (this.dbName !== PHASE_1_TEST_DB_NAME) {
      throw new Error(
        `ERR_PRODUCTION_MIGRATION_BLOCKED_IN_PHASE_1: Rollback is restricted to "${PHASE_1_TEST_DB_NAME}".`
      );
    }

    const cleanScope = String(ownerScope).trim();
    const [trades, screenshotMetadata, screenshotFiles, quarantinedRecords] = await Promise.all([
      this.getTradesByOwner(cleanScope),
      this.readAllFromStore<ScreenshotMetadataRow>('screenshot_metadata'),
      this.readAllFromStore<ScreenshotFileRow>('screenshot_files'),
      this.getQuarantinedRecordsByOwner(cleanScope),
    ]);

    const tradeIds = trades.map((row) => row.canonical_uuid);
    // Delete only screenshots linked to this scope's shadow-migration trades (or orphaned
    // ACTIVE/LOCAL_ONLY migration screenshots with a non-null trade_canonical_uuid in this scope).
    // Unrelated staged screenshots (lifecycle_status === 'STAGED') and cross-scope references are preserved.
    const tradeIdSet = new Set(tradeIds);
    const migrationScreenshotMetadata = screenshotMetadata.filter(
      (row) =>
        row.owner_scope === cleanScope &&
        row.trade_canonical_uuid !== null &&
        (tradeIdSet.has(row.trade_canonical_uuid) ||
          (row.lifecycle_status === 'ACTIVE' &&
            row.upload_status === 'LOCAL_ONLY' &&
            row.lease_owner_id === null &&
            row.remote_storage_path === null))
    );
    const screenshotIds = new Set<string>(
      migrationScreenshotMetadata.map((row) => row.screenshot_id)
    );
    const migrationScreenshotFileIds = new Set(
      screenshotFiles
        .filter((row) => row.owner_scope === cleanScope && screenshotIds.has(row.screenshot_id))
        .map((row) => row.screenshot_id)
    );
    const quarantineIds = quarantinedRecords.map((row) => row.quarantine_id);

    await this.executeAtomicWriteTransaction(
      [
        LOCAL_DB_TABLES.TRADES,
        LOCAL_DB_TABLES.SETTINGS,
        LOCAL_DB_TABLES.SCREENSHOT_METADATA,
        LOCAL_DB_TABLES.SCREENSHOT_FILES,
        LOCAL_DB_TABLES.QUARANTINED_RECORDS,
      ],
      (stores) => {
        for (const id of tradeIds) stores.trades.delete(id);
        for (const id of screenshotIds) {
          stores.screenshot_metadata.delete(id);
        }
        for (const id of migrationScreenshotFileIds) {
          stores.screenshot_files.delete(id);
        }
        for (const id of quarantineIds) stores.quarantined_records.delete(id);
        stores.settings.delete(cleanScope);
      }
    );
  }

  /**
   * Writes an entire pre-validated, pre-hashed shadow migration batch inside a single atomic
   * IndexedDB transaction across trades, settings, screenshot_metadata, screenshot_files, and quarantined_records.
   * Performs the target-scope emptiness check inside the SAME readwrite transaction so no concurrent
   * writer can interleave records between the check and the batch write.
   * Any failure on any record aborts and rolls back the entire transaction.
   */
  public async writeShadowMigrationBatchAtomically(
    batch: PreparedMigrationBatch
  ): Promise<void> {
    await this.open();

    const cleanScope = String(batch.ownerScope).trim();
    const storeNames: LocalTableName[] = [
      LOCAL_DB_TABLES.TRADES,
      LOCAL_DB_TABLES.SETTINGS,
      LOCAL_DB_TABLES.SCREENSHOT_METADATA,
      LOCAL_DB_TABLES.SCREENSHOT_FILES,
      LOCAL_DB_TABLES.QUARANTINED_RECORDS,
    ];

    const writeBatchToStoreHandles = (
      stores: Record<LocalTableName, SynchronousStoreHandle>
    ): void => {
      for (let i = 0; i < batch.trades.length; i++) {
        if (
          batch.simulateWriteFailureOnTradeIndex !== undefined &&
          i === batch.simulateWriteFailureOnTradeIndex
        ) {
          throw new Error(
            `ERR_SIMULATED_ATOMIC_WRITE_FAILURE: Simulated write failure on trade index ${i}.`
          );
        }

        const item = batch.trades[i];
        if (item.preparedScreenshot) {
          const sc = item.preparedScreenshot;
          const metaRow: ScreenshotMetadataRow = {
            screenshot_id: sc.screenshotId,
            owner_scope: cleanScope,
            trade_canonical_uuid: item.row.canonical_uuid,
            mime_type: sc.mimeType,
            size_bytes: sc.sizeBytes,
            sha256_hash: sc.sha256Hex,
            lifecycle_status: 'ACTIVE',
            upload_status: 'LOCAL_ONLY',
            remote_storage_path: null,
            lease_owner_id: null,
            lease_acquired_at: null,
            lease_expires_at: null,
            created_at: sc.createdAt,
            updated_at: sc.createdAt,
          };
          const fileRow: ScreenshotFileRow = {
            screenshot_id: sc.screenshotId,
            owner_scope: cleanScope,
            blob_data: sc.blob,
            mime_type: sc.mimeType,
            size_bytes: sc.sizeBytes,
            sha256_hash: sc.sha256Hex,
            created_at: sc.createdAt,
          };
          stores.screenshot_metadata.add(metaRow as unknown as Record<string, unknown>);
          stores.screenshot_files.add(fileRow as unknown as Record<string, unknown>);
        }

        stores.trades.add(item.row as unknown as Record<string, unknown>);
      }

      stores.settings.put(batch.settingsRow as unknown as Record<string, unknown>);

      for (const qRow of batch.quarantinedRows) {
        stores.quarantined_records.add(qRow as unknown as Record<string, unknown>);
      }
    };

    if (!this.useNativeIdb) {
      await this.executeAtomicWriteTransaction(storeNames, (stores) => {
        const dbStores = ensureNodeFallbackDbInitialized(this.dbName);
        const tradesRecords = Array.from(
          dbStores.get(LOCAL_DB_TABLES.TRADES)!.records.values()
        );
        const settingsRecords = dbStores.get(LOCAL_DB_TABLES.SETTINGS)!.records;
        const quarantineRecords = Array.from(
          dbStores.get(LOCAL_DB_TABLES.QUARANTINED_RECORDS)!.records.values()
        );
        const hasExistingTrades = tradesRecords.some((r) => r.owner_scope === cleanScope);
        const hasExistingSettings = settingsRecords.has(cleanScope);
        const hasExistingQuarantine = quarantineRecords.some(
          (r) => r.owner_scope === cleanScope
        );
        if (hasExistingTrades || hasExistingSettings || hasExistingQuarantine) {
          throw new Error(
            'ERR_MIGRATION_SCOPE_NOT_EMPTY: Refusing to overwrite existing shadow records.'
          );
        }

        writeBatchToStoreHandles(stores);
      });
      return;
    }

    const db = this.idbConnection!;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeNames, 'readwrite');
      let requestError: Error | null = null;

      const handles = {} as Record<LocalTableName, SynchronousStoreHandle>;
      for (const sName of storeNames) {
        const os = tx.objectStore(sName);
        handles[sName] = {
          add: (row: Record<string, unknown>) => {
            const req = os.add(row);
            req.onerror = () => {
              requestError = req.error || createConstraintError('IDB add() failed.');
            };
          },
          put: (row: Record<string, unknown>) => {
            const req = os.put(row);
            req.onerror = () => {
              requestError = req.error || createConstraintError('IDB put() failed.');
            };
          },
          delete: (primaryKey: string) => {
            const req = os.delete(primaryKey);
            req.onerror = () => {
              requestError = req.error || new Error('IDB delete() failed.');
            };
          },
        };
      }

      const abortWithError = (err: Error) => {
        requestError = err;
        try {
          tx.abort();
        } catch {
          // ignore if already aborting
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        reject(requestError || tx.error || createConstraintError('IDB transaction error.'));
      };
      tx.onabort = () => {
        reject(requestError || tx.error || createConstraintError('IDB transaction aborted.'));
      };

      try {
        const scopeKeyRange = IDBKeyRange.bound(
          [cleanScope, -Infinity],
          [cleanScope, '\uffff']
        );
        const tradesIdx = tx
          .objectStore(LOCAL_DB_TABLES.TRADES)
          .index('idx_trades_owner_local_id');
        const tradesCountReq = tradesIdx.count(scopeKeyRange);

        tradesCountReq.onerror = () => {
          abortWithError(
            tradesCountReq.error || new Error('Failed to check existing trades in scope.')
          );
        };

        tradesCountReq.onsuccess = () => {
          if ((tradesCountReq.result || 0) > 0) {
            abortWithError(
              new Error(
                'ERR_MIGRATION_SCOPE_NOT_EMPTY: Refusing to overwrite existing shadow records.'
              )
            );
            return;
          }

          const settingsCountReq = tx
            .objectStore(LOCAL_DB_TABLES.SETTINGS)
            .count(cleanScope);

          settingsCountReq.onerror = () => {
            abortWithError(
              settingsCountReq.error || new Error('Failed to check existing settings in scope.')
            );
          };

          settingsCountReq.onsuccess = () => {
            if ((settingsCountReq.result || 0) > 0) {
              abortWithError(
                new Error(
                  'ERR_MIGRATION_SCOPE_NOT_EMPTY: Refusing to overwrite existing shadow records.'
                )
              );
              return;
            }

            const quarantineIdx = tx
              .objectStore(LOCAL_DB_TABLES.QUARANTINED_RECORDS)
              .index('idx_quarantine_owner');
            const quarantineCountReq = quarantineIdx.count(scopeKeyRange);

            quarantineCountReq.onerror = () => {
              abortWithError(
                quarantineCountReq.error ||
                  new Error('Failed to check existing quarantined records in scope.')
              );
            };

            quarantineCountReq.onsuccess = () => {
              if ((quarantineCountReq.result || 0) > 0) {
                abortWithError(
                  new Error(
                    'ERR_MIGRATION_SCOPE_NOT_EMPTY: Refusing to overwrite existing shadow records.'
                  )
                );
                return;
              }

              try {
                writeBatchToStoreHandles(handles);
              } catch (syncErr) {
                abortWithError(
                  syncErr instanceof Error ? syncErr : new Error(String(syncErr))
                );
              }
            };
          };
        };
      } catch (outerErr) {
        abortWithError(outerErr instanceof Error ? outerErr : new Error(String(outerErr)));
      }
    });
  }
}
