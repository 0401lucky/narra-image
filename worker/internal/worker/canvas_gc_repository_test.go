package worker

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

type canvasRepositoryTestRows struct {
	pgx.Rows
	assets []canvasGCAsset
	index  int
	closed bool
	err    error
}

func (rows *canvasRepositoryTestRows) Close()     { rows.closed = true }
func (rows *canvasRepositoryTestRows) Err() error { return rows.err }
func (rows *canvasRepositoryTestRows) Next() bool {
	rows.index++
	return rows.index <= len(rows.assets)
}
func (rows *canvasRepositoryTestRows) Scan(destinations ...any) error {
	a := rows.assets[rows.index-1]
	values := []any{a.ID, a.OwnerID, a.Kind, a.State, a.StorageLocation, a.StorageEndpoint, a.StorageRegion, a.StorageBucket, a.StorageKey, a.StorageVersionID, a.DeleteToken, a.ByteLength, a.PutOutcome, a.PhysicalBytesAccounted}
	for index, destination := range destinations {
		reflect.ValueOf(destination).Elem().Set(reflect.ValueOf(values[index]))
	}
	return nil
}

type canvasRepositoryTestRow struct {
	value bool
	err   error
}

func (row canvasRepositoryTestRow) Scan(destinations ...any) error {
	*destinations[0].(*bool) = row.value
	return row.err
}

type canvasRepositoryTestDB struct {
	rows      *canvasRepositoryTestRows
	queries   []string
	arguments [][]any
	value     bool
	err       error
}

func (db *canvasRepositoryTestDB) Query(_ context.Context, query string, args ...any) (pgx.Rows, error) {
	db.queries, db.arguments = append(db.queries, query), append(db.arguments, args)
	return db.rows, db.err
}
func (db *canvasRepositoryTestDB) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	db.queries, db.arguments = append(db.queries, query), append(db.arguments, args)
	return canvasRepositoryTestRow{value: db.value, err: db.err}
}

func TestCanvasGCRepositoryKeepsAuthorityInSQLAndReleasesRows(t *testing.T) {
	asset := runtimeCanvasAsset(t)
	db := &canvasRepositoryTestDB{rows: &canvasRepositoryTestRows{assets: []canvasGCAsset{asset}}, value: true}
	repository := &postgresCanvasGCRepository{db: db}
	acquired, err := repository.AcquireLease(context.Background(), "sweep-token")
	if err != nil || !acquired {
		t.Fatal("lease result not propagated")
	}
	assets, err := repository.ClaimImports(context.Background(), "sweep-token", asset.StorageLocation, 20)
	if err != nil || !reflect.DeepEqual(assets, []canvasGCAsset{asset}) || !db.rows.closed {
		t.Fatalf("claim cursor/connection retained across object I/O: %v", err)
	}
	finished, err := repository.FinishDelete(context.Background(), asset.ID, asset.DeleteToken, canvasDeleteFailed, "CANVAS_STORAGE_UNAVAILABLE")
	if err != nil || !finished {
		t.Fatal("finalization result not propagated")
	}
	for index, function := range []string{"canvas_acquire_gc_lease", "canvas_claim_imports", "canvas_finish_asset_delete"} {
		if !strings.Contains(db.queries[index], function) || strings.Contains(db.queries[index], "UPDATE") || strings.Contains(db.queries[index], "NOW()") {
			t.Fatalf("repository replaced SQL authority: %s", db.queries[index])
		}
	}
	if !reflect.DeepEqual(db.arguments[1], []any{"sweep-token", asset.StorageLocation, 20}) || db.arguments[2][0] != asset.ID || db.arguments[2][1] != asset.DeleteToken || *db.arguments[2][3].(*string) != "CANVAS_STORAGE_UNAVAILABLE" {
		t.Fatal("claim or finalization lost its fences")
	}
	_, _ = repository.FinishDelete(context.Background(), asset.ID, asset.DeleteToken, canvasDeleteDeleted, "")
	if db.arguments[3][3].(*string) != nil {
		t.Fatal("successful finalization sent a fabricated error")
	}
}

func TestCanvasGCRepositoryReturnsStaleFencesAndQueryFailures(t *testing.T) {
	db := &canvasRepositoryTestDB{rows: &canvasRepositoryTestRows{err: errors.New("cursor failed")}}
	repository := &postgresCanvasGCRepository{db: db}
	if acquired, err := repository.AcquireLease(context.Background(), "old"); acquired || err != nil {
		t.Fatal("denied sweep lease was ignored")
	}
	if finished, err := repository.FinishDelete(context.Background(), "asset", "old", canvasDeleteDeleted, ""); finished || err != nil {
		t.Fatal("expired/version-fenced finalizer was treated as success")
	}
	if _, err := repository.ClaimImports(context.Background(), "sweep", "location", 20); err == nil || !db.rows.closed {
		t.Fatal("row errors were lost or cursor leaked")
	}
	db.err = errors.New("query failed")
	if _, err := repository.ClaimImports(context.Background(), "sweep", "location", 20); err == nil {
		t.Fatal("DB query failure was hidden")
	}
}
