package worker

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type SchemaIssue struct {
	Actual   string
	Expected string
	Kind     string
	Name     string
}

type SchemaContractReport struct {
	ContractVersion int
	Issues          []SchemaIssue
}

func (report SchemaContractReport) Ready() bool {
	return len(report.Issues) == 0
}

type RollbackSafetyReport struct {
	ActiveV1Jobs                int64
	UnresolvedHandoffs          int64
	ImageStorageRevision        int
	CanvasStorageRevision       int
	ManagedImageAssets          int64
	LocalImageObjects           int64
	ActiveImageReservations     int64
	UnresolvedImageObjects      int64
	ActiveImageHistoryJobs      int64
	UnresolvedImageHistoryItems int64
	UnresolvedImageObservations int64
	ActiveImageHistoryHolds     int64
}

func (report RollbackSafetyReport) Safe() bool {
	return report.ActiveV1Jobs == 0 && report.UnresolvedHandoffs == 0 && report.ImageStorageRevision == 0 && report.CanvasStorageRevision == 0 &&
		report.ManagedImageAssets == 0 && report.LocalImageObjects == 0 && report.ActiveImageReservations == 0 && report.UnresolvedImageObjects == 0 &&
		report.ActiveImageHistoryJobs == 0 && report.UnresolvedImageHistoryItems == 0 && report.UnresolvedImageObservations == 0 && report.ActiveImageHistoryHolds == 0
}

func CheckSchemaContract(ctx context.Context, pool *pgxpool.Pool) (SchemaContractReport, error) {
	report := SchemaContractReport{ContractVersion: 1}
	for _, table := range []string{"GenerationJob", "GenerationAttempt", "GenerationImage", "GeneratedVideo"} {
		var exists bool
		err := pool.QueryRow(ctx, `
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = current_schema() AND table_name = $1
)
`, table).Scan(&exists)
		if err != nil {
			return SchemaContractReport{}, err
		}
		if !exists {
			report.Issues = append(report.Issues, SchemaIssue{
				Expected: "table",
				Kind:     "missing_table",
				Name:     table,
			})
		}
	}

	requiredColumns := map[string][]string{
		"GenerationJob": {
			"contractVersion", "errorCode", "nextAttemptAt", "handoffState",
			"cancelRequestedAt", "refundAppliedAt", "attemptCount",
			"providerChannelId", "providerModels",
		},
		"GenerationAttempt": {
			"id", "jobId", "ordinal", "workerId", "operation",
			"model", "idempotencyKey", "status", "providerRequestId",
			"upstreamSubmittedAt", "nextRetryAt", "errorCode",
			"errorMessage", "createdAt", "updatedAt", "completedAt",
		},
		"GenerationImage": {
			"id", "jobId", "url", "mediaStorage", "storageKey", "mediaAssetId",
		},
		"GeneratedVideo": {
			"id", "jobId", "url", "mediaStorage", "storageKey",
		},
	}
	for table, expected := range requiredColumns {
		rows, err := pool.Query(ctx, `
SELECT column_name FROM information_schema.columns
WHERE table_schema = current_schema() AND table_name = $1
`, table)
		if err != nil {
			return SchemaContractReport{}, err
		}
		found := map[string]bool{}
		for rows.Next() {
			var column string
			if err := rows.Scan(&column); err != nil {
				rows.Close()
				return SchemaContractReport{}, err
			}
			found[column] = true
		}
		rows.Close()
		for _, column := range expected {
			if !found[column] {
				report.Issues = append(report.Issues, SchemaIssue{
					Expected: "column",
					Kind:     "missing_column",
					Name:     table + "." + column,
				})
			}
		}
	}

	var contractDefault *string
	err := pool.QueryRow(ctx, `
SELECT column_default FROM information_schema.columns
WHERE table_schema = current_schema()
  AND table_name = 'GenerationJob'
  AND column_name = 'contractVersion'
`).Scan(&contractDefault)
	if err == nil {
		actual := ""
		if contractDefault != nil {
			actual = *contractDefault
		}
		if !strings.Contains(actual, "0") {
			report.Issues = append(report.Issues, SchemaIssue{
				Actual: actual, Expected: "legacy default 0",
				Kind: "invalid_default", Name: "GenerationJob.contractVersion",
			})
		}
	}

	requiredEnums := map[string][]string{
		"GenerationHandoffState": {"NOT_STARTED", "SUBMITTING", "SUBMITTED", "UNKNOWN", "RESOLVED"},
		"GenerationAttemptStatus": {
			"CLAIMED", "SUBMITTING", "SUBMITTED", "SUCCEEDED",
			"FAILED_RETRYABLE", "FAILED_FINAL", "UNKNOWN",
		},
	}
	for enumName, expected := range requiredEnums {
		rows, err := pool.Query(ctx, `
SELECT enumlabel
FROM pg_enum JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
WHERE pg_type.typname = $1
`, enumName)
		if err != nil {
			return SchemaContractReport{}, err
		}
		found := map[string]bool{}
		for rows.Next() {
			var value string
			if err := rows.Scan(&value); err != nil {
				rows.Close()
				return SchemaContractReport{}, err
			}
			found[value] = true
		}
		rows.Close()
		for _, value := range expected {
			if !found[value] {
				report.Issues = append(report.Issues, SchemaIssue{
					Expected: "enum value", Kind: "missing_enum_value",
					Name: enumName + "." + value,
				})
			}
		}
	}

	objects := []struct {
		kind  string
		name  string
		query string
	}{
		{"missing_unique_constraint", "GenerationAttempt_jobId_ordinal_key", `SELECT to_regclass('"GenerationAttempt_jobId_ordinal_key"') IS NOT NULL`},
		{"missing_trigger", "GenerationJob_unresolved_refund_guard", `SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'GenerationJob_unresolved_refund_guard' AND NOT tgisinternal)`},
		{"missing_check_constraint", "GenerationJob_contract_handoff_state_check", `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GenerationJob_contract_handoff_state_check')`},
	}
	for _, object := range objects {
		var exists bool
		if err := pool.QueryRow(ctx, object.query).Scan(&exists); err != nil {
			return SchemaContractReport{}, err
		}
		if !exists {
			report.Issues = append(report.Issues, SchemaIssue{
				Expected: object.kind, Kind: object.kind, Name: object.name,
			})
		}
	}
	return report, nil
}

func CheckRollbackSafety(ctx context.Context, pool *pgxpool.Pool) (RollbackSafetyReport, error) {
	if pool == nil {
		return RollbackSafetyReport{}, errors.New("rollback database connection unavailable")
	}
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return RollbackSafetyReport{}, errors.New("rollback database snapshot unavailable")
	}
	defer rollbackSilently(ctx, tx)
	return readRollbackSafety(ctx, tx)
}

type rollbackSafetyReader interface {
	ImageQueryer
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

// A missing image schema preserves the legacy preflight. Any new storage marker
// requires both complete catalogues; a partial upgrade is never evidence of safety.
func readRollbackSafety(ctx context.Context, database rollbackSafetyReader) (RollbackSafetyReport, error) {
	var report RollbackSafetyReport
	err := database.QueryRow(ctx, `
SELECT
  COUNT(*) FILTER (
    WHERE "contractVersion" >= 1 AND status IN ('PENDING', 'PROCESSING')
  ),
  COUNT(*) FILTER (
    WHERE "contractVersion" >= 1
      AND "handoffState" IN ('SUBMITTING', 'SUBMITTED', 'UNKNOWN')
  )
FROM "GenerationJob"
`).Scan(&report.ActiveV1Jobs, &report.UnresolvedHandoffs)
	if err != nil {
		return RollbackSafetyReport{}, errors.New("rollback generation state unavailable")
	}
	var storagePresent bool
	err = database.QueryRow(ctx, `
SELECT EXISTS (
  SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = current_schema() AND c.relname IN (
    'ImageStoragePolicy','ImageQuota','ImageStorageLocation','ImageWriteReservation',
    'ImageAsset','ImageObject','ImageReference','ImageUrlAlias',
    'ImageHistoryJob','ImageHistoryItem','ImageObjectObservation','ImageHistoryReference','ImageHistoryHold'
  )
) OR EXISTS (
  SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = current_schema() AND a.attnum > 0 AND NOT a.attisdropped
    AND ((c.relname = 'GenerationImage' AND a.attname = 'mediaAssetId')
      OR (c.relname = 'CanvasImportAsset' AND a.attname IN ('mediaAssetId','sourceProvider'))
      OR (c.relname = 'ImageObject' AND a.attname IN ('provenance','sourceObservationId','reconciliationObservationId')))
) OR EXISTS (
  SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = current_schema() AND p.proname IN (
    'image_storage_revision','canvas_acquire_gc_lease_v2','canvas_claim_imports_v2','canvas_finish_asset_delete_v2',
    'image_scan_history','image_begin_history_apply','image_adopt_observed_object',
    'image_prepare_migration_copy','image_commit_migration_switch'
  )
)
`).Scan(&storagePresent)
	if err != nil {
		return RollbackSafetyReport{}, errors.New("rollback storage catalogue unavailable")
	}
	if !storagePresent {
		return report, nil
	}

	imageSchema, err := LoadImageSchemaContract()
	if err != nil {
		return RollbackSafetyReport{}, errors.New("rollback image schema contract unavailable")
	}
	imageReport := probeImageSchema(ctx, imageSchema, func(ctx context.Context, query string) ([]byte, error) {
		var payload []byte
		err := database.QueryRow(ctx, query).Scan(&payload)
		return payload, err
	})
	if !imageReport.Ready {
		return RollbackSafetyReport{}, errors.New("rollback image schema incomplete or unsupported")
	}
	canvas, err := LoadCanvasContract()
	if err != nil {
		return RollbackSafetyReport{}, errors.New("rollback canvas storage contract unavailable")
	}
	canvasReport, err := checkCanvasSchemaWithQuery(ctx, canvas.Schema, func(ctx context.Context, query string) ([]CanvasSchemaCatalogRow, error) {
		rows, err := database.Query(ctx, query)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		inventory := make([]CanvasSchemaCatalogRow, 0, len(canvas.Schema.Objects))
		for rows.Next() {
			var row CanvasSchemaCatalogRow
			if err := rows.Scan(&row.Kind, &row.Name, &row.Definition); err != nil {
				return nil, err
			}
			inventory = append(inventory, row)
		}
		return inventory, rows.Err()
	})
	if err != nil || !canvasReport.Ready() {
		return RollbackSafetyReport{}, errors.New("rollback canvas storage schema incomplete or unsupported")
	}
	// Catalogue verification proves these revisions without executing any
	// database function. Even an empty current installation cannot use old GC.
	report.ImageStorageRevision = imageSchema.StorageRevision
	report.CanvasStorageRevision = canvas.Schema.StorageRevision
	err = database.QueryRow(ctx, `
SELECT (SELECT count(*) FROM "ImageAsset"),
  (SELECT count(*) FROM "ImageObject" o JOIN "ImageStorageLocation" l ON l.id = o."locationId" WHERE l.provider = 'LOCAL'),
  (SELECT count(*) FROM "ImageWriteReservation" WHERE state = 'ACTIVE'),
  (SELECT count(*) FROM "ImageObject" WHERE state IN ('WRITING','UNKNOWN','DELETING')
    OR "needsReconciliation" OR ("putOutcome" = 'UNKNOWN' AND "reconciliationObservationId" IS NULL) OR "deleteOutcome" IN ('FAILED','UNKNOWN')),
  (SELECT count(*) FROM "ImageHistoryJob" WHERE state IN ('PLANNED','RUNNING','WAITING','PARTIAL')),
  (SELECT count(*) FROM "ImageHistoryItem" item JOIN "ImageHistoryJob" job ON job.id = item."jobId"
    WHERE item.state NOT IN ('SOURCE_RETAINED','RETIREMENT_REQUESTED','EXCLUDED')
      OR (job."retireSource" AND item.state = 'SOURCE_RETAINED' AND item."retirementJobId" IS NULL)),
  (SELECT count(*) FROM "ImageObjectObservation" observation JOIN "ImageHistoryItem" item ON item.id = observation."itemId"
    WHERE item.state NOT IN ('SOURCE_RETAINED','RETIREMENT_REQUESTED','EXCLUDED')
      AND (observation."readResult" <> 'FULL' OR observation."versionEvidence" <> 'UNVERSIONED' OR observation."writerEvidence" = 'UNKNOWN')),
  (SELECT count(*) FROM "ImageHistoryHold" WHERE "releasedAt" IS NULL)
`).Scan(&report.ManagedImageAssets, &report.LocalImageObjects, &report.ActiveImageReservations, &report.UnresolvedImageObjects,
		&report.ActiveImageHistoryJobs, &report.UnresolvedImageHistoryItems, &report.UnresolvedImageObservations, &report.ActiveImageHistoryHolds)
	if err != nil {
		return RollbackSafetyReport{}, errors.New("rollback image state unavailable")
	}
	return report, nil
}
