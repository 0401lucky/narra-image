//go:build workercontractsdb

package worker

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Called only by the existing sentinel-protected disposable DB suite. Every
// fixture below rolls back its own transaction, including the temporary schema.
func runRollbackStorageDBTests(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	t.Run("new storage revision rejects rollback without active v1 jobs", func(t *testing.T) {
		report, err := CheckRollbackSafety(ctx, pool)
		if err != nil {
			t.Fatal(err)
		}
		canvas, err := LoadCanvasContract()
		if err != nil {
			t.Fatal(err)
		}
		if report.Safe() || report.ActiveV1Jobs != 0 || report.UnresolvedHandoffs != 0 || report.ImageStorageRevision != ImageStorageRevision || report.CanvasStorageRevision != canvas.Schema.StorageRevision {
			t.Fatalf("new storage revision was not fenced: %+v", report)
		}
	})

	t.Run("active reservations and unknown local writes remain visible", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer rollbackSilently(ctx, tx)
		baseline, err := readRollbackSafety(ctx, tx)
		if err != nil {
			t.Fatal(err)
		}
		repository := NewImageRepository(tx)
		locationInput, err := NewImageLocalLocation("ca8ff9d3-e17c-4e28-a9b1-2919ce27c628")
		if err != nil {
			t.Fatal(err)
		}
		location, err := repository.RegisterLocation(ctx, locationInput)
		if err != nil {
			t.Fatal(err)
		}
		owner := "rollback-" + randomHex(8)
		reservation, err := repository.ReserveInput(ctx, ImageReserveInput{OwnerID: owner, IntentKey: owner, ByteLength: 1})
		if err != nil {
			t.Fatal(err)
		}
		ticket, err := repository.BeginObject(ctx, ImageBeginObjectInput{
			ReservationID: reservation.ID, Token: reservation.Token, Slot: 0, LocationID: location.ID,
			Key: "rollback/" + owner + ".png", ByteLength: 1, MimeType: "image/png", SHA256: strings.Repeat("a", 64), Purpose: "REFERENCE",
		})
		if err != nil {
			t.Fatal(err)
		}
		report, err := readRollbackSafety(ctx, tx)
		if err != nil {
			t.Fatal(err)
		}
		if report.Safe() || report.ManagedImageAssets != baseline.ManagedImageAssets+1 || report.LocalImageObjects != baseline.LocalImageObjects+1 ||
			report.ActiveImageReservations != baseline.ActiveImageReservations+1 || report.UnresolvedImageObjects != baseline.UnresolvedImageObjects+1 {
			t.Fatalf("active image storage was not reported: baseline=%+v actual=%+v", baseline, report)
		}
		if _, err := repository.FinishObject(ctx, ImageFinishObjectInput{ObjectID: ticket.Object.ID, WriteToken: ticket.Object.WriteToken, Outcome: "UNKNOWN"}); err != nil {
			t.Fatal(err)
		}
		if _, err := repository.CloseReservation(ctx, ImageCloseReservationInput{ReservationID: reservation.ID, Token: reservation.Token}); err != nil {
			t.Fatal(err)
		}
		report, err = readRollbackSafety(ctx, tx)
		if err != nil {
			t.Fatal(err)
		}
		if report.Safe() || report.ActiveImageReservations != baseline.ActiveImageReservations || report.LocalImageObjects != baseline.LocalImageObjects+1 ||
			report.UnresolvedImageObjects != baseline.UnresolvedImageObjects+1 {
			t.Fatalf("closing an input reservation concealed an unknown write: %+v", report)
		}
	})

	t.Run("no image schema retains the legacy generation check", func(t *testing.T) {
		withRollbackLegacySchema(t, ctx, pool, func(tx pgx.Tx) {
			report, err := readRollbackSafety(ctx, tx)
			if err != nil || !report.Safe() {
				t.Fatalf("empty legacy schema was not safe: %+v %v", report, err)
			}
			if _, err := tx.Exec(ctx, `INSERT INTO "GenerationJob" VALUES (1,'PENDING','NOT_STARTED'),(1,'FAILED','UNKNOWN')`); err != nil {
				t.Fatal(err)
			}
			report, err = readRollbackSafety(ctx, tx)
			if err != nil || report.Safe() || report.ActiveV1Jobs != 1 || report.UnresolvedHandoffs != 1 || report.ImageStorageRevision != 0 || report.CanvasStorageRevision != 0 {
				t.Fatalf("legacy generation guard changed: %+v %v", report, err)
			}
		})
	})

	t.Run("pending historical observation remains visible without a new object or reservation", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer rollbackSilently(ctx, tx)
		baseline, err := readRollbackSafety(ctx, tx)
		if err != nil {
			t.Fatal(err)
		}
		token := func() string {
			t.Helper()
			value, err := newImageMaintenanceToken()
			if err != nil {
				t.Fatal(err)
			}
			return value
		}
		owner, imageID, jobID := "rollback-history-"+randomHex(8), token(), token()
		if _, err := tx.Exec(ctx, `INSERT INTO "User" (id,email,credits,"updatedAt") VALUES ($1::text,$2::text,0,clock_timestamp())`, owner, owner+"@fixture.invalid"); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO "GenerationJob" (id,"userId","providerMode",model,prompt,size,count,status,"updatedAt") VALUES ($1::text,$2::text,'BUILT_IN','gpt-image-2','history rollback','auto',1,'SUCCEEDED',clock_timestamp())`, jobID, owner); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO "GenerationImage" (id,"jobId",url,"mediaStorage","storageKey") VALUES ($1::text,$2::text,'https://history-fixture.invalid/original.png','S3','original.png')`, imageID, jobID); err != nil {
			t.Fatal(err)
		}
		repository := NewImageRepository(tx)
		location, err := NewImageS3Location("https://history-fixture.invalid", "auto", "fixture", "https://history-fixture.invalid")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := repository.RegisterLocation(ctx, location); err != nil {
			t.Fatal(err)
		}
		page, err := repository.ScanImageHistory(ctx, ImageHistoryScanInput{Scope: "GENERATED", Limit: 1000})
		if err != nil {
			t.Fatal(err)
		}
		var snapshotHash string
		for _, candidate := range page.Candidates {
			if candidate.SubjectID == imageID {
				snapshotHash = candidate.SnapshotHash
			}
		}
		if snapshotHash == "" {
			t.Fatal("historical fixture was not discovered")
		}
		history, err := repository.BeginImageHistoryApply(ctx, ImageHistoryBeginApplyInput{
			RequestID: token(), ActorID: owner, PlanDigest: strings.Repeat("b", 64), Scope: "GENERATED", UpperBound: page.UpperBound,
			PublicURLBase:  "https://history-fixture.invalid",
			SourceBindings: []ImageHistorySourceBinding{{SubjectKind: "GENERATED", SubjectID: imageID, ExpectedSnapshotHash: snapshotHash, LocationID: location.ID, Key: "original.png", OwnerID: owner}},
		})
		if err != nil {
			t.Fatal(err)
		}
		claimToken := token()
		item, err := repository.ClaimImageHistoryItem(ctx, ImageHistoryClaimInput{JobID: history.ID, WorkerID: "rollback-fixture", Token: claimToken})
		if err != nil || item == nil || item.SubjectID != imageID {
			t.Fatalf("could not claim the exact historical fixture: %v", err)
		}
		if _, err := repository.RecordImageObjectObservation(ctx, ImageObjectObservationInput{
			RequestID: token(), ItemID: item.ID, Token: claimToken, Kind: "SOURCE", SourceSnapshotHash: snapshotHash,
			LocationID: location.ID, Key: "original.png", ReadResult: "UNVERIFIED", VersionEvidence: "UNKNOWN", WriterEvidence: "UNKNOWN",
		}); err != nil {
			t.Fatal(err)
		}
		report, err := readRollbackSafety(ctx, tx)
		if err != nil {
			t.Fatal(err)
		}
		if report.Safe() || report.ActiveImageHistoryJobs != baseline.ActiveImageHistoryJobs+1 || report.UnresolvedImageHistoryItems != baseline.UnresolvedImageHistoryItems+1 ||
			report.UnresolvedImageObservations != baseline.UnresolvedImageObservations+1 || report.ActiveImageHistoryHolds != baseline.ActiveImageHistoryHolds+1 ||
			report.ManagedImageAssets != baseline.ManagedImageAssets || report.UnresolvedImageObjects != baseline.UnresolvedImageObjects || report.ActiveImageReservations != baseline.ActiveImageReservations {
			t.Fatalf("unverified history was hidden or counted as a new physical write: baseline=%+v actual=%+v", baseline, report)
		}
		again, err := readRollbackSafety(ctx, tx)
		if err != nil || again != report {
			t.Fatalf("read-only preflight changed the pending history state: %v", err)
		}
	})

	for _, test := range []struct{ name, ddl string }{
		{"partial image tables", `CREATE TABLE "ImageObject" (id uuid)`},
		{"partial image binding", `CREATE TABLE "GenerationImage" ("mediaAssetId" uuid)`},
		{"partial canvas revision", `CREATE FUNCTION canvas_claim_imports_v2() RETURNS integer LANGUAGE sql AS $$ SELECT 2 $$`},
		{"partial history jobs", `CREATE TABLE "ImageHistoryJob" (id uuid)`},
		{"partial history observations", `CREATE TABLE "ImageObjectObservation" (id uuid)`},
		{"partial history holds", `CREATE TABLE "ImageHistoryHold" (id uuid)`},
		{"partial history revision", `CREATE FUNCTION image_scan_history(jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`},
	} {
		t.Run(test.name, func(t *testing.T) {
			withRollbackLegacySchema(t, ctx, pool, func(tx pgx.Tx) {
				if _, err := tx.Exec(ctx, test.ddl); err != nil {
					t.Fatal(err)
				}
				if _, err := readRollbackSafety(ctx, tx); err == nil {
					t.Fatal("partial image storage upgrade did not fail closed")
				}
			})
		})
	}
}

func withRollbackLegacySchema(t *testing.T, ctx context.Context, pool *pgxpool.Pool, action func(pgx.Tx)) {
	t.Helper()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackSilently(ctx, tx)
	schema := "rollback_fixture_" + randomHex(8)
	if _, err := tx.Exec(ctx, "CREATE SCHEMA "+pgx.Identifier{schema}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `SELECT set_config('search_path',$1,true)`, schema); err != nil {
		t.Fatal(err)
	}
	// This is the exact legacy query surface; new-storage objects are absent.
	if _, err := tx.Exec(ctx, `CREATE TABLE "GenerationJob" ("contractVersion" integer, status text, "handoffState" text)`); err != nil {
		t.Fatal(err)
	}
	action(tx)
}
