package worker

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

type canvasGCAsset struct {
	ID                     string
	OwnerID                string
	Kind                   string
	State                  string
	StorageLocation        string
	StorageEndpoint        string
	StorageRegion          string
	StorageBucket          string
	StorageKey             string
	StorageVersionID       *string
	DeleteToken            string
	ByteLength             int64
	PutOutcome             string
	PhysicalBytesAccounted bool
}

type canvasGCRepository interface {
	AcquireLease(context.Context, string) (bool, error)
	ClaimImports(context.Context, string, string, int) ([]canvasGCAsset, error)
	FinishDelete(context.Context, string, string, string, string) (bool, error)
}

type canvasGCQueryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

type postgresCanvasGCRepository struct{ db canvasGCQueryer }

func (repository *postgresCanvasGCRepository) AcquireLease(ctx context.Context, token string) (bool, error) {
	var acquired bool
	err := repository.db.QueryRow(ctx, `SELECT canvas_acquire_gc_lease($1::uuid)`, token).Scan(&acquired)
	return acquired, err
}

func (repository *postgresCanvasGCRepository) ClaimImports(ctx context.Context, token string, location string, limit int) ([]canvasGCAsset, error) {
	// The SQL function owns the DB clock, sorted row locks, roots, leases and
	// eligibility. Consume/close all rows before any object-store operation.
	rows, err := repository.db.Query(ctx, `
SELECT id, "ownerId", kind, state, "storageLocation", "storageEndpoint",
       "storageRegion", "storageBucket", "storageKey", "storageVersionId",
       "deleteToken"::text, "byteLength", "putOutcome", "physicalBytesAccounted"
FROM canvas_claim_imports($1::uuid, $2::text, $3::integer)
`, token, location, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	assets := make([]canvasGCAsset, 0, limit)
	for rows.Next() {
		if len(assets) >= limit {
			return nil, errors.New("canvas GC claim exceeded its bounded batch")
		}
		var asset canvasGCAsset
		if err := rows.Scan(
			&asset.ID, &asset.OwnerID, &asset.Kind, &asset.State, &asset.StorageLocation,
			&asset.StorageEndpoint, &asset.StorageRegion, &asset.StorageBucket,
			&asset.StorageKey, &asset.StorageVersionID, &asset.DeleteToken,
			&asset.ByteLength, &asset.PutOutcome, &asset.PhysicalBytesAccounted,
		); err != nil {
			return nil, err
		}
		assets = append(assets, asset)
	}
	return assets, rows.Err()
}

func (repository *postgresCanvasGCRepository) FinishDelete(ctx context.Context, assetID string, token string, outcome string, errorCode string) (bool, error) {
	var finished bool
	var code *string
	if errorCode != "" {
		code = &errorCode
	}
	// No host-clock timestamps, counters or accounting writes live in Go.
	err := repository.db.QueryRow(ctx, `SELECT canvas_finish_asset_delete($1::text, $2::uuid, $3::"CanvasDeleteOutcome", $4::text)`, assetID, token, outcome, code).Scan(&finished)
	return finished, err
}
