import { Trade } from '../types/trade';
import { AppSettings } from '../types/settings';
import {
  EnqueueOutboxParams,
  EntityColumnSpec,
  ILocalDatabaseAdapter,
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
} from './databaseTypes';
import { IdbDatabaseAdapter, LOGICAL_ENTITY_SCHEMA_SPECS } from './idbAdapter';

export const SQLITE_PHASE_1_ERROR_CODE =
  'SQLITE_NATIVE_DRIVER_NOT_INSTALLED_IN_PHASE_1' as const;

/**
 * Authoritative SQLite DDL specification for all 7 logical entities.
 * Maintained in strict parity with databaseTypes.ts and idbAdapter.ts.
 * Note: Actual Android SQLite runtime execution is deferred to Phase 5 (Capacitor).
 */
export const SQLITE_TABLE_DDL: Record<LocalTableName, string> = {
  trades: `
CREATE TABLE IF NOT EXISTS trades (
  canonical_uuid TEXT PRIMARY KEY NOT NULL,
  owner_scope TEXT NOT NULL,
  id TEXT NOT NULL,
  legacy_candidate_uuid TEXT NOT NULL,
  is_cloud_bound INTEGER NOT NULL DEFAULT 0,
  dateTime TEXT NOT NULL,
  dateTime_utc_ms INTEGER NOT NULL,
  wall_clock_datetime TEXT NOT NULL,
  iana_timezone TEXT NOT NULL,
  tz_offset_minutes INTEGER NOT NULL,
  instrument TEXT NOT NULL,
  position TEXT NOT NULL CHECK (position IN ('BUY', 'SELL')),
  strategy TEXT NOT NULL,
  session TEXT NULL,
  entryPrice REAL NOT NULL,
  stopLoss REAL NULL,
  takeProfit REAL NULL,
  exitPrice REAL NULL,
  lotSize REAL NOT NULL,
  riskAmount REAL NOT NULL,
  riskPercentage REAL NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('WIN', 'LOSS', 'BREAKEVEN')),
  grossProfit REAL NOT NULL,
  commission REAL NOT NULL,
  swap REAL NOT NULL,
  netProfit REAL NOT NULL,
  rMultiple REAL NULL,
  screenshotUrl TEXT NULL,
  screenshot_id TEXT NULL,
  notes TEXT NULL,
  entryReason TEXT NULL,
  postTradeEvaluation TEXT NULL,
  disciplineRating INTEGER NULL,
  executionNotes TEXT NULL,
  isDemo INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  sync_status TEXT NOT NULL,
  sync_revision INTEGER NOT NULL DEFAULT 1,
  last_mutation_id TEXT NOT NULL,
  canonical_digest TEXT NOT NULL,
  FOREIGN KEY (screenshot_id) REFERENCES screenshot_metadata (screenshot_id) DEFERRABLE INITIALLY DEFERRED
);`.trim(),

  settings: `
CREATE TABLE IF NOT EXISTS settings (
  owner_scope TEXT PRIMARY KEY NOT NULL,
  currency TEXT NOT NULL,
  currencySymbol TEXT NOT NULL,
  startingBalance REAL NOT NULL,
  xauusdContractSize REAL NOT NULL,
  xauusdPointValue REAL NOT NULL,
  xauusdTickSize REAL NOT NULL,
  xauusdTickValue REAL NOT NULL,
  xauusdMinLot REAL NOT NULL,
  xauusdLotStep REAL NOT NULL,
  defaultLeverage REAL NOT NULL,
  brokerCommissionPerLot REAL NOT NULL,
  defaultRiskPercent REAL NOT NULL,
  maxTradeRiskPercent REAL NOT NULL,
  maxTradeRiskAmount REAL NOT NULL,
  maxDailyLossPercent REAL NOT NULL,
  maxDailyLossAmount REAL NOT NULL,
  maxConsecutiveLossLimit INTEGER NOT NULL,
  maxDrawdownLimitPercent REAL NOT NULL,
  resetTimezone TEXT NOT NULL,
  targetMonthlyReturnPercent REAL NOT NULL,
  updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL,
  sync_revision INTEGER NOT NULL DEFAULT 1,
  canonical_digest TEXT NOT NULL
);`.trim(),

  screenshot_metadata: `
CREATE TABLE IF NOT EXISTS screenshot_metadata (
  screenshot_id TEXT PRIMARY KEY NOT NULL,
  owner_scope TEXT NOT NULL,
  trade_canonical_uuid TEXT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256_hash TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL,
  upload_status TEXT NOT NULL,
  remote_storage_path TEXT NULL,
  lease_owner_id TEXT NULL,
  lease_acquired_at INTEGER NULL,
  lease_expires_at INTEGER NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (trade_canonical_uuid) REFERENCES trades (canonical_uuid) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (screenshot_id) REFERENCES screenshot_files (screenshot_id) DEFERRABLE INITIALLY DEFERRED
);`.trim(),

  screenshot_files: `
CREATE TABLE IF NOT EXISTS screenshot_files (
  screenshot_id TEXT PRIMARY KEY NOT NULL,
  owner_scope TEXT NOT NULL,
  blob_data BLOB NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (screenshot_id) REFERENCES screenshot_metadata (screenshot_id) DEFERRABLE INITIALLY DEFERRED
);`.trim(),

  outbox_sync_queue: `
CREATE TABLE IF NOT EXISTS outbox_sync_queue (
  outbox_id TEXT PRIMARY KEY NOT NULL,
  owner_scope TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  sync_revision INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT NULL,
  last_error_message TEXT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);`.trim(),

  migration_state: `
CREATE TABLE IF NOT EXISTS migration_state (
  owner_scope TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  is_active_source_of_truth INTEGER NOT NULL DEFAULT 0,
  source_trades_key TEXT NOT NULL,
  source_settings_key TEXT NOT NULL,
  snapshot_checksum_start TEXT NOT NULL,
  snapshot_checksum_end TEXT NULL,
  migrated_trades_count INTEGER NOT NULL DEFAULT 0,
  migrated_screenshots_count INTEGER NOT NULL DEFAULT 0,
  quarantined_count INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER NULL
);`.trim(),

  quarantined_records: `
CREATE TABLE IF NOT EXISTS quarantined_records (
  quarantine_id TEXT PRIMARY KEY NOT NULL,
  owner_scope TEXT NOT NULL,
  source_storage_key TEXT NOT NULL,
  corruption_scope TEXT NOT NULL,
  record_index INTEGER NULL,
  record_local_id TEXT NULL,
  reason_code TEXT NOT NULL,
  diagnostic_detail TEXT NOT NULL,
  raw_payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);`.trim(),
};

export const SQLITE_INDEX_DDL: string[] = [
  // trades indexes
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_owner_local_id ON trades (owner_scope, id);`,
  `CREATE INDEX IF NOT EXISTS idx_trades_owner_legacy_uuid ON trades (owner_scope, legacy_candidate_uuid);`,
  `CREATE INDEX IF NOT EXISTS idx_trades_owner_date ON trades (owner_scope, dateTime_utc_ms);`,
  `CREATE INDEX IF NOT EXISTS idx_trades_sync_status ON trades (owner_scope, sync_status);`,
  // settings indexes
  `CREATE INDEX IF NOT EXISTS idx_settings_sync_status ON settings (sync_status);`,
  // screenshot_metadata indexes
  `CREATE INDEX IF NOT EXISTS idx_screenshot_meta_owner ON screenshot_metadata (owner_scope);`,
  `CREATE INDEX IF NOT EXISTS idx_screenshot_meta_trade ON screenshot_metadata (trade_canonical_uuid);`,
  `CREATE INDEX IF NOT EXISTS idx_screenshot_meta_lifecycle ON screenshot_metadata (lifecycle_status, updated_at);`,
  `CREATE INDEX IF NOT EXISTS idx_screenshot_meta_upload ON screenshot_metadata (upload_status, updated_at);`,
  // screenshot_files indexes
  `CREATE INDEX IF NOT EXISTS idx_screenshot_files_owner ON screenshot_files (owner_scope);`,
  // outbox_sync_queue indexes
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_mutation_id ON outbox_sync_queue (mutation_id);`,
  `CREATE INDEX IF NOT EXISTS idx_outbox_owner_status ON outbox_sync_queue (owner_scope, status, created_at);`,
  `CREATE INDEX IF NOT EXISTS idx_outbox_entity ON outbox_sync_queue (owner_scope, entity_type, entity_key);`,
  // migration_state indexes
  `CREATE INDEX IF NOT EXISTS idx_migration_status ON migration_state (status);`,
  // quarantined_records indexes
  `CREATE INDEX IF NOT EXISTS idx_quarantine_owner ON quarantined_records (owner_scope, created_at);`,
];

export interface SqliteParityReport {
  isParityValid: boolean;
  verifiedEntityCount: number;
  missingTables: string[];
  columnMismatches: string[];
  typeMismatches: string[];
  primaryKeyMismatches: string[];
  uniqueIndexMismatches: string[];
  nonUniqueIndexMismatches: string[];
  relationshipMismatches: string[];
}

function parseSqliteColumnsFromDdl(ddl: string): EntityColumnSpec[] {
  const openParen = ddl.indexOf('(');
  const closeParen = ddl.lastIndexOf(')');
  if (openParen === -1 || closeParen === -1) return [];

  const body = ddl.slice(openParen + 1, closeParen);
  const lines = body
    .split('\n')
    .map((l) => l.trim().replace(/,$/, ''))
    .filter((l) => l.length > 0);

  const cols: EntityColumnSpec[] = [];
  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9_]+)\s+(TEXT|REAL|INTEGER|BLOB)\b(.*)$/i);
    if (match) {
      const name = match[1];
      const logicalType = match[2].toUpperCase() as 'TEXT' | 'REAL' | 'INTEGER' | 'BLOB';
      const rest = match[3].toUpperCase();
      const isPrimaryKey = rest.includes('PRIMARY KEY');
      const nullable = !rest.includes('NOT NULL') && !isPrimaryKey;
      cols.push({
        name,
        logicalType,
        nullable,
        isPrimaryKey: isPrimaryKey || undefined,
      });
    }
  }
  return cols;
}

function parseSqliteForeignKeysFromDdl(ddl: string): Array<{
  fromColumn: string;
  toTable: string;
  toColumn: string;
}> {
  const parsed: Array<{ fromColumn: string; toTable: string; toColumn: string }> = [];
  const pattern =
    /FOREIGN\s+KEY\s*\(\s*([A-Za-z0-9_]+)\s*\)\s*REFERENCES\s+([A-Za-z0-9_]+)\s*\(\s*([A-Za-z0-9_]+)\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(ddl)) !== null) {
    parsed.push({ fromColumn: match[1], toTable: match[2], toColumn: match[3] });
  }
  return parsed;
}

function parseSqliteIndexesFromDdl(indexDdls: string[]): Array<{
  name: string;
  tableName: string;
  unique: boolean;
  columns: string[];
}> {
  const parsed: Array<{
    name: string;
    tableName: string;
    unique: boolean;
    columns: string[];
  }> = [];

  for (const stmt of indexDdls) {
    const m = stmt.match(
      /CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+([A-Za-z0-9_]+)\s+ON\s+([A-Za-z0-9_]+)\s*\(([^)]+)\)/i
    );
    if (m) {
      const unique = Boolean(m[1]);
      const name = m[2];
      const tableName = m[3];
      const columns = m[4].split(',').map((c) => c.trim());
      parsed.push({ name, tableName, unique, columns });
    }
  }
  return parsed;
}

/**
 * Validates declared logical references against synthetic or isolated adapter rows.
 * This is a Phase 1 contract check only; it does not open SQLite or mutate storage.
 */
export function validateLogicalRelationshipRows(
  rowsByTable: Partial<Record<LocalTableName, Array<Record<string, unknown>>>>
): { isValid: boolean; relationshipMismatches: string[] } {
  const relationshipMismatches: string[] = [];

  for (const [tableName, spec] of Object.entries(LOGICAL_ENTITY_SCHEMA_SPECS) as Array<
    [LocalTableName, (typeof LOGICAL_ENTITY_SCHEMA_SPECS)[LocalTableName]]
  >) {
    const sourceRows = rowsByTable[tableName] ?? [];

    for (const rel of spec.logicalRelationships) {
      const targetRows = rowsByTable[rel.toTable] ?? [];
      const seenOneToOneValues = new Set<unknown>();

      for (const sourceRow of sourceRows) {
        const referenceValue = sourceRow[rel.fromColumn];
        if (referenceValue === null || referenceValue === undefined || referenceValue === '') {
          continue;
        }

        if (
          !targetRows.some((targetRow) => targetRow[rel.toColumn] === referenceValue)
        ) {
          relationshipMismatches.push(
            `${tableName}.${rel.fromColumn} references missing ${rel.toTable}.${rel.toColumn} value "${String(referenceValue)}"`
          );
        }

        if (rel.relationType === 'LOGICAL_1_TO_1') {
          if (seenOneToOneValues.has(referenceValue)) {
            relationshipMismatches.push(
              `${tableName}.${rel.fromColumn} duplicates one-to-one reference "${String(referenceValue)}"`
            );
          }
          seenOneToOneValues.add(referenceValue);
        }
      }
    }
  }

  return {
    isValid: relationshipMismatches.length === 0,
    relationshipMismatches,
  };
}

/**
 * Performs comprehensive deep parity verification (AT-16) across:
 * 1. Logical Entity Schema Specs (TypeScript contracts)
 * 2. SQLite DDL Table & Index Definitions
 * 3. Live IndexedDB Object Store & Index Metadata
 *
 * Verifies entity presence, required columns, logical data types, nullability,
 * primary keys, unique indexes, non-unique indexes, and logical relationships.
 */
export async function verifyDatabaseSchemaParity(
  idbAdapter: IdbDatabaseAdapter
): Promise<SqliteParityReport> {
  const missingTables: string[] = [];
  const columnMismatches: string[] = [];
  const typeMismatches: string[] = [];
  const primaryKeyMismatches: string[] = [];
  const uniqueIndexMismatches: string[] = [];
  const nonUniqueIndexMismatches: string[] = [];
  const relationshipMismatches: string[] = [];

  const expectedTableNames = Object.values(LOCAL_DB_TABLES);
  const liveIdbStores = await idbAdapter.inspectLiveStoreMetadata();
  const liveIdbMap = new Map(liveIdbStores.map((s) => [s.storeName, s]));
  const parsedSqliteIndexes = parseSqliteIndexesFromDdl(SQLITE_INDEX_DDL);

  for (const tableName of expectedTableNames) {
    const spec = LOGICAL_ENTITY_SCHEMA_SPECS[tableName];
    const ddl = SQLITE_TABLE_DDL[tableName];
    const liveStore = liveIdbMap.get(tableName);

    if (!spec || !ddl || !liveStore) {
      missingTables.push(tableName);
      continue;
    }

    const ddlCols = parseSqliteColumnsFromDdl(ddl);
    const ddlColMap = new Map(ddlCols.map((c) => [c.name, c]));

    // 1. Verify Primary Key parity across Spec, SQLite DDL, and Live IDB
    const ddlPkCol = ddlCols.find((c) => c.isPrimaryKey);
    if (!ddlPkCol || ddlPkCol.name !== spec.primaryKey) {
      primaryKeyMismatches.push(
        `${tableName}: SQLite PK "${ddlPkCol?.name}" !== Spec PK "${spec.primaryKey}"`
      );
    }
    if (liveStore.keyPath !== spec.primaryKey) {
      primaryKeyMismatches.push(
        `${tableName}: IDB keyPath "${liveStore.keyPath}" !== Spec PK "${spec.primaryKey}"`
      );
    }

    // 2. Verify all required columns, logical data types, and nullability
    if (ddlCols.length !== spec.columns.length) {
      columnMismatches.push(
        `${tableName}: Column count mismatch (DDL=${ddlCols.length}, Spec=${spec.columns.length})`
      );
    }

    for (const expectedCol of spec.columns) {
      const actualCol = ddlColMap.get(expectedCol.name);
      if (!actualCol) {
        columnMismatches.push(`${tableName}: Missing column "${expectedCol.name}" in SQLite DDL`);
        continue;
      }
      if (actualCol.logicalType !== expectedCol.logicalType) {
        typeMismatches.push(
          `${tableName}.${expectedCol.name}: Type "${actualCol.logicalType}" !== "${expectedCol.logicalType}"`
        );
      }
      if (actualCol.nullable !== expectedCol.nullable) {
        typeMismatches.push(
          `${tableName}.${expectedCol.name}: Nullability "${actualCol.nullable}" !== "${expectedCol.nullable}"`
        );
      }
    }

    // 3. Verify Unique Indexes across Spec, SQLite DDL, and Live IDB
    for (const expectedUniqueIdx of spec.uniqueIndexes) {
      const sqliteIdx = parsedSqliteIndexes.find(
        (idx) => idx.name === expectedUniqueIdx.name && idx.tableName === tableName && idx.unique
      );
      if (
        !sqliteIdx ||
        sqliteIdx.columns.join(',') !== expectedUniqueIdx.columns.join(',')
      ) {
        uniqueIndexMismatches.push(
          `${tableName}: Missing or mismatched unique index "${expectedUniqueIdx.name}" in SQLite DDL`
        );
      }

      const idbIdx = liveStore.indexes.find(
        (idx) => idx.name === expectedUniqueIdx.name && idx.unique === true
      );
      const idbCols = idbIdx
        ? Array.isArray(idbIdx.keyPath)
          ? idbIdx.keyPath
          : [idbIdx.keyPath]
        : [];
      if (!idbIdx || idbCols.join(',') !== expectedUniqueIdx.columns.join(',')) {
        uniqueIndexMismatches.push(
          `${tableName}: Missing or mismatched unique index "${expectedUniqueIdx.name}" in Live IDB`
        );
      }
    }

    // 4. Verify Non-Unique Indexes across Spec, SQLite DDL, and Live IDB
    for (const expectedIdx of spec.nonUniqueIndexes) {
      const sqliteIdx = parsedSqliteIndexes.find(
        (idx) => idx.name === expectedIdx.name && idx.tableName === tableName && !idx.unique
      );
      if (!sqliteIdx || sqliteIdx.columns.join(',') !== expectedIdx.columns.join(',')) {
        nonUniqueIndexMismatches.push(
          `${tableName}: Missing or mismatched index "${expectedIdx.name}" in SQLite DDL`
        );
      }

      const idbIdx = liveStore.indexes.find(
        (idx) => idx.name === expectedIdx.name && idx.unique === false
      );
      const idbCols = idbIdx
        ? Array.isArray(idbIdx.keyPath)
          ? idbIdx.keyPath
          : [idbIdx.keyPath]
        : [];
      if (!idbIdx || idbCols.join(',') !== expectedIdx.columns.join(',')) {
        nonUniqueIndexMismatches.push(
          `${tableName}: Missing or mismatched index "${expectedIdx.name}" in Live IDB`
        );
      }
    }

    // 5. Verify logical relationships against both entity contracts and explicit SQLite FK DDL.
    const declaredForeignKeys = parseSqliteForeignKeysFromDdl(ddl);
    const hasUnexpectedForeignKey = declaredForeignKeys.some(
      (fk) =>
        !spec.logicalRelationships.some(
          (rel) =>
            rel.fromColumn === fk.fromColumn &&
            rel.toTable === fk.toTable &&
            rel.toColumn === fk.toColumn
        )
    );
    if (
      declaredForeignKeys.length !== spec.logicalRelationships.length ||
      hasUnexpectedForeignKey
    ) {
      relationshipMismatches.push(
        `${tableName}: SQLite foreign-key declarations do not exactly match the logical relationship contract`
      );
    }

    for (const rel of spec.logicalRelationships) {
      const sourceHasCol = ddlColMap.has(rel.fromColumn);
      const targetSpec = LOGICAL_ENTITY_SCHEMA_SPECS[rel.toTable];
      const targetHasCol = targetSpec?.columns.some((c) => c.name === rel.toColumn) ?? false;
      const foreignKeyDeclared = declaredForeignKeys.some(
        (fk) =>
          fk.fromColumn === rel.fromColumn &&
          fk.toTable === rel.toTable &&
          fk.toColumn === rel.toColumn
      );
      if (!sourceHasCol || !targetHasCol || !foreignKeyDeclared) {
        relationshipMismatches.push(
          `${tableName}.${rel.fromColumn} -> ${rel.toTable}.${rel.toColumn} missing or mismatched SQLite FK declaration`
        );
      }
    }
  }

  const isParityValid =
    missingTables.length === 0 &&
    columnMismatches.length === 0 &&
    typeMismatches.length === 0 &&
    primaryKeyMismatches.length === 0 &&
    uniqueIndexMismatches.length === 0 &&
    nonUniqueIndexMismatches.length === 0 &&
    relationshipMismatches.length === 0;

  return {
    isParityValid,
    verifiedEntityCount: expectedTableNames.length - missingTables.length,
    missingTables,
    columnMismatches,
    typeMismatches,
    primaryKeyMismatches,
    uniqueIndexMismatches,
    nonUniqueIndexMismatches,
    relationshipMismatches,
  };
}

function throwPhase1StubError(): never {
  throw new Error(SQLITE_PHASE_1_ERROR_CODE);
}

/**
 * Typed SQLite Interface Stub for Phase 1.
 * Does NOT import or initialize any native SQLite plugin or open a physical database.
 * Every runtime method explicitly throws SQLITE_NATIVE_DRIVER_NOT_INSTALLED_IN_PHASE_1.
 */
export class SqliteDatabaseAdapter implements ILocalDatabaseAdapter {
  public readonly dbName: string;

  constructor(dbName: string = PHASE_1_TEST_DB_NAME) {
    this.dbName = dbName;
  }

  public async open(): Promise<void> {
    throwPhase1StubError();
  }

  public async close(): Promise<void> {
    throwPhase1StubError();
  }

  public async destroyDatabaseForTestingOnly(): Promise<void> {
    throwPhase1StubError();
  }

  public async putTrade(_trade: Trade, _options: PutTradeOptions): Promise<LocalTradeRow> {
    throwPhase1StubError();
  }

  public async getTradeByCanonicalUuid(_canonicalUuid: string): Promise<LocalTradeRow | null> {
    throwPhase1StubError();
  }

  public async getTradeByOwnerAndLocalId(
    _ownerScope: OwnerScope,
    _localId: string
  ): Promise<LocalTradeRow | null> {
    throwPhase1StubError();
  }

  public async getTradesByOwner(_ownerScope: OwnerScope): Promise<LocalTradeRow[]> {
    throwPhase1StubError();
  }

  public async getAllTradesAcrossOwners(): Promise<LocalTradeRow[]> {
    throwPhase1StubError();
  }

  public async putSettings(
    _settings: AppSettings,
    _ownerScope: OwnerScope,
    _nowMs?: number
  ): Promise<LocalSettingsRow> {
    throwPhase1StubError();
  }

  public async getSettingsByOwner(_ownerScope: OwnerScope): Promise<LocalSettingsRow | null> {
    throwPhase1StubError();
  }

  public async stageScreenshot(_params: StageScreenshotParams): Promise<ScreenshotMetadataRow> {
    throwPhase1StubError();
  }

  public async getScreenshotMetadata(
    _screenshotId: string
  ): Promise<ScreenshotMetadataRow | null> {
    throwPhase1StubError();
  }

  public async getScreenshotFile(_screenshotId: string): Promise<ScreenshotFileRow | null> {
    throwPhase1StubError();
  }

  public async getScreenshotMetadataByOwner(_ownerScope: OwnerScope): Promise<ScreenshotMetadataRow[]> {
    throwPhase1StubError();
  }

  public async getScreenshotFilesByOwner(_ownerScope: OwnerScope): Promise<ScreenshotFileRow[]> {
    throwPhase1StubError();
  }

  public async acquireScreenshotLease(
    _screenshotId: string,
    _leaseOwnerId: string,
    _durationMs?: number,
    _nowMs?: number
  ): Promise<boolean> {
    throwPhase1StubError();
  }

  public async renewScreenshotLease(
    _screenshotId: string,
    _leaseOwnerId: string,
    _durationMs?: number,
    _nowMs?: number
  ): Promise<boolean> {
    throwPhase1StubError();
  }

  public async releaseScreenshotLease(
    _screenshotId: string,
    _leaseOwnerId: string,
    _nowMs?: number
  ): Promise<void> {
    throwPhase1StubError();
  }

  public async cleanupOrphanScreenshots(
    _options: OrphanCleanupOptions
  ): Promise<OrphanCleanupReport> {
    throwPhase1StubError();
  }

  public async enqueueOutboxMutation(
    _params: EnqueueOutboxParams
  ): Promise<OutboxSyncQueueRow> {
    throwPhase1StubError();
  }

  public async getOutboxQueueByOwner(_ownerScope: OwnerScope): Promise<OutboxSyncQueueRow[]> {
    throwPhase1StubError();
  }

  public async setMigrationState(_state: MigrationStateRow): Promise<void> {
    throwPhase1StubError();
  }

  public async getMigrationState(_ownerScope: OwnerScope): Promise<MigrationStateRow | null> {
    throwPhase1StubError();
  }

  public async getQuarantinedRecordsByOwner(
    _ownerScope: OwnerScope
  ): Promise<QuarantinedRecordRow[]> {
    throwPhase1StubError();
  }

  public async rollbackShadowMigrationScope(_ownerScope: OwnerScope): Promise<void> {
    throwPhase1StubError();
  }

  public async writeShadowMigrationBatchAtomically(
    _batch: PreparedMigrationBatch
  ): Promise<void> {
    throwPhase1StubError();
  }
}
