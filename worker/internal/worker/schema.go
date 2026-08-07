package worker

import (
	"context"
	"fmt"
	"strings"

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
	ActiveV1Jobs       int64
	UnresolvedHandoffs int64
}

func (report RollbackSafetyReport) Safe() bool {
	return report.ActiveV1Jobs == 0 && report.UnresolvedHandoffs == 0
}

func CheckSchemaContract(ctx context.Context, pool *pgxpool.Pool) (SchemaContractReport, error) {
	report := SchemaContractReport{ContractVersion: 1}
	for _, table := range []string{"GenerationJob", "GenerationAttempt"} {
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
	var report RollbackSafetyReport
	err := pool.QueryRow(ctx, `
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
		return RollbackSafetyReport{}, fmt.Errorf("检查 worker contract 回滚安全性: %w", err)
	}
	return report, nil
}
